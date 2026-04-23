import type { GameState, InstanceId, PlayerId } from "@ygo/engine";
import { requireCard } from "@ygo/engine";

interface Props {
  state: GameState;
  you: PlayerId;
}

function CardSlot({ state, id }: { state: GameState; id: InstanceId | null }): JSX.Element {
  if (!id) return <div className="slot">·</div>;
  const card = state.cards[id];
  if (!card) return <div className="slot">?</div>;
  try {
    const def = requireCard(card.defId);
    return (
      <div className="slot filled" title={def.text}>
        <small>{def.name}</small>
      </div>
    );
  } catch {
    return <div className="slot">#{card.defId}</div>;
  }
}

export function Field({ state, you }: Props): JSX.Element {
  const opp = (1 - you) as PlayerId;
  const me = state.players[you];
  const them = state.players[opp];

  return (
    <div className="field" aria-label="duel field">
      <div>
        <div className="header">
          <strong>{them.name}</strong>
          <span className="lp">LP {them.lifePoints}</span>
        </div>
        <div className="row">
          {them.spellTrap.map((id, i) => (
            <CardSlot key={`ost-${i}`} state={state} id={id} />
          ))}
        </div>
        <div className="row">
          {them.mainMonster.map((id, i) => (
            <CardSlot key={`omm-${i}`} state={state} id={id} />
          ))}
        </div>
      </div>

      <div>
        <div className="row">
          {me.mainMonster.map((id, i) => (
            <CardSlot key={`mm-${i}`} state={state} id={id} />
          ))}
        </div>
        <div className="row">
          {me.spellTrap.map((id, i) => (
            <CardSlot key={`st-${i}`} state={state} id={id} />
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
