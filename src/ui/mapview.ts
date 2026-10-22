/** Pan / zoom state for the world map: content (a square of `base` px at scale 1) translated by (x, y) inside a viewport. */
export interface MapView {
  scale: number;
  x: number;
  y: number;
}

export const MAP_MIN_SCALE = 1;
export const MAP_MAX_SCALE = 5;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function clampAxis(t: number, content: number, viewport: number): number {
  // Smaller than the viewport: keep centred. Larger: never show empty space past an edge.
  if (content <= viewport) return (viewport - content) / 2;
  return clamp(t, viewport - content, 0);
}

/** Clamp scale and translation so the map always stays within (or centred in) the viewport. */
export function clampView(v: MapView, base: number, vw: number, vh: number): MapView {
  const scale = clamp(v.scale, MAP_MIN_SCALE, MAP_MAX_SCALE);
  const c = base * scale;
  return { scale, x: clampAxis(v.x, c, vw), y: clampAxis(v.y, c, vh) };
}

/** The whole map, centred. */
export function fitView(base: number, vw: number, vh: number): MapView {
  return clampView({ scale: 1, x: 0, y: 0 }, base, vw, vh);
}

/** Zoom by `factor` keeping the viewport point (px, py) fixed over the same map spot. */
export function zoomAt(v: MapView, factor: number, px: number, py: number, base: number, vw: number, vh: number): MapView {
  const scale = clamp(v.scale * factor, MAP_MIN_SCALE, MAP_MAX_SCALE);
  const mx = (px - v.x) / v.scale;
  const my = (py - v.y) / v.scale;
  return clampView({ scale, x: px - mx * scale, y: py - my * scale }, base, vw, vh);
}

export function panBy(v: MapView, dx: number, dy: number, base: number, vw: number, vh: number): MapView {
  return clampView({ scale: v.scale, x: v.x + dx, y: v.y + dy }, base, vw, vh);
}

/** Centre the viewport on a point given as a fraction (0..1) of the map. */
export function centerOn(fx: number, fy: number, scale: number, base: number, vw: number, vh: number): MapView {
  const s = clamp(scale, MAP_MIN_SCALE, MAP_MAX_SCALE);
  return clampView({ scale: s, x: vw / 2 - fx * base * s, y: vh / 2 - fy * base * s }, base, vw, vh);
}

/**
 * Touch/mouse driven map viewer: one-finger drag pans, two-finger pinch zooms around the
 * fingers, double-tap zooms in, mouse wheel zooms. Uses Pointer Events with
 * `touch-action: none` on the viewport so the browser never scrolls or zooms the page instead.
 */
export class MapViewer {
  view: MapView = { scale: 1, x: 0, y: 0 };
  private base = 1;
  private pointers = new Map<number, { x: number; y: number }>();
  private lastTap = { t: 0, x: 0, y: 0 };
  private downAt = { t: 0, x: 0, y: 0, moved: false };
  private ro: ResizeObserver | null = null;

