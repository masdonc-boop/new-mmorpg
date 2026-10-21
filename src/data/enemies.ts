import type { ItemId } from './items';

export type EnemyType = 'slime' | 'wolf' | 'goblin' | 'goblin_warlord';
export type EnemyModel = 'slime' | 'wolf' | 'goblin';

export interface DropEntry {
  item: ItemId;
  min: number;
  max: number;
  chance: number;
}

export interface EnemyDef {
  id: EnemyType;
  name: string;
  level: number;
  maxHp: number;
  attack: number;
  strength: number;
  defence: number;
  maxHit: number;
  attackSeconds: number;
  attackRange: number;
  aggressive: boolean;
  aggroRange: number;
  leashRange: number;
  wanderRadius: number;
  speed: number;
  respawnSeconds: number;
  model: EnemyModel;
  scale: number;
  color: string;
  accent: string;
  drops: DropEntry[];
}

export const ENEMIES: Record<EnemyType, EnemyDef> = {
  slime: {
    id: 'slime', name: 'Meadow Slime', level: 2, maxHp: 28, attack: 1, strength: 1, defence: 1, maxHit: 5,
    attackSeconds: 2.2, attackRange: 1.3, aggressive: false, aggroRange: 0, leashRange: 9, wanderRadius: 4,
    speed: 2.0, respawnSeconds: 10, model: 'slime', scale: 1, color: '#62d65a', accent: '#c8ffb8',
    drops: [
      { item: 'slime_gel', min: 1, max: 2, chance: 0.8 },
      { item: 'coins', min: 2, max: 8, chance: 0.6 },
      { item: 'air_rune', min: 2, max: 5, chance: 0.25 },
    ],
  },
  wolf: {
    id: 'wolf', name: 'Timber Wolf', level: 7, maxHp: 60, attack: 8, strength: 7, defence: 6, maxHit: 9,
    attackSeconds: 1.8, attackRange: 1.4, aggressive: true, aggroRange: 5, leashRange: 12, wanderRadius: 5,
    speed: 3.3, respawnSeconds: 15, model: 'wolf', scale: 1, color: '#8b8f99', accent: '#e9e6df',
    drops: [
      { item: 'bones', min: 1, max: 1, chance: 1 },
      { item: 'wolf_pelt', min: 1, max: 1, chance: 0.5 },
      { item: 'wolf_fang', min: 1, max: 1, chance: 0.2 },
      { item: 'coins', min: 5, max: 15, chance: 0.5 },
    ],
  },
  goblin: {
    id: 'goblin', name: 'Goblin Raider', level: 11, maxHp: 90, attack: 12, strength: 11, defence: 10, maxHit: 12,
    attackSeconds: 2.0, attackRange: 1.4, aggressive: true, aggroRange: 6, leashRange: 12, wanderRadius: 3,
    speed: 3.0, respawnSeconds: 18, model: 'goblin', scale: 0.85, color: '#6c9a3c', accent: '#8a5a2b',
    drops: [
      { item: 'bones', min: 1, max: 1, chance: 1 },
      { item: 'coins', min: 10, max: 35, chance: 0.8 },
      { item: 'bronze_arrow', min: 5, max: 15, chance: 0.35 },
      { item: 'air_rune', min: 5, max: 12, chance: 0.35 },
      { item: 'bread', min: 1, max: 1, chance: 0.15 },
    ],
  },
  goblin_warlord: {
    id: 'goblin_warlord', name: 'Grukk the Warlord', level: 24, maxHp: 420, attack: 22, strength: 22, defence: 20, maxHit: 20,
    attackSeconds: 2.6, attackRange: 1.8, aggressive: true, aggroRange: 6, leashRange: 10, wanderRadius: 2,
    speed: 2.6, respawnSeconds: 60, model: 'goblin', scale: 1.45, color: '#4f7d2e', accent: '#b8322b',
    drops: [
      { item: 'bones', min: 1, max: 1, chance: 1 },
      { item: 'coins', min: 150, max: 400, chance: 1 },
      { item: 'sapphire', min: 1, max: 2, chance: 0.5 },
      { item: 'bronze_arrow', min: 30, max: 60, chance: 0.6 },
      { item: 'air_rune', min: 30, max: 60, chance: 0.6 },
    ],
  },
};

export function enemyCombatLevel(def: EnemyDef): number {
  return def.level;
}
