// Atlas · mapas do mundo, das regiões e das cidades, com rotas, viagem, clima e descoberta.
import { MODULE_ID, SOCKET } from "./config.js";
import { registerSettings, onAction, handleSocketAction, notes, addLog, isActiveGM, mapOf, dataOf, mutateData, uid, mapScenes, mainMover, syncPause } from "./data.js";
import { atlas } from "./ui.js";
import { vecSpace } from "./vector.js";
import { registerBizActions, refreshBiz } from "./biz.js";
import { planTravel, executeTravel, onWorldTime } from "./travel.js";
import { observerFor, skyTime, skyOf, worldOf, VSKY, legacySkyScene, normWorld, seasonAt } from "./world.js";
import { normSky, bodiesNow, phaseName, renderHorizonDial, renderSkyBar, eclToEq, altAz, starList, autoStarNames } from "./sky.js";
import { currentGroup } from "./groups.js";
import { effectiveWeather, syncClouds, zoneWxAt, withZone } from "./wxfx.js";
import { ownedMembers } from "./transport.js";
import { normMover, normPoi } from "./data.js";
import { migratePortals } from "./portals.js";
import { CLIMATES } from "./config.js";
import { registerSidebarTab } from "./sidebar.js";
import { hookAppPopout, togglePop } from "./popout.js";
import { openSkyWindow } from "./skywin.js";
import { applySeed, revertSeed, refreshSeedLabels, seedRoutes, splitSeamRoutes } from "./seed.js";
import { dock, panelSide } from "./dock.js";
import { registerLayer, patchLongPress, layerActive } from "./layer.js";
import { registerRoseMenu } from "./roseconfig.js";
import { injectSceneConfig } from "./sceneconfig.js";
import { registerGroupActions, handleActorDrop } from "./groups.js";
Hooks.on("dropCanvasData", (cv, data, event) => handleActorDrop(cv, data, event));


/* ---------- "daqui": de onde o relógio, o céu e o clima são vistos ----------
   Havendo mapa-múndi, o lugar é escolhido no próprio mundo (map.here):
   "auto" = onde os jogadores estão (a unidade com personagens deles); "view" = o mapa que cada um tem aberto;
   "mover:cena:id" = uma unidade; "poi:cena:id" = um local marcado pelo mestre. */
const sceneCenter = (s) => { const d = s.dimensions ?? {}; return { x: (d.sceneX ?? 0) + (d.sceneWidth ?? s.width) / 2, y: (d.sceneY ?? 0) + (d.sceneHeight ?? s.height) / 2 }; };
function worldFor(scene) { let w = null; try { w = scene ? worldOf(scene) : null; } catch (e) { /* */ } if (w) return w; const all = mapScenes().filter(s => mapOf(s)?.level === "mundo"); return all.length === 1 ? all[0] : null; }
const inWorld = (world) => mapScenes().filter(s => { try { return worldOf(s)?.id === world.id; } catch (e) { return false; } });
const hasPlayers = (m) => game.users.some(u => !u.isGM && ownedMembers(u, m).length);
/** Lugares que podem ser o "daqui" de um mundo (para a lista do mestre). */
export function herePlaces(world) {
  const out = [{ v: "auto", label: "Onde os jogadores estão (automático)" }, { v: "view", label: "O mapa que cada um tem aberto" }];
  for (const s of inWorld(world)) { const d = dataOf(s);
    for (const m of (d.movers ?? []).map(normMover).filter(m => !m.parked)) out.push({ v: `mover:${s.id}:${m.id}`, label: `Unidade · ${m.name} (${s.name})`, group: "Unidades" });
    for (const p of (d.pois ?? []).map(normPoi).filter(p => p.name)) out.push({ v: `poi:${s.id}:${p.id}`, label: `${p.name} (${s.name})`, group: "Locais" }); }
  return out;
}
/** De onde se olha agora: { world, scene, pt, obs, wd, label, src } (ou null sem mundo). */
let hereC = { k: null, at: 0, v: null };
export function hereNow(scene = canvas?.scene) {
  const k = `${scene?.id}|${atlas.dataRev ?? 0}|${atlas.travel?.moverId ?? ""}`; const n = performance.now(); if (hereC.k === k && n - hereC.at < 500) return hereC.v;
  const v = hereCalc(scene); hereC = { k, at: n, v }; return v;
}
function hereCalc(scene) {
  const world = worldFor(scene); if (!world) return null;
  const mode = mapOf(world)?.here || "auto"; let at = null, src = mode;
  const [k, sid, id] = mode.split(":");
  if (k === "mover" || k === "poi") { const s = game.scenes.get(sid); const it = s ? (dataOf(s)[k === "mover" ? "movers" : "pois"] ?? []).find(x => x.id === id) : null; if (it) at = { scene: s, pt: { x: it.x, y: it.y }, name: it.name }; }
  if (!at && mode !== "view") { // a unidade dos jogadores: a principal, depois a da cena ativa, depois a maior
    const cands = []; for (const s of inWorld(world)) for (const m of (dataOf(s).movers ?? []).map(normMover)) if (!m.parked && hasPlayers(m)) cands.push({ s, m });
    cands.sort((a, b) => (b.m.main - a.m.main) || ((b.s.active ? 1 : 0) - (a.s.active ? 1 : 0)) || (b.m.members.length - a.m.members.length));
    if (cands[0]) { at = { scene: cands[0].s, pt: { x: cands[0].m.x, y: cands[0].m.y }, name: cands[0].m.name }; src = "auto"; }
  }
  if (!at) { src = "view"; const s = scene && worldOf(scene)?.id === world.id ? scene : world; const g = s.id === canvas?.scene?.id ? currentGroup(atlas) : null; at = { scene: s, pt: g ? { x: g.x, y: g.y } : sceneCenter(s), name: s.name }; }
  const of = observerFor(at.scene, at.scene.id === world.id ? at.pt : null);
  const place = at.scene.id === world.id ? at.name : at.scene.name;
  return { world, scene: at.scene, pt: at.pt, obs: of.obs ? { ...of.obs, name: place } : null, wd: of.wd ?? normWorld(mapOf(world).world ?? {}), label: place, unit: at.name, src };
}
/** Clima no lugar de onde se olha (o do mapa, com o terreno de clima próprio naquele ponto). */
function hereWeather(h) { let w = effectiveWeather(h.scene); try { const z = zoneWxAt(h.scene, h.pt.x, h.pt.y); if (z) w = withZone(w, z); } catch (e) { /* */ } return w; }

