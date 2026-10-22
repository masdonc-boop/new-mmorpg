import { fbm } from '../core/noise';
import { mulberry32 } from '../core/rng';
import { clamp, distToSegment, lerp } from '../core/math';
import { T, WATER_Y, inIslandBox, type DecorKind, type TileType, type WorldMap } from './worldmap';
import type { ResourceType } from '../data/resources';
import type { EnemyType } from '../data/enemies';

/**
 * Eastreach (Phase 4A, docs/WORLD_EXPANSION.md): the land east of the island, across the strait.
 * Thornridge Highlands fill the north, Mirefen Marsh the south; a road forks to both from the end
 * of the Saltwind Causeway, the only way over from the Ironcrag Hills.
 *
 * Generated after the island, from its own random stream, and only appended to the map's lists:
 * nothing on the island moves (the causeway and the short trail to it are the only island tiles
 * that change, see `islandTilesChanged`). Nothing here runs at module load (the module is imported
 * by worldmap.ts, which it imports back).
 */

/** The causeway crosses the strait on rows z 62–63; a trail leads to it from the Ironcrag road's end. */
export const CAUSEWAY = { z: 62, trailFromX: 89, fromX: 104, toX: 116 };
/** Places in Eastreach (tile coordinates). */
export const EAST = {
  centre: { x: 160, z: 66, rx: 44, rz: 58 },
  headland: { x: 124, z: 62, rx: 11, rz: 9 },
  fork: { x: 132, z: 62 },
  tollhouse: { x: 123.5, z: 58.5 },
  cairnhold: { x: 150, z: 34 },
  heronwick: { x: 147, z: 84 },
  ninefold: { x: 178, z: 40 },
  watchtower: { x: 182, z: 21 },
  tarn: { x: 171, z: 22, r: 4.5 },
  shrine: { x: 177, z: 108 },
  peak: { x: 186, z: 28 },
};

type Pt = [number, number];
const roads = (): Pt[][] => {
  const e = EAST;
  const p = (q: { x: number; z: number }): Pt => [q.x, q.z];
  return [
    [[CAUSEWAY.toX, 62.9], p(e.fork)],
    [p(e.fork), [139, 50], p(e.cairnhold)],
    [p(e.cairnhold), [163, 38], p(e.ninefold)],
    [p(e.ninefold), [184, 30], [e.watchtower.x - 1, e.watchtower.z + 3]],
    [p(e.cairnhold), [160, 26], [e.tarn.x - 6, e.tarn.z]],
    [p(e.fork), [137, 72], p(e.heronwick)],
    [p(e.heronwick), [157, 92], [168, 101], [e.shrine.x - 2, e.shrine.z - 2]],
  ];
};

function distToRoads(x: number, z: number, list: Pt[][]): number {
  let best = Infinity;
  for (const r of list) for (let i = 0; i < r.length - 1; i++) best = Math.min(best, distToSegment(x, z, r[i][0], r[i][1], r[i + 1][0], r[i + 1][1]));
  return best;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** How far into the sea a point is (under 0.84 is land, over 1 open water). */
export function eastDistance(x: number, z: number, seed: number): number {
  const { centre: c, headland: h } = EAST;
  const d = Math.min(Math.hypot((x - c.x) / c.rx, (z - c.z) / c.rz), Math.hypot((x - h.x) / h.rx, (z - h.z) / h.rz));
  return d + (fbm(x * 0.05, z * 0.05, seed + 31) - 0.5) * 0.22;
}

/** How "highland" a point is (1 in Thornridge, 0 in Mirefen; the misty tree line between). */
export const highland = (z: number) => 1 - smoothstep(50, 72, z);

/** The island tiles Eastreach changes: the causeway's west end and the trail to it (plus its signpost). */
export function islandTilesChanged(map: WorldMap): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let x = CAUSEWAY.trailFromX; x < map.width && inIslandBox(x, CAUSEWAY.z); x++) {
    out.push({ x, z: CAUSEWAY.z });
    if (x >= CAUSEWAY.fromX) out.push({ x, z: CAUSEWAY.z + 1 });
  }
  out.push({ x: 100, z: 61 });
  return out;
}

