import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type RunningServer, type Session } from '../server/server';
import { NetClient } from '../src/net/client';
import { diffState, patchState } from '../src/net/delta';
import { captureState, type WorldState } from '../src/net/replica';
import { PROTOCOL_VERSION, contentVersion } from '../src/net/protocol';
import { GameWorld, type GameEvent, type Player } from '../src/sim/world';
import { mergeSave } from '../src/sim/records';
import { COMMAND_TYPES, validateCommand } from '../src/net/validate';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { generateWorld, isBlocked } from '../src/sim/worldmap';
import { mulberry32 } from '../src/core/rng';

const map = generateWorld(1337);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const running: RunningServer[] = [];
const clients: NetClient[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const ws of sockets.splice(0)) ws.close();
  for (const s of running.splice(0)) await s.close().catch(() => {});
});

async function serve(extra: Parameters<typeof startServer>[0] = {}) {
  const s = await startServer({ port: 0, dbPath: ':memory:', log: () => {}, allowGuests: true, limits: { connectionsPerAddress: 100, signInsPerAddress: 100 }, ...extra });
  running.push(s);
  return { s, url: `ws://127.0.0.1:${s.port}` };
}
async function join(server: RunningServer, url: string, name: string) {
  const c = new NetClient({ url, auth: { kind: 'guest', name } });
  clients.push(c);
  const world = await c.connect();
  return { c, world, s: server.sessions.get(`guest:${name.toLowerCase()}`)!, seen: [] as GameEvent[] };
}
/** Runs every client's frame loop for a while, keeping what each one was told. */
async function pump(cs: { c: NetClient; seen: GameEvent[] }[], ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await sleep(16);
    for (const x of cs) {
      x.c.update(0.016);
      x.seen.push(...x.c.drainEvents());
    }
  }
}
function standBeside(server: RunningServer, s: Session, x: number, z: number, nth = 0) {
  const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => ({ x: x + a, z: z + b })).filter((p) => !isBlocked(server.zone.map, p.x, p.z))[nth];
  s.player.x = s.player.prevX = spot.x;
  s.player.z = s.player.prevZ = spot.z;
}

/** A state as JSON with its lists in id order (the client matches entries by id, not position). */
const canon = (st: WorldState) =>
  JSON.stringify({ ...st, ...Object.fromEntries((['others', 'enemies', 'npcs', 'ground', 'graves', 'fires'] as const).map((k) => [k, [...st[k]].sort((a, b) => a.id - b.id)])) });

describe('3A.5 change-only snapshots', () => {
  it('a delta rebuilds exactly the next state, through play, loot, deaths and players coming and going', () => {
    const w = new GameWorld({ noPlayer: true, map, clock: () => 1_790_000_000_000 });
    const rng = mulberry32(55);
    const ids = [1_000_001, 1_000_002, 1_000_003, 1_000_004];
    for (const id of ids.slice(0, 3)) w.addPlayer({ playerId: id, name: `P${id % 10}` });
    const viewer = w.players.get(ids[0])!;
    const wolf = w.enemies.find((e) => e.def.id === 'wolf')!;
    viewer.x = viewer.prevX = wolf.x + 2;
    viewer.z = viewer.prevZ = wolf.z;
    let prev = w.act(viewer, () => captureState(w, 0, 0));
    let checked = 0;
    for (let t = 1; t <= 900; t++) {
      for (const id of ids) {
        if (!w.players.has(id)) continue;
        if (rng() < 0.05) w.issueFor(id, { type: 'joystick', dx: rng() * 2 - 1, dz: rng() * 2 - 1 });
      }
      if (t === 300) w.addPlayer({ playerId: ids[3], name: 'Late' });
      if (t === 600) w.removePlayer(ids[1]);
      if (t === 450) w.player.inventory.add('logs', 3);
      w.tick();
      if (t % 3 === 0) {
        const next = w.act(viewer, () => captureState(w, t, t));
        const d = JSON.parse(JSON.stringify(diffState(prev, next)));
        expect(canon(patchState(prev, d))).toBe(canon(next));
        prev = next;
        checked++;
      }
    }
    expect(checked).toBe(300);
  });

  it('a delta only carries what changed', () => {
    const w = new GameWorld({ noPlayer: true, map, clock: () => 1_790_000_000_000 });
    const a = w.addPlayer({ playerId: 1_000_001, name: 'Ash' });
    w.addPlayer({ playerId: 1_000_002, name: 'Brindle' });
    const s0 = w.act(a, () => captureState(w, 0, 0));
    const s1 = w.act(a, () => captureState(w, 1, 0));
    const d = diffState(s0, s1);
    expect(d.lists?.others).toBeUndefined();
    expect(JSON.stringify(d).length).toBeLessThan(JSON.stringify(s1).length / 4);
  });
});

