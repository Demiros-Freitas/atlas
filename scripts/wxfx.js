// Clima animado sobre o mapa, em escala real.
// - O tamanho das nuvens vem da escala da cena (1 quadro = X km/milhas/pés): uma nuvem de chuva tem dezenas de km,
//   então num mapa de cidade uma só sombra pode cobrir o mapa inteiro.
// - A velocidade é a do vento (em tempo real; dá para acelerar em Natureza › Clima).
// - Região: só as sombras, numa camada própria em "multiplicar" logo acima do mapa (escurece a cor do mapa).
// - Mundo: as nuvens inteiras vistas do alto, com a sombra deslocada no chão (e sistemas de nuvens maiores).
// - Chuva, neve e relâmpagos só acontecem debaixo das nuvens que chovem. As gotas mantêm o tamanho na tela.
import { normWeather, mapOf, scaleOf, kmPerUnit, dataOf, normPoi, zoneOf, setting } from "./data.js";
import { regionContains, shapesOf } from "./geom.js";
export { kmPerUnit };
import { BEAUFORT, CLIMATES, ZONE_WX, MODULE_ID } from "./config.js";

// size: diâmetro das nuvens em km [mín, máx]; cover: fração do céu coberta; a: força da sombra; tint: cor que multiplica o mapa
const LOOK = {
  limpo: { size: [0.3, 1.5], cover: 0.05, a: 0.30, tint: [252, 252, 253] },
  calor: { size: [0.2, 1.0], cover: 0.02, a: 0.24, tint: [255, 240, 214] },
  nublado: { size: [2, 15], cover: 0.55, a: 0.46, tint: [228, 230, 236] },
  neblina: { size: [1, 1], cover: 0, a: 0, tint: [236, 237, 240], fog: true },
  chuva: { size: [6, 40], cover: 0.6, a: 0.56, tint: [214, 218, 227], rain: 1 },
  tempestade: { size: [8, 35], cover: 0.55, a: 0.66, tint: [200, 206, 219], rain: 2, flash: true },
  neve: { size: [6, 40], cover: 0.6, a: 0.45, tint: [226, 230, 240], snow: 1 },
  nevasca: { size: [25, 120], cover: 0.8, a: 0.55, tint: [208, 214, 228], snow: 2 }
};
let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/** Uma nuvem feita de vários "flocos" sobrepostos (forma irregular). */
function puffs(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const w = 38 + rnd() * 34, h = w * (0.7 + rnd() * 0.3);
    const x = 50 + (rnd() - 0.5) * 62 - w / 2, y = 52 + (rnd() - 0.5) * 34 - h / 2;
    out.push([x, y, w, h]);
  }
  return out;
}
/** Os flocos viram camadas de fundo de um único elemento (bem mais leve que um elemento por floco). */
function puffBg(pf, W, H, kind) {
  const g = kind === "sh" ? "radial-gradient(closest-side,rgba(52,60,82,var(--a)),rgba(52,60,82,calc(var(--a) * .62)) 55%,rgba(52,60,82,0))"
    : "radial-gradient(closest-side,rgba(255,255,255,var(--a)),rgba(250,251,253,calc(var(--a) * .9)) 50%,rgba(240,243,248,calc(var(--a) * .45)) 75%,rgba(240,243,248,0))";
  return `background:${pf.map(([x, y, w, h]) => `${g} ${(x * W / 100).toFixed(0)}px ${(y * H / 100).toFixed(0)}px/${(w * W / 100).toFixed(0)}px ${(h * H / 100).toFixed(0)}px no-repeat`).join(",")}`;
}

export function cloudMode(ui, w) { return cloudModeOf(ui.scene, w); }
export function cloudModeOf(sc, w) {
  if (w.clouds !== "auto") return w.clouds;
  return mapOf(sc)?.level === "mundo" ? "inteiras" : "sombras";
}
const WET = new Set(["chuva", "tempestade", "neve", "nevasca"]);
const now = () => Date.now() / 1000;
/** Relógio das nuvens: o tempo real mais o tempo do mundo (quando o relógio anda, pelo Cronos ou por saltos, as nuvens andam junto). */
function gameNow() { const cr = game.modules?.get?.("brumas-cronos"); try { const v = cr?.active ? cr.api?.now?.() : null; if (Number.isFinite(v)) return v; } catch (e) { /* */ } return Number(game.time?.worldTime) || 0; }
export const cloudClock = (w) => now() + gameNow() / Math.max(1, Number(w?.cloudTime) || 1);
let lastFx = { el: null, mul: null, w: null };
/** Põe cada nuvem onde ela deve estar agora (sem refazer as nuvens): as que viajam com o vento (topos e sombras),
 *  as presas ao terreno e a neblina — todas seguem o relógio das nuvens (tempo real + tempo do mundo). */
