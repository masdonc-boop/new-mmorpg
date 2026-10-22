import * as THREE from 'three';
import { mulberry32 } from '../core/rng';
import type { ResourceType } from '../data/resources';
import { T, groundHeight, terrainHeight, BANK_COUNTER, BRIDGE_Y, EXCHANGE, WATER_Y, type Building, type Decor, type WorldMap } from '../sim/worldmap';
import type { ResourceNode } from '../sim/world';
import { blob, makeWorldMaterial, merge, part, place, prism } from './geom';
import { ART } from './art';
import { HOUSE } from '../data/construction';
import { bridgePiers } from './bridges';
import { addShowcaseDetail, buildBankV2, buildHallV2, copperOreMaterial, copperRockV2 } from './showcase';

const Box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const Cyl = (rt: number, rb: number, h: number, seg = 7) => new THREE.CylinderGeometry(rt, rb, h, seg);
const Cone = (r: number, h: number, seg = 7) => new THREE.ConeGeometry(r, h, seg);

// ------------------------------------------------------------------ prefabs

function treePrefab(seed: number, oak: boolean): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const trunkH = oak ? 1.3 : 1.4;
  parts.push(part(Cyl(oak ? 0.2 : 0.14, oak ? 0.3 : 0.22, trunkH, 6), oak ? '#6e4a2c' : '#86592f', { y: trunkH / 2 }));
  // Roots
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rng();
    parts.push(part(Box(0.12, 0.12, 0.42), '#6e4a2c', { x: Math.cos(a) * 0.22, y: 0.05, z: Math.sin(a) * 0.22, ry: -a + Math.PI / 2 }));
  }
  const greens = oak ? ['#3f8f3a', '#4c9e3f', '#5aa842', '#77b347'] : ['#56b947', '#6cc94d', '#4aa73e', '#83d457'];
  const blobs = oak ? 5 : 4;
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + rng();
    const r = i === 0 ? 0 : (oak ? 0.6 : 0.45) * (0.7 + rng() * 0.5);
    const size = (oak ? 0.95 : 0.78) * (i === 0 ? 1.1 : 0.75 + rng() * 0.3);
    parts.push(
      part(blob(size, 1, 0.16, rng()), greens[i % greens.length], {
        x: Math.cos(a) * r,
        y: trunkH + (oak ? 0.55 : 0.6) + (i === 0 ? 0.35 : rng() * 0.35),
        z: Math.sin(a) * r,
        jitter: 0.08,
      }),
    );
  }
  if (!oak && rng() < 0.5) {
    // A few red fruit for charm
    for (let i = 0; i < 3; i++) {
      const a = rng() * Math.PI * 2;
      parts.push(part(blob(0.08), '#e24a3b', { x: Math.cos(a) * 0.75, y: trunkH + 0.5 + rng() * 0.5, z: Math.sin(a) * 0.75 }));
    }
  }
  return merge(parts);
}

/** Mirefen willow: a squat pale trunk under a wide crown, with long strands hanging to the ground. */
function willowPrefab(seed: number): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [part(Cyl(0.2, 0.32, 1.5, 6), '#9a8a66', { y: 0.75, rz: (rng() - 0.5) * 0.15 })];
  const greens = ['#9bbf5a', '#a8c866', '#8db352'];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rng();
    const r = i === 0 ? 0 : 0.55;
    parts.push(part(blob(i === 0 ? 0.9 : 0.65, 1, 0.14, rng()), greens[i % 3], { x: Math.cos(a) * r, y: 2.0 + (i === 0 ? 0.3 : 0), z: Math.sin(a) * r, sy: 0.6, jitter: 0.06 }));
  }
  // Hanging strands round the crown's rim.
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rng() * 0.3;
    const r = 0.95 + rng() * 0.25;
    const h = 1.1 + rng() * 0.5;
    parts.push(part(Box(0.07, h, 0.12), greens[(i + 1) % 3], { x: Math.cos(a) * r, y: 2.0 - h / 2, z: Math.sin(a) * r, ry: -a, sway: 1, jitter: 0.06 }));
  }
  return merge(parts);
}

/** Thornridge rowan: a slim grey trunk, a light, feathery crown and clusters of red berries. */
function rowanPrefab(seed: number): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [part(Cyl(0.12, 0.2, 1.8, 6), '#8a8478', { y: 0.9 })];
  const greens = ['#6f9a3a', '#7fae46', '#5f8a34'];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng();
    const r = i === 0 ? 0 : 0.45;
    parts.push(part(blob(i === 0 ? 0.7 : 0.5, 0, 0.22, rng()), greens[i % 3], { x: Math.cos(a) * r, y: 2.2 + (i === 0 ? 0.35 : rng() * 0.3), z: Math.sin(a) * r, jitter: 0.08 }));
  }
  for (let i = 0; i < 6; i++) {
    const a = rng() * Math.PI * 2;
    parts.push(part(blob(0.09), '#d8342a', { x: Math.cos(a) * 0.62, y: 2.0 + rng() * 0.5, z: Math.sin(a) * 0.62 }));
  }
  return merge(parts);
}

function stumpPrefab(oak: boolean): THREE.BufferGeometry {
  return merge([
    part(Cyl(oak ? 0.26 : 0.2, oak ? 0.32 : 0.25, 0.35, 7), oak ? '#6e4a2c' : '#86592f', { y: 0.17 }),
    part(Cyl(oak ? 0.24 : 0.18, oak ? 0.24 : 0.18, 0.02, 7), '#e6c48f', { y: 0.36 }),
  ]);
}

function pinePrefab(seed: number): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const parts = [part(Cyl(0.12, 0.18, 1.0, 6), '#7a4f2a', { y: 0.5 })];
  const shades = ['#2f7d4f', '#3a8e57', '#469c5f'];
  const tiers = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < tiers; i++) {
    const r = 1.0 - i * 0.2;
    parts.push(part(Cone(r, 1.1, 7), shades[i % 3], { y: 0.9 + i * 0.62, ry: rng() * 3, jitter: 0.06 }));
  }
  if (rng() < 0.3) parts.push(part(Cone(0.25, 0.3, 7), '#f4f7f5', { y: 0.9 + tiers * 0.62 - 0.1 }));
  return merge(parts);
}

/** A clump of flax: thin stalks with little blue flowers (picked: short stubble). */
function flaxPrefab(seed: number, picked: boolean): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const n = picked ? 6 : 9;
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const r = 0.06 + rng() * 0.2;
    const h = picked ? 0.1 + rng() * 0.06 : 0.55 + rng() * 0.3;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const lean = (rng() - 0.5) * 0.3;
    parts.push(part(Cyl(0.014, 0.02, h, 4), picked ? '#a08a4a' : '#6f9e3c', { x, y: h / 2, z, rx: lean, rz: lean, jitter: 0 }));
    if (!picked) parts.push(part(blob(0.045, 0, 0.1, rng()), rng() < 0.7 ? '#7fa8e8' : '#9fc0f2', { x: x + lean * h * 0.5, y: h, z: z - lean * h * 0.5, jitter: 0 }));
  }
  return merge(parts);
}

function rockPrefab(seed: number, ore: string | null, depleted: boolean): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const base = depleted ? '#8f8a82' : '#9a948a';
  if (depleted) {
    for (let i = 0; i < 3; i++) {
      const a = rng() * Math.PI * 2;
      parts.push(part(blob(0.22 + rng() * 0.1, 0, 0.25, rng()), base, { x: Math.cos(a) * 0.25, y: 0.1, z: Math.sin(a) * 0.25, sy: 0.6 }));
    }
    return merge(parts);
  }
  parts.push(part(blob(0.62, 0, 0.22, rng()), base, { y: 0.35, sy: 0.75, jitter: 0.07 }));
  parts.push(part(blob(0.38, 0, 0.25, rng()), '#a8a297', { x: 0.35, y: 0.22, z: 0.2, sy: 0.7 }));
  parts.push(part(blob(0.3, 0, 0.25, rng()), '#8c867c', { x: -0.3, y: 0.18, z: -0.25, sy: 0.7 }));
  if (ore) {
    for (let i = 0; i < 6; i++) {
      const a = rng() * Math.PI * 2;
      const y = 0.25 + rng() * 0.45;
      const r = 0.48 - (y - 0.25) * 0.4;
      parts.push(part(new THREE.OctahedronGeometry(0.1 + rng() * 0.05), ore, { x: Math.cos(a) * r, y, z: Math.sin(a) * r, rx: rng(), rz: rng(), jitter: 0 }));
    }
  }
  return merge(parts);
}

const ORE_COLORS: Record<string, string> = {
  copper_rock: '#ef8a3d',
  tin_rock: '#e3ebf2',
  iron_rock: '#b8503a',
  coal_rock: '#26231f',
  spark_quartz_rock: '#8fe8ff',
  glimmerite_rock: '#e6f4ff',
  duskiron_slag: '#6a5a8a',
  ember_vent: '#ff6a2a',
  silver_vein: '#eef2f6',
};

function buildingPrefab(b: Building): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const w = b.w - 0.2;
  const d = b.d - 0.2;
  const wallH = b.style === 'hall' ? 2.6 : b.style === 'inn' ? 2.4 : 1.9;
  const stone = '#a8a196';
  const timber = '#6b4528';
  parts.push(part(Box(w + 0.2, 0.35, d + 0.2), stone, { y: 0.17 }));
  if (b.style === 'smithy') {
    parts.push(part(Box(w, wallH, d), '#9a9184', { y: 0.35 + wallH / 2, jitter: 0.08 }));
  } else {
    parts.push(part(Box(w, wallH, d), b.wall, { y: 0.35 + wallH / 2 }));
    // Timber frame
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) parts.push(part(Box(0.16, wallH, 0.16), timber, { x: (sx * w) / 2, y: 0.35 + wallH / 2, z: (sz * d) / 2 }));
    }
    parts.push(part(Box(w + 0.04, 0.14, d + 0.04), timber, { y: 0.35 + wallH * 0.55 }));
    parts.push(part(Box(w + 0.04, 0.14, d + 0.04), timber, { y: 0.35 + wallH - 0.05 }));
  }
  // Roof (gable along the building's width axis, overhanging)
  const roofH = b.style === 'hall' ? 1.9 : 1.4;
  parts.push(part(prism(d + 0.7, roofH, w + 0.6), b.roof, { y: 0.35 + wallH, ry: Math.PI / 2, jitter: 0.06 }));
  parts.push(part(Box(0.16, 0.14, w + 0.7), '#3b2a1f', { y: 0.35 + wallH + roofH, ry: Math.PI / 2 }));
  // Chimney
  parts.push(part(Box(0.45, 1.3, 0.45), stone, { x: w * 0.28, y: 0.35 + wallH + roofH * 0.6, z: -d * 0.15 }));
  // Door on +z face (local), windows
  const front = d / 2 + 0.03;
  parts.push(part(Box(0.8, 1.35, 0.08), '#5b3a22', { y: 0.35 + 0.67, z: front }));
  parts.push(part(Box(0.95, 0.12, 0.12), timber, { y: 0.35 + 1.4, z: front }));
  parts.push(part(Box(0.08, 0.08, 0.06), '#e8c45a', { x: 0.25, y: 0.35 + 0.7, z: front + 0.05 }));
  const win = (x: number, z: number, ry: number) => {
    parts.push(part(Box(0.55, 0.5, 0.06), '#ffe7a1', { x, y: 0.35 + wallH * 0.62, z, ry, jitter: 0 }));
    parts.push(part(Box(0.65, 0.08, 0.1), timber, { x, y: 0.35 + wallH * 0.62 - 0.28, z, ry }));
  };
  if (w > 3) {
    win(-w * 0.3, front, 0);
    win(w * 0.3, front, 0);
  }
  win(w / 2 + 0.03, 0, Math.PI / 2);
  win(-w / 2 - 0.03, 0, Math.PI / 2);
  win(0, -d / 2 - 0.03, 0);
  if (b.style === 'hall') {
    // Banners and steps
    parts.push(part(Box(1.6, 0.18, 0.6), stone, { y: 0.09, z: front + 0.3 }));
    for (const sx of [-1, 1]) {
      parts.push(part(Box(0.5, 1.1, 0.04), '#3a5fb0', { x: sx * 1.4, y: 0.35 + wallH * 0.62, z: front + 0.02 }));
      parts.push(part(Box(0.18, 0.18, 0.05), '#f2c94c', { x: sx * 1.4, y: 0.35 + wallH * 0.66, z: front + 0.05, rz: Math.PI / 4 }));
    }
  }
  if (b.style === 'inn') {
    parts.push(part(Box(0.08, 0.08, 0.9), timber, { x: 0.9, y: 0.35 + 1.9, z: front + 0.4 }));
    parts.push(part(Box(0.7, 0.5, 0.06), '#c8893a', { x: 0.9, y: 0.35 + 1.55, z: front + 0.75 }));
    parts.push(part(Cyl(0.1, 0.12, 0.25, 6), '#f5d36b', { x: 0.9, y: 0.35 + 1.55, z: front + 0.79, rx: Math.PI / 2 }));
  }
  if (b.style === 'smithy') {
    parts.push(part(Box(0.9, 0.6, 0.9), '#5b5f68', { x: -w * 0.25, y: 0.35 + 0.3, z: front + 0.5 }));
    parts.push(part(Box(0.5, 0.15, 0.5), '#ff8a2a', { x: -w * 0.25, y: 0.35 + 0.62, z: front + 0.5, jitter: 0 }));
  }
  return merge(parts);
}

