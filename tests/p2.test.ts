import { describe, expect, it } from 'vitest';
import { GameWorld, type SaveData } from '../src/sim/world';
import { Inventory } from '../src/sim/inventory';
import { itemDef, type ItemId } from '../src/data/items';
import { xpForLevel } from '../src/data/skills';
import { PRAYERS } from '../src/data/prayers';
import { isBlocked } from '../src/sim/worldmap';

const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds * 30; t++) w.tick();
};
const setRng = (w: GameWorld, v: number) => ((w as unknown as { rng: () => number }).rng = () => v);
const stand = (w: GameWorld, x: number, z: number) => {
  w.player.x = w.player.prevX = x;
  w.player.z = w.player.prevZ = z;
};
const slotOf = (inv: Inventory, item: ItemId) => inv.slots.findIndex((s) => s?.item === item);
const reload = (w: GameWorld) => new GameWorld({ save: JSON.parse(JSON.stringify(w.save())) as SaveData });
const lastMessage = (w: GameWorld) => {
  const m = w.drainEvents().filter((e) => e.type === 'message');
  return m.length ? (m[m.length - 1] as { text: string }).text : '';
};
/** Somewhere quiet, away from the shrine and waystones. */
const away = (w: GameWorld) => stand(w, w.map.spawn.x + 6, w.map.spawn.z + 6);

