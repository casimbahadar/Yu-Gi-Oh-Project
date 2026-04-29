/**
 * Tiny heuristic AI policy. Given a state and a list of legal actions,
 * returns the one with the highest score under a hand-rolled heuristic.
 *
 * Not strong — but plays a recognisable game: summons its biggest
 * available beater, attacks anything weaker it can kill, sets traps,
 * activates Pot of Greed and Raigeki when reasonable, and ends phases
 * when it has nothing better to do.
 *
 * Designed to be replaced later with MCTS over the same legal-actions
 * enumerator + reducer (the state is `structuredClone`-able and the
 * reducer is deterministic, so a real search just plugs in here).
 */

import type { Action } from "../actions.js";
import { findActivatableResponders } from "../chain.js";
import { requireCard } from "../registry.js";
import type { GameState } from "../state.js";
import type { CardInstance, PlayerId } from "../types.js";
import { legalActions } from "./legal-actions.js";

export function pickAction(state: GameState, pid: PlayerId): Action | null {
  const actions = legalActions(state, pid);
  if (actions.length === 0) return null;

  // Chain windows: always pass unless we have a high-value response.
  if (state.pendingChainWindow) {
    const trigger = state.pendingChainWindow.trigger;
    const responders = findActivatableResponders(state, pid, trigger);
    // Heuristic: activate Mirror Force if the attacker has ≥1500 ATK,
    // activate Solemn Judgment only on a Normal Spell or a high-level summon.
    for (const { source, reg } of responders) {
      const def = requireCard(source.defId);
      if (def.id === 44095762 /* Mirror Force */ && trigger.kind === "AttackDeclared") {
        return {
          kind: "ChainRespond",
          player: pid,
          source: source.instanceId,
          effectKey: reg.effectKey,
        };
      }
      if (def.id === 41420027 /* Solemn Judgment */) {
        const lp = state.players[pid].lifePoints;
        if (lp < 2000) continue; // too costly to pay half
        if (
          (trigger.kind === "Summoned" && trigger.summonType === "Tribute") ||
          (trigger.kind === "SpellActivated")
        ) {
          return {
            kind: "ChainRespond",
            player: pid,
            source: source.instanceId,
            effectKey: reg.effectKey,
          };
        }
      }
    }
    return { kind: "ChainPass", player: pid };
  }

  let best: Action | null = null;
  let bestScore = -Infinity;
  for (const a of actions) {
    const s = scoreAction(state, pid, a);
    if (s > bestScore) {
      bestScore = s;
      best = a;
    }
  }
  return best;
}

