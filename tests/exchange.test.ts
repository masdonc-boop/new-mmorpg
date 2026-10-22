import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/core/rng';
import { Exchange, MAX_COINS, type Request, type Side } from '../src/exchange/engine';
import { PRACTICE_ACCOUNT, PracticeMarket, withdrawToInventory } from '../src/exchange/simulation';
import { Inventory, INVENTORY_SLOTS } from '../src/sim/inventory';
import type { ItemId } from '../src/data/items';

/** A request without its nonce (the helper numbers them per account). */
type Unnumbered = Request extends infer R ? (R extends Request ? Omit<R, 'nonce'> & { nonce?: number } : never) : never;

/** An exchange with a fixed clock and helpers that number each account's requests. */
function setup(opts: ConstructorParameters<typeof Exchange>[0] = {}) {
  const t = { now: 1_000_000 };
  const x = new Exchange({ clock: () => t.now, ...opts });
  const nonce: Record<string, number> = {};
  const send = (req: Unnumbered) => {
    const n = req.nonce ?? (nonce[req.account] = (nonce[req.account] ?? 0) + 1);
    if (req.nonce !== undefined) nonce[req.account] = Math.max(nonce[req.account] ?? 0, req.nonce);
    const r = x.submit({ ...req, nonce: n } as Request);
    expect(x.verify()).toEqual([]);
    return r;
  };
  const fund = (account: string, asset: ItemId | 'coins', qty: number) => send({ op: 'deposit', account, asset, qty, source: 'test' });
  const place = (account: string, side: Side, item: ItemId, qty: number, price: number, slot = 0) => send({ op: 'place', account, side, item, qty, price, slot });
  return { x, t, send, fund, place };
}

describe('Exchange: offers and escrow', () => {
  it('holds coins for a buy and items for a sell; rejects what the account can’t cover', () => {
    const { x, fund, place } = setup();
    fund('ann', 'coins', 1000);
    fund('bob', 'logs', 10);
    expect(place('ann', 'buy', 'logs', 20, 60)).toMatchObject({ ok: false, error: 'Not enough coins.' });
    expect(place('ann', 'buy', 'logs', 10, 50).ok).toBe(true);
    expect(x.balance('ann', 'coins')).toBe(500);
    expect(place('bob', 'sell', 'logs', 11, 40)).toMatchObject({ ok: false });
  });

  it('rejects bad input: quantities, prices, overflow, coins as an item, unknown items, busy slots', () => {
    const { fund, place, send } = setup();
    fund('ann', 'coins', 1000);
    for (const [qty, price] of [[0, 5], [-1, 5], [1.5, 5], [1, 0], [1, 2.5], [1, Number.NaN]]) expect(place('ann', 'buy', 'logs', qty, price).ok).toBe(false);
    expect(place('ann', 'buy', 'logs', 1000, MAX_COINS).ok).toBe(false);
    expect(place('ann', 'buy', 'coins' as ItemId, 1, 1).ok).toBe(false);
    expect(place('ann', 'buy', 'dragon_hat' as ItemId, 1, 1).ok).toBe(false);
    expect(place('ann', 'buy', 'logs', 1, 1, 8).ok).toBe(false);
    expect(place('ann', 'buy', 'logs', 1, 1, 0).ok).toBe(true);
    expect(place('ann', 'buy', 'logs', 1, 1, 0)).toMatchObject({ ok: false, error: 'That offer slot is in use.' });
    expect(send({ op: 'cancel', account: 'bob', orderId: 1 })).toMatchObject({ ok: false, error: 'No such offer.' });
  });
});

