import { describe, expect, it } from 'vitest';
import { ITEMS, itemDef, type ItemId } from '../src/data/items';
import { RECIPES } from '../src/data/recipes';
import { SHOPS, sellPrice } from '../src/data/shops';
import { SERVICES } from '../src/data/tanning';
import { ENEMIES } from '../src/data/enemies';
import { QUESTS } from '../src/data/quests';
import { RESOURCES } from '../src/data/resources';

/** The cheapest any shop sells an item for (Infinity if none does). */
const buy = (item: ItemId) => Math.min(...Object.values(SHOPS).flatMap((s) => s.stock.filter((x) => x.item === item).map((x) => x.price)), Infinity);

describe('4B.3 economy: no money from nothing', () => {
  it('nothing a shop sells can be sold back at a profit', () => {
    for (const s of Object.values(SHOPS)) for (const x of s.stock) expect(sellPrice(x.item), `${x.item} at ${s.name}`).toBeLessThanOrEqual(x.price);
  });

  it('no recipe or service turns shop-bought inputs into more coins than they cost', () => {
    for (const r of Object.values(RECIPES)) {
      const cost = r.inputs.reduce((a, i) => a + buy(i.item) * i.qty, 0);
      if (!Number.isFinite(cost)) continue;
      expect(sellPrice(r.output.item) * r.output.qty, r.id).toBeLessThanOrEqual(cost);
    }
    for (const sv of Object.values(SERVICES)) for (const c of sv.list) {
      const cost = buy(c.from) + c.cost;
      if (Number.isFinite(cost)) expect(sellPrice(c.to), c.to).toBeLessThanOrEqual(cost);
    }
  });

  it('every wearable item and tool can be obtained (made, bought, dropped or earned)', () => {
    const made = new Set(Object.values(RECIPES).map((r) => r.output.item));
    const sold = new Set(Object.values(SHOPS).flatMap((s) => s.stock.map((x) => x.item)));
    const dropped = new Set(Object.values(ENEMIES).flatMap((e) => e.drops.map((d) => d.item)));
    const rewards = new Set(Object.values(QUESTS).flatMap((q) => q.rewards.items.map((i) => i.item)));
    for (const d of Object.values(ITEMS)) {
      if (!d.equip && !d.tool) continue;
      const id = d.id as ItemId;
      expect(made.has(id) || sold.has(id) || dropped.has(id) || rewards.has(id), id).toBe(true);
    }
  });

  it('every new material has a use (an input to a recipe or a service, or a quest)', () => {
    const used = new Set<string>([...Object.values(RECIPES).flatMap((r) => r.inputs.map((i) => i.item)), ...Object.values(SERVICES).flatMap((s) => s.list.map((c) => c.from))]);
    for (const q of Object.values(QUESTS)) for (const st of q.stages) if (st.objective.type === 'collect') used.add(st.objective.item);
    for (const id of ['rowan_logs', 'boar_hide', 'boar_leather', 'ridge_pelt', 'ridgehide', 'linen', 'mire_oil', 'marsh_pearl', 'silver_bar', 'willow_logs'] as ItemId[]) expect(used.has(id), id).toBe(true);
    for (const r of Object.values(RESOURCES)) expect(itemDef(r.item), r.id).toBeTruthy();
  });
});
