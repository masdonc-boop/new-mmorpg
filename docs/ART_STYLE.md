# Brightwater Art Style Guide (Phase 2A)

**Direction:** a storybook fantasy diorama. Characters are soft, rounded and expressive; the world is crisp, faceted low-poly with hand-painted colour. It should look warm, saturated and inviting, with warm sunlight and cool shade. It is never photoreal, never cubic, and never neon.

Everything is generated in code (geometry, canvas textures, shaders). No external art assets are used, so every asset is original.

## 1. Two material families

| Family | Used for | Shading | Why |
|---|---|---|---|
| **Soft** | Characters, creatures, held tools | Smooth normals, Lambert plus a warm rim light | Organic shapes read as alive and make silhouettes pop against the ground when seen from above |
| **Faceted** | Terrain, trees, rocks, props, buildings | Flat-shaded facets, vertex colour with slight per-face jitter | A painterly low-poly world that stays cheap on mobile |

Textured surfaces (canvas textures) are reserved for **hero architecture and close-up materials**: roof shingles, fitted stone, wood planks and lime plaster. Their textures are tiled at a constant world density (about one repeat per metre), so a texture never looks stretched.

## 2. Character proportions (revision 2: "substantial adventurer")

The target is a charming, sturdy fantasy adventurer with a handcrafted feel. It sits **between** cubic Minecraft-style figures and thin toy soldiers.

- About **4.7 heads tall** (around 1.8 world units). The head is a little smaller relative to the body than in revision 1.
- **Torso:** a broad, deep chest (chest radius 0.25, depth 0.82) that tapers to the waist, with **sloped shoulders built into the torso**. There are no separate ball shoulder caps.
- **Arms:** a rounded deltoid, a **tapered sleeve** (full at the shoulder, gathered at the elbow), a solid forearm (radius 0.064) and a leather bracer with a stitched edge.
- **Hands:** a broad palm, a knuckle row and a separate thumb, sized to read at the gameplay zoom.
- **Legs:** solid thighs (radius 0.10) and calves (radius 0.088), set apart under a wide pelvis.
- **Boots:** chunky and handmade, with a shaft, folded cuff, lace strap, rounded foot with a lighter toe cap, a heel block and a dark sole.
- **Head:** a sphere with a subtle jaw and chin volume, kept inside the face surface.
  - The **painted face** has natural oval eyes with a darker iris rim, lid shadow and lower lash line, strong brows, nose shading with nostrils, and a mouth with a fuller lower lip. Eyes blink.
- **Hair:** a cap tilted back to show the forehead, one full crown volume, a few broad swept fringe locks, and temple pieces so there is no hard "helmet edge" above the ears. Avoid many small lumps (they read as curls or a cauliflower) and avoid cones (they read as horns).
- **Clothing layers:** a tunic with a stitched hem band, an open leather jerkin, a belt with a buckle and pouch, a linen collar, and a satchel strap wrapped diagonally around the chest.
- **Handcrafted material treatment:**
  - Each garment darkens toward its lower edge (baked occlusion in vertex colour).
  - A subtle per-vertex mottle makes cloth and leather look hand-painted rather than plastic.
- **Stance:** a grounded A-stance with feet apart, soft knees, arms hanging clear of the torso with relaxed elbows, and a slight forward lean.
- **Body types:** *Broad* has wider shoulders. *Slender* has a narrower chest and slightly wider hips.

### Joints and animation (revision 3: shared rig)
Every humanoid of a human-like race uses **one rig** (`HeroModel`): hips → spine → head, thigh → knee → ankle, and arm → elbow → hand. Poses are written as target rotations and blended with critically damped smoothing, so walk, run, idle, turn and attack transitions never pop.

**Locomotion is solved, not keyframed.**
- **Legs use two-bone IK.** Each foot follows a stance/swing cycle on the ground plane, and the hip lowers only as far as the planted foot needs. Ankles keep the planted sole flat.
- **Gait is speed-synchronised:** cadence = speed × stance ÷ stride. A planted foot moves backward exactly as fast as the body moves forward, so feet never slide at any speed.
- **Walk to run is a continuous blend** (`gaitParams`):
  - stance fraction: 0.62 → 0.42
  - stride: 0.82 → 0.96 m
  - foot lift: 0.07 → 0.13 m
  - crouch: 0.035 → 0.07 m
- **Upper body:**
  - The pelvis twists with the stepping leg and the chest counter-rotates.
  - Arms swing opposite the legs, with more elbow bend when running.
  - The character leans into turns (`setTurnRate`).
  - Vertical bounce stays under about 7 cm.
- **Age changes the gait, not the rig.** The *old* age adds a stoop and a shorter, slower step.
- **Idle:** breathing, a slow weight shift and head glances.

