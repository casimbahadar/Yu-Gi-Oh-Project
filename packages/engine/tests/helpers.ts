import type { GameState, InstanceId } from "../src/index.js";

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
