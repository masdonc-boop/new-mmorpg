import type { Auth } from '../net/protocol';
import { runCharacterCreator } from './creator';

/**
 * The sign-in screen for network play (docs/MULTIPLAYER.md 3A.3). Resolves with how to sign in:
 * an existing account (name and password) or a new one (name, password and looks from the
 * character creator). Checks the server's rules up front so most mistakes never reach it.
 */
export function runSignIn(parent: HTMLElement, opts: { server: string; message?: string; name?: string }): Promise<Extract<Auth, { kind: 'login' | 'register' }>> {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'creator signin';
    root.innerHTML = `
      <div class="cr-title"><span class="logo">Brightwater</span><small>Chronicles of the Free Isles</small></div>
      <div class="si-spacer"></div>
      <form class="cr-panel si-panel" novalidate>
        <div class="si-server">Development server · ${escape(opts.server)}</div>
        <label class="cr-name">Name <input name="username" maxlength="12" autocomplete="username" spellcheck="false" autocapitalize="off"></label>
        <label class="cr-name">Password <input name="password" type="password" maxlength="128" autocomplete="current-password"></label>
        <div class="si-msg" role="alert"></div>
        <div class="cr-btns"><button type="button" class="si-new">Create account</button><button type="submit" class="cr-go">Sign in ▸</button></div>
        <div class="si-note">Names are 3 to 12 letters or numbers. Passwords need at least 8 characters. This is a test server on your own computer.</div>
      </form>`;
    parent.appendChild(root);
    const form = root.querySelector('form')!;
    const user = form.querySelector<HTMLInputElement>('input[name=username]')!;
    const pass = form.querySelector<HTMLInputElement>('input[name=password]')!;
    const msg = root.querySelector<HTMLElement>('.si-msg')!;
    user.value = opts.name ?? '';
    msg.textContent = opts.message ?? '';
    (user.value ? pass : user).focus();

    const check = (creating: boolean): string | null => {
      const u = user.value.trim();
      if (!/^[A-Za-z][A-Za-z0-9_-]{2,11}$/.test(u)) return 'Names are 3 to 12 letters, numbers, - or _, starting with a letter.';
      if (!pass.value) return 'Enter your password.';
      if (creating && pass.value.length < 8) return 'Passwords need at least 8 characters.';
      if (creating && pass.value.toLowerCase() === u.toLowerCase()) return "Your password can't be your name.";
      return null;
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const problem = check(false);
      if (problem) return void (msg.textContent = problem);
      root.remove();
      resolve({ kind: 'login', username: user.value.trim(), password: pass.value });
    });
    root.querySelector('.si-new')!.addEventListener('click', async () => {
      const problem = check(true);
      if (problem) return void (msg.textContent = problem);
      const username = user.value.trim();
      const password = pass.value;
      root.remove();
      const { appearance } = await runCharacterCreator(parent, username);
      resolve({ kind: 'register', username, password, appearance });
    });
  });
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