**Weapon handling**
- **Bow:** carried in the **bow hand (left)**, gripped at the riser, with the limbs near-vertical and angled forward and out so the string stays clear of the body.
  - The attack goes **raise → draw → release → return**.
  - When aiming, the bow's orientation is solved in world space: limbs vertical with a slight cant, belly toward the target.
  - The right hand draws the string by IK along the arrow line. Only the string moves; it snaps straight on release.
  - Arrows spawn at the arrow rest (`projectileOrigin`) and fly to the target.
- **Sword:** pointing down beside the leg when relaxed, and level and forward when ready.
- **Staff:** upright when relaxed, and thrust forward when casting.
- **Spear and walking staff:** grounded carries. The shaft is solved to stay near-vertical in world space, whatever the arm is doing.
- **Melee:** anticipation, strike, then follow-through, with torso twist and a lunge step.
- **Magic:** both arms raise, then the staff thrusts.
- **Chop and mine:** a two-handed overhead swing in a planted stance.

### NPC design standard
- **Same race, same body.** Villagers, guards and the player share anatomy, proportions, face style, materials and animation quality.
- **Individuality comes from `HeroLook` parameters, never from a different model:**
  - `build` (girth) and `height`
  - `age` (young, adult or old)
  - body type, skin tone, eye colour
  - hair style and colour, beard
  - outfit colours (`outer`, `accent`)
  - kit: robe (`elder`), guard armour (`armor: 'guard'` with tabard, pauldrons and kettle helm)
  - held prop
- **Genuinely different races** (goblins, creatures) may use their own rig, but should reuse the same joint names so animation logic can be shared.
- **Props can carry their own idle.** For example, the banker holds a ledger and quill: he reads and writes, looks up now and then, and lowers the book when spoken to.
- **NPCs move with the player's locomotion system.** For example, a patrolling NPC walks at `NPC_WALK_SPEED` with the same IK gait.

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
| Still water (sea, lakes) | shallow `#4aa7a6` → mid `#22688f` → deep `#163f6b` | Dark, deep, calm |
| River | shallow `#5fc0b4` → deep `#2c7f9e` | Livelier green-turquoise, so flowing water reads differently from still water |
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

## 5. Water (revision 2)
Still water and flowing water are deliberately different.

**Still water (sea, lakes)**
- Darker, deeper blues by depth.
- **Mostly calm:** only faint, slow surface ripples (two very low-amplitude noise layers), and no visible currents.

**Rivers**
- Motion is computed in **river coordinates**: *across* is the distance from the river's centre line, and *along* follows the course. Currents therefore bend with the river.
- **Currents** are soft light and dark lanes that are long along the flow and narrow across it. They drift downstream, **faster mid-channel than at the banks**.
  - Two octaves at different speeds avoid an obviously repeating pattern.
  - There are no hard thresholds, so nothing appears as bright stripes.
- **Ripples** are stretched along the current and carried downstream.

**Both**
- Restrained fresnel sky reflection and a small, tight sun glint. **No scattered sparkles.**
- **Shoreline:** the water's alpha feathers to zero at the shore with only a thin, soft wash, and the sand just above the waterline is darkened so it reads as wet.
- **Bridge pilings** get a soft collar of white water and a wet band, with no animated rings. The banks get stones, pebbles, reeds, driftwood and lily pads.
- **Avoid:** excessive foam, sparkle, cross-river banding, and fast or repetitive animation.
- **Low** graphics drops to one noise octave for each water type.

## 6. Level of detail
| Distance / role | Detail |
|---|---|
| Player, Elder Maren, Captain Bram, Wendell the banker | Full soft rig (above) |
| Ordinary NPCs, enemies (until rollout) | Classic rigs |
| Hero buildings | Textured, about 7 merged meshes (stone, plaster, wood, roof, glass, cloth, trim) |
| Ordinary buildings | Vertex-coloured merged chunks |
| Ground detail | Small instanced or merged scatter (pebbles, flowers, dirt patches) inside authored areas |

## 7. Do and don't
- **Do:** rounded silhouettes for living things, chunky readable props, warm light, depth-tinted water, materials that tell a story (moss, patina, wear).
- **Don't:** cube-headed characters, photoreal textures, pure white or pure black, neon saturation, sharp specular "plastic" highlights, or detail too small to read at the gameplay zoom.

## 8. Rollout plan (not done in Phase 2A)
1. Convert the remaining villagers (Tilly, Hilda) to the shared rig through `HERO_NPC_LOOKS`, after the Bram prototype is approved.
2. Goblins and wolves get soft-family variants with the same joint names.
3. Apply the textured kit (shingles, stone, timber) to the other village buildings.
4. Give tin and iron rocks their own mineral treatments (tin: silver-grey crystals; iron: rust-red banding).
5. Extend ground scatter to every region, with region palettes (forest floor, hill scree, camp mud).
6. Once art is final, bake the character rig into a single skinned mesh to drop draw calls further.

The **Settings → Visual style** toggle (Phase 2A / Classic) stays until the rollout is approved, so the two looks can be compared on real devices.