function decorPrefab(kind: Decor['kind'], variant: number, seed: number): THREE.BufferGeometry | null {
  const rng = mulberry32(seed);
  switch (kind) {
    case 'bush': {
      const c = ['#4fae44', '#5dbb4a', '#3f9c3e'][variant % 3];
      const parts = [part(blob(0.42, 0, 0.2, rng()), c, { y: 0.3, sy: 0.8 }), part(blob(0.3, 0, 0.2, rng()), c, { x: 0.3, y: 0.22, z: 0.1, sy: 0.8 })];
      if (variant === 3) for (let i = 0; i < 4; i++) parts.push(part(blob(0.06), '#ff6fa8', { x: (rng() - 0.5) * 0.6, y: 0.45 + rng() * 0.1, z: (rng() - 0.5) * 0.6 }));
      return merge(parts);
    }
    case 'boulder':
      return merge([part(blob(0.5, 0, 0.25, rng()), '#9d978c', { y: 0.25, sy: 0.7, jitter: 0.08 }), part(blob(0.25, 0, 0.3, rng()), '#7fa65a', { x: 0.1, y: 0.5, sy: 0.3 })]);
    case 'flowers': {
      const cols = ['#ff6b6b', '#ffd93d', '#f7f7ff', '#c77dff', '#ff9ff3', '#74c0fc'];
      const parts: THREE.BufferGeometry[] = [];
      const n = 3 + Math.floor(rng() * 3);
      const col = cols[Math.floor(rng() * cols.length)];
      for (let i = 0; i < n; i++) {
        const x = (rng() - 0.5) * 0.5;
        const z = (rng() - 0.5) * 0.5;
        parts.push(part(Box(0.03, 0.25, 0.03), '#3f8f35', { x, y: 0.12, z, sway: 1 }));
        parts.push(part(new THREE.OctahedronGeometry(0.07), col, { x, y: 0.27, z, sway: 1, jitter: 0 }));
      }
      return merge(parts);
    }
    case 'wheat': {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 5; i++) {
        const x = (rng() - 0.5) * 0.8;
        const z = (rng() - 0.5) * 0.8;
        parts.push(part(Box(0.04, 0.6, 0.04), '#c9a646', { x, y: 0.3, z, sway: 1 }));
        parts.push(part(Box(0.08, 0.2, 0.08), '#efcf5d', { x, y: 0.65, z, sway: 1 }));
      }
      return merge(parts);
    }
    // Thornridge heather: low clumps of dusky purple bells on wiry green stems.
    case 'heather': {
      const parts: THREE.BufferGeometry[] = [];
      const bloom = ['#9b6fb0', '#b583c4', '#8a5fa3'][variant % 3];
      for (let i = 0; i < 4; i++) {
        const x = (rng() - 0.5) * 0.5;
        const z = (rng() - 0.5) * 0.5;
        parts.push(part(blob(0.13, 0, 0.3, rng()), '#5f7a45', { x, y: 0.08, z, sy: 0.7 }));
        parts.push(part(blob(0.09, 0, 0.3, rng()), bloom, { x: x + 0.02, y: 0.17, z, sy: 0.9, sway: 1 }));
      }
      return merge(parts);
    }
    case 'reeds': {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 4; i++) {
        const x = (rng() - 0.5) * 0.4;
        const z = (rng() - 0.5) * 0.4;
        parts.push(part(Box(0.04, 0.7, 0.04), '#6c9b3c', { x, y: 0.25, z, sway: 1 }));
        if (i % 2 === 0) parts.push(part(Box(0.07, 0.18, 0.07), '#7a5232', { x, y: 0.62, z, sway: 1 }));
      }
      return merge(parts);
    }
    // ---- Dungeons (Phase 4C): the glowing parts are added separately with unlit materials.
    case 'glow_pool':
      // A stone rim round a sunken pool (the water's glow is added unlit).
      return merge([0, 1, 2, 3, 4, 5].map((i) => part(Box(0.42, 0.18, 0.16), '#6f7f78', { x: Math.cos((i / 6) * Math.PI * 2) * 0.42, y: 0.06, z: Math.sin((i / 6) * Math.PI * 2) * 0.42, ry: -(i / 6) * Math.PI * 2 + Math.PI / 2, jitter: 0.08 })));
    case 'pillar':
      return merge([
        part(Box(0.62, 0.22, 0.62), '#8a8e86', { y: 0.11 }),
        part(Cyl(0.24, 0.27, 2.9, 8), '#a4a89e', { y: 1.6, jitter: 0.06 }),
        part(Box(0.6, 0.24, 0.6), '#8a8e86', { y: 3.1 }),
        part(blob(0.18, 0, 0.3, rng()), '#5f8a4a', { x: 0.2, y: 0.4, z: 0.18, sy: 0.6 }),
      ]);
    case 'brazier':
      // An iron bowl on three legs (the flames are added unlit).
      return merge([
        ...[0, 1, 2].map((i) => part(Cyl(0.03, 0.03, 0.75, 4), '#3a3632', { x: Math.cos(i * 2.1) * 0.2, y: 0.37, z: Math.sin(i * 2.1) * 0.2, rz: Math.cos(i * 2.1) * 0.12, rx: -Math.sin(i * 2.1) * 0.12 })),
        part(Cyl(0.34, 0.2, 0.2, 8), '#4a4440', { y: 0.82 }),
        part(Cyl(0.3, 0.3, 0.04, 8), '#2a1a12', { y: 0.92, jitter: 0 }),
      ]);
    case 'dungeon_chest':
      // A heavy iron-bound chest on a stone dais (its lock glows when you have a claim on it).
      return merge([
        part(Box(1.2, 0.2, 0.9), '#7a7a72', { y: 0.1 }),
        part(Box(0.9, 0.5, 0.56), '#6b4428', { y: 0.45 }),
        part(new THREE.CylinderGeometry(0.28, 0.28, 0.9, 8, 1, false, 0, Math.PI), '#7a5030', { y: 0.7, rz: Math.PI / 2, ry: Math.PI / 2 }),
        part(Box(0.94, 0.06, 0.6), '#3a3632', { y: 0.32 }),
        part(Box(0.94, 0.06, 0.6), '#3a3632', { y: 0.62 }),
        part(Box(0.16, 0.18, 0.04), '#c9a646', { y: 0.62, z: 0.3, jitter: 0 }),
      ]);
    case 'stairs': {
      // Stone steps against the wall, rising away from you.
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 5; i++) parts.push(part(Box(0.9, 0.22 + i * 0.22, 0.2), '#9a968c', { y: (0.22 + i * 0.22) / 2, z: 0.4 - i * 0.2, jitter: 0.05 }));
      return merge(parts);
    }
    case 'glowcap':
      // Pale stalks; the glowing caps are added separately with an unlit material.
      return merge([part(Cyl(0.03, 0.04, 0.18, 5), '#e8e2cc', { y: 0.09 })]);
    case 'cave_mouth': {
      // A dark opening in a rock face, with timber props at the old workings' entrance.
      const parts: THREE.BufferGeometry[] = [];
      parts.push(part(blob(1.1, 1, 0.18, 3), '#8a8478', { y: 0.7, z: -0.55, sx: 1.4, sy: 1.1, sz: 0.8, jitter: 0.1 }));
      parts.push(part(Box(1.0, 1.15, 0.5), '#141210', { y: 0.58, z: 0.45 }));
      for (const x of [-0.58, 0.58]) parts.push(part(Box(0.14, 1.35, 0.14), '#6e4a2c', { x, y: 0.68, z: 0.72 }));
      parts.push(part(Box(1.36, 0.14, 0.16), '#6e4a2c', { y: 1.38, z: 0.72 }));
      for (let i = 0; i < 4; i++) parts.push(part(blob(0.22, 0, 0.2, i * 1.3), '#9a9184', { x: i < 2 ? -1.0 + i * 0.25 : 0.75 + (i - 2) * 0.25, y: 0.12, z: 0.85, sy: 0.6, jitter: 0.1 }));
      return merge(parts);
    }
    case 'light_shaft': {
      // The way up: a rope ladder hanging from a crack of daylight (the light itself is added unlit).
      const parts: THREE.BufferGeometry[] = [];
      for (const x of [-0.18, 0.18]) parts.push(part(Cyl(0.025, 0.025, 2.6, 4), '#c9b48a', { x, y: 1.3 }));
      for (let i = 0; i < 7; i++) parts.push(part(Box(0.42, 0.04, 0.06), '#8a5a34', { y: 0.2 + i * 0.36 }));
      for (let i = 0; i < 5; i++) parts.push(part(blob(0.18, 0, 0.2, i * 2.1), '#8a8478', { x: Math.cos(i * 1.3) * 0.55, y: 0.08, z: Math.sin(i * 1.3) * 0.55, sy: 0.6, jitter: 0.1 }));
      return merge(parts);
    }
    case 'mushroom': {
      const cap = variant % 2 ? '#e8473c' : '#d98c3c';
      const parts = [part(Cyl(0.05, 0.06, 0.2, 6), '#f3ead8', { y: 0.1 }), part(new THREE.SphereGeometry(0.14, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), cap, { y: 0.18 })];
      parts.push(part(blob(0.03), '#ffffff', { x: 0.06, y: 0.28, z: 0.03 }));
      parts.push(part(blob(0.025), '#ffffff', { x: -0.05, y: 0.27, z: -0.05 }));
      return merge(parts);
    }
    case 'fence':
      return merge([
        part(Box(0.12, 0.8, 0.12), '#8b5e34', { y: 0.4 }),
        part(Box(1.0, 0.09, 0.06), '#a87342', { y: 0.55 }),
        part(Box(1.0, 0.09, 0.06), '#a87342', { y: 0.28 }),
      ]);
    case 'lamp':
      return merge([
        part(Cyl(0.06, 0.09, 2.0, 6), '#3f3a36', { y: 1.0 }),
        part(Box(0.5, 0.06, 0.06), '#3f3a36', { x: 0.2, y: 1.95 }),
        part(Box(0.24, 0.05, 0.24), '#3f3a36', { x: 0.4, y: 1.92 }),
        part(Cone(0.18, 0.18, 4), '#3f3a36', { x: 0.4, y: 1.72, rx: Math.PI }),
      ]);
    case 'stall': {
      const stripes = variant ? ['#e85d5d', '#fff4e0'] : ['#4f8fe0', '#fff4e0'];
      const parts: THREE.BufferGeometry[] = [];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(part(Box(0.1, 1.6, 0.1), '#8b5e34', { x: sx * 0.75, y: 0.8, z: sz * 0.45 }));
      parts.push(part(Box(1.6, 0.1, 1.0), '#a87342', { y: 0.75 }));
      for (let i = 0; i < 6; i++) parts.push(part(Box(0.29, 0.06, 1.2), stripes[i % 2], { x: -0.72 + i * 0.29, y: 1.65, rx: 0.15, jitter: 0 }));
      const goods = ['#e8473c', '#f5c542', '#7bcf54', '#ff9f43'];
      for (let i = 0; i < 6; i++) parts.push(part(blob(0.1), goods[i % 4], { x: -0.55 + (i % 3) * 0.5, y: 0.88, z: i < 3 ? -0.2 : 0.2 }));
      return merge(parts);
    }
    case 'icechest': {
      // A wooden chest packed with ice and fish, with a little awning.
      const parts: THREE.BufferGeometry[] = [];
      parts.push(part(Box(1.2, 0.6, 0.8), '#8b5e34', { y: 0.3 }));
      parts.push(part(Box(1.24, 0.08, 0.84), '#5a3a20', { y: 0.62 }));
      parts.push(part(Box(1.08, 0.08, 0.68), '#d8f0ff', { y: 0.64, jitter: 0 }));
      for (let i = 0; i < 4; i++) parts.push(part(blob(0.09, 0, 0.1, i * 0.21), i % 2 ? '#d8dfe6' : '#e0b060', { x: -0.36 + i * 0.24, y: 0.7, z: (i % 2 ? 0.1 : -0.1), sx: 2, sy: 0.6, jitter: 0 }));
      for (const x of [-0.55, 0.55]) parts.push(part(Box(0.08, 1.4, 0.08), '#8b5e34', { x, y: 0.7, z: -0.38 }));
      parts.push(part(Box(1.3, 0.06, 0.7), '#4f8fe0', { y: 1.42, z: -0.12, rx: 0.3 }));
      return merge(parts);
    }
    case 'crate':
      return merge([part(Box(0.7, 0.7, 0.7), '#b07a45', { y: 0.35 }), part(Box(0.74, 0.1, 0.74), '#7a5230', { y: 0.6 }), part(Box(0.74, 0.1, 0.74), '#7a5230', { y: 0.1 })]);
    case 'barrel':
      return merge([part(Cyl(0.3, 0.3, 0.8, 8), '#9a6a3c', { y: 0.4 }), part(Cyl(0.32, 0.32, 0.06, 8), '#4a4a4a', { y: 0.65 }), part(Cyl(0.32, 0.32, 0.06, 8), '#4a4a4a', { y: 0.15 })]);
    case 'haystack':
      return merge([part(blob(0.65, 1, 0.12, rng()), '#e8c45a', { y: 0.4, sy: 0.75, jitter: 0.08 })]);
    case 'tent':
      return merge([
        part(Cone(1.3, 1.9, 5), variant ? '#9a6a3c' : '#8a5a3c', { y: 0.95, jitter: 0.1 }),
        part(Box(0.5, 0.9, 0.05), '#3a2a1f', { y: 0.45, z: 1.0 }),
        part(Cyl(0.04, 0.04, 0.6, 4), '#5b3a22', { y: 2.0 }),
      ]);
    case 'totem':
      return merge([
        part(Cyl(0.25, 0.3, 2.6, 6), '#7a5232', { y: 1.3 }),
        part(Box(0.55, 0.5, 0.5), '#b8322b', { y: 2.2 }),
        part(Box(0.4, 0.12, 0.05), '#f2e8c8', { y: 2.15, z: 0.27, jitter: 0 }),
        part(Cone(0.12, 0.4, 4), '#f2e8c8', { x: -0.3, y: 2.6, rz: 0.4 }),
        part(Cone(0.12, 0.4, 4), '#f2e8c8', { x: 0.3, y: 2.6, rz: -0.4 }),
      ]);
    case 'campfire': {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        parts.push(part(blob(0.16), '#7f7a72', { x: Math.cos(a) * 0.6, y: 0.08, z: Math.sin(a) * 0.6 }));
      }
      for (let i = 0; i < 4; i++) parts.push(part(Cyl(0.07, 0.07, 0.9, 5), '#5b3a22', { y: 0.15, ry: (i / 4) * Math.PI, rz: Math.PI / 2 - 0.2 }));
      return merge(parts);
    }
    case 'spikes':
      return merge([
        part(Cyl(0.13, 0.15, 1.5, 5), '#7a5232', { x: -0.25, y: 0.75, rz: 0.15 }),
        part(Cone(0.13, 0.4, 5), '#c9a87a', { x: -0.36, y: 1.65, rz: 0.15 }),
        part(Cyl(0.13, 0.15, 1.7, 5), '#6e4a2c', { x: 0.2, y: 0.85, rz: -0.1 }),
        part(Cone(0.13, 0.4, 5), '#c9a87a', { x: 0.29, y: 1.88, rz: -0.1 }),
      ]);
    // Mirefen's Sunken Shrine: drowned pillars round a sealed stone door, green with weed.
    case 'sunken_shrine': {
      const stone = ['#8f9a8a', '#9aa494', '#848e7e'];
      const parts: THREE.BufferGeometry[] = [part(Cyl(1.7, 1.9, 0.9, 9), '#6f7a6a', { y: -0.35, jitter: 0.08 })];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        const h = [2.4, 1.1, 2.0, 0.7, 1.7, 2.2][i];
        parts.push(part(Cyl(0.22, 0.26, h, 6), stone[i % 3], { x: Math.cos(a) * 1.45, y: h / 2 - 0.2, z: Math.sin(a) * 1.45, rz: (rng() - 0.5) * 0.25, jitter: 0.07 }));
        parts.push(part(blob(0.2, 0, 0.3, rng()), '#5f8a4a', { x: Math.cos(a) * 1.45, y: 0.1 + rng() * 0.3, z: Math.sin(a) * 1.45, sy: 0.5 }));
      }
      // The door: two posts, a lintel and a dark sealed slab carved with a heron.
      parts.push(part(Box(0.3, 1.9, 0.35), '#a4ac9a', { x: -0.55, y: 0.85 }));
      parts.push(part(Box(0.3, 1.9, 0.35), '#a4ac9a', { x: 0.55, y: 0.85 }));
      parts.push(part(Box(1.5, 0.32, 0.45), '#b0b8a4', { y: 1.9, rz: 0.04 }));
      parts.push(part(Box(0.82, 1.6, 0.16), '#3c4440', { y: 0.72, jitter: 0.02 }));
      parts.push(part(Box(0.08, 0.5, 0.04), '#9fd8c8', { y: 0.95, z: 0.09, jitter: 0 }));
      parts.push(part(Box(0.3, 0.06, 0.04), '#9fd8c8', { x: 0.08, y: 1.18, z: 0.09, rz: 0.4, jitter: 0 }));
      parts.push(part(blob(0.3, 0, 0.3, rng()), '#5f8a4a', { x: 0.4, y: 2.05, sy: 0.35 }));
      return merge(parts);
    }
    // Thornridge's Ninefold Stones: tall weathered slabs, each a little different, patched with lichen.
    case 'standing_stone': {
      const h = 1.7 + (variant % 3) * 0.35;
      return merge([
        part(Box(0.55, h, 0.32), ['#9a968c', '#a6a296', '#8e8a80'][variant % 3], { y: h / 2 - 0.1, rz: (rng() - 0.5) * 0.12, rx: (rng() - 0.5) * 0.08, jitter: 0.08 }),
        part(blob(0.16, 0, 0.3, rng()), '#b8b04a', { x: 0.12, y: h * 0.6, z: 0.15, sy: 0.4 }),
        part(blob(0.14, 0, 0.3, rng()), '#7fa65a', { x: -0.15, y: 0.2, z: 0.12, sy: 0.5 }),
        variant === 4 ? part(Box(0.6, 0.08, 0.36), '#dfe4ea', { y: h * 0.45, jitter: 0 }) : part(Box(0.56, 0.06, 0.33), '#8a8478', { y: 0.05 }),
      ]);
    }
    // The Old Watchtower: a broken round tower of grey stone, its door barred with old timbers.
    case 'watchtower': {
      const parts: THREE.BufferGeometry[] = [part(Cyl(1.25, 1.4, 0.5, 9), '#8a867c', { y: 0.2 })];
      const courses = ['#a39f94', '#99958a', '#a8a498'];
      for (let i = 0; i < 6; i++) parts.push(part(Cyl(1.1, 1.15, 0.7, 9), courses[i % 3], { y: 0.75 + i * 0.7, jitter: 0.06 }));
      // A broken crown: uneven merlons round the top, some missing.
      for (let i = 0; i < 9; i++) {
        if (i === 2 || i === 6) continue;
        const a = (i / 9) * Math.PI * 2;
        parts.push(part(Box(0.36, 0.4 + rng() * 0.4, 0.3), courses[i % 3], { x: Math.cos(a) * 1.0, y: 4.85, z: Math.sin(a) * 1.0, ry: -a }));
      }
      // The barred door, and an arrow slit above it.
      parts.push(part(Box(0.7, 1.2, 0.12), '#4a3a2a', { y: 0.95, z: 1.12 }));
      parts.push(part(Box(0.9, 0.1, 0.1), '#6b4a2c', { y: 1.15, z: 1.2, rz: 0.25 }));
      parts.push(part(Box(0.9, 0.1, 0.1), '#6b4a2c', { y: 0.75, z: 1.2, rz: -0.2 }));
      parts.push(part(Box(0.12, 0.45, 0.05), '#2a2622', { y: 2.9, z: 1.13, jitter: 0 }));
      parts.push(part(blob(0.35, 0, 0.3, rng()), '#6f8a4a', { x: 0.7, y: 0.35, z: 0.8, sy: 0.6 }));
      parts.push(part(blob(0.4, 0, 0.3, rng()), '#8a867c', { x: -1.3, y: 0.2, z: 0.6, sy: 0.5 }));
      return merge(parts);
    }
    case 'fountain': {
      const parts: THREE.BufferGeometry[] = [];
      parts.push(part(Cyl(1.45, 1.55, 0.5, 10), '#c4bcae', { y: 0.25 }));
      parts.push(part(Cyl(1.28, 1.28, 0.06, 10), '#5fc8e8', { y: 0.52, jitter: 0 }));
      parts.push(part(Cyl(0.2, 0.3, 1.2, 8), '#b5ad9f', { y: 0.9 }));
      parts.push(part(Cyl(0.6, 0.35, 0.25, 8), '#c4bcae', { y: 1.5 }));
      parts.push(part(Cyl(0.5, 0.5, 0.04, 8), '#7fd8f0', { y: 1.62, jitter: 0 }));
      parts.push(part(Cone(0.18, 0.5, 6), '#7fd8f0', { y: 1.9, jitter: 0 }));
      return merge(parts);
    }
    case 'shrine':
      return merge([
        part(Cyl(0.9, 1.0, 0.3, 8), '#b5ad9f', { y: 0.15 }),
        part(Box(0.6, 1.1, 0.6), '#d6cfc2', { y: 0.85 }),
        part(Box(0.8, 0.15, 0.8), '#c4bcae', { y: 1.45 }),
      ]);
    case 'waystone':
      return merge([
        part(Cyl(0.6, 0.7, 0.2, 7), '#8f8a82', { y: 0.1 }),
        part(Box(0.5, 1.7, 0.35), '#a39d93', { y: 1.0, rz: 0.05, jitter: 0.08 }),
        part(Box(0.25, 0.25, 0.05), '#6fe0ff', { y: 1.2, z: 0.19, rz: Math.PI / 4, jitter: 0 }),
      ]);
    case 'spinning_wheel': {
      // Wooden bench with a big spoked wheel on one end and the spindle post on the other.
      const parts: THREE.BufferGeometry[] = [
        part(Box(0.9, 0.08, 0.3), '#8a5a34', { y: 0.42 }),
        part(Cyl(0.035, 0.035, 0.42, 5), '#6e4a2c', { x: -0.38, y: 0.21, z: 0.1 }),
        part(Cyl(0.035, 0.035, 0.42, 5), '#6e4a2c', { x: -0.38, y: 0.21, z: -0.1 }),
        part(Cyl(0.035, 0.035, 0.42, 5), '#6e4a2c', { x: 0.38, y: 0.21, z: 0 }),
        part(Box(0.06, 0.5, 0.06), '#6e4a2c', { x: 0.25, y: 0.7 }),
        part(Box(0.06, 0.34, 0.06), '#6e4a2c', { x: -0.3, y: 0.62 }),
        part(Cyl(0.05, 0.05, 0.24, 6), '#efe8d6', { x: -0.3, y: 0.82, rx: Math.PI / 2 }),
        part(Cyl(0.05, 0.05, 0.12, 8), '#5b3a22', { x: 0.25, y: 0.95, rx: Math.PI / 2 }),
      ];
      // Rim of the wheel as short segments, plus spokes.
      const R = 0.36;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        parts.push(part(Box(0.05, 0.05, 0.2), '#a0703f', { x: 0.25, y: 0.95 + Math.sin(a) * R, z: Math.cos(a) * R, rx: a + Math.PI / 2 }));
      }
      for (let i = 0; i < 4; i++) parts.push(part(Box(0.03, R * 2, 0.03), '#8a5a34', { x: 0.25, y: 0.95, rx: (i / 4) * Math.PI }));
      return merge(parts);
    }
    case 'anvil':
      return merge([part(Box(0.4, 0.4, 0.3), '#5b3a22', { y: 0.2 }), part(Box(0.7, 0.2, 0.3), '#4a4d55', { y: 0.5 }), part(Cone(0.12, 0.3, 4), '#4a4d55', { x: 0.45, y: 0.5, rz: Math.PI / 2 })]);
    case 'furnace':
      // Stone smelting furnace: square base, domed kiln, glowing mouth facing +z, brick chimney.
      return merge([
        part(Box(1.05, 0.85, 1.0), '#8d857a', { y: 0.42, jitter: 0.06 }),
        part(blob(0.5, 0, 0.12, rng()), '#9a9184', { y: 0.95, sx: 1.0, sy: 0.75, jitter: 0.06 }),
        part(Box(0.46, 0.38, 0.1), '#2a1d16', { y: 0.55, z: 0.47 }),
        part(Box(0.36, 0.26, 0.06), '#ff8a2a', { y: 0.52, z: 0.5, jitter: 0 }),
        part(Box(0.6, 0.08, 0.14), '#6d665c', { y: 0.78, z: 0.5 }),
        part(Box(0.3, 0.9, 0.3), '#8a4f3a', { x: 0.25, y: 1.45, z: -0.2, jitter: 0.08 }),
        part(Box(0.38, 0.08, 0.38), '#5c5650', { x: 0.25, y: 1.92, z: -0.2 }),
      ]);
    case 'range':
      // Cooking range: brick hearth with an iron hob, a stew pot and a chimney pipe.
      return merge([
        part(Box(1.0, 0.8, 0.7), '#a2563e', { y: 0.4, jitter: 0.07 }),
        part(Box(1.08, 0.07, 0.78), '#3f3a36', { y: 0.82 }),
        part(Box(0.5, 0.3, 0.06), '#2a1d16', { y: 0.36, z: 0.34 }),
        part(Box(0.38, 0.18, 0.04), '#ff8a2a', { y: 0.33, z: 0.37, jitter: 0 }),
        part(Cyl(0.17, 0.14, 0.24, 9), '#2f2b28', { x: -0.22, y: 0.98 }),
        part(Cyl(0.18, 0.18, 0.03, 9), '#58524c', { x: -0.22, y: 1.11 }),
        part(Cyl(0.12, 0.1, 0.06, 8), '#4a4540', { x: 0.25, y: 0.89 }),
        part(Cyl(0.07, 0.07, 1.1, 7), '#3f3a36', { x: 0.36, y: 1.35, z: -0.22 }),
      ]);
    case 'signpost':
      return merge([
        part(Box(0.12, 1.6, 0.12), '#7a5232', { y: 0.8 }),
        part(Box(0.9, 0.25, 0.06), '#b07a45', { x: 0.25, y: 1.3 }),
        part(Box(0.8, 0.25, 0.06), '#b07a45', { x: -0.2, y: 1.0, ry: 0.4 }),
      ]);
    case 'pine':
      return null; // handled via pinePrefab variants
  }
}

