import { useEffect, useRef, useState } from "react";
import type { GameEvent } from "@ygo/engine";

interface Props {
  events: GameEvent[];
}

interface Entry {
  id: number;
  text: string;
}

let nextId = 1;

function pick(ev: GameEvent, key: string): unknown {
  return (ev as unknown as Record<string, unknown>)[key];
}

function describe(ev: GameEvent): string | null {
  const get = (k: string): unknown => pick(ev, k);
  switch (ev.kind) {
    case "DuelStarted":
      return `Duel started — Player ${get("goingFirst")} goes first.`;
    case "TurnStarted":
      return `Turn ${get("turn")} — Player ${get("player")}.`;
    case "PhaseEntered":
      return `Phase: ${get("phase")}.`;
    case "Drew":
      return `Player ${get("player")} drew a card.`;
    case "NormalSummon":
      return `Player ${get("player")} Normal Summoned ${get("instanceId")}.`;
    case "MonsterSet":
      return `Player ${get("player")} Set a monster.`;
    case "BattleResolved": {
      const mode = get("mode");
      const stats = mode === "ATKvsATK"
        ? `(${get("targetATK")} ATK)`
        : `(${get("targetDEF")} DEF)`;
      return `${get("attacker")} (${get("attackerATK")} ATK) vs ${get("target")} ${stats}.`;
    }
    case "DirectAttack":
      return `${get("attacker")} attacks directly for ${get("damage")}.`;
    case "FlippedFaceUp":
      return `${get("instanceId")} flipped face-up.`;
    case "Destroyed":
      return `${get("instanceId")} destroyed.`;
    case "LifePointsChanged": {
      const delta = Number(get("delta"));
      return `Player ${get("player")} LP ${delta >= 0 ? "+" : ""}${delta} → ${get("total")}.`;
    }
    case "Victory":
      return `Player ${get("player")} wins (${get("reason")}).`;
    case "Concede":
      return `Player ${get("player")} conceded.`;
    case "DeckOut":
      return `Player ${get("player")} decked out.`;
    case "ActionRejected":
      return `⚠ Rejected: ${get("error")}`;
    default:
      return null;
  }
}

export function EventLog({ events }: Props): JSX.Element {
  const [entries, setEntries] = useState<Entry[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!events || events.length === 0) return;
    const newEntries: Entry[] = [];
    for (const ev of events) {
      const text = describe(ev);
      if (text) newEntries.push({ id: nextId++, text });
    }
    if (newEntries.length === 0) return;
    setEntries((prev) => [...prev.slice(-99), ...newEntries].slice(-100));
  }, [events]);

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <div className="panel" style={{ maxHeight: 160, overflow: "hidden" }}>
      <h3 style={{ margin: "0 0 .5rem" }}>Log</h3>
      <div ref={containerRef} style={{ maxHeight: 120, overflow: "auto", fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
        {entries.length === 0 ? (
          <div style={{ opacity: 0.5 }}>(empty)</div>
        ) : (
          entries.map((e) => <div key={e.id}>{e.text}</div>)
        )}
      </div>
    </div>
  );
}
