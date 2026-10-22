import { ITEMS, itemDef, type ItemId } from '../data/items';
import { tradeable, type Order, type Result, type Side } from '../exchange/engine';
import { PRACTICE_ACCOUNT, traderName } from '../exchange/simulation';
import type { Command, GameWorld } from '../sim/world';
import { itemIcon } from './icons';

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
 * The Exchange interface. Today it is wired to the PRACTICE market only: every coin and item shown
 * is practice stock and the other traders are simulated. The view sends intents (place, cancel,
 * collect) and redraws from engine state; it never decides balances or results itself.
 */
export class ExchangeView {
  readonly root = el('div', 'gx');
  private screen: Screen = { kind: 'offers' };
  private notice: { text: string; ok: boolean } | null = null;
  private pending = new Map<number, string>();
  private search = '';
  private qty = 1;
  private price = 1;

  constructor(
    private world: GameWorld,
    private command: (c: Command) => void,
    private confirmTap: (key: string, btn: HTMLButtonElement, prompt: string) => boolean,
  ) {
    this.render();
  }

  private get x() {
    return this.world.market.exchange;
  }

  private shownKey = '';

  /**
   * What the current screen shows: the market moves every few seconds, but the view only redraws
   * when something it displays changed (so taps aren't lost to needless redraws).
   */
  stateKey(): string {
    const s = this.screen;
    const mine = JSON.stringify(this.x.ordersOf(PRACTICE_ACCOUNT)) + JSON.stringify(this.x.holdings(PRACTICE_ACCOUNT));
    const market = s.kind === 'history' ? String(this.x.history({}, 1)[0]?.id ?? 0) : s.kind === 'new' && s.item ? JSON.stringify(this.x.guide(s.item)) : '';
    return `${s.kind}|${mine}|${market}`;
  }

  /** Redraws only if what this screen shows has changed. */
  refresh() {
    if (this.stateKey() !== this.shownKey) this.render();
  }

  /** True while the player is filling in a form (live market updates then wait). */
  get busy(): boolean {
    return this.screen.kind === 'new' && this.screen.item !== null;
  }

  /** A result from the simulation for one of this view's requests. */
  onResult(nonce: number, result: Result) {
    const what = this.pending.get(nonce);
    if (what === undefined) return;
    this.pending.delete(nonce);
    if (result.ok) {
      if (what === 'place') {
        const t = result.trades?.reduce((a, tr) => a + tr.qty, 0) ?? 0;
        this.notice = { text: t > 0 ? `Offer placed: ${fmt(t)} matched straight away.` : 'Offer placed. It waits until a matching offer arrives.', ok: true };
        this.screen = { kind: 'offers' };
      } else if (what === 'collect') {
        const c = result.collected!;
        this.notice = { text: `Collected ${[c.items ? `${fmt(c.items)} ${name(c.item!).toLowerCase()}` : '', c.coins ? `${fmt(c.coins)} practice coins` : ''].filter(Boolean).join(' and ')} into practice storage.`, ok: true };
        if (this.screen.kind === 'detail' && !this.x.order(this.screen.orderId)) this.screen = { kind: 'offers' };
      } else this.notice = { text: 'Offer cancelled. Anything unspent is waiting to be collected.', ok: true };
    } else this.notice = { text: result.error, ok: false };
    this.render();
  }

  private send(req: { op: 'place'; slot: number; side: Side; item: ItemId; qty: number; price: number } | { op: 'cancel' | 'collect'; orderId: number }) {
    const nonce = this.x.nextNonce(PRACTICE_ACCOUNT);
    this.pending.set(nonce, req.op);
    this.command({ type: 'exchange', req: { ...req, nonce } as never });
  }

