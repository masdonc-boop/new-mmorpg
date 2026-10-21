// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Controls } from '../src/input/controls';
import { clearKeepingScroll } from '../src/ui/dom';
import css from '../src/ui/styles.css?raw';

type TouchSpec = { id: number; x: number; y: number; target: Element };

function touchEvent(type: string, changed: TouchSpec[], dispatchOn: Element): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const list = changed.map((t) => ({ identifier: t.id, clientX: t.x, clientY: t.y, target: t.target }));
  Object.defineProperty(e, 'changedTouches', { value: list });
  dispatchOn.dispatchEvent(e);
  return e;
}

function setup() {
  document.body.innerHTML = '';
  const app = document.createElement('div');
  const canvas = document.createElement('canvas');
  const hud = document.createElement('div');
  const panelBody = document.createElement('div');
  panelBody.className = 'panel-body';
  const slot = document.createElement('button');
  panelBody.appendChild(slot);
  hud.appendChild(panelBody);
  app.append(canvas, hud);
  document.body.appendChild(app);
  const h = { tap: vi.fn(), joystick: vi.fn(), zoom: vi.fn(), rotate: vi.fn() };
  const controls = new Controls(app, h, (t) => t === canvas);
  return { app, canvas, panelBody, slot, h, controls };
}

describe('Touch input ownership (panels vs world)', () => {
  // jsdom window is 1024x768; the joystick zone is the lower-left area.
  let env: ReturnType<typeof setup>;
  beforeEach(() => {
    env = setup();
  });

  it('lets a panel scroll gesture through untouched, even inside the joystick zone', () => {
    const { slot, h } = env;
    const start = touchEvent('touchstart', [{ id: 1, x: 100, y: 600, target: slot }], slot);
    const move1 = touchEvent('touchmove', [{ id: 1, x: 100, y: 520, target: slot }], slot);
    const move2 = touchEvent('touchmove', [{ id: 1, x: 100, y: 400, target: slot }], slot);
    const end = touchEvent('touchend', [{ id: 1, x: 100, y: 400, target: slot }], slot);
    for (const e of [start, move1, move2, end]) expect(e.defaultPrevented).toBe(false);
    expect(h.joystick).not.toHaveBeenCalled();
    expect(h.tap).not.toHaveBeenCalled();
    expect(h.rotate).not.toHaveBeenCalled();
    expect(h.zoom).not.toHaveBeenCalled();
  });

  it('never treats a panel tap as a world tap', () => {
    const { slot, h } = env;
    touchEvent('touchstart', [{ id: 1, x: 800, y: 300, target: slot }], slot);
    touchEvent('touchend', [{ id: 1, x: 800, y: 300, target: slot }], slot);
    expect(h.tap).not.toHaveBeenCalled();
  });

  it('ignores a two-finger pinch on a panel (no camera zoom)', () => {
    const { panelBody, h } = env;
    touchEvent('touchstart', [{ id: 1, x: 600, y: 300, target: panelBody }, { id: 2, x: 700, y: 300, target: panelBody }], panelBody);
    touchEvent('touchmove', [{ id: 1, x: 550, y: 300, target: panelBody }, { id: 2, x: 750, y: 300, target: panelBody }], panelBody);
    touchEvent('touchend', [{ id: 1, x: 550, y: 300, target: panelBody }, { id: 2, x: 750, y: 300, target: panelBody }], panelBody);
    expect(h.zoom).not.toHaveBeenCalled();
  });

  it('keeps the joystick working on the canvas', () => {
    const { canvas, h } = env;
    const start = touchEvent('touchstart', [{ id: 1, x: 100, y: 600, target: canvas }], canvas);
    expect(start.defaultPrevented).toBe(true);
    touchEvent('touchmove', [{ id: 1, x: 100, y: 560, target: canvas }], canvas);
    touchEvent('touchmove', [{ id: 1, x: 100, y: 540, target: canvas }], canvas);
    const last = h.joystick.mock.calls[h.joystick.mock.calls.length - 1];
    expect(last[1]).toBeLessThan(-0.5);
    touchEvent('touchend', [{ id: 1, x: 100, y: 540, target: canvas }], canvas);
    expect(h.joystick).toHaveBeenLastCalledWith(0, 0);
    expect(h.tap).not.toHaveBeenCalled();
  });

  it('keeps tap-to-move working on the canvas', () => {
    const { canvas, h } = env;
    touchEvent('touchstart', [{ id: 3, x: 800, y: 300, target: canvas }], canvas);
    touchEvent('touchend', [{ id: 3, x: 800, y: 300, target: canvas }], canvas);
    expect(h.tap).toHaveBeenCalledWith(800, 300);
  });

  it('keeps pinch-to-zoom working on the canvas', () => {
    const { canvas, h } = env;
    touchEvent('touchstart', [{ id: 1, x: 600, y: 300, target: canvas }], canvas);
    touchEvent('touchstart', [{ id: 2, x: 700, y: 300, target: canvas }], canvas);
    touchEvent('touchmove', [{ id: 2, x: 800, y: 300, target: canvas }], canvas);
    expect(h.zoom).toHaveBeenCalled();
    expect(h.zoom.mock.calls[0][0]).toBeLessThan(1);
  });

  it('does not block a panel scroll made while the joystick is held', () => {
    const { canvas, slot, h } = env;
    touchEvent('touchstart', [{ id: 1, x: 100, y: 600, target: canvas }], canvas);
    touchEvent('touchmove', [{ id: 1, x: 100, y: 560, target: canvas }], canvas);
    touchEvent('touchstart', [{ id: 2, x: 800, y: 500, target: slot }], slot);
    const mixed = touchEvent('touchmove', [{ id: 1, x: 100, y: 550, target: canvas }, { id: 2, x: 800, y: 420, target: slot }], slot);
    expect(mixed.defaultPrevented).toBe(false);
    expect(h.joystick).toHaveBeenCalled();
    const end = touchEvent('touchend', [{ id: 2, x: 800, y: 420, target: slot }], slot);
    expect(end.defaultPrevented).toBe(false);
    expect(h.tap).not.toHaveBeenCalled();
  });

  it('only zooms the camera for wheel events over the world', () => {
    const { canvas, panelBody, h } = env;
    const onPanel = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    panelBody.dispatchEvent(onPanel);
    expect(onPanel.defaultPrevented).toBe(false);
    expect(h.zoom).not.toHaveBeenCalled();
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
    expect(h.zoom).toHaveBeenCalledTimes(1);
  });

  it('only treats mouse clicks on the world as taps', () => {
    const { canvas, slot, h } = env;
    slot.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    slot.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 10, clientY: 10 }));
    expect(h.tap).not.toHaveBeenCalled();
    canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 20, clientY: 30 }));
    canvas.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 20, clientY: 30 }));
    expect(h.tap).toHaveBeenCalledWith(20, 30);
  });
});

