/**
 * Mobile smoke test of the single-player game (docs/MULTIPLAYER.md 3B.6): an Android-sized touch
 * screen, real touch events, no server. Run against a build served by `npx vite preview`:
 *
 *   npx vite build && npx vite preview --port 4173 &
 *   node tools/mobile-smoke.cjs [http://localhost:4173] [screenshot folder]
 *
 * Needs Playwright with Chromium installed (globally or in the project).
 */
const path = require('path');
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
}
const base = process.argv[2] || 'http://localhost:4173';
const shots = process.argv[3] || null;
const fixture = require(path.join(__dirname, '..', 'tests', 'fixtures', 'saves', 'p2-midgame.json'));

(async () => {
  const browser = await playwright.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  };
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' });
  const page = await ctx.newPage();
  const errors = [];
  const sockets = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('websocket', (ws) => sockets.push(ws.url()));
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('smoke-started')) {
      localStorage.clear();
      sessionStorage.setItem('smoke-started', '1');
    }
  });
  await page.goto(`${base}/?autostart`);
  await page.waitForFunction(() => window.game && window.game.world, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const state = () => page.evaluate(() => { const p = window.game.world.player; return { x: p.x, z: p.z, action: p.action && p.action.type, net: !!window.game.net, offstage: window.game.world.offstage.size, players: window.game.world.players.size }; });
  const s0 = await state();
  check('offline: no server connection is made', !s0.net && sockets.length === 0, `${sockets.length} sockets`);
  check('offline: one player, nothing hidden as "offstage"', s0.players === 1 && s0.offstage === 0);

  // Touch joystick: a finger down on the lower left, dragged right, held, released.
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  await touch('touchStart', 90, 760);
  for (let i = 1; i <= 6; i++) {
    await touch('touchMove', 90 + i * 10, 760);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(900);
  await touch('touchEnd', 150, 760);
  const s1 = await state();
  const moved = Math.hypot(s1.x - s0.x, s1.z - s0.z);
  check('touch joystick moves the hero', moved > 1, `${moved.toFixed(2)} tiles`);
  if (shots) await page.screenshot({ path: path.join(shots, 'smoke-joystick.png') });

  // Tap a tree: the hero walks over and starts chopping. (The hero is first stood a few steps
  // from one, so a tree is on screen whatever the joystick did.)
  await page.evaluate(() => {
    const w = window.game.world;
    const t = w.nodes.find((n) => n.def.id === 'tree' && !n.depleted && Math.hypot(n.x - w.map.spawn.x, n.z - w.map.spawn.z) < 25);
    const spot = [[3, 0], [-3, 0], [0, 3], [0, -3]].map(([dx, dz]) => ({ x: t.x + dx, z: t.z + dz })).find((q) => !w.map.blocked[Math.floor(q.z) * w.map.width + Math.floor(q.x)]);
    w.player.x = w.player.prevX = spot.x;
    w.player.z = w.player.prevZ = spot.z;
  });
  // Let the camera finish gliding to the hero before working out where the tree is on screen.
  await page.waitForTimeout(2500);
  const tree = await page.evaluate(() => {
    const w = window.game.world;
    const p = w.player;
    const r = window.game.renderer;
    const rect = document.querySelector('canvas').getBoundingClientRect();
    // The nearest tree that is on screen, clear of the HUD at the top and bottom.
    const t = w.nodes
      .filter((n) => n.def.id === 'tree' && !n.depleted)
      .map((n) => ({ n, a: r.project(n.x, 1.2, n.z) }))
      .filter(({ a }) => a.visible && a.x > 40 && a.x < rect.width - 40 && a.y > 220 && a.y < rect.height - 260)
      .sort((a, b) => Math.hypot(a.n.x - p.x, a.n.z - p.z) - Math.hypot(b.n.x - p.x, b.n.z - p.z))[0];
    return { id: t.n.id, x: t.a.x + rect.left, y: t.a.y + rect.top };
  });
  const hit = await page.evaluate(([x, y]) => JSON.stringify(window.game.renderer.pick(x, y)), [tree.x, tree.y]);
  await touch('touchStart', tree.x, tree.y);
  await page.waitForTimeout(60);
  await touch('touchEnd', tree.x, tree.y);
  await page.waitForTimeout(2500);
  const s2 = await state();
  // (A tree can fall after the first log, which ends the gathering: a log or xp counts too.)
  const chopped = await page.evaluate(() => window.game.world.player.skills.xp.woodcutting > 0);
  check('tapping a tree starts gathering', s2.action === 'gather' || chopped, `action ${s2.action}, chopped ${chopped}; tree ${tree.id}, picked ${hit}`);

  // The Bag button opens the inventory.
  await page.tap('.menu-btn[data-panel="inventory"]');
  await page.waitForTimeout(300);
  check('the Bag opens', await page.locator('.panel:not(.hidden)').count() === 1);
  if (shots) await page.screenshot({ path: path.join(shots, 'smoke-bag.png') });
  await page.tap('.panel-close');

  // Saving and coming back: the same place.
  const before = await state();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.reload();
  await page.waitForFunction(() => window.game && window.game.world, null, { timeout: 30000 });
  const after = await state();
  check('the game saves and loads on this device', Math.hypot(after.x - before.x, after.z - before.z) < 1.5, `${after.x.toFixed(1)},${after.z.toFixed(1)} vs ${before.x.toFixed(1)},${before.z.toFixed(1)}`);

  // Eastreach (Phase 4A): tap a willow in Mirefen and the ground beside it, then save and reload there.
  await page.evaluate(() => {
    const w = window.game.world;
    const t = w.nodes.find((n) => n.def.id === 'willow' && !n.depleted);
    const spot = [[3, 0], [-3, 0], [0, 3], [0, -3]].map(([dx, dz]) => ({ x: t.x + dx, z: t.z + dz })).find((q) => !w.map.blocked[Math.floor(q.z) * w.map.width + Math.floor(q.x)]);
    w.player.x = w.player.prevX = spot.x;
    w.player.z = w.player.prevZ = spot.z;
    w.player.skills.addXp('woodcutting', 20000);
  });
  await page.waitForTimeout(2500);
  const willow = await page.evaluate(() => {
    const w = window.game.world;
    const p = w.player;
    const r = window.game.renderer;
    const rect = document.querySelector('canvas').getBoundingClientRect();
    const t = w.nodes
      .filter((n) => n.def.id === 'willow' && !n.depleted)
      .map((n) => ({ n, a: r.project(n.x, 1.6, n.z) }))
      .filter(({ a }) => a.visible && a.x > 40 && a.x < rect.width - 40 && a.y > 220 && a.y < rect.height - 260)
      .sort((a, b) => Math.hypot(a.n.x - p.x, a.n.z - p.z) - Math.hypot(b.n.x - p.x, b.n.z - p.z))[0];
    return t ? { id: t.n.id, x: t.a.x + rect.left, y: t.a.y + rect.top, xp: p.skills.xp.woodcutting } : null;
  });
  if (willow) {
    await touch('touchStart', willow.x, willow.y);
    await page.waitForTimeout(60);
    await touch('touchEnd', willow.x, willow.y);
    await page.waitForTimeout(3500);
  }
  const cut = await page.evaluate(() => ({ action: window.game.world.player.action && window.game.world.player.action.type, xp: window.game.world.player.skills.xp.woodcutting }));
  check('Eastreach: tapping a willow in Mirefen starts gathering', !!willow && (cut.action === 'gather' || cut.xp > willow.xp), JSON.stringify({ willow, cut }));
  if (shots) await page.screenshot({ path: path.join(shots, 'smoke-willow.png') });
  const ground = await page.evaluate(() => {
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return { x: rect.left + rect.width * 0.5 + 60, y: rect.top + rect.height * 0.5 + 40 };
  });
  const g0 = await state();
  await touch('touchStart', ground.x, ground.y);
  await page.waitForTimeout(60);
  await touch('touchEnd', ground.x, ground.y);
  // Wait for the outcome rather than a fixed time: on a slow machine the game's clock runs slower
  // than the wall clock (the simulation caps its catch-up per frame).
  await page
    .waitForFunction(([x, z]) => { const p = window.game.world.player; return Math.hypot(p.x - x, p.z - z) > 0.5; }, [g0.x, g0.z], { timeout: 15000 })
    .catch(() => {});
  const g1 = await state();
  check('Eastreach: tapping the ground walks there (chunked terrain picks)', Math.hypot(g1.x - g0.x, g1.z - g0.z) > 0.5, `${g0.x.toFixed(1)},${g0.z.toFixed(1)} -> ${g1.x.toFixed(1)},${g1.z.toFixed(1)}`);
  const eBefore = await state();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.reload();
  await page.waitForFunction(() => window.game && window.game.world, null, { timeout: 30000 });
  const eAfter = await state();
  check('Eastreach: saving and reloading keeps you there', eAfter.x > 112 && Math.hypot(eAfter.x - eBefore.x, eAfter.z - eBefore.z) < 1.5, `${eAfter.x.toFixed(1)},${eAfter.z.toFixed(1)} vs ${eBefore.x.toFixed(1)},${eBefore.z.toFixed(1)}`);

  // An older save (before multiplayer) still loads.
  const old = await ctx.newPage();
  old.on('pageerror', (e) => errors.push(e.message));
  await old.addInitScript((save) => localStorage.setItem('brightwater.save.v1', JSON.stringify(save)), fixture);
  await old.goto(base);
  await old.waitForFunction(() => window.game && window.game.world, null, { timeout: 30000 });
  const oldState = await old.evaluate(() => ({ ranged: window.game.world.player.skills.level('ranged'), chair: window.game.world.player.furniture.chair }));
  check('a save from before multiplayer still loads', oldState.ranged > 1 && oldState.chair === 'crude_chair', JSON.stringify(oldState));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `${failed} check(s) failed` : 'All checks passed.');
  process.exit(failed ? 1 : 0);
})();
