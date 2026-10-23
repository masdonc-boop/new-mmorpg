# Brightwater skill and equipment progression (Phase 4B)

Phase 4B makes advancement, gear, crafting and exploration lead into one another. Old School RuneScape is the reference for *how progression feels*: separate combat skills, 1–99 levels, tiered gear with level requirements, and gathering that feeds production. Every item, place, creature and line of text is Brightwater's own (`docs/ORIGINALITY.md`). The custom combat system (accuracy, power and armour bonuses; `src/sim/combat.ts`) stays as it is.

## 1. Audit (October 2026, after Phase 4A)

### What already works (reused)
- **Skills:** 19 skills on one 1–99 curve (`XP_TABLE`, a classic exponential curve), xp only from actions in the simulation. Combat level and total level are derived from it.
- **Skills panel:** level, xp to next, a progress bar, how to train, and every unlock by level (`skillUnlocks`: resources, recipes, wearable gear, tools).
- **Equipment:** 11 slots, kept apart from the 28-slot bag. Each item has requirements (checked when you wear it) and accuracy, power and armour bonuses. Weapons count only with their own style. Two-handed bows remove shields. The ammo slot holds a whole stack. Swaps never lose an item (all or nothing).
- **Worn gear is drawn on the hero:** weapon kind and tint, helmet, body, legs and shield tints.
- **Tool tiers:** bronze → iron → steel → glimsteel axes and pickaxes. A better tool gathers faster; higher tiers need a level to use.
- **Production:** stations (furnace, anvil, range or fire, spinning wheel), "anywhere" crafts (knife, needle, chisel), and burn chances that fall with level.
- **Economy:** shops buy at 40% of item value. The tanner and sawmill charge per item. The bank, trades and the Exchange keep items whole (tested in 3B: no duplication on reconnects, rollbacks or trades).
- **Saves** keep xp, gear, the bag, the bank, quests and options; older saves load.

### Inconsistencies and gaps (fixed in 4B unless deferred)
1. **Melee always splits xp three ways** between Attack, Strength and Defence, so they can't be trained separately. Ranged and Magic never train Defence.
2. **Bonuses on non-weapon gear apply to every style.** Leather can't help archers more than knights, and robes don't exist. Nothing stops a mage wearing a full platebody at no cost.
3. **Tiers are uneven:**
   - Melee runs bronze (1) → iron (10) → steel (20) → glimsteel (30) → duskiron (45), but iron has no dagger and duskiron has no sword.
   - Ranged weapons stop at Ranged 25.
   - Arrows jump from bronze to glimsteel.
   - Glimsteel arrows need Ranged 25 while every other glimsteel item needs 30.
   - Magic has two wands and no armour.
4. **Ranged armour is basic wolfhide only:** no requirements and no ranged bonus. Boar and stalker hides don't exist; stalkers drop wolf pelts.
5. **Thornridge has no woodcutting**, and there is no higher-tier wood beyond willow (25).
6. **Quests have no requirements.** The regional quests can be accepted at combat level 3.
7. **Loot tables** are mostly coins and materials. No creature drops gear for its tier, and the bosses' unique drops are thin.
8. **The skill guides** ("how to train") describe only the island.
9. **No dungeon framework:** nothing describes what the Sunken Shrine and Old Watchtower will ask for or give.

## 2. The progression model (4B)

### Combat training focus (no change to the combat maths)
A **training focus** chooses where combat xp goes. It is saved per character and validated by the simulation, like any other option.

| Focus | Melee | Ranged / Magic |
|---|---|---|
| Shared (default; the old behaviour) | Attack, Strength, Defence equally | Ranged or Magic |
| Accuracy | Attack | Ranged or Magic |
| Power | Strength | Ranged or Magic |
| Defence | Defence | half Ranged or Magic, half Defence |

Hitpoints always gains its share. The total xp per damage is unchanged, so no focus is "better", only directed.

### Equipment tiers

