// Geometria: formas das Regiões, linhas das rotas.

function rot(px, py, cx, cy, deg) {
  if (!deg) return [px, py];
  const a = -deg * Math.PI / 180, dx = px - cx, dy = py - cy;
  return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
}
function inPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length / 2 - 1; i < pts.length / 2; j = i++) {
    const xi = pts[i * 2], yi = pts[i * 2 + 1], xj = pts[j * 2], yj = pts[j * 2 + 1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
  }
  return inside;
}
function shapeContains(s, x, y) {
  switch (s.type) {
    case "rectangle": { const cx = s.x + s.width / 2, cy = s.y + s.height / 2; const [px, py] = rot(x, y, cx, cy, s.rotation); return px >= s.x && px <= s.x + s.width && py >= s.y && py <= s.y + s.height; }
    case "circle": return Math.hypot(x - s.x, y - s.y) <= s.radius;
    case "ellipse": { const [px, py] = rot(x, y, s.x, s.y, s.rotation); return ((px - s.x) / s.radiusX) ** 2 + ((py - s.y) / s.radiusY) ** 2 <= 1; }
    case "polygon": return inPoly(s.points ?? [], x, y);
    default: return false;
  }
}
export function shapesOf(region) { const s = region?.shapes; return (s?.contents ?? (Array.isArray(s) ? s : s ? [...s] : [])).map(x => x.toObject?.() ?? x); }

export function regionContains(region, x, y) {
  const shapes = shapesOf(region);
  if (shapes.length && shapes.every(s => ["rectangle", "circle", "ellipse", "polygon"].includes(s.type))) {
    const solid = shapes.filter(s => !s.hole), holes = shapes.filter(s => s.hole);
    return solid.some(s => shapeContains(s, x, y)) && !holes.some(s => shapeContains(s, x, y));
  }
  try { const r = region.testPoint?.({ x, y, elevation: 0 }, 0); if (typeof r === "boolean") return r; } catch (e) { /* */ }
  return false;
}

