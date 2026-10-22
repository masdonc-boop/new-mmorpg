# Brightwater Originality Requirement (permanent)

**Status:** permanent owner requirement. It applies to every development phase and takes precedence over "follow OSRS" wherever the two meet.

Brightwater is an original fantasy MMORPG. It is inspired by the gameplay depth and progression of Old School RuneScape (OSRS), but has its own identity.

## 1. Rules

**What OSRS may be used for:** a reference for *general gameplay mechanics*:
- skills and XP progression
- the inventory and banking
- gathering, processing and crafting loops
- trading and a player-driven economy

**What must be original:**
1. **Quests:** stories, objectives, characters, dialogue, locations and rewards.
2. **Major bosses:** names, appearance, lore, combat mechanics, arenas and unique drops.
3. **Content:** fantasy fish, trees, ores, metals, plants, monsters, equipment and crafting materials. Each needs its own purpose, lore, mechanics and look.
4. **Real-world species and materials** (oak, willow, salmon, trout, iron, copper, gold, etc.) may be used naturally.
5. **Never reproduce RuneScape-specific fiction:**
   - resources, named creatures, gods, kingdoms, questlines and items
   - dialogue, artwork, music and world geography
   - named sets or ladders: no mithril, adamant, rune, dragon, or any rune-based magic economy
6. **Keep Brightwater's own** visual style, map and custom combat system.
7. **Fit new resources in:** each one belongs logically in gathering → processing → crafting → equipment → quests → the Exchange economy.
8. **No reskins.** Renaming an OSRS thing is not original. New content needs a distinct purpose, lore, mechanics and visual identity.
9. **Keep reviewing** existing content (section 3 is the current audit).
10. **Preserve what works:** working features and player save compatibility when replacing content (section 4).

**Checks for every new piece of content:**
- Does an OSRS player recognise it as a specific OSRS thing (name, item set, level/XP table, quest, location)? If yes, redesign it.
- Does it have its own reason to exist in Brightwater's world and economy (lore, a use, a sink)?
- Are its numbers (levels, XP, rates) tuned for Brightwater rather than copied from an OSRS table?

## 2. How this changes the existing design direction

`docs/DESIGN_SPEC.md` said "mechanics follow OSRS". That now means **systems and feel**, never *content or data tables*:

**Still fine (general mechanics):**
- 1–99 skills on an exponential curve, 28 slots, stacking rules, the bank
- tool tiers, resource depletion, burn chances
- level-gated gear, an order-book exchange, buy limits, gravestones

**Not fine (specific content):**
- copied item names and sets, copied quest structures, copied boss designs
- copied level/XP numbers for specific items, OSRS-specific jargon names

## 3. Audit of existing content (2026-10)

**Severity:**
- **High:** recognisably RuneScape-specific. Replace in the next content pass.
- **Medium:** mechanic or data copied too literally (exact level/XP tables or item ladders). Re-tune or redesign when that system is next touched.
- **Low:** acceptable as is.

### High: replace

