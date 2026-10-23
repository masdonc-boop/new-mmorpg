import { ITEMS, type ItemId } from './items';

const itemIsGear = (id: ItemId) => { const d = ITEMS[id] as { equip?: unknown; stackable: boolean }; return !!d.equip && !d.stackable; };

export type EnemyType = 'slime' | 'wolf' | 'goblin' | 'goblin_warlord' | 'gloom_slime' | 'bog_croaker' | 'mire_leech' | 'bog_mother' | 'bristleback' | 'ridge_stalker' | 'greymane'
  // Dungeons (Phase 4C)
  | 'drowned_acolyte' | 'drowned_guardian' | 'shrinekeeper' | 'hollow_sentinel' | 'forsworn_archer' | 'watchcaptain'
  // Elites (Phase 5D): tougher variants of existing creatures, one ability each
  | 'ironhide_bristleback' | 'drowned_tidecaller' | 'forsworn_marksman';
export type EnemyModel = 'slime' | 'wolf' | 'goblin' | 'toad' | 'leech' | 'boar' | 'humanoid';

export interface DropEntry {
  item: ItemId;
  min: number;
  max: number;
  chance: number;
}

/**
 * A telegraphed special attack (Phase 5D, docs/COMBAT.md). A ring marks the ground for `windup`
 * seconds; then everyone still inside takes the hit. Stepping out avoids it.
 * - `slam`: the ring is under the target where it stood when the wind-up began.
 * - `sweep`: the ring is round the creature itself (back off to dodge).
 * - `charge`: the creature rushes to the marked spot and strikes there.
 */
export interface SpecialDef {
  kind: 'slam' | 'sweep' | 'charge';
  name: string;
  windup: number;
  radius: number;
  /** Damage as a multiple of the creature's max hit (no accuracy roll: dodging is the defence). */
  damage: number;
  cooldown: number;
  /** Begins only with its target this close. */
  range: number;
  /** Also slows those it hits. */
  slow?: { factor: number; seconds: number };
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
  /**
   * How it attacks (default melee). Ranged and magic creatures strike from `attackRange` with a
   * visible missile; magic is defended with Defence and Magic together (docs/DUNGEONS.md).
   */
  attackStyle?: 'melee' | 'ranged' | 'magic';
  /** Humanoid creatures: their looks and what they carry. */
  look?: { skin: string; hair: string; tunic: string; trousers: string; robe?: boolean; helmet?: boolean; cape?: string; beard?: boolean };
  tool?: 'sword' | 'spear' | 'club' | 'bow' | 'wand';
  /**
   * Bosses: below this share of their hitpoints they enrage, attacking this much faster
   * (attackSeconds is divided by `enrage.speed`).
   */
  enrage?: { below: number; speed: number };
  /** Calls every creature within this many tiles to its side when it is attacked (a boss's guards). */
  rally?: number;
  // ---- Phase 5D behaviours (docs/COMBAT.md); each creature has at most a couple.
  /** Pack: when it joins a fight, up to `max` idle creatures of its kind within `radius` join too. */
  pack?: { radius: number; max: number };
  /** Ranged: backs away from its target when closer than this (it keeps shooting). */
  kite?: number;
  /** Below this share of hitpoints it breaks off once for `seconds`, and calls one of its kind to help. */
  retreat?: { below: number; seconds: number };
  /** Its hits sometimes slow the player (movement only). */
  slowOnHit?: { chance: number; factor: number; seconds: number };
  /** One telegraphed special attack. */
  special?: SpecialDef;
  /** An elite variant of another creature (named, tougher, rarer; same model and loot family). */
  elite?: { of: EnemyType };
}

type BaseType = Exclude<EnemyType, 'ironhide_bristleback' | 'drowned_tidecaller' | 'forsworn_marksman'>;

