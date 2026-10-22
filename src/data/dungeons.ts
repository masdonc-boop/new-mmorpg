import type { ItemId } from './items';
import type { QuestRequirements } from './quests';
import type { DecorKind } from '../sim/worldmap';

/**
 * Dungeon framework (Phase 4B, docs/PROGRESSION.md): what Eastreach's two sealed landmarks will ask of
 * a player and what they will give, ready for Phase 4C to build the dungeons themselves. Nothing here
 * is live yet: the doors stay sealed, and the planned unique items below are not in the item list
 * (they are added, with these targets, when the dungeons open).
 */

/** A planned unique reward: its slot, style and the stats it is balanced to. */
export interface PlannedUnique {
  id: string;
  name: string;
  slot: 'weapon' | 'head' | 'body' | 'legs' | 'shield' | 'neck' | 'ring' | 'hands' | 'feet' | 'cape';
  style?: 'melee' | 'ranged' | 'magic';
  /** Target stats, a step above the best craftable gear of the same slot and style. */
  target: { accuracy?: number; power?: number; armour?: number };
  req: Partial<Record<'attack' | 'strength' | 'defence' | 'ranged' | 'magic', number>>;
  /** Chance per completed run (from the end chest). */
  chance: number;
}

export interface DungeonDef {
  id: string;
  name: string;
  region: string;
  /** The landmark scenery at the door (placed by the map generator). */
  landmark: DecorKind;
  status: 'sealed' | 'open';
  /** What the door asks before it opens (checked the same way as quest requirements). */
  requirements: QuestRequirements;
  /** Who it is balanced for. */
  recommended: { combat: number; gearTier: number; partySize: [number, number] };
  boss: { name: string; level: number; style: 'melee' | 'ranged' | 'magic' };
  /** The end chest: always some of these, plus a roll on the table, plus a chance at a unique. */
  rewards: {
    guaranteed: { item: ItemId; min: number; max: number }[];
    table: { item: ItemId; min: number; max: number; chance: number }[];
    uniques: PlannedUnique[];
  };
}

export const DUNGEONS: Record<string, DungeonDef> = {
  // Under Mirefen: the drowned halls of whoever raised the shrine, and the thing that keeps them.
  sunken_shrine: {
    id: 'sunken_shrine',
    name: 'The Sunken Shrine',
    region: 'mirefen',
    landmark: 'sunken_shrine',
    status: 'open',
    requirements: { quests: ['lanterns_of_heronwick'], combat: 30 },
    recommended: { combat: 38, gearTier: 30, partySize: [1, 3] },
    boss: { name: 'The Shrinekeeper', level: 42, style: 'magic' },
    rewards: {
      guaranteed: [
        { item: 'coins', min: 400, max: 900 },
        { item: 'marsh_pearl', min: 1, max: 2 },
      ],
      table: [
        { item: 'mire_oil', min: 6, max: 12, chance: 0.5 },
        { item: 'silverpike', min: 4, max: 8, chance: 0.4 },
        { item: 'mireweave_robe', min: 1, max: 1, chance: 0.08 },
        { item: 'mirelight_wand', min: 1, max: 1, chance: 0.06 },
        { item: 'cut_sapphire', min: 1, max: 2, chance: 0.15 },
      ],
      uniques: [
        { id: 'tidecaller_wand', name: 'Tidecaller wand', slot: 'weapon', style: 'magic', target: { accuracy: 46, power: 39 }, req: { magic: 45 }, chance: 0.02 },
        { id: 'heronscale_hood', name: 'Heronscale hood', slot: 'head', style: 'magic', target: { armour: 6, accuracy: 6, power: 3 }, req: { magic: 40, defence: 20 }, chance: 0.03 },
        { id: 'drowned_signet', name: 'Drowned signet', slot: 'ring', target: { accuracy: 3, power: 4, armour: 2 }, req: {}, chance: 0.03 },
      ],
    },
  },
  // In Thornridge: the tower's levels, barred from inside, and whoever barred them.
  old_watchtower: {
    id: 'old_watchtower',
    name: 'The Old Watchtower',
    region: 'thornridge',
    landmark: 'watchtower',
    status: 'open',
    requirements: { quests: ['ninefold_watch'], combat: 35 },
    recommended: { combat: 44, gearTier: 40, partySize: [1, 3] },
    boss: { name: 'The Last Watchcaptain', level: 48, style: 'melee' },
    rewards: {
      guaranteed: [
        { item: 'coins', min: 500, max: 1100 },
        { item: 'silver_bar', min: 2, max: 4 },
      ],
      table: [
        { item: 'rowan_logs', min: 4, max: 8, chance: 0.4 },
        { item: 'steel_arrow', min: 40, max: 90, chance: 0.4 },
        { item: 'glimsteel_arrow', min: 20, max: 50, chance: 0.2 },
        { item: 'ridgehide_body', min: 1, max: 1, chance: 0.06 },
        { item: 'rowan_longbow', min: 1, max: 1, chance: 0.05 },
      ],
      uniques: [
        { id: 'watchcaptain_blade', name: 'Watchcaptain’s blade', slot: 'weapon', style: 'melee', target: { accuracy: 52, power: 47 }, req: { attack: 50 }, chance: 0.02 },
        { id: 'warders_longbow', name: 'Warder’s longbow', slot: 'weapon', style: 'ranged', target: { accuracy: 50, power: 36 }, req: { ranged: 45 }, chance: 0.02 },
        { id: 'ninefold_cloak', name: 'Ninefold cloak', slot: 'cape', target: { armour: 4, accuracy: 2, power: 2 }, req: { defence: 35 }, chance: 0.03 },
      ],
    },
  },
};
