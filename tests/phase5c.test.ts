import { describe, expect, it } from 'vitest';
import { GameWorld, type Enemy, type GameEvent, type SaveData } from '../src/sim/world';
import { ENEMIES, type EnemyType } from '../src/data/enemies';
import { ITEMS, itemDef, type ItemId } from '../src/data/items';
import { RECIPES } from '../src/data/recipes';
import { SHOPS, sellPrice } from '../src/data/shops';
import { DROP_LOG, DROP_LOG_KEYS, dropRarity } from '../src/data/collection';
import { STYLES, expectedDps } from '../src/sim/combat';
import { INVENTORY_SLOTS } from '../src/sim/inventory';
import { xpForLevel } from '../src/data/skills';

/** Phase 5C: combat rewards and progression (docs/PROGRESSION.md, section 7). */

const kill = (w: GameWorld, e: Enemy) => (w as unknown as { killEnemy: (e: Enemy) => void }).killEnemy(e);
const setRng = (w: GameWorld, f: () => number) => ((w as unknown as { rng: () => number }).rng = f);
const clearGround = (w: GameWorld) => {
  for (const g of w.groundItems) (w as unknown as { byId: Map<number, unknown> }).byId.delete(g.id);
  w.groundItems = [];
};
const enemy = (w: GameWorld, id: EnemyType) => w.enemies.find((x) => x.def.id === id)!;
const value = (id: EnemyType) => ENEMIES[id].drops.reduce((a, d) => a + d.chance * ((d.min + d.max) / 2) * itemDef(d.item).value, 0);

describe('5C loot tables', () => {
  it('drops come out at their listed rates (thousands of seeded kills)', () => {
    const w = new GameWorld();
    const e = enemy(w, 'wolf');
    const n = 6000;
    const counts = new Map<ItemId, number>();
    for (let i = 0; i < n; i++) {
      kill(w, e);
      for (const g of w.groundItems) counts.set(g.item, (counts.get(g.item) ?? 0) + 1);
      clearGround(w);
      w.drainEvents();
    }
    for (const d of ENEMIES.wolf.drops) {
      const got = (counts.get(d.item) ?? 0) / n;
      const sigma = Math.sqrt((d.chance * (1 - d.chance)) / n);
      expect(Math.abs(got - d.chance), `${d.item}: ${got} vs ${d.chance}`).toBeLessThan(5 * sigma + 1e-9);
    }
  });

  it('every creature has its own table, with something useful beyond coins, and gear stays rare', () => {
    const seen = new Set<string>();
    for (const e of Object.values(ENEMIES)) {
      // Elites (5D) deliberately carry their base creature's table (richer); every other table is its own.
      if (e.elite) continue;
      const sig = JSON.stringify(e.drops.map((d) => d.item).sort());
      expect(seen.has(sig), `${e.id} shares a table`).toBe(false);
      seen.add(sig);
      expect(e.drops.some((d) => d.item !== 'coins' && d.item !== 'bones' && d.item !== 'big_bones'), e.id).toBe(true);
      for (const d of e.drops) {
        expect(d.chance, `${e.id} ${d.item}`).toBeGreaterThan(0);
        expect(d.chance, `${e.id} ${d.item}`).toBeLessThanOrEqual(1);
        expect(d.min, `${e.id} ${d.item}`).toBeLessThanOrEqual(d.max);
        // Regular creatures drop gear at 3% or less; regional bosses at 15% or less.
        if (itemDef(d.item).equip && !itemDef(d.item).stackable) expect(d.chance, `${e.id} ${d.item}`).toBeLessThanOrEqual(e.boss ? 0.15 : e.elite ? 0.06 : 0.03);
      }
    }
    // Food or other consumables from the creatures players farm most (sustain in the dungeons).
    for (const id of ['goblin', 'drowned_acolyte', 'drowned_guardian', 'hollow_sentinel', 'forsworn_archer'] as EnemyType[]) {
      expect(ENEMIES[id].drops.some((d) => itemDef(d.item).kind === 'food'), id).toBe(true);
    }
  });

  it('rewards rise with difficulty without flooding the economy', () => {
    const regular = Object.values(ENEMIES).filter((e) => !e.boss).sort((a, b) => a.level - b.level);
    const ladder = regular.filter((e) => !e.elite);
    for (let i = 1; i < ladder.length; i++) expect(value(ladder[i].id), ladder[i].id).toBeGreaterThanOrEqual(value(ladder[i - 1].id) * 0.9);
    for (const e of regular) {
      // Coins per kill stay below 2.5 per creature level (the shops' prices are tens of coins).
      const coins = e.drops.filter((d) => d.item === 'coins').reduce((a, d) => a + d.chance * (d.min + d.max) / 2, 0);
      expect(coins, e.id).toBeLessThan(e.level * 2.5);
      // The expected value of a kill is a small fraction of an hour's crafting income for its tier.
      expect(value(e.id), e.id).toBeLessThan(Math.max(20, e.level * 4));
    }
  });

  it('boss signature rewards are exactly as before 5C (items and rarity)', () => {
    const was: Record<string, string> = {
      goblin_warlord: 'big_bones 1-1 @1|coins 150-400 @1|sapphire 1-2 @0.5|glimsteel_arrow 8-20 @0.3|bronze_arrow 30-60 @0.6|air_rune 30-60 @0.6|steel_sword 1-1 @0.15|steel_platebody 1-1 @0.08',
      bog_mother: 'big_bones 1-1 @1|coins 220-480 @1|marsh_pearl 1-2 @0.6|mire_oil 3-6 @0.6|raw_silverpike 2-4 @0.4|willow_shortbow 1-1 @0.05|mireweave_hood 1-1 @0.12|mirelight_wand 1-1 @0.03',
      greymane: 'big_bones 1-1 @1|coins 260-520 @1|silver_bar 1-3 @0.6|ridge_pelt 2-3 @0.8|cut_sapphire 1-1 @0.25|ridgehide_body 1-1 @0.05|rowan_shortbow 1-1 @0.05|glimsteel_sword 1-1 @0.04',
      shrinekeeper: 'big_bones 1-1 @1|coins 380-700 @1|marsh_pearl 1-1 @0.5',
      watchcaptain: 'big_bones 1-1 @1|coins 420-780 @1|silver_bar 1-2 @0.5',
    };
    for (const [id, table] of Object.entries(was)) expect(ENEMIES[id as EnemyType].drops.map((d) => `${d.item} ${d.min}-${d.max} @${d.chance}`).join('|'), id).toBe(table);
  });

  it('no drop can be sold to a shop for more than a shop sells it (no coin loop from farming shop stock)', () => {
    for (const e of Object.values(ENEMIES)) for (const d of e.drops) for (const s of Object.values(SHOPS)) for (const x of s.stock) if (x.item === d.item) expect(sellPrice(d.item)).toBeLessThanOrEqual(x.price);
  });
});

