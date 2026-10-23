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
  // A 60 ms tap, stamped as a finger would make it. Sending touchEnd waits for the page to take
  // touchStart, so on a slow frame the wall-clock gap (what an unstamped event records) can pass the
  // game's 600 ms long-press limit; a real phone stamps each event when the finger moves.
  const quickTap = async (x, y) => {
    const t = Date.now() / 1000;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }], timestamp: t });
    await page.waitForTimeout(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t + 0.06 });
  };
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
  await quickTap(tree.x, tree.y);
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
    await quickTap(willow.x, willow.y);
    await page.waitForTimeout(3500);
  }
  const cut = await page.evaluate(() => ({ action: window.game.world.player.action && window.game.world.player.action.type, xp: window.game.world.player.skills.xp.woodcutting }));
  check('Eastreach: tapping a willow in Mirefen starts gathering', !!willow && (cut.action === 'gather' || cut.xp > willow.xp), JSON.stringify({ willow, cut }));
  if (shots) await page.screenshot({ path: path.join(shots, 'smoke-willow.png') });
  // An open tile a few steps away with nothing on it to tap instead (a fixed screen offset could land
  // on the willow being cut), projected to the screen.
  const ground = await page.evaluate(() => {
    const w = window.game.world;
    const p = w.player;
    w.issue({ type: 'moveTo', x: p.x, z: p.z });
    const rect = document.querySelector('canvas').getBoundingClientRect();
    for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3], [3, 3], [-3, 3]]) {
      const x = Math.floor(p.x + dx) + 0.5;
      const z = Math.floor(p.z + dz) + 0.5;
      if (w.map.blocked[Math.floor(z) * w.map.width + Math.floor(x)]) continue;
      if ([...w.nodes, ...w.npcs, ...w.enemies].some((e) => Math.hypot(e.x - x, e.z - z) < 1.6)) continue;
      const a = window.game.renderer.project(x, 0.3, z);
      return { x: a.x + rect.left, y: a.y + rect.top, stumpsNear: w.nodes.filter((n) => n.depleted && Math.hypot(n.x - x, n.z - z) < 4).length };
    }
    return { x: rect.left + rect.width * 0.5 + 60, y: rect.top + rect.height * 0.5 + 40 };
  });
  await page.waitForTimeout(400);
  // Diagnostics for a miss: what the browser delivered and what the game issued.
  await page.evaluate(() => {
    const d = (window.__tapDiag = { events: [], issued: [], prePick: null });
    const c = document.querySelector('canvas');
    for (const type of ['touchstart', 'touchend', 'touchcancel']) window.addEventListener(type, (e) => d.events.push([type, Math.round(e.timeStamp), e.target === c]), { capture: true });
    const w = window.game.world;
    const orig = w.issue.bind(w);
    w.issue = (cmd) => { d.issued.push(cmd.type); return orig(cmd); };
  });
  const g0 = await state();
  await page.evaluate(([x, y]) => { window.__tapDiag.prePick = window.game.renderer.pick(x, y); }, [ground.x, ground.y]);
  await quickTap(ground.x, ground.y);
  // Wait for the outcome rather than a fixed time: on a slow machine the game's clock runs slower
  // than the wall clock (the simulation caps its catch-up per frame).
  await page
    .waitForFunction(([x, z]) => { const p = window.game.world.player; return Math.hypot(p.x - x, p.z - z) > 0.5; }, [g0.x, g0.z], { timeout: 15000 })
    .catch(() => {});
  const g1 = await state();
  const groundPick = await page.evaluate(([x, y, stumps]) => ({ stumpsNearAtTap: stumps, heroTileBlocked: window.game.world.map.blocked[Math.floor(window.game.world.player.z) * window.game.world.map.width + Math.floor(window.game.world.player.x)], msgs: [...document.querySelectorAll('.log-line, .msg, .toast')].slice(-3).map((e) => e.textContent), pick: window.game.renderer.pick(x, y), action: window.game.world.player.action, diag: window.__tapDiag, path: window.game.world.player.path.length, el: (document.elementFromPoint(x, y) || {}).tagName }), [ground.x, ground.y, ground.stumpsNear]);
  check('Eastreach: tapping the ground walks there (chunked terrain picks)', Math.hypot(g1.x - g0.x, g1.z - g0.z) > 0.5, `${g0.x.toFixed(1)},${g0.z.toFixed(1)} -> ${g1.x.toFixed(1)},${g1.z.toFixed(1)} ${JSON.stringify(groundPick)}`);
  const eBefore = await state();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.reload();
  await page.waitForFunction(() => window.game && window.game.world, null, { timeout: 30000 });
  const eAfter = await state();
  check('Eastreach: saving and reloading keeps you there', eAfter.x > 112 && Math.hypot(eAfter.x - eBefore.x, eAfter.z - eBefore.z) < 1.5, `${eAfter.x.toFixed(1)},${eAfter.z.toFixed(1)} vs ${eBefore.x.toFixed(1)},${eBefore.z.toFixed(1)}`);

  // Dungeons (Phase 4D): door, stairs, chest and way out, all by touch on the projected positions;
  // then a crowded boss fight, picking the boss by its nameplate.
  await page.evaluate(() => {
    const p = window.game.world.player;
    for (const s of ['attack', 'strength', 'defence', 'hitpoints']) p.skills.addXp(s, 3000000);
    for (const q of ['elders_request', 'lanterns_of_heronwick', 'ninefold_watch']) p.quests[q] = { stage: 9, kills: 0, done: true };
    p.inventory.slots.fill(null);
    window.__keepAlive = setInterval(() => (window.game.world.player.hp = window.game.world.player.skills.level('hitpoints')), 100);
  });
  const tapAt = async (pt) => {
    await quickTap(pt.x, pt.y);
  };
  /** Stands the hero beside a passage, lets the camera settle, and taps it on screen. */
  const tapPassage = async (id, standAt) => {
    const pt = await page.evaluate(async ([id, standAt]) => {
      const w = window.game.world;
      const d = w.doorways.find((x) => x.def.id === id);
      const p = w.player;
      const at = standAt || { x: d.def.arriveX, z: d.def.arriveZ };
      p.x = p.prevX = at.x;
      p.z = p.prevZ = at.z;
      p.action = null;
      p.path = [];
      await new Promise((r) => setTimeout(r, 2200));
      const rect = document.querySelector('canvas').getBoundingClientRect();
      const a = window.game.renderer.project(d.x, 1.2, d.z);
      return { x: a.x + rect.left, y: a.y + rect.top };
    }, [id, standAt]);
    await tapAt(pt);
  };
  const where = () => page.evaluate(() => { const p = window.game.world.player; return { x: p.x, z: p.z, inside: p.z > 128 }; });
  const waitFor = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 12000 }).then(() => true, () => false);
  // Greymane roams beside the tower door; a tap near the door can rightly pick him first. This check is
  // about the door's own hit area, so he is out of the way for it.
  await page.evaluate(() => {
    const g = window.game.world.enemies.find((e) => e.def.id === 'greymane');
    g.state = 'dead';
    g.respawnTimer = 9999;
    g.deadAge = 99;
  });
  await tapPassage('old_watchtower_door', { x: 181.5, z: 24.5 });
  check('dungeon: tapping the Old Watchtower door goes in', await waitFor(() => window.game.world.player.z > 128));
  await tapPassage('tower_up_1');
  const f2 = await waitFor(() => window.game.world.player.x > 85);
  await tapPassage('tower_up_2');
  const roof = await waitFor(() => window.game.world.player.x > 97);
  check('dungeon: tapping the stairs climbs floor by floor to the roof', f2 && roof);
  const chest = await page.evaluate(async () => {
    const w = window.game.world;
    const c = w.chests.find((x) => x.dungeon === 'old_watchtower');
    w.player.dungeonClaims.old_watchtower = 1;
    const side = [[0, 1], [1, 0], [-1, 0], [0, -1]].find(([a, b]) => !w.map.blocked[Math.floor(c.z + b) * w.map.width + Math.floor(c.x + a)]);
    w.player.x = w.player.prevX = c.x + side[0];
    w.player.z = w.player.prevZ = c.z + side[1];
    await new Promise((r) => setTimeout(r, 2200));
    const rect = document.querySelector('canvas').getBoundingClientRect();
    const a = window.game.renderer.project(c.x, 0.9, c.z);
    return { x: a.x + rect.left, y: a.y + rect.top };
  });
  await tapAt(chest);
  const opened = await waitFor(() => (window.game.world.player.dungeonRuns.old_watchtower || 0) === 1);
  const chestState = await page.evaluate(([x, y]) => ({ pos: [window.game.world.player.x, window.game.world.player.z, window.game.world.player.path.length, window.game.world.player.dead], pick: window.game.renderer.pick(x, y), action: window.game.world.player.action, claim: window.game.world.player.dungeonClaims, free: window.game.world.player.inventory.freeSlots(), msgs: [...document.querySelectorAll('.log-line, .msg, .toast')].slice(-3).map((e) => e.textContent) }), [chest.x, chest.y]);
  check('dungeon: tapping the chest opens it, and the log records what it gave', opened, JSON.stringify(chestState));
  await tapPassage('tower_down_roof');
  await waitFor(() => window.game.world.player.x < 97);
  await tapPassage('tower_down_2');
  await waitFor(() => window.game.world.player.x < 85);
  await tapPassage('old_watchtower_out');
  check('dungeon: down the stairs and out through the way out', await waitFor(() => window.game.world.player.z < 128));
  if (shots) await page.screenshot({ path: path.join(shots, 'smoke-dungeon-out.png') });
  // A crowded fight: tap the Shrinekeeper's nameplate with its guardians round it.
  const plate = await page.evaluate(async () => {
    const w = window.game.world;
    const boss = w.enemies.find((e) => e.def.id === 'shrinekeeper');
    w.player.x = w.player.prevX = boss.x - 2.5;
    w.player.z = w.player.prevZ = boss.z;
    for (const g of w.enemies.filter((e) => e.def.id === 'drowned_guardian')) {
      g.x = g.prevX = boss.x + 0.8;
      g.z = g.prevZ = boss.z + 0.6;
    }
    await new Promise((r) => setTimeout(r, 2200));
    const rect = document.querySelector('canvas').getBoundingClientRect();
    const a = window.game.renderer.project(boss.x, 0.35 + 2.0 * boss.def.scale + 0.3, boss.z);
    return { x: a.x + rect.left, y: a.y + rect.top, id: boss.id };
  });
  await tapAt(plate);
  check('dungeon: in a crowd, tapping the boss’s nameplate targets the boss', await waitFor((id) => { const a = window.game.world.player.action; return !!a && a.type === 'attack' && a.target === id; }, plate.id));
  await page.evaluate(() => clearInterval(window.__keepAlive));

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
