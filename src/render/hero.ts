import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CombatStyle } from '../sim/combat';
import { PALETTE } from './art';
import type { HeldTool, HumanoidLook, HumanoidPose } from './characters';
import { faceTexture } from './textures';

/**
 * Shared humanoid rig for the player and human NPCs (Phase 2A standard): rounded, sturdy
 * proportions, painted face, shaped hair, hands with thumbs, boots and layered clothing.
 * Variety comes from HeroLook (build, height, age, hair, beard, outfit kit, accessories).
 *
 * Animation: legs are solved with two-bone IK from a speed-synchronised gait cycle so planted
 * feet do not slide; ankles keep feet flat; archery uses a dedicated bow rig and planar arm IK.
 *
 * Performance: every rigid body segment is merged into ONE smooth-shaded, vertex-coloured mesh
 * that shares a single material, so a full character is ~16 draw calls.
 */

export interface HeroLook extends HumanoidLook {
  eyes?: string;
  /** Trim / accessory colour (belt buckle, embroidery). */
  accent?: string;
  /** Outer layer colour (jerkin / shawl). */
  outer?: string;
  elder?: boolean;
  /** Width multiplier for torso, hips and limbs (1 = standard adventurer). */
  build?: number;
  /** Overall height multiplier. */
  height?: number;
  /** Older characters stoop slightly and walk with a shorter, slower step. */
  age?: 'young' | 'adult' | 'old';
  /** Outfit kit layered over the base body. */
  armor?: 'guard';
  /** Small round reading spectacles. */
  spectacles?: boolean;
  /** Carried prop with its own idle behaviour: a clerk's ledger (book in the left hand, quill in the right). */
  prop?: 'ledger';
  /** Worn equipment shown on the model (tints are metal / wood colours). */
  gear?: HeroGear;
}

export interface HeroGear {
  weapon?: { kind: 'sword' | 'dagger' | 'bow'; tint: string };
  head?: string;
  body?: string;
  legs?: string;
  shield?: { tint: string; wooden?: boolean };
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
  // Polyhedra are non-indexed; mixing them with indexed primitives requires de-indexing everything.
  if (parts.some((p) => !p.index) && parts.some((p) => p.index)) parts = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
}

const Sph = (r: number, w = 10, h = 7) => new THREE.SphereGeometry(r, Math.min(w, 12), Math.min(h, 8));
const Cap = (r: number, len: number, cap = 3, rad = 8) => new THREE.CapsuleGeometry(r, len, Math.min(cap, 3), Math.min(rad, 8));
const Cyl = (rt: number, rb: number, h: number, seg = 10, open = false) => new THREE.CylinderGeometry(rt, rb, h, Math.min(seg, 10), 1, open);
const Tor = (r: number, t: number, seg = 16, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, 5, Math.min(seg, 14), arc);
const Box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

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
  | 'ankleL'
  | 'ankleR'
  | 'armL'
  | 'armR'
  | 'elbowL'
  | 'elbowR';

const JOINTS: JointName[] = ['hips', 'spine', 'head', 'thighL', 'thighR', 'kneeL', 'kneeR', 'ankleL', 'ankleR', 'armL', 'armR', 'elbowL', 'elbowR'];
const LEG_JOINTS = new Set<JointName>(['thighL', 'thighR', 'kneeL', 'kneeR', 'ankleL', 'ankleR']);

/** Rig dimensions (world units at height 1). */
export const RIG = {
  hipY: 0.92,
  hipJointY: -0.03,
  thigh: 0.41,
  shin: 0.4,
  /** Ankle joint height above the ground when the foot is flat. */
  ankleH: 0.08,
  upperArm: 0.27,
  forearm: 0.3,
} as const;

/** Two-bone planar IK. Returns [thigh, knee] angles (thigh negative = forward, knee positive = flexed). */
export function legIK(dz: number, dy: number, a = RIG.thigh, b = RIG.shin): [number, number] {
  const d = Math.min(Math.max(Math.hypot(dz, dy), 0.05), a + b - 1e-4);
  const alpha = Math.atan2(dz, -dy);
  const bend = Math.PI - Math.acos(Math.min(1, Math.max(-1, (a * a + b * b - d * d) / (2 * a * b))));
  const lean = Math.acos(Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d))));
  return [-alpha - lean, bend];
}

/** Gait parameters blended between a relaxed walk and a jog by speed (units/s). */
export function gaitParams(speed: number) {
  const r = smoothstep(2.6, 4.2, speed);
  const stance = lerp(0.62, 0.42, r);
  const stride = lerp(0.82, 0.96, r);
  // Cadence chosen so the planted foot moves backward at exactly the ground speed: no foot sliding.
  const cadence = speed > 0.05 ? (speed * stance) / stride : 0;
  return { run: r, stance, stride, cadence, lift: lerp(0.07, 0.13, r), crouch: lerp(0.035, 0.07, r) };
}

