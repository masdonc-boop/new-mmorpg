import { HOUSE } from '../data/construction';
import { inHollow } from './worldmap';
import { dungeonAt } from './dungeonmap';
import type { PlayerId } from './world';

/**
 * Zones (docs/MULTIPLAYER.md 3A.8 and 4.1). A server runs several worlds in one process, and where a
 * player stands decides which one they are in:
 *
 * - `brightwater`: the island, shared by everyone;
 * - `hollow`: Glimmer Hollow, a shared zone of its own (reached through its passages);
 * - `sunken_shrine`, `old_watchtower`: the Phase 4C dungeons, shared zones like the Hollow (anyone
 *   inside fights alongside anyone else; docs/DUNGEONS.md);
 * - `house:<player>`: a player's house, a personal instance made when they walk in and closed when
 *   it is empty.
 *
 * Passages and the house door need nothing new: walking through one puts the player in another
 * zone's area, and the server hands them over. The single-player game is one world as before.
 */
export type ZoneId = string;

export const BRIGHTWATER: ZoneId = 'brightwater';
export const HOLLOW_ZONE: ZoneId = 'hollow';

/** Inside the house walls (the doorway gap is still outside). */
export function inHouse(x: number, z: number): boolean {
  return x >= HOUSE.x1 + 1 && x < HOUSE.x2 && z >= HOUSE.z1 + 1 && z < HOUSE.z2;
}

export const houseZone = (owner: PlayerId): ZoneId => `house:${owner}`;

/** The zone a player standing here belongs in. */
export function zoneFor(x: number, z: number, player: PlayerId): ZoneId {
  if (inHollow(x, z)) return HOLLOW_ZONE;
  const d = dungeonAt(x, z);
  if (d) return d;
  if (inHouse(x, z)) return houseZone(player);
  return BRIGHTWATER;
}

export type ZoneKind = 'shared' | 'instance';

/** Whether a zone is a shared space (kept running) or an instance (closed when empty). */
export function zoneKind(id: ZoneId): ZoneKind {
  return id.startsWith('house:') ? 'instance' : 'shared';
}

/** Which creatures and people a zone runs: the house has none; the island and the Hollow their own. */
export function zoneArea(id: ZoneId): (x: number, z: number) => boolean {
  if (id === HOLLOW_ZONE) return (x, z) => inHollow(x, z);
  if (id === 'sunken_shrine' || id === 'old_watchtower') return (x, z) => dungeonAt(x, z) === id;
  if (zoneKind(id) === 'instance') return (x, z) => inHouse(x, z);
  return (x, z) => !inHollow(x, z) && !dungeonAt(x, z);
}
