// Camada do Atlas sobre o canvas (shadow DOM, isolada do CSS do Foundry): rotas, locais, elementos móveis,
// rosa dos ventos, névoa, notas e pings. Os painéis ficam na aba "Atlas" da barra lateral (sidebar.js).
import { MODULE_ID, SOCKET, POI_KINDS, POI_STATES, ROUTE_TYPES, MOVER_KINDS, CLIMATES, BEAUFORT, DIRS16, DASH_PATTERN, labelStyle, labelCss } from "./config.js";
import { dataOf, mapOf, normPoi, normRoute, normMover, normWeather, esc, notes, uiPref, setUiPref, userColor, mutateData, pnow, isMap } from "./data.js";
import { smoothPath, polyLength, pointAt, bezierSegs, segsPath, handleVecs, dragHandle, curvePoints } from "./geom.js";
import { zonesOf, bridgesOf, travelActive, cancelTravel } from "./travel.js";
import { ic, icFilled } from "./icons.js";
import { travelText, tabOf } from "./panels.js";
import { editorDown, editorMove, editorUp, editorKey, editorClickMap, editorContext, isLocked, insertPoint, deleteSelection, finishRegion } from "./editor.js";
import { shownPlan, currentGroup, groupsOf, notifyVotes, canDrive, selectGroup, unitsInside, nextStop } from "./groups.js";
import { transportOf, transportIcon, actorRef } from "./transport.js";
import { syncClouds, renderWeatherFx, effectiveWeather, poiSky } from "./wxfx.js";
import { TOOL_OF, atlasLayer, layerActive } from "./layer.js";
import { openRoseConfig } from "./roseconfig.js";
import { isVec, vecDown, vecMoveAll, vecUp, vecDbl, vecContext, vecKey, renderVec, renderVBar, vx, vecEnter, vecExit } from "./vector.js";
import { request, saveData, setHud, setHudAuto, gesture, hudRose, setting, undoAtlas, undoCount } from "./data.js";
import { isWorld, normWorld, renderWorld, readoutAt, dragValue, withValues, moonSpots, observerAt, skyOf, observerFor, worldOf, VSKY, legacySkyScene } from "./world.js";
import { SKY_VIEWS } from "./sky.js";
import { normSky, renderSky, skyReadout, bodiesNow, moonIcon, phaseName, renderSkyBar, viewsFor, makeConsts } from "./sky.js";
import { chainOf } from "./data.js";
import { wrapOf, globeOf, wrapX, crossesEdge, copiesFor, isGc, routeLine, polySegs, seamGhosts } from "./wrap.js";
const LABEL_DETAIL = new Set(["local", "rio", "antigo"]);
const readOf = (m) => { const r = m?.read ?? {}; const n = (v, d, a, b) => { v = Number(v); return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d; };
  return { poiScale: n(r.poiScale, 1, 0.3, 2), poiOpacity: n(r.poiOpacity, 1, 0.1, 1), labelOpacity: n(r.labelOpacity, 1, 0.1, 1), nearK: n(r.nearK, 2, 1, 8), labelDetail: !!r.labelDetail, minorNear: !!r.minorNear }; };

