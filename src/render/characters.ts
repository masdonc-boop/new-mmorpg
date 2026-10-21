import * as THREE from 'three';
import type { CombatStyle } from '../sim/combat';

/** Small cache so many characters share materials of the same colour. */
const matCache = new Map<string, THREE.MeshLambertMaterial>();
export function mat(color: string, unique = false): THREE.MeshLambertMaterial {
  if (unique) return new THREE.MeshLambertMaterial({ color, flatShading: true });
  let m = matCache.get(color);
  if (!m) matCache.set(color, (m = new THREE.MeshLambertMaterial({ color, flatShading: true })));
  return m;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}

export interface HumanoidLook {
  skin: string;
  hair: string;
  hairStyle: number;
  tunic: string;
  trousers: string;
  bodyType?: 0 | 1;
  robe?: boolean;
  beard?: boolean;
  goblin?: boolean;
  helmet?: boolean;
  cape?: string;
}

export type HeldTool = 'none' | 'sword' | 'bow' | 'staff' | 'axe' | 'pickaxe' | 'spear' | 'club' | 'walkingstaff' | 'hammer' | 'knife' | 'net';

/** 'smith' = hammering at an anvil; 'work' = hands-forward work (furnace, cooking, fletching). */
export type HumanoidPose = 'idle' | 'walk' | 'attack' | 'chop' | 'mine' | 'dead' | 'talk' | 'smith' | 'work';

/**
 * Chunky, readable low-poly humanoid with procedural animation.
 * Used for the player, NPCs and goblins.
 */
export class Humanoid {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private handR = new THREE.Group();
  private handL = new THREE.Group();
  private tools = new Map<HeldTool, THREE.Object3D>();
  private materials: THREE.MeshLambertMaterial[] = [];
  private walkPhase = 0;
  private flash = 0;
  private deadT = 0;
  private held: HeldTool = 'none';
  style: CombatStyle = 'melee';

