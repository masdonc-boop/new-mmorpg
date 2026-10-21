import * as THREE from 'three';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  gravity: number;
  drag: number;
  color: THREE.Color;
  grow: number;
}

/** Instanced cube particles: wood chips, sparks, magic, smoke, level-up confetti. */
export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private list: Particle[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();

  constructor(private max = 400) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, new THREE.Color());
  }

  emit(opts: {
    x: number;
    y: number;
    z: number;
    count: number;
    color: string | string[];
    speed?: number;
    up?: number;
    life?: number;
    size?: number;
    gravity?: number;
    spread?: number;
    drag?: number;
    grow?: number;
  }) {
    const cols = Array.isArray(opts.color) ? opts.color : [opts.color];
    for (let i = 0; i < opts.count; i++) {
      if (this.list.length >= this.max) this.list.shift();
      const a = Math.random() * Math.PI * 2;
      const sp = (opts.speed ?? 2) * (0.4 + Math.random() * 0.6);
      const spread = opts.spread ?? 0.1;
      const life = (opts.life ?? 0.7) * (0.7 + Math.random() * 0.6);
      this.list.push({
        x: opts.x + (Math.random() - 0.5) * spread,
        y: opts.y + (Math.random() - 0.5) * spread,
        z: opts.z + (Math.random() - 0.5) * spread,
        vx: Math.cos(a) * sp,
        vy: (opts.up ?? 2) * (0.5 + Math.random() * 0.8),
        vz: Math.sin(a) * sp,
        life,
        max: life,
        size: (opts.size ?? 0.08) * (0.7 + Math.random() * 0.6),
        gravity: opts.gravity ?? 9,
        drag: opts.drag ?? 0,
        color: new THREE.Color(cols[Math.floor(Math.random() * cols.length)]),
        grow: opts.grow ?? 0,
      });
    }
  }

  update(dt: number) {
    let n = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.list.splice(i, 1);
        continue;
      }
      p.vy -= p.gravity * dt;
      const d = 1 - Math.min(1, p.drag * dt);
      p.vx *= d;
      p.vz *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const t = p.life / p.max;
      const s = p.size * (p.grow ? 1 + (1 - t) * p.grow : Math.min(1, t * 2.5));
      this.e.set(p.life * 7, p.life * 5, 0);
      this.q.setFromEuler(this.e);
      this.m.compose(new THREE.Vector3(p.x, p.y, p.z), this.q, new THREE.Vector3(s, s, s));
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(n, p.color);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

interface Projectile {
  obj: THREE.Object3D;
  from: THREE.Vector3;
  getTo: () => THREE.Vector3;
  t: number;
  dur: number;
  kind: 'arrow' | 'magic';
  arc: number;
}

export class Projectiles {
  readonly group = new THREE.Group();
  private list: Projectile[] = [];
  private arrowGeo: THREE.BufferGeometry;
  private arrowMat = new THREE.MeshLambertMaterial({ color: '#d9b47a' });
  private orbGeo = new THREE.IcosahedronGeometry(0.16, 1);
  private orbMat = new THREE.MeshBasicMaterial({ color: '#b9a3ff' });
  private haloMat = new THREE.MeshBasicMaterial({ color: '#7a5cff', transparent: true, opacity: 0.35, depthWrite: false });

  private tipGeo: THREE.BufferGeometry;

  constructor(private particles: Particles) {
    const shaft = new THREE.BoxGeometry(0.03, 0.03, 0.6);
    const tip = new THREE.ConeGeometry(0.05, 0.12, 4);
    tip.rotateX(Math.PI / 2);
    tip.translate(0, 0, 0.35);
    this.arrowGeo = shaft;
    this.tipGeo = tip;
  }

