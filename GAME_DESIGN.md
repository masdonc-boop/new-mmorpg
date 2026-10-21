# Brightwater — Game Design

Living design document for a mobile-first, stylized 2.5D isometric fantasy MMORPG inspired by the depth and longevity of Old School RuneScape. Phase 1 is a single-player vertical slice; everything below marked **(future)** is a binding long-term decision the architecture must support.

## Long-term pillars (binding decisions)

### Characters & progression
- **Humans are the only playable race.** Customization covers build, skin, hair style/colour and clothing.
- **One character per account.** (Phase 1 stores one character per device; "New character" replaces it.)
- **Classless progression** — one character can master every skill. There are no class locks; combat style is chosen per fight (melee, ranged, magic) and can be switched at any time.
- **Deep RuneScape-style skill advancement**: independent experience per skill, levels 1–99 on a long exponential curve (level 99 ≈ 13M xp), total level and combat level derived from skills.
- **Automatic gathering and crafting while actively playing.** Tapping a resource starts a repeating action loop that continues while the player stays nearby; no idle/offline progression.

### World & content
- **A fully visible world map** with regions of clearly different difficulty (colour-coded danger, recommended levels).
- **Major story quests** plus **optional regional contracts** (repeatable, region-specific tasks).
- **Boss-focused top-tier equipment progression** — the best gear comes from bosses, not from shops or crafting alone.
- **Solo, group, and raid bosses** (future).
- **Personal loot rolls for eligible participants** — no loot stealing; each eligible player rolls their own drops. Drops fall on the ground as piles owned by the player who earned them: **visible only to the owner for 10 minutes, then to everyone for 5 more minutes, then gone** (`LOOT_PRIVATE_SECONDS` / `LOOT_PUBLIC_SECONDS`). Visibility is decided by the simulation (`GroundItem.visibleTo(playerId)`), so the future server only sends each client the piles it may see. Picking up follows the inventory capacity rules; what does not fit stays on the ground.

### Economy & social (future unless noted)
- **Player-driven economy** with direct **trading** and an **auction house**.
- **Friends, parties, and chat at the initial multiplayer launch.**
- **Free-to-play with optional membership and no pay-to-win.** Membership may add content breadth (regions, quests, skills) and convenience that does not confer power advantages purchasable with money.

### PvP & risk
- **Consensual open-world PvP challenges** only — no forced PvP.
- **Duels**: friendly (no risk), gear-risk, and optionally **staked duels, subject to safety and legal review** before any real implementation (gambling regulations, age gating, regional law).
- **PvE death retains items but degrades equipped gear** (durability loss; repair as a gold sink). Phase 1 keeps items; durability arrives with equipment.
- **Respawn choice between bound home and nearest unlocked checkpoint.** Implemented in Phase 1: waystones attune on approach; the death screen offers home or the nearest attuned waystone.

### Presentation
- Colourful, stylized, readable art; lush environments; satisfying feedback (particles, hit numbers, level-up bursts).
- Original or appropriately licensed assets only. Phase 1 art is entirely procedural and generated in code.
- Art direction, proportions, palette, lighting and LOD rules: see [docs/ART_STYLE.md](docs/ART_STYLE.md) (Phase 2A).
- **Camera behaviour remains subject to actual mobile gameplay testing.** Default: elevated isometric follow camera with pinch zoom; rotation is an experimental toggle in Settings.

## Phase 1 vertical slice (delivered)

| Area | Implementation |
| --- | --- |
| World | 112×112 tile island: Brightwater Village, Slime Meadows (W, across the river), Whispering Woods (N), Ironcrag Hills (E), Goblin Encampment (NE), Southern Fields (S) |
| Character | Creator with build, skin, hair style, hair/tunic/trouser colours; live 3D preview |
| Movement | Floating virtual joystick (8-direction+, analog), tap-to-move with A* pathfinding, WASD on desktop |
| Camera | Elevated follow camera, pinch / wheel / button zoom, experimental rotation |
| Combat | Melee (sword), Ranged (bow + arrows), Magic (staff + air runes); select an enemy and attacks repeat automatically; projectiles; accuracy/max-hit formulas |
| Enemies | Meadow Slime (passive), Timber Wolf (aggressive), Goblin Raider (aggressive), Grukk the Warlord (mini-boss); wander, aggro, chase, leash, respawn |
| Survival | HP from Hitpoints level, out-of-combat regen, food, death, respawn choice |
| Gathering | Woodcutting (trees, oaks) and Mining (copper, tin, iron + rare gems); node depletion & regrowth; auto-continue to nearby nodes |
| Items | 28-slot inventory enforced by the simulation; only currency, ammo and runes stack (per item definition); gathered resources (logs, ores, gems, later fish) take one slot each; gathering stops with "Your inventory is full." and never rolls, grants xp or depletes a node without room; quest rewards wait until they fit; older saves migrate with any excess held, not deleted; drop with confirmation for valuable items; eat/move |
| Skills | Attack, Strength, Defence, Hitpoints, Ranged, Magic, Woodcutting, Mining |
| Quest | "The Elder's Request" — talk, gather 5 logs, defeat 3 slimes, rewards |
| Persistence | Local save (localStorage) every 10s and on backgrounding |

### Tuning notes
- XP: combat grants 1.2 xp per damage split across the style's skills, plus 0.4 Hitpoints xp per damage. Gathering grants fixed xp per success.
- HP scale is ×10 (Hitpoints 10 → 100 HP) so hits read as satisfying numbers.
- Aggressive monsters ignore players whose combat level exceeds roughly twice their own (except bosses).

## Architecture for multiplayer

```
src/sim/      Pure TypeScript game rules — no DOM, no Three.js.
              GameWorld.issue(Command) → tick(dt) → drainEvents(): GameEvent[]
src/data/     Static content definitions (items, enemies, resources, quests, NPCs, skills)
src/render/   Three.js presentation; reads sim state, interpolates between ticks
src/ui/       DOM HUD and panels; sends Commands, reacts to GameEvents
src/input/    Touch / mouse / keyboard → Commands
```

- **Commands** (`joystick`, `moveTo`, `interact`, `setStyle`, `useItem`, …) are already the shape of client→server messages. **GameEvents** are the shape of server→client messages.
- The sim runs on a **fixed 30 Hz tick**; the renderer interpolates. A future authoritative server runs the same `src/sim` code (Node) and the client keeps a predicted copy of the local player.
- World generation is **seeded and deterministic**, so server and clients can generate identical terrain from a seed.
- `SaveData` is the persistence contract for a future account database (one character per account).
- Next server steps: move `Player` into a per-connection map, add entity IDs to network snapshots, add interest management by region chunk, then trading/auction services as separate modules operating on server-side inventories only.
