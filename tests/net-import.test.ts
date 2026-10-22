import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IMPORT_COIN_CAP, IMPORT_ITEM_CAP, IMPORT_MAX_XP, prepareImport, type ImportPolicy } from '../server/import';
import { startServer, type RunningServer } from '../server/server';
import { NetClient } from '../src/net/client';
import { PROTOCOL_VERSION, contentVersion, type Auth } from '../src/net/protocol';
import { GameWorld, type Player, type SaveData } from '../src/sim/world';
import { generateWorld } from '../src/sim/worldmap';

const FILES = import.meta.glob('./fixtures/saves/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const fixture = (name: string) => JSON.parse(FILES[`./fixtures/saves/${name}`]) as SaveData;
const FIXTURES = Object.keys(FILES).map((p) => p.split('/').pop()!);
const map = generateWorld(1337);
const clock = () => 1_790_000_100_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Everything a character owns, by item (bag, held, bank, gear, ammo, belt, shrine-held). */
function owned(w: GameWorld): Record<string, number> {
  return ownedP(w.player);
}
function ownedP(p: Player): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (item: string, n: number) => (out[item] = (out[item] ?? 0) + n);
  for (const s of p.inventory.slots) if (s) add(s.item, s.qty);
  for (const s of p.overflow) add(s.item, s.qty);
  for (const s of p.bank.toJSON()) if (s.qty > 0) add(s.item, s.qty);
  for (const s of p.shrineHeld) add(s.item, s.qty);
  for (const [slot, it] of Object.entries(p.equipment.slots)) if (it) add(it, slot === 'ammo' ? p.equipment.ammoQty : 1);
  for (const it of Object.values(p.toolbelt.slots)) if (it) add(it, 1);
  return out;
}
const current = () => new GameWorld({ name: 'Rowan', map, clock, playerId: 1_000_000 }).characterRecord();
const prep = (save: unknown, policy: ImportPolicy = 'full') => prepareImport(save, { map, clock, playerId: 1_000_000, name: 'Rowan', current: current(), policy });

describe('3A.4 preparing an import', () => {
  it('every fixture save from earlier batches comes across with its skills and every item', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(4);
    for (const f of FIXTURES) {
      const local = new GameWorld({ save: fixture(f), map, clock });
      const r = prep(fixture(f));
      expect(r.ok, f).toBe(true);
      if (!r.ok) continue;
      expect(owned(r.world), f).toEqual(owned(local));
      expect(r.world.player.skills.xp, f).toEqual(local.player.skills.xp);
      expect(r.world.player.name).toBe('Rowan');
      expect(r.record.name).toBe('Rowan');
      expect(r.report.some((l) => /capped/.test(l)), f).toBe(false);
      expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
    }
    // Older formats get the same one-time migrations as on the device: tools onto the belt, arrows worn.
    const pre = prep(fixture('p1-pretoolbelt.json'));
    expect(pre.ok && pre.world.player.toolbelt.get('pickaxe')).toBe('bronze_pickaxe');
    const mid = prep(fixture('p2-midgame.json'));
    expect(mid.ok && mid.world.player.equipment.get('ammo')).toBe('bronze_arrow');
    expect(mid.ok && mid.world.player.furniture.chair).toBe('crude_chair');
  });

  it('caps xp and item totals, and reports every change', () => {
    const save = fixture('p0-early.json') as SaveData & Record<string, unknown>;
    save.xp = { ...save.xp, attack: 9e8 };
    save.bank = [{ item: 'coins', qty: 9_000_000, tab: 0 } as never, { item: 'logs', qty: 40_000, tab: 0 } as never, { item: 'wishing_stone', qty: 3, tab: 0 } as never];
    save.x = -50;
    save.appearance = { bodyType: 7 } as never;
    const r = prep(save);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.world.player.skills.xp.attack).toBe(IMPORT_MAX_XP);
    expect(owned(r.world).coins).toBe(IMPORT_COIN_CAP);
    expect(owned(r.world).logs).toBe(IMPORT_ITEM_CAP);
    const text = r.report.join('\n');
    expect(text).toMatch(/Attack xp was capped/);
    expect(text).toMatch(/Coins was capped at 5,000,000 \(from 9,000,075\)/);
    expect(text).toMatch(/Logs was capped/);
    expect(text).toMatch(/Unknown items were left behind: wishing_stone/);
    expect(text).toMatch(/village shrine/);
    expect(text).toMatch(/looks could not be read/);
    expect(text).toMatch(/called Rowan here/);
    expect(r.world.player.appearance).toEqual(current().appearance);
  });

  it('the practice market, ground piles and wisps never come across', () => {
    const r = prep(fixture('batch-11-full.json'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.world.groundItems.length).toBe(0);
    expect(r.world.graves.length).toBe(0);
    expect(Object.keys(r.record)).not.toContain('exchangePractice');
    // Shrine-held items are the character's, so they do come.
    expect(r.world.player.shrineHeld).toEqual([{ item: 'iron_sword', qty: 1 }]);
  });

  it('policy "progress" brings skills, quests and house but not items; "off" brings nothing', () => {
    const r = prep(fixture('p2-midgame.json'), 'progress');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.world.player.skills.xp.ranged).toBe(9000);
    expect(r.world.player.furniture.chair).toBe('crude_chair');
    expect(owned(r.world)).toEqual(owned(new GameWorld({ save: { ...current(), name: 'Rowan' } as SaveData, map, clock })));
    expect(r.report.join()).toMatch(/Items and coins start fresh/);
    expect(prep(fixture('p2-midgame.json'), 'off').ok).toBe(false);
  });

  it('refuses things that are not saves', () => {
    for (const bad of [null, [], 'save', { version: 2, name: 'x' }, { name: 'no version' }]) expect(prep(bad).ok).toBe(false);
    expect(prep({ ...fixture('p0-early.json'), bank: 'x'.repeat(300 * 1024) }).ok).toBe(false);
  });
});