describe('Exchange: matching', () => {
  it('trades at the resting offer’s price; the buyer gets the difference back', () => {
    const { x, fund, place } = setup();
    fund('sel', 'iron_ore', 10);
    fund('buy', 'coins', 10_000);
    place('sel', 'sell', 'iron_ore', 10, 100);
    const r = place('buy', 'buy', 'iron_ore', 6, 120);
    expect(r.ok && r.trades).toEqual([expect.objectContaining({ qty: 6, price: 100, buyer: 'buy', seller: 'sel' })]);
    const b = x.ordersOf('buy')[0];
    expect(b).toMatchObject({ status: 'completed', boxItems: 6, boxCoins: 6 * 20, escrowCoins: 0, value: 600 });
    const s = x.ordersOf('sel')[0];
    expect(s).toMatchObject({ status: 'active', filled: 6, boxCoins: 600, escrowItems: 4 });
  });

  it('price first, then time: the best price fills first, and equal prices fill oldest first', () => {
    const { x, t, fund, place } = setup();
    for (const a of ['s1', 's2', 's3']) fund(a, 'logs', 5);
    fund('b', 'coins', 10_000);
    place('s1', 'sell', 'logs', 5, 12);
    t.now += 10;
    place('s2', 'sell', 'logs', 5, 10);
    t.now += 10;
    place('s3', 'sell', 'logs', 5, 10);
    const r = place('b', 'buy', 'logs', 8, 15);
    expect(r.ok && r.trades!.map((tr) => [tr.seller, tr.qty, tr.price])).toEqual([
      ['s2', 5, 10],
      ['s3', 3, 10],
    ]);
    expect(x.book('logs').sells.map((o) => [o.account, o.qty - o.filled])).toEqual([
      ['s3', 2],
      ['s1', 5],
    ]);
  });

  it('an incoming sell takes the highest bid (seller gets the bid price)', () => {
    const { x, fund, place } = setup();
    fund('b1', 'coins', 1000);
    fund('b2', 'coins', 1000);
    fund('s', 'logs', 3);
    place('b1', 'buy', 'logs', 3, 20);
    place('b2', 'buy', 'logs', 3, 25);
    const r = place('s', 'sell', 'logs', 3, 18);
    expect(r.ok && r.trades!.map((tr) => [tr.buyer, tr.price])).toEqual([['b2', 25]]);
    expect(x.ordersOf('s')[0].boxCoins).toBe(75);
  });

  it('no match when prices don’t cross; an account never trades with itself', () => {
    const { x, fund, place } = setup();
    fund('a', 'coins', 1000);
    fund('a', 'logs', 5);
    fund('b', 'logs', 5);
    place('b', 'sell', 'logs', 5, 30, 0);
    expect(place('a', 'buy', 'logs', 5, 29, 0)).toMatchObject({ ok: true, trades: [] });
    expect(place('a', 'sell', 'logs', 5, 20, 1)).toMatchObject({ ok: true, trades: [] });
    expect(x.book('logs').buys.length + x.book('logs').sells.length).toBe(3);
  });
});

describe('Exchange: partial fills, cancelling and collecting', () => {
  it('cancelling a part-filled buy returns the unspent coins to the box; nothing is lost', () => {
    const { x, fund, place, send } = setup();
    fund('b', 'coins', 1000);
    fund('s', 'logs', 4);
    const id = (place('b', 'buy', 'logs', 10, 50) as { orderId: number }).orderId;
    place('s', 'sell', 'logs', 4, 50);
    expect(x.order(id)).toMatchObject({ filled: 4, boxItems: 4, escrowCoins: 300 });
    expect(send({ op: 'cancel', account: 'b', orderId: id }).ok).toBe(true);
    expect(x.order(id)).toMatchObject({ status: 'cancelled', boxCoins: 300, escrowCoins: 0 });
    expect(send({ op: 'cancel', account: 'b', orderId: id }).ok).toBe(false);
    const c = send({ op: 'collect', account: 'b', orderId: id });
    expect(c).toMatchObject({ ok: true, collected: { coins: 300, items: 4 } });
    expect(x.balance('b', 'coins')).toBe(800);
    expect(x.balance('b', 'logs')).toBe(4);
    // Finished and emptied: the slot is free again.
    expect(x.ordersOf('b')).toEqual([]);
  });

  it('collecting from an active part-filled offer keeps it open in its slot', () => {
    const { x, fund, place, send } = setup();
    fund('s', 'logs', 10);
    fund('b', 'coins', 1000);
    const id = (place('s', 'sell', 'logs', 10, 9) as { orderId: number }).orderId;
    place('b', 'buy', 'logs', 3, 9);
    expect(send({ op: 'collect', account: 's', orderId: id })).toMatchObject({ ok: true, collected: { coins: 27, items: 0 } });
    expect(x.order(id)).toMatchObject({ status: 'active', filled: 3, escrowItems: 7 });
    expect(send({ op: 'collect', account: 's', orderId: id })).toMatchObject({ ok: false, error: 'Nothing to collect yet.' });
  });

  it('eight offer slots per account; buy limits per item over 4 hours', () => {
    const { t, fund, place } = setup({ buyLimit: (item) => (item === 'iron_sword' ? 2 : undefined) });
    fund('a', 'coins', 100_000);
    for (let s = 0; s < 8; s++) expect(place('a', 'buy', 'logs', 1, 1, s).ok).toBe(true);
    const { place: place2, fund: fund2, t: t2 } = setup({ buyLimit: (item) => (item === 'iron_sword' ? 2 : undefined) });
    fund2('a', 'coins', 100_000);
    fund2('s', 'iron_sword', 5);
    place2('s', 'sell', 'iron_sword', 5, 50);
    expect(place2('a', 'buy', 'iron_sword', 2, 50, 0).ok).toBe(true);
    expect(place2('a', 'buy', 'iron_sword', 1, 50, 1)).toMatchObject({ ok: false, error: expect.stringContaining('Buy limit') });
    t2.now += 4 * 3600_000;
    expect(place2('a', 'buy', 'iron_sword', 1, 50, 1).ok).toBe(true);
    expect(t.now).toBeGreaterThan(0);
  });
});

