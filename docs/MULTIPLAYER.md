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

### 3A.1 Simulation readiness (no server): done

Delivered:
- **Player ids:** `PlayerId`, `LOCAL_PLAYER_ID` and `isValidPlayerId` in `src/sim/world.ts`. Players use 1–99 locally or 1,000,000 and up on a server, so they never clash with entity ids. `new GameWorld({ playerId })` builds a world for any id, and `issueFor(playerId, cmd)` accepts commands only for a player in the world. Saves record `playerId`, and loading under a new id keeps that player's ground piles and wisps theirs.
- **Command validation:** `validateCommand` in `src/net/validate.ts`. It is exhaustive over all 47 command kinds: exact fields, ranges, known ids, no extra fields, and no prototype tricks. It never throws.
- **Save split:** `splitSave` and `mergeSave` in `src/sim/records.ts` turn the save into `CharacterRecord`, `ZoneState` and `LocalState` (the practice market) and back exactly. `world.characterRecord()` and `world.zoneState()` give the parts directly. The browser save format is unchanged.
- **Event audiences:** `EVENT_AUDIENCE` and `routeEvents` in `src/net/audience.ts` classify all 47 event kinds as self, nearby or zone. The client is unchanged.
- **Tests:** `tests/net-readiness.test.ts`, with fixture saves in `tests/fixtures/saves/`, covers the checks below. The whole suite also passed once with the local player id temporarily set to 7.

Planned scope (kept for reference):

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

### 3A.2 Local server skeleton and authoritative solo play: done

How to run it:
- `npm run server` starts the development server on `ws://127.0.0.1:8787`.
- `npm run dev` serves the client.
- Open `http://localhost:5173/?server=ws://127.0.0.1:8787` to play in network mode.

Without `?server=` the game is the usual local single-player game. In network mode the local save is never overwritten.

Delivered:
- **Server** (`server/server.ts`, entry `server/main.ts`). It uses `ws`, listens on localhost only, and runs the fixed 30 Hz loop. Each guest gets their own server-side `GameWorld` with a server player id (1,000,000 and up), sharing one generated map.
  - Every message goes through `parseClientMessage`, which uses the 3A.1 command validator.
  - It enforces a message size cap, a rate limit (90 messages a second) and strikes (20 invalid messages disconnect).
  - A 5-second hello timeout; one live connection per character (a new sign-in replaces the old one).
  - The content-version handshake turns away a client built from a different map or item table.
  - Guests are kept in memory until the server stops. Disconnected worlds are paused.
- **Protocol** (`src/net/protocol.ts`):
  - From the client: `hello`, `cmd`, `input` (numbered one-tick joystick inputs) and `ping`.
  - From the server: `welcome`, `state` (snapshot, events, and the character record only when it changed), `error` and `pong`.
  - JSON, version 1.
- **Replication** (`src/net/replica.ts`):
  - `captureState` / `applyState` carry the player's runtime fields, plus creatures and NPCs within 32 tiles, depleted nodes, ground piles, wisps and fires.
  - `applyCharacter` restores the character record through the normal save path onto the replica.
- **Client** (`src/net/client.ts`, wired in `src/main.ts`):
  - The renderer and HUD read a replica world unchanged.
  - Joystick movement is predicted with the simulation's own movement code (`GameWorld.predictMove`), sent as numbered inputs and reconciled against the server's acknowledged position.
  - Path movement follows the server smoothly. Other creatures and NPCs are interpolated 150 ms in the past.
  - The practice market runs on the device; the server ignores those commands.
- **Measured:** a snapshot is about 3.8 KB in the village, about 38 KB/s at 10 snapshots a second. Change-only updates (deltas) arrived in 3A.5 (about 8 KB/s with 50 players in sight).
- **Tests:** `tests/net-server.test.ts` (9 tests). It starts a real server and connects real WebSocket clients:
  - Protocol parsing and the content version.
  - Welcome, and a matching replica.
  - Chop, fletch and bank through commands.
  - A tampering client: injected state, invented fields, other accounts, practice-market commands, and junk until disconnected.
  - A version mismatch, and a replaced connection.
  - The device-local practice market.
  - Prediction at 150 ms round trips: movement starts before any server reply, ends within 0.05 tiles of the server, and corrections stay under 0.35 tiles.

