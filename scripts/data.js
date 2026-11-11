// Dados do Atlas: tudo mora nas flags da própria cena (locais, rotas, rótulos, área explorada, posição do grupo)
// e em duas configurações do mundo (notas dos jogadores e registro de descobertas).
// Só o Mestre ativo grava; jogadores pedem pelo socket.
import { MODULE_ID, SOCKET, POI_KINDS, POI_STATES, ROUTE_TYPES, ZONE_PRESETS, MOVER_KINDS, SHAPES, CLIMATES , catOf } from "./config.js";

export const nrm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
export const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
export const uid = () => foundry.utils.randomID();
const clone = (o) => foundry.utils.deepClone(o);

/* ---------- leitura ---------- */
const F = (scene) => scene?.flags?.[MODULE_ID] ?? {};
export function mapOf(scene) { const m = F(scene).map; return m?.enabled ? m : null; }
export const isMap = (scene) => !!mapOf(scene);
export function dataOf(scene) {
  const f = F(scene);
  return {
    map: f.map ?? null,
    pois: Array.isArray(f.pois) ? f.pois : [],
    routes: Array.isArray(f.routes) ? f.routes : [],
    labels: Array.isArray(f.labels) ? f.labels : [],
    explored: Array.isArray(f.explored) ? f.explored : [],
    movers: Array.isArray(f.movers) ? f.movers : f.party?.x != null ? [{ id: "party", kind: "grupo", ...f.party, name: f.party.name || "Grupo" }] : [],
    weather: f.weather ?? null
  };
}
/** Elemento móvel normalizado (grupo, pessoa, veículo, navio). */
export function normMover(m) {
  return { id: m.id ?? uid(), name: m.name ?? "Grupo", kind: MOVER_KINDS[m.kind] ? m.kind : "grupo", x: Number(m.x) || 0, y: Number(m.y) || 0, at: m.at ?? null,
    img: m.img ?? "", actor: m.actor ?? "", color: m.color ?? "", hidden: !!m.hidden, locked: !!m.locked, today: Number(m.today) || 0, plan: m.plan ?? null, main: !!m.main,
    members: Array.isArray(m.members) ? m.members : [], public: !!m.public, icon: m.icon ?? "", groupType: m.groupType ?? "", roles: m.roles && typeof m.roles === "object" ? m.roles : {}, formation: { use: !!m.formation?.use, type: m.formation?.type ?? "Linha", pos: m.formation?.pos ?? {} }, vehicle: m.vehicle ?? "", draft: Array.isArray(m.draft) ? m.draft : [], mountOf: m.mountOf && typeof m.mountOf === "object" ? m.mountOf : {}, parked: !!m.parked, leftBy: m.leftBy ?? "", labelMode: ["sempre", "hover", "sel"].includes(m.labelMode) ? m.labelMode : "",
    mounts: [...new Set([...Object.entries(m.mountOf ?? {}).filter(([r, v]) => v && (m.members ?? []).includes(r)).map(([, v]) => v), ...(Array.isArray(m.mounts) ? m.mounts : [])])], vote: m.vote ?? null };
}
/** O grupo principal (o que viaja por padrão). */
export function mainMover(d) { const ms = d.movers.filter(m => !m.parked && (!m.hidden || game.user.isGM)); return ms.find(m => m.main) ?? ms.find(m => (m.kind ?? "grupo") === "grupo") ?? ms[0] ?? null; }
/** Aparência de uma imagem (como num tile): imagem, tinta, opacidade, escala, rotação, espelhar. */
export function imgLook(o, legacy = "") {
  o ??= {};
  return { img: o.img ?? legacy ?? "", tint: /^#[0-9a-f]{3,8}$/i.test(o.tint ?? "") ? o.tint : "", alpha: o.alpha == null || o.alpha === "" ? 1 : Math.max(0, Math.min(1, Number(o.alpha))),
    scale: Math.max(0.1, Math.min(4, Number(o.scale) || 1)), rot: Number(o.rot) || 0, flipX: !!o.flipX, flipY: !!o.flipY,
    sat: o.sat == null || o.sat === "" ? 1 : Math.max(0, Math.min(2, Number(o.sat))) };
}
/** Rosa dos ventos e ponteiro: configuração do módulo (é parte da interface, vale para todos os mapas). */
/** Configuração própria da rosa num mapa (Atlas › Mapa ou o menu da rosa em "só este mapa"). */
export const roseOwn = (scene = globalThis.canvas?.scene) => { const c = scene?.flags?.[MODULE_ID]?.map?.roseCfg; return c?.own ? c : null; };
export function hudRose(scene = globalThis.canvas?.scene, scope = null) {
  let h = {}; try { h = foundry.utils.deepClone(game.settings.get(MODULE_ID, "hud") ?? {}); } catch (e) { /* */ }
  const own = scope === "all" ? null : roseOwn(scene); if (own) h = foundry.utils.mergeObject(h, foundry.utils.deepClone(own), { inplace: false });
  return { anchor: h.anchor === "cena" ? "cena" : "tela", corner: ["nenhum", "se", "so", "ne", "no"].includes(h.corner) ? h.corner : "se", hud: Math.max(40, Math.min(500, Number(h.hud) || 140)),
    card: ["sempre", "hover", "clique", "nunca"].includes(h.card) ? h.card : "sempre", margin: h.margin === "" || h.margin == null || isNaN(Number(h.margin)) ? null : Math.max(0, Number(h.margin)), locked: !!h.locked, face: imgLook(h.face), hand: imgLook(h.hand) };
}
/** Grava na configuração deste mapa se ele tiver a sua; senão na geral. */
export async function setHudAuto(patch, scene = globalThis.canvas?.scene) { return roseOwn(scene) ? setHudMap(patch, scene) : setHud(patch); }
export async function setHudMap(patch, scene = globalThis.canvas?.scene) {
  if (!scene) return; const cur = foundry.utils.deepClone(scene.flags?.[MODULE_ID]?.map?.roseCfg ?? {}); cur.own = true;
  for (const [k, v] of Object.entries(patch)) foundry.utils.setProperty(cur, k, v);
  return saveData(scene, { "map.roseCfg": cur });
}
export async function setHud(patch) { const h = foundry.utils.deepClone(game.settings.get(MODULE_ID, "hud") ?? {}); for (const [k, v] of Object.entries(patch)) foundry.utils.setProperty(h, k, v); await game.settings.set(MODULE_ID, "hud", h); }

