// Mapa celeste: um céu gerado por semente (estrelas, faixa da galáxia, constelações), com sol, luas e planetas
// andando pelo relógio do mundo. Três vistas: Carta estelar (o céu inteiro), Céu de hoje (a cúpula vista do chão)
// e Sistema (as órbitas, tipo orrery). Tudo é desenhado pela camada do Atlas, numa cena de nível "Céu".
import { esc } from "./data.js";
import { nowTime, skyTime, sceneRect } from "./world.js";

export const SKY_VIEWS = { carta: "Carta estelar", noite: "Céu de hoje", sistema: "Sistema" };
const NAMES = ["A Mariposa", "O Farol", "A Coroa Partida", "O Olho Fechado", "A Árvore Negra", "O Sonhador", "A Nau", "O Casulo", "A Lanterna", "O Lobo da Bruma", "A Chave", "O Arqueiro Cego", "A Serpente de Sal", "O Martelo Anão", "A Balança", "O Cervo de Prata", "A Taça", "O Portão", "A Harpa", "O Corvo", "A Mão Aberta", "O Trono Vazio", "A Ampulheta", "O Polvo", "A Lua Quebrada", "O Viajante", "A Espiral", "O Dragão Adormecido", "A Vela", "O Escudo", "A Pena", "O Navegante", "A Ponte", "O Gêmeo", "A Fênix", "O Caçador", "A Âncora", "O Pastor", "A Flor de Gelo", "O Ferreiro"];
const COLORS = ["#ffffff", "#ffffff", "#dfe8ff", "#cfe0ff", "#fff4d6", "#ffe2b0", "#ffc89a"];
const R2D = 180 / Math.PI, D2R = Math.PI / 180;
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function mulberry(seed) { let a = (Number(seed) >>> 0) || 1; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Configuração do céu com tudo preenchido. */
export function normSky(s = {}) {
  return {
    view: SKY_VIEWS[s.view] ? s.view : "carta", players: s.players !== false, seed: Math.floor(num(s.seed, 1)) || 1, stars: clamp(Math.round(num(s.stars, 1800)), 200, 6000),
    tilt: clamp(num(s.tilt, 23.44), 0, 89), lat: clamp(num(s.lat, 30), -90, 90), equinox: clamp(num(s.equinox, 22), 0, 100),
    show: { grid: s.show?.grid !== false, ecl: s.show?.ecl !== false, via: s.show?.via !== false, lines: s.show?.lines !== false, names: s.show?.names !== false, starNames: s.show?.starNames !== false, bodies: s.show?.bodies !== false },
    bodies: Array.isArray(s.bodies) ? s.bodies.map(normBody) : DEFAULT_BODIES.map(normBody),
    consts: Array.isArray(s.consts) ? s.consts : null,
    // o que os jogadores podem abrir (além do interruptor geral "players")
    pview: { carta: s.pview?.carta !== false, noite: s.pview?.noite !== false, sistema: s.pview?.sistema !== false },
    // estrelas mudadas à mão pelo mestre: novas (extra), apagadas (removed: índices das geradas) e movidas (moved: [índice, ra, dec])
    extra: Array.isArray(s.extra) ? s.extra.filter(x => x && Number.isFinite(Number(x.ra)) && Number.isFinite(Number(x.dec))).map(x => ({ id: String(x.id), ra: Number(x.ra), dec: Number(x.dec), mag: clamp(num(x.mag, 2), -1, 6.5), col: x.col || "#ffffff" })) : [],
    removed: Array.isArray(s.removed) ? s.removed.map(Number).filter(Number.isFinite) : [],
    moved: Array.isArray(s.moved) ? s.moved.filter(m => Array.isArray(m) && m.length >= 3).map(m => [Number(m[0]), Number(m[1]), Number(m[2])]) : [],
    // nomes de estrelas: [ref, nome] (ref = índice da gerada ou "x:id" da criada)
    names: Array.isArray(s.names) ? s.names.filter(n => Array.isArray(n) && n[1]).map(n => [/^x:/.test(String(n[0])) ? String(n[0]) : Number(n[0]), String(n[1])]) : []
  };
}
export const DEFAULT_BODIES = [
  { id: "lua1", name: "Lua", kind: "lua", period: 29.5, color: "#e8e4d8", size: 3, offset: 0 },
  { id: "pl1", name: "Vésper", kind: "planeta", period: 225, dist: 0.72, color: "#ffe9b0", size: 2, offset: 40 },
  { id: "pl2", name: "Rubra", kind: "planeta", period: 687, dist: 1.52, color: "#ff8a6a", size: 2, offset: 200 },
  { id: "pl3", name: "O Gigante", kind: "planeta", period: 4333, dist: 5.2, color: "#f0d6a8", size: 2.5, offset: 120 }
];
export function normBody(b = {}) { return { id: b.id || Math.random().toString(36).slice(2, 9), name: b.name || "Astro", kind: ["lua", "planeta"].includes(b.kind) ? b.kind : "planeta", period: Math.max(0.1, num(b.period, 30)), dist: Math.max(0.05, num(b.dist, 1.5)), color: b.color || "#ffffff", size: clamp(num(b.size, 2), 0.5, 5), offset: num(b.offset, 0) }; }

/* ---------- estrelas ---------- */
const cache = new Map();
const vec = (ra, dec) => [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
/** Estrelas do céu (sempre as mesmas para a mesma semente). ra/dec em graus; mag: menor = mais brilhante. */
export function starsOf(sk) {
  const key = `${sk.seed}|${sk.stars}`; if (cache.has(key)) return cache.get(key);
  const rnd = mulberry(sk.seed); const list = [];
  // polo da galáxia (a faixa leitosa é o "equador" dele)
  const pRa = rnd() * 2 * Math.PI, pDec = (20 + rnd() * 50) * D2R * (rnd() < 0.5 ? 1 : -1); const P = vec(pRa, pDec);
  const U = (() => { const t = Math.abs(P[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]; const u = [P[1] * t[2] - P[2] * t[1], P[2] * t[0] - P[0] * t[2], P[0] * t[1] - P[1] * t[0]]; const l = Math.hypot(...u); return u.map(x => x / l); })();
  const V = [P[1] * U[2] - P[2] * U[1], P[2] * U[0] - P[0] * U[2], P[0] * U[1] - P[1] * U[0]];
  const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  for (let i = 0; i < sk.stars; i++) {
    let x;
    if (rnd() < 0.38) { const l = rnd() * 2 * Math.PI, b = gauss() * 9 * D2R; const cb = Math.cos(b); x = [0, 1, 2].map(k => cb * Math.cos(l) * U[k] + cb * Math.sin(l) * V[k] + Math.sin(b) * P[k]); }
    else { const z = 2 * rnd() - 1, t = rnd() * 2 * Math.PI, r = Math.sqrt(1 - z * z); x = [r * Math.cos(t), r * Math.sin(t), z]; }
    const ra = ((Math.atan2(x[1], x[0]) * R2D) + 360) % 360, dec = Math.asin(clamp(x[2], -1, 1)) * R2D;
    list.push({ ra, dec, mag: 6.6 - 8 * Math.pow(rnd(), 5), col: COLORS[Math.floor(rnd() * COLORS.length)] });
  }
  const out = { list, pole: { ra: pRa * R2D, dec: pDec * R2D } }; cache.set(key, out); return out;
}
const angDist = (a, b) => { const c = Math.sin(a.dec * D2R) * Math.sin(b.dec * D2R) + Math.cos(a.dec * D2R) * Math.cos(b.dec * D2R) * Math.cos((a.ra - b.ra) * D2R); return Math.acos(clamp(c, -1, 1)) * R2D; };
/** Constelações automáticas: grupinhos de estrelas brilhantes ligados pelo caminho mais curto. */
export function makeConsts(sk, salt = 0) {
  const S = starsOf(sk).list; const rnd = mulberry(sk.seed * 7 + 3 + salt); const bright = S.map((s, i) => ({ s, i })).filter(o => o.s.mag < 3.6).sort((a, b) => a.s.mag - b.s.mag);
  const used = new Set(); const names = [...NAMES].sort(() => rnd() - 0.5); const out = [];
  for (const o of bright) { if (used.has(o.i) || out.length >= 26) continue;
    const near = bright.filter(q => !used.has(q.i) && q.i !== o.i && angDist(o.s, q.s) < 16).sort((a, b) => angDist(o.s, a.s) - angDist(o.s, b.s)).slice(0, 3 + Math.floor(rnd() * 4));
    if (near.length < 2) continue; const grp = [o, ...near]; grp.forEach(g => used.add(g.i));
    const inT = [grp[0]]; const rest = grp.slice(1); const lines = [];
    while (rest.length) { let best = null; for (const a of inT) for (const b of rest) { const d = angDist(a.s, b.s); if (!best || d < best.d) best = { a, b, d }; } lines.push([best.a.i, best.b.i]); inT.push(best.b); rest.splice(rest.indexOf(best.b), 1); }
    out.push({ id: `c${out.length}`, name: names[out.length % names.length], lines });
  }
  return out;
}

/* ---------- nomes de estrelas ---------- */
export const STAR_NAMES = ["Lumivar", "Oniria", "Aornel", "Mireth", "Kaelith", "Vharos", "Elyndra", "Thassion", "Cindaris", "Nyxara", "Solenne", "Zirelle", "Corvain", "Ithrael", "Lunethra", "Aurelith", "Selhara", "Noctyr", "Brumaris", "Halveth", "Orlhenne", "Kestril", "Velarys", "Sarvenn", "Eloran", "Tyrrhis", "Maelis", "Ondrevar", "Phaedrin", "Ysolde", "Caldren", "Virethal", "Anwyre", "Dolmeris", "Hesperel", "Quillon", "Rhosaine", "Talveris", "Umbriel", "Xandrel"];
const angD = (a, b) => { const c = Math.sin(a.dec * D2R) * Math.sin(b.dec * D2R) + Math.cos(a.dec * D2R) * Math.cos(b.dec * D2R) * Math.cos((a.ra - b.ra) * D2R); return Math.acos(clamp(c, -1, 1)) * R2D; };
/**
 * Dá nome às estrelas mais brilhantes que ainda não têm: as que ficam perto dos polos do céu viram as Vigias (guia dos navegantes)
 * e as demais recebem nomes da lista (ou da lista passada em extra.list). Devolve a lista de nomes completa (os antigos ficam).
 */
export function autoStarNames(sk, count = 30, extra = {}) {
  const L = starList(sk); const named = new Map(sk.names.map(n => [n[0], n[1]])); const usedNames = new Set(named.values()); const out = [...sk.names];
  const put = (s, n) => { if (!s || named.has(s.ref) || usedNames.has(n)) return false; named.set(s.ref, n); usedNames.add(n); out.push([s.ref, n]); return true; };
  const near = (p, maxD, maxMag) => L.filter(s => s.mag <= maxMag && angD(s, p) <= maxD && !named.has(s.ref)).sort((a, b) => a.mag - b.mag)[0];
  put(near({ ra: 0, dec: 90 }, 12, 4.2), "Vigia Boreal"); put(near({ ra: 0, dec: -90 }, 12, 4.2), "Vigia Austral");
  for (const f of extra.fixed ?? []) put(f.pick(L, named), f.name);
  const names = (extra.list ?? STAR_NAMES).filter(n => !usedNames.has(n));
  const bright = L.filter(s => !named.has(s.ref)).sort((a, b) => a.mag - b.mag);
  let k = 0; for (const s of bright) { if (k >= names.length || out.length >= sk.names.length + count) break; if (put(s, names[k])) k++; }
  return out;
}
/** Vistas que este usuário pode abrir. */
export function viewsFor(sk, gm = game.user?.isGM) { const all = Object.keys(SKY_VIEWS); if (gm) return all; if (!sk.players) return []; return all.filter(v => sk.pview?.[v] !== false); }
/**
 * Todas as estrelas como são agora: as geradas pela semente (menos as apagadas, com as movidas no lugar novo) e as criadas pelo mestre.
 * ref: número (índice da gerada) ou "x:id" (criada). As linhas das constelações usam essas mesmas refs.
 */
export function starList(sk) {
  const S = starsOf(sk).list; const rem = new Set(sk.removed ?? []); const mv = new Map((sk.moved ?? []).map(m => [m[0], m]));
  const out = [];
  for (let i = 0; i < S.length; i++) { if (rem.has(i)) continue; const m = mv.get(i); out.push(m ? { ...S[i], ra: m[1], dec: m[2], ref: i } : { ...S[i], ref: i }); }
  for (const x of sk.extra ?? []) out.push({ ra: x.ra, dec: x.dec, mag: x.mag, col: x.col, ref: `x:${x.id}`, own: true });
  return out;
}

/* ---------- astros ---------- */
/** Onde estão o sol, as luas e os planetas agora (longitude na eclíptica, em graus) e a fase de cada lua. */
export function bodiesNow(sk, T = skyTime()) {
  const days = (T.t ?? (Number(game.time?.worldTime) || 0)) / T.secDay; const lamSun = ((T.yearFrac - (T.eq ?? sk.equinox / 100)) * 360 + 720) % 360;
  const home = { x: Math.cos((lamSun + 180) * D2R), y: Math.sin((lamSun + 180) * D2R) }; // o seu mundo em volta do sol (raio 1)
  const out = [{ id: "sol", name: "Sol", kind: "sol", lam: lamSun, color: "#ffd85a", size: 4 }];
  for (const b of sk.bodies) {
    const th = ((days / b.period) * 360 + b.offset) % 360;
    if (b.kind === "lua") { const lam = (lamSun + th) % 360; const el = ((lam - lamSun) + 360) % 360; out.push({ ...b, lam, phase: (1 - Math.cos(el * D2R)) / 2, waxing: el < 180 }); }
    else { const px = Math.cos(th * D2R) * b.dist, py = Math.sin(th * D2R) * b.dist; const lam = ((Math.atan2(py - home.y, px - home.x) * R2D) + 360) % 360; out.push({ ...b, lam, th }); }
  }
  return { list: out, lamSun, home, days };
}
/** Eclíptica → equatorial (graus). */
export function eclToEq(lam, eps) { const l = lam * D2R, e = eps * D2R; return { ra: ((Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l)) * R2D) + 360) % 360, dec: Math.asin(Math.sin(e) * Math.sin(l)) * R2D }; }

/* ---------- desenho ---------- */
const fx = (v) => v.toFixed(1);
export const moonIcon = (x, y, r, b) => { // fase desenhada: parte iluminada
  const k = b.phase * 2 - 1; const dir = b.waxing ? 1 : -1; const rx = Math.abs(k) * r;
  const lit = `M${fx(x)} ${fx(y - r)} A${fx(r)} ${fx(r)} 0 0 ${dir > 0 ? 1 : 0} ${fx(x)} ${fx(y + r)} A${fx(rx)} ${fx(r)} 0 0 ${(k > 0) === (dir > 0) ? 1 : 0} ${fx(x)} ${fx(y - r)}Z`;
  return `<circle cx="${fx(x)}" cy="${fx(y)}" r="${fx(r)}" class="skmoon-d" fill="#1b2030" stroke="#3a4160" stroke-width="1"/><path d="${lit}" style="fill:${esc(b.color)}"/>`;
};
/** Desenha o céu. P(x,y) mapa→tela; z zoom; devolve { svg, html, defs }. */
export function renderSky(sc, sk, P, z, VW, VH, obs = null, opt = {}) {
  const R = sceneRect(sc); const svg = [], html = [], defs = []; const T = skyTime(); const B = bodiesNow(sk, T); const st = starsOf(sk);
  // estrelas como estão agora (com as mudanças do mestre); edição: a que está sendo arrastada aparece no lugar novo
  const S = starList(sk).map(s => opt.drag && opt.drag.ref === s.ref ? { ...s, ra: opt.drag.ra, dec: opt.drag.dec } : s);
  const idx = new Map(S.map((s, i) => [s.ref, i])); const edit = !!opt.edit && sk.view === "carta";
  const consts = sk.consts ?? makeConsts(sk);
  const a = P(R.X, R.Y), b = P(R.X + R.W, R.Y + R.H); const lab = (x, y, t, cls = "") => html.push(`<span class="sklab ${cls}" style="left:${fx(x)}px;top:${fx(y)}px">${esc(t)}</span>`);
  const magCut = clamp(3.2 + z * 4.5, 3.5, 6.6); const rad = (m) => clamp((6.9 - m) * 0.45 * clamp(z * 1.4, 0.7, 2.2), 0.45, 6);
  if (sk.view === "sistema") return renderSystem(sc, sk, B, P, z, R, a, b, svg, html, lab);
  let proj; let visible = () => true; let skyAlpha = 1; let horizon = null;
  if (sk.view === "carta") {
    proj = (ra, dec) => P(R.X + (1 - ra / 360) * R.W, R.Y + (90 - dec) / 180 * R.H);
    svg.push(`<rect class="skbg" x="${fx(a.x)}" y="${fx(a.y)}" width="${fx(b.x - a.x)}" height="${fx(b.y - a.y)}"/>`);
  } else { // céu de hoje: cúpula vista de baixo (zênite no centro, horizonte na borda; leste à esquerda)
    const cx = R.X + R.W / 2, cy = R.Y + R.H / 2, Rd = Math.min(R.W, R.H) / 2 * 0.94; const latObs = obs?.lat ?? sk.lat; const phi = latObs * D2R;
    const sun = eclToEq(B.lamSun, sk.tilt); const lst = sun.ra + (T.dayFrac - 0.5) * 360 + (obs?.lon ?? 0); // hora local: quem está mais a leste vê o céu girar antes
    const altaz = (ra, dec) => { const H = (lst - ra) * D2R, d = dec * D2R; const alt = Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H)); const az = Math.atan2(-Math.sin(H) * Math.cos(d), Math.cos(phi) * Math.sin(d) - Math.sin(phi) * Math.cos(d) * Math.cos(H)); return { alt: alt * R2D, az }; };
    proj = (ra, dec) => { const h = altaz(ra, dec); const r = (90 - h.alt) / 90 * Rd; return { ...P(cx - Math.sin(h.az) * r, cy - Math.cos(h.az) * r), alt: h.alt }; };
    visible = (q) => q.alt > -0.5;
    const sAlt = altaz(sun.ra, sun.dec).alt; skyAlpha = clamp((-sAlt - 2) / 12, 0, 1); // estrelas somem de dia e no crepúsculo
    const c = P(cx, cy); const rr = Rd * z;
    const day = clamp((sAlt + 8) / 14, 0, 1);
    defs.push(`<radialGradient id="skdome"><stop offset="0" stop-color="${day > 0.5 ? "#3d7fc4" : "#0c1426"}"/><stop offset="1" stop-color="${day > 0.5 ? "#9cc8ee" : day > 0 ? "#3a2f4f" : "#141a2e"}"/></radialGradient>`);
    svg.push(`<circle class="skdome" cx="${fx(c.x)}" cy="${fx(c.y)}" r="${fx(rr)}" fill="url(#skdome)"/>`);
    horizon = { c, rr };
    for (const [n, az] of [["N", 0], ["L", 90], ["S", 180], ["O", 270]]) { const an = az * D2R; html.push(`<span class="skcard" style="left:${fx(c.x - Math.sin(an) * (rr + 16))}px;top:${fx(c.y - Math.cos(an) * (rr + 16))}px">${n}</span>`); }
    html.push(`<span class="sklab info" style="left:${fx(c.x)}px;top:${fx(c.y + rr + 34)}px">${obs?.name ? `Visto de ${esc(obs.name)} · ` : ""}${Math.abs(Math.round(latObs))}° ${latObs >= 0 ? "N" : "S"} · ${day > 0.5 ? "dia" : day > 0 ? "crepúsculo" : "noite"}</span>`);
  }
  // grade e eclíptica
  if (sk.show.grid && sk.view === "carta") { for (let ra = 0; ra < 360; ra += 30) { const p = proj(ra, 90), q = proj(ra, -90); svg.push(`<line class="skgrid" x1="${fx(p.x)}" y1="${fx(p.y)}" x2="${fx(q.x)}" y2="${fx(q.y)}"/>`); lab(p.x, Math.max(a.y, 4) + 2, `${ra / 15}h`, "top"); }
    for (let dec = -60; dec <= 60; dec += 30) { const p = proj(360, dec), q = proj(0, dec); svg.push(`<line class="skgrid ${dec === 0 ? "eq" : ""}" x1="${fx(p.x)}" y1="${fx(p.y)}" x2="${fx(q.x)}" y2="${fx(q.y)}"/>`); lab(Math.max(a.x, 4) + 2, p.y, `${dec > 0 ? "+" : ""}${dec}°`, "left"); } }
  const path = (pts) => { let d = "", pen = false, prev = null; for (const q of pts) { if (!q || !visible(q) || (prev && Math.abs(q.x - prev.x) > (b.x - a.x) / 2)) { pen = false; prev = q; continue; } d += `${pen ? "L" : "M"}${fx(q.x)} ${fx(q.y)}`; pen = true; prev = q; } return d; };
  if (sk.show.ecl) { const pts = []; for (let l = 0; l <= 360; l += 3) { const e = eclToEq(l, sk.tilt); pts.push(proj(e.ra, e.dec)); } svg.push(`<path class="skecl" d="${path(pts)}" style="opacity:${0.35 + 0.65 * skyAlpha}"/>`); }
  if (sk.show.via && skyAlpha > 0.05) { const pts = []; const pole = st.pole; for (let l = 0; l <= 360; l += 4) { // grande círculo a 90° do polo da galáxia
      const pr = pole.ra * D2R, pd = pole.dec * D2R; const P0 = vec(pr, pd); const t = Math.abs(P0[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]; let U = [P0[1] * t[2] - P0[2] * t[1], P0[2] * t[0] - P0[0] * t[2], P0[0] * t[1] - P0[1] * t[0]]; const ul = Math.hypot(...U); U = U.map(x => x / ul); const V = [P0[1] * U[2] - P0[2] * U[1], P0[2] * U[0] - P0[0] * U[2], P0[0] * U[1] - P0[1] * U[0]];
      const x = [0, 1, 2].map(k => Math.cos(l * D2R) * U[k] + Math.sin(l * D2R) * V[k]); pts.push(proj(((Math.atan2(x[1], x[0]) * R2D) + 360) % 360, Math.asin(x[2]) * R2D)); }
    defs.push(`<filter id="skvia" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${fx(clamp(z * 22, 6, 60))}"/></filter>`);
    svg.push(`<path class="skvia" filter="url(#skvia)" d="${path(pts)}" style="stroke-width:${fx(clamp(z * 70, 18, 220))}px;opacity:${0.5 * skyAlpha}"/>`); }
  // constelações
  if (skyAlpha > 0.05) {
    const P2 = S.map(s => proj(s.ra, s.dec)); const at = (ref) => { const i = idx.get(ref); return i == null ? null : P2[i]; };
    const linked = new Set(); for (const c of consts) for (const l of c.lines) { linked.add(l[0]); linked.add(l[1]); }
    if (sk.show.lines || edit) for (const c of consts) { const on = edit && opt.con === c.id; for (const [i, j] of c.lines) { const p = at(i), q = at(j); if (!p || !q || !visible(p) || !visible(q) || Math.abs(p.x - q.x) > (b.x - a.x) / 3) continue;
      svg.push(`<line class="skcon${on ? " on" : ""}" x1="${fx(p.x)}" y1="${fx(p.y)}" x2="${fx(q.x)}" y2="${fx(q.y)}" style="opacity:${on ? 1 : 0.55 * skyAlpha}"/>`); } }
    const nm = new Map((sk.names ?? []).map(n => [n[0], n[1]])); const showN = sk.show.starNames !== false || edit;
    const dots = []; for (let i = 0; i < S.length; i++) { const s = S[i]; if (s.mag > magCut && !s.own && !nm.has(s.ref) && !(edit && linked.has(s.ref))) continue; const q = P2[i]; if (!visible(q) || q.x < -10 || q.y < -10 || q.x > VW + 10 || q.y > VH + 10) continue;
      const dot = `<circle cx="${fx(q.x)}" cy="${fx(q.y)}" r="${fx(rad(s.mag))}" fill="${s.col}" fill-opacity="${(clamp(1.15 - s.mag / 8, 0.25, 1) * skyAlpha).toFixed(2)}"/>`;
      if (showN && nm.has(s.ref) && skyAlpha > 0.25) html.push(`<span class="sklab star" style="left:${fx(q.x + rad(s.mag) + 4)}px;top:${fx(q.y)}px;opacity:${skyAlpha.toFixed(2)}">${esc(nm.get(s.ref))}</span>`);
      if (!edit) { dots.push(dot); continue; }
      // edição: cada estrela é um alvo (arrastar, ligar, apagar); as criadas pelo mestre têm um anel
      const sel = opt.sel === s.ref; dots.push(`<g class="skst${s.own ? " own" : ""}${sel ? " sel" : ""}" data-star="${s.ref}">${dot}<circle class="skhit" cx="${fx(q.x)}" cy="${fx(q.y)}" r="${fx(Math.max(7, rad(s.mag) + 4))}"/></g>`); }
    svg.push(`<g class="skstars${edit ? " edit" : ""}">${dots.join("")}</g>`);
    if (sk.show.names) for (const c of consts) { const pts = c.lines.flat().map(i => at(i)).filter(q => q && visible(q)); if (pts.length < 2) continue; const mx = pts.reduce((s, q) => s + q.x, 0) / pts.length, my = pts.reduce((s, q) => s + q.y, 0) / pts.length; if (Math.max(...pts.map(q => q.x)) - Math.min(...pts.map(q => q.x)) > (b.x - a.x) / 3) continue; lab(mx, my + 14, c.name, "con"); }
  }
  // sol, luas e planetas
  if (sk.show.bodies) for (const o of B.list) { const e = eclToEq(o.lam, sk.tilt); const q = proj(e.ra, e.dec); if (!visible(q)) continue; const r = clamp(o.size * 2.4 * clamp(z * 1.3, 0.8, 2), 3, 16);
    // de dia, no céu de hoje, os planetas somem no azul (só o sol e as luas aparecem)
    if (o.kind === "planeta" && sk.view === "noite" && skyAlpha < 0.15) continue;
    if (o.kind === "sol") { svg.push(`<circle class="sksun${opt.sunClick && sk.view === "noite" ? " click" : ""}" data-skysun="1" cx="${fx(q.x)}" cy="${fx(q.y)}" r="${fx(r * 1.4)}"/>`); lab(q.x, q.y + r * 1.4 + 12, "Sol", "body"); continue; }
    if (o.kind === "lua") svg.push(moonIcon(q.x, q.y, r, o)); else svg.push(`<circle cx="${fx(q.x)}" cy="${fx(q.y)}" r="${fx(r * 0.7)}" style="fill:${esc(o.color)}" class="skpl"/>`);
    lab(q.x, q.y + r + 12, `${o.name}${o.kind === "lua" ? ` · ${phaseName(o)}` : ""}`, "body"); }
  if (horizon) svg.push(`<circle class="skhor" cx="${fx(horizon.c.x)}" cy="${fx(horizon.c.y)}" r="${fx(horizon.rr)}"/>`);
  return { svg: `<g class="sky">${svg.join("")}</g>`, html: html.join(""), defs: defs.join("") };
}
export function phaseName(o) { const p = o.phase; if (p < 0.04) return "nova"; if (p > 0.96) return "cheia"; if (Math.abs(p - 0.5) < 0.08) return o.waxing ? "quarto crescente" : "quarto minguante"; return o.waxing ? (p < 0.5 ? "crescente" : "gibosa crescente") : (p < 0.5 ? "minguante" : "gibosa minguante"); }
/** Vista do sistema: o sol no centro e as órbitas. As luas giram em volta do seu mundo. */
function renderSystem(sc, sk, B, P, z, R, a, b, svg, html, lab) {
  const cx = R.X + R.W / 2, cy = R.Y + R.H / 2; const c = P(cx, cy); const pls = B.list.filter(x => x.kind === "planeta"); const maxD = Math.max(1, ...pls.map(p => p.dist));
  const Rm = Math.min(R.W, R.H) / 2 * 0.9 * z; const rOf = (d) => Math.sqrt(d / maxD) * Rm; // raiz: os de dentro não ficam espremidos
  svg.push(`<rect class="skbg" x="${fx(a.x)}" y="${fx(a.y)}" width="${fx(b.x - a.x)}" height="${fx(b.y - a.y)}"/><circle class="sksun big" cx="${fx(c.x)}" cy="${fx(c.y)}" r="${fx(clamp(Rm * 0.05, 8, 40))}"/>`);
  const orbit = (r, cls = "") => svg.push(`<circle class="skorb ${cls}" cx="${fx(c.x)}" cy="${fx(c.y)}" r="${fx(r)}"/>`);
  const homeR = rOf(1); orbit(homeR, "home"); const hth = Math.atan2(B.home.y, B.home.x); const h = { x: c.x + Math.cos(hth) * homeR, y: c.y - Math.sin(hth) * homeR };
  svg.push(`<circle class="skhome" cx="${fx(h.x)}" cy="${fx(h.y)}" r="${fx(clamp(Rm * 0.025, 5, 16))}"/>`); lab(h.x, h.y + 20, "Seu mundo", "body home");
  for (const p of pls) { const r = rOf(p.dist); orbit(r); const th = (p.th ?? 0) * D2R; const q = { x: c.x + Math.cos(th) * r, y: c.y - Math.sin(th) * r }; svg.push(`<circle cx="${fx(q.x)}" cy="${fx(q.y)}" r="${fx(clamp(p.size * 3 * Math.max(z, 0.6), 3, 14))}" style="fill:${esc(p.color)}" class="skpl"/>`); lab(q.x, q.y + 16, p.name, "body"); }
  const moons = B.list.filter(o => o.kind === "lua"); moons.forEach((m, i) => { const r = clamp(Rm * 0.06, 14, 60) * (1 + i * 0.5); svg.push(`<circle class="skorb moon" cx="${fx(h.x)}" cy="${fx(h.y)}" r="${fx(r)}"/>`); const th = (m.lam) * D2R; const q = { x: h.x + Math.cos(th) * r, y: h.y - Math.sin(th) * r }; svg.push(moonIcon(q.x, q.y, clamp(m.size * 1.6, 3, 9), m)); });
  const T = skyTime(); html.push(`<span class="sklab info" style="left:${fx(c.x)}px;top:${fx(Math.min(b.y, c.y + Rm) + 26)}px">${Math.round(T.yearFrac * 100)}% do ano · ${moons.map(m => `${esc(m.name)}: ${phaseName(m)}`).join(" · ")}</span>`);
  return { svg: `<g class="sky">${svg.join("")}</g>`, html: html.join(""), defs: "" };
}
/** Leitura do cursor no mapa celeste. */
export function skyReadout(sc, sk, x, y) {
  const R = sceneRect(sc); if (sk.view !== "carta" || x < R.X || x > R.X + R.W || y < R.Y || y > R.Y + R.H) return null;
  const ra = (1 - (x - R.X) / R.W) * 360, dec = 90 - (y - R.Y) / R.H * 180; const h = ra / 15; const H = Math.floor(h), M = Math.round((h - H) * 60);
  return { main: `AR ${H}h${String(M).padStart(2, "0")} · Dec ${dec >= 0 ? "+" : "−"}${Math.abs(dec).toFixed(1)}°`, sub: "" };
}

