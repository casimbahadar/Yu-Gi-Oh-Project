/**
 * Starter deck used by the dev UI until the deckbuilder lands.
 * 40 cards drawn from the engine's sample card set, biased toward
 * Level-4 attackers and useful spells so playtests are interactive.
 */

const DM = 46986414;        // Dark Magician — L7
const BEWD = 89631139;      // Blue-Eyes — L8
const ASH = 14558127;       // Ash Blossom — L3 Effect (hand trap)
const MYSTICAL = 15025844;  // Mystical Elf — L4 800/2000
const GEMINI = 69140098;    // Gemini Elf — L4 1900/900
const GOBLIN = 78658564;    // Goblin Attack Force — L4 2300/0
const SKULL = 70781052;     // Summoned Skull — L6 2500/1200 (1 tribute)
const JUNK_SYNCHRON = 70781022;   // L3 Tuner
const RELINQUISHED = 73752131;    // L1 Ritual
const STARGAZER = 1784686;        // Pendulum scale 1
const TIMEGAZER = 16195942;       // Pendulum scale 8
const POT = 53129443;
const REBORN = 83764718;
const RAIGEKI = 12580477;
const MIRROR = 44095762;
const SOLEMN = 41420027;
const POLY = 24094653;
const BLACK_ILLUSION = 41426869;  // Ritual Spell
const MST = 5318639;              // Quick-Play Spell
const BLACK_PENDANT = 65169794;   // Equip Spell

// Extra deck (Fusion/Synchro/Xyz/Link).
const BEUD = 23995346;
const STARDUST = 70902743;
const UTOPIA = 84013237;
const DECODE = 50588353;

export const starterMain: number[] = [
  // Level-4 beaters
  GEMINI, GEMINI, GEMINI,
  GOBLIN, GOBLIN,
  MYSTICAL, MYSTICAL,
  // Tribute fodder
  DM, DM,
  SKULL, SKULL,
  // 3 Blue-Eyes for Polymerization → Blue-Eyes Ultimate Dragon
  BEWD, BEWD, BEWD,
  // Synchro tuner + a non-tuner whose level rounds out 8 (3 + 5 = 8)
  JUNK_SYNCHRON, JUNK_SYNCHRON,
  // Pendulum scale pair
  STARGAZER, TIMEGAZER,
  // Ritual support
  RELINQUISHED, BLACK_ILLUSION,
  // Hand traps
  ASH, ASH, ASH,
  // Spells
  POT, POT,
  REBORN,
  RAIGEKI,
  POLY, POLY,
  MST, MST,
  BLACK_PENDANT,
  // Traps
  MIRROR, MIRROR,
  SOLEMN,
  // Filler to reach exactly 40.
  GEMINI, GOBLIN, MYSTICAL, GEMINI, GOBLIN,
];

export const starterExtra: number[] = [
  BEUD,
  STARDUST, STARDUST,
  UTOPIA, UTOPIA,
  DECODE, DECODE,
];

export const starterDeck: number[] = [...starterMain, ...starterExtra];
