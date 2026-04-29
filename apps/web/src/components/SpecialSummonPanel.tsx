import { useMemo } from "react";
import type { Action, GameState, PlayerId } from "@ygo/engine";
import { legalActions, requireCard } from "@ygo/engine";
import { send } from "../net/ws-client.js";

interface Props {
  state: GameState;
  you: PlayerId;
}

function nameOf(state: GameState, instanceId: string): string {
  const c = state.cards[instanceId];
  if (!c) return "?";
  if (c.defId === -1) return "(hidden)";
  try { return requireCard(c.defId).name; } catch { return `#${c.defId}`; }
}

/**
 * Lists every Synchro / Xyz / Link / Ritual / Pendulum-Summon action
 * the engine considers legal right now, plus the Set-Pendulum-Scale and
 * Pendulum-Summon-batch actions, as one-click buttons. Material choices
 * are whatever the AI's enumerator picked first (greedy by Level), which
 * is good enough for a playtest. Power-users can drop into the deeper
 * pickers in the Hand panel for explicit control over materials.
 */
export function SpecialSummonPanel({ state, you }: Props): JSX.Element | null {
  const yourTurn = state.turnPlayer === you;
  const actions = useMemo(() => {
    if (!yourTurn) return [];
    if (state.pendingChainWindow) return [];
    return legalActions(state, you).filter((a) =>
      a.kind === "SynchroSummon" ||
      a.kind === "XyzSummon" ||
      a.kind === "LinkSummon" ||
      a.kind === "RitualSummon" ||
      a.kind === "SetPendulumScale" ||
      a.kind === "PendulumSummon",
    );
  }, [state, you, yourTurn]);

  if (actions.length === 0) return null;

  const groups: Record<string, Action[]> = {
    "Synchro Summon": actions.filter((a) => a.kind === "SynchroSummon"),
    "Xyz Summon": actions.filter((a) => a.kind === "XyzSummon"),
    "Link Summon": actions.filter((a) => a.kind === "LinkSummon"),
    "Ritual Summon": actions.filter((a) => a.kind === "RitualSummon"),
    "Pendulum Summon": actions.filter((a) => a.kind === "PendulumSummon"),
    "Set Pendulum Scale": actions.filter((a) => a.kind === "SetPendulumScale"),
  };

  return (
    <div className="panel" style={{ borderColor: "#5fbf85" }}>
      <strong style={{ display: "block", marginBottom: 6 }}>Special Summons available</strong>
      <div style={{ display: "flex", flexWrap: "wrap", gap: ".5rem" }}>
        {Object.entries(groups).map(([label, list]) =>
          list.length === 0 ? null : (
            <div key={label} style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
              <small style={{ opacity: 0.6 }}>{label}:</small>
              {list.map((a, i) => {
                const text = describeButton(state, a);
                return (
                  <button
                    key={`${label}-${i}`}
                    onClick={() => send({ type: "submitAction", action: a })}
                    style={{ padding: "2px 6px", fontSize: 11 }}
                    title={text}
                  >{text}</button>
                );
              })}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function describeButton(state: GameState, a: Action): string {
  switch (a.kind) {
    case "SynchroSummon": return nameOf(state, a.synchroMonster);
    case "XyzSummon": return nameOf(state, a.xyzMonster);
    case "LinkSummon": return nameOf(state, a.linkMonster);
    case "RitualSummon": return nameOf(state, a.ritualMonster);
    case "SetPendulumScale": return `Set Pendulum (${a.side}) — ${nameOf(state, a.hand)}`;
    case "PendulumSummon": return `Summon ${a.monsters.length} from hand`;
    default: return a.kind;
  }
}
