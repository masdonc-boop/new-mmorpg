import { mulberry32, randInt, type Rng } from '../core/rng';
import { angleDiff, dist } from '../core/math';
import { ENEMIES, type EnemyDef } from '../data/enemies';
import { EQUIP_SLOTS, isItemId, itemDef, type EquipSlot, type ItemId } from '../data/items';
import { RECIPES, STATION_INFO, failChance, plural, recipeAt, type RecipeDef, type StationKind } from '../data/recipes';
import { SHOPS, sellPrice, shopFor, type ShopDef } from '../data/shops';
import { NPCS, type NpcDef, type NpcId } from '../data/npcs';
import { QUESTS, type QuestDef } from '../data/quests';
import { RESOURCES, gatherChance, type ResourceDef } from '../data/resources';
import { SKILL_INFO, type SkillId } from '../data/skills';
import { STYLES, combatXp, rollHit, type CombatStyle } from './combat';
import { Inventory, addTo, type ItemStack } from './inventory';
import { Equipment, equipFromInventory, unequipToInventory } from './equipment';
import { GRAVE_SECONDS, KEEP_ON_DEATH, takeLostOnDeath } from './death';
import { Toolbelt, addToBelt, bestTool, removeFromBelt, type ToolChoice } from './toolbelt';
import { toolLabel, type ToolCategory } from '../data/tools';
import { Bank, depositInventory, depositItem, depositStacks, withdrawItem, type TransferResult } from './bank';
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
  /** Move held overflow items into free inventory slots. */
  | { type: 'claimOverflow' }
  /** Permanently discard all held overflow items (the client confirms first). */
  | { type: 'discardOverflow' }
  /** Bank: deposit up to qty of the item in an inventory slot (all of that item type, across slots). */
  | { type: 'bankDeposit'; slot: number; qty: number }
  /** Bank: deposit the whole inventory. */
  | { type: 'bankDepositAll' }
  /** Bank: move held overflow items into the bank. */
  | { type: 'bankDepositHeld' }
  /** Bank: withdraw up to qty of an item (as many as fit). */
  | { type: 'bankWithdraw'; item: ItemId; qty: number }
  | { type: 'bankClose' }
  /** Wear the item in an inventory slot. */
  | { type: 'equip'; slot: number }
  /** Take off worn gear into the inventory. */
  | { type: 'unequip'; slot: EquipSlot }
  /** Make `count` of a recipe (at the open station, or anywhere for fletching). */
  | { type: 'craft'; recipe: string; count: number }
  /** Put the tool in an inventory slot on the toolbelt (swapping out the one in its category). */
  | { type: 'beltAdd'; slot: number }
  /** Take a tool off the toolbelt into the inventory. */
  | { type: 'beltRemove'; category: ToolCategory }
  /** Move every tool in the inventory whose belt slot is empty onto the toolbelt. */
  | { type: 'beltAddAll' }
  /** Open the fletching interface (needs no station). */
  | { type: 'openFletching' }
  | { type: 'closeProduction' }
  /** Shop: buy up to qty of an item the open shop sells. */
  | { type: 'shopBuy'; item: ItemId; qty: number }
  /** Shop: sell up to qty of the item in an inventory slot. */
  | { type: 'shopSell'; slot: number; qty: number }
  | { type: 'shopClose' }
  | { type: 'acceptQuest'; quest: string }
  /** Gameplay options that are part of the character (saved with it). */
  | { type: 'setOption'; option: 'autoGather'; on: boolean }
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
  | { type: 'region'; name: string; levels: string }
  | { type: 'inventoryFull' }
  | { type: 'bankOpen'; npc: NpcId }
  | { type: 'bankClose' }
  /** Bank contents changed (refresh the bank interface). */
  | { type: 'bank' }
  | { type: 'bankFull' }
  | { type: 'productionOpen'; station: StationKind }
  | { type: 'productionClose' }
  /** One make finished (success = the intended product, not e.g. burnt food). */
  | { type: 'craft'; recipe: string; success: boolean; remaining: number }
  /** Worn equipment changed. */
  | { type: 'equipment' }
  /** Toolbelt contents changed. */
  | { type: 'toolbelt' }
  | { type: 'shopOpen'; shop: string }
  | { type: 'shopClose' }
  /** A purchase or sale went through (refresh the shop interface). */
  | { type: 'shop' };

export type AnimState = 'idle' | 'walk' | 'attack' | 'chop' | 'mine' | 'dead' | 'hit';

export type PlayerAction =
  | { type: 'attack'; target: number }
  | { type: 'pickup'; ground: number }
  | { type: 'grave'; grave: number }
  | { type: 'station'; station: number }
  | { type: 'craft'; recipe: string; remaining: number; made: number }
  | { type: 'gather'; node: number }
  | { type: 'talk'; npc: number };

/** Monster drops stay visible only to the player who earned them for this long... */
export const LOOT_PRIVATE_SECONDS = 10 * 60;
/** Extra distance beyond a banker's reach before an open bank closes (walking away). */
export const BANK_LEAVE_MARGIN = 1.5;
/** ...then anyone can see and take them for this long, after which they disappear. */
export const LOOT_PUBLIC_SECONDS = 5 * 60;

/** A pile of items lying in the world (monster drops). */
export class GroundItem {
  age = 0;
  constructor(
    public readonly id: number,
    public readonly item: ItemId,
    public qty: number,
    public readonly x: number,
    public readonly z: number,
    /** Player who earned the drop; null once it was created public. */
    public readonly owner: number | null,
  ) {}

  /** Whether the pile is still in its owner-only period. */
  get isPrivate(): boolean {
    return this.owner !== null && this.age < LOOT_PRIVATE_SECONDS;
  }

  get expired(): boolean {
    return this.age >= LOOT_PRIVATE_SECONDS + LOOT_PUBLIC_SECONDS || this.qty <= 0;
  }

  /** Who may see and pick it up: the owner first, then everyone. */
  visibleTo(playerId: number): boolean {
    return !this.expired && (!this.isPrivate || this.owner === playerId);
  }

  /** Seconds until it becomes public (0 if it already is) and until it disappears. */
  get timers() {
    return {
      untilPublic: Math.max(0, LOOT_PRIVATE_SECONDS - this.age),
      untilGone: Math.max(0, LOOT_PRIVATE_SECONDS + LOOT_PUBLIC_SECONDS - this.age),
    };
  }
}

/**
 * Where a player's at-risk items go when they die (OSRS-style gravestone). Only its owner can loot
 * it, and it crumbles, with whatever is left, after GRAVE_SECONDS of play.
 */
export class Gravestone {
  age = 0;
  constructor(
    public readonly id: number,
    public readonly x: number,
    public readonly z: number,
    public readonly owner: number,
    public items: ItemStack[],
  ) {}

  get expired(): boolean {
    return this.age >= GRAVE_SECONDS || this.items.length === 0;
  }

