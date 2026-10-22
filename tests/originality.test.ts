import { afterEach, describe, expect, it } from 'vitest';
import { ITEMS } from '../src/data/items';
import { ITEM_ALIASES, remapItemIds } from '../src/data/aliases';
import { GameWorld, type SaveData } from '../src/sim/world';

/** RuneScape-specific names that must not appear in item names (grows with each originality batch). */
const BANNED_ITEM_WORDS = [/platebody/i, /platelegs/i, /\bbig bones\b/i];

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
