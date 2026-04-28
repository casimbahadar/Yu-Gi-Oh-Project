/**
 * Core type definitions for the Yu-Gi-Oh rules engine.
 * Kept separate from `state.ts` so cards and effects can reference
 * the vocabulary without importing the full state shape.
 */

export type PlayerId = 0 | 1;

export type CardId = number; // Konami / YGOPRODeck card id
export type InstanceId = string; // unique per physical copy in a duel

export type Attribute =
  | "DARK"
  | "LIGHT"
  | "EARTH"
  | "WATER"
  | "FIRE"
  | "WIND"
  | "DIVINE";

export type MonsterRace =
  | "Aqua" | "Beast" | "Beast-Warrior" | "Cyberse" | "Dinosaur" | "Divine-Beast"
  | "Dragon" | "Fairy" | "Fiend" | "Fish" | "Insect" | "Machine" | "Plant"
  | "Psychic" | "Pyro" | "Reptile" | "Rock" | "Sea Serpent" | "Spellcaster"
  | "Thunder" | "Warrior" | "Winged Beast" | "Wyrm" | "Zombie";

export type MonsterKind =
  | "Normal" | "Effect" | "Ritual" | "Fusion" | "Synchro" | "Xyz"
  | "Pendulum" | "Link" | "Token";

export type SpellKind =
  | "Normal" | "Continuous" | "Quick-Play" | "Equip" | "Field" | "Ritual";

export type TrapKind = "Normal" | "Continuous" | "Counter";

export type LinkArrow =
  | "TL" | "T" | "TR"
  | "L"        | "R"
  | "BL" | "B" | "BR";

export type Position = "ATK" | "DEF" | "FaceDownDEF";

export type Zone =
  | "hand"
  | "deck"
  | "mainMonster"      // 5 slots, indices 0..4
  | "spellTrap"        // 5 slots, indices 0..4
  | "field"            // 1 slot
  | "graveyard"
  | "banished"
  | "extraDeck"
  | "extraMonster"     // 2 shared slots, see state.extraMonsterZones
  | "pendulumScale";   // 2 slots (L/R) within spellTrap in modern rules

export interface Location {
  controller: PlayerId;
  zone: Zone;
  index: number; // slot index within zone; 0 for single-slot zones
}

/**
 * Static, shared card definition. Serializable; multiple in-duel
 * Card instances reference the same Definition by id.
 */
export interface MonsterDefinition {
  id: CardId;
  name: string;
  cardType: "Monster";
  kinds: MonsterKind[]; // e.g. ["Effect", "Pendulum"]
  attribute: Attribute;
  race: MonsterRace;
  atk: number;
  def?: number; // absent on Link monsters
  level?: number; // Normal/Effect/Ritual/Fusion/Synchro/Pendulum
  rank?: number; // Xyz
  linkRating?: number; // Link
  linkArrows?: LinkArrow[];
  pendulumScale?: number;
  text: string;
  archetype?: string;
}

export interface SpellDefinition {
  id: CardId;
  name: string;
  cardType: "Spell";
  kind: SpellKind;
  text: string;
  archetype?: string;
}

export interface TrapDefinition {
  id: CardId;
  name: string;
  cardType: "Trap";
  kind: TrapKind;
  text: string;
  archetype?: string;
}

export type CardDefinition =
  | MonsterDefinition
  | SpellDefinition
  | TrapDefinition;

/**
 * A physical card instance in a specific duel.
 * Holds runtime state (position, face-up/down, counters, etc.).
 */
export interface CardInstance {
  instanceId: InstanceId;
  defId: CardId;
  owner: PlayerId;
  controller: PlayerId;
  location: Location;
  position?: Position;        // monsters
  faceUp: boolean;
  counters: Record<string, number>;
  // Xyz materials attached beneath this card
  attached: InstanceId[];
  // Effect runtime flags (summoning sickness, once-per-turn locks, etc.)
  flags: Record<string, boolean | number | string>;
}

export type Phase =
  | "Draw"
  | "Standby"
  | "Main1"
  | "BattleStart"
  | "BattleStep"
  | "Damage"
  | "BattleEnd"
  | "Main2"
  | "End";

export type SpellSpeed = 1 | 2 | 3;

export interface ChainLink {
  source: InstanceId;
  controller: PlayerId;
  spellSpeed: SpellSpeed;
  /** Opaque effect descriptor resolved by the card's script. */
  effectKey: string;
  /** Targets / choices captured at activation time (pre-resolution). */
  payload: Record<string, unknown>;
}

export interface GameEvent {
  kind: string;
  // Payload varies by event kind; consumers narrow via `kind`.
  [key: string]: unknown;
}
