import { FIRE_LOGS } from '../src/data/firemaking';
import { describe, expect, it } from 'vitest';
import { GameWorld } from '../src/sim/world';
import { Inventory } from '../src/sim/inventory';
import { RECIPES } from '../src/data/recipes';
import { Bank, BANK_TABS, withdrawItem, depositItem } from '../src/sim/bank';
import { RESOURCES, gatherChance } from '../src/data/resources';
import { itemDef, type ItemId } from '../src/data/items';
import { xpForLevel } from '../src/data/skills';

const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds * 30; t++) w.tick();
};
const setRng = (w: GameWorld, v: number) => ((w as unknown as { rng: () => number }).rng = () => v);
const stand = (w: GameWorld, x: number, z: number) => {
  w.player.x = w.player.prevX = x;
  w.player.z = w.player.prevZ = z;
};
const slotOf = (inv: Inventory, item: ItemId) => inv.slots.findIndex((s) => s?.item === item);
function openStation(w: GameWorld, kind: 'furnace' | 'anvil' | 'range') {
  const st = w.stations.find((s) => s.kind === kind)!;
  stand(w, st.x - 1.0, st.z);
  w.issue({ type: 'interact', target: st.id });
  run(w, 0.3);
  return st;
}
const lastMessage = (w: GameWorld) => {
  const m = w.drainEvents().filter((e) => e.type === 'message');
  return m.length ? (m[m.length - 1] as { text: string }).text : '';
};

describe('Steel tier', () => {
  it('coal rocks stand in the Ironcrag Hills and need Mining 24', () => {
    const w = new GameWorld();
    const coal = w.nodes.filter((n) => n.def.id === 'coal_rock');
    expect(coal.length).toBeGreaterThanOrEqual(3);
    stand(w, coal[0].x + 1, coal[0].z);
    w.drainEvents();
    w.issue({ type: 'interact', target: coal[0].id });
    expect(lastMessage(w)).toContain('Mining level 24');
    w.player.skills.addXp('mining', xpForLevel(24));
    setRng(w, 0);
    w.issue({ type: 'interact', target: coal[0].id });
    run(w, 3);
    expect(w.player.inventory.count('coal_ore')).toBeGreaterThan(0);
  });

  it('adding coal did not move the existing trees and rocks', () => {
    const w = new GameWorld();
    // The first copper rock and first tree are generated before any later content.
    const before = w.nodes.filter((n) => n.def.id !== 'coal_rock').length;
    expect(before).toBe(w.nodes.length - w.nodes.filter((n) => n.def.id === 'coal_rock').length);
    expect(w.nodes.findIndex((n) => n.def.id === 'coal_rock')).toBeGreaterThan(w.nodes.findIndex((n) => n.def.id === 'net_spot'));
  });

  it('refines steel from an iron bar and a coal at Smithing 26, then forges steel gear', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('iron_bar', 2);
    p.inventory.add('coal_ore', 2);
    openStation(w, 'furnace');
    expect(w.craftBlocker('steel_bar')).toContain('Smithing level 26');
    p.skills.addXp('smithing', xpForLevel(35));
    w.issue({ type: 'craft', recipe: 'steel_bar', count: 2 });
    run(w, 5);
    expect(p.inventory.count('steel_bar')).toBe(2);
    expect(p.inventory.count('coal_ore')).toBe(0);
    openStation(w, 'anvil');
    w.issue({ type: 'craft', recipe: 'steel_pickaxe', count: 1 });
    run(w, 3);
    expect(p.inventory.count('steel_pickaxe')).toBe(1);
    expect(p.inventory.count('steel_bar')).toBe(0);
    expect(RECIPES.steel_platebody.inputs[0]).toEqual({ item: 'steel_bar', qty: 3 });
  });

  it('a steel pickaxe is tier 3 and needs Mining 6 to use; until then the best usable tool counts', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('steel_pickaxe');
    expect(w.toolFor('pickaxe').tool?.item).toBe('bronze_pickaxe');
    p.skills.addXp('mining', xpForLevel(6));
    expect(w.toolFor('pickaxe').tool).toMatchObject({ item: 'steel_pickaxe', tier: 3 });
    expect(gatherChance(RESOURCES.copper_rock, 6, 3)).toBeGreaterThan(gatherChance(RESOURCES.copper_rock, 6, 2));
  });

  it('steel weapons and armour need level 20', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('steel_sword');
    p.inventory.add('steel_platebody');
    w.drainEvents();
    w.issue({ type: 'equip', slot: slotOf(p.inventory, 'steel_sword') });
    expect(lastMessage(w)).toContain('Attack level 20');
    p.skills.addXp('attack', xpForLevel(20));
    p.skills.addXp('defence', xpForLevel(20));
    w.issue({ type: 'equip', slot: slotOf(p.inventory, 'steel_sword') });
    w.issue({ type: 'equip', slot: slotOf(p.inventory, 'steel_platebody') });
    expect(p.equipment.get('weapon')).toBe('steel_sword');
    expect(p.equipment.get('body')).toBe('steel_platebody');
    expect(itemDef('steel_sword').equip!.power!).toBeGreaterThan(itemDef('iron_sword').equip!.power!);
  });
});

