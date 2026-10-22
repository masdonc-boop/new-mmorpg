# Brightwater Design Specification: OSRS as the Gameplay Reference

**Status:** permanent design direction, adopted with the toolbelt update.
**Owner decision:** Brightwater closely follows *Old School RuneScape* (OSRS) for gameplay systems, progression, economy, inventory, banking, skills, equipment and general mechanics.

**Permanent originality requirement (takes precedence):** `docs/ORIGINALITY.md`. OSRS is a reference for *general mechanics only*. Quests, bosses, fish, trees, ores, metals, plants, monsters, equipment, materials and their names, lore and data tables must be Brightwater's own. Real-world species and materials are fine; RuneScape-specific fiction is not.

## 1. Principles

1. **Mechanics follow OSRS; content never does.** When a system exists in OSRS, Brightwater's version should feel the way an OSRS player expects, but its content and numbers are Brightwater's own (see `docs/ORIGINALITY.md`). Systems:
   - 28-slot inventory, non-stacking resources and stacking currency and ammo
   - levels 1–99 on the classic XP curve, no professions, every skill trainable by every character
   - level-gated gear, tools and recipes
   - banks, shops, quests, and so on
2. **Generic MMORPG replacements need approval.** Brightwater does not swap OSRS-style mechanics for generic MMO systems without explicit owner approval. Examples of what not to do:
   - talent trees, gear score, auto-loot, quest markers that play the game for you
   - stamina bars on gathering, crafting queues that run offline
3. **Everything creative is original.** We follow OSRS's *rules*, never its *content*. Code, art, models, icons, names of places, characters, quests, bosses, resources, items, lore and all writing are Brightwater's own, and so are item ladders and level/XP tables. Real-world words such as "bronze sword", "oak" or "furnace" are fine. RuneScape-specific fiction (resources, creatures, gods, kingdoms, questlines, items, dialogue, artwork, music, geography) is never used, and renaming an OSRS thing does not make it original. The current audit and replacement plan is in `docs/ORIGINALITY.md` section 3.
4. **Approved differences** are limited to four areas:
   - Brightwater's stylized 3D graphics
   - its world map, environments, characters and lore
   - the custom combat system
   - quality-of-life (QoL) improvements individually approved (section 4)
5. **Server-ready.** All rules run in the deterministic simulation (`src/sim`). The client sends commands and renders events, so systems can move to a server unchanged.

## 2. Current Brightwater systems compared with OSRS

