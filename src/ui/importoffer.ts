import { SKILL_IDS, defaultSkillXp, levelForXp } from '../data/skills';
import type { SaveData } from '../sim/world';

export type ImportChoice = 'import' | 'later' | 'never';

/** A short description of a local save: name, total level and coins carried and banked. */
export function describeSave(save: SaveData): { name: string; totalLevel: number; coins: number } {
  const base = defaultSkillXp();
  const totalLevel = SKILL_IDS.reduce((a, id) => a + levelForXp(save.xp?.[id] ?? base[id]), 0);
  const coins = [...(save.inventory ?? []), ...(save.bank ?? [])].reduce((a, s) => a + (s && s.item === 'coins' ? s.qty : 0), 0);
  return { name: save.name, totalLevel, coins };
}

/**
 * Offers to bring the device's offline character onto the signed-in account (docs/MULTIPLAYER.md
 * section 7). It can only happen once, and it replaces the account's current character.
 */
export function runImportOffer(parent: HTMLElement, save: SaveData, accountName: string): Promise<ImportChoice> {
  const d = describeSave(save);
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'creator signin import-offer';
    root.innerHTML = `
      <div class="cr-title"><span class="logo">Brightwater</span><small>Bring your character</small></div>
      <div class="si-spacer"></div>
      <div class="cr-panel si-panel">
        <div class="io-card"><b></b><span></span></div>
        <p class="io-text">This device has an offline character. You can bring it to your account <b class="io-acct"></b> once. It replaces the account's current character and takes the account's name. Your offline save stays on this device.</p>
        <div class="cr-btns"><button class="io-later">Not now</button><button class="cr-go io-go">Bring it over ▸</button></div>
        <button class="io-never">Don't ask again on this device</button>
      </div>`;
    root.querySelector('.io-card b')!.textContent = d.name;
    root.querySelector('.io-card span')!.textContent = `Total level ${d.totalLevel} · ${d.coins.toLocaleString('en')} coins`;
    root.querySelector('.io-acct')!.textContent = accountName;
    parent.appendChild(root);
    const done = (c: ImportChoice) => {
      root.remove();
      resolve(c);
    };
    root.querySelector('.io-go')!.addEventListener('click', () => done('import'));
    root.querySelector('.io-later')!.addEventListener('click', () => done('later'));
    root.querySelector('.io-never')!.addEventListener('click', () => done('never'));
  });
}
