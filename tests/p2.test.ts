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
  it('bones no longer stack, and burying gives Prayer xp (big bones more), one at a time', () => {
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
    // Grukk drops big bones.
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
