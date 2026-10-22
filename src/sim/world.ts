import { mulberry32, randInt, type Rng } from '../core/rng';
import { angleDiff, dist } from '../core/math';
import { ENEMIES, type EnemyDef } from '../data/enemies';
import { EQUIP_SLOTS, isItemId, itemDef, type EquipSlot, type ItemId } from '../data/items';
import { RECIPES, STATION_INFO, failChance, isAnywhere, plural, recipeAt, type AnywhereKind, type RecipeDef, type StationKind } from '../data/recipes';
import { SHOPS, sellPrice, shopFor, type ShopDef } from '../data/shops';
import { NPCS, pickpocketChance, type NpcDef, type NpcId } from '../data/npcs';
import { QUESTS, type QuestDef } from '../data/quests';
import { RESOURCES, gatherChance, type ResourceDef } from '../data/resources';
import { SKILL_INFO, type SkillId } from '../data/skills';
import { STYLES, combatXp, rollHit, type CombatStyle } from './combat';
import { Inventory, addTo, type ItemStack } from './inventory';
import { Equipment, equipFromInventory, unequipToInventory } from './equipment';
import { SERVICES, isConvertService } from '../data/tanning';
import { remapItemIds } from '../data/aliases';
import { PRACTICE_ACCOUNT, PracticeMarket } from '../exchange/simulation';
import type { Result as ExchangeResult, Side } from '../exchange/engine';
import { BUILD_SECONDS, HOTSPOTS, NAILS, furnitureDef, type HotspotDef } from '../data/construction';
import { CROPS, MAX_WEEDS, PATCH_LIVES, RAKE_XP, SEEDS_PER_PATCH, WEED_MINUTES, cropForSeed, lifeLossChance, type CropId } from '../data/farming';
import { CROSS_SPEED, LAP_BONUS, SHORTCUTS, SLIP_DAMAGE, VILLAGE_COURSE, slipChance, type ObstacleDef, agilitySpeedBonus } from '../data/agility';
import { BONES, WARDLEAF_XP, BULWARK_DAMAGE, MENDING_REGEN_SECONDS, REGEN_SECONDS, conflicts, prayerDef, type PrayerId } from '../data/prayers';
import { FIRE_LIFE, FIRE_LOGS, LIGHT_SECONDS, lightChance } from '../data/firemaking';
import { GRAVE_SECONDS, KEEP_ON_DEATH, reclaimFee, takeLostOnDeath } from './death';
import { Toolbelt, addToBelt, bestTool, removeFromBelt, type ToolChoice } from './toolbelt';
import { toolLabel, type ToolCategory } from '../data/tools';
import { Bank, depositInventory, depositItem, depositStacks, withdrawItem, type TransferResult } from './bank';
import { findPath, simplifyPath, type PathPoint } from './pathfinding';
import { Skills } from './skills';
import { T, generateWorld, inHollow, isBlocked, regionAt, tileAt, type Checkpoint, type Passage, type WorldMap } from './worldmap';
import { LANTERN_SECONDS } from '../data/hollow';
import { splitSave, type CharacterRecord, type ZoneState } from './records';

export const TICK_SECONDS = 1 / 30;

/**
 * A player's entity id. Players use ids that can never clash with world entities (NPCs 100+,
 * resource nodes 1000+, stations 3000+, agility 4000+, enemies 5000+, ground items 20000+): 1 to 99
 * locally, or 1,000,000 and up on a server (docs/MULTIPLAYER.md, 3A.1).
 */
export type PlayerId = number;
/** The id of the one player in local (single-player) mode. */
export const LOCAL_PLAYER_ID: PlayerId = 1;
/** The placeholder `player` of a shared zone with nobody in it (never a real player). */
export const ZONE_PLACEHOLDER_ID: PlayerId = 99;
export function isValidPlayerId(id: unknown): id is PlayerId {
  return typeof id === 'number' && Number.isInteger(id) && ((id >= 1 && id < 100) || (id >= 1_000_000 && id <= 2_147_483_647));
}
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

/** What a client may ask the exchange to do (no account, balances or results: those are the server's). */
export type ExchangeIntent =
  | { op: 'place'; nonce: number; slot: number; side: Side; item: ItemId; qty: number; price: number }
  | { op: 'cancel'; nonce: number; orderId: number }
  | { op: 'collect'; nonce: number; orderId: number };

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
  /**
   * Bank: deposit up to qty of the item in an inventory slot (all of that item type, across slots).
   * A new item goes into `tab` (the tab being viewed); items already banked keep their place.
   */
  | { type: 'bankDeposit'; slot: number; qty: number; tab?: number }
  /** Bank: deposit the whole inventory. */
  | { type: 'bankDepositAll'; tab?: number }
  /** Bank: move an item (or its placeholder) to a tab (0 main; one past the last makes a new tab). */
  | { type: 'bankSetTab'; item: ItemId; tab: number }
  /** Bank: release one item's placeholder, or all placeholders. */
  | { type: 'bankReleasePlaceholders'; item?: ItemId }
  /** Bank: leave placeholders when withdrawing the last of an item. */
  | { type: 'bankSetPlaceholders'; on: boolean }
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
  /** Light the logs in an inventory slot where the player stands (needs a tinderbox). */
  | { type: 'lightFire'; slot: number }
  /** Open the fletching interface (needs no station). */
  | { type: 'openFletching' }
  /** Open a production interface that needs no station (fletching or crafting). */
  | { type: 'openAnywhere'; kind: AnywhereKind }
  | { type: 'closeProduction' }
  /** Shop: buy up to qty of an item the open shop sells. */
  | { type: 'shopBuy'; item: ItemId; qty: number }
  /** Shop: sell up to qty of the item in an inventory slot. */
  | { type: 'shopSell'; slot: number; qty: number }
  | { type: 'shopClose' }
  /** Tanner or sawmill: convert up to qty of an item (pelts to leather, logs to planks) for a fee each. */
  | { type: 'tan'; item: ItemId; qty: number }
  | { type: 'tannerClose' }
  | { type: 'acceptQuest'; quest: string }
  /**
   * Exchange intents (place, cancel, collect). The account is never sent by the client: the
   * simulation (later the server) supplies it. Today every request goes to the PRACTICE market.
   */
  | { type: 'exchange'; req: ExchangeIntent }
  | { type: 'exchangeClose' }
  /** Start the practice market over with fresh practice stock (practice only). */
  | { type: 'exchangeResetPractice' }
  /** Construction: build a piece of furniture in a house space (must be beside it). */
  | { type: 'build'; hotspot: string; furniture: string }
  /** Construction: remove the furniture from a house space (no refund). */
  | { type: 'removeFurniture'; hotspot: string }
  /** Thieving: try to pick an NPC's pocket (walks over first). */
  | { type: 'pickpocket'; target: number }
  /** Turn a prayer on or off (needs the level and prayer points). */
  | { type: 'togglePrayer'; prayer: PrayerId }
  /** Pray at the shrine or a waystone to recharge prayer points. */
  | { type: 'pray' }
  /** Charge dull spark chips into spark stones at the shrine or a waystone. */
  | { type: 'chargeSparks' }
  /** Burn carried wardleaf as incense at the shrine or a waystone (Devotion). */
  | { type: 'burnIncense' }
  /** Reclaim items a faded wisp carried to the shrines (at the shrine or a waystone, for a fee). */
  | { type: 'reclaimHeld' }
  /** Quench hot glimsteel blooms into bars in running water (stand at the river's edge). */
  | { type: 'quench' }
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
  /** Offer to pickpocket this NPC (its entity id). */
  pickpocket?: number;
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
  /** An Exchange clerk is serving the player (open the exchange interface). */
  | { type: 'exchangeOpen' }
  | { type: 'exchangeClose' }
  /** The result of an exchange request (matched by nonce), and any change to the market. */
  | { type: 'exchangeResult'; nonce: number; result: ExchangeResult }
  | { type: 'exchange' }
  /** The player is at a house space (open the build interface). */
  | { type: 'hotspotOpen'; hotspot: string }
  /** House furniture changed. */
  | { type: 'house' }
  /** A farming patch changed (weeds, crop or harvest). */
  | { type: 'patch'; patch: number }
  /** The player came through a passage (cave mouth or way up). */
  | { type: 'passage'; passage: number }
  /** An agility obstacle was crossed. */
  | { type: 'obstacle'; obstacle: number }
  /** A pickpocket attempt on an NPC (for its reaction). */
  | { type: 'pickpocket'; npc: number }
  /** The player was stunned (failed pickpocket). */
  | { type: 'stunned' }
  /** Prayers or prayer points changed. */
  | { type: 'prayer' }
  /** The player buried bones. */
  | { type: 'bury' }
  /** Hot metal was quenched (steam). */
  | { type: 'quench'; x: number; z: number }
  /** A player lit a fire (a new Fire station). */
  | { type: 'fireLit'; id: number }
  /** Toolbelt contents changed. */
  | { type: 'toolbelt' }
  | { type: 'shopOpen'; shop: string }
  | { type: 'tannerOpen'; service: 'tanner' | 'sawmill' }
  | { type: 'tannerClose' }
  | { type: 'shopClose' }
  /** A purchase or sale went through (refresh the shop interface). */
  | { type: 'shop' };

export type AnimState = 'idle' | 'walk' | 'attack' | 'chop' | 'mine' | 'dead' | 'hit';

export type PlayerAction =
  | { type: 'attack'; target: number }
  | { type: 'pickup'; ground: number }
  | { type: 'grave'; grave: number }
  | { type: 'firemaking'; item: ItemId }
  | { type: 'pickpocket'; npc: number }
  | { type: 'obstacle'; obstacle: number; crossing: boolean; t: number; reverse?: boolean }
  | { type: 'farm'; patch: number }
  | { type: 'hotspot'; hotspot: number }
  | { type: 'passage'; passage: number }
  | { type: 'build'; hotspot: string; furniture: string; t: number }
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
 * A shrine wisp: where a player's at-risk items wait after they fall. Only its owner can take them
 * back; after GRAVE_SECONDS of play it fades and carries what is left to the shrines.
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

/** Start and end of a crossing (a shortcut taken from its far end runs backwards). */
export function crossingEnds(d: ObstacleDef, reverse: boolean): { x1: number; z1: number; x2: number; z2: number } {
  return reverse ? { x1: d.x2, z1: d.z2, x2: d.x1, z2: d.z1 } : { x1: d.x1, z1: d.z1, x2: d.x2, z2: d.z2 };
}

/** An agility obstacle in the world. */
export class Obstacle {
  constructor(
    public readonly id: number,
    public readonly def: ObstacleDef,
    /** Position in the course (laps run in order). */
    public readonly index: number,
  ) {}

  get x(): number {
    return (this.def.x1 + this.def.x2) / 2;
  }

  get z(): number {
    return (this.def.z1 + this.def.z2) / 2;
  }
}

/**
 * A farming allotment. Growth and weeds run on real time (epoch milliseconds from the world clock),
 * so crops keep growing while the player is away, as in OSRS.
 */
export class FarmPatch {
  weeds = MAX_WEEDS;
  crop: CropId | null = null;
  plantedAt = 0;
  lives = 0;
  /** When the patch was last cleared or harvested (weeds creep back from then). */
  bareSince = 0;
  constructor(
    public readonly id: number,
    public readonly index: number,
    public readonly x: number,
    public readonly z: number,
  ) {}

