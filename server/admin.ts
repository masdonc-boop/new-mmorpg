import { openDatabase } from './db';
import { Repos, type Role } from './repo';

/**
 * The local admin tool (docs/MULTIPLAYER.md 3B.2): `npm run admin -- <command>`. It works directly on
 * the server's database file, so only someone with access to the machine can use it. This is the
 * only way to give an account a moderator or admin role; nothing a game client sends can do that.
 *
 *   grant <name> <moderator|admin>    give a role
 *   revoke <name>                     back to an ordinary player
 *   roles                             who has a role
 *   reports [open|resolved|all]       list reports
 *   resolve <id> <text…>              close a report
 *   ban <name> <minutes|forever> <reason…>
 *   unban <name>
 *   audit [n]                         the latest admin actions
 *   flags [n]                         unusual live Exchange activity
 *
 * Bans, unbans and roles take effect at the player's next sign-in (and roles at the next command);
 * to remove someone who is online now, use /kick or /ban in the game as a moderator.
 */
export function runAdmin(args: string[], dbPath = process.env.DB ?? 'server/data/dev.sqlite', out: (line: string) => void = console.log): number {
  const db = openDatabase(dbPath);
  const repos = new Repos(db);
  const by = `local:${process.env.USER ?? 'admin'}`;
  const [cmd, ...rest] = args;
  const fail = (msg: string) => {
    out(msg);
    db.close();
    return 1;
  };
  try {
    switch (cmd) {
      case 'grant': {
        const [name, role] = rest;
        if (!name || (role !== 'moderator' && role !== 'admin')) return fail('Usage: grant <name> <moderator|admin>');
        if (!repos.setRole(name, role as Role, by)) return fail(`No account called ${name}.`);
        out(`${name} is now ${role === 'admin' ? 'an admin' : 'a moderator'}.`);
        break;
      }
      case 'revoke': {
        const [name] = rest;
        if (!name) return fail('Usage: revoke <name>');
        if (!repos.setRole(name, 'player', by)) return fail(`No account called ${name}.`);
        out(`${name} is an ordinary player again.`);
        break;
      }
      case 'roles': {
        const rows = db.prepare("SELECT username, role FROM accounts WHERE role != 'player' ORDER BY username").all() as { username: string; role: string }[];
        out(rows.length ? rows.map((r) => `${r.username}: ${r.role}`).join('\n') : 'Nobody has a role.');
        break;
      }
      case 'reports': {
        const status = (rest[0] ?? 'open') as 'open' | 'resolved' | 'all';
        if (!['open', 'resolved', 'all'].includes(status)) return fail('Usage: reports [open|resolved|all]');
        const list = repos.reportList(status, 200);
        out(list.length ? list.map((r) => `#${r.id} [${r.status}] ${new Date(r.at).toISOString()} ${r.reporter} → ${r.target}: ${r.reason}\n    ${r.context.map((c) => `“${c}”`).join(' ') || '(nothing said)'}${r.resolution ? `\n    resolved by ${r.resolvedBy}: ${r.resolution}` : ''}`).join('\n') : 'No reports.');
        break;
      }
      case 'resolve': {
        const id = Number(rest[0]);
        const text = rest.slice(1).join(' ');
        if (!Number.isInteger(id) || !text) return fail('Usage: resolve <id> <text…>');
        if (!repos.resolveReport(id, text, by)) return fail(`No open report #${id}.`);
        repos.adminAudit(by, 'resolve', String(id), text);
        out(`Report #${id} resolved.`);
        break;
      }
      case 'ban': {
        const [name, len, ...why] = rest;
        const a = name ? repos.findAccount(name) : null;
        const minutes = len === 'forever' ? null : Number(len);
        if (!a || (minutes !== null && !(Number.isInteger(minutes) && minutes > 0))) return fail('Usage: ban <name> <minutes|forever> <reason…>');
        const until = minutes === null ? null : Date.now() + minutes * 60_000;
        repos.ban(a.id, until, why.join(' '), by);
        repos.adminAudit(by, 'ban', a.username, why.join(' '));
        out(`${a.username} is banned ${until ? `until ${new Date(until).toUTCString()}` : 'permanently'} (from their next sign-in).`);
        break;
      }
      case 'unban': {
        const a = rest[0] ? repos.findAccount(rest[0]) : null;
        if (!a) return fail('Usage: unban <name>');
        const n = repos.unban(a.id, by);
        repos.adminAudit(by, 'unban', a.username);
        out(n ? `${a.username} is no longer banned.` : `${a.username} wasn’t banned.`);
        break;
      }
      case 'flags': {
        for (const f of repos.exchangeFlags(Number(rest[0]) || 30)) out(`${new Date(f.at).toISOString()} ${f.kind} ${f.account}: ${f.detail}`);
        break;
      }
      case 'audit': {
        for (const e of repos.adminLog(Number(rest[0]) || 30)) out(`${new Date(e.at).toISOString()} ${e.actor} ${e.action} ${e.target} ${e.detail}`);
        break;
      }
      default:
        return fail('Commands: grant, revoke, roles, reports, resolve, ban, unban, audit, flags (see server/admin.ts).');
    }
  } finally {
    if (db.open) db.close();
  }
  return 0;
}

if (process.argv[1]?.endsWith('admin.ts')) process.exitCode = runAdmin(process.argv.slice(2));
