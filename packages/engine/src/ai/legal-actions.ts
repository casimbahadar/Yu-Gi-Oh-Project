/**
 * Enumerate the actions a given player could plausibly take from the
 * current state. Used by the AI driver and any UI that wants to grey
 * out illegal options. Not exhaustive (no Special Summons yet) but
 * covers the MVP playable surface.
 *
 * Returns a flat list — callers sort/score it.
 */

import { findActivatableResponders, getActivationEffect } from "../chain.js";
import { requireCard } from "../registry.js";
import { type GameState } from "../state.js";
import type { Action } from "../actions.js";
import type { InstanceId, PlayerId } from "../types.js";

export function legalActions(state: GameState, pid: PlayerId): Action[] {
  if (state.ended) return [];
  const out: Action[] = [];

  // Chain-window responses always come first — they're the only legal
  // actions while a window is open.
  if (state.pendingChainWindow) {
    if (state.pendingChainWindow.priority !== pid) return out;
    out.push({ kind: "ChainPass", player: pid });
    for (const { source, reg } of findActivatableResponders(state, pid, state.pendingChainWindow.trigger)) {
      out.push({
        kind: "ChainRespond",
        player: pid,
        source: source.instanceId,
        effectKey: reg.effectKey,
      });
    }
    return out;
  }

  // Outside chain windows you only get to act on your own turn.
  if (state.turnPlayer !== pid) return out;
  const me = state.players[pid];
  const opp = (1 - pid) as PlayerId;
  const phase = state.phase;
  const inMain = phase === "Main1" || phase === "Main2";

  // EndPhase always (the universal "do nothing" / advance phase action).
  out.push({ kind: "EndPhase" });

  // Concede always.
  out.push({ kind: "Concede", player: pid });

  if (inMain) {
    // Hand actions: summon, set, activate spells, set spells/traps.
    const freeMonsterSlot = me.mainMonster.findIndex((s) => s === null);
    const freeSpellSlot = me.spellTrap.findIndex((s) => s === null);
    const monstersOnField = me.mainMonster.filter((s) => s !== null).length;

    for (const handId of me.hand) {
      const card = state.cards[handId];
      if (!card) continue;
      let def;
      try { def = requireCard(card.defId); } catch { continue; }

      if (def.cardType === "Monster") {
        const isExtra = def.kinds.some(
          (k) => k === "Fusion" || k === "Synchro" || k === "Xyz" || k === "Link",
        );
        if (isExtra) continue; // Extra-deck monsters aren't summoned from hand.
        if (def.level === undefined) continue;

        if (def.level <= 4 && me.normalSummonsUsed < me.normalSummonLimit && freeMonsterSlot >= 0) {
          out.push({ kind: "NormalSummon", player: pid, hand: handId, slot: freeMonsterSlot, position: "ATK" });
          out.push({ kind: "NormalSummon", player: pid, hand: handId, slot: freeMonsterSlot, position: "DEF" });
          out.push({ kind: "SetMonster", player: pid, hand: handId, slot: freeMonsterSlot });
        } else if (def.level <= 6 && monstersOnField >= 1 && me.normalSummonsUsed < me.normalSummonLimit && freeMonsterSlot >= 0) {
          // 1 tribute summons — enumerate each candidate tribute.
          for (const t of me.mainMonster) {
            if (!t) continue;
            out.push({
              kind: "TributeSummon",
              player: pid,
              hand: handId,
              slot: freeMonsterSlot,
              tributes: [t],
              position: "ATK",
            });
          }
        } else if (def.level <= 8 && monstersOnField >= 2 && me.normalSummonsUsed < me.normalSummonLimit && freeMonsterSlot >= 0) {
          // 2-tribute — every pair (small N so O(n^2) is fine).
          const ids: InstanceId[] = me.mainMonster.filter((x): x is InstanceId => x !== null);
          for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
              out.push({
                kind: "TributeSummon",
                player: pid,
                hand: handId,
                slot: freeMonsterSlot,
                tributes: [ids[i]!, ids[j]!],
                position: "ATK",
              });
            }
          }
        }
      } else if (def.cardType === "Spell") {
        if (freeSpellSlot < 0 && def.kind !== "Equip") continue;
        // Polymerization is special: enumerate any legal Fusion.
        if (def.id === 24094653) {
          for (const fa of legalFusions(state, pid, handId)) out.push(fa);
        }
        // Black Illusion Ritual → enumerate any legal Ritual Summons.
        if (def.id === 41426869) {
          for (const ra of legalRituals(state, pid, handId)) out.push(ra);
        }
        // Equip Spell: pick any face-up monster on the field as target.
        if (def.kind === "Equip") {
          const candidates = [
            ...state.players[pid].mainMonster.filter((x): x is InstanceId => x !== null),
            ...state.players[opp].mainMonster.filter((x): x is InstanceId => x !== null),
          ];
          for (const target of candidates) {
            const c = state.cards[target];
            if (!c?.faceUp) continue;
            out.push({ kind: "EquipSpell", player: pid, spell: handId, target });
          }
        }
        // Activate Normal/Ritual Spells if we have a resolver bound.
        if ((def.kind === "Normal" || def.kind === "Ritual") && getActivationEffect(def.id)) {
          // Monster Reborn etc. — synthesize a payload if the spell needs one.
          if (def.id === 83764718) {
            const target = pickAnyGraveyardMonster(state);
            if (target) {
              out.push({
                kind: "PlaySpell",
                player: pid,
                hand: handId,
                slot: freeSpellSlot,
                faceDown: false,
                payload: { target },
              });
            }
          } else {
            out.push({
              kind: "PlaySpell",
              player: pid,
              hand: handId,
              slot: freeSpellSlot,
              faceDown: false,
            });
          }
        }
        // Set Spell (face-down) — always legal in Main Phase.
        out.push({
          kind: "PlaySpell",
          player: pid,
          hand: handId,
          slot: freeSpellSlot,
          faceDown: true,
        });
      } else if (def.cardType === "Trap") {
        if (freeSpellSlot < 0) continue;
        out.push({
          kind: "SetTrap",
          player: pid,
          hand: handId,
          slot: freeSpellSlot,
        });
      }
    }

    // Field actions: position changes, flip summons, activating Set Spells.
    for (const monsterId of me.mainMonster) {
      if (!monsterId) continue;
      const card = state.cards[monsterId];
      if (!card) continue;
      if (
        card.faceUp &&
        card.flags.summonedThisTurn !== true &&
        card.flags.positionChangedThisTurn !== true &&
        card.flags.hasAttacked !== true
      ) {
        const opposite = card.position === "ATK" ? "DEF" : "ATK";
        out.push({ kind: "ChangePosition", player: pid, monster: monsterId, position: opposite });
      }
      if (
        !card.faceUp &&
        card.position === "FaceDownDEF" &&
        card.flags.summonedThisTurn !== true
      ) {
        out.push({ kind: "FlipSummon", player: pid, monster: monsterId });
      }
    }
    for (const stId of me.spellTrap) {
      if (!stId) continue;
      const card = state.cards[stId];
      if (!card || card.faceUp) continue;
      try {
        const def = requireCard(card.defId);
        if (def.cardType === "Spell") {
          out.push({ kind: "ActivateSetSpell", player: pid, spellTrap: stId });
        }
      } catch { /* unknown */ }
    }

    // Extra-deck summons that don't need a Spell card (Synchro/Xyz/Link).
    for (const fa of legalSynchros(state, pid)) out.push(fa);
    for (const fa of legalXyzs(state, pid)) out.push(fa);
    for (const fa of legalLinks(state, pid)) out.push(fa);
  }

  if (phase === "BattleStep") {
    // Each face-up ATK monster you control that hasn't attacked.
    const opp = (1 - pid) as PlayerId;
    const oppMonsters: InstanceId[] = [
      ...state.players[opp].mainMonster.filter((x): x is InstanceId => x !== null),
      ...state.extraMonsterZones.filter(
        (x): x is InstanceId => x !== null && state.cards[x]?.controller === opp,
      ),
    ];
    for (const id of me.mainMonster) {
      if (!id) continue;
      const c = state.cards[id];
      if (!c || !c.faceUp || c.position !== "ATK" || c.flags.hasAttacked === true) continue;
      if (oppMonsters.length === 0) {
        out.push({ kind: "DeclareAttack", player: pid, attacker: id, target: "direct" });
      } else {
        for (const t of oppMonsters) {
          out.push({ kind: "DeclareAttack", player: pid, attacker: id, target: t });
        }
      }
    }
  }

  return out;
}

