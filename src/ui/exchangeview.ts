import { ITEMS, itemDef, type ItemId } from '../data/items';
import { tradeable, type Order, type Side } from '../exchange/engine';
import type { LiveResult } from '../net/protocol';
import { itemIcon } from './icons';
import type { MarketSource } from './marketsource';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

const fmt = (n: number) => n.toLocaleString('en-GB');
const name = (item: ItemId) => itemDef(item).name;

type Screen = { kind: 'offers' } | { kind: 'storage' } | { kind: 'history' } | { kind: 'new'; side: Side; slot: number; item: ItemId | null } | { kind: 'detail'; orderId: number };

/** Plain-language status of an offer for its card and detail view. */
function statusText(o: Order): { label: string; tone: 'active' | 'done' | 'cancelled' } {
  const verb = o.side === 'buy' ? 'bought' : 'sold';
  if (o.status === 'completed') return { label: `Completed: all ${fmt(o.qty)} ${verb}`, tone: 'done' };
  if (o.status === 'cancelled') return { label: `Cancelled after ${fmt(o.filled)} ${verb}`, tone: 'cancelled' };
  return { label: o.filled > 0 ? `Part filled: ${fmt(o.filled)} of ${fmt(o.qty)} ${verb}` : 'Waiting for a match', tone: 'active' };
}

/**
 * The Exchange interface, over either market (src/ui/marketsource.ts):
 * - the PRACTICE market on this device: practice stock and simulated traders;
 * - the LIVE Exchange on the server (only when connected to a server that has it switched on):
 *   real items and coins, traded with other players, who are never named.
 * The view sends intents (place, cancel, collect, take out) and redraws from what the market reports;
 * it never decides balances or results itself.
 */
export class ExchangeView {
  readonly root = el('div', 'gx');
  private screen: Screen = { kind: 'offers' };
  private notice: { text: string; ok: boolean } | null = null;
  private pending = new Map<string, string>();
  private search = '';
  private qty = 1;
  private price = 1;
  /** The price was filled in from the item's value while the live guide loads: replace it when it arrives. */
  private priceAuto = false;
  /** The form on screen was drawn before its price guide arrived. */
  private formLoading = false;
  private src: MarketSource;

  constructor(
    private practice: MarketSource,
    private liveSource: MarketSource | null,
    private confirmTap: (key: string, btn: HTMLButtonElement, prompt: string) => boolean,
    private practiceReset: () => void,
  ) {
    this.src = liveSource ?? practice;
    this.src.open();
    this.render();
  }

  /** Which market is showing. */
  get live() {
    return this.src.live;
  }

  private get coinWord() {
    return this.src.live ? 'coins' : 'practice coins';
  }

  private shownKey = '';

  /**
   * What the current screen shows: the market moves every few seconds, but the view only redraws
   * when something it displays changed (so taps aren't lost to needless redraws).
   */
  stateKey(): string {
    const s = this.screen;
    const mine = JSON.stringify(this.src.orders()) + JSON.stringify(this.src.holdings());
    const market = s.kind === 'history' ? `${this.src.market(1)[0]?.id ?? 0}/${this.src.mine(1)[0]?.id ?? 0}` : s.kind === 'new' && s.item ? JSON.stringify(this.src.guide(s.item)) : s.kind === 'new' ? JSON.stringify(this.src.sellable()) : '';
    return `${this.src.live}|${s.kind}|${mine}|${market}`;
  }

  /** Redraws only if what this screen shows has changed. */
  refresh() {
    if (this.stateKey() !== this.shownKey) this.render();
  }

  /** True while the player is filling in a form (live market updates then wait). */
  get busy(): boolean {
    // A form drawn while its live price guide was on its way may be redrawn (it fills in the price).
    return this.screen.kind === 'new' && this.screen.item !== null && !this.formLoading;
  }

