import { useState } from "react";
import type { GameState, InstanceId, PlayerId } from "@ygo/engine";
import { requireCard } from "@ygo/engine";
import { send } from "../net/ws-client.js";

interface Props {
  state: GameState;
  you: PlayerId;
}

type PendingTribute = {
  handId: InstanceId;
  required: number;
  selected: InstanceId[];
};

function firstFreeMonsterSlot(state: GameState, pid: PlayerId): number {
  return state.players[pid].mainMonster.findIndex((s) => s === null);
}
function firstFreeSpellTrapSlot(state: GameState, pid: PlayerId): number {
  return state.players[pid].spellTrap.findIndex((s) => s === null);
}

export function Hand({ state, you }: Props): JSX.Element {
  const ids = state.players[you].hand;
  const yourTurn = state.turnPlayer === you;
  const inMain = state.phase === "Main1" || state.phase === "Main2";
  const summonAvailable =
    yourTurn && inMain && state.players[you].normalSummonsUsed < state.players[you].normalSummonLimit;

  const [pendingTribute, setPendingTribute] = useState<PendingTribute | null>(null);

  const submitTribute = (handId: InstanceId, position: "ATK" | "DEF"): void => {
    if (!pendingTribute) return;
    if (pendingTribute.selected.length !== pendingTribute.required) return;
    const slot = firstFreeMonsterSlot(state, you);
    if (slot < 0) return;
    send({
      type: "submitAction",
      action: {
        kind: "TributeSummon",
        player: you,
        hand: handId,
        slot,
        tributes: pendingTribute.selected,
        position,
      },
    });
    setPendingTribute(null);
  };

  return (
    <div className="panel">
      <h3 style={{ margin: "0 0 .5rem" }}>Your Hand ({ids.length})</h3>
      <div className="hand">
        {ids.map((id) => {
          const card = state.cards[id]!;
          let name = card.defId === -1 ? "(hidden)" : `#${card.defId}`;
          let cardType: "Monster" | "Spell" | "Trap" | "?" = "?";
          let level: number | undefined;
          let stats = "";
          let spellKind: string | undefined;
          if (card.defId !== -1) {
            try {
              const def = requireCard(card.defId);
              name = def.name;
              cardType = def.cardType;
              if (def.cardType === "Monster") {
                level = def.level;
                stats = `${def.atk}/${def.def ?? "—"}`;
              } else if (def.cardType === "Spell") {
                spellKind = def.kind;
              }
            } catch { /* unknown */ }
          }

          const monsterTier = cardType === "Monster" && level !== undefined
            ? (level <= 4 ? "normal" : level <= 6 ? "trib1" : level <= 8 ? "trib2" : "trib3")
            : null;

          const canNormalSummon = summonAvailable && monsterTier === "normal";
          const canTribute1 =
            summonAvailable && monsterTier === "trib1" &&
            state.players[you].mainMonster.filter((x) => x !== null).length >= 1;
          const canTribute2 =
            summonAvailable && monsterTier === "trib2" &&
            state.players[you].mainMonster.filter((x) => x !== null).length >= 2;
          const canSetMonster = summonAvailable && monsterTier === "normal";

          const canActivateSpell =
            yourTurn && inMain && cardType === "Spell" && spellKind === "Normal" &&
            firstFreeSpellTrapSlot(state, you) >= 0;
          const canSetSpellTrap =
            yourTurn && inMain && (cardType === "Spell" || cardType === "Trap") &&
            firstFreeSpellTrapSlot(state, you) >= 0;

          return (
            <div key={id} className="slot filled" style={{ minWidth: 110, display: "flex", flexDirection: "column", gap: 4 }}>
              <small style={{ fontWeight: 600 }}>{name}</small>
              {stats && <small style={{ opacity: 0.7 }}>{stats}{level ? ` · L${level}` : ""}</small>}
              {!stats && cardType !== "?" && <small style={{ opacity: 0.7 }}>{cardType}{spellKind ? ` · ${spellKind}` : ""}</small>}

              {canNormalSummon && (
                <button
                  onClick={() => {
                    const slot = firstFreeMonsterSlot(state, you);
                    if (slot < 0) return;
                    send({ type: "submitAction", action: { kind: "NormalSummon", player: you, hand: id, slot, position: "ATK" } });
                  }}
                >Summon ATK</button>
              )}
              {canSetMonster && (
                <button
                  onClick={() => {
                    const slot = firstFreeMonsterSlot(state, you);
                    if (slot < 0) return;
                    send({ type: "submitAction", action: { kind: "SetMonster", player: you, hand: id, slot } });
                  }}
                >Set Monster</button>
              )}
              {(canTribute1 || canTribute2) && (
                <button
                  onClick={() =>
                    setPendingTribute({
                      handId: id,
                      required: canTribute2 ? 2 : 1,
                      selected: [],
                    })
                  }
                >Tribute Summon ({canTribute2 ? 2 : 1})</button>
              )}
              {canActivateSpell && (
                <button
                  onClick={() => {
                    const slot = firstFreeSpellTrapSlot(state, you);
                    if (slot < 0) return;
                    // Monster Reborn needs a target — UI for graveyard picker
                    // is not in this round, so refuse to fizzle. Skip if no
                    // payload-required spell. For now, if it's Monster Reborn,
                    // pick the first monster in either GY automatically.
                    let payload: Record<string, unknown> | undefined;
                    if (card.defId === 83764718) {
                      const target = pickFirstGraveyardMonster(state);
                      if (!target) {
                        alert("No monsters in either Graveyard to revive.");
                        return;
                      }
                      payload = { target };
                    }
                    send({
                      type: "submitAction",
                      action: { kind: "PlaySpell", player: you, hand: id, slot, faceDown: false, payload },
                    });
                  }}
                >Activate</button>
              )}
              {canSetSpellTrap && (
                <button
                  onClick={() => {
                    const slot = firstFreeSpellTrapSlot(state, you);
                    if (slot < 0) return;
                    if (cardType === "Trap") {
                      send({ type: "submitAction", action: { kind: "SetTrap", player: you, hand: id, slot } });
                    } else {
                      send({ type: "submitAction", action: { kind: "PlaySpell", player: you, hand: id, slot, faceDown: true } });
                    }
                  }}
                >Set</button>
              )}
            </div>
          );
        })}
      </div>

      {pendingTribute && (
        <TributePicker
          state={state}
          you={you}
          pending={pendingTribute}
          onChange={setPendingTribute}
          onConfirmATK={(handId) => submitTribute(handId, "ATK")}
          onConfirmDEF={(handId) => submitTribute(handId, "DEF")}
          onCancel={() => setPendingTribute(null)}
        />
      )}
    </div>
  );
}