/** Escala real: quantos km (e milhas) vale uma unidade da grade da cena (mi, km, ft, m, jardas, léguas). */
export function kmPerUnit(u) {
  u = String(u ?? "").toLowerCase().trim();
  if (/^(km|quil)/.test(u)) return 1; if (/^(mi|milha)/.test(u)) return 1.609; if (/l[ée]gua/.test(u)) return 4.83;
  if (/^(ft|p[ée]s?$|feet|foot)/.test(u)) return 0.0003048; if (/^(yd|jarda)/.test(u)) return 0.0009144; if (/^(m|metro)/.test(u)) return 0.001;
  return 1.609; // desconhecida: trata como milha
}
export const miPerUnit = (u) => kmPerUnit(u) / 1.609;
export const knownUnit = (u) => /^(km|quil|mi|milha|ft|p[ée]s?$|feet|foot|yd|jarda|m$|metro)|l[ée]gua/.test(String(u ?? "").toLowerCase().trim());

/** Clima normalizado. */
export function normWeather(w) {
  w ??= {};
  return { enabled: !!w.enabled, climate: CLIMATES[w.climate] ? w.climate : "limpo", dir: ((Number(w.dir) || 0) % 360 + 360) % 360, force: Math.max(0, Math.min(12, Math.round(Number(w.force ?? 3)))),
    temp: w.temp === "" || w.temp == null ? 20 : Number(w.temp), note: w.note ?? "", fx: !!w.fx, players: w.players !== false,
    source: w.source === "proprio" ? "proprio" : "auto", terrain: w.terrain !== false, clouds: ["auto", "sombras", "inteiras", "nenhuma"].includes(w.clouds) ? w.clouds : "auto", cloudTime: [1, 10, 60, 600].includes(Number(w.cloudTime)) ? Number(w.cloudTime) : 1,
    cloudScale: Math.max(0.05, Math.min(10, Number(w.cloudScale) || 1)), cloudOff: w.cloudOff && typeof w.cloudOff === "object" ? w.cloudOff : {},
    rose: { ...hudRose(), north: ((Number(w.rose?.mapNorth) || 0) % 360 + 360) % 360 } };
}
export const poiById = (scene, id) => dataOf(scene).pois.find(p => p.id === id) ?? null;
export const mapScenes = () => (game.scenes?.contents ?? [...(game.scenes ?? [])]).filter(isMap);

