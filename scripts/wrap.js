// Mundo que dá a volta: no globo completo (360° de longitude) e no mundo em anel, quem sai pela borda leste entra pela oeste.
// As rotas guardam o traçado "desenrolado" (pontos podem passar da borda); o desenho repete o mundo uma volta para cada lado.
import { mapOf } from "./data.js";
import { isWorld, normWorld, sceneRect, lonLat, xyOf, greatCircle } from "./world.js";
import { curvePoints } from "./geom.js";

/** { X, W, R, g } quando o mapa dá a volta; null nos outros. */
export function wrapOf(sc, m = mapOf(sc)) {
  if (!sc || !isWorld(m)) return null; const wd = normWorld(m.world ?? {}); const R = sceneRect(sc); if (!(R.W > 0)) return null;
  const full = wd.model === "globo" && Math.abs(wd.globo.lonE - wd.globo.lonW) >= 359.5;
  if (!full && wd.model !== "anel") return null;
  return { X: R.X, W: R.W, R, g: wd.model === "globo" ? wd.globo : null };
}
/** Contexto do globo (para o caminho mais curto sobre a esfera), mesmo sem dar a volta. */
export function globeOf(sc, m = mapOf(sc)) {
  if (!sc || !isWorld(m)) return null; const wd = normWorld(m.world ?? {}); if (wd.model !== "globo") return null;
  return { R: sceneRect(sc), g: wd.globo, S: wrapOf(sc, m) };
}
/** x trazido para dentro do mapa. */
export const wrapX = (x, S) => S ? S.X + ((((x - S.X) % S.W) + S.W) % S.W) : x;
/** x deslocado de voltas inteiras para ficar o mais perto possível de ref (lado mais curto). */
export const unwrapNear = (x, ref, S) => (S && Number.isFinite(ref)) ? x + Math.round((ref - x) / S.W) * S.W : x;
/** x do vizinho de um ponto da rota (o anterior; na primeira ponta, o seguinte). */
export const nbX = (pts, i) => (pts[i - 1] ?? pts[i + 1] ?? pts[i])?.[0];
/** Pontos desenrolados em sequência: cada um vai para o lado mais curto em relação ao anterior. */
export function unwrapPts(pts, S) { if (!S) return pts; const out = []; for (const p of pts) { const l = out[out.length - 1]; out.push(l ? [unwrapNear(p[0], l[0], S), p[1]] : [...p]); } return out; }
/** Deslocamentos (em voltas) em que uma figura de xs [a, b] aparece dentro do mapa, além do 0. */
export function copiesFor(minX, maxX, S) {
  if (!S) return []; const out = [];
  for (let k = Math.ceil((S.X - maxX) / S.W); k <= Math.floor((S.X + S.W - minX) / S.W); k++) if (k !== 0) out.push(k);
  return out;
}
export const crossesEdge = (minX, maxX, S) => !!S && (minX < S.X || maxX > S.X + S.W);

/* ---------- caminho mais curto sobre a esfera (círculo máximo) ---------- */
const D2R = Math.PI / 180;
const vec = (lon, lat) => [Math.cos(lat * D2R) * Math.cos(lon * D2R), Math.cos(lat * D2R) * Math.sin(lon * D2R), Math.sin(lat * D2R)];
/** Pontos do círculo máximo de a até b (coordenadas do mundo), com a longitude contínua (pode passar da borda). */
export function gcPoints(G, a, b, n = 0) {
  const A = lonLat(G.R, G.g, a[0], a[1]), B = lonLat(G.R, G.g, b[0], b[1]); const va = vec(A.lon, A.lat), vb = vec(B.lon, B.lat);
  const dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])); const om = Math.acos(dot);
  if (om < 1e-6) return [[...a], [...b]];
  const N = n || Math.max(8, Math.ceil(om / D2R / 1.5)); const out = []; let lon0 = A.lon; const so = Math.sin(om);
  for (let i = 0; i <= N; i++) {
    const t = i / N; const k1 = Math.sin((1 - t) * om) / so, k2 = Math.sin(t * om) / so;
    const v = [k1 * va[0] + k2 * vb[0], k1 * va[1] + k2 * vb[1], k1 * va[2] + k2 * vb[2]];
    const lat = Math.asin(Math.max(-1, Math.min(1, v[2]))) / D2R; let lon = Math.atan2(v[1], v[0]) / D2R;
    lon = lon0 + ((((lon - lon0) % 360) + 540) % 360) - 180; lon0 = lon; // contínua
    const p = xyOf(G.R, G.g, lon, lat); out.push([p.x, p.y]);
  }
  out[0] = [...a]; // a ponta de saída fica exata; a de chegada vai para a volta em que a curva chegou
  const e = out[out.length - 1]; out[out.length - 1] = [unwrapNear(b[0], e[0], { W: G.R.W }), b[1]];
  return out;
}
/** A rota usa o círculo máximo? (rotas aéreas no globo, a menos que desligado) */
export const isGc = (r, G) => !!G && (r.gc === true || (r.gc == null && r.type === "aerea"));
/** Pontos ao longo da rota como desenhada: curva Bézier, ou círculo máximo ponto a ponto. */
export function routeLine(r, G = null, per = 8) {
  if (!isGc(r, G)) return curvePoints(r.points, r.handles, per);
  const out = [];
  for (let i = 0; i < r.points.length - 1; i++) {
    let a = r.points[i]; if (out.length) a = out[out.length - 1];
    const seg = gcPoints(G, a, [r.points[i + 1][0] + (a[0] - r.points[i][0]), r.points[i + 1][1]]);
    if (out.length) seg.shift(); out.push(...seg);
  }
  return out;
}
/** Trechos [p0, c1, c2, p1] retos a partir de uma polilinha (para desenhar com o mesmo código das curvas). */
export const polySegs = (P) => P.slice(1).map((p, i) => [P[i], P[i], p, p]);