| Tier | Melee (Attack / Defence) | Ranged (Ranged; body also Defence) | Magic (Magic) |
|---|---|---|---|
| 1 | Bronze | Shortbow, bronze arrows, wolfhide | Riverwood wand, linen robes |
| 10 | Iron | Oak shortbow (15), iron arrows | — |
| 20 | Steel | Boarhide, steel arrows, riverwood longbow (22), willow shortbow (25) | Emberglass wand (25), mireweave robes (25) |
| 30 | Glimsteel | Ridgehide, glimsteel arrows, rowan shortbow (35) | Mirelight wand (35) |
| 40–45 | Duskiron (45) | Rowan longbow (40) | Rowan staff (40) |

- **Gear bonuses can belong to a style.** Hides add ranged accuracy, robes add magic accuracy and power, and metal armour lowers magic and ranged accuracy (as heavy plate should). Amulets and rings still help every style.
- **Gear needs the level of its tier** in the skill it's used with.

### Resource chains added
- **Rowan trees** (Woodcutting 40, Thornridge) → rowan bows and staff, rowan fires (40).
- **Boar hides** and **ridge stalker pelts** → the tanner → boarhide (Crafting 28–34) and ridgehide (40–46).
- **Flax → linen** (spinning wheel, Crafting 10) → linen robes (12–18). Linen sealed with **mire oil** → mireweave (30–34).
- **Iron and steel arrows** (Fletching 15 and 25).
- **The mirelight wand** (willow, a marsh pearl and spark chips, Crafting 38) joins the marsh to Magic.

### World progression
- **Quest requirements:**
  - Lanterns of Heronwick needs The Elder's Request and combat level 12.
  - The Ninefold Watch needs The Elder's Request and combat level 20.
  - Nothing blocks *walking* anywhere.
- **Loot tables:** each creature drops some gear of its own tier now and then, and each boss has a signature drop.
- **Dungeon framework** (`src/data/dungeons.ts`): entry requirements, recommended levels and reward tables for the Sunken Shrine and the Old Watchtower, ready for Phase 4C.

## 3. What Phase 4B built

| Batch | What |
|---|---|
| 4B.1 | **Training focus** (Skills panel): shared, Attack, Strength or Defence. Saved per character; a validated `setFocus` command. |
| 4B.2 | **Style bonuses** (`styleBonus`): metal armour costs magic and ranged accuracy, and wolfhide adds ranged accuracy. Melee tiers completed (iron dagger, duskiron sword). The warhammer needs Strength 45; glimsteel arrows need Ranged 30. The item card shows style bonuses, and each requirement as met (green) or unmet (red). |
| 4B.3 | **Ranged and magic tiers with their chains:** rowan trees and gear, iron and steel arrows, boarhide and ridgehide (tanned by Rook), linen and mireweave robes, the mirelight wand and rowan staff. Skill guides cover every tier and Eastreach. |
| 4B.4 | **World progression:** quest requirements (checked by the simulation; shown in the journal), loot tables by tier with boss signature drops, and the dungeon framework (`src/data/dungeons.ts`). |
| 4B.5 | **Polish:** a "Next at N" unlock line on every skill card; multiplayer tests; skills grid overflow fix; docs. |

### The tiers as built

| Level | Melee | Ranged | Magic |
|---|---|---|---|
| 1 | Bronze set, wooden shield | Shortbow, bronze arrows, wolfhide (ranged accuracy +1 to +5 per piece) | Riverwood wand, linen robes |
| 10 | Iron set (dagger new) | Iron arrows; oak shortbow (15) | — |
| 20 | Steel set | Steel arrows, boarhide (body also Defence 20); riverwood longbow (22); willow shortbow (25) | Emberglass wand (25); mireweave (25) |
| 30 | Glimsteel set | Glimsteel arrows, ridgehide (body also Defence 30); rowan shortbow (35) | Mirelight wand (35) |
| 40–45 | Duskiron set (sword new; warhammer also Strength 45) | Rowan longbow (40) | Rowan staff (40, two-handed) |

