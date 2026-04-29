import type { GameState, PlayerId } from "@ygo/engine";
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
  if (!w) return null;
  const myTurnInWindow = w.priority === you;
  const responders = myTurnInWindow ? findActivatableResponders(state, you, w.trigger) : [];

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
      {myTurnInWindow && (
        <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", alignItems: "center" }}>
          {responders.length === 0 ? (
            <span style={{ opacity: 0.7 }}>Nothing to activate.</span>
          ) : (
            responders.map(({ source, reg }) => (
              <button
                key={source.instanceId}
                onClick={() =>
                  send({
                    type: "submitAction",
                    action: {
                      kind: "ChainRespond",
                      player: you,
                      source: source.instanceId,
                      effectKey: reg.effectKey,
                    },
                  })
                }
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
    </div>
  );
}
