import * as THREE from 'three';
import { bakeRigidParts, bakedMaterial } from './bake';

/**
 * Eastreach creatures (Phase 4A, docs/WORLD_EXPANSION.md). Like the slime and the wolf, each is a
 * handful of flat-shaded boxes with the same small interface, so they cost about the same to draw.
 */

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}

/** The common shape of the beast models: hit flash, and one update per frame. */
export interface BeastModel {
  readonly root: THREE.Group;
  hitFlash(): void;
  update(dt: number, moving: boolean, swingAge: number, dead: boolean, deadAge: number, time: number): void;
}

function flashMats(mats: THREE.MeshLambertMaterial[], flash: number) {
  for (const m of mats) m.emissive.setRGB(flash > 0 ? 0.7 : 0, flash > 0 ? 0.15 : 0, flash > 0 ? 0.1 : 0);
}

/** Bog croaker (and the Bog Mother): a squat giant toad that hops, puffs its throat and lunges. */
export class ToadModel implements BeastModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private throat: THREE.Mesh;
  private legs: THREE.Group[] = [];
  private mats: THREE.MeshLambertMaterial[] = [];
  private flash = 0;
  private hop = 0;

  constructor(color: string, accent: string, scale = 1) {
    const skin = new THREE.MeshLambertMaterial({ color, flatShading: true });
    const belly = new THREE.MeshLambertMaterial({ color: accent, flatShading: true });
    const wart = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.7), flatShading: true });
    this.mats.push(skin, belly);
    this.body.position.y = 0.32;
    this.body.add(mesh(box(0.78, 0.42, 0.8), skin, 0, 0.05, 0));
    this.body.add(mesh(box(0.66, 0.16, 0.66), belly, 0, -0.16, 0.04));
    // Broad flat head with bulging eyes on top.
    this.body.add(mesh(box(0.7, 0.26, 0.36), skin, 0, 0.12, 0.42));
    const eyeW = new THREE.MeshBasicMaterial({ color: '#e8d84a' });
    const eyeB = new THREE.MeshBasicMaterial({ color: '#1a1a12' });
    for (const sx of [-1, 1]) {
      this.body.add(mesh(box(0.18, 0.16, 0.18), skin, sx * 0.24, 0.3, 0.42));
      this.body.add(mesh(box(0.12, 0.1, 0.04), eyeW, sx * 0.24, 0.32, 0.52));
      this.body.add(mesh(box(0.1, 0.03, 0.03), eyeB, sx * 0.24, 0.32, 0.545));
    }
    for (const [x, z] of [[-0.22, -0.1], [0.18, -0.25], [0.05, 0.12], [-0.08, -0.32]]) this.body.add(mesh(box(0.09, 0.06, 0.09), wart, x, 0.28, z));
    this.throat = mesh(box(0.36, 0.18, 0.2), belly, 0, -0.04, 0.58);
    this.body.add(this.throat);
    // Folded back legs and small front legs.
    for (const [x, z, back] of [[-0.42, -0.2, 1], [0.42, -0.2, 1], [-0.28, 0.32, 0], [0.28, 0.32, 0]] as const) {
      const leg = new THREE.Group();
      leg.position.set(x, 0.18, z);
      leg.add(mesh(back ? box(0.2, 0.22, 0.46) : box(0.1, 0.22, 0.1), skin, 0, -0.06, back ? -0.04 : 0));
      leg.add(mesh(box(back ? 0.24 : 0.16, 0.05, back ? 0.3 : 0.18), belly, 0, -0.16, back ? 0.1 : 0.04));
      this.legs.push(leg);
      this.root.add(leg);
    }
    this.root.add(this.body);
    this.root.scale.setScalar(scale);
    const baked = bakedMaterial(true);
    this.mats.push(baked);
    // The throat puffs on its own, so it stays separate.
    bakeRigidParts(this.root, baked, new Set([this.throat]));
  }

  hitFlash() {
    this.flash = 0.18;
  }

  update(dt: number, moving: boolean, swingAge: number, dead: boolean, deadAge: number, time: number) {
    if (dead) {
      const e = Math.min(1, deadAge * 2.5);
      this.root.rotation.z = e * Math.PI * 0.9;
      this.root.position.y = e * 0.35;
      return;
    }
    this.root.rotation.z = 0;
    this.root.position.y = 0;
    let y = 0;
    let pitch = 0;
    if (moving) {
      // Hops: up and forward, back legs kicking out.
      this.hop += dt * 5;
      const h = Math.max(0, Math.sin(this.hop));
      y = h * 0.4;
      pitch = -h * 0.3;
      this.legs[0].rotation.x = this.legs[1].rotation.x = -h * 0.9;
    } else {
      this.legs[0].rotation.x = this.legs[1].rotation.x = 0;
    }
    // The throat puffs while it sits (the croak), and the whole body lunges to bite.
    const puff = moving ? 1 : 1 + Math.max(0, Math.sin(time * 1.7)) * 0.6;
    this.throat.scale.set(puff, puff, 1);
    let z = 0;
    if (swingAge < 0.4) {
      const t = Math.sin((swingAge / 0.4) * Math.PI);
      z = t * 0.3;
      y += t * 0.15;
      pitch -= t * 0.2;
    }
    this.body.position.set(0, 0.32 + y, z);
    this.body.rotation.x = pitch;
    for (const l of this.legs) l.position.y = 0.18 + y;
    if (this.flash > 0) this.flash -= dt;
    flashMats(this.mats, this.flash);
  }
}

