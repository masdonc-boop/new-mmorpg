import { describe, expect, it } from 'vitest';
import { GameWorld, type GameEvent } from '../src/sim/world';
import { INVENTORY_SLOTS, Inventory } from '../src/sim/inventory';
import { COIN_STACK, ITEMS, dropNeedsConfirm, itemDef, type ItemId } from '../src/data/items';
import { RESOURCES } from '../src/data/resources';
import { isBlocked } from '../src/sim/worldmap';

const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds * 30; t++) w.tick();
};

/** Total quantity of every item, inventory and held overflow included. */
const totals = (w: GameWorld) => {
  const t: Record<string, number> = {};
  for (const s of w.player.inventory.slots) if (s) t[s.item] = (t[s.item] ?? 0) + s.qty;
  for (const o of w.player.overflow) t[o.item] = (t[o.item] ?? 0) + o.qty;
  return t;
};

/** A world with the player standing next to a node of `type`, and a fixed roll value. */
function atNode(type: keyof typeof RESOURCES, roll: number) {
  const w = new GameWorld();
  (w as unknown as { rng: () => number }).rng = () => roll;
  const p = w.player;
  for (const n of w.nodes) {
    if (n.def.id !== type) continue;
    for (const [dx, dz] of [[1.1, 0], [-1.1, 0], [0, 1.1], [0, -1.1]]) {
      if (isBlocked(w.map, n.x + dx, n.z + dz)) continue;
      p.x = p.prevX = n.x + dx;
      p.z = p.prevZ = n.z + dz;
      return { w, p, node: n };
    }
  }
  throw new Error('no reachable node');
}

/** Fill free slots with bread until `used` slots are occupied. */
function fillTo(w: GameWorld, used: number) {
  const inv = w.player.inventory;
  inv.add('bread', used - inv.usedSlots());
  expect(inv.usedSlots()).toBe(used);
}

const fullEvents = (events: GameEvent[]) => events.filter((e) => e.type === 'inventoryFull').length;
const fullMessages = (events: GameEvent[]) => events.filter((e) => e.type === 'message' && e.text === 'Your inventory is full.').length;

describe('Item definitions', () => {
  it('makes primary gathered resources non-stackable and keeps ammo, runes and coins stackable', () => {
    for (const r of Object.values(RESOURCES)) {
      // Stall loot isn't a gathered resource (seeds stack, as in OSRS).
      if (r.skill === 'thieving') continue;
      expect(itemDef(r.item).stackable).toBe(false);
      if (r.rareDrop) expect(itemDef(r.rareDrop.item).stackable).toBe(false);
    }
    for (const id of ['coins', 'bronze_arrow', 'air_rune'] as ItemId[]) expect(itemDef(id).stackable).toBe(true);
    for (const d of Object.values(ITEMS)) expect(d.maxStack, d.id).toBe(d.id === 'coins' ? COIN_STACK : d.stackable ? 99_999 : 1);
  });

  it('asks before dropping tools and valuable items but not cheap ones', () => {
    expect(dropNeedsConfirm('bronze_axe', 1)).toBe(true);
    expect(dropNeedsConfirm('sapphire', 1)).toBe(true);
    expect(dropNeedsConfirm('iron_ore', 1)).toBe(true);
    expect(dropNeedsConfirm('logs', 1)).toBe(false);
    expect(dropNeedsConfirm('coins', 25)).toBe(false);
    expect(dropNeedsConfirm('coins', 500)).toBe(true);
  });
});