describe('3A.5 two players in one world', () => {
  it('see each other move, share a rock and a creature, and never get each other’s private messages', async () => {
    const { s: server, url } = await serve();
    const A = await join(server, url, 'Ash');
    const B = await join(server, url, 'Brindle');
    const both = [A, B];
    await pump(both, 300);
    expect(A.world.players.has(B.s.playerId)).toBe(true);
    expect(B.world.players.has(A.s.playerId)).toBe(true);
    expect(A.world.players.get(B.s.playerId)!.name).toBe('Brindle');

    // B walks; A sees B's character move.
    const seenAt = A.world.players.get(B.s.playerId)!.x;
    B.c.issue({ type: 'joystick', dx: 1, dz: 0 });
    await pump(both, 700);
    B.c.issue({ type: 'joystick', dx: 0, dz: 0 });
    await pump(both, 400);
    expect(Math.abs(A.world.players.get(B.s.playerId)!.x - seenAt)).toBeGreaterThan(1);
    expect(A.world.players.get(B.s.playerId)!.x).toBeCloseTo(B.s.player.x, 0);

    // A mines a rock dry next to B: both see it depleted, and B's try is refused.
    const zone = server.zone;
    const rock = zone.nodes.find((n) => n.def.id === 'copper_rock' && !n.depleted && [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([x, z]) => !isBlocked(zone.map, n.x + x, n.z + z)).length >= 2)!;
    standBeside(server, A.s, rock.x, rock.z, 0);
    standBeside(server, B.s, rock.x, rock.z, 1);
    (zone as unknown as { rng: () => number }).rng = () => 0.01;
    A.c.issue({ type: 'interact', target: rock.id });
    await pump(both, 3000);
    expect(rock.depleted).toBe(true);
    expect(A.world.nodes.find((n) => n.id === rock.id)!.depleted).toBe(true);
    expect(B.world.nodes.find((n) => n.id === rock.id)!.depleted).toBe(true);
    expect(B.seen.some((e) => e.type === 'nodeDepleted')).toBe(true);
    expect(B.seen.some((e) => e.type === 'gather' && e.node === rock.id)).toBe(true);
    // A's xp, loot and messages went to A only.
    expect(A.seen.some((e) => e.type === 'xp')).toBe(true);
    expect(B.seen.some((e) => e.type === 'xp' || e.type === 'loot' || e.type === 'message' && /copper/i.test(e.text))).toBe(false);

    // Both fight the same wolf: each sees the other's hits on it, and its health matches the server.
    const wolf = zone.enemies.find((e) => e.def.id === 'wolf' && e.alive)!;
    standBeside(server, A.s, wolf.x, wolf.z, 0);
    standBeside(server, B.s, wolf.x, wolf.z, 1);
    wolf.hp = 1000;
    A.c.issue({ type: 'interact', target: wolf.id });
    B.c.issue({ type: 'interact', target: wolf.id });
    A.seen = [];
    B.seen = [];
    await pump(both, 3500);
    const hitsOn = (seen: GameEvent[]) => seen.filter((e) => e.type === 'damage' && e.target === wolf.id).length;
    expect(hitsOn(A.seen)).toBeGreaterThanOrEqual(2);
    expect(hitsOn(B.seen)).toBe(hitsOn(A.seen));
    expect(A.world.enemies.find((e) => e.id === wolf.id)!.hp).toBe(B.world.enemies.find((e) => e.id === wolf.id)!.hp);
    // The other player's pose comes across: B sees A attacking.
    expect(B.world.players.get(A.s.playerId)!.remote?.act).toBe('attack');
  }, 20_000);

  it('private loot and wisps are only sent to their owner', async () => {
    const { s: server, url } = await serve();
    const A = await join(server, url, 'Ash');
    const B = await join(server, url, 'Brindle');
    const zone = server.zone;
    zone.act(A.s.player, () => zone.spawnGrave(A.s.player.x, A.s.player.z, [{ item: 'logs', qty: 2 }]));
    await pump([A, B], 400);
    expect(A.world.graves.length).toBe(1);
    expect(B.world.graves.length).toBe(0);
    expect(B.s.lastState!.graves.length).toBe(0);
  }, 10_000);
});

