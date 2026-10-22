import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { startServer, type RunningServer } from '../server/server';
import { runAdmin } from '../server/admin';
import { NetClient, type ChatLine } from '../src/net/client';
import { parseAdmin } from '../src/ui/social';
import type { AdminCommand } from '../src/net/protocol';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const running: RunningServer[] = [];
const clients: NetClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const s of running.splice(0)) await s.close().catch(() => {});
});

const freshDb = () => joinPath(mkdtempSync(joinPath(tmpdir(), 'bw-')), 'mod.sqlite');
async function serve(dbPath: string) {
  const s = await startServer({ port: 0, dbPath, log: () => {}, allowGuests: true, graceMs: 150 });
  running.push(s);
  return { s, url: `ws://127.0.0.1:${s.port}` };
}
async function join(url: string, name: string, auth?: object) {
  const c = new NetClient({ url, auth: (auth ?? { kind: 'register', username: name, password: 'brightwater1' }) as never });
  clients.push(c);
  await c.connect();
  return { c, chat: [] as ChatLine[], said: [] as string[] };
}
type Who = Awaited<ReturnType<typeof join>>;
async function pump(who: Who[], ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await sleep(15);
    for (const w of who) {
      w.c.update(0.015);
      w.chat.push(...w.c.drainChat());
      for (const e of w.c.drainEvents()) if (e.type === 'message') w.said.push(e.text);
    }
  }
}
/** Sends a moderation command and waits for its answer. */
async function admin(w: Who, cmd: AdminCommand) {
  const before = w.c.adminReplies.length;
  w.c.admin(cmd);
  const end = Date.now() + 2000;
  while (w.c.adminReplies.length === before && Date.now() < end) await pump([w], 15);
  return w.c.adminReplies[before];
}
const silent = () => {};

describe('3B.2 moderation: commands typed in the chat box', () => {
  it('reads commands, and explains the ones it doesn’t know', () => {
    expect(parseAdmin('/kick Ash spamming the plaza')).toEqual({ op: 'kick', name: 'Ash', reason: 'spamming the plaza' });
    expect(parseAdmin('/mute Ash 30 shouting')).toEqual({ op: 'mute', name: 'Ash', minutes: 30, reason: 'shouting' });
    expect(parseAdmin('/ban Ash forever scamming')).toEqual({ op: 'ban', name: 'Ash', minutes: null, reason: 'scamming' });
    expect(parseAdmin('/reports all')).toEqual({ op: 'reports', status: 'all' });
    expect(parseAdmin('/filter add blorp')).toEqual({ op: 'filter', action: 'add', word: 'blorp' });
    expect(parseAdmin('/mute Ash soon')).toEqual({ error: 'Usage: /mute name minutes reason' });
    expect('error' in parseAdmin('/dance')).toBe(true);
  });
});

