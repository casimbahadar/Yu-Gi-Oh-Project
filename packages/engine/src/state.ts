import type {
  CardInstance,
  ChainLink,
  InstanceId,
  Phase,
  PlayerId,
} from "./types.js";

/**
 * A player's private + public state. Zones store only instance ids;
 * the canonical CardInstance lives in `GameState.cards`.
 */
export interface PlayerState {
  id: PlayerId;
  name: string;
  lifePoints: number;

  hand: InstanceId[];
  deck: InstanceId[];           // top of deck = last element (pop/push)
  mainMonster: (InstanceId | null)[]; // length 5
  spellTrap: (InstanceId | null)[];   // length 5
  field: InstanceId | null;
  graveyard: InstanceId[];
  banished: InstanceId[];
  extraDeck: InstanceId[];
  pendulumScale: {
    left: InstanceId | null;
    right: InstanceId | null;
  };

  // Per-turn bookkeeping
  normalSummonsUsed: number;
  normalSummonLimit: number; // usually 1
  hasDrawnForTurn: boolean;
}

export interface GameState {
  /** Deterministic RNG seed; reducer uses a seeded PRNG for shuffles/flips. */
  seed: number;
  /** Monotonic tick; increments on every reduced action. */
  tick: number;

  turn: number;                    // 1-based
  turnPlayer: PlayerId;
  phase: Phase;
  priorityHolder: PlayerId;

  players: [PlayerState, PlayerState];
  cards: Record<InstanceId, CardInstance>;

  /** Shared Link/Extra Monster Zones (two, indexed 0..1). */
  extraMonsterZones: (InstanceId | null)[];

  /** Active chain; empty when nothing is resolving. */
  chain: ChainLink[];

  /** Once-per-duel / once-per-turn ledger keyed by (instanceId, key). */
  activationLedger: Record<string, number>;

  winner: PlayerId | null;
  ended: boolean;
}

export function createEmptyPlayer(id: PlayerId, name: string): PlayerState {
  return {
    id,
    name,
    lifePoints: 8000,
    hand: [],
    deck: [],
    mainMonster: [null, null, null, null, null],
    spellTrap: [null, null, null, null, null],
    field: null,
    graveyard: [],
    banished: [],
    extraDeck: [],
    pendulumScale: { left: null, right: null },
    normalSummonsUsed: 0,
    normalSummonLimit: 1,
    hasDrawnForTurn: false,
  };
}

export function createInitialState(
  seed: number,
  p0Name: string,
  p1Name: string,
): GameState {
  return {
    seed,
    tick: 0,
    turn: 1,
    turnPlayer: 0,
    phase: "Draw",
    priorityHolder: 0,
    players: [createEmptyPlayer(0, p0Name), createEmptyPlayer(1, p1Name)],
    cards: {},
    extraMonsterZones: [null, null],
    chain: [],
    activationLedger: {},
    winner: null,
    ended: false,
  };
}

export function opponentOf(p: PlayerId): PlayerId {
  return (1 - p) as PlayerId;
}
