import type { ChainLink, GameEvent, InstanceId, PlayerId, SpellSpeed } from "./types.js";
import type { GameState } from "./state.js";

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