function pickAnyGraveyardMonster(state: GameState): InstanceId | null {
  for (const pid of [0, 1] as PlayerId[]) {
    for (const id of state.players[pid].graveyard) {
      const c = state.cards[id];
      if (!c) continue;
      try {
        if (requireCard(c.defId).cardType === "Monster") return id;
      } catch { /* */ }
    }
  }
  return null;
}

function legalFusions(state: GameState, pid: PlayerId, polyId: InstanceId): Action[] {
  const out: Action[] = [];
  const me = state.players[pid];
  const slot = me.mainMonster.findIndex((s) => s === null);
  if (slot < 0) return out;
  // Build a multiset of available materials (hand + field, monster cards only).
  const materialPool: { id: InstanceId; name: string }[] = [];
  for (const id of me.hand) {
    const c = state.cards[id];
    if (!c) continue;
    try {
      const def = requireCard(c.defId);
      if (def.cardType === "Monster") materialPool.push({ id, name: def.name });
    } catch { /* */ }
  }
  for (const id of me.mainMonster) {
    if (!id) continue;
    const c = state.cards[id];
    if (!c) continue;
    try {
      const def = requireCard(c.defId);
      if (def.cardType === "Monster") materialPool.push({ id, name: def.name });
    } catch { /* */ }
  }
  for (const fid of me.extraDeck) {
    const fc = state.cards[fid];
    if (!fc) continue;
    let fdef;
    try { fdef = requireCard(fc.defId); } catch { continue; }
    if (fdef.cardType !== "Monster" || !fdef.kinds.includes("Fusion")) continue;
    if (!fdef.fusionMaterials || fdef.fusionMaterials.length === 0) continue;
    const matches = pickMatchingMaterials(materialPool, fdef.fusionMaterials);
    if (!matches) continue;
    out.push({
      kind: "FusionSummon",
      player: pid,
      polymerization: polyId,
      fusionMonster: fid,
      materials: matches,
      slot,
      position: "ATK",
    });
  }
  return out;
}

