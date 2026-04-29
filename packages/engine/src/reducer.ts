import type { Action } from "./actions.js";
import {
  getActivationEffect,
  getResponder,
  pushLink,
  resolveChain,
} from "./chain.js";
import { nextPhase, battleAllowedOnTurn } from "./phases.js";
import { mulberry32, shuffleInPlace } from "./rng.js";
import { requireCard } from "./registry.js";
import {
  createEmptyPlayer,
  opponentOf,
  type GameState,
  type PlayerState,
} from "./state.js";
import type {
  CardInstance,
  ChainTrigger,
  GameEvent,
  InstanceId,
  MonsterDefinition,
  PlayerId,
} from "./types.js";

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
    ensureNoOpenChainWindow(s, action);
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
    case "ChainRespond":
      return chainRespond(s, a.player, a.source, a.effectKey, a.payload, ev);
    case "ChainPass":
      return chainPass(s, a.player, ev);
    case "FusionSummon":
      return fusionSummon(s, a.player, a.polymerization, a.fusionMonster, a.materials, a.slot, a.position, ev);
    // Skeletons — filled in during MVP card work.
    case "ActivateEffect":
    case "SpecialSummon":
      ev.push({ kind: "NotImplemented", action: a.kind });
      return;
  }
}

/**
 * Reject most actions while a chain window is open. Only ChainRespond,
 * ChainPass, and Concede are allowed.
 */
