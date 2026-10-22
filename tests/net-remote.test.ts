import { afterEach, describe, expect, it } from 'vitest';
import { configFromEnv } from '../server/config';
import { startServer, type RunningServer } from '../server/server';
import { NetClient } from '../src/net/client';

const running: RunningServer[] = [];
const clients: NetClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const s of running.splice(0)) await s.close().catch(() => {});
});

describe('3B.7 a server for a private phone test', () => {
  it('listens on this computer only unless an invite code and the allowed pages are set; never with guests', () => {
    const local = configFromEnv({});
    expect(local.ok && local.options.host).toBe('127.0.0.1');
    expect(local.ok && local.options.inviteCode).toBeUndefined();
    const lan = { HOST: '0.0.0.0', INVITE_CODE: 'river-otter-42', ALLOWED_ORIGINS: 'http://192.168.1.20:4173' };
    const open = configFromEnv(lan);
    expect(open.ok).toBe(true);
    expect(open.ok && open.options.allowedOrigins).toEqual(['http://192.168.1.20:4173']);
    expect(open.ok && open.notes.join(' ')).toMatch(/Stop the server/);
    const refuse = (env: Record<string, string>, why: RegExp) => {
      const r = configFromEnv(env);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(why);
    };
    refuse({ HOST: '0.0.0.0' }, /INVITE_CODE/);
    refuse({ HOST: '0.0.0.0', INVITE_CODE: 'short' }, /at least 8/);
    refuse({ HOST: '192.168.1.20', INVITE_CODE: 'river-otter-42' }, /ALLOWED_ORIGINS/);
    refuse({ ...lan, GUESTS: '1' }, /Guests/);
    refuse({ ...lan, ALLOWED_ORIGINS: 'evil' }, /look like/);
    refuse({ PORT: 'eighty' }, /PORT/);
    // The live Exchange is only ever on when asked for, and says so.
    expect(configFromEnv({}).ok && (configFromEnv({}) as { options: { liveExchange: boolean } }).options.liveExchange).toBe(false);
    const gx = configFromEnv({ LIVE_EXCHANGE: '1' });
    expect(gx.ok && gx.notes.join(' ')).toMatch(/live Exchange is ON/);
  });

  it('new accounts need the invite code; signing in to an existing account doesn’t', async () => {
    const s = await startServer({ port: 0, dbPath: ':memory:', log: () => {}, inviteCode: 'river-otter-42' });
    running.push(s);
    const url = `ws://127.0.0.1:${s.port}`;
    const make = async (auth: object) => {
      const c = new NetClient({ url, auth: auth as never });
      clients.push(c);
      await c.connect();
      return c;
    };
    await expect(make({ kind: 'register', username: 'Ash', password: 'brightwater1' })).rejects.toThrow(/needs an invite code/);
    await expect(make({ kind: 'register', username: 'Ash', password: 'brightwater1', invite: 'river-otter-41' })).rejects.toThrow(/isn’t right/);
    const ok = await make({ kind: 'register', username: 'Ash', password: 'brightwater1', invite: 'river-otter-42' });
    expect(ok.status).toBe('ready');
    ok.close();
    expect((await make({ kind: 'login', username: 'Ash', password: 'brightwater1' })).status).toBe('ready');
  }, 10_000);
});
