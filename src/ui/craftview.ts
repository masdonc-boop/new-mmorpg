import { itemDef } from '../data/items';
import { RECIPES, STATION_INFO, failChance, plural, recipesFor, type RecipeDef, type StationKind } from '../data/recipes';
import { SKILL_INFO } from '../data/skills';
import type { Command, GameWorld } from '../sim/world';
import { itemIcon } from './icons';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

/**
 * Production interface for one station: recipe list (product, level, materials and what you have),
 * then quantity and a Make button for the selected recipe. All checks are repeated by the simulation
 * for every item made; this view only explains them.
 */
export class CraftView {
  readonly root = el('div', 'craft');
  private list = el('div', 'craft-list');
  private bar = el('div', 'craft-bar');
  private selected: string | null = null;
  private qtyX = 5;

  constructor(
    private world: GameWorld,
    readonly station: StationKind,
    private command: (c: Command) => void,
    /** Called when production starts (the panel closes so the player can watch). */
    private started: () => void,
  ) {
    const skill = STATION_INFO[station].skill;
    const lvl = world.player.skills.level(skill);
    this.root.append(el('div', 'craft-head', `<span>${SKILL_INFO[skill].glyph} ${SKILL_INFO[skill].name} level <b>${lvl}</b></span><span class="craft-sub">${station === 'fletching' ? 'Carve logs anywhere' : station === 'crafting' ? 'Sew leather and cut gems anywhere' : `At the ${STATION_INFO[station].name.toLowerCase()}`}</span>`), this.list, this.bar);
    // Preselect the best recipe the player can make right now.
    const recipes = recipesFor(station);
    this.selected = [...recipes].reverse().find((r) => !world.craftBlocker(r.id))?.id ?? recipes[0]?.id ?? null;
    this.refresh();
  }

  refresh() {
    const recipes = recipesFor(this.station);
    const scroll = this.list.scrollTop;
    this.list.replaceChildren();
    for (const r of recipes) this.list.appendChild(this.card(r));
    this.list.scrollTop = scroll;
    this.renderBar();
  }

  private card(r: RecipeDef): HTMLElement {
    const p = this.world.player;
    const out = itemDef(r.output.item);
    const lvl = p.skills.level(r.skill);
    const levelOk = lvl >= r.level;
    const mats = r.inputs
      .map((i) => {
        const have = p.inventory.count(i.item);
        return `<span class="${have >= i.qty ? 'ok' : 'miss'}"><img src="${itemIcon(i.item)}" alt="">${i.qty} ${itemDef(i.item).name}<small> (${have})</small></span>`;
      })
      .join('');
    const card = el('button', `craft-card${this.selected === r.id ? ' selected' : ''}${levelOk ? '' : ' locked'}`);
    const burn = failChance(r, lvl);
    card.innerHTML = `<img class="craft-icon" src="${itemIcon(r.output.item)}" alt="">
      <div class="craft-main"><div class="craft-name">${r.output.qty > 1 ? `${r.output.qty} × ` : ''}${out.name}</div>
      <div class="craft-req ${levelOk ? 'ok' : 'miss'}">Level ${r.level}${levelOk ? '' : ' required'} · ${r.xp} xp${burn > 0 ? ` · ${Math.round(burn * 100)}% burn` : ''}</div>
      <div class="craft-mats">${mats}</div></div>`;
    card.addEventListener('click', () => {
      this.selected = r.id;
      this.refresh();
    });
    return card;
  }

  private renderBar() {
    this.bar.replaceChildren();
    const r = this.selected ? RECIPES[this.selected] : null;
    if (!r) return;
    const blocker = this.world.craftBlocker(r.id);
    const most = this.world.craftableCount(r.id);
    const verb = STATION_INFO[this.station].verb;
    const name = itemDef(r.output.item).name;
    this.bar.appendChild(el('div', `craft-status${blocker ? ' miss' : ''}`, blocker ?? `You can make ${most} ${plural(name.toLowerCase(), most)} with what you carry.`));
    const row = el('div', 'craft-btns');
    const make = (n: number) => {
      this.command({ type: 'craft', recipe: r.id, count: n });
      this.started();
    };
    for (const n of [1, 5]) {
      if (n > 1 && most < n) continue;
      const b = el('button', 'bank-btn', `${verb} ${n}`);
      b.disabled = !!blocker;
      b.addEventListener('click', () => make(n));
      row.appendChild(b);
    }
    const all = el('button', 'bank-btn primary', `${verb} all (${most})`);
    all.disabled = !!blocker;
    all.addEventListener('click', () => make(most));
    row.appendChild(all);
    this.bar.appendChild(row);
    if (most > 2 && !blocker) {
      const x = el('div', 'bank-x');
      const minus = el('button', 'bank-step', '−');
      const input = el('input', 'bank-qty');
      input.type = 'number';
      input.inputMode = 'numeric';
      input.min = '1';
      input.max = String(most);
      input.setAttribute('aria-label', 'Quantity');
      const plus = el('button', 'bank-step', '+');
      const go = el('button', 'bank-btn');
      const clamp = (v: number) => Math.max(1, Math.min(most, Math.floor(v) || 1));
      input.value = String(clamp(this.qtyX));
      const sync = () => {
        this.qtyX = clamp(Number(input.value));
        go.textContent = `${verb} ${this.qtyX}`;
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
      go.addEventListener('click', () => make(clamp(Number(input.value))));
      sync();
      x.append(minus, input, plus, go);
      this.bar.appendChild(x);
    }
  }
}
