import { describe, expect, it } from 'vitest';
import { GameWorld } from '../src/sim/world';
import { INVENTORY_SLOTS, type Inventory } from '../src/sim/inventory';
import { RESOURCES } from '../src/data/resources';
import { RECIPES, isAnywhere } from '../src/data/recipes';
import { SHOPS, sellPrice } from '../src/data/shops';
import { SKILL_IDS, SKILL_INFO, xpForLevel } from '../src/data/skills';
import { itemDef, type ItemId } from '../src/data/items';
import { isBlocked } from '../src/sim/worldmap';
import { findPath } from '../src/sim/pathfinding';

const run = (w: GameWorld, s: number) => {
  for (let t = 0; t < s * 30; t++) w.tick();
};
const setRng = (w: GameWorld, v: number) => ((w as unknown as { rng: () => number }).rng = () => v);
const stand = (w: GameWorld, x: number, z: number) => {
  w.player.x = w.player.prevX = x;
  w.player.z = w.player.prevZ = z;
};
const slotOf = (inv: Inventory, item: ItemId) => inv.slots.findIndex((s) => s?.item === item);
/** Copies of an item the player holds in the bag or on the toolbelt. */
const owned = (w: GameWorld, item: ItemId) => w.player.inventory.count(item) + w.player.toolbelt.count(item);
/** Take a tool away entirely (belt or bag). */
const lose = (w: GameWorld, item: ItemId) => {
  const p = w.player;
  for (const [c, it] of Object.entries(p.toolbelt.slots)) if (it === item) delete p.toolbelt.slots[c as keyof typeof p.toolbelt.slots];
  p.inventory.remove(item, 99);
};
const SIDES = [[1.1, 0], [-1.1, 0], [0, 1.1], [0, -1.1]];
/** Stand beside a node of a type and start working it. */
function workNode(w: GameWorld, type: string) {
  const node = w.nodes.find((n) => n.def.id === type && SIDES.some(([a, b]) => !isBlocked(w.map, n.x + a, n.z + b)))!;
  const [a, b] = SIDES.find(([x, z]) => !isBlocked(w.map, node.x + x, node.z + z))!;
  stand(w, node.x + a, node.z + b);
  w.issue({ type: 'interact', target: node.id });
  return node;
}
function openStation(w: GameWorld, kind: string) {
  const st = w.stations.find((s) => s.kind === kind)!;
  const [a, b] = SIDES.find(([x, z]) => !isBlocked(w.map, st.x + x, st.z + z))!;
  stand(w, st.x + a, st.z + b);
  w.issue({ type: 'interact', target: st.id });
  run(w, 0.3);
  return st;
}
function openShop(w: GameWorld) {
  const tilly = w.npcs.find((n) => n.def.id === 'merchant')!;
  stand(w, tilly.x + 1.2, tilly.z);
  w.issue({ type: 'interact', target: tilly.id });
  run(w, 0.3);
}

describe('Skill audit: every listed skill has a complete, reachable loop', () => {
  const w = new GameWorld();
  const starter = new Set(w.player.inventory.slots.filter(Boolean).map((s) => s!.item));
  const sold = new Set(SHOPS.tilly.stock.map((s) => s.item));

  it('every skill is marked available and explains how to train it', () => {
    for (const id of SKILL_IDS) {
      expect(SKILL_INFO[id].available).toBe(true);
      expect(SKILL_INFO[id].howTo.length).toBeGreaterThan(20);
    }
  });

  it('every tool category a skill needs is on the starter toolbelt and sold by Tilly', () => {
    const cats = new Set([...Object.values(RESOURCES).flatMap((r) => (r.tool ? [r.tool] : [])), ...Object.values(RECIPES).flatMap((r) => (r.tool ? [r.tool] : []))]);
    for (const c of cats) {
      expect(w.player.toolbelt.get(c), `starter belt has a ${c}`).toBeTruthy();
      expect([...sold].some((it) => itemDef(it).tool?.category === c), `Tilly sells a ${c}`).toBe(true);
    }
    expect(sold.has('bowstring')).toBe(true);
    expect(starter.size).toBeGreaterThan(0);
  });

  it('every resource type and every workstation is placed and reachable on foot from the village', () => {
    const { spawn } = w.map;
    for (const type of Object.keys(RESOURCES)) {
      const node = w.nodes.find((n) => n.def.id === type);
      expect(node, type).toBeTruthy();
      const ok = SIDES.some(([a, b]) => !isBlocked(w.map, node!.x + a, node!.z + b) && !!findPath(w.map, spawn.x, spawn.z, node!.x + a, node!.z + b, 200_000));
      expect(ok, `${type} reachable`).toBe(true);
    }
    for (const kind of ['furnace', 'anvil', 'range', 'fire', 'spinning_wheel']) {
      const st = w.stations.find((s) => s.kind === kind);
      expect(st, kind).toBeTruthy();
      expect(SIDES.some(([a, b]) => !isBlocked(w.map, st!.x + a, st!.z + b) && !!findPath(w.map, spawn.x, spawn.z, st!.x + a, st!.z + b, 200_000)), `${kind} reachable`).toBe(true);
    }
  });

  it('every recipe can be made at a placed station (or needs none)', () => {
    for (const r of Object.values(RECIPES)) {
      if (isAnywhere(r.station)) continue;
      expect(w.stations.some((s) => s.kind === r.station), r.id).toBe(true);
    }
  });
});

