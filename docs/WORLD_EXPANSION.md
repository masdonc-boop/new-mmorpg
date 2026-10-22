# Brightwater world expansion (Phase 4A)

Phase 4A grows Brightwater from one island into a world with more to explore. It keeps the game's look, controls, systems and multiplayer foundation exactly as they are.

## 1. Audit of the existing world (October 2026)

### Map and terrain
- **One generated map** (`src/sim/worldmap.ts`, seed 1337), 112 × 112 tiles: a round island in a sea.
  - **Heights** come from a noise field, shaped by:
    - the eastern hills;
    - a gentle rise for the northern woods;
    - flattened ground for the village and the goblin camp;
    - a river channel (`riverX`);
    - the coast.
  - **Tiles:** grass, forest, path, sand, water, rocky, plaza, bridge, field, camp and cave.
- **Glimmer Hollow** is carved into an unused corner of the same map, beyond the southern sea, and reached only through its passages.
- **The map border** is blocked, and the sea is blocked water. No raised walls are needed: you can't leave the island except through the Hollow's passages.
- **Everything is placed by one random stream**, in a fixed order:
  1. buildings and props;
  2. resource clusters;
  3. a scatter pass over every tile;
  4. creatures.
- **Later content** uses its own streams (`placeLater`), so adding it never moves what players already know.
- **Ids follow list order:** nodes are 1000+, NPCs 100+, creatures 5000+, passages 4500+. Anything new must be **appended**.

### Regions, settlements, roads and landmarks

| Region | Where | Levels | What's there |
|---|---|---|---|
| Brightwater Village | (56, 66) | safe | Plaza and fountain, shrine (home), bank, inn, smithy (furnace and anvil), range, campfire, stalls, allotments, tanner, spinning wheel, the house plot, the Elder (the only quest) |
| Slime Meadows | (22, 62) | 1–5 | Meadow slimes, waystone |
| Whispering Woods | (50, 26) | 5–12 | Timber wolves, trees, oaks, clear pools (glass trout), waystone |
| Ironcrag Hills | (88, 62) | mining | Copper, tin, iron, coal, glimmerite, spark quartz, warm springs (ember carp), the Hollow's mouth, waystone |
| Goblin Encampment | (86, 28) | 10–25 | Raiders, Grukk the Warlord, duskiron slag, ember vents, Snag the quartermaster |
| Southern Fields | (56, 90) | safe | Wheat, flax, seed barrow |
| Exchange Plaza | (80, 43) | trading | Exchange kiosk and clerks, bank booth, sawmill |
| Glimmer Hollow | (3–29, 99–110) | 14, dark | Gloom slimes, iron, coal, glimmerite, quartz, glowcaps |

- **Roads:** six paths from the plaza fan out to the meadow, the woods, the hills, the camp and the fields.
- **Bridges** appear where a path crosses the river.
- **Respawn:** four waystones plus the shrine.

### Creatures, NPCs, resources and quests
- **Creatures:** 5 kinds (meadow slime 2, timber wolf 7, goblin raider 11, gloom slime 14, Grukk 24). They use three procedural models: slime, wolf and goblin.
- **NPCs:** 20, of whom 7 offer services: bank ×2, shop, tanner, sawmill and Exchange clerks ×2.
- **Resources:** 17 kinds; 255 nodes on the map.
- **Quests:** 1 ("The Elder's Request").
- **Progression gaps:**
  - nothing holds a level 25–40 player's attention outside the encampment and the dark Hollow;
  - there are no settlements outside the village;
  - there is only one quest.

### How the world meets multiplayer (Phases 3A and 3B)
- **Zones:** the world is the same map in every zone. A zone is chosen by *where you stand* (`src/sim/zones.ts`):
  - the Hollow is its own shared zone;
  - the house is a personal instance;
  - **everywhere else is Brightwater**, one shared zone.
- **New land outside the Hollow and the house** is therefore part of the Brightwater zone with no changes. Zones only ever need to know their own area (`zoneArea`).
- **The server checks** the map's fingerprint (`contentVersion`) at sign-in, so clients and server always agree on the world. A world change simply asks players to reload.
- **Saves** keep positions, allotments (by index), quests and checkpoints (by id), wisps and loot (by position). Nothing stores node or creature ids, so appended content is save-safe.
- **Pathfinding** uses walkable areas worked out once per map (3B.1), so new land needs no new rules. Anything reachable by walking is found.