  /** A result for one of this view's requests (from the practice market or the live Exchange). */
  onResult(nonce: number, result: LiveResult, live = false) {
    const key = `${live}:${nonce}`;
    const what = this.pending.get(key);
    if (what === undefined) return;
    this.pending.delete(key);
    if (result.ok) {
      if (what === 'place') {
        const t = result.trades?.reduce((a, tr) => a + tr.qty, 0) ?? 0;
        this.notice = { text: t > 0 ? `Offer placed: ${fmt(t)} matched straight away.` : 'Offer placed. It waits until a matching offer arrives.', ok: true };
        this.screen = { kind: 'offers' };
      } else if (what === 'collect') {
        const c = result.collected!;
        const got = [c.items ? `${fmt(c.items)} ${name(c.item!).toLowerCase()}` : '', c.coins ? `${fmt(c.coins)} ${this.coinWord}` : ''].filter(Boolean).join(' and ');
        this.notice = { text: result.note ? `Collected ${got}. ${result.note}` : `Collected ${got} into practice storage.`, ok: true };
        if (this.screen.kind === 'detail' && !this.src.order(this.screen.orderId)) this.screen = { kind: 'offers' };
      } else if (what === 'claim') this.notice = { text: result.note ?? 'Taken out of exchange storage.', ok: true };
      else this.notice = { text: 'Offer cancelled. Anything unspent is waiting to be collected.', ok: true };
    } else this.notice = { text: result.error, ok: false };
    this.render();
  }

  private send(req: { op: 'place'; slot: number; side: Side; item: ItemId; qty: number; price: number } | { op: 'cancel' | 'collect'; orderId: number } | { op: 'claim' }) {
    const nonce = this.src.nextNonce();
    this.pending.set(`${this.src.live}:${nonce}`, req.op);
    this.src.send({ ...req, nonce } as never);
  }

  /** Switches between the live and the practice market (when both are available). */
  private use(src: MarketSource) {
    if (src === this.src) return;
    this.src = src;
    src.open();
    this.screen = { kind: 'offers' };
    this.notice = null;
    this.render();
  }

  render(): void {
    const r = this.root;
    this.shownKey = this.stateKey();
    const scroll = r.querySelector('.gx-list')?.scrollTop ?? 0;
    r.replaceChildren();
    if (this.liveSource) {
      const modes = el('div', 'gx-modes');
      for (const [src, label] of [[this.liveSource, 'Live'], [this.practice, 'Practice']] as const) {
        const b = el('button', `bank-chip${this.src === src ? ' active' : ''}${src.live ? ' live' : ''}`, label);
        b.addEventListener('click', () => this.use(src));
        modes.appendChild(b);
      }
      r.appendChild(modes);
    }
    r.appendChild(
      this.src.live
        ? el('div', 'gx-banner live', '🟢 <b>Live market</b> · real items and coins, traded with other players. An offer takes what it needs from your bank, then your bag; what you collect goes to your bag, then your bank.')
        : el('div', 'gx-banner', `🧪 <b>Practice market</b> · simulated traders and practice coins. Your real items and coins are never used.${this.liveSource ? '' : ' Live trading with other players opens on servers that have it switched on.'}`),
    );
    if (this.screen.kind === 'new') return this.renderNew(this.screen);
    if (this.screen.kind === 'detail') return this.renderDetail(this.screen.orderId);
    const tabs = el('div', 'gx-tabs');
    for (const [k, label] of [['offers', 'Offers'], ['storage', 'Storage'], ['history', 'History']] as const) {
      const b = el('button', `bank-chip${this.screen.kind === k ? ' active' : ''}`, label);
      b.addEventListener('click', () => {
        this.screen = { kind: k };
        this.notice = null;
        this.render();
      });
      tabs.appendChild(b);
    }
    r.appendChild(tabs);
    this.renderNotice();
    if (this.screen.kind === 'offers') this.renderOffers();
    else if (this.screen.kind === 'storage') this.renderStorage();
    else this.renderHistory();
    const list = r.querySelector('.gx-list');
    if (list) list.scrollTop = scroll;
  }

