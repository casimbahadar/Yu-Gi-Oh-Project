import { describe, it, expect } from "vitest";
import {
  createInitialState,
  legalActions,
  pickAction,
  reduce,
  type GameState,
} from "../src/index.js";
import "../src/cards/index.js";
import { play } from "./helpers.js";

const GEMINI = 69140098;
const ASH = 14558127;
const POT = 53129443;
const RAIGEKI = 12580477;
const REBORN = 83764718;
const POLY = 24094653;
const BEWD = 89631139;
const BEUD = 23995346;
const MIRROR = 44095762;
const SOLEMN = 41420027;

function deck(): number[] {
  const pool = [GEMINI, ASH, POT, RAIGEKI, REBORN, POLY, BEWD, MIRROR, SOLEMN];
  const out: number[] = [];
  while (out.length < 40) out.push(...pool);
  return [...out.slice(0, 40), BEUD];
}

function intoMain1OnTurn1(): GameState {
  let s = createInitialState(31337, "AI", "Human");
  ({ state: s } = reduce(s, { kind: "StartDuel", decks: { p0: deck(), p1: deck() }, goingFirst: 0 }));
  s = play(s, { kind: "EndPhase" }).state;
  s = play(s, { kind: "EndPhase" }).state;
  return s;
}

describe("engine: AI legalActions + pickAction", () => {
  it("enumerates at least: end phase, concede, and any hand-card actions", () => {
    const s = intoMain1OnTurn1();
    const actions = legalActions(s, 0);
    const kinds = new Set(actions.map((a) => a.kind));
    expect(kinds.has("EndPhase")).toBe(true);
    expect(kinds.has("Concede")).toBe(true);
    // Some kind of hand-driven action should be available given our deck.
    const hasHandAction = actions.some((a) =>
      a.kind === "NormalSummon" || a.kind === "PlaySpell" || a.kind === "SetTrap" ||
      a.kind === "SetMonster" || a.kind === "FusionSummon",
    );
    expect(hasHandAction).toBe(true);
  });

  it("returns nothing when it's the opponent's turn", () => {
    const s = intoMain1OnTurn1();
    const actions = legalActions(s, 1);
    expect(actions).toEqual([]);
  });

  it("during a chain window, only ChainPass / ChainRespond are legal for the priority holder", () => {
    let s = intoMain1OnTurn1();
    // Force-summon a Gemini so a chain window opens.
    const gem = s.players[0].hand.find((id) => s.cards[id]?.defId === GEMINI);
    expect(gem).toBeDefined();
    const r = reduce(s, { kind: "NormalSummon", player: 0, hand: gem!, slot: 0, position: "ATK" });
    s = r.state;
    expect(s.pendingChainWindow).not.toBeNull();
    expect(s.pendingChainWindow!.priority).toBe(1);
    const opts = legalActions(s, 1);
    expect(opts.length).toBeGreaterThan(0);
    for (const a of opts) {
      expect(["ChainPass", "ChainRespond"]).toContain(a.kind);
    }
  });

  it("AI self-play produces only legal actions and either ends or makes progress", () => {
    let s = intoMain1OnTurn1();
    let safety = 1000;
    while (!s.ended && safety-- > 0) {
      const pid = s.pendingChainWindow ? s.pendingChainWindow.priority : s.turnPlayer;
      const action = pickAction(s, pid);
      if (!action) break;
      const r = reduce(s, action);
      const rejected = r.events.find((e) => e.kind === "ActionRejected");
      if (rejected) {
        throw new Error(`AI produced rejected action ${JSON.stringify(action)}: ${rejected.error}`);
      }
      s = r.state;
    }
    // We don't strictly need the duel to finish in N steps, but we should
    // not be stuck looping without progress. If we hit the safety limit
    // without ending, that's evidence of a livelock somewhere.
    expect(safety).toBeGreaterThan(0);
  });
});
