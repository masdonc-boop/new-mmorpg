import { WebSocketServer, type WebSocket } from 'ws';
import { GameWorld, TICK_SECONDS, type GameEvent, type PlayerId } from '../src/sim/world';
import { generateWorld, type WorldMap } from '../src/sim/worldmap';
import { captureState } from '../src/net/replica';
import { PROTOCOL_VERSION, SNAPSHOT_HZ, contentVersion, parseClientMessage, type ClientMessage, type ServerMessage } from '../src/net/protocol';

/**
 * Brightwater development server (docs/MULTIPLAYER.md 3A.2): authoritative solo play over the
 * network. Each connected guest gets their own server-side `GameWorld` (today's single-player
 * simulation); the client sends intents and renders what the server sends back.
 *
 * Development only: guests are identified by name, characters live in memory until the server
 * stops (accounts and persistence are 3A.3), and it listens on localhost by default.
 */

export interface ServerOptions {
  port?: number;
  host?: string;
  /** Real-world clock for farming (injectable for tests). */
  clock?: () => number;
  log?: (msg: string) => void;
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
  /** Live sessions by guest name (for tests and tooling). */
  sessions: Map<string, Session>;
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
  name: string;
  playerId: PlayerId;
  world: GameWorld;
  ws: WebSocket | null;
  inputs: { seq: number; dx: number; dz: number }[];
  lastSeq: number;
  ack: number;
  holding: number;
  joyActive: boolean;
  events: GameEvent[];
  lastCharacter: string;
  strikes: number;
  tokens: number;
}

export async function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const log = opts.log ?? ((m: string) => console.log(`[server] ${m}`));
  const clock = opts.clock ?? (() => Date.now());
  const map: WorldMap = generateWorld(1337);
  const content = contentVersion(map);
  const sessions = new Map<string, Session>();
  let nextPlayerId = 1_000_000;
  let tick = 0;

  const wss = new WebSocketServer({ port: opts.port ?? 8787, host: opts.host ?? '127.0.0.1', maxPayload: 64 * 1024 });
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
  const address = wss.address();
  const port = typeof address === 'object' && address ? address.port : opts.port ?? 8787;

  const send = (ws: WebSocket | null, msg: ServerMessage) => {
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  wss.on('connection', (ws) => {
    let session: Session | null = null;
    let strikes = 0;
    const strike = (why: string) => {
      const s = session;
      const n = s ? ++s.strikes : ++strikes;
      send(ws, { t: 'error', error: why });
      if (n >= MAX_STRIKES) {
        send(ws, { t: 'error', error: 'Too many invalid messages.', fatal: true });
        ws.close(1008, 'invalid messages');
      }
    };
    const helloTimer = setTimeout(() => {
      if (!session) ws.close(1008, 'no hello');
    }, 5000);

    ws.on('message', (data, isBinary) => {
      if (isBinary) return strike('Binary messages are not accepted.');
      const msg = parseClientMessage(data.toString());
      if (!msg) return strike('Invalid message.');
      if (!session) {
        if (msg.t !== 'hello') return strike('Say hello first.');
        session = join(ws, msg);
        clearTimeout(helloTimer);
        return;
      }
      // Rate limit (token bucket refilled every tick).
      if (session.tokens <= 0) return strike('Too many messages.');
      session.tokens--;
      handle(session, msg);
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (session && session.ws === ws) {
        session.ws = null;
        session.inputs = [];
        session.world.issueFor(session.playerId, { type: 'joystick', dx: 0, dz: 0 });
        log(`${session.name} disconnected`);
      }
    });
  });

  function join(ws: WebSocket, hello: Extract<ClientMessage, { t: 'hello' }>): Session | null {
    if (hello.v !== PROTOCOL_VERSION || hello.content !== content) {
      send(ws, { t: 'error', error: `This game version doesn't match the server (server ${content}, game ${hello.content}). Reload to update.`, fatal: true });
      ws.close(1008, 'version');
      return null;
    }
    let s = sessions.get(hello.name.toLowerCase());
    if (s?.ws) {
      // One live connection per character: the newer one takes over.
      send(s.ws, { t: 'error', error: 'Signed in from somewhere else.', fatal: true });
      s.ws.close(4000, 'replaced');
    }
    if (!s) {
      const playerId = nextPlayerId++;
      const world = new GameWorld({ name: hello.name, appearance: hello.appearance, playerId, map, clock });
      s = { name: hello.name, playerId, world, ws: null, inputs: [], lastSeq: 0, ack: 0, holding: 0, joyActive: false, events: [], lastCharacter: '', strikes: 0, tokens: MESSAGE_RATE };
      sessions.set(hello.name.toLowerCase(), s);
      log(`new guest ${hello.name} (#${playerId})`);
    } else log(`${hello.name} reconnected`);
    s.ws = ws;
    s.inputs = [];
    s.lastSeq = 0;
    s.ack = 0;
    s.strikes = 0;
    s.world.drainEvents();
    const character = s.world.characterRecord();
    s.lastCharacter = JSON.stringify(character);
    send(ws, { t: 'welcome', v: PROTOCOL_VERSION, playerId: s.playerId, character, state: captureState(s.world, tick, s.ack) });
    return s;
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
      case 'hello':
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

  // Fixed 30 Hz simulation; snapshots at SNAPSHOT_HZ. Worlds without a connection are paused.
  let last = performance.now();
  let acc = 0;
  const every = Math.round(1 / TICK_SECONDS / SNAPSHOT_HZ);
  const timer = setInterval(() => {
    const now = performance.now();
    acc += Math.min(0.25, (now - last) / 1000);
    last = now;
    while (acc >= TICK_SECONDS) {
      acc -= TICK_SECONDS;
      tick++;
      for (const s of sessions.values()) {
        if (!s.ws) continue;
        s.tokens = Math.min(MESSAGE_RATE, s.tokens + MESSAGE_RATE * TICK_SECONDS);
        step(s);
        if (tick % every === 0) snapshot(s);
      }
    }
  }, 1000 * TICK_SECONDS);

  log(`listening on ws://${opts.host ?? '127.0.0.1'}:${port} (content ${content})`);
  return {
    port,
    sessions,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(timer);
        for (const c of wss.clients) c.terminate();
        wss.close(() => resolve());
      }),
  };
}
