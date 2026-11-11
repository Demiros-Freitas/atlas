// Conteúdo da aba "Atlas" na barra lateral (HTML) e o que cada botão e campo faz.
import { LABEL_STYLES, labelStyle } from "./config.js";
import { MODULE_ID, SOCKET, LEVELS, POI_KINDS, POI_CATS, catOf, POI_STATES, ROUTE_TYPES, ROUTE_CONDITIONS, PACES, MODES, zoneDefaultModes, ZONE_PRESETS, HOURS_PER_DAY, MOVER_KINDS, SHAPES, ICON_CHOICES, iconName, CLIMATES, BEAUFORT, DIRS16, LABEL_MODES, ROUTE_DASH, DASH_PATTERN, BRIDGE_STYLES, ROSE_CARD, CLOUD_MODES, NATURE_CATS, ZONE_WX } from "./config.js";
import { portalLinks } from "./data.js";
import { undoAtlas, undoCount, kmPerUnit, knownUnit, customIcons, dataOf, mapOf, normPoi, normRoute, normMover, normWeather, mainMover, zoneOf, scaleOf, chainOf, mapScenes, childrenOf, esc, notes, logOf, uiPref, setUiPref, mutateData, saveData, request, journalExcerpt, userColor } from "./data.js";
import { planTravel, executeTravel, fmtH, fmtDur, fmtUnits, bridgesOf } from "./travel.js";
import { WORLD_MODELS, EDGES, normWorld, skyTime, sunGlobe, fmtDeg, isWorld, greatCircle, lonLat } from "./world.js";
import { globeOf, routeLine, isGc } from "./wrap.js";
import { SKY_VIEWS, normSky, makeConsts, normBody, bodiesNow, phaseName, autoStarNames } from "./sky.js";
import { ic } from "./icons.js";
import { deleteSelection, finishRoute, snapMode, joinRoutes } from "./editor.js";
import { vecAction, regAction } from "./vector.js";
import { openBiz } from "./biz.js";
import { scanScene, runImport } from "./importer.js";
import { panelGrupo, groupAct, groupField, groupDrop, currentGroup, canDrive, groupsOf, selectGroup, STEPS } from "./groups.js";
import { transportIcon } from "./transport.js";
import { openRoseConfig } from "./roseconfig.js";
import { parentLink, poiSky } from "./wxfx.js";
import { regionContains, handleVecs, shapesOf } from "./geom.js";

const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(v) === String(cur ?? "") ? "selected" : ""}>${esc(label)}</option>`;
const seg = (act, list, cur) => `<div class="seg">${list.map(([v, l]) => `<button type="button" data-act="${act}" data-v="${esc(v)}" class="${String(v) === String(cur) ? "on" : ""}">${esc(l)}</button>`).join("")}</div>`;
const scenesAll = () => game.scenes?.contents ?? [...(game.scenes ?? [])];
const docName = (uuid) => { if (!uuid) return ""; try { return fromUuidSync(uuid)?.name ?? uuid; } catch (e) { return uuid; } };
const dirName = (deg) => DIRS16[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

/* ---------- viagem ---------- */
export function moverOf(ui) { return currentGroup(ui); }
export function quickTravel(ui, poiId) {
  const mv = moverOf(ui); if (!mv) return null;
  const key = `${poiId}|${mv.id}|${mv.x},${mv.y}|${ui.travel.pace}|${ui.scene.id}|${ui.dataRev ?? 0}`;
  ui.cache.qt ??= {}; if (key in ui.cache.qt) return ui.cache.qt[key];
  let r = null;
  try { const plan = planTravel(ui.scene, mv, poiId, { pace: ui.travel.pace, gm: ui.gmView }); if (plan) r = plan.here ? { here: true } : { units: plan.totalUnits, hours: plan.totalHours, u: plan.units, offroad: plan.warn.some(w => w.includes("linha reta")) }; } catch (e) { console.warn(e); }
  return (ui.cache.qt[key] = r);
}
export function travelText(ui, poiId) { const q = quickTravel(ui, poiId); if (!q) return ""; if (q.here) return "Vocês estão aqui"; return `${fmtUnits(q.units, q.u)} · ${fmtDur(q.hours)}${q.offroad ? " · fora de estrada" : ""}`; }

function clock() {
  const t = game.time.worldTime ?? 0;
  // com o Cronos: a data dele e a hora como os jogadores podem vê-la (exata ou "Manhã", "Crepúsculo"…)
  try { const cr = game.modules.get("brumas-cronos"); const api = cr?.active ? cr.api : null; if (api?.format && api?.publicTime) { const d = api.toDate(t); return `${d.day} de ${d.monthName} · ${api.publicTime(t)}`; } } catch (e) { /* */ }
  try { const c = game.time.components ?? game.time.calendar?.timeToComponents?.(t); if (c && c.hour != null) { const md = game.time.calendar?.months?.values?.[c.month]?.name; return `${md ? `${(c.dayOfMonth ?? c.day) + 1} de ${game.i18n?.localize?.(md) ?? md}` : `Dia ${(c.day ?? 0) + 1}`} · ${String(c.hour).padStart(2, "0")}:${String(c.minute ?? 0).padStart(2, "0")}`; } } catch (e) { /* */ }
  const d = Math.floor(t / 86400) + 1, h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60);
  return `Dia ${d} · ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/* ================= render ================= */
const TABS = [["mapa", "map", "Mapa"], ["pois", "pin", "Pontos"], ["rotas", "route", "Rotas"], ["grupo", "party", "Unidades"], ["natureza", "tree", "Natureza"], ["diario", "book", "Diário"]];
export const tabOf = (p) => ({ local: "pois", codice: "diario", editor: "mapa", import: "mapa", viagem: "grupo", clima: "natureza" })[p] ?? (TABS.some(t => t[0] === p) ? p : "mapa");
export function renderChrome(ui) {
  const sc = ui.scene; const m = mapOf(sc); const gm = game.user.isGM;
  if (!sc) return `<div class="atl">${header(ui, null, true)}<p class="muted pad">Nenhuma cena aberta.</p></div>`;
  const out = [header(ui, m)];
  if (!m) { out.push(`<div class="pbody">${gm ? panelConfig(ui) : ""}${mapsList(ui)}</div>`); return `<div class="atl">${out.join("")}</div>`; }
  const wxv = ui.wx;
  const tabs = TABS;
  const cur = tabOf(ui.panel);
  out.push(`<nav class="atl-tabs">${tabs.map(([k, i, l]) => `<button type="button" class="${cur === k ? "on" : ""}" data-act="panel" data-p="${k}" data-tooltip="${esc({ pois: "Pontos de interesse" }[k] ?? l)}">${ic(i, 15)}<span>${l}</span></button>`).join("")}</nav>`);
  const P = ui.panel === "import" ? panelImport : { mapa: panelMapa, pois: panelPois, rotas: panelRotas, grupo: panelGrupo, natureza: panelNatureza, diario: panelDiario }[cur];
  out.push(`<div class="pbody">${P(ui)}</div>`);
  if (gm) out.push(layersRow(ui)); // camadas no rodapé
  return `<div class="atl">${out.join("")}</div>`;
}

const docked = () => !!globalThis.ui?.atlas?.setOpen;
function header(ui, m, bare = false) {
  const undo = ""; // desfazer continua no Ctrl+Z (sem botão no painel)
  const popd = !!globalThis.ui?.atlas?.isPopped?.("body");
  const close = undo + (docked() ? `<button type="button" class="icon" data-act="popDock" data-v="body" data-tooltip="${popd ? "Trazer o painel de volta" : "Destacar o painel em outra janela"}" aria-label="Destacar"><i class="fa-solid ${popd ? "fa-arrow-down-left-and-arrow-up-right-to-center" : "fa-arrow-up-right-from-square"}" style="font-size:12px"></i></button>` : "") + (docked() ? `<button type="button" class="icon" data-act="dockClose" data-tooltip="Fechar o Atlas" aria-label="Fechar">${ic("close", 15)}</button>` : "");
  if (bare) return `<header class="atl-head"><div class="brand">${ic("map", 18)}<b>ATLAS</b><span class="grow"></span>${close}</div></header>`;
  const sc = ui.scene; const chain = m ? chainOf(sc) : []; const s = scaleOf(sc); const hex = (sc.grid?.type ?? 1) >= 2;
  const w = ui.wx; const showW = m && w.enabled && (game.user.isGM || w.players);
  const crumbs = chain.map((c, i) => `${i ? '<span class="sep">›</span>' : ""}${c.id === sc.id || !canSee(c) ? `<span class="crumb ${c.id === sc.id ? "cur" : ""}">${esc(mapOf(c)?.title || c.name)}</span>` : `<button type="button" class="crumb" data-act="goto" data-id="${c.id}">${esc(mapOf(c)?.title || c.name)}</button>`}`).join("");
  return `<header class="atl-head">
    <div class="brand">${ic("map", 18)}<b>ATLAS</b><span class="grow"></span>${game.user.isGM && m ? `<button type="button" class="icon ${ui.gmView ? "" : "on"}" data-act="gmView" data-tooltip="${ui.gmView ? "Vendo como mestre · clique para ver como jogador" : "Vendo como jogador · clique para voltar"}" aria-label="Alternar visão">${ic(ui.gmView ? "eye" : "eyeoff", 15)}</button>` : ""}
      ${game.user.isGM ? `<button type="button" class="icon ${ui.open ? "" : "on"}" data-act="toggleLayer" data-tooltip="${ui.open ? "Esconder o Atlas do mapa" : "Mostrar o Atlas no mapa"}" aria-label="Mostrar ou esconder">${ic(ui.open ? "layers" : "eyeoff", 15)}</button>` : ""}${close}</div>
    ${m ? `<nav class="crumbs" aria-label="Níveis">${crumbs}</nav>` : `<div class="crumbs"><span class="crumb cur">${esc(sc.name)}</span></div>`}
    <div class="chips">${m ? `<span class="chip">1 ${hex ? "hex" : "quadro"} = ${esc(s.dist)} ${esc(s.units)}</span>` : ""}<span class="chip">${ic("clock", 12)} ${esc(clock())}</span>
      ${showW ? `<button type="button" class="chip btnchip" data-act="panel" data-p="clima">${ic(CLIMATES[w.climate].icon, 12)} ${esc(CLIMATES[w.climate].label)} · ${ic("wind", 12)} ${esc(dirName(w.dir))} ${BEAUFORT[w.force][1]} km/h</button>` : ""}</div>
  </header>`;
}
function layersRow(ui) {
  const L = ui.layers; const list = [["fog", "eye", "Névoa"], ["pois", "pin", "Marcadores (locais)"], ["routes", "route", "Rotas"], ["labels", "text", "Rótulos"], ["zones", "zone", "Zonas"], ["notes", "note", "Notas"], ["rose", "compass", "Rosa dos ventos"], ["wxfx", "cloud", "Nuvens e chuva"]];
  if (isWorld(ui.data?.map)) list.splice(1, 0, ["grid", "grid", "Grade do mundo (linhas, trópicos e graus)"]);
  return `<div class="layers"><span>Camadas</span>${list.map(([k, i, l]) => `<button type="button" class="lyr ${L[k] ? "on" : ""}" data-act="layer" data-k="${k}" data-tooltip="${l}" aria-label="${l}" aria-pressed="${!!L[k]}">${ic(i, 14)}</button>`).join("")}</div>`;
}
/** O jogador só vê mapas que pode abrir. */
const canSee = (s) => game.user.isGM || s.id === canvas?.scene?.id || !!s.testUserPermission?.(game.user, "LIMITED");
function mapsList(ui) {
  const maps = mapScenes().filter(canSee); if (!maps.length) return game.user.isGM ? "" : `<p class="muted">Nenhum mapa liberado.</p>`;
  const ids = new Set(maps.map(s => s.id));
  const roots = maps.filter(s => !mapOf(s)?.parent || !ids.has(mapOf(s).parent));
  const item = (s, depth) => `<button type="button" class="lrow ${s.id === ui.scene?.id ? "here" : ""}" style="padding-left:${10 + depth * 16}px" data-act="goto" data-id="${s.id}" ${game.user.isGM && s.id !== ui.scene?.id ? `draggable="true" data-map-drag="${s.id}" data-tooltip="Clique: abrir · arraste até o mapa aberto: vira mapa filho dele, com marcador nesse lugar"` : ""}><span class="lvl">${esc(LEVELS[mapOf(s)?.level]?.label ?? "Mapa")}</span><span class="grow">${esc(mapOf(s)?.title || s.name)}</span></button>${childrenOf(s).filter(c => ids.has(c.id)).map(c => item(c, depth + 1)).join("")}`;
  return `<section><h3>Mapas</h3>${roots.map(s => item(s, 0)).join("")}</section>`;
}
const snapRow = () => { const snap = snapMode(); return `<div class="snaprow"><span>Grade</span>${[["livre", "free", "Livre"], ["centro", "snapc", "Centro"], ["cantos", "snapv", "Cantos"]].map(([k, i, l]) => `<button type="button" class="${snap === k ? "on" : ""}" data-act="snap" data-v="${k}" data-tooltip="${k === "livre" ? "Sem grade" : `Prende na grade (${l.toLowerCase()}). Segure Shift para soltar.`}">${ic(i, 13)} ${l}</button>`).join("")}</div>`; };
const search = (ph) => `<label class="search">${ic("search", 14)}<input type="text" data-live="q" placeholder="${esc(ph)}"></label>`;
const backBtn = (act, label) => `<button type="button" class="backlink" data-act="${act}">${ic("back", 14)} ${esc(label)}</button>`;

/* ----- mapa ----- */
function panelMapa(ui) {
  const d = ui.data; const gm = game.user.isGM; const movers = groupsOf(ui);
  const pois = d.pois.map(normPoi).filter(p => ui.gmView || p.state !== "oculto"); const known = pois.filter(p => p.state !== "rumor");
  const routes = d.routes.map(normRoute).filter(r => ui.gmView || !r.hidden); const ex = exploredPct(ui);
  // visão geral: o que há neste mapa e por onde ir
  const overview = `<div class="kv3 four"><div><b>${known.length}</b><small>pontos</small></div><div><b>${routes.length}</b><small>rotas</small></div><div><b>${movers.length}</b><small>unidades</small></div>${ex != null ? `<div><b>${ex}%</b><small>explorado</small></div>` : ""}</div>
    <section><div class="qhead"><span class="h3btn static"><span class="grow">Unidades neste mapa</span></span><button type="button" class="linkbtn" data-act="panel" data-p="grupo">ver todas</button></div>
      ${movers.length ? movers.map(mv => { const K = MOVER_KINDS[mv.kind]; const at = mv.at ? d.pois.find(p => p.id === mv.at)?.name : null; return `<button type="button" class="lrow" data-act="gOpen" data-id="${mv.id}"><span class="mvdot" style="--mc:${esc(mv.color || K.color)}">${mv.img ? `<img src="${esc(mv.img)}" alt="">` : ic(transportIcon(mv), 15)}</span><span class="grow">${esc(mv.name)}${mv.hidden ? " · oculto" : ""}${mv.vote ? " · votando destino" : ""}</span><small>${esc(at ?? (mv.plan ? "na estrada" : "no ermo"))}</small></button>`; }).join("") : `<p class="muted">${gm ? "Nenhuma unidade neste mapa. Crie na aba Unidades." : "Nenhuma unidade sua neste mapa."}</p>`}</section>
    ${mapsList(ui)}`;
  if (!gm) return overview;
  const warn = ui.scene.tokenVision ? `<div class="warnbox"><div class="warn1">${ic("warn", 14)}<span class="grow">A <b>visão dos tokens</b> do Foundry está ligada nesta cena: jogadores sem token aqui veem o mapa escuro (o Atlas usa a névoa própria).</span><button type="button" class="btn sm" data-act="visionOff">Desligar</button></div></div>` : "";
  const labels = d.labels ?? [];
  const labelsSec = `<section><h3>Rótulos · ${labels.length}</h3>
    ${ui.selLabel ? labelForm(ui) : `${ui.tool === "rotulo" ? `<div class="info">Clique no mapa para colocar o rótulo. Esc cancela.</div>` : `<button type="button" class="btn" data-act="tool" data-v="rotulo">${ic("plus", 14)} Novo rótulo</button>`}
      ${labels.map(l => `<button type="button" class="lrow" data-act="labelSel" data-id="${l.id}">${ic("text", 13)}<span class="grow">${esc(l.text)}</span>${l.locked ? ic("lock", 12) : ""}</button>`).join("")}`}</section>`;
  const tabs = [["geral", "Visão geral"], ...(d.map?.level === "mundo" ? [["mundo", "Mundo"]] : []), ...(d.map?.level === "ceu" || d.map?.level === "mundo" ? [["ceu", "Céu"]] : []), ["config", "Configurar"], ["visual", "Aparência"], ["nevoa", "Névoa"]];
  const t = ui.selLabel ? "visual" : tabs.some(([k]) => k === ui.mapTab) ? ui.mapTab : "geral";
  const sbar = d.map?.level && !["mundo", "ceu"].includes(d.map.level) ? `<section><h3>Barra do céu <span class="hint" data-tooltip="Uma faixa no alto da tela com o sol e as luas cruzando o céu, a cor do céu pela hora e as nuvens do clima deste mapa. Fica certa quando este mapa está ligado (pelos mapas pai) a um Mundo com mapa celeste.">?</span></h3>
      <label class="swrow"><span class="grow">Mostrar a barra do céu</span><input type="checkbox" class="switch" data-field="map" data-k="skybar.on" ${d.map?.skybar?.on ? "checked" : ""}></label>
      ${d.map?.skybar?.on ? `<label class="swrow"><span class="grow">Os jogadores também veem</span><input type="checkbox" class="switch" data-field="map" data-k="skybar.players" ${d.map?.skybar?.players ? "checked" : ""}></label>` : ""}</section>` : "";
  const body = t === "config" ? mapForm(ui) + sbar + `<section><h3>Trazer de cena antiga</h3><button type="button" class="btn" data-act="panel" data-p="import">${ic("import", 14)} Importar tokens e regiões desta cena</button></section>`
    : t === "visual" ? labelsSec + routeStyleSection(ui) + iconsSection()
    : t === "nevoa" ? fogSection(ui) : t === "mundo" ? worldForm(ui) : t === "ceu" ? skyForm(ui) : overview;
  return `${warn}<div class="subtabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" aria-selected="${t === k}" class="${t === k ? "on" : ""}" data-act="mapTab" data-v="${k}">${l}</button>`).join("")}</div><div class="poitab">${body}</div>`;
}

/** Mapa-múndi: modelo do mundo, calibração, grade e luz. */
function worldForm(ui) {
  const w = normWorld(ui.data.map?.world ?? {}); const f = (k) => `data-field="map" data-k="world.${k}"`; const M = w.model; const s = scaleOf(ui.scene);
  const num = (k, label, v, attrs = "", tip = "") => `<label>${label}${tip ? ` <span class="hint" data-tooltip="${esc(tip)}">?</span>` : ""}<input type="number" ${f(k)} value="${esc(String(v))}" ${attrs}></label>`;
  const chk = (k, label, v, tip = "") => `<label class="swrow" ${tip ? `data-tooltip="${esc(tip)}"` : ""}><span class="grow">${label}</span><input type="checkbox" class="switch" ${f(k)} ${v ? "checked" : ""}></label>`;
  const edgeSel = (k, cur) => `<label>Borda do mundo<select ${f(k)}>${Object.entries(EDGES).map(([kk, v]) => opt(kk, v, cur)).join("")}</select></label>`;
  let model = "";
  if (M === "globo" || M === "oco") model = `<div class="grid2">${num("globo.lonW", "Longitude da borda oeste", w.globo.lonW, `step="1" min="-360" max="360"`)}${num("globo.lonE", "Longitude da borda leste", w.globo.lonE, `step="1" min="-360" max="360"`)}</div>
      <div class="grid2">${num("globo.latN", "Latitude do topo", w.globo.latN, `step="1" min="-90" max="90"`)}${num("globo.latS", "Latitude da base", w.globo.latS, `step="1" min="-90" max="90"`)}</div>
      <small class="muted">Planeta inteiro: −180 a 180 e 90 a −90 (imagem 2:1). Só um continente: as coordenadas das bordas dele.</small>
      <div class="grid2">${M === "globo" ? num("globo.tilt", "Inclinação do eixo (°)", w.globo.tilt, `step="0.1" min="0" max="89"`, "Define os trópicos e os círculos polares e o tamanho das estações. Terra: 23,4°. Mais inclinado = estações mais extremas.") : ""}${num("globo.radius", `Raio do planeta (${esc(s.units)})`, w.globo.radius, `step="1" min="1"`, "Usado para medir distâncias pela curvatura. Terra: 3.959 mi ou 6.371 km.")}</div>`;
  else if (M === "disco") model = `<div class="grid3">${num("disco.cx", "Centro X (%)", w.disco.cx, `step="0.5"`)}${num("disco.cy", "Centro Y (%)", w.disco.cy, `step="0.5"`)}${num("disco.r", "Raio (%)", w.disco.r, `step="0.5"`, "50% = o disco encosta na borda menor do mapa.")}</div>
      <div class="grid2">${num("disco.rings", "Anéis da grade", w.disco.rings, `step="1" min="1" max="24"`)}${num("disco.spokes", "Raios da grade", w.disco.spokes, `step="1" min="0" max="72"`)}</div>
      <div class="grid3">${num("disco.sunIn", "Sol de verão (%)", w.disco.sunIn, `step="1" min="1" max="99"`, "Anel por onde o sol passa no verão do norte (mais perto do centro).")}${num("disco.sunOut", "Sol de inverno (%)", w.disco.sunOut, `step="1" min="1" max="100"`)}${num("disco.light", "Alcance da luz (%)", w.disco.light, `step="1" min="5" max="200"`, "Raio do holofote do sol, em % do raio do disco.")}</div>
      <div class="grid2">${edgeSel("disco.edge", w.disco.edge)}${num("disco.north", "Norte (°)", w.disco.north, `step="1"`, "Para onde fica o norte (o centro, no modelo clássico) — gira os pontos cardeais e o caminho do sol.")}</div>`;
  else model = `<div class="grid2">${num("plano.cell", `Quadrícula (${esc(s.units)})`, w.plano.cell || "", `step="1" min="0" placeholder="automático"`, "Tamanho de cada quadrado da grade do atlas (A1, B2…).")}${edgeSel("plano.edge", w.plano.edge)}</div>${chk("plano.letters", "Colunas com letras (A, B, C…)", w.plano.letters)}`;
  let now = "";
  if (w.luz.on && M === "globo") { const S = sunGlobe(w); now = `<small class="muted">Agora: meio-dia em ${esc(fmtDeg(S.lon, "L", "O"))}; sol a pino em ${esc(fmtDeg(S.decl, "N", "S"))} (${Math.abs(S.decl) < 2 ? "perto do equinócio" : S.decl > 0 ? "verão no norte" : "verão no sul"}).</small>`; }
  else if (w.luz.on) { const T = skyTime(); const h = T.dayFrac * 24; now = `<small class="muted">Agora: ${String(Math.floor(h)).padStart(2, "0")}h${String(Math.floor((h % 1) * 60)).padStart(2, "0")} · ${Math.round(T.yearFrac * 100)}% do ano.</small>`; }
  return `<section><h3>Modelo do mundo</h3>
      <div class="seg wrap">${Object.entries(WORLD_MODELS).map(([k, v]) => `<button type="button" class="${M === k ? "on" : ""}" data-act="worldModel" data-v="${k}" data-tooltip="${esc(v.hint)}">${esc(v.label)}</button>`).join("")}</div>
      <small class="muted">${esc(WORLD_MODELS[M].hint)}</small>${model}</section>
    <section><h3>Grade</h3>
      ${chk("grid.on", "Mostrar a grade", w.grid.on)}
      ${w.grid.on ? `${M === "globo" || M === "oco" ? num("grid.step", "Linhas a cada (°)", w.grid.step, `step="1" min="1" max="90"`) : ""}
      <label>Cor das linhas<input type="color" class="colorpick" ${f("grid.color")} value="${esc(w.grid.color)}"></label>
      ${[["grid.opacity", "Grade", w.grid.opacity], ["grid.spOpacity", M === "globo" ? "Equador, trópicos e círculos polares" : "Linhas especiais", w.grid.spOpacity], ["grid.labOpacity", "Nomes e números", w.grid.labOpacity]].map(([k, l, v]) => `<label class="wop">${l} <span class="rv">${Math.round(v * 100)}%</span><input type="range" min="0" max="1" step="0.05" ${f(k)} value="${v}"></label>`).join("")}
      ${chk("grid.special", M === "globo" ? "Equador, trópicos e círculos polares" : M === "disco" ? "Caminhos do sol e a Borda" : "Borda do mundo", w.grid.special)}
      ${chk("grid.labels", "Graus e nomes nas bordas", w.grid.labels)}${chk("grid.cardinals", "Pontos cardeais", w.grid.cardinals)}` : ""}
      ${chk("readout", "Mostrar a posição junto do cursor", w.readout)}
      ${M === "globo" && w.grid.special ? `<details class="wnames"><summary>Nomes das linhas</summary><div class="grid2">${[["eq", "Equador"], ["tropN", "Trópico norte"], ["tropS", "Trópico sul"], ["polN", "Círculo polar norte"], ["polS", "Círculo polar sul"]].map(([k, l]) => `<label>${l}<input type="text" ${f(`names.${k}`)} value="${esc(w.names[k])}"></label>`).join("")}</div></details>` : ""}</section>
    <section><h3>Luz e atmosfera</h3>
      ${M === "oco" ? `<small class="muted">No mundo oco o sol fica fixo no centro: não há noite.</small>` : chk("luz.on", "Dia e noite pelo relógio do mundo", w.luz.on, "A hora do dia e a época do ano vêm do relógio do Foundry.")}
      ${w.luz.on && M !== "oco" ? `${num("luz.dark", "Escuridão da noite", w.luz.dark, `step="0.05" min="0.05" max="0.95"`)}
      <div class="grid2">${M === "globo" ? num("luz.noonLon", "Meio-dia à 0h em (°)", w.luz.noonLon, `step="1"`, "Longitude onde é meio-dia quando o relógio marca 12h.") : ""}${num("luz.equinox", "Equinócio de primavera (% do ano)", w.luz.equinox, `step="1" min="0" max="100"`, "Em que parte do ano começa a primavera do norte. 22% ≈ 20 de março.")}</div>
      ${chk("luz.sun", "Mostrar o sol no mapa", w.luz.sun)}${now}` : ""}
      ${chk("luz.atmos", "Halo de atmosfera nas bordas", w.luz.atmos)}
      ${chk("luz.moons", "Mostrar as luas no mapa", w.luz.moons, "As luas do mapa celeste deste mundo aparecem onde estão a pino (globo e disco) ou num quadro no canto (outros modelos), com a fase de agora.")}
      <small class="muted">${M === "globo" ? "Arraste um trópico ou círculo polar para mudar a inclinação do eixo (os outros acompanham). Clique duplo numa linha ou no nome dela para renomear." : M === "disco" ? "Arraste os caminhos do sol ou a borda do disco. Clique duplo numa linha ou no nome dela para renomear." : ""}</small></section>`;
}

/** Mapa celeste: vista, semente, o que mostrar, astros e constelações. */
/** De onde o relógio (Cronos), o céu, o clima e as estações são vistos neste mundo. */
function hereSection(ui) {
  const api = game.modules.get(MODULE_ID)?.api; const P = api?.herePlaces?.(ui.scene); if (!P) return ""; const h = api?.here?.(ui.scene);
  const groups = {}; for (const o of P.list) (groups[o.group ?? ""] ??= []).push(o);
  const opts = Object.entries(groups).map(([g, l]) => { const o = l.map(x => `<option value="${esc(x.v)}" ${x.v === P.cur ? "selected" : ""}>${esc(x.label)}</option>`).join(""); return g ? `<optgroup label="${esc(g)}">${o}</optgroup>` : o; }).join("");
  const lat = Number.isFinite(h?.lat) ? ` · ${fmtDeg(h.lat, "N", "S")}` : "";
  return `<section><h3>Relógio visto de <span class="hint" data-tooltip="O mostrador e a faixa do Cronos, o clima, as estações do calendário e o céu aberto mostram este lugar, para todos.">?</span></h3>
    <select data-field="map" data-k="here">${opts}</select>
    ${h ? `<small class="muted">Agora: <b>${esc(h.label)}</b>${h.unit && h.unit !== h.label ? ` (${esc(h.unit)})` : ""}${lat}${P.cur === "auto" && h.src !== "auto" ? " · nenhuma unidade com personagens de jogadores; usando o mapa aberto" : ""}</small>` : ""}</section>`;
}
function skyForm(ui) {
  if (!ui.data.map?.sky) return hereSection(ui) + `<section><h3>Céu deste mundo</h3><p class="muted">Estrelas, constelações, luas e planetas andando pelo relógio. O céu abre por cima de qualquer cena (botão da lua na barra lateral, ou o mostrador do Cronos), visto do lugar onde o grupo está.</p>
    <button type="button" class="btn gold" data-act="skyCreate">${ic("star", 14)} Criar o céu deste mundo</button></section>`;
  const sk = normSky(ui.data.map?.sky ?? {}); const f = (k) => `data-field="map" data-k="sky.${k}"`;
  const chk = (k, label, v) => `<label class="swrow"><span class="grow">${label}</span><input type="checkbox" class="switch" ${f(k)} ${v ? "checked" : ""}></label>`;
  const consts = sk.consts ?? []; const B = bodiesNow(sk);
  const bf = (b, k) => `data-field="skyBody" data-id="${esc(b.id)}" data-k="${k}"`;
  const wdS = normWorld(ui.data.map?.world ?? {}); const globe = ui.data.map?.level === "mundo" && (wdS.model === "globo" || wdS.model === "oco");
  return hereSection(ui) + `<section><div class="actions row"><button type="button" class="btn gold grow" data-act="skyOpen">${ic("star", 14)} Abrir o céu</button></div>${chk("players", "Os jogadores podem abrir o céu", sk.players)}${sk.players ? `<div class="skpv"><small class="muted">O que eles podem ver:</small>${chk("pview.carta", "Carta estelar", sk.pview.carta)}${chk("pview.noite", "Céu de hoje", sk.pview.noite)}${chk("pview.sistema", "Sistema (órbitas)", sk.pview.sistema)}</div>` : ""}<small class="muted">Para colocar, arrastar, apagar e ligar estrelas: Abrir o céu › Carta estelar › ✎ Estrelas.</small></section><section><h3>Vista inicial</h3><div class="seg">${Object.entries(SKY_VIEWS).map(([k, v]) => `<button type="button" class="${sk.view === k ? "on" : ""}" data-act="skyView" data-v="${k}">${esc(v)}</button>`).join("")}</div>
      ${sk.view === "noite" ? `<label>Latitude de quem olha (°) <span class="hint" data-tooltip="De onde o céu é visto. Muda quais estrelas sobem acima do horizonte.">?</span><input type="number" step="1" min="-90" max="90" ${f("lat")} value="${sk.lat}"></label>` : ""}
      <small class="muted">${sk.view === "carta" ? "O céu inteiro: ascensão reta (horas) e declinação (graus)." : sk.view === "noite" ? "A cúpula vista do chão agora: zênite no centro, horizonte na borda, leste à esquerda. De dia as estrelas somem." : "O sol no centro, as órbitas dos planetas e as luas em volta do seu mundo."}</small></section>
    <section><h3>Estrelas</h3><div class="grid2"><label>Semente<input type="number" step="1" ${f("seed")} value="${sk.seed}"></label><label>Quantidade<input type="number" step="100" min="200" max="6000" ${f("stars")} value="${sk.stars}"></label></div>
      <div class="actions row"><button type="button" class="btn grow" data-act="skyNew">${ic("star", 13)} Gerar outro céu</button></div>
      <div class="grid2">${globe ? `<label>Inclinação do eixo (°) <span class="hint" data-tooltip="A mesma do planeta: mude em Mapa › Mundo ou arrastando os trópicos no mapa.">?</span><input type="number" step="0.1" min="0" max="89" data-field="map" data-k="world.globo.tilt" value="${wdS.globo.tilt}"></label>` : `<label>Inclinação do eixo (°) <span class="hint" data-tooltip="Inclinação da eclíptica (o caminho do sol). Use a mesma do mundo.">?</span><input type="number" step="0.1" min="0" max="89" ${f("tilt")} value="${sk.tilt}"></label>`}<label>Equinócio (% do ano)<input type="number" step="1" min="0" max="100" ${f("equinox")} value="${sk.equinox}"></label></div></section>
    <section><h3>Mostrar</h3>${chk("show.grid", "Grade (horas e graus)", sk.show.grid)}${chk("show.ecl", "Eclíptica (caminho do sol)", sk.show.ecl)}${chk("show.via", "Faixa da galáxia", sk.show.via)}${chk("show.lines", "Linhas das constelações", sk.show.lines)}${chk("show.names", "Nomes das constelações", sk.show.names)}${chk("show.starNames", "Nomes das estrelas", sk.show.starNames)}${chk("show.bodies", "Sol, luas e planetas", sk.show.bodies)}</section>
    <section><h3>Luas e planetas</h3>${sk.bodies.map(b => { const now = B.list.find(x => x.id === b.id);
      return `<div class="skbody"><div class="sb1"><input type="color" class="colorpick" ${bf(b, "color")} value="${esc(b.color)}"><input type="text" class="grow" ${bf(b, "name")} value="${esc(b.name)}"><select ${bf(b, "kind")}>${opt("lua", "Lua", b.kind)}${opt("planeta", "Planeta", b.kind)}</select><button type="button" class="icon" data-act="skyBodyDel" data-id="${esc(b.id)}" aria-label="Tirar">${ic("close", 12)}</button></div>
        <div class="sb2"><label>Período (dias)<input type="number" step="0.1" min="0.1" ${bf(b, "period")} value="${b.period}"></label>${b.kind === "planeta" ? `<label>Distância do sol (UA)<input type="number" step="0.01" min="0.05" ${bf(b, "dist")} value="${b.dist}"></label>` : `<label>Agora<input type="text" value="${esc(now ? phaseName(now) : "")}" disabled></label>`}</div></div>`; }).join("")}
      <div class="actions row"><button type="button" class="btn" data-act="skyBodyAdd" data-v="lua">${ic("plus", 13)} Lua</button><button type="button" class="btn" data-act="skyBodyAdd" data-v="planeta">${ic("plus", 13)} Planeta</button></div></section>
    <section><h3>Estrelas com nome · ${sk.names.length}</h3><small class="muted">Na carta estelar, com ✎ Estrelas ligado: clique duplo numa estrela para dar, mudar ou tirar o nome.</small>
      <div class="skstarn">${sk.names.slice(0, 60).map(n => `<span>${esc(n[1])}</span>`).join("")}</div>
      <div class="actions row"><button type="button" class="btn" data-act="skyNames">${ic("star", 13)} Dar nome às mais brilhantes</button>${sk.names.length ? `<button type="button" class="btn" data-act="skyNamesClear">Tirar todos</button>` : ""}</div></section>
    <section><h3>Constelações · ${consts.length}</h3><div class="grid2">${consts.map((c, i) => `<input type="text" data-field="skyConst" data-i="${i}" value="${esc(c.name)}">`).join("")}</div>
      <div class="actions row"><button type="button" class="btn" data-act="skyConsts">Gerar as constelações de novo</button></div></section>`;
}

/** Ícones próprios do mestre (usados em pontos e grupos). */
export const iconId = (c) => `${c.mode === "pic" ? "pic" : "img"}:${c.src}`;
function iconsSection() {
  const list = customIcons();
  return `<section><h3>Ícones próprios · ${list.length} <span class="hint" data-tooltip="PNG, WebP ou SVG com fundo transparente. “Colorido” usa só a silhueta e pinta com a cor do marcador; “cores originais” mostra a imagem como ela é.">?</span></h3>
    <div class="myicons">${list.map(c => `<div class="myicon">${ic(iconId(c), 30)}<small title="${esc(c.name)}">${esc(c.name)}</small>
      <button type="button" class="mode" data-act="iconMode" data-id="${c.id}" data-tooltip="${c.mode === "pic" ? "Cores originais da imagem · clique para colorir como os outros ícones" : "Colorido pela cor do marcador · clique para usar as cores originais"}">${c.mode === "pic" ? "cores originais" : "colorido"}</button>
      <button type="button" class="icon" data-act="iconDel" data-id="${c.id}" aria-label="Remover">${ic("close", 11)}</button></div>`).join("")}</div>
    <button type="button" class="btn" data-act="iconAdd">${ic("plus", 14)} Adicionar ícone (enviar ou escolher imagem)</button>
