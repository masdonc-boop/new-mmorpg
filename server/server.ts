import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { GameWorld, TICK_SECONDS, type Appearance, type GameEvent, type Player, type PlayerId } from '../src/sim/world';
import { routeEvents } from '../src/net/audience';
import { generateWorld, type WorldMap } from '../src/sim/worldmap';
import { mergeSave } from '../src/sim/records';
import { INTEREST_RADIUS, captureState, type WorldState } from '../src/net/replica';
import { MOVES_PER_SNAPSHOT, diffState, limitMoves } from '../src/net/delta';
import { GUEST_NAME, MAX_IMPORT_MESSAGE, PROTOCOL_VERSION, SNAPSHOT_HZ, contentVersion, parseClientMessage, type Auth, type ClientMessage, type ErrorCode, type AdminCommand, type LiveIntent, type LiveResult, type ServerMessage } from '../src/net/protocol';
import { openDatabase } from './db';
import { RateLimiter, USERNAME, hashPassword, passwordProblem, verifyPassword } from './auth';
import { Repos, StaleWriteError } from './repo';
import { prepareImport, type ImportPolicy } from './import';
import { CHAT_HEARD, CHAT_RADIUS, ChatPace, cleanChat, filterForm } from './chat';
import { LiveExchange, liveAccount } from './liveexchange';
import { Bucket, DEFAULT_EXCHANGE_POLICY, ExchangeWatch, checkOffer, type ExchangePolicy } from './exchangeguard';
import { BRIGHTWATER, HOLLOW_ZONE, zoneArea, zoneFor, zoneKind, type ZoneId } from '../src/sim/zones';
import { DUNGEON_AREAS } from '../src/sim/dungeonmap';
import type { TradeCommit } from '../src/sim/trade';

/**
 * Brightwater development server (docs/MULTIPLAYER.md 3A.2 and 3A.3).
 *
 * Authoritative play over the network: each signed-in character has its own server-side
 * `GameWorld` (today's single-player simulation); clients send intents and render what the server
 * sends back. Accounts, sessions and characters live in SQLite. Every save carries the character's
 * lease epoch and version, so a stale writer (an older server, or a session that was taken over)
 * can never overwrite newer data.
 *
 * Development only: listens on localhost by default, plain `ws://` (TLS is required before anything
 * is reachable from other machines; see the approval gates in the plan).
 */

export interface ServerOptions {
  port?: number;
  host?: string;
  /** SQLite file (default `server/data/dev.sqlite`), or `:memory:`. */
  dbPath?: string;
  /** Allow unsaved guest play by name (development and tests only). */
  allowGuests?: boolean;
  /** How often characters with changes are saved (ms). */
  saveIntervalMs?: number;
  /** How long a disconnected character stays in the world before being saved and logged out (ms). */
  graceMs?: number;
  /** Importing browser saves (an owner decision; docs/MULTIPLAYER.md section 7). Default `full`. */
  importPolicy?: ImportPolicy;
  /**
   * The live Exchange: real items and coins, traded between accounts (docs/MULTIPLAYER.md 3A.7).
   * Off by default; switching it on is an owner decision. The practice market is unaffected.
   */
  liveExchange?: boolean;
  /**
   * Web pages allowed to connect (their Origin header), e.g. ['http://192.168.1.20:4173']. Clients
   * that send no Origin (not browsers) are always allowed. Unset: any page (development only).
   */
  allowedOrigins?: string[];
  /** New accounts need this code (3B.7). Unset: anyone may register. */
  inviteCode?: string;
  /** How often connections are pinged (one missed answer closes them). Default 10 s. */
  heartbeatMs?: number;
  /** 3B.1 limits (defaults suit real players, each on their own address; tests raise them). */
  limits?: Partial<{ connectionsPerAddress: number; signInsPerAddress: number; transferCooldownMs: number; registrationsPerHour: number }>;
  /** Live Exchange safeguards (3B.3); anything left out keeps its default. */
  exchangePolicy?: Partial<ExchangePolicy>;
  /** How often the live Exchange checks its books against the database. Default one minute. */
  integrityIntervalMs?: number;
  /** This server instance's lease name (random by default). */
  instance?: string;
  /** Real-world clock (farming, sessions, rate limits); injectable for tests. */
  clock?: () => number;
  log?: (msg: string) => void;
}

export interface RunningServer {
  port: number;
  /** Loaded characters by key (`acct:<id>` or `guest:<name>`). */
  sessions: Map<string, Session>;
  /** Brightwater, the shared island zone (most players are here). */
  zone: GameWorld;
  /** Every running zone: Brightwater, Glimmer Hollow and open house instances (3A.8). */
  zones: Map<ZoneId, GameWorld>;
  repos: Repos;
  /** Load figures: whole server ticks (simulation, routing and snapshots) and bytes sent. */
  stats: ServerStats;
  /** Moderation: stops a player chatting for a while (accounts: stored; guests: until they leave). */
  mute(name: string, minutes: number): boolean;
  /** The live Exchange, when switched on. */
  live: LiveExchange | null;
  /** Saves every loaded character now (tests and tooling). */
  saveAll(): void;
  /** Stops the server. `save: false` simulates a crash (nothing is saved on the way down). */
  close(opts?: { save?: boolean }): Promise<void>;
}

/** Movement inputs the server keeps queued at most (older ones are dropped and acknowledged). */
const MAX_INPUT_QUEUE = 8;
/** Ticks the last joystick input is held while waiting for the next one before stopping. */
const INPUT_HOLD_TICKS = 6;
/** Rate limit: messages per second per connection (token bucket), and strikes before disconnecting. */
const MESSAGE_RATE = 90;
/** Compares secrets without giving away how much matched. */
const sameSecret = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
/** 3B.1 limits. */
const MAX_PREAUTH_MESSAGE = 4096;
const MAX_BUFFERED = 2 * 1024 * 1024;
const MAX_BLOCKED = 200;
/** Game commands (not movement inputs) per second: each may start a pathfind. */
const COMMAND_RATE = 15;
/** What a moderator may do (admins may do everything). */
const MODERATOR_OPS = new Set<AdminCommand['op']>(['who', 'kick', 'mute', 'unmute', 'reports', 'resolve']);
const MAX_STRIKES = 20;
/** Commands for the practice market are handled on the device; the server ignores them. */
const DEVICE_LOCAL = new Set(['exchange', 'exchangeResetPractice']);
/** Events about the server's own (unused) practice market are not sent. */
const SERVER_ONLY_EVENTS = new Set<GameEvent['type']>(['exchange', 'exchangeResult']);

/**
 * The character record as compared for "has it changed": without the fields snapshots already
 * carry every time (position, health, prayer, lantern), so walking about doesn't resend the record.
 */
const SNAPSHOT_FIELDS = new Set(['x', 'z', 'hp', 'prayerPoints', 'lanternBurn']);
const characterKey = (record: object) => JSON.stringify(record, (k, v) => (SNAPSHOT_FIELDS.has(k) ? undefined : v));

export interface ServerStats {
  ticks: number;
  tickMsTotal: number;
  tickMsMax: number;
  bytesSent: number;
}