  constructor(public look: HumanoidLook, uniqueMaterials = false) {
    const m = (c: string) => {
      const mm = mat(c, uniqueMaterials);
      if (uniqueMaterials) this.materials.push(mm);
      return mm;
    };
    const fem = look.bodyType === 1;
    const goblin = !!look.goblin;
    const skin = m(look.skin);
    const tunic = m(look.tunic);
    const trousers = m(look.trousers);
    const boots = m('#4a3326');
    const belt = m('#6b4528');

    this.root.add(this.body);
    // Legs (pivot at hip)
    for (const [leg, sx] of [[this.legL, -1], [this.legR, 1]] as const) {
      leg.position.set(sx * (fem ? 0.12 : 0.13), 0.72, 0);
      leg.add(mesh(box(0.2, 0.5, 0.22), trousers, 0, -0.25, 0));
      leg.add(mesh(box(0.23, 0.2, 0.3), boots, 0, -0.6, 0.04));
      this.body.add(leg);
    }
    // Hips & torso
    this.body.add(mesh(box(fem ? 0.48 : 0.44, 0.22, 0.28), trousers, 0, 0.78, 0));
    const torso = mesh(box(fem ? 0.46 : 0.54, 0.5, 0.3), tunic, 0, 1.1, 0);
    this.body.add(torso);
    this.body.add(mesh(box(fem ? 0.48 : 0.56, 0.08, 0.32), belt, 0, 0.88, 0));
    this.body.add(mesh(box(0.08, 0.08, 0.04), m('#e8c45a'), 0, 0.88, 0.17));
    if (look.robe) {
      const robe = new THREE.CylinderGeometry(0.28, 0.42, 0.75, 8);
      this.body.add(mesh(robe, tunic, 0, 0.5, 0));
      this.body.add(mesh(box(0.1, 0.5, 0.02), m('#e8c45a'), 0, 1.05, 0.16));
    }
    if (look.cape) {
      const cape = mesh(box(0.5, 0.85, 0.05), m(look.cape), 0, 0.85, -0.2);
      cape.rotation.x = 0.12;
      this.body.add(cape);
    }
    // Arms (pivot at shoulder)
    for (const [arm, sx] of [[this.armL, -1], [this.armR, 1]] as const) {
      arm.position.set(sx * (fem ? 0.3 : 0.35), 1.3, 0);
      arm.add(mesh(box(0.16, 0.3, 0.18), tunic, 0, -0.13, 0));
      arm.add(mesh(box(0.14, 0.22, 0.15), skin, 0, -0.38, 0));
      const hand = sx < 0 ? this.handL : this.handR;
      hand.position.set(0, -0.5, 0.02);
      hand.add(mesh(box(0.15, 0.13, 0.15), skin));
      arm.add(hand);
      this.body.add(arm);
    }
    // Head
    this.head.position.set(0, 1.38, 0);
    const headSize = goblin ? 0.42 : 0.44;
    this.head.add(mesh(box(headSize, headSize, headSize * 0.95), skin, 0, headSize / 2, 0));
    const eyeM = m('#2a1f1a');
    const eyeY = headSize * 0.52;
    for (const sx of [-1, 1]) {
      this.head.add(mesh(box(0.06, goblin ? 0.05 : 0.08, 0.02), goblin ? m('#ffd23f') : eyeM, sx * 0.1, eyeY, headSize * 0.48));
      if (!goblin) this.head.add(mesh(box(0.025, 0.025, 0.01), m('#ffffff'), sx * 0.1 + 0.012, eyeY + 0.02, headSize * 0.49 + 0.005));
    }
    this.head.add(mesh(box(0.06, 0.08, 0.06), skin, 0, eyeY - 0.07, headSize * 0.5));
    this.head.add(mesh(box(0.12, 0.03, 0.01), m('#9b4a3a'), 0, eyeY - 0.15, headSize * 0.48));
    if (goblin) {
      for (const sx of [-1, 1]) {
        const ear = mesh(new THREE.ConeGeometry(0.08, 0.32, 4), skin, sx * 0.28, headSize * 0.6, 0);
        ear.rotation.z = -sx * 1.2;
        this.head.add(ear);
      }
      this.head.add(mesh(box(0.05, 0.06, 0.02), m('#f3ead8'), -0.06, eyeY - 0.17, headSize * 0.49));
      this.head.add(mesh(box(0.05, 0.06, 0.02), m('#f3ead8'), 0.07, eyeY - 0.17, headSize * 0.49));
    } else {
      this.buildHair(m(look.hair), headSize);
    }
    if (look.beard) this.head.add(mesh(box(0.38, 0.2, 0.12), m(look.hair), 0, 0.1, headSize * 0.45));
    if (look.helmet) {
      this.head.add(mesh(new THREE.CylinderGeometry(0.27, 0.3, 0.2, 8), m('#7b7f88'), 0, headSize + 0.02, 0));
      for (const sx of [-1, 1]) {
        const horn = mesh(new THREE.ConeGeometry(0.06, 0.35, 5), m('#efe3c4'), sx * 0.26, headSize + 0.15, 0);
        horn.rotation.z = -sx * 0.7;
        this.head.add(horn);
      }
    }
    this.body.add(this.head);
    this.buildTools();
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
  }

  private buildHair(hm: THREE.Material, s: number) {
    const style = this.look.hairStyle % 5;
    if (style === 4) return; // bald
    this.head.add(mesh(box(s + 0.04, 0.12, s * 0.95 + 0.04), hm, 0, s + 0.02, 0));
    this.head.add(mesh(box(s + 0.04, s * 0.5, 0.08), hm, 0, s * 0.78, -s * 0.48));
    if (style === 0) {
      this.head.add(mesh(box(0.08, 0.16, s * 0.9), hm, -s / 2 - 0.01, s * 0.82, 0));
      this.head.add(mesh(box(0.08, 0.16, s * 0.9), hm, s / 2 + 0.01, s * 0.82, 0));
    } else if (style === 1) {
      for (let i = 0; i < 5; i++) {
        const tuft = mesh(box(0.12, 0.14, 0.12), hm, -0.16 + i * 0.08, s + 0.1, 0.08 - (i % 2) * 0.12);
        tuft.rotation.z = (i - 2) * 0.2;
        this.head.add(tuft);
      }
      this.head.add(mesh(box(s + 0.02, 0.1, 0.08), hm, 0, s - 0.02, s * 0.46));
    } else if (style === 2) {
      this.head.add(mesh(box(s + 0.06, s * 0.95, 0.1), hm, 0, s * 0.45, -s * 0.5));
      this.head.add(mesh(box(0.08, s * 0.8, s * 0.7), hm, -s / 2 - 0.02, s * 0.55, -0.04));
      this.head.add(mesh(box(0.08, s * 0.8, s * 0.7), hm, s / 2 + 0.02, s * 0.55, -0.04));
    } else if (style === 3) {
      this.head.add(mesh(new THREE.IcosahedronGeometry(0.13, 0), hm, 0, s * 0.85, -s * 0.62));
      this.head.add(mesh(box(s + 0.02, 0.1, 0.08), hm, 0, s - 0.03, s * 0.46));
    }
  }

