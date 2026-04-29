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
    case "SynchroSummon":
      return synchroSummon(s, a.player, a.synchroMonster, a.tuner, a.nonTuners, a.slot, a.position, a.useExtraMonsterZone, ev);
    case "XyzSummon":
      return xyzSummon(s, a.player, a.xyzMonster, a.materials, a.slot, a.position, a.useExtraMonsterZone, ev);
    case "LinkSummon":
      return linkSummon(s, a.player, a.linkMonster, a.materials, a.extraMonsterZone, ev);
    case "RitualSummon":
      return ritualSummon(s, a.player, a.ritualSpell, a.ritualMonster, a.tributes, a.slot, a.position, ev);
    case "SetPendulumScale":
      return setPendulumScale(s, a.player, a.hand, a.side, ev);
    case "PendulumSummon":
      return pendulumSummon(s, a.player, a.monsters, ev);
    case "EquipSpell":
      return equipSpell(s, a.player, a.spell, a.target, ev);
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

/**
 * Synchro Summon: 1 Tuner + 1+ non-Tuners on your field whose Levels
 * sum to the Synchro monster's Level. Materials → GY. Summon to a Main
 * Monster Zone (or Extra Monster Zone if requested).
 */
function synchroSummon(
  s: GameState,
  pid: PlayerId,
  synchroMonsterId: InstanceId,
  tunerId: InstanceId,
  nonTunerIds: InstanceId[],
  slot: number,
  position: Exclude<import("./types.js").Position, "FaceDownDEF">,
  useEmz: 0 | 1 | undefined,
  ev: GameEvent[],
): void {
  if (s.phase !== "Main1" && s.phase !== "Main2") {
    throw new Error("Synchro Summon only in Main Phase");
  }
  if (s.turnPlayer !== pid) throw new Error("Not your turn");

  const synchro = s.cards[synchroMonsterId];
  if (!synchro) throw new Error("Synchro monster not found");
  if (synchro.owner !== pid || synchro.location.zone !== "extraDeck") {
    throw new Error("Synchro monster must be in your Extra Deck");
  }
  const synchroDef = requireCard(synchro.defId);
  if (synchroDef.cardType !== "Monster" || !synchroDef.kinds.includes("Synchro")) {
    throw new Error("Target is not a Synchro monster");
  }
  if (!synchroDef.level) throw new Error("Synchro monster has no Level");

  const tuner = s.cards[tunerId];
  if (!tuner) throw new Error("Tuner not found");
  const tunerDef = requireCard(tuner.defId);
  if (tunerDef.cardType !== "Monster" || tunerDef.isTuner !== true) {
    throw new Error("Provided card is not a Tuner");
  }
  if (tuner.controller !== pid || tuner.location.zone !== "mainMonster" || !tuner.faceUp) {
    throw new Error("Tuner must be face-up on your field");
  }
  if (nonTunerIds.length === 0) throw new Error("Synchro requires at least one non-Tuner");

  let levelSum = tunerDef.level ?? 0;
  for (const id of nonTunerIds) {
    const m = s.cards[id];
    if (!m) throw new Error("Material missing");
    if (m.controller !== pid || m.location.zone !== "mainMonster" || !m.faceUp) {
      throw new Error("Materials must be face-up monsters on your field");
    }
    const md = requireCard(m.defId);
    if (md.cardType !== "Monster") throw new Error("Material must be a monster");
    if (md.isTuner === true) throw new Error("Synchro can have only one Tuner material");
    levelSum += md.level ?? 0;
  }
  if (levelSum !== synchroDef.level) {
    throw new Error(`Synchro Levels must sum to ${synchroDef.level}, got ${levelSum}`);
  }

  // Send materials to GY.
  sendCardToGraveyard(s, tunerId, ev);
  for (const m of nonTunerIds) sendCardToGraveyard(s, m, ev);

  placeExtraDeckMonster(s, pid, synchroMonsterId, slot, position, useEmz, "Synchro", ev);
}

/**
 * Xyz Summon: 2+ monsters of the same Level matching the Xyz's Rank.
 * Materials are attached beneath the Xyz monster (still on field, but
 * tracked as Xyz Materials in `attached`), not sent to GY.
 */
