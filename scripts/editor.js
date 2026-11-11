// Editor do Mestre: locais, rotas (com bifurcações), rótulos, elementos móveis e a rosa dos ventos.
// Rotas: botão esquerdo põe ponto, botão direito apaga o último. Clicar sobre um ponto ou trecho de outra rota
// liga as duas (bifurcação). Clicar num local fecha a rota.
import { dataOf, mutateData, uid, normPoi, normMover, normWeather, uiPref, setHud, setHudAuto } from "./data.js";
import { bezierSegs, dragHandle } from "./geom.js";
import { wrapOf, edgeSnap, seamGhosts } from "./wrap.js";
import { reverseRoute } from "./vector.js";

/* ---------- grade ---------- */
export const snapMode = () => uiPref("snap", "livre");
// Como no Foundry: segurar Shift solta da grade (vale para marcadores, rotas, traçados, regiões e paredes).
let shiftHeld = false;
if (!globalThis.__brumasAtlasShift) {
  globalThis.__brumasAtlasShift = true;
  const track = (e) => { shiftHeld = !!e.shiftKey; };
  for (const t of ["keydown", "keyup", "pointerdown", "pointermove", "pointerup"]) window.addEventListener(t, track, true);
  window.addEventListener("blur", () => { shiftHeld = false; });
}
export const gridBypass = () => shiftHeld;
export function snapPoint(x, y, mode = snapMode()) {
  if (mode === "livre" || shiftHeld) return { x: Math.round(x), y: Math.round(y) };
  const M = globalThis.CONST?.GRID_SNAPPING_MODES;
  try { if (canvas.grid?.getSnappedPoint && M) { const p = canvas.grid.getSnappedPoint({ x, y }, { mode: mode === "centro" ? M.CENTER : M.VERTEX, resolution: 1 }); return { x: Math.round(p.x), y: Math.round(p.y) }; } } catch (e) { /* */ }
  const s = canvas.scene?.grid?.size ?? 100;
  return mode === "centro" ? { x: Math.floor(x / s) * s + s / 2, y: Math.floor(y / s) * s + s / 2 } : { x: Math.round(x / s) * s, y: Math.round(y / s) * s };
}

/* ---------- o que está sob o mouse ---------- */
const near = (ui, sx, sy, px = 20) => {
  let best = null, bd = px;
  for (const p of dataOf(ui.scene).pois) { const q = ui.w2s(p.x, p.y); const d = Math.hypot(q.x - sx, q.y - sy); if (d <= bd) { bd = d; best = p; } }
  return best;
};
function nearVertex(ui, sx, sy, px = 12, skip = null) {
  let best = null, bd = px;
  for (const r of dataOf(ui.scene).routes) { if (r.id === skip || r.type === "portal") continue; r.points.forEach((p, i) => { const q = ui.w2s(p[0], p[1]); const d = Math.hypot(q.x - sx, q.y - sy); if (d <= bd) { bd = d; best = { route: r.id, idx: i, pt: [...p] }; } }); }
  return best;
}
function nearSegment(ui, sx, sy, px = 9, skip = null, only = null) {
  let best = null, bd = px;
  for (const r of dataOf(ui.scene).routes) {
    if (r.id === skip || (only && r.id !== only) || r.type === "portal") continue;
    const segs = bezierSegs(r.points, r.handles);
    segs.forEach(([p0, c1, c2, p1], si) => {
      for (let k = 1; k < 24; k++) {
        const t = k / 24, u = 1 - t; const x = u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0], y = u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1];
        const q = ui.w2s(x, y); const d = Math.hypot(sx - q.x, sy - q.y);
        if (d <= bd && t > 0.06 && t < 0.94) { bd = d; best = { route: r.id, i: si + 1, pt: [Math.round(x), Math.round(y)] }; }
      }
    });
  }
  return best;
}
/** Duplo clique na rota selecionada: insere um ponto ali (como num editor de vetores). */
export async function insertPoint(ui, e) {
  if (!ui.selRoute || isLocked(ui, "routes", ui.selRoute)) return false;
  const sg = nearSegment(ui, e.clientX, e.clientY, 14, null, ui.selRoute); if (!sg) return false;
  await mutateData(ui.scene, (D) => { const r = D.routes.find(q => q.id === sg.route); if (!r) return []; r.points.splice(sg.i, 0, sg.pt); if (Array.isArray(r.handles)) { while (r.handles.length < r.points.length - 1) r.handles.push(null); r.handles.splice(sg.i, 0, null); } return ["routes"]; });
  ui.selPt = sg.i; ui.refresh(); return true;
}

