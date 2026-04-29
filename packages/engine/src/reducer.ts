import type { Action } from "./actions.js";
import { getActivationEffect, pushLink, resolveChain } from "./chain.js";
import { nextPhase, battleAllowedOnTurn } from "./phases.js";
import { mulberry32, shuffleInPlace } from "./rng.js";
import { requireCard } from "./registry.js";
import {
  createEmptyPlayer,
  opponentOf,
  type GameState,
  type PlayerState,
} from "./state.js";
import type { CardInstance, GameEvent, InstanceId, MonsterDefinition, PlayerId } from "./types.js";

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
      return playSpell(s, a.player, a.hand, a.slot, a.faceDown, a.payload, ev);
    case "SetTrap":
      return playSpell(s, a.player, a.hand, a.slot, true, undefined, ev);
    case "ActivateSetSpell":
      return activateSetSpell(s, a.player, a.spellTrap, a.payload, ev);
    case "Concede":
      s.ended = true;
      s.winner = opponentOf(a.player);
      ev.push({ kind: "Concede", player: a.player });
      return;
    case "ResolveChain":
      resolveChain(s, ev);
      return;
    case "DeclareAttack":
      return declareAttack(s, a.player, a.attacker, a.target, ev);
    case "ChangePosition":
      return changePosition(s, a.player, a.monster, a.position, ev);
    case "FlipSummon":
      return flipSummon(s, a.player, a.monster, ev);
    // Skeletons — filled in during MVP card work.
    case "ActivateEffect":
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
    // Clear per-turn flags on every monster on the field.
    for (const id of Object.keys(s.cards)) {
      const c = s.cards[id]!;
      if (c.location.zone === "mainMonster" || c.location.zone === "extraMonster") {
        c.flags.hasAttacked = false;
        c.flags.positionChangedThisTurn = false;
        c.flags.summonedThisTurn = false;
      }
    }
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
  card.flags.summonedThisTurn = true;
  card.flags.hasAttacked = false;
  card.flags.positionChangedThisTurn = false;
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
  card.flags.summonedThisTurn = true;
  card.flags.hasAttacked = false;
  card.flags.positionChangedThisTurn = false;
  p.normalSummonsUsed += 1;
  ev.push({ kind: "TributeSummon", player: pid, instanceId: handInstance, slot, position });
}

