// Edição avançada (como num editor de vetores, ex.: CorelDRAW): rotas e formas das Regiões.
// Rotas: ferramentas de seleção, forma (nós), mão livre, polilinha, Bézier, curva de 3 pontos, círculo, retângulo e polígono;
// nós: adicionar, apagar, juntar, ligar com reta, quebrar, converter em reta/curva, cúspide/suave/simétrico;
// objetos: combinar, agrupar, desagrupar, duplicar, inverter, fechar/abrir.
// Regiões: nós dos polígonos, cantos de retângulos, raios de círculos e elipses; novas formas; buracos.
import { MODULE_ID, ROUTE_TYPES } from "./config.js";
import { dataOf, mutateData, uid, normRoute, pushRegionUndo } from "./data.js";
import { bezierSegs, handleVecs, segsPath, shapesOf } from "./geom.js";
import { snapPoint, snapMode } from "./editor.js";
import { wallDown, wallMove, wallUp, wallDbl, wallContext, wallKey, wallAction, wallsFromRoute, renderWalls, wallInfo, wallTypeOfSel, wallTypes } from "./walls.js";

export const isVec = (t) => t === "vrota" || t === "vreg" || t === "vwall";
export const LAYERS = { vrota: "Rotas", vreg: "Regiões", vwall: "Paredes" };
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const len = (v) => Math.hypot(v[0], v[1]);
const ang = (v) => Math.atan2(v[1], v[0]) * R2D;
const fromAng = (a, l) => [Math.cos(a * D2R) * l, Math.sin(a * D2R) * l];
const r1 = (x) => Math.round(x * 10) / 10;
const ddist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ---------- estado ---------- */
export function vx(ui) { return (ui.vx ??= { tool: "forma", nodes: [], draw: null, sides: 6, reg: null, rnodes: [], rtool: "forma", key: "" }); }
const selIds = (ui) => (ui.multi ?? []).filter(x => x.kind === "routes").map(x => x.id);
const setSel = (ui, ids) => { ui.multi = [...new Set(ids)].map(id => ({ kind: "routes", id })); ui.selRoute = null; };
const routeOf = (ui, id) => dataOf(ui.scene).routes.find(r => r.id === id);
/** Junta os outros membros do grupo de cada rota. */
function withGroups(ui, ids) { const rs = dataOf(ui.scene).routes; const gs = new Set(rs.filter(r => ids.includes(r.id) && r.group).map(r => r.group)); return [...new Set([...ids, ...rs.filter(r => r.group && gs.has(r.group)).map(r => r.id)])]; }

/* ---------- nós (modelo) ---------- */
const H = (r) => { const hs = Array.isArray(r.handles) ? r.handles.map(h => h ? { ...h } : null) : []; while (hs.length < r.points.length) hs.push(null); hs.length = r.points.length; return hs; };
export const isClosed = (r) => !!r.closed && r.points.length > 3 && ddist(r.points[0], r.points[r.points.length - 1]) < 1;
const typeOf = (h) => h ? (h.t ?? (h.a2 != null ? "cusp" : "smooth")) : "auto";
/** Rota → lista de nós { p, inV, outV, t } (fechada: sem repetir o primeiro). */
export function toNodes(r) {
  const hs = H(r); const n = r.points.length; const closed = isClosed(r); const cnt = closed ? n - 1 : n; const out = [];
  for (let i = 0; i < cnt; i++) {
    let inV, outV, t = typeOf(hs[i]);
    if (closed && i === 0) { inV = handleVecs(r.points, hs, n - 1).inV; outV = handleVecs(r.points, hs, 0).outV; if (!hs[0] && !hs[n - 1]) t = "auto"; else t = hs[0]?.t ?? hs[n - 1]?.t ?? "smooth"; }
    else { const hv = handleVecs(r.points, hs, i); inV = hv.inV; outV = hv.outV; }
    out.push({ p: [...r.points[i]], inV: [...inV], outV: [...outV], t });
  }
  return { nodes: out, closed };
}
/** Lista de nós → pontos e alças da rota. */
export function fromNodes(nodes, closed) {
  const n = nodes.length; const points = nodes.map(x => [Math.round(x.p[0]), Math.round(x.p[1])]); if (closed) points.push([...points[0]]);
  const hs = [];
  const explicit = (x, inV, outV, t) => { const li = len(inV), lo = len(outV); const h = { t: t === "auto" ? "smooth" : t, a: 0, l1: Math.round(li), l2: Math.round(lo) };
    if (li > 0.01 && lo > 0.01) { h.a = r1(ang([-inV[0], -inV[1]])); const ao = r1(ang(outV)); if (t === "cusp" || Math.abs(((ao - h.a + 540) % 360) - 180) > 0.6) h.a2 = ao; }
    else if (lo > 0.01) h.a = r1(ang(outV)); else if (li > 0.01) h.a = r1(ang([-inV[0], -inV[1]]));
    return h; };
  for (let i = 0; i < n; i++) {
    const x = nodes[i];
    if (closed && i === 0) {
      let inV = x.inV, outV = x.outV;
      if (x.t === "auto") { const pv = nodes[n - 1].p, nx = nodes[1 % n].p; const tg = [(nx[0] - pv[0]) / 6, (nx[1] - pv[1]) / 6]; outV = tg; inV = [-tg[0], -tg[1]]; }
      hs.push({ ...explicit(x, [0, 0], outV, x.t === "auto" ? "smooth" : x.t), l1: 0 }); x._inSeam = inV; continue;
    }
    hs.push(x.t === "auto" ? null : explicit(x, x.inV, x.outV, x.t));
  }
  if (closed) { const x = nodes[0]; const inV = x._inSeam ?? x.inV; delete x._inSeam; hs.push({ ...explicit(x, inV, [0, 0], x.t === "auto" ? "smooth" : x.t), l2: 0 }); }
  return { points, handles: hs };
}
const apply = (r, nodes, closed) => { const b = fromNodes(nodes, closed); r.points = b.points; r.handles = b.handles; r.closed = !!closed; return r; };
/** Muda a alça de um lado de um nó, respeitando o tipo (cúspide, suave, simétrico). */
function setSide(x, side, v) {
  if (x.t === "auto") x.t = "smooth";
  if (side === "out") { x.outV = v; if (x.t === "sym") x.inV = [-v[0], -v[1]]; else if (x.t === "smooth" && len(x.inV) > 0.01 && len(v) > 0.01) x.inV = fromAng(ang(v) + 180, len(x.inV)); }
  else { x.inV = v; if (x.t === "sym") x.outV = [-v[0], -v[1]]; else if (x.t === "smooth" && len(x.outV) > 0.01 && len(v) > 0.01) x.outV = fromAng(ang(v) + 180, len(x.outV)); }
}
/** Inverte o sentido da rota. */
export function reverseRoute(r) { const { nodes, closed } = toNodes(r); const rev = nodes.reverse().map(x => ({ ...x, inV: x.outV, outV: x.inV })); apply(r, rev, closed); const a = r.a; r.a = r.b; r.b = a; return r; }
/** Parte o trecho k (do nó k ao k+1) em t, sem mudar o desenho (de Casteljau). */
function splitSeg(nodes, closed, k, t) {
  const n = nodes.length; const A = nodes[k], B = nodes[(k + 1) % n];
  const p0 = A.p, c1 = [A.p[0] + A.outV[0], A.p[1] + A.outV[1]], c2 = [B.p[0] + B.inV[0], B.p[1] + B.inV[1]], p1 = B.p;
  const q0 = lerp(p0, c1, t), q1 = lerp(c1, c2, t), q2 = lerp(c2, p1, t), s0 = lerp(q0, q1, t), s1 = lerp(q1, q2, t), m = lerp(s0, s1, t);
  if (A.t === "auto") A.t = "smooth"; if (B.t === "auto") B.t = "smooth";
  A.outV = [q0[0] - p0[0], q0[1] - p0[1]]; B.inV = [q2[0] - p1[0], q2[1] - p1[1]];
  const N = { p: m, inV: [s0[0] - m[0], s0[1] - m[1]], outV: [s1[0] - m[0], s1[1] - m[1]], t: "smooth" };
  nodes.splice(k + 1, 0, N); return k + 1;
}
/** Nós de cada rota já com os vetores "congelados" (para mexer sem que os automáticos mudem). */
function freeze(nodes) { for (const x of nodes) if (x.t === "auto") x.t = "smooth"; return nodes; }
const segCount = (nodes, closed) => closed ? nodes.length : nodes.length - 1;
function segPts(nodes, k) { const n = nodes.length; const A = nodes[k], B = nodes[(k + 1) % n]; return [A.p, [A.p[0] + A.outV[0], A.p[1] + A.outV[1]], [B.p[0] + B.inV[0], B.p[1] + B.inV[1]], B.p]; }
export const bezPoint = (s, t) => bez(s, t);
/** Amostras de um trecho: denso o bastante na tela para não pular o clique. */
const sampN = (ui, s) => { const L = (ddist(s[0], s[1]) + ddist(s[1], s[2]) + ddist(s[2], s[3])) * (ui.zoom || 1); return Math.max(30, Math.min(600, Math.ceil(L / 3))); };
const bez = (s, t) => { const u = 1 - t; return [u * u * u * s[0][0] + 3 * u * u * t * s[1][0] + 3 * u * t * t * s[2][0] + t * t * t * s[3][0], u * u * u * s[0][1] + 3 * u * u * t * s[1][1] + 3 * u * t * t * s[2][1] + t * t * t * s[3][1]]; };

/* ---------- o que está sob o mouse ---------- */
/** Trecho mais perto do ponto de tela (rota, índice do trecho, t, ponto). */
function nearSeg(ui, sx, sy, ids = null, px = 10) {
  let best = null, bd = px;
  for (const r of dataOf(ui.scene).routes) { if (ids && !ids.includes(r.id)) continue; if (r.points.length < 2 || r.type === "portal") continue;
    const segs = bezierSegs(r.points, r.handles);
    segs.forEach((s, k) => { const N = sampN(ui, s); for (let j = 1; j < N; j++) { const t = j / N; const p = bez(s, t); const q = ui.w2s(p[0], p[1]); const d = Math.hypot(q.x - sx, q.y - sy); if (d < bd) { bd = d; best = { id: r.id, k, t, pt: p }; } } }); }
  return best;
}
/** Ponto com ímã: local, nó de rota, linha de rota, grade. */
function snapAt(ui, sx, sy, skip = null) {
  const sc = ui.scene; const d = dataOf(sc);
  let best = null, bd = 14;
  for (const p of d.pois) { const q = ui.w2s(p.x, p.y); const dd = Math.hypot(q.x - sx, q.y - sy); if (dd < bd) { bd = dd; best = { x: p.x, y: p.y, poi: p.id }; } }
  if (best) return best;
  bd = 10; for (const r of d.routes) { if (r.id === skip || r.type === "portal") continue; for (const p of r.points) { const q = ui.w2s(p[0], p[1]); const dd = Math.hypot(q.x - sx, q.y - sy); if (dd < bd) { bd = dd; best = { x: p[0], y: p[1], node: true }; } } }
  if (best) return best;
  const sg = nearSeg(ui, sx, sy, null, 7); if (sg && sg.id !== skip) return { x: Math.round(sg.pt[0]), y: Math.round(sg.pt[1]), onRoute: true };
  const w = ui.s2w(sx, sy); const s = snapPoint(w.x, w.y, snapMode()); return { x: s.x, y: s.y };
}
const angSnap = (from, p) => { const a = Math.round(Math.atan2(p[1] - from[1], p[0] - from[0]) / (Math.PI / 12)) * (Math.PI / 12); const L = ddist(from, p); return [from[0] + Math.cos(a) * L, from[1] + Math.sin(a) * L]; };

/* ---------- desenho ---------- */
const ROUTE_TOOLS = ["selecao", "forma", "maolivre", "polilinha", "bezier", "curva3", "circulo", "retangulo", "poligono"];
function newRoute(ui, nodes, closed, a = null, b = null) {
  const id = uid(); const r = { id, name: "", type: ui.newRouteType ?? "estrada", cond: "aberta", a, b, hidden: false, modes: null, mult: null, group: null };
  apply(r, nodes, closed); return r;
}
async function commitNew(ui, r) { if (!r || r.points.length < 2) return; if (ui.tool === "vwall") return wallsFromRoute(ui, r); await mutateData(ui.scene, (D) => { D.routes.push(r); return ["routes"]; }); setSel(ui, [r.id]); ui.vx.nodes = []; ui.refresh(); }
/** Rascunho atual → nós (com o ponto do mouse como prévia). */
function draftNodes(ui, mouse = null) {
  const v = vx(ui); const dr = v.draw; if (!dr) return null;
  const P = (q) => ({ p: q, inV: [0, 0], outV: [0, 0], t: "cusp" });
  switch (dr.tool) {
    case "polilinha": case "bezier": { const ns = dr.nodes.map(x => ({ ...x })); if (mouse && !dr.dragging) ns.push(P(mouse)); return { nodes: ns, closed: false }; }
    case "maolivre": return { nodes: dr.pts.map(p => ({ p, inV: [0, 0], outV: [0, 0], t: "auto" })), closed: false };
    case "curva3": { if (!dr.b) return mouse ? { nodes: [P(dr.a), P(mouse)], closed: false } : null; const M = mouse ?? lerp(dr.a, dr.b, 0.5); return { nodes: curve3(dr.a, dr.b, M), closed: false }; }
    case "circulo": { const m = mouse ?? dr.c; return { nodes: circleNodes(dr.c, ddist(dr.c, m)), closed: true }; }
    case "retangulo": { const m = mouse ?? dr.c; return { nodes: rectNodes(dr.c, m, dr.square), closed: true }; }
    case "poligono": { const m = mouse ?? dr.c; return { nodes: polyNodes(dr.c, m, v.sides), closed: true }; }
  }
  return null;
}
function curve3(A, B, M) { const Q = [2 * M[0] - (A[0] + B[0]) / 2, 2 * M[1] - (A[1] + B[1]) / 2]; return [{ p: A, inV: [0, 0], outV: [(Q[0] - A[0]) * 2 / 3, (Q[1] - A[1]) * 2 / 3], t: "cusp" }, { p: B, inV: [(Q[0] - B[0]) * 2 / 3, (Q[1] - B[1]) * 2 / 3], outV: [0, 0], t: "cusp" }]; }
function circleNodes(c, R) { const k = 0.5523 * R; return [0, 90, 180, 270].map(a => ({ p: [c[0] + Math.cos(a * D2R) * R, c[1] + Math.sin(a * D2R) * R], inV: fromAng(a - 90, k), outV: fromAng(a + 90, k), t: "sym" })); }
function rectNodes(a, b, square) { let w = b[0] - a[0], h = b[1] - a[1]; if (square) { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; } return [[a[0], a[1]], [a[0] + w, a[1]], [a[0] + w, a[1] + h], [a[0], a[1] + h]].map(p => ({ p, inV: [0, 0], outV: [0, 0], t: "cusp" })); }
function polyNodes(c, m, n) { n = Math.max(3, Math.min(24, Math.round(n) || 6)); const R = ddist(c, m); const a0 = Math.atan2(m[1] - c[1], m[0] - c[0]); return Array.from({ length: n }, (_, i) => ({ p: [c[0] + Math.cos(a0 + i * 2 * Math.PI / n) * R, c[1] + Math.sin(a0 + i * 2 * Math.PI / n) * R], inV: [0, 0], outV: [0, 0], t: "cusp" })); }
/** Simplifica o traço da mão livre (Ramer–Douglas–Peucker). */
function rdp(pts, eps) {
  if (pts.length < 3) return pts; let dm = 0, im = 0; const a = pts[0], b = pts[pts.length - 1]; const L = ddist(a, b) || 1;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / L; if (d > dm) { dm = d; im = i; } }
  if (dm <= eps) return [a, b]; return [...rdp(pts.slice(0, im + 1), eps).slice(0, -1), ...rdp(pts.slice(im), eps)];
}
async function finishDraft(ui) {
  const v = vx(ui); const dr = v.draw; if (!dr) return; v.draw = null;
  if (dr.tool === "polilinha" || dr.tool === "bezier") { if (dr.nodes.length >= 2) await commitNew(ui, newRoute(ui, dr.nodes, false, dr.a ?? null, dr.b ?? null)); else ui.refresh(); return; }
  ui.refresh();
}