/** Parte uma rota num vértice (ou insere o vértice num trecho e parte ali). Devolve o ponto da junção. */
function splitAt(D, routeId, { idx = null, i = null, pt = null }) {
  const k = D.routes.findIndex(r => r.id === routeId); if (k < 0) return null;
  const r = D.routes[k];
  const hs = Array.isArray(r.handles) ? [...r.handles] : []; while (hs.length < r.points.length) hs.push(null);
  if (i != null) { r.points.splice(i, 0, pt); hs.splice(i, 0, null); idx = i; }
  r.handles = hs;
  if (idx === 0 || idx === r.points.length - 1) return [...r.points[idx]];
  const r2 = { ...foundry.utils.deepClone(r), id: uid(), points: r.points.slice(idx), handles: hs.slice(idx), a: null };
  r.points = r.points.slice(0, idx + 1); r.handles = hs.slice(0, idx + 1); r.b = null;
  D.routes.splice(k + 1, 0, r2);
  return [...r.points[idx]];
}

/* ---------- arrastar ---------- */
export const isLocked = (ui, kind, id) => (ui.editLock && kind !== "movers") || !!ui.data[kind]?.find(x => x.id === id)?.locked; // fora do modo edição o mapa fica travado (as unidades continuam andando)
export function editorDown(ui, e) {
  if (ui.tool !== "sel") return false;
  const start = (o) => { ui.drag = { ...o, x0: e.clientX, y0: e.clientY, moved: false }; return true; };
  const lockd = (name) => start({ kind: "locked", name });
  // vários selecionados: arrastar um move todos
  const el = e.target.closest?.("[data-poi],[data-label],[data-mover]");
  if (el && ui.multi?.length > 1 && !ui.editLock) { const kind = el.dataset.poi ? "pois" : el.dataset.label ? "labels" : "movers"; const id = el.dataset.poi ?? el.dataset.label ?? el.dataset.mover;
    if (ui.multi.some(x => x.kind === kind && x.id === id)) { const w = ui.s2w(e.clientX, e.clientY); return start({ kind: "multi", w0: [w.x, w.y], dx: 0, dy: 0 }); } }
  const kn = e.target.closest?.("[data-knob]");
  if (kn && ui.selRoute) return isLocked(ui, "routes", ui.selRoute) ? lockd("Esta rota") : start({ kind: "knob", route: ui.selRoute, idx: Number(kn.dataset.pt), side: kn.dataset.knob, alt: e.altKey });
  const h = e.target.closest?.("[data-handle]");
  if (h && ui.selRoute) return isLocked(ui, "routes", ui.selRoute) ? lockd("Esta rota") : start({ kind: "handle", route: ui.selRoute, idx: Number(h.dataset.handle) });
  const p = e.target.closest?.("[data-poi]");
  if (p) return isLocked(ui, "pois", p.dataset.poi) ? lockd("Este local") : start({ kind: "poi", poi: p.dataset.poi });
  const m = e.target.closest?.("[data-mover]");
  if (m) return isLocked(ui, "movers", m.dataset.mover) ? lockd("Este grupo") : start({ kind: "mover", mover: m.dataset.mover });
  const lh = e.target.closest?.("[data-lhandle]");
  if (lh && ui.selLabel) return isLocked(ui, "labels", ui.selLabel) ? lockd("Este rótulo") : start({ kind: "lhandle", label: ui.selLabel, idx: Number(lh.dataset.lhandle) });
  const l = e.target.closest?.("[data-label]");
  if (l) return isLocked(ui, "labels", l.dataset.label) ? lockd("Este rótulo") : start({ kind: "label", label: l.dataset.label });
  const r = e.target.closest?.("[data-rose]");
  if (r) return start({ kind: "rose" });
  return false;
}
export function editorMove(ui, e) {
  const d = ui.drag; if (!d) return;
  if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return;
  if (d.kind === "locked") {  return; }
  d.moved = true; const w = ui.s2w(e.clientX, e.clientY);
  if (d.kind === "multi") { d.dx = Math.round(w.x - d.w0[0]); d.dy = Math.round(w.y - d.w0[1]); ui.refreshMap(); return; } const s = d.kind === "rose" || d.kind === "knob" ? { x: Math.round(w.x), y: Math.round(w.y) } : snapPoint(w.x, w.y);
  if (d.kind === "knob") d.alt = d.alt || e.altKey;
  d.wx = s.x; d.wy = s.y; d.sx = e.clientX; d.sy = e.clientY;
  ui.refreshMap();
}
export async function editorUp(ui, e) {
  const d = ui.drag; ui.drag = null;
  if (!d?.moved) { if (d?.kind === "handle") { ui.selPt = d.idx; ui.refresh(); return; } ui.refreshMap(); return; }
  const x = d.wx, y = d.wy;
  if (d.kind === "poi") await mutateData(ui.scene, (D) => {
    const p = D.pois.find(q => q.id === d.poi); if (!p) return [];
    p.x = x; p.y = y;
    for (const r of D.routes) { const n = r.points.length; if (r.a === d.poi) r.points[0] = [x, y]; if (r.b === d.poi) r.points[n - 1] = [x, y]; }
    for (const m of D.movers) if (m.at === d.poi) { m.x = x; m.y = y; }
    return ["pois", "routes", "movers"];
  });
  if (d.kind === "handle") await mutateData(ui.scene, (D) => {
    const r = D.routes.find(q => q.id === d.route); if (!r) return [];
    const end = d.idx === 0 ? "a" : d.idx === r.points.length - 1 ? "b" : null;
    const snap = end ? near(ui, d.sx, d.sy) : null; const v = !snap && end ? nearVertex(ui, d.sx, d.sy, 12, r.id) : null;
    const np = snap ? [snap.x, snap.y] : v ? [...v.pt] : [x, y]; const S = wrapOf(ui.scene); if (S) { np[0] = edgeSnap(S, Math.min(S.X + S.W, Math.max(S.X, np[0])), 10 / (ui.zoom || 1)).x;
      if (d.idx === 0 || d.idx === r.points.length - 1) { const tol = 16 / (ui.zoom || 1); const gh = seamGhosts(S, D.routes.filter(q => q.id !== r.id)).find(g => !g.linked && Math.hypot(g.x - np[0], g.y - np[1]) <= tol); if (gh) { np[0] = gh.x; np[1] = gh.y; } } } // ponta levada até o ponto fantasma: une com a rota do outro lado
    r.points[d.idx] = np; // mundo que dá a volta: o ponto não sai do mapa; encostado na borda, gruda nela
    if (end) r[end] = snap?.id ?? null;
    return ["routes"];
  });
  if (d.kind === "mover") await mutateData(ui.scene, (D) => { const m = D.movers.find(q => q.id === d.mover); if (!m) return []; const p = near(ui, d.sx, d.sy); m.x = p?.x ?? x; m.y = p?.y ?? y; m.at = p?.id ?? null; m.plan = null; m.vote = null; return ["movers"]; });
  if (d.kind === "rosehud") {
    const w = normWeather(ui.data.weather);
    if (w.rose.anchor === "cena") { const p = ui.s2w(d.sx, d.sy); await mutateData(ui.scene, (D) => { D.map = { ...(D.map ?? {}), roseAt: { x: Math.round(p.x), y: Math.round(p.y) } }; return ["map"]; }); if (w.rose.corner === "nenhum") await setHudAuto({ corner: "se" }); }
    else { const c = ui.cornerAt(w, d.sx, d.sy); await setHudAuto({ corner: c }); }
  }
  if (d.kind === "multi") await mutateData(ui.scene, (D) => {
    const has = (k, id) => ui.multi.some(x => x.kind === k && x.id === id); const moved = new Set();
    for (const p of D.pois) if (has("pois", p.id) && !p.locked) { p.x += d.dx; p.y += d.dy; moved.add(p.id); }
    for (const r of D.routes) { if (r.locked) continue; if (moved.has(r.a)) r.points[0] = [r.points[0][0] + d.dx, r.points[0][1] + d.dy]; if (moved.has(r.b)) { const k = r.points.length - 1; r.points[k] = [r.points[k][0] + d.dx, r.points[k][1] + d.dy]; } }
    for (const r of D.routes) if (has("routes", r.id) && !r.locked) r.points = r.points.map(p => [p[0] + d.dx, p[1] + d.dy]);
    for (const l of D.labels) if (has("labels", l.id) && !l.locked) { l.x += d.dx; l.y += d.dy; }
    for (const m of D.movers) if ((has("movers", m.id) || (m.at && moved.has(m.at))) && !m.locked) { m.x += d.dx; m.y += d.dy; if (m.at && !moved.has(m.at)) m.at = null; }
    return ["pois", "routes", "labels", "movers"];
  });
  if (d.kind === "knob") await mutateData(ui.scene, (D) => { const r = D.routes.find(q => q.id === d.route); if (!r) return []; r.handles = dragHandle(r.points, r.handles, d.idx, d.side, x, y, d.alt); return ["routes"]; });
  if (d.kind === "lhandle") await mutateData(ui.scene, (D) => { const l = D.labels.find(q => q.id === d.label); if (!l || !Array.isArray(l.pts)) return []; l.pts[d.idx] = [Math.round(x - l.x), Math.round(y - l.y)]; return ["labels"]; });
  if (d.kind === "label") await mutateData(ui.scene, (D) => { const l = D.labels.find(q => q.id === d.label); if (l) { l.x = x; l.y = y; } return ["labels"]; });
  if (d.kind === "rose") await mutateData(ui.scene, (D) => { const w = normWeather(D.weather); D.weather = { ...(D.weather ?? {}), rose: { ...w.rose, x, y } }; return ["weather"]; });
  ui.refresh();
}

