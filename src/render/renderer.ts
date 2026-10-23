import * as THREE from 'three';
import { lerp } from '../core/math';
import { NPCS, type NpcId } from '../data/npcs';
import { STYLES } from '../sim/combat';
import { SKILL_INFO } from '../data/skills';
import { BANK_COUNTER, EXCHANGE, groundHeight, inHollow } from '../sim/worldmap';
import { dungeonAt } from '../sim/dungeonmap';
import { Doorway, Enemy, FarmPatch, Gravestone, GroundItem, Hotspot, NPC_WALK_SPEED, Npc, Obstacle, ResourceNode, Station, type Appearance, type GameEvent, type GameWorld, type Player } from '../sim/world';
import type { Equipment } from '../sim/equipment';
import { itemDef, type EquipSlot, type ItemId } from '../data/items';
import { RECIPES } from '../data/recipes';
import { CROSS_SPEED } from '../data/agility';
import { itemIcon } from '../ui/icons';
import { Humanoid, SlimeModel, WolfModel, type HeldTool } from './characters';
import { BoarModel, LeechModel, ToadModel } from './creatures';
import { Markers, Particles, Projectiles } from './effects';
import { WorldOverlay, type Anchor } from './overlay';
import { buildStaticWorld, campfireGeometry, exchangePrefab, furniturePrefab, houseShellPrefab, obstaclePrefab, patchPrefab, ResourceView, type StaticWorld } from './props';
import { HOUSE, furnitureDef } from '../data/construction';
import { buildTerrain, buildWater, setWaterQuality } from './terrain';
import { PerfMonitor } from './perf';
import { DUNGEONS } from '../data/dungeons';
import { ART } from './art';
import { makeWorldMaterial, merge } from './geom';
import { HeroModel, type HeroGear, type HeroLook } from './hero';

export type Quality = 'high' | 'balanced' | 'low';

