import { describe, it, expect } from "vitest";
import {
  createInitialState,
  reduce,
  type Action,
  type GameState,
} from "../src/index.js";
import "../src/cards/index.js";
import { plantInHand } from "./helpers.js";

const POT = 53129443;
const RAIGEKI = 12580477;
const REBORN = 83764718;
const MIRROR = 44095762;
const ASH = 14558127;
const GEMINI = 69140098;
const DM = 46986414;

function deck(): number[] {
  const pool = [POT, POT, RAIGEKI, REBORN, MIRROR, ASH, GEMINI, GEMINI, GEMINI, DM];
  const out: number[] = [];
  while (out.length < 40) out.push(...pool);
  return out.slice(0, 40);
}

function step(s: GameState, a: Action): GameState {
  return reduce(s, a).state;
}

function intoMain1OnTurn1(): GameState {
  let s = createInitialState(11, "A", "B");
  ({ state: s } = reduce(s, { kind: "StartDuel", decks: { p0: deck(), p1: deck() }, goingFirst: 0 }));
  s = step(s, { kind: "EndPhase" }); // Draw -> Standby
  s = step(s, { kind: "EndPhase" }); // Standby -> Main1
  return s;
}

describe("engine: spell activation", () => {
  it("Pot of Greed draws 2 and itself goes to graveyard", () => {
    let s = intoMain1OnTurn1();
    const pot = plantInHand(s, POT, 0);
    const handBefore = s.players[0].hand.length;
    const r = reduce(s, { kind: "PlaySpell", player: 0, hand: pot, slot: 0, faceDown: false });
    s = r.state;
    expect(s.players[0].hand.length).toBe(handBefore + 1);
    expect(s.cards[pot]!.location.zone).toBe("graveyard");
    expect(r.events.some((e) => e.kind === "SpellActivated")).toBe(true);
    expect(r.events.some((e) => e.kind === "SentToGraveyard")).toBe(true);
  });

  it("Raigeki destroys all opponent monsters but spares your own", () => {
    let s = intoMain1OnTurn1();
    // Plant an opponent monster on the field.
    const oppMonsterId = plantInHand(s, GEMINI, 1);
    s.players[1].hand.splice(s.players[1].hand.indexOf(oppMonsterId), 1);
    s.players[1].mainMonster[2] = oppMonsterId;
    s.cards[oppMonsterId]!.location = { controller: 1, zone: "mainMonster", index: 2 };
    s.cards[oppMonsterId]!.position = "ATK";
    s.cards[oppMonsterId]!.faceUp = true;

    const myMonsterId = plantInHand(s, GEMINI, 0);
    s = step(s, { kind: "NormalSummon", player: 0, hand: myMonsterId, slot: 1, position: "ATK" });

    const raigeki = plantInHand(s, RAIGEKI, 0);
    s = step(s, { kind: "PlaySpell", player: 0, hand: raigeki, slot: 0, faceDown: false });

    expect(s.cards[oppMonsterId]!.location.zone).toBe("graveyard");
    expect(s.cards[myMonsterId]!.location.zone).toBe("mainMonster");
  });

  it("Set Trap stays face-down; activating from your own field is rejected for traps in MVP", () => {
    let s = intoMain1OnTurn1();
    const mirror = plantInHand(s, MIRROR, 0);
    s = step(s, { kind: "SetTrap", player: 0, hand: mirror, slot: 0 });
    expect(s.cards[mirror]!.faceUp).toBe(false);
    expect(s.cards[mirror]!.location.zone).toBe("spellTrap");
    const r = reduce(s, { kind: "ActivateSetSpell", player: 0, spellTrap: mirror });
    expect(r.events.some((e) => e.kind === "ActionRejected")).toBe(true);
  });

  it("Activating a Set Spell from your field resolves its effect", () => {
    let s = intoMain1OnTurn1();
    const pot = plantInHand(s, POT, 0);
    s = step(s, { kind: "PlaySpell", player: 0, hand: pot, slot: 0, faceDown: true });
    expect(s.cards[pot]!.faceUp).toBe(false);
    const handBefore = s.players[0].hand.length;
    s = step(s, { kind: "ActivateSetSpell", player: 0, spellTrap: pot });
    expect(s.players[0].hand.length).toBe(handBefore + 2);
    expect(s.cards[pot]!.location.zone).toBe("graveyard");
  });

  it("Monster Reborn revives a monster from your graveyard onto your field face-up ATK", () => {
    let s = intoMain1OnTurn1();
    const gem = plantInHand(s, GEMINI, 0);
    s = step(s, { kind: "NormalSummon", player: 0, hand: gem, slot: 0, position: "ATK" });
    // Force into graveyard.
    s.players[0].mainMonster[0] = null;
    s.cards[gem]!.location = { controller: 0, zone: "graveyard", index: s.players[0].graveyard.length };
    s.players[0].graveyard.push(gem);

    const reborn = plantInHand(s, REBORN, 0);
    const r = reduce(s, {
      kind: "PlaySpell",
      player: 0,
      hand: reborn,
      slot: 0,
      faceDown: false,
      payload: { target: gem },
    });
    s = r.state;
    expect(s.cards[gem]!.location.zone).toBe("mainMonster");
    expect(s.cards[gem]!.faceUp).toBe(true);
    expect(s.cards[gem]!.position).toBe("ATK");
    expect(s.cards[reborn]!.location.zone).toBe("graveyard");
  });
});