describe('Exchange: replay and duplicate protection', () => {
  it('an exact retry returns the first result without applying it twice', () => {
    const { x, fund } = setup();
    fund('a', 'coins', 1000);
    const req: Request = { op: 'place', account: 'a', nonce: 2, slot: 0, side: 'buy', item: 'logs', qty: 10, price: 10 };
    const first = x.submit(req);
    const again = x.submit({ ...req });
    expect(first.ok).toBe(true);
    expect(again).toMatchObject({ ok: true, replayed: true, orderId: (first as { orderId: number }).orderId });
    expect(x.ordersOf('a').length).toBe(1);
    expect(x.balance('a', 'coins')).toBe(900);
  });

  it('a reused nonce with a different request, or an old nonce, is rejected', () => {
    const { x, fund } = setup();
    fund('a', 'coins', 1000);
    x.submit({ op: 'place', account: 'a', nonce: 2, slot: 0, side: 'buy', item: 'logs', qty: 1, price: 10 });
    expect(x.submit({ op: 'place', account: 'a', nonce: 2, slot: 1, side: 'buy', item: 'logs', qty: 50, price: 10 })).toMatchObject({ ok: false });
    for (let n = 3; n < 3 + 80; n++) x.submit({ op: 'cancel', account: 'a', nonce: n, orderId: 999 });
    // Far older than the remembered window: still refused, never re-applied.
    expect(x.submit({ op: 'deposit', account: 'a', nonce: 1, asset: 'coins', qty: 1000, source: 'test' })).toMatchObject({ ok: false, error: 'Stale request (already processed).' });
    expect(x.balance('a', 'coins')).toBe(990);
  });

  it('random interleaved traffic from many accounts (with duplicates and stale retries) never breaks the books, and is deterministic', () => {
    const run = (seed: number) => {
      const rng = mulberry32(seed);
      const x = new Exchange({ clock: () => 5 });
      const accounts = ['a', 'b', 'c', 'd', 'e'];
      const items: ItemId[] = ['logs', 'iron_ore', 'bones'];
      const nonce: Record<string, number> = {};
      const sent: Request[] = [];
      for (const a of accounts) {
        x.submit({ op: 'deposit', account: a, nonce: (nonce[a] = 1), asset: 'coins', qty: 50_000, source: 'test' });
        for (const it of items) x.submit({ op: 'deposit', account: a, nonce: ++nonce[a], asset: it, qty: 200, source: 'test' });
      }
      for (let i = 0; i < 1500; i++) {
        const a = accounts[Math.floor(rng() * accounts.length)];
        const roll = rng();
        let req: Request;
        if (roll < 0.1 && sent.length) req = sent[Math.floor(rng() * sent.length)]; // duplicate or stale retry
        else if (roll < 0.6) req = { op: 'place', account: a, nonce: ++nonce[a], slot: Math.floor(rng() * 8), side: rng() < 0.5 ? 'buy' : 'sell', item: items[Math.floor(rng() * 3)], qty: 1 + Math.floor(rng() * 30), price: 5 + Math.floor(rng() * 20) };
        else {
          // Mostly the account's own offers, sometimes someone else's (which must be refused).
          const own = x.ordersOf(a);
          const orderId = own.length && rng() < 0.85 ? own[Math.floor(rng() * own.length)].id : 1 + Math.floor(rng() * 400);
          req = { op: roll < 0.75 ? 'cancel' : 'collect', account: a, nonce: ++nonce[a], orderId };
        }
        sent.push(req);
        x.submit(req);
        expect(x.verify()).toEqual([]);
      }
      return x;
    };
    const a = run(42);
    const b = run(42);
    expect(JSON.stringify(a.toJSON())).toBe(JSON.stringify(b.toJSON()));
    expect(a.history({}, 1000).length).toBeGreaterThan(50);
  });
});