describe('Tools', () => {
  it('new characters start with axe, pickaxe, hammer, knife and hand net on the toolbelt', () => {
    const p = new GameWorld().player;
    for (const t of ['bronze_axe', 'bronze_pickaxe', 'hammer', 'knife', 'small_fishing_net'] as ItemId[]) {
      expect(p.toolbelt.count(t)).toBe(1);
      expect(p.inventory.count(t)).toBe(0);
    }
    expect(p.inventory.usedSlots()).toBeLessThanOrEqual(6);
  });

  it('older saves receive the new tools exactly once, skipping ones already banked', () => {
    const w = new GameWorld();
    const save = w.save();
    // A save from before the production tools and the toolbelt: only axe and pickaxe, in the bag.
    delete (save as { grants?: unknown }).grants;
    delete (save as { toolbelt?: unknown }).toolbelt;
    save.inventory = [{ item: 'bronze_axe', qty: 1 }, { item: 'bronze_pickaxe', qty: 1 }, ...save.inventory.slice(2)];
    save.bank = [{ item: 'knife', qty: 1 }];
    const w2 = new GameWorld({ save: JSON.parse(JSON.stringify(save)) });
    expect(owned(w2, 'hammer')).toBe(1);
    expect(owned(w2, 'small_fishing_net')).toBe(1);
    expect(owned(w2, 'knife')).toBe(0);
    expect(w2.player.bank.count('knife')).toBe(1);
    // …and the new toolbelt takes the bag tools, freeing their slots.
    expect(w2.player.toolbelt.get('axe')).toBe('bronze_axe');
    expect(w2.player.toolbelt.get('hammer')).toBe('hammer');
    expect(w2.player.inventory.count('bronze_axe') + w2.player.inventory.count('hammer')).toBe(0);
    const w3 = new GameWorld({ save: JSON.parse(JSON.stringify(w2.save())) });
    expect(owned(w3, 'hammer')).toBe(1);
  });

  it('a full bag sends granted tools to held items instead of losing them', () => {
    const w = new GameWorld();
    const save = w.save();
    save.inventory = Array.from({ length: INVENTORY_SLOTS }, () => ({ item: 'bread' as ItemId, qty: 1 }));
    delete (save as { grants?: unknown }).grants;
    delete (save as { toolbelt?: unknown }).toolbelt;
    const w2 = new GameWorld({ save: JSON.parse(JSON.stringify(save)) });
    expect(w2.player.overflow.map((o) => o.item).sort()).toEqual(['hammer', 'knife', 'small_fishing_net']);
  });

  it('forging needs a hammer (belt or bag); it is not used up, and banking it blocks forging', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('bronze_bar', 3);
    openStation(w, 'anvil');
    w.issue({ type: 'craft', recipe: 'bronze_dagger', count: 1 });
    run(w, 3);
    expect(p.inventory.count('bronze_dagger')).toBe(1);
    expect(owned(w, 'hammer')).toBe(1);
    // Take the hammer off the belt and bank it: the anvil refuses.
    w.issue({ type: 'beltRemove', category: 'hammer' });
    expect(p.inventory.count('hammer')).toBe(1);
    const banker = w.npcs.find((n) => n.def.id === 'banker')!;
    stand(w, 51.5, 60.5);
    w.issue({ type: 'interact', target: banker.id });
    run(w, 0.3);
    w.issue({ type: 'bankDeposit', slot: slotOf(p.inventory, 'hammer'), qty: 1 });
    expect(p.bank.count('hammer')).toBe(1);
    openStation(w, 'anvil');
    w.drainEvents();
    w.issue({ type: 'craft', recipe: 'bronze_dagger', count: 1 });
    run(w, 3);
    expect(p.inventory.count('bronze_dagger')).toBe(1);
    expect(p.inventory.count('bronze_bar')).toBe(2);
    expect(w.drainEvents().some((e) => e.type === 'message' && e.text.includes('hammer'))).toBe(true);
    expect(w.craftBlocker('bronze_dagger')).toContain('hammer');
  });

  it('fletching from logs needs a knife; stringing a bow needs a bowstring', () => {
    const w = new GameWorld();
    const p = w.player;
    lose(w, 'knife');
    p.inventory.add('logs', 2);
    w.issue({ type: 'craft', recipe: 'arrow_shafts', count: 1 });
    run(w, 2);
    expect(p.inventory.count('arrow_shafts')).toBe(0);
    expect(p.inventory.count('logs')).toBe(2);
    p.inventory.add('knife');
    w.issue({ type: 'craft', recipe: 'arrow_shafts', count: 1 });
    run(w, 2);
    expect(p.inventory.count('arrow_shafts')).toBe(12);
    p.skills.addXp('fletching', xpForLevel(5));
    w.issue({ type: 'craft', recipe: 'shortbow_u', count: 1 });
    run(w, 2);
    expect(p.inventory.count('shortbow_u')).toBe(1);
    w.issue({ type: 'craft', recipe: 'shortbow', count: 1 });
    run(w, 2);
    expect(p.inventory.count('shortbow')).toBe(0); // no bowstring
  });
});

