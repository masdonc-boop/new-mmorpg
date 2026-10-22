import { describe, expect, it } from 'vitest';
import { GameWorld } from '../src/sim/world';
import { INVENTORY_SLOTS, Inventory } from '../src/sim/inventory';
import { Toolbelt, addToBelt, bestTool, removeFromBelt } from '../src/sim/toolbelt';
import { ITEMS, itemDef, type ItemId } from '../src/data/items';
import { RESOURCES, gatherChance } from '../src/data/resources';
import { RECIPES } from '../src/data/recipes';
import { TOOL_SLOTS } from '../src/data/tools';
import { isBlocked } from '../src/sim/worldmap';

const run = (w: GameWorld, s: number) => {
  for (let t = 0; t < s * 30; t++) w.tick();
};
const setRng = (w: GameWorld, v: number) => ((w as unknown as { rng: () => number }).rng = () => v);
const slotOf = (inv: Inventory, item: ItemId) => inv.slots.findIndex((s) => s?.item === item);
const SIDES = [[1.1, 0], [-1.1, 0], [0, 1.1], [0, -1.1]];
function workNode(w: GameWorld, type: string) {
  const node = w.nodes.find((n) => n.def.id === type && SIDES.some(([a, b]) => !isBlocked(w.map, n.x + a, n.z + b)))!;
  const [a, b] = SIDES.find(([x, z]) => !isBlocked(w.map, node.x + x, node.z + z))!;
  w.player.x = w.player.prevX = node.x + a;
  w.player.z = w.player.prevZ = node.z + b;
  w.issue({ type: 'interact', target: node.id });
  return node;
}
function openStation(w: GameWorld, kind: string) {
  const st = w.stations.find((s) => s.kind === kind)!;
  const [a, b] = SIDES.find(([x, z]) => !isBlocked(w.map, st.x + x, st.z + z))!;
  w.player.x = w.player.prevX = st.x + a;
  w.player.z = w.player.prevZ = st.z + b;
  w.issue({ type: 'interact', target: st.id });
  run(w, 0.3);
}
/** Every copy of every tool the character has, anywhere. */
const allTools = (w: GameWorld) => {
  const t: Record<string, number> = {};
  const p = w.player;
  for (const d of Object.values(ITEMS)) {
    if (!d.tool) continue;
    const n = p.inventory.count(d.id as ItemId) + p.toolbelt.count(d.id as ItemId) + p.bank.count(d.id as ItemId);
    if (n) t[d.id] = n;
  }
  return t;
};

