import { EQUIP_SLOTS, dropNeedsConfirm, itemDef, type EquipSlot, type ItemId } from '../data/items';
import { QUESTS } from '../data/quests';
import { SKILL_IDS, SKILL_INFO, xpForLevel, MAX_LEVEL, type SkillId } from '../data/skills';
import { STYLES, type CombatStyle } from '../sim/combat';
import { T, type WorldMap } from '../sim/worldmap';
import type { Dialogue, GameEvent, GameWorld } from '../sim/world';
import { TILE_COLORS } from '../render/terrain';
import { itemIcon } from './icons';
import { MapViewer } from './mapview';
import { clearKeepingScroll } from './dom';
import { BankView } from './bankview';
import { CraftView } from './craftview';
import { ShopView } from './shopview';
import { SHOPS } from '../data/shops';
import { RECIPES, STATION_INFO, isAnywhere, useCombo, usable, type AnywhereKind, type StationKind } from '../data/recipes';
import { skillUnlocks } from '../data/unlocks';
import { TOOL_SLOTS } from '../data/tools';
import { GRAVE_SECONDS, KEEP_ON_DEATH } from '../sim/death';
import { FIRE_LOGS } from '../data/firemaking';
import { TANNING } from '../data/tanning';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

type PanelId = 'inventory' | 'skills' | 'quests' | 'map' | 'settings' | 'bank' | 'craft' | 'shop' | 'toolbelt' | 'tanner';

const STYLE_ICON: Record<CombatStyle, string> = { melee: '⚔️', ranged: '🏹', magic: '✨' };