</section>`;
}
/* ----- pontos de interesse ----- */
const poiGroups = [["Cidades e vilas", (p) => ["capital", "cidade", "vila"].includes(p.kind)], ["Assentamentos", (p) => ["vigia", "fazenda", "acamp", "porto", "apiario", "farol", "estaleiro", "algodoal", "cabana", "aldeia", "capela", "cemiterio"].includes(p.kind)], ["Natureza", (p) => p.kind === "natural"], ["Lugares", (p) => !["capital", "cidade", "vila", "distrito", "vigia", "fazenda", "acamp", "porto", "natural", "apiario", "farol", "estaleiro", "algodoal", "cabana", "aldeia", "capela", "cemiterio"].includes(p.kind)], ["Distritos", (p) => p.kind === "distrito"]];
function panelPois(ui) {
  const gm = ui.gmView; const isGM = game.user.isGM; const mv = moverOf(ui);
  const p0 = ui.sel ? ui.data.pois.find(x => x.id === ui.sel) : null;
  if (p0 && (gm || normPoi(p0).state !== "oculto")) {
    const top = `<div class="rowhead">${backBtn("poiBack", "Todos os pontos")}${isGM ? `<span class="grow"></span><div class="seg mini"><button type="button" class="${ui.poiEdit ? "" : "on"}" data-act="poiMode" data-v="0">Ver</button><button type="button" class="${ui.poiEdit ? "on" : ""}" data-act="poiMode" data-v="1">${ic("edit", 12)} Editar</button></div>` : ""}</div>`;
    return top + (isGM && ui.poiEdit ? poiForm(ui) : panelLocal(ui));
  }
  const pois = ui.data.pois.map(normPoi).filter(p => gm || p.state !== "oculto");
  let out = "";
  if (isGM && ui.tool === "portal") out += `<section class="addbox"><h3>${ic("portal", 14)} Ligar portais</h3><div class="info">Clique num portal e depois nos outros: cada clique liga ao primeiro com uma linha reta. Com Shift, liga ao último e segue dele (corrente). Clique no vazio cria um portal ali. Esc solta.</div><button type="button" class="btn" data-act="tool" data-v="sel">Pronto</button></section>`;
  else if (isGM && tpOn() && ui.tool !== "local") out += `<div class="actions row"><button type="button" class="btn grow" data-act="tool" data-v="portal">${ic("portal", 14)} Ligar portais</button></div>`;
  if (isGM) out += ui.tool === "local"
    ? `<section class="addbox"><h3>Novo ponto de interesse</h3><div class="info">Clique no mapa onde ele fica. Esc cancela.</div>
      ${kindPick(ui.newPoi.kind, `data-field="newPoi" data-k="kind"`, "newPoiCat")}
      <div class="grid2"><label>Estado<select data-field="newPoi" data-k="state">${Object.entries(POI_STATES).map(([k, v]) => opt(k, v.label, ui.newPoi.state)).join("")}</select></label></div>
      <label class="check"><input type="checkbox" data-field="newPoi" data-k="locked" ${ui.newPoi.locked ? "checked" : ""}> ${ic("lock", 13)} Já criar fixo (travado)</label>${snapRow()}
      <button type="button" class="btn" data-act="tool" data-v="sel">Cancelar</button></section>`
    : `<div class="actions row"><button type="button" class="btn gold grow" data-act="tool" data-v="local">${ic("plus", 14)} Adicionar ponto</button></div>`;
  out += search("Procurar ponto…");
  // filtro por estado (o que o grupo já conhece, o que só se ouviu falar…)
  const ST = [["todos", "Todos"], ["visitado", "Visitados"], ["avistado", "Avistados"], ["rumor", "Rumores"], ...(gm ? [["oculto", "Ocultos"]] : [])];
  const fl = ST.some(([k]) => k === ui.poiFilter) ? ui.poiFilter : "todos"; const cnt = (k) => k === "todos" ? pois.length : pois.filter(p => p.state === k).length;
  out += `<div class="fchips">${ST.filter(([k]) => k === "todos" || cnt(k)).map(([k, l]) => `<button type="button" class="fchip ${fl === k ? "on" : ""}" data-act="poiFilter" data-v="${k}">${esc(l)} <em>${cnt(k)}</em></button>`).join("")}</div>`;
  const passF = (p) => fl === "todos" || p.state === fl; const closed = ui.poiClosed ?? {};
  const shown = (p) => p.state === "rumor" && !gm ? (p.rumorText || "Local desconhecido") : p.name;
  const row = (p) => `<button type="button" class="lrow s-${p.state} ${mv?.at === p.id ? "here" : ""}" data-act="focus" data-id="${p.id}" data-q="${esc(shown(p).toLowerCase())}"><span class="mk k-${p.kind}" ${p.color ? `style="color:${p.color}"` : ""}>${p.state === "rumor" && !gm ? "?" : ic(p.icon, 12)}</span><span class="grow">${esc(shown(p))}</span>${isGM && p.locked ? ic("lock", 11) : ""}<small>${mv?.at === p.id ? "Vocês estão aqui" : esc(POI_STATES[p.state].label)}</small></button>`;
  const sorted = (l) => l.sort((a, b) => POI_STATES[b.state].order - POI_STATES[a.state].order || shown(a).localeCompare(shown(b)));
  const sec = (g, l) => l.length ? `<section class="qsec"><button type="button" class="h3btn" data-act="poiGroup" data-v="${esc(g)}"><span class="grow">${esc(g)} · ${l.length}</span><span class="car">${closed[g] ? "▸" : "▾"}</span></button>${closed[g] ? "" : l.map(row).join("")}</section>` : "";
  const body = poiGroups.map(([g, f]) => sec(g, sorted(pois.filter(f).filter(p => p.state !== "rumor" && passF(p))))).join("");
  const rum = pois.filter(p => p.state === "rumor" && passF(p));
  out += body + sec("Rumores", rum);
  if (!pois.length) out += `<p class="muted">${isGM ? "Nenhum ponto neste mapa ainda." : "Nenhum lugar conhecido ainda."}</p>`;
  return out;
}

/* ----- rotas ----- */
function routeTitle(ui, r) { const nm = (id) => ui.data.pois.find(p => p.id === id)?.name; return r.name || `${ROUTE_TYPES[r.type].label}${nm(r.a) || nm(r.b) ? `: ${nm(r.a) ?? "bifurcação"} → ${nm(r.b) ?? "bifurcação"}` : ""}`; }
function routeLen(ui, r) { const sc = scaleOf(ui.scene); let len = 0;
  const G = globeOf(ui.scene); if (G) { const P = routeLine(normRoute(r), G); for (let i = 1; i < P.length; i++) len += greatCircle(G.g, lonLat(G.R, G.g, P[i - 1][0], P[i - 1][1]), lonLat(G.R, G.g, P[i][0], P[i][1])); return fmtUnits(len, sc.units); } /* no globo: distância de verdade sobre a esfera */
  for (let i = 1; i < r.points.length; i++) len += Math.hypot(r.points[i][0] - r.points[i - 1][0], r.points[i][1] - r.points[i - 1][1]); return fmtUnits(len * sc.perPx, sc.units); }
function panelRotas(ui) {
  const isGM = game.user.isGM; const gm = ui.gmView;
  const routes = ui.data.routes.map(normRoute).filter(r => (gm || !r.hidden) && (r.type !== "portal" || r.id === ui.selRoute)); // ligações de portais: ficam no cartão do portal
  const sel = ui.selRoute ? routes.find(r => r.id === ui.selRoute) : null;
  if (sel) {
    if (isGM) return `<div class="rowhead">${backBtn("routeBack", "Todas as rotas")}</div>${routeForm(ui)}`;
    const t = ROUTE_TYPES[sel.type];
    return `<div class="rowhead">${backBtn("routeBack", "Todas as rotas")}</div><section><h3>${esc(t.label)}</h3><p class="big">${esc(routeTitle(ui, sel))}</p>
      <div class="kv3"><div><b>${esc(routeLen(ui, sel))}</b><small>comprimento</small></div><div><b>${esc(ROUTE_CONDITIONS[sel.cond]?.label ?? sel.cond)}</b><small>condição</small></div><div><b>×${(sel.mult ?? t.mult).toFixed(2)}</b><small>velocidade</small></div></div></section>`;
  }
  let out = "";
  if (isGM) out += ui.tool === "rota"
    ? `<section class="addbox"><h3>Nova rota</h3><label>Tipo<select data-field="newRouteTypeSel">${Object.entries(ROUTE_TYPES).filter(([k]) => k !== "portal").map(([k, v]) => opt(k, v.label, ui.newRouteType ?? "estrada")).join("")}</select></label>
      <div class="tset"><span class="lab">Traço <span class="hint" data-tooltip="${(ui.routeMode ?? "curva") === "circulo" ? "Clique no centro e depois na borda: cria um anel fechado." : "Esquerdo põe um ponto, direito apaga o último. Encostar noutra rota só gruda o ponto nela (cruzamento). Começar na ponta de uma rota continua aquela rota. Shift trava em 15°. Clicar num local, duplo clique ou Enter termina."}">?</span></span>${seg("drawMode", [["curva", "Curva"], ["reta", "Reta"], ["circulo", "Círculo"]], ui.routeMode ?? "curva")}</div>${snapRow()}
      <div class="actions row">${ui.drawing ? `<button type="button" class="btn gold grow" data-act="finishRoute">Terminar (${ui.drawing.points.length} pontos)</button>` : ""}<button type="button" class="btn" data-act="cancelRoute">${ui.drawing ? "Cancelar" : "Fechar"}</button></div></section>`
    : `<div class="actions row"><button type="button" class="btn gold grow" data-act="tool" data-v="rota">${ic("plus", 14)} Nova rota</button><button type="button" class="btn ${ui.tool === "vrota" ? "on" : ""}" data-act="tool" data-v="${ui.tool === "vrota" ? "sel" : "vrota"}" data-tooltip="Nós, curvas e retas, formas, agrupar e combinar (barra no alto da tela)">${ui.tool === "vrota" ? "Sair da edição avançada" : "Edição avançada"}</button></div>`;
  const mr = (ui.multi ?? []).filter(x => x.kind === "routes");
  if (isGM && ui.tool === "vrota") out += vecNodeBox(ui);
  if (isGM && mr.length) out += multiRouteForm(ui, mr.map(x => x.id));
  out += search("Procurar rota…");
  const present = Object.entries(ROUTE_TYPES).filter(([k]) => routes.some(r => r.type === k));
  const fl = ui.routeFilter && (ui.routeFilter === "bloqueada" || present.some(([k]) => k === ui.routeFilter)) ? ui.routeFilter : "todos";
  const nBlk = routes.filter(r => r.cond === "bloqueada").length;
  if (routes.length) out += `<div class="fchips"><button type="button" class="fchip ${fl === "todos" ? "on" : ""}" data-act="routeFilter" data-v="todos">Todas <em>${routes.length}</em></button>${present.map(([k, t]) => `<button type="button" class="fchip ${fl === k ? "on" : ""}" data-act="routeFilter" data-v="${k}">${esc(t.label)} <em>${routes.filter(r => r.type === k).length}</em></button>`).join("")}${nBlk ? `<button type="button" class="fchip ${fl === "bloqueada" ? "on" : ""}" data-act="routeFilter" data-v="bloqueada">Bloqueadas <em>${nBlk}</em></button>` : ""}</div>`;
  const passR = (r) => fl === "todos" || (fl === "bloqueada" ? r.cond === "bloqueada" : r.type === fl); const rclosed = ui.routeClosed ?? {};
  const row = (r) => { const t = ROUTE_TYPES[r.type]; return `<button type="button" class="lrow ${ui.inMulti?.("routes", r.id) ? "on" : ""}" data-act="routeSel" data-id="${r.id}" data-q="${esc(routeTitle(ui, r).toLowerCase())}"><span class="rsw" style="--rc:${esc(r.color || t.color)};--rd:${esc(DASH_PATTERN[r.dash] ?? (t.dash === "none" ? "none" : t.dash))}"><svg width="26" height="8"><line x1="1" y1="4" x2="25" y2="4"/></svg></span><span class="grow">${esc(routeTitle(ui, r))}</span>${r.cond === "bloqueada" ? `<small class="bad">bloqueada</small>` : ""}${isGM && r.hidden ? ic("eyeoff", 12) : ""}${isGM && r.locked ? ic("lock", 11) : ""}<small>${esc(routeLen(ui, r))}</small></button>`; };
  // grupos de rotas: uma linha que abre, com nome
  const gnames = ui.data.map?.routeGroups ?? {}; const groups = {}; for (const r of routes) if (r.group) (groups[r.group] ??= []).push(r);
  const gids = Object.keys(groups);
  if (gids.length) out += `<section class="qsec"><h3>Grupos · ${gids.length}</h3>${gids.map(g => { const l = groups[g]; const open = ui.rgOpen?.has?.(g); const nm = gnames[g]?.name ?? ""; const on = l.every(r => ui.inMulti?.("routes", r.id));
    return `<div class="rgrp ${open ? "open" : ""} ${on ? "on" : ""}" data-q="${esc((nm || "grupo").toLowerCase())} ${esc(l.map(r => routeTitle(ui, r).toLowerCase()).join(" "))}"><div class="rgh"><button type="button" class="icon" data-act="rgOpen" data-g="${g}" aria-label="Abrir">${ic(open ? "back" : "plus", 12)}</button>
      ${isGM ? `<input type="text" class="rgname" data-field="rgName" data-g="${g}" value="${esc(nm)}" placeholder="Grupo sem nome">` : `<b class="grow">${esc(nm || "Grupo")}</b>`}<small>${l.length} rota(s)${l.some(r => r.combined) ? " · combinadas" : ""}</small>
      ${isGM ? `<button type="button" class="icon" data-act="rgSel" data-g="${g}" data-tooltip="Selecionar o grupo" aria-label="Selecionar">${ic("check", 12)}</button>` : ""}</div>${open ? `<div class="rgl">${l.map(row).join("")}</div>` : ""}</div>`; }).join("")}</section>`;
  out += Object.entries(ROUTE_TYPES).map(([k, t]) => { const l = routes.filter(r => r.type === k && !r.group && passR(r)); if (!l.length) return "";
    return `<section class="qsec"><div class="qhead"><button type="button" class="h3btn" data-act="routeGroupT" data-v="${k}"><span class="grow">${esc(t.label)} · ${l.length}</span><span class="car">${rclosed[k] ? "▸" : "▾"}</span></button>${isGM ? `<button type="button" class="linkbtn" data-act="routeSelType" data-v="${k}" data-tooltip="Seleciona todas deste tipo (Ctrl+clique numa linha soma ou tira uma)">selecionar</button>` : ""}</div>${rclosed[k] ? "" : l.map(row).join("")}</section>`; }).join("");
  if (!routes.length) out += `<p class="muted">${isGM ? "Nenhuma rota neste mapa ainda." : "Nenhuma rota conhecida."}</p>`;
  return out;
}

/* ----- natureza: clima, fauna, flora e ameaças (por Região ou do mapa inteiro) ----- */
const regionsOf = (sc) => sc?.regions?.contents ?? [...(sc?.regions ?? [])];
export const MAPWIDE = "__map";
export const natureOf = (r, ui = null) => { const n = (r === MAPWIDE ? ui?.data?.map?.nature : r?.flags?.[MODULE_ID]?.nature) ?? {}; return { fauna: n.fauna ?? [], flora: n.flora ?? [], ameacas: n.ameacas ?? [] }; };
/** Grava a lista de uma categoria numa Região ou no mapa inteiro. */
export async function setNature(ui, rid, cat, list) {
  if (rid === MAPWIDE) return saveData(ui.scene, { [`map.nature.${cat}`]: list });
  const r = ui.scene.regions.get(rid); return r?.update({ [`flags.${MODULE_ID}.nature.${cat}`]: list });
}
function regionsHere(ui) { const m = moverOf(ui); if (!m) return []; return regionsOf(ui.scene).filter(r => regionContains(r, m.x, m.y)); }
/**
 * Natureza: duas abas.
 *  - Clima: o tempo deste mapa.
 *  - Lugares: o mapa inteiro e cada Região. Abrindo um lugar: Fauna · Flora · Ameaças e (mestre) Terreno,
 *    que junta o que antes ficava separado em "Terreno" e "Regiões".
 */
function panelNatureza(ui) {
  const isGM = game.user.isGM; const gm = ui.gmView; const w = ui.wx;
  const showWx = isGM || (w.enabled && w.players);
  const all = regionsOf(ui.scene); const here = regionsHere(ui);
  const known = (key) => Object.values(natureOf(key, ui)).some(l => l.some(e => e.known));
  const places = [{ id: MAPWIDE, name: "Mapa inteiro", r: null }, ...all.map(r => ({ id: r.id, name: r.name || "Região sem nome", r }))]
    .filter(o => gm || (o.id === MAPWIDE ? known(MAPWIDE) : here.includes(o.r) || known(o.r)));
  const top = showWx ? ["clima", "lugares"] : ["lugares"]; let tab = top.includes(ui.natTab) ? ui.natTab : "lugares";
  const nav = top.length > 1 ? `<div class="subtabs" role="tablist">${[["clima", "Clima"], ["lugares", `Lugares · ${places.length}`]].map(([k, l]) => `<button type="button" role="tab" aria-selected="${tab === k}" class="${tab === k ? "on" : ""}" data-act="natTab" data-v="${k}">${esc(l)}</button>`).join("")}</div>` : "";
  if (tab === "clima") return nav + `<div class="poitab">${panelClima(ui)}</div>`;
  const cur = ui.natPlace ? places.find(o => o.id === ui.natPlace) : null;
  if (!cur) return nav + `<div class="poitab">${placesList(ui, places, here, isGM, gm)}</div>`;
  return nav + `<div class="poitab">${placeView(ui, cur, here, isGM, gm)}</div>`;
}
const colOf = (r) => r?.color?.css ?? (typeof r?.color === "string" ? r.color : "#888888");
/** Lista de lugares (mapa inteiro + Regiões), com o que tem em cada um. */
function placesList(ui, places, here, isGM, gm) {
  const row = (o) => { const z = o.r ? zoneOf(o.r) : null; const n = natureOf(o.id === MAPWIDE ? MAPWIDE : o.r, ui); const cnt = (k) => n[k].filter(e => gm || e.known).length; const isHere = o.r && here.includes(o.r);
    const terr = o.id === MAPWIDE ? (ui.data.map?.zone?.mult ? `geral ×${ui.data.map.zone.mult}` : "onde não há Região") : z ? z.label : "não afeta a viagem";
    return `<button type="button" class="lrow place ${isHere ? "here" : ""}" data-act="natPlace" data-id="${o.id}" ${o.r ? `data-hi="${o.r.id}"` : ""} data-q="${esc(o.name.toLowerCase())}">
      <span class="sw" style="background:${esc(o.r ? colOf(o.r) : "#6b6f78")}"></span><span class="grow"><b>${esc(o.name)}</b><small>${esc(isGM ? terr : z?.label ?? "")}${isHere ? " · o grupo está aqui" : ""}</small></span>
      <span class="ncnt">${["fauna", "flora", "ameacas"].map(k => cnt(k) ? `<span data-tooltip="${NATURE_CATS[k].label}">${ic(NATURE_CATS[k].icon, 11)}${cnt(k)}</span>` : "").join("")}</span></button>`; };
  const draw = isGM ? `${ui.tool === "vreg" ? vecRegBox(ui) : ""}<div class="actions row"><button type="button" class="btn gold grow ${ui.tool === "regiao" ? "on" : ""}" data-act="tool" data-v="regiao" data-tooltip="Clique para pôr os cantos; duplo clique ou Enter fecha; botão direito desfaz o último; Esc cancela.">${ic("zone", 14)} ${ui.tool === "regiao" ? "Desenhando… (Enter termina)" : "Desenhar região"}</button><button type="button" class="btn ${ui.tool === "vreg" ? "on" : ""}" data-act="tool" data-v="${ui.tool === "vreg" ? "sel" : "vreg"}" data-tooltip="Nós das formas, novas formas, buracos (barra no alto da tela)">${ui.tool === "vreg" ? "Sair" : "Edição avançada"}</button></div>` : "";
  const hereFirst = [...places].sort((a, b) => (b.id === MAPWIDE) - (a.id === MAPWIDE) || ((b.r && here.includes(b.r)) - (a.r && here.includes(a.r))) || a.name.localeCompare(b.name));
  return `${draw}${places.length > 6 ? search("Procurar lugar…") : ""}<div class="natlist">${hereFirst.map(row).join("") || `<p class="muted">Vocês ainda não sabem nada da natureza por aqui.</p>`}</div>
    ${isGM ? `<small class="muted">Passe o mouse num lugar para ver a Região no mapa.</small>` : ""}`;
}
/** Um lugar aberto: Fauna · Flora · Ameaças e, para o mestre, Terreno (velocidade, quem passa, encontros, clima próprio). */
function placeView(ui, cur, here, isGM, gm) {
  const r = cur.r; const key = cur.id === MAPWIDE ? MAPWIDE : r; const n = natureOf(key, ui); const z = r ? zoneOf(r) : null;
  const tabs = [...Object.entries(NATURE_CATS).map(([k, v]) => [k, `${v.label} · ${n[k].filter(e => gm || e.known).length}`]), ...(isGM ? [["terreno", "Terreno"]] : [])];
  const cat = tabs.some(([k]) => k === ui.natCat) ? ui.natCat : "fauna";
  const head = `<div class="rowhead">${backBtn("natBack", "Todos os lugares")}</div>
    <div class="placehead" ${r ? `data-hi="${r.id}"` : ""}>${r && isGM ? `<input type="color" class="regcol" data-field="regColor" data-r="${r.id}" value="${esc(colOf(r).slice(0, 7))}" aria-label="Cor">` : `<span class="sw big" style="background:${esc(r ? colOf(r) : "#6b6f78")}"></span>`}
      <div class="grow">${r && isGM ? `<input type="text" class="regname" data-field="regName" data-r="${r.id}" value="${esc(r.name || "")}" placeholder="Região sem nome">` : `<b>${esc(cur.name)}</b>`}<small>${cur.id === MAPWIDE ? "vale onde não há Região" : z ? esc(z.label) : "não afeta a viagem"}${r && here.includes(r) ? " · o grupo está aqui" : ""}</small></div>
      ${r ? `<button type="button" class="icon" data-act="regGo" data-r="${r.id}" data-tooltip="Mostrar no mapa" aria-label="Mostrar">${ic("target", 14)}</button>` : ""}
      ${r && isGM ? `<button type="button" class="icon" data-act="regEdit" data-r="${r.id}" data-tooltip="Configuração da Região no Foundry" aria-label="Configurar">${ic("gear", 14)}</button><button type="button" class="icon danger" data-act="regDel" data-r="${r.id}" data-tooltip="Apagar a Região" aria-label="Apagar">${ic("trash", 14)}</button>` : ""}</div>
    <div class="subtabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" aria-selected="${cat === k}" class="${cat === k ? "on" : ""}" data-act="natCat" data-v="${k}">${esc(l)}</button>`).join("")}</div>`;
  if (cat === "terreno") return head + (cur.id === MAPWIDE ? mapZoneCard(ui) : zoneCard(ui, r));
  const C = NATURE_CATS[cat]; const items = n[cat].filter(e => gm || e.known); const rid = cur.id;
  let body = items.map(e => { const doc = e.uuid ? (() => { try { return fromUuidSync(e.uuid); } catch (er) { return null; } })() : null; const img = e.img || doc?.img;
    return `<div class="natrow ${e.known ? "" : "unknown"}">${img ? `<span class="ava"><img src="${esc(img)}" alt=""></span>` : `<span class="ava">${ic(C.icon, 18)}</span>`}
      <div class="grow"><b>${esc(e.name)}</b>${isGM ? `<input type="text" class="natnote" data-field="natNote" data-r="${rid}" data-c="${cat}" data-id="${e.id}" value="${esc(e.note ?? "")}" placeholder="nota (ex.: comum à noite)">` : e.note ? `<small>${esc(e.note)}</small>` : ""}</div>
      ${e.uuid ? `<button type="button" class="icon" data-act="natOpen" data-uuid="${esc(e.uuid)}" data-tooltip="Abrir" aria-label="Abrir">${ic("journal", 13)}</button>` : ""}
      ${isGM ? `<button type="button" class="icon ${e.known ? "on" : ""}" data-act="natKnown" data-r="${rid}" data-c="${cat}" data-id="${e.id}" data-tooltip="${e.known ? "Os jogadores conhecem · clique para esconder" : "Escondido dos jogadores · clique para revelar"}" aria-label="Revelar">${ic(e.known ? "eye" : "eyeoff", 13)}</button><button type="button" class="icon" data-act="natDel" data-r="${rid}" data-c="${cat}" data-id="${e.id}" aria-label="Remover">${ic("close", 12)}</button>` : ""}</div>`; }).join("") || `<p class="muted">${esc(cur.id === MAPWIDE ? C.empty.replace("nesta região", "no mapa inteiro") : C.empty)}</p>`;
  if (isGM) body += `<div class="drop" data-drop="Any" data-field-target="nat:${rid}:${cat}">${ic("plus", 13)}<span class="grow">Arraste ator, item ou diário · ou escreva abaixo</span></div>
    <input type="text" data-field="natNew" data-r="${rid}" data-c="${cat}" placeholder="Nome e Enter">`;
  if (cur.id !== MAPWIDE) { const g = natureOf(MAPWIDE, ui)[cat].filter(e => gm || e.known); if (g.length) body += `<section><h3>Também em todo o mapa</h3><div class="chips wrap">${g.map(e => `<span class="chip">${esc(e.name)}</span>`).join("")}</div></section>`; }
  return head + `<div class="natlist">${body}</div>${isGM ? `<small class="muted">${ic("eyeoff", 11)} = escondido dos jogadores até você revelar.</small>` : ""}`;
}
/** Terreno geral do mapa: vale onde nenhuma Região se aplica. */
function mapZoneCard(ui) {
  const z = ui.data.map?.zone ?? {}; const k = (x) => `data-field="mapzone" data-k="${x}"`; const ch = Array.isArray(z.chance) ? z.chance : [1, 8];
  return `<section class="zonecard">
    <div class="grid2"><label>Velocidade ×<input type="number" step="0.05" min="0.1" ${k("mult")} value="${z.mult ?? ""}" placeholder="1"></label>
      <label>Bioma (acampamento)<input type="text" ${k("biome")} value="${esc(z.biome ?? "")}" placeholder="planicie"></label></div>
    <label>Encontro<div class="row2"><input type="number" min="0" ${k("cn")} value="${ch[0]}"><span>em</span><input type="number" min="1" ${k("cd")} value="${ch[1]}"></div></label>
    ${dropZone("RollTable", "mapzone", z.table, "Tabela de encontros do mapa inteiro")}</section>`;
}
/* ----- diário ----- */
function exploredPct(ui) {
  const sc = ui.scene; const ex = ui.data.explored; if (!mapOf(sc)?.fog) return null; if (!ex.length) return 0;
  const W = sc.dimensions?.sceneWidth ?? sc.width, H = sc.dimensions?.sceneHeight ?? sc.height, X = sc.dimensions?.sceneX ?? 0, Y = sc.dimensions?.sceneY ?? 0;
  let n = 0, hit = 0; for (let i = 0; i < 30; i++) for (let j = 0; j < 20; j++) { const x = X + (i + 0.5) * W / 30, y = Y + (j + 0.5) * H / 20; n++; if (ex.some(e => Math.hypot(e[0] - x, e[1] - y) <= e[2])) hit++; }
  return Math.round(hit / n * 100);
}
const dayOf = (t) => `Dia ${Math.floor((t ?? 0) / 86400) + 1}`;
/** Agrupa as entradas do diário por dia de jogo (o mais recente primeiro). */
function byDay(list, row) {
  const days = []; for (const l of list) { const d = dayOf(l.t); const last = days[days.length - 1]; if (last?.d === d) last.items.push(l); else days.push({ d, items: [l] }); }
  return days.map(x => `<section class="logday"><div class="ld-h"><span>${esc(x.d)}</span><em>${x.items.length}</em></div>${x.items.map(row).join("")}</section>`).join("");
}
function panelDiario(ui) {
  const pct = exploredPct(ui);
  const tab = ["notas", "registro", "viagens"].includes(ui.codexTab) ? ui.codexTab : "viagens"; const tabs = [["viagens", "Viagens"], ["registro", "Descobertas"], ["notas", "Notas no mapa"]];
  let body = "";
  if (tab === "notas") {
    const list = notes().filter(n => n.sceneId === ui.scene.id && (!n.private || n.userId === game.user.id || game.user.isGM)); const nd = ui.noteDraft;
    body = `${nd && !nd.placing ? `<div class="notedraft"><textarea data-live="noteText" rows="3" placeholder="O que vocês anotaram aqui?">${esc(nd.text ?? "")}</textarea>
        <label class="check"><input type="checkbox" data-field="noteFlag" data-k="private" ${nd.private ? "checked" : ""}> Só eu vejo</label>
        <label class="check"><input type="checkbox" data-field="noteFlag" data-k="dest" ${nd.dest ? "checked" : ""}> É o próximo destino</label>
        <div class="actions row"><button type="button" class="btn gold grow" data-act="saveNote">Salvar nota</button><button type="button" class="btn" data-act="cancelNote">Cancelar</button></div></div>`
      : nd?.placing ? `<div class="info">Clique no mapa onde a nota fica. Esc cancela.</div>` : `<button type="button" class="btn gold" data-act="newNote">${ic("note", 14)} Adicionar nota no mapa</button>`}
      ${list.map(n => `<div class="noterow" style="--nc:${esc(userColor(n.userId))}"><span class="nd"></span><div class="grow"><strong>${esc(game.users.get(n.userId)?.name ?? "")}</strong>${n.kind === "dest" ? " · destino" : ""}${n.private ? " · privada" : ""}<p>${esc(n.text)}</p></div>${n.userId === game.user.id || game.user.isGM ? `<button type="button" class="icon" data-act="delNote" data-id="${n.id}" aria-label="Apagar nota">${ic("trash", 13)}</button>` : ""}</div>`).join("")}`;
  } else if (tab === "viagens") {
    let log = logOf().filter(l => l.kind === "viagem" && (!l.sceneId || l.sceneId === ui.scene.id)).slice(0, 80);
    const gs = [...new Set(log.map(l => l.group).filter(Boolean))]; const gf = gs.includes(ui.logGroup) ? ui.logGroup : "";
    if (gf) log = log.filter(l => l.group === gf);
    const card = (l) => { const extra = [l.camps?.length ? `${ic("tent", 11)} ${l.camps.map(esc).join(" · ")}` : "", l.swaps?.length ? `${ic("enter", 11)} ${l.swaps.map(esc).join(" · ")}` : "", l.visited?.length ? `${ic("check", 11)} ${l.visited.map(esc).join(", ")}` : "", l.found?.length ? `${ic("eye", 11)} ${l.found.map(esc).join(", ")}` : ""].filter(Boolean);
      const route = l.from || l.to ? `${esc(l.from ?? "")}${l.via?.length ? ` → ${l.via.map(esc).join(" → ")}` : ""} → <b>${esc(l.to ?? "")}</b>` : esc(l.text ?? "");
      return `<div class="tripcard ${l.arrived ? "ok" : ""}"><div class="tc-h"><b class="grow">${esc(l.group ?? "")}</b>${l.arrived ? `<span class="tag ok">chegou</span>` : l.dist ? `<span class="tag warn">a caminho</span>` : ""}</div>
        <div class="tc-r">${route}</div>
        ${l.dist ? `<div class="tc-m">${[l.dist, l.march ? `${esc(l.march)} de marcha` : "", l.nights ? `${l.nights} noite(s)` : "", l.enc ? `${l.enc} encontro(s)` : "", l.mode].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join("")}</div>` : ""}
        ${extra.length ? `<div class="tc-x">${extra.map(x => `<small>${x}</small>`).join("")}</div>` : ""}${game.user.isGM && l.encs?.length ? `<small class="enc">${ic("warn", 11)} ${l.encs.map(esc).join(" · ")}</small>` : ""}</div>`; };
    body = (gs.length > 1 ? `<div class="fchips"><button type="button" class="fchip ${!gf ? "on" : ""}" data-act="logGroup" data-v="">Todas</button>${gs.map(g => `<button type="button" class="fchip ${gf === g ? "on" : ""}" data-act="logGroup" data-v="${esc(g)}">${esc(g)}</button>`).join("")}</div>` : "")
      + (log.length ? byDay(log, card) : `<p class="muted">As viagens feitas pelo Atlas ficam registradas aqui.</p>`);
  } else {
    const log = logOf().filter(l => l.kind !== "viagem" && (!l.sceneId || l.sceneId === ui.scene.id)).slice(0, 80);
    const KI = { visitado: "check", avistado: "eye", rumor: "vote", mapa: "map" };
    body = log.length ? byDay(log, (l) => `<div class="logrow">${ic(KI[l.kind] ?? "note", 12)}<div class="grow">${esc(l.text)}</div></div>`) : `<p class="muted">Locais visitados e avistados, rumores e mapeamentos aparecem aqui.</p>`;
  }
  return `${pct != null ? `<div class="progress"><span>Explorado</span><div class="bar"><i style="width:${pct}%"></i></div><b>${pct}%</b></div>` : ""}
    <div class="subtabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" aria-selected="${tab === k}" class="${tab === k ? "on" : ""}" data-act="codexTab" data-v="${k}">${esc(l)}</button>`).join("")}</div>
    <div class="tabbody">${body}</div>`;
}

/* ----- clima ----- */
/** Como o Atlas entende a escala desta cena. */
function scaleNote(ui) {
  const S = scaleOf(ui.scene); const km = S.dist * kmPerUnit(S.units); const ok = knownUnit(S.units);
  return `<p class="muted">Escala da cena: 1 quadro = ${esc(S.dist)} ${esc(S.units)} ≈ ${km >= 1 ? km.toFixed(km >= 10 ? 0 : 1) + " km" : Math.round(km * 1000) + " m"}. Uma nuvem de chuva tem de 6 a 40 km; o tamanho acima multiplica isso.${ok ? "" : ` <b>A unidade “${esc(S.units)}” não foi reconhecida: use mi, km, ft, m, jardas ou léguas na configuração da grade da cena (o Atlas está tratando como milhas).</b>`}</p>`;
}
/** Editor de imagem como o de um tile: imagem, tinta, opacidade, escala, rotação, espelhar. */
function lookEditor(key, o, title, label) {
  const f = (k) => `data-field="wx" data-k="${key}.${k}"`; const live = `data-live="wx"`;
  return `<section><h3>${esc(title)}</h3>
    ${imgPick(`${key}.img`, o.img, label)}
    <label>Tinta<div class="row2"><input type="color" class="colorpick" ${f("tint")} value="${o.tint || "#ffffff"}"><button type="button" class="btn" data-act="wxClear" data-k="${key}.tint" ${o.tint ? "" : "disabled"}>Sem tinta</button></div></label>
    <label>Opacidade<div class="row2"><input type="range" min="0" max="1" step="0.05" ${live} ${f("alpha")} value="${o.alpha}"><span class="rv">${Math.round(o.alpha * 100)}%</span><button type="button" class="rreset" data-def="1" title="Voltar ao padrão (1)" aria-label="Voltar ao padrão">↺</button></div></label>
    <label>Escala<div class="row2"><input type="range" min="0.1" max="3" step="0.05" ${live} ${f("scale")} value="${o.scale}"><input type="number" class="num" min="0.1" max="4" step="0.05" ${f("scale")} value="${o.scale}"><button type="button" class="rreset" data-def="1" title="Voltar ao padrão (1)" aria-label="Voltar ao padrão">↺</button></div></label>
    <label>Rotação (°)<div class="row2"><input type="range" min="-180" max="180" step="1" ${live} ${f("rot")} value="${o.rot}"><input type="number" class="num" min="-360" max="360" step="1" ${f("rot")} value="${o.rot}"><button type="button" class="rreset" data-def="0" title="Voltar ao padrão (0)" aria-label="Voltar ao padrão">↺</button></div></label>
    <div class="grid2"><label class="check"><input type="checkbox" ${f("flipX")} ${o.flipX ? "checked" : ""}> Espelhar na horizontal</label><label class="check"><input type="checkbox" ${f("flipY")} ${o.flipY ? "checked" : ""}> Espelhar na vertical</label></div>
  </section>`;
}
function imgPick(field, val, label) {
  return `<label>${esc(label)}<div class="row2"><input type="text" data-field="wx" data-k="${field}" value="${esc(val)}" placeholder="padrão do Atlas"><button type="button" class="btn" data-act="pickImg" data-f="wx:${field}" aria-label="Escolher imagem">${ic("search", 13)}</button>${val ? `<button type="button" class="btn" data-act="wxClear" data-k="${field}" aria-label="Voltar ao padrão">${ic("close", 12)}</button>` : ""}</div></label>`;
}
function panelClima(ui) {
  const own = normWeather(ui.data.weather); const eff = ui.wx; const gm = game.user.isGM; const link = parentLink(ui.scene);
  const inh = !!(eff.link && !eff.link.immune); const w = inh ? eff : own; const [bl, kmh] = BEAUFORT[w.force];
  const linkNote = !link ? "" : eff.link?.immune ? `<p class="muted">${ic("house", 13)} O local “${esc(eff.link.poi)}” em ${esc(eff.link.scene)} é abrigado: este mapa usa o clima próprio abaixo.</p>`
    : inh ? `<p class="muted">${ic("cloud", 13)} Clima vindo de <b>${esc(eff.link.scene)}</b>${eff.link.poi ? ` (local “${esc(eff.link.poi)}”)` : ""}: ${eff.link.raining ? "uma nuvem de chuva está passando por cima agora" : eff.link.cover ? "uma nuvem está passando por cima agora" : "céu aberto sobre o lugar agora"}. Muda sozinho conforme as nuvens do mapa pai passam.</p>` : "";
  const summary = `<div class="wxcard"><span class="wxic">${ic(CLIMATES[w.climate].icon, 26)}</span><div><b>${esc(CLIMATES[w.climate].label)} · ${Math.round(w.temp)}°C</b><small>Vento de ${esc(dirName(w.dir))} (${Math.round(w.dir)}°) · ${kmh} km/h · ${esc(bl)}</small>${w.note ? `<small>${esc(w.note)}</small>` : ""}</div></div>`;
  if (!gm) return w.enabled && w.players ? summary + linkNote : `<p class="muted">O mestre não está mostrando o clima deste mapa.</p>`;
  const f = (k) => `data-field="wx" data-k="${k}"`;
  const srcSel = link ? `<label>Clima deste mapa<select ${f("source")}>${opt("auto", `Herdar de ${link.scene.name} (nuvens passando por cima)`, own.source)}${opt("proprio", "Próprio (definido aqui)", own.source)}</select></label>` : "";
  if (inh) return `${srcSel}${summary}${linkNote}
    <label class="check"><input type="checkbox" ${f("players")} ${own.players ? "checked" : ""}> Jogadores veem o clima</label>
    <label class="check"><input type="checkbox" ${f("terrain")} ${own.terrain ? "checked" : ""}> O terreno deste mapa influencia o clima</label>
    <div class="grid2"><label>Nuvens<select ${f("clouds")}>${Object.entries(CLOUD_MODES).map(([k, v]) => opt(k, v, own.clouds)).join("")}</select></label>
      <label>Velocidade das nuvens<select ${f("cloudTime")}>${[[1, "Tempo real"], [10, "10× mais rápido"], [60, "60× (1 min = 1 h)"], [600, "600× (1 min = 10 h)"]].map(([k, v]) => opt(k, v, own.cloudTime)).join("")}</select></label></div>
    <p class="muted">Para um lugar não sofrer o clima de fora (edifício, caverna), desmarque “Sofre o clima do mapa” no local em ${esc(link.scene.name)}.</p>`;
  return `${srcSel}${linkNote}<label class="check big"><input type="checkbox" ${f("enabled")} ${w.enabled ? "checked" : ""}> Usar clima e vento neste mapa</label>
    ${w.enabled ? `${summary}
    <div class="grid2"><label>Clima<select ${f("climate")}>${Object.entries(CLIMATES).map(([k, v]) => opt(k, v.label, w.climate)).join("")}</select></label>
      <label>Temperatura (°C)<input type="number" ${f("temp")} value="${w.temp}"></label></div>
    <span class="lab">Direção do vento (de onde sopra)</span>
    <div class="dirs">${DIRS16.map((n, i) => `<button type="button" class="${dirName(w.dir) === n ? "on" : ""}" data-act="wxDir" data-v="${i * 22.5}" style="--a:${i * 22.5}deg">${n}</button>`).join("")}<span class="dircenter">${ic("wind", 16)}</span></div>
    <label>Força (Beaufort)<select ${f("force")}>${BEAUFORT.map(([l, k], i) => opt(i, `${i} · ${l} · ${k} km/h`, w.force)).join("")}</select></label>
    <label>Observação<input type="text" ${f("note")} value="${esc(w.note)}" placeholder="Ex.: maré alta à tarde"></label>
    <label class="check"><input type="checkbox" ${f("players")} ${w.players ? "checked" : ""}> Jogadores veem o clima</label>
    <button type="button" class="btn" data-act="roseConfig">${ic("compass", 14)} Rosa dos ventos e ponteiro (configurações do módulo)</button>
    <label class="check"><input type="checkbox" ${f("fx")} ${w.fx ? "checked" : ""}> Aplicar o efeito de clima do Foundry na cena</label>
    <div class="grid2"><label>Nuvens<select ${f("clouds")}>${Object.entries(CLOUD_MODES).map(([k, v]) => opt(k, v, w.clouds)).join("")}</select></label>
      <label>Velocidade das nuvens<select ${f("cloudTime")}>${[[1, "Tempo real"], [10, "10× mais rápido"], [60, "60× (1 min = 1 h)"], [600, "600× (1 min = 10 h)"]].map(([k, v]) => opt(k, v, w.cloudTime)).join("")}</select></label></div>
    <label class="check"><input type="checkbox" ${f("terrain")} ${w.terrain ? "checked" : ""}> O terreno influencia o clima <span class="hint" data-tooltip="Usa as Regiões com tipo de terreno: mar e lagos formam nuvens e chovem mais com tempo úmido; montanhas seguram nuvens e chovem nelas; no deserto as nuvens se desfazem. O tamanho das nuvens segue a escala do mapa; chuva, neve e raios só caem debaixo delas.">?</span></label>
    <label>Muda sozinho com o tempo <span class="hint" data-tooltip="Quando o relógio do mundo passa desse tempo (pelo Cronos, descanso ou viagem), o clima varia sozinho, como no botão abaixo.">?</span><select data-field="wx" data-k="auto">${[[0, "Não"], [4, "A cada 4 horas"], [8, "A cada 8 horas"], [12, "A cada 12 horas"], [24, "Uma vez por dia"]].map(([k, v]) => opt(k, v, Number(ui.data.weather?.auto) || 0)).join("")}</select></label>
    <div class="actions row"><button type="button" class="btn gold grow" data-act="wxRoll" data-tooltip="Gira o vento e varia a força e o clima um pouco. Nada vai ao chat. No mar, vento a favor acelera barcos e contra atrasa.">${ic("wind", 14)} Mudar com o tempo</button></div>
    <section><h3>Nuvens</h3>
      <label>Tamanho das nuvens<div class="row2"><input type="range" min="0.1" max="5" step="0.05" data-live="wx" ${f("cloudScale")} value="${w.cloudScale}"><input type="number" class="num" min="0.05" max="10" step="0.05" ${f("cloudScale")} value="${w.cloudScale}"><button type="button" class="rreset" data-def="1" title="Voltar ao padrão (1)" aria-label="Voltar ao padrão">↺</button></div></label>
      <div class="actions row"><button type="button" class="btn" data-act="wxCloudReset" ${w.cloudScale === 1 && !Object.keys(w.cloudOff ?? {}).length ? "disabled" : ""}>Voltar ao padrão (tamanho e posições)</button><button type="button" class="btn" data-act="tool" data-v="nuvem">${ic("cloud", 13)} Arrastar nuvens</button></div>
      ${scaleNote(ui)}</section>` : `<p class="muted">Desligado: nada de clima aparece para ninguém.</p>`}`;
}

/* ----- local ----- */
function panelLocal(ui) {
  const p0 = ui.data.pois.find(x => x.id === ui.sel); if (!p0) return `<p class="muted">Clique num local do mapa.</p>`;
  const p = normPoi(p0); const k = POI_KINDS[p.kind]; const gm = ui.gmView; const rumor = !gm && p.state === "rumor";
  const mv = moverOf(ui);
  let img = p.img || p.markerImg; if (!img && p.submap) img = game.scenes.get(p.submap)?.thumb; if (!img && p.scene) img = game.scenes.get(p.scene)?.thumb; if (!img && p.actor) { try { img = fromUuidSync(p.actor)?.img; } catch (e) { /* */ } }
  if (rumor) img = "";
  let desc = p.desc;
  if (!desc && p.journal && !rumor) { const ex = ui.cache.ex?.[p.journal]; if (ex === undefined) { (ui.cache.ex ??= {})[p.journal] = ""; journalExcerpt(p.journal).then(t => { ui.cache.ex[p.journal] = t; ui.refreshChrome(); }); } desc = ex ?? ""; }
  if (rumor) desc = p.rumorText || "Ouviu-se falar de algo nesta área, mas ninguém sabe ao certo o quê.";
  const services = [...p.services];
  if (p.actor && !rumor) { try { const a = fromUuidSync(p.actor); for (const mm of a?.system?.members ?? []) { const ma = mm.actor ?? (mm.actorId ? game.actors.get(mm.actorId) : null); if (ma?.name) services.push({ name: ma.name, type: "membro" }); } } catch (e) { /* */ } }
  const sub = p.submap ? game.scenes.get(p.submap) : null;
  const districts = sub ? dataOf(sub).pois.map(normPoi).filter(x => x.kind === "distrito" && (gm || x.state !== "oculto")) : [];
  const here = mv?.at === p.id; const tt = rumor ? "? · ?" : travelText(ui, p.id);
  const danger = p.danger ? { baixo: "Baixo", moderado: "Moderado", alto: "Alto", mortal: "Mortal" }[p.danger] ?? p.danger : "—";
  const enterLabel = p.submap ? (p.kind === "cidade" || p.kind === "capital" ? "Entrar na cidade" : "Abrir mapa") : "Abrir cena";
  return `<div class="hero ${img ? "" : "noimg"}">${img ? `<img src="${esc(img)}" alt="">` : `<span class="heroic">${rumor ? "?" : ic(p.icon, 34)}</span>`}<div class="shade"></div>
    <div class="htxt"><div class="chips"><span class="chip gold">${esc(rumor ? "Rumor" : k.label)}</span><span class="chip blue">${esc(POI_STATES[p.state].label)}</span></div><h2>${esc(rumor ? "Local desconhecido" : p.name)}</h2></div></div>
    ${(() => { if (rumor) return ""; const w = ui.wx; if (!w.enabled || !(gm || w.players)) return ""; let s = null; try { s = poiSky(ui.scene, p); } catch (e) { /* */ } return s ? `<p class="skyline">${ic(s.immune ? "house" : CLIMATES[s.climate]?.icon ?? "cloud", 14)} ${esc(s.label)}</p>` : ""; })()}
    ${desc ? `<p class="desc">${esc(desc)}</p>` : gm && !rumor ? `<p class="muted">Sem descrição. Ligue um diário ou escreva uma no editor.</p>` : ""}
    <div class="kv3">
      <div><b>${here ? "—" : esc(tt.split(" · ")[0] || "—")}</b><small>distância</small></div>
      <div><b>${here ? "Aqui" : esc(tt.split(" · ")[1] || "—")}</b><small>de viagem</small></div>
      <div><b class="d-${esc(p.danger || "none")}">${esc(rumor ? "?" : danger)}</b><small>perigo</small></div>
    </div>
    ${services.length && !rumor ? `<section><h3>Lugares e serviços</h3>${services.map(s => `<div class="svc"><span class="sic">${ic(s.type === "membro" ? "person" : "shop", 14)}</span><span class="grow">${esc(s.name)}</span><small>${esc(s.type ?? "")}</small></div>`).join("")}</section>` : ""}
    ${districts.length ? `<section><h3>Distritos</h3><div class="chips wrap">${districts.map(x => `<span class="chip">${esc(x.name)}</span>`).join("")}</div></section>` : ""}
    ${p.quest && !rumor ? `<div class="quest"><b>!</b><div><strong>${esc(p.quest)}</strong><small>Missão ligada a este local</small></div></div>` : ""}
    ${gm ? `<section><h3>Estado para os jogadores</h3>${seg("setState", Object.entries(POI_STATES).map(([s, d]) => [s, d.label]), p.state)}</section>` : ""}
    ${(() => { /* uma ação principal (dourada): viajar para cá; estando aqui, a loja ou a saída */ const canGo = !here && mv && !rumor && canDrive(mv); const prim = canGo ? "travel" : (p.shop || p.service) && !rumor ? "biz" : "exit"; ui._poiPrim = prim; return ""; })()}
    <div class="actions">
      ${!here && mv && !rumor && canDrive(mv) ? `<button type="button" class="btn gold" data-act="travelTo" data-id="${p.id}">${ic("route", 14)} Viajar para cá</button>` : ""}
      ${(p.submap || p.scene) && !rumor ? `<button type="button" class="btn outline" data-act="enter" data-id="${p.id}">${ic("enter", 14)} ${esc(enterLabel)}</button>` : ""}
      ${p.journal && !rumor ? `<button type="button" class="btn" data-act="openJournal" data-id="${p.id}">${ic("journal", 14)} Diário</button>` : ""}
      <button type="button" class="btn" data-act="pingPoi" data-id="${p.id}">${ic("target", 14)} Marcar</button>
      ${p.kind === "saida" && p.exitScene && !rumor ? (() => { const dst = game.scenes.get(p.exitScene); const g = mv && mv.at === p.id && canDrive(mv) ? mv : null; if (!dst) return "";
        return g ? `<button type="button" class="btn ${ui._poiPrim === "exit" ? "gold" : "outline"}" data-act="exitGo" data-id="${p.id}" data-g="${g.id}" data-tooltip="${gm ? "Leva o grupo e os jogadores dele para o outro mapa" : "Pede ao mestre para levar o grupo"}">${ic("enter", 14)} ${gm ? "Levar" : "Pedir para ir"} para ${esc(dst.navName || dst.name)}</button>` : `<button type="button" class="btn" disabled data-tooltip="O grupo precisa estar nesta saída">${ic("enter", 14)} Leva para ${esc(dst.navName || dst.name)}</button>`; })() : ""}
      ${p.kind === "circulo" && !rumor && tpOn() ? (() => { const g = mv && mv.at === p.id && canDrive(mv) ? mv : null;
        const dests = portalLinks(ui.scene, p.id).filter(l => l.out).map(l => ({ s: l.scene, q: dataOf(l.scene).pois.map(normPoi).find(x => x.id === l.poi) })).filter(o => o.q && (gm || (o.q.state !== "rumor" && o.q.state !== "oculto" && !o.q.hidden))); if (!dests.length) return "";
        return `<section class="addbox tpbox"><h3>${ic("portal", 14)} Teleportar</h3>${p.tpPw && !gm ? `<label>Senha<input type="text" data-tppw placeholder="digite a senha"></label>` : ""}
          ${dests.map(({ s, q }) => `<button type="button" class="btn ${g ? "" : "quiet"}" ${g ? "" : "disabled"} data-act="tpGo" data-id="${p.id}" data-g="${g?.id ?? ""}" data-s="${s.id}" data-d="${q.id}" data-tooltip="${g ? "Leva o grupo num clarão" : "O grupo precisa estar neste portal"}">${ic("portal", 13)} ${esc(q.name)}${s.id !== ui.scene.id ? ` <small>· ${esc(s.navName || s.name)}</small>` : ""}</button>`).join("")}</section>`; })() : ""}
      ${(p.shop || p.service) && !rumor ? `<button type="button" class="btn ${ui._poiPrim === "biz" ? "gold" : "outline"}" data-act="bizOpen" data-id="${p.id}" data-tooltip="${here || gm ? "Comprar, vender e contratar serviços" : "O grupo precisa estar aqui para negociar"}">${ic("shop", 14)} ${p.shop && p.service ? "Loja e serviços" : p.shop ? "Loja" : "Serviços"}</button>` : ""}

    </div>`;
}

function dropZone(kind, field, uuid, label) {
  return `<div class="drop ${uuid ? "linked" : ""}" data-drop="${kind}" data-field-target="${field}">${ic(kind === "Actor" ? "person" : kind === "RollTable" ? "book" : "journal", 14)}<span class="grow">${uuid ? esc(docName(uuid)) : esc(label)}</span>${uuid ? `<button type="button" class="icon" data-act="unlink" data-f="${field}" aria-label="Remover ligação">${ic("close", 11)}</button>` : ""}</div>`;
}
function poiForm(ui) {
  const p = normPoi(ui.data.pois.find(x => x.id === ui.sel) ?? {}); const f = (k) => `data-field="poi" data-k="${k}"`;
  const sceneOpts = (cur, onlyMaps) => `<option value="">—</option>${(onlyMaps ? mapScenes() : scenesAll()).filter(s => s.id !== ui.scene.id).map(s => opt(s.id, s.name, cur)).join("")}`;
  const tabs = [["geral", "Geral"], ["marcador", "Marcador"], ["texto", "Texto"], ["ligacoes", "Ligações"]]; const t = tabs.some(([k]) => k === ui.poiTab) ? ui.poiTab : "geral";
  const parts = { geral: `<section><h3>Local</h3>
    <label>Nome<input type="text" ${f("name")} value="${esc(p.name)}"></label>
    ${kindPick(p.kind, f("kind"), "poiCat")}
    <div class="grid2"><label class="check"><input type="checkbox" ${f("shop")} ${p.shop ? "checked" : ""}> ${ic("shop", 13)} Loja (compra e venda)</label><label class="check"><input type="checkbox" ${f("service")} ${p.service ? "checked" : ""}> ${ic("inn", 13)} Presta serviços</label></div>
    ${p.kind === "saida" ? `<section class="addbox"><h3>Saída / entrada de mapa</h3><label>Leva para o mapa<select ${f("exitScene")}>${sceneOpts(p.exitScene, true)}</select></label>
      ${p.exitScene && game.scenes.get(p.exitScene) ? `<label>Chega em<select ${f("exitPoi")}><option value="">Automático (a saída de lá que volta para cá, ou o local que abre este mapa)</option>${dataOf(game.scenes.get(p.exitScene)).pois.map(x => opt(x.id, x.name ?? "Local", p.exitPoi)).join("")}</select></label>` : ""}
      <div class="info">Com o grupo parado aqui, os jogadores pedem para ir ao outro mapa; você confirma, o grupo passa para lá e os jogadores do grupo são levados junto. Você também pode levar o grupo direto.</div></section>` : ""}
    ${p.kind === "circulo" ? `<section class="addbox"><h3>${ic("portal", 14)} Portal</h3>
      <div class="grid2"><label>Ritual ao partir (min) <span class="hint" data-tooltip="Tempo para abrir o portal quando se parte daqui. Na chegada não se gasta nada.">?</span><input type="number" min="0" step="1" ${f("ritual")} value="${p.ritual}"></label><label>Cor da luz<input type="color" class="colorpick" ${f("tpColor")} value="${p.tpColor || "#b58ce8"}"></label></div>
      ${tpCondHtml(f, p)}
      <span class="lab">Ligações</span>${portalLinksHtml(ui, p)}
      <div class="info">Um portal só leva aos portais ligados a ele. Neste mapa, use a ferramenta <b>Ligar portais</b>: clique neste portal e depois nos outros; a linha reta é a ligação (Shift encadeia). Ela só aparece para você, editando.</div>
      ${portalRemoteHtml(ui, p)}
      ${tpOn() ? "" : `<div class="info">O teleporte está desligado nas configurações do módulo: o portal aparece, mas não leva a lugar nenhum.</div>`}</section>` : ""}
    ${p.shop || p.service ? `<div class="actions row"><button type="button" class="btn gold grow" data-act="bizOpen" data-id="${p.id}">${ic("shop", 14)} Abrir o balcão (loja e serviços)</button></div>` : ""}
    <div class="grid2"><label>Perigo<select ${f("danger")}>${[["", "—"], ["baixo", "Baixo"], ["moderado", "Moderado"], ["alto", "Alto"], ["mortal", "Mortal"]].map(([k, l]) => opt(k, l, p.danger)).join("")}</select></label></div>
    <span class="lab">Estado para os jogadores</span>${seg("setState", Object.entries(POI_STATES).map(([s, d]) => [s, d.label]), p.state)}
    <label class="check"><input type="checkbox" ${f("hidden")} ${p.hidden ? "checked" : ""}> Não revelar sozinho nas viagens</label>
    <label class="check"><input type="checkbox" ${f("locked")} ${p.locked ? "checked" : ""}> ${ic("lock", 13)} Fixo (travado): não pode ser arrastado sem querer</label></section>
