# Brightwater Design Specification: OSRS as the Gameplay Reference

**Status:** permanent design direction, adopted with the toolbelt update.
**Owner decision:** Brightwater closely follows *Old School RuneScape* (OSRS) for gameplay systems, progression, economy, inventory, banking, skills, equipment, quests and general mechanics.

## 1. Principles

1. **Mechanics follow OSRS.** When a system exists in OSRS, Brightwater's version should behave the way an OSRS player expects:
   - 28-slot inventory, non-stacking resources and stacking currency, ammo and runes
   - levels 1–99 on the classic XP curve, no professions, every skill trainable by every character
   - level-gated gear, tools and recipes
   - banks, shops, quests, and so on
2. **Generic MMORPG replacements need approval.** Brightwater does not swap OSRS-style mechanics for generic MMO systems without explicit owner approval. Examples of what not to do:
   - talent trees, gear score, auto-loot, quest markers that play the game for you
   - stamina bars on gathering, crafting queues that run offline
3. **Everything creative is original.** We follow OSRS's *rules*, never its *content*. Code, art, models, icons, names of places, characters, quests, lore and all writing are Brightwater's own. Common fantasy vocabulary such as "bronze sword", "shrimps" or "furnace" is fine. RuneScape's distinctive proper nouns, quest plots, dialogue, music, item art or maps are not used.
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
| Skills | Attack, Strength, Defence, Hitpoints, Ranged, Magic, Woodcutting, Mining, Fishing, Smithing, Fletching, Cooking (12) | 23 skills | Missing: Prayer, Firemaking, Crafting, Herblore, Agility, Thieving, Slayer, Farming, Runecraft, Hunter, Construction |
| Inventory | 28 slots; resources one per slot; coins, ammo and runes stack | Same | Noted (inventory item) and drag-to-reorder missing; we use press-and-hold then tap to move |
| Bank | 200 slots, all items stack, search, categories, deposit and withdraw 1/5/X/all | 800 slots (fewer on free worlds), tabs, placeholders, noted withdrawal, deposit worn items | Tabs, placeholders, withdraw-as-note, deposit-equipment button |
| Equipment | 5 slots: head, body, legs, weapon, shield | 11 slots: head, cape, neck, ammo, weapon, body, shield, legs, hands, feet, ring | Cape, neck, ammo, hands, feet, ring slots. Arrows are used from the bag instead of an ammo slot |
| Gathering | Trees, rocks, net fishing; tool tiers (bronze, iron); depletion and respawn; rare gems | Same pattern | More tiers (steel and above), more resources, rod and bait fishing, harpoon |
| Smithing | Furnace (bronze, iron), anvil (weapons, armour, axes, pickaxes) with hammer | Same pattern | Steel and above; more items (arrowtips, nails, bolts) |
| Fletching | Knife on logs: shafts, unstrung bows; bowstring stringing; arrows | Same pattern | Feathers and headless arrows, longbows, more log tiers; bowstrings from Crafting (flax) |
| Cooking | Range and fire; burn chance falls with level; food heals | Same | More foods, multi-step food (bread, pies), stop-burn by level per food |
| Shops | Fixed price, unlimited stock, buy and sell | Stock levels that restock; price changes with stock | Stock and restock, dynamic pricing |
| Ground items | Drops on the ground, owner-only then public, then despawn | Same structure (shorter timers) | Timers differ (approved, 4.2) |
| Death | You keep everything, respawn at the shrine | Keep a few most valuable items; others go to a gravestone or reclaim system | **Needs owner decision** (roadmap P0) |
| Quests | 1 quest with item and XP rewards | Many quests; quest points; requirements | More quests, quest points, quest requirements on content |
| Economy | Coins, shop buy and sell | Player trading, Grand Exchange | Trading and an exchange arrive with multiplayer |
| Combat | Custom real-time system (section 5) | Tick-based OSRS combat | Intentional exception |
| Movement | Joystick or tap-to-move, continuous | Click-to-move on 0.6 s ticks, run energy | Run energy not implemented (needs decision) |

## 3. Missing OSRS-style features (not yet scheduled)

- **Skills:** Firemaking, Crafting, Prayer, Herblore, Agility, Thieving, Slayer, Farming, Runecraft, Hunter, Construction.
- **Equipment:** remaining slots, an ammo slot, and equipment stat tables (stab, slash and crush style bonuses, adapted to custom combat).
- **Banking:** tabs, placeholders, noting, deposit worn items.
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
| 4.5 | Auto-continue gathering onto the nearest node of the same type when one depletes | Pending | OSRS does not auto-switch nodes; candidate for removal or a setting |
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

When an OSRS feature touches combat (Prayer, special attacks, Slayer and so on), it is adapted to these rules rather than ported literally, with owner approval.

## 6. Prioritized roadmap

Each step is a separate development pass with its own tests and an Android check.

**P0: consistency decisions (small, do first)**
1. **Death rule.** Owner decision: keep the current "keep everything", or adopt OSRS-style keep-3 with a gravestone or reclaim.
2. **Auto-continue gathering (4.5).** Keep as a setting, or remove to match OSRS.
3. **Ammo slot.** Equip arrows like OSRS instead of drawing them from the bag. Small, contained change.

**P1: complete existing loops the OSRS way**
4. **Firemaking:** logs and tinderbox (a new toolbelt slot), lighting fires anywhere. Gives Cooking OSRS's fire loop.
5. **Crafting:** leather from wolf pelts, flax into bowstrings, gem cutting (sapphires already drop). Makes bowstrings a skill product, not shop-only.
6. **Equipment slots:** hands, feet, cape, neck, ring. Armour from Smithing and Crafting.
7. **Steel tier:** coal and steel bars, steel tools (with their tool-tier requirements), steel gear.
8. **Bank tabs and placeholders.**

**P2: new OSRS skills, one at a time**
9. **Prayer:** bury bones (already dropped); prayers adapted to custom combat.
10. **Thieving and Agility:** stalls, pickpocketing, a village shortcut course.
11. **Farming:** patches, seeds, growth timers; unlocks the rake, seed dibber and spade toolbelt slots.
12. **Construction:** saw and hammer; unlocks the saw toolbelt slot.

**P3: multiplayer-dependent**
13. Server-authoritative simulation, player trading, an exchange, shop stock shared between players, account-wide bank storage.

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