export function generateEastreach(map: WorldMap, occ: Uint8Array, seed: number) {
  const W = map.width;
  const H = map.height;
  const idx = (x: number, z: number) => z * W + x;
  const { tiles, blocked, heights } = map;
  const W1 = W + 1;
  const list = roads();
  const e = EAST;

  // --- Heights ---
  for (let vz = 0; vz <= H; vz++) {
    for (let vx = 0; vx <= W; vx++) {
      if (vx <= 112 && vz <= 112) continue;
      const eD = eastDistance(vx, vz, seed);
      const land = 1 - smoothstep(0.84, 1.0, eD);
      if (land <= 0) continue;
      const north = highland(vz);
      // Thornridge: rolling moor with crags, rising to snowy tops in the north-east.
      const ridge = fbm(vx * 0.06, vz * 0.06, seed + 41);
      let high = 1.25 + (ridge - 0.42) * 3.2;
      high += (1 - smoothstep(0, 1, Math.hypot(vx - e.peak.x, vz - e.peak.z) / 14)) * 2.4;
      // Mirefen: low and nearly flat, pocked with still pools.
      let marsh = 0.24 + (fbm(vx * 0.1, vz * 0.1, seed + 51) - 0.5) * 0.36;
      const pool = fbm(vx * 0.14, vz * 0.14, seed + 61);
      marsh = lerp(marsh, -0.75, smoothstep(0.58, 0.66, pool));
      let h = lerp(marsh, high, north);
      // The tarn below Thornridge's tops.
      h = lerp(h, -0.9, 1 - smoothstep(e.tarn.r - 1.5, e.tarn.r + 1.2, Math.hypot(vx - e.tarn.x, vz - e.tarn.z)));
      // Level ground for the settlements and the fork.
      h = lerp(h, 1.65, 1 - smoothstep(6, 10, Math.hypot(vx - e.cairnhold.x, vz - e.cairnhold.z)));
      h = lerp(h, 0.42, 1 - smoothstep(8.5, 12, Math.hypot(vx - e.heronwick.x, vz - e.heronwick.z)));
      h = lerp(h, 0.5, 1 - smoothstep(5, 9, Math.hypot(vx - e.fork.x, vz - e.fork.z)));
      h = lerp(h, 0.45, 1 - smoothstep(3, 7, Math.hypot(vx - e.tollhouse.x, vz - e.tollhouse.z)));
      // Roads are gentler (in the marsh they stay low: across pools they become boardwalks).
      const pd = distToRoads(vx, vz, list);
      h = lerp(h, h > 0.5 ? h * 0.8 + 0.15 : h, (1 - smoothstep(0.5, 2.5, pd)) * 0.6);
      heights[vz * W1 + vx] = lerp(-1.6, h, land);
    }
  }
  const vh = (vx: number, vz: number) => heights[vz * W1 + vx];

  // --- Tiles ---
  for (let z = 1; z < H - 1; z++) {
    for (let x = 1; x < W - 1; x++) {
      if (inIslandBox(x, z)) continue;
      const mx = x + 0.5;
      const mz = z + 0.5;
      const eD = eastDistance(mx, mz, seed);
      if (eD > 1) continue;
      const avg = (vh(x, z) + vh(x + 1, z) + vh(x, z + 1) + vh(x + 1, z + 1)) / 4;
      const pd = distToRoads(mx, mz, list);
      const north = highland(mz);
      let t: TileType;
      if (avg < WATER_Y + 0.05) t = pd < 1.3 && eD < 0.9 ? T.Bridge : T.Water;
      else if (pd < 1.1) t = T.Path;
      else if (Math.hypot(mx - e.cairnhold.x, mz - e.cairnhold.z) < 4.5) t = T.Plaza;
      else if (Math.hypot(mx - e.heronwick.x, mz - e.heronwick.z) < 4.5) t = T.Plaza;
      else if (eD > 0.86) t = T.Sand;
      else if (north > 0.55) t = avg > 3.2 ? T.Snow : avg > 2.4 || fbm(mx * 0.3, mz * 0.3, seed + 71) > 0.68 ? T.Rocky : T.Heath;
      else if (north > 0.3) t = fbm(mx * 0.12, mz * 0.12, seed + 81) > 0.52 ? T.Forest : T.Grass;
      else t = T.Marsh;
      tiles[idx(x, z)] = t;
      blocked[idx(x, z)] = t === T.Water ? 1 : 0;
      occ[idx(x, z)] = t === T.Path || t === T.Bridge || t === T.Plaza ? 1 : 0;
    }
  }

  // --- The Saltwind Causeway, and the trail to it from the Ironcrag road ---
  for (const c of islandTilesChanged(map)) {
    if (c.x === 100 && c.z === 61) continue;
    const i = idx(c.x, c.z);
    const water = tiles[i] === T.Water;
    tiles[i] = water || c.x >= CAUSEWAY.fromX ? T.Bridge : T.Path;
    blocked[i] = 0;
    occ[i] = 1;
  }
  for (let x = 112; x < W - 1; x++) {
    let reached = false;
    for (const z of [CAUSEWAY.z, CAUSEWAY.z + 1]) {
      const i = idx(x, z);
      if (tiles[i] !== T.Water) reached = true;
      else {
        tiles[i] = T.Bridge;
        blocked[i] = 0;
        occ[i] = 1;
      }
    }
    if (reached) break;
  }

  // --- Scenery (its own random stream) ---
  const rng = mulberry32(seed ^ 0xea57);
  const free = (x: number, z: number) => x > 1 && z > 1 && x < W - 2 && z < H - 2 && !blocked[idx(x, z)] && !occ[idx(x, z)];
  const add = (kind: DecorKind, x: number, z: number, block: boolean, rot = rng() * Math.PI * 2, scale = 0.85 + rng() * 0.3, variant = Math.floor(rng() * 4)) => {
    map.decor.push({ kind, x, z, rot, scale, variant });
    const i = idx(Math.floor(x), Math.floor(z));
    occ[i] = 1;
    if (block) blocked[i] = 1;
  };
  const ctx: Ctx = { map, occ, idx, free, add, roads: list };
  buildHeronwick(ctx, seed);
  // Signposts: at the island end of the trail, where the causeway lands, and at the fork.
  add('signpost', 100.5, 61.5, true, -Math.PI / 2, 1, 0);
  add('signpost', e.fork.x + 1.5, e.fork.z - 1.5, true, 0, 1, 0);
  for (let z = 2; z < H - 2; z++) {
    for (let x = 2; x < W - 2; x++) {
      if (inIslandBox(x, z) || !free(x, z)) continue;
      const t = tiles[idx(x, z)];
      const nearRoad = distToRoads(x + 0.5, z + 0.5, list) < 2;
      const r = rng();
      if (t === T.Heath) {
        if (!nearRoad && r < 0.035) add('pine', x + 0.5, z + 0.5, true);
        else if (r < 0.12) add('heather', x + rng(), z + rng(), false);
        else if (!nearRoad && r < 0.135) add('boulder', x + 0.5, z + 0.5, true);
      } else if (t === T.Rocky || t === T.Snow) {
        if (!nearRoad && r < 0.06) add('boulder', x + 0.5, z + 0.5, true);
        else if (!nearRoad && r < 0.08) add('pine', x + 0.5, z + 0.5, true);
      } else if (t === T.Forest) {
        if (!nearRoad && r < 0.16) add('pine', x + 0.5, z + 0.5, true);
        else if (r < 0.22) add('bush', x + 0.5, z + 0.5, false);
        else if (r < 0.26) add('mushroom', x + rng(), z + rng(), false);
      } else if (t === T.Grass) {
        if (!nearRoad && r < 0.03) add('pine', x + 0.5, z + 0.5, true);
        else if (r < 0.1) add('flowers', x + rng(), z + rng(), false);
        else if (!nearRoad && r < 0.13) add('bush', x + 0.5, z + 0.5, false);
      } else if (t === T.Marsh) {
        const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => tiles[idx(x + a, z + b)] === T.Water);
        if (wet && r < 0.3) add('reeds', x + rng(), z + rng(), false);
        else if (r < 0.05) add('reeds', x + rng(), z + rng(), false);
        else if (r < 0.065) add('mushroom', x + rng(), z + rng(), false);
        else if (!nearRoad && r < 0.08) add('bush', x + 0.5, z + 0.5, false);
      } else if (t === T.Sand) {
        const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => tiles[idx(x + a, z + b)] === T.Water);
        if (wet && r < 0.15) add('reeds', x + rng(), z + rng(), false);
      }
    }
  }
}

