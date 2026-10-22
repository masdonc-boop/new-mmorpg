import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { startServer, type RunningServer, type Session } from '../server/server';
import { NetClient } from '../src/net/client';
import { HOUSE } from '../src/data/construction';
import { BRIGHTWATER, HOLLOW_ZONE, houseZone, inHouse, zoneFor } from '../src/sim/zones';
import { HOLLOW, generateWorld, inHollow, isBlocked } from '../src/sim/worldmap';
import { mulberry32 } from '../src/core/rng';
import type { Player } from '../src/sim/world';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const running: RunningServer[] = [];
const clients: NetClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const s of running.splice(0)) await s.close().catch(() => {});
});

async function serve(dbPath = ':memory:') {
  const s = await startServer({ port: 0, dbPath, log: () => {}, allowGuests: true, graceMs: 150, limits: { connectionsPerAddress: 100, signInsPerAddress: 100, transferCooldownMs: 0 } });
  running.push(s);
  return { s, url: `ws://127.0.0.1:${s.port}` };
}
async function join(server: RunningServer, url: string, name: string, auth?: object) {
  const c = new NetClient({ url, auth: (auth ?? { kind: 'register', username: name, password: 'brightwater1' }) as never });
  clients.push(c);
  await c.connect();
  const key = () => [...server.sessions.values()].find((x) => x.name.toLowerCase() === name.toLowerCase())!.key;
  return { name, c, key: key(), get s(): Session { return server.sessions.get(this.key)!; } };
}
async function pump(cs: NetClient[], ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await sleep(15);
    for (const c of cs) c.update(0.015);
  }
}
/** Test harness: puts a server-side character somewhere (the next tick moves them to its zone). */
function put(s: Session, x: number, z: number) {
  s.player.x = s.player.prevX = x;
  s.player.z = s.player.prevZ = z;
  s.player.path = [];
}
/** Open floor in Glimmer Hollow (walls would push a player back out). */
const CAVE = (() => {
  const m = generateWorld(1337);
  const out: { x: number; z: number }[] = [];
  for (let z = HOLLOW.z; z < HOLLOW.z + 30; z++) for (let x = HOLLOW.x; x < HOLLOW.x + 30; x++) if (inHollow(x, z) && !isBlocked(m, x, z)) out.push({ x: x + 0.5, z: z + 0.5 });
  return out;
})();
const HOUSE_IN = { x: HOUSE.doorX + 0.5, z: HOUSE.z2 - 0.5 };
const DOORSTEP = { x: HOUSE.doorX + 0.5, z: HOUSE.z2 + 1.5 };

/** Each character is in exactly one zone, the one their position says, and no instance is empty. */
function checkZones(server: RunningServer) {
  const seen = new Map<number, string>();
  for (const [id, w] of server.zones) {
    for (const pid of w.players.keys()) {
      expect(seen.has(pid), `player ${pid} in ${seen.get(pid)} and ${id}`).toBe(false);
      seen.set(pid, id);
    }
    if (id.startsWith('house:')) expect(w.players.size, `${id} left open while empty`).toBeGreaterThan(0);
  }
  for (const s of server.sessions.values()) {
    expect(seen.get(s.playerId), s.name).toBe(s.zoneId);
    expect(s.world).toBe(server.zones.get(s.zoneId));
    expect(s.world.players.get(s.playerId)).toBe(s.player);
  }
  expect(seen.size).toBe(server.sessions.size);
}

function owned(p: Player, worldItems: { graves: { owner: number; items: { item: string; qty: number }[]; expired: boolean }[] }): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (item: string, n: number) => (out[item] = (out[item] ?? 0) + n);
  for (const s of p.inventory.slots) if (s) add(s.item, s.qty);
  for (const s of p.bank.toJSON()) if (s.qty > 0) add(s.item, s.qty);
  for (const s of p.shrineHeld) add(s.item, s.qty);
  for (const [slot, it] of Object.entries(p.equipment.slots)) if (it) add(it, slot === 'ammo' ? p.equipment.ammoQty : 1);
  for (const it of Object.values(p.toolbelt.slots)) if (it) add(it, 1);
  for (const g of worldItems.graves) if (g.owner === p.id && !g.expired) for (const s of g.items) add(s.item, s.qty);
  return out;
}

