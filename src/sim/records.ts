import type { SaveData } from './world';

/**
 * The local save split into the parts a server keeps in different places (docs/MULTIPLAYER.md, 3A.1):
 *
 * - **CharacterRecord**: everything that belongs to the character and travels with it between
 *   zones and devices: skills, inventory, bank, equipment, toolbelt, quests, position, grants, house,
 *   allotments, held items, options.
 * - **ZoneState**: things lying in the world: ground piles and shrine wisps. On a server these
 *   belong to the zone (wisps and private piles still record their owner).
 * - **LocalState**: the practice market, an offline tutorial that never touches real wealth and
 *   stays on the device.
 *
 * `splitSave` and `mergeSave` are exact inverses, so the browser's version 1 save keeps working.
 */
export type CharacterRecord = Omit<SaveData, 'ground' | 'graves' | 'exchangePractice'>;
export type ZoneState = Pick<SaveData, 'ground' | 'graves'>;
export type LocalState = Pick<SaveData, 'exchangePractice'>;

const ZONE_KEYS = ['ground', 'graves'] as const;
const LOCAL_KEYS = ['exchangePractice'] as const;

export function splitSave(save: SaveData): { character: CharacterRecord; zone: ZoneState; local: LocalState } {
  const character: Record<string, unknown> = {};
  const zone: Record<string, unknown> = {};
  const local: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(save)) {
    if ((ZONE_KEYS as readonly string[]).includes(k)) zone[k] = v;
    else if ((LOCAL_KEYS as readonly string[]).includes(k)) local[k] = v;
    else character[k] = v;
  }
  return { character: character as CharacterRecord, zone: zone as ZoneState, local: local as LocalState };
}

export function mergeSave(parts: { character: CharacterRecord; zone?: ZoneState; local?: LocalState }): SaveData {
  return { ...parts.character, ...(parts.zone ?? {}), ...(parts.local ?? {}) } as SaveData;
}
