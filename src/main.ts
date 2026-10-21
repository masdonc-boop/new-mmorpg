import './ui/styles.css';
import { Controls } from './input/controls';
import { GameRenderer } from './render/renderer';
import { GameWorld, TICK_SECONDS, type SaveData } from './sim/world';
import { runCharacterCreator } from './ui/creator';
import { Hud } from './ui/hud';

const SAVE_KEY = 'brightwater.save.v1';
const SETTINGS_KEY = 'brightwater.settings.v1';

interface Settings {
  quality: 'high' | 'balanced' | 'low';
  rotation: boolean;
  zoom: number;
}

function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode) — play continues without saving */
  }
}

function defaultQuality(): Settings['quality'] {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (mem !== undefined && mem <= 3) return 'low';
  return 'balanced';
}

async function boot() {
  const app = document.getElementById('app')!;
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const loading = document.getElementById('loading')!;

  const params = new URLSearchParams(location.search);
  if (params.has('reset')) localStorage.removeItem(SAVE_KEY);

  let save = loadJson<SaveData>(SAVE_KEY);
  if (save?.version !== 1) save = null;
  loading.style.display = 'none';
  let world: GameWorld;
  if (!save) {
    if (params.has('autostart')) {
      world = new GameWorld({ name: 'Tester' });
    } else {
      const created = await runCharacterCreator(app);
      world = new GameWorld({ name: created.name, appearance: created.appearance });
    }
  } else {
    world = new GameWorld({ save });
  }
  loading.style.display = '';
  // Let the loading screen paint before the (synchronous) scene build.
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));

  const settings: Settings = { quality: defaultQuality(), rotation: false, zoom: 1, ...loadJson<Partial<Settings>>(SETTINGS_KEY) };
  const persistSettings = () => saveJson(SETTINGS_KEY, settings);

  const renderer = new GameRenderer(canvas, app, world);
  renderer.setQuality(settings.quality);
  renderer.zoom = settings.zoom;
  loading.remove();

  const issue: GameWorld['issue'] = (cmd) => world.issue(cmd);
  let joyScreen = { x: 0, y: 0 };

  const hud = new Hud(app, world, {
    command: issue,
    setQuality: (q) => {
      settings.quality = q;
      renderer.setQuality(q);
      persistSettings();
    },
    getQuality: () => settings.quality,
    setRotation: (on) => {
      settings.rotation = on;
      controls.rotationEnabled = on;
      if (!on) renderer.camYaw = Math.PI / 4;
      persistSettings();
    },
    getRotation: () => settings.rotation,
    zoom: (f) => applyZoom(f),
    resetCamera: () => {
      renderer.camYaw = Math.PI / 4;
      renderer.zoom = settings.zoom = 1;
      persistSettings();
    },
    newCharacter: () => {
      localStorage.removeItem(SAVE_KEY);
      skipSave = true;
      location.reload();
    },
    cameraYaw: () => renderer.camYaw,
  });

  const applyZoom = (f: number) => {
    renderer.zoom = Math.max(0.55, Math.min(1.7, renderer.zoom * f));
    settings.zoom = renderer.zoom;
  };

  const controls = new Controls(canvas.parentElement!, {
    tap: (x, y) => {
      if (world.player.dead) return;
      if (hud.dialogueOpen) return;
      const hit = renderer.pick(x, y);
      if (!hit) return;
      if (hit.kind === 'entity') issue({ type: 'interact', target: hit.id });
      else {
        issue({ type: 'moveTo', x: hit.x, z: hit.z });
        renderer.showTapMarker(hit.x, hit.z);
      }
    },
    joystick: (x, y) => {
      joyScreen = { x, y };
    },
    zoom: (f) => applyZoom(f),
    rotate: (d) => {
      renderer.camYaw += d;
    },
    key: (k) => {
      if (k === '1') issue({ type: 'setStyle', style: 'melee' });
      if (k === '2') issue({ type: 'setStyle', style: 'ranged' });
      if (k === '3') issue({ type: 'setStyle', style: 'magic' });
      if (k === 'i' || k === 'b') hud.toggle('inventory');
      if (k === 'k') hud.toggle('skills');
      if (k === 'j') hud.toggle('quests');
      if (k === 'm') hud.toggle('map');
      if (k === 'escape') hud.toggle(null);
    },
  });
  controls.rotationEnabled = settings.rotation;

  // Keep HUD buttons from triggering world taps.
  hud.root.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  hud.root.addEventListener('touchend', (e) => e.stopPropagation(), { passive: true });
  hud.root.addEventListener('mousedown', (e) => e.stopPropagation());
  hud.root.addEventListener('mouseup', (e) => e.stopPropagation());

  const resize = () => renderer.resize(window.innerWidth, window.innerHeight);
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  resize();

  let skipSave = false;
  const persist = () => {
    if (!skipSave) saveJson(SAVE_KEY, world.save());
    persistSettings();
  };
  setInterval(persist, 10000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && persist());
  window.addEventListener('pagehide', persist);
  persist();

  // Fixed-timestep simulation with interpolated rendering.
  let acc = 0;
  let last = performance.now();
  let lastJoy = { x: 0, z: 0 };
  const frame = () => {
    const now = performance.now();
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    acc += dt;

    // Camera-relative joystick → world direction.
    const { forward, right } = renderer.cameraBasis();
    const jx = right.x * joyScreen.x - forward.x * joyScreen.y;
    const jz = right.z * joyScreen.x - forward.z * joyScreen.y;
    if (Math.abs(jx - lastJoy.x) > 0.001 || Math.abs(jz - lastJoy.z) > 0.001) {
      issue({ type: 'joystick', dx: jx, dz: jz });
      lastJoy = { x: jx, z: jz };
    }

    let steps = 0;
    while (acc >= TICK_SECONDS && steps < 9) {
      world.tick(TICK_SECONDS);
      acc -= TICK_SECONDS;
      steps++;
    }
    if (steps === 9) acc = 0;
    for (const e of world.drainEvents()) {
      renderer.handleEvent(e);
      hud.handleEvent(e);
    }
    renderer.render(dt, acc / TICK_SECONDS);
    hud.update(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Expose for debugging / automated smoke tests.
  (window as unknown as { game: unknown }).game = { world, renderer, hud };
}

boot().catch((err) => {
  console.error(err);
  const l = document.getElementById('loading');
  if (l) l.innerHTML = `<div class="ld-logo">Brightwater</div><div class="ld-sub">Failed to start: ${String(err?.message ?? err)}</div>`;
});