const running: RunningServer[] = [];
const clients: NetClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const s of running.splice(0)) await s.close().catch(() => {});
});
async function serve(dbPath = ':memory:', extra: Parameters<typeof startServer>[0] = {}) {
  const s = await startServer({ port: 0, dbPath, log: () => {}, ...extra });
  running.push(s);
  return { s, url: `ws://127.0.0.1:${s.port}` };
}
async function client(url: string, auth: Auth) {
  const c = new NetClient({ url, auth });
  clients.push(c);
  const world = await c.connect();
  return { c, world };
}
async function pump(c: NetClient, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await sleep(16);
    c.update(0.016);
  }
}

describe('3A.4 importing over the network', () => {
  it('brings a save onto an account; it survives a restart and is recorded', async () => {
    const db = join(mkdtempSync(join(tmpdir(), 'bw-')), 'import.sqlite');
    const first = await serve(db);
    const { c, world } = await client(first.url, { kind: 'register', username: 'Rowan', password: 'brightwater1' });
    const local = fixture('batch-11-full.json');
    const untouched = JSON.stringify(local);
    const report = await c.importSave(local);
    expect(JSON.stringify(local)).toBe(untouched);
    expect(report.some((l) => /called Rowan/.test(l))).toBe(true);
    await pump(c, 400);
    expect(world.player.skills.level('mining')).toBe(42);
    expect(world.player.bank.count('coins')).toBe(5000);
    expect(world.player.name).toBe('Rowan');
    const s = [...first.s.sessions.values()][0];
    expect(ownedP(s.player)).toEqual(owned(world));
    expect(first.s.repos.importReport(s.accountId!)).toEqual(report);
    expect(first.s.repos.auditLog(s.accountId!).some((e) => e.kind === 'import')).toBe(true);
    await first.s.close();
    running.splice(running.indexOf(first.s), 1);
    const second = await serve(db);
    const again = await client(second.url, { kind: 'token', token: c.session! });
    expect(again.world.player.skills.level('mining')).toBe(42);
    expect(owned(again.world)).toEqual(owned(world));
  }, 20_000);

  it('only once per account, and the same save only once anywhere', async () => {
    const { url } = await serve();
    const a = await client(url, { kind: 'register', username: 'Ash', password: 'brightwater1' });
    await a.c.importSave(fixture('p2-midgame.json'));
    await expect(a.c.importSave(fixture('p1-pretoolbelt.json'))).rejects.toThrow(/already brought a character/);
    const b = await client(url, { kind: 'register', username: 'Brindle', password: 'brightwater1' });
    await expect(b.c.importSave(fixture('p2-midgame.json'))).rejects.toThrow(/already been brought over/);
    await sleep(5100);
    await expect(b.c.importSave(fixture('p1-pretoolbelt.json'))).resolves.toBeInstanceOf(Array);
  }, 20_000);

  it('a server with imports off refuses them', async () => {
    const { url } = await serve(':memory:', { importPolicy: 'off' });
    const { c } = await client(url, { kind: 'register', username: 'Corra', password: 'brightwater1' });
    await expect(c.importSave(fixture('p0-early.json'))).rejects.toThrow(/switched off/);
  }, 10_000);

  it('guests and signed-out connections cannot import (large messages are refused unread)', async () => {
    const { url } = await serve(':memory:', { allowGuests: true });
    const guest = await client(url, { kind: 'guest', name: 'Visitor' });
    const events: string[] = [];
    guest.c.importSave(fixture('p0-early.json')).catch(() => {});
    await pump(guest.c, 300);
    for (const e of guest.c.drainEvents()) if (e.type === 'message') events.push(e.text);
    expect(events.join()).toMatch(/Invalid message/);
    // Before signing in, even a well-formed import is refused: anything bigger than a hello closes
    // the connection unread (3B.1), and a small one is invalid.
    const ws = new WebSocket(url);
    const got: string[] = [];
    let closed = false;
    await new Promise<void>((r) => (ws.onopen = () => r()));
    ws.onmessage = (e) => got.push(String(e.data));
    ws.onclose = () => (closed = true);
    ws.send(JSON.stringify({ t: 'import', save: fixture('batch-11-full.json') }));
    ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, content: contentVersion(map), auth: { kind: 'guest', name: 'Late' } }));
    await sleep(300);
    expect(closed).toBe(true);
    expect(got).toEqual([]);
    const ws2 = new WebSocket(url);
    await new Promise<void>((r) => (ws2.onopen = () => r()));
    ws2.onmessage = (e) => got.push(String(e.data));
    ws2.send(JSON.stringify({ t: 'import', save: { version: 1 } }));
    await sleep(200);
    expect(got[0]).toMatch(/Invalid message/);
    ws2.close();
  }, 10_000);
});
