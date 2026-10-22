import { GameWorld, TICK_SECONDS, type Command, type GameEvent, type PlayerId } from '../sim/world';
import { patchState } from './delta';
import { mergeSave } from '../sim/records';
import { applyCharacter, applyState, type WorldState } from './replica';
import { PROTOCOL_VERSION, SNAPSHOT_HZ, contentVersion, type ChatChannel, type Auth, type ClientMessage, type ErrorCode, type ServerMessage } from './protocol';
import { generateWorld } from '../sim/worldmap';

/**
 * The client side of network play (docs/MULTIPLAYER.md 3A.2).
 *
 * Holds a replica `GameWorld` that the renderer and HUD read exactly as in local play, and keeps it
 * in step with the server:
 * - commands go to the server (except the practice market, which stays on the device);
 * - the local player's joystick movement is predicted every tick with the simulation's own movement
 *   code, sent as numbered inputs, and reconciled against the server's acknowledged position;
 * - other creatures and NPCs are shown slightly in the past, interpolated between snapshots.
 */

/** How far in the past other entities are shown (ms): about one and a half snapshot gaps. */
/** A chat message as received (`to`: a private message this player sent). */
export interface ChatLine {
  channel: ChatChannel;
  from: string;
  to?: string;
  text: string;
}

export const INTERP_DELAY_MS = 150;
const MAX_INTERP_DELAY_MS = 450;
/** A pause longer than this between positions means it stood still. */
const HOLD_GAP_MS = 600;
/** Commands handled on the device (the practice market never touches real wealth). */
const DEVICE_LOCAL = new Set<Command['type']>(['exchange', 'exchangeResetPractice']);

type Sample = { t: number; x: number; z: number };

export interface NetClientOptions {
  url: string;
  auth: Auth;
  /** Try to reconnect (with the session token) when the connection drops. */
  autoReconnect?: boolean;
  /** Testing: added one-way delay in ms for both directions (simulated latency). */
  latencyMs?: number;
  now?: () => number;
}

/** Reconnect attempts after a dropped connection, and the wait before each (ms). */
const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000];

export class NetClient {
  world: GameWorld | null = null;
  playerId: PlayerId | null = null;
  status: 'connecting' | 'ready' | 'reconnecting' | 'closed' = 'connecting';
  /** Why the connection ended (shown to the player), and the server's reason code if it gave one. */
  closeReason = '';
  errorCode: ErrorCode | null = null;
  /** The session token from a password sign-in (store it to sign in again without the password). */
  session: string | null = null;
  /** Largest single correction applied to the predicted position so far (tiles). */
  maxCorrection = 0;
  private ws: WebSocket | null = null;
  private fatal = false;
  private pendingImport: { resolve: (report: string[]) => void; reject: (err: Error) => void } | null = null;
  private quietWelcome = false;
  private attempts = 0;
  private events: GameEvent[] = [];
  private seq = 0;
  private pending: { seq: number; dx: number; dz: number }[] = [];
  private joy = { x: 0, z: 0 };
  private sentMoving = false;
  private acc = 0;
  private samples = new Map<number, Sample[]>();
  /** Chat received since the last `drainChat`, and the players this account has blocked. */
  private chat: ChatLine[] = [];
  blocked: string[] = [];
  /** The last full state, which the next delta changes. */
  private last: WorldState | null = null;
  private serverPos: { x: number; z: number } | null = null;
  private readonly now: () => number;
  /** The map, generated locally from the shared seed (the server checks it matches). */
  private readonly map = generateWorld(1337);

  constructor(private opts: NetClientOptions) {
    this.now = opts.now ?? (() => performance.now());
    if (opts.auth.kind === 'token') this.session = opts.auth.token;
  }

  /** Connects and resolves with the replica world once the server welcomes us. */
  connect(): Promise<GameWorld> {
    return this.open(this.opts.auth);
  }