export function syncClouds() { const { el, mul, w } = lastFx; if (!w) return; const t = cloudClock(w);
  for (const root of [el, mul]) { if (!root?.isConnected) continue;
    for (const c of root.querySelectorAll(".wxcloud[data-d]")) { const d = Number(c.dataset.d), ph = Number(c.dataset.ph); if (d > 0) c.style.animationDelay = `${(-(((t + ph) % d) + d) % d).toFixed(2)}s`; }
    // vaivém (alternate): o ciclo completo é 2× a duração
    for (const c of root.querySelectorAll("[data-ad]")) { const d = Number(c.dataset.ad), ph = Number(c.dataset.ph) || 0; if (d > 0) c.style.animationDelay = `${(-(((t + ph) % (2 * d)) + 2 * d) % (2 * d)).toFixed(2)}s`;
      // nuvens presas ao terreno se formam e se desfazem devagar ao longo das horas do mundo
      const lp = Number(c.dataset.lp); if (lp > 0) { const k = 0.5 + 0.5 * Math.sin((t + ph * 7) / lp * 2 * Math.PI); c.style.opacity = (0.25 + 0.75 * k).toFixed(3); } } } }

/* ---------- terreno e clima ----------
   Com a opção ligada: mar e lagos formam nuvens próprias (e chovem mais quando o tempo está úmido);
   montanhas seguram nuvens no topo e chovem nelas; no deserto as nuvens se desfazem (quase sem sombra e sem chuva). */