describe('Firemaking', () => {
  /** An open grassy spot clear of stations, west of the village (meadow). */
  function clearing(w: GameWorld) {
    const meadow = w.map.checkpoints.find((c) => c.id === 'meadow')!;
    stand(w, Math.floor(meadow.respawnX) + 0.5, Math.floor(meadow.respawnZ) + 2.5);
  }
  const light = (w: GameWorld, item: ItemId = 'logs') => w.issue({ type: 'lightFire', slot: slotOf(w.player.inventory, item) });

  it('new characters carry a tinderbox on the toolbelt; older saves get one once', () => {
    const w = new GameWorld();
    expect(w.player.toolbelt.get('tinderbox')).toBe('tinderbox');
    const save = w.save();
    delete save.toolbelt!.tinderbox;
    save.grants = save.grants!.filter((g) => g !== 'firemaking-v1');
    const w2 = new GameWorld({ save: JSON.parse(JSON.stringify(save)) });
    expect(w2.player.toolbelt.get('tinderbox')).toBe('tinderbox');
    expect(w2.drainEvents().some((e) => e.type === 'message' && e.text.startsWith('New skill: Firemaking'))).toBe(true);
    // Once only: dropping it and reloading doesn't hand out another.
    w2.issue({ type: 'beltRemove', category: 'tinderbox' });
    w2.issue({ type: 'dropItem', slot: slotOf(w2.player.inventory, 'tinderbox') });
    const w3 = new GameWorld({ save: JSON.parse(JSON.stringify(w2.save())) });
    expect(w3.player.toolbelt.get('tinderbox')).toBeNull();
    expect(w3.player.inventory.count('tinderbox')).toBe(0);
  });

  it('lights logs where you stand, gives xp, and you step off the fire', () => {
    const w = new GameWorld();
    const p = w.player;
    clearing(w);
    p.inventory.add('logs', 2);
    setRng(w, 0);
    const at = { x: Math.floor(p.x) + 0.5, z: Math.floor(p.z) + 0.5 };
    light(w);
    run(w, 1.5);
    expect(w.fires.length).toBe(1);
    expect(w.fires[0]).toMatchObject(at);
    expect(w.stations).toContain(w.fires[0]);
    expect(p.inventory.count('logs')).toBe(1);
    expect(p.skills.xp.firemaking).toBe(FIRE_LOGS.logs!.xp);
    run(w, 1);
    expect(Math.hypot(p.x - at.x, p.z - at.z)).toBeGreaterThan(0.8);
  });

  it('keeps trying until the fire catches', () => {
    const w = new GameWorld();
    clearing(w);
    w.player.inventory.add('logs', 1);
    setRng(w, 0.99);
    light(w);
    run(w, 4);
    expect(w.fires.length).toBe(0);
    expect(w.player.action?.type).toBe('firemaking');
    setRng(w, 0);
    run(w, 1.3);
    expect(w.fires.length).toBe(1);
  });

  it('needs a tinderbox and the level for the logs, and a clear spot', () => {
    const w = new GameWorld();
    const p = w.player;
    clearing(w);
    p.inventory.add('oak_logs', 1);
    p.inventory.add('logs', 2);
    w.drainEvents();
    light(w, 'oak_logs');
    expect(lastMessage(w)).toContain('Firemaking level 12');
    w.issue({ type: 'beltRemove', category: 'tinderbox' });
    w.issue({ type: 'dropItem', slot: slotOf(p.inventory, 'tinderbox') });
    light(w);
    expect(lastMessage(w)).toContain('tinderbox');
    p.toolbelt.slots.tinderbox = 'tinderbox';
    setRng(w, 0);
    light(w);
    run(w, 1.3);
    // Back onto the fire: can't light another on top of it.
    stand(w, w.fires[0].x, w.fires[0].z);
    w.drainEvents();
    light(w);
    expect(lastMessage(w)).toBe("You can't light a fire here.");
  });

  it('walking away stops the attempt', () => {
    const w = new GameWorld();
    clearing(w);
    w.player.inventory.add('logs', 1);
    setRng(w, 0.99);
    light(w);
    w.issue({ type: 'joystick', dx: 1, dz: 0 });
    run(w, 0.5);
    expect(w.player.action).toBeNull();
  });

  it('you can cook on your own fire, and it burns out into ashes', () => {
    const w = new GameWorld();
    const p = w.player;
    clearing(w);
    p.inventory.add('logs', 1);
    p.inventory.add('raw_shrimps', 1);
    setRng(w, 0);
    light(w);
    run(w, 2.5);
    const fire = w.fires[0];
    w.issue({ type: 'interact', target: fire.id });
    run(w, 1);
    expect(w.drainEvents().some((e) => e.type === 'productionOpen' && e.station === 'fire')).toBe(true);
    setRng(w, 0.99);
    w.issue({ type: 'craft', recipe: 'shrimps', count: 1 });
    run(w, 2.5);
    expect(p.inventory.count('shrimps')).toBe(1);
    fire.age = fire.life;
    w.tick();
    expect(w.fires.length).toBe(0);
    expect(w.stations).not.toContain(fire);
    expect(w.interactable(fire.id)).toBeNull();
    expect(w.groundItems.some((g) => g.item === 'ashes' && g.x === fire.x && g.z === fire.z)).toBe(true);
  });
});

