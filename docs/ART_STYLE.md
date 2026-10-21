# Brightwater Art Style Guide (Phase 2A)

**Direction:** a storybook fantasy diorama. Characters are soft, rounded and expressive; the world is crisp, faceted low-poly with hand-painted colour. It should look warm, saturated and inviting, with warm sunlight and cool shade. It is never photoreal, never cubic, and never neon.

Everything is generated in code (geometry, canvas textures, shaders). No external art assets are used, so every asset is original.

## 1. Two material families

| Family | Used for | Shading | Why |
|---|---|---|---|
| **Soft** | Characters, creatures, held tools | Smooth normals, Lambert plus a warm rim light | Organic shapes read as alive and make silhouettes pop against the ground when seen from above |
| **Faceted** | Terrain, trees, rocks, props, buildings | Flat-shaded facets, vertex colour with slight per-face jitter | A painterly low-poly world that stays cheap on mobile |

Textured surfaces (canvas textures) are reserved for **hero architecture and close-up materials**: roof shingles, fitted stone, wood planks and lime plaster. Their textures are tiled at a constant world density (about one repeat per metre), so a texture never looks stretched.

## 2. Character proportions

- About **4.5 heads tall** (around 1.8 world units). The head is slightly enlarged so faces stay readable from the gameplay camera.
- **Head:** a sphere slightly taller than wide. A painted face decal (eyes with two highlights, lid line, brows, nose shading, mouth, blush) sits on a 120° spherical patch. Eyes blink every 2.5–5.5 seconds.
- **Hair:** a cap tilted back to show the forehead, a back volume that never covers the face, and soft rounded locks for the fringe and crown. Avoid cones and spikes, which read as horns.
- **Torso:** a lathed tunic tapering from chest to waist, with **layered clothing**: an open-front jerkin or shawl, a belt with a buckle, a pouch, and a collar.
- **Arms:** a sleeve, a skin or sleeve forearm, a leather bracer, and a **hand with a palm, curled fingers and a thumb**.
- **Legs:** capsule thigh and shin, with a **boot made of shaft, folded cuff, rounded toe and dark sole**.
- **Body types:** *Broad* has wider shoulders. *Slender* has a narrower chest and slightly wider hips.

### Joints and animation
The skeleton is hips → spine → head, with thigh → knee and arm → elbow → hand. Poses are written as target rotations and blended with critically damped smoothing, so walk, idle and attack transitions never pop.

- **Walk:** opposing arm and leg swing, knee flex during swing-through, pelvis twist with spine counter-twist, and a two-beat bob.
- **Idle:** breathing, a slow weight shift and head glances.
- **Melee:** anticipation, strike, then follow-through, with torso twist and a lunge step.
- **Ranged:** turned side-on, with a full draw and release.
- **Magic:** both arms raise, then the staff thrusts.
- **Chop and mine:** a two-handed overhead swing in a planted stance.

### Budget per character
At most about 16 meshes (each body segment is merged into one draw call with one shared material) and **under 9k triangles**. The face decal is the only extra material.

## 3. Colour

| Token | Hex | Notes |
|---|---|---|
| Grass | `#7ccf55`, lush `#9ee05f`, dry `#b3c75e` | Grass is never one flat green; low-frequency patches vary it |
| Path / dirt | `#dcb878` / `#a07d52` | Worn earth patches are lighter in the centre so they don't read as holes |
| Stone | `#a9a196` | Warm grey; moss accents `#7fa65a` |
| Timber | `#6b4426` | Darkest structural value in the scene |
| Plaster | `#efe4cc` | Warm off-white, never pure white |
| Water | shallow `#72d3c3` → mid `#3aa7b3` → deep `#2a6f9c` | Turquoise to deep blue by depth |
| Copper | `#d9773a`, highlight `#ffb06a`, patina `#5fae8c` | Copper ore always shows some green oxidation |
| Accent gold | `#e3b64a` | Buckles, trims, banners |

Rules:
- **Values group by role:** characters are mid-to-light, structures are mid, and timber and shadows are dark. Never put a dark character on dark ground.
- **Saturation peaks on interactables** (ore veins, glowing windows, quest markers). Background foliage is slightly less saturated.
- Glow sources (windows, lanterns, crystals, fire) use unlit warm yellows (`#ffd98a`, `#ffe08a`). They are the only unlit materials.

## 4. Lighting
- A warm key sun (`#fff0d0`) from the south-east at a high angle, with shadow maps that follow the camera.
- Hemisphere fill: sky `#dff3ff`, ground `#5d7d3a`. Shadows are cool and green-tinted, never black.
- A character rim light (in the material) replaces expensive outline passes.
- Fog matches the sky haze and starts beyond the play area, so it only softens the horizon.

## 5. Water
- Colour comes from **depth** (read from a baked height texture), not from a flat tint.
- **Ripples:** two layers of scrolling value noise. In the river they **flow along the river's course**; open water drifts gently.
- **Reflection:** fresnel sky reflection, plus a single soft sun glint. There are no scattered sparkles.
- **Shoreline:** the water's alpha fades to zero at the shore, a thin broken foam line runs along it, and the sand just above the waterline is darkened so it reads as wet.
- **Bridge pilings** get ripple rings and a wet band at the waterline. The banks get stones, pebbles, reeds, driftwood and lily pads.
- **Low** graphics drops to one ripple layer.

## 6. Level of detail
| Distance / role | Detail |
|---|---|
| Player, quest NPCs | Full soft rig (above) |
| Ordinary NPCs, enemies (until rollout) | Classic rigs |
| Hero buildings | Textured, about 7 merged meshes (stone, plaster, wood, roof, glass, cloth, trim) |
| Ordinary buildings | Vertex-coloured merged chunks |
| Ground detail | Small instanced or merged scatter (pebbles, flowers, dirt patches) inside authored areas |

## 7. Do and don't
- **Do:** rounded silhouettes for living things, chunky readable props, warm light, depth-tinted water, materials that tell a story (moss, patina, wear).
- **Don't:** cube-headed characters, photoreal textures, pure white or pure black, neon saturation, sharp specular "plastic" highlights, or detail too small to read at the gameplay zoom.

## 8. Rollout plan (not done in Phase 2A)
1. Convert the remaining villagers to the soft rig, with a per-NPC outfit palette.
2. Goblins and wolves get soft-family variants with the same joint names.
3. Apply the textured kit (shingles, stone, timber) to the other village buildings.
4. Give tin and iron rocks their own mineral treatments (tin: silver-grey crystals; iron: rust-red banding).
5. Extend ground scatter to every region, with region palettes (forest floor, hill scree, camp mud).
6. Once art is final, bake the character rig into a single skinned mesh to drop draw calls further.

The **Settings → Visual style** toggle (Phase 2A / Classic) stays until the rollout is approved, so the two looks can be compared on real devices.