const refresh = () => { atlas.dataRev = (atlas.dataRev ?? 0) + 1; atlas.cache.qt = {}; atlas.refresh(); };
let clockT = 0; const clockRefresh = () => { const n = Date.now(); if (n - clockT < 1000) return; clockT = n; atlas.refreshChrome(); };

// Carrega o estilo da aba pelo próprio script: mudanças no module.json só valem após relançar o mundo.
function loadStyle() {
  const href = new URL("../styles/atlas-sidebar.css", import.meta.url).href;
  if ([...document.querySelectorAll("link[rel=stylesheet]")].some(l => l.href.split("?")[0] === href)) return;
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; document.head.appendChild(l);
}
Hooks.once("init", () => {
  // Espaço na edição avançada: alterna com a Seleção (como no Corel). Muda em Configurar Controles › Atlas.
  try { game.keybindings.register(MODULE_ID, "vecSelect", { name: "Edição avançada: alternar com a Seleção", hint: "Na edição avançada de rotas ou Regiões, volta para a Seleção (e de novo para a ferramenta anterior). Fora dela, a tecla faz o que fazia antes (ex.: pausar).", editable: [{ key: "Space" }], precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY, onDown: () => vecSpace(atlas) }); } catch (e) { console.warn(`${MODULE_ID} | atalho`, e); }
  loadStyle(); registerSettings(); registerRoseMenu(); registerLayer(); if (panelSide() === "barra") registerSidebarTab();
  game.settings.register(MODULE_ID, "lore1", { scope: "world", config: false, type: Boolean, default: false });
  game.settings.register(MODULE_ID, "lore2", { scope: "world", config: false, type: Boolean, default: false });
  game.settings.register(MODULE_ID, "lore3", { scope: "world", config: false, type: Boolean, default: false });
  game.settings.register(MODULE_ID, "lore4", { scope: "world", config: false, type: Boolean, default: false });
  game.settings.register(MODULE_ID, "lore5", { scope: "world", config: false, type: Boolean, default: false });
  game.settings.register(MODULE_ID, "lore6", { scope: "world", config: false, type: Boolean, default: false });
  game.settings.register(MODULE_ID, "lore7", { scope: "world", config: false, type: Boolean, default: false });
  game.settings.register(MODULE_ID, "lore8", { scope: "world", config: false, type: Boolean, default: false });
  game.settings.register(MODULE_ID, "lore9", { scope: "world", config: false, type: Boolean, default: false });
  game.settings.register(MODULE_ID, "lore10", { scope: "world", config: false, type: Boolean, default: false });
  game.settings.register(MODULE_ID, "popoutBtn", { name: "Destacar janelas", hint: "Põe o botão de destacar nas janelas antigas de módulos que ainda não têm (as janelas novas do Foundry 14 já trazem \"Destacar\" no menu ⋮ do título). Os painéis do Atlas e do Cronos têm o botão sempre.", scope: "client", config: true, type: Boolean, default: true });
  hookAppPopout(() => { try { return game.settings.get(MODULE_ID, "popoutBtn"); } catch (e) { return true; } }); });