function xyzSummon(
  s: GameState,
  pid: PlayerId,
  xyzMonsterId: InstanceId,
  materialIds: InstanceId[],
  slot: number,
  position: Exclude<import("./types.js").Position, "FaceDownDEF">,
  useEmz: 0 | 1 | undefined,
  ev: GameEvent[],
): void {
  if (s.phase !== "Main1" && s.phase !== "Main2") throw new Error("Xyz Summon only in Main Phase");
  if (s.turnPlayer !== pid) throw new Error("Not your turn");
  const xyz = s.cards[xyzMonsterId];
  if (!xyz) throw new Error("Xyz monster not found");
  if (xyz.owner !== pid || xyz.location.zone !== "extraDeck") {
    throw new Error("Xyz monster must be in your Extra Deck");
  }
  const xyzDef = requireCard(xyz.defId);
  if (xyzDef.cardType !== "Monster" || !xyzDef.kinds.includes("Xyz")) {
    throw new Error("Target is not an Xyz monster");
  }
  if (xyzDef.rank === undefined) throw new Error("Xyz monster has no Rank");
  if (materialIds.length < 2) throw new Error("Need at least 2 Xyz Materials");

  let sharedLevel: number | null = null;
  for (const id of materialIds) {
    const m = s.cards[id];
    if (!m) throw new Error("Material missing");
    if (m.controller !== pid || m.location.zone !== "mainMonster" || !m.faceUp) {
      throw new Error("Materials must be face-up monsters on your field");
    }
    const md = requireCard(m.defId);
    if (md.cardType !== "Monster" || md.level === undefined) {
      throw new Error("Material must be a monster with a Level");
    }
    if (sharedLevel === null) sharedLevel = md.level;
    else if (md.level !== sharedLevel) throw new Error("All Xyz Materials must share a Level");
  }
  if (sharedLevel !== xyzDef.rank) {
    throw new Error(`Xyz Materials' Level (${sharedLevel}) must match Rank (${xyzDef.rank})`);
  }

  // Detach materials from their zones — they get attached beneath the Xyz.
  for (const id of materialIds) {
    const m = s.cards[id]!;
    if (m.location.zone === "mainMonster") {
      s.players[pid].mainMonster[m.location.index] = null;
    } else if (m.location.zone === "extraMonster") {
      s.extraMonsterZones[m.location.index] = null;
    }
    m.location = { controller: pid, zone: "mainMonster", index: -1 }; // marker — held as material
    m.position = undefined;
    m.faceUp = false;
  }

  placeExtraDeckMonster(s, pid, xyzMonsterId, slot, position, useEmz, "Xyz", ev);
  // Attach materials beneath.
  xyz.attached = [...xyz.attached, ...materialIds];
  ev.push({ kind: "XyzMaterialsAttached", xyz: xyzMonsterId, materials: materialIds });
}

/**
 * Link Summon: monsters totaling the Link Rating, sent to the GY.
 * Must be summoned to an Extra Monster Zone (the simplification — real
 * rules also allow zones a Link arrow points to).
 */
function linkSummon(
  s: GameState,
  pid: PlayerId,
  linkMonsterId: InstanceId,
  materialIds: InstanceId[],
  emz: 0 | 1,
  ev: GameEvent[],
): void {
  if (s.phase !== "Main1" && s.phase !== "Main2") throw new Error("Link Summon only in Main Phase");
  if (s.turnPlayer !== pid) throw new Error("Not your turn");
  const link = s.cards[linkMonsterId];
  if (!link) throw new Error("Link monster not found");
  if (link.owner !== pid || link.location.zone !== "extraDeck") {
    throw new Error("Link monster must be in your Extra Deck");
  }
  const linkDef = requireCard(link.defId);
  if (linkDef.cardType !== "Monster" || !linkDef.kinds.includes("Link")) {
    throw new Error("Target is not a Link monster");
  }
  const linkRating = linkDef.linkRating ?? 0;
  if (materialIds.length === 0) throw new Error("Need at least one material");
  // Materials count toward link rating: each non-Link counts as 1, Link
  // monsters count as their Link Rating. Total must equal linkRating.
  let total = 0;
  for (const id of materialIds) {
    const m = s.cards[id];
    if (!m) throw new Error("Material missing");
    if (m.controller !== pid || (m.location.zone !== "mainMonster" && m.location.zone !== "extraMonster") || !m.faceUp) {
      throw new Error("Materials must be face-up monsters on your field");
    }
    const md = requireCard(m.defId);
    if (md.cardType !== "Monster") throw new Error("Material must be a monster");
    total += md.kinds.includes("Link") ? (md.linkRating ?? 1) : 1;
  }
  if (total !== linkRating) {
    throw new Error(`Materials total (${total}) must equal Link Rating (${linkRating})`);
  }

  if (s.extraMonsterZones[emz] !== null) throw new Error("Extra Monster Zone occupied");

  for (const m of materialIds) sendCardToGraveyard(s, m, ev);

  // Place in EMZ (special-cased below — not via placeExtraDeckMonster).
  const me = s.players[pid];
  const idx = me.extraDeck.indexOf(linkMonsterId);
  if (idx >= 0) me.extraDeck.splice(idx, 1);
  s.extraMonsterZones[emz] = linkMonsterId;
  link.controller = pid;
  link.location = { controller: pid, zone: "extraMonster", index: emz };
  link.position = "ATK"; // Link monsters can't be in DEF
  link.faceUp = true;
  link.flags.summonedThisTurn = true;
  link.flags.hasAttacked = false;
  link.flags.positionChangedThisTurn = false;
  ev.push({
    kind: "LinkSummon",
    player: pid,
    instanceId: linkMonsterId,
    materials: materialIds,
    extraMonsterZone: emz,
  });
  openChainWindow(s, {
    kind: "Summoned",
    summonType: "Special",
    player: pid,
    instanceId: linkMonsterId,
  }, ev);
}

