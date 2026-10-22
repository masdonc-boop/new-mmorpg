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
  /** Bows need both hands: a shield can't be worn with them. */
  twoHanded?: boolean;
  /** Minimum skill levels to wear it. */
  req?: Partial<Record<'attack' | 'strength' | 'defence' | 'ranged' | 'magic', number>>;
  /** Ammo slot only: the combat style that fires it (worn as a whole stack, used one per shot). */
  ammoFor?: 'ranged';
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
  equip?: EquipDef;
  /** Tools: toolbelt category, tier and use requirement (see data/tools.ts). */
  tool?: ToolInfo;
  icon: { shape: IconShape; color: string; accent?: string };
}

const def = (d: Omit<ItemDef, 'maxStack'> & { maxStack?: number }): ItemDef => ({
  maxStack: d.stackable ? 99_999 : 1,
  ...d,
});

export const ITEMS = {
  coins: def({ id: 'coins', name: 'Coins', examine: 'Shiny golden crowns.', stackable: true, kind: 'currency', value: 1, icon: { shape: 'coins', color: '#f5c542', accent: '#c48a12' } }),
  logs: def({ id: 'logs', name: 'Logs', examine: 'Freshly cut timber.', stackable: false, kind: 'material', value: 4, icon: { shape: 'log', color: '#9b6a3a', accent: '#e6c48f' } }),
  oak_logs: def({ id: 'oak_logs', name: 'Oak logs', examine: 'Sturdy oak timber.', stackable: false, kind: 'material', value: 12, icon: { shape: 'log', color: '#7a4f2a', accent: '#d9a866' } }),
  copper_ore: def({ id: 'copper_ore', name: 'Copper ore', examine: 'Ore with a warm orange sheen.', stackable: false, kind: 'material', value: 5, icon: { shape: 'ore', color: '#7c6f66', accent: '#e8833a' } }),
  tin_ore: def({ id: 'tin_ore', name: 'Tin ore', examine: 'Soft silvery ore.', stackable: false, kind: 'material', value: 5, icon: { shape: 'ore', color: '#7c7a78', accent: '#d8dde2' } }),
  iron_ore: def({ id: 'iron_ore', name: 'Iron ore', examine: 'Heavy, dark and valuable.', stackable: false, kind: 'material', value: 18, icon: { shape: 'ore', color: '#5f5550', accent: '#b35a43' } }),
  coal_ore: def({ id: 'coal_ore', name: 'Coal', examine: 'Black and dusty. Smelted with iron ore to make steel.', stackable: false, kind: 'material', value: 25, icon: { shape: 'ore', color: '#2f2d2c', accent: '#5a5856' } }),
  sapphire: def({ id: 'sapphire', name: 'Uncut sapphire', examine: 'A rare blue gem found while mining.', stackable: false, kind: 'material', value: 60, icon: { shape: 'gem', color: '#3a6fe8', accent: '#bcd2ff' } }),
  bronze_arrow: def({ id: 'bronze_arrow', name: 'Bronze arrows', examine: 'Fired from a bow. Wear them in your ammo slot.', stackable: true, kind: 'ammo', value: 1, equip: { slot: 'ammo', ammoFor: 'ranged' }, icon: { shape: 'arrow', color: '#c98a4b', accent: '#f2f2f2' } }),
  air_rune: def({ id: 'air_rune', name: 'Spark stones', examine: 'Quartz chips charged at a shrine. A wand burns one per spell.', stackable: true, kind: 'ammo', value: 2, icon: { shape: 'spark', color: '#8fe8ff', accent: '#ffffff' } }),
  spark_quartz: def({ id: 'spark_quartz', name: 'Spark quartz', examine: 'Cloudy crystal from the Ironcrag Hills. It hums faintly. Chip it with a chisel.', stackable: false, kind: 'material', value: 6, icon: { shape: 'ore', color: '#7c8a96', accent: '#8fe8ff' } }),
  dull_spark: def({ id: 'dull_spark', name: 'Dull spark chips', examine: 'Quartz chips waiting to be charged at the shrine or a waystone.', stackable: true, kind: 'material', value: 1, icon: { shape: 'spark', color: '#9aa6b0', accent: '#d6dde3' } }),
  slime_gel: def({ id: 'slime_gel', name: 'Slime gel', examine: 'Wobbly. Alchemists might want it.', stackable: true, kind: 'material', value: 3, icon: { shape: 'gel', color: '#6fdc5a', accent: '#d8ffd0' } }),
  wolf_pelt: def({ id: 'wolf_pelt', name: 'Wolf pelt', examine: 'Thick grey fur. A tanner can make leather from it.', stackable: false, kind: 'material', value: 15, icon: { shape: 'pelt', color: '#8c8f99', accent: '#d7d9de' } }),
  wolf_fang: def({ id: 'wolf_fang', name: 'Wolf fang', examine: 'Sharp as a dagger.', stackable: true, kind: 'trophy', value: 8, icon: { shape: 'fang', color: '#f1ecd9', accent: '#b8ad8a' } }),
  bones: def({ id: 'bones', name: 'Bones', examine: 'Remains of a fallen foe. Bury them to honour the shrine spirits (Devotion).', stackable: false, kind: 'material', value: 2, icon: { shape: 'bone', color: '#efe8d6', accent: '#b9ad90' } }),
  big_bones: def({ id: 'big_bones', name: "Warlord's bones", examine: 'The massive bones of a goblin warlord. The shrine spirits favour them.', stackable: false, kind: 'material', value: 12, icon: { shape: 'bone', color: '#f6f0de', accent: '#a99c7c' } }),
  potato_seed: def({ id: 'potato_seed', name: 'Potato seed', examine: 'Plant in an allotment (Farming 1).', stackable: true, kind: 'material', value: 2, icon: { shape: 'seed', color: '#c9a06a', accent: '#7a5a34' } }),
  onion_seed: def({ id: 'onion_seed', name: 'Onion seed', examine: 'Plant in an allotment (Farming 5).', stackable: true, kind: 'material', value: 3, icon: { shape: 'seed', color: '#e8d6a0', accent: '#a07a3a' } }),
  cabbage_seed: def({ id: 'cabbage_seed', name: 'Cabbage seed', examine: 'Plant in an allotment (Farming 7).', stackable: true, kind: 'material', value: 4, icon: { shape: 'seed', color: '#9ec46a', accent: '#5a7a34' } }),
  bread: def({ id: 'bread', name: 'Bread', examine: 'Warm village bread. Heals 30 HP.', stackable: false, kind: 'food', value: 6, heal: 30, icon: { shape: 'bread', color: '#d99a4e', accent: '#f6d7a0' } }),
  bronze_axe: def({ id: 'bronze_axe', name: 'Bronze axe', examine: 'Required for woodcutting.', stackable: false, kind: 'tool', tool: { category: 'axe', tier: 1 }, value: 16, icon: { shape: 'axe', color: '#c98a4b', accent: '#7a4f2a' } }),
  bronze_pickaxe: def({ id: 'bronze_pickaxe', name: 'Bronze pickaxe', examine: 'Required for mining.', stackable: false, kind: 'tool', tool: { category: 'pickaxe', tier: 1 }, value: 16, icon: { shape: 'pickaxe', color: '#c98a4b', accent: '#7a4f2a' } }),

  // ---- Smithing: bars and bronze / iron equipment
  bronze_bar: def({ id: 'bronze_bar', name: 'Bronze bar', examine: 'Copper and tin, smelted together.', stackable: false, kind: 'material', value: 14, icon: { shape: 'bar', color: '#c98a4b', accent: '#f0b47a' } }),
  iron_bar: def({ id: 'iron_bar', name: 'Iron bar', examine: 'A bar of strong, dark iron.', stackable: false, kind: 'material', value: 40, icon: { shape: 'bar', color: '#8d949c', accent: '#d5dbe1' } }),
  steel_bar: def({ id: 'steel_bar', name: 'Steel bar', examine: 'Iron hardened with coal. Strong and bright.', stackable: false, kind: 'material', value: 70, icon: { shape: 'bar', color: '#d3d9df', accent: '#f4f7fa' } }),
  steel_dagger: def({ id: 'steel_dagger', name: 'Steel dagger', examine: 'A quick, keen steel blade.', stackable: false, kind: 'weapon', value: 50, equip: { slot: 'weapon', style: 'melee', accuracy: 30, power: 24, req: { attack: 20 }, tint: '#d3d9df' }, icon: { shape: 'dagger', color: '#d3d9df', accent: '#5c646e' } }),
  steel_sword: def({ id: 'steel_sword', name: 'Steel sword', examine: 'Well balanced and very sharp.', stackable: false, kind: 'weapon', value: 150, equip: { slot: 'weapon', style: 'melee', accuracy: 34, power: 29, req: { attack: 20 }, tint: '#d3d9df' }, icon: { shape: 'sword', color: '#d3d9df', accent: '#5c646e' } }),
  steel_helm: def({ id: 'steel_helm', name: 'Steel helm', examine: 'A bright steel helm.', stackable: false, kind: 'armour', value: 110, equip: { slot: 'head', armour: 12, req: { defence: 20 }, tint: '#d3d9df' }, icon: { shape: 'helm', color: '#d3d9df', accent: '#5c646e' } }),
  steel_shield: def({ id: 'steel_shield', name: 'Steel shield', examine: 'Steel-faced and hard to dent.', stackable: false, kind: 'armour', value: 170, equip: { slot: 'shield', armour: 19, req: { defence: 20 }, tint: '#d3d9df' }, icon: { shape: 'shield', color: '#d3d9df', accent: '#4e3a2a' } }),
  steel_platelegs: def({ id: 'steel_platelegs', name: 'Steel greaves', examine: 'Steel greaves, strapped over the thighs and shins.', stackable: false, kind: 'armour', value: 200, equip: { slot: 'legs', armour: 21, req: { defence: 20 }, tint: '#d3d9df' }, icon: { shape: 'platelegs', color: '#d3d9df', accent: '#5c646e' } }),
  steel_platebody: def({ id: 'steel_platebody', name: 'Steel breastplate', examine: 'A polished steel breastplate.', stackable: false, kind: 'armour', value: 300, equip: { slot: 'body', armour: 30, req: { defence: 20 }, tint: '#d3d9df' }, icon: { shape: 'platebody', color: '#d3d9df', accent: '#5c646e' } }),
  glimmerite_ore: def({ id: 'glimmerite_ore', name: 'Glimmerite ore', examine: 'Pale ore from the deep Ironcrag veins. It glitters even in shadow.', stackable: false, kind: 'material', value: 60, icon: { shape: 'ore', color: '#8e98a2', accent: '#e6f4ff' } }),
  glimsteel_bloom: def({ id: 'glimsteel_bloom', name: 'Hot glimsteel bloom', examine: 'Glowing metal fresh from the furnace. Quench it in running water to set it.', stackable: false, kind: 'material', value: 90, icon: { shape: 'bar', color: '#ffb26a', accent: '#fff2c8' } }),
  glimsteel_bar: def({ id: 'glimsteel_bar', name: 'Glimsteel bar', examine: 'Quenched glimsteel: light, keen and faintly shining.', stackable: false, kind: 'material', value: 160, icon: { shape: 'bar', color: '#cfe4f2', accent: '#ffffff' } }),
  glimsteel_dagger: def({ id: 'glimsteel_dagger', name: 'Glimsteel dagger', examine: 'Light enough to forget you carry it.', stackable: false, kind: 'weapon', value: 120, equip: { slot: 'weapon', style: 'melee', accuracy: 39, power: 31, req: { attack: 30 }, tint: '#cfe4f2' }, icon: { shape: 'dagger', color: '#cfe4f2', accent: '#5a7a8e' } }),
  glimsteel_sword: def({ id: 'glimsteel_sword', name: 'Glimsteel sword', examine: 'A shining, quick blade.', stackable: false, kind: 'weapon', value: 330, equip: { slot: 'weapon', style: 'melee', accuracy: 44, power: 37, req: { attack: 30 }, tint: '#cfe4f2' }, icon: { shape: 'sword', color: '#cfe4f2', accent: '#5a7a8e' } }),
  glimsteel_helm: def({ id: 'glimsteel_helm', name: 'Glimsteel helm', examine: 'A light helm that never seems to dull.', stackable: false, kind: 'armour', value: 250, equip: { slot: 'head', armour: 16, accuracy: 1, req: { defence: 30 }, tint: '#cfe4f2' }, icon: { shape: 'helm', color: '#cfe4f2', accent: '#5a7a8e' } }),
  glimsteel_shield: def({ id: 'glimsteel_shield', name: 'Glimsteel shield', examine: 'Bright as a mirror.', stackable: false, kind: 'armour', value: 380, equip: { slot: 'shield', armour: 25, accuracy: 1, req: { defence: 30 }, tint: '#cfe4f2' }, icon: { shape: 'shield', color: '#cfe4f2', accent: '#5a7a8e' } }),
  glimsteel_platelegs: def({ id: 'glimsteel_platelegs', name: 'Glimsteel greaves', examine: 'Light greaves that let you move freely.', stackable: false, kind: 'armour', value: 450, equip: { slot: 'legs', armour: 28, accuracy: 1, req: { defence: 30 }, tint: '#cfe4f2' }, icon: { shape: 'platelegs', color: '#cfe4f2', accent: '#5a7a8e' } }),
  glimsteel_platebody: def({ id: 'glimsteel_platebody', name: 'Glimsteel breastplate', examine: 'Light, bright armour. Its wearer strikes a touch truer.', stackable: false, kind: 'armour', value: 680, equip: { slot: 'body', armour: 40, accuracy: 2, req: { defence: 30 }, tint: '#cfe4f2' }, icon: { shape: 'platebody', color: '#cfe4f2', accent: '#5a7a8e' } }),
  bronze_dagger: def({ id: 'bronze_dagger', name: 'Bronze dagger', examine: 'Short, sharp and light.', stackable: false, kind: 'weapon', value: 20, equip: { slot: 'weapon', style: 'melee', accuracy: 15, power: 11, tint: '#c98a4b' }, icon: { shape: 'dagger', color: '#c98a4b', accent: '#7a4f2a' } }),
  bronze_sword: def({ id: 'bronze_sword', name: 'Bronze sword', examine: 'A dependable blade of village make.', stackable: false, kind: 'weapon', value: 32, equip: { slot: 'weapon', style: 'melee', accuracy: 18, power: 15, tint: '#c98a4b' }, icon: { shape: 'sword', color: '#c98a4b', accent: '#7a4f2a' } }),
  iron_sword: def({ id: 'iron_sword', name: 'Iron sword', examine: 'Heavier and keener than bronze.', stackable: false, kind: 'weapon', value: 90, equip: { slot: 'weapon', style: 'melee', accuracy: 26, power: 22, req: { attack: 10 }, tint: '#a3aab3' }, icon: { shape: 'sword', color: '#a3aab3', accent: '#4e5560' } }),
  bronze_helm: def({ id: 'bronze_helm', name: 'Bronze helm', examine: 'Keeps your head on your shoulders.', stackable: false, kind: 'armour', value: 20, equip: { slot: 'head', armour: 4, tint: '#c98a4b' }, icon: { shape: 'helm', color: '#c98a4b', accent: '#7a4f2a' } }),
  iron_helm: def({ id: 'iron_helm', name: 'Iron helm', examine: 'A sturdy iron helm.', stackable: false, kind: 'armour', value: 60, equip: { slot: 'head', armour: 8, req: { defence: 10 }, tint: '#a3aab3' }, icon: { shape: 'helm', color: '#a3aab3', accent: '#4e5560' } }),
  bronze_shield: def({ id: 'bronze_shield', name: 'Bronze shield', examine: 'A round shield with a bronze rim.', stackable: false, kind: 'armour', value: 34, equip: { slot: 'shield', armour: 7, tint: '#c98a4b' }, icon: { shape: 'shield', color: '#c98a4b', accent: '#6b4426' } }),
  iron_shield: def({ id: 'iron_shield', name: 'Iron shield', examine: 'Iron-faced and battle-ready.', stackable: false, kind: 'armour', value: 100, equip: { slot: 'shield', armour: 13, req: { defence: 10 }, tint: '#a3aab3' }, icon: { shape: 'shield', color: '#a3aab3', accent: '#4e3a2a' } }),
  bronze_platelegs: def({ id: 'bronze_platelegs', name: 'Bronze greaves', examine: 'Bronze greaves to guard your legs.', stackable: false, kind: 'armour', value: 40, equip: { slot: 'legs', armour: 8, tint: '#c98a4b' }, icon: { shape: 'platelegs', color: '#c98a4b', accent: '#7a4f2a' } }),
  iron_platelegs: def({ id: 'iron_platelegs', name: 'Iron greaves', examine: 'Heavy iron greaves.', stackable: false, kind: 'armour', value: 120, equip: { slot: 'legs', armour: 14, req: { defence: 10 }, tint: '#a3aab3' }, icon: { shape: 'platelegs', color: '#a3aab3', accent: '#4e5560' } }),
  bronze_platebody: def({ id: 'bronze_platebody', name: 'Bronze breastplate', examine: 'A bronze breastplate with shoulder guards.', stackable: false, kind: 'armour', value: 60, equip: { slot: 'body', armour: 12, tint: '#c98a4b' }, icon: { shape: 'platebody', color: '#c98a4b', accent: '#7a4f2a' } }),
  iron_platebody: def({ id: 'iron_platebody', name: 'Iron breastplate', examine: 'A solid iron breastplate. Heavy, but worth it.', stackable: false, kind: 'armour', value: 180, equip: { slot: 'body', armour: 20, req: { defence: 10 }, tint: '#a3aab3' }, icon: { shape: 'platebody', color: '#a3aab3', accent: '#4e5560' } }),
  // ---- Fletching
  arrow_shafts: def({ id: 'arrow_shafts', name: 'Arrow shafts', examine: 'Straight wooden shafts, ready for arrowheads.', stackable: true, kind: 'material', value: 1, icon: { shape: 'shafts', color: '#c9a06a', accent: '#8a6238' } }),
  shortbow: def({ id: 'shortbow', name: 'Shortbow', examine: 'A light bow carved from a single log.', stackable: false, kind: 'weapon', value: 30, equip: { slot: 'weapon', style: 'ranged', accuracy: 20, power: 12, twoHanded: true, tint: '#9b6a3a' }, icon: { shape: 'bow', color: '#9b6a3a', accent: '#efe8d6' } }),
  oak_shortbow: def({ id: 'oak_shortbow', name: 'Oak shortbow', examine: 'A springy oak bow with a strong pull.', stackable: false, kind: 'weapon', value: 80, equip: { slot: 'weapon', style: 'ranged', accuracy: 28, power: 17, twoHanded: true, req: { ranged: 15 }, tint: '#6e472c' }, icon: { shape: 'bow', color: '#6e472c', accent: '#efe8d6' } }),
  wooden_shield: def({ id: 'wooden_shield', name: 'Wooden shield', examine: 'Planks pinned to a round frame.', stackable: false, kind: 'armour', value: 16, equip: { slot: 'shield', armour: 4, tint: '#8a5a34' }, icon: { shape: 'shield', color: '#8a5a34', accent: '#4e321e' } }),
  // ---- Cooking
  raw_meat: def({ id: 'raw_meat', name: 'Raw meat', examine: 'It needs cooking before you eat it.', stackable: false, kind: 'material', value: 3, icon: { shape: 'meat', color: '#d9646a', accent: '#f4e2d2' } }),
  cooked_meat: def({ id: 'cooked_meat', name: 'Cooked meat', examine: 'Hearty and hot. Heals 25 HP.', stackable: false, kind: 'food', value: 8, heal: 25, icon: { shape: 'meat', color: '#9a5a32', accent: '#f4e2d2' } }),
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
  leather: def({ id: 'leather', name: 'Leather', examine: 'Tanned wolf hide, ready to sew.', stackable: false, kind: 'material', value: 10, icon: { shape: 'leather', color: '#a8743f', accent: '#5e3d1f' } }),
  flax: def({ id: 'flax', name: 'Flax', examine: 'Spin it into a bowstring at a spinning wheel.', stackable: false, kind: 'material', value: 3, icon: { shape: 'flax', color: '#7fae4a', accent: '#7fa8e8' } }),
  cut_sapphire: def({ id: 'cut_sapphire', name: 'Sapphire', examine: 'A cut and polished sapphire.', stackable: false, kind: 'material', value: 120, icon: { shape: 'cutgem', color: '#3a6fe8', accent: '#d6e4ff' } }),
  leather_gloves: def({ id: 'leather_gloves', name: 'Leather gloves', examine: 'Soft leather gloves.', stackable: false, kind: 'armour', value: 12, equip: { slot: 'hands', armour: 2 }, icon: { shape: 'gloves', color: '#a8743f', accent: '#5e3d1f' } }),
  leather_boots: def({ id: 'leather_boots', name: 'Leather boots', examine: 'Sturdy walking boots.', stackable: false, kind: 'armour', value: 14, equip: { slot: 'feet', armour: 2 }, icon: { shape: 'boots', color: '#a8743f', accent: '#5e3d1f' } }),
  leather_cowl: def({ id: 'leather_cowl', name: 'Leather cowl', examine: 'A hooded leather cowl.', stackable: false, kind: 'armour', value: 18, equip: { slot: 'head', armour: 3, tint: '#a8743f' }, icon: { shape: 'cowl', color: '#a8743f', accent: '#5e3d1f' } }),
  leather_vambraces: def({ id: 'leather_vambraces', name: 'Leather vambraces', examine: 'Bracers that steady an archer’s arm.', stackable: false, kind: 'armour', value: 22, equip: { slot: 'hands', armour: 3 }, icon: { shape: 'vambraces', color: '#a8743f', accent: '#5e3d1f' } }),
  leather_body: def({ id: 'leather_body', name: 'Leather body', examine: 'A stitched leather jerkin.', stackable: false, kind: 'armour', value: 30, equip: { slot: 'body', armour: 8, tint: '#a8743f' }, icon: { shape: 'platebody', color: '#a8743f', accent: '#5e3d1f' } }),
  leather_chaps: def({ id: 'leather_chaps', name: 'Leather chaps', examine: 'Tough leather leggings.', stackable: false, kind: 'armour', value: 26, equip: { slot: 'legs', armour: 5, tint: '#a8743f' }, icon: { shape: 'platelegs', color: '#a8743f', accent: '#5e3d1f' } }),
  fang_amulet: def({ id: 'fang_amulet', name: 'Fang amulet', examine: 'A wolf fang on a cord. Its wearer strikes a little truer.', stackable: false, kind: 'armour', value: 30, equip: { slot: 'neck', accuracy: 3, power: 1, armour: 1 }, icon: { shape: 'amulet', color: '#f1ecd9', accent: '#8a5a34' } }),
  travellers_cape: def({ id: 'travellers_cape', name: "Traveller's cape", examine: 'A warm woollen cape for the road.', stackable: false, kind: 'armour', value: 20, equip: { slot: 'cape', armour: 1 }, icon: { shape: 'cape', color: '#2f6f8a', accent: '#c9a06a' } }),
  rake: def({ id: 'rake', name: 'Rake', examine: 'Clears weeds from a farming patch.', stackable: false, kind: 'tool', tool: { category: 'rake', tier: 1 }, value: 6, icon: { shape: 'rake', color: '#8a5a34', accent: '#a3aab3' } }),
  seed_dibber: def({ id: 'seed_dibber', name: 'Seed dibber', examine: 'Makes holes for planting seeds.', stackable: false, kind: 'tool', tool: { category: 'seed_dibber', tier: 1 }, value: 6, icon: { shape: 'dibber', color: '#8a5a34', accent: '#a3aab3' } }),
  spade: def({ id: 'spade', name: 'Spade', examine: 'For digging up crops.', stackable: false, kind: 'tool', tool: { category: 'spade', tier: 1 }, value: 6, icon: { shape: 'spade', color: '#8a5a34', accent: '#a3aab3' } }),
  weeds: def({ id: 'weeds', name: 'Weeds', examine: 'Raked from a farming patch.', stackable: false, kind: 'material', value: 1, icon: { shape: 'weeds', color: '#5a8a3a', accent: '#3a5a24' } }),
  potato: def({ id: 'potato', name: 'Potato', examine: 'A fresh potato. Bake it on a range to eat.', stackable: false, kind: 'material', value: 4, icon: { shape: 'potato', color: '#c9a06a', accent: '#8a6238' } }),
  onion: def({ id: 'onion', name: 'Onion', examine: 'Makes your eyes water.', stackable: false, kind: 'material', value: 5, icon: { shape: 'onion', color: '#e8d6a0', accent: '#a07a3a' } }),
  cabbage: def({ id: 'cabbage', name: 'Cabbage', examine: 'Crunchy and green. Heals 10 HP.', stackable: false, kind: 'food', value: 6, heal: 10, icon: { shape: 'cabbage', color: '#8fc45a', accent: '#5a7a34' } }),
  baked_potato: def({ id: 'baked_potato', name: 'Baked potato', examine: 'Hot and fluffy. Heals 40 HP.', stackable: false, kind: 'food', value: 12, heal: 40, icon: { shape: 'potato', color: '#a8743f', accent: '#f6e2a0' } }),
  burnt_potato: def({ id: 'burnt_potato', name: 'Burnt potato', examine: 'A lump of charcoal.', stackable: false, kind: 'material', value: 0, icon: { shape: 'potato', color: '#2e2622', accent: '#6a5a50' } }),
  saw: def({ id: 'saw', name: 'Saw', examine: 'For cutting planks to size when building.', stackable: false, kind: 'tool', tool: { category: 'saw', tier: 1 }, value: 8, icon: { shape: 'saw', color: '#a3aab3', accent: '#8a5a34' } }),
  plank: def({ id: 'plank', name: 'Plank', examine: 'A sawn plank. Builds basic furniture.', stackable: false, kind: 'material', value: 8, icon: { shape: 'plank', color: '#c9a06a', accent: '#8a6238' } }),
  oak_plank: def({ id: 'oak_plank', name: 'Oak plank', examine: 'A sturdy oak plank.', stackable: false, kind: 'material', value: 25, icon: { shape: 'plank', color: '#8a5a34', accent: '#5a3a20' } }),
  bronze_nails: def({ id: 'bronze_nails', name: 'Bronze nails', examine: 'For building furniture.', stackable: true, kind: 'material', value: 1, icon: { shape: 'nails', color: '#c98a4b', accent: '#7a4f2a' } }),
  iron_nails: def({ id: 'iron_nails', name: 'Iron nails', examine: 'For building furniture.', stackable: true, kind: 'material', value: 2, icon: { shape: 'nails', color: '#a3aab3', accent: '#4e5560' } }),
  steel_nails: def({ id: 'steel_nails', name: 'Steel nails', examine: 'For building furniture.', stackable: true, kind: 'material', value: 3, icon: { shape: 'nails', color: '#d3d9df', accent: '#5c646e' } }),
  small_fishing_net: def({ id: 'small_fishing_net', name: 'Small fishing net', examine: 'For netting shrimps and anchovies at fishing spots.', stackable: false, kind: 'tool', tool: { category: 'small_net', tier: 1 }, value: 8, icon: { shape: 'net', color: '#c9b48a', accent: '#8a5a34' } }),
  // ---- Fletching parts
  bowstring: def({ id: 'bowstring', name: 'Bowstring', examine: 'Strong twisted cord for stringing a bow.', stackable: false, kind: 'material', value: 4, icon: { shape: 'string', color: '#efe8d6', accent: '#b9ad90' } }),
  shortbow_u: def({ id: 'shortbow_u', name: 'Unstrung shortbow', examine: 'Needs a bowstring.', stackable: false, kind: 'material', value: 10, icon: { shape: 'unbow', color: '#9b6a3a', accent: '#9b6a3a' } }),
  oak_shortbow_u: def({ id: 'oak_shortbow_u', name: 'Unstrung oak shortbow', examine: 'Needs a bowstring.', stackable: false, kind: 'material', value: 30, icon: { shape: 'unbow', color: '#6e472c', accent: '#6e472c' } }),
  // ---- Fishing and cooking
  raw_shrimps: def({ id: 'raw_shrimps', name: 'Raw shrimps', examine: 'Fresh from the river. Cook before eating.', stackable: false, kind: 'material', value: 3, icon: { shape: 'fish', color: '#e89a8a', accent: '#f6d6c8' } }),
  shrimps: def({ id: 'shrimps', name: 'Shrimps', examine: 'Pink and tasty. Heals 15 HP.', stackable: false, kind: 'food', value: 6, heal: 15, icon: { shape: 'fish', color: '#f07a5a', accent: '#ffd0b8' } }),
  raw_anchovies: def({ id: 'raw_anchovies', name: 'Raw anchovies', examine: 'Small silvery fish. Cook before eating.', stackable: false, kind: 'material', value: 6, icon: { shape: 'fish', color: '#8fa5b8', accent: '#dfe8f0' } }),
  anchovies: def({ id: 'anchovies', name: 'Anchovies', examine: 'Salty and filling. Heals 20 HP.', stackable: false, kind: 'food', value: 10, heal: 20, icon: { shape: 'fish', color: '#6f7f8e', accent: '#c9a06a' } }),
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