/* ---------- barra do céu (mapas de região e de cidade) ---------- */
/** Altura (graus) e azimute de um astro para quem está na latitude lat, com o tempo sideral local lst (graus). */
export function altAz(ra, dec, lat, lst) { const H = (lst - ra) * D2R, d = dec * D2R, f = lat * D2R; const alt = Math.asin(Math.sin(f) * Math.sin(d) + Math.cos(f) * Math.cos(d) * Math.cos(H)); return { alt: alt * R2D, H: ((((lst - ra) % 360) + 540) % 360) - 180 }; }
const COVER = { limpo: 0.08, calor: 0.03, nublado: 0.75, neblina: 0.55, chuva: 0.9, tempestade: 1, neve: 0.85, nevasca: 1 };
/**
 * Faixa no alto da tela com o céu de agora: o sol e as luas cruzando de leste (esquerda) a oeste (direita),
 * a cor do céu pela altura do sol, estrelas de noite e as nuvens do clima do mapa.
 */
export function renderSkyBar(sk, obs, w, width, height = 64, timeLabel = null) {
  const T = skyTime(); const B = bodiesNow(sk, T); const lat = obs?.lat ?? sk.lat; const sun = eclToEq(B.lamSun, sk.tilt);
  const lst = sun.ra + (T.dayFrac - 0.5) * 360 + (obs?.lon ?? 0); const H = Math.max(30, Math.round(height)), hor = H - Math.round(H * 0.19), top = Math.round(H * 0.09); const Wd = width;
  const X = (h) => (h + 180) / 360 * Wd; const Y = (alt) => hor - Math.max(-12, alt) / 90 * (hor - top);
  const s = altAz(sun.ra, sun.dec, lat, lst); const day = clamp((s.alt + 8) / 16, 0, 1); const dusk = clamp(1 - Math.abs(s.alt) / 9, 0, 1);
  const mix = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
  const topC = mix([8, 12, 28], [62, 128, 196], day), botC = dusk > 0.15 && s.alt > -9 ? mix(mix([8, 12, 28], [120, 170, 220], day).match(/\d+/g).map(Number), [236, 140, 86], dusk * 0.8) : mix([16, 22, 44], [156, 200, 236], day);
  const gid = `sbg${Math.floor(Math.random() * 1e9)}`; const parts = [`<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${topC}"/><stop offset="1" stop-color="${botC}"/></linearGradient></defs><rect width="${Wd}" height="${H}" rx="10" fill="url(#${gid})"/>`];
  // estrelas (de noite)
  if (day < 0.6) { const rnd = mulberry(sk.seed + 99); for (let i = 0; i < Math.round(Wd / 6); i++) parts.push(`<circle cx="${fx(rnd() * Wd)}" cy="${fx(top + rnd() * (hor - top - 4))}" r="${fx(0.4 + rnd() * 0.9)}" fill="#fff" opacity="${((1 - day / 0.6) * (0.3 + rnd() * 0.7)).toFixed(2)}"/>`); }
  // caminho do sol hoje
  const path = []; for (let h = -180; h <= 180; h += 6) { const a = altAz(sun.ra, sun.dec, lat, sun.ra + h).alt; path.push(`${path.length ? "L" : "M"}${fx(X(h))} ${fx(Y(a))}`); }
  parts.push(`<path d="${path.join("")}" fill="none" stroke="#ffd85a" stroke-opacity=".35" stroke-dasharray="3 4"/>`);
  // luas e sol
  for (const o of B.list) { const e = eclToEq(o.lam, sk.tilt); const p = o.kind === "sol" ? s : altAz(e.ra, e.dec, lat, lst); if (p.alt < -6) continue; const x = X(p.H), y = Y(p.alt);
    if (o.kind === "sol") parts.push(`<circle cx="${fx(x)}" cy="${fx(y)}" r="9" fill="#ffd85a" style="filter:drop-shadow(0 0 8px #ffcf4a)"/>`);
    else if (o.kind === "lua") parts.push(moonIcon(x, y, 6.5, o)); else if (day < 0.5) parts.push(`<circle cx="${fx(x)}" cy="${fx(y)}" r="1.8" fill="${esc(o.color)}"/>`); }
  // nuvens do clima (cobrem o céu conforme o tempo; andam com o vento)
  const cover = w?.enabled ? (COVER[w.climate] ?? 0.3) : 0; const nC = Math.round(cover * Wd / 70);
  if (nC) { const tc = Date.now() / 1000 + nowTime() / Math.max(1, Number(w?.cloudTime) || 1); const rnd = mulberry(sk.seed + 7); const dir = Math.sin(((w.dir ?? 0) + 180) * D2R) >= 0 ? 1 : -1; const dur = clamp(240 / Math.max(1, w.force ?? 2), 20, 240); const shade = mix([40, 46, 62], [236, 240, 246], day);
    for (let i = 0; i < nC; i++) { const cx = rnd() * Wd, cy = top + 4 + rnd() * (hor - top - 16), cw = 30 + rnd() * 70, ch = 8 + rnd() * 10;
      const per = dur * (0.7 + rnd() * 0.6), ph = rnd(); const span = Wd + 200; const p = (((tc / per + ph) % 1) + 1) % 1; const dx = (dir > 0 ? p : 1 - p) * span - 100 - cx; // posição pelo relógio (real + tempo do mundo)
      parts.push(`<g transform="translate(${fx(dx)} 0)"><ellipse cx="${fx(cx)}" cy="${fx(cy)}" rx="${fx(cw / 2)}" ry="${fx(ch / 2)}" fill="${shade}" opacity="${(0.55 + cover * 0.35).toFixed(2)}"/><ellipse cx="${fx(cx + cw * 0.22)}" cy="${fx(cy - ch * 0.35)}" rx="${fx(cw * 0.28)}" ry="${fx(ch * 0.45)}" fill="${shade}" opacity="${(0.55 + cover * 0.35).toFixed(2)}"/></g>`); } }
  if (["chuva", "tempestade"].includes(w?.climate) && w.enabled) parts.push(`<rect width="${Wd}" height="${H}" rx="10" fill="#7f8ea8" opacity=".18"/>`);
  if (["neblina"].includes(w?.climate) && w.enabled) parts.push(`<rect y="${hor - 22}" width="${Wd}" height="34" fill="#dfe4ec" opacity="${(0.25 + day * 0.2).toFixed(2)}"/>`);
  // horizonte, pontos e hora
  parts.push(`<rect y="${hor}" width="${Wd}" height="${H - hor}" fill="#0d1016" opacity=".55"/><line x1="0" x2="${Wd}" y1="${hor}" y2="${hor}" stroke="#e8d9a8" stroke-opacity=".35"/>`);
  const loc = ((T.dayFrac + (obs?.lon ?? 0) / 360) % 1 + 1) % 1; const hh = Math.floor(loc * 24), mm = Math.floor((loc * 24 % 1) * 60);
  const moons = B.list.filter(o => o.kind === "lua");
  return `<div class="skybar" style="width:${Wd}px"><svg width="${Wd}" height="${H}">${parts.join("")}</svg>
    <span class="sb-l">L</span><span class="sb-r">O</span><span class="sb-t">${timeLabel != null ? esc(timeLabel) : `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`}${obs?.name ? ` · ${esc(obs.name)}` : ""}</span>
    ${moons.length ? `<span class="sb-m">${moons.map(m => `${esc(m.name)}: ${phaseName(m)}`).join(" · ")}</span>` : ""}</div>`;
}