function playSpell(
  s: GameState,
  pid: PlayerId,
  handInstance: InstanceId,
  slot: number,
  faceDown: boolean,
  payload: Record<string, unknown> | undefined,
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
  if (!faceDown && s.turnPlayer !== pid) {
    throw new Error("Spells can only be activated on your turn (MVP — no Quick-Play)");
  }
  if (!faceDown && def.cardType === "Spell" && def.kind === "Normal" &&
      s.phase !== "Main1" && s.phase !== "Main2") {
    throw new Error("Normal Spells activate in Main Phase");
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

  // Set cards just sit there. Face-up activations resolve immediately
  // (no chain-response window in MVP).
  if (faceDown) return;
  resolveSpellActivation(s, pid, handInstance, def, payload, ev);
}

/**
 * Activate a previously Set Spell from your own field.
 * MVP: only your turn, only Spells (Traps need a chain window).
 */
function activateSetSpell(
  s: GameState,
  pid: PlayerId,
  spellTrapInstance: InstanceId,
  payload: Record<string, unknown> | undefined,
  ev: GameEvent[],
): void {
  if (s.turnPlayer !== pid) throw new Error("Only on your turn (MVP)");
  const card = s.cards[spellTrapInstance];
  if (!card || card.controller !== pid || card.location.zone !== "spellTrap") {
    throw new Error("Card not in your Spell/Trap zone");
  }
  if (card.faceUp) throw new Error("Card already face-up");
  const def = requireCard(card.defId);
  if (def.cardType !== "Spell") {
    throw new Error("Activating face-down Traps requires a chain response window (not in MVP)");
  }
  card.faceUp = true;
  ev.push({ kind: "SpellActivated", player: pid, instanceId: spellTrapInstance, slot: card.location.index });
  resolveSpellActivation(s, pid, spellTrapInstance, def, payload, ev);
}

/**
 * Common path: push the spell's bound effect to the chain, resolve,
 * and (for Normal/Ritual Spells) send the spell to the GY afterwards.
 */
function resolveSpellActivation(
  s: GameState,
  pid: PlayerId,
  source: InstanceId,
  def: import("./types.js").CardDefinition,
  payload: Record<string, unknown> | undefined,
  ev: GameEvent[],
): void {
  if (def.cardType !== "Spell") return;
  const effectKey = getActivationEffect(def.id);
  if (effectKey) {
    pushLink(s, source, pid, 1, effectKey, payload ?? {});
    resolveChain(s, ev);
  } else {
    ev.push({ kind: "EffectFizzled", reason: "no resolver", source, defId: def.id });
  }
  // Normal/Ritual Spells go to GY after resolution. Continuous/Field/Equip remain.
  if (def.kind === "Normal" || def.kind === "Ritual") {
    sendCardToGraveyard(s, source, ev);
  }
}

function removeFromHand(p: PlayerState, id: InstanceId): void {
  const i = p.hand.indexOf(id);
  if (i < 0) throw new Error("Card not in hand");
  p.hand.splice(i, 1);
}

/**
 * Manual position change. Once per turn per monster, only in your
 * Main Phase, only on a face-up monster, never on the turn the monster
 * was Summoned, never if it has attacked this turn.
 */
function changePosition(
  s: GameState,
  pid: PlayerId,
  monsterId: InstanceId,
  position: import("./types.js").Position,
  ev: GameEvent[],
): void {
  if (s.phase !== "Main1" && s.phase !== "Main2") {
    throw new Error("Position change only in Main Phase");
  }
  if (s.turnPlayer !== pid) throw new Error("Not your turn");
  const card = s.cards[monsterId];
  if (!card) throw new Error("Unknown monster");
  if (card.controller !== pid) throw new Error("Not your monster");
  if (card.location.zone !== "mainMonster" && card.location.zone !== "extraMonster") {
    throw new Error("Monster not on the field");
  }
  if (!card.faceUp) {
    throw new Error("Cannot manually change position of a face-down monster (Flip Summon it)");
  }
  if (position !== "ATK" && position !== "DEF") {
    throw new Error("Manual position change can only set ATK or face-up DEF");
  }
  if (card.position === position) {
    throw new Error("Already in that position");
  }
  if (card.flags.summonedThisTurn === true) {
    throw new Error("Cannot change position the turn the monster was Summoned");
  }
  if (card.flags.positionChangedThisTurn === true) {
    throw new Error("Position already changed this turn");
  }
  if (card.flags.hasAttacked === true) {
    throw new Error("Cannot change position after attacking this turn");
  }
  card.position = position;
  card.flags.positionChangedThisTurn = true;
  ev.push({ kind: "PositionChanged", player: pid, instanceId: monsterId, position });
}

/**
 * Flip Summon: face-down DEF → face-up ATK. Main Phase, your turn,
 * not the turn the monster was Set. Counts as a Summon (sets
 * `summonedThisTurn`), but does NOT consume your Normal Summon.
 */
function flipSummon(
  s: GameState,
  pid: PlayerId,
  monsterId: InstanceId,
  ev: GameEvent[],
): void {
  if (s.phase !== "Main1" && s.phase !== "Main2") {
    throw new Error("Flip Summon only in Main Phase");
  }
  if (s.turnPlayer !== pid) throw new Error("Not your turn");
  const card = s.cards[monsterId];
  if (!card) throw new Error("Unknown monster");
  if (card.controller !== pid) throw new Error("Not your monster");
  if (card.location.zone !== "mainMonster") {
    throw new Error("Flip Summon target must be in your Main Monster Zone");
  }
  if (card.position !== "FaceDownDEF" || card.faceUp) {
    throw new Error("Target is not a face-down monster");
  }
  if (card.flags.summonedThisTurn === true) {
    throw new Error("Cannot Flip Summon a monster Set this turn");
  }
  card.faceUp = true;
  card.position = "ATK";
  card.flags.summonedThisTurn = true;
  card.flags.positionChangedThisTurn = false;
  card.flags.hasAttacked = false;
  ev.push({ kind: "FlipSummon", player: pid, instanceId: monsterId });
  // Real rules: Flip effects trigger here. None of our MVP cards have one.
}

/** Send a non-monster card from anywhere to its owner's Graveyard. */
function sendCardToGraveyard(
  s: GameState,
  id: InstanceId,
  ev: GameEvent[],
): void {
  const card = s.cards[id];
  if (!card) return;
  const ctrl = s.players[card.controller];
  const loc = card.location;
  if (loc.zone === "spellTrap") ctrl.spellTrap[loc.index] = null;
  else if (loc.zone === "field") ctrl.field = null;
  else if (loc.zone === "hand") {
    const i = ctrl.hand.indexOf(id);
    if (i >= 0) ctrl.hand.splice(i, 1);
  }
  card.location = {
    controller: card.owner,
    zone: "graveyard",
    index: s.players[card.owner].graveyard.length,
  };
  card.controller = card.owner;
  card.position = undefined;
  card.faceUp = true;
  s.players[card.owner].graveyard.push(id);
  ev.push({ kind: "SentToGraveyard", instanceId: id });
}

/**
 * Declare an attack with `attackerId` against `target`. `target` is
 * either a monster instance id on the opposing field, or "direct" for
 * a direct attack (legal only when the opponent controls no monsters).
 *
 * MVP scope: no chain window for attack response (no Mirror Force yet),
 * no replay step, no piercing/effect damage. Pure ATK/DEF math.
 */
function declareAttack(
  s: GameState,
  pid: PlayerId,
  attackerId: InstanceId,
  target: InstanceId | "direct",
  ev: GameEvent[],
): void {
  if (s.phase !== "BattleStep") {
    throw new Error("Attacks only during Battle Phase");
  }
  if (pid !== s.turnPlayer) throw new Error("Not your turn");
  if (!battleAllowedOnTurn(s.turn)) throw new Error("No Battle Phase on turn 1");

  const attacker = s.cards[attackerId];
  if (!attacker) throw new Error("Unknown attacker");
  if (attacker.controller !== pid) throw new Error("Not your monster");
  if (attacker.location.zone !== "mainMonster" && attacker.location.zone !== "extraMonster") {
    throw new Error("Attacker not on the field");
  }
  if (attacker.position !== "ATK" || !attacker.faceUp) {
    throw new Error("Only face-up ATK position monsters can attack");
  }
  if (attacker.flags.hasAttacked === true) {
    throw new Error("This monster has already attacked this turn");
  }
  const attackerDef = monsterDef(attacker.defId);
  const opp = opponentOf(pid);

  if (target === "direct") {
    if (opponentHasMonster(s, opp)) {
      throw new Error("Cannot attack directly while opponent controls a monster");
    }
    attacker.flags.hasAttacked = true;
    changeLp(s, opp, -attackerDef.atk, ev);
    ev.push({
      kind: "DirectAttack",
      attacker: attackerId,
      damage: attackerDef.atk,
    });
    return;
  }

  const defender = s.cards[target];
  if (!defender) throw new Error("Unknown target");
  if (defender.controller !== opp) throw new Error("Target is not opponent's monster");
  if (defender.location.zone !== "mainMonster" && defender.location.zone !== "extraMonster") {
    throw new Error("Target not on the field");
  }
  const defenderDef = monsterDef(defender.defId);

  // Face-down defenders flip face-up at the start of damage calculation.
  if (defender.position === "FaceDownDEF") {
    defender.faceUp = true;
    defender.position = "DEF";
    ev.push({ kind: "FlippedFaceUp", instanceId: target });
    // Real rules: Flip effects trigger here. MVP: no flip effects implemented.
  }

  attacker.flags.hasAttacked = true;

  if (defender.position === "ATK") {
    // ATK vs ATK
    const aATK = attackerDef.atk;
    const dATK = defenderDef.atk;
    if (aATK > dATK) {
      changeLp(s, opp, -(aATK - dATK), ev);
      destroyMonster(s, target, ev);
    } else if (aATK < dATK) {
      changeLp(s, pid, -(dATK - aATK), ev);
      destroyMonster(s, attackerId, ev);
    } else {
      // Equal: both destroyed, no damage.
      destroyMonster(s, attackerId, ev);
      destroyMonster(s, target, ev);
    }
    ev.push({
      kind: "BattleResolved",
      attacker: attackerId,
      target,
      mode: "ATKvsATK",
      attackerATK: aATK,
      targetATK: dATK,
    });
  } else {
    // ATK vs DEF (face-up DEF). No piercing in MVP.
    const aATK = attackerDef.atk;
    const dDEF = defenderDef.def ?? 0;
    if (aATK > dDEF) {
      destroyMonster(s, target, ev);
    } else if (aATK < dDEF) {
      changeLp(s, pid, -(dDEF - aATK), ev);
    }
    // Equal: nothing happens.
    ev.push({
      kind: "BattleResolved",
      attacker: attackerId,
      target,
      mode: "ATKvsDEF",
      attackerATK: aATK,
      targetDEF: dDEF,
    });
  }
}

function opponentHasMonster(s: GameState, opp: PlayerId): boolean {
  const inMain = s.players[opp].mainMonster.some((id) => id !== null);
  const inExtra = s.extraMonsterZones.some((id) => id !== null && s.cards[id]?.controller === opp);
  return inMain || inExtra;
}

function monsterDef(defId: number): MonsterDefinition {
  const def = requireCard(defId);
  if (def.cardType !== "Monster") {
    throw new Error(`Card ${defId} is not a monster`);
  }
  return def;
}

function destroyMonster(s: GameState, id: InstanceId, ev: GameEvent[]): void {
  const card = s.cards[id];
  if (!card) return;
  const owner = s.players[card.owner];
  const ctrl = s.players[card.controller];
  const loc = card.location;
  if (loc.zone === "mainMonster") {
    ctrl.mainMonster[loc.index] = null;
  } else if (loc.zone === "extraMonster") {
    s.extraMonsterZones[loc.index] = null;
  }
  // Xyz materials beneath the destroyed monster also go to GY.
  for (const matId of card.attached) {
    const mat = s.cards[matId];
    if (!mat) continue;
    mat.location = { controller: mat.owner, zone: "graveyard", index: s.players[mat.owner].graveyard.length };
    s.players[mat.owner].graveyard.push(matId);
    ev.push({ kind: "MaterialToGraveyard", instanceId: matId });
  }
  card.attached = [];
  card.location = { controller: card.owner, zone: "graveyard", index: owner.graveyard.length };
  card.controller = card.owner;
  card.position = undefined;
  card.faceUp = true;
  owner.graveyard.push(id);
  ev.push({ kind: "Destroyed", instanceId: id, by: "battle" });
}

function changeLp(s: GameState, pid: PlayerId, delta: number, ev: GameEvent[]): void {
  const p = s.players[pid];
  p.lifePoints = Math.max(0, p.lifePoints + delta);
  ev.push({ kind: "LifePointsChanged", player: pid, delta, total: p.lifePoints });
  if (p.lifePoints === 0 && !s.ended) {
    s.ended = true;
    s.winner = opponentOf(pid);
    ev.push({ kind: "Victory", player: s.winner, reason: "LP to 0" });
  }
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
