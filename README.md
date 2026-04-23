# Yu-Gi-Oh Fan Duel Platform

Open-source, fan-made Yu-Gi-Oh dueling platform targeting **web, desktop, and mobile** from a single TypeScript codebase. The long-term goal is full card coverage (every card printed) and every mechanic (Normal/Effect/Ritual/Fusion/Synchro/Xyz/Pendulum/Link plus Speed Duels and Tag Duels) with online play.

This repo currently holds the **MVP foundation**: a headless rules engine, a WebSocket duel server, and a React client. Not all mechanics are implemented yet — see "Status" below.

> Not affiliated with or endorsed by Konami. All card names, text, art, and characters are property of their respective owners. This project ships code only; card metadata and images are fetched at runtime from the community [YGOPRODeck](https://ygoprodeck.com/) API.

## Status

**Working today**
- Monorepo (pnpm workspaces) with engine, shared protocol, cards-data, server, and web packages
- Deterministic rules engine: serializable `GameState`, pure reducer, seeded RNG
- Turn/phase state machine (Draw → Standby → Main1 → Battle → Main2 → End)
- Normal Summon, Tribute Summon, Set Monster, Set/Play Spell/Trap, Concede
- Chain / Spell Speed scaffolding with pluggable per-card effect resolvers
- Representative sample cards: Dark Magician, Blue-Eyes, Ash Blossom, Relinquished, Blue-Eyes Ultimate Dragon, Stardust Dragon, Utopia, Stargazer Magician, Decode Talker, Pot of Greed, Raigeki, Monster Reborn, Mirror Force, Solemn Judgment
- WebSocket duel server with private room codes
- React client with field view, hand, phase bar, and room create/join
- PWA manifest (installable on mobile browsers)
- YGOPRODeck snapshot CLI (`pnpm cards:refresh`)

**Stubbed / not yet implemented**
- Special Summons (Fusion/Synchro/Xyz/Link/Ritual/Pendulum) — engine accepts the action shape but doesn't yet compute materials or validate procedures
- Chain resolution UI (responding with Counter Traps, passing priority)
- Battle Phase damage calculation
- Deckbuilder UI + banlist validation
- Fog of war on opponent's hand/set cards (server currently sends full state)
- Speed Duels, Tag Duels, AI, anime/game duelist roster, campaign mode
- Tauri desktop build, Capacitor mobile build

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 10 (`npm i -g pnpm`)

## Setup

```bash
pnpm install
pnpm -r typecheck
pnpm --filter @ygo/engine test
```

## Run it

In two terminals:

```bash
# Terminal 1 — WebSocket duel server on :8787
pnpm dev:server

# Terminal 2 — Vite dev server on :5173
pnpm dev:web
```

Open <http://localhost:5173> in two browser tabs, "Create private room" in one, copy the room code, "Join" from the other. You'll both draw opening hands and can Normal Summon Level ≤ 4 monsters into Main1.

## Refreshing card data

The curated ~14-card sample is hardcoded in `packages/engine/src/cards/index.ts`. To pull the full YGOPRODeck catalog into a local snapshot (used by the upcoming deckbuilder):

```bash
pnpm cards:refresh
# writes packages/cards-data/data/cards.json (gitignored)
```

## Layout

```
yu-gi-oh-project/
├── packages/
│   ├── engine/          Pure TypeScript rules engine (deterministic, no I/O)
│   ├── shared/          Wire protocol between client and server
│   └── cards-data/      YGOPRODeck fetcher + snapshot loader
└── apps/
    ├── server/          Node + ws authoritative duel server
    └── web/             Vite + React client (PWA-installable)
```

## Contributing cards

Each card is one TypeScript file that registers a `CardDefinition` and any effect scripts. Adding a card:

1. Add the definition to `packages/engine/src/cards/index.ts` (or split into a per-archetype file).
2. If the card has effects, register them with `registerEffect("unique-key", resolver)`.
3. Add a replay test in `packages/engine/tests/` exercising the effect.

## License

MIT for this codebase. Yu-Gi-Oh card metadata, text, and images served through YGOPRODeck are © Konami.