/** Mire leech: a long ringed body that ripples along the ground and rears up to strike. */
export class LeechModel implements BeastModel {
  readonly root = new THREE.Group();
  private segs: THREE.Mesh[] = [];
  private mats: THREE.MeshLambertMaterial[] = [];
  private flash = 0;
  private phase = 0;

  constructor(color: string, accent: string, scale = 1) {
    const skin = new THREE.MeshLambertMaterial({ color, flatShading: true });
    const band = new THREE.MeshLambertMaterial({ color: accent, flatShading: true });
    this.mats.push(skin, band);
    const n = 7;
    for (let i = 0; i < n; i++) {
      // Thickest in the middle, tapering to the mouth (front, +z) and the tail.
      const k = 1 - Math.abs(i - n * 0.55) / n;
      const w = 0.2 + k * 0.22;
      const seg = mesh(box(w, w * 0.7, 0.24), i % 2 ? band : skin, 0, 0, 0);
      this.segs.push(seg);
      this.root.add(seg);
    }
    // A round sucker mouth with a ring of pale teeth.
    const mouth = mesh(box(0.16, 0.16, 0.06), new THREE.MeshLambertMaterial({ color: '#2a1a14', flatShading: true }), 0, 0, 0.14);
    this.segs[n - 1].add(mouth);
    this.segs[n - 1].add(mesh(box(0.2, 0.04, 0.04), new THREE.MeshBasicMaterial({ color: '#e8dcc8' }), 0, 0.09, 0.13));
    this.root.scale.setScalar(scale);
    this.layout(0, 0);
  }

  /** Places the segments along the body: a ripple travelling down it, and a rear for strikes. */
  private layout(ripple: number, rear: number) {
    const n = this.segs.length;
    this.segs.forEach((s, i) => {
      const t = i / (n - 1);
      const z = (t - 0.55) * 1.5;
      const lift = Math.max(0, t - 0.6) / 0.4;
      s.position.set(Math.sin(ripple + i * 0.9) * 0.08, 0.14 + Math.abs(Math.sin(ripple * 0.5 + i * 0.7)) * 0.04 + lift * lift * rear * 0.6, z - lift * rear * 0.2);
      s.rotation.x = -lift * rear * 0.8;
    });
  }

  hitFlash() {
    this.flash = 0.18;
  }

  update(dt: number, moving: boolean, swingAge: number, dead: boolean, deadAge: number, time: number) {
    if (dead) {
      const e = Math.min(1, deadAge * 2);
      this.root.scale.y = Math.max(0.2, 1 - e * 0.8);
      return;
    }
    this.root.scale.y = this.root.scale.x;
    this.phase += dt * (moving ? 8 : 1.5);
    const rear = swingAge < 0.45 ? Math.sin((swingAge / 0.45) * Math.PI) : 0.15 + Math.sin(time * 1.2) * 0.1;
    this.layout(this.phase, rear);
    if (this.flash > 0) this.flash -= dt;
    flashMats(this.mats, this.flash);
  }
}

