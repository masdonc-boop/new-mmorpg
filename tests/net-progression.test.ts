import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { startServer, type RunningServer, type Session } from '../server/server';
import { NetClient } from '../src/net/client';
import { xpForLevel } from '../src/data/skills';
import type { GameEvent } from '../src/sim/world';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const running: RunningServer[] = [];
const clients: NetClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const s of running.splice(0)) await s.close().catch(() => {});
});
const freshDb = () => joinPath(mkdtempSync(joinPath(tmpdir(), 'bw-')), 'prog.sqlite');
async function serve(dbPath: string, port = 0) {
  const s = await startServer({ port, dbPath, log: () => {}, graceMs: 150 });
  running.push(s);
  return { s, url: `ws://127.0.0.1:${s.port}` };
}
interface Who {
  c: NetClient;
  s: Session;
  events: GameEvent[];
}
async function join(server: RunningServer, url: string, name: string, kind: 'register' | 'login' = 'register'): Promise<Who> {
  const c = new NetClient({ url, auth: { kind, username: name, password: 'brightwater1' } } as ConstructorParameters<typeof NetClient>[0]);
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

describe('4B multiplayer: progression stays server-side', () => {
  it('a training focus set on the phone reaches the server, directs xp there, and survives a restart', async () => {
    const dbPath = freshDb();
    const { s: server, url } = await serve(dbPath);
    const a = await join(server, url, 'Ash');
    a.c.issue({ type: 'setFocus', focus: 'defence' });
    await pump([a], 200);
    expect(a.s.player.focus).toBe('defence');
    server.saveAll();
    const port = server.port;
    a.c.close();
    await server.close({ save: true });
    running.splice(running.indexOf(server), 1);
    const again = await serve(dbPath, port);
    const b = await join(again.s, again.url, 'Ash', 'login');
    expect(b.s.player.focus).toBe('defence');
    // Junk from a modified client is refused.
    b.c.issue({ type: 'setFocus', focus: 'everything' } as never);
    await pump([b], 150);
    expect(b.s.player.focus).toBe('defence');
  }, 15_000);

  it('the server enforces quest requirements: a client can’t start a regional quest early', async () => {
    const { s: server, url } = await serve(':memory:');
    const a = await join(server, url, 'Ash');
    a.c.issue({ type: 'acceptQuest', quest: 'ninefold_watch' });
    await pump([a], 200);
    expect(a.s.player.quests.ninefold_watch).toBeUndefined();
    a.s.player.quests.elders_request = { stage: 3, kills: 0, done: true };
    for (const sk of ['attack', 'strength', 'defence', 'hitpoints'] as const) a.s.player.skills.addXp(sk, xpForLevel(25));
    a.c.issue({ type: 'acceptQuest', quest: 'ninefold_watch' });
    await pump([a], 200);
    expect(a.s.player.quests.ninefold_watch?.stage).toBe(1);
  }, 10_000);

  it('new gear trades between players like any item, saved for both at once', async () => {
    const { s: server, url } = await serve(':memory:');
    const a = await join(server, url, 'Ash');
    const b = await join(server, url, 'Brindle');
    a.s.player.inventory.add('rowan_longbow', 1);
    b.s.player.inventory.add('steel_arrow', 50);
    b.s.player.x = b.s.player.prevX = a.s.player.x + 1;
    b.s.player.z = b.s.player.prevZ = a.s.player.z;
    const slot = (w: Who, item: string) => w.s.player.inventory.slots.findIndex((x) => x?.item === item);
    for (const step of [
      () => a.c.issue({ type: 'tradeRequest', target: b.s.playerId }),
      () => b.c.issue({ type: 'tradeRequest', target: a.s.playerId }),
      () => a.c.issue({ type: 'tradeOffer', slot: slot(a, 'rowan_longbow'), qty: 1 }),
      () => b.c.issue({ type: 'tradeOffer', slot: slot(b, 'steel_arrow'), qty: 50 }),
      () => a.c.issue({ type: 'tradeAccept' }),
      () => b.c.issue({ type: 'tradeAccept' }),
      () => a.c.issue({ type: 'tradeAccept' }),
      () => b.c.issue({ type: 'tradeAccept' }),
    ]) {
      step();
      await pump([a, b], 120);
    }
    expect(a.s.player.inventory.count('steel_arrow')).toBe(50);
    expect(b.s.player.inventory.count('rowan_longbow')).toBe(1);
    expect(a.s.player.inventory.count('rowan_longbow')).toBe(0);
    expect(server.repos.ledger().map((l) => l.item).sort()).toEqual(['rowan_longbow', 'steel_arrow']);
  }, 15_000);
});

describe('4C multiplayer: dungeons on the server', () => {
  it('two players in the tower’s zone defeat the captain together, each opens the chest, and the server keeps it through a restart', async () => {
    const dbPath = freshDb();
    const { s: server, url } = await serve(dbPath);
    const a = await join(server, url, 'Ash');
    const b = await join(server, url, 'Brindle');
    const roof = server.zone.map.passages.find((p) => p.id === 'tower_down_roof')!;
    for (const w of [a, b]) {
      w.s.player.x = w.s.player.prevX = roof.arriveX;
      w.s.player.z = w.s.player.prevZ = roof.arriveZ;
    }
    await pump([a, b], 1300);
    expect(a.s.zoneId).toBe('old_watchtower');
    expect(b.s.zoneId).toBe('old_watchtower');
    const tower = server.zones.get('old_watchtower')!;
    const boss = tower.enemies.find((e) => e.def.id === 'watchcaptain')!;
    const strike = (who: Who, dmg: number) => tower.act(who.s.player, () => (tower as unknown as { damageEnemy: (e: unknown, d: number, h: boolean, s: string) => void }).damageEnemy(boss, dmg, true, 'melee'));
    strike(a, 200);
    strike(b, boss.hp);
    expect(a.s.player.dungeonClaims.old_watchtower).toBe(1);
    expect(b.s.player.dungeonClaims.old_watchtower).toBe(1);
    const chest = tower.chests[0];
    for (const w of [a, b]) {
      const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([x, z]) => !tower.map.blocked[Math.floor(chest.z + z) * tower.map.width + Math.floor(chest.x + x)])!;
      w.s.player.x = w.s.player.prevX = chest.x + side[0];
      w.s.player.z = w.s.player.prevZ = chest.z + side[1];
      w.c.issue({ type: 'interact', target: chest.id });
    }
    await pump([a, b], 600);
    expect(a.s.player.dungeonRuns.old_watchtower).toBe(1);
    expect(b.s.player.dungeonRuns.old_watchtower).toBe(1);
    expect(a.events.some((e) => e.type === 'chest')).toBe(true);
    server.saveAll();
    const port = server.port;
    a.c.close();
    b.c.close();
    await server.close({ save: true });
    running.splice(running.indexOf(server), 1);
    const again = await serve(dbPath, port);
    const a2 = await join(again.s, again.url, 'Ash', 'login');
    expect(a2.s.zoneId).toBe('old_watchtower');
    expect(a2.s.player.dungeonRuns.old_watchtower).toBe(1);
    expect(a2.s.player.dungeonClaims.old_watchtower ?? 0).toBe(0);
  }, 20_000);

  it('the server checks the door: a client can’t walk into a dungeon without its requirements', async () => {
    const { s: server, url } = await serve(':memory:');
    const a = await join(server, url, 'Ash');
    const door = server.zone.doorways.find((d) => d.def.id === 'sunken_shrine_door')!;
    a.s.player.x = a.s.player.prevX = door.def.arriveX;
    a.s.player.z = a.s.player.prevZ = door.def.arriveZ;
    a.c.issue({ type: 'interact', target: door.id });
    await pump([a], 1500);
    expect(a.s.zoneId).toBe('brightwater');
  }, 10_000);
});

