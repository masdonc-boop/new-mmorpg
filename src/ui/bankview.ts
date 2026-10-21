import { itemDef, type ItemId } from '../data/items';
import { BANK_CATEGORIES, bankCategory, type BankCategory } from '../sim/bank';
import type { Command, GameWorld } from '../sim/world';
import { itemIcon } from './icons';

type Selection = { from: 'bank'; item: ItemId } | { from: 'inv'; slot: number } | null;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

function formatQty(n: number): string {
  if (n >= 10_000_000) return `${Math.floor(n / 1_000_000)}M`;
  if (n >= 100_000) return `${Math.floor(n / 1000)}K`;
  return String(n);
}

/**
 * The bank interface: bank grid (search + categories) above the player's inventory, with a shared
 * action bar for the selected item. Every button issues a simulation command; the view only redraws
 * from world state, so it can never show a transfer that did not happen.
 */
export class BankView {
  readonly root = el('div', 'bank');
  private search = el('input', 'bank-search');
  private chips = el('div', 'bank-chips');
  private count = el('div', 'bank-count');
  private grid = el('div', 'bank-grid');
  private gridWrap = el('div', 'bank-grid-wrap');
  private action = el('div', 'bank-action');
  private invHead = el('div', 'bank-inv-head');
  private invGrid = el('div', 'bank-inv-grid');
  private category: BankCategory = 'all';
  private sel: Selection = null;
  private qtyX = 10;
  /** Set while the player is touching or scrolling the bank grid, so live refreshes wait. */
  touching = false;
  lastScroll = 0;

  constructor(
    private world: GameWorld,
    private command: (c: Command) => void,
    private confirmTap: (key: string, btn: HTMLButtonElement, prompt: string) => boolean,
  ) {
    const top = el('div', 'bank-top');
    this.search.type = 'search';
    this.search.placeholder = 'Search bank';
    this.search.setAttribute('aria-label', 'Search bank');
    this.search.addEventListener('input', () => this.renderGrid());
    top.append(this.count, this.search);
    for (const c of BANK_CATEGORIES) {
      const b = el('button', 'bank-chip', c.label);
      b.dataset.cat = c.id;
      b.addEventListener('click', () => {
        this.category = c.id;
        this.renderChips();
        this.renderGrid();
      });
      this.chips.appendChild(b);
    }
    this.gridWrap.appendChild(this.grid);
    this.gridWrap.addEventListener('touchstart', () => (this.touching = true), { passive: true });
    const release = () => {
      this.touching = false;
      this.lastScroll = performance.now();
    };
    this.gridWrap.addEventListener('touchend', release, { passive: true });
    this.gridWrap.addEventListener('touchcancel', release, { passive: true });
    this.gridWrap.addEventListener('scroll', () => (this.lastScroll = performance.now()), { passive: true });
    const inv = el('div', 'bank-inv');
    inv.append(this.invHead, this.invGrid);
    // Action bar and inventory share a column: below the bank in portrait, beside it in landscape.
    const side = el('div', 'bank-side');
    side.append(this.action, inv);
    this.root.append(top, this.chips, this.gridWrap, side);
    this.refresh();
  }

  /** Redraw everything from the current world state (keeps search text, category and scroll). */
  refresh() {
    // Drop a selection that no longer exists (withdrew the last one, slot emptied).
    const p = this.world.player;
    if (this.sel?.from === 'bank' && p.bank.count(this.sel.item) <= 0) this.sel = null;
    if (this.sel?.from === 'inv' && !p.inventory.slots[this.sel.slot]) this.sel = null;
    this.renderChips();
    this.renderGrid();
    this.renderAction();
    this.renderInventory();
  }

  private renderChips() {
    this.chips.querySelectorAll<HTMLButtonElement>('.bank-chip').forEach((b) => b.classList.toggle('active', b.dataset.cat === this.category));
  }

  private renderGrid() {
    const bank = this.world.player.bank;
    const used = bank.usedSlots();
    this.count.innerHTML = `<b>${used}</b> / ${bank.capacity} slots${bank.isFull() ? ' <span class="bank-full">Bank full</span>' : ''}`;
    const q = this.search.value.trim().toLowerCase();
    const shown = bank.slots.filter((s) => {
      const d = itemDef(s.item);
      if (this.category !== 'all' && bankCategory(d) !== this.category) return false;
      return !q || d.name.toLowerCase().includes(q);
    });
    const scroll = this.gridWrap.scrollTop;
    this.grid.replaceChildren();
    if (!shown.length) {
      this.grid.appendChild(el('div', 'bank-empty', used === 0 ? 'Your bank is empty. Tap an item in your inventory below, then Deposit.' : 'No items match.'));
    }
    for (const s of shown) {
      const d = itemDef(s.item);
      const selected = this.sel?.from === 'bank' && this.sel.item === s.item;
      const cell = el('button', `inv-slot bank-slot${selected ? ' selected' : ''}`, `<img src="${itemIcon(s.item)}" alt="${d.name}"><span class="qty">${formatQty(s.qty)}</span>`);
      cell.title = `${d.name} × ${s.qty}`;
      cell.addEventListener('click', () => {
        this.sel = selected ? null : { from: 'bank', item: s.item };
        this.refresh();
      });
      this.grid.appendChild(cell);
    }
    this.gridWrap.scrollTop = scroll;
  }

