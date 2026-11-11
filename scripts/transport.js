// Como um grupo se move: a pé, montado, em veículo (puxado por animais ou não) ou de barco.
// A velocidade vem das fichas: deslocamento em pés por rodada vira milhas por hora (30 ft = 3 mi/h).
import { HOURS_PER_DAY, MOVER_KINDS, VEHICLE_TYPES } from "./config.js";

const actorOf = (ref) => { if (!ref) return null; try { return ref.includes?.(".") ? fromUuidSync(ref) : game.actors.get(ref); } catch (e) { return null; } };
export const actorRef = actorOf;

/** Velocidade (mi/h) de um ator num tipo de movimento. */
export function actorSpeed(a, kind = "walk") {
  const mv = a?.system?.attributes?.movement ?? {}; const v = Number(mv[kind]) || 0; if (!v) return 0;
  const u = String(mv.units ?? "ft").toLowerCase();
  if (u === "mi") return v; if (u === "km") return v * 0.6214; if (u === "m") return v * 3.2808 / 10;
  return v / 10;
}
const minOf = (xs) => xs.length ? Math.min(...xs) : 0;

/**
 * Velocidade de viagem (mi/h) por tipo — terra, água, ar — como a ficha do dnd5e calcula
 * (system.attributes.travel.speeds; em km/h vira mi/h). Sem isso, usa o deslocamento de combate.
 */
export function travelSpeeds(a) {
  const out = { land: 0, water: 0, air: 0 }; const t = a?.system?.attributes?.travel;
  if (t?.speeds) { const f = t.units === "kph" ? 0.621371 : 1; for (const k of Object.keys(out)) out[k] = (Number(t.speeds[k]) || 0) * f; }
  out.land ||= actorSpeed(a, "walk"); out.water ||= actorSpeed(a, "swim"); out.air ||= actorSpeed(a, "fly");
  return out;
}
/** Tipo do veículo pela ficha: land, water, air ou space. */
export function vehicleType(veh) {
  // dnd5e: system.vehicleType (5.x) ou system.details.type (antigo)
  for (const t of [veh?.system?.vehicleType, veh?.system?.details?.type, veh?.system?.type?.value]) if (VEHICLE_TYPES[t]) return t;
  const t2 = String(veh?.system?.vehicleType ?? veh?.system?.details?.type ?? "").toLowerCase(); if (/water|aqu|nav|ship|boat|barc/.test(t2)) return "water"; if (/air|aér|aer/.test(t2)) return "air";
  const sp = travelSpeeds(veh); if (sp.water && sp.water >= sp.land) return "water"; return sp.air && !sp.land && !sp.water ? "air" : sp.water && !sp.land ? "water" : "land";
}
/** Animais de tração ligados na própria ficha do veículo (dnd5e: system.draft.value). */
export const sheetDraft = (veh) => [...(veh?.system?.draft?.value ?? [])];
const fmt = (v) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10);

/** Resumo do transporte de um elemento móvel. */
export function transportOf(mover) {
  const members = (mover?.members ?? []).map(actorOf).filter(Boolean);
  const walkList = members.map(a => travelSpeeds(a).land).filter(v => v > 0);
  const walk = minOf(walkList) || 3;
  const veh = actorOf(mover?.vehicle);
  const draftRefs = [...new Set([...(veh ? sheetDraft(veh) : []), ...(mover?.draft ?? [])])];
  const draft = draftRefs.map(actorOf).filter(Boolean); const mounts = (mover?.mounts ?? []).map(actorOf).filter(Boolean);
  const out = { mode: "pe", mph: walk, walk, label: members.length > 1 ? "A pé" : "A pé", detail: [], members, veh, draft, draftRefs, mounts, slowest: null, vtype: null, hpd: HOURS_PER_DAY, water: 0 };
  if (walkList.length) { const s = members.find(a => travelSpeeds(a).land === walk); out.slowest = s?.name; }
  const K = MOVER_KINDS[mover?.kind];
  if (veh) {
    const vt = vehicleType(veh); const V = VEHICLE_TYPES[vt]; const sp = travelSpeeds(veh);
    let mph = sp[V.speed] || 0;
    if (!mph && vt === "land" && draft.length) mph = minOf(draft.map(a => travelSpeeds(a).land).filter(v => v > 0));
    Object.assign(out, { mode: V.mode, mph: mph || walk, label: veh.name, vtype: vt, water: sp.water });
    out.detail.push(V.label.toLowerCase());
    if (draft.length) out.detail.push(`puxado por ${draft.map(a => a.name).join(", ")}`);
    if (vt === "land" && sp.water) out.detail.push("também navega");
    if (V.mode === "voo" || V.mode === "espaco") out.detail.push("voa em linha reta, sem depender de estradas");
    const hpd = Number(veh.system?.attributes?.travel?.time); if (hpd > 0 && hpd <= 24) out.hpd = hpd;
  } else if (mover?.kind === "navio") {
    Object.assign(out, { mode: "barco", mph: K?.mph || 4, label: K?.label ?? "Navio", vtype: "water", water: K?.mph || 4 });
  } else if (K?.air) {
    Object.assign(out, { mode: mover.kind === "aeronave" ? "espaco" : "voo", mph: K.mph || 6, label: K.label, vtype: mover.kind === "aeronave" ? "space" : "air" });
    out.detail.push("voa em linha reta, sem depender de estradas");
  } else if (mounts.length && mounts.length >= Math.max(1, members.length)) {
    const m = minOf(mounts.map(a => travelSpeeds(a).land).filter(v => v > 0)) || walk;
    Object.assign(out, { mode: "montaria", mph: m, label: mounts.length === 1 ? mounts[0].name : `${mounts.length} montarias` });
  } else if (mounts.length) out.detail.push(`${mounts.length} montaria(s) para ${members.length} pessoas: seguem a pé`);
  out.perDay = out.mph * out.hpd;
  out.speedText = `${fmt(out.mph)} mi/h · ${Math.round(out.perDay)} mi/dia${out.hpd !== HOURS_PER_DAY ? ` (${out.hpd} h)` : ""}`;
  return out;
}
/** Ícone do grupo no mapa e nas listas, conforme o transporte. */
export function transportIcon(mover, tr = transportOf(mover)) {
  if (mover?.icon) return mover.icon;
  if (tr.vtype) return VEHICLE_TYPES[tr.vtype].icon;
  if (tr.mode === "montaria") return "horse";
  const K = MOVER_KINDS[mover?.kind]; if (K && mover.kind !== "grupo") return K.icon;
  return tr.members.length === 1 ? "elmo" : "viajantes";
}

/** Usuários (não mestres) que controlam algum membro: são eles que votam no destino. */
export function votersOf(mover) {
  const ids = new Set();
  for (const ref of mover?.members ?? []) {
    const a = actorOf(ref); if (!a) continue;
    for (const u of game.users) if (!u.isGM && (a.testUserPermission?.(u, "OWNER") ?? false)) ids.add(u.id);
  }
  return [...ids];
}
/** O usuário controla algum membro deste grupo? */
export function controls(user, mover) {
  if (user.isGM) return true;
  return (mover?.members ?? []).some(ref => actorOf(ref)?.testUserPermission?.(user, "OWNER"));
}
export function ownedMembers(user, mover) { return (mover?.members ?? []).filter(ref => user.isGM || actorOf(ref)?.testUserPermission?.(user, "OWNER")); }
