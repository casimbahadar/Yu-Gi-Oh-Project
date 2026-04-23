#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fetchAllCards } from "./ygoprodeck.js";
import { snapshotPath } from "./loader.js";

async function main(): Promise<void> {
  console.log("Fetching full card catalog from YGOPRODeck…");
  const cards = await fetchAllCards();
  console.log(`Received ${cards.length} cards.`);
  mkdirSync(dirname(snapshotPath), { recursive: true });
  writeFileSync(snapshotPath, JSON.stringify(cards));
  console.log(`Wrote snapshot to ${snapshotPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