/** Foot offset (forward, lift) relative to the hip for a leg at gait phase φ ∈ [0,1). */
export function footAt(phase: number, stance: number, stride: number, lift: number): { z: number; lift: number; planted: boolean } {
  const f = ((phase % 1) + 1) % 1;
  if (f < stance) return { z: stride / 2 - (f / stance) * stride, lift: 0, planted: true };
  const u = (f - stance) / (1 - stance);
  const e = u * u * (3 - 2 * u);
  return { z: -stride / 2 + stride * e, lift: lift * Math.sin(Math.PI * u), planted: false };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const tmpV = new THREE.Vector3();
const tmpQa = new THREE.Quaternion();
const tmpQb = new THREE.Quaternion();
const tmpMb = new THREE.Matrix4();

export class HeroModel {
  readonly root = new THREE.Group();
  readonly joints: Record<JointName, THREE.Group>;
  private handR = new THREE.Group();
  private handL = new THREE.Group();
  private tools = new Map<HeldTool, THREE.Group>();
  private material: THREE.MeshLambertMaterial;
  private faceMat: THREE.MeshLambertMaterial;
  private faceOpen: THREE.Texture | null;
  private faceClosed: THREE.Texture | null;
  private target = new Map<JointName, THREE.Vector3>();
  private hipOffset = new THREE.Vector3();
  private hipTarget = new THREE.Vector3();
  private gaitPhase = 0;
  private loco = 0;
  private flash = 0;
  private deadT = 0;
  private blinkT = 2 + Math.random() * 3;
  private held: HeldTool = 'none';
  private geometries: THREE.BufferGeometry[] = [];
  private turnRate = 0;
  private aimIn = 0;
  private aim = 0;
  private drawIn = 0;
  private readyIn = 0;
  private ready = 0;
  private shoulderX: number;
  private old: boolean;
  // Bow rig
  private bowMount = new THREE.Group();
  private wandTip: THREE.Object3D | null = null;
  private bowString: THREE.Mesh[] = [];
  private nockedArrow = new THREE.Group();
  // Archery cycle state: how far the bow arm is pushed out, how far the draw hand has returned to the
  // string after a release, and where the nock was last frame (the draw hand's target).
  private archExt = 0;
  private archRecover = 1;
  private lastNock = new THREE.Vector3();
  private nockWorld = new THREE.Vector3();
  private armRBaseZ = 0;
  private bowTip = { x: 0, y: 0 };
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
    const build = look.build ?? 1;
    const limb = 1 + (build - 1) * 0.6;
    this.old = look.age === 'old';
    const skin = look.skin;
    const tunic = look.armor === 'guard' ? '#80878f' : look.tunic;
    const trousers = look.trousers;
    const outer = look.outer ?? (look.robe ? shade(tunic, 0.7) : PALETTE.leather);
    const accent = look.accent ?? PALETTE.gold;
    const boots = PALETTE.leatherDark;
    const robe = !!look.robe;
    const guard = look.armor === 'guard';
    if (look.height) this.root.scale.setScalar(look.height);

    // ---- hierarchy
    j.hips.position.y = RIG.hipY;
    this.root.add(j.hips);
    j.hips.add(j.spine);
    j.spine.position.y = 0.06;
    j.spine.add(j.head);
    j.head.position.y = 0.49;
    this.shoulderX = (fem ? 0.235 : 0.265) * build;
    for (const [side, sx] of [['L', -1], ['R', 1]] as const) {
      const thigh = j[`thigh${side}`];
      thigh.position.set(sx * (fem ? 0.115 : 0.112) * build, RIG.hipJointY, 0);
      j.hips.add(thigh);
      const knee = j[`knee${side}`];
      knee.position.y = -RIG.thigh;
      thigh.add(knee);
      const ankle = j[`ankle${side}`];
      ankle.position.y = -RIG.shin;
      knee.add(ankle);
      const arm = j[`arm${side}`];
      arm.position.set(sx * this.shoulderX, 0.355, -0.005);
      this.armRBaseZ = -0.005;
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
    const pelvis: THREE.BufferGeometry[] = [cpart(Sph(1, 12, 8), trousers, { y: -0.03, sx: (fem ? 0.245 : 0.235) * build, sy: 0.15, sz: 0.17 * build, ao: 0.2 })];
    if (robe) {
      pelvis.push(cpart(lathe([[0.2, 0.05], [0.235, -0.2], [0.29, -0.55], [0.33, -0.86], [0.31, -0.88]], 18), tunic, { ao: 0.3, sx: build, sz: build }));
      pelvis.push(cpart(Tor(0.32, 0.026, 16), accent, { y: -0.84, rx: Math.PI / 2, sx: build, sy: build }));
    } else {
      pelvis.push(cpart(lathe([[0.205, 0.06], [0.228, -0.06], [0.265, -0.21], [0.258, -0.235]], 16, 0.55), tunic, { ao: 0.25, sx: build, sz: build, mottle: guard ? 0.14 : 0.03 }));
      pelvis.push(cpart(lathe([[0.262, -0.2], [0.268, -0.215], [0.262, -0.235]], 16, 0.55), hem, { mottle: 0.02, sx: build, sz: build }));
    }
    if (guard) {
      // Tabard skirt panels (front and back)
      pelvis.push(cpart(new THREE.BoxGeometry(0.24, 0.3, 0.02), look.tunic, { y: -0.13, z: 0.27 * build, rx: -0.12 }));
      pelvis.push(cpart(new THREE.BoxGeometry(0.24, 0.3, 0.02), look.tunic, { y: -0.13, z: -0.27 * build, rx: 0.12 }));
    }
    this.addMesh(j.hips, pelvis);

    // ---- legs: thigh, calf + boot shaft (knee), foot (ankle)
    const bootLight = shade(boots, 1.35);
    for (const side of ['L', 'R'] as const) {
      const lp = look.gear?.legs;
      this.addMesh(j[`thigh${side}`], [
        cpart(Cap(0.1 * limb, 0.2), trousers, { y: -0.2, ao: 0.15 }),
        ...(lp
          ? [
              cpart(Cyl(0.118 * limb, 0.108 * limb, 0.3, 12), lp, { y: -0.2, ao: 0.15 }),
              cpart(Sph(1, 10, 7), shade(lp, 1.1), { y: -0.39, z: 0.05, sx: 0.07 * limb, sy: 0.06, sz: 0.05 }),
            ]
          : []),
      ]);
      this.addMesh(j[`knee${side}`], [
        cpart(Cap(0.088 * limb, 0.17, 3, 8), trousers, { y: -0.12, ao: 0.1 }),
        cpart(Cyl(0.102 * limb, 0.094 * limb, 0.2, 10), boots, { y: -0.3, ao: 0.25 }),
        cpart(lathe([[0.1 * limb, -0.2], [0.122 * limb, -0.165], [0.118 * limb, -0.13], [0.104 * limb, -0.125]], 12), bootLight, { mottle: 0.05 }),
        cpart(Tor(0.098 * limb, 0.011, 12), shade(boots, 0.7), { y: -0.27, rx: Math.PI / 2 }),
      ]);
      this.addMesh(j[`ankle${side}`], [
        cpart(Sph(1, 12, 8), boots, { y: -0.01, z: 0.055, sx: 0.098 * limb, sy: 0.075, sz: 0.165 }),
        cpart(Sph(1, 10, 6), bootLight, { y: -0.015, z: 0.15, sx: 0.07 * limb, sy: 0.05, sz: 0.06, mottle: 0.05 }),
        cpart(new THREE.BoxGeometry(0.13 * limb, 0.05, 0.08), shade(boots, 0.6), { y: -0.045, z: -0.055 }),
        cpart(Cyl(0.098 * limb, 0.098 * limb, 0.03, 12), '#2a1c12', { y: -0.065, z: 0.045, sz: 1.85 }),
      ]);
    }

    // ---- torso
    const cw = (fem ? 0.215 : 0.25) * build;
    const torso: THREE.BufferGeometry[] = [
      cpart(lathe([[0.19 * build, -0.03], [0.198 * build, 0.08], [cw * 0.95, 0.2], [cw, 0.3], [cw * 0.96, 0.36], [cw * 0.78, 0.415], [0.13, 0.465], [0.08, 0.49]], 16), tunic, { sz: 0.82, ao: 0.18, mottle: guard ? 0.14 : 0.03 }),
      cpart(lathe([[0.205 * build, -0.01], [0.212 * build, 0.08], [cw * 0.95 + 0.018, 0.2], [cw + 0.018, 0.3], [cw * 0.96 + 0.016, 0.36], [cw * 0.78 + 0.014, 0.42], [0.145, 0.46]], 16, robe ? 0.6 : guard ? 1.5 : 1.0), outer, { sz: 0.83, ao: 0.22, mottle: 0.05 }),
      cpart(Tor(0.2 * build, 0.034, 16), PALETTE.leatherDark, { y: 0.0, rx: Math.PI / 2, sz: 0.83 }),
      cpart(new THREE.BoxGeometry(0.085, 0.07, 0.035), accent, { y: 0.0, z: 0.17 * build }),
      cpart(Sph(1, 10, 7), PALETTE.leather, { x: 0.17 * build, y: -0.06, z: 0.08, sx: 0.065, sy: 0.07, sz: 0.05, ao: 0.3, mottle: 0.05 }),
      cpart(Tor(0.1, 0.03, 12), robe ? accent : PALETTE.linen, { y: 0.455, rx: Math.PI / 2, sz: 0.9 }),
    ];
    if (guard) {
      // Blue tabard over mail, with a gold crest.
      for (const zf of [1, -1]) torso.push(cpart(new THREE.BoxGeometry(0.26 * build, 0.42, 0.02), look.tunic, { y: 0.17, z: zf * (cw * 0.84 + 0.02), rx: zf * 0.08 }));
      torso.push(cpart(new THREE.OctahedronGeometry(0.06, 0), PALETTE.gold, { y: 0.24, z: cw * 0.84 + 0.04, sz: 0.3 }));
    } else if (!robe) {
      torso.push(cpart(new THREE.TorusGeometry(cw * 0.93, 0.02, 4, 20), PALETTE.leatherDark, { y: 0.21, sz: 0.88, rx: Math.PI / 2, ry: 0.6 }));
    }
    if (fem) torso.push(cpart(Sph(1, 10, 7), tunic, { y: 0.27, z: 0.1, sx: 0.17, sy: 0.085, sz: 0.08 }));
    if (look.cape) torso.push(cpart(lathe([[0.2, 0.42], [0.25, 0.2], [0.3, -0.25]], 10, Math.PI * 1.2), look.cape, { sz: 0.85 }));
    if (look.gear?.body) {
      // Breastplate shell over the jerkin, with a raised centre ridge and a lower rim.
      const pt = look.gear.body;
      torso.push(cpart(lathe([[0.205 * build + 0.012, 0.01], [0.214 * build + 0.014, 0.08], [cw * 0.95 + 0.032, 0.2], [cw + 0.032, 0.3], [cw * 0.96 + 0.03, 0.36], [cw * 0.78 + 0.026, 0.42], [0.15, 0.455]], 16), pt, { sz: 0.84, ao: 0.15 }));
      torso.push(cpart(Box(0.03, 0.36, 0.03), shade(pt, 1.15), { y: 0.24, z: (cw + 0.03) * 0.84 }));
      torso.push(cpart(Tor(0.215 * build, 0.016, 16), shade(pt, 0.7), { y: 0.02, rx: Math.PI / 2, sz: 0.84 }));
    }
    torso.push(cpart(Cyl(0.072 * limb, 0.082 * limb, 0.1, 10), skin, { y: 0.49 }));
    this.addMesh(j.spine, torso);

    // ---- arms
    for (const [side, sx] of [['L', -1], ['R', 1]] as const) {
      const sleeve = tunic;
      const upper = [
        cpart(Sph(1, 12, 8), sleeve, { y: -0.01, sx: 0.084 * limb, sy: 0.08, sz: 0.084 * limb, ao: 0.1 }),
        cpart(lathe([[0.066 * limb, -0.27], [0.074 * limb, -0.22], [0.082 * limb, -0.12], [0.084 * limb, -0.03], [0.07 * limb, 0.02]], 10), sleeve, { ao: 0.18, mottle: guard ? 0.14 : 0.03 }),
      ];
      const plate = look.gear?.body ?? (guard ? PALETTE.iron : null);
      if (plate) {
        upper.push(cpart(new THREE.SphereGeometry(0.11 * limb, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), plate, { y: -0.02, x: sx * 0.01, sy: 0.85 }));
        upper.push(cpart(Tor(0.105 * limb, 0.012, 12), shade(plate, 0.75), { y: -0.02, rx: Math.PI / 2 }));
      }
      this.addMesh(j[`arm${side}`], upper);
      const cuff = robe ? tunic : PALETTE.leather;
      this.addMesh(j[`elbow${side}`], [
        cpart(Cap(0.064 * limb, 0.13), robe ? tunic : skin, { y: -0.1 }),
        cpart(Cyl(robe ? 0.085 : 0.074 * limb, robe ? 0.1 : 0.068 * limb, robe ? 0.13 : 0.12, 10), cuff, { y: robe ? -0.15 : -0.14, ao: 0.2, mottle: 0.05 }),
        cpart(Tor(robe ? 0.09 : 0.072 * limb, 0.009, 10), robe ? accent : shade(cuff, 0.7), { y: -0.1, rx: Math.PI / 2 }),
        cpart(Sph(1, 10, 7), skin, { y: -0.245, sx: 0.06 * limb, sy: 0.068, sz: 0.048 }),
        cpart(Sph(1, 10, 7), skin, { y: -0.292, z: 0.016, sx: 0.058 * limb, sy: 0.04, sz: 0.05, ao: 0.15 }),
        cpart(Cap(0.022, 0.045, 2, 6), skin, { x: -sx * 0.045, y: -0.24, z: 0.035, rz: sx * 0.55, rx: -0.45 }),
      ]);
      const sh = look.gear?.shield;
      if (side === 'L' && sh) {
        // Round shield strapped to the outside of the left forearm.
        const face = sh.wooden ? '#8a5a34' : shade(sh.tint, 0.9);
        this.addMesh(j.elbowL, [
          cpart(Cyl(0.22, 0.22, 0.035, 16), face, { x: -0.095, y: -0.13, rz: Math.PI / 2, mottle: sh.wooden ? 0.1 : 0.04, ao: 0.1 }),
          cpart(Tor(0.215, 0.02, 16), sh.tint, { x: -0.115, y: -0.13, ry: Math.PI / 2 }),
          cpart(Sph(0.06, 10, 6), sh.tint, { x: -0.12, y: -0.13, sx: 0.6 }),
        ]);
      }
    }

    // ---- head
    const R = 0.192;
    const head: THREE.BufferGeometry[] = [
      cpart(new THREE.SphereGeometry(R, 18, 12), skin, { y: R * 0.95, sy: 1.04, sz: 0.96 }),
      cpart(Sph(1, 12, 8), skin, { y: R * 0.48, z: R * 0.08, sx: R * 0.86 * (guard ? 1.06 : 1), sy: R * 0.58, sz: R * 0.66 }),
      cpart(Sph(1, 10, 8), skin, { x: -R * 0.98, y: R * 0.9, sx: 0.035, sy: 0.05, sz: 0.035 }),
      cpart(Sph(1, 10, 8), skin, { x: R * 0.98, y: R * 0.9, sx: 0.035, sy: 0.05, sz: 0.035 }),
      cpart(Sph(1, 10, 8), shade(skin, 0.97), { y: R * 0.8, z: R * 0.94, sx: 0.024 * (guard ? 1.2 : 1), sy: 0.026, sz: 0.026 }),
    ];
    const helm = look.gear?.head;
    if (!look.helmet && !helm) this.buildHair(head, look.hair, look.hairStyle % 5, R);
    if (helm) {
      // Rounded helm with a brow band and a nose guard.
      head.push(cpart(new THREE.SphereGeometry(R * 1.1, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), helm, { y: R * 1.05, sy: 0.95 }));
      head.push(cpart(Tor(R * 1.08, 0.02, 16), shade(helm, 0.72), { y: R * 1.12, rx: Math.PI / 2, sz: 0.97 }));
      head.push(cpart(Box(0.03, 0.12, 0.025), shade(helm, 0.85), { y: R * 0.93, z: R * 1.08 }));
    }
    if (look.beard) {
      // Full beard hugging the jaw, and a moustache.
      head.push(cpart(Sph(1, 12, 9), look.hair, { y: R * 0.4, z: R * 0.42, sx: R * 0.92, sy: R * 0.62, sz: R * 0.6, mottle: 0.08 }));
      head.push(cpart(Sph(1, 10, 6), shade(look.hair, 1.1), { y: R * 0.62, z: R * 0.86, sx: R * 0.42, sy: R * 0.12, sz: R * 0.16 }));
    }
    if (look.helmet) {
      // Kettle hat: steel crown with a wide brim.
      head.push(cpart(new THREE.SphereGeometry(R * 1.12, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), PALETTE.iron, { y: R * 1.15, sy: 0.85 }));
      head.push(cpart(Cyl(R * 1.5, R * 1.55, 0.025, 16), shade(PALETTE.iron, 0.85), { y: R * 1.13 }));
      head.push(cpart(Tor(R * 1.12, 0.014, 16), shade(PALETTE.iron, 0.7), { y: R * 1.16, rx: Math.PI / 2 }));
    }
    if (look.spectacles) {
      // Round wire spectacles resting on the nose, arms running back to the ears.
      const ey = R * 1.0;
      const ez = R * 0.99;
      for (const sx of [-1, 1]) {
        head.push(cpart(Tor(0.042, 0.0065, 14), PALETTE.gold, { x: sx * 0.071, y: ey, z: ez, ry: sx * 0.2 }));
        head.push(cpart(Cyl(0.005, 0.005, R * 0.95, 4), PALETTE.gold, { x: sx * R * 0.86, y: ey + 0.01, z: R * 0.45, rx: Math.PI / 2, ry: -sx * 0.18 }));
      }
      head.push(cpart(Cyl(0.005, 0.005, 0.05, 4), PALETTE.gold, { y: ey + 0.012, z: ez + 0.012, rz: Math.PI / 2 }));
    }
    this.addMesh(j.head, head);

    const eyes = look.eyes ?? '#4a7a3a';
    const brows = look.hair === '#e8e8e8' ? '#b9b9b9' : shade(look.hair, 0.8);
    this.faceOpen = faceTexture({ eyes, skin, brows, blush: !look.elder && !look.beard, elder: look.elder });
    this.faceClosed = faceTexture({ eyes, skin, brows, blush: !look.elder && !look.beard, elder: look.elder, closed: true });
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
    if (look.prop === 'ledger') this.buildLedger();
  }

  // ---- clerk props (banker): open ledger in the left hand, quill in the right
  private ledger: THREE.Group | null = null;
  private quill: THREE.Group | null = null;

  private buildLedger() {
    const cover = '#5a2e2a';
    const book = [
      cpart(Box(0.2, 0.018, 0.27), cover, { x: -0.1, rz: 0.16 }),
      cpart(Box(0.2, 0.018, 0.27), cover, { x: 0.1, rz: -0.16 }),
      cpart(Box(0.185, 0.03, 0.25), '#f3ead2', { x: -0.095, y: 0.02, rz: 0.16 }),
      cpart(Box(0.185, 0.03, 0.25), '#f3ead2', { x: 0.095, y: 0.02, rz: -0.16 }),
      cpart(Cyl(0.014, 0.014, 0.27, 6), PALETTE.gold, { y: -0.006, rx: Math.PI / 2 }),
      cpart(Box(0.012, 0.004, 0.2), '#8a1f2a', { x: 0.03, y: 0.04, z: 0.06, rz: -0.16 }),
    ];
    this.ledger = new THREE.Group();
    const bm = new THREE.Mesh(cmerge(book), this.material);
    bm.castShadow = true;
    this.geometries.push(bm.geometry);
    this.ledger.add(bm);
    this.handL.add(this.ledger);
    const quill = [cpart(Cyl(0.006, 0.004, 0.2, 5), '#3a3330', { y: 0.06 }), cpart(Sph(1, 8, 6), '#f4f1ea', { y: 0.15, sx: 0.022, sy: 0.08, sz: 0.006, rz: 0.15 })];
    this.quill = new THREE.Group();
    const qm = new THREE.Mesh(cmerge(quill), this.material);
    this.geometries.push(qm.geometry);
    this.quill.add(qm);
    this.quill.position.set(0, -0.05, 0.03);
    this.quill.rotation.set(-1.0, 0, 0.2);
    this.handR.add(this.quill);
  }

  /**
   * Banker idle: reads and writes in the ledger, looking up now and then; when someone talks to
   * them they lower the book a little and look up at the customer.
   */
  private applyClerk(pose: HumanoidPose, time: number) {
    const talking = pose === 'talk';
    const cycle = (time % 8) / 8;
    const writing = !talking && cycle < 0.6;
    const look = talking ? 1 : writing ? 0 : 1;
    this.set('armL', -0.6 + 0.15 * look, 0.75, -0.05);
    this.set('elbowL', -1.25 + 0.15 * look);
    const scribble = writing ? Math.sin(time * 11) * 0.035 + Math.sin(time * 3.1) * 0.04 : 0;
    this.set('armR', -0.62 + (writing ? 0 : 0.35), -0.3 + scribble, 0.16);
    this.set('elbowR', writing ? -1.35 : -0.6);
    // Head: down at the page while writing, up (with a slow glance) otherwise.
    this.set('head', writing ? 0.32 : 0.02, writing ? 0 : Math.sin(time * 0.6) * 0.25, 0);
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
    // Default grip: handle runs along the tool's +y, held at the palm, pointing forward.
    g.rotation.x = Math.PI / 2;
    g.position.y = -0.03;
    return g;
  }

  private buildTools() {
    const wood = '#8a5a34';
    const bronze = '#c98a4b';
    const steel = '#d6dbe2';
    // Forged weapons show their metal; a dagger has a shorter blade.
    const gw = this.look.gear?.weapon;
    const blade = gw && gw.kind !== 'bow' ? shade(gw.tint, 1.25) : steel;
    const bladeLen = gw?.kind === 'dagger' ? 0.32 : 0.62;
    this.tools.set(
      'sword',
      this.toolMesh([
        cpart(Cyl(0.022, 0.022, 0.17, 8), PALETTE.leatherDark, { y: 0 }),
        cpart(Sph(0.035, 8, 6), PALETTE.gold, { y: -0.1 }),
        cpart(Cap(0.025, 0.2, 3, 8), PALETTE.gold, { y: 0.1, rz: Math.PI / 2 }),
        cpart(Cyl(0.012, 0.045, bladeLen, 4), blade, { y: 0.11 + bladeLen / 2, sz: 0.35 }),
        cpart(new THREE.ConeGeometry(0.012, 0.09, 4), blade, { y: 0.155 + bladeLen, sz: 0.35, sx: 3.7 }),
      ]),
    );
    this.buildBow(gw?.kind === 'bow' ? gw.tint : wood);
    this.tools.set(
      'hammer',
      this.toolMesh([
        cpart(Cyl(0.018, 0.022, 0.36, 7), wood, { y: 0.12 }),
        cpart(Box(0.15, 0.07, 0.07), '#5b5f68', { y: 0.3 }),
        cpart(Box(0.035, 0.08, 0.08), '#8d949c', { x: 0.08, y: 0.3 }),
      ]),
    );
    this.tools.set(
      'net',
      this.toolMesh([
        cpart(Cyl(0.016, 0.02, 0.9, 7), wood, { y: 0.3 }),
        cpart(Tor(0.16, 0.012, 14), '#8a5a34', { y: 0.86, rx: Math.PI / 2 }),
        cpart(new THREE.SphereGeometry(0.16, 10, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), '#d8ccb0', { y: 0.86, sy: 0.9 }),
      ]),
    );
    // The net pole angles down so the hoop dips toward the water.
    this.tools.get('net')!.rotation.x = Math.PI / 2 + 0.75;
    this.tools.set(
      'knife',
      this.toolMesh([cpart(Cyl(0.016, 0.018, 0.1, 6), PALETTE.leatherDark, { y: 0.02 }), cpart(Cyl(0.004, 0.022, 0.13, 4), steel, { y: 0.135, sz: 0.3 })]),
    );
    // Wand: forearm-length, gripped at the base, crystal at the tip.
    const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.032, 1), new THREE.MeshBasicMaterial({ color: '#b39cff' }));
    orb.position.y = 0.4;
    this.wandTip = orb;
    this.tools.set(
      'staff',
      this.toolMesh(
        [
          cpart(Cyl(0.011, 0.019, 0.42, 7), '#6b4426', { y: 0.16 }),
          cpart(Cyl(0.022, 0.022, 0.03, 8), PALETTE.gold, { y: -0.03 }),
          cpart(Cyl(0.017, 0.017, 0.025, 8), PALETTE.gold, { y: 0.07 }),
          cpart(Cyl(0.016, 0.011, 0.03, 8), PALETTE.gold, { y: 0.375 }),
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
    this.tools.set(
      'spear',
      this.toolMesh([
        cpart(Cyl(0.024, 0.028, 2.0, 7), '#7a5232', { y: 0.2 }),
        cpart(new THREE.ConeGeometry(0.05, 0.26, 4), steel, { y: 1.33, sz: 0.4 }),
        cpart(Cyl(0.034, 0.03, 0.08, 8), PALETTE.iron, { y: 1.17 }),
        cpart(Tor(0.03, 0.01, 8), '#3a5fb0', { y: 1.1, rx: Math.PI / 2 }),
      ]),
    );
    // Upright carries: grounded beside the body instead of pointing forward.
    for (const k of ['walkingstaff', 'spear'] as const) {
      const t = this.tools.get(k)!;
      t.position.set(0, k === 'spear' ? -0.62 : -0.4, 0);
    }
    for (const [k, t] of this.tools) {
      t.visible = false;
      if (k === 'bow') continue;
      this.handR.add(t);
    }
  }

  /**
   * Bow built in "bow space": the riser/grip sits at the origin (in the palm), the limbs run along ±y,
   * the belly faces +x (toward the target) and the string sits behind the grip at −x. The string is two
   * segments meeting at a nock point that moves back as the bow is drawn.
   */
  private buildBow(wood: string) {
    const Rb = 0.9;
    const half = 0.66;
    const limbs = new THREE.TorusGeometry(Rb, 0.02, 5, 18, half * 2);
    limbs.rotateZ(-half);
    limbs.translate(-Rb, 0, 0);
    const tipX = Rb * Math.cos(half) - Rb;
    const tipY = Rb * Math.sin(half);
    this.bowTip = { x: tipX, y: tipY };
    const bowGeo = cmerge([
      cpart(limbs, wood, { mottle: 0.05 }),
      cpart(Cyl(0.03, 0.03, 0.16, 8), PALETTE.leather, { mottle: 0.06 }),
      cpart(Sph(0.028, 8, 6), PALETTE.gold, { x: tipX + 0.01, y: tipY }),
      cpart(Sph(0.028, 8, 6), PALETTE.gold, { x: tipX + 0.01, y: -tipY }),
      cpart(new THREE.BoxGeometry(0.03, 0.02, 0.02), PALETTE.leatherDark, { x: 0.035, y: 0.07 }),
    ]);
    this.geometries.push(bowGeo);
    const bow = new THREE.Group();
    const body = new THREE.Mesh(bowGeo, this.material);
    body.castShadow = true;
    bow.add(body);
    const stringMat = new THREE.MeshBasicMaterial({ color: '#f2efe6' });
    const strGeo = new THREE.CylinderGeometry(0.006, 0.006, 1, 4);
    this.geometries.push(strGeo);
    for (let i = 0; i < 2; i++) {
      const sm = new THREE.Mesh(strGeo, stringMat);
      sm.userData.noGhost = true;
      this.bowString.push(sm);
      bow.add(sm);
    }
    // Nocked arrow (shown while drawing): shaft along +x from the nock.
    const arrowGeo = cmerge([
      cpart(Cyl(0.009, 0.009, 0.72, 5), '#c9a36a', { rz: Math.PI / 2, x: 0.36 }),
      cpart(new THREE.ConeGeometry(0.022, 0.07, 4), '#9aa0a8', { rz: -Math.PI / 2, x: 0.75 }),
      cpart(new THREE.BoxGeometry(0.1, 0.035, 0.004), '#f2f2f2', { x: 0.06 }),
      cpart(new THREE.BoxGeometry(0.1, 0.004, 0.035), '#e85d5d', { x: 0.06 }),
    ]);
    this.geometries.push(arrowGeo);
    this.nockedArrow.add(new THREE.Mesh(arrowGeo, this.material));
    this.nockedArrow.visible = false;
    bow.add(this.nockedArrow);
    this.bowMount.add(bow);
    this.bowMount.visible = false;
    this.handL.add(this.bowMount);
    this.tools.set('bow', this.bowMount);
    this.updateBowString(0);
  }

  private updateBowString(draw: number) {
    const { x: tx, y: ty } = this.bowTip;
    const nx = tx - draw * 0.5;
    const up = new THREE.Vector3(0, 1, 0);
    for (const [i, sy] of [[0, ty], [1, -ty]] as const) {
      const a = new THREE.Vector3(tx, sy, 0);
      const b = new THREE.Vector3(nx, 0, 0);
      const d = b.clone().sub(a);
      const m = this.bowString[i];
      m.position.copy(a).addScaledVector(d, 0.5);
      m.quaternion.setFromUnitVectors(up, d.clone().normalize());
      m.scale.set(1, d.length(), 1);
    }
    this.nockedArrow.position.set(nx, 0, 0.012);
  }

  setTool(tool: HeldTool) {
    if (tool === this.held) return;
    for (const [k, t] of this.tools) t.visible = k === tool;
    this.held = tool;
  }

  hitFlash() {
    this.flash = 0.18;
  }

  /** Angular velocity of the root's facing (rad/s), used to lean into turns. */
  setTurnRate(rate: number) {
    this.turnRate = rate;
  }

  /**
   * Combat stance inputs. `ready` raises/levels the weapon from its relaxed carry; for bows,
   * `aim` raises the bow to shooting position and `draw` (0..1) pulls the string to the anchor.
   */
  setCombat(ready: number, aim: number, draw: number) {
    this.readyIn = ready;
    this.aimIn = aim;
    this.drawIn = draw;
  }

  /** World position projectiles leave from: the arrow rest for a bow, the crystal tip for a wand. False otherwise. */
  projectileOrigin(out: THREE.Vector3): boolean {
    if (this.held === 'staff' && this.wandTip) {
      this.root.updateWorldMatrix(true, true);
      out.setFromMatrixPosition(this.wandTip.matrixWorld);
      return true;
    }
    if (this.held !== 'bow') return false;
    this.root.updateWorldMatrix(true, true);
    out.set(0.03, 0.02, 0).applyMatrix4(this.bowMount.matrixWorld);
    return true;
  }

  private set(n: JointName, x: number, y = 0, z = 0) {
    this.target.get(n)!.set(x, y, z);
  }

  private add(n: JointName, x: number, y = 0, z = 0) {
    this.target.get(n)!.add(tmpV.set(x, y, z));
  }

  /** Animate one frame (same contract as the classic Humanoid). */
  update(dt: number, pose: HumanoidPose, speed: number, swingAge: number, time: number) {
    for (const n of JOINTS) this.target.get(n)!.set(0, 0, 0);
    const ht = this.hipTarget.set(0, 0, 0);
    const kAim = 1 - Math.exp(-dt * 9);
    this.aim += (this.aimIn - this.aim) * kAim;
    this.ready += (this.readyIn - this.ready) * (1 - Math.exp(-dt * 6));
    const archer = this.held === 'bow' && this.aim > 0.02;
    const oldK = this.old ? 1 : 0;

    // Rest pose: grounded A-stance, soft knees, arms hanging clear of the torso.
    // (For armL, negative z moves the hand away from the body; armR mirrors it.)
    this.set('armL', 0.04, 0, -0.1);
    this.set('armR', 0.04, 0, 0.1);
    this.set('elbowL', -0.2);
    this.set('elbowR', -0.2);
    this.set('spine', 0.03 + oldK * 0.14);
    this.set('head', -oldK * 0.1);
    if (this.held === 'bow') {
      // Carry the bow low at the side, hand relaxed.
      this.set('armL', 0.06, 0, -0.16);
      this.set('elbowL', -0.3);
    }
    if (this.held === 'walkingstaff' || this.held === 'spear') {
      this.set('armR', -0.2, 0, 0.04);
      this.set('elbowR', -0.8);
    }
    const clerk = this.look.prop === 'ledger' && (pose === 'idle' || pose === 'talk') && speed < 0.3;
    if (clerk) this.applyClerk(pose, time);
    let snap = 14;
    if (pose !== 'dead') this.deadT = 0;

    // ---- locomotion (legs are solved by IK so planted feet stay put)
    const moving = speed > 0.3 && (pose === 'walk' || pose === 'attack' || pose === 'talk');
    this.loco += ((moving ? 1 : 0) - this.loco) * (1 - Math.exp(-dt * 10));
    const g = gaitParams(Math.max(speed, 0.0) * (this.old ? 1.25 : 1));
    if (moving) this.gaitPhase = (this.gaitPhase + g.cadence * (this.old ? 0.8 : 1) * dt) % 1;
    const w = this.loco;
    const restHip = RIG.hipY;
    const baseHip = restHip - lerp(0.012, g.crouch, w);
    const legAngles: Record<'L' | 'R', [number, number, number]> = { L: [0, 0, 0], R: [0, 0, 0] };
    let hipH = baseHip;
    const feet = {
      L: footAt(this.gaitPhase, g.stance, g.stride, g.lift),
      R: footAt(this.gaitPhase + 0.5, g.stance, g.stride, g.lift),
    };
    if (w > 0.001) {
      // Lower the hips just enough that planted feet stay on the ground (natural, small bob).
      const reach = RIG.thigh + RIG.shin - 0.015;
      for (const side of ['L', 'R'] as const) {
        const f = feet[side];
        if (!f.planted) continue;
        const need = Math.sqrt(Math.max(0.01, reach * reach - f.z * f.z)) + RIG.ankleH - RIG.hipJointY;
        hipH = Math.min(hipH, lerp(restHip, need, w));
      }
      hipH += g.run * 0.022 * w * Math.max(0, Math.sin(this.gaitPhase * Math.PI * 4));
    }
    for (const side of ['L', 'R'] as const) {
      const f = feet[side];
      const zf = f.z * w + (side === 'L' ? 0.015 : -0.01) * (1 - w);
      const dy = -(hipH + RIG.hipJointY - RIG.ankleH - f.lift * w);
      const [th, kn] = legIK(zf, dy);
      // Foot flat while planted; slight toe-down at lift-off, toe-up as it swings through.
      const swingU = f.planted ? 0 : Math.sin(Math.PI * Math.min(1, (((side === 'L' ? this.gaitPhase : this.gaitPhase + 0.5) % 1) - g.stance) / (1 - g.stance)));
      const ankle = -(th + kn) + (f.planted ? 0 : (0.35 * swingU - 0.15) * w);
      legAngles[side] = [th, kn, ankle];
    }
    this.set('thighL', legAngles.L[0], 0, -0.05 * (1 - w) - 0.02 * w);
    this.set('kneeL', legAngles.L[1]);
    this.set('ankleL', legAngles.L[2]);
    this.set('thighR', legAngles.R[0], 0, 0.05 * (1 - w) + 0.02 * w);
    this.set('kneeR', legAngles.R[1]);
    this.set('ankleR', legAngles.R[2]);
    ht.y = hipH - RIG.hipY;

    if (w > 0.001) {
      // Counter-rotation: pelvis turns with the forward leg, shoulders the other way; relaxed arm swing.
      // Smooth (not foot-tracking) so the torso never jerks when a foot lifts off.
      const hipYaw = 0.11 * Math.cos(Math.PI * 2 * this.gaitPhase) * w;
      this.add('hips', 0, hipYaw, 0.025 * Math.cos(this.gaitPhase * Math.PI * 2) * w);
      this.add('spine', lerp(0.03, 0.13, g.run) * w, -hipYaw * 1.6, -this.turnRate * 0.045 * w);
      this.add('head', -lerp(0.01, 0.07, g.run) * w, hipYaw * 0.5, this.turnRate * 0.02 * w);
      // Arms swing as smooth pendulums in opposition to the legs (left arm back as the left foot
      // lands), a little further forward than back, held slightly away from the body. Elbows
      // stay soft when walking and bend toward 90 degrees when running.
      const armAmp = lerp(0.46, 0.7, g.run) * w;
      const armBias = -lerp(0.05, 0.12, g.run) * w;
      const abduct = lerp(0.03, 0.06, g.run) * w;
      const swingL = Math.cos(Math.PI * 2 * (this.gaitPhase - 0.06));
      const swingR = -swingL;
      const elbowFor = (c: number) => -(lerp(0.3, 1.3, g.run) + lerp(0.3, 0.25, g.run) * Math.max(0, -c)) * w - 0.2 * (1 - w);
      if (!(archer && this.aim > 0.5)) {
        if (this.held !== 'bow') {
          this.add('armL', armBias + swingL * armAmp, 0, -abduct);
          this.set('elbowL', elbowFor(swingL));
        } else {
          // Bow hand: a smaller swing with the bow hanging from it.
          this.add('armL', swingL * armAmp * 0.5, 0, -abduct);
        }
      }
      if (this.held !== 'walkingstaff' && this.held !== 'spear') {
        this.add('armR', armBias + swingR * armAmp, 0, abduct);
        this.set('elbowR', elbowFor(swingR));
      } else {
        this.add('armR', swingR * armAmp * 0.25, 0, 0);
      }
      snap = 16;
    } else if (pose !== 'dead') {
      const br = Math.sin(time * 2.1);
      ht.x = Math.sin(time * 0.7) * 0.01;
      ht.y += br * 0.006;
      this.add('hips', 0, 0, Math.sin(time * 0.7) * 0.025);
      this.add('spine', br * 0.012, 0, -Math.sin(time * 0.7) * 0.025);
      this.add('head', Math.sin(time * 0.9) * 0.035, Math.sin(time * 0.45) * 0.22, 0);
      this.add('armL', br * 0.02, 0, -br * 0.015);
      this.add('armR', br * 0.02, 0, br * 0.015);
    }

    // ---- archery (driven by aim/draw so the draw happens BEFORE the arrow is released)
    this.joints.armR.position.z = this.armRBaseZ;
    if (archer) {
      const released = swingAge < 0.14;
      if (released) this.archRecover = 0;
      else this.archRecover = Math.min(1, this.archRecover + dt / 0.42);
      this.archExt = released ? this.archExt : Math.max(this.drawIn, this.archExt - dt * 2.2);
      this.applyArchery(swingAge);
    } else {
      this.archExt = 0;
      this.archRecover = 1;
    }

    if (pose === 'attack' && !(this.held === 'bow')) {
      snap = 30;
      const t = Math.min(1, swingAge / 0.45);
      if (this.style === 'melee') {
        const wind = t < 0.3 ? easeOut(t / 0.3) : 0;
        const strike = t >= 0.3 && t < 0.55 ? easeIn((t - 0.3) / 0.25) : t >= 0.55 ? 1 : 0;
        const rec = t >= 0.55 ? easeInOut((t - 0.55) / 0.45) : 0;
        const k = strike * (1 - rec);
        this.set('armR', -0.3 - wind * 2.3 * (1 - strike) + k * 0.25, 0, -0.35 - wind * 0.3);
        this.set('elbowR', -0.5 - wind * 0.6 + k * 0.4);
        this.add('spine', -0.1 * wind + 0.2 * k, 0.5 * wind - 0.55 * k, 0);
        this.set('armL', -0.3 * k + 0.15, 0, 0.35);
        if (w < 0.5) {
          ht.z = 0.06 * k;
          ht.y -= 0.03 * k;
        }
      } else {
        const raise = Math.sin(Math.min(1, t * 1.25) * Math.PI);
        const thrust = t > 0.3 && t < 0.6 ? Math.sin(((t - 0.3) / 0.3) * Math.PI) : 0;
        this.set('armR', -1.0 - raise * 0.9, 0, -0.2);
        this.set('elbowR', -0.6 + thrust * 0.5);
        this.set('armL', -0.9 - raise * 0.4, 0, 0.45);
        this.set('elbowL', -0.9);
        this.add('spine', -0.12 * raise + 0.15 * thrust, 0, 0);
        ht.y += raise * 0.03;
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
      const [th1, kn1] = legIK(0.22, -(RIG.hipY - 0.06 + RIG.hipJointY - RIG.ankleH));
      const [th2, kn2] = legIK(-0.14, -(RIG.hipY - 0.06 + RIG.hipJointY - RIG.ankleH));
      this.set('thighL', th1, 0, -0.05);
      this.set('kneeL', kn1);
      this.set('ankleL', -(th1 + kn1));
      this.set('thighR', th2, 0, 0.05);
      this.set('kneeR', kn2);
      this.set('ankleR', -(th2 + kn2));
      ht.y = -0.06 + up * 0.02;
    } else if (pose === 'smith') {
      // Hammering at the anvil: right arm lifts and strikes, left hand steadies the work.
      snap = 26;
      const cycle = (time * 1.4) % 1;
      const up = cycle < 0.55 ? easeOut(cycle / 0.55) : 1 - easeIn((cycle - 0.55) / 0.45);
      this.set('armR', -0.55 - up * 1.55, 0, 0.12);
      this.set('elbowR', -0.7 - up * 0.6);
      this.set('armL', -0.7, 0.2, -0.05);
      this.set('elbowL', -0.9);
      this.set('spine', 0.18 - up * 0.08, -0.12 + up * 0.08, 0);
      this.set('head', 0.22, 0, 0);
      ht.y = -0.02;
    } else if (pose === 'work' && this.held === 'net') {
      // Netting fish: both hands on the pole, reaching out low over the water with a slow sweep.
      const k = Math.sin(time * 1.6);
      this.set('armR', -0.75, 0.15 + k * 0.12, 0.08);
      this.set('elbowR', -0.25);
      this.set('armL', -0.95, -0.35 + k * 0.12, -0.05);
      this.set('elbowL', -0.7);
      this.set('spine', 0.3, k * 0.1, 0);
      this.set('head', 0.25, 0, 0);
      ht.y = -0.03;
    } else if (pose === 'work') {
      // Hands-forward work at a furnace or range, or fletching a log in hand.
      const k = Math.sin(time * 3.2);
      this.set('armR', -0.75 + k * 0.08, 0.25, 0.05);
      this.set('armL', -0.75 - k * 0.08, -0.25, -0.05);
      this.set('elbowR', -1.05);
      this.set('elbowL', -1.05);
      this.set('spine', 0.14, 0, 0);
      this.set('head', 0.28, 0, 0);
    } else if (pose === 'talk' && w < 0.5) {
      const gst = Math.sin(time * 4.2);
      this.set('armR', -0.75 + gst * 0.18, 0, -0.35);
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
      this.set('kneeR', 0);
      this.set('ankleL', 0);
      this.set('ankleR', 0);
      this.set('head', e * 0.3);
    }

    if (this.flash > 0) {
      this.flash -= dt;
      this.target.get('spine')!.x -= 0.22;
    }

    // Blend toward the target pose. Legs follow IK directly while moving so feet never slide.
    const k = 1 - Math.exp(-dt * snap);
    const kLeg = lerp(k, 1, w);
    for (const n of JOINTS) {
      const tg = this.target.get(n)!;
      const r = this.joints[n].rotation;
      const kk = LEG_JOINTS.has(n) ? kLeg : n === 'armR' || n === 'elbowR' || n === 'armL' || n === 'elbowL' ? Math.max(k, archer ? 1 - Math.exp(-dt * 22) : 0) : k;
      r.x += (tg.x - r.x) * kk;
      r.y += (tg.y - r.y) * kk;
      r.z += (tg.z - r.z) * kk;
    }
    const kh = lerp(k, 1 - Math.exp(-dt * 30), w);
    this.hipOffset.x += (ht.x - this.hipOffset.x) * k;
    this.hipOffset.y += (ht.y - this.hipOffset.y) * kh;
    this.hipOffset.z += (ht.z - this.hipOffset.z) * k;
    this.joints.hips.position.set(this.hipOffset.x, RIG.hipY + this.hipOffset.y, this.hipOffset.z);

    this.updateCarry(swingAge);
    if (this.held === 'bow' && this.nockedArrow.parent) {
      this.root.updateWorldMatrix(true, true);
      this.lastNock.set(this.nockedArrow.position.x, 0, 0).applyMatrix4(this.nockedArrow.parent.matrixWorld);
    }

    // Blink
    this.blinkT -= dt;
    const closed = pose === 'dead' || this.blinkT < 0.12;
    if (this.blinkT <= 0) this.blinkT = 2.5 + Math.random() * 3;
    const want = closed ? this.faceClosed : this.faceOpen;
    if (want && this.faceMat.map !== want) this.faceMat.map = want;

    const f = this.flash > 0 ? 1 : 0;
    this.material.emissive.setRGB(0.75 * f, 0.15 * f, 0.1 * f);
  }

  /** Side-on archer stance: bow arm extended at the target, draw hand pulled to the anchor by planar IK. */
  private applyArchery(swingAge: number) {
    const a = this.aim;
    const released = swingAge < 0.14;
    // Set-up: while nocking, the chest faces the target more and the bow arm is bent so the drawing
    // hand can reach the string; the bow arm then pushes out as the string comes back to the chin.
    const e = this.archExt;
    const turn = lerp(0.4, 0.88, e);
    this.add('spine', 0, turn * a, 0);
    this.add('hips', 0, 0.3 * a, 0);
    this.add('head', 0, -(turn + 0.3) * a, 0);
    // Bow arm: horizontal, pointing at the target (spine frame direction (−cos β, 0, sin β)).
    const beta = Math.PI / 2 - (turn + 0.3);
    const tL = this.target.get('armL')!;
    tL.set(lerp(tL.x, 0, a), lerp(tL.y, beta, a), lerp(tL.z, -Math.PI / 2, a));
    const eL = this.target.get('elbowL')!;
    eL.x = lerp(eL.x, lerp(-1.0, -0.06, e), a);
    // Draw hand: on the string (where the nock was last frame, in spine space) while nocked and
    // drawing; on release it flicks back past the chin, then returns to the string to nock again.
    const protract = 0.07 * a * (1 - 0.6 * e);
    this.joints.armR.position.z = this.armRBaseZ + protract;
    const spine = this.joints.spine;
    const nock = spine.worldToLocal(this.nockWorld.copy(this.lastNock));
    const anchor = { x: -0.02, z: -0.02 };
    const follow = { x: anchor.x + 0.12, z: anchor.z - 0.12 };
    let T: { x: number; z: number };
    if (released) {
      T = follow;
    } else {
      const r = this.archRecover;
      T = { x: lerp(follow.x, nock.x, r), z: lerp(follow.z, nock.z, r) };
    }
    const S = { x: this.shoulderX, z: protract };
    const vx = T.x - S.x;
    const vz = T.z - S.z;
    const a1 = RIG.upperArm;
    const a2 = RIG.forearm;
    const d = Math.min(Math.max(Math.hypot(vx, vz), 0.05), a1 + a2 - 1e-3);
    const base = Math.atan2(vz, vx);
    const A = Math.acos(Math.min(1, Math.max(-1, (a1 * a1 + d * d - a2 * a2) / (2 * a1 * d))));
    // Elbow kept out and back, away from the chest.
    const ang = base - A;
    const ux = Math.cos(ang);
    const uz = Math.sin(ang);
    const ex = S.x + ux * a1;
    const ez = S.z + uz * a1;
    const fx = (T.x - ex) / a2;
    const fz = (T.z - ez) / a2;
    // Arm Euler (0, βr, π/2): upper-arm direction (cos βr, 0, −sin βr), front (sin βr, 0, cos βr).
    const betaR = Math.atan2(-uz, ux);
    const zx = Math.sin(betaR);
    const zz = Math.cos(betaR);
    const kappa = Math.atan2(-(fx * zx + fz * zz), fx * ux + fz * uz);
    const tR = this.target.get('armR')!;
    tR.set(lerp(tR.x, 0, a), lerp(tR.y, betaR, a), lerp(tR.z, Math.PI / 2, a));
    const eR = this.target.get('elbowR')!;
    eR.x = lerp(eR.x, kappa, a);
  }

  /** Weapon carry vs. ready orientation, and the bow's world-space alignment. */
  private updateCarry(swingAge: number) {
    if (this.ledger) {
      // Keep the open ledger level-ish and facing the reader whatever the wrist does.
      this.root.updateWorldMatrix(true, true);
      const rq = this.root.getWorldQuaternion(new THREE.Quaternion());
      const hq = this.handL.getWorldQuaternion(new THREE.Quaternion());
      const desired = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.55, -0.35, 0));
      this.ledger.quaternion.copy(hq.invert().multiply(rq).multiply(desired));
      this.ledger.position.set(0, -0.08, 0).add(new THREE.Vector3(0.06, 0, 0.04).applyQuaternion(this.ledger.quaternion));
    }
    const sword = this.tools.get('sword')!;
    sword.rotation.x = Math.PI / 2 + 0.85 * (1 - this.ready);
    const staff = this.tools.get('staff')!;
    // Wand: tip down and slightly forward at rest, pointing ahead when casting.
    staff.rotation.x = Math.PI / 2 + 0.95 * (1 - this.ready);
    if (this.held === 'walkingstaff' || this.held === 'spear') {
      // Grounded carry: keep the shaft near-vertical in world space whatever the forearm does.
      const t = this.tools.get(this.held)!;
      this.root.updateWorldMatrix(true, true);
      const rq = this.root.getWorldQuaternion(new THREE.Quaternion());
      const hq = this.handR.getWorldQuaternion(new THREE.Quaternion());
      const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.06, 0, -0.06));
      t.quaternion.copy(hq.invert().multiply(rq).multiply(tilt));
      t.position.set(0, this.held === 'spear' ? -0.62 : -0.4, 0).applyQuaternion(t.quaternion);
      return;
    }
    if (this.held !== 'bow') return;
    // Carry: solved in body space. Held at the riser in the hanging hand with the limbs horizontal
    // (front to back) outside the leg, string up. It follows the arm's swing.
    this.root.updateWorldMatrix(true, true);
    const swingX = this.joints.armL.rotation.x + this.joints.elbowL.rotation.x * 0.5;
    const carryBody = tmpQb.setFromAxisAngle(tmpV.set(1, 0, 0), 0.08 + swingX * 0.6).multiply(
      new THREE.Quaternion().setFromRotationMatrix(tmpMb.makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0))),
    );
    const handQc = this.handL.getWorldQuaternion(new THREE.Quaternion());
    const rootQc = this.root.getWorldQuaternion(new THREE.Quaternion());
    const qCarry = tmpQa.copy(handQc).invert().multiply(rootQc).multiply(carryBody);
    // Aim: limbs vertical (slight cant), belly toward the character's facing, converted into hand space.
    this.root.updateWorldMatrix(true, true);
    const rootQ = new THREE.Quaternion();
    this.root.getWorldQuaternion(rootQ);
    const desired = new THREE.Quaternion().setFromRotationMatrix(tmpMb.makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0)));
    desired.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.12));
    const handQ = new THREE.Quaternion();
    this.handL.getWorldQuaternion(handQ);
    const aimLocal = tmpQb.copy(handQ).invert().multiply(rootQ).multiply(desired);
    this.bowMount.quaternion.copy(qCarry).slerp(aimLocal, this.aim);
    const released = swingAge < 0.14;
    const draw = this.aim > 0.6 && !released ? this.drawIn : 0;
    this.updateBowString(draw * this.aim);
    // A fresh arrow is nocked once the draw hand is back on the string.
    this.nockedArrow.visible = this.aim > 0.6 && !released && this.archRecover > 0.85;
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

  /** World positions of the sole centres (for tests/diagnostics). */
  soleWorld(side: 'L' | 'R', out: THREE.Vector3): THREE.Vector3 {
    this.root.updateWorldMatrix(true, true);
    return out.set(0, -RIG.ankleH, 0.04).applyMatrix4(this.joints[`ankle${side}`].matrixWorld);
  }

  /** World positions of the hands and the bow parts (for tests/diagnostics). */
  debugBow() {
    this.root.updateWorldMatrix(true, true);
    const grip = new THREE.Vector3().applyMatrix4(this.bowMount.matrixWorld);
    const handL = new THREE.Vector3(0, 0, 0).applyMatrix4(this.handL.matrixWorld);
    const handR = new THREE.Vector3(0, -0.04, 0).applyMatrix4(this.handR.matrixWorld);
    // The two string segments meet at the nock point: midpoint = (tip + nock) / 2.
    const nock = new THREE.Vector3(2 * this.bowString[0].position.x - this.bowTip.x, 0, 0).applyMatrix4(this.bowMount.matrixWorld);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(this.bowMount.matrixWorld);
    const belly = new THREE.Vector3(1, 0, 0).transformDirection(this.bowMount.matrixWorld);
    const stringLocalX = this.bowTip.x;
    return { grip, handL, handR, nock, up, belly, stringLocalX };
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
