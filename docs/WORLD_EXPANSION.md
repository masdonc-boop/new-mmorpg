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

- **The Saltwind Causeway:** an old stone causeway from the Ironcrag coast across the strait, with a ruined toll-house at its far end. It is the one way into Eastreach, so the new land is reached after the player has met the island's hills. It is easy to find: the Ironcrag road continues to it, and a signpost points the way.
- **From the causeway's end**, a road forks north up into **Thornridge** and south down into **Mirefen**. The two regions meet at a misty tree line, so the land reads as one place rather than islands of content.

### Regions in Phase 4A (built now, complete)

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
