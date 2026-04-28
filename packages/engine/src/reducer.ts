import type { Action } from "./actions.js";
import { resolveChain } from "./chain.js";
import { nextPhase, battleAllowedOnTurn } from "./phases.js";
import { mulberry32, shuffleInPlace } from "./rng.js";
import { requireCard } from "./registry.js";
import {
  createEmptyPlayer,
  opponentOf,
  type GameState,
  type PlayerState,
} from "./state.js";
import type { CardInstance, GameEvent, InstanceId, PlayerId } from "./types.js";

export interface ReduceResult {
  state: GameState;
  events: GameEvent[];
}

/**
 * Top-level reducer. Pure function: returns a new state + event log.
 * The reducer mutates a shallow clone internally for ergonomics, then
 * returns it as-if-immutable — callers must not keep the input state.
 */
export function reduce(state: GameState, action: Action): ReduceResult {
  const s = cloneState(state);
  const events: GameEvent[] = [];
  try {
    apply(s, action, events);
    s.tick += 1;
  } catch (err) {
    events.push({
      kind: "ActionRejected",
      action,
      error: (err as Error).message,
    });
    return { state, events };
  }
  return { state: s, events };
}

function apply(s: GameState, a: Action, ev: GameEvent[]): void {
  switch (a.kind) {
    case "StartDuel":
      return startDuel(s, a.decks, a.goingFirst, ev);
    case "EndPhase":
      return advancePhase(s, ev);
    case "EnterPhase":
      s.phase = a.phase;
      ev.push({ kind: "PhaseEntered", phase: a.phase });
      return;
    case "Draw":
      return drawCards(s, a.player, a.count, ev);
    case "NormalSummon":
      return normalSummon(s, a.player, a.hand, a.slot, a.position, ev);
    case "SetMonster":
      return normalSummon(s, a.player, a.hand, a.slot, "FaceDownDEF", ev);
    case "TributeSummon":
      return tributeSummon(s, a.player, a.hand, a.slot, a.tributes, a.position, ev);
    case "PlaySpell":
      return playSpell(s, a.player, a.hand, a.slot, a.faceDown, ev);
    case "SetTrap":
      return playSpell(s, a.player, a.hand, a.slot, true, ev);
    case "Concede":
      s.ended = true;
      s.winner = opponentOf(a.player);
      ev.push({ kind: "Concede", player: a.player });
      return;
    case "ResolveChain":
      resolveChain(s, ev);
      return;
    // Skeletons — filled in during MVP card work.
    case "FlipSummon":
    case "ChangePosition":
    case "ActivateEffect":
    case "DeclareAttack":
    case "SpecialSummon":
    case "ChainRespond":
    case "ChainPass":
      ev.push({ kind: "NotImplemented", action: a.kind });
      return;
  }
}

function startDuel(
  s: GameState,
  decks: { p0: number[]; p1: number[] },
  goingFirst: PlayerId,
  ev: GameEvent[],
): void {
  const rng = mulberry32(s.seed);
  const buildPlayer = (pid: PlayerId, deckIds: number[]): PlayerState => {
    const p = createEmptyPlayer(pid, s.players[pid].name);
    for (const cardId of deckIds) {
      const def = requireCard(cardId);
      const inst: CardInstance = {
        instanceId: newInstanceId(s),
        defId: def.id,
        owner: pid,
        controller: pid,
        location: { controller: pid, zone: "deck", index: 0 },
        faceUp: false,
        counters: {},
        attached: [],
        flags: {},
      };
      s.cards[inst.instanceId] = inst;
      // Extra deck kinds go straight into the extra deck.
      if (
        def.cardType === "Monster" &&
        def.kinds.some((k) => k === "Fusion" || k === "Synchro" || k === "Xyz" || k === "Link")
      ) {
        inst.location = { controller: pid, zone: "extraDeck", index: p.extraDeck.length };
        p.extraDeck.push(inst.instanceId);
      } else {
        inst.location = { controller: pid, zone: "deck", index: p.deck.length };
        p.deck.push(inst.instanceId);
      }
    }
    shuffleInPlace(p.deck, rng);
    return p;
  };

  s.players[0] = buildPlayer(0, decks.p0);
  s.players[1] = buildPlayer(1, decks.p1);
  s.turnPlayer = goingFirst;
  s.priorityHolder = goingFirst;
  s.turn = 1;
  s.phase = "Draw";

  // Opening hands: 5 cards each.
  drawCards(s, 0, 5, ev);
  drawCards(s, 1, 5, ev);
  ev.push({ kind: "DuelStarted", goingFirst });
}