/**
 * Ritual Summon: send the Ritual Spell to the GY, tribute monsters
 * whose Level sums to ≥ the Ritual monster's Level, summon the Ritual
 * monster from your hand.
 */
function ritualSummon(
  s: GameState,
  pid: PlayerId,
  ritualSpellId: InstanceId,
  ritualMonsterId: InstanceId,
  tributeIds: InstanceId[],
  slot: number,
  position: Exclude<import("./types.js").Position, "FaceDownDEF">,
  ev: GameEvent[],
): void {
  if (s.phase !== "Main1" && s.phase !== "Main2") throw new Error("Ritual Summon only in Main Phase");
  if (s.turnPlayer !== pid) throw new Error("Not your turn");

  const me = s.players[pid];
  if (slot < 0 || slot >= 5 || me.mainMonster[slot] !== null) {
    throw new Error("Invalid or occupied monster zone");
  }

  const spell = s.cards[ritualSpellId];
  if (!spell) throw new Error("Ritual Spell not found");
  if (spell.controller !== pid) throw new Error("Ritual Spell isn't yours");
  if (spell.location.zone !== "hand" && spell.location.zone !== "spellTrap") {
    throw new Error("Ritual Spell must be in your hand or face-down on the field");
  }
  const spellDef = requireCard(spell.defId);
  if (spellDef.cardType !== "Spell" || spellDef.kind !== "Ritual") {
    throw new Error("Card is not a Ritual Spell");
  }

  const ritual = s.cards[ritualMonsterId];
  if (!ritual) throw new Error("Ritual monster not found");
  if (ritual.controller !== pid || ritual.location.zone !== "hand") {
    throw new Error("Ritual monster must be in your hand");
  }
  const ritualDef = requireCard(ritual.defId);
  if (ritualDef.cardType !== "Monster" || !ritualDef.kinds.includes("Ritual")) {
    throw new Error("Card is not a Ritual monster");
  }
  if (ritualDef.ritualSpell && ritualDef.ritualSpell !== spellDef.name) {
    throw new Error(`${ritualDef.name} requires ${ritualDef.ritualSpell}`);
  }
  if (!ritualDef.level) throw new Error("Ritual monster missing Level");

  let levelSum = 0;
  for (const t of tributeIds) {
    const m = s.cards[t];
    if (!m) throw new Error("Tribute missing");
    if (m.controller !== pid) throw new Error("Tribute isn't yours");
    if (m.location.zone !== "hand" && m.location.zone !== "mainMonster") {
      throw new Error("Tributes must be on your field or in your hand");
    }
    const md = requireCard(m.defId);
    if (md.cardType !== "Monster" || !md.level) {
      throw new Error("Tribute must be a monster with a Level");
    }
    levelSum += md.level;
  }
  if (levelSum < ritualDef.level) {
    throw new Error(`Tributes' Levels must sum to at least ${ritualDef.level}`);
  }

  // Tribute → GY. Then send the Ritual Spell. Then place the Ritual monster.
  for (const t of tributeIds) sendCardToGraveyard(s, t, ev);
  sendCardToGraveyard(s, ritualSpellId, ev);

  // Move Ritual monster from hand → field.
  const handIdx = me.hand.indexOf(ritualMonsterId);
  if (handIdx >= 0) me.hand.splice(handIdx, 1);
  me.mainMonster[slot] = ritualMonsterId;
  ritual.location = { controller: pid, zone: "mainMonster", index: slot };
  ritual.position = position;
  ritual.faceUp = true;
  ritual.flags.summonedThisTurn = true;
  ritual.flags.hasAttacked = false;
  ritual.flags.positionChangedThisTurn = false;

  ev.push({
    kind: "RitualSummon",
    player: pid,
    instanceId: ritualMonsterId,
    tributes: tributeIds,
    slot,
    position,
  });
  openChainWindow(s, {
    kind: "Summoned",
    summonType: "Special",
    player: pid,
    instanceId: ritualMonsterId,
  }, ev);
}