/** Mapa "pai" e a cadeia até o topo (para a barra de navegação). */
export function chainOf(scene) {
  const out = []; let s = scene; const seen = new Set();
  while (s && !seen.has(s.id)) { seen.add(s.id); out.unshift(s); const pid = mapOf(s)?.parent; s = pid ? game.scenes.get(pid) : null; }
  return out;
}
/** Mapas que apontam este como pai. */
export const childrenOf = (scene) => mapScenes().filter(s => mapOf(s)?.parent === scene?.id);

/** Escala: quantas unidades (mi) por pixel. */
export function scaleOf(scene) {
  const g = scene?.grid ?? {};
  const size = g.size || 100; const dist = Number(g.distance) || 1; const units = g.units || "mi";
  return { perPx: dist / size, units, size, dist };
}

/** Local normalizado (preenche o que faltar). */
/** Condições de um portal: item-chave, senha, fase da lua, dia ou noite. */
const tpCond = (o) => ({ tpKey: String(o.tpKey ?? "").trim(), tpPw: String(o.tpPw ?? "").trim(), tpMoon: ["", "cheia", "nova", "crescente", "minguante"].includes(o.tpMoon) ? o.tpMoon : "", tpTime: ["", "dia", "noite"].includes(o.tpTime) ? o.tpTime : "" });
/** Ligações de um portal: as linhas retas no mesmo mapa e as ligações com portais de outros mapas.
 *  [{ scene, poi, out, in, route?, remote? }] — out: dá para ir daqui até lá; in: de lá até aqui. */