function advancePhase(s: GameState, ev: GameEvent[]): void {
  const np = nextPhase(s.phase);
  if (np === null) {
    // End step → opponent's Draw
    s.turnPlayer = opponentOf(s.turnPlayer);
    s.turn += 1;
    s.phase = "Draw";
    const p = s.players[s.turnPlayer];
    p.normalSummonsUsed = 0;
    p.hasDrawnForTurn = false;
    ev.push({ kind: "TurnStarted", player: s.turnPlayer, turn: s.turn });
    // Auto-draw for turn (except first turn of going-first player per modern rules).
    if (!(s.turn === 1 && s.turnPlayer === 0)) {
      drawCards(s, s.turnPlayer, 1, ev);
      p.hasDrawnForTurn = true;
    }
    return;
  }
  if (np === "BattleStart" && !battleAllowedOnTurn(s.turn)) {
    // Skip straight to End on turn 1.
    s.phase = "End";
    ev.push({ kind: "PhaseEntered", phase: "End", reason: "no-battle-turn-1" });
    return;
  }
  s.phase = np;
  ev.push({ kind: "PhaseEntered", phase: np });
}

function drawCards(s: GameState, pid: PlayerId, count: number, ev: GameEvent[]): void {
  const p = s.players[pid];
  for (let i = 0; i < count; i++) {
    if (p.deck.length === 0) {
      s.ended = true;
      s.winner = opponentOf(pid);
      ev.push({ kind: "DeckOut", player: pid });
      return;
    }
    const id = p.deck.pop()!;
    const card = s.cards[id]!;
    card.location = { controller: pid, zone: "hand", index: p.hand.length };
    card.faceUp = false; // hand is hidden from opponent
    p.hand.push(id);
    ev.push({ kind: "Drew", player: pid, instanceId: id });
  }
}

function normalSummon(
  s: GameState,
  pid: PlayerId,
  handInstance: InstanceId,
  slot: number,
  position: import("./types.js").Position,
  ev: GameEvent[],
): void {
  if (s.phase !== "Main1" && s.phase !== "Main2") {
    throw new Error("Normal Summon only in Main Phase");
  }
  const p = s.players[pid];
  if (p.normalSummonsUsed >= p.normalSummonLimit) {
    throw new Error("Normal Summon already used this turn");
  }
  const card = s.cards[handInstance];
  if (!card || card.controller !== pid || card.location.zone !== "hand") {
    throw new Error("Card not in your hand");
  }
  const def = requireCard(card.defId);
  if (def.cardType !== "Monster") throw new Error("Not a monster");
  if (!def.level || def.level > 4) {
    throw new Error("Level > 4 requires tribute");
  }
  if (slot < 0 || slot >= 5) throw new Error("Invalid slot");
  if (p.mainMonster[slot] !== null) throw new Error("Slot occupied");

  removeFromHand(p, handInstance);
  p.mainMonster[slot] = handInstance;
  card.location = { controller: pid, zone: "mainMonster", index: slot };
  card.position = position;
  card.faceUp = position !== "FaceDownDEF";
  p.normalSummonsUsed += 1;
  ev.push({
    kind: position === "FaceDownDEF" ? "MonsterSet" : "NormalSummon",
    player: pid,
    instanceId: handInstance,
    slot,
    position,
  });
}

