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
  tmpE.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, 'XYZ');
  tmpQ.setFromEuler(tmpE);
  tmpM.compose(new THREE.Vector3(o.x ?? 0, o.y ?? 0, o.z ?? 0), tmpQ, new THREE.Vector3(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1));
  geo.applyMatrix4(tmpM);
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  tmpC.set(color);
  for (let i = 0; i < n; i++) {
    col[i * 3] = tmpC.r;
    col[i * 3 + 1] = tmpC.g;
    col[i * 3 + 2] = tmpC.b;
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

    // ---- hierarchy
    j.hips.position.y = 0.92;
    this.root.add(j.hips);
    j.hips.add(j.spine);
    j.spine.position.y = 0.06;
    j.spine.add(j.head);
    j.head.position.y = 0.5;
    for (const [side, sx] of [['L', -1], ['R', 1]] as const) {
      const thigh = j[`thigh${side}`];
      thigh.position.set(sx * (fem ? 0.095 : 0.1), -0.02, 0);
      j.hips.add(thigh);
      const knee = j[`knee${side}`];
      knee.position.y = -0.42;
      thigh.add(knee);
      const arm = j[`arm${side}`];
      arm.position.set(sx * (fem ? 0.2 : 0.235), 0.37, 0);
      j.spine.add(arm);
      const elbow = j[`elbow${side}`];
      elbow.position.y = -0.27;
      arm.add(elbow);
      const hand = side === 'L' ? this.handL : this.handR;
      hand.position.y = -0.25;
      elbow.add(hand);
    }

    // ---- pelvis + skirt / robe (moves with hips)
    const pelvis: THREE.BufferGeometry[] = [cpart(Sph(1, 14, 10), trousers, { y: -0.02, sx: fem ? 0.2 : 0.19, sy: 0.14, sz: 0.15 })];
    if (robe) {
      pelvis.push(cpart(lathe([[0.17, 0.04], [0.21, -0.2], [0.27, -0.55], [0.31, -0.86], [0.29, -0.88]], 20), tunic, {}));
      pelvis.push(cpart(Tor(0.3, 0.025, 20), accent, { y: -0.84, rx: Math.PI / 2 }));
    } else {
      pelvis.push(cpart(lathe([[0.165, 0.05], [0.19, -0.08], [0.225, -0.24], [0.215, -0.25]], 18, 0.5), tunic, {}));
    }
    this.addMesh(j.hips, pelvis);

    // ---- legs
    for (const side of ['L', 'R'] as const) {
      this.addMesh(j[`thigh${side}`], [cpart(Cap(0.078, 0.26), trousers, { y: -0.2 })]);
      this.addMesh(j[`knee${side}`], [
        cpart(Cap(0.066, 0.24), trousers, { y: -0.17 }),
        // Boot: shaft, cuff, rounded foot and sole
        cpart(Cyl(0.08, 0.072, 0.17, 12), boots, { y: -0.31 }),
        cpart(Tor(0.08, 0.022, 14), shade(boots, 1.25), { y: -0.225, rx: Math.PI / 2 }),
        cpart(Sph(1, 12, 8), boots, { y: -0.41, z: 0.05, sx: 0.078, sy: 0.06, sz: 0.135 }),
        cpart(Cyl(0.075, 0.075, 0.025, 12), '#2e1f14', { y: -0.455, z: 0.05, sz: 1.75 }),
      ]);
    }

    // ---- torso with layered clothing
    const chestW = fem ? 0.17 : 0.2;
    const torso: THREE.BufferGeometry[] = [
      cpart(lathe([[0.15, -0.02], [0.155, 0.1], [chestW, 0.26], [chestW * 0.98, 0.36], [0.12, 0.44], [0.06, 0.46]], 18), tunic, { sz: 0.78 }),
      // Open-front jerkin / shawl layer
      cpart(lathe([[0.168, 0.0], [0.172, 0.1], [chestW + 0.018, 0.26], [chestW + 0.012, 0.37], [0.13, 0.45]], 18, robe ? 0.6 : 1.1), outer, { sz: 0.8 }),
      // Belt, buckle, pouch, collar
      cpart(Tor(0.158, 0.03, 18), PALETTE.leatherDark, { y: 0.0, rx: Math.PI / 2, sz: 0.8 }),
      cpart(new THREE.BoxGeometry(0.07, 0.06, 0.03), accent, { y: 0.0, z: 0.13 }),
      cpart(Sph(1, 10, 8), PALETTE.leather, { x: 0.14, y: -0.04, z: 0.06, sx: 0.055, sy: 0.06, sz: 0.04 }),
      cpart(Tor(0.085, 0.028, 14), robe ? accent : PALETTE.linen, { y: 0.44, rx: Math.PI / 2 }),
    ];
    if (fem) torso.push(cpart(Sph(1, 12, 8), tunic, { y: 0.26, z: 0.08, sx: 0.15, sy: 0.08, sz: 0.07 }));
    if (look.cape) torso.push(cpart(lathe([[0.17, 0.42], [0.22, 0.2], [0.27, -0.25]], 10, Math.PI * 1.2), look.cape, { sz: 0.8 }));
    torso.push(cpart(Cyl(0.06, 0.07, 0.1, 10), skin, { y: 0.47 }));
    this.addMesh(j.spine, torso);

    // ---- arms (sleeve, bracer, hand with thumb)
    for (const [side, sx] of [['L', -1], ['R', 1]] as const) {
      this.addMesh(j[`arm${side}`], [
        cpart(Sph(1, 12, 8), robe ? tunic : outer, { y: 0.02, sx: 0.062, sy: 0.032, sz: 0.06 }),
        cpart(Cap(0.06, 0.18), tunic, { y: -0.13 }),
      ]);
      const sleeveEnd = robe ? tunic : PALETTE.leather;
      this.addMesh(j[`elbow${side}`], [
        cpart(Cap(0.05, 0.16), robe ? tunic : skin, { y: -0.11 }),
        cpart(Cyl(robe ? 0.075 : 0.058, robe ? 0.09 : 0.055, robe ? 0.12 : 0.09, 10), sleeveEnd, { y: robe ? -0.16 : -0.15 }),
        // Hand: palm, curled fingers, thumb
        cpart(Sph(1, 10, 8), skin, { y: -0.245, sx: 0.05, sy: 0.06, sz: 0.042 }),
        cpart(Sph(1, 10, 8), skin, { y: -0.3, z: 0.012, sx: 0.046, sy: 0.034, sz: 0.04 }),
        cpart(Cap(0.017, 0.035, 2, 6), skin, { x: -sx * 0.035, y: -0.245, z: 0.03, rz: sx * 0.6, rx: -0.4 }),
      ]);
    }

    // ---- head
    const R = 0.2;
    const head: THREE.BufferGeometry[] = [
      cpart(new THREE.SphereGeometry(R, 18, 12), skin, { y: R * 0.95, sy: 1.04, sz: 0.96 }),
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
      const crown: [number, number, number][] = [[0.12, 0.3, 0.1], [0.2, 2.2, 0.095], [0.22, 4.0, 0.09], [0.16, 5.4, 0.09], [0.28, 1.2, 0.085], [0.3, 3.1, 0.085]];
      for (const [t, ph, sz] of crown) lock(Math.PI * t, ph, sz, sz * 0.75, sz * 0.8, ph > 3 ? dark : color, 1.02);
      fringe(5, 0.085, 0.35);
      for (const sx of [-1, 1]) out.push(cpart(Sph(1, 10, 8), color, { x: sx * R * 0.95, y: hc + 0.01, z: 0.01, sx: 0.04, sy: 0.08, sz: 0.06 }));
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
    // Rest pose: relaxed arms, soft elbows.
    this.set('armL', 0.05, 0, 0.12);
    this.set('armR', 0.05, 0, -0.12);
    this.set('elbowL', -0.22);
    this.set('elbowR', -0.22);
    let snap = 14;

    if (pose !== 'dead') this.deadT = 0;
    const moving = pose === 'walk' || (pose === 'attack' && speed > 0.5);
    if (moving) {
      this.walkPhase += dt * (3.2 + speed * 1.55);
      const ph = this.walkPhase;
      const s = Math.sin(ph);
      const amp = Math.min(1, 0.45 + speed * 0.13);
      this.set('thighL', -s * 0.62 * amp);
      this.set('thighR', s * 0.62 * amp);
      this.set('kneeL', Math.max(0, Math.sin(ph - 1.3)) * 1.0 * amp + 0.08);
      this.set('kneeR', Math.max(0, Math.sin(ph + Math.PI - 1.3)) * 1.0 * amp + 0.08);
      ht.y = -0.03 + Math.abs(Math.cos(ph)) * 0.045;
      this.set('hips', 0, s * 0.14, 0);
      this.set('spine', 0.07 * amp, -s * 0.2, 0);
      this.set('head', -0.04, s * 0.08, 0);
      if (pose === 'walk') {
        this.set('armL', s * 0.55 * amp, 0, 0.1);
        this.set('armR', -s * 0.55 * amp, 0, -0.1);
        this.set('elbowL', -0.35 - Math.max(0, -s) * 0.45);
        this.set('elbowR', -0.35 - Math.max(0, s) * 0.45);
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
