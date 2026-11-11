// Edição avançada de Paredes (Walls do Foundry), no mesmo jeito das rotas:
// nós = pontas das paredes (pontas encostadas andam juntas), trechos = paredes.
// Desenhar com polilinha, Bézier, curva de 3 pontos, círculo, retângulo, polígono ou mão livre: curvas viram várias paredes retas.
import { MODULE_ID } from "./config.js";
import { pushWallUndo } from "./data.js";
import { bezierSegs } from "./geom.js";
import { snapPoint, snapMode } from "./editor.js";
import { vx, bezPoint, openMenu, renderVBar } from "./vector.js";

const dd = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const K = (p) => `${Math.round(p[0])},${Math.round(p[1])}`;

/** Tipos de parede (como as ferramentas de parede do Foundry). */
export function wallTypes() {
  const S = globalThis.CONST?.WALL_SENSE_TYPES ?? { NONE: 0, LIMITED: 10, NORMAL: 20, PROXIMITY: 30 }; const M = globalThis.CONST?.WALL_MOVEMENT_TYPES ?? { NONE: 0, NORMAL: 20 }; const D = globalThis.CONST?.WALL_DOOR_TYPES ?? { NONE: 0, DOOR: 1, SECRET: 2 };
  return {
    normal: { label: "Normal", data: { move: M.NORMAL, sight: S.NORMAL, light: S.NORMAL, sound: S.NORMAL, door: D.NONE } },
    terreno: { label: "Terreno", data: { move: M.NORMAL, sight: S.LIMITED, light: S.LIMITED, sound: S.LIMITED, door: D.NONE } },
    invisivel: { label: "Invisível", data: { move: M.NORMAL, sight: S.NONE, light: S.NONE, sound: S.NONE, door: D.NONE } },
    eterea: { label: "Etérea", data: { move: M.NONE, sight: S.NORMAL, light: S.NORMAL, sound: S.NORMAL, door: D.NONE } },
    janela: { label: "Janela", data: { move: M.NORMAL, sight: S.PROXIMITY ?? S.NORMAL, light: S.PROXIMITY ?? S.NORMAL, sound: S.NORMAL, door: D.NONE } },
    porta: { label: "Porta", data: { move: M.NORMAL, sight: S.NORMAL, light: S.NORMAL, sound: S.NORMAL, door: D.DOOR } },
    secreta: { label: "Porta secreta", data: { move: M.NORMAL, sight: S.NORMAL, light: S.NORMAL, sound: S.NORMAL, door: D.SECRET } }
  };
}
function typeOfWall(w) { const T = wallTypes(); for (const [k, t] of Object.entries(T)) if (Object.entries(t.data).every(([f, v]) => (w[f] ?? 0) === v)) return k; return ""; }
const wallsOf = (sc) => sc?.walls?.contents ?? [...(sc?.walls ?? [])];
const plain = (w) => { const o = w.toObject?.() ?? foundry.utils.deepClone(w); o._id ??= w.id; return o; };
const ends = (w) => [[w.c[0], w.c[1]], [w.c[2], w.c[3]]];

/* ---------- gravar (com desfazer) ---------- */
async function wallOps(ui, { create = [], update = [], remove = [] }) {
  const sc = ui.scene; const before = update.map(u => plain(sc.walls.get(u._id))).filter(Boolean); const gone = remove.map(id => plain(sc.walls.get(id))).filter(Boolean);
  let made = [];
  try {
    if (update.length) await sc.updateEmbeddedDocuments("Wall", update);
    if (remove.length) await sc.deleteEmbeddedDocuments("Wall", remove);
    if (create.length) made = (await sc.createEmbeddedDocuments("Wall", create)).map(w => w.id);
  } catch (err) { console.error(`${MODULE_ID} | paredes`, err); globalThis.ui?.notifications?.error("Atlas: não foi possível mudar as paredes."); }
  pushWallUndo(sc, { created: made, before, deleted: gone });
  return made;
}