// ------------------------------------------------------------------ static world

const CHUNK = 16;

class ChunkBatcher {
  private buckets = new Map<string, THREE.BufferGeometry[]>();
  add(x: number, z: number, g: THREE.BufferGeometry) {
    const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = []));
    b.push(g);
  }
  build(material: THREE.Material, shadows: boolean, name: string): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    for (const geos of this.buckets.values()) {
      const m = new THREE.Mesh(merge(geos), material);
      m.castShadow = shadows;
      m.receiveShadow = shadows;
      m.matrixAutoUpdate = false;
      group.add(m);
    }
    return group;
  }
}

export interface Glow {
  mesh: THREE.Object3D;
  baseY: number;
  phase: number;
  kind: 'crystal' | 'flame' | 'lantern';
}

export interface StaticWorld {
  group: THREE.Group;
  glows: Glow[];
  emitters: { x: number; y: number; z: number; kind: 'fire' | 'fountain' | 'chimney' }[];
}

/**
 * An agility obstacle, built along +x from -len/2 to +len/2 (the caller rotates and places it).
 */
export function obstaclePrefab(kind: 'log' | 'wall' | 'rope' | 'beam' | 'hedge' | 'stones' | 'fallen', len: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const h = len / 2;
  switch (kind) {
    case 'log':
      parts.push(part(Cyl(0.17, 0.19, len, 8), '#8a5a34', { y: 0.32, rz: Math.PI / 2 }));
      for (const x of [-h + 0.3, h - 0.3]) parts.push(part(Box(0.2, 0.25, 0.5), '#6e4a2c', { x, y: 0.12 }));
      parts.push(part(Box(len - 0.6, 0.04, 1.0), '#4a7a3a', { y: 0.02, jitter: 0.04 }));
      break;
    case 'stones': {
      // Flat mossy stones just above the water, a hop apart.
      const n = Math.max(3, Math.round(len / 1.1));
      for (let i = 0; i <= n; i++) {
        const x = -h + (len * i) / n;
        parts.push(part(Cyl(0.32, 0.38, 0.3, 7), i % 2 ? '#8a8478' : '#9a9184', { x, y: 0.04, z: (i % 2 ? 0.12 : -0.1), jitter: 0.06 }));
        parts.push(part(Cyl(0.2, 0.24, 0.04, 7), '#5f8a3a', { x: x + 0.05, y: 0.2, z: (i % 2 ? 0.1 : -0.12), jitter: 0.04 }));
      }
      break;
    }
    case 'fallen':
      // A fallen pine across the river: trunk, a root plate at one end, broken branches.
      parts.push(part(Cyl(0.2, 0.26, len + 0.6, 8), '#6e4a2c', { y: 0.3, rz: Math.PI / 2, jitter: 0.03 }));
      parts.push(part(Cyl(0.7, 0.7, 0.2, 9), '#5a3e28', { x: -h - 0.3, y: 0.45, rz: Math.PI / 2, jitter: 0.12 }));
      for (let i = 0; i < 4; i++) parts.push(part(Cyl(0.04, 0.06, 0.6, 5), '#5a3e28', { x: -h + 1.2 + i * (len - 1.6) / 3, y: 0.55, z: i % 2 ? 0.25 : -0.25, rx: i % 2 ? 0.7 : -0.7 }));
      parts.push(part(Cone(0.5, 1.0, 6), '#3f6f3a', { x: h + 0.4, y: 0.5, rz: -Math.PI / 2, jitter: 0.1 }));
      break;
    case 'wall':
      parts.push(part(Box(0.45, 0.9, 1.7), '#9a9184', { y: 0.45, jitter: 0.08 }));
      parts.push(part(Box(0.55, 0.1, 1.8), '#7d766b', { y: 0.92 }));
      break;
    case 'rope':
      // A swing frame over a muddy ditch.
      parts.push(part(Box(len - 0.6, 0.05, 1.4), '#4a3a2a', { y: 0.01 }));
      for (const z of [-0.8, 0.8]) parts.push(part(Cyl(0.07, 0.08, 2.7, 6), '#6e4a2c', { y: 1.35, z }));
      parts.push(part(Cyl(0.06, 0.06, 1.8, 6), '#6e4a2c', { y: 2.65, rx: Math.PI / 2 }));
      parts.push(part(Cyl(0.025, 0.025, 2.0, 4), '#c9b48a', { y: 1.65 }));
      break;
    case 'beam':
      parts.push(part(Box(len, 0.1, 0.16), '#a0703f', { y: 0.42 }));
      for (let x = -h + 0.2; x <= h - 0.2 + 1e-6; x += (len - 0.4) / 3) parts.push(part(Cyl(0.05, 0.06, 0.42, 5), '#6e4a2c', { x, y: 0.21 }));
      break;
    case 'hedge':
      for (let x = -h + 0.4; x <= h - 0.4 + 1e-6; x += 0.55) {
        for (const z of [-0.45, 0.45]) parts.push(part(blob(0.42, 0, 0.2, x * 3 + z), '#3f7f34', { x, y: 0.55, z, sy: 1.25, jitter: 0.08 }));
        parts.push(part(blob(0.4, 0, 0.2, x * 7), '#4a8f3a', { x, y: 1.0, sy: 0.8, jitter: 0.08 }));
      }
      for (const x of [-h + 0.15, h - 0.15]) parts.push(part(Box(0.1, 0.55, 0.5), '#1e2a18', { x, y: 0.3 }));
      break;
  }
  return merge(parts);
}

