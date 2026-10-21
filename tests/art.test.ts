import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ART, showcaseWeight } from '../src/render/art';
import { HeroModel, RIG, footAt, gaitParams, legIK } from '../src/render/hero';
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

  it('builds every outfit and NPC variant on the shared rig', () => {
    const variants = [
      { ...look, armor: 'guard' as const, helmet: true, beard: true, build: 1.12, height: 1.04 },
      { ...look, age: 'old' as const, robe: true, build: 0.95 },
      { ...look, bodyType: 1 as const, build: 0.9, beard: false, cape: '#8a3d5c' },
    ];
    for (const v of variants) {
      const m = new HeroModel(v);
      m.setTool('spear');
      for (const pose of POSES) m.update(1 / 30, pose, pose === 'walk' ? 1.5 : 0, 99, 1);
      expect(m.meshCount()).toBeLessThanOrEqual(17);
      expect(m.triangleCount()).toBeLessThan(10000);
      m.dispose();
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
    // Walking swings the legs apart; stopping settles back to the same rest stance as a fresh rig.
    for (let i = 0; i < 10; i++) m.update(1 / 30, 'walk', 4.4, 99, i / 30);
    const walking = Math.abs(m.joints.thighL.rotation.x - m.joints.thighR.rotation.x);
    for (let i = 0; i < 60; i++) m.update(1 / 30, 'idle', 0, 99, 5 + i / 30);
    const fresh = new HeroModel(look);
    for (let i = 0; i < 60; i++) fresh.update(1 / 30, 'idle', 0, 99, 5 + i / 30);
    expect(walking).toBeGreaterThan(0.3);
    expect(Math.abs(m.joints.thighL.rotation.x - fresh.joints.thighL.rotation.x)).toBeLessThan(0.05);
    expect(Math.abs(m.joints.kneeR.rotation.x - fresh.joints.kneeR.rotation.x)).toBeLessThan(0.05);
    fresh.dispose();
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
    expect(m.meshCount()).toBe(without + 3); // bow body + two string segments (nocked arrow hidden at rest)
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

describe('Locomotion quality', () => {
  const look = { skin: '#e8b48f', hair: '#5a3620', hairStyle: 1, tunic: '#2f7fc1', trousers: '#4a3a2a', bodyType: 0 as const };

  it('leg IK reaches the requested ankle position', () => {
    for (const [dz, dy] of [[0, -0.75], [0.3, -0.7], [-0.25, -0.72], [0.1, -0.6]]) {
      const [th, kn] = legIK(dz, dy);
      // Forward kinematics with the rig convention (rotation.x: negative = forward).
      const kx = -Math.sin(th) * RIG.thigh;
      const ky = -Math.cos(th) * RIG.thigh;
      const ax = kx - Math.sin(th + kn) * RIG.shin;
      const ay = ky - Math.cos(th + kn) * RIG.shin;
      expect(ax).toBeCloseTo(dz, 3);
      expect(ay).toBeCloseTo(dy, 3);
      expect(kn).toBeGreaterThanOrEqual(0); // knees never bend backwards
    }
  });

  it('cadence matches ground speed so a planted foot moves back exactly as fast as the body moves forward', () => {
    for (const speed of [2.2, 3.3, 4.4]) {
      const g = gaitParams(speed);
      const dt = 0.001;
      const a = footAt(0.1, g.stance, g.stride, g.lift);
      const b = footAt(0.1 + g.cadence * dt, g.stance, g.stride, g.lift);
      expect(a.planted && b.planted).toBe(true);
      expect((a.z - b.z) / dt).toBeCloseTo(speed, 1);
    }
  });

  it('keeps planted feet on the ground without sliding while the character runs forward', () => {
    const m = new HeroModel(look);
    const scene = new THREE.Scene();
    scene.add(m.root);
    const speed = 4.4;
    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) {
      m.root.position.z += speed * dt;
      m.update(dt, 'walk', speed, 99, i * dt);
    }
    const prev = { L: new THREE.Vector3(), R: new THREE.Vector3() };
    m.soleWorld('L', prev.L);
    m.soleWorld('R', prev.R);
    let contactFrames = 0;
    let slide = 0;
    let lowest = Infinity;
    for (let i = 0; i < 120; i++) {
      m.root.position.z += speed * dt;
      m.update(dt, 'walk', speed, 99, 1 + i * dt);
      for (const side of ['L', 'R'] as const) {
        const now = m.soleWorld(side, new THREE.Vector3());
        lowest = Math.min(lowest, now.y);
        if (now.y < 0.02) {
          contactFrames++;
          slide += Math.hypot(now.x - prev[side].x, now.z - prev[side].z) / dt;
        }
        prev[side].copy(now);
      }
    }
    expect(contactFrames).toBeGreaterThan(60);
    // Average speed of a foot while on the ground: far below the 4.4 u/s body speed.
    expect(slide / contactFrames).toBeLessThan(0.6);
    // Feet never sink noticeably into the ground.
    expect(lowest).toBeGreaterThan(-0.04);
    m.dispose();
  });

  it('bounces only a little while walking', () => {
    const m = new HeroModel(look);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 180; i++) {
      m.update(1 / 60, 'walk', 2.6, 99, i / 60);
      if (i > 60) {
        lo = Math.min(lo, m.joints.hips.position.y);
        hi = Math.max(hi, m.joints.hips.position.y);
      }
    }
    expect(hi - lo).toBeLessThan(0.07);
    expect(hi - lo).toBeGreaterThan(0.005);
    m.dispose();
  });
});

describe('Bow handling', () => {
  const look = { skin: '#e8b48f', hair: '#5a3620', hairStyle: 1, tunic: '#2f7fc1', trousers: '#4a3a2a', bodyType: 0 as const };
  const settle = (m: HeroModel, ready: number, aim: number, draw: number, swingAge = 99) => {
    m.setCombat(ready, aim, draw);
    for (let i = 0; i < 90; i++) m.update(1 / 60, 'idle', 0, swingAge, i / 60);
  };

  it('grips the bow at the riser, with the string clear behind the hand', () => {
    const m = new HeroModel(look);
    m.setTool('bow');
    m.style = 'ranged';
    settle(m, 0, 0, 0);
    const b = m.debugBow();
    expect(b.grip.distanceTo(b.handL)).toBeLessThan(0.02); // grip is in the palm
    expect(b.stringLocalX).toBeLessThan(-0.12); // the string sits well behind the grip
    expect(Math.abs(b.up.y)).toBeLessThan(0.3); // carried horizontally at the side, limbs front to back
    expect(Math.abs(b.up.z)).toBeGreaterThan(0.9);
    m.dispose();
  });

  it('raises the bow toward the target and draws the string to the drawing hand', () => {
    const m = new HeroModel(look);
    m.setTool('bow');
    m.style = 'ranged';
    settle(m, 1, 1, 1);
    const b = m.debugBow();
    expect(b.up.y).toBeGreaterThan(0.9); // limbs vertical
    expect(b.belly.z).toBeGreaterThan(0.9); // belly faces the character's facing (+z)
    expect(b.grip.y).toBeGreaterThan(1.2); // raised to shoulder height
    expect(b.nock.distanceTo(b.handR)).toBeLessThan(0.2); // drawing hand holds the string
    expect(b.nock.z).toBeLessThan(b.grip.z - 0.4); // string pulled back toward the archer
    const origin = new THREE.Vector3();
    expect(m.projectileOrigin(origin)).toBe(true);
    expect(origin.distanceTo(b.grip)).toBeLessThan(0.08); // arrows leave from the bow
    m.dispose();
  });

  it('releases: the string snaps back and the nocked arrow disappears', () => {
    const m = new HeroModel(look);
    m.setTool('bow');
    m.style = 'ranged';
    settle(m, 1, 1, 1);
    m.setCombat(1, 1, 1);
    m.update(1 / 60, 'attack', 0, 0.02, 2);
    const b = m.debugBow();
    expect(b.nock.distanceTo(b.grip)).toBeLessThan(0.25);
    m.dispose();
  });

  it('carries the sword pointing down when relaxed and levels it when ready', () => {
    const m = new HeroModel(look);
    m.setTool('sword');
    const blade = () => {
      const sword = (m as unknown as { tools: Map<string, THREE.Object3D> }).tools.get('sword')!;
      m.root.updateWorldMatrix(true, true);
      return new THREE.Vector3(0, 1, 0).transformDirection(sword.matrixWorld);
    };
    settle(m, 0, 0, 0);
    expect(blade().y).toBeLessThan(-0.5);
    settle(m, 1, 0, 0);
    expect(Math.abs(blade().y)).toBeLessThan(0.35);
    m.dispose();
  });
  it('keeps a guard spear and walking staff upright in the hand while idle and walking', () => {
    for (const tool of ['spear', 'walkingstaff'] as const) {
      const m = new HeroModel({ ...look, armor: 'guard', helmet: true });
      m.setTool(tool);
      const shaft = () => {
        const t = (m as unknown as { tools: Map<string, THREE.Object3D> }).tools.get(tool)!;
        m.root.updateWorldMatrix(true, true);
        return new THREE.Vector3(0, 1, 0).transformDirection(t.matrixWorld);
      };
      for (let i = 0; i < 60; i++) m.update(1 / 30, 'idle', 0, 99, i / 30);
      expect(shaft().y).toBeGreaterThan(0.95);
      for (let i = 0; i < 60; i++) {
        m.update(1 / 30, 'walk', 1.5, 99, i / 30);
        expect(shaft().y).toBeGreaterThan(0.9);
      }
      m.dispose();
    }
  });
});

describe('Arm swing and bow carry clearance', () => {
  const look = { skin: '#e8b48f', hair: '#5a3620', hairStyle: 1, tunic: '#2f7fc1', trousers: '#4a3a2a', bodyType: 0 as const };
  const handX = (m: HeroModel, side: 'L' | 'R') => {
    m.root.updateWorldMatrix(true, true);
    const h = (m as unknown as Record<string, THREE.Object3D>)[`hand${side}`];
    return new THREE.Vector3().setFromMatrixPosition(h.matrixWorld);
  };

  it('keeps the hands outside the hips at rest and on every frame of walking and running', () => {
    for (const speed of [0, 1.6, 4.4]) {
      const m = new HeroModel(look);
      for (let i = 0; i < 180; i++) {
        m.update(1 / 60, speed ? 'walk' : 'idle', speed, 99, i / 60);
        if (i < 60) continue;
        expect(-handX(m, 'L').x).toBeGreaterThan(0.27);
        expect(handX(m, 'R').x).toBeGreaterThan(0.27);
      }
      m.dispose();
    }
  });

  it('swings the arms forward and back in opposition while walking', () => {
    const m = new HeroModel(look);
    let minDiff = Infinity;
    let maxDiff = -Infinity;
    for (let i = 0; i < 240; i++) {
      m.update(1 / 60, 'walk', 1.6, 99, i / 60);
      if (i < 90) continue;
      const d = handX(m, 'L').z - handX(m, 'R').z;
      minDiff = Math.min(minDiff, d);
      maxDiff = Math.max(maxDiff, d);
    }
    expect(maxDiff).toBeGreaterThan(0.25);
    expect(minDiff).toBeLessThan(-0.25);
    m.dispose();
  });

  it('carries the bow horizontally at the side, outside the body', () => {
    for (const speed of [0, 1.6]) {
      const m = new HeroModel(look);
      m.setTool('bow');
      for (let i = 0; i < 150; i++) {
        m.update(1 / 60, speed ? 'walk' : 'idle', speed, 99, i / 60);
        if (i < 60) continue;
        const b = m.debugBow();
        expect(-b.grip.x).toBeGreaterThan(0.27);
        // Limbs horizontal, front to back, string on top (belly down).
        expect(Math.abs(b.up.y)).toBeLessThan(0.35);
        expect(Math.abs(b.up.z)).toBeGreaterThan(0.9);
        expect(b.belly.y).toBeLessThan(-0.8);
        // Both limb tips stay outside the leg line.
        expect(-b.grip.x - 0.05).toBeGreaterThan(0.22);
      }
      m.dispose();
    }
  });

  it('uses a hand-sized wand: tip down at rest, pointing ahead when casting, spells leave from the tip', () => {
    const m = new HeroModel(look);
    m.setTool('staff');
    const wand = (m as unknown as { tools: Map<string, THREE.Object3D> }).tools.get('staff')!;
    m.root.updateWorldMatrix(true, true);
    const size = new THREE.Box3().setFromObject(wand).getSize(new THREE.Vector3());
    expect(Math.max(size.x, size.y, size.z)).toBeLessThan(0.5);
    for (let i = 0; i < 90; i++) m.update(1 / 60, 'idle', 0, 99, i / 60);
    const tip = new THREE.Vector3();
    expect(m.projectileOrigin(tip)).toBe(true);
    const hand = handX(m, 'R');
    expect(tip.y).toBeLessThan(hand.y - 0.2);
    m.setCombat(1, 0, 0);
    for (let i = 0; i < 90; i++) m.update(1 / 60, 'idle', 0, 99, i / 60);
    m.projectileOrigin(tip);
    const h2 = handX(m, 'R');
    expect(tip.z - h2.z).toBeGreaterThan(0.25);
    m.dispose();
  });

  it('runs a real shot cycle: the draw hand returns to the string, nocks, and pulls it back to the chin', () => {
    const T = 1.8; // ranged attack interval
    // Drive the rig with the game's timing for `until` seconds and report the bow state.
    const run = (until: number) => {
      const m = new HeroModel(look);
      m.setTool('bow');
      m.style = 'ranged';
      for (let tt = 0; tt < until; tt += 1 / 60) {
        const sa = tt % T;
        m.setCombat(1, 1, Math.min(1, Math.max(0, 1 - (T - sa - 0.05) / 0.8)));
        m.update(1 / 60, 'attack', 0, tt < T ? 99 : sa, tt);
      }
      const b = m.debugBow();
      m.dispose();
      return b;
    };
    // Just after a release the hand has flicked back, off the string.
    const rel = run(T * 2 + 0.08);
    expect(rel.handR.distanceTo(rel.nock)).toBeGreaterThan(0.2);
    // Nocking, before the draw starts: the hand is back on the string.
    const nocked = run(T * 2 + 0.85);
    expect(nocked.handR.distanceTo(nocked.nock)).toBeLessThan(0.12);
    // Full draw: the hand holds the string well back from the grip.
    const full = run(T * 3 - 0.03);
    expect(full.handR.distanceTo(full.nock)).toBeLessThan(0.12);
    expect(full.nock.distanceTo(full.grip)).toBeGreaterThan(0.5);
  });
});