export function portalLinks(scene, id) {
  const d = dataOf(scene); const out = [];
  for (const r of d.routes ?? []) { if (r.type !== "portal" || !r.a || !r.b || r.a === r.b) continue; const one = !!r.oneway;
    if (r.a === id) out.push({ scene, poi: r.b, out: true, in: !one, route: r.id });
    else if (r.b === id) out.push({ scene, poi: r.a, out: !one, in: true, route: r.id }); }
  const p = (d.pois ?? []).find(x => x.id === id);
  for (const l of normPoi(p ?? {}).remote) { const s = game.scenes?.get?.(l.scene); if (!s) continue; out.push({ scene: s, poi: l.poi, out: l.dir !== "in", in: l.dir !== "out", remote: true }); }
  return out;
}
export function normPoi(p) {
  return {
    id: p.id ?? uid(), name: p.name ?? "Local", kind: POI_KINDS[p.kind] ? p.kind : "local", state: POI_STATES[p.state] ? p.state : "visitado",
    x: Number(p.x) || 0, y: Number(p.y) || 0, img: p.img ?? "", journal: p.journal ?? "", scene: p.scene ?? "", submap: p.submap ?? "", actor: p.actor ?? "",
    desc: p.desc ?? "", services: Array.isArray(p.services) ? p.services : [], quest: p.quest ?? "", danger: p.danger ?? "", rumor: p.rumor == null || p.rumor === "" ? 2 : Number(p.rumor) || 0, rumorText: p.rumorText ?? "",
    gmNote: p.gmNote ?? "", hidden: !!p.hidden, locked: !!p.locked, labelMode: ["sempre", "hover", "nunca"].includes(p.labelMode) ? p.labelMode : "", color: /^#[0-9a-f]{3,8}$/i.test(p.color ?? "") ? p.color : "",
    net: String(p.net ?? "").trim(), exitOnly: !!p.exitOnly, remote: Array.isArray(p.remote) ? p.remote.filter(l => l?.scene && l?.poi).map(l => ({ scene: String(l.scene), poi: String(l.poi), dir: ["out", "in"].includes(l.dir) ? l.dir : "both" })) : [], ...tpCond(p), ritual: p.ritual == null || p.ritual === "" ? 1 : Math.max(0, Number(p.ritual) || 0), tpColor: /^#[0-9a-f]{3,8}$/i.test(p.tpColor ?? "") ? p.tpColor : "",
    real: Math.max(0, Number(p.real) || 0), wxFollow: p.wxFollow == null || p.wxFollow === "" ? !(["masmorra", "mina"].includes(p.kind) || catOf(p.kind) === "edificio") : !!p.wxFollow, shop: !!p.shop, service: !!p.service, exitScene: p.exitScene ?? "", exitPoi: p.exitPoi ?? "", icon: p.icon || POI_KINDS[POI_KINDS[p.kind] ? p.kind : "local"].icon, markerImg: p.markerImg ?? "", shape: SHAPES[p.shape] ? p.shape : (p.markerImg ? "hex" : "circulo"), size: Number(p.size) || 0
  };
}
export function normRoute(r) {
  return {
    id: r.id ?? uid(), name: r.name ?? "", type: ROUTE_TYPES[r.type] ? r.type : "estrada", cond: r.cond ?? "aberta",
    points: (r.points ?? []).map(p => [Number(p[0]) || 0, Number(p[1]) || 0]), a: r.a ?? null, b: r.b ?? null,
    hidden: !!r.hidden, locked: !!r.locked, color: /^#[0-9a-f]{3,8}$/i.test(r.color ?? "") ? r.color : "", width: Number(r.width) || 1, dash: r.dash ?? "", showName: !!r.showName,
    opacity: r.opacity == null || r.opacity === "" ? 1 : Math.max(0.05, Math.min(1, Number(r.opacity))), dashScale: Number(r.dashScale) || 1,
    outline: r.outline == null ? null : !!r.outline, outlineColor: /^#[0-9a-f]{3,8}$/i.test(r.outlineColor ?? "") ? r.outlineColor : "", outlineWidth: Number(r.outlineWidth) || 3,
    gc: r.gc == null || r.gc === "" ? null : r.gc === true || r.gc === "1",
    oneway: !!r.oneway, tpShow: !!r.tpShow, ...tpCond(r), ritual: r.ritual == null || r.ritual === "" ? 1 : Math.max(0, Number(r.ritual) || 0),
    nameSize: Number(r.nameSize) || 1, nameColor: /^#[0-9a-f]{3,8}$/i.test(r.nameColor ?? "") ? r.nameColor : "",
    handles: Array.isArray(r.handles) ? r.handles : [], modes: Array.isArray(r.modes) ? r.modes : null, mult: r.mult == null || r.mult === "" ? null : Number(r.mult), bridges: r.bridges && typeof r.bridges === "object" ? r.bridges : {}, bStyle: r.bStyle ?? "", bColor: /^#[0-9a-f]{3,8}$/i.test(r.bColor ?? "") ? r.bColor : "", bWidth: r.bWidth == null || r.bWidth === "" ? null : Number(r.bWidth) || 1, bDash: r.bDash ?? "", closed: !!r.closed, group: r.group || null
  };
}