/* ---------- o que está sob o mouse ---------- */
function nearNode(ui, sx, sy, px = 9) { let best = null, bd = px; for (const w of wallsOf(ui.scene)) for (const p of ends(w)) { const q = ui.w2s(p[0], p[1]); const d = Math.hypot(q.x - sx, q.y - sy); if (d < bd) { bd = d; best = [p[0], p[1]]; } } return best; }
function nearWall(ui, sx, sy, px = 7) {
  let best = null, bd = px;
  for (const w of wallsOf(ui.scene)) { const a = ui.w2s(w.c[0], w.c[1]), b = ui.w2s(w.c[2], w.c[3]); const dx = b.x - a.x, dy = b.y - a.y; const L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((sx - a.x) * dx + (sy - a.y) * dy) / L2)); const d = Math.hypot(sx - a.x - t * dx, sy - a.y - t * dy); if (d < bd) { bd = d; best = { id: w.id, t }; } }
  return best;
}
function snapWall(ui, sx, sy, skip = []) {
  const n = nearNode(ui, sx, sy, 10); if (n && !skip.some(s => dd(s, n) < 0.5)) return { x: n[0], y: n[1], node: true };
  const w = ui.s2w(sx, sy); const s = snapPoint(w.x, w.y, snapMode()); return { x: s.x, y: s.y };
}