describe('Equipment slots', () => {
  it('has the eleven OSRS-style slots, and old saves load into them unchanged', () => {
    const w = new GameWorld();
    expect(Object.keys(w.player.equipment.slots).sort()).toEqual(['ammo', 'body', 'cape', 'feet', 'hands', 'head', 'legs', 'neck', 'ring', 'shield', 'weapon']);
    const save = w.save();
    save.equipment = { weapon: 'bronze_sword', head: 'bronze_helm' };
    const w2 = new GameWorld({ save: JSON.parse(JSON.stringify(save)) });
    expect(w2.player.equipment.get('weapon')).toBe('bronze_sword');
    expect(w2.player.equipment.get('hands')).toBeNull();
  });

  it('wears gloves, boots, cape and amulet; armour adds up and an amulet helps every style', () => {
    const w = new GameWorld();
    const p = w.player;
    for (const it of ['leather_gloves', 'leather_boots', 'travellers_cape', 'fang_amulet'] as ItemId[]) {
      p.inventory.add(it);
      w.issue({ type: 'equip', slot: slotOf(p.inventory, it) });
    }
    expect(p.equipment.get('hands')).toBe('leather_gloves');
    expect(p.equipment.get('feet')).toBe('leather_boots');
    expect(p.equipment.get('cape')).toBe('travellers_cape');
    expect(p.equipment.get('neck')).toBe('fang_amulet');
    expect(w.playerBonuses().armour).toBe(2 + 2 + 1 + 1);
    // Training weapon (melee 12 accuracy) plus the amulet's 3; same for ranged with a real bow, where
    // the wolfhide wraps and boots add their ranged accuracy too (+1 each, Phase 4B).
    expect(w.playerBonuses().accuracy).toBe(12 + 3);
    p.inventory.add('shortbow');
    w.issue({ type: 'equip', slot: slotOf(p.inventory, 'shortbow') });
    expect(w.playerBonuses().accuracy).toBe(itemDef('shortbow').equip!.accuracy! + 3 + 2);
    // Gloves and vambraces share the hands slot: wearing one swaps the other into the bag.
    p.inventory.add('leather_vambraces');
    w.issue({ type: 'equip', slot: slotOf(p.inventory, 'leather_vambraces') });
    expect(p.equipment.get('hands')).toBe('leather_vambraces');
    expect(p.inventory.count('leather_gloves')).toBe(1);
  });
});