/**
 * A farming patch: a soil bed with a wooden edge, plus weeds (1-3) or a crop at a growth stage
 * (0..stages; the last stage is ready to harvest).
 */
export function patchPrefab(weeds: number, crop: 'potato' | 'onion' | 'cabbage' | 'bluebell' | null, stage: number, stages: number, seed: number): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [part(Box(1.5, 0.12, 1.5), '#5a3f28', { y: 0.06, jitter: 0.05 })];
  for (const [x, z, w, d] of [[0, 0.78, 1.66, 0.08], [0, -0.78, 1.66, 0.08], [0.78, 0, 0.08, 1.5], [-0.78, 0, 0.08, 1.5]]) parts.push(part(Box(w, 0.16, d), '#8a5a34', { x, y: 0.08, z }));
  // Furrows.
  for (const x of [-0.45, 0, 0.45]) parts.push(part(Box(0.16, 0.05, 1.3), '#4a3220', { x, y: 0.14 }));
  if (!crop) {
    const n = weeds * 6;
    for (let i = 0; i < n; i++) {
      const x = (rng() - 0.5) * 1.3;
      const z = (rng() - 0.5) * 1.3;
      const h = 0.15 + rng() * 0.2 * weeds;
      parts.push(part(Cone(0.06 + rng() * 0.05, h, 4), rng() < 0.5 ? '#6f9e3c' : '#8a9a3a', { x, y: 0.12 + h / 2, z, rz: (rng() - 0.5) * 0.6, jitter: 0.06 }));
    }
  } else {
    const k = Math.max(0.2, (stage + 1) / (stages + 1));
    for (const x of [-0.45, 0, 0.45]) {
      for (const z of [-0.45, 0, 0.45]) {
        if (crop === 'cabbage') {
          // Glowcaps: a cluster of pale stalks and domed caps.
          for (let i = 0; i < 2; i++) {
            const ox = x + (i ? 0.07 : -0.05);
            const oz = z + (i ? -0.05 : 0.06);
            const h = (0.08 + 0.14 * k) * (i ? 0.75 : 1);
            parts.push(part(Cyl(0.025, 0.035, h, 5), '#efe8d6', { x: ox, y: 0.13 + h / 2, z: oz }));
            parts.push(part(blob(0.05 + 0.07 * k, 0, 0.08, rng()), '#d8f0c0', { x: ox, y: 0.13 + h, z: oz, sy: 0.55 }));
          }
        } else if (crop === 'onion') {
          // Wardleaf: silvery blades fanning out.
          for (let i = 0; i < 4; i++) parts.push(part(Box(0.07, 0.4 * k + 0.05, 0.015), '#a8c4b8', { x: x + (i - 1.5) * 0.03, y: 0.14 + 0.2 * k, z, ry: i * 0.8, rz: (i - 1.5) * 0.35, jitter: 0.05 }));
        } else if (crop === 'bluebell') {
          // Bluebell flax: thin stems, blue flowers once grown.
          for (let i = 0; i < 3; i++) {
            const ox = x + (i - 1) * 0.06;
            parts.push(part(Cyl(0.01, 0.014, 0.6 * k, 4), '#6f9e3c', { x: ox, y: 0.14 + 0.3 * k, z, rz: (i - 1) * 0.15 }));
            if (stage >= stages - 1) parts.push(part(blob(0.04, 0, 0.1, rng()), '#7fa8e8', { x: ox + (i - 1) * 0.04, y: 0.14 + 0.6 * k, z }));
          }
        } else {
          // Sunroot: broad leafy tops; the golden root shows when ready.
          parts.push(part(blob(0.2 * k + 0.05, 0, 0.18, rng()), '#5f9a3a', { x, y: 0.16 + 0.15 * k, z, sy: 0.7, jitter: 0.08 }));
          if (stage >= stages) parts.push(part(blob(0.07, 0, 0.15, rng()), '#e0b04a', { x: x + 0.1, y: 0.16, z: z + 0.06 }));
        }
      }
    }
  }
  return merge(parts);
}

