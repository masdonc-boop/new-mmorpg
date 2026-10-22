import type { Player } from '../sim/world';
import type { AdminCommand } from '../net/protocol';

/** Chat, blocking and reporting, as the server offers them (network play only; docs/MULTIPLAYER.md 3A.6). */
export interface SocialCallbacks {
  say(text: string, to?: string): void;
  /** Moderation commands typed as /who, /kick, … (refused by the server without a role). */
  admin(cmd: AdminCommand): void;
  block(name: string, on: boolean): void;
  report(name: string, reason: string): void;
  blocked(): string[];
  trade(playerId: number): void;
}

export interface ChatEntry {
  channel: 'local' | 'private' | 'system';
  ok?: boolean;
  from: string;
  to?: string;
  text: string;
}

const ADMIN_HELP = 'Commands: /who · /kick name reason · /mute name minutes reason · /unmute name · /ban name minutes|forever reason · /unban name · /reports [open|resolved|all] · /resolve id note · /filter add|remove|list word · /audit [n]';

/** Reads a typed moderation command ("/kick Ash spamming"). */
export function parseAdmin(line: string): AdminCommand | { error: string } {
  const [head, ...args] = line.trim().slice(1).split(/\s+/);
  const rest = (from: number) => args.slice(from).join(' ');
  const n = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : NaN);
  switch (head?.toLowerCase()) {
    case 'who':
      return { op: 'who' };
    case 'kick':
      return args[0] ? { op: 'kick', name: args[0], reason: rest(1) } : { error: 'Usage: /kick name reason' };
    case 'mute':
      return args[0] && n(args[1]) > 0 ? { op: 'mute', name: args[0], minutes: n(args[1]), reason: rest(2) } : { error: 'Usage: /mute name minutes reason' };
    case 'unmute':
      return args[0] ? { op: 'unmute', name: args[0] } : { error: 'Usage: /unmute name' };
    case 'ban':
      return args[0] && (args[1] === 'forever' || n(args[1]) > 0) ? { op: 'ban', name: args[0], minutes: args[1] === 'forever' ? null : n(args[1]), reason: rest(2) } : { error: 'Usage: /ban name minutes|forever reason' };
    case 'unban':
      return args[0] ? { op: 'unban', name: args[0] } : { error: 'Usage: /unban name' };
    case 'reports':
      return { op: 'reports', status: args[0] === 'resolved' || args[0] === 'all' ? args[0] : 'open' };
    case 'resolve':
      return n(args[0]) > 0 && args[1] ? { op: 'resolve', id: n(args[0]), resolution: rest(1) } : { error: 'Usage: /resolve id note' };
    case 'filter':
      if (args[0] === 'list' || !args[0]) return { op: 'filter', action: 'list' };
      return (args[0] === 'add' || args[0] === 'remove') && args[1] ? { op: 'filter', action: args[0], word: args[1] } : { error: 'Usage: /filter add|remove|list word' };
    case 'audit':
      return { op: 'audit', limit: Math.min(200, n(args[0]) || 20) };
    default:
      return { error: ADMIN_HELP };
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

/** How a chat line reads: "Ash: hi", "Ash whispers: hi", "To Brindle: hi". */
export function chatText(e: ChatEntry): string {
  if (e.channel === 'system') return e.text;
  if (e.channel === 'local') return `${e.from}: ${e.text}`;
  return e.to ? `To ${e.to}: ${e.text}` : `${e.from} whispers: ${e.text}`;
}

/**
 * The chat box: a button by the message log opens the recent conversation and a text field.
 * "@Name message" (or tapping a whisper) sends privately; anything else goes to players nearby.
 */
export class ChatBox {
  readonly button = el('button', 'chat-btn', '💬');
  private box = el('div', 'chat-box hidden');
  private lines = el('div', 'chat-lines');
  private input = el('input', 'chat-input');
  private history: ChatEntry[] = [];
  private unread = 0;

  constructor(parent: HTMLElement, private cb: SocialCallbacks) {
    this.button.setAttribute('aria-label', 'Chat');
    this.button.addEventListener('click', () => this.toggle());
    this.input.type = 'text';
    this.input.maxLength = 140;
    this.input.placeholder = 'Say something · @name to whisper';
    this.input.enterKeyHint = 'send';
    const send = el('button', 'chat-send', 'Send');
    const close = el('button', 'chat-close', '✕');
    const row = el('form', 'chat-row');
    row.append(this.input, send, close);
    row.addEventListener('submit', (ev) => {
      ev.preventDefault();
      this.send();
    });
    close.addEventListener('click', (ev) => {
      ev.preventDefault();
      this.toggle(false);
    });
    // Keys typed here are for the chat, not for walking about.
    this.input.addEventListener('keydown', (ev) => ev.stopPropagation());
    this.box.append(this.lines, row);
    parent.append(this.button, this.box);
  }

  get open() {
    return !this.box.classList.contains('hidden');
  }

  toggle(on = !this.open) {
    this.box.classList.toggle('hidden', !on);
    if (on) {
      this.unread = 0;
      this.badge();
      this.render();
      this.input.focus();
    } else this.input.blur();
  }

  /** Opens the box ready to whisper to someone. */
  whisper(name: string) {
    this.toggle(true);
    this.input.value = `@${name} `;
    this.input.focus();
  }

  private send() {
    const raw = this.input.value.trim();
    if (!raw) return;
    if (raw.startsWith('/')) {
      const cmd = parseAdmin(raw);
      if ('error' in cmd) this.add({ channel: 'system', from: '', text: cmd.error, ok: false });
      else this.cb.admin(cmd);
      this.input.value = '';
      return;
    }
    const m = /^@(\S+)\s+([\s\S]+)$/.exec(raw);
    if (m) this.cb.say(m[2], m[1]);
    else if (raw.startsWith('@')) return;
    else this.cb.say(raw);
    // Keep the whisper target for the next line.
    this.input.value = m ? `@${m[1]} ` : '';
  }

  add(e: ChatEntry) {
    this.history.push(e);
    if (this.history.length > 50) this.history.shift();
    if (this.open) this.render();
    else {
      this.unread++;
      this.badge();
    }
  }

  private badge() {
    this.button.dataset.unread = this.unread ? String(Math.min(this.unread, 9)) : '';
  }

  private render() {
    this.lines.replaceChildren();
    for (const e of this.history.slice(-30)) {
      const line = el('div', `chat-line ${e.channel}${e.ok === false ? ' bad' : ''}`);
      line.textContent = chatText(e);
      const other = e.channel === 'private' ? e.to ?? e.from : null;
      if (other) line.addEventListener('click', () => this.whisper(other));
      this.lines.appendChild(line);
    }
    this.lines.scrollTop = this.lines.scrollHeight;
  }
}

const REASONS = ['Spam or advertising', 'Abuse or harassment', 'Scamming', 'Something else'];

/** The card shown when tapping another player: trade, whisper, block, report. */
export class PlayerMenu {
  private card = el('div', 'player-menu hidden');

  constructor(parent: HTMLElement, private cb: SocialCallbacks, private whisper: (name: string) => void) {
    parent.appendChild(this.card);
  }

  close() {
    this.card.classList.add('hidden');
  }

  open(p: Player) {
    const blocked = this.cb.blocked().includes(p.name.toLowerCase());
    this.card.replaceChildren();
    this.card.appendChild(el('div', 'pm-name', `${p.name.replace(/[&<>"']/g, '')}${p.remote ? ` <span class="lvl">Combat ${p.remote.combat}</span>` : ''}`));
    const btns = el('div', 'pm-btns');
    const add = (label: string, fn: () => void, cls = '') => {
      const b = el('button', `bank-btn ${cls}`, label);
      b.addEventListener('click', fn);
      btns.appendChild(b);
    };
    add('Trade', () => {
      this.cb.trade(p.id);
      this.close();
    }, 'primary');
    add('Whisper', () => {
      this.whisper(p.name);
      this.close();
    });
    add(blocked ? 'Unblock' : 'Block', () => {
      this.cb.block(p.name, !blocked);
      this.close();
    });
    add('Report', () => this.reportStep(p));
    add('Close', () => this.close());
    this.card.appendChild(btns);
    this.card.classList.remove('hidden');
  }

  private reportStep(p: Player) {
    this.card.replaceChildren(el('div', 'pm-name', `Report ${p.name.replace(/[&<>"']/g, '')}`), el('div', 'pm-hint', 'What they said to you recently goes with the report.'));
    const btns = el('div', 'pm-btns');
    for (const r of REASONS) {
      const b = el('button', 'bank-btn', r);
      b.addEventListener('click', () => {
        this.cb.report(p.name, r);
        this.close();
      });
      btns.appendChild(b);
    }
    const cancel = el('button', 'bank-btn', 'Cancel');
    cancel.addEventListener('click', () => this.close());
    btns.appendChild(cancel);
    this.card.appendChild(btns);
  }
}

/** "Brindle wants to trade with you": tap to open the trade, or let it lapse. */
export class TradeRequestCard {
  private card = el('div', 'trade-request hidden');
  private timer = 0;

  constructor(parent: HTMLElement, private accept: (playerId: number) => void) {
    parent.appendChild(this.card);
  }

  show(from: number, name: string) {
    this.card.replaceChildren(el('div', 'tr-text', `<b>${name.replace(/[&<>"']/g, '')}</b> wants to trade with you.`));
    const yes = el('button', 'bank-btn primary', 'Trade');
    yes.addEventListener('click', () => {
      this.accept(from);
      this.hide();
    });
    const no = el('button', 'bank-btn', 'Ignore');
    no.addEventListener('click', () => this.hide());
    const btns = el('div', 'pm-btns');
    btns.append(yes, no);
    this.card.appendChild(btns);
    this.card.classList.remove('hidden');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), 30_000);
  }

  hide() {
    this.card.classList.add('hidden');
  }
}
