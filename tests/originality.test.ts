import { afterEach, describe, expect, it } from 'vitest';
import { ITEMS } from '../src/data/items';
import { ITEM_ALIASES, remapItemIds } from '../src/data/aliases';
import { GameWorld, type SaveData } from '../src/sim/world';
import { isBlocked } from '../src/sim/worldmap';
import { xpForLevel } from '../src/data/skills';
import { RESOURCES } from '../src/data/resources';
import { RECIPES } from '../src/data/recipes';
import { CROPS, SEEDS_PER_PATCH } from '../src/data/farming';
import { PLAYER_SPEED } from '../src/sim/world';
import { reclaimFee } from '../src/sim/death';

/** RuneScape-specific names that must not appear in item names (grows with each originality batch). */
const BANNED_ITEM_WORDS = [/platebody/i, /platelegs/i, /\bbig bones\b/i, /\brunes?\b/i, /mithril/i, /adamant/i, /\bdragon\b/i, /shrimp/i, /anchov/i, /potato/i, /onion/i, /cabbage/i, /\bcowl\b/i, /\bchaps\b/i, /vambraces/i, /crude wooden/i, /sapphire/i];

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

describe('Batch 5a: river fish', () => {
  it('an old save’s shrimps and anchovies carry over as brightfin and mudskipper eels', () => {
    const w = new GameWorld();
    w.player.inventory.add('raw_shrimps', 3);
    w.player.inventory.add('anchovies', 2);
    w.player.bank.add('shrimps', 7);
    const save = JSON.parse(JSON.stringify(w.save())) as SaveData;
    const p = new GameWorld({ save }).player;
    expect(p.inventory.count('raw_shrimps')).toBe(3);
    expect(p.inventory.count('anchovies')).toBe(2);
    expect(p.bank.count('shrimps')).toBe(7);
    expect([ITEMS.raw_shrimps.name, ITEMS.shrimps.name, ITEMS.raw_anchovies.name, ITEMS.anchovies.name, ITEMS.small_fishing_net.name])
      .toEqual(['Raw brightfin', 'Brightfin', 'Raw mudskipper eel', 'Smoked mudskipper', 'Hand net']);
  });

  it('retuned values: eels from Fishing 12 and Cooking 12; foods heal their own amounts', () => {
    expect(RESOURCES.net_spot.catches).toEqual([{ item: 'raw_anchovies', level: 12, xp: 36, chance: 0.4 }]);
    expect(RECIPES.anchovies).toMatchObject({ level: 12, xp: 42, fail: { stopLevel: 30 } });
    expect(RECIPES.shrimps.fail?.stopLevel).toBe(16);
    expect([ITEMS.shrimps.heal, ITEMS.anchovies.heal, ITEMS.cooked_meat.heal, ITEMS.bread.heal]).toEqual([16, 24, 22, 28]);
  });
});

describe('Batch 5b: crops', () => {
  it('an old save’s potatoes, onions, cabbages and planted patches carry over unchanged', () => {
    const w = new GameWorld();
    w.player.inventory.add('potato', 2);
    w.player.inventory.add('onion_seed', 5);
    w.player.bank.add('cabbage', 4);
    w.player.bank.add('baked_potato', 3);
    w.patches[0].crop = 'onion';
    w.patches[0].plantedAt = 1234;
    w.patches[0].weeds = 0;
    const save = JSON.parse(JSON.stringify(w.save())) as SaveData;
    const w2 = new GameWorld({ save });
    const p = w2.player;
    expect([p.inventory.count('potato'), p.inventory.count('onion_seed'), p.bank.count('cabbage'), p.bank.count('baked_potato')]).toEqual([2, 5, 4, 3]);
    expect(w2.patches[0]).toMatchObject({ crop: 'onion', plantedAt: 1234 });
    expect([ITEMS.potato.name, ITEMS.onion.name, ITEMS.cabbage.name, ITEMS.baked_potato.name, ITEMS.flax.name])
      .toEqual(['Sunroot', 'Wardleaf', 'Glowcap', 'Roasted sunroot', 'Bluebell flax']);
  });

  it('original crop table: own levels, growth and 2 seeds a patch; bluebell flax grows bowstring fibre', () => {
    expect(Object.values(CROPS).map((c) => [c.name, c.level, c.stages * c.stageMinutes])).toEqual([
      ['Sunroot', 1, 36], ['Wardleaf', 4, 40], ['Glowcaps', 8, 40], ['Bluebell flax', 12, 48],
    ]);
    expect(SEEDS_PER_PATCH).toBe(2);
    expect(CROPS.bluebell).toMatchObject({ seed: 'bluebell_seed', produce: 'flax' });
  });

  it('wardleaf burns as incense at an altar: Devotion xp and a point of devotion per leaf', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('onion', 3);
    w.issue({ type: 'burnIncense' });
    expect(p.inventory.count('onion')).toBe(3);
    const altar = w.map.checkpoints[0];
    p.x = p.prevX = altar.x + 1;
    p.z = p.prevZ = altar.z;
    p.skills.addXp('prayer', xpForLevel(10));
    p.prayerPoints = 2;
    const xp = p.skills.xp.prayer;
    w.issue({ type: 'burnIncense' });
    expect(p.inventory.count('onion')).toBe(0);
    expect(p.skills.xp.prayer - xp).toBe(12);
    expect(p.prayerPoints).toBe(5);
  });
});