/* ---------- eventos ---------- */
export function wallDown(ui, e, W) {
  const v = vx(ui); v.wsel ??= []; v.wnodes ??= [];
  const n = nearNode(ui, e.clientX, e.clientY);
  if (n) { const has = v.wnodes.some(p => dd(p, n) < 0.5);
    if (e.shiftKey) v.wnodes = has ? v.wnodes.filter(p => dd(p, n) >= 0.5) : [...v.wnodes, n]; else if (!has) v.wnodes = [n];
    ui.vdrag = { kind: "wnodes", w0: W, dx: 0, dy: 0, moved: false, lead: n }; ui.refresh(); return true; }
  const hw = nearWall(ui, e.clientX, e.clientY);
  if (hw) { const has = v.wsel.includes(hw.id);
    if (e.shiftKey) v.wsel = has ? v.wsel.filter(x => x !== hw.id) : [...v.wsel, hw.id]; else if (!has) { v.wsel = [hw.id]; v.wnodes = []; }
    ui.vdrag = { kind: "wmove", w0: W, dx: 0, dy: 0, moved: false }; ui.refresh(); return true; }
  ui.vdrag = { kind: "wmarq", x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, add: e.shiftKey, moved: false }; return true;
}
export function wallMove(ui, e) {
  const d = ui.vdrag; const w = ui.s2w(e.clientX, e.clientY);
  if (d.kind === "wmarq") { d.x1 = e.clientX; d.y1 = e.clientY; d.moved = d.moved || Math.hypot(d.x1 - d.x0, d.y1 - d.y0) > 4; ui.refreshMap(); return; }
  d.dx = w.x - d.w0[0]; d.dy = w.y - d.w0[1]; if (e.shiftKey) { if (Math.abs(d.dx) > Math.abs(d.dy)) d.dy = 0; else d.dx = 0; }
  else if (d.kind === "wnodes" && d.lead) { const q = ui.w2s(d.lead[0] + d.dx, d.lead[1] + d.dy); const s = snapWall(ui, q.x, q.y, vx(ui).wnodes); if (s.node) { d.dx = s.x - d.lead[0]; d.dy = s.y - d.lead[1]; } }
  d.moved = d.moved || Math.hypot(d.dx, d.dy) * (ui.zoom || 1) > 2; ui.refreshMap();
}
/** Paredes com o arraste aplicado: { id: c } */
function draggedC(ui, d) {
  const v = vx(ui); const out = {}; if (!d?.moved) return out;
  const movePts = d.kind === "wnodes" ? v.wnodes : (() => { const pts = []; for (const w of wallsOf(ui.scene)) if (v.wsel.includes(w.id)) pts.push(...ends(w)); return pts; })();
  const hit = (p) => movePts.some(m => dd(m, p) < 0.5);
  for (const w of wallsOf(ui.scene)) { const [a, b] = ends(w); const ma = hit(a), mb = hit(b); if (!ma && !mb) continue;
    out[w.id] = [a[0] + (ma ? d.dx : 0), a[1] + (ma ? d.dy : 0), b[0] + (mb ? d.dx : 0), b[1] + (mb ? d.dy : 0)].map(Math.round); }
  return out;
}
export async function wallUp(ui, e, d) {
  const v = vx(ui);
  if (d.kind === "wmarq") { if (!d.moved) { if (!d.add) { v.wsel = []; v.wnodes = []; } ui.refresh(); return; }
    const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1); const inside = (p) => { const q = ui.w2s(p[0], p[1]); return q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1; };
    const ws = wallsOf(ui.scene).filter(w => ends(w).every(inside)).map(w => w.id); const ns = []; for (const w of wallsOf(ui.scene)) for (const p of ends(w)) if (inside(p) && !ns.some(q => dd(q, p) < 0.5)) ns.push(p);
    v.wsel = d.add ? [...new Set([...v.wsel, ...ws])] : ws; v.wnodes = d.add ? [...v.wnodes, ...ns] : ns; ui.refresh(); return; }
  if (!d.moved) { ui.refreshMap(); return; }
  const cs = draggedC(ui, d); const update = Object.entries(cs).map(([_id, c]) => ({ _id, c }));
  if (d.kind === "wnodes") v.wnodes = v.wnodes.map(p => [Math.round(p[0] + d.dx), Math.round(p[1] + d.dy)]);
  await wallOps(ui, { update }); ui.refresh();
}
export function wallDbl(ui, e) {
  const v = vx(ui); e.preventDefault();
  const n = nearNode(ui, e.clientX, e.clientY); if (n) { v.wnodes = [n]; return wallAction(ui, "delNode"); }
  if (!(e.ctrlKey || e.metaKey)) return;
  const hw = nearWall(ui, e.clientX, e.clientY, 10); if (!hw) return; const w = ui.scene.walls.get(hw.id); if (!w) return;
  const p = [Math.round(w.c[0] + (w.c[2] - w.c[0]) * hw.t), Math.round(w.c[1] + (w.c[3] - w.c[1]) * hw.t)]; splitWalls(ui, [{ id: w.id, p }]);
}
async function splitWalls(ui, list) {
  const update = [], create = [];
  for (const { id, p } of list) { const w = ui.scene.walls.get(id); if (!w) continue; const o = plain(w); delete o._id;
    update.push({ _id: id, c: [w.c[0], w.c[1], p[0], p[1]] }); create.push({ ...o, c: [p[0], p[1], w.c[2], w.c[3]] }); }
  if (!update.length) return; await wallOps(ui, { update, create }); const v = vx(ui); v.wnodes = list.map(x => x.p); ui.refresh();
}
export function wallContext(ui, e) {
  const v = vx(ui); v.wsel ??= []; v.wnodes ??= [];
  const n = nearNode(ui, e.clientX, e.clientY); if (n && !v.wnodes.some(p => dd(p, n) < 0.5)) v.wnodes = [n];
  const hw = n ? null : nearWall(ui, e.clientX, e.clientY); if (hw && !v.wsel.includes(hw.id)) { v.wsel = [hw.id]; v.wnodes = []; }
  ui.refresh(); openMenu(ui, e.clientX, e.clientY, "walls");
}
export function wallKey(ui, e) {
  const k = e.key; const v = vx(ui);
  if (e.ctrlKey || e.metaKey) { const a = { c: "copy", x: "cut", v: "paste", d: "dup", a: "selAll" }[k.toLowerCase()]; if (a) { e.preventDefault(); e.stopPropagation(); wallAction(ui, a); return true; } return false; }
  if (k === "Delete" || k === "Backspace") { e.preventDefault(); e.stopPropagation(); if (v.wnodes?.length && !v.wsel?.length) wallAction(ui, "delNode"); else wallAction(ui, "delete"); return true; }
  if (k === "Escape" && (v.wsel?.length || v.wnodes?.length)) { v.wsel = []; v.wnodes = []; e.preventDefault(); e.stopPropagation(); ui.refresh(); return true; }
  return false;
}