### Android performance today
- **Terrain:** one mesh with vertex colours, plus one water plane.
- **Scenery:** merged into 16 × 16-tile chunks (frustum-culled).
- **Resources:** one instanced mesh per type and variant **across the whole map**. These are never culled, so their cost grows with the world.
- **Creatures and NPCs:** separate small models.
- **Fog** closes in at about 3.6 × the camera distance.
- **Quality settings:** shadows (off on Low), pixel ratio, water detail.
- **The 50-bot load test:** about 4.5 ms per server tick.

## 2. Expansion plan

### The shape of the world
The map grows **eastward** (112 → 208 tiles wide, 112 → 128 tall). The island's coordinates, terrain and contents stay exactly as they are (a test fingerprints them). East of the island, across a narrow strait, lies a new landmass, **Eastreach**:

```
   x:0 ............ 112 ..................................... 208
z:0   ┌──────────────┐     Thornridge Highlands (Cairnhold,
      │  Brightwater │       Ninefold Stones, Old Watchtower)
      │    island    │   ~~~      │  heath · crags · pines · tarn
      │   Ironcrag ──┼─ Saltwind ─┤
      │    Hills     │  Causeway  │  Mirefen Marsh (Heronwick,
      │              │   ~~~      │    Sunken Shrine) · pools · reeds
      └──────────────┘            │  willows · boardwalks
z:128
```

- **The Saltwind Causeway:** a long timber causeway from the Ironcrag coast across the strait, with a ruined toll-house at its far end. It is the one way into Eastreach, so the new land is reached after the player has met the island's hills. It is easy to find: the Ironcrag road continues to it, and a signpost points the way.
- **From the causeway's end**, a road forks north up into **Thornridge** and south down into **Mirefen**. The two regions meet at a misty tree line, so the land reads as one place rather than islands of content.

### Regions in Phase 4A (as planned; see section 4 for what was built)

**Mirefen Marsh**, combat levels 15–30.
- **Theme:** a low green-gold wetland of reed beds, still pools, willow groves and plank boardwalks.
- **Heronwick:** a fishing village on a dry rise, with:
  - a bank, a provisioner, a cooking fire and a waystone;
  - the village reeve, who gives the region's quest.
- **Landmark:** the half-drowned **Sunken Shrine** in the far marsh. It is sealed for now: a future dungeon.
- **Creatures:**
  - **bog croakers**, giant toads, mostly peaceable (level 16);
  - **mire leeches** in the deep marsh, which hunt you (level 21);
  - the **Bog Mother**, a huge croaker guarding the shrine (level 30).
- **Resources:**
  - **willow trees** (Woodcutting 25);
  - **mire pools** for **silverpike** on a rod (Fishing 28);
  - a rare **marsh pearl**.
- **Chains:**
  - willow → willow shortbows (Fletching 30, Ranged 25) and fires (Firemaking 25);
  - silverpike → food (Cooking 26, heals 32);
  - marsh pearls → jewellery with Thornridge silver.
- **Quest:** "Lanterns of Heronwick".

**Thornridge Highlands**, combat levels 22–34.
- **Theme:** a high purple heather moor with grey crags, pine stands, a cold tarn and snow on the highest tops.
- **Cairnhold:** a shepherds' outpost of stone cottages, with:
  - a bank, a silversmith's stall, a furnace and a waystone;
  - the Warden, who gives the region's quest.
- **Landmarks:**
  - the **Ninefold Stones**, a standing-stone circle;
  - the ruined **Old Watchtower**, its door barred: a future dungeon.
- **Creatures:**
  - **bristleback boars** (level 24);
  - **ridge stalkers**, lean grey hunters of the crags (level 32).
- **Resources:** **silver veins** (Mining 30).
- **Chains:**
  - silver ore → silver bars (Smithing 30);
  - silver rings and pearl amulets (Crafting 30 and 34; the amulet joins the two regions).
- **Quest:** "The Ninefold Watch".

Both regions:
- add a **waystone** to respawn at;
- show on the **minimap and world map** with their names and level ranges;
- have **signposts** at the forks;
- use only **original** names, creatures and lore (real materials and animals, as `docs/ORIGINALITY.md` allows);
- feed the existing systems: the bag, banks, skills, recipes, trading and the Exchange (new items are tradeable like any other).

