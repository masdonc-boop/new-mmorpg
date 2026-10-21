import * as THREE from 'three';
import { fbm } from '../core/noise';
import { T, WATER_Y, type WorldMap } from '../sim/worldmap';
import { ART, PALETTE, showcaseWeight } from './art';
import { bridgePiers } from './bridges';

export const TILE_COLORS: Record<number, string> = {
  [T.Grass]: '#7ccf55',
  [T.Forest]: '#4fa046',
  [T.Path]: '#dcb878',
  [T.Sand]: '#f1dc9c',
  [T.Water]: '#c9b98a',
  [T.Rocky]: '#9b958c',
  [T.Plaza]: '#cfc6b3',
  [T.Bridge]: '#c9b98a',
  [T.Field]: '#b58a4e',
  [T.Camp]: '#a88a5e',
};

/** Builds the flat-shaded, vertex-coloured terrain mesh. */
export function buildTerrain(map: WorldMap): THREE.Mesh {
  const W = map.width;
  const H = map.height;
  const W1 = W + 1;
  const positions = new Float32Array(W1 * (H + 1) * 3);
  const colors = new Float32Array(W1 * (H + 1) * 3);
  const c = new THREE.Color();
  const acc = new THREE.Color();
  const tileColor = Object.fromEntries(Object.entries(TILE_COLORS).map(([k, v]) => [k, new THREE.Color(v)]));
  const lush = new THREE.Color('#9ee05f');
  const deepForest = new THREE.Color('#3f8a3e');
  const dryGrass = new THREE.Color('#b3c75e');
  const cloverGrass = new THREE.Color('#4c9a45');
  const dirt = new THREE.Color('#a07d52');

  for (let vz = 0; vz <= H; vz++) {
    for (let vx = 0; vx <= W; vx++) {
      const i = vz * W1 + vx;
      const h = map.heights[i];
      positions[i * 3] = vx;
      positions[i * 3 + 1] = h;
      positions[i * 3 + 2] = vz;
      acc.setRGB(0, 0, 0);
      let n = 0;
      for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        const tx = vx + dx;
        const tz = vz + dz;
        if (tx < 0 || tz < 0 || tx >= W || tz >= H) continue;
        const t = map.tiles[tz * W + tx];
        // Man-made surfaces dominate blends so paths read crisply against grass.
        const wgt = t === T.Path || t === T.Plaza || t === T.Bridge || t === T.Camp || t === T.Field ? 3 : t === T.Sand ? 1.6 : 1;
        c.copy(tileColor[t]).multiplyScalar(wgt);
        acc.add(c);
        n += wgt;
      }
      acc.multiplyScalar(1 / Math.max(1, n));
      // Painterly variation
      const v = fbm(vx * 0.15, vz * 0.15, 99);
      const grassy = acc.g > acc.r * 1.15;
      if (grassy) acc.lerp(v > 0.5 ? lush : deepForest, Math.abs(v - 0.5) * 0.7);
      // Higher ground is a touch lighter and cooler, underwater darker.
      if (h > 1.6 && grassy) acc.lerp(c.set('#a3b86a'), Math.min(0.5, (h - 1.6) * 0.25));
      if (h < WATER_Y) acc.multiplyScalar(0.75);
      // Stony hills: mossy patches and darker crags.
      const isRock = acc.r > 0.25 && Math.abs(acc.r - acc.b) < 0.08 && Math.abs(acc.g - acc.r) < 0.08;
      if (isRock) {
        const m = fbm(vx * 0.3, vz * 0.3, 55);
        if (m > 0.58) acc.lerp(c.set('#7fa65a'), (m - 0.58) * 2.2);
        else if (m < 0.4) acc.multiplyScalar(0.85 + m * 0.3);
      }
      if (ART.v2) {
        // Wet sand / mud just above the waterline makes the shore read as soft and damp.
        if (!grassy && h > WATER_Y - 0.1 && h < WATER_Y + 0.22) acc.multiplyScalar(0.8 + 0.2 * ((h - WATER_Y + 0.1) / 0.32));
        // Showcase ground variation: dry and lush grass patches, worn dirt.
        const sw = showcaseWeight(vx, vz);
        if (sw > 0 && grassy) {
          const n = fbm(vx * 0.33, vz * 0.33, 77);
          if (n > 0.6) acc.lerp(dryGrass, Math.min(1, (n - 0.6) * 3) * 0.55 * sw);
          else if (n < 0.38) acc.lerp(cloverGrass, Math.min(1, (0.38 - n) * 3) * 0.5 * sw);
          const m = fbm(vx * 0.45 + 9, vz * 0.45, 88);
          if (m > 0.66) acc.lerp(dirt, Math.min(1, (m - 0.66) * 4) * 0.6 * sw);
        }
      }
      const k = 0.94 + Math.random() * 0.1;
      colors[i * 3] = acc.r * k;
      colors[i * 3 + 1] = acc.g * k;
      colors[i * 3 + 2] = acc.b * k;
    }
  }
  const index: number[] = [];
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const a = z * W1 + x;
      const b = a + 1;
      const d = a + W1;
      const e = d + 1;
      // Alternate diagonals for a less regular faceted look.
      if ((x + z) % 2 === 0) index.push(a, d, b, b, d, e);
      else index.push(a, d, e, a, e, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

/** Stylised water with depth tint, ripples, sparkles and shoreline foam driven by a baked height texture. */
export function buildWater(map: WorldMap, time: { value: number }): THREE.Mesh {
  return ART.v2 ? buildWaterV2(map, time) : buildWaterClassic(map, time);
}

function buildWaterClassic(map: WorldMap, time: { value: number }): THREE.Mesh {
  const W1 = map.width + 1;
  const H1 = map.height + 1;
  const data = new Uint8Array(W1 * H1 * 4);
  for (let i = 0; i < W1 * H1; i++) {
    const v = Math.max(0, Math.min(255, Math.round(((map.heights[i] + 4) / 10) * 255)));
    data[i * 4] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, W1, H1, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;

  const size = 420;
  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uHeight: { value: tex },
        uSize: { value: new THREE.Vector2(W1, H1) },
        uWaterY: { value: WATER_Y },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform sampler2D uHeight;
      uniform vec2 uSize;
      uniform float uWaterY;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      void main() {
        vec2 uv = (vWorld.xz + 0.5) / uSize;
        float h = -3.0;
        if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) h = texture2D(uHeight, uv).r * 10.0 - 4.0;
        float depth = clamp((uWaterY - h) / 1.3, 0.0, 1.0);
        vec3 shallow = vec3(0.30, 0.86, 0.84);
        vec3 deep = vec3(0.07, 0.36, 0.70);
        vec3 col = mix(shallow, deep, smoothstep(0.0, 1.0, depth));
        float t = uTime;
        float w = sin(vWorld.x * 1.3 + t * 1.1) * sin(vWorld.z * 1.1 - t * 0.9) + 0.6 * sin((vWorld.x + vWorld.z) * 0.6 + t * 0.7);
        col += vec3(0.05, 0.06, 0.07) * w;
        float sp = pow(max(0.0, sin(vWorld.x * 2.9 + t * 1.7) * sin(vWorld.z * 2.6 - t * 1.4)), 30.0);
        col += vec3(sp * 0.6);
        float edge = depth - 0.04 * sin(t * 2.2 + vWorld.x * 2.1 + vWorld.z * 1.7);
        float foam = smoothstep(0.13, 0.02, edge);
        col = mix(col, vec3(0.97, 1.0, 1.0), foam * 0.85);
        gl_FragColor = vec4(col, mix(0.72, 0.93, depth) + foam * 0.1);
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.uTime = time;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(map.width / 2, WATER_Y, map.height / 2);
  mesh.renderOrder = 1;
  mesh.name = 'water';
  return mesh;
}

/**
 * Phase 2A water: depth-tinted turquoise → deep blue, two layers of flowing value-noise ripples
 * (following the river's course), fresnel sky reflection, a soft sun glint instead of sparkles,
 * a feathered shoreline with thin broken foam, and ripple rings around bridge pilings.
 * Data texture: R = terrain height, G = piling proximity.
 */
function buildWaterV2(map: WorldMap, time: { value: number }): THREE.Mesh {
  const W1 = map.width + 1;
  const H1 = map.height + 1;
  const data = new Uint8Array(W1 * H1 * 4);
  const piers = bridgePiers(map);
  for (let vz = 0; vz < H1; vz++) {
    for (let vx = 0; vx < W1; vx++) {
      const i = vz * W1 + vx;
      data[i * 4] = Math.max(0, Math.min(255, Math.round(((map.heights[i] + 4) / 10) * 255)));
      let near = 0;
      for (const p of piers) {
        const d = Math.hypot(p.x - vx, p.z - vz);
        if (d < 1.1) near = Math.max(near, 1 - d / 1.1);
      }
      data[i * 4 + 1] = Math.round(near * 255);
      data[i * 4 + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, W1, H1, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;

  const c = (hex: string) => new THREE.Color(hex);
  const geo = new THREE.PlaneGeometry(420, 420, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uHeight: { value: tex },
        uSize: { value: new THREE.Vector2(W1, H1) },
        uWaterY: { value: WATER_Y },
        uSunDir: { value: new THREE.Vector3(14, 26, 8).normalize() },
        uShallow: { value: c(PALETTE.waterShallow) },
        uMid: { value: c(PALETTE.waterMid) },
        uDeep: { value: c(PALETTE.waterDeep) },
        uSkyLow: { value: c('#cfe6ea') },
        uSkyHigh: { value: c('#8fc3dd') },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform sampler2D uHeight;
      uniform vec2 uSize;
      uniform float uWaterY;
      uniform vec3 uSunDir;
      uniform vec3 uShallow;
      uniform vec3 uMid;
      uniform vec3 uDeep;
      uniform vec3 uSkyLow;
      uniform vec3 uSkyHigh;
      varying vec3 vWorld;
      #include <fog_pars_fragment>

      // Sine-free hash: stable on mobile GPUs.
      float hash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float riverX(float z) { return 38.0 + 3.5 * sin(z * 0.08) + 1.5 * sin(z * 0.23 + 1.0); }

      void main() {
        vec2 uv = (vWorld.xz + 0.5) / uSize;
        float h = -3.0;
        float pier = 0.0;
        if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
          vec4 d = texture2D(uHeight, uv);
          h = d.r * 10.0 - 4.0;
          pier = d.g;
        }
        float depth = clamp((uWaterY - h) / 1.4, 0.0, 1.0);

        // Flow follows the river's course; open water drifts gently.
        float dxdz = 0.28 * cos(vWorld.z * 0.08) + 0.345 * cos(vWorld.z * 0.23 + 1.0);
        float inRiver = 1.0 - smoothstep(4.0, 7.0, abs(vWorld.x - riverX(vWorld.z)));
        vec2 flow = mix(vec2(0.12, 0.08), normalize(vec2(dxdz, 1.0)) * 0.6, inRiver);
        float t = uTime;
        vec2 p = vWorld.xz;
        vec2 q1 = p * vec2(0.8, 0.55) - flow * t;
        float e = 0.2;
        float n1 = vnoise(q1);
        vec2 g = vec2(vnoise(q1 + vec2(e, 0.0)) - n1, vnoise(q1 + vec2(0.0, e)) - n1) / e;
        #ifndef WATER_LQ
          vec2 q2 = p * 1.6 + vec2(-flow.y, flow.x) * t * 0.35 - flow * t * 1.4;
          float n2 = vnoise(q2);
          g += 0.5 * vec2(vnoise(q2 + vec2(e, 0.0)) - n2, vnoise(q2 + vec2(0.0, e)) - n2) / e;
        #endif
        vec3 N = normalize(vec3(-g.x * 0.42, 1.0, -g.y * 0.42));
        vec3 V = normalize(cameraPosition - vWorld);

        vec3 col = mix(uShallow, uMid, smoothstep(0.0, 0.45, depth));
        col = mix(col, uDeep, smoothstep(0.45, 1.0, depth));
        col *= 0.93 + 0.14 * n1;
        // Gentle light streaks running with the current.
        float streak = vnoise(vec2(dot(p, normalize(flow + 1e-4)) * 0.35, dot(p, vec2(-flow.y, flow.x)) * 2.2) - vec2(t * 0.5, 0.0));
        col += vec3(0.05, 0.08, 0.08) * smoothstep(0.62, 0.9, streak) * (0.4 + inRiver);

        float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
        vec3 sky = mix(uSkyLow, uSkyHigh, clamp(N.y * 2.0 - 1.0 + 0.5, 0.0, 1.0));
        col = mix(col, sky, 0.1 + fres * 0.4);
        vec3 H = normalize(uSunDir + V);
        col += vec3(1.0, 0.95, 0.82) * pow(max(dot(N, H), 0.0), 120.0) * 0.32;

        // Feathered shoreline: thin, broken foam line, then the water fades into the sand.
        float br = vnoise(p * 2.5 + vec2(t * 0.25, -t * 0.2));
        float foam = smoothstep(0.09, 0.0, depth - 0.025 + (br - 0.5) * 0.06) * 0.5;
        // Ripple rings and wake around bridge pilings.
        foam += smoothstep(0.7, 1.0, pier) * 0.45 + smoothstep(0.6, 1.0, sin(pier * 16.0 - t * 2.4)) * pier * 0.28;
        foam = clamp(foam, 0.0, 0.75);
        col = mix(col, vec3(0.92, 0.97, 0.95), foam);

        float alpha = mix(0.0, 0.9, smoothstep(0.0, 0.12, depth));
        alpha = max(alpha, foam * 0.85);
        gl_FragColor = vec4(col, alpha);
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.uTime = time;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(map.width / 2, WATER_Y, map.height / 2);
  mesh.renderOrder = 1;
  mesh.name = 'water';
  return mesh;
}

/** Cheaper water on the Low graphics setting (one ripple layer). */
export function setWaterQuality(water: THREE.Mesh, low: boolean) {
  const m = water.material as THREE.ShaderMaterial;
  if (!m.defines) m.defines = {};
  const has = 'WATER_LQ' in m.defines;
  if (low && !has) m.defines.WATER_LQ = '';
  else if (!low && has) delete m.defines.WATER_LQ;
  else return;
  m.needsUpdate = true;
}