`, marcador: `  <section><h3>Marcador</h3>
    <div class="iconpick">${customIcons().map(c => { const n = iconId(c); return `<button type="button" class="mine ${!p.markerImg && p.icon === n ? "on" : ""}" data-act="poiIcon" data-v="${esc(n)}" data-tooltip="${esc(c.name)}" aria-label="${esc(c.name)}">${ic(n, 16)}</button>`; }).join("")}${ICON_CHOICES.map(n => `<button type="button" class="${!p.markerImg && p.icon === n ? "on" : ""}" data-act="poiIcon" data-v="${n}" data-tooltip="${esc(iconName(n))}" aria-label="${esc(iconName(n))}">${ic(n, 16)}</button>`).join("")}<button type="button" data-act="iconAdd" data-for="poi" data-tooltip="Adicionar ícone próprio" aria-label="Adicionar ícone">${ic("plus", 16)}</button></div>
    <label>Imagem do marcador (troca o ícone)<div class="row2"><input type="text" ${f("markerImg")} value="${esc(p.markerImg)}" placeholder="ex.: um hexágono pintado"><button type="button" class="btn" data-act="pickImg" data-f="markerImg">${ic("search", 13)}</button></div></label>
    <div class="grid2"><label>Formato<select ${f("shape")}>${Object.entries(SHAPES).map(([k, v]) => opt(k, v, p.shape)).join("")}</select></label>
      <label>Tamanho (px)<input type="number" min="0" step="2" ${f("size")} value="${p.size || ""}" placeholder="${p.markerImg ? "acompanha o zoom" : "automático"}"></label></div>
    <label>Tamanho real no mapa (quadros) <span class="hint" data-tooltip="Ao aproximar, o marcador fica igual na tela e encolhe em relação ao mapa; com um tamanho real ele para de encolher quando ocupa essa área (em quadros de ${esc(scaleOf(ui.scene).dist)} ${esc(scaleOf(ui.scene).units)}) e passa a crescer com o mapa. “Zoom atual” usa o tamanho que ele tem agora.">?</span><div class="row2"><input type="number" min="0" step="0.05" ${f("real")} value="${p.real || ""}" placeholder="${ui.data.map?.realSize?.[p.kind] ? `padrão do tipo: ${ui.data.map.realSize[p.kind]}` : "nenhum"}"><button type="button" class="btn" data-act="poiRealNow" data-tooltip="Aproxime o mapa até o ponto em que o marcador deve parar de encolher e clique aqui">${ic("target", 13)} Zoom atual</button>${p.real ? `<button type="button" class="btn" data-act="poiRealClear" aria-label="Limpar">${ic("close", 12)}</button>` : ""}</div></label>
    <label>Cor do traço do ícone<div class="row2"><input type="color" class="colorpick" ${f("color")} value="${p.color || "#f3d08a"}"><button type="button" class="btn" data-act="poiColor" data-v="" ${p.color ? "" : "disabled"}>Padrão</button></div></label>
    <label>Nome no mapa<select ${f("labelMode")}>${opt("", `Padrão do mapa (${(LABEL_MODES[ui.data.map?.labels] ?? LABEL_MODES.sempre).toLowerCase()})`, p.labelMode)}${Object.entries(LABEL_MODES).map(([k, v]) => opt(k, v, p.labelMode)).join("")}</select></label>
    <div class="swatches">${["#f3d08a", "#ffffff", "#1b1610", "#3c2c16", "#c0392b", "#2a6fb0", "#3f8f4a", "#7a4ab0"].map(c => `<button type="button" class="sw ${p.color === c ? "on" : ""}" data-act="poiColor" data-v="${c}" style="background:${c}" aria-label="${c}"></button>`).join("")}</div></section>