  private renderInventory() {
    const p = this.world.player;
    const inv = p.inventory;
    this.invHead.replaceChildren();
    const title = el('div', 'bank-inv-title', `Inventory <span>${inv.usedSlots()} / ${inv.slots.length}</span>`);
    const all = el('button', 'bank-btn', 'Deposit inventory');
    all.disabled = inv.usedSlots() === 0;
    all.addEventListener('click', () => {
      if (!this.confirmTap('bank-deposit-all', all, 'Tap again: deposit all')) return;
      this.sel = null;
      this.command({ type: 'bankDepositAll' });
    });
    this.invHead.append(title, all);
    if (p.overflow.length) {
      const n = p.overflow.reduce((a, o) => a + o.qty, 0);
      const held = el('button', 'bank-btn primary', `Deposit ${n} held`);
      held.addEventListener('click', () => this.command({ type: 'bankDepositHeld' }));
      this.invHead.appendChild(held);
    }
    this.invGrid.replaceChildren();
    inv.slots.forEach((s, i) => {
      const selected = this.sel?.from === 'inv' && this.sel.slot === i;
      const cell = el('button', `inv-slot${selected ? ' selected' : ''}`);
      if (s) cell.innerHTML = `<img src="${itemIcon(s.item)}" alt="${itemDef(s.item).name}">${itemDef(s.item).stackable ? `<span class="qty">${formatQty(s.qty)}</span>` : ''}`;
      else cell.disabled = true;
      cell.addEventListener('click', () => {
        if (!s) return;
        this.sel = selected ? null : { from: 'inv', slot: i };
        this.refresh();
      });
      this.invGrid.appendChild(cell);
    });
  }

  private renderAction() {
    const p = this.world.player;
    this.action.replaceChildren();
    const sel = this.sel;
    if (!sel) {
      this.action.appendChild(el('div', 'bank-hint', 'Tap an item in the bank to withdraw, or in your inventory to deposit.'));
      return;
    }
    const withdraw = sel.from === 'bank';
    const item = withdraw ? sel.item : p.inventory.slots[sel.slot]!.item;
    const d = itemDef(item);
    const have = withdraw ? p.bank.count(item) : p.inventory.count(item);
    const room = withdraw ? p.inventory.capacityFor(item) : p.bank.roomFor(item);
    const info = withdraw
      ? `${formatQty(have)} in bank · ${room > 0 ? `room for ${Math.min(room, have) === have ? 'all' : room}` : '<span class="bank-full">inventory full</span>'}${d.stackable ? '' : ' · one per slot'}`
      : `${have} in inventory${room > 0 ? '' : ' · <span class="bank-full">bank full</span>'}`;
    const head = el('div', 'bank-sel', `<img src="${itemIcon(item)}" alt=""><div><div class="bank-sel-name">${d.name}</div><div class="bank-sel-info">${info}</div></div>`);
    const btns = el('div', 'bank-btns');
    const go = (qty: number) => {
      if (withdraw) this.command({ type: 'bankWithdraw', item, qty });
      else this.command({ type: 'bankDeposit', slot: sel.slot, qty });
    };
    const verb = withdraw ? 'Withdraw' : 'Deposit';
    const disabled = room <= 0;
    for (const [label, qty] of [['1', 1], ['5', 5], ['All', Infinity]] as const) {
      if (label === '5' && have < 5) continue;
      const b = el('button', `bank-btn${label === 'All' ? ' primary' : ''}`, label === 'All' ? `${verb} all` : `${verb} ${label}`);
      b.disabled = disabled;
      b.addEventListener('click', () => go(qty === Infinity ? have : qty));
      btns.appendChild(b);
    }
    // Quantity selection: − [n] + then a button for exactly that amount.
    if (have > 1) {
      const xrow = el('div', 'bank-x');
      const minus = el('button', 'bank-step', '−');
      const input = el('input', 'bank-qty');
      input.type = 'number';
      input.inputMode = 'numeric';
      input.min = '1';
      input.max = String(have);
      input.value = String(Math.min(this.qtyX, have));
      input.setAttribute('aria-label', 'Quantity');
      const plus = el('button', 'bank-step', '+');
      const xbtn = el('button', 'bank-btn');
      const clamp = (v: number) => Math.max(1, Math.min(have, Math.floor(v) || 1));
      const sync = () => {
        this.qtyX = clamp(Number(input.value));
        xbtn.textContent = `${verb} ${this.qtyX}`;
      };
      minus.addEventListener('click', () => {
        input.value = String(clamp(Number(input.value) - 1));
        sync();
      });
      plus.addEventListener('click', () => {
        input.value = String(clamp(Number(input.value) + 1));
        sync();
      });
      input.addEventListener('input', sync);
      input.addEventListener('change', () => {
        input.value = String(clamp(Number(input.value)));
        sync();
      });
      xbtn.disabled = disabled;
      xbtn.addEventListener('click', () => go(clamp(Number(input.value))));
      sync();
      xrow.append(minus, input, plus, xbtn);
      this.action.append(head, btns, xrow);
    } else {
      this.action.append(head, btns);
    }
  }
}