describe('Gathering with inventory capacity', () => {
  it('fills one slot per log from an empty inventory', () => {
    const { w, p, node } = atNode('tree', 0.5); // succeeds, never depletes
    p.inventory = new Inventory();
    p.inventory.add('bronze_axe');
    w.issue({ type: 'interact', target: node.id });
    run(w, 1.8 * 3 + 0.5);
    expect(p.inventory.count('logs')).toBe(3);
    expect(p.inventory.usedSlots()).toBe(4);
    expect(p.inventory.slots.filter((s) => s?.item === 'logs').every((s) => s!.qty === 1)).toBe(true);
    expect(p.skills.xp.woodcutting).toBe(3 * RESOURCES.tree.xp);
  });

  it('at 27/28 awards exactly one item, then stops with a full message', () => {
    const { w, p, node } = atNode('tree', 0.5);
    fillTo(w, INVENTORY_SLOTS - 1);
    w.drainEvents();
    w.issue({ type: 'interact', target: node.id });
    run(w, 10);
    const ev = w.drainEvents();
    expect(p.inventory.count('logs')).toBe(1);
    expect(p.inventory.isFull()).toBe(true);
    expect(p.skills.xp.woodcutting).toBe(RESOURCES.tree.xp);
    expect(p.action).toBeNull();
    expect(fullMessages(ev)).toBe(1);
    expect(fullEvents(ev)).toBe(1);
    expect(ev.filter((e) => e.type === 'gather').length).toBe(1);
  });

  it('at 28/28 awards nothing, grants no xp, never depletes the node and does not start', () => {
    // roll 0: every attempt would succeed, find a gem and deplete the rock if it were allowed.
    const { w, p, node } = atNode('copper_rock', 0);
    fillTo(w, INVENTORY_SLOTS);
    const before = totals(w);
    w.drainEvents();
    w.issue({ type: 'interact', target: node.id });
    expect(p.action).toBeNull();
    // Even if an action is already running (e.g. auto-continue), the next attempt is refused.
    p.action = { type: 'gather', node: node.id };
    run(w, 10);
    const ev = w.drainEvents();
    expect(totals(w)).toEqual(before);
    expect(p.skills.xp.mining ?? 0).toBe(0);
    expect(node.depleted).toBe(false);
    expect(p.action).toBeNull();
    expect(ev.some((e) => e.type === 'gather' || e.type === 'nodeDepleted' || e.type === 'xp')).toBe(false);
    expect(fullMessages(ev)).toBeGreaterThanOrEqual(1);
  });

  it('does not auto-continue to the next rock when the last slot was just filled', () => {
    const { w, p, node } = atNode('copper_rock', 0); // succeeds and depletes every time
    fillTo(w, INVENTORY_SLOTS - 1);
    w.issue({ type: 'interact', target: node.id });
    run(w, 6);
    expect(node.depleted).toBe(true);
    expect(p.inventory.count('copper_ore')).toBe(1);
    // The rare gem rolled too, but there was no room: it is not awarded and nothing overflows.
    expect(p.inventory.count('sapphire')).toBe(0);
    expect(p.action).toBeNull();
  });

  it('resumes normally once space is freed by dropping one item', () => {
    const { w, p, node } = atNode('tree', 0.5);
    fillTo(w, INVENTORY_SLOTS);
    w.issue({ type: 'interact', target: node.id });
    expect(p.action).toBeNull();
    const breadSlot = p.inventory.slots.findIndex((s) => s?.item === 'bread');
    w.issue({ type: 'dropItem', slot: breadSlot });
    expect(p.inventory.freeSlots()).toBe(1);
    w.issue({ type: 'interact', target: node.id });
    run(w, 6);
    expect(p.inventory.count('logs')).toBe(1);
    expect(p.inventory.isFull()).toBe(true);
  });

  it('keeps adding to existing stacks (coins) when every slot is used', () => {
    const { w, p } = atNode('tree', 0.5);
    fillTo(w, INVENTORY_SLOTS);
    expect(w.giveItem('coins', 10)).toBe(10);
    expect(w.giveItem('logs', 1)).toBe(0);
    expect(p.inventory.isFull()).toBe(true);
  });

  it('repeated gathering with drops neither duplicates nor loses items', () => {
    const { w, p, node } = atNode('tree', 0.5);
    let gained = 0;
    let dropped = 0;
    w.issue({ type: 'interact', target: node.id });
    for (let step = 0; step < 120; step++) {
      run(w, 0.5);
      for (const e of w.drainEvents()) if (e.type === 'loot') gained += e.qty;
      if (step % 7 === 0) {
        const i = p.inventory.slots.findIndex((s) => s?.item === 'logs');
        if (i >= 0) {
          w.issue({ type: 'dropItem', slot: i });
          dropped++;
        }
      }
      if (step % 5 === 0) w.issue({ type: 'swapItems', a: step % 28, b: (step * 3) % 28 });
      if (!p.action) w.issue({ type: 'interact', target: node.id });
      expect(p.inventory.usedSlots()).toBeLessThanOrEqual(INVENTORY_SLOTS);
    }
    expect(gained).toBeGreaterThan(20);
    expect(p.inventory.count('logs')).toBe(gained - dropped);
    expect(p.skills.xp.woodcutting).toBe(gained * RESOURCES.tree.xp);
  });
});

describe('Dropping', () => {
  it('dropping one non-stackable resource frees exactly one slot', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('logs', 5);
    const used = p.inventory.usedSlots();
    const i = p.inventory.slots.findIndex((s) => s?.item === 'logs');
    w.issue({ type: 'dropItem', slot: i });
    expect(p.inventory.usedSlots()).toBe(used - 1);
    expect(p.inventory.count('logs')).toBe(4);
    // Invalid slots are ignored.
    w.issue({ type: 'dropItem', slot: 99 });
    w.issue({ type: 'dropItem', slot: -1 });
    w.issue({ type: 'dropItem', slot: 1.5 });
    expect(p.inventory.usedSlots()).toBe(used - 1);
  });
});

