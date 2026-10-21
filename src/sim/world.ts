import { mulberry32, randInt, type Rng } from '../core/rng';
import { angleDiff, dist } from '../core/math';
import { ENEMIES, type EnemyDef } from '../data/enemies';
import { itemDef, type ItemId } from '../data/items';
import { NPCS, type NpcDef, type NpcId } from '../data/npcs';
import { QUESTS, type QuestDef } from '../data/quests';
import { RESOURCES, gatherChance, type ResourceDef } from '../data/resources';
import { SKILL_INFO, type SkillId } from '../data/skills';
import { STYLES, combatXp, rollHit, type CombatStyle } from './combat';
import { Inventory, type ItemStack } from './inventory';
import { findPath, simplifyPath, type PathPoint } from './pathfinding';
import { Skills } from './skills';
import { generateWorld, isBlocked, regionAt, type Checkpoint, type WorldMap } from './worldmap';

export const TICK_SECONDS = 1 / 30;
export const PLAYER_SPEED = 4.4;
const ENTITY_RADIUS = 0.28;

export interface Appearance {
  bodyType: 0 | 1;
  skin: string;
  hair: string;
  hairStyle: number;
  tunic: string;
  trousers: string;
}

export const DEFAULT_APPEARANCE: Appearance = {
  bodyType: 0,
  skin: '#e8b48f',
  hair: '#5a3620',
  hairStyle: 1,
  tunic: '#2f7fc1',
  trousers: '#4a3a2a',
};

/** Client → simulation commands. In multiplayer these become network messages to the authoritative server. */
export type Command =
  | { type: 'joystick'; dx: number; dz: number }
  | { type: 'moveTo'; x: number; z: number }
  | { type: 'interact'; target: number }
  | { type: 'setStyle'; style: CombatStyle }
  | { type: 'useItem'; slot: number }
  | { type: 'dropItem'; slot: number }
  | { type: 'swapItems'; a: number; b: number }
  | { type: 'acceptQuest'; quest: string }
  | { type: 'respawn'; at: 'home' | 'checkpoint' };

export interface Dialogue {
  npc: NpcId;
  speaker: string;
  title: string;
  lines: string[];
  offer?: { quest: string; label: string };
  rewards?: string[];
}

export type MessageTone = 'info' | 'good' | 'warn' | 'bad';

/** Simulation → client events. */
export type GameEvent =
  | { type: 'damage'; target: number; source: number; amount: number; hit: boolean }
  | { type: 'attack'; source: number; target: number; style: CombatStyle }
  | { type: 'projectile'; source: number; target: number; style: CombatStyle; flight: number }
  | { type: 'death'; id: number }
  | { type: 'respawn'; id: number }
  | { type: 'xp'; skill: SkillId; amount: number }
  | { type: 'levelUp'; skill: SkillId; level: number }
  | { type: 'loot'; item: ItemId; qty: number }
  | { type: 'message'; text: string; tone: MessageTone }
  | { type: 'gather'; node: number; success: boolean }
  | { type: 'nodeDepleted'; node: number }
  | { type: 'nodeRespawned'; node: number }
  | { type: 'heal'; id: number; amount: number }
  | { type: 'dialogue'; dialogue: Dialogue }
  | { type: 'quest'; quest: string; stage: number; complete: boolean }
  | { type: 'checkpoint'; id: string; name: string }
  | { type: 'region'; name: string; levels: string };

export type AnimState = 'idle' | 'walk' | 'attack' | 'chop' | 'mine' | 'dead' | 'hit';

export type PlayerAction =
  | { type: 'attack'; target: number }
  | { type: 'gather'; node: number }
  | { type: 'talk'; npc: number };

export interface QuestProgress {
  stage: number;
  kills: number;
  done: boolean;
}

interface Mover {
  id: number;
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  facing: number;
}

export class Player implements Mover {
  readonly id = 1;
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  facing = 0;
  hp: number;
  skills: Skills;
  inventory: Inventory;
  style: CombatStyle = 'melee';
  action: PlayerAction | null = null;
  path: PathPoint[] = [];
  joy = { x: 0, z: 0 };
  moving = false;
  attackTimer = 0;
  gatherTimer = 0;
  eatTimer = 0;
  repathTimer = 0;
  dead = false;
  deathTimer = 0;
  combatTimer = 0;
  regenTimer = 0;
  /** Seconds since last attack swing, for animation. */
  swingAge = 99;
  quests: Record<string, QuestProgress> = {};
  checkpoints = new Set<string>(['home']);
  regionId: string | null = null;

  constructor(public name: string, public appearance: Appearance, x: number, z: number) {
    this.x = this.prevX = x;
    this.z = this.prevZ = z;
    this.skills = new Skills();
    this.inventory = new Inventory();
    this.hp = this.skills.maxHp();
  }

  get maxHp() {
    return this.skills.maxHp();
  }