function tributeSummon(
  s: GameState,
  pid: PlayerId,
  handInstance: InstanceId,
  slot: number,
  tributes: InstanceId[],
  position: Exclude<import("./types.js").Position, "FaceDownDEF">,
  ev: GameEvent[],
): void {
  const p = s.players[pid];
  const card = s.cards[handInstance];
  if (!card) throw new Error("Unknown card");
  const def = requireCard(card.defId);
  if (def.cardType !== "Monster" || !def.level) throw new Error("Not a levelled monster");
  const required = def.level <= 4 ? 0 : def.level <= 6 ? 1 : def.level <= 8 ? 2 : 3;
  if (tributes.length !== required) {
    throw new Error(`Need ${required} tributes`);
  }
  for (const t of tributes) {
    const m = s.cards[t];
    if (!m || m.controller !== pid || m.location.zone !== "mainMonster") {
      throw new Error("Tribute must be your monster");
    }
    p.mainMonster[m.location.index] = null;
    m.location = { controller: pid, zone: "graveyard", index: p.graveyard.length };
    p.graveyard.push(t);
    ev.push({ kind: "Tributed", player: pid, instanceId: t });
  }
  if (p.normalSummonsUsed >= p.normalSummonLimit) {
    throw new Error("Normal Summon already used this turn");
  }
  removeFromHand(p, handInstance);
  p.mainMonster[slot] = handInstance;
  card.location = { controller: pid, zone: "mainMonster", index: slot };
  card.position = position;
  card.faceUp = true;
  p.normalSummonsUsed += 1;
  ev.push({ kind: "TributeSummon", player: pid, instanceId: handInstance, slot, position });
}

function playSpell(
  s: GameState,
  pid: PlayerId,
  handInstance: InstanceId,
  slot: number,
  faceDown: boolean,
  ev: GameEvent[],
): void {
  const p = s.players[pid];
  const card = s.cards[handInstance];
  if (!card || card.controller !== pid || card.location.zone !== "hand") {
    throw new Error("Card not in your hand");
  }
  const def = requireCard(card.defId);
  if (def.cardType !== "Spell" && def.cardType !== "Trap") {
    throw new Error("Not a Spell or Trap");
  }
  if (def.cardType === "Trap" && !faceDown) {
    throw new Error("Traps must be Set before activation");
  }
  if (slot < 0 || slot >= 5) throw new Error("Invalid slot");
  if (p.spellTrap[slot] !== null) throw new Error("Slot occupied");

  removeFromHand(p, handInstance);
  p.spellTrap[slot] = handInstance;
  card.location = { controller: pid, zone: "spellTrap", index: slot };
  card.faceUp = !faceDown;
  ev.push({
    kind: faceDown ? "CardSet" : "SpellActivated",
    player: pid,
    instanceId: handInstance,
    slot,
  });
  // Face-up Spells would trigger their activation effect here and go onto the chain.
  // Left as TODO for the MVP card-script pass.
}

function removeFromHand(p: PlayerState, id: InstanceId): void {
  const i = p.hand.indexOf(id);
  if (i < 0) throw new Error("Card not in hand");
  p.hand.splice(i, 1);
}

function newInstanceId(s: GameState): InstanceId {
  // Deterministic: derived from tick + current card count.
  return `c${s.tick}_${Object.keys(s.cards).length}`;
}

// `structuredClone` is a platform global in Node 17+ and modern browsers
// but isn't in the engine's lib (we exclude DOM to stay platform-agnostic).
declare const structuredClone: <T>(value: T) => T;

function cloneState(s: GameState): GameState {
  // Deep clone keeps the reducer honest about immutability. For hot paths
  // we can switch to immer, but for now correctness > perf.
  return structuredClone(s);
}
