import { itemDef } from '../data/items';
import type { ItemStack } from '../sim/inventory';
import type { TradeView as Trade } from '../sim/trade';
import type { Command, GameWorld } from '../sim/world';
import { itemIcon } from './icons';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** What a list of stacks is worth at shop value (a rough guide against lopsided trades). */
const worth = (list: ItemStack[]) => list.reduce((n, s) => n + (s.item === 'coins' ? 1 : itemDef(s.item).value) * s.qty, 0);

/**
 * The trade window (docs/MULTIPLAYER.md 3A.6). First screen: tap bag items to offer them, tap an
 * offered item to take it back, then Accept. Final screen: both offers again, frozen, to Confirm.
 * The simulation decides everything; this only shows the trade and sends intents.
 */
export class TradeWindow {
  readonly root = el('div', 'trade');
  private selected: number | null = null;

  constructor(
    private world: GameWorld,
    public trade: Trade,
    private command: (c: Command) => void,
  ) {
    this.refresh();
  }

  update(trade: Trade) {
    this.trade = trade;
    this.refresh();
  }

  private offerList(title: string, list: ItemStack[], mine: boolean) {
    const box = el('div', `trade-offer${mine ? ' mine' : ''}`);
    box.appendChild(el('div', 'trade-offer-title', `${title}<span class="trade-worth">${list.length ? `about ${worth(list).toLocaleString()} coins` : ''}</span>`));
    if (!list.length) box.appendChild(el('div', 'trade-empty', mine ? 'Tap items in your bag below to offer them.' : 'Nothing offered yet.'));
    for (const s of list) {
      const d = itemDef(s.item);
      const row = el(mine && this.trade.stage === 'offer' ? 'button' : 'div', 'trade-item', `<img src="${itemIcon(s.item)}" alt=""><span class="trade-name">${d.name}</span><span class="trade-qty">${s.qty > 1 || d.stackable ? `× ${s.qty.toLocaleString()}` : ''}</span>`);
      if (mine && this.trade.stage === 'offer') {
        row.title = 'Take back';
        row.addEventListener('click', () => this.command({ type: 'tradeRemove', item: s.item, qty: s.qty }));
      }
      box.appendChild(row);
    }
    return box;
  }

  refresh() {
    const t = this.trade;
    const p = this.world.player;
    const them = escape(t.name);
    this.root.replaceChildren();
    const final = t.stage === 'confirm';
    this.root.appendChild(
      el('div', `trade-stage${final ? ' final' : ''}`, final ? `<b>Final check.</b> This is exactly what changes hands. Confirm only if it is right.` : `Trading with <b>${them}</b>. Any change to either offer clears both acceptances.`),
    );
    const offers = el('div', 'trade-offers');
    offers.append(this.offerList('You give', t.mine, true), this.offerList(`${them} gives`, t.theirs, false));
    this.root.appendChild(offers);

    const state = t.iAccepted && t.theyAccepted ? '' : t.iAccepted ? `Waiting for ${them}…` : t.theyAccepted ? `${them} has ${final ? 'confirmed' : 'accepted'}.` : '';
    this.root.appendChild(el('div', `trade-state${t.theyAccepted ? ' ready' : ''}`, state));
    const btns = el('div', 'trade-btns');
    const yes = el('button', 'bank-btn primary', final ? 'Confirm trade' : 'Accept');
    yes.disabled = t.iAccepted || (!t.mine.length && !t.theirs.length);
    yes.addEventListener('click', () => this.command({ type: 'tradeAccept' }));
    const no = el('button', 'bank-btn danger', 'Decline');
    no.addEventListener('click', () => this.command({ type: 'tradeDecline' }));
    btns.append(yes, no);
    this.root.appendChild(btns);
    if (final) return;

    // The bag: what is left to offer (offered amounts are taken off).
    const left = (item: string) => p.inventory.count(item as never) - t.mine.filter((s) => s.item === item).reduce((n, s) => n + s.qty, 0);
    const sel = this.selected !== null ? p.inventory.slots[this.selected] : null;
    if (!sel || left(sel.item) <= 0) this.selected = null;
    const bar = el('div', 'bank-action');
    if (this.selected !== null && sel) {
      const n = left(sel.item);
      bar.appendChild(el('div', 'bank-sel', `<img src="${itemIcon(sel.item)}" alt=""><div><div class="bank-sel-name">${itemDef(sel.item).name}</div><div class="bank-sel-info">You have ${n.toLocaleString()} to offer</div></div>`));
      const b = el('div', 'bank-btns');
      const amounts: [string, number][] = n === 1 ? [['Offer', 1]] : [['Offer 1', 1], ...(n > 10 ? ([['Offer 10', 10]] as [string, number][]) : []), ['Offer all', n]];
      for (const [label, qty] of amounts) {
        const btn = el('button', `bank-btn${qty === n ? ' primary' : ''}`, label);
        btn.addEventListener('click', () => {
          this.command({ type: 'tradeOffer', slot: this.selected!, qty });
          this.selected = null;
        });
        b.appendChild(btn);
      }
      bar.appendChild(b);
    } else bar.appendChild(el('div', 'bank-hint', `Your bag · ${t.theirFreeSlots} free slot${t.theirFreeSlots === 1 ? '' : 's'} in ${them}’s bag`));
    const grid = el('div', 'bank-inv-grid');
    p.inventory.slots.forEach((s, i) => {
      const cell = el('button', `inv-slot${this.selected === i ? ' selected' : ''}`);
      if (s && left(s.item) > 0) {
        cell.innerHTML = `<img src="${itemIcon(s.item)}" alt="${itemDef(s.item).name}">${itemDef(s.item).stackable ? `<span class="qty">${Math.min(s.qty, left(s.item))}</span>` : ''}`;
        cell.addEventListener('click', () => {
          this.selected = this.selected === i ? null : i;
          this.refresh();
        });
      } else cell.disabled = true;
      grid.appendChild(cell);
    });
    this.root.append(bar, grid);
  }
}
