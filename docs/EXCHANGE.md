# Brightwater Exchange: Architecture and Transaction Rules

**Status:**
- **Built:** the engine, a local **practice market** (simulated traders, practice balances), the Exchange plaza and the mobile interface.
- **Not live:** player-to-player trading is **not** active. It needs the multiplayer backend (roadmap P3, on hold).

**Reference:** a centralized buy/sell order exchange modelled on the OSRS Grand Exchange, not an auction house. Players post offers with an item, a quantity and a unit price; compatible offers match automatically.

## 1. Components

| Component | File | Runs on |
|---|---|---|
| Exchange engine (order book, escrow, matching, settlement, audit) | `src/exchange/engine.ts` | Server (pure TypeScript, no DOM). Runs locally today for the practice market |
| Practice market (simulated traders, practice grant) | `src/exchange/simulation.ts` | Client only. Never connected to real wealth |
| Game integration (commands, Exchange clerks, save) | `src/sim/world.ts` | Simulation layer (server-ready command and event shape) |
| Interface | `src/ui/exchangeview.ts` | Client |
| Exchange plaza (location, clerks, bank booth) | `src/sim/worldmap.ts`, `src/render/props.ts` | World data and rendering |

**Dependencies:**
- **Item data** (`src/data/items.ts`): tradeability (every item except coins) and guide prices before any trades exist.
- **Inventory** (`src/sim/inventory.ts`): capacity rules when collecting into an inventory on the live path.
- Nothing else. The engine has no network, storage or UI dependencies, so a server can host it unchanged.

## 2. Data model

**Account.** A string id.
- **Practice market:** `practice:you` for the player and `sim:<Name>` for simulated traders.
- **Live:** the authenticated account id.

**Balances.** `account → asset → quantity`, where an asset is an item id or `coins`.
- Balances are *exchange storage*, separate from the 28-slot inventory and the bank. Non-stackable resources (logs, ore) are held as plain quantities here, so they can be traded in bulk without touching inventory slot rules.

**Order (offer).**
- **Identity and terms:** `id`, `account`, `slot` (0–7), `side` (buy/sell), `item`, `qty`, `price` (the limit per item).
- **Progress:** `filled` and `status` (active, completed, cancelled).
- **Priority and timing:** `seq` is the global time priority; `placedAt` is the wall-clock time.
- **Escrow:**
  - `escrowCoins` is what a buy still holds: unfilled × limit.
  - `escrowItems` is what a sell still holds: the unfilled quantity.
- **Collection box:** `boxCoins` and `boxItems` hold proceeds waiting to be collected (bought items, sale coins, refunds).
- `value` is the total of coins paid or received, for the average price.

**Trade.** `id`, `seq`, `at`, `item`, `qty`, `price`, `buyOrder`, `sellOrder`, `buyer`, `seller`.

**Audit entry.** `seq`, `at`, `op`, `account`, `nonce`, `detail` and `hash`.
- Each `hash` is the FNV hash of the previous entry's hash plus this entry, so editing any entry breaks the chain.
- Older entries roll into a `checkpoint` hash, which the chain continues from.

**Supply.** For each asset, everything deposited minus everything withdrawn.

**Nonces.** For each account: the last nonce, plus the recent results with a fingerprint of each request.

## 3. Transaction rules

**One writer, atomic requests.**
- Every change goes through `Exchange.submit(request)`, one request at a time.
- A request is validated completely against the engine's own state *before* anything changes. Then it is applied in full, or rejected with nothing changed.
- On a server, each market runs on a single writer (a single-threaded worker or a serialized queue). This removes races between concurrent requests: they are ordered, not interleaved.

**Requests are intents, never results.** Clients send only:
- `place {slot, side, item, qty, price}`, `cancel {orderId}` or `collect {orderId}`.
- The account comes from the server session, never from the client.
- `deposit` and `withdraw` are server-internal: practice grants today, the bank bridge later.

The engine never accepts client-supplied quantities owned, coin balances, fill amounts or trade results.

**Validation.**
- Quantity and price must be whole numbers: quantity from 1 to 1,000,000, price from 1 coin.
- An order's total value can't exceed the 2,147,483,647 coin cap.
- The item must be tradeable, and the slot must exist and be free.
- The account must cover the escrow from its free balance.
- Buy limits apply per item over 4 hours (OSRS-style). Open buy offers count toward the limit.

**Escrow.** Placing an offer immediately moves its coins (buy: qty × limit) or items (sell: qty) out of the free balance into the order. Escrowed value can't be spent twice.

**Matching: price, then time.**
- An incoming buy takes the cheapest sells at or below its limit. An incoming sell takes the highest buys at or above its limit.
- Among equal prices, the oldest offer (lowest `seq`) fills first.
- The trade executes at the **resting** offer's price, as on the OSRS Grand Exchange. A buyer whose limit was higher gets the difference back in the collection box.
- **Self-trade prevention:** an account never matches its own offers (no wash trading).
- Matching is deterministic: the same sequence of requests always produces the same trades.