  private renderNotice() {
    if (this.notice) this.root.appendChild(el('div', `gx-notice${this.notice.ok ? '' : ' bad'}`, this.notice.text));
  }

  private renderOffers() {
    const orders = this.src.orders();
    const grid = el('div', 'gx-slots gx-list');
    // Offers placed before the slot count dropped to six stay visible until collected.
    const shown = Math.max(this.src.slots, ...orders.map((o) => o.slot + 1));
    for (let slot = 0; slot < shown; slot++) {
      const o = orders.find((x) => x.slot === slot);
      if (!o && slot >= this.src.slots) continue;
      if (!o) {
        const card = el('div', 'gx-slot empty', `<div class="gx-slot-title">Slot ${slot + 1} · empty</div>`);
        const btns = el('div', 'gx-slot-btns');
        for (const side of ['buy', 'sell'] as const) {
          const b = el('button', `bank-btn${side === 'buy' ? ' primary' : ''}`, side === 'buy' ? 'Buy' : 'Sell');
          b.addEventListener('click', () => this.openNew(side, slot));
          btns.appendChild(b);
        }
        card.appendChild(btns);
        grid.appendChild(card);
        continue;
      }
      const st = statusText(o);
      const ready = o.boxCoins > 0 || o.boxItems > 0;
      const card = el('button', `gx-slot ${o.side} ${st.tone}`);
      card.innerHTML = `<div class="gx-slot-head"><span class="gx-side ${o.side}">${o.side.toUpperCase()}</span>${ready ? '<span class="gx-ready">Collect</span>' : ''}</div>
        <div class="gx-slot-item"><img src="${itemIcon(o.item)}" alt=""><span>${name(o.item)}</span></div>
        <div class="gx-bar"><div style="width:${(o.filled / o.qty) * 100}%"></div></div>
        <div class="gx-slot-sub">${fmt(o.filled)}/${fmt(o.qty)} · ${fmt(o.price)} each</div>
        <div class="gx-slot-status">${st.label}</div>`;
      card.addEventListener('click', () => {
        this.screen = { kind: 'detail', orderId: o.id };
        this.notice = null;
        this.render();
      });
      grid.appendChild(card);
    }
    this.root.appendChild(grid);
  }

  private renderDetail(id: number): void {
    const o = this.src.order(id);
    if (!o) {
      this.screen = { kind: 'offers' };
      return this.render();
    }
    const st = statusText(o);
    const avg = o.filled ? Math.round(o.value / o.filled) : 0;
    const box = el('div', 'gx-detail gx-list');
    box.innerHTML = `<div class="gx-detail-head"><img src="${itemIcon(o.item)}" alt=""><div><div class="ii-name">${o.side === 'buy' ? 'Buying' : 'Selling'} ${fmt(o.qty)} × ${name(o.item)}</div><div class="ii-desc">Slot ${o.slot + 1} · ${o.side === 'buy' ? 'paying up to' : 'asking at least'} ${fmt(o.price)} each</div></div></div>
      <div class="gx-bar big"><div style="width:${(o.filled / o.qty) * 100}%"></div></div>
      <div class="gx-status ${st.tone}">${st.label}${o.filled ? ` · average ${fmt(avg)} each` : ''}</div>
      <div class="ii-desc">Waiting to collect: ${o.boxItems ? `${fmt(o.boxItems)} ${name(o.item).toLowerCase()}` : 'no items'}, ${fmt(o.boxCoins)} ${this.coinWord}.</div>`;
    const trades = this.src.mine(200).filter((t) => t.order === o.id || (this.src.live && t.item === o.item && t.bought === (o.side === 'buy')));
    if (trades.length) {
      box.appendChild(el('div', 'gx-sub', this.src.live ? 'Recent fills' : 'Fills (simulated traders)'));
      for (const t of trades.slice(0, 12)) box.appendChild(el('div', 'gx-row', `${fmt(t.qty)} @ ${fmt(t.price)} with ${t.who}`));
    }
    const btns = el('div', 'ii-btns');
    const back = el('button', 'bank-btn', '‹ Back');
    back.addEventListener('click', () => {
      this.screen = { kind: 'offers' };
      this.notice = null;
      this.render();
    });
    btns.appendChild(back);
    if (o.boxCoins > 0 || o.boxItems > 0 || o.status !== 'active') {
      const c = el('button', 'bank-btn primary', o.status === 'active' ? 'Collect' : 'Collect & clear slot');
      c.addEventListener('click', () => this.send({ op: 'collect', orderId: o.id }));
      btns.appendChild(c);
    }
    if (o.status === 'active') {
      const a = el('button', 'bank-btn', 'Abort offer');
      a.addEventListener('click', () => {
        if (this.confirmTap(`gx-abort-${o.id}`, a, 'Tap again to abort')) this.send({ op: 'cancel', orderId: o.id });
      });
      btns.appendChild(a);
    }
    this.root.appendChild(btns);
    this.renderNotice();
    this.root.appendChild(box);
  }

