import * as THREE from 'three';
import { mulberry32 } from '../core/rng';

/**
 * Procedural, tileable canvas textures (original art generated at runtime).
 * Returns null when no 2D canvas is available (e.g. headless tests); callers fall back to flat colour.
 */
function canvas2d(size: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  let g: CanvasRenderingContext2D | null = null;
  try {
    g = c.getContext('2d');
  } catch {
    g = null;
  }
  return g ? { c, g } : null;
}

const cache = new Map<string, THREE.Texture | null>();

function finish(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function memo(key: string, make: () => THREE.Texture | null): THREE.Texture | null {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key)!;
}

const shade = (hex: string, k: number) => {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return `#${c.getHexString()}`;
};

/** Overlapping rounded roof shingles. One texture repeat = 1 world unit. */
export function shingleTexture(base: string): THREE.Texture | null {
  return memo(`shingle:${base}`, () => {
    const cv = canvas2d(256);
    if (!cv) return null;
    const { c, g } = cv;
    const rng = mulberry32(7);
    g.fillStyle = shade(base, 0.55);
    g.fillRect(0, 0, 256, 256);
    const rows = 5;
    const rh = 256 / rows;
    for (let r = rows; r >= -1; r--) {
      const off = (r % 2) * 16;
      for (let i = -1; i < 9; i++) {
        const x = i * 32 + off;
        const y = r * rh;
        const k = 0.82 + rng() * 0.3;
        const grad = g.createLinearGradient(0, y, 0, y + rh + 6);
        grad.addColorStop(0, shade(base, k * 0.8));
        grad.addColorStop(0.75, shade(base, k));
        grad.addColorStop(1, shade(base, k * 1.12));
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(x + 1, y);
        g.lineTo(x + 31, y);
        g.lineTo(x + 31, y + rh - 6);
        g.quadraticCurveTo(x + 16, y + rh + 7, x + 1, y + rh - 6);
        g.closePath();
        g.fill();
        g.strokeStyle = 'rgba(30,15,10,0.35)';
        g.lineWidth = 1.5;
        g.stroke();
      }
    }
    // Moss and wear
    for (let i = 0; i < 40; i++) {
      g.fillStyle = rng() < 0.5 ? 'rgba(110,140,60,0.18)' : 'rgba(255,255,255,0.06)';
      g.beginPath();
      g.arc(rng() * 256, rng() * 256, 2 + rng() * 6, 0, Math.PI * 2);
      g.fill();
    }
    return finish(c);
  });
}