interface Ctx {
  map: WorldMap;
  occ: Uint8Array;
  idx: (x: number, z: number) => number;
  free: (x: number, z: number) => boolean;
  add: (kind: DecorKind, x: number, z: number, block: boolean, rot?: number, scale?: number, variant?: number) => void;
  roads: Pt[][];
}

const S = Math.PI;
const near4 = (c: Ctx, x: number, z: number, t: TileType) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => c.map.tiles[c.idx(x + a, z + b)] === t);

/** Blocks a building's footprint (as the island's buildings do) and adds it to the map. */
function building(c: Ctx, b: WorldMap['buildings'][number]) {
  const rotated = Math.abs(Math.sin(b.facing)) > 0.5;
  const w = rotated ? b.d : b.w;
  const d = rotated ? b.w : b.d;
  for (let z = Math.floor(b.z - d / 2); z < Math.ceil(b.z + d / 2); z++) {
    for (let x = Math.floor(b.x - w / 2); x < Math.ceil(b.x + w / 2); x++) {
      c.map.blocked[c.idx(x, z)] = 1;
      c.occ[c.idx(x, z)] = 1;
    }
  }
  c.map.buildings.push(b);
}

function npc(c: Ctx, n: WorldMap['npcs'][number]) {
  c.map.npcs.push(n);
  if (!n.patrol) c.map.blocked[c.idx(Math.floor(n.x), Math.floor(n.z))] = c.occ[c.idx(Math.floor(n.x), Math.floor(n.z))] = 1;
}

