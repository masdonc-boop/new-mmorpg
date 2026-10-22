/**
 * Dungeon performance check (Phase 4D, docs/DUNGEONS.md): runs each boss fight in an Android-sized
 * browser and reports frame times, draw calls and GPU object counts, so changes can be compared and
 * leaks spotted (geometries or materials that keep growing during a fight). A strong test character
 * is kept alive so the archers and acolytes keep shooting.
 *
 *   npx vite build && npx vite preview --port 4173 &
 *   node tools/perf-dungeon.cjs [http://localhost:4173] [seconds per fight]
 *
 * Software rendering (SwiftShader) is far slower than a phone's GPU: compare runs with each other,
 * not with a device. Needs Playwright with Chromium.
 */
const path = require('path');
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
}
const base = process.argv[2] || 'http://localhost:4173';
const seconds = Number(process.argv[3] || 20);

const FIGHTS = [
  { name: 'Shrinekeeper (sanctum)', boss: 'shrinekeeper', at: [61.5, 140.5] },
  { name: 'Watchcaptain (tower roof)', boss: 'watchcaptain', at: [100.5, 140.5] },
];

(async () => {
  const browser = await playwright.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
  const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/?autostart`);
  await page.waitForFunction(() => window.game && window.game.world, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const p = window.game.world.player;
    for (const s of ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic']) p.skills.addXp(s, 3_000_000);
    // Frame times measured here, so any build (with or without the ?perf monitor) can be compared.
    window.__frames = [];
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      window.__frames.push(now - last);
      last = now;
      // Keep the hero standing so the fight (and its missiles) goes on.
      window.game.world.player.hp = window.game.world.player.skills.level('hitpoints');
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  for (const f of FIGHTS) {
    await page.evaluate(([x, z, boss]) => {
      const w = window.game.world;
      const p = w.player;
      p.x = p.prevX = x;
      p.z = p.prevZ = z;
      const b = w.enemies.find((e) => e.def.id === boss);
      // A fresh boss each run, and the hero only defends (the fight must last the whole sample).
      b.hp = b.def.maxHp * 100;
      w.issue({ type: 'interact', target: b.id });
    }, f.at.concat(f.boss));
    await page.waitForTimeout(2500);
    const start = await page.evaluate(() => {
      window.__frames.length = 0;
      const r = window.game.renderer.renderer;
      return { geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs.length, heap: performance.memory ? performance.memory.usedJSHeapSize : 0 };
    });
    const calls = [];
    for (let s = 0; s < seconds; s++) {
      await page.waitForTimeout(1000);
      calls.push(await page.evaluate(() => window.game.renderer.renderer.info.render.calls));
    }
    const end = await page.evaluate(() => {
      const r = window.game.renderer.renderer;
      const fr = window.__frames.slice().sort((a, b) => a - b);
      const avg = fr.reduce((a, b) => a + b, 0) / fr.length;
      let materials = 0;
      const seen = new Set();
      window.game.renderer.scene.traverse((o) => {
        if (!o.material) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (!seen.has(m)) seen.add(m) && materials++;
      });
      return {
        fps: 1000 / avg,
        p95: fr[Math.floor(fr.length * 0.95)],
        worst: fr[fr.length - 1],
        geometries: r.info.memory.geometries,
        textures: r.info.memory.textures,
        programs: r.info.programs.length,
        materials,
        heap: performance.memory ? performance.memory.usedJSHeapSize : 0,
        enemiesNear: window.game.world.enemies.filter((e) => e.alive && Math.hypot(e.x - window.game.world.player.x, e.z - window.game.world.player.z) < 12).length,
      };
    });
    const avgCalls = calls.reduce((a, b) => a + b, 0) / calls.length;
    console.log(
      `${f.name}: ${end.fps.toFixed(1)} fps (p95 ${end.p95.toFixed(0)} ms, worst ${end.worst.toFixed(0)} ms) · ${avgCalls.toFixed(0)} draw calls · geometries ${start.geometries}→${end.geometries} · materials in scene ${end.materials} · programs ${start.programs}→${end.programs} · heap ${(start.heap / 1048576).toFixed(0)}→${(end.heap / 1048576).toFixed(0)} MB · ${end.enemiesNear} creatures near`,
    );
  }
  if (errors.length) console.log('page errors:', errors.slice(0, 3).join(' | '));
  await browser.close();
})();