### Saves, multiplayer and security
- **No item ids were renamed or removed.** New fields (`options.focus`) are optional; older saves load with the original shared split.
- **Gear worn above the wearer's level** in an older save stays worn and nothing is lost. Requirements apply when putting gear on, as before.
- **Quests already under way** carry on whatever their requirements.
- **Server-side:** the focus, quest requirements and every recipe and equip check run in the simulation, which the server is. Clients only send intents (tested over the network, including junk values). Trades of the new items go through the same escrow and ledger.
- **Economy guards (tests):**
  - no shop item sells back at a profit;
  - no recipe or tanning turns shop-bought inputs into more coins;
  - every wearable can be obtained;
  - every new material has a use;
  - creature loot rises with level, bosses are worth more than five regular kills, and gear drops stay within a creature's tier.

### Deferred
- **Melee stances** with small level boosts, and special attacks.
- **More combat skills:** Ranged and Magic have no separate "power" skill; Ranged and Magic max hits come from their own level, as before.
- **Combat triangle:** partly done in Phase 4C. Dungeon creatures attack with ranged and magic, and magic is resisted with Defence and Magic together; armour has no per-style defence yet.
- **Herblore and potions, and runecraft-like spark stone tiers:** spark stones are the only magic ammunition.
- **Gear above level 45**, dyes, and gear degradation.
- **Gloves, boots, capes, amulets and rings** are not drawn on the hero; head, body, legs, weapon and shield are.
- **A Cairnhold tanner:** hides go to Rook in Brightwater.
- ~~The dungeons themselves~~: built in Phase 4C (`docs/DUNGEONS.md`); the planned uniques are now items.

## 5. Phase 5A: core progression and equipment

### Audit (October 2026, after Phase 4D)
Most of the foundation Phase 5A asks for was already in place, so 5A reuses it and fills the gaps.

| Area | Already working (reused) | Gap found |
|---|---|---|
| Skills and xp | 19 independent skills, 1–99 on one exponential curve (`XP_TABLE`), xp only from simulation actions, capped at 200 million; Attack, Strength and Defence trained separately with the training focus (4B); Devotion is Brightwater's prayer skill | A level up said nothing about what it opened |
| Combat level | Derived from Attack, Strength, Defence, Hitpoints, Ranged, Magic and half of Devotion | Not explained anywhere in the game |
| Equipment | 11 slots, requirements checked on wear, style bonuses, two-handed rules, swaps that never lose items; tiers 1–45 for all three styles plus the dungeon uniques | Every weapon of a style attacked at the same pace and reach, so daggers were simply weaker swords; no comparison with worn gear; capes, gloves, boots and amulets were invisible on the hero |
| Production loops | Mining → Smithing → gear; Woodcutting → Fletching → bows and arrows; Fishing → Cooking → food; drops → Crafting; 28-slot bag with one slot per gathered resource; stations; burn chances | None blocking (recipe data now checked for loops) |
| Economy | Shops pay 40% of value; tanner and sawmill fees; trades and the Exchange keep items whole; anti-duplication tests from 3B; money-from-nothing tests from 4B | **Coins stopped at 99,999 in the bag** while a bank slot holds two billion: a wealthy player couldn't sell, and chests waited for space |
| Persistence and authority | Saves keep xp, gear, bag, bank, quests and the collection log; the server runs the simulation and only accepts validated intents | No test that forged xp or level commands are refused over the network |

### What 5A changed
- **Weapon pace and reach.** Weapons may now have their own seconds between attacks (`speed`) and reach in tiles (`range`), used by the simulation, the bow animation and the item card. Damage per second stays within a few percent of the sword or shortbow of the same tier (tested), so the choice is how a weapon fights, not a hidden best.

  | Weapon | Pace | Reach | Stat change |
  |---|---|---|---|
  | Daggers (bronze to glimsteel) | 1.5 s (swords 1.6) | 1.5 | none: smaller, quicker hits |
  | Duskiron warhammer | 1.9 s | 1.5 | power 52 → 76: fewer, heavier blows |
  | Riverwood, rowan and Warder's longbows | 2.0 s (shortbows 1.8) | 8.5 (shortbows 7) | power 21 → 28, 32 → 44, 36 → 51 |
  | Rowan staff | 2.5 s (wands 2.2) | 7.5 (wands 6.5) | power 35 → 50 |

  The dungeon uniques are still "a step above" their peers, now compared by damage per second.