/** Configuração de zona de uma Região (flag do Atlas, ou pelo nome). null = ignorada. */
export function zoneOf(region) {
  const f = region?.flags?.[MODULE_ID]?.zone ?? {};
  if (f.preset === "none") return null;
  let preset = ZONE_PRESETS[f.preset] ? f.preset : null;
  if (!preset) { const n = nrm(region?.name); for (const [k, d] of Object.entries(ZONE_PRESETS)) if (d.words.some(w => n.includes(nrm(w)))) { preset = k; break; } }
  if (!preset) return null;
  const d = ZONE_PRESETS[preset];
  return {
    id: region.id, name: region.name || d.label, preset, label: d.label,
    mult: f.mult != null && f.mult !== "" ? Number(f.mult) : d.mult, biome: f.biome || d.biome,
    chance: Array.isArray(f.chance) ? f.chance : d.chance, table: f.table ?? "", tier: f.tier ?? "",
    color: region.color?.css ?? (typeof region.color === "string" ? region.color : null) ?? d.color, water: !!d.water, shallow: !!d.shallow, deep: !!d.deep, rough: !!d.rough, guide: !!d.guide, base: !!d.base, modes: Array.isArray(f.modes) ? f.modes : null, configured: !!region?.flags?.[MODULE_ID]?.zone
  };
}

