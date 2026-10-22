import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer, type Session } from '../server/server';
import { NetClient } from '../src/net/client';
import { PROTOCOL_VERSION, contentVersion, parseClientMessage } from '../src/net/protocol';
import { generateWorld, isBlocked } from '../src/sim/worldmap';
import type { GameWorld } from '../src/sim/world';

let server: RunningServer;
let url = '';
const silent = () => {};

beforeAll(async () => {
  server = await startServer({ port: 0, log: silent, dbPath: ':memory:', allowGuests: true });
  url = `ws://127.0.0.1:${server.port}`;
});
afterAll(async () => {
  await server.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Runs a client's frame loop for a while (as the browser's requestAnimationFrame would). */
async function pump(c: NetClient, ms: number) {
  const end = Date.now() + ms;
  let last = Date.now();
  while (Date.now() < end) {
    await sleep(16);
    const now = Date.now();
    c.update((now - last) / 1000);
    last = now;
  }
}
async function join(name: string, latencyMs = 0) {
  const c = new NetClient({ url, auth: { kind: 'guest', name }, latencyMs });
  const world = await c.connect();
  return { c, world, s: server.sessions.get(`guest:${name.toLowerCase()}`)! };
}
/** Test harness only: stand the server-side player next to something. */
function standBeside(s: Session, x: number, z: number) {
  const w = s.world;
  const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => ({ x: x + a, z: z + b })).find((p) => !isBlocked(w.map, p.x, p.z))!;
  w.player.x = w.player.prevX = spot.x;
  w.player.z = w.player.prevZ = spot.z;
}
const sameBag = (a: GameWorld, b: GameWorld) => expect(JSON.stringify(a.player.inventory.toJSON())).toBe(JSON.stringify(b.player.inventory.toJSON()));

/** A raw socket for misbehaving-client tests. */
function raw(): Promise<{ ws: WebSocket; got: string[]; closed: Promise<void> }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const got: string[] = [];
    let done!: () => void;
    const closed = new Promise<void>((r) => (done = r));
    ws.onmessage = (e) => got.push(String(e.data));
    ws.onclose = () => done();
    ws.onopen = () => resolve({ ws, got, closed });
  });
}

describe('3A.2 protocol', () => {
  it('parses only well-formed client messages', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'cmd', cmd: { type: 'pray' } }))).toEqual({ t: 'cmd', cmd: { type: 'pray' } });
    expect(parseClientMessage(JSON.stringify({ t: 'input', seq: 3, dx: 0.5, dz: 0 }))).not.toBeNull();
    for (const bad of [
      'not json', '{}', '[]', 'null', JSON.stringify({ t: 'state' }), JSON.stringify({ t: 'cmd', cmd: { type: 'pray', x: 1 } }),
      JSON.stringify({ t: 'input', seq: 0, dx: 0, dz: 0 }), JSON.stringify({ t: 'input', seq: 1, dx: 9, dz: 0 }),
      JSON.stringify({ t: 'hello', v: 2, content: 'x', auth: { kind: 'guest', name: 'x'.repeat(40) } }), JSON.stringify({ t: 'hello', v: 2, content: 'x', auth: { kind: 'guest', name: 'Ok', appearance: { bodyType: 3 } } }),
      JSON.stringify({ t: 'hello', v: 2, content: 'x', auth: { kind: 'login', username: 'Ok', password: 'x', admin: true } }), JSON.stringify({ t: 'hello', v: 2, content: 'x', auth: { kind: 'token', token: 'short' } }),
      'x'.repeat(9000),
    ]) expect(parseClientMessage(bad), bad.slice(0, 40)).toBeNull();
  });

  it('client and server agree on the content version', () => {
    expect(contentVersion(generateWorld(1337))).toBe(contentVersion(generateWorld(1337)));
  });
});

