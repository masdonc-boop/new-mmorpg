import { describe, expect, it } from 'vitest';
import { GameWorld, type SaveData } from '../src/sim/world';
import { PRACTICE_ACCOUNT } from '../src/exchange/simulation';
import { isBlocked } from '../src/sim/worldmap';
import type { Result } from '../src/exchange/engine';

const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds * 30; t++) w.tick();
};
const stand = (w: GameWorld, x: number, z: number) => {
  w.player.x = w.player.prevX = x;
  w.player.z = w.player.prevZ = z;
};
const clerk = (w: GameWorld) => w.npcs.find((n) => n.def.id === 'clerk_pell')!;
function atClerk(w: GameWorld) {
  const c = clerk(w);
  stand(w, c.x - 1.6, c.z);
  w.issue({ type: 'interact', target: c.id });
  run(w, 0.5);
}
/** Real wealth: everything the character owns outside the practice market. */
function realWealth(w: GameWorld) {
  const p = w.player;
  return JSON.stringify({ inv: p.inventory.toJSON(), bank: p.bank.toJSON(), eq: p.equipment.toJSON(), ammo: p.equipment.ammoQty, belt: p.toolbelt.toJSON() });
}
const lastResult = (w: GameWorld): Result | undefined => {
  const r = w.drainEvents().filter((e) => e.type === 'exchangeResult');
  return r.length ? (r[r.length - 1] as { result: Result }).result : undefined;
};
const x = (w: GameWorld) => w.market.exchange;

describe('Exchange plaza', () => {
  it('has two clerks you can reach and a banker who opens your normal bank', () => {
    const w = new GameWorld();
    const c = clerk(w);
    expect(isBlocked(w.map, c.x - 1.6, c.z)).toBe(false);
    atClerk(w);
    expect(w.player.exchangeAt).toBe(c.id);
    const banker = w.npcs.find((n) => n.def.id === 'exbanker')!;
    stand(w, banker.x - 1.2, banker.z + 1.2);
    w.issue({ type: 'interact', target: banker.id });
    run(w, 3);
    expect(w.bankOpen).toBe(true);
  });
});

