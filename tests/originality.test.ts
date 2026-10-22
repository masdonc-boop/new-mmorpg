import { afterEach, describe, expect, it } from 'vitest';
import { ITEMS } from '../src/data/items';
import { ITEM_ALIASES, remapItemIds } from '../src/data/aliases';
import { GameWorld, type SaveData } from '../src/sim/world';
import { isBlocked } from '../src/sim/worldmap';
import { xpForLevel } from '../src/data/skills';

/** RuneScape-specific names that must not appear in item names (grows with each originality batch). */
const BANNED_ITEM_WORDS = [/platebody/i, /platelegs/i, /\bbig bones\b/i, /\brunes?\b/i, /mithril/i, /adamant/i, /\bdragon\b/i];

describe('Originality guard', () => {
  it('no item uses a banned RuneScape-specific name', () => {
    for (const d of Object.values(ITEMS)) for (const re of BANNED_ITEM_WORDS) expect(d.name, d.id).not.toMatch(re);
  });

  it('renamed armour keeps its ids, stats and recipes (saves unaffected)', () => {
    expect(ITEMS.bronze_platebody.name).toBe('Bronze breastplate');
    expect(ITEMS.steel_platelegs.name).toBe('Steel greaves');
    expect(ITEMS.big_bones.name).toBe("Warlord's bones");
    const w = new GameWorld();
    const save = w.save();
    save.equipment = { body: 'iron_platebody', legs: 'bronze_platelegs' };
    save.inventory[3] = { item: 'big_bones', qty: 1 };
    const w2 = new GameWorld({ save: JSON.parse(JSON.stringify(save)) });
    expect(w2.player.equipment.get('body')).toBe('iron_platebody');
    expect(w2.player.equipment.get('legs')).toBe('bronze_platelegs');
    expect(w2.player.inventory.count('big_bones')).toBe(1);
  });
});

describe('Item id aliases for future renames', () => {
  afterEach(() => {
    for (const k of Object.keys(ITEM_ALIASES)) delete ITEM_ALIASES[k];
  });

  it('remaps ids everywhere they appear, merges keys, and leaves text alone', () => {
    const data = {
      name: 'old_logs',
      inventory: [{ item: 'old_logs', qty: 3 }, null],
      bank: [{ item: 'old_logs', qty: 10, tab: 2 }],
      balances: { a: { old_logs: 4, logs: 6 } },
      log: [{ detail: 'placed old_logs', hash: 'old_logs' }],
    };
    const out = remapItemIds(data, { old_logs: 'logs' });
    expect(out.name).toBe('old_logs');
    expect(out.inventory[0]).toEqual({ item: 'logs', qty: 3 });
    expect(out.bank[0]).toEqual({ item: 'logs', qty: 10, tab: 2 });
    expect(out.balances.a).toEqual({ logs: 10 });
    expect(out.log[0]).toEqual({ detail: 'placed old_logs', hash: 'old_logs' });
    expect(remapItemIds(data, {})).toBe(data);
  });

  it('an old save holding a renamed id loads with every item kept', () => {
    ITEM_ALIASES.retired_ore = 'copper_ore';
    const save = new GameWorld().save() as SaveData & Record<string, unknown>;
    save.inventory[6] = { item: 'retired_ore' as never, qty: 1 };
    save.bank = [{ item: 'retired_ore' as never, qty: 25 }];
    const w = new GameWorld({ save: JSON.parse(JSON.stringify(save)) });
    expect(w.player.inventory.count('copper_ore')).toBe(1);
    expect(w.player.bank.count('copper_ore')).toBe(25);
  });
});

