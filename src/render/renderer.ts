import * as THREE from 'three';
import { lerp } from '../core/math';
import { NPCS, type NpcId } from '../data/npcs';
import { STYLES } from '../sim/combat';
import { SKILL_INFO } from '../data/skills';
import { BANK_COUNTER, groundHeight } from '../sim/worldmap';
import { Enemy, Gravestone, GroundItem, NPC_WALK_SPEED, Npc, ResourceNode, Station, type GameEvent, type GameWorld } from '../sim/world';
import { itemDef, type EquipSlot, type ItemId } from '../data/items';
import { RECIPES } from '../data/recipes';
import { itemIcon } from '../ui/icons';
import { Humanoid, SlimeModel, WolfModel, type HeldTool } from './characters';
import { Markers, Particles, Projectiles } from './effects';
import { WorldOverlay, type Anchor } from './overlay';
import { buildStaticWorld, ResourceView, type StaticWorld } from './props';
import { buildTerrain, buildWater, setWaterQuality } from './terrain';
import { ART } from './art';
import { merge } from './geom';
import { HeroModel, type HeroGear, type HeroLook } from './hero';

export type Quality = 'high' | 'balanced' | 'low';

type EnemyModel = Humanoid | SlimeModel | WolfModel;

interface EnemyView {
  enemy: Enemy;
  model: EnemyModel;
  root: THREE.Group;
  lastHit: number;
}

/** Either the classic blocky rig or the Phase 2A rounded rig; both share one animation contract. */
type CharacterRig = Humanoid | HeroModel;

interface NpcView {
  npc: Npc;
  model: CharacterRig;
}

export type PickResult = { kind: 'entity'; id: number } | { kind: 'ground'; x: number; z: number } | null;

const SKY = '#9fd6ef';

/**
 * Human NPCs converted to the shared hero rig (prototype set). Each keeps the same anatomy and
 * animation as the player; variety comes from age, build, outfit, hair and accessories.
 */
