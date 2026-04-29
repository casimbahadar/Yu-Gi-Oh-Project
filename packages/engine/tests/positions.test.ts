import { describe, it, expect } from "vitest";
import {
  createInitialState,
  reduce,
  type Action,
  type GameState,
  type InstanceId,
} from "../src/index.js";
import "../src/cards/index.js";
import { play } from "./helpers.js";

const GEMINI = 69140098;
const ASH = 14558127;
const POT = 53129443;
const DM = 46986414;

function deck(): number[] {
  const pool = [GEMINI, GEMINI, GEMINI, ASH, ASH, POT, DM, GEMINI, ASH, GEMINI];
  const out: number[] = [];
  while (out.length < 40) out.push(...pool);
  return out.slice(0, 40);
}

// `step` here flushes any chain windows the action opens (auto-pass for both players).
// Used pervasively because every Normal/Tribute/Flip Summon now opens a window.
function step(s: GameState, a: Action): GameState {
  return play(s, a).state;
}

function findHand(s: GameState, defId: number, pid: 0 | 1 = 0): InstanceId {
  const id = s.players[pid].hand.find((x) => s.cards[x]?.defId === defId);
  if (!id) throw new Error(`no ${defId} in hand`);
  return id;
}

/** Summon a Gemini Elf for both players, end turn 1, get to p0's Main1 on turn 3. */
function setupTwoMonstersBothMain1OnTurn3(): GameState {
  let s = createInitialState(99, "A", "B");
  ({ state: s } = reduce(s, { kind: "StartDuel", decks: { p0: deck(), p1: deck() }, goingFirst: 0 }));
  s = step(s, { kind: "EndPhase" }); // p0 Draw -> Standby
  s = step(s, { kind: "EndPhase" }); // Standby -> Main1
  s = step(s, { kind: "NormalSummon", player: 0, hand: findHand(s, GEMINI, 0), slot: 0, position: "ATK" });
  // End turn 1
  s = step(s, { kind: "EndPhase" }); // Main1 -> End (turn 1 skip)
  s = step(s, { kind: "EndPhase" }); // End -> p1 Draw
  // p1 turn
  s = step(s, { kind: "EndPhase" }); // Draw -> Standby
  s = step(s, { kind: "EndPhase" }); // Standby -> Main1
  s = step(s, { kind: "NormalSummon", player: 1, hand: findHand(s, GEMINI, 1), slot: 0, position: "ATK" });
  // End turn 2
  s = step(s, { kind: "EndPhase" }); // Main1 -> BattleStart
  s = step(s, { kind: "EndPhase" }); // BattleStart -> BattleStep
  s = step(s, { kind: "EndPhase" }); // BattleStep -> Damage
  s = step(s, { kind: "EndPhase" }); // Damage -> BattleEnd
  s = step(s, { kind: "EndPhase" }); // BattleEnd -> Main2
  s = step(s, { kind: "EndPhase" }); // Main2 -> End
  s = step(s, { kind: "EndPhase" }); // End -> p0 Draw
  // p0 turn 3
  s = step(s, { kind: "EndPhase" }); // Draw -> Standby
  s = step(s, { kind: "EndPhase" }); // Standby -> Main1
  return s;
}

describe("engine: ChangePosition", () => {
  it("rejects ATK->DEF on the turn the monster was Summoned", () => {
    let s = createInitialState(7, "A", "B");
    ({ state: s } = reduce(s, { kind: "StartDuel", decks: { p0: deck(), p1: deck() }, goingFirst: 0 }));
    s = step(s, { kind: "EndPhase" });
    s = step(s, { kind: "EndPhase" });
    const mid = findHand(s, GEMINI, 0);
    s = step(s, { kind: "NormalSummon", player: 0, hand: mid, slot: 0, position: "ATK" });
    const r = reduce(s, { kind: "ChangePosition", player: 0, monster: mid, position: "DEF" });
    expect(r.events.some((e) => e.kind === "ActionRejected")).toBe(true);
  });

  it("allows ATK->DEF after the summon turn, and rejects a second change in the same turn", () => {
    let s = setupTwoMonstersBothMain1OnTurn3();
    const myMonster = s.players[0].mainMonster[0]!;
    s = step(s, { kind: "ChangePosition", player: 0, monster: myMonster, position: "DEF" });
    expect(s.cards[myMonster]!.position).toBe("DEF");
    const r = reduce(s, { kind: "ChangePosition", player: 0, monster: myMonster, position: "ATK" });
    expect(r.events.some((e) => e.kind === "ActionRejected")).toBe(true);
  });

  it("rejects position change outside Main Phase", () => {
    let s = setupTwoMonstersBothMain1OnTurn3();
    const myMonster = s.players[0].mainMonster[0]!;
    s = step(s, { kind: "EndPhase" }); // Main1 -> BattleStart
    const r = reduce(s, { kind: "ChangePosition", player: 0, monster: myMonster, position: "DEF" });
    expect(r.events.some((e) => e.kind === "ActionRejected")).toBe(true);
  });

  it("rejects manual position change on a face-down monster (must Flip Summon)", () => {
    let s = setupTwoMonstersBothMain1OnTurn3();
    // Set a monster face-down on the same turn — but we already have one
    // monster up; second slot should be free. Set requires hand monster.
    const handMon = findHand(s, GEMINI, 0);
    s = step(s, { kind: "SetMonster", player: 0, hand: handMon, slot: 1 });
    // Even ignoring the summon-turn lock, we shouldn't be able to manually
    // ATK-flip a face-down: that path is exclusively FlipSummon.
    const r = reduce(s, { kind: "ChangePosition", player: 0, monster: handMon, position: "ATK" });
    expect(r.events.some((e) => e.kind === "ActionRejected")).toBe(true);
  });
});

describe("engine: FlipSummon", () => {
  it("rejects Flip Summon on a monster Set this same turn", () => {
    let s = createInitialState(13, "A", "B");
    ({ state: s } = reduce(s, { kind: "StartDuel", decks: { p0: deck(), p1: deck() }, goingFirst: 0 }));
    s = step(s, { kind: "EndPhase" }); // Draw -> Standby
    s = step(s, { kind: "EndPhase" }); // Standby -> Main1
    const mid = findHand(s, GEMINI, 0);
    s = step(s, { kind: "SetMonster", player: 0, hand: mid, slot: 0 });
    const r = reduce(s, { kind: "FlipSummon", player: 0, monster: mid });
    expect(r.events.some((e) => e.kind === "ActionRejected")).toBe(true);
  });

  it("flips face-down DEF to face-up ATK once the summon-turn lock is gone", () => {
    let s = setupTwoMonstersBothMain1OnTurn3();
    expect(s.players[0].normalSummonsUsed).toBe(0);
    const handMon = findHand(s, GEMINI, 0);
    s = step(s, { kind: "SetMonster", player: 0, hand: handMon, slot: 1 });
    // Same-turn flip is rejected (covered by the previous test).
    // Simulate "next turn" by clearing the summon-turn flag without
    // shuffling through the full turn cycle.
    s.cards[handMon]!.flags.summonedThisTurn = false;
    expect(s.cards[handMon]!.position).toBe("FaceDownDEF");
    s = step(s, { kind: "FlipSummon", player: 0, monster: handMon });
    expect(s.cards[handMon]!.faceUp).toBe(true);
    expect(s.cards[handMon]!.position).toBe("ATK");
  });
});
