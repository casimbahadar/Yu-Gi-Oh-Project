import { describe, it, expect } from "vitest";
import {
  createInitialState,
  reduce,
  type Action,
  type GameState,
  type InstanceId,
} from "../src/index.js";
import "../src/cards/index.js";
import { plantInHand, play } from "./helpers.js";

const GEMINI = 69140098;
const ASH = 14558127;
const POT = 53129443;
const RAIGEKI = 12580477;
const MIRROR = 44095762;
const SOLEMN = 41420027;
const BEWD = 89631139;

function deck(): number[] {
  const pool = [GEMINI, GEMINI, GEMINI, ASH, POT, RAIGEKI, MIRROR, SOLEMN, BEWD, BEWD];
  const out: number[] = [];
  while (out.length < 40) out.push(...pool);
  return out.slice(0, 40);
}

function step(s: GameState, a: Action): GameState {
  return play(s, a).state;
}

function endTurn(s: GameState): GameState {
  while (s.phase !== "End") s = step(s, { kind: "EndPhase" });
  return step(s, { kind: "EndPhase" }); // End -> next turn's Draw
}

/** End all phases until p0 is sitting in BattleStep on turn 3. */
function intoP0BattleStepTurn3(): GameState {
  let s = createInitialState(2025, "A", "B");
  ({ state: s } = reduce(s, { kind: "StartDuel", decks: { p0: deck(), p1: deck() }, goingFirst: 0 }));
  s = endTurn(s); // turn 1 -> turn 2
  s = endTurn(s); // turn 2 -> turn 3
  s = step(s, { kind: "EndPhase" }); // Draw -> Standby
  s = step(s, { kind: "EndPhase" }); // Standby -> Main1
  s = step(s, { kind: "EndPhase" }); // Main1 -> BattleStart
  s = step(s, { kind: "EndPhase" }); // BattleStart -> BattleStep
  if (s.phase !== "BattleStep") throw new Error(`expected BattleStep, got ${s.phase}`);
  return s;
}

describe("engine: chain windows — Mirror Force", () => {
  it("destroys the attacker (in ATK) when activated against an attack declaration", () => {
    let s = intoP0BattleStepTurn3();
    // Plant attacker for p0 and Mirror Force face-down for p1 (set on a previous turn).
    const attacker = plantInHand(s, BEWD, 0);
    s.players[0].hand.splice(s.players[0].hand.indexOf(attacker), 1);
    s.players[0].mainMonster[0] = attacker;
    s.cards[attacker]!.location = { controller: 0, zone: "mainMonster", index: 0 };
    s.cards[attacker]!.position = "ATK";
    s.cards[attacker]!.faceUp = true;

    const mirror: InstanceId = plantInHand(s, MIRROR, 1);
    s.players[1].hand.splice(s.players[1].hand.indexOf(mirror), 1);
    s.players[1].spellTrap[0] = mirror;
    s.cards[mirror]!.location = { controller: 1, zone: "spellTrap", index: 0 };
    s.cards[mirror]!.faceUp = false;
    s.cards[mirror]!.flags.setThisTurn = false; // pretend it was set last turn

    // Plant a defender for p1 so direct attack isn't legal.
    const defender = plantInHand(s, GEMINI, 1);
    s.players[1].hand.splice(s.players[1].hand.indexOf(defender), 1);
    s.players[1].mainMonster[0] = defender;
    s.cards[defender]!.location = { controller: 1, zone: "mainMonster", index: 0 };
    s.cards[defender]!.position = "DEF";
    s.cards[defender]!.faceUp = true;

    // p0 declares attack — chain window opens for p1.
    let r = reduce(s, { kind: "DeclareAttack", player: 0, attacker, target: defender });
    s = r.state;
    expect(s.pendingChainWindow?.trigger.kind).toBe("AttackDeclared");
    expect(s.pendingChainWindow?.priority).toBe(1);

    // p1 activates Mirror Force.
    r = reduce(s, {
      kind: "ChainRespond",
      player: 1,
      source: mirror,
      effectKey: "trap:mirror-force:resolve",
    });
    s = r.state;
    expect(s.cards[mirror]!.faceUp).toBe(true);
    expect(s.chain.length).toBe(1);
    expect(s.pendingChainWindow?.priority).toBe(0);

    // Both pass to resolve.
    r = reduce(s, { kind: "ChainPass", player: 0 });
    s = r.state;
    r = reduce(s, { kind: "ChainPass", player: 1 });
    s = r.state;

    // Mirror Force resolved: attacker destroyed, no damage step ran.
    expect(s.pendingChainWindow).toBeNull();
    expect(s.cards[attacker]!.location.zone).toBe("graveyard");
    expect(s.cards[defender]!.location.zone).toBe("mainMonster"); // not the attack target outcome
    expect(s.players[1].lifePoints).toBe(8000); // no damage
  });
});

