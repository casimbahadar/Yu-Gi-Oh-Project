import { describe, it, expect } from "vitest";
import { createInitialState, reduce } from "../src/index.js";
import "../src/cards/index.js";

const DM = 46986414;          // Dark Magician (L7 Normal Monster)
const ASH = 14558127;         // Ash Blossom (L3 Effect)
const POT = 53129443;         // Pot of Greed
const RAIGEKI = 12580477;

function deck(): number[] {
  // 40 cards — repeat a small pool to satisfy min deck size.
  const pool = [ASH, ASH, ASH, POT, POT, RAIGEKI, DM, DM, DM, DM];
  const out: number[] = [];
  while (out.length < 40) out.push(...pool);
  return out.slice(0, 40);
}

describe("engine: duel bootstrap", () => {
  it("starts a duel, deals 5-card opening hands, and puts p0 on Draw phase", () => {
    let s = createInitialState(42, "Yugi", "Kaiba");
    const r = reduce(s, {
      kind: "StartDuel",
      decks: { p0: deck(), p1: deck() },
      goingFirst: 0,
    });
    s = r.state;
    expect(s.players[0].hand).toHaveLength(5);
    expect(s.players[1].hand).toHaveLength(5);
    expect(s.turn).toBe(1);
    expect(s.turnPlayer).toBe(0);
    expect(s.phase).toBe("Draw");
  });

  it("refuses a Normal Summon of a L7 monster without tributes", () => {
    let s = createInitialState(1, "A", "B");
    ({ state: s } = reduce(s, {
      kind: "StartDuel",
      decks: { p0: [DM, DM, DM, ASH, ASH, ASH, POT, POT, RAIGEKI, DM], p1: deck() },
      goingFirst: 0,
    }));
    ({ state: s } = reduce(s, { kind: "EndPhase" })); // Draw → Standby
    ({ state: s } = reduce(s, { kind: "EndPhase" })); // Standby → Main1
    expect(s.phase).toBe("Main1");
    const dmInHand = s.players[0].hand.find((id) => s.cards[id]?.defId === DM);
    expect(dmInHand).toBeDefined();
    const r = reduce(s, {
      kind: "NormalSummon",
      player: 0,
      hand: dmInHand!,
      slot: 2,
      position: "ATK",
    });
    expect(r.events.some((e) => e.kind === "ActionRejected")).toBe(true);
  });

  it("advances through the turn and draws on the next player's Draw phase", () => {
    let s = createInitialState(7, "A", "B");
    ({ state: s } = reduce(s, {
      kind: "StartDuel",
      decks: { p0: deck(), p1: deck() },
      goingFirst: 0,
    }));
    const before = s.players[1].hand.length;
    // Run through every phase of turn 1.
    for (let i = 0; i < 9; i++) {
      ({ state: s } = reduce(s, { kind: "EndPhase" }));
    }
    expect(s.turn).toBe(2);
    expect(s.turnPlayer).toBe(1);
    expect(s.players[1].hand.length).toBe(before + 1);
  });
});