describe('5C rarity and feedback', () => {
  it('rarity comes from the chance: 3% or less rare, 12% or less uncommon; coins and bones always common', () => {
    expect(dropRarity('iron_dagger', 0.03)).toBe('rare');
    expect(dropRarity('iron_dagger', 0.031)).toBe('uncommon');
    expect(dropRarity('baked_potato', 0.08)).toBe('uncommon');
    expect(dropRarity('slime_gel', 0.8)).toBe('common');
    expect(dropRarity('coins', 0.001)).toBe('common');
    expect(dropRarity('bones', 0.01)).toBe('common');
  });

  it('a rare drop is marked on its pile, announced once, and its pickup says so; common piles stay plain', () => {
    const w = new GameWorld();
    const e = enemy(w, 'bristleback');
    setRng(w, () => 0);
    w.drainEvents();
    kill(w, e);
    const ev = w.drainEvents();
    const helm = w.groundItems.find((g) => g.item === 'steel_helm')!;
    const meat = w.groundItems.find((g) => g.item === 'raw_meat')!;
    expect(helm.rarity).toBe('rare');
    expect(meat.rarity).toBeUndefined();
    // One feedback event for the kill, naming its most notable pile (here a new log find).
    const drops = ev.filter((x): x is Extract<GameEvent, { type: 'drop' }> => x.type === 'drop');
    expect(drops.length).toBe(1);
    expect(drops[0]).toMatchObject({ item: 'steel_helm', rarity: 'rare', logged: true });
    expect(drops[0].ground).toBe(helm.id);
    expect(w.groundItems.find((g) => g.item === 'steel_arrow')!.rarity).toBe('uncommon');
    // One line per find in the log: log finds say so (not also "rare drop").
    const said = ev.filter((x): x is Extract<GameEvent, { type: 'message' }> => x.type === 'message').map((x) => x.text);
    expect(said.filter((t) => t.startsWith('New collection log entry')).length).toBe(2);
    expect(said.filter((t) => t.startsWith('Rare drop')).length).toBe(0);
    // Once logged, the same rare drop is announced as a rare drop, still once per kill.
    for (const g of [...w.groundItems]) if (g !== helm) w.groundItems.splice(w.groundItems.indexOf(g), 1);
    kill(w, e);
    const ev2 = w.drainEvents();
    expect(ev2.filter((x) => x.type === 'drop').length).toBe(1);
    expect(ev2.filter((x) => x.type === 'message' && x.text.startsWith('Rare drop')).length).toBe(2);
    // Picking it up carries the rarity to the toast.
    w.player.x = w.player.prevX = helm.x;
    w.player.z = w.player.prevZ = helm.z;
    w.issue({ type: 'interact', target: helm.id });
    for (let i = 0; i < 10; i++) w.tick();
    const loot = w.drainEvents().find((x): x is Extract<GameEvent, { type: 'loot' }> => x.type === 'loot');
    expect(loot).toMatchObject({ item: 'steel_helm', rarity: 'rare' });
  });

  it('a full bag leaves the rare pile on the ground, still marked and still the player’s', () => {
    const w = new GameWorld();
    const inv = w.player.inventory;
    inv.add('logs', INVENTORY_SLOTS - inv.usedSlots());
    expect(inv.isFull()).toBe(true);
    setRng(w, () => 0);
    kill(w, enemy(w, 'ridge_stalker'));
    const boots = w.groundItems.find((g) => g.item === 'ridgehide_boots')!;
    expect(boots.owner).toBe(w.player.id);
    w.player.x = w.player.prevX = boots.x;
    w.player.z = w.player.prevZ = boots.z;
    w.issue({ type: 'interact', target: boots.id });
    for (let i = 0; i < 10; i++) w.tick();
    expect(inv.count('ridgehide_boots')).toBe(0);
    expect(w.groundItems.includes(boots)).toBe(true);
    expect(boots.rarity).toBe('rare');
    // The rarity survives a save and load of the pile.
    const w2 = new GameWorld({ save: JSON.parse(JSON.stringify(w.save())) as SaveData });
    expect(w2.groundItems.find((g) => g.item === 'ridgehide_boots')?.rarity).toBe('rare');
  });
});

