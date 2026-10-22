import { describe, expect, it } from 'vitest';
import { GameWorld, type Enemy, type SaveData } from '../src/sim/world';
import { combatXp, TRAINING_FOCUSES } from '../src/sim/combat';
import { validateCommand as parseCommand } from '../src/net/validate';

const run = (w: GameWorld, s: number) => {
  for (let t = 0; t < s * 30; t++) w.tick();
};
const hit = (w: GameWorld, e: Enemy, dmg: number) => (w as unknown as { damageEnemy: (e: Enemy, d: number, hit: boolean, s: string) => void }).damageEnemy(e, dmg, true, w.player.style);

describe('4B.1 combat skills train independently', () => {
  it('the focus directs xp without changing the total', () => {
    const total = (f: (typeof TRAINING_FOCUSES)[number], style: 'melee' | 'ranged' | 'magic') => combatXp(style, 10, f).reduce((a, x) => a + x.amount, 0);
    for (const f of TRAINING_FOCUSES) for (const s of ['melee', 'ranged', 'magic'] as const) expect(total(f, s)).toBeCloseTo(16);
    expect(combatXp('melee', 10, 'accuracy').map((x) => x.skill)).toEqual(['attack', 'hitpoints']);
    expect(combatXp('melee', 10, 'power').map((x) => x.skill)).toEqual(['strength', 'hitpoints']);
    expect(combatXp('melee', 10, 'defence').map((x) => x.skill)).toEqual(['defence', 'hitpoints']);
    expect(combatXp('melee', 10, 'shared').map((x) => x.skill)).toEqual(['attack', 'strength', 'defence', 'hitpoints']);
    expect(combatXp('ranged', 10, 'defence').map((x) => x.skill)).toEqual(['ranged', 'defence', 'hitpoints']);
    expect(combatXp('magic', 10, 'power').map((x) => x.skill)).toEqual(['magic', 'hitpoints']);
  });

  it('fighting with a focus raises only that skill (and Hitpoints); the focus is saved', () => {
    const w = new GameWorld();
    const p = w.player;
    const slime = w.enemies.find((e) => e.def.id === 'slime')!;
    const before = { ...p.skills.xp };
    w.issue({ type: 'setFocus', focus: 'power' });
    hit(w, slime, 5);
    expect(p.skills.xp.strength - before.strength).toBeCloseTo(6);
    expect(p.skills.xp.attack).toBe(before.attack);
    expect(p.skills.xp.defence).toBe(before.defence);
    expect(p.skills.xp.hitpoints - before.hitpoints).toBeCloseTo(2);
    w.issue({ type: 'setStyle', style: 'ranged' });
    w.issue({ type: 'setFocus', focus: 'defence' });
    const r0 = p.skills.xp.ranged;
    const d0 = p.skills.xp.defence;
    hit(w, slime, 5);
    expect(p.skills.xp.ranged - r0).toBeCloseTo(3);
    expect(p.skills.xp.defence - d0).toBeCloseTo(3);
    const save = JSON.parse(JSON.stringify(w.save())) as SaveData;
    expect(new GameWorld({ save, map: w.map }).player.focus).toBe('defence');
    // Older saves (no focus) keep the original shared split.
    delete save.options!.focus;
    expect(new GameWorld({ save, map: w.map }).player.focus).toBe('shared');
    run(w, 0.1);
  });

  it('the server only accepts known focuses', () => {
    expect(parseCommand({ type: 'setFocus', focus: 'power' })).toBeTruthy();
    expect(parseCommand({ type: 'setFocus', focus: 'godlike' })).toBeNull();
  });
});
