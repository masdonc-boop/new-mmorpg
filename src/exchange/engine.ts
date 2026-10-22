import { isItemId, itemDef, type ItemId } from '../data/items';

/**
 * Brightwater Exchange engine: a central buy/sell order book.
 *
 * Server-authoritative by design. Everything that changes balances goes through `submit()`, which
 * runs one request at a time (a single writer), validates it against the engine's own ledger (never
 * client-supplied quantities, coins or results), applies it atomically, and appends a hash-chained
 * audit entry. Clients only send intents (place, cancel, collect) with a per-account nonce.
 *
 * See docs/EXCHANGE.md for the full architecture and the migration path to live trading.
 */

export type Side = 'buy' | 'sell';
export type OrderStatus = 'active' | 'completed' | 'cancelled';
/** An exchange asset: an item id, or coins. */
export type Asset = ItemId | 'coins';

/** Largest coin amount anywhere (OSRS-style cash cap); also caps an order's total value. */
export const MAX_COINS = 2_147_483_647;
export const MAX_QTY = 1_000_000;
export const DEFAULT_SLOTS = 6;
/** Buy limits count purchases over this window (Brightwater's market day is split into three-hour watches). */
export const BUY_LIMIT_WINDOW_HOURS = 3;

export interface Order {
  id: number;
  account: string;
  slot: number;
  side: Side;
  item: ItemId;
  qty: number;
  /** Limit price per item: the most a buyer pays, the least a seller accepts. */
  price: number;
  filled: number;
  status: OrderStatus;
  /** Global sequence when placed: time priority among equal prices. */
  seq: number;
  placedAt: number;
  /** Held while the order is open: coins for a buy (remaining × limit), items for a sell. */
  escrowCoins: number;
  escrowItems: number;
  /** Collection box: proceeds waiting to be collected (bought items, sale coins, refunds). */
  boxCoins: number;
  boxItems: number;
  /** Coins actually paid (buy) or received (sell) so far, for the average fill price. */
  value: number;
}

export interface Trade {
  id: number;
  seq: number;
  at: number;
  item: ItemId;
  qty: number;
  price: number;
  buyOrder: number;
  sellOrder: number;
  buyer: string;
  seller: string;
}

export interface AuditEntry {
  seq: number;
  at: number;
  op: string;
  account: string;
  nonce?: number;
  detail: string;
  /** Hash of the previous entry's hash and this entry: tampering breaks the chain. */
  hash: string;
}

export type Request =
  | { op: 'place'; account: string; nonce: number; slot: number; side: Side; item: ItemId; qty: number; price: number }
  | { op: 'cancel'; account: string; nonce: number; orderId: number }
  | { op: 'collect'; account: string; nonce: number; orderId: number }
  /** Funds an account from outside the exchange (practice grants today; a bank bridge later). */
  | { op: 'deposit'; account: string; nonce: number; asset: Asset; qty: number; source: string }
  /** Moves an account's free balance out of the exchange (to a bank or inventory later). */
  | { op: 'withdraw'; account: string; nonce: number; asset: Asset; qty: number; dest: string };

export type Result =
  | { ok: true; replayed?: boolean; orderId?: number; trades?: Trade[]; collected?: { coins: number; items: number; item?: ItemId } }
  | { ok: false; replayed?: boolean; error: string };

export interface ExchangeOptions {
  clock?: () => number;
  slots?: number;
  /** Max quantity of an item one account may buy per window, or undefined for none. */
  buyLimit?: (item: ItemId) => number | undefined;
  buyLimitWindowMs?: number;
  /** How many recent results to remember per account for exact replays. */
  replayMemory?: number;
  /** How many audit entries and trades to keep in memory and saves (older ones roll into a checkpoint). */
  logLimit?: number;
}

type Balances = Record<string, Partial<Record<Asset, number>>>;