  get secondsLeft(): number {
    return Math.max(0, GRAVE_SECONDS - this.age);
  }

  get count(): number {
    return this.items.reduce((a, s) => a + s.qty, 0);
  }
}

export interface SavedGrave {
  x: number;
  z: number;
  age: number;
  items: ItemStack[];
}

export interface SavedGroundItem {
  item: ItemId;
  qty: number;
  x: number;
  z: number;
  owner: number | null;
  age: number;
}

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
  /**
   * Items that could not fit when an older save was migrated to the current inventory rules.
   * They are kept (and saved) until the player claims them into free slots or discards them.
   */
  overflow: ItemStack[] = [];
  /** Bank storage (per character for now; see Bank). */
  bank = new Bank();
  /** Id of the banker the player is using, while the bank interface is open. */
  bankAt: number | null = null;
  /** Worn gear (separate from the 28-slot inventory). */
  equipment = new Equipment();
  /** Tools kept off the inventory (one per category). */
  toolbelt = new Toolbelt();
  /** Station whose production interface is open (null for none or for fletching). */
  stationAt: number | null = null;
  /** Shopkeeper whose shop is open. */
  shopAt: number | null = null;
  /** One-time grants already given to this character (e.g. tools added after an update). */
  grants = new Set<string>();
  /** Walk on to the next node of the same kind when one runs out (a setting; off by default, as in OSRS). */
  autoGather = false;
  /** What happened to the player's items at their latest death (for the death screen). */
  lastDeath: { kept: ItemStack[]; lost: number; grave: number | null } | null = null;
  craftTimer = 0;
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

/** A production station in the world (furnace, anvil, cooking range). */
export class Station {
  constructor(
    public readonly id: number,
    public readonly kind: Exclude<StationKind, 'fletching'>,
    public readonly x: number,
    public readonly z: number,
  ) {}

  get name(): string {
    return STATION_INFO[this.kind].name;
  }
}

/** How close the player must stand to use a station, and the extra distance before it closes. */
export const STATION_REACH = 1.7;
const STATION_LEAVE_MARGIN = 1.2;

export class ResourceNode {
  depleted = false;
  respawnTimer = 0;
  /** Seconds since last gather hit (for shake animation). */
  hitAge = 99;
  constructor(public id: number, public def: ResourceDef, public x: number, public z: number, public index: number) {}
}

export const NPC_WALK_SPEED = 1.5;

export class Npc {
  facing: number;
  talkAge = 99;
  idleLine = 0;
  prevX: number;
  prevZ: number;
  moving = false;
  waypoint = 1;
  waitTimer = 2;
  constructor(
    public id: number,
    public def: NpcDef,
    public x: number,
    public z: number,
    public baseFacing: number,
    public patrol: { x: number; z: number }[] | null = null,
  ) {
    this.facing = baseFacing;
    this.prevX = x;
    this.prevZ = z;
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
  | { kind: 'npc'; entity: Npc }
  | { kind: 'ground'; entity: GroundItem }
  | { kind: 'grave'; entity: Gravestone }
  | { kind: 'station'; entity: Station };

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
  /** Held items that did not fit in the inventory (see Player.overflow). Optional for older saves. */
  overflow?: ItemStack[];
  /** Bank contents (optional: saves from before the bank start with an empty bank). */
  bank?: ItemStack[];
  /** Worn equipment (optional for older saves). */
  equipment?: Partial<Record<EquipSlot, ItemId>>;
  /** Size of the worn ammo stack. */
  ammoQty?: number;
  /** Gameplay options (optional for older saves). */
  options?: { autoGather?: boolean };
  /** Gravestones still standing (optional for older saves). */
  graves?: SavedGrave[];
  /** One-time grants already received (optional for older saves). */
  grants?: string[];
  /** Toolbelt contents by category (optional for older saves). */
  toolbelt?: Partial<Record<ToolCategory, ItemId>>;
  quests: Record<string, QuestProgress>;
  checkpoints: string[];
  /** Monster drops still on the ground (optional for older saves). */
  ground?: SavedGroundItem[];
}

export class GameWorld {
  readonly map: WorldMap;
  readonly player: Player;
  readonly enemies: Enemy[] = [];
  readonly nodes: ResourceNode[] = [];
  readonly npcs: Npc[] = [];
  readonly stations: Station[] = [];
  groundItems: GroundItem[] = [];
  graves: Gravestone[] = [];
  private nextGroundId = 20000;
  readonly rng: Rng;
  time = 0;
  private events: GameEvent[] = [];
  private pending: PendingHit[] = [];
  private byId = new Map<number, Enemy | ResourceNode | Npc | GroundItem | Station | Gravestone>();

  constructor(opts: { seed?: number; name?: string; appearance?: Appearance; save?: SaveData | null } = {}) {
    this.map = generateWorld(opts.seed ?? 1337);
    this.rng = mulberry32((opts.seed ?? 1337) ^ 0x5eed);
    const s = opts.save;
    this.player = new Player(s?.name ?? opts.name ?? 'Adventurer', s?.appearance ?? opts.appearance ?? DEFAULT_APPEARANCE, this.map.spawn.x, this.map.spawn.z);
    if (s) this.loadPlayer(s);
    else this.giveStarterKit();

    this.map.npcs.forEach((n, i) => {
      const npc = new Npc(100 + i, NPCS[n.id], n.x, n.z, n.facing, n.patrol ?? null);
      this.npcs.push(npc);
      this.byId.set(npc.id, npc);
    });
    this.map.stations.forEach((st, i) => {
      const station = new Station(3000 + i, st.kind, st.x, st.z);
      this.stations.push(station);
      this.byId.set(station.id, station);
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
    if (s && Array.isArray(s.ground)) {
      for (const g of s.ground) {
        const qty = Math.floor(Number(g?.qty));
        const age = Number(g?.age);
        if (!g || typeof g.item !== 'string' || !isItemId(g.item) || !(qty > 0) || !Number.isFinite(g.x) || !Number.isFinite(g.z)) continue;
        const pile = this.spawnGroundItem(g.item, qty, g.x, g.z, typeof g.owner === 'number' ? g.owner : null);
        pile.age = Number.isFinite(age) && age > 0 ? age : 0;
      }
      this.groundItems = this.groundItems.filter((g) => !g.expired);
    }
    if (s && Array.isArray(s.graves)) {
      for (const g of s.graves) {
        if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.z) || !Array.isArray(g.items)) continue;
        const items: ItemStack[] = [];
        for (const it of g.items) {
          const qty = Math.floor(Number(it?.qty));
          if (it && typeof it.item === 'string' && isItemId(it.item) && qty > 0) addTo(items, it.item, qty);
        }
        const grave = this.spawnGrave(g.x, g.z, items);
        grave.age = Number.isFinite(g.age) && g.age > 0 ? g.age : 0;
      }
      this.graves = this.graves.filter((g) => !g.expired);
    }
  }