/* ---------- ações ---------- */
export async function wallAction(ui, act, ds = {}) {
  const v = vx(ui); v.wsel ??= []; v.wnodes ??= []; const sc = ui.scene; const W = wallsOf(sc);
  const touching = (p) => W.filter(w => ends(w).some(q => dd(q, p) < 0.5));
  switch (act) {
    case "wtype": { ui.wallType = ds.v; const T = wallTypes()[ds.v]; if (!T) return; const ids = new Set(v.wsel); for (const p of v.wnodes) for (const w of touching(p)) ids.add(w.id);
      if (ids.size) await wallOps(ui, { update: [...ids].map(_id => ({ _id, ...T.data })) }); ui.refresh(); return; }
    case "addNode": { const ids = new Set(v.wsel); for (const p of v.wnodes) for (const w of touching(p)) ids.add(w.id); const list = [...ids].map(id => { const w = sc.walls.get(id); return { id, p: [Math.round((w.c[0] + w.c[2]) / 2), Math.round((w.c[1] + w.c[3]) / 2)] }; });
      return splitWalls(ui, list); }
    case "delNode": { // nó com duas paredes: vira uma parede só; nó de ponta: a parede sai
      const update = [], remove = new Set();
      for (const p of v.wnodes) { const ws = touching(p).filter(w => !remove.has(w.id)); if (ws.length === 2) { const [a, b] = ws; const oa = ends(a).find(q => dd(q, p) >= 0.5), ob = ends(b).find(q => dd(q, p) >= 0.5); if (!oa || !ob) continue; update.push({ _id: a.id, c: [oa[0], oa[1], ob[0], ob[1]] }); remove.add(b.id); }
        else if (ws.length === 1) remove.add(ws[0].id); }
      await wallOps(ui, { update, remove: [...remove] }); v.wnodes = []; v.wsel = v.wsel.filter(id => !remove.has(id)); ui.refresh(); return; }
    case "joinNodes": { if (v.wnodes.length !== 2) { globalThis.ui?.notifications?.info("Atlas: selecione dois nós (Shift soma)."); return; } const [p, q] = v.wnodes; const m = [Math.round((p[0] + q[0]) / 2), Math.round((p[1] + q[1]) / 2)];
      const update = []; for (const w of W) { const [a, b] = ends(w); const fa = dd(a, p) < 0.5 || dd(a, q) < 0.5, fb = dd(b, p) < 0.5 || dd(b, q) < 0.5; if (!fa && !fb) continue; update.push({ _id: w.id, c: [...(fa ? m : a), ...(fb ? m : b)] }); }
      await wallOps(ui, { update }); v.wnodes = [m]; ui.refresh(); return; }
    case "lineNodes": { if (v.wnodes.length !== 2) return; const [p, q] = v.wnodes; const T = wallTypes()[ui.wallType ?? "normal"]; await wallOps(ui, { create: [{ c: [p[0], p[1], q[0], q[1]], ...T.data }] }); ui.refresh(); return; }
    case "breakNode": { // separa as paredes no nó: cada uma fica com a sua ponta (afastadas 1 px na direção da própria parede)
      const update = []; for (const p of v.wnodes) for (const w of touching(p)) { const [a, b] = ends(w); const atA = dd(a, p) < 0.5; const o = atA ? b : a; const L = dd(a, b) || 1; const np = [Math.round(p[0] + (o[0] - p[0]) / L * 2), Math.round(p[1] + (o[1] - p[1]) / L * 2)]; update.push({ _id: w.id, c: atA ? [...np, ...b] : [...a, ...np] }); }
      await wallOps(ui, { update }); v.wnodes = []; ui.refresh(); return; }
    case "copy": case "cut": { if (!v.wsel.length) return; ui.wclip = W.filter(w => v.wsel.includes(w.id)).map(plain); if (act === "cut") { await wallOps(ui, { remove: [...v.wsel] }); v.wsel = []; } ui.refresh(); return; }
    case "paste": case "dup": { const src = act === "dup" ? W.filter(w => v.wsel.includes(w.id)).map(plain) : ui.wclip; if (!src?.length) return; const off = (sc.grid?.size ?? 100) / 2;
      const create = src.map(o => { const c = { ...o }; delete c._id; c.c = [o.c[0] + off, o.c[1] + off, o.c[2] + off, o.c[3] + off]; return c; }); if (act === "paste") ui.wclip = create.map(c => ({ ...c }));
      v.wsel = await wallOps(ui, { create }); v.wnodes = []; ui.refresh(); return; }
    case "delete": { const ids = [...v.wsel]; if (!ids.length) return; await wallOps(ui, { remove: ids }); v.wsel = []; v.wnodes = []; ui.refresh(); return; }
    case "selAll": v.wsel = W.map(w => w.id); ui.refresh(); return;
  }
}
/** Desenho pronto (nós de curva) → paredes retas. */
export async function wallsFromRoute(ui, r) {
  const step = Math.max(6, (ui.scene.grid?.size ?? 100) / 4); const pts = [];
  for (const s of bezierSegs(r.points, r.handles)) { pts.push(s[0]); const off = (q) => { const dx = s[3][0] - s[0][0], dy = s[3][1] - s[0][1]; const L = Math.hypot(dx, dy) || 1; return Math.abs((q[0] - s[0][0]) * dy - (q[1] - s[0][1]) * dx) / L; }; const straight = (dd(s[0], s[1]) < 0.5 && dd(s[2], s[3]) < 0.5) || (off(s[1]) < 0.6 && off(s[2]) < 0.6); if (straight) continue; const L = dd(s[0], s[1]) + dd(s[1], s[2]) + dd(s[2], s[3]); const n = Math.max(3, Math.min(32, Math.ceil(L / step))); for (let j = 1; j < n; j++) pts.push(bezPoint(s, j / n)); }
  pts.push(r.points[r.points.length - 1]);
  const T = wallTypes()[ui.wallType ?? "normal"]; const P = pts.map(p => [Math.round(p[0]), Math.round(p[1])]); const create = [];
  for (let i = 1; i < P.length; i++) if (dd(P[i - 1], P[i]) >= 1) create.push({ c: [...P[i - 1], ...P[i]], ...T.data });
  const v = vx(ui); v.wsel = await wallOps(ui, { create }); v.wnodes = []; ui.refresh();
}