Hooks.on("canvasReady", () => {
  atlas.selectEdit?.({}); atlas.drawing = null; atlas.cache = {}; atlas.travel.target = undefined; atlas.travel.picking = false; atlas.travel.moverId = null; atlas.anims = {}; atlas.fx = {}; atlas.splitSel = null;
  if (["local", "import"].includes(atlas.panel)) atlas.panel = null; atlas.sel = null; atlas.poiEdit = false; atlas.natRegion = null; atlas.natPlace = null; atlas.liveWx = null;
  if (!mapOf(canvas.scene)) atlas.panel = null;
  atlas.importRows = null; atlas.layerActive = layerActive(); atlas.multi = []; refresh();
});
Hooks.on("canvasPan", () => atlas.refreshMap());
registerBizActions();
for (const h of ["updateScene", "updateActor", "createItem", "updateItem", "deleteItem"]) Hooks.on(h, () => { clearTimeout(globalThis._atlasBizT); globalThis._atlasBizT = setTimeout(refreshBiz, 120); });
for (const h of ["createWall", "updateWall", "deleteWall"]) Hooks.on(h, () => { if (atlas.tool === "vwall") atlas.refreshMap(); });
Hooks.on("canvasTearDown", () => { if (atlas.mapEl) atlas.mapEl.innerHTML = ""; });
Hooks.on("updateScene", (scene, change) => { if (scene.id === canvas?.scene?.id && (change.flags || change.grid)) refresh(); else if (change.flags?.[MODULE_ID]) { atlas.refreshChrome(); if ("movers" in change.flags[MODULE_ID]) atlas.refreshMap(); } }); // unidades de um mapa filho aparecem no pai
for (const h of ["createRegion", "updateRegion", "deleteRegion"]) Hooks.on(h, (r) => { if (r.parent?.id === canvas?.scene?.id) refresh(); });
Hooks.on("updateWorldTime", clockRefresh);
Hooks.on("updateWorldTime", (t) => onWorldTime(t));
Hooks.on("updateWorldTime", () => { try { syncClouds(); atlas.kickSky(); } catch (e) { /* */ } }); // nuvens andam com o relógio do mundo
Hooks.on("cronosRun", () => { try { atlas.kickSky(); } catch (e) { /* */ } });
// clima que muda sozinho com o tempo (opção "Muda sozinho com o tempo" no Clima de cada mapa)
let wxPrevT = null;
Hooks.on("updateWorldTime", async (t) => {
  const prev = wxPrevT ?? t; wxPrevT = t; if (!isActiveGM() || t <= prev) return;
  for (const sc of mapScenes()) { const w = dataOf(sc).weather; const h = Number(w?.auto) || 0; if (!w?.enabled || !h) continue; const p = h * 3600;
    const n = Math.min(3, Math.floor(t / p) - Math.floor(prev / p)); for (let i = 0; i < n; i++) { try { const { rollWeather } = await import("./panels.js"); await rollWeather(sc); } catch (e) { console.warn(`${MODULE_ID} | clima automático`, e); } } }
});
// o céu (luz do mundo, luas, barra do céu, mapa celeste) acompanha o relógio
let skyT = 0; Hooks.on("updateWorldTime", () => { const n = Date.now(); if (n - skyT < 200) return; skyT = n; const m = mapOf(canvas?.scene); if (m && (["mundo", "ceu"].includes(m.level) || m.skybar?.on)) atlas.refreshMap(); }); // tempo andou fora das viagens: os grupos voltam a ficar juntos
// jogo pausado: as viagens param onde estão e seguem ao despausar
Hooks.on("pauseGame", () => { syncPause(); atlas.refreshMap(); });
Hooks.once("ready", () => syncPause());
/* Brumas Oníricas (mundo brumas-recomeco): nomes do mundo tirados dos diários da campanha. Aplicado uma vez, só onde ainda não há nome.
   - Equador: Linha de Aornis (o Tempo: ali o dia e a noite têm a mesma medida o ano todo).
   - Trópicos: o sol no solstício de cada lado está na Mariposa (norte) e no Trono Vazio (sul), como na carta estelar deste céu.
   - Círculos polares: Borealis e Austral, como as cordilheiras e o lago dos extremos (Tratado de Marcus Lorian).
   - Constelação "A Ponte" passa a se chamar Ilhara: perto dela o sol cruza o equinócio de 1º de Lumia (o Sinal da Primeira Luz). */
/* Mapa-múndi de Aether (Brumas Oníricas), uma vez: o fundo novo (Mapa-Múndi Fantástico em Relevo Natural), o nome Aether,
   a escala de um planeta do tamanho da Terra, os continentes, mares e lugares dos diários e as Regiões de terreno
   (desertos, selva, montanhas, neve) tiradas da própria imagem. Desfazer o fundo e o nome: api.revertSeed(cena). */
Hooks.once("ready", async () => {
  try { if (game.world?.id !== "brumas-recomeco" || !isActiveGM() || game.settings.get(MODULE_ID, "lore3")) return;
    await new Promise(r => setTimeout(r, 4000)); // depois dos nomes das linhas e das estrelas
    const w = game.scenes.get("0kyY7vLKvOUB9JZj") ?? mapScenes().find(s => mapOf(s)?.level === "mundo"); if (!w || mapOf(w)?.seed) { await game.settings.set(MODULE_ID, "lore3", true); return; }
    const seed = await fetch(new URL("../data/aether.json", import.meta.url).href).then(r => r.json());
    if (await applySeed(w, seed)) { await game.settings.set(MODULE_ID, "lore3", true); await game.settings.set(MODULE_ID, "lore4", true); }
  } catch (e) { console.warn(`${MODULE_ID} | mapa de Aether`, e); }
});
/* Rótulos de Aether refeitos (palavras curtas, com estilo e borda), uma vez, para quem já tinha o mapa montado. */
Hooks.once("ready", async () => {
  try { if (game.world?.id !== "brumas-recomeco" || !isActiveGM() || game.settings.get(MODULE_ID, "lore4") || !game.settings.get(MODULE_ID, "lore3")) return;
    await new Promise(r => setTimeout(r, 2500));
    const w = game.scenes.get("0kyY7vLKvOUB9JZj") ?? mapScenes().find(s => mapOf(s)?.level === "mundo"); if (!w) return;
    const seed = await fetch(new URL("../data/aether.json", import.meta.url).href).then(r => r.json());
    if (await refreshSeedLabels(w, seed)) await game.settings.set(MODULE_ID, "lore4", true);
  } catch (e) { console.warn(`${MODULE_ID} | rótulos de Aether`, e); }
});
/* Aether mais limpo, uma vez: nomes dos locais só de perto, ícones menores e mais leves, rótulos pequenos e locais naturais só com zoom,
   linhas e números da grade mais discretos. Tudo ajustável em Mapa › Leitura do mapa e Mapa › Mundo › Grade. */
