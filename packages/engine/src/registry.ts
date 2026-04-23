import type { CardDefinition, CardId } from "./types.js";

/**
 * Runtime registry of card definitions. Populated from
 * `@ygo/cards-data` (YGOPRODeck snapshot) or directly by per-card
 * TS scripts that self-register when imported.
 */
const definitions = new Map<CardId, CardDefinition>();

export function registerCard(def: CardDefinition): void {
  definitions.set(def.id, def);
}

export function getCard(id: CardId): CardDefinition | undefined {
  return definitions.get(id);
}

export function requireCard(id: CardId): CardDefinition {
  const def = definitions.get(id);
  if (!def) throw new Error(`Unknown card id: ${id}`);
  return def;
}

export function allCards(): CardDefinition[] {
  return Array.from(definitions.values());
}

export function registerMany(defs: CardDefinition[]): void {
  for (const d of defs) registerCard(d);
}