function scoreAction(state: GameState, pid: PlayerId, a: Action): number {
  const opp = (1 - pid) as PlayerId;
  switch (a.kind) {
    case "Concede":
      return -10000;
    case "EndPhase":
      return 0;
    case "NormalSummon": {
      const c = state.cards[a.hand];
      if (!c) return -1000;
      const def = safeMonster(c.defId);
      if (!def) return -1000;
      // Prefer ATK position with biggest beater first.
      return 50 + (def.atk ?? 0) / 50 + (a.position === "ATK" ? 5 : 0);
    }
    case "SetMonster":
      return 5;
    case "TributeSummon": {
      const c = state.cards[a.hand];
      const def = c ? safeMonster(c.defId) : null;
      if (!def) return -1000;
      // Tribute summon score = monster's ATK minus the ATK we lose by tributing.
      let lostATK = 0;
      for (const t of a.tributes) {
        const mon = state.cards[t];
        if (!mon) continue;
        const md = safeMonster(mon.defId);
        if (md) lostATK += md.atk;
      }
      return 80 + (def.atk - lostATK) / 50;
    }
    case "PlaySpell": {
      const c = state.cards[a.hand];
      if (!c) return -1000;
      if (a.faceDown) return 4;
      // Activate score per known card.
      switch (c.defId) {
        case 53129443: // Pot of Greed
          return 100;
        case 12580477: { // Raigeki
          const oppMonsters = state.players[opp].mainMonster.filter((x) => x !== null).length;
          return oppMonsters >= 1 ? 60 + oppMonsters * 30 : -5;
        }
        case 83764718: { // Monster Reborn
          // Score based on best monster we'd revive.
          let best = 0;
          for (const pp of [pid, opp] as PlayerId[]) {
            for (const id of state.players[pp].graveyard) {
              const card = state.cards[id];
              if (!card) continue;
              const md = safeMonster(card.defId);
              if (md && md.atk > best) best = md.atk;
            }
          }
          return best > 0 ? 70 + best / 60 : -10;
        }
        default:
          return 10;
      }
    }
    case "SetTrap":
      return 8;
    case "ActivateSetSpell":
      // Activate set spells eagerly if they're useful — same heuristic
      // as PlaySpell minus the hand cost.
      return 50;
    case "ChangePosition":
      // Flipping a low-ATK monster to DEF after summoning is mildly good.
      return 1;
    case "FlipSummon":
      return 6;
    case "FusionSummon": {
      const c = state.cards[a.fusionMonster];
      if (!c) return -1000;
      const def = safeMonster(c.defId);
      if (!def) return -1000;
      let lostAtk = 0;
      for (const m of a.materials) {
        const card = state.cards[m];
        if (!card || card.location.zone !== "mainMonster") continue;
        const md = safeMonster(card.defId);
        if (md) lostAtk += md.atk;
      }
      return 150 + (def.atk - lostAtk) / 40;
    }
    case "SynchroSummon": {
      const c = state.cards[a.synchroMonster];
      const def = c ? safeMonster(c.defId) : null;
      if (!def) return -1000;
      let lost = 0;
      for (const id of [a.tuner, ...a.nonTuners]) {
        const card = state.cards[id];
        const md = card ? safeMonster(card.defId) : null;
        if (md && card?.location.zone === "mainMonster") lost += md.atk;
      }
      return 140 + (def.atk - lost) / 40;
    }
    case "XyzSummon": {
      const c = state.cards[a.xyzMonster];
      const def = c ? safeMonster(c.defId) : null;
      if (!def) return -1000;
      let lost = 0;
      for (const id of a.materials) {
        const card = state.cards[id];
        const md = card ? safeMonster(card.defId) : null;
        if (md) lost += md.atk;
      }
      return 130 + (def.atk - lost) / 40;
    }
    case "LinkSummon": {
      const c = state.cards[a.linkMonster];
      const def = c ? safeMonster(c.defId) : null;
      if (!def) return -1000;
      let lost = 0;
      for (const id of a.materials) {
        const card = state.cards[id];
        const md = card ? safeMonster(card.defId) : null;
        if (md) lost += md.atk;
      }
      return 130 + (def.atk - lost) / 40;
    }
    case "RitualSummon": {
      const c = state.cards[a.ritualMonster];
      const def = c ? safeMonster(c.defId) : null;
      if (!def) return -1000;
      let lost = 0;
      for (const id of a.tributes) {
        const card = state.cards[id];
        const md = card ? safeMonster(card.defId) : null;
        if (md) lost += md.atk;
      }
      return 120 + (def.atk - lost) / 40;
    }
    case "EquipSpell": {
      const target = state.cards[a.target];
      if (!target || target.controller !== pid) return -10;
      return 25; // moderate utility — boosts your monster
    }
    case "SetPendulumScale":
      return 12;
    case "PendulumSummon": {
      let total = 0;
      for (const m of a.monsters) {
        const c = state.cards[m.handInstance];
        const md = c ? safeMonster(c.defId) : null;
        if (md) total += md.atk;
      }
      return 100 + total / 50;
    }
    case "DeclareAttack": {
      const attacker = state.cards[a.attacker];
      const aDef = attacker ? safeMonster(attacker.defId) : null;
      if (!aDef) return -1000;
      if (a.target === "direct") {
        return 200 + aDef.atk / 30; // direct damage is gold
      }
      const tgt = state.cards[a.target];
      const tDef = tgt ? safeMonster(tgt.defId) : null;
      if (!tDef) return -1000;
      const targetATK = tgt!.position === "ATK" ? tDef.atk : tDef.def ?? 0;
      const damage = aDef.atk - targetATK;
      if (tgt!.position === "ATK") {
        if (damage > 0) return 100 + damage / 20;
        if (damage === 0) return -20; // mutual destruction
        return -50 - (-damage) / 20;
      }
      // ATK vs DEF: no LP damage, but we destroy if aATK > dDEF.
      if (damage > 0) return 30;
      if (damage === 0) return -1;
      return -10 - (-damage) / 30;
    }
    default:
      return 0;
  }
}

function safeMonster(defId: number): { atk: number; def?: number } | null {
  try {
    const d = requireCard(defId);
    return d.cardType === "Monster" ? { atk: d.atk, def: d.def } : null;
  } catch {
    return null;
  }
}

/** Used by the practice driver to render a friendly description of what the AI did. */
export function describeAction(a: Action, getName: (id: string) => string): string {
  switch (a.kind) {
    case "EndPhase": return "ends phase";
    case "NormalSummon": return `Normal Summons ${getName(a.hand)} in ${a.position}`;
    case "SetMonster": return `Sets a monster face-down`;
    case "TributeSummon": return `Tribute Summons ${getName(a.hand)}`;
    case "FusionSummon": return `Fusion Summons ${getName(a.fusionMonster)}`;
    case "SynchroSummon": return `Synchro Summons ${getName(a.synchroMonster)}`;
    case "XyzSummon": return `Xyz Summons ${getName(a.xyzMonster)}`;
    case "LinkSummon": return `Link Summons ${getName(a.linkMonster)}`;
    case "RitualSummon": return `Ritual Summons ${getName(a.ritualMonster)}`;
    case "SetPendulumScale": return `sets a Pendulum Scale`;
    case "PendulumSummon": return `Pendulum Summons ${a.monsters.length} monster(s)`;
    case "EquipSpell": return `equips ${getName(a.spell)} to ${getName(a.target)}`;
    case "PlaySpell": return a.faceDown ? `Sets a Spell` : `activates ${getName(a.hand)}`;
    case "SetTrap": return `Sets a Trap`;
    case "ActivateSetSpell": return `activates ${getName(a.spellTrap)}`;
    case "DeclareAttack":
      return a.target === "direct"
        ? `attacks directly with ${getName(a.attacker)}`
        : `attacks ${getName(a.target)} with ${getName(a.attacker)}`;
    case "ChangePosition": return `changes position`;
    case "FlipSummon": return `Flip Summons`;
    case "ChainPass": return `passes priority`;
    case "ChainRespond": return `activates ${getName(a.source)}`;
    case "Concede": return `concedes`;
    default: return a.kind;
  }
}

// Re-export the underlying `CardInstance` only so consumers that import
// from this barrel don't need a second path.
export type { CardInstance };