  get anim(): AnimState {
    if (this.dead) return 'dead';
    if (this.swingAge < 0.5) return 'attack';
    if (this.moving) return 'walk';
    return 'idle';
  }
}

export class Enemy implements Mover {
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  facing: number;
  hp: number;
  state: 'idle' | 'wander' | 'chase' | 'return' | 'dead' = 'idle';
  target: number | null = null;
  attackTimer = 0;
  idleTimer = 0;
  respawnTimer = 0;
  wander: PathPoint | null = null;
  moving = false;
  swingAge = 99;
  hurtAge = 99;
  deadAge = 0;

  constructor(public id: number, public def: EnemyDef, public spawnX: number, public spawnZ: number, rng: Rng) {
    this.x = this.prevX = spawnX;
    this.z = this.prevZ = spawnZ;
    this.facing = rng() * Math.PI * 2;
    this.hp = def.maxHp;
    this.idleTimer = rng() * 3;
  }

  get alive() {
    return this.state !== 'dead';
  }
}

export class ResourceNode {
  depleted = false;
  respawnTimer = 0;
  /** Seconds since last gather hit (for shake animation). */
  hitAge = 99;
  constructor(public id: number, public def: ResourceDef, public x: number, public z: number, public index: number) {}
}

export class Npc {
  facing: number;
  talkAge = 99;
  idleLine = 0;
  constructor(public id: number, public def: NpcDef, public x: number, public z: number, public baseFacing: number) {
    this.facing = baseFacing;
  }
}

interface PendingHit {
  at: number;
  target: number;
  style: CombatStyle;
  damage: number;
  hit: boolean;
}

export type Interactable =
  | { kind: 'enemy'; entity: Enemy }
  | { kind: 'node'; entity: ResourceNode }
  | { kind: 'npc'; entity: Npc };

export interface SaveData {
  version: 1;
  name: string;
  appearance: Appearance;
  x: number;
  z: number;
  hp: number;
  style: CombatStyle;
  xp: Partial<Record<SkillId, number>>;
  inventory: (ItemStack | null)[];
  quests: Record<string, QuestProgress>;
  checkpoints: string[];
}

export class GameWorld {
  readonly map: WorldMap;
  readonly player: Player;
  readonly enemies: Enemy[] = [];
  readonly nodes: ResourceNode[] = [];
  readonly npcs: Npc[] = [];
  readonly rng: Rng;
  time = 0;
  private events: GameEvent[] = [];
  private pending: PendingHit[] = [];
  private byId = new Map<number, Enemy | ResourceNode | Npc>();

  constructor(opts: { seed?: number; name?: string; appearance?: Appearance; save?: SaveData | null } = {}) {
    this.map = generateWorld(opts.seed ?? 1337);
    this.rng = mulberry32((opts.seed ?? 1337) ^ 0x5eed);
    const s = opts.save;
    this.player = new Player(s?.name ?? opts.name ?? 'Adventurer', s?.appearance ?? opts.appearance ?? DEFAULT_APPEARANCE, this.map.spawn.x, this.map.spawn.z);
    if (s) this.loadPlayer(s);
    else this.giveStarterKit();

    this.map.npcs.forEach((n, i) => {
      const npc = new Npc(100 + i, NPCS[n.id], n.x, n.z, n.facing);
      this.npcs.push(npc);
      this.byId.set(npc.id, npc);
    });
    this.map.resources.forEach((r, i) => {
      const node = new ResourceNode(1000 + i, RESOURCES[r.type], r.x + 0.5, r.z + 0.5, i);
      this.nodes.push(node);
      this.byId.set(node.id, node);
    });
    this.map.enemySpawns.forEach((e, i) => {
      const enemy = new Enemy(5000 + i, ENEMIES[e.type], e.x, e.z, this.rng);
      this.enemies.push(enemy);
      this.byId.set(enemy.id, enemy);
    });
  }

  private giveStarterKit() {
    const inv = this.player.inventory;
    inv.add('bronze_axe');
    inv.add('bronze_pickaxe');
    inv.add('bread', 2);
    inv.add('bronze_arrow', 60);
    inv.add('air_rune', 60);
    inv.add('coins', 25);
  }

  // ---------------------------------------------------------------- persistence

  save(): SaveData {
    const p = this.player;
    return {
      version: 1,
      name: p.name,
      appearance: p.appearance,
      x: p.dead ? this.map.spawn.x : p.x,
      z: p.dead ? this.map.spawn.z : p.z,
      hp: p.dead ? p.maxHp : p.hp,
      style: p.style,
      xp: { ...p.skills.xp },
      inventory: p.inventory.toJSON(),
      quests: JSON.parse(JSON.stringify(p.quests)),
      checkpoints: [...p.checkpoints],
    };
  }