/* ---------- configurações do mundo ---------- */
export function registerSettings() {
  game.settings.register(MODULE_ID, "notes", { scope: "world", config: false, type: Object, default: [], onChange: () => Hooks.callAll(`${MODULE_ID}.refresh`) });
  game.settings.register(MODULE_ID, "log", { scope: "world", config: false, type: Object, default: [], onChange: () => Hooks.callAll(`${MODULE_ID}.refresh`) });
  game.settings.register(MODULE_ID, "ui", { scope: "client", config: false, type: Object, default: {} });
  // relógio de cada grupo (id -> tempo do mundo em que ele está). Sem registro = junto com o relógio do mundo.
  game.settings.register(MODULE_ID, "clocks", { scope: "world", config: false, type: Object, default: {}, onChange: () => Hooks.callAll(`${MODULE_ID}.refresh`) });
  game.settings.register(MODULE_ID, "gesturePoint", { name: "Atalho: prévia da viagem", hint: "Segurar o clique esquerdo num local ou bandeira mostra a viagem que o grupo faria (Ctrl + segurar acrescenta destinos em seguida). Para apontar um lugar, use o ping normal do Foundry.", scope: "client", config: true, type: String, choices: { "hold-left": "Segurar o botão esquerdo", off: "Desligado" }, default: "hold-left" });
  game.settings.register(MODULE_ID, "gestureFlag", { name: "Atalho: fincar bandeira", hint: "Finca a sua bandeira (na sua cor) onde quer ir; ela vira um destino possível para o grupo. Botão direito na bandeira a tira.", scope: "client", config: true, type: String, choices: { "hold-right": "Segurar o botão direito", "shift-right": "Shift + clique direito", "alt-right": "Alt + clique direito", off: "Desligado" }, default: "hold-right" });
  game.settings.register(MODULE_ID, "teleport", { name: "Teleporte (portais)", hint: "Liga os portais: locais do tipo Portal ligados entre si por linhas retas (ferramenta Ligar portais), de mão única ou dupla, no mesmo mapa ou entre mapas. Um portal só leva aos portais ligados a ele; a viagem pode encadear saltos. As ligações só o mestre vê. Desligado, os portais não levam a lugar nenhum.", scope: "world", config: true, type: Boolean, default: false, requiresReload: true, onChange: () => { try { Hooks.callAll(`${MODULE_ID}.refresh`); } catch (e) { /* */ } } });
  game.settings.register(MODULE_ID, "animSlow", { name: "Velocidade da animação dos grupos", hint: "Quanto tempo o marcador leva para andar no mapa quando o grupo viaja. Não muda o tempo de viagem do jogo, só a animação.", scope: "world", config: true, type: Number, default: 3,
    choices: { 0.5: "Muito rápida", 1: "Rápida", 2: "Normal", 3: "Lenta", 5: "Muito lenta", 8: "Bem devagar" } });
  game.settings.register(MODULE_ID, "shipsWaterOnly", { name: "Navios só andam na água", hint: "Grupos de navio (ou com um veículo aquático) só viajam por rotas de rio ou mar e por Regiões de água; não cortam caminho por terra nem usam estradas.", scope: "world", config: true, type: Boolean, default: true, onChange: () => Hooks.callAll(`${MODULE_ID}.refresh`) });
  game.settings.register(MODULE_ID, "cardSize", { name: "Cartão dos locais: tamanho", hint: "O cartão que aparece ao passar o mouse num local do mapa.", scope: "client", config: true, type: Number, default: 1, range: { min: 0.6, max: 1.8, step: 0.1 }, onChange: () => Hooks.callAll(`${MODULE_ID}.refresh`) });
  game.settings.register(MODULE_ID, "cardPlace", { name: "Cartão dos locais: posição", hint: "Acima ou abaixo do marcador (automático: acima, ou abaixo quando não cabe).", scope: "client", config: true, type: String, default: "auto", choices: { auto: "Automático", acima: "Sempre acima", abaixo: "Sempre abaixo" }, onChange: () => Hooks.callAll(`${MODULE_ID}.refresh`) });
  game.settings.register(MODULE_ID, "unitLabels", { name: "Nome das unidades no mapa", hint: "Quando mostrar o nome dos grupos e veículos parados no mapa. Cada grupo pode ter o seu (Unidades › grupo › Marcador).", scope: "world", config: true, type: String, default: "sempre",
    choices: { sempre: "Sempre", hover: "Só ao passar o mouse", sel: "Só quando selecionado" }, onChange: () => Hooks.callAll(`${MODULE_ID}.refresh`) });
  game.settings.register(MODULE_ID, "wxQuality", { name: "Qualidade do clima animado", hint: "Quantas nuvens e gotas de chuva o Atlas desenha. Use média ou baixa se aparecerem travadas ou falhas na tela com o tempo.", scope: "client", config: true, type: String, default: "media",
    choices: { alta: "Alta", media: "Média (recomendada)", baixa: "Baixa (mais leve)" }, onChange: () => Hooks.callAll(`${MODULE_ID}.refresh`) });
  game.settings.register(MODULE_ID, "groupIcon", { name: "Ícone dos grupos no mapa", hint: "Desenho grande saindo por cima do círculo (como um selo), ou desenho dentro de um círculo maior.", scope: "world", config: true, type: String, default: "fora",
    choices: { fora: "Por cima do círculo (saindo para fora)", dentro: "Dentro do círculo" }, onChange: () => Hooks.callAll(`${MODULE_ID}.refresh`) });
  game.settings.register(MODULE_ID, "hud", { scope: "world", config: false, type: Object, default: {}, onChange: () => Hooks.callAll(`${MODULE_ID}.refresh`) });
  game.settings.register(MODULE_ID, "icons", { scope: "world", config: false, type: Object, default: [], onChange: () => Hooks.callAll(`${MODULE_ID}.refresh`) });
  game.settings.register(MODULE_ID, "panelSide", { name: "Posição do painel do Atlas", hint: "À esquerda, ao lado dos controles de cena (deixa a barra lateral livre para atores e chat), ou como uma aba da barra lateral direita.", scope: "client", config: true, type: String, choices: { esquerda: "À esquerda da tela", barra: "Aba na barra lateral direita" }, default: "esquerda", requiresReload: true });
}
export const notes = () => { const n = game.settings.get(MODULE_ID, "notes"); return Array.isArray(n) ? n : []; };
export const logOf = () => { const n = game.settings.get(MODULE_ID, "log"); return Array.isArray(n) ? n : []; };
export function uiPref(key, def) { const u = game.settings.get(MODULE_ID, "ui") ?? {}; return u[key] ?? def; }
export async function setUiPref(key, v) { const u = { ...(game.settings.get(MODULE_ID, "ui") ?? {}) }; u[key] = v; await game.settings.set(MODULE_ID, "ui", u); }

/* ---------- gravação (Mestre) ---------- */
export function isActiveGM() { return game.user.isGM && (game.users.activeGM?.id ?? game.user.id) === game.user.id; }

