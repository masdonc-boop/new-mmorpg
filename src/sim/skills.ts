import { MAX_XP, SKILL_IDS, defaultSkillXp, levelForXp, type SkillId } from '../data/skills';

export interface XpResult {
  skill: SkillId;
  amount: number;
  oldLevel: number;
  newLevel: number;
}

/** Independent per-skill experience tracking. */
export class Skills {
  readonly xp: Record<SkillId, number>;

  constructor(xp?: Partial<Record<SkillId, number>>) {
    this.xp = defaultSkillXp();
    if (xp) {
      for (const id of SKILL_IDS) {
        const v = xp[id];
        if (typeof v === 'number' && v >= 0) this.xp[id] = Math.min(MAX_XP, v);
      }
    }
  }

  level(skill: SkillId): number {
    return levelForXp(this.xp[skill]);
  }

  addXp(skill: SkillId, amount: number): XpResult {
    const oldLevel = this.level(skill);
    this.xp[skill] = Math.min(MAX_XP, this.xp[skill] + Math.max(0, amount));
    return { skill, amount, oldLevel, newLevel: this.level(skill) };
  }

  totalLevel(): number {
    return SKILL_IDS.reduce((s, id) => s + this.level(id), 0);
  }

  /** Combat level derived from combat skills (simplified classic formula). */
  combatLevel(): number {
    const base = 0.25 * (this.level('defence') + this.level('hitpoints') + Math.floor(this.level('prayer') / 2));
    const melee = 0.325 * (this.level('attack') + this.level('strength'));
    const ranged = 0.325 * Math.floor(this.level('ranged') * 1.5);
    const magic = 0.325 * Math.floor(this.level('magic') * 1.5);
    return Math.floor(base + Math.max(melee, ranged, magic));
  }

  /**
   * How the combat level is made up, for the Skills panel: the base (Defence, Hitpoints and half of
   * Devotion), the best of the three styles, and how many more levels each route needs to raise it.
   */
  combatBreakdown(): { level: number; base: number; style: 'melee' | 'ranged' | 'magic'; next: { skills: SkillId[]; levels: number }[] } {
    const lv = (id: SkillId) => this.level(id);
    const calc = (o: Partial<Record<SkillId, number>>) => {
      const g = (id: SkillId) => o[id] ?? lv(id);
      const base = 0.25 * (g('defence') + g('hitpoints') + Math.floor(g('prayer') / 2));
      const melee = 0.325 * (g('attack') + g('strength'));
      const ranged = 0.325 * Math.floor(g('ranged') * 1.5);
      const magic = 0.325 * Math.floor(g('magic') * 1.5);
      return { level: Math.floor(base + Math.max(melee, ranged, magic)), base, melee, ranged, magic };
    };
    const now = calc({});
    const style = now.melee >= now.ranged && now.melee >= now.magic ? 'melee' : now.ranged >= now.magic ? 'ranged' : 'magic';
    const routes: SkillId[][] = [['attack'], ['strength'], ['defence'], ['hitpoints'], ['ranged'], ['magic']];
    const next: { skills: SkillId[]; levels: number }[] = [];
    if (now.level < calc({ attack: 99, strength: 99, defence: 99, hitpoints: 99, ranged: 99, magic: 99, prayer: 99 }).level) {
      for (const [skill] of routes) {
        for (let n = 1; lv(skill) + n <= 99; n++) {
          if (calc({ [skill]: lv(skill) + n }).level > now.level) {
            next.push({ skills: [skill], levels: n });
            break;
          }
        }
      }
    }
    // Attack and Strength count the same, as do Defence and Hitpoints: list each pair once.
    const merged: { skills: SkillId[]; levels: number }[] = [];
    for (const r of next) {
      const twin = merged.find((m) => m.levels === r.levels && ((m.skills[0] === 'attack' && r.skills[0] === 'strength') || (m.skills[0] === 'defence' && r.skills[0] === 'hitpoints')));
      if (twin) twin.skills.push(r.skills[0]);
      else merged.push({ ...r, skills: [...r.skills] });
    }
    return { level: now.level, base: now.base, style, next: merged.sort((a, b) => a.levels - b.levels) };
  }

  maxHp(): number {
    return this.level('hitpoints') * 10;
  }
}