function pickFirstGraveyardMonster(state: GameState): InstanceId | null {
  for (let pid = 0; pid <= 1; pid++) {
    for (const id of state.players[pid as 0 | 1].graveyard) {
      const card = state.cards[id];
      if (!card) continue;
      try {
        const def = requireCard(card.defId);
        if (def.cardType === "Monster") return id;
      } catch { /* ignore */ }
    }
  }
  return null;
}

function TributePicker({
  state, you, pending, onChange, onConfirmATK, onConfirmDEF, onCancel,
}: {
  state: GameState;
  you: PlayerId;
  pending: PendingTribute;
  onChange: (p: PendingTribute) => void;
  onConfirmATK: (handId: InstanceId) => void;
  onConfirmDEF: (handId: InstanceId) => void;
  onCancel: () => void;
}): JSX.Element {
  const monsters = state.players[you].mainMonster.filter((x): x is InstanceId => x !== null);
  const toggle = (id: InstanceId): void => {
    const isSelected = pending.selected.includes(id);
    let next = isSelected
      ? pending.selected.filter((x) => x !== id)
      : [...pending.selected, id];
    if (next.length > pending.required) next = next.slice(-pending.required);
    onChange({ ...pending, selected: next });
  };
  const ready = pending.selected.length === pending.required;
  return (
    <div className="panel" style={{ marginTop: ".5rem", borderColor: "#e9c46a" }}>
      <div style={{ marginBottom: ".5rem" }}>
        Pick {pending.required} monster{pending.required > 1 ? "s" : ""} to tribute ({pending.selected.length}/{pending.required}):
      </div>
      <div className="hand">
        {monsters.map((id) => {
          const card = state.cards[id]!;
          let name = `#${card.defId}`;
          try { name = requireCard(card.defId).name; } catch { /* */ }
          const selected = pending.selected.includes(id);
          return (
            <div
              key={id}
              className={`slot filled ${selected ? "selected" : "selectable"}`}
              style={{ cursor: "pointer", minWidth: 90 }}
              onClick={() => toggle(id)}
            >
              <small>{name}</small>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: ".5rem", marginTop: ".5rem" }}>
        <button disabled={!ready} onClick={() => onConfirmATK(pending.handId)}>Tribute → ATK</button>
        <button disabled={!ready} onClick={() => onConfirmDEF(pending.handId)}>Tribute → DEF</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