describe('Batch 2: spark stones', () => {
  const run = (w: GameWorld, seconds: number) => {
    for (let t = 0; t < seconds * 30; t++) w.tick();
  };
  const stand = (w: GameWorld, x: number, z: number) => {
    w.player.x = w.player.prevX = x;
    w.player.z = w.player.prevZ = z;
  };

  it('air runes are now spark stones (same id): old saves keep them and wands still use them', () => {
    expect(ITEMS.air_rune.name).toBe('Spark stones');
    const save = new GameWorld().save();
    const w = new GameWorld({ save: JSON.parse(JSON.stringify(save)) });
    expect(w.player.inventory.count('air_rune')).toBe(60);
    w.issue({ type: 'setStyle', style: 'magic' });
    expect(w.ammoLeft()).toBe(60);
  });

  it('mine spark quartz (Mining 5), chip it with a chisel, charge the chips at the shrine', () => {
    const w = new GameWorld();
    const p = w.player;
    const rock = w.nodes.find((n) => n.def.id === 'spark_quartz_rock')!;
    expect(rock).toBeTruthy();
    stand(w, rock.x + 1, rock.z);
    if (isBlocked(w.map, p.x, p.z)) stand(w, rock.x - 1, rock.z);
    p.skills.addXp('mining', xpForLevel(5));
    (w as unknown as { rng: () => number }).rng = () => 0.4; // success, no depletion
    w.issue({ type: 'interact', target: rock.id });
    run(w, 4);
    expect(p.inventory.count('spark_quartz')).toBeGreaterThan(0);
    const quartz = p.inventory.count('spark_quartz');
    w.issue({ type: 'openAnywhere', kind: 'crafting' });
    w.issue({ type: 'craft', recipe: 'dull_spark', count: quartz });
    run(w, quartz * 2);
    expect(p.inventory.count('dull_spark')).toBe(quartz * 8);
    const stones = p.inventory.count('air_rune');
    // Charging needs the shrine or a waystone.
    w.issue({ type: 'chargeSparks' });
    expect(p.inventory.count('dull_spark')).toBe(quartz * 8);
    const shrine = w.map.checkpoints[0];
    stand(w, shrine.x + 1.5, shrine.z + 1);
    const magic = p.skills.xp.magic;
    w.issue({ type: 'chargeSparks' });
    expect(p.inventory.count('dull_spark')).toBe(0);
    expect(p.inventory.count('air_rune')).toBe(stones + quartz * 8);
    expect(p.skills.xp.magic).toBe(magic + quartz * 4);
  });
});

describe('Batch 4a: glimmerite and glimsteel', () => {
  const run = (w: GameWorld, seconds: number) => {
    for (let t = 0; t < seconds * 30; t++) w.tick();
  };
  const stand = (w: GameWorld, x: number, z: number) => {
    w.player.x = w.player.prevX = x;
    w.player.z = w.player.prevZ = z;
  };
  const slotOf = (w: GameWorld, item: string) => w.player.inventory.slots.findIndex((s) => s?.item === item);

  it('glimmerite veins lie in the deep Ironcrag Hills and need Mining 40', () => {
    const w = new GameWorld();
    const veins = w.nodes.filter((n) => n.def.id === 'glimmerite_rock');
    expect(veins.length).toBeGreaterThanOrEqual(3);
    expect(veins[0].def.levelReq).toBe(40);
    for (const v of veins) expect(Math.hypot(v.x - 101, v.z - 62)).toBeLessThan(5);
  });

  it('smelt a hot bloom (Smithing 40), quench it in the river, forge glimsteel gear', () => {
    const w = new GameWorld();
    const p = w.player;
    p.skills.addXp('smithing', xpForLevel(58));
    p.inventory.add('glimmerite_ore', 3);
    p.inventory.add('coal_ore', 6);
    const furnace = w.stations.find((s) => s.kind === 'furnace')!;
    stand(w, furnace.x - 1, furnace.z);
    w.issue({ type: 'interact', target: furnace.id });
    run(w, 0.3);
    w.issue({ type: 'craft', recipe: 'glimsteel_bloom', count: 3 });
    run(w, 7);
    expect(p.inventory.count('glimsteel_bloom')).toBe(3);
    // Not near water: refused.
    w.drainEvents();
    w.issue({ type: 'quench' });
    expect(p.inventory.count('glimsteel_bloom')).toBe(3);
    // At the riverbank by a fishing spot it sets.
    const spot = w.nodes.find((n) => n.def.id === 'net_spot')!;
    stand(w, spot.x + 1.2, spot.z);
    expect(w.nearWater()).toBe(true);
    const before = p.skills.xp.smithing;
    w.issue({ type: 'quench' });
    expect(p.inventory.count('glimsteel_bloom')).toBe(0);
    expect(p.inventory.count('glimsteel_bar')).toBe(3);
    expect(p.skills.xp.smithing).toBe(before + 75);
    const anvil = w.stations.find((s) => s.kind === 'anvil')!;
    stand(w, anvil.x - 1, anvil.z);
    w.issue({ type: 'interact', target: anvil.id });
    run(w, 0.3);
    w.issue({ type: 'craft', recipe: 'glimsteel_platebody', count: 1 });
    run(w, 3);
    expect(p.inventory.count('glimsteel_platebody')).toBe(1);
  });

  it('glimsteel is above steel, with its own trait: light armour that sharpens your aim', () => {
    expect(ITEMS.glimsteel_sword.equip!.power!).toBeGreaterThan(ITEMS.steel_sword.equip!.power!);
    expect(ITEMS.glimsteel_platebody.equip!.armour!).toBeGreaterThan(ITEMS.steel_platebody.equip!.armour!);
    const w = new GameWorld();
    const p = w.player;
    p.skills.addXp('defence', xpForLevel(30));
    p.inventory.add('glimsteel_platebody');
    const acc = w.playerBonuses().accuracy;
    w.issue({ type: 'equip', slot: slotOf(w, 'glimsteel_platebody') });
    expect(w.playerBonuses().accuracy).toBe(acc + 2);
    expect(ITEMS.glimsteel_pickaxe.tool).toMatchObject({ tier: 4, req: { skill: 'mining', level: 21 } });
  });
});

