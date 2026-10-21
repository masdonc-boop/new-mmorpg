import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32, type Rng } from '../core/rng';
import { T, WATER_Y, terrainHeight, type Building, type WorldMap } from '../sim/worldmap';
import { PALETTE, showcaseWeight } from './art';
import { blob, merge, part, place } from './geom';
import { plasterTexture, shingleTexture, stoneTexture, woodTexture } from './textures';

/** Minimal interface of the chunk batcher in props.ts (avoids a runtime import cycle). */
interface Batcher {
  add(x: number, z: number, g: THREE.BufferGeometry): void;
}

const Box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const Cyl = (rt: number, rb: number, h: number, seg = 7) => new THREE.CylinderGeometry(rt, rb, h, seg);

// ------------------------------------------------------------------ ground & riverbank detail

function prefabs(seed: number) {
  const rng = mulberry32(seed);
  const pebbles = [0, 1, 2].map(() => {
    const parts: THREE.BufferGeometry[] = [];
    const n = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const g = ['#a29d93', '#8f8a80', '#b3ab9c', '#9a8f7e'][Math.floor(rng() * 4)];
      parts.push(part(blob(0.05 + rng() * 0.06, 0, 0.3, rng()), g, { x: (rng() - 0.5) * 0.5, y: 0.02, z: (rng() - 0.5) * 0.5, sy: 0.55, jitter: 0.1 }));
    }
    return merge(parts);
  });
  const dirt = [0, 1].map(() => {
    const shape = new THREE.Shape();
    const pts = 10;
    for (let i = 0; i <= pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const r = 0.26 + rng() * 0.14;
      if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const g1 = new THREE.ShapeGeometry(shape);
    g1.rotateX(-Math.PI / 2);
    const g2 = g1.clone();
    // Worn earth: slightly lighter centre so it reads as a bare patch, not a hole.
    return merge([part(g1, '#a8885a', { y: 0.04, jitter: 0.06 }), part(g2, '#b99a68', { y: 0.045, sx: 0.55, sz: 0.5, x: 0.04, jitter: 0.05 })]);
  });
  const daisies = [0, 1].map(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const x = (rng() - 0.5) * 0.45;
      const z = (rng() - 0.5) * 0.45;
      parts.push(part(Box(0.022, 0.2, 0.022), '#4f9a3c', { x, y: 0.1, z, sway: 1 }));
      parts.push(part(new THREE.CylinderGeometry(0.07, 0.07, 0.015, 8), '#fbfbf4', { x, y: 0.21, z, sway: 1, jitter: 0 }));
      parts.push(part(new THREE.CylinderGeometry(0.028, 0.028, 0.03, 6), '#f4c430', { x, y: 0.225, z, sway: 1, jitter: 0 }));
    }
    return merge(parts);
  });
  const bluebells = [0, 1].map(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
      const x = (rng() - 0.5) * 0.4;
      const z = (rng() - 0.5) * 0.4;
      parts.push(part(Box(0.02, 0.28, 0.02), '#4a8f3a', { x, y: 0.14, z, sway: 1 }));
      for (let k = 0; k < 3; k++) parts.push(part(new THREE.ConeGeometry(0.035, 0.06, 6, 1, true), '#6f7fe8', { x: x + 0.03, y: 0.18 + k * 0.045, z, rx: Math.PI, sway: 1, jitter: 0.08 }));
    }
    return merge(parts);
  });
  const clumps = [0, 1, 2].map(() => {
    const parts: THREE.BufferGeometry[] = [];
    const n = 5 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng();
      const h = 0.3 + rng() * 0.25;
      parts.push(part(new THREE.ConeGeometry(0.03, h, 3), i % 2 ? '#6cc04a' : '#8fd05a', { x: Math.cos(a) * 0.06, y: h / 2, z: Math.sin(a) * 0.06, rz: Math.cos(a) * 0.35, rx: Math.sin(a) * 0.35, sway: 1, jitter: 0.12 }));
    }
    return merge(parts);
  });
  const bankStones = [0, 1, 2].map(() =>
    merge([
      part(blob(0.3 + rng() * 0.15, 0, 0.28, rng()), '#8d8f86', { y: 0.05, sy: 0.45, jitter: 0.1 }),
      part(blob(0.16, 0, 0.3, rng()), '#7fa65a', { x: 0.06, y: 0.16, sy: 0.25 }),
    ]),
  );
  const driftwood = merge([part(Cyl(0.07, 0.09, 1.1, 6), '#8a7a63', { rz: Math.PI / 2, y: 0.06, jitter: 0.1 }), part(Cyl(0.03, 0.04, 0.35, 5), '#8a7a63', { x: 0.2, y: 0.1, z: 0.12, rz: 1.2, ry: 0.6 })]);
  const lily = [0, 1].map((v) => {
    const pad = new THREE.CircleGeometry(0.22, 12, 0.3, Math.PI * 2 - 0.6);
    pad.rotateX(-Math.PI / 2);
    const parts = [part(pad, '#4f9a45', { jitter: 0.06 })];
    if (v === 1) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        parts.push(part(new THREE.ConeGeometry(0.035, 0.12, 4), '#f7c6d9', { x: Math.cos(a) * 0.04, y: 0.05, z: Math.sin(a) * 0.04, rz: Math.cos(a) * 0.6, rx: -Math.sin(a) * 0.6 }));
      }
      parts.push(part(blob(0.03), '#f4c430', { y: 0.06 }));
    }
    return merge(parts);
  });
  return { pebbles, dirt, daisies, bluebells, clumps, bankStones, driftwood, lily };
}