  /** Tools every character should own once (older saves receive them after the production update). */
  static readonly STARTER_TOOLS: ItemId[] = ['hammer', 'knife', 'small_fishing_net'];
  /** Everything a new character starts with on the toolbelt. */
  static readonly STARTER_BELT: ItemId[] = ['bronze_pickaxe', 'bronze_axe', 'hammer', 'knife', 'small_fishing_net'];

  /** Once, when the toolbelt arrives: move the tools already in the bag onto it (frees their slots). */
  private introduceToolbelt() {
    const p = this.player;
    if (p.grants.has('toolbelt-v1')) return;
    p.grants.add('toolbelt-v1');
    const moved = this.beltAddAll(false);
    if (moved.length) this.message(`New: the toolbelt! Your ${moved.join(', ')} moved onto it and no longer use bag slots.`, 'good');
  }

  /**
   * Gives existing characters the production tools once. Anything already owned (bag, bank or worn)
   * is skipped; tools that don't fit go to "held for you" rather than being lost.
   */
  /** Once, when the ammo slot arrives: arrows in the bag move into it (bows now fire from there). */
  private introduceAmmoSlot() {
    const p = this.player;
    if (p.grants.has('ammo-v1')) return;
    p.grants.add('ammo-v1');
    if (p.equipment.slots.ammo) return;
    const i = p.inventory.slots.findIndex((s) => s && itemDef(s.item).equip?.slot === 'ammo');
    if (i < 0) return;
    const n = p.inventory.slots[i]!.qty;
    if (equipFromInventory(p.equipment, p.inventory, i, (sk) => p.skills.level(sk)).ok) {
      this.message(`New: the ammo slot! Your ${n} arrows moved into it. Bows fire from the ammo slot now.`, 'good');
    }
  }

  private grantProductionTools() {
    const p = this.player;
    if (p.grants.has('tools-v1')) return;
    p.grants.add('tools-v1');
    const given: string[] = [];
    for (const t of GameWorld.STARTER_TOOLS) {
      if (p.inventory.count(t) > 0 || p.bank.count(t) > 0 || p.toolbelt.count(t) > 0 || p.overflow.some((o) => o.item === t)) continue;
      if (p.inventory.add(t, 1) !== 1) addTo(p.overflow, t, 1);
      given.push(itemDef(t).name.toLowerCase());
    }
    if (given.length) this.message(`Tilly left you some tools for the new skills: ${given.join(', ')}.`, 'good');
  }

  private giveStarterKit() {
    const inv = this.player.inventory;
    this.player.grants.add('tools-v1');
    this.player.grants.add('toolbelt-v1');
    this.player.grants.add('ammo-v1');
    for (const t of GameWorld.STARTER_BELT) this.player.toolbelt.slots[itemDef(t).tool!.category] = t;
    inv.add('bread', 2);
    this.player.equipment.slots.ammo = 'bronze_arrow';
    this.player.equipment.ammoQty = 60;
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
      overflow: p.overflow.map((o) => ({ ...o })),
      bank: p.bank.toJSON(),
      equipment: p.equipment.toJSON(),
      ammoQty: p.equipment.ammoQty,
      options: { autoGather: p.autoGather },
      graves: this.graves.filter((g) => !g.expired).map((g) => ({ x: g.x, z: g.z, age: g.age, items: g.items.map((i) => ({ ...i })) })),
      grants: [...p.grants],
      toolbelt: p.toolbelt.toJSON(),
      quests: JSON.parse(JSON.stringify(p.quests)),
      checkpoints: [...p.checkpoints],
      ground: this.groundItems.filter((g) => !g.expired).map((g) => ({ item: g.item, qty: g.qty, x: g.x, z: g.z, owner: g.owner, age: g.age })),
    };
  }