const BASE: Record<BaseType, EnemyDef> = {
  slime: {
    id: 'slime', name: 'Meadow Slime', level: 2, maxHp: 28, attack: 1, strength: 1, defence: 1, maxHit: 5,
    attackSeconds: 2.2, attackRange: 1.3, aggressive: false, aggroRange: 0, leashRange: 9, wanderRadius: 4,
    speed: 2.0, respawnSeconds: 10, model: 'slime', scale: 1, color: '#62d65a', accent: '#c8ffb8',
    drops: [
      { item: 'slime_gel', min: 1, max: 2, chance: 0.8 },
      { item: 'coins', min: 2, max: 8, chance: 0.6 },
      { item: 'air_rune', min: 2, max: 5, chance: 0.25 },
      { item: 'potato_seed', min: 1, max: 2, chance: 0.08 },
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
      { item: 'dull_spark', min: 4, max: 8, chance: 0.3 },
      { item: 'iron_ore', min: 1, max: 1, chance: 0.15 },
    ],
  },
  wolf: {
    id: 'wolf', name: 'Timber Wolf', level: 7, maxHp: 60, attack: 8, strength: 7, defence: 6, maxHit: 9,
    attackSeconds: 1.8, attackRange: 1.4, aggressive: true, aggroRange: 5, leashRange: 12, wanderRadius: 5,
    speed: 3.3, respawnSeconds: 15, model: 'wolf', scale: 1, color: '#8b8f99', accent: '#e9e6df',
    pack: { radius: 4, max: 1 },
    drops: [
      { item: 'bones', min: 1, max: 1, chance: 1 },
      { item: 'raw_meat', min: 1, max: 1, chance: 0.7 },
      { item: 'wolf_pelt', min: 1, max: 1, chance: 0.5 },
      { item: 'wolf_fang', min: 1, max: 1, chance: 0.2 },
      { item: 'coins', min: 5, max: 15, chance: 0.5 },
      { item: 'bronze_helm', min: 1, max: 1, chance: 0.03 },
      { item: 'leather_boots', min: 1, max: 1, chance: 0.02 },
    ],
  },
  goblin: {
    id: 'goblin', name: 'Goblin Raider', level: 11, maxHp: 90, attack: 12, strength: 11, defence: 10, maxHit: 12,
    attackSeconds: 2.0, attackRange: 1.4, aggressive: true, aggroRange: 6, leashRange: 12, wanderRadius: 3,
    speed: 3.0, respawnSeconds: 18, model: 'goblin', scale: 0.85, color: '#6c9a3c', accent: '#8a5a2b',
    retreat: { below: 0.25, seconds: 3 },
    drops: [
      { item: 'bones', min: 1, max: 1, chance: 1 },
      { item: 'coins', min: 10, max: 35, chance: 0.8 },
      { item: 'bronze_arrow', min: 5, max: 15, chance: 0.35 },
      { item: 'air_rune', min: 5, max: 12, chance: 0.35 },
      { item: 'bread', min: 1, max: 1, chance: 0.15 },
      { item: 'iron_arrow', min: 5, max: 10, chance: 0.15 },
      { item: 'iron_dagger', min: 1, max: 1, chance: 0.03 },
      { item: 'iron_helm', min: 1, max: 1, chance: 0.02 },
      { item: 'baked_potato', min: 1, max: 1, chance: 0.08 },
    ],
  },
  goblin_warlord: {
    id: 'goblin_warlord', name: 'Grukk the Warlord', level: 24, maxHp: 420, attack: 22, strength: 22, defence: 20, maxHit: 20,
    attackSeconds: 2.6, attackRange: 1.8, aggressive: true, aggroRange: 6, leashRange: 10, wanderRadius: 2,
    speed: 2.6, respawnSeconds: 60, model: 'goblin', scale: 1.45, color: '#4f7d2e', accent: '#b8322b', boss: true,
    special: { kind: 'slam', name: 'Club slam', windup: 1.6, radius: 1.8, damage: 1.4, cooldown: 12, range: 3 },
    drops: [
      { item: 'big_bones', min: 1, max: 1, chance: 1 },
      { item: 'coins', min: 150, max: 400, chance: 1 },
      { item: 'sapphire', min: 1, max: 2, chance: 0.5 },
      { item: 'glimsteel_arrow', min: 8, max: 20, chance: 0.3 },
      { item: 'bronze_arrow', min: 30, max: 60, chance: 0.6 },
      { item: 'air_rune', min: 30, max: 60, chance: 0.6 },
      { item: 'steel_sword', min: 1, max: 1, chance: 0.15 },
      { item: 'steel_platebody', min: 1, max: 1, chance: 0.08 },
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
      { item: 'coins', min: 24, max: 50, chance: 0.8 },
      { item: 'slime_gel', min: 1, max: 2, chance: 0.3 },
      { item: 'marsh_pearl', min: 1, max: 1, chance: 0.01 },
      { item: 'iron_arrow', min: 4, max: 10, chance: 0.15 },
      { item: 'linen', min: 1, max: 1, chance: 0.1 },
      { item: 'flax', min: 1, max: 2, chance: 0.1 },
      { item: 'iron_helm', min: 1, max: 1, chance: 0.02 },
    ],
  },
  // Mire leeches: as long as a man, they hunt anything warm that wades into the deep marsh.
  mire_leech: {
    id: 'mire_leech', name: 'Mire Leech', level: 21, maxHp: 150, attack: 20, strength: 18, defence: 15, maxHit: 14,
    attackSeconds: 2.0, attackRange: 1.4, aggressive: true, aggroRange: 4, leashRange: 9, wanderRadius: 3,
    speed: 2.4, respawnSeconds: 22, model: 'leech', scale: 1, color: '#3a3226', accent: '#5e4c34',
    slowOnHit: { chance: 0.25, factor: 0.7, seconds: 3 },
    drops: [
      { item: 'mire_oil', min: 1, max: 2, chance: 0.75 },
      { item: 'coins', min: 20, max: 45, chance: 0.75 },
      { item: 'marsh_pearl', min: 1, max: 1, chance: 0.02 },
      { item: 'linen', min: 1, max: 1, chance: 0.12 },
      { item: 'steel_arrow', min: 3, max: 8, chance: 0.1 },
      { item: 'iron_dagger', min: 1, max: 1, chance: 0.02 },
      { item: 'oak_wand', min: 1, max: 1, chance: 0.015 },
    ],
  },
  // The Bog Mother: a croaker grown vast and old in the waters round the Sunken Shrine.
  bog_mother: {
    id: 'bog_mother', name: 'The Bog Mother', level: 30, maxHp: 560, attack: 28, strength: 27, defence: 25, maxHit: 22,
    attackSeconds: 2.8, attackRange: 2.2, aggressive: true, aggroRange: 5, leashRange: 9, wanderRadius: 2,
    speed: 2.3, respawnSeconds: 90, model: 'toad', scale: 2.7, color: '#4f6a2c', accent: '#e0c86a', boss: true,
    special: { kind: 'slam', name: 'Mire burst', windup: 1.6, radius: 2.4, damage: 1.2, cooldown: 13, range: 5, slow: { factor: 0.6, seconds: 3 } },
    drops: [
      { item: 'big_bones', min: 1, max: 1, chance: 1 },
      { item: 'coins', min: 220, max: 480, chance: 1 },
      { item: 'marsh_pearl', min: 1, max: 2, chance: 0.6 },
      { item: 'mire_oil', min: 3, max: 6, chance: 0.6 },
      { item: 'raw_silverpike', min: 2, max: 4, chance: 0.4 },
      { item: 'willow_shortbow', min: 1, max: 1, chance: 0.05 },
      { item: 'mireweave_hood', min: 1, max: 1, chance: 0.12 },
      { item: 'mirelight_wand', min: 1, max: 1, chance: 0.03 },
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
      { item: 'coins', min: 22, max: 50, chance: 0.75 },
      { item: 'steel_arrow', min: 3, max: 8, chance: 0.1 },
      { item: 'steel_helm', min: 1, max: 1, chance: 0.02 },
      { item: 'boarhide_boots', min: 1, max: 1, chance: 0.02 },
    ],
  },
  // Ridge stalkers: lean grey hunters of the crags, quick and patient.
  ridge_stalker: {
    id: 'ridge_stalker', name: 'Ridge Stalker', level: 32, maxHp: 210, attack: 31, strength: 29, defence: 26, maxHit: 19,
    attackSeconds: 1.8, attackRange: 1.4, aggressive: true, aggroRange: 5, leashRange: 11, wanderRadius: 4,
    speed: 3.5, respawnSeconds: 26, model: 'wolf', scale: 1.15, color: '#9a9ea6', accent: '#d8dce2',
    pack: { radius: 5, max: 2 },
    drops: [
      { item: 'bones', min: 1, max: 1, chance: 1 },
      { item: 'ridge_pelt', min: 1, max: 1, chance: 0.55 },
      { item: 'wolf_fang', min: 1, max: 1, chance: 0.25 },
      { item: 'coins', min: 30, max: 65, chance: 0.75 },
      { item: 'silver_ore', min: 1, max: 1, chance: 0.1 },
      { item: 'steel_arrow', min: 5, max: 12, chance: 0.15 },
      { item: 'ridgehide_vambraces', min: 1, max: 1, chance: 0.02 },
      { item: 'glimsteel_dagger', min: 1, max: 1, chance: 0.01 },
      { item: 'ridgehide_boots', min: 1, max: 1, chance: 0.015 },
    ],
  },
  // Greymane: the stalkers' old pack-leader, denned in the ruins of the Old Watchtower.
  greymane: {
    id: 'greymane', name: 'Greymane', level: 34, maxHp: 620, attack: 33, strength: 32, defence: 29, maxHit: 23,
    attackSeconds: 2.2, attackRange: 1.8, aggressive: true, aggroRange: 6, leashRange: 9, wanderRadius: 2,
    speed: 3.4, respawnSeconds: 90, model: 'wolf', scale: 1.7, color: '#5a5e66', accent: '#eef0f2', boss: true,
    special: { kind: 'charge', name: 'Pounce', windup: 1.4, radius: 1.6, damage: 1.4, cooldown: 10, range: 7 },
    drops: [
      { item: 'big_bones', min: 1, max: 1, chance: 1 },
      { item: 'coins', min: 260, max: 520, chance: 1 },
      { item: 'silver_bar', min: 1, max: 3, chance: 0.6 },
      { item: 'ridge_pelt', min: 2, max: 3, chance: 0.8 },
      { item: 'cut_sapphire', min: 1, max: 1, chance: 0.25 },
      { item: 'ridgehide_body', min: 1, max: 1, chance: 0.05 },
      { item: 'rowan_shortbow', min: 1, max: 1, chance: 0.05 },
      { item: 'glimsteel_sword', min: 1, max: 1, chance: 0.04 },
    ],
  },
  // ---- The Sunken Shrine (Phase 4C, docs/DUNGEONS.md)
  // Drowned acolytes: the shrine's last keepers, still at their rites. They cast cold bolts of water.
  drowned_acolyte: {
    id: 'drowned_acolyte', name: 'Drowned Acolyte', level: 34, maxHp: 190, attack: 32, strength: 28, defence: 22, maxHit: 14,
    attackSeconds: 2.6, attackRange: 5, aggressive: true, aggroRange: 5, leashRange: 9, wanderRadius: 2,
    speed: 2.4, respawnSeconds: 40, model: 'humanoid', scale: 1, color: '#7fa8a0', accent: '#9fe8d8', attackStyle: 'magic', tool: 'wand',
    look: { skin: '#9fb8b0', hair: '#2a3a38', tunic: '#2f5a58', trousers: '#1f3a3a', robe: true },
    kite: 3,
    drops: [
      { item: 'coins', min: 40, max: 80, chance: 0.75 },
      { item: 'air_rune', min: 8, max: 20, chance: 0.4 },
      { item: 'linen', min: 1, max: 2, chance: 0.2 },
      { item: 'marsh_pearl', min: 1, max: 1, chance: 0.04 },
      { item: 'mireweave_hood', min: 1, max: 1, chance: 0.02 },
      { item: 'silverpike', min: 1, max: 1, chance: 0.1 },
      { item: 'mireweave_gloves', min: 1, max: 1, chance: 0.02 },
    ],
  },
  // Drowned guardians: shrine wardens in weed-hung mail, standing their watch at the sanctum.
  drowned_guardian: {
    id: 'drowned_guardian', name: 'Drowned Guardian', level: 38, maxHp: 260, attack: 36, strength: 35, defence: 33, maxHit: 16,
    attackSeconds: 2.2, attackRange: 1.5, aggressive: true, aggroRange: 4, leashRange: 8, wanderRadius: 1,
    speed: 2.6, respawnSeconds: 45, model: 'humanoid', scale: 1.1, color: '#7fa8a0', accent: '#5f8a4a', tool: 'spear',
    look: { skin: '#8aa8a0', hair: '#2a3a38', tunic: '#4a5a58', trousers: '#2f3a38', helmet: true },
    drops: [
      { item: 'bones', min: 1, max: 1, chance: 1 },
      { item: 'coins', min: 40, max: 90, chance: 0.75 },
      { item: 'steel_bar', min: 1, max: 1, chance: 0.15 },
      { item: 'glimsteel_helm', min: 1, max: 1, chance: 0.02 },
      { item: 'silverpike', min: 1, max: 1, chance: 0.15 },
      { item: 'steel_handguards', min: 1, max: 1, chance: 0.025 },
    ],
  },
  // The Shrinekeeper: whatever the shrine was raised to hold, it kept. Bolts of black water, and a
  // fury when wounded. Its guardians come when it calls.
  shrinekeeper: {
    id: 'shrinekeeper', name: 'The Shrinekeeper', level: 52, maxHp: 900, attack: 42, strength: 40, defence: 34, maxHit: 22,
    attackSeconds: 2.6, attackRange: 5.5, aggressive: true, aggroRange: 6, leashRange: 10, wanderRadius: 1,
    speed: 2.2, respawnSeconds: 120, model: 'humanoid', scale: 1.55, color: '#5f8a80', accent: '#9fe8d8', boss: true, attackStyle: 'magic', tool: 'wand',
    look: { skin: '#7f9a92', hair: '#d8e8e0', tunic: '#1f3a48', trousers: '#16303a', robe: true, cape: '#2f5a58' },
    enrage: { below: 0.4, speed: 1.5 },
    rally: 5,
    special: { kind: 'slam', name: 'Tide surge', windup: 1.6, radius: 2.4, damage: 1.3, cooldown: 12, range: 6, slow: { factor: 0.6, seconds: 3 } },
    drops: [
      { item: 'big_bones', min: 1, max: 1, chance: 1 },
      { item: 'coins', min: 380, max: 700, chance: 1 },
      { item: 'marsh_pearl', min: 1, max: 1, chance: 0.5 },
    ],
  },
  // ---- The Old Watchtower (Phase 4C)
  // Hollow sentinels: suits of the old watch's armour, still standing their posts with nobody inside.
  hollow_sentinel: {
    id: 'hollow_sentinel', name: 'Hollow Sentinel', level: 38, maxHp: 250, attack: 36, strength: 35, defence: 36, maxHit: 16,
    attackSeconds: 2.2, attackRange: 1.5, aggressive: true, aggroRange: 4, leashRange: 8, wanderRadius: 1,
    speed: 2.5, respawnSeconds: 45, model: 'humanoid', scale: 1.05, color: '#8a8e96', accent: '#5a5e66', tool: 'sword',
    look: { skin: '#3a3a40', hair: '#3a3a40', tunic: '#8a8e96', trousers: '#5a5e66', helmet: true },
    drops: [
      { item: 'coins', min: 40, max: 90, chance: 0.75 },
      { item: 'steel_bar', min: 1, max: 2, chance: 0.2 },
      { item: 'silver_ore', min: 1, max: 2, chance: 0.15 },
      { item: 'steel_platelegs', min: 1, max: 1, chance: 0.03 },
      { item: 'bread', min: 1, max: 2, chance: 0.15 },
      { item: 'steel_sabatons', min: 1, max: 1, chance: 0.03 },
    ],
  },
  // Forsworn archers: the watch's last bowmen, who barred the door and never came down.
  forsworn_archer: {
    id: 'forsworn_archer', name: 'Forsworn Archer', level: 36, maxHp: 200, attack: 34, strength: 30, defence: 24, maxHit: 14,
    attackSeconds: 2.4, attackRange: 6, aggressive: true, aggroRange: 6, leashRange: 9, wanderRadius: 2,
    speed: 2.6, respawnSeconds: 40, model: 'humanoid', scale: 1, color: '#9a8a7a', accent: '#5a4a3a', attackStyle: 'ranged', tool: 'bow',
    look: { skin: '#b8a894', hair: '#4a3a2a', tunic: '#5a4a3a', trousers: '#3a332c', cape: '#4a3a2a' },
    kite: 3.5,
    drops: [
      { item: 'bones', min: 1, max: 1, chance: 1 },
      { item: 'coins', min: 30, max: 70, chance: 0.75 },
      { item: 'steel_arrow', min: 8, max: 20, chance: 0.35 },
      { item: 'rowan_logs', min: 1, max: 1, chance: 0.1 },
      { item: 'boarhide_coif', min: 1, max: 1, chance: 0.03 },
      { item: 'silverpike', min: 1, max: 1, chance: 0.12 },
    ],
  },
  // The Last Watchcaptain: who barred the tower, and why, is a story nobody alive can tell.
  watchcaptain: {
    id: 'watchcaptain', name: 'The Last Watchcaptain', level: 58, maxHp: 1100, attack: 48, strength: 47, defence: 42, maxHit: 24,
    attackSeconds: 2.4, attackRange: 1.8, aggressive: true, aggroRange: 6, leashRange: 9, wanderRadius: 1,
    speed: 2.6, respawnSeconds: 120, model: 'humanoid', scale: 1.45, color: '#6a6e76', accent: '#a83a2a', boss: true, tool: 'sword',
    look: { skin: '#5a5e66', hair: '#2a2a30', tunic: '#6a6e76', trousers: '#3a3e46', helmet: true, cape: '#7a2a22' },
    enrage: { below: 0.35, speed: 1.6 },
    rally: 5,
    special: { kind: 'sweep', name: 'Sweeping cut', windup: 1.5, radius: 2.6, damage: 1.4, cooldown: 11, range: 2.5 },
    drops: [
      { item: 'big_bones', min: 1, max: 1, chance: 1 },
      { item: 'coins', min: 420, max: 780, chance: 1 },
      { item: 'silver_bar', min: 1, max: 2, chance: 0.5 },
    ],
  },
};

