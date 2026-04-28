import type { WebSocket } from "ws";
import type { ClientToServer, ServerToClient } from "@ygo/shared";
import { DuelRoom } from "./duel-room.js";

interface Client {
  id: string;
  ws: WebSocket;
  displayName: string;
  roomCode: string | null;
}

/**
 * Lobby tracks connected clients, creates private duel rooms, and
 * routes messages. No matchmaking queue yet — MVP ships with private
 * rooms only; casual/ranked queues slot in as additional methods.
 */
export class Lobby {
  private clients = new Map<string, Client>();
  private rooms = new Map<string, DuelRoom>();

  handleConnection(ws: WebSocket): void {
    const id = cryptoRandomId();
    const client: Client = { id, ws, displayName: "Duelist", roomCode: null };
    this.clients.set(id, client);
    this.send(ws, { type: "welcome", clientId: id });

    ws.on("message", (raw) => {
      let msg: ClientToServer;
      try {
        msg = JSON.parse(raw.toString()) as ClientToServer;
      } catch {
        return this.send(ws, { type: "error", message: "invalid json" });
      }
      this.onMessage(client, msg);
    });

    ws.on("close", () => {
      if (client.roomCode) {
        const room = this.rooms.get(client.roomCode);
        room?.removeClient(client.id);
        if (room?.isEmpty()) this.rooms.delete(client.roomCode);
      }
      this.clients.delete(id);
    });
  }

  private onMessage(client: Client, msg: ClientToServer): void {
    switch (msg.type) {
      case "hello":
        client.displayName = msg.displayName.slice(0, 32);
        return;
      case "createRoom": {
        const code = randomRoomCode();
        const room = new DuelRoom(code);
        this.rooms.set(code, room);
        room.addClient(client.id, client.ws, client.displayName, msg.deck);
        client.roomCode = code;
        this.send(client.ws, { type: "roomCreated", code });
        return;
      }
      case "joinRoom": {
        const room = this.rooms.get(msg.code);
        if (!room) return this.send(client.ws, { type: "error", message: "room not found" });
        if (room.isFull()) return this.send(client.ws, { type: "error", message: "room full" });
        room.addClient(client.id, client.ws, client.displayName, msg.deck);
        client.roomCode = msg.code;
        return;
      }
      case "submitAction":
      case "concede":
      case "chat":
      case "leave": {
        if (!client.roomCode) {
          return this.send(client.ws, { type: "error", message: "not in a room" });
        }
        const room = this.rooms.get(client.roomCode);
        room?.handleMessage(client.id, msg);
        return;
      }
    }
  }

  private send(ws: WebSocket, msg: ServerToClient): void {
    ws.send(JSON.stringify(msg));
  }
}

function cryptoRandomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function randomRoomCode(): string {
  // 6-char uppercase code, easy to share verbally.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