- **Item card on Android:** pace and reach for weapons, each requirement met or unmet, and a line comparing the item with what is worn in its slot (each stat up or down, quicker or slower, more or less reach).
- **Equipment box:** max hit, seconds between attacks and reach for the current style.
- **Level ups:** the banner and the log list what the level opens (every unlock passed, if several levels came at once), and say when the combat level rises.
- **Combat level:** the Skills panel explains the formula in a line and lists the quickest ways to the next combat level (for example "2 Attack or Strength, 2 Defence or Hitpoints, 15 Ranged").
- **Visible gear:** capes, gloves and bracers, boots and amulets now show on the hero, as colours on the existing cloak, hands, boots and a small pendant. The model's shapes are unchanged, and the parts are merged into the existing meshes, so there are no extra draw calls.
- **Coins:** a bag stack of coins now holds up to two billion, the same as a bank slot. The limit is still enforced: a sale or a chest that would pass it is refused whole.

### Not changed (on purpose)
- **The xp curve.** It is the long-standing classic exponential curve. The originality rules allow "1–99 on an exponential curve" as a general mechanic. Changing it would move every existing character's levels, which is a destructive migration that needs the owner's decision.
- **The combat formulas** (`hitChance`, `maxHit`, the training focus): weapon pace changes how often they are used, not what they compute.
- **Item ids, recipes and requirements:** no ids changed, so saves, banks, offers and the collection log load as before.

### Tests (`tests/phase5a.test.ts`, plus one server test in `tests/net-progression.test.ts`)
- **XP and levels:** both directions at every level, the 200-million cap, and junk save values.
- **Combat level:** every route the breakdown names really raises the level, by exactly that many levels.
- **Level-up events:** unlock news, and the combat level news.
- **Weapons:**
  - pace and reach for each type;
  - damage per second level within a tier;
  - higher tiers always better;
  - in a real fight a dagger strikes more often than a sword.
- **Equipping:** requirements, slot rules, nothing lost on a refusal, and the item card comparison.
- **Economy:**
  - the coin limit and selling past 99,999;
  - stackability rules and value ladders within a slot and style;
  - recipe data (levels, xp, no self-feeding recipes);
  - no profitable sell-back.
- **Saves:** xp, gear, pace and the collection log carry through; older saves with the re-tuned weapons load unchanged.
- **Server:** gear above your level is refused, forged xp and level commands are dropped, a phone editing its own copy changes nothing, and earned gear and a large purse survive a restart.

### Deferred
- **Hands and feet tiers** above wolfhide boots and the hide bracers, and metal gauntlets or boots for melee, were held back to avoid a flood of new items before the progression above is proven on phones.
- **Per-style armour** (separate defence against melee, ranged and magic).
- **Melee stances and special attacks.**

## 6. Phase 5B: combat depth and equipment progression

### Audit (after Phase 5A)
| Area | Already there (reused) | Added in 5B |
|---|---|---|
| Melee training | Four training focuses since 4B (shared, Attack, Strength, Defence), saved per character, set with a validated `setFocus` command, applied in the simulation. 5A tests showed forged xp commands are dropped | Shown as **Balanced / Attack / Strength / Defence** and picked from a chip on the combat button (it was buried in Skills); tests for the exact split and for xp never counted twice |
| Defence | One `armour` figure per piece. Creatures' spells met half of it; blows and arrows met all of it | **Armour against each style**, from what a piece is made of |
| Hands and feet | Wolfhide wraps and boots (tier 1); hide bracers (20, 30) | Metal handguards and sabatons for all five metals; boarhide and ridgehide boots; mireweave gloves and slippers |
| Feedback | Floating damage numbers and "miss" | "blocked" when armour turned a hit, and a ⛨ on a hit softened by Hearth's Bulwark |

### Training modes (`combatXp`, unchanged maths)
Every point of damage the player deals gives 1.2 xp spread over the mode's skills, plus 0.4 Hitpoints xp. That is 1.6 per damage whatever the mode.