/* ---------- cliques ---------- */
export async function editorClickMap(ui, e) {
  const w = ui.s2w(e.clientX, e.clientY); const s = snapPoint(w.x, w.y); const x = s.x, y = s.y;
  if (ui.noteDraft?.placing) { ui.noteDraft = { ...ui.noteDraft, x: Math.round(w.x), y: Math.round(w.y), placing: false }; ui.refresh(); return; }
  if (!ui.editing) return;
  if (ui.tool === "local") {
    const id = uid();
    await mutateData(ui.scene, (D) => { D.pois.push(normPoi({ id, name: "Novo local", kind: ui.newPoi.kind, state: ui.newPoi.state, locked: !!ui.newPoi.locked, x, y })); return ["pois"]; });
    ui.useTool("sel"); ui.poiEdit = true; ui.selectEdit({ sel: id }); return;
  }
  if (ui.tool === "rota") return routeClick(ui, e, x, y);
  if (ui.tool === "portal") return portalClick(ui, e, x, y);
  if (ui.tool === "regiao") { if (e.detail > 1) return; (ui.regDraw ??= { pts: [] }).pts.push([x, y]); ui.refreshMap(); return; }
  if (ui.tool === "rotulo") {
    const id = uid();
    await mutateData(ui.scene, (D) => { D.labels.push({ id, text: "Nome", x, y, size: 18, rot: 0, style: "regiao" }); return ["labels"]; });
    ui.useTool("sel"); ui.selectEdit({ selLabel: id }); return;
  }
  if (ui.tool === "movel") {
    const id = uid(); const p = near(ui, e.clientX, e.clientY);
    await mutateData(ui.scene, (D) => { D.movers.push(normMover({ id, name: ui.newMover?.kind === "veiculo" ? "Veículo" : ui.newMover?.kind === "pessoa" ? "Pessoa" : ui.newMover?.kind === "navio" ? "Navio" : "Grupo", kind: ui.newMover?.kind ?? "grupo", x: p?.x ?? x, y: p?.y ?? y, at: p?.id ?? null, main: !D.movers.length })); return ["movers"]; });
    ui.tool = "sel"; ui.selectEdit({ selMover: id }); return;
  }
}