/** Grava pedaços dos dados da cena. Arrays são trocados inteiros. */
/* ---------- desfazer (Ctrl+Z) ---------- */
const UNDO = []; let undoBusy = false; let lastSnap = null;
export const undoCount = () => UNDO.length;
/** Guarda o estado anterior das partes do Atlas que vão mudar (só no mestre). */
function pushUndo(scene, keys) {
  if (undoBusy || !game.user?.isGM || !scene) return;
  const top = [...new Set(keys.map(k => k.split(".")[0]))].filter(k => k !== "party"); if (!top.length) return;
  const sig = `${scene.id}|${top.join(",")}`; const now = Date.now();
  if (lastSnap && lastSnap.sig === sig && now - lastSnap.t < 600) { lastSnap.t = now; return; } // controles deslizantes: um passo só
  const f = scene.flags?.[MODULE_ID] ?? {};
  UNDO.push({ sceneId: scene.id, t: now, data: Object.fromEntries(top.map(k => [k, f[k] === undefined ? null : clone(f[k])])) }); lastSnap = { sig, t: now };
  if (UNDO.length > 80) UNDO.shift();
}
/** Guarda as formas de uma Região antes de mudar (null: a Região é nova e o desfazer a apaga). */
export function pushRegionUndo(scene, regionId, shapes, vsrc = undefined) { if (!game.user?.isGM || !scene) return; UNDO.push({ sceneId: scene.id, t: Date.now(), region: regionId, shapes: shapes ? clone(shapes) : null, vsrc: vsrc === undefined ? undefined : clone(vsrc) }); lastSnap = null; if (UNDO.length > 80) UNDO.shift(); }
/** Paredes: o que foi criado (ids), o estado antes das mudanças e o que foi apagado. */
export function pushWallUndo(scene, w) { if (!game.user?.isGM || !scene) return; if (!w.created?.length && !w.before?.length && !w.deleted?.length) return; UNDO.push({ sceneId: scene.id, t: Date.now(), walls: clone(w) }); lastSnap = null; if (UNDO.length > 80) UNDO.shift(); }
/** Volta o último passo do Atlas. */
export async function undoAtlas() {
  const s = UNDO.pop(); lastSnap = null; if (!s) return false; const sc = game.scenes.get(s.sceneId); if (!sc) return false;
  if (s.walls) { const w = s.walls; try { if (w.created?.length) await sc.deleteEmbeddedDocuments("Wall", w.created.filter(id => sc.walls?.get?.(id)));
      if (w.before?.length) await sc.updateEmbeddedDocuments("Wall", w.before.map(o => ({ ...o, _id: o._id })).filter(o => sc.walls?.get?.(o._id)));
      if (w.deleted?.length) await sc.createEmbeddedDocuments("Wall", w.deleted.map(o => { const c = { ...o }; delete c._id; return c; })); } catch (e) { console.warn(`${MODULE_ID} | desfazer paredes`, e); } return true; }
  if (s.region) { const r = sc.regions?.get?.(s.region); if (!r) return true; try { if (s.shapes) await r.update(s.vsrc !== undefined ? { shapes: s.shapes, [`flags.${MODULE_ID}.vsrc`]: s.vsrc } : { shapes: s.shapes }); else await r.delete(); } catch (e) { console.warn(`${MODULE_ID} | desfazer região`, e); } return true; }
  undoBusy = true;
  try {
    const unset = {}, set = {};
    for (const [k, v] of Object.entries(s.data)) { if (v && typeof v === "object" && !Array.isArray(v)) unset[`flags.${MODULE_ID}.-=${k}`] = null; set[`flags.${MODULE_ID}.${k}`] = v; }
    if (Object.keys(unset).length) await sc.update(unset);
    await sc.update(set);
  } finally { undoBusy = false; }
  return true;
}
export async function saveData(scene, patch) {
  pushUndo(scene, Object.keys(patch));
  const upd = {};
  for (const [k, v] of Object.entries(patch)) upd[`flags.${MODULE_ID}.${k}`] = clone(v);
  return scene.update(upd);
}
/**
 * Altera os dados da cena lendo sempre a versão mais nova. As alterações de uma mesma cena entram numa fila:
 * duas viagens (ou uma viagem e uma edição) ao mesmo tempo não apagam o que a outra gravou.
 */