  /** Growth stage now (0 = just planted) and whether it's ready to harvest. */
  growth(now: number): { stage: number; stages: number; ready: boolean; minutesLeft: number } {
    if (!this.crop) return { stage: 0, stages: 0, ready: false, minutesLeft: 0 };
    const c = CROPS[this.crop];
    const stageMs = c.stageMinutes * 60_000;
    const stage = Math.max(0, Math.min(c.stages, Math.floor((now - this.plantedAt) / stageMs)));
    const left = Math.max(0, this.plantedAt + c.stages * stageMs - now);
    return { stage, stages: c.stages, ready: stage >= c.stages, minutesLeft: Math.ceil(left / 60_000) };
  }

  /** Weeds creep back onto a bare patch over time (up to the maximum). */
  settle(now: number) {
    if (this.crop || this.weeds >= MAX_WEEDS || this.bareSince <= 0) return;
    const grown = Math.floor((now - this.bareSince) / (WEED_MINUTES * 60_000));
    if (grown <= this.weeds) return;
    this.weeds = Math.min(MAX_WEEDS, grown);
  }
}

/** A passage between the surface and Glimmer Hollow (tap to go through to the other end). */
export class Doorway {
  constructor(
    public readonly id: number,
    public readonly def: Passage,
  ) {}

  get x(): number {
    return this.def.x;
  }

  get z(): number {
    return this.def.z;
  }
}

/** A furniture space in the player's house. */
export class Hotspot {
  constructor(
    public readonly id: number,
    public readonly def: HotspotDef,
  ) {}

  get x(): number {
    return this.def.x;
  }

  get z(): number {
    return this.def.z;
  }
}

export interface SavedPatch {
  weeds: number;
  crop: CropId | null;
  plantedAt: number;
  lives: number;
  bareSince: number;
}

export interface SavedGrave {
  x: number;
  z: number;
  age: number;
  items: ItemStack[];
  /** Whose wisp it is (optional: older saves only had their own). */
  owner?: PlayerId;
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
  readonly id: PlayerId;
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
  /** Exchange clerk serving the player. */
  exchangeAt: number | null = null;
  /** Tanner or sawmill operator whose service is open. */
  tannerAt: number | null = null;
  /** One-time grants already given to this character (e.g. tools added after an update). */
  grants = new Set<string>();
  /** Walk on to the next node of the same kind when one runs out (a setting; off by default, as in OSRS). */
  autoGather = false;
  /** What happened to the player's items at their latest death (for the death screen). */
  lastDeath: { kept: ItemStack[]; lost: number; grave: number | null; keep: number } | null = null;
  /** Items carried to the shrines by faded wisps, waiting to be reclaimed for a fee. */
  shrineHeld: ItemStack[] = [];
  /** Seconds left on the glowcap burning in the lantern (counts down only underground). */
  lanternBurn = 0;
  /** Already told the lantern is out (so the warning shows once). */
  darkWarned = false;
  craftTimer = 0;
  fireTimer = 0;
  /** Prayer points (max = Prayer level). Fractions never show; they drain a whole point at a time. */
  prayerPoints = 1;
  /** Active prayers. Not saved (prayers switch off when you leave, as in OSRS). */
  prayers = new Set<PrayerId>();
  /** Devotion used by kept vows but not yet taken as a whole point. */
  prayerDrain = 0;
  buryTimer = 0;
  /** Seconds left stunned after a failed pickpocket (no moving or acting). */
  stunTimer = 0;
  thieveTimer = 0;
  /** Furniture built in the house, by space id. */
  furniture: Record<string, string> = {};
  /** Next obstacle of the course for a full lap (0 = start). */
  lapNext = 0;
  laps = 0;
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
  /** This player's own allotments (everyone tends their own patches at the same plot). */
  patches: FarmPatch[] = [];

  constructor(public name: string, public appearance: Appearance, x: number, z: number, id: PlayerId = LOCAL_PLAYER_ID) {
    this.id = id;
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
    public readonly kind: Exclude<StationKind, AnywhereKind>,
    public readonly x: number,
    public readonly z: number,
  ) {}

  get name(): string {
    return STATION_INFO[this.kind].name;
  }
}

/** A fire a player lit: cooks like the campfire, then burns out and leaves ashes. */
export class Fire extends Station {
  age = 0;
  constructor(id: number, x: number, z: number, public readonly life: number) {
    super(id, 'fire', x, z);
  }

  override get name(): string {
    return 'Fire';
  }

