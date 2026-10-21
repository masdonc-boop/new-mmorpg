export interface ControlHandlers {
  tap(x: number, y: number): void;
  joystick(x: number, y: number): void;
  zoom(factor: number): void;
  rotate(delta: number): void;
  key?(key: string): void;
}

const TAP_SLOP = 12;
const JOY_RADIUS = 56;

/**
 * Unified touch / mouse / keyboard input.
 * - Left part of the screen: floating virtual joystick (drag) or tap.
 * - Elsewhere: tap to move / interact; drag rotates (if enabled); pinch zooms.
 */
export class Controls {
  rotationEnabled = false;
  private joyBase: HTMLDivElement;
  private joyKnob: HTMLDivElement;
  private joyId: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private joyActive = false;
  private touches = new Map<number, { x: number; y: number; sx: number; sy: number; t: number; moved: boolean }>();
  private pinchDist = 0;
  private pinchAngle = 0;
  private keys = new Set<string>();
  private mouseDown: { x: number; y: number; moved: boolean; button: number } | null = null;

  constructor(private surface: HTMLElement, private h: ControlHandlers) {
    this.joyBase = document.createElement('div');
    this.joyBase.className = 'joy-base idle';
    this.joyKnob = document.createElement('div');
    this.joyKnob.className = 'joy-knob';
    this.joyBase.appendChild(this.joyKnob);
    surface.appendChild(this.joyBase);
    this.resetJoyVisual();

    surface.addEventListener('touchstart', this.onTouchStart, { passive: false });
    surface.addEventListener('touchmove', this.onTouchMove, { passive: false });
    surface.addEventListener('touchend', this.onTouchEnd, { passive: false });
    surface.addEventListener('touchcancel', this.onTouchEnd, { passive: false });
    surface.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    surface.addEventListener('wheel', this.onWheel, { passive: false });
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.emitKeyboardJoystick();
    });
  }

  private inJoyZone(x: number, y: number) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    return x < w * 0.45 && y > h * 0.35;
  }

  private resetJoyVisual() {
    const h = window.innerHeight;
    this.joyBase.classList.add('idle');
    this.joyBase.style.left = `${86}px`;
    this.joyBase.style.top = `${h - 120}px`;
    this.joyKnob.style.transform = 'translate(-50%, -50%)';
  }

  private onTouchStart = (ev: TouchEvent) => {
    ev.preventDefault();
    for (const t of Array.from(ev.changedTouches)) {
      this.touches.set(t.identifier, { x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY, t: performance.now(), moved: false });
      if (this.joyId === null && this.inJoyZone(t.clientX, t.clientY) && this.touches.size === 1) {
        this.joyId = t.identifier;
        this.joyOrigin = { x: t.clientX, y: t.clientY };
        this.joyActive = false;
      }
    }
    if (this.touches.size === 2 && this.joyId === null) this.startPinch();
  };

  private startPinch() {
    const [a, b] = Array.from(this.touches.values());
    this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    this.pinchAngle = Math.atan2(b.y - a.y, b.x - a.x);
  }

  private onTouchMove = (ev: TouchEvent) => {
    ev.preventDefault();
    for (const t of Array.from(ev.changedTouches)) {
      const s = this.touches.get(t.identifier);
      if (!s) continue;
      const dx = t.clientX - s.x;
      s.x = t.clientX;
      s.y = t.clientY;
      if (Math.hypot(s.x - s.sx, s.y - s.sy) > TAP_SLOP) s.moved = true;
      if (t.identifier === this.joyId) {
        if (s.moved && !this.joyActive) {
          this.joyActive = true;
          this.joyBase.classList.remove('idle');
          this.joyBase.style.left = `${this.joyOrigin.x}px`;
          this.joyBase.style.top = `${this.joyOrigin.y}px`;
        }
        if (this.joyActive) this.updateJoy(s.x, s.y);
      } else if (this.touches.size === 1 && this.joyId === null && this.rotationEnabled && s.moved) {
        this.h.rotate(-dx * 0.008);
      }
    }
    // Pinch (ignoring the joystick finger).
    const others = Array.from(this.touches.entries()).filter(([id]) => id !== this.joyId);
    if (others.length === 2 && this.pinchDist > 0) {
      const [a, b] = others.map(([, v]) => v);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (d > 0) this.h.zoom(this.pinchDist / d);
      if (this.rotationEnabled) {
        let da = ang - this.pinchAngle;
        if (da > Math.PI) da -= Math.PI * 2;
        if (da < -Math.PI) da += Math.PI * 2;
        this.h.rotate(da);
      }
      this.pinchDist = d;
      this.pinchAngle = ang;
      a.moved = b.moved = true;
    } else if (others.length === 2) {
      const [a, b] = others.map(([, v]) => v);
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinchAngle = Math.atan2(b.y - a.y, b.x - a.x);
    }
  };

  private updateJoy(x: number, y: number) {
    let dx = x - this.joyOrigin.x;
    let dy = y - this.joyOrigin.y;
    const d = Math.hypot(dx, dy);
    if (d > JOY_RADIUS) {
      // Let the base trail the finger so direction changes stay responsive.
      const pull = d - JOY_RADIUS;
      this.joyOrigin.x += (dx / d) * pull;
      this.joyOrigin.y += (dy / d) * pull;
      this.joyBase.style.left = `${this.joyOrigin.x}px`;
      this.joyBase.style.top = `${this.joyOrigin.y}px`;
      dx = (dx / d) * JOY_RADIUS;
      dy = (dy / d) * JOY_RADIUS;
    }
    this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    this.h.joystick(dx / JOY_RADIUS, dy / JOY_RADIUS);
  }

  private onTouchEnd = (ev: TouchEvent) => {
    ev.preventDefault();
    for (const t of Array.from(ev.changedTouches)) {
      const s = this.touches.get(t.identifier);
      this.touches.delete(t.identifier);
      if (t.identifier === this.joyId) {
        this.joyId = null;
        if (this.joyActive) {
          this.joyActive = false;
          this.h.joystick(0, 0);
        } else if (s && !s.moved) {
          this.h.tap(s.sx, s.sy);
        }
        this.resetJoyVisual();
        continue;
      }
      const othersDown = Array.from(this.touches.keys()).filter((id) => id !== this.joyId).length;
      if (s && !s.moved && performance.now() - s.t < 600 && othersDown === 0 && this.pinchDist === 0) this.h.tap(s.sx, s.sy);
    }
    if (this.touches.size < 2) this.pinchDist = 0;
    if (this.touches.size === 2 && this.joyId === null) this.startPinch();
  };

  private onMouseDown = (ev: MouseEvent) => {
    this.mouseDown = { x: ev.clientX, y: ev.clientY, moved: false, button: ev.button };
  };

  private onMouseMove = (ev: MouseEvent) => {
    const m = this.mouseDown;
    if (!m) return;
    const dx = ev.clientX - m.x;
    if (Math.abs(dx) + Math.abs(ev.clientY - m.y) > 4) m.moved = true;
    if (m.moved && this.rotationEnabled && (m.button === 2 || m.button === 1)) this.h.rotate(-dx * 0.008);
    m.x = ev.clientX;
    m.y = ev.clientY;
  };

  private onMouseUp = (ev: MouseEvent) => {
    const m = this.mouseDown;
    this.mouseDown = null;
    if (m && !m.moved && m.button === 0 && ev.target instanceof Node && this.surface.contains(ev.target)) this.h.tap(ev.clientX, ev.clientY);
  };

  private onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    this.h.zoom(Math.exp(ev.deltaY * 0.0012));
  };

  private onKeyDown = (ev: KeyboardEvent) => {
    if (ev.target instanceof HTMLInputElement) return;
    const k = ev.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      this.keys.add(k);
      this.emitKeyboardJoystick();
      ev.preventDefault();
      return;
    }
    if (k === 'q' && this.rotationEnabled) this.h.rotate(0.25);
    else if (k === 'e' && this.rotationEnabled) this.h.rotate(-0.25);
    else if (k === '=' || k === '+') this.h.zoom(0.9);
    else if (k === '-') this.h.zoom(1.1);
    this.h.key?.(k);
  };

  private onKeyUp = (ev: KeyboardEvent) => {
    const k = ev.key.toLowerCase();
    if (this.keys.delete(k)) this.emitKeyboardJoystick();
  };

  private emitKeyboardJoystick() {
    let x = 0;
    let y = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) y -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) y += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
    const m = Math.hypot(x, y) || 1;
    this.h.joystick(x / m, y / m);
  }
}
