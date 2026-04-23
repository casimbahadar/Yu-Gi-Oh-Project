/**
 * Effect primitives — small, composable building blocks that card
 * scripts use to describe what an effect does. Each primitive mutates
 * the (already-cloned) GameState inside a chain resolution step.
 *
 * Keep this file small. Card-specific logic belongs in per-card scripts.
 */

import type { GameState } from "../state.js";
import { opponentOf } from "../state.js";
import type { GameEvent, InstanceId, PlayerId } from "../types.js";

export function draw(
  state: GameState,
  player: PlayerId,
  count: number,
  events: GameEvent[],
): void {
  const p = state.players[player];
  for (let i = 0; i < count; i++) {
    const id = p.deck.pop();
    if (!id) {
      state.ended = true;
      state.winner = opponentOf(player);
      events.push({ kind: "DeckOut", player });
      return;
    }
    const card = state.cards[id]!;
    card.location = { controller: player, zone: "hand", index: p.hand.length };
    p.hand.push(id);
    events.push({ kind: "Drew", player, instanceId: id });
  }
}

export function sendToGraveyard(
  state: GameState,
  instanceId: InstanceId,
  events: GameEvent[],
): void {
  const card = state.cards[instanceId];
  if (!card) return;
  const p = state.players[card.controller];
  // Remove from its current zone.
  const loc = card.location;
  switch (loc.zone) {
    case "mainMonster":
      p.mainMonster[loc.index] = null;
      break;
    case "spellTrap":
      p.spellTrap[loc.index] = null;
      break;
    case "field":
      p.field = null;
      break;
    case "extraMonster":
      state.extraMonsterZones[loc.index] = null;
      break;
    case "hand": {
      const i = p.hand.indexOf(instanceId);
      if (i >= 0) p.hand.splice(i, 1);
      break;
    }
    default:
      break;
  }
  card.location = { controller: card.owner, zone: "graveyard", index: state.players[card.owner].graveyard.length };
  card.controller = card.owner;
  card.position = undefined;
  card.faceUp = true;
  state.players[card.owner].graveyard.push(instanceId);
  events.push({ kind: "SentToGraveyard", instanceId });
}

export function destroy(
  state: GameState,
  instanceId: InstanceId,
  events: GameEvent[],
): void {
  events.push({ kind: "Destroyed", instanceId });
  sendToGraveyard(state, instanceId, events);
}

export function changeLifePoints(
  state: GameState,
  player: PlayerId,
  delta: number,
  events: GameEvent[],
): void {
  state.players[player].lifePoints = Math.max(0, state.players[player].lifePoints + delta);
  events.push({ kind: "LifePointsChanged", player, delta, total: state.players[player].lifePoints });
  if (state.players[player].lifePoints === 0) {
    state.ended = true;
    state.winner = opponentOf(player);
    events.push({ kind: "Victory", player: opponentOf(player), reason: "LP to 0" });
  }
}