/** Irregular fitted stone blocks with mortar. */
export function stoneTexture(base = '#a9a196'): THREE.Texture | null {
  return memo(`stone:${base}`, () => {
    const cv = canvas2d(256);
    if (!cv) return null;
    const { c, g } = cv;
    const rng = mulberry32(11);
    g.fillStyle = '#7d766c';
    g.fillRect(0, 0, 256, 256);
    let y = 0;
    while (y < 256) {
      const h = 34 + Math.floor(rng() * 22);
      let x = -Math.floor(rng() * 40);
      while (x < 256) {
        const w = 44 + Math.floor(rng() * 46);
        const k = 0.82 + rng() * 0.32;
        g.fillStyle = shade(base, k);
        const r = 7;
        g.beginPath();
        g.roundRect(x + 2, y + 2, w - 4, h - 4, r);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.10)';
        g.fillRect(x + 5, y + 4, w - 12, 4);
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.fillRect(x + 5, y + h - 9, w - 10, 4);
        x += w;
      }
      y += h;
    }
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(0,0,0,${rng() * 0.08})`;
      g.fillRect(rng() * 256, rng() * 256, 2, 2);
    }
    return finish(c);
  });
}

/** Vertical wood planks with grain and knots. */
export function woodTexture(base = '#7a5032'): THREE.Texture | null {
  return memo(`wood:${base}`, () => {
    const cv = canvas2d(256);
    if (!cv) return null;
    const { c, g } = cv;
    const rng = mulberry32(5);
    const planks = 4;
    const pw = 256 / planks;
    for (let p = 0; p < planks; p++) {
      g.fillStyle = shade(base, 0.85 + rng() * 0.25);
      g.fillRect(p * pw, 0, pw, 256);
      g.strokeStyle = 'rgba(40,20,10,0.25)';
      g.lineWidth = 1;
      for (let l = 0; l < 7; l++) {
        const x0 = p * pw + 5 + rng() * (pw - 10);
        g.beginPath();
        g.moveTo(x0, 0);
        for (let yy = 0; yy <= 256; yy += 32) g.lineTo(x0 + Math.sin(yy * 0.05 + l) * 2.5, yy);
        g.stroke();
      }
      if (rng() < 0.7) {
        g.fillStyle = 'rgba(50,25,10,0.45)';
        g.beginPath();
        g.ellipse(p * pw + pw / 2, rng() * 256, 4, 7, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = 'rgba(20,10,5,0.55)';
      g.fillRect(p * pw, 0, 2, 256);
    }
    return finish(c);
  });
}

/** Soft lime plaster with subtle mottling. */
export function plasterTexture(base = '#efe4cc'): THREE.Texture | null {
  return memo(`plaster:${base}`, () => {
    const cv = canvas2d(128);
    if (!cv) return null;
    const { c, g } = cv;
    const rng = mulberry32(3);
    g.fillStyle = base;
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 160; i++) {
      const dark = rng() < 0.5;
      g.fillStyle = dark ? `rgba(120,100,70,${rng() * 0.07})` : `rgba(255,255,255,${rng() * 0.12})`;
      g.beginPath();
      g.arc(rng() * 128, rng() * 128, 3 + rng() * 10, 0, Math.PI * 2);
      g.fill();
    }
    return finish(c);
  });
}

export interface FaceLook {
  eyes: string;
  skin: string;
  brows: string;
  lips?: string;
  blush?: boolean;
  closed?: boolean;
  elder?: boolean;
}

/**
 * Painted face decal (eyes with highlights, brows, nose shading, mouth, blush) on transparency.
 * Designed for a 120°-wide spherical patch on the head.
 */
export function faceTexture(f: FaceLook): THREE.Texture | null {
  return memo(`face:${JSON.stringify(f)}`, () => {
    const cv = canvas2d(256);
    if (!cv) return null;
    const { c, g } = cv;
    g.clearRect(0, 0, 256, 256);
    const ey = 132;
    for (const sx of [-1, 1]) {
      const ex = 128 + sx * 50;
      if (f.closed) {
        g.strokeStyle = '#3a2418';
        g.lineWidth = 5;
        g.lineCap = 'round';
        g.beginPath();
        g.arc(ex, ey - 4, 15, 0.25 * Math.PI, 0.75 * Math.PI);
        g.stroke();
      } else {
        g.fillStyle = '#fbf8f2';
        g.beginPath();
        g.ellipse(ex, ey, 21, 25, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = f.eyes;
        g.beginPath();
        g.ellipse(ex + sx * 1.5, ey + 3, 15, 19, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = `#${new THREE.Color(f.eyes).multiplyScalar(1.35).getHexString()}`;
        g.beginPath();
        g.ellipse(ex + sx * 1.5, ey + 10, 11, 9, 0, 0, Math.PI);
        g.fill();
        g.fillStyle = '#1c120c';
        g.beginPath();
        g.ellipse(ex + sx * 1.5, ey + 4, 8, 10, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(ex - 5, ey - 6, 6, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.arc(ex + 6, ey + 9, 2.5, 0, Math.PI * 2);
        g.fill();
        // Upper lid line with a little flick at the outer corner
        g.strokeStyle = '#2a1a12';
        g.lineWidth = 5;
        g.lineCap = 'round';
        g.beginPath();
        g.ellipse(ex, ey, 22, 26, 0, Math.PI * 1.05, Math.PI * 1.95);
        g.stroke();
        g.beginPath();
        g.moveTo(ex + sx * 21, ey - 6);
        g.lineTo(ex + sx * 27, ey - 11);
        g.stroke();
      }
      // Brows
      g.strokeStyle = f.brows;
      g.lineWidth = f.elder ? 8 : 6;
      g.beginPath();
      g.moveTo(ex - sx * 18, ey - 36);
      g.quadraticCurveTo(ex, ey - 47, ex + sx * 20, ey - 39);
      g.stroke();
      if (f.blush) {
        g.fillStyle = 'rgba(235,110,110,0.28)';
        g.beginPath();
        g.ellipse(ex + sx * 10, ey + 40, 16, 9, 0, 0, Math.PI * 2);
        g.fill();
      }
      if (f.elder) {
        g.strokeStyle = 'rgba(90,50,30,0.35)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(ex + sx * 20, ey + 6);
        g.lineTo(ex + sx * 28, ey + 2);
        g.stroke();
      }
    }
    // Nose (soft shadow) and mouth
    g.fillStyle = 'rgba(120,60,40,0.30)';
    g.beginPath();
    g.ellipse(128, 168, 9, 6, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = f.lips ?? '#8e3f35';
    g.lineWidth = 5;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(112, 196);
    g.quadraticCurveTo(128, 206, 144, 196);
    g.stroke();
    return finish(c, false);
  });
}
