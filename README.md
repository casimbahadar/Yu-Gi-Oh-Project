# Yu-Gi-Oh Fan Duel Platform

Open-source, fan-made Yu-Gi-Oh dueling platform targeting **web, desktop, and mobile** from a single TypeScript codebase. The long-term goal is full card coverage (every card printed) and every mechanic (Normal/Effect/Ritual/Fusion/Synchro/Xyz/Pendulum/Link plus Speed Duels and Tag Duels) with online play.

This repo currently holds the **MVP foundation**: a headless rules engine, a WebSocket duel server, and a React client. Not all mechanics are implemented yet — see "Status" below.

> Not affiliated with or endorsed by Konami. All card names, text, art, and characters are property of their respective owners. This project ships code only; card metadata and images are fetched at runtime from the community [YGOPRODeck](https://ygoprodeck.com/) API.

## Status

**Working today**
- Monorepo (pnpm workspaces) with engine, shared protocol, cards-data, server, and web packages
- Deterministic rules engine: serializable `GameState`, pure reducer, seeded RNG
- Turn/phase state machine (Draw → Standby → Main1 → Battle → Main2 → End)
- All seven canonical summon types end-to-end:
  - Normal Summon, Tribute Summon (1- and 2-tribute), Set Monster, Flip Summon
  - **Fusion Summon** via Polymerization (name-multiset material matching)
  - **Synchro Summon** with Tuner + non-Tuner level matching
  - **Xyz Summon** with shared-Level → Rank check and material attachment beneath the Xyz
  - **Link Summon** to Extra Monster Zones with link-rating math
  - **Ritual Summon** via Ritual Spell + tribute monsters whose Levels sum to ≥ the Ritual monster's Level
  - **Pendulum Summon**: set both Pendulum Zones, then mass-summon any number of hand monsters whose Levels are strictly between the scales
- Manual position change (ATK ↔ DEF) with once-per-turn / summon-turn / post-attack guards
- Spell types: Normal, Ritual, Quick-Play (chain-activate from Set face-down on opponent's turn), Equip (live ATK/DEF bonuses), and `Continuous/Field` recognized but their continuous effects aren't applied
- Spell activation pipeline: Pot of Greed (draw 2), Raigeki (board wipe), Monster Reborn (revive from any GY with a UI graveyard picker), Polymerization (Fusion), Black Illusion Ritual (Ritual), **Mystical Space Typhoon** (Quick-Play, destroy 1 face-up Spell/Trap), **Black Pendant** (Equip, +500 ATK)
- Battle Phase: attack declaration, ATK-vs-ATK / ATK-vs-DEF math (with live atk/def bonuses), direct attacks, face-down flip-on-attack, per-monster once-per-turn lock
- **Chain response window** with Spell Speed gating: opens after attack declarations, summons, and spell activations; resolves on two consecutive passes; supports negation, link skipping, and per-link cleanup (Normal/Counter Traps and Normal/Quick-Play Spells go to GY after resolving)
- Chain responders: **Mirror Force** (Spell Speed 2 trap), **Solemn Judgment** (Spell Speed 3 Counter Trap, half-LP cost), **Mystical Space Typhoon** (Spell Speed 2 Quick-Play, target picker), **Ash Blossom & Joyous Spring** (Spell Speed 2 hand trap, discard to negate opponent's Special Summon)
- Concede, life-points-to-zero victory, deck-out victory
- Server-side fog of war: opponent hand, deck, extra deck, and face-down field cards are redacted before broadcast
- WebSocket duel server with private room codes
- **Offline Practice vs AI mode** (in-browser, no server) — heuristic AI knows every summon type incl. Synchro/Xyz/Link/Ritual/Pendulum and chain-window decisions
- React client with: field view, hand actions, in-slot position-change & flip & activate-set buttons, click-to-attack flow, chain-window banner (with Mystical Space Typhoon target picker), graveyard picker, fusion picker, equip picker, **Special Summons panel** that auto-lists every legal Synchro/Xyz/Link/Ritual/Pendulum summon for one-click execution
- PWA manifest (installable on mobile browsers)
- YGOPRODeck snapshot CLI (`pnpm cards:refresh`)
- 44 engine tests covering bootstrap, all seven summon types, position changes, flips, spells, the battle phase, chain windows incl. Mirror Force/Solemn Judgment/Ash Blossom, Quick-Play chained on a Spell, Equip Spell stat bonus, fusion mismatch rejection, and AI self-play

**Deliberately deferred (pure scope reasons, not engine gaps)**
- Continuous / Field Spell *runtime effects* — Equip Spells fully work; Continuous and Field Spells can be played and stay face-up but their continuous effects aren't yet a runtime layer (would need an effect-monitor system; out of scope for the playable MVP)
- Specific hand-trap trigger filters (Ash currently negates any opponent Special Summon — real Ash filters by mill / search / SS-from-deck keywords; needs effect-keyword tags on resolvers)
- Deckbuilder UI + banlist validation — large standalone UI subsystem
- Speed Duels (different field layout + Skill cards) — alternate ruleset, fundamental redesign
- Tag Duels (2v2 shared field) — alternate room model
- Anime/game duelist roster + campaign mode — content scope, blocked on much wider card-effect coverage
- Tauri desktop build + Capacitor mobile build — packaging steps, web app already runs on all three platforms via PWA

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
