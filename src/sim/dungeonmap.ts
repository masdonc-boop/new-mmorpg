import { fbm } from '../core/noise';
import { T, type DecorKind, type Passage, type WorldMap } from './worldmap';
import type { EnemyType } from '../data/enemies';

/**
 * The Phase 4C dungeons (docs/DUNGEONS.md): the Sunken Shrine under Mirefen and the Old Watchtower
 * in Thornridge. Like Glimmer Hollow they are carved into an unused stretch of the map (south of
 * everything, beyond the sea and the fog) and reached only through their doors. Each is its own
 * shared zone (src/sim/zones.ts).
 *
 * Legend: # wall, . floor, E the way out, 1–4 stairs (1↔2, 3↔4), ~ glowing pool (blocked),
 * o pillar, b brazier, C the end chest, and creatures: a drowned acolyte, l mire leech,
 * g drowned guardian, K the Shrinekeeper; s hollow sentinel, r forsworn archer, W the Last
 * Watchcaptain. Nothing here runs at module load (worldmap.ts imports this module, and it imports
 * worldmap.ts back).
 */

export type DungeonId = 'sunken_shrine' | 'old_watchtower';

export interface DungeonArea {
  id: DungeonId;
  x: number;
  z: number;
  layout: string[];
  /** Floor tile type, so each place has its own look. */
  floor: 'shrine' | 'tower';
  /** The surface door: the landmark tile you tap, and where you come out. */
  door: { x: number; z: number; arriveX: number; arriveZ: number; name: string };
}

export const DUNGEON_AREAS: Record<DungeonId, DungeonArea> = {
  sunken_shrine: {
    id: 'sunken_shrine',
    x: 34,
    z: 134,
    floor: 'shrine',
    door: { x: 177.5, z: 108.5, arriveX: 176.5, arriveZ: 108.5, name: 'Sunken Shrine' },
    layout: [
      '##################################',
      '#......####.........##############',
      '#.E....####...a..o..##...........#',
      '#......####.........##..g........#',
      '#.b..........~~~.......o.......b.#',
      '#......####.~~~~~..##............#',
      '###..######.~~~~~..##.....K....C.#',
      '###..######..~~~...##............#',
      '###..######.........##.o.......b.#',
      '#.......###..a..l...##..g........#',
      '#..l....###..o......##...........#',
      '#...........l.....a.##############',
      '#.......###.........##############',
      '##################################',
    ],
  },
  old_watchtower: {
    id: 'old_watchtower',
    x: 74,
    z: 134,
    floor: 'tower',
    door: { x: 181.5, z: 21.5, arriveX: 181.5, arriveZ: 22.5, name: 'Old Watchtower' },
    layout: [
      '##################################',
      '##........###........###........##',
      '#.E.....1..#.2.....3..#.4........#',
      '#.b........#.........b#.......b..#',
      '#...s..s...#..r....r..#..s.......#',
      '#..........#..........#..........#',
      '#..oo..oo..#..oo..oo..#....W.....#',
      '#..........#..........#..........#',
      '#...r..s...#..s....s..#..r.......#',
      '#..........#..........#..........#',
      '#.b........#.......b..#....C.....#',
      '##........###........###........##',
      '##################################',
    ],
  },
};

const STAIRS: Record<string, { id: string; to: string; name: string; verb: string }> = {
  '1': { id: 'tower_up_1', to: 'tower_down_2', name: 'Stairs up', verb: 'Climb' },
  '2': { id: 'tower_down_2', to: 'tower_up_1', name: 'Stairs down', verb: 'Climb down' },
  '3': { id: 'tower_up_2', to: 'tower_down_roof', name: 'Stairs to the roof', verb: 'Climb' },
  '4': { id: 'tower_down_roof', to: 'tower_up_2', name: 'Stairs down', verb: 'Climb down' },
};

const CREATURES: Record<string, EnemyType> = {
  a: 'drowned_acolyte',
  l: 'mire_leech',
  g: 'drowned_guardian',
  K: 'shrinekeeper',
  s: 'hollow_sentinel',
  r: 'forsworn_archer',
  W: 'watchcaptain',
};

/** Which dungeon a point is in, if any. */
export function dungeonAt(x: number, z: number): DungeonId | null {
  for (const d of Object.values(DUNGEON_AREAS)) {
    if (x >= d.x && x < d.x + d.layout[0].length && z >= d.z && z < d.z + d.layout.length) return d.id;
  }
  return null;
}

/** Where a dungeon's end chest stands (tile centre). */
export function chestOf(id: DungeonId): { x: number; z: number } {
  const d = DUNGEON_AREAS[id];
  for (let dz = 0; dz < d.layout.length; dz++) {
    const dx = d.layout[dz].indexOf('C');
    if (dx >= 0) return { x: d.x + dx + 0.5, z: d.z + dz + 0.5 };
  }
  throw new Error(`${id} has no chest`);
}