Hooks.once("ready", async () => {
  try { if (game.world?.id !== "brumas-recomeco" || !isActiveGM() || game.settings.get(MODULE_ID, "lore5")) return;
    await new Promise(r => setTimeout(r, 3000));
    const w = game.scenes.get("0kyY7vLKvOUB9JZj"); if (!w || !mapOf(w)) return;
    await w.update({ [`flags.${MODULE_ID}.map.labels`]: "perto", [`flags.${MODULE_ID}.map.read`]: { poiScale: 0.8, poiOpacity: 0.85, labelOpacity: 0.95, nearK: 2, labelDetail: true, minorNear: true },
      [`flags.${MODULE_ID}.map.world.grid.opacity`]: 0.22, [`flags.${MODULE_ID}.map.world.grid.spOpacity`]: 0.4, [`flags.${MODULE_ID}.map.world.grid.labOpacity`]: 0.5 });
    await game.settings.set(MODULE_ID, "lore5", true);
  } catch (e) { console.warn(`${MODULE_ID} | leitura de Aether`, e); }
});
/* Aether: os locais menores voltam a aparecer de longe (a opção escondia demais), uma vez. */
Hooks.once("ready", async () => {
  try { if (game.world?.id !== "brumas-recomeco" || !isActiveGM() || game.settings.get(MODULE_ID, "lore7")) return;
    await new Promise(r => setTimeout(r, 6000)); const w = game.scenes.get("0kyY7vLKvOUB9JZj"); if (!w || !mapOf(w)) return;
    await w.update({ [`flags.${MODULE_ID}.map.read.minorNear`]: false }); await game.settings.set(MODULE_ID, "lore7", true);
  } catch (e) { console.warn(`${MODULE_ID} | leitura de Aether`, e); }
});
/* Mundo que dá a volta: rotas antigas guardadas além da borda viram pedaços que se encontram nas laterais (em todos os mapas). */
Hooks.once("ready", async () => {
  try { if (!isActiveGM()) return; await new Promise(r => setTimeout(r, 8000));
    let n = 0; for (const s of game.scenes) { if (!mapOf(s)) continue; try { n += await splitSeamRoutes(s); } catch (e) { console.warn(`${MODULE_ID} | costuras`, e); } }
    if (n) globalThis.ui?.notifications?.info(`Atlas · ${n} rota(s) que davam a volta ao mundo agora param na borda e continuam do outro lado.`);
  } catch (e) { console.warn(`${MODULE_ID} | costuras`, e); }
});
/* Portais: as rotas de portal antigas viram linhas retas entre portais; círculos da mesma rede ficam ligados entre si. */
Hooks.once("ready", async () => {
  try { if (!isActiveGM()) return; await new Promise(r => setTimeout(r, 9000));
    const n = await migratePortals(); if (n) globalThis.ui?.notifications?.info("Atlas · os portais agora se ligam por linhas retas: as rotas de portal e as redes antigas foram convertidas.");
  } catch (e) { console.warn(`${MODULE_ID} | portais`, e); }
});
/* Aether: a escala do quadro bate com o tamanho do planeta (a largura do mapa = a volta ao mundo no equador). Uma vez. */
Hooks.once("ready", async () => {
  try { if (game.world?.id !== "brumas-recomeco" || !isActiveGM() || game.settings.get(MODULE_ID, "lore10")) return;
    await new Promise(r => setTimeout(r, 2500)); const w = game.scenes.get("0kyY7vLKvOUB9JZj"); const m = w ? mapOf(w) : null; if (!m) return;
    const R = Number(m.world?.globo?.radius) || 6371; const W = w.dimensions?.sceneWidth ?? w.width; const size = w.grid?.size || 100;
    const want = Math.round(2 * Math.PI * R * size / W); const cur = Number(w.grid?.distance) || 0;
    if (want > 0 && Math.abs(cur - want) / want > 0.05) { await w.update({ "grid.distance": want, "grid.units": w.grid?.units || "km" });
      globalThis.ui?.notifications?.info(`Atlas · ${w.name}: escala ajustada ao planeta (raio ${R} km): 1 quadro = ${want} ${w.grid?.units || "km"} (era ${cur}).`); }
    await game.settings.set(MODULE_ID, "lore10", true);
  } catch (e) { console.warn(`${MODULE_ID} | escala de Aether`, e); }
});
/* Aether: Região "Oceano" (água funda) cobrindo o mapa inteiro, com as terras e o gelo dos polos como buracos.
   As terras foram tiradas da própria imagem do mapa (o que é azul é mar). Uma vez. */