/**
 * Ligar portais: clique num portal (no vazio, cria um ali) e depois nos outros. Cada novo clique liga ao primeiro;
 * com Shift, liga ao último e passa a partir dele (corrente). Esc solta. A ligação é sempre uma linha reta.
 */
export function portalAt(ui, sx, sy, px = 22) {
  let best = null, bd = px;
  for (const p of dataOf(ui.scene).pois) { if (p.kind !== "circulo") continue; const q = ui.w2s(p.x, p.y); const d = Math.hypot(q.x - sx, q.y - sy); if (d <= bd) { bd = d; best = p; } }
  return best;
}
async function portalClick(ui, e, x, y) {
  const hit = portalAt(ui, e.clientX, e.clientY); let id = hit?.id;
  if (!id) { id = uid(); const n = dataOf(ui.scene).pois.filter(p => p.kind === "circulo").length + 1;
    await mutateData(ui.scene, (D) => { D.pois.push(normPoi({ id, name: `Portal ${n}`, kind: "circulo", state: "visitado", x: Math.round(x), y: Math.round(y) })); return ["pois"]; }); }
  const from = ui.portalFrom && dataOf(ui.scene).pois.some(p => p.id === ui.portalFrom) ? ui.portalFrom : null;
  if (!from || from === id) { ui.portalFrom = id; ui.refresh(); return; }
  const D0 = dataOf(ui.scene); const A = D0.pois.find(p => p.id === from), B = D0.pois.find(p => p.id === id);
  if (D0.routes.some(r => r.type === "portal" && ((r.a === from && r.b === id) || (r.a === id && r.b === from)))) globalThis.ui?.notifications?.info(`Atlas · ${A.name} e ${B.name} já estão ligados.`);
  else await mutateData(ui.scene, (D) => { D.routes.push({ id: uid(), name: "", type: "portal", cond: "aberta", points: [[A.x, A.y], [B.x, B.y]], handles: [], a: from, b: id, oneway: false }); return ["routes"]; });
  if (e.shiftKey) ui.portalFrom = id;
  ui.refresh();
}