/** Carves both dungeons and their doors into the map (last of all: nothing else moves). */
export function carveDungeons(map: WorldMap, occ: Uint8Array, seed: number) {
  const W = map.width;
  const idx = (x: number, z: number) => z * W + x;
  const FLOOR_Y = 0.35;
  const WALL_Y = 3.6;
  for (const d of Object.values(DUNGEON_AREAS)) {
    const floor = d.floor === 'shrine' ? T.ShrineFloor : T.TowerFloor;
    const at = (dx: number, dz: number) => d.layout[dz]?.[dx] ?? '#';
    d.layout.forEach((row, dz) => {
      if (row.length !== d.layout[0].length) throw new Error(`${d.id}: row ${dz} is ${row.length} wide`);
      for (let dx = 0; dx < row.length; dx++) {
        const i = idx(d.x + dx, d.z + dz);
        const wall = row[dx] === '#';
        map.tiles[i] = wall ? T.Rocky : floor;
        map.blocked[i] = occ[i] = wall ? 1 : 0;
      }
    });
    const floorAt = (dx: number, dz: number) => at(dx, dz) !== '#';
    for (let dz = 0; dz <= d.layout.length; dz++) {
      for (let dx = 0; dx <= d.layout[0].length; dx++) {
        const near = floorAt(dx - 1, dz - 1) || floorAt(dx, dz - 1) || floorAt(dx - 1, dz) || floorAt(dx, dz);
        const wallY = d.floor === 'tower' ? WALL_Y + 0.4 : WALL_Y + (fbm((d.x + dx) * 0.4, (d.z + dz) * 0.4, seed + 23) - 0.5) * 1.4;
        map.heights[(d.z + dz) * (W + 1) + d.x + dx] = near ? FLOOR_Y : wallY;
      }
    }
    const decor = (kind: DecorKind, x: number, z: number, rot = 0, scale = 1) => map.decor.push({ kind, x, z, rot, scale, variant: 0 });
    const block = (x: number, z: number) => (map.blocked[idx(x, z)] = occ[idx(x, z)] = 1);
    /** Where you arrive beside a door or stair: the first open neighbour (south, east, north, west). */
    const arrival = (dx: number, dz: number) => {
      for (const [ox, oz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
        const c = at(dx + ox, dz + oz);
        if (c !== '#' && c !== '~' && c !== 'o' && c !== 'b' && c !== 'C' && !(c in STAIRS)) return { x: d.x + dx + ox + 0.5, z: d.z + dz + oz + 0.5 };
      }
      throw new Error(`${d.id}: nowhere to arrive at ${dx},${dz}`);
    };
    d.layout.forEach((row, dz) => {
      for (let dx = 0; dx < row.length; dx++) {
        const ch = row[dx];
        const x = d.x + dx;
        const z = d.z + dz;
        if (ch === '~') {
          decor('glow_pool', x + 0.5, z + 0.5, (dx * 7 + dz) % 6);
          block(x, z);
        } else if (ch === 'o') {
          decor('pillar', x + 0.5, z + 0.5, 0, d.floor === 'tower' ? 1.1 : 1);
          block(x, z);
        } else if (ch === 'b') {
          decor('brazier', x + 0.5, z + 0.5);
          block(x, z);
        } else if (ch === 'C') {
          decor('dungeon_chest', x + 0.5, z + 0.5, Math.PI);
          block(x, z);
        } else if (ch === 'E') {
          decor('light_shaft', x + 0.5, z + 0.5);
          block(x, z);
          const a = arrival(dx, dz);
          map.passages.push({ id: `${d.id}_out`, name: 'Way out', verb: 'Leave', x: x + 0.5, z: z + 0.5, arriveX: a.x, arriveZ: a.z, to: `${d.id}_door` });
        } else if (ch in STAIRS) {
          const s = STAIRS[ch];
          decor('stairs', x + 0.5, z + 0.5, s.id.includes('up') ? 0 : Math.PI);
          block(x, z);
          const a = arrival(dx, dz);
          map.passages.push({ id: s.id, name: s.name, verb: s.verb, x: x + 0.5, z: z + 0.5, arriveX: a.x, arriveZ: a.z, to: s.to });
        } else if (ch in CREATURES) map.enemySpawns.push({ type: CREATURES[ch], x: x + 0.5, z: z + 0.5 });
      }
    });
    // The surface door, at the landmark (its tile is already blocked by the landmark's footprint).
    const door: Passage = { id: `${d.id}_door`, name: d.door.name, verb: 'Enter', x: d.door.x, z: d.door.z, arriveX: d.door.arriveX, arriveZ: d.door.arriveZ, to: `${d.id}_out`, requires: d.id };
    map.passages.push(door);
  }
}