const HERO_NPC_LOOKS: Partial<Record<NpcId, { look: Partial<HeroLook>; tool: HeldTool }>> = {
  elder: { look: { elder: true, age: 'old', eyes: '#5b6fa8', outer: '#d9cba8', accent: '#e3b64a', build: 0.95, height: 0.97 }, tool: 'walkingstaff' },
  guard: { look: { armor: 'guard', helmet: true, beard: true, build: 1.12, height: 1.04, eyes: '#5a3a24', outer: '#5b5f68', accent: '#c9a45c' }, tool: 'spear' },
  // Wendell the banker: cream shirt, bottle-green waistcoat with gold trim, grey hair and beard,
  // spectacles, and an open ledger he writes in between customers.
  banker: { look: { tunic: '#e9dfc6', outer: '#2f5d4a', accent: '#e3b64a', trousers: '#2f2a26', eyes: '#4a5a7a', build: 1.08, height: 0.98, spectacles: true, prop: 'ledger', hairStyle: 0 }, tool: 'none' },
};

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly overlay: WorldOverlay;
  private sun: THREE.DirectionalLight;
  private time = { value: 0 };
  private terrain: THREE.Mesh;
  private water: THREE.Mesh;
  private staticWorld: StaticWorld;
  private resources: ResourceView;
  private particles = new Particles(450);
  private projectiles: Projectiles;
  private markers = new Markers();
  private playerModel: CharacterRig;
  private enemyViews = new Map<number, EnemyView>();
  private npcViews: NpcView[] = [];
  private raycaster = new THREE.Raycaster();
  private camTarget = new THREE.Vector3();
  private emitTimer = 0;
  private quality: Quality = 'balanced';
  private width = 1;
  private height = 1;
  private shakeT = 0;

  /** Camera controls. Rotation is experimental and off by default. */
  camYaw = Math.PI / 4;
  camPitch = 0.92;
  zoom = 1;

  constructor(private canvas: HTMLCanvasElement, overlayParent: HTMLElement, private world: GameWorld) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 40, 85);
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.5, 200);
    this.overlay = new WorldOverlay(overlayParent);

    const hemi = new THREE.HemisphereLight('#dff3ff', '#5d7d3a', 1.35);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight('#fff0d0', 2.1);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(new THREE.AmbientLight('#ffffff', 0.2));

    const map = world.map;
    this.terrain = buildTerrain(map);
    this.scene.add(this.terrain);
    this.water = buildWater(map, this.time);
    this.scene.add(this.water);
    this.staticWorld = buildStaticWorld(map, this.time);
    this.scene.add(this.staticWorld.group);
    this.resources = new ResourceView(map, world.nodes);
    this.scene.add(this.resources.group);
    this.scene.add(this.particles.mesh);
    this.projectiles = new Projectiles(this.particles);
    this.scene.add(this.projectiles.group);
    this.scene.add(this.markers.target, this.markers.tap);

    this.playerModel = this.makePlayerModel();
    this.scene.add(this.playerModel.root);

    for (const npc of world.npcs) {
      const l = NPCS[npc.def.id].look;
      // Phase 2A prototype: Elder Maren is the showcase NPC for the new character style.
      let model: CharacterRig;
      const heroLook = ART.v2 ? HERO_NPC_LOOKS[npc.def.id] : undefined;
      if (heroLook) {
        const hero = new HeroModel({ ...l, ...heroLook.look });
        hero.setTool(heroLook.tool);
        model = hero;
      } else model = new Humanoid({ ...l });
      model.root.position.set(npc.x, groundHeight(map, npc.x, npc.z), npc.z);
      this.scene.add(model.root);
      this.npcViews.push({ npc, model });
    }
    for (const e of world.enemies) this.addEnemyView(e);

    const p = world.player;
    this.camTarget.set(p.x, groundHeight(map, p.x, p.z), p.z);
    this.setQuality('balanced');
  }

  playerLook(): HeroLook {
    const a = this.world.player.appearance;
    return { skin: a.skin, hair: a.hair, hairStyle: a.hairStyle, tunic: a.tunic, trousers: a.trousers, bodyType: a.bodyType, gear: this.playerGear() };
  }

  /** Worn equipment as model gear (tints come from the item definitions). */
  private playerGear(): HeroGear {
    const eq = this.world.player.equipment;
    const tint = (slot: EquipSlot) => {
      const it = eq.get(slot);
      return it ? itemDef(it).equip?.tint : undefined;
    };
    const gear: HeroGear = { head: tint('head'), body: tint('body'), legs: tint('legs') };
    const w = eq.get('weapon');
    if (w) gear.weapon = { kind: itemDef(w).equip?.style === 'ranged' ? 'bow' : w.endsWith('dagger') ? 'dagger' : 'sword', tint: tint('weapon')! };
    const sh = eq.get('shield');
    if (sh) gear.shield = { tint: tint('shield')!, wooden: sh.startsWith('wooden') };
    return gear;
  }

  private gearKey = '';

  /** Rebuild the player model after appearance or worn gear changes. */
  refreshPlayerModel() {
    const old = this.playerModel.root;
    this.scene.remove(old);
    this.playerModel.dispose();
    this.playerModel = this.makePlayerModel();
    this.playerModel.root.position.copy(old.position);
    this.playerModel.root.rotation.y = old.rotation.y;
    this.scene.add(this.playerModel.root);
  }

  private makePlayerModel(): CharacterRig {
    const m = ART.v2 ? new HeroModel(this.playerLook()) : new Humanoid(this.playerLook(), true);
    this.gearKey = gearKey(this.world.player.equipment.toJSON());
    m.enableSilhouette();
    return m;
  }

  private addEnemyView(e: Enemy) {
    const d = e.def;
    let model: EnemyModel;
    if (d.model === 'slime') model = new SlimeModel(d.color, d.accent, d.scale);
    else if (d.model === 'wolf') model = new WolfModel(d.color, d.accent, d.scale);
    else {
      const boss = d.id === 'goblin_warlord';
      model = new Humanoid(
        { skin: d.color, hair: '#222', hairStyle: 4, tunic: boss ? '#5a3a2a' : '#7a5232', trousers: '#4a3326', goblin: true, helmet: boss, cape: boss ? d.accent : undefined },
        true,
      );
      model.setTool(boss ? 'club' : 'spear');
      model.root.scale.setScalar(d.scale);
    }
    const root = new THREE.Group();
    root.add(model.root);
    this.scene.add(root);
    this.enemyViews.set(e.id, { enemy: e, model, root, lastHit: -99 });
  }

  setQuality(q: Quality) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    const ratio = q === 'high' ? Math.min(dpr, 2) : q === 'balanced' ? Math.min(dpr, 1.5) : 1;
    this.renderer.setPixelRatio(ratio);
    if (ART.v2) setWaterQuality(this.water, q === 'low');
    const shadows = q !== 'low';
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    const size = q === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    this.resize(this.width, this.height);
  }

  getQuality() {
    return this.quality;
  }

  resize(w: number, h: number) {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  private cameraDistance(): number {
    const aspect = this.width / this.height;
    const base = 24 * this.zoom;
    return aspect < 1 ? base / Math.pow(aspect, 0.55) : base;
  }

  /** Unit vectors on the ground plane for camera-relative joystick input. */
  cameraBasis() {
    const fx = -Math.sin(this.camYaw);
    const fz = -Math.cos(this.camYaw);
    return { forward: { x: fx, z: fz }, right: { x: -fz, z: fx } };
  }

  shake(amount = 0.25) {
    this.shakeT = Math.max(this.shakeT, amount);
  }

  // ---------------------------------------------------------------- per-frame

  render(dt: number, alpha: number) {
    this.time.value += dt;
    const t = this.time.value;
    const world = this.world;
    const map = world.map;
    const p = world.player;

    // Player
    const px = lerp(p.prevX, p.x, alpha);
    const pz = lerp(p.prevZ, p.z, alpha);
    const py = groundHeight(map, px, pz);
    const pm = this.playerModel;
    pm.root.position.set(px, py, pz);
    const prevYaw = pm.root.rotation.y;
    pm.root.rotation.y = smoothAngle(pm.root.rotation.y, p.facing, dt * 14);
    const gathering = world.isGathering;
    const node = world.gatheringNode;
    let pose: Parameters<Humanoid['update']>[1] = p.anim === 'attack' ? 'attack' : p.anim === 'walk' ? 'walk' : p.anim === 'dead' ? 'dead' : 'idle';
    let tool: HeldTool = p.style === 'melee' ? 'sword' : p.style === 'ranged' ? 'bow' : 'staff';
    if (gathering && node) {
      const sk = node.def.skill;
      pose = sk === 'woodcutting' ? 'chop' : sk === 'fishing' ? 'work' : 'mine';
      tool = sk === 'woodcutting' ? 'axe' : sk === 'fishing' ? 'net' : 'pickaxe';
    }
    const making = world.crafting;
    if (making && p.anim !== 'walk') {
      pose = making.station === 'anvil' ? 'smith' : 'work';
      tool = making.station === 'anvil' ? 'hammer' : making.station === 'fletching' ? 'knife' : 'none';
    }
    pm.style = p.style;
    pm.setTool(tool);
    const speed = Math.hypot(p.x - p.prevX, p.z - p.prevZ) * 30;
    if (pm instanceof HeroModel) {
      pm.setTurnRate(dt > 0 ? angleDelta(prevYaw, pm.root.rotation.y) / dt : 0);
      // Weapon readiness and the bow cycle: raise, draw BEFORE the shot (from the attack timer), release.
      const attacking = p.action?.type === 'attack' && !gathering;
      const ready = attacking || p.swingAge < 2.5 ? 1 : 0;
      let aim = 0;
      let draw = 0;
      if (tool === 'bow' && ready && !p.dead) {
        const target = attacking && p.action?.type === 'attack' ? world.enemyById(p.action.target) : null;
        const inRange = !!target && Math.hypot(target.x - p.x, target.z - p.z) <= STYLES.ranged.range + 0.5;
        aim = inRange || p.swingAge < 1.2 ? 1 : 0;
        draw = inRange ? Math.min(1, Math.max(0, 1 - (p.attackTimer - 0.05) / 0.8)) : 0;
      }
      pm.setCombat(ready, aim, draw);
    }
    pm.update(dt, pose, speed, p.swingAge, t);

    // Enemies
    for (const v of this.enemyViews.values()) {
      const e = v.enemy;
      const ex = lerp(e.prevX, e.x, alpha);
      const ez = lerp(e.prevZ, e.z, alpha);
      const dead = !e.alive;
      const hideAfter = 1.6;
      v.root.visible = !(dead && e.deadAge > hideAfter);
      if (!v.root.visible) continue;
      v.root.position.set(ex, groundHeight(map, ex, ez), ez);
      v.root.rotation.y = smoothAngle(v.root.rotation.y, e.facing, dt * 10);
      if (v.model instanceof Humanoid) {
        v.model.style = 'melee';
        v.model.update(dt, dead ? 'dead' : e.swingAge < 0.45 ? 'attack' : e.moving ? 'walk' : 'idle', e.moving ? e.def.speed : 0, e.swingAge, t + e.id);
      } else {
        v.model.update(dt, e.moving, e.swingAge, dead, e.deadAge, t + e.id * 0.37);
      }
      // Spawn-in pop
      if (!dead && e.respawnTimer <= 0) v.model.root.scale.setScalar(v.model instanceof Humanoid ? e.def.scale : 1);
    }

    // NPCs
    for (const v of this.npcViews) {
      const n = v.npc;
      const nx = lerp(n.prevX, n.x, alpha);
      const nz = lerp(n.prevZ, n.z, alpha);
      v.model.root.position.set(nx, groundHeight(map, nx, nz), nz);
      const prev = v.model.root.rotation.y;
      v.model.root.rotation.y = smoothAngle(prev, n.facing, dt * 12);
      if (v.model instanceof HeroModel) v.model.setTurnRate(dt > 0 ? angleDelta(prev, v.model.root.rotation.y) / dt : 0);
      const npcPose = n.moving ? 'walk' : n.talkAge < 2.5 ? 'talk' : 'idle';
      v.model.update(dt, npcPose, n.moving ? NPC_WALK_SPEED : 0, 99, t + n.id);
    }

    this.resources.update();
    this.updateGroundItems(t);
    this.updateGraves();
    this.updateGlows(t);
    this.updateEmitters(dt, px, pz);
    this.particles.update(dt);
    this.projectiles.update(dt);
    this.markers.update(dt);
    this.updateTargetMarker(t);

    // Camera follow
    const target = new THREE.Vector3(px, py + 0.8, pz);
    this.camTarget.lerp(target, 1 - Math.exp(-dt * 8));
    const d = this.cameraDistance();
    const cx = this.camTarget.x + Math.sin(this.camYaw) * Math.cos(this.camPitch) * d;
    const cz = this.camTarget.z + Math.cos(this.camYaw) * Math.cos(this.camPitch) * d;
    const cy = this.camTarget.y + Math.sin(this.camPitch) * d;
    this.camera.position.set(cx, cy, cz);
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      const s = this.shakeT * 0.5;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
    this.camera.lookAt(this.camTarget);
    const fog = this.scene.fog as THREE.Fog;
    fog.near = d * 1.4;
    fog.far = d * 3.6;

    // Shadow frustum follows the camera target.
    const sr = Math.min(40, d * 0.95);
    const cam = this.sun.shadow.camera;
    if (cam.right !== sr) {
      cam.left = -sr;
      cam.right = sr;
      cam.top = sr;
      cam.bottom = -sr;
      cam.updateProjectionMatrix();
    }
    this.sun.position.set(this.camTarget.x + 14, this.camTarget.y + 26, this.camTarget.z + 8);
    this.sun.target.position.copy(this.camTarget);

    this.renderer.render(this.scene, this.camera);
    this.updateOverlay(dt);
  }

  private updateGlows(t: number) {
    for (const g of this.staticWorld.glows) {
      if (g.kind === 'crystal') {
        g.mesh.position.y = g.baseY + Math.sin(t * 2 + g.phase) * 0.12;
        g.mesh.rotation.y = t * 1.2 + g.phase;
      } else if (g.kind === 'flame') {
        const s = 1 + Math.sin(t * 17) * 0.08 + Math.sin(t * 23) * 0.06;
        g.mesh.scale.set(1 / s, s, 1 / s);
        g.mesh.rotation.y = t * 2;
      } else {
        const s = 1 + Math.sin(t * 9 + g.phase) * 0.06;
        g.mesh.scale.setScalar(s);
      }
    }
  }

  private updateEmitters(dt: number, px: number, pz: number) {
    this.emitTimer += dt;
    if (this.emitTimer < 0.08) return;
    const step = this.emitTimer;
    this.emitTimer = 0;
    for (const e of this.staticWorld.emitters) {
      if (Math.abs(e.x - px) > 28 || Math.abs(e.z - pz) > 28) continue;
      if (e.kind === 'fire') {
        this.particles.emit({ x: e.x, y: e.y, z: e.z, count: 2, color: ['#ffb340', '#ff7a1a', '#fff2a8'], speed: 0.3, up: 1.6, gravity: -0.5, life: 0.9, size: 0.07, spread: 0.4 });
      } else if (e.kind === 'fountain') {
        this.particles.emit({ x: e.x, y: e.y - 0.2, z: e.z, count: 3, color: ['#bff0ff', '#7fd8f0', '#ffffff'], speed: 0.9, up: 2.2, gravity: 7, life: 0.7, size: 0.06 });
      } else if (Math.random() < step * 4) {
        this.particles.emit({ x: e.x, y: e.y, z: e.z, count: 1, color: ['#d8d8d8', '#bfbfbf', '#eeeeee'], speed: 0.15, up: 0.6, gravity: -0.15, life: 3, size: 0.18, drag: 0.5, grow: 1.6 });
      }
    }
    // Floating pollen / fireflies near the player for life.
    if (Math.random() < 0.5) {
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 9;
      const x = px + Math.cos(a) * r;
      const z = pz + Math.sin(a) * r;
      this.particles.emit({ x, y: groundHeight(this.world.map, x, z) + 0.5 + Math.random(), z, count: 1, color: ['#fff6b0', '#e8ff9a', '#ffffff'], speed: 0.2, up: 0.15, gravity: -0.02, life: 3.5, size: 0.05 });
    }
  }

  private selectedId(): number | null {
    const a = this.world.player.action;
    if (!a) return null;
    switch (a.type) {
      case 'attack':
        return a.target;
      case 'gather':
        return a.node;
      case 'pickup':
        return a.ground;
      case 'grave':
        return a.grave;
      case 'station':
        return a.station;
      case 'craft':
        return this.world.player.stationAt;
      case 'talk':
        return a.npc;
    }
  }

  private updateTargetMarker(t: number) {
    const id = this.selectedId();
    if (id === null) {
      this.markers.setTarget(null, '', 1, t);
      return;
    }
    const ent = this.world.get(id);
    const map = this.world.map;
    if (ent instanceof Enemy) {
      const v = this.enemyViews.get(id);
      const pos = v ? v.root.position : new THREE.Vector3(ent.x, groundHeight(map, ent.x, ent.z), ent.z);
      this.markers.setTarget(pos, '#ff4d4d', ent.def.model === 'wolf' ? 1.2 : ent.def.scale * 1.05, t);
    } else if (ent instanceof ResourceNode) {
      this.markers.setTarget(new THREE.Vector3(ent.x, groundHeight(map, ent.x, ent.z), ent.z), '#ffd84d', 1.15, t);
    } else if (ent instanceof Npc) {
      this.markers.setTarget(new THREE.Vector3(ent.x, groundHeight(map, ent.x, ent.z), ent.z), '#5dff8a', 0.9, t);
    } else if (ent instanceof Station) {
      this.markers.setTarget(new THREE.Vector3(ent.x, groundHeight(map, ent.x, ent.z), ent.z), '#ffd84d', 0.85, t);
    } else if (ent instanceof Gravestone) {
      this.markers.setTarget(new THREE.Vector3(ent.x, groundHeight(map, ent.x, ent.z), ent.z), '#ffd84d', 0.7, t);
    } else if (ent instanceof GroundItem) {
      this.markers.setTarget(new THREE.Vector3(ent.x, groundHeight(map, ent.x, ent.z), ent.z), '#ffd84d', 0.55, t);
    }
  }

  // ---------------------------------------------------------------- overlay

  private v = new THREE.Vector3();

  // ---------------------------------------------------------------- ground items

  private groundViews = new Map<number, { pile: GroundItem; sprite: THREE.Sprite; shadow: THREE.Mesh }>();
  private groundMats = new Map<ItemId, THREE.SpriteMaterial>();
  private groundShadowGeo = new THREE.CircleGeometry(0.2, 14).rotateX(-Math.PI / 2);
  private groundShadowMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.22, depthWrite: false });

  private groundMaterial(item: ItemId): THREE.SpriteMaterial {
    let m = this.groundMats.get(item);
    if (!m) {
      const tex = new THREE.TextureLoader().load(itemIcon(item));
      tex.colorSpace = THREE.SRGBColorSpace;
      m = new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.05 });
      this.groundMats.set(item, m);
    }
    return m;
  }

  /** Mirrors the piles this player may see (the simulation decides visibility and timers). */
  private updateGroundItems(t: number) {
    const w = this.world;
    const seen = new Set<number>();
    for (const g of w.visibleGroundItems()) {
      seen.add(g.id);
      let v = this.groundViews.get(g.id);
      if (!v) {
        const sprite = new THREE.Sprite(this.groundMaterial(g.item));
        sprite.scale.setScalar(0.62);
        const shadow = new THREE.Mesh(this.groundShadowGeo, this.groundShadowMat);
        this.scene.add(sprite, shadow);
        v = { pile: g, sprite, shadow };
        this.groundViews.set(g.id, v);
      }
      const y = groundHeight(w.map, g.x, g.z);
      v.sprite.position.set(g.x, y + 0.36 + Math.sin(t * 2.2 + g.id) * 0.04, g.z);
      v.shadow.position.set(g.x, y + 0.03, g.z);
    }
    for (const [id, v] of this.groundViews) {
      if (seen.has(id)) continue;
      this.scene.remove(v.sprite, v.shadow);
      this.overlay.removePlate(id);
      this.groundViews.delete(id);
    }
  }

  // ---------------------------------------------------------------- gravestones

  private graveViews = new Map<number, { grave: Gravestone; root: THREE.Group }>();
  private graveGeo: THREE.BufferGeometry | null = null;
  private graveMat = new THREE.MeshLambertMaterial({ color: '#9aa0a6' });

  private makeGrave(): THREE.Group {
    if (!this.graveGeo) {
      const slab = new THREE.BoxGeometry(0.5, 0.55, 0.14).translate(0, 0.3, 0);
      const top = new THREE.CylinderGeometry(0.25, 0.25, 0.14, 16, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 0.575, 0);
      const base = new THREE.BoxGeometry(0.66, 0.08, 0.3).translate(0, 0.04, 0);
      this.graveGeo = merge([slab.toNonIndexed(), top.toNonIndexed(), base.toNonIndexed()]);
      slab.dispose();
      top.dispose();
      base.dispose();
    }
    const g = new THREE.Group();
    const m = new THREE.Mesh(this.graveGeo, this.graveMat);
    m.castShadow = true;
    g.add(m);
    return g;
  }

  /** Mirrors the player's gravestones (the simulation owns their contents and timers). */
  private updateGraves() {
    const w = this.world;
    const seen = new Set<number>();
    for (const g of w.graves) {
      if (g.expired) continue;
      seen.add(g.id);
      let v = this.graveViews.get(g.id);
      if (!v) {
        v = { grave: g, root: this.makeGrave() };
        v.root.position.set(g.x, groundHeight(w.map, g.x, g.z), g.z);
        v.root.rotation.y = (g.id % 7) * 0.4;
        this.scene.add(v.root);
        this.graveViews.set(g.id, v);
      }
    }
    for (const [id, v] of this.graveViews) {
      if (seen.has(id)) continue;
      this.scene.remove(v.root);
      this.overlay.removePlate(id);
      this.graveViews.delete(id);
    }
  }

  project(x: number, y: number, z: number): Anchor {
    this.v.set(x, y, z).project(this.camera);
    const visible = this.v.z < 1 && Math.abs(this.v.x) < 1.2 && Math.abs(this.v.y) < 1.2;
    const rect = this.canvas.getBoundingClientRect();
    return { x: (this.v.x * 0.5 + 0.5) * rect.width, y: (-this.v.y * 0.5 + 0.5) * rect.height, visible };
  }

  entityAnchor(id: number): Anchor | null {
    const map = this.world.map;
    const p = this.world.player;
    if (id === p.id) {
      const r = this.playerModel.root.position;
      return this.project(r.x, r.y + 2.1, r.z);
    }
    const v = this.enemyViews.get(id);
    if (v) {
      const r = v.root.position;
      return this.project(r.x, r.y + enemyHeight(v.enemy), r.z);
    }
    const e = this.world.get(id);
    if (e instanceof Npc) return this.project(e.x, groundHeight(map, e.x, e.z) + 2.2, e.z);
    if (e instanceof ResourceNode) return this.project(e.x, this.resources.anchorHeight(e), e.z);
    return null;
  }

  private updateOverlay(dt: number) {
    const w = this.world;
    this.overlay.root.style.visibility = w.player.dead ? 'hidden' : '';
    const sel = this.selectedId();
    for (const v of this.enemyViews.values()) {
      const e = v.enemy;
      const engaged = e.alive && (e.id === sel || e.state === 'chase' || e.hp < e.def.maxHp);
      const r = v.root.position;
      const a = e.alive && v.root.visible ? this.project(r.x, r.y + enemyHeight(e), r.z) : null;
      const near = Math.hypot(e.x - w.player.x, e.z - w.player.z) < 9;
      this.overlay.plate(e.id, a, { name: e.def.name, level: e.def.level, hp: engaged ? e.hp : null, maxHp: e.def.maxHp, kind: 'enemy', show: engaged || near || e.id === sel });
    }
    for (const st of w.stations) {
      const near = Math.hypot(st.x - w.player.x, st.z - w.player.z) < 6;
      const a = near ? this.project(st.x, groundHeight(w.map, st.x, st.z) + 1.6, st.z) : null;
      this.overlay.plate(st.id, a, { name: st.name, kind: 'npc', show: near });
    }
    for (const v of this.groundViews.values()) {
      const g = v.pile;
      const near = Math.hypot(g.x - w.player.x, g.z - w.player.z) < 5;
      const a = near ? this.project(g.x, v.sprite.position.y + 0.45, g.z) : null;
      this.overlay.plate(g.id, a, { name: g.qty > 1 ? `${itemDef(g.item).name} × ${g.qty}` : itemDef(g.item).name, kind: 'npc', show: near });
    }
    for (const v of this.graveViews.values()) {
      const g = v.grave;
      const near = Math.hypot(g.x - w.player.x, g.z - w.player.z) < 14;
      const a = near ? this.project(g.x, v.root.position.y + 1.0, g.z) : null;
      const left = Math.ceil(g.secondsLeft);
      this.overlay.plate(g.id, a, { name: `Your gravestone · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, kind: 'npc', show: near });
    }
    for (const v of this.npcViews) {
      const n = v.npc;
      const a = this.project(n.x, groundHeight(w.map, n.x, n.z) + 2.25, n.z);
      const near = Math.hypot(n.x - w.player.x, n.z - w.player.z) < 14;
      this.overlay.plate(n.id, a, { name: n.def.service === 'bank' ? `${n.def.name} · Bank` : n.def.name, kind: 'npc', show: near, marker: w.npcMarker(n.def.id) });
    }
    this.overlay.update(dt);
  }

  // ---------------------------------------------------------------- events

  handleEvent(e: GameEvent) {
    const w = this.world;
    const p = w.player;
    switch (e.type) {
      case 'craft': {
        // Visual feedback for each make: sparks at the anvil, a flare at the furnace, steam when
        // cooking, wood shavings when fletching (dark smoke if the food burned).
        const st = p.stationAt !== null ? w.get(p.stationAt) : null;
        const at = st instanceof Station ? { x: st.x, z: st.z } : { x: p.x + Math.sin(p.facing) * 0.4, z: p.z + Math.cos(p.facing) * 0.4 };
        const y = groundHeight(w.map, at.x, at.z);
        const rec = RECIPES[e.recipe];
        const kind = rec?.station ?? 'fletching';
        if (!e.success) this.particles.emit({ x: at.x, y: y + 1.0, z: at.z, count: 10, color: ['#3a3330', '#5a524c'], speed: 0.6, up: 1.2, gravity: -0.3, life: 1.2, size: 0.14 });
        else if (kind === 'anvil') this.particles.emit({ x: at.x, y: y + 0.65, z: at.z, count: 16, color: ['#ffd27a', '#ff9a3a', '#fff3c4'], speed: 3, up: 2.4, life: 0.5, size: 0.05 });
        else if (kind === 'furnace') this.particles.emit({ x: at.x, y: y + 0.6, z: at.z, count: 14, color: ['#ff8a2a', '#ffd27a', '#ff5a2a'], speed: 1.2, up: 1.8, gravity: -0.5, life: 0.7, size: 0.09 });
        else if (kind === 'range' || kind === 'fire') this.particles.emit({ x: at.x, y: y + 1.0, z: at.z, count: 10, color: ['#ffffff', '#e8eef2'], speed: 0.4, up: 1.0, gravity: -0.4, life: 1.1, size: 0.12 });
        else this.particles.emit({ x: at.x, y: y + 1.0, z: at.z, count: 10, color: ['#c9a06a', '#8a6238', '#e6c48f'], speed: 1.2, up: 1.2, life: 0.6, size: 0.05 });
        break;
      }
      case 'equipment': {
        const key = gearKey(p.equipment.toJSON());
        if (ART.v2 && key !== this.gearKey) this.refreshPlayerModel();
        break;
      }
      case 'damage': {
        const isPlayer = e.target === p.id;
        const anchor = () => this.entityAnchor(e.target);
        if (e.hit && e.amount > 0) {
          this.overlay.float(String(e.amount), isPlayer ? 'dmg-taken' : 'dmg-dealt', anchor, 1.0, 45);
        } else {
          this.overlay.float('miss', 'dmg-miss', anchor, 0.9, 35);
        }
        if (isPlayer) {
          if (e.amount > 0) {
            this.playerModel.hitFlash();
            this.shake(Math.min(0.35, 0.1 + e.amount / 60));
          }
        } else {
          const v = this.enemyViews.get(e.target);
          if (v && e.amount > 0) {
            v.model.hitFlash();
            const r = v.root.position;
            this.particles.emit({ x: r.x, y: r.y + 0.6, z: r.z, count: 6, color: v.enemy.def.model === 'slime' ? ['#8cf07a', '#c8ffb8'] : ['#ff5a4a', '#ffd0c0', '#ffffff'], speed: 2, up: 2, life: 0.4, size: 0.08 });
          }
        }
        break;
      }
      case 'projectile': {
        const from = this.playerModel.root.position.clone().add(new THREE.Vector3(Math.sin(p.facing) * 0.4, 1.2, Math.cos(p.facing) * 0.4));
        // Arrows leave from the bow, spells from the wand tip, when the new rig holds one.
        if (e.style !== 'melee' && this.playerModel instanceof HeroModel) this.playerModel.projectileOrigin(from);
        const view = this.enemyViews.get(e.target);
        const getTo = () => (view ? view.root.position.clone().add(new THREE.Vector3(0, enemyHeight(view.enemy) * 0.45, 0)) : from);
        this.projectiles.spawn(e.style === 'magic' ? 'magic' : 'arrow', from, getTo, e.flight);
        if (e.style === 'magic') this.particles.emit({ x: from.x, y: from.y, z: from.z, count: 8, color: ['#c9b6ff', '#ffffff'], speed: 1, up: 1, gravity: 0, life: 0.4, size: 0.07 });
        break;
      }
      case 'attack': {
        if (e.source === p.id && p.style === 'melee') {
          const v = this.enemyViews.get(e.target);
          if (v) {
            const r = v.root.position;
            setTimeout(() => this.particles.emit({ x: r.x, y: r.y + 0.7, z: r.z, count: 5, color: ['#ffffff', '#fff2a8'], speed: 3, up: 1, gravity: 2, life: 0.25, size: 0.06 }), 200);
          }
        }
        break;
      }
      case 'gather': {
        const n = w.get(e.node);
        if (!(n instanceof ResourceNode)) break;
        const y = groundHeight(w.map, n.x, n.z);
        const tree = n.def.skill === 'woodcutting';
        this.particles.emit({
          x: (n.x + p.x) / 2,
          y: y + (tree ? 0.9 : 0.5),
          z: (n.z + p.z) / 2,
          count: e.success ? 10 : 5,
          color: tree ? ['#e6c48f', '#b07a45', '#7bcf54'] : ['#d8d8d8', '#9a948a', n.def.id === 'copper_rock' ? '#ef8a3d' : n.def.id === 'iron_rock' ? '#b8503a' : '#e3ebf2'],
          speed: 2.4,
          up: 2.6,
          life: 0.6,
          size: tree ? 0.08 : 0.07,
        });
        if (!tree) this.particles.emit({ x: (n.x + p.x) / 2, y: y + 0.6, z: (n.z + p.z) / 2, count: 4, color: ['#fff2a8', '#ffffff'], speed: 3, up: 2, life: 0.25, size: 0.04 });
        break;
      }
      case 'nodeDepleted': {
        const n = w.get(e.node);
        if (!(n instanceof ResourceNode)) break;
        const y = groundHeight(w.map, n.x, n.z);
        const tree = n.def.skill === 'woodcutting';
        this.particles.emit({ x: n.x, y: y + (tree ? 1.8 : 0.5), z: n.z, count: 26, color: tree ? ['#56b947', '#83d457', '#3f8f3a'] : ['#9a948a', '#c4bcae'], speed: 2.8, up: 2.5, life: 0.9, size: 0.12, spread: 1 });
        break;
      }
      case 'nodeRespawned': {
        const n = w.get(e.node);
        if (!(n instanceof ResourceNode)) break;
        const y = groundHeight(w.map, n.x, n.z);
        this.particles.emit({ x: n.x, y: y + 0.5, z: n.z, count: 10, color: ['#ffffff', '#e8ff9a'], speed: 1.2, up: 1.5, gravity: 1, life: 0.7, size: 0.06, spread: 0.6 });
        break;
      }
      case 'death': {
        const v = this.enemyViews.get(e.id);
        if (v) {
          const r = v.root.position;
          this.particles.emit({ x: r.x, y: r.y + 0.5, z: r.z, count: 24, color: v.enemy.def.model === 'slime' ? ['#62d65a', '#c8ffb8'] : ['#ffffff', '#d8d8d8', '#fff2a8'], speed: 2.5, up: 2.5, gravity: 4, life: 0.8, size: 0.1, spread: 0.6 });
        }
        if (e.id === p.id) this.shake(0.5);
        break;
      }
      case 'respawn': {
        if (e.id === p.id) {
          const r = new THREE.Vector3(p.x, groundHeight(w.map, p.x, p.z), p.z);
          this.camTarget.set(r.x, r.y + 0.8, r.z);
          this.particles.emit({ x: r.x, y: r.y + 1, z: r.z, count: 40, color: ['#7ff0ff', '#ffffff', '#bff8ff'], speed: 2, up: 3, gravity: 2, life: 1.2, size: 0.09, spread: 0.6 });
        } else {
          const v = this.enemyViews.get(e.id);
          if (v) {
            const r = v.root.position;
            v.root.position.set(v.enemy.x, groundHeight(w.map, v.enemy.x, v.enemy.z), v.enemy.z);
            this.particles.emit({ x: r.x, y: r.y + 0.4, z: r.z, count: 12, color: ['#ffffff', '#d0d0ff'], speed: 1.5, up: 1.5, gravity: 1, life: 0.6, size: 0.08, spread: 0.5 });
          }
        }
        break;
      }
      case 'levelUp': {
        const r = this.playerModel.root.position;
        const c = SKILL_INFO[e.skill].color;
        this.particles.emit({ x: r.x, y: r.y + 1, z: r.z, count: 60, color: [c, '#ffd84d', '#ffffff'], speed: 3, up: 5, gravity: 6, life: 1.4, size: 0.1, spread: 0.4 });
        this.overlay.float(`${SKILL_INFO[e.skill].name} ${e.level}!`, 'levelup', () => this.entityAnchor(p.id), 2.2, 70);
        break;
      }
      case 'heal': {
        this.overlay.float(`+${e.amount}`, 'heal', () => this.entityAnchor(p.id), 1.1, 45);
        const r = this.playerModel.root.position;
        this.particles.emit({ x: r.x, y: r.y + 1, z: r.z, count: 14, color: ['#7dff8a', '#ffffff'], speed: 0.8, up: 2, gravity: -0.5, life: 0.9, size: 0.07, spread: 0.6 });
        break;
      }
      case 'checkpoint': {
        const c = w.map.checkpoints.find((c) => c.id === e.id);
        if (c) this.particles.emit({ x: c.x, y: groundHeight(w.map, c.x, c.z) + 2, z: c.z, count: 40, color: ['#7ff0ff', '#ffffff'], speed: 2, up: 3, gravity: 2, life: 1.2, size: 0.09 });
        break;
      }
    }
  }

  showTapMarker(x: number, z: number) {
    this.markers.showTap(new THREE.Vector3(x, groundHeight(this.world.map, x, z), z));
  }

  // ---------------------------------------------------------------- picking

  /** Screen-space forgiving pick: nearest interactable within a finger radius, else ground. */
  pick(clientX: number, clientY: number): PickResult {
    const rect = this.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const w = this.world;
    const radius = Math.max(34, Math.min(rect.width, rect.height) * 0.07);
    let best: number | null = null;
    let bestD = radius;
    const consider = (id: number, x: number, y: number, z: number, bias = 1) => {
      const a = this.project(x, y, z);
      if (!a.visible) return;
      const d = Math.hypot(a.x - sx, a.y - sy) * bias;
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    };
    const map = w.map;
    for (const v of this.enemyViews.values()) {
      if (!v.enemy.alive) continue;
      const r = v.root.position;
      const h = enemyHeight(v.enemy);
      consider(v.enemy.id, r.x, r.y + h * 0.45, r.z, 0.8);
      consider(v.enemy.id, r.x, r.y + 0.1, r.z, 0.9);
    }
    for (const n of w.npcs) {
      const y = groundHeight(map, n.x, n.z);
      consider(n.id, n.x, y + 1, n.z);
      // Tapping the bank counter means the banker behind it.
      if (n.def.service === 'bank') consider(n.id, BANK_COUNTER.x, y + 0.95, BANK_COUNTER.z, 0.9);
    }
    for (const n of w.nodes) {
      if (Math.abs(n.x - w.player.x) > 30 || Math.abs(n.z - w.player.z) > 30) continue;
      const y = groundHeight(map, n.x, n.z);
      const tree = n.def.skill === 'woodcutting';
      consider(n.id, n.x, y + (n.depleted ? 0.2 : tree ? 1.2 : 0.4), n.z, 1.1);
      if (tree && !n.depleted) consider(n.id, n.x, y + 2.2, n.z, 1.2);
    }
    for (const v of this.groundViews.values()) {
      const p = v.sprite.position;
      consider(v.pile.id, p.x, p.y, p.z, 0.85);
    }
    for (const v of this.graveViews.values()) {
      const p = v.root.position;
      consider(v.grave.id, p.x, p.y + 0.4, p.z, 0.85);
    }
    for (const st of w.stations) {
      if (Math.abs(st.x - w.player.x) > 30 || Math.abs(st.z - w.player.z) > 30) continue;
      consider(st.id, st.x, groundHeight(map, st.x, st.z) + 0.6, st.z, 0.95);
    }
    if (best !== null) return { kind: 'entity', id: best };

    const ndc = new THREE.Vector2((sx / rect.width) * 2 - 1, -(sy / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.terrain, false);
    if (hits.length > 0) return { kind: 'ground', x: hits[0].point.x, z: hits[0].point.z };
    return null;
  }
}

function enemyHeight(e: Enemy): number {
  if (e.def.model === 'slime') return 1.1 * e.def.scale;
  if (e.def.model === 'wolf') return 1.25 * e.def.scale;
  return 2.0 * e.def.scale;
}

function smoothAngle(current: number, target: number, k: number): number {
  let d = (target - current) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return current + d * Math.min(1, k);
}

function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Worn gear that changes the model (the ammo slot doesn't show, and its count changes every shot). */
function gearKey(worn: Partial<Record<EquipSlot, ItemId>>): string {
  const { ammo: _ammo, ...shown } = worn;
  return JSON.stringify(shown);
}
