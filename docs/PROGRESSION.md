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
