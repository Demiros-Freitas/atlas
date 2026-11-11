// Mapa-múndi: o "modelo do mundo" (globo, disco plano, plano, anel, ilhas no céu, mundo oco).
// Cada modelo define a grade (como se mede a posição), as linhas especiais (equador, trópicos, anéis do sol),
// a borda, a luz (dia e noite) e a leitura do cursor. Tudo é desenhado por cima do mapa, na camada do Atlas.
import { esc, scaleOf, mapOf, dataOf, chainOf } from "./data.js";

export const WORLD_MODELS = {
  globo: { label: "Globo", hint: "Planeta esférico. Latitude e longitude, Equador, trópicos e círculos polares; leste e oeste se emendam. A noite é uma faixa que corre pelo mapa." },
  disco: { label: "Disco plano", hint: "Mundo em forma de disco. A posição é a distância do centro e o rumo; o sol gira sobre o disco como um holofote; a borda é muralha, cachoeira ou abismo." },
  plano: { label: "Plano (continente)", hint: "Sem curvatura: quadrícula com letras e números (como um atlas). Dia e noite iguais em todo o mapa." },
  anel: { label: "Anel", hint: "Mundo-faixa: o leste e o oeste se emendam; o norte e o sul são muralhas." },
  ilhas: { label: "Ilhas no céu", hint: "Ilhas e continentes flutuando sobre o abismo (ou o Mar Astral)." },
  oco: { label: "Mundo oco", hint: "Vive-se do lado de dentro de uma esfera, com um sol fixo no centro. Não há noite (a não ser que algo tape o sol)." }
};
export const EDGES = { muralha: "Muralha de gelo", cachoeira: "Cachoeira para o vazio", abismo: "Abismo", nevoa: "Névoa sem fim", nada: "Sem nome" };

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Configuração do mundo com todos os valores preenchidos. */
export function normWorld(w = {}) {
  const g = w.globo ?? {}, d = w.disco ?? {}, p = w.plano ?? {}, gr = w.grid ?? {}, l = w.luz ?? {};
  return {
    model: WORLD_MODELS[w.model] ? w.model : "globo", readout: w.readout !== false,
    grid: { on: gr.on !== false, step: clamp(num(gr.step, 15), 1, 90), color: gr.color || "#e8d9a8", opacity: clamp(num(gr.opacity, 0.35), 0, 1), spOpacity: clamp(num(gr.spOpacity, 0.65), 0, 1), labOpacity: clamp(num(gr.labOpacity, 0.85), 0, 1), labels: gr.labels !== false, special: gr.special !== false, cardinals: gr.cardinals !== false },
    globo: { lonW: num(g.lonW, -180), lonE: num(g.lonE, 180), latN: num(g.latN, 90), latS: num(g.latS, -90), tilt: clamp(num(g.tilt, 23.44), 0, 89), radius: Math.max(1, num(g.radius, 3959)) },
    disco: { cx: num(d.cx, 50), cy: num(d.cy, 50), r: num(d.r, 50), rings: clamp(Math.round(num(d.rings, 6)), 1, 24), spokes: clamp(Math.round(num(d.spokes, 12)), 0, 72), sunIn: clamp(num(d.sunIn, 30), 1, 99), sunOut: clamp(num(d.sunOut, 60), 1, 100), light: clamp(num(d.light, 55), 5, 200), edge: EDGES[d.edge] ? d.edge : "muralha", north: num(d.north, 0) },
    plano: { cell: Math.max(0.01, num(p.cell, 0)) || 0, letters: p.letters !== false, edge: EDGES[p.edge] ? p.edge : (w.model === "ilhas" ? "abismo" : "nada") },
    luz: { moons: l.moons !== false, on: l.on === true, dark: clamp(num(l.dark, 0.55), 0.05, 0.95), sun: l.sun !== false, atmos: l.atmos !== false, noonLon: num(l.noonLon, 0), equinox: clamp(num(l.equinox, 22), 0, 100) },
    names: { eq: w.names?.eq || "Equador", tropN: w.names?.tropN || "Trópico de Câncer", tropS: w.names?.tropS || "Trópico de Capricórnio", polN: w.names?.polN || "Círculo Polar Ártico", polS: w.names?.polS || "Círculo Polar Antártico", sunIn: w.names?.sunIn || "Trópico interno (sol de verão)", sunOut: w.names?.sunOut || "Trópico externo (sol de inverno)", edge: w.names?.edge || "" }
  };
}
export function sceneRect(sc) { const d = sc.dimensions ?? {}; return { X: d.sceneX ?? 0, Y: d.sceneY ?? 0, W: d.sceneWidth ?? sc.width ?? 0, H: d.sceneHeight ?? sc.height ?? 0 }; }
export const isWorld = (m) => m?.level === "mundo";