describe('Complete loops', () => {
  it('mine → smelt → forge → wield', () => {
    const w = new GameWorld();
    const p = w.player;
    setRng(w, 0.52); // swings succeed, rocks don't deplete, no gems
    workNode(w, 'copper_rock');
    run(w, 1.8 * 2 + 0.6);
    workNode(w, 'tin_rock');
    run(w, 1.8 * 2 + 0.6);
    w.issue({ type: 'moveTo', x: p.x, z: p.z });
    expect(p.inventory.count('copper_ore')).toBeGreaterThanOrEqual(2);
    expect(p.inventory.count('tin_ore')).toBeGreaterThanOrEqual(2);
    openStation(w, 'furnace');
    w.issue({ type: 'craft', recipe: 'bronze_bar', count: 2 });
    run(w, 5);
    expect(p.inventory.count('bronze_bar')).toBe(2);
    openStation(w, 'anvil');
    w.issue({ type: 'craft', recipe: 'bronze_dagger', count: 1 });
    run(w, 3);
    w.issue({ type: 'equip', slot: slotOf(p.inventory, 'bronze_dagger') });
    expect(p.equipment.get('weapon')).toBe('bronze_dagger');
    expect(p.skills.xp.mining).toBeGreaterThan(0);
    expect(p.skills.xp.smithing).toBe(2 * RECIPES.bronze_bar.xp + RECIPES.bronze_dagger.xp);
  });

  it('chop → fletch (knife) → buy a bowstring → string → wield the bow', () => {
    const w = new GameWorld();
    const p = w.player;
    setRng(w, 0.52);
    workNode(w, 'tree');
    run(w, 1.8 * 3 + 0.6);
    w.issue({ type: 'moveTo', x: p.x, z: p.z });
    expect(p.inventory.count('logs')).toBeGreaterThanOrEqual(2);
    p.skills.addXp('fletching', xpForLevel(5));
    w.issue({ type: 'openFletching' });
    w.issue({ type: 'craft', recipe: 'shortbow_u', count: 1 });
    run(w, 2);
    openShop(w);
    w.issue({ type: 'shopBuy', item: 'bowstring', qty: 1 });
    expect(p.inventory.count('bowstring')).toBe(1);
    w.issue({ type: 'craft', recipe: 'shortbow', count: 1 });
    run(w, 2);
    expect(p.inventory.count('shortbow')).toBe(1);
    w.issue({ type: 'equip', slot: slotOf(p.inventory, 'shortbow') });
    expect(p.equipment.get('weapon')).toBe('shortbow');
    expect(p.style).toBe('ranged');
  });

  it('fish (net) → cook at the riverside campfire → eat', () => {
    const w = new GameWorld();
    const p = w.player;
    setRng(w, 0.4); // catches succeed (chance 0.5) and cooking doesn't burn (chance 0.35)
    const spot = workNode(w, 'net_spot');
    run(w, 2.4 * 3 + 0.6);
    w.issue({ type: 'moveTo', x: p.x, z: p.z });
    expect(p.inventory.count('raw_shrimps')).toBeGreaterThanOrEqual(3);
    expect(p.skills.xp.fishing).toBe(p.inventory.count('raw_shrimps') * RESOURCES.net_spot.xp);
    expect(spot.depleted).toBe(false);
    expect(owned(w, 'small_fishing_net')).toBe(1);
    openStation(w, 'fire');
    w.issue({ type: 'craft', recipe: 'shrimps', count: 2 });
    run(w, 4.5);
    expect(p.inventory.count('shrimps')).toBe(2);
    expect(p.skills.xp.cooking).toBe(2 * RECIPES.shrimps.xp);
    p.hp = 50;
    w.issue({ type: 'useItem', slot: slotOf(p.inventory, 'shrimps') });
    expect(p.hp).toBe(50 + itemDef('shrimps').heal!);
  });

  it('fishing needs a net, and mudskipper eels only appear from level 12', () => {
    const w = new GameWorld();
    const p = w.player;
    setRng(w, 0.01); // every roll succeeds, including the eel roll if allowed
    workNode(w, 'net_spot');
    run(w, 3);
    expect(p.inventory.count('raw_anchovies')).toBe(0);
    p.skills.addXp('fishing', xpForLevel(12));
    workNode(w, 'net_spot');
    run(w, 3);
    expect(p.inventory.count('raw_anchovies')).toBeGreaterThan(0);
    w.issue({ type: 'moveTo', x: p.x, z: p.z });
    lose(w, 'small_fishing_net');
    const before = p.inventory.count('raw_shrimps') + p.inventory.count('raw_anchovies');
    workNode(w, 'net_spot');
    run(w, 3);
    expect(p.inventory.count('raw_shrimps') + p.inventory.count('raw_anchovies')).toBe(before);
  });

  it('glass trout: clear pools upriver, a rod and Fishing 20; cooks into a 30 HP meal', () => {
    const pools = new GameWorld().nodes.filter((n) => n.def.id === 'rod_spot');
    // Three upriver on the island, two more at Thornridge's tarn (Phase 4A).
    expect(pools.filter((n) => n.x < 112).length).toBe(3);
    expect(pools.length).toBe(5);
    for (const n of pools) expect(SIDES.some(([a, b]) => !isBlocked(new GameWorld().map, n.x + a, n.z + b))).toBe(true);
    const w = new GameWorld();
    const p = w.player;
    expect(p.toolbelt.get('fishing_rod')).toBe('fishing_rod');
    setRng(w, 0.01);
    w.drainEvents();
    workNode(w, 'rod_spot');
    run(w, 4);
    expect(p.inventory.count('raw_glass_trout')).toBe(0);
    p.skills.addXp('fishing', xpForLevel(20));
    workNode(w, 'rod_spot');
    run(w, 4);
    expect(p.inventory.count('raw_glass_trout')).toBeGreaterThan(0);
    w.issue({ type: 'moveTo', x: p.x, z: p.z });
    lose(w, 'fishing_rod');
    const before = p.inventory.count('raw_glass_trout');
    workNode(w, 'rod_spot');
    run(w, 4);
    expect(p.inventory.count('raw_glass_trout')).toBe(before);
    expect(itemDef('glass_trout').heal).toBe(30);
    expect(RECIPES.glass_trout).toMatchObject({ level: 20, fail: { stopLevel: 42 } });
  });

  it('ember carp: warm springs in the Ironcrag Hills, a rod and Fishing 35; never burns; restores devotion', () => {
    const w = new GameWorld();
    const p = w.player;
    const springs = w.nodes.filter((n) => n.def.id === 'warm_spring');
    expect(springs.length).toBe(2);
    for (const n of springs) expect(SIDES.some(([a, b]) => !isBlocked(w.map, n.x + a, n.z + b))).toBe(true);
    setRng(w, 0.01);
    workNode(w, 'warm_spring');
    run(w, 4);
    expect(p.inventory.count('raw_ember_carp')).toBe(0);
    p.skills.addXp('fishing', xpForLevel(35));
    workNode(w, 'warm_spring');
    run(w, 4);
    expect(p.inventory.count('raw_ember_carp')).toBeGreaterThan(0);
    expect(RECIPES.ember_carp.fail).toBeUndefined();
    // Full health, but devotion to restore: it can still be eaten.
    w.issue({ type: 'moveTo', x: p.x, z: p.z });
    p.skills.addXp('prayer', xpForLevel(20));
    p.prayerPoints = 10;
    p.inventory.add('ember_carp', 1);
    w.issue({ type: 'useItem', slot: p.inventory.slots.findIndex((x) => x?.item === 'ember_carp') });
    expect(p.prayerPoints).toBe(14);
    expect(p.inventory.count('ember_carp')).toBe(0);
  });

  it('older characters are given a rod once', () => {
    const w = new GameWorld();
    delete w.player.toolbelt.slots.fishing_rod;
    const save = JSON.parse(JSON.stringify(w.save()));
    save.grants = save.grants.filter((g: string) => g !== 'rod-v1');
    const w2 = new GameWorld({ save });
    expect(w2.player.toolbelt.get('fishing_rod')).toBe('fishing_rod');
    const w3 = new GameWorld({ save: JSON.parse(JSON.stringify(w2.save())) });
    expect(w3.player.toolbelt.count('fishing_rod') + w3.player.inventory.count('fishing_rod')).toBe(1);
  });

  it('a full bag stops fishing with no xp', () => {
    const w = new GameWorld();
    const p = w.player;
    setRng(w, 0.01);
    p.inventory.add('bread', INVENTORY_SLOTS - p.inventory.usedSlots());
    workNode(w, 'net_spot');
    run(w, 4);
    expect(p.skills.xp.fishing).toBe(0);
    expect(p.action).toBeNull();
  });
});