describe("engine: chain windows — Solemn Judgment", () => {
  it("negates a Normal Summon at the cost of half LP, and destroys the summoned monster", () => {
    // Set Solemn for p1 on turn 2; p0's turn 3 Normal Summon → Solemn negates.
    let s = createInitialState(7, "A", "B");
    ({ state: s } = reduce(s, { kind: "StartDuel", decks: { p0: deck(), p1: deck() }, goingFirst: 0 }));
    s = endTurn(s); // turn 1 -> turn 2
    s = step(s, { kind: "EndPhase" }); // Draw -> Standby
    s = step(s, { kind: "EndPhase" }); // Standby -> Main1
    const solemn = plantInHand(s, SOLEMN, 1);
    s = step(s, { kind: "SetTrap", player: 1, hand: solemn, slot: 0 });
    expect(s.cards[solemn]!.faceUp).toBe(false);
    s = endTurn(s); // turn 2 -> turn 3
    expect(s.cards[solemn]!.flags.setThisTurn).toBe(false);

    s = step(s, { kind: "EndPhase" }); // Draw -> Standby
    s = step(s, { kind: "EndPhase" }); // Standby -> Main1

    // p0 Normal Summons Gemini Elf → window opens for p1.
    const gem = plantInHand(s, GEMINI, 0);
    let r = reduce(s, { kind: "NormalSummon", player: 0, hand: gem, slot: 2, position: "ATK" });
    s = r.state;
    expect(s.pendingChainWindow?.trigger.kind).toBe("Summoned");

    // p1 activates Solemn Judgment.
    r = reduce(s, {
      kind: "ChainRespond",
      player: 1,
      source: solemn,
      effectKey: "trap:solemn-judgment:resolve",
    });
    s = r.state;
    expect(s.players[1].lifePoints).toBe(4000); // paid half
    expect(s.chain.length).toBe(1);

    // Both pass.
    s = reduce(s, { kind: "ChainPass", player: 0 }).state;
    s = reduce(s, { kind: "ChainPass", player: 1 }).state;

    expect(s.pendingChainWindow).toBeNull();
    expect(s.cards[gem]!.location.zone).toBe("graveyard");
  });

  it("negates a Normal Spell, sending it to the GY without effect", () => {
    let s = createInitialState(13, "A", "B");
    ({ state: s } = reduce(s, { kind: "StartDuel", decks: { p0: deck(), p1: deck() }, goingFirst: 0 }));
    s = endTurn(s);
    s = step(s, { kind: "EndPhase" });
    s = step(s, { kind: "EndPhase" });
    const solemn = plantInHand(s, SOLEMN, 1);
    s = step(s, { kind: "SetTrap", player: 1, hand: solemn, slot: 0 });
    s = endTurn(s);
    s = step(s, { kind: "EndPhase" });
    s = step(s, { kind: "EndPhase" });

    const handBefore = s.players[0].hand.length;
    const pot = plantInHand(s, POT, 0);
    let r = reduce(s, { kind: "PlaySpell", player: 0, hand: pot, slot: 0, faceDown: false });
    s = r.state;
    // Window open at top of chain (Pot's link is link 1).
    expect(s.chain.length).toBe(1);

    r = reduce(s, {
      kind: "ChainRespond",
      player: 1,
      source: solemn,
      effectKey: "trap:solemn-judgment:resolve",
    });
    s = r.state;
    expect(s.chain.length).toBe(2);

    // Both pass — Solemn resolves first (link 2 → marks pot's link negated),
    // then Pot link is popped but is negated, so no draw.
    s = reduce(s, { kind: "ChainPass", player: 0 }).state;
    s = reduce(s, { kind: "ChainPass", player: 1 }).state;

    // Pot was negated → no extra cards drawn (hand only changed by removing Pot).
    expect(s.players[0].hand.length).toBe(handBefore - 1);
    expect(s.cards[pot]!.location.zone).toBe("graveyard");
  });
});