describe('Prayer', () => {
  it('bones no longer stack, and burying gives Prayer xp (warlord’s bones more), one at a time', () => {
    expect(itemDef('bones').stackable).toBe(false);
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('bones', 2);
    p.inventory.add('big_bones', 1);
    w.issue({ type: 'useItem', slot: slotOf(p.inventory, 'bones') });
    w.issue({ type: 'useItem', slot: slotOf(p.inventory, 'bones') }); // too soon
    expect(p.inventory.count('bones')).toBe(1);
    expect(p.skills.xp.prayer).toBe(4.5);
    run(w, 1.3);
    w.issue({ type: 'useItem', slot: slotOf(p.inventory, 'big_bones') });
    expect(p.skills.xp.prayer).toBe(19.5);
    // Grukk drops warlord's bones.
    expect(Object.values(itemDef('big_bones'))).toBeTruthy();
  });

  it('older saves split a bone stack into slots', () => {
    const w = new GameWorld();
    const save = w.save();
    save.inventory[9] = { item: 'bones', qty: 6 };
    expect(new GameWorld({ save: JSON.parse(JSON.stringify(save)) }).player.inventory.count('bones')).toBe(6);
  });

  it('prayers need the level and points; one prayer per boost; melee and ranged prayers exclude each other', () => {
    const w = new GameWorld();
    const p = w.player;
    w.drainEvents();
    w.issue({ type: 'togglePrayer', prayer: 'rock_skin' });
    expect(lastMessage(w)).toContain('Prayer level 10');
    p.skills.addXp('prayer', xpForLevel(13));
    p.prayerPoints = 13;
    w.issue({ type: 'togglePrayer', prayer: 'thick_skin' });
    w.issue({ type: 'togglePrayer', prayer: 'rock_skin' });
    expect([...p.prayers]).toEqual(['rock_skin']);
    w.issue({ type: 'togglePrayer', prayer: 'burst_of_strength' });
    w.issue({ type: 'togglePrayer', prayer: 'clarity_of_thought' });
    expect(p.prayers.has('burst_of_strength') && p.prayers.has('clarity_of_thought')).toBe(true);
    w.issue({ type: 'togglePrayer', prayer: 'sharp_eye' });
    expect([...p.prayers].sort()).toEqual(['rock_skin', 'sharp_eye']);
    expect(w.prayerBoost('defence')).toBe(1.1);
    expect(w.prayerBoost('ranged')).toBe(1.05);
    expect(w.prayerBoost('attack')).toBe(1);
    w.issue({ type: 'togglePrayer', prayer: 'sharp_eye' });
    expect(p.prayers.has('sharp_eye')).toBe(false);
  });

  it('drains at OSRS rates (Thick Skin: a point every 36 s) and switches off when empty', () => {
    const w = new GameWorld();
    const p = w.player;
    away(w);
    p.skills.addXp('prayer', xpForLevel(2));
    p.prayerPoints = 2;
    w.issue({ type: 'togglePrayer', prayer: 'thick_skin' });
    run(w, 35);
    expect(p.prayerPoints).toBe(2);
    run(w, 2);
    expect(p.prayerPoints).toBe(1);
    run(w, 37);
    expect(p.prayerPoints).toBe(0);
    expect(p.prayers.size).toBe(0);
    w.drainEvents();
    w.issue({ type: 'togglePrayer', prayer: 'thick_skin' });
    expect(lastMessage(w)).toContain('run out of prayer points');
  });

  it('recharges at the shrine or a waystone, not elsewhere; points are saved, prayers are not', () => {
    const w = new GameWorld();
    const p = w.player;
    p.skills.addXp('prayer', xpForLevel(10));
    p.prayerPoints = 3;
    w.issue({ type: 'togglePrayer', prayer: 'thick_skin' });
    const w2 = reload(w);
    expect(w2.player.prayerPoints).toBe(3);
    expect(w2.player.prayers.size).toBe(0);
    away(w2);
    w2.issue({ type: 'pray' });
    expect(w2.player.prayerPoints).toBe(3);
    const shrine = w2.map.checkpoints[0];
    stand(w2, shrine.x + 1.5, shrine.z + 1);
    w2.issue({ type: 'pray' });
    expect(w2.player.prayerPoints).toBe(10);
  });

  it('Protect from Melee blocks creatures’ hits completely', () => {
    const w = new GameWorld();
    const p = w.player;
    p.skills.addXp('prayer', xpForLevel(43));
    p.prayerPoints = 43;
    w.issue({ type: 'togglePrayer', prayer: 'protect_from_melee' });
    const wolf = w.enemies.find((e) => e.def.id === 'wolf')!;
    stand(w, wolf.x + 1, wolf.z);
    if (isBlocked(w.map, p.x, p.z)) stand(w, wolf.x - 1, wolf.z);
    setRng(w, 0); // every enemy swing would hit
    w.drainEvents();
    run(w, 8);
    const hits = w.drainEvents().filter((e) => e.type === 'damage' && e.target === p.id);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((e) => e.type === 'damage' && e.amount === 0)).toBe(true);
    expect(p.hp).toBe(p.maxHp);
  });

  it('Protect Item keeps a fourth item on death; prayers switch off and points refill on respawn', () => {
    const w = new GameWorld();
    const p = w.player;
    p.skills.addXp('prayer', xpForLevel(25));
    p.prayerPoints = 25;
    p.inventory.add('iron_platebody');
    p.inventory.add('iron_sword');
    p.inventory.add('iron_helm');
    p.inventory.add('iron_shield');
    w.issue({ type: 'togglePrayer', prayer: 'protect_item' });
    (w as unknown as { killPlayer: () => void }).killPlayer();
    expect(p.lastDeath?.keep).toBe(4);
    expect(p.lastDeath?.kept.map((k) => k.item).sort()).toEqual(['iron_helm', 'iron_platebody', 'iron_shield', 'iron_sword']);
    expect(p.prayers.size).toBe(0);
    w.issue({ type: 'respawn', at: 'home' });
    expect(p.prayerPoints).toBe(25);
  });

  it('Prayer counts toward combat level (half a level per two prayer levels, as in OSRS)', () => {
    const w = new GameWorld();
    const before = w.player.skills.combatLevel();
    w.player.skills.addXp('prayer', xpForLevel(40));
    expect(w.player.skills.combatLevel()).toBe(before + 5);
    expect(PRAYERS.every((pr) => pr.drain > 0 && pr.level >= 1)).toBe(true);
  });
});