  private buildTools() {
    const wood = mat('#8b5e34');
    const metal = mat('#c9ced6');
    const bronze = mat('#c98a4b');
    const sword = new THREE.Group();
    sword.add(mesh(box(0.06, 0.18, 0.06), mat('#5b3a22'), 0, 0, 0));
    sword.add(mesh(box(0.26, 0.05, 0.08), bronze, 0, 0.1, 0));
    sword.add(mesh(box(0.08, 0.65, 0.03), metal, 0, 0.45, 0));
    sword.rotation.x = Math.PI / 2;
    this.tools.set('sword', sword);

    const bow = new THREE.Group();
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 4, 10, Math.PI * 0.9), wood);
    arc.rotation.z = Math.PI / 2 + Math.PI * 0.05;
    bow.add(arc);
    const string = mesh(box(0.01, 0.8, 0.01), mat('#f2f2f2'), 0, 0, 0);
    bow.add(string);
    bow.rotation.y = Math.PI / 2;
    bow.rotation.x = Math.PI / 2;
    this.tools.set('bow', bow);

    const staff = new THREE.Group();
    staff.add(mesh(new THREE.CylinderGeometry(0.03, 0.04, 1.3, 5), mat('#6b4528'), 0, 0.3, 0));
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), new THREE.MeshBasicMaterial({ color: '#a98bff' }));
    orb.position.y = 1.0;
    staff.add(orb);
    staff.rotation.x = Math.PI / 2;
    this.tools.set('staff', staff);

    const axe = new THREE.Group();
    axe.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 5), wood, 0, 0.25, 0));
    axe.add(mesh(box(0.05, 0.2, 0.22), bronze, 0, 0.52, 0.1));
    axe.rotation.x = Math.PI / 2;
    this.tools.set('axe', axe);

    const pick = new THREE.Group();
    pick.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 5), wood, 0, 0.25, 0));
    const head = mesh(box(0.05, 0.06, 0.55), bronze, 0, 0.55, 0);
    pick.add(head);
    pick.rotation.x = Math.PI / 2;
    this.tools.set('pickaxe', pick);

    const spear = new THREE.Group();
    spear.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.3, 5), wood, 0, 0.3, 0));
    spear.add(mesh(new THREE.ConeGeometry(0.06, 0.22, 4), mat('#9aa0a8'), 0, 1.05, 0));
    spear.rotation.x = Math.PI / 2;
    this.tools.set('spear', spear);

    const club = new THREE.Group();
    club.add(mesh(new THREE.CylinderGeometry(0.1, 0.04, 0.8, 6), mat('#6e4a2c'), 0, 0.3, 0));
    for (let i = 0; i < 3; i++) club.add(mesh(new THREE.ConeGeometry(0.03, 0.1, 4), mat('#d8d0bc'), Math.cos(i * 2) * 0.09, 0.55, Math.sin(i * 2) * 0.09));
    club.rotation.x = Math.PI / 2;
    this.tools.set('club', club);

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

  /**
   * Animate one frame.
   * @param swingAge seconds since the last attack started
   * @param speed horizontal speed in tiles/s
   */
  update(dt: number, pose: HumanoidPose, speed: number, swingAge: number, time: number) {
    const b = this.body;
    // Reset
    this.armL.rotation.set(0, 0, 0.08);
    this.armR.rotation.set(0, 0, -0.08);
    this.legL.rotation.set(0, 0, 0);
    this.legR.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    b.rotation.set(0, 0, 0);
    b.position.set(0, 0, 0);

    if (pose !== 'dead') this.deadT = 0;

    if (pose === 'walk' || (pose === 'attack' && speed > 0.5)) {
      this.walkPhase += dt * (4 + speed * 2.2);
      const s = Math.sin(this.walkPhase);
      this.legL.rotation.x = s * 0.7;
      this.legR.rotation.x = -s * 0.7;
      if (pose === 'walk') {
        this.armL.rotation.x = -s * 0.6;
        this.armR.rotation.x = s * 0.6;
      }
      b.position.y = Math.abs(Math.cos(this.walkPhase)) * 0.06;
      b.rotation.x = 0.06;
    } else if (pose !== 'dead') {
      const br = Math.sin(time * 2.2);
      b.position.y = br * 0.012;
      this.armL.rotation.z = 0.1 + br * 0.03;
      this.armR.rotation.z = -0.1 - br * 0.03;
      this.head.rotation.y = Math.sin(time * 0.6) * 0.15;
    }

    if (pose === 'attack') {
      const t = Math.min(1, swingAge / 0.42);
      if (this.style === 'melee') {
        // Wind up then slash down and across.
        const wind = t < 0.35 ? t / 0.35 : 1 - (t - 0.35) / 0.65;
        this.armR.rotation.x = t < 0.35 ? -2.6 * wind : -2.6 + (t - 0.35) / 0.65 * 3.1;
        this.armR.rotation.z = -0.3;
        b.rotation.y = t < 0.35 ? 0.35 * wind : 0.35 - ((t - 0.35) / 0.65) * 0.7;
        this.legL.rotation.x = -0.35;
        this.legR.rotation.x = 0.25;
      } else if (this.style === 'ranged') {
        this.armL.rotation.x = -1.55;
        this.armL.rotation.y = 0.1;
        const draw = t < 0.6 ? t / 0.6 : 0;
        this.armR.rotation.x = -1.55 + draw * 0.1;
        this.armR.rotation.y = -0.3 - draw * 0.9;
        b.rotation.y = -0.25;
      } else {
        const raise = Math.sin(Math.min(1, t * 1.3) * Math.PI);
        this.armR.rotation.x = -1.2 - raise * 1.0;
        this.armL.rotation.x = -1.0 - raise * 0.5;
        this.armL.rotation.z = 0.4;
        b.position.y += raise * 0.05;
      }
    } else if (pose === 'work') {
      this.armR.rotation.x = -0.9 + Math.sin(time * 3) * 0.12;
      this.armL.rotation.x = -0.9 - Math.sin(time * 3) * 0.12;
    } else if (pose === 'chop' || pose === 'mine' || pose === 'smith') {
      const cycle = (time * 1.25) % 1;
      const up = cycle < 0.6 ? cycle / 0.6 : 1 - (cycle - 0.6) / 0.4;
      const ease = up * up * (3 - 2 * up);
      this.armR.rotation.x = -0.3 - ease * 2.4;
      this.armL.rotation.x = -0.3 - ease * 2.2;
      this.armL.rotation.z = -0.25;
      this.armR.rotation.z = 0.25;
      b.rotation.x = 0.15 - ease * 0.2;
      this.legL.rotation.x = -0.25;
      this.legR.rotation.x = 0.2;
    } else if (pose === 'talk') {
      this.armR.rotation.x = -0.6 + Math.sin(time * 5) * 0.2;
      this.armR.rotation.z = -0.4;
    } else if (pose === 'dead') {
      this.deadT = Math.min(1, this.deadT + dt * 2.2);
      const e = 1 - Math.pow(1 - this.deadT, 3);
      b.rotation.x = -e * 1.5;
      b.position.y = e * 0.12;
      b.position.z = -e * 0.4;
      this.armL.rotation.z = 0.8 * e;
      this.armR.rotation.z = -0.8 * e;
    }

    if (this.flash > 0) {
      this.flash -= dt;
      b.rotation.x -= 0.15;
    }
    for (const mm of this.materials) mm.emissive.setRGB(this.flash > 0 ? 0.8 : 0, this.flash > 0 ? 0.15 : 0, this.flash > 0 ? 0.1 : 0);
  }

  /**
   * Adds an occlusion silhouette: drawn only where scenery hides the character,
   * so the player never gets lost behind trees or houses.
   */
  enableSilhouette(color = '#3b5bdb') {
    const ghost = new THREE.MeshBasicMaterial({ color, depthFunc: THREE.GreaterDepth, depthWrite: false });
    const meshes: THREE.Mesh[] = [];
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    for (const m of meshes) {
      m.renderOrder = 2;
      const g = new THREE.Mesh(m.geometry, ghost);
      g.renderOrder = 1;
      g.castShadow = false;
      g.userData.ghost = true;
      m.add(g);
    }
  }

  dispose() {
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !o.userData.ghost) (o as THREE.Mesh).geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
  }
}

