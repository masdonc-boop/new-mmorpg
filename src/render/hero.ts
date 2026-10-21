import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CombatStyle } from '../sim/combat';
import { PALETTE } from './art';
import type { HeldTool, HumanoidLook, HumanoidPose } from './characters';
import { faceTexture } from './textures';

/**
 * Phase 2A character rig: rounded, stylised proportions (≈4.5 heads tall), painted face,
 * shaped hair, hands with thumbs, boots, and layered clothing (tunic, open jerkin, belt, collar).
 *
 * Performance: every rigid body segment is merged into ONE smooth-shaded, vertex-coloured mesh
 * that shares a single material, so a full character is ~15 draw calls.
 */

export interface HeroLook extends HumanoidLook {
  eyes?: string;
  /** Trim / accessory colour (belt buckle, embroidery). */
  accent?: string;
  /** Outer layer colour (jerkin / shawl). */
  outer?: string;
  elder?: boolean;
}

interface PartOpts {
  /** Darken toward the bottom of the part (0..1): cheap baked occlusion for folds and hems. */
  ao?: number;
  /** Per-vertex brightness variation for a hand-painted fabric/leather feel. */
  mottle?: number;
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpC = new THREE.Color();

/** Smooth-shaded coloured part (keeps the primitive's normals, unlike the faceted world parts). */
function cpart(geo: THREE.BufferGeometry, color: string, o: PartOpts = {}): THREE.BufferGeometry {
  geo.deleteAttribute('uv');
  geo.computeBoundingBox();
  const minY = geo.boundingBox!.min.y;
  const spanY = geo.boundingBox!.max.y - minY || 1;
  const pre = geo.getAttribute('position') as THREE.BufferAttribute;
  const shadeK = new Float32Array(pre.count);
  const ao = o.ao ?? 0;
  const mottle = o.mottle ?? 0.03;
  for (let i = 0; i < pre.count; i++) {
    const t = (pre.getY(i) - minY) / spanY;
    // Deterministic per-position noise so merged seams match.
    const h = Math.sin(pre.getX(i) * 91.7 + pre.getY(i) * 47.3 + pre.getZ(i) * 13.1) * 43758.5453;
    shadeK[i] = (1 - ao * (1 - t)) * (1 + (h - Math.floor(h) - 0.5) * 2 * mottle);
  }
  tmpE.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, 'XYZ');
  tmpQ.setFromEuler(tmpE);
  tmpM.compose(new THREE.Vector3(o.x ?? 0, o.y ?? 0, o.z ?? 0), tmpQ, new THREE.Vector3(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1));
  geo.applyMatrix4(tmpM);
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  tmpC.set(color);
  for (let i = 0; i < n; i++) {
    const k = shadeK[i] ?? 1;
    col[i * 3] = tmpC.r * k;
    col[i * 3 + 1] = tmpC.g * k;
    col[i * 3 + 2] = tmpC.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function cmerge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
}

const Sph = (r: number, w = 10, h = 7) => new THREE.SphereGeometry(r, Math.min(w, 12), Math.min(h, 8));
const Cap = (r: number, len: number, cap = 3, rad = 8) => new THREE.CapsuleGeometry(r, len, Math.min(cap, 3), Math.min(rad, 8));
const Cyl = (rt: number, rb: number, h: number, seg = 10, open = false) => new THREE.CylinderGeometry(rt, rb, h, Math.min(seg, 10), 1, open);
const Tor = (r: number, t: number, seg = 16, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, 5, Math.min(seg, 14), arc);

/** Lathe from (radius, y) pairs, optionally leaving an opening at the front (+z). */
function lathe(profile: [number, number][], seg = 14, frontGap = 0): THREE.BufferGeometry {
  // Lathe faces point outward only when the profile runs bottom → top.
  if (profile[0][1] > profile[profile.length - 1][1]) profile = [...profile].reverse();
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  // Lathe phi=0 points along +z... we rotate so the gap is centred at the front.
  const g = new THREE.LatheGeometry(pts, seg, frontGap / 2, Math.PI * 2 - frontGap);
  return g;
}

const shade = (hex: string, k: number) => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`;

/** Lambert (smooth) with a soft rim light so characters pop against the ground from above. */
function heroMaterial(): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float rimF = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
       outgoingLight += vec3(1.0, 0.95, 0.85) * pow(rimF, 3.0) * 0.28;
       #include <opaque_fragment>`,
    );
  };
  m.customProgramCacheKey = () => 'hero-rim-v1';
  return m;
}