describe('Batch 6: wolfhide, furniture and thieving', () => {
  it('an old save’s leather armour, worn and banked, carries over as the wolfhide set', () => {
    const w = new GameWorld();
    w.player.inventory.add('leather_cowl', 1);
    w.player.equipment.slots.body = 'leather_body';
    w.player.bank.add('leather_chaps', 2);
    w.player.furniture.chair = 'crude_chair';
    const save = JSON.parse(JSON.stringify(w.save())) as SaveData;
    const p = new GameWorld({ save }).player;
    expect(p.inventory.count('leather_cowl')).toBe(1);
    expect(p.equipment.get('body')).toBe('leather_body');
    expect(p.bank.count('leather_chaps')).toBe(2);
    expect(p.furniture.chair).toBe('crude_chair');
    expect(['leather_gloves', 'leather_boots', 'leather_cowl', 'leather_vambraces', 'leather_body', 'leather_chaps'].map((id) => ITEMS[id as keyof typeof ITEMS].name))
      .toEqual(['Wolfhide wraps', 'Wolfhide boots', 'Wolfhide hood', 'Wolfhide bracers', 'Wolfhide jerkin', 'Wolfhide breeches']);
  });

  it('the jerkin and breeches take two hides; a jerkin can be sealed with slime gel at Crafting 20', () => {
    expect(RECIPES.leather_body.inputs[0]).toEqual({ item: 'leather', qty: 2 });
    expect(RECIPES.leather_chaps).toMatchObject({ level: 9, inputs: [{ item: 'leather', qty: 2 }, { item: 'thread', qty: 2 }] });
    const w = new GameWorld();
    const p = w.player;
    p.skills.addXp('crafting', xpForLevel(20));
    p.inventory.add('leather_body', 1);
    p.inventory.add('slime_gel', 3);
    w.issue({ type: 'openAnywhere', kind: 'crafting' });
    w.issue({ type: 'craft', recipe: 'sealed_jerkin', count: 1 });
    for (let t = 0; t < 30 * 3; t++) w.tick();
    expect(p.inventory.count('sealed_jerkin')).toBe(1);
    expect(p.inventory.count('leather_body')).toBe(0);
    expect(ITEMS.sealed_jerkin.equip?.armour).toBeGreaterThan(ITEMS.leather_body.equip!.armour!);
  });

  it('furniture has Brightwater names, and finishing materials are checked and used', () => {
    const w = new GameWorld();
    const p = w.player;
    const h = w.hotspots.find((x) => x.def.id === 'bookcase')!;
    p.x = p.prevX = h.x + 1;
    p.z = p.prevZ = h.z;
    p.skills.addXp('construction', xpForLevel(5));
    p.inventory.add('plank', 3);
    p.inventory.add('bronze_nails', 3);
    const sparks = p.inventory.count('air_rune');
    p.inventory.remove('air_rune', sparks);
    expect(w.buildBlocker('bookcase', 'wooden_bookcase')).toBe('You need 2 spark stones.');
    p.inventory.add('air_rune', 2);
    expect(w.buildBlocker('bookcase', 'wooden_bookcase')).toBeNull();
    w.issue({ type: 'build', hotspot: 'bookcase', furniture: 'wooden_bookcase' });
    for (let t = 0; t < 30 * 3; t++) w.tick();
    expect(p.furniture.bookcase).toBe('wooden_bookcase');
    expect(p.inventory.count('air_rune')).toBe(0);
  });

  it('a new fishmonger’s ice chest by the river can be reached and stolen from (Thieving 14)', () => {
    const w = new GameWorld();
    const p = w.player;
    const chest = w.nodes.find((n) => n.def.id === 'ice_chest')!;
    expect(isBlocked(w.map, chest.x + 0.5, chest.z + 1.5)).toBe(false);
    p.skills.addXp('thieving', xpForLevel(14));
    p.x = p.prevX = chest.x + 0.5;
    p.z = p.prevZ = chest.z + 1.5;
    w.issue({ type: 'interact', target: chest.id });
    for (let t = 0; t < 30 * 2; t++) w.tick();
    expect(p.inventory.count('raw_shrimps')).toBe(1);
    expect(p.skills.xp.thieving).toBeGreaterThan(xpForLevel(14));
  });
});