/** Scatter Phase 2A ground and riverbank detail inside the showcase area only. */
export function addShowcaseDetail(map: WorldMap, solid: Batcher, soft: Batcher) {
  const P = prefabs(map.seed + 2024);
  const rng: Rng = mulberry32(map.seed + 99);
  const W = map.width;
  const tile = (x: number, z: number) => map.tiles[z * W + x];
  const pick = <V>(arr: V[]) => arr[Math.floor(rng() * arr.length)];
  for (let z = 2; z < map.height - 2; z++) {
    for (let x = 2; x < W - 2; x++) {
      const cx = x + 0.5;
      const cz = z + 0.5;
      const w = showcaseWeight(cx, cz);
      if (w < 0.25 || rng() > w) continue;
      const t = tile(x, z);
      const blocked = map.blocked[z * W + x] === 1;
      const jx = cx + (rng() - 0.5) * 0.6;
      const jz = cz + (rng() - 0.5) * 0.6;
      const y = terrainHeight(map, jx, jz);
      const rot = rng() * Math.PI * 2;
      const nearWater = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => tile(x + dx, z + dz) === T.Water);
      const r = rng();
      if (t === T.Water) {
        const landNear = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0]].some(([dx, dz]) => {
          const n = tile(x + dx, z + dz);
          return n !== T.Water && n !== T.Bridge;
        });
        if (landNear && r < 0.22) solid.add(jx, jz, place(pick(P.lily), jx, WATER_Y + 0.02, jz, rot, 0.8 + rng() * 0.5));
        continue;
      }
      if (blocked) continue;
      if (t === T.Sand && nearWater) {
        if (r < 0.28) solid.add(jx, jz, place(pick(P.bankStones), jx, y - 0.05, jz, rot, 0.8 + rng() * 0.5));
        else if (r < 0.5) solid.add(jx, jz, place(pick(P.pebbles), jx, y, jz, rot));
        else if (r < 0.56) solid.add(jx, jz, place(P.driftwood, jx, y, jz, rot));
      } else if (t === T.Path || t === T.Plaza) {
        if (r < 0.12) solid.add(jx, jz, place(pick(P.pebbles), jx, y, jz, rot, 0.8));
      } else if (t === T.Grass || t === T.Sand) {
        if (r < 0.06) solid.add(jx, jz, place(pick(P.dirt), jx, y, jz, rot, 0.8 + rng() * 0.6));
        else if (r < 0.14) solid.add(jx, jz, place(pick(P.pebbles), jx, y, jz, rot));
        else if (r < 0.24) soft.add(jx, jz, place(pick(P.daisies), jx, y, jz, rot));
        else if (r < 0.3) soft.add(jx, jz, place(pick(P.bluebells), jx, y, jz, rot));
        else if (r < 0.55) soft.add(jx, jz, place(pick(P.clumps), jx, y - 0.02, jz, rot, 0.8 + rng() * 0.5));
      }
    }
  }
}

