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
    const base = 0.25 * (this.level('defence') + this.level('hitpoints'));
    const melee = 0.325 * (this.level('attack') + this.level('strength'));
    const ranged = 0.325 * Math.floor(this.level('ranged') * 1.5);
    const magic = 0.325 * Math.floor(this.level('magic') * 1.5);
    return Math.floor(base + Math.max(melee, ranged, magic));
  }

  maxHp(): number {
    return this.level('hitpoints') * 10;
  }
}