describe('Batch 7b: gems, shrine wisps, Exchange limits, Agility and bows', () => {
  const tick = (w: GameWorld, seconds: number) => {
    for (let t = 0; t < seconds * 30; t++) w.tick();
  };

  it('sapphires carry over as ironcrag garnets; river agate turns up in fishing nets', () => {
    const w = new GameWorld();
    w.player.bank.add('sapphire', 2);
    w.player.bank.add('cut_sapphire', 1);
    const p = new GameWorld({ save: JSON.parse(JSON.stringify(w.save())) as SaveData }).player;
    expect([p.bank.count('sapphire'), p.bank.count('cut_sapphire')]).toEqual([2, 1]);
    expect([ITEMS.sapphire.name, ITEMS.cut_sapphire.name]).toEqual(['Uncut ironcrag garnet', 'Ironcrag garnet']);
    expect(RESOURCES.net_spot.rareDrop).toEqual({ item: 'river_agate', chance: 0.012 });
    expect(RECIPES.polished_agate).toMatchObject({ level: 8, tool: 'chisel', output: { item: 'polished_agate' } });
  });

  it('a faded wisp’s items wait at the shrines and come back for a tenth of their value', () => {
    const w = new GameWorld();
    const p = w.player;
    p.shrineHeld = [{ item: 'iron_sword', qty: 1 }, { item: 'logs', qty: 3 }, { item: 'coins', qty: 40 }];
    const cost = reclaimFee(ITEMS.iron_sword.value) + 3 * reclaimFee(ITEMS.logs.value);
    expect(w.reclaimCost()).toBe(cost + 40);
    w.issue({ type: 'reclaimHeld' });
    expect(p.shrineHeld.length).toBe(3);
    const altar = w.map.checkpoints[0];
    p.x = p.prevX = altar.x + 1;
    p.z = p.prevZ = altar.z;
    p.inventory.remove('coins', p.inventory.count('coins'));
    p.inventory.add('coins', cost);
    w.issue({ type: 'reclaimHeld' });
    expect(p.shrineHeld).toEqual([]);
    expect(p.inventory.count('iron_sword')).toBe(1);
    expect(p.inventory.count('logs')).toBe(3);
    // The coins the wisp carried come back free; the offering was paid from the bag.
    expect(p.inventory.count('coins')).toBe(40);
  });

  it('Agility makes you a little faster (none at level 1, 8% at most)', () => {
    const w = new GameWorld();
    expect(w.playerSpeed()).toBe(PLAYER_SPEED);
    w.player.skills.addXp('agility', xpForLevel(21));
    expect(w.playerSpeed()).toBeCloseTo(PLAYER_SPEED * 1.04);
    w.player.skills.addXp('agility', xpForLevel(80));
    expect(w.playerSpeed()).toBeCloseTo(PLAYER_SPEED * 1.08);
  });

  it('glimsteel-tipped arrows fire from the ammo slot and help only bows; the longbow is fletched from oak', () => {
    const w = new GameWorld();
    const p = w.player;
    p.skills.addXp('ranged', xpForLevel(25));
    p.equipment.slots.ammo = 'glimsteel_arrow';
    p.equipment.ammoQty = 10;
    p.style = 'ranged';
    expect(w.firingAmmo()).toBe('glimsteel_arrow');
    expect(w.ammoLeft()).toBe(10);
    expect(p.equipment.bonuses('ranged').extraPower).toBe(5);
    expect(p.equipment.bonuses('melee').extraPower).toBe(0);
    p.style = 'melee';
    expect(w.firingAmmo()).toBeNull();
    p.skills.addXp('fletching', xpForLevel(24));
    p.inventory.add('oak_logs', 2);
    p.inventory.add('bowstring', 1);
    w.issue({ type: 'openAnywhere', kind: 'fletching' });
    w.issue({ type: 'craft', recipe: 'riverwood_longbow', count: 1 });
    tick(w, 3);
    expect(p.inventory.count('riverwood_longbow')).toBe(1);
  });
});

