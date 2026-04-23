import { WebSocketServer } from "ws";
import "@ygo/engine/cards"; // side-effect: populate sample card registry
import { Lobby } from "./lobby.js";

const PORT = Number(process.env.PORT ?? 8787);
const wss = new WebSocketServer({ port: PORT });
const lobby = new Lobby();

wss.on("connection", (ws) => {
  lobby.handleConnection(ws);
});

console.log(`[ygo-server] listening on ws://localhost:${PORT}`);
