import { useState } from "react";
import type { GameState, InstanceId, PlayerId } from "@ygo/engine";
import { requireCard } from "@ygo/engine";
import { send } from "../net/ws-client.js";

interface Props {
  state: GameState;
  you: PlayerId;
}

interface SlotProps {
  state: GameState;
  id: InstanceId | null;
  selectable: boolean;
  selected: boolean;
  attackable: boolean;
  onClick?: () => void;
}

function CardSlot({ state, id, selectable, selected, attackable, onClick }: SlotProps): JSX.Element {
  if (!id) return <div className="slot">·</div>;
  const card = state.cards[id];
  if (!card) return <div className="slot">?</div>;
  let label = `#${card.defId}`;
  let stats = "";
  try {
    const def = requireCard(card.defId);
    label = def.name;
    if (def.cardType === "Monster") {
      const atk = def.atk;
      const defv = def.def ?? "—";
      stats = `${atk} / ${defv}`;
    }
  } catch { /* unknown card */ }
  const positionLabel =
    card.position === "ATK" ? "ATK"
    : card.position === "DEF" ? "DEF"
    : card.position === "FaceDownDEF" ? "set"
    : "";
  const cls = [
    "slot",
    "filled",
    selectable ? "selectable" : "",
    selected ? "selected" : "",
    attackable ? "attackable" : "",
  ].filter(Boolean).join(" ");
  return (
    <div
      className={cls}
      title={card.faceUp ? label : "(face-down)"}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      style={{ cursor: onClick ? "pointer" : "default" }}
    >
      <small style={{ display: "block", lineHeight: 1.1 }}>
        {card.faceUp ? label : "set"}
      </small>
      {card.faceUp && stats && <small style={{ opacity: 0.6 }}>{stats}</small>}
      {positionLabel && <small style={{ opacity: 0.6 }}>{positionLabel}</small>}
    </div>
  );
}

export function Field({ state, you }: Props): JSX.Element {
  const opp = (1 - you) as PlayerId;
  const me = state.players[you];
  const them = state.players[opp];

  const yourBattleStep =
    state.phase === "BattleStep" && state.turnPlayer === you && !state.ended;

  const [selectedAttacker, setSelectedAttacker] = useState<InstanceId | null>(null);

  // Validate the stored attacker still belongs to us / hasn't attacked.
  const attacker = selectedAttacker ? state.cards[selectedAttacker] : null;
  const attackerStillValid =
    !!attacker &&
    attacker.controller === you &&
    attacker.location.zone === "mainMonster" &&
    attacker.position === "ATK" &&
    attacker.faceUp &&
    attacker.flags.hasAttacked !== true;

  if (selectedAttacker && !attackerStillValid) {
    // Reset on next render via state — done below in click handler reset path.
  }

  const oppHasMonster = them.mainMonster.some((id) => id !== null);

  const declareAttack = (target: InstanceId | "direct"): void => {
    if (!selectedAttacker || !attackerStillValid) return;
    send({
      type: "submitAction",
      action: {
        kind: "DeclareAttack",
        player: you,
        attacker: selectedAttacker,
        target,
      },
    });
    setSelectedAttacker(null);
  };

  const yourMonsterClickable = (id: InstanceId | null): boolean => {
    if (!yourBattleStep || !id) return false;
    const c = state.cards[id];
    return !!c && c.position === "ATK" && c.faceUp && c.flags.hasAttacked !== true;
  };
  const oppMonsterAttackable = (id: InstanceId | null): boolean =>
    yourBattleStep && !!id && attackerStillValid;

  return (
    <div className="field" aria-label="duel field">
      <div>
        <div className="header">
          <strong>{them.name}</strong>
          <span className="lp">LP {them.lifePoints}</span>
        </div>
        <div className="row">
          {them.spellTrap.map((id, i) => (
            <CardSlot
              key={`ost-${i}`}
              state={state}
              id={id}
              selectable={false}
              selected={false}
              attackable={false}
            />
          ))}
        </div>
        <div className="row">
          {them.mainMonster.map((id, i) => (
            <CardSlot
              key={`omm-${i}`}
              state={state}
              id={id}
              selectable={false}
              selected={false}
              attackable={oppMonsterAttackable(id)}
              onClick={oppMonsterAttackable(id) ? () => declareAttack(id!) : undefined}
            />
          ))}
        </div>
      </div>

      {yourBattleStep && (
        <div style={{ display: "flex", gap: ".5rem", alignItems: "center", flexWrap: "wrap" }}>
          {selectedAttacker && attackerStillValid ? (
            <>
              <span>Attacker selected.</span>
              {!oppHasMonster && (
                <button onClick={() => declareAttack("direct")}>Direct attack</button>
              )}
              <button onClick={() => setSelectedAttacker(null)}>Cancel</button>
            </>
          ) : (
            <span style={{ opacity: 0.6 }}>
              Click one of your face-up ATK monsters to declare an attack.
            </span>
          )}
        </div>
      )}

      <div>
        <div className="row">
          {me.mainMonster.map((id, i) => (
            <CardSlot
              key={`mm-${i}`}
              state={state}
              id={id}
              selectable={yourMonsterClickable(id)}
              selected={!!id && id === selectedAttacker}
              attackable={false}
              onClick={yourMonsterClickable(id) ? () => setSelectedAttacker(id!) : undefined}
            />
          ))}
        </div>
        <div className="row">
          {me.spellTrap.map((id, i) => (
            <CardSlot
              key={`st-${i}`}
              state={state}
              id={id}
              selectable={false}
              selected={false}
              attackable={false}
            />
          ))}
        </div>
        <div className="header">
          <strong>{me.name} (you)</strong>
          <span className="lp">LP {me.lifePoints}</span>
        </div>
      </div>
    </div>
  );
}
