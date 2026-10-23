import { describe, expect, it } from 'vitest';
import { GameWorld } from '../src/sim/world';
import { xpForLevel } from '../src/data/skills';
import type { ItemId } from '../src/data/items';

function fight(dungeon: 'sunken_shrine' | 'old_watchtower', level: number, gear: ItemId[], style: 'melee' | 'ranged' | 'magic', food = 18, dodge = true) {
  const w = new GameWorld();
  const p = w.player;
  for (const s of ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic'] as const) p.skills.addXp(s, xpForLevel(level));
  // Full health (Hitpoints level × 10), eating below half. (Before 5D this set health to the level
  // itself, so every fight was fought at a tenth of full health.)
  p.hp = p.skills.maxHp();
  p.inventory.slots.fill(null);
  for (const g of gear) { p.inventory.add(g, g.endsWith('arrow') ? 2000 : 1); w.issue({ type: 'equip', slot: p.inventory.slots.findIndex((x) => x?.item === g) }); }
  if (style === 'magic') p.inventory.add('air_rune', 3000);
  p.inventory.add('silverpike', food);
  w.issue({ type: 'setStyle', style });
  const bossId = dungeon === 'sunken_shrine' ? 'shrinekeeper' : 'watchcaptain';
  const boss = w.enemies.find((e) => e.def.id === bossId)!;
  p.x = p.prevX = boss.x - 3.5; p.z = p.prevZ = boss.z;
  w.issue({ type: 'interact', target: boss.id });
  let t = 0;
  let specialHits = 0;
  let steering = false;
  for (; t < 30 * 240 && boss.alive && !p.dead; t++) {
    w.tick();
    specialHits += w.drainEvents().filter((e) => e.type === 'damage' && e.target === p.id && e.amount > 0 && e.outcome === 'special').length;
    // A player who sees a ring under them steers out of it with the joystick (5D), the way a phone
    // player does: away from its centre, sliding along walls, turning if a corner stops them. With
    // dodge off, they stand and take it.
    const ring = dodge ? w.enemies.find((e) => e.alive && e.special && Math.hypot(p.x - e.special.x, p.z - e.special.z) <= e.special.radius + 0.4) : undefined;
    if (ring?.special) {
      const c = ring.special;
      let best: { dx: number; dz: number; score: number } | null = null;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        // How far out of the ring this way gets in a second of walking (stopping at walls).
        let x = p.x;
        let z = p.z;
        for (let s = 0; s < 8; s++) {
          const nx = x + dx * 0.5;
          const nz = z + dz * 0.5;
          if (w.map.blocked[Math.floor(nz) * w.map.width + Math.floor(nx)]) break;
          x = nx;
          z = nz;
        }
        const score = Math.hypot(x - c.x, z - c.z);
        if (!best || score > best.score) best = { dx, dz, score };
      }
      w.issue({ type: 'joystick', dx: best!.dx, dz: best!.dz });
      steering = true;
      continue;
    }
    if (steering) {
      w.issue({ type: 'joystick', dx: 0, dz: 0 });
      steering = false;
    }
    if (p.hp < p.skills.maxHp() * 0.5) { const s = p.inventory.slots.findIndex((x) => x?.item === 'silverpike'); if (s >= 0) w.issue({ type: 'useItem', slot: s }); }
    if (!p.action && boss.alive) { const tgt = w.enemies.filter((e) => e.alive && e.state === 'chase').sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0] ?? boss; w.issue({ type: 'interact', target: tgt.id }); }
  }
  return { dungeon, level, style, bossDead: !boss.alive, died: p.dead, secs: Math.round(t / 30), food: p.inventory.count('silverpike'), specialHits };
}
const melee30: ItemId[] = ['glimsteel_sword', 'glimsteel_helm', 'glimsteel_platebody', 'glimsteel_platelegs', 'glimsteel_shield'];
const ranged30: ItemId[] = ['rowan_shortbow', 'glimsteel_arrow', 'ridgehide_coif', 'ridgehide_body', 'ridgehide_chaps', 'ridgehide_vambraces'];
const magic30: ItemId[] = ['mirelight_wand', 'mireweave_hood', 'mireweave_robe', 'mireweave_skirt'];

/**
 * Balance (docs/DUNGEONS.md, updated in 5D): from full health (the bot before 5D started at a tenth of
 * it), a solo player at the advised level (40 in the combat skills, about combat 46) in tier-30 gear
 * clears each boss room, guards and all, even standing in every special; at the door's minimum (30)
 * it takes a full bag of food, and without food it fails; at 25 it fails. Stepping out of the rings
 * saves food. Mages manage the Shrinekeeper but should bring friends to the Watchcaptain.
 */
describe('4C.4/5D dungeon balance (a simulated solo fight in each boss room)', () => {
  for (const d of ['sunken_shrine', 'old_watchtower'] as const) {
    it(`${d}: the advised level wins with melee and ranged, even standing in the specials; level 25, or 30 without food, doesn’t`, () => {
      for (const [style, g] of [['melee', melee30], ['ranged', ranged30]] as const) {
        const r = fight(d, 40, g, style, 18, false);
        expect(r.bossDead && !r.died, JSON.stringify(r)).toBe(true);
      }
      expect(fight(d, 25, melee30, 'melee').bossDead).toBe(false);
      expect(fight(d, 30, melee30, 'melee', 0).bossDead).toBe(false);
    }, 60_000);
    it(`${d}: the specials can be stepped out of in time`, () => {
      const stand = fight(d, 40, melee30, 'melee', 18, false);
      const dodge = fight(d, 40, melee30, 'melee', 18, true);
      expect(dodge.bossDead && !dodge.died, JSON.stringify(dodge)).toBe(true);
      expect(stand.specialHits, JSON.stringify(stand)).toBeGreaterThanOrEqual(2);
      // A simple scripted dodger (a greedy one-second look-ahead) escapes nearly every one; it can be
      // caught once when the boss pins it against a wall beside the chest, which a person reads better.
      expect(dodge.specialHits, JSON.stringify({ stand, dodge })).toBeLessThanOrEqual(1);
      expect(dodge.specialHits, JSON.stringify({ stand, dodge })).toBeLessThanOrEqual(stand.specialHits * 0.3);
    }, 60_000);
  }
  it('sunken_shrine: a mage at the advised level wins too', () => {
    const r = fight('sunken_shrine', 40, magic30, 'magic');
    expect(r.bossDead && !r.died, JSON.stringify(r)).toBe(true);
  }, 30_000);
});