const regionsOf = (sc) => sc?.regions?.contents ?? [...(sc?.regions ?? [])];
function bboxOf(shapes) {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity; const add = (x, y) => { l = Math.min(l, x); t = Math.min(t, y); r = Math.max(r, x); b = Math.max(b, y); };
  for (const s of shapes) { if (s.hole) continue;
    if (s.type === "polygon") for (let i = 0; i < (s.points?.length ?? 0); i += 2) add(s.points[i], s.points[i + 1]);
    else if (s.type === "rectangle") { add(s.x, s.y); add(s.x + s.width, s.y + s.height); }
    else if (s.type === "circle") { add(s.x - s.radius, s.y - s.radius); add(s.x + s.radius, s.y + s.radius); }
    else if (s.type === "ellipse") { add(s.x - s.radiusX, s.y - s.radiusY); add(s.x + s.radiusX, s.y + s.radiusY); } }
  return isFinite(l) ? { l, t, r, b, w: r - l, h: b - t } : null;
}
export function terrainZones(sc) {
  const out = [];
  for (const r of regionsOf(sc)) { const z = zoneOf(r); if (!z) continue;
    const kind = z.water ? "agua" : z.preset === "montanha" ? "montanha" : z.biome === "deserto" ? "deserto" : null; if (!kind) continue;
    const shapes = shapesOf(r); const bb = bboxOf(shapes); if (bb) out.push({ r, kind, shapes, bb }); }
  return out;
}
function terrainAt(T, x, y) { let k = null; for (const t of T) if (regionContains(t.r, x, y)) { if (t.kind === "montanha") return "montanha"; k = k ?? t.kind; } return k; }
function shapePath(s, X, Y) {
  if (s.type === "polygon") { const p = s.points ?? []; let d = ""; for (let i = 0; i < p.length; i += 2) d += `${i ? "L" : "M"}${(p[i] - X).toFixed(0)} ${(p[i + 1] - Y).toFixed(0)}`; return d + "Z"; }
  if (s.type === "rectangle") return `M${s.x - X} ${s.y - Y}h${s.width}v${s.height}h${-s.width}Z`;
  const rx = s.radius ?? s.radiusX, ry = s.radius ?? s.radiusY; const cx = s.x - X, cy = s.y - Y;
  return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
}
/** Máscara que apaga boa parte das nuvens sobre os desertos. */
function desertMask(T, X, Y, W, H) {
  const ds = T.filter(t => t.kind === "deserto"); if (!ds.length) return "";
  const d = ds.flatMap(t => t.shapes.filter(s => !s.hole).map(s => shapePath(s, X, Y))).join("");
  const blur = Math.max(W, H) * 0.012;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><filter id="b"><feGaussianBlur stdDeviation="${blur.toFixed(0)}"/></filter><g filter="url(#b)"><path fill="#fff" fill-rule="evenodd" d="M0 0H${W}V${H}H0Z${d}"/><path fill="#fff" fill-opacity=".22" d="${d}"/></g></svg>`;
  return `url('data:image/svg+xml;utf8,${encodeURIComponent(svg)}')`;
}

/* ---------- clima próprio do terreno ---------- */
/** Regiões com clima fixo (névoa, chuva, tempestade, neve, frio, calor). */
export function zoneWxList(sc) {
  const out = [];
  for (const r of regionsOf(sc)) { const f = r.flags?.[MODULE_ID]?.wx; const Z = ZONE_WX[f?.kind]; if (!Z) continue;
    const temp = f.temp === "" || f.temp == null || isNaN(Number(f.temp)) ? Z.temp ?? null : Number(f.temp);
    out.push({ r, kind: f.kind, Z, temp, shapes: shapesOf(r), name: r.name || Z.label }); }
  return out;
}
/** Clima fixo do terreno num ponto (o primeiro que valer). */
export function zoneWxAt(sc, x, y) { for (const z of zoneWxList(sc)) if (regionContains(z.r, x, y)) return z; return null; }
/** Aplica o clima fixo do terreno a um clima. */
export function withZone(w, z) {
  if (!z) return w; const climate = z.Z.climate ?? w.climate;
  return { ...w, enabled: true, climate, temp: z.temp ?? w.temp, zone: { kind: z.kind, name: z.name, label: z.Z.label } };
}

const fieldCache = new Map();
/** O "campo" de nuvens de um mapa: sempre o mesmo para o mesmo clima (todos os clientes veem igual), com a posição de cada nuvem
 *  calculável em qualquer instante. Coordenadas relativas ao canto da cena. */
export function cloudField(sc, w) {
  const key = JSON.stringify([setting("wxQuality", "media"), sc.id, w.climate, w.dir, w.force, w.rose?.north, w.clouds, w.cloudTime, w.cloudScale, w.cloudOff, w.terrain, sc.width, sc.height, sc.grid?.size, sc.grid?.distance, sc.grid?.units, regionsOf(sc).map(r => r.id + (r.flags?.["brumas-atlas"]?.zone?.preset ?? "") + (r.name ?? "") + shapesOf(r).length).join()]);
  let F = fieldCache.get(key); if (F) return F;
  F = buildField(sc, w); if (fieldCache.size > 30) fieldCache.clear(); fieldCache.set(key, F); return F;
}
function buildField(sc, w) {
  const X = sc.dimensions?.sceneX ?? 0, Y = sc.dimensions?.sceneY ?? 0, W = sc.dimensions?.sceneWidth ?? sc.width, H = sc.dimensions?.sceneHeight ?? sc.height;
  const mode = cloudModeOf(sc, w); const S = scaleOf(sc); const kmPx = Math.max(1e-7, S.perPx * kmPerUnit(S.units));
  seed = 7 + Math.round(w.dir) + w.force * 13;
  const lk = LOOK[w.climate] ?? LOOK.limpo; const kmh = BEAUFORT[w.force]?.[1] ?? 10;
  const to = ((w.dir + 180 + (w.rose?.north || 0)) % 360) * Math.PI / 180; const vx = Math.sin(to), vy = -Math.cos(to);
  const diag = Math.hypot(W, H); const big = Math.max(W, H);
  const sys = mode === "inteiras" ? 8 : 1;
  const minPx = lk.size[0] * sys * w.cloudScale / kmPx, maxPx = lk.size[1] * sys * w.cloudScale / kmPx;
  const pxs = Math.max(0.02, (Math.max(1, kmh) * 1.3 / 3600) / kmPx * (w.cloudTime || 1));
  const wet = !!(lk.rain || lk.snow);
  const F = { X, Y, W, H, mode, lk, kmPx, vx, vy, wet, full: false, clouds: [] };
  if (mode === "nenhuma" || lk.cover <= 0) return F;
  if (minPx > big * 1.3) { F.full = true; return F; }
  const avg = (minPx + Math.min(maxPx, big * 1.5)) / 2;
  // as nuvens se espalham por uma faixa maior que o mapa (entram de um lado e saem do outro): conta pela área percorrida
  const swept = (diag + avg) * (diag + 2 * avg);
  // qualidade (configuração do módulo): menos nuvens, maiores, para não pesar
  const Q = { alta: 60, media: 36, baixa: 18 }[setting("wxQuality", "media")] ?? 36;
  let n = Math.round(lk.cover * swept / (Math.PI / 4 * avg * avg * 0.62)); const grow = n > Q ? Math.sqrt(n / Q) : 1; n = Math.max(rnd() < lk.cover * 4 ? 1 : 0, Math.min(Q, n));
  for (let i = 0; i < n; i++) {
    const sz = (minPx + rnd() * (Math.min(maxPx, big * 1.5) - minPx)) * grow; const hh = sz * (0.5 + rnd() * 0.25);
    const off = (rnd() - 0.5) * (diag + sz); const cx = X + W / 2 - vy * off, cy = Y + H / 2 + vx * off;
    const half = diag / 2 + sz; const o2 = w.cloudOff?.[i] ?? [0, 0];
    const sx = cx - vx * half - X - sz / 2 + o2[0], sy = cy - vy * half - Y - hh / 2 + o2[1], ex = cx + vx * half - X - sz / 2 + o2[0], ey = cy + vy * half - Y - hh / 2 + o2[1];
    const a = Math.min(0.85, lk.a * (0.75 + rnd() * 0.45));
    const d = Math.min(3e6, (2 * half) / pxs) * (0.85 + rnd() * 0.3); const phase = rnd() * d;
    const pf = puffs(setting("wxQuality", "media") === "baixa" ? 3 : 4 + Math.floor(rnd() * 3));
    const raining = wet && rnd() < 0.85;
    const flash = lk.flash && raining ? [-rnd() * 9, 7 + rnd() * 8] : null;
    const topA = 0.62 + rnd() * 0.25;
    F.clouds.push({ i, sz, hh, sx, sy, ex, ey, a, d, phase, pf, raining, flash, topA });
  }
  addTerrain(F, sc, w, minPx, maxPx);
  return F;
}
/** Nuvens presas ao terreno: sobre o mar e lagos e no alto das montanhas. */
function addTerrain(F, sc, w, minPx, maxPx) {
  F.caps = []; F.T = []; F.mask = "";
  if (!w.terrain) return;
  const T = terrainZones(sc); F.T = T; if (!T.length) return;
  F.mask = desertMask(T, F.X, F.Y, F.W, F.H);
  if (F.mode === "nenhuma" || F.full) return;
  const s0 = seed; seed = 97 + Math.round(w.dir) * 3 + w.force * 7;
  const humid = WET.has(w.climate) || w.climate === "nublado"; const lk = F.lk;
  for (const t of T) {
    if (t.kind === "deserto") continue;
    if (t.kind === "montanha" && !humid) continue;
    const base = t.kind === "agua" ? (humid ? (minPx + maxPx) / 2 : Math.max(minPx * 2, 40)) : Math.min(t.bb.w, t.bb.h) * 0.7;
    const sz0 = Math.max(30, Math.min(base, Math.max(t.bb.w, t.bb.h) * 0.9));
    const area = t.bb.w * t.bb.h; let n = Math.round(area * (t.kind === "agua" ? (humid ? 0.35 : 0.12) : 0.3) / (sz0 * sz0 * 0.5)); n = Math.max(1, Math.min(8, n));
    for (let i = 0, tries = 0; i < n && tries < n * 6; tries++) {
      const x = t.bb.l + rnd() * t.bb.w, y = t.bb.t + rnd() * t.bb.h; if (!regionContains(t.r, x, y)) continue; i++;
      const sz = sz0 * (0.7 + rnd() * 0.5), hh = sz * (0.5 + rnd() * 0.2);
      const raining = (t.kind === "montanha" && humid) || (t.kind === "agua" && WET.has(w.climate) && rnd() < 0.9);
      F.caps.push({ x: x - F.X, y: y - F.Y, sz, hh, kind: t.kind, raining, a: Math.min(0.85, (lk.a || 0.4) * (0.8 + rnd() * 0.3)), pf: puffs(5 + Math.floor(rnd() * 3)), dur: 40 + rnd() * 50, delay: -rnd() * 60, life: 1800 + rnd() * 3600, topA: 0.6 + rnd() * 0.25 });
    }
  }
  seed = s0;
}
/** Onde está o centro de uma nuvem no instante t (segundos). */
export function cloudPos(c, t = now()) { const p = ((t + c.phase) % c.d) / c.d; return { x: c.sx + (c.ex - c.sx) * p + c.sz / 2, y: c.sy + (c.ey - c.sy) * p + c.hh / 2 }; }
/** O céu num ponto do mapa agora: debaixo de nuvem? chovendo? */
export function skyAt(sc, w, x, y, t = cloudClock(w)) {
  if (!w.enabled) return null;
  const F = cloudField(sc, w); const ter = F.T?.length ? terrainAt(F.T, x, y) : null;
  if (F.mode === "nenhuma" || F.lk.cover <= 0 || F.full) return { cover: F.lk.cover > 0, raining: F.wet && ter !== "deserto", ter };
  const lx = x - F.X, ly = y - F.Y;
  for (const c of F.caps ?? []) { const rx = c.sz * 0.42, ry = c.hh * 0.42; if (((lx - c.x - c.sz / 2) / rx) ** 2 + ((ly - c.y - c.hh / 2) / ry) ** 2 <= 1) return { cover: true, raining: c.raining, ter, oro: c.kind === "montanha" }; }
  if (ter === "deserto") return { cover: false, raining: false, ter };
  for (const c of F.clouds) { const p = cloudPos(c, t); const rx = c.sz * 0.42, ry = c.hh * 0.42; if (((lx - p.x) / rx) ** 2 + ((ly - p.y) / ry) ** 2 <= 1) return { cover: true, raining: c.raining || (ter === "montanha" && F.wet), ter }; }
  return { cover: false, raining: false, ter };
}

/** Ligação de um mapa filho com o mapa pai: a cena pai e o local (ponto) que abre este mapa. */
export function parentLink(scene) {
  const pid = mapOf(scene)?.parent; const ps = pid ? game.scenes.get(pid) : null; if (!ps || ps.id === scene.id) return null;
  const poi = dataOf(ps).pois.map(normPoi).find(p => p.submap === scene.id) ?? null;
  return { scene: ps, poi };
}
/** Clima de um local do mapa (ponto de interesse) agora, conforme as nuvens passam por cima dele. */
export function poiSky(scene, poi, t = null) {
  const w = effectiveWeather(scene); t ??= cloudClock(w); const z = zoneWxAt(scene, poi.x, poi.y);
  if (poi.wxFollow === false && (w.enabled || z)) return { immune: true, label: "Abrigado (não sofre o clima)" };
  if (z) { const c = z.Z.climate ?? (w.enabled ? w.climate : "limpo"); return { climate: c, label: `${z.Z.label}${z.temp != null ? ` · ${z.temp}°C` : ""}` }; }
  if (!w.enabled) return null;
  const k = localClimate(w, skyAt(scene, w, poi.x, poi.y, t));
  return { climate: k, label: `${CLIMATES[k]?.label ?? k} agora` };
}
function localClimate(pw, sky) {
  if (sky?.oro && sky.raining && pw.climate === "nublado") return "chuva"; // chuva de montanha
  if (sky?.ter === "deserto" && ["nublado", "chuva", "tempestade"].includes(pw.climate)) return sky.cover ? "nublado" : "limpo";
  if (!WET.has(pw.climate)) return pw.climate;
  if (!sky) return pw.climate;
  return sky.raining ? pw.climate : sky.cover ? "nublado" : "limpo";
}
/** Clima que vale de fato num mapa: o próprio, ou o do mapa pai no lugar onde este mapa fica (nuvens passando por cima). */
export function effectiveWeather(scene, raw = undefined, depth = 0) {
  const own = normWeather(raw ?? dataOf(scene).weather);
  if (own.source === "proprio" || depth > 4) return own;
  const L = parentLink(scene); if (!L) return own;
  const pw = effectiveWeather(L.scene, undefined, depth + 1); const pz = L.poi ? zoneWxAt(L.scene, L.poi.x, L.poi.y) : null;
  const link = { scene: L.scene.name, poi: L.poi?.name ?? "" };
  if (L.poi?.wxFollow === false && (pw.enabled || pz)) return { ...own, link: { ...link, immune: true } };
  if (pz) { const base = pw.enabled ? pw : { ...own, enabled: true }; return withZone({ ...own, enabled: true, players: base.players, climate: base.climate, dir: base.dir, force: base.force, temp: base.temp, note: base.note, link: { ...link, cover: true, raining: !!(pz.Z.rain || pz.Z.snow), zone: pz.Z.label } }, pz); }
  if (!pw.enabled) return own;
  const sky = L.poi ? skyAt(L.scene, pw, L.poi.x, L.poi.y) : null;
  const climate = localClimate(pw, sky);
  return { ...own, enabled: true, players: pw.players, climate, dir: pw.dir, force: pw.force, temp: pw.temp, note: pw.note,
    link: { ...link, cover: !!sky?.cover, raining: !!sky?.raining } };
}

export function renderWeatherFx(ui, root) {
  const sc = ui.scene; let world = root.querySelector(".wxworld");
  root.querySelector(".wxscreen")?.remove(); // camada antiga (chuva na tela toda)
  let mul = document.getElementById("atlas-wxmul");
  const w = ui.liveWx ? normWeather(ui.liveWx) : ui.wx; const L = ui.layers;
  const base = ui.open && sc && ui.map && L.wxfx !== false;
  const wOn = !!(base && w.enabled && (game.user.isGM || w.players));
  const Zs = base ? zoneWxList(sc) : []; // terrenos com clima próprio (sempre aparecem)
  if (!wOn && !Zs.length) { world?.remove(); mul?.remove(); return; }
  const X = sc.dimensions?.sceneX ?? 0, Y = sc.dimensions?.sceneY ?? 0, W = sc.dimensions?.sceneWidth ?? sc.width, H = sc.dimensions?.sceneHeight ?? sc.height;
  const mode = cloudModeOf(sc, w); const S = scaleOf(sc); const kmPx = Math.max(1e-7, S.perPx * kmPerUnit(S.units));
  const key = JSON.stringify([setting("wxQuality", "media"), sc.id, w.climate, w.dir, w.force, w.rose.north, mode, w.cloudTime, w.cloudScale, w.cloudOff, w.terrain, X, Y, W, H, kmPx, regionsOf(sc).length, wOn, Zs.map(z => [z.r.id, z.kind, JSON.stringify(z.shapes).length])]);
  if (!world) { world = document.createElement("div"); world.className = "wxworld"; root.prepend(world); }
  if (!mul) {
    mul = document.createElement("div"); mul.id = "atlas-wxmul";
    mul.style.cssText = "position:fixed;left:0;top:0;transform-origin:0 0;pointer-events:none;mix-blend-mode:multiply;overflow:hidden;";
    if (ui.host?.isConnected) ui.host.before(mul); else document.body.appendChild(mul);
  }
  lastFx = { el: root, mul, w };
  if (world.dataset.key !== key || mul.dataset.key !== key) {
    world.dataset.key = key; mul.dataset.key = key;
    const F = wOn ? cloudField(sc, w) : { lk: { ...LOOK.limpo, tint: [255, 255, 255] }, vx: 0, vy: 0, wet: false, clouds: [], caps: [], mask: "", full: false }; const lk = F.lk; const { vx, vy, wet } = F; const big = Math.max(W, H);
    const rsz = kmPx > 0.05 ? 70 : kmPx > 0.005 ? 95 : 120; // gotas menores em mapas de grande escala
    const rainCls = lk.rain ? "rain" : "snow";
    const shade = [], tops = []; let full = ""; const t = cloudClock(w);
    if (F.full) {
      shade.push(`<div class="wxsheet" style="background:rgba(52,60,82,${(lk.a * 0.75).toFixed(3)})"></div>`);
      if (mode === "inteiras") tops.push(`<div class="wxfull" style="background:rgba(246,248,251,.55)"></div>`);
      full = `<div class="wxfull">${wet ? `<div class="rn ${rainCls}"><i></i></div>` : ""}${lk.flash ? `<i class="lf"></i>` : ""}</div>`;
    }
    for (const c of F.clouds) {
      const delay = -((t + c.phase) % c.d); // mesma posição em todos os clientes
      const box = (ox, oy, cls, alpha, inner) => `<div class="wxcloud ${cls}" data-ci="${c.i}" data-ph="${c.phase.toFixed(3)}" data-d="${c.d.toFixed(3)}" style="${cls === "wet" ? "" : puffBg(c.pf, c.sz, c.hh, cls) + ";"}width:${c.sz.toFixed(0)}px;height:${c.hh.toFixed(0)}px;--sx:${(c.sx + ox).toFixed(0)}px;--sy:${(c.sy + oy).toFixed(0)}px;--ex:${(c.ex + ox).toFixed(0)}px;--ey:${(c.ey + oy).toFixed(0)}px;--a:${alpha.toFixed(3)};animation-duration:${c.d.toFixed(1)}s;animation-delay:${delay.toFixed(1)}s">${inner}</div>`;
      const fx = `${c.raining ? `<div class="rn ${rainCls}"><i></i></div>` : ""}${c.flash && setting("wxQuality", "media") !== "baixa" ? `<i class="lf" style="animation-delay:${c.flash[0].toFixed(1)}s;animation-duration:${c.flash[1].toFixed(1)}s"></i>` : ""}`;
      if (mode === "inteiras") { shade.push(box(c.sz * 0.07, c.sz * 0.12, "sh", c.a * 0.8, "")); tops.push(box(0, 0, "top", c.topA, fx)); }
      else { shade.push(box(0, 0, "sh", c.a, "")); if (fx) tops.push(box(0, 0, "wet", 1, fx)); }
    }
    for (const c of F.caps ?? []) { // nuvens presas ao terreno (sobem e descem devagar no lugar)
      const st = (cls, alpha, inner, ox = 0, oy = 0) => `<div class="wxcloud wxcap ${cls}" data-ad="${c.dur.toFixed(1)}" data-ph="${(-c.delay).toFixed(1)}" data-lp="${c.life.toFixed(0)}" style="${cls === "wet" ? "" : puffBg(c.pf, c.sz, c.hh, cls) + ";"}left:${(c.x + ox).toFixed(0)}px;top:${(c.y + oy).toFixed(0)}px;width:${c.sz.toFixed(0)}px;height:${c.hh.toFixed(0)}px;--a:${alpha.toFixed(3)};--dx:${(vx * c.sz * 0.12).toFixed(0)}px;--dy:${(vy * c.sz * 0.12).toFixed(0)}px;animation-duration:${c.dur.toFixed(0)}s;animation-delay:${c.delay.toFixed(0)}s">${inner}</div>`;
      const fx = c.raining ? `<div class="rn ${lk.snow ? "snow" : "rain"}"><i></i></div>` : "";
      if (mode === "inteiras") { shade.push(st("sh", c.a * 0.8, "", c.sz * 0.07, c.sz * 0.12)); tops.push(st("top", c.topA, fx)); }
      else { shade.push(st("sh", c.a, "")); if (fx) tops.push(st("wet", 1, fx)); }
    }
    const fog = [];
    if (lk.fog) for (let i = 0; i < 9; i++) {
      const sz = (0.3 + rnd() * 0.4) * big; const fx = rnd() * W - sz / 2, fy = rnd() * H - sz / 2;
      { const fd = 60 + rnd() * 60, fp = rnd() * 60; fog.push(`<div class="wxfog" data-ad="${fd.toFixed(1)}" data-ph="${fp.toFixed(1)}" style="width:${sz.toFixed(0)}px;height:${(sz * 0.45).toFixed(0)}px;left:${fx.toFixed(0)}px;top:${fy.toFixed(0)}px;--dx:${(vx * W * 0.05).toFixed(0)}px;--dy:${(vy * H * 0.05).toFixed(0)}px;animation-duration:${fd.toFixed(0)}s;animation-delay:${(-fp).toFixed(0)}s"></div>`); }
    }
    // terrenos com clima próprio: recortados no formato da Região
    const zw = [], zm = [];
    for (const z of Zs) {
      const d = z.shapes.filter(sh => !sh.hole).map(sh => shapePath(sh, X, Y)).join(""); if (!d) continue; const Z = z.Z;
      const clip = `clip-path:path('${d}')`; const bb = bboxOf(z.shapes); if (!bb) continue;
      zm.push(`<div class="wxzone" style="${clip};background:rgb(${Z.mul.join(",")})"></div>`);
      let inner = "";
      if (Z.rain || Z.snow) inner += `<div class="wxfull" style="--rdur:${Z.rain === 2 ? 0.35 : 0.55}s;--sdur:${Z.snow === 2 ? 4 : 9}s"><div class="rn ${Z.rain ? "rain" : "snow"}"><i></i></div>${Z.flash ? `<i class="lf"></i>` : ""}</div>`;
      if (z.kind === "neblina") { inner += `<div class="wxfull zfog"></div>`; for (let i = 0; i < 6; i++) { const sz = Math.max(bb.w, bb.h) * (0.35 + rnd() * 0.3); const fd = 50 + rnd() * 50, fp = rnd() * 50; inner += `<div class="wxfog" data-ad="${fd.toFixed(1)}" data-ph="${fp.toFixed(1)}" style="width:${sz.toFixed(0)}px;height:${(sz * 0.45).toFixed(0)}px;left:${(bb.l - X + rnd() * bb.w - sz / 2).toFixed(0)}px;top:${(bb.t - Y + rnd() * bb.h - sz * 0.22).toFixed(0)}px;--dx:${(sz * 0.08).toFixed(0)}px;--dy:${(sz * 0.03).toFixed(0)}px;animation-duration:${fd.toFixed(0)}s;animation-delay:${(-fp).toFixed(0)}s"></div>`; } }
      if (Z.snow === 2 || z.kind === "neve") inner += `<div class="wxfull zsnow"></div>`;
      if (Z.frost) inner += `<div class="wxfull zfrost"></div>`;
      if (Z.heat) inner += `<div class="wxfull zheat"></div>`;
      if (inner) zw.push(`<div class="wxzone" style="${clip}">${inner}</div>`);
    }
    // escurecimento geral (multiplica) + sombras
    const mk = F.mask ? ` style="position:absolute;inset:0;-webkit-mask:${F.mask} 0 0/100% 100% no-repeat;mask:${F.mask} 0 0/100% 100% no-repeat"` : ` style="position:absolute;inset:0"`;
    mul.innerHTML = `${wOn ? `<div class="wxtint" style="background:rgb(${lk.tint.join(",")})"></div>` : ""}<div class="wxshd"${mk}>${shade.join("")}</div>${zm.join("")}`;
    world.innerHTML = `<div class="wxshd"${mk}>${tops.join("")}${full}</div>` + fog.join("") + zw.join("");
    const slant = Math.max(-35, Math.min(35, -vx * (8 + w.force * 3)));
    world.style.setProperty("--slant", `${slant}deg`); world.style.setProperty("--rsz", `${rsz}px`);
    world.style.setProperty("--rdur", `${lk.rain === 2 ? 0.35 : 0.55}s`); world.style.setProperty("--sdur", `${lk.snow === 2 ? 4 : 9}s`); world.style.setProperty("--sdx", `${(vx * 120).toFixed(0)}px`); syncClouds();
  }
  // acompanha o canvas
  const t = canvas.stage.worldTransform; const r = ui.view.getBoundingClientRect();
  const tf = `matrix(${t.a},0,0,${t.d},${r.left + t.tx + X * t.a},${r.top + t.ty + Y * t.d})`;
  for (const el of [world, mul]) { el.style.transform = tf; el.style.width = `${W}px`; el.style.height = `${H}px`; }
  world.style.setProperty("--zinv", String(1 / (t.a || 1)));
}
