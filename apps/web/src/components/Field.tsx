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
  footer?: JSX.Element | null;
}

function CardSlot({ state, id, selectable, selected, attackable, onClick, footer }: SlotProps): JSX.Element {
  if (!id) return <div className="slot">·</div>;
  const card = state.cards[id];
  if (!card) return <div className="slot">?</div>;
  let label = card.defId === -1 ? "(hidden)" : `#${card.defId}`;
  let stats = "";
  if (card.defId !== -1) {
    try {
      const def = requireCard(card.defId);
      label = def.name;
      if (def.cardType === "Monster") {
        const atk = def.atk;
        const defv = def.def ?? "—";
        stats = `${atk} / ${defv}`;
      }
    } catch { /* unknown card */ }
  }
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
      style={{ cursor: onClick ? "pointer" : "default", display: "flex", flexDirection: "column", justifyContent: "space-between" }}
    >
      <div>
        <small style={{ display: "block", lineHeight: 1.1, fontWeight: 600 }}>
          {card.faceUp ? label : "set"}
        </small>
        {card.faceUp && stats && <small style={{ opacity: 0.6 }}>{stats}</small>}
        {positionLabel && <small style={{ opacity: 0.6 }}>{positionLabel}</small>}
      </div>
      {footer}
    </div>
  );
}

export function Field({ state, you }: Props): JSX.Element {
  const opp = (1 - you) as PlayerId;
  const me = state.players[you];
  const them = state.players[opp];

  const yourTurn = state.turnPlayer === you;
  const inMain = (state.phase === "Main1" || state.phase === "Main2") && yourTurn && !state.ended;
  const yourBattleStep =
    state.phase === "BattleStep" && yourTurn && !state.ended;

  const [selectedAttacker, setSelectedAttacker] = useState<InstanceId | null>(null);

  const attacker = selectedAttacker ? state.cards[selectedAttacker] : null;
  const attackerStillValid =
    !!attacker &&
    attacker.controller === you &&
    attacker.location.zone === "mainMonster" &&
    attacker.position === "ATK" &&
    attacker.faceUp &&
    attacker.flags.hasAttacked !== true;

  const oppHasMonster = them.mainMonster.some((id) => id !== null);

  const declareAttack = (target: InstanceId | "direct"): void => {
    if (!selectedAttacker || !attackerStillValid) return;
    send({ type: "submitAction", action: { kind: "DeclareAttack", player: you, attacker: selectedAttacker, target } });
    setSelectedAttacker(null);
  };

  const yourMonsterClickable = (id: InstanceId | null): boolean => {
    if (!yourBattleStep || !id) return false;
    const c = state.cards[id];
    return !!c && c.position === "ATK" && c.faceUp && c.flags.hasAttacked !== true;
  };
  const oppMonsterAttackable = (id: InstanceId | null): boolean =>
    yourBattleStep && !!id && attackerStillValid;

  const monsterFooter = (id: InstanceId | null): JSX.Element | null => {
    if (!inMain || !id) return null;
    const c = state.cards[id];
    if (!c) return null;
    const canChangeATK =
      c.faceUp && c.position === "DEF" &&
      c.flags.summonedThisTurn !== true &&
      c.flags.positionChangedThisTurn !== true &&
      c.flags.hasAttacked !== true;
    const canChangeDEF =
      c.faceUp && c.position === "ATK" &&
      c.flags.summonedThisTurn !== true &&
      c.flags.positionChangedThisTurn !== true &&
      c.flags.hasAttacked !== true;
    const canFlip =
      !c.faceUp && c.position === "FaceDownDEF" &&
      c.flags.summonedThisTurn !== true;
    if (!canChangeATK && !canChangeDEF && !canFlip) return null;
    return (
      <div style={{ display: "flex", gap: 2, marginTop: 4, justifyContent: "center", flexWrap: "wrap" }}>
        {canChangeATK && (
          <button
            style={{ padding: "1px 4px", fontSize: 10 }}
            onClick={(e) => {
              e.stopPropagation();
              send({ type: "submitAction", action: { kind: "ChangePosition", player: you, monster: id, position: "ATK" } });
            }}
          >→ATK</button>
        )}
        {canChangeDEF && (
          <button
            style={{ padding: "1px 4px", fontSize: 10 }}
            onClick={(e) => {
              e.stopPropagation();
              send({ type: "submitAction", action: { kind: "ChangePosition", player: you, monster: id, position: "DEF" } });
            }}
          >→DEF</button>
        )}
        {canFlip && (
          <button
            style={{ padding: "1px 4px", fontSize: 10 }}
            onClick={(e) => {
              e.stopPropagation();
              send({ type: "submitAction", action: { kind: "FlipSummon", player: you, monster: id } });
            }}
          >Flip</button>
        )}
      </div>
    );
  };

  const spellTrapFooter = (id: InstanceId | null): JSX.Element | null => {
    if (!yourTurn || !id) return null;
    const c = state.cards[id];
    if (!c || c.controller !== you || c.faceUp) return null;
    if (c.defId === -1) return null;
    let isSpell = false;
    try { isSpell = requireCard(c.defId).cardType === "Spell"; } catch { /* */ }
    if (!isSpell) return null;
    if (state.phase !== "Main1" && state.phase !== "Main2") return null;
    return (
      <div style={{ marginTop: 4, textAlign: "center" }}>
        <button
          style={{ padding: "1px 4px", fontSize: 10 }}
          onClick={(e) => {
            e.stopPropagation();
            send({ type: "submitAction", action: { kind: "ActivateSetSpell", player: you, spellTrap: id } });
          }}
        >Activate</button>
      </div>
    );
  };

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
              footer={monsterFooter(id)}
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
              footer={spellTrapFooter(id)}
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