const MQ = new Map(); let mDepth = 0;
export async function mutateData(scene, fn) {
  if (mDepth) return mutateNow(scene, fn); // chamada de dentro de outra alteração: segue direto (não trava a fila)
  const k = scene?.id ?? "_"; const prev = MQ.get(k) ?? Promise.resolve();
  const run = prev.catch(() => null).then(() => mutateNow(scene, fn));
  MQ.set(k, run);
  try { return await run; } finally { if (MQ.get(k) === run) MQ.delete(k); }
}
async function mutateNow(scene, fn) {
  const d = clone(dataOf(scene)); let r; mDepth++; try { r = fn(d); } finally { mDepth--; } const keys = await r;
  if (Array.isArray(keys) && !keys.length) return null;
  const patch = {}; for (const k of keys ?? ["pois", "routes", "labels", "explored", "movers", "map"]) { patch[k] = d[k]; if (k === "movers") patch.party = null; }
  return saveData(scene, patch);
}

/* ---------- relógio de jogo (para as animações) ---------- */
// Conta só o tempo com o jogo despausado: com o jogo pausado, as viagens param onde estão.
let pausedAcc = 0; let pausedAt = null;
export function syncPause() { const p = !!game.paused; if (p && pausedAt == null) pausedAt = Date.now(); else if (!p && pausedAt != null) { pausedAcc += Date.now() - pausedAt; pausedAt = null; } }
export const pnow = () => Date.now() - pausedAcc - (pausedAt != null ? Date.now() - pausedAt : 0);
/** Espera ms de jogo despausado (para antes se stop() der verdadeiro). */
export function waitPlay(ms, stop = null) {
  const end = pnow() + ms;
  return new Promise(res => { const tick = () => { if (stop?.() || pnow() >= end) return res(); setTimeout(tick, Math.min(250, Math.max(20, end - pnow()))); }; tick(); });
}
export async function addLog(entry) {
  const l = [{ id: uid(), t: game.time.worldTime, ...entry }, ...logOf()].slice(0, 200);
  await game.settings.set(MODULE_ID, "log", l);
}

/* ---------- pedidos dos jogadores ---------- */
const HANDLERS = {};
export function onAction(name, fn) { HANDLERS[name] = fn; }
/** Executa no Mestre ativo (direto, se for ele; senão pelo socket). */
export async function request(name, payload = {}) {
  if (isActiveGM()) return HANDLERS[name]?.(payload, game.user.id);
  if (!game.users.activeGM) { ui.notifications.warn("Atlas: nenhum Mestre conectado para registrar isso."); return; }
  game.socket.emit(SOCKET, { type: "action", name, payload, userId: game.user.id });
}
export function handleSocketAction(msg) { if (isActiveGM()) HANDLERS[msg.name]?.(msg.payload ?? {}, msg.userId); }

export function userColor(userId) {
  const u = game.users.get(userId); if (u?.color) return u.color?.css ?? String(u.color);
  return "#e08a2c";
}

/** Texto curto de uma página/entrada de diário (sem HTML). */
export async function journalExcerpt(uuid, max = 420) {
  if (!uuid) return "";
  try {
    const doc = await fromUuid(uuid); if (!doc) return "";
    let html = doc.text?.content ?? "";
    if (!html && doc.pages) { const pg = doc.pages.contents?.find?.(p => p.type === "text") ?? [...doc.pages].find(p => p.type === "text"); html = pg?.text?.content ?? ""; }
    const div = document.createElement("div"); div.innerHTML = html;
    const t = (div.textContent ?? "").replace(/\s+/g, " ").trim();
    return t.length > max ? t.slice(0, max).replace(/\s\S*$/, "") + "…" : t;
  } catch (e) { return ""; }
}

export const setting = (k, d) => { try { return game.settings.get(MODULE_ID, k) ?? d; } catch (e) { return d; } };
export const gesture = (k) => { try { return game.settings.get(MODULE_ID, k); } catch (e) { return k === "gesturePoint" ? "hold-left" : "hold-right"; } };
/** Ícones próprios enviados pelo mestre: [{ id, name, src }]. */
export const customIcons = () => { try { const l = game.settings.get(MODULE_ID, "icons"); return Array.isArray(l) ? l : []; } catch (e) { return []; } };