  private open(auth: Auth): Promise<GameWorld> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.opts.url);
      this.ws = ws;
      ws.onopen = () => {
        this.post({ t: 'hello', v: PROTOCOL_VERSION, content: contentVersion(this.map), auth });
      };
      ws.onmessage = (ev) => {
        const run = () => {
          if (this.ws !== ws) return;
          const msg = JSON.parse(String(ev.data)) as ServerMessage;
          if (msg.t === 'welcome') resolve(this.welcome(msg));
          else this.receive(msg);
        };
        if (this.opts.latencyMs) setTimeout(run, this.opts.latencyMs);
        else run();
      };
      ws.onclose = (ev) => {
        if (this.ws !== ws) return;
        const wasReady = this.status === 'ready';
        this.closeReason ||= ev.reason || 'Disconnected from the server.';
        // A dropped connection (not a refusal) comes back by itself using the session.
        if (wasReady && !this.fatal && this.opts.autoReconnect && this.attempts < RECONNECT_DELAYS.length) {
          this.status = 'reconnecting';
          this.events.push({ type: 'message', text: 'Connection lost. Reconnecting…', tone: 'warn' });
          setTimeout(() => this.reconnect(), RECONNECT_DELAYS[this.attempts++]);
          return;
        }
        this.status = 'closed';
        if (!this.world || !wasReady) reject(new Error(this.closeReason));
      };
      ws.onerror = () => {
        this.closeReason ||= 'Could not reach the server.';
      };
    });
  }

  private reconnect() {
    const auth: Auth | null = this.session ? { kind: 'token', token: this.session } : this.opts.auth.kind === 'guest' ? this.opts.auth : null;
    if (!auth) {
      this.status = 'closed';
      return;
    }
    this.closeReason = '';
    this.open(auth).catch(() => {
      /* onclose schedules the next attempt or gives up */
    });
  }

  /**
   * Brings a browser-local save onto the signed-in account (once). Resolves with the server's report
   * of what changed on the way in; the replica is then refreshed from the server's fresh welcome.
   * The practice market and world state (ground piles, wisps) stay behind.
   */
  importSave(save: object): Promise<string[]> {
    const { exchangePractice: _p, ground: _g, graves: _w, ...rest } = save as Record<string, unknown>;
    return new Promise((resolve, reject) => {
      this.pendingImport = { resolve, reject };
      this.post({ t: 'import', save: rest });
    });
  }

  /** Signs out: the server saves the character and ends this session token. */
  logout() {
    this.fatal = true;
    this.post({ t: 'logout' });
    this.session = null;
  }

  close() {
    this.fatal = true;
    this.ws?.close();
  }

  private post(msg: ClientMessage) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const data = JSON.stringify(msg);
    if (this.opts.latencyMs) setTimeout(() => ws.readyState === WebSocket.OPEN && ws.send(data), this.opts.latencyMs);
    else ws.send(data);
  }

  private welcome(msg: Extract<ServerMessage, { t: 'welcome' }>): GameWorld {
    if (msg.session) this.session = msg.session;
    if (this.world && msg.playerId !== this.playerId) {
      // A different character answered (the server was reset): start over.
      this.fatal = true;
      this.closeReason = 'The server has a different character for you now. Reload to continue.';
      this.ws?.close();
      return this.world;
    }
    const reconnected = this.world !== null;
    this.playerId = msg.playerId;
    this.attempts = 0;
    if (!this.world) {
      // The replica: built from the server's character, on the locally generated map.
      this.world = new GameWorld({ save: mergeSave({ character: msg.character }), playerId: msg.playerId, map: this.map });
      this.world.drainEvents();
    } else applyCharacter(this.world, msg.character);
    this.last = msg.state;
    this.applySnapshot(msg.state, true);
    this.status = 'ready';
    if (!this.quietWelcome) this.events.push({ type: 'message', text: reconnected ? 'Reconnected.' : `Connected to the development server as ${this.world.player.name}.`, tone: 'good' });
    this.quietWelcome = false;
    return this.world;
  }

  private receive(msg: ServerMessage) {
    if (msg.t === 'imported') {
      this.pendingImport?.resolve(msg.report);
      this.pendingImport = null;
      this.quietWelcome = true;
      return;
    }
    if (msg.t === 'error' && msg.code === 'import' && this.pendingImport) {
      this.pendingImport.reject(new Error(msg.error));
      this.pendingImport = null;
      return;
    }
    if (msg.t === 'error') {
      this.events.push({ type: 'message', text: msg.error, tone: msg.fatal ? 'bad' : 'warn' });
      if (msg.fatal) {
        this.fatal = true;
        this.closeReason = msg.error;
        this.errorCode = msg.code ?? null;
      }
      return;
    }
    if (msg.t === 'chat') {
      this.chat.push({ channel: msg.channel, from: msg.from, to: msg.to, text: msg.text });
      return;
    }
    if (msg.t === 'social') {
      this.blocked = msg.blocked;
      return;
    }
    if (msg.t === 'notice') {
      this.events.push({ type: 'message', text: msg.text, tone: msg.tone ?? 'info' });
      return;
    }
    if (msg.t !== 'state' || !this.world || !this.last) return;
    if (msg.character) applyCharacter(this.world, msg.character);
    this.last = patchState(this.last, msg.delta);
    this.applySnapshot(this.last, false);
    this.events.push(...msg.events);
  }

  private applySnapshot(state: WorldState, snap: boolean) {
    const w = this.world!;
    applyState(w, state);
    const t = this.now();
    const record = (id: number, x: number, z: number) => {
      const list = this.samples.get(id) ?? [];
      // A jump (respawn, passage) restarts the trail instead of sliding across the map.
      const prev = list[list.length - 1];
      if (snap || (prev && Math.hypot(prev.x - x, prev.z - z) > 4)) list.length = 0;
      // Positions come only when they change (and in a crowd, not every snapshot: see
      // limitMoves), so an unchanged one adds nothing; something setting off after standing
      // still starts from where it stood one snapshot ago instead of sliding from long before.
      else if (prev && prev.x === x && prev.z === z) return;
      else if (prev && t - prev.t > HOLD_GAP_MS) list.push({ t: t - 1000 / SNAPSHOT_HZ, x: prev.x, z: prev.z });
      list.push({ t, x, z });
      if (list.length > 6) list.shift();
      this.samples.set(id, list);
    };
    for (const e of state.enemies) record(e.id, e.x, e.z);
    for (const n of state.npcs) record(n.id, n.x, n.z);
    for (const o of state.others) record(o.id, o.x, o.z);
    // Own player: drop acknowledged inputs, then replay the rest from the server's position.
    this.pending = this.pending.filter((p) => p.seq > state.ack);
    this.serverPos = { x: state.player.x, z: state.player.z };
    const p = w.player;
    const jump = Math.hypot(p.x - state.player.x, p.z - state.player.z) > 4;
    if (snap || jump || this.pending.length > 0 || this.joyActive()) {
      const beforeX = p.x;
      const beforeZ = p.z;
      p.x = state.player.x;
      p.z = state.player.z;
      for (const inp of this.pending) w.predictMove(inp.dx, inp.dz, TICK_SECONDS);
      if (snap || jump) {
        p.prevX = p.x;
        p.prevZ = p.z;
      } else this.maxCorrection = Math.max(this.maxCorrection, Math.hypot(p.x - beforeX, p.z - beforeZ));
    }
  }

  private joyActive() {
    return Math.hypot(this.joy.x, this.joy.z) > 0.15;
  }

  /** Sends a command (or handles it on the device for the practice market). */
  issue = (cmd: Command) => {
    if (!this.world) return;
    if (cmd.type === 'joystick') {
      this.joy = { x: cmd.dx, z: cmd.dz };
      return;
    }
    if (DEVICE_LOCAL.has(cmd.type)) {
      this.world.issue(cmd);
      return;
    }
    this.post({ t: 'cmd', cmd });
  };

  /**
   * Advances the client by one frame: prediction ticks at the simulation rate, the device-local
   * practice market, and interpolation of everything else. Returns the render interpolation factor.
   */
  update(dt: number): number {
    const w = this.world;
    if (!w) return 0;
    const p = w.player;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= TICK_SECONDS && steps < 9) {
      this.acc -= TICK_SECONDS;
      steps++;
      p.prevX = p.x;
      p.prevZ = p.z;
      const active = this.joyActive();
      if (active || this.sentMoving) {
        const seq = ++this.seq;
        this.post({ t: 'input', seq, dx: this.joy.x, dz: this.joy.z });
        this.sentMoving = active;
        if (active) {
          this.pending.push({ seq, dx: this.joy.x, dz: this.joy.z });
          w.predictMove(this.joy.x, this.joy.z, TICK_SECONDS);
        }
      }
    }
    if (steps === 9) this.acc = 0;
    w.tickPracticeMarket(dt);
    // Not predicting: follow the server's position smoothly (paths, knock-backs, obstacles).
    if (!this.joyActive() && this.pending.length === 0 && this.serverPos) {
      const k = Math.min(1, dt * 14);
      p.x += (this.serverPos.x - p.x) * k;
      p.z += (this.serverPos.z - p.z) * k;
      p.prevX = p.x;
      p.prevZ = p.z;
    }
    // Everyone else: interpolate between snapshots, shown INTERP_DELAY_MS in the past.
    const now = this.now();
    const place = (e: { id: number; x: number; z: number; prevX: number; prevZ: number }) => {
      const s = this.samples.get(e.id);
      if (!s?.length) return;
      // Things updated less often (far away, or in a crowd) are shown a little further back, so
      // there is always a next position to move towards.
      let gap = Infinity;
      for (let i = Math.max(1, s.length - 3); i < s.length; i++) gap = Math.min(gap, s[i].t - s[i - 1].t);
      const at = now - Math.min(MAX_INTERP_DELAY_MS, Math.max(INTERP_DELAY_MS, Number.isFinite(gap) ? gap * 1.3 : 0));
      let x = s[s.length - 1].x;
      let z = s[s.length - 1].z;
      for (let i = s.length - 1; i > 0; i--) {
        if (s[i - 1].t <= at) {
          const a = s[i - 1];
          const b = s[i];
          const k = Math.max(0, Math.min(1, (at - a.t) / Math.max(1, b.t - a.t)));
          x = a.x + (b.x - a.x) * k;
          z = a.z + (b.z - a.z) * k;
          break;
        }
        if (i === 1) {
          x = s[0].x;
          z = s[0].z;
        }
      }
      e.x = e.prevX = x;
      e.z = e.prevZ = z;
    };
    for (const e of w.enemies) place(e);
    for (const n of w.npcs) place(n);
    for (const q of w.players.values()) if (q !== p) place(q);
    return this.acc / TICK_SECONDS;
  }

  /** Says something to players nearby, or privately to one player. */
  say(text: string, to?: string) {
    this.post(to ? { t: 'chat', channel: 'private', to, text } : { t: 'chat', channel: 'local', text });
  }

  block(name: string, on: boolean) {
    this.post({ t: 'block', name, on });
  }

  report(name: string, reason: string) {
    this.post({ t: 'report', name, reason });
  }

  drainChat(): ChatLine[] {
    const out = this.chat;
    this.chat = [];
    return out;
  }

  /** Events from the server, plus any from the device-local practice market. */
  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    if (this.world) out.push(...this.world.drainEvents());
    return out;
  }
}