### Later (designed now, not built in 4A)
- **The Sunken Shrine:** a short dungeon under Mirefen, as a party instance (the zone system already supports instances).
- **The Old Watchtower:** a climbing dungeon in Thornridge with a boss on the roof.
- **Frostmere:** a snowfield north of Thornridge (levels 40–55), with a frozen-lake fishing camp.
- **The Ashen Barrens:** volcanic badlands south-east of Mirefen (levels 45–60), the source of the encampment's ember glass.
- **Saltwind Harbour:** a ferry from Heronwick to future continents, and the natural home for the racial starting regions (`docs/MULTIPLAYER.md` 4.3).
- **More quests** for the island's existing NPCs (the smith, the farmer, Snag the goblin quartermaster).

## 3. Rules the implementation follows
- **The island stays the island.** Its tiles, heights, buildings, resources, creatures, NPCs, scenery, passages and stations are fingerprinted by a test. All new content uses its own random streams and is appended to every list, so ids and positions players know never change.
- **New land joins the Brightwater shared zone.** The Hollow and the house stay as they are. Pathfinding, snapshots and interest management work unchanged.
- **Phones first:**
  - new scenery goes into the existing 16-tile chunks;
  - resources are split into spatial chunks so off-screen ones are culled;
  - new creature models are a few boxes each, like the existing ones;
  - no new textures.
- **Tests:**
  - the island is unchanged;
  - every new region is reachable on foot from the village, and nothing walkable is cut off;
  - nothing spawns inside walls or water, and every settlement service works;
  - the new resource chains and quests run end to end;
  - old saves load.

## 4. What Phase 4A built

### The world
- **The map** is 208 × 128 tiles. The island is generated exactly as before; a test fingerprints its tiles, heights, resources, creatures, NPCs and scenery. Only the trail to the causeway and one signpost are new on the island.
- **The Saltwind Causeway:** a long timber causeway on row 62 from the end of the Ironcrag road (signposted) to a headland with a fork. There, roads run north to Cairnhold and south to Heronwick.
- **New ground:** heather moor, snow, marsh peat, crags, pine stands, a tarn, still pools with plank boardwalks, and sandy coasts.
- **New places on the map** (with arrival banners and minimap and world-map labels):
  - Saltwind Causeway;
  - Thornridge Highlands, Cairnhold, Ninefold Stones, Old Watchtower;
  - Mirefen Marsh, Heronwick, Sunken Shrine.
- **World map labels** hide when they would overlap (larger regions win); zoom in to see the smaller places.
- `regionAt` now prefers the smallest place that contains a point. Island regions never overlap, so the island is unaffected.

### Mirefen Marsh and Heronwick (levels 15–30)

| | |
|---|---|
| Settlement | Heronwick: the reeve's house, the bank strongroom, three cottages, Tull's Provisions, a cooking fire, lanterns, the Heronwick waystone |
| NPCs | Reeve Odalys Fenn (quest), Brannoc Tull (shop), Hesper Vane (bank), Wyn Silverhook (fisher; pickpocket at Thieving 30) |
| Resources | 11 willow trees (Woodcutting 25) by the pools; 5 mire pools with lily pads (silverpike, Fishing 28, rod; rare marsh pearl) |
| Chains | Willow → willow shortbow (Fletching 30, wield at Ranged 25) and fires (Firemaking 25). Silverpike → cooked at the fire or any range (Cooking 26, heals 32). Marsh pearl → Mirepearl amulet (with Thornridge silver). Mire oil → the quest, and sells. |
| Creatures | Bog croaker (16, peaceable, toad model) ×8; mire leech (21, aggressive, leech model) ×6; the Bog Mother (30, boss) by the shrine |
| Landmark | The Sunken Shrine: drowned pillars round a sealed door, half in the sea (future dungeon) |
| Quest | Lanterns of Heronwick: 4 willow logs → defeat 5 leeches → 4 mire oil → defeat the Bog Mother. Rewards: 1,500 coins, 5 silverpike, a marsh pearl, Woodcutting, Firemaking and Hitpoints xp |

### Thornridge Highlands and Cairnhold (levels 22–34)

