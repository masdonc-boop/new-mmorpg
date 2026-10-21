import { itemDef, type ItemId } from '../data/items';
import { QUESTS } from '../data/quests';
import { SKILL_IDS, SKILL_INFO, xpForLevel, MAX_LEVEL, type SkillId } from '../data/skills';
import { STYLES, type CombatStyle } from '../sim/combat';
import { T, type WorldMap } from '../sim/worldmap';
import type { Dialogue, GameEvent, GameWorld } from '../sim/world';
import { TILE_COLORS } from '../render/terrain';
import { itemIcon } from './icons';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

type PanelId = 'inventory' | 'skills' | 'quests' | 'map' | 'settings';

const STYLE_ICON: Record<CombatStyle, string> = { melee: '⚔️', ranged: '🏹', magic: '✨' };

export interface HudCallbacks {
  command: GameWorld['issue'];
  setQuality(q: 'high' | 'balanced' | 'low'): void;
  getQuality(): string;
  setRotation(on: boolean): void;
  getRotation(): boolean;
  zoom(f: number): void;
  resetCamera(): void;
  newCharacter(): void;
  cameraYaw(): number;
}

export class Hud {
  readonly root: HTMLDivElement;
  private hpFill!: HTMLDivElement;
  private hpText!: HTMLDivElement;
  private nameEl!: HTMLDivElement;
  private targetFrame!: HTMLDivElement;
  private targetName!: HTMLDivElement;
  private targetFill!: HTMLDivElement;
  private styleBtn!: HTMLButtonElement;
  private log!: HTMLDivElement;
  private xpDrops!: HTMLDivElement;
  private banner!: HTMLDivElement;
  private panel!: HTMLDivElement;
  private panelBody!: HTMLDivElement;
  private panelTitle!: HTMLDivElement;
  private openPanel: PanelId | null = null;
  private dialogue!: HTMLDivElement;
  private dlgState: { d: Dialogue; page: number } | null = null;
  private death!: HTMLDivElement;
  private minimap!: HTMLCanvasElement;
  private minimapBase!: HTMLCanvasElement;
  private regionEl!: HTMLDivElement;
  private questTracker!: HTMLDivElement;
  private invDirty = true;
  private skillsDirty = true;
  private selectedSlot: number | null = null;
  private fpsEl!: HTMLDivElement;
  private fpsAcc = { frames: 0, t: 0 };

  constructor(parent: HTMLElement, private world: GameWorld, private cb: HudCallbacks) {
    this.root = el('div', 'hud');
    parent.appendChild(this.root);
    this.buildTop();
    this.buildBottom();
    this.buildPanels();
    this.buildDialogue();
    this.buildDeath();
    this.buildMinimapBase(world.map);
  }

  // ---------------------------------------------------------------- layout

  private buildTop() {
    const frame = el('div', 'player-frame');
    const portrait = el('div', 'portrait', '🛡️');
    const info = el('div', 'pf-info');
    this.nameEl = el('div', 'pf-name');
    const bar = el('div', 'bar hp');
    this.hpFill = el('div', 'bar-fill');
    this.hpText = el('div', 'bar-text');
    bar.append(this.hpFill, this.hpText);
    info.append(this.nameEl, bar);
    frame.append(portrait, info);
    this.root.appendChild(frame);

    this.targetFrame = el('div', 'target-frame hidden');
    this.targetName = el('div', 'tf-name');
    const tbar = el('div', 'bar enemy');
    this.targetFill = el('div', 'bar-fill');
    tbar.appendChild(this.targetFill);
    this.targetFrame.append(this.targetName, tbar);
    this.root.appendChild(this.targetFrame);

    this.questTracker = el('div', 'quest-tracker');
    this.questTracker.addEventListener('click', () => this.toggle('quests'));
    this.root.appendChild(this.questTracker);

    const mm = el('div', 'minimap-wrap');
    this.minimap = el('canvas', 'minimap');
    this.minimap.width = this.minimap.height = 220;
    this.minimap.addEventListener('click', () => this.toggle('map'));
    this.regionEl = el('div', 'region-label');
    const zoomIn = el('button', 'mm-btn zin', '+');
    const zoomOut = el('button', 'mm-btn zout', '−');
    const settings = el('button', 'mm-btn settings', '⚙');
    zoomIn.addEventListener('click', () => this.cb.zoom(0.85));
    zoomOut.addEventListener('click', () => this.cb.zoom(1.18));
    settings.addEventListener('click', () => this.toggle('settings'));
    mm.append(this.minimap, zoomIn, zoomOut, settings, this.regionEl);
    this.root.appendChild(mm);

    this.xpDrops = el('div', 'xp-drops');
    this.root.appendChild(this.xpDrops);
    this.banner = el('div', 'region-banner');
    this.root.appendChild(this.banner);
    this.fpsEl = el('div', 'fps hidden');
    this.root.appendChild(this.fpsEl);
  }

