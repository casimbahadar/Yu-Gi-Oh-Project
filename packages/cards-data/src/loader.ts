import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { RawYgoCard } from "./ygoprodeck.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Path to the committed (or user-generated) JSON snapshot. */
export const snapshotPath = resolve(here, "../data/cards.json");

export function loadSnapshot(): RawYgoCard[] {
  if (!existsSync(snapshotPath)) {
    throw new Error(
      `Card snapshot missing at ${snapshotPath}. Run \`pnpm cards:refresh\` first.`,
    );
  }
  return JSON.parse(readFileSync(snapshotPath, "utf8")) as RawYgoCard[];
}
