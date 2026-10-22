import { randomBytes } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { GameWorld, TICK_SECONDS, type Appearance, type GameEvent, type PlayerId } from '../src/sim/world';
import { generateWorld, type WorldMap } from '../src/sim/worldmap';
import { mergeSave } from '../src/sim/records';
import { captureState } from '../src/net/replica';
import { GUEST_NAME, MAX_IMPORT_MESSAGE, PROTOCOL_VERSION, SNAPSHOT_HZ, contentVersion, parseClientMessage, type Auth, type ClientMessage, type ErrorCode, type ServerMessage } from '../src/net/protocol';
import { openDatabase } from './db';
import { RateLimiter, USERNAME, hashPassword, passwordProblem, verifyPassword } from './auth';
import { Repos, StaleWriteError } from './repo';
import { prepareImport, type ImportPolicy } from './import';

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
  repos: Repos;
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
const MAX_STRIKES = 20;
/** Commands for the practice market are handled on the device; the server ignores them. */
const DEVICE_LOCAL = new Set(['exchange', 'exchangeResetPractice']);
/** Events about the server's own (unused) practice market are not sent. */
const SERVER_ONLY_EVENTS = new Set<GameEvent['type']>(['exchange', 'exchangeResult']);

export interface Session {
  key: string;
  name: string;
  playerId: PlayerId;
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
  strikes: number;
  tokens: number;
  lastImportTry: number;
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
  // Sign-in limits: per account name and per network address.
  const accountFails = new RateLimiter(5, 5 * 60_000, clock);
  const addressFails = new RateLimiter(30, 5 * 60_000, clock);
  const registrations = new RateLimiter(5, 60 * 60_000, clock);
  // A real hash to compare against when the account doesn't exist (so timing doesn't reveal names).
  const dummyHash = await hashPassword(randomBytes(12).toString('hex'));
  let nextGuestId = 1_500_000_000;
  let tick = 0;

  const host = opts.host ?? '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) log('WARNING: listening beyond this machine without TLS. Development use only.');
  const wss = new WebSocketServer({ port: opts.port ?? 8787, host, maxPayload: MAX_IMPORT_MESSAGE });
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
  const address = wss.address();
  const port = typeof address === 'object' && address ? address.port : opts.port ?? 8787;

