/** DOM overlay anchored to world positions: nameplates, health bars, damage numbers and floating text. */
export interface Anchor {
  x: number;
  y: number;
  visible: boolean;
}

interface Floater {
  el: HTMLDivElement;
  age: number;
  life: number;
  anchor: () => Anchor | null;
  rise: number;
  dx: number;
}

export class WorldOverlay {
  readonly root: HTMLDivElement;
  private plates = new Map<number, { el: HTMLDivElement; bar: HTMLDivElement | null; fill: HTMLDivElement | null; name: HTMLDivElement; marker: HTMLDivElement | null }>();
  private floaters: Floater[] = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'world-overlay';
    parent.appendChild(this.root);
  }

  /** Create or update a nameplate. Pass hp=null to hide the bar. */
  plate(id: number, a: Anchor | null, opts: { name: string; level?: number; hp?: number | null; maxHp?: number; kind: 'enemy' | 'npc' | 'player'; marker?: string | null; show: boolean; hostile?: boolean }) {
    let p = this.plates.get(id);
    if (!p) {
      const el = document.createElement('div');
      el.className = `plate plate-${opts.kind}`;
      const name = document.createElement('div');
      name.className = 'plate-name';
      el.appendChild(name);
      let bar: HTMLDivElement | null = null;
      let fill: HTMLDivElement | null = null;
      if (opts.kind !== 'npc') {
        bar = document.createElement('div');
        bar.className = 'plate-bar';
        fill = document.createElement('div');
        fill.className = 'plate-fill';
        bar.appendChild(fill);
        el.appendChild(bar);
      }
      let marker: HTMLDivElement | null = null;
      if (opts.kind === 'npc') {
        marker = document.createElement('div');
        marker.className = 'plate-marker';
        el.insertBefore(marker, name);
      }
      this.root.appendChild(el);
      p = { el, bar, fill, name, marker };
      this.plates.set(id, p);
    }
    if (!a || !a.visible || !opts.show) {
      p.el.style.display = 'none';
      return;
    }
    p.el.style.display = '';
    p.el.style.transform = `translate(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px) translate(-50%, -100%)`;
    const label = opts.level !== undefined ? `${opts.name} <span class="lvl">Lv ${opts.level}</span>` : opts.name;
    if (p.name.innerHTML !== label) p.name.innerHTML = label;
    if (p.bar && p.fill) {
      const showBar = opts.hp !== null && opts.hp !== undefined;
      p.bar.style.display = showBar ? '' : 'none';
      if (showBar) p.fill.style.width = `${Math.max(0, Math.min(100, (opts.hp! / (opts.maxHp || 1)) * 100))}%`;
    }
    if (p.marker) {
      const m = opts.marker ?? '';
      if (p.marker.dataset.m !== m) {
        p.marker.dataset.m = m;
        p.marker.className = `plate-marker ${m}`;
        p.marker.textContent = m === 'available' ? '!' : m === 'ready' ? '?' : m === 'progress' ? '?' : '';
      }
    }
  }

  removePlate(id: number) {
    const p = this.plates.get(id);
    if (!p) return;
    p.el.remove();
    this.plates.delete(id);
  }

  float(text: string, cls: string, anchor: () => Anchor | null, life = 1.1, rise = 50, drift = true) {
    const el = document.createElement('div');
    el.className = `floater ${cls}`;
    el.textContent = text;
    this.root.appendChild(el);
    this.floaters.push({ el, age: 0, life, anchor, rise, dx: drift ? (Math.random() - 0.5) * 30 : 0 });
  }

  update(dt: number) {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.age += dt;
      const a = f.anchor();
      if (f.age >= f.life || !a) {
        f.el.remove();
        this.floaters.splice(i, 1);
        continue;
      }
      const k = f.age / f.life;
      const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.6 : 1.2 - Math.min(0.2, (k - 0.15) * 0.5);
      f.el.style.display = a.visible ? '' : 'none';
      f.el.style.transform = `translate(${(a.x + f.dx * k).toFixed(1)}px, ${(a.y - f.rise * Math.sqrt(k)).toFixed(1)}px) translate(-50%, -50%) scale(${pop.toFixed(2)})`;
      f.el.style.opacity = String(k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1);
    }
  }
}
