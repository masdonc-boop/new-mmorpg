# Brightwater Multiplayer: Architecture, Codebase Audit and Phase 3A Roadmap

Status: **plan only**. Nothing in this document is built, hosted or deployed. No paid services, no public server, no live trading. Each milestone below is a separate pass that needs owner approval to start; anything public (hosting, accounts open to others, live trading) needs a separate approval on top of that.

Related documents: `docs/EXCHANGE.md` (exchange engine and live-trading path), `docs/DESIGN_SPEC.md` (roadmap, P3), `docs/ORIGINALITY.md` (content rules, which apply to every new region, race and instance).

---

## 1. Summary

- **Approach:** the same TypeScript simulation that runs in the browser today becomes the authoritative simulation on a Node.js server. The browser keeps rendering, input, the HUD and audio, and runs a *replica* of the world that the server keeps in sync. The server never trusts client state; clients only send intents (the existing `Command` union).
- **Stack (all free, all runnable on a laptop):** Node.js 22 + TypeScript, WebSockets (`ws`), SQLite (`better-sqlite3`) behind a small repository interface, password hashing with Node's built-in `crypto.scrypt`, Vitest for unit, integration and bot tests. PostgreSQL only later, if and when regional servers need a shared database.
- **Path:** first make the simulation multi-player-ready without changing gameplay (3A.1). Then put it behind a local server one player at a time (3A.2 to 3A.4). Only then share one world between players (3A.5 onward). Regions, instancing and racial starting regions come last and build on a "zone" abstraction introduced early.
- **Recommended first milestone:** **3A.1 Simulation readiness**: per-player ids, a strict command validator, and splitting the save into a character record and world state. No server, no new dependencies, no gameplay change (section 9).

---

## 2. Codebase audit

### 2.1 What exists (October 2026)

| Area | Files | Size | Notes |
|---|---|---|---|
| Simulation | `src/sim/world.ts` and helpers (`inventory`, `bank`, `equipment`, `toolbelt`, `skills`, `combat`, `death`, `pathfinding`, `worldmap`) | ~5,200 lines | Pure TypeScript, no DOM. Fixed 30 Hz tick (`TICK_SECONDS`). Commands in (`issue(cmd)`), events out (`drainEvents()`). |
| Game data | `src/data/*` | ~1,450 lines | Static tables: items, recipes, resources, enemies, NPCs, quests, skills, vows, crops and so on. Shared by client and server unchanged. |
| Exchange | `src/exchange/engine.ts`, `simulation.ts` | ~620 lines | Already server-shaped: single writer `submit()`, per-account nonces, escrow, audit hash chain, `verify()` supply check. `PracticeMarket` runs simulated traders locally. |
| Rendering | `src/render/*` | ~6,000 lines | Three.js. Reads simulation objects directly (`world.player`, `world.enemies`, `world.nodes`, …) and reacts to events. |
| UI | `src/ui/*` | ~4,300 lines | HUD, panels, bank, exchange, crafting, map. Reads the world and calls query helpers (`craftBlocker`, `buildBlocker`, `patchState`, `isLit`, …); sends `Command`s. |
| Input | `src/input/controls.ts` | 254 lines | Touch joystick, tap, pinch, rotate. Client-only. |
| Boot and saving | `src/main.ts` | 269 lines | Creates one `GameWorld`, runs the fixed-step loop, saves `world.save()` to `localStorage` (`brightwater.save.v1`) every 10 s and on hide. |
| Tests | `tests/*` | 19 files, 288 tests | Simulation, exchange, saves, originality, world generation, UI view models. |

### 2.2 What is already multiplayer-friendly