| System | Brightwater today | OSRS reference | Gap |
|---|---|---|---|
| XP curve | 1–99, classic exponential table (`data/skills.ts`) | Same curve | None |
| Skills | Attack, Strength, Defence, Hitpoints, Ranged, Magic, Prayer, Woodcutting, Mining, Fishing, Smithing, Fletching, Cooking, Firemaking, Crafting, Thieving, Agility, Farming, Construction (19) | 23 skills | Not yet: original equivalents planned as Herbalism, Bounty, Arcana and Hunting (no RuneScape-specific skill names; `docs/ORIGINALITY.md` M8) |
| Inventory | 28 slots; resources one per slot; coins, ammo and runes stack | Same | Noted (inventory item) and drag-to-reorder missing; we use press-and-hold then tap to move |
| Bank | 200 slots, all items stack, search, categories, up to 9 tabs plus main, placeholders (setting), deposit and withdraw 1/5/X/all | 800 slots (fewer on free worlds), tabs, placeholders, noted withdrawal, deposit worn items | Withdraw-as-note, deposit-equipment button, tab reordering by drag |
| Equipment | All 11 slots: head, cape, neck, ammo, weapon, shield, body, legs, hands, feet, ring (arrows worn as a stack; amulets add accuracy and power to every style) | Same 11 slots | No rings yet (they need gold and jewellery) |
| Gathering | Trees, rocks (copper, tin, iron, coal), net fishing, flax; tool tiers (bronze, iron, steel); depletion and respawn; rare gems | Same pattern | Mithril and above, rod and bait fishing, harpoon |
| Smithing | Furnace (bronze, iron, steel), anvil (weapons, armour, axes, pickaxes) with hammer | Same pattern | Mithril and above; more items (arrowtips, nails, bolts) |
| Fletching | Knife on logs: shafts, unstrung bows; bowstring stringing; arrows | Same pattern | Feathers and headless arrows, longbows, more log tiers |
| Firemaking | Tinderbox on logs (normal 1, oak 15), lights where you stand and steps you aside; fires cook and leave ashes | Same | Willow and above; fires are not saved (they burn out) |
| Devotion (prayer-style skill) | Bury bones (5) and warlord's bones (18); 16 original vows of the five shrine spirits, to Hearth's Bulwark (40); per-minute devotion drain; restore at the shrine or a waystone | A prayer skill with altars | Vows above 40; devotion bonus on gear |
| Thieving | Pickpocket townsfolk (1), farmer (8), guard (35); baker's cart (4), fishmonger's ice chest (14) and seed barrow (20); stun on failure | Same pattern | Stall owners and guards don't catch you yet; no auto-repeat |
| Agility | Village course (5 obstacles, lap bonus); slips on the beam at low level | Many courses, shortcuts, run energy | One course; no shortcuts; no run energy to restore |
| Farming | 4 allotments: rake, plant 2 seeds, real-time growth (36–48 min), harvest with lives; sunroot, wardleaf (shrine incense), glowcaps, bluebell flax | Same, plus herbs, trees, disease, compost, watering | Disease, compost, watering, other patch types |
| Construction | House north of the village with 4 spaces (chair, bookcase, table, bed); planks from the sawmill, nails from the anvil; build, remove, rebuild | Instanced house, rooms, many hotspots, estate agent | Rooms, buying the house, more furniture; nails are one per plank |
| Crafting | Tanner (2 coins a pelt), needle and thread on tanned wolfhide (the wolfhide set, plus a gel-sealed jerkin), fang amulet, chisel on garnets and river agate, flax spun into bowstrings | Same pattern (cowhide, thread used 1 per 5 items) | Pottery, glass, jewellery; thread is used one per item (simplification) |
| Cooking | Range and fire; burn chance falls with level; food heals | Same | More foods, multi-step food (bread, pies), stop-burn by level per food |
| Shops | Fixed price, unlimited stock, buy and sell | Stock levels that restock; price changes with stock | Stock and restock, dynamic pricing |
| Ground items | Drops on the ground, owner-only then public, then despawn | Same structure (shorter timers) | Timers differ (approved, 4.2) |
| Death | Keep the 4 most valuable items (5 with the Keepsake vow); a shrine wisp guards the rest for 20 minutes of play (owner only), then carries them to the shrines, where they can be reclaimed for a tenth of their value. Toolbelt is never at risk | Keep some; a marker, then a paid reclaim | No PvP rules yet |
| Quests | 1 quest with item and XP rewards | Many quests; quest points; requirements | More quests, quest points, quest requirements on content |
| Economy | Coins, shop buy and sell; the Exchange plaza with a full order-book engine running as a clearly labelled **practice market** (simulated traders, practice balances) | Player trading, Grand Exchange | Live player-to-player trading and the real-wealth bridge need the multiplayer backend (see docs/EXCHANGE.md) |
| Combat | Custom real-time system (section 5) | Tick-based OSRS combat | Intentional exception |
| Movement | Joystick or tap-to-move, continuous | Click-to-move on 0.6 s ticks, run energy | Run energy not implemented (needs decision) |

## 3. Missing OSRS-style features (not yet scheduled)

- **Skills:** Herbalism, Bounty, Arcana and Hunting (original equivalents; see `docs/ORIGINALITY.md` M8).
- **Equipment:** rings (jewellery) and equipment stat tables (stab, slash and crush style bonuses, adapted to custom combat).
- **Banking:** noting, deposit worn items.
- **Economy:** shop stock and restock, player trading, an exchange.
- **Quests:** a quest point system and more quests with original stories.
- **Misc:** run energy, item notes, drag-reorder in the bag, "examine" text on everything, world map icons for services.

## 4. Quality-of-life improvements (separate from core mechanics)

Only items marked **Approved** are design-final. Everything else is in the game today but should be confirmed or reverted.

