import { fbm } from '../core/noise';
import { mulberry32, type Rng } from '../core/rng';
import { clamp, distToSegment, lerp } from '../core/math';
import type { ResourceType } from '../data/resources';
import type { EnemyType } from '../data/enemies';
import type { NpcId } from '../data/npcs';
import type { StationKind } from '../data/recipes';

/** Terrain tile types. */
export const T = {
  Grass: 0,
  Forest: 1,
  Path: 2,
  Sand: 3,
  Water: 4,
  Rocky: 5,
  Plaza: 6,
  Bridge: 7,
  Field: 8,
  Camp: 9,
} as const;
export type TileType = (typeof T)[keyof typeof T];

export type DecorKind =
  | 'pine'
  | 'bush'
  | 'boulder'
  | 'flowers'
  | 'fence'
  | 'lamp'
  | 'stall'
  | 'crate'
  | 'barrel'
  | 'tent'
  | 'totem'
  | 'campfire'
  | 'spinning_wheel'
  | 'fountain'
  | 'shrine'
  | 'haystack'
  | 'wheat'
  | 'mushroom'
  | 'reeds'
  | 'anvil'
  | 'spikes'
  | 'signpost'
  | 'waystone'
  | 'furnace'
  | 'range';

export interface Decor {
  kind: DecorKind;
  x: number;
  z: number;
  rot: number;
  scale: number;
  variant: number;
}

/** Where the banker stands, behind the bank counter (counter top spans BANK_COUNTER). */
export const BANKER = { x: 49.4, z: 60.0 };
export const BANK_COUNTER = { x: 50.45, z: 60.0, len: 1.9 };

export interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  /** Direction the door faces, radians around Y (0 = +z). */
  facing: number;
  style: 'house' | 'hall' | 'inn' | 'smithy' | 'bank';
  wall: string;
  roof: string;
}

export interface Region {
  id: string;
  name: string;
  x: number;
  z: number;
  radius: number;
  levels: string;
  danger: 0 | 1 | 2 | 3;
}

export interface WorldMap {
  seed: number;
  width: number;
  height: number;
  tiles: Uint8Array;
  /** Vertex heights, (width+1)*(height+1). */
  heights: Float32Array;
  blocked: Uint8Array;
  buildings: Building[];
  resources: { type: ResourceType; x: number; z: number }[];
  decor: Decor[];
  enemySpawns: { type: EnemyType; x: number; z: number }[];
  /** `patrol`: waypoints for NPCs that walk a route (their tile is left unblocked). */
  npcs: { id: NpcId; x: number; z: number; facing: number; patrol?: { x: number; z: number }[] }[];
  /** Production stations players can use (furnace, anvil, cooking range). */
  stations: { kind: Exclude<StationKind, 'fletching' | 'crafting'>; x: number; z: number; facing: number }[];
  spawn: { x: number; z: number };
  regions: Region[];
  checkpoints: Checkpoint[];
}

export interface Checkpoint {
  id: string;
  name: string;
  x: number;
  z: number;
  /** Where the player reappears. */
  respawnX: number;
  respawnZ: number;
}

export const BRIDGE_Y = 0.42;
export const WATER_Y = -0.38;

export const VILLAGE = { x: 56, z: 66 };

export function riverX(z: number): number {
  return 38 + 3.5 * Math.sin(z * 0.08) + 1.5 * Math.sin(z * 0.23 + 1);
}

const PATHS: [number, number][][] = [
  [[56, 66], [44, 65], [32, 63], [22, 62]],
  [[56, 60], [55, 46], [52, 34], [48, 22]],
  [[52, 32], [40, 30], [30, 32], [22, 42], [20, 54]],
  [[62, 66], [74, 64], [88, 62]],
  [[86, 58], [88, 44], [86, 32]],
  [[56, 72], [56, 90]],
];

export const REGIONS: Region[] = [
  { id: 'village', name: 'Brightwater Village', x: 56, z: 66, radius: 14, levels: 'Safe haven', danger: 0 },
  { id: 'meadow', name: 'Slime Meadows', x: 22, z: 62, radius: 14, levels: 'Lv 1–5', danger: 1 },
  { id: 'woods', name: 'Whispering Woods', x: 50, z: 26, radius: 20, levels: 'Lv 5–12', danger: 2 },
  { id: 'hills', name: 'Ironcrag Hills', x: 88, z: 62, radius: 16, levels: 'Mining', danger: 1 },
  { id: 'camp', name: 'Goblin Encampment', x: 86, z: 28, radius: 10, levels: 'Lv 10–25', danger: 3 },
  { id: 'fields', name: 'Southern Fields', x: 56, z: 90, radius: 10, levels: 'Safe', danger: 0 },
];

