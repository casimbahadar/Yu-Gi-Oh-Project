import { describe, it, expect } from "vitest";
import {
  createInitialState,
  reduce,
  type Action,
  type GameState,
} from "../src/index.js";
import "../src/cards/index.js";
import { plantInHand, play } from "./helpers.js";

const BEWD = 89631139;
const BEUD = 23995346; // Blue-Eyes Ultimate Dragon
const POLY = 24094653;
const GEMINI = 69140098;
const POT = 53129443;

function deck(): number[] {
  // Make sure we have 3 BEWDs and 1 Polymerization in the main deck, plus
  // Blue-Eyes Ultimate Dragon in the extra deck.
  const main: number[] = [
    BEWD, BEWD, BEWD,
    POLY, POLY,
    GEMINI, GEMINI, GEMINI,
    POT, POT,
  ];
  while (main.length < 40) main.push(GEMINI);
  return [...main, BEUD];
}

function step(s: GameState, a: Action): GameState {
  return play(s, a).state;
}

function intoMain1OnTurn1(): GameState {
  let s = createInitialState(2026, "Yugi", "Kaiba");
  ({ state: s } = reduce(s, { kind: "StartDuel", decks: { p0: deck(), p1: deck() }, goingFirst: 0 }));
  s = step(s, { kind: "EndPhase" });
  s = step(s, { kind: "EndPhase" });
  return s;
}

describe("engine: Fusion Summon (Polymerization)", () => {
  it("Fusion Summons Blue-Eyes Ultimate Dragon using 3 BEWDs from hand", () => {
    let s = intoMain1OnTurn1();
    const poly = plantInHand(s, POLY, 0);
    const b1 = plantInHand(s, BEWD, 0);
    const b2 = plantInHand(s, BEWD, 0);
    const b3 = plantInHand(s, BEWD, 0);
    // Find BEUD in p0's extra deck.
    const beud = s.players[0].extraDeck.find((id) => s.cards[id]?.defId === BEUD);
    expect(beud).toBeDefined();

    const r = play(s, {
      kind: "FusionSummon",
      player: 0,
      polymerization: poly,
      fusionMonster: beud!,
      materials: [b1, b2, b3],
      slot: 2,
      position: "ATK",
    });
    s = r.state;

    expect(s.cards[beud!]!.location.zone).toBe("mainMonster");
    expect(s.cards[beud!]!.faceUp).toBe(true);
    expect(s.cards[beud!]!.position).toBe("ATK");
    expect(s.cards[poly]!.location.zone).toBe("graveyard");
    expect(s.cards[b1]!.location.zone).toBe("graveyard");
    expect(s.cards[b2]!.location.zone).toBe("graveyard");
    expect(s.cards[b3]!.location.zone).toBe("graveyard");
    // Removed from extra deck.
    expect(s.players[0].extraDeck.includes(beud!)).toBe(false);
  });

  it("rejects Fusion Summon when materials don't match", () => {
    let s = intoMain1OnTurn1();
    const poly = plantInHand(s, POLY, 0);
    const b1 = plantInHand(s, BEWD, 0);
    const b2 = plantInHand(s, BEWD, 0);
    const wrong = plantInHand(s, GEMINI, 0); // not a BEWD
    const beud = s.players[0].extraDeck.find((id) => s.cards[id]?.defId === BEUD);

    const r = reduce(s, {
      kind: "FusionSummon",
      player: 0,
      polymerization: poly,
      fusionMonster: beud!,
      materials: [b1, b2, wrong],
      slot: 0,
      position: "ATK",
    });
    expect(r.events.some((e) => e.kind === "ActionRejected")).toBe(true);
  });
});
