# Brightwater creature combat (Phase 5D)

Phase 5D makes fights against Brightwater's existing creatures more varied without new places, new controls or a new combat system. Old School RuneScape is the reference only for the *idea* of readable creature mechanics (packs, ranged foes that keep their distance, telegraphed boss attacks). Every creature, name and ability here is Brightwater's own.

## Audit: what was already there (reused)
- **Aggro:** aggressive creatures pick the nearest player within their aggro range. They lose interest in players far above their level (combat over twice theirs plus two), except bosses.
- **Chase, leash and return:** a creature chases until it is too far from home. It then walks back, healing as it goes, and snaps home if it gets stuck.
- **Attack styles:** each creature has an attack range. Ranged and magic creatures fire a visible arrow or bolt whose hit lands on arrival. Magic is resisted with Defence and Magic together. Armour counts by attack style (5B).
- **Bosses:**
  - **Rally:** the dungeon bosses call creatures within five tiles when engaged.
  - **Enrage:** they attack faster below a health threshold.
  - **Rewards:** kill credit goes to everyone who hurt the boss, with claims on the chest.
- **Multiplayer:** creatures are simulated on the server. A creature's public fields travel in each snapshot to players within 32 tiles. Its events are sent to nearby players.

**Missing:** creatures of a kind never helped each other, ranged creatures never repositioned, nothing ever retreated, there were no status effects, and nothing gave a warning before it hit.

## Behaviours (`src/data/enemies.ts`, `src/sim/world.ts`)
A small reusable set, each an optional field on a creature. No creature has more than two, and nothing demanding appears below level 20 (tested).

