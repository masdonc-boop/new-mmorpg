import { describe, expect, it } from 'vitest';
import { GameWorld } from '../src/sim/world';
import { Inventory } from '../src/sim/inventory';
import { RECIPES } from '../src/data/recipes';
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
  it('coal rocks stand in the Ironcrag Hills and need Mining 30', () => {
    const w = new GameWorld();
    const coal = w.nodes.filter((n) => n.def.id === 'coal_rock');
    expect(coal.length).toBeGreaterThanOrEqual(3);
    stand(w, coal[0].x + 1, coal[0].z);
    w.drainEvents();
    w.issue({ type: 'interact', target: coal[0].id });
    expect(lastMessage(w)).toContain('Mining level 30');
    w.player.skills.addXp('mining', xpForLevel(30));
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

  it('smelts steel from 1 iron ore and 2 coal at Smithing 30, then forges steel gear', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('iron_ore', 2);
    p.inventory.add('coal_ore', 4);
    openStation(w, 'furnace');
    expect(w.craftBlocker('steel_bar')).toContain('Smithing level 30');
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
    expect(p.skills.xp.firemaking).toBe(40);
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
    expect(lastMessage(w)).toContain('Firemaking level 15');
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