const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function distToPaths(x: number, z: number): number {
  let best = Infinity;
  for (const p of PATHS) {
    for (let i = 0; i < p.length - 1; i++) {
      best = Math.min(best, distToSegment(x, z, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]));
    }
  }
  return best;
}

export function regionAt(x: number, z: number): Region | null {
  let best: Region | null = null;
  let bestD = Infinity;
  for (const r of REGIONS) {
    const d = Math.hypot(x - r.x, z - r.z) / r.radius;
    if (d < 1 && d < bestD) {
      best = r;
      bestD = d;
    }
  }
  return best;
}

export function generateWorld(seed = 1337): WorldMap {
  const W = 112;
  const H = 112;
  const rng: Rng = mulberry32(seed);
  const cx = W / 2;
  const cz = H / 2;
  const R = W * 0.46;

  const heights = new Float32Array((W + 1) * (H + 1));
  const islandD = (x: number, z: number) =>
    Math.hypot(x - cx, (z - cz) * 1.05) / R + (fbm(x * 0.06, z * 0.06, seed + 7) - 0.5) * 0.28;

  for (let vz = 0; vz <= H; vz++) {
    for (let vx = 0; vx <= W; vx++) {
      let h = (fbm(vx * 0.05, vz * 0.05, seed) - 0.5) * 1.8 + 0.45;
      // Eastern hills
      const hd = Math.hypot(vx - 90, vz - 60) / 22;
      h += (1 - smoothstep(0, 1, hd)) * (1.6 + fbm(vx * 0.12, vz * 0.12, seed + 3) * 2.2);
      // Gentle northern rise for the woods
      h += (1 - smoothstep(0, 1, Math.hypot(vx - 50, vz - 24) / 26)) * 0.6;
      // Village flattening
      const vd = Math.hypot(vx - VILLAGE.x, vz - VILLAGE.z);
      h = lerp(h, 0.32, 1 - smoothstep(10, 17, vd));
      // Camp flattening
      h = lerp(h, 0.7, 1 - smoothstep(6, 10, Math.hypot(vx - 86, vz - 28)));
      // Paths are a little flatter
      const pd = distToPaths(vx, vz);
      h = lerp(h, Math.min(h, 0.6) * 0.6 + 0.2, (1 - smoothstep(0.5, 3, pd)) * 0.5);
      // River channel
      const rd = Math.abs(vx - riverX(vz));
      if (rd < 5) h = lerp(h, -1.1, 1 - smoothstep(1.2, 4.2, rd));
      // Coast
      const id = islandD(vx, vz);
      h = lerp(h, -1.6, smoothstep(0.86, 1.0, id));
      heights[vz * (W + 1) + vx] = h;
    }
  }

  const tiles = new Uint8Array(W * H);
  const blocked = new Uint8Array(W * H);
  const occ = new Uint8Array(W * H);
  const idx = (x: number, z: number) => z * W + x;
  const vh = (vx: number, vz: number) => heights[vz * (W + 1) + vx];

  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const avg = (vh(x, z) + vh(x + 1, z) + vh(x, z + 1) + vh(x + 1, z + 1)) / 4;
      const mx = x + 0.5;
      const mz = z + 0.5;
      const pd = distToPaths(mx, mz);
      let t: TileType = T.Grass;
      const water = avg < WATER_Y + 0.05;
      if (water) {
        t = pd < 1.3 && islandD(mx, mz) < 0.9 ? T.Bridge : T.Water;
      } else if (pd < 1.1) {
        t = T.Path;
      } else if (Math.hypot(mx - VILLAGE.x, mz - VILLAGE.z) < 5.5) {
        t = T.Plaza;
      } else if (Math.hypot(mx - 86, mz - 28) < 7.5) {
        t = T.Camp;
      } else if (avg < 0.02 || islandD(mx, mz) > 0.84) {
        t = T.Sand;
      } else if (avg > 1.9 && Math.hypot(mx - 90, mz - 60) < 22) {
        t = T.Rocky;
      } else if (mz < 44 - fbm(mx * 0.1, 0, seed) * 6 && mx > 12 && mx < 78 && Math.hypot(mx - 86, mz - 28) > 11) {
        t = T.Forest;
      } else if ((mx > 47 && mx < 54 && mz > 83 && mz < 93) || (mx > 58 && mx < 66 && mz > 83 && mz < 93)) {
        t = T.Field;
      }
      tiles[idx(x, z)] = t;
      if (t === T.Water) blocked[idx(x, z)] = 1;
      if (t === T.Path || t === T.Bridge || t === T.Plaza) occ[idx(x, z)] = 1;
    }
  }
  // Map border is always blocked.
  for (let i = 0; i < W; i++) {
    blocked[idx(i, 0)] = blocked[idx(i, H - 1)] = 1;
    blocked[idx(0, i)] = blocked[idx(W - 1, i)] = 1;
  }

  const inBounds = (x: number, z: number) => x > 1 && z > 1 && x < W - 2 && z < H - 2;
  const free = (x: number, z: number) => inBounds(x, z) && !blocked[idx(x, z)] && !occ[idx(x, z)];
  const decor: Decor[] = [];
  const addDecor = (kind: DecorKind, x: number, z: number, block: boolean, rot = rng() * Math.PI * 2, scale = 0.85 + rng() * 0.3, variant = Math.floor(rng() * 4)) => {
    decor.push({ kind, x, z, rot, scale, variant });
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (inBounds(tx, tz)) {
      occ[idx(tx, tz)] = 1;
      if (block) blocked[idx(tx, tz)] = 1;
    }
  };

  // --- Village buildings ---
  const S = Math.PI;
  const buildings: Building[] = [
    { x: 56, z: 55.5, w: 7, d: 5, facing: 0, style: 'hall', wall: '#efe2c4', roof: '#4b6fb3' },
    // Bank of Brightwater: door and counter face the plaza (east).
    { x: 46, z: 60, w: 6, d: 5, facing: S / 2, style: 'bank', wall: '#efe4cc', roof: '#2f5d4a' },
    { x: 46.5, z: 71.5, w: 4, d: 4, facing: S / 2, style: 'house', wall: '#e9dcc0', roof: '#d4893a' },
    { x: 66, z: 58.5, w: 6, d: 5, facing: -S / 2, style: 'inn', wall: '#f0dcb8', roof: '#8a3d5c' },
    { x: 66.5, z: 72.5, w: 5, d: 4, facing: -S / 2, style: 'smithy', wall: '#c9b9a1', roof: '#5a5f6b' },
    { x: 51, z: 78.5, w: 4, d: 4, facing: S, style: 'house', wall: '#f6ead6', roof: '#3f8a63' },
    { x: 62, z: 79, w: 4, d: 4, facing: S, style: 'house', wall: '#eadcc6', roof: '#c4553b' },
  ];
  for (const b of buildings) {
    const rotated = Math.abs(Math.sin(b.facing)) > 0.5;
    const w = rotated ? b.d : b.w;
    const d = rotated ? b.w : b.d;
    for (let z = Math.floor(b.z - d / 2); z < Math.ceil(b.z + d / 2); z++) {
      for (let x = Math.floor(b.x - w / 2); x < Math.ceil(b.x + w / 2); x++) {
        blocked[idx(x, z)] = 1;
        occ[idx(x, z)] = 1;
        if (tiles[idx(x, z)] === T.Path) tiles[idx(x, z)] = T.Grass;
      }
    }
  }

  // Bank counter in front of the bank door; the banker stands between counter and door.
  for (const z of [59, 60]) {
    blocked[idx(49, z)] = 1;
    occ[idx(49, z)] = 1;
    blocked[idx(50, z)] = 1;
    occ[idx(50, z)] = 1;
  }

  // --- Village props ---
  for (let x = 55; x <= 57; x++) for (let z = 65; z <= 67; z++) blocked[idx(x, z)] = 1;
  decor.push({ kind: 'fountain', x: 56.5, z: 66.5, rot: 0, scale: 1, variant: 0 });
  addDecor('shrine', 51.5, 66.5, true, S / 2, 1, 0);
  addDecor('stall', 60.5, 62.5, true, -S / 4, 1, 0);
  addDecor('stall', 52.5, 62.5, true, S / 4, 1, 1);
  addDecor('anvil', 63.5, 74.5, true, 0, 1, 0);
  // Smithy furnace beside the door, and a cooking range outside the inn.
  addDecor('furnace', 63.5, 72.0, true, -S / 2, 1, 0);
  occ[idx(63, 71)] = blocked[idx(63, 71)] = 1;
  addDecor('range', 62.5, 57.5, true, -S / 2, 1, 0);
  // Riverside campfire on the east bank, beside the village fishing spots.
  addDecor('campfire', 40.5, 57.5, true, 0, 1, 0);
  const stations: WorldMap['stations'] = [
    { kind: 'fire', x: 40.5, z: 57.5, facing: 0 },
    { kind: 'furnace', x: 63.5, z: 72.0, facing: -S / 2 },
    { kind: 'anvil', x: 63.5, z: 74.5, facing: 0 },
    { kind: 'range', x: 62.5, z: 57.5, facing: -S / 2 },
  ];
  addDecor('barrel', 63.5, 70.5, true);
  addDecor('crate', 69.5, 62.5, true);
  addDecor('barrel', 62.5, 55.5, true);
  addDecor('crate', 49.5, 57.5, true);
  addDecor('haystack', 44.5, 66.5, true);
  for (let a = 0; a < 6; a++) {
    const ang = (a / 6) * Math.PI * 2 + 0.5;
    const lx = Math.floor(VILLAGE.x + Math.cos(ang) * 6.6) + 0.5;
    const lz = Math.floor(VILLAGE.z + Math.sin(ang) * 6.6) + 0.5;
    if (!blocked[idx(Math.floor(lx), Math.floor(lz))]) addDecor('lamp', lx, lz, true, 0, 1, 0);
  }
  addDecor('signpost', 42.5, 67.5, true, S / 2, 1, 0);

  // Waystones (respawn checkpoints). The village shrine is the bound home.
  const checkpoints: Checkpoint[] = [
    { id: 'home', name: 'Brightwater Shrine', x: 51.5, z: 66.5, respawnX: 53.5, respawnZ: 68.5 },
    { id: 'meadow', name: 'Meadow Waystone', x: 28.5, z: 59.5, respawnX: 29.5, respawnZ: 61.5 },
    { id: 'woods', name: 'Woods Waystone', x: 58.5, z: 44.5, respawnX: 56.5, respawnZ: 45.5 },
    { id: 'hills', name: 'Ironcrag Waystone', x: 77.5, z: 61.5, respawnX: 77.5, respawnZ: 63.5 },
  ];
  for (const c of checkpoints.slice(1)) addDecor('waystone', c.x, c.z, true, 0, 1, 0);
  addDecor('signpost', 58.5, 50.5, true, 0, 1, 0);

  // Field crops and fences
  for (let z = 84; z < 93; z++) {
    for (let x = 47; x < 66; x++) {
      if (tiles[idx(x, z)] !== T.Field) continue;
      decor.push({ kind: 'wheat', x: x + 0.5, z: z + 0.5, rot: rng() * 6, scale: 0.9 + rng() * 0.2, variant: 0 });
      occ[idx(x, z)] = 1;
    }
  }
  for (const [x0, x1] of [[46, 54], [57, 66]] as const) {
    for (let x = x0; x <= x1; x++) {
      for (const z of [82, 93]) {
        if (Math.abs(x + 0.5 - 56) < 2) continue;
        if (!blocked[idx(x, z)] && tiles[idx(x, z)] !== T.Path) addDecor('fence', x + 0.5, z + 0.5, true, 0, 1, 0);
      }
    }
    for (let z = 83; z <= 92; z++) {
      for (const x of [x0, x1]) {
        if (!blocked[idx(x, z)] && tiles[idx(x, z)] !== T.Path) addDecor('fence', x + 0.5, z + 0.5, true, S / 2, 1, 0);
      }
    }
  }
  addDecor('haystack', 67.5, 86.5, true);
  addDecor('haystack', 45.5, 89.5, true);

  // --- Goblin camp ---
  const camp = { x: 86, z: 28 };
  decor.push({ kind: 'campfire', x: camp.x + 0.5, z: camp.z + 0.5, rot: 0, scale: 1, variant: 0 });
  blocked[idx(camp.x, camp.z)] = 1;
  for (const [ox, oz, r] of [[-4, -3, 0.6], [4, -4, -0.5], [-4, 3, 2.5], [5, 2, -2.2]] as const) {
    addDecor('tent', camp.x + ox + 0.5, camp.z + oz + 0.5, true, r, 1.1, 0);
    blocked[idx(camp.x + ox + 1, camp.z + oz)] = 1;
    blocked[idx(camp.x + ox, camp.z + oz + 1)] = 1;
  }
  addDecor('totem', camp.x - 1.5, camp.z + 6.5, true, 0, 1.1, 0);
  addDecor('totem', camp.x + 2.5, camp.z + 6.5, true, 0, 1.1, 1);
  for (let a = 0; a < 40; a++) {
    const ang = (a / 40) * Math.PI * 2;
    if (Math.abs(ang - Math.PI / 2) < 0.35) continue; // opening facing south
    const sx = Math.floor(camp.x + Math.cos(ang) * 9.2);
    const sz = Math.floor(camp.z + Math.sin(ang) * 9.2);
    if (inBounds(sx, sz) && !blocked[idx(sx, sz)] && tiles[idx(sx, sz)] !== T.Path && tiles[idx(sx, sz)] !== T.Water)
      addDecor('spikes', sx + 0.5, sz + 0.5, true, -ang, 1, 0);
  }

  // --- Resources ---
  const resources: WorldMap['resources'] = [];
  const nearPath = (x: number, z: number) => distToPaths(x + 0.5, z + 0.5) < 2.0;
  const addResource = (type: ResourceType, x: number, z: number) => {
    resources.push({ type, x, z });
    blocked[idx(x, z)] = 1;
    occ[idx(x, z)] = 1;
  };
  const clusters: { type: ResourceType; x: number; z: number; n: number; r: number }[] = [
    { type: 'tree', x: 70, z: 49, n: 7, r: 4 },
    { type: 'tree', x: 43, z: 52, n: 5, r: 3.5 },
    { type: 'tree', x: 72, z: 80, n: 5, r: 3.5 },
    { type: 'copper_rock', x: 80, z: 57, n: 5, r: 3 },
    { type: 'tin_rock', x: 82, z: 67, n: 5, r: 3 },
    { type: 'iron_rock', x: 95, z: 63, n: 5, r: 3.5 },
    { type: 'copper_rock', x: 92, z: 52, n: 3, r: 2.5 },
  ];
  for (const c of clusters) {
    let placed = 0;
    for (let tries = 0; tries < 200 && placed < c.n; tries++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * c.r;
      const x = Math.floor(c.x + Math.cos(a) * r);
      const z = Math.floor(c.z + Math.sin(a) * r);
      if (!free(x, z) || nearPath(x, z)) continue;
      if (tiles[idx(x, z)] === T.Water || tiles[idx(x, z)] === T.Sand) continue;
      addResource(c.type, x, z);
      placed++;
    }
  }

  // Fishing spots in the river just west of the village (water tiles beside the east bank).
  for (const [x, z] of [[38, 53], [38, 55], [38, 57], [37, 72], [37, 73]]) {
    if (tiles[idx(x, z)] === T.Water && tiles[idx(x + 1, z)] !== T.Water) addResource('net_spot', x, z);
  }

  // Scatter vegetation
  for (let z = 2; z < H - 2; z++) {
    for (let x = 2; x < W - 2; x++) {
      if (!free(x, z)) continue;
      const t = tiles[idx(x, z)];
      const vd = Math.hypot(x - VILLAGE.x, z - VILLAGE.z);
      const pn = nearPath(x, z);
      const r = rng();
      if (t === T.Forest && !pn) {
        if (r < 0.1) addResource('tree', x, z);
        else if (r < 0.135) addResource('oak', x, z);
        else if (r < 0.2) addDecor('pine', x + 0.5, z + 0.5, true);
        else if (r < 0.24) addDecor('bush', x + 0.5 + (rng() - 0.5) * 0.4, z + 0.5 + (rng() - 0.5) * 0.4, false);
        else if (r < 0.27) addDecor('mushroom', x + rng(), z + rng(), false);
        else if (r < 0.3) addDecor('flowers', x + rng(), z + rng(), false);
      } else if (t === T.Grass && vd > 15) {
        if (!pn && r < 0.012) addResource('tree', x, z);
        else if (!pn && r < 0.024) addDecor('pine', x + 0.5, z + 0.5, true);
        else if (!pn && r < 0.05) addDecor('bush', x + 0.5, z + 0.5, false);
        else if (r < 0.1) addDecor('flowers', x + rng(), z + rng(), false);
        else if (!pn && r < 0.106) addDecor('boulder', x + 0.5, z + 0.5, true);
      } else if (t === T.Grass && vd > 8) {
        if (r < 0.06) addDecor('flowers', x + rng(), z + rng(), false);
        else if (!pn && r < 0.075) addDecor('bush', x + 0.5, z + 0.5, false);
      } else if (t === T.Rocky || (t === T.Grass && Math.hypot(x - 90, z - 60) < 20)) {
        if (!pn && r < 0.05) addDecor('boulder', x + 0.5, z + 0.5, true);
        else if (!pn && r < 0.065) addDecor('pine', x + 0.5, z + 0.5, true);
      } else if (t === T.Sand) {
        const nearWater =
          tiles[idx(x + 1, z)] === T.Water || tiles[idx(x - 1, z)] === T.Water || tiles[idx(x, z + 1)] === T.Water || tiles[idx(x, z - 1)] === T.Water;
        if (nearWater && r < 0.18) addDecor('reeds', x + rng(), z + rng(), false);
        else if (!pn && r < 0.01) addDecor('boulder', x + 0.5, z + 0.5, true);
      }
    }
  }

  // Clear the agility course ground east of the smithy (trees and scenery there are removed).
  const inCourse = (x: number, z: number) => x >= 79 && x < 91 && z >= 73 && z < 81;
  for (let i = resources.length - 1; i >= 0; i--) {
    const r = resources[i];
    if (!inCourse(r.x, r.z)) continue;
    resources.splice(i, 1);
    blocked[idx(r.x, r.z)] = occ[idx(r.x, r.z)] = 0;
  }
  for (let i = decor.length - 1; i >= 0; i--) {
    const d = decor[i];
    if (!inCourse(d.x, d.z)) continue;
    decor.splice(i, 1);
    blocked[idx(Math.floor(d.x), Math.floor(d.z))] = occ[idx(Math.floor(d.x), Math.floor(d.z))] = 0;
  }

  // Later content is placed with its own random stream, so adding it never reshuffles the trees,
  // rocks and scenery generated above (existing players keep the world they know).
  const placeLater = (type: ResourceType, cx: number, cz: number, n: number, r: number, salt: number) => {
    const lr = mulberry32(seed ^ salt);
    let placed = 0;
    for (let tries = 0; tries < 300 && placed < n; tries++) {
      const a = lr() * Math.PI * 2;
      const d = Math.sqrt(lr()) * r;
      const x = Math.floor(cx + Math.cos(a) * d);
      const z = Math.floor(cz + Math.sin(a) * d);
      if (!free(x, z) || nearPath(x, z)) continue;
      if (tiles[idx(x, z)] === T.Water || tiles[idx(x, z)] === T.Sand) continue;
      addResource(type, x, z);
      placed++;
    }
  };
  // Coal deep in the Ironcrag Hills, past the iron (Mining 30, for steel).
  placeLater('coal_rock', 99, 70, 5, 3.5, 0xc0a1);
  // A flax patch south-east of the wheat fields (Crafting: spin into bowstrings).
  placeLater('flax', 72, 87, 8, 3, 0xf1a5);
  // The crafting corner beside the smithy: a spinning wheel (the tanner stands just south).
  addDecor('spinning_wheel', 70.5, 73.5, true, -S / 2, 1, 0);
  stations.push({ kind: 'spinning_wheel', x: 70.5, z: 73.5, facing: -S / 2 });
  // Thieving: the west plaza stall is the bakery stall; a seed stall stands by the fields.
  resources.push({ type: 'bakery_stall', x: 52, z: 62 });
  addDecor('stall', 66.5, 80.5, true, 0, 1, 2);
  resources.push({ type: 'seed_stall', x: 66, z: 80 });

  // --- NPCs ---
  const npcs: WorldMap['npcs'] = [
    { id: 'elder', x: 56.5, z: 59.6, facing: 0 },
    { id: 'merchant', x: 60.2, z: 64.4, facing: -2.4 },
    {
      id: 'guard',
      x: 70.5,
      z: 66.2,
      facing: -S / 2,
      // Walks the east road just outside the plaza.
      patrol: [
        { x: 70.5, z: 66.2 },
        { x: 73.8, z: 64.4 },
        { x: 64.8, z: 65.6 },
      ],
    },
    { id: 'smith', x: 62.6, z: 73.4, facing: -S / 2 },
    { id: 'banker', x: BANKER.x, z: BANKER.z, facing: S / 2 },
    { id: 'tanner', x: 70.5, z: 76.2, facing: S },
    // Townsfolk strolling round the plaza, and the farmer by the fields.
    { id: 'townsman', x: 54.5, z: 70.0, facing: 0, patrol: [{ x: 54.5, z: 70.0 }, { x: 59.5, z: 70.0 }, { x: 60.5, z: 67.5 }] },
    { id: 'townswoman', x: 52.5, z: 64.0, facing: 0, patrol: [{ x: 52.5, z: 64.0 }, { x: 58.0, z: 63.6 }] },
    { id: 'farmer', x: 56.5, z: 81.0, facing: 0, patrol: [{ x: 56.5, z: 81.0 }, { x: 60.5, z: 81.0 }] },
  ];
  for (const n of npcs) if (!n.patrol) blocked[idx(Math.floor(n.x), Math.floor(n.z))] = 1;

  // --- Enemy spawns ---
  const enemySpawns: WorldMap['enemySpawns'] = [];
  const spawnIn = (type: EnemyType, x: number, z: number, r: number, n: number) => {
    let placed = 0;
    for (let tries = 0; tries < 400 && placed < n; tries++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * r;
      const sx = Math.floor(x + Math.cos(a) * d);
      const sz = Math.floor(z + Math.sin(a) * d);
      if (!inBounds(sx, sz) || blocked[idx(sx, sz)] || tiles[idx(sx, sz)] === T.Bridge) continue;
      if (Math.abs(sx - riverX(sz)) < 4) continue;
      enemySpawns.push({ type, x: sx + 0.5, z: sz + 0.5 });
      placed++;
    }
  };
  spawnIn('slime', 22, 62, 10, 10);
  spawnIn('wolf', 52, 24, 13, 7);
  spawnIn('goblin', 86, 28, 6, 6);
  enemySpawns.push({ type: 'goblin_warlord', x: 87.5, z: 24.5 });

  return {
    seed,
    width: W,
    height: H,
    tiles,
    heights,
    blocked,
    buildings,
    resources,
    decor,
    enemySpawns,
    npcs,
    stations,
    spawn: { x: 56.5, z: 63.4 },
    regions: REGIONS,
    checkpoints,
  };
}

