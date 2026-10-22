import { createHash } from 'node:crypto';
import { GameWorld, type PlayerId, type SaveData } from '../src/sim/world';
import { isItemId, itemDef, type ItemId } from '../src/data/items';
import { SKILL_INFO, xpForLevel, type SkillId } from '../src/data/skills';
import { isBlocked, type WorldMap } from '../src/sim/worldmap';
import type { CharacterRecord } from '../src/sim/records';
import { validAppearance } from '../src/net/protocol';

/**
 * Importing a browser-local save onto an account (docs/MULTIPLAYER.md section 7 and 3A.4).
 *
 * Local saves can be edited by their owner, so an import is only as trustworthy as the policy
 * allows (an owner decision):
 * - `full`: everything carries over, within the limits below (recommended for a closed test);
 * - `progress`: skills, quests, grants, house, allotments and looks carry over; items and coins
 *   start fresh;
 * - `off`: no imports.
 *
 * The save goes through the game's own restore path (aliases, item checks, one-time grants,
 * overflow) on a fresh world, then the limits are applied. Everything changed is reported to the
 * player and recorded with the import.
 */
export type ImportPolicy = 'full' | 'progress' | 'off';

/** Highest xp an import may bring in a skill (level 99). */
export const IMPORT_MAX_XP = xpForLevel(99);
/** Most of one item an import may bring, across bag, bank, gear, belt and held items. */
export const IMPORT_COIN_CAP = 5_000_000;
export const IMPORT_ITEM_CAP = 25_000;
/** Largest save accepted (bytes of JSON, practice market removed). */
export const IMPORT_MAX_BYTES = 256 * 1024;

export type PreparedImport =
  | { ok: true; world: GameWorld; record: CharacterRecord; hash: string; report: string[] }
  | { ok: false; error: string };

/** A stable fingerprint of the uploaded save (used to stop the same save being imported twice). */
export function saveHash(save: unknown): string {
  return createHash('sha256').update(JSON.stringify(save)).digest('hex');
}

const CONTAINERS = ['inventory', 'overflow', 'bank', 'shrineHeld'] as const;

export function prepareImport(
  raw: unknown,
  opts: { map: WorldMap; clock: () => number; playerId: PlayerId; name: string; current: CharacterRecord; policy: ImportPolicy },
): PreparedImport {
  if (opts.policy === 'off') return { ok: false, error: 'Bringing characters over is switched off on this server.' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: "That isn't a Brightwater save." };
  const save = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  if (save.version !== 1) return { ok: false, error: 'That save is from a version of Brightwater this server does not know.' };
  if (JSON.stringify(save).length > IMPORT_MAX_BYTES) return { ok: false, error: 'That save is too large.' };
  const hash = saveHash(raw);
  const report: string[] = [];

  // Device-local and world-owned parts never come across; the name is the account's.
  for (const k of ['exchangePractice', 'ground', 'graves', 'playerId']) delete save[k];
  if (typeof save.name === 'string' && save.name !== opts.name) report.push(`Your character is called ${opts.name} here (the account name), not ${save.name}.`);
  save.name = opts.name;
  if (!validAppearance(save.appearance)) {
    save.appearance = opts.current.appearance;
    report.push('Your looks could not be read, so the account’s looks were kept.');
  }

  // Skills: cap xp.
  const xp = (save.xp && typeof save.xp === 'object' ? save.xp : {}) as Record<string, unknown>;
  for (const [skill, v] of Object.entries(xp)) {
    if (typeof v === 'number' && v > IMPORT_MAX_XP) {
      xp[skill] = IMPORT_MAX_XP;
      report.push(`${SKILL_INFO[skill as SkillId]?.name ?? skill} xp was capped at ${IMPORT_MAX_XP.toLocaleString('en')}.`);
    }
  }

  // Note items the game no longer knows (the restore drops them).
  const unknown = new Set<string>();
  for (const c of CONTAINERS) {
    const list = save[c];
    if (Array.isArray(list)) for (const s of list) if (s && typeof s === 'object' && typeof (s as { item?: unknown }).item === 'string' && !isItemId((s as { item: string }).item)) unknown.add((s as { item: string }).item);
  }
  if (unknown.size) report.push(`Unknown items were left behind: ${[...unknown].slice(0, 5).join(', ')}${unknown.size > 5 ? '…' : ''}.`);
  const sx = Number(save.x);
  const sz = Number(save.z);
  if (!Number.isFinite(sx) || !Number.isFinite(sz) || isBlocked(opts.map, sx, sz)) report.push('You start at the village shrine (the saved position was not valid).');

  let world: GameWorld;
  try {
    world = new GameWorld({ save: save as unknown as SaveData, map: opts.map, clock: opts.clock, playerId: opts.playerId });
  } catch {
    return { ok: false, error: 'That save could not be read.' };
  }
  world.drainEvents();
  const p = world.player;

  if (opts.policy === 'progress') {
    // Progress only: the character keeps the items it has on the server.
    const fresh = new GameWorld({ save: { ...opts.current, name: opts.name } as SaveData, map: opts.map, clock: opts.clock, playerId: opts.playerId });
    p.inventory = fresh.player.inventory;
    p.bank = fresh.player.bank;
    p.equipment = fresh.player.equipment;
    p.toolbelt = fresh.player.toolbelt;
    p.overflow = fresh.player.overflow;
    p.shrineHeld = fresh.player.shrineHeld;
    report.push('Skills, quests, house and allotments came across. Items and coins start fresh on this server.');
  } else {
    // Cap each item's total across every container (bank first, then held items, then the bag).
    const totals = new Map<ItemId, number>();
    const add = (item: ItemId, n: number) => totals.set(item, (totals.get(item) ?? 0) + n);
    for (const s of p.inventory.slots) if (s) add(s.item, s.qty);
    for (const s of p.bank.toJSON()) add(s.item, s.qty);
    for (const s of p.overflow) add(s.item, s.qty);
    for (const s of p.shrineHeld) add(s.item, s.qty);
    for (const [slot, it] of Object.entries(p.equipment.slots)) if (it) add(it, slot === 'ammo' ? p.equipment.ammoQty : 1);
    for (const it of Object.values(p.toolbelt.slots)) if (it) add(it, 1);
    for (const [item, total] of totals) {
      const cap = item === 'coins' ? IMPORT_COIN_CAP : IMPORT_ITEM_CAP;
      let excess = total - cap;
      if (excess <= 0) continue;
      excess -= p.bank.remove(item, excess);
      for (const list of [p.overflow, p.shrineHeld]) {
        for (const s of list) {
          if (excess <= 0 || s.item !== item) continue;
          const k = Math.min(excess, s.qty);
          s.qty -= k;
          excess -= k;
        }
      }
      p.overflow = p.overflow.filter((s) => s.qty > 0);
      p.shrineHeld = p.shrineHeld.filter((s) => s.qty > 0);
      if (excess > 0) excess -= p.inventory.remove(item, excess);
      if (excess > 0 && p.equipment.slots.ammo === item) {
        const k = Math.min(excess, p.equipment.ammoQty);
        p.equipment.ammoQty -= k;
        if (p.equipment.ammoQty <= 0) p.equipment.clearAmmo();
      }
      report.push(`${itemDef(item).name} was capped at ${cap.toLocaleString('en')} (from ${total.toLocaleString('en')}).`);
    }
  }
  const record = world.characterRecord();
  return { ok: true, world, record, hash, report };
}