/** Greedy multiset match by name. Returns the InstanceIds chosen, or null. */
function pickMatchingMaterials(
  pool: { id: InstanceId; name: string }[],
  required: string[],
): InstanceId[] | null {
  const remaining = pool.slice();
  const out: InstanceId[] = [];
  for (const name of required) {
    const idx = remaining.findIndex((p) => p.name === name);
    if (idx < 0) return null;
    out.push(remaining[idx]!.id);
    remaining.splice(idx, 1);
  }
  return out;
}

function legalRituals(state: GameState, pid: PlayerId, ritualSpellId: InstanceId): Action[] {
  const out: Action[] = [];
  const me = state.players[pid];
  const slot = me.mainMonster.findIndex((s) => s === null);
  if (slot < 0) return out;
  for (const ritualId of me.hand) {
    const c = state.cards[ritualId];
    if (!c) continue;
    let rd;
    try { rd = requireCard(c.defId); } catch { continue; }
    if (rd.cardType !== "Monster" || !rd.kinds.includes("Ritual") || !rd.level) continue;
    if (rd.ritualSpell) {
      try {
        const sd = requireCard(state.cards[ritualSpellId]!.defId);
        if (sd.name !== rd.ritualSpell) continue;
      } catch { continue; }
    }
    // Pick smallest-level subset of monsters whose levels sum ≥ ritual's level.
    const candidates: { id: InstanceId; level: number }[] = [];
    for (const id of me.hand) {
      if (id === ritualId) continue;
      const card = state.cards[id];
      if (!card) continue;
      try {
        const def = requireCard(card.defId);
        if (def.cardType === "Monster" && def.level !== undefined) {
          candidates.push({ id, level: def.level });
        }
      } catch { /* */ }
    }
    for (const id of me.mainMonster) {
      if (!id) continue;
      const card = state.cards[id];
      if (!card) continue;
      try {
        const def = requireCard(card.defId);
        if (def.cardType === "Monster" && def.level !== undefined) {
          candidates.push({ id, level: def.level });
        }
      } catch { /* */ }
    }
    candidates.sort((a, b) => a.level - b.level);
    const tributes: InstanceId[] = [];
    let sum = 0;
    for (const c2 of candidates) {
      if (sum >= rd.level) break;
      tributes.push(c2.id);
      sum += c2.level;
    }
    if (sum >= rd.level) {
      out.push({
        kind: "RitualSummon",
        player: pid,
        ritualSpell: ritualSpellId,
        ritualMonster: ritualId,
        tributes,
        slot,
        position: "ATK",
      });
    }
  }
  return out;
}