describe('5C creature collection log', () => {
  it('covers the regional bosses’ signature gear and every creature’s rare gear, nothing else', () => {
    const bosses = DROP_LOG.find((g) => g.id === 'bosses')!;
    expect(bosses.rows.map((r) => r.source)).toEqual(['goblin_warlord', 'bog_mother', 'greymane']);
    expect(bosses.rows.find((r) => r.source === 'bog_mother')!.entries.map((x) => x.item)).toEqual(['willow_shortbow', 'mireweave_hood', 'mirelight_wand']);
    const finds = DROP_LOG.find((g) => g.id === 'creatures')!;
    for (const r of finds.rows) {
      expect(ENEMIES[r.source].boss).toBeFalsy();
      for (const x of r.entries) expect(ENEMIES[r.source].drops.find((d) => d.item === x.item)!.chance).toBeLessThanOrEqual(ENEMIES[r.source].elite ? 0.06 : 0.03);
    }
    // The dungeon uniques stay in their own (4D) log; no overlap.
    for (const k of DROP_LOG_KEYS) expect(k).not.toMatch(/^(shrinekeeper|watchcaptain):/);
    expect(DROP_LOG_KEYS.size).toBeGreaterThan(15);
  });

  it('a find is recorded once when it drops (full bag or not), announced once, kept through save and load; junk keys are dropped', () => {
    const w = new GameWorld();
    setRng(w, () => 0);
    const e = enemy(w, 'goblin');
    w.drainEvents();
    kill(w, e);
    const ev = w.drainEvents();
    expect([...w.player.dropLog].sort()).toEqual(['goblin:iron_dagger', 'goblin:iron_helm']);
    expect(ev.filter((x) => x.type === 'drop' && x.logged).length).toBe(1);
    expect(ev.filter((x) => x.type === 'message' && x.text.startsWith('New collection log entry')).length).toBe(2);
    clearGround(w);
    kill(w, e);
    const again = w.drainEvents();
    expect(again.filter((x) => x.type === 'drop' && x.logged).length).toBe(0);
    expect(again.filter((x) => x.type === 'drop').length).toBe(1);
    expect(again.filter((x) => x.type === 'message' && x.text.startsWith('New collection log')).length).toBe(0);
    expect(w.player.dropLog.size).toBe(2);
    const save = JSON.parse(JSON.stringify(w.save())) as SaveData;
    expect(save.dropLog!.sort()).toEqual(['goblin:iron_dagger', 'goblin:iron_helm']);
    save.dropLog!.push('goblin:coins', 'nonsense', 42 as unknown as string, 'shrinekeeper:tidecaller_wand');
    const w2 = new GameWorld({ save });
    expect([...w2.player.dropLog].sort()).toEqual(['goblin:iron_dagger', 'goblin:iron_helm']);
    // Selling or banking the dagger doesn't undo the entry.
    w2.player.inventory.remove('iron_dagger', 99);
    expect(w2.player.dropLog.has('goblin:iron_dagger')).toBe(true);
    // Older saves (no field) start with an empty creature log and keep their dungeon log.
    const old = JSON.parse(JSON.stringify(new GameWorld().save())) as SaveData;
    delete old.dropLog;
    old.dungeons = { log: ['tidecaller_wand'] };
    const w3 = new GameWorld({ save: old });
    expect(w3.player.dropLog.size).toBe(0);
    expect([...w3.player.collectionLog]).toEqual(['tidecaller_wand']);
  });

  it('the same item from another creature is its own entry', () => {
    const w = new GameWorld();
    setRng(w, () => 0);
    kill(w, enemy(w, 'goblin'));
    kill(w, enemy(w, 'bog_croaker'));
    expect(w.player.dropLog.has('goblin:iron_helm')).toBe(true);
    expect(w.player.dropLog.has('bog_croaker:iron_helm')).toBe(true);
  });
});