describe('Crafting', () => {
  const tanner = (w: GameWorld) => w.npcs.find((n) => n.def.id === 'tanner')!;
  function atTanner(w: GameWorld) {
    const t = tanner(w);
    stand(w, t.x, t.z - 1.2);
    w.issue({ type: 'interact', target: t.id });
    run(w, 0.5);
  }

  it('wolf pelts no longer stack; old saves split a stack into slots without losing any', () => {
    expect(itemDef('wolf_pelt').stackable).toBe(false);
    const w = new GameWorld();
    const save = w.save();
    save.inventory[10] = { item: 'wolf_pelt', qty: 5 };
    const w2 = new GameWorld({ save: JSON.parse(JSON.stringify(save)) });
    expect(w2.player.inventory.count('wolf_pelt')).toBe(5);
  });

  it('older saves get a needle and chisel on the toolbelt once', () => {
    const w = new GameWorld();
    const save = w.save();
    delete save.toolbelt!.needle;
    delete save.toolbelt!.chisel;
    save.grants = save.grants!.filter((g) => g !== 'crafting-v1');
    const w2 = new GameWorld({ save: JSON.parse(JSON.stringify(save)) });
    expect(w2.player.toolbelt.get('needle')).toBe('needle');
    expect(w2.player.toolbelt.get('chisel')).toBe('chisel');
  });

  it('Rook tans pelts into leather for 2 coins each, only while you are with him', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('wolf_pelt', 4);
    p.inventory.remove('coins', p.inventory.count('coins'));
    p.inventory.add('coins', 7);
    w.issue({ type: 'tan', item: 'wolf_pelt', qty: 4 });
    expect(p.inventory.count('leather')).toBe(0);
    atTanner(w);
    expect(p.tannerAt).toBe(tanner(w).id);
    w.issue({ type: 'tan', item: 'wolf_pelt', qty: 4 });
    // 7 coins pay for 3 hides.
    expect(p.inventory.count('leather')).toBe(3);
    expect(p.inventory.count('wolf_pelt')).toBe(1);
    expect(p.inventory.count('coins')).toBe(1);
    stand(w, tanner(w).x + 8, tanner(w).z);
    w.tick();
    expect(p.tannerAt).toBeNull();
  });

  it('sews leather armour with a needle and thread, level by level', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('leather', 3);
    p.inventory.add('thread', 3);
    w.issue({ type: 'openAnywhere', kind: 'crafting' });
    expect(w.drainEvents().some((e) => e.type === 'productionOpen' && e.station === 'crafting')).toBe(true);
    expect(w.craftBlocker('leather_body')).toContain('Crafting level 15');
    w.issue({ type: 'craft', recipe: 'leather_gloves', count: 1 });
    run(w, 2.5);
    expect(p.inventory.count('leather_gloves')).toBe(1);
    expect(p.skills.xp.crafting).toBe(12);
    expect(p.inventory.count('thread')).toBe(2);
    // Without a needle anywhere, nothing can be sewn.
    delete p.toolbelt.slots.needle;
    expect(w.craftBlocker('leather_gloves')).toContain('needle');
  });

  it('cuts ironcrag garnets with a chisel from Crafting 18', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('sapphire');
    expect(w.craftBlocker('cut_sapphire')).toContain('Crafting level 18');
    p.skills.addXp('crafting', xpForLevel(18));
    w.issue({ type: 'craft', recipe: 'cut_sapphire', count: 1 });
    run(w, 2.5);
    expect(p.inventory.count('cut_sapphire')).toBe(1);
    expect(p.inventory.count('sapphire')).toBe(0);
  });

  it('flax is picked without a tool or xp, then spun into bowstrings at the wheel (Crafting 10)', () => {
    const w = new GameWorld();
    const p = w.player;
    const flax = w.nodes.find((n) => n.def.id === 'flax')!;
    expect(flax).toBeTruthy();
    for (const k of Object.keys(p.toolbelt.slots)) delete p.toolbelt.slots[k as keyof typeof p.toolbelt.slots];
    stand(w, flax.x + 1, flax.z);
    setRng(w, 0.5); // picks never deplete at 0.5 (depletes below 0.17)
    w.issue({ type: 'interact', target: flax.id });
    run(w, 4);
    expect(p.inventory.count('flax')).toBeGreaterThanOrEqual(2);
    expect(p.skills.xp.crafting).toBe(0);
    const wheel = w.stations.find((s) => s.kind === 'spinning_wheel')!;
    stand(w, wheel.x, wheel.z + 1.2);
    w.issue({ type: 'interact', target: wheel.id });
    run(w, 0.5);
    expect(w.craftBlocker('bowstring')).toContain('Crafting level 6');
    p.skills.addXp('crafting', xpForLevel(6));
    const before = p.inventory.count('bowstring');
    w.issue({ type: 'craft', recipe: 'bowstring', count: 1 });
    run(w, 2.5);
    expect(p.inventory.count('bowstring')).toBe(before + 1);
  });
});