/* ---------- linhas ---------- */
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export function polyLength(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]); return L; }
/** Ponto a uma distância (px) ao longo da linha. */
export function pointAt(pts, d) {
  if (!pts.length) return [0, 0];
  for (let i = 1; i < pts.length; i++) {
    const l = dist(pts[i - 1], pts[i]);
    if (d <= l) { const t = l ? d / l : 0; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; }
    d -= l;
  }
  return pts[pts.length - 1];
}
/** Pontos a cada `step` px (inclui as pontas). */
export function sample(pts, step) {
  const L = polyLength(pts); const n = Math.max(1, Math.ceil(L / step)); const out = [];
  for (let i = 0; i <= n; i++) out.push(pointAt(pts, L * i / n));
  return out;
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1]; const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy), t };
}
/** Distância de um ponto à linha, e o índice do segmento mais próximo. */
export function nearestOnPoly(pts, p) {
  let best = { d: Infinity, i: -1, t: 0 };
  for (let i = 1; i < pts.length; i++) { const r = segDist(p, pts[i - 1], pts[i]); if (r.d < best.d) best = { d: r.d, i, t: r.t }; }
  return best;
}
/** Caminho suave para SVG (Catmull-Rom → Bézier). */
export function smoothPath(pts) {
  if (pts.length < 2) return "";
  if (pts.length === 2) return `M${pts[0][0]} ${pts[0][1]}L${pts[1][0]} ${pts[1][1]}`;
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}
/** Pontos da curva suave (para medir e animar no mesmo traçado que é desenhado). */
export function smoothPoints(pts, per = 8) {
  if (pts.length < 3) return pts.map(p => [...p]);
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    for (let k = 0; k < per; k++) {
      const t = k / per, u = 1 - t;
      out.push([u * u * u * p1[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p2[0], u * u * u * p1[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p2[1]]);
    }
  }
  out.push([...pts[pts.length - 1]]);
  return out;
}

/* ---------- curvas Bézier das rotas (alças como num editor de vetores) ---------- */
/**
 * Alça de um ponto: { a: ângulo em graus, l1: comprimento da alça de entrada, l2: da saída, a2?: ângulo da saída quando "quebrada" }.
 * Sem alça (null), o ponto é automático (curva suave, como antes).
 */
export function autoTangent(pts, i) { const p0 = pts[i - 1] ?? pts[i], p2 = pts[i + 1] ?? pts[i]; return [(p2[0] - p0[0]) / 6, (p2[1] - p0[1]) / 6]; }
export function handleVecs(pts, hs, i) {
  const h = hs?.[i];
  if (!h) { const t = autoTangent(pts, i); return { inV: [-t[0], -t[1]], outV: t, auto: true }; }
  const a = (h.a ?? 0) * Math.PI / 180, a2 = (h.a2 ?? h.a ?? 0) * Math.PI / 180;
  return { inV: [-Math.cos(a) * (h.l1 ?? 0), -Math.sin(a) * (h.l1 ?? 0)], outV: [Math.cos(a2) * (h.l2 ?? 0), Math.sin(a2) * (h.l2 ?? 0)], auto: false };
}
/** Trechos cúbicos [p0, c1, c2, p1] da rota, em coordenadas do mundo. */
export function bezierSegs(pts, hs = null) {
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i], p1 = pts[i + 1]; const o = handleVecs(pts, hs, i).outV, n = handleVecs(pts, hs, i + 1).inV;
    segs.push([p0, [p0[0] + o[0], p0[1] + o[1]], [p1[0] + n[0], p1[1] + n[1]], p1]);
  }
  return segs;
}
export function segsPath(segs, map = (p) => p) {
  if (!segs.length) return "";
  const f = (p) => { const q = map(p); return `${q[0].toFixed(1)} ${q[1].toFixed(1)}`; };
  return `M${f(segs[0][0])}` + segs.map(s => `C${f(s[1])} ${f(s[2])} ${f(s[3])}`).join("");
}
/** Pontos ao longo da curva (para medir distância e animar no mesmo traçado desenhado). */
export function curvePoints(pts, hs = null, per = 8) {
  if (pts.length < 2) return pts.map(p => [...p]);
  const out = [];
  for (const [p0, c1, c2, p1] of bezierSegs(pts, hs)) for (let k = 0; k < per; k++) {
    const t = k / per, u = 1 - t;
    out.push([u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0], u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1]]);
  }
  out.push([...pts[pts.length - 1]]);
  return out;
}
/** Nova alça a partir de uma alça arrastada até (x,y). side: "in" | "out"; broken: mexe só nesse lado. */
export function dragHandle(pts, hs, i, side, x, y, broken = false) {
  const p = pts[i]; const v = [x - p[0], y - p[1]]; const L = Math.hypot(v[0], v[1]);
  const cur = handleVecs(pts, hs, i); const h = hs?.[i] ? { ...hs[i] } : { a: Math.atan2(cur.outV[1], cur.outV[0]) * 180 / Math.PI, l1: Math.hypot(...cur.inV), l2: Math.hypot(...cur.outV) };
  const ang = (side === "out" ? Math.atan2(v[1], v[0]) : Math.atan2(-v[1], -v[0])) * 180 / Math.PI;
  if (broken || h.a2 != null) {
    if (h.a2 == null) h.a2 = h.a;
    if (side === "out") { h.a2 = ang; h.l2 = L; } else { h.a = ang; h.l1 = L; }
  } else { h.a = ang; if (side === "out") h.l2 = L; else h.l1 = L; }
  const out = [...(hs ?? [])]; while (out.length < pts.length) out.push(null); out[i] = { a: Math.round(h.a * 10) / 10, l1: Math.round(h.l1), l2: Math.round(h.l2), ...(h.a2 != null ? { a2: Math.round(h.a2 * 10) / 10 } : {}) };
  return out;
}