/** Comprimento de um caminho medido sobre a esfera (nas unidades do raio do globo), cortando cada trecho em passos de até 1°. */
export function pathKm(G, pts) {
  const st = G.R.W / 360; let L = 0;
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / st)); let p = lonLat(G.R, G.g, a[0], a[1]);
    for (let k = 1; k <= n; k++) { const q = lonLat(G.R, G.g, a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n); L += greatCircle(G.g, p, q); p = q; } }
  return L;
}

/* ---------- costuras: rotas desenhadas param na borda e continuam do lado oposto ---------- */
/** x encostado na borda (dentro de tol) vira exatamente a borda; side = "l" | "r" | null. */
export function edgeSnap(S, x, tol) {
  if (!S) return { x, side: null };
  if (x <= S.X + tol) return { x: S.X, side: "l" };
  if (x >= S.X + S.W - tol) return { x: S.X + S.W, side: "r" };
  return { x, side: null };
}
const onEdge = (S, x) => S && (Math.abs(x - S.X) < 1.5 ? "l" : Math.abs(x - S.X - S.W) < 1.5 ? "r" : null);
/** Pontas de rota na borda: cada uma tem um "ponto fantasma" no lado oposto, de onde a rota pode continuar. */
export function seamGhosts(S, routes) {
  if (!S) return []; const ends = [];
  for (const r of routes) { const P = r.points ?? []; if (P.length < 2) continue; for (const [k, p] of [[0, P[0]], [1, P[P.length - 1]]]) { const s = onEdge(S, p[0]); if (s) ends.push({ id: r.id, k, side: s, y: p[1] }); } }
  const out = [];
  for (const e of ends) { const ox = e.side === "r" ? S.X : S.X + S.W; const op = e.side === "r" ? "l" : "r";
    const linked = ends.some(f => f.side === op && Math.abs(f.y - e.y) < 3);
    out.push({ x: ox, y: e.y, from: e.id, side: op, linked }); }
  return out;
}
/** Uma polilinha "desenrolada" (pontos além da borda) vira pedaços dentro do mapa, cortados exatamente nas bordas. */
export function seamPieces(S, pts) {
  if (!S || pts.length < 2) return [pts];
  const cell = (x) => Math.floor((x - S.X) / S.W - 1e-9); const pieces = []; let cur = [];
  const put = (p, c) => cur.push([Math.round(p[0] - c * S.W), Math.round(p[1])]);
  let c0 = cell(pts[0][0]); put(pts[0], c0);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]; let ca = cell(a[0]); const cb = cell(b[0]);
    while (ca !== cb) { const dir = cb > ca ? 1 : -1; const bx = S.X + (dir > 0 ? ca + 1 : ca) * S.W; const t = (bx - a[0]) / ((b[0] - a[0]) || 1); const y = a[1] + t * (b[1] - a[1]);
      put([bx, y], ca); pieces.push(cur); cur = []; ca += dir; put([bx, y], ca); }
    put(b, cb);
  }
  pieces.push(cur);
  return pieces.filter(p => p.length >= 2 && Math.hypot(p[p.length - 1][0] - p[0][0], p[p.length - 1][1] - p[0][1]) > 1);
}
/** A rota passa da borda? (pontos guardados fora do mapa) */
export const crossesStored = (S, pts) => !!S && pts.some(p => p[0] < S.X - 1.5 || p[0] > S.X + S.W + 1.5);