/* ---------- eventos ---------- */
export function vecDown(ui, e) {
  const v = vx(ui);
  // botão direito ou do meio arrastado: move a vista (como no Foundry)
  if (e.button === 1 || e.button === 2) { const c = ui.s2w(window.innerWidth / 2, window.innerHeight / 2); ui.vdrag = { kind: "pan", x0: e.clientX, y0: e.clientY, c, moved: false, button: e.button }; return true; }
  if (e.button !== 0) return false;
  e.preventDefault(); e.stopPropagation();
  const w = ui.s2w(e.clientX, e.clientY); const W = [w.x, w.y];
  if (ui.tool === "vreg") return regDown(ui, e, W);
  const t = v.tool;
  if (ui.tool === "vwall" && !["polilinha", "bezier", "curva3", "circulo", "retangulo", "poligono", "maolivre"].includes(t)) return wallDown(ui, e, W);
  if (["polilinha", "bezier", "curva3", "circulo", "retangulo", "poligono", "maolivre"].includes(t)) return drawDown(ui, e, t);
  const el = e.target; const nodeEl = el.closest?.("[data-vn]"), knobEl = el.closest?.("[data-vk]"), hitEl = el.closest?.("[data-vroute]");
  if (t === "forma") {
    if (knobEl) { const [id, i, side] = knobEl.dataset.vk.split("|"); ui.vdrag = { kind: "knob", id, i: Number(i), side, moved: false }; return true; }
    if (nodeEl) { const [id, i] = nodeEl.dataset.vn.split("|"); const key = { id, i: Number(i) }; const has = v.nodes.some(x => x.id === id && x.i === key.i);
      if (e.shiftKey) v.nodes = has ? v.nodes.filter(x => !(x.id === id && x.i === key.i)) : [...v.nodes, key]; else if (!has) v.nodes = [key];
      ui.vdrag = { kind: "nodes", w0: W, dx: 0, dy: 0, moved: false, lead: key }; ui.refresh(); return true; }
    const sel = selIds(ui);
    const sg = nearSeg(ui, e.clientX, e.clientY, sel.length ? sel : null, 8);
    if (sg && sel.includes(sg.id) && !e.shiftKey) { ui.vdrag = { kind: "bend", id: sg.id, k: sg.k, t: sg.t, w0: W, moved: false }; return true; }
    if (hitEl || sg) { const id = hitEl?.dataset.vroute ?? sg.id; setSel(ui, e.shiftKey ? (sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]) : [id]); v.nodes = []; ui.refresh(); return true; }
    ui.vdrag = { kind: "marq", x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, add: e.shiftKey, moved: false }; return true;
  }
  // seleção (objetos)
  const sel = selIds(ui);
  const hitId = hitEl?.dataset.vroute ?? nearSeg(ui, e.clientX, e.clientY, null, 8)?.id;
  if (hitId) {
    const grp = withGroups(ui, [hitId]);
    if (e.shiftKey) setSel(ui, sel.includes(hitId) ? sel.filter(x => !grp.includes(x)) : [...sel, ...grp]);
    else if (!sel.includes(hitId)) setSel(ui, grp);
    ui.vdrag = { kind: "move", w0: W, dx: 0, dy: 0, moved: false }; ui.refresh(); return true;
  }
  ui.vdrag = { kind: "marq", x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, add: e.shiftKey, moved: false }; return true;
}
function drawDown(ui, e, t) {
  const v = vx(ui); const s = snapAt(ui, e.clientX, e.clientY); let P = [s.x, s.y];
  const dr = v.draw;
  if (t === "maolivre") { v.draw = { tool: t, pts: [P], a: s.poi ?? null }; ui.vdrag = { kind: "free", moved: false }; return true; }
  if (t === "polilinha" || t === "bezier") {
    if (dr && e.shiftKey && dr.nodes.length) { P = angSnap(dr.nodes[dr.nodes.length - 1].p, P); }
    if (!dr) v.draw = { tool: t, nodes: [], a: s.poi ?? null };
    const D = v.draw; const last = D.nodes[D.nodes.length - 1];
    if (last && ddist(last.p, P) < 1) { if (s.poi) D.b = s.poi; return true; }
    D.nodes.push({ p: P, inV: [0, 0], outV: [0, 0], t: "cusp" }); if (s.poi && D.nodes.length > 1) D.b = s.poi;
    if (t === "bezier") ui.vdrag = { kind: "pen", moved: false };
    ui.refresh(); return true;
  }
  if (t === "curva3") {
    if (!dr) { v.draw = { tool: t, a: P }; ui.vdrag = { kind: "c3", moved: false }; ui.refreshMap(); return true; }
    if (!dr.b) { dr.b = P; ui.refreshMap(); return true; }
    const w = ui.s2w(e.clientX, e.clientY); v.draw = null; commitNew(ui, newRoute(ui, curve3(dr.a, dr.b, [w.x, w.y]), false)); return true;
  }
  // círculo, retângulo, polígono: dois cliques (ou arrastar)
  if (!dr) { v.draw = { tool: t, c: P }; ui.vdrag = { kind: "shape", moved: false }; ui.refreshMap(); return true; }
  v.draw = null; const m = P; const sq = e.ctrlKey || e.shiftKey;
  const nodes = t === "circulo" ? circleNodes(dr.c, ddist(dr.c, m)) : t === "retangulo" ? rectNodes(dr.c, m, sq) : polyNodes(dr.c, m, v.sides);
  if (ddist(dr.c, m) < 3) { ui.refresh(); return true; }
  commitNew(ui, newRoute(ui, nodes, true)); return true;
}
export function vecMove(ui, e) {
  const d = ui.vdrag; if (!d) return; const v = vx(ui);
  if (d.kind === "pan") { const z = canvas.stage?.scale?.x ?? ui.zoom ?? 1; const dx = e.clientX - d.x0, dy = e.clientY - d.y0; if (Math.hypot(dx, dy) > 3) d.moved = true; if (d.moved) { const x = d.c.x - dx / z, y = d.c.y - dy / z; try { canvas.pan ? canvas.pan({ x, y }) : canvas.animatePan({ x, y, duration: 0 }); } catch (err) { /* */ } } return; }
  const w = ui.s2w(e.clientX, e.clientY); const W = [w.x, w.y];
  if (d.kind === "marq") { d.x1 = e.clientX; d.y1 = e.clientY; d.moved = d.moved || Math.hypot(d.x1 - d.x0, d.y1 - d.y0) > 4; ui.refreshMap(); return; }
  if (d.kind === "free") { const pts = v.draw?.pts; if (pts) { const last = pts[pts.length - 1]; if (ddist(last, W) * (ui.zoom || 1) > 4) { pts.push(W); d.moved = true; ui.refreshMap(); } } return; }
  if (d.kind === "pen") { const D = v.draw; const x = D?.nodes[D.nodes.length - 1]; if (!x) return; const o = [W[0] - x.p[0], W[1] - x.p[1]]; if (len(o) * (ui.zoom || 1) > 4) { d.moved = true; D.dragging = true; x.outV = o; x.inV = [-o[0], -o[1]]; x.t = "sym"; } ui.refreshMap(); return; }
  if (d.kind === "c3" || d.kind === "shape") { if (ui.mouse == null || Math.hypot(e.clientX - ui.mouse.x, e.clientY - ui.mouse.y) > 0) { d.moved = true; } ui.mouse = { x: e.clientX, y: e.clientY }; ui.refreshMap(); return; }
  if (d.kind === "nodes" || d.kind === "move") {
    let dx = W[0] - d.w0[0], dy = W[1] - d.w0[1];
    if (d.kind === "nodes" && d.lead) { const r = routeOf(ui, d.lead.id); const p0 = r?.points[d.lead.i]; if (p0) { const q = ui.w2s(p0[0] + dx, p0[1] + dy); const s = snapAt(ui, q.x, q.y, d.lead.id); if (s.poi || s.node || s.onRoute) { dx = s.x - p0[0]; dy = s.y - p0[1]; d.snapPoi = s.poi ?? null; } else d.snapPoi = null; } }
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    d.dx = dx; d.dy = dy; d.moved = d.moved || Math.hypot(dx, dy) * (ui.zoom || 1) > 2; ui.refreshMap(); return;
  }
  if (d.kind === "knob" || d.kind === "bend") { d.W = W; d.moved = true; ui.refreshMap(); return; }
}
export async function vecUp(ui, e) {
  const d = ui.vdrag; ui.vdrag = null; if (!d) return; const v = vx(ui);
  if (d.kind === "pan") { if (d.moved) ui.vEatCtx = true; return; }
  if (ui.tool === "vreg") return regUp(ui, e, d);
  if (ui.tool === "vwall" && d.kind.startsWith("w")) return wallUp(ui, e, d);
  if (d.kind === "marq") {
    if (!d.moved) { if (!d.add) { if (v.tool === "forma" && v.nodes.length) v.nodes = []; else setSel(ui, []); } ui.refresh(); return; }
    const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
    const inside = (p) => { const q = ui.w2s(p[0], p[1]); return q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1; };
    const rs = dataOf(ui.scene).routes; const sel = selIds(ui);
    if (v.tool === "forma" && sel.length) { const got = []; for (const r of rs) if (sel.includes(r.id)) { const n = isClosed(r) ? r.points.length - 1 : r.points.length; for (let i = 0; i < n; i++) if (inside(r.points[i])) got.push({ id: r.id, i }); }
      v.nodes = d.add ? [...v.nodes, ...got.filter(g => !v.nodes.some(x => x.id === g.id && x.i === g.i))] : got; }
    else { const got = rs.filter(r => v.tool === "forma" ? r.points.some(inside) : r.points.every(inside)).map(r => r.id); setSel(ui, d.add ? [...sel, ...got] : (v.tool === "forma" ? got : withGroups(ui, got))); }
    ui.refresh(); return;
  }
  if (d.kind === "free") { const dr = v.draw; v.draw = null; if (!dr || dr.pts.length < 2) { ui.refresh(); return; }
    const eps = 5 / (ui.zoom || 1); const pts = rdp(dr.pts, eps); const s = snapAt(ui, e.clientX, e.clientY);
    await commitNew(ui, newRoute(ui, pts.map(p => ({ p, inV: [0, 0], outV: [0, 0], t: "auto" })), false, dr.a, s.poi ?? null)); return; }
  if (d.kind === "pen") { if (v.draw) v.draw.dragging = false; ui.refresh(); return; }
  if (d.kind === "c3") { if (d.moved && v.draw && !v.draw.b) { const s = snapAt(ui, e.clientX, e.clientY); if (ddist(v.draw.a, [s.x, s.y]) > 2) v.draw.b = [s.x, s.y]; } ui.refreshMap(); return; }
  if (d.kind === "shape") { if (d.moved && v.draw) { const s = snapAt(ui, e.clientX, e.clientY); const m = [s.x, s.y]; if (ddist(v.draw.c, m) * (ui.zoom || 1) > 8) { const dr = v.draw; v.draw = null; const t = dr.tool;
      const nodes = t === "circulo" ? circleNodes(dr.c, ddist(dr.c, m)) : t === "retangulo" ? rectNodes(dr.c, m, e.ctrlKey || e.shiftKey) : polyNodes(dr.c, m, v.sides); await commitNew(ui, newRoute(ui, nodes, true)); return; } } ui.refreshMap(); return; }
  if (!d.moved) {
    if (d.kind === "bend") { // clique num trecho: seleciona o trecho (o nó em que ele termina), como no Corel
      const r = routeOf(ui, d.id); if (r) { const { nodes, closed } = toNodes(r); const i = (d.k + 1) % nodes.length; const key = { id: d.id, i }; const has = v.nodes.some(x => x.id === d.id && x.i === i);
        v.nodes = e.shiftKey ? (has ? v.nodes.filter(x => !(x.id === d.id && x.i === i)) : [...v.nodes, key]) : [key]; v.seg = { id: d.id, k: d.k }; } ui.refresh(); return; }
    ui.refreshMap(); return; }
  if (d.kind === "move") { const ids = selIds(ui); await mutateData(ui.scene, (D) => { for (const r of D.routes) if (ids.includes(r.id) && !r.locked) { r.points = r.points.map(p => [Math.round(p[0] + d.dx), Math.round(p[1] + d.dy)]); r.a = null; r.b = null; } return ["routes"]; }); ui.refresh(); return; }
  if (d.kind === "nodes") {
    const by = {}; for (const n of v.nodes) (by[n.id] ??= []).push(n.i);
    await mutateData(ui.scene, (D) => { for (const r of D.routes) { const idx = by[r.id]; if (!idx || r.locked) continue; const { nodes, closed } = toNodes(r); const last = nodes.length - 1;
      for (const i of idx) { const x = nodes[i]; if (!x) continue; x.p = [x.p[0] + d.dx, x.p[1] + d.dy]; if (!closed && i === 0) r.a = d.lead?.id === r.id && d.lead.i === 0 ? d.snapPoi ?? null : null; if (!closed && i === last) r.b = d.lead?.id === r.id && d.lead.i === last ? d.snapPoi ?? null : null; }
      apply(r, nodes, closed); } return ["routes"]; });
    ui.refresh(); return;
  }
  if (d.kind === "knob" && d.W) { await mutateData(ui.scene, (D) => { const r = D.routes.find(x => x.id === d.id); if (!r || r.locked) return []; const { nodes, closed } = toNodes(r); const x = nodes[d.i]; if (!x) return [];
      setSide(x, d.side, [d.W[0] - x.p[0], d.W[1] - x.p[1]]); apply(r, nodes, closed); return ["routes"]; }); ui.refresh(); return; }
  if (d.kind === "bend" && d.W) { await mutateData(ui.scene, (D) => { const r = D.routes.find(x => x.id === d.id); if (!r || r.locked) return []; bendRoute(r, d.k, d.t, d.W); return ["routes"]; }); ui.refresh(); return; }
}
/** Arrastar um trecho: o trecho passa pelo mouse naquele ponto (as alças se ajustam). */
function bendRoute(r, k, t, W) {
  const { nodes, closed } = toNodes(r); freeze(nodes); const n = nodes.length; const A = nodes[k], B = nodes[(k + 1) % n];
  // trecho reto: ganha alças sobre a própria linha antes de curvar
  if (len(A.outV) < 0.01 && len(B.inV) < 0.01) { A.outV = [(B.p[0] - A.p[0]) / 3, (B.p[1] - A.p[1]) / 3]; B.inV = [(A.p[0] - B.p[0]) / 3, (A.p[1] - B.p[1]) / 3]; if (A.t !== "sym") A.t = "cusp"; if (B.t !== "sym") B.t = "cusp"; }
  const cur = bez(segPts(nodes, k), t); const dv = [W[0] - cur[0], W[1] - cur[1]]; const u = 1 - t; const kk = 1 / Math.max(0.05, 3 * t * u * (u * u + t * t));
  setSide(A, "out", [A.outV[0] + dv[0] * u * kk, A.outV[1] + dv[1] * u * kk]); setSide(B, "in", [B.inV[0] + dv[0] * t * kk, B.inV[1] + dv[1] * t * kk]);
  apply(r, nodes, closed);
}
export function vecDbl(ui, e) {
  const v = vx(ui); e.preventDefault(); e.stopPropagation();
  if (ui.tool === "vreg") return regDbl(ui, e);
  if (ui.tool === "vwall" && !(v.draw && (v.draw.tool === "polilinha" || v.draw.tool === "bezier"))) return wallDbl(ui, e);
  if (v.draw && (v.draw.tool === "polilinha" || v.draw.tool === "bezier")) { finishDraft(ui); return; }
  if (v.tool === "selecao") { const hit = e.target.closest?.("[data-vroute]")?.dataset.vroute ?? nearSeg(ui, e.clientX, e.clientY, null, 8)?.id; if (hit) { v.tool = "forma"; setSel(ui, [hit]); v.nodes = []; ui.refresh(); } return; }
  if (v.tool !== "forma") return;
  const nodeEl = e.target.closest?.("[data-vn]");
  if (nodeEl) { const [id, i] = nodeEl.dataset.vn.split("|"); v.nodes = [{ id, i: Number(i) }]; return vecAction(ui, "delNode"); }
  const sg = nearSeg(ui, e.clientX, e.clientY, selIds(ui), 10); if (!sg) return;
  if (!(e.ctrlKey || e.metaKey)) return; // novo nó: Ctrl + duplo clique no traço (ou o botão da barra)
  mutateData(ui.scene, (D) => { const r = D.routes.find(x => x.id === sg.id); if (!r || r.locked) return []; const { nodes, closed } = toNodes(r); const ni = splitSeg(nodes, closed, sg.k, sg.t); apply(r, nodes, closed); v.nodes = [{ id: r.id, i: ni }]; return ["routes"]; }).then(() => ui.refresh());
}
export function vecContext(ui, e) {
  if (ui.vEatCtx) { ui.vEatCtx = false; return; }
  const v = vx(ui);
  if (v.draw) { const dr = v.draw; if ((dr.tool === "polilinha" || dr.tool === "bezier") && dr.nodes.length > 1) dr.nodes.pop(); else v.draw = null; ui.refresh(); return; }
  if (ui.tool === "vwall") return wallContext(ui, e);
  if (ui.tool === "vreg") { if (v.rdraw) { v.rdraw.pts.pop(); if (!v.rdraw.pts.length) v.rdraw = null; ui.refreshMap(); return; }
    const W = ui.s2w(e.clientX, e.clientY); const nh = v.reg ? nearRegNode(ui, e.clientX, e.clientY) : null; if (nh && !v.rnodes.some(x => x.si === nh.si && x.i === nh.i)) v.rnodes = [nh];
    if (!v.reg) { const hit = regionHit(ui, [W.x, W.y]); if (hit) v.reg = hit; } if (v.reg) { ui.refresh(); openMenu(ui, e.clientX, e.clientY, "reg"); } return; }
  // botão direito numa rota: seleciona (se ainda não estava) e abre o menu, como no Corel
  const nodeEl = e.target.closest?.("[data-vn]");
  if (v.tool === "forma" && nodeEl) { const [id, i] = nodeEl.dataset.vn.split("|"); if (!v.nodes.some(x => x.id === id && x.i === Number(i))) v.nodes = [{ id, i: Number(i) }]; ui.refresh(); openMenu(ui, e.clientX, e.clientY, "nodes"); return; }
  const id = e.target.closest?.("[data-vroute]")?.dataset.vroute ?? nearSeg(ui, e.clientX, e.clientY, null, 8)?.id;
  if (id && !selIds(ui).includes(id)) { setSel(ui, v.tool === "forma" ? [id] : withGroups(ui, [id])); v.nodes = []; ui.refresh(); }
  if (selIds(ui).length || ui.vclip?.length) openMenu(ui, e.clientX, e.clientY, v.tool === "forma" && v.nodes.length ? "nodes" : "routes");
}