/** Bristleback boar: a stocky body, a ridge of bristles, short legs and upturned tusks. */
export class BoarModel implements BeastModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private legs: THREE.Group[] = [];
  private mats: THREE.MeshLambertMaterial[] = [];
  private phase = 0;
  private flash = 0;

  constructor(color: string, accent: string, scale = 1) {
    const hide = new THREE.MeshLambertMaterial({ color, flatShading: true });
    const dark = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.6), flatShading: true });
    const tusk = new THREE.MeshLambertMaterial({ color: accent, flatShading: true });
    this.mats.push(hide, dark);
    this.body.position.y = 0.5;
    this.body.add(mesh(box(0.56, 0.5, 0.95), hide, 0, 0, 0));
    this.body.add(mesh(box(0.6, 0.56, 0.42), hide, 0, 0.04, 0.24));
    // Bristle ridge along the spine.
    for (let i = 0; i < 4; i++) this.body.add(mesh(box(0.1, 0.14, 0.18), dark, 0, 0.3, 0.32 - i * 0.2));
    this.head.position.set(0, 0.02, 0.55);
    this.head.add(mesh(box(0.42, 0.38, 0.36), hide, 0, 0, 0.06));
    this.head.add(mesh(box(0.26, 0.2, 0.18), dark, 0, -0.06, 0.3));
    this.head.add(mesh(box(0.18, 0.12, 0.04), new THREE.MeshLambertMaterial({ color: '#c88a7a', flatShading: true }), 0, -0.06, 0.4));
    for (const sx of [-1, 1]) {
      const t = mesh(box(0.05, 0.16, 0.05), tusk, sx * 0.12, 0.02, 0.36);
      t.rotation.x = -0.5;
      this.head.add(t);
      this.head.add(mesh(box(0.1, 0.12, 0.05), dark, sx * 0.17, 0.22, -0.04));
      this.head.add(mesh(box(0.05, 0.04, 0.02), new THREE.MeshBasicMaterial({ color: '#1a120c' }), sx * 0.13, 0.08, 0.25));
    }
    this.body.add(this.head);
    for (const [x, z] of [[-0.17, 0.3], [0.17, 0.3], [-0.17, -0.3], [0.17, -0.3]]) {
      const leg = new THREE.Group();
      leg.position.set(x, 0.3, z);
      leg.add(mesh(box(0.13, 0.3, 0.14), hide, 0, -0.15, 0));
      leg.add(mesh(box(0.14, 0.06, 0.15), dark, 0, -0.29, 0.01));
      this.legs.push(leg);
      this.root.add(leg);
    }
    const tail = mesh(box(0.05, 0.05, 0.18), dark, 0, 0.12, -0.55);
    tail.rotation.x = 0.7;
    this.body.add(tail);
    this.root.add(this.body);
    this.root.scale.setScalar(scale);
    const baked = bakedMaterial(true);
    this.mats.push(baked);
    bakeRigidParts(this.root, baked);
  }

  hitFlash() {
    this.flash = 0.18;
  }

  update(dt: number, moving: boolean, swingAge: number, dead: boolean, deadAge: number, time: number) {
    if (dead) {
      const e = Math.min(1, deadAge * 2.5);
      this.root.rotation.z = e * 1.5;
      this.root.position.y = e * 0.08;
      return;
    }
    this.root.rotation.z = 0;
    this.root.position.y = 0;
    this.head.rotation.set(0, 0, 0);
    this.head.position.z = 0.55;
    if (moving) {
      this.phase += dt * 13;
      const s = Math.sin(this.phase);
      this.legs[0].rotation.x = this.legs[3].rotation.x = s * 0.6;
      this.legs[1].rotation.x = this.legs[2].rotation.x = -s * 0.6;
      this.body.position.y = 0.5 + Math.abs(Math.cos(this.phase)) * 0.04;
    } else {
      for (const l of this.legs) l.rotation.x = 0;
      this.body.position.y = 0.5;
      // Rooting about: the snout dips now and then.
      this.head.rotation.x = Math.max(0, Math.sin(time * 0.9)) * 0.35;
    }
    if (swingAge < 0.35) {
      // A tusk-hook: head down, then up and forward.
      const t = Math.sin((swingAge / 0.35) * Math.PI);
      this.head.position.z = 0.55 + t * 0.2;
      this.head.rotation.x = -t * 0.5;
    }
    if (this.flash > 0) this.flash -= dt;
    flashMats(this.mats, this.flash);
  }
}
