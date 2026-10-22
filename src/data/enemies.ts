import type { ItemId } from './items';

export type EnemyType = 'slime' | 'wolf' | 'goblin' | 'goblin_warlord' | 'gloom_slime' | 'bog_croaker' | 'mire_leech' | 'bog_mother' | 'bristleback' | 'ridge_stalker' | 'greymane';
export type EnemyModel = 'slime' | 'wolf' | 'goblin' | 'toad' | 'leech' | 'boar';

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
  /** A region's boss: always fights whoever comes near, however strong (and shows larger on the minimap). */
  boss?: boolean;
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
  // Glimmer Hollow: slimes grown fat and dark on glimmerite dust. They wait in the dark.
  gloom_slime: {
    id: 'gloom_slime', name: 'Gloom Slime', level: 14, maxHp: 110, attack: 13, strength: 12, defence: 11, maxHit: 11,
    attackSeconds: 2.2, attackRange: 1.3, aggressive: true, aggroRange: 3.5, leashRange: 8, wanderRadius: 2,
    speed: 2.2, respawnSeconds: 25, model: 'slime', scale: 1.25, color: '#3a4a6a', accent: '#b8f0ff',
    drops: [
      { item: 'slime_gel', min: 2, max: 4, chance: 0.9 },
      { item: 'coins', min: 12, max: 30, chance: 0.7 },
      { item: 'glimmerite_ore', min: 1, max: 1, chance: 0.15 },
      { item: 'cabbage', min: 1, max: 2, chance: 0.2 },
      { item: 'air_rune', min: 4, max: 10, chance: 0.3 },
    ],
  },
  wolf: {
    id: 'wolf', name: 'Timber Wolf', level: 7, maxHp: 60, attack: 8, strength: 7, defence: 6, maxHit: 9,
    attackSeconds: 1.8, attackRange: 1.4, aggressive: true, aggroRange: 5, leashRange: 12, wanderRadius: 5,
    speed: 3.3, respawnSeconds: 15, model: 'wolf', scale: 1, color: '#8b8f99', accent: '#e9e6df',
    drops: [
      { item: 'bones', min: 1, max: 1, chance: 1 },
      { item: 'raw_meat', min: 1, max: 1, chance: 0.7 },
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
    speed: 2.6, respawnSeconds: 60, model: 'goblin', scale: 1.45, color: '#4f7d2e', accent: '#b8322b', boss: true,
    drops: [
      { item: 'big_bones', min: 1, max: 1, chance: 1 },
      { item: 'coins', min: 150, max: 400, chance: 1 },
      { item: 'sapphire', min: 1, max: 2, chance: 0.5 },
      { item: 'glimsteel_arrow', min: 8, max: 20, chance: 0.3 },
      { item: 'bronze_arrow', min: 30, max: 60, chance: 0.6 },
      { item: 'air_rune', min: 30, max: 60, chance: 0.6 },
    ],
  },
  // ---- Mirefen Marsh (Phase 4A, docs/WORLD_EXPANSION.md)
  // Bog croakers: giant marsh toads. Mostly they sit and boom; poke one and it fights back.
  bog_croaker: {
    id: 'bog_croaker', name: 'Bog Croaker', level: 16, maxHp: 130, attack: 15, strength: 14, defence: 13, maxHit: 12,
    attackSeconds: 2.4, attackRange: 1.5, aggressive: false, aggroRange: 0, leashRange: 10, wanderRadius: 4,
    speed: 2.2, respawnSeconds: 20, model: 'toad', scale: 1, color: '#6f8a3a', accent: '#d8d27a',
    drops: [
      { item: 'bones', min: 1, max: 1, chance: 1 },
      { item: 'raw_meat', min: 1, max: 1, chance: 0.5 },
      { item: 'coins', min: 10, max: 28, chance: 0.7 },
      { item: 'slime_gel', min: 1, max: 2, chance: 0.3 },
      { item: 'marsh_pearl', min: 1, max: 1, chance: 0.01 },
    ],
  },
  // Mire leeches: as long as a man, they hunt anything warm that wades into the deep marsh.
  mire_leech: {
    id: 'mire_leech', name: 'Mire Leech', level: 21, maxHp: 150, attack: 20, strength: 18, defence: 15, maxHit: 14,
    attackSeconds: 2.0, attackRange: 1.4, aggressive: true, aggroRange: 4, leashRange: 9, wanderRadius: 3,
    speed: 2.4, respawnSeconds: 22, model: 'leech', scale: 1, color: '#3a3226', accent: '#5e4c34',
    drops: [
      { item: 'mire_oil', min: 1, max: 2, chance: 0.75 },
      { item: 'coins', min: 14, max: 34, chance: 0.7 },
      { item: 'marsh_pearl', min: 1, max: 1, chance: 0.02 },
    ],
  },
  // The Bog Mother: a croaker grown vast and old in the waters round the Sunken Shrine.
  bog_mother: {
    id: 'bog_mother', name: 'The Bog Mother', level: 30, maxHp: 560, attack: 28, strength: 27, defence: 25, maxHit: 22,
    attackSeconds: 2.8, attackRange: 2.2, aggressive: true, aggroRange: 5, leashRange: 9, wanderRadius: 2,
    speed: 2.3, respawnSeconds: 90, model: 'toad', scale: 2.7, color: '#4f6a2c', accent: '#e0c86a', boss: true,
    drops: [
      { item: 'big_bones', min: 1, max: 1, chance: 1 },
      { item: 'coins', min: 220, max: 480, chance: 1 },
      { item: 'marsh_pearl', min: 1, max: 2, chance: 0.6 },
      { item: 'mire_oil', min: 3, max: 6, chance: 0.6 },
      { item: 'raw_silverpike', min: 2, max: 4, chance: 0.4 },
      { item: 'willow_shortbow', min: 1, max: 1, chance: 0.05 },
    ],
  },
  // ---- Thornridge Highlands (Phase 4A, docs/WORLD_EXPANSION.md)
  // Bristleback boars root through the heather. Get too close and they charge.
  bristleback: {
    id: 'bristleback', name: 'Bristleback Boar', level: 24, maxHp: 170, attack: 22, strength: 22, defence: 19, maxHit: 16,
    attackSeconds: 2.2, attackRange: 1.5, aggressive: true, aggroRange: 3, leashRange: 10, wanderRadius: 5,
    speed: 3.1, respawnSeconds: 22, model: 'boar', scale: 1, color: '#6a4a34', accent: '#e8dcc0',
    drops: [
      { item: 'bones', min: 1, max: 1, chance: 1 },
      { item: 'raw_meat', min: 1, max: 2, chance: 0.8 },
      { item: 'boar_hide', min: 1, max: 1, chance: 0.6 },
      { item: 'coins', min: 16, max: 38, chance: 0.7 },
    ],
  },
  // Ridge stalkers: lean grey hunters of the crags, quick and patient.
  ridge_stalker: {
    id: 'ridge_stalker', name: 'Ridge Stalker', level: 32, maxHp: 210, attack: 31, strength: 29, defence: 26, maxHit: 19,
    attackSeconds: 1.8, attackRange: 1.4, aggressive: true, aggroRange: 5, leashRange: 11, wanderRadius: 4,
    speed: 3.5, respawnSeconds: 26, model: 'wolf', scale: 1.15, color: '#9a9ea6', accent: '#d8dce2',
    drops: [
      { item: 'bones', min: 1, max: 1, chance: 1 },
      { item: 'ridge_pelt', min: 1, max: 1, chance: 0.55 },
      { item: 'wolf_fang', min: 1, max: 1, chance: 0.25 },
      { item: 'coins', min: 24, max: 52, chance: 0.7 },
      { item: 'silver_ore', min: 1, max: 1, chance: 0.1 },
    ],
  },
  // Greymane: the stalkers' old pack-leader, denned in the ruins of the Old Watchtower.
  greymane: {
    id: 'greymane', name: 'Greymane', level: 34, maxHp: 620, attack: 33, strength: 32, defence: 29, maxHit: 23,
    attackSeconds: 2.2, attackRange: 1.8, aggressive: true, aggroRange: 6, leashRange: 9, wanderRadius: 2,
    speed: 3.4, respawnSeconds: 90, model: 'wolf', scale: 1.7, color: '#5a5e66', accent: '#eef0f2', boss: true,
    drops: [
      { item: 'big_bones', min: 1, max: 1, chance: 1 },
      { item: 'coins', min: 260, max: 520, chance: 1 },
      { item: 'silver_bar', min: 1, max: 3, chance: 0.6 },
      { item: 'ridge_pelt', min: 2, max: 3, chance: 0.8 },
      { item: 'cut_sapphire', min: 1, max: 1, chance: 0.25 },
    ],
  },
};
