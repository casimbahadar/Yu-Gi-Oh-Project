import type { GameState, PlayerId } from "@ygo/engine";
import { send } from "../net/ws-client.js";

interface Props {
  state: GameState;
  you: PlayerId;
}

export function PhaseBar({ state, you }: Props): JSX.Element {
  const yourTurn = state.turnPlayer === you;
  const phase = state.phase;
  const showGoToBattle = yourTurn && (phase === "Main1") && state.turn > 1;
  const showGoToBattleStep = yourTurn && phase === "BattleStart";
  const showEndBattle = yourTurn && phase === "BattleStep";
  return (
    <div className="panel" style={{ display: "flex", gap: ".5rem", alignItems: "center", flexWrap: "wrap" }}>
      <span>
        Turn {state.turn} · {yourTurn ? "Your turn" : "Opponent's turn"} · Phase: <strong>{phase}</strong>
      </span>
      <div style={{ flex: 1 }} />
      {yourTurn && (
        <>
          <button onClick={() => send({ type: "submitAction", action: { kind: "EndPhase" } })}>
            {phase === "Draw" ? "→ Standby"
            : phase === "Standby" ? "→ Main1"
            : phase === "BattleStart" ? "→ Battle Step"
            : phase === "BattleStep" ? "End Battle Phase"
            : phase === "BattleEnd" ? "→ Main2"
            : phase === "Main1" ? "End Turn (skip Battle)"
            : phase === "Main2" ? "End Turn"
            : "Next Phase"}
          </button>
          {showGoToBattle && (
            <button
              onClick={() => {
                // Main1 → BattleStart (one EndPhase tick).
                send({ type: "submitAction", action: { kind: "EndPhase" } });
              }}
              style={{ display: "none" }}
            >
              {/* placeholder so logic stays explicit */}
            </button>
          )}
          {showGoToBattleStep && <span style={{ opacity: 0.6 }}>(advance to declare attacks)</span>}
          {showEndBattle && <span style={{ opacity: 0.6 }}>(click your monster, then a target)</span>}
          <button onClick={() => send({ type: "concede" })}>Concede</button>
        </>
      )}
    </div>
  );
}