describe('Thieving', () => {
  const npc = (w: GameWorld, id: string) => w.npcs.find((n) => n.def.id === id)!;
  const pick = (w: GameWorld, id: string) => {
    const n = npc(w, id);
    stand(w, n.x + 0.8, n.z);
    w.issue({ type: 'pickpocket', target: n.id });
    run(w, 1);
  };

  it('pickpockets townsfolk for coins and xp', () => {
    const w = new GameWorld();
    const p = w.player;
    const coins = p.inventory.count('coins');
    setRng(w, 0.1);
    pick(w, 'townsman');
    expect(p.inventory.count('coins')).toBe(coins + 3);
    expect(p.skills.xp.thieving).toBe(8);
  });

  it('getting caught hurts and stuns you for 5 seconds: you cannot move', () => {
    const w = new GameWorld();
    const p = w.player;
    setRng(w, 0.99);
    pick(w, 'townswoman');
    expect(p.stunTimer).toBeGreaterThan(4);
    expect(p.hp).toBe(p.maxHp - 10);
    const at = { x: p.x, z: p.z };
    w.issue({ type: 'moveTo', x: p.x + 4, z: p.z });
    run(w, 2);
    expect(Math.hypot(p.x - at.x, p.z - at.z)).toBeLessThan(0.01);
    w.drainEvents();
    w.issue({ type: 'pickpocket', target: npc(w, 'townsman').id });
    expect(lastMessage(w)).toBe("You're stunned!");
    run(w, 3.5);
    expect(p.stunTimer).toBeLessThanOrEqual(0);
  });

  it('Farmer Wren needs Thieving 10 and sometimes has potato seeds; the guard needs 40', () => {
    const w = new GameWorld();
    const p = w.player;
    setRng(w, 0.1);
    w.drainEvents();
    pick(w, 'farmer');
    expect(lastMessage(w)).toContain('Thieving level 10');
    pick(w, 'guard');
    expect(lastMessage(w)).toContain('Thieving level 40');
    p.skills.addXp('thieving', xpForLevel(10));
    // Rolls: success (0.1), then the loot pick lands on the seed (0.9 of the weight), then quantity.
    const seq = [0.1, 0.9, 0.5];
    let i = 0;
    (w as unknown as { rng: () => number }).rng = () => seq[i++ % seq.length];
    pick(w, 'farmer');
    expect(p.inventory.count('potato_seed')).toBe(1);
  });

  it('steals from the bakery stall (Thieving 5); it empties and restocks', () => {
    const w = new GameWorld();
    const p = w.player;
    const stall = w.nodes.find((n) => n.def.id === 'bakery_stall')!;
    expect(stall).toBeTruthy();
    stand(w, stall.x, stall.z + 1.2);
    w.drainEvents();
    w.issue({ type: 'interact', target: stall.id });
    expect(lastMessage(w)).toContain('Thieving level 5 to steal from this bakery stall');
    p.skills.addXp('thieving', xpForLevel(5));
    const bread = p.inventory.count('bread');
    w.issue({ type: 'interact', target: stall.id });
    run(w, 1.5);
    expect(p.inventory.count('bread')).toBe(bread + 1);
    expect(stall.depleted).toBe(true);
    run(w, 3);
    expect(stall.depleted).toBe(false);
  });

  it('the seed stall (27) gives seeds; townsfolk patrol without walking through the fountain', () => {
    const w = new GameWorld();
    const stall = w.nodes.find((n) => n.def.id === 'seed_stall')!;
    expect(stall.def.levelReq).toBe(27);
    for (const id of ['townsman', 'townswoman', 'farmer']) {
      const n = npc(w, id);
      for (let t = 0; t < 30 * 60; t++) {
        w.tick();
        expect(isBlocked(w.map, n.x, n.z), `${id} at ${n.x.toFixed(1)},${n.z.toFixed(1)}`).toBe(false);
      }
    }
  });
});