describe('4D multiplayer: the collection log is server-side and permanent', () => {
  it('a unique found on the server reaches the phone, is saved at once, and survives a reconnect and a restart; repeated taps give one reward', async () => {
    const dbPath = freshDb();
    const { s: server, url } = await serve(dbPath);
    const a = await join(server, url, 'Ash');
    const roof = server.zone.map.passages.find((p) => p.id === 'tower_down_roof')!;
    a.s.player.x = a.s.player.prevX = roof.arriveX;
    a.s.player.z = a.s.player.prevZ = roof.arriveZ;
    await pump([a], 1300);
    const tower = server.zones.get('old_watchtower')!;
    a.s.player.dungeonClaims.old_watchtower = 1;
    (tower as unknown as { rng: () => number }).rng = () => 0.001;
    const chest = tower.chests[0];
    const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([x, z]) => !tower.map.blocked[Math.floor(chest.z + z) * tower.map.width + Math.floor(chest.x + x)])!;
    a.s.player.x = a.s.player.prevX = chest.x + side[0];
    a.s.player.z = a.s.player.prevZ = chest.z + side[1];
    // A burst of taps (and a resend) from the phone.
    for (let i = 0; i < 6; i++) a.c.issue({ type: 'interact', target: chest.id });
    await pump([a], 700);
    expect(a.s.player.dungeonRuns.old_watchtower).toBe(1);
    expect(a.s.player.collectionLog.size).toBe(3);
    // The phone's copy shows it (for the journal).
    expect(a.c.world!.player.collectionLog.size).toBe(3);
    // Saved the moment the chest opened, before any periodic save.
    const stored = server.repos.characterFor(a.s.accountId!)!.record as { dungeons?: { log?: string[]; runs?: Record<string, number> } };
    expect(stored.dungeons?.log?.length).toBe(3);
    expect(stored.dungeons?.runs?.old_watchtower).toBe(1);
    // Sold, dropped, whatever: the log stays.
    for (const u of ['ninefold_cloak', 'warders_longbow', 'watchcaptain_blade'] as const) a.s.player.inventory.remove(u, 1);
    // A dropped connection and back.
    a.s.ws!.terminate();
    await pump([a], 300);
    const port = server.port;
    a.c.close();
    await server.close({ save: true });
    running.splice(running.indexOf(server), 1);
    const again = await serve(dbPath, port);
    const a2 = await join(again.s, again.url, 'Ash', 'login');
    expect([...a2.s.player.collectionLog].sort()).toEqual(['ninefold_cloak', 'warders_longbow', 'watchcaptain_blade']);
    expect(a2.c.world!.player.collectionLog.size).toBe(3);
    expect(a2.s.player.inventory.count('watchcaptain_blade')).toBe(0);
  }, 20_000);
});

