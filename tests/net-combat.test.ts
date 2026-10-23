import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type RunningServer, type Session } from '../server/server';
import { NetClient } from '../src/net/client';
import { xpForLevel } from '../src/data/skills';
import type { Enemy, GameEvent, Player } from '../src/sim/world';

/** Phase 5D over a real server: specials, slows and pack calls are the server's (docs/COMBAT.md). */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const running: RunningServer[] = [];
const clients: NetClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const s of running.splice(0)) await s.close().catch(() => {});
});
interface Who {
  c: NetClient;
  s: Session;
  events: GameEvent[];
}
async function serve() {
  const s = await startServer({ port: 0, dbPath: ':memory:', log: () => {}, graceMs: 2000 });
  running.push(s);
  return { s, url: `ws://127.0.0.1:${s.port}` };
}
async function join(server: RunningServer, url: string, name: string): Promise<Who> {
  const c = new NetClient({ url, auth: { kind: 'register', username: name, password: 'brightwater1' }, autoReconnect: true } as ConstructorParameters<typeof NetClient>[0]);
  clients.push(c);
  await c.connect();
  const s = [...server.sessions.values()].find((x) => x.name.toLowerCase() === name.toLowerCase())!;
  return { c, s, events: [] };
}
async function pump(who: Who[], ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await sleep(15);
    for (const w of who) {
      w.c.update(0.015);
      w.events.push(...w.c.drainEvents());
    }
  }
}
const place = (p: Player, x: number, z: number) => {
  p.x = p.prevX = x;
  p.z = p.prevZ = z;
};
function strong(p: Player) {
  for (const s of ['attack', 'strength', 'defence', 'hitpoints'] as const) p.skills.addXp(s, xpForLevel(45));
  p.hp = p.skills.maxHp();
}
function openNear(server: RunningServer, e: Enemy, r: number) {
  const m = server.zone.map;
  for (let k = 0; k < 64; k++) {
    const a = k * 0.7;
    const x = e.x + Math.cos(a) * r;
    const z = e.z + Math.sin(a) * r;
    if (!m.blocked[Math.floor(z) * m.width + Math.floor(x)]) return { x, z };
  }
  throw new Error('no open ground');
}

describe('5D multiplayer: the server runs the specials', () => {
  it('two players by Grukk: both phones see the ring; the one who stays is hit, the one who steps out is not', async () => {
    const { s: server, url } = await serve();
    const a = await join(server, url, 'Ash');
    const b = await join(server, url, 'Bea');
    strong(a.s.player);
    strong(b.s.player);
    const grukk = server.zone.enemies.find((e) => e.def.id === 'goblin_warlord')!;
    const near = openNear(server, grukk, 1.3);
    place(a.s.player, near.x, near.z);
    place(b.s.player, near.x + 0.2, near.z);
    grukk.state = 'chase';
    grukk.target = a.s.player.id;
    grukk.specialTimer = 0;
    grukk.attackTimer = 99;
    await pump([a, b], 250);
    expect(grukk.special).not.toBeNull();
    // Both phones have the ring (from the snapshot) and the warning (an event).
    for (const w of [a, b]) {
      const seen = w.c.world!.enemies.find((e) => e.id === grukk.id)!;
      expect(seen.special?.name).toBe('Club slam');
      expect(w.events.some((e) => e.type === 'telegraph' && e.source === grukk.id)).toBe(true);
    }
    // Bea's phone steps her out (the server moves her); Ash stays.
    const ring = { ...grukk.special! };
    const out = openNear(server, { x: ring.x, z: ring.z } as Enemy, ring.radius + 2);
    b.c.issue({ type: 'moveTo', x: out.x, z: out.z });
    const hpA = a.s.player.hp;
    const hpB = b.s.player.hp;
    await pump([a, b], 1800);
    expect(grukk.special).toBeNull();
    expect(a.s.player.hp).toBeLessThan(hpA);
    expect(b.s.player.hp).toBe(hpB);
    expect(a.events.some((e) => e.type === 'damage' && e.target === a.s.player.id && e.outcome === 'special')).toBe(true);
    // The phones agree with the server.
    expect(a.c.world!.player.hp).toBe(a.s.player.hp);
  }, 15_000);

  it('a phone can’t forge a status, damage or a special; slows come only from the server', async () => {
    const { s: server, url } = await serve();
    const a = await join(server, url, 'Ash');
    const p = a.s.player;
    for (const cmd of [
      { type: 'status', status: 'slow', seconds: 0 },
      { type: 'damage', target: 5000, amount: 999 },
      { type: 'special', enemy: 5000 },
      { type: 'clearSlow' },
    ]) a.c.issue(cmd as never);
    p.slowTimer = 2;
    p.slowFactor = 0.7;
    await pump([a], 300);
    expect(p.slowTimer).toBeGreaterThan(1.3);
    // The phone sees the slow and predicts with it.
    expect(a.c.world!.player.slowFactor).toBe(0.7);
    await pump([a], 2000);
    expect(p.slowTimer).toBe(0);
    expect(a.c.world!.player.slowTimer).toBe(0);
  }, 10_000);

  it('a player who drops mid wind-up: the special still resolves on the server; back online, the phone sees what is on now', async () => {
    const { s: server, url } = await serve();
    const a = await join(server, url, 'Ash');
    strong(a.s.player);
    const grukk = server.zone.enemies.find((e) => e.def.id === 'goblin_warlord')!;
    const near = openNear(server, grukk, 1.3);
    place(a.s.player, near.x, near.z);
    grukk.state = 'chase';
    grukk.target = a.s.player.id;
    grukk.specialTimer = 0;
    grukk.attackTimer = 99;
    await pump([a], 150);
    expect(grukk.special).not.toBeNull();
    a.s.ws!.terminate();
    await pump([a], 2500);
    expect(grukk.special).toBeNull();
    expect(a.c.status).toBe('ready');
    // A new wind-up after the reconnect reaches the phone.
    grukk.state = 'chase';
    grukk.target = a.s.player.id;
    grukk.specialTimer = 0;
    place(a.s.player, near.x, near.z);
    await pump([a], 300);
    expect(a.c.world!.enemies.find((e) => e.id === grukk.id)?.special?.name).toBe('Club slam');
  }, 15_000);

  it('a wolf pack answers whoever started the fight', async () => {
    const { s: server, url } = await serve();
    const a = await join(server, url, 'Ash');
    const wolves = server.zone.enemies.filter((e) => e.def.id === 'wolf');
    const [lead, mate, ...rest] = wolves;
    for (const o of rest) {
      o.x = o.prevX = o.x + 60;
      o.z = o.prevZ = o.z + 60;
    }
    mate.x = mate.prevX = mate.spawnX = lead.x + 1;
    mate.z = mate.prevZ = mate.spawnZ = lead.z + 1;
    place(a.s.player, lead.x - 1.2, lead.z);
    a.c.issue({ type: 'interact', target: lead.id });
    await pump([a], 800);
    expect(lead.state).toBe('chase');
    expect(mate.state).toBe('chase');
    expect(mate.target).toBe(a.s.player.id);
  }, 10_000);
});
