export const SKILL_IDS = [
  'attack',
  'strength',
  'defence',
  'hitpoints',
  'ranged',
  'magic',
  'woodcutting',
  'mining',
  'fishing',
  'smithing',
  'fletching',
  'cooking',
  'firemaking',
  'crafting',
  'prayer',
  'thieving',
  'agility',
  'farming',
  'construction',
] as const;

export type SkillId = (typeof SKILL_IDS)[number];

export interface SkillInfo {
  name: string;
  color: string;
  glyph: string;
  category: 'combat' | 'gathering' | 'production';
  /** How to train it: tools needed and where to go (shown in the Skills panel). */
  howTo: string;
  /** False for a skill that is listed but not trainable yet; the UI labels it as unavailable. */
  available: boolean;
}

export const SKILL_INFO: Record<SkillId, SkillInfo> = {
  attack: { name: 'Attack', color: '#e0524a', glyph: '⚔', category: 'combat', available: true, howTo: 'Fight in Melee style. Wield a sword or dagger for better accuracy.' },
  strength: { name: 'Strength', color: '#3fae5a', glyph: '✊', category: 'combat', available: true, howTo: 'Fight in Melee style. Raises your melee max hit.' },
  defence: { name: 'Defence', color: '#5b8de0', glyph: '⛨', category: 'combat', available: true, howTo: 'Fight in Melee style. Wear armour (helm, platebody, platelegs, shield) to be hit less.' },
  hitpoints: { name: 'Hitpoints', color: '#e83f7a', glyph: '♥', category: 'combat', available: true, howTo: 'Rises with any combat. Eat cooked food to heal.' },
  ranged: { name: 'Ranged', color: '#7fc04a', glyph: '➶', category: 'combat', available: true, howTo: 'Fight in Ranged style with arrows in your bag. Wield a shortbow you fletched for better shots.' },
  magic: { name: 'Magic', color: '#8a6cf0', glyph: '✦', category: 'combat', available: true, howTo: 'Fight in Magic style. Each cast uses one air rune (Tilly sells them; slimes drop them).' },
  woodcutting: { name: 'Woodcutting', color: '#b07a3c', glyph: '🌲', category: 'gathering', available: true, howTo: 'Needs a bronze axe. Tap any tree; oaks from level 15.' },
  mining: { name: 'Mining', color: '#9aa3ad', glyph: '⛏', category: 'gathering', available: true, howTo: 'Needs a bronze pickaxe. Copper and tin rocks in the Ironcrag Hills (east); iron from level 15, coal from 30 (deeper east).' },
  fishing: { name: 'Fishing', color: '#4aa7c9', glyph: '🎣', category: 'gathering', available: true, howTo: 'Needs a small fishing net. Tap a bubbling fishing spot in the river just west of the village.' },
  smithing: { name: 'Smithing', color: '#c98a4b', glyph: '⚒', category: 'production', available: true, howTo: 'Smelt ore into bars at the furnace by the smithy (steel: iron ore + 2 coal, level 30), then forge gear at the anvil (needs a hammer).' },
  fletching: { name: 'Fletching', color: '#5fae8c', glyph: '🏹', category: 'production', available: true, howTo: 'Use a knife on logs: arrow shafts, unstrung bows, shields. String bows with a bowstring.' },
  firemaking: { name: 'Firemaking', color: '#f0743a', glyph: '🔥', category: 'production', available: true, howTo: 'Needs a tinderbox. Tap logs in your bag to light a fire where you stand (oak from level 15). Cook on your fire before it burns out.' },
  crafting: { name: 'Crafting', color: '#c9a06a', glyph: '🧵', category: 'production', available: true, howTo: 'Tan wolf pelts into leather at Rook the tanner, then use a needle and thread on leather. Pick flax south-east of the village and spin it into bowstrings at the spinning wheel. Cut sapphires with a chisel.' },
  prayer: { name: 'Prayer', color: '#e8e2a8', glyph: '🙏', category: 'combat', available: true, howTo: 'Bury bones (tap them in your bag). Turn prayers on in the Prayer tab; recharge your prayer points at the shrine or a waystone.' },
  thieving: { name: 'Thieving', color: '#8a6cb0', glyph: '🤏', category: 'gathering', available: true, howTo: 'Pickpocket townsfolk in the plaza (Farmer Wren from 10, Captain Bram from 40), or steal from the bakery stall (5) and the seed stall by the fields (27). A failed pickpocket stuns you.' },
  agility: { name: 'Agility', color: '#3a6fb0', glyph: '🏃', category: 'gathering', available: true, howTo: 'Run laps of the village obstacle course, east of the smithy: log, wall, rope swing, balance beam, hedge tunnel. Finish all five in order for a lap bonus.' },
  farming: { name: 'Farming', color: '#5aa842', glyph: '🌱', category: 'gathering', available: true, howTo: 'At the allotments east of the plaza (north of the smithy): rake the weeds (rake), plant 3 seeds (seed dibber), wait for them to grow (about 40 minutes, even while away), then harvest with a spade. Potatoes 1, onions 5, cabbages 7.' },
  construction: { name: 'Construction', color: '#b8865a', glyph: '🔨', category: 'production', available: true, howTo: 'Saw logs into planks at Bertram’s sawmill, smith nails at the anvil, then build furniture in your house north of the village (needs a hammer and a saw). Remove and rebuild to train.' },
  cooking: { name: 'Cooking', color: '#e07a3a', glyph: '🍳', category: 'production', available: true, howTo: 'Cook raw fish or meat at the range outside the inn or the campfire by the river.' },
};

export const MAX_LEVEL = 99;

/** XP_TABLE[level] = total xp required to reach that level (index 0 unused). Classic exponential curve. */
export const XP_TABLE: readonly number[] = (() => {
  const table = [0, 0];
  let points = 0;
  for (let lvl = 1; lvl < MAX_LEVEL; lvl++) {
    points += Math.floor(lvl + 300 * Math.pow(2, lvl / 7));
    table.push(Math.floor(points / 4));
  }
  return table;
})();

export const MAX_XP = 200_000_000;

export function levelForXp(xp: number): number {
  let lo = 1;
  let hi = MAX_LEVEL;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (XP_TABLE[mid] <= xp) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function xpForLevel(level: number): number {
  return XP_TABLE[Math.max(1, Math.min(MAX_LEVEL, level))];
}

/** Starting xp for each skill. Hitpoints starts at level 10 like classic RPGs. */
export function defaultSkillXp(): Record<SkillId, number> {
  const xp = {} as Record<SkillId, number>;
  for (const id of SKILL_IDS) xp[id] = 0;
  xp.hitpoints = xpForLevel(10);
  return xp;
}