describe('5A multiplayer: skills, gear and coins stay server-side', () => {
  it('the server refuses gear above your level and forged xp, accepts it once earned, and keeps it all through a restart', async () => {
    const dbPath = freshDb();
    const { s: server, url } = await serve(dbPath);
    const a = await join(server, url, 'Ash');
    const p = a.s.player;
    p.inventory.add('rowan_longbow', 1);
    p.inventory.add('coins', 150_000);
    await pump([a], 200);
    const slot = () => p.inventory.slots.findIndex((x) => x?.item === 'rowan_longbow');
    // Ranged 1: the phone asks, the server says no, and the bow stays in the bag.
    a.c.issue({ type: 'equip', slot: slot() });
    await pump([a], 300);
    expect(p.equipment.get('weapon')).toBeNull();
    expect(p.inventory.count('rowan_longbow')).toBe(1);
    // Commands that would hand out xp, or a level, don't exist; a phone editing its own copy changes nothing.
    const xpBefore = { ...p.skills.xp };
    a.c.issue({ type: 'grantXp', skill: 'ranged', amount: 1e7 } as never);
    a.c.issue({ type: 'setLevel', skill: 'ranged', level: 99 } as never);
    a.c.world!.player.skills.xp.ranged = 1e7;
    a.c.issue({ type: 'equip', slot: slot() });
    await pump([a], 300);
    expect(p.skills.xp).toEqual(xpBefore);
    expect(p.equipment.get('weapon')).toBeNull();
    // Earned on the server: now it goes on, with the longbow's own pace and reach.
    p.skills.addXp('ranged', xpForLevel(40));
    a.c.issue({ type: 'equip', slot: slot() });
    await pump([a], 300);
    expect(p.equipment.get('weapon')).toBe('rowan_longbow');
    expect(p.equipment.attackProfile('ranged')).toEqual({ seconds: 2, range: 8.5 });
    expect(a.c.world!.player.equipment.get('weapon')).toBe('rowan_longbow');
    // A restart keeps the level, the worn bow and a purse past the old 99,999 cap.
    server.saveAll();
    const port = server.port;
    a.c.close();
    await server.close({ save: true });
    running.splice(running.indexOf(server), 1);
    const again = await serve(dbPath, port);
    const b = await join(again.s, again.url, 'Ash', 'login');
    expect(b.s.player.skills.level('ranged')).toBe(40);
    expect(b.s.player.equipment.get('weapon')).toBe('rowan_longbow');
    expect(b.s.player.inventory.count('coins')).toBe(150_025);
    await pump([b], 300);
    expect(b.c.world!.player.inventory.count('coins')).toBe(150_025);
  }, 15_000);
});