describe('3A.5 load', () => {
  it('50 players in one place: the tick stays under 10 ms and each client gets under 10 KB/s', async () => {
    const { s: server, url } = await serve();
    const content = contentVersion(map);
    const bytes = new Map<number, number>();
    const BOTS = 50;
    await Promise.all(
      Array.from({ length: BOTS }, (_, i) =>
        new Promise<void>((resolve) => {
          const ws = new WebSocket(url);
          sockets.push(ws);
          bytes.set(i, 0);
          ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, content, auth: { kind: 'guest', name: `Bot${i}` } }));
          ws.onmessage = (e) => {
            const text = String(e.data);
            bytes.set(i, bytes.get(i)! + text.length);
            if (text.startsWith('{"t":"welcome"')) resolve();
          };
        }),
      ),
    );
    expect(server.zone.players.size).toBe(BOTS);
    // Everyone wanders about the village (all within sight of each other: the worst case), and
    // now and then starts a fight or chops a tree.
    const rng = mulberry32(50);
    let seq = 0;
    const dirs = Array.from({ length: BOTS }, () => ({ dx: rng() * 2 - 1, dz: rng() * 2 - 1 }));
    const trees = server.zone.nodes.filter((n) => n.def.id === 'tree').slice(0, 10).map((n) => n.id);
    const wander = setInterval(() => {
      sockets.forEach((ws, i) => {
        if (rng() < 0.02) dirs[i] = { dx: rng() * 2 - 1, dz: rng() * 2 - 1 };
        if (rng() < 0.004 && trees.length) ws.send(JSON.stringify({ t: 'cmd', cmd: { type: 'interact', target: trees[Math.floor(rng() * trees.length)] } }));
        ws.send(JSON.stringify({ t: 'input', seq: ++seq, ...dirs[i] }));
      });
    }, 1000 / 30);
    await sleep(1000);
    // Measure from here (after everyone has joined and the welcomes are out of the way).
    Object.assign(server.stats, { ticks: 0, tickMsTotal: 0, tickMsMax: 0, bytesSent: 0 });
    for (const k of bytes.keys()) bytes.set(k, 0);
    const SECONDS = 5;
    await sleep(SECONDS * 1000);
    clearInterval(wander);
    const avgTick = server.stats.tickMsTotal / server.stats.ticks;
    const perClient = [...bytes.values()].map((b) => b / SECONDS);
    const worst = Math.max(...perClient);
    const mean = perClient.reduce((a, b) => a + b, 0) / perClient.length;
    console.log(`50 bots: ${server.stats.ticks} ticks, average ${avgTick.toFixed(2)} ms, max ${server.stats.tickMsMax.toFixed(1)} ms; per client ${(mean / 1024).toFixed(1)} KB/s average, ${(worst / 1024).toFixed(1)} KB/s worst`);
    expect(server.stats.ticks).toBeGreaterThan(SECONDS * 25);
    expect(avgTick).toBeLessThan(10);
    expect(worst).toBeLessThan(10 * 1024);
  }, 30_000);
});

/** Everything a player owns, including their wisps and private loot piles in the world. */
function owned(w: GameWorld, p: Player): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (item: string, n: number) => (out[item] = (out[item] ?? 0) + n);
  for (const s of p.inventory.slots) if (s) add(s.item, s.qty);
  for (const s of p.overflow) add(s.item, s.qty);
  for (const s of p.bank.toJSON()) if (s.qty > 0) add(s.item, s.qty);
  for (const s of p.shrineHeld) add(s.item, s.qty);
  for (const [slot, it] of Object.entries(p.equipment.slots)) if (it) add(it, slot === 'ammo' ? p.equipment.ammoQty : 1);
  for (const it of Object.values(p.toolbelt.slots)) if (it) add(it, 1);
  for (const g of w.graves) if (g.owner === p.id && !g.expired) for (const s of g.items) add(s.item, s.qty);
  for (const g of w.groundItems) if (g.owner === p.id && g.isPrivate && !g.expired) add(g.item, g.qty);
  return out;
}