describe('3B.2 moderation on the server', () => {
  it('roles come only from the local admin tool; players are refused and the attempt is logged', async () => {
    const dbPath = freshDb();
    const { s: server, url } = await serve(dbPath);
    const ash = await join(url, 'Ash');
    const r = await admin(ash, { op: 'who' });
    expect(r.ok).toBe(false);
    expect(r.lines[0]).toBe('Unknown command.');
    expect(server.repos.adminLog().map((e) => e.action)).toContain('denied:who');
    // Granted on the machine the server runs on, effective at the next command.
    const out: string[] = [];
    expect(runAdmin(['grant', 'Ash', 'moderator'], dbPath, (l) => out.push(l))).toBe(0);
    expect(out[0]).toMatch(/Ash is now a moderator/);
    expect((await admin(ash, { op: 'who' })).ok).toBe(true);
    // A moderator can't ban, change the filter or read the admin log.
    expect((await admin(ash, { op: 'ban', name: 'Ash', minutes: 5, reason: '' })).lines[0]).toMatch(/permission/);
    expect((await admin(ash, { op: 'filter', action: 'list' })).ok).toBe(false);
    runAdmin(['revoke', 'Ash'], dbPath, silent);
    expect((await admin(ash, { op: 'who' })).ok).toBe(false);
    expect(runAdmin(['grant', 'Nobody', 'admin'], dbPath, silent)).toBe(1);
  }, 15_000);

  it('kick removes a player at once (saved), ban keeps them out until lifted, mute stops chat', async () => {
    const dbPath = freshDb();
    const { s: server, url } = await serve(dbPath);
    const mod = await join(url, 'Warden');
    const ash = await join(url, 'Ash');
    runAdmin(['grant', 'Warden', 'admin'], dbPath, silent);
    const ashSession = [...server.sessions.values()].find((x) => x.name === 'Ash')!;
    ashSession.player.inventory.add('logs', 7);
    const token = ash.c.session!;

    let r = await admin(mod, { op: 'kick', name: 'ash', reason: 'cool off' });
    expect(r.ok).toBe(true);
    await pump([ash], 200);
    expect(ash.c.status).toBe('closed');
    expect(ash.c.closeReason).toMatch(/removed from the world by a moderator: cool off/);
    expect(ash.c.errorCode).toBe('kicked');
    expect(server.sessions.has(ashSession.key)).toBe(false);
    expect(JSON.stringify(server.repos.characterFor(ashSession.accountId!)!.record.inventory)).toContain('logs');

    // Kicked players may come back; banned ones may not.
    const back = await join(url, 'Ash', { kind: 'token', token });
    r = await admin(mod, { op: 'ban', name: 'Ash', minutes: 60, reason: 'griefing' });
    expect(r.ok).toBe(true);
    await pump([back], 200);
    expect(back.c.errorCode).toBe('banned');
    await expect(join(url, 'Ash', { kind: 'login', username: 'Ash', password: 'brightwater1' })).rejects.toThrow();
    expect((await admin(mod, { op: 'unban', name: 'Ash' })).ok).toBe(true);
    const again = await join(url, 'Ash', { kind: 'login', username: 'Ash', password: 'brightwater1' });

    // Mute and unmute.
    expect((await admin(mod, { op: 'mute', name: 'Ash', minutes: 10, reason: 'caps lock' })).ok).toBe(true);
    again.c.say('hello?');
    await pump([again, mod], 200);
    expect(again.said.some((t) => /muted until/.test(t))).toBe(true);
    expect(mod.chat.some((l) => l.text === 'hello?')).toBe(false);
    await admin(mod, { op: 'unmute', name: 'Ash' });
    again.c.say('thank you');
    await pump([again, mod], 200);
    expect(mod.chat.some((l) => l.text === 'thank you')).toBe(true);
    const log = (await admin(mod, { op: 'audit', limit: 20 })).data as { action: string; target: string }[];
    expect(log.map((e) => e.action)).toEqual(expect.arrayContaining(['kick', 'ban', 'unban', 'mute', 'unmute']));
  }, 20_000);

  it('reports can be reviewed and resolved; the word filter can be changed and is kept', async () => {
    const dbPath = freshDb();
    let { s: server, url } = await serve(dbPath);
    const mod = await join(url, 'Warden');
    const ash = await join(url, 'Ash');
    runAdmin(['grant', 'Warden', 'admin'], dbPath, silent);
    ash.c.say('buy gold at my stall, blorp');
    await pump([ash, mod], 200);
    mod.c.report('Ash', 'Spam or advertising');
    await pump([mod], 200);
    let r = await admin(mod, { op: 'reports', status: 'open' });
    const [rep] = r.data as { id: number; target: string; context: string[] }[];
    expect(rep.target).toBe('Ash');
    expect(rep.context).toEqual(['buy gold at my stall, blorp']);
    expect(r.lines[0]).toMatch(/Warden reported Ash/);
    expect((await admin(mod, { op: 'resolve', id: rep.id, resolution: 'warned' })).ok).toBe(true);
    expect((await admin(mod, { op: 'reports', status: 'open' })).lines).toEqual(['No reports.']);
    const cli: string[] = [];
    runAdmin(['reports', 'all'], dbPath, (l) => cli.push(l));
    expect(cli.join('\n')).toMatch(/resolved by Warden#\d+: warned/);

    r = await admin(mod, { op: 'filter', action: 'add', word: 'Blorrp' });
    expect(r.data).toEqual(['blorp']);
    ash.c.say('blorp blorrrp');
    await pump([ash, mod], 200);
    expect(mod.chat.at(-1)!.text).toBe('***** *******');
    // Kept across a restart.
    await server.close();
    running.splice(running.indexOf(server), 1);
    ({ s: server, url } = await serve(dbPath));
    const a2 = await join(url, 'Ash', { kind: 'login', username: 'Ash', password: 'brightwater1' });
    const m2 = await join(url, 'Warden', { kind: 'login', username: 'Warden', password: 'brightwater1' });
    a2.c.say('blorp');
    await pump([a2, m2], 200);
    expect(m2.chat.at(-1)!.text).toBe('*****');
    await admin(m2, { op: 'filter', action: 'remove', word: 'blorp' });
    a2.c.say('blorp again');
    await pump([a2, m2], 200);
    expect(m2.chat.at(-1)!.text).toBe('blorp again');
  }, 20_000);

  it('the local tool bans and unbans, and shows the admin log', async () => {
    const dbPath = freshDb();
    const { url } = await serve(dbPath);
    await join(url, 'Ash');
    const out: string[] = [];
    expect(runAdmin(['ban', 'Ash', 'forever', 'botting'], dbPath, (l) => out.push(l))).toBe(0);
    expect(out[0]).toMatch(/banned permanently/);
    await expect(join(url, 'Ash', { kind: 'login', username: 'Ash', password: 'brightwater1' })).rejects.toThrow();
    runAdmin(['unban', 'Ash'], dbPath, silent);
    await join(url, 'Ash', { kind: 'login', username: 'Ash', password: 'brightwater1' });
    out.length = 0;
    runAdmin(['audit'], dbPath, (l) => out.push(l));
    expect(out.join('\n')).toMatch(/ unban Ash/);
    expect(out.join('\n')).toMatch(/ ban Ash botting/);
  }, 15_000);
});