  private buildBottom() {
    this.log = el('div', 'msg-log');
    this.root.appendChild(this.log);

    const actions = el('div', 'actions');
    this.styleBtn = el('button', 'style-btn');
    this.styleBtn.addEventListener('click', () => {
      const order: CombatStyle[] = ['melee', 'ranged', 'magic'];
      const next = order[(order.indexOf(this.world.player.style) + 1) % 3];
      this.cb.command({ type: 'setStyle', style: next });
    });
    const menu = el('div', 'menu-btns');
    const mk = (icon: string, label: string, id: PanelId) => {
      const b = el('button', 'menu-btn', `<span class="mi">${icon}</span><span class="ml">${label}</span>`);
      b.dataset.panel = id;
      b.addEventListener('click', () => this.toggle(id));
      menu.appendChild(b);
    };
    mk('🎒', 'Bag', 'inventory');
    mk('📊', 'Skills', 'skills');
    mk('📜', 'Quests', 'quests');
    mk('🗺️', 'Map', 'map');
    actions.append(this.styleBtn, menu);
    this.root.appendChild(actions);
  }

  private buildPanels() {
    this.panel = el('div', 'panel hidden');
    const head = el('div', 'panel-head');
    this.panelTitle = el('div', 'panel-title');
    const close = el('button', 'panel-close', '✕');
    close.addEventListener('click', () => this.toggle(null));
    head.append(this.panelTitle, close);
    this.panelBody = el('div', 'panel-body');
    this.panel.append(head, this.panelBody);
    this.root.appendChild(this.panel);
  }