/**
 * Place a Pendulum monster from your hand into the left or right
 * Pendulum Zone (which lives at the edge slots of your Spell/Trap row:
 * slot 0 for left, slot 4 for right). Doesn't consume Normal Summon.
 * In a fully detailed engine this would also open a chain window for
 * "Pendulum Spell activated" — for MVP we just place the card.
 */
function setPendulumScale(
  s: GameState,
  pid: PlayerId,
  handInstance: InstanceId,
  side: "left" | "right",
  ev: GameEvent[],
): void {
  if (s.phase !== "Main1" && s.phase !== "Main2") {
    throw new Error("Pendulum scale setup only in Main Phase");
  }
  if (s.turnPlayer !== pid) throw new Error("Not your turn");

  const me = s.players[pid];
  const card = s.cards[handInstance];
  if (!card || card.controller !== pid || card.location.zone !== "hand") {
    throw new Error("Card must be in your hand");
  }
  const def = requireCard(card.defId);
  if (def.cardType !== "Monster" || !def.kinds.includes("Pendulum")) {
    throw new Error("Card is not a Pendulum monster");
  }
  const slotIdx = side === "left" ? 0 : 4;
  if (me.spellTrap[slotIdx] !== null) {
    throw new Error(`${side} Pendulum Zone is occupied`);
  }

  const i = me.hand.indexOf(handInstance);
  if (i >= 0) me.hand.splice(i, 1);
  me.spellTrap[slotIdx] = handInstance;
  card.location = { controller: pid, zone: "spellTrap", index: slotIdx };
  card.faceUp = true;
  if (side === "left") me.pendulumScale.left = handInstance;
  else me.pendulumScale.right = handInstance;
  ev.push({ kind: "PendulumScaleSet", player: pid, instanceId: handInstance, side });
}

/**
 * Pendulum Summon: with both Pendulum Zones occupied, special-summon
 * any number of monsters from your hand whose Levels are strictly between
 * the two scales. Doesn't consume Normal Summon.
 */
