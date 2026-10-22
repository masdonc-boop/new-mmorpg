import './ui/styles.css';
import { Controls } from './input/controls';
import { GameRenderer } from './render/renderer';
import { GameWorld, TICK_SECONDS, type SaveData } from './sim/world';
import { runCharacterCreator } from './ui/creator';
import { Hud } from './ui/hud';
import { Audio } from './ui/audio';
import { ART } from './render/art';
import type { GameEvent } from './sim/world';
import { NetClient } from './net/client';
import type { Auth } from './net/protocol';
import { runSignIn } from './ui/signin';
import { runImportOffer } from './ui/importoffer';

const SAVE_KEY = 'brightwater.save.v1';
const SETTINGS_KEY = 'brightwater.settings.v1';
/** Network play: session tokens by server address (never passwords). */
const SESSION_KEY = 'brightwater.session.v1';
/** Network play: whether this device's offline character was brought over (or declined) per server. */
const IMPORT_KEY = 'brightwater.import.v1';

interface Settings {
  quality: 'high' | 'balanced' | 'low';
  rotation: boolean;
  zoom: number;
  sound: boolean;
  /** Phase 2A visual style preview (rounded characters, new water, showcase assets). */
  artV2: boolean;
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

  const early = loadJson<Partial<Settings>>(SETTINGS_KEY);
  ART.v2 = params.has('classic') ? false : early?.artV2 ?? true;

  let save = loadJson<SaveData>(SAVE_KEY);
  if (save?.version !== 1) save = null;
  loading.style.display = 'none';
  let world: GameWorld;
  // Network play against the local development server (docs/MULTIPLAYER.md 3A.2): opt-in with
  // ?server=ws://localhost:8787. The server owns the character; the local save is left untouched.
  const serverUrl = params.get('server');
  let net: NetClient | null = null;
  /** Messages to show once the HUD exists. */
  const notices: string[] = [];
  if (serverUrl) {
    // Sign in with a saved session token, or ask for a name and password (or a new account).
    const tokens = loadJson<Record<string, string>>(SESSION_KEY) ?? {};
    let auth: Auth | null = params.has('autostart') ? { kind: 'guest', name: params.get('autostart') || 'Tester' } : tokens[serverUrl] ? { kind: 'token', token: tokens[serverUrl] } : null;
    let message: string | undefined;
    let lastName: string | undefined;
    for (;;) {
      if (!auth) {
        loading.style.display = 'none';
        auth = await runSignIn(app, { server: serverUrl, message, name: lastName });
        lastName = auth.username;
      }
      net = new NetClient({ url: serverUrl, auth, autoReconnect: true });
      loading.style.display = '';
      try {
        world = await net.connect();
        break;
      } catch (err) {
        if (net.errorCode === 'version') throw new Error(net.closeReason);
        if (!net.errorCode && auth.kind !== 'token') throw new Error(`Could not join the server at ${serverUrl}: ${(err as Error).message}`);
        if (auth.kind === 'token') delete tokens[serverUrl];
        message = auth.kind === 'token' ? undefined : net.closeReason;
        auth = null;
      }
    }
    if (net.session) tokens[serverUrl] = net.session;
    saveJson(SESSION_KEY, tokens);
    // Offer once to bring this device's offline character onto the account (docs/MULTIPLAYER.md §7).
    const marks = loadJson<Record<string, string>>(IMPORT_KEY) ?? {};
    if (save && auth.kind !== 'guest' && !marks[serverUrl]) {
      loading.style.display = 'none';
      const choice = await runImportOffer(app, save, world.player.name);
      loading.style.display = '';
      if (choice === 'never') marks[serverUrl] = 'declined';
      if (choice === 'import') {
        try {
          const report = await net.importSave(save);
          marks[serverUrl] = 'imported';
          notices.push(`${save.name} came across to this account.`, ...report);
        } catch (err) {
          const why = (err as Error).message;
          if (/already/.test(why)) marks[serverUrl] = 'imported';
          notices.push(`Your character could not be brought over: ${why}`);
        }
      }
      saveJson(IMPORT_KEY, marks);
    }
  } else if (!save) {
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

  const settings: Settings = { quality: defaultQuality(), rotation: false, zoom: 1, sound: true, artV2: true, ...loadJson<Partial<Settings>>(SETTINGS_KEY) };
  const persistSettings = () => saveJson(SETTINGS_KEY, settings);

  const renderer = new GameRenderer(canvas, app, world);
  renderer.setQuality(settings.quality);
  renderer.zoom = settings.zoom;
  loading.remove();

  const issue: GameWorld['issue'] = net ? net.issue : (cmd) => world.issue(cmd);
  const audio = new Audio();
  audio.enabled = settings.sound;
  const unlockAudio = () => audio.unlock();
  window.addEventListener('touchstart', unlockAudio, { passive: true });
  window.addEventListener('mousedown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);
  let lastLootSfx = 0;
  const playFor = (e: GameEvent) => {
    const pid = world.player.id;
    switch (e.type) {
      case 'attack':
        if (e.source === pid) audio.play(world.player.style === 'melee' ? 'swing' : world.player.style === 'ranged' ? 'bow' : 'magic');
        break;
      case 'damage':
        if (e.target === pid) audio.play(e.amount > 0 ? 'hurt' : 'miss');
        else audio.play(e.hit && e.amount > 0 ? 'hit' : 'miss');
        break;
      case 'gather': {
        const n = world.get(e.node);
        if (n && 'def' in n && 'skill' in n.def) audio.play(n.def.skill === 'woodcutting' ? 'chop' : 'mine');
        break;
      }
      case 'loot':
        if (performance.now() - lastLootSfx > 150) audio.play('loot');
        lastLootSfx = performance.now();
        break;
      case 'levelUp':
        audio.play('levelup');
        break;
      case 'quest':
        if (e.complete) audio.play('quest');
        break;
      case 'death':
        if (e.id === pid) audio.play('death');
        break;
      case 'heal':
        audio.play('eat');
        break;
    }
  };
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
    setSound: (on) => {
      settings.sound = audio.enabled = on;
      persistSettings();
    },
    getSound: () => settings.sound,
    getArtV2: () => ART.v2,
    setArtV2: (on) => {
      settings.artV2 = on;
      persistSettings();
      persist();
      location.reload();
    },
    zoom: (f) => applyZoom(f),
    resetCamera: () => {
      renderer.camYaw = Math.PI / 4;
      renderer.zoom = settings.zoom = 1;
      persistSettings();
    },
    newCharacter: () => {
      if (net) return location.reload();
      localStorage.removeItem(SAVE_KEY);
      skipSave = true;
      location.reload();
    },
    cameraYaw: () => renderer.camYaw,
    ...(net
      ? {
          social: {
            say: (text: string, to?: string) => net!.say(text, to),
            block: (name: string, on: boolean) => net!.block(name, on),
            report: (name: string, reason: string) => net!.report(name, reason),
            blocked: () => net!.blocked,
            trade: (playerId: number) => issue({ type: 'tradeRequest', target: playerId }),
          },
          signOut: () => {
            net!.logout();
            const tokens = loadJson<Record<string, string>>(SESSION_KEY) ?? {};
            delete tokens[serverUrl!];
            saveJson(SESSION_KEY, tokens);
            setTimeout(() => location.reload(), 300);
          },
        }
      : {}),
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
      if (hit.kind === 'entity' && net && hit.id !== world.player.id && world.players.has(hit.id)) hud.openPlayerMenu(hit.id);
      else if (hit.kind === 'entity') issue({ type: 'interact', target: hit.id });
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
  }, (target) => target === canvas);
  controls.rotationEnabled = settings.rotation;
  for (const text of notices) hud.handleEvent({ type: 'message', text, tone: 'info' });

