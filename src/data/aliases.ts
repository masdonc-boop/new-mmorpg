/**
 * Renamed item ids (old id → new id), applied to saves on load so older characters keep every
 * item when content is replaced (docs/ORIGINALITY.md section 4). Add entries; never remove them.
 * Display-name-only renames (most of them) keep their ids and need no entry here.
 */
export const ITEM_ALIASES: Record<string, string> = {};

/** Save fields that hold free text, never item ids (left untouched by the remap). */
const TEXT_FIELDS = new Set(['name', 'detail', 'source', 'dest', 'hash', 'checkpoint']);

/**
 * Returns a copy of saved data with every renamed item id replaced, wherever it appears as a value
 * or an object key (inventory, bank, equipment, toolbelt, held items, ground piles, graves and the
 * practice Exchange's balances and orders). Free-text fields are left alone. Quantities are kept,
 * and if a rename merges two keys their amounts are added together.
 */
export function remapItemIds<T>(data: T, aliases: Record<string, string> = ITEM_ALIASES): T {
  if (!Object.keys(aliases).length) return data;
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === 'string') return key !== undefined && TEXT_FIELDS.has(key) ? v : (aliases[v] ?? v);
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (!v || typeof v !== 'object') return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const nk = aliases[k] ?? k;
      const nv = walk(x, k);
      if (nk in out && typeof out[nk] === 'number' && typeof nv === 'number') out[nk] = (out[nk] as number) + nv;
      else out[nk] = nv;
    }
    return out;
  };
  return walk(data) as T;
}
