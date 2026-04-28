/**
 * Sample card library — representative one-of-each coverage so the
 * engine can be exercised end-to-end before the YGOPRODeck snapshot
 * is wired up. Real card scripts register effects via `registerEffect`.
 *
 * Ids match YGOPRODeck's Konami ids so later card-pool expansion
 * can use the same numeric keys without migration.
 */

import { registerEffect } from "../chain.js";
import { draw, destroy, changeLifePoints } from "../effects/primitives.js";
import { registerMany } from "../registry.js";
import type { CardDefinition } from "../types.js";

const cards: CardDefinition[] = [
  // --- Normal Monsters ---
  {
    id: 46986414,
    name: "Dark Magician",
    cardType: "Monster",
    kinds: ["Normal"],
    attribute: "DARK",
    race: "Spellcaster",
    level: 7,
    atk: 2500,
    def: 2100,
    text: "The ultimate wizard in terms of attack and defense.",
  },
  {
    id: 89631139,
    name: "Blue-Eyes White Dragon",
    cardType: "Monster",
    kinds: ["Normal"],
    attribute: "LIGHT",
    race: "Dragon",
    level: 8,
    atk: 3000,
    def: 2500,
    text: "This legendary dragon is a powerful engine of destruction.",
  },

  // --- Effect Monster ---
  {
    id: 14558127,
    name: "Ash Blossom & Joyous Spring",
    cardType: "Monster",
    kinds: ["Effect"],
    attribute: "FIRE",
    race: "Zombie",
    level: 3,
    atk: 0,
    def: 1800,
    text: "Hand trap. Negate one of: adds from deck / special summons from deck / sends from deck / mills.",
  },

  // --- Ritual ---
  {
    id: 73752131,
    name: "Relinquished",
    cardType: "Monster",
    kinds: ["Ritual", "Effect"],
    attribute: "DARK",
    race: "Spellcaster",
    level: 1,
    atk: 0,
    def: 0,
    text: "Ritual summoned with Black Illusion Ritual.",
  },

  // --- Fusion ---
  {
    id: 23995346,
    name: "Blue-Eyes Ultimate Dragon",
    cardType: "Monster",
    kinds: ["Fusion"],
    attribute: "LIGHT",
    race: "Dragon",
    level: 12,
    atk: 4500,
    def: 3800,
    text: "3 Blue-Eyes White Dragon.",
  },

  // --- Synchro ---
  {
    id: 70902743,
    name: "Stardust Dragon",
    cardType: "Monster",
    kinds: ["Synchro", "Effect"],
    attribute: "WIND",
    race: "Dragon",
    level: 8,
    atk: 2500,
    def: 2000,
    text: "1 Tuner + 1+ non-Tuner monsters.",
  },

  // --- Xyz ---
  {
    id: 84013237,
    name: "Number 39: Utopia",
    cardType: "Monster",
    kinds: ["Xyz", "Effect"],
    attribute: "LIGHT",
    race: "Warrior",
    rank: 4,
    atk: 2500,
    def: 2000,
    text: "2 Level 4 monsters.",
  },

  // --- Pendulum ---
  {
    id: 1784686,
    name: "Stargazer Magician",
    cardType: "Monster",
    kinds: ["Pendulum", "Effect"],
    attribute: "DARK",
    race: "Spellcaster",
    level: 5,
    atk: 1200,
    def: 2400,
    pendulumScale: 1,
    text: "Pendulum scale 1.",
  },

  // --- Link ---
  {
    id: 50588353,
    name: "Decode Talker",
    cardType: "Monster",
    kinds: ["Link", "Effect"],
    attribute: "DARK",
    race: "Cyberse",
    linkRating: 3,
    linkArrows: ["TL", "B", "TR"],
    atk: 2300,
    text: "2+ Effect Monsters.",
  },

  // --- Spells ---
  {
    id: 12580477,
    name: "Raigeki",
    cardType: "Spell",
    kind: "Normal",
    text: "Destroy all monsters your opponent controls.",
  },
  {
    id: 83764718,
    name: "Monster Reborn",
    cardType: "Spell",
    kind: "Normal",
    text: "Target 1 monster in either GY; Special Summon it.",
  },
  {
    id: 53129443,
    name: "Pot of Greed",
    cardType: "Spell",
    kind: "Normal",
    text: "Draw 2 cards.",
  },

  // --- Traps ---
  {
    id: 44095762,
    name: "Mirror Force",
    cardType: "Trap",
    kind: "Normal",
    text: "When an opponent's monster declares an attack: destroy all their ATK-position monsters.",
  },
  {
    id: 41420027,
    name: "Solemn Judgment",
    cardType: "Trap",
    kind: "Counter",
    text: "Pay half LP; negate a Summon or Spell/Trap activation and destroy it.",
  },
];

registerMany(cards);

// --- Effect scripts ---
// Pot of Greed: draw 2.
registerEffect("spell:pot-of-greed:draw", (state, link, events) => {
  draw(state, link.controller, 2, events);
});

// Raigeki: destroy all monsters the opponent controls.
registerEffect("spell:raigeki:nuke-monsters", (state, link, events) => {
  const opp = (1 - link.controller) as 0 | 1;
  const ids = [
    ...state.players[opp].mainMonster.filter((x): x is string => x !== null),
    ...state.extraMonsterZones.filter(
      (x): x is string => x !== null && state.cards[x]?.controller === opp,
    ),
  ];
  for (const id of ids) destroy(state, id, events);
});

// Solemn Judgment: pay half LP; negate. Negation is done by the chain
// resolver flagging the target link's effectKey — stubbed here as LP pay.
registerEffect("trap:solemn-judgment:negate", (state, link, events) => {
  const pid = link.controller;
  const cost = Math.ceil(state.players[pid].lifePoints / 2);
  changeLifePoints(state, pid, -cost, events);
  events.push({ kind: "Negated", by: link.source, target: link.payload.target });
});

export { cards as SAMPLE_CARDS };