  render(): void {
    const r = this.root;
    this.shownKey = this.stateKey();
    const scroll = r.querySelector('.gx-list')?.scrollTop ?? 0;
    r.replaceChildren();
    r.appendChild(el('div', 'gx-banner', '🧪 <b>Practice market</b> · simulated traders and practice coins. Your real items and coins are never used. Live trading with other players arrives with multiplayer.'));
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
    const orders = this.x.ordersOf(PRACTICE_ACCOUNT);
    const grid = el('div', 'gx-slots gx-list');
    // Offers placed before the slot count dropped to six stay visible until collected.
    const shown = Math.max(this.x.slots, ...orders.map((o) => o.slot + 1));
    for (let slot = 0; slot < shown; slot++) {
      const o = orders.find((x) => x.slot === slot);
      if (!o && slot >= this.x.slots) continue;
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
    const o = this.x.order(id);
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
      <div class="ii-desc">Waiting to collect: ${o.boxItems ? `${fmt(o.boxItems)} ${name(o.item).toLowerCase()}` : 'no items'}, ${fmt(o.boxCoins)} practice coins.</div>`;
    const trades = this.x.history({ account: PRACTICE_ACCOUNT, item: o.item }, 200).filter((t) => t.buyOrder === o.id || t.sellOrder === o.id);
    if (trades.length) {
      box.appendChild(el('div', 'gx-sub', 'Fills (simulated traders)'));
      for (const t of trades.slice(0, 12)) box.appendChild(el('div', 'gx-row', `${fmt(t.qty)} @ ${fmt(t.price)} with ${traderName(o.side === 'buy' ? t.seller : t.buyer)}`));
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
    const g = this.x.guide(item);
    const have = this.x.balance(PRACTICE_ACCOUNT, s.side === 'buy' ? 'coins' : item);
    const form = el('div', 'gx-form gx-list');
    form.innerHTML = `<div class="gx-detail-head"><img src="${itemIcon(item)}" alt=""><div><div class="ii-name">${name(item)}</div><div class="ii-desc">${itemDef(item).examine}</div></div></div>
      <div class="gx-guide">Guide price <b>${fmt(g.price)}</b> ${g.fromTrades ? `(recent trades, ${fmt(g.volume)} traded)` : '(no trades yet: item value)'} · best buy offer ${g.bestBid ? fmt(g.bestBid) : '—'} · best sell offer ${g.bestAsk ? fmt(g.bestAsk) : '—'}</div>`;
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
      total.innerHTML = `${s.side === 'buy' ? 'Total cost' : 'You receive at least'} <b>${fmt(t)}</b> practice coins · ${s.side === 'buy' ? `you have ${fmt(have)} practice coins` : `you have ${fmt(have)} in practice storage`}${short ? ' <span class="miss">· not enough</span>' : ''}`;
      confirm.disabled = short;
    };
    qin.addEventListener('input', sync);
    pin.addEventListener('input', sync);
    confirm.addEventListener('click', () => {
      sync();
      this.send({ op: 'place', slot: s.slot, side: s.side, item, qty: this.qty, price: this.price });
    });
    sync();
    form.append(qrow, prow, total, confirm);
    this.root.appendChild(form);
  }

  /** Item search: everything tradeable to buy; only what's in practice storage to sell. */
  private renderPicker(s: Extract<Screen, { kind: 'new' }>) {
    const input = el('input', 'bank-search gx-search');
    input.type = 'search';
    input.placeholder = s.side === 'buy' ? 'Search items to buy' : 'Search your practice storage';
    input.value = this.search;
    const list = el('div', 'gx-picker gx-list');
    const fill = () => {
      this.search = input.value;
      const q = input.value.trim().toLowerCase();
      list.replaceChildren();
      const ids = s.side === 'buy' ? tradeableItems() : (this.x.holdings(PRACTICE_ACCOUNT).map((h) => h.asset).filter((a) => a !== 'coins') as ItemId[]);
      const shown = ids.filter((i) => !q || name(i).toLowerCase().includes(q)).slice(0, 60);
      if (!shown.length) list.appendChild(el('div', 'bank-empty', s.side === 'sell' ? 'Nothing in practice storage matches. Buy something first, or reset the practice market.' : 'No items match.'));
      for (const i of shown) {
        const g = this.x.guide(i);
        const own = s.side === 'sell' ? ` · you have ${fmt(this.x.balance(PRACTICE_ACCOUNT, i))}` : '';
        const b = el('button', 'gx-pick', `<img src="${itemIcon(i)}" alt=""><span class="gx-pick-name">${name(i)}</span><span class="gx-pick-price">${fmt(g.price)}${own}</span>`);
        b.addEventListener('click', () => {
          s.item = i;
          this.price = g.price;
          this.qty = s.side === 'sell' ? Math.min(this.x.balance(PRACTICE_ACCOUNT, i), 10) || 1 : 1;
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
    list.appendChild(el('div', 'ii-desc', 'Practice storage holds what you collect from offers. It is separate from your inventory and bank: practice stock can’t leave the practice market.'));
    const hold = this.x.holdings(PRACTICE_ACCOUNT).sort((a, b) => (a.asset === 'coins' ? -1 : b.asset === 'coins' ? 1 : 0));
    for (const h of hold) list.appendChild(el('div', 'gx-row gx-hold', `<img src="${itemIcon(h.asset === 'coins' ? 'coins' : h.asset)}" alt=""><span>${h.asset === 'coins' ? 'Practice coins' : name(h.asset)}</span><b>${fmt(h.qty)}</b>`));
    if (!hold.length) list.appendChild(el('div', 'bank-empty', 'Practice storage is empty.'));
    const reset = el('button', 'bank-btn', 'Reset practice market');
    reset.addEventListener('click', () => {
      if (!this.confirmTap('gx-reset', reset, 'Tap again: start over')) return;
      this.command({ type: 'exchangeResetPractice' });
      this.notice = { text: 'Practice market reset with fresh practice stock.', ok: true };
      this.render();
    });
    list.appendChild(reset);
    this.root.appendChild(list);
  }

  private renderHistory() {
    const list = el('div', 'gx-list gx-history');
    const mine = this.x.history({ account: PRACTICE_ACCOUNT }, 40);
    list.appendChild(el('div', 'gx-sub', 'Your practice trades'));
    if (!mine.length) list.appendChild(el('div', 'bank-empty', 'No practice trades yet.'));
    for (const t of mine) {
      const bought = t.buyer === PRACTICE_ACCOUNT;
      list.appendChild(el('div', 'gx-row', `<img src="${itemIcon(t.item)}" alt=""><span>${bought ? 'Bought' : 'Sold'} ${fmt(t.qty)} ${name(t.item).toLowerCase()} @ ${fmt(t.price)} ${bought ? 'from' : 'to'} ${traderName(bought ? t.seller : t.buyer)}</span>`));
    }
    list.appendChild(el('div', 'gx-sub', 'Recent market activity (simulated traders)'));
    for (const t of this.x.history({}, 25)) list.appendChild(el('div', 'gx-row dim', `<img src="${itemIcon(t.item)}" alt=""><span>${fmt(t.qty)} ${name(t.item).toLowerCase()} @ ${fmt(t.price)}</span>`));
    this.root.appendChild(list);
  }
}

let index: ItemId[] | null = null;
/** Every tradeable item id, by name (computed once). */
function tradeableItems(): ItemId[] {
  index ??= (Object.keys(ITEMS) as ItemId[]).filter((id) => tradeable(id)).sort((a, b) => name(a).localeCompare(name(b)));
  return index;
}