function pendulumSummon(
  s: GameState,
  pid: PlayerId,
  monsters: { handInstance: InstanceId; slot: number; position: Exclude<import("./types.js").Position, "FaceDownDEF"> }[],
  ev: GameEvent[],
): void {
  if (s.phase !== "Main1" && s.phase !== "Main2") {
    throw new Error("Pendulum Summon only in Main Phase");
  }
  if (s.turnPlayer !== pid) throw new Error("Not your turn");

  const me = s.players[pid];
  const left = me.pendulumScale.left ? s.cards[me.pendulumScale.left] : null;
  const right = me.pendulumScale.right ? s.cards[me.pendulumScale.right] : null;
  if (!left || !right) throw new Error("Both Pendulum Zones must be set");
  const leftDef = requireCard(left.defId);
  const rightDef = requireCard(right.defId);
  if (leftDef.cardType !== "Monster" || rightDef.cardType !== "Monster") {
    throw new Error("Pendulum Zones don't hold Pendulum monsters");
  }
  const lo = Math.min(leftDef.pendulumScale ?? 0, rightDef.pendulumScale ?? 0);
  const hi = Math.max(leftDef.pendulumScale ?? 0, rightDef.pendulumScale ?? 0);

  if (monsters.length === 0) throw new Error("Pendulum Summon needs at least one monster");

  // Validate everything before mutating any state.
  const usedSlots = new Set<number>();
  for (const m of monsters) {
    if (m.slot < 0 || m.slot >= 5) throw new Error("Invalid slot");
    if (usedSlots.has(m.slot)) throw new Error("Duplicate target slot");
    usedSlots.add(m.slot);
    if (me.mainMonster[m.slot] !== null) throw new Error("Slot occupied");
    const card = s.cards[m.handInstance];
    if (!card || card.controller !== pid || card.location.zone !== "hand") {
      throw new Error("Card must be in your hand");
    }
    const def = requireCard(card.defId);
    if (def.cardType !== "Monster") throw new Error("Pendulum-summoned card must be a monster");
    if (def.kinds.includes("Fusion") || def.kinds.includes("Synchro") ||
        def.kinds.includes("Xyz") || def.kinds.includes("Link")) {
      throw new Error("Cannot Pendulum Summon Extra Deck monsters from hand (in MVP)");
    }
    if (def.level === undefined) throw new Error("Monster has no Level");
    if (!(def.level > lo && def.level < hi)) {
      throw new Error(`Level must be between ${lo} and ${hi}`);
    }
  }

  // All valid — perform the summon.
  for (const m of monsters) {
    const card = s.cards[m.handInstance]!;
    const i = me.hand.indexOf(m.handInstance);
    if (i >= 0) me.hand.splice(i, 1);
    me.mainMonster[m.slot] = m.handInstance;
    card.location = { controller: pid, zone: "mainMonster", index: m.slot };
    card.position = m.position;
    card.faceUp = true;
    card.flags.summonedThisTurn = true;
    card.flags.hasAttacked = false;
    card.flags.positionChangedThisTurn = false;
  }
  ev.push({
    kind: "PendulumSummon",
    player: pid,
    monsters: monsters.map((m) => ({ instanceId: m.handInstance, slot: m.slot, position: m.position })),
  });
  // Pendulum Summon fires one chain window for the whole batch
  // (simplification — real rules treat each summon as simultaneous on the
  // same chain). MVP picks the first as the "trigger" instance.
  const first = monsters[0]!;
  openChainWindow(s, {
    kind: "Summoned",
    summonType: "Special",
    player: pid,
    instanceId: first.handInstance,
  }, ev);
}

/** Activate an Equip Spell from hand or face-down field, attaching it to a target monster. */
function equipSpell(
  s: GameState,
  pid: PlayerId,
  spellId: InstanceId,
  targetId: InstanceId,
  ev: GameEvent[],
): void {
  if (s.phase !== "Main1" && s.phase !== "Main2") {
    throw new Error("Equip activation only in Main Phase");
  }
  if (s.turnPlayer !== pid) throw new Error("Not your turn");

  const spell = s.cards[spellId];
  if (!spell || spell.controller !== pid) throw new Error("Spell not yours");
  if (spell.location.zone !== "hand" && spell.location.zone !== "spellTrap") {
    throw new Error("Spell must be in your hand or face-down on the field");
  }
  const def = requireCard(spell.defId);
  if (def.cardType !== "Spell" || def.kind !== "Equip") {
    throw new Error("Card is not an Equip Spell");
  }

  const target = s.cards[targetId];
  if (!target) throw new Error("Target not found");
  if (target.location.zone !== "mainMonster" && target.location.zone !== "extraMonster") {
    throw new Error("Target must be a face-up monster on the field");
  }
  if (!target.faceUp) throw new Error("Target must be face-up");

  // Move spell to face-up Spell/Trap zone of the equipping player.
  const me = s.players[pid];
  if (spell.location.zone === "hand") {
    const i = me.hand.indexOf(spellId);
    if (i >= 0) me.hand.splice(i, 1);
    const slot = me.spellTrap.findIndex((x) => x === null);
    if (slot < 0) throw new Error("No free Spell/Trap zone");
    me.spellTrap[slot] = spellId;
    spell.location = { controller: pid, zone: "spellTrap", index: slot };
  }
  spell.faceUp = true;

  // Attach via the target's `equipped` array; apply a stat bonus if any.
  target.equipped = [...(target.equipped ?? []), spellId];
  applyEquipStats(s, target, +1);

  ev.push({ kind: "Equipped", spell: spellId, target: targetId });
  // Equip Spells go on the chain like other Spell activations so they
  // can be negated. MVP simplification: open the chain window directly.
  openChainWindow(s, { kind: "SpellActivated", player: pid, source: spellId }, ev);
}

