/**
 * Chat rules for the development server (docs/MULTIPLAYER.md 3A.6 and 5.4): what a message may
 * contain and how often a player may speak. Delivery (local or private, block lists, mutes) is in
 * server.ts.
 */

/** Longest message, in characters (after cleaning). */
export const CHAT_MAX = 120;
/** Local chat reaches players this many tiles away. */
export const CHAT_RADIUS = 16;
/** Messages kept per player for reports (only what they actually received). */
export const CHAT_HEARD = 40;

/**
 * A basic word filter: listed words are starred out wherever they appear, also when spelled with
 * digits or symbols for letters. It is deliberately short; reports and mutes cover the rest.
 */
/** Collapses repeated letters, as the filter compares words. */
export const filterForm = (w: string) => w.toLowerCase().replace(/(.)\1+/g, '$1');

const FILTERED = ['fuck', 'shit', 'cunt', 'bitch', 'bastard', 'asshole', 'wanker', 'twat', 'slut', 'whore', 'retard', 'nigger', 'nigga'].map(filterForm);
const LOOKALIKE: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', $: 's', '7': 't', '+': 't' };

/** Links are a common scam ("free coins at …"); they are never passed on. */
const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|gg|xyz|ru|ly|me|co|info|biz|app|site|link)\b\S*/gi;

/** Stars out filtered words. Letters are compared after mapping look-alikes and dropping repeats. */
function filterWords(text: string, extra: readonly string[]): string {
  const chars = [...text];
  // A comparable form of the text, and which original character each position came from.
  const norm: string[] = [];
  const from: number[] = [];
  let prev = -2;
  chars.forEach((c, i) => {
    const l = LOOKALIKE[c] ?? c.toLowerCase();
    if (!/[a-z]/.test(l)) return;
    const repeat = norm.length > 0 && norm[norm.length - 1] === l && prev === i - 1;
    prev = i;
    if (repeat) return;
    norm.push(l);
    from.push(i);
  });
  const flat = norm.join('');
  for (const w of [...FILTERED, ...extra]) {
    if (!w) continue;
    let at = flat.indexOf(w);
    while (at >= 0) {
      for (let i = from[at]; i <= from[at + w.length - 1]; i++) if (/\S/.test(chars[i])) chars[i] = '*';
      at = flat.indexOf(w, at + 1);
    }
  }
  return chars.join('');
}

/**
 * Cleans a message for others to read, or says why it can't be sent. `extra`: words moderators added
 * to the filter (in `filterForm`).
 */
export function cleanChat(raw: string, extra: readonly string[] = []): { text: string } | { error: string } {
  const text = raw
    .normalize('NFKC')
    .replace(/[\p{C}\p{Zl}\p{Zp}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return { error: 'Say something first.' };
  if ([...text].length > CHAT_MAX) return { error: `Messages are up to ${CHAT_MAX} characters.` };
  return { text: filterWords(text.replace(LINK, '[link]'), extra) };
}

/**
 * Per-player chat pacing: a few messages at once, then one every two seconds, and no repeating the
 * same line over and over.
 */
export class ChatPace {
  private tokens = 5;
  private last = 0;
  private recent: { text: string; at: number }[] = [];
  constructor(private now: () => number) {}

  /** Null if the message may go out (and counts it), or why not. */
  take(text: string): string | null {
    const t = this.now();
    this.tokens = Math.min(5, this.tokens + (t - this.last) / 2000);
    this.last = t;
    this.recent = this.recent.filter((r) => t - r.at < 15_000);
    if (this.tokens < 1) return 'You are sending messages too quickly.';
    if (this.recent.filter((r) => r.text.toLowerCase() === text.toLowerCase()).length >= 2) return 'You just said that.';
    this.tokens -= 1;
    this.recent.push({ text, at: t });
    return null;
  }
}