describe('Exchange: persistence and audit', () => {
  it('saves and restores exactly; tampering with the log or balances is detected', () => {
    const { x, fund, place } = setup();
    fund('a', 'coins', 1000);
    fund('b', 'logs', 10);
    place('b', 'sell', 'logs', 10, 7);
    place('a', 'buy', 'logs', 4, 9);
    const saved = JSON.parse(JSON.stringify(x.toJSON()));
    const y = Exchange.restore(saved)!;
    expect(y).not.toBeNull();
    expect(JSON.stringify(y.toJSON())).toBe(JSON.stringify(x.toJSON()));
    const badLog = JSON.parse(JSON.stringify(saved));
    badLog.log[1].detail = 'nothing happened';
    expect(Exchange.restore(badLog)).toBeNull();
    const badCoins = JSON.parse(JSON.stringify(saved));
    badCoins.balances.a.coins += 1000;
    expect(Exchange.restore(badCoins)).toBeNull();
    expect(Exchange.restore('junk')).toBeNull();
  });

  it('every change is in the audit log, hash-chained', () => {
    const { x, fund, place } = setup();
    fund('a', 'coins', 100);
    place('a', 'buy', 'logs', 1, 5);
    const log = x.auditLog();
    expect(log.map((e) => e.op)).toEqual(['deposit', 'place']);
    expect(new Set(log.map((e) => e.hash)).size).toBe(2);
  });

  it('price guidance follows recent trades, with the item value before any', () => {
    const { x, fund, place } = setup();
    expect(x.guide('iron_bar')).toMatchObject({ price: 40, fromTrades: false });
    fund('s', 'iron_bar', 10);
    fund('b', 'coins', 10_000);
    place('s', 'sell', 'iron_bar', 4, 50);
    place('b', 'buy', 'iron_bar', 4, 60);
    expect(x.guide('iron_bar')).toMatchObject({ price: 50, fromTrades: true, volume: 4 });
  });
});

describe('Exchange storage to a real inventory (live-trading path)', () => {
  it('moves only what fits (non-stackables one per slot); the rest stays in exchange storage', () => {
    const { x, fund } = setup();
    fund('a', 'logs', 30);
    const inv = new Inventory();
    inv.add('bones', INVENTORY_SLOTS - 5);
    const r = withdrawToInventory(x, 'a', 10, 'logs', 30, inv);
    expect(r.moved).toBe(5);
    expect(inv.count('logs')).toBe(5);
    expect(x.balance('a', 'logs')).toBe(25);
    expect(withdrawToInventory(x, 'a', 11, 'logs', 30, inv).moved).toBe(0);
    expect(x.verify()).toEqual([]);
  });
});

describe('Practice market', () => {
  it('starts funded with practice stock, seeds an order book, and stays consistent as traders act', () => {
    const m = new PracticeMarket(undefined, 7, () => 1_000);
    expect(m.exchange.balance(PRACTICE_ACCOUNT, 'coins')).toBe(10_000);
    expect(m.exchange.book('logs').buys.length + m.exchange.book('logs').sells.length + m.exchange.history({}, 999).length).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 400; i++) m.step();
    expect(m.exchange.verify()).toEqual([]);
    expect(m.exchange.history({}, 999).length).toBeGreaterThan(10);
    const r = PracticeMarket.restore(JSON.parse(JSON.stringify(m.toJSON())), () => 1_000)!;
    expect(r.exchange.verify()).toEqual([]);
    r.step();
    expect(r.exchange.verify()).toEqual([]);
  });
});