export const ENEMIES: Record<EnemyType, EnemyDef> = {
  ...BASE,
  // ---- Elites (Phase 5D): one per region from Thornridge on, each a known creature with one ability.
  ironhide_bristleback: elite('bristleback', {
    id: 'ironhide_bristleback', name: 'Ironhide Bristleback', level: 30, maxHp: 340, defence: 25, maxHit: 18, scale: 1.3, color: '#4a3a2e',
    special: { kind: 'charge', name: 'Charge', windup: 1.4, radius: 1.6, damage: 1.5, cooldown: 9, range: 7 },
  }),
  drowned_tidecaller: elite('drowned_acolyte', {
    id: 'drowned_tidecaller', name: 'Drowned Tidecaller', level: 42, maxHp: 320, attack: 38, defence: 30, maxHit: 16, scale: 1.15, accent: '#5fd8ff',
    kite: 3.5,
    special: { kind: 'slam', name: 'Tide surge', windup: 1.6, radius: 2.2, damage: 1.4, cooldown: 10, range: 6, slow: { factor: 0.6, seconds: 3 } },
  }),
  forsworn_marksman: elite('forsworn_archer', {
    id: 'forsworn_marksman', name: 'Forsworn Marksman', level: 44, maxHp: 320, attack: 40, defence: 28, maxHit: 16, scale: 1.15, accent: '#c8a050',
    kite: 4,
    special: { kind: 'slam', name: 'Arrow rain', windup: 1.6, radius: 2.4, damage: 1.3, cooldown: 9, range: 7 },
  }),
};

/**
 * An elite from its base creature: the same look, stance and loot family, tougher, slower to return
 * (three times the respawn), with coins doubled and its gear twice as likely (at most 6%). Elites are
 * never aggressive beyond their base, and never bosses.
 */
function elite(of: BaseType, o: Partial<EnemyDef> & Pick<EnemyDef, 'id' | 'name' | 'level' | 'maxHp'>): EnemyDef {
  const base = BASE[of];
  const drops = base.drops.map((d) =>
    d.item === 'coins' ? { ...d, min: d.min * 2, max: d.max * 2 } : itemIsGear(d.item) ? { ...d, chance: Math.min(0.06, d.chance * 2) } : { ...d },
  );
  return { ...base, ...o, look: base.look && { ...base.look }, respawnSeconds: base.respawnSeconds * 3, drops, elite: { of } };
}