describe('Practice market in the game', () => {
  it('only works at a clerk; the client can’t choose the account', () => {
    const w = new GameWorld();
    const nonce = x(w).nextNonce(PRACTICE_ACCOUNT);
    w.issue({ type: 'exchange', req: { op: 'place', nonce, slot: 0, side: 'buy', item: 'logs', qty: 1, price: 5 } });
    expect(lastResult(w)).toMatchObject({ ok: false, error: expect.stringContaining('Exchange clerk') });
    atClerk(w);
    // A tampered request naming another account still acts only for the practice account.
    w.issue({ type: 'exchange', req: { op: 'place', nonce: x(w).nextNonce(PRACTICE_ACCOUNT), slot: 0, side: 'buy', item: 'logs', qty: 1, price: 5, account: 'sim:Ash' } as never });
    expect(lastResult(w)?.ok).toBe(true);
    expect(x(w).ordersOf(PRACTICE_ACCOUNT).length).toBe(1);
  });

  it('trading in the practice market never touches real inventory, bank, gear or coins', () => {
    const w = new GameWorld();
    w.player.bank.add('logs', 50);
    const before = realWealth(w);
    atClerk(w);
    const send = (req: object) => w.issue({ type: 'exchange', req: { nonce: x(w).nextNonce(PRACTICE_ACCOUNT), ...req } as never });
    send({ op: 'place', slot: 0, side: 'sell', item: 'logs', qty: 20, price: 1 });
    send({ op: 'place', slot: 1, side: 'buy', item: 'iron_ore', qty: 5, price: 500 });
    run(w, 20);
    for (const o of x(w).ordersOf(PRACTICE_ACCOUNT)) send({ op: o.status === 'active' ? 'cancel' : 'collect', orderId: o.id });
    for (const o of x(w).ordersOf(PRACTICE_ACCOUNT)) send({ op: 'collect', orderId: o.id });
    expect(realWealth(w)).toBe(before);
    expect(x(w).verify()).toEqual([]);
  });

  it('a sell crossing the simulated book fills straight away; proceeds wait to be collected', () => {
    const w = new GameWorld();
    atClerk(w);
    // A simulated trader bids 50 each for logs (well above anyone else).
    const used = new Set(x(w).ordersOf('sim:Ash').map((o) => o.slot));
    const slot = [0, 1, 2, 3, 4, 5, 6, 7].find((s) => !used.has(s))!;
    expect(w.market.send({ op: 'place', account: 'sim:Ash', nonce: 0, slot, side: 'buy', item: 'logs', qty: 5, price: 50 }).ok).toBe(true);
    w.issue({ type: 'exchange', req: { op: 'place', nonce: x(w).nextNonce(PRACTICE_ACCOUNT), slot: 0, side: 'sell', item: 'logs', qty: 5, price: 1 } });
    const r = lastResult(w);
    expect(r?.ok && r.trades!.reduce((a, t) => a + t.qty, 0)).toBe(5);
    const o = x(w).ordersOf(PRACTICE_ACCOUNT)[0];
    // Sold at the resting bid (50), not the asked 1.
    expect(o).toMatchObject({ status: 'completed', boxCoins: 250 });
    expect(x(w).balance(PRACTICE_ACCOUNT, 'logs')).toBe(95);
    w.issue({ type: 'exchange', req: { op: 'collect', nonce: x(w).nextNonce(PRACTICE_ACCOUNT), orderId: o.id } });
    expect(x(w).balance(PRACTICE_ACCOUNT, 'coins')).toBe(10_250);
    expect(x(w).ordersOf(PRACTICE_ACCOUNT)).toEqual([]);
  });

  it('simulated traders keep trading as time passes, and the books always balance', () => {
    const w = new GameWorld();
    const before = x(w).history({}, 999).length;
    // Traders act every 4 seconds of play; give them a few minutes.
    run(w, 240);
    expect(x(w).history({}, 999).length).toBeGreaterThan(before);
    expect(x(w).verify()).toEqual([]);
  });

  it('practice offers and storage survive save and load; a corrupted market starts fresh', () => {
    const w = new GameWorld();
    atClerk(w);
    w.issue({ type: 'exchange', req: { op: 'place', nonce: x(w).nextNonce(PRACTICE_ACCOUNT), slot: 3, side: 'buy', item: 'bronze_bar', qty: 2, price: 1 } });
    const save = JSON.parse(JSON.stringify(w.save())) as SaveData;
    const w2 = new GameWorld({ save });
    expect(x(w2).ordersOf(PRACTICE_ACCOUNT).map((o) => o.slot)).toEqual([3]);
    expect(x(w2).nextNonce(PRACTICE_ACCOUNT)).toBe(x(w).nextNonce(PRACTICE_ACCOUNT));
    const bad = JSON.parse(JSON.stringify(save));
    bad.exchangePractice.exchange.balances[PRACTICE_ACCOUNT].coins = 999_999;
    const w3 = new GameWorld({ save: bad });
    expect(x(w3).balance(PRACTICE_ACCOUNT, 'coins')).toBe(10_000);
    expect(x(w3).ordersOf(PRACTICE_ACCOUNT)).toEqual([]);
    // Older saves without a market get a fresh one.
    delete (save as { exchangePractice?: unknown }).exchangePractice;
    expect(x(new GameWorld({ save })).balance(PRACTICE_ACCOUNT, 'coins')).toBe(10_000);
  });

  it('walking away closes the exchange; reset gives fresh practice stock', () => {
    const w = new GameWorld();
    atClerk(w);
    w.issue({ type: 'exchange', req: { op: 'place', nonce: x(w).nextNonce(PRACTICE_ACCOUNT), slot: 0, side: 'buy', item: 'logs', qty: 1, price: 1 } });
    w.issue({ type: 'exchangeResetPractice' });
    expect(x(w).ordersOf(PRACTICE_ACCOUNT)).toEqual([]);
    expect(x(w).balance(PRACTICE_ACCOUNT, 'coins')).toBe(10_000);
    stand(w, clerk(w).x - 9, clerk(w).z);
    w.tick();
    expect(w.player.exchangeAt).toBeNull();
  });
});
