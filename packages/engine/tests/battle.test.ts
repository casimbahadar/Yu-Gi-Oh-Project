import { describe, it, expect } from "vitest";
import {
  createInitialState,
  reduce,
  type Action,
  type GameState,
  type InstanceId,
} from "../src/index.js";
import "../src/cards/index.js";

const DM = 46986414;        // Dark Magician — L7 ATK 2500 / DEF 2100 (Normal)
const BEWD = 89631139;      // Blue-Eyes — L8 ATK 3000 / DEF 2500
const ASH = 14558127;       // Ash Blossom — L3 ATK 0 / DEF 1800
const POT = 53129443;
const RAIGEKI = 12580477;
const MIRROR = 44095762;

function deck(): number[] {
  const pool = [ASH, ASH, ASH, POT, RAIGEKI, MIRROR, DM, DM, BEWD, BEWD];
  const out: number[] = [];
  while (out.length < 40) out.push(...pool);
  return out.slice(0, 40);
}

interface Setup {
  state: GameState;
  p0Ash: InstanceId;
  p1Ash: InstanceId;
}

/**
 * Bootstraps a duel where both players have an Ash Blossom Normal Summoned
 * face-up ATK in their main monster zone, and the state is sitting in
 * BattleStep on player 1's turn (so attacks are legal).
 */
function setupBothAshOnFieldP1Turn(): Setup {
  let s = createInitialState(123, "A", "B");
  ({ state: s } = reduce(s, {
    kind: "StartDuel",
    decks: { p0: deck(), p1: deck() },
    goingFirst: 0,
  }));

  // Force a known hand so the test is deterministic about which Ash we summon.
  // Easier: we summon whatever Ash is in hand on each player's turn.
  const summonAsh = (pid: 0 | 1): InstanceId => {
    const handAshId = s.players[pid].hand.find((id) => s.cards[id]?.defId === ASH);
    if (!handAshId) throw new Error("no ash in hand");
    ({ state: s } = reduce(s, {
      kind: "NormalSummon",
      player: pid,
      hand: handAshId,
      slot: 2,
      position: "ATK",
    }));
    return handAshId;
  };

  // Run p0's turn: Draw -> Standby -> Main1, summon Ash, then end turn.
  ({ state: s } = reduce(s, { kind: "EndPhase" })); // Draw -> Standby
  ({ state: s } = reduce(s, { kind: "EndPhase" })); // Standby -> Main1
  const p0Ash = summonAsh(0);
  // From Main1 turn 1: skip battle (no battle on turn 1) and go to End.
  ({ state: s } = reduce(s, { kind: "EndPhase" })); // Main1 -> End (auto-skip battle)
  ({ state: s } = reduce(s, { kind: "EndPhase" })); // End -> next turn (p1 Draw)

  // p1's turn: Draw -> Standby -> Main1 -> summon Ash -> Main1 -> BattleStart -> BattleStep
  expect(s.turnPlayer).toBe(1);
  ({ state: s } = reduce(s, { kind: "EndPhase" })); // Draw -> Standby
  ({ state: s } = reduce(s, { kind: "EndPhase" })); // Standby -> Main1
  const p1Ash = summonAsh(1);
  ({ state: s } = reduce(s, { kind: "EndPhase" })); // Main1 -> BattleStart
  ({ state: s } = reduce(s, { kind: "EndPhase" })); // BattleStart -> BattleStep
  expect(s.phase).toBe("BattleStep");

  return { state: s, p0Ash, p1Ash };
}

function step(s: GameState, a: Action): GameState {
  return reduce(s, a).state;
}