/**
 * Resources near a centre on tiles that pass `ok` (each from its own stream, so tuning one never
 * moves another). Returns how many were placed.
 */
function scatterNodes(c: Ctx, type: ResourceType, cx: number, cz: number, n: number, r: number, salt: number, ok: (x: number, z: number) => boolean) {
  const lr = mulberry32(salt);
  let placed = 0;
  for (let tries = 0; tries < 400 && placed < n; tries++) {
    const a = lr() * Math.PI * 2;
    const d = Math.sqrt(lr()) * r;
    const x = Math.floor(cx + Math.cos(a) * d);
    const z = Math.floor(cz + Math.sin(a) * d);
    if (!ok(x, z)) continue;
    c.map.resources.push({ type, x, z });
    c.map.blocked[c.idx(x, z)] = c.occ[c.idx(x, z)] = 1;
    placed++;
  }
  return placed;
}

function spawnCreatures(c: Ctx, type: EnemyType, cx: number, cz: number, r: number, n: number, salt: number) {
  const lr = mulberry32(salt);
  let placed = 0;
  for (let tries = 0; tries < 400 && placed < n; tries++) {
    const a = lr() * Math.PI * 2;
    const d = Math.sqrt(lr()) * r;
    const x = Math.floor(cx + Math.cos(a) * d);
    const z = Math.floor(cz + Math.sin(a) * d);
    const t = c.map.tiles[c.idx(x, z)];
    if (c.map.blocked[c.idx(x, z)] || t === T.Bridge || t === T.Path || t === T.Plaza) continue;
    c.map.enemySpawns.push({ type, x: x + 0.5, z: z + 0.5 });
    placed++;
  }
}

/**
 * Heronwick, a fishing village on a dry rise in Mirefen Marsh, and the marsh around it: willows
 * and mire pools, croakers and leeches, and the Bog Mother by the Sunken Shrine.
 */
