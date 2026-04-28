import { create } from "zustand";
import type { GameEvent, GameState, PlayerId } from "@ygo/engine";

export type View = "landing" | "lobby" | "duel";

interface DuelStore {
  view: View;
  clientId: string | null;
  displayName: string;
  roomCode: string | null;
  you: PlayerId | null;
  opponentName: string;
  state: GameState | null;
  events: GameEvent[];
  chat: { from: string; text: string }[];
  error: string | null;
  setView: (v: View) => void;
  setHello: (id: string) => void;
  setRoom: (code: string, you: PlayerId | null) => void;
  setOpponent: (name: string) => void;
  setState: (s: GameState, ev: GameEvent[]) => void;
  pushChat: (m: { from: string; text: string }) => void;
  setError: (msg: string | null) => void;
}

export const useDuel = create<DuelStore>((set) => ({
  view: "landing",
  clientId: null,
  displayName: "Duelist",
  roomCode: null,
  you: null,
  opponentName: "",
  state: null,
  events: [],
  chat: [],
  error: null,
  setView: (view) => set({ view }),
  setHello: (clientId) => set({ clientId }),
  setRoom: (code, you) => set({ roomCode: code, you, view: "duel" }),
  setOpponent: (opponentName) => set({ opponentName }),
  setState: (state, events) => set({ state, events }),
  pushChat: (m) => set((s) => ({ chat: [...s.chat, m].slice(-50) })),
  setError: (error) => set({ error }),
}));