/** Squishy slime: bounces when moving, wobbles when idle. */
export class SlimeModel {
  readonly root = new THREE.Group();
  private body: THREE.Mesh;
  private inner = new THREE.Group();
  private material: THREE.MeshLambertMaterial;
  private flash = 0;
  private hop = 0;

  constructor(color: string, accent: string, scale = 1) {
    this.material = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.88, flatShading: true });
    const geo = new THREE.SphereGeometry(0.42, 10, 7);
    geo.translate(0, 0.42, 0);
    this.body = new THREE.Mesh(geo, this.material);
    this.body.castShadow = true;
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), new THREE.MeshBasicMaterial({ color: accent }));
    shine.position.set(-0.16, 0.66, 0.22);
    const eyeW = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const eyeB = new THREE.MeshBasicMaterial({ color: '#1d2a1a' });
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), eyeW);
      w.position.set(sx * 0.14, 0.5, 0.34);
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 4), eyeB);
      p.position.set(sx * 0.14, 0.5, 0.42);
      this.inner.add(w, p);
    }
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), new THREE.MeshLambertMaterial({ color: accent }));
    core.position.y = 0.3;
    this.inner.add(shine, core);
    this.root.add(this.body, this.inner);
    this.root.scale.setScalar(scale);
  }

  hitFlash() {
    this.flash = 0.18;
  }

  update(dt: number, moving: boolean, swingAge: number, dead: boolean, deadAge: number, time: number) {
    if (dead) {
      const e = Math.min(1, deadAge * 2.5);
      this.body.scale.set(1 + e * 0.6, Math.max(0.05, 1 - e), 1 + e * 0.6);
      this.inner.scale.setScalar(Math.max(0.01, 1 - e));
      this.material.opacity = 0.88 * (1 - e * 0.7);
      return;
    }
    this.material.opacity = 0.88;
    this.inner.scale.setScalar(1);
    let sy = 1 + Math.sin(time * 3) * 0.04;
    let y = 0;
    if (moving) {
      this.hop += dt * 6;
      const h = Math.abs(Math.sin(this.hop));
      y = h * 0.35;
      sy = 0.85 + h * 0.3;
    }
    if (swingAge < 0.4) {
      const t = swingAge / 0.4;
      y += Math.sin(t * Math.PI) * 0.4;
      sy = 1 + Math.sin(t * Math.PI) * 0.25;
    }
    const sxz = 1 / Math.sqrt(sy);
    this.body.scale.set(sxz, sy, sxz);
    this.body.position.y = y;
    this.inner.position.y = y + (sy - 1) * 0.4;
    if (this.flash > 0) this.flash -= dt;
    this.material.emissive.setRGB(this.flash > 0 ? 0.7 : 0, this.flash > 0 ? 0.2 : 0, this.flash > 0 ? 0.2 : 0);
  }
}

