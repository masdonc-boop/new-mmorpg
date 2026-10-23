# Brightwater dungeons (Phase 4C)

Eastreach's two sealed landmarks are now dungeons: **the Sunken Shrine** under Mirefen Marsh and **the Old Watchtower** in the Thornridge Highlands. Old School RuneScape is the reference for how a dungeon feels: a door you earn, rooms of tougher creatures, a boss with guards, and a chest with a small chance of something rare. Every place, creature, item and line is Brightwater's own (`docs/ORIGINALITY.md`).

## Where they are
- **Location.** Both are carved into a stretch of the map south of everything (`src/sim/dungeonmap.ts`), far beyond the sea and the fog. The map grew from 128 to 160 tiles tall for them.
- **Getting in.** They are reached only through their doors at the surface landmarks, as Glimmer Hollow is.
- **Doors and requirements.** A door checks its dungeon's requirements (`src/data/dungeons.ts`). The simulation does the check, so a client can't skip it, and the door says what is missing. The tap hint shows the requirements, or the advised combat level.
  - Sunken Shrine: Lanterns of Heronwick and combat level 30.
  - Old Watchtower: The Ninefold Watch and combat level 35.
- **Advice and boss levels.**

  | Dungeon | Advised combat | Boss level |
  |---|---|---|
  | Sunken Shrine | 44+ | 52 |
  | Old Watchtower | 46+ | 58 |

  The requirements let players in earlier, but the advice reflects the balance tests (below).
- **Lighting.** Both are dim, not dark. A torch-coloured light follows you (teal in the shrine), and braziers and glowing pools add their own light. No lantern is needed.
- **Maps.** The underground minimap shows the dungeon (stairs and the way out bright, the chest gold). The surface map hides it. The journal has a card per dungeon.

## The Sunken Shrine
- **Entry hall:** mire leeches and a drowned acolyte.
- **The flooded hall:** glowing pools between pillars, with more acolytes and leeches.
- **The sanctum:** the Shrinekeeper with two drowned guardians, braziers, and the chest beyond.

| Creature | Level | Style | Notes |
|---|---|---|---|
| Drowned acolyte | 34 | Magic, from 5 tiles | Drops spark stones, linen, now and then a marsh pearl or a mireweave hood |
| Drowned guardian | 38 | Melee | Sanctum guard; steel bars, rarely a glimsteel helm |
| **The Shrinekeeper** | 52 (boss) | Magic, from 5.5 tiles | Rallies its guards; enrages below 40% (attacks 1.5× faster) |

## The Old Watchtower
Three floors linked by stairs:
- **Floor one:** hollow sentinels and forsworn archers among pillars.
- **Floor two:** more of both.
- **The roof:** the Last Watchcaptain with a sentinel and an archer, and the chest.

| Creature | Level | Style | Notes |
|---|---|---|---|
| Hollow sentinel | 38 | Melee | Steel bars, silver ore, rarely steel greaves |
| Forsworn archer | 36 | Ranged, from 6 tiles | Steel arrows, rowan logs, rarely a boarhide cap |
| **The Last Watchcaptain** | 58 (boss) | Melee | Rallies its guards; enrages below 35% (attacks 1.6× faster) |

## How creatures fight in dungeons
- **Ranged and magic creatures** attack from a distance. The hit is rolled when they attack, a visible arrow or bolt flies, and the damage lands when it arrives.
- **Magic** is resisted with Defence and Magic together, with armour counting half. A trained mage in robes holds up against the acolytes; a knight in plate relies on its armour.
- **Bosses rally** the creatures within 5 tiles when engaged, and **enrage** below their threshold (announced).
- **Each enemy remembers who hurt it** until it respawns; bosses respawn after two minutes.
- **The combat maths is unchanged** (`src/sim/combat.ts`); only who attacks how is new.