/* ---------- menu do botão direito (mapa e painel) ---------- */
let menuEl = null;
export function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
export function openMenu(ui, x, y, kind = "routes") {
  closeMenu(); const v = vx(ui); const ids = selIds(ui); const rs = dataOf(ui.scene).routes.filter(r => ids.includes(r.id));
  const grouped = rs.some(r => r.group && !r.combined), combined = rs.some(r => r.combined); const n = ids.length;
  const I2 = (k) => `<svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">${I[k] ?? ""}</svg>`;
  const it = (act, label, icon, key = "", dis = false) => `<button type="button" class="vmi" data-vm="${act}" ${dis ? "disabled" : ""}>${icon ? I2(icon) : "<i></i>"}<span>${esc(label)}</span><kbd>${esc(key)}</kbd></button>`;
  const sep = `<hr>`; let h = "";
  if (kind === "walls") {
    const nw = v.wsel?.length ?? 0, nn = v.wnodes?.length ?? 0; const T = wallTypes();
    h = `<div class="vmh">${wallInfo(ui) || "Paredes"}</div>${Object.entries(T).map(([k, t]) => it("w:wtype:" + k, `Tipo: ${t.label}`, "", "", !(nw || nn))).join("")}${sep}
      ${it("w:addNode", "Dividir (novo nó no meio)", "addNode", "", !(nw || nn))}${it("w:delNode", "Juntar as paredes do nó", "delNode", "", !nn)}${it("w:joinNodes", "Juntar dois nós", "joinNodes", "", nn !== 2)}${it("w:lineNodes", "Ligar dois nós com parede", "lineNodes", "", nn !== 2)}${it("w:breakNode", "Separar no nó", "breakNode", "", !nn)}${sep}
      ${it("w:cut", "Recortar", "del", "Ctrl+X", !nw)}${it("w:copy", "Copiar", "dup", "Ctrl+C", !nw)}${it("w:paste", "Colar", "dup", "Ctrl+V", !ui.wclip?.length)}${it("w:dup", "Duplicar", "dup", "Ctrl+D", !nw)}${it("w:delete", "Excluir", "del", "Delete", !nw)}`;
  } else if (kind === "reg") {
    const r = ui.scene.regions?.get?.(v.reg?.rid); const s = r ? shapeList(r)[v.reg.si] : null; const pol = s?.type === "polygon"; const nn = v.rnodes.length;
    const on = pol && nn;
    h = `<div class="vmh">${esc(r?.name ?? "Região")} · forma ${(v.reg?.si ?? 0) + 1}${nn ? ` · ${nn} nó(s)` : ""}</div>${pol ? "" : it("r:toPoly", "Converter em curvas", "toPoly", "Ctrl+Q")}${it("r:toLine", "Converter em reta", "toLine", "", !on)}${it("r:toCurve", "Converter em curva", "toCurve", "", !on)}${sep}${it("r:cusp", "Cúspide", "cusp", "", !on)}${it("r:smooth", "Suave", "smooth", "", !on)}${it("r:sym", "Simétrico", "sym", "", !on)}${it("r:auto", "Automático", "auto", "", !on)}${sep}${it("r:addNode", "Adicionar nó", "addNode", "", !on)}${it("r:delNode", "Apagar nó(s)", "delNode", "Delete", !on)}${sep}${it("r:hole", s?.hole ? "Deixar de ser buraco" : "Tornar buraco", "hole")}${it("r:delShape", "Excluir forma", "del")}`;
  } else if (kind === "nodes") {
    h = `<div class="vmh">${v.nodes.length} nó(s)</div>${it("toLine", "Converter em reta", "toLine")}${it("toCurve", "Converter em curva", "toCurve")}${sep}${it("cusp", "Cúspide", "cusp")}${it("smooth", "Suave", "smooth")}${it("sym", "Simétrico", "sym")}${it("auto", "Automático", "auto")}${sep}${it("addNode", "Adicionar nó", "addNode")}${it("breakNode", "Quebrar a rota aqui", "breakNode")}${v.nodes.length === 2 ? it("joinNodes", "Juntar os dois nós", "joinNodes") + it("lineNodes", "Ligar com reta", "lineNodes") : ""}${it("delNode", "Apagar nó(s)", "delNode", "Delete")}`;
  } else {
    h = `<div class="vmh">${n ? `${n} rota(s)${grouped ? " · grupo" : ""}${combined ? " · combinadas" : ""}` : "Rotas"}</div>
      ${it("combine", "Combinar", "combine", "Ctrl+L", n < 2)}${it("breakApart", "Separar", "breakNode", "Ctrl+K", !combined)}${it("group", "Agrupar", "group", "Ctrl+G", n < 2)}${it("ungroup", "Desagrupar", "ungroup", "Ctrl+U", !grouped)}${sep}
      ${it("cut", "Recortar", "del", "Ctrl+X", !n)}${it("copy", "Copiar", "dup", "Ctrl+C", !n)}${it("paste", "Colar", "dup", "Ctrl+V", !ui.vclip?.length)}${it("dup", "Duplicar", "dup", "Ctrl+D", !n)}${it("delRoutes", "Excluir", "del", "Delete", !n)}${sep}
      ${it("copyStyle", "Copiar aparência", "", "", n !== 1)}${it("pasteStyle", "Colar aparência", "", "", !n || !ui.routeClip)}${it("reverse", "Inverter o sentido", "reverse", "", !n)}${it("close", "Fechar / abrir a curva", "close", "", !n)}${it("hide", rs.length && rs.every(r => r.hidden) ? "Mostrar aos jogadores" : "Ocultar dos jogadores", "", "", !n)}${it("lock", rs.length && rs.every(r => r.locked) ? "Destravar" : "Travar", "", "", !n)}${ui.tool === "vrota" ? it("editNodes", "Editar os nós", "forma", "", !n) : ""}`;
  }
  menuEl = document.createElement("div"); menuEl.id = "atlas-vmenu"; menuEl.innerHTML = h; (document.getElementById("interface") ?? document.body).appendChild(menuEl);
  const r = menuEl.getBoundingClientRect(); menuEl.style.left = `${Math.min(x, window.innerWidth - r.width - 6)}px`; menuEl.style.top = `${Math.min(y, window.innerHeight - r.height - 6)}px`;
  menuEl.addEventListener("pointerdown", (e) => e.stopPropagation());
  menuEl.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); });
  menuEl.addEventListener("click", (e) => { const b = e.target.closest("[data-vm]"); if (!b || b.disabled) return; e.preventDefault(); const a = b.dataset.vm; closeMenu(); if (a.startsWith("w:wtype:")) wallAction(ui, "wtype", { v: a.slice(8) }); else if (a.startsWith("w:")) wallAction(ui, a.slice(2)); else if (a.startsWith("r:")) regAction(ui, a.slice(2)); else vecAction(ui, a); });
}
window.addEventListener("pointerdown", (e) => { if (menuEl && !e.composedPath().includes(menuEl)) closeMenu(); }, true);
window.addEventListener("keydown", (e) => { if (menuEl && e.key === "Escape") { closeMenu(); e.stopPropagation(); } }, true);
Hooks.on("pauseGame", () => { try { const ui = globalThis.ui?.atlasUI ?? null; if (lastUi) renderVBar(lastUi, true); } catch (e) { /* */ } });
let lastUi = null;

/* ---------- pausa ao entrar e Espaço (alterna com a Seleção, como no Corel) ---------- */
export function vecEnter(ui) {
  lastUi = ui; document.body.classList.add("atlas-vec");
  try { if (game.user.isGM && game.togglePause && !game.paused) { game.togglePause(true, { broadcast: true }); ui.vPausedByUs = true; } } catch (e) { /* */ }
}
export function vecExit(ui) {
  document.body.classList.remove("atlas-vec"); closeMenu();
  try { if (ui.vPausedByUs && game.paused && game.togglePause) game.togglePause(false, { broadcast: true }); } catch (e) { /* */ } ui.vPausedByUs = false;
}
export function vecSpace(ui) {
  if (!(ui.editing && isVec(ui.tool))) return false;
  const a = document.activeElement; if (a && ["INPUT", "TEXTAREA", "SELECT"].includes(a.tagName)) return false;
  const v = vx(ui);
  if (ui.tool === "vreg") { if (v.rdraw) regFinishDraw(ui); if (v.rtool !== "forma") { v.rprev = v.rtool; v.rtool = "forma"; } else { v.rtool = v.rprev ?? "forma"; } ui.refresh(); return true; }
  if (v.draw) finishDraft(ui);
  if (ui.tool === "vwall") { if (v.tool !== "forma") { v.prevTool = v.tool; v.tool = "forma"; } else v.tool = v.prevTool && v.prevTool !== "forma" ? v.prevTool : "forma"; ui.mouse = null; ui.refresh(); return true; }
  if (v.tool !== "selecao") { v.prevTool = v.tool; v.tool = "selecao"; v.nodes = []; } else v.tool = v.prevTool && v.prevTool !== "selecao" ? v.prevTool : "forma";
  ui.mouse = null; ui.refresh(); return true;
}
/** Teclas (Delete, Enter, Esc). Devolve true se tratou. */
export function vecKey(ui, e) {
  const v = vx(ui); const k = e.key;
  if (ui.tool === "vwall" && !v.draw && (k === "Delete" || k === "Backspace" || k === "Escape" || e.ctrlKey || e.metaKey) && wallKey(ui, e)) return true;
  if (k === "Escape") { if (v.draw) v.draw = null; else if (v.rdraw) v.rdraw = null; else if (v.nodes.length) v.nodes = []; else if (v.rnodes.length) v.rnodes = []; else if (ui.tool === "vreg" && v.reg) v.reg = null; else if (selIds(ui).length) setSel(ui, []); else return false;
    e.preventDefault(); e.stopPropagation(); ui.refresh(); return true; }
  if ((e.ctrlKey || e.metaKey) && ui.tool === "vreg" && k.toLowerCase() === "q") { e.preventDefault(); e.stopPropagation(); regAction(ui, "toPoly"); return true; }
  if ((e.ctrlKey || e.metaKey) && ui.tool === "vrota") { const map = { l: "combine", k: "breakApart", g: "group", u: "ungroup", c: "copy", x: "cut", v: "paste", d: "dup", a: "selAll" }; const a = map[k.toLowerCase()];
    if (a) { e.preventDefault(); e.stopPropagation(); vecAction(ui, a); return true; } return false; }
  if (k === " " && !game.keybindings) { e.preventDefault(); e.stopPropagation(); return vecSpace(ui); }
  if (k === "Enter") { if (v.draw) { e.preventDefault(); e.stopPropagation(); finishDraft(ui); return true; } if (v.rdraw) { e.preventDefault(); e.stopPropagation(); regFinishDraw(ui); return true; } return false; }
  if (k === "Delete" || k === "Backspace") {
    e.preventDefault(); e.stopPropagation();
    if (ui.tool === "vreg") { if (v.rnodes.length) regAction(ui, "delNode"); else if (v.reg) regAction(ui, "delShape"); return true; }
    if (v.tool === "forma" && v.nodes.length) vecAction(ui, "delNode"); else if (selIds(ui).length) vecAction(ui, "delRoutes"); return true;
  }
  return false;
}