`, texto: `  <section><h3>Descrição</h3>
    <label>Texto (se vazio, usa o diário)<textarea ${f("desc")} rows="3">${esc(p.desc)}</textarea></label>
    <div class="grid2"><label>Texto do rumor<input type="text" ${f("rumorText")} value="${esc(p.rumorText)}"></label><label>Raio do rumor (células)<input type="number" min="0" step="0.5" ${f("rumor")} value="${p.rumor}"></label></div>
    <label>Missão ligada<input type="text" ${f("quest")} value="${esc(p.quest)}"></label>
    <label>Lugares e serviços (um por linha: Nome | tipo)<textarea ${f("services")} rows="3">${esc(p.services.map(s => `${s.name}${s.type ? ` | ${s.type}` : ""}`).join("\n"))}</textarea></label>
    <label>Imagem do cartão e do painel (aparece no topo)<div class="row2"><input type="text" ${f("img")} value="${esc(p.img)}"><button type="button" class="btn" data-act="pickImg" data-f="img">${ic("search", 13)}</button></div></label></section>
`, ligacoes: `  <section><h3>Ligações (arraste do Foundry)</h3>
    ${dropZone("JournalEntry", "journal", p.journal, "Diário ou página")}
    ${dropZone("Actor", "actor", p.actor, "Ator de grupo (mercadores, guarnição)")}
    <label>Cena do local<select ${f("scene")}>${sceneOpts(p.scene, false)}</select></label>
    <label>Submapa (desce um nível)<select ${f("submap")}>${sceneOpts(p.submap, true)}</select></label>
    <label class="check"><input type="checkbox" ${f("wxFollow")} ${p.wxFollow ? "checked" : ""}> Sofre o clima do mapa (nuvens e chuva que passam por cima)</label>
    <small class="muted">Desmarque para lugares abrigados (edifícios, cavernas). O submapa herda o clima daqui enquanto estiver marcado.</small></section>` };
  return `<div class="subtabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" aria-selected="${t === k}" class="${t === k ? "on" : ""}" data-act="poiTab" data-v="${k}">${l}</button>`).join("")}</div>
  <div class="poitab">${parts[t]}</div>
  <div class="actions row"><button type="button" class="btn danger" data-act="delete">${ic("trash", 13)} Apagar</button><button type="button" class="btn grow" data-act="poiMode" data-v="0">Pronto</button></div>`;
}
const ROUTE_STYLE_KEYS = ["color", "width", "dash", "dashScale", "opacity", "outline", "outlineColor", "outlineWidth", "showName", "nameSize", "nameColor", "bStyle", "bColor", "bWidth", "bDash"];
/** Edição avançada de Regiões: a forma e os nós selecionados. */
function vecRegBox(ui) {
  const v = ui.vx ?? {}; const r = v.reg ? ui.scene.regions?.get?.(v.reg.rid) : null;
  if (!r) return `<section class="addbox"><h3>Edição avançada</h3><div class="info">Clique numa Região para ver os nós (a selecionada fica por cima das outras). Clique num nó ou numa borda para selecionar (Shift soma; arraste um retângulo para pegar vários). Alt + clique escolhe a Região de baixo quando há sobreposição. Os nós grudam nos nós das outras Regiões. Ctrl + duplo clique na borda põe um nó novo; duplo clique num nó apaga.</div></section>`;
  const s = (r.shapes?.contents ?? [...(r.shapes ?? [])]).map(x => x.toObject?.() ?? x)[v.reg.si]; const n = v.rnodes?.length ?? 0; const pol = s?.type === "polygon";
  const B = (act, label, tip, dis = false) => `<button type="button" class="btn" data-act="rgDo" data-v="${act}" data-tooltip="${esc(tip)}" ${dis ? "disabled" : ""}>${esc(label)}</button>`;
  return `<section class="addbox"><h3>${esc(r.name || "Região")} · forma ${v.reg.si + 1}${s?.hole ? " (buraco)" : ""}</h3>
    <div class="info">${n ? `${n} nó(s) selecionado(s).` : "Clique num nó ou numa borda para selecionar."} ${pol ? "As curvas são guardadas no Atlas; o Foundry recebe o contorno em pequenos trechos retos." : "Esta forma é um " + ({ rectangle: "retângulo", ellipse: "elipse", circle: "círculo" }[s?.type] ?? s?.type) + ": converta em curvas para editar nó a nó."}</div>
    ${pol ? `<span class="lab">Trecho que chega ao nó</span><div class="actions row">${B("toLine", "Reta", "Transforma o trecho em linha reta", !n)}${B("toCurve", "Curva", "Transforma o trecho em curva (com alças para puxar)", !n)}</div>
    <span class="lab">Tipo do nó</span><div class="actions row">${B("cusp", "Cúspide", "Alças independentes (canto)", !n)}${B("smooth", "Suave", "Alças alinhadas", !n)}${B("sym", "Simétrico", "Alças iguais", !n)}${B("auto", "Automático", "A curva se ajusta sozinha", !n)}</div>` : ""}
    <div class="actions row">${B("addNode", "Adicionar nó", "No meio do trecho que chega a cada nó selecionado", !n)}${B("delNode", "Apagar nó(s)", "Apaga os nós selecionados", !(pol && n))}${pol ? "" : B("toPoly", "Converter em curvas", "Retângulo, círculo ou elipse viram nós editáveis (Ctrl+Q)")}</div>
    <div class="actions row">${B("hole", s?.hole ? "Deixar de ser buraco" : "Tornar buraco", "Um buraco recorta a Região")}<button type="button" class="btn danger" data-act="rgDo" data-v="delShape">${ic("trash", 13)} Apagar forma</button></div></section>`;
}
/** Edição avançada: o que fazer com os nós (ou trechos) selecionados. */
function vecNodeBox(ui) {
  const v = ui.vx ?? {}; const n = v.nodes?.length ?? 0;
  if (!n) return `<section class="addbox"><h3>Edição avançada</h3><div class="info">Ferramenta Forma (barra no alto): clique numa rota para ver os nós; clique num nó ou num trecho para selecionar (Shift soma; arraste um retângulo para pegar vários). Arraste nós, alças ou o meio de um trecho para curvar. Ctrl + duplo clique no traço põe um nó novo. Roda do mouse: zoom; botão direito arrastado: mover a vista; botão direito parado: menu (Combinar, Agrupar, Copiar…); Espaço: alterna com a Seleção.</div></section>`;
  const B = (act, label, tip) => `<button type="button" class="btn" data-act="mrDo" data-v="${act}" data-tooltip="${esc(tip)}">${esc(label)}</button>`;
  return `<section class="addbox"><h3>${n} nó(s) selecionado(s)</h3>
    <span class="lab">Trecho que chega ao nó</span><div class="actions row">${B("toLine", "Reta", "Transforma o trecho em linha reta")}${B("toCurve", "Curva", "Transforma o trecho em curva (com alças para puxar)")}</div>
    <span class="lab">Tipo do nó</span><div class="actions row">${B("cusp", "Cúspide", "Alças independentes (canto)")}${B("smooth", "Suave", "Alças alinhadas")}${B("sym", "Simétrico", "Alças alinhadas e do mesmo tamanho")}${B("auto", "Automático", "A curva se ajusta sozinha")}</div>
    <div class="actions row">${B("addNode", "Adicionar nó", "No meio do trecho que chega a cada nó selecionado")}${B("breakNode", "Quebrar aqui", "Divide a rota neste nó")}${n === 2 ? B("joinNodes", "Juntar", "Junta duas pontas") + B("lineNodes", "Ligar com reta", "Liga duas pontas com uma reta") : ""}</div>
    <div class="actions row"><button type="button" class="btn danger" data-act="mrDo" data-v="delNode">${ic("trash", 13)} Apagar nó(s)</button></div></section>`;
}
/** Aparência das pontes (rota, várias rotas ou padrão do tipo). field: route | mroute | rs:<tipo> */
function bridgeStyleBox(field, v, mixed = () => false) {
  const isMap = field.startsWith("rs:"); const fa = (k) => isMap ? `data-field="map" data-k="routeStyle.${field.slice(3)}.${k}"` : `data-field="${field}" data-k="${k}"`;
  const sel = (k, list, cur) => `<select ${fa(k)}>${mixed(k) ? `<option value="__" selected>(vários)</option>` : ""}${Object.entries(list).map(([a, b]) => opt(a, b, mixed(k) ? "__" : cur ?? "")).join("")}</select>`;
  const style = v.bStyle || ""; const usesDash = ["tracejado", "linhas", "rota"].includes(style);
  const reset = isMap ? "" : `<button type="button" class="btn" data-act="${field === "route" ? "routeSet" : "mrSet"}" data-k="bColor" data-v="" ${v.bColor ? "" : "disabled"}>Padrão</button>`;
  return `<div class="subbox"><span class="lab">${ic("bridge", 12)} Pontes</span>
    <div class="grid2"><label>Estilo${sel("bStyle", BRIDGE_STYLES, style)}</label><label>Largura ×<input type="number" min="0.3" max="4" step="0.1" ${fa("bWidth")} value="${v.bWidth ?? ""}" placeholder="1"></label></div>
    ${style !== "nenhum" ? `<div class="grid2"><label>Cor<div class="row2"><input type="color" class="colorpick" ${fa("bColor")} value="${esc(v.bColor || (style === "madeira" ? "#8a6a45" : style === "rota" ? "#8a5a2b" : style === "linhas" || style === "tracejado" ? "#e8dcc0" : "#cdbf9f"))}">${reset}</div></label>
      ${usesDash ? `<label>Traço${sel("bDash", { "": style === "tracejado" ? "Tracejado" : "Contínuo", tracejada: "Tracejada", pontilhada: "Pontilhada", tracoponto: "Traço e ponto", solida: "Contínua" }, v.bDash)}</label>` : "<span></span>"}</div>` : ""}</div>`;
}
/** Várias rotas selecionadas: aparência e ações para todas de uma vez. */
function multiRouteForm(ui, ids) {
  const rs = ui.data.routes.filter(r => ids.includes(r.id)).map(normRoute); if (!rs.length) return ""; const f = rs[0]; const same = (k) => rs.every(r => r[k] === f[k]);
  const t = ROUTE_TYPES[f.type]; const grouped = rs.some(r => r.group);
  const oneG = rs[0].group && rs.every(r => r.group === rs[0].group) ? rs[0].group : null; const gname = oneG ? (ui.data.map?.routeGroups?.[oneG]?.name ?? "") : "";
  return `<section class="addbox"><h3>${rs.length} rota(s) selecionada(s)${grouped ? " · grupo" : ""}</h3>${oneG ? `<label>Nome do grupo<input type="text" data-field="rgName" data-g="${oneG}" value="${esc(gname)}" placeholder="Ex.: Ruas do Porto"></label>` : ""}
    <div class="info">Ctrl+clique na lista (ou Shift+clique no mapa) soma ou tira; o retângulo de seleção pega rotas inteiras. O que mudar aqui vale para todas.</div>
    <label>Tipo<select data-field="mrTypeSel">${same("type") ? "" : `<option value="" selected>(vários)</option>`}${Object.entries(ROUTE_TYPES).map(([k, v]) => opt(k, v.label, same("type") ? f.type : "")).join("")}</select></label>
    <span class="lab">Condição</span>${seg("mrCond", Object.entries(ROUTE_CONDITIONS).map(([k, v]) => [k, v.label]), same("cond") ? f.cond : "")}
    <label>Cor do traço<div class="row2"><input type="color" class="colorpick" data-field="mroute" data-k="color" value="${f.color || t.color}"><button type="button" class="btn" data-act="mrColor" data-v="">Padrão</button></div></label>
    <div class="swatches">${["#8a5a2b", "#5a3a1a", "#c9a227", "#e8dcc0", "#2a6fb0", "#3f8f4a", "#c0392b", "#1b1610"].map(c => `<button type="button" class="sw ${same("color") && f.color === c ? "on" : ""}" data-act="mrColor" data-v="${c}" style="background:${c}" aria-label="${c}"></button>`).join("")}</div>
    ${slider("mroute", "opacity", "Opacidade", f.opacity, 0.05, 1, 0.05, "%")}
    ${slider("mroute", "width", "Espessura", f.width, 0.3, 5, 0.1, "×")}
    <div class="grid2"><label>Traço<select data-field="mroute" data-k="dash">${same("dash") ? "" : `<option value="__" selected>(vários)</option>`}${Object.entries(ROUTE_DASH).map(([k, v]) => opt(k, v, same("dash") ? f.dash : "__")).join("")}</select></label>
      <label>Contorno<select data-field="mroute" data-k="outline"><option value="">padrão do tipo</option><option value="1" ${same("outline") && f.outline === true ? "selected" : ""}>com contorno</option><option value="0" ${same("outline") && f.outline === false ? "selected" : ""}>sem contorno</option></select></label></div>
    ${bridgeStyleBox("mroute", f, (k) => !same(k))}
    <label class="check"><input type="checkbox" data-field="mroute" data-k="hidden" ${rs.every(r => r.hidden) ? "checked" : ""}> Ocultas dos jogadores</label>
    <label class="check"><input type="checkbox" data-field="mroute" data-k="locked" ${rs.every(r => r.locked) ? "checked" : ""}> Fixas (travadas)</label>
    <div class="actions row">${rs.length >= 2 ? `<button type="button" class="btn" data-act="mrDo" data-v="combine" data-tooltip="Une as rotas pelas pontas mais próximas">Combinar</button><button type="button" class="btn" data-act="mrDo" data-v="group">Agrupar</button>` : ""}${grouped ? `<button type="button" class="btn" data-act="mrDo" data-v="ungroup">Desagrupar</button>` : ""}${ui.routeClip ? `<button type="button" class="btn" data-act="routePasteAll">Colar aparência</button>` : ""}</div>
    <div class="actions row"><button type="button" class="btn danger" data-act="mrDo" data-v="delRoutes">${ic("trash", 13)} Apagar</button><button type="button" class="btn grow" data-act="clearMulti">Limpar seleção</button></div></section>`;
}
/** Categoria e subtipo de local (o subtipo decide o ícone). */
function kindPick(cur, kindAttrs, catField) {
  const c = catOf(cur); const cats = Object.entries(POI_CATS);
  return `<div class="grid2"><label>Categoria<select data-field="${catField}">${cats.map(([k, v]) => opt(k, v.label, c)).join("")}</select></label>
    <label>Subtipo<select ${kindAttrs}>${POI_CATS[c].kinds.map(k => opt(k, POI_KINDS[k]?.label ?? k, cur)).join("")}</select></label></div>`;
}
const tpOn = () => { try { return !!game.settings.get("brumas-atlas", "teleport"); } catch (e) { return false; } };
const DIRG = { both: "↔", out: "→", in: "←" };
const DIRT = { both: "Mão dupla: clique para só ir daqui", out: "Só daqui para lá: clique para só vir de lá", in: "Só de lá para cá: clique para mão dupla" };
/** Ligações de um portal (no cartão de edição): sentido e remover. */
function portalLinksHtml(ui, p) {
  const L = portalLinks(ui.scene, p.id).map(l => ({ ...l, q: dataOf(l.scene).pois.find(x => x.id === l.poi) })).filter(l => l.q);
  if (!L.length) return `<p class="muted">Nenhuma ligação ainda.</p>`;
  return `<div class="tplinks">${L.map(l => { const dir = l.out && l.in ? "both" : l.out ? "out" : "in"; const at = l.remote ? `data-s="${l.scene.id}" data-d="${l.poi}"` : `data-r="${l.route}"`;
    return `<div class="row"><button type="button" class="btn quiet" data-act="tpDir" data-id="${p.id}" ${at} data-tooltip="${DIRT[dir]}">${DIRG[dir]}</button><span class="grow">${esc(l.q.name ?? "Portal")}${l.remote ? ` <small>· ${esc(l.scene.navName || l.scene.name)}</small>` : ""}</span><button type="button" class="icon" data-act="tpUnlink" data-id="${p.id}" ${at} aria-label="Desfazer ligação" data-tooltip="Desfazer ligação">${ic("close", 11)}</button></div>`; }).join("")}</div>`;
}
/** Ligar a um portal de outro mapa. */
function portalRemoteHtml(ui, p) {
  const T = ui.tpR ?? {}; const maps = mapScenes().filter(s => s.id !== ui.scene.id); if (!maps.length) return "";
  const ts = T.scene ? game.scenes.get(T.scene) : null; const ps = ts ? dataOf(ts).pois.filter(x => x.kind === "circulo") : [];
  return `<span class="lab">Ligar a um portal de outro mapa</span>
    <div class="grid2"><label>Mapa<select data-field="tpR" data-k="scene"><option value="">—</option>${maps.map(s => opt(s.id, s.navName || s.name, T.scene)).join("")}</select></label>
    ${ts ? (ps.length ? `<label>Portal<select data-field="tpR" data-k="poi"><option value="">—</option>${ps.map(x => opt(x.id, x.name ?? "Portal", T.poi)).join("")}</select></label>` : `<p class="muted">Esse mapa ainda não tem portais.</p>`) : ""}</div>
    ${T.scene && T.poi ? `<div class="actions row"><button type="button" class="btn grow" data-act="tpRAdd" data-id="${p.id}">${ic("portal", 13)} Ligar (mão dupla)</button></div>` : ""}`;
}
/** Grava (ou desfaz, com dir null) a ligação entre portais de mapas diferentes, nos dois portais. dir é visto do primeiro. */
async function setRemote(sA, idA, sB, idB, dir) {
  const inv = { both: "both", out: "in", in: "out" };
  const put = (sc, id, other, oid, d) => mutateData(sc, (D) => { const P = D.pois.find(x => x.id === id); if (!P) return []; P.remote = (P.remote ?? []).filter(l => !(l.scene === other && l.poi === oid)); if (d) P.remote.push({ scene: other, poi: oid, dir: d }); return ["pois"]; });
  await put(sA, idA, sB.id, idB, dir); await put(sB, idB, sA.id, idA, dir ? inv[dir] : null);
}
/** Condições de um portal (item-chave, senha, lua, dia ou noite). */
const tpCondHtml = (at, o) => `<span class="lab">Condições para abrir</span>
  <div class="grid2"><label>Item-chave <span class="hint" data-tooltip="Alguém do grupo (ou o veículo) precisa ter um item com esse nome.">?</span><input type="text" ${at("tpKey")} value="${esc(o.tpKey)}" placeholder="—"></label>
  <label>Senha <span class="hint" data-tooltip="Os jogadores digitam ao usar o portal; depois de acertar, o grupo lembra.">?</span><input type="text" ${at("tpPw")} value="${esc(o.tpPw)}" placeholder="—"></label></div>
  <div class="grid2"><label>Lua<select ${at("tpMoon")}>${[["", "Qualquer"], ["cheia", "Só na cheia"], ["nova", "Só na nova"], ["crescente", "Crescente"], ["minguante", "Minguante"]].map(([k, l]) => opt(k, l, o.tpMoon)).join("")}</select></label>
  <label>Hora<select ${at("tpTime")}>${[["", "Qualquer"], ["dia", "Só de dia"], ["noite", "Só à noite"]].map(([k, l]) => opt(k, l, o.tpTime)).join("")}</select></label></div>`;