| Behaviour | What it does | Who has it |
|---|---|---|
| **Pack** (`pack`) | When it joins a fight, up to *max* idle creatures of its kind within *radius* join too, nearest first. Those don't call others, so a pack never snowballs | Timber wolves (4 tiles, 1 helper), ridge stalkers (5 tiles, up to 2) |
| **Keep distance** (`kite`) | A ranged creature closer than this to its target backs away while it reloads, still shooting. It never leaves 80% of its leash or walks into a wall | Drowned acolytes (3 tiles), forsworn archers (3.5); their elites (3.5, 4) |
| **Retreat** (`retreat`) | Below a share of its health it breaks off **once per life** for a few seconds, calling one of its kind within 7 tiles. It stays on its leash (so it doesn't reset to full health), then fights on | Goblin raiders (below 25%, 3 s) |
| **Slow on hit** (`slowOnHit`) | Its hits sometimes slow you: movement only, never attacks | Mire leeches (25% of hits; 70% speed for 3 s) |
| **Telegraphed special** (`special`) | See below | All five bosses and the three elites |

**Fleeing and backing off:** both pick the most direct open way out: straight back, else up to 90° to either side, keeping a tile clear of walls. A creature never sticks against a wall or a tent.

**Slows:**
- the stronger of two slows wins, and a fresh slow restarts the clock rather than stacking;
- death clears them;
- they replicate with the player, so the phone's movement prediction uses the same speed as the server.

## Telegraphed specials
A special winds up for **1.3–1.6 seconds**. A red ring marks the ground, and an orange band sweeps out to the edge as the blow approaches. Then everyone still inside the ring takes the hit.

- **No accuracy roll:** stepping out is the defence.
- **Damage:** 1.2–1.5 × the creature's max hit, at 75–100%.
- **Hearth's Bulwark** halves it, as it halves any creature's hit.
- **"dodged!"** shows for the player it aimed at, if they got away.

| Shape | The ring is… | Dodge by… |
|---|---|---|
| **Slam** | Under the target where it stood when the wind-up began | Moving anywhere out of it |
| **Sweep** | Round the creature itself | Backing away |
| **Charge** | At the marked spot; the creature rushes there | Leaving the spot |

| Creature | Special | Wind-up | Ring | Damage | Every | Other |
|---|---|---|---|---|---|---|
| Grukk the Warlord (24) | Club slam | 1.6 s | 1.8 | 1.4× | 12 s | |
| The Bog Mother (30) | Mire burst | 1.6 s | 2.4 | 1.2× | 13 s | Slows (60%, 3 s) |
| Greymane (34) | Pounce (charge) | 1.4 s | 1.6 | 1.4× | 10 s | |
| The Shrinekeeper (52) | Tide surge | 1.6 s | 2.4 | 1.3× | 12 s | Slows (60%, 3 s) |
| The Last Watchcaptain (58) | Sweeping cut (sweep) | 1.5 s | 2.6 | 1.4× | 11 s | |
| Ironhide Bristleback (elite, 30) | Charge | 1.4 s | 1.6 | 1.5× | 9 s | |
| Drowned Tidecaller (elite, 42) | Tide surge | 1.6 s | 2.2 | 1.4× | 10 s | Slows (60%, 3 s) |
| Forsworn Marksman (elite, 44) | Arrow rain | 1.6 s | 2.4 | 1.3× | 9 s | |

### Fairness and latency
- **Server positions:** the hit is decided on the server from where players are when the wind-up ends. A player who stepped out in time is safe whatever their phone showed.
- **Walking out takes well under the wind-up:** less than three-quarters of it, even when slowed (tested for every special). At 4.4 tiles a second, leaving a 2.4-tile ring takes about 0.6 s.
- **Time to react:** snapshots arrive ten times a second, so a phone sees the ring within about a tenth of a second plus network delay. That leaves over a second to react.
- **Reconnects:** the ring is part of the creature's replicated state, not only an event. A phone that reconnects or arrives mid wind-up still sees it.
- **No ordinary attacks:** a creature makes none while winding up or charging.
- **Auto-approach waits:** a tap to attack never walks you into a ring. The approach waits at its edge (if you are already in reach, you keep attacking), and the joystick still goes anywhere.
- **No unfair combinations:** elites are placed at least 12 tiles from any boss. The tower's elite is on floor two's far side, away from the roof and the way out.

## Elites
An elite is a known creature, tougher, with one special:
- the same model;
- a gold ★ on its nameplate;
- three times the respawn;
- its base creature's loot with coins doubled and gear twice as likely, at most 6%.

| Elite | Based on | Where | Level, health |
|---|---|---|---|
| Ironhide Bristleback | Bristleback boar | The main Thornridge herd (one of its eight) | 30, 340 |
| Drowned Tidecaller | Drowned acolyte | The Sunken Shrine's first flooded hall | 42, 320 |
| Forsworn Marksman | Forsworn archer | The Old Watchtower, floor two (west side) | 44, 320 |

- **Rewards are richer per kill but no better per minute** than their base creature (tested), so they don't inflate the economy.
- **Their rare gear** is on the creature collection log (5C), with its own rows.
- **Placement:** they replace existing spawns, so no map or creature count changed.

## Multiplayer
Everything here runs in the simulation, which is the server.

- **The client never sends** a status, damage, special or slow. Forged commands of those kinds are dropped by the validator (tested over the network).
- **A special hits every player in its ring,** and each player is judged by their own server position.
- **Pack calls and retreats** target the player who started the fight.
- **Disconnects:** a player who disconnects mid wind-up is no longer in the zone, so the special resolves without them. A creature whose target left returns home.
- **Zone changes** work the same way: a player who leaves a zone leaves its creatures' fights.
- **New events** (`telegraph`, `impact`, `status`) go to nearby players. They carry no rules, only presentation.

## Feedback on the phone
- **The ring and band:** two draw calls per special winding up nearby, from shared geometry and materials. The band replaced a filled disc to keep the pixel cost down.
- **Warnings:** one short line above the creature's nameplate, such as "⚠ Club slam", "flees!" or "calls for help!".
- **Impact:** a small dust burst.
- **Floating text:**
  - special hits show their damage a little larger;
  - "dodged!" when you escaped;
  - "slowed" when a slow lands.
- **Slowed chip:** "🐌 Slowed · 2s" under your health bar while it lasts.
- **No new pop-ups or panels.**

## Balance
- **What was measured.** `tests/dungeon-balance.test.ts` fights both boss rooms with the boss, its guards, 18 silverpike and eating at half health.
- **A fault in the old measurement.** Before 5D, that test set the fighter's health to their Hitpoints *level* (40) instead of their maximum (400), so every fight was fought at a tenth of full health. That is why "level 30 loses" held in 4C. It is fixed, so the numbers below are from full health.
- **Results with the specials:**
  - at the advised level (40 in the combat skills), melee and ranged clear both rooms even standing in every special;
  - a mage clears the Shrinekeeper;
  - at the door's minimum (30) it takes a full bag of food, and dodging at the tower;
  - with no food, level 30 fails;
  - level 25 fails.
- **Dodging:** a scripted joystick dodger escapes nearly every special. It was hit 0–1 times per fight against 4–7 when standing still, and kept far more food.
- **Entry requirements and the advised levels are unchanged.**
- **Outside the dungeons:**
  - wolves now bring one packmate at most;
  - goblins break off once;
  - Grukk's Club slam is the island's only special;
  - early areas (slimes, the meadow, Glimmer Hollow) are unchanged.

## Performance
- **Benchmark** (`tools/perf-dungeon.cjs`, software rendering, the 5C build and this one run alternately on the same machine):

  | Build | Shrinekeeper fight | Watchcaptain fight | Draw calls |
  |---|---|---|---|
  | 5C | 14.8 / 15.1 fps | 15.3 / 15.8 fps | 136–140 / 114–118 |
  | 5D (ring and band) | 15.2 / 14.6 fps | 16.2 / 15.9 fps | 138 / 116–117 |

  With the first (filled-disc) version, the roof read about 0.8 fps lower in both runs. Its large transparent disc was the cost, and replacing it with a thin band removed the difference.
- **CPU:** the new behaviours are evaluated only during a chase. Idle creatures cost what they did before.

## Tests
**`tests/phase5d.test.ts` (18 tests):**
- who gets which behaviour, the early-game limits, and every special being escapable in time;
- elites' rules and placement;
- pack calls, including no chaining;
- the goblin retreat (once, on its leash, calling one friend, reset on respawn);
- archers backing off without leaving their leash or entering walls;
- slows (rate, expiry, the stronger one winning, death clearing them, client prediction);
- specials: timing, no damage or swings during the wind-up, damage range, dodging, sweep and charge, range limits, clearing on death, slow and Bulwark;
- auto-approach holding at a ring;
- two players in one ring;
- snapshot replication of rings and slows;
- elite xp, loot and the collection log.

**`tests/net-combat.test.ts` (4 tests, real server):**
- two phones see Grukk's ring: the one who stays is hit, the one who steps out is not;
- forged status, damage and special commands do nothing;
- a phone that drops mid wind-up reconnects and sees the next one;
- a wolf pack answers the player who started the fight.

**`tests/dungeon-balance.test.ts`:** the results above.

**`tools/mobile-smoke.cjs`:** on an Android-sized screen, a boss's ring is drawn, and steering with the on-screen joystick during the wind-up dodges it. The steering starts just before the wind-up: in software rendering each injected touch waits for a frame of a few per second, which a phone doesn't. Reaction time is covered by the simulation tests above.

## Not done (deferred)
- **Line of sight:** creatures still notice and shoot through walls, as before 5D. Elites are placed away from walls to avoid it, but the ordinary archer on the tower's second floor can reach the roof's edge.
- **Other status effects:** no poison, stun or bleed.
- **No healing or buffing creatures.**
- **Specials for ordinary creatures** below the elites.
- **Specials' damage** ignores armour by design (dodging is the defence). A "brace" vow could later reduce it.