describe('Toolbelt rules', () => {
  it('has a slot for every tool kind; future kinds are shown but locked', () => {
    for (const d of Object.values(ITEMS)) if (d.tool) expect(TOOL_SLOTS.find((s) => s.id === d.tool!.category)?.available).toBe(true);
    for (const id of ['saw', 'fishing_rod']) expect(TOOL_SLOTS.find((s) => s.id === id)?.available).toBe(false);
  });

  it('adds a tool from the bag (freeing its slot) and swaps a replaced tool into that same slot', () => {
    const belt = new Toolbelt();
    const inv = new Inventory();
    inv.add('bronze_pickaxe');
    inv.add('iron_pickaxe');
    expect(addToBelt(belt, inv, 0).ok).toBe(true);
    expect(belt.get('pickaxe')).toBe('bronze_pickaxe');
    expect(inv.slots[0]).toBeNull();
    const r = addToBelt(belt, inv, 1);
    expect(r).toMatchObject({ ok: true, replaced: 'bronze_pickaxe' });
    expect(belt.get('pickaxe')).toBe('iron_pickaxe');
    expect(inv.slots[1]).toEqual({ item: 'bronze_pickaxe', qty: 1 });
  });

  it('replacing works even with a full bag; removing needs a free slot', () => {
    const belt = new Toolbelt();
    const inv = new Inventory();
    inv.add('bronze_axe');
    addToBelt(belt, inv, 0);
    inv.add('iron_axe');
    inv.add('bread', INVENTORY_SLOTS - inv.usedSlots());
    expect(addToBelt(belt, inv, slotOf(inv, 'iron_axe')).ok).toBe(true);
    expect(inv.isFull()).toBe(true);
    expect(inv.count('bronze_axe')).toBe(1);
    expect(removeFromBelt(belt, inv, 'axe')).toMatchObject({ ok: false, reason: 'space' });
    expect(belt.get('axe')).toBe('iron_axe');
    inv.removeAt(slotOf(inv, 'bread'));
    expect(removeFromBelt(belt, inv, 'axe').ok).toBe(true);
    expect(belt.get('axe')).toBeNull();
    expect(inv.count('iron_axe')).toBe(1);
  });

  it('refuses things that are not tools', () => {
    const belt = new Toolbelt();
    const inv = new Inventory();
    inv.add('logs');
    expect(addToBelt(belt, inv, 0)).toMatchObject({ ok: false, reason: 'notTool' });
    expect(inv.count('logs')).toBe(1);
  });

  it('uses the single best usable tool from belt or bag: no stacking bonus, requirements respected', () => {
    const belt = new Toolbelt();
    const inv = new Inventory();
    inv.add('bronze_pickaxe');
    addToBelt(belt, inv, 0);
    inv.add('iron_pickaxe');
    inv.add('bronze_pickaxe');
    const lvl = () => 1;
    expect(bestTool('pickaxe', belt, inv, lvl).tool).toMatchObject({ item: 'iron_pickaxe', tier: 2, from: 'inventory' });
    // A tool whose requirement isn't met is skipped (and named for the message).
    const def = ITEMS.iron_pickaxe;
    const saved = def.tool!.req;
    def.tool!.req = { skill: 'mining', level: 6 };
    try {
      const r = bestTool('pickaxe', belt, inv, lvl);
      expect(r.tool?.item).toBe('bronze_pickaxe');
      inv.remove('bronze_pickaxe', 9);
      delete belt.slots.pickaxe;
      expect(bestTool('pickaxe', belt, inv, lvl)).toMatchObject({ tool: null, blocked: 'iron_pickaxe' });
    } finally {
      def.tool!.req = saved;
    }
    // Better tier → better chance, but owning more tools changes nothing.
    expect(gatherChance(RESOURCES.copper_rock, 1, 2)).toBeGreaterThan(gatherChance(RESOURCES.copper_rock, 1, 1));
  });

  it('restores from saves, keeping anything invalid as held items rather than losing it', () => {
    const r = Toolbelt.restore({ axe: 'bronze_axe', pickaxe: 'bronze_axe', hammer: 'nonsense', saw: 'knife' });
    expect(r.belt.get('axe')).toBe('bronze_axe');
    expect(r.belt.get('pickaxe')).toBeNull();
    expect(r.displaced.map((d) => d.item).sort()).toEqual(['bronze_axe', 'knife']);
  });
});

