import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface PartOpts {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  /** Wind sway weight applied to the top of the part (0 = rigid). */
  sway?: number;
  /** Random per-vertex colour jitter for a hand-painted feel. */
  jitter?: number;
}

const tmpColor = new THREE.Color();
const tmpMat = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();

/** Normalise a primitive into a non-indexed, vertex-coloured geometry with a `sway` attribute so parts can be merged. */
export function part(geo: THREE.BufferGeometry, color: string | THREE.Color, o: PartOpts = {}): THREE.BufferGeometry {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  tmpEuler.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, 'YXZ');
  tmpQuat.setFromEuler(tmpEuler);
  tmpMat.compose(new THREE.Vector3(o.x ?? 0, o.y ?? 0, o.z ?? 0), tmpQuat, new THREE.Vector3(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1));

  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  // Compute local bounds before transforming for sway weights.
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const sway = new Float32Array(pos.count);
  const span = maxY - minY || 1;
  for (let i = 0; i < pos.count; i++) sway[i] = o.sway ? ((pos.getY(i) - minY) / span) * o.sway : 0;
  g.applyMatrix4(tmpMat);

  const base = typeof color === 'string' ? tmpColor.set(color) : tmpColor.copy(color);
  const colors = new Float32Array(pos.count * 3);
  const j = o.jitter ?? 0.04;
  for (let i = 0; i < pos.count; i += 3) {
    // Jitter per face so flat-shaded facets read as painted.
    const k = 1 + (Math.random() - 0.5) * 2 * j;
    for (let v = 0; v < 3 && i + v < pos.count; v++) {
      colors[(i + v) * 3] = base.r * k;
      colors[(i + v) * 3 + 1] = base.g * k;
      colors[(i + v) * 3 + 2] = base.b * k;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('sway', new THREE.BufferAttribute(sway, 1));
  return g;
}

/** Merge parts and compute flat normals. */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (parts.length === 0) return new THREE.BufferGeometry();
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Transform an already-built (merged) geometry copy into place, for batching prefabs into chunk meshes. */
export function place(prefab: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, s = 1, tint?: number): THREE.BufferGeometry {
  const g = prefab.clone();
  tmpQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
  tmpMat.compose(new THREE.Vector3(x, y, z), tmpQuat, new THREE.Vector3(s, s, s));
  g.applyMatrix4(tmpMat);
  if (tint !== undefined && tint !== 1) {
    const c = g.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < c.count * 3; i++) (c.array as Float32Array)[i] *= tint;
  }
  return g;
}

/** Triangular prism along Z (gable roof), base width w, height h, depth d, base at y=0. */
export function prism(w: number, h: number, d: number): THREE.BufferGeometry {
  const hw = w / 2;
  const hd = d / 2;
  const v = [
    [-hw, 0, -hd], [hw, 0, -hd], [0, h, -hd],
    [-hw, 0, hd], [hw, 0, hd], [0, h, hd],
  ];
  const faces = [
    [0, 2, 1], [3, 4, 5], // gables
    [0, 3, 5], [0, 5, 2], // left slope
    [1, 2, 5], [1, 5, 4], // right slope
    [0, 1, 4], [0, 4, 3], // bottom
  ];
  const arr: number[] = [];
  for (const f of faces) for (const i of f) arr.push(...v[i]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  return g;
}

/** Randomly displaced low-poly blob, good for foliage and rocks. */
export function blob(radius: number, detail = 0, roughness = 0.18, seed = Math.random()): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const cache = new Map<string, number>();
  let s = seed * 1000;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let k = cache.get(key);
    if (k === undefined) {
      k = 1 + (rnd() - 0.5) * 2 * roughness;
      cache.set(key, k);
    }
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
  }
  return g;
}

/** Shared flat-shaded vertex-colour material with optional wind sway. */
export function makeWorldMaterial(opts: { sway?: boolean; time?: { value: number } } = {}): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  if (opts.sway && opts.time) {
    const time = opts.time;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float sway;\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vec4 wpos = modelMatrix * vec4(position, 1.0);
           float ph = uTime * 1.8 + wpos.x * 0.6 + wpos.z * 0.45;
           transformed.x += sin(ph) * 0.12 * sway;
           transformed.z += cos(ph * 0.8) * 0.08 * sway;`,
        );
    };
  }
  return m;
}