Packages added (owner approved): `ws` 8.22.0 (8.18 had published advisories), `tsx` 4.23.15, and the dev-only types `@types/ws` and `@types/node`. `npm audit` shows no advisories for these. The remaining warnings are in the existing Vite and Vitest development tooling.

Planned scope (kept for reference):

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

### 3A.3 Accounts and persistence: done

How to run it:
- `npm run server` keeps accounts and characters in `server/data/dev.sqlite`. The `server/data/` folder is git-ignored; delete it to start over.
- `GUESTS=1 npm run server` also allows unsaved guest play by name, for development.
- In the browser (`?server=…`), a sign-in screen asks for a name and password, or creates an account (then the character creator for looks). The session token is kept in `localStorage`, never the password.
- **Sign out** replaces "New character" in Settings in network mode.

Delivered:
- **Database** (`server/db.ts`): SQLite via `better-sqlite3` 13.0.3, with WAL and numbered migrations (`user_version`).
  - Tables: `accounts`, `sessions`, `characters` (with `record`, `zone`, `version`, `lease_owner`, `lease_epoch`) and `audit`.
  - Each character's zone state (dropped loot and wisps) is stored with it while every character has its own world. Since 3A.5 that is the loot and wisps the character owns; unowned piles live in their zone while the server runs.
- **Accounts** (`server/auth.ts`, `server/repo.ts`):
  - Passwords are hashed with Node's built-in scrypt (N=16384, r=8, p=1, 16-byte salt), compared in constant time.
  - Session tokens are 256-bit, stored as SHA-256 hashes, expire after 30 days unused, and are revoked on sign-out.
  - One account owns one character with the same name; names are unique ignoring case.
  - Sign-in limits:
    - 5 wrong passwords per name per 5 minutes;
    - 30 failures per address;
    - 5 new accounts per address per hour.

    A sign-in for an unknown name still runs a hash, so the timing doesn't reveal which names exist.
  - Sign-ins, failures, lockouts, sign-outs and refused saves are written to `audit`.
- **Saving:**
  - When: every 30 s for characters that changed, after the reconnect grace period, on sign-out and on shutdown.
  - Every save is `UPDATE … WHERE lease_epoch = ? AND version = ?`. Loading a character raises its lease epoch, so an older server or a taken-over copy can never write. A refused save drops that copy and tells its player (`stale`).
- **Sessions:**
  - **One live connection per character:** signing in again takes over the same in-memory world, so nothing is reloaded or duplicated.
  - **Dropped connections:** the character stays in the world for a 30 s grace period. The client reconnects by itself with its token and continues. After the grace period the character is saved and unloaded, and the lease released.
- **Protocol version 2:** `hello` carries `auth` (`guest`, `register`, `login` or `token`). There is a `logout` message, `welcome` may carry a new session token, and errors carry codes (`auth`, `taken`, `locked`, `version`, `replaced`, `session`, `stale`).
- **Tests:** `tests/net-accounts.test.ts` (14 tests):
  - Hashing, the rate limiter, and repositories (unique names, hashed and expiring sessions, lease and version checks).
  - Restarting the server keeps the character exactly, by token and by password.
  - A crash loses only unsaved progress and never duplicates items.
  - Two servers on one database: the stale one is refused and its player told.
  - Take-over, the grace period and reconnect, and sign-out revoking the token.
  - Wrong passwords and lockout, guests refused by default, and no password in the database file or server log.

Planned scope (kept for reference):

Goal: real characters on the server.
- SQLite repositories. Register and login (scrypt), session tokens, logout.
- Character load and save with versioned writes, the character lease, and save scheduling (5.2, 3.5).
- Reconnect grace period; single live session per character.

Acceptance:
- Restarting the server keeps characters exactly (an integration test kills and restarts the server mid-session).
- A second login takes over safely, with no duplicated items. Stale-epoch writes are rejected (test).
- Passwords are never stored or logged in plain text; login rate limits work (tests).

### 3A.4 Browser save import: done

How it works:
- In network mode, after signing in to an account, a device that has an offline character is offered "Bring it over". The offer is shown once per server; "Don't ask again" and a finished import are remembered in `localStorage` (`brightwater.import.v1`).
- The client uploads the save without the practice market, ground piles or wisps. The server rebuilds the character through the game's own restore path on a fresh world: aliases, item checks, one-time grants (toolbelt, ammo slot) and overflow. Then it applies the limits.
- The imported character replaces the account's current character. It takes the account's name (the same rule as for new accounts) and is saved straight away, together with the `imports` record, in one transaction that needs the current lease and version.
- The player sees a report of everything changed on the way in.