export interface HudCallbacks {
  command: GameWorld['issue'];
  setQuality(q: 'high' | 'balanced' | 'low'): void;
  getQuality(): string;
  setRotation(on: boolean): void;
  getRotation(): boolean;
  setSound(on: boolean): void;
  getSound(): boolean;
  setArtV2(on: boolean): void;
  getArtV2(): boolean;
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
  private status!: HTMLDivElement;
  private log!: HTMLDivElement;
  private xpDrops!: HTMLDivElement;
  private banner!: HTMLDivElement;
  private notice!: HTMLDivElement;
  private noticeTimer = 0;
  private bagBadge!: HTMLSpanElement;
  /** Two-tap confirmation that survives panel re-renders (live loot updates rebuild the buttons). */
  private armed = { key: '', until: 0 };
  private bankView: BankView | null = null;
  private bankDirty = false;
  private craftView: CraftView | null = null;
  private craftStation: StationKind = 'fletching';
  private craftDirty = false;
  private openSkill: SkillId | null = null;
  private shopView: ShopView | null = null;
  private shopId = 'tilly';
  private shopDirty = false;
  /** Inventory slot being "used" on another item (e.g. a knife, waiting for logs to be tapped). */
  private usingSlot: number | null = null;
  private prompt!: HTMLButtonElement;
  private promptTarget: number | null = null;
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
  /** True while a finger is down on the panel; re-renders wait so they never interrupt a scroll. */
  private panelTouching = false;
  private lastPanelScroll = 0;
  private mapViewer: MapViewer | null = null;
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
    this.watchBagPresses();
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
    this.notice = el('div', 'hud-notice');
    this.notice.setAttribute('role', 'status');
    this.root.appendChild(this.notice);
    this.fpsEl = el('div', 'fps hidden');
    this.root.appendChild(this.fpsEl);
  }

  private buildBottom() {
    this.log = el('div', 'msg-log');
    this.root.appendChild(this.log);

    this.status = el('div', 'action-status hidden');
    this.root.appendChild(this.status);
    // Contextual prompt: what the nearby object does; tapping it interacts.
    this.prompt = el('button', 'ctx-prompt hidden');
    this.prompt.addEventListener('click', () => {
      if (this.promptTarget !== null) this.cb.command({ type: 'interact', target: this.promptTarget });
    });
    this.root.appendChild(this.prompt);
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
      return b;
    };
    const bag = mk('🎒', 'Bag', 'inventory');
    this.bagBadge = el('span', 'bag-badge hidden');
    bag.appendChild(this.bagBadge);
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
    const body = this.panelBody;
    body.addEventListener('touchstart', () => (this.panelTouching = true), { passive: true });
    const release = () => {
      this.panelTouching = false;
      this.lastPanelScroll = performance.now();
    };
    body.addEventListener('touchend', release, { passive: true });
    body.addEventListener('touchcancel', release, { passive: true });
    body.addEventListener('scroll', () => (this.lastPanelScroll = performance.now()), { passive: true });
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
    // Buildings (the bank in gold)
    for (const b of map.buildings) {
      const rot = Math.abs(Math.sin(b.facing)) > 0.5;
      const w = rot ? b.d : b.w;
      const d = rot ? b.w : b.d;
      g.fillStyle = b.style === 'bank' ? '#d9b45a' : '#8a5a3c';
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
    const ammo = st.ammo ? w.ammoLeft() : null;
    const label = `<span class="si">${STYLE_ICON[p.style]}</span><span class="sl">${st.name}</span>${ammo !== null ? `<span class="ammo">${ammo}</span>` : ''}`;
    if (this.styleBtn.innerHTML !== label) this.styleBtn.innerHTML = label;
    this.styleBtn.dataset.style = p.style;

    this.updateStatus();
    this.updateBagBadge();
    this.drawMinimap();
    this.updateQuestTracker();
    // Live updates (loot, xp) wait until the player is not touching or flinging the panel.
    const settled = !this.panelTouching && performance.now() - this.lastPanelScroll > 250;
    if (settled && this.openPanel === 'inventory' && this.invDirty) this.renderInventory();
    if (settled && this.openPanel === 'skills' && this.skillsDirty) this.renderSkills();
    if (settled && this.openPanel === 'shop' && this.shopDirty && this.shopView) {
      this.shopDirty = false;
      this.shopView.refresh();
    }
    if (settled && this.openPanel === 'tanner' && this.shopDirty) {
      this.shopDirty = false;
      this.renderTanner();
    }
    this.updatePrompt();
    if (settled && this.openPanel === 'craft' && this.craftDirty && this.craftView) {
      this.craftDirty = false;
      this.craftView.refresh();
    }
    if (this.openPanel === 'bank' && this.bankDirty && this.bankView && !this.bankView.touching && performance.now() - this.bankView.lastScroll > 200) {
      this.bankDirty = false;
      this.bankView.refresh();
    }
    this.updateDeath();

    this.fpsAcc.frames++;
    this.fpsAcc.t += dt;
    if (this.fpsAcc.t >= 0.5) {
      this.fpsEl.textContent = `${Math.round(this.fpsAcc.frames / this.fpsAcc.t)} fps`;
      this.fpsAcc.frames = 0;
      this.fpsAcc.t = 0;
    }
  }

  private updateStatus() {
    const w = this.world;
    const a = w.player.action;
    let text = '';
    if (a?.type === 'attack') {
      const e = w.enemyById(a.target);
      if (e) text = `${STYLE_ICON[w.player.style]} Fighting ${e.def.name}`;
    } else if (a?.type === 'gather') {
      const n = w.gatheringNode;
      if (n && n.def.skill === 'crafting') text = `🌿 Picking flax${w.isGathering ? '…' : ''}`;
      else if (n) text = n.def.skill === 'fishing' ? `🎣 Fishing${w.isGathering ? '…' : ''}` : `${n.def.skill === 'woodcutting' ? '🪓 Chopping' : '⛏️ Mining'} ${n.def.name.toLowerCase()}${w.isGathering ? '…' : ''}`;
    } else if (a?.type === 'talk' || a?.type === 'station') text = '💬 Walking over…';
    else if (a?.type === 'grave') text = '🪦 Going to your gravestone…';
    else if (a?.type === 'firemaking') text = '🔥 Lighting a fire…';
    else if (a?.type === 'craft') {
      const r = RECIPES[a.recipe];
      if (r) text = `${SKILL_INFO[r.skill].glyph} ${STATION_INFO[r.station].doing} ${itemDef(r.station === 'range' ? r.inputs[0].item : r.output.item).name.toLowerCase()}${a.remaining > 1 ? ` · ${a.remaining} left` : '…'}`;
    }
    else if (w.player.path.length > 0) text = '👣 Walking';
    if (this.status.textContent !== text) this.status.textContent = text;
    this.status.classList.toggle('hidden', !text);
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
      if (n.def.service === 'bank') dot(n.x, n.z, '#f5c542', 1.3);
      else dot(n.x, n.z, m === 'available' || m === 'ready' ? '#ffd84d' : '#fff59d', m ? 1.3 : 0.9);
    }
    for (const c of this.world.map.checkpoints) dot(c.x, c.z, this.world.player.checkpoints.has(c.id) ? '#6fe0ff' : '#9fb4bf', 1);
    for (const gr of this.world.graves) if (!gr.expired) dot(gr.x, gr.z, '#e8e8e8', 1.4);
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
      const d = p.lastDeath;
      const kept = d?.kept.length ? d.kept.map((k) => `<img src="${itemIcon(k.item)}" alt=""> ${k.qty > 1 ? `${k.qty} × ` : ''}${itemDef(k.item).name}`).join('<br>') : 'Nothing';
      const lost = d?.grave
        ? `Your other ${d.lost} item${d.lost === 1 ? ' is' : 's are'} in a gravestone where you fell. Reach it within ${GRAVE_SECONDS / 60} minutes of play and tap it to take ${d.lost === 1 ? 'it' : 'them'} back. After that, ${d.lost === 1 ? 'it is' : 'they are'} gone.`
        : 'You carried nothing else, so nothing was lost.';
      this.death.innerHTML = `
        <div class="death-card">
          <div class="death-title">You have fallen</div>
          <div class="death-kept"><b>Kept (your ${KEEP_ON_DEATH} most valuable items)</b><div>${kept}</div></div>
          <div class="death-sub">${lost} Your toolbelt is always kept.</div>
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
        this.craftDirty = true;
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
      case 'inventoryFull':
        this.flashNotice('Your inventory is full.');
        this.invDirty = true;
        this.bankDirty = true;
        break;
      case 'bankOpen':
        this.toggle('bank');
        break;
      case 'shopOpen':
        this.shopId = e.shop;
        this.toggle('shop');
        break;
      case 'tannerOpen':
        this.toggle('tanner');
        break;
      case 'tannerClose':
        if (this.openPanel === 'tanner') this.toggle(null);
        break;
      case 'shopClose':
        if (this.openPanel === 'shop') {
          this.shopView = null;
          this.toggle(null);
        }
        break;
      case 'shop':
        this.shopDirty = true;
        this.invDirty = true;
        break;
      case 'productionOpen':
        this.openCraft(e.station);
        break;
      case 'productionClose':
        if (this.openPanel === 'craft' && !isAnywhere(this.craftStation)) {
          this.craftView = null;
          this.toggle(null);
        }
        break;
      case 'craft':
        this.craftDirty = true;
        this.invDirty = true;
        this.skillsDirty = true;
        break;
      case 'equipment':
        this.invDirty = true;
        break;
      case 'toolbelt':
        this.invDirty = true;
        if (this.openPanel === 'toolbelt') this.renderToolbelt();
        break;
      case 'bankClose':
        if (this.openPanel === 'bank') {
          this.leaveBank(false);
          this.toggle(null);
          this.addLog('You step away from the bank.', 'info');
        }
        break;
      case 'bank':
        this.bankDirty = true;
        this.invDirty = true;
        break;
      case 'bankFull':
        this.flashNotice('Your bank is full.');
        this.bankDirty = true;
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

  /** Returns true on the second tap of the same action within 3 s, even if the panel re-rendered. */
  private confirmTap(key: string, btn: HTMLButtonElement, prompt: string): boolean {
    const now = performance.now();
    if (this.armed.key === key && now < this.armed.until) {
      this.armed.key = '';
      return true;
    }
    this.armed = { key, until: now + 3000 };
    // Put the button back to normal once the window passes.
    window.setTimeout(() => {
      if (this.armed.key === key) this.armed.key = '';
      this.invDirty = true;
    }, 3050);
    btn.textContent = prompt;
    btn.classList.add('armed');
    return false;
  }

  private restoreArmed(key: string, btn: HTMLButtonElement, prompt: string) {
    if (this.armed.key === key && performance.now() < this.armed.until) {
      btn.textContent = prompt;
      btn.classList.add('armed');
    }
  }

  /** Brief centred notice (e.g. a full inventory); repeated notices just extend it. */
  private flashNotice(text: string) {
    this.notice.textContent = text;
    this.notice.classList.add('show');
    window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => this.notice.classList.remove('show'), 1800);
  }

  /** Used-slot count on the Bag button once the bag is getting full (red when full). */
  private updateBagBadge() {
    const inv = this.world.player.inventory;
    const used = inv.usedSlots();
    const held = this.world.player.overflow.length > 0;
    const show = used >= inv.slots.length - 6 || held;
    const text = used >= inv.slots.length ? 'FULL' : `${used}/${inv.slots.length}`;
    if (this.bagBadge.textContent !== text) this.bagBadge.textContent = text;
    this.bagBadge.classList.toggle('hidden', !show);
    this.bagBadge.classList.toggle('full', used >= inv.slots.length);
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
    this.mapViewer?.dispose();
    this.mapViewer = null;
    if (this.openPanel === 'bank' && id !== 'bank' && this.bankView) this.leaveBank(true);
    if (this.openPanel === 'shop' && id !== 'shop' && this.shopView) {
      this.shopView = null;
      this.cb.command({ type: 'shopClose' });
    }
    if (this.openPanel === 'tanner' && id !== 'tanner') this.cb.command({ type: 'tannerClose' });
    if (this.openPanel === 'craft' && this.craftView) {
      // Closed by the player (not by starting production): release the station.
      this.craftView = null;
      this.cb.command({ type: 'closeProduction' });
    }
    if (id === 'bank' && this.openPanel === 'bank') return;
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
    const titles: Record<PanelId, string> = { inventory: 'Inventory', skills: 'Skills', quests: 'Quest Journal', map: 'World Map', settings: 'Settings', bank: 'Bank of Brightwater', craft: STATION_INFO[this.craftStation].name, shop: SHOPS[this.shopId]?.name ?? 'Shop', toolbelt: 'Toolbelt', tanner: 'Tannery' };
    this.panelTitle.textContent = titles[id];
    this.panelBody.scrollTop = 0;
    if (id === 'inventory') this.renderInventory();
    else if (id === 'skills') this.renderSkills();
    else if (id === 'quests') this.renderQuests();
    else if (id === 'map') this.renderMap();
    else if (id === 'bank') this.renderBank();
    else if (id === 'craft') this.renderCraft();
    else if (id === 'shop') this.renderShop();
    else if (id === 'toolbelt') this.renderToolbelt();
    else if (id === 'tanner') this.renderTanner();
    else this.renderSettings();
  }

  /** Open the production panel for a station (or fletching). */
  openCraft(station: StationKind) {
    if (this.openPanel === 'craft') {
      this.craftView = null;
      this.openPanel = null;
    }
    this.craftStation = station;
    this.toggle('craft');
  }

  private renderCraft() {
    clearKeepingScroll(this.panelBody);
    this.craftView = new CraftView(
      this.world,
      this.craftStation,
      (c) => this.cb.command(c),
      () => {
        // Production started: close the panel without releasing the station.
        this.craftView = null;
        this.toggle(null);
      },
    );
    this.panelBody.appendChild(this.craftView.root);
    this.craftDirty = false;
  }

  /** Rook's tannery: hides in the bag become leather for a fee each. */
  private renderTanner() {
    const body = this.panelBody;
    clearKeepingScroll(body);
    const inv = this.world.player.inventory;
    const coins = inv.count('coins');
    body.appendChild(el('div', 'ii-desc tb-intro', `“Good hides make good leather.” Leather is sewn into armour with a needle and thread (Crafting). You have ${coins} coins.`));
    for (const t of TANNING) {
      const have = inv.count(t.from);
      const afford = Math.min(have, Math.floor(coins / t.cost));
      const box = el('div', 'inv-info');
      box.innerHTML = `<div class="ii-name"><img class="tan-icon" src="${itemIcon(t.from)}" alt=""> ${itemDef(t.from).name} → <img class="tan-icon" src="${itemIcon(t.to)}" alt=""> ${itemDef(t.to).name}</div><div class="ii-desc">${t.cost} coins each · you have ${have}</div>`;
      const btns = el('div', 'ii-btns');
      for (const [label, n] of [['Tan 1', 1], [`Tan all (${afford})`, afford]] as const) {
        const b = el('button', n === 1 ? '' : 'primary', label);
        b.disabled = afford < 1;
        b.addEventListener('click', () => {
          this.cb.command({ type: 'tan', item: t.from, qty: n });
          this.renderTanner();
        });
        btns.appendChild(b);
      }
      box.appendChild(btns);
      if (have === 0) box.appendChild(el('div', 'ii-desc', 'Timber wolves in the Whispering Woods drop pelts.'));
      body.appendChild(box);
    }
  }

  private renderShop() {
    clearKeepingScroll(this.panelBody);
    this.shopView = new ShopView(this.world, this.shopId, (c) => this.cb.command(c));
    this.panelBody.appendChild(this.shopView.root);
    this.shopDirty = false;
  }

  private renderBank() {
    clearKeepingScroll(this.panelBody);
    this.bankView = new BankView(this.world, (c) => this.cb.command(c), (key, btn, prompt) => this.confirmTap(key, btn, prompt));
    this.panelBody.appendChild(this.bankView.root);
    this.bankDirty = false;
  }

  /** Tear down the bank view; tell the simulation unless it closed the bank itself. */
  private leaveBank(notify: boolean) {
    this.bankView = null;
    if (notify) this.cb.command({ type: 'bankClose' });
  }

  get panelOpen() {
    return this.openPanel !== null;
  }

  private renderInventory() {
    this.invDirty = false;
    const inv = this.world.player.inventory;
    const body = this.panelBody;
    clearKeepingScroll(body);
    this.renderEquipment(body);
    const used = inv.usedSlots();
    const head = el('div', `inv-head${inv.isFull() ? ' full' : ''}`, `<span>${used} / ${inv.slots.length} slots used</span>${inv.isFull() ? '<span class="inv-full">Inventory full</span>' : `<span>${inv.freeSlots()} free</span>`}`);
    body.appendChild(head);
    const grid = el('div', 'inv-grid');
    inv.slots.forEach((s, i) => {
      const cell = el('button', `inv-slot${this.selectedSlot === i ? ' selected' : ''}`);
      if (s) {
        cell.innerHTML = `<img src="${itemIcon(s.item)}" alt="${itemDef(s.item).name}">${s.qty > 1 || itemDef(s.item).stackable ? `<span class="qty">${formatQty(s.qty)}</span>` : ''}`;
      }
      // Taps and holds are handled at document level (see watchBagPresses) using the slot index, so a
      // re-render during the touch can't lose it. Keyboard activation (no pointer) still taps.
      cell.dataset.slot = String(i);
      cell.addEventListener('click', (ev) => {
        if (ev.detail === 0) this.tapSlot(i);
      });
      if (this.usingSlot === i) cell.classList.add('using');
      grid.appendChild(cell);
    });
    body.appendChild(grid);
    const info = el('div', 'inv-info');
    const sel = this.selectedSlot !== null ? inv.slots[this.selectedSlot] : null;
    const using = this.usingSlot !== null ? inv.slots[this.usingSlot] : null;
    if (using) {
      info.innerHTML = `<div class="ii-name">Use ${itemDef(using.item).name} on…</div><div class="ii-desc">Tap another item (for example a knife on logs).</div>`;
      const cancel = el('button', '', 'Cancel');
      cancel.addEventListener('click', () => {
        this.usingSlot = null;
        this.renderInventory();
      });
      const btns = el('div', 'ii-btns');
      btns.appendChild(cancel);
      info.appendChild(btns);
    } else if (sel) {
      const d = itemDef(sel.item);
      info.innerHTML = `<div class="ii-name">${d.name}${sel.qty > 1 ? ` × ${sel.qty}` : ''}</div><div class="ii-desc">${d.examine}</div>`;
      const btns = el('div', 'ii-btns');
      if (d.equip) {
        const req = Object.entries(d.equip.req ?? {}).map(([sk, l]) => `${SKILL_INFO[sk as SkillId].name} ${l}`).join(', ');
        const stats = [d.equip.accuracy ? `+${d.equip.accuracy} accuracy` : '', d.equip.power ? `+${d.equip.power} power` : '', d.equip.armour ? `+${d.equip.armour} armour` : ''].filter(Boolean).join(' · ');
        info.innerHTML += `<div class="ii-stats">${stats}${d.equip.twoHanded ? ' · two-handed' : ''}${req ? ` · needs ${req}` : ''}</div>`;
        const wear = el('button', 'primary', d.equip.slot === 'weapon' ? 'Wield' : 'Wear');
        wear.addEventListener('click', () => {
          this.cb.command({ type: 'equip', slot: this.selectedSlot! });
          if (!inv.slots[this.selectedSlot!] || inv.slots[this.selectedSlot!]!.item !== sel.item) this.selectedSlot = null;
          this.renderInventory();
        });
        btns.appendChild(wear);
      }
      if (FIRE_LOGS[sel.item]) {
        const light = el('button', 'primary', '🔥 Light');
        light.addEventListener('click', () => {
          this.cb.command({ type: 'lightFire', slot: this.selectedSlot! });
          this.selectedSlot = null;
          this.toggle(null);
        });
        btns.appendChild(light);
      }
      if (usable(sel.item)) {
        const use = el('button', 'primary', FIRE_LOGS[sel.item] ? '🔪 Fletch' : 'Use');
        use.addEventListener('click', () => {
          // With the partner already at hand (bag or toolbelt), go straight to making things.
          const kind = this.partnerKind(this.selectedSlot!);
          if (kind) {
            this.selectedSlot = null;
            this.cb.command({ type: 'openAnywhere', kind });
            return;
          }
          this.usingSlot = this.selectedSlot;
          this.renderInventory();
        });
        btns.appendChild(use);
      }
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
        if (dropNeedsConfirm(sel.item, sel.qty) && !this.confirmTap(`drop:${this.selectedSlot}:${sel.item}`, drop, 'Tap again to drop')) return;
        this.cb.command({ type: 'dropItem', slot: this.selectedSlot! });
        this.selectedSlot = null;
        this.renderInventory();
      });
      this.restoreArmed(`drop:${this.selectedSlot}:${sel.item}`, drop, 'Tap again to drop');
      btns.appendChild(drop);
      info.appendChild(btns);
    } else {
      info.innerHTML = `<div class="ii-desc">Coins: ${inv.count('coins')}<br><b>Tap</b> an item to use it: eat food, wield or wear gear, light logs (with a tinderbox) or fletch them (with a knife), put tools on your toolbelt. <b>Press and hold</b> for options such as drop or move. Logs, ores and gems take one slot each.</div>`;
    }
    body.appendChild(info);
    // Keep an item's options (Light / Fletch, Drop…) on screen below the 28 slots.
    if (sel || using) requestAnimationFrame(() => info.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    this.renderOverflow(body);
  }

  /**
   * Shows what the nearest usable thing does (station, bank, shop, fishing spot) when the player is
   * close and idle; tapping the prompt interacts with it. Hidden while a panel is open.
   */
  private updatePrompt() {
    const w = this.world;
    const p = w.player;
    let best: { id: number; text: string; d: number } | null = null;
    const consider = (id: number, x: number, z: number, text: string, range: number) => {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d <= range && (!best || d < best.d)) best = { id, text, d };
    };
    if (!p.dead && !this.openPanel && !p.action && !this.dialogueOpen) {
      for (const st of w.stations) consider(st.id, st.x, st.z, `${SKILL_INFO[STATION_INFO[st.kind].skill].glyph} ${st.name} · ${STATION_INFO[st.kind].prompt}`, 3);
      for (const n of w.npcs) {
        if (n.def.service === 'bank') consider(n.id, n.x, n.z, '🏦 Bank · open your bank', (n.def.reach ?? 1.9) + 1);
        if (n.def.service === 'shop') consider(n.id, n.x, n.z, "🛒 Tilly's stall · buy tools, sell goods", (n.def.reach ?? 1.9) + 1);
        if (n.def.service === 'tanner') consider(n.id, n.x, n.z, '🧵 Rook the tanner · tan pelts into leather', (n.def.reach ?? 1.9) + 1);
      }
      for (const nd of w.nodes) if (nd.def.skill === 'fishing') consider(nd.id, nd.x, nd.z, '🎣 Fishing spot · net fish (needs a net)', 2.6);
      for (const nd of w.nodes) if (nd.def.id === 'flax' && !nd.depleted) consider(nd.id, nd.x, nd.z, '🌿 Flax · pick it to spin bowstrings', 2.2);
    }
    const b = best as { id: number; text: string; d: number } | null;
    this.promptTarget = b ? b.id : null;
    const text = b ? `${b.text}  ›` : '';
    if (this.prompt.textContent !== text) this.prompt.textContent = text;
    this.prompt.classList.toggle('hidden', !b);
  }

  private press: { id: number; slot: number; x: number; y: number; t: number; moved: boolean } | null = null;

  /**
   * Bag touch handling. Tap vs press-and-hold is decided from the browser's own event timestamps
   * when the finger lifts, so a busy frame can't turn a quick tap into a hold (or swallow it), and
   * the slot index is remembered from the press, so re-rendering the bag mid-touch is harmless.
   */
  private watchBagPresses() {
    const slotAt = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>('.inv-grid .inv-slot[data-slot]') : null);
    document.addEventListener(
      'pointerdown',
      (e) => {
        const c = slotAt(e.target);
        this.press = c && e.isPrimary && e.button === 0 ? { id: e.pointerId, slot: Number(c.dataset.slot), x: e.clientX, y: e.clientY, t: e.timeStamp, moved: false } : null;
      },
      true,
    );
    document.addEventListener(
      'pointermove',
      (e) => {
        const p = this.press;
        if (p && e.pointerId === p.id && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 12) p.moved = true;
      },
      true,
    );
    document.addEventListener('pointercancel', () => (this.press = null), true);
    document.addEventListener(
      'pointerup',
      (e) => {
        const p = this.press;
        if (!p || e.pointerId !== p.id) return;
        this.press = null;
        if (p.moved || this.openPanel !== 'inventory') return;
        if (e.timeStamp - p.t >= 450) this.showSlotOptions(p.slot);
        else this.tapSlot(p.slot);
      },
      true,
    );
    // Long-press menus (Android) and right-click (desktop) open the options instead.
    document.addEventListener(
      'contextmenu',
      (e) => {
        const c = slotAt(e.target);
        if (!c) return;
        e.preventDefault();
        this.press = null;
        this.showSlotOptions(Number(c.dataset.slot));
      },
      true,
    );
  }

  /** Options for an item (Use, Drop, Eat, Wield…), and pick it up to move it to an empty slot. */
  private showSlotOptions(slot: number) {
    this.usingSlot = null;
    this.selectedSlot = this.world.player.inventory.slots[slot] ? slot : null;
    this.renderInventory();
  }

  /** A tap on a bag slot. */
  private tapSlot(i: number) {
    const inv = this.world.player.inventory;
    const s = inv.slots[i];
    if (this.usingSlot !== null) {
      // Finish "Use X on Y" (started from the options menu).
      const from = this.usingSlot;
      const a = inv.slots[from];
      this.usingSlot = null;
      this.selectedSlot = null;
      if (a && s && i !== from) {
        const kind = useCombo(a.item, s.item);
        if (kind) {
          this.cb.command({ type: 'openAnywhere', kind });
          return;
        }
        this.addLog('Nothing interesting happens.', 'info');
      }
      this.renderInventory();
      return;
    }
    if (this.selectedSlot !== null && this.selectedSlot !== i && !s) {
      // Move the item picked in the options menu to this empty slot.
      this.cb.command({ type: 'swapItems', a: this.selectedSlot, b: i });
      this.selectedSlot = null;
      this.renderInventory();
      return;
    }
    if (!s) return;
    if (this.quickUse(i)) return;
    this.selectedSlot = this.selectedSlot === i ? null : i;
    this.renderInventory();
  }

  /**
   * The main action for tapping an item: eat food, wield/wear gear, fletch (a knife with logs, a
   * bowstring with an unstrung bow, …). Returns false when the item has no main action, in which
   * case the tap just shows its details.
   */
  private quickUse(slot: number): boolean {
    const inv = this.world.player.inventory;
    const st = inv.slots[slot];
    if (!st) return false;
    const d = itemDef(st.item);
    this.selectedSlot = null;
    this.usingSlot = null;
    if (d.kind === 'food') {
      this.cb.command({ type: 'useItem', slot });
      this.renderInventory();
      return true;
    }
    if (d.equip) {
      this.cb.command({ type: 'equip', slot });
      this.renderInventory();
      return true;
    }
    const partner = this.partnerKind(slot);
    const canLight = !!FIRE_LOGS[st.item] && !!this.world.toolFor('tinderbox').tool;
    if (partner && canLight) {
      // Logs with both a knife and a tinderbox: let the player choose (Light or Fletch).
      this.selectedSlot = slot;
      this.renderInventory();
      return true;
    }
    if (canLight) {
      this.cb.command({ type: 'lightFire', slot });
      this.toggle(null);
      return true;
    }
    if (partner) {
      this.cb.command({ type: 'openAnywhere', kind: partner });
      return true;
    }
    if (st.item === 'leather' || st.item === 'sapphire') {
      this.addLog(`You need ${st.item === 'leather' ? 'a needle' : 'a chisel'} (in your bag or toolbelt) for that. Tilly sells them.`, 'warn');
      return false;
    }
    if (FIRE_LOGS[st.item]) {
      this.addLog('You need a tinderbox to light logs, or a knife to fletch them (in your bag or toolbelt). Tilly sells both.', 'warn');
      return false;
    }
    if (d.tool) {
      // Tools go on the toolbelt (swapping out the one already there).
      this.cb.command({ type: 'beltAdd', slot });
      this.renderInventory();
      return true;
    }
    return false;
  }

  /** What "using" the item in a bag slot opens: a matching partner in the bag or on the toolbelt. */
  private partnerKind(slot: number): AnywhereKind | null {
    const p = this.world.player;
    const st = p.inventory.slots[slot];
    if (!st || !usable(st.item)) return null;
    for (const [j, o] of p.inventory.slots.entries()) {
      const k = o && j !== slot ? useCombo(st.item, o.item) : null;
      if (k) return k;
    }
    for (const b of Object.values(p.toolbelt.slots)) {
      const k = b ? useCombo(st.item, b) : null;
      if (k) return k;
    }
    return null;
  }

  /** Toolbelt: one slot per tool kind (future kinds shown locked), plus bag tools you can add. */
  private renderToolbelt() {
    const w = this.world;
    const p = w.player;
    const body = this.panelBody;
    clearKeepingScroll(body);
    body.appendChild(el('div', 'ii-desc tb-intro', 'Tools on your belt work from anywhere and take no bag slots. The best tool you can use is picked automatically, from your belt or your bag.'));
    const bagTools = p.inventory.slots.map((s, i) => ({ s, i })).filter((x) => x.s && itemDef(x.s.item).tool);
    const box = el('div', 'inv-info');
    if (bagTools.length) {
      box.appendChild(el('div', 'ii-name', 'Tools in your bag'));
      const list = el('div', 'tb-bag');
      for (const { s, i } of bagTools) {
        const d = itemDef(s!.item);
        const cur = p.toolbelt.get(d.tool!.category);
        const b = el('button', 'bank-btn', `<img src="${itemIcon(s!.item)}" alt="">${cur ? 'Swap in' : 'Add'} ${d.name}`);
        b.addEventListener('click', () => this.cb.command({ type: 'beltAdd', slot: i }));
        list.appendChild(b);
      }
      box.appendChild(list);
      const all = el('button', 'bank-btn primary', 'Add all to empty slots');
      all.addEventListener('click', () => this.cb.command({ type: 'beltAddAll' }));
      box.appendChild(all);
    } else box.appendChild(el('div', 'ii-desc', 'No other tools in your bag. Buy tools from Tilly or forge them at the anvil.'));
    body.appendChild(box);
    const grid = el('div', 'tb-grid');
    // Usable kinds first; kinds that arrive with future skills last.
    for (const slot of [...TOOL_SLOTS].sort((x, y) => Number(y.available) - Number(x.available))) {
      const it = p.toolbelt.get(slot.id);
      const d = it ? itemDef(it) : null;
      const card = el('div', `tb-slot${it ? ' filled' : ''}${slot.available ? '' : ' locked'}`);
      const req = d?.tool?.req ? ` · needs ${SKILL_INFO[d.tool.req.skill].name} ${d.tool.req.level}` : '';
      card.innerHTML = `${it ? `<img src="${itemIcon(it)}" alt="">` : '<div class="tb-empty">—</div>'}
        <div class="tb-main"><div class="tb-label">${slot.label} <small>${slot.skill}</small></div>
        <div class="tb-sub">${d ? `${d.name} · tier ${d.tool!.tier}${req}` : slot.available ? 'Empty: tap a tool in your bag to add it' : (slot.note ?? 'Not available yet')}</div></div>`;
      if (it) {
        const off = el('button', 'bank-btn', 'Take off');
        off.addEventListener('click', () => this.cb.command({ type: 'beltRemove', category: slot.id }));
        card.appendChild(off);
      }
      grid.appendChild(card);
    }
    body.appendChild(grid);
  }

  /** Worn gear: five slots above the inventory, with the combined combat bonuses. */
  private renderEquipment(body: HTMLElement) {
    const w = this.world;
    const eq = w.player.equipment;
    const box = el('div', 'equip');
    const labels: Record<EquipSlot, string> = { head: 'Head', cape: 'Cape', neck: 'Neck', ammo: 'Ammo', weapon: 'Weapon', shield: 'Shield', body: 'Body', legs: 'Legs', hands: 'Hands', feet: 'Feet', ring: 'Ring' };
    const row = el('div', 'equip-row');
    for (const slot of EQUIP_SLOTS) {
      const it = eq.get(slot);
      const qty = slot === 'ammo' && it ? `<span class="eq-qty">${eq.ammoQty}</span>` : '';
      const cell = el('button', `equip-slot${it ? ' worn' : ''}`, it ? `<img src="${itemIcon(it)}" alt="${itemDef(it).name}">${qty}` : `<span>${labels[slot]}</span>`);
      cell.setAttribute('aria-label', it ? `${labels[slot]}: ${slot === 'ammo' ? `${eq.ammoQty} ` : ''}${itemDef(it).name}` : `${labels[slot]} (empty)`);
      cell.disabled = !it;
      cell.addEventListener('click', () => {
        if (!it) return;
        this.cb.command({ type: 'unequip', slot });
        this.renderInventory();
      });
      row.appendChild(cell);
    }
    const b = w.playerBonuses();
    const weapon = b.weapon ? itemDef(b.weapon).name : `${STYLES[w.player.style].weapon} (training)`;
    box.append(row, el('div', 'equip-stats', `${weapon} · accuracy ${b.accuracy} · power ${b.power} · armour ${b.armour}<br><small>Tap worn gear to take it off.</small>`));
    const tools = Object.values(w.player.toolbelt.slots).filter(Boolean) as ItemId[];
    const belt = el('button', 'tb-open', `<span>🧰 Toolbelt</span><span class="tb-icons">${tools.map((t) => `<img src="${itemIcon(t)}" alt="${itemDef(t).name}">`).join('')}</span><span class="tb-count">${tools.length} ›</span>`);
    belt.addEventListener('click', () => this.toggle('toolbelt'));
    box.appendChild(belt);
    body.appendChild(box);
  }

  /** Items held after migrating an older save, until the player collects or discards them. */
  private renderOverflow(body: HTMLElement) {
    const held = this.world.player.overflow;
    if (!held.length) return;
    const box = el('div', 'inv-info inv-held');
    const total = held.reduce((a, o) => a + o.qty, 0);
    const list = held.map((o) => `${o.qty} × ${itemDef(o.item).name}`).join(', ');
    box.innerHTML = `<div class="ii-name">Held for you (${total})</div><div class="ii-desc">${list}. These didn't fit when logs, ores and gems became one per slot. Free up space, then collect them.</div>`;
    const btns = el('div', 'ii-btns');
    const take = el('button', 'primary', 'Collect what fits');
    take.disabled = this.world.player.inventory.isFull();
    take.addEventListener('click', () => {
      this.cb.command({ type: 'claimOverflow' });
      this.renderInventory();
    });
    const discard = el('button', 'danger', 'Discard');
    discard.addEventListener('click', () => {
      if (!this.confirmTap('discard-held', discard, 'Tap again: discard all held')) return;
      this.cb.command({ type: 'discardOverflow' });
      this.renderInventory();
    });
    this.restoreArmed('discard-held', discard, 'Tap again: discard all held');
    btns.append(take, discard);
    box.appendChild(btns);
    body.appendChild(box);
  }

  private renderSkills() {
    this.skillsDirty = false;
    const s = this.world.player.skills;
    const body = this.panelBody;
    clearKeepingScroll(body);
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
      card.addEventListener('click', () => {
        this.openSkill = this.openSkill === id ? null : id;
        this.renderSkills();
      });
      grid.appendChild(card);
      if (this.openSkill === id) {
        const list = skillUnlocks(id);
        const det = el('div', 'skill-unlocks');
        det.innerHTML = `<div class="su-how">${info.available ? '' : '<b class="su-na">Not available yet.</b> '}${info.howTo}</div>` + (list.length
          ? list.map((u) => `<div class="su ${u.level <= lvl ? 'done' : ''}"><b>${u.level}</b><img src="${itemIcon(u.icon)}" alt="">${u.text}</div>`).join('')
          : '<div class="su">Every level makes you stronger in this skill.</div>');
        grid.appendChild(det);
      }
    }
    body.appendChild(grid);
    body.appendChild(el('div', 'skills-total', `Total level <b>${s.totalLevel()}</b> · Combat level <b>${s.combatLevel()}</b>`));
  }

  private renderQuests() {
    const w = this.world;
    const body = this.panelBody;
    clearKeepingScroll(body);
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
    clearKeepingScroll(body);
    const S = 6;
    const c = el('canvas', 'map-canvas');
    c.width = map.width * S;
    c.height = map.height * S;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.minimapBase, 0, 0, c.width, c.height);
    const dangerCol = ['#5dff8a', '#ffd84d', '#ff9f43', '#ff4d4d'];
    for (const r of map.regions) {
      g.strokeStyle = dangerCol[r.danger];
      g.globalAlpha = 0.7;
      g.lineWidth = 4;
      g.setLineDash([12, 10]);
      g.beginPath();
      g.arc(r.x * S, r.z * S, r.radius * S * 0.8, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
      g.setLineDash([]);
    }
    for (const cp of map.checkpoints) {
      g.fillStyle = this.world.player.checkpoints.has(cp.id) ? '#6fe0ff' : '#9fb4bf';
      g.beginPath();
      g.arc(cp.x * S, cp.z * S, 9, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#123';
      g.lineWidth = 3;
      g.stroke();
    }
    const p = this.world.player;
    g.fillStyle = '#fff';
    g.strokeStyle = '#000';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(p.x * S, p.z * S, 11, 0, Math.PI * 2);
    g.fill();
    g.stroke();

    const viewport = el('div', 'map-view');
    const stage = el('div', 'map-stage');
    stage.appendChild(c);
    const labels: HTMLElement[] = [];
    for (const r of map.regions) {
      const lbl = el('div', `map-label d${r.danger}`, `<b>${r.name}</b><span>${r.levels}</span>`);
      lbl.style.left = `${(r.x / map.width) * 100}%`;
      lbl.style.top = `${(r.z / map.height) * 100}%`;
      stage.appendChild(lbl);
      labels.push(lbl);
    }
    viewport.appendChild(stage);
    const tools = el('div', 'map-tools');
    const mk = (label: string, title: string, fn: () => void) => {
      const b = el('button', 'map-tool', label);
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', fn);
      tools.appendChild(b);
    };
    viewport.appendChild(tools);
    body.appendChild(viewport);
    body.appendChild(el('div', 'map-legend', '<span class="d0">● Safe</span><span class="d1">● Low</span><span class="d2">● Medium</span><span class="d3">● Dangerous</span><span class="cp">● Waystone</span><span class="hint">Drag to pan · pinch or double-tap to zoom</span>'));
    const viewer = new MapViewer(viewport, stage, labels, () => ({ fx: p.x / map.width, fy: p.z / map.height }));
    mk('+', 'Zoom in', () => viewer.zoom(1.5));
    mk('−', 'Zoom out', () => viewer.zoom(1 / 1.5));
    mk('◎', 'Centre on me', () => viewer.centerOnFocus());
    mk('⤢', 'Show whole map', () => viewer.reset());
    this.mapViewer = viewer;
  }

  private renderSettings() {
    const body = this.panelBody;
    clearKeepingScroll(body);
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
    const art = el('div', 'seg');
    for (const [label, on] of [['Phase 2A', true], ['Classic', false]] as const) {
      const b = el('button', this.cb.getArtV2() === on ? 'on' : '', label);
      b.addEventListener('click', () => {
        if (this.cb.getArtV2() !== on) this.cb.setArtV2(on);
      });
      art.appendChild(b);
    }
    row('Visual style', art, 'Phase 2A preview: new characters, water and showcase art. Reloads the game.');
    const rot = el('button', `toggle ${this.cb.getRotation() ? 'on' : ''}`, this.cb.getRotation() ? 'On' : 'Off');
    rot.addEventListener('click', () => {
      this.cb.setRotation(!this.cb.getRotation());
      this.renderSettings();
    });
    row('Camera rotation (experimental)', rot, 'Drag with one finger or twist with two; Q/E on keyboard');
    const snd = el('button', `toggle ${this.cb.getSound() ? 'on' : ''}`, this.cb.getSound() ? 'On' : 'Off');
    snd.addEventListener('click', () => {
      this.cb.setSound(!this.cb.getSound());
      this.renderSettings();
    });
    row('Sound effects', snd);
    const auto = this.world.player.autoGather;
    const ag = el('button', `toggle ${auto ? 'on' : ''}`, auto ? 'On' : 'Off');
    ag.addEventListener('click', () => {
      this.cb.command({ type: 'setOption', option: 'autoGather', on: !this.world.player.autoGather });
      this.renderSettings();
    });
    row('Auto-continue gathering', ag, 'When a tree, rock or fishing spot runs out, walk to the next one nearby. Off matches classic rules.');
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
      if (armConfirm(fresh, 'Tap again: progress will be lost')) this.cb.newCharacter();
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

/**
 * Two-tap confirmation built into the button itself (browser confirm() dialogs are
 * unreliable in embedded mobile views). Returns true on the second tap within 3 seconds.
 */
function armConfirm(btn: HTMLButtonElement, prompt: string): boolean {
  if (btn.dataset.armed === '1') return true;
  const original = btn.textContent;
  btn.dataset.armed = '1';
  btn.textContent = prompt;
  setTimeout(() => {
    btn.dataset.armed = '';
    btn.textContent = original;
  }, 3000);
  return false;
}

function formatQty(n: number): string {
  if (n >= 100000) return `${Math.floor(n / 1000)}K`;
  return String(n);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
