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

type PendingReborn = {
  handId: InstanceId;
  fromSet?: InstanceId; // if activated from a face-down set spell instead
};

type PendingFusion = {
  polymerizationId: InstanceId;
  fusionMonsterId: InstanceId | null;
  selected: InstanceId[];
};

type PendingEquip = { spellId: InstanceId };

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
  const [pendingReborn, setPendingReborn] = useState<PendingReborn | null>(null);
  const [pendingFusion, setPendingFusion] = useState<PendingFusion | null>(null);
  const [pendingEquip, setPendingEquip] = useState<PendingEquip | null>(null);

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
          const isPolymerization = card.defId === 24094653;
          const canFusionSummon =
            yourTurn && inMain && isPolymerization &&
            firstFreeMonsterSlot(state, you) >= 0 &&
            state.players[you].extraDeck.some((eid) => {
              const ec = state.cards[eid];
              if (!ec) return false;
              try {
                const def = requireCard(ec.defId);
                return def.cardType === "Monster" && def.kinds.includes("Fusion");
              } catch { return false; }
            });
          const isEquipSpell = cardType === "Spell" && spellKind === "Equip";
          const canEquip = yourTurn && inMain && isEquipSpell;

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
                    // Monster Reborn needs a Graveyard target — open the picker.
                    if (card.defId === 83764718) {
                      const anyMonster = pickFirstGraveyardMonster(state);
                      if (!anyMonster) {
                        alert("No monsters in either Graveyard to revive.");
                        return;
                      }
                      setPendingReborn({ handId: id });
                      return;
                    }
                    send({
                      type: "submitAction",
                      action: { kind: "PlaySpell", player: you, hand: id, slot, faceDown: false },
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
              {canFusionSummon && (
                <button
                  onClick={() =>
                    setPendingFusion({
                      polymerizationId: id,
                      fusionMonsterId: null,
                      selected: [],
                    })
                  }
                >Fusion Summon</button>
              )}
              {canEquip && (
                <button onClick={() => setPendingEquip({ spellId: id })}>Equip…</button>
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

      {pendingReborn && (
        <GraveyardPicker
          state={state}
          title="Pick a monster from either Graveyard to Special Summon"
          predicate={(card) => {
            try { return requireCard(card.defId).cardType === "Monster"; } catch { return false; }
          }}
          onPick={(target) => {
            const slot = firstFreeSpellTrapSlot(state, you);
            if (slot < 0) {
              setPendingReborn(null);
              return;
            }
            send({
              type: "submitAction",
              action: {
                kind: "PlaySpell",
                player: you,
                hand: pendingReborn.handId,
                slot,
                faceDown: false,
                payload: { target },
              },
            });
            setPendingReborn(null);
          }}
          onCancel={() => setPendingReborn(null)}
        />
      )}

      {pendingEquip && (
        <EquipPicker
          state={state}
          you={you}
          spellId={pendingEquip.spellId}
          onPick={(targetId) => {
            send({
              type: "submitAction",
              action: {
                kind: "EquipSpell",
                player: you,
                spell: pendingEquip.spellId,
                target: targetId,
              },
            });
            setPendingEquip(null);
          }}
          onCancel={() => setPendingEquip(null)}
        />
      )}

      {pendingFusion && (
        <FusionPicker
          state={state}
          you={you}
          pending={pendingFusion}
          onChange={setPendingFusion}
          onConfirm={(p, position) => {
            if (!p.fusionMonsterId) return;
            const slot = firstFreeMonsterSlot(state, you);
            if (slot < 0) {
              setPendingFusion(null);
              return;
            }
            send({
              type: "submitAction",
              action: {
                kind: "FusionSummon",
                player: you,
                polymerization: p.polymerizationId,
                fusionMonster: p.fusionMonsterId,
                materials: p.selected,
                slot,
                position,
              },
            });
            setPendingFusion(null);
          }}
          onCancel={() => setPendingFusion(null)}
        />
      )}
    </div>
  );
}

function EquipPicker({
  state, you, spellId, onPick, onCancel,
}: {
  state: GameState;
  you: PlayerId;
  spellId: InstanceId;
  onPick: (targetId: InstanceId) => void;
  onCancel: () => void;
}): JSX.Element {
  void spellId; // currently we equip to any face-up monster, no per-spell filter
  const candidates: { id: InstanceId; controller: PlayerId }[] = [];
  for (const pid of [you, (1 - you) as PlayerId]) {
    for (const id of state.players[pid].mainMonster) {
      if (!id) continue;
      const c = state.cards[id];
      if (!c || !c.faceUp) continue;
      candidates.push({ id, controller: pid });
    }
    for (const id of state.extraMonsterZones) {
      if (!id) continue;
      const c = state.cards[id];
      if (!c || !c.faceUp) continue;
      if (c.controller === pid) candidates.push({ id, controller: pid });
    }
  }
  return (
    <div className="panel" style={{ marginTop: ".5rem", borderColor: "#e9c46a" }}>
      <div style={{ marginBottom: ".5rem", fontWeight: 600 }}>Equip target</div>
      {candidates.length === 0 && <div style={{ opacity: 0.6 }}>No face-up monsters on the field.</div>}
      <div className="hand">
        {candidates.map(({ id, controller }) => {
          const c = state.cards[id]!;
          let name = `#${c.defId}`;
          let stats = "";
          try {
            const def = requireCard(c.defId);
            name = def.name;
            if (def.cardType === "Monster") stats = `${def.atk + (c.atkBonus ?? 0)}/${(def.def ?? 0) + (c.defBonus ?? 0)}`;
          } catch { /* */ }
          return (
            <div
              key={id}
              className="slot filled selectable"
              style={{ cursor: "pointer", minWidth: 110 }}
              onClick={() => onPick(id)}
            >
              <small style={{ fontWeight: 600 }}>{name}</small>
              <small style={{ opacity: 0.6 }}>{stats}</small>
              <small style={{ opacity: 0.5, fontSize: 10 }}>{controller === you ? "yours" : "opponent"}</small>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: ".5rem", marginTop: ".5rem" }}>
        <button onClick={onCancel}>Cancel</button>
      </div>
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

function FusionPicker({
  state, you, pending, onChange, onConfirm, onCancel,
}: {
  state: GameState;
  you: PlayerId;
  pending: PendingFusion;
  onChange: (p: PendingFusion) => void;
  onConfirm: (p: PendingFusion, position: "ATK" | "DEF") => void;
  onCancel: () => void;
}): JSX.Element {
  const fusionMonsters = state.players[you].extraDeck.filter((id) => {
    const c = state.cards[id];
    if (!c) return false;
    try {
      const def = requireCard(c.defId);
      return def.cardType === "Monster" && def.kinds.includes("Fusion");
    } catch { return false; }
  });
  let selectedFusionDef: ReturnType<typeof requireCard> | null = null;
  if (pending.fusionMonsterId) {
    const c = state.cards[pending.fusionMonsterId];
    if (c) {
      try {
        const def = requireCard(c.defId);
        if (def.cardType === "Monster") selectedFusionDef = def;
      } catch { /* */ }
    }
  }
  const requiredNames =
    selectedFusionDef && selectedFusionDef.cardType === "Monster"
      ? selectedFusionDef.fusionMaterials ?? []
      : [];

  // Eligible materials: monsters in your hand or on your field, matching by name.
  const eligibleMaterials: InstanceId[] = [];
  for (const id of state.players[you].hand) {
    const c = state.cards[id];
    if (!c) continue;
    try {
      const def = requireCard(c.defId);
      if (def.cardType !== "Monster") continue;
      if (requiredNames.length === 0 || requiredNames.includes(def.name)) {
        eligibleMaterials.push(id);
      }
    } catch { /* */ }
  }
  for (const id of state.players[you].mainMonster) {
    if (!id) continue;
    const c = state.cards[id];
    if (!c) continue;
    try {
      const def = requireCard(c.defId);
      if (def.cardType !== "Monster") continue;
      if (requiredNames.length === 0 || requiredNames.includes(def.name)) {
        eligibleMaterials.push(id);
      }
    } catch { /* */ }
  }

  const toggleMaterial = (id: InstanceId): void => {
    const s = new Set(pending.selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    onChange({ ...pending, selected: Array.from(s) });
  };

  const ready =
    !!pending.fusionMonsterId &&
    pending.selected.length >= 2 &&
    (requiredNames.length === 0 || pending.selected.length === requiredNames.length);

  const cardName = (id: InstanceId): string => {
    const c = state.cards[id];
    if (!c) return "?";
    try { return requireCard(c.defId).name; } catch { return `#${c.defId}`; }
  };

  return (
    <div className="panel" style={{ marginTop: ".5rem", borderColor: "#e9c46a" }}>
      <div style={{ marginBottom: ".5rem", fontWeight: 600 }}>Fusion Summon (Polymerization)</div>
      <div style={{ marginBottom: ".25rem" }}>1. Pick a Fusion monster from your Extra Deck:</div>
      <div className="hand">
        {fusionMonsters.length === 0 && <div style={{ opacity: 0.6 }}>No Fusion monsters available.</div>}
        {fusionMonsters.map((id) => {
          const c = state.cards[id]!;
          let name = `#${c.defId}`;
          let stats = "";
          let mats = "";
          try {
            const def = requireCard(c.defId);
            name = def.name;
            if (def.cardType === "Monster") {
              stats = `${def.atk}/${def.def ?? "—"}`;
              if (def.fusionMaterials) mats = def.fusionMaterials.join(" + ");
            }
          } catch { /* */ }
          const selected = pending.fusionMonsterId === id;
          return (
            <div
              key={id}
              className={`slot filled ${selected ? "selected" : "selectable"}`}
              style={{ cursor: "pointer", minWidth: 130 }}
              onClick={() => onChange({ ...pending, fusionMonsterId: id, selected: [] })}
            >
              <small style={{ fontWeight: 600 }}>{name}</small>
              {stats && <small style={{ opacity: 0.7 }}>{stats}</small>}
              {mats && <small style={{ opacity: 0.5, fontSize: 10 }}>{mats}</small>}
            </div>
          );
        })}
      </div>
      {pending.fusionMonsterId && (
        <>
          <div style={{ marginTop: ".5rem", marginBottom: ".25rem" }}>
            2. Pick {requiredNames.length > 0 ? `exactly ${requiredNames.length}` : "2+"} materials from your hand or field
            ({pending.selected.length}/{requiredNames.length || "≥2"}):
          </div>
          <div className="hand">
            {eligibleMaterials.length === 0 && (
              <div style={{ opacity: 0.6 }}>No eligible materials.</div>
            )}
            {eligibleMaterials.map((id) => {
              const c = state.cards[id]!;
              const fromHand = c.location.zone === "hand";
              const selected = pending.selected.includes(id);
              return (
                <div
                  key={id}
                  className={`slot filled ${selected ? "selected" : "selectable"}`}
                  style={{ cursor: "pointer", minWidth: 110 }}
                  onClick={() => toggleMaterial(id)}
                >
                  <small style={{ fontWeight: 600 }}>{cardName(id)}</small>
                  <small style={{ opacity: 0.5, fontSize: 10 }}>{fromHand ? "(hand)" : "(field)"}</small>
                </div>
              );
            })}
          </div>
        </>
      )}
      <div style={{ display: "flex", gap: ".5rem", marginTop: ".5rem" }}>
        <button disabled={!ready} onClick={() => onConfirm(pending, "ATK")}>Fusion Summon → ATK</button>
        <button disabled={!ready} onClick={() => onConfirm(pending, "DEF")}>Fusion Summon → DEF</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function GraveyardPicker({
  state, title, predicate, onPick, onCancel,
}: {
  state: GameState;
  title: string;
  predicate: (card: { defId: number }) => boolean;
  onPick: (id: InstanceId) => void;
  onCancel: () => void;
}): JSX.Element {
  const candidatesByOwner: { owner: 0 | 1; ids: InstanceId[] }[] = ([0, 1] as (0 | 1)[]).map((pid) => ({
    owner: pid,
    ids: state.players[pid].graveyard.filter((id) => {
      const c = state.cards[id];
      return !!c && predicate({ defId: c.defId });
    }),
  }));
  const total = candidatesByOwner.reduce((n, x) => n + x.ids.length, 0);
  return (
    <div className="panel" style={{ marginTop: ".5rem", borderColor: "#e9c46a" }}>
      <div style={{ marginBottom: ".5rem", fontWeight: 600 }}>{title}</div>
      {total === 0 && <div style={{ opacity: 0.6 }}>No eligible monsters in either Graveyard.</div>}
      {candidatesByOwner.map(({ owner, ids }) => (
        <div key={owner} style={{ marginBottom: ".5rem" }}>
          <small style={{ opacity: 0.6 }}>Player {owner}'s Graveyard ({ids.length})</small>
          <div className="hand">
            {ids.map((id) => {
              const card = state.cards[id]!;
              let name = `#${card.defId}`;
              let stats = "";
              try {
                const def = requireCard(card.defId);
                name = def.name;
                if (def.cardType === "Monster") stats = `${def.atk}/${def.def ?? "—"}`;
              } catch { /* */ }
              return (
                <div
                  key={id}
                  className="slot filled selectable"
                  style={{ cursor: "pointer", minWidth: 110 }}
                  onClick={() => onPick(id)}
                >
                  <small style={{ fontWeight: 600 }}>{name}</small>
                  {stats && <small style={{ opacity: 0.7 }}>{stats}</small>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: ".5rem" }}>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
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