| # | Improvement | Status | Notes |
|---|---|---|---|
| 4.1 | **Toolbelt**: one tool per category (pickaxe, axe, hammer, knife, small net, and locked future slots for fishing rod, saw, rake, seed dibber and spade). Tools on the belt take no bag slots. | **Approved** | Tools must be obtained normally; use requirements and tiers still apply; only the single best usable tool counts (no stacking bonus) |
| 4.2 | Ground-drop timers: 10 minutes owner-only, then 5 minutes public | **Approved** (owner request) | Longer than OSRS for mobile play |
| 4.3 | Tap an item to use it (eat, wield, fletch, add to belt); press and hold for options | **Approved** (owner request) | Mobile equivalent of OSRS left-click default actions |
| 4.4 | Contextual "nearby" prompt chip for stations, bank, shop and fishing spots | Pending | Mobile accessibility aid |
| 4.5 | Auto-continue gathering onto the nearest node of the same type when one depletes | **Approved as a setting, off by default** | Off matches OSRS; saved with the character |
| 4.6 | "Held for you" overflow when a save migration can't fit items | Pending (technical) | Safety net for data changes; not a gameplay system |
| 4.7 | Bank shows "room for N" and the bank-full and inventory-full notices | Pending | Pure interface |
| 4.8 | Fletching anywhere without a station, knife on logs | Matches OSRS | Listed for clarity |

## 5. Custom combat: where exceptions apply

The combat system is a deliberate Brightwater feature. OSRS rules apply everywhere else, with these exceptions:

- **Real-time movement:** joystick and tap-to-move instead of OSRS tick movement. Attack speed is in seconds (`STYLES.attackSeconds`), not game ticks.
- **Style button:** melee, ranged or magic, instead of OSRS attack styles (accurate, aggressive, defensive and so on). XP is split across the style's skills (melee splits Attack, Strength and Defence) rather than chosen per style. *Roadmap P1 proposes optional XP-focus stances within this system.*
- **Hit formula:** custom accuracy and max hit (`sim/combat.ts`). Equipment feeds it as accuracy, power and armour rather than OSRS's attack, strength and defence bonus tables.
- **Training weapons:** a style with no matching weapon uses a built-in training weapon, so new characters can fight all three styles.
- **Magic:** a single starter spell costing one air rune per cast. No spellbook yet.
- **Hitpoints:** ×10 scale (level 10 = 100 HP). Food values are scaled to match.
- **Auto-retaliate:** always on. Gathering and crafting are interrupted when attacked.

When an OSRS-style system touches combat (Prayer, special attacks, task-based combat and so on), it is adapted to these rules rather than ported literally, with owner approval.

## 6. Prioritized roadmap

Each step is a separate development pass with its own tests and an Android check.

**P0: consistency decisions (done)**
1. **Death rule:** keep 4, with a shrine wisp and a paid shrine reclaim (section 8; reworked for originality, `docs/ORIGINALITY.md` M10). The owner had no preference.
2. **Auto-continue gathering (4.5):** a setting, off by default.
3. **Ammo slot:** arrows are worn as a stack and bows fire from it; runes stay in the bag, as in OSRS.

**P1: complete existing loops the OSRS way (done)**
4. **Firemaking:** tinderbox (new toolbelt slot) on logs, fires anywhere that cook and leave ashes.
5. **Crafting:** Rook the tanner, the wolfhide set, fang amulet, gem cutting, flax spun into bowstrings at the spinning wheel. Needle and chisel are new toolbelt slots.
6. **Equipment slots:** all 11. Ring slot is empty until jewellery arrives.
7. **Steel tier:** coal rocks (Mining 30), steel bars (Smithing 30), steel tools (tier 3, need level 6 to use) and gear (level 20).
8. **Bank tabs and placeholders:** up to 9 tabs plus main; placeholders as a bank setting (off by default).

Owner notes on P1 choices:
- New characters start with tinderbox, needle and chisel on the toolbelt, like the other skill tools; existing saves receive them once.
- Thread is used one per item (OSRS: one per five). Tanning costs 2 coins per pelt.
- Wolf pelts no longer stack (like OSRS hides); older saves split their stacks into slots.