describe('3A.2 authoritative solo play over the network', () => {
  it('welcomes a guest with a server-side character and a matching replica', async () => {
    const { c, world, s } = await join('Wren');
    expect(c.playerId).toBe(s.playerId);
    expect(s.playerId).toBeGreaterThanOrEqual(1_000_000);
    expect(world.player.id).toBe(s.playerId);
    sameBag(world, s.world);
    expect(world.player.name).toBe('Wren');
    c.close();
  }, 10_000);

  it('plays through commands: chop a tree, bank the logs, fletch shafts; the replica follows', async () => {
    const { c, world, s } = await join('Ash');
    const w = s.world;
    (w as unknown as { rng: () => number }).rng = () => 0.3;
    const tree = w.nodes.find((n) => n.def.id === 'tree' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => !isBlocked(w.map, n.x + a, n.z + b)))!;
    standBeside(s, tree.x, tree.z);
    await pump(c, 300);
    c.issue({ type: 'interact', target: tree.id });
    await pump(c, 4000);
    expect(w.player.inventory.count('logs')).toBeGreaterThan(0);
    sameBag(world, w);
    expect(Math.hypot(world.player.x - w.player.x, world.player.z - w.player.z)).toBeLessThan(0.1);
    // Fletch arrow shafts anywhere (knife on the toolbelt).
    c.issue({ type: 'openAnywhere', kind: 'fletching' });
    c.issue({ type: 'craft', recipe: 'arrow_shafts', count: 1 });
    await pump(c, 2500);
    expect(w.player.inventory.count('arrow_shafts')).toBe(12);
    // Bank everything at the banker.
    const banker = w.npcs.find((n) => n.def.service === 'bank')!;
    standBeside(s, banker.x, banker.z);
    await pump(c, 300);
    c.issue({ type: 'interact', target: banker.id });
    await pump(c, 1500);
    expect(w.player.bankAt).not.toBeNull();
    expect(world.player.bankAt).toBe(w.player.bankAt);
    c.issue({ type: 'bankDepositAll' });
    await pump(c, 600);
    expect(w.player.bank.count('arrow_shafts')).toBe(12);
    expect(world.player.bank.count('arrow_shafts')).toBe(12);
    sameBag(world, w);
    c.close();
  }, 20_000);

  it('a tampering client cannot change anything except through valid commands', async () => {
    const { c, s } = await join('Moss');
    const before = JSON.stringify(s.world.characterRecord());
    c.close();
    const { ws, got, closed } = await raw();
    const content = contentVersion(s.world.map);
    ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, content, auth: { kind: 'guest', name: 'Moss' } }));
    await sleep(200);
    for (const m of [
      'garbage',
      JSON.stringify({ t: 'state', state: { player: { f: { hp: 9999 } } } }),
      JSON.stringify({ t: 'cmd', cmd: { type: 'bankWithdraw', item: 'coins', qty: 1e6, account: 'Ash' } }),
      JSON.stringify({ t: 'cmd', cmd: { type: 'exchange', req: { op: 'place', nonce: 1, slot: 0, side: 'buy', item: 'logs', qty: 1, price: 1 } } }),
      JSON.stringify({ t: 'character', character: { xp: { attack: 1e9 } } }),
      JSON.stringify({ t: 'cmd', cmd: { type: 'shopBuy', item: 'coins', qty: 1000 } }),
    ]) ws.send(m);
    await sleep(500);
    expect(got.some((g) => g.includes('Invalid message'))).toBe(true);
    expect(JSON.stringify(s.world.characterRecord())).toBe(before);
    expect(s.world.player.hp).toBeLessThanOrEqual(s.world.player.maxHp);
    // Keep misbehaving: the server disconnects.
    for (let i = 0; i < 25; i++) ws.send('{"t":"nope"}');
    await closed;
    expect(got.some((g) => g.includes('Too many invalid messages'))).toBe(true);
  }, 10_000);

  it('turns away a client built from different game content', async () => {
    const { ws, got, closed } = await raw();
    ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, content: '1-older-build', auth: { kind: 'guest', name: 'Old' } }));
    await closed;
    expect(got.join()).toContain("doesn't match the server");
  });

  it('one live connection per character: signing in again replaces the old connection', async () => {
    const first = await join('Fern');
    const second = await join('Fern');
    await pump(first.c, 300);
    expect(first.c.status).toBe('closed');
    expect(first.c.closeReason).toContain('somewhere else');
    expect(second.c.playerId).toBe(first.c.playerId);
    second.c.close();
  }, 10_000);

  it('the practice market stays on the device; the server ignores it', async () => {
    const { c, world, s } = await join('Pell');
    const clerk = s.world.npcs.find((n) => n.def.id === 'clerk_pell')!;
    standBeside(s, clerk.x, clerk.z);
    await pump(c, 300);
    c.issue({ type: 'interact', target: clerk.id });
    await pump(c, 1500);
    expect(world.player.exchangeAt).not.toBeNull();
    const serverOrders = s.world.market.playerOrders().length;
    c.issue({ type: 'exchange', req: { op: 'place', nonce: world.market.exchange.nextNonce('practice:you'), slot: 0, side: 'buy', item: 'logs', qty: 1, price: 1 } });
    await pump(c, 300);
    expect(world.market.playerOrders().length).toBe(1);
    expect(s.world.market.playerOrders().length).toBe(serverOrders);
    c.close();
  }, 10_000);

  it('prediction: with 150 ms round trips, joystick movement stays smooth and ends where the server says', async () => {
    const { c, world, s } = await join('Brook', 75);
    await pump(c, 400);
    const start = { x: world.player.x, z: world.player.z };
    c.issue({ type: 'joystick', dx: 1, dz: 0 });
    // Before the server could have answered, the local player is already moving.
    await pump(c, 60);
    expect(world.player.x).toBeGreaterThan(start.x);
    await pump(c, 1200);
    c.issue({ type: 'joystick', dx: 0, dz: 0 });
    await pump(c, 1200);
    const sp = s.world.player;
    expect(Math.hypot(world.player.x - sp.x, world.player.z - sp.z)).toBeLessThan(0.05);
    expect(sp.x - start.x).toBeGreaterThan(2);
    // Corrections while moving were small (no visible snapping).
    expect(c.maxCorrection).toBeLessThan(0.35);
    c.close();
  }, 15_000);
});