describe("engine: battle phase", () => {
  it("rejects attacks on turn 1 (going-first cannot enter Battle Phase)", () => {
    let s = createInitialState(7, "A", "B");
    ({ state: s } = reduce(s, {
      kind: "StartDuel",
      decks: { p0: deck(), p1: deck() },
      goingFirst: 0,
    }));
    // We try to manually enter BattleStep — phases.ts blocks this.
    ({ state: s } = reduce(s, { kind: "EndPhase" })); // Draw -> Standby
    ({ state: s } = reduce(s, { kind: "EndPhase" })); // Standby -> Main1
    const r = reduce(s, { kind: "EndPhase" }); // Main1 -> auto-skips to End
    expect(r.state.phase).toBe("End");
  });

  it("ATK > target ATK destroys the target and deals difference as damage", () => {
    const { state, p0Ash, p1Ash } = setupBothAshOnFieldP1Turn();
    // p1's Ash (ATK 0) cannot beat anything. Build a fresh case:
    // overwrite p1's monster to be Dark Magician for the test.
    const s = structuredClone(state);
    // Replace defId on p1's Ash to behave like Dark Magician (2500 ATK).
    s.cards[p1Ash]!.defId = DM;
    // p0's Ash has 0 ATK; p1's "DM" attacks it.
    const after = step(s, {
      kind: "DeclareAttack",
      player: 1,
      attacker: p1Ash,
      target: p0Ash,
    });
    expect(after.cards[p0Ash]!.location.zone).toBe("graveyard");
    expect(after.players[0].lifePoints).toBe(8000 - 2500);
  });

  it("ATK == target ATK destroys both, no damage", () => {
    const { state, p0Ash, p1Ash } = setupBothAshOnFieldP1Turn();
    const s = structuredClone(state);
    // Both 0 ATK. Attack across.
    const after = step(s, {
      kind: "DeclareAttack",
      player: 1,
      attacker: p1Ash,
      target: p0Ash,
    });
    expect(after.cards[p0Ash]!.location.zone).toBe("graveyard");
    expect(after.cards[p1Ash]!.location.zone).toBe("graveyard");
    expect(after.players[0].lifePoints).toBe(8000);
    expect(after.players[1].lifePoints).toBe(8000);
  });

  it("ATK < target ATK destroys the attacker and deals difference to attacker's controller", () => {
    const { state, p0Ash, p1Ash } = setupBothAshOnFieldP1Turn();
    const s = structuredClone(state);
    // Make p0's Ash a Dark Magician (2500 ATK). p1 attacks with 0-ATK Ash.
    s.cards[p0Ash]!.defId = DM;
    const after = step(s, {
      kind: "DeclareAttack",
      player: 1,
      attacker: p1Ash,
      target: p0Ash,
    });
    expect(after.cards[p1Ash]!.location.zone).toBe("graveyard");
    expect(after.cards[p0Ash]!.location.zone).toBe("mainMonster");
    expect(after.players[1].lifePoints).toBe(8000 - 2500);
  });

  it("blocks a second attack with the same monster on the same turn", () => {
    const { state, p0Ash, p1Ash } = setupBothAshOnFieldP1Turn();
    const s = structuredClone(state);
    s.cards[p1Ash]!.defId = BEWD; // 3000 ATK so it survives
    s.cards[p0Ash]!.defId = ASH;  // 0 ATK, will die first
    const a1 = reduce(s, {
      kind: "DeclareAttack",
      player: 1,
      attacker: p1Ash,
      target: p0Ash,
    });
    expect(a1.events.some((e) => e.kind === "BattleResolved")).toBe(true);
    // Try a direct attack — opponent now has no monsters but the same
    // attacker has flags.hasAttacked = true.
    const a2 = reduce(a1.state, {
      kind: "DeclareAttack",
      player: 1,
      attacker: p1Ash,
      target: "direct",
    });
    expect(a2.events.some((e) => e.kind === "ActionRejected")).toBe(true);
  });

  it("permits a direct attack only when the opponent has no monsters", () => {
    const { state, p0Ash, p1Ash } = setupBothAshOnFieldP1Turn();
    let s = structuredClone(state);
    // Remove p0's monster manually to simulate an empty field.
    s.players[0].mainMonster[s.cards[p0Ash]!.location.index] = null;
    s.cards[p0Ash]!.location = { controller: 0, zone: "graveyard", index: s.players[0].graveyard.length };
    s.players[0].graveyard.push(p0Ash);
    s.cards[p1Ash]!.defId = BEWD; // 3000 ATK
    const r = reduce(s, {
      kind: "DeclareAttack",
      player: 1,
      attacker: p1Ash,
      target: "direct",
    });
    expect(r.events.some((e) => e.kind === "DirectAttack")).toBe(true);
    expect(r.state.players[0].lifePoints).toBe(8000 - 3000);
  });

  it("rejects attacks outside Battle Phase", () => {
    const { state, p0Ash, p1Ash } = setupBothAshOnFieldP1Turn();
    const s = structuredClone(state);
    s.phase = "Main2";
    const r = reduce(s, {
      kind: "DeclareAttack",
      player: 1,
      attacker: p1Ash,
      target: p0Ash,
    });
    expect(r.events.some((e) => e.kind === "ActionRejected")).toBe(true);
  });

  it("ATK vs DEF: attacker bigger destroys defender, no damage; smaller deals difference to attacker's controller", () => {
    const { state, p0Ash, p1Ash } = setupBothAshOnFieldP1Turn();
    let s = structuredClone(state);
    // p1 attacks with BEWD (3000), p0 has Ash in DEF (1800)
    s.cards[p1Ash]!.defId = BEWD;
    s.cards[p0Ash]!.position = "DEF";
    s.cards[p0Ash]!.faceUp = true;
    const r1 = step(s, {
      kind: "DeclareAttack",
      player: 1,
      attacker: p1Ash,
      target: p0Ash,
    });
    expect(r1.cards[p0Ash]!.location.zone).toBe("graveyard");
    expect(r1.players[0].lifePoints).toBe(8000); // no piercing in MVP

    // Reset, this time attacker smaller than DEF.
    s = structuredClone(state);
    s.cards[p1Ash]!.defId = ASH; // 0 ATK
    s.cards[p0Ash]!.defId = DM;  // 2100 DEF
    s.cards[p0Ash]!.position = "DEF";
    s.cards[p0Ash]!.faceUp = true;
    const r2 = step(s, {
      kind: "DeclareAttack",
      player: 1,
      attacker: p1Ash,
      target: p0Ash,
    });
    expect(r2.cards[p0Ash]!.location.zone).toBe("mainMonster");
    expect(r2.cards[p1Ash]!.location.zone).toBe("mainMonster");
    expect(r2.players[1].lifePoints).toBe(8000 - 2100);
  });

  it("attacking face-down DEF flips it face-up first", () => {
    const { state, p0Ash, p1Ash } = setupBothAshOnFieldP1Turn();
    const s = structuredClone(state);
    s.cards[p1Ash]!.defId = BEWD;
    s.cards[p0Ash]!.position = "FaceDownDEF";
    s.cards[p0Ash]!.faceUp = false;
    const r = reduce(s, {
      kind: "DeclareAttack",
      player: 1,
      attacker: p1Ash,
      target: p0Ash,
    });
    expect(r.events.some((e) => e.kind === "FlippedFaceUp")).toBe(true);
    expect(r.state.cards[p0Ash]!.location.zone).toBe("graveyard");
  });
});
