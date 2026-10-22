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

describe('4B.4 loot tables', () => {
  const value = (id: keyof typeof ENEMIES) => ENEMIES[id].drops.reduce((a, d) => a + d.chance * ((d.min + d.max) / 2) * (d.item === 'coins' ? 1 : itemDef(d.item).value), 0);
  const regular = Object.values(ENEMIES).filter((e) => !e.boss).sort((a, b) => a.level - b.level);
  const bosses = Object.values(ENEMIES).filter((e) => e.boss);

  it('regular creatures are worth more the tougher they are (expected value per kill rises with level)', () => {
    for (let i = 1; i < regular.length; i++) {
      const [a, b] = [regular[i - 1], regular[i]];
      expect(value(b.id), `${b.id} (${b.level}) vs ${a.id} (${a.level})`).toBeGreaterThanOrEqual(value(a.id) * 0.9);
    }
  });

  it('every boss is worth several regular kills and has a signature drop no regular creature gives', () => {
    for (const b of bosses) {
      const peers = regular.filter((e) => Math.abs(e.level - b.level) <= 10);
      const best = Math.max(...peers.map((e) => value(e.id)));
      expect(value(b.id), b.id).toBeGreaterThan(best * 5);
      const common = new Set(regular.flatMap((e) => e.drops.map((d) => d.item)));
      expect(b.drops.some((d) => !common.has(d.item) && (itemDef(d.item).equip || itemDef(d.item).kind === 'trophy' || d.item === 'big_bones')), b.id).toBe(true);
    }
  });

  it('gear dropped by a creature belongs to its tier (no top-tier gear from the weakest creatures)', () => {
    for (const e of Object.values(ENEMIES)) for (const d of e.drops) {
      const req = itemDef(d.item).equip?.req;
      // Ammunition is dropped by the handful, like coins (only gear is capped).
      if (!req || itemDef(d.item).stackable) continue;
      const lvl = Math.max(...Object.values(req));
      expect(lvl, `${d.item} from ${e.id}`).toBeLessThanOrEqual(e.level + 12);
      if (!e.boss) expect(d.chance, `${d.item} from ${e.id}`).toBeLessThanOrEqual(0.2);
    }
  });
});

describe('4B.4 dungeon framework (ready for Phase 4C)', () => {
  it('each dungeon sits at its landmark, asks for its region’s quest, and pays out real items', async () => {
    const { DUNGEONS } = await import('../src/data/dungeons');
    const { generateWorld } = await import('../src/sim/worldmap');
    const map = generateWorld(1337);
    for (const d of Object.values(DUNGEONS)) {
      expect(d.status, d.id).toBe('open');
      expect(map.decor.some((x) => x.kind === d.landmark), d.id).toBe(true);
      for (const q of d.requirements.quests ?? []) expect(QUESTS[q], `${d.id} needs ${q}`).toBeTruthy();
      expect(d.recommended.combat).toBeGreaterThanOrEqual(d.requirements.combat ?? 0);
      expect(d.boss.level).toBeGreaterThan(d.recommended.combat);
      for (const r of [...d.rewards.guaranteed, ...d.rewards.table]) expect(itemDef(r.item), `${d.id}: ${r.item}`).toBeTruthy();
      for (const u of d.rewards.uniques) {
        // Planned, not yet in the game (they arrive with the dungeon), with ids that won't clash.
        expect(ITEMS[u.id as keyof typeof ITEMS], u.id).toBeUndefined();
        expect(u.chance).toBeLessThan(0.05);
        // A step above the best craftable gear of the same slot and style.
        // Weapons are compared with weapons of their style, styled armour with armour that helps that style.
        const helps = (i: (typeof ITEMS)[keyof typeof ITEMS]) => u.slot === 'weapon' ? i.equip?.style === u.style : !u.style || Object.entries(i.equip?.styleBonus ?? {}).some(([st, b]) => st === u.style && (b.accuracy ?? 0) > 0);
        const peers = Object.values(ITEMS).filter((i) => i.equip?.slot === u.slot && helps(i));
        const best = Math.max(0, ...peers.map((i) => (i.equip!.accuracy ?? 0) + (i.equip!.power ?? 0) + (i.equip!.armour ?? 0) + Object.values(i.equip!.styleBonus ?? {}).reduce((a, b) => a + (b.accuracy ?? 0) + (b.power ?? 0), 0)));
        const t = u.target;
        expect((t.accuracy ?? 0) + (t.power ?? 0) + (t.armour ?? 0), u.id).toBeGreaterThan(best);
      }
    }
  });
});
