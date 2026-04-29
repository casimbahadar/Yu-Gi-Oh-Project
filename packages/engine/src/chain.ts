import type {
  CardInstance,
  ChainLink,
  ChainTrigger,
  GameEvent,
  InstanceId,
  PlayerId,
  SpellSpeed,
} from "./types.js";
import type { GameState } from "./state.js";
import { getCard } from "./registry.js";

/**
 * Chain resolution — skeleton.
 *
 * Responsibilities:
 *  - Track the active chain (LIFO resolution).
 *  - Enforce Spell Speed: a responder's effect speed must be >= the
 *    speed of the top link to respond.
 *  - Resolve links top-down, delegating per-link resolution to the
 *    card script registered under `link.effectKey`.
 *
 * The real implementation needs SEGOC (simultaneous effects go on chain),
 * mandatory-vs-optional ordering, and lastingEffects registration.
 * This file exposes the shape; card scripts plug in via registerEffect().
 */

export type EffectResolver = (
  state: GameState,
  link: ChainLink,
  events: GameEvent[],
) => void;

const resolvers = new Map<string, EffectResolver>();

export function registerEffect(key: string, fn: EffectResolver): void {
  if (resolvers.has(key)) {
    throw new Error(`Effect already registered: ${key}`);
  }
  resolvers.set(key, fn);
}

export function getEffect(key: string): EffectResolver | undefined {
  return resolvers.get(key);
}

export function canRespond(
  chain: ChainLink[],
  respondingSpeed: SpellSpeed,
): boolean {
  if (chain.length === 0) return respondingSpeed >= 1;
  const top = chain[chain.length - 1]!;
  return respondingSpeed >= top.spellSpeed;
}

export function resolveChain(
  state: GameState,
  events: GameEvent[],
): void {
  while (state.chain.length > 0) {
    const link = state.chain.pop()!;
    if (link.negated) {
      events.push({
        kind: "LinkNegated",
        effectKey: link.effectKey,
        source: link.source,
      });
      continue;
    }
    const resolver = resolvers.get(link.effectKey);
    if (!resolver) {
      events.push({
        kind: "EffectFizzled",
        reason: "no resolver",
        effectKey: link.effectKey,
        source: link.source,
      });
      continue;
    }
    resolver(state, link, events);
    events.push({ kind: "LinkResolved", effectKey: link.effectKey, source: link.source });
  }
}

/** Utility used by card scripts to push a new link onto the chain. */
export function pushLink(
  state: GameState,
  source: InstanceId,
  controller: PlayerId,
  spellSpeed: SpellSpeed,
  effectKey: string,
  payload: Record<string, unknown> = {},
): void {
  state.chain.push({ source, controller, spellSpeed, effectKey, payload });
}

/**
 * Map from card definition id → primary on-activation effect key.
 * Used by the reducer when a Spell/Trap is activated, to know which
 * registered resolver to put on the chain. Cards that have multiple
 * possible activations should pick the right key in their UI.
 */
const activationByDefId = new Map<number, string>();

export function bindActivation(defId: number, effectKey: string): void {
  if (activationByDefId.has(defId)) {
    throw new Error(`Activation already bound for card ${defId}`);
  }
  activationByDefId.set(defId, effectKey);
}

export function getActivationEffect(defId: number): string | undefined {
  return activationByDefId.get(defId);
}

/**
 * A Trap or quick-effect monster's ability to respond to a trigger
 * (someone attacked, summoned, or activated a Spell). Card scripts
 * register these so the UI knows what's activatable in any chain window.
 */
export interface ChainResponderRegistration {
  effectKey: string;
  spellSpeed: SpellSpeed;
  /** True if this card can activate against the current trigger. */
  canRespond: (trigger: ChainTrigger, state: GameState, source: CardInstance) => boolean;
  /**
   * Optional cost paid at activation time (e.g., Solemn Judgment's
   * pay-half-LP). Runs whether or not the link is later negated.
   */
  onActivate?: (state: GameState, source: CardInstance, events: GameEvent[]) => void;
  /**
   * Optional: extra constraint for face-down Traps about being on the
   * field for at least one full turn ("set this turn" rule). The reducer
   * already enforces the standard rule; predicate-level overrides here.
   */
  ignoreSetThisTurn?: boolean;
}

const respondersByDefId = new Map<number, ChainResponderRegistration>();

export function registerResponder(defId: number, reg: ChainResponderRegistration): void {
  if (respondersByDefId.has(defId)) {
    throw new Error(`Responder already registered for card ${defId}`);
  }
  respondersByDefId.set(defId, reg);
}

export function getResponder(defId: number): ChainResponderRegistration | undefined {
  return respondersByDefId.get(defId);
}

/**
 * Enumerate every face-down trap (and other card type) in `pid`'s
 * spell/trap zone and hand whose registered responder accepts the
 * current chain trigger. Used by the UI to populate the chain-window
 * modal, and by the AI to know whether it has any meaningful response.
 */
export function findActivatableResponders(
  state: GameState,
  pid: PlayerId,
  trigger: ChainTrigger,
): { source: CardInstance; reg: ChainResponderRegistration }[] {
  const out: { source: CardInstance; reg: ChainResponderRegistration }[] = [];
  const top = state.chain[state.chain.length - 1];
  // Face-down field cards (Traps + Quick-Play Spells).
  for (const id of state.players[pid].spellTrap) {
    if (!id) continue;
    const card = state.cards[id];
    if (!card || card.faceUp) continue;
    if (card.flags.setThisTurn === true) continue;
    const reg = respondersByDefId.get(card.defId);
    if (!reg) continue;
    if (!reg.canRespond(trigger, state, card)) continue;
    if (top && reg.spellSpeed < top.spellSpeed) continue;
    out.push({ source: card, reg });
  }
  // Hand responders (Ash Blossom & other hand traps). Only Monster-type
  // cards can activate from hand — Traps and Spells in hand must be
  // Set before they can chain.
  for (const id of state.players[pid].hand) {
    const card = state.cards[id];
    if (!card) continue;
    const def = getCard(card.defId);
    if (!def || def.cardType !== "Monster") continue;
    const reg = respondersByDefId.get(card.defId);
    if (!reg) continue;
    if (!reg.canRespond(trigger, state, card)) continue;
    if (top && reg.spellSpeed < top.spellSpeed) continue;
    out.push({ source: card, reg });
  }
  return out;
}
