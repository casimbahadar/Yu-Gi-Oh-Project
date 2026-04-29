import type { InstanceId, PlayerId, Position } from "./types.js";

/**
 * Discriminated union of every action the reducer accepts.
 * All actions are serializable and originate from either a player
 * (validated at the server) or the engine itself (internal transitions).
 */
export type Action =
  | { kind: "StartDuel"; decks: { p0: number[]; p1: number[] }; goingFirst: PlayerId }
  | { kind: "EndPhase" }
  | { kind: "EnterPhase"; phase: import("./types.js").Phase }
  | { kind: "Draw"; player: PlayerId; count: number }
  | { kind: "NormalSummon"; player: PlayerId; hand: InstanceId; slot: number; position: Exclude<Position, "FaceDownDEF"> }
  | { kind: "SetMonster"; player: PlayerId; hand: InstanceId; slot: number }
  | { kind: "TributeSummon"; player: PlayerId; hand: InstanceId; slot: number; tributes: InstanceId[]; position: Exclude<Position, "FaceDownDEF"> }
  | { kind: "FlipSummon"; player: PlayerId; monster: InstanceId }
  | { kind: "ChangePosition"; player: PlayerId; monster: InstanceId; position: Position }
  | { kind: "PlaySpell"; player: PlayerId; hand: InstanceId; slot: number; faceDown: boolean; payload?: Record<string, unknown> }
  | { kind: "ActivateSetSpell"; player: PlayerId; spellTrap: InstanceId; payload?: Record<string, unknown> }
  | { kind: "SetTrap"; player: PlayerId; hand: InstanceId; slot: number }
  | { kind: "ActivateEffect"; player: PlayerId; source: InstanceId; effectKey: string; payload?: Record<string, unknown> }
  | { kind: "DeclareAttack"; player: PlayerId; attacker: InstanceId; target: InstanceId | "direct" }
  | { kind: "SpecialSummon"; player: PlayerId; source: InstanceId; targetZone: "mainMonster" | "extraMonster"; slot: number; position: Position }
  | { kind: "ChainRespond"; player: PlayerId; source: InstanceId; effectKey: string; payload?: Record<string, unknown> }
  | { kind: "ChainPass"; player: PlayerId }
  | { kind: "ResolveChain" }
  | { kind: "Concede"; player: PlayerId };

export type ActionKind = Action["kind"];
