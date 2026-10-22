import { mulberry32, type Rng } from '../core/rng';
import { itemDef, type ItemId } from '../data/items';
import { Exchange, type Asset, type Order, type Request, type Result } from './engine';
import type { Inventory } from '../sim/inventory';

/**
 * The PRACTICE MARKET: a local, clearly labelled simulation of the exchange. Its traders are bots,
 * and every coin and item in it is practice stock created for the simulation. Nothing here ever
 * comes from or goes to a real character's inventory, bank or coins.
 */
export const PRACTICE_ACCOUNT = 'practice:you';
export const SIM_PREFIX = 'sim:';

/** Items the simulated traders deal in (and the practice account starts with some of). */
export const PRACTICE_ITEMS: ItemId[] = [
  'logs', 'oak_logs', 'copper_ore', 'tin_ore', 'iron_ore', 'coal_ore', 'bronze_bar', 'iron_bar', 'steel_bar',
  'raw_shrimps', 'shrimps', 'raw_anchovies', 'anchovies', 'bones', 'big_bones', 'wolf_pelt', 'leather', 'flax', 'bowstring',
  'plank', 'oak_plank', 'potato', 'cabbage', 'air_rune', 'spark_quartz', 'glimmerite_ore', 'glimsteel_bar', 'duskiron_ore', 'duskiron_bar', 'emberglass_shard', 'slime_gel', 'bronze_arrow',
];

export const PRACTICE_GRANT: { asset: Asset; qty: number }[] = [
  { asset: 'coins', qty: 10_000 },
  { asset: 'logs', qty: 100 },
  { asset: 'copper_ore', qty: 50 },
  { asset: 'tin_ore', qty: 50 },
  { asset: 'iron_bar', qty: 20 },
];

const TRADERS = ['sim:Ash', 'sim:Brindle', 'sim:Corra', 'sim:Dunmore', 'sim:Elsie', 'sim:Fenwick'];

export function isSimulated(account: string): boolean {
  return account.startsWith(SIM_PREFIX);
}

/** Display name for an account in the practice market (never presented as a real player). */
export function traderName(account: string): string {
  if (account === PRACTICE_ACCOUNT) return 'You (practice)';
  if (isSimulated(account)) return `${account.slice(SIM_PREFIX.length)} (simulated trader)`;
  return account;
}

/**
 * Builds the practice market and runs its simulated traders. Bots act through the same `submit()`
 * path as the player (nonces, escrow, matching), so the simulation exercises the real rules.
 */
export class PracticeMarket {
  readonly exchange: Exchange;
  private rng: Rng;
  private nonce: Record<string, number> = {};
  private stepCount = 0;

  constructor(exchange?: Exchange, seed = 0x9e3779b9, clock: () => number = () => Date.now()) {
    this.rng = mulberry32(seed);
    if (exchange) {
      this.exchange = exchange;
      for (const t of [...TRADERS, PRACTICE_ACCOUNT]) this.nonce[t] = exchange.nextNonce(t) - 1;
      return;
    }
    this.exchange = new Exchange({ clock, buyLimit: (item) => buyLimitFor(item) });
    for (const t of TRADERS) {
      this.send({ op: 'deposit', account: t, nonce: 0, asset: 'coins', qty: 200_000, source: 'simulation stock' });
      for (const item of PRACTICE_ITEMS) this.send({ op: 'deposit', account: t, nonce: 0, asset: item, qty: 400, source: 'simulation stock' });
    }
    for (const g of PRACTICE_GRANT) this.send({ op: 'deposit', account: PRACTICE_ACCOUNT, nonce: 0, asset: g.asset, qty: g.qty, source: 'practice grant' });
    // Seed the book so there is something to trade against straight away.
    for (let i = 0; i < 40; i++) this.step();
  }

  /** Sends a request for an account, numbering it with that account's next nonce. */
  send(req: Request): Result {
    const n = (this.nonce[req.account] = Math.max(this.nonce[req.account] ?? 0, this.exchange.nextNonce(req.account) - 1) + 1);
    return this.exchange.submit({ ...req, nonce: n });
  }

