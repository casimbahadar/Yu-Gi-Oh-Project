import type { ClientToServer, ServerToClient } from "@ygo/shared";
import { useDuel } from "../store.js";

let socket: WebSocket | null = null;
let localSubmitter: ((msg: ClientToServer) => void) | null = null;

/**
 * Practice mode plugs in a local submitter to bypass the WebSocket
 * entirely. When set, every `send` is routed here instead of the socket.
 */
export function setLocalSubmitter(fn: ((msg: ClientToServer) => void) | null): void {
  localSubmitter = fn;
}

export function connect(url: string): WebSocket {
  if (socket && socket.readyState === WebSocket.OPEN) return socket;
  try {
    socket = new WebSocket(url);
  } catch {
    return null as unknown as WebSocket;
  }
  socket.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data as string) as ServerToClient;
    handle(msg);
  });
  socket.addEventListener("close", () => {
    // Only surface the disconnect message when we're not in practice mode.
    if (!localSubmitter) useDuel.getState().setError("Disconnected from server");
  });
  socket.addEventListener("error", () => {
    if (!localSubmitter) useDuel.getState().setError("WebSocket error");
  });
  return socket;
}

export function send(msg: ClientToServer): void {
  if (localSubmitter) {
    localSubmitter(msg);
    return;
  }
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    useDuel.getState().setError("Not connected");
    return;
  }
  socket.send(JSON.stringify(msg));
}

function handle(msg: ServerToClient): void {
  const store = useDuel.getState();
  switch (msg.type) {
    case "welcome":
      store.setHello(msg.clientId);
      return;
    case "roomCreated":
      store.setRoom(msg.code, store.you);
      return;
    case "roomJoined":
      store.setRoom(msg.code, msg.you);
      store.setOpponent(msg.opponentName);
      return;
    case "opponentJoined":
      store.setOpponent(msg.name);
      return;
    case "duelState":
      store.setState(msg.state, msg.events);
      return;
    case "duelEnded":
      store.pushChat({ from: "system", text: `Duel ended. Winner: ${msg.winner ?? "draw"} (${msg.reason})` });
      return;
    case "chat":
      store.pushChat({ from: msg.from, text: msg.text });
      return;
    case "error":
      store.setError(msg.message);
      return;
  }
}
