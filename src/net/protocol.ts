import { ITEMS } from '../data/items';
import type { WorldMap } from '../sim/worldmap';
import type { Appearance, Command, GameEvent, PlayerId } from '../sim/world';
import type { CharacterRecord } from '../sim/records';
import type { WorldState } from './replica';
import { validateCommand } from './validate';

/**
 * The network protocol between the browser and the development server (docs/MULTIPLAYER.md 3A.2).
 * JSON messages over a WebSocket. Clients send intents only; the server sends state and events.
 */
export const PROTOCOL_VERSION = 1;
/** Largest message a client may send (bytes); anything bigger is rejected unread. */
export const MAX_CLIENT_MESSAGE = 8 * 1024;
/** Server snapshots per second. */
export const SNAPSHOT_HZ = 10;

export type ClientMessage =
  /** First message: protocol and content versions, and the guest character's name and looks. */
  | { t: 'hello'; v: number; content: string; name: string; appearance?: Appearance }
  | { t: 'cmd'; cmd: Command }
  /** One tick of joystick movement, numbered so the server can acknowledge it. */
  | { t: 'input'; seq: number; dx: number; dz: number }
  | { t: 'ping'; at: number };

export type ServerMessage =
  | { t: 'welcome'; v: number; playerId: PlayerId; character: CharacterRecord; state: WorldState }
  | { t: 'state'; state: WorldState; events: GameEvent[]; character?: CharacterRecord }
  | { t: 'error'; error: string; fatal?: boolean }
  | { t: 'pong'; at: number };

const NAME = /^[A-Za-z][A-Za-z0-9 _-]{0,11}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}
function onlyKeys(v: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(v).every((k) => keys.includes(k));
}
const finite = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

export function validAppearance(a: unknown): a is Appearance {
  return (
    isPlainObject(a) &&
    onlyKeys(a, ['bodyType', 'skin', 'hair', 'hairStyle', 'tunic', 'trousers']) &&
    (a.bodyType === 0 || a.bodyType === 1) &&
    Number.isInteger(a.hairStyle) && (a.hairStyle as number) >= 0 && (a.hairStyle as number) <= 7 &&
    ['skin', 'hair', 'tunic', 'trousers'].every((k) => typeof a[k] === 'string' && COLOR.test(a[k] as string))
  );
}

/** Parses and strictly validates a client message. Returns null for anything malformed. Never throws. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== 'string' || raw.length > MAX_CLIENT_MESSAGE) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(m)) return null;
  switch (m.t) {
    case 'hello':
      if (!onlyKeys(m, ['t', 'v', 'content', 'name', 'appearance'])) return null;
      if (!Number.isInteger(m.v) || typeof m.content !== 'string' || m.content.length > 64) return null;
      if (typeof m.name !== 'string' || !NAME.test(m.name)) return null;
      if (m.appearance !== undefined && !validAppearance(m.appearance)) return null;
      return m as ClientMessage;
    case 'cmd': {
      if (!onlyKeys(m, ['t', 'cmd'])) return null;
      const cmd = validateCommand(m.cmd);
      return cmd ? { t: 'cmd', cmd } : null;
    }
    case 'input':
      if (!onlyKeys(m, ['t', 'seq', 'dx', 'dz'])) return null;
      if (!Number.isInteger(m.seq) || (m.seq as number) < 1 || (m.seq as number) > Number.MAX_SAFE_INTEGER) return null;
      if (!finite(m.dx, -2, 2) || !finite(m.dz, -2, 2)) return null;
      return m as ClientMessage;
    case 'ping':
      if (!onlyKeys(m, ['t', 'at']) || !finite(m.at, 0, Number.MAX_SAFE_INTEGER)) return null;
      return m as ClientMessage;
    default:
      return null;
  }
}

/**
 * A fingerprint of the game content both sides must share: the map (generated from the same seed)
 * and the item table. A client built from different content is turned away instead of desyncing.
 */
export function contentVersion(map: WorldMap): string {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    h ^= n & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (let i = 0; i < map.tiles.length; i++) mix(map.tiles[i] * 7 + map.blocked[i]);
  for (const r of map.resources) mix(r.x * 131 + r.z);
  for (const id of Object.keys(ITEMS)) for (let i = 0; i < id.length; i++) mix(id.charCodeAt(i));
  return `${PROTOCOL_VERSION}-${map.width}x${map.height}-${h.toString(16)}`;
}