1. **Intent-based commands.** `Command` (47 kinds: `moveTo`, `interact`, `craft`, `bankWithdraw`, `exchange`, …) is already what a client would send. Every command is validated inside the simulation (distance, level, tools, space, coins), not by the UI.
2. **Events, not callbacks.** The client learns what happened from `GameEvent`s (47 kinds). These can be serialised and sent over the network largely unchanged.
3. **Determinism is controllable.** The world takes an injected `clock` (farming uses real time) and a seeded RNG (`mulberry32`). World generation is deterministic from a seed (`generateWorld(1337)`), and later content is placed with its own streams (`placeLater`) so the map never shifts. Client and server can both build the same map from the seed; only dynamic state needs to travel.
4. **Save sanitising.** `new GameWorld({ save })` already repairs and validates saves: alias remapping (`remapItemIds`), item-id checks, clamping, one-time grant flags, overflow ("held for you") instead of loss. This is exactly the path needed to import browser saves on a server.
5. **Ownership concepts.** Ground items have an `owner` and a private period (`visibleTo(playerId)`); shrine wisps (`Gravestone`) have an owner. These map directly onto multiple players.
6. **Conservation tests.** `tests/p0-rules.test.ts` counts every item a player owns everywhere (`owned()`) and asserts nothing is created or lost. This is the seed of the anti-duplication test suite.
7. **The exchange engine.** Designed for server authority from the start (see `docs/EXCHANGE.md`); the client already sends `ExchangeIntent`s without an account, and the world fills in the account.

### 2.3 What assumes a single player (must change)

| # | Assumption | Where | Change needed |
|---|---|---|---|
| A1 | Exactly one player, `readonly id = 1` | `Player` in `world.ts`; `world.player` used ~120 times in `world.ts` | A `players` map keyed by `PlayerId`; every command and update runs *for a player*. Keep `world.player` as "the local player" on the client replica only. |
| A2 | Events have no recipient | `emit()` (92 call sites) | Events get an audience: one player (messages, inventory, dialogue), nearby players (attacks, damage, gathering), or everyone in the zone (node depleted, fire lit). |
| A3 | Enemies chase "the player" | `e.target === p.id` and aggro checks | Targets are any player id; aggro picks the nearest eligible player; leash and retaliation per target. |
| A4 | Per-character and world state share one save | `SaveData`: `ground`, `graves`, `patches`, `house`, `exchangePractice` sit beside skills and inventory | Split into a **character record** (skills, inventory, bank, equipment, belt, quests, position, grants, house, allotments, held items) and **zone state** (ground items, wisps, node depletion, fires). |
| A5 | Personal places live in the shared map | House plot and the four allotments are single fixed spots | They become **personal instances** (each player sees their own house and allotment state at the same coordinates). The data is already per-character. |
| A6 | Interface "open" state on the player | `bankAt`, `shopAt`, `exchangeAt`, `stationAt`, `tannerAt` | Stays per player (fine), but must be server-side and closed on disconnect. |
| A7 | One RNG stream for everything | `this.rng` | Fine on a server (one stream per zone), but tests that pin RNG values will need per-test seeding helpers (the gloom slime change already showed RNG-order sensitivity). |
| A8 | Saving is the client's job | `main.ts` writes `localStorage` | The server persists; the client stores only settings and a session token. |
| A9 | Practice market inside the character save | `exchangePractice` | Stays a local, offline tutorial on the client (it never touches real wealth), or moves to a per-character server record. Recommendation: keep it client-side. |
| A10 | Renderer and HUD read live simulation objects | `render/*`, `ui/*` | Keep this, by giving the client a **replica world** with the same shape, updated from the server. This avoids rewriting 10,000 lines of UI and rendering. |
| A11 | Movement is computed where it is displayed | `updatePlayer` (joystick and path) | Server-authoritative movement, with client-side prediction for the local player and interpolation for everyone else. |

### 2.4 Authority map: what moves to the server, what stays on the client

