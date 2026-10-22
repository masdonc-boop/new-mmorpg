import { EQUIP_SLOTS, isItemId } from '../data/items';
import { RECIPES } from '../data/recipes';
import { QUESTS } from '../data/quests';
import { PRAYERS } from '../data/prayers';
import { TOOL_SLOTS } from '../data/tools';
import { HOTSPOTS, furnitureDef } from '../data/construction';
import { STYLES } from '../sim/combat';
import { INVENTORY_SLOTS } from '../sim/inventory';
import { BANK_TABS } from '../sim/bank';
import { MAX_COINS, MAX_QTY } from '../exchange/engine';
import type { Command } from '../sim/world';

/**
 * Strict validation of client commands (docs/MULTIPLAYER.md, 3A.1). A server runs every incoming
 * message through `validateCommand` before the simulation sees it: anything that isn't exactly one
 * of the known command shapes, with in-range values and no extra fields, is rejected. The
 * simulation still checks the game rules (reach, levels, tools, space, coins); this layer only
 * guarantees well-formed input.
 */

type Check = (v: unknown) => boolean;

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};
const int = (min: number, max: number): Check => (v) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const num = (min: number, max: number): Check => (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const bool: Check = (v) => typeof v === 'boolean';
const oneOf = (values: readonly string[]): Check => {
  const set = new Set(values);
  return (v) => typeof v === 'string' && set.has(v);
};
const own = (table: object): Check => (v) => typeof v === 'string' && v.length <= 64 && Object.prototype.hasOwnProperty.call(table, v);

const invSlot = int(0, INVENTORY_SLOTS - 1);
const entity = int(0, 2_147_483_647);
const item: Check = (v) => typeof v === 'string' && v.length <= 64 && isItemId(v);
const qty = int(1, MAX_COINS);
const tab = int(0, BANK_TABS);
const nonce = int(0, Number.MAX_SAFE_INTEGER);
const orderId = int(1, Number.MAX_SAFE_INTEGER);

/** Field checks per command (`opt` marks an optional field). Exhaustive: every command kind must be listed. */
const opt = (c: Check) => ({ optional: true as const, c });
type Field = Check | ReturnType<typeof opt>;

const exchangeIntent: Check = (v) => {
  if (!isPlainObject(v)) return false;
  if (v.op === 'place') return fields(v, { op: () => true, nonce, slot: int(0, 15), side: oneOf(['buy', 'sell']), item, qty: int(1, MAX_QTY), price: int(1, MAX_COINS) });
  if (v.op === 'cancel' || v.op === 'collect') return fields(v, { op: () => true, nonce, orderId });
  return false;
};

const COMMANDS: Record<Command['type'], Record<string, Field>> = {
  joystick: { dx: num(-2, 2), dz: num(-2, 2) },
  moveTo: { x: num(-16, 4096), z: num(-16, 4096) },
  interact: { target: entity },
  setStyle: { style: own(STYLES) },
  useItem: { slot: invSlot },
  dropItem: { slot: invSlot },
  swapItems: { a: invSlot, b: invSlot },
  claimOverflow: {},
  discardOverflow: {},
  bankDeposit: { slot: invSlot, qty, tab: opt(tab) },
  bankDepositAll: { tab: opt(tab) },
  bankSetTab: { item, tab },
  bankReleasePlaceholders: { item: opt(item) },
  bankSetPlaceholders: { on: bool },
  bankDepositHeld: {},
  bankWithdraw: { item, qty },
  bankClose: {},
  equip: { slot: invSlot },
  unequip: { slot: oneOf(EQUIP_SLOTS) },
  craft: { recipe: own(RECIPES), count: int(1, 10_000) },
  beltAdd: { slot: invSlot },
  beltRemove: { category: oneOf(TOOL_SLOTS.map((t) => t.id)) },
  beltAddAll: {},
  lightFire: { slot: invSlot },
  openFletching: {},
  openAnywhere: { kind: oneOf(['fletching', 'crafting']) },
  closeProduction: {},
  shopBuy: { item, qty },
  shopSell: { slot: invSlot, qty },
  shopClose: {},
  tan: { item, qty },
  tannerClose: {},
  acceptQuest: { quest: own(QUESTS) },
  tradeRequest: { target: entity },
  tradeOffer: { slot: invSlot, qty },
  tradeRemove: { item, qty },
  tradeAccept: {},
  tradeDecline: {},
  exchange: { req: exchangeIntent },
  exchangeClose: {},
  exchangeResetPractice: {},
  build: { hotspot: oneOf(HOTSPOTS.map((h) => h.id)), furniture: (v) => typeof v === 'string' && v.length <= 64 && !!furnitureDef(v) },
  removeFurniture: { hotspot: oneOf(HOTSPOTS.map((h) => h.id)) },
  pickpocket: { target: entity },
  togglePrayer: { prayer: oneOf(PRAYERS.map((p) => p.id)) },
  pray: {},
  chargeSparks: {},
  burnIncense: {},
  reclaimHeld: {},
  quench: {},
  setOption: { option: oneOf(['autoGather']), on: bool },
  respawn: { at: oneOf(['home', 'checkpoint']) },
};

function fields(v: Record<string, unknown>, spec: Record<string, Field>, extra: readonly string[] = []): boolean {
  // Own properties only: `in` would also see Object.prototype names such as __proto__ or toString.
  for (const k of Object.keys(v)) if (!Object.prototype.hasOwnProperty.call(spec, k) && !extra.includes(k)) return false;
  for (const [k, f] of Object.entries(spec)) {
    const present = Object.prototype.hasOwnProperty.call(v, k) && v[k] !== undefined;
    if (typeof f === 'function') {
      if (!present || !f(v[k])) return false;
    } else if (present && !f.c(v[k])) return false;
  }
  return true;
}

/** Returns the command if it is exactly a valid command, otherwise null. Never throws. */
export function validateCommand(input: unknown): Command | null {
  try {
    if (!isPlainObject(input) || typeof input.type !== 'string') return null;
    if (!Object.prototype.hasOwnProperty.call(COMMANDS, input.type)) return null;
    const spec = COMMANDS[input.type as Command['type']];
    if (!fields(input, spec, ['type'])) return null;
    // Return a fresh copy so later changes to the input can't reach the simulation.
    return JSON.parse(JSON.stringify(input)) as Command;
  } catch {
    return null;
  }
}

/** Every command kind the validator knows (for tests and protocol docs). */
export const COMMAND_TYPES = Object.keys(COMMANDS) as Command['type'][];

