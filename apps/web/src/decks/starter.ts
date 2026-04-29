/**
 * Starter deck used by the dev UI until the deckbuilder lands.
 * 40 cards drawn from the engine's sample card set, biased toward
 * Level-4 attackers and useful spells so playtests are interactive.
 */

const DM = 46986414;        // Dark Magician — L7
const BEWD = 89631139;      // Blue-Eyes — L8
const ASH = 14558127;       // Ash Blossom — L3 Effect
const MYSTICAL = 15025844;  // Mystical Elf — L4 800/2000
const GEMINI = 69140098;    // Gemini Elf — L4 1900/900
const GOBLIN = 78658564;    // Goblin Attack Force — L4 2300/0
const SKULL = 70781052;     // Summoned Skull — L6 2500/1200 (1 tribute)
const POT = 53129443;
const REBORN = 83764718;
const RAIGEKI = 12580477;
const MIRROR = 44095762;
const SOLEMN = 41420027;

// Extra deck (Fusion/Synchro/Xyz/Link) — kept on bench for future Special Summons.
const BEUD = 23995346;
const STARDUST = 70902743;
const UTOPIA = 84013237;
const DECODE = 50588353;

export const starterMain: number[] = [
  // Level-4 beaters
  GEMINI, GEMINI, GEMINI,
  GOBLIN, GOBLIN, GOBLIN,
  MYSTICAL, MYSTICAL,
  // Higher-level (need tribute)
  DM, DM,
  SKULL, SKULL,
  BEWD,
  // Hand traps
  ASH, ASH, ASH,
  // Spells
  POT, POT,
  REBORN,
  RAIGEKI,
  // Traps (Set only — chain-window UI not in MVP)
  MIRROR, MIRROR,
  SOLEMN,
  // Filler — we want exactly 40, so pad with a flexible Level-4 Normal.
  GEMINI, GEMINI,
  GOBLIN, GOBLIN,
  MYSTICAL, MYSTICAL,
  ASH, ASH,
  POT,
  MIRROR,
  // Top up
  GEMINI, GEMINI,
  GOBLIN,
  ASH, ASH,
  MYSTICAL, MYSTICAL,
];

export const starterExtra: number[] = [
  BEUD,
  STARDUST, STARDUST,
  UTOPIA, UTOPIA,
  DECODE, DECODE,
];

export const starterDeck: number[] = [...starterMain, ...starterExtra];
