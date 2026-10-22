import type { ItemId } from '../data/items';
import { tradeable, type Asset, type Order } from '../exchange/engine';
import { PRACTICE_ACCOUNT, traderName } from '../exchange/simulation';
import type { NetClient } from '../net/client';
import type { Guide, LiveIntent } from '../net/protocol';
import type { Command, GameWorld } from '../sim/world';

/**
 * Where the Exchange interface gets its data and sends its requests: the device's practice market,
 * or the server's live Exchange (docs/MULTIPLAYER.md 3A.7). The interface is the same for both; only
 * the labels and the storage screen differ.
 */
export interface MarketSource {
  readonly live: boolean;
  readonly slots: number;
  orders(): Order[];
  order(id: number): Order | undefined;
  /** Exchange storage: practice stock, or (live) proceeds that are waiting for room. */
  holdings(): { asset: Asset; qty: number }[];
  /** How much of an asset can go into a new offer. */
  available(asset: Asset): number;
  /** Items the player has to sell. */
  sellable(): ItemId[];
  /** The player's own trades, newest first (`who` is never a real player's name). */
  mine(limit: number): { id: number; item: ItemId; qty: number; price: number; bought: boolean; who: string; order?: number }[];
  /** Recent trades in the whole market. */
  market(limit: number): { id: number; item: ItemId; qty: number; price: number }[];
  /** The price guide for an item (null while the live one is on its way). */
  guide(item: ItemId): Guide | null;
  nextNonce(): number;
  send(req: LiveIntent): void;
  /** Called when the interface opens (the live market sends its current view). */
  open(): void;
}

/** The practice market: simulated traders and practice stock, all on this device. */
export class PracticeSource implements MarketSource {
  readonly live = false;
  constructor(
    private world: GameWorld,
    private command: (c: Command) => void,
  ) {}
  private get x() {
    return this.world.market.exchange;
  }
  get slots() {
    return this.x.slots;
  }
  orders() {
    return this.x.ordersOf(PRACTICE_ACCOUNT);
  }
  order(id: number) {
    return this.x.order(id);
  }
  holdings() {
    return this.x.holdings(PRACTICE_ACCOUNT);
  }
  available(asset: Asset) {
    return this.x.balance(PRACTICE_ACCOUNT, asset);
  }
  sellable() {
    return this.holdings().map((h) => h.asset).filter((a): a is ItemId => a !== 'coins');
  }
  mine(limit: number) {
    return this.x.history({ account: PRACTICE_ACCOUNT }, limit).map((t) => {
      const bought = t.buyer === PRACTICE_ACCOUNT;
      return { id: t.id, item: t.item, qty: t.qty, price: t.price, bought, who: traderName(bought ? t.seller : t.buyer), order: bought ? t.buyOrder : t.sellOrder };
    });
  }
  market(limit: number) {
    return this.x.history({}, limit);
  }
  guide(item: ItemId) {
    return this.x.guide(item);
  }
  nextNonce() {
    return this.x.nextNonce(PRACTICE_ACCOUNT);
  }
  send(req: LiveIntent) {
    if (req.op !== 'claim') this.command({ type: 'exchange', req });
  }
  open() {}
}

/** The live Exchange on the server: real items and coins, other real players (never named). */
export class LiveSource implements MarketSource {
  readonly live = true;
  private lastNonce = 0;
  private asked = new Set<ItemId>();
  constructor(
    private world: GameWorld,
    private net: NetClient,
  ) {}
  private get v() {
    return this.net.liveView;
  }
  get slots() {
    return this.v?.slots ?? 6;
  }
  orders() {
    return this.v?.orders ?? [];
  }
  order(id: number) {
    return this.orders().find((o) => o.id === id);
  }
  holdings() {
    return this.v?.holdings ?? [];
  }
  /** Exchange storage, the bank and the bag (what an offer draws on, in that order). */
  available(asset: Asset) {
    const p = this.world.player;
    return (this.holdings().find((h) => h.asset === asset)?.qty ?? 0) + p.bank.count(asset) + p.inventory.count(asset);
  }
  sellable() {
    const p = this.world.player;
    const ids = new Set<ItemId>();
    for (const s of p.bank.toJSON()) if (s.qty > 0) ids.add(s.item);
    for (const s of p.inventory.slots) if (s) ids.add(s.item);
    for (const h of this.holdings()) if (h.asset !== 'coins') ids.add(h.asset);
    return [...ids].filter((i) => tradeable(i));
  }
  mine(limit: number) {
    return (this.v?.mine ?? []).slice(0, limit).map((t) => ({ ...t, who: 'another player' }));
  }
  market(limit: number) {
    return (this.v?.market ?? []).slice(0, limit);
  }
  guide(item: ItemId) {
    const g = this.net.guides.get(item);
    if (!g && !this.asked.has(item)) {
      this.asked.add(item);
      this.net.gxGuide(item);
    }
    return g ?? null;
  }
  nextNonce() {
    return Math.max(this.v?.nonce ?? 1, this.lastNonce + 1);
  }
  send(req: LiveIntent) {
    this.lastNonce = Math.max(this.lastNonce, req.nonce);
    this.net.gx(req);
  }
  open() {
    // Guides go stale as the market moves: ask again when the interface opens.
    this.asked.clear();
    this.net.guides.clear();
    this.net.gxOpen();
  }
}
