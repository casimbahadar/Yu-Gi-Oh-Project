import type { Action, GameEvent, GameState, PlayerId } from "@ygo/engine";

/**
 * Wire protocol between the client and the authoritative duel server.
 * All messages are JSON and start with `type` for cheap discrimination.
 */

export type ClientToServer =
  | { type: "hello"; displayName: string }
  | { type: "createRoom"; deck: number[] }
  | { type: "joinRoom"; code: string; deck: number[] }
  | { type: "submitAction"; action: Action }
  | { type: "concede" }
  | { type: "chat"; text: string }
  | { type: "leave" };

export type ServerToClient =
  | { type: "welcome"; clientId: string }
  | { type: "roomCreated"; code: string }
  | { type: "roomJoined"; code: string; you: PlayerId; opponentName: string }
  | { type: "opponentJoined"; name: string }
  | { type: "duelState"; state: GameState; events: GameEvent[] }
  | { type: "duelEnded"; winner: PlayerId | null; reason: string }
  | { type: "error"; message: string }
  | { type: "chat"; from: string; text: string };

export const PROTOCOL_VERSION = 1;