  private buildDialogue() {
    this.dialogue = el('div', 'dialogue hidden');
    this.dialogue.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      this.advanceDialogue();
    });
    this.root.appendChild(this.dialogue);
  }

  private buildDeath() {
    this.death = el('div', 'death hidden');
    this.root.appendChild(this.death);
  }

  private buildMinimapBase(map: WorldMap) {
    const c = el('canvas');
    c.width = map.width;
    c.height = map.height;
    const g = c.getContext('2d')!;
    const img = g.createImageData(map.width, map.height);
    const water = [70, 160, 210];
    for (let z = 0; z < map.height; z++) {
      for (let x = 0; x < map.width; x++) {
        const t = map.tiles[z * map.width + x];
        let rgb: number[];
        if (t === T.Water) rgb = water;
        else {
          const hex = TILE_COLORS[t] ?? '#7ccf55';
          rgb = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
          if (t === T.Bridge) rgb = [168, 115, 66];
        }
        const i = (z * map.width + x) * 4;
        const shade = map.blocked[z * map.width + x] && t !== T.Water ? 0.72 : 1;
        img.data[i] = rgb[0] * shade;
        img.data[i + 1] = rgb[1] * shade;
        img.data[i + 2] = rgb[2] * shade;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // Buildings
    g.fillStyle = '#8a5a3c';
    for (const b of map.buildings) {
      const rot = Math.abs(Math.sin(b.facing)) > 0.5;
      const w = rot ? b.d : b.w;
      const d = rot ? b.w : b.d;
      g.fillRect(b.x - w / 2, b.z - d / 2, w, d);
    }
    // Trees and rocks as dots
    for (const r of map.resources) {
      g.fillStyle = r.type === 'tree' ? '#2f7d2f' : r.type === 'oak' ? '#1f5f25' : '#6b6560';
      g.fillRect(r.x, r.z, 1, 1);
    }
    this.minimapBase = c;
  }

  // ---------------------------------------------------------------- per-frame

  update(dt: number) {
    const w = this.world;
    const p = w.player;
    this.nameEl.innerHTML = `${escapeHtml(p.name)} <span class="lvl">Combat ${p.skills.combatLevel()}</span>`;
    const hpPct = Math.max(0, p.hp / p.maxHp) * 100;
    this.hpFill.style.width = `${hpPct}%`;
    this.hpFill.classList.toggle('low', hpPct < 30);
    this.hpText.textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;

    const a = p.action;
    const target = a?.type === 'attack' ? w.enemyById(a.target) : null;
    if (target && target.alive) {
      this.targetFrame.classList.remove('hidden');
      this.targetName.innerHTML = `${target.def.name} <span class="lvl">Lv ${target.def.level}</span>`;
      this.targetFill.style.width = `${(target.hp / target.def.maxHp) * 100}%`;
    } else this.targetFrame.classList.add('hidden');

    const st = STYLES[p.style];
    const ammo = st.ammo ? p.inventory.count(st.ammo) : null;
    const label = `<span class="si">${STYLE_ICON[p.style]}</span><span class="sl">${st.name}</span>${ammo !== null ? `<span class="ammo">${ammo}</span>` : ''}`;
    if (this.styleBtn.innerHTML !== label) this.styleBtn.innerHTML = label;
    this.styleBtn.dataset.style = p.style;

    this.drawMinimap();
    this.updateQuestTracker();
    if (this.openPanel === 'inventory' && this.invDirty) this.renderInventory();
    if (this.openPanel === 'skills' && this.skillsDirty) this.renderSkills();
    this.updateDeath();

    this.fpsAcc.frames++;
    this.fpsAcc.t += dt;
    if (this.fpsAcc.t >= 0.5) {
      this.fpsEl.textContent = `${Math.round(this.fpsAcc.frames / this.fpsAcc.t)} fps`;
      this.fpsAcc.frames = 0;
      this.fpsAcc.t = 0;
    }
  }

  private drawMinimap() {
    const c = this.minimap;
    const g = c.getContext('2d')!;
    const p = this.world.player;
    const S = c.width;
    const scale = 4.2;
    g.save();
    g.clearRect(0, 0, S, S);
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#4aa0d2';
    g.fillRect(0, 0, S, S);
    g.translate(S / 2, S / 2);
    // Rotate so "up" on the minimap matches the camera's forward direction.
    g.rotate(this.cb.cameraYaw());
    g.scale(scale, scale);
    g.translate(-p.x, -p.z);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.minimapBase, 0, 0);
    const dot = (x: number, z: number, color: string, r = 0.9) => {
      g.fillStyle = color;
      g.beginPath();
      g.arc(x, z, r, 0, Math.PI * 2);
      g.fill();
    };
    for (const e of this.world.enemies) if (e.alive && Math.abs(e.x - p.x) < 30 && Math.abs(e.z - p.z) < 30) dot(e.x, e.z, e.def.id === 'goblin_warlord' ? '#ff2d2d' : '#ff7043', e.def.id === 'goblin_warlord' ? 1.4 : 0.8);
    for (const n of this.world.npcs) {
      const m = this.world.npcMarker(n.def.id);
      dot(n.x, n.z, m === 'available' || m === 'ready' ? '#ffd84d' : '#fff59d', m ? 1.3 : 0.9);
    }
    for (const c of this.world.map.checkpoints) dot(c.x, c.z, this.world.player.checkpoints.has(c.id) ? '#6fe0ff' : '#9fb4bf', 1);
    g.restore();
    // Player arrow (always pointing up = camera forward, rotated by facing).
    g.save();
    g.translate(S / 2, S / 2);
    g.rotate(-(p.facing - this.cb.cameraYaw()) + Math.PI);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#1a1a1a';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -9);
    g.lineTo(6, 7);
    g.lineTo(0, 3);
    g.lineTo(-6, 7);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  private updateQuestTracker() {
    const w = this.world;
    let html = '';
    for (const q of Object.values(QUESTS)) {
      const prog = w.questProgress(q.id);
      if (!prog) {
        html = `<div class="qt-title">❗ New quest available</div><div class="qt-step">Talk to Elder Maren in the plaza.</div>`;
        continue;
      }
      if (prog.done) continue;
      const stage = q.stages[prog.stage];
      const obj = stage.objective;
      let count = '';
      if (obj.type === 'collect') count = ` (${Math.min(obj.count, w.player.inventory.count(obj.item))}/${obj.count})`;
      if (obj.type === 'kill') count = ` (${prog.kills}/${obj.count})`;
      const ready = w.objectiveMet(q, prog);
      html = `<div class="qt-title">${q.name}</div><div class="qt-step ${ready ? 'ready' : ''}">${ready ? '✔ Return to Elder Maren' : stage.journal + count}</div>`;
    }
    if (this.questTracker.innerHTML !== html) this.questTracker.innerHTML = html;
    this.questTracker.style.display = html ? '' : 'none';
  }

  private updateDeath() {
    const p = this.world.player;
    if (!p.dead) {
      if (!this.death.classList.contains('hidden')) this.death.classList.add('hidden');
      return;
    }
    if (this.death.classList.contains('hidden')) {
      this.death.classList.remove('hidden');
      const nearest = this.world.nearestCheckpoint();
      this.death.innerHTML = `
        <div class="death-card">
          <div class="death-title">You have fallen</div>
          <div class="death-sub">Your belongings are safe. In future updates, equipped gear will lose durability on death.</div>
          <div class="death-btns">
            <button data-at="home">🏠 Respawn at Brightwater Shrine</button>
            ${nearest.id !== 'home' ? `<button data-at="checkpoint">🗿 Respawn at ${nearest.name}</button>` : ''}
          </div>
          <div class="death-timer"></div>
        </div>`;
      this.death.querySelectorAll('button').forEach((b) =>
        b.addEventListener('click', () => this.cb.command({ type: 'respawn', at: (b as HTMLButtonElement).dataset.at as 'home' | 'checkpoint' })),
      );
    }
    const t = this.death.querySelector('.death-timer');
    if (t) t.textContent = `Returning home automatically in ${Math.ceil(p.deathTimer)}s`;
  }

  // ---------------------------------------------------------------- events

  handleEvent(e: GameEvent) {
    switch (e.type) {
      case 'message':
        this.addLog(e.text, e.tone);
        break;
      case 'xp':
        this.xpDrop(e.skill, e.amount);
        this.skillsDirty = true;
        break;
      case 'levelUp':
        this.skillsDirty = true;
        this.flashBanner(`${SKILL_INFO[e.skill].glyph} ${SKILL_INFO[e.skill].name} level ${e.level}!`, 'levelup');
        break;
      case 'loot':
        this.lootToast(e.item, e.qty);
        this.invDirty = true;
        break;
      case 'region':
        this.regionEl.textContent = e.name;
        this.flashBanner(`<div class="rb-name">${e.name}</div><div class="rb-lv">${e.levels}</div>`, 'region');
        break;
      case 'dialogue':
        this.openDialogue(e.dialogue);
        break;
      case 'quest':
        if (e.complete) this.flashBanner(`📜 Quest complete!<div class="rb-lv">${QUESTS[e.quest].name}</div>`, 'quest');
        this.invDirty = true;
        break;
      case 'gather':
      case 'heal':
        this.invDirty = true;
        break;
      case 'checkpoint':
        this.flashBanner(`🗿 ${e.name} attuned`, 'region');
        break;
    }
    if (e.type === 'attack' || e.type === 'damage') this.invDirty = true;
  }

  markInventoryDirty() {
    this.invDirty = true;
  }

  private addLog(text: string, tone: string) {
    const line = el('div', `log-line ${tone}`);
    line.textContent = text;
    this.log.appendChild(line);
    while (this.log.children.length > 5) this.log.firstChild?.remove();
    setTimeout(() => line.classList.add('fade'), 7000);
  }

  private xpDrop(skill: SkillId, amount: number) {
    const rounded = Math.round(amount * 10) / 10;
    if (rounded <= 0) return;
    const d = el('div', 'xp-drop', `<span class="xg" style="color:${SKILL_INFO[skill].color}">${SKILL_INFO[skill].glyph}</span> +${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}`);
    this.xpDrops.appendChild(d);
    setTimeout(() => d.remove(), 1600);
  }

  private lootToast(item: ItemId, qty: number) {
    const d = el('div', 'loot-toast', `<img src="${itemIcon(item)}" alt=""> +${qty} ${itemDef(item).name}`);
    this.xpDrops.appendChild(d);
    setTimeout(() => d.remove(), 2000);
  }

  private bannerTimer = 0;
  private flashBanner(html: string, cls: string) {
    this.banner.className = `region-banner show ${cls}`;
    this.banner.innerHTML = html;
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('show'), 2600);
  }

  // ---------------------------------------------------------------- dialogue

  private openDialogue(d: Dialogue) {
    this.toggle(null);
    this.dlgState = { d, page: 0 };
    this.renderDialogue();
  }

  private advanceDialogue() {
    const s = this.dlgState;
    if (!s) return;
    if (s.page < s.d.lines.length - 1) {
      s.page++;
      this.renderDialogue();
    } else if (!s.d.offer) this.closeDialogue();
  }

  private closeDialogue() {
    this.dlgState = null;
    this.dialogue.classList.add('hidden');
  }

  get dialogueOpen() {
    return this.dlgState !== null;
  }

  private renderDialogue() {
    const s = this.dlgState!;
    const last = s.page >= s.d.lines.length - 1;
    this.dialogue.classList.remove('hidden');
    let buttons = '';
    if (last && s.d.offer) buttons = `<button class="dlg-accept">✔ ${s.d.offer.label}</button><button class="dlg-decline">Not now</button>`;
    else if (last) buttons = `<button class="dlg-close">Farewell</button>`;
    else buttons = `<button class="dlg-next">Continue ▸</button>`;
    const rewards = last && s.d.rewards ? `<div class="dlg-rewards"><b>Rewards:</b> ${s.d.rewards.join(' · ')}</div>` : '';
    this.dialogue.innerHTML = `
      <div class="dlg-speaker">${s.d.speaker}<span class="dlg-title">${s.d.title}</span></div>
      <div class="dlg-text">${escapeHtml(s.d.lines[s.page] ?? '')}</div>
      ${rewards}
      <div class="dlg-btns">${buttons}</div>`;
    this.dialogue.querySelector('.dlg-next')?.addEventListener('click', () => this.advanceDialogue());
    this.dialogue.querySelector('.dlg-close')?.addEventListener('click', () => this.closeDialogue());
    this.dialogue.querySelector('.dlg-decline')?.addEventListener('click', () => this.closeDialogue());
    this.dialogue.querySelector('.dlg-accept')?.addEventListener('click', () => {
      this.cb.command({ type: 'acceptQuest', quest: s.d.offer!.quest });
      this.closeDialogue();
    });
  }

  // ---------------------------------------------------------------- panels

  toggle(id: PanelId | null) {
    if (id === null || this.openPanel === id) {
      this.openPanel = null;
      this.panel.classList.add('hidden');
      this.root.querySelectorAll('.menu-btn').forEach((b) => b.classList.remove('active'));
      return;
    }
    this.openPanel = id;
    this.selectedSlot = null;
    this.panel.classList.remove('hidden');
    this.panel.dataset.panel = id;
    this.root.querySelectorAll<HTMLElement>('.menu-btn').forEach((b) => b.classList.toggle('active', b.dataset.panel === id));
    const titles: Record<PanelId, string> = { inventory: 'Inventory', skills: 'Skills', quests: 'Quest Journal', map: 'World Map', settings: 'Settings' };
    this.panelTitle.textContent = titles[id];
    if (id === 'inventory') this.renderInventory();
    else if (id === 'skills') this.renderSkills();
    else if (id === 'quests') this.renderQuests();
    else if (id === 'map') this.renderMap();
    else this.renderSettings();
  }

  get panelOpen() {
    return this.openPanel !== null;
  }

  private renderInventory() {
    this.invDirty = false;
    const inv = this.world.player.inventory;
    const body = this.panelBody;
    body.innerHTML = '';
    const grid = el('div', 'inv-grid');
    inv.slots.forEach((s, i) => {
      const cell = el('button', `inv-slot${this.selectedSlot === i ? ' selected' : ''}`);
      if (s) {
        cell.innerHTML = `<img src="${itemIcon(s.item)}" alt="${itemDef(s.item).name}">${s.qty > 1 || itemDef(s.item).stackable ? `<span class="qty">${formatQty(s.qty)}</span>` : ''}`;
      }
      cell.addEventListener('click', () => {
        if (this.selectedSlot !== null && this.selectedSlot !== i && !s) {
          this.cb.command({ type: 'swapItems', a: this.selectedSlot, b: i });
          this.selectedSlot = null;
        } else this.selectedSlot = s ? (this.selectedSlot === i ? null : i) : null;
        this.renderInventory();
      });
      grid.appendChild(cell);
    });
    body.appendChild(grid);
    const info = el('div', 'inv-info');
    const sel = this.selectedSlot !== null ? inv.slots[this.selectedSlot] : null;
    if (sel) {
      const d = itemDef(sel.item);
      info.innerHTML = `<div class="ii-name">${d.name}${sel.qty > 1 ? ` × ${sel.qty}` : ''}</div><div class="ii-desc">${d.examine}</div>`;
      const btns = el('div', 'ii-btns');
      if (d.kind === 'food') {
        const eat = el('button', 'primary', 'Eat');
        eat.addEventListener('click', () => {
          this.cb.command({ type: 'useItem', slot: this.selectedSlot! });
          if (!inv.slots[this.selectedSlot!]) this.selectedSlot = null;
          this.renderInventory();
        });
        btns.appendChild(eat);
      }
      const drop = el('button', 'danger', 'Drop');
      drop.addEventListener('click', () => {
        if (d.kind === 'tool' && !confirm(`Drop your ${d.name}? You will need it to gather.`)) return;
        this.cb.command({ type: 'dropItem', slot: this.selectedSlot! });
        this.selectedSlot = null;
        this.renderInventory();
      });
      btns.appendChild(drop);
      info.appendChild(btns);
    } else {
      info.innerHTML = `<div class="ii-desc">${inv.freeSlots()} of ${inv.slots.length} slots free · Coins: ${inv.count('coins')}<br>Tap an item to inspect, eat or drop it. Tap an empty slot to move a selected item.</div>`;
    }
    body.appendChild(info);
  }

  private renderSkills() {
    this.skillsDirty = false;
    const s = this.world.player.skills;
    const body = this.panelBody;
    body.innerHTML = '';
    const grid = el('div', 'skills-grid');
    for (const id of SKILL_IDS) {
      const info = SKILL_INFO[id];
      const lvl = s.level(id);
      const xp = s.xp[id];
      const cur = xpForLevel(lvl);
      const next = lvl >= MAX_LEVEL ? cur : xpForLevel(lvl + 1);
      const pct = lvl >= MAX_LEVEL ? 100 : ((xp - cur) / (next - cur)) * 100;
      const card = el(
        'div',
        'skill-card',
        `<div class="sk-icon" style="background:${info.color}">${info.glyph}</div>
         <div class="sk-main"><div class="sk-row"><span class="sk-name">${info.name}</span><span class="sk-lvl">${lvl}<small>/${MAX_LEVEL}</small></span></div>
         <div class="sk-bar"><div style="width:${pct.toFixed(1)}%;background:${info.color}"></div></div>
         <div class="sk-xp">${Math.floor(xp).toLocaleString()} xp${lvl < MAX_LEVEL ? ` · ${Math.ceil(next - xp).toLocaleString()} to next` : ''}</div></div>`,
      );
      grid.appendChild(card);
    }
    body.appendChild(grid);
    body.appendChild(el('div', 'skills-total', `Total level <b>${s.totalLevel()}</b> · Combat level <b>${s.combatLevel()}</b>`));
  }

  private renderQuests() {
    const w = this.world;
    const body = this.panelBody;
    body.innerHTML = '';
    for (const q of Object.values(QUESTS)) {
      const prog = w.questProgress(q.id);
      const status = !prog ? 'Not started' : prog.done ? 'Complete' : 'In progress';
      const card = el('div', `quest-card ${!prog ? 'new' : prog.done ? 'done' : 'active'}`);
      let steps = '';
      if (prog) {
        q.stages.forEach((st, i) => {
          if (i === 0) return;
          if (i < prog.stage || prog.done) steps += `<li class="done">${st.journal}</li>`;
          else if (i === prog.stage) steps += `<li class="cur">${st.journal}</li>`;
        });
      } else steps = `<li class="cur">${q.stages[0].journal}</li>`;
      card.innerHTML = `<div class="qc-head"><span class="qc-name">${q.name}</span><span class="qc-status">${status}</span></div>
        <div class="qc-sum">${q.summary}</div><ul class="qc-steps">${steps}</ul>
        <div class="qc-rewards">Rewards: ${q.rewards.text.join(' · ')}</div>`;
      body.appendChild(card);
    }
    body.appendChild(
      el('div', 'quest-card future', `<div class="qc-head"><span class="qc-name">Regional Contracts</span><span class="qc-status">Coming soon</span></div><div class="qc-sum">Optional repeatable contracts for each region will appear on notice boards in a future update.</div>`),
    );
  }

  private renderMap() {
    const map = this.world.map;
    const body = this.panelBody;
    body.innerHTML = '';
    const wrap = el('div', 'world-map');
    const c = el('canvas');
    const S = 3;
    c.width = map.width * S;
    c.height = map.height * S;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.minimapBase, 0, 0, c.width, c.height);
    const dangerCol = ['#5dff8a', '#ffd84d', '#ff9f43', '#ff4d4d'];
    for (const r of map.regions) {
      g.strokeStyle = dangerCol[r.danger];
      g.globalAlpha = 0.7;
      g.lineWidth = 2;
      g.setLineDash([6, 5]);
      g.beginPath();
      g.arc(r.x * S, r.z * S, r.radius * S * 0.8, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
      g.setLineDash([]);
    }
    for (const cp of map.checkpoints) {
      g.fillStyle = this.world.player.checkpoints.has(cp.id) ? '#6fe0ff' : '#9fb4bf';
      g.beginPath();
      g.arc(cp.x * S, cp.z * S, 5, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#123';
      g.lineWidth = 1.5;
      g.stroke();
    }
    const p = this.world.player;
    g.fillStyle = '#fff';
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(p.x * S, p.z * S, 6, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    wrap.appendChild(c);
    for (const r of map.regions) {
      const lbl = el('div', `map-label d${r.danger}`, `<b>${r.name}</b><span>${r.levels}</span>`);
      lbl.style.left = `${(r.x / map.width) * 100}%`;
      lbl.style.top = `${(r.z / map.height) * 100}%`;
      wrap.appendChild(lbl);
    }
    body.appendChild(wrap);
    body.appendChild(el('div', 'map-legend', '<span class="d0">● Safe</span><span class="d1">● Low</span><span class="d2">● Medium</span><span class="d3">● Dangerous</span><span class="cp">● Waystone</span>'));
  }

  private renderSettings() {
    const body = this.panelBody;
    body.innerHTML = '';
    const q = this.cb.getQuality();
    const row = (label: string, control: HTMLElement, hint = '') => {
      const r = el('div', 'set-row', `<div class="set-label">${label}${hint ? `<small>${hint}</small>` : ''}</div>`);
      r.appendChild(control);
      body.appendChild(r);
    };
    const seg = el('div', 'seg');
    for (const opt of ['low', 'balanced', 'high'] as const) {
      const b = el('button', opt === q ? 'on' : '', opt[0].toUpperCase() + opt.slice(1));
      b.addEventListener('click', () => {
        this.cb.setQuality(opt);
        this.renderSettings();
      });
      seg.appendChild(b);
    }
    row('Graphics', seg, 'Low disables shadows for older phones');
    const rot = el('button', `toggle ${this.cb.getRotation() ? 'on' : ''}`, this.cb.getRotation() ? 'On' : 'Off');
    rot.addEventListener('click', () => {
      this.cb.setRotation(!this.cb.getRotation());
      this.renderSettings();
    });
    row('Camera rotation (experimental)', rot, 'Drag with one finger or twist with two; Q/E on keyboard');
    const reset = el('button', '', 'Reset');
    reset.addEventListener('click', () => this.cb.resetCamera());
    row('Camera', reset, 'Restore default angle and zoom');
    const fps = el('button', `toggle ${this.fpsEl.classList.contains('hidden') ? '' : 'on'}`, this.fpsEl.classList.contains('hidden') ? 'Off' : 'On');
    fps.addEventListener('click', () => {
      this.fpsEl.classList.toggle('hidden');
      this.renderSettings();
    });
    row('Show FPS', fps);
    const fresh = el('button', 'danger', 'New character');
    fresh.addEventListener('click', () => {
      if (confirm('Delete this character and start over? Progress will be lost.')) this.cb.newCharacter();
    });
    row('Character', fresh, 'One character per account');
    body.appendChild(
      el('div', 'help', `<b>How to play</b><br>
        • Drag on the left side of the screen to move with the joystick.<br>
        • Tap the ground to walk there. Tap enemies to attack, trees and rocks to gather, villagers to talk.<br>
        • Attacks, chopping and mining repeat automatically while you stay in range.<br>
        • Pinch or use +/− to zoom. Progress saves automatically on this device.`),
    );
  }
}

function formatQty(n: number): string {
  if (n >= 100000) return `${Math.floor(n / 1000)}K`;
  return String(n);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