/**
 * Desenho de rotas. Modos (painel Rotas): curva, reta e círculo.
 * - Encostar noutra rota só gruda o ponto nela (a viagem já entende cruzamentos e bifurcações): nada é quebrado.
 * - Começar em cima da ponta de uma rota existente continua aquela rota.
 * - Shift: ângulo em passos de 15°. Clicar num local, duplo clique ou Enter termina.
 */
async function routeClick(ui, e, x, y) {
  const mode = ui.routeMode ?? "curva";
  const p = near(ui, e.clientX, e.clientY);
  if (mode === "circulo") {
    const c = p ? [p.x, p.y] : [x, y];
    if (!ui.drawing?.circle) { ui.drawing = { circle: c, points: [] }; ui.refresh(); return; }
    const [cx, cy] = ui.drawing.circle; const r = Math.hypot(x - cx, y - cy); ui.drawing = null; if (r < 4) { ui.refresh(); return; }
    const k = 0.5523 * r; const pts = [], hs = [];
    for (let i = 0; i <= 4; i++) { const a = (i % 4) * Math.PI / 2; pts.push([Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r)]); hs.push({ a: (a * 180 / Math.PI + 90) % 360, l1: k, l2: k }); }
    const id = uid(); await mutateData(ui.scene, (D) => { D.routes.push({ id, name: "", type: ui.newRouteType ?? "estrada", cond: "aberta", points: pts, handles: hs, a: null, b: null, closed: true }); return ["routes"]; });
    ui.selRoute = id; ui.refresh(); return;
  }
  let pt = p ? [p.x, p.y] : null;
  if (!pt) { const v = nearVertex(ui, e.clientX, e.clientY); const sg = v ? null : nearSegment(ui, e.clientX, e.clientY);
    if (!ui.drawing && v) { const r = ui.data.routes.find(q => q.id === v.route); if (r && (v.idx === 0 || v.idx === r.points.length - 1) && !r.locked) { // continuar a rota pela ponta
      ui.drawing = { points: [[...r.points[v.idx]]], extend: { id: r.id, atStart: v.idx === 0 } }; ui.refresh(); return; } }
    if (v) pt = [...v.pt ?? ui.data.routes.find(q => q.id === v.route)?.points[v.idx]]; else if (sg) pt = [sg.pt[0], sg.pt[1]]; }
  pt ??= [x, y];
  // mundo que dá a volta: a rota que toca a lateral termina ali, e um ponto fantasma no lado oposto deixa continuar
  const S = wrapOf(ui.scene); let edge = null;
  if (S && !p) { const tol = 12 / (ui.zoom || 1);
    if (!ui.drawing) { const gh = seamGhosts(S, ui.data.routes).find(g => Math.hypot(g.x - pt[0], g.y - pt[1]) <= tol * 1.5); if (gh) pt = [gh.x, gh.y]; }
    const es = edgeSnap(S, pt[0], tol); if (es.side || pt[0] < S.X || pt[0] > S.X + S.W) { pt = [Math.min(S.X + S.W, Math.max(S.X, es.x)), pt[1]]; edge = es.side ?? (pt[0] <= S.X ? "l" : "r"); } }
  if (ui.drawing && e.shiftKey && ui.drawing.points.length) { const l = ui.drawing.points[ui.drawing.points.length - 1]; const ang = Math.round(Math.atan2(pt[1] - l[1], pt[0] - l[0]) / (Math.PI / 12)) * (Math.PI / 12); const L = Math.hypot(pt[0] - l[0], pt[1] - l[1]); pt = [Math.round(l[0] + Math.cos(ang) * L), Math.round(l[1] + Math.sin(ang) * L)]; }
  if (!ui.drawing) { ui.drawing = { points: [pt], a: p?.id ?? null }; ui.refresh(); return; }
  const last = ui.drawing.points[ui.drawing.points.length - 1];
  if (Math.hypot(last[0] - pt[0], last[1] - pt[1]) < 2) return;
  ui.drawing.points.push(pt);
  if (edge && ui.drawing.points.length >= 2) return finishRoute(ui); // tocou a lateral: a rota termina na borda
  if (p && ui.drawing.points.length >= 2) { ui.drawing.b = p.id; return finishRoute(ui); }
  ui.refresh();
}
/** Une as rotas selecionadas numa só (pela ordem das pontas mais próximas). */
export async function joinRoutes(ui, ids) {
  ids = [...new Set(ids)]; if (ids.length < 2) return;
  await mutateData(ui.scene, (D) => {
    const rs = ids.map(id => D.routes.find(r => r.id === id)).filter(r => r && !r.locked); if (rs.length < 2) return [];
    const H = (r) => { const hs = Array.isArray(r.handles) ? [...r.handles] : []; while (hs.length < r.points.length) hs.push(null); return hs; };
    const flip = (r) => { const c = { ...r, points: r.points.map(p => [...p]), handles: H(r) }; reverseRoute(c); c.handles = H(c); return c; };
    let cur = { ...rs[0], points: [...rs[0].points], handles: H(rs[0]) }; const rest = rs.slice(1);
    while (rest.length) {
      let best = null; const A = cur.points[0], B = cur.points[cur.points.length - 1];
      rest.forEach((r, i) => { const s = r.points[0], e = r.points[r.points.length - 1];
        for (const [d, how] of [[Math.hypot(B[0] - s[0], B[1] - s[1]), "end-start"], [Math.hypot(B[0] - e[0], B[1] - e[1]), "end-end"], [Math.hypot(A[0] - e[0], A[1] - e[1]), "start-end"], [Math.hypot(A[0] - s[0], A[1] - s[1]), "start-start"]]) if (!best || d < best.d) best = { d, how, i }; });
      let r = rest.splice(best.i, 1)[0]; r = { ...r, handles: H(r) };
      if (best.how === "end-end" || best.how === "start-start") r = flip(r);
      const near = best.d < 3;
      if (best.how.startsWith("end")) { cur.points = [...cur.points, ...(near ? r.points.slice(1) : r.points)]; cur.handles = [...cur.handles, ...(near ? r.handles.slice(1) : r.handles)]; cur.b = r.b; }
      else { cur.points = [...(near ? r.points.slice(0, -1) : r.points), ...cur.points]; cur.handles = [...(near ? r.handles.slice(0, -1) : r.handles), ...cur.handles]; cur.a = r.a; }
    }
    const keep = rs[0].id; D.routes = D.routes.filter(r => !ids.includes(r.id) || r.id === keep); const i = D.routes.findIndex(r => r.id === keep); D.routes[i] = { ...D.routes[i], points: cur.points, handles: cur.handles, a: cur.a ?? null, b: cur.b ?? null, closed: false };
    return ["routes"];
  });
  ui.multi = []; ui.selRoute = ids[0]; ui.refresh();
}