  /** One simulated trader action: place an offer near the guide price, cancel a stale one, or collect. */
  step() {
    this.stepCount++;
    const x = this.exchange;
    const t = TRADERS[Math.floor(this.rng() * TRADERS.length)];
    const mine = x.ordersOf(t);
    // Collect anything finished first (keeps their slots turning over).
    for (const o of mine) if (o.boxCoins > 0 || o.boxItems > 0 || o.status !== 'active') this.send({ op: 'collect', account: t, nonce: 0, orderId: o.id });
    const open = x.ordersOf(t).filter((o) => o.status === 'active');
    if (open.length >= 6 || (open.length > 0 && this.rng() < 0.2)) {
      const old = open.sort((a, b) => a.placedAt - b.placedAt)[0];
      this.send({ op: 'cancel', account: t, nonce: 0, orderId: old.id });
      return;
    }
    const used = new Set(x.ordersOf(t).map((o) => o.slot));
    const slot = [...Array(x.slots).keys()].find((s) => !used.has(s));
    if (slot === undefined) return;
    const item = PRACTICE_ITEMS[Math.floor(this.rng() * PRACTICE_ITEMS.length)];
    const guide = x.guide(item).price;
    const side = this.rng() < 0.5 ? 'buy' : 'sell';
    // Buyers bid a little under the guide, sellers ask a little over, with some crossing the spread.
    const skew = side === 'buy' ? -0.06 : 0.06;
    const price = Math.max(1, Math.round(guide * (1 + skew + (this.rng() - 0.5) * 0.14)));
    const qty = 1 + Math.floor(this.rng() * (guide > 100 ? 5 : 40));
    if (side === 'sell' && x.balance(t, item) < qty) this.send({ op: 'deposit', account: t, nonce: 0, asset: item, qty: 400, source: 'simulation stock' });
    this.send({ op: 'place', account: t, nonce: 0, slot, side, item, qty, price });
  }

  /** The practice account's offers by slot. */
  playerOrders(): Order[] {
    return this.exchange.ordersOf(PRACTICE_ACCOUNT);
  }

  toJSON() {
    return { exchange: this.exchange.toJSON(), rng: Math.floor(this.rng() * 0xffffffff), steps: this.stepCount };
  }

  static restore(data: unknown, clock: () => number = () => Date.now()): PracticeMarket | null {
    const d = data as { exchange?: unknown; rng?: number } | null;
    if (!d || typeof d !== 'object') return null;
    const x = Exchange.restore(d.exchange, { clock, buyLimit: (item) => buyLimitFor(item) });
    if (!x) return null;
    return new PracticeMarket(x, typeof d.rng === 'number' ? d.rng : 1, clock);
  }
}

/** Buy limits per window: generous for resources, tighter for gear. */
export function buyLimitFor(item: ItemId): number {
  const k = itemDef(item).kind;
  return k === 'weapon' || k === 'armour' || k === 'tool' ? 70 : k === 'food' ? 6000 : 13_000;
}

/**
 * For live trading later: move up to `qty` of a free exchange balance into a real inventory, limited
 * by what fits (non-stackables one per slot). The engine withdraws exactly what the inventory takes,
 * so nothing is lost or duplicated; the rest stays in exchange storage. Not used by the practice market.
 */
export function withdrawToInventory(x: Exchange, account: string, nonce: number, asset: Asset, qty: number, inv: Inventory): { moved: number; result: Result } {
  const fits = Math.min(qty, x.balance(account, asset), inv.capacityFor(asset));
  if (fits <= 0) return { moved: 0, result: { ok: false, error: 'Your inventory is full.' } };
  const result = x.submit({ op: 'withdraw', account, nonce, asset, qty: fits, dest: 'inventory' });
  if (!result.ok) return { moved: 0, result };
  if (inv.add(asset, fits) !== fits) throw new Error('withdraw-to-inventory invariant broken');
  return { moved: fits, result };
}
