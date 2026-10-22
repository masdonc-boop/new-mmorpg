import { describe, expect, it } from 'vitest';
import { GameWorld, type GameEvent, type Player } from '../src/sim/world';
import { generateWorld } from '../src/sim/worldmap';
import { TRADE_LEASH, type TradeView } from '../src/sim/trade';
import { mulberry32 } from '../src/core/rng';

const map = generateWorld(1337);
const zone = () => new GameWorld({ noPlayer: true, map, clock: () => 1_790_000_000_000 });
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds * 30; t++) w.tick();
};
const bag = (p: Player) => JSON.stringify(p.inventory.toJSON());
const slotOf = (p: Player, item: string) => p.inventory.slots.findIndex((s) => s?.item === item);

/** Two players side by side with some things to trade. */
function pair() {
  const w = zone();
  const a = w.addPlayer({ playerId: 1_000_001, name: 'Ash' });
  const b = w.addPlayer({ playerId: 1_000_002, name: 'Brindle' });
  b.x = b.prevX = a.x + 1;
  b.z = b.prevZ = a.z;
  a.inventory.add('coins', 500);
  a.inventory.add('logs', 4);
  b.inventory.add('bread', 3);
  w.drainEvents();
  return { w, a, b };
}
/** The last trade view each player was sent. */
function views(w: GameWorld) {
  const out = new Map<number, TradeView | null>();
  for (const { event, actor } of w.drainEventsWithActors()) if (event.type === 'trade') out.set(actor, event.view);
  return out;
}
function open(w: GameWorld, a: Player, b: Player) {
  w.issueFor(a.id, { type: 'tradeRequest', target: b.id });
  w.issueFor(b.id, { type: 'tradeRequest', target: a.id });
}