| Mode | Melee | Bow or wand |
|---|---|---|
| Balanced | 0.4 each to Attack, Strength and Defence | 1.2 to Ranged or Magic |
| Attack | 1.2 to Attack | 1.2 to Ranged or Magic |
| Strength | 1.2 to Strength | 1.2 to Ranged or Magic |
| Defence | 1.2 to Defence | 0.6 to Ranged or Magic, 0.6 to Defence |

- **Where the xp comes from.** It is given only when the server lands a hit (`damageEnemy`), from the damage actually dealt. A mode change applies from the next hit.
- **The command.** The client sends only `setFocus` with one of the four ids; anything else is refused by `validateCommand`.
- **Unchanged ids.** The ids are the 4B ones (`shared`, `accuracy`, `power`, `defence`), so saves are untouched.

### Armour against each style (`ARMOUR_VS`, `armourVs`, `Equipment.armourAgainst`)
A piece's class is read from what it already does: metal costs magic accuracy, hide adds ranged accuracy, cloth adds magic accuracy, and everything else is plain. Its armour against an attack style is its `armour` × the factor:

| Class | vs melee | vs ranged | vs magic | Reasoning |
|---|---|---|---|---|
| Metal | 1.0 | 1.1 | 0.35 | Stops blades, turns arrows; spells pass through |
| Hide | 0.8 | 1.2 | 0.8 | Supple: best against arrows, fair against spells |
| Cloth | 0.6 | 0.6 | 3.0 | Woven and proofed to turn spells; parts for steel |
| Plain (wooden shield, capes, jewellery) | 1.0 | 1.0 | 0.5 | Exactly the rule before 5B |

- **How it is used.** A creature's attack rolls against the armour for its own style, in the unchanged `hitChance`.
- **Magic.** It is still resisted with the average of Defence and Magic.
- **Overrides.** A piece may override its figures with `defence`, though none does yet.
- **Exactness.** Sums are kept exact and rounded only for display, so a fresh character, or anyone in plain gear, is hit exactly as often as before.
- **Early game is unaffected.** Every creature outside the two dungeons fights in melee. The cloth and hide melee factors only touch armour values of 1–8 at those tiers.
- **Dungeons.** A robed mage now turns the acolytes' and the Shrinekeeper's spells much better than a knight. Plate is a little better against the tower's archers. The 4C balance fights still pass at the advised level.

**Feedback**
- **"blocked"** shows when a creature's roll would have hit bare skin but missed against your armour. This uses the same roll, so the random sequence is unchanged.
- **A plain miss** still says "miss".
- **A hit softened by the Bulwark** shows its damage with a ⛨.
- **Cost:** all of this is the existing DOM floating text, with no new draw calls.

### Equipment added (14 pieces, existing materials and stations only)
| Line | Pieces | Made | Wear |
|---|---|---|---|
| Metal | Bronze, iron, steel, glimsteel, duskiron **sabatons** (feet) and **handguards** (hands): armour 2, 3, 5, 6, 9; glimsteel handguards +1 accuracy; duskiron −1 accuracy | Anvil, one bar, at the metal's base +6 (sabatons) and +8 (handguards), with the metal's usual xp per bar | Same Defence as the metal's helm (none, 10, 20, 30, 45) |
| Hide | **Boarhide boots** (armour 4, +2 ranged accuracy), **ridgehide boots** (6, +3) | Needle: Crafting 29 and 41, one hide and thread | Ranged 20 and 30 |
| Cloth | **Mireweave gloves** (2, +3 magic accuracy, +1 power), **mireweave slippers** (2, +2, +1) | Needle: Crafting 29 and 31, linen, mire oil and thread | Magic 25 |

Each line now has hands and feet above tier 1. The pieces show on the hero through the 5A tint system, and bank, trade and save like any other gear. No existing item, recipe or id changed.