/** Botão direito: apaga o último ponto da rota em desenho, ou um ponto da rota selecionada. */
export async function editorContext(ui, e) {
  if (!ui.editing) return false;
  if (ui.tool === "regiao" && ui.regDraw) { ui.regDraw.pts.pop(); if (!ui.regDraw.pts.length) ui.regDraw = null; ui.refresh(); return true; }
  if (ui.tool === "rota" && ui.drawing) { ui.drawing.points.pop(); if (!ui.drawing.points.length) ui.drawing = null; ui.refresh(); return true; }
  if (ui.tool === "rota") { ui.useTool("sel"); return true; }
  const h = e.target.closest?.("[data-handle]");
  if (h && ui.selRoute) {
    if (isLocked(ui, "routes", ui.selRoute)) { return true; }
    const idx = Number(h.dataset.handle);
    await mutateData(ui.scene, (D) => { const r = D.routes.find(q => q.id === ui.selRoute); if (!r || r.points.length <= 2) return []; r.points.splice(idx, 1); if (Array.isArray(r.handles)) r.handles.splice(idx, 1); if (idx === 0) r.a = null; if (idx === r.points.length) r.b = null; return ["routes"]; });
    ui.refresh(); return true;
  }
  return false;
}

/** Fecha o polígono e cria a Região do Foundry. */
export async function finishRegion(ui) {
  const pts = ui.regDraw?.pts ?? []; ui.regDraw = null;
  if (pts.length < 3) { ui.refresh(); return; }
  const n = (ui.scene.regions?.size ?? 0) + 1; const pal = ["#3f8f4a", "#2a6fb0", "#b0702a", "#7a4ab0", "#c0392b", "#2a8aa0", "#8a7a2a", "#5a6ab0"]; const color = pal[n % pal.length];
  try { await ui.scene.createEmbeddedDocuments("Region", [{ name: `Região ${n}`, color, shapes: [{ type: "polygon", points: pts.flat(), hole: false }] }]); }
  catch (err) { console.error(err); globalThis.ui?.notifications?.error("Atlas: não foi possível criar a Região."); }
  ui.refresh();
}
export async function finishRoute(ui) {
  const dr = ui.drawing; ui.drawing = null; ui.mouse = null;
  if (!dr || dr.points.length < 2) { ui.refresh(); return; }
  const straight = (ui.routeMode ?? "curva") === "reta"; const hs = straight ? dr.points.map(() => ({ a: 0, l1: 0, l2: 0 })) : [];
  if (dr.extend) { // continua uma rota existente
    const ex = dr.extend; await mutateData(ui.scene, (D) => { const r = D.routes.find(q => q.id === ex.id); if (!r) return [];
      const add = dr.points.slice(1); const hAdd = straight ? add.map(() => ({ a: 0, l1: 0, l2: 0 })) : add.map(() => null); const H = Array.isArray(r.handles) ? [...r.handles] : []; while (H.length < r.points.length) H.push(null);
      if (ex.atStart) { r.points = [...add.reverse(), ...r.points]; r.handles = [...hAdd.reverse(), ...H]; r.a = dr.b ?? null; } else { r.points = [...r.points, ...add]; r.handles = [...H, ...hAdd]; r.b = dr.b ?? null; }
      return ["routes"]; });
    ui.selRoute = ex.id; ui.refresh(); return;
  }
  const id = uid();
  await mutateData(ui.scene, (D) => { D.routes.push({ id, name: "", type: ui.newRouteType ?? "estrada", cond: "aberta", points: dr.points, handles: hs, a: dr.a ?? null, b: dr.b ?? null, hidden: false, modes: null, mult: null }); return ["routes"]; });
  // continua na ferramenta de rota para desenhar a próxima
  ui.selRoute = id; ui.refresh();
}