describe('Batch 4b: duskiron and emberglass', () => {
  const run = (w: GameWorld, seconds: number) => {
    for (let t = 0; t < seconds * 30; t++) w.tick();
  };
  const stand = (w: GameWorld, x: number, z: number) => {
    w.player.x = w.player.prevX = x;
    w.player.z = w.player.prevZ = z;
  };
  const slotOf = (w: GameWorld, item: string) => w.player.inventory.slots.findIndex((s) => s?.item === item);

  it('duskiron slag and ember vents lie in the Goblin Encampment (Mining 55 and 35)', () => {
    const w = new GameWorld();
    const slag = w.nodes.filter((n) => n.def.id === 'duskiron_slag');
    const vents = w.nodes.filter((n) => n.def.id === 'ember_vent');
    expect(slag.length).toBeGreaterThanOrEqual(3);
    expect(vents.length).toBeGreaterThanOrEqual(3);
    expect(slag[0].def.levelReq).toBe(55);
    expect(vents[0].def.levelReq).toBe(35);
    for (const n of [...slag, ...vents]) expect(Math.hypot(n.x - 86, n.z - 28)).toBeLessThan(10);
  });

  it('duskiron only smelts with slime gel as a flux; its armour is heavy but costs accuracy', () => {
    const w = new GameWorld();
    const p = w.player;
    p.skills.addXp('smithing', xpForLevel(72));
    p.inventory.add('duskiron_ore', 2);
    p.inventory.add('coal_ore', 4);
    const furnace = w.stations.find((s) => s.kind === 'furnace')!;
    stand(w, furnace.x - 1, furnace.z);
    w.issue({ type: 'interact', target: furnace.id });
    run(w, 0.3);
    expect(w.craftBlocker('duskiron_bar')).toContain('slime gel');
    p.inventory.add('slime_gel', 2);
    w.issue({ type: 'craft', recipe: 'duskiron_bar', count: 2 });
    run(w, 5);
    expect(p.inventory.count('duskiron_bar')).toBe(2);
    expect(p.inventory.count('slime_gel')).toBe(0);
    expect(ITEMS.duskiron_platebody.equip!.armour!).toBeGreaterThan(ITEMS.glimsteel_platebody.equip!.armour!);
    p.skills.addXp('defence', xpForLevel(45));
    p.inventory.add('duskiron_platebody');
    const acc = w.playerBonuses().accuracy;
    w.issue({ type: 'equip', slot: slotOf(w, 'duskiron_platebody') });
    expect(w.playerBonuses().accuracy).toBe(acc - 3);
  });

  it('wands: a riverwood wand (Fletching 10, spark chips) and an emberglass wand (Crafting 35)', () => {
    const w = new GameWorld();
    const p = w.player;
    p.skills.addXp('fletching', xpForLevel(10));
    p.skills.addXp('crafting', xpForLevel(35));
    p.inventory.add('logs', 1);
    p.inventory.add('dull_spark', 4);
    p.inventory.add('emberglass_shard', 2);
    p.inventory.add('oak_logs', 1);
    w.issue({ type: 'craft', recipe: 'riverwood_wand', count: 1 });
    run(w, 2.5);
    w.issue({ type: 'craft', recipe: 'emberglass_wand', count: 1 });
    run(w, 3);
    expect(p.inventory.count('riverwood_wand')).toBe(1);
    expect(p.inventory.count('emberglass_wand')).toBe(1);
    // Wielding a wand switches to Magic and replaces the apprentice wand's bonuses.
    w.issue({ type: 'equip', slot: slotOf(w, 'riverwood_wand') });
    expect(p.style).toBe('magic');
    expect(w.playerBonuses()).toMatchObject({ weapon: 'riverwood_wand', accuracy: 22 });
    w.drainEvents();
    w.issue({ type: 'equip', slot: slotOf(w, 'emberglass_wand') });
    expect(p.equipment.get('weapon')).toBe('riverwood_wand');
    p.skills.addXp('magic', xpForLevel(25));
    w.issue({ type: 'equip', slot: slotOf(w, 'emberglass_wand') });
    expect(w.playerBonuses()).toMatchObject({ weapon: 'emberglass_wand', power: 26 });
  });
});
