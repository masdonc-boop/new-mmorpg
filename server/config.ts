import type { ServerOptions } from './server';

/**
 * Server settings from environment variables (docs/ANDROID_TEST.md, docs/MULTIPLAYER.md 3B.7).
 *
 *   PORT=8787               the WebSocket port
 *   HOST=127.0.0.1          where to listen: this computer only (the default and the safest)
 *   DB=server/data/dev.sqlite
 *   GUESTS=1                allow unsaved guest play by name (development only)
 *   LIVE_EXCHANGE=1         open the live Exchange (an owner decision; off by default)
 *   INVITE_CODE=...         new accounts must give this code
 *   ALLOWED_ORIGINS=http://192.168.1.20:4173,http://localhost:4173
 *                           the game pages that may connect
 *
 * Listening beyond this computer (any HOST other than 127.0.0.1, ::1 or localhost) is refused
 * unless an invite code (at least 8 characters) and the allowed pages are set, and guests are
 * never allowed there: a test server on a home network must not be open to whoever finds it.
 */
export const LOOPBACK = ['127.0.0.1', '::1', 'localhost'];

export function configFromEnv(env: Record<string, string | undefined>): { ok: true; options: ServerOptions; notes: string[] } | { ok: false; error: string } {
  const host = env.HOST ?? '127.0.0.1';
  const port = Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: `PORT must be a port number (got ${env.PORT}).` };
  const origins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  for (const o of origins) if (!/^https?:\/\/[^/\s]+$/.test(o)) return { ok: false, error: `ALLOWED_ORIGINS entries look like http://192.168.1.20:4173 (got ${o}).` };
  const invite = env.INVITE_CODE?.trim() || undefined;
  const remote = !LOOPBACK.includes(host);
  const notes: string[] = [];
  if (remote) {
    if (!invite || invite.length < 8) return { ok: false, error: `Listening on ${host} (beyond this computer) needs INVITE_CODE, at least 8 characters, so only your testers can make accounts.` };
    if (!origins.length) return { ok: false, error: `Listening on ${host} needs ALLOWED_ORIGINS: the address of the game page your testers open, e.g. http://${host === '0.0.0.0' ? '192.168.1.20' : host}:4173.` };
    if (env.GUESTS === '1') return { ok: false, error: 'Guests (GUESTS=1) are for this computer only: they have no password, so anyone could play as them.' };
    notes.push(`Open beyond this computer on ${host}:${port}. New accounts need the invite code; pages allowed: ${origins.join(', ')}.`);
    notes.push('Stop the server (Ctrl+C) when the test is over.');
  }
  if (env.LIVE_EXCHANGE === '1') notes.push('The live Exchange is ON: real items and coins change hands between accounts.');
  return {
    ok: true,
    notes,
    options: {
      port,
      host,
      dbPath: env.DB || undefined,
      allowGuests: env.GUESTS === '1',
      liveExchange: env.LIVE_EXCHANGE === '1',
      inviteCode: invite,
      allowedOrigins: origins.length ? origins : undefined,
    },
  };
}
