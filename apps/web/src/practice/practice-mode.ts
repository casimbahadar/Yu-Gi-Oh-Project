/**
 * Offline practice mode. Spins up an in-browser engine instance,
 * seats the human as player 0 and an AI as player 1, and intercepts
 * the WS-style `submitAction` path so existing UI keeps working.
 *
 * The same `reduce` / `legalActions` / `pickAction` are used as on the
 * server, so the AI sees exactly the rules the human sees.
 */

import {
  createInitialState,
  pickAction,
  reduce,
  type Action,
  type GameState,
  type GameEvent,
} from "@ygo/engine";
import "@ygo/engine/cards";
import type { ClientToServer } from "@ygo/shared";
import { useDuel } from "../store.js";
import { setLocalSubmitter } from "../net/ws-client.js";

const HUMAN: 0 = 0;
const AI: 1 = 1;

let practiceState: GameState | null = null;

export function startPracticeMatch(name: string, deck: number[]): void {
  const seed = Date.now() >>> 0;
  let s = createInitialState(seed, name, "AI Sparring Bot");
  const r0 = reduce(s, {
    kind: "StartDuel",
    decks: { p0: deck, p1: deck },
    goingFirst: HUMAN,
  });
  s = r0.state;
  practiceState = s;
  const store = useDuel.getState();
  store.setHello("local-practice");
  store.setRoom("practice", HUMAN);
  store.setOpponent("AI Sparring Bot");
  store.setState(s, r0.events);
  // Route subsequent submitAction calls to our local reducer.
  setLocalSubmitter(handleHumanAction);
  // If AI somehow goes first or has a chain-window decision now, drive it.
  scheduleAi();
}

function handleHumanAction(msg: ClientToServer): void {
  if (msg.type === "leave") {
    practiceState = null;
    setLocalSubmitter(null);
    return;
  }
  if (msg.type === "concede") {
    applyAction({ kind: "Concede", player: HUMAN });
    return;
  }
  if (msg.type !== "submitAction") return;
  applyAction(msg.action);
}

function applyAction(action: Action): void {
  if (!practiceState) return;
  // Reject any action attributed to the AI player from human input.
  if ("player" in action && action.player !== HUMAN) return;
  const r = reduce(practiceState, action);
  practiceState = r.state;
  publish(r.events);
  scheduleAi();
}

function publish(events: GameEvent[]): void {
  if (!practiceState) return;
  useDuel.getState().setState(practiceState, events);
}

let aiTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAi(): void {
  if (aiTimer) clearTimeout(aiTimer);
  aiTimer = setTimeout(driveAi, 350);
}

function driveAi(): void {
  if (!practiceState || practiceState.ended) return;
  const s = practiceState;

  // While a chain window is open and AI has priority, AI must respond/pass.
  if (s.pendingChainWindow && s.pendingChainWindow.priority === AI) {
    const action = pickAction(s, AI);
    if (action) {
      const r = reduce(s, action);
      practiceState = r.state;
      publish(r.events);
      scheduleAi();
    }
    return;
  }

  // It's the AI's turn outside any chain window: take an action.
  if (s.turnPlayer === AI && !s.pendingChainWindow) {
    const action = pickAction(s, AI);
    if (!action) return;
    const r = reduce(s, action);
    practiceState = r.state;
    publish(r.events);
    // If the action opened a chain window where the human now has
    // priority, stop and wait for human input. Otherwise keep going.
    if (practiceState.pendingChainWindow?.priority === HUMAN) return;
    scheduleAi();
    return;
  }

  // Human's turn but they haven't acted — nothing for AI to do.
}