describe('Shop', () => {
  it('buys with coins atomically, limited by coins and space; refuses away from the stall', () => {
    const w = new GameWorld();
    const p = w.player;
    w.issue({ type: 'shopBuy', item: 'knife', qty: 1 });
    expect(p.inventory.count('knife')).toBe(0);
    openShop(w);
    const coins = p.inventory.count('coins');
    w.issue({ type: 'shopBuy', item: 'hammer', qty: 2 });
    expect(p.inventory.count('hammer')).toBe(2);
    expect(p.inventory.count('coins')).toBe(coins - 12);
    // Can't afford: nothing changes.
    p.inventory.remove('coins', p.inventory.count('coins'));
    p.inventory.add('coins', 3);
    w.issue({ type: 'shopBuy', item: 'bronze_axe', qty: 1 });
    expect(p.inventory.count('bronze_axe')).toBe(0);
    expect(p.inventory.count('coins')).toBe(3);
    // Buys only what fits.
    p.inventory.add('coins', 997);
    p.inventory.add('bread', INVENTORY_SLOTS - p.inventory.usedSlots() - 2);
    w.issue({ type: 'shopBuy', item: 'knife', qty: 5 });
    expect(p.inventory.count('knife')).toBe(2);
    expect(p.inventory.isFull()).toBe(true);
    expect(p.inventory.count('coins')).toBe(1000 - 12);
  });

  it('sells for coins; nothing is duplicated or lost across many trades', () => {
    const w = new GameWorld();
    const p = w.player;
    openShop(w);
    p.inventory.add('logs', 5);
    const before = p.inventory.count('coins');
    w.issue({ type: 'shopSell', slot: slotOf(p.inventory, 'logs'), qty: 3 });
    expect(p.inventory.count('logs')).toBe(2);
    expect(p.inventory.count('coins')).toBe(before + 3 * sellPrice('logs'));
    // Value bookkeeping: coins + item value (at shop prices) never grows from nothing.
    for (let i = 0; i < 200; i++) {
      const c0 = p.inventory.count('coins');
      const k0 = p.inventory.count('knife');
      if (i % 2) w.issue({ type: 'shopBuy', item: 'knife', qty: 1 });
      else if (k0 > 0) w.issue({ type: 'shopSell', slot: slotOf(p.inventory, 'knife'), qty: 1 });
      const c1 = p.inventory.count('coins');
      const k1 = p.inventory.count('knife');
      if (k1 > k0) expect(c0 - c1).toBe(6);
      if (k1 < k0) expect(c1 - c0).toBe(sellPrice('knife'));
      expect(p.inventory.usedSlots()).toBeLessThanOrEqual(INVENTORY_SLOTS);
    }
  });

  it('closes when the player walks away', () => {
    const w = new GameWorld();
    openShop(w);
    expect(w.activeShop()).toBeTruthy();
    stand(w, 40, 75);
    run(w, 0.1);
    expect(w.drainEvents().some((e) => e.type === 'shopClose')).toBe(true);
  });
});