  private loadPlayer(s: SaveData) {
    const p = this.player;
    p.skills = new Skills(s.xp);
    p.inventory = Inventory.fromJSON(s.inventory);
    p.quests = s.quests ?? {};
    p.checkpoints = new Set(['home', ...(s.checkpoints ?? [])]);
    if (s.style in STYLES) p.style = s.style;
    if (!isBlocked(this.map, s.x, s.z)) {
      p.x = p.prevX = s.x;
      p.z = p.prevZ = s.z;
    }
    p.hp = Math.max(1, Math.min(p.maxHp, s.hp ?? p.maxHp));
  }

  // ---------------------------------------------------------------- api

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  emit(e: GameEvent) {
    this.events.push(e);
  }

  message(text: string, tone: MessageTone = 'info') {
    this.emit({ type: 'message', text, tone });
  }

  get(id: number): Enemy | ResourceNode | Npc | undefined {
    return this.byId.get(id);
  }

  interactable(id: number): Interactable | null {
    const e = this.byId.get(id);
    if (e instanceof Enemy) return { kind: 'enemy', entity: e };
    if (e instanceof ResourceNode) return { kind: 'node', entity: e };
    if (e instanceof Npc) return { kind: 'npc', entity: e };
    return null;
  }

  issue(cmd: Command) {
    const p = this.player;
    if (p.dead && cmd.type !== 'respawn') return;
    switch (cmd.type) {
      case 'joystick': {
        const m = Math.hypot(cmd.dx, cmd.dz);
        if (m > 1) {
          p.joy.x = cmd.dx / m;
          p.joy.z = cmd.dz / m;
        } else {
          p.joy.x = cmd.dx;
          p.joy.z = cmd.dz;
        }
        if (m > 0.15) {
          p.path = [];
          if (p.action && p.action.type !== 'attack') p.action = null;
        }
        break;
      }
      case 'moveTo': {
        p.action = null;
        this.pathTo(cmd.x, cmd.z, true);
        break;
      }
      case 'interact':
        this.startInteract(cmd.target);
        break;
      case 'setStyle':
        if (cmd.style in STYLES && p.style !== cmd.style) {
          p.style = cmd.style;
          this.message(`Combat style: ${STYLES[cmd.style].name} (${STYLES[cmd.style].weapon}).`);
        }
        break;
      case 'useItem':
        this.useItem(cmd.slot);
        break;
      case 'dropItem': {
        const s = p.inventory.removeAt(cmd.slot);
        if (s) this.message(`You drop ${s.qty > 1 ? s.qty + ' x ' : ''}${itemDef(s.item).name}.`);
        break;
      }
      case 'swapItems':
        p.inventory.swap(cmd.a, cmd.b);
        break;
      case 'acceptQuest':
        this.acceptQuest(cmd.quest);
        break;
      case 'respawn':
        if (p.dead) this.respawnPlayer(cmd.at);
        break;
    }
  }

  // ---------------------------------------------------------------- simulation

