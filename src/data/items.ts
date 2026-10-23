import type { ToolInfo } from './tools';
export type IconShape =
  | 'log'
  | 'ore'
  | 'coins'
  | 'arrow'
  | 'gel'
  | 'pelt'
  | 'bone'
  | 'bread'
  | 'axe'
  | 'pickaxe'
  | 'fang'
  | 'gem'
  | 'bar'
  | 'dagger'
  | 'sword'
  | 'helm'
  | 'shield'
  | 'platebody'
  | 'platelegs'
  | 'bow'
  | 'shafts'
  | 'meat'
  | 'hammer'
  | 'knife'
  | 'net'
  | 'string'
  | 'unbow'
  | 'fish'
  | 'tinderbox'
  | 'ashes'
  | 'spark'
  | 'wand'
  | 'eel'
  | 'rod'
  | 'lantern'
  | 'ring'
  | 'needle'
  | 'chisel'
  | 'thread'
  | 'leather'
  | 'gloves'
  | 'boots'
  | 'cape'
  | 'amulet'
  | 'flax'
  | 'cutgem'
  | 'cowl'
  | 'vambraces'
  | 'seed'
  | 'rake'
  | 'dibber'
  | 'spade'
  | 'potato'
  | 'onion'
  | 'cabbage'
  | 'weeds'
  | 'plank'
  | 'nails'
  | 'saw';

export type EquipSlot = 'weapon' | 'shield' | 'head' | 'body' | 'legs' | 'ammo' | 'cape' | 'neck' | 'hands' | 'feet' | 'ring';
/** Display order (two rows of the equipment box). */
export const EQUIP_SLOTS: readonly EquipSlot[] = ['head', 'cape', 'neck', 'ammo', 'weapon', 'shield', 'body', 'legs', 'hands', 'feet', 'ring'];

/** Wearable stats. Weapons boost the combat style they are made for; armour adds to defence. */
export interface EquipDef {
  slot: EquipSlot;
  /** Weapons only: the combat style the weapon is used with. */
  style?: 'melee' | 'ranged' | 'magic';
  /**
   * Accuracy and power bonuses. On a weapon they replace the training weapon's (with its own style);
   * on other gear (amulets) they add to every style.
   */
  accuracy?: number;
  power?: number;
  /** Armour bonus (adds to the wearer's defence roll). */
  armour?: number;
  /**
   * Weapons only: seconds between attacks and reach in tiles, when they differ from the style's
   * (STYLES in src/sim/combat.ts). Daggers are quick, warhammers and staffs slow, longbows slow with
   * a longer reach. Tuned so a weapon's damage per second stays close to the sword or shortbow of
   * its tier: the choice is how a weapon fights, not a hidden best (docs/PROGRESSION.md 5A).
   */
  speed?: number;
  range?: number;
  /** Bows need both hands: a shield can't be worn with them. */
  twoHanded?: boolean;
  /** Minimum skill levels to wear it. */
  req?: Partial<Record<'attack' | 'strength' | 'defence' | 'ranged' | 'magic', number>>;
  /** Ammo slot only: the combat style that fires it (worn as a whole stack, used one per shot). */
  ammoFor?: 'ranged';
  /**
   * Bonuses that apply only with one combat style (docs/PROGRESSION.md): hides add ranged accuracy,
   * robes add magic accuracy and power, and metal armour costs magic and ranged accuracy. Plain
   * `accuracy`/`power` on non-weapon gear (amulets, rings) still help every style.
   */
  styleBonus?: Partial<Record<'melee' | 'ranged' | 'magic', { accuracy?: number; power?: number }>>;
  /** Metal/material tint for the worn model. */
  tint?: string;
}

export interface ItemDef {
  id: string;
  name: string;
  examine: string;
  /**
   * Stackable items share one slot up to maxStack (coins, ammo, runes). Everything else, including
   * primary gathered resources (logs, ores, gems, fish), takes one inventory slot per item.
   */
  stackable: boolean;
  maxStack: number;
  kind: 'material' | 'tool' | 'food' | 'ammo' | 'currency' | 'trophy' | 'weapon' | 'armour';
  value: number;
  heal?: number;
  /** Food that also restores devotion points (the Ember spirit's fish). */
  devotion?: number;
  equip?: EquipDef;
  /** Tools: toolbelt category, tier and use requirement (see data/tools.ts). */
  tool?: ToolInfo;
  icon: { shape: IconShape; color: string; accent?: string };
}

/**
 * Coins carry up to two billion in one slot (5A), as many as a bank slot holds: wealth is never
 * capped below what the bank and the Exchange can hold. Other stacks (arrows, spark stones) stop
 * at 99,999.
 */
export const COIN_STACK = 2_000_000_000;

const def = (d: Omit<ItemDef, 'maxStack'> & { maxStack?: number }): ItemDef => ({
  maxStack: d.stackable ? 99_999 : 1,
  ...d,
});