Delivered:
- `server/import.ts`: `prepareImport` and `saveHash`.
  - Limits:
    - xp at level 99 at most per skill;
    - 5,000,000 coins and 25,000 of any other item, counted across bag, bank, gear, ammo, toolbelt, held items and shrine-held items; excess is taken from the bank first;
    - saves up to 256 KB.
  - Reported: caps, unknown items left behind, an invalid position (back to the shrine), unreadable looks (the account's looks kept) and the rename.
  - **Trust policy** (owner decision, `importPolicy` server option):
    - `full` (default, for a closed test);
    - `progress` (skills, quests, grants, house and allotments; items and coins start fresh);
    - `off`.
- **Database migration 2:** an `imports` table, unique by account (once per account) and by save hash (the same save once anywhere). It stores the report, and an `import` audit entry is written.
- **Protocol:** an `import` message, accepted only from a signed-in account (up to 300 KB; larger or earlier messages are refused unread); an `imported` reply with the report, followed by a fresh `welcome`; and an `import` error code.
- **Client:** `NetClient.importSave(save)`, which never modifies the local save; the offer screen in `src/ui/importoffer.ts`; and the report shown in the message log.
- **Fixtures:** now four save generations in `tests/fixtures/saves/`: P0-era, pre-toolbelt, mid-game (before the ammo slot, with a house and allotments) and current.
- **Tests:** `tests/net-import.test.ts` (9 tests):
  - Every fixture comes across with the same skills and every item, including the toolbelt and ammo migrations.
  - Caps and the report.
  - The practice market, ground piles and wisps stay behind.
  - The `progress` and `off` policies, and non-saves refused.
  - Over the network: the import survives a restart and is recorded; once per account and once per save; off on request; guests and signed-out connections refused; the local save is unchanged.

Still an owner decision before any public launch: which policy to use (section 7). A player could alter a save to get past the once-per-save rule, so `full` only suits a closed test.

Planned scope (kept for reference):

Goal: bring existing characters to the server (section 7).

Acceptance:
- Fixture saves from every earlier batch import correctly (aliases, grants, renamed items).
- Over-limit saves are clamped and reported.
- The same save cannot be imported twice; the local save stays intact.

### 3A.5 Shared world: done

How it works:
- **One zone.** The server runs one `GameWorld` for Brightwater that every session joins.
  - `world.players` holds everyone. The game's rules still say "the player": `act(p, fn)` points that at whoever's turn it is (a command, their tick, a creature attacking them, their pending hit landing). So the roughly 120 rules that read the player stay as they were.
  - `addPlayer` and `removePlayer` bring a character in (from their record, with their own wisps and private loot) and take them out again. Creatures chasing someone who leaves go home.
- **What is shared and what is personal.**
  - Shared: resource nodes (one player mining a rock dry empties it for everyone), creatures, NPCs, fires and public ground piles.
  - Personal: allotments (`player.patches`: the same plot shows each player their own crops), the house, wisps (only the owner sees or takes them; they count down only while the owner is in the world), and loot (private to the killer until it turns public).
- **Creatures** pick the nearest player they can reach and fight whoever they target. Every hit remembers its attacker, so xp and the kill go to the right player, and one player dying doesn't cancel another's attacks.
- **Events go by audience** (`src/net/audience.ts`). Each event is tagged with the player whose turn produced it.
  - `self`: messages, bag, bank, xp, interfaces, and effects that don't say whose they are. These go only to that player.
  - `nearby`: hits, attacks, projectiles, deaths and gathering. These go to players within the interest radius of where they happen.
  - `zone`: nodes running out or coming back, and fires lit. These go to everyone.
- **Snapshots** (`captureState`) are per viewer:
  - the viewer's own fields;
  - other players within 32 tiles (name, looks, worn gear, pose, combat level and health);
  - creatures and NPCs within 32 tiles;
  - only the piles and wisps that viewer may see. Other players' private loot and wisps are never sent.
- **Change-only snapshots** (`src/net/delta.ts`, protocol v3).
  - The server remembers the last state it sent each connection and sends only what changed: changed fields, `[id, x, z]` triples for things that only moved, and ids that went away. The client rebuilds the whole state, so everything after that is unchanged.
  - Fields that count up every tick go as the time they started (`@swingAge`). Timers below zero go as zero. Headings are rounded to 0.1 rad. The character record is resent only when something other than position, health, prayer or lantern changes.
- **Movement budget** (`limitMoves`). At most 12 position updates go in each snapshot. They are picked by how far the client's copy has drifted, weighted towards things close to the viewer, and whatever waits becomes more urgent. The client records a position only when it changes, and shows rarely-updated things further back (150 to 450 ms), so they still move smoothly.
- **Shared views.** Other players, creatures and NPCs look the same to every viewer, so each is captured once per tick and shared by all that tick's snapshots.
- **Rendering.** Other players are drawn with the hero model, their looks and worn equipment. Their pose (walking, attacking, gathering with the right tool, dead) comes from the snapshot, and their nameplate shows name, combat level and health.

Delivered:
- `src/sim/world.ts`: `players`, `act`, `addPlayer` and `removePlayer`; per-player allotments, wisps and loot; attackers on pending hits; `drainEventsWithActors`.
- `src/net/audience.ts`, `src/net/delta.ts`, `src/net/replica.ts` (others, per-viewer filtering, shared views) and `src/net/client.ts` (deltas, adaptive interpolation).
- `server/server.ts`:
  - one shared zone with per-session routing and deltas;
  - guests are also taken out after the grace period;
  - `stats` (tick time and bytes sent).
- `src/render/renderer.ts`: other players' models, poses, projectiles and nameplates.
- `?autostart=Name` picks a guest name, so two browsers can join side by side.
- Tests: `tests/multiplayer-sim.test.ts` (8) and `tests/net-multiplayer.test.ts` (6):
  - **Deltas:** a delta always rebuilds exactly the next state, through play, loot, deaths and players joining and leaving.
  - **Two clients:**
    - each sees the other move;
    - a rock mined dry by one is depleted for both;
    - both fight the same wolf and see the same hits and health;
    - the other player's pose comes across;
    - xp, loot and messages reach only their own player.
  - **Privacy:** private wisps reach only their owner.
  - **Load:** 50 bots wander, chop and fight in the village (all in sight of each other: the worst case).
  - **Fuzz conservation:** four accounts play random commands and keep dropping their connections. Every time a character comes back, it has exactly what was saved; a full restart loses nothing.

Measured (50 bots in one place, in the development container while the rest of the test suite runs alongside):
- Tick: about 5 ms on average, including simulation, routing and 50 snapshots every third tick. The worst single tick is about 30 to 40 ms (a snapshot tick during garbage collection).
- Bandwidth: about 7.8 KB/s per client on average, 8.2 KB/s at worst (before 3A.5's work: about 38 KB/s for one player).

Checked in two browsers: each sees the other, named and in their gear, and watches them walk.

Left for later:
- Dropped piles that nobody owns are not stored when the server stops (owned piles and wisps travel with their owner's record).
- A player can't yet visit another player's house (houses became personal instances in 3A.8; visiting comes later).
- Chat and trading arrived in 3A.6.

Planned scope (kept for reference):

Goal: several players in one Brightwater zone.
- `ZoneWorld` with many players; events routed by audience; enemies target any player; loot ownership per player; personal allotments and house state.
- Snapshots with interest management and interpolation; other players rendered with the existing hero models and their equipment visuals.

Acceptance:
- Two browsers see each other move, fight the same enemy and share a resource node (depletion is visible to both).
- Bot test: 50 bots in one zone keep the tick under 10 ms on a laptop, with bandwidth under about 10 KB/s per client.
- The fuzz conservation test with several players and disconnects passes.

### 3A.6 Social basics and player trading: done

How trading works (`src/sim/trade.ts`, a rule of the shared world):
1. A player taps another player and chooses Trade. The other sees "Ash wants to trade with you" and taps Trade (asking back opens it too). Players must be within 6 tiles; a request lapses after 30 seconds.
2. Both offer items from their bag. Offered items **stay in the bag** until the very end, so a crash or disconnect can never leave them stranded. While a trade is open the bag is locked (only the trade, walking and the combat style work). Any change to either offer clears both acceptances, and taking something back is announced to the other player.
3. Both accept: the offers are frozen and shown again on a **final screen** ("this is exactly what changes hands"), with a rough value for each side.
4. Both confirm: the world checks again that each still has what they offered and room for what they get, and swaps both bags in one step.
   - On the server, both characters and one ledger row per stack are saved in **one database transaction** before either player is told.
   - If that save fails (for example a stale lease), the swap is undone exactly and the trade is cancelled.
- Walking more than 12 tiles apart, dying, disconnecting or leaving cancels the trade, and nothing changes.
- Guests can't trade: a trade must be saved to both accounts.

How chat works (`server/chat.ts`, a server service, not a game rule):
- **Channels:**
  - local chat reaches players within 16 tiles and shows over the speaker's head;
  - private chat goes to one player by name ("@Name message", or tap a whisper to reply).
- **Cleaning:**
  - control characters are removed and whitespace collapsed;
  - messages are up to 120 characters;
  - links become "[link]" (a common scam);
  - a short word filter stars out listed words, including look-alike spellings (digits for letters, repeated letters).
- **Pacing:** 5 messages at once, then one every 2 seconds; the same line at most twice in 15 seconds.
- **Block:** stored per account (`blocks` table). A blocked player's local and private chat never arrives. To them, a blocked player looks the same as one who is offline.
- **Report:** goes to the `reports` table with the reason and the reported player's recent messages that the reporter actually received (the server keeps the last 40 per player). Accounts only, one every 10 seconds.
- **Mute:** `RunningServer.mute(name, minutes)` (stored as `accounts.muted_until`; guests until they leave). The admin role and moderation tools are still to come (5.4).

Delivered:
- `src/sim/trade.ts` (`TradeDesk`, `TradeView`, `TradeCommit`).
- Commands `tradeRequest`, `tradeOffer`, `tradeRemove`, `tradeAccept` and `tradeDecline`, with their validators.
- Events `tradeRequest` and `trade`, both `self`, addressed with the new `emitFor`.
- **Database migration 3:**
  - `item_ledger`: append-only, one row per stack moved, under the trade's reference;
  - `blocks` and `reports`;
  - `accounts.muted_until`.
- `Repos.commitTrade`, `ledger`, `setBlocked`, `report` and `mute`.
- **Protocol v4:** client messages `chat`, `block` and `report`; server messages `chat`, `social` (the block list) and `notice`.
- **Client:**
  - `NetClient.say`, `block`, `report` and `drainChat`;
  - the trade window (`src/ui/tradeview.ts`);
  - the chat box, player menu (Trade, Whisper, Block, Report) and trade request card (`src/ui/social.ts`);
  - chat bubbles over heads;
  - tapping another player opens the menu.
- **Tests:**
  - `tests/trade-sim.test.ts` (7):
    - the full flow;
    - acceptance clearing and the frozen final screen;
    - offer limits;
    - the bag lock;
    - cancelling on distance, death and leaving;
    - room checks;
    - items gone at the end;
    - a refused save undone exactly;
    - a fuzz of 6,000 random trade commands between four players, with 10% of saves refused, where nothing is created or destroyed.
  - `tests/net-social.test.ts` (20):
    - the chat filter;
    - local, private and blocked delivery (blocks remembered across sign-ins);
    - pacing, reports with context, and mutes;
    - a networked trade with both records and the ledger checked;
    - guests refused;
    - **chaos:** a disconnect by either player after each of the first 7 of 8 steps (14 cases), each leaving both saved bags exactly as before with no ledger rows;
    - a server crash the instant a trade completes (kept for both, with ledger rows) and just before the final confirm (lost whole).

Checked in two browsers: the player menu, the request card, offers on both sides, the final screen, "Trade complete." with both bags changed, and local chat over the speaker's head and in the log.

Left for later:
- The admin role, kick, ban and the moderation queue (5.4).
- A word list that moderators can edit.
- Friends lists.
- Local chat across zones (private messages already reach any zone).
- Trading coins from the bank (today only bag items can be offered).

Planned scope (kept for reference):

Goal: chat (local and private, filtered, rate-limited) and two-phase player trading.

Acceptance:
- A trade either completes fully or not at all, under disconnects at every step (chaos tests).
- No items are created or lost; ledger rows are written for every trade.

### 3A.7 Live Exchange (behind a flag): done

**Switched off by default.**
- The server opens the live Exchange only when started with `liveExchange: true` (`LIVE_EXCHANGE=1 npm run server`).
- Opening it to real players remains an owner decision (section 6, "Activation").
- The practice market on each device is unchanged and always available.

How it works (`server/liveexchange.ts`):
- **One engine for the whole world**, run by the server (not part of any zone, so it stays global when zones arrive in 3A.8). It is the same `Exchange` engine as the practice market, unchanged.
- **Accounts** are `acct:<id>`, taken from the signed-in session. Guests can't use it. Players must be at an Exchange clerk and not in a player trade.
- **Bank bridge:**
  - **Placing** an offer moves exactly what it needs (coins for a buy, items for a sell) from exchange storage, then the bank, then the bag, into the engine as a deposit, then places it.
  - **Collecting** moves the proceeds out: into the bag while there is room, then the bank. Whatever fits nowhere waits in exchange storage, and **Take out** (a `claim` request) moves it later.
- **One request, one transaction:**
  - Each request changes the engine and the character's bank and bag together. They are saved together in one SQLite transaction: the engine state, the character record (with its lease and version), and append-only copies of new audit entries and trades.
  - If validation fails part way, or the save fails, the engine and the character are put back exactly as they were (from a deep copy taken first).
  - A crash can therefore never leave a deposit without its offer, or a collection without its items.
- **Safe retries:**
  - Client requests carry their own numbers. An exact repeat returns the first result; an older number is refused.
  - The engine keeps separate numbers for the server's internal requests. Client numbers are saved with the engine.
- **Privacy:** players see their own offers, storage and trades, and the market's recent trades. Other players are never named ("another player").
- **Startup check:** a saved market that fails `verify()` is refused at startup. A market that doesn't add up is better closed than wrong.
- **Notifications:** players whose offers were filled are sent their new view and a note, if they are online.

Delivered:
- `server/liveexchange.ts` (`LiveExchange`, `liveAccount`).
- **Database migration 4:**
  - `exchange_state`: the engine and client numbers, saved whole with every request;
  - `exchange_audit`: the full hash chain, beyond the engine's in-memory window;
  - `exchange_trades`.
- `Repos.commitExchange`, `exchangeState`, `exchangeAudit` and `exchangeTrades`.
- **Protocol v5:**
  - client messages `gx` (place, cancel, collect, claim), `gxGuide` and `gxOpen`;
  - server messages `gxState`, `gxResult` and `gxGuide`;
  - `features` in the welcome.
- **Client:**
  - `NetClient.gx`, `gxOpen`, `gxGuide`, `features`, `liveView` and `guides`;
  - `src/ui/marketsource.ts` (`PracticeSource`, `LiveSource`), so the same Exchange interface runs either market;
  - a Live/Practice switch and a green "Live market" banner. Both are shown **only** when connected to a server that has the live Exchange on; otherwise the interface is the practice market as before;
  - live storage with "Take out";
  - price guides fetched from the server.
- **Tests:** `tests/net-exchange.test.ts` (7):
  - off by default;
  - a sale and a purchase between two accounts through the bank bridge, with the database, trades, audit chain and anonymity checked;
  - proceeds with no room waiting in storage, then taken out;
  - clerk, guest, retry and stale-request rules;
  - a refused save changing nothing in memory or on disk, then retried successfully;
  - a crash straight after placing and collecting, with character and market still in step after restart;
  - **randomized:** four accounts, 210 requests with lost replies and retries, and a crash or clean restart after each of 3 rounds. After every request `verify()` holds; after every restart the stored audit chain checks out end to end, and every asset across characters plus the Exchange adds up to exactly what there was at the start.

Checked in two browsers with the flag on:
- the Live/Practice switch;
- a sell offer taking bread from the bag;
- a buy offer matching it;
- collecting into the bag with the change in coins.

With the flag off, the Exchange shows only the practice market.

Left for later (before any real launch, section 6 and docs/EXCHANGE.md):
- price bands;
- per-account rate limits on Exchange requests;
- monitoring of audit flows;
- an admin view.

Saving the whole engine with each request suits a test server. Normalized order and balance tables come with PostgreSQL.

Planned scope (kept for reference):

Goal: the Exchange as a world service with the bank bridge (section 6). Live mode stays off by default; the practice market remains.

Acceptance:
- Deposit-and-place and collect-and-withdraw are atomic with the character record (crash tests).
- `verify()` and the audit chain hold after randomized multi-account sessions.
- The interface shows "Live" only when connected to a live server with the flag on.

### 3A.8 Zones and instancing (single process): done

How it works (`src/sim/zones.ts`, `server/server.ts`):
- **Several worlds in one process:**
  - `brightwater`: the island, shared and always running;
  - `hollow`: Glimmer Hollow, shared and always running;
  - `house:<player>`: a personal **instance**, opened when its owner walks in and closed as soon as it is empty.
- **Where a player stands decides their zone** (`zoneFor`). Inside the Hollow means the Hollow, inside the house walls means your own house, anywhere else means Brightwater.
  - Passages and the house door need nothing new: walking through one puts the player in another zone's area.
  - After every tick the server hands such players over.
- **A transfer** is one synchronous step, so a character is never in two zones and never in none:
  1. The character's record and their own wisps and loot are taken out of one world (`removePlayer`).
  2. They are added to the other through the save path (`addPlayer`), the same path the 3A.5 conservation tests cover.
  3. Runtime state that isn't saved but should carry over (active vows, heading, timers) is copied across.
  4. The character is saved, and their client gets a full state of the new zone (a `zone` message; deltas restart from it).
- **Each zone runs only its own creatures and people:**
  - the island has no Hollow slimes;
  - the Hollow has only its own;
  - a house has none.
  - Ids still follow the map, so they are the same everywhere.
  - On the client, creatures and villagers missing from the latest snapshot are now hidden (`offstage`) instead of standing frozen where they were last seen.
- **Signing in** puts a character in the zone where they were saved. A crash after a transfer keeps them there.
- **A wisp travels with its owner**, as their private loot already did in 3A.5: owned things always live in the owner's current zone.
- **Per zone:** event routing, snapshots and local chat (players in the same zone and near each other). A trade needs both players in the same zone.
- **World-wide:** the live Exchange, accounts, blocks and private messages.

Delivered:
- `src/sim/zones.ts`: `zoneFor`, `inHouse`, `zoneKind` and `zoneArea`.
- `GameWorld` option `area` (which creatures and people a zone runs) and `offstage`.
- **Server:**
  - `zones` (Brightwater, Hollow, open houses);
  - a session's `zoneId` and `world`;
  - `transfer`;
  - instances opened on demand and closed when empty;
  - per-zone ticking and routing;
  - `RunningServer.zones`.
- **Protocol v6:** a `zone` message (full state of the new zone) and `zone` in the welcome; `NetClient.zone`.
- **Tests:** `tests/net-zones.test.ts` (6):
  - which zone a position belongs to;
  - each zone running only its own creatures;
  - **the house as a personal instance:** opened on the way in and closed on the way out; Ash and Brindle each in their own house, unseen by each other or by anyone outside;
  - the Hollow passage handing the player over, with the transfer saved so a crash and sign-in keep them in the Hollow;
  - a wisp moving with its owner;
  - **under load:** 30 players (10 accounts, 20 guests) moved between the island, their houses, the doorstep and the Hollow at random for 40 rounds, with accounts dropping out and coming back. After every round, every character is in exactly one zone (the one their position says), no instance is left open empty, and every account owns exactly what it started with.
- **Load:** the 50-bot test still runs at about 5 ms a tick and 8 KB/s per client with the Hollow zone running alongside.

Checked in two browsers: Ash walked into the house and got a private instance (the server logged it opening). Ash vanished from Brindle's view outside, while Ash's own view showed the empty house ready to build in.

Left for later:
- **Visiting** another player's house (by invitation): the instance id already names its owner, so a visitor just joins it.
- **Party instances of the Hollow** if it gets crowded, and **layers** of a busy region (4.2).
- **Dropped piles nobody owns** stay in their zone while the server runs. They are not saved when it stops (as before).
- **Regional servers** (several processes, a zone directory, transfer tickets, PostgreSQL) remain design only (4.2). They need an owner decision on hosting.

Planned scope (kept for reference):

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

- **Before 3A.2:** adding runtime dependencies (`ws`, `better-sqlite3`, `tsx`). Approved by the owner; `ws` and `tsx` were added in 3A.2, `better-sqlite3` comes with 3A.3.
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

---

## 11. Phase 3B: hardening and controlled testing

Phase 3B makes the Phase 3A server dependable enough for a small, private test with real phones. It adds no new gameplay. Everything still runs on a machine the owner controls: nothing is hosted, published or public, and the live Exchange stays off by default.

### 3B.1 Audit and fixes: done

An independent read-only review of the server, protocol, trading, Exchange and zone code (October 2026) produced the findings below. Each was checked against the code before being fixed. Tests are in `tests/net-hardening.test.ts` unless noted.

| # | Finding | Severity | Fix |
|---|---|---|---|
| H1 | **Pathfinding flood.** A `moveTo` or `interact` aimed off the map or at an unreachable place made the pathfinder search everything reachable (about 8 ms each), and commands ran as they arrived (up to 90 a second per client). | High | Walkable areas are worked out once per map, so an unreachable goal is refused at once (under 0.2 ms). Game commands now have their own pace: 15 a second per session. |
| H2 | **Parallel password guessing.** Sign-in limits were checked before the slow password hash and counted only after it, so many connections at once could each guess before any failure counted. | High | Sign-ins are counted while they run: one at a time per account name, two per address. Anything more is refused at once. |
| M1 | **Repeat imports.** The once-per-save rule hashed the raw upload, so any extra field made a save look new. | Medium | The hash is of the character as it comes across, minus the account's name and id. **Still open:** the default `full` policy trusts what the save says (owner decision, section 7). |
| M2 | **Unbounded memory per client.** A client that stops reading made the server queue snapshots without limit, and the block list was unbounded and resent whole. | Medium | A connection with more than 2 MB waiting is closed. The block list is capped at 200, and blocked names must be valid player names. |
| M3 | **Live Exchange cost per request.** Every request copied and rewrote the whole engine. | Medium | Per-account limits (3B.3) apply before any work. Refused requests no longer rewrite the market. |
| M4 | **Zone thrashing.** Stepping back and forth over a zone threshold changed zone, built a house instance and saved on every tick. | Medium | A player changes zone at most once a second (configurable). |
| M5 | **Guests never left.** A guest who signed out stayed in the world for good. | Medium | They are removed on sign-out. |
| M6 | **Guest names.** Guests could take an account's name, or take over another guest's character. | Medium | Account names are refused for guests. A guest name can only be taken back from the address it joined from. (Guests remain a development feature, off unless `GUESTS=1`.) |
| M7 | **One error stopped the server.** Any thrown error (including SQLITE_BUSY while the admin tool held the database) crashed the process. | Medium | Message handling, each zone's tick, transfers, snapshots and periodic saves are all guarded: errors are logged and the server carries on. A save that fails for any reason other than a stale lease keeps the character in the world and retries every second, so nobody is ever unloaded unsaved. |
| L1 | **No Origin check.** Any web page could open connections on a visitor's behalf. | Low | `allowedOrigins` server option: pages not on the list are refused. Clients that send no Origin (tests, tools) are allowed. 3B.7 makes it required beyond this machine. |
| L2 | **Cheap unauthenticated connections.** | Low | Eight connections per address. Before sign-in, messages are limited to 4 KB (bigger ones close the connection unread). Messages sent while a sign-in is running count as strikes. |
| L3 | **Lock-out abuse.** Anyone could lock any account by guessing wrong 5 times. | Low | Wrong passwords lock the name **for that address**, with a much higher limit (50 in 5 minutes) across all addresses. |
| L4 | **Admin log flooding.** Players could flood the admin log with refused commands. | Low | Plain players' attempts aren't logged; moderators' refusals are. |
| L5 | **Exchange results named the other side's account.** | Low | Removed (`tests/net-exchange-guard.test.ts`). |
| L6 | **Character record built in the wrong world.** Snapshots built it in Brightwater rather than the player's zone. | Low | Now uses the player's own zone. |
| L7 | **Moderators could act on admins.** | Low | Only admins may act on moderators or admins. |

Checked and fine (from the same review):
- strict message validation (prototype keys, number ranges, exact shapes);
- commands act only for the signed-in player;
- trade and Exchange atomicity and undo;
- lease epochs against stale writers;
- token storage and constant-time password checks;
- per-viewer snapshots;
- chat cleaning;
- wisps and loot moving 1:1;
- parameterized SQL.