export interface Session {
  key: string;
  name: string;
  playerId: PlayerId;
  /** This character, in the zone they are in. */
  player: Player;
  zoneId: ZoneId;
  world: GameWorld;
  ws: WebSocket | null;
  /** Persistence (null for guests). */
  accountId: number | null;
  characterId: number | null;
  epoch: number;
  version: number;
  lastSaved: string;
  disconnectedAt: number | null;
  inputs: { seq: number; dx: number; dz: number }[];
  lastSeq: number;
  ack: number;
  holding: number;
  joyActive: boolean;
  events: GameEvent[];
  lastCharacter: string;
  /** The last state this connection was sent; snapshots are deltas from it. */
  lastState: WorldState | null;
  /** Bytes sent to this character's connections (load measurement). */
  bytesSent: number;
  /** Chat: pacing, who they've blocked (lower case), what they received (for reports), mutes. */
  pace: ChatPace;
  blocked: Set<string>;
  heard: { from: string; text: string }[];
  mutedUntil: number;
  lastReport: number;
  strikes: number;
  tokens: number;
  lastImportTry: number;
  /** Network address a guest joined from (only that address may take the guest name back). */
  addr: string;
  /** When they last changed zones, and whether their last save failed (3B.1). */
  lastTransfer: number;
  saveFailed: boolean;
  /** Game commands allowed right now (refilled every tick). */
  cmdTokens: number;
}