export const ITEMS = {
  coins: def({ id: 'coins', name: 'Coins', examine: 'Shiny golden crowns.', stackable: true, maxStack: COIN_STACK, kind: 'currency', value: 1, icon: { shape: 'coins', color: '#f5c542', accent: '#c48a12' } }),
  logs: def({ id: 'logs', name: 'Logs', examine: 'Freshly cut timber.', stackable: false, kind: 'material', value: 4, icon: { shape: 'log', color: '#9b6a3a', accent: '#e6c48f' } }),
  oak_logs: def({ id: 'oak_logs', name: 'Oak logs', examine: 'Sturdy oak timber.', stackable: false, kind: 'material', value: 12, icon: { shape: 'log', color: '#7a4f2a', accent: '#d9a866' } }),
  copper_ore: def({ id: 'copper_ore', name: 'Copper ore', examine: 'Ore with a warm orange sheen.', stackable: false, kind: 'material', value: 5, icon: { shape: 'ore', color: '#7c6f66', accent: '#e8833a' } }),
  tin_ore: def({ id: 'tin_ore', name: 'Tin ore', examine: 'Soft silvery ore.', stackable: false, kind: 'material', value: 5, icon: { shape: 'ore', color: '#7c7a78', accent: '#d8dde2' } }),
  iron_ore: def({ id: 'iron_ore', name: 'Iron ore', examine: 'Heavy, dark and valuable.', stackable: false, kind: 'material', value: 18, icon: { shape: 'ore', color: '#5f5550', accent: '#b35a43' } }),
  coal_ore: def({ id: 'coal_ore', name: 'Coal', examine: 'Black and dusty. Smelted with iron ore to make steel.', stackable: false, kind: 'material', value: 25, icon: { shape: 'ore', color: '#2f2d2c', accent: '#5a5856' } }),
  // Brightwater gems (the garnet keeps the old sapphire ids so saves carry over: docs/ORIGINALITY.md M2).
  sapphire: def({ id: 'sapphire', name: 'Uncut ironcrag garnet', examine: 'A deep red stone from the Ironcrag Hills, found now and then while mining.', stackable: false, kind: 'material', value: 60, icon: { shape: 'gem', color: '#a8283a', accent: '#f0a0a8' } }),
  river_agate: def({ id: 'river_agate', name: 'Rough river agate', examine: 'A banded pebble sometimes caught in a net. Polish it with a chisel.', stackable: false, kind: 'material', value: 25, icon: { shape: 'gem', color: '#c9a06a', accent: '#f6e2c0' } }),
  glimsteel_arrow: def({ id: 'glimsteel_arrow', name: 'Glimsteel-tipped arrows', examine: 'Light, keen heads that fly true. Wear them in your ammo slot.', stackable: true, kind: 'ammo', value: 6, equip: { slot: 'ammo', ammoFor: 'ranged', accuracy: 4, power: 5, req: { ranged: 30 } }, icon: { shape: 'arrow', color: '#9fd8e8', accent: '#f2f2f2' } }),
  bronze_arrow: def({ id: 'bronze_arrow', name: 'Bronze arrows', examine: 'Fired from a bow. Wear them in your ammo slot.', stackable: true, kind: 'ammo', value: 1, equip: { slot: 'ammo', ammoFor: 'ranged' }, icon: { shape: 'arrow', color: '#c98a4b', accent: '#f2f2f2' } }),
  air_rune: def({ id: 'air_rune', name: 'Spark stones', examine: 'Quartz chips charged at a shrine. A wand burns one per spell.', stackable: true, kind: 'ammo', value: 2, icon: { shape: 'spark', color: '#8fe8ff', accent: '#ffffff' } }),
  spark_quartz: def({ id: 'spark_quartz', name: 'Spark quartz', examine: 'Cloudy crystal from the Ironcrag Hills. It hums faintly. Chip it with a chisel.', stackable: false, kind: 'material', value: 6, icon: { shape: 'ore', color: '#7c8a96', accent: '#8fe8ff' } }),
  dull_spark: def({ id: 'dull_spark', name: 'Dull spark chips', examine: 'Quartz chips waiting to be charged at the shrine or a waystone.', stackable: true, kind: 'material', value: 1, icon: { shape: 'spark', color: '#9aa6b0', accent: '#d6dde3' } }),
  slime_gel: def({ id: 'slime_gel', name: 'Slime gel', examine: 'Wobbly. Alchemists might want it.', stackable: true, kind: 'material', value: 3, icon: { shape: 'gel', color: '#6fdc5a', accent: '#d8ffd0' } }),
  wolf_pelt: def({ id: 'wolf_pelt', name: 'Wolf pelt', examine: 'Thick grey fur. A tanner can make leather from it.', stackable: false, kind: 'material', value: 15, icon: { shape: 'pelt', color: '#8c8f99', accent: '#d7d9de' } }),
  wolf_fang: def({ id: 'wolf_fang', name: 'Wolf fang', examine: 'Sharp as a dagger.', stackable: true, kind: 'trophy', value: 8, icon: { shape: 'fang', color: '#f1ecd9', accent: '#b8ad8a' } }),
  bones: def({ id: 'bones', name: 'Bones', examine: 'Remains of a fallen foe. Bury them to honour the shrine spirits (Devotion).', stackable: false, kind: 'material', value: 2, icon: { shape: 'bone', color: '#efe8d6', accent: '#b9ad90' } }),
  big_bones: def({ id: 'big_bones', name: "Warlord's bones", examine: 'The massive bones of a goblin warlord. The shrine spirits favour them.', stackable: false, kind: 'material', value: 12, icon: { shape: 'bone', color: '#f6f0de', accent: '#a99c7c' } }),
  // Brightwater crops (ids kept from earlier content so saves carry over: docs/ORIGINALITY.md H10).
  potato_seed: def({ id: 'potato_seed', name: 'Sunroot seed', examine: 'Plant 2 in an allotment (Farming 1).', stackable: true, kind: 'material', value: 2, icon: { shape: 'seed', color: '#e0b04a', accent: '#7a5a34' } }),
  onion_seed: def({ id: 'onion_seed', name: 'Wardleaf seed', examine: 'Plant 2 in an allotment (Farming 4).', stackable: true, kind: 'material', value: 3, icon: { shape: 'seed', color: '#c8d8d0', accent: '#5a7a6a' } }),
  cabbage_seed: def({ id: 'cabbage_seed', name: 'Glowcap spores', examine: 'A pinch of pale spores. Plant 2 in an allotment (Farming 8).', stackable: true, kind: 'material', value: 4, icon: { shape: 'seed', color: '#e8f0d8', accent: '#8aa86a' } }),
  bluebell_seed: def({ id: 'bluebell_seed', name: 'Bluebell flax seed', examine: 'Plant 2 in an allotment (Farming 12).', stackable: true, kind: 'material', value: 5, icon: { shape: 'seed', color: '#7fa8e8', accent: '#3a5a8a' } }),
  bread: def({ id: 'bread', name: 'Bread', examine: 'Warm village bread. Heals 28 HP.', stackable: false, kind: 'food', value: 6, heal: 28, icon: { shape: 'bread', color: '#d99a4e', accent: '#f6d7a0' } }),
  bronze_axe: def({ id: 'bronze_axe', name: 'Bronze axe', examine: 'Required for woodcutting.', stackable: false, kind: 'tool', tool: { category: 'axe', tier: 1 }, value: 16, icon: { shape: 'axe', color: '#c98a4b', accent: '#7a4f2a' } }),
  bronze_pickaxe: def({ id: 'bronze_pickaxe', name: 'Bronze pickaxe', examine: 'Required for mining.', stackable: false, kind: 'tool', tool: { category: 'pickaxe', tier: 1 }, value: 16, icon: { shape: 'pickaxe', color: '#c98a4b', accent: '#7a4f2a' } }),

  // ---- Smithing: bars and bronze / iron equipment
  bronze_bar: def({ id: 'bronze_bar', name: 'Bronze bar', examine: 'Copper and tin, smelted together.', stackable: false, kind: 'material', value: 14, icon: { shape: 'bar', color: '#c98a4b', accent: '#f0b47a' } }),
  iron_bar: def({ id: 'iron_bar', name: 'Iron bar', examine: 'A bar of strong, dark iron.', stackable: false, kind: 'material', value: 40, icon: { shape: 'bar', color: '#8d949c', accent: '#d5dbe1' } }),
  steel_bar: def({ id: 'steel_bar', name: 'Steel bar', examine: 'Iron hardened with coal. Strong and bright.', stackable: false, kind: 'material', value: 70, icon: { shape: 'bar', color: '#d3d9df', accent: '#f4f7fa' } }),
  steel_dagger: def({ id: 'steel_dagger', name: 'Steel dagger', examine: 'A quick, keen steel blade.', stackable: false, kind: 'weapon', value: 50, equip: { slot: 'weapon', style: 'melee', speed: 1.5, accuracy: 30, power: 24, req: { attack: 20 }, tint: '#d3d9df' }, icon: { shape: 'dagger', color: '#d3d9df', accent: '#5c646e' } }),
  steel_sword: def({ id: 'steel_sword', name: 'Steel sword', examine: 'Well balanced and very sharp.', stackable: false, kind: 'weapon', value: 150, equip: { slot: 'weapon', style: 'melee', accuracy: 34, power: 29, req: { attack: 20 }, tint: '#d3d9df' }, icon: { shape: 'sword', color: '#d3d9df', accent: '#5c646e' } }),
  steel_helm: def({ id: 'steel_helm', name: 'Steel helm', examine: 'A bright steel helm.', stackable: false, kind: 'armour', value: 110, equip: { slot: 'head', styleBonus: { magic: { accuracy: -2 }, ranged: { accuracy: -1 } }, armour: 12, req: { defence: 20 }, tint: '#d3d9df' }, icon: { shape: 'helm', color: '#d3d9df', accent: '#5c646e' } }),
  steel_shield: def({ id: 'steel_shield', name: 'Steel shield', examine: 'Steel-faced and hard to dent.', stackable: false, kind: 'armour', value: 170, equip: { slot: 'shield', styleBonus: { magic: { accuracy: -3 }, ranged: { accuracy: -1 } }, armour: 19, req: { defence: 20 }, tint: '#d3d9df' }, icon: { shape: 'shield', color: '#d3d9df', accent: '#4e3a2a' } }),
  steel_platelegs: def({ id: 'steel_platelegs', name: 'Steel greaves', examine: 'Steel greaves, strapped over the thighs and shins.', stackable: false, kind: 'armour', value: 200, equip: { slot: 'legs', styleBonus: { magic: { accuracy: -4 }, ranged: { accuracy: -2 } }, armour: 21, req: { defence: 20 }, tint: '#d3d9df' }, icon: { shape: 'platelegs', color: '#d3d9df', accent: '#5c646e' } }),
  steel_platebody: def({ id: 'steel_platebody', name: 'Steel breastplate', examine: 'A polished steel breastplate.', stackable: false, kind: 'armour', value: 300, equip: { slot: 'body', styleBonus: { magic: { accuracy: -6 }, ranged: { accuracy: -3 } }, armour: 30, req: { defence: 20 }, tint: '#d3d9df' }, icon: { shape: 'platebody', color: '#d3d9df', accent: '#5c646e' } }),
  glimmerite_ore: def({ id: 'glimmerite_ore', name: 'Glimmerite ore', examine: 'Pale ore from the deep Ironcrag veins. It glitters even in shadow.', stackable: false, kind: 'material', value: 60, icon: { shape: 'ore', color: '#8e98a2', accent: '#e6f4ff' } }),
  glimsteel_bloom: def({ id: 'glimsteel_bloom', name: 'Hot glimsteel bloom', examine: 'Glowing metal fresh from the furnace. Quench it in running water to set it.', stackable: false, kind: 'material', value: 90, icon: { shape: 'bar', color: '#ffb26a', accent: '#fff2c8' } }),
  glimsteel_bar: def({ id: 'glimsteel_bar', name: 'Glimsteel bar', examine: 'Quenched glimsteel: light, keen and faintly shining.', stackable: false, kind: 'material', value: 160, icon: { shape: 'bar', color: '#cfe4f2', accent: '#ffffff' } }),
  glimsteel_dagger: def({ id: 'glimsteel_dagger', name: 'Glimsteel dagger', examine: 'Light enough to forget you carry it.', stackable: false, kind: 'weapon', value: 120, equip: { slot: 'weapon', style: 'melee', speed: 1.5, accuracy: 39, power: 31, req: { attack: 30 }, tint: '#cfe4f2' }, icon: { shape: 'dagger', color: '#cfe4f2', accent: '#5a7a8e' } }),
  glimsteel_sword: def({ id: 'glimsteel_sword', name: 'Glimsteel sword', examine: 'A shining, quick blade.', stackable: false, kind: 'weapon', value: 330, equip: { slot: 'weapon', style: 'melee', accuracy: 44, power: 37, req: { attack: 30 }, tint: '#cfe4f2' }, icon: { shape: 'sword', color: '#cfe4f2', accent: '#5a7a8e' } }),
  glimsteel_helm: def({ id: 'glimsteel_helm', name: 'Glimsteel helm', examine: 'A light helm that never seems to dull.', stackable: false, kind: 'armour', value: 250, equip: { slot: 'head', styleBonus: { magic: { accuracy: -1 }, ranged: { accuracy: -1 } }, armour: 16, accuracy: 1, req: { defence: 30 }, tint: '#cfe4f2' }, icon: { shape: 'helm', color: '#cfe4f2', accent: '#5a7a8e' } }),
  glimsteel_shield: def({ id: 'glimsteel_shield', name: 'Glimsteel shield', examine: 'Bright as a mirror.', stackable: false, kind: 'armour', value: 380, equip: { slot: 'shield', styleBonus: { magic: { accuracy: -2 }, ranged: { accuracy: -1 } }, armour: 25, accuracy: 1, req: { defence: 30 }, tint: '#cfe4f2' }, icon: { shape: 'shield', color: '#cfe4f2', accent: '#5a7a8e' } }),
  glimsteel_platelegs: def({ id: 'glimsteel_platelegs', name: 'Glimsteel greaves', examine: 'Light greaves that let you move freely.', stackable: false, kind: 'armour', value: 450, equip: { slot: 'legs', styleBonus: { magic: { accuracy: -2 }, ranged: { accuracy: -1 } }, armour: 28, accuracy: 1, req: { defence: 30 }, tint: '#cfe4f2' }, icon: { shape: 'platelegs', color: '#cfe4f2', accent: '#5a7a8e' } }),
  glimsteel_platebody: def({ id: 'glimsteel_platebody', name: 'Glimsteel breastplate', examine: 'Light, bright armour. Its wearer strikes a touch truer.', stackable: false, kind: 'armour', value: 680, equip: { slot: 'body', styleBonus: { magic: { accuracy: -3 }, ranged: { accuracy: -2 } }, armour: 40, accuracy: 2, req: { defence: 30 }, tint: '#cfe4f2' }, icon: { shape: 'platebody', color: '#cfe4f2', accent: '#5a7a8e' } }),
  duskiron_ore: def({ id: 'duskiron_ore', name: 'Duskiron ore', examine: 'Heavy, dark ore picked from goblin slag. It will not melt clean without a flux.', stackable: false, kind: 'material', value: 95, icon: { shape: 'ore', color: '#3a363e', accent: '#8a7ea0' } }),
  duskiron_bar: def({ id: 'duskiron_bar', name: 'Duskiron bar', examine: 'Dense, dark metal. Armour made from it is very hard to pierce.', stackable: false, kind: 'material', value: 230, icon: { shape: 'bar', color: '#3e3a44', accent: '#9a8eb4' } }),
  duskiron_warhammer: def({ id: 'duskiron_warhammer', name: "Duskiron warhammer", examine: "A brutal head of duskiron on an oak haft. Slow to aim, terrible to meet.", stackable: false, kind: 'weapon', value: 520, equip: { slot: 'weapon', style: 'melee', speed: 1.9, accuracy: 40, power: 76, req: { attack: 45, strength: 45 }, tint: '#3e3a44' }, icon: { shape: 'hammer', color: '#3e3a44', accent: '#8a7ea0' } }),
  duskiron_sword: def({ id: 'duskiron_sword', name: 'Duskiron sword', examine: 'A dark, heavy blade. Slower to aim than glimsteel, but it bites deep.', stackable: false, kind: 'weapon', value: 480, equip: { slot: 'weapon', style: 'melee', accuracy: 48, power: 44, req: { attack: 45 }, tint: '#3e3a44' }, icon: { shape: 'sword', color: '#3e3a44', accent: '#8a7ea0' } }),
  duskiron_helm: def({ id: 'duskiron_helm', name: "Duskiron helm", examine: "A heavy helm that narrows the view.", stackable: false, kind: 'armour', value: 380, equip: { slot: 'head', styleBonus: { magic: { accuracy: -3 }, ranged: { accuracy: -2 } }, armour: 22, accuracy: -1, req: { defence: 45 }, tint: '#3e3a44' }, icon: { shape: 'helm', color: '#3e3a44', accent: '#8a7ea0' } }),
  duskiron_shield: def({ id: 'duskiron_shield', name: "Duskiron shield", examine: "So heavy it is nearly a wall.", stackable: false, kind: 'armour', value: 560, equip: { slot: 'shield', styleBonus: { magic: { accuracy: -4 }, ranged: { accuracy: -2 } }, armour: 34, accuracy: -1, req: { defence: 45 }, tint: '#3e3a44' }, icon: { shape: 'shield', color: '#3e3a44', accent: '#8a7ea0' } }),
  duskiron_platelegs: def({ id: 'duskiron_platelegs', name: "Duskiron greaves", examine: "Dense greaves: you feel every step.", stackable: false, kind: 'armour', value: 650, equip: { slot: 'legs', styleBonus: { magic: { accuracy: -6 }, ranged: { accuracy: -3 } }, armour: 38, accuracy: -2, req: { defence: 45 }, tint: '#3e3a44' }, icon: { shape: 'platelegs', color: '#3e3a44', accent: '#8a7ea0' } }),
  duskiron_platebody: def({ id: 'duskiron_platebody', name: "Duskiron breastplate", examine: "Almost nothing gets through it, though it weighs on your swing.", stackable: false, kind: 'armour', value: 960, equip: { slot: 'body', styleBonus: { magic: { accuracy: -9 }, ranged: { accuracy: -4 } }, armour: 55, accuracy: -3, req: { defence: 45 }, tint: '#3e3a44' }, icon: { shape: 'platebody', color: '#3e3a44', accent: '#8a7ea0' } }),
  emberglass_shard: def({ id: 'emberglass_shard', name: 'Emberglass shard', examine: 'Glass from an ember vent, still warm inside. Spells run through it easily.', stackable: false, kind: 'material', value: 50, icon: { shape: 'cutgem', color: '#e8642a', accent: '#ffd27a' } }),
  riverwood_wand: def({ id: 'riverwood_wand', name: "Riverwood wand", examine: "A plain wand with spark chips set in its tip.", stackable: false, kind: 'weapon', value: 40, equip: { slot: 'weapon', style: 'magic', accuracy: 22, power: 16, tint: '#9b6a3a' }, icon: { shape: 'wand', color: '#9b6a3a', accent: '#8fe8ff' } }),
  emberglass_wand: def({ id: 'emberglass_wand', name: "Emberglass wand", examine: "Oak and emberglass. Spells leave it hot and fast.", stackable: false, kind: 'weapon', value: 300, equip: { slot: 'weapon', style: 'magic', accuracy: 32, power: 26, req: { magic: 25 }, tint: '#e8642a' }, icon: { shape: 'wand', color: '#6e472c', accent: '#ff8a3a' } }),
  bronze_dagger: def({ id: 'bronze_dagger', name: 'Bronze dagger', examine: 'Short, sharp and light.', stackable: false, kind: 'weapon', value: 20, equip: { slot: 'weapon', style: 'melee', speed: 1.5, accuracy: 15, power: 11, tint: '#c98a4b' }, icon: { shape: 'dagger', color: '#c98a4b', accent: '#7a4f2a' } }),
  bronze_sword: def({ id: 'bronze_sword', name: 'Bronze sword', examine: 'A dependable blade of village make.', stackable: false, kind: 'weapon', value: 32, equip: { slot: 'weapon', style: 'melee', accuracy: 18, power: 15, tint: '#c98a4b' }, icon: { shape: 'sword', color: '#c98a4b', accent: '#7a4f2a' } }),
  iron_dagger: def({ id: 'iron_dagger', name: 'Iron dagger', examine: 'A plain iron blade, quick in the hand.', stackable: false, kind: 'weapon', value: 40, equip: { slot: 'weapon', style: 'melee', speed: 1.5, accuracy: 23, power: 18, req: { attack: 10 }, tint: '#a3aab3' }, icon: { shape: 'dagger', color: '#a3aab3', accent: '#6b4a2c' } }),
  iron_sword: def({ id: 'iron_sword', name: 'Iron sword', examine: 'Heavier and keener than bronze.', stackable: false, kind: 'weapon', value: 90, equip: { slot: 'weapon', style: 'melee', accuracy: 26, power: 22, req: { attack: 10 }, tint: '#a3aab3' }, icon: { shape: 'sword', color: '#a3aab3', accent: '#4e5560' } }),
  bronze_helm: def({ id: 'bronze_helm', name: 'Bronze helm', examine: 'Keeps your head on your shoulders.', stackable: false, kind: 'armour', value: 20, equip: { slot: 'head', styleBonus: { magic: { accuracy: -2 }, ranged: { accuracy: -1 } }, armour: 4, tint: '#c98a4b' }, icon: { shape: 'helm', color: '#c98a4b', accent: '#7a4f2a' } }),
  iron_helm: def({ id: 'iron_helm', name: 'Iron helm', examine: 'A sturdy iron helm.', stackable: false, kind: 'armour', value: 60, equip: { slot: 'head', styleBonus: { magic: { accuracy: -2 }, ranged: { accuracy: -1 } }, armour: 8, req: { defence: 10 }, tint: '#a3aab3' }, icon: { shape: 'helm', color: '#a3aab3', accent: '#4e5560' } }),
  bronze_shield: def({ id: 'bronze_shield', name: 'Bronze shield', examine: 'A round shield with a bronze rim.', stackable: false, kind: 'armour', value: 34, equip: { slot: 'shield', styleBonus: { magic: { accuracy: -3 }, ranged: { accuracy: -1 } }, armour: 7, tint: '#c98a4b' }, icon: { shape: 'shield', color: '#c98a4b', accent: '#6b4426' } }),
  iron_shield: def({ id: 'iron_shield', name: 'Iron shield', examine: 'Iron-faced and battle-ready.', stackable: false, kind: 'armour', value: 100, equip: { slot: 'shield', styleBonus: { magic: { accuracy: -3 }, ranged: { accuracy: -1 } }, armour: 13, req: { defence: 10 }, tint: '#a3aab3' }, icon: { shape: 'shield', color: '#a3aab3', accent: '#4e3a2a' } }),
  bronze_platelegs: def({ id: 'bronze_platelegs', name: 'Bronze greaves', examine: 'Bronze greaves to guard your legs.', stackable: false, kind: 'armour', value: 40, equip: { slot: 'legs', styleBonus: { magic: { accuracy: -4 }, ranged: { accuracy: -2 } }, armour: 8, tint: '#c98a4b' }, icon: { shape: 'platelegs', color: '#c98a4b', accent: '#7a4f2a' } }),
  iron_platelegs: def({ id: 'iron_platelegs', name: 'Iron greaves', examine: 'Heavy iron greaves.', stackable: false, kind: 'armour', value: 120, equip: { slot: 'legs', styleBonus: { magic: { accuracy: -4 }, ranged: { accuracy: -2 } }, armour: 14, req: { defence: 10 }, tint: '#a3aab3' }, icon: { shape: 'platelegs', color: '#a3aab3', accent: '#4e5560' } }),
  bronze_platebody: def({ id: 'bronze_platebody', name: 'Bronze breastplate', examine: 'A bronze breastplate with shoulder guards.', stackable: false, kind: 'armour', value: 60, equip: { slot: 'body', styleBonus: { magic: { accuracy: -6 }, ranged: { accuracy: -3 } }, armour: 12, tint: '#c98a4b' }, icon: { shape: 'platebody', color: '#c98a4b', accent: '#7a4f2a' } }),
  iron_platebody: def({ id: 'iron_platebody', name: 'Iron breastplate', examine: 'A solid iron breastplate. Heavy, but worth it.', stackable: false, kind: 'armour', value: 180, equip: { slot: 'body', styleBonus: { magic: { accuracy: -6 }, ranged: { accuracy: -3 } }, armour: 20, req: { defence: 10 }, tint: '#a3aab3' }, icon: { shape: 'platebody', color: '#a3aab3', accent: '#4e5560' } }),
  // ---- Fletching
  arrow_shafts: def({ id: 'arrow_shafts', name: 'Arrow shafts', examine: 'Straight wooden shafts, ready for arrowheads.', stackable: true, kind: 'material', value: 1, icon: { shape: 'shafts', color: '#c9a06a', accent: '#8a6238' } }),
  shortbow: def({ id: 'shortbow', name: 'Shortbow', examine: 'A light bow carved from a single log.', stackable: false, kind: 'weapon', value: 30, equip: { slot: 'weapon', style: 'ranged', accuracy: 20, power: 12, twoHanded: true, tint: '#9b6a3a' }, icon: { shape: 'bow', color: '#9b6a3a', accent: '#efe8d6' } }),
  riverwood_longbow: def({ id: 'riverwood_longbow', name: 'Riverwood longbow', examine: 'A tall bow of river-seasoned wood. Hard to draw, hard to dodge.', stackable: false, kind: 'weapon', value: 120, equip: { slot: 'weapon', style: 'ranged', speed: 2, range: 8.5, accuracy: 34, power: 28, twoHanded: true, req: { ranged: 22 }, tint: '#7a5a3a' }, icon: { shape: 'bow', color: '#7a5a3a', accent: '#efe8d6' } }),
  oak_shortbow: def({ id: 'oak_shortbow', name: 'Oak shortbow', examine: 'A springy oak bow with a strong pull.', stackable: false, kind: 'weapon', value: 80, equip: { slot: 'weapon', style: 'ranged', accuracy: 28, power: 17, twoHanded: true, req: { ranged: 15 }, tint: '#6e472c' }, icon: { shape: 'bow', color: '#6e472c', accent: '#efe8d6' } }),
  wooden_shield: def({ id: 'wooden_shield', name: 'Wooden shield', examine: 'Planks pinned to a round frame.', stackable: false, kind: 'armour', value: 16, equip: { slot: 'shield', armour: 4, tint: '#8a5a34' }, icon: { shape: 'shield', color: '#8a5a34', accent: '#4e321e' } }),
  // ---- Cooking
  raw_meat: def({ id: 'raw_meat', name: 'Raw meat', examine: 'It needs cooking before you eat it.', stackable: false, kind: 'material', value: 3, icon: { shape: 'meat', color: '#d9646a', accent: '#f4e2d2' } }),
  cooked_meat: def({ id: 'cooked_meat', name: 'Cooked meat', examine: 'Hearty and hot. Heals 22 HP.', stackable: false, kind: 'food', value: 8, heal: 22, icon: { shape: 'meat', color: '#9a5a32', accent: '#f4e2d2' } }),
  burnt_meat: def({ id: 'burnt_meat', name: 'Burnt meat', examine: 'Charred beyond saving.', stackable: false, kind: 'material', value: 0, icon: { shape: 'meat', color: '#2e2622', accent: '#6a5a50' } }),
  // ---- Production tools (real inventory items; can be banked)
  iron_axe: def({ id: 'iron_axe', name: 'Iron axe', examine: 'A sharper, heavier axe: chops faster than bronze.', stackable: false, kind: 'tool', tool: { category: 'axe', tier: 2, req: { skill: 'woodcutting', level: 1 } }, value: 56, icon: { shape: 'axe', color: '#a3aab3', accent: '#7a4f2a' } }),
  iron_pickaxe: def({ id: 'iron_pickaxe', name: 'Iron pickaxe', examine: 'Bites into rock faster than bronze.', stackable: false, kind: 'tool', tool: { category: 'pickaxe', tier: 2, req: { skill: 'mining', level: 1 } }, value: 70, icon: { shape: 'pickaxe', color: '#a3aab3', accent: '#7a4f2a' } }),
  steel_axe: def({ id: 'steel_axe', name: 'Steel axe', examine: 'A keen steel axe: chops faster than iron.', stackable: false, kind: 'tool', tool: { category: 'axe', tier: 3, req: { skill: 'woodcutting', level: 6 } }, value: 120, icon: { shape: 'axe', color: '#d3d9df', accent: '#7a4f2a' } }),
  steel_pickaxe: def({ id: 'steel_pickaxe', name: 'Steel pickaxe', examine: 'Steel bites into rock faster than iron.', stackable: false, kind: 'tool', tool: { category: 'pickaxe', tier: 3, req: { skill: 'mining', level: 6 } }, value: 150, icon: { shape: 'pickaxe', color: '#d3d9df', accent: '#7a4f2a' } }),
  glimsteel_axe: def({ id: 'glimsteel_axe', name: 'Glimsteel axe', examine: 'Bites through timber with a bright ring.', stackable: false, kind: 'tool', tool: { category: 'axe', tier: 4, req: { skill: 'woodcutting', level: 21 } }, value: 260, icon: { shape: 'axe', color: '#cfe4f2', accent: '#7a4f2a' } }),
  glimsteel_pickaxe: def({ id: 'glimsteel_pickaxe', name: 'Glimsteel pickaxe', examine: 'Light and keen: splits rock with little effort.', stackable: false, kind: 'tool', tool: { category: 'pickaxe', tier: 4, req: { skill: 'mining', level: 21 } }, value: 320, icon: { shape: 'pickaxe', color: '#cfe4f2', accent: '#7a4f2a' } }),
  hammer: def({ id: 'hammer', name: 'Hammer', examine: 'Needed to forge metal at an anvil.', stackable: false, kind: 'tool', tool: { category: 'hammer', tier: 1 }, value: 6, icon: { shape: 'hammer', color: '#8d949c', accent: '#8a5a34' } }),
  knife: def({ id: 'knife', name: 'Knife', examine: 'Use it on logs to fletch shafts and bows.', stackable: false, kind: 'tool', tool: { category: 'knife', tier: 1 }, value: 6, icon: { shape: 'knife', color: '#d6dbe2', accent: '#4e321e' } }),
  tinderbox: def({ id: 'tinderbox', name: 'Tinderbox', examine: 'Flint and steel. Use it on logs to light a fire.', stackable: false, kind: 'tool', tool: { category: 'tinderbox', tier: 1 }, value: 4, icon: { shape: 'tinderbox', color: '#8a5a34', accent: '#d6dbe2' } }),
  ashes: def({ id: 'ashes', name: 'Ashes', examine: 'All that is left of a fire.', stackable: false, kind: 'material', value: 1, icon: { shape: 'ashes', color: '#8c8a86', accent: '#cfccc6' } }),
  needle: def({ id: 'needle', name: 'Needle', examine: 'Use it with thread on leather.', stackable: false, kind: 'tool', tool: { category: 'needle', tier: 1 }, value: 2, icon: { shape: 'needle', color: '#d6dbe2', accent: '#8d949c' } }),
  chisel: def({ id: 'chisel', name: 'Chisel', examine: 'For cutting gems.', stackable: false, kind: 'tool', tool: { category: 'chisel', tier: 1 }, value: 2, icon: { shape: 'chisel', color: '#a3aab3', accent: '#8a5a34' } }),
  thread: def({ id: 'thread', name: 'Thread', examine: 'Strong thread for sewing leather.', stackable: true, kind: 'material', value: 1, icon: { shape: 'thread', color: '#efe8d6', accent: '#8a5a34' } }),
  leather: def({ id: 'leather', name: 'Tanned wolfhide', examine: 'Tanned wolf hide, ready to sew.', stackable: false, kind: 'material', value: 10, icon: { shape: 'leather', color: '#a8743f', accent: '#5e3d1f' } }),
  flax: def({ id: 'flax', name: 'Bluebell flax', examine: 'Blue-flowered flax. Spin it into a bowstring at a spinning wheel.', stackable: false, kind: 'material', value: 3, icon: { shape: 'flax', color: '#7fae4a', accent: '#7fa8e8' } }),
  cut_sapphire: def({ id: 'cut_sapphire', name: 'Ironcrag garnet', examine: 'A cut garnet, red as a forge coal. Jewellers prize it.', stackable: false, kind: 'material', value: 120, icon: { shape: 'cutgem', color: '#a8283a', accent: '#ffd0d6' } }),
  polished_agate: def({ id: 'polished_agate', name: 'Polished river agate', examine: 'Rings of cream and amber, smooth as river water.', stackable: false, kind: 'material', value: 55, icon: { shape: 'cutgem', color: '#c9a06a', accent: '#fff2d8' } }),
  // The wolfhide set (ids kept from earlier content so saves carry over: docs/ORIGINALITY.md H4).
  leather_gloves: def({ id: 'leather_gloves', name: 'Wolfhide wraps', examine: 'Strips of soft hide wound round the hands and wrists.', stackable: false, kind: 'armour', value: 12, equip: { slot: 'hands', styleBonus: { ranged: { accuracy: 1 } }, armour: 2 }, icon: { shape: 'gloves', color: '#a8743f', accent: '#5e3d1f' } }),
  leather_boots: def({ id: 'leather_boots', name: 'Wolfhide boots', examine: 'Fur-lined boots for long walks in the woods.', stackable: false, kind: 'armour', value: 14, equip: { slot: 'feet', styleBonus: { ranged: { accuracy: 1 } }, armour: 2 }, icon: { shape: 'boots', color: '#a8743f', accent: '#5e3d1f' } }),
  leather_cowl: def({ id: 'leather_cowl', name: 'Wolfhide hood', examine: 'A hood with the fur turned out against the wind.', stackable: false, kind: 'armour', value: 18, equip: { slot: 'head', styleBonus: { ranged: { accuracy: 2 } }, armour: 3, tint: '#a8743f' }, icon: { shape: 'cowl', color: '#a8743f', accent: '#5e3d1f' } }),
  leather_vambraces: def({ id: 'leather_vambraces', name: 'Wolfhide bracers', examine: 'Stiff bracers that steady an archer’s arm.', stackable: false, kind: 'armour', value: 22, equip: { slot: 'hands', styleBonus: { ranged: { accuracy: 3 } }, armour: 3 }, icon: { shape: 'vambraces', color: '#a8743f', accent: '#5e3d1f' } }),
  leather_body: def({ id: 'leather_body', name: 'Wolfhide jerkin', examine: 'A jerkin of two hides stitched double.', stackable: false, kind: 'armour', value: 34, equip: { slot: 'body', styleBonus: { ranged: { accuracy: 4 } }, armour: 8, tint: '#a8743f' }, icon: { shape: 'platebody', color: '#a8743f', accent: '#5e3d1f' } }),
  sealed_jerkin: def({ id: 'sealed_jerkin', name: 'Gel-sealed jerkin', examine: 'A wolfhide jerkin sealed with slime gel. Rain and slime run straight off it.', stackable: false, kind: 'armour', value: 52, equip: { slot: 'body', styleBonus: { ranged: { accuracy: 5 } }, armour: 11, tint: '#7a8a4a' }, icon: { shape: 'platebody', color: '#8a8a4a', accent: '#6fdc5a' } }),
  leather_chaps: def({ id: 'leather_chaps', name: 'Wolfhide breeches', examine: 'Hard-wearing breeches, patched at the knee.', stackable: false, kind: 'armour', value: 28, equip: { slot: 'legs', styleBonus: { ranged: { accuracy: 3 } }, armour: 5, tint: '#a8743f' }, icon: { shape: 'platelegs', color: '#a8743f', accent: '#5e3d1f' } }),
  // Gem jewellery (docs/ORIGINALITY.md M2 follow-up): river agate for steady hands, garnet for a harder blow.
  agate_charm: def({ id: 'agate_charm', name: 'Agate charm', examine: 'A polished agate on a cord. Steadies the hand.', stackable: false, kind: 'armour', value: 70, equip: { slot: 'neck', accuracy: 2, armour: 1 }, icon: { shape: 'amulet', color: '#c9a06a', accent: '#8a5a34' } }),
  agate_ring: def({ id: 'agate_ring', name: 'Agate band', examine: 'A bronze band set with river agate. Said to turn aside a blow.', stackable: false, kind: 'armour', value: 80, equip: { slot: 'ring', armour: 2 }, icon: { shape: 'ring', color: '#c98a4b', accent: '#e8c890' } }),
  garnet_ring: def({ id: 'garnet_ring', name: 'Garnet ring', examine: 'An iron ring with an ironcrag garnet. Your blows land harder.', stackable: false, kind: 'armour', value: 170, equip: { slot: 'ring', power: 3 }, icon: { shape: 'ring', color: '#8d8d8d', accent: '#c8283a' } }),
  garnet_pendant: def({ id: 'garnet_pendant', name: 'Garnet pendant', examine: 'A garnet in a steel setting, warm as a coal against the chest.', stackable: false, kind: 'armour', value: 240, equip: { slot: 'neck', accuracy: 4, power: 3 }, icon: { shape: 'amulet', color: '#c8283a', accent: '#b8c2cc' } }),
  fang_amulet: def({ id: 'fang_amulet', name: 'Fang amulet', examine: 'A wolf fang on a cord. Its wearer strikes a little truer.', stackable: false, kind: 'armour', value: 30, equip: { slot: 'neck', accuracy: 3, power: 1, armour: 1 }, icon: { shape: 'amulet', color: '#f1ecd9', accent: '#8a5a34' } }),
  travellers_cape: def({ id: 'travellers_cape', name: "Traveller's cape", examine: 'A warm woollen cape for the road.', stackable: false, kind: 'armour', value: 20, equip: { slot: 'cape', armour: 1 }, icon: { shape: 'cape', color: '#2f6f8a', accent: '#c9a06a' } }),
  rake: def({ id: 'rake', name: 'Rake', examine: 'Clears weeds from a farming patch.', stackable: false, kind: 'tool', tool: { category: 'rake', tier: 1 }, value: 6, icon: { shape: 'rake', color: '#8a5a34', accent: '#a3aab3' } }),
  seed_dibber: def({ id: 'seed_dibber', name: 'Seed dibber', examine: 'Makes holes for planting seeds.', stackable: false, kind: 'tool', tool: { category: 'seed_dibber', tier: 1 }, value: 6, icon: { shape: 'dibber', color: '#8a5a34', accent: '#a3aab3' } }),
  spade: def({ id: 'spade', name: 'Spade', examine: 'For digging up crops.', stackable: false, kind: 'tool', tool: { category: 'spade', tier: 1 }, value: 6, icon: { shape: 'spade', color: '#8a5a34', accent: '#a3aab3' } }),
  weeds: def({ id: 'weeds', name: 'Weeds', examine: 'Raked from a farming patch.', stackable: false, kind: 'material', value: 1, icon: { shape: 'weeds', color: '#5a8a3a', accent: '#3a5a24' } }),
  potato: def({ id: 'potato', name: 'Sunroot', examine: 'A knobbly golden root, warm from the soil. Roast it on a range.', stackable: false, kind: 'material', value: 4, icon: { shape: 'potato', color: '#e0b04a', accent: '#8a6238' } }),
  onion: def({ id: 'onion', name: 'Wardleaf', examine: 'A silvery leaf that smells of rain. Burn it at the shrine or a waystone.', stackable: false, kind: 'material', value: 5, icon: { shape: 'onion', color: '#a8c4b8', accent: '#e8f4ee' } }),
  cabbage: def({ id: 'cabbage', name: 'Glowcap', examine: 'A pale mushroom with a faint green glow. Nutty. Heals 9 HP.', stackable: false, kind: 'food', value: 6, heal: 9, icon: { shape: 'cabbage', color: '#e8f0d8', accent: '#9ae87a' } }),
  baked_potato: def({ id: 'baked_potato', name: 'Roasted sunroot', examine: 'Sweet, golden and steaming. Heals 34 HP.', stackable: false, kind: 'food', value: 12, heal: 34, icon: { shape: 'potato', color: '#a8743f', accent: '#f6e2a0' } }),
  burnt_potato: def({ id: 'burnt_potato', name: 'Charred sunroot', examine: 'A lump of charcoal.', stackable: false, kind: 'material', value: 0, icon: { shape: 'potato', color: '#2e2622', accent: '#6a5a50' } }),
  saw: def({ id: 'saw', name: 'Saw', examine: 'For cutting planks to size when building.', stackable: false, kind: 'tool', tool: { category: 'saw', tier: 1 }, value: 8, icon: { shape: 'saw', color: '#a3aab3', accent: '#8a5a34' } }),
  plank: def({ id: 'plank', name: 'Plank', examine: 'A sawn plank. Builds basic furniture.', stackable: false, kind: 'material', value: 8, icon: { shape: 'plank', color: '#c9a06a', accent: '#8a6238' } }),
  oak_plank: def({ id: 'oak_plank', name: 'Oak plank', examine: 'A sturdy oak plank.', stackable: false, kind: 'material', value: 25, icon: { shape: 'plank', color: '#8a5a34', accent: '#5a3a20' } }),
  bronze_nails: def({ id: 'bronze_nails', name: 'Bronze nails', examine: 'For building furniture.', stackable: true, kind: 'material', value: 1, icon: { shape: 'nails', color: '#c98a4b', accent: '#7a4f2a' } }),
  iron_nails: def({ id: 'iron_nails', name: 'Iron nails', examine: 'For building furniture.', stackable: true, kind: 'material', value: 2, icon: { shape: 'nails', color: '#a3aab3', accent: '#4e5560' } }),
  steel_nails: def({ id: 'steel_nails', name: 'Steel nails', examine: 'For building furniture.', stackable: true, kind: 'material', value: 3, icon: { shape: 'nails', color: '#d3d9df', accent: '#5c646e' } }),
  glowcap_lantern: def({ id: 'glowcap_lantern', name: 'Glowcap lantern', examine: 'A bronze lantern that burns glowcaps from your bag, one every four minutes underground. Carry it into Glimmer Hollow.', stackable: false, kind: 'material', value: 40, icon: { shape: 'lantern', color: '#c98a4b', accent: '#b8ffa0' } }),
  fishing_rod: def({ id: 'fishing_rod', name: 'Riverwood rod', examine: 'A springy rod strung with bowstring line, for the clear pools upriver.', stackable: false, kind: 'tool', tool: { category: 'fishing_rod', tier: 1 }, value: 15, icon: { shape: 'rod', color: '#9b6a3a', accent: '#efe8d6' } }),
  small_fishing_net: def({ id: 'small_fishing_net', name: 'Hand net', examine: 'A light net on a short pole, for scooping brightfin and eels from the shallows.', stackable: false, kind: 'tool', tool: { category: 'small_net', tier: 1 }, value: 8, icon: { shape: 'net', color: '#c9b48a', accent: '#8a5a34' } }),
  // ---- Fletching parts
  bowstring: def({ id: 'bowstring', name: 'Bowstring', examine: 'Strong twisted cord for stringing a bow.', stackable: false, kind: 'material', value: 4, icon: { shape: 'string', color: '#efe8d6', accent: '#b9ad90' } }),
  shortbow_u: def({ id: 'shortbow_u', name: 'Unstrung shortbow', examine: 'Needs a bowstring.', stackable: false, kind: 'material', value: 10, icon: { shape: 'unbow', color: '#9b6a3a', accent: '#9b6a3a' } }),
  oak_shortbow_u: def({ id: 'oak_shortbow_u', name: 'Unstrung oak shortbow', examine: 'Needs a bowstring.', stackable: false, kind: 'material', value: 30, icon: { shape: 'unbow', color: '#6e472c', accent: '#6e472c' } }),
  // ---- Fishing and cooking
  // Glass trout: so clear you can see the river through it. Rod-caught in the clear pools upriver.
  raw_glass_trout: def({ id: 'raw_glass_trout', name: 'Raw glass trout', examine: 'Nearly see-through, with a faint silver spine. Cook it first.', stackable: false, kind: 'material', value: 16, icon: { shape: 'fish', color: '#cfe8ee', accent: '#ffffff' } }),
  glass_trout: def({ id: 'glass_trout', name: 'Glass trout', examine: 'Flaky, clean and delicate. Heals 30 HP.', stackable: false, kind: 'food', value: 26, heal: 30, icon: { shape: 'fish', color: '#e8d0b0', accent: '#fff6e8' } }),
  // Ember carp: lives in the hot springs of the Ironcrag Hills. Its scales shrug off flame, so it never burns.
  raw_ember_carp: def({ id: 'raw_ember_carp', name: 'Raw ember carp', examine: 'Warm to the touch, with scales like banked coals. It cannot burn.', stackable: false, kind: 'material', value: 30, icon: { shape: 'fish', color: '#d8602a', accent: '#ffd27a' } }),
  ember_carp: def({ id: 'ember_carp', name: 'Ember carp', examine: 'Rich and smoky. Heals 34 HP and rekindles 4 devotion.', stackable: false, kind: 'food', value: 48, heal: 34, devotion: 4, icon: { shape: 'fish', color: '#b8481e', accent: '#ffe0a0' } }),
  // Brightwater's river fish (ids kept from earlier content so saves carry over: docs/ORIGINALITY.md H7).
  raw_shrimps: def({ id: 'raw_shrimps', name: 'Raw brightfin', examine: 'A little river fish whose gold-edged fins flash in the shallows. Cook it first.', stackable: false, kind: 'material', value: 3, icon: { shape: 'fish', color: '#d8dfe6', accent: '#f5c542' } }),
  shrimps: def({ id: 'shrimps', name: 'Brightfin', examine: 'Crisp, golden and sweet. Heals 16 HP.', stackable: false, kind: 'food', value: 6, heal: 16, icon: { shape: 'fish', color: '#e0b060', accent: '#fff2c8' } }),
  raw_anchovies: def({ id: 'raw_anchovies', name: 'Raw mudskipper eel', examine: 'A slippery eel from the muddy banks. It wriggles even now. Cook it first.', stackable: false, kind: 'material', value: 7, icon: { shape: 'eel', color: '#6a6a4a', accent: '#c9c08a' } }),
  anchovies: def({ id: 'anchovies', name: 'Smoked mudskipper', examine: 'Rich, smoky eel. Heals 24 HP.', stackable: false, kind: 'food', value: 12, heal: 24, icon: { shape: 'eel', color: '#8a5a34', accent: '#e6c48f' } }),
  // ---- Mirefen Marsh (Phase 4A, docs/WORLD_EXPANSION.md)
  // Marsh willow: pale, whippy wood from the groves round Heronwick's pools.
  willow_logs: def({ id: 'willow_logs', name: 'Willow logs', examine: 'Pale, supple wood from the Mirefen willows. Bends a long way before it breaks.', stackable: false, kind: 'material', value: 22, icon: { shape: 'log', color: '#a89a6a', accent: '#efe6c0' } }),
  willow_shortbow_u: def({ id: 'willow_shortbow_u', name: 'Unstrung willow shortbow', examine: 'Needs a bowstring.', stackable: false, kind: 'material', value: 55, icon: { shape: 'unbow', color: '#a89a6a', accent: '#a89a6a' } }),
  willow_shortbow: def({ id: 'willow_shortbow', name: 'Willow shortbow', examine: 'A quick, whippy marsh bow. Heronwick’s lantern-keepers swear by them.', stackable: false, kind: 'weapon', value: 150, equip: { slot: 'weapon', style: 'ranged', accuracy: 36, power: 23, twoHanded: true, req: { ranged: 25 }, tint: '#a89a6a' }, icon: { shape: 'bow', color: '#a89a6a', accent: '#efe8d6' } }),
  // Silverpike: long, lean and quick, it hunts the still mire pools. Rod-caught.
  raw_silverpike: def({ id: 'raw_silverpike', name: 'Raw silverpike', examine: 'A long, lean pool-hunter with a mirror-bright flank. Cook it first.', stackable: false, kind: 'material', value: 34, icon: { shape: 'fish', color: '#b8c6cc', accent: '#eef6f8' } }),
  silverpike: def({ id: 'silverpike', name: 'Silverpike', examine: 'Firm white flesh with a peaty tang. Heals 32 HP.', stackable: false, kind: 'food', value: 56, heal: 32, icon: { shape: 'fish', color: '#d8b888', accent: '#fff2d8' } }),
  // Marsh pearls: grown by mire mussels in the pools; now and then one comes up on a line.
  marsh_pearl: def({ id: 'marsh_pearl', name: 'Marsh pearl', examine: 'A soft green-white pearl from a mire mussel. A silversmith could set it.', stackable: false, kind: 'material', value: 90, icon: { shape: 'gem', color: '#e6efe0', accent: '#a8c8a0' } }),
  // Mire oil: rendered from leeches. It reeks, but it burns clean and long in a lantern.
  mire_oil: def({ id: 'mire_oil', name: 'Mire oil', examine: 'A stoppered flask of dark leech oil. Heronwick’s lanterns burn it.', stackable: true, kind: 'material', value: 9, icon: { shape: 'gel', color: '#4a3a24', accent: '#d8a84a' } }),
  // ---- Thornridge Highlands (Phase 4A)
  // Highland silver: bright veins in the crags above Cairnhold. Soft, so it is worked into jewellery, not blades.
  silver_ore: def({ id: 'silver_ore', name: 'Silver ore', examine: 'Grey rock threaded with bright metal, from the Thornridge crags.', stackable: false, kind: 'material', value: 40, icon: { shape: 'ore', color: '#7a7c80', accent: '#eef2f6' } }),
  silver_bar: def({ id: 'silver_bar', name: 'Silver bar', examine: 'A soft, bright bar. Too soft for a blade; perfect for a ring.', stackable: false, kind: 'material', value: 95, icon: { shape: 'bar', color: '#dfe4ea', accent: '#ffffff' } }),
  silver_ring: def({ id: 'silver_ring', name: 'Thornridge band', examine: 'A plain silver band, cold from the hills. Steadies the hand and the nerve.', stackable: false, kind: 'armour', value: 260, equip: { slot: 'ring', accuracy: 2, power: 3, armour: 2 }, icon: { shape: 'ring', color: '#dfe4ea', accent: '#ffffff' } }),
  // The two regions' crafts meet: a marsh pearl in highland silver.
  mirepearl_amulet: def({ id: 'mirepearl_amulet', name: 'Mirepearl amulet', examine: 'A marsh pearl caged in Thornridge silver. It seems to catch light that isn’t there.', stackable: false, kind: 'armour', value: 420, equip: { slot: 'neck', accuracy: 5, power: 4, armour: 2 }, icon: { shape: 'amulet', color: '#e6efe0', accent: '#dfe4ea' } }),
  // ---- Phase 4B: ranged and magic tiers (docs/PROGRESSION.md)
  // Rowan: the highland ash of Thornridge, hard and springy. The best bow and staff wood in the known lands.
  rowan_logs: def({ id: 'rowan_logs', name: 'Rowan logs', examine: 'Hard, springy wood from the Thornridge rowans, flecked with red berries.', stackable: false, kind: 'material', value: 42, icon: { shape: 'log', color: '#8a5a3a', accent: '#e8c49a' } }),
  rowan_shortbow_u: def({ id: 'rowan_shortbow_u', name: 'Unstrung rowan shortbow', examine: 'Needs a bowstring.', stackable: false, kind: 'material', value: 90, icon: { shape: 'unbow', color: '#8a5a3a', accent: '#8a5a3a' } }),
  rowan_shortbow: def({ id: 'rowan_shortbow', name: 'Rowan shortbow', examine: 'A fast highland bow that snaps back like a sprung trap.', stackable: false, kind: 'weapon', value: 260, equip: { slot: 'weapon', style: 'ranged', accuracy: 42, power: 28, twoHanded: true, req: { ranged: 35 }, tint: '#8a5a3a' }, icon: { shape: 'bow', color: '#8a5a3a', accent: '#efe8d6' } }),
  rowan_longbow: def({ id: 'rowan_longbow', name: 'Rowan longbow', examine: 'A tall rowan bow. It takes a strong arm, and it hits like one.', stackable: false, kind: 'weapon', value: 380, equip: { slot: 'weapon', style: 'ranged', speed: 2, range: 8.5, accuracy: 46, power: 44, twoHanded: true, req: { ranged: 40 }, tint: '#7a4a2e' }, icon: { shape: 'bow', color: '#7a4a2e', accent: '#efe8d6' } }),
  rowan_staff: def({ id: 'rowan_staff', name: 'Rowan staff', examine: 'A rowan staff capped with silver and packed with spark chips. It hums in the hand.', stackable: false, kind: 'weapon', value: 420, equip: { slot: 'weapon', style: 'magic', speed: 2.5, range: 7.5, accuracy: 42, power: 50, twoHanded: true, req: { magic: 40 }, tint: '#8a5a3a' }, icon: { shape: 'wand', color: '#8a5a3a', accent: '#dfe4ea' } }),
  mirelight_wand: def({ id: 'mirelight_wand', name: 'Mirelight wand', examine: 'Willow wound round a marsh pearl. The pearl glows like a lantern seen through fog.', stackable: false, kind: 'weapon', value: 340, equip: { slot: 'weapon', style: 'magic', accuracy: 38, power: 31, req: { magic: 35 }, tint: '#a89a6a' }, icon: { shape: 'wand', color: '#a89a6a', accent: '#e6efe0' } }),
  // Iron and steel arrowheads (between bronze and glimsteel).
  iron_arrow: def({ id: 'iron_arrow', name: 'Iron arrows', examine: 'Iron-headed arrows. Wear them in your ammo slot.', stackable: true, kind: 'ammo', value: 2, equip: { slot: 'ammo', ammoFor: 'ranged', accuracy: 1, power: 2, req: { ranged: 10 } }, icon: { shape: 'arrow', color: '#a3aab3', accent: '#f2f2f2' } }),
  steel_arrow: def({ id: 'steel_arrow', name: 'Steel arrows', examine: 'Steel-headed arrows with a wicked point. Wear them in your ammo slot.', stackable: true, kind: 'ammo', value: 4, equip: { slot: 'ammo', ammoFor: 'ranged', accuracy: 2, power: 3, req: { ranged: 20 } }, icon: { shape: 'arrow', color: '#d3d9df', accent: '#f2f2f2' } }),
  // Boarhide (Thornridge boars): a tough, bristly leather for archers.
  boar_hide: def({ id: 'boar_hide', name: 'Bristleback hide', examine: 'A thick, bristly boar hide. A tanner can cure it.', stackable: false, kind: 'material', value: 18, icon: { shape: 'pelt', color: '#6a4a34', accent: '#a08060' } }),
  boar_leather: def({ id: 'boar_leather', name: 'Boarhide leather', examine: 'Cured boarhide, stiff and hard-wearing. Sew it with a needle and thread.', stackable: false, kind: 'material', value: 30, icon: { shape: 'leather', color: '#7a5a3a', accent: '#4a3020' } }),
  boarhide_vambraces: def({ id: 'boarhide_vambraces', name: 'Boarhide bracers', examine: 'Stiff bracers of boarhide. The bowstring never bites through.', stackable: false, kind: 'armour', value: 60, equip: { slot: 'hands', styleBonus: { ranged: { accuracy: 5 } }, armour: 4, req: { ranged: 20 } }, icon: { shape: 'vambraces', color: '#7a5a3a', accent: '#4a3020' } }),
  boarhide_coif: def({ id: 'boarhide_coif', name: 'Boarhide cap', examine: 'A close boarhide hood, bristles turned in for warmth.', stackable: false, kind: 'armour', value: 70, equip: { slot: 'head', styleBonus: { ranged: { accuracy: 3 } }, armour: 5, req: { ranged: 20 }, tint: '#7a5a3a' }, icon: { shape: 'cowl', color: '#7a5a3a', accent: '#4a3020' } }),
  boarhide_chaps: def({ id: 'boarhide_chaps', name: 'Boarhide leggings', examine: 'Boarhide leggings that shrug off thorns and teeth.', stackable: false, kind: 'armour', value: 110, equip: { slot: 'legs', styleBonus: { ranged: { accuracy: 5 } }, armour: 9, req: { ranged: 20 }, tint: '#7a5a3a' }, icon: { shape: 'platelegs', color: '#7a5a3a', accent: '#4a3020' } }),
  boarhide_body: def({ id: 'boarhide_body', name: 'Boarhide coat', examine: 'A heavy coat of boarhide, laced up the side.', stackable: false, kind: 'armour', value: 170, equip: { slot: 'body', styleBonus: { ranged: { accuracy: 7 } }, armour: 14, req: { ranged: 20, defence: 20 }, tint: '#7a5a3a' }, icon: { shape: 'platebody', color: '#7a5a3a', accent: '#4a3020' } }),
  // Ridgehide (Thornridge stalkers): light grey leather, supple as cloth and nearly as tough as mail.
  ridge_pelt: def({ id: 'ridge_pelt', name: 'Ridge stalker pelt', examine: 'A lean grey pelt from a ridge stalker. A tanner can cure it.', stackable: false, kind: 'material', value: 34, icon: { shape: 'pelt', color: '#9a9ea6', accent: '#d8dce2' } }),
  ridgehide: def({ id: 'ridgehide', name: 'Ridgehide', examine: 'Cured stalker hide, grey and supple. Sew it with a needle and thread.', stackable: false, kind: 'material', value: 55, icon: { shape: 'leather', color: '#8a8e96', accent: '#5a5e66' } }),
  ridgehide_vambraces: def({ id: 'ridgehide_vambraces', name: 'Ridgehide bracers', examine: 'Grey bracers that steady the aim.', stackable: false, kind: 'armour', value: 120, equip: { slot: 'hands', styleBonus: { ranged: { accuracy: 7 } }, armour: 6, req: { ranged: 30 } }, icon: { shape: 'vambraces', color: '#8a8e96', accent: '#5a5e66' } }),
  ridgehide_coif: def({ id: 'ridgehide_coif', name: 'Ridgehide cap', examine: 'A grey hood that sits silent in the wind.', stackable: false, kind: 'armour', value: 140, equip: { slot: 'head', styleBonus: { ranged: { accuracy: 5 } }, armour: 7, req: { ranged: 30 }, tint: '#8a8e96' }, icon: { shape: 'cowl', color: '#8a8e96', accent: '#5a5e66' } }),
  ridgehide_chaps: def({ id: 'ridgehide_chaps', name: 'Ridgehide leggings', examine: 'Grey leggings, quiet as a stalker on scree.', stackable: false, kind: 'armour', value: 220, equip: { slot: 'legs', styleBonus: { ranged: { accuracy: 7 } }, armour: 13, req: { ranged: 30 }, tint: '#8a8e96' }, icon: { shape: 'platelegs', color: '#8a8e96', accent: '#5a5e66' } }),
  ridgehide_body: def({ id: 'ridgehide_body', name: 'Ridgehide coat', examine: 'A grey coat of stalker hide. It moves with you, and turns a blade.', stackable: false, kind: 'armour', value: 340, equip: { slot: 'body', styleBonus: { ranged: { accuracy: 10 } }, armour: 20, req: { ranged: 30, defence: 30 }, tint: '#8a8e96' }, icon: { shape: 'platebody', color: '#8a8e96', accent: '#5a5e66' } }),
  // Linen (spun bluebell flax) and mireweave (linen proofed with mire oil): robes for mages.
  linen: def({ id: 'linen', name: 'Bluebell linen', examine: 'A bolt of linen spun from bluebell flax, faintly blue.', stackable: false, kind: 'material', value: 12, icon: { shape: 'thread', color: '#c8d4e8', accent: '#7fa8e8' } }),
  linen_hood: def({ id: 'linen_hood', name: 'Linen hood', examine: 'A soft linen hood. Mages say it helps them think.', stackable: false, kind: 'armour', value: 24, equip: { slot: 'head', styleBonus: { magic: { accuracy: 2 } }, armour: 1, tint: '#c8d4e8' }, icon: { shape: 'cowl', color: '#c8d4e8', accent: '#ffffff' } }),
  linen_skirt: def({ id: 'linen_skirt', name: 'Linen robe skirt', examine: 'A long linen skirt, easy to move in.', stackable: false, kind: 'armour', value: 36, equip: { slot: 'legs', styleBonus: { magic: { accuracy: 3 } }, armour: 2, tint: '#c8d4e8' }, icon: { shape: 'platelegs', color: '#c8d4e8', accent: '#ffffff' } }),
  linen_robe: def({ id: 'linen_robe', name: 'Linen robe', examine: 'A loose linen robe with wide sleeves.', stackable: false, kind: 'armour', value: 48, equip: { slot: 'body', styleBonus: { magic: { accuracy: 4, power: 1 } }, armour: 3, tint: '#c8d4e8' }, icon: { shape: 'platebody', color: '#c8d4e8', accent: '#ffffff' } }),
  mireweave_hood: def({ id: 'mireweave_hood', name: 'Mireweave hood', examine: 'Linen proofed with mire oil. It keeps off rain, and stray sparks.', stackable: false, kind: 'armour', value: 150, equip: { slot: 'head', styleBonus: { magic: { accuracy: 4, power: 2 } }, armour: 3, req: { magic: 25 }, tint: '#4a5a4a' }, icon: { shape: 'cowl', color: '#4a5a4a', accent: '#ffffff' } }),
  mireweave_skirt: def({ id: 'mireweave_skirt', name: 'Mireweave skirt', examine: 'A dark, oil-proofed robe skirt that sheds water.', stackable: false, kind: 'armour', value: 210, equip: { slot: 'legs', styleBonus: { magic: { accuracy: 5, power: 3 } }, armour: 4, req: { magic: 25 }, tint: '#4a5a4a' }, icon: { shape: 'platelegs', color: '#4a5a4a', accent: '#ffffff' } }),
  mireweave_robe: def({ id: 'mireweave_robe', name: 'Mireweave robe', examine: 'A dark green robe, oiled against the marsh damp. Spells come easier in it.', stackable: false, kind: 'armour', value: 300, equip: { slot: 'body', styleBonus: { magic: { accuracy: 7, power: 4 } }, armour: 6, req: { magic: 25 }, tint: '#4a5a4a' }, icon: { shape: 'platebody', color: '#4a5a4a', accent: '#ffffff' } }),
  // ---- Dungeon uniques (Phase 4C, docs/DUNGEONS.md): only from the end chests, a step above crafted gear.
  tidecaller_wand: def({ id: 'tidecaller_wand', name: 'Tidecaller wand', examine: 'A wand of black shrine-coral. Water beads on it and will not fall.', stackable: false, kind: 'weapon', value: 900, equip: { slot: 'weapon', style: 'magic', accuracy: 46, power: 39, req: { magic: 45 }, tint: '#1f4a58' }, icon: { shape: 'wand', color: '#1f4a58', accent: '#5fe8d0' } }),
  heronscale_hood: def({ id: 'heronscale_hood', name: 'Heronscale hood', examine: 'Grey-green scales sewn like feathers. The Shrinekeeper wore it to its rites.', stackable: false, kind: 'armour', value: 700, equip: { slot: 'head', styleBonus: { magic: { accuracy: 6, power: 3 } }, armour: 6, req: { magic: 40, defence: 20 }, tint: '#6f8a84' }, icon: { shape: 'cowl', color: '#6f8a84', accent: '#9fe8d8' } }),
  drowned_signet: def({ id: 'drowned_signet', name: 'Drowned signet', examine: 'A green-gold ring from the shrine floor. It feels heavier than it is.', stackable: false, kind: 'armour', value: 650, equip: { slot: 'ring', accuracy: 3, power: 4, armour: 2 }, icon: { shape: 'ring', color: '#a8a04a', accent: '#5fe8d0' } }),
  watchcaptain_blade: def({ id: 'watchcaptain_blade', name: 'Watchcaptain’s blade', examine: 'The last captain’s sword, still keen after a hundred years of waiting.', stackable: false, kind: 'weapon', value: 1100, equip: { slot: 'weapon', style: 'melee', accuracy: 52, power: 47, req: { attack: 50 }, tint: '#c8ccd4' }, icon: { shape: 'sword', color: '#c8ccd4', accent: '#a83a2a' } }),
  warders_longbow: def({ id: 'warders_longbow', name: 'Warder’s longbow', examine: 'A watch bow of rowan and horn, its grip worn smooth by a hundred hands.', stackable: false, kind: 'weapon', value: 1000, equip: { slot: 'weapon', style: 'ranged', speed: 2, range: 8.5, accuracy: 50, power: 51, twoHanded: true, req: { ranged: 45 }, tint: '#6a3a24' }, icon: { shape: 'bow', color: '#6a3a24', accent: '#efe8d6' } }),
  ninefold_cloak: def({ id: 'ninefold_cloak', name: 'Ninefold cloak', examine: 'A grey cloak stitched with nine silver stones. The old watch wore them.', stackable: false, kind: 'armour', value: 600, equip: { slot: 'cape', accuracy: 2, power: 2, armour: 4, req: { defence: 35 } }, icon: { shape: 'cape', color: '#6a6e76', accent: '#dfe4ea' } }),
  burnt_fish: def({ id: 'burnt_fish', name: 'Burnt fish', examine: 'Charred to a crisp.', stackable: false, kind: 'material', value: 0, icon: { shape: 'fish', color: '#2e2622', accent: '#6a5a50' } }),
} satisfies Record<string, ItemDef>;

export type ItemId = keyof typeof ITEMS;

export function itemDef(id: string): ItemDef {
  const d = (ITEMS as Record<string, ItemDef>)[id];
  if (!d) throw new Error(`Unknown item ${id}`);
  return d;
}

export function isItemId(id: string): id is ItemId {
  return id in ITEMS;
}

/** Coin value at or above which dropping asks for confirmation (per item, or for a whole stack). */
export const VALUABLE_DROP_VALUE = 15;

/** Whether dropping `qty` of an item should be confirmed first (tools, and anything valuable). */
export function dropNeedsConfirm(id: ItemId, qty: number): boolean {
  const d = itemDef(id);
  return d.kind === 'tool' || d.value >= VALUABLE_DROP_VALUE || d.value * qty >= VALUABLE_DROP_VALUE * 4;
}