export function tradeable(item: string): item is ItemId {
  return isItemId(item) && itemDef(item).kind !== 'currency';
}

const isInt = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;

/** Small, stable string hash (FNV-1a, 32-bit) for the audit chain. */
export function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export class Exchange {
  private balances: Balances = {};
  private orders = new Map<number, Order>();
  /** Total of each asset ever deposited minus withdrawn: must equal what the engine holds. */
  private supply: Partial<Record<Asset, number>> = {};
  private seq = 0;
  private nextOrderId = 1;
  private nextTradeId = 1;
  private trades: Trade[] = [];
  private log: AuditEntry[] = [];
  /** Hash of the last entry that rolled out of `log` (the chain continues from it). */
  private checkpoint = '00000000';
  /** Per account: highest nonce seen, and recent results by nonce (exact replays return these). */
  private nonces: Record<string, { last: number; recent: { nonce: number; fp: string; result: Result }[] }> = {};
  /** Purchases per account and item: [time, qty] within the buy-limit window. */
  private bought: Record<string, { at: number; qty: number }[]> = {};
  readonly clock: () => number;
  readonly slots: number;
  private readonly opts: Required<Omit<ExchangeOptions, 'clock' | 'slots' | 'buyLimit'>> & Pick<ExchangeOptions, 'buyLimit'>;

  constructor(opts: ExchangeOptions = {}) {
    this.clock = opts.clock ?? (() => Date.now());
    this.slots = opts.slots ?? DEFAULT_SLOTS;
    this.opts = { buyLimit: opts.buyLimit, buyLimitWindowMs: opts.buyLimitWindowMs ?? BUY_LIMIT_WINDOW_HOURS * 3600_000, replayMemory: opts.replayMemory ?? 64, logLimit: opts.logLimit ?? 400 };
  }

  // ---------------------------------------------------------------- queries

  balance(account: string, asset: Asset): number {
    return this.balances[account]?.[asset] ?? 0;
  }

  /** An account's free balances (not in orders or collection boxes). */
  holdings(account: string): { asset: Asset; qty: number }[] {
    return Object.entries(this.balances[account] ?? {})
      .filter(([, q]) => (q ?? 0) > 0)
      .map(([asset, qty]) => ({ asset: asset as Asset, qty: qty! }));
  }

  order(id: number): Order | undefined {
    const o = this.orders.get(id);
    return o ? { ...o } : undefined;
  }

  /** An account's orders by slot (active, or finished but not yet collected). */
  ordersOf(account: string): Order[] {
    return [...this.orders.values()].filter((o) => o.account === account).map((o) => ({ ...o }));
  }

  /** Recent trades, newest first (optionally for one account or item). */
  history(filter: { account?: string; item?: ItemId } = {}, limit = 50): Trade[] {
    const out: Trade[] = [];
    for (let i = this.trades.length - 1; i >= 0 && out.length < limit; i--) {
      const t = this.trades[i];
      if (filter.item && t.item !== filter.item) continue;
      if (filter.account && t.buyer !== filter.account && t.seller !== filter.account) continue;
      out.push({ ...t });
    }
    return out;
  }

  /** Price guidance: recent volume-weighted trade price, best bid/ask and recent volume. */
  guide(item: ItemId): { price: number; fromTrades: boolean; bestBid: number | null; bestAsk: number | null; volume: number } {
    const recent = this.trades.filter((t) => t.item === item).slice(-20);
    const vol = recent.reduce((a, t) => a + t.qty, 0);
    const vwap = vol > 0 ? Math.round(recent.reduce((a, t) => a + t.qty * t.price, 0) / vol) : 0;
    const book = this.book(item);
    return {
      price: vol > 0 ? Math.max(1, vwap) : Math.max(1, itemDef(item).value),
      fromTrades: vol > 0,
      bestBid: book.buys[0]?.price ?? null,
      bestAsk: book.sells[0]?.price ?? null,
      volume: vol,
    };
  }

  /** The open order book for an item in matching order (price, then time). */
  book(item: ItemId): { buys: Order[]; sells: Order[] } {
    const open = [...this.orders.values()].filter((o) => o.item === item && o.status === 'active');
    return {
      buys: open.filter((o) => o.side === 'buy').sort((a, b) => b.price - a.price || a.seq - b.seq),
      sells: open.filter((o) => o.side === 'sell').sort((a, b) => a.price - b.price || a.seq - b.seq),
    };
  }

  /** The next nonce a client for this account should use. */
  nextNonce(account: string): number {
    return (this.nonces[account]?.last ?? 0) + 1;
  }

  auditLog(): AuditEntry[] {
    return this.log.map((e) => ({ ...e }));
  }

  // ---------------------------------------------------------------- the single entry point

  /**
   * Applies one request atomically. Requests must carry a nonce greater than the account's last one:
   * an exact repeat of a recent request returns its original result without applying it again
   * (safe retries); anything older, or a different request reusing a nonce, is rejected (replays).
   */
  submit(req: Request): Result {
    if (!req || typeof req !== 'object' || typeof req.account !== 'string' || !req.account) return { ok: false, error: 'Bad request.' };
    if (!isInt(req.nonce, 1, Number.MAX_SAFE_INTEGER)) return { ok: false, error: 'Bad request.' };
    const n = (this.nonces[req.account] ??= { last: 0, recent: [] });
    const fp = fnv(JSON.stringify(req));
    if (req.nonce <= n.last) {
      const seen = n.recent.find((r) => r.nonce === req.nonce);
      if (seen && seen.fp === fp) return { ...seen.result, replayed: true };
      return { ok: false, error: seen ? 'That request number was already used for something else.' : 'Stale request (already processed).' };
    }
    const result = this.apply(req);
    n.last = req.nonce;
    n.recent.push({ nonce: req.nonce, fp, result });
    if (n.recent.length > this.opts.replayMemory) n.recent.shift();
    return result;
  }

  private apply(req: Request): Result {
    switch (req.op) {
      case 'place':
        return this.place(req);
      case 'cancel':
        return this.cancel(req);
      case 'collect':
        return this.collect(req);
      case 'deposit':
        return this.deposit(req);
      case 'withdraw':
        return this.withdraw(req);
      default:
        return { ok: false, error: 'Unknown request.' };
    }
  }

  // ---------------------------------------------------------------- operations

  private place(r: Extract<Request, { op: 'place' }>): Result {
    if (r.side !== 'buy' && r.side !== 'sell') return { ok: false, error: 'Choose buy or sell.' };
    if (typeof r.item !== 'string' || !tradeable(r.item)) return { ok: false, error: 'That item can’t be traded.' };
    if (!isInt(r.qty, 1, MAX_QTY)) return { ok: false, error: `Quantity must be 1 to ${MAX_QTY.toLocaleString()}.` };
    if (!isInt(r.price, 1, MAX_COINS)) return { ok: false, error: 'Price must be at least 1 coin.' };
    if (r.qty * r.price > MAX_COINS) return { ok: false, error: 'That offer is worth too much.' };
    if (!isInt(r.slot, 0, this.slots - 1)) return { ok: false, error: 'No such offer slot.' };
    if ([...this.orders.values()].some((o) => o.account === r.account && o.slot === r.slot)) return { ok: false, error: 'That offer slot is in use.' };
    const now = this.clock();
    if (r.side === 'buy') {
      const limit = this.opts.buyLimit?.(r.item);
      if (limit !== undefined) {
        const open = [...this.orders.values()].filter((o) => o.account === r.account && o.item === r.item && o.side === 'buy' && o.status === 'active').reduce((a, o) => a + o.qty - o.filled, 0);
        const left = limit - this.boughtRecently(r.account, r.item, now) - open;
        if (r.qty > left) return { ok: false, error: `Buy limit: you can buy ${Math.max(0, left)} more ${itemDef(r.item).name.toLowerCase()} for now (${limit} every ${this.opts.buyLimitWindowMs / 3600_000} hours).` };
      }
      if (this.balance(r.account, 'coins') < r.qty * r.price) return { ok: false, error: 'Not enough coins.' };
    } else if (this.balance(r.account, r.item) < r.qty) return { ok: false, error: `You don’t have ${r.qty} ${itemDef(r.item).name.toLowerCase()}.` };

    // Escrow first: the order holds its coins or items for as long as it is open.
    const o: Order = {
      id: this.nextOrderId++,
      account: r.account,
      slot: r.slot,
      side: r.side,
      item: r.item,
      qty: r.qty,
      price: r.price,
      filled: 0,
      status: 'active',
      seq: this.seq + 1,
      placedAt: now,
      escrowCoins: r.side === 'buy' ? r.qty * r.price : 0,
      escrowItems: r.side === 'sell' ? r.qty : 0,
      boxCoins: 0,
      boxItems: 0,
      value: 0,
    };
    if (r.side === 'buy') this.adjust(r.account, 'coins', -o.escrowCoins);
    else this.adjust(r.account, r.item, -o.escrowItems);
    this.orders.set(o.id, o);
    this.audit('place', r.account, `#${o.id} ${o.side} ${o.qty} ${o.item} @ ${o.price} slot ${o.slot}`, r.nonce);
    const trades = this.match(o, now);
    return { ok: true, orderId: o.id, trades };
  }

  /**
   * Matches an incoming order against the opposite side by price, then time. Trades execute at the
   * resting order's price (as on the OSRS Grand Exchange: whoever offered first sets the price); a
   * buyer who bid more gets the difference back. An account never trades with itself.
   */
  private match(o: Order, now: number): Trade[] {
    const trades: Trade[] = [];
    const book = this.book(o.item);
    const others = (o.side === 'buy' ? book.sells : book.buys).filter((x) => x.account !== o.account);
    for (const view of others) {
      if (o.filled >= o.qty) break;
      const rest = this.orders.get(view.id)!;
      if (o.side === 'buy' ? rest.price > o.price : rest.price < o.price) break;
      const qty = Math.min(o.qty - o.filled, rest.qty - rest.filled);
      const price = rest.price;
      const buy = o.side === 'buy' ? o : rest;
      const sell = o.side === 'buy' ? rest : o;
      // Settlement, all from escrow: the buyer's held coins pay the seller; items move the other way.
      buy.escrowCoins -= qty * buy.price;
      buy.boxCoins += qty * (buy.price - price);
      buy.boxItems += qty;
      buy.value += qty * price;
      sell.escrowItems -= qty;
      sell.boxCoins += qty * price;
      sell.value += qty * price;
      buy.filled += qty;
      sell.filled += qty;
      for (const x of [buy, sell]) if (x.filled >= x.qty) x.status = 'completed';
      (this.bought[`${buy.account}|${buy.item}`] ??= []).push({ at: now, qty });
      const t: Trade = { id: this.nextTradeId++, seq: this.seq + 1, at: now, item: o.item, qty, price, buyOrder: buy.id, sellOrder: sell.id, buyer: buy.account, seller: sell.account };
      this.trades.push(t);
      if (this.trades.length > this.opts.logLimit) this.trades.shift();
      trades.push({ ...t });
      this.audit('trade', buy.account, `#${t.id} ${qty} ${o.item} @ ${price}: buy #${buy.id} (${buy.account}) sell #${sell.id} (${sell.account})`);
    }
    return trades;
  }

  private cancel(r: Extract<Request, { op: 'cancel' }>): Result {
    const o = this.orders.get(r.orderId);
    if (!o || o.account !== r.account) return { ok: false, error: 'No such offer.' };
    if (o.status !== 'active') return { ok: false, error: 'That offer is already finished.' };
    // Whatever is still held goes to the collection box: nothing is lost.
    o.boxCoins += o.escrowCoins;
    o.boxItems += o.escrowItems;
    o.escrowCoins = 0;
    o.escrowItems = 0;
    o.status = 'cancelled';
    this.audit('cancel', r.account, `#${o.id} after ${o.filled}/${o.qty}`, r.nonce);
    return { ok: true, orderId: o.id };
  }

  private collect(r: Extract<Request, { op: 'collect' }>): Result {
    const o = this.orders.get(r.orderId);
    if (!o || o.account !== r.account) return { ok: false, error: 'No such offer.' };
    const coins = o.boxCoins;
    const items = o.boxItems;
    if (coins <= 0 && items <= 0 && o.status === 'active') return { ok: false, error: 'Nothing to collect yet.' };
    if (coins > 0 && this.balance(r.account, 'coins') + coins > MAX_COINS) return { ok: false, error: 'You can’t hold that many coins.' };
    this.adjust(r.account, 'coins', coins);
    this.adjust(r.account, o.item, items);
    o.boxCoins = 0;
    o.boxItems = 0;
    // A finished, emptied offer frees its slot.
    if (o.status !== 'active') this.orders.delete(o.id);
    this.audit('collect', r.account, `#${o.id} ${items} ${o.item} + ${coins} coins`, r.nonce);
    return { ok: true, orderId: o.id, collected: { coins, items, item: o.item } };
  }

  private deposit(r: Extract<Request, { op: 'deposit' }>): Result {
    if (r.asset !== 'coins' && !tradeable(r.asset)) return { ok: false, error: 'Unknown asset.' };
    if (!isInt(r.qty, 1, MAX_COINS)) return { ok: false, error: 'Bad amount.' };
    if (this.balance(r.account, r.asset) + r.qty > MAX_COINS) return { ok: false, error: 'Too much.' };
    this.adjust(r.account, r.asset, r.qty);
    this.supply[r.asset] = (this.supply[r.asset] ?? 0) + r.qty;
    this.audit('deposit', r.account, `${r.qty} ${r.asset} from ${String(r.source).slice(0, 40)}`, r.nonce);
    return { ok: true };
  }

  private withdraw(r: Extract<Request, { op: 'withdraw' }>): Result {
    if (r.asset !== 'coins' && !tradeable(r.asset)) return { ok: false, error: 'Unknown asset.' };
    if (!isInt(r.qty, 1, MAX_COINS)) return { ok: false, error: 'Bad amount.' };
    if (this.balance(r.account, r.asset) < r.qty) return { ok: false, error: 'Not enough.' };
    this.adjust(r.account, r.asset, -r.qty);
    this.supply[r.asset] = (this.supply[r.asset] ?? 0) - r.qty;
    this.audit('withdraw', r.account, `${r.qty} ${r.asset} to ${String(r.dest).slice(0, 40)}`, r.nonce);
    return { ok: true };
  }

  // ---------------------------------------------------------------- internals

  private boughtRecently(account: string, item: ItemId, now: number): number {
    const key = `${account}|${item}`;
    const list = (this.bought[key] ?? []).filter((b) => now - b.at < this.opts.buyLimitWindowMs);
    this.bought[key] = list;
    return list.reduce((a, b) => a + b.qty, 0);
  }

  private adjust(account: string, asset: Asset, delta: number) {
    if (!delta) return;
    const b = (this.balances[account] ??= {});
    const v = (b[asset] ?? 0) + delta;
    if (v < 0) throw new Error(`exchange invariant broken: ${account} ${asset} would be ${v}`);
    if (v === 0) delete b[asset];
    else b[asset] = v;
  }

  private audit(op: string, account: string, detail: string, nonce?: number) {
    this.seq++;
    const prev = this.log.length ? this.log[this.log.length - 1].hash : this.checkpoint;
    const e = { seq: this.seq, at: this.clock(), op, account, nonce, detail };
    this.log.push({ ...e, hash: fnv(prev + JSON.stringify(e)) });
    if (this.log.length > this.opts.logLimit) this.checkpoint = this.log.shift()!.hash;
  }

  /**
   * Accounting check: for every asset, free balances + escrow + collection boxes must equal what was
   * deposited minus withdrawn. Also verifies the audit hash chain. Returns the problems found.
   */
  verify(): string[] {
    const problems: string[] = [];
    const held: Partial<Record<Asset, number>> = {};
    const add = (a: Asset, q: number) => (held[a] = (held[a] ?? 0) + q);
    for (const b of Object.values(this.balances)) for (const [a, q] of Object.entries(b)) add(a as Asset, q ?? 0);
    for (const o of this.orders.values()) {
      if (o.escrowCoins < 0 || o.escrowItems < 0 || o.boxCoins < 0 || o.boxItems < 0 || o.filled > o.qty) problems.push(`order #${o.id} has negative or overfilled amounts`);
      if (o.status === 'active' && (o.side === 'buy' ? o.escrowCoins !== (o.qty - o.filled) * o.price : o.escrowItems !== o.qty - o.filled)) problems.push(`order #${o.id} escrow doesn't match what is unfilled`);
      add('coins', o.escrowCoins + o.boxCoins);
      add(o.item, o.escrowItems + o.boxItems);
    }
    const assets = new Set([...Object.keys(held), ...Object.keys(this.supply)]) as Set<Asset>;
    for (const a of assets) if ((held[a] ?? 0) !== (this.supply[a] ?? 0)) problems.push(`${a}: holding ${held[a] ?? 0}, supply ${this.supply[a] ?? 0}`);
    let prev = this.checkpoint;
    for (const e of this.log) {
      const { hash, ...rest } = e;
      if (fnv(prev + JSON.stringify(rest)) !== hash) {
        problems.push(`audit chain broken at #${e.seq}`);
        break;
      }
      prev = hash;
    }
    return problems;
  }

  // ---------------------------------------------------------------- persistence

  toJSON() {
    return {
      v: 1,
      balances: this.balances,
      orders: [...this.orders.values()],
      supply: this.supply,
      seq: this.seq,
      nextOrderId: this.nextOrderId,
      nextTradeId: this.nextTradeId,
      trades: this.trades,
      log: this.log,
      checkpoint: this.checkpoint,
      nonces: this.nonces,
      bought: this.bought,
    };
  }

  /**
   * Restores a saved exchange; returns null if the data is malformed or fails its accounting check.
   * `check: false` puts back a state exactly as it was, even a broken one (a server undoing a
   * request it has just refused; the broken state is then reported, not silently replaced).
   */
  static restore(data: unknown, opts: ExchangeOptions = {}, check = true): Exchange | null {
    try {
      const d = data as ReturnType<Exchange['toJSON']>;
      if (!d || d.v !== 1 || !Array.isArray(d.orders) || !Array.isArray(d.log)) return null;
      const x = new Exchange(opts);
      x.balances = JSON.parse(JSON.stringify(d.balances ?? {}));
      for (const o of d.orders) x.orders.set(o.id, { ...o });
      x.supply = { ...(d.supply ?? {}) };
      x.seq = d.seq;
      x.nextOrderId = d.nextOrderId;
      x.nextTradeId = d.nextTradeId;
      x.trades = d.trades.map((t) => ({ ...t }));
      x.log = d.log.map((e) => ({ ...e }));
      x.checkpoint = d.checkpoint;
      x.nonces = JSON.parse(JSON.stringify(d.nonces ?? {}));
      x.bought = JSON.parse(JSON.stringify(d.bought ?? {}));
      return check && x.verify().length ? null : x;
    } catch {
      return null;
    }
  }
}