function routeForm(ui) {
  const r = normRoute(ui.data.routes.find(x => x.id === ui.selRoute) ?? {}); const t = ROUTE_TYPES[r.type]; const modes = r.modes ?? t.modes;
  if (r.type === "portal") { const nm = (id) => esc(ui.data.pois.find(p => p.id === id)?.name ?? "Portal"); const A = nm(r.a), B = nm(r.b);
    return `<section class="addbox"><h3>${ic("portal", 14)} Ligação de portais</h3><p class="big">${A} ${r.oneway ? "→" : "↔"} ${B}</p>
      ${seg("portalDir", [["both", "Mão dupla"], ["ab", `Só ${A} → ${B}`], ["ba", `Só ${B} → ${A}`]], r.oneway ? "ab" : "both")}
      <div class="info">A ligação é sempre uma linha reta e só aparece para você, editando. O ritual, a cor da luz e as condições ficam em cada portal e valem para quem parte dele.</div></section>
      <div class="actions row"><button type="button" class="btn danger" data-act="delete">${ic("trash", 13)} Desfazer ligação</button><button type="button" class="btn grow" data-act="routeBack">Pronto</button></div>`; }
  const sc = scaleOf(ui.scene); const pois = ui.data.pois; const nm = (id) => pois.find(p => p.id === id)?.name;
  let len = 0; for (let i = 1; i < r.points.length; i++) len += Math.hypot(r.points[i][0] - r.points[i - 1][0], r.points[i][1] - r.points[i - 1][1]); len *= sc.perPx;
  const bl = (() => { try { return bridgesOf(ui.scene).filter(b => b.routeId === r.id); } catch (e) { return []; } })(); const nb = bl.filter(b => !b.removed).length;
  const tabs = [["geral", "Geral"], ["aparencia", "Aparência"], ...(bl.length && !["rio", "mar", "aerea", "portal"].includes(r.type) ? [["pontes", `Pontes · ${nb}`]] : []), ["pontos", "Pontos"]];
  const tb = tabs.some(([k]) => k === ui.routeTab) ? ui.routeTab : "geral";
  const parts = { geral: () => `<section><p class="big">${esc(nm(r.a) ?? "bifurcação")} → ${esc(nm(r.b) ?? "bifurcação")}</p>
    <div class="kv3"><div><b>≈ ${esc(fmtUnits(len, sc.units))}</b><small>comprimento</small></div><div><b>${esc(ROUTE_CONDITIONS[r.cond]?.label ?? r.cond)}</b><small>condição</small></div><div><b>×${Number(r.mult ?? t.mult).toFixed(2)}</b><small>velocidade</small></div></div>
    <label>Nome<input type="text" data-field="route" data-k="name" value="${esc(r.name)}" placeholder="${esc(t.label)}"></label>
    <label>Tipo<select data-field="routeTypeSel">${Object.entries(ROUTE_TYPES).filter(([k]) => k !== "portal").map(([k, v]) => opt(k, v.label, r.type)).join("")}</select></label>
    ${r.type === "portal" ? `<section class="addbox"><h3>${ic("portal", 14)} Portal</h3>
      <label class="check"><input type="checkbox" data-field="route" data-k="oneway" ${r.oneway ? "checked" : ""}> Mão única: só vai do primeiro ponto ao último</label>
      <label class="check"><input type="checkbox" data-field="route" data-k="tpShow" ${r.tpShow ? "checked" : ""}> Entrada e saída visíveis para os jogadores</label>
      <label>Tempo do ritual (minutos)<input type="number" min="0" step="1" data-field="route" data-k="ritual" value="${r.ritual}"></label>
      ${tpCondHtml((k) => `data-field="route" data-k="${k}"`, r)}
      <div class="info">O caminho do portal não aparece no mapa; a entrada e a saída você sempre vê (e os jogadores, se marcado acima). Na viagem, o grupo que passa por ele some numa coluna de luz e reaparece na saída. A cor da luz é a cor da rota (aba Aparência).${tpOn() ? "" : " O teleporte está desligado nas configurações do módulo."}</div></section>` : ""}
    <span class="lab">Condição</span>${seg("routeCond", Object.entries(ROUTE_CONDITIONS).map(([k, v]) => [k, v.label]), r.cond)}
    ${modesSeg("routeMode", modes)}
    <div class="grid2"><label>Velocidade ×<input type="number" step="0.05" min="0.1" data-field="route" data-k="mult" value="${r.mult ?? ""}" placeholder="${t.mult}"></label></div>
  </section><section><h3>Visibilidade</h3>
    <label class="check"><input type="checkbox" data-field="route" data-k="hidden" ${r.hidden ? "checked" : ""}> Oculta dos jogadores</label>
    ${globeOf(ui.scene) ? `<label class="check" data-tooltip="Segue o círculo máximo entre os pontos, como um voo de verdade: no mapa vira uma curva puxada para o polo e pode passar pela borda. Ligado por padrão nas rotas aéreas."><input type="checkbox" data-field="route" data-k="gc" ${isGc(r, globeOf(ui.scene)) ? "checked" : ""}> Caminho mais curto sobre o globo</label>` : ""}
    <label class="check"><input type="checkbox" data-field="route" data-k="locked" ${r.locked ? "checked" : ""}> ${ic("lock", 13)} Fixa (travada): os pontos não podem ser arrastados nem apagados</label>
    </section>`, aparencia: () => `<section><h3>Aparência</h3>
    <div class="actions row"><button type="button" class="btn" data-act="routeCopy">${ic("layers", 13)} Copiar aparência</button><button type="button" class="btn" data-act="routePaste" ${ui.routeClip ? "" : "disabled"} data-tooltip="${ui.routeClip ? "Aplica a aparência copiada nesta rota" : "Copie a aparência de outra rota primeiro"}">Colar aparência</button>${ui.routeClip && ui.multi?.some(x => x.kind === "routes") ? `<button type="button" class="btn" data-act="routePasteAll">Colar nas selecionadas</button>` : ""}</div>
    <label>Cor do traço<div class="row2"><input type="color" class="colorpick" data-field="route" data-k="color" value="${r.color || t.color}"><button type="button" class="btn" data-act="routeColor" data-v="" ${r.color ? "" : "disabled"}>Padrão</button></div></label>
    <div class="swatches">${["#8a5a2b", "#5a3a1a", "#c9a227", "#e8dcc0", "#2a6fb0", "#3f8f4a", "#c0392b", "#1b1610"].map(c => `<button type="button" class="sw ${r.color === c ? "on" : ""}" data-act="routeColor" data-v="${c}" style="background:${c}" aria-label="${c}"></button>`).join("")}</div>
    ${slider("route", "opacity", "Opacidade", r.opacity, 0.05, 1, 0.05, "%")}
    ${slider("route", "width", "Espessura", r.width, 0.3, 5, 0.1, "×")}
    <div class="grid2"><label>Traço<select data-field="route" data-k="dash">${Object.entries(ROUTE_DASH).map(([k, v]) => opt(k, v, r.dash)).join("")}</select></label>
      <label>Tamanho dos traços ×<input type="number" min="0.2" max="6" step="0.1" data-field="route" data-k="dashScale" value="${r.dashScale}"></label></div>
    <label class="check"><input type="checkbox" data-field="route" data-k="outline" ${(r.outline ?? (["estrada", "rua"].includes(r.type) && !r.color)) ? "checked" : ""}> Contorno (borda clara por baixo)</label>
    ${(r.outline ?? (["estrada", "rua"].includes(r.type) && !r.color)) ? `<div class="grid2"><label>Cor do contorno<input type="color" class="colorpick" data-field="route" data-k="outlineColor" value="${r.outlineColor || "#efe3c4"}"></label><label>Largura do contorno (px)<input type="number" min="0.5" max="20" step="0.5" data-field="route" data-k="outlineWidth" value="${r.outlineWidth}"></label></div>` : ""}
    <label class="check"><input type="checkbox" data-field="route" data-k="showName" ${r.showName ? "checked" : ""}> Mostrar o nome ao longo da rota</label>
    ${["rio", "mar", "aerea", "portal"].includes(r.type) ? "" : bridgeStyleBox("route", r)}
    ${r.showName ? `<div class="grid2"><label>Tamanho do nome ×<input type="number" min="0.4" max="4" step="0.1" data-field="route" data-k="nameSize" value="${r.nameSize}"></label><label>Cor do nome<input type="color" class="colorpick" data-field="route" data-k="nameColor" value="${r.nameColor || r.color || t.color}"></label></div>` : ""}
  </section>`, pontes: () => bridgeList(ui, r), pontos: () => pointEditor(ui, r) };
  return `<div class="subtabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" aria-selected="${tb === k}" class="${tb === k ? "on" : ""}" data-act="routeTab" data-v="${k}">${l}</button>`).join("")}</div>
  <div class="poitab">${parts[tb]()}</div>
  <div class="actions row"><button type="button" class="btn danger" data-act="delete">${ic("trash", 13)} Apagar rota</button><button type="button" class="btn grow" data-act="routeBack">Pronto</button></div>`;
}
/** Pontes desta rota (onde cruza rio ou água): o mestre quebra ou conserta. */
function bridgeList(ui, r) {
  let list = []; try { list = bridgesOf(ui.scene).filter(b => b.routeId === r.id); } catch (e) { /* */ }
  if (!list.length || ROUTE_TYPES[r.type] && ["rio", "mar", "aerea", "portal"].includes(r.type)) return "";
  const id = (b) => esc(`${b.routeId}|${b.key}`);
  return `<section><h3>Pontes · ${list.filter(b => !b.removed).length}</h3>${list.map((b, i) => `<div class="slot ${b.removed ? "off" : ""}"><span class="ava">${ic("bridge", 15)}</span><div class="grow"><b>Ponte ${i + 1}</b><small>${b.removed ? "Sem ponte aqui" : b.broken ? "Quebrada: ninguém passa por terra" : "Inteira"}</small></div>
    <button type="button" class="icon" data-act="bridgeGo" data-x="${Math.round(b.x)}" data-y="${Math.round(b.y)}" aria-label="Mostrar">${ic("target", 13)}</button>
    ${b.removed ? `<button type="button" class="btn" data-act="bridgeSet" data-v="inteira" data-id="${id(b)}">Pôr ponte</button>`
      : `<button type="button" class="btn ${b.broken ? "gold" : "danger"}" data-act="bridgeToggle" data-id="${id(b)}">${b.broken ? "Consertar" : "Quebrar"}</button><button type="button" class="icon" data-act="bridgeSet" data-v="nenhuma" data-id="${id(b)}" data-tooltip="Não é ponte (tirar)" aria-label="Tirar a ponte">${ic("close", 12)}</button>`}</div>`).join("")}
    <small class="muted">Pontes aparecem sozinhas onde a rota cruza um rio, uma Região de água ou um canal entre fundações. Também dá para clicar na ponte no mapa.</small></section>`;
}
/** Ponto selecionado da rota: ângulo e alças, como num editor de vetores. */
function pointEditor(ui, r) {
  const i = ui.selPt; const n = r.points.length;
  const hint = `<small class="muted">${n} pontos <span class="hint" data-tooltip="Clique num ponto para curvar; arraste as alças (Alt quebra a simetria). Duplo clique na rota insere um ponto; botão direito num ponto o apaga.">?</span></small>`;
  if (i == null || !r.points[i]) return `<section><h3>Pontos e curvas</h3>${hint}</section>`;
  const h = r.handles?.[i]; const hv = handleVecs(r.points, r.handles, i);
  const ang = h ? h.a : Math.round(Math.atan2(hv.outV[1], hv.outV[0]) * 1800 / Math.PI) / 10; const l1 = h ? h.l1 : Math.round(Math.hypot(...hv.inV)), l2 = h ? h.l2 : Math.round(Math.hypot(...hv.outV));
  const f = (k) => `data-field="rpt" data-k="${k}"`;
  return `<section><h3>Ponto ${i + 1} de ${n}</h3>
    <div class="seg mini"><button type="button" class="${!h ? "on" : ""}" data-act="rptMode" data-v="auto">Automático</button><button type="button" class="${h && !(h.l1 === 0 && h.l2 === 0) && h.a2 == null ? "on" : ""}" data-act="rptMode" data-v="suave">Suave</button><button type="button" class="${h?.a2 != null ? "on" : ""}" data-act="rptMode" data-v="quebrado">Quebrado</button><button type="button" class="${h && h.l1 === 0 && h.l2 === 0 ? "on" : ""}" data-act="rptMode" data-v="canto">Canto</button></div>
    <label>Ângulo da inclinação (°)<div class="row2"><input type="range" min="-180" max="180" step="1" ${f("a")} value="${ang}"><input type="number" class="num" min="-180" max="180" step="0.5" ${f("a")} value="${ang}"></div></label>
    ${h?.a2 != null ? `<label>Ângulo da saída (°)<div class="row2"><input type="range" min="-180" max="180" step="1" ${f("a2")} value="${h.a2}"><input type="number" class="num" min="-180" max="180" step="0.5" ${f("a2")} value="${h.a2}"></div></label>` : ""}
    <div class="grid2"><label>Alça de entrada (px)<input type="number" min="0" step="5" ${f("l1")} value="${l1}" ${i === 0 ? "disabled" : ""}></label><label>Alça de saída (px)<input type="number" min="0" step="5" ${f("l2")} value="${l2}" ${i === n - 1 ? "disabled" : ""}></label></div>
    <div class="actions row"><button type="button" class="btn" data-act="rptPrev" ${i === 0 ? "disabled" : ""}>${ic("back", 13)} Anterior</button><button type="button" class="btn" data-act="rptNext" ${i === n - 1 ? "disabled" : ""}>Próximo</button><button type="button" class="btn danger" data-act="rptDel" ${n <= 2 ? "disabled" : ""}>${ic("trash", 13)}</button></div>
    ${hint}</section>`;
}
/** Controle deslizante com número ao lado. */
function slider(field, k, label, v, min, max, step, unit = "", def = 1) {
  const shown = unit === "%" ? Math.round(v * 100) : v;
  return `<label>${esc(label)}<div class="row2"><input type="range" min="${min}" max="${max}" step="${step}" data-field="${field}" data-k="${k}" value="${v}"><span class="rv">${shown}${unit === "%" ? "%" : unit}</span><button type="button" class="rreset" data-def="${def}" title="Voltar ao padrão (${def})" aria-label="Voltar ao padrão">↺</button></div></label>`;
}
function labelForm(ui) {
  const l = ui.data.labels.find(x => x.id === ui.selLabel) ?? {}; const f = (k) => `data-field="label" data-k="${k}"`; const st = labelStyle(l);
  const cur = LABEL_STYLES[l.style] ? l.style : (l.color ? "local" : "antigo");
  const rng = (k, label, v, min, max, step, fmt) => `<label class="wop">${label} <span class="rv">${fmt(v)}</span><input type="range" min="${min}" max="${max}" step="${step}" ${f(k)} value="${v}" data-fmt="${k}"></label>`;
  return `<section><h3>Rótulo</h3><label>Texto <span class="hint" data-tooltip="Palavras curtas leem melhor no mapa. Use | (ou Enter) para quebrar em duas linhas.">?</span><textarea rows="2" ${f("text")}>${esc(l.text ?? "")}</textarea></label>
    <span class="lab">Estilo</span>${seg("labelStyle", Object.entries(LABEL_STYLES).map(([k, v]) => [k, v.label]), cur)}
    <div class="grid2"><label>Tamanho<input type="number" min="8" max="120" ${f("size")} value="${l.size ?? 18}"></label><label>Ângulo<input type="number" min="-180" max="180" ${f("rot")} value="${l.rot ?? 0}"></label></div>
    <div class="grid2"><label>Cor do texto<input type="color" class="colorpick" ${f("color")} value="${esc(/^#[0-9a-f]{6}$/i.test(st.col) ? st.col : "#ffffff")}"></label><label>Cor da borda<input type="color" class="colorpick" ${f("ol")} value="${esc(/^#[0-9a-f]{6}$/i.test(st.ol) ? st.ol : "#000000")}"></label></div>
    ${rng("ow", "Borda", st.ow, 0, 8, 0.5, v => `${v}px`)}${rng("sp", "Espaço entre letras", st.sp, 0, 0.8, 0.02, v => `${Math.round(v * 100)}%`)}${rng("op", "Opacidade", st.op, 0.1, 1, 0.05, v => `${Math.round(v * 100)}%`)}
    <div class="grid2"><label class="check"><input type="checkbox" ${f("it")} ${st.it ? "checked" : ""}> Itálico</label><label class="check"><input type="checkbox" ${f("up")} ${st.up ? "checked" : ""}> MAIÚSCULAS</label></div>
    <label class="swrow"><span class="grow">Correr por uma curva <span class="hint" data-tooltip="O texto segue uma linha curva. No modo edição, arraste as pontas (círculos) e as alças (quadrados) para dobrar a linha.">?</span></span><input type="checkbox" class="switch" ${f("curve")} ${l.curve ? "checked" : ""}></label>
    ${l.curve ? `<div class="actions row"><button type="button" class="btn" data-act="labelStraight">Endireitar a curva</button><button type="button" class="btn" data-act="labelArc">Arco suave</button></div>` : ""}
    <label class="check"><input type="checkbox" ${f("locked")} ${l.locked ? "checked" : ""}> ${ic("lock", 13)} Fixo (travado)</label></section>
  <div class="actions row"><button type="button" class="btn danger" data-act="delete">${ic("trash", 13)} Apagar</button><button type="button" class="btn grow" data-act="deselect">Pronto</button></div>`;
}
/** Curva inicial de um rótulo: do tamanho do texto, no ângulo dele; arc = quanto ela se dobra (0 = reta). */
function labelCurve(l, arc = 0.18) {
  const n = String(l.text ?? "").replace(/\s*\|\s*/g, " ").length || 6; const L = Math.max(80, (l.size ?? 18) * n * 0.8 * (1 + (labelStyle(l).sp || 0) * 2)); const a = (l.rot ?? 0) * Math.PI / 180;
  const R = (x, y) => [Math.round(x * Math.cos(a) - y * Math.sin(a)), Math.round(x * Math.sin(a) + y * Math.cos(a))]; const h = -L * arc;
  return [R(-L / 2, 0), R(-L / 6, h), R(L / 6, h), R(L / 2, 0)];
}
function moverForm(ui) {
  const m = normMover(ui.data.movers.find(x => x.id === ui.selMover) ?? {}); const f = (k) => `data-field="mover" data-k="${k}"`;
  return `<section><h3>Elemento móvel</h3><label>Nome<input type="text" ${f("name")} value="${esc(m.name)}"></label>
    <span class="lab">Tipo</span>${seg("moverKind", Object.entries(MOVER_KINDS).map(([k, v]) => [k, v.label]), m.kind)}
    <label>Retrato<div class="row2"><input type="text" ${f("img")} value="${esc(m.img)}"><button type="button" class="btn" data-act="pickImg" data-f="mover.img">${ic("search", 13)}</button></div></label>
    ${dropZone("Actor", "mover.actor", m.actor, "Arraste um ator (usa nome e retrato)")}
    <div class="grid2"><label>Cor<input type="text" ${f("color")} value="${esc(m.color)}" placeholder="${esc(MOVER_KINDS[m.kind].color)}"></label><label>Horas de marcha hoje<input type="number" min="0" step="0.5" ${f("today")} value="${m.today}"></label></div>
    <label class="check"><input type="checkbox" ${f("main")} ${m.main ? "checked" : ""}> Grupo principal (viaja por padrão)</label>
    <label class="check"><input type="checkbox" ${f("hidden")} ${m.hidden ? "checked" : ""}> Oculto dos jogadores</label>
    <label class="check"><input type="checkbox" ${f("locked")} ${m.locked ? "checked" : ""}> ${ic("lock", 13)} Fixo (travado): só se move viajando</label></section>
  <div class="actions row"><button type="button" class="btn danger" data-act="delete">${ic("trash", 13)} Apagar</button><button type="button" class="btn grow" data-act="deselect">Pronto</button></div>`;
}
/** "Quem passa": a pé, montaria e veículos (terrestre, aquático, aéreo, espacial). */
function modesSeg(act, cur, extra = "") {
  const b = (k) => `<button type="button" data-act="${act}" data-v="${k}" ${extra} class="${cur.includes(k) ? "on" : ""}">${esc(MODES[k].short ?? MODES[k].label)}</button>`;
  return `<span class="lab">Quem passa</span><div class="seg multi">${b("pe")}${b("montaria")}</div><span class="lab">Veículos</span><div class="seg multi">${b("carruagem")}${b("barco")}${b("voo")}${b("espaco")}</div>`;
}
function zoneCard(ui, r) {
  const z = zoneOf(r); const f = r.flags?.[MODULE_ID]?.zone ?? {}; const k = (x) => `data-field="zone" data-r="${r.id}" data-k="${x}"`;
  return `<section class="zonecard">    <div class="grid2"><label>Terreno<select ${k("preset")}>${opt("", "Pelo nome", f.preset ?? "")}${opt("none", "Ignorar", f.preset)}${Object.entries(ZONE_PRESETS).map(([pk, pv]) => opt(pk, pv.label, f.preset)).join("")}</select></label>
      <label>Velocidade ×<input type="number" step="0.05" min="0.1" ${k("mult")} value="${f.mult ?? ""}" placeholder="${z?.mult ?? 1}"></label></div>
    ${z ? `<div class="grid2"><label>Encontro<div class="row2"><input type="number" min="0" ${k("cn")} value="${z.chance[0]}"><span>em</span><input type="number" min="1" ${k("cd")} value="${z.chance[1]}"></div></label>
      <label>Bioma (acampamento)<input type="text" ${k("biome")} value="${esc(z.biome)}"></label></div>
      ${dropZone("RollTable", `zone:${r.id}`, z.table, "Tabela de encontros")}
      ${modesSeg("zoneMode", z.modes ?? zoneDefaultModes(z), `data-r="${r.id}"`)}<div class="row2"><small class="muted grow">${z.modes ? "Escolhido por você: quem não está marcado não entra." : "Padrão do terreno."}</small>${z.modes ? `<button type="button" class="btn sm" data-act="zoneModeReset" data-r="${r.id}">Padrão</button>` : ""}</div>` : ""}
    ${zoneWxForm(r)}</section>`;
}
/** Clima próprio do terreno: fica sempre assim, sem depender do clima do mapa. */
function zoneWxForm(r) {
  const f = r.flags?.[MODULE_ID]?.wx ?? {}; const Z = ZONE_WX[f.kind]; const k = (x) => `data-field="zonewx" data-r="${r.id}" data-k="${x}"`;
  return `<h3>Clima próprio <span class="hint" data-tooltip="Névoa, chuva, tempestade, neve, frio ou calor que ficam sempre nesta Região. Aparece no mapa, vale para os locais dentro dela e para os mapas filhos desses locais (menos os abrigados).">?</span></h3>
    <div class="grid2"><label>Clima<select ${k("kind")}>${opt("", "O do mapa", f.kind ?? "")}${Object.entries(ZONE_WX).map(([kk, v]) => opt(kk, v.label, f.kind)).join("")}</select></label>
      ${Z ? `<label>Temperatura (°C)<input type="number" ${k("temp")} value="${f.temp ?? ""}" placeholder="${Z.temp ?? "a do mapa"}"></label>` : ""}</div>
`;
}
function mapForm(ui) {
  const m = ui.data.map ?? {}; const f = (k) => `data-field="map" data-k="${k}"`;
  const chk = (k, label, v) => `<label class="swrow"><span class="grow">${label}</span><input type="checkbox" class="switch" ${f(k)} ${v ? "checked" : ""}></label>`;
  return `<section><h3>Este mapa</h3>
    <label>Título<input type="text" ${f("title")} value="${esc(m.title ?? "")}" placeholder="${esc(ui.scene.name)}"></label>
    <div class="grid2"><label>Nível<select ${f("level")}>${Object.entries(LEVELS).map(([k, v]) => opt(k, v.label, m.level)).join("")}</select></label>
      <label>Mapa pai<select ${f("parent")}><option value="">—</option>${mapScenes().filter(s => s.id !== ui.scene.id).map(s => opt(s.id, s.name, m.parent)).join("")}</select></label></div>
    <label>Viagem em etapas de <span class="hint" data-tooltip="A cada etapa (tempo de jogo) o grupo para e o mestre decide como continuar. Ex.: de hora em hora.">?</span><select ${f("travelStep")}>${Object.entries(STEPS).map(([k, v]) => opt(k, v, String(m.travelStep ?? "dia"))).join("")}</select></label>
    <details class="wnames" ${ui._readOpen ? "open" : ""} data-readd><summary>Leitura do mapa (menos poluição)</summary>
    <label>Nomes dos pontos no mapa<select ${f("labels")}>${Object.entries(LABEL_MODES).map(([k, v]) => opt(k, v, m.labels ?? "sempre")).join("")}</select></label>
    ${(() => { const r = m.read ?? {}; const rg = (k, l, v, a, b, st, fmt) => `<label class="wop">${l} <span class="rv">${fmt(v)}</span><input type="range" min="${a}" max="${b}" step="${st}" ${f(`read.${k}`)} value="${v}" data-fmt="${fmt === pct ? "pct" : "x"}"></label>`;
      const pct = (v) => `${Math.round(v * 100)}%`, xx = (v) => `${Number(v).toFixed(1)}×`;
      return rg("poiScale", "Tamanho dos ícones", r.poiScale ?? 1, 0.3, 2, 0.05, pct) + rg("poiOpacity", "Opacidade dos ícones", r.poiOpacity ?? 1, 0.1, 1, 0.05, pct)
        + rg("labelOpacity", "Opacidade dos rótulos", r.labelOpacity ?? 1, 0.1, 1, 0.05, pct)
        + rg("nearK", `"De perto" a partir de <span class="hint" data-tooltip="Quanto aproximar, em relação ao mapa inteiro na tela, para mostrar o que é só de perto.">?</span>`, r.nearK ?? 2, 1, 8, 0.25, xx)
        + chk("read.labelDetail", "Rótulos pequenos (local, rio, antigo) só de perto", !!r.labelDetail)
        + chk("read.minorNear", "Locais menores só de perto (vilas, portos, lugares naturais; entradas de outros mapas ficam sempre)", !!r.minorNear); })()}
    <small class="muted">Os ícones voltam à opacidade total ao passar o mouse. Os nomes das unidades seguem a configuração do módulo "Nomes das unidades".</small></details>
    ${northField(ui)}
    <div class="actions row"><button type="button" class="btn" data-act="roseMap">${ic("compass", 14)} Rosa dos ventos deste mapa${m.roseCfg?.own ? " (própria)" : ""}</button></div>
    ${m.roseAt ? `<div class="actions row"><button type="button" class="btn" data-act="roseCorner">${ic("compass", 14)} Rosa: voltar ao canto da cena</button></div>` : ""}</section>
  <section><h3>Tamanho real por tipo <span class="hint" data-tooltip="O tamanho real é ajustado em cada ponto (Pontos › editar o local). Aqui fica só um padrão por tipo, usado pelos pontos que não têm o seu. Em quadros (${esc(scaleOf(ui.scene).dist)} ${esc(scaleOf(ui.scene).units)} cada); vazio = sem padrão.">?</span></h3>
    <div class="grid3">${Object.keys(POI_KINDS).filter(k => ui.data.pois.some(p => (p.kind ?? "local") === k) || m.realSize?.[k]).map(k => `<label>${esc(POI_KINDS[k].label)}<input type="number" min="0" step="0.1" ${f(`realSize.${k}`)} value="${m.realSize?.[k] ?? ""}" placeholder="—"></label>`).join("")}</div>
    <div class="actions row"><button type="button" class="btn danger" data-act="unmap">Deixar de ser mapa</button></div></section>`;
}
/** Aparência padrão das rotas deste mapa, por tipo (cada rota pode mudar a sua). */
function routeStyleSection(ui) {
  const m = ui.data.map ?? {}; const type = ROUTE_TYPES[ui.rsType] ? ui.rsType : "estrada"; const t = ROUTE_TYPES[type]; const st = m.routeStyle?.[type] ?? {};
  const f = (k) => `data-field="map" data-k="routeStyle.${type}.${k}"`;
  return `<section><h3>Aparência padrão das rotas <span class="hint" data-tooltip="Vale para as rotas deste tipo que não têm aparência própria. Na edição de cada rota dá para mudar só a dela.">?</span></h3>
    <div class="seg">${Object.entries(ROUTE_TYPES).map(([k, v]) => `<button type="button" class="${k === type ? "on" : ""}" data-act="rsType" data-v="${k}">${esc(v.label)}</button>`).join("")}</div>
    <div class="grid2"><label>Cor<input type="color" class="colorpick" ${f("color")} value="${esc(st.color || t.color)}"></label>
      <label>Espessura ×<input type="number" min="0.3" max="5" step="0.1" ${f("width")} value="${st.width ?? ""}" placeholder="1"></label></div>
    <div class="grid2"><label>Traço<select ${f("dash")}>${opt("", "Do tipo", st.dash ?? "")}${Object.entries(ROUTE_DASH).filter(([k]) => k).map(([k, v]) => opt(k, v, st.dash)).join("")}</select></label>
      <label>Opacidade<input type="number" min="0.05" max="1" step="0.05" ${f("opacity")} value="${st.opacity ?? ""}" placeholder="1"></label></div>
    <div class="grid2"><label>Contorno<select ${f("outline")}>${opt("", "Do tipo", st.outline === true ? "1" : st.outline === false ? "0" : "")}${opt("1", "Com contorno", st.outline === true ? "1" : "")}${opt("0", "Sem contorno", st.outline === false ? "0" : "")}</select></label>
      <label>Cor do contorno<input type="color" class="colorpick" ${f("outlineColor")} value="${esc(st.outlineColor || "#efe3c4")}"></label></div>
    ${["rio", "mar", "aerea", "portal"].includes(type) ? "" : bridgeStyleBox(`rs:${type}`, st)}
    <div class="actions row">${ui.routeClip ? `<button type="button" class="btn" data-act="rsFromClip">Usar a aparência copiada</button>` : ""}<button type="button" class="btn" data-act="rsReset" ${Object.keys(st).length ? "" : "disabled"}>Voltar ao padrão do Atlas</button></div>
</section>`;
}
function northField(ui) {
  const w = normWeather(ui.data.weather); const v = w.rose.north > 180 ? w.rose.north - 360 : w.rose.north; const f = `data-field="wx" data-k="rose.mapNorth"`;
  return `<label>Norte do mapa (°) <span class="hint" data-tooltip="Se o mapa está inclinado em relação ao norte, gire aqui: a rosa, o vento e as nuvens acompanham.">?</span><div class="row2"><input type="range" min="-180" max="180" step="1" data-live="wx" ${f} value="${v}"><input type="number" class="num" min="-180" max="180" step="1" ${f} value="${v}"><button type="button" class="rreset" data-def="0" title="Voltar ao padrão (0)" aria-label="Voltar ao padrão">↺</button></div></label>
`;
}
/** Névoa do Atlas: liberar, cor e opacidade, ou uma imagem própria por cima (revelando aparece o mapa de baixo). */
export function fogSection(ui) {
  const m = ui.data.map ?? {}; const f = (k) => `data-field="map" data-k="${k}"`; const op = m.fogOpacity == null || m.fogOpacity === "" ? 0.92 : Number(m.fogOpacity);
  return `<section><h3>Névoa</h3>
    <label class="check"><input type="checkbox" ${f("fog")} ${m.fog ? "checked" : ""}> Névoa ligada para os jogadores</label>
    ${m.fog ? `<label>Opacidade <span class="hint" data-tooltip="Em 100% não se vê nada por baixo. Você (mestre) vê a névoa mais clara, conforme o campo Mestre vê a (%).">?</span><div class="row2"><input type="range" min="0.1" max="1" step="0.02" ${f("fogOpacity")} value="${op}"><span class="rv">${Math.round(op * 100)}%</span><button type="button" class="rreset" data-def="0.92" title="Voltar ao padrão (0.92)" aria-label="Voltar ao padrão">↺</button></div></label>
    <div class="grid2"><label>Cor<input type="color" class="colorpick" ${f("fogColor")} value="${m.fogColor || "#1b1d22"}"></label><label>Mestre vê a (%)<input type="number" min="0" max="100" step="5" data-field="fogGm" value="${Math.round(Number(uiPref("fogGm", 0.45)) * 100)}"></label></div>
    <label>Imagem da névoa (ex.: o mesmo mapa sem detalhes)<div class="row2"><input type="text" ${f("fogImg")} value="${esc(m.fogImg ?? "")}" placeholder="sem imagem: usa a cor"><button type="button" class="btn" data-act="pickImg" data-f="map:fogImg" aria-label="Escolher">${ic("search", 13)}</button>${m.fogImg ? `<button type="button" class="btn" data-act="fogImgClear" aria-label="Tirar">${ic("close", 12)}</button>` : ""}</div></label>
    <label>Raio revelado na viagem (células)<input type="number" min="0.5" step="0.5" ${f("reveal")} value="${m.reveal ?? 2}"></label>
    <span class="lab">Pincel (na barra do Atlas, à esquerda)</span>
    <div class="actions row"><button type="button" class="btn ${ui.tool === "revelar" ? "gold" : ""}" data-act="tool" data-v="revelar">${ic("eye", 13)} Revelar</button><button type="button" class="btn ${ui.tool === "cobrir" ? "gold" : ""}" data-act="tool" data-v="cobrir">${ic("eyeoff", 13)} Cobrir</button>
      <label class="inl">Raio<input type="number" class="num" min="0.25" step="0.25" data-field="brush" value="${uiPref("brush", 2)}"></label></div>
    <div class="actions row"><button type="button" class="btn" data-act="fogAll" data-v="reveal">Revelar tudo</button><button type="button" class="btn" data-act="clearFog">Cobrir tudo</button></div>` : ""}</section>`;
}
function panelConfig(ui) {
  const parents = mapScenes();
  return `<section class="cfgcard"><h3>Transformar esta cena em mapa</h3>
    <p class="muted">Locais, rotas e viagens ficam guardados na cena. Paredes, luzes e tokens continuam iguais. Também dá para marcar na Configuração da Cena.</p>
    <div class="grid2"><label>Nível<select data-field="cfg" data-k="level">${Object.entries(LEVELS).map(([k, v]) => opt(k, v.label, ui.cfgDraft?.level ?? "regiao")).join("")}</select></label>
    <label>Mapa pai<select data-field="cfg" data-k="parent"><option value="">—</option>${parents.map(s => opt(s.id, s.name, ui.cfgDraft?.parent)).join("")}</select></label></div>
    <label class="check"><input type="checkbox" data-field="cfg" data-k="fog" ${ui.cfgDraft?.fog ?? true ? "checked" : ""}> Névoa de exploração</label>
    <div class="actions row"><button type="button" class="btn gold grow" data-act="makeMap">Transformar em mapa</button>${(ui.scene.tokens?.size ?? ui.scene.tokens?.length ?? 0) ? `<button type="button" class="btn" data-act="makeMapImport">E importar tokens</button>` : ""}</div></section>`;
}
function panelImport(ui) {
  ui.importRows ??= scanScene(ui.scene); const R = ui.importRows;
  const tag = { poi: ["ok", "Local"], party: ["warn", "Móvel"], dup: ["warn", "Duplicado"], skip: ["off", "Ignorar"] };
  return `<p class="muted">Cada token vira um local. Tokens ocultos entram como Desconhecido. Diários e cenas com o mesmo nome são ligados. Veículos e grupos viram elementos móveis.</p>
    <div class="itable">${R.tokens.map((t, i) => `<div class="irow ${t.take ? "" : "off"}"><input type="checkbox" data-field="imp" data-i="${i}" data-k="take" ${t.take ? "checked" : ""} aria-label="Importar ${esc(t.name)}">
      <div class="grow"><b>${esc(t.name)}</b><small>${esc([t.journalName && `diário ${t.journalName}`, t.sceneName && `cena ${t.sceneName}`, t.actorName && `ator ${t.actorName}`].filter(Boolean).join(" · ") || t.note || "")}</small></div>
      <span class="tag ${tag[t.as][0]}">${tag[t.as][1]}</span>
      ${t.as === "poi" || t.as === "dup" ? `<div class="row2 full"><select data-field="imp" data-i="${i}" data-k="kind">${Object.entries(POI_KINDS).map(([k, v]) => opt(k, v.label, t.kind)).join("")}</select><select data-field="imp" data-i="${i}" data-k="state">${Object.entries(POI_STATES).map(([k, v]) => opt(k, v.label, t.state)).join("")}</select><label class="check"><input type="checkbox" data-field="imp" data-i="${i}" data-k="useImg" ${t.useImg ? "checked" : ""}> imagem</label></div>` : ""}</div>`).join("") || `<p class="muted">Nenhum token na cena.</p>`}</div>
    <section><h3>Regiões</h3>${R.regions.map(r => `<div class="irow"><span class="sw" style="background:${esc(r.color)}"></span><div class="grow"><b>${esc(r.name)}</b><small>${esc(r.note)}</small></div></div>`).join("") || `<p class="muted">Nenhuma.</p>`}</section>
    <label class="check"><input type="checkbox" data-field="impOpt" data-k="hideTokens" ${R.hideTokens ? "checked" : ""}> Ocultar os tokens antigos depois de importar</label>
    ${R.fogCells ? `<label class="check"><input type="checkbox" data-field="impOpt" data-k="fog" ${R.fog ? "checked" : ""}> Trazer as ${R.fogCells} células reveladas do World Explorer</label>` : ""}
    <div class="actions row"><button type="button" class="btn gold grow" data-act="runImport">Importar</button><button type="button" class="btn" data-act="panel" data-p="mapa">Voltar</button></div>`;
}

/* ================= ações ================= */
const CLIMATE_NEXT = { limpo: ["limpo", "limpo", "nublado", "calor"], nublado: ["nublado", "limpo", "chuva", "neblina"], neblina: ["neblina", "nublado", "limpo"], chuva: ["chuva", "nublado", "tempestade"], tempestade: ["chuva", "tempestade", "nublado"], neve: ["neve", "nublado", "nevasca"], nevasca: ["neve", "nevasca"], calor: ["calor", "limpo", "limpo"] };
/** "Mudar com o tempo": gira o vento e varia a força e o clima um pouco. */
export async function rollWeather(sc) {
  const raw = dataOf(sc).weather; const w = normWeather(raw); const rnd = (a, b) => a + Math.random() * (b - a);
  const nx = CLIMATE_NEXT[w.climate] ?? [w.climate]; const climate = nx[Math.floor(Math.random() * nx.length)];
  let force = Math.max(0, Math.min(11, w.force + Math.round(rnd(-2, 2)))); if (climate === "tempestade") force = Math.max(force, 8); if (climate === "neblina") force = Math.min(force, 2);
  await saveWeather(sc, { ...(raw ?? {}), ...w, climate, force, dir: Math.round((w.dir + rnd(-45, 45) + 360) % 360), temp: Math.round(w.temp + rnd(-3, 3)) });
}
async function saveWeather(sc, w) {
  await saveData(sc, { weather: w });
  const nw = normWeather(w); if (nw.fx) { const fx = nw.enabled ? CLIMATES[nw.climate].fx : ""; const ok = !fx || CONFIG.weatherEffects?.[fx]; try { if (sc.weather !== (ok ? fx : "")) await sc.update({ weather: ok ? fx : "" }); } catch (e) { console.warn(e); } }
}

export async function chromeAct(ui, act, ds, el, e) {
  const sc = ui.scene; const gm = game.user.isGM;
  if (act.startsWith("g") && await groupAct(ui, act, ds, el, e)) return;
  switch (act) {
    case "gOpen": selectGroup(ui, ds.id, "viagem"); { const m = ui.data.movers.find(x => x.id === ds.id); if (m) canvas.animatePan?.({ x: m.x, y: m.y, duration: 400 }); } return;
    case "panel": if (ds.p === "clima") { ui.natTab = "clima"; ds = { ...ds, p: "natureza" }; } ui.panel = ds.p || "mapa"; ui.tool = "sel"; ui.drawing = null; ui.selLabel = null; if (ui.panel === "import") ui.importRows = null; ui.refresh(); return;
    case "undo": if (await undoAtlas()) { ui.cache.plans = {}; ui.refresh(); } return;
    case "dockClose": globalThis.ui?.atlas?.setOpen?.(false); return;
    case "popDock": globalThis.ui?.atlas?.pop?.(ds.v); return;
    case "poiBack": ui.sel = null; ui.poiEdit = false; ui.refresh(); return;
    case "poiMode": ui.poiEdit = ds.v === "1"; ui.refresh(); return;
    case "poiFilter": ui.poiFilter = ds.v; ui.refreshChrome(); return;
    case "poiGroup": ui.poiClosed = { ...(ui.poiClosed ?? {}), [ds.v]: !ui.poiClosed?.[ds.v] }; ui.refreshChrome(); return;
    case "poiTab": ui.poiTab = ds.v; ui.refreshChrome(); return;
    case "logGroup": ui.logGroup = ds.v; ui.refreshChrome(); return;
    case "mapTab": ui.mapTab = ds.v; ui.selLabel = null; ui.refreshChrome(); return;
    case "worldModel": await saveData(sc, { "map.world.model": ds.v }); ui.refresh(); return;
    case "skyView": ui.skyViewOverride = null; await saveData(sc, { "map.sky.view": ds.v }); ui.refresh(); return;
    case "skyNew": { const seed = Math.floor(Math.random() * 1e9) + 1; const sk = normSky({ ...(ui.data.map?.sky ?? {}), seed }); await saveData(sc, { "map.sky.seed": seed, "map.sky.consts": makeConsts(sk) }); ui.refresh(); return; }
    case "skyNames": { const sk = normSky(ui.data.map?.sky ?? {}); const names = autoStarNames(sk, 30); await saveData(sc, { "map.sky.names": names }); ui.refresh(); globalThis.ui?.notifications?.info(`Atlas · ${names.length - sk.names.length} estrelas ganharam nome.`); return; }
    case "skyNamesClear": { if (!await foundry.applications.api.DialogV2.confirm({ window: { title: "Atlas" }, content: "<p>Apagar os nomes de todas as estrelas?</p>", rejectClose: false }).catch(() => false)) return; await saveData(sc, { "map.sky.names": [] }); ui.refresh(); return; }
    case "skyConsts": { const sk = normSky(ui.data.map?.sky ?? {}); await saveData(sc, { "map.sky.consts": makeConsts(sk, Math.floor(Math.random() * 1e6)) }); ui.refresh(); return; }
    case "skyBodyAdd": { const sk = normSky(ui.data.map?.sky ?? {}); const n = sk.bodies.filter(b => b.kind === ds.v).length + 1; const b = normBody(ds.v === "lua" ? { kind: "lua", name: `Lua ${n}`, period: 20 + Math.round(Math.random() * 40), color: "#d9e2ff", size: 2.4 } : { kind: "planeta", name: `Planeta ${n}`, period: 300 + Math.round(Math.random() * 3000), dist: +(0.4 + Math.random() * 8).toFixed(2), color: "#c9b8ff", size: 2 }); await saveData(sc, { "map.sky.bodies": [...sk.bodies, b] }); ui.refresh(); return; }
    case "skyBodyDel": { const sk = normSky(ui.data.map?.sky ?? {}); await saveData(sc, { "map.sky.bodies": sk.bodies.filter(b => b.id !== ds.id) }); ui.refresh(); return; }
    case "skyCreate": { if (!gm) return; const w = normWorld(ui.data.map?.world ?? {}); const sk = normSky({ tilt: w.globo.tilt, equinox: w.luz.equinox, seed: Math.floor(Math.random() * 1e9) + 1 });
      await saveData(sc, { "map.sky": { ...sk, consts: makeConsts(sk) } }); ui.refresh(); return; }
    case "skyOpen": ui.openSky?.(); return;
    case "routeFilter": ui.routeFilter = ds.v; ui.refreshChrome(); return;
    case "routeGroupT": ui.routeClosed = { ...(ui.routeClosed ?? {}), [ds.v]: !ui.routeClosed?.[ds.v] }; ui.refreshChrome(); return;
    case "routeTab": ui.routeTab = ds.v; ui.refreshChrome(); return;
    case "routeBack": ui.selRoute = null; ui.selPt = null; ui.tool = "sel"; ui.refresh(); return;
    case "routeSel": if (game.user.isGM && (e?.ctrlKey || e?.metaKey || e?.shiftKey || ui.tool === "vrota")) { const has = ui.inMulti("routes", ds.id); const cur = (ui.multi ?? []).filter(x => x.kind === "routes"); ui.multi = (e?.ctrlKey || e?.metaKey || e?.shiftKey) ? (has ? cur.filter(x => x.id !== ds.id) : [...cur, { kind: "routes", id: ds.id }]) : [{ kind: "routes", id: ds.id }]; ui.selRoute = null; ui.refresh(); return; }
      ui.selPt = null; ui.selRoute = ds.id; ui.sel = null; ui.selLabel = null; { const r = ui.data.routes.find(x => x.id === ds.id); if (r?.points?.length) { const mid = r.points[Math.floor(r.points.length / 2)]; canvas.animatePan?.({ x: mid[0], y: mid[1], duration: 400 }); } } ui.refresh(); return;
    case "rptPrev": case "rptNext": ui.selPt = Math.max(0, (ui.selPt ?? 0) + (act === "rptNext" ? 1 : -1)); ui.refresh(); return;
    case "rptDel": await mutateData(sc, (D) => { const r = D.routes.find(x => x.id === ui.selRoute); const i = ui.selPt; if (!r || r.locked || r.points.length <= 2 || i == null) return []; r.points.splice(i, 1); if (Array.isArray(r.handles)) r.handles.splice(i, 1); if (i === 0) r.a = null; if (i === r.points.length) r.b = null; return ["routes"]; }); ui.selPt = null; ui.refresh(); return;
    case "rptMode": await mutateData(sc, (D) => {
      const r = D.routes.find(x => x.id === ui.selRoute); const i = ui.selPt; if (!r || r.locked || i == null) return [];
      const hs = Array.isArray(r.handles) ? [...r.handles] : []; while (hs.length < r.points.length) hs.push(null);
      const hv = handleVecs(r.points, hs, i); const a = Math.round(Math.atan2(hv.outV[1], hv.outV[0]) * 1800 / Math.PI) / 10;
      const L1 = Math.round(Math.hypot(...hv.inV)) || 40, L2 = Math.round(Math.hypot(...hv.outV)) || 40;
      hs[i] = ds.v === "auto" ? null : ds.v === "canto" ? { a, l1: 0, l2: 0 } : ds.v === "quebrado" ? { a: hs[i]?.a ?? a, l1: L1, l2: L2, a2: hs[i]?.a2 ?? a } : { a, l1: L1, l2: L2 };
      r.handles = hs; return ["routes"]; }); return;
    case "iconAdd": {
      if (!gm) return; const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker; if (!FP) return; const forPoi = ds.for === "poi"; const forGroup = ds.for === "group";
      new FP({ type: "image", callback: async (path) => {
        const name = decodeURIComponent(String(path).split("/").pop().replace(/\.[a-z0-9]+$/i, "")).replace(/[-_]+/g, " ");
        const c = { id: foundry.utils.randomID(), name, src: path, mode: "img" }; await game.settings.set(MODULE_ID, "icons", [...customIcons(), c]);
        if (forPoi && ui.sel) await mutateData(sc, (D) => { const p = D.pois.find(x => x.id === ui.sel); if (p) { p.icon = iconId(c); p.markerImg = ""; } return ["pois"]; });
        if (forGroup) { const g = currentGroup(ui); if (g) await mutateData(sc, (D) => { const m = D.movers.find(x => x.id === g.id); if (m) m.icon = iconId(c); return ["movers"]; }); }
        ui.refresh(); } }).render(true); return; }
    case "iconDel": if (gm) { await game.settings.set(MODULE_ID, "icons", customIcons().filter(c => c.id !== ds.id)); ui.refresh(); } return;
    case "iconMode": if (gm) { const old = customIcons().find(c => c.id === ds.id); const list = customIcons().map(c => c.id === ds.id ? { ...c, mode: c.mode === "pic" ? "img" : "pic" } : c); await game.settings.set(MODULE_ID, "icons", list);
      // quem usava o ícone passa a usar o novo modo
      if (old) { const from = iconId(old), to = iconId(list.find(c => c.id === ds.id)); await mutateData(sc, (D) => { for (const p of D.pois) if (p.icon === from) p.icon = to; for (const m of D.movers) if (m.icon === from) m.icon = to; return ["pois", "movers"]; }); }
      ui.refresh(); } return;
    case "routeColor": await mutateData(sc, (D) => { const r = D.routes.find(x => x.id === ui.selRoute); if (r) r.color = ds.v; return ["routes"]; }); return;
    case "labelSel": ui.selLabel = ds.id; ui.refresh(); return;
    case "wxClear": { const w = normWeather(ui.data.weather); const nw = foundry.utils.deepClone({ ...(ui.data.weather ?? {}), ...w }); foundry.utils.setProperty(nw, ds.k, ""); await saveWeather(sc, nw); return; }
    case "natCat": ui.natCat = ds.v; ui.refreshChrome(); return;
    case "natTab": ui.natTab = ds.v; ui.refreshChrome(); return;
    case "natPlace": ui.natPlace = ds.id; ui.natRegion = ds.id; ui.refreshChrome(); return;
    case "natBack": ui.natPlace = null; ui.refreshChrome(); return;
    case "natKnown": case "natDel": { if (!gm) return; const key = ds.r === MAPWIDE ? MAPWIDE : sc.regions.get(ds.r); if (!key) return; let list = [...(natureOf(key, ui)[ds.c] ?? [])];
      if (act === "natDel") list = list.filter(e => e.id !== ds.id); else list = list.map(e => e.id === ds.id ? { ...e, known: !e.known } : e);
      await setNature(ui, ds.r, ds.c, list); ui.refresh(); return; }
    case "natOpen": { let doc = null; try { doc = await fromUuid(ds.uuid); } catch (err) { /* */ } if (!doc) return;
      if (!doc.testUserPermission?.(game.user, "LIMITED")) { const src = doc.img; if (src) new (foundry.applications?.apps?.ImagePopout ?? globalThis.ImagePopout)({ src, window: { title: doc.name } }).render(true); else globalThis.ui?.notifications?.info("Atlas: o mestre não liberou essa ficha."); return; }
      if (doc.documentName === "JournalEntryPage") doc.parent?.sheet?.render(true, { pageId: doc.id }); else doc.sheet?.render(true); return; }
    case "layer": { const L = { ...ui.layers, [ds.k]: !ui.layers[ds.k] }; await setUiPref("layers", L); ui.refresh(); return; }
    case "toggleLayer": ui.toggle(); return;
    case "gmView": await setUiPref("gmView", !ui.gmView); ui.refresh(); return;
    case "goto": { const s = game.scenes.get(ds.id); if (s) s.view(); return; }
    case "focus": ui.select(ds.id, { pan: true }); return;
    case "codexTab": ui.codexTab = ds.v; ui.refreshChrome(); return;
    case "setState": if (!gm || !ui.sel) return; await mutateData(sc, (D) => { const p = D.pois.find(x => x.id === ui.sel); if (p) p.state = ds.v; return ["pois"]; }); if (["rumor", "avistado", "visitado"].includes(ds.v)) { const p = ui.data.pois.find(x => x.id === ui.sel); await request("log", { kind: ds.v, text: `${POI_STATES[ds.v].label}: ${ds.v === "rumor" ? (p?.rumorText || "algo foi ouvido") : p?.name}`, sceneId: sc.id }); } return;
    case "travelTo": ui.travel.target = ds.id; ui.travel.picking = false; ui.panel = "grupo"; ui.groupSub = "viagem"; ui.refresh(); return;
    case "travelPace": ui.travel.pace = ds.v; ui.refresh(); return;
    case "enter": {
      const p = normPoi(ui.data.pois.find(x => x.id === ds.id) ?? {}); const target = game.scenes.get(p.submap || p.scene); if (!target) return globalThis.ui?.notifications?.warn("Atlas: cena não encontrada.");
      if (!gm && !target.testUserPermission?.(game.user, "LIMITED")) { globalThis.ui?.notifications?.warn("Atlas: o mestre precisa abrir essa cena para o grupo."); return; }
      if (gm && game.users.some(u => u.active && !u.isGM)) {
        const take = await foundry.applications.api.DialogV2.confirm({ window: { title: "Entrar" }, content: `<p>Levar os jogadores conectados para <b>${esc(target.name)}</b> também?</p>`, rejectClose: false }).catch(() => false);
        if (take) for (const u of game.users.filter(u => u.active && !u.isGM)) game.socket.emit("pullToScene", target.id, u.id);
      }
      target.view(); return;
    }
    case "openJournal": { const p = ui.data.pois.find(x => x.id === ds.id); const doc = p?.journal ? await fromUuid(p.journal) : null; if (!doc) return; if (doc.documentName === "JournalEntryPage") doc.parent?.sheet?.render(true, { pageId: doc.id }); else doc.sheet?.render(true); return; }
    case "pingPoi": { const p = ui.data.pois.find(x => x.id === ds.id); if (!p) return; const msg = { type: "ping", sceneId: sc.id, x: p.x, y: p.y, color: userColor(game.user.id), label: `${game.user.name} marcou ${normPoi(p).state === "rumor" && !gm ? "um rumor" : p.name}` }; game.socket.emit(SOCKET, msg); ui.onPing(msg); return; }
    case "editPoi": ui.panel = "pois"; ui.tool = "sel"; ui.poiEdit = true; ui.selectEdit({ sel: ds.id }); return;
    case "newNote": ui.noteDraft = { placing: true, text: "" }; ui.codexTab = "notas"; ui.refresh(); return;
    case "cancelNote": ui.noteDraft = null; ui.refresh(); return;
    case "saveNote": { const n = ui.noteDraft; if (!n || n.x == null || !String(n.text ?? "").trim()) return; await request("addNote", { sceneId: sc.id, x: n.x, y: n.y, text: n.text.trim(), private: !!n.private, kind: n.dest ? "dest" : "note" }); ui.noteDraft = null; ui.refresh(); return; }
    case "delNote": await request("delNote", { id: ds.id }); return;
    case "tool": ui.useTool(ds.v); return;
    case "roseConfig": openRoseConfig(); return;
    case "regGo": { const r = sc.regions.get(ds.r); if (!r) return; const pts = []; for (const s of shapesOf(r)) { if (s.points) for (let i = 0; i < s.points.length; i += 2) pts.push([s.points[i], s.points[i + 1]]); if (s.x != null) pts.push([s.x + (s.width ?? 0) / 2, s.y + (s.height ?? 0) / 2]); }
      if (pts.length) { const x = pts.reduce((a, p) => a + p[0], 0) / pts.length, y = pts.reduce((a, p) => a + p[1], 0) / pts.length; canvas.animatePan?.({ x, y, duration: 400 }); }
      ui.regHi = r.id; ui.refresh(); clearTimeout(ui._hiT); ui._hiT = setTimeout(() => { if (ui.regHi === r.id) { ui.regHi = null; ui.refresh(); } }, 4000); return; }
    case "regEdit": { const r = sc.regions.get(ds.r); r?.sheet?.render(true); return; }
    case "regDel": { const r = sc.regions.get(ds.r); if (!r) return; if (await foundry.applications.api.DialogV2.confirm({ window: { title: "Apagar Região" }, content: `<p>Apagar a Região <b>${esc(r.name || "sem nome")}</b> desta cena? Isso não pode ser desfeito.</p>`, rejectClose: false }).catch(() => false)) { await r.delete(); ui.regHi = null; ui.refresh(); } return; }
    case "poiRealNow": case "poiRealClear": await mutateData(sc, (D) => { const p0 = D.pois.find(x => x.id === ui.sel); if (!p0) return []; const p = normPoi(p0); const k = POI_KINDS[p.kind]; const z = ui.zoom || 1;
      const base = p.size || (p.markerImg ? Math.max(24, Math.min(130, ui.gs * z * 0.92)) : k.size);
      p0.real = act === "poiRealClear" ? 0 : Math.round(base / (ui.gs * z) * 20) / 20; return ["pois"]; }); ui.refresh(); return;
    case "bridgeToggle": await ui.toggleBridge(ds.id); ui.refresh(); return;
    case "bridgeSet": await ui.toggleBridge(ds.id, ds.v); ui.refresh(); return;
    case "routeSet": await mutateData(sc, (D) => { const r = D.routes.find(x => x.id === ui.selRoute); if (!r) return []; r[ds.k] = ds.v; return ["routes"]; }); ui.refresh(); return;
    case "mrSet": { const ids = (ui.multi ?? []).filter(x => x.kind === "routes").map(x => x.id); await mutateData(sc, (D) => { for (const r of D.routes) if (ids.includes(r.id)) r[ds.k] = ds.v; return ["routes"]; }); ui.refresh(); return; }
    case "bridgeGo": canvas.animatePan?.({ x: Number(ds.x), y: Number(ds.y), duration: 400 }); return;
    case "routeCopy": { const r = normRoute(ui.data.routes.find(x => x.id === ui.selRoute) ?? {}); ui.routeClip = Object.fromEntries(ROUTE_STYLE_KEYS.map(k => [k, r[k]])); ui.refreshChrome(); return; }
    case "routePaste": case "routePasteAll": { if (!ui.routeClip) return; const ids = act === "routePasteAll" ? ui.multi.filter(x => x.kind === "routes").map(x => x.id) : [ui.selRoute];
      await mutateData(sc, (D) => { for (const r of D.routes) if (ids.includes(r.id) && !r.locked) Object.assign(r, foundry.utils.deepClone(ui.routeClip)); return ["routes"]; }); ui.refresh(); return; }
    case "rsType": ui.rsType = ds.v; ui.refreshChrome(); return;
    case "rsReset": { const type = ROUTE_TYPES[ui.rsType] ? ui.rsType : "estrada"; const rs = { ...(ui.data.map?.routeStyle ?? {}) }; rs[type] = {}; await mutateData(sc, (D) => { D.map = { ...(D.map ?? {}), routeStyle: rs }; return ["map"]; }); ui.refresh(); return; }
    case "rsFromClip": { if (!ui.routeClip) return; const type = ROUTE_TYPES[ui.rsType] ? ui.rsType : "estrada"; const rs = { ...(ui.data.map?.routeStyle ?? {}) }; rs[type] = foundry.utils.deepClone(ui.routeClip); await mutateData(sc, (D) => { D.map = { ...(D.map ?? {}), routeStyle: rs }; return ["map"]; }); ui.refresh(); return; }
    case "roseMap": openRoseConfig("map"); return;
    case "roseCorner": await mutateData(sc, (D) => { D.map = { ...(D.map ?? {}), roseAt: null }; return ["map"]; }); ui.refresh(); return;
    case "wxCloudReset": { const w = normWeather(ui.data.weather); await saveWeather(sc, { ...(ui.data.weather ?? {}), ...w, cloudScale: 1, cloudOff: {} }); return; }
    case "fogImgClear": await saveData(sc, { "map.fogImg": "" }); ui.refresh(); return;
    case "fogAll": { const X = sc.dimensions?.sceneX ?? 0, Y = sc.dimensions?.sceneY ?? 0, SW = sc.dimensions?.sceneWidth ?? sc.width, SH = sc.dimensions?.sceneHeight ?? sc.height; await saveData(sc, { explored: [[Math.round(X + SW / 2), Math.round(Y + SH / 2), Math.round(Math.hypot(SW, SH))]] }); ui.refresh(); return; }
    case "snap": await setUiPref("snap", ds.v); ui.refreshChrome(); return;
    case "newRouteType": ui.newRouteType = ds.v; ui.refreshChrome(); return;
    case "drawMode": ui.routeMode = ds.v; ui.drawing = null; ui.refresh(); return;
    case "joinRoutes": return vecAction(ui, "combine");
    case "clearMulti": ui.multi = []; ui.refresh(); return;
    case "routeSelType": { const ids = ui.data.routes.filter(r => r.type === ds.v).map(r => r.id); const cur = (ui.multi ?? []).filter(x => x.kind === "routes" && !ids.includes(x.id)); ui.multi = [...cur, ...ids.map(id => ({ kind: "routes", id }))]; ui.selRoute = null; ui.refresh(); return; }
    case "mrType": case "mrCond": case "mrColor": { const ids = (ui.multi ?? []).filter(x => x.kind === "routes").map(x => x.id); const k = { mrType: "type", mrCond: "cond", mrColor: "color" }[act];
      await mutateData(sc, (D) => { for (const r of D.routes) if (ids.includes(r.id)) r[k] = ds.v; return ["routes"]; }); ui.refresh(); return; }
    case "mrDo": return vecAction(ui, ds.v);
    case "bizOpen": return openBiz(sc.id, ds.id);
    case "portalDir": { const id = ui.selRoute; await mutateData(sc, (D) => { const r = D.routes.find(x => x.id === id); if (!r) return [];
      if (ds.v === "both") r.oneway = false; else { r.oneway = true; if (ds.v === "ba") { [r.a, r.b] = [r.b, r.a]; r.points = [...r.points].reverse(); } } return ["routes"]; }); ui.cache.plans = {}; ui.refresh(); return; }
    case "tpDir": case "tpUnlink": { if (!gm) return;
      if (ds.r) { await mutateData(sc, (D) => { const i = D.routes.findIndex(x => x.id === ds.r); if (i < 0) return []; const r = D.routes[i];
        if (act === "tpUnlink") { D.routes.splice(i, 1); return ["routes"]; }
        const cur = !r.oneway ? "both" : r.a === ds.id ? "out" : "in"; const nx = { both: "out", out: "in", in: "both" }[cur];
        if (nx === "both") r.oneway = false; else { r.oneway = true; if ((nx === "out") !== (r.a === ds.id)) { [r.a, r.b] = [r.b, r.a]; r.points = [...r.points].reverse(); } } return ["routes"]; }); }
      else { const o = game.scenes.get(ds.s); if (!o) return; const l = normPoi(ui.data.pois.find(x => x.id === ds.id) ?? {}).remote.find(x => x.scene === ds.s && x.poi === ds.d);
        await setRemote(sc, ds.id, o, ds.d, act === "tpUnlink" ? null : { both: "out", out: "in", in: "both" }[l?.dir ?? "both"]); }
      ui.cache.plans = {}; ui.refresh(); return; }
    case "tpRAdd": { if (!gm) return; const o = game.scenes.get(ui.tpR?.scene); if (!o || !ui.tpR?.poi) return; await setRemote(sc, ds.id, o, ui.tpR.poi, "both"); ui.tpR = null; ui.refresh(); return; }
    case "tpGo": { const pw = e?.target?.closest?.(".tpbox")?.querySelector?.("[data-tppw]")?.value ?? "";
      await request("groupTeleport", { sceneId: sc.id, moverId: ds.g, poiId: ds.id, dstScene: ds.s, dstPoi: ds.d, pw }); return; }
    case "exitGo": { const g = ui.data.movers.find(x => x.id === ds.g); const P = ui.data.pois.find(x => x.id === ds.id); const dst = game.scenes.get(P?.exitScene); if (!g || !dst) return;
      if (!gm) globalThis.ui?.notifications?.info(`Atlas · pedido enviado ao mestre: ir para ${dst.navName || dst.name}.`); await request("groupChangeMap", { sceneId: sc.id, moverId: g.id, poiId: P.id }); return; }
    case "visionOff": await sc.update({ tokenVision: false }); ui.refresh(); return;
    case "rgDo": return regAction(ui, ds.v);
    case "rgOpen": { ui.rgOpen ??= new Set(); if (ui.rgOpen.has(ds.g)) ui.rgOpen.delete(ds.g); else ui.rgOpen.add(ds.g); ui.refreshChrome(); return; }
    case "rgSel": { const ids = ui.data.routes.filter(r => r.group === ds.g).map(r => r.id); const cur = (ui.multi ?? []).filter(x => x.kind === "routes" && !ids.includes(x.id)); ui.multi = (e?.ctrlKey || e?.shiftKey) ? [...cur, ...ids.map(id => ({ kind: "routes", id }))] : ids.map(id => ({ kind: "routes", id })); ui.selRoute = null; ui.refresh(); return; }
    case "zoneMode": case "zoneModeReset": { const r = sc.regions.get(ds.r); if (!r) return; const z = zoneOf(r); const cur = foundry.utils.deepClone(r.flags?.[MODULE_ID]?.zone ?? {});
      if (act === "zoneModeReset") cur.modes = null; else { const m = new Set(cur.modes ?? zoneDefaultModes(z)); if (m.has(ds.v)) m.delete(ds.v); else m.add(ds.v); cur.modes = [...m]; }
      await r.update({ [`flags.${MODULE_ID}.zone`]: cur }); ui.cache.plans = {}; ui.refresh(); return; }
    case "newMoverKind": ui.newMover.kind = ds.v; ui.refreshChrome(); return;
    case "finishRoute": finishRoute(ui); return;
    case "cancelRoute": ui.drawing = null; ui.refresh(); return;
    case "deselect": ui.selectEdit({}); return;
    case "delete": await deleteSelection(ui); return;
    case "poiColor": await mutateData(sc, (D) => { const p = D.pois.find(x => x.id === ui.sel); if (p) p.color = ds.v; return ["pois"]; }); return;
    case "poiIcon": await mutateData(sc, (D) => { const p = D.pois.find(x => x.id === ui.sel); if (p) { p.icon = ds.v; p.markerImg = ""; } return ["pois"]; }); return;
    case "labelStraight": case "labelArc": await mutateData(sc, (D) => { const l = D.labels.find(x => x.id === ui.selLabel); if (!l) return []; l.pts = labelCurve(l, act === "labelArc" ? 0.18 : 0); l.curve = true; return ["labels"]; }); return;
    case "labelStyle": await mutateData(sc, (D) => { const l = D.labels.find(x => x.id === ui.selLabel); if (!l) return []; l.style = ds.v; for (const k of ["color", "ol", "ow", "sp", "op", "it", "up", "font", "w"]) delete l[k]; return ["labels"]; }); return;
    case "moverKind": await mutateData(sc, (D) => { const m = D.movers.find(x => x.id === ui.selMover); if (m) m.kind = ds.v; return ["movers"]; }); return;
    case "routeType": case "routeCond": await mutateData(sc, (D) => { const r = D.routes.find(x => x.id === ui.selRoute); if (r) r[act === "routeType" ? "type" : "cond"] = ds.v; if (r && act === "routeType") r.modes = null; return ["routes"]; }); return;
    case "routeMode": await mutateData(sc, (D) => { const r = D.routes.find(x => x.id === ui.selRoute); if (!r) return []; const cur = r.modes ?? [...ROUTE_TYPES[r.type ?? "estrada"].modes]; r.modes = cur.includes(ds.v) ? cur.filter(x => x !== ds.v) : [...cur, ds.v]; return ["routes"]; }); return;
    case "unlink": { const f = ds.f; if (f === "mapzone") { await saveData(sc, { "map.zone": { ...(ui.data.map?.zone ?? {}), table: "" } }); ui.refresh(); return; } if (f.startsWith("zone:")) { const r = sc.regions.get(f.slice(5)); await r?.update({ [`flags.${MODULE_ID}.zone.table`]: "" }); } else if (f.startsWith("mover.")) await mutateData(sc, (D) => { const m = D.movers.find(x => x.id === ui.selMover); if (m) m[f.slice(6)] = ""; return ["movers"]; }); else await mutateData(sc, (D) => { const p = D.pois.find(x => x.id === ui.sel); if (p) p[f] = ""; return ["pois"]; }); ui.refresh(); return; }
    case "pickImg": {
      const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker; if (!FP) return; const f = ds.f;
      new FP({ type: "image", callback: async (path) => { if (f.startsWith("map:")) { await saveData(sc, { [`map.${f.slice(4)}`]: path }); ui.refresh(); } else if (f.startsWith("wx:")) { const w = normWeather(ui.data.weather); const nw = foundry.utils.deepClone({ ...(ui.data.weather ?? {}), ...w }); foundry.utils.setProperty(nw, f.slice(3), path); await saveWeather(sc, nw); } else if (f.startsWith("mover.")) await mutateData(sc, (D) => { const m = D.movers.find(x => x.id === ui.selMover); if (m) m[f.slice(6)] = path; return ["movers"]; }); else await mutateData(sc, (D) => { const p = D.pois.find(x => x.id === ui.sel); if (p) { p[f] = path; if (f === "markerImg" && !p.shape) p.shape = "hex"; } return ["pois"]; }); } }).render(true); return;
    }
    case "drawRegions": try { globalThis.ui?.controls?.activate?.({ control: "regions", tool: "polygon" }); } catch (err) { try { canvas.regions?.activate?.(); } catch (e2) { /* */ } } return;
    case "clearFog": if (await foundry.applications.api.DialogV2.confirm({ window: { title: "Limpar área explorada" }, content: "<p>Toda a névoa volta a cobrir o mapa. Continuar?</p>", rejectClose: false }).catch(() => false)) await saveData(sc, { explored: [] }); return;
    case "unmap": if (await foundry.applications.api.DialogV2.confirm({ window: { title: "Deixar de ser mapa" }, content: "<p>Os locais e rotas continuam guardados na cena, mas o Atlas deixa de mostrar esta cena como mapa.</p>", rejectClose: false }).catch(() => false)) { await saveData(sc, { "map.enabled": false }); ui.panel = null; ui.refresh(); } return;
    case "makeMap": case "makeMapImport": { const c = ui.cfgDraft ?? {}; await saveData(sc, { map: { enabled: true, level: c.level ?? "regiao", parent: c.parent ?? "", fog: c.fog ?? true, reveal: 2, title: "" } }); ui.cfgDraft = null; ui.panel = act === "makeMapImport" ? "import" : "mapa"; ui.importRows = null; ui.refresh(); return; }
    case "runImport": { const n = await runImport(sc, ui.importRows); globalThis.ui?.notifications?.info(`Atlas: ${n.pois} locais e ${n.movers} elementos móveis importados.`); ui.importRows = null; ui.panel = "mapa"; ui.refresh(); return; }
    case "wxDir": { const w = normWeather(ui.data.weather); await saveWeather(sc, { ...(ui.data.weather ?? {}), ...w, dir: Number(ds.v) }); return; }
    case "wxRoll": await rollWeather(sc); return; // (sem mensagem no chat)
  }
}

export async function chromeField(ui, el, e, live = false) {
  if (!live && el.dataset.field?.startsWith("g") && await groupField(ui, el)) return;
  const sc = ui.scene; const k = el.dataset.k; const val = el.type === "checkbox" ? el.checked : el.value;
  const kind = live ? (el.dataset.live || el.dataset.field) : el.dataset.field;
  switch (kind) {
    case "gSearch": await groupField(ui, el); return;
    case "routeTypeSel": return chromeAct(ui, "routeType", { v: val }, el, e);
    case "rgName": { const g = el.dataset.g; const cur = foundry.utils.deepClone(ui.data.map?.routeGroups ?? {}); cur[g] = { ...(cur[g] ?? {}), name: String(val).trim() }; await saveData(sc, { "map.routeGroups": cur }); return; }
    case "newRouteTypeSel": ui.newRouteType = val; return;
    case "tpR": ui.tpR = { ...(ui.tpR ?? {}), [k]: val, ...(k === "scene" ? { poi: "" } : {}) }; ui.refreshChrome(); return;
    case "mrTypeSel": if (!val) return; return chromeAct(ui, "mrType", { v: val }, el, e);
    case "mroute": { if (val === "__") return; const ids = (ui.multi ?? []).filter(x => x.kind === "routes").map(x => x.id); const num = ["width", "opacity"].includes(k) || (k === "bWidth" && val !== "");
      const v = k === "outline" ? (val === "" ? null : val === "1") : num ? Number(val) : val;
      if (live) { const rv = el.parentElement?.querySelector(".rv"); if (rv) rv.textContent = k === "opacity" ? `${Math.round(Number(val) * 100)}%` : `${val}×`; clearTimeout(ui._mrT); ui._mrT = setTimeout(() => mutateData(sc, (D) => { for (const r of D.routes) if (ids.includes(r.id)) r[k] = v; return ["routes"]; }), 250); return; }
      await mutateData(sc, (D) => { for (const r of D.routes) if (ids.includes(r.id)) r[k] = v; return ["routes"]; }); return; }
    case "q": { const q = String(val).trim().toLowerCase(); const body = el.closest(".pbody"); for (const r of body?.querySelectorAll("[data-q]") ?? []) r.style.display = !q || r.dataset.q.includes(q) ? "" : "none"; for (const sec of body?.querySelectorAll(".qsec") ?? []) sec.style.display = [...sec.querySelectorAll("[data-q]")].some(r => r.style.display !== "none") ? "" : "none"; return; }
    case "natRegion": ui.natRegion = val; ui.refreshChrome(); return;
    case "skyBody": { const sk = normSky(ui.data.map?.sky ?? {}); const v = ["period", "dist", "size", "offset"].includes(k) ? Number(val) : val; await saveData(sc, { "map.sky.bodies": sk.bodies.map(b => b.id === el.dataset.id ? normBody({ ...b, [k]: v }) : b) }); ui.refresh(); return; }
    case "skyConst": { const list = foundry.utils.deepClone(ui.data.map?.sky?.consts ?? []); const i = Number(el.dataset.i); if (list[i]) { list[i].name = String(val).trim() || list[i].name; await saveData(sc, { "map.sky.consts": list }); } ui.refresh(); return; }
    case "regName": { const r = sc.regions.get(el.dataset.r); if (r && game.user.isGM) await r.update({ name: String(val) }); return; }
    case "regColor": { const r = sc.regions.get(el.dataset.r); if (r && game.user.isGM) await r.update({ color: String(val) }); ui.refreshMap(); return; }
    case "mapzone": { const z = { ...(ui.data.map?.zone ?? {}) }; if (k === "cn" || k === "cd") { const ch = [...(z.chance ?? [1, 8])]; ch[k === "cn" ? 0 : 1] = Math.max(k === "cd" ? 1 : 0, Number(val) || 0); z.chance = ch; } else if (k === "mult") z.mult = val === "" ? null : Number(val); else z[k] = val; await saveData(sc, { "map.zone": z }); ui.refresh(); return; }
    case "natNew": case "natNote": { const rid = el.dataset.r; const key = rid === MAPWIDE ? MAPWIDE : sc.regions.get(rid); if (!key || !game.user.isGM) return; const c = el.dataset.c; let list = [...(natureOf(key, ui)[c] ?? [])];
      if (kind === "natNew") { const name = String(val).trim(); if (!name) return; list.push({ id: foundry.utils.randomID(), name, uuid: "", img: "", known: false, note: "" }); el.value = ""; el.blur(); }
      else list = list.map(e => e.id === el.dataset.id ? { ...e, note: String(val) } : e);
      await setNature(ui, rid, c, list); ui.refresh(); return; }
    case "noteText": if (ui.noteDraft) ui.noteDraft.text = val; return;
    case "noteFlag": if (ui.noteDraft) ui.noteDraft[k] = val; return;
    case "opt": ui.travel.opts[k] = val; if (k === "avoidWx" || k === "crossRough" || k === "noPortals") { ui.cache.plans = {}; ui.refresh(); } return;
    case "newPoi": ui.newPoi[k] = val; return;
    case "newPoiCat": ui.newPoi.kind = POI_CATS[val]?.kinds[0] ?? ui.newPoi.kind; ui.refreshChrome(); return;
    case "poiCat": { const kind = POI_CATS[val]?.kinds[0]; if (!kind) return; await mutateData(sc, (D) => { const p = D.pois.find(x => x.id === ui.sel); if (p) { p.kind = kind; p.icon = ""; } return ["pois"]; }); return; }
    case "cfg": ui.cfgDraft = { ...(ui.cfgDraft ?? {}), [k]: val }; return;
    case "imp": { const t = ui.importRows?.tokens?.[Number(el.dataset.i)]; if (t) t[k] = val; if (k === "take") ui.refreshChrome(); return; }
    case "impOpt": if (ui.importRows) ui.importRows[k] = val; return;
    case "map": { if (k.startsWith("world.grid.") && el.type === "range") ui.wprev = live ? { ...(ui.wprev ?? {}), [k.slice(6)]: Number(val) } : null; // mostra no mapa enquanto arrasta
      if (k.startsWith("read.") && el.type === "range") ui.mprev = live ? { ...(ui.mprev ?? {}), [k.slice(5)]: Number(val) } : null;
      if (live && el.type === "range") { const rv = el.parentElement?.querySelector(".rv"); if (rv) rv.textContent = el.dataset.fmt === "x" ? `${Number(val).toFixed(1)}×` : `${Math.round(Number(val) * 100)}%`; if (ui.wprev) ui.refreshSky(); if (ui.mprev) ui.refreshMap(); return; }
      if (k.startsWith("routeStyle.")) { const v = k.endsWith(".outline") ? (val === "" ? "" : val === "1") : (el.type === "number" ? (val === "" ? "" : Number(val)) : val); await saveData(sc, { [`map.${k}`]: v }); ui.refresh(); return; }
      await saveData(sc, { [`map.${k}`]: k === "reveal" ? Number(val) || 2 : (el.type === "range" || el.type === "number") ? Number(val) : val }); ui.refresh(); return; }
    case "fogGm": await setUiPref("fogGm", Math.max(0, Math.min(1, Number(val) / 100))); ui.refresh(); return;
    case "brush": ui._brushV = Math.max(0.25, Number(val) || 2); await setUiPref("brush", ui._brushV); ui.refreshMap(); return;
    case "wx": {
      const w = normWeather(ui.data.weather); const nw = foundry.utils.deepClone({ ...(ui.data.weather ?? {}), ...w });
      const v = (el.type === "number" || el.type === "range" || ["temp", "force", "cloudTime", "auto"].includes(k)) ? Number(val) : val; foundry.utils.setProperty(nw, k, v);
      if (live && el.type === "range") { const rv = el.parentElement?.querySelector(".rv"); if (rv) rv.textContent = /alpha/.test(k) ? `${Math.round(v * 100)}%` : /scale/.test(k) ? `${v}×` : `${v}`; for (const o of el.parentElement?.querySelectorAll("input.num") ?? []) o.value = v; }
      if (live) { ui.liveWx = nw; ui.refreshMap(); clearTimeout(ui._wxT); ui._wxT = setTimeout(() => { ui.liveWx = null; saveWeather(sc, nw); }, 350); return; }
      await saveWeather(sc, nw); return;
    }
    case "poi": await mutateData(sc, (D) => {
      const p = D.pois.find(x => x.id === ui.sel); if (!p) return [];
      if (k === "services") p.services = String(val).split("\n").map(l => l.trim()).filter(Boolean).map(l => { const [n, t] = l.split("|").map(x => x.trim()); return { name: n, type: t ?? "" }; });
      else if (k === "rumor" || k === "size" || k === "real" || k === "ritual") p[k] = Number(val) || 0; else p[k] = val;
      if (k === "kind") p.icon = "";
      return ["pois"];
    }); return;
    case "mover": await mutateData(sc, (D) => { const m = D.movers.find(x => x.id === ui.selMover); if (!m) return []; if (k === "main" && val) for (const o of D.movers) o.main = false; m[k] = k === "today" ? Number(val) || 0 : val; return ["movers"]; }); return;
    case "route": {
      const num = ["width", "opacity", "dashScale", "outlineWidth", "nameSize", "ritual"].includes(k) || (k === "bWidth" && val !== "");
      if (live) { const rv = el.parentElement?.querySelector(".rv"); if (rv) rv.textContent = k === "opacity" ? `${Math.round(Number(val) * 100)}%` : `${val}×`; ui.liveRoute = { id: ui.selRoute, k, v: Number(val) }; ui.refreshMap(); clearTimeout(ui._rT); ui._rT = setTimeout(() => { ui.liveRoute = null; mutateData(sc, (D) => { const r = D.routes.find(x => x.id === ui.selRoute); if (r) r[k] = Number(val); return ["routes"]; }); }, 300); return; }
      await mutateData(sc, (D) => { const r = D.routes.find(x => x.id === ui.selRoute); if (!r) return []; r[k] = k === "mult" ? (val === "" ? null : Number(val)) : num ? Number(val) : val; return ["routes"]; }); return; }
    case "rpt": {
      const apply = (D) => { const r = D.routes.find(x => x.id === ui.selRoute); const i = ui.selPt; if (!r || r.locked || i == null) return null;
        const hs = Array.isArray(r.handles) ? [...r.handles] : []; while (hs.length < r.points.length) hs.push(null);
        const hv = handleVecs(r.points, hs, i); const cur = hs[i] ?? { a: Math.atan2(hv.outV[1], hv.outV[0]) * 180 / Math.PI, l1: Math.hypot(...hv.inV), l2: Math.hypot(...hv.outV) };
        hs[i] = { ...cur, [k]: Number(val) || 0 }; r.handles = hs; return r; };
      if (live) { const D = foundry.utils.deepClone(ui.data); const r = apply(D); if (r) { ui.liveRoute = { id: r.id, handles: r.handles }; ui.refreshMap(); } clearTimeout(ui._rT); ui._rT = setTimeout(() => { ui.liveRoute = null; mutateData(sc, (D2) => apply(D2) ? ["routes"] : []); }, 300); for (const o of el.closest(".row2")?.querySelectorAll("input") ?? []) if (o !== el) o.value = val; return; }
      await mutateData(sc, (D) => apply(D) ? ["routes"] : []); return; }
    case "label": {
      if (live) { if (el.type === "range") { const rv = el.parentElement?.querySelector(".rv"); if (rv) rv.textContent = k === "ow" ? `${val}px` : `${Math.round(Number(val) * 100)}%`; } return; }
      await mutateData(sc, (D) => { const l = D.labels.find(x => x.id === ui.selLabel); if (!l) return []; l[k] = ["size", "rot", "ow", "sp", "op"].includes(k) ? Number(val) || 0 : val;
        if (k === "curve" && val && !(Array.isArray(l.pts) && l.pts.length === 4)) l.pts = labelCurve(l); return ["labels"]; }); return; }
    case "zonewx": { const r = sc.regions.get(el.dataset.r); if (!r) return; const cur = { ...(r.flags?.[MODULE_ID]?.wx ?? {}) }; cur[k] = val; await r.update({ [`flags.${MODULE_ID}.wx`]: cur }); ui.cache.plans = {}; ui._wxc = null; ui.refresh(); return; }
    case "zone": {
      const r = sc.regions.get(el.dataset.r); if (!r) return; const cur = foundry.utils.deepClone(r.flags?.[MODULE_ID]?.zone ?? {}); const z = zoneOf(r);
      if (k === "cn" || k === "cd") { const ch = [...(cur.chance ?? z?.chance ?? [1, 8])]; ch[k === "cn" ? 0 : 1] = Math.max(k === "cd" ? 1 : 0, Number(val) || 0); cur.chance = ch; }
      else if (k === "mult") cur.mult = val === "" ? null : Number(val); else cur[k] = val;
      await r.update({ [`flags.${MODULE_ID}.zone`]: cur }); ui.refresh(); return;
    }
  }
}

export async function chromeDrop(ui, el, e) {
  el.classList.remove("over");
  let data; try { data = foundry.applications?.ux?.TextEditor?.implementation?.getDragEventData?.(e) ?? JSON.parse(e.dataTransfer.getData("text/plain")); } catch (err) { return; }
  const uuid = data?.uuid ?? (data?.type && data?.id ? `${data.type}.${data.id}` : null); if (!uuid) return;
  const want = el.dataset.drop; const type = data.type;
  const ok = want === "Any" ? ["Actor", "Item", "JournalEntry", "JournalEntryPage", "RollTable"].includes(type) : want === "JournalEntry" ? ["JournalEntry", "JournalEntryPage"].includes(type) : type === want;
  if (!ok) { globalThis.ui?.notifications?.warn(`Atlas: solte aqui um ${{ JournalEntry: "diário", Actor: "ator", RollTable: "tabela" }[want] ?? want}.`); return; }
  const f = el.dataset.fieldTarget;
  if (f.startsWith("nat:")) {
    const [, rid, c] = f.split(":"); const key = rid === MAPWIDE ? MAPWIDE : ui.scene.regions.get(rid); let doc = null; try { doc = await fromUuid(uuid); } catch (err) { /* */ }
    if (!key || !doc) return; const list = [...(natureOf(key, ui)[c] ?? [])]; if (list.some(e => e.uuid === uuid)) return;
    list.push({ id: foundry.utils.randomID(), name: doc.name, uuid, img: doc.img && !String(doc.img).includes("mystery-man") ? doc.img : "", known: false, note: "" });
    await setNature(ui, rid, c, list); ui.refresh(); return;
  }
  if (await groupDrop(ui, f, data)) { ui.refresh(); return; }
  if (f === "mapzone") { await saveData(ui.scene, { "map.zone": { ...(ui.data.map?.zone ?? {}), table: uuid } }); ui.refresh(); return; }
  if (f.startsWith("zone:")) { const r = ui.scene.regions.get(f.slice(5)); await r?.update({ [`flags.${MODULE_ID}.zone.table`]: uuid }); ui.refresh(); return; }
  if (f.startsWith("mover.")) {
    let a = null; try { a = await fromUuid(uuid); } catch (err) { /* */ }
    await mutateData(ui.scene, (D) => { const m = D.movers.find(x => x.id === ui.selMover); if (m) { m.actor = uuid; if (a) { m.name = a.name; m.img = a.prototypeToken?.texture?.src || a.img || m.img; if (a.type === "vehicle") m.kind = "veiculo"; } } return ["movers"]; }); ui.refresh(); return;
  }
  await mutateData(ui.scene, (D) => { const p = D.pois.find(x => x.id === ui.sel); if (p) p[f] = uuid; return ["pois"]; });
  ui.refresh();
}
