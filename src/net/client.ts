import { GameWorld, TICK_SECONDS, type Appearance, type Command, type GameEvent, type PlayerId } from '../sim/world';
import { mergeSave } from '../sim/records';
import { applyCharacter, applyState, type WorldState } from './replica';
import { PROTOCOL_VERSION, contentVersion, type ClientMessage, type ServerMessage } from './protocol';
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
export const INTERP_DELAY_MS = 150;
/** Commands handled on the device (the practice market never touches real wealth). */
const DEVICE_LOCAL = new Set<Command['type']>(['exchange', 'exchangeResetPractice']);

type Sample = { t: number; x: number; z: number };

export interface NetClientOptions {
  url: string;
  name: string;
  appearance?: Appearance;
  /** Testing: added one-way delay in ms for both directions (simulated latency). */
  latencyMs?: number;
  now?: () => number;
}

export class NetClient {
  world: GameWorld | null = null;
  playerId: PlayerId | null = null;
  status: 'connecting' | 'ready' | 'closed' = 'connecting';
  /** Why the connection ended (shown to the player). */
  closeReason = '';
  /** Largest single correction applied to the predicted position so far (tiles). */
  maxCorrection = 0;
  private ws: WebSocket | null = null;
  private events: GameEvent[] = [];
  private seq = 0;
  private pending: { seq: number; dx: number; dz: number }[] = [];
  private joy = { x: 0, z: 0 };
  private sentMoving = false;
  private acc = 0;
  private samples = new Map<number, Sample[]>();
  private serverPos: { x: number; z: number } | null = null;
  private readonly now: () => number;
  /** The map, generated locally from the shared seed (the server checks it matches). */
  private readonly map = generateWorld(1337);

  constructor(private opts: NetClientOptions) {
    this.now = opts.now ?? (() => performance.now());
  }

  /** Connects and resolves with the replica world once the server welcomes us. */
  connect(): Promise<GameWorld> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.opts.url);
      this.ws = ws;
      ws.onopen = () => {
        const content = contentVersion(this.map);
        this.post({ t: 'hello', v: PROTOCOL_VERSION, content, name: this.opts.name, ...(this.opts.appearance ? { appearance: this.opts.appearance } : {}) });
      };
      ws.onmessage = (ev) => {
        const run = () => {
          const msg = JSON.parse(String(ev.data)) as ServerMessage;
          if (msg.t === 'welcome') resolve(this.welcome(msg));
          else this.receive(msg);
        };
        if (this.opts.latencyMs) setTimeout(run, this.opts.latencyMs);
        else run();
      };
      ws.onclose = (ev) => {
        this.status = 'closed';
        this.closeReason ||= ev.reason || 'Disconnected from the server.';
        if (!this.world) reject(new Error(this.closeReason));
      };
      ws.onerror = () => {
        this.closeReason ||= 'Could not reach the server.';
      };
    });
  }

  close() {
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
    this.playerId = msg.playerId;
    if (!this.world) {
      // The replica: built from the server's character, on the locally generated map.
      this.world = new GameWorld({ save: mergeSave({ character: msg.character }), playerId: msg.playerId, map: this.map });
      this.world.drainEvents();
    } else applyCharacter(this.world, msg.character);
    this.applySnapshot(msg.state, true);
    this.status = 'ready';
    this.events.push({ type: 'message', text: `Connected to the development server as ${this.world.player.name}.`, tone: 'good' });
    return this.world;
  }

  private receive(msg: ServerMessage) {
    if (msg.t === 'error') {
      this.events.push({ type: 'message', text: msg.error, tone: msg.fatal ? 'bad' : 'warn' });
      if (msg.fatal) this.closeReason = msg.error;
      return;
    }
    if (msg.t !== 'state' || !this.world) return;
    if (msg.character) applyCharacter(this.world, msg.character);
    this.applySnapshot(msg.state, false);
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
      list.push({ t, x, z });
      if (list.length > 6) list.shift();
      this.samples.set(id, list);
    };
    for (const e of state.enemies) record(e.id, e.x, e.z);
    for (const n of state.npcs) record(n.id, n.x, n.z);
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
    const at = this.now() - INTERP_DELAY_MS;
    const place = (e: { id: number; x: number; z: number; prevX: number; prevZ: number }) => {
      const s = this.samples.get(e.id);
      if (!s?.length) return;
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
    return this.acc / TICK_SECONDS;
  }

  /** Events from the server, plus any from the device-local practice market. */
  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    if (this.world) out.push(...this.world.drainEvents());
    return out;
  }
}
