import { useState } from "react";
import type { GameState, InstanceId, PlayerId } from "@ygo/engine";
import { findActivatableResponders, requireCard } from "@ygo/engine";
import { send } from "../net/ws-client.js";

interface Props {
  state: GameState;
  you: PlayerId;
}

function describeTrigger(state: GameState, t: GameState["pendingChainWindow"]): string {
  if (!t) return "";
  switch (t.trigger.kind) {
    case "AttackDeclared": {
      const att = state.cards[t.trigger.attacker];
      const attName = att?.defId !== -1 && att ? safeName(att.defId) : "(hidden)";
      const target =
        t.trigger.target === "direct"
          ? "directly"
          : `${safeName(state.cards[t.trigger.target]?.defId ?? -1)}`;
      return `Player ${t.trigger.attackingPlayer} declared an attack with ${attName} → ${target}.`;
    }
    case "Summoned": {
      const c = state.cards[t.trigger.instanceId];
      const name = c && c.defId !== -1 ? safeName(c.defId) : "(hidden)";
      return `Player ${t.trigger.player} ${t.trigger.summonType} Summoned ${name}.`;
    }
    case "SpellActivated": {
      const c = state.cards[t.trigger.source];
      const name = c && c.defId !== -1 ? safeName(c.defId) : "(hidden)";
      return `Player ${t.trigger.player} activated ${name}.`;
    }
  }
}

function safeName(defId: number): string {
  if (defId === -1) return "(hidden)";
  try {
    return requireCard(defId).name;
  } catch {
    return `#${defId}`;
  }
}

export function ChainWindow({ state, you }: Props): JSX.Element | null {
  const w = state.pendingChainWindow;
  // Hooks must run unconditionally — keep state at the top, render null below.
  const [pendingMstFor, setPendingMstFor] = useState<InstanceId | null>(null);
  if (!w) return null;
  const myTurnInWindow = w.priority === you;
  const responders = myTurnInWindow ? findActivatableResponders(state, you, w.trigger) : [];
  const opp = (1 - you) as PlayerId;

  // MST target picker — face-up Spell/Trap of the opponent.
  const mstTargets: InstanceId[] = [];
  for (const id of state.players[opp].spellTrap) {
    if (!id) continue;
    const c = state.cards[id];
    if (!c || !c.faceUp) continue;
    mstTargets.push(id);
  }

  return (
    <div
      className="panel"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 5,
        borderColor: "#e9c46a",
        boxShadow: "0 0 12px rgba(233,196,106,0.25)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <strong>Chain window {state.chain.length > 0 ? `· ${state.chain.length} link(s)` : ""}</strong>
        <small style={{ opacity: 0.7 }}>
          Priority: Player {w.priority} {myTurnInWindow ? "(you)" : "(opponent)"}
        </small>
      </div>
      <div style={{ marginBottom: 8, fontSize: 13 }}>{describeTrigger(state, w)}</div>
      {!myTurnInWindow && <div style={{ opacity: 0.6 }}>Waiting on opponent…</div>}
      {myTurnInWindow && !pendingMstFor && (
        <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", alignItems: "center" }}>
          {responders.length === 0 ? (
            <span style={{ opacity: 0.7 }}>Nothing to activate.</span>
          ) : (
            responders.map(({ source, reg }) => (
              <button
                key={source.instanceId}
                onClick={() => {
                  // MST needs a target — open inline picker before submit.
                  if (source.defId === 5318639 /* MST */) {
                    setPendingMstFor(source.instanceId);
                    return;
                  }
                  send({
                    type: "submitAction",
                    action: {
                      kind: "ChainRespond",
                      player: you,
                      source: source.instanceId,
                      effectKey: reg.effectKey,
                    },
                  });
                }}
                title={safeName(source.defId)}
              >
                Activate {safeName(source.defId)}
              </button>
            ))
          )}
          <button
            onClick={() =>
              send({ type: "submitAction", action: { kind: "ChainPass", player: you } })
            }
          >
            Pass
          </button>
        </div>
      )}
      {pendingMstFor && (
        <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", alignItems: "center" }}>
          <span>MST target:</span>
          {mstTargets.length === 0 && <span style={{ opacity: 0.6 }}>(no face-up Spells/Traps to destroy)</span>}
          {mstTargets.map((tid) => (
            <button
              key={tid}
              onClick={() => {
                send({
                  type: "submitAction",
                  action: {
                    kind: "ChainRespond",
                    player: you,
                    source: pendingMstFor,
                    effectKey: "spell:mst:destroy-st",
                    payload: { target: tid },
                  },
                });
                setPendingMstFor(null);
              }}
            >{safeName(state.cards[tid]?.defId ?? -1)}</button>
          ))}
          <button onClick={() => setPendingMstFor(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