type JointName =
  | 'hips'
  | 'spine'
  | 'head'
  | 'thighL'
  | 'thighR'
  | 'kneeL'
  | 'kneeR'
  | 'armL'
  | 'armR'
  | 'elbowL'
  | 'elbowR';

const JOINTS: JointName[] = ['hips', 'spine', 'head', 'thighL', 'thighR', 'kneeL', 'kneeR', 'armL', 'armR', 'elbowL', 'elbowR'];

export class HeroModel {
  readonly root = new THREE.Group();
  readonly joints: Record<JointName, THREE.Group>;
  private handR = new THREE.Group();
  private handL = new THREE.Group();
  private tools = new Map<HeldTool, THREE.Object3D>();
  private material: THREE.MeshLambertMaterial;
  private faceMat: THREE.MeshLambertMaterial;
  private faceOpen: THREE.Texture | null;
  private faceClosed: THREE.Texture | null;
  private target = new Map<JointName, THREE.Vector3>();
  private hipOffset = new THREE.Vector3();
  private hipTarget = new THREE.Vector3();
  private walkPhase = 0;
  private flash = 0;
  private deadT = 0;
  private blinkT = 2 + Math.random() * 3;
  private held: HeldTool = 'none';
  private geometries: THREE.BufferGeometry[] = [];
  style: CombatStyle = 'melee';