describe('Saving, loading and migration', () => {
  it('round-trips a mixed inventory exactly', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('logs', 4);
    p.inventory.add('copper_ore', 3);
    p.inventory.add('coins', 75);
    p.inventory.swap(0, 20);
    const save = JSON.parse(JSON.stringify(w.save()));
    const w2 = new GameWorld({ save });
    expect(w2.player.inventory.toJSON()).toEqual(p.inventory.toJSON());
    expect(w2.player.overflow).toEqual([]);
    // Moving to another region and saving again changes nothing.
    w2.player.x = w2.map.spawn.x + 30;
    const w3 = new GameWorld({ save: JSON.parse(JSON.stringify(w2.save())) });
    expect(w3.player.inventory.toJSON()).toEqual(p.inventory.toJSON());
  });

  it('splits old resource stacks into single slots and holds what cannot fit instead of deleting it', () => {
    const w = new GameWorld();
    const save = w.save();
    // An older save: 40 logs and 9 ore stacked in single slots, plus the starter kit.
    save.inventory = [...save.inventory];
    save.inventory[10] = { item: 'logs', qty: 40 };
    save.inventory[11] = { item: 'copper_ore', qty: 9 };
    const expected = totals(w);
    expected.logs = 40;
    expected.copper_ore = 9;
    const w2 = new GameWorld({ save: JSON.parse(JSON.stringify(save)) });
    const p = w2.player;
    expect(totals(w2)).toEqual(expected);
    expect(p.inventory.isFull()).toBe(true);
    expect(p.inventory.slots.every((s) => !s || itemDef(s.item).stackable || s.qty === 1)).toBe(true);
    const held = p.overflow.reduce((a, o) => a + o.qty, 0);
    expect(held).toBeGreaterThan(0);
    expect(w2.drainEvents().some((e) => e.type === 'message' && e.text.includes('held for you'))).toBe(true);

    // Held items survive another save/load.
    const w3 = new GameWorld({ save: JSON.parse(JSON.stringify(w2.save())) });
    expect(totals(w3)).toEqual(expected);

    // Claiming with a full bag moves nothing; after dropping 3 items, exactly 3 come across.
    w3.issue({ type: 'claimOverflow' });
    expect(totals(w3)).toEqual(expected);
    for (let k = 0; k < 3; k++) {
      const i = w3.player.inventory.slots.findIndex((s) => s?.item === 'logs');
      w3.issue({ type: 'dropItem', slot: i });
    }
    w3.issue({ type: 'claimOverflow' });
    expected.logs -= 3;
    expect(totals(w3)).toEqual(expected);
    expect(w3.player.overflow.reduce((a, o) => a + o.qty, 0)).toBe(held - 3);
    expect(w3.player.inventory.isFull()).toBe(true);

    // Discarding held items is explicit.
    w3.issue({ type: 'discardOverflow' });
    expect(w3.player.overflow).toEqual([]);
  });

  it('ignores corrupt or unknown saved entries without affecting valid ones', () => {
    const r = Inventory.restore([
      { item: 'logs', qty: 2 },
      { item: 'nope' as ItemId, qty: 5 },
      { item: 'coins', qty: -4 },
      { item: 'bread', qty: Number.NaN },
      null,
      { item: 'coins', qty: 12.7 },
    ]);
    expect(r.inventory.count('logs')).toBe(2);
    expect(r.inventory.count('coins')).toBe(12);
    expect(r.inventory.count('bread')).toBe(0);
    expect(r.inventory.usedSlots()).toBe(3);
    expect(r.overflow).toEqual([]);
  });
});

describe('Quest rewards respect capacity', () => {
  it('holds the final turn-in until the rewards fit, then pays out once', () => {
    const w = new GameWorld();
    const p = w.player;
    const elder = w.npcs.find((n) => n.def.id === 'elder')!;
    p.quests.elders_request = { stage: 2, kills: 3, done: false };
    fillTo(w, INVENTORY_SLOTS);
    // Remove the starter bread/arrows/runes stacks' room: every slot is now taken, and the reward
    // includes 3 bread which need 3 free slots.
    p.x = p.prevX = elder.x + 1;
    p.z = p.prevZ = elder.z + 1;
    w.issue({ type: 'interact', target: elder.id });
    run(w, 2);
    expect(w.questProgress('elders_request')?.done).toBe(false);
    expect(w.drainEvents().some((e) => e.type === 'inventoryFull')).toBe(true);
    const coins = p.inventory.count('coins');
    // The reward needs 3 slots for bread and 1 for the arrows (worn arrows don't share a bag stack).
    for (let k = 0; k < 4; k++) {
      const i = p.inventory.slots.findIndex((s) => s?.item === 'bread');
      w.issue({ type: 'dropItem', slot: i });
    }
    w.issue({ type: 'interact', target: elder.id });
    run(w, 2);
    expect(w.questProgress('elders_request')?.done).toBe(true);
    expect(p.inventory.count('coins')).toBe(coins + 250);
    expect(p.inventory.isFull()).toBe(true);
  });
});
