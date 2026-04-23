import type { Phase } from "./types.js";

/**
 * Canonical phase order. BattleStart/BattleStep/Damage/BattleEnd are
 * sub-phases of the Battle Phase; we flatten them so transitions are
 * explicit in the reducer.
 */
export const PHASE_ORDER: Phase[] = [
  "Draw",
  "Standby",
  "Main1",
  "BattleStart",
  "BattleStep",
  "Damage",
  "BattleEnd",
  "Main2",
  "End",
];

export function nextPhase(current: Phase): Phase | null {
  const i = PHASE_ORDER.indexOf(current);
  if (i < 0 || i === PHASE_ORDER.length - 1) return null;
  return PHASE_ORDER[i + 1]!;
}

export function canSkipTo(from: Phase, to: Phase): boolean {
  // Main1 → End (skip battle entirely) is legal.
  if (from === "Main1" && to === "End") return true;
  // Main1 → BattleStart starts a battle.
  if (from === "Main1" && to === "BattleStart") return true;
  // BattleEnd → Main2 is automatic; turn player may also go to End.
  if (from === "BattleEnd" && (to === "Main2" || to === "End")) return true;
  // Main2 → End.
  if (from === "Main2" && to === "End") return true;
  return false;
}

/** Turn player cannot enter Battle Phase on turn 1 (official rule). */
export function battleAllowedOnTurn(turn: number): boolean {
  return turn > 1;
}
