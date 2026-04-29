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
  | {
      /**
       * Fusion Summon via Polymerization (or another Fusion-capable spell).
       */
      kind: "FusionSummon";
      player: PlayerId;
      polymerization: InstanceId;
      fusionMonster: InstanceId;
      materials: InstanceId[];
      slot: number;
      position: Position;
    }
  | {
      /**
       * Synchro Summon: 1 Tuner + 1+ non-Tuners whose levels sum to the
       * Synchro monster's level. All materials go to the GY.
       */
      kind: "SynchroSummon";
      player: PlayerId;
      synchroMonster: InstanceId;
      tuner: InstanceId;
      nonTuners: InstanceId[];
      slot: number;
      position: Exclude<Position, "FaceDownDEF">;
      useExtraMonsterZone?: 0 | 1;
    }
  | {
      /**
       * Xyz Summon: 2+ monsters of the same Level matching the Xyz's Rank.
       * Materials are attached beneath the Xyz monster (not GY).
       */
      kind: "XyzSummon";
      player: PlayerId;
      xyzMonster: InstanceId;
      materials: InstanceId[];
      slot: number;
      position: Exclude<Position, "FaceDownDEF">;
      useExtraMonsterZone?: 0 | 1;
    }
  | {
      /**
       * Link Summon: monsters totaling the Link monster's Link Rating.
       * Materials go to the GY. Must be summoned to an Extra Monster Zone
       * (or a zone a Link arrow points to once arrows are honoured).
       */
      kind: "LinkSummon";
      player: PlayerId;
      linkMonster: InstanceId;
      materials: InstanceId[];
      extraMonsterZone: 0 | 1;
    }
  | {
      /**
       * Ritual Summon: tribute monsters whose Levels sum to ≥ the Ritual
       * monster's Level, alongside the appropriate Ritual Spell.
       */
      kind: "RitualSummon";
      player: PlayerId;
      ritualSpell: InstanceId;
      ritualMonster: InstanceId; // an instance of the Ritual monster in hand
      tributes: InstanceId[];
      slot: number;
      position: Exclude<Position, "FaceDownDEF">;
    }
  | {
      /**
       * Set a Pendulum monster from your hand to the left or right
       * Pendulum Zone. Doesn't consume Normal Summon.
       */
      kind: "SetPendulumScale";
      player: PlayerId;
      hand: InstanceId;
      side: "left" | "right";
    }
  | {
      /**
       * Pendulum Summon: with both Pendulum Zones occupied, special-summon
       * any number of monsters from your hand whose Levels are strictly
       * between the two scale values.
       */
      kind: "PendulumSummon";
      player: PlayerId;
      monsters: { handInstance: InstanceId; slot: number; position: Exclude<Position, "FaceDownDEF"> }[];
    }
  | { kind: "EquipSpell"; player: PlayerId; spell: InstanceId; target: InstanceId }
  | { kind: "ChainRespond"; player: PlayerId; source: InstanceId; effectKey: string; payload?: Record<string, unknown> }
  | { kind: "ChainPass"; player: PlayerId }
  | { kind: "ResolveChain" }
  | { kind: "Concede"; player: PlayerId };

export type ActionKind = Action["kind"];
