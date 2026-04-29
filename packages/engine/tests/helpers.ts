import { reduce, type Action, type GameEvent, type GameState, type InstanceId } from "../src/index.js";

/**
 * Force a card with the given defId into the player's hand. Looks in
 * hand first, then deck. Used by tests to escape opening-hand RNG.
 */
export function plantInHand(s: GameState, defId: number, pid: 0 | 1): InstanceId {
  const inHand = s.players[pid].hand.find((id) => s.cards[id]?.defId === defId);
  if (inHand) return inHand;
  const deckIdx = s.players[pid].deck.findIndex((id) => s.cards[id]?.defId === defId);
  if (deckIdx < 0) throw new Error(`no ${defId} in deck or hand for player ${pid}`);
  const id = s.players[pid].deck[deckIdx]!;
  s.players[pid].deck.splice(deckIdx, 1);
  s.cards[id]!.location = { controller: pid, zone: "hand", index: s.players[pid].hand.length };
  s.players[pid].hand.push(id);
  return id;
}

/**
 * Reduce an action and then auto-pass through any chain window it
 * opens. Mirrors a "pass when nothing to do" client toggle and keeps
 * tests focused on outcomes rather than priority bookkeeping.
 */
export function play(state: GameState, action: Action): {
  state: GameState;
  events: GameEvent[];
} {
  const events: GameEvent[] = [];
  let r = reduce(state, action);
  events.push(...r.events);
  let s = r.state;
  let safety = 16;
  while (s.pendingChainWindow && safety-- > 0) {
    const pid = s.pendingChainWindow.priority;
    r = reduce(s, { kind: "ChainPass", player: pid });
    events.push(...r.events);
    s = r.state;
  }
  return { state: s, events };
}

export function playMany(state: GameState, actions: Action[]): {
  state: GameState;
  events: GameEvent[];
} {
  let s = state;
  const events: GameEvent[] = [];
  for (const a of actions) {
    const r = play(s, a);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}