  private openNew(side: Side, slot: number) {
    this.screen = { kind: 'new', side, slot, item: null };
    this.search = '';
    this.notice = null;
    this.render();
  }

  private renderNew(s: Extract<Screen, { kind: 'new' }>): void {
    const back = el('button', 'bank-btn', '‹ Back');
    back.addEventListener('click', () => {
      if (s.item) s.item = null;
      else this.screen = { kind: 'offers' };
      this.render();
    });
    const head = el('div', 'gx-newhead', `<b>${s.side === 'buy' ? 'Buy offer' : 'Sell offer'}</b> · slot ${s.slot + 1}`);
    head.prepend(back);
    this.root.appendChild(head);
    this.renderNotice();
    if (!s.item) return this.renderPicker(s);
    const item = s.item;
    const g = this.src.guide(item) ?? { price: Math.max(1, itemDef(item).value), fromTrades: false, bestBid: null, bestAsk: null, volume: 0 };
    const loading = this.src.guide(item) === null;
    this.formLoading = loading;
    if (!loading && this.priceAuto) {
      this.price = g.price;
      this.priceAuto = false;
    }
    const have = this.src.available(s.side === 'buy' ? 'coins' : item);
    const where = this.src.live ? 'in your bank and bag' : s.side === 'buy' ? '' : 'in practice storage';
    const form = el('div', 'gx-form gx-list');
    form.innerHTML = `<div class="gx-detail-head"><img src="${itemIcon(item)}" alt=""><div><div class="ii-name">${name(item)}</div><div class="ii-desc">${itemDef(item).examine}</div></div></div>
      <div class="gx-guide">${loading ? 'Asking the clerks for the latest prices…' : `Guide price <b>${fmt(g.price)}</b> ${g.fromTrades ? `(recent trades, ${fmt(g.volume)} traded)` : '(no trades yet: item value)'} · best buy offer ${g.bestBid ? fmt(g.bestBid) : '—'} · best sell offer ${g.bestAsk ? fmt(g.bestAsk) : '—'}`}</div>`;
    const maxQty = s.side === 'sell' ? have : 1_000_000;
    // Quantity: − [n] + and quick amounts.
    const qrow = el('div', 'gx-field', '<span>Quantity</span>');
    const qin = el('input', 'bank-qty');
    qin.type = 'number';
    qin.inputMode = 'numeric';
    qin.min = '1';
    qin.value = String(this.qty);
    const clampQ = (v: number) => Math.max(1, Math.min(Math.max(1, maxQty), Math.floor(v) || 1));
    const qbtns = el('div', 'gx-quick');
    for (const [label, f] of [['−', (v: number) => v - 1], ['+', (v: number) => v + 1], ['+10', (v: number) => v + 10], ['+100', (v: number) => v + 100], ...(s.side === 'sell' ? [['All', () => maxQty] as const] : [])] as const) {
      const b = el('button', 'bank-step', label);
      b.addEventListener('click', () => {
        this.qty = clampQ(f(Number(qin.value)));
        qin.value = String(this.qty);
        sync();
      });
      qbtns.appendChild(b);
    }
    qrow.append(qin, qbtns);
    // Price: input with −5% / guide / +5%.
    const prow = el('div', 'gx-field', '<span>Price each</span>');
    const pin = el('input', 'bank-qty');
    pin.type = 'number';
    pin.inputMode = 'numeric';
    pin.min = '1';
    pin.value = String(this.price);
    const clampP = (v: number) => Math.max(1, Math.floor(v) || 1);
    const pbtns = el('div', 'gx-quick');
    for (const [label, f] of [['−5%', (v: number) => Math.min(v - 1, Math.floor(v * 0.95))], ['Guide', () => g.price], ['+5%', (v: number) => Math.max(v + 1, Math.ceil(v * 1.05))]] as const) {
      const b = el('button', 'bank-step', label);
      b.addEventListener('click', () => {
        this.priceAuto = false;
        this.price = clampP(f(Number(pin.value)));
        pin.value = String(this.price);
        sync();
      });
      pbtns.appendChild(b);
    }
    prow.append(pin, pbtns);
    const total = el('div', 'gx-total');
    const confirm = el('button', 'bank-btn primary gx-confirm', 'Confirm offer');
    const sync = () => {
      this.qty = clampQ(Number(qin.value));
      this.price = clampP(Number(pin.value));
      const t = this.qty * this.price;
      const short = s.side === 'buy' ? t > have : this.qty > have;
      total.innerHTML = `${s.side === 'buy' ? 'Total cost' : 'You receive at least'} <b>${fmt(t)}</b> ${this.coinWord} · ${s.side === 'buy' ? `you have ${fmt(have)} ${this.coinWord}${this.src.live ? ` ${where}` : ''}` : `you have ${fmt(have)} ${where}`}${short ? ' <span class="miss">· not enough</span>' : ''}`;
      confirm.disabled = short;
    };
    qin.addEventListener('input', sync);
    pin.addEventListener('input', () => {
      this.priceAuto = false;
      sync();
    });
    confirm.addEventListener('click', () => {
      sync();
      this.send({ op: 'place', slot: s.slot, side: s.side, item, qty: this.qty, price: this.price });
    });
    sync();
    form.append(qrow, prow, total, confirm);
    this.root.appendChild(form);
  }