| | |
|---|---|
| Settlement | Cairnhold: the Warden's lodge, three stone cottages, Brask Silverwork with its furnace, a bank stall, the Cairnhold waystone |
| NPCs | Warden Halvard Crane (quest), Ottilie Brask (silversmith, shop), Joss Ambry (bank), Fenna Lowe (shepherd; walks the pasture; pickpocket at Thieving 20) |
| Resources | 9 silver veins (Mining 30) in the crags; 2 clear pools at the tarn (glass trout) |
| Chains | Silver ore → silver bar (Smithing 30) → Thornridge band (Crafting 30, ring) and Mirepearl amulet (Crafting 34, neck; needs a Mirefen marsh pearl, so the two regions trade with each other) |
| Creatures | Bristleback boar (24, aggressive, boar model) ×8; ridge stalker (32, aggressive) ×6; Greymane (34, boss) by the watchtower |
| Landmarks | The Ninefold Stones (nine standing stones in a clearing, the high road through the middle); the Old Watchtower (barred; future dungeon) |
| Quest | The Ninefold Watch: defeat 4 stalkers → 2 silver bars → defeat Greymane. Rewards: 1,800 coins, a Thornridge band, 2 silver bars, Mining, Smithing and Hitpoints xp |

Greymane is new compared with the plan in section 2: the highlands needed a boss to end their quest, as Mirefen has the Bog Mother.

### Systems touched
- **Items:** 11 new items. All are ordinary items: they fit the 28-slot bag, bank, trade and sell to shops. Six of them are also stocked by the practice market's simulated traders (`PRACTICE_ITEMS`). Guide prices start from item value.
- **Bosses** are marked in the creature data (`boss`). A boss always fights whoever comes close and shows larger on the minimap; previously this was a hard-coded check for the goblin warlord.
- **Saves:** nothing new is stored by id except checkpoints (`heronwick`, `cairnhold`) and quest ids. Positions in Eastreach save and load (tested in the simulation and in the browser).
- **Multiplayer:** Eastreach is part of the shared Brightwater zone. Snapshots are already filtered to what is near each player, so more creatures don't mean more traffic for players elsewhere. The map's fingerprint (`contentVersion`) changed, so clients must reload to join a server running this build.

### Performance (Android)
- **Terrain** is drawn in 32 × 32-tile chunks that share one set of vertex buffers, so off-screen chunks are culled at no extra memory cost. Sea floor deeper than 1.5 below the water (about 40% of the map) isn't drawn. Taps on the open sea still give a target, using a plane at sea-floor depth.
- **Resources** are drawn in 32-tile chunks, so the whole map's trees and rocks are no longer drawn every frame. Each chunk's bounds come from its real transforms; hidden instances would otherwise stretch them to the origin.
- **New creature models** are a few boxes each, like the wolf.
- **Draw calls** in a mobile-sized browser (software rendering, so frame times aren't meaningful):

  | Where | Draw calls |
  |---|---|
  | Island village | 266 |
  | Island woods | 227 |
  | Heronwick | 209 |
  | Croaker marsh | 248 |
  | Cairnhold | 206 |
  | Ninefold Stones | 152–190 |
  | Old Watchtower | 186 |

  Eastreach stays inside the island's existing budget.
- **Test with real phones before anything public:** frame rate on a mid-range Android while walking the causeway and fighting in a group of croakers.

### Tests
- `tests/world-expansion.test.ts` checks:
  - the island is unchanged and deterministic;
  - every landmark can be walked to from the village;
  - at least 98.5% of Eastreach's open ground is connected (no trapping pockets);
  - regions and zones;
  - every earlier save fixture loads in the same place;
  - walking the causeway in the simulation works.
- `tests/mirefen.test.ts` and `tests/thornridge.test.ts` check:
  - every settlement service: bank, shop, station, waystone;
  - NPCs can be reached;
  - creatures spawn on open ground (not water, walls, roads or villages) and can be reached;
  - resources sit on the right ground and can be reached;
  - every resource chain runs end to end, including equipping the results;
  - creature behaviour: peaceable, aggressive, out-levelled, boss;
  - each quest runs end to end across a save and load, and both quests can run at once.
- The existing skill audit now covers the new resource types and stations, including reachability.
- `tools/mobile-smoke.cjs` (Android-sized touch screen) adds three checks:
  - tapping a willow in Mirefen starts gathering;
  - tapping the ground walks there (picking on the chunked terrain);
  - saving and reloading in Eastreach keeps you there.

### Not done yet
- ~~The two dungeons~~: built in Phase 4C (`docs/DUNGEONS.md`).
- **Frostmere, the Ashen Barrens, Saltwind Harbour and more island quests** remain design only (section 2).
- **No quest has level requirements.** A low-level player can accept either regional quest; the region's creatures are the gate.
- **Travel:** there is no waystone teleport, so reaching Eastreach is a walk of about a minute from the village.
- **Measurements:** frame rate and memory on real Android phones have not been measured for the larger map; the numbers above come from software rendering.