/**
 * The Exchange plaza, centred on (0, 0): a round paved square, a kiosk with a ring counter under a
 * blue-and-gold canopy, banner poles around it, and (at `booth`, relative) a bank booth.
 */
export function exchangePrefab(radius: number, booth: { x: number; z: number }): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(part(Cyl(radius, radius, 0.06, 32), '#cfc6b2', { y: 0.03, jitter: 0.03 }));
  parts.push(part(Cyl(radius + 0.2, radius + 0.2, 0.04, 32), '#9a9184', { y: 0.02 }));
  // A compass rose of darker stones.
  for (let i = 0; i < 8; i++) parts.push(part(Box(0.18, 0.02, radius - 1.6), i % 2 ? '#b0a690' : '#8a7f6c', { y: 0.065, ry: (i / 8) * Math.PI, jitter: 0 }));
  // Ring counter (segments) with a gap on the north side for the clerks to come and go.
  const R = 1.3;
  for (let i = 0; i < 14; i++) {
    const a = (i / 16) * Math.PI * 2 + Math.PI / 2 + Math.PI / 8;
    parts.push(part(Box(0.56, 0.95, 0.26), '#6e4a2c', { x: Math.cos(a) * R, y: 0.48, z: Math.sin(a) * R, ry: -a + Math.PI / 2 }));
    parts.push(part(Box(0.62, 0.07, 0.38), '#c9a06a', { x: Math.cos(a) * R, y: 0.98, z: Math.sin(a) * R, ry: -a + Math.PI / 2 }));
  }
  // An open crown frame on four posts (open in the middle so the clerks stay visible from above),
  // with blue-and-gold valance segments round the rim and a central sign post.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    parts.push(part(Cyl(0.07, 0.08, 2.6, 6), '#5b3a22', { x: Math.cos(a) * 1.6, y: 1.3, z: Math.sin(a) * 1.6 }));
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    parts.push(part(Box(0.66, 0.34, 0.06), i % 2 ? '#2a4f7a' : '#e0b545', { x: Math.cos(a) * 1.68, y: 2.5, z: Math.sin(a) * 1.68, ry: -a + Math.PI / 2 }));
  }
  parts.push(part(Cyl(0.05, 0.06, 3.4, 6), '#5b3a22', { x: 0, y: 1.7, z: -0.55 }));
  parts.push(part(Box(0.9, 0.5, 0.06), '#2a4f7a', { x: 0, y: 3.2, z: -0.55 }));
  parts.push(part(Box(0.7, 0.08, 0.08), '#e0b545', { x: 0, y: 3.2, z: -0.51 }));
  parts.push(part(blob(0.12, 0, 0.1, 3), '#e0b545', { x: 0, y: 3.5, z: -0.55 }));
  // Banner poles with blue and gold pennants.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = Math.cos(a) * (radius - 0.25);
    const z = Math.sin(a) * (radius - 0.25);
    parts.push(part(Cyl(0.04, 0.05, 2.4, 5), '#5b3a22', { x, y: 1.2, z }));
    parts.push(part(Box(0.04, 0.7, 0.42), i % 2 ? '#2a4f7a' : '#e0b545', { x, y: 2.0, z: z + 0.22, ry: -a }));
  }
  // Bank booth: a small counter with an awning.
  parts.push(part(Box(1.3, 0.95, 0.5), '#2f5d4a', { x: booth.x, y: 0.48, z: booth.z }));
  parts.push(part(Box(1.4, 0.07, 0.62), '#c9a06a', { x: booth.x, y: 0.98, z: booth.z }));
  for (const dx of [-0.6, 0.6]) parts.push(part(Cyl(0.04, 0.05, 2.0, 5), '#5b3a22', { x: booth.x + dx, y: 1.0, z: booth.z - 0.5 }));
  parts.push(part(Box(1.5, 0.08, 1.2), '#2f5d4a', { x: booth.x, y: 2.0, z: booth.z - 0.4, rx: 0.18 }));
  return merge(parts);
}

/** House furniture (plain wood or oak). */
export function furniturePrefab(model: 'stool' | 'chair' | 'table' | 'bookcase' | 'bed', oak: boolean): THREE.BufferGeometry {
  const wood = oak ? '#7a4f2a' : '#b8865a';
  const dark = oak ? '#5a3a20' : '#8a6238';
  const parts: THREE.BufferGeometry[] = [];
  const legs = (w: number, d: number, h: number, r = 0.035) => {
    for (const [x, z] of [[-w, -d], [w, -d], [-w, d], [w, d]]) parts.push(part(Box(r * 2, h, r * 2), dark, { x, y: h / 2, z }));
  };
  if (model === 'stool') {
    // Settler's stool: three splayed legs under a round seat.
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      parts.push(part(Cyl(0.03, 0.035, 0.42, 5), dark, { x: Math.cos(a) * 0.12, y: 0.21, z: Math.sin(a) * 0.12, rx: Math.sin(a) * 0.18, rz: -Math.cos(a) * 0.18 }));
    }
    parts.push(part(Cyl(0.2, 0.2, 0.06, 10), wood, { y: 0.44 }));
  } else if (model === 'chair') {
    legs(0.17, 0.17, 0.42);
    parts.push(part(Box(0.42, 0.06, 0.42), wood, { y: 0.44 }));
    parts.push(part(Box(0.42, 0.5, 0.06), wood, { y: 0.72, z: -0.19 }));
    // The oak rocker sits on curved runners.
    if (oak) for (const x of [-0.17, 0.17]) parts.push(part(Box(0.05, 0.05, 0.62), dark, { x, y: 0.02, rx: 0.05 }));
  } else if (model === 'table') {
    legs(0.62, 0.32, 0.62, 0.045);
    parts.push(part(Box(1.4, 0.08, 0.8), wood, { y: 0.66 }));
  } else if (model === 'bookcase' && !oak) {
    // Lantern shelf: open shelves of jars, with a spark-stone lamp on top.
    parts.push(part(Box(0.9, 1.1, 0.06), dark, { y: 0.55, z: -0.13 }));
    for (const x of [-0.42, 0.42]) parts.push(part(Box(0.06, 1.1, 0.3), dark, { x, y: 0.55 }));
    const jars = ['#7fa8e8', '#c9a06a', '#9ae87a', '#e8d6a0'];
    for (let s = 0; s < 3; s++) {
      parts.push(part(Box(0.82, 0.05, 0.3), wood, { y: 0.08 + s * 0.42, z: 0.02 }));
      if (s < 2) for (let b = 0; b < 4; b++) parts.push(part(Cyl(0.06, 0.06, 0.16, 6), jars[(b + s) % jars.length], { x: -0.27 + b * 0.18, y: 0.19 + s * 0.42, z: 0.03, jitter: 0 }));
    }
    parts.push(part(Box(0.16, 0.24, 0.16), '#3a2e24', { y: 1.0 }));
    parts.push(part(Box(0.11, 0.16, 0.11), '#ffe08a', { y: 1.0, jitter: 0 }));
    parts.push(part(Cone(0.12, 0.1, 4), '#3a2e24', { y: 1.17, ry: Math.PI / 4 }));
  } else if (model === 'bookcase') {
    // Oak map cabinet: shallow drawers, with rolled maps on top.
    parts.push(part(Box(0.9, 1.0, 0.42), dark, { y: 0.5 }));
    for (let s = 0; s < 4; s++) {
      parts.push(part(Box(0.82, 0.18, 0.04), wood, { y: 0.16 + s * 0.23, z: 0.21 }));
      parts.push(part(Box(0.12, 0.03, 0.03), '#c9a06a', { y: 0.16 + s * 0.23, z: 0.24, jitter: 0 }));
    }
    for (let m = 0; m < 3; m++) parts.push(part(Cyl(0.04, 0.04, 0.6, 6), m === 1 ? '#e8dcc0' : '#d8c8a0', { x: -0.2 + m * 0.2, y: 1.04, z: (m - 1) * 0.05, rz: Math.PI / 2, ry: (m - 1) * 0.2, jitter: 0 }));
  } else {
    legs(0.45, 0.85, 0.3, 0.05);
    parts.push(part(Box(1.0, 0.16, 1.9), wood, { y: 0.32 }));
    parts.push(part(Box(0.92, 0.12, 1.75), '#efe8d6', { y: 0.45, z: 0.04 }));
    parts.push(part(Box(0.5, 0.1, 0.3), '#ffffff', { y: 0.55, z: -0.68 }));
    parts.push(part(Box(0.92, 0.06, 1.1), '#8a3a3a', { y: 0.52, z: 0.35 }));
    parts.push(part(Box(1.0, 0.6, 0.08), wood, { y: 0.5, z: -0.95 }));
  }
  return merge(parts);
}