/** Four-legged wolf with trotting gait and lunging bite. */
export class WolfModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private legs: THREE.Group[] = [];
  private tail = new THREE.Group();
  private mats: THREE.MeshLambertMaterial[] = [];
  private phase = 0;
  private flash = 0;

  constructor(color: string, accent: string, scale = 1) {
    const fur = new THREE.MeshLambertMaterial({ color, flatShading: true });
    const belly = new THREE.MeshLambertMaterial({ color: accent, flatShading: true });
    const dark = new THREE.MeshLambertMaterial({ color: '#3a3a40', flatShading: true });
    this.mats.push(fur, belly);
    this.body.position.y = 0.62;
    this.body.add(mesh(box(0.42, 0.4, 0.95), fur, 0, 0, 0));
    this.body.add(mesh(box(0.46, 0.46, 0.4), fur, 0, 0.04, 0.32));
    this.body.add(mesh(box(0.34, 0.15, 0.7), belly, 0, -0.2, 0.05));
    this.head.position.set(0, 0.18, 0.6);
    this.head.add(mesh(box(0.34, 0.32, 0.34), fur, 0, 0, 0));
    this.head.add(mesh(box(0.2, 0.16, 0.28), belly, 0, -0.06, 0.26));
    this.head.add(mesh(box(0.08, 0.06, 0.06), dark, 0, -0.01, 0.41));
    for (const sx of [-1, 1]) {
      const ear = mesh(new THREE.ConeGeometry(0.07, 0.18, 4), fur, sx * 0.11, 0.22, -0.05);
      this.head.add(ear);
      this.head.add(mesh(box(0.06, 0.04, 0.02), new THREE.MeshBasicMaterial({ color: '#ffd23f' }), sx * 0.09, 0.06, 0.175));
    }
    this.body.add(this.head);
    this.tail.position.set(0, 0.1, -0.48);
    const tailMesh = mesh(box(0.12, 0.12, 0.5), fur, 0, 0, -0.22);
    this.tail.add(tailMesh);
    this.tail.rotation.x = 0.6;
    this.body.add(this.tail);
    for (const [x, z] of [[-0.14, 0.32], [0.14, 0.32], [-0.14, -0.32], [0.14, -0.32]]) {
      const leg = new THREE.Group();
      leg.position.set(x, 0.42, z);
      leg.add(mesh(box(0.12, 0.42, 0.13), fur, 0, -0.21, 0));
      leg.add(mesh(box(0.13, 0.06, 0.16), dark, 0, -0.41, 0.02));
      this.legs.push(leg);
      this.root.add(leg);
    }
    this.root.add(this.body);
    this.root.scale.setScalar(scale);
  }

  hitFlash() {
    this.flash = 0.18;
  }

  update(dt: number, moving: boolean, swingAge: number, dead: boolean, deadAge: number, time: number) {
    if (dead) {
      const e = Math.min(1, deadAge * 2.5);
      this.root.rotation.z = e * 1.4;
      this.root.position.y = e * 0.1;
      return;
    }
    this.root.rotation.z = 0;
    this.body.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    this.head.position.z = 0.6;
    if (moving) {
      this.phase += dt * 11;
      const s = Math.sin(this.phase);
      this.legs[0].rotation.x = s * 0.7;
      this.legs[3].rotation.x = s * 0.7;
      this.legs[1].rotation.x = -s * 0.7;
      this.legs[2].rotation.x = -s * 0.7;
      this.body.position.y = 0.62 + Math.abs(Math.cos(this.phase)) * 0.05;
    } else {
      for (const l of this.legs) l.rotation.x = 0;
      this.body.position.y = 0.62 + Math.sin(time * 2) * 0.01;
      this.head.rotation.x = Math.sin(time * 0.8) * 0.1;
    }
    this.tail.rotation.y = Math.sin(time * (moving ? 10 : 3)) * 0.4;
    if (swingAge < 0.35) {
      const t = Math.sin((swingAge / 0.35) * Math.PI);
      this.head.position.z = 0.6 + t * 0.25;
      this.head.rotation.x = -t * 0.3;
      this.body.rotation.x = t * 0.12;
    }
    if (this.flash > 0) this.flash -= dt;
    for (const m of this.mats) m.emissive.setRGB(this.flash > 0 ? 0.7 : 0, this.flash > 0 ? 0.15 : 0, this.flash > 0 ? 0.1 : 0);
  }
}
