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
- **Level 30 loses.**
- **Magic against the Watchcaptain:** a solo mage at the advised level loses. Mages should bring friends or more food.

## Deferred
- **Instances and parties:** dungeons are shared zones; a private run for a group needs a party system.
- **More mechanics:** traps, puzzles, keys or levers, and boss phases beyond enrage.
- **Collection log:** a record of uniques ever found. The journal counts uniques you currently hold.
- **Dungeon-only resources:** no gathering inside yet.