  // HUD gestures never reach the world: Controls only handles gestures that start on the canvas.
  hud.root.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button')) audio.play('click');
  });

  const resize = () => renderer.resize(window.innerWidth, window.innerHeight);
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  resize();

  let skipSave = false;
  const persist = () => {
    // In network play the server keeps the character; never overwrite the local save with it.
    if (!skipSave && !net) saveJson(SAVE_KEY, world.save());
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
  let disconnectShown = false;
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

    let alpha: number;
    if (net) {
      // The server runs the game; the client predicts, interpolates and applies what it's sent.
      alpha = net.update(dt);
      acc = 0;
      if (net.status === 'ready') disconnectShown = false;
      if (net.status === 'closed' && !disconnectShown) {
        disconnectShown = true;
        hud.handleEvent({ type: 'message', text: `${net.closeReason} Reload to reconnect.`, tone: 'bad' });
      }
    } else {
      let steps = 0;
      while (acc >= TICK_SECONDS && steps < 9) {
        world.tick(TICK_SECONDS);
        acc -= TICK_SECONDS;
        steps++;
      }
      if (steps === 9) acc = 0;
      alpha = acc / TICK_SECONDS;
    }
    if (net)
      for (const line of net.drainChat()) {
        hud.addChat(line);
        if (line.channel === 'local') renderer.speech(line.from, line.text);
      }
    for (const e of net ? net.drainEvents() : world.drainEvents()) {
      renderer.handleEvent(e);
      hud.handleEvent(e);
      playFor(e);
    }
    renderer.render(dt, alpha);
    hud.update(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Expose for debugging / automated smoke tests.
  (window as unknown as { game: unknown }).game = { world, renderer, hud, net };
}

boot().catch((err) => {
  console.error(err);
  const l = document.getElementById('loading');
  if (l) l.innerHTML = `<div class="ld-logo">Brightwater</div><div class="ld-sub">Failed to start: ${String(err?.message ?? err)}</div>`;
});