describe('3A.6 player trading', () => {
  it('ask, ask back, offer, accept, confirm: one swap', () => {
    const { w, a, b } = pair();
    w.issueFor(a.id, { type: 'tradeRequest', target: b.id });
    const asked = w.drainEventsWithActors().find((e) => e.event.type === 'tradeRequest')!;
    expect(asked.actor).toBe(b.id);
    expect((asked.event as Extract<GameEvent, { type: 'tradeRequest' }>).name).toBe('Ash');
    w.issueFor(b.id, { type: 'tradeRequest', target: a.id });
    expect(views(w).get(a.id)?.name).toBe('Brindle');

    w.issueFor(a.id, { type: 'tradeOffer', slot: slotOf(a, 'coins'), qty: 200 });
    const aCoins = a.inventory.count('coins');
    const aBread = a.inventory.count('bread');
    const bCoins = b.inventory.count('coins');
    const bBread = b.inventory.count('bread');
    w.issueFor(b.id, { type: 'tradeOffer', slot: slotOf(b, 'bread'), qty: 99 });
    const v = views(w);
    expect(v.get(a.id)!.mine).toEqual([{ item: 'coins', qty: 200 }]);
    expect(v.get(a.id)!.theirs).toEqual([{ item: 'bread', qty: bBread }]);

    w.issueFor(a.id, { type: 'tradeAccept' });
    w.issueFor(b.id, { type: 'tradeAccept' });
    expect(views(w).get(b.id)!.stage).toBe('confirm');
    w.issueFor(a.id, { type: 'tradeAccept' });
    expect(a.inventory.count('bread')).toBe(aBread);
    w.issueFor(b.id, { type: 'tradeAccept' });
    expect(a.inventory.count('coins')).toBe(aCoins - 200);
    expect(a.inventory.count('bread')).toBe(aBread + bBread);
    expect(b.inventory.count('coins')).toBe(bCoins + 200);
    expect(b.inventory.count('bread')).toBe(0);
    expect(views(w).get(a.id)).toBeNull();
    expect(w.trades.trading(a.id) || w.trades.trading(b.id)).toBe(false);
  });

  it('any change clears both acceptances; the final screen is frozen', () => {
    const { w, a, b } = pair();
    open(w, a, b);
    w.issueFor(a.id, { type: 'tradeOffer', slot: slotOf(a, 'logs'), qty: 4 });
    w.issueFor(a.id, { type: 'tradeAccept' });
    w.issueFor(b.id, { type: 'tradeOffer', slot: slotOf(b, 'bread'), qty: 1 });
    expect(views(w).get(a.id)!.iAccepted).toBe(false);
    w.issueFor(a.id, { type: 'tradeAccept' });
    w.issueFor(b.id, { type: 'tradeAccept' });
    w.drainEvents();
    w.issueFor(b.id, { type: 'tradeOffer', slot: slotOf(b, 'bread'), qty: 1 });
    w.issueFor(a.id, { type: 'tradeRemove', item: 'logs', qty: 4 });
    const said = w.drainEvents().filter((e) => e.type === 'message').map((e) => (e as { text: string }).text);
    expect(said.filter((t) => /final/.test(t)).length).toBe(2);
    expect(w.trades.viewFor(a.id)!.mine).toEqual([{ item: 'logs', qty: 4 }]);
  });

  it('offers are limited to what is in the bag; taking back is announced', () => {
    const { w, a, b } = pair();
    open(w, a, b);
    w.issueFor(a.id, { type: 'tradeOffer', slot: slotOf(a, 'logs'), qty: 3 });
    w.issueFor(a.id, { type: 'tradeOffer', slot: slotOf(a, 'logs'), qty: 3 });
    expect(w.trades.viewFor(a.id)!.mine).toEqual([{ item: 'logs', qty: 4 }]);
    w.drainEvents();
    w.issueFor(a.id, { type: 'tradeRemove', item: 'logs', qty: 4 });
    const toB = w.drainEventsWithActors().filter((e) => e.actor === b.id && e.event.type === 'message');
    expect((toB[0].event as { text: string }).text).toMatch(/Ash took Logs off/);
    expect(w.trades.viewFor(b.id)!.theirs).toEqual([]);
  });

  it('while trading, the bag is locked; walking apart, dying or leaving cancels with nothing changed', () => {
    const { w, a, b } = pair();
    open(w, a, b);
    w.issueFor(a.id, { type: 'dropItem', slot: slotOf(a, 'logs') });
    expect(a.inventory.count('logs')).toBe(4);
    const before = [bag(a), bag(b)];
    w.issueFor(a.id, { type: 'tradeOffer', slot: slotOf(a, 'logs'), qty: 4 });
    b.x = b.prevX = a.x + TRADE_LEASH + 1;
    run(w, 0.1);
    expect(w.trades.trading(a.id)).toBe(false);
    expect([bag(a), bag(b)]).toEqual(before);

    b.x = b.prevX = a.x + 1;
    open(w, a, b);
    expect(w.trades.trading(a.id)).toBe(true);
    b.hp = 0;
    w.act(b, () => (w as unknown as { killPlayer: () => void }).killPlayer());
    run(w, 0.1);
    expect(w.trades.trading(a.id)).toBe(false);

    const c = w.addPlayer({ playerId: 1_000_003, name: 'Corra' });
    c.x = c.prevX = a.x;
    c.z = c.prevZ = a.z + 1;
    open(w, a, c);
    w.drainEvents();
    w.removePlayer(c.id);
    expect(w.trades.trading(a.id)).toBe(false);
    expect(w.drainEventsWithActors().some((e) => e.actor === a.id && e.event.type === 'message' && /Corra left/.test(e.event.text))).toBe(true);
  });

  it('players must be close to start, and need room for what they get', () => {
    const { w, a, b } = pair();
    b.x = b.prevX = a.x + 9;
    w.issueFor(a.id, { type: 'tradeRequest', target: b.id });
    expect(w.drainEvents().some((e) => e.type === 'message' && /closer/.test(e.text))).toBe(true);
    b.x = b.prevX = a.x + 1;
    open(w, a, b);
    // B's bag is full of things that don't stack.
    while (b.inventory.freeSlots() > 0) b.inventory.add('bronze_sword', 1);
    w.issueFor(a.id, { type: 'tradeOffer', slot: slotOf(a, 'logs'), qty: 1 });
    w.issueFor(b.id, { type: 'tradeAccept' });
    expect(w.trades.viewFor(b.id)!.iAccepted).toBe(false);
    // Giving something up in return makes room.
    w.issueFor(b.id, { type: 'tradeOffer', slot: slotOf(b, 'bronze_sword'), qty: 1 });
    w.issueFor(b.id, { type: 'tradeAccept' });
    expect(w.trades.viewFor(b.id)!.iAccepted).toBe(true);
  });

  it('if the items are gone at the end, or saving fails, the trade is cancelled and nothing changes', () => {
    const { w, a, b } = pair();
    const before = [bag(a), bag(b)];
    // A loses some of the offered coins (outside the bag lock) before the end.
    open(w, a, b);
    w.issueFor(a.id, { type: 'tradeOffer', slot: slotOf(a, 'coins'), qty: 500 });
    for (const p of [a, b, a]) w.issueFor(p.id, { type: 'tradeAccept' });
    a.inventory.remove('coins', a.inventory.count('coins'));
    w.issueFor(b.id, { type: 'tradeAccept' });
    expect(w.trades.trading(a.id)).toBe(false);
    a.inventory.add('coins', 525);
    expect([bag(a), bag(b)]).toEqual(before);

    // And when the save is refused, the swap is undone exactly.
    w.trades.commitHook = () => {
      throw new Error('database unavailable');
    };
    open(w, a, b);
    w.issueFor(a.id, { type: 'tradeOffer', slot: slotOf(a, 'logs'), qty: 2 });
    w.issueFor(b.id, { type: 'tradeOffer', slot: slotOf(b, 'bread'), qty: 2 });
    w.drainEvents();
    for (const p of [a, b, a, b]) w.issueFor(p.id, { type: 'tradeAccept' });
    expect([bag(a), bag(b)]).toEqual(before);
    expect(w.drainEvents().some((e) => e.type === 'message' && /Nothing changed/.test(e.text))).toBe(true);
  });

  it('fuzz: random trading between four players never creates or destroys anything', () => {
    const w = zone();
    const ps = [1, 2, 3, 4].map((i) => w.addPlayer({ playerId: 1_000_000 + i, name: `P${i}` }));
    ps.forEach((p, i) => {
      p.x = p.prevX = ps[0].x + (i % 2);
      p.z = p.prevZ = ps[0].z + Math.floor(i / 2);
      p.inventory.add('coins', 1000 * (i + 1));
      p.inventory.add('logs', 5);
      p.inventory.add('bread', 2 + i);
    });
    const total = () => {
      const out: Record<string, number> = {};
      for (const p of ps) for (const s of p.inventory.slots) if (s) out[s.item] = (out[s.item] ?? 0) + s.qty;
      return out;
    };
    const start = total();
    const rng = mulberry32(0x3a6);
    const pick = <T,>(a: readonly T[]) => a[Math.floor(rng() * a.length)];
    let swaps = 0;
    w.trades.commitHook = () => {
      swaps++;
      if (rng() < 0.1) throw new Error('refused');
    };
    for (let i = 0; i < 6000; i++) {
      const p = pick(ps);
      const r = rng();
      if (r < 0.15) w.issueFor(p.id, { type: 'tradeRequest', target: pick(ps).id });
      else if (r < 0.45) w.issueFor(p.id, { type: 'tradeOffer', slot: Math.floor(rng() * 28), qty: 1 + Math.floor(rng() * 600) });
      else if (r < 0.5) w.issueFor(p.id, { type: 'tradeRemove', item: pick(['coins', 'logs', 'bread'] as const), qty: 1 + Math.floor(rng() * 5) });
      else if (r < 0.9) w.issueFor(p.id, { type: 'tradeAccept' });
      else if (r < 0.93) w.issueFor(p.id, { type: 'tradeDecline' });
      else run(w, 0.1);
      w.drainEvents();
    }
    expect(swaps).toBeGreaterThan(20);
    expect(total()).toEqual(start);
  });
});