  /** Item search: everything tradeable to buy; only what the player has to sell. */
  private renderPicker(s: Extract<Screen, { kind: 'new' }>) {
    const input = el('input', 'bank-search gx-search');
    input.type = 'search';
    input.placeholder = s.side === 'buy' ? 'Search items to buy' : this.src.live ? 'Search your bank and bag' : 'Search your practice storage';
    input.value = this.search;
    const list = el('div', 'gx-picker gx-list');
    const fill = () => {
      this.search = input.value;
      const q = input.value.trim().toLowerCase();
      list.replaceChildren();
      const ids = s.side === 'buy' ? tradeableItems() : this.src.sellable().sort((a, b) => name(a).localeCompare(name(b)));
      const shown = ids.filter((i) => !q || name(i).toLowerCase().includes(q)).slice(0, 60);
      if (!shown.length) list.appendChild(el('div', 'bank-empty', s.side === 'sell' ? (this.src.live ? 'Nothing in your bank or bag matches.' : 'Nothing in practice storage matches. Buy something first, or reset the practice market.') : 'No items match.'));
      for (const i of shown) {
        // The live guide comes from the server: shown once it arrives (the item's value until then).
        const g = this.src.live ? null : this.src.guide(i);
        const own = s.side === 'sell' ? ` · you have ${fmt(this.src.available(i))}` : '';
        const b = el('button', 'gx-pick', `<img src="${itemIcon(i)}" alt=""><span class="gx-pick-name">${name(i)}</span><span class="gx-pick-price">${g ? fmt(g.price) : ''}${own}</span>`);
        b.addEventListener('click', () => {
          s.item = i;
          const known = this.src.guide(i);
          this.price = known?.price ?? Math.max(1, itemDef(i).value);
          this.priceAuto = known === null;
          this.qty = s.side === 'sell' ? Math.min(this.src.available(i), 10) || 1 : 1;
          this.render();
        });
        list.appendChild(b);
      }
    };
    input.addEventListener('input', fill);
    fill();
    this.root.append(input, list);
  }

