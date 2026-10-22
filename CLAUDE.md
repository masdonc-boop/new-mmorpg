# Brightwater: notes for contributors

- **Originality is mandatory** (`docs/ORIGINALITY.md`). OSRS is a reference for *general mechanics* only. Never add RuneScape-specific content: no item names or sets, quests, creatures, gods, places, level/XP tables, or rune-based magic. Real-world materials and species are fine. New resources need their own lore, purpose and place in gathering → processing → crafting → equipment → quests → the Exchange.
- When replacing existing content, keep saves working: stable ids or an alias map, 1:1 conversion, and a one-time grant flag (see `docs/ORIGINALITY.md` section 4).
- Design direction and roadmap: `docs/DESIGN_SPEC.md`. Exchange architecture: `docs/EXCHANGE.md`.
- Game rules live in the deterministic simulation (`src/sim`, `src/exchange`) and must stay server-ready: clients send intents, the simulation validates.
- Before committing, run `npx tsc --noEmit -p .`, `npx vitest run` and `npx vite build`.