/* ---------- mostrador redondo (para o relógio do Cronos) ---------- */
/**
 * O céu de agora num círculo: a cúpula vista do lugar (estrelas, sol, luas), com as nuvens do clima por cima.
 * skyScene: cena do céu; obs: { lat, lon } de quem olha; wx: clima (effectiveWeather); size: px; t: instante.
 */
export function renderDial(skyScene, sk0, obs, wx, size, t) {
  const sk = { ...sk0, view: "noite", show: { ...sk0.show, names: false, grid: false, ecl: false } };
  const R = sceneRect(skyScene); const cx = R.X + R.W / 2, cy = R.Y + R.H / 2, Rd = Math.min(R.W, R.H) / 2 * 0.94; const k = (size / 2) / Rd;
  const P = (x, y) => ({ x: (x - cx) * k + size / 2, y: (y - cy) * k + size / 2 });
  const r = renderSky(skyScene, sk, P, k * 0.9, size, size, obs);
  const T = skyTime(t); const cl = wx?.enabled ? wx.climate : "limpo";
  const cover = { limpo: 0, calor: 0, nublado: 0.55, neblina: 0.5, chuva: 0.75, tempestade: 0.88, neve: 0.7, nevasca: 0.85 }[cl] ?? 0;
  const B = bodiesNow(sk, T); const sun = eclToEq(B.lamSun, sk.tilt); const lst = sun.ra + (T.dayFrac - 0.5) * 360 + (obs?.lon ?? 0); const sAlt = altAz(sun.ra, sun.dec, obs?.lat ?? sk.lat, lst).alt;
  const lightC = sAlt > 0 ? "#dfe6ee" : sAlt > -8 ? "#8a7f94" : "#3a4152"; const darkC = sAlt > 0 ? "#9aa4b2" : "#1e2330";
  let clouds = "";
  if (cover > 0) { // nuvens que passam com o vento
    const rnd = mulberry(7 + Math.round(sk.seed)); const drift = ((Number(t) || 0) / 60) * (0.4 + (wx?.force ?? 3) * 0.12); const ang = ((wx?.dir ?? 90) - 90) * D2R; const n = 6 + Math.round(cover * 10);
    const blobs = []; for (let i = 0; i < n; i++) { const bx = rnd() * size * 1.6 - size * 0.3, by = rnd() * size, w = size * (0.25 + rnd() * 0.35), h = w * (0.35 + rnd() * 0.2);
      const x = ((bx + Math.cos(ang) * drift) % (size * 1.6) + size * 1.6) % (size * 1.6) - size * 0.3, y = ((by + Math.sin(ang) * drift * 0.3) % size + size) % size;
      blobs.push(`<ellipse cx="${fx(x)}" cy="${fx(y)}" rx="${fx(w / 2)}" ry="${fx(h / 2)}" fill="${i % 3 ? lightC : darkC}" fill-opacity="${(0.35 + cover * 0.5).toFixed(2)}"/>`); }
    clouds = `<g filter="url(#dialblur)">${blobs.join("")}</g><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${darkC}" fill-opacity="${(cover * 0.35).toFixed(2)}"/>`;
    if (cl === "chuva" || cl === "tempestade") { const lines = []; for (let i = 0; i < 26; i++) { const x = (i * 37.3 + (Number(t) || 0) * 3) % size, y = (i * 53.1 + (Number(t) || 0) * 9) % size; lines.push(`<line x1="${fx(x)}" y1="${fx(y)}" x2="${fx(x - 2)}" y2="${fx(y + 7)}"/>`); } clouds += `<g stroke="#bcd3ff" stroke-opacity=".6" stroke-width="1">${lines.join("")}</g>`; }
    if (cl === "neve" || cl === "nevasca") { const dots = []; for (let i = 0; i < 30; i++) { const x = (i * 41.7 + (Number(t) || 0) * 0.8) % size, y = (i * 29.3 + (Number(t) || 0) * 2) % size; dots.push(`<circle cx="${fx(x)}" cy="${fx(y)}" r="1.2"/>`); } clouds += `<g fill="#fff" fill-opacity=".85">${dots.join("")}</g>`; }
    if (cl === "neblina") clouds += `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#e6e8ee" fill-opacity=".35"/>`;
  }
  return `<svg class="dial" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><defs>${r.defs}<clipPath id="dialclip"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 1}"/></clipPath><filter id="dialblur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${fx(size * 0.04)}"/></filter></defs><g clip-path="url(#dialclip)">${r.svg}${clouds}</g></svg>`;
}

