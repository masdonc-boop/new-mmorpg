// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { MAP_MAX_SCALE, MAP_MIN_SCALE, MapViewer, centerOn, clampView, fitView, panBy, zoomAt } from '../src/ui/mapview';

const BASE = 300;
const VW = 300;
const VH = 420;

describe('World map view math', () => {
  it('fits the whole map centred at scale 1', () => {
    const v = fitView(BASE, VW, VH);
    expect(v).toEqual({ scale: 1, x: 0, y: 60 });
  });

  it('clamps scale between the limits', () => {
    expect(zoomAt(fitView(BASE, VW, VH), 0.1, 150, 150, BASE, VW, VH).scale).toBe(MAP_MIN_SCALE);
    expect(zoomAt(fitView(BASE, VW, VH), 100, 150, 150, BASE, VW, VH).scale).toBe(MAP_MAX_SCALE);
  });

  it('keeps the point under the fingers fixed while zooming', () => {
    const v0 = fitView(BASE, VW, VH);
    const px = 120;
    const py = 200;
    const mx = (px - v0.x) / v0.scale;
    const my = (py - v0.y) / v0.scale;
    const v1 = zoomAt(v0, 2, px, py, BASE, VW, VH);
    expect(v1.x + mx * v1.scale).toBeCloseTo(px);
    expect(v1.y + my * v1.scale).toBeCloseTo(py);
  });

  it('never pans past the map edges', () => {
    const zoomed = zoomAt(fitView(BASE, VW, VH), 3, 150, 210, BASE, VW, VH);
    const farLeft = panBy(zoomed, 10_000, 10_000, BASE, VW, VH);
    expect(farLeft.x).toBe(0);
    expect(farLeft.y).toBe(0);
    const farRight = panBy(zoomed, -10_000, -10_000, BASE, VW, VH);
    expect(farRight.x).toBe(VW - BASE * 3);
    expect(farRight.y).toBe(VH - BASE * 3);
  });

  it('keeps a smaller-than-viewport axis centred', () => {
    const v = clampView({ scale: 1, x: -50, y: 999 }, BASE, VW, VH);
    expect(v.y).toBe(60);
  });

  it('centres on a map point when there is room', () => {
    const v = centerOn(0.5, 0.5, 2, BASE, VW, VH);
    expect(v.x + 0.5 * BASE * 2).toBeCloseTo(VW / 2);
    expect(v.y + 0.5 * BASE * 2).toBeCloseTo(VH / 2);
  });
});

function pointer(type: string, id: number, x: number, y: number, target: Element) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { pointerId: id, clientX: x, clientY: y });
  target.dispatchEvent(e);
  return e;
}

function makeViewer() {
  document.body.innerHTML = '';
  const viewport = document.createElement('div');
  Object.defineProperty(viewport, 'clientWidth', { value: VW });
  Object.defineProperty(viewport, 'clientHeight', { value: VH });
  const stage = document.createElement('div');
  const label = document.createElement('div');
  stage.appendChild(label);
  viewport.appendChild(stage);
  const btn = document.createElement('button');
  viewport.appendChild(btn);
  document.body.appendChild(viewport);
  const viewer = new MapViewer(viewport, stage, [label], () => ({ fx: 0.25, fy: 0.25 }));
  return { viewer, viewport, stage, label, btn };
}

describe('World map gestures', () => {
  it('pinch zooms in and drag pans, staying in bounds', () => {
    const { viewer, viewport, stage, label } = makeViewer();
    expect(viewer.view.scale).toBe(1);
    pointer('pointerdown', 1, 100, 200, viewport);
    pointer('pointerdown', 2, 200, 200, viewport);
    pointer('pointermove', 2, 300, 200, viewport);
    expect(viewer.view.scale).toBeGreaterThan(1.5);
    pointer('pointerup', 2, 300, 200, viewport);
    const before = viewer.view.x;
    pointer('pointermove', 1, 160, 200, viewport);
    expect(viewer.view.x).not.toBe(before);
    expect(viewer.view.x).toBeLessThanOrEqual(0);
    pointer('pointerup', 1, 160, 200, viewport);
    expect(stage.style.transform).toContain(`scale(${viewer.view.scale})`);
    // Labels counter-scale so they stay readable.
    expect(label.style.transform).toContain(`scale(${1 / viewer.view.scale})`);
  });

  it('double-tap zooms in', () => {
    const { viewer, viewport } = makeViewer();
    for (let i = 0; i < 2; i++) {
      pointer('pointerdown', 1, 150, 210, viewport);
      pointer('pointerup', 1, 150, 210, viewport);
    }
    expect(viewer.view.scale).toBe(2);
  });

  it('reset and zoom controls work, and button presses are not captured as pans', () => {
    const { viewer, btn } = makeViewer();
    const down = pointer('pointerdown', 7, 10, 10, btn);
    expect(down.defaultPrevented).toBe(false);
    viewer.zoom(2);
    expect(viewer.view.scale).toBe(2);
    viewer.centerOnFocus();
    expect(viewer.view.scale).toBeGreaterThanOrEqual(2.5);
    viewer.reset();
    expect(viewer.view).toEqual(fitView(BASE, VW, VH));
  });

  it('stops map gestures from reaching the game underneath', () => {
    const { viewport } = makeViewer();
    let reached = false;
    document.body.addEventListener('pointerdown', () => (reached = true));
    pointer('pointerdown', 1, 100, 100, viewport);
    expect(reached).toBe(false);
  });
});
