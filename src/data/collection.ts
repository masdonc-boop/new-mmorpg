import { ENEMIES, type EnemyType } from './enemies';
import { itemDef, type ItemId } from './items';

/**
 * Drop rarity and the creature half of the collection log (Phase 5C, docs/PROGRESSION.md 7). The
 * dungeon uniques keep their own log (`Player.collectionLog`, 4D); this adds what creatures drop.
 */

export type Rarity = 'common' | 'uncommon' | 'rare';

/** How rare a drop is, from its chance per kill: 3% or less is rare, 12% or less uncommon. Coins and bones are always common. */
export function dropRarity(item: ItemId, chance: number): Rarity {
  if (item === 'coins' || itemDef(item).icon.shape === 'bone') return 'common';
  if (chance <= 0.03) return 'rare';
  if (chance <= 0.12) return 'uncommon';
  return 'common';
}

export interface LogEntry {
  /** `${creature}:${item}`: the same item from two creatures is two entries. */
  key: string;
  source: EnemyType;
  item: ItemId;
  rarity: Rarity;
}

export interface LogGroup {
  id: 'bosses' | 'creatures';
  name: string;
  /** One row per creature, in level order. */
  rows: { source: EnemyType; entries: LogEntry[] }[];
}

const isGear = (item: ItemId) => !!itemDef(item).equip && !itemDef(item).stackable;

/**
 * What counts: for the regional bosses, their gear drops up to 15% (their signature rewards); for
 * every other creature, gear it drops at 3% or less (its rare finds). Dungeon bosses pay out through
 * their chests, already logged.
 */
function build(): LogGroup[] {
  const bosses: LogGroup = { id: 'bosses', name: 'Regional bosses', rows: [] };
  const creatures: LogGroup = { id: 'creatures', name: 'Creature finds', rows: [] };
  const all = Object.values(ENEMIES).sort((a, b) => a.level - b.level);
  for (const e of all) {
    if (e.boss && ['shrinekeeper', 'watchcaptain'].includes(e.id)) continue;
    const limit = e.boss ? 0.15 : 0.03;
    const entries = e.drops
      .filter((d) => isGear(d.item) && d.chance <= limit)
      .map((d) => ({ key: `${e.id}:${d.item}`, source: e.id, item: d.item, rarity: dropRarity(d.item, d.chance) }));
    if (entries.length) (e.boss ? bosses : creatures).rows.push({ source: e.id, entries });
  }
  return [bosses, creatures];
}

export const DROP_LOG: readonly LogGroup[] = build();

/** Every creature log key (saves are checked against these). */
export const DROP_LOG_KEYS: ReadonlySet<string> = new Set(DROP_LOG.flatMap((g) => g.rows.flatMap((r) => r.entries.map((x) => x.key))));