describe('Originality follow-ups: jewellery, shortcuts and new pickpocket targets', () => {
  const tick = (w: GameWorld, seconds: number) => {
    for (let t = 0; t < seconds * 30; t++) w.tick();
  };
  const place = (w: GameWorld, x: number, z: number) => {
    w.player.x = w.player.prevX = x;
    w.player.z = w.player.prevZ = z;
  };

  it('gem jewellery: an agate charm anywhere, rings and a pendant at the furnace', () => {
    const w = new GameWorld();
    const p = w.player;
    p.skills.addXp('crafting', xpForLevel(30));
    p.inventory.add('polished_agate', 2);
    p.inventory.add('thread', 1);
    p.inventory.add('bronze_bar', 1);
    p.inventory.add('cut_sapphire', 1);
    p.inventory.add('steel_bar', 1);
    w.issue({ type: 'openAnywhere', kind: 'crafting' });
    w.issue({ type: 'craft', recipe: 'agate_charm', count: 1 });
    tick(w, 2.5);
    expect(p.inventory.count('agate_charm')).toBe(1);
    const furnace = w.stations.find((st) => st.kind === 'furnace')!;
    place(w, furnace.x, furnace.z + 1.2);
    w.issue({ type: 'interact', target: furnace.id });
    tick(w, 0.5);
    w.issue({ type: 'craft', recipe: 'agate_ring', count: 1 });
    tick(w, 3);
    w.issue({ type: 'craft', recipe: 'garnet_pendant', count: 1 });
    tick(w, 3);
    expect(p.inventory.count('agate_ring')).toBe(1);
    expect(p.inventory.count('garnet_pendant')).toBe(1);
    expect(ITEMS.garnet_ring.equip).toMatchObject({ slot: 'ring', power: 3 });
    p.equipment.slots.ring = 'garnet_ring';
    expect(p.equipment.bonuses('magic').extraPower).toBe(3);
  });

  it('river shortcuts: gated by Agility, crossed from either side, never break a lap', () => {
    const w = new GameWorld();
    const p = w.player;
    const stones = w.obstacles.find((o) => o.def.id === 'stones')!;
    place(w, stones.def.x1 - 1, stones.def.z1);
    w.drainEvents();
    w.issue({ type: 'interact', target: stones.id });
    expect(w.drainEvents().some((e) => e.type === 'message' && e.text.includes('Agility level 10'))).toBe(true);
    p.skills.addXp('agility', xpForLevel(30));
    (w as unknown as { rng: () => number }).rng = () => 0.99;
    p.lapNext = 2;
    w.issue({ type: 'interact', target: stones.id });
    tick(w, 8);
    expect(Math.hypot(p.x - stones.def.x2, p.z - stones.def.z2)).toBeLessThan(0.05);
    expect(p.lapNext).toBe(2);
    // And back again from the far bank.
    w.issue({ type: 'interact', target: stones.id });
    tick(w, 8);
    expect(Math.hypot(p.x - stones.def.x1, p.z - stones.def.z1)).toBeLessThan(0.05);
    const fallen = w.obstacles.find((o) => o.def.id === 'fallen')!;
    place(w, fallen.def.x2 + 1, fallen.def.z2);
    w.issue({ type: 'interact', target: fallen.id });
    tick(w, 10);
    expect(Math.hypot(p.x - fallen.def.x1, p.z - fallen.def.z1)).toBeLessThan(0.05);
  });

  it('three new pickpocket targets stand somewhere you can reach, with their own levels', () => {
    const w = new GameWorld();
    const p = w.player;
    p.skills.addXp('thieving', xpForLevel(40));
    (w as unknown as { rng: () => number }).rng = () => 0.1;
    for (const [id, level] of [['gambler', 15], ['smuggler', 25], ['quartermaster', 40]] as const) {
      const n = w.npcs.find((x) => x.def.id === id)!;
      expect(n.def.thieving?.level).toBe(level);
      const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ({ x: n.x + dx, z: n.z + dz })).find((s) => !isBlocked(w.map, s.x, s.z));
      expect(spot, id).toBeTruthy();
      place(w, spot!.x, spot!.z);
      p.stunTimer = 0;
      const xp = p.skills.xp.thieving;
      w.issue({ type: 'pickpocket', target: n.id });
      tick(w, 1.5);
      expect(p.skills.xp.thieving - xp, id).toBe(n.def.thieving!.xp);
    }
  });
});