describe('Agility', () => {
  const cross = (w: GameWorld, i: number) => {
    const o = w.obstacles[i];
    w.issue({ type: 'interact', target: o.id });
    run(w, 8);
  };

  it('every obstacle starts and ends on open ground reachable from the village', () => {
    const w = new GameWorld();
    expect(w.obstacles.length).toBe(5);
    for (const o of w.obstacles) {
      expect(isBlocked(w.map, o.def.x1, o.def.z1), `${o.def.id} start`).toBe(false);
      expect(isBlocked(w.map, o.def.x2, o.def.z2), `${o.def.id} end`).toBe(false);
    }
  });

  it('crossing an obstacle moves you to its end and gives xp; you can’t steer mid-crossing', () => {
    const w = new GameWorld();
    const p = w.player;
    const o = w.obstacles[0];
    stand(w, o.def.x1 - 1, o.def.z1);
    w.issue({ type: 'interact', target: o.id });
    run(w, 1);
    expect(p.action?.type).toBe('obstacle');
    w.issue({ type: 'moveTo', x: p.x, z: p.z + 5 });
    run(w, 4);
    expect(Math.hypot(p.x - o.def.x2, p.z - o.def.z2)).toBeLessThan(0.05);
    expect(p.skills.xp.agility).toBe(7.5);
  });

  it('a full lap in order gives the lap bonus; skipping an obstacle does not', () => {
    const w = new GameWorld();
    const p = w.player;
    setRng(w, 0.99); // never slip
    stand(w, w.obstacles[0].def.x1, w.obstacles[0].def.z1);
    for (let i = 0; i < 5; i++) cross(w, i);
    expect(p.laps).toBe(1);
    expect(p.skills.xp.agility).toBe(7.5 + 8 + 7.5 + 7.5 + 7.5 + 40);
    // Second lap skipping the beam: no bonus.
    for (const i of [0, 1, 2, 4]) cross(w, i);
    expect(p.laps).toBe(1);
    expect(reload(w).player.laps).toBe(1);
  });

  it('you can slip off the balance beam at low level (damage, no xp); never at 16+', () => {
    const w = new GameWorld();
    const p = w.player;
    setRng(w, 0);
    const beam = w.obstacles[3];
    stand(w, beam.def.x1, beam.def.z1);
    w.issue({ type: 'interact', target: beam.id });
    run(w, 3);
    expect(p.action).toBeNull();
    expect(p.skills.xp.agility).toBe(0);
    expect(p.hp).toBe(p.maxHp - 10);
    p.skills.addXp('agility', xpForLevel(16));
    const before = p.skills.xp.agility;
    stand(w, beam.def.x1, beam.def.z1);
    cross(w, 3);
    expect(p.skills.xp.agility).toBe(before + 7.5);
  });
});