function legalSynchros(state: GameState, pid: PlayerId): Action[] {
  const out: Action[] = [];
  const me = state.players[pid];
  const slot = me.mainMonster.findIndex((s) => s === null);
  if (slot < 0) return out;
  // Tuners + non-tuners on field.
  const tuners: { id: InstanceId; level: number }[] = [];
  const nonTuners: { id: InstanceId; level: number }[] = [];
  for (const id of me.mainMonster) {
    if (!id) continue;
    const c = state.cards[id];
    if (!c || !c.faceUp) continue;
    try {
      const def = requireCard(c.defId);
      if (def.cardType !== "Monster" || def.level === undefined) continue;
      (def.isTuner ? tuners : nonTuners).push({ id, level: def.level });
    } catch { /* */ }
  }
  if (tuners.length === 0 || nonTuners.length === 0) return out;
  for (const sId of me.extraDeck) {
    const sc = state.cards[sId];
    if (!sc) continue;
    let sd;
    try { sd = requireCard(sc.defId); } catch { continue; }
    if (sd.cardType !== "Monster" || !sd.kinds.includes("Synchro") || !sd.level) continue;
    // Try each tuner with the smallest non-tuner subset summing to (level - tuner.level).
    for (const t of tuners) {
      const need = sd.level - t.level;
      if (need <= 0) continue;
      const subset = pickSubsetSummingTo(nonTuners, need);
      if (subset) {
        out.push({
          kind: "SynchroSummon",
          player: pid,
          synchroMonster: sId,
          tuner: t.id,
          nonTuners: subset,
          slot,
          position: "ATK",
        });
        break;
      }
    }
  }
  return out;
}

function legalXyzs(state: GameState, pid: PlayerId): Action[] {
  const out: Action[] = [];
  const me = state.players[pid];
  const slot = me.mainMonster.findIndex((s) => s === null);
  if (slot < 0) return out;
  // Group face-up monsters by level.
  const byLevel = new Map<number, InstanceId[]>();
  for (const id of me.mainMonster) {
    if (!id) continue;
    const c = state.cards[id];
    if (!c || !c.faceUp) continue;
    try {
      const def = requireCard(c.defId);
      if (def.cardType !== "Monster" || def.level === undefined) continue;
      if (!byLevel.has(def.level)) byLevel.set(def.level, []);
      byLevel.get(def.level)!.push(id);
    } catch { /* */ }
  }
  for (const xId of me.extraDeck) {
    const xc = state.cards[xId];
    if (!xc) continue;
    let xd;
    try { xd = requireCard(xc.defId); } catch { continue; }
    if (xd.cardType !== "Monster" || !xd.kinds.includes("Xyz") || xd.rank === undefined) continue;
    const pool = byLevel.get(xd.rank) ?? [];
    if (pool.length >= 2) {
      out.push({
        kind: "XyzSummon",
        player: pid,
        xyzMonster: xId,
        materials: pool.slice(0, 2),
        slot,
        position: "ATK",
      });
    }
  }
  return out;
}

function legalLinks(state: GameState, pid: PlayerId): Action[] {
  const out: Action[] = [];
  const emz = state.extraMonsterZones.findIndex((x) => x === null) as 0 | 1 | -1;
  if (emz < 0) return out;
  const me = state.players[pid];
  const monsters: { id: InstanceId; rating: number }[] = [];
  for (const id of me.mainMonster) {
    if (!id) continue;
    const c = state.cards[id];
    if (!c || !c.faceUp) continue;
    try {
      const def = requireCard(c.defId);
      if (def.cardType !== "Monster") continue;
      monsters.push({ id, rating: def.kinds.includes("Link") ? (def.linkRating ?? 1) : 1 });
    } catch { /* */ }
  }
  if (monsters.length === 0) return out;
  for (const lId of me.extraDeck) {
    const lc = state.cards[lId];
    if (!lc) continue;
    let ld;
    try { ld = requireCard(lc.defId); } catch { continue; }
    if (ld.cardType !== "Monster" || !ld.kinds.includes("Link") || !ld.linkRating) continue;
    const subset = pickSubsetSummingTo(monsters.map((m) => ({ id: m.id, level: m.rating })), ld.linkRating);
    if (subset) {
      out.push({
        kind: "LinkSummon",
        player: pid,
        linkMonster: lId,
        materials: subset,
        extraMonsterZone: emz as 0 | 1,
      });
    }
  }
  return out;
}

/** Greedy subset selection summing exactly to target. Returns ids or null. */
function pickSubsetSummingTo(
  items: { id: InstanceId; level: number }[],
  target: number,
): InstanceId[] | null {
  if (target <= 0) return null;
  const sorted = items.slice().sort((a, b) => b.level - a.level);
  const out: InstanceId[] = [];
  let sum = 0;
  for (const it of sorted) {
    if (sum + it.level <= target) {
      out.push(it.id);
      sum += it.level;
      if (sum === target) return out;
    }
  }
  return sum === target ? out : null;
}