export async function deleteSelection(ui) {
  if (ui.multi?.length) {
    const list = ui.multi; const n = list.length;
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Apagar do Atlas" }, content: `<p>Apagar ${n} elemento(s) do Atlas? Os travados ficam.</p>`, rejectClose: false }).catch(() => false);
    if (!ok) return;
    await mutateData(ui.scene, (D) => {
      const has = (k, id) => list.some(x => x.kind === k && x.id === id);
      const gone = new Set(D.pois.filter(p => has("pois", p.id) && !p.locked).map(p => p.id));
      D.pois = D.pois.filter(p => !gone.has(p.id)); D.routes = D.routes.filter(r => r.type !== "portal" || !(gone.has(r.a) || gone.has(r.b))); for (const r of D.routes) { if (gone.has(r.a)) r.a = null; if (gone.has(r.b)) r.b = null; } for (const m of D.movers) if (gone.has(m.at)) m.at = null;
      D.routes = D.routes.filter(r => !(has("routes", r.id) && !r.locked));
      D.labels = D.labels.filter(l => !(has("labels", l.id) && !l.locked)); D.movers = D.movers.filter(m => !(has("movers", m.id) && !m.locked));
      return ["pois", "routes", "labels", "movers"];
    });
    ui.multi = []; ui.refresh(); return;
  }
  const ask = async (what) => foundry.applications.api.DialogV2.confirm({ window: { title: "Apagar do Atlas" }, content: `<p>Apagar ${what}?</p>`, rejectClose: false }).catch(() => false);
  const nm = (x) => foundry.utils.escapeHTML?.(x ?? "") ?? x;
  if (ui.sel) { const p = ui.data.pois.find(x => x.id === ui.sel); if (!await ask(`o local <b>${nm(p?.name)}</b>`)) return; }
  else if (ui.selRoute) { const r = ui.data.routes.find(x => x.id === ui.selRoute); if (!await ask(`a rota <b>${nm(r?.name || "sem nome")}</b>`)) return; }
  else if (ui.selLabel) { const l = ui.data.labels.find(x => x.id === ui.selLabel); if (!await ask(`o rótulo <b>${nm(l?.text)}</b>`)) return; }
  if (ui.sel) { const id = ui.sel; await mutateData(ui.scene, (D) => { D.pois = D.pois.filter(p => p.id !== id); D.routes = D.routes.filter(r => r.type !== "portal" || (r.a !== id && r.b !== id)); for (const r of D.routes) { if (r.a === id) r.a = null; if (r.b === id) r.b = null; } for (const m of D.movers) if (m.at === id) m.at = null; return ["pois", "routes", "movers"]; }); ui.sel = null; }
  else if (ui.selRoute) { const id = ui.selRoute; await mutateData(ui.scene, (D) => { D.routes = D.routes.filter(r => r.id !== id); return ["routes"]; }); ui.selRoute = null; }
  else if (ui.selLabel) { const id = ui.selLabel; await mutateData(ui.scene, (D) => { D.labels = D.labels.filter(r => r.id !== id); return ["labels"]; }); ui.selLabel = null; }
  else if (ui.selMover || (ui.gpanel && ui.travel.moverId)) { const id = ui.selMover || ui.travel.moverId; const m = ui.data.movers.find(r => r.id === id); if (!m) return;
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Apagar do Atlas" }, content: `<p>Apagar <b>${foundry.utils.escapeHTML?.(m.name) ?? m.name}</b> do mapa? ${m.parked ? "A ficha do veículo não é afetada." : "Os personagens não são afetados."}</p>`, rejectClose: false }).catch(() => false);
    if (!ok) return; await mutateData(ui.scene, (D) => { D.movers = D.movers.filter(r => r.id !== id); return ["movers"]; }); ui.selMover = null; if (ui.travel.moverId === id) { ui.travel.moverId = null; ui.gpanel = false; } }
  ui.refresh();
}