type EnemyModel = Humanoid | SlimeModel | WolfModel | ToadModel | LeechModel | BoarModel;

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
  private hemi: THREE.HemisphereLight;
  private ambient: THREE.AmbientLight;
  /** The glowcap lantern's light, carried with the player underground. */
  private lantern = new THREE.PointLight('#d8ffb8', 0, 11, 1.4);
  /** 0 on the surface, 1 deep in Glimmer Hollow (eases between). */
  private darkK = 0;
  private skyColor = new THREE.Color(SKY);
  private caveColor = new THREE.Color('#040506');
  private time = { value: 0 };
  private terrain: THREE.Group;
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
    this.perf = new PerfMonitor(this.renderer);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 40, 85);
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.5, 200);
    this.overlay = new WorldOverlay(overlayParent);

    const hemi = new THREE.HemisphereLight('#dff3ff', '#5d7d3a', 1.35);
    this.hemi = hemi;
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight('#fff0d0', 2.1);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.ambient = new THREE.AmbientLight('#ffffff', 0.2);
    this.scene.add(this.ambient, this.lantern);

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

  playerLook(a: Appearance = this.world.player.appearance, eq: Equipment = this.world.player.equipment): HeroLook {
    return { skin: a.skin, hair: a.hair, hairStyle: a.hairStyle, tunic: a.tunic, trousers: a.trousers, bodyType: a.bodyType, gear: this.playerGear(eq) };
  }

  /** Worn equipment as model gear (tints come from the item definitions). */
  private playerGear(eq: Equipment): HeroGear {
    const tint = (slot: EquipSlot) => {
      const it = eq.get(slot);
      return it ? itemDef(it).equip?.tint : undefined;
    };
    const gear: HeroGear = { head: tint('head'), body: tint('body'), legs: tint('legs') };
    const w = eq.get('weapon');
    if (w) {
      const style = itemDef(w).equip?.style;
      gear.weapon = { kind: style === 'ranged' ? 'bow' : style === 'magic' ? 'wand' : w.endsWith('dagger') ? 'dagger' : w.endsWith('warhammer') ? 'warhammer' : 'sword', tint: tint('weapon')! };
    }
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

  // ---------------------------------------------------------------- other players (network play)

  private otherViews = new Map<number, { player: Player; model: CharacterRig; look: string }>();

  /**
   * Other players near you, drawn with the same character models as your own, in their own looks
   * and worn gear. Their positions are already interpolated by the network client; their pose comes
   * from what the server says they are doing.
   */
  private updateOtherPlayers(dt: number, t: number) {
    const w = this.world;
    const map = w.map;
    for (const q of w.players.values()) {
      if (q === w.player) continue;
      const look = JSON.stringify([q.appearance, gearKey(q.equipment.toJSON())]);
      let v = this.otherViews.get(q.id);
      if (!v || v.look !== look) {
        if (v) {
          this.scene.remove(v.model.root);
          v.model.dispose();
        }
        const lk = this.playerLook(q.appearance, q.equipment);
        const model = ART.v2 ? new HeroModel(lk) : new Humanoid(lk, true);
        model.root.position.set(q.x, groundHeight(map, q.x, q.z), q.z);
        this.scene.add(model.root);
        v = { player: q, model, look };
        this.otherViews.set(q.id, v);
      }
      v.player = q;
      const m = v.model;
      const prevX = m.root.position.x;
      const prevZ = m.root.position.z;
      m.root.position.set(q.x, groundHeight(map, q.x, q.z), q.z);
      const prevYaw = m.root.rotation.y;
      m.root.rotation.y = smoothAngle(prevYaw, q.facing, dt * 14);
      const r = q.remote;
      let pose: Parameters<Humanoid['update']>[1] = q.dead ? 'dead' : q.swingAge < 0.5 ? 'attack' : q.moving ? 'walk' : 'idle';
      let tool: HeldTool = q.style === 'melee' ? 'sword' : q.style === 'ranged' ? 'bow' : 'staff';
      if (!q.dead && !q.moving && r?.act === 'gather' && r.skill) {
        pose = r.skill === 'woodcutting' ? 'chop' : r.skill === 'mining' ? 'mine' : 'work';
        tool = r.skill === 'woodcutting' ? 'axe' : r.skill === 'mining' ? 'pickaxe' : r.skill === 'fishing' ? 'net' : 'none';
      } else if (!q.dead && !q.moving && (r?.act === 'craft' || r?.act === 'farm' || r?.act === 'build')) pose = r.act === 'build' ? 'smith' : 'work';
      m.style = q.style;
      m.setTool(tool);
      if (m instanceof HeroModel) {
        m.setTurnRate(dt > 0 ? angleDelta(prevYaw, m.root.rotation.y) / dt : 0);
        m.setCombat(r?.act === 'attack' || q.swingAge < 2.5 ? 1 : 0, 0, 0);
      }
      const speed = dt > 0 ? Math.hypot(q.x - prevX, q.z - prevZ) / dt : 0;
      m.update(dt, pose, speed, q.swingAge, t + q.id);
    }
    for (const [id, v] of this.otherViews) {
      if (w.players.get(id) === v.player && v.player !== w.player) continue;
      this.scene.remove(v.model.root);
      v.model.dispose();
      this.overlay.removePlate(id);
      this.otherViews.delete(id);
    }
  }

  private addEnemyView(e: Enemy) {
    const d = e.def;
    let model: EnemyModel;
    if (d.model === 'slime') model = new SlimeModel(d.color, d.accent, d.scale);
    else if (d.model === 'wolf') model = new WolfModel(d.color, d.accent, d.scale);
    else if (d.model === 'toad') model = new ToadModel(d.color, d.accent, d.scale);
    else if (d.model === 'leech') model = new LeechModel(d.color, d.accent, d.scale);
    else if (d.model === 'boar') model = new BoarModel(d.color, d.accent, d.scale);
    else if (d.model === 'humanoid' && d.look) {
      // Dungeon folk (Phase 4C): drowned acolytes, sentinels, archers and their masters.
      const l = d.look;
      model = new Humanoid({ skin: l.skin, hair: l.hair, hairStyle: l.helmet ? 4 : 2, tunic: l.tunic, trousers: l.trousers, robe: l.robe, helmet: l.helmet, cape: l.cape, beard: l.beard }, true);
      model.setTool(d.tool === 'wand' ? 'staff' : d.tool ?? 'none');
      model.root.scale.setScalar(d.scale);
    } else {
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

  /** Development performance measurements (Phase 4D; shown with ?perf). */
  readonly perf: PerfMonitor;
  /** Creatures animated in the last frame. */
  private animated = 0;

  render(dt: number, alpha: number) {
    this.time.value += dt;
    const t = this.time.value;
    const world = this.world;
    const map = world.map;
    const p = world.player;

    // Player
    const px = lerp(p.prevX, p.x, alpha);
    const pz = lerp(p.prevZ, p.z, alpha);
    const py = groundHeight(map, px, pz) + this.obstacleLift();
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
      pose = sk === 'woodcutting' ? 'chop' : sk === 'fishing' || sk === 'crafting' || sk === 'thieving' ? 'work' : 'mine';
      tool = sk === 'woodcutting' ? 'axe' : sk === 'fishing' ? 'net' : sk === 'crafting' || sk === 'thieving' ? 'none' : 'pickaxe';
    }
    const farming = p.action?.type === 'farm' ? world.get(p.action.patch) : null;
    if (farming instanceof FarmPatch && !p.moving && Math.hypot(farming.x - p.x, farming.z - p.z) <= 1.4) pose = 'work';
    if (p.action?.type === 'build') {
      pose = 'smith';
      tool = 'hammer';
    }
    const making = world.crafting;
    if (making && p.anim !== 'walk') {
      pose = making.station === 'anvil' ? 'smith' : 'work';
      tool = making.station === 'anvil' ? 'hammer' : making.station === 'fletching' || making.station === 'crafting' ? 'knife' : 'none';
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

    this.updateOtherPlayers(dt, t);

    // Enemies
    this.animated = 0;
    for (const v of this.enemyViews.values()) {
      const e = v.enemy;
      const ex = lerp(e.prevX, e.x, alpha);
      const ez = lerp(e.prevZ, e.z, alpha);
      const dead = !e.alive;
      const hideAfter = 1.6;
      // Creatures far beyond the camera and fog (another region, another dungeon) are neither drawn
      // nor animated: the world holds well over a hundred, and only a handful are ever in view.
      const far = Math.abs(ex - px) > ANIMATE_RANGE || Math.abs(ez - pz) > ANIMATE_RANGE;
      v.root.visible = !far && !(dead && e.deadAge > hideAfter) && !this.world.offstage.has(e.id);
      if (!v.root.visible) continue;
      this.animated++;
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
      v.model.root.visible = !this.world.offstage.has(n.id);
      if (!v.model.root.visible) continue;
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
    if (!this.obstaclesBuilt) this.buildObstacles();
    this.updatePatches();
    this.updateHouse();
    this.updateFires(t, dt);
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
    this.updateDarkness(dt, px, py, pz, d);

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
    this.perf.frame(dt * 1000, { particles: this.particles.live, projectiles: this.projectiles.live, animated: this.animated });
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

  /**
   * Glimmer Hollow is dark: daylight and sky fade out underground, the fog closes in, and a burning
   * glowcap lantern lights a green circle round the player (a faint one without it, so you can
   * still find the way out).
   */
  private updateDarkness(dt: number, px: number, py: number, pz: number, d: number) {
    // Dungeons (Phase 4C) are dim rather than black: braziers and pools give some light, and a
    // torch-coloured light follows the player (no lantern needed).
    const dungeon = dungeonAt(px, pz);
    const target = inHollow(px, pz) ? 1 : dungeon ? 0.85 : 0;
    this.darkK += (target - this.darkK) * Math.min(1, dt * 3);
    if (Math.abs(this.darkK - target) < 0.002) this.darkK = target;
    const k = this.darkK;
    const lit = this.world.isLit() || !!dungeon;
    this.hemi.intensity = 1.35 * (1 - 0.95 * k);
    this.sun.intensity = 2.1 * (1 - 0.98 * k);
    this.ambient.intensity = 0.2 * (1 - 0.75 * k);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(this.skyColor).lerp(this.caveColor, k);
    (this.scene.background as THREE.Color).copy(fog.color);
    if (k > 0) {
      fog.near = THREE.MathUtils.lerp(fog.near, d * 0.85, k);
      fog.far = THREE.MathUtils.lerp(fog.far, d * (lit ? 1.75 : 1.2), k);
    }
    this.lantern.intensity = k * (lit ? 4.2 + Math.sin(this.time.value * 7) * 0.15 : 0.9);
    this.lantern.distance = lit ? 11 : 4;
    this.lantern.color.set(dungeon === 'sunken_shrine' ? '#a8f0e0' : dungeon ? '#ffd8a0' : lit ? '#d8ffb8' : '#8a9aa8');
    this.lantern.position.set(px, py + 1.7, pz);
    // No sea underground (its shader would show through the dark at the screen edges).
    this.water.visible = k < 0.5;
    // Nor sun shadows: underground the sun is all but gone, so its shadow pass (every caster drawn a
    // second time) buys nothing. Only toggled at the transition (it recompiles shadowed materials once,
    // while the camera snaps through a passage anyway).
    const sunShadows = this.quality !== 'low' && k < 0.5;
    if (this.sun.castShadow !== sunShadows) this.sun.castShadow = sunShadows;
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
      case 'firemaking':
        return null;
      case 'pickpocket':
        return a.npc;
      case 'obstacle':
        return a.obstacle;
      case 'farm':
        return a.patch;
      case 'hotspot':
        return a.hotspot;
      case 'passage':
        return a.passage;
      case 'chest':
        return a.chest;
      case 'build':
        return this.world.hotspots.find((h) => h.def.id === a.hotspot)?.id ?? null;
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
    } else if (ent instanceof Doorway) {
      this.markers.setTarget(new THREE.Vector3(ent.x, groundHeight(map, ent.x, ent.z), ent.z), '#ffd84d', 0.9, t);
    } else if (ent instanceof Hotspot) {
      this.markers.setTarget(new THREE.Vector3(ent.x, groundHeight(map, ent.x, ent.z), ent.z), '#ffd84d', 0.8, t);
    } else if (ent instanceof FarmPatch) {
      this.markers.setTarget(new THREE.Vector3(ent.x, groundHeight(map, ent.x, ent.z), ent.z), '#5dff8a', 1.0, t);
    } else if (ent instanceof Obstacle) {
      this.markers.setTarget(new THREE.Vector3(ent.def.x1, groundHeight(map, ent.def.x1, ent.def.z1), ent.def.z1), '#5dff8a', 0.7, t);
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

  // ---------------------------------------------------------------- house

  private houseMat: THREE.Material | null = null;
  private furnitureViews = new Map<string, { id: string | null; obj: THREE.Object3D }>();
  private ghostMat = new THREE.MeshBasicMaterial({ color: '#fff2a8', transparent: true, opacity: 0.25, depthWrite: false });

  /** The house shell (built once) and its furniture (rebuilt when a space changes). */
  private updateHouse() {
    const w = this.world;
    if (!this.houseMat) {
      this.houseMat = makeWorldMaterial();
      const shell = new THREE.Mesh(houseShellPrefab(HOUSE.x1, HOUSE.z1, HOUSE.x2, HOUSE.z2, HOUSE.doorX), this.houseMat);
      shell.position.y = groundHeight(w.map, (HOUSE.x1 + HOUSE.x2) / 2, (HOUSE.z1 + HOUSE.z2) / 2);
      shell.castShadow = shell.receiveShadow = true;
      this.scene.add(shell);
      // The Exchange plaza (built here too: both are static additions to the world).
      const ex = new THREE.Mesh(exchangePrefab(EXCHANGE.radius, { x: EXCHANGE.booth.x - EXCHANGE.x, z: EXCHANGE.booth.z - EXCHANGE.z }), this.houseMat);
      ex.position.set(EXCHANGE.x, groundHeight(w.map, EXCHANGE.x, EXCHANGE.z), EXCHANGE.z);
      ex.castShadow = ex.receiveShadow = true;
      this.scene.add(ex);
    }
    for (const h of w.hotspots) {
      const id = w.player.furniture[h.def.id] ?? null;
      const v = this.furnitureViews.get(h.def.id);
      if (v && v.id === id) continue;
      if (v) this.scene.remove(v.obj);
      const f = id ? furnitureDef(id) : null;
      // Empty spaces show a faint outline so players can find them.
      const obj = f ? new THREE.Mesh(furniturePrefab(f.model, f.oak), this.houseMat) : new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.02, 0.7), this.ghostMat);
      obj.position.set(h.x, groundHeight(w.map, h.x, h.z) + 0.09, h.z);
      obj.rotation.y = h.def.rot;
      obj.castShadow = !!f;
      this.scene.add(obj);
      this.furnitureViews.set(h.def.id, { id, obj });
    }
  }

  // ---------------------------------------------------------------- farming patches

  private patchViews = new Map<number, { key: string; mesh: THREE.Mesh }>();
  private patchMat: THREE.Material | null = null;
  private patchCheck = 0;

  /** Rebuilds a patch's model when its weeds, crop or growth stage changes (checked twice a second). */
  private updatePatches() {
    const now = performance.now();
    if (now - this.patchCheck < 500) return;
    this.patchCheck = now;
    const w = this.world;
    const clock = w.clock();
    for (const f of w.patches) {
      f.settle(clock);
      const g = f.growth(clock);
      const key = `${f.weeds}:${f.crop}:${g.stage}`;
      const v = this.patchViews.get(f.id);
      if (v?.key === key) continue;
      this.patchMat ??= makeWorldMaterial();
      const mesh = new THREE.Mesh(patchPrefab(f.weeds, f.crop, g.stage, g.stages, f.id), this.patchMat);
      mesh.position.set(f.x, groundHeight(w.map, f.x, f.z), f.z);
      mesh.receiveShadow = true;
      if (v) {
        this.scene.remove(v.mesh);
        v.mesh.geometry.dispose();
      }
      this.scene.add(mesh);
      this.patchViews.set(f.id, { key, mesh });
    }
  }

  // ---------------------------------------------------------------- agility course

  private obstaclesBuilt = false;

  /** How high the player is off the ground while crossing: on the log or beam, over the wall, mid-swing. */
  private obstacleLift(): number {
    const a = this.world.player.action;
    if (a?.type !== 'obstacle' || !a.crossing) return 0;
    const o = this.world.obstacles.find((x) => x.id === a.obstacle);
    if (!o) return 0;
    const d = o.def;
    const k = Math.min(1, a.t / (Math.hypot(d.x2 - d.x1, d.z2 - d.z1) / CROSS_SPEED));
    const arc = Math.sin(k * Math.PI);
    return d.kind === 'stones' ? 0.22 + arc * 0.08 : d.kind === 'fallen' ? 0.5 : d.kind === 'log' ? 0.48 : d.kind === 'beam' ? 0.47 : d.kind === 'wall' ? arc * 0.95 : d.kind === 'rope' ? arc * 0.6 : 0;
  }

  private buildObstacles() {
    this.obstaclesBuilt = true;
    const w = this.world;
    const mat = makeWorldMaterial();
    for (const o of w.obstacles) {
      const d = o.def;
      const len = Math.hypot(d.x2 - d.x1, d.z2 - d.z1);
      const m = new THREE.Mesh(obstaclePrefab(d.kind, len), mat);
      m.position.set(o.x, groundHeight(w.map, o.x, o.z), o.z);
      // The prefab runs along +x; turn it to run from start to end.
      m.rotation.y = -Math.atan2(d.z2 - d.z1, d.x2 - d.x1);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
    }
  }

  // ---------------------------------------------------------------- player-lit fires

  private fireViews = new Map<number, { root: THREE.Group; flame: THREE.Group; x: number; y: number; z: number }>();
  private fireGeo: THREE.BufferGeometry | null = null;
  private fireMat: THREE.Material | null = null;
  private fireFlameGeo = new THREE.ConeGeometry(0.26, 0.75, 6);
  private fireFlameMat = new THREE.MeshBasicMaterial({ color: '#ffb340' });
  private fireCoreMat = new THREE.MeshBasicMaterial({ color: '#fff2a8' });
  private fireEmit = 0;

  /** Mirrors the fires players have lit: logs and stones, a flickering flame and sparks. */
  private updateFires(t: number, dt: number) {
    const w = this.world;
    const seen = new Set<number>();
    for (const f of w.fires) {
      if (f.expired) continue;
      seen.add(f.id);
      let v = this.fireViews.get(f.id);
      if (!v) {
        this.fireGeo ??= campfireGeometry();
        this.fireMat ??= makeWorldMaterial();
        const root = new THREE.Group();
        const logs = new THREE.Mesh(this.fireGeo, this.fireMat);
        logs.scale.setScalar(0.7);
        const flame = new THREE.Group();
        const inner = new THREE.Mesh(this.fireFlameGeo, this.fireCoreMat);
        inner.scale.setScalar(0.55);
        inner.position.y = -0.08;
        flame.add(new THREE.Mesh(this.fireFlameGeo, this.fireFlameMat), inner);
        flame.position.y = 0.42;
        root.add(logs, flame);
        const y = groundHeight(w.map, f.x, f.z);
        root.position.set(f.x, y, f.z);
        this.scene.add(root);
        v = { root, flame, x: f.x, y, z: f.z };
        this.fireViews.set(f.id, v);
      }
      // The flame sinks as the fire burns down.
      const left = Math.max(0.35, 1 - f.age / f.life);
      const s = 1 + Math.sin(t * 17 + f.id) * 0.08 + Math.sin(t * 23) * 0.06;
      v.flame.scale.set(left / s, left * s, left / s);
      v.flame.rotation.y = t * 2;
    }
    this.fireEmit += dt;
    if (this.fireEmit >= 0.08) {
      this.fireEmit = 0;
      for (const v of this.fireViews.values()) this.particles.emit({ x: v.x, y: v.y + 0.6, z: v.z, count: 2, color: ['#ffb340', '#ff7a1a', '#fff2a8'], speed: 0.3, up: 1.4, gravity: -0.5, life: 0.8, size: 0.06, spread: 0.3 });
      // Ember vents breathe out sparks (sets them apart from ordinary ore rocks).
      const p = w.player;
      for (const n of w.nodes) {
        if (n.def.id !== 'ember_vent' || n.depleted || Math.abs(n.x - p.x) > 20 || Math.abs(n.z - p.z) > 20 || Math.random() > 0.35) continue;
        this.particles.emit({ x: n.x, y: groundHeight(w.map, n.x, n.z) + 0.6, z: n.z, count: 1, color: ['#ff6a2a', '#ffb340', '#ffd27a'], speed: 0.2, up: 1.1, gravity: -0.3, life: 1.1, size: 0.05, spread: 0.25 });
      }
      // Warm springs steam gently.
      for (const n of w.nodes) {
        if (n.def.id !== 'warm_spring' || Math.abs(n.x - p.x) > 20 || Math.abs(n.z - p.z) > 20 || Math.random() > 0.3) continue;
        this.particles.emit({ x: n.x + (Math.random() - 0.5) * 0.8, y: groundHeight(w.map, n.x, n.z) + 0.2, z: n.z + (Math.random() - 0.5) * 0.8, count: 1, color: ['#f4f4f0', '#dfe8ea'], speed: 0.1, up: 0.6, gravity: -0.15, life: 1.8, size: 0.16, spread: 0.2 });
      }
    }
    for (const [id, v] of this.fireViews) {
      if (seen.has(id)) continue;
      this.scene.remove(v.root);
      this.overlay.removePlate(id);
      this.particles.emit({ x: v.x, y: v.y + 0.3, z: v.z, count: 12, color: ['#8c8a86', '#cfccc6'], speed: 0.4, up: 0.8, gravity: -0.2, life: 1.4, size: 0.14 });
      this.fireViews.delete(id);
    }
  }

  // ---------------------------------------------------------------- gravestones

  private graveViews = new Map<number, { grave: Gravestone; root: THREE.Group }>();
  private graveGeo: THREE.BufferGeometry | null = null;
  private graveMat = new THREE.MeshLambertMaterial({ color: '#9aa0a6' });

  private wispMat = new THREE.MeshBasicMaterial({ color: '#bff4ff', transparent: true, opacity: 0.85 });
  private wispCoreMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });

  /** A shrine wisp: a soft glowing orb with a bright core, hovering over a little cairn. */
  private makeGrave(): THREE.Group {
    if (!this.graveGeo) {
      const a = new THREE.DodecahedronGeometry(0.14, 0).translate(0, 0.07, 0);
      const b = new THREE.DodecahedronGeometry(0.1, 0).translate(0.12, 0.05, 0.05);
      this.graveGeo = merge([a, b]);
      a.dispose();
      b.dispose();
    }
    const g = new THREE.Group();
    const cairn = new THREE.Mesh(this.graveGeo, this.graveMat);
    cairn.castShadow = true;
    g.add(cairn);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), this.wispMat);
    orb.add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), this.wispCoreMat));
    orb.position.y = 0.85;
    orb.name = 'wisp';
    g.add(orb);
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

  /** A chat line shown over a player's head for a few seconds (local chat). */
  speech(name: string, text: string) {
    const who = [...this.world.players.values()].find((q) => q.name === name);
    if (!who) return;
    const id = who.id;
    const anchor = () => {
      const a = this.entityAnchor(id);
      return a && { ...a, y: a.y - 26 };
    };
    this.overlay.float(text.length > 60 ? `${text.slice(0, 57)}…` : text, 'speech', anchor, 5, 6, false);
  }

  entityAnchor(id: number): Anchor | null {
    const map = this.world.map;
    const p = this.world.player;
    if (id === p.id) {
      const r = this.playerModel.root.position;
      return this.project(r.x, r.y + 2.1, r.z);
    }
    const other = this.otherViews.get(id);
    if (other) {
      const r = other.model.root.position;
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
    for (const h of w.hotspots) {
      const near = Math.hypot(h.x - w.player.x, h.z - w.player.z) < 3;
      const built = w.player.furniture[h.def.id];
      const a = near ? this.project(h.x, groundHeight(w.map, h.x, h.z) + 1.2, h.z) : null;
      this.overlay.plate(h.id, a, { name: built ? furnitureDef(built)!.name : h.def.name, kind: 'npc', show: near });
    }
    for (const f of w.patches) {
      const near = Math.hypot(f.x - w.player.x, f.z - w.player.z) < 4;
      const a = near ? this.project(f.x, groundHeight(w.map, f.x, f.z) + 0.9, f.z) : null;
      this.overlay.plate(f.id, a, { name: w.patchState(f).text, kind: 'npc', show: near });
    }
    for (const v of this.otherViews.values()) {
      const q = v.player;
      const near = Math.hypot(q.x - w.player.x, q.z - w.player.z) < 16;
      const r = v.model.root.position;
      const a = near ? this.project(r.x, r.y + 2.3, r.z) : null;
      this.overlay.plate(q.id, a, { name: q.name, level: q.remote?.combat, hp: Math.round((q.remote?.health ?? 1) * 100), maxHp: 100, kind: 'player', show: near && !q.dead });
    }
    for (const c of w.chests) {
      const near = Math.hypot(c.x - w.player.x, c.z - w.player.z) < 7;
      const a = near ? this.project(c.x, groundHeight(w.map, c.x, c.z) + 1.4, c.z) : null;
      this.overlay.plate(c.id, a, { name: w.player.dungeonClaims[c.dungeon] ? '🗝️ Chest · yours to open' : 'Chest · locked', kind: 'npc', show: near });
    }
    for (const dw of w.doorways) {
      const near = Math.hypot(dw.x - w.player.x, dw.z - w.player.z) < 7;
      const a = near ? this.project(dw.x, groundHeight(w.map, dw.x, dw.z) + 1.9, dw.z) : null;
      this.overlay.plate(dw.id, a, { name: dw.def.name, kind: 'npc', show: near });
    }
    for (const o of w.obstacles) {
      const near = Math.hypot(o.x - w.player.x, o.z - w.player.z) < 7;
      const a = near ? this.project(o.x, groundHeight(w.map, o.x, o.z) + 1.5, o.z) : null;
      this.overlay.plate(o.id, a, { name: o.def.name, kind: 'npc', show: near });
    }
    for (const v of this.graveViews.values()) {
      const g = v.grave;
      const orb = v.root.getObjectByName('wisp');
      if (orb) orb.position.y = 0.85 + Math.sin(performance.now() / 600 + g.id) * 0.08;
      const near = Math.hypot(g.x - w.player.x, g.z - w.player.z) < 14;
      const a = near ? this.project(g.x, v.root.position.y + 1.35, g.z) : null;
      const left = Math.ceil(g.secondsLeft);
      this.overlay.plate(g.id, a, { name: `Your shrine wisp · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, kind: 'npc', show: near });
    }
    for (const v of this.npcViews) {
      const n = v.npc;
      const a = this.project(n.x, groundHeight(w.map, n.x, n.z) + 2.25, n.z);
      const near = Math.hypot(n.x - w.player.x, n.z - w.player.z) < 14 && !w.offstage.has(n.id);
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
      case 'quench': {
        // A burst of steam where the hot metal meets the water.
        const y = groundHeight(w.map, e.x, e.z) + 0.6;
        this.particles.emit({ x: e.x, y, z: e.z, count: 26, color: ['#ffffff', '#e8eef2', '#cfd8de'], speed: 0.9, up: 1.8, gravity: -0.6, life: 1.6, size: 0.16, spread: 0.6 });
        break;
      }
      case 'stunned': {
        // Little stars circling the head.
        const y = groundHeight(w.map, p.x, p.z) + 2.1;
        this.particles.emit({ x: p.x, y, z: p.z, count: 14, color: ['#ffe14d', '#fff6b0', '#ffffff'], speed: 1.1, up: 0.4, gravity: 0.2, life: 1.6, size: 0.09, spread: 0.5 });
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
        // From a creature (Phase 4C): an arrow or a bolt of water at the local player or another player.
        const fromEnemy = this.enemyViews.get(e.source);
        if (fromEnemy) {
          const target = e.target === p.id ? this.playerModel.root : this.otherViews.get(e.target)?.model.root;
          if (!target) break;
          const f = fromEnemy.root.position.clone().add(new THREE.Vector3(Math.sin(fromEnemy.enemy.facing) * 0.4, 1.3 * fromEnemy.enemy.def.scale, Math.cos(fromEnemy.enemy.facing) * 0.4));
          this.projectiles.spawn(e.style === 'magic' ? 'magic' : 'arrow', f, () => target.position.clone().add(new THREE.Vector3(0, 1, 0)), e.flight);
          if (e.style === 'magic') this.particles.emit({ x: f.x, y: f.y, z: f.z, count: 8, color: ['#5fe8d0', '#ffffff'], speed: 1, up: 1, gravity: 0, life: 0.4, size: 0.07 });
          break;
        }
        // From the local player, or another player nearby (network play).
        const shooter = e.source === p.id ? { model: this.playerModel, facing: p.facing } : this.otherViews.has(e.source) ? { model: this.otherViews.get(e.source)!.model, facing: this.otherViews.get(e.source)!.player.facing } : null;
        if (!shooter) break;
        const from = shooter.model.root.position.clone().add(new THREE.Vector3(Math.sin(shooter.facing) * 0.4, 1.2, Math.cos(shooter.facing) * 0.4));
        // Arrows leave from the bow, spells from the wand tip, when the new rig holds one.
        if (e.style !== 'melee' && shooter.model instanceof HeroModel) shooter.model.projectileOrigin(from);
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
      case 'passage': {
        // Coming through a passage is a jump across the map: snap the camera.
        this.camTarget.set(p.x, groundHeight(w.map, p.x, p.z) + 0.8, p.z);
        this.darkK = inHollow(p.x, p.z) ? 1 : dungeonAt(p.x, p.z) ? 0.85 : 0;
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

  /** Feedback for a tap on something (a creature, a door, a chest): the same ring, under it. */
  showEntityTap(id: number) {
    const v = this.enemyViews.get(id);
    const e = v ? v.root.position : this.world.get(id);
    if (e) this.showTapMarker(e.x, e.z);
  }

  /** The landmark a dungeon door belongs to (its scenery near the door). */
  private landmarkOf(dungeon: string, x: number, z: number): { x: number; z: number } | null {
    const kind = DUNGEONS[dungeon]?.landmark;
    return this.world.map.decor.find((d) => d.kind === kind && Math.hypot(d.x - x, d.z - z) < 3) ?? null;
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
    // Each creature's closest sample, so a near-tie in a crowd can keep the current target.
    const enemyD = new Map<number, number>();
    const consider = (id: number, x: number, y: number, z: number, bias = 1) => {
      const a = this.project(x, y, z);
      if (!a.visible) return;
      const d = Math.hypot(a.x - sx, a.y - sy) * bias;
      if (enemyD.has(id) || this.enemyViews.has(id)) enemyD.set(id, Math.min(enemyD.get(id) ?? Infinity, d));
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    };
    const map = w.map;
    for (const v of this.enemyViews.values()) {
      if (!v.enemy.alive || !v.root.visible) continue;
      const r = v.root.position;
      const h = enemyHeight(v.enemy);
      consider(v.enemy.id, r.x, r.y + h * 0.45, r.z, 0.8);
      consider(v.enemy.id, r.x, r.y + 0.1, r.z, 0.9);
      // Its nameplate (in a crowd the label is often the clearest thing to tap).
      consider(v.enemy.id, r.x, r.y + h + 0.3, r.z, 0.95);
    }
    for (const n of w.npcs) {
      if (w.offstage.has(n.id)) continue;
      const y = groundHeight(map, n.x, n.z);
      consider(n.id, n.x, y + 1, n.z);
      // Tapping the bank counter means the banker behind it.
      if (n.def.id === 'banker') consider(n.id, BANK_COUNTER.x, y + 0.95, BANK_COUNTER.z, 0.9);
    }
    // Other players (network play): tapping one opens the player menu.
    for (const v of this.otherViews.values()) {
      if (v.player.dead) continue;
      const r = v.model.root.position;
      consider(v.player.id, r.x, r.y + 1.1, r.z, 0.85);
    }
    for (const n of w.nodes) {
      if (Math.abs(n.x - w.player.x) > 30 || Math.abs(n.z - w.player.z) > 30) continue;
      // A felled tree or an emptied rock can't be worked, so it doesn't catch taps meant for the ground
      // beside it (a stump used to swallow them).
      if (n.depleted) continue;
      const y = groundHeight(map, n.x, n.z);
      const tree = n.def.skill === 'woodcutting';
      consider(n.id, n.x, y + (tree ? 1.2 : 0.4), n.z, 1.1);
      if (tree) consider(n.id, n.x, y + 2.2, n.z, 1.2);
    }
    for (const v of this.groundViews.values()) {
      const p = v.sprite.position;
      consider(v.pile.id, p.x, p.y, p.z, 0.85);
    }
    for (const v of this.graveViews.values()) {
      const p = v.root.position;
      consider(v.grave.id, p.x, p.y + 0.4, p.z, 0.85);
    }
    for (const h of w.hotspots) {
      if (Math.abs(h.x - w.player.x) > 30 || Math.abs(h.z - w.player.z) > 30) continue;
      consider(h.id, h.x, groundHeight(map, h.x, h.z) + 0.4, h.z, 0.9);
    }
    for (const dw of w.doorways) {
      if (Math.abs(dw.x - w.player.x) > 30 || Math.abs(dw.z - w.player.z) > 30) continue;
      // Doors, stairs and ways out are what you came for: easy to hit at foot and head height.
      const y = groundHeight(map, dw.x, dw.z);
      consider(dw.id, dw.x, y + 0.5, dw.z, 0.8);
      consider(dw.id, dw.x, y + 1.6, dw.z, 0.85);
      // A dungeon door also answers to its whole landmark (the ruin, the tower).
      const mark = dw.def.requires ? this.landmarkOf(dw.def.requires, dw.x, dw.z) : null;
      if (mark) for (const hy of [1.0, 2.4]) consider(dw.id, mark.x, groundHeight(map, mark.x, mark.z) + hy, mark.z, 0.9);
    }
    for (const c of w.chests) {
      if (Math.abs(c.x - w.player.x) > 30 || Math.abs(c.z - w.player.z) > 30) continue;
      const y = groundHeight(map, c.x, c.z);
      consider(c.id, c.x, y + 0.5, c.z, 0.8);
      consider(c.id, c.x, y + 1.1, c.z, 0.85);
    }
    for (const f of w.patches) {
      if (Math.abs(f.x - w.player.x) > 30 || Math.abs(f.z - w.player.z) > 30) continue;
      consider(f.id, f.x, groundHeight(map, f.x, f.z) + 0.2, f.z, 0.9);
    }
    for (const o of w.obstacles) {
      if (Math.abs(o.x - w.player.x) > 30 || Math.abs(o.z - w.player.z) > 30) continue;
      consider(o.id, o.x, groundHeight(map, o.x, o.z) + 0.5, o.z, 0.95);
      consider(o.id, o.def.x1, groundHeight(map, o.def.x1, o.def.z1) + 0.3, o.def.z1, 1.05);
    }
    for (const st of w.stations) {
      if (Math.abs(st.x - w.player.x) > 30 || Math.abs(st.z - w.player.z) > 30) continue;
      consider(st.id, st.x, groundHeight(map, st.x, st.z) + 0.6, st.z, 0.95);
    }
    // A tap in a crowd that lands almost as close to the creature you are already fighting keeps it,
    // rather than flipping to a neighbour by a few pixels.
    const sel = this.selectedId();
    if (best !== null && sel !== null && sel !== best && this.enemyViews.has(best) && (enemyD.get(sel) ?? Infinity) <= bestD * 1.3) best = sel;
    if (best !== null) return { kind: 'entity', id: best };

    const ndc = new THREE.Vector2((sx / rect.width) * 2 - 1, -(sy / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.terrain, true);
    if (hits.length > 0) return { kind: 'ground', x: hits[0].point.x, z: hits[0].point.z };
    // Deep sea floor isn't drawn; a tap out at sea still points somewhere, as before.
    const sea = this.raycaster.ray.intersectPlane(SEA_FLOOR, new THREE.Vector3());
    if (sea) return { kind: 'ground', x: sea.x, z: sea.z };
    return null;
  }
}

const SEA_FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1.6);

/** Creatures further than this (in tiles, along either axis) from the player are not drawn or animated. */
const ANIMATE_RANGE = 36;

function enemyHeight(e: Enemy): number {
  if (e.def.model === 'slime') return 1.1 * e.def.scale;
  if (e.def.model === 'wolf') return 1.25 * e.def.scale;
  if (e.def.model === 'toad') return 0.95 * e.def.scale;
  if (e.def.model === 'leech') return 0.7 * e.def.scale;
  if (e.def.model === 'boar') return 1.05 * e.def.scale;
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