/** The house shell: plank floor and low stone walls with a doorway (no roof, so you can see in). */
export function houseShellPrefab(x1: number, z1: number, x2: number, z2: number, doorX: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const w = x2 - x1 + 1;
  const d = z2 - z1 + 1;
  const cx = (x1 + x2 + 1) / 2;
  const cz = (z1 + z2 + 1) / 2;
  parts.push(part(Box(w - 0.4, 0.08, d - 0.4), '#a0703f', { x: cx, y: 0.04, z: cz, jitter: 0.04 }));
  for (let x = x1; x < x1 + w - 1.5; x += 0.5) parts.push(part(Box(0.04, 0.01, d - 0.5), '#7a5232', { x: x + 0.5, y: 0.085, z: cz }));
  const wallH = 1.1;
  const stone = '#9a9184';
  // North, east and west walls; the south wall leaves a gap at the door.
  parts.push(part(Box(w, wallH, 0.3), stone, { x: cx, y: wallH / 2, z: z1 + 0.15, jitter: 0.06 }));
  parts.push(part(Box(0.3, wallH, d), stone, { x: x1 + 0.15, y: wallH / 2, z: cz, jitter: 0.06 }));
  parts.push(part(Box(0.3, wallH, d), stone, { x: x2 + 0.85, y: wallH / 2, z: cz, jitter: 0.06 }));
  const leftW = doorX - x1;
  const rightW = x2 - doorX;
  parts.push(part(Box(leftW, wallH, 0.3), stone, { x: x1 + leftW / 2, y: wallH / 2, z: z2 + 0.85, jitter: 0.06 }));
  parts.push(part(Box(rightW, wallH, 0.3), stone, { x: doorX + 1 + rightW / 2, y: wallH / 2, z: z2 + 0.85, jitter: 0.06 }));
  for (const x of [doorX - 0.05, doorX + 1.05]) parts.push(part(Box(0.16, 1.5, 0.36), '#6e4a2c', { x, y: 0.75, z: z2 + 0.85 }));
  parts.push(part(Box(1.3, 0.14, 0.36), '#6e4a2c', { x: doorX + 0.5, y: 1.5, z: z2 + 0.85 }));
  return merge(parts);
}

/** The ring of stones and crossed logs of a campfire (for fires players light). */
export function campfireGeometry(): THREE.BufferGeometry {
  return decorPrefab('campfire', 0, 1)!;
}

