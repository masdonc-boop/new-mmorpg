import * as THREE from 'three';
import { Humanoid } from '../render/characters';
import { ART } from '../render/art';
import { HeroModel } from '../render/hero';
import { DEFAULT_APPEARANCE, type Appearance } from '../sim/world';

const SKINS = ['#f6d3b8', '#e8b48f', '#d19a6e', '#b37a4f', '#8d5a3b', '#5e3b26'];
const HAIR = ['#2b1d14', '#5a3620', '#a0612f', '#d9a441', '#f0e0b0', '#c4482c', '#e8e8e8', '#3f5fb0'];
const TUNICS = ['#2f7fc1', '#c4453b', '#3f9a52', '#8a5cc2', '#d98c2b', '#2e3a4f', '#e6d9b8', '#1f8a8a'];
const TROUSERS = ['#4a3a2a', '#2c3a4f', '#5a4632', '#3d3d3d', '#6b4a7a', '#7a5a3a'];
const HAIR_STYLES = ['Short', 'Tousled', 'Long', 'Bun', 'Bald'];
const NAMES = ['Rowan', 'Elara', 'Bram', 'Wren', 'Torin', 'Lyra', 'Cass', 'Fen', 'Mira', 'Aldric'];

/**
 * First-run character creation with a live 3D preview. Resolves with the chosen name and appearance.
 * `fixedName`: the name is already chosen (a new account), so only the looks are picked.
 */
export function runCharacterCreator(parent: HTMLElement, fixedName?: string): Promise<{ name: string; appearance: Appearance }> {
  return new Promise((resolve) => {
    const look: Appearance = { ...DEFAULT_APPEARANCE };
    const root = document.createElement('div');
    root.className = 'creator';
    root.innerHTML = `
      <div class="cr-title"><span class="logo">Brightwater</span><small>Chronicles of the Free Isles</small></div>
      <div class="cr-stage"><canvas></canvas></div>
      <div class="cr-panel">
        <label class="cr-name">Name <input maxlength="14" autocomplete="off" spellcheck="false"></label>
        <div class="cr-row" data-k="bodyType"><span>Build</span><div class="cr-opts"></div></div>
        <div class="cr-row" data-k="skin"><span>Skin</span><div class="cr-opts"></div></div>
        <div class="cr-row" data-k="hairStyle"><span>Hair</span><div class="cr-opts"></div></div>
        <div class="cr-row" data-k="hair"><span>Hair colour</span><div class="cr-opts"></div></div>
        <div class="cr-row" data-k="tunic"><span>Tunic</span><div class="cr-opts"></div></div>
        <div class="cr-row" data-k="trousers"><span>Trousers</span><div class="cr-opts"></div></div>
        <div class="cr-btns"><button class="cr-random">🎲 Randomise</button><button class="cr-go">Begin adventure ▸</button></div>
      </div>`;
    parent.appendChild(root);
    const input = root.querySelector('input')!;
    input.value = fixedName ?? NAMES[Math.floor(Math.random() * NAMES.length)];
    if (fixedName) (root.querySelector('.cr-name') as HTMLElement).style.display = 'none';

    const canvas = root.querySelector('canvas')!;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    camera.position.set(0, 1.9, 7.4);
    camera.lookAt(0, 0.8, 0);
    scene.add(new THREE.HemisphereLight('#e6f4ff', '#6b8f4e', 1.6));
    const sun = new THREE.DirectionalLight('#fff0d0', 2);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 0.3, 10), new THREE.MeshLambertMaterial({ color: '#7ccf55', flatShading: true }));
    platform.position.y = -0.15;
    scene.add(platform);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.26, 1.3, 0.16, 10), new THREE.MeshLambertMaterial({ color: '#a8a196', flatShading: true }));
    rim.position.y = -0.32;
    scene.add(rim);

    let model: Humanoid | HeroModel | null = null;
    const rebuild = () => {
      if (model) {
        scene.remove(model.root);
        model.dispose();
      }
      model = ART.v2 ? new HeroModel({ ...look }) : new Humanoid({ ...look }, true);
      model.setTool('sword');
      scene.add(model.root);
    };
    rebuild();

    const renderOpts = () => {
      root.querySelectorAll<HTMLElement>('.cr-row').forEach((row) => {
        const k = row.dataset.k as keyof Appearance;
        const opts = row.querySelector('.cr-opts')!;
        opts.innerHTML = '';
        const add = (label: string, value: string | number, swatch?: string) => {
          const b = document.createElement('button');
          b.className = `cr-opt${look[k] === value ? ' on' : ''}${swatch ? ' sw' : ''}`;
          if (swatch) b.style.background = swatch;
          else b.textContent = label;
          b.addEventListener('click', () => {
            (look as unknown as Record<string, string | number>)[k] = value;
            rebuild();
            renderOpts();
          });
          opts.appendChild(b);
        };
        if (k === 'bodyType') ['Broad', 'Slender'].forEach((l, i) => add(l, i));
        else if (k === 'hairStyle') HAIR_STYLES.forEach((l, i) => add(l, i));
        else {
          const list = k === 'skin' ? SKINS : k === 'hair' ? HAIR : k === 'tunic' ? TUNICS : TROUSERS;
          list.forEach((c) => add('', c, c));
        }
      });
    };
    renderOpts();

    root.querySelector('.cr-random')!.addEventListener('click', () => {
      const r = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
      look.bodyType = Math.random() < 0.5 ? 0 : 1;
      look.skin = r(SKINS);
      look.hair = r(HAIR);
      look.hairStyle = Math.floor(Math.random() * HAIR_STYLES.length);
      look.tunic = r(TUNICS);
      look.trousers = r(TROUSERS);
      if (!fixedName) input.value = r(NAMES);
      rebuild();
      renderOpts();
    });

    let running = true;
    let last = performance.now();
    let t = 0;
    let spin = 0.5;
    let drag: number | null = null;
    canvas.addEventListener('pointerdown', (e) => (drag = e.clientX));
    window.addEventListener('pointerup', () => (drag = null));
    canvas.addEventListener('pointermove', (e) => {
      if (drag === null) return;
      spin += (e.clientX - drag) * 0.01;
      drag = e.clientX;
    });
    const loop = () => {
      if (!running) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
        renderer.setSize(w, h, false);
        camera.aspect = w / Math.max(1, h);
        camera.updateProjectionMatrix();
      }
      if (drag === null) spin += dt * 0.5;
      if (model) {
        model.root.rotation.y = spin;
        model.update(dt, 'idle', 0, 99, t);
      }
      renderer.render(scene, camera);
      requestAnimationFrame(loop);
    };
    loop();

    root.querySelector('.cr-go')!.addEventListener('click', () => {
      const name = fixedName ?? (input.value.trim().replace(/[^\p{L}\p{N} '-]/gu, '').slice(0, 14) || 'Adventurer');
      running = false;
      model?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      root.remove();
      resolve({ name, appearance: { ...look } });
    });
  });
}