/* ---------- desenho na tela ---------- */
const NODE = (q, cls) => `<rect class="vnode ${cls}" x="${(q.x - 4.5).toFixed(1)}" y="${(q.y - 4.5).toFixed(1)}" width="9" height="9"/>`;
export function renderWalls(ui, svg, html) {
  const v = vx(ui); v.wsel ??= []; v.wnodes ??= []; const d = ui.vdrag; const cs = d && (d.kind === "wnodes" || d.kind === "wmove") ? draggedC(ui, d) : {};
  const seen = new Map(); const late = [];
  for (const w of wallsOf(ui.scene)) { const c = cs[w.id] ?? w.c; const a = ui.w2s(c[0], c[1]), b = ui.w2s(c[2], c[3]); const on = v.wsel.includes(w.id); const t = typeOfWall(w);
    svg.push(`<line class="vwall ${on ? "on" : ""} wt-${t || "outra"} ${w.door ? "door" : ""}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`);
    for (const [p, q] of [[[c[0], c[1]], a], [[c[2], c[3]], b]]) { const k = K(p); if (seen.has(k)) continue; seen.set(k, 1); const sel = v.wnodes.some(n => dd(n, p) < 0.5 || (d?.kind === "wnodes" && d.moved && dd([n[0] + d.dx, n[1] + d.dy], p) < 0.5)); late.push(NODE(q, sel ? "on" : "wn")); } }
  for (const l of late) svg.push(l);
  if (d?.kind === "wmarq" && d.moved) svg.push(`<rect class="vmarq" x="${Math.min(d.x0, d.x1)}" y="${Math.min(d.y0, d.y1)}" width="${Math.abs(d.x1 - d.x0)}" height="${Math.abs(d.y1 - d.y0)}"/>`);
}
export function wallInfo(ui) { const v = vx(ui); const n = v.wsel?.length ?? 0, m = v.wnodes?.length ?? 0; return `${n ? `${n} parede(s)` : ""}${m ? `${n ? " · " : ""}${m} nó(s)` : ""}`; }
export function wallTypeOfSel(ui) { const v = vx(ui); const w = ui.scene?.walls?.get?.(v.wsel?.[0]); return w ? typeOfWall(w) : (ui.wallType ?? "normal"); }
