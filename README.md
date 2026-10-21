# Brightwater — Fantasy RPG Prototype (Phase 1)

A mobile-first, colourful 2.5D isometric fantasy RPG built for the browser. Phase 1 is a playable single-player vertical slice that will grow into a persistent MMORPG. Design decisions live in [GAME_DESIGN.md](GAME_DESIGN.md).

**Engine:** [Three.js](https://threejs.org) + TypeScript + Vite. Three.js is a small WebGL renderer that runs well in Android Chrome, gives us real lighting, shadows and a free-rotating 2.5D camera, and needs no editor or binary asset pipeline — all art here is generated in code, so it builds anywhere (including cloud dev containers). Game rules live in a renderer-independent simulation layer so they can later run on an authoritative server.

## Quick start

```bash
npm install
npm run dev        # dev server on http://localhost:5173 (also exposed on your LAN)
npm test           # unit + simulation tests (Vitest)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build on your LAN (port 4173)
```

Requires Node 18+.

## Play on your Android phone

**Option A — same Wi-Fi as your computer (simplest)**
1. On your computer: `npm install && npm run dev`.
2. Vite prints a `Network:` address such as `http://192.168.1.23:5173/`.
3. Open that address in Chrome on your phone (phone and computer on the same Wi-Fi).
4. Optional: Chrome menu ⋮ → **Add to Home screen** for a fullscreen, app-like launch.

If the page won't load, allow Node through your computer's firewall for private networks.

**Option B — GitHub Pages (free, but public)**
The repo includes a manually-triggered workflow (`.github/workflows/pages.yml`). Nothing is published until you choose to:
1. GitHub → repo **Settings → Pages → Source: GitHub Actions**.
2. **Actions → Deploy to GitHub Pages → Run workflow**.
3. Open `https://<your-user>.github.io/new-mmorpg/` on your phone.
Note: Pages sites are publicly accessible, and Pages on private repos requires a paid GitHub plan.

**Option C — any static host:** `npm run build` and upload the `dist/` folder (it uses relative paths).

## Controls

| Action | Touch | Desktop |
| --- | --- | --- |
| Move | Drag on the left side of the screen (floating joystick) | WASD / arrow keys |
| Walk to a spot | Tap the ground | Click |
| Attack / gather / talk | Tap the enemy, tree, rock or villager | Click |
| Switch combat style | Big round button (Melee → Ranged → Magic) | 1 / 2 / 3 |
| Zoom | Pinch, or the +/− buttons by the minimap | Mouse wheel, +/− |
| Rotate camera (experimental) | Enable in ⚙ Settings, then drag / two-finger twist | Q / E, right-drag |
| Panels | Bag, Skills, Quests, Map buttons | I, K, J, M; Esc closes |

Progress saves automatically to the device. Add `?reset` to the URL to start over.

## Project layout

```
src/core/     RNG, noise, math helpers
src/data/     Content: items, enemies, resources, NPCs, quests, skills
src/sim/      Game rules: world generation, pathfinding, combat, inventory, skills, quests (no rendering)
src/render/   Three.js scene: terrain, water shader, props, characters, effects, overlay
src/input/    Joystick, tap, pinch, keyboard
src/ui/       HUD, panels, dialogue, character creator, item icons, CSS
tests/        Vitest suites for the simulation
```