**Server-authoritative (the client may display but never decide):**
- Position and movement validation (speed, collision, passages, obstacles), combat (hit rolls, damage, death, respawn), enemy AI and respawns.
- Inventory, equipment, ammo, toolbelt, "held for you" items, bank (tabs, placeholders), coins.
- Skills and xp, quests, grants, unlocks, Devotion and vows, run state of actions (gathering, crafting, building, farming, thieving, agility).
- Resource nodes (depletion and respawn), ground items and loot ownership, shrine wisps and shrine-held items, fires.
- Shops, the tanner and sawmill, the Glimmer Hollow lantern burn, farming growth (real-time clock on the server).
- All Exchange operations (live market), player trading, chat delivery and moderation.
- Randomness (all rolls happen on the server).

**Client-side (safe to keep local):**
- Rendering, animation, particles, camera, minimap drawing, HUD layout, audio, settings.
- Input handling (joystick, taps, gestures) turned into commands.
- World map geometry (generated from the shared seed; the server checks the client's map version on connect).
- Prediction of the local player's movement and interpolation of others (cosmetic; corrected by the server).
- UI convenience checks (`craftBlocker`, `buildBlocker`, …) run on the replica to grey out buttons. The server repeats every check.
- The practice market (an offline tutorial with simulated traders and practice stock).

---

## 3. Target architecture

```
 Browser (Vite build)                         Node.js server (one process at first)
 ┌───────────────────────────┐   WebSocket   ┌──────────────────────────────────────────────┐
 │ Controls → Command        │ ────────────▶ │ Gateway: auth, sessions, rate limits,         │
 │ NetClient (prediction,    │               │          protocol validation                   │
 │   snapshots, events)      │ ◀──────────── │ Zone "brightwater": ZoneWorld (src/sim),      │
 │ Replica world (src/sim    │   snapshots,  │   30 Hz tick, interest management             │
 │   types, server-fed)      │   events      │ Zone "hollow" (later), personal instances     │
 │ Renderer, HUD, audio      │               │ Exchange service (src/exchange, single writer) │
 │ Local practice market     │               │ Persistence: repository → SQLite              │
 └───────────────────────────┘               └──────────────────────────────────────────────┘
```

### 3.1 Code layout

- `src/sim`, `src/data`, `src/exchange`: shared by client and server, with no DOM or Three.js imports (already true; enforce with a lint rule or a test that imports them in Node without jsdom).
- `src/net`: protocol types, message validation, snapshot encoding (shared).
- `server/`: Node entry point, gateway, zone runner, persistence, admin tools, bot clients for tests. Built with `tsc` or `esbuild`, run with `tsx` in development.
- The client keeps a **local mode** (today's single-player game, no server) behind the default URL. **Network mode** is opt-in (`?server=ws://localhost:8787`) until the owner decides otherwise. This keeps the preview working throughout Phase 3A.

### 3.2 The simulation on the server: `ZoneWorld`

`GameWorld` evolves into `ZoneWorld`: one instance per zone (a region map or an instance). Each zone has:
- `players: Map<PlayerId, Player>`, `enemies`, `nodes`, `npcs`, `stations`, `groundItems`, `wisps`, `fires`, `doorways`.
- `issue(playerId, cmd)`, queued and applied at the start of the next tick, in arrival order.
- `tick()` at 30 Hz, the same as now. The simulation code inside is today's code, with `this.player` replaced by the acting player.
- `drainEvents()` returns `{ audience, event }` pairs.
- `join(record)` and `leave(playerId)` to load and unload characters.

The single-player client keeps working by running a `ZoneWorld` locally with one player (local mode). One codebase, two modes.

### 3.3 State synchronisation

- **Own character (private state):** full inventory, bank (when open), equipment, skills, quests and so on go only to their owner. Sent as a full record on join, then as small *patches* when something changes (the simulation already emits `equipment`, `bank`, `toolbelt`, `xp`, … events; each maps to one patch).
- **Shared state (public):** positions, animation state, hp bars, appearance and equipment *visuals* for players and enemies within an interest radius (about 30 tiles, the minimap range). Sent as snapshots at 10 Hz with delta compression against the last acknowledged snapshot; nodes, ground items (owner-filtered) and fires as add, change and remove messages.
- **Events:** combat, loot, messages and dialogue are routed by audience.
- **Movement:** the client sends joystick and `moveTo` intents (as now) with a sequence number. It predicts its own movement with the same `moveEntity` and pathfinding code. The server acknowledges the last processed sequence in each snapshot, and the client reconciles (replays unacknowledged inputs from the server position). Other entities are interpolated about 100 ms behind.
- **Encoding:** JSON first (readable, easy to debug and test). Switch hot messages (snapshots) to a compact binary form only if measurements show the need.

### 3.4 Accounts, sessions and reconnection

- **Accounts:** username and password (owner decision). Passwords hashed with `crypto.scrypt` (built into Node: no native dependency), with a per-user salt and parameters stored with the hash. Login attempts rate-limited per account and per address. No email, recovery or social logins in 3A.
- **Sessions:** after login the server issues a random 256-bit token. Only its hash is stored. The client keeps the token in `localStorage` and presents it in the first WebSocket message. Tokens expire and are revoked on logout or password change.
- **One live session per character:** a character can be loaded in exactly one zone at a time. A second login takes over: the old connection is closed only after the character has been saved and released (see the character lease, 5.2).
- **Reconnection:** if the socket drops, the character stays in the world for a short grace period (about 30 s; longer while not in combat, shorter rules to be tuned). Reconnecting within the grace period resumes the same session and receives a fresh full snapshot. After the grace period the character is saved and logged out. A logout timer while in combat prevents escaping a fight by disconnecting.
- **Transport security:** `ws://` on localhost for development; `wss://` (TLS) is mandatory for anything beyond a developer's own machine.

### 3.5 Persistence

- **Repository interface** (`CharacterRepo`, `AccountRepo`, `ExchangeRepo`, `AuditRepo`). There is one SQLite implementation for development, tests and a small single-server deployment. A PostgreSQL implementation can be added later without touching game code.
- **SQLite** via `better-sqlite3`: synchronous, transactional and fast, a natural fit for a single-writer game server. The database is one file in development (`server/data/dev.sqlite`, git-ignored) and in-memory for tests. (Node 22's built-in `node:sqlite` is an alternative that avoids a native build; both fit behind the same interface.)
- **Tables (first cut):** `accounts`, `sessions`, `characters` (id, account, name, `record` JSON, `version`, `zone`, `lease_owner`, `lease_epoch`, `updated_at`), `zone_state` (zone id, JSON, version), `item_ledger` (append-only: who, what, quantity, source and sink, reason), `exchange_*` (orders, balances, trades, audit, mirroring the engine's data model), `imports` (local-save imports).
- **When to save:**
  - Immediately and transactionally for anything that moves value between owners: trades, Exchange deposits and withdrawals, shop purchases above a threshold, dropping and picking up between players.
  - Every 30 to 60 s for routine progress (xp, positions).
  - Always on logout, on zone transfer and on shutdown.
- **Versioned writes:** every character write includes the `version` it was based on (optimistic concurrency) and the zone's `lease_epoch`. A stale writer (a crashed or duplicated process) is rejected.

---

## 4. Regions, instancing and racial starting regions

### 4.1 Zones

A **zone** is one simulated space with its own `ZoneWorld`: a region map (the Brightwater island today), a dungeon (Glimmer Hollow), or a personal or party instance. Zones are joined by **passages**. The `Doorway` and passage mechanism built for Glimmer Hollow already does this within one map. In the zone model, a passage whose other end is in another zone becomes a **zone transfer**.

- **3A.8 (single process):** several zones run in one server process. Transfers are in-memory hand-offs plus a save.
- **Later (regional servers):** zones are spread across processes or machines. A small **directory** (in the database) records which process hosts which zone. A transfer saves the character, moves its lease to the destination zone, gives the client a short-lived transfer ticket, and the client reconnects to the destination. The Exchange, accounts and chat are world-wide services reached by every zone.

### 4.2 Cooperating regional servers (later, design only)

- **Partitioning:** by region (each region map has one authoritative zone process). No seamless cross-border simulation at first: borders are passages, roads into the next region, or ferries. This keeps each zone a single writer and avoids distributed simulation.
- **Load:** if one region becomes crowded, run **parallel copies** ("layers") of that region and place players by party, friends, then load, rather than splitting the map further.
- **Shared services:** accounts and sessions, the character directory and lease table, the Exchange (one writer per world), chat and social. These start as modules in the one process and can be split out behind the same interfaces.
- **Database:** SQLite is enough for one process. When several processes need the same character table, move to PostgreSQL (free, self-hostable) using the same repositories, with leases enforced by `UPDATE … WHERE lease_epoch = ?`.

### 4.3 Racial starting regions (content plan)

- Each playable people (to be designed under `docs/ORIGINALITY.md`: original names, lore and looks, nothing from RuneScape) gets its own **starting region zone** with its own tutorial path, shrine and respawn, and its own map seed or hand-made layout.
- Character creation gains a "people" choice that sets the starting zone. Brightwater remains one of the regions (the current island).
- All regions share the item, skill and quest data and the world-wide Exchange. Regional content (resources, quests, creatures) follows the same originality rules and the gather → process → craft → equipment → quests → Exchange chain.
- Technically a starting region is just another zone, so it needs no new networking beyond 4.1.

### 4.4 Selective instancing

| Space | Kind | Why |
|---|---|---|
| Player house | Personal instance (already per-character data) | Only the owner builds there; visitors later by invitation |
| Allotments | Personal state on shared ground | Everyone sees their own patches at the same plot (as now) |
| Glimmer Hollow | Shared zone first; an instance per party if it gets crowded | Shared mining is social; darkness is per player (own lantern) |
| Boss fights (e.g. the warlord) | Shared now; instance later if contested | Avoid kill-stealing once more players exist |
| Tutorial / starting areas | Shared, with layers if crowded | New players should see each other |

Instances are short-lived zones created on demand and destroyed when empty, with state saved per character (house, patches) rather than per instance.

---

## 5. Security and integrity

### 5.1 Invalid and hostile commands

- **Schema validation at the gateway:** every message is parsed with a strict validator for the closed `Command` union (types, ranges, integer slots, finite numbers, string lengths). Unknown fields are rejected. Malformed input closes the connection after a few strikes.
- **Semantic validation in the simulation (already there):** reach, level, tools, space, coins, cooldowns. The server repeats every check the UI does.
- **Movement checks:** the server moves the character itself from intents (joystick direction, path target), so teleporting is impossible by construction. The client never sends positions.
- **Rate limits:** per connection and per command kind (for example chat, exchange and trade), with a token bucket. Excess input is dropped and logged.
- **No client authority:** the client never sends quantities it "has", prices it "got", item ids it "owns", damage, xp or positions.

### 5.2 Duplication exploits

1. **Single writer per character:** a character is live in exactly one zone, enforced by a **lease** row (`lease_owner`, `lease_epoch`). Every save includes the epoch; a write from an old epoch fails. This stops double-login dupes, crash and restart dupes, and transfer races.
2. **Single writer per zone:** all item movement for characters in a zone happens inside that zone's tick, one command at a time. No parallel mutation of the same inventory.
3. **Transactional value moves:** trades, Exchange bank-bridge operations and inter-player drops commit to the database *before* the client is told they succeeded. A crash can lose a few seconds of xp, never create items.
4. **Idempotency:** commands carry a per-session sequence number; the Exchange already uses per-account nonces and replays the stored result for a repeated nonce. Repeated or replayed packets cannot apply twice.
5. **Two-phase player trade:** offer, both accept, final screen, both confirm. Then one atomic swap under the zone's single writer, re-checking ownership and space at commit, persisted in one transaction.
6. **Item ledger:** every creation (drops, crafting outputs, shop purchases, grants) and destruction (consumption, shop sales, alching-like sinks) writes an append-only ledger row. Nightly or on-demand checks compare totals against ledger flows, like the Exchange's `verify()`.
7. **Conservation tests:** the `owned()` style invariant from `tests/p0-rules.test.ts` becomes a fuzz test that runs random command sequences for several players, including disconnects, and asserts item totals change only through ledger-recorded sources and sinks.

### 5.3 Transaction races

- Within a zone, commands are serialised by the tick: there are no concurrent writers.
- Across zones and services (Exchange, transfers), use the **outbox pattern**: the zone records "deposit 100 logs to exchange, request id X" in the same transaction that removes the logs from the bank; the Exchange processes X exactly once (idempotent on X) and writes its result; the zone applies the result. While both live in one process and one SQLite file (3A.7), this is simply one database transaction.
- A character in a transfer is "in flight": it accepts no commands until the destination confirms the lease.

### 5.4 Other measures

- Server-side chat filtering and reporting (basic), block and mute lists, moderation tools (kick, mute, ban) behind an admin role.
- Logging and metrics (connections, commands per second, errors, tick time) to the console and a local file in development.
- Protocol version check on connect (client and server must agree), plus a map version hash.

---

## 6. Dependencies between networking and the Grand Exchange

| Exchange step (`docs/EXCHANGE.md` §6) | Needs from multiplayer |
|---|---|
| Accounts and sessions | 3A.3 (accounts): `account` comes from the session, never the client |
| Server-owned inventories and banks | 3A.2 to 3A.3 (authoritative characters, persistence) |
| Exchange service with a transactional database | 3A.3 persistence plus `ExchangeRepo` (orders, balances, trades, audit chain) |
| Bank bridge (deposit on place, withdraw on collect) | Character record and Exchange in one database transaction (3A.7) |
| Trading with real players | 3A.5 shared world is **not** required: the Exchange can be global from 3A.7 even while players are in different zones |
| Safeguards (price bands, rate limits, monitoring) | 5.1 rate limits, 5.2 ledger, admin tools |
| Activation | Separate owner approval; a server-side flag (`liveExchange=false` by default) |

The engine itself needs no redesign. Work needed:
- Persist its state through `ExchangeRepo` instead of the character save.
- Run one instance per world (not per zone).
- Call it through the bank bridge.
- Keep the client's practice market as the offline tutorial.

Exchange collection boxes must survive reconnects and zone transfers, which they do once they live in the database.

---

## 7. Migrating browser-local saves

1. **Keep local mode.** Players can keep playing offline exactly as today. Nothing is deleted.
2. **Import once.** After creating an account, the client offers "Bring your Brightwater character". It uploads the local `SaveData` JSON once.
3. **Server-side validation:** the upload goes through the same restore path as today (`remapItemIds`, item-id checks, clamps, grants, overflow), plus import limits:
   - Each skill's xp at or below the maximum.
   - Coins and stack sizes at or below the caps.
   - Totals per item below sanity thresholds.
   - Quest states consistent with skills and items.

   Anything over a limit is clamped, logged and reported to the player.
4. **Mark and audit:** each import is recorded (`imports` table: account, character, hash of the uploaded save, time, what was clamped). The same save hash cannot be imported twice. The client marks the local save as imported (it stays readable as an offline backup).
5. **What carries over:**
   - Skills, quests and grants.
   - Inventory, equipment, toolbelt and bank.
   - House, allotments, held items, appearance and name (if free; otherwise the player picks another).
   - Not carried over: practice market balances (practice stock never becomes real), ground items and wisps (world state), or the position if it is invalid.
6. **Trust (owner decision):** local saves can be edited by their owner, so imports are trustworthy only during a closed test. Options:
   - **(a)** Import everything with caps during alpha, then reset or keep at public launch.
   - **(b)** Import progression only (skills, quests, house) and start wealth fresh.
   - **(c)** Fresh start for everyone.

   Recommendation: (a) for the closed test, with a decision on (b) or (c) before any public launch.

---

## 8. Local development and automated testing

- **Local server:**
  - `npm run server` starts the Node server on `localhost:8787` with a development SQLite file.
  - `npm run dev` serves the client.
  - Opening `http://localhost:5173/?server=ws://localhost:8787` plays in network mode.
  - No accounts are needed in a development "guest" mode, which is off unless a flag is set.
- **Tests (Vitest, no browser needed):**
  - Unit: the command validator (including fuzzed junk input), snapshot encoding and decoding, repositories (in-memory SQLite), password hashing and sessions.
  - Integration: start the server in-process on a random port; real WebSocket clients log in, play scripted actions and assert results; restart the server mid-test to check persistence.
  - **Bot clients:** headless clients that use the same `NetClient` code (no renderer) to walk, fight, gather, trade and disconnect at random. Run 2, 10 and 50 bots against one zone and check tick time, bandwidth per client and conservation invariants.
  - Chaos cases: double login, disconnect during a trade or an Exchange deposit, replayed and out-of-order packets, server kill during a save, zone transfer under load.
- **Determinism helpers:** inject the clock and RNG per zone in tests (the clock is already injectable). Prefer asserting outcomes and invariants over pinned random sequences.
- **Existing checks stay mandatory:** `npx tsc --noEmit -p .`, `npx vitest run`, `npx vite build`, plus a server build and type-check once `server/` exists.

---

## 9. Implementation roadmap (Phase 3A)

Each milestone is small, keeps the local single-player game working, and has acceptance criteria that tests can check. Milestones 3A.1 to 3A.4 run entirely on a developer machine.

### 3A.1 Simulation readiness (no server) ← recommended first

Goal: make the simulation multi-player-capable internally without changing how the game plays.
- Replace `readonly id = 1` with assigned `PlayerId`s. Thread an acting player through command handling and updates (start with `issue(cmd)` → `issueFor(playerId, cmd)`; `world.player` remains "the local player").
- Add `validateCommand(unknown): Command | null` in `src/net/validate.ts`: a strict, exhaustive validator for every command kind.
- Split `SaveData` into `CharacterRecord` and `ZoneState`. `world.save()` and the local save format stay backward compatible (a version 1 save loads and saves identically).
- Give events an audience field (default "self") without changing the client.
- Add a test that imports `src/sim`, `src/data` and `src/exchange` in plain Node (no jsdom) to keep them server-safe.

Acceptance:
- All existing tests pass unchanged. The game plays identically in the preview.
- The validator accepts every command the client produces (generated from the union) and rejects malformed input in a fuzz test (wrong types, NaN or Infinity, out-of-range slots, extra fields, oversized strings).
- A version 1 save loads, saves and reloads to the same `CharacterRecord` and `ZoneState`. Round-trip tests run against fixture saves from earlier batches.
- The player id is no longer a constant (a world can be built with player id 7 and all tests pass).

### 3A.2 Local server skeleton and authoritative solo play

Goal: a Node server that runs one world per connected player (today's single-player simulation, but on the server), and a client network mode.
- `server/` entry point with `ws`. Protocol envelope (version, sequence, type) and the 3A.1 validator at the gateway.
- `NetClient` in the browser: sends commands, receives events and own-character patches, feeds a replica world. The renderer and HUD use the replica unchanged.
- Local movement prediction and reconciliation for the own character.
- `?server=` switch. Local mode remains the default.

Acceptance:
- Integration test: a WebSocket client logs in as a development guest, walks, chops, banks and crafts, and receives the expected events.
- A tampered client (sending invented commands or raw state) cannot change inventory, xp or position except through valid commands.
- Prediction keeps the own character smooth at 150 ms simulated latency (manual check plus a reconciliation unit test).
- Local mode builds and plays exactly as before.

### 3A.3 Accounts and persistence

Goal: real characters on the server.
- SQLite repositories. Register and login (scrypt), session tokens, logout.
- Character load and save with versioned writes, the character lease, and save scheduling (5.2, 3.5).
- Reconnect grace period; single live session per character.

Acceptance:
- Restarting the server keeps characters exactly (an integration test kills and restarts the server mid-session).
- A second login takes over safely, with no duplicated items. Stale-epoch writes are rejected (test).
- Passwords are never stored or logged in plain text; login rate limits work (tests).

### 3A.4 Browser save import

Goal: bring existing characters to the server (section 7).

Acceptance:
- Fixture saves from every earlier batch import correctly (aliases, grants, renamed items).
- Over-limit saves are clamped and reported.
- The same save cannot be imported twice; the local save stays intact.

### 3A.5 Shared world

Goal: several players in one Brightwater zone.
- `ZoneWorld` with many players; events routed by audience; enemies target any player; loot ownership per player; personal allotments and house state.
- Snapshots with interest management and interpolation; other players rendered with the existing hero models and their equipment visuals.

Acceptance:
- Two browsers see each other move, fight the same enemy and share a resource node (depletion is visible to both).
- Bot test: 50 bots in one zone keep the tick under 10 ms on a laptop, with bandwidth under about 10 KB/s per client.
- The fuzz conservation test with several players and disconnects passes.

### 3A.6 Social basics and player trading

Goal: chat (local and private, filtered, rate-limited) and two-phase player trading.

Acceptance:
- A trade either completes fully or not at all, under disconnects at every step (chaos tests).
- No items are created or lost; ledger rows are written for every trade.

### 3A.7 Live Exchange (behind a flag)

Goal: the Exchange as a world service with the bank bridge (section 6). Live mode stays off by default; the practice market remains.

Acceptance:
- Deposit-and-place and collect-and-withdraw are atomic with the character record (crash tests).
- `verify()` and the audit chain hold after randomized multi-account sessions.
- The interface shows "Live" only when connected to a live server with the flag on.

### 3A.8 Zones and instancing (single process)

Goal: several zones in one process. Glimmer Hollow as its own zone; personal instances (house).
- Passages between zones become in-process transfers.

Acceptance:
- Transferring between zones under load never duplicates or loses a character (tests).
- Instances are created on demand and cleaned up when empty.

### Later (design only in 3A): regional servers, racial starting regions, layering

- Multiple processes with a zone directory, transfer tickets and PostgreSQL (4.2).
- Starting regions per people once their content is designed under the originality rules (4.3).
- These start only after 3A.8 and an owner decision on hosting.

### Approval gates

- **Before 3A.2:** adding runtime dependencies (`ws`, `better-sqlite3`, `tsx`). All are free and open source, but they need owner approval.
- **Before anything reachable from the internet:** hosting choice, TLS, backups, and a privacy note for accounts.
- **Before live trading:** the owner turns on `liveExchange` after a dry run with test accounts.

---

## 10. Risks and how the plan handles them

| Risk | Mitigation |
|---|---|
| A large refactor of `world.ts` breaks gameplay | 3A.1 is behaviour-preserving with the full existing test suite as the safety net; local mode stays the default throughout |
| UI and renderer rewrite | Avoided: the client keeps a replica world with the same shape |
| Duplication bugs | Single-writer zones, leases with epochs, transactional value moves, ledger, conservation fuzzing |
| Mobile bandwidth and battery | Interest radius, 10 Hz deltas, JSON first with measurement before optimising |
| Cost | Everything runs locally with free software; no hosting until the owner approves |
| Premature scaling | One process, SQLite, zones as an in-process abstraction first; regional servers only when needed |
