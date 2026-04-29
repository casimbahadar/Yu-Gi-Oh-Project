/**
 * Sample card library — representative one-of-each coverage so the
 * engine can be exercised end-to-end before the YGOPRODeck snapshot
 * is wired up. Real card scripts register effects via `registerEffect`.
 *
 * Ids match YGOPRODeck's Konami ids so later card-pool expansion
 * can use the same numeric keys without migration.
 */

import {
  bindActivation,
  registerEffect,
  registerResponder,
} from "../chain.js";
import { draw, destroy, changeLifePoints } from "../effects/primitives.js";
import { registerMany } from "../registry.js";
import type { CardDefinition, InstanceId, PlayerId } from "../types.js";

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
  {
    id: 15025844,
    name: "Mystical Elf",
    cardType: "Monster",
    kinds: ["Normal"],
    attribute: "LIGHT",
    race: "Spellcaster",
    level: 4,
    atk: 800,
    def: 2000,
    text: "An elf renowned for its incredible defensive technique.",
  },
  {
    id: 69140098,
    name: "Gemini Elf",
    cardType: "Monster",
    kinds: ["Normal"],
    attribute: "EARTH",
    race: "Spellcaster",
    level: 4,
    atk: 1900,
    def: 900,
    text: "Twin elves who tease their attackers and beguile their enemies.",
  },
  {
    id: 78658564,
    name: "Goblin Attack Force",
    cardType: "Monster",
    kinds: ["Normal"],
    attribute: "EARTH",
    race: "Warrior",
    level: 4,
    atk: 2300,
    def: 0,
    text: "A goblin force that ferociously attacks at any cost.",
  },

  // --- Effect Monsters ---
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
  {
    id: 70781052,
    name: "Summoned Skull",
    cardType: "Monster",
    kinds: ["Effect"],
    attribute: "DARK",
    race: "Fiend",
    level: 6,
    atk: 2500,
    def: 1200,
    text: "A fiend with dark powers. (Tribute Summon target.)",
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
    fusionMaterials: [
      "Blue-Eyes White Dragon",
      "Blue-Eyes White Dragon",
      "Blue-Eyes White Dragon",
    ],
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
  {
    id: 24094653,
    name: "Polymerization",
    cardType: "Spell",
    kind: "Normal",
    text: "Fusion Summon 1 Fusion Monster from your Extra Deck, using monsters from your hand or field as Fusion Material.",
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
bindActivation(53129443, "spell:pot-of-greed:draw");

// Raigeki: destroy all monsters the opponent controls.
registerEffect("spell:raigeki:nuke-monsters", (state, link, events) => {
  const opp = (1 - link.controller) as PlayerId;
  const ids = [
    ...state.players[opp].mainMonster.filter((x): x is InstanceId => x !== null),
    ...state.extraMonsterZones.filter(
      (x): x is InstanceId => x !== null && state.cards[x]?.controller === opp,
    ),
  ];
  for (const id of ids) destroy(state, id, events);
});
bindActivation(12580477, "spell:raigeki:nuke-monsters");

// Monster Reborn: payload.target is the InstanceId of a monster in either
// player's graveyard. We Special Summon it face-up ATK to the caster's
// first empty Main Monster Zone, controller switches to caster.
registerEffect("spell:monster-reborn:revive", (state, link, events) => {
  const pid = link.controller;
  const targetId = link.payload?.target as InstanceId | undefined;
  if (!targetId) {
    events.push({ kind: "EffectFizzled", reason: "no target", source: link.source });
    return;
  }
  const card = state.cards[targetId];
  if (!card || card.location.zone !== "graveyard") {
    events.push({ kind: "EffectFizzled", reason: "target not in graveyard", source: link.source });
    return;
  }
  const me = state.players[pid];
  const slot = me.mainMonster.findIndex((x) => x === null);
  if (slot < 0) {
    events.push({ kind: "EffectFizzled", reason: "no monster zone", source: link.source });
    return;
  }
  // Remove from owner's graveyard.
  const owner = state.players[card.owner];
  const i = owner.graveyard.indexOf(targetId);
  if (i >= 0) owner.graveyard.splice(i, 1);
  // Move to caster's field.
  card.controller = pid;
  card.location = { controller: pid, zone: "mainMonster", index: slot };
  card.position = "ATK";
  card.faceUp = true;
  card.flags = { ...card.flags, summonedThisTurn: true, hasAttacked: false, positionChangedThisTurn: false };
  me.mainMonster[slot] = targetId;
  events.push({ kind: "SpecialSummon", player: pid, instanceId: targetId, slot, position: "ATK", from: "graveyard" });
});
bindActivation(83764718, "spell:monster-reborn:revive");

// Solemn Judgment: Counter Trap (Spell Speed 3). Activatable in response
// to a Normal/Tribute Summon or a Spell/Trap activation. Cost: pay half
// your LP at activation. Effect: negate the trigger and, if it was a
// summon, destroy the summoned monster; if it was a spell, the spell's
// link is marked negated so its effect won't run.
registerEffect("trap:solemn-judgment:resolve", (state, link, events) => {
  const w = state.pendingChainWindow;
  if (!w) return;
  w.triggerNegated = true;
  events.push({ kind: "Negated", by: link.source, trigger: w.trigger.kind });
  if (w.trigger.kind === "Summoned") {
    // Destroy the summoned monster.
    const targetId = w.trigger.instanceId;
    destroy(state, targetId, events);
  } else if (w.trigger.kind === "SpellActivated") {
    // The spell's link sits below us in the chain. Mark it negated.
    const linkBelow = state.chain[state.chain.length - 1];
    if (linkBelow) linkBelow.negated = true;
  }
});
registerResponder(41420027, {
  effectKey: "trap:solemn-judgment:resolve",
  spellSpeed: 3,
  canRespond: (trigger) =>
    trigger.kind === "Summoned" || trigger.kind === "SpellActivated",
  onActivate: (state, source, events) => {
    const pid = source.controller;
    const cost = Math.ceil(state.players[pid].lifePoints / 2);
    changeLifePoints(state, pid, -cost, events);
    events.push({ kind: "PaidCost", source: source.instanceId, cost });
  },
});

// Mirror Force: Trap (Spell Speed 2). Activatable in response to an
// attack declaration. Effect: destroy every attack-position monster
// the attacking player controls (including the attacker).
registerEffect("trap:mirror-force:resolve", (state, link, events) => {
  const w = state.pendingChainWindow;
  if (!w || w.trigger.kind !== "AttackDeclared") return;
  const attackingPlayer = w.trigger.attackingPlayer;
  const candidates: InstanceId[] = [
    ...state.players[attackingPlayer].mainMonster.filter((x): x is InstanceId => x !== null),
    ...state.extraMonsterZones.filter(
      (x): x is InstanceId =>
        x !== null && state.cards[x]?.controller === attackingPlayer,
    ),
  ];
  for (const id of candidates) {
    const c = state.cards[id];
    if (c?.position === "ATK" && c.faceUp) destroy(state, id, events);
  }
});
registerResponder(44095762, {
  effectKey: "trap:mirror-force:resolve",
  spellSpeed: 2,
  canRespond: (trigger, _state, source) =>
    trigger.kind === "AttackDeclared" &&
    trigger.attackingPlayer !== source.controller,
});

export { cards as SAMPLE_CARDS };