  const send = (ws: WebSocket | null, msg: ServerMessage) => {
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const refuse = (ws: WebSocket, error: string, code: ErrorCode) => {
    send(ws, { t: 'error', error, code, fatal: true });
    ws.close(1008, code);
  };

  wss.on('connection', (ws, req) => {
    const addr = req.socket.remoteAddress ?? 'unknown';
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
      if (isBinary) return strike('Binary messages are not accepted.');
      const msg = parseClientMessage(data.toString(), { allowImport: session?.accountId != null && session.ws === ws });
      if (!msg) return strike('Invalid message.');
      if (!session) {
        if (joining) return;
        if (msg.t !== 'hello') return strike('Say hello first.');
        joining = true;
        clearTimeout(helloTimer);
        signIn(ws, addr, msg)
          .then((r) => {
            joining = false;
            if (r) ({ session, token } = r);
          })
          .catch((err) => {
            joining = false;
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
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (session && session.ws === ws) {
        session.ws = null;
        session.disconnectedAt = clock();
        session.inputs = [];
        session.world.issueFor(session.playerId, { type: 'joystick', dx: 0, dz: 0 });
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
      return { session: attachGuest(ws, auth.name, auth.appearance), token: null };
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
      const hash = await hashPassword(auth.password);
      const record = new GameWorld({ name: auth.username, appearance: auth.appearance, map, clock }).characterRecord();
      const made = repos.createAccount(auth.username, hash, record, {});
      if (!made) return no('That name is taken. Try another.', 'taken');
      registrations.fail(addr);
      accountId = made.account.id;
      issued = token = repos.createSession(accountId);
      log(`new account ${auth.username}`);
    } else if (auth.kind === 'login') {
      const key = auth.username.toLowerCase();
      if (accountFails.blocked(key)) {
        repos.audit(repos.findAccount(auth.username)?.id ?? null, 'login-locked', auth.username);
        return no('Too many wrong passwords for this name. Try again in a few minutes.', 'locked');
      }
      const account = repos.findAccount(auth.username);
      const ok = await verifyPassword(auth.password, account?.password ?? dummyHash);
      if (!account || !ok) {
        accountFails.fail(key);
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
    return { session: attachAccount(ws, accountId, issued), token };
  }

  function attachGuest(ws: WebSocket, name: string, appearance?: Appearance): Session {
    const key = `guest:${name.toLowerCase()}`;
    let s = sessions.get(key);
    if (!s) {
      const playerId = nextGuestId++;
      const world = new GameWorld({ name, appearance, playerId, map, clock });
      s = newSession(key, name, playerId, world, null, null, 0, 0);
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
      const world = new GameWorld({ save: mergeSave({ character: leased.record, zone: leased.zone }), playerId: leased.playerId, map, clock });
      s = newSession(key, leased.name, leased.playerId, world, accountId, leased.id, leased.leaseEpoch, leased.version);
      s.lastSaved = persisted(s);
      sessions.set(key, s);
      log(`${s.name} signed in`);
    }
    repos.audit(accountId, 'login', instance);
    bind(s, ws, issued);
    return s;
  }

  function newSession(key: string, name: string, playerId: PlayerId, world: GameWorld, accountId: number | null, characterId: number | null, epoch: number, version: number): Session {
    return { key, name, playerId, world, ws: null, accountId, characterId, epoch, version, lastSaved: '', disconnectedAt: null, inputs: [], lastSeq: 0, ack: 0, holding: 0, joyActive: false, events: [], lastCharacter: '', strikes: 0, tokens: MESSAGE_RATE, lastImportTry: 0 };
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
    s.world.drainEvents();
    const character = s.world.characterRecord();
    s.lastCharacter = JSON.stringify(character);
    send(ws, { t: 'welcome', v: PROTOCOL_VERSION, playerId: s.playerId, character, state: captureState(s.world, tick, s.ack), ...(issued ? { session: issued } : {}) });
  }

  const persisted = (s: Session) => JSON.stringify([s.world.characterRecord(), s.world.zoneState()]);

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
      if (!(err instanceof StaleWriteError)) throw err;
      dropStale(s, why, err);
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
    sessions.delete(s.key);
  }

  /** Saves and unloads a character, giving up its lease. */
  function unload(s: Session, why: string) {
    if (save(s, why) && s.characterId !== null) repos.releaseLease(s.characterId, s.epoch);
    sessions.delete(s.key);
  }

  function logout(s: Session, token: string | null) {
    if (token) repos.revokeSession(token);
    if (s.accountId !== null) repos.audit(s.accountId, 'logout');
    const ws = s.ws;
    s.ws = null;
    if (s.accountId !== null) unload(s, 'logout');
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
    const prepared = prepareImport(raw, { map, clock, playerId: s.playerId, name: s.name, current: s.world.characterRecord(), policy: opts.importPolicy ?? 'full' });
    if (!prepared.ok) return fail(prepared.error);
    const blocked = repos.importBlocked(s.accountId, prepared.hash);
    if (blocked) return fail(blocked === 'account' ? 'This account has already brought a character over.' : 'That save has already been brought over to an account.');
    try {
      s.version = repos.importCharacter(s.characterId, s.accountId, s.epoch, s.version, prepared.record, {}, prepared.hash, prepared.report);
    } catch (err) {
      if (err instanceof StaleWriteError) return dropStale(s, 'import', err);
      throw err;
    }
    s.world = prepared.world;
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
        s.world.issueFor(s.playerId, msg.cmd);
        return;
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

  /** One server tick for one session: apply at most one movement input, then step the world. */
  function step(s: Session) {
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
    w.tick(TICK_SECONDS);
    for (const e of w.drainEvents()) if (!SERVER_ONLY_EVENTS.has(e.type)) s.events.push(e);
  }

  function snapshot(s: Session) {
    const character = s.world.characterRecord();
    const json = JSON.stringify(character);
    const changed = json !== s.lastCharacter;
    if (changed) s.lastCharacter = json;
    send(s.ws, { t: 'state', state: captureState(s.world, tick, s.ack), events: s.events, ...(changed ? { character } : {}) });
    s.events = [];
  }

  // Fixed 30 Hz simulation; snapshots at SNAPSHOT_HZ. Signed-in characters keep playing through a
  // short grace period after a disconnect (no escaping a fight by pulling the plug), then are saved
  // and unloaded. Guests (development only) are paused instead.
  let last = performance.now();
  let acc = 0;
  let sinceSave = 0;
  const every = Math.round(1 / TICK_SECONDS / SNAPSHOT_HZ);
  const timer = setInterval(() => {
    const now = performance.now();
    const elapsed = Math.min(0.25, (now - last) / 1000);
    acc += elapsed;
    last = now;
    while (acc >= TICK_SECONDS) {
      acc -= TICK_SECONDS;
      tick++;
      for (const s of [...sessions.values()]) {
        if (!s.ws) {
          if (s.accountId === null) continue;
          if (s.disconnectedAt !== null && clock() - s.disconnectedAt > graceMs) {
            unload(s, 'grace');
            log(`${s.name} logged out after the grace period`);
            continue;
          }
        }
        if (s.ws) s.tokens = Math.min(MESSAGE_RATE, s.tokens + MESSAGE_RATE * TICK_SECONDS);
        step(s);
        if (s.ws && tick % every === 0) snapshot(s);
      }
    }
    sinceSave += elapsed * 1000;
    if (sinceSave >= saveIntervalMs) {
      sinceSave = 0;
      saveAll();
    }
  }, 1000 * TICK_SECONDS);

  function saveAll() {
    for (const s of [...sessions.values()]) save(s, 'periodic');
  }

  log(`listening on ws://${host}:${port} (content ${content}${opts.allowGuests ? ', guests allowed' : ''})`);
  return {
    port,
    sessions,
    repos,
    saveAll,
    close: ({ save: doSave = true } = {}) =>
      new Promise<void>((resolve) => {
        clearInterval(timer);
        if (doSave) for (const s of [...sessions.values()]) if (s.accountId !== null) unload(s, 'shutdown');
        for (const c of wss.clients) c.terminate();
        wss.close(() => {
          db.close();
          resolve();
        });
      }),
  };
}