export const CSS_URL = new URL("../styles/atlas.css", import.meta.url).href;
/** Saída e chegada suaves, velocidade constante no meio. */
const TP_REDUCED = (() => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } })();
/** Um quadro da animação de teleporte: a (partida) e b (chegada) em pixels da tela, u = 0…1 do salto. */
function tpSvg(a, b, u, col, id, mode = null) {
  const cl = (x) => Math.max(0, Math.min(1, x)); const k = String(id).replace(/[^a-z0-9]/gi, "");
  const R = 46, oS = (x) => 1 - Math.pow(1 - cl(x), 3);
  if (TP_REDUCED) { const fa = u < 0.5 ? 1 - Math.abs(u - 0.25) / 0.25 : 0, fb = u >= 0.5 ? 1 - Math.abs(u - 0.75) / 0.25 : 0;
    return `<svg><circle cx="${a.x}" cy="${a.y}" r="${R}" fill="${col}" opacity="${(cl(fa) * 0.6).toFixed(3)}"/><circle cx="${b.x}" cy="${b.y}" r="${R}" fill="${col}" opacity="${(cl(fb) * 0.6).toFixed(3)}"/></svg>`; }
  const out = [`<defs><radialGradient id="tpg${k}"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".35" stop-color="${col}" stop-opacity=".75"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></radialGradient>
    <linearGradient id="tpc${k}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".25" stop-color="${col}" stop-opacity=".7"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient>
    <filter id="tpb${k}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter></defs>`];
  const runes = (c, s, op, rot) => { if (op <= 0.01 || s <= 0.01) return ""; let t = "";
    for (let i = 0; i < 12; i++) { const an = (i * 30 + rot) * Math.PI / 180, r1 = R * s * 0.86, r2 = R * s * (i % 3 ? 0.94 : 1.04); t += `<line x1="${c.x + Math.cos(an) * r1}" y1="${c.y + Math.sin(an) * r1 * 0.55}" x2="${c.x + Math.cos(an) * r2}" y2="${c.y + Math.sin(an) * r2 * 0.55}"/>`; }
    return `<g opacity="${op.toFixed(3)}" stroke="${col}" fill="none" stroke-linecap="round"><ellipse cx="${c.x}" cy="${c.y}" rx="${R * s * 1.4}" ry="${R * s * 0.8}" fill="url(#tpg${k})" stroke="none" opacity=".55"/>
      <ellipse cx="${c.x}" cy="${c.y}" rx="${R * s}" ry="${R * s * 0.55}" stroke-width="2.2"/><ellipse cx="${c.x}" cy="${c.y}" rx="${R * s * 0.72}" ry="${R * s * 0.4}" stroke-width="1.4" stroke-dasharray="6 5" stroke-dashoffset="${(-rot / 4).toFixed(1)}"/>
      <g stroke-width="1.8">${t}</g><ellipse cx="${c.x}" cy="${c.y}" rx="${R * s}" ry="${R * s * 0.55}" stroke="#fff" stroke-width="1" opacity=".6" filter="url(#tpb${k})"/></g>`; };
  // partida: runas acendem, a coluna de luz sobe, o grupo vira fagulhas
  // (sem círculo de runas embaixo: só a luz)
  if (u < 0.45) { const gl = u < 0.12 ? u / 0.12 : cl(1 - (u - 0.3) / 0.15); out.push(`<ellipse cx="${a.x}" cy="${a.y}" rx="${R * 1.1}" ry="${R * 0.55}" fill="url(#tpg${k})" opacity="${(gl * 0.7).toFixed(3)}"/>`); }
  const colH = 260 * oS((u - 0.08) / 0.25), colOp = u < 0.4 ? cl((u - 0.08) / 0.1) : cl(1 - (u - 0.4) / 0.15);
  if (colOp > 0.01) out.push(`<rect x="${a.x - 15}" y="${a.y - colH}" width="30" height="${colH}" rx="15" fill="url(#tpc${k})" opacity="${colOp.toFixed(3)}" filter="url(#tpb${k})"/><rect x="${a.x - 4}" y="${a.y - colH}" width="8" height="${colH}" rx="4" fill="url(#tpc${k})" opacity="${colOp.toFixed(3)}"/>`);
  for (let i = 0; i < 14; i++) { const p0 = 0.1 + (i % 7) * 0.025, pu = cl((u - p0) / 0.32); if (pu <= 0 || pu >= 1) continue; const an = i * 2.39996;
    out.push(`<circle cx="${a.x + Math.cos(an) * R * 0.7 * (1 - pu * 0.6)}" cy="${a.y - pu * 150 - Math.sin(an) * 8}" r="${(2.6 * (1 - pu) + 0.6).toFixed(2)}" fill="${i % 3 ? col : "#fff"}" opacity="${(1 - pu).toFixed(3)}"/>`); }
  // o caminho oculto aparece como um arco de luz, da partida à chegada
  const d = Math.hypot(b.x - a.x, b.y - a.y), lift = Math.min(260, Math.max(60, d * 0.35)); const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2 - lift;
  const pDraw = cl((u - 0.3) / 0.3), arcOp = u < 0.78 ? 1 : cl(1 - (u - 0.78) / 0.17);
  if (pDraw > 0 && arcOp > 0.01 && !mode) { const path = `M${a.x} ${a.y - 20}Q${cx} ${cy} ${b.x} ${b.y - 20}`; const off = (1 - pDraw).toFixed(4);
    const t = pDraw, hx = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * cx + t * t * b.x, hy = (1 - t) * (1 - t) * (a.y - 20) + 2 * (1 - t) * t * cy + t * t * (b.y - 20);
    out.push(`<g opacity="${arcOp.toFixed(3)}" fill="none" stroke-linecap="round"><path d="${path}" pathLength="1" stroke="${col}" stroke-width="10" stroke-dasharray="1 1" stroke-dashoffset="${off}" opacity=".35" filter="url(#tpb${k})"/>
      <path d="${path}" pathLength="1" stroke="${col}" stroke-width="3" stroke-dasharray="1 1" stroke-dashoffset="${off}"/><path d="${path}" pathLength="1" stroke="#fff" stroke-width="1.2" stroke-dasharray="1 1" stroke-dashoffset="${off}" opacity=".8"/>
      ${pDraw < 1 ? `<circle cx="${hx}" cy="${hy}" r="9" fill="url(#tpg${k})"/><circle cx="${hx}" cy="${hy}" r="3" fill="#fff"/>` : ""}</g>`); }
  // chegada: o círculo de destino acende, clarão, o grupo se forma de novo
  const uB = cl((u - 0.55) / 0.45); if (uB > 0) { const sB = oS(uB / 0.35), opB = uB < 0.7 ? 1 : cl(1 - (uB - 0.7) / 0.3);
    void sB; void opB;
    const fl = uB < 0.3 ? uB / 0.3 : cl(1 - (uB - 0.3) / 0.4); if (fl > 0.01) out.push(`<circle cx="${b.x}" cy="${b.y}" r="${R * (0.6 + 1.8 * oS(uB / 0.5))}" fill="url(#tpg${k})" opacity="${(fl * 0.9).toFixed(3)}"/>`); }
  return `<svg>${out.join("")}</svg>`;
}
/** Onde está quem viaja no instante `now` (e, num teleporte, em que fase do salto). */
function animAt(a, now) {
  const t = Math.max(0, now - a.t0); const f = Math.min(1, t / a.dur);
  if (!a.tp?.jumps?.length) return { pt: pointAt(a.pts, (a.len ??= polyLength(a.pts)) * ease(f)), f, jump: null };
  if (!a.seg) { const J = new Map(a.tp.jumps.map(j => [j.i, j])); let L = 0; const D = (A, B) => Math.hypot(B[0] - A[0], B[1] - A[1]);
    for (let k = 1; k < a.pts.length; k++) if (!J.has(k - 1)) L += D(a.pts[k - 1], a.pts[k]);
    const segs = []; let t0 = 0;
    for (let k = 1; k < a.pts.length; k++) { const A = a.pts[k - 1], B = a.pts[k]; const j = J.get(k - 1); const d = j ? (j.seam ? 0 : a.tp.jumpMs) : (L > 0 ? D(A, B) / L * a.tp.moveMs : 0); segs.push({ A, B, t0, t1: t0 + d, j }); t0 += d; }
    a.seg = segs; }
  const segs = a.seg; if (!segs.length) return { pt: a.pts[a.pts.length - 1], f, jump: null };
  let s = segs[segs.length - 1]; for (const x of segs) if (t < x.t1) { s = x; break; }
  const u = s.t1 > s.t0 ? Math.min(1, Math.max(0, (t - s.t0) / (s.t1 - s.t0))) : 1;
  if (s.j) { if (s.j.seam) return { pt: s.B, f, jump: null };
    const ue = s.j.mode === "out" ? u * 0.5 : s.j.mode === "in" ? 0.5 + u * 0.5 : u; // só a partida ou só a chegada (teleporte entre mapas)
    return { pt: ue < 0.5 ? s.A : s.B, f, jump: { ...s.j, A: s.A, B: s.B, u: ue } }; }
  return { pt: [s.A[0] + (s.B[0] - s.A[0]) * u, s.A[1] + (s.B[1] - s.A[1]) * u], f, jump: null };
}
const ease = (t) => { const a = 0.18; if (t <= 0) return 0; if (t >= 1) return 1; const v = 1 / (1 - a); if (t < a) return v * t * t / (2 * a); if (t > 1 - a) return 1 - v * (1 - t) * (1 - t) / (2 * a); return v * (t - a / 2); };
const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return h; };
export const dirName = (deg) => DIRS16[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

class AtlasUI {
  host = null; sh = null; mapEl = null; #raf = null; #global = false; #justDragged = false;
  open = true; panel = null; sel = null; selRoute = null; selLabel = null; selMover = null; tool = "sel"; drawing = null; drag = null;
  hover = null; pings = []; anims = {}; fx = {}; proposals = []; travel = { target: undefined, picking: false, hover: null, moverId: null, pace: "normal", way: "estradas", preview: null, opts: { time: true, encounters: true, reveal: true, crossRough: false } };
  codexTab = "locais"; noteDraft = null; importRows = null; cache = {}; mouse = null; newPoi = { kind: "local", state: "avistado" }; newMover = { kind: "grupo" };

  get scene() { return canvas?.ready ? canvas.scene : null; }
  get map() { return mapOf(this.scene); }
  get data() { return dataOf(this.scene); }
  get view() { return canvas?.app?.canvas ?? canvas?.app?.view ?? null; }
  get gs() { return this.scene?.grid?.size ?? 100; }
  /** Clima que vale neste mapa agora (o próprio ou o do mapa pai, conforme as nuvens). Guardado por 2 s. */
  get wx() {
    const sc = this.scene; const raw = this.data?.weather; const t = Date.now(); const c = this._wxc;
    if (c && c.id === sc?.id && c.raw === raw && t - c.t < 2000) return { ...c.w, rose: { ...hudRose(), north: c.w.rose.north } };
    const w = sc ? effectiveWeather(sc) : normWeather(raw); this._wxc = { id: sc?.id, raw, t, w }; return w;
  }
  get zoom() { return canvas?.stage?.worldTransform?.a ?? 1; }
  get gmView() { return game.user.isGM && uiPref("gmView", true); }
  get layers() {
    const base = { fog: true, zones: false, routes: true, pois: true, labels: true, notes: true, rose: true, wxfx: true, grid: true };
    return game.user.isGM ? { ...base, ...(uiPref("layers", {})) } : base; // jogadores não mexem nas camadas
  }
  /** O mestre edita o mapa direto nas abas Mapa, Pontos, Rotas e Natureza. */
  /** O mestre edita o mapa com a camada Atlas ativa (barra da esquerda): assim nada do Atlas é mexido trabalhando com tokens. */
  get editing() { return game.user.isGM && this.gmView && this.layerActive; }
  /** Fora do modo edição, arrastar locais, rótulos, rotas e as linhas do mundo fica travado. */
  get editLock() { return !uiPref("editMode", false); }
  async setEditMode(on) { await setUiPref("editMode", !!on);
    // o cadeado do botão acompanha o estado: fechado = travado, aberto = editando
    for (const b of document.querySelectorAll('[data-tool="atlasEdit"]')) { b.classList.toggle("fa-lock", !on); b.classList.toggle("fa-lock-open", !!on); const tip = on ? "Modo edição ligado: clique para travar o mapa" : "Mapa travado: clique para liberar a edição"; b.dataset.tooltip = tip; b.setAttribute("aria-label", tip); }
    try { const c = globalThis.ui?.controls?.controls?.atlas?.tools?.atlasEdit; if (c) { c.icon = on ? "fa-solid fa-lock-open" : "fa-solid fa-lock"; c.title = on ? "Modo edição ligado: clique para travar o mapa" : "Mapa travado: clique para liberar a edição"; c.active = !!on; } } catch (e) { /* */ } globalThis.ui?.notifications?.info(on ? "Atlas · modo edição: dá para arrastar o que está no mapa." : "Atlas · mapa travado: nada é arrastado sem querer (as unidades continuam andando)."); this.refresh(); }
  layerActive = false; multi = []; marquee = null; brush = null; cdrag = null;
  /* ---------- gestos: apontar e fincar bandeira ---------- */
  #gest = null; #eatCtx = false; #rdown = null;
  #onBoard(e) { const v = this.view; const t = e.target; return !!v && (t === v || t === this.host || t?.id === "board" || !!t?.closest?.("#board")); }
  #gestureDown(e) {
    this.#eatCtx = false; // um clique novo: o menu do botão direito volta a valer
    this.#rdown = null; if (!this.open || !this.scene || !this.map || !this.#onBoard(e)) return;
    if (e.button === 2) this.#rdown = { x: e.clientX, y: e.clientY };
    const fl = gesture("gestureFlag"), pt = gesture("gesturePoint");
    if (e.button === 2 && ((fl === "shift-right" && e.shiftKey) || (fl === "alt-right" && e.altKey))) { this.#eatCtx = true; this.placeFlag(e); e.preventDefault(); e.stopPropagation(); return; }

    if (e.button === 2 && fl === "hold-right") {
      const x = e.clientX, y = e.clientY;
      this.#gest = { x, y, t: setTimeout(() => { this.#gest = null; this.#eatCtx = true; this.placeFlag({ clientX: x, clientY: y }); }, 550) };
    }
  }
  /** Camada do céu e do mundo (por baixo de tudo): também é redesenhada sozinha, várias vezes por segundo, enquanto o tempo anda. */
  #skyLayer(sc, m, z, W, H, gm) {
    const svg = [], defs = [], html = [];
    if (m.level === "ceu") { try { const sk = normSky(m.sky ?? {}); const obs = this.skyObs?.sceneId === sc.id ? this.skyObs : null; if (obs && this.skyViewOverride) sk.view = this.skyViewOverride; const r = renderSky(sc, sk, (x, y) => this.w2s(x, y), z, W, H, obs); defs.push(r.defs); svg.push(r.svg); html.push(r.html); } catch (e) { console.warn(`${MODULE_ID} | céu`, e); } }
    if (isWorld(m)) { try { let wd = normWorld(m.world ?? {}); if (this.wdrag?.vals) wd = withValues(wd, this.wdrag.vals); if (this.wprev) wd = withValues(wd, this.wprev); if (this.layers.grid === false) wd = { ...wd, grid: { ...wd.grid, on: false } }; const r = renderWorld(sc, wd, (x, y) => this.w2s(x, y), z, W, H, game.user.isGM && gm && !this.editLock); defs.push(r.defs); svg.push(r.svg); html.push(r.html);
        if (wd.luz.moons) { const skyC = skyOf(sc); if (skyC) { const sk = normSky(skyC); const B = bodiesNow(sk); const moons = B.list.filter(b => b.kind === "lua"); const spots = moonSpots(sc, wd, B.list, B.lamSun, sk.tilt);
          if (spots.length) { svg.push(`<g class="sky wmoon">${spots.map(o => { const q = this.w2s(o.x, o.y); return moonIcon(q.x, q.y, 9, o.m); }).join("")}</g>`); for (const o of spots) { const q = this.w2s(o.x, o.y); html.push(`<span class="sklab body" style="left:${q.x.toFixed(1)}px;top:${(q.y + 20).toFixed(1)}px">${esc(o.m.name)} · ${esc(phaseName(o.m))}</span>`); } }
          else if (moons.length) html.push(`<div class="wmoons">${moons.map(mm => `<span><svg width="18" height="18" class="sky">${moonIcon(9, 9, 7, mm)}</svg>${esc(mm.name)} · ${esc(phaseName(mm))}</span>`).join("")}</div>`); } } } catch (e) { console.warn(`${MODULE_ID} | mundo`, e); } }
    return `<svg class="svg" width="${W}" height="${H}"><defs>${defs.join("")}</defs>${svg.join("")}</svg>${html.join("")}`;
  }
  /** Enquanto o tempo anda (Cronos em "play"), o céu, o sol e as luas se movem suavemente (~12 quadros por segundo). */
  #skyRaf = null; #skyLast = 0;
  #skyAnim() {
    if (this.#skyRaf) return; const m = mapOf(this.scene); if (!m) return;
    // intervalo entre quadros: tempo andando (Cronos em ▶) → ~12 por segundo; só o vento nas nuvens da barra do céu → ~4 por segundo
    const gap = () => { const mm = mapOf(this.scene); if (!mm || !this.open) return 0; const cr = game.modules.get("brumas-cronos"); const run = !!(cr?.active && cr.api?.running?.());
      const sky = !!this.skyOv || mm.level === "ceu" || (mm.level === "mundo" && (normWorld(mm.world ?? {}).luz.on || normWorld(mm.world ?? {}).luz.moons)) || !!mm.skybar?.on;
      if (run && (sky || (this.wx?.enabled && this.layers?.wxfx !== false))) return 80; if (this.skyOv || mm.skybar?.on) return 250; return 0; };
    if (!gap()) return;
    const loop = (ts) => { const g = gap(); if (!g) { this.#skyRaf = null; return; } if (ts - this.#skyLast > g && !this.wdrag && !this.drag) { this.#skyLast = ts; try { this.refreshSky(); syncClouds(); } catch (e) { /* */ } } this.#skyRaf = requestAnimationFrame(loop); };
    this.#skyRaf = requestAnimationFrame(loop);
  }
  kickSky() { this.#skyAnim(); }
  /** Redesenha só o céu, o mundo e a barra do céu (sem mexer no resto do mapa). */
  refreshSky() {
    const sc = this.scene; const m = mapOf(sc); if (!sc || !m || !this.open || !this.view || !this.mapEl) return;
    const el = this.mapEl.querySelector(":scope > .wlayer"); if (!el) return; const W = window.innerWidth, H = window.innerHeight;
    el.innerHTML = this.#skyLayer(sc, m, this.zoom, W, H, this.gmView);
    const sb = this.hudEl?.querySelector(".skybarwrap"); if (sb) { const h = this.#skyBar(sc, m, W, this.gmView); if (h != null) sb.innerHTML = h; }
    const ov = this.hudEl?.querySelector(".skyov-body"); if (ov) ov.innerHTML = this.#skyOverlayBody();
  }
  #skyBar(sc, m, W, gm) {
    if (!(["regiao", "cidade", "local"].includes(m.level) && m.skybar?.on && (game.user.isGM && gm || m.skybar.players))) return null;
    try { const of = observerFor(sc); const sk = normSky(of.sky ?? {}); let lbl = null; try { const cr = game.modules.get("brumas-cronos"); if (cr?.active && cr.api?.timeHidden?.()) lbl = cr.api.publicTime(); } catch (e) { /* */ }
      return renderSkyBar(sk, of.obs, this.wx, Math.round(Math.max(320, Math.min(760, W * 0.42))), 64, lbl); } catch (e) { console.warn(`${MODULE_ID} | barra do céu`, e); return null; }
  }
  /** Mapa-múndi: segurar uma linha (trópico, círculo polar, caminho do sol, borda) e arrastar. */
  #worldDown(e) {
    if (e.button !== 0 || !game.user.isGM || this.editLock) return false; const el = e.target.closest?.("[data-wline]"); if (!el) return false;
    e.preventDefault(); e.stopPropagation(); this.wdrag = { key: el.dataset.wline, vals: null, moved: false }; return true;
  }
  async #worldRename(key) {
    const wd = normWorld(mapOf(this.scene)?.world ?? {}); const cur = wd.names[key] ?? ""; if (!(key in wd.names)) return;
    const name = await foundry.applications.api.DialogV2.prompt({ window: { title: "Atlas · Renomear linha" }, content: `<label style="display:flex;flex-direction:column;gap:4px">Nome<input type="text" name="n" value="${esc(cur)}" autofocus></label>`, ok: { label: "Salvar", callback: (ev, btn) => btn.form.elements.n.value }, rejectClose: false }).catch(() => null);
    if (name == null) return; await saveData(this.scene, { [`map.world.names.${key}`]: String(name).trim() }); this.refresh();
  }
  /** Botão do céu: abre o mapa celeste do mundo, visto do lugar onde você está (ou volta de lá). */
  /**
   * Céu: abre por cima da cena aberta (não é outra cena). Carta estelar, Céu de hoje (visto daqui) ou Sistema.
   * Chamado pelo botão da lua na barra lateral e pelo mostrador do Cronos.
   */
  openSky(view = null) {
    if (this.skyOv && !view) { this.closeSky(); return; }
    const sc = canvas?.scene; const world = sc ? worldOf(sc) : null;
    if (!world) { globalThis.ui?.notifications?.warn("Atlas · este mapa não está dentro de um mapa-múndi (defina o Mapa pai até chegar ao Mundo)."); return; }
    const cfg = skyOf(world); if (!cfg) { globalThis.ui?.notifications?.warn(`Atlas · ${world.name} ainda não tem céu${game.user.isGM ? ": crie no mapa-múndi, em Mapa › Céu" : ""}.`); return; }
    const sk = normSky(cfg); const allowed = viewsFor(sk);
    if (!allowed.length) { globalThis.ui?.notifications?.info("Atlas · o mestre ainda não liberou o céu para os jogadores."); return; }
    // de onde se olha: o mesmo lugar do relógio (onde os jogadores estão, ou o marcado pelo mestre)
    let of = { obs: null }; try { const h = game.modules.get("brumas-atlas")?.api?._here?.(sc);
      of = h?.world?.id === world.id ? { obs: h.obs } : world.id === sc.id ? (() => { const g = currentGroup(this); return g ? observerFor(sc, { x: g.x, y: g.y }) : { obs: null }; })() : observerFor(sc); } catch (e) { /* */ }
    // abre na vista pedida, ou na "Vista inicial" do céu (se este usuário puder ver)
    const last = uiPref("skyLastView", null); // a última vista que este usuário escolheu
    const v = view && allowed.includes(view) ? view : last && allowed.includes(last) ? last : allowed.includes(sk.view) ? sk.view : allowed[0];
    this.skyOv = { worldId: world.id, view: v, obs: of.obs ? { ...of.obs, name: of.obs.name ?? sc.name } : null, fresh: true, edit: false, sel: null, con: null, mag: 2, drag: null, geom: null };
    this.refreshMap(); this.#skyAnim();
  }
  closeSky() { this.skyOv = null; this.refreshMap(); }
  /** Espaço livre no alto (o relógio do Cronos fica lá). */
  #skyTop() { const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cronos-top-gap")); return Number.isFinite(v) && v > 0 ? v : 12; }
  /** Desenho do céu aberto por cima da cena (tela inteira). */
  #skyOverlayBody() {
    const o = this.skyOv; const world = game.scenes.get(o?.worldId); const cfg = world ? skyOf(world) : null; if (!cfg) return "";
    const sk = normSky(cfg); sk.view = o.view; const W = window.innerWidth, H = window.innerHeight; const top = this.#skyTop() + 52, pad = 30;
    const k = o.view === "noite" ? Math.min((W - pad * 2) / 1500, (H - top - pad) / 1500) * 1.06 : Math.min((W - pad * 2) / 3000, (H - top - pad) / 1500);
    const ox = (W - 3000 * k) / 2, oy = top + (H - top - 1500 * k) / 2; const P = (x, y) => ({ x: x * k + ox, y: y * k + oy });
    o.geom = { k, ox, oy };
    const edit = !!(o.edit && game.user.isGM && o.view === "carta");
    const r = renderSky(VSKY, sk, P, k, W, H, o.view === "noite" ? o.obs : null, { edit, drag: o.drag, sel: o.sel, con: o.con, sunClick: true });
    return `<svg class="svg" width="${W}" height="${H}"><defs>${r.defs}</defs>${r.svg}</svg>${r.html}`;
  }
  #skyOverlay() {
    const o = this.skyOv; if (!o) return ""; const world = game.scenes.get(o.worldId); if (!world) return ""; const cfg = skyOf(world); const sk = normSky(cfg ?? {});
    const views = viewsFor(sk); const gm = game.user.isGM; const fresh = o.fresh; o.fresh = false;
    let edit = "";
    if (gm && o.view === "carta") {
      edit = `<button type="button" class="skyov-ed ${o.edit ? "on" : ""}" data-skyov="edit" title="Colocar, arrastar, apagar e ligar estrelas">✎ Estrelas</button>`;
      if (o.edit) { const consts = sk.consts ?? makeConsts(sk);
        edit += `<label class="skyov-f">Brilho<select data-skyovf="mag">${[[0.5, "Fortíssima"], [1.5, "Forte"], [2.5, "Média"], [3.5, "Fraca"], [4.5, "Tênue"]].map(([v, l]) => `<option value="${v}" ${Number(o.mag) === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <label class="skyov-f">Constelação<select data-skyovf="con"><option value="">— ligações soltas —</option>${consts.map(c => `<option value="${esc(c.id)}" ${o.con === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}<option value="+new">+ Nova constelação…</option></select></label>
          ${o.con ? `<button type="button" data-skyov="conRen" title="Renomear a constelação">✎</button><button type="button" data-skyov="conDel" title="Apagar a constelação (as estrelas ficam)">🗑</button>` : ""}`; }
    }
    const help = o.edit && gm && o.view === "carta" ? `<div class="skyov-help">Clique no céu: nova estrela · arraste: mover · clique duplo: nome · clique numa estrela e Shift+clique noutra: ligar ou desligar · botão direito: apagar</div>` : "";
    return `<div class="skyov${fresh ? " fresh" : ""}${o.edit && o.view === "carta" ? " editing" : ""}"><div class="skyov-body">${this.#skyOverlayBody()}</div>
      <div class="skyov-bar"><b>Céu de ${esc(mapOf(world)?.title || world.name)}</b>${o.view === "noite" && o.obs?.name ? `<small>visto de ${esc(o.obs.name)}</small>` : ""}
        ${views.length > 1 ? `<div class="skyov-tabs">${views.map(k => `<button type="button" data-skyov="view" data-v="${k}" class="${o.view === k ? "on" : ""}">${esc(SKY_VIEWS[k])}</button>`).join("")}</div>` : ""}
        ${edit}<button type="button" class="skyov-x" data-skyov="close" title="Fechar (Esc)">✕</button></div>${help}</div>`;
  }
  /* ---------- edição das estrelas (mestre, na carta estelar) ---------- */
  /** Onde fica a configuração do céu (no mapa-múndi; nos mundos antigos, na cena de Céu). */
  #skyDoc() { const world = game.scenes.get(this.skyOv?.worldId); if (!world) return null; const m = mapOf(world); if (m?.level === "mundo" && !m.sky) { const old = legacySkyScene(world); if (old) return old; } return world; }
  async #saveSky(patch) { const doc = this.#skyDoc(); if (!doc || !game.user.isGM) return; const upd = {}; for (const [k, v] of Object.entries(patch)) upd[`flags.${MODULE_ID}.map.sky.${k}`] = v; await doc.update(upd); }
  #skySk() { const world = game.scenes.get(this.skyOv?.worldId); return world ? normSky(skyOf(world) ?? {}) : null; }
  /** Tela → ascensão reta e declinação (carta estelar). */
  #skyAt(x, y) { const g = this.skyOv?.geom; if (!g) return null; const X = (x - g.ox) / g.k, Y = (y - g.oy) / g.k; if (X < 0 || X > 3000 || Y < 0 || Y > 1500) return null; return { ra: (((1 - X / 3000) * 360) % 360 + 360) % 360, dec: Math.max(-89.5, Math.min(89.5, 90 - Y / 1500 * 180)) }; }
  #refreshSkyBody() { const ov = this.hudEl?.querySelector(".skyov-body"); if (ov) ov.innerHTML = this.#skyOverlayBody(); }
  #parseRef(v) { return /^x:/.test(v) ? v : Number(v); }
  #skyDown(e) {
    const o = this.skyOv; if (!o?.edit || !game.user.isGM || o.view !== "carta" || e.button !== 0) return false;
    if (!e.target.closest?.(".skyov-body")) return false;
    e.preventDefault(); e.stopPropagation();
    const st = e.target.closest?.("[data-star]");
    if (st) {
      const ref = this.#parseRef(st.dataset.star);
      if (e.shiftKey && o.sel != null && o.sel !== ref) { const a = o.sel; o.sel = ref; this.#toggleLine(a, ref); return true; }
      o.sel = ref; const x0 = e.clientX, y0 = e.clientY; let moved = false;
      const mv = (ev) => { if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return; moved = true; const p = this.#skyAt(ev.clientX, ev.clientY); if (!p) return; o.drag = { ref, ...p }; this.#refreshSkyBody(); };
      const up = async () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up);
        const d = o.drag; o.drag = null; if (!moved || !d) { this.#refreshSkyBody(); return; }
        const sk = this.#skySk(); if (!sk) return;
        if (typeof ref === "string") { const id = ref.slice(2); await this.#saveSky({ extra: sk.extra.map(x => x.id === id ? { ...x, ra: d.ra, dec: d.dec } : x) }); }
        else await this.#saveSky({ moved: [...sk.moved.filter(m => m[0] !== ref), [ref, +d.ra.toFixed(3), +d.dec.toFixed(3)]] });
      };
      window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
      this.#refreshSkyBody(); return true;
    }
    // céu vazio: estrela nova (com Shift, já ligada à estrela escolhida)
    const p = this.#skyAt(e.clientX, e.clientY); if (!p) return true; const sk = this.#skySk(); if (!sk) return true;
    const id = Math.random().toString(36).slice(2, 9); const ref = `x:${id}`; const prev = o.sel;
    const extra = [...sk.extra, { id, ra: +p.ra.toFixed(3), dec: +p.dec.toFixed(3), mag: Number(o.mag) || 2.5, col: "#ffffff" }];
    o.sel = ref;
    if (e.shiftKey && prev != null) { const consts = this.#withLine(sk, prev, ref); this.#saveSky({ extra, consts }); }
    else this.#saveSky({ extra });
    return true;
  }
  /** Liga (ou desliga, se já estiverem ligadas) duas estrelas, na constelação escolhida (ou numa nova). */
  #withLine(sk, a, b) {
    const consts = structuredClone(sk.consts ?? makeConsts(sk)); const same = (l) => (l[0] === a && l[1] === b) || (l[0] === b && l[1] === a);
    for (const c of consts) { const n = c.lines.length; c.lines = c.lines.filter(l => !same(l)); if (c.lines.length !== n) return consts; }
    let c = consts.find(x => x.id === this.skyOv.con);
    if (!c) { c = { id: `c${Math.random().toString(36).slice(2, 8)}`, name: `Constelação ${consts.length + 1}`, lines: [] }; consts.push(c); this.skyOv.con = c.id; }
    c.lines.push([a, b]); return consts;
  }
  /** Dar, mudar ou tirar o nome de uma estrela (clique duplo no modo de edição). */
  async #nameStar(ref) {
    const sk = this.#skySk(); if (!sk) return; const cur = sk.names.find(n => n[0] === ref)?.[1] ?? "";
    const n = await foundry.applications.api.DialogV2.prompt({ window: { title: "Atlas · Nome da estrela" }, content: `<label style="display:flex;flex-direction:column;gap:4px">Nome (vazio tira o nome)<input type="text" name="n" value="${esc(cur)}" autofocus></label>`, ok: { label: "Salvar", callback: (ev, btn) => btn.form.elements.n.value }, rejectClose: false }).catch(() => null);
    if (n == null) return; const v = String(n).trim(); const names = sk.names.filter(x => x[0] !== ref); if (v) names.push([ref, v]); await this.#saveSky({ names });
  }
  #toggleLine(a, b) { const sk = this.#skySk(); if (!sk) return; this.#saveSky({ consts: this.#withLine(sk, a, b) }); }
  #skyContext(e) {
    const o = this.skyOv; if (!o?.edit || !game.user.isGM || o.view !== "carta") return false; const st = e.target.closest?.("[data-star]"); if (!st) return false;
    e.preventDefault(); e.stopPropagation(); const ref = this.#parseRef(st.dataset.star); const sk = this.#skySk(); if (!sk) return true;
    const consts = (sk.consts ?? makeConsts(sk)).map(c => ({ ...c, lines: c.lines.filter(l => l[0] !== ref && l[1] !== ref) }));
    if (o.sel === ref) o.sel = null;
    const names = sk.names.filter(n => n[0] !== ref);
    if (typeof ref === "string") { const id = ref.slice(2); this.#saveSky({ extra: sk.extra.filter(x => x.id !== id), consts, names }); }
    else this.#saveSky({ removed: [...new Set([...sk.removed, ref])], moved: sk.moved.filter(m => m[0] !== ref), consts, names });
    return true;
  }
  async #skyBarAct(act, el) {
    const o = this.skyOv; if (!o) return; const sk = this.#skySk();
    if (act === "edit") { o.edit = !o.edit; o.sel = null; this.refreshMap(); return; }
    if (act === "conRen" && sk) { const consts = structuredClone(sk.consts ?? makeConsts(sk)); const c = consts.find(x => x.id === o.con); if (!c) return;
      const n = await foundry.applications.api.DialogV2.prompt({ window: { title: "Atlas · Constelação" }, content: `<label style="display:flex;flex-direction:column;gap:4px">Nome<input type="text" name="n" value="${esc(c.name)}" autofocus></label>`, ok: { label: "Salvar", callback: (ev, btn) => btn.form.elements.n.value }, rejectClose: false }).catch(() => null);
      if (n == null || !String(n).trim()) return; c.name = String(n).trim(); await this.#saveSky({ consts }); return; }
    if (act === "conDel" && sk) { const consts = (sk.consts ?? makeConsts(sk)).filter(x => x.id !== o.con); o.con = null; await this.#saveSky({ consts }); return; }
  }
  async #skyField(el) {
    const o = this.skyOv; if (!o) return; const k = el.dataset.skyovf;
    if (k === "mag") { o.mag = Number(el.value) || 2.5; return; }
    if (k === "con") {
      if (el.value !== "+new") { o.con = el.value || null; this.refreshMap(); return; }
      const sk = this.#skySk(); if (!sk) return; const consts = structuredClone(sk.consts ?? makeConsts(sk));
      const n = await foundry.applications.api.DialogV2.prompt({ window: { title: "Atlas · Nova constelação" }, content: `<label style="display:flex;flex-direction:column;gap:4px">Nome<input type="text" name="n" value="Constelação ${consts.length + 1}" autofocus></label>`, ok: { label: "Criar", callback: (ev, btn) => btn.form.elements.n.value }, rejectClose: false }).catch(() => null);
      if (n == null || !String(n).trim()) { this.refreshMap(); return; }
      const c = { id: `c${Math.random().toString(36).slice(2, 8)}`, name: String(n).trim(), lines: [] }; consts.push(c); o.con = c.id; await this.#saveSky({ consts }); }
  }
  /** Mapa-múndi: posição do cursor (latitude e longitude, rumo, quadrícula…) sem redesenhar o mapa. */
  #worldCursor(e) {
    const el = this.mapEl?.querySelector?.(".wcur"); if (!el) return; const m = mapOf(this.scene); if (!isWorld(m) && m?.level !== "ceu") return;
    const t = e.target; if (!(t === this.view || t === this.host || t?.id === "board")) { el.hidden = true; return; }
    const w = this.s2w(e.clientX, e.clientY); let r = null; try { r = m.level === "ceu" ? skyReadout(this.scene, normSky(m.sky ?? {}), w.x, w.y) : readoutAt(this.scene, normWorld(m.world ?? {}), w.x, w.y); } catch (err) { /* */ }
    if (!r) { el.hidden = true; return; } el.hidden = false; el.style.left = `${e.clientX + 16}px`; el.style.top = `${e.clientY + 18}px`;
    el.firstElementChild.textContent = r.main; el.lastElementChild.textContent = r.sub ?? "";
  }
  /* ---------- camada Atlas ---------- */
  onLayer(active) {
    this.layerActive = active;
    if (active) { try { globalThis.ui?.atlas?.activate?.(); } catch (e) { /* */ } }
    else { if (isVec(this.tool)) vecExit(this); this.tool = "sel"; this.drawing = null; this.multi = []; this.marquee = null; this.brush = null; }
    this.refresh();
  }
  onTool(tool) {
    if (tool === "vec") tool = this.vecLayer ?? "vrota"; if (isVec(tool)) this.vecLayer = tool;
    if (isVec(this.tool) && !isVec(tool)) vecExit(this);
    if (isVec(tool) && !isVec(this.tool)) { vecEnter(this); const v = vx(this); v.nodes = []; v.draw = null; v.rdraw = null; v.key = ""; this.selRoute = null; this.selPt = null; this.multi = (this.multi ?? []).filter(x => x.kind === "routes"); }
    this.tool = tool; this.drawing = null; this.marquee = null; this.portalFrom = null;
    if (tool !== "regiao") this.regDraw = null;
    const tab = { local: "pois", portal: "pois", rota: "rotas", vrota: "rotas", rotulo: "mapa", revelar: "mapa", cobrir: "mapa", nuvem: "natureza", regiao: "natureza", vreg: "natureza" }[tool];
    if (tab && game.user.isGM) { this.panel = tab; if (tab === "natureza") { this.natTab = tool === "regiao" || tool === "vreg" ? "lugares" : "clima"; if (tool === "regiao" || tool === "vreg") this.natPlace = null; } if (tool !== "sel" && !isVec(tool)) this.selectEdit({}); }
    this.refresh();
  }
  /** Ativa uma ferramenta do Atlas (também na barra da esquerda). */
  useTool(tool) {
    const L = atlasLayer();
    if (L) { L.activate({ tool: TOOL_OF[tool] ?? "atlasSel" }); if (L.active && globalThis.ui?.controls?.tool?.name !== TOOL_OF[tool]) globalThis.ui?.controls?.activate?.({ control: "atlas", tool: TOOL_OF[tool] }); }
    this.onTool(tool);
  }
  /** Zoom pela roda do mouse, mantendo o ponto sob o cursor no lugar. */
  wheelZoom(e) {
    const st = canvas?.stage; if (!st) return; const s0 = st.scale?.x ?? this.zoom ?? 1; const f = Math.pow(1.0015, -(e.deltaY || 0) * (e.deltaMode === 1 ? 30 : 1)); 
    const lim = CONFIG?.Canvas?.maxZoom ?? 3; const minZ = canvas.dimensions?.scale?.min ?? 0.1; const s1 = Math.max(minZ, Math.min(lim, s0 * f)); if (Math.abs(s1 - s0) < 1e-4) return;
    const W = this.s2w(e.clientX, e.clientY); const r = this.view.getBoundingClientRect(); const C = this.s2w(r.left + r.width / 2, r.top + r.height / 2);
    const x = W.x - (W.x - C.x) * s0 / s1, y = W.y - (W.y - C.y) * s0 / s1;
    try { if (canvas.pan) canvas.pan({ x, y, scale: s1 }); else canvas.animatePan?.({ x, y, scale: s1, duration: 0 }); } catch (err) { /* */ }
  }
  togglePanel() { const d = globalThis.ui?.atlas; if (d?.setOpen) d.setOpen(d.collapsed); else d?.activate?.(); }
  inMulti(kind, id) { return this.multi.some(x => x.kind === kind && x.id === id); }
  layerClick() { if (this.tool === "sel" && (this.multi.length || this.sel || this.selLabel)) { this.multi = []; this.refresh(); } }
  marqueeStart(event) {
    if (!this.editing || this.tool !== "sel") return; const o = event.interactionData?.origin; if (!o) return;
    this.marquee = { x0: o.x, y0: o.y, x1: o.x, y1: o.y, add: !!(event.shiftKey ?? event.nativeEvent?.shiftKey) }; this.refreshMap();
  }
  marqueeMove(event) { if (!this.marquee) return; const d = event.interactionData?.destination; if (!d) return; this.marquee.x1 = d.x; this.marquee.y1 = d.y; this.refreshMap(); }
  marqueeCancel() { this.marquee = null; this.refreshMap(); }
  marqueeEnd(event) {
    const mq = this.marquee; this.marquee = null; if (!mq) return;
    if (event?.interactionData?.destination) { mq.x1 = event.interactionData.destination.x; mq.y1 = event.interactionData.destination.y; }
    const x0 = Math.min(mq.x0, mq.x1), x1 = Math.max(mq.x0, mq.x1), y0 = Math.min(mq.y0, mq.y1), y1 = Math.max(mq.y0, mq.y1);
    const inside = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1; const d = this.data; const found = [];
    for (const p of d.pois) if (inside(p.x, p.y)) found.push({ kind: "pois", id: p.id });
    for (const l of d.labels) if (inside(l.x, l.y)) found.push({ kind: "labels", id: l.id });
    for (const m of d.movers) if (inside(m.x, m.y)) found.push({ kind: "movers", id: m.id });
    for (const r of d.routes) if (r.points.length && r.points.every(p => inside(p[0], p[1]))) found.push({ kind: "routes", id: r.id });
    this.multi = mq.add ? [...this.multi, ...found.filter(f => !this.inMulti(f.kind, f.id))] : found;
    this.sel = null; this.selLabel = null; this.selRoute = null;
    this.refresh();
  }
  /** Delete com a camada Atlas ativa (o Foundry chama isto em vez de apagar tokens). */
  deleteKey() { if (!this.editing) return false; if (isVec(this.tool)) return true; deleteSelection(this); return true; }
  /** Segurar o clique: aponta um lugar para todos (com o nome do local mais próximo). */
  pointAt(x, y) {
    const sc = this.scene; if (!sc) return; const d = this.data; let best = null, bd = this.gs * 1.6;
    for (const p0 of d.pois) { const p = normPoi(p0); if (!game.user.isGM && ["oculto"].includes(p.state)) continue; const dd = Math.hypot(p.x - x, p.y - y); if (dd < bd) { bd = dd; best = p; } }
    const name = best ? (best.state === "rumor" && !game.user.isGM ? "um rumor" : best.name) : null;
    const msg = { type: "ping", sceneId: sc.id, x: Math.round(x), y: Math.round(y), color: userColor(game.user.id), label: `${game.user.name} aponta${name ? `: ${name}` : " aqui"}` };
    game.socket.emit(SOCKET, msg); this.onPing(msg);
  }

  w2s(x, y) { const t = canvas.stage.worldTransform; const r = this.view.getBoundingClientRect(); return { x: r.left + t.a * x + t.tx, y: r.top + t.d * y + t.ty }; }
  s2w(x, y) { const t = canvas.stage.worldTransform; const r = this.view.getBoundingClientRect(); return { x: (x - r.left - t.tx) / t.a, y: (y - r.top - t.ty) / t.d }; }

  /* ---------- ciclo ---------- */
  ensure() {
    const v = this.view;
    if (this.host && v && this.host.previousElementSibling !== v && this.host.parentElement !== document.body) { this.host.remove(); this.host = null; }
    if (this.host?.isConnected) return true;
    this.host = document.createElement("div"); this.host.id = "atlas-layer";
    this.host.style.cssText = "position:fixed;inset:0;pointer-events:none;";
    if (v?.parentElement) v.after(this.host); else document.body.appendChild(this.host);
    this.sh = this.host.attachShadow({ mode: "open" });
    this.sh.innerHTML = `<link rel="stylesheet" href="${CSS_URL}"><div class="atlas"><div class="maplayer"></div></div>`;
    this.mapEl = this.sh.querySelector(".maplayer");
    // camada própria para a rosa (acima do mapa, abaixo da interface do Foundry)
    this.#ensureHud();
    this.sh.addEventListener("click", (e) => this.#onClick(e));
    this.sh.addEventListener("dblclick", (e) => this.#onDbl(e));
    this.sh.addEventListener("contextmenu", (e) => this.#onContext(e));
    this.sh.addEventListener("pointerdown", (e) => this.#onDown(e));
    // o cartão do local segue o mouse de verdade (o mapa é redesenhado o tempo todo, então "pointerout" se perde)
    window.addEventListener("blur", () => { if (this.hover) { this.hover = null; this.refreshMap(); } });
    document.addEventListener("pointerleave", () => { if (this.hover) { this.hover = null; this.refreshMap(); } });
    this.sh.addEventListener("wheel", (e) => {
      // com a camada capturando o mouse (edição), o zoom é feito aqui mesmo, em volta do cursor
      // o Foundry só dá zoom quando o mouse está "sobre o canvas"; sobre a camada do Atlas o zoom é feito aqui, em volta do cursor
      e.preventDefault(); e.stopPropagation(); this.wheelZoom(e); }, { passive: false });
    for (const t of ["keydown", "keyup", "keypress"]) this.sh.addEventListener(t, (e) => e.stopPropagation());
    if (!this.#global) {
      this.#global = true;
      window.addEventListener("pointermove", (e) => this.#onMove(e), { passive: true });
      window.addEventListener("pointerup", (e) => this.#onUp(e));
      window.addEventListener("pointerdown", (e) => this.#gestureDown(e), true);
      window.addEventListener("pointermove", (e) => this.#worldCursor(e), { passive: true });
      window.addEventListener("pointermove", (e) => { const g = this.#gest; if (g && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 14) { clearTimeout(g.t); this.#gest = null; } }, { passive: true });
      // roda do mouse com o pincel de névoa: muda o tamanho do pincel (em vez do zoom)
      window.addEventListener("wheel", (e) => {
        if (!this.editing || !["revelar", "cobrir"].includes(this.tool)) return;
        const t = e.target; if (!(t === this.view || t === this.host || t?.id === "board")) return;
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        const cur = Number(this._brushV ?? uiPref("brush", 2)); const step = e.shiftKey ? 1 : 0.25; const nv = Math.max(0.25, Math.min(40, cur + (e.deltaY < 0 ? step : -step)));
        this._brushV = nv; setUiPref("brush", nv); this.refreshMap();
      }, { capture: true, passive: false });
      window.addEventListener("pointerup", () => { if (this.#gest) { clearTimeout(this.#gest.t); this.#gest = null; } if (this.#lp) { clearTimeout(this.#lp.t); this.#lp = null; } });
      window.addEventListener("pointermove", (e) => { const g = this.#lp; if (g && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 8) { clearTimeout(g.t); this.#lp = null; } }, { passive: true });
      window.addEventListener("contextmenu", (e) => { if (this.#eatCtx) { this.#eatCtx = false; this.#rdown = null; e.preventDefault(); e.stopPropagation(); return; }
        const r = this.#rdown; this.#rdown = null; // botão direito no mapa (sem arrastar): tira o último ponto da viagem
        if (r && Math.hypot(e.clientX - r.x, e.clientY - r.y) < 6 && this.tripUndo()) { e.preventDefault(); e.stopPropagation(); } }, true);
      window.addEventListener("pointerdown", (e) => { if (this.ctx && !e.composedPath().some(n => n.classList?.contains?.("ctxmenu"))) { this.ctx = null; this.refreshMap(); } }, true);
      document.addEventListener("keydown", (e) => this.#onKey(e), true);
    }
    return true;
  }

  #ensureHud() {
    if (this.hudHost?.isConnected && (!this.host || this.hudHost.previousElementSibling === this.host)) return;
    this.hudHost?.remove();
    this.hudHost = document.createElement("div"); this.hudHost.id = "atlas-hud";
    // logo acima do mapa e dos elementos do Atlas, mas abaixo da interface do Foundry (barras, chat, janelas)
    this.hudHost.style.cssText = "position:fixed;inset:0;pointer-events:none;";
    if (this.host?.parentElement) this.host.after(this.hudHost); else document.body.appendChild(this.hudHost);
    const hs = this.hudHost.attachShadow({ mode: "open" });
    hs.innerHTML = `<link rel="stylesheet" href="${CSS_URL}"><div class="atlas"><div class="maplayer hudlayer"></div></div>`;
    this.hudEl = hs.querySelector(".hudlayer");
    hs.addEventListener("click", (e) => this.#onClick(e));
    hs.addEventListener("pointerdown", (e) => this.#onDown(e));
    hs.addEventListener("wheel", (e) => { if (e.target.closest?.(".skyov")) { e.preventDefault(); e.stopPropagation(); return; } e.preventDefault(); e.stopPropagation(); this.wheelZoom(e); }, { passive: false });
    hs.addEventListener("contextmenu", (e) => { if (this.#skyContext(e)) return; if (e.target.closest?.(".skyov")) { e.preventDefault(); return; } if (e.target.closest?.("[data-rosehud]") && game.user.isGM) { e.preventDefault(); e.stopPropagation(); openRoseConfig(); } });
    hs.addEventListener("dblclick", (e) => { const o = this.skyOv; const st = e.target.closest?.("[data-star]"); if (!st || !o?.edit || !game.user.isGM || o.view !== "carta") return; e.preventDefault(); e.stopPropagation(); this.#nameStar(this.#parseRef(st.dataset.star)); });
    hs.addEventListener("change", (e) => { const f = e.target.closest?.("[data-skyovf]"); if (f) { e.stopPropagation(); this.#skyField(f); } });
    for (const t of ["keydown", "keyup", "keypress"]) hs.addEventListener(t, (e) => { if (e.target.closest?.(".skyov select, .skyov input")) e.stopPropagation(); });
  }
  refresh() { this.refreshMap(); this.refreshChrome(); }
  refreshMap() { if (this.#raf) return; this.#raf = requestAnimationFrame(() => { this.#raf = null; try { this.renderMap(); } catch (err) { console.error(`${MODULE_ID} | mapa`, err); } }); }
  refreshChrome() { try { globalThis.ui?.atlas?.requestRender?.(); } catch (err) { console.error(`${MODULE_ID} | painel`, err); } }

  toggle(force) { this.open = force ?? !this.open; this.refresh(); }
  /** Mostra a aba do Atlas na barra lateral. */
  showTab(panel) { if (panel !== undefined) this.panel = panel; try { globalThis.ui?.atlas?.activate?.(); } catch (e) { /* */ } this.refresh(); }
  select(poiId, { pan = false } = {}) {
    this.sel = poiId; this.selRoute = null; this.selLabel = null; this.selMover = null;
    if (poiId) { this.panel = "pois"; this.tool = "sel"; }
    if (pan && poiId) { const p = this.data.pois.find(x => x.id === poiId); if (p) canvas.animatePan?.({ x: p.x, y: p.y, duration: 400 }); }
    if (poiId && !this.editing) this.showTab(); else this.refresh();
  }
  selectEdit({ sel = null, selRoute = null, selLabel = null, selMover = null } = {}) { if (selRoute !== this.selRoute) this.selPt = null; Object.assign(this, { sel, selRoute, selLabel, selMover }); this.refresh(); }

  /* ---------- camada do mapa ---------- */
  renderMap() {
    if (!this.ensure()) return;
    const sc = this.scene; const m = mapOf(sc);
    this.#ensureHud();
    if (!this.open || !sc || !m || !this.view) { if (this.hudEl) this.hudEl.innerHTML = ""; this.mapEl.innerHTML = ""; this.mapEl.classList.remove("capture"); try { renderWeatherFx(this, this.sh.querySelector(".atlas")); } catch (e) { /* */ } return; }
    const gm = this.gmView; const L = this.layers; const d = dataOf(sc); const z = this.zoom; const W = window.innerWidth, H = window.innerHeight;
    const svg = []; const defs = []; const html = []; const hud = []; const late = []; // late: marcas do caminho, por cima dos locais
    // mapa-múndi: luz (dia e noite), atmosfera e grade do modelo do mundo, por baixo de tudo
    const wl = this.#skyLayer(sc, m, z, W, H, gm); // céu, mundo (luz, grade, luas): camada própria, redesenhada sozinha quando o tempo anda
    if (m.level === "ceu" || (isWorld(m) && normWorld(m.world ?? {}).readout)) html.push(`<div class="wcur" hidden><b></b><small></small></div>`);

    // região destacada (lista de Regiões) e região sendo desenhada
    if (this.regHi) { const r = sc.regions?.get?.(this.regHi); if (r) for (const s of (r.shapes?.contents ?? [...(r.shapes ?? [])]).map(x => x.toObject?.() ?? x)) svg.push(this.#shape(s, "reghi", `style="--zc:${esc(r.color?.css ?? r.color ?? "#3aa0ff")}"`)); }
    if (this.regDraw?.pts?.length) { const pts = this.regDraw.pts.map(p => { const q = this.w2s(p[0], p[1]); return `${q.x.toFixed(1)},${q.y.toFixed(1)}`; }); if (this.mouse) pts.push(`${this.mouse.x},${this.mouse.y}`); svg.push(`<polygon class="regdraw" points="${pts.join(" ")}"/>`); for (const p of this.regDraw.pts) { const q = this.w2s(p[0], p[1]); svg.push(`<circle class="handle draw" cx="${q.x}" cy="${q.y}" r="4"/>`); } }
    // zonas
    if (L.zones || (this.editing && this.tool === "zona")) for (const { r, z: zn } of zonesOf(sc)) {
      for (const s of (r.shapes?.contents ?? [...(r.shapes ?? [])]).map(x => x.toObject?.() ?? x)) { if (s.hole) continue; svg.push(this.#shape(s, `zone`, `style="--zc:${esc(zn.color)}"`)); }
    }

    // rotas
    const routeEdit = this.editing && ["sel", "rota"].includes(this.tool);
    const routesAt = svg.length; // rotas e pontes: para os jogadores, a névoa esconde (máscara)
    const casings = []; // contornos de todas as rotas por baixo de todos os traços: rotas que se encontram viram um caminho só
    // mundo que dá a volta: rota que passa da borda é desenhada de novo do outro lado (cortada na borda do mapa)
    const GW = globeOf(sc, m), SW = GW?.S ?? wrapOf(sc, m); let wclip = false; const dSW = SW ? this.w2s(SW.X + SW.W, 0).x - this.w2s(SW.X, 0).x : 0;
    const tpOn = !!setting("teleport", false);
    if (L.routes || this.editing) for (const raw of d.routes) {
      const r = normRoute(raw); if (r.points.length < 2) continue; if (r.hidden && !gm) continue;
      if (r.type === "portal") { // ligação de portais: linha reta entre dois portais; só o mestre vê, editando
        if (!tpOn || !gm || !this.editing) continue; let A = r.points[0], B = r.points[r.points.length - 1];
        if (this.drag?.kind === "poi" && this.drag.moved) { if (r.a === this.drag.poi) A = [this.drag.wx, this.drag.wy]; if (r.b === this.drag.poi) B = [this.drag.wx, this.drag.wy]; }
        const qa = this.w2s(A[0], A[1]), qb = this.w2s(B[0], B[1]); const col = d.pois.find(p => p.id === r.a)?.tpColor || r.color || ROUTE_TYPES.portal.color; const sel = this.selRoute === r.id;
        const ln = `M${qa.x.toFixed(1)} ${qa.y.toFixed(1)}L${qb.x.toFixed(1)} ${qb.y.toFixed(1)}`;
        svg.push(`<path class="portlink ${sel ? "sel" : ""}" d="${ln}" style="--tc:${esc(col)}"/>`);
        if (r.oneway) { const mx = (qa.x + qb.x) / 2, my = (qa.y + qb.y) / 2, an = Math.atan2(qb.y - qa.y, qb.x - qa.x); const k = 7; const pt = (a, l) => `${(mx + Math.cos(an + a) * l).toFixed(1)},${(my + Math.sin(an + a) * l).toFixed(1)}`;
          svg.push(`<polygon class="portarrow" points="${pt(0, k * 1.4)} ${pt(2.5, k)} ${pt(-2.5, k)}" style="fill:${esc(col)}"/>`); }
        if (this.tool === "sel") svg.push(`<path class="hit" data-route="${r.id}" d="${ln}"/>`);
        continue; }
      if (!L.routes && !(this.editing && this.tool === "rota") && this.selRoute !== r.id) continue; // camada desligada: só a rota em edição
      if (this.liveRoute?.id === r.id) { if (this.liveRoute.handles) r.handles = this.liveRoute.handles; else r[this.liveRoute.k] = this.liveRoute.v; }
      if (this.drag?.kind === "handle" && this.drag.route === r.id && this.drag.moved) r.points[this.drag.idx] = [SW ? Math.min(SW.X + SW.W, Math.max(SW.X, this.drag.wx)) : this.drag.wx, this.drag.wy];
      if (this.drag?.kind === "poi" && this.drag.moved) { const n = r.points.length; if (r.a === this.drag.poi) r.points[0] = [this.drag.wx, this.drag.wy]; if (r.b === this.drag.poi) r.points[n - 1] = [this.drag.wx, this.drag.wy]; }
      if (this.drag?.kind === "knob" && this.drag.route === r.id && this.drag.moved) r.handles = dragHandle(r.points, r.handles, this.drag.idx, this.drag.side, this.drag.wx, this.drag.wy, this.drag.alt);
      const t = ROUTE_TYPES[r.type]; const sp = r.points.map(p => { const q = this.w2s(p[0], p[1]); return [q.x, q.y]; });
      const gcL = isGc(r, GW) ? routeLine(r, GW) : null; const segs = gcL ? polySegs(gcL) : bezierSegs(r.points, r.handles); const toS = (p) => { const q = this.w2s(p[0], p[1]); return [q.x, q.y]; };
      let mnX = Infinity, mxX = -Infinity; for (const s of segs) for (const p of s) { if (p[0] < mnX) mnX = p[0]; if (p[0] > mxX) mxX = p[0]; }
      const wraps = crossesEdge(mnX, mxX, SW); const at0 = svg.length, cAt0 = casings.length;
      // aparência: a da rota; o que ela não define vem do padrão do mapa para o tipo (Atlas › Mapa)
      const ms = m.routeStyle?.[r.type] ?? {}; const own = (k) => raw[k] != null && raw[k] !== "";
      const S = (k, def) => own(k) ? r[k] : (ms[k] != null && ms[k] !== "" ? ms[k] : def);
      const path = segsPath(segs, toS); const wdt = Math.max(1, t.width * (Number(S("width", 1)) || 1) * Math.min(1.6, Math.max(0.55, z * 1.6)));
      const dash = DASH_PATTERN[S("dash", "")] ?? t.dash; const ds = Math.max(1, wdt / 2.2) * (Number(S("dashScale", 1)) || 1);
      const dashPx = dash === "none" ? "none" : dash.split(" ").map(v => (Number(v) * ds).toFixed(1)).join(" ");
      const col = S("color", "") || t.color; const outline = own("outline") ? r.outline : (ms.outline === true || ms.outline === false) ? ms.outline : (["estrada", "rua"].includes(r.type) && !r.color && !ms.color);
      const opa = Number(S("opacity", 1)); const oc = S("outlineColor", ""); const ow = Number(S("outlineWidth", 3)) || 3;
      svg.push(`<g class="rgroup" style="opacity:${r.hidden && gm ? Math.min(0.5, opa) : opa}">`);
      if (outline) casings.push(`<path class="casing" d="${path}" style="stroke-width:${(wdt + ow).toFixed(1)}px;${oc ? `stroke:${oc};` : ""}opacity:${r.hidden && gm ? Math.min(0.5, opa) : opa}"/>`);
      svg.push(`<path class="route r-${r.type} ${r.hidden ? "hid" : ""} ${r.cond === "bloqueada" ? "blocked" : ""}" d="${path}" style="stroke:${col};stroke-width:${wdt}px;stroke-dasharray:${dashPx}"/>`);
      if (r.showName && r.name && z > 0.12) { const lsegs = sp[0][0] <= sp[sp.length - 1][0] ? segs : [...segs].reverse().map(s => [s[3], s[2], s[1], s[0]]); defs.push(`<path id="rp-${r.id}" d="${segsPath(lsegs, toS)}"/>`); svg.push(`<text class="rname" style="font-size:${(Math.max(9, Math.min(22, 13 * z * 1.4)) * (r.nameSize || 1)).toFixed(1)}px;fill:${r.nameColor || col}" dy="-${(wdt / 2 + 3).toFixed(1)}"><textPath href="#rp-${r.id}" startOffset="50%" text-anchor="middle">${esc(r.name)}</textPath></text>`); }
      svg.push(`</g>`);
      if (this.editing && this.tool === "sel") svg.push(`<path class="hit" data-route="${r.id}" d="${path}"/>`);
      if (this.selRoute === r.id || this.inMulti("routes", r.id)) svg.push(`<path class="selroute" d="${path}"/>`);
      if (this.selRoute === r.id || (routeEdit && this.tool === "rota")) r.points.forEach((p, i) => { const q = this.w2s(p[0], p[1]); const end = i === 0 || i === r.points.length - 1; const on = this.selRoute === r.id && this.selPt === i; svg.push(`<circle class="handle ${end ? "end" : ""} ${on ? "on" : ""} ${this.selRoute === r.id ? "" : "faint"}" ${this.selRoute === r.id ? `data-handle="${i}"` : ""} cx="${q.x}" cy="${q.y}" r="${this.selRoute === r.id ? (on ? 7 : 6) : 4}"/>`); });
      // alças do ponto selecionado (como num editor de vetores)
      if (this.selRoute === r.id && this.selPt != null && r.points[this.selPt] && this.editing) {
        const i = this.selPt; const p = r.points[i]; const hv = handleVecs(r.points, r.handles, i); const q = toS(p);
        for (const [side, v] of [["in", hv.inV], ["out", hv.outV]]) {
          if ((side === "in" && i === 0) || (side === "out" && i === r.points.length - 1)) continue;
          const k = toS([p[0] + v[0], p[1] + v[1]]);
          svg.push(`<line class="hline ${hv.auto ? "auto" : ""}" x1="${q[0]}" y1="${q[1]}" x2="${k[0]}" y2="${k[1]}"/><circle class="knob ${hv.auto ? "auto" : ""}" data-knob="${side}" data-pt="${i}" cx="${k[0]}" cy="${k[1]}" r="5.5"/>`);
        }
      }
      if (r.cond === "bloqueada" && (gm || !r.hidden)) { const mid = pointAt(sp, polyLength(sp) / 2); html.push(`<span class="block" style="left:${mid[0]}px;top:${mid[1]}px" title="Rota bloqueada">✕</span>`); }
      if (wraps) { // a mesma rota uma volta para cada lado, tudo cortado na borda; marquinhas onde ela atravessa
        wclip = true; const ks = copiesFor(mnX, mxX, SW); const body = svg.splice(at0).join(""); const cas = casings.splice(cAt0).join("");
        const rep = (h) => `<g clip-path="url(#atlas-wclip)">${h}${ks.map(k => `<g transform="translate(${(k * dSW).toFixed(1)},0)">${h}</g>`).join("")}</g>`;
        svg.push(rep(body)); if (cas) casings.push(rep(cas));
        const P = gcL ?? curvePoints(r.points, r.handles, 6); const cell = (x) => Math.floor((x - SW.X) / SW.W);
        for (let i = 1; i < P.length; i++) { const c0 = cell(P[i - 1][0]), c1 = cell(P[i][0]); if (c0 === c1) continue;
          const bx = SW.X + Math.max(c0, c1) * SW.W; const t = (bx - P[i - 1][0]) / ((P[i][0] - P[i - 1][0]) || 1); const y = P[i - 1][1] + t * (P[i][1] - P[i - 1][1]);
          const qa = this.w2s(SW.X, y), qb = this.w2s(SW.X + SW.W, y);
          html.push(`<span class="wedge l" style="left:${qa.x.toFixed(1)}px;top:${qa.y.toFixed(1)}px;--rc:${col}" data-tooltip="${esc(r.name || "Rota")} continua no leste">⇄</span><span class="wedge r" style="left:${qb.x.toFixed(1)}px;top:${qb.y.toFixed(1)}px;--rc:${col}" data-tooltip="${esc(r.name || "Rota")} continua no oeste">⇄</span>`); }
      }
    }
    if (SW && (L.routes || this.editing)) { // costuras: ponta de rota na lateral = continua do lado oposto (⇄); editando, o ponto fantasma de lá
      const vis = d.routes.map(normRoute).filter(r => r.type !== "portal" && !(r.hidden && !gm) && !isGc(r, GW));
      for (const g0 of seamGhosts(SW, vis)) { const own = this.w2s(g0.side === "l" ? SW.X + SW.W : SW.X, g0.y), q = this.w2s(g0.x, g0.y);
        const routeEdit = gm && this.editing && (this.tool === "rota" || this.tool === "vrota" || (isVec(this.tool) && this.vecLayer === "vrota")); // edição de rotas aberta: as costuras ficam sempre à mostra
        if (routeEdit) {
          html.push(`<span class="seamend ${g0.linked ? "on" : ""}" style="left:${own.x.toFixed(1)}px;top:${own.y.toFixed(1)}px" data-tooltip="${g0.linked ? "Ponta na borda, ligada à rota do outro lado" : "Ponta na borda, ainda sem continuação do outro lado"}">⇄</span>`);
          if (!g0.linked) html.push(`<span class="seamghost" style="left:${q.x.toFixed(1)}px;top:${q.y.toFixed(1)}px" data-tooltip="Continuação desta rota: clique aqui com a ferramenta de rota (ou leve a ponta de uma rota até aqui) para unir"></span>`);
        } else if (g0.linked) html.push(`<span class="wedge ${g0.side === "l" ? "r" : "l"}" style="left:${own.x.toFixed(1)}px;top:${own.y.toFixed(1)}px" data-tooltip="Continua do outro lado do mapa">⇄</span>`); } }
    if (SW) { const a = this.w2s(SW.X, SW.R.Y), b = this.w2s(SW.X + SW.W, SW.R.Y + SW.R.H); defs.push(`<clipPath id="atlas-wclip" clipPathUnits="userSpaceOnUse"><rect x="${a.x.toFixed(1)}" y="${(a.y - 4000).toFixed(1)}" width="${(b.x - a.x).toFixed(1)}" height="${(b.y - a.y + 8000).toFixed(1)}"/></clipPath>`); }

    if (casings.length) svg.splice(routesAt, 0, ...casings);
    // edição avançada (vetores)
    if (this.editing && isVec(this.tool)) { try { renderVec(this, svg, html); } catch (err) { console.error(`${MODULE_ID} | vetores`, err); } }
    // pontes (onde uma estrada cruza rio ou água); o mestre clica para quebrar ou consertar
    if (L.routes) { let br = []; try { br = bridgesOf(sc); } catch (e) { console.warn(e); }
      const vis = new Set(d.routes.filter(r => gm || !r.hidden).map(r => r.id));
      // pedaços que se tocam viram uma ponte só (uma estrada dividida em várias rotas no meio do canal)
      const near = (this.gs || 100) * 0.8; const vb = br.filter(b => vis.has(b.routeId) && !b.removed && (b.pts?.length ?? 0) >= 2); const used = new Set(); const chains = [];
      const dd = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      // direção na ponta (olhando um pouco para trás, para não depender do último segmento)
      const dirEnd = (pts, atEnd) => { const n = pts.length; const P0 = atEnd ? pts[n - 1] : pts[0]; let Q = P0;
        for (let k = 1; k < n; k++) { const q = atEnd ? pts[n - 1 - k] : pts[k]; Q = q; if (dd(q, P0) >= near * 0.6) break; }
        const dx = P0[0] - Q[0], dy = P0[1] - Q[1]; const l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
      const COS = Math.cos(50 * Math.PI / 180);
      for (const b of vb) { if (used.has(b)) continue; used.add(b); const ch = { pts: b.pts.map(p => [...p]), ids: [`${b.routeId}|${b.key}`], broken: b.broken, openA: b.openA, openB: b.openB };
        // junta só pedaços que continuam na mesma direção (num cruzamento, cada rua fica com a sua ponte)
        for (let grew = true; grew;) { grew = false;
          for (const [atEnd, open] of [[true, ch.openB], [false, ch.openA]]) { if (!open) continue;
            const E = atEnd ? ch.pts[ch.pts.length - 1] : ch.pts[0]; const out = dirEnd(ch.pts, atEnd); let best = null;
            for (const c of vb) { if (used.has(c)) continue;
              for (const [cEnd, cOpen] of [[false, c.openA], [true, c.openB]]) { if (!cOpen) continue; const C = cEnd ? c.pts[c.pts.length - 1] : c.pts[0]; if (dd(E, C) > near) continue;
                const cin = dirEnd(c.pts, cEnd); const dot = -(out[0] * cin[0] + out[1] * cin[1]); // a outra ponta deve apontar de volta
                if (dot >= COS && (!best || dot > best.dot)) best = { c, cEnd, dot }; } }
            if (!best) continue; const c = best.c; const seq = best.cEnd ? [...c.pts].reverse() : c.pts.map(p => [...p]); // seq começa na ponta que encosta
            const otherOpen = best.cEnd ? c.openA : c.openB;
            if (atEnd) { ch.pts.push(...seq); ch.openB = otherOpen; } else { ch.pts.unshift(...[...seq].reverse()); ch.openA = otherOpen; }
            used.add(c); ch.ids.push(`${c.routeId}|${c.key}`); ch.broken ||= c.broken; grew = true; } }
        chains.push(ch); }
      const zz = Math.min(1.8, Math.max(0.5, z * 1.6));
      const RS = d.map?.routeStyle ?? {}; const rawR = new Map(d.routes.map(r => [r.id, r]));
      // estilo da ponte: o da rota; senão o padrão do tipo no mapa; senão pedra
      const bst = (rid) => { const raw = rawR.get(rid) ?? {}; const r = normRoute(raw); const ms = RS[r.type] ?? {}; const t = ROUTE_TYPES[r.type] ?? {}; const pick = (k) => raw[k] != null && raw[k] !== "" ? raw[k] : (ms[k] != null && ms[k] !== "" ? ms[k] : null);
        const routeCol = (raw.color || ms.color || t.color || "#8a5a2b"); return { style: pick("bStyle") || "pedra", color: pick("bColor"), w: Number(pick("bWidth")) || 1, dash: pick("bDash") || "", routeCol, routeW: (t.width ?? 2.4) * (Number(raw.width ?? ms.width) || 1) }; };
      for (const ch of chains) {
        const B = bst(ch.ids[0].split("|")[0]); if (B.style === "nenhum") continue;
        const G = Math.max(5, Math.min(30, 8.5 * zz * B.w)); // largura do tabuleiro (px na tela)
        let S = ch.pts.map(p => { const t = this.w2s(p[0], p[1]); return [t.x, t.y]; });
        // tira pontos quase repetidos e suaviza (Chaikin), mantendo as pontas
        S = S.filter((p, k) => !k || dd(p, S[k - 1]) > 1.5); if (S.length < 2) continue;
        for (let it = 0; it < 2 && S.length > 2; it++) { const o = [S[0]]; for (let k = 0; k < S.length - 1; k++) { const a = S[k], b = S[k + 1]; o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); } o.push(S[S.length - 1]); S = o; }
        const nrm = (k) => { const a = S[Math.max(0, k - 2)], c = S[Math.min(S.length - 1, k + 2)]; const dx = c[0] - a[0], dy = c[1] - a[1]; const l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l, dx / l, dy / l]; };
        const line = (pts) => `M${pts.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("L")}`;
        const off = (pts, k0, side) => pts.map((p, k) => { const [nx, ny] = nrm(k0 + k); return [p[0] + nx * side, p[1] + ny * side]; });
        const parts = ch.broken ? (() => { const n = S.length; const a = Math.max(1, Math.floor(n * 0.38)), b = Math.min(n - 1, Math.ceil(n * 0.62)); return [[0, S.slice(0, a + 1)], [b, S.slice(b)]]; })() : [[0, S]];
        let deck = "", rails = "";
        for (const [k0, P] of parts) { if (P.length < 2) continue; deck += line(P); rails += line(off(P, k0, G / 2 - 0.9)) + line(off(P, k0, -(G / 2 - 0.9))); }
        const cap = (k) => { const [nx, ny] = nrm(k); const p = S[k]; const w = G * 0.72; return `M${(p[0] + nx * w).toFixed(1)} ${(p[1] + ny * w).toFixed(1)}L${(p[0] - nx * w).toFixed(1)} ${(p[1] - ny * w).toFixed(1)}`; };
        const caps = (ch.openA ? "" : cap(0)) + (ch.openB ? "" : cap(S.length - 1)); // num cruzamento (ponta ligada a outra rua) não há cabeceira
        const dashOf = (base, sw) => { const pat = DASH_PATTERN[B.dash] ?? base; if (!pat || pat === "none") return "none"; const ds = Math.max(1, sw / 1.6); return pat.split(" ").map(v => (Number(v) * ds).toFixed(1)).join(" "); };
        const st = (w, extra = "") => `style="stroke-width:${w.toFixed(1)}px;${extra}"`; const col = (c) => c ? `stroke:${c};` : "";
        let body = "";
        if (B.style === "pedra") body = `<path class="bo" d="${deck}" ${st(G + 3)}/><path class="bd" d="${deck}" ${st(G, col(B.color))}/><path class="br" d="${rails}" ${st(Math.max(1, G * 0.14))}/><path class="bc" d="${caps}" ${st(Math.max(2, G * 0.3))}/>`;
        else if (B.style === "madeira") body = `<path class="bo" d="${deck}" ${st(G + 3)}/><path class="bw" d="${deck}" ${st(G, col(B.color))}/><path class="bpl" d="${deck}" ${st(G - 2, `stroke-dasharray:${Math.max(1, G * 0.12).toFixed(1)} ${Math.max(2, G * 0.3).toFixed(1)}`)}/><path class="bwr" d="${rails}" ${st(Math.max(1.2, G * 0.16))}/><path class="bwc" d="${caps}" ${st(Math.max(2, G * 0.3))}/>`;
        else if (B.style === "linhas" || B.style === "tracejado") { const sw = Math.max(1.4, G * 0.2); const da = dashOf(B.style === "tracejado" ? DASH_PATTERN.tracejada : "none", sw);
          body = `<path class="bk2" d="${rails}" ${st(sw + 2, da !== "none" ? `stroke-dasharray:${da}` : "")}/><path class="bl" d="${rails}" ${st(sw, col(B.color) + (da !== "none" ? `stroke-dasharray:${da}` : ""))}/>${B.style === "linhas" ? `<path class="bk2" d="${caps}" ${st(sw + 2)}/><path class="bl" d="${caps}" ${st(sw, col(B.color))}/>` : ""}`; }
        else if (B.style === "rota") { const rw = Math.max(1.5, B.routeW * Math.min(1.6, Math.max(0.55, z * 1.6)) * B.w); const da = dashOf("none", rw);
          body = `<path class="bo" d="${deck}" ${st(rw + 7)}/><path class="bcase" d="${deck}" ${st(rw + 4)}/><path class="broute" d="${deck}" ${st(rw, `stroke:${B.color || B.routeCol};${da !== "none" ? `stroke-dasharray:${da}` : ""}`)}/>`; }
        svg.push(`<g class="bridge3 bs-${B.style} ${ch.broken ? "broken" : ""} ${gm ? "gm" : ""}" data-bridge="${esc(ch.ids.join(","))}">${body}<path class="bhit" d="${deck}" ${st(G + 6)}/></g>`);
        if (ch.broken) { const m = S[Math.floor(S.length / 2)]; html.push(`<span class="bridgex" style="left:${m[0]}px;top:${m[1]}px">✕</span>`); } } }

    const fogAt = svg.length; // a névoa dos jogadores fica por cima das rotas e pontes
    // rota sendo desenhada
    if (this.drawing?.points?.length) {
      const pts = this.drawing.points.map(p => { const q = this.w2s(p[0], p[1]); return [q.x, q.y]; });
      if (this.mouse) pts.push([this.mouse.x, this.mouse.y]);
      const dd = (this.routeMode ?? "curva") === "reta" ? "M" + pts.map(p => `${p[0]} ${p[1]}`).join("L") : smoothPath(pts);
      svg.push(`<path class="drawing" d="${dd}"/>`);
      if (SW) { const xs = pts.map(p => p[0]); const a = this.w2s(SW.X, 0).x; const ks = copiesFor(Math.min(...xs), Math.max(...xs), { X: a, W: dSW }); for (const k of ks) svg.push(`<path class="drawing" transform="translate(${(k * dSW).toFixed(1)},0)" d="${dd}"/>`); }
      for (const p of (this.mouse ? pts.slice(0, -1) : pts)) svg.push(`<circle class="handle draw" cx="${p[0]}" cy="${p[1]}" r="5"/>`);
    }
    if (this.drawing?.circle) { const q = this.w2s(...this.drawing.circle); svg.push(`<circle class="handle draw" cx="${q.x}" cy="${q.y}" r="4"/>`); if (this.mouse) svg.push(`<circle class="drawing" cx="${q.x}" cy="${q.y}" r="${Math.hypot(this.mouse.x - q.x, this.mouse.y - q.y)}" fill="none"/>`); }
    if (this.editing && this.tool === "portal") { const fp = this.portalFrom ? d.pois.find(p => p.id === this.portalFrom) : null;
      if (fp) { const q = this.w2s(fp.x, fp.y); html.push(`<span class="portfrom" style="left:${q.x.toFixed(1)}px;top:${q.y.toFixed(1)}px"></span>`); if (this.mouse) svg.push(`<path class="portlink draft" d="M${q.x.toFixed(1)} ${q.y.toFixed(1)}L${this.mouse.x} ${this.mouse.y}"/>`); }
      if (this.mouse) html.push(`<span class="cursorhint" style="left:${this.mouse.x}px;top:${this.mouse.y}px">${fp ? `ligar a ${esc(fp.name)} · Shift: encadear · Esc: soltar` : "clique num portal (no vazio, cria um)"}</span>`); }
    if (this.editing && this.tool === "rota" && this.mouse) html.push(`<span class="cursorhint" style="left:${this.mouse.x}px;top:${this.mouse.y}px">${(this.routeMode ?? "curva") === "circulo" ? (this.drawing ? "clique: raio" : "clique: centro do círculo") : this.drawing ? "esq.: ponto · Shift: 15° · dir.: desfaz · duplo: termina" : "esq.: começar (na ponta de uma rota: continua ela)"}</span>`);

    // caminhos: votações em andamento (todos veem) e o rascunho do grupo aberto no painel
    const toS = (pts) => pts.map(p => { const q = this.w2s(p[0], p[1]); return [q.x, q.y]; });
    const pathD = (sp) => sp.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("");
    const cur = this.panel === "grupo" || this.panel === "viagem" ? currentGroup(this) : null;
    for (const g of groupsOf(this)) {
      const isCur = cur?.id === g.id; if (!g.vote && !isCur) continue;
      const plan = shownPlan(this, g); if (!(plan?.pts?.length > 1)) continue;
      const tpl = (plan.legs ?? []).filter(l => l.portal); const cut = tpl.length || (plan.legs ?? []).some(l => l.seam); // teleporte e costura: o trecho do salto não é desenhado
      const path = cut ? plan.legs.filter(l => !l.portal && !l.seam && l.pts?.length > 1).map(l => pathD(toS(l.pts))).join("") || "M0 0" : pathD(toS(plan.pts)); const preview = isCur && this.travel.picking && this.travel.hover && !g.vote;
      for (const l of tpl) for (const [p, w] of [[l.pts[0], "Entrada do portal"], [l.pts[l.pts.length - 1], "Saída do portal"]]) { const q = this.w2s(wrapX(p[0], SW), p[1]); late.push(`<span class="tpmark" style="left:${q.x}px;top:${q.y}px;--tc:${esc(l.tpColor || "#b58ce8")}" title="${esc(w)}${l.name ? ` · ${esc(l.name)}` : ""}">${ic("portal", 14)}</span>`); }
      const s0 = svg.length; // mundo que dá a volta: o trecho que passa da borda é redesenhado do outro lado
      if (preview) svg.push(`<path class="preview" d="${path}"/>`);
      else if (isCur) {
        const vcol = g.vote ? (game.users.get(g.vote.by)?.color?.css ?? game.users.get(g.vote.by)?.color ?? "") : ""; const edit = !g.vote && canDrive(g);
        svg.push(`<path class="plan-glow" d="${path}"/><path class="plan-case" d="${path}"/><path class="${g.vote ? "vplan" : "plan"}" d="${path}" ${vcol ? `style="stroke:${esc(String(vcol))}"` : ""}/>${edit ? `<path class="planhit" data-planpath="${g.id}" d="${path}"/>` : ""}`);
        // a próxima etapa (o que "Partir/Continuar" vai andar) fica destacada
        if (!g.vote && game.user.isGM && plan.legs?.length) { try { const h = nextStop(this, plan); if (h < plan.totalHours - 1e-6) { const part = []; let acc = 0;
          for (const l of plan.legs) { if (acc >= h) break; const f = Math.min(1, (h - acc) / (l.hours || 1)); const L = polyLength(l.pts); if (f >= 1) part.push(...l.pts); else { let s = 0; part.push(l.pts[0]); for (let i = 1; i < l.pts.length; i++) { const d = Math.hypot(l.pts[i][0] - l.pts[i - 1][0], l.pts[i][1] - l.pts[i - 1][1]); if (s + d >= L * f) break; s += d; part.push(l.pts[i]); } part.push(pointAt(l.pts, L * f)); } acc += l.hours; }
          if (part.length > 1) svg.push(`<path class="plan-next" d="${pathD(toS(part))}"/>`); } } catch (e) { /* */ } }
        { // marcas dos dias: com muitos dias colados na tela, só uma a cada N (5, 10, 30…); navio em alto-mar não acampa
          const days = (plan.days ?? []).filter(d => !d.last); const sea = (plan.legs ?? []).length > 0 && plan.legs.every(l => l.type === "agua" || l.use === "barco");
          const spx = polyLength(toS(plan.pts)) / Math.max(1, days.length + 1);
          const N = [1, 2, 5, 10, 15, 30, 60, 90, 180, 365].find(k => spx * k >= 40) ?? 365;
          for (const day of days) { if (N > 1 && day.n % N) continue; const q = this.w2s(wrapX(day.pt[0], SW), day.pt[1]);
            const tip = sea ? `Dia ${day.n} no mar` : (edit ? "Parada para descanso · botão direito tira" : "Parada para descanso");
            late.push(`<span class="daymark ${sea ? "sea" : ""} ${edit && N === 1 ? "edit" : ""} ${day.forced ? "forced" : ""}" ${edit && N === 1 ? `data-stop="${day.n - 1}"` : ""} style="left:${q.x}px;top:${q.y}px" title="${tip}">${sea ? "" : ic("tent", 12)}<em>${day.n}</em></span>`); }
          if (N > 1) { const last = days[days.length - 1]; if (last && last.n % N) { /* o último dia sempre aparece */ const q = this.w2s(wrapX(last.pt[0], SW), last.pt[1]); late.push(`<span class="daymark ${sea ? "sea" : ""}" style="left:${q.x}px;top:${q.y}px" title="${sea ? `Dia ${last.n} no mar` : "Parada para descanso"}">${sea ? "" : ic("tent", 12)}<em>${last.n}</em></span>`); } }
        }
        { let vi = 0; for (const l of plan.legs ?? []) { if (l.type !== "via") continue; const q = this.w2s(l.pts[0][0], l.pts[0][1]); late.push(`<span class="viamark ${edit ? "edit" : ""}" ${edit ? `data-via="${vi}" title="Ponto da viagem · botão direito tira"` : ""} style="left:${q.x}px;top:${q.y}px">${ic("pin", 12)}</span>`); vi++; } }
        for (const l of plan.legs ?? []) { if (l.type !== "troca") continue; const q = this.w2s(l.pts[0][0], l.pts[0][1]); const emb = l.transfer === "embarque";
          late.push(`<span class="xfermark ${emb ? "emb" : "des"}" style="left:${q.x}px;top:${q.y}px">${ic(emb ? "enter" : "back", 13)}<em>${emb ? "Embarque" : "Desembarque"}</em></span>`); }
      } else { const vcol = g.vote ? (game.users.get(g.vote.by)?.color?.css ?? game.users.get(g.vote.by)?.color ?? "") : ""; svg.push(`<path class="vplan-case" d="${path}"/><path class="vplan" d="${path}" ${vcol ? `style="stroke:${esc(String(vcol))}"` : ""}/>`); }
      if (SW) { let mn = Infinity, mx = -Infinity; for (const p of plan.pts) { if (p[0] < mn) mn = p[0]; if (p[0] > mx) mx = p[0]; }
        if (crossesEdge(mn, mx, SW)) { wclip = true; const body = svg.splice(s0).join(""); const ks = copiesFor(mn, mx, SW);
          svg.push(`<g clip-path="url(#atlas-wclip)">${body}${ks.map(k => `<g transform="translate(${(k * dSW).toFixed(1)},0)">${body}</g>`).join("")}</g>`); } }
      const q = this.w2s(wrapX(plan.to.x, SW), plan.to.y); svg.push(`<circle class="dest" cx="${q.x}" cy="${q.y}" r="${22}"/>`);
      if (!plan.toId) html.push(`<span class="flagmark" style="left:${q.x}px;top:${q.y}px">${ic("flag", 22)}</span>`);
    }
    if (this.travel.picking && this.mouse) html.push(`<span class="pickhint" style="left:${this.mouse.x}px;top:${this.mouse.y}px">Clique para escolher o destino · Esc cancela</span>`);

    // rótulos
    // leitura do mapa (menos poluição): escala e opacidade dos marcadores e rótulos; "de perto" = zoom acima de N× o mapa inteiro na tela
    const RD = { poiScale: 1, poiOpacity: 1, labelOpacity: 1, nearK: 2, ...readOf(m), ...(this.mprev ?? {}) };
    const dm = sc.dimensions ?? {}; const fitZ = Math.min(W / (dm.sceneWidth || sc.width || W), H / (dm.sceneHeight || sc.height || H)) || 1;
    const near = z >= fitZ * RD.nearK;
    this.mapEl.style.setProperty("--poi-o", RD.poiOpacity); this.mapEl.style.setProperty("--lab-o", RD.labelOpacity);
    // jogadores: o que está debaixo da névoa não aparece
    const fogOn = !gm && m.fog && L.fog; const exp = d.explored;
    const revealed = (x, y) => { if (!fogOn) return true; let st = false; for (const e of exp) if (Math.hypot(e[0] - x, e[1] - y) <= e[2]) st = !e[3]; return st; };
    this._revealed = revealed;
    if (L.labels || (this.editing && this.tool === "rotulo") || this.selLabel) for (const lb of d.labels) {
      if (lb.hidden && !gm) continue; if (!revealed(lb.x, lb.y)) continue;
      if (!L.labels && !(this.editing && this.tool === "rotulo") && this.selLabel !== lb.id) continue;
      if (RD.labelDetail && !near && LABEL_DETAIL.has(lb.style ?? "") && this.selLabel !== lb.id) continue; // rótulos pequenos só de perto
      let lp = this.drag?.kind === "label" && this.drag.label === lb.id && this.drag.moved ? { x: this.drag.wx, y: this.drag.wy } : lb;
      const lsel = this.selLabel === lb.id || this.inMulti("labels", lb.id); if (lsel && this.drag?.kind === "multi" && this.drag.moved && !lb.locked) lp = { x: lb.x + this.drag.dx, y: lb.y + this.drag.dy };
      const q = this.w2s(lp.x, lp.y); const fs = Math.max(9, (lb.size ?? 18) * Math.min(1.8, Math.max(0.45, z * 1.5)));
      const lst = labelStyle(lb);
      if (lb.curve && Array.isArray(lb.pts) && lb.pts.length === 4) { // rótulo que corre por cima de uma curva (texto num caminho do SVG)
        const pts = lb.pts.map((o, i) => { const dh = this.drag?.kind === "lhandle" && this.drag.label === lb.id && this.drag.idx === i && this.drag.moved; return this.w2s(dh ? this.drag.wx : lp.x + o[0], dh ? this.drag.wy : lp.y + o[1]); });
        const d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}C${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)} ${pts[2].x.toFixed(1)} ${pts[2].y.toFixed(1)} ${pts[3].x.toFixed(1)} ${pts[3].y.toFixed(1)}`;
        const ow = Math.max(0, lst.ow) * Math.max(0.6, Math.min(1.6, fs / 22)); const t = String(lb.text ?? "").replace(/\s*(\||\n)\s*/g, " ");
        defs.push(`<path id="lp-${lb.id}" d="${d}"/>`);
        svg.push(`<text class="maplabel-c ${lsel ? "sel" : ""} ${lb.hidden ? "hid" : ""} ${this.editing ? "edit" : ""}" data-label="${lb.id}" dy="${(fs * 0.35).toFixed(1)}" style="font-size:${fs}px;font-family:${lst.font};font-weight:${lst.w};font-style:${lst.it ? "italic" : "normal"};letter-spacing:${lst.sp}em;fill:${lst.col};opacity:${lb.hidden ? 0.45 : lst.op};${ow ? `stroke:${lst.ol};stroke-width:${(ow * 2).toFixed(1)}px;paint-order:stroke;stroke-linejoin:round;` : ""}"><textPath href="#lp-${lb.id}" startOffset="50%" text-anchor="middle">${esc(lst.up ? t.toUpperCase() : t)}</textPath></text>`);
        if (lsel && this.editing) { // a linha e as alças, como numa estrada
          svg.push(`<path class="lcurve" d="${d}"/><line class="lknob-l" x1="${pts[0].x}" y1="${pts[0].y}" x2="${pts[1].x}" y2="${pts[1].y}"/><line class="lknob-l" x1="${pts[3].x}" y1="${pts[3].y}" x2="${pts[2].x}" y2="${pts[2].y}"/>`);
          pts.forEach((q2, i) => svg.push(i === 0 || i === 3 ? `<circle class="handle end" data-lhandle="${i}" cx="${q2.x}" cy="${q2.y}" r="6"/>` : `<rect class="handle knob" data-lhandle="${i}" x="${q2.x - 5}" y="${q2.y - 5}" width="10" height="10"/>`)); }
        continue;
      }
      const txt = esc(lb.text ?? "").replace(/\s*(\||\n)\s*/g, "<br>"); // "|" ou Enter quebram a linha
      html.push(`<span class="maplabel ${lsel ? "sel" : ""} ${lb.hidden ? "hid" : ""} ${this.editing ? "edit" : ""}" data-label="${lb.id}" style="left:${q.x}px;top:${q.y}px;font-size:${fs}px;transform:translate(-50%,-50%) rotate(${lb.rot ?? 0}deg);${labelCss(lst, fs)}">${txt}</span>`);
    }

    // locais
    const minorHidden = z < 0.16 || (RD.minorNear && !near), minorNoLabel = z < 0.3 || (RD.minorNear && !near); const shownPois = [];
    for (const raw of d.pois) {
      const p = normPoi(raw); const k = POI_KINDS[p.kind];
      if (!L.pois && !(this.editing && ["local", "portal"].includes(this.tool)) && this.sel !== p.id && !this.inMulti("pois", p.id)) continue; // camada desligada: some também na edição (fica só o que está selecionado)
      if (!gm && p.state === "oculto") continue;
      if (!gm && !revealed(p.x, p.y) && p.state !== "rumor") continue;
      const sel = this.sel === p.id || this.inMulti("pois", p.id);
      const linked = !!(p.submap || p.scene || p.markerImg); // entrada de outro mapa ou marcador com arte própria: nunca some com o zoom
      if (k.minor && minorHidden && !sel && !(linked && !(z < 0.16))) continue;
      const rumor = !gm && p.state === "rumor";
      let wx = p.x, wy = p.y;
      if (rumor) { const h = hash(p.id); const rr = p.rumor * this.gs * 0.45; wx += Math.cos(h) * rr; wy += Math.sin(h) * rr; const q = this.w2s(wx, wy); svg.push(`<circle class="rumorarea" cx="${q.x}" cy="${q.y}" r="${p.rumor * this.gs * z}"/>`); }
      if (this.drag?.poi === p.id && this.drag.moved) { wx = this.drag.wx; wy = this.drag.wy; }
      if (this.drag?.kind === "multi" && this.drag.moved && this.inMulti("pois", p.id) && !p.locked) { wx += this.drag.dx; wy += this.drag.dy; }
      if (!rumor) shownPois.push({ p, wx, wy });
      const q = this.w2s(wx, wy); let size = p.size || (p.markerImg ? Math.round(Math.max(24, Math.min(130, this.gs * z * 0.92))) : Math.round(k.size * RD.poiScale));
      const real = p.real || Number(m.realSize?.[p.kind]) || 0; if (real > 0) size = Math.max(size, Math.round(real * this.gs * z)); // a partir daqui cresce com o mapa
      const label = rumor ? "???" : p.name; const lm = p.labelMode || m.labels || "sempre";
      const showLabel = lm === "nunca" ? false : lm === "hover" ? (sel || this.hover === p.id) : lm === "perto" ? (near || linked || sel || this.hover === p.id) : (!(k.minor && minorNoLabel && !linked) || sel || this.hover === p.id);
      const inner = rumor ? "<b>?</b>" : p.markerImg ? `<span class="under">${ic(p.icon, Math.round(size * 0.45))}</span><img src="${esc(p.markerImg)}" alt="">` : ic(p.icon, Math.round(size * (p.shape === "livre" ? 0.95 : 0.55)));
      html.push(`<button class="poi k-${p.kind} s-${p.state} sh-${rumor ? "circulo" : p.shape} ${p.markerImg && !rumor ? "hasimg" : ""} ${sel ? "sel" : ""} ${k.danger ? "danger" : ""} ${this.editing ? "edit" : ""}" data-poi="${p.id}" style="left:${q.x}px;top:${q.y}px;--sz:${size}px" aria-label="${esc(label)}">
        <span class="pin" ${p.color ? `style="color:${p.color};--pc:${p.color}"` : ""}>${inner}</span>${showLabel ? `<span class="lbl">${esc(label)}</span>` : ""}</button>`);
      if (gm && tpOn && p.kind === "circulo" && p.remote.length) { // ligações com portais de outros mapas: um selo com o número
        const nm = p.remote.map(l => { const s2 = game.scenes.get(l.scene); const q2 = s2 ? dataOf(s2).pois.find(x => x.id === l.poi) : null; return q2 ? `${l.dir === "in" ? "←" : l.dir === "out" ? "→" : "↔"} ${q2.name} (${s2.navName || s2.name})` : null; }).filter(Boolean);
        if (nm.length) html.push(`<span class="tpremote" style="left:${(q.x + size * 0.42).toFixed(1)}px;top:${(q.y - size * 0.42).toFixed(1)}px" data-tooltip="${esc(nm.join(" · "))}">${ic("portal", 10)}${nm.length}</span>`); }
    }

    // elementos móveis (marcadores flutuantes); quem está no mesmo lugar fica lado a lado
    const inside = setting("groupIcon", "fora") === "dentro"; const ulm = setting("unitLabels", "sempre");
    const showName = (mv, sel) => { const m = mv.labelMode || ulm; return m === "sempre" || sel || (m === "hover" && this.hoverTip?.key === `m:${mv.id}`); };
    const vis = d.movers.map(normMover).filter(mv => (!mv.hidden || gm) && (gm || canDrive(mv) || revealed(mv.x, mv.y)));
    const slot = {}; const spot = (mv) => mv.at ? `p:${mv.at}` : `${Math.round(mv.x / (this.gs * 0.5))},${Math.round(mv.y / (this.gs * 0.5))}`;
    for (const mv of vis) { const k = spot(mv); slot[mv.id] = (slot[k] = (slot[k] ?? -1) + 1); }
    const screenOf = (mv) => {
      let pos = this.#moverPos(mv);
      if (this.drag?.kind === "mover" && this.drag.mover === mv.id && this.drag.moved) pos = { x: this.drag.wx, y: this.drag.wy, at: null };
      if (this.drag?.kind === "multi" && this.drag.moved && this.inMulti("movers", mv.id) && !mv.locked) pos = { x: pos.x + this.drag.dx, y: pos.y + this.drag.dy, at: null };
      const q = this.w2s(wrapX(pos.x, SW), pos.y); if (!this.anims[mv.id]) { const i = slot[mv.id] ?? 0; q.x += (pos.at ? 24 : 0) + i * 30; q.y -= pos.at ? 4 : 0; }
      return q;
    };
    const now2 = Date.now();
    // o mapa é redesenhado a cada passada do mouse: a flutuação usa o relógio da página para continuar do mesmo ponto
    const bt = performance.now() / 1000; const bobV = `--bd:-${(bt % 2.4).toFixed(3)}s;--bdm:-${(bt % 0.7).toFixed(3)}s;`;
    for (const mv of vis) {
      let q = screenOf(mv); let extra = ""; const f = this.fx[mv.id];
      if (mv.parked) { // veículo deixado no mapa: parado, menor, outro formato
        const K = MOVER_KINDS[mv.kind]; const col = mv.color || K.color; const icon = mv.icon || "carroca";
        html.push(`<div class="parked k-${mv.kind} ${mv.hidden ? "hid" : ""} ${this.inMulti("movers", mv.id) ? "sel" : ""}" data-mover="${mv.id}" style="left:${q.x}px;top:${q.y}px;${this.anims[mv.id] ? `opacity:${this.#edgeFade(this.anims[mv.id], [this.#moverPos(mv).x, 0], SW).toFixed(2)};` : ""}--mc:${esc(col)}"><span class="pk-base"></span><span class="pk-art">${icFilled(icon, 34)}</span>${showName(mv, this.inMulti("movers", mv.id)) ? `<span class="pk-label">${esc(mv.name)}</span>` : ""}</div>`);
        continue;
      }
      if (f) {
        const t = Math.min(1, (now2 - f.t0) / f.dur); const e = 1 - Math.pow(1 - t, 3);
        const src = f.kind === "split" ? vis.find(o => o.id === f.from) : null; const sq = src ? screenOf(src) : f.fromPos ? this.w2s(f.fromPos.x, f.fromPos.y) : null;
        if (f.kind === "split" && sq) { const tq = q; q = { x: sq.x + (tq.x - sq.x) * e, y: sq.y + (tq.y - sq.y) * e - Math.sin(e * Math.PI) * 26 }; svg.push(`<path class="splitline" d="M${sq.x} ${sq.y}L${q.x} ${q.y}"/>`); extra = `transform:scale(${(0.45 + 0.55 * e).toFixed(2)});`; if (t < 0.35) html.push(`<span class="fxring" style="left:${sq.x}px;top:${sq.y}px"><i></i></span>`); }
        if (f.kind === "merge" && t < 1) html.push(`<span class="fxring" style="left:${q.x}px;top:${q.y}px"><i></i></span>`);
        if (t >= 1) delete this.fx[mv.id]; else requestAnimationFrame(() => this.refreshMap());
      }
      const K = MOVER_KINDS[mv.kind]; const col = mv.color || K.color; const tr = transportOf(mv);
      const img = mv.img || "";
      const icon = transportIcon(mv, tr);
      const sel = this.selMover === mv.id || (cur?.id === mv.id) || this.inMulti("movers", mv.id);
      html.push(`<div class="mover ${inside ? "ip-in" : "ip-out"} k-${mv.kind} ${mv.hidden ? "hid" : ""} ${sel ? "sel" : ""} ${mv.vote ? "vote" : ""} ${this.anims[mv.id] ? "moving" : ""}" data-mover="${mv.id}" style="left:${q.x}px;top:${q.y}px;--mc:${esc(col)};${bobV}${extra}">
        <span class="shadow"></span><span class="bob"><span class="drop"><span class="face ${img ? "photo" : ""}">${img ? `<img src="${esc(img)}" alt="">` : inside ? `<span class="art3">${icFilled(icon, 30)}</span>` : ""}</span></span>${img || inside ? "" : `<span class="art2">${icFilled(icon, 44)}</span>`}${tr.mode === "montaria" ? `<span class="badge">${ic("horse", 10)}</span>` : ""}${tr.members.length > 1 ? `<span class="count">${tr.members.length}</span>` : ""}</span>${showName(mv, sel) ? `<span class="mlabel">${esc(mv.name)}</span>` : ""}${mv.vote ? `<span class="vflag">votando destino</span>` : ""}</div>`);
    }

    // unidades que estão num mapa filho aparecem aqui, junto do marcador que abre esse mapa
    for (const { p, wx, wy } of shownPois) {
      const cid = p.submap || p.scene; const child = cid && cid !== this.scene.id ? game.scenes.get(cid) : null; if (!child || !isMap(child)) continue;
      const units = unitsInside(child); if (!units.length) continue;
      const q = this.w2s(wx, wy); const base = vis.filter(mv => !mv.parked && mv.at === p.id).length; const where = child.navName || child.name;
      units.slice(0, 4).forEach((mv, i) => {
        const K = MOVER_KINDS[mv.kind]; const col = mv.color || K.color; const icon = transportIcon(mv, transportOf(mv));
        html.push(`<div class="mover ghost ip-out k-${mv.kind} ${mv.hidden ? "hid" : ""}" style="left:${q.x + 24 + (base + i) * 22}px;top:${q.y - 4}px;--mc:${esc(col)};${bobV}" aria-label="${esc(`${mv.name} · em ${where}`)}"><span class="shadow"></span><span class="bob"><span class="drop"><span class="face ${mv.img ? "photo" : ""}">${mv.img ? `<img src="${esc(mv.img)}" alt="">` : ""}</span></span>${mv.img ? "" : `<span class="art2">${icFilled(icon, 44)}</span>`}</span>${showName(mv, false) && units.length === 1 ? `<span class="mlabel">${esc(mv.name)}</span>` : ""}</div>`);
      });
      if (units.length > 4) html.push(`<span class="ghostmore" style="left:${q.x + 24 + (base + 4) * 22}px;top:${q.y - 18}px">+${units.length - 4}</span>`);
    }

    html.push(...late);
    // rosa dos ventos
    const w = this.liveWx ? normWeather(this.liveWx) : this.wx;
    if (w.enabled && L.rose && (gm || w.players)) {
      const dragging = this.drag?.kind === "rosehud" && this.drag.moved;
      if (dragging && w.rose.anchor !== "cena") { const near = this.cornerAt(w, this.drag.sx, this.drag.sy); for (const c of ["se", "so", "ne", "no"]) { const p = this.#cornerPos(w, c); hud.push(`<span class="rose-slot ${c === near ? "on" : ""}" style="left:${p.x}px;top:${p.y}px;width:${Math.max(p.S, 210) + 12}px;height:${p.S + 62}px"></span>`); } }
      if (w.rose.corner !== "nenhum" || dragging) { let pos = this.#cornerPos(w); if (dragging) pos = { ...pos, x: this.drag.sx, y: this.drag.sy }; hud.push(this.#rose(sc, w, pos)); }
    }

    // notas
    for (const n of notes().filter(n => n.sceneId === sc.id && (L.notes || n.kind === "dest"))) { // bandeiras aparecem mesmo com a camada Notas desligada
      if (n.private && n.userId !== game.user.id && !game.user.isGM) continue;
      const q = this.w2s(n.x, n.y); const col = userColor(n.userId);
      if (n.kind === "dest") { html.push(`<div class="flagpin" data-note="${n.id}" data-owner="${n.userId}" style="left:${q.x}px;top:${q.y}px;--fc:${esc(col)}"><svg viewBox="0 0 26 40" aria-hidden="true"><ellipse class="hole" cx="6" cy="38" rx="5" ry="1.8"/><line class="pole" x1="6" y1="38" x2="6" y2="3"/><path class="cloth" d="M6.5 4 Q13 1.5 19 4.5 T24 6 L24 15 Q19 13 13 15.5 T6.5 15 Z"/><circle class="knob" cx="6" cy="3" r="1.6"/></svg><span class="fname">${esc(game.users.get(n.userId)?.name ?? "")}</span></div>`); continue; }
      html.push(`<div class="note" data-note="${n.id}" data-owner="${n.userId}" style="left:${q.x}px;top:${q.y}px;--nc:${esc(col)}"><span class="dot"></span><div class="ntext"><strong>${esc(game.users.get(n.userId)?.name ?? "")}</strong> ${esc(n.text)}</div></div>`);
    }

    // pings
    const now = Date.now(); this.pings = this.pings.filter(p => now - p.t < 7000);
    for (const pg of this.pings.filter(p => p.sceneId === sc.id)) { const q = this.w2s(pg.x, pg.y); html.push(`<div class="ping" style="left:${q.x}px;top:${q.y}px;--pc:${esc(pg.color)}"><i></i><i></i><span>${esc(pg.label)}</span></div>`); }

    // retângulo de seleção (camada Atlas)
    if (this.marquee) { const a = this.w2s(this.marquee.x0, this.marquee.y0), b = this.w2s(this.marquee.x1, this.marquee.y1); svg.push(`<rect class="marquee" x="${Math.min(a.x, b.x)}" y="${Math.min(a.y, b.y)}" width="${Math.abs(b.x - a.x)}" height="${Math.abs(b.y - a.y)}"/>`); }
    // pincel da névoa
    if (this.editing && ["revelar", "cobrir"].includes(this.tool) && this.mouse) svg.push(`<circle class="brushc ${this.tool}" cx="${this.mouse.x}" cy="${this.mouse.y}" r="${this.brushR() * z}"/>`);
    // menu do botão direito
    if (this.ctx) html.push(this.#ctxMenu(d));

    // cartão ao passar o mouse
    if (this.hover && !this.drag) { const p = d.pois.map(normPoi).find(x => x.id === this.hover); if (p && (gm || p.state !== "oculto")) html.push(this.#hoverCard(p)); }
    else if (this.hoverTip && !this.drag) { const t = this.hoverTip; html.push(`<div class="hovertip" style="left:${t.x}px;top:${t.y}px"><b>${esc(t.title)}</b>${t.sub ? `<small>${esc(t.sub)}</small>` : ""}</div>`); }

    // névoa: cor, opacidade ou uma imagem própria (um mapa sem detalhes); revelar e cobrir em ordem
    if (m.fog && L.fog) {
      const R = this.view.getBoundingClientRect(); const live = this.brush ? this.brush.pts.map(p => [p[0], p[1], p[2], this.brush.cover ? 1 : 0]) : [];
      const circles = [...d.explored, ...live].map(e => { const q = this.w2s(e[0], e[1]); return [q.x, q.y, e[2] * z, e[3] ? 1 : 0]; }).filter(c => c[0] + c[2] > 0 && c[1] + c[2] > 0 && c[0] - c[2] < W && c[1] - c[2] < H);
      const X0 = sc.dimensions?.sceneX ?? 0, Y0 = sc.dimensions?.sceneY ?? 0, SW = sc.dimensions?.sceneWidth ?? sc.width, SH = sc.dimensions?.sceneHeight ?? sc.height;
      const tl = this.w2s(X0, Y0), br = this.w2s(X0 + SW, Y0 + SH);
      defs.push(`<filter id="fb" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${Math.max(4, this.gs * z * 0.6)}"/></filter>
        <mask id="fm" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/><g filter="url(#fb)">${circles.map(c => `<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="${c[2].toFixed(1)}" fill="${c[3] ? "#fff" : "#000"}"/>`).join("")}</g></mask>`);
      const op = m.fogOpacity == null || m.fogOpacity === "" ? 0.92 : Number(m.fogOpacity); const gmOp = Math.min(op, Number(uiPref("fogGm", 0.45)));
      const opv = gm ? gmOp : op; let fogPos = fogAt;
      if (!gm) { // rotas e pontes só aparecem onde já foi revelado
        defs.push(`<mask id="rvm" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect x="0" y="0" width="${W}" height="${H}" fill="#000"/><g filter="url(#fb)">${circles.map(c => `<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="${c[2].toFixed(1)}" fill="${c[3] ? "#000" : "#fff"}"/>`).join("")}</g></mask>`);
        svg.splice(fogAt, 0, `</g>`); svg.splice(routesAt, 0, `<g mask="url(#rvm)">`); fogPos = fogAt + 2; }
      if (m.fogImg) svg.splice(gm ? 0 : fogPos, 0, `<image class="fogimg" href="${esc(m.fogImg)}" x="${tl.x}" y="${tl.y}" width="${br.x - tl.x}" height="${br.y - tl.y}" preserveAspectRatio="none" mask="url(#fm)" style="opacity:${opv}"/>`);
      else svg.splice(gm ? 0 : fogPos, 0, `<rect class="fog ${gm ? "gm" : ""}" x="${Math.max(tl.x, R.left)}" y="${Math.max(tl.y, R.top)}" width="${Math.max(0, Math.min(br.x, R.right) - Math.max(tl.x, R.left))}" height="${Math.max(0, Math.min(br.y, R.bottom) - Math.max(tl.y, R.top))}" mask="url(#fm)" style="fill:${esc(m.fogColor || "#1b1d22")};opacity:${opv}"/>`);
    }

    this.mapW = W; this.mapH = H;
    this.mapEl.innerHTML = `<div class="wlayer">${wl}</div><svg class="svg" width="${W}" height="${H}"><defs>${defs.join("")}</defs>${svg.join("")}</svg>${html.join("")}`;
    // barra do céu no alto (mapas de região, cidade e local): sol, luas, cor do céu e as nuvens do clima daqui
    { const sb = this.#skyBar(sc, m, W, gm); if (sb != null) hud.push(`<div class="skybarwrap">${sb}</div>`); }
    if (this.skyOv) hud.push(this.#skyOverlay());
    this.#skyAnim();
    if (this.hudEl) this.hudEl.innerHTML = hud.join("");
    for (const img of this.mapEl.querySelectorAll("img")) img.addEventListener("error", () => { img.style.display = "none"; }, { once: true });
    const capture = (this.editing && ["local", "rota", "rotulo", "portal", "movel", "revelar", "cobrir", "nuvem", "regiao", "vrota", "vreg", "vwall"].includes(this.tool)) || (this.layerActive && this.tool === "bandeira") || !!this.noteDraft?.placing || !!this.drag || !!this.brush || !!this.cdrag || !!this.travel.picking;
    try { renderWeatherFx(this, this.sh.querySelector(".atlas")); } catch (err) { console.error(`${MODULE_ID} | clima`, err); }
    notifyVotes(this);
    this.mapEl.classList.toggle("capture", capture);
    this.mapEl.classList.toggle("editing", this.editing); this.mapEl.classList.toggle("t-vec", this.editing && isVec(this.tool));
    try { renderVBar(this); } catch (err) { console.error(`${MODULE_ID} | barra`, err); }
    this.mapEl.classList.toggle("t-rota", this.editing && this.tool === "rota");
    this.mapEl.classList.toggle("t-nuvem", this.editing && this.tool === "nuvem");
  }

  #moverPos(mv) {
    const a = this.anims[mv.id];
    if (a && a.sceneId === this.scene.id) {
      const st = animAt(a, pnow()); const pt = st.pt;
      if (st.f >= 1) delete this.anims[mv.id];
      return { x: pt[0], y: pt[1], at: null };
    }
    return mv;
  }

  /** Retângulos da interface do Foundry que a rosa deve evitar (só elementos visíveis e "de verdade", não contêineres). */
  #obstacles() {
    const sel = ["#scene-controls-layers", "#scene-controls-tools", "#players", "#scene-navigation-active", "#scene-navigation-inactive", "#scene-navigation menu", "#atlas-dock .atlas-dock-panel", "#atlas-dock .atlas-group-panel", "#hotbar", "#sidebar-tabs", "#sidebar-content.expanded", "#chat-notifications .chat-input", "#camera-views .camera-view"];
    const out = []; const W = window.innerWidth, H = window.innerHeight;
    for (const q of sel) for (const el of document.querySelectorAll(q)) {
      const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
      if (r.width > W * 0.6 || r.height > H * 0.85) continue; // contêiner que ocupa a tela: ignora
      const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.05) continue;
      if (r.right <= 0 || r.left >= W || r.bottom <= 0 || r.top >= H) continue;
      out.push({ l: r.left, t: r.top, r: r.right, b: r.bottom });
    }
    return out;
  }
  /** Procura, por amostragem, algum elemento clicável da interface do Foundry dentro do retângulo (pega também o que a lista não conhece). */
  #probe(x, y, w, h) {
    const ifc = document.getElementById("interface"); if (!ifc) return null; const W = window.innerWidth, H = window.innerHeight;
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
      const px = x + w * i / 4, py = y + h * j / 4; if (px < 0 || py < 0 || px >= W || py >= H) continue;
      for (const el of document.elementsFromPoint(px, py)) {
        if (el === this.hudHost || el === this.host || el === ifc || !ifc.contains(el)) continue;
        const r = el.getBoundingClientRect(); if (r.width > W * 0.6 || r.height > H * 0.85 || r.width < 4 || r.height < 4) continue;
        return { l: r.left, t: r.top, r: r.right, b: r.bottom };
      }
    }
    return null;
  }
  /** Retângulo da cena na tela. */
  #sceneRect() { const sc = this.scene; const X = sc.dimensions?.sceneX ?? 0, Y = sc.dimensions?.sceneY ?? 0, SW = sc.dimensions?.sceneWidth ?? sc.width, SH = sc.dimensions?.sceneHeight ?? sc.height; const a = this.w2s(X, Y), b = this.w2s(X + SW, Y + SH); return { l: a.x, t: a.y, r: b.x, b: b.y }; }
  /** Posição da rosa: num canto da tela (desviando da interface) ou presa num canto da cena (acompanha o mapa). */
  #cornerPos(w, corner = null) {
    const c = corner ?? (w.rose.corner === "nenhum" ? "se" : w.rose.corner); const cardH = w.rose.card === "nunca" ? 0 : 46;
    if (w.rose.anchor === "cena") {
      const R = this.#sceneRect(); const S = Math.max(30, Math.min(900, w.rose.hud * this.zoom)); const BH = S + (cardH ? 4 + cardH : 0);
      const at = corner ? null : mapOf(this.scene)?.roseAt; // posição livre, fixa nesta cena (arrastada pelo mestre)
      if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) { const q = this.w2s(at.x, at.y); return { x: q.x, y: q.y, S, hud: true }; }
      const pad = w.rose.margin != null ? w.rose.margin * this.zoom : Math.max(6, S * 0.12);
      const x = c.endsWith("o") ? R.l + pad + S / 2 : R.r - pad - S / 2; const y = c.startsWith("n") ? R.t + pad + BH / 2 : R.b - pad - BH / 2;
      return { x, y, S, hud: true };
    }
    const S = w.rose.hud || 140; const pad = 16;
    const BW = Math.max(S, cardH ? 210 : S), BH = S + (cardH ? 4 + cardH : 0);
    const W = window.innerWidth, H = window.innerHeight;
    const ck = [c, S, cardH, W, H].join(); const cc = this._roseCache?.[ck];
    if (cc && Date.now() - cc.t < 1500) return { x: cc.x, y: cc.y, S, hud: true };
    const obs = this.#obstacles(); const sx = c.endsWith("o") ? 1 : -1, sy = c.startsWith("n") ? 1 : -1;
    const x0 = c.endsWith("o") ? pad : W - pad - BW, y0 = c.startsWith("n") ? pad : H - pad - BH;
    const free = (x, y) => x >= 0 && y >= 0 && x + BW <= W && y + BH <= H && !obs.some(o => x < o.r + pad && x + BW > o.l - pad && y < o.b + pad && y + BH > o.t - pad) && !this.#probe(x - pad / 2, y - pad / 2, BW + pad, BH + pad);
    // procura o lugar livre mais perto do canto: deslizando pela borda de baixo/cima, pela lateral, ou na diagonal
    let x = x0, y = y0, found = free(x0, y0);
    for (let d = 24; !found && d < Math.max(W, H); d += 24) {
      for (const [dx, dy] of [[d, 0], [0, d], [d * 0.7, d * 0.7]]) { const cx = x0 + sx * dx, cy = y0 + sy * dy; if (free(cx, cy)) { x = cx; y = cy; found = true; break; } }
    }
    x = Math.max(pad, Math.min(W - pad - BW, x)); y = Math.max(pad, Math.min(H - pad - BH, y));
    (this._roseCache ??= {})[ck] = { x: x + BW / 2, y: y + BH / 2, t: Date.now() };
    return { x: x + BW / 2, y: y + BH / 2, S, hud: true };
  }
  /** Canto mais próximo de um ponto da tela (para soltar a rosa). */
  cornerAt(w, x, y) {
    if (w.rose.anchor === "cena") { const R = this.#sceneRect(); return (y < (R.t + R.b) / 2 ? "n" : "s") + (x < (R.l + R.r) / 2 ? "o" : "e"); }
    const W = window.innerWidth, H = window.innerHeight; return (y < H / 2 ? "n" : "s") + (x < W / 2 ? "o" : "e");
  }
  #rose(sc, w, hud) {
    const q = hud; const S = hud.S; const N = w.rose.north || 0; const F = w.rose.face, Hd = w.rose.hand;
    const to = (w.dir + 180 + N) % 360; const len = 18 + Math.min(w.force, 12) * 2.6; const [bl, kmh] = BEAUFORT[w.force]; const C = CLIMATES[w.climate];
    const ticks = Array.from({ length: 32 }, (_, i) => { const a = i * 11.25 * Math.PI / 180; const r1 = i % 2 ? 41 : 39; return `<line x1="${50 + Math.sin(a) * r1}" y1="${50 - Math.cos(a) * r1}" x2="${50 + Math.sin(a) * 44}" y2="${50 - Math.cos(a) * 44}"/>`; }).join("");
    const gm = game.user.isGM; const dragging = this.drag?.kind === "rosehud" && this.drag.moved;
    // transformação como num tile: girar, escalar, espelhar; opacidade; tinta multiplicando a imagem
    const tf = (o, base) => `transform:rotate(${base + o.rot}deg) scale(${o.scale * (o.flipX ? -1 : 1)},${o.scale * (o.flipY ? -1 : 1)});opacity:${o.alpha};${o.sat !== 1 ? `filter:saturate(${o.sat})` : ""}`;
    const tintLayer = (o, mask) => o.tint ? `<i class="r-tint" style="background:${o.tint};${mask ? `-webkit-mask:url('${esc(o.img)}') center/contain no-repeat;mask:url('${esc(o.img)}') center/contain no-repeat` : "border-radius:50%"}"></i>` : "";
    const dialSvg = `<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="r-bg" cx="50" cy="50" r="46"/><circle class="r-ring" cx="50" cy="50" r="44"/><circle class="r-ring2" cx="50" cy="50" r="30"/><g class="r-ticks">${ticks}</g>
        <path class="r-star2" d="M50 50 L58 42 L50 22 L42 42Z M50 50 L58 58 L78 50 L58 42Z M50 50 L42 58 L50 78 L58 58Z M50 50 L42 42 L22 50 L42 58Z" transform="rotate(45 50 50)"/>
        <path class="r-star" d="M50 8 L55 45 L50 50 L45 45Z M92 50 L55 55 L50 50 L55 45Z M50 92 L45 55 L50 50 L55 55Z M8 50 L45 45 L50 50 L45 55Z"/>
        <path class="r-dark" d="M50 8 L55 45 L50 50Z M92 50 L55 55 L50 50Z M50 92 L45 55 L50 50Z M8 50 L45 45 L50 50Z"/>
        <text x="50" y="6.5" class="r-n" transform="rotate(${-N - F.rot} 50 4.5)">N</text><text x="96" y="52" class="r-l" transform="rotate(${-N - F.rot} 96 50)">L</text><text x="50" y="99" class="r-l" transform="rotate(${-N - F.rot} 50 97)">S</text><text x="4" y="52" class="r-l" transform="rotate(${-N - F.rot} 4 50)">O</text></svg>`;
    const face = `<div class="r-layer" style="${tf(F, N)}">${F.img ? `<img class="r-dial" src="${esc(F.img)}" alt="">` : dialSvg}${tintLayer(F, !!F.img)}</div>`;
    const handCol = Hd.tint || "#2a6fb0";
    const handSvg = `<svg viewBox="0 0 100 100" aria-hidden="true" style="--hc:${handCol}"><line class="r-wind" x1="50" y1="${50 + len / 2}" x2="50" y2="${50 - len / 2}"/><path class="r-head" d="M50 ${50 - len / 2 - 6} L44.5 ${50 - len / 2 + 3} L55.5 ${50 - len / 2 + 3}Z"/>${Array.from({ length: Math.min(4, Math.ceil(w.force / 3)) }, (_, i) => `<line class="r-feather" x1="50" y1="${50 + len / 2 - i * 4}" x2="${56}" y2="${50 + len / 2 - i * 4 + 4}"/>`).join("")}<circle class="r-hub" cx="50" cy="50" r="3"/></svg>`;
    // ponteiro: gira devagar até a nova direção (passa um pouco e volta) e balança com as rajadas
    const now = Date.now(); const ND = 2600; let nd = this._needle;
    if (!nd) nd = this._needle = { from: to, to, t0: now - ND };
    else if (Math.abs(((to - nd.to) % 360 + 540) % 360 - 180) > 0.5) { const k = Math.min(1, (now - nd.t0) / ND); const cur = nd.from + (nd.to - nd.from) * k; let t2 = to; while (t2 - cur > 180) t2 -= 360; while (cur - t2 > 180) t2 += 360; nd = this._needle = { from: cur, to: t2, t0: now }; }
    const el = now - nd.t0; const amp = Math.min(9, 1.5 + w.force * 0.7); const sd = Math.max(0.8, 3.2 - w.force * 0.2);
    const needleStyle = el < ND ? `--from:${nd.from.toFixed(1)}deg;--to:${nd.to.toFixed(1)}deg;animation:rneedle ${ND}ms cubic-bezier(.25,1.45,.45,1) ${-el}ms both` : `transform:rotate(${nd.to.toFixed(1)}deg)`;
    const hand = `<div class="r-needle-rot" style="${needleStyle}"><div class="r-sway" style="--amp:${amp.toFixed(1)}deg;animation-duration:${sd.toFixed(2)}s;animation-delay:${-((now / 1000) % (sd * 2)).toFixed(2)}s"><div class="r-layer hand" style="${tf(Hd, 0)}">${Hd.img ? `<img class="r-needle" src="${esc(Hd.img)}" alt="">${tintLayer(Hd, true)}` : handSvg}</div></div></div>`;
    const card = w.rose.card === "nunca" ? "" : `<div class="r-card">${ic(C.icon, 14)}<span><b>${esc(C.label)}</b> · ${Math.round(w.temp)}°C</span><span>${ic("wind", 13)} ${esc(dirName(w.dir))} · ${kmh} km/h · ${esc(bl)}</span></div>`;
    return `<div class="rose hud card-${w.rose.card} ${this.roseOpen ? "open" : ""} ${gm ? "gmdrag" : ""} ${dragging ? "dragging" : ""}" data-rosehud="1" ${gm && !w.rose.locked ? `title="${w.rose.anchor === "cena" ? "Arraste para qualquer lugar da cena (fica fixa ali)" : "Arraste para outro canto"}${w.rose.card === "clique" ? " · clique mostra o clima" : ""}"` : ""} style="left:${q.x}px;top:${q.y}px;width:${S}px">${gm ? `<button type="button" class="r-x" data-rosehide="1" title="Ocultar a rosa dos ventos (volta em Natureza › Clima)">×</button>` : ""}
      <div class="r-face" style="width:${S}px;height:${S}px">${face}${hand}</div>${card}
    </div>`;
  }

  /** Linha do clima do local agora (as nuvens passando por cima dele). */
  #skyLine(p, rumor) {
    if (rumor) return ""; const w = this.wx; if (!w.enabled || !(this.gmView || w.players)) return "";
    let s = null; try { s = poiSky(this.scene, p); } catch (e) { /* */ } if (!s) return "";
    return `<small class="hc-sky">${ic(s.immune ? "house" : CLIMATES[s.climate]?.icon ?? "cloud", 12)} ${esc(s.label)}</small>`;
  }
  #hoverCard(p) {
    const k = POI_KINDS[p.kind]; const gm = this.gmView; const rumor = !gm && p.state === "rumor";
    const q = this.w2s(p.x, p.y); let t = ""; try { t = rumor ? "" : travelText(this, p.id); } catch (e) { /* */ }
    let img = rumor ? "" : p.img; if (!img && !rumor && p.submap) img = game.scenes.get(p.submap)?.thumb; if (!img && !rumor && p.scene) img = game.scenes.get(p.scene)?.thumb;
    // encaixa no marcador: acima ou abaixo dele, com o vinco apontando para ele
    const el = this.mapEl?.querySelector(`[data-poi="${CSS.escape(p.id)}"] .pin`); const rb = el?.getBoundingClientRect();
    const sz = Math.max(0.6, Math.min(1.8, Number(setting("cardSize", 1)) || 1)); const place = setting("cardPlace", "auto"); const estH = (img ? 190 : 100) * sz + 16;
    const top = rb ? rb.top : q.y - 14, bot = rb ? rb.bottom : q.y + 14; const cx = rb ? (rb.left + rb.right) / 2 : q.x;
    const down = place === "abaixo" || (place === "auto" && top - estH < 8);
    return `<div class="hovercard ${img ? "hasimg" : ""} ${down ? "down" : "up"}" style="left:${cx}px;top:${down ? bot + 10 : top - 10}px;--hcs:${sz}">${img ? `<div class="hc-img" style="background-image:url('${esc(img)}')"></div>` : ""}<div class="hc-txt"><strong>${esc(rumor ? "Local desconhecido" : p.name)}</strong><span>${esc(rumor ? "Rumor" : k.label)} · ${esc(POI_STATES[p.state].label)}</span>${!rumor && (p.shop || p.service) ? `<span class="hc-biz">${ic("shop", 12)} ${p.shop && p.service ? "Loja e serviços" : p.shop ? "Loja" : "Serviços"}</span>` : ""}${t ? `<em>${esc(t)}</em>` : ""}${this.#skyLine(p, rumor)}</div></div>`;
  }

  #shape(s, cls, extra = "") {
    const P = (x, y) => this.w2s(x, y); const sc = this.zoom;
    switch (s.type) {
      case "rectangle": { const p = P(s.x, s.y); const cx = p.x + s.width * sc / 2, cy = p.y + s.height * sc / 2; return `<rect class="${cls}" ${extra} x="${p.x}" y="${p.y}" width="${s.width * sc}" height="${s.height * sc}" transform="rotate(${s.rotation ?? 0} ${cx} ${cy})"/>`; }
      case "circle": { const p = P(s.x, s.y); return `<circle class="${cls}" ${extra} cx="${p.x}" cy="${p.y}" r="${s.radius * sc}"/>`; }
      case "ellipse": { const p = P(s.x, s.y); return `<ellipse class="${cls}" ${extra} cx="${p.x}" cy="${p.y}" rx="${s.radiusX * sc}" ry="${s.radiusY * sc}" transform="rotate(${s.rotation ?? 0} ${p.x} ${p.y})"/>`; }
      case "polygon": { const pts = []; for (let i = 0; i < (s.points?.length ?? 0); i += 2) { const p = P(s.points[i], s.points[i + 1]); pts.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`); } return `<polygon class="${cls}" ${extra} points="${pts.join(" ")}"/>`; }
    }
    return "";
  }

  /* ---------- eventos ---------- */
  #onClick(e) {
    { const sb = e.target.closest?.("[data-skyov]"); if (sb) { e.stopPropagation(); const a = sb.dataset.skyov; if (a === "close") this.closeSky(); else if (a === "view") { this.skyOv.view = sb.dataset.v; this.skyOv.sel = null; setUiPref("skyLastView", sb.dataset.v); this.refreshMap(); } else this.#skyBarAct(a, sb); return; }
      // o sol no céu de hoje: tentar descobrir a hora (teste do Cronos, se o mestre ligou)
      const sun = e.target.closest?.("[data-skysun]"); if (sun && this.skyOv?.view === "noite") { e.stopPropagation(); try { game.modules.get("brumas-cronos")?.api?.sunCheck?.(); } catch (err) { console.warn(err); } return; }
      if (e.target.closest?.(".skyov")) return; }
    if (this.editing && isVec(this.tool)) { e.stopPropagation(); return; }
    const cb = e.target.closest?.("[data-ctx]"); if (cb) { e.stopPropagation(); this.#ctxAction(cb.dataset.ctx); return; }
    if (this.#justDragged) { this.#justDragged = false; return; }
    if (e.target.closest?.("[data-rosehide]") && game.user.isGM) { e.stopPropagation(); setHudAuto({ corner: "nenhum" }); return; }
    const pp = e.target.closest?.("[data-planpath]"); if (pp) { e.stopPropagation(); this.addStopAt(e.clientX, e.clientY); return; }
    const bEl = e.target.closest?.("[data-bridge]"); if (bEl && game.user.isGM) { e.stopPropagation(); const ids = bEl.dataset.bridge.split(","); const st = bEl.classList.contains("broken") ? "inteira" : "quebrada"; (async () => { for (const id of ids) await this.toggleBridge(id, st); })(); return; }
    // bandeira de interesse (qualquer jogador, com a camada Atlas ativa)
    if (this.layerActive && this.tool === "bandeira") { e.stopPropagation(); this.placeFlag(e); return; }
    if (this.travel.picking) {
      e.stopPropagation(); const poi = e.target.closest?.("[data-poi]");
      if (poi) this.travel.target = poi.dataset.poi; else { const w = this.s2w(e.clientX, e.clientY); this.travel.target = { x: Math.round(w.x), y: Math.round(w.y) }; }
      this.travel.picking = false; this.travel.hover = null; this.panel = "grupo"; this.groupSub = "viagem"; this.refresh(); return;
    }
    if (this.editing && this.tool === "sel" && e.shiftKey) {
      const el = e.target.closest?.("[data-poi],[data-label],[data-mover],[data-route]");
      if (el) { e.stopPropagation(); const kind = el.dataset.poi ? "pois" : el.dataset.label ? "labels" : el.dataset.route ? "routes" : "movers"; const id = el.dataset.poi ?? el.dataset.label ?? el.dataset.route ?? el.dataset.mover;
        if (!this.multi.length) { if (this.sel) this.multi.push({ kind: "pois", id: this.sel }); if (this.selLabel) this.multi.push({ kind: "labels", id: this.selLabel }); if (this.selRoute) this.multi.push({ kind: "routes", id: this.selRoute }); }
        this.multi = this.inMulti(kind, id) ? this.multi.filter(x => !(x.kind === kind && x.id === id)) : [...this.multi, { kind, id }]; if (kind === "routes") { this.selRoute = null; this.showTab("rotas"); this.refresh(); } else this.refreshMap(); return; }
    }
    if (this.multi.length && !e.target.closest?.("[data-poi],[data-label],[data-mover]")) { const hadR = this.multi.some(x => x.kind === "routes"); this.multi = []; if (hadR) this.refreshChrome?.(); }
    const poi = e.target.closest?.("[data-poi]");
    if (poi) {
      e.stopPropagation();
      if (this.editing && this.tool === "rota") return editorClickMap(this, e);
      if (this.editing && this.tool !== "sel") return editorClickMap(this, e);
      return this.select(poi.dataset.poi);
    }
    const mv = e.target.closest?.("[data-mover]");
    if (mv && !(this.editing && this.tool !== "sel")) {
      e.stopPropagation();
      const pm = this.data.movers.find(x => x.id === mv.dataset.mover);
      if (pm?.parked) { // veículo parado: abre o grupo mais próximo que pode embarcar
        const R = this.gs * 1.5; const g = groupsOf(this).filter(x => canDrive(x) && !x.vehicle).map(x => ({ x, d: Math.hypot(x.x - pm.x, x.y - pm.y) })).sort((a, b) => a.d - b.d)[0];
        if (g && (g.d <= R || (g.x.at && g.x.at === pm.at))) selectGroup(this, g.x.id, "viagem"); return; }
      selectGroup(this, mv.dataset.mover); return;
    }
    const lb = e.target.closest?.("[data-label]");
    if (lb && this.editing && this.tool === "sel") { this.selectEdit({ selLabel: lb.dataset.label }); this.showTab("mapa"); return; }
    const rt = e.target.closest?.("[data-route]");
    if (rt && this.editing) { this.selectEdit({ selRoute: rt.dataset.route }); this.showTab("rotas"); return; }
    const rh = e.target.closest?.("[data-rosehud]");
    if (rh) { e.stopPropagation(); this.roseOpen = !this.roseOpen; this.refreshMap(); return; }
    if (this.mapEl.classList.contains("capture")) return editorClickMap(this, e);
  }
  #onDbl(e) {
    { const el = e.target.closest?.("[data-wline],[data-wname]"); if (el && game.user.isGM) { e.preventDefault(); e.stopPropagation(); this.#worldRename(el.dataset.wline || el.dataset.wname); return; } }
    if (this.editing && isVec(this.tool)) { vecDbl(this, e); return; }
    if (this.regDraw) { e.preventDefault(); finishRegion(this); return; }
    if (this.drawing) { e.preventDefault(); editorKey(this, { key: "Enter", preventDefault() { }, stopPropagation() { } }); return; }
    if (this.editing && this.tool === "sel" && this.selRoute && e.target.closest?.(`[data-route="${CSS.escape(this.selRoute)}"]`)) { e.preventDefault(); e.stopPropagation(); insertPoint(this, e); }
  }
  async #onContext(e) {
    if (this.editing && isVec(this.tool)) { e.preventDefault(); e.stopPropagation(); vecContext(this, e); return; }
    const st = e.target.closest?.("[data-stop]"); if (st) { e.preventDefault(); e.stopPropagation(); this.removeStop(Number(st.dataset.stop)); return; }
    const vm = e.target.closest?.("[data-via]"); if (vm) { e.preventDefault(); e.stopPropagation(); this.removeVia(Number(vm.dataset.via)); return; }
    if (e.target.closest?.("[data-planpath]")) { e.preventDefault(); e.stopPropagation(); if (!this.removeNearestStop(e.clientX, e.clientY)) this.tripUndo(); return; }
    const nt = e.target.closest?.("[data-note]");
    if (nt && (nt.dataset.owner === game.user.id || game.user.isGM)) { e.preventDefault(); e.stopPropagation();
      if (nt.classList.contains("flagpin") || await foundry.applications.api.DialogV2.confirm({ window: { title: "Atlas" }, content: `<p>Tirar esta nota do mapa?</p>`, rejectClose: false }).catch(() => false)) await request("delNote", { id: nt.dataset.note }); return; }
    const hit = this.editing && !this.drawing && !e.target.closest?.("[data-handle]") ? this.#ctxTarget(e) : null;
    if (hit) { e.preventDefault(); e.stopPropagation(); this.ctx = { ...hit, x: e.clientX, y: e.clientY }; this.refreshMap(); return; }
    if (this.mapEl.classList.contains("capture") || e.target.closest?.("[data-handle]")) { e.preventDefault(); e.stopPropagation(); }
    if (await editorContext(this, e)) { e.preventDefault(); e.stopPropagation(); }
  }
  /** Elemento sob o botão direito (para o menu Travar/Destravar). */
  #ctxTarget(e) {
    const t = e.target; let el;
    if ((el = t.closest?.("[data-poi]"))) return { kind: "pois", id: el.dataset.poi, sel: { sel: el.dataset.poi } };
    if ((el = t.closest?.("[data-mover]"))) return { kind: "movers", id: el.dataset.mover, sel: { selMover: el.dataset.mover } };
    if ((el = t.closest?.("[data-label]"))) return { kind: "labels", id: el.dataset.label, sel: { selLabel: el.dataset.label } };
    if ((el = t.closest?.("[data-route]"))) return { kind: "routes", id: el.dataset.route, sel: { selRoute: el.dataset.route } };
    return null;
  }
  async #ctxAction(act) {
    const c = this.ctx; this.ctx = null; if (!c) return this.refreshMap();
    if (act === "lock") { let now = false; await mutateData(this.scene, (D) => { const it = D[c.kind]?.find(x => x.id === c.id); if (!it) return []; it.locked = now = !it.locked; return [c.kind]; }); }
    if (act === "vis") await mutateData(this.scene, (D) => {
      const it = D[c.kind]?.find(x => x.id === c.id); if (!it) return [];
      if (c.kind === "pois") { const st = normPoi(it).state; if (st === "oculto") it.state = it.prevState && it.prevState !== "oculto" ? it.prevState : "avistado"; else { it.prevState = st; it.state = "oculto"; } }
      else it.hidden = !it.hidden;
      return [c.kind];
    });
    if (act === "edit") {
      this.tool = "sel"; this.selectEdit(c.sel);
      if (c.kind === "pois") { this.poiEdit = true; this.showTab("pois"); }
      else if (c.kind === "routes") this.showTab("rotas");
      else if (c.kind === "labels") this.showTab("mapa");
      else if (c.kind === "movers") { this.selMover = null; selectGroup(this, c.id, "composicao"); }
    }
    this.refresh();
  }
  #ctxMenu(d) {
    const c = this.ctx; const it = d[c.kind]?.find(x => x.id === c.id); if (!it) { this.ctx = null; return ""; }
    const name = it.name || it.text || ({ routes: "Rota", labels: "Rótulo" })[c.kind] || "Elemento";
    const hid = c.kind === "pois" ? normPoi(it).state === "oculto" : !!it.hidden;
    const x = Math.min(c.x, window.innerWidth - 230), y = Math.min(c.y, window.innerHeight - 110);
    return `<div class="ctxmenu" style="left:${x}px;top:${y}px"><div class="ctxh">${it.locked ? ic("lock", 12) : ""}${esc(name)}</div>
      <button type="button" data-ctx="lock">${ic(it.locked ? "unlock" : "lock", 14)}<span>${it.locked ? "Destravar (permitir mover)" : "Travar posição"}</span></button>
      <button type="button" data-ctx="vis">${ic(hid ? "eye" : "eyeoff", 14)}<span>${hid ? "Revelar aos jogadores" : "Esconder dos jogadores"}</span></button>
      <button type="button" data-ctx="edit">${ic("edit", 14)}<span>Editar…</span></button></div>`;
  }
  #lp = null;
  /** Segurar o clique num destino (local ou bandeira): mostra a viagem que o grupo faria. Esc cancela. */
  /** Tira o último ponto da viagem planejada; sem pontos intermediários, desfaz a viagem. */
  tripUndo() {
    if (this.editing || this.travel.picking) return false; const g = currentGroup(this); const T = this.travel;
    if (!g || !canDrive(g) || g.vote || T.moverId !== g.id || T.target == null) return false;
    if (T.via?.length) { const v = [...T.via]; T.target = v.pop(); T.via = v; } else { T.target = null; T.via = []; }
    T.stops = null; T.preview = null; this.refresh(); return true;
  }
  removeVia(i) { const T = this.travel; if (!T.via?.length) return; T.via = T.via.filter((_, k) => k !== i); T.stops = null; this.refresh(); }
  previewTravel(target, append = false) {
    const g = currentGroup(this); if (!g || !canDrive(g) || !target) return false;
    if (typeof target === "string" && g.at === target && !append) return false;
    const T = this.travel;
    T.preview = { prev: T.preview ? T.preview.prev : T.target ?? null, prevVia: T.preview ? T.preview.prevVia : [...(T.via ?? [])] };
    if (append && T.target) T.via = [...(T.via ?? []), T.target]; else if (!append) T.via = [];
    T.stops = null; this.travel.target = target; this.travel.picking = false; this.travel.moverId = g.id; this.gpanel = true; this.groupSub = "viagem"; this.panel = "grupo";
    try { globalThis.ui?.atlas?.showGroup?.(); } catch (e) { /* */ } this.refresh(); return true;
  }
  #onDown(e) {
    if (e.target.closest?.(".skyov")) { this.#skyDown(e); return; }
    if (this.#worldDown(e)) return;
    if (this.editing && isVec(this.tool) && !e.target.closest?.("[data-rosehud],[data-ctx]")) { this.#justDragged = false; if (vecDown(this, e)) { e.stopPropagation(); } return; }
    if (e.button !== 0) return;
    this.#justDragged = false;
    const dEl = e.target.closest?.("[data-poi],.flagpin[data-note]");
    if (dEl && gesture("gesturePoint") === "hold-left" && !(this.editing && this.tool !== "sel")) {
      clearTimeout(this.#lp?.t); const x = e.clientX, y = e.clientY; const ctrl = e.ctrlKey || e.metaKey;
      this.#lp = { x, y, t: setTimeout(() => { this.#lp = null;
        let tgt = dEl.dataset.poi ?? null;
        if (!tgt) { const n = notes().find(n => n.id === dEl.dataset.note); if (n) tgt = { x: n.x, y: n.y, name: `bandeira de ${game.users.get(n.userId)?.name ?? "alguém"}` }; }
        if (this.previewTravel(tgt, ctrl)) { this.#justDragged = true; this.drag = null; }
      }, 520) };
    }
    if (game.user.isGM && !e.target.closest?.("[data-rosehide]")) {
      if (e.target.closest?.("[data-rosehud]") && !this.wx.rose.locked) { this.drag = { kind: "rosehud", x0: e.clientX, y0: e.clientY, moved: false }; e.stopPropagation(); return; }
    }
    // pincel da névoa
    if (this.editing && ["revelar", "cobrir"].includes(this.tool)) { const w = this.s2w(e.clientX, e.clientY); this.brush = { cover: this.tool === "cobrir", pts: [[Math.round(w.x), Math.round(w.y), Math.round(this.brushR())]] }; e.stopPropagation(); this.refreshMap(); return; }
    // arrastar uma nuvem
    if (this.editing && this.tool === "nuvem") { const ci = this.#cloudAt(e.clientX, e.clientY); if (ci != null) { this.cdrag = { ci, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 }; e.stopPropagation(); } return; }
    if (this.editing && editorDown(this, e)) e.stopPropagation();
  }
  #hoverT = 0;
  #hoverRaf = null;
  /** Nome do elemento sob o mouse (grupos, bandeiras, notas, rotas). */
  #tipFor(el) {
    if (!el?.closest) return null; const d = this.data; let t;
    if ((t = el.closest("[data-mover]"))) { const m = d.movers.find(x => x.id === t.dataset.mover); if (!m) return null; const mv = normMover(m); const n = mv.members?.length ?? 0;
      if (mv.parked) return { key: `m:${mv.id}`, title: mv.name, sub: `Veículo parado${mv.leftBy ? ` · deixado por ${mv.leftBy}` : ""} · clique para embarcar` };
      return { key: `m:${mv.id}`, title: mv.name || "Grupo", sub: n ? mv.members.map(r => actorRef(r)?.name).filter(Boolean).slice(0, 6).join(", ") + (n > 6 ? ` +${n - 6}` : "") : (MOVER_KINDS[mv.kind]?.label ?? "") }; }
    if ((t = el.closest("[data-note]"))) { const n = notes().find(x => x.id === t.dataset.note); if (!n) return null; const who = game.users.get(n.userId)?.name ?? "";
      return { key: `n:${n.id}`, title: n.kind === "dest" ? `Bandeira de ${who}` : `Nota de ${who}`, sub: `${n.text ?? ""}${n.userId === game.user.id || game.user.isGM ? " · botão direito tira" : ""}` }; }
    if ((t = el.closest("[data-bridge]"))) { const [rid, key] = t.dataset.bridge.split(",")[0].split("|"); const r = d.routes.find(x => x.id === rid); const broken = (r?.bridges ?? {})[key] === "quebrada";
      return { key: `b:${t.dataset.bridge}:${broken}`, title: broken ? "Ponte quebrada" : "Ponte", sub: `${r?.name || ROUTE_TYPES[r?.type]?.label || "Estrada"}${game.user.isGM ? (broken ? " · clique para consertar" : " · clique para quebrar") : broken ? " · não dá para passar" : ""}` }; }
    if ((t = el.closest("[data-route]"))) { const r = d.routes.find(x => x.id === t.dataset.route); if (!r) return null; const nr = normRoute(r);
      return { key: `r:${nr.id}`, title: nr.name || ROUTE_TYPES[nr.type]?.label || "Rota", sub: nr.name ? (ROUTE_TYPES[nr.type]?.label ?? "") : "" }; }
    return null;
  }
  /** Paradas para descanso do plano em edição (horas de marcha desde a partida). */
  #curPlan() { const g = currentGroup(this); return g ? shownPlan(this, g) : null; }
  /** Tira a parada de descanso mais perto do clique (no caminho). */
  removeNearestStop(sx, sy) { const p = this.#curPlan(); const days = (p?.days ?? []).filter(d => !d.last); if (!days.length) return false;
    let bi = 0, bd = Infinity; days.forEach((d, i) => { const q = this.w2s(d.pt[0], d.pt[1]); const dd = Math.hypot(q.x - sx, q.y - sy); if (dd < bd) { bd = dd; bi = i; } }); this.removeStop(bi); return true; }
  removeStop(i) { const p = this.#curPlan(); if (!p) return; const ends = (p.days ?? []).filter(d => !d.last).map(d => d.end); ends.splice(i, 1); this.travel.stops = ends; this.refresh(); }
  addStopAt(cx, cy) {
    const p = this.#curPlan(); if (!p?.legs?.length) return; const w = this.s2w(cx, cy); let acc = 0, best = { d: Infinity, h: 0 };
    for (const l of p.legs) { const L = polyLength(l.pts) || 0; let s0 = 0;
      for (let i = 1; i < l.pts.length; i++) { const a = l.pts[i - 1], b = l.pts[i]; const dx = b[0] - a[0], dy = b[1] - a[1]; const l2 = dx * dx + dy * dy; const sl = Math.sqrt(l2);
        let t = l2 ? ((w.x - a[0]) * dx + (w.y - a[1]) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t)); const dd = Math.hypot(w.x - a[0] - t * dx, w.y - a[1] - t * dy);
        if (dd < best.d) best = { d: dd, h: acc + (L ? (s0 + t * sl) / L : 1) * l.hours }; s0 += sl; }
      acc += l.hours; }
    if (best.h < 0.25 || best.h > p.totalHours - 0.25) return;
    const ends = (p.days ?? []).filter(d => !d.last).map(d => d.end); ends.push(best.h); this.travel.stops = ends.sort((a, b) => a - b); this.refresh();
  }
  /** Quebra ou conserta uma ponte (só o mestre). */
  async toggleBridge(id, state = null) {
    const [rid, key] = id.split("|");
    await mutateData(this.scene, (D) => { const r = D.routes.find(x => x.id === rid); if (!r) return []; const b = { ...(r.bridges ?? {}) }; if (state) { if (state === "inteira") delete b[key]; else b[key] = state; } else if (b[key] === "quebrada") delete b[key]; else b[key] = "quebrada"; r.bridges = b; return ["routes"]; });
    this.cache.plans = {};
  }
  #hoverCheck(e) {
    if (this.#hoverRaf) return; const x = e.clientX, y = e.clientY;
    this.#hoverRaf = requestAnimationFrame(() => {
      this.#hoverRaf = null; let id = null;
      let tip = null;
      if (!this.drag && !this.brush) { const el = this.sh?.elementFromPoint?.(x, y); id = el?.closest?.("[data-poi]")?.dataset.poi ?? null; if (!id) tip = this.#tipFor(el); }
      const tk = tip ? `${tip.key}` : null;
      if (id !== this.hover || tk !== (this.hoverTip?.key ?? null)) { this.hover = id; this.hoverTip = tip ? { ...tip, x, y } : null; this.refreshMap(); }
      else if (tip && this.hoverTip) { this.hoverTip.x = x; this.hoverTip.y = y; const t = this.mapEl?.querySelector(".hovertip"); if (t) { t.style.left = `${x}px`; t.style.top = `${y}px`; } }
    });
  }
  #onMove(e) {
    if (!this.open || !this.scene || !this.map) return;
    if (this.wdrag) { const w = this.s2w(e.clientX, e.clientY); const v = dragValue(this.scene, normWorld(mapOf(this.scene)?.world ?? {}), this.wdrag.key, w.x, w.y); if (v) { this.wdrag.vals = v; this.wdrag.moved = true; this.refreshMap(); } return; }
    this.#hoverCheck(e);
    if (this.travel.picking) { const n = Date.now(); if (n - this.#hoverT > 120) { this.#hoverT = n; const w = this.s2w(e.clientX, e.clientY); this.travel.hover = { x: Math.round(w.x), y: Math.round(w.y) }; } }
    if (this.drawing || this.mapEl?.classList.contains("capture")) { this.mouse = { x: e.clientX, y: e.clientY }; this.refreshMap(); }
    this.vShift = e.shiftKey;
    if (this.vdrag) { vecMoveAll(this, e); return; }
    if (this.drag) editorMove(this, e);
    if (this.brush) { const w = this.s2w(e.clientX, e.clientY); const R = this.brushR(); const last = this.brush.pts[this.brush.pts.length - 1]; if (!last || Math.hypot(last[0] - w.x, last[1] - w.y) > R * 0.35) { this.brush.pts.push([Math.round(w.x), Math.round(w.y), Math.round(R)]); this.refreshMap(); } }
    if (this.cdrag) { const z = this.zoom || 1; this.cdrag.dx = (e.clientX - this.cdrag.x0) / z; this.cdrag.dy = (e.clientY - this.cdrag.y0) / z; for (const el of this.#cloudEls(this.cdrag.ci)) { el.style.marginLeft = `${this.cdrag.dx}px`; el.style.marginTop = `${this.cdrag.dy}px`; } }
  }
  #onUp(e) {
    if (this.wdrag) { const d = this.wdrag; this.wdrag = null; if (d.moved && d.vals) { this.#justDragged = true; saveData(this.scene, Object.fromEntries(Object.entries(d.vals).map(([k, v]) => [`map.world.${k}`, v]))).then(() => this.refresh()); } else this.refreshMap(); return; }
    if (this.vdrag) { vecUp(this, e); return; }
    if (this.drag) { if (this.drag.moved) this.#justDragged = true; editorUp(this, e); }
    if (this.brush) { const b = this.brush; this.brush = null; this.#justDragged = true; mutateData(this.scene, (D) => { for (const p of b.pts) D.explored.push(b.cover ? [...p, 1] : p); if (D.explored.length > 3000) D.explored = D.explored.slice(-3000); return ["explored"]; }); }
    if (this.cdrag) { const c = this.cdrag; this.cdrag = null; this.#justDragged = true; if (Math.hypot(c.dx, c.dy) > 1) { const w = normWeather(this.data.weather); const off = { ...(w.cloudOff ?? {}) }; const o = off[c.ci] ?? [0, 0]; off[c.ci] = [Math.round(o[0] + c.dx), Math.round(o[1] + c.dy)]; saveData(this.scene, { "weather.cloudOff": off }); } }
  }
  brushR() { return Math.max(0.25, Number(this._brushV ?? uiPref("brush", 2))) * this.gs; }
  #cloudEls(ci) { return [...document.querySelectorAll(`#atlas-wxmul .wxcloud[data-ci="${ci}"]`), ...(this.sh?.querySelectorAll(`.wxcloud[data-ci="${ci}"]`) ?? [])]; }
  /** Nuvem sob o cursor (as sombras ficam na camada de multiplicar). */
  #cloudAt(x, y) { const els = [...document.querySelectorAll("#atlas-wxmul .wxcloud")].reverse(); for (const el of els) { const r = el.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2; if (((x - cx) / (r.width / 2)) ** 2 + ((y - cy) / (r.height / 2)) ** 2 <= 1) return Number(el.dataset.ci); } return null; }
  /** Bandeira de interesse: "quero ir para cá" (uma por jogador; botão direito apaga). */
  async placeFlag(e) {
    const w = this.s2w(e.clientX, e.clientY); const d = this.data; const gm = game.user.isGM; let best = null, bd = this.gs * 0.6; // só gruda se clicar em cima do local
    for (const p0 of d.pois) { const p = normPoi(p0); if (!gm && (p.state === "oculto" || p.state === "rumor")) continue; if (!gm && this._revealed && !this._revealed(p.x, p.y)) continue; const dd = Math.hypot(p.x - w.x, p.y - w.y); if (dd < bd) { bd = dd; best = p; } }
    // dentro da área de um rumor: a bandeira fica onde o jogador clicou
    let rumor = null; if (!best && !gm) for (const p0 of d.pois) { const p = normPoi(p0); if (p.state === "rumor" && Math.hypot(p.x - w.x, p.y - w.y) <= Math.max(1, p.rumor) * this.gs) { rumor = p; break; } }
    const where = best ? best.name : rumor ? "a área do rumor" : "cá";
    await request("addNote", { sceneId: this.scene.id, x: Math.round(best?.x ?? w.x), y: Math.round(best?.y ?? w.y), text: `quer ir para ${where}`, private: false, kind: "dest" });
    globalThis.ui?.notifications?.info(`Atlas · bandeira fincada${best ? ` em ${best.name}` : ""}. Botão direito nela tira.`);
  }
  /** Esc desfaz a última coisa em andamento, uma por vez: menu, arrasto, desenho, prévia de viagem, seleção, painel do grupo. */
  #escape() {
    const T = this.travel; const done = () => { this.refresh(); return true; };
    if (this.ctx) { this.ctx = null; return done(); }
    if (this.#lp) { clearTimeout(this.#lp.t); this.#lp = null; return true; }
    if (this.drag) { this.drag = null; this.#justDragged = true; return done(); }
    if (this.cdrag) { for (const el of document.querySelectorAll("#atlas-wxmul .wxcloud, .wxworld .wxcloud")) { el.style.marginLeft = ""; el.style.marginTop = ""; } this.cdrag = null; return done(); }
    if (this.brush) { this.brush = null; return done(); }
    if (this.marquee) { this.marquee = null; return done(); }
    if (T.picking) { T.picking = false; T.hover = null; return done(); }
    if (this.noteDraft?.placing) { this.noteDraft = null; return done(); }
    // Esc com uma viagem andando (mestre): o grupo para onde está
    if (game.user.isGM && this.scene && travelActive(null, this.scene.id)) { cancelTravel(this.scene).then(() => { T.target = null; T.via = []; T.preview = null; T.stops = null; this.cache.plans = {}; this.refresh(); }); return true; }
    if (T.preview) { T.target = T.preview.prev ?? null; T.via = T.preview.prevVia ?? []; T.preview = null; T.stops = null; this.cache.plans = {}; return done(); }
    if (this.regDraw) { this.regDraw = null; return done(); }
    if (this.portalFrom) { this.portalFrom = null; return done(); }
    if (this.drawing) { this.drawing = null; this.mouse = null; return done(); }
    if (this.editing && this.tool !== "sel") { this.useTool("sel"); return done(); }
    if (this.multi?.length) { this.multi = []; return done(); }
    if (this.sel || this.selRoute || this.selLabel || this.selMover) { this.sel = null; this.selRoute = null; this.selLabel = null; this.selMover = null; this.selPt = null; this.poiEdit = false; return done(); }
    if (this.regHi) { this.regHi = null; return done(); }
    if (this.roseOpen) { this.roseOpen = false; return done(); }
    if (this.gpanel) { this.gpanel = false; return done(); }
    return false;
  }
  #overDock() { const d = document.getElementById("atlas-dock"); return !!d && (d.matches(":hover") || d.contains(document.activeElement)); }
  #onKey(e) {
    if (e.key === "Escape" && this.skyOv) { e.stopPropagation(); e.preventDefault(); this.closeSky(); return; }
    // Esc com uma viagem andando (mestre): cancela mesmo com o painel do Atlas fechado
    if (e.key === "Escape" && game.user.isGM && this.scene && travelActive(null, this.scene.id)) { const tg = e.composedPath?.()[0] ?? e.target; if (!["INPUT", "TEXTAREA", "SELECT"].includes(tg?.tagName) && !tg?.isContentEditable) { e.stopPropagation(); e.preventDefault(); this.#escape(); return; } }
    if (!this.open || !this.scene) return;
    const t = e.composedPath?.()[0] ?? e.target;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(t?.tagName) || t?.isContentEditable) return;
    if (this.editing && isVec(this.tool) && !((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") && vecKey(this, e)) return;
    if (e.key === "Escape" && this.#escape()) { e.stopPropagation(); e.preventDefault(); return; }
    // Ctrl+Z: desfaz o último passo do Atlas (com a camada Atlas ativa ou o mouse/foco no painel do Atlas)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z" && game.user.isGM && undoCount() && (this.layerActive || this.#overDock())) { e.stopPropagation(); e.preventDefault(); undoAtlas().then(ok => { if (ok) { this.cache.plans = {}; this.refresh(); } }); return; }
    // Delete com um grupo selecionado (mesmo fora da camada Atlas): apaga com confirmação
    if (e.key === "Delete" && !this.editing && game.user.isGM && (this.selMover || (this.gpanel && this.travel.moverId)) && !this.sel && !this.selRoute && !this.selLabel && !this.multi?.length) { e.stopPropagation(); e.preventDefault(); deleteSelection(this); return; }
    if (this.editing) editorKey(this, e);
  }

  /* ---------- mensagens ---------- */
  onPing(msg) { this.pings.push({ ...msg, t: Date.now() }); this.refreshMap(); setTimeout(() => this.refreshMap(), 7100); }
  onFx(msg) { if (msg.sceneId !== this.scene?.id) return; this.fx[msg.to] = { ...msg, t0: Date.now(), dur: msg.kind === "split" ? 1100 : 800 }; this.refreshMap(); }
  onAnim(msg) { this.anims[msg.moverId ?? "party"] = { ...msg, t0: pnow() }; this.refreshMap(); this.#animLoop(); }
  /** Viagem cancelada: o marcador para onde está (a posição certa vem nos dados). */
  onAnimStop(msg) { delete this.anims[msg.moverId]; this.refreshMap(); this.refreshChrome(); }
  /** Move só os marcadores em viagem a cada quadro (sem redesenhar o mapa todo): animação lisa. */
  /* ---------- teleporte: runas, coluna de luz, arco luminoso e chegada ---------- */
  #tpLayer() { if (this._tpl?.isConnected) return this._tpl; const el = document.createElement("div"); el.className = "tpfx"; this.mapEl.after(el); return (this._tpl = el); }
  #tpFx(id, st, a = null) {
    // a câmera acompanha o arco de luz quando a chegada está fora da tela
    if (a && st?.jump && !st.jump.mode && st.jump.u >= 0.3) { a._pan ??= new Set(); if (!a._pan.has(st.jump.i)) { a._pan.add(st.jump.i);
      try { const q = this.w2s(st.jump.B[0], st.jump.B[1]); const m = 80; if (q.x < m || q.y < m || q.x > window.innerWidth - m || q.y > window.innerHeight - m) canvas?.animatePan?.({ x: st.jump.B[0], y: st.jump.B[1], duration: Math.round((a.tp?.jumpMs ?? 2800) * 0.32) }); } catch (e) { /* */ } } }
    const L = this._tpl?.isConnected ? this._tpl : (st?.jump ? this.#tpLayer() : null); if (!L) return;
    let g = L.querySelector(`[data-tp="${CSS.escape(id)}"]`);
    if (!st?.jump) { g?.remove(); return; }
    if (!g) { g = document.createElement("div"); g.dataset.tp = id; L.appendChild(g); }
    g.innerHTML = tpSvg(this.w2s(st.jump.A[0], st.jump.A[1]), this.w2s(st.jump.B[0], st.jump.B[1]), st.jump.u, st.jump.color || "#b58ce8", id, st.jump.mode ?? null);
  }
  #animRaf = null;
  /** Mundo que dá a volta: quem viaja some ao chegar na borda e reaparece do outro lado (perto da borda, vai sumindo). */
  #edgeFade(a, pt, SW = wrapOf(this.scene)) {
    if (!a || !SW || !pt) return 1;
    a.wraps ??= a.pts.some(p => p[0] < SW.X - 1 || p[0] > SW.X + SW.W + 1) || !!a.tp?.jumps?.some(j => j.seam); if (!a.wraps) return 1;
    const wx = wrapX(pt[0], SW); const px = Math.min(wx - SW.X, SW.X + SW.W - wx) * (this.zoom || 1);
    return Math.max(0, Math.min(1, (px - 4) / 40));
  }
  #animLoop() {
    if (this.#animRaf) return;
    const step = () => {
      this.#animRaf = null; const ids = Object.keys(this.anims); if (!ids.length || !this.mapEl) return;
      let done = false;
      for (const id of ids) {
        const a = this.anims[id]; if (a.sceneId !== this.scene?.id) { delete this.anims[id]; this.#tpFx(id, null); continue; }
        const st = animAt(a, pnow()); const pt = st.pt; const f = st.f;
        const el = this.mapEl.querySelector(`.mover[data-mover="${CSS.escape(id)}"]`);
        if (el) { const SW = wrapOf(this.scene); const q = this.w2s(wrapX(pt[0], SW), pt[1]); el.style.left = `${q.x}px`; el.style.top = `${q.y}px`;
          const u = st.jump?.u; const ef = this.#edgeFade(a, pt, SW); const jo = u == null ? 1 : (u < 0.5 ? Math.max(0, 1 - u / 0.4) : Math.min(1, Math.max(0, (u - 0.62) / 0.25)));
          el.style.opacity = u == null && ef >= 1 ? "" : String(Math.min(jo, ef)); }
        this.#tpFx(id, st, a);
        if (f >= 1) { delete this.anims[id]; this.#tpFx(id, null); done = true; }
      }
      if (done) this.refreshMap();
      if (Object.keys(this.anims).length) this.#animRaf = requestAnimationFrame(step);
    };
    this.#animRaf = requestAnimationFrame(step);
  }
  onProposal(msg) { if (!game.user.isGM) return; this.proposals.push(msg); globalThis.ui?.notifications?.info(`Atlas: ${game.users.get(msg.userId)?.name ?? "Um jogador"} propôs uma viagem. Veja na aba Atlas.`); this.refreshChrome(); }
}

export const atlas = new AtlasUI();