describe('Bank tabs and placeholders', () => {
  it('new items go to the tab being viewed; tabs can be added up to 9 and close up when emptied', () => {
    const b = new Bank();
    b.add('logs', 5);
    b.add('copper_ore', 3, 1); // a new tab 1
    b.add('tin_ore', 2, 7); // tab 7 doesn't exist yet: main tab
    expect(b.tabs()).toEqual([1]);
    expect(b.slots.find((s) => s.item === 'tin_ore')!.tab).toBe(0);
    expect(b.setTab('tin_ore', 2)).toBe(true);
    expect(b.tabs()).toEqual([1, 2]);
    expect(b.setTab('logs', 4)).toBe(false); // only one past the last tab
    // Emptying tab 1 renumbers tab 2 to 1.
    b.remove('copper_ore', 3);
    expect(b.tabs()).toEqual([1]);
    expect(b.slots.find((s) => s.item === 'tin_ore')!.tab).toBe(1);
    expect(b.ordered().map((s) => s.item)).toEqual(['logs', 'tin_ore']);
    // Fill up to the limit: tabs 2..9 can be made, a tenth can't.
    const more: ItemId[] = ['bread', 'coins', 'bones', 'iron_ore', 'coal_ore', 'flax', 'thread', 'leather', 'ashes'];
    more.forEach((it, i) => b.add(it, 1, i + 2));
    expect(b.slots.find((s) => s.item === 'ashes')!.tab).toBe(0);
    expect(b.tabs().length).toBe(BANK_TABS);
  });

  it('with placeholders on, withdrawing the last keeps the spot (and tab) for the next deposit', () => {
    const b = new Bank();
    const inv = new Inventory();
    b.placeholders = true;
    b.add('logs', 1);
    b.add('copper_ore', 2, 1);
    withdrawItem(b, inv, 'copper_ore', 2);
    expect(b.count('copper_ore')).toBe(0);
    expect(b.slots.find((s) => s.item === 'copper_ore')).toEqual({ item: 'copper_ore', qty: 0, tab: 1 });
    expect(b.usedSlots()).toBe(2);
    expect(b.tabs()).toEqual([1]);
    // Nothing to withdraw from a placeholder.
    expect(withdrawItem(b, inv, 'copper_ore', 1).moved).toBe(0);
    // Depositing fills it in place, ignoring the tab being viewed.
    depositItem(b, inv, 'copper_ore', 1, 0);
    expect(b.slots.find((s) => s.item === 'copper_ore')).toEqual({ item: 'copper_ore', qty: 1, tab: 1 });
    b.remove('copper_ore', 1);
    expect(b.releasePlaceholders('copper_ore')).toBe(1);
    expect(b.tabs()).toEqual([]);
    // With placeholders off, the slot frees.
    b.placeholders = false;
    b.remove('logs', 1);
    expect(b.usedSlots()).toBe(0);
  });

  it('tabs, placeholders and the setting survive save and load; junk tabs fall back to main', () => {
    const w = new GameWorld();
    const p = w.player;
    p.bank.placeholders = true;
    p.bank.add('logs', 4, 1);
    p.bank.add('bread', 1);
    p.bank.remove('bread', 1);
    const save = JSON.parse(JSON.stringify(w.save()));
    const w2 = new GameWorld({ save });
    expect(w2.player.bank.placeholders).toBe(true);
    expect(w2.player.bank.toJSON()).toEqual(p.bank.toJSON());
    const odd = Bank.restore([{ item: 'logs', qty: 2, tab: 42 }, { item: 'bread', qty: -3 }]);
    expect(odd.toJSON()).toEqual([{ item: 'logs', qty: 2, tab: 0 }]);
  });

  it('bank commands work only at the bank and deposit into the chosen tab', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('logs', 3);
    w.issue({ type: 'bankDeposit', slot: slotOf(p.inventory, 'logs'), qty: 3, tab: 1 });
    expect(p.bank.count('logs')).toBe(0);
    const banker = w.npcs.find((n) => n.def.service === 'bank')!;
    stand(w, banker.x, banker.z + 1.6);
    w.issue({ type: 'interact', target: banker.id });
    run(w, 1);
    expect(w.bankOpen).toBe(true);
    w.issue({ type: 'bankDeposit', slot: slotOf(p.inventory, 'logs'), qty: 3, tab: 1 });
    expect(p.bank.slots.find((s) => s.item === 'logs')).toEqual({ item: 'logs', qty: 3, tab: 1 });
    w.issue({ type: 'bankSetPlaceholders', on: true });
    w.issue({ type: 'bankWithdraw', item: 'logs', qty: 3 });
    expect(p.bank.slots.find((s) => s.item === 'logs')?.qty).toBe(0);
    w.issue({ type: 'bankSetTab', item: 'logs', tab: 0 });
    expect(p.bank.tabs()).toEqual([]);
    w.issue({ type: 'bankReleasePlaceholders' });
    expect(p.bank.usedSlots()).toBe(0);
  });
});
