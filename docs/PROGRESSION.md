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
