import type * as THREE from 'three';

/** What the renderer reports each frame for the performance overlay. */
export interface RenderCounts {
  particles: number;
  projectiles: number;
  /** Creatures animated this frame (near enough to be seen). */
  animated: number;
}

export interface PerfSnapshot {
  fps: number;
  avgMs: number;
  p95Ms: number;
  worstMs: number;
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  heapMb: number | null;
  particles: number;
  projectiles: number;
  animated: number;
}

/**
 * Development-only performance measurements (Phase 4D): frame times over the last few seconds, the
 * renderer's draw calls and live GPU objects, the JS heap where the browser exposes it, and how much
 * the scene is animating. Shown with `?perf` in the address; scripts read `window.game.perf`. It only
 * reads numbers the renderer already keeps, so it costs nothing measurable when hidden.
 */
export class PerfMonitor {
  private frames = new Float32Array(240);
  private n = 0;
  private i = 0;
  private counts: RenderCounts = { particles: 0, projectiles: 0, animated: 0 };

  constructor(private renderer: THREE.WebGLRenderer) {}

  /** Records one frame (its duration in milliseconds) and the renderer's counts after it. */
  frame(ms: number, counts: RenderCounts) {
    this.frames[this.i] = ms;
    this.i = (this.i + 1) % this.frames.length;
    this.n = Math.min(this.n + 1, this.frames.length);
    this.counts = counts;
  }

  /** Clears the frame history (so a measurement starts fresh). */
  reset() {
    this.n = 0;
    this.i = 0;
  }

  snapshot(): PerfSnapshot {
    const list = Array.from(this.frames.subarray(0, this.n)).sort((a, b) => a - b);
    const sum = list.reduce((a, b) => a + b, 0);
    const avg = list.length ? sum / list.length : 0;
    const info = this.renderer.info;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      fps: avg > 0 ? 1000 / avg : 0,
      avgMs: avg,
      p95Ms: list.length ? list[Math.min(list.length - 1, Math.floor(list.length * 0.95))] : 0,
      worstMs: list.length ? list[list.length - 1] : 0,
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      heapMb: mem ? mem.usedJSHeapSize / 1048576 : null,
      ...this.counts,
    };
  }

  /** A compact two-line summary for the overlay. */
  text(): string {
    const s = this.snapshot();
    return `${s.fps.toFixed(0)} fps · avg ${s.avgMs.toFixed(1)} · p95 ${s.p95Ms.toFixed(1)} · worst ${s.worstMs.toFixed(0)} ms\n${s.calls} calls · ${(s.triangles / 1000).toFixed(0)}k tris · ${s.geometries} geo · ${s.textures} tex · ${s.programs} prog${s.heapMb !== null ? ` · ${s.heapMb.toFixed(0)} MB` : ''} · ${s.animated} anim · ${s.particles} fx · ${s.projectiles} shots`;
  }
}
