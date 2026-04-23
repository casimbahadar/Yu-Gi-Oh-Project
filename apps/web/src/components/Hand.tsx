import type { GameState, PlayerId } from "@ygo/engine";
import { requireCard } from "@ygo/engine";
import { send } from "../net/ws-client.js";

interface Props {
  state: GameState;
  you: PlayerId;
}

export function Hand({ state, you }: Props): JSX.Element {
  const ids = state.players[you].hand;
  return (
    <div className="panel">
      <h3 style={{ margin: "0 0 .5rem" }}>Your Hand ({ids.length})</h3>
      <div className="hand">
        {ids.map((id) => {
          const card = state.cards[id]!;
          let name = `#${card.defId}`;
          let canNormalSummon = false;
          try {
            const def = requireCard(card.defId);
            name = def.name;
            canNormalSummon =
              def.cardType === "Monster" &&
              (def.level ?? 99) <= 4 &&
              state.phase === "Main1" &&
              state.turnPlayer === you;
          } catch { /* unknown card */ }
          return (
            <div key={id} className="slot filled" style={{ minWidth: 90 }}>
              <small>{name}</small>
              {canNormalSummon && (
                <button
                  onClick={() => {
                    const slot = state.players[you].mainMonster.findIndex((s) => s === null);
                    if (slot < 0) return;
                    send({
                      type: "submitAction",
                      action: {
                        kind: "NormalSummon",
                        player: you,
                        hand: id,
                        slot,
                        position: "ATK",
                      },
                    });
                  }}
                >
                  Summon
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