describe('Toolbelt in play', () => {
  it('belt tools work for woodcutting, mining, fishing, smithing and fletching with an otherwise empty bag', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory = new Inventory();
    setRng(w, 0.4);
    for (const type of ['tree', 'copper_rock', 'net_spot']) {
      workNode(w, type);
      run(w, 3);
      w.issue({ type: 'moveTo', x: p.x, z: p.z });
    }
    expect(p.inventory.count('logs')).toBeGreaterThan(0);
    expect(p.inventory.count('copper_ore')).toBeGreaterThan(0);
    expect(p.inventory.count('raw_shrimps')).toBeGreaterThan(0);
    p.inventory.add('bronze_bar', 1);
    openStation(w, 'anvil');
    w.issue({ type: 'craft', recipe: 'bronze_dagger', count: 1 });
    run(w, 3);
    expect(p.inventory.count('bronze_dagger')).toBe(1);
    w.issue({ type: 'craft', recipe: 'arrow_shafts', count: 1 });
    run(w, 2);
    expect(p.inventory.count('arrow_shafts')).toBe(15);
    // Tools never took a slot.
    expect(Object.values(ITEMS).filter((d) => d.tool).every((d) => p.inventory.count(d.id as ItemId) === 0)).toBe(true);
  });

  it('without the tool anywhere, the action is refused with a clear message', () => {
    const w = new GameWorld();
    const p = w.player;
    delete p.toolbelt.slots.axe;
    w.drainEvents();
    workNode(w, 'tree');
    expect(p.action).toBeNull();
    expect(w.drainEvents().some((e) => e.type === 'message' && e.text === 'You need an axe in your bag or toolbelt.')).toBe(true);
  });

  it('upgrade path: forge an iron axe and put it on the belt; the bronze one comes back to the bag', () => {
    const w = new GameWorld();
    const p = w.player;
    p.skills.addXp('smithing', 10_000);
    p.inventory.add('iron_bar', 1);
    openStation(w, 'anvil');
    w.issue({ type: 'craft', recipe: 'iron_axe', count: 1 });
    run(w, 3);
    expect(p.inventory.count('iron_axe')).toBe(1);
    w.issue({ type: 'beltAdd', slot: slotOf(p.inventory, 'iron_axe') });
    expect(p.toolbelt.get('axe')).toBe('iron_axe');
    expect(p.inventory.count('bronze_axe')).toBe(1);
    expect(w.toolFor('axe').tool?.tier).toBe(2);
    expect(RECIPES.iron_pickaxe.output.item).toBe('iron_pickaxe');
  });

  it('moves tools between bag, bank and belt without loss; persists through save/load', () => {
    const w = new GameWorld();
    const p = w.player;
    const banker = w.npcs.find((n) => n.def.id === 'banker')!;
    p.x = p.prevX = 51.5;
    p.z = p.prevZ = 60.5;
    w.issue({ type: 'interact', target: banker.id });
    run(w, 0.3);
    const start = allTools(w);
    w.issue({ type: 'beltRemove', category: 'hammer' });
    w.issue({ type: 'bankDeposit', slot: slotOf(p.inventory, 'hammer'), qty: 1 });
    expect(p.bank.count('hammer')).toBe(1);
    expect(allTools(w)).toEqual(start);
    w.issue({ type: 'bankWithdraw', item: 'hammer', qty: 1 });
    w.issue({ type: 'beltAdd', slot: slotOf(p.inventory, 'hammer') });
    expect(p.toolbelt.get('hammer')).toBe('hammer');
    expect(allTools(w)).toEqual(start);
    const w2 = new GameWorld({ save: JSON.parse(JSON.stringify(w.save())) });
    expect(w2.player.toolbelt.toJSON()).toEqual(p.toolbelt.toJSON());
    expect(allTools(w2)).toEqual(start);
  });

  it('beltAddAll fills empty belt slots only; random add/remove never duplicates or loses tools', () => {
    const w = new GameWorld();
    const p = w.player;
    for (const it of ['iron_axe', 'iron_pickaxe', 'knife', 'bronze_axe'] as ItemId[]) p.inventory.add(it);
    delete p.toolbelt.slots.knife;
    const start = allTools(w);
    w.issue({ type: 'beltAddAll' });
    expect(p.toolbelt.get('knife')).toBe('knife');
    expect(p.toolbelt.get('axe')).toBe('bronze_axe'); // occupied slots are not swapped by "add all"
    expect(allTools(w)).toEqual(start);
    const cats = ['axe', 'pickaxe', 'hammer', 'knife', 'small_net'] as const;
    for (let i = 0; i < 400; i++) {
      if (i % 3 === 0) w.issue({ type: 'beltRemove', category: cats[i % cats.length] });
      else {
        const s = p.inventory.slots.findIndex((x, k) => x && itemDef(x.item).tool && (k + i) % 2 === 0);
        if (s >= 0) w.issue({ type: 'beltAdd', slot: s });
      }
      if (i % 37 === 0) p.inventory.add('bread', 3);
      expect(allTools(w)).toEqual(start);
      expect(p.inventory.usedSlots()).toBeLessThanOrEqual(INVENTORY_SLOTS);
    }
  });
});
