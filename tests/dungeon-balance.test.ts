import { describe, expect, it } from 'vitest';
import { GameWorld } from '../src/sim/world';
import { xpForLevel } from '../src/data/skills';
import type { ItemId } from '../src/data/items';

function fight(dungeon: 'sunken_shrine' | 'old_watchtower', level: number, gear: ItemId[], style: 'melee' | 'ranged' | 'magic', food = 18) {
  const w = new GameWorld();
  const p = w.player;
  for (const s of ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic'] as const) p.skills.addXp(s, xpForLevel(level));
  p.hp = p.skills.level('hitpoints');
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
  for (; t < 30 * 240 && boss.alive && !p.dead; t++) {
    w.tick();
    if (p.hp < p.skills.level('hitpoints') * 0.5) { const s = p.inventory.slots.findIndex((x) => x?.item === 'silverpike'); if (s >= 0) w.issue({ type: 'useItem', slot: s }); }
    if (!p.action && boss.alive) { const tgt = w.enemies.filter((e) => e.alive && e.state === 'chase').sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0] ?? boss; w.issue({ type: 'interact', target: tgt.id }); }
  }
  return { dungeon, level, style, bossDead: !boss.alive, died: p.dead, secs: Math.round(t / 30), food: p.inventory.count('silverpike') };
}
const melee30: ItemId[] = ['glimsteel_sword', 'glimsteel_helm', 'glimsteel_platebody', 'glimsteel_platelegs', 'glimsteel_shield'];
const ranged30: ItemId[] = ['rowan_shortbow', 'glimsteel_arrow', 'ridgehide_coif', 'ridgehide_body', 'ridgehide_chaps', 'ridgehide_vambraces'];
const magic30: ItemId[] = ['mirelight_wand', 'mireweave_hood', 'mireweave_robe', 'mireweave_skirt'];

/**
 * Balance (docs/DUNGEONS.md): a solo player at the advised level (40 in the combat skills, about combat
 * 46) in tier-30 gear with 18 silverpike clears each boss room, guards and all; a level-30 player
 * can't. Mages manage the Shrinekeeper but should bring friends to the Watchcaptain.
 */
describe('4C.4 dungeon balance (a simulated solo fight in each boss room)', () => {
  for (const d of ['sunken_shrine', 'old_watchtower'] as const) {
    it(`${d}: melee and ranged at the advised level win; a level-30 fighter doesn’t`, () => {
      for (const [style, g] of [['melee', melee30], ['ranged', ranged30]] as const) {
        const r = fight(d, 40, g, style);
        expect(r.bossDead && !r.died, JSON.stringify(r)).toBe(true);
      }
      expect(fight(d, 30, melee30, 'melee').bossDead).toBe(false);
    }, 30_000);
  }
  it('sunken_shrine: a mage at the advised level wins too', () => {
    const r = fight('sunken_shrine', 40, magic30, 'magic');
    expect(r.bossDead && !r.died, JSON.stringify(r)).toBe(true);
  }, 30_000);
});