  spawn(kind: 'arrow' | 'magic', from: THREE.Vector3, getTo: () => THREE.Vector3, dur: number) {
    let obj: THREE.Object3D;
    if (kind === 'arrow') {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(this.arrowGeo, this.arrowMat));
      g.add(new THREE.Mesh(this.tipGeo, new THREE.MeshLambertMaterial({ color: '#9aa0a8' })));
      const fl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.12), new THREE.MeshLambertMaterial({ color: '#f2f2f2' }));
      fl.position.z = -0.26;
      g.add(fl);
      obj = g;
    } else {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(this.orbGeo, this.orbMat));
      const halo = new THREE.Mesh(this.orbGeo, this.haloMat);
      halo.scale.setScalar(1.9);
      g.add(halo);
      obj = g;
    }
    obj.position.copy(from);
    this.group.add(obj);
    this.list.push({ obj, from: from.clone(), getTo, t: 0, dur, kind, arc: kind === 'arrow' ? 0.5 : 0.15 });
  }

  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      const k = Math.min(1, p.t / p.dur);
      const to = p.getTo();
      const prev = p.obj.position.clone();
      p.obj.position.lerpVectors(p.from, to, k);
      p.obj.position.y += Math.sin(k * Math.PI) * p.arc;
      if (p.kind === 'arrow') p.obj.lookAt(p.obj.position.clone().add(p.obj.position.clone().sub(prev)));
      else {
        p.obj.rotation.y += dt * 8;
        this.particles.emit({ x: p.obj.position.x, y: p.obj.position.y, z: p.obj.position.z, count: 2, color: ['#c9b6ff', '#7a5cff', '#ffffff'], speed: 0.4, up: 0.3, gravity: 0, life: 0.35, size: 0.07 });
      }
      if (k >= 1) {
        this.group.remove(p.obj);
        this.list.splice(i, 1);
        if (p.kind === 'magic') this.particles.emit({ x: to.x, y: to.y, z: to.z, count: 14, color: ['#c9b6ff', '#7a5cff', '#ffffff'], speed: 2.5, up: 1.5, gravity: 2, life: 0.5, size: 0.09 });
      }
    }
  }
}

/** Pulsing ring under the selected target, and a fading tap marker. */
export class Markers {
  readonly target: THREE.Mesh;
  readonly tap: THREE.Mesh;
  private tapAge = 99;
  private targetMat = new THREE.MeshBasicMaterial({ color: '#ff5050', transparent: true, opacity: 0.85, depthWrite: false });
  private tapMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false });

  constructor() {
    const ring = new THREE.RingGeometry(0.5, 0.62, 28);
    ring.rotateX(-Math.PI / 2);
    this.target = new THREE.Mesh(ring, this.targetMat);
    this.target.visible = false;
    this.target.renderOrder = 2;
    const tapRing = new THREE.RingGeometry(0.22, 0.32, 20);
    tapRing.rotateX(-Math.PI / 2);
    this.tap = new THREE.Mesh(tapRing, this.tapMat);
    this.tap.visible = false;
    this.tap.renderOrder = 2;
  }

  setTarget(pos: THREE.Vector3 | null, color: string, radius: number, time: number) {
    if (!pos) {
      this.target.visible = false;
      return;
    }
    this.target.visible = true;
    this.target.position.set(pos.x, pos.y + 0.06, pos.z);
    this.targetMat.color.set(color);
    const pulse = 1 + Math.sin(time * 6) * 0.06;
    this.target.scale.setScalar(radius * pulse);
    this.target.rotation.y = time * 0.8;
  }

  showTap(pos: THREE.Vector3) {
    this.tapAge = 0;
    this.tap.position.set(pos.x, pos.y + 0.06, pos.z);
    this.tap.visible = true;
  }

  update(dt: number) {
    this.tapAge += dt;
    if (this.tapAge < 0.6) {
      const k = this.tapAge / 0.6;
      this.tap.scale.setScalar(1 + k * 1.2);
      this.tapMat.opacity = 0.9 * (1 - k);
    } else this.tap.visible = false;
  }
}
