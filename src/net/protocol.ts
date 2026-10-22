import { ITEMS } from '../data/items';
import type { StateDelta } from './delta';
import type { WorldMap } from '../sim/worldmap';
import type { Appearance, Command, GameEvent, PlayerId } from '../sim/world';
import type { CharacterRecord } from '../sim/records';
import type { WorldState } from './replica';
import { validateCommand } from './validate';

/**
 * The network protocol between the browser and the development server (docs/MULTIPLAYER.md 3A.2).
 * JSON messages over a WebSocket. Clients send intents only; the server sends state and events.
 */
export const PROTOCOL_VERSION = 4;
/** Largest message a client may send (bytes); anything bigger is rejected unread. */
export const MAX_CLIENT_MESSAGE = 8 * 1024;
/** A save import (signed-in accounts only) may be larger. */
export const MAX_IMPORT_MESSAGE = 300 * 1024;
/** Server snapshots per second. */
export const SNAPSHOT_HZ = 10;

/**
 * How a client signs in (docs/MULTIPLAYER.md 3.4). `guest` only works on a server started with
 * guests allowed (development and tests). A new account creates its character with the same name.
 */
export type Auth =
  | { kind: 'guest'; name: string; appearance?: Appearance }
  | { kind: 'register'; username: string; password: string; appearance?: Appearance }
  | { kind: 'login'; username: string; password: string }
  | { kind: 'token'; token: string };

export type ClientMessage =
  /** First message: protocol and content versions, and how to sign in. */
  | { t: 'hello'; v: number; content: string; auth: Auth }
  /** Sign out: the server saves the character and ends the session token. */
  | { t: 'logout' }
  /** Bring a browser-local save onto this account (once; docs/MULTIPLAYER.md section 7). */
  | { t: 'import'; save: Record<string, unknown> }
  | { t: 'cmd'; cmd: Command }
  /** One tick of joystick movement, numbered so the server can acknowledge it. */
  | { t: 'input'; seq: number; dx: number; dz: number }
  | { t: 'ping'; at: number }
  /** Chat (3A.6): to players nearby, or privately to one player by name. */
  | { t: 'chat'; channel: ChatChannel; to?: string; text: string }
  /** Stop (or start again) hearing from a player. */
  | { t: 'block'; name: string; on: boolean }
  /** Report a player's chat to the moderators (what this player saw from them goes along). */
  | { t: 'report'; name: string; reason: string };

export type ChatChannel = 'local' | 'private';

export type ServerMessage =
  /** `session`: a token to sign in again without the password (only after a password sign-in). */
  | { t: 'welcome'; v: number; playerId: PlayerId; character: CharacterRecord; state: WorldState; session?: string }
  /** What changed since the last state this connection was sent (the welcome is the first). */
  | { t: 'state'; delta: StateDelta; events: GameEvent[]; character?: CharacterRecord }
  | { t: 'error'; error: string; fatal?: boolean; code?: ErrorCode }
  | { t: 'pong'; at: number }
  /** The import worked: what was changed on the way in (a fresh `welcome` follows). */
  | { t: 'imported'; report: string[] }
  /** A chat message. Private messages this player sent come back with `to` set. */
  | { t: 'chat'; channel: ChatChannel; from: string; to?: string; text: string }
  /** The players this account has blocked (sent on joining and after a change). */
  | { t: 'social'; blocked: string[] }
  /** A note from the server for the message log (chat refused, report filed, …). */
  | { t: 'notice'; text: string; tone?: 'info' | 'warn' | 'good' };

/** Machine-readable reasons, so the client knows whether to ask for a password or try again. */
export type ErrorCode = 'auth' | 'taken' | 'locked' | 'version' | 'replaced' | 'session' | 'stale' | 'import';

/** Guest names (development). Account names are checked by the server so it can say what's wrong. */
export const GUEST_NAME = /^[A-Za-z][A-Za-z0-9 _-]{0,11}$/;
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

function validAuth(a: unknown): a is Auth {
  if (!isPlainObject(a)) return false;
  const str = (v: unknown, max: number) => typeof v === 'string' && v.length >= 1 && v.length <= max;
  switch (a.kind) {
    case 'guest':
      return onlyKeys(a, ['kind', 'name', 'appearance']) && str(a.name, 32) && (a.appearance === undefined || validAppearance(a.appearance));
    case 'register':
      return onlyKeys(a, ['kind', 'username', 'password', 'appearance']) && str(a.username, 32) && str(a.password, 128) && (a.appearance === undefined || validAppearance(a.appearance));
    case 'login':
      return onlyKeys(a, ['kind', 'username', 'password']) && str(a.username, 32) && str(a.password, 128);
    case 'token':
      return onlyKeys(a, ['kind', 'token']) && typeof a.token === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(a.token);
    default:
      return false;
  }
}

/**
 * Parses and strictly validates a client message. Returns null for anything malformed. Never throws.
 * `allowImport`: the connection is a signed-in account, so a (larger) save import is acceptable.
 */
export function parseClientMessage(raw: unknown, opts: { allowImport?: boolean } = {}): ClientMessage | null {
  if (typeof raw !== 'string') return null;
  if (raw.length > (opts.allowImport ? MAX_IMPORT_MESSAGE : MAX_CLIENT_MESSAGE)) return null;
  if (raw.length > MAX_CLIENT_MESSAGE && !raw.startsWith('{"t":"import"')) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(m)) return null;
  switch (m.t) {
    case 'hello':
      if (!onlyKeys(m, ['t', 'v', 'content', 'auth'])) return null;
      if (!Number.isInteger(m.v) || typeof m.content !== 'string' || m.content.length > 64) return null;
      if (!validAuth(m.auth)) return null;
      return m as ClientMessage;
    case 'logout':
      return onlyKeys(m, ['t']) ? { t: 'logout' } : null;
    case 'import':
      // The save itself is checked by the server's import (it runs the game's restore path).
      return opts.allowImport && onlyKeys(m, ['t', 'save']) && isPlainObject(m.save) ? { t: 'import', save: m.save } : null;
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
    case 'chat':
      if (!onlyKeys(m, ['t', 'channel', 'to', 'text']) || typeof m.text !== 'string' || m.text.length > 400) return null;
      if (m.channel === 'local' && m.to === undefined) return m as ClientMessage;
      if (m.channel === 'private' && typeof m.to === 'string' && m.to.length >= 1 && m.to.length <= 32) return m as ClientMessage;
      return null;
    case 'block':
      if (!onlyKeys(m, ['t', 'name', 'on']) || typeof m.name !== 'string' || m.name.length < 1 || m.name.length > 32 || typeof m.on !== 'boolean') return null;
      return m as ClientMessage;
    case 'report':
      if (!onlyKeys(m, ['t', 'name', 'reason']) || typeof m.name !== 'string' || m.name.length < 1 || m.name.length > 32) return null;
      if (typeof m.reason !== 'string' || m.reason.length > 200) return null;
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