describe('Farming', () => {
  /** A world with a controllable real-time clock (farming grows on real time). */
  function farmWorld(save?: SaveData) {
    const t = { now: 1_700_000_000_000 };
    const w = new GameWorld({ save: save ?? null, clock: () => t.now });
    return { w, t };
  }
  const work = (w: GameWorld, i: number, seconds = 8) => {
    const f = w.patches[i];
    stand(w, f.x + 1, f.z);
    w.issue({ type: 'interact', target: f.id });
    run(w, seconds);
  };

  it('has four allotments; new characters carry rake, dibber and spade; old saves get them once', () => {
    const { w } = farmWorld();
    expect(w.patches.length).toBe(4);
    for (const f of w.patches) expect(isBlocked(w.map, f.x + 1, f.z) && isBlocked(w.map, f.x - 1, f.z)).toBe(false);
    for (const t of ['rake', 'seed_dibber', 'spade'] as const) expect(w.player.toolbelt.get(t)).toBe(t);
    const save = w.save();
    for (const t of ['rake', 'seed_dibber', 'spade'] as const) delete save.toolbelt![t];
    save.grants = save.grants!.filter((g) => g !== 'farming-v1');
    const w2 = new GameWorld({ save: JSON.parse(JSON.stringify(save)) });
    expect(w2.player.toolbelt.get('spade')).toBe('spade');
  });

  it('rake, plant, grow on real time (even across a save), then harvest with a spade', () => {
    const { w, t } = farmWorld();
    const p = w.player;
    const f = w.patches[0];
    expect(w.patchState(f).what).toBe('rake');
    work(w, 0);
    expect(f.weeds).toBe(0);
    expect(p.inventory.count('weeds')).toBe(3);
    expect(p.skills.xp.farming).toBe(12);
    p.inventory.add('potato_seed', 4);
    work(w, 0, 2);
    expect(f.crop).toBe('potato');
    expect(p.inventory.count('potato_seed')).toBe(1);
    expect(p.skills.xp.farming).toBe(20);
    expect(w.patchState(f).what).toBe('growing');
    // 25 minutes later (saved and reloaded in between): still growing, stage 3 of 4.
    t.now += 25 * 60_000;
    const { w: w2 } = farmWorld(JSON.parse(JSON.stringify(w.save())));
    (w2 as unknown as { clock: () => number }).clock = () => t.now;
    expect(w2.patches[0].growth(t.now)).toMatchObject({ stage: 2, ready: false });
    t.now += 20 * 60_000;
    expect(w2.patchState(w2.patches[0]).what).toBe('harvest');
    const p2 = w2.player;
    setRng(w2, 0.99); // keep lives for a while
    work(w2, 0, 6);
    expect(p2.inventory.count('potato')).toBeGreaterThanOrEqual(3);
    setRng(w2, 0); // every pick uses a life
    work(w2, 0, 8);
    expect(w2.patches[0].crop).toBeNull();
    expect(w2.patches[0].weeds).toBe(0);
  });

  it('needs the right tools, enough seeds and the level for the crop', () => {
    const { w } = farmWorld();
    const p = w.player;
    const f = w.patches[1];
    f.weeds = 0;
    p.inventory.add('cabbage_seed', 3);
    w.drainEvents();
    work(w, 1, 2);
    expect(lastMessage(w)).toContain('seeds of a crop you can grow');
    p.skills.addXp('farming', xpForLevel(7));
    delete p.toolbelt.slots.seed_dibber;
    work(w, 1, 2);
    expect(lastMessage(w)).toContain('seed dibber');
    p.toolbelt.slots.seed_dibber = 'seed_dibber';
    work(w, 1, 2);
    expect(f.crop).toBe('cabbage');
  });

  it('weeds creep back onto a bare patch over time', () => {
    const { w, t } = farmWorld();
    work(w, 2);
    const f = w.patches[2];
    expect(f.weeds).toBe(0);
    t.now += 11 * 60_000;
    expect(w.patchState(f).what).toBe('rake');
    expect(f.weeds).toBe(2);
  });

  it('potatoes bake on a range (Cooking 7) into food', () => {
    const { w } = farmWorld();
    const p = w.player;
    p.inventory.add('potato', 1);
    p.skills.addXp('cooking', xpForLevel(40));
    const range = w.stations.find((s) => s.kind === 'range')!;
    stand(w, range.x - 1, range.z);
    w.issue({ type: 'interact', target: range.id });
    run(w, 0.5);
    w.issue({ type: 'craft', recipe: 'baked_potato', count: 1 });
    run(w, 2.5);
    expect(p.inventory.count('baked_potato')).toBe(1);
    expect(itemDef('baked_potato').heal).toBe(40);
  });
});

