import type { WebSocket } from "ws";
import type { ClientToServer, ServerToClient } from "@ygo/shared";
import {
  createInitialState,
  reduce,
  type GameState,
  type PlayerId,
} from "@ygo/engine";

interface Seat {
  clientId: string;
  ws: WebSocket;
  name: string;
  deck: number[];
}

/**
 * A single 1v1 duel. Server is authoritative: it holds the canonical
 * GameState and is the only place `reduce` is called for match play.
 */
export class DuelRoom {
  private seats: (Seat | null)[] = [null, null];
  private state: GameState | null = null;

  constructor(public readonly code: string) {}

  isFull(): boolean {
    return this.seats[0] !== null && this.seats[1] !== null;
  }
  isEmpty(): boolean {
    return this.seats[0] === null && this.seats[1] === null;
  }

  addClient(clientId: string, ws: WebSocket, name: string, deck: number[]): void {
    const pid: PlayerId = this.seats[0] === null ? 0 : 1;
    this.seats[pid] = { clientId, ws, name, deck };
    this.send(ws, {
      type: "roomJoined",
      code: this.code,
      you: pid,
      opponentName: this.seats[1 - pid]?.name ?? "",
    });
    const opp = this.seats[1 - pid];
    if (opp) {
      this.send(opp.ws, { type: "opponentJoined", name });
      this.startDuel();
    }
  }

  removeClient(clientId: string): void {
    for (let i = 0; i < 2; i++) {
      if (this.seats[i]?.clientId === clientId) this.seats[i] = null;
    }
  }

  handleMessage(clientId: string, msg: ClientToServer): void {
    const pid = this.seatOf(clientId);
    if (pid === null) return;
    if (msg.type === "submitAction") {
      this.applyAction(pid, msg.action);
    } else if (msg.type === "concede") {
      this.applyAction(pid, { kind: "Concede", player: pid });
    } else if (msg.type === "chat") {
      const from = this.seats[pid]!.name;
      for (const s of this.seats) if (s) this.send(s.ws, { type: "chat", from, text: msg.text });
    }
  }

  private seatOf(clientId: string): PlayerId | null {
    if (this.seats[0]?.clientId === clientId) return 0;
    if (this.seats[1]?.clientId === clientId) return 1;
    return null;
  }

  private startDuel(): void {
    const [p0, p1] = this.seats;
    if (!p0 || !p1) return;
    const initial = createInitialState(Date.now() >>> 0, p0.name, p1.name);
    const { state, events } = reduce(initial, {
      kind: "StartDuel",
      decks: { p0: p0.deck, p1: p1.deck },
      goingFirst: Math.random() < 0.5 ? 0 : 1,
    });
    this.state = state;
    this.broadcastState(events);
  }

  private applyAction(pid: PlayerId, action: import("@ygo/engine").Action): void {
    if (!this.state || this.state.ended) return;
    // Server-side sanity: reject actions attributed to the other seat.
    if ("player" in action && action.player !== pid) return;
    const { state, events } = reduce(this.state, action);
    this.state = state;
    this.broadcastState(events);
    if (state.ended) {
      for (const s of this.seats) {
        if (s) this.send(s.ws, { type: "duelEnded", winner: state.winner, reason: "duel over" });
      }
    }
  }

  private broadcastState(events: import("@ygo/engine").GameEvent[]): void {
    if (!this.state) return;
    for (let pid: PlayerId = 0; pid <= 1; pid = (pid + 1) as PlayerId) {
      const seat = this.seats[pid];
      if (!seat) continue;
      // Hidden info: hide opponent hand face-down contents. We still send
      // the full state for MVP simplicity; a fog-of-war pass comes later.
      this.send(seat.ws, { type: "duelState", state: this.state, events });
      if (pid === 1) break;
    }
  }

  private send(ws: WebSocket, msg: ServerToClient): void {
    ws.send(JSON.stringify(msg));
  }
}