**P2: new OSRS skills (done)**
9. **Prayer → Devotion:** bury bones; vows to the shrine spirits raise effective levels in the custom hit formula. Replaced in originality batch 3 (`docs/ORIGINALITY.md`).
10. **Thieving and Agility:** pickpocketing (townsfolk, farmer, guard), the baker's cart, ice chest and seed barrow; the village obstacle course east of the smithy.
11. **Farming:** four allotments, real-time growth that continues while away; rake, seed dibber and spade toolbelt slots.
12. **Construction:** a house north of the village with four furniture spaces; Bertram's sawmill; nails from the anvil; saw toolbelt slot.

Owner notes on P2 choices:
- New characters start with every skill tool on the toolbelt (rake, seed dibber, spade, saw included); older saves receive them once.
- The house is free (OSRS charges for a house) and has fixed spaces rather than rooms. Planks cost 5 coins (oak 15).
- Crops take OSRS-like real time (about 40 minutes). No disease, compost or watering yet.
- Stall owners and guards don't catch thieves yet; Agility has no run-energy benefit because run energy doesn't exist.

**Exchange (owner priority, built ahead of P3):** the engine (escrow, price-time matching, settlement, replay protection, audit chain), the Exchange plaza and the mobile interface are in, running on a local practice market. Architecture, rules and the migration path to live trading: `docs/EXCHANGE.md`.

**P3: multiplayer-dependent (on hold, owner decision)**
13. Server-authoritative simulation, player trading, an exchange, shop stock shared between players, account-wide bank storage.

Phase 3A plan: the multiplayer architecture, codebase audit and milestone roadmap are in `docs/MULTIPLAYER.md` (plan only; nothing built or hosted). Recommended first milestone: 3A.1, simulation readiness.

Owner decisions so far:
- On hold: no server is built until hosting is chosen (no paid services or public deployment without approval).
- Sign-in, when it comes: simple username and password accounts stored on the game server, with hashed passwords.

## 7. Toolbelt reference (implemented)

- **Where the code lives:**
  - data: `src/data/tools.ts` (categories and slot metadata)
  - logic: `src/sim/toolbelt.ts` (add, remove, best-tool)
  - item tool info: `ItemDef.tool = { category, tier, req? }`
- **Commands:**
  - `beltAdd {slot}` swaps out any tool already in that category, into the freed bag slot.
  - `beltRemove {category}` needs a free bag slot.
  - `beltAddAll` fills only empty belt slots.
  - Each command is all-or-nothing and emits a `toolbelt` event.
- **Recognition:** gathering (`ResourceDef.tool`) and recipes (`RecipeDef.tool`) name a tool category. The action uses the highest-tier tool of that category on the belt or in the bag whose requirement is met. A better tier raises the gathering success chance; owning several gives nothing extra.
- **Saving:** stored in the save as `toolbelt`. Invalid entries move to held items rather than being deleted.
  - **Existing saves:** on first load, tools already in the bag move onto empty belt slots once (`grants: toolbelt-v1`).
  - **New characters:** start with bronze pickaxe, bronze axe, hammer, knife and small net on the belt.
- **Banking:** tools move between the bank and the belt through the bag. Take off the belt to bank; withdraw, then tap to add.

## 8. Death and shrine wisps (implemented)

- **What you keep:** your 4 most valuable items by value (5 with the Keepsake vow), counted one unit at a time across the bag and worn gear (ammo included), so a stack can be partly kept. Worn gear wins ties. Kept items stay where they were.
- **What the wisp guards:** everything else you carried. Toolbelt tools are never at risk (a QoL store for tools), and neither are the bank or "held for you" items.
- **The shrine wisp:** a glowing orb that hovers where you fell, shows a countdown, and only its owner can use it. Tap it to take back as much as fits; the rest waits. It lasts 20 minutes of play (the timer is saved and only runs while playing). Dying again makes a separate wisp.
- **When a wisp fades** it carries what is left to the shrines. Reclaim it at the shrine or any waystone for an offering of a tenth of each item's value (at least 1 coin each; coins themselves come back free). Nothing is ever destroyed.
- **No wisp** appears if you carried 4 items or fewer.
- **Code:** `src/sim/death.ts` (`takeLostOnDeath`, `KEEP_ON_DEATH`, `GRAVE_SECONDS`, `reclaimFee`); `Gravestone` (the wisp) and `reclaimHeld` in `src/sim/world.ts`; saved as `graves` and `shrineHeld`.
- **Not yet:** PvP rules (they need multiplayer).