export function editorKey(ui, e) {
  if (e.key === "Enter" && ui.regDraw) { e.preventDefault(); e.stopPropagation?.(); finishRegion(ui); return; }
  if (e.key === "Escape" && ui.regDraw) { ui.regDraw = null; ui.refresh(); e.stopPropagation?.(); return; }
  if (e.key === "Escape" && ui.portalFrom) { ui.portalFrom = null; ui.refresh(); e.stopPropagation?.(); return; }
  if (e.key === "Escape") { if (ui.drawing) ui.drawing = null; else if (ui.tool !== "sel") ui.useTool("sel"); else { ui.multi = []; ui.selectEdit({}); } ui.mouse = null; ui.refresh(); e.stopPropagation?.(); return; }
  if (e.key === "Enter" && ui.drawing) { e.preventDefault(); e.stopPropagation?.(); finishRoute(ui); return; }
  if (e.key === "Backspace" && ui.drawing) { e.preventDefault(); e.stopPropagation?.(); ui.drawing.points.pop(); if (!ui.drawing.points.length) ui.drawing = null; ui.refresh(); return; }
  if (e.key === "Delete" && (ui.multi?.length || ui.sel || ui.selRoute || ui.selLabel || ui.selMover || (ui.gpanel && ui.travel.moverId))) { e.preventDefault(); e.stopPropagation?.(); deleteSelection(ui); }
}
