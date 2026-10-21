import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ART, showcaseWeight } from '../src/render/art';
import { HeroModel } from '../src/render/hero';
import { bridgePiers } from '../src/render/bridges';
import { buildHallV2, copperRockV2 } from '../src/render/showcase';
import { buildWater, setWaterQuality } from '../src/render/terrain';
import { NPCS } from '../src/data/npcs';
import { T, generateWorld } from '../src/sim/worldmap';
import type { HumanoidPose } from '../src/render/characters';

const map = generateWorld(1337);
const POSES: HumanoidPose[] = ['idle', 'walk', 'attack', 'chop', 'mine', 'talk', 'dead'];

describe('Phase 2A character rig', () => {
  const look = { skin: '#e8b48f', hair: '#5a3620', hairStyle: 1, tunic: '#2f7fc1', trousers: '#4a3a2a', bodyType: 0 as const };

  it('builds every hair style and body type within the mobile budget', () => {
    for (let hairStyle = 0; hairStyle < 5; hairStyle++) {
      for (const bodyType of [0, 1] as const) {
        const m = new HeroModel({ ...look, hairStyle, bodyType });
        // Merged per body segment: ~13 draw calls, < 9k triangles.
        expect(m.meshCount()).toBeLessThanOrEqual(16);
        expect(m.triangleCount()).toBeLessThan(9000);
        m.dispose();
      }
    }
  });

  it('builds the robed Elder prototype with a walking staff', () => {
    const elder = new HeroModel({ ...NPCS.elder.look, elder: true });
    elder.setTool('walkingstaff');
    expect(elder.meshCount()).toBeLessThanOrEqual(17);
    elder.dispose();
  });

  it('animates every pose and style without NaNs, blending smoothly', () => {
    const m = new HeroModel(look);
    for (const style of ['melee', 'ranged', 'magic'] as const) {
      m.style = style;
      for (const pose of POSES) {
        for (let i = 0; i < 40; i++) m.update(1 / 30, pose, pose === 'walk' ? 4.4 : 0, i / 30, i / 30);
        for (const j of Object.values(m.joints)) {
          for (const v of [j.rotation.x, j.rotation.y, j.rotation.z, j.position.y]) expect(Number.isFinite(v)).toBe(true);
        }
      }
    }
    // Walking swings the legs; idle returns them close to rest.
    for (let i = 0; i < 10; i++) m.update(1 / 30, 'walk', 4.4, 99, i / 30);
    const walking = Math.abs(m.joints.thighL.rotation.x) + Math.abs(m.joints.thighR.rotation.x);
    for (let i = 0; i < 60; i++) m.update(1 / 30, 'idle', 0, 99, 5 + i / 30);
    const idle = Math.abs(m.joints.thighL.rotation.x) + Math.abs(m.joints.thighR.rotation.x);
    expect(walking).toBeGreaterThan(0.2);
    expect(idle).toBeLessThan(0.1); // the rest stance keeps the feet slightly apart
    m.dispose();
  });

  it('shows exactly one held tool at a time', () => {
    const m = new HeroModel(look);
    m.setTool('sword');
    const withSword = m.meshCount();
    m.setTool('none');
    const without = m.meshCount();
    expect(withSword).toBe(without + 1);
    m.setTool('bow');
    expect(m.meshCount()).toBe(without + 1);
    m.dispose();
  });
});

describe('Phase 2A environment', () => {
  it('limits showcase detail to the village, east road and west bridge', () => {
    expect(showcaseWeight(56, 66)).toBe(1);
    expect(showcaseWeight(80, 58)).toBeGreaterThan(0.9);
    expect(showcaseWeight(35, 64)).toBeGreaterThan(0.9);
    expect(showcaseWeight(86, 28)).toBe(0); // goblin camp untouched
    expect(showcaseWeight(50, 26)).toBe(0); // woods untouched
  });

  it('places bridge pilings only along the outer edges of decks', () => {
    const piers = bridgePiers(map);
    expect(piers.length).toBeGreaterThan(8);
    for (const p of piers) {
      // A piling sits at a tile edge, never at a tile centre.
      const fx = p.x - Math.floor(p.x);
      const fz = p.z - Math.floor(p.z);
      expect(Math.abs(fx - 0.5) > 0.4 || Math.abs(fz - 0.5) > 0.4).toBe(true);
      // ...and the tile beside it (across the edge) is not more bridge.
      const ox = Math.floor(p.x + (fx > 0.9 ? 0.2 : fx < 0.1 ? -0.2 : 0));
      const oz = Math.floor(p.z + (fz > 0.9 ? 0.2 : fz < 0.1 ? -0.2 : 0));
      expect(map.tiles[oz * map.width + ox]).not.toBe(T.Bridge);
    }
  });

  it('builds a veined copper node with separate shiny ore and a smaller depleted state', () => {
    const full = copperRockV2(1, false);
    const dep = copperRockV2(1, true);
    const col = full.rock.getAttribute('color') as THREE.BufferAttribute;
    let veinFaces = 0;
    for (let i = 0; i < col.count; i += 3) if (col.getX(i) > col.getZ(i) * 1.6) veinFaces++;
    expect(veinFaces).toBeGreaterThan(5);
    expect(full.ore.getAttribute('position').count).toBeGreaterThan(dep.ore.getAttribute('position').count);
    full.rock.computeBoundingBox();
    dep.rock.computeBoundingBox();
    expect(dep.rock.boundingBox!.max.y).toBeLessThan(full.rock.boundingBox!.max.y);
  });

  it("keeps the detailed Elder's hall inside its collision footprint and cheap to draw", () => {
    const hall = map.buildings.find((b) => b.style === 'hall')!;
    const { group, glows } = buildHallV2(hall, map);
    expect(group.children.filter((c) => (c as THREE.Mesh).isMesh).length).toBeLessThanOrEqual(12);
    expect(glows.length).toBe(2);
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    // Walls/roof may overhang the blocked footprint slightly (eaves, steps) but not more.
    expect(size.x).toBeLessThan(hall.w + 1.3);
    expect(size.z).toBeLessThan(hall.d + 1.6);
  });
});

describe('Phase 2A water', () => {
  it('uses the new shader in Phase 2A, with a cheaper Low-quality variant', () => {
    ART.v2 = true;
    const water = buildWater(map, { value: 0 });
    const mat = water.material as THREE.ShaderMaterial;
    expect(mat.uniforms.uSunDir).toBeDefined();
    expect(mat.fragmentShader).toContain('#ifndef WATER_LQ');
    expect(mat.fragmentShader).not.toMatch(/sin\(dot\(/); // sine-free hash for mobile precision
    setWaterQuality(water, true);
    expect('WATER_LQ' in mat.defines).toBe(true);
    setWaterQuality(water, false);
    expect('WATER_LQ' in mat.defines).toBe(false);
  });

  it('keeps the classic water when the Classic style is selected', () => {
    ART.v2 = false;
    const water = buildWater(map, { value: 0 });
    expect((water.material as THREE.ShaderMaterial).uniforms.uSunDir).toBeUndefined();
    ART.v2 = true;
  });
});
