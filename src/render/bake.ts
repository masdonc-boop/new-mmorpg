import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Merges the rigid parts of a model (Phase 4D): within each group (a joint, a leg, the head), the
 * plain-coloured boxes that never move relative to each other become one mesh with vertex colours.
 * Characters are built from dozens of little boxes, one draw call each; after this a humanoid is
 * about ten. Joints still animate exactly as before (only their contents are merged), and the look
 * is the same (each part keeps its colour, flat-shaded).
 *
 * Left as they are: unlit parts (glowing eyes, crystals), transparent ones, anything in `keep`
 * (parts that move or scale on their own), and meshes with children.
 */
export function bakeRigidParts(root: THREE.Object3D, material: THREE.MeshLambertMaterial, keep: ReadonlySet<THREE.Object3D> = new Set()) {
  const groups: THREE.Object3D[] = [];
  root.traverse((o) => groups.push(o));
  for (const g of groups) {
    const parts = g.children.filter(
      (c): c is THREE.Mesh =>
        (c as THREE.Mesh).isMesh && !keep.has(c) && c.children.length === 0 && (c as THREE.Mesh).material instanceof THREE.MeshLambertMaterial && !((c as THREE.Mesh).material as THREE.Material).transparent,
    );
    if (parts.length < 2) continue;
    const geos: THREE.BufferGeometry[] = [];
    for (const m of parts) {
      m.updateMatrix();
      const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      geo.deleteAttribute('uv');
      if (!geo.getAttribute('normal')) geo.computeVertexNormals();
      geo.applyMatrix4(m.matrix);
      const c = (m.material as THREE.MeshLambertMaterial).color;
      const n = geo.getAttribute('position').count;
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geos.push(geo);
    }
    const merged = mergeGeometries(geos, false);
    for (const geo of geos) geo.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = parts.some((p) => p.castShadow);
    mesh.receiveShadow = parts.some((p) => p.receiveShadow);
    for (const p of parts) g.remove(p);
    g.add(mesh);
  }
}

const shared = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

/** The vertex-coloured material for baked parts: one shared, or a model's own (for its hit flash). */
export function bakedMaterial(unique: boolean): THREE.MeshLambertMaterial {
  return unique ? new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }) : shared;
}