/* ---------- coordenadas ---------- */
const DIR8 = ["N", "NE", "L", "SE", "S", "SO", "O", "NO"];
export function fmtDeg(v, pos, neg) { const a = Math.abs(v); let D = Math.floor(a); let M = Math.round((a - D) * 60); if (M === 60) { D++; M = 0; } return `${D}°${String(M).padStart(2, "0")}′ ${v >= 0 ? pos : neg}`; }
const colName = (i) => { let s = ""; i += 1; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
function discGeom(R, wd) { const r = Math.min(R.W, R.H) / 2 * wd.r / 50; return { cx: R.X + R.W * wd.cx / 100, cy: R.Y + R.H * wd.cy / 100, r }; }
function planCell(sc, wd) { const s = scaleOf(sc); const cellU = wd.plano.cell || Math.max(s.dist * 10, 1); return { px: cellU / s.perPx, units: cellU }; }
/** Latitude/longitude de um ponto do mapa (globo). */
export function lonLat(R, g, x, y) { return { lon: g.lonW + (x - R.X) / R.W * (g.lonE - g.lonW), lat: g.latN - (y - R.Y) / R.H * (g.latN - g.latS) }; }
export function xyOf(R, g, lon, lat) { return { x: R.X + (lon - g.lonW) / (g.lonE - g.lonW) * R.W, y: R.Y + (g.latN - lat) / (g.latN - g.latS) * R.H }; }
/** Distância pela superfície do globo (haversine), na unidade do raio. */
export function greatCircle(g, a, b) { const r = Math.PI / 180; const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r; const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2; return 2 * g.radius * Math.asin(Math.min(1, Math.sqrt(h))); }

/** Texto da leitura do cursor (ou null fora do mundo). */
export function readoutAt(sc, wd, x, y) {
  const R = sceneRect(sc); const s = scaleOf(sc);
  if (wd.model === "globo" || wd.model === "oco") {
    if (x < R.X || x > R.X + R.W || y < R.Y || y > R.Y + R.H) return null; const g = wd.globo; const { lon, lat } = lonLat(R, g, x, y);
    const zone = Math.abs(lat) <= g.tilt ? "trópicos" : Math.abs(lat) >= 90 - g.tilt ? "zona polar" : "zona temperada";
    return { main: `${fmtDeg(lat, "N", "S")} · ${fmtDeg(((lon + 540) % 360) - 180, "L", "O")}`, sub: zone };
  }
  if (wd.model === "disco") {
    const D = discGeom(R, wd.disco); const dx = x - D.cx, dy = y - D.cy; const f = Math.hypot(dx, dy) / D.r;
    const brg = ((Math.atan2(dx, -dy) * 180 / Math.PI) - wd.disco.north + 720) % 360; const units = Math.hypot(dx, dy) * s.perPx;
    const zone = f > 1 ? EDGES[wd.disco.edge] : f * 100 < wd.disco.sunIn ? "centro (sob o sol de verão)" : f * 100 <= wd.disco.sunOut ? "faixa do sol" : "anéis frios";
    return { main: `${units >= 10 ? Math.round(units).toLocaleString("pt-BR") : units.toFixed(1)} ${s.units} do centro · rumo ${Math.round(brg)}° (${DIR8[Math.round(brg / 45) % 8]})`, sub: zone };
  }
  const C = planCell(sc, wd); if (x < R.X || x > R.X + R.W || y < R.Y || y > R.Y + R.H) return wd.plano.edge !== "nada" ? { main: EDGES[wd.plano.edge], sub: "" } : null;
  const ci = Math.floor((x - R.X) / C.px), cj = Math.floor((y - R.Y) / C.px);
  const ex = (x - (R.X + R.W / 2)) * s.perPx, ny = ((R.Y + R.H / 2) - y) * s.perPx; const f = (v) => v >= 10 ? Math.round(Math.abs(v)).toLocaleString("pt-BR") : Math.abs(v).toFixed(1);
  return { main: `${wd.plano.letters ? `${colName(ci)}${cj + 1}` : `${ci + 1}·${cj + 1}`}`, sub: `${f(ex)} ${s.units} ${ex >= 0 ? "L" : "O"}, ${f(ny)} ${s.units} ${ny >= 0 ? "N" : "S"} do centro` };
}

/* ---------- tempo: hora do dia e época do ano ---------- */
/** Instante "de agora" para desenhar: com o Cronos andando, o tempo corre suave entre um passo e outro. */
export function nowTime() { const cr = game.modules?.get?.("brumas-cronos"); try { const v = cr?.active ? cr.api?.now?.() : null; if (Number.isFinite(v)) return v; } catch (e) { /* */ } return Number(game.time?.worldTime) || 0; }
export function skyTime(t = nowTime()) {
  // com o Cronos (módulo irmão), o ano, a duração do dia e o equinócio vêm do calendário dele
  const cr = game.modules?.get?.("brumas-cronos"); const api = cr?.active ? cr.api : null;
  if (api?.yearInfo) { try { const Y = api.yearInfo(t); return { t, dayFrac: Y.dayFrac, yearFrac: Y.yearFrac, secDay: Y.secDay, dpy: Y.dpy, eq: Y.equinox }; } catch (e) { /* */ } }
  const Dd = game.time?.calendar?.days ?? {};
  const secDay = (num(Dd.hoursPerDay, 24) * num(Dd.minutesPerHour, 60) * num(Dd.secondsPerMinute, 60)) || 86400; const dpy = num(Dd.daysPerYear, 365) || 365;
  const day = t / secDay; return { t, dayFrac: ((day % 1) + 1) % 1, yearFrac: (((day / dpy) % 1) + 1) % 1, secDay, dpy, eq: null };
}
const eqOf = (T, pct) => T.eq ?? pct / 100;
/** Declinação do sol (graus) e longitude onde é meio-dia (globo). */
export function sunGlobe(wd, T = skyTime()) { const g = wd.globo; const decl = g.tilt * Math.sin(2 * Math.PI * (T.yearFrac - eqOf(T, wd.luz.equinox))); const lon = (((wd.luz.noonLon + (0.5 - T.dayFrac) * 360) + 540) % 360) - 180; return { decl, lon }; }
/** Posição do sol sobre o disco (px) e o raio iluminado. */
export function sunDisc(R, wd, T = skyTime()) { const D = discGeom(R, wd.disco); const k = wd.disco; const mid = (k.sunIn + k.sunOut) / 2, amp = (k.sunOut - k.sunIn) / 2;
  const rf = (mid - amp * Math.sin(2 * Math.PI * (T.yearFrac - eqOf(T, wd.luz.equinox)))) / 100; // verão do norte: o sol passa mais perto do centro
  const ang = (T.dayFrac * 360 + k.north) * Math.PI / 180;
  return { x: D.cx + Math.sin(ang) * D.r * rf, y: D.cy - Math.cos(ang) * D.r * rf, light: D.r * k.light / 100, D }; }

/* ---------- desenho ---------- */
const sunIcon = (q, s = 18) => `<g class="wsun" transform="translate(${q.x.toFixed(1)} ${q.y.toFixed(1)})"><circle r="${s * 0.42}"/>${[...Array(8)].map((_, i) => { const a = i * Math.PI / 4; return `<line x1="${(Math.cos(a) * s * 0.6).toFixed(1)}" y1="${(Math.sin(a) * s * 0.6).toFixed(1)}" x2="${(Math.cos(a) * s * 0.95).toFixed(1)}" y2="${(Math.sin(a) * s * 0.95).toFixed(1)}"/>`; }).join("")}</g>`;
/**
 * Camadas do mundo para o mapa: { under: svg (luz e grade, abaixo de tudo), html: rótulos, defs }.
 * P(x, y) converte do mapa para a tela; z = zoom; VW/VH = tamanho da tela.
 */
export function renderWorld(sc, wd, P, z, VW, VH, edit = false) {
  const R = sceneRect(sc); const svg = [], html = [], defs = []; const G = wd.grid; const sv = `--wg:${esc(G.color)};--wo:${G.opacity};--wso:${G.spOpacity};--wlo:${G.labOpacity};`; const st = `style="${sv}"`;
  const a = P(R.X, R.Y), b = P(R.X + R.W, R.Y + R.H); // retângulo do mapa na tela
  const clX = (x) => clamp(x, Math.max(a.x, 6), Math.min(b.x, VW - 6)), clY = (y) => clamp(y, Math.max(a.y, 6), Math.min(b.y, VH - 6));
  const T = skyTime(); const model = wd.model;
  // ----- luz -----
  if (wd.luz.on && model !== "oco") {
    if (model === "globo") {
      const g = wd.globo; const S = sunGlobe(wd, T); const d = Math.abs(S.decl) < 0.05 ? 0.05 * (S.decl < 0 ? -1 : 1) : S.decl; const r = Math.PI / 180; const pts = [];
      for (let lon = g.lonW; lon <= g.lonE + 1e-6; lon += (g.lonE - g.lonW) / 144) { const H = (lon - S.lon) * r; const lat = Math.atan(-Math.cos(H) / Math.tan(d * r)) / r; const p = xyOf(R, g, lon, clamp(lat, g.latS, g.latN)); const q = P(p.x, p.y); pts.push(`${q.x.toFixed(1)},${q.y.toFixed(1)}`); }
      const edgeY = d > 0 ? b.y : a.y; // noite do lado do polo sem sol
      defs.push(`<filter id="wnblur" x="-5%" y="-20%" width="110%" height="140%"><feGaussianBlur stdDeviation="${clamp(R.H * z * 0.012, 2, 40).toFixed(1)}"/></filter>`);
      svg.push(`<polygon class="wnight" filter="url(#wnblur)" style="--wd:${wd.luz.dark}" points="${a.x.toFixed(1)},${edgeY.toFixed(1)} ${pts.join(" ")} ${b.x.toFixed(1)},${edgeY.toFixed(1)}"/>`);
      if (wd.luz.sun) { const sp = xyOf(R, g, S.lon, S.decl); svg.push(sunIcon(P(sp.x, sp.y))); }
    } else if (model === "disco") {
      const S = sunDisc(R, wd, T); const q = P(S.x, S.y), c = P(S.D.cx, S.D.cy); const rl = S.light * z, rd = S.D.r * z;
      defs.push(`<radialGradient id="wsunhole"><stop offset="0" stop-color="#000"/><stop offset=".55" stop-color="#000"/><stop offset="1" stop-color="#fff"/></radialGradient><mask id="wnmask"><circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${rd.toFixed(1)}" fill="#fff"/><circle cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="${rl.toFixed(1)}" fill="url(#wsunhole)"/></mask>`);
      svg.push(`<circle class="wnight" mask="url(#wnmask)" style="--wd:${wd.luz.dark}" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${rd.toFixed(1)}"/>`);
      if (wd.luz.sun) svg.push(sunIcon(q));
    } else { // plano, anel, ilhas: o mapa todo escurece junto
      const elev = -Math.cos(2 * Math.PI * T.dayFrac); const k = clamp((0.15 - elev) / 0.4, 0, 1);
      if (k > 0.01) svg.push(`<rect class="wnight" style="--wd:${(wd.luz.dark * k).toFixed(3)}" x="${a.x.toFixed(1)}" y="${a.y.toFixed(1)}" width="${(b.x - a.x).toFixed(1)}" height="${(b.y - a.y).toFixed(1)}"/>`);
    }
  }
  // ----- atmosfera (halo nas bordas) -----
  if (wd.luz.atmos) {
    if (model === "disco") { const D = discGeom(R, wd.disco); const c = P(D.cx, D.cy); svg.push(`<circle class="watmos" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${(D.r * z).toFixed(1)}" style="stroke-width:${clamp(D.r * z * 0.05, 4, 60).toFixed(1)}px"/>`); }
    else if (model === "globo" || model === "oco") { defs.push(`<radialGradient id="watm" cx=".5" cy=".5" r=".72"><stop offset=".72" stop-color="#6fb6ff" stop-opacity="0"/><stop offset="1" stop-color="#6fb6ff" stop-opacity=".28"/></radialGradient>`); svg.push(`<rect class="watmosr" fill="url(#watm)" x="${a.x.toFixed(1)}" y="${a.y.toFixed(1)}" width="${(b.x - a.x).toFixed(1)}" height="${(b.y - a.y).toFixed(1)}"/>`); }
  }
  const done = () => ({ svg: `<g class="wworld" ${st}>${svg.join("")}</g>`, html: html.join(""), defs: defs.join("") });
  if (!G.on) return done();
  // ----- grade -----
  const line = (p, q, cls = "") => `<line class="wl ${cls}" x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${q.x.toFixed(1)}" y2="${q.y.toFixed(1)}"/>`;
  const lab = (x, y, t, cls = "", key = "") => html.push(`<span class="wlab ${cls} ${key && edit ? "ed" : ""}" ${key && edit ? `data-wname="${key}" title="Clique duplo: renomear"` : ""} style="${sv}left:${x.toFixed(1)}px;top:${y.toFixed(1)}px">${esc(t)}</span>`);
  // linhas que o mestre arrasta (área de clique larga e invisível); clique duplo renomeia
  const hitL = (p, q, key) => edit ? `<line class="whit ns" data-wline="${key}" x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${q.x.toFixed(1)}" y2="${q.y.toFixed(1)}"><title>Arraste para mudar · clique duplo: renomear</title></line>` : "";
  const hitC = (c, r, key) => edit ? `<circle class="whit rr" data-wline="${key}" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${r.toFixed(1)}"><title>Arraste para mudar · clique duplo: renomear</title></circle>` : "";
  if (model === "globo" || model === "oco") {
    const g = wd.globo; const stp = G.step;
    for (let lon = Math.ceil(g.lonW / stp) * stp; lon <= g.lonE + 1e-6; lon += stp) { const p = xyOf(R, g, lon, g.latN), q = xyOf(R, g, lon, g.latS); const sp = P(p.x, p.y), sq = P(q.x, q.y); svg.push(line(sp, sq, Math.abs(lon) < 1e-6 ? "pm" : ""));
      if (G.labels && sp.x > 0 && sp.x < VW) lab(sp.x, clY(a.y) + 2, `${Math.abs(Math.round(lon))}°${lon > 0 ? "L" : lon < 0 ? "O" : ""}`, "top"); }
    for (let lat = Math.ceil(g.latS / stp) * stp; lat <= g.latN + 1e-6; lat += stp) { const p = xyOf(R, g, g.lonW, lat), q = xyOf(R, g, g.lonE, lat); const sp = P(p.x, p.y), sq = P(q.x, q.y); svg.push(line(sp, sq));
      if (G.labels && sp.y > 0 && sp.y < VH) lab(clX(a.x) + 2, sp.y, `${Math.abs(Math.round(lat))}°${lat > 0 ? "N" : lat < 0 ? "S" : ""}`, "left"); }
    if (G.special && model === "globo") { const N = wd.names;
      for (const [lat, cls, name, key] of [[0, "eq", N.eq, "eq"], [g.tilt, "trop", N.tropN, "tropN"], [-g.tilt, "trop", N.tropS, "tropS"], [90 - g.tilt, "pol", N.polN, "polN"], [-(90 - g.tilt), "pol", N.polS, "polS"]]) { if (lat > g.latN || lat < g.latS || (cls !== "eq" && g.tilt < 0.5)) continue;
        const p = xyOf(R, g, g.lonW, lat), q = xyOf(R, g, g.lonE, lat); const sp = P(p.x, p.y), sq = P(q.x, q.y); svg.push(line(sp, sq, `sp ${cls}`) + hitL(sp, sq, key)); if (G.labels && sp.y > 0 && sp.y < VH) lab(clX(a.x) + 42, sp.y, cls === "eq" ? name : `${name} · ${Math.abs(lat).toFixed(1).replace(".", ",")}°`, `sp ${cls}`, key); } }
  } else if (model === "disco") {
    const D = discGeom(R, wd.disco); const c = P(D.cx, D.cy); const k = wd.disco;
    for (let i = 1; i <= k.rings; i++) svg.push(`<circle class="wl ${i === k.rings ? "edge" : ""}" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${(D.r * z * i / k.rings).toFixed(1)}"/>`);
    for (let i = 0; i < k.spokes; i++) { const an = (i * 360 / k.spokes + k.north) * Math.PI / 180; svg.push(line(c, { x: c.x + Math.sin(an) * D.r * z, y: c.y - Math.cos(an) * D.r * z })); }
    if (G.special) { for (const [f, name, key] of [[k.sunIn, wd.names.sunIn, "sunIn"], [k.sunOut, wd.names.sunOut, "sunOut"]]) { const rr = D.r * z * f / 100; svg.push(`<circle class="wl sp trop" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${rr.toFixed(1)}"/>` + hitC(c, rr, key)); if (G.labels) lab(c.x, c.y - rr - 2, name, "sp trop mid", key); }
      svg.push(`<circle class="wl sp edgeline" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${(D.r * z).toFixed(1)}"/>` + hitC(c, D.r * z, "edge")); if (G.labels && (k.edge !== "nada" || wd.names.edge)) lab(c.x, c.y + D.r * z + 30, wd.names.edge || EDGES[k.edge], "sp edge mid", "edge"); }
    if (G.cardinals) for (const [n, deg] of [["N", 0], ["L", 90], ["S", 180], ["O", 270]]) { const an = (deg + k.north) * Math.PI / 180; html.push(`<span class="wcard" style="${sv}left:${(c.x + Math.sin(an) * (D.r * z + 18)).toFixed(1)}px;top:${(c.y - Math.cos(an) * (D.r * z + 18)).toFixed(1)}px">${n}</span>`); }
    return done();
  } else {
    const C = planCell(sc, wd); const px = C.px; const nx = Math.ceil(R.W / px), ny = Math.ceil(R.H / px);
    if (nx * ny <= 40000) {
      for (let i = 0; i <= nx; i++) { const x = Math.min(R.X + i * px, R.X + R.W); const p = P(x, R.Y), q = P(x, R.Y + R.H); svg.push(line(p, q)); if (G.labels && i < nx) { const m = P(x + px / 2, R.Y); if (m.x > 0 && m.x < VW) lab(m.x, clY(a.y) + 2, wd.plano.letters ? colName(i) : String(i + 1), "top mid"); } }
      for (let j = 0; j <= ny; j++) { const y = Math.min(R.Y + j * px, R.Y + R.H); const p = P(R.X, y), q = P(R.X + R.W, y); svg.push(line(p, q)); if (G.labels && j < ny) { const m = P(R.X, y + px / 2); if (m.y > 0 && m.y < VH) lab(clX(a.x) + 2, m.y, String(j + 1), "left"); } }
    }
    if (model === "anel" && G.special) { html.push(`<span class="wwrap" style="${sv}left:${clX(a.x).toFixed(1)}px;top:${((a.y + b.y) / 2 + 22).toFixed(1)}px">⇄ continua no leste</span><span class="wwrap r" style="${sv}left:${clX(b.x).toFixed(1)}px;top:${((a.y + b.y) / 2 + 22).toFixed(1)}px">continua no oeste ⇄</span>`); }
    if (G.special && wd.plano.edge !== "nada") svg.push(`<rect class="wl sp edgeline" x="${a.x.toFixed(1)}" y="${a.y.toFixed(1)}" width="${(b.x - a.x).toFixed(1)}" height="${(b.y - a.y).toFixed(1)}"/>`);
  }
  if (G.cardinals) { const mx = (Math.max(a.x, 0) + Math.min(b.x, VW)) / 2, my = (Math.max(a.y, 0) + Math.min(b.y, VH)) / 2;
    for (const [n, x, y] of [["N", mx, clY(a.y) + 16], ["S", mx, clY(b.y) - 16], ["L", clX(b.x) - 14, my - 34], ["O", clX(a.x) + 34, my - 34]]) html.push(`<span class="wcard" style="${sv}left:${x.toFixed(1)}px;top:${y.toFixed(1)}px">${n}</span>`); }
  return done();
}

/* ---------- arrastar as linhas ---------- */
/** Valor novo de uma linha arrastada até o ponto (x, y) do mapa. */
export function dragValue(sc, wd, key, x, y) {
  const R = sceneRect(sc);
  if (wd.model === "globo") { const lat = Math.abs(lonLat(R, wd.globo, x, y).lat); if (key === "tropN" || key === "tropS") return { "globo.tilt": clamp(Math.round(lat * 10) / 10, 0, 89) }; if (key === "polN" || key === "polS") return { "globo.tilt": clamp(Math.round((90 - lat) * 10) / 10, 0, 89) }; return null; }
  if (wd.model === "disco") { const D = discGeom(R, wd.disco); const d = Math.hypot(x - D.cx, y - D.cy);
    if (key === "sunIn") return { "disco.sunIn": clamp(Math.round(d / D.r * 100), 1, Math.min(99, wd.disco.sunOut - 1)) };
    if (key === "sunOut") return { "disco.sunOut": clamp(Math.round(d / D.r * 100), wd.disco.sunIn + 1, 100) };
    if (key === "edge") return { "disco.r": clamp(Math.round(d / (Math.min(R.W, R.H) / 2) * 50 * 10) / 10, 5, 100) }; }
  return null;
}
/** Aplica os valores (chaves "globo.tilt"…) numa cópia do mundo, para desenhar enquanto arrasta. */
export function withValues(wd, vals) { const o = structuredClone(wd); for (const [k, v] of Object.entries(vals ?? {})) { const [a, b] = k.split("."); o[a][b] = v; } return o; }

/* ---------- luas no mapa ---------- */
/** Onde cada lua está a pino agora (globo e disco). bodies: lista de bodiesNow; eps: inclinação. */
export function moonSpots(sc, wd, bodies, lamSun, eps) {
  const R = sceneRect(sc); const out = []; const T = skyTime();
  for (const m of bodies.filter(b => b.kind === "lua")) {
    const el = ((m.lam - lamSun) + 360) % 360; const dec = Math.asin(Math.sin(eps * Math.PI / 180) * Math.sin(m.lam * Math.PI / 180)) * 180 / Math.PI;
    if (wd.model === "globo") { const S = sunGlobe(wd, T); const lon = ((S.lon - el + 540) % 360) - 180; const p = xyOf(R, wd.globo, lon, dec); out.push({ m, x: p.x, y: p.y }); }
    else if (wd.model === "disco") { const D = discGeom(R, wd.disco); const k = wd.disco; const mid = (k.sunIn + k.sunOut) / 2, amp = (k.sunOut - k.sunIn) / 2; const rf = (mid - amp * (eps ? dec / eps : 0)) / 100; const ang = (T.dayFrac * 360 + k.north - el) * Math.PI / 180; out.push({ m, x: D.cx + Math.sin(ang) * D.r * rf, y: D.cy - Math.cos(ang) * D.r * rf }); }
  }
  return out;
}
/** Latitude e "longitude" de quem olha o céu de um ponto do mundo (para o céu de hoje). */
export function observerAt(sc, wd, x, y) {
  const R = sceneRect(sc);
  if (wd.model === "globo" || wd.model === "oco") { const { lon, lat } = lonLat(R, wd.globo, x, y); return { lat, lon: lon - wd.luz.noonLon }; }
  if (wd.model === "disco") { const D = discGeom(R, wd.disco); const f = Math.hypot(x - D.cx, y - D.cy) / D.r; const brg = Math.atan2(x - D.cx, -(y - D.cy)) * 180 / Math.PI - wd.disco.north; return { lat: clamp(90 - f * 180, -90, 90), lon: brg }; }
  return null;
}

/** Cena antiga de nível Céu ligada a um mundo (versões anteriores guardavam o céu numa cena própria). */
export const legacySkyScene = (world) => game.scenes?.find?.(s => mapOf(s)?.level === "ceu" && mapOf(s)?.parent === world?.id) ?? null;
/** Céu de um mundo: fica guardado no próprio mapa-múndi (map.sky) e é aberto por cima de qualquer cena. */
export function skyOf(world) { const m = mapOf(world); if (!m) return null; if (m.level === "ceu") return m.sky ?? {}; let sk = m.sky; if (!sk) { const old = legacySkyScene(world); sk = old ? (mapOf(old).sky ?? {}) : null; } if (!sk) return null;
  // num globo, o caminho do sol no céu (eclíptica) tem a mesma inclinação do eixo do planeta: um valor só para tudo
  const wd = normWorld(m.world ?? {}); return (wd.model === "globo" || wd.model === "oco") ? { ...sk, tilt: wd.globo.tilt } : sk; }

/* ---------- estações pelo lugar ----------
   Com o mundo em globo, a estação depende da inclinação do eixo, da época do ano e da latitude de quem está lá:
   hemisférios opostos têm estações trocadas; nos trópicos o que marca o ano são as chuvas (sol a pino) e a seca;
   além dos círculos polares há dias e noites que não acabam. Sem inclinação, não há estações. */
export const SEASON_KEYS = ["primavera", "verao", "outono", "inverno"];
export function seasonAt(wd, obs, T = skyTime()) {
  if (!wd) return null; const p = (((T.yearFrac - eqOf(T, wd.luz.equinox)) % 1) + 1) % 1; // 0 = equinócio da primavera do norte
  if (wd.model === "disco") return { idx: Math.floor(p * 4) % 4, extra: "", lat: obs?.lat ?? null };
  if (wd.model !== "globo" && wd.model !== "oco") return null; if (!obs) return null;
  const tilt = wd.globo.tilt, lat = obs.lat; if (tilt < 0.5) return { idx: null, extra: "Sem estações", lat, tilt };
  const south = lat < 0; const idx = (Math.floor(p * 4) + (south ? 2 : 0)) % 4;
  const decl = tilt * Math.sin(2 * Math.PI * p); const a = Math.abs(lat); let extra = "", zone = "temperada";
  if (a <= tilt) { zone = "tropical"; extra = Math.abs(decl - lat) <= Math.max(3, tilt * 0.6) ? "chuvas" : "seca"; }
  else if (a >= 90 - tilt) { zone = "polar"; const s = south ? -decl : decl; if (s > 90 - a + 0.83) extra = "dia polar"; else if (-s > 90 - a - 0.83) extra = "noite polar"; }
  return { idx, extra, lat, tilt, zone, decl };
}
/** Retângulo virtual onde o céu é desenhado (carta 2:1). */
export const VSKY = { id: "vsky", width: 3000, height: 1500, dimensions: { sceneX: 0, sceneY: 0, sceneWidth: 3000, sceneHeight: 1500 } };
/** O mundo de um mapa: ele mesmo, o Mundo acima dele na cadeia de mapas pai, ou (céu antigo) o pai dele. */
export function worldOf(scene) { const m = mapOf(scene); if (!m) return null; if (m.level === "ceu") return game.scenes.get(m.parent) ?? null; const chain = chainOf(scene); const wi = chain.map(s => mapOf(s)?.level).lastIndexOf("mundo"); return wi >= 0 ? chain[wi] : null; }
/**
 * De onde se olha o céu estando num mapa: sobe pelos mapas pai até o Mundo e usa o marcador que leva até aqui.
 * pt: ponto no próprio Mundo (ex.: a unidade), quando o mapa é o próprio Mundo.
 */
export function observerFor(scene, pt = null) {
  const chain = chainOf(scene); const wi = chain.map(s => mapOf(s)?.level).lastIndexOf("mundo"); const world = wi >= 0 ? chain[wi] : null;
  if (!world) return { world: null, sky: null, obs: null };
  const sky = skyOf(world); const wd = normWorld(mapOf(world).world ?? {}); let p = pt, name = null;
  if (world.id !== scene.id) { const next = chain[wi + 1]; const poi = dataOf(world).pois.find(x => x.submap === next.id || x.scene === next.id); if (poi) { p = { x: poi.x, y: poi.y }; name = poi.name; } }
  const o = p ? observerAt(world, wd, p.x, p.y) : null;
  return { world, sky, wd, obs: o ? { ...o, name: name ?? scene.name } : null };
}