describe('3A.5 conservation with several players and disconnects', () => {
  it('fuzz: players play at random and drop out; what comes back is exactly what was saved, and a restart loses nothing', async () => {
    const dbPath = joinPath(mkdtempSync(joinPath(tmpdir(), 'bw-')), 'fuzz.sqlite');
    let { s: server, url } = await serve({ dbPath, graceMs: 150 });
    const rng = mulberry32(0x3a55);
    const pick = <T,>(a: readonly T[]) => a[Math.floor(rng() * a.length)];
    const names = ['Ash', 'Brindle', 'Corra', 'Dunmore'];
    const players = new Map<string, { c: NetClient; token: string; key: string }>();
    for (const name of names) {
      const c = new NetClient({ url, auth: { kind: 'register', username: name, password: 'brightwater1' } });
      clients.push(c);
      await c.connect();
      players.set(name, { c, token: c.session!, key: [...server.sessions.values()].find((x) => x.name === name)!.key });
    }
    const kinds = COMMAND_TYPES.filter((t) => !['discardOverflow', 'exchange', 'exchangeResetPractice', 'logout'].includes(t as string));
    const fit = (kind: string, cmd: Record<string, unknown>) => {
      for (const combo of [['x', 'z'], ['dx', 'dz'], ['slot', 'qty'], ['a', 'b'], ['target'], ['slot']]) {
        const trial: Record<string, unknown> = { type: kind };
        for (const k of combo) trial[k] = cmd[k];
        const ok = validateCommand(trial);
        if (ok) return ok;
      }
      return validateCommand({ type: kind });
    };
    // Give everyone something worth keeping track of.
    for (const x of server.sessions.values()) {
      x.player.inventory.add('logs', 5);
      x.player.inventory.add('bread', 3);
      x.player.bank.add('coins', 500);
    }
    let rejoins = 0;
    const end = Date.now() + 8000;
    while (Date.now() < end) {
      const name = pick(names);
      const me = players.get(name)!;
      if (rng() < 0.04) {
        // Drop the connection and wait until the server has saved and unloaded the character.
        me.c.close();
        while (server.sessions.has(me.key)) await sleep(5);
        const row = server.repos.characterFor(server.repos.findAccount(name)!.id)!;
        const fromDb = new GameWorld({ noPlayer: true, map, clock: () => 1_790_000_000_000 });
        const saved = owned(fromDb, fromDb.addPlayer({ playerId: row.playerId, save: mergeSave({ character: row.record, zone: row.zone }), worldItems: true }));
        const c = new NetClient({ url, auth: { kind: 'token', token: me.token } });
        clients.push(c);
        await c.connect();
        const back = server.sessions.get(me.key)!;
        expect(owned(server.zone, back.player), name).toEqual(saved);
        players.set(name, { ...me, c });
        rejoins++;
        continue;
      }
      const cmd: Record<string, unknown> = {};
      for (const k of ['slot', 'a', 'b', 'qty']) cmd[k] = Math.floor(rng() * 28);
      const z = server.zone;
      cmd.target = pick([...z.nodes.slice(0, 40).map((n) => n.id), ...z.enemies.map((e) => e.id), ...z.npcs.map((n) => n.id), ...z.groundItems.map((g) => g.id)]);
      cmd.x = 50 + rng() * 15;
      cmd.z = 60 + rng() * 15;
      cmd.dx = rng() * 2 - 1;
      cmd.dz = rng() * 2 - 1;
      const ok = fit(pick(kinds), cmd);
      if (ok) me.c.issue(ok);
      await sleep(10);
      for (const x of players.values()) x.c.update(0.01);
    }
    expect(rejoins).toBeGreaterThanOrEqual(3);

    // Shut down (saving everyone) and start again on the same database: nobody loses anything.
    await sleep(300);
    const before = new Map([...server.sessions.values()].map((x) => [x.name, owned(server.zone, x.player)]));
    for (const x of players.values()) x.c.close();
    await server.close();
    running.splice(running.indexOf(server), 1);
    ({ s: server, url } = await serve({ dbPath, graceMs: 150 }));
    for (const name of names) {
      const c = new NetClient({ url, auth: { kind: 'token', token: players.get(name)!.token } });
      clients.push(c);
      await c.connect();
      const x = [...server.sessions.values()].find((y) => y.name === name)!;
      expect(owned(server.zone, x.player), name).toEqual(before.get(name));
    }
  }, 30_000);
});
