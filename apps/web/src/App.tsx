import { useEffect, useState } from "react";
import "@ygo/engine/cards"; // register sample cards so the client can render names
import { useDuel } from "./store.js";
import { connect, send } from "./net/ws-client.js";
import { ChainWindow } from "./components/ChainWindow.js";
import { Field } from "./components/Field.js";
import { Hand } from "./components/Hand.js";
import { PhaseBar } from "./components/PhaseBar.js";
import { EventLog } from "./components/EventLog.js";
import { starterDeck } from "./decks/starter.js";
import { startPracticeMatch } from "./practice/practice-mode.js";

const DEFAULT_WS = (import.meta as unknown as { env: Record<string, string> }).env
  .VITE_WS_URL ?? "ws://localhost:8787";

export function App(): JSX.Element {
  const { view, state, events, you, roomCode, opponentName, error } = useDuel();
  const [name, setName] = useState("Duelist");
  const [joinCode, setJoinCode] = useState("");

  useEffect(() => {
    connect(DEFAULT_WS);
  }, []);

  return (
    <div className="app">
      <div className="header">
        <h1 style={{ margin: 0, fontSize: "1.25rem" }}>Yu-Gi-Oh Fan Duel</h1>
        <small style={{ color: "#6b6b8a" }}>open-source · MVP</small>
      </div>

      {error && (
        <div className="panel" style={{ borderColor: "#8a2e2e" }}>{error}</div>
      )}

      {view === "landing" && (
        <div className="panel" style={{ display: "grid", gap: ".75rem", maxWidth: 480 }}>
          <label>
            Display name
            <input
              style={{ width: "100%", padding: ".4rem", marginTop: ".25rem", background: "#1e1e3c", color: "inherit", border: "1px solid #2a2a40", borderRadius: 6 }}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            onClick={() => startPracticeMatch(name, starterDeck)}
            style={{ background: "#3a8a5a", borderColor: "#5fbf85" }}
          >
            Practice vs AI (offline)
          </button>
          <button
            onClick={() => {
              send({ type: "hello", displayName: name });
              send({ type: "createRoom", deck: starterDeck });
            }}
          >
            Create private room
          </button>
          <div style={{ display: "flex", gap: ".5rem" }}>
            <input
              placeholder="room code"
              style={{ flex: 1, padding: ".4rem", background: "#1e1e3c", color: "inherit", border: "1px solid #2a2a40", borderRadius: 6 }}
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            />
            <button
              onClick={() => {
                send({ type: "hello", displayName: name });
                send({ type: "joinRoom", code: joinCode, deck: starterDeck });
              }}
            >
              Join
            </button>
          </div>
        </div>
      )}

      {view === "duel" && state && you !== null && (
        <>
          <PhaseBar state={state} you={you} />
          <ChainWindow state={state} you={you} />
          <Field state={state} you={you} />
          <Hand state={state} you={you} />
          <EventLog events={events} />
          <div style={{ color: "#6b6b8a", fontSize: 12 }}>
            Room: {roomCode} · Opponent: {opponentName || "(waiting…)"}
          </div>
        </>
      )}

      {view === "duel" && !state && (
        <div className="panel">Waiting for opponent… Room code: <strong>{roomCode}</strong></div>
      )}
    </div>
  );
}