Hooks.once("ready", async () => {
  try { if (game.world?.id !== "brumas-recomeco" || !isActiveGM() || game.settings.get(MODULE_ID, "lore9")) return;
    await new Promise(r => setTimeout(r, 5000)); const w = game.scenes.get("0kyY7vLKvOUB9JZj"); if (!w || !mapOf(w)) return;
    if (w.regions?.some(r => r.name === "Oceano")) { await game.settings.set(MODULE_ID, "lore9", true); return; }
    const holes = await fetch(new URL("../data/aether-oceano.json", import.meta.url).href).then(r => r.json());
    const d = w.dimensions ?? {}; const X = d.sceneX ?? 0, Y = d.sceneY ?? 0, W = d.sceneWidth ?? w.width, H = d.sceneHeight ?? w.height;
    const P = (a) => [Math.round(X + a[0] * W), Math.round(Y + a[1] * H)];
    const shapes = [{ type: "polygon", points: [X, Y, X + W, Y, X + W, Y + H, X, Y + H], hole: false },
      ...holes.filter(h => h.length >= 3).map(h => ({ type: "polygon", points: h.flatMap(P), hole: true }))];
    await w.createEmbeddedDocuments("Region", [{ name: "Oceano", color: "#163f73", shapes, flags: { [MODULE_ID]: { zone: { preset: "oceano" } } } }]);
    await game.settings.set(MODULE_ID, "lore9", true);
    globalThis.ui?.notifications?.info(`Atlas · ${w.name}: Região Oceano criada (${holes.length} terras e ilhas como buracos). Navios agora navegam por todo o mar.`);
  } catch (e) { console.warn(`${MODULE_ID} | oceano de Aether`, e); }
});
/* Aether dá a volta: as rotas aéreas perdem o arco feito à mão (agora seguem o círculo máximo) e entram as rotas que cruzam a borda, uma vez. */
Hooks.once("ready", async () => {
  try { if (game.world?.id !== "brumas-recomeco" || !isActiveGM() || game.settings.get(MODULE_ID, "lore8") || !game.settings.get(MODULE_ID, "lore6")) return;
    await new Promise(r => setTimeout(r, 7000)); const w = game.scenes.get("0kyY7vLKvOUB9JZj"); if (!w || !mapOf(w)) return;
    const vias = new Set(["Via Boreal", "Via de Luriél", "Via das Forjas", "Via Poente", "Via Setentrional"]);
    await mutateData(w, (D) => { for (const r of D.routes) if (vias.has(r.name) && r.type === "aerea" && r.points.length === 3) { r.points = [r.points[0], r.points[2]]; r.handles = []; } return ["routes"]; });
    const seed = await fetch(new URL("../data/aether.json", import.meta.url).href).then(r => r.json());
    if (await seedRoutes(w, seed)) await game.settings.set(MODULE_ID, "lore8", true);
  } catch (e) { console.warn(`${MODULE_ID} | rotas de volta ao mundo`, e); }
});
/* Portos, rotas marítimas e rotas aéreas de Aether, uma vez. */
Hooks.once("ready", async () => {
  try { if (game.world?.id !== "brumas-recomeco" || !isActiveGM() || game.settings.get(MODULE_ID, "lore6") || !game.settings.get(MODULE_ID, "lore3")) return;
    await new Promise(r => setTimeout(r, 4000));
    const w = game.scenes.get("0kyY7vLKvOUB9JZj"); if (!w || !mapOf(w)) return;
    const seed = await fetch(new URL("../data/aether.json", import.meta.url).href).then(r => r.json());
    if (await seedRoutes(w, seed)) await game.settings.set(MODULE_ID, "lore6", true);
  } catch (e) { console.warn(`${MODULE_ID} | rotas de Aether`, e); }
});
/* Estrelas com nome (Brumas Oníricas), uma vez:
   - O Trono Vazio: as seis estrelas levam os nomes dos imperadores que batizaram os dias da semana (Albor, Duran, Triven, Quadra, Quorra, Seryn).
     O sétimo, Velin, não tem estrela: é o assento vazio que dá nome à constelação.
   - Altheryon: a estrela brilhante junto do ponto do equinócio de 1º de Lumia, perto de Ilhara (o Sinal da Primeira Luz).
   - Vigia Boreal e Vigia Austral: as guias dos navegantes perto dos polos do céu; e as outras mais brilhantes. */
