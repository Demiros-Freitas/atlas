// Grupos: quem está em cada grupo, como viaja (pelas fichas), escolha de destino com acordo dos jogadores,
// autorização do Mestre, divisão e junção. Interface da aba "Grupo" e as ações que o Mestre grava.
import { MODULE_ID, SOCKET, POI_STATES, PACES, HOURS_PER_DAY, MOVER_KINDS, VEHICLE_TYPES, GROUP_TYPES, ROLES_REPEAT, VEHICLE_GROUP, FORMATIONS, iconName } from "./config.js";
import { portalLinks, dataOf, normMover, normPoi, mainMover, esc, mutateData, request, onAction, uid, scaleOf, uiPref, customIcons, notes, addLog, mapScenes, childrenOf, isMap, mapOf } from "./data.js";
import { planTravel, executeTravel, fmtH, fmtDur, fmtUnits, travelActive, cancelTravel, groupLag, syncGroupClock, portalWhy, spendTime, groupClock } from "./travel.js";
import { transportOf, transportIcon, travelSpeeds, vehicleType, sheetDraft, votersOf, controls, ownedMembers, actorRef, actorSpeed } from "./transport.js";
import { ic } from "./icons.js";

const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(v) === String(cur ?? "") ? "selected" : ""}>${esc(label)}</option>`;
const seg = (act, list, cur) => `<div class="seg">${list.map(([v, l]) => `<button type="button" data-act="${act}" data-v="${esc(v)}" class="${String(v) === String(cur) ? "on" : ""}">${esc(l)}</button>`).join("")}</div>`;
const DIRS8 = ["N", "NE", "L", "SE", "S", "SO", "O", "NO"];
const ICON_SET = ["viajantes", "elmo", "carroca", "navio", "balao", "aeronave", "horse", "espada", "escudo", "monstro", "lobo", "cervo", "tesouro", "saque"];

/* ---------- consultas ---------- */
/** Bandeiras fincadas neste mapa (destinos possíveis). */
export const flagsOf = (ui) => notes().filter(n => n.kind === "dest" && n.sceneId === ui.scene?.id);
/** Grupos que o usuário vê nas listas: o mestre vê todos; o jogador, os liberados pelo mestre e os que têm personagem dele. */
/** Veículos deixados no mapa (desembarque). */
export function parkedOf(ui) { return ui.data.movers.map(normMover).filter(m => m.parked && (game.user.isGM || !m.hidden)); }
/** Veículos parados perto de um grupo (dá para embarcar). */
export function parkedNear(ui, g) { const R = scaleOf(ui.scene).size * 1.5; return parkedOf(ui).filter(p => (g.at && p.at === g.at) || Math.hypot(p.x - g.x, p.y - g.y) <= R); }
export function groupsOf(ui) {
  const all = ui.data.movers.map(normMover).filter(m => !m.parked); if (game.user.isGM) return all;
  return all.filter(m => !m.hidden && (m.public || ownedMembers(game.user, m).length));
}
/** O usuário vê esta unidade? (mesma regra da lista) */
const seesUnit = (m) => game.user.isGM || (!m.hidden && (m.public || ownedMembers(game.user, m).length));
/** Unidades de um mapa e dos mapas filhos dele (para mostrar no marcador do mapa filho, no mapa pai). */
export function unitsInside(scene, seen = new Set()) {
  if (!scene || seen.has(scene.id)) return []; seen.add(scene.id);
  const own = (dataOf(scene).movers ?? []).map(normMover).filter(m => !m.parked && seesUnit(m));
  return [...own, ...childrenOf(scene).flatMap(c => unitsInside(c, seen))];
}
const lagText = (g) => { const h = groupLag(g); return h >= 0.1 ? `${fmtH(h)} livres` : ""; };
export function myGroups(ui) { return groupsOf(ui).filter(m => controls(game.user, m) && (game.user.isGM || m.members.length)); }
export function currentGroup(ui) {
  const all = groupsOf(ui); const pick = all.find(m => m.id === ui.travel.moverId);
  if (pick) return pick;
  if (game.user.isGM) { const mm = mainMover(ui.data); return mm ? normMover(mm) : all[0] ?? null; }
  return myGroups(ui)[0] ?? null;
}
export const canDrive = (m) => !!m && controls(game.user, m);

export function targetLabel(ui, target) {
  if (!target) return "";
  if (typeof target === "string") { const p = ui.data.pois.find(x => x.id === target); if (!p) return "?"; const n = normPoi(p); return n.state === "rumor" && !ui.gmView ? "Local desconhecido" : n.name; }
  const sc = scaleOf(ui.scene); const m = currentGroup(ui); if (!m) return "ponto no mapa";
  const dx = target.x - m.x, dy = target.y - m.y; const d = Math.hypot(dx, dy) * sc.perPx; const ang = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  return `ponto a ${d >= 10 ? Math.round(d) : d.toFixed(1)} ${sc.units} a ${DIRS8[Math.round(ang / 45) % 8]}`;
}

/** Plano com cache (para não recalcular a cada quadro). */
export const wayOf = (o) => o?.way ?? (o?.direct ? "direto" : "estradas");
export const WAYS = { estradas: "Pelas estradas", rapido: "O mais rápido", direto: "Em linha reta" };
export function cachedPlan(ui, m, target, pace = "normal", way = "estradas", stops = null, via = null) {
  if (!m || !target) return null; if (typeof way === "boolean") way = way ? "direto" : "estradas";
  const direct = way === "direto", roads = way === "estradas";
  const avoidWx = !!ui.travel?.opts?.avoidWx; const avoidRough = !ui.travel?.opts?.crossRough; const portals = !ui.travel?.opts?.noPortals; const key = JSON.stringify([portals, avoidRough, m.id, m.x, m.y, m.at, m.members, m.vehicle, m.draft, m.mounts, target, pace, way, stops, via, ui.dataRev ?? 0, ui.gmView, ui.data.map?.roadReach, avoidWx]);
  ui.cache.plans ??= {}; const c = ui.cache.plans[m.id + (typeof target === "object" && target.preview ? ":p" : "")];
  if (c?.key === key) return c.plan;
  let plan = null; try { plan = planTravel(ui.scene, m, target, { pace, direct, roads, gm: ui.gmView, stops: stops ?? null, via: via?.length ? via : null, avoidWx, avoidRough, portals }); } catch (e) { console.error(`${MODULE_ID} | plano`, e); }
  ui.cache.plans[m.id + (typeof target === "object" && target.preview ? ":p" : "")] = { key, plan };
  return plan;
}
/** Plano mostrado para o grupo: a votação em andamento, ou o rascunho local. */
export function shownPlan(ui, m) {
  if (!m) return null;
  if (m.vote) return cachedPlan(ui, m, m.vote.target, m.vote.pace, wayOf(m.vote), m.vote.stops ?? null, m.vote.via ?? null);
  if (ui.travel.moverId === m.id || currentGroup(ui)?.id === m.id) {
    const t = ui.travel.picking && ui.travel.hover ? { ...ui.travel.hover, preview: true } : ui.travel.target ?? (m.plan?.target ?? null);
    const pv = t?.preview; return t ? cachedPlan(ui, m, t, ui.travel.pace, ui.travel.way ?? "estradas", pv ? null : ui.travel.stops, ui.travel.via) : null;
  }
  return null;
}
function voteState(m) {
  const voters = votersOf(m); const v = m.vote; if (!v) return null;
  const acc = v.accepts ?? {}, rej = v.rejects ?? {};
  return { voters, acc, rej, all: voters.every(u => acc[u]), anyNo: voters.some(u => rej[u]), pending: voters.filter(u => !acc[u] && !rej[u]) };
}

/* ---------- formação e funções ---------- */
export function groupTypeOf(m, tr = transportOf(m)) { if (tr.vtype) return VEHICLE_GROUP[tr.vtype]; return GROUP_TYPES[m.groupType] ? m.groupType : "Viajantes"; }
const isVehicleType = (t) => t.startsWith("Veículo");
const initials = (n) => String(n ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
/** Desenho da formação: posições numeradas, com quem está em cada uma (a frente é para cima). */
function formationSvg(m) {
  const F = FORMATIONS[m.formation.type] ?? FORMATIONS.Linha; const W = 240, H = 156, cx = W / 2, cy = H / 2 + 6, sx = 92, sy = 52;
  const who = {}; for (const [ref, n] of Object.entries(m.formation.pos ?? {})) if (n && m.members.includes(ref)) who[Number(n)] = ref;
  const slots = F.map(([x, y], i) => { const X = cx + x * sx, Y = cy + y * sy; const ref = who[i + 1]; const a = ref ? actorRef(ref) : null; const img = a?.prototypeToken?.texture?.src || a?.img; const role = ref ? m.roles?.[ref] : "";
    return `<g class="fslot ${ref ? "on" : ""}"><title>${esc(a ? `${a.name}${role ? ` · ${role}` : ""}` : `Posição ${i + 1}`)}</title><circle cx="${X}" cy="${Y}" r="15"/>${img ? `<clipPath id="fc${m.id}${i}"><circle cx="${X}" cy="${Y}" r="13"/></clipPath><image href="${esc(img)}" x="${X - 13}" y="${Y - 13}" width="26" height="26" clip-path="url(#fc${m.id}${i})" preserveAspectRatio="xMidYMid slice"/>` : `<text x="${X}" y="${Y + 4}">${a ? esc(initials(a.name)) : i + 1}</text>`}<text class="num" x="${X + 12}" y="${Y - 10}">${i + 1}</text>${role && role !== "Indefinido" ? `<text class="role" x="${X}" y="${Y + 26}">${esc(role)}</text>` : ""}</g>`; }).join("");
  return `<svg class="formsvg" viewBox="0 0 ${W} ${H + 18}" aria-label="Formação ${esc(m.formation.type)}"><path class="front" d="M${cx - 8} 12 L${cx} 2 L${cx + 8} 12"/><text class="fr" x="${cx}" y="22">frente</text>${slots}</svg>`;
}
function formationSection(ui, m, tr) {
  const gm = game.user.isGM; const mine = new Set(ownedMembers(game.user, m)); const type = groupTypeOf(m, tr); const roles = GROUP_TYPES[type] ?? GROUP_TYPES.Viajantes;
  const veh = isVehicleType(type); const use = m.formation.use && !veh; const F = FORMATIONS[m.formation.type] ?? FORMATIONS.Linha;
  const used = (k, ref) => Object.entries(k).filter(([r, v]) => r !== ref && m.members.includes(r)).map(([, v]) => String(v));
  const rows = m.members.map(ref => { const a = actorRef(ref); const can = gm || mine.has(ref); const role = m.roles?.[ref] ?? roles[0]; const pos = m.formation.pos?.[ref] ?? "";
    const takenR = used(m.roles ?? {}, ref); const takenP = used(m.formation.pos ?? {}, ref);
    return `<div class="slot member"><span class="ava">${(a?.prototypeToken?.texture?.src || a?.img) ? `<img src="${esc(a.prototypeToken?.texture?.src || a.img)}" alt="">` : ic("person", 13)}</span><div class="grow"><b>${esc(a?.name ?? "?")}</b></div>
      <select data-field="gRole" data-ref="${esc(ref)}" ${can ? "" : "disabled"} aria-label="Função">${roles.map(r => { const rep = takenR.includes(r) && !ROLES_REPEAT.includes(r); return `<option value="${esc(r)}" ${r === role ? "selected" : ""} ${rep ? 'class="used"' : ""}>${esc(r)}${rep ? " (usada)" : ""}</option>`; }).join("")}</select>
      ${use ? `<select class="pos" data-field="gPos" data-ref="${esc(ref)}" ${can ? "" : "disabled"} aria-label="Posição"><option value="">—</option>${F.map((_, i) => `<option value="${i + 1}" ${String(pos) === String(i + 1) ? "selected" : ""} ${takenP.includes(String(i + 1)) ? "disabled" : ""}>${i + 1}</option>`).join("")}</select>` : ""}</div>`; }).join("");
  return `<section><h3>Formação e funções</h3>
    ${gm ? `<div class="grid2"><label>Tipo de grupo<select data-field="gType" ${tr.vtype ? "disabled" : ""}>${Object.keys(GROUP_TYPES).filter(t => !isVehicleType(t) || t === type).map(t => opt(t, t, type)).join("")}</select></label>
      <label>Formação<select data-field="gFormType" ${veh ? "disabled" : ""}>${Object.entries(FORMATIONS).map(([k, v]) => opt(k, `${k} (${v.length})`, m.formation.type)).join("")}</select></label></div>
      <label class="check"><input type="checkbox" data-field="gFormUse" ${use ? "checked" : ""} ${veh ? "disabled" : ""}> Usar formação${veh ? " (veículos não usam formação)" : ""}</label>` : `<small class="muted">${esc(type)}${use ? ` · formação em ${esc(m.formation.type)}` : ""}. Você escolhe a função e a posição dos seus personagens.</small>`}
    ${use ? formationSvg(m) : ""}
    ${rows || `<p class="muted">Ninguém no grupo.</p>`}</section>`;
}

/* ---------- interface ---------- */
/** Aba "Viagem" do Atlas: todos os grupos (com busca); clicar seleciona e abre o painel do grupo. */
export function panelGrupo(ui) {
  if (!globalThis.ui?.atlas?.setOpen && ui.gpanel) return renderGroupPanel(ui) + panelGrupoList(ui); // painel na barra lateral: tudo junto
  return panelGrupoList(ui);
}
function panelGrupoList(ui) {
  const gm = game.user.isGM; const all = groupsOf(ui); const q = (ui.groupQ ?? "").trim().toLowerCase();
  const sel = ui.gpanel ? currentGroup(ui)?.id : null;
  const match = (g) => !q || g.name.toLowerCase().includes(q) || g.members.some(r => (actorRef(r)?.name ?? "").toLowerCase().includes(q));
  const list = all.filter(match).sort((a, b) => (b.main - a.main) || a.name.localeCompare(b.name));
  const ms = (ui.gMulti ?? []).filter(id => all.some(g => g.id === id)); const msBox = ms.length ? `<section class="addbox"><h3>${ms.length} grupo(s) selecionado(s)</h3><div class="info">Ctrl+clique (ou Shift) num grupo soma ou tira da seleção. Unir junta todos num grupo só.</div>
    ${ms.length >= 2 ? `<label>Unir em<select data-field="gMergeInto">${ms.map(id => { const g = all.find(x => x.id === id); return `<option value="${id}" ${id === (ui.gMergeInto ?? ms[0]) ? "selected" : ""}>${esc(g?.name ?? id)}</option>`; }).join("")}</select></label>` : ""}
    <div class="actions row">${ms.length >= 2 ? `<button type="button" class="btn gold grow" data-act="gMergeSel" data-id="${ms.includes(ui.gMergeInto) ? ui.gMergeInto : ms[0]}">${ic("merge", 14)} Unir os grupos</button>` : ""}<button type="button" class="btn" data-act="gMultiClear">Limpar</button></div></section>` : "";
  return `${msBox}<label class="search">${ic("search", 14)}<input type="text" data-field="gSearch" data-live="gSearch" value="${esc(ui.groupQ ?? "")}" placeholder="Buscar grupo ou personagem"></label>
    <div class="glist">${list.map(g => groupCard(ui, g, g.id === sel)).join("") || `<p class="muted">${all.length ? "Nenhum grupo com esse nome." : gm ? "Nenhum grupo no mapa." : "Seus personagens não estão em nenhum grupo deste mapa."}</p>`}</div>
    ${gm ? `<div class="actions row"><button type="button" class="btn gold grow" data-act="gNew">${ic("plus", 14)} Novo grupo</button></div>` : ""}
    ${otherMaps(ui, match)}

    ${parkedOf(ui).length ? `<section><h3>Veículos parados · ${parkedOf(ui).length}</h3>${parkedOf(ui).map(p => `<div class="slot mini parkedrow"><span class="mvdot">${ic(p.icon || "carroca", 15)}</span><div class="grow"><b>${esc(p.name)}</b><small>${p.leftBy ? `deixado por ${esc(p.leftBy)}` : "parado"}${p.at ? ` · em ${esc(normPoi(ui.data.pois.find(x => x.id === p.at) ?? {}).name)}` : ""}</small></div><button type="button" class="icon" data-act="gCenterAny" data-id="${p.id}" aria-label="Mostrar">${ic("target", 13)}</button>${gm ? `<button type="button" class="icon" data-act="gParkedDel" data-id="${p.id}" data-tooltip="Tirar do mapa" aria-label="Tirar">${ic("trash", 13)}</button>` : ""}</div>`).join("")}</section>` : ""}`;
}

/** Unidades dos outros mapas, separadas por mapa. O mestre traz para este mapa pelo botão ou arrastando até o lugar. */
function otherMaps(ui, match) {
  const gm = game.user.isGM; const here = ui.scene?.id;
  const secs = mapScenes().filter(s => s.id !== here).map(s => ({ s, list: (dataOf(s).movers ?? []).map(normMover).filter(m => !m.parked && seesUnit(m) && match(m)).sort((a, b) => (b.main - a.main) || a.name.localeCompare(b.name)) })).filter(x => x.list.length)
    .sort((a, b) => (a.s.navName || a.s.name).localeCompare(b.s.navName || b.s.name));
  if (!secs.length) return "";
  const row = (s, g) => { const K = MOVER_KINDS[g.kind]; const at = g.at ? normPoi(dataOf(s).pois.find(p => p.id === g.at) ?? {}).name : null; const lt = lagText(g); const busy = travelActive(g.id);
    return `<div class="slot mini omrow ${g.hidden ? "hid" : ""}" ${gm && !busy ? `draggable="true" data-unit-drag="${s.id}:${g.id}" data-tooltip="Arraste até o mapa para colocar a unidade nesse lugar"` : ""}>
      <span class="mvdot" style="--mc:${esc(g.color || K.color)}">${g.img ? `<img src="${esc(g.img)}" alt="">` : ic(transportIcon(g, transportOf(g)), 15)}</span>
      <div class="grow"><b>${esc(g.name)}${g.main ? " ★" : ""}</b><small>${busy ? "viajando agora" : at ? `em ${esc(at)}` : "no ermo"}${lt ? ` · ${esc(lt)}` : ""}${g.hidden ? " · oculto" : ""}</small></div>
      ${gm ? `<button type="button" class="btn sm" data-act="gPlaceHere" data-sid="${s.id}" data-id="${g.id}" ${busy ? "disabled" : ""} data-tooltip="Trazer a unidade para este mapa">${ic("enter", 13)} Colocar aqui</button>` : ""}</div>`; };
  const total = secs.reduce((n, x) => n + x.list.length, 0); const open = ui.omOpen ?? false;
  const head = `<button type="button" class="h3btn" data-act="gOmToggle">${ic("map", 13)}<span class="grow">Em outros mapas · ${total}</span><span class="car">${open ? "▾" : "▸"}</span></button>`;
  if (!open) return `<section class="othermaps">${head}<div class="om-sum">${secs.map(({ s, list }) => `<span class="chip">${esc(s.navName || s.name)} · ${list.length}</span>`).join("")}</div></section>`;
  return `<section class="othermaps">${head}${secs.map(({ s, list }) => { const par = mapOf(s)?.parent ? game.scenes.get(mapOf(s).parent) : null;
    return `<div class="om-map"><div class="om-head">${ic("map", 13)}<b class="grow">${esc(s.navName || s.name)}</b>${par ? `<small>dentro de ${esc(par.navName || par.name)}</small>` : ""}${gm || s.testUserPermission?.(game.user, "OBSERVER") ? `<button type="button" class="icon" data-act="gViewMap" data-sid="${s.id}" data-tooltip="Abrir este mapa" aria-label="Abrir este mapa">${ic("target", 13)}</button>` : ""}</div>${list.map(g => row(s, g)).join("")}</div>`; }).join("")}</section>`;
}

function avatar(a, cls = "") { const img = a?.prototypeToken?.texture?.src || a?.img; return `<span class="ava ${cls}">${img ? `<img src="${esc(img)}" alt="">` : ic("person", 13)}</span>`; }
function statusOf(ui, g) {
  const at = g.at ? normPoi(ui.data.pois.find(p => p.id === g.at) ?? {}).name : null; const st = voteState(g);
  if (st) return st.all ? "pronto para partir" : "votando o destino";
  const lt = lagText(g); const tail = lt ? ` · ${lt}` : "";
  if (g.plan?.target) return `a caminho de ${targetLabel(ui, g.plan.target)}${tail}`;
  return (at ? `em ${at}` : "no ermo") + tail;
}
/** Card de um grupo na lista: compacto; o botão de seta expande os detalhes. */
function groupCard(ui, g, on) {
  const tr = transportOf(g); const K = MOVER_KINDS[g.kind]; const open = !!ui.gExpand?.[g.id]; const gm = game.user.isGM;
  const veh = g.vehicle ? actorRef(g.vehicle) : null;
  return `<div class="gcard2 ${on ? "on" : ""} ${ui.gMulti?.includes(g.id) ? "msel" : ""} ${g.hidden ? "hid" : ""}" style="--mc:${esc(g.color || K.color)}">
    <div class="gc-head" data-act="gSelect" data-id="${g.id}" role="button" tabindex="0">
      <span class="mvdot">${g.img ? `<img src="${esc(g.img)}" alt="">` : ic(transportIcon(g, tr), 18)}</span>
      <span class="grow"><b>${esc(g.name)}${g.main ? " ★" : ""}</b><small>${esc(statusOf(ui, g))}${g.hidden ? " · oculto" : ""}</small></span>
      <span class="gc-avas">${g.members.slice(0, 5).map(r => avatar(actorRef(r), "xs")).join("")}${g.members.length > 5 ? `<em>+${g.members.length - 5}</em>` : ""}</span>
      <button type="button" class="icon" data-act="gCenterId" data-id="${g.id}" data-tooltip="Mostrar no mapa" aria-label="Mostrar no mapa">${ic("target", 13)}</button>
      <button type="button" class="icon gc-exp ${open ? "on" : ""}" data-act="gExpand" data-id="${g.id}" data-tooltip="${open ? "Recolher" : "Expandir"}" aria-label="Expandir">${ic("back", 13)}</button>
    </div>${embarkMini(ui, g)}
    ${open ? `<div class="gc-body">
      <div class="trline">${ic(transportIcon(g, tr), 18)}<span><b>${esc(tr.label)}</b>${tr.detail.length ? ` · ${esc(tr.detail.join(" · "))}` : ""}</span><span class="spd">${esc(tr.speedText)}</span></div>
      ${veh ? `<div class="slot mini">${avatar(veh)}<div class="grow"><b>${esc(veh.name)}</b><small>Veículo${tr.draft.length ? ` · puxado por ${esc(tr.draft.map(a => a.name).join(", "))}` : ""}</small></div></div>` : ""}
      ${g.members.length ? `<div class="gc-members">${g.members.map(r => { const a = actorRef(r); if (!a) return ""; const role = g.roles?.[r]; const mt = g.mountOf?.[r] ? actorRef(g.mountOf[r]) : null;
        return `<span class="gm-chip">${avatar(a, "xs")}<span>${esc(a.name)}${role && role !== "Indefinido" ? `<small>${esc(role)}</small>` : ""}</span>${mt ? `<span class="mt" data-tooltip="Montaria: ${esc(mt.name)}">${ic("horse", 11)}</span>` : ""}</span>`; }).join("")}</div>` : `<small class="muted">Ninguém no grupo.</small>`}
      ${g.today ? `<small class="muted">${esc(fmtH(g.today))} de marcha hoje</small>` : ""}
      ${lagText(g) ? `<small class="muted">${ic("clock", 11)} Ficou parado enquanto outras unidades viajavam: pode viajar ${esc(fmtH(groupLag(g)))} sem avançar o relógio do mundo (como se tivesse ido ao mesmo tempo).</small>` : ""}
      ${gm ? `<div class="actions row"><button type="button" class="btn" data-act="gHideId" data-id="${g.id}">${ic(g.hidden ? "eye" : "eyeoff", 13)} ${g.hidden ? "Mostrar aos jogadores" : "Ocultar"}</button>${lagText(g) ? `<button type="button" class="btn" data-act="gTimeSync" data-id="${g.id}" data-tooltip="A unidade esperou: a próxima viagem dela começa agora e avança o relógio">${ic("clock", 13)} Começar do agora</button>` : ""}</div>` : ""}
    </div>` : ""}
  </div>`;
}

/** Painel do grupo selecionado (abaixo do painel do Atlas, ou sozinho quando o Atlas está fechado). */
export function renderGroupPanel(ui) {
  if (!ui.gpanel || !ui.scene) return "";
  const m = currentGroup(ui); if (!m) return ""; ui.travel.moverId = m.id;
  const gm = game.user.isGM; const tr = transportOf(m); const K = MOVER_KINDS[m.kind];
  // um painel só para a unidade: Viagem · Composição · Marcador (a aba Unidades do Atlas fica só com a lista)
  const subs = [["viagem", "Viagem"], ["composicao", "Composição"], ...(gm ? [["marcador", "Marcador"]] : [])];
  const sub = subs.some(([k]) => k === ui.groupSub) ? ui.groupSub : "viagem";
  const body = sub === "composicao" ? compositionView(ui, m) : sub === "marcador" ? markerView(ui, m) : travelView(ui, m);
  return `<div class="atl gpanel" style="--mc:${esc(m.color || K.color)}">
    <header class="gp-head"><span class="mvdot">${m.img ? `<img src="${esc(m.img)}" alt="">` : ic(transportIcon(m, tr), 18)}</span>
      <span class="grow gp-title"><b>${esc(m.name)}</b><small class="st">${esc(statusOf(ui, m))}</small><small>${ic(transportIcon(m, tr), 11)} ${esc(tr.label)} · ${esc(tr.speedText)}</small></span>
      <button type="button" class="icon" data-act="gCenter" data-tooltip="Mostrar no mapa" aria-label="Mostrar no mapa">${ic("target", 14)}</button>
      ${globalThis.ui?.atlas?.pop ? `<button type="button" class="icon" data-act="popDock" data-v="group" data-tooltip="${globalThis.ui.atlas.isPopped?.("group") ? "Trazer de volta" : "Destacar em outra janela"}" aria-label="Destacar"><i class="fa-solid ${globalThis.ui.atlas.isPopped?.("group") ? "fa-arrow-down-left-and-arrow-up-right-to-center" : "fa-arrow-up-right-from-square"}" style="font-size:12px"></i></button>` : ""}
      <button type="button" class="icon" data-act="gClose" data-tooltip="Fechar (Esc)" aria-label="Fechar">${ic("close", 14)}</button></header>
    <div class="subtabs" role="tablist">${subs.map(([k, l]) => `<button type="button" role="tab" aria-selected="${sub === k}" class="${sub === k ? "on" : ""}" data-act="gSub" data-v="${k}">${l}</button>`).join("")}</div>
    <div class="pbody">${body}</div>${sub === "viagem" ? travelFooter(ui, m) : ""}</div>`;
}

/** Nomes que não dizem nada sozinhos (aparecem só quando não há nada melhor). */
const VAGUE = /^(posição atual|ponto escolhido|beira da|encruzilhada|ponte quebrada|partida)/i;
const legIcon = (l) => l.type === "via" ? "flag" : l.type === "troca" ? (l.transfer === "embarque" ? "enter" : "back") : l.type === "agua" || l.use === "barco" ? "anchor" : l.offroad ? (/contornando/i.test(l.name ?? "") ? "mountain" : "compass") : "route";
/** Trechos seguidos do mesmo tipo viram um só (a lista fica curta e legível). */
function legRows(plan) {
  const out = [];
  for (const l of plan.legs) {
    if (l.type === "via") { out.push({ kind: "via", name: l.name }); continue; }
    if (l.type === "troca") { out.push({ kind: "troca", name: l.name, emb: l.transfer === "embarque" }); continue; }
    const name = (l.name ?? "Caminho").replace(/^(Até a estrada|Saindo da estrada)$/, "Fora de estrada");
    const last = out[out.length - 1];
    if (last?.kind === "leg" && last.name === name) { last.units += l.units; last.hours += l.hours; last.to = l.toName ?? last.to; last.dismount ||= l.dismount; continue; }
    out.push({ kind: "leg", name, icon: legIcon(l), units: l.units, hours: l.hours, from: l.fromName, to: l.toName, mult: l.mult, dismount: !!l.dismount });
  }
  return out;
}
/** Avisos que só explicam a escolha do caminho (não são problema): ficam neutros. */
const INFO = /^(Mais rápido seguir|Não há estrada conhecida|Nenhuma estrada a menos)/;
function warnBox(ui, all) {
  const info = (all ?? []).filter(w => INFO.test(w)); const list = (all ?? []).filter(w => !INFO.test(w));
  const infoHtml = info.map(w => `<div class="info1">${ic("compass", 13)}<span class="grow">${esc(w)}</span></div>`).join("");
  if (!list.length) return infoHtml; const open = !!ui.warnOpen;
  const first = `<div class="warn1">${ic("warn", 14)}<span class="grow">${esc(list[0])}</span>${list.length > 1 ? `<button type="button" class="linkbtn" data-act="gWarnToggle">${open ? "menos" : `+${list.length - 1}`}</button>` : ""}</div>`;
  return `${infoHtml}<div class="warnbox">${first}${open ? list.slice(1).map(w => `<div class="warn1 more">${ic("warn", 14)}<span class="grow">${esc(w)}</span></div>`).join("") : ""}</div>`;
}
function planDetails(ui, plan) {
  if (!plan) return "";
  if (plan.here) return `<p class="muted">Já estão aqui.</p>`;
  if (plan.blocked) return warnBox({ warnOpen: true }, plan.warn);
  const rows = legRows(plan); const daysOpen = ui.daysOpen ?? plan.days.length <= 3;
  const where = (r) => { const t = r.to && !VAGUE.test(r.to) && r.to !== plan.to?.name ? r.to : null; return t ? `até ${t}` : ""; };
  return `<div class="tsum"><div class="ts-to">${ic("flag", 15)}<b class="grow">${esc(plan.to?.name ?? "destino")}</b></div>
      <div class="ts-stats"><div><b>${esc(fmtUnits(plan.totalUnits, plan.units))}</b><small>distância</small></div><div><b>${esc(fmtH(plan.totalHours))}</b><small>de marcha</small></div><div><b>${plan.days.length}</b><small>${plan.days.length === 1 ? "dia" : "dias"}</small></div></div></div>
    ${warnBox(ui, plan.warn)}
    <section class="tl"><h3>Caminho</h3><ol class="tline">
      <li class="tl-pt start"><span class="dot"></span><span class="grow">${esc(plan.legs[0]?.fromName && !VAGUE.test(plan.legs[0].fromName) ? plan.legs[0].fromName : "Partida")}</span></li>
      ${rows.map(r => r.kind === "via" ? `<li class="tl-pt via"><span class="dot"></span><span class="grow">Passando por <b>${esc(r.name)}</b></span></li>`
        : r.kind === "troca" ? `<li class="tl-pt xfer"><span class="dot"></span><span class="grow"><b>${esc(r.name)}</b><small>${r.emb ? "embarcam e seguem no veículo" : "o veículo fica; seguem a pé"}</small></span></li>`
        : `<li class="tl-leg">${ic(r.icon, 14)}<span class="grow"><b>${esc(r.name)}</b>${where(r) ? ` <span class="muted">${esc(where(r))}</span>` : ""}<small>${esc(fmtUnits(r.units, plan.units))} · ${esc(fmtH(r.hours))}${r.dismount ? " · a pé" : ""}</small></span></li>`).join("")}
      <li class="tl-pt end"><span class="dot"></span><span class="grow"><b>${esc(plan.to?.name ?? "Destino")}</b></span></li></ol></section>
    <section class="days"><button type="button" class="h3btn" data-act="gDaysToggle">${ic("tent", 13)}<span class="grow">Dia a dia · ${plan.days.length}</span><span class="car">${daysOpen ? "▾" : "▸"}</span></button>
      ${daysOpen ? plan.days.map(dy => `<div class="day"><span class="dn">${dy.n}</span><div class="grow"><b>${esc(dy.where)}</b><small>${esc(fmtH(dy.hours))} de marcha${dy.forced ? " · marcha forçada" : ""}${dy.last ? "" : ` · restam ${esc(fmtH(plan.totalHours - dy.end))}`}${dy.camp ? ` · acampar (${esc(dy.zone || "ermo")})` : ""}</small></div></div>`).join("") : ""}</section>`;
}

/** Para que mapa um local leva: saída (o mapa escolhido nela) ou local que abre outro mapa do Atlas (cidade, masmorra…). */
export const linkOf = (p) => { const n = normPoi(p); const id = n.kind === "saida" ? n.exitScene : (n.submap || n.scene); return id && isMap(game.scenes.get(id)) ? id : ""; };
/** Saídas e entradas de mapa onde o grupo está agora. */
function mapLinksHere(ui, m) {
  const R = scaleOf(ui.scene).size * 0.75; const gm = game.user.isGM;
  return ui.data.pois.map(normPoi).filter(p => (gm || (!p.hidden && ["avistado", "visitado"].includes(p.state))) && linkOf(p) && linkOf(p) !== ui.scene.id && (m.at === p.id || Math.hypot(p.x - m.x, p.y - m.y) <= R));
}
function mapLinksView(ui, m) {
  const gm = game.user.isGM; if (!m || !(gm || canDrive(m))) return ""; const L = mapLinksHere(ui, m); if (!L.length) return "";
  const busy = travelActive(m.id);
  return `<section class="maplinks"><h3>Mudar de mapa</h3>${L.map(p => { const dst = game.scenes.get(linkOf(p)); const nm = dst.navName || dst.name;
    return `<div class="slot mini mlrow">${ic("enter", 15)}<div class="grow"><b>${esc(nm)}</b><small>${p.kind === "saida" ? `pela saída ${esc(p.name)}` : `entrar em ${esc(p.name)}`}</small></div>
      <button type="button" class="btn outline sm" data-act="gChangeMap" data-poi="${p.id}" ${busy || m.vote ? "disabled" : ""} data-tooltip="${gm ? "Leva a unidade (e os jogadores dela) para o outro mapa" : "Pede ao mestre para levar a unidade"}">${gm ? "Levar" : "Pedir para ir"}</button></div>`; }).join("")}</section>`;
}
function travelView(ui, m) {
  const gm = game.user.isGM; const drive = canDrive(m); const T = ui.travel;
  if (m.vote) return voteView(ui, m);
  const known = ui.data.pois.map(normPoi).filter(p => ui.gmView ? true : ["avistado", "visitado"].includes(p.state)).filter(p => p.id !== m.at).sort((a, b) => a.name.localeCompare(b.name));
  if (T.target === undefined || (T.target == null && m.plan?.target)) { T.target = m.plan?.target ?? null; T.via = [...(m.plan?.via ?? [])]; T.stops = null; }
  const plan = shownPlan(ui, m);
  const tgt = T.target; const tLabel = targetLabel(ui, tgt);
  const help = `Ctrl + segurar o clique em outro local acrescenta um destino em seguida. Paradas de descanso: ${T.stops ? "escolhidas por vocês" : "sugeridas, uma por dia"}; botão direito numa parada a tira, clique no caminho põe uma. Botão direito no mapa tira o último destino.`;
  return `${mapLinksView(ui, m)}${drive ? `<section class="tdest"><h3>Destino <span class="hint" data-tooltip="${esc(help)}">?</span></h3>${embarkMini(ui, m)}
      <div class="grow-row"><select data-field="gTarget"><option value="">${tgt && typeof tgt === "object" ? esc(tLabel) : "Escolha um local…"}</option>${flagsOf(ui).length ? `<optgroup label="Bandeiras">${flagsOf(ui).map(n => opt(`flag:${n.id}`, `⚑ ${game.users.get(n.userId)?.name ?? "?"} · ${n.text}`, "")).join("")}</optgroup>` : ""}<optgroup label="Locais">${known.map(p => opt(p.id, p.state === "rumor" && !ui.gmView ? "Local desconhecido" : p.name, typeof tgt === "string" ? tgt : "")).join("")}</optgroup></select>
      <button type="button" class="btn ${T.picking ? "gold" : ""}" data-act="gPick" data-tooltip="Clique em qualquer ponto do mapa">${ic("target", 14)} ${T.picking ? "Clique…" : "No mapa"}</button></div>
      ${T.via?.length ? `<div class="vialist">${T.via.map((v, i) => `<span class="chip">${esc(targetLabel(ui, v))}<button type="button" class="x" data-act="gViaDel" data-i="${i}" aria-label="Tirar">${ic("close", 9)}</button></span>`).join(`<span class="sep">→</span>`)}<span class="sep">→</span><span class="chip gold">${esc(tLabel)}</span></div>` : ""}
      ${tgt && T.stops ? `<button type="button" class="linkbtn" data-act="gStopsReset">Voltar às paradas sugeridas</button>` : ""}
</section>`
    : `<p class="muted">Só quem controla um personagem deste grupo escolhe o destino.</p>`}
    ${planDetails(ui, plan)}
    `;
}
/** Etapas da viagem neste mapa (Atlas › Mapa): de quanto em quanto tempo de jogo o mestre decide de novo. */
export const STEPS = { tudo: "Sem pausas (tudo de uma vez)", dia: "Um dia de marcha", 8: "8 horas", 4: "4 horas", 2: "2 horas", 1: "1 hora" };
export function stepOf(ui) { const v = String(ui.data.map?.travelStep ?? "dia"); return STEPS[v] ? v : "dia"; }
/** Até onde vai a próxima etapa (horas de marcha desde a partida). */
export function nextStop(ui, plan) {
  const st = stepOf(ui); const dayEnd = plan.days?.[0]?.end ?? plan.totalHours;
  if (st === "tudo") return plan.totalHours; if (st === "dia") return dayEnd;
  return Math.min(Number(st), dayEnd, plan.totalHours);
}
/** Rodapé fixo do painel do grupo: partir/continuar sempre à mão; as opções ficam recolhidas acima. */
function travelFooter(ui, m) {
  const gm = game.user.isGM; const plan = shownPlan(ui, m); if (!m || !canDrive(m) && !gm) return "";
  const ok = plan && !plan.here && !plan.blocked && plan.legs?.length; const st = stepOf(ui);
  const T = ui.travel; const sumO = `${PACES[T.pace]?.label ?? "Normal"} · ${WAYS[T.way ?? "estradas"]}${T.opts.crossRough ? " · atravessa" : ""}${T.opts.avoidWx ? " · evita chuva" : ""}`;
  const opts = (gm || canDrive(m)) && !m.vote ? `<div class="gp-opts ${ui.travelOptsOpen ? "open" : ""}"><button type="button" class="gp-optbtn" data-act="gOptsToggle">${ic("gear", 13)}<span class="grow">Opções da viagem</span><small>${esc(sumO)}</small><span class="car">${ui.travelOptsOpen ? "▾" : "▸"}</span></button>
    ${ui.travelOptsOpen ? `<div class="gp-optbody">${travelOpts(ui, m)}</div>` : ""}</div>` : "";
  let btns = "";
  if (gm && travelActive(m.id)) return `<footer class="gp-foot"><div class="actions row"><button type="button" class="btn danger grow" data-act="gStop" data-tooltip="O grupo para onde está agora (Esc também cancela)">${ic("close", 14)} Cancelar viagem</button></div></footer>`;
  if (m.vote) { const vs = voteState(m); if (gm && ok) btns = `<button type="button" class="btn gold grow" data-act="gGo">${vs.all ? "Autorizar e partir" : "Autorizar mesmo assim"}</button>${st !== "tudo" && nextStop(ui, plan) < plan.totalHours - 1e-6 ? `<button type="button" class="btn" data-act="gGoAll">Até o fim</button>` : ""}`; }
  else if (ok && gm) { const nx = nextStop(ui, plan); const part = nx < plan.totalHours - 1e-6; const label = !part ? (m.plan ? "Continuar até o fim" : "Partir") : st === "dia" ? `${m.plan ? "Continuar" : "Partir"}: dia (${fmtH(nx)})` : `${m.plan ? "Continuar" : "Partir"}: ${fmtH(nx)}`;
    btns = `<button type="button" class="btn gold grow" data-act="gGo" data-tooltip="${part ? "Anda só esta etapa e para, para o mestre decidir o que acontece" : "Faz a viagem inteira"}">${ic("enter", 14)} ${esc(label)}</button>${part ? `<button type="button" class="btn" data-act="gGoAll">Até o fim</button>` : ""}${votersOf(m).length ? `<button type="button" class="icon" data-act="gPropose" data-tooltip="Pedir acordo do grupo">${ic("vote", 15)}</button>` : ""}`; }
  else if (ok && !gm) btns = `<button type="button" class="btn gold grow" data-act="gPropose">${ic("vote", 14)} Propor ao grupo</button>`;
  // viagem pela metade: o grupo pode decidir ficar onde está
  const endBtn = m.plan?.target && !m.vote && (gm || canDrive(m)) ? `<div class="actions row"><button type="button" class="btn quiet danger grow" data-act="gEndTrip" data-tooltip="O grupo fica onde está agora e a viagem é encerrada (o destino é esquecido)">${ic("close", 14)} Encerrar viagem aqui</button></div>` : "";
  if (!btns && !opts && !endBtn) return "";
  return `<footer class="gp-foot">${opts}${btns ? `<div class="actions row">${btns}</div>` : ""}${endBtn}</footer>`;
}
function travelOpts(ui, m) {
  const T = ui.travel; const gm = game.user.isGM; const W = T.way ?? "estradas"; const reach = esc(String(ui.data.map?.roadReach || 25));
  const WAYTIP = { estradas: `Vai até a estrada mais próxima (até ${reach} quadros) e segue por ela, com bifurcações e pontes.`, rapido: "O que for mais rápido: estrada, atalho ou os dois. Fora da estrada contorna água funda e terreno fechado pelo desenho das Regiões.", direto: "Linha reta, fora das estradas (só contorna o que não dá para atravessar)." };
  const segT = (act, list, cur, tips) => `<div class="seg">${list.map(([v, l]) => `<button type="button" data-act="${act}" data-v="${esc(v)}" class="${String(v) === String(cur) ? "on" : ""}" data-tooltip="${esc(tips[v] ?? "")}">${esc(l)}</button>`).join("")}</div>`;
  const sw = (k, label, tip, on) => `<label class="swrow" ${tip ? `data-tooltip="${esc(tip)}"` : ""}><span class="grow">${label}</span><input type="checkbox" class="switch" data-field="opt" data-k="${k}" ${on ? "checked" : ""}></label>`;
  return `<div class="ogrp"><span class="oh">Como viajar</span>
      <div class="tset"><span class="lab">Ritmo</span>${segT("gPace", Object.entries(PACES).map(([k, v]) => [k, v.label]), T.pace, Object.fromEntries(Object.entries(PACES).map(([k, v]) => [k, v.note ?? ""])))}</div>
      <div class="tset"><span class="lab">Caminho</span>${segT("gWay", Object.entries(WAYS), W, WAYTIP)}</div>
      ${gm && W === "estradas" ? `<label class="inline">Raio até a estrada <input type="number" class="num" min="1" step="1" data-field="gReach" value="${reach}"> quadros</label>` : ""}
      ${sw("crossRough", "Atravessar terrenos difíceis", "Ligado: atravessa montanha, floresta, pântano e água rasa em linha reta (gastando o tempo que custam). Desligado: desvia quando dar a volta for mais rápido. Água funda e terreno fechado são sempre contornados.", T.opts.crossRough)}
      ${sw("avoidWx", "Desviar do mau tempo", "O caminho contorna chuva (muito) e nuvens (um pouco), pelo céu de agora. Não muda o tempo de marcha calculado.", T.opts.avoidWx)}
      ${(() => { try { return game.settings.get(MODULE_ID, "teleport"); } catch (e) { return false; } })() ? sw("noPortals", "Não usar portais", "Ligado: o caminho não passa por portais, mesmo que seja mais rápido.", T.opts.noPortals) : ""}</div>
    ${gm ? `<div class="ogrp"><span class="oh">Ao viajar</span>
      ${sw("time", "Avançar o relógio do mundo", "", T.opts.time)}
      ${sw("encounters", "Rolar encontros por zona", "", T.opts.encounters)}
      ${sw("reveal", "Revelar a névoa no caminho", "", T.opts.reveal)}
      <div class="orow">${m && !m.at && game.modules.get("pontos-de-apoio")?.active ? `<button type="button" class="btn quiet sm" data-act="gCamp">${ic("tent", 13)} Acampar</button>` : ""}<button type="button" class="btn quiet sm" data-act="gRest" data-tooltip="Zera as horas de marcha de hoje">${ic("tent", 13)} Descansar</button></div></div>` : ""}`;
}

function voteView(ui, m) {
  const gm = game.user.isGM; const v = m.vote; const st = voteState(m); const plan = shownPlan(ui, m);
  const me = game.user.id; const iVote = st.voters.includes(me); const by = game.users.get(v.by)?.name ?? "Alguém";
  const rows = st.voters.map(u => { const s = st.acc[u] ? ["ok", "concorda"] : st.rej[u] ? ["no", "não concorda"] : ["wait", "esperando"]; return `<div class="voter ${s[0]}"><span class="vdot"></span><span class="grow">${esc(game.users.get(u)?.name ?? "?")}</span><small>${s[1]}</small></div>`; }).join("") || `<p class="muted">Ninguém controla os personagens deste grupo: o mestre decide.</p>`;
  return `<div class="votecard ${st.all ? "ready" : st.anyNo ? "no" : ""}">
      <div class="vt">${ic("vote", 16)}<div class="grow"><b>${esc(by)} propôs ir para ${esc(targetLabel(ui, v.target))}</b><small>Ritmo ${esc(PACES[v.pace]?.label?.toLowerCase() ?? "normal")} · ${esc(WAYS[wayOf(v)].toLowerCase())}</small></div></div>
      ${rows}
      <small class="vstatus">${st.all ? (st.voters.length ? "Todos concordaram. Falta o mestre autorizar." : "Aguardando o mestre.") : st.anyNo ? "Alguém não concordou." : `Esperando ${st.pending.length} de ${st.voters.length}.`}</small>
      <div class="actions row">
        ${iVote ? `<button type="button" class="btn ${st.acc[me] ? "gold" : ""} grow" data-act="gVote" data-v="1">${ic("check", 14)} Concordo</button><button type="button" class="btn ${st.rej[me] ? "danger" : ""}" data-act="gVote" data-v="0">Não</button>` : ""}
        ${gm || v.by === me ? `<button type="button" class="btn" data-act="gCancel">Cancelar proposta</button>` : ""}
      </div>

    </div>${planDetails(ui, plan)}`;
}

function slotList(kind, refs, gm, label) {
  const items = refs.map(r => { const a = actorRef(r); const ts = a ? travelSpeeds(a) : null; const sp = a ? [["land", "terra"], ["water", "água"], ["air", "ar"]].map(([k, l]) => ts[k] ? `${l} ${(Math.round(ts[k] * 10) / 10)} mi/h` : "").filter(Boolean).join(" · ") : "";
    const vt = a?.type === "vehicle" ? VEHICLE_TYPES[vehicleType(a)] : null;
    return `<div class="slot">${avatar(a)}${vt ? `<span class="vtic" data-tooltip="${esc(vt.label)}">${ic(vt.icon, 22)}</span>` : ""}<div class="grow"><b>${esc(a?.name ?? "ator não encontrado")}</b><small>${esc([vt?.label, sp || "sem velocidade de viagem na ficha"].filter(Boolean).join(" · "))}</small></div>${a ? `<button type="button" class="icon" data-act="gSheet" data-ref="${esc(r)}" data-tooltip="Abrir ficha" aria-label="Abrir ficha">${ic("journal", 13)}</button>` : ""}${gm ? `<button type="button" class="icon" data-act="gRemove" data-k="${kind}" data-ref="${esc(r)}" aria-label="Remover">${ic("close", 12)}</button>` : ""}</div>`; }).join("");
  return `${items}${gm ? `<div class="drop" data-drop="Actor" data-field-target="g:${kind}">${ic("plus", 13)}<span class="grow">${esc(label)}</span></div>` : ""}`;
}
function compositionView(ui, m) {
  const gm = game.user.isGM; const mine = new Set(ownedMembers(game.user, m)); const sel = ui.splitSel ?? (ui.splitSel = new Set());
  const members = m.members.map(r => ({ r, a: actorRef(r) }));
  const others = groupsOf(ui).filter(o => o.id !== m.id && Math.hypot(o.x - m.x, o.y - m.y) < scaleOf(ui.scene).size * 0.8);
  const free = gm ? (game.actors?.contents ?? [...(game.actors ?? [])]).filter(a => a.type === "character" && a.hasPlayerOwner && !groupsOf(ui).some(g => g.members.includes(a.id))) : [];
  const veh = m.vehicle ? actorRef(m.vehicle) : null; const tr = transportOf(m);
  const mountSlot = (r) => { const mr = m.mountOf?.[r]; const ma = mr ? actorRef(mr) : null; const can = gm || mine.has(r);
    if (ma) return `<span class="mslot on" data-tooltip="Montaria: ${esc(ma.name)} · ${Math.round(travelSpeeds(ma).land * 10) / 10} mi/h">${avatar(ma, "xs")}${ic("horse", 11)}${can ? `<button type="button" class="x" data-act="gMountDel" data-ref="${esc(r)}" aria-label="Tirar montaria">${ic("close", 10)}</button>` : ""}</span>`;
    return can && !veh ? `<span class="mslot drop" data-drop="Actor" data-field-target="g:mount:${esc(r)}" data-tooltip="Arraste a ficha de uma montaria para este personagem">${ic("horse", 12)}<small>montaria</small></span>` : ""; };
  return `<section><h3>Personagens · ${members.length}</h3>
      ${members.map(({ r, a }) => { const owners = game.users.filter(u => !u.isGM && a?.testUserPermission?.(u, "OWNER")).map(u => u.name).join(", ");
        return `<div class="slot member">${(gm || mine.has(r)) && members.length > 1 ? `<input type="checkbox" data-field="gSplitSel" data-ref="${esc(r)}" ${sel.has(r) ? "checked" : ""} aria-label="Marcar para dividir">` : ""}${avatar(a)}<div class="grow"><b>${esc(a?.name ?? "?")}</b><small>${esc([owners, a ? `${Math.round(travelSpeeds(a).land * 10) / 10} mi/h a pé` : ""].filter(Boolean).join(" · "))}</small></div>${mountSlot(r)}${a ? `<button type="button" class="icon" data-act="gSheet" data-ref="${esc(r)}" aria-label="Abrir ficha">${ic("journal", 13)}</button>` : ""}${gm ? `<button type="button" class="icon" data-act="gRemove" data-k="members" data-ref="${esc(r)}" aria-label="Tirar do grupo">${ic("close", 12)}</button>` : ""}</div>`; }).join("") || `<p class="muted">Ninguém ainda.</p>`}
      ${tr.mode === "montaria" ? `<small class="muted">Todos montados: o grupo anda no passo da montaria mais lenta.</small>` : tr.mounts.length ? `<small class="muted">Nem todos têm montaria: o grupo segue a pé.</small>` : ""}
      ${gm ? `<div class="drop" data-drop="Actor" data-field-target="g:members">${ic("plus", 13)}<span class="grow">Arraste personagens para cá</span></div>
        ${free.length ? `<div class="chips wrap">${free.map(a => `<button type="button" class="chip btnchip" data-act="gAdd" data-ref="${a.id}">${ic("plus", 11)} ${esc(a.name)}</button>`).join("")}</div>` : ""}` : ""}
      ${members.length > 1 && (gm || mine.size) ? `<div class="actions row"><button type="button" class="btn grow" data-act="gSplit" ${sel.size && sel.size < members.length ? "" : "disabled"}>${ic("split", 14)} Dividir: marcados formam outro grupo</button></div>` : ""}
      ${others.length && (gm || mine.size) ? `<div class="actions row">${others.map(o => `<button type="button" class="btn" data-act="gMerge" data-id="${o.id}">${ic("merge", 14)} Juntar com ${esc(o.name)}</button>`).join("")}</div>` : ""}</section>
    ${veh ? `<section><h3>Veículo</h3>${slotList("vehicle", [m.vehicle], gm, "")}<small class="muted">Tipo, velocidade de viagem e horas por dia vêm da ficha do veículo.</small>
      ${canDrive(m) ? `<div class="actions row"><button type="button" class="btn" data-act="gDisembark" data-tooltip="O veículo fica parado aqui no mapa; o grupo segue sem ele e pode embarcar de novo depois">${ic("enter", 14)} Desembarcar (deixar o veículo aqui)</button></div>` : ""}
      <h3>Puxado por</h3>${slotList("draft", tr.draftRefs, gm, "Arraste animais de tração (vão para a ficha do veículo)")}</section>`
      : gm ? `<div class="drop slim" data-drop="Actor" data-field-target="g:vehicle">${ic("carroca", 14)}<span class="grow">Arraste um veículo (carroça, barco, balão…)</span></div>` : ""}
    ${m.members.length ? formationSection(ui, m, tr) : ""}`;
}
/** Tipo do marcador sem veículo: pessoa (um só) ou grupo. */
export const footKind = (g) => ((g.members ?? []).length === 1 ? "pessoa" : "grupo");
/** Linha compacta (no card da lista e no card de viagem): veículos parados perto, com o botão de embarcar; ou desembarcar. */
function embarkMini(ui, m) {
  if (m.vehicle && canDrive(m)) { const v = actorRef(m.vehicle); return `<div class="gc-embark"><div class="emb-row"><span class="mvdot sm">${ic(transportIcon(m), 13)}</span><span class="grow"><b>${esc(v?.name ?? "Veículo")}</b><small>a bordo</small></span><button type="button" class="btn sm" data-act="gDisembark" data-gid="${m.id}" data-tooltip="O veículo fica parado aqui no mapa; o grupo segue sem ele">${ic("back", 13)} Desembarcar</button></div></div>`; }
  if (m.vehicle || !canDrive(m)) return ""; const list = parkedNear(ui, m); if (!list.length) return "";
  return `<div class="gc-embark">${list.map(p => `<div class="emb-row"><span class="mvdot sm">${ic(p.icon || "carroca", 13)}</span><span class="grow"><b>${esc(p.name)}</b><small>veículo parado aqui${p.leftBy && p.leftBy !== m.name ? ` · deixado por ${esc(p.leftBy)}` : ""}</small></span><button type="button" class="btn gold sm" data-act="gEmbark" data-id="${p.id}" data-gid="${m.id}" data-tooltip="Embarcar ${esc(p.name)}">${ic("enter", 13)} Embarcar</button></div>`).join("")}</div>`;
}
/** Veículos parados ao alcance: embarcar de novo. */
function embarkRow(ui, m) {
  if (!canDrive(m)) return ""; const list = parkedNear(ui, m); if (!list.length) return "";
  return `<section class="embark"><h3>Veículo parado aqui</h3>${list.map(p => { const a = actorRef(p.vehicle); return `<div class="slot">${avatar(a)}<div class="grow"><b>${esc(p.name)}</b><small>${esc(a ? VEHICLE_TYPES[vehicleType(a)]?.label ?? "Veículo" : "Veículo")}${p.leftBy ? ` · deixado por ${esc(p.leftBy)}` : ""}</small></div><button type="button" class="btn gold" data-act="gEmbark" data-id="${p.id}">${ic("enter", 14)} Embarcar</button></div>`; }).join("")}</section>`;
}
/** Marcador do grupo no mapa (só o mestre). */
function markerView(ui, m) {
  return `<section><h3>Marcador no mapa</h3><label>Nome<input type="text" data-field="gField" data-k="name" value="${esc(m.name)}"></label>
      ${seg("gKind", Object.entries(MOVER_KINDS).map(([k, v]) => [k, v.label]), m.kind)}
      <span class="lab">Ícone</span><div class="iconpick"><button type="button" class="${!m.icon ? "on" : ""}" data-act="gIcon" data-v="" data-tooltip="Automático (pelo transporte)">${ic(transportIcon({ ...m, icon: "" }), 16)}</button>${customIcons().map(c => { const n = `${c.mode === "pic" ? "pic" : "img"}:${c.src}`; return `<button type="button" class="mine ${m.icon === n ? "on" : ""}" data-act="gIcon" data-v="${esc(n)}" data-tooltip="${esc(c.name)}">${ic(n, 16)}</button>`; }).join("")}${ICON_SET.map(n => `<button type="button" class="${m.icon === n ? "on" : ""}" data-act="gIcon" data-v="${n}" data-tooltip="${esc(iconName(n))}" aria-label="${esc(iconName(n))}">${ic(n, 16)}</button>`).join("")}<button type="button" data-act="iconAdd" data-for="group" data-tooltip="Adicionar ícone próprio">${ic("plus", 16)}</button></div>
      <label>Cor do grupo<div class="row2"><input type="color" class="colorpick" data-field="gField" data-k="color" value="${esc(m.color || MOVER_KINDS[m.kind].color)}"><button type="button" class="btn" data-act="gColor" data-v="" ${m.color ? "" : "disabled"}>Padrão</button></div></label>
      <div class="swatches">${["#2a6fb0", "#c0392b", "#3f8f4a", "#b0702a", "#7a4ab0", "#2a8aa0", "#c9a227", "#1b1610", "#e8dcc0", "#b04a8a"].map(c => `<button type="button" class="sw ${m.color === c ? "on" : ""}" data-act="gColor" data-v="${c}" style="background:${c}" aria-label="${c}"></button>`).join("")}</div>
      <div class="grid2"><label>Retrato (opcional)<input type="text" data-field="gField" data-k="img" value="${esc(m.img)}"></label>
        <label>Nome no mapa<select data-field="gField" data-k="labelMode">${opt("", "Padrão do módulo", m.labelMode)}${opt("sempre", "Sempre", m.labelMode)}${opt("hover", "Ao passar o mouse", m.labelMode)}${opt("sel", "Só selecionado", m.labelMode)}</select></label></div>
      <label class="check"><input type="checkbox" data-field="gField" data-k="main" ${m.main ? "checked" : ""}> Grupo principal</label>
      <label class="check"><input type="checkbox" data-field="gField" data-k="hidden" ${m.hidden ? "checked" : ""}> Oculto dos jogadores (também no mapa)</label>
      <label class="check"><input type="checkbox" data-field="gField" data-k="public" ${m.public ? "checked" : ""}> Jogadores sem personagem no grupo também o veem na lista</label>
      <div class="actions row"><button type="button" class="btn danger" data-act="gDelete">${ic("trash", 13)} Apagar grupo</button></div></section>`;
}
/* ---------- ações da interface ---------- */
const planNow = (ui, m) => { const t = m.vote?.target ?? ui.travel.target; const pace = m.vote?.pace ?? ui.travel.pace; const way = m.vote ? wayOf(m.vote) : (ui.travel.way ?? "estradas");
  const stops = m.vote ? (m.vote.stops ?? null) : (ui.travel.stops ?? null); const via = m.vote ? (m.vote.via ?? []) : (ui.travel.via ?? []);
  return t ? planTravel(ui.scene, m, t, { pace, direct: way === "direto", roads: way === "estradas", gm: true, stops, via: via.length ? via : null, avoidWx: !!ui.travel?.opts?.avoidWx, avoidRough: !ui.travel?.opts?.crossRough, portals: !ui.travel?.opts?.noPortals }) : null; };
/** Seleciona um grupo: abre o painel do grupo e a aba Viagem do Atlas. */
export function selectGroup(ui, id, sub = null) {
  ui.travel.moverId = id; ui.travel.target = undefined; ui.travel.picking = false; ui.splitSel = null; ui.gpanel = true; if (sub) ui.groupSub = sub; else if (ui.groupSub === "marcador" && !game.user.isGM) ui.groupSub = "viagem";
  ui.panel = "grupo"; try { globalThis.ui?.atlas?.showGroup?.(); } catch (e) { /* */ } ui.refresh();
}
export async function groupAct(ui, act, ds, el, e = null) {
  const sc = ui.scene; const gm = game.user.isGM; const m = currentGroup(ui);
  switch (act) {
    case "gSub": ui.groupSub = ds.v; ui.refresh(); return true;
    case "gOmToggle": ui.omOpen = !ui.omOpen; ui.refresh(); return true;
    case "gWarnToggle": ui.warnOpen = !ui.warnOpen; ui.refresh(); return true;
    case "gDaysToggle": { const p = m ? shownPlan(ui, m) : null; ui.daysOpen = !(ui.daysOpen ?? (p?.days?.length ?? 0) <= 3); ui.refresh(); return true; }
    case "gChangeMap": { if (!m || !ds.poi) return true; const P = ui.data.pois.find(x => x.id === ds.poi); const dst = P ? game.scenes.get(linkOf(P)) : null;
      if (!gm && dst) globalThis.ui?.notifications?.info(`Atlas · pedido enviado ao mestre: levar ${m.name} para ${dst.navName || dst.name}.`);
      await request("groupChangeMap", { sceneId: sc.id, moverId: m.id, poiId: ds.poi }); return true; }
    case "gSelect": if (e?.ctrlKey || e?.metaKey || e?.shiftKey) { // vários grupos (para unir)
        ui.gMulti ??= []; if (!ui.gMulti.length && ui.gpanel && ui.travel.moverId && ui.travel.moverId !== ds.id) ui.gMulti.push(ui.travel.moverId);
        ui.gMulti = ui.gMulti.includes(ds.id) ? ui.gMulti.filter(x => x !== ds.id) : [...ui.gMulti, ds.id]; ui.refreshChrome(); return true; }
      ui.gMulti = []; if (ui.gpanel && ui.travel.moverId === ds.id) { ui.gpanel = false; ui.refresh(); return true; } selectGroup(ui, ds.id); return true;
    case "gClose": ui.gpanel = false; ui.travel.picking = false; ui.refresh(); return true;
    case "gExpand": ui.gExpand = { ...(ui.gExpand ?? {}), [ds.id]: !ui.gExpand?.[ds.id] }; ui.refreshChrome(); return true;
    case "gWay": ui.travel.way = ds.v; ui.travel.stops = null; ui.refresh(); return true;
    case "gViaDel": ui.travel.via = (ui.travel.via ?? []).filter((_, i) => i !== Number(ds.i)); ui.travel.stops = null; ui.refresh(); return true;
    case "gStopsReset": ui.travel.stops = null; ui.refresh(); return true;
    case "gDisembark": { const gid = ds.gid || m?.id; if (gid) await request("groupDisembark", { sceneId: sc.id, moverId: gid }); return true; }
    case "gEmbark": { const gid = ds.gid || m?.id; if (gid) await request("groupEmbark", { sceneId: sc.id, moverId: gid, parkedId: ds.id }); return true; }
    case "gCenterAny": { const g = ui.data.movers.find(x => x.id === ds.id); if (g) canvas.animatePan?.({ x: g.x, y: g.y, duration: 400 }); return true; }
    case "gParkedDel": if (gm && await foundry.applications.api.DialogV2.confirm({ window: { title: "Veículo parado" }, content: "<p>Tirar este veículo do mapa? A ficha não é afetada.</p>", rejectClose: false }).catch(() => false)) await mutateData(sc, (D) => { D.movers = D.movers.filter(x => x.id !== ds.id); return ["movers"]; }); return true;
    case "gMountDel": if (m) await request("groupMount", { sceneId: sc.id, moverId: m.id, ref: ds.ref, mount: null }); return true;
    case "gPick": ui.travel.picking = !ui.travel.picking; ui.travel.hover = null; ui.refresh(); return true;
    case "gPace": ui.travel.pace = ds.v; ui.refresh(); return true;
    case "gCenter": if (m) canvas.animatePan?.({ x: m.x, y: m.y, duration: 400 }); return true;
    case "gCenterId": { const g = groupsOf(ui).find(x => x.id === ds.id); if (g) canvas.animatePan?.({ x: g.x, y: g.y, duration: 400 }); return true; }
    case "gViewMap": { const s2 = game.scenes.get(ds.sid); if (s2) await s2.view(); return true; }
    case "gPlaceHere": if (gm && ds.sid && ds.id) await request("groupMoveMap", { from: ds.sid, to: sc.id, moverId: ds.id }); return true;
    case "gTimeSync": if (gm && ds.id) await syncGroupClock(ds.id); ui.refresh(); return true;
    case "gHideId": if (gm) await mutateData(sc, (D) => { const g = D.movers.find(x => x.id === ds.id); if (g) g.hidden = !g.hidden; return ["movers"]; }); return true;
    case "gPropose": if (!m || !ui.travel.target) return true; await request("groupPropose", { sceneId: sc.id, moverId: m.id, target: ui.travel.target, pace: ui.travel.pace, way: ui.travel.way ?? "estradas", stops: ui.travel.stops ?? null, via: ui.travel.via ?? [] }); ui.travel.picking = false; return true;
    case "gVote": if (m) await request("groupVote", { sceneId: sc.id, moverId: m.id, accept: ds.v === "1" }); return true;
    case "gCancel": if (m) await request("groupCancel", { sceneId: sc.id, moverId: m.id }); return true;
    case "gOptsToggle": ui.travelOptsOpen = !ui.travelOptsOpen; ui.refreshChrome(); return true;
    case "gGo": case "gGoDay": case "gGoAll": {
      if (!gm || !m) return true; if (travelActive(m.id)) { globalThis.ui?.notifications?.warn(`Atlas · ${m.name} já está viajando. Espere chegar ou pare a viagem.`); return true; } const plan = planNow(ui, m); if (!plan || plan.here || plan.blocked) return true; el.disabled = true;
      const upTo = act === "gGoAll" ? plan.totalHours : act === "gGoDay" ? (plan.days?.[0]?.end ?? plan.totalHours) : nextStop(ui, plan);
      const r = await executeTravel(sc, plan, { ...ui.travel.opts, upTo });
      ui.travel.preview = null; ui.travel.stops = null; if (r?.cancelled) { ui.travel.target = null; ui.travel.via = []; ui.cache.plans = {}; } else if (r?.arrived) { ui.travel.target = null; ui.travel.via = []; ui.cache.plans = {}; } else { ui.travel.target = undefined; }
      ui.refresh(); return true;
    }
    case "gEndTrip": { if (!m) return true; await request("groupEndTrip", { sceneId: sc.id, moverId: m.id }); ui.travel.target = null; ui.travel.via = []; ui.travel.preview = null; ui.travel.stops = null; ui.cache.plans = {}; ui.refresh(); return true; }
    case "gStop": { if (!gm) return true; await cancelTravel(sc, m?.id ?? null); ui.travel.target = null; ui.travel.via = []; ui.travel.preview = null; ui.travel.stops = null; ui.cache.plans = {}; ui.refresh(); return true; }
    case "gRest": if (m) await mutateData(sc, (D) => { const g = D.movers.find(x => x.id === m.id); if (g) g.today = 0; return ["movers"]; }); return true;
    case "gCamp": if (m) { await mutateData(sc, (D) => { const g = D.movers.find(x => x.id === m.id); if (g) g.today = 0; return ["movers"]; }); game.modules.get("pontos-de-apoio")?.api?.open?.(); } return true;
    case "gSheet": { const a = actorRef(ds.ref); a?.sheet?.render(true); return true; }
    case "gAdd": if (gm && m) await mutateData(sc, (D) => { const g = D.movers.find(x => x.id === m.id); if (g) { g.members = [...new Set([...(g.members ?? []), ds.ref])]; for (const o of D.movers) if (o.id !== g.id) o.members = (o.members ?? []).filter(r => r !== ds.ref); } return ["movers"]; }); return true;
    case "gRemove": if (gm && m && ds.k === "draft") { const veh = actorRef(m.vehicle); if (veh && sheetDraft(veh).includes(ds.ref)) { await veh.update({ "system.draft.value": sheetDraft(veh).filter(r => r !== ds.ref) }); ui.refresh(); return true; } }
      if (gm && m) await mutateData(sc, (D) => { const g = D.movers.find(x => x.id === m.id); if (!g) return []; if (ds.k === "vehicle") { g.vehicle = ""; g.draft = []; if (["veiculo", "navio", "balao", "aeronave"].includes(g.kind)) g.kind = footKind(g); if (["carroca", "navio", "balao", "aeronave"].includes(g.icon)) g.icon = ""; } else g[ds.k] = (g[ds.k] ?? []).filter(r => r !== ds.ref); return ["movers"]; }); return true;
    case "gColor": if (gm && m) await mutateData(sc, (D) => { const g = D.movers.find(x => x.id === m.id); if (g) g.color = ds.v; return ["movers"]; }); return true;
    case "gIcon": if (gm && m) await mutateData(sc, (D) => { const g = D.movers.find(x => x.id === m.id); if (g) g.icon = ds.v; return ["movers"]; }); return true;
    case "gKind": if (gm && m) await mutateData(sc, (D) => { const g = D.movers.find(x => x.id === m.id); if (g) g.kind = ds.v; return ["movers"]; }); return true;
    case "gSplit": { const sel = [...(ui.splitSel ?? [])]; if (!m || !sel.length) return true; await request("groupSplit", { sceneId: sc.id, moverId: m.id, members: sel }); ui.splitSel = null; return true; }
    case "gMerge": if (m) await request("groupMerge", { sceneId: sc.id, a: m.id, b: ds.id }); return true;
    case "gMergeSel": { const ids = [...(ui.gMulti ?? [])]; if (ids.length < 2) return true; const into = ds.id && ids.includes(ds.id) ? ds.id : ids[0];
      for (const id of ids) if (id !== into) await request("groupMerge", { sceneId: sc.id, a: into, b: id }); ui.gMulti = []; selectGroup(ui, into); return true; }
    case "gMultiClear": ui.gMulti = []; ui.refreshChrome(); return true;
    case "gNew": if (!gm) return true; {
      const id = uid(); const base = m ?? { x: (sc.dimensions?.sceneX ?? 0) + (sc.dimensions?.sceneWidth ?? sc.width) / 2, y: (sc.dimensions?.sceneY ?? 0) + (sc.dimensions?.sceneHeight ?? sc.height) / 2, at: null };
      await mutateData(sc, (D) => { D.movers.push(normMover({ id, name: `Grupo ${D.movers.length + 1}`, kind: "grupo", x: base.x, y: base.y, at: base.at, main: !D.movers.length })); return ["movers"]; });
      selectGroup(ui, id, "composicao"); return true;
    }
    case "gDelete": if (gm && m && await foundry.applications.api.DialogV2.confirm({ window: { title: "Apagar grupo" }, content: `<p>Apagar o grupo <b>${esc(m.name)}</b> do mapa? Os personagens não são afetados.</p>`, rejectClose: false }).catch(() => false)) { await mutateData(sc, (D) => { D.movers = D.movers.filter(x => x.id !== m.id); return ["movers"]; }); ui.travel.moverId = null; ui.refresh(); } return true;
  }
  return false;
}
export async function groupField(ui, el) {
  const sc = ui.scene; const k = el.dataset.k; const val = el.type === "checkbox" ? el.checked : el.value; const m = currentGroup(ui);
  switch (el.dataset.field) {
    case "gMergeInto": ui.gMergeInto = val; ui.refreshChrome(); return true;
    case "gSel": ui.travel.moverId = val; ui.travel.target = undefined; ui.splitSel = null; ui.refresh(); return true;
    case "gTarget": {
      if (String(val).startsWith("flag:")) { const n = flagsOf(ui).find(x => x.id === val.slice(5)); ui.travel.target = n ? { x: n.x, y: n.y, name: `bandeira de ${game.users.get(n.userId)?.name ?? "alguém"}` } : null; }
      else ui.travel.target = val || null;
      ui.travel.picking = false; ui.travel.preview = null; ui.travel.stops = null; ui.travel.via = []; ui.refresh(); return true; }
    case "gSearch": ui.groupQ = val; { const body = el.closest(".pbody"); const q = String(val).trim().toLowerCase(); for (const c of body?.querySelectorAll(".gcard2") ?? []) c.style.display = !q || c.textContent.toLowerCase().includes(q) ? "" : "none"; } return true;
    case "gReach": if (game.user.isGM) { const { saveData } = await import("./data.js"); await saveData(sc, { "map.roadReach": Math.max(1, Number(val) || 25) }); ui.cache.plans = {}; ui.refresh(); } return true;
    case "gSplitSel": { ui.splitSel ??= new Set(); if (val) ui.splitSel.add(el.dataset.ref); else ui.splitSel.delete(el.dataset.ref); ui.refreshChrome(); return true; }
    case "gRole": case "gPos": { if (!m) return true; const ref = el.dataset.ref; const patch = el.dataset.field === "gRole" ? { role: val } : { pos: val ? Number(val) : null };
      await request("groupRole", { sceneId: sc.id, moverId: m.id, ref, ...patch }); return true; }
    case "gType": case "gFormType": case "gFormUse": if (game.user.isGM && m) await mutateData(sc, (D) => { const g = D.movers.find(x => x.id === m.id); if (!g) return [];
      if (el.dataset.field === "gType") g.groupType = val; else { g.formation = { use: false, type: "Linha", pos: {}, ...(g.formation ?? {}) }; if (el.dataset.field === "gFormType") g.formation.type = val; else g.formation.use = !!val; }
      return ["movers"]; }); return true;
    case "gField": if (game.user.isGM && m) await mutateData(sc, (D) => { const g = D.movers.find(x => x.id === m.id); if (!g) return []; if (k === "main" && val) for (const o of D.movers) o.main = false; g[k] = val; return ["movers"]; }); return true;
  }
  return false;
}
export async function groupDrop(ui, field, data) {
  if (!field.startsWith("g:")) return false;
  const m = currentGroup(ui); if (!m || (!game.user.isGM && !field.startsWith("g:mount:"))) return true;
  const kind = field.slice(2); let ref = data.uuid ?? (data.id ? `Actor.${data.id}` : null); if (!ref) return true;
  if (kind.startsWith("mount:")) { let a0 = null; try { a0 = await fromUuid(ref); } catch (e) { /* */ } if (a0?.documentName !== "Actor") return true; await request("groupMount", { sceneId: ui.scene.id, moverId: m.id, ref: kind.slice(6), mount: a0.pack ? a0.uuid : a0.id }); return true; }
  let a = null; try { a = await fromUuid(ref); } catch (e) { /* */ }
  if (a?.documentName !== "Actor") { globalThis.ui?.notifications?.warn("Atlas: solte aqui um ator."); return true; }
  if (kind === "members" && !a.pack) ref = a.id;
  if (kind === "draft") { const veh = actorRef(m.vehicle); if (veh?.system?.draft && !a.pack) { await veh.update({ "system.draft.value": [...new Set([...sheetDraft(veh), a.uuid])] }); return true; } }
  await mutateData(ui.scene, (D) => {
    const g = D.movers.find(x => x.id === m.id); if (!g) return [];
    if (kind === "vehicle") { g.vehicle = ref; g.kind = VEHICLE_TYPES[vehicleType(a)]?.kind ?? "veiculo"; }
    else { g[kind] = [...new Set([...(g[kind] ?? []), ref])]; if (kind === "members") for (const o of D.movers) if (o.id !== g.id) o.members = (o.members ?? []).filter(r => r !== ref); }
    return ["movers"];
  });
  return true;
}

/* ---------- soltar um ator num mapa do Atlas ---------- */
/** Pergunta se vira token, grupo ou veículo abandonado. Devolve false para o Foundry não criar o token sozinho. */
export function handleActorDrop(cv, data, event) {
  if (data?.type === "Scene") { if (game.user.isGM && cv?.scene && mapOfScene(cv.scene) && !event?.altKey) { sceneDrop(cv, data); return false; } return true; }
  if (data?.type === "AtlasUnit") { if (game.user.isGM && cv?.scene && mapOfScene(cv.scene)) request("groupMoveMap", { from: data.sceneId, to: cv.scene.id, moverId: data.moverId, x: data.x, y: data.y }); return false; }
  if (data?.type === "Folder" && game.user.isGM && cv?.scene && mapOfScene(cv.scene) && !event?.altKey) { folderDrop(cv, data); return false; }
  if (data?.type !== "Actor" || !game.user.isGM || !cv?.scene || !mapOfScene(cv.scene)) return true;
  if (event?.altKey) return true; // Alt: comportamento normal (token)
  (async () => {
    let a = null; try { a = await fromUuid(data.uuid ?? `Actor.${data.id}`); } catch (e) { /* */ } if (!a) return;
    const isVeh = a.type === "vehicle"; const vt = isVeh ? vehicleType(a) : null;
    const buttons = [{ action: "token", label: "Token na cena", icon: "fa-solid fa-user" },
      { action: "grupo", label: isVeh ? "Grupo com este veículo" : "Grupo no Atlas", icon: "fa-solid fa-people-group", default: true }];
    if (isVeh) buttons.push({ action: "parado", label: "Veículo abandonado", icon: "fa-solid fa-anchor" });
    const choice = await foundry.applications.api.DialogV2.wait({ window: { title: `Atlas · ${a.name}` }, content: `<p>Este mapa é do Atlas. O que fazer com <b>${esc(a.name)}</b>?</p><p class="hint">Dica: segure Alt ao soltar para criar o token direto.</p>`, buttons, rejectClose: false }).catch(() => null);
    if (!choice) return;
    if (choice === "token") { try { const td = await a.getTokenDocument({ x: data.x - (cv.grid.size / 2), y: data.y - (cv.grid.size / 2) }); await cv.scene.createEmbeddedDocuments("Token", [td.toObject()]); } catch (e) { console.warn(`${MODULE_ID} | token`, e); } return; }
    const ref = a.pack ? a.uuid : a.id; const id = uid();
    await mutateData(cv.scene, (D) => {
      if (choice === "parado") D.movers.push({ id, name: a.name, kind: VEHICLE_TYPES[vt]?.kind ?? "veiculo", parked: true, vehicle: ref, draft: [], x: Math.round(data.x), y: Math.round(data.y), at: null, members: [], leftBy: "" });
      else if (isVeh) D.movers.push(normMover({ id, name: a.name, kind: VEHICLE_TYPES[vt]?.kind ?? "veiculo", vehicle: ref, x: Math.round(data.x), y: Math.round(data.y), main: !D.movers.some(m => !m.parked) }));
      else { for (const o of D.movers) o.members = (o.members ?? []).filter(r => r !== ref); D.movers.push(normMover({ id, name: a.name, kind: a.type === "character" ? "pessoa" : "grupo", members: [ref], img: "", x: Math.round(data.x), y: Math.round(data.y), main: !D.movers.some(m => !m.parked) })); }
      return ["movers"];
    });
    const ui = globalThis.ui?.atlasUI ?? null; if (choice !== "parado") { try { const { atlas } = await import("./ui.js"); selectGroup(atlas, id, "composicao"); } catch (e) { /* */ } }
  })();
  return false;
}
/** Cena (mapa) solta num mapa do Atlas: vira um marcador que abre essa cena, e ela passa a ser mapa filho deste. */
async function sceneDrop(cv, data) {
  let child = null; try { child = await fromUuid(data.uuid ?? `Scene.${data.id}`); } catch (e) { /* */ } if (!child || child.id === cv.scene.id) return;
  const here = cv.scene; const hm = mapOfScene(here); const cm = child.flags?.[MODULE_ID]?.map;
  const exist = dataOf(here).pois.find(p => p.submap === child.id || p.scene === child.id);
  const lvl = cm?.enabled ? cm.level : hm.level === "mundo" ? "regiao" : hm.level === "regiao" ? "cidade" : "local";
  const kind = lvl === "cidade" ? "cidade" : "local"; const name = cm?.title || child.navName || child.name;
  if (exist) { await mutateData(here, (D) => { const p = D.pois.find(x => x.id === exist.id); if (p) { p.x = Math.round(data.x); p.y = Math.round(data.y); } return ["pois"]; }); }
  else await mutateData(here, (D) => { D.pois.push(normPoi({ id: uid(), name, kind, icon: lvl === "regiao" ? "flag" : undefined, x: Math.round(data.x), y: Math.round(data.y), state: "visitado", submap: child.id })); return ["pois"]; });
  if (cm?.enabled) { if (cm.parent !== here.id) await child.update({ [`flags.${MODULE_ID}.map.parent`]: here.id }); }
  else await child.update({ [`flags.${MODULE_ID}.map`]: { enabled: true, level: lvl, parent: here.id, fog: false } });
  globalThis.ui?.notifications?.info(exist ? `Atlas · o marcador de ${name} foi movido para cá.` : `Atlas · ${name} agora é mapa filho de ${hm.title || here.name} (marcador criado).`);
}
/** Pasta de atores solta no mapa: vira um grupo com todos os atores dela (e das subpastas). */
async function folderDrop(cv, data) {
  let f = null; try { f = await fromUuid(data.uuid ?? `Folder.${data.id}`); } catch (e) { /* */ }
  if (!f || f.type !== "Actor") return;
  const actors = [...(f.contents ?? []), ...((f.getSubfolders?.(true) ?? []).flatMap(s => s.contents ?? []))].filter((a, i, l) => a && l.indexOf(a) === i);
  if (!actors.length) { ui.notifications.warn(`A pasta "${f.name}" não tem atores.`); return; }
  const veh = actors.find(a => a.type === "vehicle"); const people = actors.filter(a => a !== veh);
  const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: `Atlas · ${f.name}` }, content: `<p>Criar o grupo <b>${esc(f.name)}</b> com ${people.length} membro(s)${veh ? ` e o veículo <b>${esc(veh.name)}</b>` : ""}?</p><p class="hint">Quem já estiver noutro grupo sai de lá. Segure Alt ao soltar para o comportamento normal do Foundry.</p>`, rejectClose: false }).catch(() => false);
  if (!ok) return;
  const refOf = (a) => a.pack ? a.uuid : a.id; const members = people.map(refOf); const id = uid(); const vref = veh ? refOf(veh) : null;
  await mutateData(cv.scene, (D) => {
    for (const o of D.movers) o.members = (o.members ?? []).filter(r => !members.includes(r));
    D.movers.push(normMover({ id, name: f.name, kind: veh ? (VEHICLE_TYPES[vehicleType(veh)]?.kind ?? "veiculo") : "grupo", vehicle: vref, members, img: "", x: Math.round(data.x), y: Math.round(data.y), main: !D.movers.some(m => !m.parked) }));
    return ["movers"];
  });
  try { const { atlas } = await import("./ui.js"); selectGroup(atlas, id, "composicao"); } catch (e) { /* */ }
}
const mapOfScene = (s) => { const m = s?.flags?.[MODULE_ID]?.map; return m?.enabled ? m : null; };

/** Onde o grupo chega no outro mapa: o local escolhido, a saída que volta para cá, o local que abre este mapa, ou o centro. */
export function arrivalOf(dst, fromSceneId, poiId = "") {
  const ps = dataOf(dst).pois; let p = poiId ? ps.find(x => x.id === poiId) : null;
  p ??= ps.find(x => x.kind === "saida" && x.exitScene === fromSceneId) ?? ps.find(x => x.submap === fromSceneId || x.scene === fromSceneId);
  if (p) return { x: p.x, y: p.y, id: p.id, name: p.name };
  const D = dst.dimensions ?? {}; return { x: (D.sceneX ?? 0) + (D.sceneWidth ?? dst.width ?? 0) / 2, y: (D.sceneY ?? 0) + (D.sceneHeight ?? dst.height ?? 0) / 2, id: null, name: null };
}
/* ---------- o que o Mestre grava (pedidos pelo socket) ---------- */
const sceneOf = (id) => game.scenes.get(id);
function fx(msg) { game.socket.emit(SOCKET, { type: "fx", ...msg }); Hooks.callAll(`${MODULE_ID}.fx`, msg); }
export function registerGroupActions() {
  onAction("groupPropose", async (p, userId) => {
    const sc = sceneOf(p.sceneId); const u = game.users.get(userId); if (!sc || !u) return;
    await mutateData(sc, (D) => { const g = D.movers.find(x => x.id === p.moverId); if (!g || !controls(u, normMover(g))) return []; g.vote = { id: uid(), target: p.target, pace: p.pace ?? "normal", way: p.way ?? (p.direct ? "direto" : "estradas"), stops: Array.isArray(p.stops) ? p.stops.map(Number).filter(Number.isFinite) : null, via: Array.isArray(p.via) ? p.via : [], by: userId, accepts: u.isGM ? {} : { [userId]: true }, rejects: {}, t: Date.now() }; return ["movers"]; });
  });
  onAction("groupRole", async (p, userId) => {
    const sc = sceneOf(p.sceneId); const u = game.users.get(userId); if (!sc || !u) return;
    await mutateData(sc, (D) => { const g = D.movers.find(x => x.id === p.moverId); if (!g || !(g.members ?? []).includes(p.ref)) return [];
      if (!u.isGM && !ownedMembers(u, normMover(g)).includes(p.ref)) return [];
      if ("role" in p) g.roles = { ...(g.roles ?? {}), [p.ref]: String(p.role) };
      if ("pos" in p) { const pos = { ...(g.formation?.pos ?? {}) }; if (p.pos && Object.entries(pos).some(([r, v]) => r !== p.ref && Number(v) === Number(p.pos))) return []; if (p.pos) pos[p.ref] = Number(p.pos); else delete pos[p.ref]; g.formation = { use: false, type: "Linha", ...(g.formation ?? {}), pos }; }
      return ["movers"]; });
  });
  onAction("groupMount", async (p, userId) => {
    const sc = sceneOf(p.sceneId); const u = game.users.get(userId); if (!sc || !u) return;
    await mutateData(sc, (D) => { const g = D.movers.find(x => x.id === p.moverId); if (!g || !(g.members ?? []).includes(p.ref)) return [];
      if (!u.isGM && !ownedMembers(u, normMover(g)).includes(p.ref)) return [];
      const mo = { ...(g.mountOf ?? {}) }; if (p.mount) mo[p.ref] = p.mount; else delete mo[p.ref]; g.mountOf = mo;
      if (Array.isArray(g.mounts)) g.mounts = g.mounts.filter(x => x !== p.mount); return ["movers"]; });
  });
  onAction("groupDisembark", async (p, userId) => {
    const sc = sceneOf(p.sceneId); const u = game.users.get(userId); if (!sc || !u) return;
    await mutateData(sc, (D) => { const g = D.movers.find(x => x.id === p.moverId); if (!g?.vehicle || !controls(u, normMover(g))) return [];
      const n = normMover(g); const tr = transportOf(n); const veh = actorRef(g.vehicle);
      D.movers.push({ id: uid(), name: veh?.name ?? "Veículo", kind: g.kind, parked: true, vehicle: g.vehicle, draft: g.draft ?? [], x: g.x, y: g.y, at: g.at ?? null, color: g.color ?? "", icon: transportIcon(n, tr), leftBy: g.name, hidden: !!g.hidden, members: [] });
      g.vehicle = ""; g.draft = []; g.kind = footKind(g); g.plan = null; g.vote = null; if (VEHICLE_TYPES && ["carroca", "navio", "balao", "aeronave"].includes(g.icon)) g.icon = "";
      return ["movers"]; });
  });
  onAction("groupEmbark", async (p, userId) => {
    const sc = sceneOf(p.sceneId); const u = game.users.get(userId); if (!sc || !u) return;
    await mutateData(sc, (D) => { const g = D.movers.find(x => x.id === p.moverId), v = D.movers.find(x => x.id === p.parkedId && x.parked); if (!g || !v || g.vehicle || !controls(u, normMover(g))) return [];
      const R = (sc.grid?.size ?? 100) * 1.5; if (!u.isGM && !((g.at && g.at === v.at) || Math.hypot(v.x - g.x, v.y - g.y) <= R)) return [];
      g.vehicle = v.vehicle; g.draft = v.draft ?? []; g.kind = v.kind; g.vote = null; g.plan = null;
      g.x = v.x; g.y = v.y; g.at = v.at ?? null; // o grupo vai até onde o veículo está (o veículo não sai do lugar)
      D.movers = D.movers.filter(x => x.id !== v.id); return ["movers"]; });
  });
  onAction("groupVote", async (p, userId) => {
    const sc = sceneOf(p.sceneId); if (!sc) return;
    await mutateData(sc, (D) => { const g = D.movers.find(x => x.id === p.moverId); if (!g?.vote || !votersOf(normMover(g)).includes(userId)) return []; g.vote.accepts = { ...(g.vote.accepts ?? {}) }; g.vote.rejects = { ...(g.vote.rejects ?? {}) }; delete g.vote.accepts[userId]; delete g.vote.rejects[userId]; (p.accept ? g.vote.accepts : g.vote.rejects)[userId] = true; return ["movers"]; });
  });
  // encerrar uma viagem pela metade: o grupo fica onde está
  onAction("groupEndTrip", async (p, userId) => {
    const sc = sceneOf(p.sceneId); const u = game.users.get(userId); if (!sc || !u) return; if (travelActive(p.moverId)) return;
    let name = null, here = null;
    await mutateData(sc, (D) => { const g = D.movers.find(x => x.id === p.moverId); if (!g?.plan || !(u.isGM || controls(u, normMover(g)))) return []; name = g.name; g.plan = null; g.vote = null;
      here = g.at ? normPoi(D.pois.find(x => x.id === g.at) ?? {}).name : null; return ["movers"]; });
    if (name) await addLog({ kind: "viagem", sceneId: sc.id, group: name, text: `${name}: viagem encerrada${here ? ` em ${here}` : " no caminho"}${u.isGM ? "" : ` (por ${u.name})`}.` });
  });
  onAction("groupCancel", async (p, userId) => {
    const sc = sceneOf(p.sceneId); const u = game.users.get(userId); if (!sc) return;
    await mutateData(sc, (D) => { const g = D.movers.find(x => x.id === p.moverId); if (!g?.vote || !(u?.isGM || g.vote.by === userId)) return []; g.vote = null; return ["movers"]; });
  });
  onAction("groupSplit", async (p, userId) => {
    const sc = sceneOf(p.sceneId); const u = game.users.get(userId); if (!sc || !u) return; let newId = null;
    await mutateData(sc, (D) => {
      const g = D.movers.find(x => x.id === p.moverId); if (!g) return [];
      const mine = new Set(ownedMembers(u, normMover(g))); const take = (p.members ?? []).filter(r => (g.members ?? []).includes(r) && (u.isGM || mine.has(r)));
      if (!take.length || take.length >= (g.members ?? []).length) return [];
      g.members = g.members.filter(r => !take.includes(r)); g.vote = null;
      const first = actorRef(take[0]); newId = uid();
      D.movers.push(normMover({ id: newId, name: take.length === 1 ? (first?.name ?? "Grupo") : `${g.name} (parte)`, kind: take.length === 1 ? "pessoa" : "grupo", x: g.x, y: g.y, at: g.at, members: take, color: "", img: take.length === 1 ? (first?.prototypeToken?.texture?.src || first?.img || "") : "" }));
      return ["movers"];
    });
    if (newId) fx({ kind: "split", sceneId: sc.id, from: p.moverId, to: newId });
  });
  // saída de mapa: o grupo vai para outro mapa (pedido do jogador: o mestre confirma); os jogadores do grupo vão junto
  // teleporte por um portal: para um portal ligado a ele (linha reta no mesmo mapa, ou ligação com outro mapa)
  onAction("groupTeleport", async (p, userId) => {
    const sc = sceneOf(p.sceneId); const u = game.users.get(userId); const dst = sceneOf(p.dstScene) ?? sc; if (!sc || !u || !dst) return;
    const d = dataOf(sc); const g0 = d.movers.find(x => x.id === p.moverId); const src = d.pois.find(x => x.id === p.poiId); const to = dataOf(dst).pois.find(x => x.id === p.dstPoi); if (!g0 || !src || !to) return;
    const g = normMover(g0); const S = normPoi(src), T = normPoi(to); const say = (text) => { if (userId === game.user.id) globalThis.ui?.notifications?.warn(`Atlas · ${text}`); else game.socket.emit(SOCKET, { type: "notify", userId, text, kind: "warn" }); };
    if (!u.isGM && !controls(u, g)) return; if (travelActive(g.id)) { say(`${g.name} está viajando.`); return; }
    if (!(g.at === S.id || Math.hypot(S.x - g.x, S.y - g.y) <= scaleOf(sc).size * 0.75)) { say("o grupo precisa estar no portal."); return; }
    if (S.kind !== "circulo" || T.kind !== "circulo" || !portalLinks(sc, S.id).some(l => l.out && l.scene.id === dst.id && l.poi === T.id)) { say("estes portais não estão ligados."); return; }
    const why = portalWhy(S, g, sc, p.pw); if (why && !u.isGM) { say(`${S.name}: ${why}.`); return; }
    if (S.tpPw && String(p.pw ?? "").trim().toLowerCase() === S.tpPw.toLowerCase()) await mutateData(sc, (D) => { const m = D.movers.find(x => x.id === g.id); if (m) m.pw = [...new Set([...(m.pw ?? []), S.tpPw])]; return ["movers"]; });
    const color = S.tpColor || T.tpColor || "#b58ce8"; const anim = (scene, pts, mode, ms) => { const msg = { sceneId: scene.id, moverId: g.id, pts, dur: ms, tp: { jumps: [{ i: 0, color, mode, name: S.name }], moveMs: 0, jumpMs: ms } };
      game.socket.emit(SOCKET, { type: "anim", ...msg }); Hooks.callAll(`${MODULE_ID}.anim`, msg); };
    const start = groupClock(g.id); const secs = Math.round((S.ritual || 0) * 60); // o ritual é do portal de onde se parte
    if (dst.id === sc.id) { anim(sc, [[S.x, S.y], [T.x, T.y]], null, 2800); await new Promise(r => setTimeout(r, 2700));
      await mutateData(sc, (D) => { const m = D.movers.find(x => x.id === g.id); if (m) { m.x = Math.round(T.x); m.y = Math.round(T.y); m.at = T.id; m.plan = null; m.vote = null; } return ["movers"]; }); }
    else { anim(sc, [[S.x, S.y], [S.x, S.y]], "out", 1500); await new Promise(r => setTimeout(r, 1450));
      await mutateData(sc, (D) => { D.movers = D.movers.filter(x => x.id !== g.id); return ["movers"]; });
      await mutateData(dst, (D) => { D.movers = D.movers.filter(x => x.id !== g.id); D.movers.push({ ...foundry.utils.deepClone(g0), pw: [...new Set([...(g0.pw ?? []), ...(S.tpPw && String(p.pw ?? "").trim().toLowerCase() === S.tpPw.toLowerCase() ? [S.tpPw] : [])])], x: Math.round(T.x), y: Math.round(T.y), at: T.id, plan: null, vote: null }); return ["movers"]; });
      const users = game.users.filter(x => !x.isGM && x.active && (g.members ?? []).some(r => { const a = actorRef(r); return a?.testUserPermission?.(x, "OWNER"); }));
      for (const x of users) game.socket.emit("pullToScene", dst.id, x.id);
      game.socket.emit(SOCKET, { type: "view", sceneId: dst.id, userIds: users.map(x => x.id) });
      setTimeout(() => anim(dst, [[T.x, T.y], [T.x, T.y]], "in", 1600), 1800); }
    if (secs) try { spendTime(g.id, start, secs); } catch (e) { /* */ }
    await addLog({ kind: "viagem", sceneId: dst.id, group: g.name, from: S.name, to: T.name, arrived: true, dist: "", march: "", nights: 0, camps: [], swaps: [], via: [], enc: 0, mode: "teleporte", text: `${g.name}: teleporte de ${S.name} para ${T.name}${dst.id !== sc.id ? ` (${dst.navName || dst.name})` : ""}` });
  });
  onAction("groupChangeMap", async (p, userId) => {
    const sc = sceneOf(p.sceneId); const u = game.users.get(userId); if (!sc || !u) return;
    const d = dataOf(sc); const g0 = d.movers.find(x => x.id === p.moverId); const ex = d.pois.find(x => x.id === p.poiId); if (!g0 || !ex) return;
    const g = normMover(g0); if (!u.isGM && !controls(u, g)) return;
    const dst = game.scenes.get(linkOf(ex)); if (!dst) { globalThis.ui?.notifications?.warn("Atlas: este local não leva a nenhum mapa do Atlas."); return; }
    if (travelActive(g.id)) { globalThis.ui?.notifications?.warn(`Atlas · ${g.name} está viajando. Espere chegar antes de mudar de mapa.`); return; }
    if (!u.isGM && !(g.at === ex.id || Math.hypot(ex.x - g.x, ex.y - g.y) <= scaleOf(sc).size * 0.75)) return; // jogador: o grupo precisa estar lá
    if (!u.isGM) { const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Atlas · Mudar de mapa" }, content: `<p><b>${u.name}</b> pede para levar <b>${g.name}</b> por <b>${ex.name}</b> até <b>${dst.navName || dst.name}</b>. Permitir?</p>`, rejectClose: false }).catch(() => false);
      if (!ok) { game.socket.emit(SOCKET, { type: "notify", userId, text: `O mestre não liberou a ida para ${dst.navName || dst.name} agora.`, kind: "info" }); return; } }
    const arr = arrivalOf(dst, sc.id, ex.kind === "saida" ? ex.exitPoi : "");
    await mutateData(sc, (D) => { D.movers = D.movers.filter(x => x.id !== g.id); return ["movers"]; });
    await mutateData(dst, (D) => { D.movers = D.movers.filter(x => x.id !== g.id); D.movers.push({ ...foundry.utils.deepClone(g0), x: Math.round(arr.x), y: Math.round(arr.y), at: arr.id ?? null, plan: null, vote: null }); return ["movers"]; });
    await addLog({ kind: "viagem", sceneId: dst.id, group: g.name, from: ex.name, to: arr.name ?? (dst.navName || dst.name), arrived: true, dist: "", march: "", nights: 0, camps: [], swaps: [], via: [], enc: 0, mode: "", text: `${g.name}: ${ex.name} → ${dst.navName || dst.name}${arr.name ? ` (${arr.name})` : ""}` });
    // quem tem personagem no grupo vai para o novo mapa
    const users = game.users.filter(x => !x.isGM && x.active && (g.members ?? []).some(r => { const a = actorRef(r); return a?.testUserPermission?.(x, "OWNER"); }));
    for (const x of users) game.socket.emit("pullToScene", dst.id, x.id);
    game.socket.emit(SOCKET, { type: "view", sceneId: dst.id, userIds: users.map(x => x.id) });
    if (userId === game.user.id) await dst.view();
    else globalThis.ui?.notifications?.info(`Atlas · ${g.name} foi para ${dst.navName || dst.name}.`);
  });
  // o mestre leva uma unidade de um mapa para outro (botão "Colocar aqui" ou arrastando da lista para o mapa)
  onAction("groupMoveMap", async (p, userId) => {
    const u = game.users.get(userId); if (!u?.isGM) return;
    const src = sceneOf(p.from), dst = sceneOf(p.to); if (!src || !dst || src.id === dst.id || !isMap(dst)) return;
    if (travelActive(p.moverId)) { globalThis.ui?.notifications?.warn("Atlas · esta unidade está viajando agora. Pare a viagem antes de trocar de mapa."); return; }
    const g0 = dataOf(src).movers.find(x => x.id === p.moverId); if (!g0) return;
    let arr;
    if (Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))) { // solta num lugar: se for em cima de um local, fica nele
      const R = (dst.grid?.size ?? 100) * 0.5; const near = dataOf(dst).pois.map(normPoi).filter(q => !q.hidden).map(q => ({ q, d: Math.hypot(q.x - p.x, q.y - p.y) })).filter(o => o.d <= R).sort((a, b) => a.d - b.d)[0]?.q;
      arr = near ? { x: near.x, y: near.y, id: near.id, name: near.name } : { x: Number(p.x), y: Number(p.y), id: null, name: null };
    } else arr = arrivalOf(dst, src.id);
    const members = g0.members ?? [];
    await mutateData(src, (D) => { D.movers = D.movers.filter(x => x.id !== g0.id); return ["movers"]; });
    await mutateData(dst, (D) => { D.movers = D.movers.filter(x => x.id !== g0.id); for (const o of D.movers) o.members = (o.members ?? []).filter(r => !members.includes(r));
      const main = !!g0.main && !D.movers.some(m => m.main && !m.parked);
      D.movers.push({ ...foundry.utils.deepClone(g0), x: Math.round(arr.x), y: Math.round(arr.y), at: arr.id ?? null, plan: null, vote: null, main }); return ["movers"]; });
    await addLog({ kind: "viagem", sceneId: dst.id, group: g0.name, text: `${g0.name}: levado de ${src.navName || src.name} para ${dst.navName || dst.name}${arr.name ? ` (${arr.name})` : ""}.` });
    try { const { atlas } = await import("./ui.js"); if (atlas.scene?.id === dst.id) selectGroup(atlas, g0.id); } catch (e) { /* */ }
  });
  onAction("groupMerge", async (p, userId) => {
    const sc = sceneOf(p.sceneId); const u = game.users.get(userId); if (!sc || !u) return; let ok = false; let from = null;
    await mutateData(sc, (D) => {
      const a = D.movers.find(x => x.id === p.a), b = D.movers.find(x => x.id === p.b); if (!a || !b) return [];
      if (!u.isGM && !(controls(u, normMover(a)) && controls(u, normMover(b)))) return [];
      a.members = [...new Set([...(a.members ?? []), ...(b.members ?? [])])]; a.mounts = [...new Set([...(a.mounts ?? []), ...(b.mounts ?? [])])]; if (!a.vehicle && b.vehicle) { a.vehicle = b.vehicle; a.draft = b.draft ?? []; }
      a.vote = null; from = { x: b.x, y: b.y }; D.movers = D.movers.filter(x => x.id !== b.id); ok = true; return ["movers"];
    });
    if (ok) fx({ kind: "merge", sceneId: sc.id, to: p.a, from: p.b, fromPos: from });
  });
}

/** Aviso aos jogadores quando há uma proposta esperando o voto deles. */
const seen = new Set();
export function notifyVotes(ui) {
  if (game.user.isGM || !ui.scene) return;
  for (const g of groupsOf(ui)) {
    const v = g.vote; if (!v || seen.has(v.id)) continue; seen.add(v.id);
    if (v.by !== game.user.id && votersOf(g).includes(game.user.id)) globalThis.ui?.notifications?.info(`Atlas: ${game.users.get(v.by)?.name ?? "Alguém"} propôs um destino para ${g.name}. Veja no Atlas › Unidades.`);
  }
}

/* ---------- arrastar uma unidade da lista para o mapa ---------- */
if (!globalThis.__atlasUnitDrag) {
  globalThis.__atlasUnitDrag = true;
  document.addEventListener("dragstart", (e) => {
    const el = (e.composedPath?.() ?? []).find(n => n?.dataset?.unitDrag); if (!el || !game.user.isGM) return;
    const [sceneId, moverId] = el.dataset.unitDrag.split(":");
    e.dataTransfer.setData("text/plain", JSON.stringify({ type: "AtlasUnit", sceneId, moverId })); e.dataTransfer.effectAllowed = "move";
  }, true);
  // mapas da lista do Atlas (e da navegação de cenas do Foundry): arrastar até o mapa aberto = virar mapa filho dele
  document.addEventListener("dragstart", (e) => {
    if (!game.user.isGM) return; const path = e.composedPath?.() ?? [];
    const el = path.find(n => n?.dataset?.mapDrag || (n?.dataset?.sceneId && n.closest?.("#scene-navigation,#navigation"))); if (!el) return;
    const sc = game.scenes.get(el.dataset.mapDrag ?? el.dataset.sceneId); if (!sc) return;
    e.dataTransfer.setData("text/plain", JSON.stringify({ type: "Scene", uuid: sc.uuid, id: sc.id })); e.dataTransfer.effectAllowed = "copyMove";
  }, true);
  // soltar sobre a camada do Atlas (marcadores, modo de edição): o Foundry não recebe; trata aqui com as mesmas regras
  const onAtlasMap = (e) => { const path = e.composedPath?.() ?? []; return !path.some(n => n?.id === "board") && path.some(n => n?.classList?.contains?.("maplayer") && !n.classList.contains("hudlayer")); };
  document.addEventListener("dragover", (e) => { if (game.user.isGM && onAtlasMap(e)) e.preventDefault(); }, true);
  document.addEventListener("drop", (e) => {
    if (!game.user.isGM || !onAtlasMap(e) || !canvas?.scene) return;
    let data; try { data = JSON.parse(e.dataTransfer.getData("text/plain")); } catch (err) { return; }
    if (!["Scene", "AtlasUnit", "Actor", "Folder"].includes(data?.type)) return;
    e.preventDefault(); e.stopPropagation();
    let p = null; try { p = canvas.canvasCoordinatesFromClient?.({ x: e.clientX, y: e.clientY }); } catch (err) { /* */ }
    if (!p) { const t = canvas.stage.worldTransform; p = t.applyInverse({ x: e.clientX, y: e.clientY }); }
    handleActorDrop(canvas, { ...data, x: p.x, y: p.y }, e);
  }, true);
  // navegação de cenas do Foundry: os nomes ficam arrastáveis (para o mestre)
  Hooks.on("renderSceneNavigation", (app, html) => { if (!game.user.isGM) return; const root = html instanceof HTMLElement ? html : html?.[0]; root?.querySelectorAll?.("[data-scene-id]").forEach(li => { li.draggable = true; }); });
}