describe('Construction', () => {
  const at = (w: GameWorld, id: string) => {
    const h = w.hotspots.find((x) => x.def.id === id)!;
    stand(w, h.x, h.z + 0.9);
    return h;
  };
  const sawyer = (w: GameWorld) => w.npcs.find((n) => n.def.id === 'sawyer')!;

  it('the house has walls with a door; every space is reachable through it', () => {
    const w = new GameWorld();
    expect(w.hotspots.length).toBe(4);
    for (const h of w.hotspots) expect(isBlocked(w.map, h.x, h.z), h.def.id).toBe(false);
    // The door tile is open and its neighbours in the wall are not.
    expect(isBlocked(w.map, 69.5, 47.5)).toBe(false);
    expect(isBlocked(w.map, 68.5, 47.5)).toBe(true);
    const h = w.hotspots[0];
    w.issue({ type: 'interact', target: h.id });
    run(w, 25);
    expect(w.drainEvents().some((e) => e.type === 'hotspotOpen' && e.hotspot === h.def.id)).toBe(true);
  });

  it('Bertram saws logs into planks (5 coins) and oak logs into oak planks (15)', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('logs', 3);
    const s = sawyer(w);
    stand(w, s.x - 1.2, s.z);
    w.issue({ type: 'interact', target: s.id });
    run(w, 0.5);
    w.issue({ type: 'tan', item: 'logs', qty: 3 });
    // 25 starting coins: 3 planks for 15.
    expect(p.inventory.count('plank')).toBe(3);
    expect(p.inventory.count('coins')).toBe(10);
  });

  it('nails come from the anvil (15 per bar)', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('bronze_bar', 1);
    p.skills.addXp('smithing', xpForLevel(4));
    const anvil = w.stations.find((s) => s.kind === 'anvil')!;
    stand(w, anvil.x - 1, anvil.z);
    w.issue({ type: 'interact', target: anvil.id });
    run(w, 0.3);
    w.issue({ type: 'craft', recipe: 'bronze_nails', count: 1 });
    run(w, 3);
    expect(p.inventory.count('bronze_nails')).toBe(15);
  });

  it('builds a crude chair with planks, nails, a hammer and a saw; remove and rebuild for more xp', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('plank', 4);
    p.inventory.add('bronze_nails', 3);
    p.inventory.add('iron_nails', 5);
    at(w, 'chair');
    w.issue({ type: 'build', hotspot: 'chair', furniture: 'crude_chair' });
    run(w, 3);
    expect(p.furniture.chair).toBe('crude_chair');
    expect(p.skills.xp.construction).toBe(58);
    expect(p.inventory.count('plank')).toBe(2);
    // Bronze nails are used first.
    expect(p.inventory.count('bronze_nails')).toBe(1);
    expect(reload(w).player.furniture.chair).toBe('crude_chair');
    w.issue({ type: 'removeFurniture', hotspot: 'chair' });
    expect(p.furniture.chair).toBeUndefined();
    w.issue({ type: 'build', hotspot: 'chair', furniture: 'crude_chair' });
    run(w, 3);
    expect(p.skills.xp.construction).toBe(116);
    expect(p.inventory.count('bronze_nails')).toBe(0);
    expect(p.inventory.count('iron_nails')).toBe(4);
  });

  it('checks level, tools, materials and that you are beside the space', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('plank', 4);
    p.inventory.add('bronze_nails', 10);
    expect(w.buildBlocker('table', 'wood_table')).toBe('You need to be beside that space.');
    at(w, 'table');
    expect(w.buildBlocker('table', 'wood_table')).toContain('Construction level 10');
    p.skills.addXp('construction', xpForLevel(10));
    delete p.toolbelt.slots.saw;
    expect(w.buildBlocker('table', 'wood_table')).toContain('saw');
    p.toolbelt.slots.saw = 'saw';
    expect(w.buildBlocker('table', 'wood_table')).toBeNull();
    expect(w.buildBlocker('table', 'oak_table')).toContain('Construction level 22');
    expect(w.buildBlocker('table', 'crude_chair')).toBe('You can’t build that there.');
  });
});