| # | Existing content | Why it's too close | Recommended replacement |
|---|---|---|---|
| H1 | **Prayer names**: Thick Skin, Burst of Strength, Clarity of Thought, Sharp Eye, Mystic Will, Rock Skin, Superhuman Strength, Improved Reflexes, Rapid Heal, Protect Item, Hawk Eye, Mystic Lore, Steel Skin, Ultimate Strength, Incredible Reflexes, Protect from Melee. Also their exact unlock levels and drain values (`src/data/prayers.ts`) | The OSRS prayer book copied name for name and level for level | **"Vows" of the Brightwater shrines.** Shrine spirits tied to the village's lore: Hearth (warding), Ember (strength), Lantern (focus), Wind (ranged), Tide (magic). Each has 3 tiers with Brightwater names (e.g. *Hearthward*, *Emberheart*, *Lanternsight*), plus original utilities in place of the copies: *Keepsake* (keep an extra item), *Mending Song* (faster regeneration), and a guard vow that **reduces** (not blocks) creature damage and costs extra while used. New unlock levels and drain rates. Optionally rename the skill **Devotion** |
| H2 | **Air runes** as the magic ammo (`air_rune`, the magic style's cost, drops, shop, quest reward) | "Runes" consumed per cast are RuneScape's signature magic system | **Spark stones:** small charged crystals chipped from a new original ore (H6) and charged at the shrine. Wands draw from a *focus charge* that spark stones refill. Gives magic its own gathering → crafting loop |
| H3 | **Platebody / platelegs** item names (bronze, iron, steel) | RuneScape-specific naming | **Breastplate** and **greaves** (or *cuirass* and *tassets*). Same slots and stats |
| H4 | **Leather set and levels:** gloves 1, boots 7, cowl 9, vambraces 11, body 14, chaps 18, made from tanned hides (`src/data/recipes.ts`) | The OSRS leather ladder copied piece for piece and level for level | Keep leatherwork, but design an original set from Brightwater materials: **wolfhide** wraps, hood, jerkin and breeches, plus a **slime-gel-sealed** waterproof variant. New levels |
| H5 | **Big bones** (`big_bones`) | RuneScape item name | **Warlord's bones** (Grukk only), or a size ladder tied to Brightwater monsters (e.g. *wolf bones*, *goblin bones*) with different Prayer XP |
| H6 | **No original ores or metals** beyond the real ones; the bronze → iron → steel ladder (with coal for steel at Smithing 30) follows OSRS exactly | Fails rule 3 (original metals required), and the next OSRS tier would be mithril | Keep real bronze, iron and steel as the early tiers. Above them, original metals: **Glimmerite** (a pale ore in Ironcrag's deep veins, alloyed with silver into *glimsteel*), **Duskiron** (from the Goblin Encampment's slag heaps, heavy and dark), **Emberglass** (volcanic, for magic foci). Each needs its own processing step (e.g. glimsteel must be quenched at the river) |
| H7 | **Shrimps → anchovies** with a small fishing net, levels 1 and 15, "burnt fish" | OSRS's first fishing pair, tool and levels | Original river and coastal fish: **brightfin** (shallows, net), **mudskipper eel** (riverbank, trap), **glass trout** (clear pools, rod), **ember carp** (warm springs, a fire-resistant food). Keep "small net" generic as *hand net* |
| H8 | **Crude wooden chair** and other furniture with OSRS names, levels and XP (`src/data/construction.ts`) | OSRS Construction furniture copied | Brightwater furniture with its own names (e.g. *settler's stool*, *riverwood bench*, *lantern shelf*, *hearth bed*), levels and materials (riverwood planks, gel varnish, spark-stone lamps). Keep the build, remove and rebuild loop |
| H9 | **Thieving targets and numbers:** man/woman level 1 for 8 XP and 3 coins; farmer 10 for 14.5 XP with potato seeds; guard 40 for 46.8 XP and 30 coins; bakery stall 5 for 16 XP; seed stall 27 for 10 XP | OSRS pickpocket and stall table | Keep the townsfolk (original names), but: new XP and levels; **original targets** (a gambler at the inn, a smuggler at the docks, a goblin quartermaster); original stalls (*Tilly's spice cart*, *fishmonger's ice chest*) with Brightwater loot |
| H10 | **Farming allotments:** potato, onion and cabbage at levels 1, 5 and 7, with OSRS planting and harvest XP, 3 seeds per patch, "lives" | OSRS allotment table copied | Keep the patch loop, plus **original crops**: *sunroot* (a cooking staple), *bluebell flax* (feeds Crafting), *glowcap mushrooms* (shade beds, a light source), *wardleaf* (shrine incense for the Prayer/Devotion rework). New levels, XP and growth times |

### Medium: re-tune when the system is next touched

| # | Existing content | Issue | Recommendation |
|---|---|---|---|
| M1 | Smithing levels, XP and bar counts (bronze dagger 1, steel bar = iron ore + 2 coal at 30, steel item levels 30–48) | Exact OSRS table | Re-tune levels and XP; give each metal a distinct property (bronze is cheap and repairable, iron is heavy, steel is balanced) |
| M2 | Mining levels (iron 15, coal 30) and the uncut sapphire rare drop | Exact OSRS numbers; sapphire is real but the drop table mirrors OSRS | Re-tune levels. Make gems Brightwater-specific finds (e.g. *river agate*, *ironcrag garnet*) feeding jewellery |
| M3 | Firemaking XP (logs 40, oak 60) and levels; the tinderbox ladder | Exact OSRS numbers | Re-tune. Add original fire uses (signal beacons, smoke curing fish) |
| M4 | Crafting: flax → bowstring at Crafting 10 on a spinning wheel; sapphire cutting at 20; tanning 1:1 hide to leather | OSRS loop and numbers | Keep the spinning wheel (real), but use original fibres (bluebell flax, H10) and re-tune |
| M5 | Fletching: arrow shafts ×15 per log, shortbow (u) at 5, oak shortbow at 20 | OSRS fletching table | Re-tune quantities and levels; add original bows (riverwood longbow, glimsteel-tipped arrows) |
| M6 | Cooking burn table (shrimps stop burning at 18, anchovies at 34, meat at 20); bread heals 30 | Values mirror OSRS foods | Follows H7. Brightwater foods with their own heal values and effects |
| M7 | Agility course XP (7.5 per obstacle, lap bonus ≈ 40) | Gnome-course-like numbers | Re-tune; give Agility an original benefit (shortcuts and a stamina system that suits custom combat) |
| M8 | Roadmap skill names **Runecraft** and **Slayer** (`docs/DESIGN_SPEC.md`) | RuneScape-specific skill names | Replace with original skills that fill the same roles: **Arcana** (crafting spark stones and foci, tied to H2/H6), and **Bounty** or **Hunting Lodge** (task-based combat contracts from Captain Bram). Keep Herblore as **Herbalism** with original herbs |
| M9 | Exchange buy limits on a 4-hour window; 8 offer slots; "Grand Exchange" in docs | Mechanic is fine, but the exact window, slot count and name are OSRS's | In-game name is already the *Brightwater Exchange*. Re-tune the window and slot count before live trading; keep "Grand Exchange" only as a design reference in internal docs |
| M10 | Death: keep 3 most valuable items, gravestone for 15 minutes | Mechanic copied closely, including the numbers | Keep the idea (allowed mechanic), but give it Brightwater lore: a *shrine wisp* holds your things, with a duration tuned to Brightwater. Consider a fee paid at the shrine to reclaim expired items |

### Low: acceptable as is

- **Places, NPCs and enemies:** Brightwater, Slime Meadows, Whispering Woods, Ironcrag Hills, the Goblin Encampment and the Exchange Plaza. Elder Maren, Tilly Thimble, Captain Bram, Hilda Ironhand, Wendell Coinsworth, Rook Hidewell, Bertram Ashby, Osric, Maud, Farmer Wren, Clerks Pell and Imogen, Hal Tallow. Meadow Slime and Timber Wolf.
- **Grukk the Warlord** is an original name. Goblins are generic folklore, but Grukk still needs original lore, mechanics, an arena and unique drops before he counts as a "major boss" (rule 2).
- **Quest "The Elder's Request":** original story and dialogue. Its rewards include air runes (fix with H2).
- **Generic real materials and tools:** logs, oak, copper, tin, iron, steel, bronze, coal, leather, flax, wolf pelts, fangs, bread, raw and cooked meat, hammer, knife, needle, chisel, saw, rake, spade, seed dibber, tinderbox, nails, planks.
- **Systems:** the toolbelt, the bank (tabs, placeholders), the order-book exchange engine, custom combat, the art style and the map.

## 4. Replacing content without breaking saves

1. **Keep internal ids stable where possible** and change only display names and data (e.g. `air_rune` can display as *Spark stone*). Ids never appear to players.
2. **When an id must change**, add an **alias map** (`old id → new id`) that `Inventory.restore`, `Bank.restore`, the equipment and toolbelt restores and the Exchange restore apply on load. Old saves convert in place, and quantities are kept.
3. **When a whole item disappears** (e.g. shrimps), convert it to its closest replacement 1:1 (shrimps → brightfin). Never delete it. Anything that can't map goes to "held for you".
4. **Prayer rework:** prayers aren't saved (only points). Rename freely; points and the Prayer level carry over.
5. **Furniture:** map built pieces to their replacements (`crude_chair → settler_stool`) in the house restore.
6. **Grants:** use a one-time grant flag per migration (as `tools-v1` and `ammo-v1` do) so conversions run exactly once, with a message that tells the player what changed.
7. **Tests:** for every rename, a test that loads an old save and checks quantities are conserved across the inventory, bank, equipment, belt and Exchange.

## 5. Owner approval and progress

The owner approved the replacement direction on 2026-10-22, with two conditions:
1. The Exchange work is finished or preserved first. Done: it was committed and published before replacements began.
2. Replacements go in small, tested batches that protect saves, inventory items, equipment, recipes and progression.

| Batch | Contents | Status |
|---|---|---|
| 1 | H3 (breastplate, greaves), H5 (warlord's bones), the item-id alias map applied to saves on load, and the originality guard test | Done |
| 2 | H2 spark stones: air runes became spark stones (same id). New loop: mine spark quartz (Mining 5), chip it with a chisel (Crafting 1, 8 chips), charge the chips at the shrine or a waystone (Magic xp) | Done |
| 3 | H1 vows: the Prayer skill is shown as **Devotion**; 16 original vows of five shrine spirits (Hearth, Ember, Lantern, Wind, Tide) with their own levels and per-minute drain; Mending Song, Keepsake, and Hearth's Bulwark (halves creature hits, never fully blocks). Bones give 5 Devotion xp, warlord's bones 18. Saves are unaffected (only points are saved; internal skill id unchanged) | Done |
| 4a | H6, part 1: **Glimmerite and glimsteel.** Glimmerite veins in the deep Ironcrag Hills (Mining 40). Smelt a hot bloom (glimmerite + 2 coal, Smithing 40), then quench it in running water to make glimsteel bars. Glimsteel gear (Smithing 42–58, requires level 30) is light armour that adds a little accuracy; glimsteel tools are tier 4 (level 21) | Done |
| 4b | H6, part 2: **Duskiron.** Slag heaps in the Goblin Encampment (Mining 55); smelted with slime gel as a flux (Smithing 55); very heavy armour that costs accuracy, and a warhammer (level 45). **Emberglass.** The camp's ember vents (Mining 35); the emberglass wand (Crafting 35, Magic 25). Also the riverwood wand (Fletching 10, from logs and spark chips): Brightwater's first real magic weapons | Done |
| 5a | H7 and M6, part 1: **River fish.** Shrimps became **brightfin** and anchovies became **mudskipper eels**, smoked to eat (same ids, so fish in bags, banks and offers carry over). The small fishing net is now a **hand net**. Eels from Fishing 12 (Cooking 12). Retuned heal values, xp and burn levels: brightfin heals 16 (stops burning at 16), smoked mudskipper heals 24 (stops at 30), cooked meat 22 (stops at 22), bread 28. Glass trout (rod) and ember carp (warm springs) are left for when the fishing rod and new spots arrive | Done |
| 5b | H10: **Crops.** Potatoes became **sunroot** (roasted on a range, Cooking 5, heals 34), onions became **wardleaf** (burned as incense at the shrine or a waystone: 4 Devotion xp and a point of devotion per leaf), cabbages became **glowcaps** (pale mushrooms, heal 9). New fourth crop, **bluebell flax** (Farming 12), grows the fibre for bowstrings; wild flax is now also called bluebell flax. Same item and crop ids, so seeds, produce and planted patches carry over. New levels (1, 4, 8, 12), xp and growth times (36–48 minutes), 2 seeds a patch. Glowcaps as a light source waits for a lighting system | Done |
| 6a | H4: **The wolfhide set.** Leather is now *tanned wolfhide*; the set is wolfhide wraps (Crafting 1), boots (3), hood (6), breeches (9, two hides), bracers (12) and jerkin (15, two hides), with new xp. New: the **gel-sealed jerkin** (Crafting 20: a jerkin and 3 slime gel; armour 11). Same item and recipe ids, so worn, carried and banked pieces carry over | Done |
| 6b | H8: **Brightwater furniture.** Settler's stool (Construction 1, a new three-legged model), riverwood chair (7), oak rocker (18), lantern shelf (5, with a spark-stone lamp), oak map cabinet (27), riverwood trestle (11), oak feast table (23), hearth bed (15) and oak canopy bed (29). New xp, plank counts and finishing materials (slime-gel varnish, spark stones, hide bedding). Same furniture ids, so built pieces stay built | Done |
| 6c | H9: **Thieving.** New levels, xp and varied loot for townsfolk (1: coins, nails or thread), Farmer Wren (8: coins and seeds) and Captain Bram (35: coins and arrows), and a new success curve. Stalls are now the baker's cart (4, sometimes roasted sunroot), the seed barrow (20) and a new **fishmonger's ice chest** on the riverbank (14: brightfin, eels from 18). Still to come: original pickpocket targets (a gambler at an inn, a smuggler at docks, a goblin quartermaster), which need new places and characters | Done |
| 7a | Medium retunes, part 1. **M1 Smithing:** each metal now has a base level (bronze 1, iron 13, steel 27) and the same piece ladder (dagger, axe, nails, helm, sword, pickaxe, shield, greaves, breastplate at +0, 1, 2, 3, 4, 5, 7, 9, 11), with xp per bar used (10, 22, 34). Iron smelts at 12; **steel is refined from an iron bar and one coal** at 26. **M2 Mining:** iron 12, coal 24, with new xp; oaks at Woodcutting 12. **M3 Firemaking:** logs 30 xp, oak 48 xp at level 12. **M4:** bowstrings at Crafting 6. **M5 Fletching:** 12 shafts a log, 12 arrows a bar, shortbow 4, oak shortbow 16. **M7 Agility:** obstacles give 6 to 10 xp, lap bonus 30. **M8:** the roadmap already uses original skill names (Herbalism, Bounty, Arcana, Hunting). Player-facing "as in OSRS" text removed. Existing items, xp and levels are untouched: only future actions use the new numbers | Done |
| 7b | Medium retunes, part 2. **M2 gems:** sapphires became **ironcrag garnets** (same ids; found while mining, a little rarer; cut at Crafting 18) and a new **river agate** turns up in fishing nets (polished at Crafting 8). **M10 death:** keep 4 items (5 with Keepsake); a **shrine wisp** guards the rest for 20 minutes, then carries them to the shrines, where they are reclaimed for a tenth of their value, so nothing is destroyed. **M9 Exchange:** 6 offer slots and a 3-hour buy-limit window (offers already in slots 7 and 8 stay visible until collected). **M7 Agility:** each level adds 0.2% walking speed (up to 8%). **M5 bows:** the **riverwood longbow** (Fletching 24, two oak logs and a bowstring; Ranged 22) and **glimsteel-tipped arrows** (Fletching 30; Ranged 25; extra accuracy and power, bows only). Any worn arrows now fire. Still to come: gem jewellery and Agility shortcuts | Done |
| 8 | Follow-ups. **Gem jewellery:** agate charm (Crafting 10, needle and thread), agate band (12), garnet ring (22) and garnet pendant (30) at the furnace, with their own bonuses. **Agility shortcuts** across the river, usable both ways: stepping stones in the south (Agility 10) and a fallen pine in the north (22). **Original pickpocket targets:** Corwin Lightfinger, a dice player outside the inn (Thieving 15); Nell Quickwater, a river trader by the village bridge (25); and Snag, the goblin quartermaster in the encampment (40). Still open: glowcaps as a light source (needs lighting), and glass trout and ember carp (need a fishing rod and new spots) | Done |
| 9 | **Rod fishing and glass trout** (H7 follow-up). The fishing-rod toolbelt slot is open: a **riverwood rod** (on every toolbelt; existing characters get one once, `rod-v1`; Tilly sells spares; or fletch one from a log and a bowstring at Fletching 6). Three **clear pools** upriver on the east bank by the Whispering Woods give **glass trout** from Fishing 20 (48 xp, slower than netting; river agate turns up more often). Cooked at Cooking 20 (58 xp, stops burning at 42), it heals 30. | Done |
| 10 | **Ember carp** (H7 follow-up). Two steaming **warm springs** high in the eastern Ironcrag Hills; rod fishing from Fishing 35 (70 xp). Cooked at Cooking 35 (80 xp) and **never burns** (its scales shrug off flame). Heals 34 and rekindles 4 devotion, so it can be eaten at full health to top up devotion | Done |
| 11 | **Glowcaps as a light source: Glimmer Hollow** (H10 follow-up; the owner chose a dark cave). Old glimmerite workings under the eastern Ironcrag Hills, entered through a cave mouth and left by a rope ladder under a crack of daylight. Pitch dark: without light you can't mine or fight. The **glowcap lantern** (Crafting 12 at the furnace: a bronze bar and a glowcap) burns one glowcap from your bag every four minutes underground. Inside: rich iron, coal, glimmerite and spark quartz veins, glowing glowcap clusters, and **gloom slimes** (level 14, aggressive in the dark; drop slime gel, coins, sometimes glimmerite or glowcaps). The cave sits in an unused corner of the map beyond the southern sea and is reached only through its passages, so nothing on the surface moved | Done |

## 6. Suggested order

1. H2 (spark stones) and H6 (original metals) together: they define magic and the gear ladder.
2. H1 (vows) once H2 exists, since shrines charge spark stones.
3. H7 and H10 (fish, crops) with the cooking re-tune (M6).
4. H3, H4, H5, H8 and H9 (names and tables) as one "originality pass", with the alias map from section 4.
5. Medium items whenever their system is next worked on.
