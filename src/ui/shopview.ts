import { itemDef } from '../data/items';
import { SHOPS, sellPrice } from '../data/shops';
import type { Command, GameWorld } from '../sim/world';
import { itemIcon } from './icons';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

/** Shop interface: Buy (the stall's stock) and Sell (your inventory). The simulation does the maths. */
export class ShopView {
  readonly root = el('div', 'shop');
  private tab: 'buy' | 'sell' = 'buy';
  private sellSlot: number | null = null;

  constructor(
    private world: GameWorld,
    readonly shopId: string,
    private command: (c: Command) => void,
  ) {
    this.refresh();
  }

  refresh() {
    const p = this.world.player;
    const shop = SHOPS[this.shopId];
    this.root.replaceChildren();
    const head = el('div', 'shop-head', `<span class="shop-coins"><img src="${itemIcon('coins')}" alt="">${p.inventory.count('coins')} coins</span><span>${p.inventory.freeSlots()} free slots</span>`);
    const tabs = el('div', 'shop-tabs');
    for (const t of ['buy', 'sell'] as const) {
      const b = el('button', `bank-chip${this.tab === t ? ' active' : ''}`, t === 'buy' ? 'Buy' : 'Sell');
      b.addEventListener('click', () => {
        this.tab = t;
        this.refresh();
      });
      tabs.appendChild(b);
    }
    this.root.append(head, tabs);
    if (this.tab === 'buy') {
      const list = el('div', 'shop-list');
      for (const s of shop.stock) {
        const d = itemDef(s.item);
        const have = p.inventory.count(s.item);
        const row = el('div', 'shop-row', `<img src="${itemIcon(s.item)}" alt=""><div class="shop-main"><div class="craft-name">${d.name}</div><div class="shop-sub">${s.price} coins each${have ? ` · you have ${have}` : ''}${d.kind === 'tool' ? ' · tool' : ''}</div></div>`);
        const btns = el('div', 'shop-btns');
        for (const n of d.stackable ? [1, 10, 50] : [1, 5]) {
          const b = el('button', 'bank-btn', `Buy ${n}`);
          b.disabled = p.inventory.count('coins') < s.price;
          b.addEventListener('click', () => this.command({ type: 'shopBuy', item: s.item, qty: n }));
          btns.appendChild(b);
        }
        row.appendChild(btns);
        list.appendChild(row);
      }
      this.root.appendChild(list);
    } else {
      const sel = this.sellSlot !== null ? p.inventory.slots[this.sellSlot] : null;
      if (!sel) this.sellSlot = null;
      const grid = el('div', 'bank-inv-grid');
      p.inventory.slots.forEach((s, i) => {
        const cell = el('button', `inv-slot${this.sellSlot === i ? ' selected' : ''}`);
        if (s) cell.innerHTML = `<img src="${itemIcon(s.item)}" alt="${itemDef(s.item).name}">${itemDef(s.item).stackable ? `<span class="qty">${s.qty}</span>` : ''}`;
        else cell.disabled = true;
        cell.addEventListener('click', () => {
          this.sellSlot = this.sellSlot === i ? null : i;
          this.refresh();
        });
        grid.appendChild(cell);
      });
      const bar = el('div', 'bank-action');
      if (sel) {
        const price = sellPrice(sel.item);
        const have = p.inventory.count(sel.item);
        bar.appendChild(el('div', 'bank-sel', `<img src="${itemIcon(sel.item)}" alt=""><div><div class="bank-sel-name">${itemDef(sel.item).name}</div><div class="bank-sel-info">${price > 0 ? `Tilly pays ${price} coins each · you have ${have}` : "Tilly won't buy this"}</div></div>`));
        const btns = el('div', 'bank-btns');
        for (const [label, n] of [['Sell 1', 1], ['Sell 5', 5], ['Sell all', have]] as const) {
          if (label === 'Sell 5' && have < 5) continue;
          const b = el('button', `bank-btn${label === 'Sell all' ? ' primary' : ''}`, label);
          b.disabled = price <= 0;
          b.addEventListener('click', () => this.command({ type: 'shopSell', slot: this.sellSlot!, qty: n }));
          btns.appendChild(b);
        }
        bar.appendChild(btns);
      } else bar.appendChild(el('div', 'bank-hint', 'Tap an item to see what Tilly will pay for it.'));
      this.root.append(bar, grid);
    }
  }
}