**Settlement (inside the same request).** For a fill of `q` at price `p`:
- **Buy order:** escrow falls by `q × limit`; its box gains `q` items plus `q × (limit − p)` coins.
- **Sell order:** escrow falls by `q` items; its box gains `q × p` coins.

Nothing is ever created or destroyed by a trade.

**Partial fills.** An order fills across any number of trades. Its status stays `active` until `filled = qty`.

**Cancellation.** Whatever an active order still holds (coins or items) moves into its collection box, so nothing is lost. Filled amounts already in the box stay there.

**Collection.**
- Moves the box's coins and items into the account's free balance.
- A finished order with an empty box is removed, which frees its slot. Collecting from an active, partly filled order leaves it open.

**Duplicate and replay protection.**
- Each request carries a nonce, which must be higher than that account's last nonce.
- An **exact retry** of a recent request (same nonce, same contents) returns the original result marked `replayed`, without applying it again. Retries after a dropped connection are therefore safe.
- A **reused nonce with different contents**, or **any older nonce**, is rejected. Even after the replay memory forgets an old request, it can never be applied again.

**Accounting check (`verify()`).** For every asset, free balances + escrow + collection boxes must equal supply. Every active order's escrow must match exactly what is still unfilled. The audit chain must be intact.
- The test suite runs this after every request, including a randomized run of 1,500 interleaved requests from five accounts with duplicates and stale retries.
- Restoring a save that fails the check is refused.

**Auditability.**
- Every deposit, placement, trade, cancellation, collection and withdrawal is logged with its sequence number, account, nonce and detail, in a hash chain. A server would ship these entries to permanent storage.
- **Anti-manipulation hooks are in place:** buy limits, self-trade prevention, per-account slots, and price guidance from recent trades.
- **Future safeguards** (price bands around the guide, velocity limits, account-age limits, review of unusual flows) would plug into the same validation step and audit trail.

## 4. Persistence

- `Exchange.toJSON()` and `Exchange.restore()` save and restore everything: balances, orders, supply, nonces, buy-limit history, recent trades, and audit log with checkpoint.
- Restoring re-runs `verify()`.
- **Practice market:** saved with the character under `exchangePractice` (local only).
- **Live:** the server would persist the order book and ledger in a transactional database. Each `submit()` becomes one database transaction, plus an append-only audit table.

## 5. The practice market (what the game has now)

- **Exchange plaza:** north-east of the village, by the house and sawmill.
  - Clerks Pell and Imogen open the exchange.
  - Hal at the plaza's bank booth gives normal bank access.
- **Practice account:** starts with **practice** stock that exists only inside the simulation: 10,000 practice coins, 100 logs, 50 copper ore, 50 tin ore and 20 iron bars.
- **Simulated traders:** six bots (Ash, Brindle, Corra, Dunmore, Elsie, Fenwick), always labelled "simulated trader". They post and cancel offers near guide prices through the same `submit()` path.
- **Labelling:** the interface marks everything as practice, and no simulated trade is presented as a real player transaction.
- **Isolation:** **no path** moves practice coins or items into a real inventory or bank, or real items into the practice market.

## 6. Migration path to live trading

1. **Accounts:** username and password accounts on the game server (owner decision), with server-side sessions. `account` comes from the session.
2. **Server-owned inventories:** the server runs `GameWorld` per player. Inventory, bank and coins exist only on the server; clients render events.
3. **Exchange service:** host one `Exchange` per world (or region) on a single writer. Persist it with a transactional database (one transaction per `submit()`) and an append-only audit table.
4. **Bank bridge:**
   - Placing an offer from the Exchange interface *deposits* the items or coins from the player's server-side bank or inventory into exchange storage, then places the offer.
   - Collecting *withdraws* into the inventory (only what fits, via `withdrawToInventory`), with the rest into the bank.
   - Both happen in one server transaction.
5. **Client:** the same interface switches its data source from the practice market to the live service. It shows "Live" only when connected to a live exchange, and the practice market stays available as a tutorial.
6. **Safeguards before launch:** price bands, rate limits per account, monitoring of audit flows, and a dry run with test accounts.
7. **Activation:** live trading is **off** until the owner approves hosting, accounts and launch. Nothing in the client can switch it on today.

## 7. Implemented vs needs multiplayer backend

| Feature | Practice market (local) | Live (needs backend) |
|---|---|---|
| Buy and sell offers, 8 slots, item search, price guide, history | ✅ | Same interface |
| Matching by price and time, partial fills, cancel, collect | ✅ engine | Hosted engine |
| Escrow accounting, audit chain, replay protection | ✅ engine | Plus database transactions |
| Trading with other real players | ❌ simulated traders only | Required |
| Real items and coins | ❌ practice stock only | Bank bridge |
| Authenticated accounts | ❌ | Username and password (decided) |
| Shared persistence across devices | ❌ saved on this device | Server database |