function ensureNoOpenChainWindow(s: GameState, a: Action): void {
  if (!s.pendingChainWindow) return;
  if (a.kind === "ChainRespond" || a.kind === "ChainPass" || a.kind === "Concede") return;
  throw new Error(`A chain window is open; respond or pass first.`);
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
    // Clear per-turn flags on every monster on the field, and let any
    // Set Spell/Trap become activatable now that a turn has elapsed.
    for (const id of Object.keys(s.cards)) {
      const c = s.cards[id]!;
      if (c.location.zone === "mainMonster" || c.location.zone === "extraMonster") {
        c.flags.hasAttacked = false;
        c.flags.positionChangedThisTurn = false;
        c.flags.summonedThisTurn = false;
      }
      if (c.location.zone === "spellTrap") {
        c.flags.setThisTurn = false;
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
  // Set Monster (face-down) is not a Summon for chain-trigger purposes.
  if (position !== "FaceDownDEF") {
    openChainWindow(s, {
      kind: "Summoned",
      summonType: "Normal",
      player: pid,
      instanceId: handInstance,
    }, ev);
  }
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
  openChainWindow(s, {
    kind: "Summoned",
    summonType: "Tribute",
    player: pid,
    instanceId: handInstance,
  }, ev);
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
  if (faceDown) card.flags.setThisTurn = true;
  ev.push({
    kind: faceDown ? "CardSet" : "SpellActivated",
    player: pid,
    instanceId: handInstance,
    slot,
  });

  // Set cards just sit there until activated. Face-up activations open
  // a chain window via resolveSpellActivation.
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
 * Common path: push the spell's bound effect to the chain as link 1,
 * then open a chain window so the opponent can respond (e.g. Solemn
 * Judgment to negate). When the window resolves, the spell's effect
 * runs (unless negated). Normal/Ritual spells go to GY at window close.
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
  if (!effectKey) {
    ev.push({ kind: "EffectFizzled", reason: "no resolver", source, defId: def.id });
    if (def.kind === "Normal" || def.kind === "Ritual") {
      sendCardToGraveyard(s, source, ev);
    }
    return;
  }
  pushLink(s, source, pid, 1, effectKey, payload ?? {});
  ev.push({ kind: "ChainLinkAdded", source, effectKey, link: s.chain.length });
  openChainWindow(s, { kind: "SpellActivated", player: pid, source }, ev);
  // sendCardToGraveyard for Normal/Ritual happens when the window closes
  // (see closeChainWindow).
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
  openChainWindow(s, {
    kind: "Summoned",
    summonType: "Flip",
    player: pid,
    instanceId: monsterId,
  }, ev);
  // Real rules: Flip effects trigger here. None of our MVP cards have one.
}

/**
 * Polymerization-style Fusion Summon. The Polymerization spell goes to
 * the GY, the listed materials go to the GY, and the Fusion Monster is
 * Special Summoned from the Extra Deck face-up to the chosen Main Monster
 * Zone in the requested position. Opens a chain window for the summon.
 *
 * Material matching: name-multiset equality against the Fusion's
 * `fusionMaterials`. If the Fusion has no listed materials, any 2+
 * monsters are accepted (a deliberate fallback for the curated cards).
 */
function fusionSummon(
  s: GameState,
  pid: PlayerId,
  polymerizationId: InstanceId,
  fusionMonsterId: InstanceId,
  materials: InstanceId[],
  slot: number,
  position: import("./types.js").Position,
  ev: GameEvent[],
): void {
  if (s.phase !== "Main1" && s.phase !== "Main2") {
    throw new Error("Fusion Summon only in Main Phase");
  }
  if (s.turnPlayer !== pid) throw new Error("Not your turn");
  const me = s.players[pid];
  if (slot < 0 || slot >= 5) throw new Error("Invalid slot");
  if (me.mainMonster[slot] !== null) throw new Error("Monster zone occupied");
  if (position !== "ATK" && position !== "DEF") {
    throw new Error("Fusion Summon must be face-up ATK or DEF");
  }

  // Polymerization must be a Normal Spell in this player's hand or face-down on field.
  const poly = s.cards[polymerizationId];
  if (!poly) throw new Error("Polymerization not found");
  if (poly.controller !== pid) throw new Error("Polymerization isn't yours");
  const polyDef = requireCard(poly.defId);
  if (polyDef.cardType !== "Spell" || polyDef.id !== 24094653) {
    throw new Error("Card provided is not Polymerization");
  }
  if (poly.location.zone !== "hand" && poly.location.zone !== "spellTrap") {
    throw new Error("Polymerization must be in your hand or face-down on the field");
  }

  // Fusion target must be in this player's extra deck.
  const fusion = s.cards[fusionMonsterId];
  if (!fusion) throw new Error("Fusion monster not found");
  if (fusion.owner !== pid || fusion.location.zone !== "extraDeck") {
    throw new Error("Fusion monster must be in your Extra Deck");
  }
  const fusionDef = requireCard(fusion.defId);
  if (fusionDef.cardType !== "Monster" || !fusionDef.kinds.includes("Fusion")) {
    throw new Error("Target is not a Fusion monster");
  }

  // Validate material count and (if listed) names.
  if (materials.length < 2) throw new Error("Need at least 2 Fusion Materials");
  if (fusionDef.fusionMaterials && fusionDef.fusionMaterials.length > 0) {
    if (materials.length !== fusionDef.fusionMaterials.length) {
      throw new Error(`Need exactly ${fusionDef.fusionMaterials.length} materials`);
    }
    const required = [...fusionDef.fusionMaterials].sort();
    const actualNames: string[] = [];
    for (const m of materials) {
      const card = s.cards[m];
      if (!card) throw new Error("Unknown material");
      try { actualNames.push(requireCard(card.defId).name); }
      catch { throw new Error("Unknown material"); }
    }
    actualNames.sort();
    for (let i = 0; i < required.length; i++) {
      if (required[i] !== actualNames[i]) {
        throw new Error(`Material mismatch: need ${required.join(", ")}`);
      }
    }
  }

  // Verify each material is a monster controlled by `pid` and on hand or field.
  for (const m of materials) {
    const card = s.cards[m];
    if (!card) throw new Error("Material missing");
    if (card.controller !== pid) throw new Error("Material isn't yours");
    if (card.location.zone !== "hand" && card.location.zone !== "mainMonster") {
      throw new Error("Materials must be in your hand or on your field");
    }
    try {
      if (requireCard(card.defId).cardType !== "Monster") {
        throw new Error("Material must be a monster");
      }
    } catch {
      throw new Error("Unknown material");
    }
  }

  // Send Polymerization to GY, then materials, then Special Summon Fusion.
  sendCardToGraveyard(s, polymerizationId, ev);
  for (const m of materials) sendCardToGraveyard(s, m, ev);

  // Place fusion in main monster zone.
  const extraIdx = me.extraDeck.indexOf(fusionMonsterId);
  if (extraIdx >= 0) me.extraDeck.splice(extraIdx, 1);
  me.mainMonster[slot] = fusionMonsterId;
  fusion.controller = pid;
  fusion.location = { controller: pid, zone: "mainMonster", index: slot };
  fusion.position = position;
  fusion.faceUp = true;
  fusion.flags.summonedThisTurn = true;
  fusion.flags.hasAttacked = false;
  fusion.flags.positionChangedThisTurn = false;
  ev.push({
    kind: "FusionSummon",
    player: pid,
    instanceId: fusionMonsterId,
    materials,
    slot,
    position,
  });
  openChainWindow(s, {
    kind: "Summoned",
    summonType: "Special",
    player: pid,
    instanceId: fusionMonsterId,
  }, ev);
}

/** Send a card from any zone to its owner's Graveyard (without destroying). */
function sendCardToGraveyard(
  s: GameState,
  id: InstanceId,
  ev: GameEvent[],
): void {
  const card = s.cards[id];
  if (!card) return;
  const ctrl = s.players[card.controller];
  const loc = card.location;
  switch (loc.zone) {
    case "spellTrap": ctrl.spellTrap[loc.index] = null; break;
    case "field": ctrl.field = null; break;
    case "mainMonster": ctrl.mainMonster[loc.index] = null; break;
    case "extraMonster": s.extraMonsterZones[loc.index] = null; break;
    case "hand": {
      const i = ctrl.hand.indexOf(id);
      if (i >= 0) ctrl.hand.splice(i, 1);
      break;
    }
    default: break;
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
 * Declare an attack with `attackerId` against `target`. After validation
 * we open a chain window so the opponent can respond with traps like
 * Mirror Force. The actual damage step runs when the window resolves.
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
  const opp = opponentOf(pid);

  if (target === "direct") {
    if (opponentHasMonster(s, opp)) {
      throw new Error("Cannot attack directly while opponent controls a monster");
    }
  } else {
    const defender = s.cards[target];
    if (!defender) throw new Error("Unknown target");
    if (defender.controller !== opp) throw new Error("Target is not opponent's monster");
    if (defender.location.zone !== "mainMonster" && defender.location.zone !== "extraMonster") {
      throw new Error("Target not on the field");
    }
  }

  // Attack declaration sticks even if cancelled: this monster has used
  // its attack for the turn (Yu-Gi-Oh rules — declaration counts).
  attacker.flags.hasAttacked = true;
  ev.push({ kind: "AttackDeclared", attacker: attackerId, target, attackingPlayer: pid });

  // Open the chain window. Defending player gets the first chance to
  // respond. If both pass with no chain links, damage step runs.
  openChainWindow(s, {
    kind: "AttackDeclared",
    attackingPlayer: pid,
    attacker: attackerId,
    target,
  }, ev);
}

/**
 * Resolve the deferred damage step from an AttackDeclared chain window
 * once it closes. Skipped if the trigger was negated (e.g., a Counter
 * Trap negated the attack) or if the attacker no longer exists / is
 * no longer in face-up ATK position.
 */
function performAttackDamageStep(
  s: GameState,
  attackerId: InstanceId,
  target: InstanceId | "direct",
  attackingPlayer: PlayerId,
  ev: GameEvent[],
): void {
  const attacker = s.cards[attackerId];
  if (!attacker) {
    ev.push({ kind: "AttackFizzled", reason: "attacker missing" });
    return;
  }
  if (
    attacker.location.zone !== "mainMonster" &&
    attacker.location.zone !== "extraMonster"
  ) {
    ev.push({ kind: "AttackFizzled", reason: "attacker no longer on field" });
    return;
  }
  if (!attacker.faceUp || attacker.position !== "ATK") {
    ev.push({ kind: "AttackFizzled", reason: "attacker no longer face-up ATK" });
    return;
  }
  const attackerDef = monsterDef(attacker.defId);
  const opp = opponentOf(attackingPlayer);

  if (target === "direct") {
    if (opponentHasMonster(s, opp)) {
      // Opponent summoned a blocker mid-chain — direct attack fizzles.
      ev.push({ kind: "AttackFizzled", reason: "opponent now has monsters" });
      return;
    }
    changeLp(s, opp, -attackerDef.atk, ev);
    ev.push({ kind: "DirectAttack", attacker: attackerId, damage: attackerDef.atk });
    return;
  }

  const defender = s.cards[target];
  if (
    !defender ||
    (defender.location.zone !== "mainMonster" && defender.location.zone !== "extraMonster")
  ) {
    // Replay step in real rules; MVP just fizzles.
    ev.push({ kind: "AttackFizzled", reason: "target no longer on field" });
    return;
  }
  const defenderDef = monsterDef(defender.defId);

  if (defender.position === "FaceDownDEF") {
    defender.faceUp = true;
    defender.position = "DEF";
    ev.push({ kind: "FlippedFaceUp", instanceId: target });
  }

  if (defender.position === "ATK") {
    const aATK = attackerDef.atk;
    const dATK = defenderDef.atk;
    if (aATK > dATK) {
      changeLp(s, opp, -(aATK - dATK), ev);
      destroyMonster(s, target, ev);
    } else if (aATK < dATK) {
      changeLp(s, attackingPlayer, -(dATK - aATK), ev);
      destroyMonster(s, attackerId, ev);
    } else {
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
    const aATK = attackerDef.atk;
    const dDEF = defenderDef.def ?? 0;
    if (aATK > dDEF) {
      destroyMonster(s, target, ev);
    } else if (aATK < dDEF) {
      changeLp(s, attackingPlayer, -(dDEF - aATK), ev);
    }
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

/**
 * Open a chain window. Defending / non-acting player gets first
 * priority. The window tracks consecutive passes; two in a row without
 * an activation in between resolve the chain and execute deferred work.
 */
function openChainWindow(s: GameState, trigger: ChainTrigger, ev: GameEvent[]): void {
  const acting =
    trigger.kind === "AttackDeclared" ? trigger.attackingPlayer
    : trigger.kind === "Summoned" ? trigger.player
    : trigger.player;
  s.pendingChainWindow = {
    trigger,
    priority: opponentOf(acting),
    consecutivePasses: 0,
    triggerNegated: false,
  };
  ev.push({ kind: "ChainWindowOpened", trigger });
}

function chainRespond(
  s: GameState,
  pid: PlayerId,
  sourceId: InstanceId,
  effectKey: string,
  payload: Record<string, unknown> | undefined,
  ev: GameEvent[],
): void {
  const w = s.pendingChainWindow;
  if (!w) throw new Error("No chain window is open");
  if (w.priority !== pid) throw new Error("Not your priority");
  const card = s.cards[sourceId];
  if (!card) throw new Error("Unknown source card");
  if (card.controller !== pid) throw new Error("Not your card");
  const def = requireCard(card.defId);

  // Validate the responder. Card must be a registered chain responder
  // and its predicate must accept the current trigger.
  const reg = getResponder(def.id);
  if (!reg) throw new Error(`${def.name} is not a chain responder`);
  if (reg.effectKey !== effectKey) {
    throw new Error(`Effect key mismatch for ${def.name}`);
  }
  if (!reg.canRespond(w.trigger, s, card)) {
    throw new Error(`${def.name} cannot respond to this trigger`);
  }
  // Spell Speed gate vs the current top of chain.
  const top = s.chain[s.chain.length - 1];
  if (top && reg.spellSpeed < top.spellSpeed) {
    throw new Error(`${def.name} (Spell Speed ${reg.spellSpeed}) cannot respond to Spell Speed ${top.spellSpeed}`);
  }
  // Traps: must be face-down on field, not just-set this turn.
  if (def.cardType === "Trap") {
    if (card.location.zone !== "spellTrap" || card.faceUp) {
      throw new Error("Trap is not Set on the field");
    }
    if (card.flags.setThisTurn === true && reg.ignoreSetThisTurn !== true) {
      throw new Error("Cannot activate a Trap the turn it was Set");
    }
    card.faceUp = true;
    ev.push({ kind: "TrapActivated", instanceId: sourceId, player: pid });
  }

  if (reg.onActivate) reg.onActivate(s, card, ev);
  pushLink(s, sourceId, pid, reg.spellSpeed, effectKey, payload ?? {});
  ev.push({ kind: "ChainLinkAdded", source: sourceId, effectKey, link: s.chain.length });

  w.consecutivePasses = 0;
  w.priority = opponentOf(pid);
}

function chainPass(s: GameState, pid: PlayerId, ev: GameEvent[]): void {
  const w = s.pendingChainWindow;
  if (!w) throw new Error("No chain window is open");
  if (w.priority !== pid) throw new Error("Not your priority");
  w.consecutivePasses += 1;
  ev.push({ kind: "ChainPass", player: pid });

  if (w.consecutivePasses >= 2) {
    // Both players passed → resolve the chain, then handle deferred work.
    closeChainWindow(s, ev);
  } else {
    w.priority = opponentOf(pid);
  }
}

/** Resolve any chain links and perform the deferred trigger action. */
function closeChainWindow(s: GameState, ev: GameEvent[]): void {
  const w = s.pendingChainWindow;
  if (!w) return;
  resolveChain(s, ev);
  const trigger = w.trigger;
  const negated = w.triggerNegated;
  s.pendingChainWindow = null;
  ev.push({ kind: "ChainWindowClosed", negated });

  switch (trigger.kind) {
    case "AttackDeclared":
      // Skip the damage step if the attack was negated by a Counter Trap.
      if (!negated) {
        performAttackDamageStep(
          s,
          trigger.attacker,
          trigger.target,
          trigger.attackingPlayer,
          ev,
        );
      }
      return;
    case "Summoned":
      // The summon already happened. If it had been negated, the
      // negating effect (e.g., Solemn Judgment) destroyed the monster.
      // Nothing else to do here.
      return;
    case "SpellActivated": {
      // Send Normal/Ritual Spells to the GY whether or not the activation
      // was negated. Continuous/Field/Equip remain face-up on the field.
      const card = s.cards[trigger.source];
      if (card) {
        try {
          const def = requireCard(card.defId);
          if (def.cardType === "Spell" && (def.kind === "Normal" || def.kind === "Ritual")) {
            sendCardToGraveyard(s, trigger.source, ev);
          }
        } catch { /* unknown */ }
      }
      return;
    }
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