// ------------------------------------------------------------------ Elder's hall (textured showcase building)

/** Box whose UVs are scaled to world units so tiling textures keep a constant density. */
function tbox(w: number, h: number, d: number, density = 1): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // Face order: +x, -x, +y, -y, +z, -z; 4 vertices each.
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] * density, uv.getY(i) * dims[f][1] * density);
    }
  }
  return g;
}

function xf(g: THREE.BufferGeometry, o: { x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number }): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(o.x ?? 0, o.y ?? 0, o.z ?? 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, 'YXZ')),
    new THREE.Vector3(1, 1, 1),
  );
  g.applyMatrix4(m);
  return g;
}

function texturedMaterial(tex: THREE.Texture | null, fallback: string): THREE.MeshLambertMaterial {
  return tex ? new THREE.MeshLambertMaterial({ map: tex }) : new THREE.MeshLambertMaterial({ color: fallback });
}

/**
 * Detailed Elder's hall: stone base course, plaster upper walls in a timber frame with braces,
 * shingled roof with ridge log and dormer, framed glowing windows with shutters and flower boxes,
 * arched door with iron hinges, chimney and lanterns. Merged per material (≈7 draw calls).
 */
export function buildHallV2(b: Building, map: WorldMap): { group: THREE.Group; glows: THREE.Object3D[] } {
  const w = b.w - 0.2;
  const d = b.d - 0.2;
  const wallH = 2.6;
  const roofH = 1.9;
  const base = 0.45;
  const stoneH = 1.05;
  const top = base + wallH;
  const L: Record<string, THREE.BufferGeometry[]> = { stone: [], plaster: [], wood: [], roof: [], dark: [], glass: [], cloth: [], gold: [], flowers: [] };

  // Foundation, base course, steps
  L.stone.push(xf(tbox(w + 0.36, base, d + 0.36), { y: base / 2 }));
  L.stone.push(xf(tbox(w + 0.08, stoneH, d + 0.08), { y: base + stoneH / 2 }));
  L.stone.push(xf(tbox(1.9, 0.18, 0.7), { y: 0.09, z: d / 2 + 0.5 }));
  L.stone.push(xf(tbox(1.6, 0.18, 0.45), { y: 0.27, z: d / 2 + 0.38 }));
  // Plaster upper walls
  L.plaster.push(xf(tbox(w, wallH - stoneH, d, 0.8), { y: base + stoneH + (wallH - stoneH) / 2 }));

  // Timber frame: corner posts, sill and top plates, studs and diagonal braces on each face.
  const beam = 0.13;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) L.wood.push(xf(tbox(beam + 0.04, wallH - stoneH + 0.1, beam + 0.04), { x: (sx * w) / 2, y: base + stoneH + (wallH - stoneH) / 2, z: (sz * d) / 2 }));
  for (const y of [base + stoneH, top - 0.05]) {
    L.wood.push(xf(tbox(w + 0.12, beam, beam), { y, z: d / 2 + 0.02 }));
    L.wood.push(xf(tbox(w + 0.12, beam, beam), { y, z: -d / 2 - 0.02 }));
    L.wood.push(xf(tbox(beam, beam, d + 0.12), { y, x: w / 2 + 0.02 }));
    L.wood.push(xf(tbox(beam, beam, d + 0.12), { y, x: -w / 2 - 0.02 }));
  }
  const upperH = wallH - stoneH;
  const braceLen = Math.hypot(1.1, upperH - 0.1);
  const braceAng = Math.atan2(upperH - 0.1, 1.1);
  for (const [px, sgn] of [[-w / 2 + 0.62, 1], [w / 2 - 0.62, -1]] as const) {
    for (const zf of [1, -1]) {
      L.wood.push(xf(tbox(braceLen, 0.1, 0.09), { x: px, y: base + stoneH + upperH / 2, z: zf * (d / 2 + 0.03), rz: sgn * braceAng }));
    }
  }
  for (const xs of [-w / 2 + 1.25, w / 2 - 1.25]) for (const zf of [1, -1]) L.wood.push(xf(tbox(0.1, upperH, 0.09), { x: xs, y: base + stoneH + upperH / 2, z: zf * (d / 2 + 0.03) }));

  // Roof: two shingled slabs (ridge along x), gables, ridge log, eaves overhang.
  const half = d / 2 + 0.5;
  const slope = Math.atan2(roofH, half);
  const slabW = Math.hypot(half, roofH) + 0.1;
  for (const sz of [1, -1]) {
    const slab = tbox(w + 0.9, 0.12, slabW, 1.25);
    L.roof.push(xf(slab, { y: top + roofH / 2 + 0.02, z: (sz * half) / 2, rx: sz * slope }));
  }
  const gable = new THREE.Shape();
  gable.moveTo(-d / 2, 0);
  gable.lineTo(d / 2, 0);
  gable.lineTo(0, roofH - 0.05);
  gable.closePath();
  for (const sx of [1, -1]) {
    const g = new THREE.ShapeGeometry(gable);
    xf(g, { ry: (sx * Math.PI) / 2, x: (sx * w) / 2, y: top });
    L.plaster.push(g);
    // Gable timber: king post and collar
    L.wood.push(xf(tbox(0.09, roofH - 0.2, 0.1), { x: sx * (w / 2 + 0.02), y: top + (roofH - 0.2) / 2 }));
    L.wood.push(xf(tbox(0.1, 0.1, d * 0.6), { x: sx * (w / 2 + 0.02), y: top + roofH * 0.38 }));
  }
  L.wood.push(xf(Cyl(0.11, 0.11, w + 1.0, 8), { y: top + roofH + 0.06, rz: Math.PI / 2 }));

  // Dormer on the front slope
  const dz = half * 0.45;
  const dy = top + roofH * 0.5;
  L.plaster.push(xf(tbox(1.0, 0.8, 0.9, 0.8), { y: dy + 0.25, z: dz }));
  L.wood.push(xf(tbox(1.08, 0.1, 0.1), { y: dy + 0.66, z: dz + 0.45 }));
  for (const sx of [1, -1]) L.roof.push(xf(tbox(0.75, 0.08, 1.15, 1.25), { x: sx * 0.3, y: dy + 0.86, z: dz + 0.05, rz: -sx * 0.75 }));
  L.glass.push(xf(Box(0.46, 0.42, 0.04), { y: dy + 0.27, z: dz + 0.46 }));
  L.wood.push(xf(tbox(0.6, 0.07, 0.07), { y: dy + 0.27, z: dz + 0.49 }));
  L.wood.push(xf(tbox(0.07, 0.5, 0.07), { y: dy + 0.27, z: dz + 0.49 }));

  // Chimney
  L.stone.push(xf(tbox(0.65, 1.9, 0.65), { x: w * 0.3, y: top + roofH * 0.55 + 0.4, z: -half * 0.35 }));
  L.dark.push(xf(Box(0.75, 0.12, 0.75), { x: w * 0.3, y: top + roofH * 0.55 + 1.38, z: -half * 0.35 }));

  // Arched door with stone surround and iron hinges
  const front = d / 2 + 0.05;
  L.wood.push(xf(tbox(1.0, 1.45, 0.1, 1.4), { y: base + 0.72, z: front }));
  const arch = new THREE.CylinderGeometry(0.5, 0.5, 0.1, 14, 1, false, -Math.PI / 2, Math.PI);
  L.wood.push(xf(arch, { y: base + 1.45, z: front, rx: Math.PI / 2 }));
  L.stone.push(xf(new THREE.TorusGeometry(0.56, 0.08, 6, 14, Math.PI), { y: base + 1.45, z: front + 0.03 }));
  for (const sx of [-1, 1]) L.stone.push(xf(tbox(0.16, 1.45, 0.16), { x: sx * 0.56, y: base + 0.72, z: front + 0.03 }));
  for (const y of [base + 0.35, base + 1.15]) L.dark.push(xf(Box(0.55, 0.06, 0.03), { x: -0.18, y, z: front + 0.07 }));
  L.gold.push(xf(new THREE.TorusGeometry(0.06, 0.015, 6, 10), { x: 0.3, y: base + 0.75, z: front + 0.08 }));

  // Windows: frame, mullions, shutters, flower box
  const win = (x: number, z: number, ry: number, y: number) => {
    const o = (g: THREE.BufferGeometry, lx: number, ly: number, lz: number) => {
      const c = Math.cos(ry);
      const s = Math.sin(ry);
      return xf(g, { x: x + lx * c + lz * s, y: y + ly, z: z - lx * s + lz * c, ry });
    };
    L.glass.push(o(Box(0.62, 0.68, 0.04), 0, 0, 0.02));
    L.wood.push(o(tbox(0.76, 0.09, 0.1), 0, 0.38, 0.04));
    L.wood.push(o(tbox(0.8, 0.1, 0.18), 0, -0.38, 0.07));
    for (const sx of [-1, 1]) L.wood.push(o(tbox(0.08, 0.76, 0.1), sx * 0.35, 0, 0.04));
    L.wood.push(o(tbox(0.05, 0.68, 0.06), 0, 0, 0.06));
    L.wood.push(o(tbox(0.62, 0.05, 0.06), 0, 0.05, 0.06));
    for (const sx of [-1, 1]) L.cloth.push(o(tbox(0.32, 0.74, 0.05), sx * 0.58, 0, 0.12));
    L.wood.push(o(tbox(0.72, 0.16, 0.2), 0, -0.52, 0.14));
    for (let i = 0; i < 5; i++) L.flowers.push(o(new THREE.IcosahedronGeometry(0.07, 0), -0.26 + i * 0.13, -0.4, 0.15 + (i % 2) * 0.03));
  };
  const winY = base + stoneH + upperH * 0.5;
  win(-w * 0.3, front, 0, winY);
  win(w * 0.3, front, 0, winY);
  win(-w * 0.3, -d / 2 - 0.05, Math.PI, winY);
  win(w * 0.3, -d / 2 - 0.05, Math.PI, winY);
  win(w / 2 + 0.05, 0, Math.PI / 2, winY);
  win(-w / 2 - 0.05, 0, -Math.PI / 2, winY);

  // Banners either side of the door
  for (const sx of [-1, 1]) {
    L.cloth.push(xf(tbox(0.5, 1.1, 0.03), { x: sx * 1.45, y: base + stoneH + 0.25, z: front + 0.04 }));
    L.gold.push(xf(Box(0.18, 0.18, 0.04), { x: sx * 1.45, y: base + stoneH + 0.35, z: front + 0.06, rz: Math.PI / 4 }));
    L.dark.push(xf(Box(0.6, 0.05, 0.05), { x: sx * 1.45, y: base + stoneH + 0.82, z: front + 0.06 }));
  }

  const mats: Record<string, THREE.Material> = {
    stone: texturedMaterial(stoneTexture(PALETTE.stone), PALETTE.stone),
    plaster: texturedMaterial(plasterTexture(PALETTE.plaster), PALETTE.plaster),
    wood: texturedMaterial(woodTexture('#7a5032'), PALETTE.timber),
    roof: texturedMaterial(shingleTexture(b.roof), b.roof),
    dark: new THREE.MeshLambertMaterial({ color: '#3a3330' }),
    glass: new THREE.MeshBasicMaterial({ color: '#ffd98a' }),
    cloth: new THREE.MeshLambertMaterial({ color: '#3a5fb0' }),
    gold: new THREE.MeshLambertMaterial({ color: PALETTE.gold }),
    flowers: new THREE.MeshLambertMaterial({ color: '#e8566a', flatShading: true }),
  };
  const group = new THREE.Group();
  for (const [k, list] of Object.entries(L)) {
    if (list.length === 0) continue;
    for (const g of list) {
      if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    }
    const geo = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false)!;
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mats[k]);
    mesh.castShadow = k !== 'glass';
    mesh.receiveShadow = true;
    mesh.name = `hall-${k}`;
    group.add(mesh);
  }
  group.position.set(b.x, terrainHeight(map, b.x, b.z) - 0.1, b.z);
  group.rotation.y = b.facing;

  // Door lanterns (glow) – returned so the renderer can flicker them with the others.
  const glows: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.16), new THREE.MeshBasicMaterial({ color: '#ffe08a' }));
    lantern.position.set(sx * 0.85, base + 1.5, front + 0.2);
    group.add(lantern);
    glows.push(lantern);
  }
  return { group, glows };
}

