import type { GameState, PlayerId } from "@ygo/engine";
import { send } from "../net/ws-client.js";

interface Props {
  state: GameState;
  you: PlayerId;
}

export function PhaseBar({ state, you }: Props): JSX.Element {
  const yourTurn = state.turnPlayer === you;
  return (
    <div className="panel" style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
      <span>
        Turn {state.turn} · {yourTurn ? "Your turn" : "Opponent's turn"} · Phase: <strong>{state.phase}</strong>
      </span>
      <div style={{ flex: 1 }} />
      {yourTurn && (
        <>
          <button onClick={() => send({ type: "submitAction", action: { kind: "EndPhase" } })}>
            End Phase
          </button>
          <button onClick={() => send({ type: "concede" })}>Concede</button>
        </>
      )}
    </div>
  );
}