/* ---------- ações da barra ---------- */
function segsOfSel(v, r, nodes, closed) {
  // como no Corel: o trecho que chega ao nó selecionado (no primeiro nó de rota aberta, o que sai dele)
  const out = new Set(); const n = nodes.length;
  for (const s of v.nodes) { if (s.id !== r.id) continue; const i = s.i; if (i > 0) out.add(i - 1); else out.add(closed ? n - 1 : 0); }
  return [...out].filter(k => k >= 0 && k < segCount(nodes, closed));
}
export async function vecAction(ui, act, ds = {}) {
  const v = vx(ui); const sc = ui.scene; const ids = selIds(ui);
  const byRoute = () => { const by = {}; for (const n of v.nodes) (by[n.id] ??= []).push(n.i); return by; };
  switch (act) {
    case "tool": v.tool = ds.v; v.draw = null; if (ds.v !== "forma") v.nodes = []; ui.mouse = null; ui.refresh(); return;
    case "sides": v.sides = Math.max(3, Math.min(24, Number(ds.v) || 6)); return;
    case "type": ui.newRouteType = ds.v; if (ids.length) await mutateData(sc, (D) => { for (const r of D.routes) if (ids.includes(r.id)) r.type = ds.v; return ["routes"]; }); ui.refresh(); return;
    case "exit": ui.useTool("sel"); return;
    case "addNode": { const by = byRoute(); if (!Object.keys(by).length) return; const ns = [];
      await mutateData(sc, (D) => { for (const r of D.routes) { if (!by[r.id] || r.locked) continue; const { nodes, closed } = toNodes(r); const segs = segsOfSel({ nodes: by[r.id].map(i => ({ id: r.id, i })) }, r, nodes, closed).sort((a, b) => b - a);
        for (const k of segs) splitSeg(nodes, closed, k, 0.5); apply(r, nodes, closed); } return ["routes"]; }); v.nodes = ns; ui.refresh(); return; }
    case "delNode": { const by = byRoute(); if (!Object.keys(by).length) return;
      await mutateData(sc, (D) => { for (const r of [...D.routes]) { const idx = by[r.id]; if (!idx || r.locked) continue; const { nodes, closed } = toNodes(r); const last = nodes.length - 1;
        const keep = nodes.filter((_, i) => !idx.includes(i)); if (!closed && idx.includes(0)) r.a = null; if (!closed && idx.includes(last)) r.b = null;
        if (keep.length < (closed ? 3 : 2)) { D.routes = D.routes.filter(x => x.id !== r.id); continue; } apply(r, keep, closed); } return ["routes"]; });
      v.nodes = []; ui.refresh(); return; }
    case "toLine": case "toCurve": { const by = byRoute(); if (!Object.keys(by).length) return;
      await mutateData(sc, (D) => { for (const r of D.routes) { if (!by[r.id] || r.locked) continue; const { nodes, closed } = toNodes(r); freeze(nodes); const n = nodes.length;
        for (const k of segsOfSel(v, r, nodes, closed)) { const A = nodes[k], B = nodes[(k + 1) % n];
          if (act === "toLine") { A.outV = [0, 0]; B.inV = [0, 0]; A.t = "cusp"; B.t = "cusp"; }
          else if (len(A.outV) < 0.01 && len(B.inV) < 0.01) { A.outV = [(B.p[0] - A.p[0]) / 3, (B.p[1] - A.p[1]) / 3]; B.inV = [(A.p[0] - B.p[0]) / 3, (A.p[1] - B.p[1]) / 3]; A.t = "cusp"; B.t = "cusp"; } }
        apply(r, nodes, closed); } return ["routes"]; }); ui.refresh(); return; }
    case "cusp": case "smooth": case "sym": case "auto": { const by = byRoute(); if (!Object.keys(by).length) return;
      await mutateData(sc, (D) => { for (const r of D.routes) { const idx = by[r.id]; if (!idx || r.locked) continue; const { nodes, closed } = toNodes(r); const n = nodes.length;
        for (const i of idx) { const x = nodes[i]; if (!x) continue;
          if (act === "auto") { x.t = "auto"; continue; }
          if (act === "cusp") { x.t = "cusp"; continue; }
          const li = len(x.inV), lo = len(x.outV); const P = nodes[(i - 1 + n) % n]?.p ?? x.p, N = nodes[(i + 1) % n]?.p ?? x.p;
          let dir = li > 0.01 && lo > 0.01 ? ang([x.outV[0] - x.inV[0], x.outV[1] - x.inV[1]]) : lo > 0.01 ? ang(x.outV) : li > 0.01 ? ang([-x.inV[0], -x.inV[1]]) : ang([N[0] - P[0], N[1] - P[1]]);
          let Li = li || ddist(P, x.p) / 3, Lo = lo || ddist(N, x.p) / 3; if (!closed && i === 0) Li = 0; if (!closed && i === n - 1) Lo = 0;
          if (act === "sym") { const m = (Li + Lo) / 2 || Math.max(Li, Lo); Li = (!closed && i === 0) ? 0 : m; Lo = (!closed && i === n - 1) ? 0 : m; }
          x.inV = fromAng(dir + 180, Li); x.outV = fromAng(dir, Lo); x.t = act; }
        apply(r, nodes, closed); } return ["routes"]; }); ui.refresh(); return; }
    case "joinNodes": case "lineNodes": {
      const sel = v.nodes; if (sel.length !== 2) { globalThis.ui?.notifications?.info("Atlas: selecione dois nós de ponta (Shift soma)."); return; }
      let newSel = [];
      await mutateData(sc, (D) => {
        const [s1, s2] = sel; const A = D.routes.find(r => r.id === s1.id), B = D.routes.find(r => r.id === s2.id); if (!A || !B || A.locked || B.locked) return [];
        const nA = toNodes(A), nB = toNodes(B); const endA = !nA.closed && (s1.i === 0 || s1.i === nA.nodes.length - 1), endB = !nB.closed && (s2.i === 0 || s2.i === nB.nodes.length - 1);
        if (!endA || !endB) { globalThis.ui?.notifications?.warn("Atlas: só dá para juntar nós das pontas de rotas abertas."); return []; }
        if (A.id === B.id) { // fecha a rota
          const ns = nA.nodes; if (s1.i === s2.i) return [];
          if (act === "joinNodes") { const f = ns[0], l = ns[ns.length - 1]; const m = lerp(f.p, l.p, 0.5); f.p = m; f.inV = l.inV; f.t = "cusp"; ns.pop(); }
          else { ns[0].inV = [0, 0]; ns[ns.length - 1].outV = [0, 0]; }
          apply(A, ns, true); A.a = null; A.b = null; newSel = [A.id]; return ["routes"];
        }
        // duas rotas: A termina no nó escolhido, B começa no nó escolhido
        if (s1.i === 0) reverseRoute(A); if (s2.i !== 0) reverseRoute(B);
        const a = toNodes(A).nodes, b = toNodes(B).nodes; let ns;
        if (act === "joinNodes") { const L = a[a.length - 1], F = b[0]; const m = { p: lerp(L.p, F.p, 0.5), inV: L.inV, outV: F.outV, t: "cusp" }; ns = [...a.slice(0, -1), m, ...b.slice(1)]; }
        else { a[a.length - 1].outV = [0, 0]; b[0].inV = [0, 0]; ns = [...a, ...b]; }
        const bEnd = B.b; apply(A, ns, false); A.b = bEnd; D.routes = D.routes.filter(r => r.id !== B.id); newSel = [A.id]; return ["routes"];
      });
      v.nodes = []; if (newSel.length) setSel(ui, newSel); ui.refresh(); return; }
    case "breakNode": { const by = byRoute(); if (!Object.keys(by).length) return; const made = [];
      await mutateData(sc, (D) => { for (const r of [...D.routes]) { const idx = by[r.id]; if (!idx || r.locked) continue; let { nodes, closed } = toNodes(r); freeze(nodes);
          let pieces;
          if (closed) { const j = idx[0]; const rot = [...nodes.slice(j), ...nodes.slice(0, j)]; const first = rot[0]; const endN = { ...first, p: [...first.p], outV: [0, 0] }; rot[0] = { ...first, inV: [0, 0] }; pieces = [[...rot, endN]]; idx.shift();
            const rest = idx.map(i => (i - j + nodes.length) % nodes.length).filter(i => i > 0); nodes = pieces[0]; pieces = cut(nodes, rest); }
          else pieces = cut(nodes, idx.filter(i => i > 0 && i < nodes.length - 1));
          if (pieces.length < 2 && !closed) continue;
          const a0 = r.a, b0 = r.b; const base = foundry.utils.deepClone(r);
          pieces.forEach((ns, k) => { if (k === 0) { apply(r, ns, false); r.a = closed ? null : a0; r.b = pieces.length === 1 && !closed ? b0 : null; made.push(r.id); }
            else { const r2 = { ...foundry.utils.deepClone(base), id: uid(), a: null, b: k === pieces.length - 1 && !closed ? b0 : null }; apply(r2, ns, false); D.routes.push(r2); made.push(r2.id); } });
        } return ["routes"]; });
      v.nodes = []; if (made.length) setSel(ui, made); ui.refresh(); return; }
    case "close": await mutateData(sc, (D) => { for (const r of D.routes) { if (!ids.includes(r.id) || r.locked) continue; const { nodes, closed } = toNodes(r); if (nodes.length < 3) continue;
        if (closed) { const f = nodes[0]; nodes.push({ ...f, p: [...f.p], outV: [0, 0] }); nodes[0] = { ...f, inV: [0, 0] }; apply(r, nodes, false); } else { nodes[0].inV = [0, 0]; nodes[nodes.length - 1].outV = [0, 0]; apply(r, nodes, true); r.a = null; r.b = null; } } return ["routes"]; }); v.nodes = []; ui.refresh(); return;
    case "reverse": await mutateData(sc, (D) => { for (const r of D.routes) if (ids.includes(r.id) && !r.locked) reverseRoute(r); return ["routes"]; }); v.nodes = []; ui.refresh(); return;
    case "group": if (ids.length < 2) return; { const g = uid(); await mutateData(sc, (D) => { for (const r of D.routes) if (ids.includes(r.id)) r.group = g; return ["routes"]; }); } ui.refresh(); return;
    case "ungroup": await mutateData(sc, (D) => { for (const r of D.routes) if (ids.includes(r.id)) r.group = null; return ["routes"]; }); ui.refresh(); return;
    case "combine": return combineRoutes(ui, ids);
    case "dup": { if (!ids.length) return; const off = (sc.grid?.size ?? 100) / 2; const made = []; const gmap = {};
      await mutateData(sc, (D) => { for (const r of [...D.routes]) if (ids.includes(r.id)) { const c = foundry.utils.deepClone(r); c.id = uid(); c.points = c.points.map(p => [p[0] + off, p[1] + off]); c.a = null; c.b = null; if (c.group) c.group = gmap[c.group] ??= uid(); D.routes.push(c); made.push(c.id); } return ["routes"]; });
      setSel(ui, made); ui.refresh(); return; }
    case "delRoutes": { if (!ids.length) return; const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Apagar rotas" }, content: `<p>Apagar ${ids.length} rota(s)?</p>`, rejectClose: false }).catch(() => false); if (!ok) return;
      await mutateData(sc, (D) => { D.routes = D.routes.filter(r => !ids.includes(r.id) || r.locked); return ["routes"]; }); setSel(ui, []); v.nodes = []; ui.refresh(); return; }
    case "selAll": setSel(ui, dataOf(sc).routes.map(r => r.id)); ui.refresh(); return;
    case "pause": try { game.togglePause?.(!game.paused, { broadcast: true }); ui.vPausedByUs = false; } catch (e) { /* */ } renderVBar(ui, true); return;
    case "breakApart": await mutateData(sc, (D) => { for (const r of D.routes) if (ids.includes(r.id) && r.combined) { r.group = null; r.combined = false; } return ["routes"]; }); ui.refresh(); return;
    case "copy": case "cut": { if (!ids.length) return; ui.vclip = dataOf(sc).routes.filter(r => ids.includes(r.id)).map(r => foundry.utils.deepClone(r));
      if (act === "cut") { await mutateData(sc, (D) => { D.routes = D.routes.filter(r => !ids.includes(r.id) || r.locked); return ["routes"]; }); setSel(ui, []); v.nodes = []; } ui.refresh(); return; }
    case "paste": { if (!ui.vclip?.length) return; const have = new Set(dataOf(sc).routes.map(r => r.id)); const off = ui.vclip.some(r => have.has(r.id)) ? (sc.grid?.size ?? 100) / 2 : 0; const made = []; const gmap = {};
      await mutateData(sc, (D) => { for (const r0 of ui.vclip) { const c = foundry.utils.deepClone(r0); c.id = uid(); c.points = c.points.map(p => [p[0] + off, p[1] + off]); if (off) { c.a = null; c.b = null; } c.locked = false; if (c.group) c.group = gmap[c.group] ??= uid(); D.routes.push(c); made.push(c.id); } return ["routes"]; });
      ui.vclip = ui.vclip.map(r => ({ ...r, points: r.points.map(p => [p[0] + off, p[1] + off]) })); setSel(ui, made); v.nodes = []; ui.refresh(); return; }
    case "copyStyle": { const r = dataOf(sc).routes.find(x => x.id === ids[0]); if (!r) return; const n = normRoute(r); ui.routeClip = Object.fromEntries(["color", "width", "dash", "dashScale", "opacity", "outline", "outlineColor", "outlineWidth", "showName", "nameSize", "nameColor"].map(k => [k, n[k]])); ui.refreshChrome(); return; }
    case "pasteStyle": if (!ui.routeClip) return; await mutateData(sc, (D) => { for (const r of D.routes) if (ids.includes(r.id)) Object.assign(r, foundry.utils.deepClone(ui.routeClip)); return ["routes"]; }); ui.refresh(); return;
    case "hide": case "lock": { const k = act === "hide" ? "hidden" : "locked"; const all = dataOf(sc).routes.filter(r => ids.includes(r.id)).every(r => r[k]); await mutateData(sc, (D) => { for (const r of D.routes) if (ids.includes(r.id)) r[k] = !all; return ["routes"]; }); ui.refresh(); return; }
    case "editNodes": v.tool = "forma"; v.nodes = []; if (ui.tool !== "vrota") ui.useTool("vrota"); ui.refresh(); return;
  }
}
/**
 * Combinar (como no Corel): as rotas viram um objeto só, com a aparência da primeira.
 * Pontas que se encostam viram uma rota contínua; nada é fechado e nenhuma linha nova é criada.
 */
export async function combineRoutes(ui, ids) {
  ids = [...new Set(ids)]; if (ids.length < 2) return; const tol = Math.max(2, (ui.scene.grid?.size ?? 100) * 0.08); let keep = [];
  const STYLE = ["color", "width", "dash", "dashScale", "opacity", "outline", "outlineColor", "outlineWidth", "showName", "nameSize", "nameColor"];
  await mutateData(ui.scene, (D) => {
    let rs = ids.map(id => D.routes.find(r => r.id === id)).filter(r => r && !r.locked); if (rs.length < 2) return [];
    const base = rs[0]; const g = base.group || uid();
    for (const r of rs) { r.group = g; r.combined = true; if (r !== base) for (const k of STYLE) { if (base[k] === undefined) delete r[k]; else r[k] = foundry.utils.deepClone(base[k]); } }
    // junta pontas que se encostam (sem fechar nenhuma rota)
    let merged = true;
    while (merged) { merged = false;
      outer: for (const A of rs) for (const B of rs) { if (A === B || isClosed(A) || isClosed(B)) continue;
        const a0 = A.points[0], a1 = A.points[A.points.length - 1], b0 = B.points[0], b1 = B.points[B.points.length - 1];
        let how = null; if (ddist(a1, b0) <= tol) how = "ab"; else if (ddist(a1, b1) <= tol) how = "abr"; else if (ddist(a0, b0) <= tol) how = "rab"; else if (ddist(a0, b1) <= tol) how = "ba";
        if (!how) continue;
        if (how === "abr") reverseRoute(B); else if (how === "rab") reverseRoute(A); else if (how === "ba") { reverseRoute(A); reverseRoute(B); }
        const a = toNodes(A).nodes, b = toNodes(B).nodes; freeze(a); freeze(b); const L = a[a.length - 1], F = b[0];
        const m = { p: lerp(L.p, F.p, 0.5), inV: L.inV, outV: F.outV, t: "cusp" }; const bEnd = B.b;
        apply(A, [...a.slice(0, -1), m, ...b.slice(1)], false); A.b = bEnd;
        D.routes = D.routes.filter(r => r !== B); rs = rs.filter(r => r !== B); merged = true; break outer; }
    }
    keep = rs.map(r => r.id); return ["routes"];
  });
  setSel(ui, keep); vx(ui).nodes = []; ui.refresh();
  if (keep.length > 1) globalThis.ui?.notifications?.info(`Atlas: ${keep.length} partes combinadas num objeto só (as pontas que se tocavam viraram uma rota contínua).`);
}
/** Corta uma lista de nós (rota aberta) nos índices dados; o nó do corte fica nas duas partes. */
function cut(nodes, idx) {
  const cuts = [...new Set(idx)].sort((a, b) => a - b); const out = []; let s = 0;
  for (const c of cuts) { const part = nodes.slice(s, c + 1).map(x => ({ ...x })); part[part.length - 1].outV = [0, 0]; if (out.length || s > 0) part[0].inV = [0, 0]; out.push(part); s = c; }
  const last = nodes.slice(s).map(x => ({ ...x })); if (cuts.length) last[0] = { ...last[0], inV: [0, 0] }; out.push(last); return out;
}