/** Recompute a monster's atk/def bonus based on its currently-equipped spells. */
function applyEquipStats(s: GameState, monster: CardInstance, _multiplier: number): void {
  let atkBonus = 0;
  let defBonus = 0;
  for (const sId of monster.equipped ?? []) {
    const equipCard = s.cards[sId];
    if (!equipCard || equipCard.location.zone !== "spellTrap" || !equipCard.faceUp) continue;
    try {
      const def = requireCard(equipCard.defId);
      if (def.cardType !== "Spell" || def.kind !== "Equip") continue;
      // Static map of equip-spell stat lines. Add more entries as cards land.
      if (def.id === EQUIP_BLACK_PENDANT_ID) atkBonus += 500;
    } catch { /* */ }
  }
  monster.atkBonus = atkBonus;
  monster.defBonus = defBonus;
}

/** Card-id constant pulled from cards/index.ts. Kept here to avoid a cycle. */
const EQUIP_BLACK_PENDANT_ID = 65169794;

/**
 * Common tail of Fusion/Synchro/Xyz Summon: take a card from the Extra
 * Deck, place it on a Main or Extra Monster Zone, set per-turn flags,
 * fire a Summoned chain window with the right summonType.
 */
function placeExtraDeckMonster(
  s: GameState,
  pid: PlayerId,
  instanceId: InstanceId,
  slot: number,
  position: Exclude<import("./types.js").Position, "FaceDownDEF">,
  useEmz: 0 | 1 | undefined,
  kind: "Fusion" | "Synchro" | "Xyz",
  ev: GameEvent[],
): void {
  const me = s.players[pid];
  const card = s.cards[instanceId]!;
  const idx = me.extraDeck.indexOf(instanceId);
  if (idx >= 0) me.extraDeck.splice(idx, 1);
  if (useEmz !== undefined) {
    if (s.extraMonsterZones[useEmz] !== null) throw new Error("Extra Monster Zone occupied");
    s.extraMonsterZones[useEmz] = instanceId;
    card.location = { controller: pid, zone: "extraMonster", index: useEmz };
  } else {
    if (slot < 0 || slot >= 5) throw new Error("Invalid slot");
    if (me.mainMonster[slot] !== null) throw new Error("Monster zone occupied");
    me.mainMonster[slot] = instanceId;
    card.location = { controller: pid, zone: "mainMonster", index: slot };
  }
  card.controller = pid;
  card.position = position;
  card.faceUp = true;
  card.flags.summonedThisTurn = true;
  card.flags.hasAttacked = false;
  card.flags.positionChangedThisTurn = false;
  ev.push({
    kind: `${kind}Summon`,
    player: pid,
    instanceId,
    slot,
    position,
    extraMonsterZone: useEmz ?? null,
  });
  openChainWindow(s, {
    kind: "Summoned",
    summonType: "Special",
    player: pid,
    instanceId,
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
  // If this card is an Equip Spell, detach from any monster equipping it
  // and recompute that monster's stat bonuses.
  for (const otherId of Object.keys(s.cards)) {
    const other = s.cards[otherId];
    if (!other?.equipped) continue;
    const i = other.equipped.indexOf(id);
    if (i >= 0) {
      other.equipped.splice(i, 1);
      applyEquipStats(s, other, +1);
    }
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

  const directAtk = effectiveAtk(attacker, attackerDef);

  if (target === "direct") {
    if (opponentHasMonster(s, opp)) {
      // Opponent summoned a blocker mid-chain — direct attack fizzles.
      ev.push({ kind: "AttackFizzled", reason: "opponent now has monsters" });
      return;
    }
    changeLp(s, opp, -directAtk, ev);
    ev.push({ kind: "DirectAttack", attacker: attackerId, damage: directAtk });
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

  const atkVal = effectiveAtk(attacker, attackerDef);

  if (defender.position === "ATK") {
    const dATK = effectiveAtk(defender, defenderDef);
    if (atkVal > dATK) {
      changeLp(s, opp, -(atkVal - dATK), ev);
      destroyMonster(s, target, ev);
    } else if (atkVal < dATK) {
      changeLp(s, attackingPlayer, -(dATK - atkVal), ev);
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
      attackerATK: atkVal,
      targetATK: dATK,
    });
  } else {
    const dDEF = effectiveDef(defender, defenderDef);
    if (atkVal > dDEF) {
      destroyMonster(s, target, ev);
    } else if (atkVal < dDEF) {
      changeLp(s, attackingPlayer, -(dDEF - atkVal), ev);
    }
    ev.push({
      kind: "BattleResolved",
      attacker: attackerId,
      target,
      mode: "ATKvsDEF",
      attackerATK: atkVal,
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
  // Trap activation requirements: face-down on field, not just-set this turn.
  if (def.cardType === "Trap") {
    if (card.location.zone !== "spellTrap" || card.faceUp) {
      throw new Error("Trap is not Set on the field");
    }
    if (card.flags.setThisTurn === true && reg.ignoreSetThisTurn !== true) {
      throw new Error("Cannot activate a Trap the turn it was Set");
    }
    card.faceUp = true;
    ev.push({ kind: "TrapActivated", instanceId: sourceId, player: pid });
  } else if (def.cardType === "Spell") {
    // Quick-Play Spells from the field follow the same gating as Traps.
    if (def.kind !== "Quick-Play") {
      throw new Error("Only Quick-Play Spells can be chain-activated");
    }
    if (card.location.zone !== "spellTrap" || card.faceUp) {
      throw new Error("Quick-Play Spell is not Set on the field");
    }
    if (card.flags.setThisTurn === true && reg.ignoreSetThisTurn !== true) {
      throw new Error("Cannot activate a Quick-Play Spell the turn it was Set");
    }
    card.faceUp = true;
    ev.push({ kind: "SpellActivated", instanceId: sourceId, player: pid });
  } else if (def.cardType === "Monster") {
    // Hand traps (Ash Blossom etc.) — discarded from hand to activate.
    if (card.location.zone !== "hand") {
      throw new Error("Hand trap must be activated from your hand");
    }
    sendCardToGraveyard(s, sourceId, ev);
    ev.push({ kind: "HandTrapActivated", instanceId: sourceId, player: pid });
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
  // Snapshot every link's source before resolveChain consumes the chain —
  // we need them to dispose Normal/Quick-Play Spells and Normal/Counter
  // Traps after their effects run.
  const linkSources = s.chain.map((l) => l.source);
  resolveChain(s, ev);

  // Universal post-resolution disposal: any face-up card on the field
  // that just resolved on the chain and would normally go to the GY
  // does so now. Continuous/Equip/Field Spells and Continuous Traps stay.
  for (const sid of linkSources) {
    const card = s.cards[sid];
    if (!card) continue;
    if (card.location.zone !== "spellTrap") continue;
    try {
      const def = requireCard(card.defId);
      if (def.cardType === "Spell" && (def.kind === "Normal" || def.kind === "Quick-Play" || def.kind === "Ritual")) {
        sendCardToGraveyard(s, sid, ev);
      } else if (def.cardType === "Trap" && (def.kind === "Normal" || def.kind === "Counter")) {
        sendCardToGraveyard(s, sid, ev);
      }
    } catch { /* */ }
  }

  const trigger = w.trigger;
  const negated = w.triggerNegated;
  s.pendingChainWindow = null;
  ev.push({ kind: "ChainWindowClosed", negated });

  switch (trigger.kind) {
    case "AttackDeclared":
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
      return;
    case "SpellActivated":
      // Already handled by the universal disposal above.
      return;
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

/** Live ATK after Equip Spell / continuous-effect bonuses. */
function effectiveAtk(card: CardInstance, def: MonsterDefinition): number {
  return Math.max(0, def.atk + (card.atkBonus ?? 0));
}

/** Live DEF after Equip Spell / continuous-effect bonuses. */
function effectiveDef(card: CardInstance, def: MonsterDefinition): number {
  return Math.max(0, (def.def ?? 0) + (card.defBonus ?? 0));
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
  // Equipped spells go to GY too.
  const equipped = card.equipped ?? [];
  card.equipped = [];
  card.atkBonus = 0;
  card.defBonus = 0;
  card.location = { controller: card.owner, zone: "graveyard", index: owner.graveyard.length };
  card.controller = card.owner;
  card.position = undefined;
  card.faceUp = true;
  owner.graveyard.push(id);
  ev.push({ kind: "Destroyed", instanceId: id, by: "battle" });
  for (const equipId of equipped) sendCardToGraveyard(s, equipId, ev);
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