  private renderStorage() {
    const list = el('div', 'gx-list gx-storage');
    const live = this.src.live;
    list.appendChild(
      el('div', 'ii-desc', live ? 'Exchange storage holds what you collected but had no room for in your bag or bank. Take it out once there is room.' : 'Practice storage holds what you collect from offers. It is separate from your inventory and bank: practice stock can’t leave the practice market.'),
    );
    const hold = this.src.holdings().sort((a, b) => (a.asset === 'coins' ? -1 : b.asset === 'coins' ? 1 : 0));
    for (const h of hold) list.appendChild(el('div', 'gx-row gx-hold', `<img src="${itemIcon(h.asset === 'coins' ? 'coins' : h.asset)}" alt=""><span>${h.asset === 'coins' ? (live ? 'Coins' : 'Practice coins') : name(h.asset)}</span><b>${fmt(h.qty)}</b>`));
    if (!hold.length) list.appendChild(el('div', 'bank-empty', live ? 'Exchange storage is empty.' : 'Practice storage is empty.'));
    if (live) {
      if (hold.length) {
        const out = el('button', 'bank-btn primary', 'Take out');
        out.addEventListener('click', () => this.send({ op: 'claim' }));
        list.appendChild(out);
      }
      this.root.appendChild(list);
      return;
    }
    const reset = el('button', 'bank-btn', 'Reset practice market');
    reset.addEventListener('click', () => {
      if (!this.confirmTap('gx-reset', reset, 'Tap again: start over')) return;
      this.practiceReset();
      this.notice = { text: 'Practice market reset with fresh practice stock.', ok: true };
      this.render();
    });
    list.appendChild(reset);
    this.root.appendChild(list);
  }

  private renderHistory() {
    const list = el('div', 'gx-list gx-history');
    const live = this.src.live;
    const mine = this.src.mine(40);
    list.appendChild(el('div', 'gx-sub', live ? 'Your trades' : 'Your practice trades'));
    if (!mine.length) list.appendChild(el('div', 'bank-empty', live ? 'No trades yet.' : 'No practice trades yet.'));
    for (const t of mine) list.appendChild(el('div', 'gx-row', `<img src="${itemIcon(t.item)}" alt=""><span>${t.bought ? 'Bought' : 'Sold'} ${fmt(t.qty)} ${name(t.item).toLowerCase()} @ ${fmt(t.price)} ${t.bought ? 'from' : 'to'} ${t.who}</span>`));
    list.appendChild(el('div', 'gx-sub', live ? 'Recent market activity' : 'Recent market activity (simulated traders)'));
    for (const t of this.src.market(25)) list.appendChild(el('div', 'gx-row dim', `<img src="${itemIcon(t.item)}" alt=""><span>${fmt(t.qty)} ${name(t.item).toLowerCase()} @ ${fmt(t.price)}</span>`));
    this.root.appendChild(list);
  }
}

let index: ItemId[] | null = null;
/** Every tradeable item id, by name (computed once). */
function tradeableItems(): ItemId[] {
  index ??= (Object.keys(ITEMS) as ItemId[]).filter((id) => tradeable(id)).sort((a, b) => name(a).localeCompare(name(b)));
  return index;
}