/* ---------- desenho na tela ---------- */
const NODE = (q, cls, data) => `<rect class="vnode ${cls}" ${data} x="${(q.x - 4.5).toFixed(1)}" y="${(q.y - 4.5).toFixed(1)}" width="9" height="9"/>`;
export function renderVec(ui, svg, html) {
  const v = vx(ui); const d = dataOf(ui.scene); const toS = (p) => { const q = ui.w2s(p[0], p[1]); return [q.x, q.y]; };
  if (ui.tool === "vreg") return renderReg(ui, svg, html);
  if (ui.tool === "vwall") { renderWalls(ui, svg, html); return renderDraft(ui, svg, html); }
  const sel = selIds(ui); const drag = ui.vdrag;
  for (const r0 of d.routes) {
    if (r0.points.length < 2) continue; let r = r0;
    // prévia do arraste
    if (drag?.moved && ((drag.kind === "move" && sel.includes(r.id)) || (drag.kind === "nodes" && v.nodes.some(n => n.id === r.id)) || ((drag.kind === "knob" || drag.kind === "bend") && drag.id === r.id))) {
      r = foundry.utils.deepClone(r0);
      if (drag.kind === "move") r.points = r.points.map(p => [p[0] + drag.dx, p[1] + drag.dy]);
      else if (drag.kind === "nodes") { const { nodes, closed } = toNodes(r); for (const n of v.nodes) if (n.id === r.id && nodes[n.i]) nodes[n.i].p = [nodes[n.i].p[0] + drag.dx, nodes[n.i].p[1] + drag.dy]; apply(r, nodes, closed); }
      else if (drag.kind === "knob" && drag.W) { const { nodes, closed } = toNodes(r); const x = nodes[drag.i]; if (x) { setSide(x, drag.side, [drag.W[0] - x.p[0], drag.W[1] - x.p[1]]); apply(r, nodes, closed); } }
      else if (drag.kind === "bend" && drag.W) bendRoute(r, drag.k, drag.t, drag.W);
    }
    const path = segsPath(bezierSegs(r.points, r.handles), toS);
    const on = sel.includes(r.id);
    if (r !== r0 || on) svg.push(`<path class="vsel ${on ? "on" : ""} ${r.group ? "grp" : ""}" d="${path}"/>`);
    if (!["polilinha", "bezier", "curva3", "circulo", "retangulo", "poligono", "maolivre"].includes(v.tool)) svg.push(`<path class="vhit" data-vroute="${r.id}" d="${path}"/>`);
    if (v.tool === "forma" && on) {
      const { nodes, closed } = toNodes(r);
      nodes.forEach((x, i) => { const q = ui.w2s(x.p[0], x.p[1]); const s = v.nodes.some(n => n.id === r.id && n.i === i);
        const n = nodes.length; const selAt = (j) => v.nodes.some(q => q.id === r.id && q.i === ((j % n) + n) % n);
        const sides = s ? ["in", "out"] : [...(selAt(i + 1) ? ["out"] : []), ...(selAt(i - 1) ? ["in"] : [])];
        for (const side of sides) { if (!closed && ((side === "in" && i === 0) || (side === "out" && i === nodes.length - 1))) continue; const V = side === "in" ? x.inV : x.outV; if (len(V) < 0.5) continue;
          const k = ui.w2s(x.p[0] + V[0], x.p[1] + V[1]); svg.push(`<line class="vhl" x1="${q.x}" y1="${q.y}" x2="${k.x}" y2="${k.y}"/><circle class="vknob" data-vk="${r.id}|${i}|${side}" cx="${k.x}" cy="${k.y}" r="4.5"/>`); }
        svg.push(NODE(q, `${s ? "on" : ""} ${i === 0 && !closed ? "first" : ""} t-${x.t}`, `data-vn="${r.id}|${i}"`)); });
    }
  }
  // caixa da seleção (ferramenta de seleção)
  if (v.tool === "selecao" && sel.length) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; const off = drag?.kind === "move" && drag.moved ? [drag.dx, drag.dy] : [0, 0];
    for (const r of d.routes) if (sel.includes(r.id)) for (const p of r.points) { const q = ui.w2s(p[0] + off[0], p[1] + off[1]); x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
    if (Number.isFinite(x0)) { svg.push(`<rect class="vbox" x="${x0 - 6}" y="${y0 - 6}" width="${x1 - x0 + 12}" height="${y1 - y0 + 12}"/>`); for (const [cx, cy] of [[x0 - 6, y0 - 6], [x1 + 6, y0 - 6], [x0 - 6, y1 + 6], [x1 + 6, y1 + 6], [(x0 + x1) / 2, y0 - 6], [(x0 + x1) / 2, y1 + 6], [x0 - 6, (y0 + y1) / 2], [x1 + 6, (y0 + y1) / 2]]) svg.push(`<rect class="vboxh" x="${cx - 3}" y="${cy - 3}" width="6" height="6"/>`); } }
  renderDraft(ui, svg, html);
}
function renderDraft(ui, svg, html) {
  const v = vx(ui); const drag = ui.vdrag; const toS = (p) => { const q = ui.w2s(p[0], p[1]); return [q.x, q.y]; };
  const m = ui.mouse ? ui.s2w(ui.mouse.x, ui.mouse.y) : null; let M = m ? [m.x, m.y] : null;
  if (M && v.draw && (v.draw.tool === "polilinha" || v.draw.tool === "bezier") && ui.vShift && v.draw.nodes.length) M = angSnap(v.draw.nodes[v.draw.nodes.length - 1].p, M);
  const dn = draftNodes(ui, M);
  if (dn && dn.nodes.length >= 2) { const b = fromNodes(dn.nodes.map(x => ({ ...x })), dn.closed); svg.push(`<path class="vdraft" d="${segsPath(bezierSegs(b.points, b.handles), toS)}"/>`); }
  if (v.draw) { for (const x of v.draw.nodes ?? []) svg.push(NODE(ui.w2s(x.p[0], x.p[1]), "draft", "")); for (const p of [v.draw.a, v.draw.b, v.draw.c].filter(Boolean)) svg.push(NODE(ui.w2s(p[0], p[1]), "draft", "")); }
  if (drag?.kind === "marq" && drag.moved) svg.push(`<rect class="vmarq" x="${Math.min(drag.x0, drag.x1)}" y="${Math.min(drag.y0, drag.y1)}" width="${Math.abs(drag.x1 - drag.x0)}" height="${Math.abs(drag.y1 - drag.y0)}"/>`);
  if (ui.mouse) html.push(`<span class="cursorhint" style="left:${ui.mouse.x}px;top:${ui.mouse.y}px">${esc(hintOf(ui))}</span>`);
}
function hintOf(ui) {
  const v = vx(ui); const dr = v.draw;
  if (ui.tool === "vwall" && !dr && !["polilinha", "bezier", "curva3", "circulo", "retangulo", "poligono", "maolivre"].includes(v.tool)) return "clique: parede ou nó (Shift soma) · arraste: move (as pontas encostadas andam juntas) · Ctrl+duplo clique: divide · duplo clique no nó: junta as paredes";
  if (ui.tool === "vreg") { if (v.rdraw) return v.rdraw.tool === "rpoli" ? "clique: ponto · duplo clique/Enter: fecha · dir.: desfaz" : "clique: termina"; return { forma: "clique: Região, nó ou borda (Shift soma) · Alt+clique: a Região de baixo · Ctrl+duplo clique na borda: novo nó", rpoli: "clique: primeiro ponto", rret: "clique: um canto", relipse: "clique: centro", rregular: "clique: centro" }[v.rtool] ?? ""; }
  if (dr) return { polilinha: "clique: ponto · Shift: 15° · duplo clique/Enter: termina · dir.: desfaz", bezier: "clique: canto · arraste: curva · duplo clique/Enter: termina", curva3: dr.b ? "mova para curvar · clique: termina" : "clique: ponto final", circulo: "clique: raio", retangulo: "clique: outro canto (Shift: quadrado)", poligono: "clique: um vértice" }[dr.tool] ?? "";
  return { selecao: "clique: seleciona (grupo inteiro) · arraste: move · duplo clique: edita os nós", forma: "clique: nó ou trecho (Shift soma) · arraste o trecho para curvar · Ctrl+duplo clique: novo nó", maolivre: "arraste para desenhar", polilinha: "clique: começar", bezier: "clique: começar", curva3: "clique: ponto inicial", circulo: "clique: centro", retangulo: "clique: um canto", poligono: "clique: centro" }[v.tool] ?? "";
}

