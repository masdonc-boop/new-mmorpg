import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { startServer, type RunningServer, type Session } from '../server/server';
import { liveAccount } from '../server/liveexchange';
import { NetClient } from '../src/net/client';
import { Exchange, fnv } from '../src/exchange/engine';
import { mergeSave } from '../src/sim/records';
import { GameWorld, type GameEvent, type Player } from '../src/sim/world';
import { generateWorld } from '../src/sim/worldmap';
import { mulberry32 } from '../src/core/rng';
import type { LiveIntent, LiveResult } from '../src/net/protocol';

/** A request without its number (the helper adds one). */
type Ask = LiveIntent extends infer T ? (T extends LiveIntent ? Omit<T, 'nonce'> : never) : never;

const map = generateWorld(1337);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const running: RunningServer[] = [];
const clients: NetClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const s of running.splice(0)) await s.close().catch(() => {});
});

async function serve(opts: { dbPath?: string; live?: boolean } = {}) {
  const s = await startServer({ port: 0, dbPath: opts.dbPath ?? ':memory:', log: () => {}, allowGuests: true, liveExchange: opts.live ?? true });
  running.push(s);
  return { s, url: `ws://127.0.0.1:${s.port}` };
}

interface Who {
  name: string;
  c: NetClient;
  s: Session;
  results: Map<number, LiveResult>;
  events: GameEvent[];
}
async function join(server: RunningServer, url: string, name: string, auth?: object): Promise<Who> {
  const c = new NetClient({ url, auth: (auth ?? { kind: 'register', username: name, password: 'brightwater1' }) as never });
  clients.push(c);
  await c.connect();
  const s = [...server.sessions.values()].find((x) => x.name.toLowerCase() === name.toLowerCase())!;
  return { name, c, s, results: new Map(), events: [] };
}
/** Stands a player at an Exchange clerk (as talking to one does). */
function atClerk(server: RunningServer, s: Session) {
  const clerk = server.zone.npcs.find((n) => n.def.service === 'exchange')!;
  s.player.x = s.player.prevX = clerk.x + 1;
  s.player.z = s.player.prevZ = clerk.z;
  s.player.exchangeAt = clerk.id;
}
async function pump(who: Who[], ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await sleep(10);
    for (const w of who) {
      w.c.update(0.01);
      for (const e of w.c.drainEvents()) {
        w.events.push(e);
        if (e.type === 'exchangeResult' && e.live) w.results.set(e.nonce, e.result);
      }
    }
  }
}
/** Sends one request and waits for its result. */
async function ask(w: Who, req: Ask, nonce?: number): Promise<LiveResult> {
  const n = nonce ?? (Math.max(0, ...w.results.keys(), (w.c.liveView?.nonce ?? 1) - 1) + 1);
  w.c.gx({ ...req, nonce: n } as LiveIntent);
  const end = Date.now() + 3000;
  while (!w.results.has(n) && Date.now() < end) await pump([w], 10);
  return w.results.get(n)!;
}