  private loadPlayer(s: SaveData) {
    const p = this.player;
    p.skills = new Skills(s.xp);
    p.bank = Bank.restore(s.bank);
    const restored = Inventory.restore(s.inventory);
    p.inventory = restored.inventory;
    p.overflow = restored.overflow;
    const worn = Equipment.restore(s.equipment, s.ammoQty);
    p.equipment = worn.equipment;
    for (const d of worn.displaced) addTo(p.overflow, d.item, d.qty);
    p.grants = new Set(Array.isArray(s.grants) ? s.grants.filter((g) => typeof g === 'string') : []);
    const belt = Toolbelt.restore(s.toolbelt);
    p.toolbelt = belt.belt;
    for (const d of belt.displaced) addTo(p.overflow, d.item, d.qty);
    this.grantProductionTools();
    this.introduceToolbelt();
    this.introduceAmmoSlot();
    p.autoGather = s.options?.autoGather === true;
    if (Array.isArray(s.overflow)) {
      for (const o of s.overflow) {
        const qty = Math.floor(Number(o?.qty));
        if (o && typeof o.item === 'string' && isItemId(o.item) && qty > 0) addTo(p.overflow, o.item, qty);
      }
    }
    if (p.overflow.length) {
      const n = p.overflow.reduce((a, o) => a + o.qty, 0);
      this.message(`Logs, ores and gems now take one slot each. ${n} item${n === 1 ? '' : 's'} that didn't fit are being held for you: open your bag to collect them.`, 'warn');
    }
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

  get(id: number): Enemy | ResourceNode | Npc | GroundItem | Station | Gravestone | undefined {
    return this.byId.get(id);
  }

  interactable(id: number): Interactable | null {
    const e = this.byId.get(id);
    if (e instanceof Enemy) return { kind: 'enemy', entity: e };
    if (e instanceof ResourceNode) return { kind: 'node', entity: e };
    if (e instanceof Npc) return { kind: 'npc', entity: e };
    if (e instanceof GroundItem) return e.visibleTo(this.player.id) ? { kind: 'ground', entity: e } : null;
    if (e instanceof Station) return { kind: 'station', entity: e };
    if (e instanceof Gravestone) return !e.expired && e.owner === this.player.id ? { kind: 'grave', entity: e } : null;
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
          const w = p.equipment.bonuses(cmd.style).weapon;
          this.message(`Combat style: ${STYLES[cmd.style].name} (${w ? itemDef(w).name : STYLES[cmd.style].weapon}).`);
        }
        break;
      case 'useItem':
        this.useItem(cmd.slot);
        break;
      case 'dropItem': {
        if (!Number.isInteger(cmd.slot)) break;
        const s = p.inventory.removeAt(cmd.slot);
        if (s) this.message(`You drop ${s.qty > 1 ? s.qty + ' x ' : ''}${itemDef(s.item).name}.`);
        break;
      }
      case 'swapItems':
        p.inventory.swap(cmd.a, cmd.b);
        break;
      case 'claimOverflow':
        this.claimOverflow();
        break;
      case 'bankDeposit':
      case 'bankDepositAll':
      case 'bankDepositHeld':
      case 'bankWithdraw':
        this.bankCommand(cmd);
        break;
      case 'equip':
        this.equip(cmd.slot);
        break;
      case 'unequip':
        this.unequip(cmd.slot);
        break;
      case 'craft':
        this.startCraft(cmd.recipe, cmd.count);
        break;
      case 'beltAdd': {
        if (!Number.isInteger(cmd.slot)) break;
        const r = addToBelt(p.toolbelt, p.inventory, cmd.slot);
        if (r.ok) {
          this.message(`You put the ${itemDef(r.added!).name.toLowerCase()} on your toolbelt${r.replaced ? ` (the ${itemDef(r.replaced).name.toLowerCase()} goes back in your bag)` : ''}.`);
          this.emit({ type: 'toolbelt' });
        } else if (r.reason === 'notTool') this.message("That isn't a tool.");
        break;
      }
      case 'beltRemove': {
        const r = removeFromBelt(p.toolbelt, p.inventory, cmd.category);
        if (r.ok) {
          this.message(`You take the ${itemDef(r.removed!).name.toLowerCase()} off your toolbelt.`);
          this.emit({ type: 'toolbelt' });
        } else if (r.reason === 'space') this.inventoryFull();
        break;
      }
      case 'beltAddAll': {
        const moved = this.beltAddAll(true);
        if (moved.length) this.message(`Moved to your toolbelt: ${moved.join(', ')}.`);
        else this.message('No tools in your bag need moving (each belt slot holds one tool).');
        break;
      }
      case 'openFletching':
        p.stationAt = null;
        this.emit({ type: 'productionOpen', station: 'fletching' });
        break;
      case 'closeProduction':
        p.stationAt = null;
        break;
      case 'shopBuy':
        this.shopBuy(cmd.item, cmd.qty);
        break;
      case 'shopSell':
        this.shopSell(cmd.slot, cmd.qty);
        break;
      case 'shopClose':
        if (p.shopAt !== null) {
          p.shopAt = null;
          this.emit({ type: 'shopClose' });
        }
        break;
      case 'bankClose':
        if (p.bankAt !== null) {
          p.bankAt = null;
          this.emit({ type: 'bankClose' });
        }
        break;
      case 'discardOverflow':
        if (p.overflow.length) {
          p.overflow = [];
          this.message('You discard the held items.');
        }
        break;
      case 'acceptQuest':
        this.acceptQuest(cmd.quest);
        break;
      case 'setOption':
        if (cmd.option === 'autoGather') p.autoGather = cmd.on === true;
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
    this.updateGroundItems(dt);
    this.updateGraves(dt);
    if (p.shopAt !== null && !this.activeShop()) {
      p.shopAt = null;
      this.emit({ type: 'shopClose' });
    }
    if (p.stationAt !== null && !this.activeStation()) {
      p.stationAt = null;
      this.emit({ type: 'productionClose' });
    }
    if (p.bankAt !== null && !this.activeBanker()) {
      p.bankAt = null;
      this.emit({ type: 'bankClose' });
    }
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
    for (const n of this.npcs) this.updateNpc(n, dt);
    // Resolve projectile hits.
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const h = this.pending[i];
      if (h.at > this.time) continue;
      this.pending.splice(i, 1);
      const e = this.byId.get(h.target);
      if (e instanceof Enemy && e.alive) this.damageEnemy(e, h.damage, h.hit, h.style);
    }
  }

  /** Idle NPCs turn to face a nearby player; patrolling NPCs walk their route, pausing to chat. */
  private updateNpc(n: Npc, dt: number) {
    const p = this.player;
    n.talkAge += dt;
    n.prevX = n.x;
    n.prevZ = n.z;
    n.moving = false;
    const d = dist(n.x, n.z, p.x, p.z);
    const engaged = n.talkAge < 4 || (p.action?.type === 'talk' && p.action.npc === n.id) || d < 1.6;
    let want = d < 4 ? Math.atan2(p.x - n.x, p.z - n.z) : n.baseFacing;
    if (n.patrol && !engaged) {
      if (n.waitTimer > 0) {
        n.waitTimer -= dt;
      } else {
        const wp = n.patrol[n.waypoint];
        const dw = dist(n.x, n.z, wp.x, wp.z);
        if (dw < 0.05) {
          n.waypoint = (n.waypoint + 1) % n.patrol.length;
          n.waitTimer = 2 + this.rng() * 3;
        } else {
          const step = Math.min(dw, NPC_WALK_SPEED * dt);
          n.x += ((wp.x - n.x) / dw) * step;
          n.z += ((wp.z - n.z) / dw) * step;
          n.moving = true;
          want = Math.atan2(wp.x - n.x, wp.z - n.z);
        }
      }
      if (!n.moving && d >= 4) want = n.facing;
    }
    n.facing += angleDiff(n.facing, want) * Math.min(1, dt * (n.moving ? 8 : 5));
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
    else if (action?.type === 'pickup') this.updatePickup(action.ground);
    else if (action?.type === 'grave') this.updateGrave(action.grave);
    else if (action?.type === 'station') this.updateStationApproach(action.station);
    else if (action?.type === 'craft') this.updateCraft(action, dt);

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
    } else if (it.kind === 'ground') {
      p.action = { type: 'pickup', ground: id };
    } else if (it.kind === 'grave') {
      p.action = { type: 'grave', grave: id };
    } else if (it.kind === 'station') {
      p.action = { type: 'station', station: id };
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

    if (style.ammo && this.ammoLeft() <= 0) {
      const name = itemDef(style.ammo).name.toLowerCase();
      if (style.ammoWorn && p.inventory.has(style.ammo)) this.message(`Equip your ${name} first: bows fire from the ammo slot. Tap them in your bag.`, 'warn');
      else this.message(`You have no ${name} left. Switch style or find more.`, 'warn');
      p.action = null;
      return;
    }
    if (style.ammo) {
      if (style.ammoWorn) p.equipment.useAmmo(style.ammo);
      else p.inventory.remove(style.ammo, 1);
      if (style.ammoWorn && !p.equipment.slots.ammo) this.emit({ type: 'equipment' });
    }

    p.facing = Math.atan2(e.x - p.x, e.z - p.z);
    p.attackTimer = style.attackSeconds;
    p.swingAge = 0;
    p.combatTimer = 6;
    const sk = p.skills;
    const attackSkill: SkillId = p.style === 'melee' ? 'attack' : p.style;
    const gear = this.playerBonuses();
    const result = rollHit(
      this.rng,
      { attackLevel: sk.level(attackSkill), strengthLevel: p.style === 'melee' ? sk.level('strength') : sk.level(attackSkill), accuracyBonus: gear.accuracy, powerBonus: gear.power },
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

  /** Shots or casts left for the current style (worn ammo for bows, bag runes for magic). */
  ammoLeft(): number {
    const p = this.player;
    const style = STYLES[p.style];
    if (!style.ammo) return Infinity;
    return style.ammoWorn ? (p.equipment.slots.ammo === style.ammo ? p.equipment.ammoQty : 0) : p.inventory.count(style.ammo);
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
    // Drops land on the ground where the enemy fell, reserved for the player who earned them.
    let k = 0;
    for (const d of e.def.drops) {
      if (this.rng() > d.chance) continue;
      const a = k++ * 2.4 + this.rng() * 0.6;
      const r = k === 1 ? 0.2 : 0.65;
      const at = this.walkableNear(e.x + Math.sin(a) * r, e.z + Math.cos(a) * r, e.x, e.z);
      this.spawnGroundItem(d.item, randInt(this.rng, d.min, d.max), at.x, at.z, p.id);
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

  spawnGroundItem(item: ItemId, qty: number, x: number, z: number, owner: number | null): GroundItem {
    const g = new GroundItem(this.nextGroundId++, item, qty, x, z, owner);
    this.groundItems.push(g);
    this.byId.set(g.id, g);
    return g;
  }

  /** Ground piles the given player can currently see. */
  visibleGroundItems(playerId = this.player.id): GroundItem[] {
    return this.groundItems.filter((g) => g.visibleTo(playerId));
  }

  private walkableNear(x: number, z: number, fx: number, fz: number) {
    return isBlocked(this.map, x, z) ? { x: fx, z: fz } : { x, z };
  }

  private updateGroundItems(dt: number) {
    let removed = false;
    for (const g of this.groundItems) {
      g.age += dt;
      if (g.expired) {
        this.byId.delete(g.id);
        removed = true;
      }
    }
    if (removed) this.groundItems = this.groundItems.filter((g) => !g.expired);
  }

  spawnGrave(x: number, z: number, items: ItemStack[]): Gravestone {
    const g = new Gravestone(this.nextGroundId++, x, z, this.player.id, items);
    this.graves.push(g);
    this.byId.set(g.id, g);
    return g;
  }

  private updateGraves(dt: number) {
    let removed = false;
    for (const g of this.graves) {
      g.age += dt;
      if (g.expired) {
        if (g.items.length) this.message('Your gravestone has crumbled away, and the items in it are gone.', 'bad');
        this.byId.delete(g.id);
        removed = true;
      }
    }
    if (removed) this.graves = this.graves.filter((g) => !g.expired);
  }

  private updateGrave(id: number) {
    const p = this.player;
    const g = this.byId.get(id);
    if (!(g instanceof Gravestone) || g.expired) {
      p.action = null;
      return;
    }
    if (!this.approach(g.x, g.z, 1.2, true)) return;
    p.action = null;
    this.lootGrave(g);
  }

  /** Takes back as much from a gravestone as fits; the rest waits in it. */
  private lootGrave(g: Gravestone) {
    const p = this.player;
    let moved = 0;
    for (const s of g.items) {
      const added = p.inventory.add(s.item, s.qty);
      s.qty -= added;
      moved += added;
    }
    g.items = g.items.filter((s) => s.qty > 0);
    if (moved === 0) {
      this.inventoryFull();
      return;
    }
    if (g.items.length === 0) {
      this.message(`You take back all ${moved} item${moved === 1 ? '' : 's'} from your gravestone.`, 'good');
      this.byId.delete(g.id);
      this.graves = this.graves.filter((x) => x !== g);
    } else {
      this.message(`You take back ${moved} item${moved === 1 ? '' : 's'}. ${g.count} still wait in your gravestone: make room and tap it again.`, 'warn');
      this.emit({ type: 'inventoryFull' });
    }
  }

  private updatePickup(id: number) {
    const p = this.player;
    const g = this.byId.get(id);
    if (!(g instanceof GroundItem) || !g.visibleTo(p.id)) {
      p.action = null;
      return;
    }
    if (!this.approach(g.x, g.z, 0.8, true)) return;
    p.action = null;
    this.pickUp(g);
  }

  /** Takes as much of a pile as fits; the rest stays on the ground. */
  private pickUp(g: GroundItem) {
    const p = this.player;
    const added = p.inventory.add(g.item, g.qty);
    if (added <= 0) {
      this.inventoryFull();
      return;
    }
    g.qty -= added;
    this.emit({ type: 'loot', item: g.item, qty: added });
    const name = itemDef(g.item).name;
    this.message(`You pick up ${added > 1 ? `${added} x ` : ''}${name}.`);
    if (g.qty <= 0) {
      this.byId.delete(g.id);
      this.groundItems = this.groundItems.filter((x) => x !== g);
    } else this.inventoryFull();
  }

  // ---------------------------------------------------------------- equipment

  /**
   * Combat bonuses from worn gear. A weapon counts only with its own combat style; without one the
   * style's training weapon (STYLES) applies, so unarmed progress from older saves is unchanged.
   */
  playerBonuses(): { accuracy: number; power: number; armour: number; weapon: ItemId | null } {
    const p = this.player;
    const b = p.equipment.bonuses(p.style);
    const style = STYLES[p.style];
    return { accuracy: b.weapon ? b.accuracy : style.accuracy, power: b.weapon ? b.power : style.power, armour: b.armour, weapon: b.weapon };
  }

  private equip(slot: number) {
    const p = this.player;
    if (!Number.isInteger(slot)) return;
    const st = p.inventory.slots[slot];
    if (!st) return;
    const r = equipFromInventory(p.equipment, p.inventory, slot, (s) => p.skills.level(s));
    const name = itemDef(st.item).name;
    if (!r.ok) {
      if (r.reason === 'level' && r.need) this.message(`You need ${SKILL_INFO[r.need.skill].name} level ${r.need.level} to wear the ${name.toLowerCase()}.`, 'warn');
      else if (r.reason === 'space') this.message('Not enough inventory space to swap your gear.', 'warn');
      else if (r.reason === 'notEquippable') this.message(`You can't wear the ${name.toLowerCase()}.`);
      return;
    }
    const e = itemDef(st.item).equip!;
    // Wielding a weapon switches to the combat style it is made for.
    if (e.slot === 'weapon' && e.style && e.style !== p.style) {
      p.style = e.style;
      this.message(`Combat style: ${STYLES[e.style].name}.`);
    }
    if (e.slot === 'ammo') this.message(`You equip your ${name.toLowerCase()} (${p.equipment.ammoQty} in your ammo slot).`);
    else this.message(`You ${e.slot === 'weapon' ? 'wield' : 'wear'} the ${name.toLowerCase()}.`);
    this.emit({ type: 'equipment' });
  }

  private unequip(slot: EquipSlot) {
    const p = this.player;
    if (!EQUIP_SLOTS.includes(slot)) return;
    const it = p.equipment.get(slot);
    const r = unequipToInventory(p.equipment, p.inventory, slot);
    if (!r.ok) {
      if (r.reason === 'space') this.inventoryFull();
      return;
    }
    this.message(`You take off the ${itemDef(it!).name.toLowerCase()}.`);
    this.emit({ type: 'equipment' });
  }

  // ---------------------------------------------------------------- production

  private activeStation(): Station | null {
    const p = this.player;
    if (p.stationAt === null || p.dead) return null;
    const st = this.byId.get(p.stationAt);
    if (!(st instanceof Station)) return null;
    return dist(p.x, p.z, st.x, st.z) <= STATION_REACH + STATION_LEAVE_MARGIN ? st : null;
  }

  private updateStationApproach(id: number) {
    const p = this.player;
    const st = this.byId.get(id);
    if (!(st instanceof Station)) {
      p.action = null;
      return;
    }
    if (!this.approach(st.x, st.z, STATION_REACH, true)) return;
    p.action = null;
    p.facing = Math.atan2(st.x - p.x, st.z - p.z);
    p.stationAt = st.id;
    this.emit({ type: 'productionOpen', station: st.kind });
  }

  /** Why a recipe can't be made right now (null if it can). Checks level, materials, place and space. */
  craftBlocker(id: string): string | null {
    const p = this.player;
    const rec = RECIPES[id];
    if (!rec) return 'Unknown recipe.';
    const at = this.activeStation();
    if (rec.station !== 'fletching' && !(at && recipeAt(rec, at.kind))) return `You need to be at a ${STATION_INFO[rec.station].name.toLowerCase()}.`;
    if (rec.tool) {
      const t = this.toolFor(rec.tool);
      if (!t.tool) return t.why;
    }
    if (p.skills.level(rec.skill) < rec.level) return `You need ${SKILL_INFO[rec.skill].name} level ${rec.level}.`;
    for (const inp of rec.inputs) {
      if (p.inventory.count(inp.item) < inp.qty) return `You need ${inp.qty} ${itemDef(inp.item).name.toLowerCase()}.`;
    }
    if (!this.outputFits(rec)) return 'Your inventory is full.';
    return null;
  }

  /** How many times the recipe could be made with the current materials (space checked per make). */
  craftableCount(id: string): number {
    const rec = RECIPES[id];
    if (!rec) return 0;
    return Math.min(...rec.inputs.map((i) => Math.floor(this.player.inventory.count(i.item) / i.qty)));
  }

  /** Whether the product (and any failure product) fits once the ingredients are used. */
  private outputFits(rec: RecipeDef): boolean {
    const sim = this.player.inventory.clone();
    for (const inp of rec.inputs) sim.remove(inp.item, inp.qty);
    if (sim.clone().add(rec.output.item, rec.output.qty) !== rec.output.qty) return false;
    return !rec.fail || sim.add(rec.fail.output, 1) === 1;
  }

  private startCraft(id: string, count: number) {
    const p = this.player;
    const rec = RECIPES[id];
    if (!rec) return;
    const n = Math.max(1, Math.min(1000, Math.floor(Number(count)) || 1));
    const blocked = this.craftBlocker(id);
    if (blocked) {
      if (blocked === 'Your inventory is full.') this.inventoryFull();
      else this.message(blocked, 'warn');
      return;
    }
    p.path = [];
    p.action = { type: 'craft', recipe: id, remaining: n, made: 0 };
    p.craftTimer = rec.seconds * 0.6;
  }

  /** The recipe being made right now, while the player is at work (for animation and status). */
  get crafting(): RecipeDef | null {
    const a = this.player.action;
    return a?.type === 'craft' ? (RECIPES[a.recipe] ?? null) : null;
  }

  private updateCraft(a: Extract<PlayerAction, { type: 'craft' }>, dt: number) {
    const p = this.player;
    const rec = RECIPES[a.recipe];
    if (!rec) {
      p.action = null;
      return;
    }
    const st = rec.station !== 'fletching' ? this.activeStation() : null;
    if (st) p.facing = Math.atan2(st.x - p.x, st.z - p.z);
    p.craftTimer -= dt;
    if (p.craftTimer > 0) return;
    p.craftTimer = rec.seconds;
    const blocked = this.craftBlocker(a.recipe);
    if (blocked) {
      p.action = null;
      if (a.made > 0) this.message(`You make ${a.made} ${plural(itemDef(rec.output.item).name.toLowerCase(), a.made)}.`, 'good');
      if (blocked === 'Your inventory is full.') this.inventoryFull();
      else this.message(blocked, a.made > 0 ? 'info' : 'warn');
      return;
    }
    // One make, all or nothing: ingredients and space were just checked together.
    const failed = this.rng() < failChance(rec, p.skills.level(rec.skill));
    for (const inp of rec.inputs) p.inventory.remove(inp.item, inp.qty);
    const outItem = failed && rec.fail ? rec.fail.output : rec.output.item;
    const outQty = failed ? 1 : rec.output.qty;
    if (p.inventory.add(outItem, outQty) !== outQty) throw new Error('craft invariant broken');
    this.emit({ type: 'loot', item: outItem, qty: outQty });
    if (failed) this.message(`You accidentally ruin it: ${itemDef(outItem).name.toLowerCase()}.`, 'warn');
    else {
      this.grantXp(rec.skill, rec.xp);
      a.made++;
    }
    a.remaining--;
    this.emit({ type: 'craft', recipe: rec.id, success: !failed, remaining: a.remaining });
    if (a.remaining <= 0) {
      p.action = null;
      if (a.made > 1) this.message(`You make ${a.made} ${plural(itemDef(rec.output.item).name.toLowerCase(), a.made)}.`, 'good');
    }
  }

  // ---------------------------------------------------------------- toolbelt

  /**
   * Moves bag tools onto empty belt slots (best tier first). Never replaces a belt tool, so this
   * can't push anything back into a full bag. Returns the names moved.
   */
  private beltAddAll(emit: boolean): string[] {
    const p = this.player;
    const moved: string[] = [];
    const order = p.inventory.slots
      .map((s, i) => ({ s, i }))
      .filter((x) => x.s && itemDef(x.s.item).tool)
      .sort((a, b) => itemDef(b.s!.item).tool!.tier - itemDef(a.s!.item).tool!.tier);
    for (const { s, i } of order) {
      const info = itemDef(s!.item).tool!;
      if (p.toolbelt.get(info.category)) continue;
      if (addToBelt(p.toolbelt, p.inventory, i).ok) moved.push(itemDef(s!.item).name.toLowerCase());
    }
    if (moved.length && emit) this.emit({ type: 'toolbelt' });
    return moved;
  }

  /** The tool used for a category right now (belt or bag; best usable tier), or why there is none. */
  toolFor(c: ToolCategory): { tool: ToolChoice | null; why: string } {
    const p = this.player;
    const r = bestTool(c, p.toolbelt, p.inventory, (s) => p.skills.level(s));
    if (r.tool) return { tool: r.tool, why: '' };
    if (r.blocked) {
      const req = itemDef(r.blocked).tool!.req!;
      return { tool: null, why: `You need ${SKILL_INFO[req.skill].name} level ${req.level} to use your ${itemDef(r.blocked).name.toLowerCase()}.` };
    }
    return { tool: null, why: `You need ${/^[aeiou]/i.test(toolLabel(c)) ? 'an' : 'a'} ${toolLabel(c).toLowerCase()} in your bag or toolbelt.` };
  }

  // ---------------------------------------------------------------- shop

  /** The open shop, if the player is still at its shopkeeper. */
  activeShop(): ShopDef | null {
    const p = this.player;
    if (p.shopAt === null || p.dead) return null;
    const n = this.byId.get(p.shopAt);
    if (!(n instanceof Npc)) return null;
    if (dist(p.x, p.z, n.x, n.z) > (n.def.reach ?? 1.9) + BANK_LEAVE_MARGIN) return null;
    return shopFor(n.def.id);
  }

  /**
   * Buys as many as possible up to qty: limited by coins and by inventory space once the coins are
   * paid. The amount is worked out on a copy first, so coins and items always change together.
   */
  private shopBuy(item: ItemId, qty: number) {
    const p = this.player;
    const shop = this.activeShop();
    if (!shop) {
      this.message('You need to be at the shop to do that.', 'warn');
      return;
    }
    const entry = shop.stock.find((s) => s.item === item);
    if (!entry) return;
    const want = Math.max(0, Math.min(1000, Math.floor(Number(qty)) || 0));
    if (want <= 0) return;
    const coins = p.inventory.count('coins');
    let n = Math.min(want, Math.floor(coins / entry.price));
    if (n <= 0) {
      this.message(`You need ${entry.price} coins to buy ${itemDef(item).name.toLowerCase()}.`, 'warn');
      return;
    }
    const fits = (k: number) => {
      const sim = p.inventory.clone();
      sim.remove('coins', k * entry.price);
      return sim.add(item, k) === k;
    };
    while (n > 0 && !fits(n)) n--;
    if (n <= 0) {
      this.inventoryFull();
      return;
    }
    if (p.inventory.remove('coins', n * entry.price) !== n * entry.price || p.inventory.add(item, n) !== n) throw new Error('shop buy invariant broken');
    this.message(`You buy ${n > 1 ? `${n} x ` : ''}${itemDef(item).name} for ${n * entry.price} coins.`);
    if (n < want) this.message(`You could only afford or carry ${n}.`, 'warn');
    this.emit({ type: 'loot', item, qty: n });
    this.emit({ type: 'shop' });
  }

  /** Sells up to qty of the item in an inventory slot (all slots of that item type count). */
  private shopSell(slot: number, qty: number) {
    const p = this.player;
    if (!this.activeShop()) {
      this.message('You need to be at the shop to do that.', 'warn');
      return;
    }
    const st = Number.isInteger(slot) ? p.inventory.slots[slot] : null;
    if (!st) return;
    const price = sellPrice(st.item);
    if (price <= 0) {
      this.message("The shop won't buy that.", 'warn');
      return;
    }
    const n = Math.min(p.inventory.count(st.item), Math.max(0, Math.floor(Number(qty)) || 0));
    if (n <= 0) return;
    const sim = p.inventory.clone();
    sim.remove(st.item, n);
    if (sim.add('coins', n * price) !== n * price) {
      this.inventoryFull();
      return;
    }
    const name = itemDef(st.item).name;
    if (p.inventory.remove(st.item, n) !== n || p.inventory.add('coins', n * price) !== n * price) throw new Error('shop sell invariant broken');
    this.message(`You sell ${n > 1 ? `${n} x ` : ''}${name} for ${n * price} coins.`);
    this.emit({ type: 'shop' });
  }

  // ---------------------------------------------------------------- bank

  /** The banker the player is using, if they are still close enough to use the bank. */
  private activeBanker(): Npc | null {
    const p = this.player;
    if (p.bankAt === null || p.dead) return null;
    const n = this.byId.get(p.bankAt);
    if (!(n instanceof Npc) || n.def.service !== 'bank') return null;
    return dist(p.x, p.z, n.x, n.z) <= (n.def.reach ?? 1.9) + BANK_LEAVE_MARGIN ? n : null;
  }

  /** Whether bank commands are currently accepted (the interface is open and the player is at the bank). */
  get bankOpen(): boolean {
    return this.activeBanker() !== null;
  }

  /** Validates and applies one bank command. Every transfer is all-or-nothing per item type. */
  private bankCommand(cmd: Extract<Command, { type: 'bankDeposit' | 'bankDepositAll' | 'bankDepositHeld' | 'bankWithdraw' }>) {
    const p = this.player;
    if (!this.activeBanker()) {
      this.message('You need to be at the bank to do that.', 'warn');
      return;
    }
    const inv = p.inventory;
    const bank = p.bank;
    const name = (item: ItemId) => itemDef(item).name;
    const report = (r: TransferResult, verb: string) => {
      if (r.limit === 'bankFull') {
        this.emit({ type: 'bankFull' });
        this.message(r.moved > 0 ? `Your bank is full: only ${r.moved} ${name(r.item)} could be deposited.` : `Your bank is full. Free a slot to deposit ${name(r.item)}.`, 'warn');
      } else if (r.limit === 'inventoryFull') {
        if (r.moved > 0) this.message(`Only ${r.moved} ${name(r.item)} fit in your inventory.`, 'warn');
        else this.inventoryFull();
      } else if (r.moved > 0) {
        this.message(`${verb} ${r.moved > 1 ? `${r.moved} x ` : ''}${name(r.item)}.`);
      }
    };
    switch (cmd.type) {
      case 'bankDeposit': {
        const s = Number.isInteger(cmd.slot) ? inv.slots[cmd.slot] : null;
        if (!s) return;
        report(depositItem(bank, inv, s.item, cmd.qty), 'You deposit');
        break;
      }
      case 'bankWithdraw': {
        if (!isItemId(cmd.item)) return;
        report(withdrawItem(bank, inv, cmd.item, cmd.qty), 'You withdraw');
        break;
      }
      case 'bankDepositAll': {
        const results = depositInventory(bank, inv);
        const moved = results.reduce((a, r) => a + r.moved, 0);
        const blocked = results.filter((r) => r.limit === 'bankFull');
        if (moved > 0) this.message(`You deposit ${moved} item${moved === 1 ? '' : 's'}.`);
        if (blocked.length) {
          this.emit({ type: 'bankFull' });
          this.message(`Your bank is full. Kept in your inventory: ${blocked.map((r) => name(r.item)).join(', ')}.`, 'warn');
        }
        break;
      }
      case 'bankDepositHeld': {
        if (!p.overflow.length) return;
        const r = depositStacks(bank, p.overflow);
        p.overflow = r.left;
        if (r.moved > 0) this.message(`You deposit ${r.moved} held item${r.moved === 1 ? '' : 's'}.`, 'good');
        if (r.left.length) {
          this.emit({ type: 'bankFull' });
          this.message('Your bank is full. Some held items are still waiting.', 'warn');
        }
        break;
      }
    }
    this.emit({ type: 'bank' });
  }

  /** Moves as many held overflow items as fit into the inventory. */
  claimOverflow() {
    const p = this.player;
    if (!p.overflow.length) return;
    let moved = 0;
    for (const o of p.overflow) {
      const added = p.inventory.add(o.item, o.qty);
      o.qty -= added;
      moved += added;
    }
    p.overflow = p.overflow.filter((o) => o.qty > 0);
    const left = p.overflow.reduce((a, o) => a + o.qty, 0);
    if (moved === 0) this.inventoryFull();
    else this.message(`You collect ${moved} held item${moved === 1 ? '' : 's'}.${left ? ` ${left} still waiting.` : ''}`, 'good');
  }

  /** The standard full-inventory feedback (message plus a brief on-screen notice). */
  private inventoryFull() {
    this.message('Your inventory is full.', 'warn');
    this.emit({ type: 'inventoryFull' });
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
    const tool = this.toolFor(n.def.tool);
    if (!tool.tool) {
      if (verbose) this.message(tool.why, 'warn');
      return false;
    }
    if (p.inventory.capacityFor(n.def.item) <= 0) {
      if (verbose) this.inventoryFull();
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
    // Capacity is checked before the swing: a full inventory never rolls, awards xp or depletes the node.
    if (!this.canGather(n, true)) {
      p.action = null;
      return;
    }
    n.hitAge = 0;
    const success = this.rng() < gatherChance(n.def, p.skills.level(n.def.skill), this.toolFor(n.def.tool).tool?.tier ?? 1);
    this.emit({ type: 'gather', node: n.id, success });
    if (!success) return;
    // Better catches (e.g. anchovies) become possible as the skill rises.
    let item = n.def.item;
    let xp = n.def.xp;
    const lvl = p.skills.level(n.def.skill);
    for (const c of n.def.catches ?? []) {
      if (lvl >= c.level && this.rng() < c.chance) {
        item = c.item;
        xp = c.xp;
      }
    }
    if (p.inventory.add(item, 1) !== 1) {
      // Defensive: nothing was awarded, so no xp and no depletion.
      p.action = null;
      this.inventoryFull();
      return;
    }
    this.emit({ type: 'loot', item, qty: 1 });
    this.grantXp(n.def.skill, xp);
    // A rare find only happens when there is room for it.
    if (n.def.rareDrop && this.rng() < n.def.rareDrop.chance && p.inventory.add(n.def.rareDrop.item, 1) === 1) {
      this.emit({ type: 'loot', item: n.def.rareDrop.item, qty: 1 });
      this.message(`You found an ${itemDef(n.def.rareDrop.item).name.toLowerCase()}!`, 'good');
    }
    const full = p.inventory.capacityFor(n.def.item) <= 0;
    if (this.rng() < n.def.depleteChance) {
      n.depleted = true;
      n.respawnTimer = n.def.respawnSeconds;
      this.emit({ type: 'nodeDepleted', node: n.id });
      p.action = null;
      // Optional (setting, off by default as in OSRS): carry on at a nearby node of the same type.
      const next = full || !p.autoGather ? null : this.nearestNode(n.def.id, p.x, p.z, 6);
      if (next && this.canGather(next, false)) {
        p.action = { type: 'gather', node: next.id };
        p.gatherTimer = next.def.actionSeconds * 0.8;
      }
    }
    if (full) {
      // That was the last free slot: stop now rather than swinging once more for nothing.
      p.action = null;
      this.inventoryFull();
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
    if (!this.approach(n.x, n.z, n.def.reach ?? 1.9, true)) return;
    p.action = null;
    p.facing = Math.atan2(n.x - p.x, n.z - p.z);
    n.talkAge = 0;
    if (n.def.service === 'bank') {
      p.bankAt = n.id;
      this.emit({ type: 'bankOpen', npc: n.def.id });
      return;
    }
    if (n.def.service === 'shop') {
      const shop = Object.entries(SHOPS).find(([, d]) => d.npc === n.def.id);
      if (shop) {
        p.shopAt = n.id;
        this.emit({ type: 'shopOpen', shop: shop[0] });
        return;
      }
    }
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
      { defenceLevel: p.skills.level('defence'), armour: this.playerBonuses().armour },
      def.maxHit,
    );
    const dealt = Math.min(r.damage, p.hp);
    p.hp -= dealt;
    this.emit({ type: 'damage', target: p.id, source: e.id, amount: dealt, hit: r.hit });
    // Auto-retaliate: idle or gathering players fight back (but never override manual movement or a chosen target).
    const steering = Math.hypot(p.joy.x, p.joy.z) > 0.15 || p.path.length > 0;
    if ((!p.action || p.action.type === 'gather' || p.action.type === 'craft') && !steering && p.hp > 0) p.action = { type: 'attack', target: e.id };
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
    p.stationAt = null;
    const { kept, lost } = takeLostOnDeath(p.inventory, p.equipment, KEEP_ON_DEATH);
    const lostCount = lost.reduce((a, s) => a + s.qty, 0);
    let grave: Gravestone | null = null;
    if (lost.length) {
      const at = this.walkableNear(p.x, p.z, this.map.spawn.x, this.map.spawn.z);
      grave = this.spawnGrave(at.x, at.z, lost);
    }
    p.lastDeath = { kept, lost: lostCount, grave: grave?.id ?? null };
    this.emit({ type: 'equipment' });
    const keptText = kept.length ? kept.map((k) => `${k.qty > 1 ? `${k.qty} x ` : ''}${itemDef(k.item).name}`).join(', ') : 'nothing';
    this.message(`Oh dear, you have been defeated! You keep your ${KEEP_ON_DEATH} most valuable items: ${keptText}.`, 'bad');
    if (grave) {
      const r = regionAt(grave.x, grave.z);
      this.message(`Your other ${lostCount} item${lostCount === 1 ? ' is' : 's are'} in a gravestone where you fell${r ? ` (${r.name})` : ''}. Reach it within ${GRAVE_SECONDS / 60} minutes to take them back.`, 'warn');
    }
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
      const finalStage = prog.stage + 1 >= q.stages.length;
      if (finalStage && q.rewards.items.length) {
        // Rewards must fit (after any hand-in is taken) or the turn-in waits: no reward is ever lost.
        const after = p.inventory.clone();
        if (obj.type === 'collect' && obj.consume) after.remove(obj.item, obj.count);
        if (!after.canAddAll(q.rewards.items)) {
          this.inventoryFull();
          return { ...base, lines: ['Your pack is too full to carry your reward. Make some room and come back to me.'] };
        }
      }
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
