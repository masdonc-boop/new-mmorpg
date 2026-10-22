import { itemDef, type ItemId } from '../src/data/items';
import type { Exchange, Trade } from '../src/exchange/engine';
import type { LiveIntent } from '../src/net/protocol';

/**
 * Safeguards for the live Exchange (docs/MULTIPLAYER.md 3B.3), in front of the engine:
 * - **rate limits** per account (kept across reconnects, so dropping the connection doesn't reset them);
 * - **offer rules**: a price band around the guide, a largest offer, items that can't be traded,
 *   and how old an account must be;
 * - **watching** for patterns worth a moderator's look (lopsided prices, the same two accounts
 *   trading again and again, offers placed and pulled in quick succession). These are only logged:
 *   honest players do all of these sometimes.
 */
export interface ExchangePolicy {
  /** Requests per account per minute (place, cancel, collect, take out). */
  requestsPerMinute: number;
  /** Price guide lookups per account per minute. */
  guidesPerMinute: number;
  /**
   * How far from the guide an offer's price may be, as a factor: with 5, between a fifth and five
   * times the guide when it comes from recent trades. Items nobody has traded yet use their value
   * and `untradedBand`. Null switches the band off.
   */
  priceBand: number | null;
  untradedBand: number;
  /** The most one offer may be worth, in coins. */
  maxOfferValue: number;
  /** Items the live Exchange won't take. */
  blockedItems: ItemId[];
  /** Accounts younger than this can't use the live Exchange. */
  minAccountAgeMinutes: number;
  /** Flag a trade this many times above or below the guide it happened against. */
  outlierFactor: number;
  /** Flag the same buyer and seller trading more than this often within an hour. */
  repeatPairPerHour: number;
  /** Flag an account placing and cancelling more than this many offers within ten minutes. */
  churnPer10Minutes: number;
}

export const DEFAULT_EXCHANGE_POLICY: ExchangePolicy = {
  requestsPerMinute: 30,
  guidesPerMinute: 120,
  priceBand: 5,
  untradedBand: 20,
  maxOfferValue: 50_000_000,
  blockedItems: [],
  minAccountAgeMinutes: 0,
  outlierFactor: 3,
  repeatPairPerHour: 6,
  churnPer10Minutes: 20,
};

export interface ExchangeFlag {
  account: string;
  kind: string;
  detail: string;
}

/** A per-key token bucket: `perMinute` requests, refilled steadily. */
export class Bucket {
  private state = new Map<string, { tokens: number; at: number }>();
  constructor(
    private perMinute: number,
    private now: () => number,
  ) {}
  take(key: string): boolean {
    const t = this.now();
    const s = this.state.get(key) ?? { tokens: this.perMinute, at: t };
    s.tokens = Math.min(this.perMinute, s.tokens + ((t - s.at) / 60_000) * this.perMinute);
    s.at = t;
    this.state.set(key, s);
    if (s.tokens < 1) return false;
    s.tokens -= 1;
    return true;
  }
}

/** Whether policy allows this request (before it reaches the engine); a reason if not. */
export function checkOffer(policy: ExchangePolicy, x: Exchange, req: LiveIntent, accountAgeMs: number): string | null {
  if (accountAgeMs < policy.minAccountAgeMinutes * 60_000) return `New accounts can use the live Exchange after ${policy.minAccountAgeMinutes} minutes.`;
  if (req.op !== 'place') return null;
  if (policy.blockedItems.includes(req.item)) return `${itemDef(req.item).name} can’t be traded on the live Exchange.`;
  if (req.qty * req.price > policy.maxOfferValue) return `Offers are limited to ${policy.maxOfferValue.toLocaleString()} coins.`;
  if (policy.priceBand !== null) {
    const g = x.guide(req.item);
    const band = g.fromTrades ? policy.priceBand : policy.untradedBand;
    const lo = Math.max(1, Math.floor(g.price / band));
    const hi = Math.max(lo, Math.ceil(g.price * band));
    if (req.price < lo || req.price > hi) return `That price is too far from the guide (${g.price.toLocaleString()}): offers for ${itemDef(req.item).name.toLowerCase()} must be between ${lo.toLocaleString()} and ${hi.toLocaleString()} each.`;
  }
  return null;
}

/** Remembers recent activity and says what looks unusual. */
export class ExchangeWatch {
  private pairs = new Map<string, number[]>();
  private churn = new Map<string, number[]>();
  constructor(
    private policy: ExchangePolicy,
    private now: () => number,
  ) {}

  /** After a request: `guideBefore` is the item's guide just before it was placed (for trades). */
  observe(account: string, req: LiveIntent, trades: Trade[], guideBefore: { price: number; fromTrades: boolean } | null): ExchangeFlag[] {
    const t = this.now();
    const flags: ExchangeFlag[] = [];
    if (req.op === 'place' || req.op === 'cancel') {
      const list = (this.churn.get(account) ?? []).filter((at) => t - at < 600_000);
      list.push(t);
      this.churn.set(account, list);
      if (list.length === this.policy.churnPer10Minutes + 1) flags.push({ account, kind: 'churn', detail: `${list.length} offers placed or cancelled in ten minutes` });
    }
    for (const tr of trades) {
      if (guideBefore?.fromTrades) {
        const f = this.policy.outlierFactor;
        if (tr.price > guideBefore.price * f || tr.price * f < guideBefore.price) {
          const detail = `${tr.qty} ${tr.item} at ${tr.price} each against a guide of ${guideBefore.price} (trade #${tr.id})`;
          flags.push({ account: tr.buyer, kind: 'price-outlier', detail }, { account: tr.seller, kind: 'price-outlier', detail });
        }
      }
      const key = `${tr.buyer}>${tr.seller}`;
      const list = (this.pairs.get(key) ?? []).filter((at) => t - at < 3600_000);
      list.push(t);
      this.pairs.set(key, list);
      if (list.length === this.policy.repeatPairPerHour + 1) {
        const detail = `${tr.buyer} bought from ${tr.seller} ${list.length} times in an hour`;
        flags.push({ account: tr.buyer, kind: 'repeat-pair', detail }, { account: tr.seller, kind: 'repeat-pair', detail });
      }
    }
    return flags;
  }
}