  constructor(public look: HeroLook) {
    this.material = heroMaterial();
    const j = {} as Record<JointName, THREE.Group>;
    for (const n of JOINTS) {
      j[n] = new THREE.Group();
      j[n].name = n;
      this.target.set(n, new THREE.Vector3());
    }
    this.joints = j;
    const fem = look.bodyType === 1;
    const skin = look.skin;
    const tunic = look.tunic;
    const trousers = look.trousers;
    const outer = look.outer ?? (look.robe ? shade(tunic, 0.7) : PALETTE.leather);
    const accent = look.accent ?? PALETTE.gold;
    const boots = PALETTE.leatherDark;
    const robe = !!look.robe;

    // ---- hierarchy (sturdy adventurer: ~1.8 units tall, broad shoulders, solid limbs)
    const hipY = 0.9;
    j.hips.position.y = hipY;
    this.root.add(j.hips);
    j.hips.add(j.spine);
    j.spine.position.y = 0.06;
    j.spine.add(j.head);
    j.head.position.y = 0.49;
    const shoulderX = fem ? 0.235 : 0.265;
    for (const [side, sx] of [['L', -1], ['R', 1]] as const) {
      const thigh = j[`thigh${side}`];
      thigh.position.set(sx * (fem ? 0.115 : 0.112), -0.03, 0);
      j.hips.add(thigh);
      const knee = j[`knee${side}`];
      knee.position.y = -0.41;
      thigh.add(knee);
      const arm = j[`arm${side}`];
      arm.position.set(sx * shoulderX, 0.355, -0.005);
      j.spine.add(arm);
      const elbow = j[`elbow${side}`];
      elbow.position.y = -0.27;
      arm.add(elbow);
      const hand = side === 'L' ? this.handL : this.handR;
      hand.position.y = -0.255;
      elbow.add(hand);
    }

    // ---- pelvis + tunic skirt / robe (moves with hips)
    const hem = shade(tunic, 0.72);
    const pelvis: THREE.BufferGeometry[] = [cpart(Sph(1, 12, 8), trousers, { y: -0.03, sx: fem ? 0.245 : 0.235, sy: 0.15, sz: 0.17, ao: 0.2 })];
    if (robe) {
      pelvis.push(cpart(lathe([[0.2, 0.05], [0.235, -0.2], [0.29, -0.55], [0.33, -0.86], [0.31, -0.88]], 18), tunic, { ao: 0.3 }));
      pelvis.push(cpart(Tor(0.32, 0.026, 16), accent, { y: -0.84, rx: Math.PI / 2 }));
    } else {
      pelvis.push(cpart(lathe([[0.205, 0.06], [0.228, -0.06], [0.265, -0.21], [0.258, -0.235]], 16, 0.55), tunic, { ao: 0.25 }));
      // Stitched hem band
      pelvis.push(cpart(lathe([[0.262, -0.2], [0.268, -0.215], [0.262, -0.235]], 16, 0.55), hem, { mottle: 0.02 }));
    }
    this.addMesh(j.hips, pelvis);

    // ---- legs: solid thighs and calves, chunky handmade boots
    const bootLight = shade(boots, 1.35);
    for (const side of ['L', 'R'] as const) {
      this.addMesh(j[`thigh${side}`], [cpart(Cap(0.1, 0.2), trousers, { y: -0.2, ao: 0.15 })]);
      this.addMesh(j[`knee${side}`], [
        cpart(Cap(0.088, 0.17, 3, 8), trousers, { y: -0.12, ao: 0.1 }),
        // Boot: shaft, folded cuff, laces, rounded foot with toe cap, heel and sole
        cpart(Cyl(0.102, 0.094, 0.2, 10), boots, { y: -0.3, ao: 0.25 }),
        cpart(lathe([[0.1, -0.2], [0.122, -0.165], [0.118, -0.13], [0.104, -0.125]], 12), bootLight, { mottle: 0.05 }),
        cpart(Tor(0.098, 0.011, 12), shade(boots, 0.7), { y: -0.27, rx: Math.PI / 2 }),
        cpart(Sph(1, 12, 8), boots, { y: -0.41, z: 0.055, sx: 0.098, sy: 0.075, sz: 0.165 }),
        cpart(Sph(1, 10, 6), bootLight, { y: -0.415, z: 0.15, sx: 0.07, sy: 0.05, sz: 0.06, mottle: 0.05 }),
        cpart(new THREE.BoxGeometry(0.13, 0.05, 0.08), shade(boots, 0.6), { y: -0.445, z: -0.055 }),
        cpart(Cyl(0.098, 0.098, 0.03, 12), '#2a1c12', { y: -0.465, z: 0.045, sz: 1.85 }),
      ]);
    }

    // ---- torso: broad chest, sloped shoulders, layered tunic + leather jerkin + strap
    const cw = fem ? 0.215 : 0.25;
    const torso: THREE.BufferGeometry[] = [
      cpart(lathe([[0.19, -0.03], [0.198, 0.08], [cw * 0.95, 0.2], [cw, 0.3], [cw * 0.96, 0.36], [cw * 0.78, 0.415], [0.13, 0.465], [0.08, 0.49]], 16), tunic, { sz: 0.82, ao: 0.18 }),
      // Open-front leather jerkin with darker edging
      cpart(lathe([[0.205, -0.01], [0.212, 0.08], [cw * 0.95 + 0.018, 0.2], [cw + 0.018, 0.3], [cw * 0.96 + 0.016, 0.36], [cw * 0.78 + 0.014, 0.42], [0.145, 0.46]], 16, robe ? 0.6 : 1.0), outer, { sz: 0.83, ao: 0.22, mottle: 0.05 }),
      // Belt, buckle, pouch, collar
      cpart(Tor(0.2, 0.034, 16), PALETTE.leatherDark, { y: 0.0, rx: Math.PI / 2, sz: 0.83 }),
      cpart(new THREE.BoxGeometry(0.085, 0.07, 0.035), accent, { y: 0.0, z: 0.17 }),
      cpart(Sph(1, 10, 7), PALETTE.leather, { x: 0.17, y: -0.06, z: 0.08, sx: 0.065, sy: 0.07, sz: 0.05, ao: 0.3, mottle: 0.05 }),
      cpart(Tor(0.1, 0.03, 12), robe ? accent : PALETTE.linen, { y: 0.455, rx: Math.PI / 2, sz: 0.9 }),
    ];
    if (!robe) {
      // Satchel strap wrapping diagonally around the chest (shoulder to opposite hip).
      torso.push(cpart(new THREE.TorusGeometry(cw * 0.93, 0.02, 4, 20), PALETTE.leatherDark, { y: 0.21, sz: 0.88, rx: Math.PI / 2, ry: 0.6 }));
    }
    if (fem) torso.push(cpart(Sph(1, 10, 7), tunic, { y: 0.27, z: 0.1, sx: 0.17, sy: 0.085, sz: 0.08 }));
    if (look.cape) torso.push(cpart(lathe([[0.2, 0.42], [0.25, 0.2], [0.3, -0.25]], 10, Math.PI * 1.2), look.cape, { sz: 0.85 }));
    torso.push(cpart(Cyl(0.072, 0.082, 0.1, 10), skin, { y: 0.49 }));
    this.addMesh(j.spine, torso);

    // ---- arms: rounded deltoid, full sleeve, bracer, proper hand
    for (const [side, sx] of [['L', -1], ['R', 1]] as const) {
      const sleeve = robe ? tunic : tunic;
      this.addMesh(j[`arm${side}`], [
        cpart(Sph(1, 12, 8), sleeve, { y: -0.01, sx: 0.084, sy: 0.08, sz: 0.084, ao: 0.1 }),
        // Tapered sleeve: full at the shoulder, gathered toward the elbow.
        cpart(lathe([[0.066, -0.27], [0.074, -0.22], [0.082, -0.12], [0.084, -0.03], [0.07, 0.02]], 10), sleeve, { ao: 0.18 }),
      ]);
      const cuff = robe ? tunic : PALETTE.leather;
      this.addMesh(j[`elbow${side}`], [
        cpart(Cap(0.064, 0.13), robe ? tunic : skin, { y: -0.1 }),
        cpart(Cyl(robe ? 0.085 : 0.074, robe ? 0.1 : 0.068, robe ? 0.13 : 0.12, 10), cuff, { y: robe ? -0.15 : -0.14, ao: 0.2, mottle: 0.05 }),
        cpart(Tor(robe ? 0.09 : 0.072, 0.009, 10), robe ? accent : shade(cuff, 0.7), { y: -0.1, rx: Math.PI / 2 }),
        // Hand: broad palm, knuckle row, curled fingers, separate thumb
        cpart(Sph(1, 10, 7), skin, { y: -0.245, sx: 0.06, sy: 0.068, sz: 0.048 }),
        cpart(Sph(1, 10, 7), skin, { y: -0.292, z: 0.016, sx: 0.058, sy: 0.04, sz: 0.05, ao: 0.15 }),
        cpart(Cap(0.022, 0.045, 2, 6), skin, { x: -sx * 0.045, y: -0.24, z: 0.035, rz: sx * 0.55, rx: -0.45 }),
      ]);
    }

    // ---- head
    const R = 0.192;
    const head: THREE.BufferGeometry[] = [
      cpart(new THREE.SphereGeometry(R, 18, 12), skin, { y: R * 0.95, sy: 1.04, sz: 0.96 }),
      // Jaw and chin give the face a less doll-like shape.
      // Kept inside the head's front surface so it never covers the painted face.
      cpart(Sph(1, 12, 8), skin, { y: R * 0.48, z: R * 0.08, sx: R * 0.86, sy: R * 0.58, sz: R * 0.66 }),
      cpart(Sph(1, 10, 8), skin, { x: -R * 0.98, y: R * 0.9, sx: 0.035, sy: 0.05, sz: 0.035 }),
      cpart(Sph(1, 10, 8), skin, { x: R * 0.98, y: R * 0.9, sx: 0.035, sy: 0.05, sz: 0.035 }),
      cpart(Sph(1, 10, 8), shade(skin, 0.97), { y: R * 0.8, z: R * 0.94, sx: 0.024, sy: 0.026, sz: 0.026 }),
    ];
    this.buildHair(head, look.hair, look.hairStyle % 5, R);
    if (look.beard) head.push(cpart(Sph(1, 12, 10), look.hair, { y: R * 0.35, z: R * 0.55, sx: 0.15, sy: 0.12, sz: 0.1 }));
    this.addMesh(j.head, head);

    // Painted face decal on a spherical patch just above the skin.
    const eyes = look.eyes ?? '#4a7a3a';
    const brows = look.hair === '#e8e8e8' ? '#b9b9b9' : shade(look.hair, 0.8);
    this.faceOpen = faceTexture({ eyes, skin, brows, blush: !look.elder, elder: look.elder });
    this.faceClosed = faceTexture({ eyes, skin, brows, blush: !look.elder, elder: look.elder, closed: true });
    this.faceMat = new THREE.MeshLambertMaterial({ map: this.faceOpen, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    if (this.faceOpen) {
      const faceGeo = new THREE.SphereGeometry(R * 1.006, 12, 8, Math.PI / 2 - 1.05, 2.1, 0.32 * Math.PI, 0.5 * Math.PI);
      faceGeo.scale(1, 1.04, 0.96);
      faceGeo.translate(0, R * 0.95, 0);
      const face = new THREE.Mesh(faceGeo, this.faceMat);
      face.renderOrder = 3;
      face.userData.noGhost = true;
      this.geometries.push(faceGeo);
      j.head.add(face);
    }

    this.buildTools();
  }

  private addMesh(parent: THREE.Object3D, parts: THREE.BufferGeometry[]) {
    const g = cmerge(parts);
    this.geometries.push(g);
    const m = new THREE.Mesh(g, this.material);
    m.castShadow = true;
    parent.add(m);
  }

  private buildHair(out: THREE.BufferGeometry[], color: string, style: number, R: number) {
    if (style === 4) return;
    const hc = R * 0.95;
    const dark = shade(color, 0.86);
    const light = shade(color, 1.12);
    // A soft lock sitting on the head surface at polar angle θ (0 = crown) and azimuth φ (π/2 = front).
    const lock = (theta: number, phi: number, sx: number, sy: number, sz: number, c = color, lift = 1.04) => {
      const r = R * lift;
      const x = -Math.cos(phi) * Math.sin(theta) * r;
      const y = Math.cos(theta) * r * 1.04 + hc;
      const z = Math.sin(phi) * Math.sin(theta) * r * 0.96;
      out.push(cpart(Sph(1, 10, 8), c, { x, y, z, sx, sy, sz, ry: phi - Math.PI / 2, rx: -theta * 0.6 }));
    };
    // Cap tilted back to reveal the forehead, plus back-of-head volume (never over the face).
    out.push(cpart(new THREE.SphereGeometry(R * 1.07, 16, 7, 0, Math.PI * 2, 0, Math.PI * 0.52), color, { y: hc, rx: -0.45, sz: 0.98 }));
    out.push(cpart(new THREE.SphereGeometry(R * 1.08, 10, 5, Math.PI * 1.08, Math.PI * 0.84, Math.PI * 0.4, Math.PI * 0.3), dark, { y: hc, sz: 0.98, sy: 1.02 }));
    const fringe = (n: number, size: number, sweep: number) => {
      for (let i = 0; i < n; i++) {
        const f = n === 1 ? 0 : i / (n - 1) - 0.5;
        lock(Math.PI * (0.3 + Math.abs(f) * 0.12), Math.PI / 2 + f * 1.5 + sweep, size, size * 0.62, size * 0.55, i % 2 ? color : light);
      }
    };
    if (style === 0) {
      fringe(3, 0.07, 0.1);
      for (const sx of [-1, 1]) out.push(cpart(Sph(1, 10, 8), color, { x: sx * R * 0.94, y: hc + 0.0, z: 0.02, sx: 0.035, sy: 0.07, sz: 0.05 }));
    } else if (style === 1) {
      // Tousled: a full crown volume and a fringe swept to one side in a few broad locks.
      out.push(cpart(Sph(1, 12, 8), color, { y: hc + R * 0.42, z: -R * 0.08, sx: R * 1.08, sy: R * 0.72, sz: R * 1.02 }));
      lock(Math.PI * 0.3, Math.PI / 2 + 0.55, 0.11, 0.06, 0.07, light);
      lock(Math.PI * 0.32, Math.PI / 2 + 0.05, 0.12, 0.065, 0.075, color);
      lock(Math.PI * 0.36, Math.PI / 2 - 0.5, 0.1, 0.06, 0.07, dark);
      lock(Math.PI * 0.12, Math.PI * 1.4, 0.1, 0.07, 0.09, dark, 1.06);
      // Temples: soften the hairline above the ears.
      for (const ph of [0.15, Math.PI - 0.15]) lock(Math.PI * 0.42, ph, 0.04, 0.07, 0.075, color, 0.99);
    } else if (style === 2) {
      fringe(4, 0.08, -0.15);
      out.push(cpart(Cap(0.12, 0.22, 4, 12), color, { y: hc - R * 0.55, z: -R * 0.55, sx: 1.55, sz: 0.55, rx: 0.12 }));
      for (const sx of [-1, 1]) out.push(cpart(Cap(0.045, 0.2, 3, 8), color, { x: sx * R * 0.92, y: hc - R * 0.5, z: R * 0.12, rz: sx * 0.08 }));
    } else if (style === 3) {
      fringe(4, 0.07, 0);
      out.push(cpart(Sph(0.1, 12, 10), color, { y: hc + R * 0.75, z: -R * 0.85 }));
      out.push(cpart(Tor(0.07, 0.018, 12), PALETTE.gold, { y: hc + R * 0.62, z: -R * 0.75, rx: 0.9 }));
    }
  }

  private toolMesh(parts: THREE.BufferGeometry[], extra?: THREE.Object3D): THREE.Group {
    const g = new THREE.Group();
    const geo = cmerge(parts);
    this.geometries.push(geo);
    const m = new THREE.Mesh(geo, this.material);
    m.castShadow = true;
    g.add(m);
    if (extra) g.add(extra);
    g.rotation.x = Math.PI / 2;
    g.position.y = -0.03;
    return g;
  }

  private buildTools() {
    const wood = '#8a5a34';
    const bronze = '#c98a4b';
    const steel = '#d6dbe2';
    this.tools.set(
      'sword',
      this.toolMesh([
        cpart(Cyl(0.022, 0.022, 0.17, 8), PALETTE.leatherDark, { y: 0 }),
        cpart(Sph(0.035, 8, 6), PALETTE.gold, { y: -0.1 }),
        cpart(Cap(0.025, 0.2, 3, 8), PALETTE.gold, { y: 0.1, rz: Math.PI / 2 }),
        cpart(Cyl(0.012, 0.045, 0.62, 4), steel, { y: 0.42, sz: 0.35 }),
        cpart(new THREE.ConeGeometry(0.012, 0.09, 4), steel, { y: 0.78, sz: 0.35, sx: 3.7 }),
      ]),
    );
    const bow = this.toolMesh([
      cpart(Tor(0.42, 0.022, 18, Math.PI * 0.85), wood, { rz: Math.PI / 2 + Math.PI * 0.075 }),
      cpart(Cyl(0.03, 0.03, 0.12, 8), PALETTE.leather, { x: 0.42 }),
      cpart(Cyl(0.005, 0.005, 0.82, 4), '#f2efe6', { x: 0.2 }),
    ]);
    bow.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    this.tools.set('bow', bow);
    const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 1), new THREE.MeshBasicMaterial({ color: '#b39cff' }));
    orb.position.y = 0.98;
    this.tools.set(
      'staff',
      this.toolMesh(
        [
          cpart(Cyl(0.024, 0.032, 1.3, 7), '#6b4426', { y: 0.3 }),
          cpart(Tor(0.06, 0.018, 10), '#6b4426', { y: 0.94, rx: Math.PI / 2 }),
          cpart(Cyl(0.03, 0.03, 0.08, 8), PALETTE.gold, { y: 0.84 }),
        ],
        orb,
      ),
    );
    this.tools.set(
      'axe',
      this.toolMesh([
        cpart(Cyl(0.022, 0.026, 0.72, 8), wood, { y: 0.24 }),
        cpart(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 14, 1, false, 0, Math.PI), bronze, { y: 0.5, z: 0.04, rx: Math.PI / 2, ry: Math.PI / 2, sx: 0.8 }),
        cpart(Cyl(0.035, 0.035, 0.09, 8), '#5b4a3a', { y: 0.52 }),
      ]),
    );
    this.tools.set(
      'pickaxe',
      this.toolMesh([
        cpart(Cyl(0.022, 0.026, 0.72, 8), wood, { y: 0.24 }),
        cpart(Tor(0.24, 0.026, 14, Math.PI * 0.8), PALETTE.iron, { y: 0.32, rz: Math.PI * 0.1, ry: Math.PI / 2 }),
        cpart(Cyl(0.035, 0.035, 0.09, 8), '#5b4a3a', { y: 0.56 }),
      ]),
    );
    this.tools.set(
      'walkingstaff',
      this.toolMesh([
        cpart(Cyl(0.026, 0.034, 1.55, 7), '#6b4426', { y: 0.35, rx: 0.03 }),
        cpart(Tor(0.07, 0.024, 10, Math.PI * 1.3), '#6b4426', { y: 1.15, z: 0.04, ry: Math.PI / 2 }),
        cpart(Sph(0.04, 8, 6), '#7fe0c0', { y: 1.13, z: 0.05 }),
      ]),
    );
    // A walking staff stands upright beside the body instead of pointing forward.
    const ws = this.tools.get('walkingstaff')!;
    ws.rotation.set(0, 0, 0.06);
    ws.position.set(0, -0.4, 0.02);
    for (const [k, t] of this.tools) {
      t.visible = false;
      (k === 'bow' ? this.handL : this.handR).add(t);
    }
  }

  setTool(tool: HeldTool) {
    if (tool === this.held) return;
    for (const [k, t] of this.tools) t.visible = k === tool;
    this.held = tool;
  }

  hitFlash() {
    this.flash = 0.18;
  }

  private set(n: JointName, x: number, y = 0, z = 0) {
    this.target.get(n)!.set(x, y, z);
  }

  /** Animate one frame (same contract as the classic Humanoid). */
  update(dt: number, pose: HumanoidPose, speed: number, swingAge: number, time: number) {
    for (const n of JOINTS) this.target.get(n)!.set(0, 0, 0);
    const ht = this.hipTarget.set(0, 0, 0);
    // Rest pose: grounded A-stance, soft knees, arms hanging clear of a broad torso.
    this.set('armL', 0.04, 0, 0.17);
    this.set('armR', 0.04, 0, -0.17);
    this.set('elbowL', -0.2);
    this.set('elbowR', -0.2);
    this.set('thighL', -0.04, 0, -0.05);
    this.set('thighR', 0.02, 0, 0.05);
    this.set('kneeL', 0.08);
    this.set('kneeR', 0.06);
    this.set('spine', 0.03);
    let snap = 14;

    if (pose !== 'dead') this.deadT = 0;
    const moving = pose === 'walk' || (pose === 'attack' && speed > 0.5);
    if (moving) {
      this.walkPhase += dt * (3.2 + speed * 1.55);
      const ph = this.walkPhase;
      const s = Math.sin(ph);
      const amp = Math.min(1, 0.45 + speed * 0.13);
      const c = Math.cos(ph);
      this.set('thighL', -s * 0.55 * amp, 0, -0.03);
      this.set('thighR', s * 0.55 * amp, 0, 0.03);
      // Knee folds during the swing-through and stays soft at contact.
      this.set('kneeL', Math.max(0, Math.sin(ph - 1.25)) * 0.95 * amp + 0.12);
      this.set('kneeR', Math.max(0, Math.sin(ph + Math.PI - 1.25)) * 0.95 * amp + 0.12);
      ht.y = -0.035 + Math.abs(c) * 0.04;
      // Pelvis twists with the stride and drops over the swinging leg; chest counter-rotates.
      this.set('hips', 0, s * 0.12, c * 0.035);
      this.set('spine', 0.06 * amp, -s * 0.16, -c * 0.03);
      this.set('head', -0.03, s * 0.06, c * 0.015);
      if (pose === 'walk') {
        this.set('armL', s * 0.42 * amp, 0, 0.15);
        this.set('armR', -s * 0.42 * amp, 0, -0.15);
        this.set('elbowL', -0.3 - Math.max(0, -s) * 0.4);
        this.set('elbowR', -0.3 - Math.max(0, s) * 0.4);
      }
      snap = 18;
    } else if (pose !== 'dead') {
      const br = Math.sin(time * 2.1);
      ht.y = br * 0.008;
      ht.x = Math.sin(time * 0.7) * 0.012;
      this.set('hips', 0, 0, Math.sin(time * 0.7) * 0.03);
      this.set('spine', br * 0.015, 0, -Math.sin(time * 0.7) * 0.03);
      this.set('head', Math.sin(time * 0.9) * 0.04, Math.sin(time * 0.45) * 0.25, 0);
      this.set('armL', 0.05 + br * 0.02, 0, 0.13 + br * 0.02);
      this.set('armR', 0.05 + br * 0.02, 0, -0.13 - br * 0.02);
    }

    if (pose === 'attack') {
      snap = 30;
      const t = Math.min(1, swingAge / 0.45);
      if (this.style === 'melee') {
        // Anticipation → strike → follow-through, with a lunge and torso twist.
        const wind = t < 0.3 ? easeOut(t / 0.3) : 0;
        const strike = t >= 0.3 && t < 0.55 ? easeIn((t - 0.3) / 0.25) : t >= 0.55 ? 1 : 0;
        const rec = t >= 0.55 ? easeInOut((t - 0.55) / 0.45) : 0;
        const k = strike * (1 - rec);
        this.set('armR', -0.3 - wind * 2.3 * (1 - strike) + k * 0.25, 0, -0.35 - wind * 0.3);
        this.set('elbowR', -0.5 - wind * 0.6 + k * 0.4);
        this.set('spine', -0.1 * wind + 0.2 * k, 0.5 * wind - 0.55 * k, 0);
        this.set('armL', -0.3 * k + 0.15, 0, 0.35);
        if (!moving) {
          this.set('thighL', -0.55 * k);
          this.set('kneeL', 0.45 * k);
          this.set('thighR', 0.3 * k);
          ht.z = 0.08 * k;
          ht.y = -0.05 * k;
        }
      } else if (this.style === 'ranged') {
        const draw = t < 0.6 ? easeOut(t / 0.6) : 0;
        const rel = t >= 0.6 ? 1 - (t - 0.6) / 0.4 : 0;
        this.set('spine', 0, -0.45, 0);
        this.set('head', 0, 0.42, 0);
        this.set('armL', -1.5, 0.35, 0.1);
        this.set('elbowL', -0.05);
        this.set('armR', -1.45, 0.35 - draw * 0.2 + rel * 0.4, -0.1);
        this.set('elbowR', -0.4 - draw * 1.7);
      } else {
        const raise = Math.sin(Math.min(1, t * 1.25) * Math.PI);
        const thrust = t > 0.3 && t < 0.6 ? Math.sin(((t - 0.3) / 0.3) * Math.PI) : 0;
        this.set('armR', -1.0 - raise * 0.9, 0, -0.2);
        this.set('elbowR', -0.6 + thrust * 0.5);
        this.set('armL', -0.9 - raise * 0.4, 0, 0.45);
        this.set('elbowL', -0.9);
        this.set('spine', -0.12 * raise + 0.15 * thrust, 0, 0);
        ht.y = raise * 0.04;
      }
    } else if (pose === 'chop' || pose === 'mine') {
      snap = 24;
      const cycle = (time * 1.15) % 1;
      const up = cycle < 0.62 ? easeOut(cycle / 0.62) : 1 - easeIn((cycle - 0.62) / 0.38);
      this.set('armR', -0.35 - up * 2.35, 0, -0.05);
      this.set('armL', -0.35 - up * 2.2, 0, 0.18);
      this.set('elbowR', -0.25 - up * 0.5);
      this.set('elbowL', -0.4 - up * 0.4);
      this.set('spine', 0.28 - up * 0.42, 0.1, 0);
      this.set('thighL', -0.35);
      this.set('kneeL', 0.35);
      this.set('thighR', 0.22);
      this.set('kneeR', 0.15);
      ht.y = -0.06 + up * 0.03;
    } else if (pose === 'talk') {
      const g = Math.sin(time * 4.2);
      this.set('armR', -0.75 + g * 0.18, 0, -0.35);
      this.set('elbowR', -0.9);
      this.set('head', 0.08 + Math.sin(time * 3) * 0.06, Math.sin(time * 0.6) * 0.2, 0);
    } else if (pose === 'dead') {
      snap = 30;
      this.deadT = Math.min(1, this.deadT + dt * 2.2);
      const e = 1 - Math.pow(1 - this.deadT, 3);
      this.set('hips', -e * 1.45);
      ht.y = -e * 0.72;
      ht.z = -e * 0.3;
      this.set('armL', -e * 0.4, 0, 0.9 * e);
      this.set('armR', -e * 0.4, 0, -0.9 * e);
      this.set('thighL', -e * 0.3);
      this.set('thighR', -e * 0.1);
      this.set('kneeL', e * 0.6);
      this.set('head', e * 0.3);
    }

    if (this.flash > 0) {
      this.flash -= dt;
      const sp = this.target.get('spine')!;
      sp.x -= 0.22;
    }

    // Critically damped blend toward the target pose for smooth transitions.
    const k = 1 - Math.exp(-dt * snap);
    for (const n of JOINTS) {
      const tg = this.target.get(n)!;
      const r = this.joints[n].rotation;
      r.x += (tg.x - r.x) * k;
      r.y += (tg.y - r.y) * k;
      r.z += (tg.z - r.z) * k;
    }
    this.hipOffset.lerp(ht, k);
    this.joints.hips.position.set(this.hipOffset.x, 0.92 + this.hipOffset.y, this.hipOffset.z);

    // Blink
    this.blinkT -= dt;
    const closed = pose === 'dead' || this.blinkT < 0.12;
    if (this.blinkT <= 0) this.blinkT = 2.5 + Math.random() * 3;
    const want = closed ? this.faceClosed : this.faceOpen;
    if (want && this.faceMat.map !== want) this.faceMat.map = want;

    const f = this.flash > 0 ? 1 : 0;
    this.material.emissive.setRGB(0.75 * f, 0.15 * f, 0.1 * f);
  }

  enableSilhouette(color = '#3b5bdb') {
    const ghost = new THREE.MeshBasicMaterial({ color, depthFunc: THREE.GreaterDepth, depthWrite: false });
    const meshes: THREE.Mesh[] = [];
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !o.userData.noGhost) meshes.push(o as THREE.Mesh);
    });
    for (const m of meshes) {
      m.renderOrder = 2;
      const g = new THREE.Mesh(m.geometry, ghost);
      g.renderOrder = 1;
      g.userData.ghost = true;
      m.add(g);
    }
  }

  /** Draw calls this model costs per pass (visible meshes). */
  meshCount(): number {
    let n = 0;
    this.root.traverseVisible((o) => {
      if ((o as THREE.Mesh).isMesh && !o.userData.ghost) n++;
    });
    return n;
  }

  triangleCount(): number {
    let n = 0;
    this.root.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || o.userData.ghost) return;
      const g = m.geometry;
      n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    });
    return n;
  }

  dispose() {
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
    this.faceMat.dispose();
  }
}

const easeIn = (t: number) => t * t;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
