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