## Rewards
- **Claims.** Defeating a boss gives **every player who hurt it** one claim on that dungeon's chest, at most one waiting per dungeon. Bystanders get nothing.
- **The chest.** It gives its guaranteed coins and materials, one roll on its table, and a 2–3% chance at each unique. It opens only when the largest possible haul would fit in the bag, so nobody can re-roll by filling their bag; the claim waits.
- **Records.** Runs are counted, and claims and runs are saved with the character. A junk value in a save can't stockpile claims.

| Dungeon | Unique | Slot | Stats | Needs |
|---|---|---|---|---|
| Sunken Shrine | Tidecaller wand | Weapon (magic) | 46 accuracy / 39 power | Magic 45 |
| | Heronscale hood | Head | 6 armour, +6 magic accuracy, +3 magic power | Magic 40, Defence 20 |
| | Drowned signet | Ring | +3 accuracy, +4 power, 2 armour | — |
| Old Watchtower | Watchcaptain's blade | Weapon (melee) | 52 / 47 | Attack 50 |
| | Warder's longbow | Weapon (ranged, two-handed) | 50 / 36 | Ranged 45 |
| | Ninefold cloak | Cape | +2 accuracy, +2 power, 4 armour | Defence 35 |

Each unique is a step above the best crafted gear of its slot and style (tested).

## Multiplayer
- **Zones.** Each dungeon is a shared zone (`sunken_shrine`, `old_watchtower`) that the server runs all the time, like Glimmer Hollow. Players inside fight alongside each other, so groups need no party system: whoever helps defeat the boss earns a claim.
- **Unchanged protections.** Snapshots, interest management, zone hand-over and saving work as before.
- **Tested on a real server:**
  - two players share a boss kill and each opens the chest;
  - the result survives a server restart;
  - a client without the requirements can't get through the door.

## Balance (tested)
`tests/dungeon-balance.test.ts` fights each boss room in the simulation: the boss, its guards, food, and eating at half health.
- **The advised level wins.** A solo player at level 40 in the combat skills (about combat 46), in tier-30 gear with 18 silverpike, beats both bosses with melee and with ranged. A mage beats the Shrinekeeper.
- **Level 30 loses.** *(Corrected in Phase 5D: the test bot fought at a tenth of full health. From full health, level 30 wins only with a full bag of food, fails without, and level 25 fails. The bosses now also have telegraphed specials; see `docs/COMBAT.md`.)*
- **Magic against the Watchcaptain:** a solo mage at the advised level loses. Mages should bring friends or more food.

## Deferred
- **Instances and parties:** dungeons are shared zones; a private run for a group needs a party system.
- **More mechanics:** traps, puzzles, keys or levers, and boss phases beyond enrage.
- **Dungeon-only resources:** no gathering inside yet.

## Phase 4D: polish and stability

### The collection log
- **What it records:** every dungeon unique a character has had from a chest, for good. Selling, trading, banking, dropping or destroying the item doesn't remove it.
- **Where it shows:** each dungeon's journal card has a row of its three uniques, found ones in colour and the rest dimmed and marked "not found yet", with a count (for example "1/3").
- **Server-side:** the log changes only when the server opens a chest. It travels to the phone with the character record and is saved with the character. A save's log is checked against the six unique ids, so junk is dropped.
- **Saved at once:** the server saves a character the moment their chest opens. A crash or restart can't undo the claim separately from the rewards and log entries it paid for.
- **No double rewards:** the claim is spent before anything is given, in the same simulation step. Repeated taps or a command resent after a reconnect find the chest locked (tested with a burst of six taps).
- **Older saves:** a save from before the log records, once, any unique the character holds (bag, worn or bank) from a dungeon they have completed. Uniques from a dungeon they never completed came by trade, so they don't count.

### Guidance
Each journal card now separates three things:

| Line | Meaning |
|---|---|
| Entry | The door's minimum requirements (unchanged since 4C), each shown met or unmet |
| Advised | The combat level the balance tests support, with yours beside it in amber if lower |
| Gear / Bring / Boss | What to wear and carry, and how the boss fights |

- **The door's tap hint** shows the advice and your level.
- **Going in under the advised level** gets one message on the way in (meant for combat 44+, you are N, the way out is beside you). It never blocks an experienced player.

### Touch controls
- **Doors, stairs and ways out** are easier to tap: they are sampled at foot and head height and favoured over things near them. A dungeon door also answers to taps anywhere on its landmark (the ruin, the tower).
- **Chests** are easier to tap the same way.
- **In a crowd**, a creature's nameplate can be tapped. A tap that lands almost as close to your current target as to a neighbour keeps your current target.
- **Feedback:** every tap on a thing shows the ring under it.
- **Felled trees and emptied rocks** no longer catch taps meant for the ground beside them.
- **Fixed: getting stuck diagonally.** Standing diagonally beside a door, chest or station, the hero now steps round to an open side. Before, the path was "already there" while still out of reach, so the hero waited forever.

### Performance (measured)
`tools/perf-dungeon.cjs` runs both boss fights in an Android-sized browser with software rendering. Compare its runs with each other, not with a phone.

| | Before 4D | After 4D |
|---|---|---|
| Shrinekeeper fight | 12.1 fps, 250 draw calls | 16 fps, 135 draw calls |
| Watchcaptain fight | 14.2 fps, 252 draw calls | 18 fps, 115 draw calls |
| Live geometries | 783–912, growing with each arrow | 321–431, flat |

What changed:
- **Characters' rigid parts are merged per joint** (`src/render/bake.ts`): one vertex-coloured mesh per joint instead of a box per part. Same colours, same animation.
- **Arrows and bolts** share one set of geometry and materials and are pooled. Each arrow used to create, and never free, a geometry and two materials.
- **Particles** no longer allocate per frame.
- **Creatures more than 36 tiles away** are neither drawn nor animated.
- **No sun shadow pass underground.** The switch costs one shader recompile at the door or stairs.

For measuring on a phone, add `?perf` to the address. It shows:
- frame rate, with average, 95th-percentile and worst frame times;
- draw calls and triangles;
- live geometries, textures and shader programs;
- the JS heap (Chrome);
- animated creatures, particles and projectiles in flight.

### The two intermittent tests (root causes)
- **Ground taps on a busy screen.** Tap versus long press compared `performance.now()` inside the two touch handlers. One slow frame between them (a heavy scene or a slow phone) turned a 60 ms tap into nothing. The browser's own event timestamps now decide.
  - With one simulated 800 ms frame: the old build moved the hero on 0 of 10 taps, the new one on 9 of 10. The miss was a tap on a blocked tile.
  - A second, separate cause showed up while repeating the smoke test: a felled stump caught the tap (above).
  - The smoke test waits for the outcome, since a slow frame rate also slows the game's clock.
  - A third cause was in the test itself. Its injected `touchEnd` is sent only once the page has taken `touchStart`, so after a slow frame the two events were stamped 615–700 ms apart and read as a long press. The game issued nothing, which the diagnostics in the check now show. The smoke test now stamps its taps 60 ms apart, as a finger would.
  - Over 12 smoke runs: 6 of 6 failed checks at that cause beforehand (in 3 runs), 6 of 6 runs passed afterwards.
- **Server start-up race (found while repeating the suite under load).** The connection heartbeat started before the socket server existed, with a password hash in between. A slow hash and a short heartbeat made it throw (`Cannot access 'wss' before initialization`). It now starts once the server is listening.
- **"Silent connection" reconnect test.** The test faked silence by jumping the client's clock while the server kept sending ten snapshots a second. Any snapshot that arrived first reset "last heard". The server's socket now really goes silent in the test; the product logic was right.
  - Under full CPU load: old test 11 of 20 passes, new test 20 of 20.