/* ---------- Regiões ---------- */
// As Regiões do Foundry só têm lados retos. Para editar como nas rotas (curvas, nós suaves...), o desenho em curvas
// fica guardado na Região (flags.brumas-atlas.vsrc, por forma) e o polígono do Foundry é gerado a partir dele.
// Se o polígono for mudado por fora (ferramentas do Foundry), o desenho guardado é ignorado e os vértices viram nós.
const regionsOf = (sc) => sc?.regions?.contents ?? [...(sc?.regions ?? [])];
const shapeList = (r) => shapesOf(r).map(s => foundry.utils.deepClone(s));
const SIG = (pts) => { let h = pts.length; for (let i = 0; i < pts.length; i++) h = (h * 31 + Math.round(pts[i]) + 7) % 1000000007; return h; };
const srcList = (r) => foundry.utils.deepClone(r?.flags?.[MODULE_ID]?.vsrc ?? []);
const closedRoute = (nodes) => { const b = fromNodes(nodes, true); return { points: b.points, handles: b.handles, closed: true }; };
/** Forma de polígono → "rota fechada" com nós (curvas guardadas, ou os vértices como cantos). */
function shapeRoute(r, si, s) {
  s ??= shapeList(r)[si]; if (!s || s.type !== "polygon") return null;
  const src = srcList(r)[si]; if (src?.points?.length > 3 && src.sig === SIG(s.points ?? [])) return { points: src.points.map(p => [...p]), handles: (src.handles ?? []).map(h => h ? { ...h } : null), closed: true };
  const pts = []; for (let i = 0; i < (s.points?.length ?? 0); i += 2) pts.push([s.points[i], s.points[i + 1]]);
  if (pts.length > 1 && ddist(pts[0], pts[pts.length - 1]) < 0.5) pts.pop(); if (pts.length < 3) return null;
  return closedRoute(pts.map(p => ({ p, inV: [0, 0], outV: [0, 0], t: "cusp" })));
}
/** Curvas → pontos do polígono (trechos retos: só as pontas; curvos: amostrados). */
function flatten(route, step) {
  const out = [];
  for (const s of bezierSegs(route.points, route.handles)) { out.push(s[0]); const off = (q) => { const dx = s[3][0] - s[0][0], dy = s[3][1] - s[0][1]; const L = Math.hypot(dx, dy) || 1; return Math.abs((q[0] - s[0][0]) * dy - (q[1] - s[0][1]) * dx) / L; }; const straight = (ddist(s[0], s[1]) < 0.5 && ddist(s[2], s[3]) < 0.5) || (off(s[1]) < 0.6 && off(s[2]) < 0.6); if (straight) continue;
    const L = ddist(s[0], s[1]) + ddist(s[1], s[2]) + ddist(s[2], s[3]); const n = Math.max(4, Math.min(40, Math.ceil(L / step))); for (let j = 1; j < n; j++) out.push(bez(s, j / n)); }
  return out.flatMap(p => [Math.round(p[0]), Math.round(p[1])]);
}
const stepOf = (ui) => Math.max(4, (ui.scene.grid?.size ?? 100) / 5);
/** Grava a forma `si` a partir da rota fechada (polígono do Foundry + desenho em curvas). */
function putRoute(ui, shapes, vsrc, si, route) {
  const pts = flatten(route, stepOf(ui)); const s = { ...shapes[si] }; for (const k of ["x", "y", "width", "height", "radius", "radiusX", "radiusY", "rotation"]) delete s[k];
  shapes[si] = { ...s, type: "polygon", points: pts }; while (vsrc.length < shapes.length) vsrc.push(null); vsrc[si] = { points: route.points, handles: route.handles, sig: SIG(pts) };
}
async function saveRegion(ui, region, shapes, vsrc) {
  try { while (vsrc.length > shapes.length) vsrc.pop(); pushRegionUndo(ui.scene, region.id, shapeList(region), srcList(region));
    await region.update({ shapes, [`flags.${MODULE_ID}.vsrc`]: vsrc }); } catch (err) { console.error(`${MODULE_ID} | região`, err); globalThis.ui?.notifications?.error("Atlas: não foi possível mudar a Região."); }
}
function shapeArea(s) { if (s.type === "rectangle") return s.width * s.height; if (s.type === "circle") return Math.PI * s.radius ** 2; if (s.type === "ellipse") return Math.PI * s.radiusX * s.radiusY; let a = 0; const p = s.points ?? []; for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length; a += p[i] * p[j + 1] - p[j] * p[i + 1]; } return Math.abs(a / 2); }
/** Pontos de controle de retângulo, círculo e elipse (redimensionar). */
function primHandles(s) {
  if (s.type === "rectangle") return [[s.x, s.y], [s.x + s.width, s.y], [s.x + s.width, s.y + s.height], [s.x, s.y + s.height]].map((p, i) => ({ i, p }));
  if (s.type === "circle") return [{ i: 0, p: [s.x + s.radius, s.y] }];
  if (s.type === "ellipse") return [{ i: 0, p: [s.x + s.radiusX, s.y] }, { i: 1, p: [s.x, s.y + s.radiusY] }];
  return [];
}
/** Nós de uma forma: polígono = nós do desenho; outras = pontos de controle. */
function shapeNodes(r, si, s) { if (s.type === "polygon") { const rt = shapeRoute(r, si, s); return rt ? toNodes(rt).nodes.map((x, i) => ({ i, p: x.p })) : []; } return primHandles(s); }
/** Retângulo, círculo e elipse viram curvas (círculo e elipse com 4 nós simétricos, exatos). */
function primToRoute(s) {
  const rot = (s.rotation ?? 0) * D2R; const R = (x, y, cx, cy) => { const dx = x - cx, dy = y - cy; return [cx + dx * Math.cos(rot) - dy * Math.sin(rot), cy + dx * Math.sin(rot) + dy * Math.cos(rot)]; };
  if (s.type === "rectangle") { const cx = s.x + s.width / 2, cy = s.y + s.height / 2; return closedRoute([[s.x, s.y], [s.x + s.width, s.y], [s.x + s.width, s.y + s.height], [s.x, s.y + s.height]].map(([x, y]) => ({ p: R(x, y, cx, cy), inV: [0, 0], outV: [0, 0], t: "cusp" }))); }
  const rx = s.type === "circle" ? s.radius : s.radiusX, ry = s.type === "circle" ? s.radius : s.radiusY; const k = 0.5523;
  const base = [[rx, 0, [0, -ry * k], [0, ry * k]], [0, ry, [rx * k, 0], [-rx * k, 0]], [-rx, 0, [0, ry * k], [0, -ry * k]], [0, -ry, [-rx * k, 0], [rx * k, 0]]];
  const rv = (v) => [v[0] * Math.cos(rot) - v[1] * Math.sin(rot), v[0] * Math.sin(rot) + v[1] * Math.cos(rot)];
  return closedRoute(base.map(([x, y, iv, ov]) => ({ p: R(s.x + x, s.y + y, s.x, s.y), inV: rv(iv), outV: rv(ov), t: "sym" })));
}
function movePrim(s, idxs, dx, dy, whole = false) {
  s = foundry.utils.deepClone(s);
  if (whole) { s.x = Math.round(s.x + dx); s.y = Math.round(s.y + dy); return s; }
  if (s.type === "rectangle") { const i = idxs[0]; let x0 = s.x, y0 = s.y, x1 = s.x + s.width, y1 = s.y + s.height; if (i === 0 || i === 3) x0 += dx; else x1 += dx; if (i === 0 || i === 1) y0 += dy; else y1 += dy;
    s.x = Math.round(Math.min(x0, x1)); s.y = Math.round(Math.min(y0, y1)); s.width = Math.round(Math.abs(x1 - x0)); s.height = Math.round(Math.abs(y1 - y0)); return s; }
  if (s.type === "circle") { s.radius = Math.max(2, Math.round(s.radius + dx)); return s; }
  if (s.type === "ellipse") { if (idxs.includes(0)) s.radiusX = Math.max(2, Math.round(s.radiusX + dx)); if (idxs.includes(1)) s.radiusY = Math.max(2, Math.round(s.radiusY + dy)); return s; }
  return s;
}
/** Operação de nós numa rota fechada (Região): mesma lógica das rotas. */
function nodeOp(route, idxs, act, extra = {}) {
  const { nodes } = toNodes(route); const n = nodes.length; const closed = true;
  const segs = [...new Set(idxs.map(i => (i - 1 + n) % n))];
  switch (act) {
    case "addNode": for (const k of segs.sort((a, b) => b - a)) splitSeg(nodes, closed, k, 0.5); break;
    case "addAt": splitSeg(nodes, closed, extra.k, extra.t); break;
    case "delNode": { const keep = nodes.filter((_, i) => !idxs.includes(i)); if (keep.length < 3) return null; return closedRoute(keep); }
    case "toLine": freeze(nodes); for (const k of segs) { const A = nodes[k], B = nodes[(k + 1) % n]; A.outV = [0, 0]; B.inV = [0, 0]; A.t = "cusp"; B.t = "cusp"; } break;
    case "toCurve": freeze(nodes); for (const k of segs) { const A = nodes[k], B = nodes[(k + 1) % n]; if (len(A.outV) < 0.01 && len(B.inV) < 0.01) { A.outV = [(B.p[0] - A.p[0]) / 3, (B.p[1] - A.p[1]) / 3]; B.inV = [(A.p[0] - B.p[0]) / 3, (A.p[1] - B.p[1]) / 3]; A.t = "cusp"; B.t = "cusp"; } } break;
    case "auto": for (const i of idxs) if (nodes[i]) nodes[i].t = "auto"; break;
    case "cusp": for (const i of idxs) if (nodes[i]) { freeze([nodes[i]]); nodes[i].t = "cusp"; } break;
    case "smooth": case "sym": for (const i of idxs) { const x = nodes[i]; if (!x) continue; const li = len(x.inV), lo = len(x.outV); const P = nodes[(i - 1 + n) % n].p, N = nodes[(i + 1) % n].p;
      const dir = li > 0.01 && lo > 0.01 ? ang([x.outV[0] - x.inV[0], x.outV[1] - x.inV[1]]) : lo > 0.01 ? ang(x.outV) : li > 0.01 ? ang([-x.inV[0], -x.inV[1]]) : ang([N[0] - P[0], N[1] - P[1]]);
      let Li = li || ddist(P, x.p) / 3, Lo = lo || ddist(N, x.p) / 3; if (act === "sym") { const m = (Li + Lo) / 2; Li = m; Lo = m; }
      x.inV = fromAng(dir + 180, Li); x.outV = fromAng(dir, Lo); x.t = act; } break;
    default: return route;
  }
  return closedRoute(nodes);
}
function regionHit(ui, W, skip = null) { // a menor forma que contém o ponto (skip: pula a atual, para alcançar a de baixo)
  const all = []; for (const r of regionsOf(ui.scene)) shapeList(r).forEach((s, si) => { if (!s.hole && shapeContains(s, W)) all.push({ rid: r.id, si, a: shapeArea(s) }); });
  all.sort((x, y) => x.a - y.a); if (!all.length) return null;
  if (skip) { const k = all.findIndex(x => x.rid === skip.rid && x.si === skip.si); if (k >= 0) return all[(k + 1) % all.length]; }
  return all[0];
}
const selRegion = (ui) => { const v = vx(ui); return v.reg ? ui.scene.regions?.get?.(v.reg.rid) ?? null : null; };
/** Nó da Região selecionada perto do ponto de tela. */
function nearRegNode(ui, sx, sy, px = 9) {
  const v = vx(ui); const r = selRegion(ui); if (!r) return null; let best = null, bd = px;
  shapeList(r).forEach((s, si) => { for (const h of shapeNodes(r, si, s)) { const q = ui.w2s(h.p[0], h.p[1]); const d = Math.hypot(q.x - sx, q.y - sy); if (d < bd || (d === bd && si === v.reg.si)) { bd = d; best = { si, i: h.i, p: h.p }; } } });
  return best;
}
/** Alça (knob) de nó selecionado da Região. */
function nearRegKnob(ui, sx, sy, px = 8) {
  const v = vx(ui); const r = selRegion(ui); if (!r || !v.rnodes.length) return null; let best = null, bd = px;
  const shs = shapeList(r);
  for (const si of new Set(v.rnodes.map(x => x.si))) { const rt = shapeRoute(r, si, shs[si]); if (!rt) continue; const { nodes } = toNodes(rt); const n = nodes.length;
    const selAt = (j) => v.rnodes.some(q => q.si === si && q.i === ((j % n) + n) % n);
    nodes.forEach((x, i) => { const sides = selAt(i) ? ["in", "out"] : [...(selAt(i + 1) ? ["out"] : []), ...(selAt(i - 1) ? ["in"] : [])];
      for (const side of sides) { const V = side === "in" ? x.inV : x.outV; if (len(V) < 0.5) continue; const q = ui.w2s(x.p[0] + V[0], x.p[1] + V[1]); const d = Math.hypot(q.x - sx, q.y - sy); if (d < bd) { bd = d; best = { si, i, side }; } } }); }
  return best;
}
/** Trecho (curvo ou reto) da Região selecionada perto do ponto de tela. */
function nearRegSeg(ui, sx, sy, px = 7) {
  const r = selRegion(ui); if (!r) return null; let best = null, bd = px;
  shapeList(r).forEach((s, si) => { const rt = shapeRoute(r, si, s); if (!rt) return;
    bezierSegs(rt.points, rt.handles).forEach((sg, k) => { const N = sampN(ui, sg); for (let j = 1; j < N; j++) { const t = j / N; if (t < 0.04 || t > 0.96) continue; const p = bez(sg, t); const q = ui.w2s(p[0], p[1]); const d = Math.hypot(q.x - sx, q.y - sy); if (d < bd) { bd = d; best = { si, k, t, n: rt.points.length - 1 }; } } }); });
  return best;
}
/** Borda de outra Região (para selecioná-la). */
function nearRegEdge(ui, sx, sy, px = 6) {
  let best = null, bd = px;
  for (const r of regionsOf(ui.scene)) shapeList(r).forEach((s, si) => { if (s.type !== "polygon") return; const p = s.points ?? []; const n = p.length / 2;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; const a = ui.w2s(p[i * 2], p[i * 2 + 1]), b = ui.w2s(p[j * 2], p[j * 2 + 1]); const dx = b.x - a.x, dy = b.y - a.y; const L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((sx - a.x) * dx + (sy - a.y) * dy) / L2)); const d = Math.hypot(sx - a.x - t * dx, sy - a.y - t * dy); if (d < bd) { bd = d; best = { rid: r.id, si }; } } });
  return best;
}
function shapeContains(s, [x, y]) {
  if (s.type === "rectangle") return x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.height;
  if (s.type === "circle") return Math.hypot(x - s.x, y - s.y) <= s.radius;
  if (s.type === "ellipse") return ((x - s.x) / s.radiusX) ** 2 + ((y - s.y) / s.radiusY) ** 2 <= 1;
  const p = s.points ?? []; let ins = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) { const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1]; if (((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } return ins;
}
/** Forma `si` com o arraste atual aplicado (prévia e gravação): { s, route }. */
function regDragged(ui, r, si, s, d) {
  const v = vx(ui); let route = shapeRoute(r, si, s);
  if (!d?.moved) return { s, route };
  if (d.kind === "rmove" && si === v.reg?.si) { if (route) { route = { ...route, points: route.points.map(p => [p[0] + d.dx, p[1] + d.dy]) }; } else s = movePrim(s, [], d.dx, d.dy, true); }
  if (d.kind === "rnodes") { const idx = v.rnodes.filter(x => x.si === si).map(x => x.i); if (idx.length) { if (route) { const { nodes } = toNodes(route); for (const i of idx) if (nodes[i]) nodes[i].p = [nodes[i].p[0] + d.dx, nodes[i].p[1] + d.dy]; route = closedRoute(nodes); } else s = movePrim(s, idx, d.dx, d.dy); } }
  if (d.kind === "rknob" && d.si === si && route && d.W) { const { nodes } = toNodes(route); const x = nodes[d.i]; if (x) { setSide(x, d.side, [d.W[0] - x.p[0], d.W[1] - x.p[1]]); route = closedRoute(nodes); } }
  if (d.kind === "rbend" && d.si === si && route && d.W) { route = { ...route }; bendRoute(route, d.k, d.t, d.W); }
  return { s, route };
}
function regDown(ui, e, W) {
  const v = vx(ui); const t = v.rtool;
  if (t !== "forma") { const s = snapAt(ui, e.clientX, e.clientY); const P = [s.x, s.y];
    if (t === "rpoli") { v.rdraw ??= { tool: t, pts: [] }; const last = v.rdraw.pts[v.rdraw.pts.length - 1]; if (!last || ddist(last, P) > 1) v.rdraw.pts.push(P); ui.refreshMap(); return true; }
    if (!v.rdraw) { v.rdraw = { tool: t, c: P }; ui.vdrag = { kind: "rshape", moved: false }; ui.refreshMap(); return true; }
    regFinishDraw(ui, P, e); return true; }
  // 1) alça de um nó selecionado
  const kn = nearRegKnob(ui, e.clientX, e.clientY); if (kn) { ui.vdrag = { kind: "rknob", ...kn, moved: false }; return true; }
  // 2) nó da Região selecionada (mesmo dentro de outra Região)
  const nh = v.reg ? nearRegNode(ui, e.clientX, e.clientY) : null;
  if (nh) { const has = v.rnodes.some(x => x.si === nh.si && x.i === nh.i); v.reg = { rid: v.reg.rid, si: nh.si };
    if (e.shiftKey) v.rnodes = has ? v.rnodes.filter(x => !(x.si === nh.si && x.i === nh.i)) : [...v.rnodes, { si: nh.si, i: nh.i }]; else if (!has) v.rnodes = [{ si: nh.si, i: nh.i }];
    ui.vdrag = { kind: "rnodes", w0: W, dx: 0, dy: 0, moved: false, lead: { p: nh.p, si: nh.si, i: nh.i } }; ui.refresh(); return true; }
  // 3) trecho da Região selecionada: clique seleciona o trecho (nó do fim); arrastar entorta
  const sg = v.reg ? nearRegSeg(ui, e.clientX, e.clientY) : null;
  if (sg) { v.reg = { rid: v.reg.rid, si: sg.si }; ui.vdrag = { kind: "rbend", si: sg.si, k: sg.k, t: sg.t, n: sg.n, w0: W, moved: false, shift: e.shiftKey }; return true; }
  // 4) dentro da Região selecionada: continua nela (arrastar move a forma); Alt escolhe a de baixo
  const cur = selRegion(ui);
  if (cur && !e.altKey) { const shs = shapeList(cur); const inCur = shs[v.reg.si] && !shs[v.reg.si].hole && shapeContains(shs[v.reg.si], W); const si = inCur ? v.reg.si : shs.findIndex(s0 => !s0.hole && shapeContains(s0, W));
    if (si >= 0) { if (si !== v.reg.si) { v.reg = { rid: cur.id, si }; v.rnodes = []; ui.refresh(); return true; } ui.vdrag = { kind: "rmove", w0: W, dx: 0, dy: 0, moved: false }; return true; } }
  // 5) borda de outra Região, ou a menor que contém o ponto (Alt: a próxima embaixo)
  const oe = e.altKey ? null : nearRegEdge(ui, e.clientX, e.clientY);
  const hit = oe ?? regionHit(ui, W, e.altKey ? v.reg : null);
  if (hit) { v.reg = { rid: hit.rid, si: hit.si }; v.rnodes = []; ui.refresh(); return true; }
  if (v.reg) { ui.vdrag = { kind: "rmarq", x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, add: e.shiftKey, moved: false }; return true; }
  return true;
}
async function regUp(ui, e, d) {
  const v = vx(ui);
  if (d.kind === "rshape") { if (d.moved && v.rdraw) { const s = snapAt(ui, e.clientX, e.clientY); if (ddist(v.rdraw.c, [s.x, s.y]) * (ui.zoom || 1) > 8) return regFinishDraw(ui, [s.x, s.y], e); } ui.refreshMap(); return; }
  if (d.kind === "rmarq") { if (!d.moved) { if (!d.add) { v.reg = null; v.rnodes = []; } ui.refresh(); return; }
    const r = selRegion(ui); if (!r) return; const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1); const got = [];
    shapeList(r).forEach((s, si) => { for (const h of shapeNodes(r, si, s)) { const q = ui.w2s(h.p[0], h.p[1]); if (q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1) got.push({ si, i: h.i }); } });
    v.rnodes = d.add ? [...v.rnodes, ...got] : got; ui.refresh(); return; }
  if (d.kind === "rbend" && !d.moved) { const i = (d.k + 1) % d.n; const key = { si: d.si, i }; const has = v.rnodes.some(x => x.si === key.si && x.i === i);
    v.rnodes = d.shift ? (has ? v.rnodes.filter(x => !(x.si === key.si && x.i === i)) : [...v.rnodes, key]) : [key]; ui.refresh(); return; }
  if (!d.moved || !v.reg) { ui.refreshMap(); return; }
  const r = selRegion(ui); if (!r) return; const shapes = shapeList(r); const vsrc = srcList(r);
  for (let si = 0; si < shapes.length; si++) { const { s, route } = regDragged(ui, r, si, shapes[si], d); const touched = (d.kind === "rmove" && si === v.reg.si) || (d.kind === "rnodes" && v.rnodes.some(x => x.si === si)) || ((d.kind === "rknob" || d.kind === "rbend") && d.si === si);
    if (!touched) continue; if (route && shapes[si].type === "polygon") putRoute(ui, shapes, vsrc, si, route); else shapes[si] = s; }
  await saveRegion(ui, r, shapes, vsrc); ui.refresh();
}
function regDbl(ui, e) {
  const v = vx(ui); if (v.rdraw?.tool === "rpoli") { regFinishDraw(ui); return; }
  const r = selRegion(ui); if (!r) return;
  const nh = nearRegNode(ui, e.clientX, e.clientY); if (nh) { if (shapeList(r)[nh.si]?.type === "polygon") { v.reg = { rid: r.id, si: nh.si }; v.rnodes = [{ si: nh.si, i: nh.i }]; return regAction(ui, "delNode"); } return; }
  if (!(e.ctrlKey || e.metaKey)) return; // novo nó: Ctrl + duplo clique na borda (ou o botão da barra)
  const sg = nearRegSeg(ui, e.clientX, e.clientY, 10); if (!sg) return; v.reg = { rid: r.id, si: sg.si };
  regAction(ui, "addAt", { k: sg.k, t: sg.t });
}
async function regFinishDraw(ui, P = null, e = null) {
  const v = vx(ui); const dr = v.rdraw; v.rdraw = null; if (!dr) return; let shape = null;
  if (dr.tool === "rpoli") { if (dr.pts.length >= 3) shape = { type: "polygon", points: dr.pts.flat().map(Math.round), hole: false }; }
  else if (P) { const c = dr.c;
    if (dr.tool === "rret") { let w = P[0] - c[0], h = P[1] - c[1]; if (e?.shiftKey || e?.ctrlKey) { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; } shape = { type: "rectangle", x: Math.round(Math.min(c[0], c[0] + w)), y: Math.round(Math.min(c[1], c[1] + h)), width: Math.round(Math.abs(w)), height: Math.round(Math.abs(h)), rotation: 0, hole: false }; }
    if (dr.tool === "relipse") { const rx = Math.abs(P[0] - c[0]), ry = Math.abs(P[1] - c[1]); shape = (e?.shiftKey || e?.ctrlKey) ? { type: "circle", x: c[0], y: c[1], radius: Math.round(Math.max(rx, ry)), hole: false } : { type: "ellipse", x: c[0], y: c[1], radiusX: Math.round(Math.max(2, rx)), radiusY: Math.round(Math.max(2, ry)), rotation: 0, hole: false }; }
    if (dr.tool === "rregular") shape = { type: "polygon", points: polyNodes(c, P, v.sides).flatMap(x => x.p.map(Math.round)), hole: false }; }
  if (!shape) { ui.refresh(); return; }
  const target = selRegion(ui);
  if (target) { const shapes = shapeList(target); const vsrc = srcList(target); shapes.push(shape); while (vsrc.length < shapes.length) vsrc.push(null); await saveRegion(ui, target, shapes, vsrc); v.reg = { rid: target.id, si: shapes.length - 1 }; }
  else { const n = regionsOf(ui.scene).length + 1; const pal = ["#3f8f4a", "#2a6fb0", "#b0702a", "#7a4ab0", "#c0392b", "#2a8aa0", "#8a7a2a", "#5a6ab0"];
    try { const [doc] = await ui.scene.createEmbeddedDocuments("Region", [{ name: `Região ${n}`, color: pal[n % pal.length], shapes: [shape] }]); if (doc) { pushRegionUndo(ui.scene, doc.id, null); v.reg = { rid: doc.id, si: 0 }; } } catch (err) { console.error(err); } }
  v.rnodes = []; ui.refresh();
}
const NODE_ACTS = ["addNode", "delNode", "toLine", "toCurve", "cusp", "smooth", "sym", "auto"];
export async function regAction(ui, act, ds = {}) {
  const v = vx(ui);
  if (act === "rtool") { v.rtool = ds.v; v.rdraw = null; ui.refresh(); return; }
  if (act === "newRegion") { v.reg = null; v.rnodes = []; ui.refresh(); return; }
  if (act === "exit") { ui.useTool("sel"); return; }
  if (act === "pause") return vecAction(ui, "pause");
  const r = selRegion(ui); if (!r) { v.reg = null; return; } const shapes = shapeList(r); const vsrc = srcList(r); const si = v.reg.si; const s = shapes[si]; if (!s) return;
  if (NODE_ACTS.includes(act) || act === "addAt") {
    // nós em várias formas da Região: aplica em cada uma
    const by = {}; for (const n of v.rnodes) (by[n.si] ??= []).push(n.i); if (act === "addAt") by[si] = [];
    let changed = false;
    for (const [k, idx] of Object.entries(by)) { const sk = Number(k); const sh = shapes[sk]; if (!sh) continue;
      let route = sh.type === "polygon" ? shapeRoute(r, sk, sh) : (act === "addAt" || act === "addNode" ? primToRoute(sh) : null);
      if (!route) { globalThis.ui?.notifications?.info("Atlas: converta a forma em curvas para editar nó a nó."); continue; }
      const out = nodeOp(route, idx, act, ds); if (!out) { globalThis.ui?.notifications?.warn("Atlas: a forma precisa de pelo menos 3 nós."); continue; }
      putRoute(ui, shapes, vsrc, sk, out); changed = true; }
    if (!changed) return; if (act === "delNode" || act === "addNode" || act === "addAt") v.rnodes = [];
    await saveRegion(ui, r, shapes, vsrc); ui.refresh(); return;
  }
  switch (act) {
    case "toPoly": if (s.type === "polygon") return; putRoute(ui, shapes, vsrc, si, primToRoute(s)); v.rnodes = []; break;
    case "hole": shapes[si] = { ...s, hole: !s.hole }; break;
    case "delShape": { if (shapes.length === 1) { const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Apagar Região" }, content: `<p>Esta é a única forma de <b>${esc(r.name)}</b>. Apagar a Região inteira?</p>`, rejectClose: false }).catch(() => false); if (ok) { pushRegionUndo(ui.scene, r.id, null); await r.delete(); v.reg = null; v.rnodes = []; ui.refresh(); } return; }
      shapes.splice(si, 1); vsrc.splice(si, 1); v.reg = { rid: r.id, si: 0 }; v.rnodes = []; break; }
    default: return;
  }
  await saveRegion(ui, r, shapes, vsrc); ui.refresh();
}
function renderReg(ui, svg, html) {
  const v = vx(ui); const d = ui.vdrag; const P = (x, y) => ui.w2s(x, y); const toS = (p) => { const q = ui.w2s(p[0], p[1]); return [q.x, q.y]; };
  const shapeSvg = (s, cls, extra = "") => {
    switch (s.type) {
      case "rectangle": { const p = P(s.x, s.y); const z = ui.zoom; const cx = p.x + s.width * z / 2, cy = p.y + s.height * z / 2; return `<rect class="${cls}" ${extra} x="${p.x}" y="${p.y}" width="${s.width * z}" height="${s.height * z}" transform="rotate(${s.rotation ?? 0} ${cx} ${cy})"/>`; }
      case "circle": { const p = P(s.x, s.y); return `<circle class="${cls}" ${extra} cx="${p.x}" cy="${p.y}" r="${s.radius * ui.zoom}"/>`; }
      case "ellipse": { const p = P(s.x, s.y); return `<ellipse class="${cls}" ${extra} cx="${p.x}" cy="${p.y}" rx="${s.radiusX * ui.zoom}" ry="${s.radiusY * ui.zoom}" transform="rotate(${s.rotation ?? 0} ${p.x} ${p.y})"/>`; }
      case "polygon": { const pts = []; for (let i = 0; i < (s.points?.length ?? 0); i += 2) { const q = P(s.points[i], s.points[i + 1]); pts.push(`${q.x.toFixed(1)},${q.y.toFixed(1)}`); } return `<polygon class="${cls}" ${extra} points="${pts.join(" ")}"/>`; }
    } return ""; };
  const late = [];
  const regs = regionsOf(ui.scene); const ordered = [...regs.filter(r => r.id !== v.reg?.rid), ...regs.filter(r => r.id === v.reg?.rid)]; // a selecionada por cima
  for (const r of ordered) {
    const col = esc(r.color?.css ?? r.color ?? "#3aa0ff"); const isSel = v.reg?.rid === r.id;
    shapeList(r).forEach((s0, si) => {
      if (!isSel) { svg.push(shapeSvg(s0, `vreg ${s0.hole ? "hole" : ""}`, `style="--zc:${col}"`)); return; }
      const { s, route } = regDragged(ui, r, si, s0, d); const cur = si === v.reg.si;
      if (route) svg.push(`<path class="vreg sel ${cur ? "cur" : ""} ${s.hole ? "hole" : ""}" style="--zc:${col}" d="${segsPath(bezierSegs(route.points, route.handles), toS)}Z"/>`);
      else svg.push(shapeSvg(s, `vreg sel ${cur ? "cur" : ""} ${s.hole ? "hole" : ""}`, `style="--zc:${col}"`));
      if (route) { const { nodes } = toNodes(route); const n = nodes.length; const onAt = (k) => v.rnodes.some(x => x.si === si && x.i === ((k % n) + n) % n);
        const segs = bezierSegs(route.points, route.handles); segs.forEach((sg, k) => { if (onAt(k + 1)) late.unshift(`<path class="vseg" d="${segsPath([sg], toS)}"/>`); });
        nodes.forEach((x, i) => { const q = P(x.p[0], x.p[1]); const sel = onAt(i); const sides = sel ? ["in", "out"] : [...(onAt(i + 1) ? ["out"] : []), ...(onAt(i - 1) ? ["in"] : [])];
          for (const side of sides) { const V = side === "in" ? x.inV : x.outV; if (len(V) < 0.5) continue; const k2 = P(x.p[0] + V[0], x.p[1] + V[1]); late.push(`<line class="vhl" x1="${q.x}" y1="${q.y}" x2="${k2.x}" y2="${k2.y}"/><circle class="vknob" cx="${k2.x}" cy="${k2.y}" r="4.5"/>`); }
          late.push(NODE(q, `${sel ? "on" : ""} t-${x.t} ${cur ? "" : "other"}`, "")); }); }
      else for (const h of primHandles(s)) { const q = P(h.p[0], h.p[1]); late.push(NODE(q, `${v.rnodes.some(x => x.si === si && x.i === h.i) ? "on" : ""} ctl ${cur ? "" : "other"}`, "")); }
    });
    if (isSel) { const b = shapeList(r)[v.reg.si]; if (b) { const hs = shapeNodes(r, v.reg.si, b); if (hs.length) { const top = hs.reduce((a, h) => h.p[1] < a.p[1] ? h : a, hs[0]); const q = P(top.p[0], top.p[1]); html.push(`<span class="vreglabel" style="left:${q.x}px;top:${q.y - 24}px">${esc(r.name)}${b.hole ? " · buraco" : ""}${b.type !== "polygon" ? " · " + ({ rectangle: "retângulo", ellipse: "elipse", circle: "círculo" }[b.type] ?? b.type) : ""}</span>`); } } }
  }
  for (const l of late) svg.push(l); // nós por cima de todas as Regiões
  // rascunho
  const m = ui.mouse ? ui.s2w(ui.mouse.x, ui.mouse.y) : null; const dr = v.rdraw;
  if (dr && m) { const M = [m.x, m.y];
    if (dr.tool === "rpoli") { const pts = [...dr.pts, M].map(p => { const q = P(p[0], p[1]); return `${q.x},${q.y}`; }); svg.push(`<polygon class="vdraft" points="${pts.join(" ")}"/>`); for (const p of dr.pts) svg.push(NODE(P(p[0], p[1]), "draft", "")); }
    else if (dr.tool === "rret") { const a = P(...dr.c), b = P(...M); svg.push(`<rect class="vdraft" x="${Math.min(a.x, b.x)}" y="${Math.min(a.y, b.y)}" width="${Math.abs(b.x - a.x)}" height="${Math.abs(b.y - a.y)}"/>`); }
    else if (dr.tool === "relipse") { const a = P(...dr.c); svg.push(`<ellipse class="vdraft" cx="${a.x}" cy="${a.y}" rx="${Math.abs(M[0] - dr.c[0]) * ui.zoom}" ry="${Math.abs(M[1] - dr.c[1]) * ui.zoom}"/>`); }
    else if (dr.tool === "rregular") { const pts = polyNodes(dr.c, M, v.sides).map(x => { const q = P(x.p[0], x.p[1]); return `${q.x},${q.y}`; }); svg.push(`<polygon class="vdraft" points="${pts.join(" ")}"/>`); } }
  if (d?.kind === "rmarq" && d.moved) svg.push(`<rect class="vmarq" x="${Math.min(d.x0, d.x1)}" y="${Math.min(d.y0, d.y1)}" width="${Math.abs(d.x1 - d.x0)}" height="${Math.abs(d.y1 - d.y0)}"/>`);
  if (ui.mouse) html.push(`<span class="cursorhint" style="left:${ui.mouse.x}px;top:${ui.mouse.y}px">${esc(hintOf(ui))}</span>`);
}
// arrastes de região usam os mesmos campos (dx/dy) do vecMove
const _vm = vecMove;
export function vecMoveAll(ui, e) {
  const d = ui.vdrag; if (!d) return;
  if (d.kind === "rmove" || d.kind === "rnodes") { const w = ui.s2w(e.clientX, e.clientY); d.dx = w.x - d.w0[0]; d.dy = w.y - d.w0[1]; if (e.shiftKey) { if (Math.abs(d.dx) > Math.abs(d.dy)) d.dy = 0; else d.dx = 0; }
    else if (d.kind === "rnodes" && d.lead) { // ímã: nós de outras Regiões (bordas em comum)
      const q = ui.w2s(d.lead.p[0] + d.dx, d.lead.p[1] + d.dy); let best = null, bd = 10; const rid = vx(ui).reg?.rid;
      for (const r of regionsOf(ui.scene)) shapeList(r).forEach((s, si) => { if (r.id === rid && si === d.lead.si) return; for (const h of shapeNodes(r, si, s)) { const k = ui.w2s(h.p[0], h.p[1]); const dd = Math.hypot(k.x - q.x, k.y - q.y); if (dd < bd) { bd = dd; best = h.p; } } });
      if (best) { d.dx = best[0] - d.lead.p[0]; d.dy = best[1] - d.lead.p[1]; } } d.moved = d.moved || Math.hypot(d.dx, d.dy) * (ui.zoom || 1) > 2; ui.refreshMap(); return; }
  if (d.kind === "rknob" || d.kind === "rbend") { const w = ui.s2w(e.clientX, e.clientY); d.W = [w.x, w.y]; if (!d.w0 || Math.hypot(w.x - d.w0[0], w.y - d.w0[1]) * (ui.zoom || 1) > 2) d.moved = true; ui.refreshMap(); return; }
  if (d.kind === "wnodes" || d.kind === "wmove" || d.kind === "wmarq") return wallMove(ui, e);
  if (d.kind === "rmarq") { d.x1 = e.clientX; d.y1 = e.clientY; d.moved = d.moved || Math.hypot(d.x1 - d.x0, d.y1 - d.y0) > 4; ui.refreshMap(); return; }
  if (d.kind === "rshape") { d.moved = true; ui.mouse = { x: e.clientX, y: e.clientY }; ui.refreshMap(); return; }
  return _vm(ui, e);
}

/* ---------- barra de ferramentas (no alto da tela) ---------- */
const I = {
  selecao: `<path d="M5 3l11 6-5 1.5L9 16z" fill="currentColor"/>`,
  forma: `<path d="M4 3l9 5-4 1.2L7.5 13z" fill="currentColor"/><rect x="12" y="12" width="5" height="5" fill="none" stroke="currentColor" stroke-width="1.4"/>`,
  maolivre: `<path d="M2 14c3-6 5 2 8-3s4-6 6-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
  polilinha: `<path d="M2 15l5-8 5 5 6-9" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="5.5" y="5.5" width="3" height="3" fill="currentColor"/><rect x="10.5" y="10.5" width="3" height="3" fill="currentColor"/>`,
  bezier: `<path d="M3 15C5 3 13 3 16 15" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M2 6h7M9 6l-2 0" stroke="currentColor"/><circle cx="2.5" cy="6" r="1.5" fill="currentColor"/><circle cx="9.5" cy="6" r="1.5" fill="currentColor"/>`,
  curva3: `<path d="M2 15Q9 0 16 15" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="2" cy="15" r="1.6" fill="currentColor"/><circle cx="16" cy="15" r="1.6" fill="currentColor"/><circle cx="9" cy="7.5" r="1.6" fill="currentColor"/>`,
  circulo: `<circle cx="9" cy="9" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/>`,
  retangulo: `<rect x="2.5" y="4" width="13" height="10" fill="none" stroke="currentColor" stroke-width="1.6"/>`,
  poligono: `<path d="M9 2l6.5 4.7-2.5 7.8H5L2.5 6.7z" fill="none" stroke="currentColor" stroke-width="1.6"/>`,
  addNode: `<rect x="2" y="9" width="5" height="5" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="11" y="9" width="5" height="5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M7 11.5h4" stroke="currentColor"/><path d="M9 1.5v5M6.5 4h5" stroke="#3fae5a" stroke-width="2"/>`,
  delNode: `<rect x="2" y="9" width="5" height="5" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="11" y="9" width="5" height="5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M7 11.5h4" stroke="currentColor"/><path d="M6.5 4h5" stroke="#d04a3a" stroke-width="2"/>`,
  joinNodes: `<path d="M2 4v10M16 4v10" stroke="currentColor" stroke-width="1.4"/><path d="M2 9h5M11 9h5" stroke="currentColor"/><rect x="7" y="6.5" width="4" height="5" fill="currentColor"/>`,
  lineNodes: `<path d="M2 4v10M16 4v10" stroke="currentColor" stroke-width="1.4"/><path d="M2 9h14" stroke="currentColor" stroke-dasharray="2 1.5"/>`,
  breakNode: `<path d="M2 4v10M16 4v10" stroke="currentColor" stroke-width="1.4"/><path d="M2 9h5.5M10.5 9h5.5" stroke="currentColor"/><rect x="6" y="6.5" width="2.5" height="5" fill="currentColor"/><rect x="9.5" y="6.5" width="2.5" height="5" fill="currentColor"/>`,
  toLine: `<path d="M3 14L15 4" stroke="currentColor" stroke-width="1.6"/><rect x="1.5" y="12.5" width="3.5" height="3.5" fill="currentColor"/><rect x="13" y="2" width="3.5" height="3.5" fill="currentColor"/>`,
  toCurve: `<path d="M3 14C3 4 10 12 15 4" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="1.5" y="12.5" width="3.5" height="3.5" fill="currentColor"/><rect x="13" y="2" width="3.5" height="3.5" fill="currentColor"/>`,
  cusp: `<path d="M2 15L9 6l7 9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 6L4 2M9 6l6-3" stroke="currentColor" stroke-width=".9"/><rect x="7.5" y="4.5" width="3" height="3" fill="currentColor"/>`,
  smooth: `<path d="M2 14C4 6 14 6 16 14" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 6.5h12" stroke="currentColor" stroke-width=".9"/><rect x="7.5" y="5" width="3" height="3" fill="currentColor"/><circle cx="3" cy="6.5" r="1.3" fill="currentColor"/><circle cx="15" cy="6.5" r="1.3" fill="currentColor"/>`,
  sym: `<path d="M2 14C5 6 13 6 16 14" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 6.5h10" stroke="currentColor" stroke-width=".9"/><rect x="7.5" y="5" width="3" height="3" fill="currentColor"/><circle cx="4" cy="6.5" r="1.3" fill="currentColor"/><circle cx="14" cy="6.5" r="1.3" fill="currentColor"/>`,
  auto: `<path d="M2 13c3-8 5 0 7-5s5-3 7 3" fill="none" stroke="currentColor" stroke-width="1.6"/><text x="9" y="17" font-size="6" text-anchor="middle" fill="currentColor">A</text>`,
  close: `<path d="M4 14A6 6 0 1 1 14 14" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 14h10" stroke="currentColor" stroke-dasharray="2 1.5"/>`,
  reverse: `<path d="M3 6h11l-3-3M15 12H4l3 3" fill="none" stroke="currentColor" stroke-width="1.5"/>`,
  combine: `<path d="M2 12c3-6 5-6 7 0s4 6 7 0" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="12" r="1.8" fill="currentColor"/>`,
  group: `<rect x="1.5" y="1.5" width="15" height="15" fill="none" stroke="currentColor" stroke-dasharray="2 1.5"/><rect x="4" y="4" width="5" height="5" fill="currentColor"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/>`,
  ungroup: `<rect x="2" y="2" width="6" height="6" fill="none" stroke="currentColor"/><rect x="3.5" y="3.5" width="3" height="3" fill="currentColor"/><circle cx="13" cy="13" r="3.5" fill="none" stroke="currentColor"/><circle cx="13" cy="13" r="1.6" fill="currentColor"/>`,
  dup: `<rect x="2" y="2" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="7" y="7" width="9" height="9" fill="currentColor" opacity=".55"/>`,
  del: `<path d="M4 5h10M7 5V3h4v2M5 5l1 11h6l1-11" fill="none" stroke="currentColor" stroke-width="1.4"/>`,
  exit: `<path d="M5 5l8 8M13 5l-8 8" stroke="currentColor" stroke-width="1.8"/>`,
  pause: `<rect x="4.5" y="3.5" width="3" height="11" rx=".8" fill="currentColor"/><rect x="10.5" y="3.5" width="3" height="11" rx=".8" fill="currentColor"/>`,
  play: `<path d="M5 3.5l9 5.5-9 5.5z" fill="currentColor"/>`,
  rpoli: `<path d="M3 14l2-10 6 3 5-4-1 11z" fill="currentColor" fill-opacity=".25" stroke="currentColor" stroke-width="1.4"/>`,
  rret: `<rect x="2.5" y="4" width="13" height="10" fill="currentColor" fill-opacity=".25" stroke="currentColor" stroke-width="1.4"/>`,
  relipse: `<ellipse cx="9" cy="9" rx="7" ry="5" fill="currentColor" fill-opacity=".25" stroke="currentColor" stroke-width="1.4"/>`,
  rregular: `<path d="M9 2l6.5 4.7-2.5 7.8H5L2.5 6.7z" fill="currentColor" fill-opacity=".25" stroke="currentColor" stroke-width="1.4"/>`,
  toPoly: `<path d="M9 2l6.5 4.7-2.5 7.8H5L2.5 6.7z" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="7.5" y=".5" width="3" height="3" fill="currentColor"/><rect x="14" y="5.2" width="3" height="3" fill="currentColor"/><rect x="1" y="5.2" width="3" height="3" fill="currentColor"/>`,
  hole: `<rect x="2" y="2" width="14" height="14" fill="currentColor" fill-opacity=".35" stroke="currentColor"/><circle cx="9" cy="9" r="3.5" fill="#1b1d22" stroke="currentColor"/>`,
  newRegion: `<rect x="2" y="4" width="11" height="11" fill="none" stroke="currentColor" stroke-dasharray="2 1.5"/><path d="M14 1v6M11 4h6" stroke="#3fae5a" stroke-width="2"/>`
};
const svgI = (k) => `<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">${I[k] ?? ""}</svg>`;
let vbarEl = null;
export function renderVBar(ui, force = false) {
  const show = ui.editing && isVec(ui.tool);
  if (!show) { if (vbarEl) { vbarEl.remove(); vbarEl = null; layoutVBar(); } return; }
  const host = document.getElementById("interface") ?? document.body;
  if (!vbarEl || !vbarEl.isConnected) { vbarEl = document.createElement("div"); vbarEl.id = "atlas-vbar"; host.appendChild(vbarEl);
    vbarEl.addEventListener("pointerdown", (e) => e.stopPropagation());
    vbarEl.addEventListener("click", (e) => { const b = e.target.closest("[data-vact]"); if (!b || b.disabled) return; e.preventDefault(); const ds = { ...b.dataset }; if (ds.vact === "layer") { ui.useTool(ds.v); return; } if (ui.tool === "vreg") regAction(ui, ds.vact, ds); else if (ui.tool === "vwall" && !["tool", "sides", "pause", "exit"].includes(ds.vact)) wallAction(ui, ds.vact, ds); else vecAction(ui, ds.vact, ds); });
    vbarEl.addEventListener("change", (e) => { const f = e.target.closest("[data-vfield]"); if (!f) return; const ds = { v: f.value }; if (f.dataset.vfield === "sides") { vx(ui).sides = Math.max(3, Math.min(24, Number(f.value) || 6)); return; } if (f.dataset.vfield === "type") vecAction(ui, "type", ds); if (f.dataset.vfield === "wtype") wallAction(ui, "wtype", ds); });
    new ResizeObserver(() => requestAnimationFrame(layoutVBar)).observe(vbarEl); for (const id of ["ui-right", "ui-left", "sidebar"]) { const el = document.getElementById(id); if (el) new ResizeObserver(() => requestAnimationFrame(layoutVBar)).observe(el); }
    window.addEventListener("resize", layoutVBar);
    for (const t of ["keydown", "keyup"]) vbarEl.addEventListener(t, (e) => e.stopPropagation()); }
  const v = vx(ui); const sel = selIds(ui); const nn = v.nodes.length; const reg = ui.tool === "vreg";
  const key = JSON.stringify([ui.tool === "vreg" && v.reg ? shapeList(selRegion(ui) ?? {})[v.reg.si]?.type ?? null : null, !!game.paused, ui.tool, v.tool, v.rtool, sel.length, sel[0] ? routeOf(ui, sel[0])?.type : null, nn, v.reg, v.rnodes.length, ui.newRouteType, v.sides, !!v.draw, !!v.rdraw, v.wsel?.length ?? 0, v.wnodes?.length ?? 0, ui.tool === "vwall" ? wallTypeOfSel(ui) : null]);
  if (!force && v.key === key) return; v.key = key;
  const B = (act, title, icon, { on = false, dis = false, v: val = null } = {}) => `<button type="button" class="vb ${on ? "on" : ""}" data-vact="${act}" ${val != null ? `data-v="${esc(val)}"` : ""} ${dis ? "disabled" : ""} title="${esc(title)}" aria-label="${esc(title)}">${svgI(icon)}</button>`;
  const sep = `<span class="vsep"></span>`;
  let h;
  // camada: o que a edição avançada edita
  const layer = `<span class="vtitle">Edição avançada</span><div class="vlayer">${Object.entries(LAYERS).map(([k, l]) => `<button type="button" class="vlb ${ui.tool === k ? "on" : ""}" data-vact="layer" data-v="${k}">${esc(l)}</button>`).join("")}</div>${sep}`;
  const tail = (info) => `<span class="vinfo">${info}</span>${B("pause", game.paused ? "Jogo pausado: clique para retomar" : "Pausar o jogo", game.paused ? "play" : "pause", { on: !!game.paused })}${B("exit", "Sair da edição avançada", "exit")}`;
  if (ui.tool === "vwall") {
    const T = (k, title) => B("tool", title, k, { on: (v.tool === "selecao" ? "forma" : v.tool) === k, v: k }); const nw = v.wsel?.length ?? 0, nw2 = v.wnodes?.length ?? 0;
    h = `${layer}${T("forma", "Selecionar e editar: paredes e nós (pontas encostadas andam juntas)")}${sep}
      ${T("maolivre", "Mão livre")}${T("polilinha", "Polilinha: paredes seguidas")}${T("bezier", "Bézier (a curva vira várias paredes retas)")}${T("curva3", "Curva de 3 pontos")}${T("circulo", "Círculo")}${T("retangulo", "Retângulo (Shift: quadrado)")}${T("poligono", "Polígono regular")}
      <label class="vnum" title="Lados do polígono">◇<input type="number" min="3" max="24" step="1" data-vfield="sides" value="${v.sides}"></label>${sep}
      ${B("addNode", "Dividir as paredes selecionadas (nó no meio) · Ctrl + duplo clique na parede", "addNode", { dis: !(nw || nw2) })}${B("delNode", "Juntar as duas paredes do nó (apaga o nó) · duplo clique no nó", "delNode", { dis: !nw2 })}${B("joinNodes", "Juntar dois nós", "joinNodes", { dis: nw2 !== 2 })}${B("lineNodes", "Ligar dois nós com uma parede", "lineNodes", { dis: nw2 !== 2 })}${B("breakNode", "Separar as paredes no nó", "breakNode", { dis: !nw2 })}${sep}
      ${B("dup", "Duplicar", "dup", { dis: !nw })}${B("delete", "Apagar paredes", "del", { dis: !nw })}${sep}
      <label class="vsel2" title="${nw || nw2 ? "Tipo das paredes selecionadas" : "Tipo das novas paredes"}"><select data-vfield="wtype">${Object.entries(wallTypes()).map(([k, t]) => `<option value="${k}" ${wallTypeOfSel(ui) === k ? "selected" : ""}>${esc(t.label)}</option>`).join("")}</select></label>
      ${tail(wallInfo(ui))}`;
  } else if (!reg) {
    const T = (k, title) => B("tool", title, k, { on: v.tool === k, v: k });
    const nodesOn = v.tool === "forma" && nn > 0;
    h = `${layer}${T("selecao", "Seleção: objetos inteiros (grupos), mover, caixa de seleção")}${T("forma", "Forma: editar os nós (como a ferramenta Forma do Corel)")}${sep}
      ${T("maolivre", "Mão livre")}${T("polilinha", "Polilinha (trechos retos)")}${T("bezier", "Bézier: clique = canto, arraste = curva")}${T("curva3", "Curva de 3 pontos")}${T("circulo", "Círculo (centro e raio)")}${T("retangulo", "Retângulo (Shift: quadrado)")}${T("poligono", "Polígono regular")}
      <label class="vnum" title="Lados do polígono">◇<input type="number" min="3" max="24" step="1" data-vfield="sides" value="${v.sides}"></label>${sep}
      ${B("addNode", "Adicionar nó (no meio do trecho que chega ao nó selecionado) · Ctrl + duplo clique no traço", "addNode", { dis: !nodesOn })}${B("delNode", "Apagar nós selecionados · duplo clique no nó · Delete", "delNode", { dis: !nodesOn })}
      ${B("joinNodes", "Juntar dois nós (pontas)", "joinNodes", { dis: !(v.tool === "forma" && nn === 2) })}${B("lineNodes", "Ligar dois nós com uma reta", "lineNodes", { dis: !(v.tool === "forma" && nn === 2) })}${B("breakNode", "Quebrar a rota no nó", "breakNode", { dis: !nodesOn })}${sep}
      ${B("toLine", "Converter trecho em reta", "toLine", { dis: !nodesOn })}${B("toCurve", "Converter trecho em curva", "toCurve", { dis: !nodesOn })}${B("cusp", "Nó cúspide (alças independentes)", "cusp", { dis: !nodesOn })}${B("smooth", "Nó suave (alças alinhadas)", "smooth", { dis: !nodesOn })}${B("sym", "Nó simétrico (alças iguais)", "sym", { dis: !nodesOn })}${B("auto", "Nó automático (suaviza sozinho)", "auto", { dis: !nodesOn })}${sep}
      ${B("close", "Fechar / abrir a curva", "close", { dis: !sel.length })}${B("reverse", "Inverter o sentido", "reverse", { dis: !sel.length })}${B("combine", "Combinar: une as selecionadas numa rota", "combine", { dis: sel.length < 2 })}${B("group", "Agrupar", "group", { dis: sel.length < 2 })}${B("ungroup", "Desagrupar", "ungroup", { dis: !sel.length })}${B("dup", "Duplicar", "dup", { dis: !sel.length })}${B("delRoutes", "Apagar rotas selecionadas", "del", { dis: !sel.length })}${sep}
      <label class="vsel2" title="${sel.length ? "Tipo das rotas selecionadas" : "Tipo das novas rotas"}"><select data-vfield="type">${Object.entries(ROUTE_TYPES).map(([k, t]) => `<option value="${k}" ${(sel.length ? (routeOf(ui, sel[0])?.type ?? "estrada") : (ui.newRouteType ?? "estrada")) === k ? "selected" : ""}>${esc(t.label)}</option>`).join("")}</select></label>
      <span class="vinfo">${sel.length ? `${sel.length} rota(s)` : ""}${nn ? ` · ${nn} nó(s)` : ""}</span>${B("pause", game.paused ? "Jogo pausado: clique para retomar" : "Pausar o jogo", game.paused ? "play" : "pause", { on: !!game.paused })}${B("exit", "Sair da edição avançada", "exit")}`;
  } else {
    const T = (k, title) => B("rtool", title, k, { on: v.rtool === k, v: k });
    const pol = (() => { if (!v.reg) return false; const r = ui.scene.regions?.get?.(v.reg.rid); const s = r ? shapeList(r)[v.reg.si] : null; return s?.type === "polygon"; })();
    const rn = ui.scene.regions?.get?.(v.reg?.rid)?.name;
    h = `${layer}${T("forma", "Forma: selecionar e editar nós")}${sep}${T("rpoli", "Polígono livre")}${T("rret", "Retângulo (Shift: quadrado)")}${T("relipse", "Elipse (Shift: círculo)")}${T("rregular", "Polígono regular")}
      <label class="vnum" title="Lados do polígono">◇<input type="number" min="3" max="24" step="1" data-vfield="sides" value="${v.sides}"></label>${sep}
      ${B("addNode", "Adicionar nó (no meio do trecho que chega ao nó selecionado) · Ctrl + duplo clique na borda", "addNode", { dis: !v.rnodes.length })}${B("delNode", "Apagar nós · duplo clique no nó · Delete", "delNode", { dis: !(pol && v.rnodes.length) })}${B("toPoly", "Converter em curvas (retângulo, círculo, elipse → nós editáveis)", "toPoly", { dis: !v.reg || pol })}${sep}
      ${B("toLine", "Converter trecho em reta", "toLine", { dis: !(pol && v.rnodes.length) })}${B("toCurve", "Converter trecho em curva", "toCurve", { dis: !(pol && v.rnodes.length) })}${B("cusp", "Nó cúspide (alças independentes)", "cusp", { dis: !(pol && v.rnodes.length) })}${B("smooth", "Nó suave (alças alinhadas)", "smooth", { dis: !(pol && v.rnodes.length) })}${B("sym", "Nó simétrico (alças iguais)", "sym", { dis: !(pol && v.rnodes.length) })}${B("auto", "Nó automático", "auto", { dis: !(pol && v.rnodes.length) })}${sep}
      ${B("hole", "Buraco: a forma recorta a Região", "hole", { dis: !v.reg })}${B("delShape", "Apagar a forma", "del", { dis: !v.reg })}${B("newRegion", "Desenhar uma nova Região (sem nenhuma selecionada, as novas formas criam Regiões)", "newRegion", { on: !v.reg })}
      <span class="vinfo">${rn ? `${esc(rn)} · forma ${v.reg.si + 1}` : "nova forma → nova Região"}${v.rnodes.length ? ` · ${v.rnodes.length} nó(s)` : ""}</span>${B("pause", game.paused ? "Jogo pausado: clique para retomar" : "Pausar o jogo", game.paused ? "play" : "pause", { on: !!game.paused })}${B("exit", "Sair da edição avançada", "exit")}`;
  }
  vbarEl.innerHTML = h; layoutVBar();
}
/** A barra fica no alto, entre os botões da esquerda e a barra lateral da direita (que pode estar aberta ou fechada). */
export function layoutVBar() {
  if (!vbarEl?.isConnected) { document.body.style.removeProperty("--atlas-vbar-h"); return; }
  const c1 = document.getElementById("ui-left-column-1") ?? document.getElementById("scene-controls"); const right = document.getElementById("ui-right") ?? document.getElementById("sidebar");
  const L = Math.round((c1?.getBoundingClientRect().right ?? 80) + 8); const R = Math.round(right ? right.getBoundingClientRect().left - 8 : window.innerWidth - 8);
  vbarEl.style.left = `${L}px`; vbarEl.style.width = `${Math.max(260, R - L)}px`;
  document.body.style.setProperty("--atlas-vbar-h", `${vbarEl.offsetHeight + 10}px`);
}
