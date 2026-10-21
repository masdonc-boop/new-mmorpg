import * as THREE from 'three';
import { fbm } from '../core/noise';
import { T, WATER_Y, type WorldMap } from '../sim/worldmap';

export const TILE_COLORS: Record<number, string> = {
  [T.Grass]: '#7ccf55',
  [T.Forest]: '#4fa046',
  [T.Path]: '#dcb878',
  [T.Sand]: '#f1dc9c',
  [T.Water]: '#c9b98a',
  [T.Rocky]: '#a59a86',
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