### Android
- **Training chip.** It sits on the combat button's upper left and shows the mode (for example "🎯 Strength", or "Ranged + Def" for a bow in Defence mode). A tap opens a four-button picker (44 px targets) with a one-line explanation. The picker closes on a choice or a tap elsewhere.
- **Tap prompt.** On narrow screens it moved up so it never overlaps the chip.
- **Item card.** Shows armour by style ("armour 30 melee · 33 ranged · 11 magic"). The comparison line gives one figure when all three change alike, otherwise "−14/−9/+5 (melee/ranged/magic)".
- **Equipment box.** Shows total armour against each style.

### Tests
**`tests/phase5b.test.ts` (14 tests):**
- the exact xp split per mode in a real fight, totals of 1.6 per damage, and xp events matching the skill totals (nothing counted twice);
- a mode switch taking effect deterministically;
- ranged and magic rules;
- command validation and saves;
- class detection for every line, the factor table and the tier-30 triangle;
- plain gear unchanged;
- creatures rolling against style armour;
- "blocked", "warded" and plain-miss outcomes, including an arrow carrying "blocked" to where it lands;
- the new pieces' recipes, tier ordering and requirements, a forge-to-wear run, saves, and the item card text.

**`tests/net-progression.test.ts`:** a mode set on the phone directs the server's xp, and junk modes and forged xp change nothing. Armour is computed from the server's copy of the gear.

**Performance (dungeon benchmark, software rendering):**

| | Draw calls | Frame rate |
|---|---|---|
| Shrinekeeper fight | 136 | 16.0 fps |
| Watchcaptain fight | 115 | 17.1 fps |

These match the 4D and 5A runs, and geometries stay flat.

### Deferred
- **Per-item defence overrides** (`defence`): supported but unused, until a piece needs to break its class's rule.
- **Linen-tier gloves and slippers:** wolfhide covers tier 1.
- **Melee stances with level boosts, special attacks, and damage reduction from armour** (armour only lowers the chance to be hit, as before).

## 7. Phase 5C: combat rewards and progression

### Audit (after Phase 5B)
| System | Already there (reused) | Gap |
|---|---|---|
| Loot tables | Every creature has its own table (`src/data/enemies.ts`): coins, its materials (gel, pelts, hides, oil, pearls), arrows, spark stones, and gear of its tier now and then. Each entry rolls on its own. 4B tests: value rises with level, bosses are worth five kills or more, and gear stays within a creature's tier | Little food outside goblins, nothing for dungeon sustain; the 5B hands and feet pieces dropped nowhere |
| Drops | Piles land where the creature fell, private to the killer for a while, then public. A full bag leaves the pile on the ground. Saved with the zone. Pickup moves exactly what fits (tested against duplication in 3B) | No sense of rarity: a 1% find looked like a bone |
| Bosses | Regional bosses with signature drops; dungeon bosses with claims and chests; dungeon uniques in the 4D collection log | Boss and creature finds were not logged anywhere |
| Gear ladder | Melee 1/10/20/30/45; ranged 1/15/22/25/35/40; magic weapons 1/25/35/40 | **Magic had no weapon between levels 1 and 25** |

### Loot changes (small, targeted)
| Creature | Added | Why |
|---|---|---|
| Meadow slime (2) | Sunroot seeds 1–2 (8%) | Starts the farming loop from the first fights |
| Timber wolf (7) | Wolfhide boots (2%) | Its own hide, made into boots |
| Goblin raider (11) | Roasted sunroot (8%) | Food from the camp's stores |
| Mire leech (21) | Oak wand (1.5%) | A rare route to the new wand |
| Bristleback (24), ridge stalker (32) | Boarhide boots (2%), ridgehide boots (1.5%) | The 5B boots from their hides |
| Drowned acolyte (34), guardian (38) | Cooked silverpike (10%, 15%); mireweave gloves (2%), steel handguards (2.5%) | Food to sustain a dungeon run; the 5B pieces |
| Hollow sentinel (38), forsworn archer (36) | Bread 1–2 (15%), steel sabatons (3%); cooked silverpike (12%) | The same |

- **Unchanged:** every boss table is exactly as before, items and chances (tested), and so is every existing entry.
- **Economy guards (tested):**
  - regular creatures drop gear at 3% or less, regional bosses at 15% or less;
  - coins per kill stay below 2.5 × the creature's level, and a kill's whole expected value below 4 × its level;
  - value still rises with level;
  - no drop sells to a shop for more than the shop asks for it;
  - every gear drop can also be crafted, so crafting stays the dependable route and drops are a bonus.