export async function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const log = opts.log ?? ((m: string) => console.log(`[server] ${m}`));
  const clock = opts.clock ?? (() => Date.now());
  const instance = opts.instance ?? `dev-${randomBytes(4).toString('hex')}`;
  const graceMs = opts.graceMs ?? 30_000;
  const saveIntervalMs = opts.saveIntervalMs ?? 30_000;
  const db = openDatabase(opts.dbPath ?? 'server/data/dev.sqlite');
  const repos = new Repos(db, clock);
  const map: WorldMap = generateWorld(1337);
  const content = contentVersion(map);
  const sessions = new Map<string, Session>();
  // Zones (docs/MULTIPLAYER.md 3A.8): Brightwater and Glimmer Hollow run all the time; house
  // instances open when their owner walks in and close when empty. Where a player stands decides
  // their zone (src/sim/zones.ts).
  const zones = new Map<ZoneId, GameWorld>();
  const openZone = (id: ZoneId): GameWorld => {
    let w = zones.get(id);
    if (!w) {
      w = new GameWorld({ noPlayer: true, map, clock, area: zoneArea(id) });
      w.trades.commitHook = (c) => commitTrade(c);
      zones.set(id, w);
      if (zoneKind(id) === 'instance') log(`opened ${id}`);
    }
    return w;
  };
  const closeIfEmpty = (id: ZoneId) => {
    if (zoneKind(id) === 'instance' && zones.get(id)?.players.size === 0) {
      zones.delete(id);
      log(`closed ${id}`);
    }
  };
  const zone = openZone(BRIGHTWATER);
  openZone(HOLLOW_ZONE);
  // The dungeons (Phase 4C) are shared zones too, always running.
  for (const id of Object.keys(DUNGEON_AREAS)) openZone(id);
  // The live Exchange (off unless switched on): one for the whole world, restored from the database.
  const live = opts.liveExchange ? new LiveExchange(clock, repos.exchangeState()) : null;
  const features = { liveExchange: live !== null };
  const policy: ExchangePolicy = { ...DEFAULT_EXCHANGE_POLICY, ...opts.exchangePolicy };
  const gxRequests = new Bucket(policy.requestsPerMinute, clock);
  const gxGuides = new Bucket(policy.guidesPerMinute, clock);
  const watch = new ExchangeWatch(policy, clock);
  if (live) {
    live.onFreeze = (why) => {
      log(`LIVE EXCHANGE FROZEN: ${why}`);
      repos.flagExchange([{ account: '*', kind: 'frozen', detail: why }]);
      repos.adminAudit('server', 'exchange-freeze', '', why);
      for (const x of sessions.values()) if (x.ws && x.accountId !== null && repos.role(x.accountId) === 'admin') notice(x, `The live Exchange froze itself: ${why}`, 'warn');
    };
  }
  /** Words moderators added to the chat filter (on top of the built-in list). */
  let chatFilter = repos.filterWords();
  // Sign-in limits: per account name and per network address.
  const accountFails = new RateLimiter(5, 5 * 60_000, clock);
  const accountFailsAll = new RateLimiter(50, 5 * 60_000, clock);
  /** Sign-ins being checked right now, by address and by account name (3B.1). */
  const signingIn = new Map<string, number>();
  /** Open connections by address (3B.1). */
  const connections = new Map<string, number>();
  const allowedOrigins = opts.allowedOrigins ?? null;
  const alive = new WeakMap<WebSocket, boolean>();
  const limits = { connectionsPerAddress: 8, signInsPerAddress: 2, transferCooldownMs: 1000, ...opts.limits };
  const addressFails = new RateLimiter(30, 5 * 60_000, clock);
  const registrations = new RateLimiter(opts.limits?.registrationsPerHour ?? 5, 60 * 60_000, clock);
  // A real hash to compare against when the account doesn't exist (so timing doesn't reveal names).
  const dummyHash = await hashPassword(randomBytes(12).toString('hex'));
  let nextGuestId = 1_500_000_000;
  let tick = 0;

  const host = opts.host ?? '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) log('WARNING: listening beyond this machine without TLS. Development use only.');
  const wss = new WebSocketServer({ port: opts.port ?? 8787, host, maxPayload: MAX_IMPORT_MESSAGE });
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
  // Started once the socket server exists: the sign-in hash above can take longer than a short heartbeat.
  const heartbeat = setInterval(() => {
    for (const c of wss.clients) {
      if (alive.get(c) === false) {
        c.terminate();
        continue;
      }
      alive.set(c, false);
      c.ping();
    }
  }, opts.heartbeatMs ?? 10_000);
  const address = wss.address();
  const port = typeof address === 'object' && address ? address.port : opts.port ?? 8787;

  const stats: ServerStats = { ticks: 0, tickMsTotal: 0, tickMsMax: 0, bytesSent: 0 };
  const send = (ws: WebSocket | null, msg: ServerMessage, s?: Session) => {
    if (!ws || ws.readyState !== ws.OPEN) return 0;
    // 3B.1: a client that stops reading isn't allowed to pile up memory on the server.
    if (ws.bufferedAmount > MAX_BUFFERED) {
      log(`${s?.name ?? 'a connection'} isn't keeping up; closing it`);
      ws.terminate();
      return 0;
    }
    const data = JSON.stringify(msg);
    ws.send(data);
    stats.bytesSent += data.length;
    if (s) s.bytesSent += data.length;
    return data.length;
  };
  const refuse = (ws: WebSocket, error: string, code: ErrorCode) => {
    send(ws, { t: 'error', error, code, fatal: true });
    ws.close(1008, code);
  };

  wss.on('connection', (ws, req) => {
    const addr = req.socket.remoteAddress ?? 'unknown';
    // 3B.1: a few connections per address, and only from pages this server serves (when set).
    const open = (connections.get(addr) ?? 0) + 1;
    if (open > limits.connectionsPerAddress) {
      ws.close(1008, 'too many connections');
      return;
    }
    const origin = req.headers.origin;
    if (allowedOrigins && origin !== undefined && !allowedOrigins.includes(origin)) {
      log(`refused a connection from origin ${origin}`);
      ws.close(1008, 'origin');
      return;
    }
    connections.set(addr, open);
    // 3B.4: a connection that stops answering pings is closed, so a phone that vanished (no clean
    // close) starts its grace period instead of standing in the world as if still there.
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    ws.once('close', () => {
      const n = (connections.get(addr) ?? 1) - 1;
      if (n > 0) connections.set(addr, n);
      else connections.delete(addr);
    });
    let session: Session | null = null;
    let joining = false;
    let token: string | null = null;
    let strikes = 0;
    const strike = (why: string) => {
      const n = session ? ++session.strikes : ++strikes;
      send(ws, { t: 'error', error: why });
      if (n >= MAX_STRIKES) {
        send(ws, { t: 'error', error: 'Too many invalid messages.', fatal: true });
        ws.close(1008, 'invalid messages');
      }
    };
    const helloTimer = setTimeout(() => {
      if (!session && !joining) ws.close(1008, 'no hello');
    }, 5000);

    ws.on('message', (data, isBinary) => {
      try {
        onMessage(data, isBinary);
      } catch (err) {
        // 3B.1: one bad request never takes the whole server down.
        log(`error handling a message from ${session?.name ?? addr}: ${(err as Error).stack ?? err}`);
        send(ws, { t: 'error', error: 'Something went wrong on the server. Nothing was changed.' });
      }
    });
    const onMessage = (data: RawData, isBinary: boolean) => {
      if (isBinary) return strike('Binary messages are not accepted.');
      // Before signing in, only a small hello is expected.
      const size = Array.isArray(data) ? data.reduce((n, b) => n + b.length, 0) : (data as Buffer | ArrayBuffer).byteLength;
      if (!session && size > MAX_PREAUTH_MESSAGE) {
        ws.close(1009, 'too large');
        return;
      }
      const msg = parseClientMessage(data.toString(), { allowImport: session?.accountId != null && session.ws === ws });
      if (!msg) return strike('Invalid message.');
      if (!session) {
        if (joining) return strike('Still signing in.');
        if (msg.t !== 'hello') return strike('Say hello first.');
        joining = true;
        clearTimeout(helloTimer);
        // 3B.1: sign-ins that check a password are counted while they run, so opening many
        // connections at once can't try many passwords before the first failure is recorded.
        const keys = [`addr:${addr}`, ...(msg.auth.kind === 'login' ? [`name:${msg.auth.username.toLowerCase()}`] : [])];
        if (msg.auth.kind !== 'guest' && keys.some((k) => (signingIn.get(k) ?? 0) >= (k.startsWith('addr:') ? limits.signInsPerAddress : 1))) {
          refuse(ws, 'A sign-in is already in progress. Try again in a moment.', 'locked');
          return;
        }
        if (msg.auth.kind !== 'guest') for (const k of keys) signingIn.set(k, (signingIn.get(k) ?? 0) + 1);
        const done = () => {
          if (msg.auth.kind === 'guest') return;
          for (const k of keys) {
            const n = (signingIn.get(k) ?? 1) - 1;
            if (n > 0) signingIn.set(k, n);
            else signingIn.delete(k);
          }
        };
        signIn(ws, addr, msg)
          .then((r) => {
            joining = false;
            done();
            if (r) ({ session, token } = r);
          })
          .catch((err) => {
            joining = false;
            done();
            log(`sign-in failed: ${(err as Error).message}`);
            refuse(ws, 'The server could not sign you in. Try again.', 'auth');
          });
        return;
      }
      if (session.ws !== ws) return;
      // Rate limit (token bucket refilled every tick).
      if (session.tokens <= 0) return strike('Too many messages.');
      session.tokens--;
      if (msg.t === 'logout') {
        logout(session, token);
        session = null;
        return;
      }
      if (msg.t === 'import') {
        importSave(session, msg.save);
        return;
      }
      handle(session, msg);
    };
    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (session && session.ws === ws) {
        session.ws = null;
        session.disconnectedAt = clock();
        session.inputs = [];
        session.world.issueFor(session.playerId, { type: 'joystick', dx: 0, dz: 0 });
        // A trade never waits on someone who has gone.
        session.world.trades.leave(session.playerId, session.name);
        log(`${session.name} disconnected`);
      }
    });
  });

  /** Checks the hello, signs in (guest, new account, password or token) and attaches the character. */
  async function signIn(ws: WebSocket, addr: string, hello: Extract<ClientMessage, { t: 'hello' }>): Promise<{ session: Session; token: string | null } | null> {
    if (hello.v !== PROTOCOL_VERSION || hello.content !== content) {
      refuse(ws, `This game version doesn't match the server (server ${content}, game ${hello.content}). Reload to update.`, 'version');
      return null;
    }
    const auth: Auth = hello.auth;
    const no = (error: string, code: ErrorCode) => {
      refuse(ws, error, code);
      return null;
    };
    if (auth.kind === 'guest') {
      if (!opts.allowGuests) {
        refuse(ws, 'Guest play is off on this server. Create an account or sign in.', 'auth');
        return null;
      }
      if (!GUEST_NAME.test(auth.name)) return no('Guest names are up to 12 letters or numbers, starting with a letter.', 'auth');
      // 3B.1: a guest can't take an account's name, or another guest's character from elsewhere.
      if (repos.findAccount(auth.name)) return no('That name belongs to an account. Choose another guest name.', 'taken');
      const existing = sessions.get(`guest:${auth.name.toLowerCase()}`);
      if (existing && existing.addr !== addr) return no('That guest name is in use. Choose another.', 'taken');
      return { session: attachGuest(ws, auth.name, auth.appearance, addr), token: null };
    }
    if (addressFails.blocked(addr)) {
      refuse(ws, 'Too many sign-in attempts from here. Try again in a few minutes.', 'locked');
      return null;
    }
    let accountId: number;
    let token: string | null = null;
    let issued: string | undefined;
    if (auth.kind === 'register') {
      if (!USERNAME.test(auth.username)) return no('Names are 3 to 12 letters, numbers, - or _, starting with a letter.', 'auth');
      const problem = passwordProblem(auth.password, auth.username);
      if (problem) return no(problem, 'auth');
      if (registrations.blocked(addr)) return no('Too many new accounts from here. Try again later.', 'locked');
      // 3B.7: a server open beyond its own computer only takes new accounts with its invite code.
      if (opts.inviteCode && !sameSecret(auth.invite ?? '', opts.inviteCode)) {
        registrations.fail(addr);
        return no(auth.invite ? 'That invite code isn’t right.' : 'This server needs an invite code to create an account. Ask the host for it.', 'auth');
      }
      const hash = await hashPassword(auth.password);
      const record = new GameWorld({ name: auth.username, appearance: auth.appearance, map, clock }).characterRecord();
      const made = repos.createAccount(auth.username, hash, record, {});
      if (!made) return no('That name is taken. Try another.', 'taken');
      registrations.fail(addr);
      accountId = made.account.id;
      issued = token = repos.createSession(accountId);
      log(`new account ${auth.username}`);
    } else if (auth.kind === 'login') {
      // 3B.1: wrong passwords lock the name for this address (so others can't lock someone out),
      // with a much higher limit across all addresses.
      const name = auth.username.toLowerCase();
      const key = `${name}|${addr}`;
      if (accountFails.blocked(key) || accountFailsAll.blocked(name)) {
        repos.audit(repos.findAccount(auth.username)?.id ?? null, 'login-locked', auth.username);
        return no('Too many wrong passwords for this name. Try again in a few minutes.', 'locked');
      }
      const account = repos.findAccount(auth.username);
      const ok = await verifyPassword(auth.password, account?.password ?? dummyHash);
      if (!account || !ok) {
        accountFails.fail(key);
        accountFailsAll.fail(name);
        addressFails.fail(addr);
        repos.audit(account?.id ?? null, 'login-failed', auth.username);
        return no('Wrong name or password.', 'auth');
      }
      accountFails.clear(key);
      accountId = account.id;
      issued = token = repos.createSession(accountId);
    } else {
      const id = repos.sessionAccount(auth.token);
      if (id === null) {
        addressFails.fail(addr);
        return no('Your sign-in has expired. Sign in again.', 'session');
      }
      accountId = id;
      token = auth.token;
    }
    if (ws.readyState !== ws.OPEN) return null;
    const ban = repos.activeBan(accountId);
    if (ban) {
      repos.audit(accountId, 'login-banned');
      return no(`This account is banned${ban.until ? ` until ${new Date(ban.until).toUTCString()}` : ''}: ${ban.reason || 'no reason given'}.`, 'banned');
    }
    return { session: attachAccount(ws, accountId, issued), token };
  }

  function attachGuest(ws: WebSocket, name: string, appearance: Appearance | undefined, addr: string): Session {
    const key = `guest:${name.toLowerCase()}`;
    let s = sessions.get(key);
    if (!s) {
      const playerId = nextGuestId++;
      const player = zone.addPlayer({ playerId, name, appearance });
      s = newSession(key, name, playerId, player, BRIGHTWATER, null, null, 0, 0);
      s.addr = addr;
      sessions.set(key, s);
      log(`new guest ${name} (#${playerId})`);
    }
    bind(s, ws);
    return s;
  }

  function attachAccount(ws: WebSocket, accountId: number, issued?: string): Session {
    const key = `acct:${accountId}`;
    let s = sessions.get(key);
    if (s) {
      log(`${s.name} reconnected`);
    } else {
      // Load the character and take its lease: any older writer can no longer save it.
      const row = repos.characterFor(accountId)!;
      const leased = repos.acquireLease(row.id, instance);
      // Into the zone where they were standing, with their own wisps and loot piles.
      const zoneId = zoneFor(Number(leased.record.x), Number(leased.record.z), leased.playerId);
      const player = openZone(zoneId).addPlayer({ playerId: leased.playerId, save: mergeSave({ character: leased.record, zone: leased.zone }), worldItems: true });
      s = newSession(key, leased.name, leased.playerId, player, zoneId, accountId, leased.id, leased.leaseEpoch, leased.version);
      s.lastSaved = persisted(s);
      sessions.set(key, s);
      log(`${s.name} signed in`);
    }
    repos.audit(accountId, 'login', instance);
    bind(s, ws, issued);
    return s;
  }

  function newSession(key: string, name: string, playerId: PlayerId, player: Player, zoneId: ZoneId, accountId: number | null, characterId: number | null, epoch: number, version: number): Session {
    return { key, name, playerId, player, zoneId, world: zones.get(zoneId)!, ws: null, accountId, characterId, epoch, version, lastSaved: '', disconnectedAt: null, inputs: [], lastSeq: 0, ack: 0, holding: 0, joyActive: false, events: [], lastCharacter: '', lastState: null, bytesSent: 0, pace: new ChatPace(clock), blocked: new Set(accountId === null ? [] : repos.blockedBy(accountId).map((n) => n.toLowerCase())), heard: [], mutedUntil: 0, lastReport: 0, strikes: 0, tokens: MESSAGE_RATE, lastImportTry: 0, addr: '', lastTransfer: 0, saveFailed: false, cmdTokens: COMMAND_RATE };
  }

  /** Points a session at a connection (taking over from any older one) and sends the welcome. */
  function bind(s: Session, ws: WebSocket, issued?: string) {
    if (s.ws && s.ws !== ws) {
      // One live connection per character: the newer one takes over (same world, nothing reloaded).
      send(s.ws, { t: 'error', error: 'Signed in from somewhere else.', fatal: true, code: 'replaced' });
      s.ws.close(4000, 'replaced');
    }
    s.ws = ws;
    s.disconnectedAt = null;
    s.inputs = [];
    s.lastSeq = 0;
    s.ack = 0;
    s.strikes = 0;
    const character = s.world.act(s.player, () => s.world.characterRecord());
    s.lastCharacter = characterKey(character);
    s.lastState = stateFor(s);
    send(ws, { t: 'welcome', v: PROTOCOL_VERSION, playerId: s.playerId, character, state: s.lastState, features, zone: s.zoneId, ...(issued ? { session: issued } : {}) });
    send(ws, { t: 'social', blocked: [...s.blocked] });
  }

  /** The character and their own things in the world (wisps, private loot), as saved. */
  const persisted = (s: Session) => s.world.act(s.player, () => JSON.stringify([s.world.characterRecord(), s.world.zoneState({ ownedOnly: true })]));
  /** A snapshot as this player sees it (their own state, and what is near them). */
  const stateFor = (s: Session) => s.world.act(s.player, () => captureState(s.world, tick, s.ack));

  /** Saves a character if it changed. A stale lease ends the session without writing anything. */
  function save(s: Session, why: string): boolean {
    if (s.characterId === null) return true;
    const json = persisted(s);
    if (json === s.lastSaved) return true;
    try {
      const [record, zone] = JSON.parse(json);
      s.version = repos.saveCharacter(s.characterId, s.epoch, s.version, record, zone);
      s.lastSaved = json;
      return true;
    } catch (err) {
      if (err instanceof StaleWriteError) {
        dropStale(s, why, err);
        return false;
      }
      // 3B.1: anything else (the database busy or full): keep the character and try again later.
      s.saveFailed = true;
      log(`${s.name}: ${why} save failed, will retry (${(err as Error).message})`);
      return false;
    }
  }

  /** This server's copy is out of date (another server or sign-in owns the character): drop it unsaved. */
  function dropStale(s: Session, why: string, err: StaleWriteError) {
    log(`${s.name}: ${why} save refused (${err.message}); dropping this copy`);
    repos.audit(s.accountId, 'stale-write', `${instance} ${why}`);
    if (s.ws) {
      send(s.ws, { t: 'error', error: 'This character is now playing somewhere else.', fatal: true, code: 'stale' });
      s.ws.close(4001, 'stale');
    }
    remove(s);
  }

  /** Takes a character out of the shared world (their wisps and private loot leave with them). */
  function remove(s: Session) {
    s.world.removePlayer(s.playerId);
    sessions.delete(s.key);
    closeIfEmpty(s.zoneId);
  }

  /** Player fields that aren't saved but should survive walking into another zone. */
  const CARRIED = ['prayers', 'facing', 'attackTimer', 'eatTimer', 'combatTimer', 'regenTimer', 'stunTimer', 'darkWarned'] as const;

  /**
   * Hands a character over to another zone (3A.8): out of one world with their own wisps and loot,
   * into the other through the save path, in one synchronous step (so never in both, never in
   * neither), then saved. Their client gets a full state of the new zone.
   */
  function transfer(s: Session, to: ZoneId) {
    const from = s.world;
    const fromId = s.zoneId;
    const old = s.player;
    const record = from.act(old, () => from.characterRecord());
    const left = from.removePlayer(s.playerId)!;
    const target = openZone(to);
    const p = target.addPlayer({ playerId: s.playerId, save: mergeSave({ character: record, zone: left.zone }), worldItems: true });
    for (const k of CARRIED) (p as unknown as Record<string, unknown>)[k] = (old as unknown as Record<string, unknown>)[k];
    s.player = p;
    s.world = target;
    s.zoneId = to;
    s.lastTransfer = clock();
    closeIfEmpty(fromId);
    if (s.ws) {
      s.lastState = stateFor(s);
      send(s.ws, { t: 'zone', zone: to, state: s.lastState }, s);
    }
    save(s, 'transfer');
  }

  /** Saves and unloads a character, giving up its lease. */
  function unload(s: Session, why: string) {
    s.saveFailed = false;
    const saved = save(s, why);
    // Never leave the world unsaved: a failed save keeps them here (disconnected) to retry.
    if (s.saveFailed) {
      s.disconnectedAt = clock() - graceMs + 1000;
      return;
    }
    if (saved && s.characterId !== null) repos.releaseLease(s.characterId, s.epoch);
    if (sessions.get(s.key) === s) remove(s);
  }

  function logout(s: Session, token: string | null) {
    if (token) repos.revokeSession(token);
    if (s.accountId !== null) repos.audit(s.accountId, 'logout');
    const ws = s.ws;
    s.ws = null;
    if (s.accountId !== null) unload(s, 'logout');
    // 3B.1: a guest who signs out leaves the world (they used to stay in it for good).
    else remove(s);
    ws?.close(1000, 'logout');
    log(`${s.name} signed out`);
  }

  /**
   * Replaces a signed-in character with an imported browser save (once per account and per save),
   * saving it straight away with the import record, then welcomes the client to the new world.
   */
  function importSave(s: Session, raw: Record<string, unknown>) {
    const fail = (error: string) => send(s.ws, { t: 'error', error, code: 'import' });
    if (s.accountId === null || s.characterId === null) return fail('Sign in to an account to bring a character over.');
    if (repos.importBlocked(s.accountId, '') === 'account') return fail('This account has already brought a character over.');
    if (clock() - s.lastImportTry < 5000) return fail('Please wait a moment before trying again.');
    s.lastImportTry = clock();
    const prepared = prepareImport(raw, { map, clock, playerId: s.playerId, name: s.name, current: s.world.act(s.player, () => s.world.characterRecord()), policy: opts.importPolicy ?? 'full' });
    if (!prepared.ok) return fail(prepared.error);
    const blocked = repos.importBlocked(s.accountId, prepared.hash);
    if (blocked) return fail(blocked === 'account' ? 'This account has already brought a character over.' : 'That save has already been brought over to an account.');
    try {
      s.version = repos.importCharacter(s.characterId, s.accountId, s.epoch, s.version, prepared.record, {}, prepared.hash, prepared.report);
    } catch (err) {
      if (err instanceof StaleWriteError) return dropStale(s, 'import', err);
      throw err;
    }
    // The old character leaves the world and the imported one takes its place.
    // (If the imported character stands in another zone, the next tick hands them over.)
    s.world.removePlayer(s.playerId);
    s.player = s.world.addPlayer({ playerId: s.playerId, save: mergeSave({ character: prepared.record }) });
    s.lastSaved = persisted(s);
    s.events = [];
    log(`${s.name} imported a browser save (${prepared.report.length} changes)`);
    const ws = s.ws!;
    send(ws, { t: 'imported', report: prepared.report });
    bind(s, ws);
  }

  function handle(s: Session, msg: ClientMessage) {
    switch (msg.t) {
      case 'cmd':
        if (DEVICE_LOCAL.has(msg.cmd.type)) return;
        // Movement by joystick arrives as numbered inputs, not commands.
        if (msg.cmd.type === 'joystick') return;
        // 3B.1: commands can start pathfinding, so they have their own (lower) rate.
        if (s.cmdTokens < 1) return;
        s.cmdTokens--;
        if (msg.cmd.type === 'tradeRequest') {
          // Trades are saved to both accounts as they happen, so guests (never saved) can't trade.
          const other = sessionOf(msg.cmd.target);
          if (s.accountId === null) return notice(s, 'Guests can’t trade. Create an account to trade.', 'warn');
          if (other && other.accountId === null) return notice(s, `${other.name} is a guest and can’t trade.`, 'warn');
        }
        s.world.issueFor(s.playerId, msg.cmd);
        return;
      case 'chat':
        return chat(s, msg.channel, msg.text, msg.to);
      case 'gx':
        return exchange(s, msg.req);
      case 'admin':
        return admin(s, msg.cmd);
      case 'gxGuide':
        if (live && gxGuides.take(s.accountId === null ? s.key : liveAccount(s.accountId))) send(s.ws, { t: 'gxGuide', item: msg.item, guide: live.guide(msg.item) }, s);
        return;
      case 'gxOpen':
        if (live && s.accountId !== null) send(s.ws, { t: 'gxState', state: live.view(liveAccount(s.accountId)) }, s);
        return;
      case 'block': {
        const name = msg.name.trim();
        if (!USERNAME.test(name) && !GUEST_NAME.test(name)) return notice(s, 'That isn’t a player’s name.', 'warn');
        if (name.toLowerCase() === s.name.toLowerCase()) return notice(s, 'You can’t block yourself.', 'warn');
        if (msg.on && !s.blocked.has(name.toLowerCase()) && s.blocked.size >= MAX_BLOCKED) return notice(s, `You can block up to ${MAX_BLOCKED} players.`, 'warn');
        if (msg.on) s.blocked.add(name.toLowerCase());
        else s.blocked.delete(name.toLowerCase());
        if (s.accountId !== null) repos.setBlocked(s.accountId, name.toLowerCase(), msg.on);
        send(s.ws, { t: 'social', blocked: [...s.blocked] }, s);
        return notice(s, msg.on ? `You won’t hear from ${name} any more.` : `You can hear from ${name} again.`);
      }
      case 'report': {
        if (s.accountId === null) return notice(s, 'Sign in to an account to report a player.', 'warn');
        if (clock() - s.lastReport < 10_000) return notice(s, 'Please wait a moment before sending another report.', 'warn');
        s.lastReport = clock();
        const said = s.heard.filter((h) => h.from.toLowerCase() === msg.name.toLowerCase()).map((h) => h.text);
        repos.report(s.accountId, msg.name, msg.reason, said);
        log(`${s.name} reported ${msg.name}`);
        return notice(s, `Thank you. Your report about ${msg.name} has been sent to the moderators.`, 'good');
      }
      case 'input':
        if (msg.seq <= s.lastSeq) return;
        s.lastSeq = msg.seq;
        s.inputs.push({ seq: msg.seq, dx: msg.dx, dz: msg.dz });
        return;
      case 'ping':
        send(s.ws, { t: 'pong', at: msg.at });
        return;
      default:
        return;
    }
  }

  /**
   * One live Exchange request. The engine and the character's bank and bag change together and are
   * saved together; the player gets the result and their new view, and anyone whose offer it filled
   * gets theirs.
   */
  function exchange(s: Session, req: LiveIntent) {
    if (!live) return notice(s, 'The live Exchange isn’t open on this server.', 'warn');
    // Trades in a result never name the other side's account.
    const reply = (result: LiveResult) =>
      send(s.ws, { t: 'gxResult', nonce: req.nonce, result: result.ok && result.trades ? { ...result, trades: result.trades.map((t) => ({ ...t, buyer: t.buyer === account ? t.buyer : '', seller: t.seller === account ? t.seller : '' })) } : result }, s);
    const account = s.accountId === null ? '' : liveAccount(s.accountId);
    if (s.accountId === null || s.characterId === null) return reply({ ok: false, error: 'Sign in to an account to trade on the Exchange.' });
    if (!s.world.act(s.player, () => s.world.activeClerk())) return reply({ ok: false, error: 'You need to be at an Exchange clerk to do that.' });
    if (s.world.trades.trading(s.playerId)) return reply({ ok: false, error: 'Finish or decline your trade first.' });
    // Safeguards (3B.3): per-account pace (kept across reconnects), then the offer rules.
    if (!gxRequests.take(account)) {
      repos.flagExchange([{ account, kind: 'rate-limited', detail: `${req.op} refused: over ${policy.requestsPerMinute} a minute` }]);
      return reply({ ok: false, error: 'You are using the Exchange too quickly. Wait a moment and try again.' });
    }
    const refused = checkOffer(policy, live.x, req, clock() - repos.accountCreated(s.accountId));
    if (refused) {
      if (req.op === 'place') repos.flagExchange([{ account, kind: 'refused', detail: `${req.side} ${req.qty} ${req.item} @ ${req.price}: ${refused}` }]);
      return reply({ ok: false, error: refused });
    }
    const guideBefore = req.op === 'place' ? live.guide(req.item) : null;
    const result = live.handle(account, s.player, req, () => {
      const json = persisted(s);
      const [record, zoneState] = JSON.parse(json);
      const { audit, trades } = live.unsaved();
      s.version = repos.commitExchange(live.toJSON(), audit, trades, { characterId: s.characterId!, epoch: s.epoch, version: s.version, record, zone: zoneState })!;
      s.lastSaved = json;
    });
    reply(result);
    if (result.ok && !result.replayed) {
      const flags = watch.observe(account, req, result.trades ?? [], guideBefore);
      if (flags.length) repos.flagExchange(flags);
    }
    send(s.ws, { t: 'gxState', state: live.view(account) }, s);
    for (const other of live.counterparts(account, result)) {
      const o = sessions.get(other);
      if (o?.ws) {
        send(o.ws, { t: 'gxState', state: live.view(other) }, o);
        notice(o, 'One of your Exchange offers has been filled. Visit a clerk to collect.', 'good');
      }
    }
  }

  /**
   * Moderation (3B.2). The role is read from the database on every command, so taking it away works
   * at once. Moderators: who, kick, mute, reports. Admins: also bans, the word filter and the audit
   * log. Every command is logged, including refused ones.
   */
  function admin(s: Session, cmd: AdminCommand) {
    const role = s.accountId === null ? 'player' : repos.role(s.accountId);
    const actor = `${s.name}#${s.accountId ?? 'guest'}`;
    const answer = (ok: boolean, lines: string[], data?: unknown) => send(s.ws, { t: 'admin', ok, lines, ...(data === undefined ? {} : { data }) }, s);
    const allowed = role === 'admin' || (role === 'moderator' && MODERATOR_OPS.has(cmd.op));
    const target = 'name' in cmd ? cmd.name : 'id' in cmd ? String(cmd.id) : '';
    // (Plain players trying commands aren't logged: they could otherwise flood the log.)
    if (role !== 'player') repos.adminAudit(actor, allowed ? cmd.op : `denied:${cmd.op}`, target, JSON.stringify(cmd).slice(0, 300));
    if (!allowed) return answer(false, [role === 'player' ? 'Unknown command.' : 'You don’t have permission for that.']);
    // Moderators can't act on moderators or admins (3B.1).
    if ('name' in cmd && role !== 'admin') {
      const a = repos.findAccount(cmd.name);
      if (a && repos.role(a.id) !== 'player') return answer(false, ['Only an admin can do that to a moderator or admin.']);
    }
    const online = (name: string) => [...sessions.values()].find((x) => x.name.toLowerCase() === name.toLowerCase());
    const account = (name: string) => repos.findAccount(name);
    switch (cmd.op) {
      case 'who': {
        const list = [...sessions.values()].map((x) => ({ name: x.name, zone: x.zoneId, guest: x.accountId === null, online: !!x.ws }));
        return answer(true, [`${list.length} in the world:`, ...list.map((x) => `${x.name}${x.guest ? ' (guest)' : ''} · ${x.zone}${x.online ? '' : ' · reconnecting'}`)], list);
      }
      case 'kick': {
        const t = online(cmd.name);
        if (!t) return answer(false, [`${cmd.name} isn’t in the world.`]);
        kick(t, `You were removed from the world by a moderator${cmd.reason ? `: ${cmd.reason}` : '.'}`, 'kicked');
        return answer(true, [`${t.name} was kicked.`]);
      }
      case 'mute':
      case 'unmute': {
        const until = cmd.op === 'mute' ? clock() + cmd.minutes * 60_000 : 0;
        const t = online(cmd.name);
        const a = account(cmd.name);
        if (!t && !a) return answer(false, [`No player called ${cmd.name}.`]);
        if (t) t.mutedUntil = until;
        if (a) repos.mute(a.id, until, actor);
        if (t && cmd.op === 'mute') notice(t, `You have been muted for ${cmd.minutes} minutes${cmd.reason ? `: ${cmd.reason}` : '.'}`, 'warn');
        return answer(true, [cmd.op === 'mute' ? `${cmd.name} is muted for ${cmd.minutes} minutes.` : `${cmd.name} can chat again.`]);
      }
      case 'ban': {
        const a = account(cmd.name);
        if (!a) return answer(false, [`No account called ${cmd.name}.`]);
        if (repos.role(a.id) === 'admin') return answer(false, ['Admins can’t be banned from here (use the local admin tool).']);
        const until = cmd.minutes === null ? null : clock() + cmd.minutes * 60_000;
        repos.ban(a.id, until, cmd.reason, actor);
        const t = online(cmd.name);
        if (t) kick(t, `This account has been banned${until ? ` until ${new Date(until).toUTCString()}` : ''}${cmd.reason ? `: ${cmd.reason}` : '.'}`, 'banned');
        return answer(true, [`${a.username} is banned ${until ? `until ${new Date(until).toUTCString()}` : 'permanently'}.`]);
      }
      case 'unban': {
        const a = account(cmd.name);
        if (!a) return answer(false, [`No account called ${cmd.name}.`]);
        const n = repos.unban(a.id, actor);
        return answer(n > 0, [n ? `${a.username} is no longer banned.` : `${a.username} wasn’t banned.`]);
      }
      case 'reports': {
        const list = repos.reportList(cmd.status);
        return answer(true, list.length ? list.map((r) => `#${r.id} ${r.status} · ${r.reporter} reported ${r.target}: ${r.reason}${r.context.length ? ` · said: “${r.context.slice(-3).join('” “')}”` : ''}${r.resolution ? ` · ${r.resolution}` : ''}`) : ['No reports.'], list);
      }
      case 'resolve':
        return repos.resolveReport(cmd.id, cmd.resolution, actor) ? answer(true, [`Report #${cmd.id} resolved.`]) : answer(false, [`No open report #${cmd.id}.`]);
      case 'filter': {
        if (cmd.action !== 'list') {
          repos.setFilterWord(filterForm(cmd.word!), cmd.action === 'add', actor);
          chatFilter = repos.filterWords();
        }
        return answer(true, [chatFilter.length ? `Filtered (besides the built-in list): ${chatFilter.join(', ')}` : 'No extra filtered words.'], chatFilter);
      }
      case 'flags': {
        const flags = repos.exchangeFlags(cmd.limit);
        return answer(true, flags.length ? flags.map((f) => `${new Date(f.at).toISOString().slice(0, 16)} ${f.kind} ${f.account}: ${f.detail}`) : ['No flags.'], flags);
      }
      case 'exchange': {
        if (!live) return answer(false, ['The live Exchange is switched off on this server.']);
        if (cmd.action === 'freeze') live.freeze(`frozen by ${actor}${cmd.reason ? `: ${cmd.reason}` : ''}`);
        if (cmd.action === 'unfreeze') {
          const problems = live.x.verify();
          if (problems.length) return answer(false, [`Still failing its checks: ${problems.join('; ')}`]);
          live.unfreeze();
        }
        return answer(true, [live.frozen ? `The live Exchange is closed: ${live.frozen}` : 'The live Exchange is open; its books balance.'], { frozen: live.frozen });
      }
      case 'audit': {
        const log = repos.adminLog(cmd.limit);
        return answer(true, log.map((e) => `${new Date(e.at).toISOString().slice(0, 16)} ${e.actor} ${e.action} ${e.target}`), log);
      }
    }
  }

  /** Removes a character from the world at once (saved first), telling their client why. */
  function kick(t: Session, why: string, code: ErrorCode) {
    const ws = t.ws;
    t.ws = null;
    if (ws) {
      send(ws, { t: 'error', error: why, fatal: true, code });
      ws.close(4003, code);
    }
    if (t.accountId !== null) unload(t, code);
    else remove(t);
    log(`${t.name} ${code}`);
  }

  function sessionOf(playerId: PlayerId): Session | undefined {
    for (const x of sessions.values()) if (x.playerId === playerId) return x;
    return undefined;
  }

  function notice(s: Session, text: string, tone: 'info' | 'warn' | 'good' = 'info') {
    send(s.ws, { t: 'notice', text, tone }, s);
  }

  /** Delivers a chat message to whoever should hear it (nobody who has blocked the speaker). */
  function chat(s: Session, channel: 'local' | 'private', raw: string, to?: string) {
    const muted = Math.max(s.mutedUntil, s.accountId === null ? 0 : repos.mutedUntil(s.accountId));
    if (muted > clock()) return notice(s, `You are muted until ${new Date(muted).toUTCString()}.`, 'warn');
    const clean = cleanChat(raw, chatFilter);
    if ('error' in clean) return notice(s, clean.error, 'warn');
    const slow = s.pace.take(clean.text);
    if (slow) return notice(s, slow, 'warn');
    const deliver = (r: Session, msg: ServerMessage) => {
      send(r.ws, msg, r);
      if (r !== s) {
        r.heard.push({ from: s.name, text: clean.text });
        if (r.heard.length > CHAT_HEARD) r.heard.shift();
      }
    };
    if (channel === 'local') {
      for (const r of sessions.values()) {
        if (!r.ws || r.zoneId !== s.zoneId || r.blocked.has(s.name.toLowerCase())) continue;
        if (Math.abs(r.player.x - s.player.x) > CHAT_RADIUS || Math.abs(r.player.z - s.player.z) > CHAT_RADIUS) continue;
        deliver(r, { t: 'chat', channel, from: s.name, text: clean.text });
      }
      return;
    }
    const target = [...sessions.values()].find((r) => r.ws && r.name.toLowerCase() === to!.trim().toLowerCase());
    // Someone who has blocked you looks the same as someone who is away.
    if (!target || target.blocked.has(s.name.toLowerCase())) return notice(s, `${to!.trim()} isn’t online.`, 'warn');
    if (target === s) return notice(s, 'You can’t message yourself.', 'warn');
    deliver(target, { t: 'chat', channel, from: s.name, text: clean.text });
    send(s.ws, { t: 'chat', channel, from: s.name, to: target.name, text: clean.text }, s);
  }

  /**
   * A finished trade is saved for both players, with its ledger rows, in one transaction before
   * either is told. If that fails, the simulation undoes the swap (src/sim/trade.ts).
   */
  function commitTrade(c: TradeCommit) {
    const a = sessionOf(c.a);
    const b = sessionOf(c.b);
    if (!a || !b || a.characterId === null || b.characterId === null) throw new Error('trade between unsaved characters');
    const ref = `trade-${randomBytes(8).toString('hex')}`;
    const parts = [a, b].map((x) => ({ s: x, json: persisted(x) }));
    const moves = [
      ...c.aGave.map((m) => ({ from: a.characterId!, to: b.characterId!, item: m.item, qty: m.qty })),
      ...c.bGave.map((m) => ({ from: b.characterId!, to: a.characterId!, item: m.item, qty: m.qty })),
    ];
    try {
      const versions = repos.commitTrade(
        ref,
        parts.map(({ s: x, json }) => {
          const [record, zoneState] = JSON.parse(json);
          return { characterId: x.characterId!, epoch: x.epoch, version: x.version, record, zone: zoneState };
        }),
        moves,
      );
      parts.forEach(({ s: x, json }, i) => {
        x.version = versions[i];
        x.lastSaved = json;
      });
    } catch (err) {
      log(`trade ${ref} between ${a.name} and ${b.name} refused: ${(err as Error).message}`);
      throw err;
    }
    repos.audit(a.accountId, 'trade', `${ref} with ${b.name}`);
    repos.audit(b.accountId, 'trade', `${ref} with ${a.name}`);
    log(`${a.name} and ${b.name} traded (${ref}, ${moves.length} stacks)`);
  }

  /** Applies at most one movement input for a session this tick. */
  function applyInput(s: Session) {
    const w = s.world;
    if (s.inputs.length > MAX_INPUT_QUEUE) {
      const dropped = s.inputs.splice(0, s.inputs.length - MAX_INPUT_QUEUE);
      s.ack = dropped[dropped.length - 1].seq;
    }
    const inp = s.inputs.shift();
    if (inp) {
      w.issueFor(s.playerId, { type: 'joystick', dx: inp.dx, dz: inp.dz });
      s.ack = inp.seq;
      s.holding = 0;
      s.joyActive = Math.hypot(inp.dx, inp.dz) > 0.15;
    } else if (s.joyActive && ++s.holding > INPUT_HOLD_TICKS) {
      w.issueFor(s.playerId, { type: 'joystick', dx: 0, dz: 0 });
      s.joyActive = false;
    }
  }

  /** Sends each event to the players who should see it (docs/MULTIPLAYER.md 3A.5). */
  /** Delivers a zone's events this tick to the players in that zone who should see them. */
  function routeTickEvents(zoneId: ZoneId, world: GameWorld) {
    const events = world.drainEventsWithActors().filter((e) => !SERVER_ONLY_EVENTS.has(e.event.type));
    if (!events.length) return;
    // A dungeon chest was opened (Phase 4D): save that character at once, so a crash or restart
    // can't roll back the claim it used (and the rewards and collection log it earned) separately.
    for (const e of events) {
      if (e.event.type !== 'chest') continue;
      const s = [...sessions.values()].find((x) => x.playerId === e.actor && x.zoneId === zoneId);
      if (s) save(s, 'chest');
    }
    const byPlayer = new Map<PlayerId, Session>();
    for (const s of sessions.values()) if (s.ws && s.zoneId === zoneId) byPlayer.set(s.playerId, s);
    for (const { event, audience } of routeEvents(world, events)) {
      if (audience.kind === 'self') byPlayer.get(audience.player)?.events.push(event);
      else
        for (const s of byPlayer.values()) {
          if (audience.kind === 'zone' || (Math.abs(s.player.x - audience.x) <= INTEREST_RADIUS && Math.abs(s.player.z - audience.z) <= INTEREST_RADIUS)) s.events.push(event);
        }
    }
  }

  function snapshot(s: Session) {
    const character = s.world.act(s.player, () => s.world.characterRecord());
    const json = characterKey(character);
    const changed = json !== s.lastCharacter;
    if (changed) s.lastCharacter = json;
    const state = limitMoves(s.lastState!, stateFor(s), MOVES_PER_SNAPSHOT);
    const delta = diffState(s.lastState!, state);
    s.lastState = state;
    send(s.ws, { t: 'state', delta, events: s.events, ...(changed ? { character } : {}) }, s);
    s.events = [];
  }

  // Fixed 30 Hz simulation of the shared world; snapshots at SNAPSHOT_HZ. Characters stay in the
  // world through a short grace period after a disconnect (no escaping a fight by pulling the
  // plug), then are saved (guests: discarded) and taken out.
  let last = performance.now();
  let acc = 0;
  let sinceSave = 0;
  let sinceCheck = 0;
  const integrityIntervalMs = opts.integrityIntervalMs ?? 60_000;
  const every = Math.round(1 / TICK_SECONDS / SNAPSHOT_HZ);
  const timer = setInterval(() => {
    const now = performance.now();
    const elapsed = Math.min(0.25, (now - last) / 1000);
    acc += elapsed;
    last = now;
    while (acc >= TICK_SECONDS) {
      acc -= TICK_SECONDS;
      tick++;
      const started = performance.now();
      for (const s of [...sessions.values()]) {
        if (!s.ws) {
          if (s.disconnectedAt !== null && clock() - s.disconnectedAt > graceMs) {
            if (s.accountId === null) remove(s);
            else unload(s, 'grace');
            log(`${s.name} left the world after the grace period`);
          }
          continue;
        }
        s.tokens = Math.min(MESSAGE_RATE, s.tokens + MESSAGE_RATE * TICK_SECONDS);
        s.cmdTokens = Math.min(COMMAND_RATE, s.cmdTokens + COMMAND_RATE * TICK_SECONDS);
        applyInput(s);
      }
      for (const [id, w] of [...zones]) {
        // 3B.1: a fault in one zone is logged and doesn't stop the others (or the server).
        try {
          w.tick(TICK_SECONDS);
          routeTickEvents(id, w);
        } catch (err) {
          log(`error in zone ${id}: ${(err as Error).stack ?? err}`);
        }
      }
      // Anyone now standing in another zone's area (through a passage or a door) moves over, at
      // most once a second each (stepping back and forth on a threshold can't cost a save a tick).
      for (const s of [...sessions.values()]) {
        const to = zoneFor(s.player.x, s.player.z, s.playerId);
        if (to === s.zoneId || clock() - s.lastTransfer < limits.transferCooldownMs) continue;
        try {
          transfer(s, to);
        } catch (err) {
          log(`error moving ${s.name} to ${to}: ${(err as Error).stack ?? err}`);
        }
      }
      if (tick % every === 0)
        for (const s of sessions.values()) {
          if (!s.ws) continue;
          try {
            snapshot(s);
          } catch (err) {
            log(`error sending ${s.name} a snapshot: ${(err as Error).stack ?? err}`);
          }
        }
      const took = performance.now() - started;
      stats.ticks++;
      stats.tickMsTotal += took;
      stats.tickMsMax = Math.max(stats.tickMsMax, took);
    }
    sinceSave += elapsed * 1000;
    sinceCheck += elapsed * 1000;
    if (live && sinceCheck >= integrityIntervalMs) {
      sinceCheck = 0;
      if (!live.frozen) live.checkIntegrity(repos.lastExchangeHash());
    }
    if (sinceSave >= saveIntervalMs) {
      sinceSave = 0;
      try {
        saveAll();
      } catch (err) {
        log(`periodic save failed: ${(err as Error).stack ?? err}`);
      }
    }
  }, 1000 * TICK_SECONDS);

  function saveAll() {
    for (const s of [...sessions.values()]) save(s, 'periodic');
  }

  log(`listening on ws://${host}:${port} (content ${content}${opts.allowGuests ? ', guests allowed' : ''})`);
  return {
    port,
    sessions,
    zone,
    zones,
    repos,
    stats,
    live,
    saveAll,
    mute: (name: string, minutes: number) => {
      const until = clock() + minutes * 60_000;
      const online = [...sessions.values()].find((x) => x.name.toLowerCase() === name.toLowerCase());
      const account = repos.findAccount(name);
      if (online) online.mutedUntil = until;
      if (account) repos.mute(account.id, until, 'server');
      return !!(online || account);
    },
    close: ({ save: doSave = true } = {}) =>
      new Promise<void>((resolve) => {
        clearInterval(timer);
        clearInterval(heartbeat);
        if (doSave) for (const s of [...sessions.values()]) if (s.accountId !== null) unload(s, 'shutdown');
        for (const c of wss.clients) c.terminate();
        wss.close(() => {
          db.close();
          resolve();
        });
      }),
  };
}