Hooks.once("ready", async () => {
  try { if (game.world?.id !== "brumas-recomeco" || !isActiveGM() || game.settings.get(MODULE_ID, "lore2")) return;
    await new Promise(r => setTimeout(r, 1500)); // depois dos nomes das linhas e da Ilhara
    for (const w of mapScenes().filter(s => mapOf(s)?.level === "mundo" && mapOf(s).sky)) {
      const sk = normSky(mapOf(w).sky); if (sk.names.length) continue; const L = starList(sk); const consts = sk.consts ?? [];
      const names = []; const trono = consts.find(c => c.name === "O Trono Vazio");
      if (trono) { const refs = [...new Set(trono.lines.flat())].map(r => L.find(s => s.ref === r)).filter(Boolean).sort((a, b) => a.mag - b.mag);
        ["Albor", "Duran", "Triven", "Quadra", "Quorra", "Seryn"].forEach((n, i) => { if (refs[i]) names.push([refs[i].ref, n]); }); }
      const ilhara = new Set((consts.find(c => c.name === "Ilhara")?.lines ?? []).flat());
      const D = Math.PI / 180; const ang = (a, b) => Math.acos(Math.min(1, Math.sin(a.dec * D) * Math.sin(b.dec * D) + Math.cos(a.dec * D) * Math.cos(b.dec * D) * Math.cos((a.ra - b.ra) * D))) / D;
      const fixed = [{ name: "Altheryon", pick: (LL, named) => LL.filter(s => !named.has(s.ref) && !ilhara.has(s.ref) && s.mag < 3.2 && ang(s, { ra: 0, dec: 0 }) < 16).sort((a, b) => a.mag - b.mag)[0] }];
      const all = autoStarNames({ ...sk, names }, 30, { fixed });
      await w.update({ [`flags.${MODULE_ID}.map.sky.names`]: all });
    }
    await game.settings.set(MODULE_ID, "lore2", true);
  } catch (e) { console.warn(`${MODULE_ID} | estrelas da campanha`, e); }
});
Hooks.once("ready", async () => {
  try { if (game.world?.id !== "brumas-recomeco" || !isActiveGM() || game.settings.get(MODULE_ID, "lore1")) return;
    for (const w of mapScenes().filter(s => mapOf(s)?.level === "mundo")) {
      const m = mapOf(w); const cur = m.world?.names ?? {}; const upd = {};
      const names = { eq: "Linha de Aornis", tropN: "Trópico da Mariposa", tropS: "Trópico do Trono Vazio", polN: "Círculo Borealis", polS: "Círculo Austral" };
      for (const [k, v] of Object.entries(names)) if (!cur[k]) upd[`flags.${MODULE_ID}.map.world.names.${k}`] = v;
      if (Array.isArray(m.sky?.consts) && m.sky.consts.some(c => c.name === "A Ponte") && !m.sky.consts.some(c => c.name === "Ilhara")) upd[`flags.${MODULE_ID}.map.sky.consts`] = m.sky.consts.map(c => c.name === "A Ponte" ? { ...c, name: "Ilhara" } : c);
      if (Object.keys(upd).length) await w.update(upd);
    }
    await game.settings.set(MODULE_ID, "lore1", true);
  } catch (e) { console.warn(`${MODULE_ID} | nomes da campanha`, e); }
});
Hooks.on(`${MODULE_ID}.refresh`, () => refresh());
Hooks.on(`${MODULE_ID}.fx`, (msg) => atlas.onFx(msg));
Hooks.on(`${MODULE_ID}.anim`, (msg) => { if (msg.sceneId === canvas?.scene?.id) atlas.onAnim(msg); });
Hooks.on(`${MODULE_ID}.animStop`, (msg) => atlas.onAnimStop(msg));
Hooks.on("renderSceneConfig", (app, html) => injectSceneConfig(app, html));
// fichas mudaram (velocidade, tração): recalcula os planos
let actT = 0; for (const h of ["updateActor", "createActor", "deleteActor"]) Hooks.on(h, () => { const n = Date.now(); if (n - actT < 300) return; actT = n; atlas.cache.plans = {}; atlas.cache.qt = {}; atlas.refresh(); });
window.addEventListener("resize", () => atlas.refreshMap());

// Névoa: todo grupo/personagem visível revela os arredores de onde está (ao ser colocado, arrastado,
// chegar por uma saída de mapa, embarcar...). A viagem já revela o caminho todo.
const seenPos = new Map();
async function revealAroundMovers(scene) {
  if (!isActiveGM() || !scene || !mapOf(scene)?.fog) return; const d = dataOf(scene); const gs = scene.grid?.size ?? 100; const R = (Number(d.map?.reveal ?? 2) || 2) * gs;
  const add = [];
  for (const m of d.movers ?? []) { if (m.parked || m.hidden) continue; const k = `${scene.id}.${m.id}`; const pos = `${Math.round(m.x)}:${Math.round(m.y)}`; if (seenPos.get(k) === pos) continue; seenPos.set(k, pos);
    if (!(d.explored ?? []).some(e => !e[3] && Math.hypot(e[0] - m.x, e[1] - m.y) + R * 0.5 <= e[2])) add.push([Math.round(m.x), Math.round(m.y), Math.round(R)]); }
  if (add.length) await mutateData(scene, (D) => { D.explored.push(...add); if (D.explored.length > 1500) D.explored = D.explored.slice(-1500); return ["explored"]; });
}
Hooks.on("updateScene", (scene, change) => { if (change.flags?.[MODULE_ID]) setTimeout(() => revealAroundMovers(scene), 50); });
Hooks.once("ready", () => setTimeout(() => { for (const s of mapScenes()) revealAroundMovers(s); }, 1500));