describe('3A.8 zones', () => {
  it('where a player stands decides the zone', () => {
    expect(zoneFor(HOUSE_IN.x, HOUSE_IN.z, 7)).toBe(houseZone(7));
    expect(zoneFor(DOORSTEP.x, DOORSTEP.z, 7)).toBe(BRIGHTWATER);
    expect(zoneFor(HOLLOW.x + 5, HOLLOW.z + 5, 7)).toBe(HOLLOW_ZONE);
    expect(inHouse(HOUSE.doorX + 0.5, HOUSE.z2 + 0.5)).toBe(false);
  });

  it('Brightwater and Glimmer Hollow each run their own creatures; a house runs none', async () => {
    const { s: server } = await serve();
    const island = server.zones.get(BRIGHTWATER)!;
    const hollow = server.zones.get(HOLLOW_ZONE)!;
    expect(island.enemies.length).toBeGreaterThan(10);
    expect(island.enemies.some((e) => inHollow(e.x, e.z))).toBe(false);
    expect(hollow.enemies.length).toBeGreaterThan(0);
    expect(hollow.enemies.every((e) => inHollow(e.x, e.z))).toBe(true);
    expect(hollow.npcs.length).toBe(0);
    expect([...server.zones.keys()].sort()).toEqual([BRIGHTWATER, HOLLOW_ZONE, 'old_watchtower', 'sunken_shrine']);
  }, 10_000);

  it('a house is a personal instance: opened on the way in, closed on the way out, private to its owner', async () => {
    const { s: server, url } = await serve();
    const a = await join(server, url, 'Ash');
    const b = await join(server, url, 'Brindle');
    await pump([a.c, b.c], 200);
    expect(b.c.world!.players.has(a.s.playerId)).toBe(true);
    put(a.s, HOUSE_IN.x, HOUSE_IN.z);
    await pump([a.c, b.c], 300);
    expect(a.s.zoneId).toBe(houseZone(a.s.playerId));
    expect(a.c.zone).toBe(houseZone(a.s.playerId));
    expect(server.zones.has(houseZone(a.s.playerId))).toBe(true);
    // Brindle no longer sees Ash, and Ash's view has no creatures or villagers in it.
    expect(b.c.world!.players.has(a.s.playerId)).toBe(false);
    expect(a.c.world!.offstage.size).toBe(a.c.world!.enemies.length + a.c.world!.npcs.length);
    // Brindle walks in too: their own house, still apart.
    put(b.s, HOUSE_IN.x, HOUSE_IN.z);
    await pump([a.c, b.c], 300);
    expect(b.s.zoneId).toBe(houseZone(b.s.playerId));
    expect(a.c.world!.players.has(b.s.playerId)).toBe(false);
    expect(b.c.world!.players.has(a.s.playerId)).toBe(false);
    checkZones(server);
    // Out again: the instances close and they see each other on the doorstep.
    put(a.s, DOORSTEP.x, DOORSTEP.z);
    put(b.s, DOORSTEP.x + 1, DOORSTEP.z);
    await pump([a.c, b.c], 400);
    expect([...server.zones.keys()].sort()).toEqual([BRIGHTWATER, HOLLOW_ZONE, 'old_watchtower', 'sunken_shrine']);
    expect(a.c.world!.players.has(b.s.playerId)).toBe(true);
    expect(a.c.zone).toBe(BRIGHTWATER);
    checkZones(server);
  }, 15_000);

  it('the Hollow passage hands the player over to the Hollow zone, and signing in again puts them back there', async () => {
    const dbPath = joinPath(mkdtempSync(joinPath(tmpdir(), 'bw-')), 'zones.sqlite');
    let { s: server, url } = await serve(dbPath);
    const a = await join(server, url, 'Ash');
    a.s.player.inventory.add('glowcap_lantern', 1);
    const mouth = server.zone.doorways.find((d) => d.def.id === 'hollow_mouth')!;
    put(a.s, mouth.def.arriveX, mouth.def.arriveZ);
    a.c.issue({ type: 'interact', target: mouth.id });
    await pump([a.c], 1500);
    expect(a.s.zoneId).toBe(HOLLOW_ZONE);
    expect(inHollow(a.s.player.x, a.s.player.z)).toBe(true);
    expect(server.zone.players.has(a.s.playerId)).toBe(false);
    expect(a.c.world!.player.inventory.count('glowcap_lantern')).toBe(1);
    // The Hollow's slimes are in Ash's view now.
    expect(a.c.world!.enemies.some((e) => inHollow(e.x, e.z) && !a.c.world!.offstage.has(e.id))).toBe(true);
    // The transfer was saved: a crash now keeps them in the Hollow.
    const token = a.c.session!;
    await server.close({ save: false });
    running.splice(running.indexOf(server), 1);
    ({ s: server, url } = await serve(dbPath));
    const again = await join(server, url, 'Ash', { kind: 'token', token });
    expect(again.s.zoneId).toBe(HOLLOW_ZONE);
    expect(again.c.zone).toBe(HOLLOW_ZONE);
    expect(again.s.player.inventory.count('glowcap_lantern')).toBe(1);
  }, 20_000);

  it('a wisp travels with its owner between zones', async () => {
    const { s: server, url } = await serve();
    const a = await join(server, url, 'Ash');
    server.zone.act(a.s.player, () => server.zone.spawnGrave(a.s.player.x, a.s.player.z, [{ item: 'logs', qty: 3 }]));
    const before = owned(a.s.player, a.s.world);
    put(a.s, CAVE[10].x, CAVE[10].z);
    await pump([a.c], 200);
    expect(a.s.zoneId).toBe(HOLLOW_ZONE);
    expect(server.zone.graves.length).toBe(0);
    expect(a.s.world.graves.map((g) => g.owner)).toEqual([a.s.playerId]);
    expect(owned(a.s.player, a.s.world)).toEqual(before);
  }, 10_000);

  it('under load: 30 players crossing between zones at random, dropping out and coming back, are never duplicated or lost', async () => {
    const { s: server, url } = await serve();
    const rng = mulberry32(0x3a8);
    const spots = [
      () => ({ x: server.zone.map.spawn.x + rng() * 6 - 3, z: server.zone.map.spawn.z + rng() * 6 - 3 }),
      () => ({ x: HOUSE_IN.x - rng() * 3, z: HOUSE_IN.z - rng() * 2 }),
      () => ({ x: DOORSTEP.x + rng() * 2, z: DOORSTEP.z }),
      () => CAVE[Math.floor(rng() * CAVE.length)],
    ];
    const accounts = await Promise.all(Array.from({ length: 10 }, (_, i) => join(server, url, `Acct${i}`)));
    const guests = await Promise.all(Array.from({ length: 20 }, (_, i) => join(server, url, `Guest${i}`, { kind: 'guest', name: `Guest${i}` })));
    for (const a of accounts) server.zone.act(a.s.player, () => server.zone.spawnGrave(a.s.player.x, a.s.player.z, [{ item: 'logs', qty: 2 }]));
    const everyone = [...accounts, ...guests];
    const start = new Map(accounts.map((a) => [a.name, owned(a.s.player, a.s.world)]));
    const tokens = new Map(accounts.map((a) => [a.name, a.c.session!]));
    let moves = 0;
    let drops = 0;
    for (let round = 0; round < 40; round++) {
      for (const w of everyone) {
        const s = w.s;
        if (!s) continue;
        if (rng() < 0.5) {
          const at = spots[Math.floor(rng() * spots.length)]();
          put(s, at.x, at.z);
          moves++;
        }
      }
      // Some accounts drop their connection, and some of those come back.
      if (rng() < 0.3) {
        const a = accounts[Math.floor(rng() * accounts.length)];
        if (a.s?.ws) {
          a.c.close();
          drops++;
        } else if (!server.sessions.has(a.key)) {
          const back = await join(server, url, a.name, { kind: 'token', token: tokens.get(a.name)! });
          Object.assign(a, { c: back.c, key: back.key });
        }
      }
      await pump(everyone.map((w) => w.c), 60);
      checkZones(server);
    }
    expect(moves).toBeGreaterThan(400);
    expect(drops).toBeGreaterThan(3);
    // Everyone is back: nothing an account owns was duplicated or lost by all that coming and going.
    await sleep(400);
    for (const a of accounts) {
      if (!server.sessions.has(a.key)) {
        const back = await join(server, url, a.name, { kind: 'token', token: tokens.get(a.name)! });
        Object.assign(a, { c: back.c, key: back.key });
      }
    }
    await pump(accounts.map((a) => a.c), 100);
    for (const a of accounts) expect(owned(a.s.player, a.s.world), a.name).toEqual(start.get(a.name));
    checkZones(server);
  }, 60_000);
});