describe('5C equipment progression', () => {
  it('no style has a gap of more than 15 levels in its weapons up to 45; the oak wand fills magic’s', () => {
    for (const style of ['melee', 'ranged', 'magic'] as const) {
      const lv = [...new Set(Object.values(ITEMS).filter((i) => i.equip?.slot === 'weapon' && i.equip.style === style && (RECIPES[i.id] || i.id === 'shortbow')).map((i) => Math.max(1, ...Object.values(i.equip!.req ?? {}))))].sort((a, b) => a - b);
      for (let k = 1; k < lv.length && lv[k] <= 45; k++) expect(lv[k] - lv[k - 1], `${style}: ${lv[k - 1]} → ${lv[k]}`).toBeLessThanOrEqual(15);
    }
    const oak = itemDef('oak_wand').equip!;
    const at = (id: ItemId, lvl: number) => expectedDps(lvl, itemDef(id).equip!.accuracy!, itemDef(id).equip!.power!, STYLES.magic.attackSeconds);
    expect(at('oak_wand', 12)).toBeGreaterThan(at('riverwood_wand', 12));
    expect(at('emberglass_wand', 25)).toBeGreaterThan(at('oak_wand', 25));
    expect(oak.req).toEqual({ magic: 12 });
    expect(RECIPES.oak_wand).toMatchObject({ skill: 'fletching', level: 14, tool: 'knife' });
    expect(itemDef('oak_wand').value).toBeGreaterThan(itemDef('riverwood_wand').value);
    expect(itemDef('oak_wand').value).toBeLessThan(itemDef('emberglass_wand').value);
  });

  it('crafted gear keeps its place: every drop of gear can also be made (drops are a bonus, not the only route)', () => {
    const made = new Set(Object.values(RECIPES).map((r) => r.output.item));
    for (const e of Object.values(ENEMIES)) {
      for (const d of e.drops) {
        const it = itemDef(d.item);
        if (!it.equip || it.stackable || d.item === 'shortbow') continue;
        expect(made.has(d.item), `${e.id} drops ${d.item}`).toBe(true);
      }
    }
  });

  it('the oak wand is made end to end: oak logs and spark chips, a knife, Fletching 14; wielded at Magic 12', () => {
    const w = new GameWorld();
    const p = w.player;
    p.skills.addXp('fletching', xpForLevel(14));
    p.skills.addXp('magic', xpForLevel(12));
    p.inventory.add('oak_logs', 1);
    p.inventory.add('dull_spark', 6);
    w.issue({ type: 'craft', recipe: 'oak_wand', count: 1 });
    for (let i = 0; i < 90; i++) w.tick();
    expect(p.inventory.count('oak_wand')).toBe(1);
    expect(p.inventory.count('dull_spark')).toBe(0);
    w.issue({ type: 'equip', slot: p.inventory.slots.findIndex((x) => x?.item === 'oak_wand') });
    expect(p.equipment.get('weapon')).toBe('oak_wand');
    expect(p.style).toBe('magic');
  });
});