// O mapeamento feito no acampamento (Pontos de Apoio) revela os arredores do grupo principal.
Hooks.on("pontos-de-apoio.mapear", async (rec) => {
  if (!isActiveGM() || !rec?.success) return;
  const has = (s) => !!mainMover(dataOf(s));
  const scene = (canvas?.scene && mapOf(canvas.scene) && has(canvas.scene)) ? canvas.scene : mapScenes().find(has);
  if (!scene) return;
  const mv = mainMover(dataOf(scene)); const gs = scene.grid?.size ?? 100; const R = gs * (4 + Math.max(0, Math.floor((rec.margin ?? 0) / 3)));
  await mutateData(scene, (D) => { D.explored.push([Math.round(mv.x), Math.round(mv.y), Math.round(R)]); return ["explored"]; });
  await addLog({ kind: "mapeado", text: `Mapeado no acampamento por ${rec.actorName ?? "alguém"}: os arredores ficaram registrados.`, sceneId: scene.id });
});


/* ---------- pedidos que só o Mestre grava ---------- */
onAction("addNote", async (p, userId) => {
  const n = { id: uid(), userId, sceneId: p.sceneId, x: Number(p.x) || 0, y: Number(p.y) || 0, text: String(p.text ?? "").slice(0, 400), private: !!p.private, kind: p.kind === "dest" ? "dest" : "note", t: game.time.worldTime };
  let list = notes(); if (n.kind === "dest") list = list.filter(x => !(x.kind === "dest" && x.userId === userId));
  await game.settings.set(MODULE_ID, "notes", [...list, n]);
});
onAction("delNote", async (p, userId) => {
  const u = game.users.get(userId);
  await game.settings.set(MODULE_ID, "notes", notes().filter(n => !(n.id === p.id && (u?.isGM || n.userId === userId))));
});
registerGroupActions();
onAction("log", async (p) => addLog({ kind: p.kind, text: String(p.text ?? "").slice(0, 300), sceneId: p.sceneId }));