  constructor(
    readonly viewport: HTMLElement,
    private stage: HTMLElement,
    private labels: HTMLElement[],
    private focus: () => { fx: number; fy: number },
  ) {
    viewport.addEventListener('pointerdown', this.onDown);
    viewport.addEventListener('pointermove', this.onMove);
    viewport.addEventListener('pointerup', this.onUp);
    viewport.addEventListener('pointercancel', this.onUp);
    viewport.addEventListener('lostpointercapture', this.onUp);
    viewport.addEventListener('wheel', this.onWheel, { passive: false });
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.layout(false));
      this.ro.observe(viewport);
    }
    this.layout(true);
  }

  private size() {
    return { vw: this.viewport.clientWidth || 1, vh: this.viewport.clientHeight || 1 };
  }

  /** Recompute the fitted size; keeps the current zoom unless `reset`. */
  layout(reset: boolean) {
    const { vw, vh } = this.size();
    const oldBase = this.base;
    this.base = Math.max(1, Math.min(vw, vh));
    this.stage.style.width = this.stage.style.height = `${this.base}px`;
    if (reset) this.view = fitView(this.base, vw, vh);
    else {
      const k = this.base / oldBase;
      this.view = clampView({ scale: this.view.scale, x: this.view.x * k, y: this.view.y * k }, this.base, vw, vh);
    }
    this.apply();
  }

  reset() {
    const { vw, vh } = this.size();
    this.view = fitView(this.base, vw, vh);
    this.apply();
  }

  zoom(factor: number) {
    const { vw, vh } = this.size();
    this.view = zoomAt(this.view, factor, vw / 2, vh / 2, this.base, vw, vh);
    this.apply();
  }

  centerOnFocus(scale = 2.5) {
    const { vw, vh } = this.size();
    const f = this.focus();
    this.view = centerOn(f.fx, f.fy, Math.max(scale, this.view.scale), this.base, vw, vh);
    this.apply();
  }

  dispose() {
    this.ro?.disconnect();
  }

  private apply() {
    const v = this.view;
    this.stage.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.scale})`;
    // Keep labels a constant on-screen size while the map scales.
    const inv = 1 / v.scale;
    for (const l of this.labels) l.style.transform = `translate(-50%, -50%) scale(${inv})`;
    this.viewport.dataset.scale = v.scale.toFixed(2);
    this.declutter();
  }

  /** Hides labels that would overlap a more important one (bigger regions win); zooming in reveals them. */
  private declutter() {
    const order = [...this.labels].sort((a, b) => Number(b.dataset.priority ?? 0) - Number(a.dataset.priority ?? 0));
    const rects = order.map((l) => l.getBoundingClientRect());
    const shown: DOMRect[] = [];
    order.forEach((l, i) => {
      const r = rects[i];
      const clash = shown.some((o) => r.left < o.right && r.right > o.left && r.top < o.bottom && r.bottom > o.top);
      l.style.visibility = clash ? 'hidden' : '';
      if (!clash) shown.push(r);
    });
  }

  private local(e: PointerEvent | WheelEvent) {
    const r = this.viewport.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown = (e: PointerEvent) => {
    // Overlay buttons (zoom, reset) keep normal click behaviour.
    if (e.target instanceof Element && e.target.closest('button')) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      this.viewport.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events in tests have no active pointer */
    }
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 1) this.downAt = { t: performance.now(), x: p.x, y: p.y, moved: false };
    else this.downAt.moved = true;
  };

  private onMove = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    e.preventDefault();
    const p = this.local(e);
    const { vw, vh } = this.size();
    if (Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) > 8) this.downAt.moved = true;
    if (this.pointers.size === 1) {
      this.view = panBy(this.view, p.x - prev.x, p.y - prev.y, this.base, vw, vh);
      this.pointers.set(e.pointerId, p);
    } else if (this.pointers.size >= 2) {
      const [idA, idB] = Array.from(this.pointers.keys());
      const a0 = this.pointers.get(idA)!;
      const b0 = this.pointers.get(idB)!;
      this.pointers.set(e.pointerId, p);
      const a1 = this.pointers.get(idA)!;
      const b1 = this.pointers.get(idB)!;
      const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y);
      const d1 = Math.hypot(a1.x - b1.x, a1.y - b1.y);
      const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
      const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
      let v = panBy(this.view, m1.x - m0.x, m1.y - m0.y, this.base, vw, vh);
      if (d0 > 0 && d1 > 0) v = zoomAt(v, d1 / d0, m1.x, m1.y, this.base, vw, vh);
      this.view = v;
    }
    this.apply();
  };

  private onUp = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (e.type !== 'pointerup' || this.pointers.size > 0 || this.downAt.moved) return;
    // Double-tap to zoom in.
    const now = performance.now();
    const p = this.local(e);
    if (now - this.lastTap.t < 320 && Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) < 30) {
      const { vw, vh } = this.size();
      this.view = zoomAt(this.view, 2, p.x, p.y, this.base, vw, vh);
      this.apply();
      this.lastTap.t = 0;
    } else this.lastTap = { t: now, x: p.x, y: p.y };
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const p = this.local(e);
    const { vw, vh } = this.size();
    this.view = zoomAt(this.view, Math.exp(-e.deltaY * 0.0015), p.x, p.y, this.base, vw, vh);
    this.apply();
  };
}