export function tileAt(map: WorldMap, x: number, z: number): number {
  const tx = Math.floor(x);
  const tz = Math.floor(z);
  if (tx < 0 || tz < 0 || tx >= map.width || tz >= map.height) return T.Water;
  return map.tiles[tz * map.width + tx];
}

export function isBlocked(map: WorldMap, x: number, z: number): boolean {
  const tx = Math.floor(x);
  const tz = Math.floor(z);
  if (tx < 0 || tz < 0 || tx >= map.width || tz >= map.height) return true;
  return map.blocked[tz * map.width + tx] === 1;
}

export function terrainHeight(map: WorldMap, x: number, z: number): number {
  const W1 = map.width + 1;
  const fx = clamp(x, 0, map.width - 0.001);
  const fz = clamp(z, 0, map.height - 0.001);
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const u = fx - x0;
  const v = fz - z0;
  const h00 = map.heights[z0 * W1 + x0];
  const h10 = map.heights[z0 * W1 + x0 + 1];
  const h01 = map.heights[(z0 + 1) * W1 + x0];
  const h11 = map.heights[(z0 + 1) * W1 + x0 + 1];
  return lerp(lerp(h00, h10, u), lerp(h01, h11, u), v);
}

/** Height an entity stands at, including bridge decks. */
export function groundHeight(map: WorldMap, x: number, z: number): number {
  const h = terrainHeight(map, x, z);
  if (tileAt(map, x, z) === T.Bridge) return Math.max(h, BRIDGE_Y);
  return Math.max(h, WATER_Y);
}
