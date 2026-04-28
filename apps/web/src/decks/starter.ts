/**
 * Starter deck used by the dev UI until the deckbuilder lands.
 * 40 cards drawn from the engine's sample card set.
 */

const DM = 46986414;
const BEWD = 89631139;
const ASH = 14558127;
const POT = 53129443;
const REBORN = 83764718;
const RAIGEKI = 12580477;
const MIRROR = 44095762;
const SOLEMN = 41420027;

// Extra deck (Fusion/Synchro/Xyz/Link)
const BEUD = 23995346;
const STARDUST = 70902743;
const UTOPIA = 84013237;
const DECODE = 50588353;

export const starterMain: number[] = [
  DM, DM, DM,
  BEWD, BEWD, BEWD,
  ASH, ASH, ASH,
  POT, POT,
  REBORN,
  RAIGEKI,
  MIRROR, MIRROR,
  SOLEMN,
  // Filler — repeat Ash to reach 40. Replaceable once deckbuilder exists.
  ...Array.from({ length: 24 }, () => ASH),
];

export const starterExtra: number[] = [
  BEUD,
  STARDUST, STARDUST,
  UTOPIA, UTOPIA,
  DECODE, DECODE,
];

/** Flat list the engine's StartDuel expects (main + extra). */
export const starterDeck: number[] = [...starterMain, ...starterExtra];