describe('Panel re-render keeps scroll position', () => {
  it('restores scrollTop after the content is rebuilt', async () => {
    const body = document.createElement('div');
    document.body.appendChild(body);
    body.innerHTML = '<p>old</p>';
    body.scrollTop = 240;
    clearKeepingScroll(body);
    body.innerHTML = '<p>new</p>';
    body.scrollTop = 0; // what a DOM rebuild does in a real browser
    await Promise.resolve();
    expect(body.scrollTop).toBe(240);
    expect(body.textContent).toBe('new');
  });
});

describe('Panel CSS contract', () => {
  const rule = (selector: string) => {
    const i = css.indexOf(`${selector} {`);
    expect(i, selector).toBeGreaterThanOrEqual(0);
    return css.slice(i, css.indexOf('}', i));
  };

  it('panel bodies scroll vertically and contain overscroll', () => {
    const r = rule('.panel-body');
    expect(r).toMatch(/overflow-y:\s*auto/);
    expect(r).toMatch(/touch-action:\s*pan-y/);
    expect(r).toMatch(/overscroll-behavior:\s*contain/);
    expect(r).toMatch(/min-height:\s*0/);
  });

  it('panel header and close button never shrink away', () => {
    expect(rule('.panel-head')).toMatch(/flex:\s*none/);
    expect(rule('.panel-close')).toMatch(/flex:\s*none/);
  });

  it('the world map owns its gestures', () => {
    expect(rule('.map-view')).toMatch(/touch-action:\s*none/);
  });

  it('the page itself never pans or zooms', () => {
    expect(rule('html,\nbody')).toMatch(/touch-action:\s*none/);
  });
});