/**
 * Mostrador do horizonte (relógio do Cronos): metade de cima é o céu, metade de baixo é o chão.
 * O sol e as luas sobem pelo leste (esquerda), passam no alto ao meio-dia (ou à meia-noite, a lua cheia) e descem
 * pelo oeste (direita). A altura de cada astro é a de verdade para quem está em obs (latitude e longitude):
 * acima da linha do horizonte é dia (sol) ou lua à vista; abaixo, escondidos pelo chão.
 */
export function renderHorizonDial(sk, obs, wx, size, t) {
  const T = skyTime(t); const B = bodiesNow(sk, T); const lat = obs?.lat ?? sk.lat; const sun = eclToEq(B.lamSun, sk.tilt);
  const lst = sun.ra + (T.dayFrac - 0.5) * 360 + (obs?.lon ?? 0); const c = size / 2, r = size / 2 - 2, rp = r * 0.78;
  const place = (ra, dec) => { const h = altAz(ra, dec, lat, lst); const dy = clamp(h.alt / 90, -1, 1) * rp; const half = Math.sqrt(Math.max(0, rp * rp - dy * dy)); return { x: c + Math.sin(h.H * D2R) * half, y: c - dy, alt: h.alt }; };
  const S = place(sun.ra, sun.dec); const day = clamp((S.alt + 6) / 12, 0, 1), dusk = clamp(1 - Math.abs(S.alt) / 10, 0, 1);
  const mix = (a, b, k) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(",")})`;
  const top = mix([8, 12, 30], [64, 136, 214], day), bot = dusk > 0.05 && S.alt > -12 ? mix(day > 0.5 ? [150, 200, 240] : [30, 34, 60], [240, 150, 90], dusk * 0.85) : mix([20, 26, 50], [160, 206, 240], day);
  const id = `hd${Math.round(Math.random() * 1e6)}`; const parts = [];
  parts.push(`<defs><linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bot}"/></linearGradient>
    <linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b3324"/><stop offset="1" stop-color="#11150f"/></linearGradient>
    <clipPath id="${id}c"><circle cx="${c}" cy="${c}" r="${r}"/></clipPath><clipPath id="${id}u"><rect width="${size}" height="${c}"/></clipPath>
    <filter id="${id}b" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${fx(size * 0.035)}"/></filter></defs>`);
  const g = [`<rect width="${size}" height="${c}" fill="url(#${id}s)"/>`];
  // estrelas (fixas no mostrador, aparecem com o escuro)
  if (day < 0.7) { const rnd = mulberry(sk.seed + 3); for (let i = 0; i < 22; i++) { const x = rnd() * size, y = rnd() * c * 0.95; g.push(`<circle cx="${fx(x)}" cy="${fx(y)}" r="${fx(0.5 + rnd() * 0.7)}" fill="#fff" fill-opacity="${((0.4 + rnd() * 0.6) * (1 - day / 0.7)).toFixed(2)}"/>`); } }
  // astros: só o sol e as luas, e só quando estão acima do horizonte (planetas são pequenos demais para o mostrador)
  const bodies = []; const sR = clamp(size * 0.075, 4, 9);
  bodies.push({ y: S.y, alt: S.alt, svg: `<circle cx="${fx(S.x)}" cy="${fx(S.y)}" r="${fx(sR)}" fill="#ffd85a" style="filter:drop-shadow(0 0 ${fx(sR)}px #ffcf4a)"/>` });
  for (const o of B.list.filter(b => b.kind === "lua")) { const e = eclToEq(o.lam, sk.tilt); const q = place(e.ra, e.dec); bodies.push({ y: q.y, alt: q.alt, svg: moonIcon(q.x, q.y, clamp(sR * 0.8 * (o.size ?? 3) / 3, 3, 8), o) }); }
  // abaixo do horizonte nada aparece: um ponto amarelo no chão parecia "outro sol"
  // nuvens do clima (só no céu)
  const cover = wx?.enabled ? (COVER[wx.climate] ?? 0.3) : 0;
  const cl = [];
  if (cover > 0.1) { const rnd = mulberry(sk.seed + 11); const tc = Date.now() / 1000 + nowTime() / Math.max(1, Number(wx?.cloudTime) || 1); const dir = Math.sin(((wx.dir ?? 0) + 180) * D2R) >= 0 ? 1 : -1; const n = Math.round(3 + cover * 7);
    const shade = mix([46, 52, 70], [230, 234, 242], day);
    for (let i = 0; i < n; i++) { const per = clamp(240 / Math.max(1, wx.force ?? 2), 20, 240) * (0.7 + rnd() * 0.6), ph = rnd(); const p = (((tc / per + ph) % 1) + 1) % 1; const x = (dir > 0 ? p : 1 - p) * (size * 1.6) - size * 0.3;
      const y = c * (0.15 + rnd() * 0.7), w = size * (0.22 + rnd() * 0.3); cl.push(`<ellipse cx="${fx(x)}" cy="${fx(y)}" rx="${fx(w / 2)}" ry="${fx(w * 0.2)}" fill="${shade}" fill-opacity="${(0.45 + cover * 0.45).toFixed(2)}"/>`); }
    if (["chuva", "tempestade"].includes(wx.climate)) { for (let i = 0; i < 16; i++) { const x = (i * 29.7 + tc * 40) % size, y = (i * 17.3 + tc * 90) % c; cl.push(`<line x1="${fx(x)}" y1="${fx(y)}" x2="${fx(x - 1.5)}" y2="${fx(y + 5)}" stroke="#bcd3ff" stroke-opacity=".7"/>`); } }
    if (["neve", "nevasca"].includes(wx.climate)) { for (let i = 0; i < 18; i++) { const x = (i * 31.7 + tc * 8) % size, y = (i * 13.3 + tc * 20) % c; cl.push(`<circle cx="${fx(x)}" cy="${fx(y)}" r="1.1" fill="#fff"/>`); } }
  }
  const above = bodies.filter(b => b.alt >= 0).map(b => b.svg).join("");
  const fog = wx?.enabled && wx.climate === "neblina" ? `<rect y="${c * 0.55}" width="${size}" height="${c * 0.5}" fill="#e6e8ee" fill-opacity=".45" filter="url(#${id}b)"/>` : "";
  // chão (metade de baixo) e a linha do horizonte
  const ground = `<rect y="${c}" width="${size}" height="${c}" fill="url(#${id}g)" fill-opacity=".9"/><line x1="0" x2="${size}" y1="${c}" y2="${c}" stroke="#f3d08a" stroke-width="1.5" stroke-opacity=".85"/>
    <text x="${fx(size * 0.12)}" y="${fx(c + 11)}" font-size="8" fill="#e8d9a8" fill-opacity=".8" font-family="Cinzel,serif">L</text><text x="${fx(size * 0.82)}" y="${fx(c + 11)}" font-size="8" fill="#e8d9a8" fill-opacity=".8" font-family="Cinzel,serif">O</text>`;
  return `<svg class="dial hz" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${parts.join("")}<g clip-path="url(#${id}c)">${g.join("")}${ground}<g clip-path="url(#${id}u)">${above}<g filter="url(#${id}b)">${cl.join("")}</g>${fog}</g></g></svg>`;
}