  get expired(): boolean {
    return this.age >= this.life;
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
  /** The player who made the attack (gets the xp and the kill). */
  attacker: PlayerId;
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
  | { kind: 'obstacle'; entity: Obstacle }
  | { kind: 'patch'; entity: FarmPatch }
  | { kind: 'hotspot'; entity: Hotspot }
  | { kind: 'passage'; entity: Doorway }
  | { kind: 'station'; entity: Station };

export interface SaveData {
  version: 1;
  /** The player's id when saved (optional: older saves were always player 1). */
  playerId?: PlayerId;
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
  /** Bank contents with tabs and placeholders (optional: saves from before the bank start empty). */
  bank?: ItemStack[];
  /** Bank settings (optional for older saves). */
  bankOptions?: { placeholders?: boolean };
  /** Worn equipment (optional for older saves). */
  equipment?: Partial<Record<EquipSlot, ItemId>>;
  /** Size of the worn ammo stack. */
  ammoQty?: number;
  /** The practice market (local simulation; never real wealth). Optional for older saves. */
  exchangePractice?: unknown;
  /** House furniture by space (optional for older saves). */
  house?: Record<string, string>;
  /** Farming patches by index (optional for older saves). */
  patches?: SavedPatch[];
  /** Agility laps completed (optional for older saves). */
  laps?: number;
  /** Prayer points (optional for older saves: full). */
  prayerPoints?: number;
  /** Gameplay options (optional for older saves). */
  options?: { autoGather?: boolean };
  /** Gravestones still standing (optional for older saves). */
  graves?: SavedGrave[];
  /** Items held at the shrines after a wisp faded (optional for older saves). */
  shrineHeld?: { item: string; qty: number }[];
  /** Glowcap lantern time left (optional for older saves). */
  lanternBurn?: number;
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
  /**
   * The player whose turn it is. Outside `act()` this is the local player (the only one in local
   * play); while a player's commands and updates run, it is that player, so the game rules can keep
   * saying "the player" (docs/MULTIPLAYER.md 3A.5).
   */
  player: Player;
  /** Everyone in this world. */
  readonly players = new Map<PlayerId, Player>();
  readonly enemies: Enemy[] = [];
  readonly nodes: ResourceNode[] = [];
  readonly npcs: Npc[] = [];
  readonly stations: Station[] = [];
  readonly obstacles: Obstacle[] = [];
  readonly doorways: Doorway[] = [];
  readonly hotspots: Hotspot[] = [];
  /** The PRACTICE market: simulated traders and practice balances, separate from real wealth. */
  market: PracticeMarket;
  private marketTimer = 0;
  /** Real-world clock in epoch ms (farming growth). Injected so tests and a server can control it. */
  readonly clock: () => number;
  /** Fires lit by players (also listed in `stations` while they burn). Not saved: they burn out. */
  fires: Fire[] = [];
  groundItems: GroundItem[] = [];
  graves: Gravestone[] = [];
  private nextGroundId = 20000;
  readonly rng: Rng;
  time = 0;
  private events: GameEvent[] = [];
  private eventActors: PlayerId[] = [];
  private pending: PendingHit[] = [];
  private byId = new Map<number, Enemy | ResourceNode | Npc | GroundItem | Station | Gravestone | Obstacle | FarmPatch | Hotspot | Doorway>();

  constructor(opts: { seed?: number; name?: string; appearance?: Appearance; save?: SaveData | null; clock?: () => number; playerId?: PlayerId; map?: WorldMap; market?: PracticeMarket; noPlayer?: boolean } = {}) {
    const playerId = opts.playerId ?? LOCAL_PLAYER_ID;
    if (!isValidPlayerId(playerId)) throw new Error(`invalid player id ${playerId}`);
    this.clock = opts.clock ?? (() => Date.now());
    // Older saves may hold item ids that have since been renamed: convert them first.
    if (opts.save) opts = { ...opts, save: remapItemIds(opts.save) };
    // The map is static once generated, so worlds built from the same seed may share one.
    this.map = opts.map ?? generateWorld(opts.seed ?? 1337);
    this.market = opts.market ?? PracticeMarket.restore(opts.save?.exchangePractice, this.clock) ?? new PracticeMarket(undefined, (opts.seed ?? 1337) ^ 0xe7c, this.clock);
    this.rng = mulberry32((opts.seed ?? 1337) ^ 0x5eed);
    const s = opts.save;
    if (opts.noPlayer) {
      // A shared zone starts empty: `player` points at a placeholder that is never in `players`.
      this.player = new Player('Nobody', DEFAULT_APPEARANCE, this.map.spawn.x, this.map.spawn.z, ZONE_PLACEHOLDER_ID);
    } else this.player = this.addPlayer({ playerId, save: s ?? null, name: opts.name, appearance: opts.appearance });

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
    HOTSPOTS.forEach((def, i) => {
      const h = new Hotspot(4200 + i, def);
      this.hotspots.push(h);
      this.byId.set(h.id, h);
    });
    VILLAGE_COURSE.forEach((def, i) => {
      const o = new Obstacle(4000 + i, def, i);
      this.obstacles.push(o);
      this.byId.set(o.id, o);
    });
    this.map.passages.forEach((def, i) => {
      const d = new Doorway(4500 + i, def);
      this.doorways.push(d);
      this.byId.set(d.id, d);
    });
    SHORTCUTS.forEach((def, i) => {
      const o = new Obstacle(4400 + i, def, -1);
      this.obstacles.push(o);
      this.byId.set(o.id, o);
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
    if (s && !opts.noPlayer) this.restoreWorldItems(s, this.player);
  }

  /** Runs `fn` as `p`'s turn: "the player" in the game rules means `p` until it returns. */
  act<T>(p: Player, fn: () => T): T {
    const prev = this.player;
    this.player = p;
    try {
      return fn();
    } finally {
      this.player = prev;
    }
  }

  /** A player in this world by id. */
  playerById(id: PlayerId): Player | undefined {
    return this.players.get(id);
  }

  /**
   * Adds a player: from a save (restored through the usual path: aliases, grants, overflow) or new
   * with the starter kit. `worldItems`: also place the save's own ground piles and wisps.
   */
  addPlayer(o: { playerId: PlayerId; save?: SaveData | null; name?: string; appearance?: Appearance; worldItems?: boolean }): Player {
    if (!isValidPlayerId(o.playerId) || o.playerId === ZONE_PLACEHOLDER_ID) throw new Error(`invalid player id ${o.playerId}`);
    if (this.players.has(o.playerId)) throw new Error(`player ${o.playerId} is already here`);
    const s = o.save ? remapItemIds(o.save) : null;
    const p = new Player(s?.name ?? o.name ?? 'Adventurer', s?.appearance ?? o.appearance ?? DEFAULT_APPEARANCE, this.map.spawn.x, this.map.spawn.z, o.playerId);
    p.patches = this.map.patches.map((pt, i) => {
      const f = new FarmPatch(4100 + i, i, pt.x, pt.z);
      const sp = s?.patches?.[i];
      if (sp && typeof sp === 'object') {
        f.weeds = Number.isInteger(sp.weeds) ? Math.max(0, Math.min(MAX_WEEDS, sp.weeds)) : MAX_WEEDS;
        f.crop = sp.crop && sp.crop in CROPS ? sp.crop : null;
        f.plantedAt = Number.isFinite(sp.plantedAt) ? sp.plantedAt : 0;
        f.lives = Number.isInteger(sp.lives) ? Math.max(0, Math.min(PATCH_LIVES, sp.lives)) : 0;
        f.bareSince = Number.isFinite(sp.bareSince) ? sp.bareSince : 0;
        if (f.crop) f.weeds = 0;
      }
      return f;
    });
    this.players.set(p.id, p);
    this.act(p, () => {
      if (s) this.loadPlayer(s);
      else this.giveStarterKit();
      if (s && Number.isFinite(s.lanternBurn) && s.lanternBurn! > 0) p.lanternBurn = Math.min(LANTERN_SECONDS, s.lanternBurn!);
      if (s && Array.isArray(s.shrineHeld)) {
        for (const it of s.shrineHeld) {
          const qty = Math.floor(Number(it?.qty));
          if (it && typeof it.item === 'string' && isItemId(it.item) && qty > 0) addTo(p.shrineHeld, it.item, qty);
        }
      }
    });
    if (s && o.worldItems) this.restoreWorldItems(s, p);
    return p;
  }

  /**
   * Removes a player. Their own things in the world (wisps, and loot piles still private to them)
   * leave with them and are returned with the player, to be saved with the character.
   */
  removePlayer(id: PlayerId): { player: Player; zone: ZoneState } | null {
    const p = this.players.get(id);
    if (!p) return null;
    const zone = this.act(p, () => this.zoneState({ ownedOnly: true }));
    for (const g of this.graves) if (g.owner === id) this.byId.delete(g.id);
    this.graves = this.graves.filter((g) => g.owner !== id);
    const mine = (g: GroundItem) => g.owner === id && g.isPrivate;
    for (const g of this.groundItems) if (mine(g)) this.byId.delete(g.id);
    this.groundItems = this.groundItems.filter((g) => !mine(g));
    for (const e of this.enemies) {
      if (e.target === id) {
        e.target = null;
        if (e.alive) e.state = 'return';
      }
    }
    this.pending = this.pending.filter((h) => h.attacker !== id);
    this.players.delete(id);
    if (this.player === p) this.player = this.players.values().next().value ?? new Player('Nobody', DEFAULT_APPEARANCE, this.map.spawn.x, this.map.spawn.z, ZONE_PLACEHOLDER_ID);
    return { player: p, zone };
  }

  /** Places a save's ground piles and wisps, keeping the saving player's ownership with `p`. */
  private restoreWorldItems(s: SaveData, p: Player) {
    const savedId = s.playerId ?? 1;
    if (Array.isArray(s.ground)) {
      for (const g of s.ground) {
        const qty = Math.floor(Number(g?.qty));
        const age = Number(g?.age);
        if (!g || typeof g.item !== 'string' || !isItemId(g.item) || !(qty > 0) || !Number.isFinite(g.x) || !Number.isFinite(g.z)) continue;
        // Piles the saving player owned stay theirs even if their id has changed (saves without an
        // id are from before ids could change, when the player was always 1).
        const owner = typeof g.owner !== 'number' ? null : g.owner === savedId ? p.id : g.owner;
        const pile = this.spawnGroundItem(g.item, qty, g.x, g.z, owner);
        pile.age = Number.isFinite(age) && age > 0 ? age : 0;
      }
      this.groundItems = this.groundItems.filter((g) => !g.expired);
    }
    if (Array.isArray(s.graves)) {
      for (const g of s.graves) {
        if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.z) || !Array.isArray(g.items)) continue;
        const items: ItemStack[] = [];
        for (const it of g.items) {
          const qty = Math.floor(Number(it?.qty));
          if (it && typeof it.item === 'string' && isItemId(it.item) && qty > 0) addTo(items, it.item, qty);
        }
        const owner = typeof g.owner === 'number' && g.owner !== savedId ? g.owner : p.id;
        const grave = this.spawnGrave(g.x, g.z, items, owner);
        grave.age = Number.isFinite(g.age) && g.age > 0 ? g.age : 0;
      }
      this.graves = this.graves.filter((g) => !g.expired);
    }
  }

  /** Tools every character should own once (older saves receive them after the production update). */
  static readonly STARTER_TOOLS: ItemId[] = ['hammer', 'knife', 'small_fishing_net'];
  /** Everything a new character starts with on the toolbelt. */
  static readonly STARTER_BELT: ItemId[] = ['bronze_pickaxe', 'bronze_axe', 'hammer', 'knife', 'small_fishing_net', 'fishing_rod', 'tinderbox', 'needle', 'chisel', 'rake', 'seed_dibber', 'spade', 'saw'];

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

  /** Once per update that adds a skill: its tools for characters who don't own them (onto the belt). */
  private grantSkillTools(grant: string, tools: ItemId[], message: string) {
    const p = this.player;
    if (p.grants.has(grant)) return;
    p.grants.add(grant);
    let given = 0;
    for (const t of tools) {
      if (p.inventory.count(t) > 0 || p.bank.count(t) > 0 || p.toolbelt.count(t) > 0 || p.overflow.some((o) => o.item === t)) continue;
      const c = itemDef(t).tool!.category;
      if (!p.toolbelt.get(c)) p.toolbelt.slots[c] = t;
      else if (p.inventory.add(t, 1) !== 1) addTo(p.overflow, t, 1);
      given++;
    }
    if (given) this.message(message, 'good');
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
    this.player.grants.add('firemaking-v1');
    this.player.grants.add('crafting-v1');
    this.player.grants.add('farming-v1');
    this.player.grants.add('construction-v1');
    for (const t of GameWorld.STARTER_BELT) this.player.toolbelt.slots[itemDef(t).tool!.category] = t;
    inv.add('bread', 2);
    this.player.equipment.slots.ammo = 'bronze_arrow';
    this.player.equipment.ammoQty = 60;
    inv.add('air_rune', 60);
    inv.add('coins', 25);
  }

  // ---------------------------------------------------------------- persistence

  /**
   * Network replica only (docs/MULTIPLAYER.md 3A.2): replaces ground piles, wisps and fires with the
   * server's, keeping existing objects (by id) so the renderer's views stay attached.
   */
  syncDynamicEntities(state: {
    ground: { id: number; item: ItemId; qty: number; x: number; z: number; owner: number | null; age: number }[];
    graves: { id: number; x: number; z: number; owner: number; items: ItemStack[]; age: number }[];
    fires: { id: number; x: number; z: number; life: number; age: number }[];
  }) {
    const ground = new Map(this.groundItems.map((g) => [g.id, g]));
    for (const g of this.groundItems) this.byId.delete(g.id);
    this.groundItems = state.ground.map((s) => {
      const old = ground.get(s.id);
      const g = old && old.item === s.item ? old : new GroundItem(s.id, s.item, s.qty, s.x, s.z, s.owner);
      g.qty = s.qty;
      g.age = s.age;
      this.byId.set(g.id, g);
      return g;
    });
    const graves = new Map(this.graves.map((g) => [g.id, g]));
    for (const g of this.graves) this.byId.delete(g.id);
    this.graves = state.graves.map((s) => {
      const g = graves.get(s.id) ?? new Gravestone(s.id, s.x, s.z, s.owner, []);
      g.items = s.items.map((i) => ({ ...i }));
      g.age = s.age;
      this.byId.set(g.id, g);
      return g;
    });
    const fires = new Map(this.fires.map((f) => [f.id, f]));
    for (const f of this.fires) {
      this.byId.delete(f.id);
      this.stations.splice(this.stations.indexOf(f), 1);
    }
    this.fires = state.fires.map((s) => {
      const f = fires.get(s.id) ?? new Fire(s.id, s.x, s.z, s.life);
      f.age = s.age;
      this.byId.set(f.id, f);
      this.stations.push(f);
      return f;
    });
  }

  /** The character part of the save (docs/MULTIPLAYER.md 3A.1; see `src/sim/records.ts`). */
  characterRecord(): CharacterRecord {
    return splitSave(this.save({ practice: false })).character;
  }

  /** The zone part of the save: ground piles and shrine wisps. */
  zoneState(opts: { ownedOnly?: boolean } = {}): ZoneState {
    const zone = splitSave(this.save()).zone;
    if (!opts.ownedOnly) return zone;
    // Only this player's own things: wisps, and loot piles still private to them.
    const id = this.player.id;
    return {
      ground: this.groundItems.filter((g) => !g.expired && g.owner === id && g.isPrivate).map((g) => ({ item: g.item, qty: g.qty, x: g.x, z: g.z, owner: g.owner, age: g.age })),
      graves: this.graves.filter((g) => !g.expired && g.owner === id).map((g) => ({ x: g.x, z: g.z, age: g.age, items: g.items.map((i) => ({ ...i })), owner: g.owner })),
    };
  }

  /** The local player's allotments (each player has their own). */
  get patches(): FarmPatch[] {
    return this.player.patches;
  }

  /** The whole save. `practice: false` leaves out the practice market (it is large and device-local). */
  save(opts: { practice?: boolean } = {}): SaveData {
    const p = this.player;
    return {
      version: 1,
      playerId: p.id,
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
      bankOptions: { placeholders: p.bank.placeholders },
      equipment: p.equipment.toJSON(),
      ammoQty: p.equipment.ammoQty,
      options: { autoGather: p.autoGather },
      laps: p.laps,
      house: { ...p.furniture },
      ...(opts.practice === false ? {} : { exchangePractice: this.market.toJSON() }),
      patches: this.patches.map((f) => ({ weeds: f.weeds, crop: f.crop, plantedAt: f.plantedAt, lives: f.lives, bareSince: f.bareSince })),
      prayerPoints: p.dead ? p.skills.level('prayer') : p.prayerPoints,
      graves: this.graves.filter((g) => !g.expired).map((g) => ({ x: g.x, z: g.z, age: g.age, items: g.items.map((i) => ({ ...i })), owner: g.owner })),
      shrineHeld: this.player.shrineHeld.map((i) => ({ ...i })),
      lanternBurn: this.player.lanternBurn,
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
    p.bank = Bank.restore(s.bank, undefined, s.bankOptions);
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
    this.grantSkillTools('firemaking-v1', ['tinderbox'], 'New skill: Firemaking! Tilly put a tinderbox on your toolbelt. Tap logs in your bag to light a fire.');
    this.grantSkillTools('construction-v1', ['saw'], 'New skill: Construction! Tilly put a saw on your toolbelt. Your house is north of the village; Bertram’s sawmill is beside it.');
    this.grantSkillTools('farming-v1', ['rake', 'seed_dibber', 'spade'], 'New skill: Farming! Tilly put a rake, seed dibber and spade on your toolbelt. The allotments are east of the plaza.');
    this.grantSkillTools('crafting-v1', ['needle', 'chisel'], 'New skill: Crafting! Tilly put a needle and a chisel on your toolbelt. Rook by the smithy tans pelts into wolfhide.');
    this.grantSkillTools('rod-v1', ['fishing_rod'], 'New: rod fishing! Tilly put a riverwood rod on your toolbelt. Glass trout swim in the clear pools upriver by the Whispering Woods (Fishing 20).');
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
    p.furniture = {};
    for (const h of HOTSPOTS) {
      const id = s.house?.[h.id];
      if (typeof id === 'string' && h.options.some((o) => o.id === id)) p.furniture[h.id] = id;
    }
    p.laps = Number.isInteger(s.laps) && s.laps! > 0 ? s.laps! : 0;
    const pp = Number(s.prayerPoints);
    p.prayerPoints = Number.isFinite(pp) ? Math.max(0, Math.min(p.skills.level('prayer'), Math.floor(pp))) : p.skills.level('prayer');
  }

  // ---------------------------------------------------------------- api

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    this.eventActors = [];
    return e;
  }

  /** Events with the player whose turn produced each one (a server routes them by this). */
  drainEventsWithActors(): { event: GameEvent; actor: PlayerId }[] {
    const out = this.events.map((event, i) => ({ event, actor: this.eventActors[i] }));
    this.events = [];
    this.eventActors = [];
    return out;
  }

  emit(e: GameEvent) {
    this.events.push(e);
    this.eventActors.push(this.player.id);
  }

  message(text: string, tone: MessageTone = 'info') {
    this.emit({ type: 'message', text, tone });
  }

  get(id: number): Enemy | ResourceNode | Npc | GroundItem | Station | Gravestone | Obstacle | FarmPatch | Hotspot | Doorway | undefined {
    // Allotments are each player's own: the same id means the acting player's patch.
    const patch = this.player.patches[id - 4100];
    if (patch && patch.id === id) return patch;
    return this.byId.get(id);
  }

  interactable(id: number): Interactable | null {
    const e = this.get(id);
    if (e instanceof Enemy) return { kind: 'enemy', entity: e };
    if (e instanceof ResourceNode) return { kind: 'node', entity: e };
    if (e instanceof Npc) return { kind: 'npc', entity: e };
    if (e instanceof GroundItem) return e.visibleTo(this.player.id) ? { kind: 'ground', entity: e } : null;
    if (e instanceof Station) return { kind: 'station', entity: e };
    if (e instanceof Obstacle) return { kind: 'obstacle', entity: e };
    if (e instanceof FarmPatch) return { kind: 'patch', entity: e };
    if (e instanceof Hotspot) return { kind: 'hotspot', entity: e };
    if (e instanceof Doorway) return { kind: 'passage', entity: e };
    if (e instanceof Gravestone) return !e.expired && e.owner === this.player.id ? { kind: 'grave', entity: e } : null;
    return null;
  }

  /**
   * A command from a specific player (a server passes the player bound to the connection, never one
   * named in the message). Returns false, changing nothing, if that player isn't in this world.
   */
  issueFor(playerId: PlayerId, cmd: Command): boolean {
    const p = this.players.get(playerId);
    if (!p) return false;
    this.act(p, () => this.issue(cmd));
    return true;
  }

  issue(cmd: Command) {
    const p = this.player;
    if (p.dead && cmd.type !== 'respawn') return;
    // Mid-obstacle, the player can't steer or start anything else until across.
    if (p.action?.type === 'obstacle' && p.action.crossing && (cmd.type === 'joystick' || cmd.type === 'moveTo' || cmd.type === 'interact' || cmd.type === 'pickpocket')) return;
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
      case 'bankSetTab':
      case 'bankReleasePlaceholders':
      case 'bankSetPlaceholders':
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
      case 'lightFire':
        this.startFire(cmd.slot);
        break;
      case 'openAnywhere':
        if (!isAnywhere(cmd.kind)) break;
        p.stationAt = null;
        this.emit({ type: 'productionOpen', station: cmd.kind });
        break;
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
      case 'tan':
        this.tan(cmd.item, cmd.qty);
        break;
      case 'tannerClose':
        if (p.tannerAt !== null) {
          p.tannerAt = null;
          this.emit({ type: 'tannerClose' });
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
      case 'pickpocket': {
        const n = this.byId.get(cmd.target);
        if (!(n instanceof Npc) || !n.def.thieving) break;
        if (p.stunTimer > 0) {
          this.message("You're stunned!", 'warn');
          break;
        }
        p.path = [];
        p.action = { type: 'pickpocket', npc: n.id };
        p.thieveTimer = 0.6;
        break;
      }
      case 'build':
        this.startBuild(cmd.hotspot, cmd.furniture);
        break;
      case 'exchange':
        this.exchangeRequest(cmd.req);
        break;
      case 'exchangeClose':
        if (p.exchangeAt !== null) {
          p.exchangeAt = null;
          this.emit({ type: 'exchangeClose' });
        }
        break;
      case 'exchangeResetPractice':
        if (this.activeClerk()) {
          this.market = new PracticeMarket(undefined, Math.floor(this.rng() * 1e9), this.clock);
          this.emit({ type: 'exchange' });
          this.message('The practice market has been reset with fresh practice stock.');
        }
        break;
      case 'removeFurniture':
        this.removeFurniture(cmd.hotspot);
        break;
      case 'togglePrayer':
        this.togglePrayer(cmd.prayer);
        break;
      case 'pray':
        this.pray();
        break;
      case 'chargeSparks':
        this.chargeSparks();
        break;
      case 'burnIncense':
        this.burnIncense();
        break;
      case 'reclaimHeld':
        this.reclaimHeld();
        break;
      case 'quench':
        this.quench();
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
    for (const p of this.players.values()) {
      p.prevX = p.x;
      p.prevZ = p.z;
    }
    for (const e of this.enemies) {
      e.prevX = e.x;
      e.prevZ = e.z;
    }
    for (const p of this.players.values()) this.act(p, () => this.tickPlayer(dt));
    this.updateGroundItems(dt);
    this.updateGraves(dt);
    this.updateFires(dt);
    this.tickPracticeMarket(dt);
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
    // Resolve projectile hits (as the attacker's turn: they get the xp and the kill).
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const h = this.pending[i];
      if (h.at > this.time) continue;
      this.pending.splice(i, 1);
      const e = this.byId.get(h.target);
      const a = this.players.get(h.attacker);
      if (a && e instanceof Enemy && e.alive) this.act(a, () => this.damageEnemy(e, h.damage, h.hit, h.style));
    }
  }

  /** One player's part of a tick: movement and actions, their lantern, and closing out-of-reach interfaces. */
  private tickPlayer(dt: number) {
    const p = this.player;
    this.updatePlayer(dt);
    this.updateLantern(dt);
    if (p.shopAt !== null && !this.activeShop()) {
      p.shopAt = null;
      this.emit({ type: 'shopClose' });
    }
    if (p.exchangeAt !== null && !this.activeClerk()) {
      p.exchangeAt = null;
      this.emit({ type: 'exchangeClose' });
    }
    if (p.tannerAt !== null && !this.activeTanner()) {
      p.tannerAt = null;
      this.emit({ type: 'tannerClose' });
    }
    if (p.stationAt !== null && !this.activeStation()) {
      p.stationAt = null;
      this.emit({ type: 'productionClose' });
    }
    if (p.bankAt !== null && !this.activeBanker()) {
      p.bankAt = null;
      this.emit({ type: 'bankClose' });
    }
  }

  /** Idle NPCs turn to face a nearby player; patrolling NPCs walk their route, pausing to chat. */
  private updateNpc(n: Npc, dt: number) {
    // Turns toward (and pauses for) the nearest player.
    let p = this.player;
    let best = Infinity;
    for (const q of this.players.values()) {
      const d = dist(n.x, n.z, q.x, q.z);
      if (d < best) {
        best = d;
        p = q;
      }
    }
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
    p.buryTimer -= dt;
    p.moving = false;

    if (p.dead) {
      p.deathTimer -= dt;
      if (p.deathTimer <= 0) this.respawnPlayer('home');
      return;
    }
    if (p.stunTimer > 0) {
      // Stunned: no moving or acting until it wears off (combat against the player continues).
      p.stunTimer -= dt;
      p.path = [];
      this.updatePrayer(dt);
      return;
    }

    this.updatePrayer(dt);
    // Out-of-combat regeneration (Rapid Heal doubles it).
    if (p.combatTimer <= 0 && p.hp < p.maxHp) {
      p.regenTimer += dt;
      if (p.regenTimer >= (p.prayers.has('mending_song') ? MENDING_REGEN_SECONDS : REGEN_SECONDS)) {
        p.regenTimer = 0;
        p.hp = Math.min(p.maxHp, p.hp + Math.max(1, Math.round(p.maxHp * 0.02)));
      }
    }

    if (p.action?.type === 'obstacle' && p.action.crossing) {
      this.updateCrossing(p.action, dt);
      this.updateRegion();
      return;
    }
    const joyMag = Math.hypot(p.joy.x, p.joy.z);
    if (joyMag > 0.15) {
      const speed = this.playerSpeed() * Math.min(1, 0.35 + joyMag);
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
    else if (action?.type === 'firemaking') this.updateFiremaking(action.item, dt);
    else if (action?.type === 'pickpocket') this.updatePickpocket(action.npc, dt);
    else if (action?.type === 'obstacle') this.updateObstacleApproach(action);
    else if (action?.type === 'farm') this.updateFarming(action.patch, dt);
    else if (action?.type === 'hotspot') this.updateHotspotApproach(action.hotspot);
    else if (action?.type === 'passage') this.updatePassage(action.passage);
    else if (action?.type === 'build') this.updateBuild(action, dt);
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
    let budget = this.playerSpeed() * dt;
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
        this.message(n.def.skill === 'woodcutting' ? 'This tree has been cut down. It will regrow soon.' : n.def.skill === 'crafting' ? 'This flax has been picked. It will grow back soon.' : n.def.skill === 'thieving' ? 'The stall is empty. It will be restocked soon.' : 'This rock is depleted. It will replenish soon.');
        return;
      }
      if (!this.canGather(n, true)) return;
      p.action = { type: 'gather', node: id };
      p.gatherTimer = n.def.actionSeconds * 0.6;
    } else if (it.kind === 'ground') {
      p.action = { type: 'pickup', ground: id };
    } else if (it.kind === 'passage') {
      p.action = { type: 'passage', passage: id };
    } else if (it.kind === 'hotspot') {
      p.action = { type: 'hotspot', hotspot: id };
    } else if (it.kind === 'patch') {
      if (this.farmBlocker(it.entity, true)) return;
      p.action = { type: 'farm', patch: id };
      p.gatherTimer = 0.9;
    } else if (it.kind === 'obstacle') {
      if (p.skills.level('agility') < it.entity.def.level) {
        this.message(`You need Agility level ${it.entity.def.level} to attempt that.`, 'warn');
        return;
      }
      p.action = { type: 'obstacle', obstacle: id, crossing: false, t: 0 };
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
    if (this.tooDark()) {
      p.action = null;
      return;
    }

    const ammo = this.firingAmmo();
    if (ammo && this.ammoLeft() <= 0) {
      const name = itemDef(ammo).name.toLowerCase();
      if (style.ammoWorn && p.inventory.slots.some((s) => s && itemDef(s.item).equip?.ammoFor === p.style)) this.message(`Equip your ${name} first: bows fire from the ammo slot. Tap them in your bag.`, 'warn');
      else this.message(`You have no ${name} left. Switch style or find more.`, 'warn');
      p.action = null;
      return;
    }
    if (ammo) {
      if (style.ammoWorn) p.equipment.useAmmo(ammo);
      else p.inventory.remove(ammo, 1);
      if (style.ammoWorn && !p.equipment.slots.ammo) this.emit({ type: 'equipment' });
    }

    p.facing = Math.atan2(e.x - p.x, e.z - p.z);
    p.attackTimer = style.attackSeconds;
    p.swingAge = 0;
    p.combatTimer = 6;
    const sk = p.skills;
    const attackSkill: SkillId = p.style === 'melee' ? 'attack' : p.style;
    const gear = this.playerBonuses();
    // Prayers raise effective levels (OSRS): melee attack and strength separately, ranged and magic both rolls.
    const attackLevel = sk.level(attackSkill) * this.prayerBoost(p.style === 'melee' ? 'attack' : p.style);
    const strengthLevel = p.style === 'melee' ? sk.level('strength') * this.prayerBoost('strength') : attackLevel;
    const result = rollHit(
      this.rng,
      { attackLevel, strengthLevel, accuracyBonus: gear.accuracy, powerBonus: gear.power },
      { defenceLevel: e.def.defence, armour: 0 },
    );
    this.emit({ type: 'attack', source: p.id, target: e.id, style: p.style });
    if (style.projectileSpeed) {
      const flight = Math.max(0.12, dist(p.x, p.z, e.x, e.z) / style.projectileSpeed);
      this.emit({ type: 'projectile', source: p.id, target: e.id, style: p.style, flight });
      this.pending.push({ at: this.time + flight, attacker: p.id, target: e.id, style: p.style, damage: result.damage, hit: result.hit });
    } else {
      this.pending.push({ at: this.time + 0.22, attacker: p.id, target: e.id, style: p.style, damage: result.damage, hit: result.hit });
    }
  }

  /** Simulated traders act every few seconds (their own random stream: world randomness is untouched). */
  tickPracticeMarket(dt: number) {
    this.marketTimer += dt;
    if (this.marketTimer >= 4) {
      this.marketTimer = 0;
      this.market.step();
      this.emit({ type: 'exchange' });
    }
  }

  /**
   * Client-side prediction for network play (docs/MULTIPLAYER.md 3A.2): one tick of joystick movement
   * for the local player, using exactly the simulation's movement rules (speed, Agility, collision).
   * Returns false when the simulation wouldn't move the player by joystick (dead, stunned, crossing).
   */
  predictMove(dx: number, dz: number, dt = TICK_SECONDS): boolean {
    const p = this.player;
    if (p.dead || p.stunTimer > 0 || (p.action?.type === 'obstacle' && p.action.crossing)) return false;
    const m = Math.hypot(dx, dz);
    const jx = m > 1 ? dx / m : dx;
    const jz = m > 1 ? dz / m : dz;
    const mag = Math.hypot(jx, jz);
    if (mag <= 0.15) return false;
    this.moveEntity(p, jx / mag, jz / mag, this.playerSpeed() * Math.min(1, 0.35 + mag) * dt);
    p.moving = true;
    p.facing = Math.atan2(jx, jz);
    return true;
  }

  /** Walking speed: Agility makes you a little quicker on your feet (up to 8% faster at level 41). */
  playerSpeed(): number {
    return PLAYER_SPEED * (1 + agilitySpeedBonus(this.player.skills.level('agility')));
  }

  /** Shots or casts left for the current style (worn ammo for bows, spark stones in the bag for magic). */
  ammoLeft(): number {
    const p = this.player;
    const style = STYLES[p.style];
    const ammo = this.firingAmmo();
    if (!ammo) return Infinity;
    return style.ammoWorn ? (p.equipment.slots.ammo === ammo ? p.equipment.ammoQty : 0) : p.inventory.count(ammo);
  }

  /** What the current style fires: any worn arrows for bows (bronze or glimsteel), spark stones for wands. */
  firingAmmo(): ItemId | null {
    const p = this.player;
    const style = STYLES[p.style];
    if (!style.ammo) return null;
    const worn = p.equipment.slots.ammo;
    if (style.ammoWorn && worn && itemDef(worn).equip?.ammoFor === p.style) return worn;
    return style.ammo;
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

  spawnGrave(x: number, z: number, items: ItemStack[], owner: PlayerId = this.player.id): Gravestone {
    const g = new Gravestone(this.nextGroundId++, x, z, owner, items);
    this.graves.push(g);
    this.byId.set(g.id, g);
    return g;
  }

  private updateGraves(dt: number) {
    let removed = false;
    for (const g of this.graves) {
      // A wisp only counts down while its owner is here (play time, as for one player).
      const owner = this.players.get(g.owner);
      if (!owner) continue;
      g.age += dt;
      if (g.expired) {
        if (g.items.length) {
          this.act(owner, () => {
            for (const s of g.items) addTo(owner.shrineHeld, s.item, s.qty);
            this.message('Your shrine wisp has faded and carried your things to the shrines. Reclaim them at the shrine or any waystone, for a small offering.', 'warn');
          });
        }
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
      this.message(`The wisp hands back all ${moved} item${moved === 1 ? '' : 's'} and drifts away.`, 'good');
      this.byId.delete(g.id);
      this.graves = this.graves.filter((x) => x !== g);
    } else {
      this.message(`You take back ${moved} item${moved === 1 ? '' : 's'}. ${g.count} still wait with your wisp: make room and tap it again.`, 'warn');
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
    return { accuracy: (b.weapon ? b.accuracy : style.accuracy) + b.extraAccuracy, power: (b.weapon ? b.power : style.power) + b.extraPower, armour: b.armour, weapon: b.weapon };
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
    if (!isAnywhere(rec.station) && !(at && recipeAt(rec, at.kind))) return `You need to be at a ${STATION_INFO[rec.station].name.toLowerCase()}.`;
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
    const st = !isAnywhere(rec.station) ? this.activeStation() : null;
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

  // ---------------------------------------------------------------- firemaking

  /** Why logs can't be lit here and now (null if they can). */
  fireBlocker(item: ItemId): string | null {
    const p = this.player;
    const fl = FIRE_LOGS[item];
    if (!fl) return "You can't light that.";
    if (p.skills.level('firemaking') < fl.level) return `You need Firemaking level ${fl.level} to light ${itemDef(item).name.toLowerCase()}.`;
    const t = this.toolFor('tinderbox');
    if (!t.tool) return t.why;
    if (p.inventory.count(item) <= 0) return `You have no ${itemDef(item).name.toLowerCase()} left.`;
    if (this.stations.some((s) => dist(s.x, s.z, p.x, p.z) < 1.1)) return "You can't light a fire here.";
    return null;
  }

  private startFire(slot: number) {
    const p = this.player;
    const st = Number.isInteger(slot) ? p.inventory.slots[slot] : null;
    if (!st) return;
    const why = this.fireBlocker(st.item);
    if (why) {
      this.message(why, 'warn');
      return;
    }
    p.path = [];
    p.joy.x = p.joy.z = 0;
    p.action = { type: 'firemaking', item: st.item };
    p.fireTimer = LIGHT_SECONDS;
    this.message('You attempt to light the logs.');
  }

  private updateFiremaking(item: ItemId, dt: number) {
    const p = this.player;
    if (p.moving) {
      p.action = null;
      return;
    }
    p.fireTimer -= dt;
    if (p.fireTimer > 0) return;
    p.fireTimer = LIGHT_SECONDS;
    const why = this.fireBlocker(item);
    if (why) {
      p.action = null;
      this.message(why, 'warn');
      return;
    }
    const fl = FIRE_LOGS[item]!;
    if (this.rng() >= lightChance(p.skills.level('firemaking'), fl.level)) return;
    p.action = null;
    p.inventory.remove(item, 1);
    const fire = new Fire(this.nextGroundId++, Math.floor(p.x) + 0.5, Math.floor(p.z) + 0.5, FIRE_LIFE.min + this.rng() * (FIRE_LIFE.max - FIRE_LIFE.min));
    this.fires.push(fire);
    this.stations.push(fire);
    this.byId.set(fire.id, fire);
    this.grantXp('firemaking', fl.xp);
    this.emit({ type: 'fireLit', id: fire.id });
    this.message('The fire catches and the logs begin to burn.', 'good');
    // Step off the fire, west first as is tradition, then any free side.
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, 1], [0, -1]]) {
      const x = fire.x + dx;
      const z = fire.z + dz;
      if (this.blockedAt(x, z) || this.stations.some((s) => dist(s.x, s.z, x, z) < 0.6)) continue;
      p.path = [{ x, z }];
      break;
    }
  }

  private updateFires(dt: number) {
    let removed = false;
    for (const f of this.fires) {
      f.age += dt;
      if (!f.expired) continue;
      removed = true;
      this.byId.delete(f.id);
      this.stations.splice(this.stations.indexOf(f), 1);
      this.spawnGroundItem('ashes', 1, f.x, f.z, null);
    }
    if (removed) this.fires = this.fires.filter((f) => !f.expired);
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

  // ---------------------------------------------------------------- exchange (practice market)

  /** The Exchange clerk serving the player, while still at the counter. */
  activeClerk(): Npc | null {
    const p = this.player;
    if (p.exchangeAt === null || p.dead) return null;
    const n = this.byId.get(p.exchangeAt);
    if (!(n instanceof Npc) || n.def.service !== 'exchange') return null;
    return dist(p.x, p.z, n.x, n.z) <= (n.def.reach ?? 1.9) + BANK_LEAVE_MARGIN ? n : null;
  }

  /**
   * Forwards a client intent to the practice market as the practice account. Only the intent's
   * fields are used: the account comes from here, and balances and results come from the engine.
   */
  private exchangeRequest(req: ExchangeIntent) {
    if (!req || typeof req !== 'object') return;
    const nonce = Number(req.nonce);
    let result: ExchangeResult;
    if (!this.activeClerk()) result = { ok: false, error: 'You need to be at an Exchange clerk to do that.' };
    else if (req.op === 'place') result = this.market.exchange.submit({ op: 'place', account: PRACTICE_ACCOUNT, nonce, slot: req.slot, side: req.side, item: req.item, qty: req.qty, price: req.price });
    else if (req.op === 'cancel' || req.op === 'collect') result = this.market.exchange.submit({ op: req.op, account: PRACTICE_ACCOUNT, nonce, orderId: req.orderId });
    else result = { ok: false, error: 'Unknown request.' };
    this.emit({ type: 'exchangeResult', nonce, result });
    this.emit({ type: 'exchange' });
  }

  // ---------------------------------------------------------------- tanner

  /** The tanner the player is using, while still beside them. */
  activeTanner(): Npc | null {
    const p = this.player;
    if (p.tannerAt === null || p.dead) return null;
    const n = this.byId.get(p.tannerAt);
    if (!(n instanceof Npc) || !isConvertService(n.def.service)) return null;
    return dist(p.x, p.z, n.x, n.z) <= (n.def.reach ?? 1.9) + BANK_LEAVE_MARGIN ? n : null;
  }

  /**
   * Tans as many hides as the player has and can pay for, up to qty. Each hide becomes leather in
   * place (one slot each), so it always fits; coins and hides change together.
   */
  private tan(item: ItemId, qty: number) {
    const p = this.player;
    const npc = this.activeTanner();
    if (!npc || !isConvertService(npc.def.service)) {
      this.message('You need to be at the tanner or sawmill to do that.', 'warn');
      return;
    }
    const svc = SERVICES[npc.def.service];
    const t = svc.list.find((x) => x.from === item);
    if (!t) return;
    const want = Math.max(0, Math.min(1000, Math.floor(Number(qty)) || 0));
    const n = Math.min(want, p.inventory.count(item), Math.floor(p.inventory.count('coins') / t.cost));
    if (n <= 0) {
      this.message(p.inventory.count(item) <= 0 ? `You have no ${plural(itemDef(item).name.toLowerCase(), 2)} for that.` : `That costs ${t.cost} coins each.`, 'warn');
      return;
    }
    if (p.inventory.remove('coins', n * t.cost) !== n * t.cost) throw new Error('tan invariant broken');
    let done = 0;
    for (let i = 0; i < p.inventory.slots.length && done < n; i++) {
      if (p.inventory.slots[i]?.item !== item) continue;
      p.inventory.slots[i] = { item: t.to, qty: 1 };
      done++;
    }
    this.message(`${npc.def.name.split(' ')[0]} ${svc.verb} ${n} ${plural(itemDef(item).name.toLowerCase(), n)} into ${plural(itemDef(t.to).name.toLowerCase(), n)} for ${n * t.cost} coins.`, 'good');
    this.emit({ type: 'loot', item: t.to, qty: n });
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
  private bankCommand(cmd: Extract<Command, { type: 'bankDeposit' | 'bankDepositAll' | 'bankDepositHeld' | 'bankWithdraw' | 'bankSetTab' | 'bankReleasePlaceholders' | 'bankSetPlaceholders' }>) {
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
        report(depositItem(bank, inv, s.item, cmd.qty, cmd.tab ?? 0), 'You deposit');
        break;
      }
      case 'bankWithdraw': {
        if (!isItemId(cmd.item)) return;
        report(withdrawItem(bank, inv, cmd.item, cmd.qty), 'You withdraw');
        break;
      }
      case 'bankDepositAll': {
        const results = depositInventory(bank, inv, cmd.tab ?? 0);
        const moved = results.reduce((a, r) => a + r.moved, 0);
        const blocked = results.filter((r) => r.limit === 'bankFull');
        if (moved > 0) this.message(`You deposit ${moved} item${moved === 1 ? '' : 's'}.`);
        if (blocked.length) {
          this.emit({ type: 'bankFull' });
          this.message(`Your bank is full. Kept in your inventory: ${blocked.map((r) => name(r.item)).join(', ')}.`, 'warn');
        }
        break;
      }
      case 'bankSetTab':
        if (isItemId(cmd.item)) bank.setTab(cmd.item, cmd.tab);
        break;
      case 'bankReleasePlaceholders': {
        const n = bank.releasePlaceholders(cmd.item !== undefined && isItemId(cmd.item) ? cmd.item : undefined);
        if (n > 0 && cmd.item === undefined) this.message(`Released ${n} placeholder${n === 1 ? '' : 's'}.`);
        break;
      }
      case 'bankSetPlaceholders':
        bank.placeholders = cmd.on === true;
        this.message(bank.placeholders ? 'Placeholders on: withdrawing the last of an item keeps its place.' : 'Placeholders off.');
        break;
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
      if (skill === 'prayer') this.player.prayerPoints += r.newLevel - r.oldLevel;
    }
  }

  private canGather(n: ResourceNode, verbose: boolean): boolean {
    const p = this.player;
    if (!this.isLit()) {
      if (verbose) this.tooDark();
      return false;
    }
    const lvl = p.skills.level(n.def.skill);
    if (lvl < n.def.levelReq) {
      if (verbose) this.message(`You need ${SKILL_INFO[n.def.skill].name} level ${n.def.levelReq} to ${n.def.skill === 'thieving' ? 'steal from' : 'gather from'} this ${n.def.name.toLowerCase()}.`, 'warn');
      return false;
    }
    const tool = n.def.tool ? this.toolFor(n.def.tool) : null;
    if (tool && !tool.tool) {
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
    const success = this.rng() < gatherChance(n.def, p.skills.level(n.def.skill), (n.def.tool ? this.toolFor(n.def.tool).tool?.tier : 1) ?? 1);
    this.emit({ type: 'gather', node: n.id, success });
    if (!success) return;
    // Better catches (e.g. mudskipper eels) become possible as the skill rises.
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
    if (xp > 0) this.grantXp(n.def.skill, xp);
    // A rare find only happens when there is room for it.
    if (n.def.rareDrop && this.rng() < n.def.rareDrop.chance && p.inventory.add(n.def.rareDrop.item, 1) === 1) {
      this.emit({ type: 'loot', item: n.def.rareDrop.item, qty: 1 });
      const found = itemDef(n.def.rareDrop.item).name.toLowerCase();
      this.message(`You found ${/^[aeiou]/.test(found) ? 'an' : 'a'} ${found}!`, 'good');
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
    if (n.def.service === 'exchange') {
      p.exchangeAt = n.id;
      this.emit({ type: 'exchangeOpen' });
      return;
    }
    if (isConvertService(n.def.service)) {
      p.tannerAt = n.id;
      this.emit({ type: 'tannerOpen', service: n.def.service });
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
    const boneXp = BONES[s.item];
    if (boneXp) {
      if (p.buryTimer > 0) return;
      p.inventory.removeAt(slot, 1);
      p.buryTimer = 1.2;
      p.attackTimer = Math.max(p.attackTimer, 0.6);
      this.grantXp('prayer', boneXp);
      this.emit({ type: 'bury' });
      this.message(`You bury the ${d.name.toLowerCase()}.`);
      return;
    }
    if (d.kind === 'food' && d.heal) {
      if (p.eatTimer > 0) return;
      const devotionRoom = d.devotion ? p.skills.level('prayer') - p.prayerPoints : 0;
      if (p.hp >= p.maxHp && devotionRoom <= 0) {
        this.message('You are already at full health.');
        return;
      }
      p.inventory.removeAt(slot, 1);
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + d.heal);
      if (d.devotion && devotionRoom > 0) p.prayerPoints += Math.min(d.devotion, devotionRoom);
      p.eatTimer = 1.2;
      p.attackTimer = Math.max(p.attackTimer, 0.6);
      this.emit({ type: 'heal', id: p.id, amount: p.hp - before });
      this.message(`You eat the ${d.name.toLowerCase()}. It heals ${p.hp - before} HP.`, 'good');
    } else {
      this.message(d.examine);
    }
  }

  // ---------------------------------------------------------------- construction

  private hotspotByDef(id: string): Hotspot | undefined {
    return this.hotspots.find((h) => h.def.id === id);
  }

  /** Walk to a passage, then come out at the other end. */
  private updatePassage(id: number) {
    const p = this.player;
    const d = this.byId.get(id);
    if (!(d instanceof Doorway)) {
      p.action = null;
      return;
    }
    if (!this.approach(d.x, d.z, 1.3, true)) return;
    p.action = null;
    const other = this.doorways.find((o) => o.def.id === d.def.to);
    if (!other) return;
    p.x = p.prevX = other.def.arriveX;
    p.z = p.prevZ = other.def.arriveZ;
    p.path = [];
    p.facing = Math.atan2(other.def.arriveX - other.def.x, other.def.arriveZ - other.def.z);
    for (const e of this.enemies) if (e.target === p.id) {
      e.target = null;
      e.state = 'return';
    }
    this.emit({ type: 'passage', passage: other.id });
    if (inHollow(p.x, p.z)) {
      p.darkWarned = false;
      this.updateLantern(0);
      if (!this.isLit()) {
        this.message(this.hasLantern() ? 'You climb down into Glimmer Hollow. Your lantern has no glowcaps to burn: it is pitch dark, and you can’t mine or fight.' : 'You climb down into Glimmer Hollow. It is pitch dark: without a glowcap lantern you can’t mine or fight here.', 'warn');
        p.darkWarned = true;
      } else this.message('You climb down into Glimmer Hollow. Your lantern glows green against the dark.', 'good');
    } else this.message('You climb back up into the daylight.');
  }

  hasLantern(): boolean {
    return this.player.inventory.has('glowcap_lantern');
  }

  /** Whether the player can see: always on the surface; underground only by a burning lantern. */
  isLit(): boolean {
    const p = this.player;
    return !inHollow(p.x, p.z) || (this.hasLantern() && p.lanternBurn > 0);
  }

  /** Underground, a lantern burns down and takes a fresh glowcap from the bag when it runs out. */
  private updateLantern(dt: number) {
    const p = this.player;
    if (!inHollow(p.x, p.z) || !this.hasLantern()) return;
    if (p.lanternBurn > 0) p.lanternBurn = Math.max(0, p.lanternBurn - dt);
    if (p.lanternBurn > 0) return;
    if (p.inventory.remove('cabbage', 1) === 1) {
      p.lanternBurn = LANTERN_SECONDS;
      p.darkWarned = false;
      const left = p.inventory.count('cabbage');
      this.message(`Your lantern takes a fresh glowcap (${left} left).`, left ? 'info' : 'warn');
    } else if (!p.darkWarned) {
      p.darkWarned = true;
      this.message('Your lantern gutters out. It is pitch dark: find the way up, or bring more glowcaps.', 'bad');
    }
  }

  private tooDark(): boolean {
    if (this.isLit()) return false;
    this.message('It is too dark to see. You need a glowcap lantern with glowcaps to burn.', 'warn');
    return true;
  }

  private updateHotspotApproach(id: number) {
    const p = this.player;
    const h = this.byId.get(id);
    if (!(h instanceof Hotspot)) {
      p.action = null;
      return;
    }
    if (!this.approach(h.x, h.z, 1.3, true)) return;
    p.action = null;
    p.facing = Math.atan2(h.x - p.x, h.z - p.z);
    this.emit({ type: 'hotspotOpen', hotspot: h.def.id });
  }

  /** All nails carried (any kind). */
  nailCount(): number {
    return NAILS.reduce((a, n) => a + this.player.inventory.count(n), 0);
  }

  /** Why a piece can't be built here and now (null if it can). */
  buildBlocker(hotspot: string, furniture: string): string | null {
    const p = this.player;
    const h = this.hotspotByDef(hotspot);
    const f = furnitureDef(furniture);
    if (!h || !f || !h.def.options.includes(f)) return 'You can’t build that there.';
    if (dist(p.x, p.z, h.x, h.z) > 2.2) return 'You need to be beside that space.';
    if (p.furniture[hotspot]) return 'Remove what is there first.';
    if (p.skills.level('construction') < f.level) return `You need Construction level ${f.level}.`;
    for (const t of ['hammer', 'saw'] as const) {
      const r = this.toolFor(t);
      if (!r.tool) return r.why;
    }
    if (p.inventory.count(f.plank) < f.planks) return `You need ${f.planks} ${plural(itemDef(f.plank).name.toLowerCase(), f.planks)}.`;
    if (this.nailCount() < f.nails) return `You need ${f.nails} nails.`;
    if (f.extra && p.inventory.count(f.extra.item) < f.extra.qty) return `You need ${f.extra.qty} ${plural(itemDef(f.extra.item).name.toLowerCase(), f.extra.qty)}.`;
    return null;
  }

  private startBuild(hotspot: string, furniture: string) {
    const p = this.player;
    const why = this.buildBlocker(hotspot, furniture);
    if (why) {
      this.message(why, 'warn');
      return;
    }
    p.path = [];
    p.action = { type: 'build', hotspot, furniture, t: 0 };
  }

  private updateBuild(a: Extract<PlayerAction, { type: 'build' }>, dt: number) {
    const p = this.player;
    if (p.moving) {
      p.action = null;
      return;
    }
    a.t += dt;
    if (a.t < BUILD_SECONDS) return;
    p.action = null;
    const why = this.buildBlocker(a.hotspot, a.furniture);
    if (why) {
      this.message(why, 'warn');
      return;
    }
    const f = furnitureDef(a.furniture)!;
    p.inventory.remove(f.plank, f.planks);
    let nails = f.nails;
    for (const n of NAILS) nails -= p.inventory.remove(n, nails);
    if (f.extra) p.inventory.remove(f.extra.item, f.extra.qty);
    p.furniture[a.hotspot] = f.id;
    this.grantXp('construction', f.xp);
    this.emit({ type: 'house' });
    this.message(`You build a ${f.name.toLowerCase()}.`, 'good');
  }

  private removeFurniture(hotspot: string) {
    const p = this.player;
    const h = this.hotspotByDef(hotspot);
    const id = p.furniture[hotspot];
    if (!h || !id) return;
    if (dist(p.x, p.z, h.x, h.z) > 2.2) {
      this.message('You need to be beside it.', 'warn');
      return;
    }
    delete p.furniture[hotspot];
    this.emit({ type: 'house' });
    this.message(`You remove the ${furnitureDef(id)!.name.toLowerCase()}.`);
  }

  // ---------------------------------------------------------------- farming

  /** The seed the player would plant now: the highest-level crop they can grow and have enough seeds for. */
  plantableSeed(): ItemId | null {
    const p = this.player;
    const lvl = p.skills.level('farming');
    const ok = Object.values(CROPS).filter((c) => lvl >= c.level && p.inventory.count(c.seed) >= SEEDS_PER_PATCH);
    return ok.sort((a, b) => b.level - a.level)[0]?.seed ?? null;
  }

  /** What tapping the patch would do next, for prompts and the status line. */
  patchState(f: FarmPatch): { what: 'rake' | 'plant' | 'growing' | 'harvest'; text: string } {
    const now = this.clock();
    f.settle(now);
    if (f.crop) {
      const g = f.growth(now);
      const c = CROPS[f.crop];
      if (g.ready) return { what: 'harvest', text: `${c.name} ready to harvest` };
      return { what: 'growing', text: `${c.name} growing (${g.stage + 1}/${g.stages}) · ready in ${g.minutesLeft} min` };
    }
    if (f.weeds > 0) return { what: 'rake', text: `Weedy patch · rake it (${f.weeds} left)` };
    return { what: 'plant', text: `Empty patch · plant ${SEEDS_PER_PATCH} seeds` };
  }

  /** Why the next step can't happen (null if it can). */
  private farmBlocker(f: FarmPatch, verbose: boolean): string | null {
    const st = this.patchState(f);
    const p = this.player;
    let why: string | null = null;
    if (st.what === 'rake') why = this.toolFor('rake').tool ? null : this.toolFor('rake').why;
    else if (st.what === 'plant') {
      if (!this.toolFor('seed_dibber').tool) why = this.toolFor('seed_dibber').why;
      else if (!this.plantableSeed()) why = `You need ${SEEDS_PER_PATCH} seeds of a crop you can grow (sunroot seeds from Farming 1; Tilly sells them).`;
    } else if (st.what === 'growing') why = `${st.text}.`;
    else if (!this.toolFor('spade').tool) why = this.toolFor('spade').why;
    else if (p.inventory.capacityFor(CROPS[f.crop!].produce) <= 0) why = 'Your inventory is full.';
    if (why && verbose) {
      if (why === 'Your inventory is full.') this.inventoryFull();
      else this.message(why, st.what === 'growing' ? 'info' : 'warn');
    }
    return why;
  }

  private updateFarming(id: number, dt: number) {
    const p = this.player;
    const f = this.get(id);
    if (!(f instanceof FarmPatch)) {
      p.action = null;
      return;
    }
    if (!this.approach(f.x, f.z, 1.3, true)) return;
    p.facing = Math.atan2(f.x - p.x, f.z - p.z);
    p.gatherTimer -= dt;
    if (p.gatherTimer > 0) return;
    p.gatherTimer = 1.8;
    if (this.farmBlocker(f, true)) {
      p.action = null;
      return;
    }
    const now = this.clock();
    const st = this.patchState(f);
    if (st.what === 'rake') {
      f.weeds--;
      p.inventory.add('weeds', 1);
      this.grantXp('farming', RAKE_XP);
      this.emit({ type: 'patch', patch: f.id });
      if (f.weeds <= 0) {
        f.bareSince = now;
        p.action = null;
        this.message('The patch is clear. Plant seeds with your seed dibber.', 'good');
      }
    } else if (st.what === 'plant') {
      const seed = this.plantableSeed()!;
      const c = cropForSeed(seed)!;
      p.inventory.remove(seed, SEEDS_PER_PATCH);
      f.crop = c.id;
      f.plantedAt = now;
      f.lives = PATCH_LIVES;
      this.grantXp('farming', c.plantXp);
      this.emit({ type: 'patch', patch: f.id });
      this.message(`You plant ${SEEDS_PER_PATCH} ${plural(itemDef(seed).name.toLowerCase(), SEEDS_PER_PATCH)}. They will be ready in about ${c.stages * c.stageMinutes} minutes.`, 'good');
      p.action = null;
    } else if (st.what === 'harvest') {
      const c = CROPS[f.crop!];
      p.inventory.add(c.produce, 1);
      this.emit({ type: 'loot', item: c.produce, qty: 1 });
      this.grantXp('farming', c.harvestXp);
      if (this.rng() < lifeLossChance(p.skills.level('farming'))) f.lives--;
      if (f.lives <= 0) {
        f.crop = null;
        f.weeds = 0;
        f.bareSince = now;
        p.action = null;
        this.message('You have harvested the patch completely.', 'good');
      }
      this.emit({ type: 'patch', patch: f.id });
    }
  }

  // ---------------------------------------------------------------- agility

  private updateObstacleApproach(a: Extract<PlayerAction, { type: 'obstacle' }>) {
    const p = this.player;
    const o = this.byId.get(a.obstacle);
    if (!(o instanceof Obstacle)) {
      p.action = null;
      return;
    }
    // Shortcuts work both ways: start from whichever end is nearer.
    if (!a.crossing && a.t === 0 && a.reverse === undefined) a.reverse = !!o.def.shortcut && dist(p.x, p.z, o.def.x2, o.def.z2) < dist(p.x, p.z, o.def.x1, o.def.z1);
    const d = crossingEnds(o.def, !!a.reverse);
    if (!this.approach(d.x1, d.z1, 0.5, true)) return;
    a.crossing = true;
    a.t = 0;
    p.x = p.prevX = d.x1;
    p.z = p.prevZ = d.z1;
    p.facing = Math.atan2(d.x2 - d.x1, d.z2 - d.z1);
    this.message(`You ${o.def.verb.toLowerCase()} the ${o.def.name.toLowerCase()}…`);
  }

  /** Scripted crossing: moves start to end, then xp (and the lap bonus after a full lap in order). */
  private updateCrossing(a: Extract<PlayerAction, { type: 'obstacle' }>, dt: number) {
    const p = this.player;
    const o = this.byId.get(a.obstacle) as Obstacle;
    const d = { ...o.def, ...crossingEnds(o.def, !!a.reverse) };
    const len = Math.hypot(d.x2 - d.x1, d.z2 - d.z1);
    const dur = len / CROSS_SPEED;
    const lvl = p.skills.level('agility');
    // A slip happens halfway across.
    if (a.t < dur / 2 && a.t + dt >= dur / 2 && this.rng() < slipChance(d, lvl)) {
      p.action = null;
      const side = this.walkableNear(p.x + (d.z2 - d.z1) / len, p.z - (d.x2 - d.x1) / len, d.x1, d.z1);
      p.x = p.prevX = side.x;
      p.z = p.prevZ = side.z;
      const dealt = Math.min(SLIP_DAMAGE, p.hp);
      p.hp -= dealt;
      p.combatTimer = 6;
      this.emit({ type: 'damage', target: p.id, source: p.id, amount: dealt, hit: true });
      this.message(`You slip and fall off the ${d.name.toLowerCase()}!`, 'bad');
      if (!d.shortcut) p.lapNext = 0;
      if (p.hp <= 0) this.killPlayer();
      return;
    }
    a.t += dt;
    const k = Math.min(1, a.t / dur);
    p.x = d.x1 + (d.x2 - d.x1) * k;
    p.z = d.z1 + (d.z2 - d.z1) * k;
    p.moving = true;
    if (k < 1) return;
    p.action = null;
    this.grantXp('agility', d.xp);
    this.emit({ type: 'obstacle', obstacle: o.id });
    if (o.def.shortcut) return;
    const last = o.index === VILLAGE_COURSE.length - 1;
    if (o.index === p.lapNext && last) {
      p.laps++;
      p.lapNext = 0;
      this.grantXp('agility', LAP_BONUS);
      this.message(`Lap complete! (${p.laps} lap${p.laps === 1 ? '' : 's'})`, 'good');
    } else p.lapNext = o.index === p.lapNext || o.index === 0 ? o.index + 1 : 0;
  }

  // ---------------------------------------------------------------- thieving

  private updatePickpocket(id: number, dt: number) {
    const p = this.player;
    const n = this.byId.get(id);
    if (!(n instanceof Npc) || !n.def.thieving) {
      p.action = null;
      return;
    }
    if (!this.approach(n.x, n.z, 1.3, true)) return;
    p.facing = Math.atan2(n.x - p.x, n.z - p.z);
    p.thieveTimer -= dt;
    if (p.thieveTimer > 0) return;
    p.action = null;
    const t = n.def.thieving;
    const lvl = p.skills.level('thieving');
    if (lvl < t.level) {
      this.message(`You need Thieving level ${t.level} to pickpocket ${n.def.name}.`, 'warn');
      return;
    }
    if (p.inventory.freeSlots() === 0 && !t.loot.every((l) => p.inventory.capacityFor(l.item) >= l.max)) {
      this.inventoryFull();
      return;
    }
    this.emit({ type: 'pickpocket', npc: n.id });
    if (this.rng() < pickpocketChance(lvl, t.level)) {
      let r = this.rng() * t.loot.reduce((a, l) => a + l.weight, 0);
      const loot = t.loot.find((l) => (r -= l.weight) < 0) ?? t.loot[0];
      const qty = randInt(this.rng, loot.min, loot.max);
      const got = p.inventory.add(loot.item, qty);
      if (got > 0) this.emit({ type: 'loot', item: loot.item, qty: got });
      this.grantXp('thieving', t.xp);
      this.message(`You pick ${n.def.name}'s pocket.`, 'good');
      return;
    }
    // Caught: a clip round the ear and a few seconds stunned.
    n.talkAge = 0;
    p.stunTimer = 5;
    p.path = [];
    const dealt = Math.min(t.stunDamage, p.hp);
    p.hp -= dealt;
    p.combatTimer = 6;
    this.emit({ type: 'damage', target: p.id, source: n.id, amount: dealt, hit: true });
    this.emit({ type: 'stunned' });
    this.message(`You fail to pick ${n.def.name}'s pocket. ${n.def.name}: "What do you think you're doing?"`, 'bad');
    if (p.hp <= 0) this.killPlayer();
  }

  // ---------------------------------------------------------------- prayer

  /** The effective-level multiplier active prayers give a roll (1 with none). */
  prayerBoost(kind: 'attack' | 'strength' | 'defence' | 'ranged' | 'magic'): number {
    let m = 1;
    for (const id of this.player.prayers) {
      const b = prayerDef(id)?.boost;
      if (b && b.kind === kind) m = Math.max(m, b.mult);
    }
    return m;
  }

  private togglePrayer(id: PrayerId) {
    const p = this.player;
    const def = prayerDef(id);
    if (!def) return;
    if (p.prayers.has(id)) {
      p.prayers.delete(id);
      this.emit({ type: 'prayer' });
      return;
    }
    if (p.skills.level('prayer') < def.level) {
      this.message(`You need Devotion level ${def.level} to swear ${def.name}.`, 'warn');
      return;
    }
    if (p.prayerPoints <= 0) {
      this.message('Your devotion is spent. Restore it at the shrine or a waystone.', 'warn');
      return;
    }
    for (const other of [...p.prayers]) if (conflicts(def, prayerDef(other)!)) p.prayers.delete(other);
    p.prayers.add(id);
    this.emit({ type: 'prayer' });
  }

  /** Kept vows use devotion continuously (points per minute); a whole point is spent at a time. */
  private updatePrayer(dt: number) {
    const p = this.player;
    if (!p.prayers.size) return;
    for (const id of p.prayers) p.prayerDrain += (prayerDef(id)!.drainPerMin / 60) * dt;
    while (p.prayerDrain >= 1) {
      p.prayerDrain -= 1;
      p.prayerPoints = Math.max(0, p.prayerPoints - 1);
    }
    if (p.prayerPoints <= 0) {
      p.prayers.clear();
      p.prayerDrain = 0;
      this.emit({ type: 'prayer' });
      this.message('Your devotion is spent and your vows fall quiet. Restore it at the shrine or a waystone.', 'warn');
    }
  }

  /** The shrine or waystone close enough to pray at (any of them is an altar), if any. */
  nearAltar(): Checkpoint | null {
    const p = this.player;
    return this.map.checkpoints.find((c) => dist(p.x, p.z, c.x, c.z) < 2.6) ?? null;
  }

  /**
   * Shrines and waystones charge quartz chips into spark stones, the fuel for wand spells (one
   * stone per cast). All carried chips charge at once; Magic xp for each.
   */
  private chargeSparks() {
    const p = this.player;
    const altar = this.nearAltar();
    if (!altar) {
      this.message('Spark chips can only be charged at the shrine or a waystone.', 'warn');
      return;
    }
    const chips = p.inventory.count('dull_spark');
    if (chips <= 0) {
      this.message('You have no dull spark chips. Chip spark quartz with a chisel first.', 'warn');
      return;
    }
    const sim = p.inventory.clone();
    sim.remove('dull_spark', chips);
    const n = Math.min(chips, sim.capacityFor('air_rune'));
    if (n <= 0) {
      this.inventoryFull();
      return;
    }
    if (p.inventory.remove('dull_spark', n) !== n || p.inventory.add('air_rune', n) !== n) throw new Error('spark charge invariant broken');
    this.grantXp('magic', n * 0.5);
    this.emit({ type: 'loot', item: 'air_rune', qty: n });
    this.message(`The ${altar.name}'s light fills the chips: ${n} spark stone${n === 1 ? '' : 's'}.`, 'good');
  }

  /** The coins needed to reclaim everything held at the shrines. */
  reclaimCost(): number {
    return this.player.shrineHeld.reduce((a, s) => a + s.qty * reclaimFee(itemDef(s.item).value), 0);
  }

  /**
   * Takes back what a faded wisp carried to the shrines: as much as fits and can be paid for, item
   * by item (a tenth of each item's value, at least a coin). Coins come from the bag.
   */
  private reclaimHeld() {
    const p = this.player;
    const altar = this.nearAltar();
    if (!altar) {
      this.message('Your held things can be reclaimed at the shrine or a waystone.', 'warn');
      return;
    }
    if (!p.shrineHeld.length) {
      this.message('The shrines hold nothing of yours.');
      return;
    }
    let moved = 0;
    let paid = 0;
    for (const s of p.shrineHeld) {
      if (s.item === 'coins') {
        const n = p.inventory.add('coins', s.qty);
        s.qty -= n;
        moved += n;
        continue;
      }
      const fee = reclaimFee(itemDef(s.item).value);
      while (s.qty > 0 && p.inventory.count('coins') >= fee) {
        const sim = p.inventory.clone();
        sim.remove('coins', fee);
        if (sim.capacityFor(s.item) <= 0) break;
        p.inventory.remove('coins', fee);
        p.inventory.add(s.item, 1);
        s.qty--;
        moved++;
        paid += fee;
      }
    }
    p.shrineHeld = p.shrineHeld.filter((s) => s.qty > 0);
    if (moved === 0) {
      this.message(p.inventory.isFull() ? 'Your inventory is full.' : `You need coins in your bag for the offering (${this.reclaimCost()} for everything).`, 'warn');
      return;
    }
    this.emit({ type: 'equipment' });
    const left = p.shrineHeld.reduce((a, s) => a + s.qty, 0);
    this.message(`The ${altar.name} returns ${moved} item${moved === 1 ? '' : 's'} for an offering of ${paid} coin${paid === 1 ? '' : 's'}.${left ? ` ${left} still wait here.` : ''}`, left ? 'warn' : 'good');
  }

  /** Wardleaf incense: every carried leaf burns at once, for Devotion xp and a point of devotion each. */
  private burnIncense() {
    const p = this.player;
    const altar = this.nearAltar();
    if (!altar) {
      this.message('Wardleaf is burned at the shrine or a waystone.', 'warn');
      return;
    }
    const n = p.inventory.count('onion');
    if (n <= 0) {
      this.message('You have no wardleaf. Grow it in the allotments (Farming 4).', 'warn');
      return;
    }
    p.inventory.remove('onion', n);
    p.prayerPoints = Math.min(p.skills.level('prayer'), p.prayerPoints + n);
    this.grantXp('prayer', n * WARDLEAF_XP);
    this.emit({ type: 'bury' });
    this.message(`Sweet smoke rises from the ${altar.name}: ${n} wardleaf burned.`, 'good');
  }

  /** Whether there is open water within reach (a river or lake edge). */
  nearWater(): boolean {
    const p = this.player;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.hypot(dx, dz) > 2.2) continue;
      if (tileAt(this.map, p.x + dx, p.z + dz) === T.Water) return true;
    }
    return false;
  }

  /**
   * Glimsteel only sets when its hot bloom is plunged into running water: stand at a river or lake
   * edge and every bloom you carry becomes a glimsteel bar (Smithing xp for each).
   */
  private quench() {
    const p = this.player;
    const n = p.inventory.count('glimsteel_bloom');
    if (n <= 0) {
      this.message('You have no hot glimsteel blooms to quench.', 'warn');
      return;
    }
    if (!this.nearWater()) {
      this.message('Glimsteel must be quenched in running water. Stand at the river’s edge.', 'warn');
      return;
    }
    // One bloom becomes one bar in the same slot: it always fits.
    for (let i = 0; i < p.inventory.slots.length; i++) if (p.inventory.slots[i]?.item === 'glimsteel_bloom') p.inventory.slots[i] = { item: 'glimsteel_bar', qty: 1 };
    this.grantXp('smithing', n * 25);
    this.emit({ type: 'quench', x: p.x, z: p.z });
    this.emit({ type: 'loot', item: 'glimsteel_bar', qty: n });
    this.message(`The river hisses and steams: ${n} glimsteel bar${n === 1 ? '' : 's'}.`, 'good');
  }

  private pray() {
    const p = this.player;
    const altar = this.nearAltar();
    if (!altar) {
      this.message('You need to be at the shrine or a waystone to pray.', 'warn');
      return;
    }
    const max = p.skills.level('prayer');
    if (p.prayerPoints >= max) {
      this.message('Your devotion is already full.');
      return;
    }
    p.prayerPoints = max;
    this.emit({ type: 'prayer' });
    this.message(`You kneel at the ${altar.name}. The spirits restore your devotion.`, 'good');
  }

  // ---------------------------------------------------------------- enemies

  private updateEnemy(e: Enemy, dt: number) {
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

    const dSpawn = dist(e.x, e.z, e.spawnX, e.spawnZ);

    if ((e.state === 'idle' || e.state === 'wander') && def.aggressive) {
      // The nearest player in range draws it (aggression fades once a player greatly out-levels it).
      let pick: Player | null = null;
      let best: number = def.aggroRange;
      for (const q of this.players.values()) {
        const d = dist(e.x, e.z, q.x, q.z);
        if (q.dead || d >= best) continue;
        if (q.skills.combatLevel() < def.level * 2 + 2 || def.id === 'goblin_warlord') {
          pick = q;
          best = d;
        }
      }
      if (pick) {
        e.state = 'chase';
        e.target = pick.id;
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
        const p = e.target !== null ? this.players.get(e.target) : undefined;
        if (!p || p.dead || dSpawn > def.leashRange) {
          e.state = 'return';
          e.target = null;
          break;
        }
        const dPlayer = dist(e.x, e.z, p.x, p.z);
        this.turnToward(e, p.x, p.z, dt);
        if (dPlayer > def.attackRange * 0.9) {
          const step = def.speed * dt;
          this.moveEntity(e, (p.x - e.x) / dPlayer, (p.z - e.z) / dPlayer, step);
          e.moving = true;
        }
        if (dPlayer <= def.attackRange && e.attackTimer <= 0) this.act(p, () => this.enemyAttack(e));
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
      { defenceLevel: p.skills.level('defence') * this.prayerBoost('defence'), armour: this.playerBonuses().armour },
      def.maxHit,
    );
    // Hearth's Bulwark halves creatures' hits (it softens blows; it never makes you untouchable).
    if (p.prayers.has('hearth_bulwark') && r.damage > 0) r.damage = Math.max(1, Math.round(r.damage * BULWARK_DAMAGE));
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
    this.pending = this.pending.filter((h) => h.attacker !== p.id);
    this.emit({ type: 'death', id: p.id });
    p.stationAt = null;
    const keep = KEEP_ON_DEATH + (p.prayers.has('keepsake') ? 1 : 0);
    p.prayers.clear();
    const { kept, lost } = takeLostOnDeath(p.inventory, p.equipment, keep);
    const lostCount = lost.reduce((a, s) => a + s.qty, 0);
    let grave: Gravestone | null = null;
    if (lost.length) {
      const at = this.walkableNear(p.x, p.z, this.map.spawn.x, this.map.spawn.z);
      grave = this.spawnGrave(at.x, at.z, lost);
    }
    p.lastDeath = { kept, lost: lostCount, grave: grave?.id ?? null, keep };
    this.emit({ type: 'equipment' });
    const keptText = kept.length ? kept.map((k) => `${k.qty > 1 ? `${k.qty} x ` : ''}${itemDef(k.item).name}`).join(', ') : 'nothing';
    this.message(`Oh dear, you have been defeated! You keep your ${keep} most valuable items: ${keptText}.`, 'bad');
    if (grave) {
      const r = regionAt(grave.x, grave.z);
      this.message(`A shrine wisp guards your other ${lostCount} item${lostCount === 1 ? '' : 's'} where you fell${r ? ` (${r.name})` : ''}. Reach it within ${GRAVE_SECONDS / 60} minutes to take them back; after that they wait at the shrines.`, 'warn');
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
    p.prayerPoints = p.skills.level('prayer');
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
    return { ...base, lines: [line], pickpocket: n.def.thieving ? n.id : undefined };
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