/** Everything a character owns, by item, wherever it is on them. */
function owned(p: Player): Record<string, number> {
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
/** What a character owns as saved in the database. */
function savedOwned(server: RunningServer, accountId: number) {
  const row = server.repos.characterFor(accountId)!;
  return owned(new GameWorld({ save: mergeSave({ character: row.record }), map, clock: () => 0 }).player);
}
/** Every asset across these characters (as saved) plus everything held by the exchange. */
function worldTotals(server: RunningServer, ids: number[], engine: Exchange | null) {
  const out: Record<string, number> = {};
  for (const id of ids) for (const [k, v] of Object.entries(savedOwned(server, id))) out[k] = (out[k] ?? 0) + v;
  const supply = (engine?.toJSON().supply ?? {}) as Record<string, number>;
  for (const [k, v] of Object.entries(supply)) if (v) out[k] = (out[k] ?? 0) + v;
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return out;
}
/** The audit chain as stored in the database, checked from its first entry. */
function chainProblems(server: RunningServer): string[] {
  let prev = '00000000';
  const rows = server.repos.exchangeAudit();
  for (let i = 0; i < rows.length; i++) {
    const { hash, ...rest } = rows[i];
    if (rest.seq !== i + 1) return [`gap before #${rest.seq}`];
    if (fnv(prev + JSON.stringify(rest)) !== hash) return [`broken at #${rest.seq}`];
    prev = hash;
  }
  return [];
}

describe('3A.7 live Exchange: switched off', () => {
  it('is off unless the server switches it on; the practice market is unaffected', async () => {
    const { s: server, url } = await serve({ live: false });
    const a = await join(server, url, 'Ash');
    expect(a.c.features.liveExchange).toBe(false);
    expect(server.live).toBeNull();
    a.c.gx({ op: 'cancel', nonce: 1, orderId: 1 });
    await pump([a], 200);
    expect(a.events.some((e) => e.type === 'message' && /isn’t open/.test(e.text))).toBe(true);
    expect(a.results.size).toBe(0);
  }, 10_000);
});

describe('3A.7 live Exchange: the bank bridge', () => {
  it('a sale and a purchase between two accounts: escrow from the bank, proceeds to bag then bank, all saved', async () => {
    const { s: server, url } = await serve();
    const a = await join(server, url, 'Ash');
    const b = await join(server, url, 'Brindle');
    expect(a.c.features.liveExchange).toBe(true);
    a.s.player.bank.add('logs', 30);
    b.s.player.bank.add('coins', 1000);
    server.saveAll();
    atClerk(server, a.s);
    atClerk(server, b.s);
    const coinsB = owned(b.s.player).coins;

    let r = await ask(a, { op: 'place', slot: 0, side: 'sell', item: 'logs', qty: 10, price: 5 });
    expect(r.ok).toBe(true);
    // The logs left the bank, and that is already saved with the offer.
    expect(a.s.player.bank.count('logs')).toBe(20);
    expect(savedOwned(server, a.s.accountId!).logs).toBe(20);

    r = await ask(b, { op: 'place', slot: 0, side: 'buy', item: 'logs', qty: 10, price: 6 });
    expect(r.ok && r.trades?.length).toBe(1);
    expect(r.ok && r.trades![0].price).toBe(5);
    expect(owned(b.s.player).coins).toBe(coinsB - 60);
    await pump([a, b], 100);
    expect(a.events.some((e) => e.type === 'message' && /offers has been filled/.test(e.text))).toBe(true);

    const bo = b.c.liveView!.orders[0];
    r = await ask(b, { op: 'collect', orderId: bo.id });
    expect(r.ok).toBe(true);
    // The 10 logs go into the bag (one per slot) and the 10 coins of change with them.
    expect(b.s.player.inventory.count('logs')).toBe(10);
    expect(owned(b.s.player).coins).toBe(coinsB - 50);
    expect(r.note).toMatch(/into your bag/);

    const ao = a.c.liveView!.orders[0];
    r = await ask(a, { op: 'collect', orderId: ao.id });
    expect(r.ok).toBe(true);
    expect(a.c.liveView!.orders).toEqual([]);
    expect(savedOwned(server, a.s.accountId!).coins).toBe(owned(a.s.player).coins);

    // The trade, the audit chain and the accounts all line up.
    expect(server.repos.exchangeTrades().map((t) => [t.qty, t.price, t.buyer, t.seller])).toEqual([[10, 5, liveAccount(b.s.accountId!), liveAccount(a.s.accountId!)]]);
    expect(server.live!.x.verify()).toEqual([]);
    expect(chainProblems(server)).toEqual([]);
    expect(b.c.liveView!.mine).toEqual([expect.objectContaining({ qty: 10, price: 5, bought: true })]);
    // Nobody is named to anyone.
    expect(JSON.stringify(b.c.liveView)).not.toContain(liveAccount(a.s.accountId!));
  }, 15_000);

  it('proceeds that fit nowhere wait in exchange storage until there is room', async () => {
    const { s: server, url } = await serve();
    const a = await join(server, url, 'Ash');
    const b = await join(server, url, 'Brindle');
    a.s.player.bank.add('iron_bar', 5);
    b.s.player.bank.add('coins', 1000);
    atClerk(server, a.s);
    atClerk(server, b.s);
    await ask(a, { op: 'place', slot: 0, side: 'sell', item: 'iron_bar', qty: 5, price: 20 });
    await ask(b, { op: 'place', slot: 0, side: 'buy', item: 'iron_bar', qty: 5, price: 20 });
    // B's bag and bank are both full.
    while (b.s.player.inventory.freeSlots() > 0) b.s.player.inventory.add('bronze_sword', 1);
    b.s.player.bank.capacity = b.s.player.bank.usedSlots();
    const r = await ask(b, { op: 'collect', orderId: b.c.liveView!.orders[0].id });
    expect(r.ok).toBe(true);
    expect(r.note).toMatch(/5 iron bar wait in exchange storage/);
    expect(b.c.liveView!.holdings).toEqual([{ asset: 'iron_bar', qty: 5 }]);
    expect(b.c.liveView!.orders).toEqual([]);
    expect((await ask(b, { op: 'claim' })).ok).toBe(false);
    b.s.player.inventory.remove('bronze_sword', 3);
    const c = await ask(b, { op: 'claim' });
    expect(c.ok && c.note).toMatch(/3 iron bar into your bag.*2 iron bar wait/);
    expect(server.live!.x.verify()).toEqual([]);
  }, 15_000);

  it('only signed-in accounts at a clerk, never mid-trade; retries are safe and old requests refused', async () => {
    const { s: server, url } = await serve();
    const g = await join(server, url, 'Visitor', { kind: 'guest', name: 'Visitor' });
    const a = await join(server, url, 'Ash');
    a.s.player.bank.add('logs', 10);
    expect((await ask(g, { op: 'claim' })).ok).toBe(false);
    let r = await ask(a, { op: 'place', slot: 0, side: 'sell', item: 'logs', qty: 2, price: 5 });
    expect(r.ok === false && r.error).toMatch(/clerk/);
    atClerk(server, a.s);
    r = await ask(a, { op: 'place', slot: 0, side: 'sell', item: 'logs', qty: 2, price: 5 }, 10);
    expect(r.ok).toBe(true);
    a.results.delete(10);
    // The same request again (a retry after a dropped reply): same answer, applied once.
    const again = await ask(a, { op: 'place', slot: 0, side: 'sell', item: 'logs', qty: 2, price: 5 }, 10);
    expect(again.replayed).toBe(true);
    expect(a.s.player.bank.count('logs')).toBe(8);
    expect((await ask(a, { op: 'cancel', orderId: 1 }, 9)).ok).toBe(false);
    // Asking for more than the bank and bag hold changes nothing.
    r = await ask(a, { op: 'place', slot: 1, side: 'sell', item: 'logs', qty: 50, price: 5 });
    expect(r.ok === false && r.error).toMatch(/don’t have 50 logs/);
    expect(a.s.player.bank.count('logs')).toBe(8);
    expect(server.live!.x.verify()).toEqual([]);
  }, 15_000);

  it('a request whose save fails changes nothing, in memory or on disk, and can simply be retried', async () => {
    const { s: server, url } = await serve();
    const a = await join(server, url, 'Ash');
    a.s.player.bank.add('logs', 10);
    server.saveAll();
    atClerk(server, a.s);
    const before = { bag: JSON.stringify(a.s.player.inventory.toJSON()), bank: JSON.stringify(a.s.player.bank.toJSON()), engine: JSON.stringify(server.live!.x.toJSON()) };
    const real = server.repos.commitExchange.bind(server.repos);
    let fail = true;
    server.repos.commitExchange = (...args) => {
      if (fail) throw new Error('disk full');
      return real(...args);
    };
    const r = await ask(a, { op: 'place', slot: 0, side: 'sell', item: 'logs', qty: 4, price: 5 }, 1);
    expect(r.ok === false && r.error).toMatch(/Nothing changed/);
    expect({ bag: JSON.stringify(a.s.player.inventory.toJSON()), bank: JSON.stringify(a.s.player.bank.toJSON()), engine: JSON.stringify(server.live!.x.toJSON()) }).toEqual(before);
    expect(server.repos.exchangeState()).toBeNull();
    fail = false;
    a.results.clear();
    expect((await ask(a, { op: 'place', slot: 0, side: 'sell', item: 'logs', qty: 4, price: 5 }, 1)).ok).toBe(true);
    expect(a.s.player.bank.count('logs')).toBe(6);
  }, 15_000);
});

describe('3A.7 live Exchange: crashes and randomized sessions', () => {
  it('a crash straight after placing or collecting keeps the character and the market in step', async () => {
    const dbPath = joinPath(mkdtempSync(joinPath(tmpdir(), 'bw-')), 'gx.sqlite');
    let { s: server, url } = await serve({ dbPath });
    const a = await join(server, url, 'Ash');
    const b = await join(server, url, 'Brindle');
    a.s.player.bank.add('logs', 40);
    b.s.player.bank.add('coins', 2000);
    server.saveAll();
    const ids = [a.s.accountId!, b.s.accountId!];
    const start = worldTotals(server, ids, server.live!.x);
    atClerk(server, a.s);
    atClerk(server, b.s);
    await ask(a, { op: 'place', slot: 0, side: 'sell', item: 'logs', qty: 25, price: 7 });
    await ask(b, { op: 'place', slot: 0, side: 'buy', item: 'logs', qty: 10, price: 9 });
    await ask(b, { op: 'collect', orderId: b.c.liveView!.orders[0].id });
    // A crash: nothing is saved on the way down (no periodic save has run either).
    await server.close({ save: false });
    running.splice(running.indexOf(server), 1);
    ({ s: server, url } = await serve({ dbPath }));
    const x = server.live!.x;
    expect(x.verify()).toEqual([]);
    expect(worldTotals(server, ids, x)).toEqual(start);
    expect(savedOwned(server, a.s.accountId!).logs).toBe(15);
    expect(savedOwned(server, b.s.accountId!).logs).toBe(10);
    expect(x.ordersOf(liveAccount(a.s.accountId!))[0]).toEqual(expect.objectContaining({ filled: 10, escrowItems: 15, boxCoins: 70 }));
    expect(chainProblems(server)).toEqual([]);
  }, 20_000);

  it('randomized: four accounts trade at random, with retries and restarts; verify() and the audit chain hold and nothing is created or lost', async () => {
    const dbPath = joinPath(mkdtempSync(joinPath(tmpdir(), 'bw-')), 'gx-fuzz.sqlite');
    let { s: server, url } = await serve({ dbPath });
    const names = ['Ash', 'Brindle', 'Corra', 'Dunmore'];
    let who: Who[] = [];
    const tokens: string[] = [];
    for (const n of names) {
      const w = await join(server, url, n);
      w.s.player.bank.add('coins', 5000);
      w.s.player.bank.add('logs', 60);
      w.s.player.bank.add('copper_ore', 40);
      who.push(w);
      tokens.push(w.c.session!);
    }
    server.saveAll();
    const ids = who.map((w) => w.s.accountId!);
    const start = worldTotals(server, ids, server.live!.x);
    const rng = mulberry32(0x3a7);
    const pick = <T,>(a: readonly T[]) => a[Math.floor(rng() * a.length)];
    let placed = 0;
    let filled = 0;
    for (let round = 0; round < 3; round++) {
      for (const w of who) {
        atClerk(server, w.s);
        w.c.gxOpen();
      }
      await pump(who, 100);
      for (let i = 0; i < 70; i++) {
        const w = pick(who);
        const view = w.c.liveView;
        const orders = view?.orders ?? [];
        const r = rng();
        let req: Ask;
        if (r < 0.5) {
          const free = [0, 1, 2, 3, 4, 5].filter((s) => !orders.some((o) => o.slot === s));
          req = { op: 'place', slot: free.length ? pick(free) : 0, side: rng() < 0.5 ? 'buy' : 'sell', item: pick(['logs', 'copper_ore'] as const), qty: 1 + Math.floor(rng() * 12), price: 3 + Math.floor(rng() * 6) };
        } else if (r < 0.65 && orders.length) req = { op: 'cancel', orderId: pick(orders).id };
        else if (r < 0.95 && orders.length) req = { op: 'collect', orderId: pick(orders).id };
        else req = { op: 'claim' };
        const n = Math.max(0, ...w.results.keys(), (view?.nonce ?? 1) - 1) + 1;
        const res = await ask(w, req, n);
        if (res.ok && req.op === 'place') placed++;
        if (res.ok && res.trades?.length) filled++;
        // Now and then the reply is "lost" and the client sends the same request again.
        if (rng() < 0.1) {
          w.results.delete(n);
          expect((await ask(w, req, n)).replayed).toBe(true);
        }
        expect(server.live!.x.verify()).toEqual([]);
      }
      // A crash and restart between rounds.
      await server.close({ save: round % 2 === 1 });
      running.splice(running.indexOf(server), 1);
      for (const w of who) clients.splice(clients.indexOf(w.c), 1);
      ({ s: server, url } = await serve({ dbPath }));
      expect(server.live!.x.verify()).toEqual([]);
      expect(worldTotals(server, ids, server.live!.x)).toEqual(start);
      expect(chainProblems(server)).toEqual([]);
      who = await Promise.all(names.map((n, i) => join(server, url, n, { kind: 'token', token: tokens[i] })));
    }
    expect(placed).toBeGreaterThan(40);
    expect(filled).toBeGreaterThan(5);
    expect(server.repos.exchangeTrades().length).toBeGreaterThan(5);
  }, 60_000);
});