// ------------------------------------------------------------------ copper rock (showcase mining node)

/**
 * Faceted, sheared copper-bearing outcrop: a tall split crag, a leaning slab and rubble, with
 * per-face colouring for dark crevices, copper veins and green malachite patina; plus separate
 * shiny ore crystals (rendered with a specular material so they glint as the camera moves).
 */
export function copperRockV2(seed: number, depleted: boolean): { rock: THREE.BufferGeometry; ore: THREE.BufferGeometry } {
  const rng = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const stone = '#958c80';
  if (depleted) {
    for (let i = 0; i < 4; i++) {
      const a = rng() * Math.PI * 2;
      parts.push(part(new THREE.DodecahedronGeometry(0.16 + rng() * 0.1, 0), stone, { x: Math.cos(a) * 0.3, y: 0.08, z: Math.sin(a) * 0.3, sy: 0.6, rx: rng(), ry: rng() }));
    }
  } else {
    parts.push(part(blob(0.5, 1, 0.12, rng()), stone, { y: 0.45, sx: 0.85, sy: 1.25, sz: 0.75, rx: 0.15, ry: rng() * 3, rz: -0.1 }));
    parts.push(part(blob(0.36, 1, 0.12, rng()), stone, { x: 0.42, y: 0.25, z: 0.12, sy: 0.9, rz: -0.45, ry: rng() * 3 }));
    parts.push(part(new THREE.DodecahedronGeometry(0.28, 0), stone, { x: -0.38, y: 0.18, z: -0.18, sy: 0.75, rz: 0.3, ry: rng() * 3 }));
    parts.push(part(new THREE.DodecahedronGeometry(0.13, 0), stone, { x: 0.15, y: 0.08, z: 0.45, ry: rng() * 3 }));
  }
  const rock = merge(parts);
  // Per-face colouring: lit tops, dark crevices, copper veins and patina.
  const pos = rock.getAttribute('position') as THREE.BufferAttribute;
  const nor = rock.getAttribute('normal') as THREE.BufferAttribute;
  const col = rock.getAttribute('color') as THREE.BufferAttribute;
  const c = new THREE.Color();
  const veinDir = new THREE.Vector3(0.6, 1, 0.3).normalize();
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const ny = nor.getY(i);
    const k = 0.78 + Math.max(0, ny) * 0.28 + (rng() - 0.5) * 0.08;
    c.set(stone).multiplyScalar(k);
    const band = Math.abs(Math.sin((cx * veinDir.x + cy * veinDir.y + cz * veinDir.z) * 9 + Math.sin(cx * 7) * 1.2));
    if (band < (depleted ? 0.08 : 0.22)) c.set(band < 0.1 ? PALETTE.copperBright : PALETTE.copper);
    else if (!depleted && band < 0.32 && rng() < 0.6) c.set('#5fae8c');
    if (ny < -0.3) c.multiplyScalar(0.7);
    for (let v = 0; v < 3; v++) col.setXYZ(i + v, c.r, c.g, c.b);
  }
  const oreParts: THREE.BufferGeometry[] = [];
  if (!depleted) {
    const spots: [number, number, number][] = [[0.2, 0.72, 0.3], [-0.1, 0.52, 0.38], [0.45, 0.42, 0.3], [-0.38, 0.32, 0.05]];
    for (const [x, y, z] of spots) {
      for (let i = 0; i < 3; i++) {
        oreParts.push(part(new THREE.OctahedronGeometry(0.06 + rng() * 0.04, 0), PALETTE.copper, { x: x + (rng() - 0.5) * 0.12, y: y + (rng() - 0.5) * 0.1, z: z + rng() * 0.05, sy: 1.6 + rng(), rx: (rng() - 0.5) * 1.2, rz: (rng() - 0.5) * 1.2, jitter: 0.1 }));
      }
    }
  } else {
    oreParts.push(part(new THREE.OctahedronGeometry(0.05, 0), PALETTE.copper, { x: 0.1, y: 0.12, z: 0.2, sy: 1.4 }));
  }
  return { rock, ore: merge(oreParts) };
}

export function copperOreMaterial(): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 40, specular: new THREE.Color('#7a5232'), emissive: new THREE.Color('#2a1004') });
}