Hooks.once("ready", () => {
  if (panelSide() !== "barra" || !globalThis.ui?.atlas) { globalThis.ui.atlas = dock; dock.mount(); }
  patchLongPress();
  // mapa filho herdando o clima do pai: as nuvens passam e o clima do lugar muda sozinho
  let lastSky = "";
  setInterval(() => {
    try { if (!atlas.open || !atlas.scene) return; atlas._wxc = null; const w = atlas.wx; const k = JSON.stringify([atlas.scene.id, w.enabled, w.climate, w.link?.cover, w.link?.raining]);
      if (lastSky && k !== lastSky) atlas.refresh(); lastSky = k; } catch (e) { /* */ }
  }, 20000);
  game.socket.on(SOCKET, (msg) => {
    switch (msg?.type) {
      case "action": handleSocketAction(msg); break;
      case "ping": atlas.onPing(msg); break;
      case "view": if ((msg.userIds ?? []).includes(game.user.id) && canvas.scene?.id !== msg.sceneId) game.scenes.get(msg.sceneId)?.view(); break;
      case "notify": if (msg.userId === game.user.id) globalThis.ui?.notifications?.[msg.kind ?? "info"]?.(`Atlas · ${msg.text}`); break;
      case "anim": if (msg.sceneId === canvas?.scene?.id) atlas.onAnim(msg); break;
      case "animStop": atlas.onAnimStop(msg); break;
      case "fx": atlas.onFx(msg); break;
    }
  });
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = {
    ui: atlas, toggle: (v) => atlas.toggle(v), open: (panel) => atlas.showTab(panel ?? null),
    /** Planeja (sem executar) uma viagem do grupo principal até um local. */
    plan: (toId, opts = {}) => { const s = canvas.scene; return planTravel(s, mainMover(dataOf(s)), toId, opts); },
    /** Executa a viagem (Mestre). */
    travel: async (toId, opts = {}) => { const s = canvas.scene; const p = planTravel(s, mainMover(dataOf(s)), toId, opts); return p ? executeTravel(s, p, opts) : null; },
    data: (scene = canvas.scene) => foundry.utils.deepClone(dataOf(scene)),
    /** Luas do mundo no instante t (para o Cronos): [{ name, color, phase (0 nova … 1 cheia), waxing, label }]. */
    moonsAt: (t = game.time.worldTime, scene = canvas?.scene) => { let cfg = null; try { const w = worldOf(scene); cfg = w ? skyOf(w) : null; } catch (e) { /* */ }
      if (!cfg) { const w2 = mapScenes().find(s => mapOf(s)?.level === "mundo" && skyOf(s)); cfg = w2 ? skyOf(w2) : null; } if (!cfg) return [];
      const B = bodiesNow(normSky(cfg), skyTime(t)); return B.list.filter(b => b.kind === "lua").map(b => ({ name: b.name, color: b.color, phase: b.phase, waxing: b.waxing, label: phaseName(b) })); },
    /** Mostrador redondo do céu de agora, visto do mapa aberto (para o relógio do Cronos). null se o mundo não tem céu. */
    skyDial: (t = game.time.worldTime, size = 84, scene = canvas?.scene) => { try { const h = hereNow(scene); const cfg = h ? skyOf(h.world) : null; if (!cfg) return null;
        return renderHorizonDial(normSky(cfg), h.obs, hereWeather(h), size, t); } catch (e) { console.warn(`${MODULE_ID} | mostrador`, e); return null; } },
    /** Faixa do céu (sol e luas no arco do dia, cor do céu e nuvens do clima), na largura pedida. */
    skyBar: (width = 300, scene = canvas?.scene, height = 64, timeLabel = null) => { try { const h = hereNow(scene); const cfg = h ? skyOf(h.world) : null; if (!cfg) return null;
        return renderSkyBar(normSky(cfg), h.obs, hereWeather(h), Math.round(width), height, timeLabel); } catch (e) { return null; } },
    /** Sol no lugar de onde o relógio é visto: { alt (graus acima do horizonte), H (ângulo horário: <0 manhã, >0 tarde), maxAlt } ou null. */
    sunAt: (t = null, scene = canvas?.scene) => { try { const h = hereNow(scene); const cfg = h ? skyOf(h.world) : null; if (!cfg) return null; const sk = normSky(cfg); const T = skyTime(t ?? undefined); const B = bodiesNow(sk, T);
        const sun = eclToEq(B.lamSun, sk.tilt); const lat = h.obs?.lat ?? sk.lat; const lst = sun.ra + (T.dayFrac - 0.5) * 360 + (h.obs?.lon ?? 0); const a = altAz(sun.ra, sun.dec, lat, lst);
        return { alt: a.alt, H: a.H, maxAlt: 90 - Math.abs(lat - sun.dec) }; } catch (e) { return null; } },
    /** De onde o relógio é visto: { label, unit, src, lat, lon } (ou null sem mapa-múndi). */
    _here: (scene = canvas?.scene) => hereNow(scene),
    here: (scene = canvas?.scene) => { try { const h = hereNow(scene); return h ? { label: h.label, unit: h.unit, src: h.src, lat: h.obs?.lat ?? null, lon: h.obs?.lon ?? null, world: h.world.name } : null; } catch (e) { return null; } },
    /** Lista de lugares possíveis e a escolha atual (mestre). */
    herePlaces: (scene = canvas?.scene) => { const w = worldFor(scene); return w ? { cur: mapOf(w)?.here || "auto", list: herePlaces(w) } : null; },
    setHere: async (v, scene = canvas?.scene) => { const w = worldFor(scene); if (!w || !game.user.isGM) return; await w.update({ [`flags.${MODULE_ID}.map.here`]: v || "auto" }); },
    /** Estação no lugar de onde se olha, pela inclinação do planeta: { idx (0 primavera … 3 inverno) | null, extra, zone, lat } ou null (usa o calendário). */
    seasonAt: (t = game.time.worldTime, scene = canvas?.scene) => { try { const h = hereNow(scene); return h ? seasonAt(h.wd, h.obs, skyTime(t)) : null; } catch (e) { return null; } },
    /** Abre (ou fecha) o céu por cima da cena: view = "carta" | "noite" | "sistema". */
    openSky: (view = null) => atlas.openSky(view),
    /** Janela do céu (carta estelar, céu de hoje ou sistema), que pode ser movida, redimensionada e destacada. */
    openSkyWindow: (view = null) => openSkyWindow(view),
    /** Destaca qualquer elemento numa janela própria (ou traz de volta). */
    popout: (el, opts) => togglePop(el, opts),
    /** Pacote de mapa: troca o fundo e povoa (locais, rótulos, Regiões) a partir de um JSON; revertSeed desfaz fundo, nome e escala. */
    applySeed: (scene, seed) => applySeed(scene, seed), revertSeed: (scene = canvas?.scene) => revertSeed(scene),
    /** Clima de agora no mapa aberto: { label, climate, temp, wind, players } ou null. */
    weatherNow: (scene = canvas?.scene) => { try { const h = hereNow(scene); const sc = h?.scene ?? scene; if (!mapOf(sc)) return null; const w = h ? hereWeather(h) : effectiveWeather(sc); if (!w?.enabled) return null; return { climate: w.climate, label: CLIMATES[w.climate]?.label ?? w.climate, temp: w.temp, wind: w.force, dir: w.dir, players: w.players !== false, place: h?.label ?? sc.name }; } catch (e) { return null; } }
  };
  // céu antigo (cena de nível Céu): passa a morar no próprio mapa-múndi, para abrir por cima de qualquer cena
  if (isActiveGM()) for (const w of mapScenes().filter(s => mapOf(s)?.level === "mundo" && !mapOf(s).sky)) { const old = legacySkyScene(w); if (old && mapOf(old).sky) w.update({ [`flags.${MODULE_ID}.map.sky`]: foundry.utils.deepClone(mapOf(old).sky) }).catch(() => null); }
  refresh();
});

// ↺ ao lado das barrinhas: volta ao valor padrão (dispara os mesmos eventos de quem arrasta)
document.addEventListener("click", (e) => {
  const b = e.target.closest?.(".rreset"); if (!b) return; e.preventDefault(); e.stopPropagation();
  const row = b.closest(".row2") ?? b.parentElement; const def = b.dataset.def; const rng = row?.querySelector("input[type=range]"); if (!rng) return;
  for (const i of row.querySelectorAll("input")) i.value = def;
  rng.dispatchEvent(new Event("input", { bubbles: true })); rng.dispatchEvent(new Event("change", { bubbles: true }));
}, true);