### Rarity
`dropRarity(item, chance)`:
- **Rare:** 3% or less.
- **Uncommon:** 12% or less.
- **Common:** anything else. Coins and bones are always common.

The simulation tags each uncommon or rare pile when it lands. The tag goes to the owner's phone with the pile and is saved with it.

**Feedback, one event per kill, for its most notable pile:**
- **Rare drop:** a "Rare drop!" label and a small burst of gold sparks where it landed, the quest chime, and one line in the message log.
- **New collection log find:** "📖 New log entry" and a line in the log naming the creature. The find replaces the "rare drop" line, so nothing is said twice.
- **Uncommon drop:** no label. Its pile name shows in green, as rare names show in gold, and both are visible from further away.
- **Rare pile on the ground:** it gently pulses, from its existing sprite, with no new mesh.
- **Pickup toast:** coloured, with "Uncommon" or "Rare" before the item.

### The creature collection log
`src/data/collection.ts` builds it from the drop tables:
- **Regional bosses:** Grukk, the Bog Mother and Greymane, with their gear drops up to 15% (their signature rewards).
- **Creature finds:** every other creature's gear dropped at 3% or less, 19 entries.

Dungeon bosses pay out through their chests, which keep their own 4D log. An entry is `creature:item`, so the same item from two creatures counts twice.

**Recording:**
- **When:** the moment the item drops, full bag or not. It is the player's, as the pile is.
- **Announced:** once; it stays for good, whatever happens to the item.
- **Where it shows:** the journal has a card per group with a row per creature, the same look as the dungeon logs (found in colour, the rest dimmed and marked "not found yet").

**Saving and safety:**
- **Saved:** as `dropLog` on the character, checked against the known keys on load, so junk is dropped.
- **Older saves:** they have no `dropLog` field and start empty, with their dungeon log untouched. No migration is needed.
- **Server:** a new entry is saved straight away (as a chest is). The phone's copy is replaced from the server's record, so a client can't add entries.
- **Offline:** the single-player game saves at once on a new entry.

### Equipment
**Oak wand** (Magic 12; accuracy 27, power 21; value 110). It is fletched from an oak log and 6 spark chips at Fletching 14 with a knife, and rarely dropped by mire leeches. It fills magic's 1–25 gap. Its damage per second lies between the riverwood wand's and the emberglass wand's (tested). It is the only new item in 5C: every style now steps at most 15 levels between weapons up to 45 (tested).

### Tests
**`tests/phase5c.test.ts` (14 tests):**
- drop rates over 6,000 seeded kills match the tables;
- tables are distinct, useful and within the gear-rarity limits;
- value scales with level and the coin guards hold;
- boss tables are unchanged, with no shop sell-back loop;
- the rarity rule, and rare piles marked and announced once per kill with the pickup toast carrying rarity;
- a full bag leaves a rare pile marked on the ground, through a save;
- log contents, record-once, save and load, junk keys, older saves, and per-creature entries;
- the weapon gaps, oak wand damage per second and value, every gear drop also craftable, and the oak wand made end to end.

**`tests/net-progression.test.ts`:** a log find is rolled on the server, is logged once, is saved at once, reaches the phone with its pile marked rare, and survives a restart. The phone can't write its own log.

**Performance:** draw calls (135–140 and 114–117) and geometries are unchanged. The benchmark machine for this phase was slower than for earlier phases, so 5B and 5C were built and run alternately on it:

| Build | Shrinekeeper | Watchcaptain |
|---|---|---|
| 5B | 13.2 and 13.3 fps | 14.6 and 15.0 fps |
| 5C | 13.5 and 12.3 fps | 15.0 and 14.8 fps |

There is no regression.

### Deferred
- **A shared "rare drop table"** across creatures, as some games have: each creature's own table is enough for now.
- **Showing drop rates in the game**, for example on a creature's examine.
- **Rarity for gathering and thieving finds:** gems in nets, for example.