function buildHeronwick(c: Ctx, seed: number) {
  const { map } = c;
  // The reeve's house (door west onto the plaza), the bank's strongroom (door east onto the road),
  // and three stilt-cottages.
  building(c, { x: 153, z: 79.5, w: 5, d: 4, facing: -S / 2, style: 'inn', wall: '#d8cdb0', roof: '#5a7a4a' });
  building(c, { x: 138, z: 80.5, w: 5, d: 4, facing: S / 2, style: 'house', wall: '#e2d6bc', roof: '#2f5d4a' });
  building(c, { x: 144, z: 91, w: 4, d: 4, facing: S, style: 'house', wall: '#d6c8a8', roof: '#7a6a3a' });
  building(c, { x: 139, z: 88, w: 4, d: 4, facing: S / 2, style: 'house', wall: '#e0d2b4', roof: '#4a6a7a' });
  building(c, { x: 156, z: 86, w: 4, d: 4, facing: -S / 2, style: 'house', wall: '#d2c4a4', roof: '#8a5a3a' });

  npc(c, { id: 'reeve', x: 149.5, z: 79.5, facing: -S / 2 });
  c.add('stall', 149.5, 82.5, true, S / 2, 1, 3);
  npc(c, { id: 'provisioner', x: 150.5, z: 82.5, facing: -S / 2 });
  npc(c, { id: 'heron_banker', x: 140.5, z: 80.5, facing: S / 2 });
  npc(c, { id: 'fisher', x: 158.5, z: 88.5, facing: S / 2 });

  // The village fire (cook silverpike here) and the waystone.
  c.add('campfire', 145.5, 86.5, true, 0, 1, 0);
  map.stations.push({ kind: 'fire', x: 145.5, z: 86.5, facing: 0 });
  c.add('waystone', 143.5, 84.5, true, 0, 1, 0);
  map.checkpoints.push({ id: 'heronwick', name: 'Heronwick Waystone', x: 143.5, z: 84.5, respawnX: 144.5, respawnZ: 85.5 });
  // Lantern posts along the road through the village, and a few stores by the stall.
  for (const [x, z] of [[138.5, 76.5], [145.5, 79.5], [149.5, 88.5], [152.5, 93.5]]) c.add('lamp', x, z, true, 0, 1, 0);
  c.add('barrel', 151.5, 84.5, true);
  c.add('crate', 147.5, 79.5, true);
  c.add('barrel', 141.5, 86.5, true);

  // Willows lean over the pools round the village; mire pools hold the silverpike.
  const marshBank = (x: number, z: number) => c.free(x, z) && map.tiles[c.idx(x, z)] === T.Marsh && near4(c, x, z, T.Water) && distToRoads(x + 0.5, z + 0.5, c.roads) > 1.8;
  const groves: [number, number, number][] = [[135, 85, 4], [160, 84, 3], [148, 97, 3], [139, 72, 3]];
  groves.forEach(([x, z, n], i) => scatterNodes(c, 'willow', x, z, n, 6, seed ^ (0x3170 + i), marshBank));
  const poolEdge = (x: number, z: number) =>
    map.tiles[c.idx(x, z)] === T.Water && !c.occ[c.idx(x, z)] && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => map.tiles[c.idx(x + a, z + b)] === T.Marsh && !map.blocked[c.idx(x + a, z + b)]);
  const pools: [number, number][] = [[161, 87], [134, 85], [148, 98], [163, 79], [176, 97], [157, 100]];
  pools.forEach(([x, z], i) => scatterNodes(c, 'mire_pool', x, z, 1, 4, seed ^ (0x9001 + i), poolEdge));

  // Croakers near the village; leeches in the deep marsh; the Bog Mother by the shrine.
  spawnCreatures(c, 'bog_croaker', 156, 96, 7, 5, seed ^ 0xc40a);
  spawnCreatures(c, 'bog_croaker', 137, 96, 5, 3, seed ^ 0xc40b);
  spawnCreatures(c, 'mire_leech', 166, 103, 7, 6, seed ^ 0x1eec);
  map.enemySpawns.push({ type: 'bog_mother', x: 171.5, z: 107.5 });

  // The Sunken Shrine: a ring of drowned pillars round a sealed door, half in the sea.
  c.add('sunken_shrine', 178.5, 109.5, true, (-3 * S) / 4, 1, 0);
  for (let z = 108; z <= 110; z++) for (let x = 177; x <= 179; x++) map.blocked[c.idx(x, z)] = c.occ[c.idx(x, z)] = 1;
}
