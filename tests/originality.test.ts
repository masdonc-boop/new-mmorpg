import { afterEach, describe, expect, it } from 'vitest';
import { ITEMS } from '../src/data/items';
import { ITEM_ALIASES, remapItemIds } from '../src/data/aliases';
import { GameWorld, type SaveData } from '../src/sim/world';
import { isBlocked } from '../src/sim/worldmap';
import { xpForLevel } from '../src/data/skills';

/** RuneScape-specific names that must not appear in item names (grows with each originality batch). */
const BANNED_ITEM_WORDS = [/platebody/i, /platelegs/i, /\bbig bones\b/i, /\brunes?\b/i];

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