export function buildStaticWorld(map: WorldMap, time: { value: number }): StaticWorld {
  const rng = mulberry32(map.seed + 11);
  const solid = new ChunkBatcher();
  const soft = new ChunkBatcher();
  const glows: Glow[] = [];
  const emitters: StaticWorld['emitters'] = [];
  const group = new THREE.Group();

  const pinePrefabs = [0, 1, 2, 3].map((i) => pinePrefab(100 + i));
  const prefabCache = new Map<string, THREE.BufferGeometry>();
  const getPrefab = (kind: Decor['kind'], variant: number) => {
    const key = `${kind}:${variant}`;
    let p = prefabCache.get(key);
    if (!p) {
      const made = decorPrefab(kind, variant, 500 + variant * 17 + kind.length * 31);
      if (!made) return null;
      prefabCache.set(key, (p = made));
    }
    return p;
  };
  const softKinds = new Set(['flowers', 'wheat', 'reeds', 'mushroom']);

  const glowMat = new THREE.MeshBasicMaterial({ color: '#7ff0ff' });
  const flameMat = new THREE.MeshBasicMaterial({ color: '#ffb340' });
  const flameCoreMat = new THREE.MeshBasicMaterial({ color: '#fff2a8' });
  const lanternMat = new THREE.MeshBasicMaterial({ color: '#ffe08a' });
  const crystalGeo = new THREE.OctahedronGeometry(0.28);
  const flameGeo = new THREE.ConeGeometry(0.32, 0.9, 6);
  const lanternGeo = new THREE.BoxGeometry(0.16, 0.2, 0.16);
  const glowcapGeo = new THREE.SphereGeometry(0.11, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  const glowcapMat = new THREE.MeshBasicMaterial({ color: '#b8ffa0' });
  // Wide enough that neighbouring pool tiles merge into one sheet of glowing water.
  const poolGeo = new THREE.CylinderGeometry(0.66, 0.66, 0.04, 8);
  const poolMat = new THREE.MeshBasicMaterial({ color: '#4fd0bc' });
  const shaftGeo = new THREE.CylinderGeometry(0.35, 0.9, 4.4, 10, 1, true);
  const shaftMat = new THREE.MeshBasicMaterial({ color: '#fff4c8', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });

  for (const d of map.decor) {
    const y = groundHeight(map, d.x, d.z);
    if (d.kind === 'pine') {
      solid.add(d.x, d.z, place(pinePrefabs[d.variant % 4], d.x, terrainHeight(map, d.x, d.z) - 0.05, d.z, d.rot, d.scale * 1.05));
      continue;
    }
    const variant = d.kind === 'flowers' ? Math.floor(rng() * 8) : d.kind === 'mushroom' || d.kind === 'tent' || d.kind === 'stall' ? d.variant % 2 : d.kind === 'bush' ? d.variant : 0;
    const pre = getPrefab(d.kind, variant);
    if (!pre) continue;
    const s = d.kind === 'fence' || d.kind === 'fountain' || d.kind === 'stall' ? 1 : d.scale;
    const g = place(pre, d.x, y - 0.02, d.z, d.rot, s, softKinds.has(d.kind) ? 0.9 + rng() * 0.2 : 1);
    (softKinds.has(d.kind) ? soft : solid).add(d.x, d.z, g);

    if (d.kind === 'shrine' || d.kind === 'waystone') {
      const m = new THREE.Mesh(crystalGeo, glowMat);
      const by = y + (d.kind === 'shrine' ? 2.05 : 2.15);
      m.position.set(d.x, by, d.z);
      if (d.kind === 'waystone') m.scale.setScalar(0.7);
      group.add(m);
      glows.push({ mesh: m, baseY: by, phase: rng() * 6, kind: 'crystal' });
    } else if (d.kind === 'campfire') {
      const f = new THREE.Group();
      const outer = new THREE.Mesh(flameGeo, flameMat);
      const inner = new THREE.Mesh(flameGeo, flameCoreMat);
      inner.scale.setScalar(0.55);
      inner.position.y = -0.1;
      f.add(outer, inner);
      f.position.set(d.x, y + 0.5, d.z);
      group.add(f);
      glows.push({ mesh: f, baseY: y + 0.5, phase: 0, kind: 'flame' });
      emitters.push({ x: d.x, y: y + 0.8, z: d.z, kind: 'fire' });
    } else if (d.kind === 'lamp') {
      const m = new THREE.Mesh(lanternGeo, lanternMat);
      const lx = d.x + Math.cos(-d.rot) * 0.4;
      const lz = d.z + Math.sin(-d.rot) * 0.4;
      m.position.set(lx, y + 1.78, lz);
      group.add(m);
      glows.push({ mesh: m, baseY: y + 1.78, phase: rng() * 6, kind: 'lantern' });
    } else if (d.kind === 'glowcap') {
      const m = new THREE.Mesh(glowcapGeo, glowcapMat);
      m.position.set(d.x, y + 0.2 * d.scale, d.z);
      m.scale.setScalar(d.scale);
      group.add(m);
    } else if (d.kind === 'glow_pool') {
      const m = new THREE.Mesh(poolGeo, poolMat);
      m.position.set(d.x, y + 0.08, d.z);
      m.rotation.y = d.rot;
      group.add(m);
      glows.push({ mesh: m, baseY: y + 0.08, phase: rng() * 6, kind: 'lantern' });
    } else if (d.kind === 'brazier') {
      const f = new THREE.Group();
      const outer = new THREE.Mesh(flameGeo, flameMat);
      const inner = new THREE.Mesh(flameGeo, flameCoreMat);
      inner.scale.setScalar(0.55);
      inner.position.y = -0.1;
      f.add(outer, inner);
      f.scale.setScalar(0.7);
      f.position.set(d.x, y + 1.2, d.z);
      group.add(f);
      glows.push({ mesh: f, baseY: y + 1.2, phase: rng() * 6, kind: 'flame' });
      emitters.push({ x: d.x, y: y + 1.4, z: d.z, kind: 'fire' });
    } else if (d.kind === 'light_shaft') {
      const m = new THREE.Mesh(shaftGeo, shaftMat);
      m.position.set(d.x, y + 2.2, d.z);
      group.add(m);
    } else if (d.kind === 'fountain') {
      emitters.push({ x: d.x, y: y + 2.1, z: d.z, kind: 'fountain' });
    } else if (d.kind === 'furnace' || d.kind === 'range') {
      // Glowing fire mouth facing the user, and smoke from the chimney.
      const c = Math.cos(d.rot);
      const sn = Math.sin(d.rot);
      const front = d.kind === 'furnace' ? 0.52 : 0.38;
      const m = new THREE.Mesh(lanternGeo, lanternMat);
      m.scale.set(d.kind === 'furnace' ? 2 : 2.2, 1.1, 0.3);
      m.rotation.y = d.rot;
      const my = y + (d.kind === 'furnace' ? 0.52 : 0.33);
      m.position.set(d.x + front * sn, my, d.z + front * c);
      group.add(m);
      glows.push({ mesh: m, baseY: my, phase: rng() * 6, kind: 'lantern' });
      const cx = d.kind === 'furnace' ? 0.25 : 0.36;
      const cz = d.kind === 'furnace' ? -0.2 : -0.22;
      emitters.push({ x: d.x + cx * c + cz * sn, y: y + (d.kind === 'furnace' ? 2.05 : 2.0), z: d.z - cx * sn + cz * c, kind: 'chimney' });
    }
  }

  for (const b of map.buildings) {
    const y = terrainHeight(map, b.x, b.z) - 0.1;
    if (b.style === 'bank') {
      // Counter distance in front of the building centre, along the facing direction.
      const counterZ = (BANK_COUNTER.x - b.x) * Math.sin(b.facing) + (BANK_COUNTER.z - b.z) * Math.cos(b.facing);
      if (ART.v2) {
        const bank = buildBankV2(b, map, counterZ, BANK_COUNTER.len);
        group.add(bank.group);
        for (const g of bank.glows) glows.push({ mesh: g, baseY: g.position.y, phase: rng() * 6, kind: 'lantern' });
        continue;
      }
      const y = terrainHeight(map, b.x, b.z) - 0.1;
      const counter = merge([part(Box(BANK_COUNTER.len, 1.0, 0.6), '#8a6a48', { y: 0.5, z: counterZ }), part(Box(BANK_COUNTER.len + 0.1, 0.08, 0.7), '#e3b64a', { y: 1.02, z: counterZ })]);
      solid.add(b.x, b.z, place(buildingPrefab(b), b.x, y, b.z, b.facing));
      solid.add(b.x, b.z, place(counter, b.x, y, b.z, b.facing));
      continue;
    }
    if (ART.v2 && b.style === 'hall') {
      // Phase 2A showcase building: textured, detailed Elder's hall.
      const hall = buildHallV2(b, map);
      group.add(hall.group);
      for (const g of hall.glows) glows.push({ mesh: g, baseY: g.position.y, phase: rng() * 6, kind: 'lantern' });
      const c = Math.cos(b.facing);
      const s = Math.sin(b.facing);
      const lx = (b.w - 0.2) * 0.3;
      const lz = -((b.d - 0.2) / 2 + 0.5) * 0.35;
      emitters.push({ x: b.x + lx * c + lz * s, y: y + 0.45 + 2.6 + 1.9 * 0.55 + 1.5, z: b.z - lx * s + lz * c, kind: 'chimney' });
      continue;
    }
    const pre = buildingPrefab(b);
    solid.add(b.x, b.z, place(pre, b.x, y, b.z, b.facing));
    const lw = b.w - 0.2;
    const ld = b.d - 0.2;
    const wallH = b.style === 'hall' ? 2.6 : b.style === 'inn' ? 2.4 : 1.9;
    const roofH = b.style === 'hall' ? 1.9 : 1.4;
    const lx = lw * 0.28;
    const lz = -ld * 0.15;
    const c = Math.cos(b.facing);
    const s = Math.sin(b.facing);
    emitters.push({ x: b.x + lx * c + lz * s, y: y + 0.35 + wallH + roofH * 0.6 + 0.7, z: b.z - lx * s + lz * c, kind: 'chimney' });
  }

  // Bridges
  const W = map.width;
  for (let z = 0; z < map.height; z++) {
    for (let x = 0; x < W; x++) {
      if (map.tiles[z * W + x] !== T.Bridge) continue;
      const parts: THREE.BufferGeometry[] = [];
      const horiz = map.tiles[z * W + x - 1] === T.Bridge || map.tiles[z * W + x + 1] === T.Bridge || isLandPath(map, x - 1, z) || isLandPath(map, x + 1, z);
      for (let i = 0; i < 4; i++) {
        parts.push(part(Box(1.0, 0.1, 0.24), i % 2 ? '#a87342' : '#9a6a3c', horiz ? { x: -0.375 + i * 0.25, y: BRIDGE_Y - 0.05, ry: Math.PI / 2 } : { z: -0.375 + i * 0.25, y: BRIDGE_Y - 0.05 }));
      }
      const railEdge = (dx: number, dz: number) => {
        const nx = x + dx;
        const nz = z + dz;
        const t = map.tiles[nz * W + nx];
        return t !== T.Bridge && t !== T.Path;
      };
      const rails: [number, number][] = horiz ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
      for (const [dx, dz] of rails) {
        if (!railEdge(dx, dz)) continue;
        parts.push(part(Box(0.1, 0.55, 0.1), '#6b4528', { x: dx * 0.45, y: BRIDGE_Y + 0.22, z: dz * 0.45 }));
        parts.push(part(Box(dz !== 0 ? 1.0 : 0.08, 0.08, dx !== 0 ? 1.0 : 0.08), '#8b5e34', { x: dx * 0.45, y: BRIDGE_Y + 0.45, z: dz * 0.45 }));
      }
      if (!ART.v2) parts.push(part(Cyl(0.09, 0.09, 1.6, 5), '#5b3a22', { x: 0.4, y: BRIDGE_Y - 0.8, z: 0.4 }));
      solid.add(x, z, place(merge(parts), x + 0.5, 0, z + 0.5));
    }
  }

  if (ART.v2) {
    // Phase 2A bridge supports: pilings with a wet waterline band, rope lashing and stones at the base.
    const piling = merge([
      part(Cyl(0.11, 0.13, 1.5, 7), '#5e3c22', { y: BRIDGE_Y - 0.88, jitter: 0.06 }),
      part(Cyl(0.125, 0.135, 0.16, 7), '#3b2a1c', { y: WATER_Y + 0.02 }),
      part(Cyl(0.122, 0.122, 0.05, 7), '#c9b48a', { y: BRIDGE_Y - 0.38 }),
      part(Cyl(0.122, 0.122, 0.05, 7), '#c9b48a', { y: BRIDGE_Y - 0.3 }),
    ]);
    const prng = mulberry32(map.seed + 404);
    for (const pr of bridgePiers(map)) {
      solid.add(pr.x, pr.z, place(piling, pr.x, 0, pr.z, prng() * 6));
      for (let i = 0; i < 2; i++) {
        const a = prng() * Math.PI * 2;
        const sx = pr.x + Math.cos(a) * 0.25;
        const sz = pr.z + Math.sin(a) * 0.25;
        solid.add(sx, sz, place(merge([part(blob(0.14, 0, 0.3, prng()), '#7d8a7a', { sy: 0.6, jitter: 0.1 })]), sx, terrainHeight(map, sx, sz) + 0.05, sz));
      }
    }
    addShowcaseDetail(map, solid, soft);
  }

  const indoors = (x: number, z: number) =>
    (x > HOUSE.x1 && x < HOUSE.x2 + 1 && z > HOUSE.z1 && z < HOUSE.z2 + 1) ||
    map.patches.some((pt) => Math.abs(x - pt.x) < 0.85 && Math.abs(z - pt.z) < 0.85) ||
    Math.hypot(x - EXCHANGE.x, z - EXCHANGE.z) < EXCHANGE.radius + 0.2;
  // Grass tufts on green tiles
  const tuft = merge([
    part(Box(0.04, 0.32, 0.02), '#6fc04b', { x: -0.05, y: 0.14, rz: 0.25, sway: 1, jitter: 0.1 }),
    part(Box(0.04, 0.38, 0.02), '#7fd055', { y: 0.17, sway: 1, jitter: 0.1 }),
    part(Box(0.04, 0.3, 0.02), '#5fb043', { x: 0.05, y: 0.13, rz: -0.25, ry: 0.8, sway: 1, jitter: 0.1 }),
  ]);
  for (let z = 1; z < map.height - 1; z++) {
    for (let x = 1; x < W - 1; x++) {
      const t = map.tiles[z * W + x];
      if (t !== T.Grass && t !== T.Forest) continue;
      if (map.blocked[z * W + x]) continue;
      const n = rng() < 0.55 ? 1 + Math.floor(rng() * 2) : 0;
      for (let i = 0; i < n; i++) {
        const px = x + rng();
        const pz = z + rng();
        const tint = t === T.Forest ? 0.8 : 0.95 + rng() * 0.15;
        const rot = rng() * 6;
        const sc = 0.8 + rng() * 0.6;
        // No grass poking through the house floor or the farming beds.
        if (indoors(px, pz)) continue;
        soft.add(px, pz, place(tuft, px, terrainHeight(map, px, pz) - 0.03, pz, rot, sc, tint));
      }
    }
  }

  const solidMat = makeWorldMaterial();
  const softMat = makeWorldMaterial({ sway: true, time });
  group.add(solid.build(solidMat, true, 'props'));
  const softGroup = soft.build(softMat, false, 'foliage');
  softGroup.children.forEach((m) => ((m as THREE.Mesh).receiveShadow = true));
  group.add(softGroup);
  return { group, glows, emitters };
}

function isLandPath(map: WorldMap, x: number, z: number) {
  return map.tiles[z * map.width + x] === T.Path;
}

// ------------------------------------------------------------------ resources (instanced, stateful)

interface ResourceBatch {
  full: THREE.InstancedMesh;
  depleted: THREE.InstancedMesh;
  /** Optional extra layers sharing the same transforms (e.g. shiny ore crystals). */
  fullExtra?: THREE.InstancedMesh;
  depletedExtra?: THREE.InstancedMesh;
  nodes: ResourceNode[];
  /** Per-instance base transforms. */
  base: THREE.Matrix4[];
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
/** Resources are drawn in squares of this many tiles, so off-screen ones are culled. */
const RESOURCE_CHUNK = 32;

export class ResourceView {
  readonly group = new THREE.Group();
  private batches: ResourceBatch[] = [];
  private dirty = new Set<ResourceBatch>();

  constructor(private map: WorldMap, nodes: ResourceNode[]) {
    const material = makeWorldMaterial();
    const byType = new Map<ResourceType, ResourceNode[]>();
    for (const n of nodes) {
      const arr = byType.get(n.def.id) ?? [];
      arr.push(n);
      byType.set(n.def.id, arr);
    }
    for (const [type, list] of byType) {
      const isTree = type === 'tree' || type === 'oak' || type === 'willow' || type === 'rowan';
      if (type === 'net_spot' || type === 'rod_spot' || type === 'warm_spring' || type === 'mire_pool') {
        if (type === 'mire_pool') this.addLilyPads(list);
        if (type === 'warm_spring') this.addSpringPools(list);
        this.addFishingSpots(list);
        continue;
      }
      // Market stalls are scenery already; the resource only makes them interactive.
      if (type === 'bakery_stall' || type === 'seed_stall' || type === 'ice_chest') continue;
      if (ART.v2 && type === 'copper_rock') {
        this.addCopperV2(list, material);
        continue;
      }
      const flax = type === 'flax';
      const variants = isTree
        ? [0, 1, 2].map((v) => (type === 'willow' ? willowPrefab(760 + v * 17) : type === 'rowan' ? rowanPrefab(820 + v * 19) : treePrefab(700 + v * 13 + (type === 'oak' ? 50 : 0), type === 'oak')))
        : flax
          ? [0, 1].map((v) => flaxPrefab(400 + v * 11, false))
          : [0, 1].map((v) => rockPrefab(900 + v * 7 + type.length, ORE_COLORS[type] ?? null, false));
      const depletedGeo = isTree ? stumpPrefab(type !== 'tree') : flax ? flaxPrefab(450, true) : rockPrefab(950, null, true);
      // Split each type by variant so silhouettes vary.
      variants.forEach((geo, v) => {
        const subset = list.filter((_, i) => i % variants.length === v);
        if (subset.length === 0) return;
        // Transforms are drawn in the original order so every tree and rock keeps its look; then split by area.
        const rnd = mulberry32(subset.length * 31 + v);
        const base = subset.map((n) => {
          const s = isTree ? 0.9 + rnd() * 0.3 : 0.9 + rnd() * 0.25;
          tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
          const m = new THREE.Matrix4().compose(new THREE.Vector3(n.x, terrainHeight(this.map, n.x, n.z) - 0.05, n.z), tmpQ, new THREE.Vector3(s, s, s));
          const tint = 0.92 + rnd() * 0.16;
          return { m, tint };
        });
        this.addChunked(subset, base, (count) => {
          const full = new THREE.InstancedMesh(geo, material, count);
          const depleted = new THREE.InstancedMesh(depletedGeo, material, count);
          full.castShadow = true;
          full.receiveShadow = true;
          depleted.castShadow = true;
          return { full, depleted };
        });
      });
    }
  }

  /**
   * Splits one batch into RESOURCE_CHUNK-tile squares, so the camera only draws the ones in view
   * (one batch across the whole world could never be culled).
   */
  private addChunked(nodes: ResourceNode[], base: { m: THREE.Matrix4; tint?: number }[], make: (count: number) => Omit<ResourceBatch, 'nodes' | 'base'>) {
    const chunks = new Map<number, number[]>();
    nodes.forEach((n, i) => {
      const key = Math.floor(n.z / RESOURCE_CHUNK) * 1000 + Math.floor(n.x / RESOURCE_CHUNK);
      const list = chunks.get(key) ?? [];
      list.push(i);
      chunks.set(key, list);
    });
    for (const idx of chunks.values()) {
      const batch: ResourceBatch = { ...make(idx.length), nodes: idx.map((i) => nodes[i]), base: idx.map((i) => base[i].m) };
      const layers = [batch.full, batch.depleted, batch.fullExtra, batch.depletedExtra].filter((m): m is THREE.InstancedMesh => !!m);
      // Bounds come from the real transforms: hidden instances are zero-scaled at the origin and would stretch them.
      for (const m of layers) {
        idx.forEach((k, i) => m.setMatrixAt(i, base[k].m));
        m.computeBoundingSphere();
        this.group.add(m);
      }
      idx.forEach((k, i) => {
        const n = nodes[k];
        const m = base[k].m;
        this.setFull(batch, i, n.depleted ? ZERO : m);
        this.setDepleted(batch, i, n.depleted ? m : ZERO);
        const tint = base[k].tint;
        if (tint !== undefined) batch.full.setColorAt(i, new THREE.Color(tint, tint, tint));
      });
      this.batches.push(batch);
    }
  }

  /** Fishing spots: expanding ripple rings and a few rising bubbles on the water surface. */
  private spots: { rings: THREE.Mesh[]; bubbles: THREE.Mesh[]; seed: number }[] = [];

  /** Lily pads round the mire pools (where the silverpike lie), one merged mesh. */
  private addLilyPads(list: ResourceNode[]) {
    const parts: THREE.BufferGeometry[] = [];
    list.forEach((n, k) => {
      const rnd = mulberry32(4400 + k);
      for (let i = 0; i < 6; i++) {
        const a = rnd() * Math.PI * 2;
        const r = 0.35 + rnd() * 0.5;
        parts.push(part(Cyl(0.16 + rnd() * 0.08, 0.16, 0.02, 7), rnd() < 0.5 ? '#5f9a44' : '#6faa4c', { x: n.x + Math.cos(a) * r, y: WATER_Y + 0.02, z: n.z + Math.sin(a) * r, jitter: 0.05 }));
        if (rnd() < 0.25) parts.push(part(blob(0.05), '#f4e8f0', { x: n.x + Math.cos(a) * r, y: WATER_Y + 0.07, z: n.z + Math.sin(a) * r }));
      }
    });
    if (parts.length) this.group.add(new THREE.Mesh(merge(parts), makeWorldMaterial()));
  }

  private addFishingSpots(list: ResourceNode[]) {
    const ringGeo = new THREE.RingGeometry(0.3, 0.36, 24).rotateX(-Math.PI / 2);
    const bubbleGeo = new THREE.SphereGeometry(0.05, 6, 4);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#e8fbff', transparent: true, opacity: 0.6, depthWrite: false });
    const bubbleMat = new THREE.MeshBasicMaterial({ color: '#f4feff', transparent: true, opacity: 0.85 });
    list.forEach((n, k) => {
      const rings: THREE.Mesh[] = [];
      const bubbles: THREE.Mesh[] = [];
      for (let i = 0; i < 3; i++) {
        const r = new THREE.Mesh(ringGeo, ringMat.clone());
        r.position.set(n.x + (i - 1) * 0.12, this.surfaceY(n) + 0.03, n.z + ((i * 7) % 3) * 0.08 - 0.08);
        r.renderOrder = 5;
        rings.push(r);
        this.group.add(r);
      }
      for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(bubbleGeo, bubbleMat);
        bubbles.push(b);
        this.group.add(b);
      }
      this.spots.push({ rings, bubbles, seed: k * 1.7 });
    });
  }

  /** Water surface for a fishing spot: the river, or the top of a warm spring's pool. */
  private surfaceY(n: ResourceNode): number {
    return n.def.id === 'warm_spring' ? groundHeight(this.map, n.x, n.z) + 0.1 : WATER_Y;
  }

  /** Warm springs: a ring of stones round a pool of milky-blue water. */
  private addSpringPools(list: ResourceNode[]) {
    const parts: THREE.BufferGeometry[] = [];
    for (const n of list) {
      const y = groundHeight(this.map, n.x, n.z);
      parts.push(part(Cyl(0.62, 0.62, 0.06, 16), '#7fd0d8', { x: n.x, y: y + 0.08, z: n.z, jitter: 0 }));
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        parts.push(part(blob(0.16, 0, 0.2, n.x * 3 + i), i % 2 ? '#8a8478' : '#a09888', { x: n.x + Math.cos(a) * 0.7, y: y + 0.08, z: n.z + Math.sin(a) * 0.7, sy: 0.7, jitter: 0.05 }));
      }
    }
    if (!parts.length) return;
    const m = new THREE.Mesh(merge(parts), makeWorldMaterial());
    m.receiveShadow = true;
    this.group.add(m);
  }

  private animateSpots() {
    const t = performance.now() / 1000;
    for (const sp of this.spots) {
      sp.rings.forEach((r, i) => {
        const k = (t * 0.55 + i / 3 + sp.seed) % 1;
        r.scale.setScalar(0.5 + k * 1.6);
        (r.material as THREE.MeshBasicMaterial).opacity = 0.65 * (1 - k);
      });
      const c = sp.rings[1].position;
      sp.bubbles.forEach((b, i) => {
        const k = (t * 0.9 + i * 0.27 + sp.seed) % 1;
        const a = i * 1.9 + sp.seed;
        b.position.set(c.x + Math.cos(a) * 0.25, c.y - 0.01 + k * 0.18, c.z + Math.sin(a) * 0.25);
        b.scale.setScalar(1 - k * 0.6);
      });
    }
  }

  /** Phase 2A showcase mining node: veined copper outcrop + glinting ore crystals. */
  private addCopperV2(list: ResourceNode[], material: THREE.Material) {
    const oreMat = copperOreMaterial();
    const dep = copperRockV2(951, true);
    [0, 1].forEach((v) => {
      const subset = list.filter((_, i) => i % 2 === v);
      if (subset.length === 0) return;
      const g = copperRockV2(1200 + v * 17, false);
      const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, count: number) => {
        const m = new THREE.InstancedMesh(geo, mat, count);
        m.castShadow = true;
        m.receiveShadow = true;
        return m;
      };
      const rnd = mulberry32(subset.length * 37 + v);
      const base = subset.map((n) => {
        const s = 0.95 + rnd() * 0.2;
        tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
        return { m: new THREE.Matrix4().compose(new THREE.Vector3(n.x, terrainHeight(this.map, n.x, n.z) - 0.05, n.z), tmpQ, new THREE.Vector3(s, s, s)) };
      });
      this.addChunked(subset, base, (count) => ({
        full: mk(g.rock, material, count),
        depleted: mk(dep.rock, material, count),
        fullExtra: mk(g.ore, oreMat, count),
        depletedExtra: mk(dep.ore, oreMat, count),
      }));
    });
  }

  private setFull(b: ResourceBatch, i: number, m: THREE.Matrix4) {
    b.full.setMatrixAt(i, m);
    b.fullExtra?.setMatrixAt(i, m);
  }

  private setDepleted(b: ResourceBatch, i: number, m: THREE.Matrix4) {
    b.depleted.setMatrixAt(i, m);
    b.depletedExtra?.setMatrixAt(i, m);
  }

  /** Last rendered state per node id, so instance matrices are only rewritten on change. */
  private shown = new Map<number, { depleted: boolean; shaking: boolean }>();

  /** Called each frame: updates depletion state and hit shake. */
  update() {
    this.animateSpots();
    for (const b of this.batches) {
      b.nodes.forEach((n, i) => {
        const prev = this.shown.get(n.id) ?? { depleted: false, shaking: false };
        const shaking = n.hitAge < 0.35 && !n.depleted;
        if (prev.depleted !== n.depleted) {
          this.setFull(b, i, n.depleted ? ZERO : b.base[i]);
          this.setDepleted(b, i, n.depleted ? b.base[i] : ZERO);
          this.dirty.add(b);
        }
        if (shaking) {
          const k = Math.sin(n.hitAge * 40) * (0.35 - n.hitAge) * 0.25;
          b.base[i].decompose(tmpP, tmpQ, tmpS);
          tmpQ.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(k, 0, k * 0.6)));
          tmpM.compose(tmpP, tmpQ, tmpS);
          this.setFull(b, i, tmpM);
          this.dirty.add(b);
        } else if (prev.shaking && !n.depleted) {
          this.setFull(b, i, b.base[i]);
          this.dirty.add(b);
        }
        this.shown.set(n.id, { depleted: n.depleted, shaking });
      });
    }
    for (const b of this.dirty) {
      for (const m of [b.full, b.depleted, b.fullExtra, b.depletedExtra]) if (m) m.instanceMatrix.needsUpdate = true;
    }
    this.dirty.clear();
  }

  /** Approximate height of a node's visual centre, for UI anchoring and picking. */
  anchorHeight(n: ResourceNode): number {
    if (n.def.skill === 'fishing') return WATER_Y + 0.6;
    const isTree = n.def.skill === 'woodcutting';
    return terrainHeight(this.map, n.x, n.z) + (n.depleted ? 0.3 : isTree ? 2.0 : 0.6);
  }
}