  tick(dt = TICK_SECONDS) {
    this.time += dt;
    const p = this.player;
    p.prevX = p.x;
    p.prevZ = p.z;
    for (const e of this.enemies) {
      e.prevX = e.x;
      e.prevZ = e.z;
    }
    this.updatePlayer(dt);
    for (const e of this.enemies) this.updateEnemy(e, dt);
    for (const n of this.nodes) {
      n.hitAge += dt;
      if (n.depleted) {
        n.respawnTimer -= dt;
        if (n.respawnTimer <= 0) {
          n.depleted = false;
          this.emit({ type: 'nodeRespawned', node: n.id });
        }
      }
    }
    for (const n of this.npcs) {
      n.talkAge += dt;
      const d = dist(n.x, n.z, p.x, p.z);
      const want = d < 4 ? Math.atan2(p.x - n.x, p.z - n.z) : n.baseFacing;
      n.facing += angleDiff(n.facing, want) * Math.min(1, dt * 5);
    }
    // Resolve projectile hits.
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const h = this.pending[i];
      if (h.at > this.time) continue;
      this.pending.splice(i, 1);
      const e = this.byId.get(h.target);
      if (e instanceof Enemy && e.alive) this.damageEnemy(e, h.damage, h.hit, h.style);
    }
  }

  private updatePlayer(dt: number) {
    const p = this.player;
    p.swingAge += dt;
    p.attackTimer -= dt;
    p.eatTimer -= dt;
    p.combatTimer -= dt;
    p.repathTimer -= dt;
    p.moving = false;

    if (p.dead) {
      p.deathTimer -= dt;
      if (p.deathTimer <= 0) this.respawnPlayer('home');
      return;
    }

    // Out-of-combat regeneration.
    if (p.combatTimer <= 0 && p.hp < p.maxHp) {
      p.regenTimer += dt;
      if (p.regenTimer >= 1) {
        p.regenTimer = 0;
        p.hp = Math.min(p.maxHp, p.hp + Math.max(1, Math.round(p.maxHp * 0.02)));
      }
    }

    const joyMag = Math.hypot(p.joy.x, p.joy.z);
    if (joyMag > 0.15) {
      const speed = PLAYER_SPEED * Math.min(1, 0.35 + joyMag);
      this.moveEntity(p, p.joy.x / joyMag, p.joy.z / joyMag, speed * dt);
      p.moving = true;
      p.facing = Math.atan2(p.joy.x, p.joy.z);
    } else if (p.path.length > 0) {
      this.followPath(p, dt);
    }

    const action = p.action;
    if (action?.type === 'attack') this.updatePlayerAttack(action.target, joyMag > 0.15, dt);
    else if (action?.type === 'gather') this.updateGather(action.node, dt);
    else if (action?.type === 'talk') this.updateTalk(action.npc);

    this.updateRegion();
  }

  private updateRegion() {
    const p = this.player;
    const r = regionAt(p.x, p.z);
    const id = r?.id ?? null;
    if (id !== p.regionId) {
      p.regionId = id;
      if (r) this.emit({ type: 'region', name: r.name, levels: r.levels });
    }
    for (const c of this.map.checkpoints) {
      if (!p.checkpoints.has(c.id) && dist(p.x, p.z, c.x, c.z) < 3) {
        p.checkpoints.add(c.id);
        this.emit({ type: 'checkpoint', id: c.id, name: c.name });
        this.message(`You attune to the ${c.name}. You may respawn here.`, 'good');
      }
    }
  }

  private followPath(p: Player, dt: number) {
    let budget = PLAYER_SPEED * dt;
    while (budget > 0 && p.path.length > 0) {
      const wp = p.path[0];
      const d = dist(p.x, p.z, wp.x, wp.z);
      if (d < 0.02) {
        p.path.shift();
        continue;
      }
      const step = Math.min(d, budget);
      const dx = (wp.x - p.x) / d;
      const dz = (wp.z - p.z) / d;
      const moved = this.moveEntity(p, dx, dz, step);
      p.facing = Math.atan2(dx, dz);
      p.moving = true;
      budget -= step;
      if (moved < step * 0.2) {
        // Stuck on geometry; drop the waypoint rather than jitter.
        p.path.shift();
      } else if (step >= d) {
        p.path.shift();
      }
    }
  }

  /** Path the player towards (x,z). Returns false if unreachable. */
  private pathTo(x: number, z: number, exact: boolean): boolean {
    const p = this.player;
    const raw = findPath(this.map, p.x, p.z, x, z);
    if (!raw) {
      p.path = [];
      return false;
    }
    const path = simplifyPath(raw);
    if (exact && path.length > 0 && !isBlocked(this.map, x, z)) path[path.length - 1] = { x, z };
    if (exact && raw.length === 0 && !isBlocked(this.map, x, z)) path.push({ x, z });
    p.path = path;
    p.repathTimer = 0.5;
    return true;
  }

  private startInteract(id: number) {
    const p = this.player;
    const it = this.interactable(id);
    if (!it) return;
    p.path = [];
    if (it.kind === 'enemy') {
      if (!it.entity.alive) return;
      p.action = { type: 'attack', target: id };
    } else if (it.kind === 'node') {
      const n = it.entity;
      if (n.depleted) {
        this.message(n.def.skill === 'woodcutting' ? 'This tree has been cut down. It will regrow soon.' : 'This rock is depleted. It will replenish soon.');
        return;
      }
      if (!this.canGather(n, true)) return;
      p.action = { type: 'gather', node: id };
      p.gatherTimer = n.def.actionSeconds * 0.6;
    } else {
      p.action = { type: 'talk', npc: id };
    }
  }

  /** Move toward a point, re-pathing periodically. Returns true once within range. */
  private approach(tx: number, tz: number, range: number, allowMove: boolean): boolean {
    const p = this.player;
    if (dist(p.x, p.z, tx, tz) <= range) {
      p.path = [];
      return true;
    }
    if (!allowMove) return false;
    if (p.path.length === 0 || p.repathTimer <= 0) {
      if (!this.pathTo(tx, tz, false)) {
        this.message("You can't reach that.", 'warn');
        p.action = null;
      }
    }
    return false;
  }

  private updatePlayerAttack(targetId: number, joystickActive: boolean, _dt: number) {
    const p = this.player;
    const e = this.byId.get(targetId);
    if (!(e instanceof Enemy) || !e.alive) {
      p.action = null;
      return;
    }
    const style = STYLES[p.style];
    if (!this.approach(e.x, e.z, style.range, !joystickActive)) return;
    if (!joystickActive) p.facing = Math.atan2(e.x - p.x, e.z - p.z);
    if (p.attackTimer > 0) return;

    if (style.ammo && !p.inventory.has(style.ammo)) {
      this.message(`You have no ${itemDef(style.ammo).name.toLowerCase()} left. Switch style or find more.`, 'warn');
      p.action = null;
      return;
    }
    if (style.ammo) p.inventory.remove(style.ammo, 1);

    p.facing = Math.atan2(e.x - p.x, e.z - p.z);
    p.attackTimer = style.attackSeconds;
    p.swingAge = 0;
    p.combatTimer = 6;
    const sk = p.skills;
    const attackSkill: SkillId = p.style === 'melee' ? 'attack' : p.style;
    const result = rollHit(
      this.rng,
      { attackLevel: sk.level(attackSkill), strengthLevel: p.style === 'melee' ? sk.level('strength') : sk.level(attackSkill), accuracyBonus: style.accuracy, powerBonus: style.power },
      { defenceLevel: e.def.defence, armour: 0 },
    );
    this.emit({ type: 'attack', source: p.id, target: e.id, style: p.style });
    if (style.projectileSpeed) {
      const flight = Math.max(0.12, dist(p.x, p.z, e.x, e.z) / style.projectileSpeed);
      this.emit({ type: 'projectile', source: p.id, target: e.id, style: p.style, flight });
      this.pending.push({ at: this.time + flight, target: e.id, style: p.style, damage: result.damage, hit: result.hit });
    } else {
      this.pending.push({ at: this.time + 0.22, target: e.id, style: p.style, damage: result.damage, hit: result.hit });
    }
  }

  private damageEnemy(e: Enemy, damage: number, hit: boolean, style: CombatStyle) {
    const p = this.player;
    const dealt = Math.min(damage, e.hp);
    e.hp -= dealt;
    e.hurtAge = 0;
    this.emit({ type: 'damage', target: e.id, source: p.id, amount: dealt, hit });
    if (dealt > 0) for (const x of combatXp(style, dealt)) this.grantXp(x.skill, x.amount);
    if (e.state !== 'chase' && !p.dead) {
      e.state = 'chase';
      e.target = p.id;
      e.attackTimer = Math.max(e.attackTimer, 0.6);
    }
    if (e.hp <= 0) this.killEnemy(e);
  }

  private killEnemy(e: Enemy) {
    const p = this.player;
    e.state = 'dead';
    e.target = null;
    e.respawnTimer = e.def.respawnSeconds;
    e.deadAge = 0;
    this.emit({ type: 'death', id: e.id });
    if (p.action?.type === 'attack' && p.action.target === e.id) p.action = null;
    for (const d of e.def.drops) {
      if (this.rng() > d.chance) continue;
      this.giveItem(d.item, randInt(this.rng, d.min, d.max), true);
    }
    for (const q of Object.values(QUESTS)) {
      const prog = p.quests[q.id];
      if (!prog || prog.done) continue;
      const obj = q.stages[prog.stage]?.objective;
      if (obj?.type === 'kill' && obj.enemy === e.def.id && prog.kills < obj.count) {
        prog.kills++;
        this.message(`${q.name}: ${e.def.name} defeated (${prog.kills}/${obj.count}).`, 'good');
        this.emit({ type: 'quest', quest: q.id, stage: prog.stage, complete: false });
      }
    }
  }

  giveItem(item: ItemId, qty: number, loot = false): number {
    const added = this.player.inventory.add(item, qty);
    const name = itemDef(item).name;
    if (added > 0 && loot) this.emit({ type: 'loot', item, qty: added });
    if (added < qty) this.message(`Your inventory is too full to hold ${name.toLowerCase()}.`, 'warn');
    return added;
  }

  grantXp(skill: SkillId, amount: number) {
    const r = this.player.skills.addXp(skill, amount);
    this.emit({ type: 'xp', skill, amount });
    if (r.newLevel > r.oldLevel) {
      this.emit({ type: 'levelUp', skill, level: r.newLevel });
      this.message(`Congratulations! Your ${SKILL_INFO[skill].name} level is now ${r.newLevel}.`, 'good');
      if (skill === 'hitpoints') this.player.hp += (r.newLevel - r.oldLevel) * 10;
    }
  }

  private canGather(n: ResourceNode, verbose: boolean): boolean {
    const p = this.player;
    const lvl = p.skills.level(n.def.skill);
    if (lvl < n.def.levelReq) {
      if (verbose) this.message(`You need ${SKILL_INFO[n.def.skill].name} level ${n.def.levelReq} to gather from this ${n.def.name.toLowerCase()}.`, 'warn');
      return false;
    }
    if (!p.inventory.has(n.def.tool)) {
      if (verbose) this.message(`You need a ${itemDef(n.def.tool).name.toLowerCase()} for that.`, 'warn');
      return false;
    }
    if (p.inventory.capacityFor(n.def.item) <= 0) {
      if (verbose) this.message('Your inventory is full.', 'warn');
      return false;
    }
    return true;
  }

  get gatheringNode(): ResourceNode | null {
    const a = this.player.action;
    if (a?.type !== 'gather') return null;
    const n = this.byId.get(a.node);
    return n instanceof ResourceNode ? n : null;
  }

  /** True while the player is actively swinging at a resource (for animation). */
  get isGathering(): boolean {
    const n = this.gatheringNode;
    const p = this.player;
    return !!n && !p.moving && dist(p.x, p.z, n.x, n.z) <= 1.6;
  }

  private updateGather(nodeId: number, dt: number) {
    const p = this.player;
    const n = this.byId.get(nodeId);
    if (!(n instanceof ResourceNode) || n.depleted) {
      p.action = null;
      return;
    }
    if (!this.approach(n.x, n.z, 1.6, true)) return;
    p.facing = Math.atan2(n.x - p.x, n.z - p.z);
    p.gatherTimer -= dt;
    if (p.gatherTimer > 0) return;
    p.gatherTimer = n.def.actionSeconds;
    n.hitAge = 0;
    if (!this.canGather(n, true)) {
      p.action = null;
      return;
    }
    const success = this.rng() < gatherChance(n.def, p.skills.level(n.def.skill));
    this.emit({ type: 'gather', node: n.id, success });
    if (!success) return;
    this.giveItem(n.def.item, 1, true);
    this.grantXp(n.def.skill, n.def.xp);
    if (n.def.rareDrop && this.rng() < n.def.rareDrop.chance) {
      this.giveItem(n.def.rareDrop.item, 1, true);
      this.message(`You found an ${itemDef(n.def.rareDrop.item).name.toLowerCase()}!`, 'good');
    }
    if (this.rng() < n.def.depleteChance) {
      n.depleted = true;
      n.respawnTimer = n.def.respawnSeconds;
      this.emit({ type: 'nodeDepleted', node: n.id });
      p.action = null;
      // Automatically continue on a nearby node of the same type, like an attentive auto-gatherer.
      const next = this.nearestNode(n.def.id, p.x, p.z, 6);
      if (next && this.canGather(next, false)) {
        p.action = { type: 'gather', node: next.id };
        p.gatherTimer = next.def.actionSeconds * 0.8;
      }
    }
  }

  nearestNode(type: string, x: number, z: number, maxDist: number): ResourceNode | null {
    let best: ResourceNode | null = null;
    let bd = maxDist;
    for (const n of this.nodes) {
      if (n.depleted || n.def.id !== type) continue;
      const d = dist(x, z, n.x, n.z);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  private updateTalk(npcId: number) {
    const p = this.player;
    const n = this.byId.get(npcId);
    if (!(n instanceof Npc)) {
      p.action = null;
      return;
    }
    if (!this.approach(n.x, n.z, 1.9, true)) return;
    p.action = null;
    p.facing = Math.atan2(n.x - p.x, n.z - p.z);
    n.talkAge = 0;
    this.emit({ type: 'dialogue', dialogue: this.talkTo(n) });
  }

  private useItem(slot: number) {
    const p = this.player;
    const s = p.inventory.slots[slot];
    if (!s) return;
    const d = itemDef(s.item);
    if (d.kind === 'food' && d.heal) {
      if (p.eatTimer > 0) return;
      if (p.hp >= p.maxHp) {
        this.message('You are already at full health.');
        return;
      }
      p.inventory.removeAt(slot, 1);
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + d.heal);
      p.eatTimer = 1.2;
      p.attackTimer = Math.max(p.attackTimer, 0.6);
      this.emit({ type: 'heal', id: p.id, amount: p.hp - before });
      this.message(`You eat the ${d.name.toLowerCase()}. It heals ${p.hp - before} HP.`, 'good');
    } else {
      this.message(d.examine);
    }
  }

  // ---------------------------------------------------------------- enemies

  private updateEnemy(e: Enemy, dt: number) {
    const p = this.player;
    e.swingAge += dt;
    e.hurtAge += dt;
    e.attackTimer -= dt;
    e.moving = false;
    const def = e.def;

    if (e.state === 'dead') {
      e.deadAge += dt;
      e.respawnTimer -= dt;
      if (e.respawnTimer <= 0) {
        e.state = 'idle';
        e.hp = def.maxHp;
        e.x = e.prevX = e.spawnX;
        e.z = e.prevZ = e.spawnZ;
        this.emit({ type: 'respawn', id: e.id });
      }
      return;
    }

    const dPlayer = dist(e.x, e.z, p.x, p.z);
    const dSpawn = dist(e.x, e.z, e.spawnX, e.spawnZ);

    if ((e.state === 'idle' || e.state === 'wander') && def.aggressive && !p.dead && dPlayer < def.aggroRange) {
      // Aggression fades once the player greatly out-levels the creature.
      if (p.skills.combatLevel() < def.level * 2 + 2 || def.id === 'goblin_warlord') {
        e.state = 'chase';
        e.target = p.id;
        e.attackTimer = Math.max(e.attackTimer, 0.8);
      }
    }

    switch (e.state) {
      case 'idle':
        e.idleTimer -= dt;
        if (e.idleTimer <= 0) {
          const a = this.rng() * Math.PI * 2;
          const r = this.rng() * def.wanderRadius;
          const wx = e.spawnX + Math.cos(a) * r;
          const wz = e.spawnZ + Math.sin(a) * r;
          if (!isBlocked(this.map, wx, wz)) {
            e.wander = { x: wx, z: wz };
            e.state = 'wander';
          }
          e.idleTimer = 2 + this.rng() * 4;
        }
        if (e.hp < def.maxHp) e.hp = Math.min(def.maxHp, e.hp + def.maxHp * 0.05 * dt);
        break;
      case 'wander': {
        if (!e.wander) {
          e.state = 'idle';
          break;
        }
        const d = dist(e.x, e.z, e.wander.x, e.wander.z);
        if (d < 0.2) {
          e.state = 'idle';
          e.wander = null;
          break;
        }
        const step = def.speed * 0.4 * dt;
        const moved = this.moveEntity(e, (e.wander.x - e.x) / d, (e.wander.z - e.z) / d, step);
        this.turnToward(e, e.wander.x, e.wander.z, dt);
        e.moving = true;
        if (moved < step * 0.3) {
          e.state = 'idle';
          e.wander = null;
        }
        break;
      }
      case 'chase': {
        if (p.dead || dSpawn > def.leashRange) {
          e.state = 'return';
          e.target = null;
          break;
        }
        this.turnToward(e, p.x, p.z, dt);
        if (dPlayer > def.attackRange * 0.9) {
          const step = def.speed * dt;
          this.moveEntity(e, (p.x - e.x) / dPlayer, (p.z - e.z) / dPlayer, step);
          e.moving = true;
        }
        if (dPlayer <= def.attackRange && e.attackTimer <= 0) this.enemyAttack(e);
        break;
      }
      case 'return': {
        if (dSpawn < 0.4) {
          e.state = 'idle';
          break;
        }
        const step = def.speed * 1.1 * dt;
        const moved = this.moveEntity(e, (e.spawnX - e.x) / dSpawn, (e.spawnZ - e.z) / dSpawn, step);
        if (moved < step * 0.2) {
          // Stuck: snap home so leashing never leaves creatures wedged on scenery.
          e.x = e.spawnX;
          e.z = e.spawnZ;
        }
        this.turnToward(e, e.spawnX, e.spawnZ, dt);
        e.moving = true;
        e.hp = Math.min(def.maxHp, e.hp + def.maxHp * 0.2 * dt);
        break;
      }
    }
  }

  private enemyAttack(e: Enemy) {
    const p = this.player;
    const def = e.def;
    e.attackTimer = def.attackSeconds;
    e.swingAge = 0;
    p.combatTimer = 6;
    this.emit({ type: 'attack', source: e.id, target: p.id, style: 'melee' });
    const r = rollHit(
      this.rng,
      { attackLevel: def.attack, strengthLevel: def.strength, accuracyBonus: 0, powerBonus: 0 },
      { defenceLevel: p.skills.level('defence'), armour: 0 },
      def.maxHit,
    );
    const dealt = Math.min(r.damage, p.hp);
    p.hp -= dealt;
    this.emit({ type: 'damage', target: p.id, source: e.id, amount: dealt, hit: r.hit });
    // Auto-retaliate: idle or gathering players fight back (but never override manual movement or a chosen target).
    const steering = Math.hypot(p.joy.x, p.joy.z) > 0.15 || p.path.length > 0;
    if ((!p.action || p.action.type === 'gather') && !steering && p.hp > 0) p.action = { type: 'attack', target: e.id };
    if (p.hp <= 0) this.killPlayer();
  }

  private killPlayer() {
    const p = this.player;
    p.dead = true;
    p.deathTimer = 20;
    p.action = null;
    p.path = [];
    p.joy.x = p.joy.z = 0;
    this.pending.length = 0;
    this.emit({ type: 'death', id: p.id });
    this.message('Oh dear, you have been defeated! Your belongings are safe.', 'bad');
    for (const e of this.enemies) {
      if (e.target === p.id) {
        e.target = null;
        e.state = 'return';
      }
    }
  }

  nearestCheckpoint(): Checkpoint {
    const p = this.player;
    let best = this.map.checkpoints[0];
    let bd = Infinity;
    for (const c of this.map.checkpoints) {
      if (!p.checkpoints.has(c.id)) continue;
      const d = dist(p.x, p.z, c.x, c.z);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  private respawnPlayer(at: 'home' | 'checkpoint') {
    const p = this.player;
    const c = at === 'home' ? this.map.checkpoints[0] : this.nearestCheckpoint();
    p.dead = false;
    p.hp = p.maxHp;
    p.x = p.prevX = c.respawnX;
    p.z = p.prevZ = c.respawnZ;
    p.attackTimer = 0;
    p.swingAge = 99;
    this.emit({ type: 'respawn', id: p.id });
    this.message(`You awaken at the ${c.name}.`, 'info');
  }

  // ---------------------------------------------------------------- movement helpers

  private turnToward(m: Mover, x: number, z: number, dt: number) {
    const want = Math.atan2(x - m.x, z - m.z);
    m.facing += angleDiff(m.facing, want) * Math.min(1, dt * 10);
  }

  private blockedAt(x: number, z: number): boolean {
    const r = ENTITY_RADIUS;
    return (
      isBlocked(this.map, x - r, z - r) ||
      isBlocked(this.map, x + r, z - r) ||
      isBlocked(this.map, x - r, z + r) ||
      isBlocked(this.map, x + r, z + r)
    );
  }

  /** Axis-separated collision so movement slides along walls. Returns the distance actually moved. */
  moveEntity(m: Mover, dx: number, dz: number, step: number): number {
    const ox = m.x;
    const oz = m.z;
    const nx = m.x + dx * step;
    if (!this.blockedAt(nx, m.z)) m.x = nx;
    const nz = m.z + dz * step;
    if (!this.blockedAt(m.x, nz)) m.z = nz;
    // If wedged inside a blocked tile (e.g. spawned on an edge), allow escape.
    if (m.x === ox && m.z === oz && this.blockedAt(ox, oz)) {
      m.x = nx;
      m.z = nz;
    }
    return Math.hypot(m.x - ox, m.z - oz);
  }

  // ---------------------------------------------------------------- quests & dialogue

  questProgress(id: string): QuestProgress | null {
    return this.player.quests[id] ?? null;
  }

  /** Whether the current quest stage objective is satisfied. */
  objectiveMet(q: QuestDef, prog: QuestProgress): boolean {
    const obj = q.stages[prog.stage]?.objective;
    if (!obj) return false;
    if (obj.type === 'collect') return this.player.inventory.count(obj.item) >= obj.count;
    if (obj.type === 'kill') return prog.kills >= obj.count;
    return false;
  }

  npcMarker(npcId: NpcId): 'available' | 'ready' | 'progress' | null {
    for (const q of Object.values(QUESTS)) {
      const prog = this.player.quests[q.id];
      if (!prog) {
        if (q.giver === npcId) return 'available';
        continue;
      }
      if (prog.done) continue;
      const obj = q.stages[prog.stage]?.objective;
      if (!obj || obj.type === 'talk' || obj.returnTo !== npcId) continue;
      return this.objectiveMet(q, prog) ? 'ready' : 'progress';
    }
    return null;
  }

  private talkTo(n: Npc): Dialogue {
    const p = this.player;
    const base = { npc: n.def.id, speaker: n.def.name, title: n.def.title };
    for (const q of Object.values(QUESTS)) {
      const prog = p.quests[q.id];
      if (!prog && q.giver === n.def.id) {
        return { ...base, lines: q.stages[0].completeLines, offer: { quest: q.id, label: `Accept quest: ${q.name}` } };
      }
      if (!prog || prog.done) continue;
      const stage = q.stages[prog.stage];
      const obj = stage?.objective;
      if (!obj || obj.type === 'talk' || obj.returnTo !== n.def.id) continue;
      if (!this.objectiveMet(q, prog)) return { ...base, lines: stage.pendingLines };
      if (obj.type === 'collect' && obj.consume) p.inventory.remove(obj.item, obj.count);
      const lines = stage.completeLines;
      prog.stage++;
      prog.kills = 0;
      if (prog.stage >= q.stages.length) {
        prog.done = true;
        for (const r of q.rewards.items) this.giveItem(r.item, r.qty);
        for (const [skill, amt] of Object.entries(q.rewards.xp)) this.grantXp(skill as SkillId, amt!);
        this.emit({ type: 'quest', quest: q.id, stage: prog.stage, complete: true });
        this.message(`Quest complete: ${q.name}!`, 'good');
        return { ...base, lines, rewards: q.rewards.text };
      }
      this.emit({ type: 'quest', quest: q.id, stage: prog.stage, complete: false });
      this.message(`Quest updated: ${q.stages[prog.stage].journal}`, 'good');
      return { ...base, lines };
    }
    const line = n.def.idleLines[n.idleLine % n.def.idleLines.length];
    n.idleLine++;
    return { ...base, lines: [line] };
  }

  private acceptQuest(id: string) {
    const q = QUESTS[id];
    const p = this.player;
    if (!q || p.quests[id]) return;
    p.quests[id] = { stage: 1, kills: 0, done: false };
    this.emit({ type: 'quest', quest: id, stage: 1, complete: false });
    this.message(`Quest started: ${q.name}. ${q.stages[1].journal}`, 'good');
  }

  // ---------------------------------------------------------------- queries for the client

  enemyById(id: number): Enemy | null {
    const e = this.byId.get(id);
    return e instanceof Enemy ? e : null;
  }
}
