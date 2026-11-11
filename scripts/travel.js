// Viagem: rede de rotas, melhor caminho, dias de marcha e a execução (tempo, névoa, descobertas, encontros).
import { MODULE_ID, SOCKET, ROUTE_TYPES, PACES, MODES, HOURS_PER_DAY, REVEAL_CELLS, SIGHT_CELLS, POI_STATES, isAir } from "./config.js";
import { setting, dataOf, normPoi, normRoute, normMover, normWeather, zoneOf, scaleOf, mutateData, addLog, esc, miPerUnit, pnow, waitPlay, isActiveGM, mapScenes } from "./data.js";
import { regionContains, shapesOf, dist, polyLength, pointAt, sample, curvePoints, nearestOnPoly } from "./geom.js";
import { transportOf, transportIcon, actorRef } from "./transport.js";
import { globeOf, wrapOf, wrapX, unwrapNear, unwrapPts, seamPieces, routeLine, gcPoints, pathKm } from "./wrap.js";
import { effectiveWeather, zoneWxList, skyAt } from "./wxfx.js";

const regionsOf = (scene) => scene?.regions?.contents ?? [...(scene?.regions ?? [])];

/** Zonas da cena (Regiões reconhecidas), já com a Região para testar pontos. */
/* contexto do planejamento atual: quem viaja e se usa portais (lido pelo grafo) */
let TPX = { off: false, mover: null, scene: null, closed: [] };
/** Por que o portal está fechado para este grupo agora (null = aberto). */
export function portalWhy(o, mover, scene, pw = null) {
  if (!o) return null; const api = game.modules.get(MODULE_ID)?.api; const t = game.time.worldTime;
  if (o.tpKey) { const k = o.tpKey.toLowerCase(); const has = (mover?.members ?? []).some(r => { const a = actorRef(r); return a?.items?.some?.(i => i.name?.toLowerCase().includes(k)); }) || (() => { const v = mover?.vehicle ? actorRef(mover.vehicle) : null; return !!v?.items?.some?.(i => i.name?.toLowerCase().includes(k)); })();
    if (!has) return `precisa de ${o.tpKey}`; }
  if (o.tpPw) { const raw = (dataOf(scene).movers ?? []).find(x => x.id === mover?.id); const known = (raw?.pw ?? []).map(x => String(x).toLowerCase());
    if (!known.includes(o.tpPw.toLowerCase()) && String(pw ?? "").trim().toLowerCase() !== o.tpPw.toLowerCase()) return "precisa da senha"; }
  if (o.tpMoon) { let ms = []; try { ms = api?.moonsAt?.(t, scene) ?? []; } catch (e) { /* */ }
    if (ms.length && !ms.some(m => String(m.label).includes(o.tpMoon))) return `só abre na lua ${o.tpMoon}`; }
  if (o.tpTime) { let day = null; try { const s = api?.sunAt?.(t, scene); if (s && Number.isFinite(s.alt)) day = s.alt > 0; } catch (e) { /* */ }
    day ??= (() => { const h = ((t % 86400) + 86400) % 86400 / 3600; return h >= 6 && h < 18; })();
    if (o.tpTime === "dia" && !day) return "só abre de dia"; if (o.tpTime === "noite" && day) return "só abre à noite"; }
  return null;
}
/** Teleporte ligado nas configurações do módulo? */
export const teleportOn = () => { try { return !!game.settings.get(MODULE_ID, "teleport"); } catch (e) { return false; } };
export function zonesOf(scene) { const out = regionsOf(scene).map(r => ({ r, z: zoneOf(r) })).filter(x => x.z); out.base = mapZone(scene); return out; }
/** Terreno geral do mapa (vale onde nenhuma Região se aplica). */
export function mapZone(scene) {
  const z = dataOf(scene).map?.zone; if (!z || !Object.keys(z).length) return null;
  return { id: "__map", name: "Mapa inteiro", label: "Geral", mult: z.mult != null && z.mult !== "" ? Number(z.mult) || 1 : 1, biome: z.biome || "planicie", chance: Array.isArray(z.chance) ? z.chance : [1, 8], table: z.table ?? "", color: "#888", configured: true };
}
/** Zona que vale num ponto: a de menor multiplicador entre as que contêm o ponto (ignora faixas de estrada). */
export function zoneAt(zones, x, y) {
  let best = null;
  for (const { r, z } of zones) if (z.base && regionContains(r, x, y)) return z; // fundação fica por cima de tudo
  for (const { r, z } of zones) { if (z.guide || z.base) continue; if (!regionContains(r, x, y)) continue; if (!best || z.mult < best.mult) best = z; }
  return best ?? zones.base ?? null;
}

/** Perfil do terreno ao longo de uma linha: multiplicador médio e quanto de cada zona. */
function profile(pts, zones, step) {
  const sp = sample(pts, step); const count = {}; let sum = 0;
  for (const p of sp) { const z = zoneAt(zones, p[0], p[1]); sum += z ? z.mult : 1; const k = z?.id ?? "_"; (count[k] ??= { z, n: 0 }).n++; }
  const n = sp.length || 1;
  return { mult: sum / n, parts: Object.values(count).map(c => ({ z: c.z, frac: c.n / n })) };
}

/** Velocidade (mi/h) para um modo, a partir do transporte do grupo e do ritmo. */
function speedFor(tr, use, pace) {
  const f = PACES[pace]?.f ?? 1;
  const base = use === tr.mode ? tr.mph : use === "pe" ? tr.walk : tr.mph;
  return Math.max(0.2, base * f);
}
const SIMPLE_TR = (mode = "pe") => ({ mode, mph: mode === "montaria" ? 4 : 3, walk: 3 });

/** Vento a favor (+1) ou contra (−1) para um trecho, segundo o clima da cena. */
function windFactor(w, pts) {
  if (!w?.enabled || pts.length < 2) return 0;
  const a = pts[0], b = pts[pts.length - 1]; const heading = (Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180 / Math.PI + 360) % 360;
  const to = (w.dir + 180 + (w.rose?.north ?? 0)) % 360; return Math.cos((to - heading) * Math.PI / 180) * Math.min(w.force, 8) / 8;
}

/* ---------- água, pontes e cruzamentos ---------- */
const WATER_ROUTE = new Set(["rio", "mar"]);
export const isWaterRoute = (type) => WATER_ROUTE.has(type);
/** Veículos de terra (carroças, carruagens) não atravessam rios nem regiões de água fora de pontes. */
export const landVehicle = (tr) => tr?.mode === "carruagem";
/** Navio preso à água (configuração do módulo). */
export const waterOnly = (tr) => tr?.mode === "barco" && setting("shipsWaterOnly", true) !== false;
function segX(a, b, c, d) {
  const r0 = b[0] - a[0], r1 = b[1] - a[1], s0 = d[0] - c[0], s1 = d[1] - c[1]; const den = r0 * s1 - r1 * s0; if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s1 - (c[1] - a[1]) * s0) / den, u = ((c[0] - a[0]) * r1 - (c[1] - a[1]) * r0) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null; return { t, u, pt: [a[0] + t * r0, a[1] + t * r1] };
}
/** Onde duas linhas se cruzam (com a posição ao longo de cada uma). */
function crossings(A, B) {
  const out = []; let sa = 0;
  for (let i = 1; i < A.length; i++) { const la = dist(A[i - 1], A[i]); let sb = 0;
    for (let j = 1; j < B.length; j++) { const lb = dist(B[j - 1], B[j]); const x = segX(A[i - 1], A[i], B[j - 1], B[j]); if (x) out.push({ sA: sa + x.t * la, sB: sb + x.u * lb, pt: x.pt }); sb += lb; }
    sa += la; }
  return out;
}
// as fundações entram junto: onde há fundação não é água
const waterZonesOf = (zones) => zones.filter(({ z }) => z.water || z.base);
const onBase = (wz, x, y) => wz.some(({ r, z }) => z.base && regionContains(r, x, y));
const inWater = (wz, x, y) => !onBase(wz, x, y) && wz.some(({ r, z }) => z.water && regionContains(r, x, y));
/** Tipo de água num ponto: "funda" (só com veículo), "rasa" (dá vau) ou "agua" (comum); null fora da água. */
/** O terreno no ponto proíbe este modo (só quando o mestre escolheu "quem passa")? */
export function zoneForbids(zones, x, y, mode) {
  const b = zones.find(({ r, z }) => z.base && regionContains(r, x, y)); if (b) return b.z.modes && !b.z.modes.includes(mode) ? b.z : null;
  for (const { r, z } of zones) { if (z.base) continue; if (!z.modes || z.modes.includes(mode)) continue; if (regionContains(r, x, y)) return z; } return null; }
function waterKind(wz, x, y) { let k = null; if (onBase(wz, x, y)) return null; for (const { r, z } of wz) if (z.water && regionContains(r, x, y)) { if (z.deep) return "funda"; k = z.shallow ? (k ?? "rasa") : "agua"; } return k; }
const bkey = (x, y) => `${Math.round(x / 10) * 10}:${Math.round(y / 10) * 10}`;
const bridgeCache = new Map();
/**
 * Pontes: onde uma rota de terra cruza um rio (rota de rio) ou uma Região de água.
 * Cada ponte tem uma chave pela posição; o mestre marca as quebradas em route.bridges[chave] = "quebrada".
 */
export function bridgesOf(scene) {
  const d = dataOf(scene); const zones = zonesOf(scene); const wz = waterZonesOf(zones); const sc = scaleOf(scene);
  const ck = JSON.stringify([scene.id, d.routes.map(r => [r.id, r.type, r.points, r.handles, r.bridges]), wz.map(({ r }) => [r.id, shapesKey(r)])]);
  const c = bridgeCache.get(scene.id); if (c?.ck === ck) return c.list;
  const routes = d.routes.map(normRoute).filter(r => r.points.length >= 2); const list = [];
  const water = routes.filter(r => isWaterRoute(r.type)).map(r => curvePoints(r.points, r.handles));
  const land = routes.filter(r => !isWaterRoute(r.type) && r.type !== "aerea" && r.type !== "portal").map(r => { const P = curvePoints(r.points, r.handles); return { r, P, L: polyLength(P), spans: [] }; });
  const bz = zones.filter(({ z }) => z.base); const onB = (q) => bz.some(({ r: g }) => regionContains(g, q[0], q[1]));
  /** Acha a borda exata entre s0 (estado a) e s1 (estado diferente), por bisseção. */
  const edge = (P, L, s0, s1, test) => { const a = test(pointAt(P, Math.min(L, Math.max(0, s0)))); for (let k = 0; k < 10; k++) { const m = (s0 + s1) / 2; if (test(pointAt(P, Math.min(L, m))) === a) s0 = m; else s1 = m; } return (s0 + s1) / 2; };
  // água (Regiões): a ponte vai exatamente de margem a margem
  if (wz.length) for (const R of land) { const { P, L } = R; const step = Math.max(3, sc.size / 6); const w = (q) => inWater(wz, q[0], q[1]); let s0 = null, prev = false;
    for (let s = 0; s <= L + 1e-6; s += step) { const cur = w(pointAt(P, Math.min(s, L)));
      if (cur && !prev && s > 0) s0 = edge(P, L, s - step, s, w); else if (cur && !prev) s0 = 0;
      if (!cur && prev && s0 != null) { const s1 = edge(P, L, s - step, s, w); if (s0 > 0.5) R.spans.push([s0, s1]); s0 = null; }
      prev = cur; } }
  // rio desenhado como rota: uma ponte curta no cruzamento (não em cima de fundação)
  for (const R of land) for (const W of water) for (const x of crossings(R.P, W)) if (!onBase(wz, x.pt[0], x.pt[1])) R.spans.push([Math.max(0, x.sA - sc.size * 0.2), Math.min(R.L, x.sA + sc.size * 0.2)]);
  // fundação: canal entre duas fundações. As ruas que continuam umas nas outras (mesma direção) são lidas como uma linha só,
  // e a ponte vale só para o trecho fora da fundação que tem fundação dos dois lados (não avança na terra).
  if (bz.length) {
    const snap = sc.size * 0.75, COS = Math.cos(50 * Math.PI / 180);
    const dirAt = (P, atEnd) => { const n = P.length; const A = atEnd ? P[n - 1] : P[0]; let Q = A; for (let k = 1; k < n; k++) { Q = atEnd ? P[n - 1 - k] : P[k]; if (dist(Q, A) >= snap * 0.6) break; } const dx = A[0] - Q[0], dy = A[1] - Q[1]; const l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
    const ends = []; land.forEach((R, i) => { ends.push({ i, e: 0, pt: R.P[0], dir: dirAt(R.P, false) }, { i, e: 1, pt: R.P[R.P.length - 1], dir: dirAt(R.P, true) }); });
    const pairs = []; for (let a = 0; a < ends.length; a++) for (let b = a + 1; b < ends.length; b++) { const A = ends[a], B = ends[b]; if (A.i === B.i || dist(A.pt, B.pt) > snap) continue; const dot = -(A.dir[0] * B.dir[0] + A.dir[1] * B.dir[1]); if (dot >= COS) pairs.push({ A, B, dot }); }
    pairs.sort((x, y) => y.dot - x.dot); const link = new Map(); const kk = (E) => `${E.i}:${E.e}`;
    for (const { A, B } of pairs) { if (link.has(kk(A)) || link.has(kk(B))) continue; link.set(kk(A), B); link.set(kk(B), A); }
    // monta as cadeias: [{ i, rev, off }]
    const seen = new Set(); const chains = [];
    const pushSpan = (chain, g0, g1) => { for (const c of chain) { const R = land[c.i]; const a = Math.max(g0, c.off), z = Math.min(g1, c.off + R.L); if (z - a > 0.5) R.spans.push(c.rev ? [R.L - (z - c.off), R.L - (a - c.off)] : [a - c.off, z - c.off]); } };
    for (let i0 = 0; i0 < land.length; i0++) { if (seen.has(i0)) continue;
      // volta até o começo da cadeia
      let i = i0, startEnd = 0, guard = 0; while (guard++ < land.length) { const prev = link.get(`${i}:${startEnd}`); if (!prev || prev.i === i0) break; i = prev.i; startEnd = prev.e === 0 ? 1 : 0; }
      const chain = []; let off = 0; let cur = i, enter = startEnd; guard = 0;
      while (cur != null && !seen.has(cur) && guard++ <= land.length) { seen.add(cur); const R = land[cur]; chain.push({ i: cur, rev: enter === 1, off }); off += R.L;
        const nx = link.get(`${cur}:${enter === 0 ? 1 : 0}`); if (!nx) break; cur = nx.i; enter = nx.e; }
      const total = off; const at = (s) => { for (const c of chain) { const R = land[c.i]; if (s <= c.off + R.L + 1e-6) { const ls = Math.max(0, Math.min(R.L, s - c.off)); return pointAt(R.P, c.rev ? R.L - ls : ls); } } const c = chain[chain.length - 1]; const R = land[c.i]; return pointAt(R.P, c.rev ? 0 : R.L); };
      const step = Math.max(3, sc.size / 6); const maxGap = sc.size * 6;
      const edgeC = (s0, s1) => { const a = onB(at(s0)); for (let k = 0; k < 10; k++) { const m = (s0 + s1) / 2; if (onB(at(m)) === a) s0 = m; else s1 = m; } return (s0 + s1) / 2; };
      let prev = null, g0 = null;
      for (let s = 0; s <= total + 1e-6; s += step) { const b = onB(at(Math.min(s, total)));
        if (prev === true && !b) g0 = edgeC(s - step, s);
        if (prev === false && b && g0 != null) { const g1 = edgeC(s - step, s); const len = g1 - g0;
          if (len >= step && len <= maxGap) pushSpan(chain, g0, g1);
          g0 = null; }
        if (b) g0 = null; prev = b; }
      chains.push({ chain, at, total, edgeC, step, maxGap }); }
    // rua que sai do meio de uma ponte (cruzamento em cima do canal): a ponte vai do cruzamento até a próxima fundação
    const onBridge = (pt) => land.some(R => R.spans.some(([a, z]) => { const n = Math.max(2, Math.ceil((z - a) / (sc.size / 6))); for (let k = 0; k <= n; k++) if (dist(pointAt(R.P, a + (z - a) * k / n), pt) <= snap * 0.7) return true; return false; }));
    for (const C of chains) { const { chain, at, total, edgeC, step, maxGap } = C;
      if (!onB(at(0)) && onBridge(at(0))) { for (let s = step; s <= Math.min(total, maxGap); s += step) if (onB(at(s))) { pushSpan(chain, 0, edgeC(s - step, s)); break; } }
      if (!onB(at(total)) && onBridge(at(total))) { for (let s = total - step; s >= Math.max(0, total - maxGap); s -= step) if (onB(at(s))) { pushSpan(chain, edgeC(s, s + step), total); break; } } }
  }
  for (const R of land) { const { r, P, L } = R;
    const spans = R.spans.sort((a, b) => a[0] - b[0]); const merged = [];
    for (const sp of spans) { const l = merged[merged.length - 1]; if (l && sp[0] <= l[1] + 0.5) l[1] = Math.max(l[1], sp[1]); else merged.push([...sp]); }
    for (const [s0, s1] of merged) { const m = pointAt(P, (s0 + s1) / 2), a = pointAt(P, s0), b = pointAt(P, s1); const key = bkey(m[0], m[1]);
      const n = Math.max(2, Math.ceil((s1 - s0) / Math.max(3, sc.size / 8))); const pts = []; for (let k = 0; k <= n; k++) pts.push(pointAt(P, s0 + (s1 - s0) * k / n)); // segue a curva da estrada
      list.push({ pts, routeId: r.id, key, x: m[0], y: m[1], s0, s1, ang: Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI, len: s1 - s0, broken: (r.bridges ?? {})[key] === "quebrada", removed: (r.bridges ?? {})[key] === "nenhuma", openA: s0 < 1, openB: s1 > L - 1 }); }
  }
  bridgeCache.set(scene.id, { ck, list }); return list;
}
// assinatura da forma (qualquer nó movido muda a chave e refaz pontes e grades)
function shapesKey(r) { try { const t = JSON.stringify(shapesOf(r)); let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return `${t.length}:${h}`; } catch (e) { return 0; } }

/** Monta a rede: nós (locais, encruzilhadas, cruzamentos) e arestas (pedaços de rotas) com custo em horas. */
export function buildGraph(scene, { pace = "normal", tr = SIMPLE_TR(), gm = game.user.isGM } = {}) {
  const d = dataOf(scene); const sc = { ...scaleOf(scene) }; sc.mi = miPerUnit(sc.units); const zones = zonesOf(scene); const wx = effectiveWeather(scene);
  const pois = d.pois.map(normPoi).filter(p => gm || p.state !== "oculto");
  const snap = sc.size * 0.75; const tol = sc.size * 0.3; const nodes = new Map();
  for (const p of pois) nodes.set(`p:${p.id}`, { key: `p:${p.id}`, poi: p, x: p.x, y: p.y, name: p.state === "rumor" && !gm ? "Local desconhecido" : p.name });
  const free = [];
  const nodeFor = (pt, poiId) => {
    if (poiId && nodes.has(`p:${poiId}`)) return `p:${poiId}`;
    let best = null, bd = snap;
    for (const n of nodes.values()) { const dd = Math.hypot(wrapX(n.x, SW) - wrapX(pt[0], SW), n.y - pt[1]); if (dd <= bd) { bd = dd; best = n.key; } }
    if (best) return best;
    const key = `x:${free.length}`; const n = { key, x: pt[0], y: pt[1], name: "encruzilhada" }; free.push(n); nodes.set(key, n); return key;
  };
  const tpOn = teleportOn(); const routes = d.routes.map(normRoute).filter(r => r.points.length >= 2 && r.cond !== "bloqueada" && !(r.hidden && !gm) && (r.type !== "portal" || tpOn));
  const GW = globeOf(scene); const SW = GW?.S ?? wrapOf(scene); const P = routes.map(r => r.type === "portal" ? [r.points[0], r.points[r.points.length - 1]] : routeLine(r, GW)); const Ls = P.map(polyLength);
  const ends = routes.map((r, i) => [nodeFor(P[i][0], r.a), nodeFor(P[i][P[i].length - 1], r.b)]);
  const ev = routes.map(() => []); // { s, key } (nós no meio da rota) e { gap: [s0, s1] } (ponte quebrada)
  const cls = (r) => r.type === "portal" ? "p" : isWaterRoute(r.type) ? "w" : "l";
  // bifurcações: rotas do mesmo tipo (terra com terra, água com água) que se cruzam ou que terminam no meio de outra
  for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
    if (cls(routes[i]) !== cls(routes[j]) || cls(routes[i]) === "p") continue;
    for (const x of crossings(P[i], P[j])) {
      const nearEnd = (k, s) => s <= tol || s >= Ls[k] - tol; if (nearEnd(i, x.sA) && nearEnd(j, x.sB)) continue;
      const key = nodeFor(x.pt); ev[i].push({ s: x.sA, key }); ev[j].push({ s: x.sB, key });
    }
  }
  for (let i = 0; i < routes.length; i++) for (const [k, pt] of [[0, P[i][0]], [1, P[i][P[i].length - 1]]]) {
    if (cls(routes[i]) === "p") continue;
    for (let j = 0; j < routes.length; j++) { if (j === i || cls(routes[i]) !== cls(routes[j])) continue;
      const pr = projArc(P[j], pt); if (pr.d <= snap && pr.s > tol && pr.s < Ls[j] - tol) ev[j].push({ s: pr.s, key: ends[i][k] }); }
  }
  // pontes quebradas cortam a rota
  const bridges = bridgesOf(scene);
  routes.forEach((r, i) => { for (const b of bridges) if (b.routeId === r.id && b.broken && !b.removed) ev[i].push({ gap: [b.s0, b.s1] }); });
  const mode = tr.mode; const edges = []; let gapN = 0;
  routes.forEach((r, i) => {
    if (r.type === "portal") { // ligação de portais: linha reta de portal a portal; cada sentido usa o ritual e as condições do portal de onde se parte
      if (TPX.off) return; const pa = pois.find(p => p.id === r.a), pb = pois.find(p => p.id === r.b);
      if (!gm && [pa, pb].some(p => !p || p.state === "rumor" || p.hidden)) return; // jogadores só usam portais que conhecem
      const A = P[i][0], B = P[i][1];
      for (const [src, dst, ka, kb, pa_, pb_] of [[pa, pb, ends[i][0], ends[i][1], A, B], ...(r.oneway ? [] : [[pb, pa, ends[i][1], ends[i][0], B, A]])]) {
        const o = src ?? r; const why = portalWhy(o, TPX.mover, TPX.scene ?? scene); const nm = src?.name || r.name || "Portal";
        if (why) { const msg = `${nm}: ${why}`; if (!TPX.closed.includes(msg)) TPX.closed.push(msg); continue; }
        edges.push({ id: r.id, route: r, a: ka, b: kb, pts: [pa_, pb_], px: 0, units: 0, hours: (o.ritual ?? 1) / 60, mult: 1, use: mode, parts: [], type: "portal", portal: true, oneway: true, tpColor: src?.tpColor || r.color || ROUTE_TYPES.portal.color, name: `${nm} → ${dst?.name || "Portal"}` });
      }
      return; }
    const t = ROUTE_TYPES[r.type]; const allowed = r.modes ?? t.modes; let use = mode, dismount = false;
    if (waterOnly(tr) && !isWaterRoute(r.type)) return; // navio não anda em estrada
    if (!allowed.includes(mode)) { if (allowed.includes("pe") && !isAir(mode)) { use = "pe"; dismount = true; } else if (allowed.includes("barco") && tr.water > 0) { use = "barco"; } else return; }
    const L = Ls[i]; const cuts = []; // { s, key }
    for (const e of ev[i]) if (!e.gap) cuts.push({ s: e.s, key: e.key });
    const gaps = ev[i].filter(e => e.gap).map(e => e.gap);
    for (const [g0, g1] of gaps) { const k0 = `g:${gapN++}`, k1 = `g:${gapN++}`; const A = pointAt(P[i], g0), B = pointAt(P[i], g1);
      nodes.set(k0, { key: k0, x: A[0], y: A[1], name: "ponte quebrada" }); nodes.set(k1, { key: k1, x: B[0], y: B[1], name: "ponte quebrada" });
      cuts.push({ s: g0, key: k0, gapStart: true }, { s: g1, key: k1, gapEnd: true }); }
    cuts.sort((a, b) => a.s - b.s || (a.gapEnd ? -1 : 0));
    const uniq = [];
    for (const c of cuts) { const gp = c.gapStart || c.gapEnd; if (!gp && (c.s <= 0.5 || c.s >= L - 0.5)) continue;
      const l = uniq[uniq.length - 1]; if (l && !gp && !l.gapStart && !l.gapEnd && Math.abs(l.s - c.s) < 1) continue; uniq.push(c); }
    const pieces = uniq.length ? splitPoly(P[i], uniq.map(c => Math.max(0, Math.min(L, c.s)))) : [P[i]];
    const keys = [ends[i][0], ...uniq.map(c => c.key), ends[i][1]];
    pieces.forEach((pts, k) => {
      if (uniq[k - 1]?.gapStart) return; // dentro da ponte quebrada
      const a = keys[k], b = keys[k + 1]; if (a === b) return; const px = polyLength(pts); if (px < 0.5) return;
      const prof = profile(pts, zones, sc.size / 2);
      const terr = t.terrain ? prof.mult : 1; let mult = (r.mult ?? t.mult) * terr;
      if (use === "barco" && (r.type === "mar" || r.type === "rio")) mult *= Math.max(0.4, 1 + (r.type === "mar" ? 0.4 : 0.15) * windFactor(wx, pts));
      const units = px * sc.perPx;
      const speed = use === "barco" && tr.mode !== "barco" ? Math.max(0.2, (tr.water || 3) * (PACES[pace]?.f ?? 1)) : speedFor(tr, use, pace);
      const hours = units * sc.mi / Math.max(0.1, speed * mult);
      edges.push({ id: r.id, route: r, a, b, pts, px, units, hours, mult, use, dismount, parts: prof.parts, type: r.type, name: r.name || t.label });
    });
  });
  // costuras do mundo que dá a volta: a ponta de uma rota na borda leste encosta na ponta de outra na borda oeste (mesma altura)
  if (SW) { const E = []; routes.forEach((r, i) => { if (r.type === "portal") return; for (const k of [0, 1]) { const p = k ? P[i][P[i].length - 1] : P[i][0]; const s = Math.abs(p[0] - SW.X) < 1.5 ? "l" : Math.abs(p[0] - SW.X - SW.W) < 1.5 ? "r" : null; if (s) E.push({ key: ends[i][k], p, s, w: cls(r) }); } });
    const seen = new Set();
    for (const e1 of E) for (const e2 of E) { if (e1.s !== "r" || e2.s !== "l" || e1.w !== e2.w || Math.abs(e1.p[1] - e2.p[1]) > 3 || e1.key === e2.key) continue; const id = `seam:${e1.key}:${e2.key}`; if (seen.has(id)) continue; seen.add(id);
      edges.push({ id, a: e1.key, b: e2.key, pts: [e1.p, e2.p], px: 0, units: 0, hours: 0, mult: 1, use: mode, parts: [], type: "costura", seam: true, name: "Volta ao mundo" }); } }
  const waterLines = routes.map((r, i) => isWaterRoute(r.type) ? P[i] : null).filter(Boolean);
  return { nodes, edges, zones, wz: waterZonesOf(zones), waterLines, sc, pois, wx, tr, pace, bridges };
}

function dijkstraAll(graph, start) {
  const dist = new Map([[start, 0]]); const prev = new Map(); const done = new Set();
  const adj = new Map(); for (const e of graph.edges) { (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)).push({ e, to: e.b, fwd: true }); if (!e.oneway) (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)).push({ e, to: e.a, fwd: false }); }
  while (true) {
    let u = null, best = Infinity; for (const [k, v] of dist) if (!done.has(k) && v < best) { best = v; u = k; }
    if (u == null) break; done.add(u);
    for (const { e, to, fwd } of adj.get(u) ?? []) { const nd = best + (e.cost ?? e.hours); if (nd < (dist.get(to) ?? Infinity)) { dist.set(to, nd); prev.set(to, { from: u, e, fwd }); } }
  }
  return { dist, prev };
}
function pathTo(D, start, goal) { if (!D.dist.has(goal)) return null; const path = []; let k = goal; while (k !== start) { const p = D.prev.get(k); if (!p) return null; path.unshift(p); k = p.from; } return path; }

/** Trecho em linha reta (fora de estrada). */
function directLeg(graph, from, to, label, coarse = false) {
  const pts = [[from.x, from.y], [to.x, to.y]]; const L0 = dist(pts[0], pts[1]);
  const prof = profile(pts, graph.zones, coarse ? Math.max(graph.sc.size / 2, L0 / 20) : graph.sc.size / 2);
  const tr = graph.tr; const ship = waterOnly(tr); const use = ship ? "barco" : tr.mode === "carruagem" || tr.mode === "barco" ? "pe" : tr.mode; const px = dist(pts[0], pts[1]); const units = px * graph.sc.perPx;
  // no ar o terreno não pesa; o vento ajuda ou atrapalha
  let mult = isAir(use) ? Math.max(0.4, 1 + 0.5 * windFactor(graph.wx, pts)) : prof.mult;
  // água no caminho: carroças não passam; a pé ou montado, atravessar é lento (vau, nado)
  let blocked = false, wet = 0, fords = 0, blockedZone = null;
  if (ship) { // só sobre água: Região de água ou perto de uma rota de rio/mar (as pontas podem tocar o cais)
    const near = graph.sc.size * 0.6; const edge = graph.sc.size * 1.2; const sp = sample(pts, Math.max(graph.sc.size / 3, L0 / 80));
    for (const q of sp) { if (dist(q, pts[0]) < edge || dist(q, pts[1]) < edge) continue;
      const ok = inWater(graph.wz ?? [], q[0], q[1]) || (!onBase(graph.wz ?? [], q[0], q[1]) && (graph.waterLines ?? []).some(W => projArc(W, q).d <= near)); if (!ok) { blocked = true; break; } }
    mult = Math.max(0.4, 1 + 0.3 * windFactor(graph.wx, pts));
  } else if (!isAir(use)) {
    let shallow = 0, deep = 0;
    if (graph.wz?.length) { const sp = sample(pts, Math.max(graph.sc.size / 3, L0 / 60)); const n = sp.length || 1;
      for (const q of sp) { const k = waterKind(graph.wz, q[0], q[1]); if (k === "funda") deep++; else if (k === "rasa") shallow++; else if (k) wet++; }
      wet /= n; shallow /= n; deep /= n; }
    for (const W of graph.waterLines ?? []) fords += crossings(pts, W).filter(x => !onBase(graph.wz ?? [], x.pt[0], x.pt[1])).length;
    if (deep > 0) blocked = true; // água funda: só com barco ou voando
    if ((wet > 0 || fords) && landVehicle(tr)) blocked = true; // carroças passam só na água rasa
    if (wet > 0) mult *= 1 / (1 + wet * 2.5);
    if (shallow > 0) mult *= 1 / (1 + shallow * 1.5);
    wet = wet + shallow;
  }
  // terrenos com "quem passa" escolhido pelo mestre
  if (!blocked && graph.zones?.some(({ z }) => z.modes)) { const sp = sample(pts, Math.max(graph.sc.size / 3, L0 / 60)); for (const q of sp) { const zf = zoneForbids(graph.zones, q[0], q[1], tr.mode); if (zf) { blocked = true; blockedZone = zf.name; break; } } }
  const hours = units * graph.sc.mi / Math.max(0.1, speedFor(tr, use, graph.pace) * mult) + fords * 0.5;
  return { id: null, offroad: true, pts, px, units, hours, mult, use, blocked, blockedZone, wet, fords, dismount: use !== tr.mode, parts: isAir(use) ? [] : prof.parts, type: "direto", name: label ?? (isAir(use) ? "Pelo ar" : "Fora de estrada"), fromName: from.name, toName: to.name };
}

/** Posição (comprimento ao longo da linha) do ponto da linha mais próximo de P, e a distância. */
function projArc(pts, P) {
  let best = { d: Infinity, s: 0 }, acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]; const dx = b[0] - a[0], dy = b[1] - a[1]; const l2 = dx * dx + dy * dy; const l = Math.sqrt(l2);
    let t = l2 ? ((P[0] - a[0]) * dx + (P[1] - a[1]) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(P[0] - a[0] - t * dx, P[1] - a[1] - t * dy); if (d < best.d) best = { d, s: acc + t * l };
    acc += l;
  }
  return best;
}
/** Corta uma linha nos comprimentos dados (ordenados); devolve os pedaços. */
function splitPoly(pts, ss) {
  const out = []; let cur = [pts[0]], acc = 0, k = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]; const l = dist(a, b);
    while (k < ss.length && ss[k] <= acc + l + 1e-9) { const t = l ? (ss[k] - acc) / l : 0; const Q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; cur.push(Q); out.push(cur); cur = [Q]; k++; }
    cur.push(b); acc += l;
  }
  out.push(cur); return out;
}

/**
 * Liga pontos soltos (partida e chegada) à rede.
 * Para cada rota próxima, testa o ponto da estrada mais perto (a perpendicular) e outros pontos
 * ao longo dela: às vezes vale cortar pelo mato e entrar na estrada mais adiante.
 * As rotas são partidas nesses pontos e o melhor caminho decide.
 */
function connectLoose(g, ends, goalKey, { perpOnly = false, penalty = 1 } = {}) {
  const step = g.sc.size; const splits = new Map(); const links = []; let cutN = 0; // nomes únicos: pedaços da mesma rota não podem dividir o nó
  for (const E of ends) {
    const P = [E.x, E.y]; const R = E.radius;
    for (const e of g.edges) {
      if (e.portal || e.seam) continue; // ninguém entra num portal (nem na costura do mundo) pela metade
      const L = e.px || polyLength(e.pts); const pr = projArc(e.pts, P); if (pr.d > R) continue;
      const cand = [pr.s]; const n = perpOnly ? -1 : Math.min(10, Math.max(2, Math.floor(L / (step * 2))));
      for (let i = 0; i <= n; i++) { const s = L * i / n; if (dist(pointAt(e.pts, s), P) <= R) cand.push(s); }
      const list = splits.get(e) ?? splits.set(e, []).get(e);
      for (const s of cand) list.push({ s, E });
    }
    // nós próximos (locais, encruzilhadas)
    for (const n of g.nodes.values()) { if (n.key === E.key || n.loose || n.key.startsWith("g:")) continue; if (Math.hypot(n.x - E.x, n.y - E.y) <= (perpOnly ? Math.min(R, g.sc.size * 3) : R)) links.push({ E, key: n.key }); }
  }
  // parte as rotas
  for (const [e, list] of splits) {
    const L = e.px || polyLength(e.pts); const tol = step * 0.3;
    list.sort((p, q) => p.s - q.s);
    const cuts = []; // { s, key, Es:Set }
    for (const it of list) {
      let key;
      if (it.s <= tol) key = e.a; else if (it.s >= L - tol) key = e.b;
      else { let c = cuts.find(c => Math.abs(c.s - it.s) <= tol); if (!c) { c = { s: it.s, key: `c:${cutN++}` }; cuts.push(c); } key = c.key; }
      links.push({ E: it.E, key });
    }
    if (!cuts.length) continue;
    cuts.sort((p, q) => p.s - q.s);
    const pieces = splitPoly(e.pts, cuts.map(c => c.s)); const keys = [e.a, ...cuts.map(c => c.key), e.b];
    for (const c of cuts) { const Q = pointAt(e.pts, c.s); g.nodes.set(c.key, { key: c.key, x: Q[0], y: Q[1], name: `beira da ${(e.name ?? "estrada").toLowerCase()}` }); }
    g.edges.splice(g.edges.indexOf(e), 1);
    pieces.forEach((pts, i) => { const pl = polyLength(pts); const f = pl / (L || 1); g.edges.push({ ...e, pts, px: pl, units: e.units * f, hours: e.hours * f, a: keys[i], b: keys[i + 1] }); });
  }
  // trechos fora de estrada até cada ponto de entrada (sem repetir)
  const seen = new Set();
  for (const { E, key } of links) {
    const id = `${E.key}>${key}`; if (seen.has(id) || key === E.key) continue; seen.add(id);
    const n = g.nodes.get(key); if (!n) continue;
    const whole = (E.key === "start" && key === goalKey) || (E.key === goalKey && key === "start");
    const leg = E.key === "start" ? directLeg(g, E, n, whole ? "Fora de estrada" : "Até a estrada", true) : directLeg(g, n, E, whole ? "Fora de estrada" : "Saindo da estrada", true);
    if (leg.blocked) { g.edges.push({ ...leg, id: `o:${id}`, a: E.key === "start" ? E.key : key, b: E.key === "start" ? key : E.key, offroad: true, cost: Infinity }); continue; } // a grade de terreno pode achar a volta
    g.edges.push({ ...leg, id: `o:${id}`, a: E.key === "start" ? E.key : key, b: E.key === "start" ? key : E.key, offroad: true, cost: leg.hours * penalty });
  }
}

/** Junta pedaços seguidos da mesma rota num trecho só. */
function mergeLegs(legs) {
  const out = [];
  for (const l of legs) {
    const p = out[out.length - 1];
    if (p && l.id && p.id === l.id && l.route && p.use === l.use) { out[out.length - 1] = { ...p, pts: [...p.pts, ...l.pts.slice(1)], px: p.px + l.px, units: p.units + l.units, hours: p.hours + l.hours, toKey: l.toKey, toName: l.toName, parts: p.parts }; }
    else out.push(l);
  }
  return out;
}

/* ---------- navios: caminho só pela água (grade sobre as Regiões de água e as rotas de rio/mar) ---------- */
const waterGridCache = new Map();
function waterGrid(scene, g) {
  const d = scene.dimensions ?? {}; const X = d.sceneX ?? 0, Y = d.sceneY ?? 0, W = d.sceneWidth ?? scene.width, H = d.sceneHeight ?? scene.height;
  const step = Math.max(10, g.sc.size / 2); const cols = Math.ceil(W / step), rows = Math.ceil(H / step);
  const key = JSON.stringify([scene.id, step, g.zones.filter(({ z }) => z.modes).map(({ r, z }) => [r.id, z.modes, shapesKey(r)]), g.wz.map(({ r }) => [r.id, shapesKey(r)]), g.waterLines.map(l => l.length + ":" + Math.round(l[0][0]) + ":" + Math.round(l[0][1]))]);
  const c = waterGridCache.get(scene.id); if (c?.key === key) return c.grid;
  const ok = new Uint8Array(cols * rows); const near = step * 0.9;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const x = X + (i + 0.5) * step, y = Y + (j + 0.5) * step;
    if ((inWater(g.wz, x, y) || (!onBase(g.wz, x, y) && g.waterLines.some(Wl => projArc(Wl, [x, y]).d <= near))) && !zoneForbids(g.zones, x, y, "barco")) ok[j * cols + i] = 1; }
  const grid = { X, Y, step, cols, rows, ok }; waterGridCache.set(scene.id, { key, grid }); return grid;
}
function waterPath(G, from, to, S = null) {
  // S = mundo que dá a volta (wrap.js): a borda leste encosta na oeste, e o navio pode sair por uma e entrar pela outra
  const C = G.cols, wrapI = (i) => S ? ((i % C) + C) % C : i;
  const cell = (p) => [wrapI(Math.floor(((S ? wrapX(p[0], S) : p[0]) - G.X) / G.step)), Math.floor((p[1] - G.Y) / G.step)];
  const center = (i, j) => [G.X + (i + 0.5) * G.step, G.Y + (j + 0.5) * G.step];
  const at = (i, j) => { i = wrapI(i); return i >= 0 && j >= 0 && i < C && j < G.rows && G.ok[j * C + i]; };
  const snap = (p) => { const [ci, cj] = cell(p); let best = null, bd = Infinity; const R = 4; // até ~2 quadros do cais
    for (let j = cj - R; j <= cj + R; j++) for (let ii = ci - R; ii <= ci + R; ii++) { const i = wrapI(ii); if (!at(i, j)) continue; const dd = Math.hypot((ii - ci) * G.step, (j - cj) * G.step); if (dd < bd) { bd = dd; best = [i, j]; } }
    return best; };
  const s = snap(from), t = snap(to); if (!s || !t) return null;
  const N = C * G.rows; const gS = new Float64Array(N).fill(Infinity); const prev = new Int32Array(N).fill(-1); const closed = new Uint8Array(N);
  const id = (i, j) => j * C + wrapI(i);
  const h = (i, j) => { let dx = Math.abs(i - t[0]); if (S) dx = Math.min(dx, C - dx); return Math.hypot(dx, j - t[1]); };
  // fila de prioridade (heap binário): o mapa-múndi inteiro tem dezenas de milhares de células
  const heap = []; const push = (f, v) => { heap.push([f, v]); let k = heap.length - 1; while (k > 0) { const pa = (k - 1) >> 1; if (heap[pa][0] <= heap[k][0]) break; [heap[pa], heap[k]] = [heap[k], heap[pa]]; k = pa; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  push(h(...s), id(...s)); gS[id(...s)] = 0;
  while (heap.length) {
    const [, u] = pop();
    if (closed[u]) continue; closed[u] = 1; const ui = u % C, uj = (u - ui) / C; if (ui === t[0] && uj === t[1]) break;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const vi = wrapI(ui + di), vj = uj + dj; if (!at(vi, vj)) continue;
      if (di && dj && !(at(ui + di, uj) || at(ui, uj + dj))) continue; const v = id(vi, vj); const nd = gS[u] + Math.hypot(di, dj);
      if (nd < gS[v]) { gS[v] = nd; prev[v] = u; push(nd + h(vi, vj), v); } }
  }
  const T = id(...t); if (!Number.isFinite(gS[T])) return null;
  const idx = []; for (let k = T; k !== -1; k = prev[k]) idx.unshift(k);
  // centros das células com x contínuo: ao cruzar a borda, soma (ou tira) uma volta
  const cells = []; let lap = 0, pi = null;
  for (const k of idx) { const i = k % C, j = (k - i) / C; if (S && pi != null) { if (i - pi > C / 2) lap--; else if (pi - i > C / 2) lap++; } pi = i; const c = center(i, j); cells.push([c[0] + lap * (S ? S.W : 0), c[1]]); }
  if (S) { const off = unwrapNear(cells[0][0], from[0], S) - cells[0][0]; if (off) for (const c of cells) c[0] += off; }
  // simplifica: pula pontos enquanto a linha reta continuar na água
  const clear = (a, b) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (G.step / 2)); for (let k = 1; k < n; k++) { const q = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]; const [i, j] = cell(q); if (!at(i, j)) return false; } return true; };
  const out = [cells[0]]; let k = 0; while (k < cells.length - 1) { let m = cells.length - 1; while (m > k + 1 && !clear(cells[k], cells[m])) m--; out.push(cells[m]); k = m; }
  const last = out[out.length - 1];
  return [[from[0], from[1]], ...out, [S ? unwrapNear(to[0], last[0], S) : to[0], to[1]]];
}

/**
 * Planeja uma viagem.
 * mover: elemento móvel (posição, at, composição). target: id de local, ou {x,y} (qualquer ponto do mapa).
 * Fora da estrada, o grupo vai até o ponto da estrada que der a viagem mais rápida (em geral a perpendicular),
 * ou segue em linha reta pelo mato se isso for mais rápido.
 */
/**
 * Planeja a viagem considerando trocar de transporte no caminho:
 * - sem veículo, passando por um veículo parado: embarca nele (se ficar mais rápido);
 * - com veículo que não chega lá (água, ponte quebrada, navio longe da costa): desembarca no ponto mais perto e segue a pé.
 */
export function planTravel(scene, mover, target, opts = {}) {
  TPX = { off: opts.portals === false, mover, scene, closed: [] };
  try { const plan = planTravel0(scene, mover, target, opts); if (plan && game.user.isGM && TPX.closed.length) plan.warn = [...(plan.warn ?? []), ...[...new Set(TPX.closed)].map(x => `Portal fechado · ${x}`)]; return plan; } finally { TPX = { off: false, mover: null, scene: null, closed: [] }; }
}
function planTravel0(scene, mover, target, opts) {
  let plan = opts.via?.length ? planChain(scene, mover, [...opts.via, target], opts) : planOne(scene, mover, target, opts);
  if (plan) plan = { ...plan, popts: { pace: opts.pace ?? "normal", direct: !!opts.direct, roads: opts.roads !== false, avoidWx: !!opts.avoidWx, avoidRough: opts.avoidRough !== false } };
  if (plan && !plan.here && !plan.blocked && (Array.isArray(opts.stops) || mover?.today > 0)) {
    const td = Math.max(0, Number(mover?.today) || 0); const tired = td > (plan.hpd || HOURS_PER_DAY) - 1; // quase sem horas de marcha hoje: partem depois do descanso
    plan = { ...plan, stops: Array.isArray(opts.stops) ? opts.stops : null, todayStart: tired ? 0 : td, restFirst: tired ? td : 0, warn: tired ? [`Já marcharam ${fmtH(td)} hoje: partem depois do descanso da noite.`, ...(plan.warn ?? [])] : plan.warn };
    plan.days = daysOf(plan, zonesOf(scene)); }
  return plan;
}
/** Vários destinos em seguida (Ctrl + segurar o clique): cada trecho começa onde o anterior termina. */
function planChain(scene, mover, targets, opts) {
  let cur = { ...mover }; const parts = [];
  for (const t of targets) {
    const p = planOne(scene, cur, t, { ...opts, via: null, stops: null }); if (!p || p.blocked) return p ?? null; if (p.here) continue;
    parts.push(p); const end = p.pts[p.pts.length - 1];
    cur = { ...cur, x: end[0], y: end[1], at: p.toId ?? null };
    for (const tf of p.transfers ?? []) { if (tf.kind === "embarque") Object.assign(cur, { vehicle: tf.vehicle, draft: tf.draft ?? [], kind: tf.vkind ?? cur.kind }); else Object.assign(cur, { vehicle: "", draft: [], kind: (cur.members ?? []).length === 1 ? "pessoa" : "grupo" }); }
  }
  if (!parts.length) return planOne(scene, mover, targets[targets.length - 1], opts);
  if (parts.length === 1) return parts[0];
  const legs = []; const transfers = []; let acc = 0;
  parts.forEach((p, i) => { for (const tf of p.transfers ?? []) transfers.push({ ...tf, h: tf.h + acc }); for (const l of p.legs) legs.push(l);
    if (i < parts.length - 1) legs.push({ id: null, type: "via", pts: [p.pts[p.pts.length - 1], p.pts[p.pts.length - 1]], px: 0, units: 0, hours: 0, mult: 1, use: "pe", parts: [], name: `Passando por ${p.to.name}`, fromName: p.to.name, toName: p.to.name });
    acc += p.totalHours; });
  const pts = []; for (const l of legs) for (const q of l.pts) { const last = pts[pts.length - 1]; if (!last || dist(last, q) > 0.5) pts.push(q); }
  const fin = parts[parts.length - 1];
  const plan = { ...fin, legs, pts, transfers, totalHours: acc, totalUnits: parts.reduce((s, p) => s + p.totalUnits, 0), warn: [...new Set(parts.flatMap(p => p.warn))], via: targets.slice(0, -1), hpd: Math.min(...parts.map(p => p.hpd || HOURS_PER_DAY)), tr: parts[0].tr };
  plan.days = daysOf(plan, zonesOf(scene)); return plan;
}
function planOne(scene, mover, target, opts = {}) {
  const base = planCore(scene, mover, target, opts);
  if (!mover || opts.tr || opts.noTransfers || !base || base.here) return base;
  const gm = opts.gm ?? game.user.isGM; const sc = scaleOf(scene); const d = dataOf(scene);
  const tr0 = transportOf(mover); const isVeh = !!mover.vehicle || tr0.mode === "barco" || tr0.mode === "carruagem";
  const sub = (m, t) => { try { return planCore(scene, m, t, { ...opts, noTransfers: true }); } catch (e) { return null; } };
  const ok = (p) => p && !p.blocked && p.legs?.length;
  let best = ok(base) ? base : null;
  const better = (p) => ok(p) && (!best || p.totalHours < best.totalHours * 0.97);
  const goalPt = (() => { const t = typeof target === "string" ? d.pois.find(x => x.id === target) : target; return t ? [t.x, t.y] : null; })(); if (!goalPt) return base;
  // embarcar num veículo parado no caminho
  if (!isVeh) {
    const parked = d.movers.map(normMover).filter(v => v.parked && v.vehicle && (gm || !v.hidden))
      .sort((a, b) => Math.hypot(a.x - mover.x, a.y - mover.y) - Math.hypot(b.x - mover.x, b.y - mover.y)).slice(0, 4);
    for (const P of parked) {
      const p1 = Math.hypot(P.x - mover.x, P.y - mover.y) < sc.size * 0.6 ? null : sub(mover, { x: P.x, y: P.y, name: P.name });
      const m2 = { ...mover, x: P.x, y: P.y, at: P.at, vehicle: P.vehicle, draft: P.draft ?? [], kind: P.kind, mounts: [], mountOf: {} };
      const p2 = sub(m2, target); if (!ok(p2) || (p1 && !ok(p1))) continue;
      const j = joinPlans(scene, p1, p2, { kind: "embarque", pt: [P.x, P.y], parkedId: P.id, name: P.name, vehicle: P.vehicle, draft: P.draft ?? [], vkind: P.kind });
      if (better(j)) best = j;
    }
  }
  // desembarcar onde o veículo não passa
  if (isVeh && !ok(base)) {
    const foot = { ...mover, vehicle: "", draft: [], kind: "grupo" }; const cands = [];
    if (tr0.mode === "barco" && waterOnly(tr0)) { const g = buildGraph(scene, { tr: tr0, gm }); const G = waterGrid(scene, g); for (const c of reachableWater(G, [mover.x, mover.y], goalPt, 4)) cands.push(c); }
    else { const g = buildGraph(scene, { tr: tr0, gm }); const ns = [...g.nodes.values()].filter(n => !n.key.startsWith("g:")).sort((a, b) => Math.hypot(a.x - goalPt[0], a.y - goalPt[1]) - Math.hypot(b.x - goalPt[0], b.y - goalPt[1])).slice(0, 6); for (const n of ns) cands.push([n.x, n.y, n.poi?.id]); }
    for (const c of cands) {
      const p1 = sub(mover, c[2] ?? { x: c[0], y: c[1], name: "ponto de desembarque" }); if (!ok(p1)) continue;
      const end = p1.pts[p1.pts.length - 1]; const p2 = sub({ ...foot, x: end[0], y: end[1], at: p1.toId ?? null }, target); if (!ok(p2) && !p2?.here) continue;
      const j = joinPlans(scene, p1, p2?.here ? null : p2, { kind: "desembarque", pt: end, name: actorRef(mover.vehicle)?.name ?? tr0.label, vehicle: mover.vehicle, draft: mover.draft ?? [], vkind: mover.kind, color: mover.color, icon: transportIcon(mover, tr0) }, p2?.here ? p1 : null);
      if (better(j)) best = j;
    }
  }
  return best ?? base;
}
/** Embarque ou desembarque de fato (grava no mapa). */
async function applyTransfer(scene, moverId, t, moverName) {
  await mutateData(scene, (d) => { const g = d.movers.find(x => x.id === moverId); if (!g) return [];
    if (t.kind === "embarque") { const P = d.movers.find(x => x.id === t.parkedId && x.parked); if (!P || g.vehicle) return []; g.vehicle = P.vehicle; g.draft = P.draft ?? []; g.kind = P.kind; d.movers = d.movers.filter(x => x.id !== P.id); }
    else { if (!g.vehicle) return []; d.movers.push({ id: foundry.utils.randomID(), name: t.name, kind: t.vkind ?? "veiculo", parked: true, vehicle: t.vehicle, draft: t.draft ?? [], x: Math.round(t.pt[0]), y: Math.round(t.pt[1]), at: null, color: t.color ?? "", icon: t.icon ?? "", leftBy: moverName, members: [] });
      g.vehicle = ""; g.draft = []; g.kind = (g.members ?? []).length === 1 ? "pessoa" : "grupo"; }
    return ["movers"]; });
}
/** Junta dois trechos de viagem com uma troca de transporte no meio. */
function joinPlans(scene, p1, p2, tf, onlyFirst = null) {
  const A = p1 ?? null, B = p2 ?? null; const ref = A ?? B ?? onlyFirst; const pt = tf.pt;
  const stop = { id: null, type: "troca", transfer: tf.kind, pts: [pt, pt], px: 0, units: 0, hours: 0.25, mult: 1, use: "pe", parts: [], name: tf.kind === "embarque" ? `Embarque: ${tf.name}` : `Desembarque: ${tf.name}`, fromName: A?.to?.name ?? "partida", toName: tf.kind === "embarque" ? tf.name : "a pé" };
  const legs = [...(A?.legs ?? []), stop, ...(B?.legs ?? [])];
  const pts = []; for (const l of legs) for (const q of l.pts) { const last = pts[pts.length - 1]; if (!last || dist(last, q) > 0.5) pts.push(q); }
  const fin = B ?? A; const totalHours = legs.reduce((s, l) => s + l.hours, 0); const totalUnits = legs.reduce((s, l) => s + l.units, 0);
  const quiet = /não há caminho|só anda na água|Nenhuma estrada|Não há estrada conhecida|Mais rápido seguir/;
  const warn = [...new Set([...(A?.warn ?? []).filter(w => !quiet.test(w)), ...(B?.warn ?? []).filter(w => !/não há caminho|só anda na água/.test(w))])];
  warn.unshift(tf.kind === "embarque" ? `Podem embarcar em ${tf.name} no caminho: ao chegar lá, o mestre confirma.` : `${tf.name} não chega lá: no ponto marcado o mestre confirma o desembarque e seguem a pé.`);
  const plan = { ...fin, legs, pts, totalHours, totalUnits, warn, to: fin.to, toId: fin.toId, target: fin.target ?? ref.target, transfers: [{ ...tf, h: (A?.totalHours ?? 0) }], hpd: Math.min(A?.hpd ?? 24, B?.hpd ?? 24) || HOURS_PER_DAY, mph: B?.mph ?? A?.mph, tr: A?.tr ?? B?.tr };
  plan.days = daysOf(plan, zonesOf(scene));
  return plan;
}
/** Células de água alcançáveis a partir do ponto, as mais perto do destino. */
function reachableWater(G, from, goal, n = 4) {
  const cell = (p) => [Math.floor((p[0] - G.X) / G.step), Math.floor((p[1] - G.Y) / G.step)];
  const at = (i, j) => i >= 0 && j >= 0 && i < G.cols && j < G.rows && G.ok[j * G.cols + i];
  const [ci, cj] = cell(from); let s = null, bd = Infinity;
  for (let j = cj - 4; j <= cj + 4; j++) for (let i = ci - 4; i <= ci + 4; i++) if (at(i, j)) { const dd = Math.hypot(i - ci, j - cj); if (dd < bd) { bd = dd; s = [i, j]; } }
  if (!s) return [];
  const seen = new Uint8Array(G.cols * G.rows); const q = [s]; seen[s[1] * G.cols + s[0]] = 1; const out = [];
  while (q.length) { const [i, j] = q.pop(); const c = [G.X + (i + 0.5) * G.step, G.Y + (j + 0.5) * G.step]; out.push([c[0], c[1], null, Math.hypot(c[0] - goal[0], c[1] - goal[1])]);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (at(a, b) && !seen[b * G.cols + a]) { seen[b * G.cols + a] = 1; q.push([a, b]); } } }
  out.sort((a, b) => a[3] - b[3]); const pick = []; for (const c of out) { if (pick.every(p => Math.hypot(p[0] - c[0], p[1] - c[1]) > G.step * 4)) pick.push(c); if (pick.length >= n) break; }
  return pick;
}

/* ---------- desviar do mau tempo ---------- */
/** Peso do céu num ponto (agora): chuva pesa muito, nuvem pesa um pouco. */
function wxPenalty(scene, g) {
  const cache = new Map(); const q = g.sc.size / 2;
  return (x, y) => { const k = `${Math.round(x / q)}:${Math.round(y / q)}`; let v = cache.get(k);
    if (v == null) { let s = null; try { s = skyAt(scene, g.wx, x, y); } catch (e) { /* */ } v = s?.raining ? 5 : s?.cover ? 2 : 1; cache.set(k, v); } return v; };
}
const avgPen = (pen, pts, step) => { const sp = sample(pts, step); if (!sp.length) return 1; let t = 0; for (const q of sp) t += pen(q[0], q[1]); return t / sp.length; };
/** Caminho fora de estrada numa grade, contornando chuva e nuvens (e água que o grupo não atravessa). */
function detourPath(g, from, to, pen) {
  const S = g.sc.size / 2; const x0 = Math.min(from.x, to.x) - S * 30, y0 = Math.min(from.y, to.y) - S * 30;
  const cols = Math.ceil((Math.max(from.x, to.x) + S * 30 - x0) / S), rows = Math.ceil((Math.max(from.y, to.y) + S * 30 - y0) / S); if (cols * rows > 40000) return null;
  const land = landVehicle(g.tr); const C = (i, j) => [x0 + (i + 0.5) * S, y0 + (j + 0.5) * S];
  const costCache = new Float64Array(cols * rows).fill(-1);
  const cellCost = (i, j) => { const id = j * cols + i; if (costCache[id] >= 0) return costCache[id]; const [x, y] = C(i, j); let c;
    const wk = g.wz?.length ? waterKind(g.wz, x, y) : null; if (wk === "funda" || (land && wk && wk !== "rasa") || zoneForbids(g.zones, x, y, g.tr.mode)) c = Infinity;
    else { const z = zoneAt(g.zones, x, y); c = pen(x, y) / Math.max(0.1, z?.mult ?? 1); if (wk) c *= 2; }
    costCache[id] = c; return c; };
  const cell = (p) => [Math.max(0, Math.min(cols - 1, Math.floor((p[0] - x0) / S))), Math.max(0, Math.min(rows - 1, Math.floor((p[1] - y0) / S)))];
  const s = cell([from.x, from.y]), t = cell([to.x, to.y]); const N = cols * rows;
  const gS = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const heap = []; const push = (f, v) => { heap.push([f, v]); let i = heap.length - 1; while (i) { const pa = (i - 1) >> 1; if (heap[pa][0] <= heap[i][0]) break; [heap[pa], heap[i]] = [heap[i], heap[pa]]; i = pa; } };
  const pop = () => { const top = heap[0]; const l = heap.pop(); if (heap.length) { heap[0] = l; let i = 0; for (;;) { const a = 2 * i + 1, b = a + 1; let m = i; if (a < heap.length && heap[a][0] < heap[m][0]) m = a; if (b < heap.length && heap[b][0] < heap[m][0]) m = b; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const sid = s[1] * cols + s[0], tid = t[1] * cols + t[0]; gS[sid] = 0; push(0, sid);
  const h = (i, j) => Math.hypot(i - t[0], j - t[1]) * 0.5; // otimista (o terreno mais rápido)
  while (heap.length) { const [, u] = pop(); if (closed[u]) continue; closed[u] = 1; if (u === tid) break; const ui = u % cols, uj = (u - ui) / cols;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const vi = ui + di, vj = uj + dj; if (vi < 0 || vj < 0 || vi >= cols || vj >= rows) continue;
      const c = cellCost(vi, vj); if (!Number.isFinite(c)) continue; const v = vj * cols + vi; const nd = gS[u] + Math.hypot(di, dj) * c;
      if (nd < gS[v]) { gS[v] = nd; prev[v] = u; push(nd + h(vi, vj), v); } } }
  if (!Number.isFinite(gS[tid])) return null;
  const cells = []; for (let k = tid; k !== -1; k = prev[k]) { const i = k % cols; cells.unshift(C(i, (k - i) / cols)); }
  const pts = [[from.x, from.y], ...cells.slice(1, -1), [to.x, to.y]];
  // estica o caminho onde a linha reta custa o mesmo
  const lineCost = (a, b) => { const L = dist(a, b); const n = Math.max(1, Math.ceil(L / (S / 2))); let c = 0; for (let k = 0; k < n; k++) { const q = [a[0] + (b[0] - a[0]) * (k + 0.5) / n, a[1] + (b[1] - a[1]) * (k + 0.5) / n]; const cc = cellCost(...cell(q)); if (!Number.isFinite(cc)) return Infinity; c += cc * L / n; } return c; };
  const out = [pts[0]]; let k = 0;
  while (k < pts.length - 1) { let m = pts.length - 1; for (; m > k + 1; m--) { let pc = 0; for (let q = k; q < m; q++) pc += lineCost(pts[q], pts[q + 1]); if (lineCost(pts[k], pts[m]) <= pc * 1.03 + 1e-6) break; } out.push(pts[m]); k = m; }
  return out;
}

/* ---------- grade de terreno: caminhos fora de estrada que contornam o que atrasa ou impede ---------- */
// Cada célula guarda quanto custa atravessá-la (1 ÷ multiplicador do terreno). Água funda, terreno proibido e,
// para carroças, qualquer água ficam fechados: o grupo anda pela margem até achar passagem (vau, ponte, estrada).
const terrainCache = new Map();
function terrainGrid(scene, g) {
  const d = scene.dimensions ?? {}; const X = d.sceneX ?? 0, Y = d.sceneY ?? 0, W = d.sceneWidth ?? scene.width ?? 0, H = d.sceneHeight ?? scene.height ?? 0; if (!W || !H) return null;
  const step = Math.max(10, g.sc.size / 2, Math.sqrt(W * H / 45000)); const cols = Math.ceil(W / step), rows = Math.ceil(H / step);
  const land = landVehicle(g.tr); const mode = g.tr.mode;
  const key = JSON.stringify([step, mode, land, g.zones.base?.mult ?? 1, g.zones.map(({ r, z }) => [r.id, z.mult, z.modes, z.water, z.deep, z.shallow, z.base, z.guide, shapesKey(r)]), g.waterLines.map(l => `${l.length}:${Math.round(l[0][0])}:${Math.round(l[0][1])}:${Math.round(l[l.length - 1][0])}`)]);
  const c = terrainCache.get(scene.id); if (c?.key === key) return c.grid;
  const N = cols * rows; const cost = new Float32Array(N); const river = new Uint8Array(N); const near = step * 0.6;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const x = X + (i + 0.5) * step, y = Y + (j + 0.5) * step; const id = j * cols + i;
    const wk = g.wz?.length ? waterKind(g.wz, x, y) : null;
    if (wk === "funda" || (land && wk && wk !== "rasa") || zoneForbids(g.zones, x, y, mode)) { cost[id] = Infinity; continue; }
    const z = zoneAt(g.zones, x, y); let cc = 1 / Math.max(0.05, z?.mult ?? 1);
    if (wk === "rasa") cc *= 2.5; else if (wk) cc *= 3.5; // como na linha reta: água rasa e alagados atrasam
    if (g.waterLines.length && !onBase(g.wz ?? [], x, y) && g.waterLines.some(Wl => projArc(Wl, [x, y]).d <= near)) { if (land) { cost[id] = Infinity; continue; } river[id] = 1; }
    cost[id] = cc; }
  const grid = { X, Y, step, cols, rows, cost, river }; terrainCache.set(scene.id, { key, grid }); return grid;
}
/** A mesma grade, mas todo terreno aberto custa igual (para escolher o caminho sem fugir do terreno difícil). */
const flatCache = new WeakMap();
function flatGrid(G) { let F = flatCache.get(G); if (F) return F; const cost = G.cost.map(c => Number.isFinite(c) ? 1 : Infinity); F = { ...G, cost }; flatCache.set(G, F); return F; }
const gCell = (G, p) => [Math.max(0, Math.min(G.cols - 1, Math.floor((p[0] - G.X) / G.step))), Math.max(0, Math.min(G.rows - 1, Math.floor((p[1] - G.Y) / G.step)))];
const gCenter = (G, id) => { const i = id % G.cols; return [G.X + (i + 0.5) * G.step, G.Y + ((id - i) / G.cols + 0.5) * G.step]; };
/** Célula livre mais perto de um ponto (o grupo pode estar num cais, numa ponte...). */
function gSnap(G, p, R = 3) { const [ci, cj] = gCell(G, p); let best = -1, bd = Infinity;
  for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) { if (i < 0 || j < 0 || i >= G.cols || j >= G.rows) continue; const id = j * G.cols + i; if (!Number.isFinite(G.cost[id])) continue;
    const c = gCenter(G, id); const dd = Math.hypot(c[0] - p[0], c[1] - p[1]); if (dd < bd) { bd = dd; best = id; } }
  return best; }
/** Custo (em pixels "de terreno plano") de todas as células a partir de um ponto. fordPx: o que custa atravessar um rio a vau. */
function gField(G, p, fordPx) {
  const src = gSnap(G, p); if (src < 0) return null; const N = G.cols * G.rows;
  const gS = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const heap = []; const push = (f, v) => { heap.push([f, v]); let i = heap.length - 1; while (i) { const pa = (i - 1) >> 1; if (heap[pa][0] <= heap[i][0]) break; [heap[pa], heap[i]] = [heap[i], heap[pa]]; i = pa; } };
  const pop = () => { const top = heap[0]; const l = heap.pop(); if (heap.length) { heap[0] = l; let i = 0; for (;;) { const a = 2 * i + 1, b = a + 1; let m = i; if (a < heap.length && heap[a][0] < heap[m][0]) m = a; if (b < heap.length && heap[b][0] < heap[m][0]) m = b; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  gS[src] = 0; push(0, src); const C = G.cols, S = G.step, ok = (i, j) => i >= 0 && j >= 0 && i < C && j < G.rows && Number.isFinite(G.cost[j * C + i]);
  while (heap.length) { const [du, u] = pop(); if (closed[u] || du > gS[u]) continue; closed[u] = 1; const ui = u % C, uj = (u - ui) / C;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const vi = ui + di, vj = uj + dj; if (!ok(vi, vj)) continue;
      if (di && dj && !(ok(ui + di, uj) && ok(ui, uj + dj))) continue; // não corta quina de obstáculo
      const v = vj * C + vi; const nd = gS[u] + Math.hypot(di, dj) * S * (G.cost[u] + G.cost[v]) / 2 + (G.river[v] && !G.river[u] ? fordPx : 0);
      if (nd < gS[v]) { gS[v] = nd; prev[v] = u; push(nd, v); } } }
  return { gS, prev, src, p };
}
/** Custo de uma linha reta pela grade (Infinity se passa por célula fechada) e quantos rios ela atravessa. */
function gLine(G, a, b, fordPx) {
  const L = dist(a, b); const n = Math.max(1, Math.ceil(L / (G.step / 3))); let c = 0, fords = 0, wasR = null;
  for (let k = 0; k < n; k++) { const q = [a[0] + (b[0] - a[0]) * (k + 0.5) / n, a[1] + (b[1] - a[1]) * (k + 0.5) / n]; const [i, j] = gCell(G, q); const id = j * G.cols + i;
    const cc = G.cost[id]; if (!Number.isFinite(cc)) return { c: Infinity, fords };
    const r = !!G.river[id]; if (r && wasR === false) { fords++; c += fordPx; } wasR = r; c += cc * L / n; }
  return { c, fords };
}
/** Caminho da origem do campo até `to`: segue a grade e depois estica onde a linha reta custa o mesmo. */
function gPath(G, F, to, fordPx) {
  const t = gSnap(G, to); if (t < 0 || !Number.isFinite(F.gS[t])) return null;
  const cells = []; for (let k = t; k !== -1; k = F.prev[k]) cells.unshift(gCenter(G, k));
  const pts = [[F.p[0], F.p[1]], ...cells.slice(1, -1), [to[0], to[1]]]; if (pts.length < 2) pts.push([to[0], to[1]]);
  const pc = [0]; for (let i = 1; i < pts.length; i++) pc.push(pc[i - 1] + gLine(G, pts[i - 1], pts[i], fordPx).c);
  const out = [pts[0]]; let k = 0;
  while (k < pts.length - 1) { let m = Math.min(pts.length - 1, k + 60); for (; m > k + 1; m--) { const piece = pc[m] - pc[k]; if (Number.isFinite(piece) && gLine(G, pts[k], pts[m], fordPx).c <= piece * 1.02 + 1e-6) break; } out.push(pts[m]); k = m; }
  return out;
}
/** Trecho fora de estrada que segue o caminho da grade (horas pelo terreno de cada pedaço). */
function gridLeg(g, G, pts, fordPx, label, fromName, toName) {
  const tr = g.tr; const use = tr.mode === "carruagem" || tr.mode === "barco" ? "pe" : tr.mode; const speed = speedFor(tr, use, g.pace);
  let c = 0, fords = 0; for (let i = 1; i < pts.length; i++) { const r = gLine(G, pts[i - 1], pts[i], fordPx); c += r.c; fords += r.fords; }
  const px = polyLength(pts); const units = px * g.sc.perPx; const hours = (c - fords * fordPx) * g.sc.perPx * g.sc.mi / Math.max(0.1, speed) + fords * 0.5;
  const prof = profile(pts, g.zones, g.sc.size / 2);
  return { id: null, offroad: true, detour: true, pts, px, units, hours, mult: hours > 0 ? units * g.sc.mi / speed / Math.max(1e-6, hours - fords * 0.5) : 1, use, blocked: !Number.isFinite(c), blockedZone: null, wet: 0, fords, dismount: use !== tr.mode, parts: prof.parts, type: "direto", name: label, fromName, toName };
}
/**
 * Troca os trechos fora de estrada em linha reta (até a estrada, saindo dela, ou direto ao destino) por caminhos
 * na grade de terreno: o custo já conta o contorno; o desenho do caminho só é feito para o trecho escolhido.
 */
function terrainize(scene, g, from, goal, goalNode) {
  if (isAir(g.tr.mode) || waterOnly(g.tr)) return null;
  const G = terrainGrid(scene, g); if (!G) return null;
  const use = g.tr.mode === "carruagem" || g.tr.mode === "barco" ? "pe" : g.tr.mode; const speed = speedFor(g.tr, use, g.pace);
  const fordPx = 0.5 * speed / (g.sc.perPx * g.sc.mi); const toH = (c) => c * g.sc.perPx * g.sc.mi / Math.max(0.1, speed);
  // sem "contornar terrenos difíceis": o caminho só desvia do que fecha a passagem; o tempo continua pelo terreno de verdade
  const Gc = g.avoidRough === false ? flatGrid(G) : G;
  const F1 = gField(Gc, [from.x, from.y], fordPx), F2 = gField(Gc, [goalNode.x, goalNode.y], fordPx); if (!F1 && !F2) return null;
  const at = (F, n) => { const t = gSnap(G, [n.x, n.y]); if (t < 0 || !Number.isFinite(F.gS[t])) return Infinity; if (Gc === G) return F.gS[t];
    const pts = gPath(Gc, F, [n.x, n.y], fordPx); if (!pts) return Infinity; let c = 0; for (let i = 1; i < pts.length; i++) c += gLine(G, pts[i - 1], pts[i], fordPx).c; return c; }; // custo real do caminho reto
  const out = [];
  for (const e of g.edges) {
    if (!e.offroad || e.detour || e.stay) continue; const ratio = (e.cost ?? e.hours) / Math.max(1e-6, e.hours);
    let F = null, n = null, rev = false;
    if (e.a === "start" && F1) { F = F1; n = e.b === goal ? goalNode : g.nodes.get(e.b); }
    else if (e.b === goal && F2) { F = F2; n = g.nodes.get(e.a); rev = true; }
    if (!F || !n) { out.push(e); continue; }
    const c = at(F, n); if (!Number.isFinite(c)) continue; // a grade diz que não chega (água funda, terreno fechado): tira o trecho
    const h = toH(c); out.push({ ...e, hours: h, cost: h * ratio, blocked: false, grid: { F, to: [n.x, n.y], rev, fordPx, label: e.name } });
  }
  if (F1) { const c = at(F1, goalNode); if (Number.isFinite(c)) { const h = toH(c); out.push({ id: "o:terreno", a: "start", b: goal, offroad: true, pts: [[from.x, from.y], [goalNode.x, goalNode.y]], px: 0, units: 0, hours: h, cost: h * (g.offPenalty ?? 1), use, parts: [], type: "direto", name: "Fora de estrada", grid: { F: F1, to: [goalNode.x, goalNode.y], rev: false, fordPx, label: "Fora de estrada" } }); } }
  const keep = g.edges.filter(e => !e.offroad || e.detour || e.stay);
  g.edges = [...keep, ...out]; g.tgrid = G; g.cgrid = Gc; return G;
}
/** Desenha o trecho escolhido que veio da grade. */
function gridLegOf(g, e, fromName, toName) {
  const { F, to, rev, fordPx, label } = e.grid; const pts = gPath(g.cgrid ?? g.tgrid, F, to, fordPx); if (!pts) return null;
  const leg = gridLeg(g, g.tgrid, rev ? [...pts].reverse() : pts, fordPx, label, fromName, toName);
  const crooked = polyLength(leg.pts) > dist(leg.pts[0], leg.pts[leg.pts.length - 1]) * 1.03;
  if (crooked && label === "Fora de estrada") leg.name = "Fora de estrada (contornando o terreno)";
  return leg;
}
/** Trecho fora de estrada por vários pontos (soma os pedaços em linha reta). */
function multiLeg(g, pts, label, fromName, toName) {
  const parts = []; for (let i = 1; i < pts.length; i++) parts.push(directLeg(g, { x: pts[i - 1][0], y: pts[i - 1][1] }, { x: pts[i][0], y: pts[i][1] }, label, true));
  const H = parts.reduce((s, l) => s + l.hours, 0) || 1; const zm = new Map();
  for (const l of parts) for (const pt of l.parts ?? []) { const k = pt.z?.id ?? "_"; const c = zm.get(k) ?? { z: pt.z, frac: 0 }; c.frac += pt.frac * l.hours / H; zm.set(k, c); }
  return { ...parts[0], pts, px: parts.reduce((s, l) => s + l.px, 0), units: parts.reduce((s, l) => s + l.units, 0), hours: parts.reduce((s, l) => s + l.hours, 0), blocked: parts.some(l => l.blocked), fords: parts.reduce((s, l) => s + (l.fords || 0), 0), wet: Math.max(0, ...parts.map(l => l.wet || 0)), parts: [...zm.values()], name: label, fromName, toName, detour: true };
}

function planCore(scene, mover, target, { pace = "normal", direct = false, roads = true, gm = game.user.isGM, tr = null, avoidWx = false, avoidRough = true } = {}) {
  tr ??= mover ? transportOf(mover) : SIMPLE_TR();
  const g = buildGraph(scene, { pace, tr, gm }); const sc = g.sc; const warn = [];
  if (isAir(tr.mode)) direct = true; // quem voa vai em linha reta
  const pen = avoidWx && g.wx?.enabled && !waterOnly(tr) ? wxPenalty(scene, g) : null;
  // destino
  let goal, goalNode, toId = null;
  if (typeof target === "string") { goal = `p:${target}`; goalNode = g.nodes.get(goal); toId = target; if (!goalNode) return null; }
  else if (target && target.x != null) {
    const near = [...g.nodes.values()].find(n => n.poi && Math.hypot(n.x - target.x, n.y - target.y) < sc.size * 0.6);
    if (near) { goal = near.key; goalNode = near; toId = near.poi.id; }
    else { goal = "goal"; goalNode = { key: "goal", x: target.x, y: target.y, name: target.name || "ponto escolhido", loose: true }; }
  } else return null;
  // partida
  const atKey = mover?.at && g.nodes.has(`p:${mover.at}`) ? `p:${mover.at}` : null;
  const from = { key: "start", x: mover?.x ?? goalNode.x, y: mover?.y ?? goalNode.y, name: atKey ? g.nodes.get(atKey).name : "posição atual", loose: true };
  if (atKey && atKey === goal) return { legs: [], totalUnits: 0, totalHours: 0, days: [], warn: ["Já estão aqui."], pts: [[goalNode.x, goalNode.y]], to: goalNode, toId, target, units: sc.units, here: true, tr };
  let legs = [];
  if (waterOnly(tr)) {
    const G = waterGrid(scene, g); const wp = waterPath(G, [from.x, from.y], [goalNode.x, goalNode.y], wrapOf(scene));
    if (!wp) { warn.push(`${tr.label} só anda na água: não há caminho por rio, mar ou Região de água até lá.`); return { legs: [], totalUnits: 0, totalHours: 0, days: [], warn, pts: [[from.x, from.y]], to: goalNode, toId, target, units: sc.units, blocked: true, tr }; }
    const px = polyLength(wp); const units = px * sc.perPx; const mult = Math.max(0.4, 1 + 0.3 * windFactor(g.wx, wp)); const hours = units * sc.mi / Math.max(0.1, speedFor(tr, "barco", pace) * mult);
    legs.push({ id: null, offroad: true, pts: wp, px, units, hours, mult, use: "barco", parts: [], type: "agua", name: "Pela água", fromName: from.name, toName: goalNode.name });
    direct = true; // já resolvido
  }
  else if (direct && pen) { // linha reta, mas contornando o mau tempo
    const dp = detourPath(g, from, goalNode, pen); const ml = dp && dp.length > 2 ? multiLeg(g, dp, "Contornando o mau tempo", from.name, goalNode.name) : null;
    if (ml && !ml.blocked) legs.push(ml); else { const dl = directLeg(g, from, goalNode); if (dl.blocked) direct = false; else legs.push(dl); } }
  else if (direct && (() => { const dl = directLeg(g, from, goalNode); if (!dl.blocked || !dl.blockedZone) return false; // terreno proibido: contorna pelo mato
      const dp = detourPath(g, from, goalNode, () => 1); const ml = dp && dp.length > 2 ? multiLeg(g, dp, `Contornando ${dl.blockedZone}`, from.name, goalNode.name) : null;
      if (!ml || ml.blocked) return false; legs.push(ml); warn.push(`${tr.label} não entra em ${dl.blockedZone}: o caminho contorna o terreno.`); return true; })()) { /* feito */ }
  else if (direct) { const dl = directLeg(g, from, goalNode); if (dl.blocked) { direct = false; warn.push(dl.blockedZone ? `${tr.label} não entra em ${dl.blockedZone}: seguindo por onde dá para passar.` : waterOnly(tr) ? `${tr.label} só anda na água: seguindo pelos rios e mares.` : `${tr.label} não atravessa a água em linha reta: seguindo pelas estradas e pontes.`); } else legs.push(dl); }
  if (!direct) {
    const straightPx = Math.hypot(goalNode.x - from.x, goalNode.y - from.y);
    const reach = Math.max(1, Number(dataOf(scene).map?.roadReach) || 25) * sc.size; // raio de acesso às estradas
    if (waterOnly(tr)) roads = false; // navio: só água
    const R = roads ? reach : Math.max(sc.size * 3, straightPx); const penalty = roads ? 6 : 1;
    g.nodes.set("start", from); if (goal === "goal") g.nodes.set("goal", goalNode);
    if (atKey) { const n = g.nodes.get(atKey); g.edges.push({ id: null, a: "start", b: atKey, pts: [[from.x, from.y], [n.x, n.y]], px: 0, units: 0, hours: 0, use: tr.mode, parts: [], type: "parado", name: n.name, stay: true }); }
    const ends = [{ ...from, radius: R }]; if (goal === "goal" || !g.edges.some(e => e.a === goal || e.b === goal)) ends.push({ ...goalNode, key: goal, radius: R });
    connectLoose(g, ends, goal, { perpOnly: roads, penalty });
    const dl = directLeg(g, from, goalNode, "Fora de estrada", true); if (!dl.blocked) g.edges.push({ ...dl, id: "o:direto", a: "start", b: goal, offroad: true, cost: dl.hours * penalty });
    g.offPenalty = penalty; g.avoidRough = avoidRough; terrainize(scene, g, from, goal, goalNode); // fora de estrada: contorna rios, mares, montanhas e terreno lento
    if (pen) { // mau tempo pesa na escolha (não muda as horas de marcha)
      const st = sc.size / 2; for (const e of g.edges) { if (e.stay) continue; e.cost = (e.cost ?? e.hours) * avgPen(pen, e.pts, st); }
      const dp = detourPath(g, from, goalNode, pen); if (dp && dp.length > 2) { const ml = multiLeg(g, dp, "Contornando o mau tempo", from.name, goalNode.name); if (!ml.blocked) g.edges.push({ ...ml, id: "o:desvio", a: "start", b: goal, offroad: true, cost: ml.hours * avgPen(pen, dp, st) * penalty }); }
    }
    const D = dijkstraAll(g, "start"); const path = pathTo(D, "start", goal);
    if (path) for (const st of path) {
      const e = st.e; if (e.stay) continue;
      const pts = st.fwd ? e.pts : [...e.pts].reverse(); const toKey = st.fwd ? e.b : e.a;
      let leg = { ...e, pts, toKey, fromName: g.nodes.get(st.from)?.name, toName: g.nodes.get(toKey)?.name };
      if (e.grid) { const gl = gridLegOf(g, st.fwd ? e : { ...e, grid: { ...e.grid, rev: !e.grid.rev } }, leg.fromName, leg.toName); leg = gl ? { ...gl, toKey } : { ...directLeg(g, { x: pts[0][0], y: pts[0][1], name: leg.fromName }, { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1], name: leg.toName }, e.name), toKey }; }
      else if (e.offroad && e.detour) leg = { ...e, pts, toKey, fromName: leg.fromName, toName: leg.toName };
      else if (e.offroad) leg = { ...directLeg(g, { x: pts[0][0], y: pts[0][1], name: leg.fromName }, { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1], name: leg.toName }, e.name), toKey };
      legs.push(leg);
    }
    legs = mergeLegs(legs);
    if (!path) { const dl2 = directLeg(g, from, goalNode); if (dl2.blocked) { warn.push(waterOnly(tr) ? `${tr.label} só anda na água: não há caminho por rio, mar ou Região de água até lá.` : landVehicle(tr) ? `${tr.label}: não há caminho por terra até lá (a água corta o caminho e não há ponte inteira nem água rasa para passar).` : `Água funda no caminho: só dá para atravessar com barco (ou voando), e não há ponte nem vau até lá.`); return { legs: [], totalUnits: 0, totalHours: 0, days: [], warn, pts: [[from.x, from.y]], to: goalNode, toId, target, units: sc.units, blocked: true, tr }; } legs.push(dl2); }
    if (!legs.length) legs.push(directLeg(g, from, goalNode));
    const onRoad = legs.filter(l => !l.offroad && l.type !== "direto");
    if (!onRoad.length) warn.push(!g.edges.some(e => !e.offroad && !e.stay) ? (legs.some(l => l.grid || /contornando/i.test(l.name ?? "")) ? "Não há estrada conhecida até lá: viagem fora de estrada, contornando o terreno." : "Não há estrada conhecida até lá: viagem em linha reta, fora de estrada.") : roads ? `Nenhuma estrada a menos de ${Math.round(reach / sc.size)} quadros: viagem fora de estrada.` : (legs.some(l => /contornando/i.test(l.name ?? "")) ? "Mais rápido seguir fora das estradas, contornando o terreno." : "Mais rápido seguir em linha reta, fora das estradas."));
    if (legs.some(l => l.offroad && l.fords)) warn.push("Atravessam um rio a vau ou a nado (mais lento).");
    else if (legs.some(l => l.offroad && l.wet > 0)) warn.push("Parte do caminho é por água rasa ou alagada (mais lento).");
  }
  const dis = legs.filter(l => l.dismount);
  if (dis.length && tr.mode !== "pe") warn.push(`${tr.label}: não passa em ${dis.map(l => l.name.toLowerCase()).filter((v, i, a) => a.indexOf(v) === i).join(", ")}. Nesse trecho seguem a pé.`);
  if (g.wx.enabled && g.wx.force >= 9 && legs.some(l => l.type === "mar")) warn.push(`Mar perigoso: ${g.wx.force >= 10 ? "tempestade" : "ventania"} em alto-mar.`);
  else if (g.wx.enabled && g.wx.force >= 7) { const rough = g.zones.filter(({ z }) => z.rough); if (rough.length && legs.some(l => l.use === "barco" && sample(l.pts, sc.size).some(q => rough.some(({ r }) => regionContains(r, q[0], q[1]))))) warn.push(`Alto-mar agitado: vento forte (${g.wx.force} Beaufort) na travessia.`); }
  if (g.wx.enabled && ["tempestade", "nevasca"].includes(g.wx.climate)) warn.push("O clima pesa: considere esperar ou viajar mais devagar.");
  // mundo que dá a volta e globo: quem voa vai pelo lado mais curto (no globo, pelo círculo máximo); voo e navio medidos sobre a esfera
  try { const GW = globeOf(scene), SW = GW?.S ?? wrapOf(scene);
    if (GW || SW) for (const l of legs) {
      const air = isAir(l.use) && l.pts.length === 2, sea = l.type === "agua"; if (!air && !sea) continue;
      const before = l.units || 0;
      if (air) { const a = l.pts[0], b = [SW ? unwrapNear(l.pts[1][0], l.pts[0][0], SW) : l.pts[1][0], l.pts[1][1]];
        l.pts = GW ? gcPoints(GW, a, b) : [a, b]; l.px = polyLength(l.pts); }
      const units = GW ? pathKm(GW, l.pts) : l.px * sc.perPx;
      if (before > 0 && units > 0) { l.hours *= units / before; l.units = units; } }
  } catch (e) { console.warn("brumas-atlas | viagem no globo", e); }
  const pts = []; for (const l of legs) for (const p of l.pts) { const last = pts[pts.length - 1]; if (!last || dist(last, p) > 0.5) pts.push(p); }
  // terrenos com clima próprio no caminho
  try { const zl = zoneWxList(scene); if (zl.length && pts.length > 1) { const hit = new Map(); for (const q of sample(pts, sc.size)) for (const z of zl) if (regionContains(z.r, q[0], q[1])) hit.set(z.r.id, z);
    for (const z of hit.values()) warn.push(`Passa por ${z.name}: ${z.Z.label.toLowerCase()}${z.temp != null ? ` (${z.temp}°C)` : ""}.`); } } catch (e) { /* */ }
  const totalUnits = legs.reduce((s, l) => s + l.units, 0); const totalHours = legs.reduce((s, l) => s + l.hours, 0);
  const plan = { legs, totalUnits, totalHours, warn, pts, to: goalNode, toId, target, pace, mode: tr.mode, tr, units: sc.units, moverId: mover?.id ?? null, moverName: mover?.name ?? "Grupo" };
  plan.hpd = tr.hpd || HOURS_PER_DAY; plan.mph = tr.mph;
  plan.days = daysOf(plan, g.zones);
  return plan;
}

/** Posição e trecho após `h` horas de marcha. */
export function positionAt(plan, h) {
  let acc = 0;
  for (let i = 0; i < plan.legs.length; i++) {
    const l = plan.legs[i];
    if (h <= acc + l.hours + 1e-6) { const f = l.hours ? (h - acc) / l.hours : 1; if (l.portal || l.seam) return { leg: l, i, f, pt: f >= 1 - 1e-6 ? l.pts[l.pts.length - 1] : l.pts[0] }; return { leg: l, i, f, pt: pointAt(l.pts, polyLength(l.pts) * Math.min(1, Math.max(0, f))) }; }
    acc += l.hours;
  }
  const l = plan.legs[plan.legs.length - 1]; return { leg: l, i: plan.legs.length - 1, f: 1, pt: l?.pts[l.pts.length - 1] ?? [plan.to.x, plan.to.y] };
}
function daysOf(plan, zones) {
  const HPD = plan.hpd || HOURS_PER_DAY;
  const out = []; const T = plan.totalHours;
  // paradas: as escolhidas pelo grupo (plan.stops, em horas de marcha) ou a sugestão automática (a cada dia de marcha)
  const ends = Array.isArray(plan.stops) ? [...new Set(plan.stops.filter(h => h > 0.25 && h < T - 0.25).map(h => Math.round(h * 100) / 100))].sort((a, b) => a - b).concat([T])
    : (() => { const first = Math.max(0.5, HPD - (plan.todayStart || 0)); const out = []; let e = first; while (e < T - 0.5) { out.push(e); e += HPD; } out.push(T); return out; })();
  const n = ends.length;
  for (let d = 1; d <= n; d++) {
    const last = d === n; const end = ends[d - 1]; const start = d > 1 ? ends[d - 2] : 0; const pos = positionAt(plan, end);
    const atNode = pos.f > 0.97 || (pos.leg?.hours ?? 0) * (1 - pos.f) < 0.25;
    const z = zoneAt(zones, pos.pt[0], pos.pt[1]);
    out.push({ n: d, hours: end - start, start, forced: end - start > HPD + 0.05, custom: Array.isArray(plan.stops), end, last, pt: pos.pt, where: last ? `Chegada: ${plan.to.name}` : atNode ? `Pernoite em ${pos.leg?.toName ?? "?"}` : `Pernoite ${pos.leg?.type === "direto" ? "no ermo" : `na ${(pos.leg?.name ?? "estrada").toLowerCase()}`}${z ? ` (${z.name})` : ""}`, camp: !last && !atNode, biome: z?.biome ?? "planicie", zone: z?.name ?? "" });
  }
  return out;
}

export const fmtH = (h) => { const H = Math.floor(h + 1e-6); const M = Math.round((h - H) * 60); return M >= 60 ? `${H + 1}h` : M ? `${H}h${String(M).padStart(2, "0")}` : `${H}h`; };
export function fmtDur(h, HOURS_PER_DAY = 8) { if (h <= HOURS_PER_DAY + 1e-6) return fmtH(h); const d = Math.ceil(h / HOURS_PER_DAY - 1e-6); return `${d} dias`; }
export const fmtUnits = (u, units) => `${u >= 10 ? Math.round(u) : u.toFixed(1)} ${units}`;

/* ---------- execução (Mestre) ---------- */
/**
 * Faz a viagem acontecer. opts: { day: true (só um dia), time, encounters, reveal }
 */
/**
 * Executa a viagem. Embarques e desembarques não são automáticos: o grupo anda até o ponto da troca
 * e o mestre confirma (embarcar/desembarcar e seguir, seguir sem embarcar, ou cancelar a viagem).
 */
export async function executeTravel(scene, plan, opts = {}) {
  if (!plan?.legs?.length) return;
  const HPD = plan.hpd || HOURS_PER_DAY;
  const want = Math.min(plan.totalHours, opts.upTo != null ? Math.max(0.05, Number(opts.upTo)) : opts.day ? (plan.days?.[0]?.end ?? Math.min(HPD, plan.totalHours)) : plan.totalHours);
  const whole = want >= plan.totalHours - 1e-6;
  const tf = (plan.transfers ?? []).filter(t => t.h <= want + 1e-6).sort((a, b) => a.h - b.h)[0];
  if (!tf || !game.user.isGM) return runTravel(scene, plan, { ...opts, upTo: want });
  let r = null;
  if (tf.h > 0.02) { r = await runTravel(scene, plan, { ...opts, upTo: tf.h }); await r?.done; if (r?.rec?.cancelled) return { ...r, arrived: false, cancelled: true }; }
  const emb = tf.kind === "embarque";
  const buttons = [{ action: "ok", label: emb ? `Embarcar em ${tf.name}` : `Desembarcar de ${tf.name}`, icon: emb ? "fa-solid fa-right-to-bracket" : "fa-solid fa-person-walking", default: true }];
  if (emb) buttons.push({ action: "foot", label: "Seguir sem embarcar", icon: "fa-solid fa-shoe-prints" });
  buttons.push({ action: "cancel", label: "Cancelar viagem", icon: "fa-solid fa-xmark" });
  const content = emb ? `<p><b>${plan.moverName}</b> chegou a <b>${tf.name}</b>. Embarcar e seguir viagem nele?</p>`
    : `<p><b>${tf.name}</b> não segue daqui em diante. <b>${plan.moverName}</b> desembarca e continua a pé (o veículo fica parado aqui)?</p>`;
  const choice = await foundry.applications.api.DialogV2.wait({ window: { title: `Atlas · ${emb ? "Embarque" : "Desembarque"}` }, content, buttons, rejectClose: false }).catch(() => null);
  const stopHere = async () => { await mutateData(scene, (d) => { const g = d.movers.find(x => x.id === plan.moverId); if (g) g.plan = null; return ["movers"]; }); return { ...(r ?? {}), arrived: false, cancelled: true }; };
  if (!choice || choice === "cancel") return stopHere();
  if (choice === "ok") await applyTransfer(scene, plan.moverId, tf, plan.moverName);
  const m = dataOf(scene).movers.find(x => x.id === plan.moverId); if (!m) return r;
  const left = want - tf.h - (choice === "ok" ? 0.25 : 0);
  if (!whole && left < 0.05) return { ...(r ?? {}), arrived: false };
  const via = Array.isArray(m.plan?.via) ? m.plan.via : (tf.h <= 0.02 ? plan.via ?? [] : []);
  const next = planTravel(scene, normMover(m), plan.target, { ...(plan.popts ?? {}), gm: true, via: via.length ? via : null, noTransfers: choice === "foot" });
  if (!next || next.here) return { ...(r ?? {}), arrived: !!next?.here };
  if (next.blocked) { globalThis.ui?.notifications?.warn(`Atlas · ${next.warn?.[0] ?? "não há caminho daqui."}`); return stopHere(); }
  return executeTravel(scene, next, { ...opts, upTo: whole ? null : left, day: false });
}
/* ---------- viagens em andamento (para cancelar com Esc ou pelo painel) ---------- */
const ACTIVE = new Map(); // moverId -> registro da viagem animando agora

/* ---------- tempo de cada grupo ---------- */
// Cada grupo tem o seu relógio. Quem ficou parado enquanto outro viajava tem horas "livres": a viagem dele
// acontece ao mesmo tempo que a do outro e só avança o relógio do mundo no que passar dele.
// Ex.: A viaja 8 h (o mundo anda 8 h); depois B viaja 10 h: o mundo anda só mais 2 h.
// Quando o tempo anda por fora do Atlas (descanso, calendário, combate), todos voltam a ficar juntos.
const clocksOf = () => { const c = game.settings.get(MODULE_ID, "clocks"); return c && typeof c === "object" ? c : {}; };
/** Em que momento do mundo o grupo está (segundos). */
export function groupClock(m) { const w = game.time.worldTime; const t = Number(clocksOf()[m?.id ?? m]); return Number.isFinite(t) ? Math.min(w, t) : w; }
/** Horas que o grupo pode viajar sem avançar o relógio do mundo. */
export const groupLag = (m) => Math.max(0, game.time.worldTime - groupClock(m)) / 3600;
/** O mestre põe o grupo no "agora" (ele não vai viajar ao mesmo tempo que os outros). */
export async function syncGroupClock(id) { if (!game.user.isGM) return; const c = { ...clocksOf() }; delete c[id]; await game.settings.set(MODULE_ID, "clocks", c); }
let TQ = Promise.resolve(); const OWN = new Set();
/** A viagem andou `secs` a partir de `start`: grava o relógio do grupo e avança o mundo só no que passou dele. */
export function spendTime(moverId, start, secs) {
  TQ = TQ.catch(() => null).then(async () => {
    if (!game.user.isGM) return; const w = game.time.worldTime; const end = Math.round(start + secs);
    const c = { ...clocksOf() };
    if (end > w) for (const sc of mapScenes()) for (const o of dataOf(sc).movers ?? []) if (!o.parked && o.id !== moverId && !Number.isFinite(Number(c[o.id]))) c[o.id] = w; // os outros ficaram parados até aqui
    c[moverId] = end; const w2 = Math.max(w, end);
    for (const [k, v] of Object.entries(c)) if (!(Number(v) < w2)) delete c[k]; // quem está no agora não precisa de registro
    await game.settings.set(MODULE_ID, "clocks", c);
    if (end > w) { OWN.add(end); try { await game.time.advance(end - w); } catch (e) { console.warn(`${MODULE_ID} | tempo`, e); } setTimeout(() => OWN.delete(end), 10000); }
  });
  return TQ;
}
/** O relógio andou: se não foi uma viagem do Atlas, todos os grupos voltam a ficar juntos no tempo. */
export function onWorldTime(worldTime) {
  if (!isActiveGM()) return; if (OWN.has(worldTime)) { OWN.delete(worldTime); return; }
  if (Object.keys(clocksOf()).length) game.settings.set(MODULE_ID, "clocks", {});
}
const easeT = (t) => { const a = 0.18; if (t <= 0) return 0; if (t >= 1) return 1; const v = 1 / (1 - a); if (t < a) return v * t * t / (2 * a); if (t > 1 - a) return 1 - v * (1 - t) * (1 - t) / (2 * a); return v * (t - a / 2); };
/** Há viagem animando (deste grupo, ou qualquer uma nesta cena)? */
export function travelActive(moverId = null, sceneId = null) { for (const r of ACTIVE.values()) if ((!moverId || r.moverId === moverId) && (!sceneId || r.sceneId === sceneId) && !r.cancelled) return true; return false; }
/** Névoa e descobertas ao longo de um trecho andado. */
function applyWalk(d, walked, sc, { reveal = true, arrived = false, toId = null, SW = null } = {}, found = [], visited = []) {
  // mundo que dá a volta: o caminho vira pedaços dentro do mapa (nada de linha atravessando o mapa na costura)
  let pieces = [walked]; if (SW && walked.length > 1) { const pc = seamPieces(SW, unwrapPts(walked, SW)); pieces = pc.length ? pc : [walked.map(p => [wrapX(p[0], SW), p[1]])]; walked = pieces.flat(); }
  if (reveal) {
    const R = (d.map?.reveal ?? REVEAL_CELLS) * sc.size;
    for (const p of pieces.flatMap(pc => sample(pc, R * 0.8))) { if (!d.explored.some(e => Math.hypot(e[0] - p[0], e[1] - p[1]) + R <= e[2] + 1)) d.explored.push([Math.round(p[0]), Math.round(p[1]), Math.round(R)]); }
    if (d.explored.length > 1500) d.explored = d.explored.slice(-1500);
  }
  const sight = SIGHT_CELLS * sc.size;
  d.pois = d.pois.map(p0 => {
    const p = normPoi(p0);
    const near = walked.reduce((m, q) => Math.min(m, Math.hypot(q[0] - p.x, q[1] - p.y)), Infinity);
    const passed = near < sc.size * 0.75 && (p.id === toId ? arrived : true);
    if (passed && p.state !== "visitado" && !p.hidden) { visited.push(p.name); return { ...p0, state: "visitado" }; }
    if (near <= sight && POI_STATES[p.state].order < 2 && !p.hidden) { found.push(p.name); return { ...p0, state: "avistado" }; }
    return p0;
  });
}
/** Desfaz só o que esta viagem revelou (não mexe no que outras viagens ao mesmo tempo revelaram). */
function undoWalk(d, u) {
  if (!u) return; const added = new Set(u.explored.map(e => e.join(",")));
  d.explored = (d.explored ?? []).filter(e => !added.has(e.join(",")));
  for (const [id, [before, after]] of Object.entries(u.pois)) { const p = d.pois.find(x => x.id === id); if (p && (p.state ?? "") === after) p.state = before; }
}
/**
 * Cancela a viagem que está animando: o grupo para onde o marcador está agora.
 * Desfaz o que ainda não foi andado (névoa, locais descobertos, tempo do mundo) e apaga o plano.
 */
export async function cancelTravel(scene, moverId) {
  if (!game.user.isGM) return false; const recs = [...ACTIVE.values()].filter(r => (!moverId || r.moverId === moverId) && r.sceneId === scene.id && !r.cancelled); if (!recs.length) return false;
  const sc = scaleOf(scene);
  for (const rec of recs) { rec.cancelled = true; ACTIVE.delete(rec.moverId);
    const e = easeT(Math.min(1, (pnow() - rec.t0) / rec.dur)); const L = polyLength(rec.walked); const sL = L * e; const pt = pointAt(rec.walked, sL);
    const part = []; let acc = 0; for (let i = 0; i < rec.walked.length; i++) { if (i) acc += dist(rec.walked[i - 1], rec.walked[i]); if (acc > sL) break; part.push(rec.walked[i]); } part.push(pt);
    await mutateData(scene, (d) => { undoWalk(d, rec.undo); applyWalk(d, part, sc, { reveal: rec.reveal, SW: wrapOf(scene) });
      const g = d.movers.find(x => x.id === rec.moverId); if (g) { g.x = Math.round(wrapX(pt[0], wrapOf(scene))); g.y = Math.round(pt[1]); g.at = null; g.plan = null; g.vote = null; g.today = Math.round(((Number(rec.snap.today) || 0) + rec.hours * e) * 100) / 100; }
      return ["explored", "pois", "movers"]; });
    if (rec.time && !rec.timeDone) { rec.timeDone = true; await spendTime(rec.moverId, rec.start, Math.round(rec.secs * e)); }
    game.socket.emit(SOCKET, { type: "animStop", sceneId: scene.id, moverId: rec.moverId }); Hooks.callAll(`${MODULE_ID}.animStop`, { sceneId: scene.id, moverId: rec.moverId });
    await addLog({ kind: "viagem", sceneId: scene.id, text: `${rec.name}: viagem interrompida no caminho (${fmtH(rec.hours * e)} de marcha).` }); }
  Hooks.callAll(`${MODULE_ID}.refresh`); return true;
}
async function runTravel(scene, plan, opts = {}) {
  if (!plan?.legs?.length) return;
  const { time = true, encounters = true, reveal = true } = opts;
  const HPD = plan.hpd || HOURS_PER_DAY;
  const hours = Math.min(plan.totalHours, opts.upTo != null ? Math.max(0.05, Number(opts.upTo)) : opts.day ? (plan.days?.[0]?.end ?? Math.min(HPD, plan.totalHours)) : plan.totalHours);
  const arrived = hours >= plan.totalHours - 1e-6;
  const endPos = positionAt(plan, hours);
  const doneDays = (plan.days ?? []).filter(d => !d.last && d.end < hours - 1e-6); const nights = doneDays.length;
  const lastStop = doneDays.length ? doneDays[doneDays.length - 1].end : 0; // horas de marcha no último dia
  const atStop = !arrived && (plan.days ?? []).some(d => !d.last && Math.abs(d.end - hours) < 0.02); // a etapa terminou numa parada: pernoite
  const today0 = Math.max(0, Number(plan.todayStart) || 0); const restFirst = Math.max(0, Number(plan.restFirst) || 0);
  // tempo que passa: cada dia completo vai até a manhã seguinte; parando numa parada, a noite também passa
  let elapsed = 0; { let prev = 0, tb = today0; for (const dd of doneDays) { elapsed += 24 - tb - 0 + 0; tb = 0; prev = dd.end; } }
  const lastDayMarch = hours - lastStop; const todayNow = (nights ? 0 : today0) + lastDayMarch;
  elapsed += atStop ? Math.max(lastDayMarch, 24 - (nights ? 0 : today0)) : lastDayMarch;
  if (restFirst) elapsed += Math.max(0, 24 - restFirst); // a noite de descanso antes de partir
  // trecho percorrido
  const walked = []; const jumps = []; let acc = 0;
  for (const l of plan.legs) {
    if (acc >= hours) break;
    const f = Math.min(1, (hours - acc) / (l.hours || 1)); const L = polyLength(l.pts);
    if (l.seam) { walked.push(l.pts[0]); jumps.push({ i: walked.length - 1, seam: true }); walked.push(l.pts[l.pts.length - 1]); acc += l.hours; continue; } // costura: sai por uma borda, entra pela outra
    if (l.portal) { // teleporte: um salto da entrada à saída (a animação faz o resto)
      if (f < 1 - 1e-6 && l.hours > 0) { walked.push(l.pts[0]); acc += l.hours; continue; } // o ritual não terminou: o grupo fica na entrada
      walked.push(l.pts[0]); jumps.push({ i: walked.length - 1, color: l.tpColor || "#b58ce8", name: l.name }); walked.push(l.pts[l.pts.length - 1]); acc += l.hours; continue; }
    const part = f >= 1 ? l.pts : [...l.pts.filter((p, i) => { let s = 0; for (let k = 1; k <= i; k++) s += dist(l.pts[k - 1], l.pts[k]); return s <= L * f; }), pointAt(l.pts, L * f)];
    for (const p of part) walked.push(p); acc += l.hours;
  }
  const sc = scaleOf(scene);
  // animação em todos os clientes
  // duração pela velocidade: mais rápido anda mais depressa na tela
  let jumpLen = 0; for (const j of jumps) jumpLen += dist(walked[j.i], walked[j.i + 1]); const nTp = jumps.filter(j => !j.seam).length;
  const cells = Math.max(0, polyLength(walked) - jumpLen) / sc.size; const cps = Math.max(0.8, Math.min(9, 0.75 * (plan.mph || 3)));
  const slow = Math.max(0.25, Number(setting("animSlow", 3)) || 3); // configuração do módulo
  const JUMP_MS = 2800; const moveMs = cells > 0.01 ? Math.round(Math.max(1200, Math.min(16000, cells / cps * 1000)) * slow) : 0;
  const dur = jumps.length ? Math.max(400, moveMs + nTp * JUMP_MS) : Math.round(Math.max(1200, Math.min(16000, cells / cps * 1000)) * slow);
  const d0 = dataOf(scene); const rec = { sceneId: scene.id, moverId: plan.moverId, name: plan.moverName, walked, dur, t0: pnow(), hours, reveal, secs: Math.round(elapsed * 3600), time, timeDone: false, cancelled: false,
    start: groupClock(plan.moverId), undo: null, snap: { today: d0.movers.find(x => x.id === plan.moverId)?.today ?? 0 } };
  if (game.paused && game.user.isGM) globalThis.ui?.notifications?.info(`Atlas · o jogo está pausado: ${plan.moverName} parte quando você despausar.`);
  ACTIVE.set(plan.moverId, rec);
  // fim da animação (o tempo pausado não conta): o relógio do mundo anda só agora
  const done = waitPlay(dur + 200, () => rec.cancelled).then(async () => {
    if (rec.cancelled) return; if (ACTIVE.get(plan.moverId) === rec) ACTIVE.delete(plan.moverId);
    if (rec.time && !rec.timeDone) { rec.timeDone = true; await spendTime(rec.moverId, rec.start, rec.secs); }
    Hooks.callAll(`${MODULE_ID}.refresh`);
  });
  const tp = jumps.length ? { jumps, moveMs, jumpMs: JUMP_MS } : null;
  game.socket.emit(SOCKET, { type: "anim", sceneId: scene.id, moverId: plan.moverId, pts: walked, dur, tp });
  Hooks.callAll(`${MODULE_ID}.anim`, { sceneId: scene.id, moverId: plan.moverId, pts: walked, dur, tp });

  // trocas de transporte alcançadas hoje: acontecem no momento em que o marcador chega ao ponto
  const totalLen = polyLength(walked) || 1;
  void totalLen; // as trocas de transporte são confirmadas pelo mestre (executeTravel)
  const found = []; const visited = [];
  await mutateData(scene, (d) => {
    const exp0 = new Set((d.explored ?? []).map(e => e.join(","))); const st0 = Object.fromEntries(d.pois.map(p => [p.id, p.state ?? ""]));
    applyWalk(d, walked, sc, { reveal, arrived, toId: plan.toId, SW: wrapOf(scene) }, found, visited);
    rec.undo = { explored: (d.explored ?? []).filter(e => !exp0.has(e.join(","))), pois: Object.fromEntries(d.pois.filter(p => (p.state ?? "") !== st0[p.id]).map(p => [p.id, [st0[p.id], p.state ?? ""]])) };
    const mi = d.movers.findIndex(m => m.id === plan.moverId); const m0 = normMover(d.movers[mi] ?? { id: plan.moverId });
    const swap = {}; // as trocas de transporte acontecem quando a animação chega ao ponto (veja abaixo)
    const mi2 = d.movers.findIndex(m => m.id === plan.moverId);
    const upd = { ...(d.movers[mi2] ?? m0), ...swap, x: Math.round(wrapX(endPos.pt[0], wrapOf(scene))), y: Math.round(endPos.pt[1]), at: arrived ? plan.toId : (endPos.f > 0.97 && endPos.leg?.toKey?.startsWith("p:") ? endPos.leg.toKey.slice(2) : null), today: atStop ? 0 : todayNow,
      plan: arrived ? null : { target: plan.target, pace: plan.pace, via: (() => { if (!plan.via?.length) return []; let acc = 0, k = 0; for (const l of plan.legs) { acc += l.hours; if (l.type === "via") { if (acc <= hours + 1e-6) k++; } } return plan.via.slice(k); })() }, vote: null };
    if (mi2 >= 0) d.movers[mi2] = upd; else d.movers.push(upd);
    return ["explored", "pois", "movers"];
  });

  // tempo do mundo: noites contam inteiras; anda no fim da animação (veja "done" acima)

  // encontros por zona (1 teste a cada 4 h dentro da zona)
  const enc = [];
  if (encounters) {
    let left = hours;
    for (const l of plan.legs) {
      if (left <= 0) break; const lh = Math.min(l.hours, left); left -= lh;
      for (const part of l.parts ?? []) {
        const z = part.z; if (!z) continue; const h = lh * part.frac; const checks = Math.max(h > 0.5 ? 1 : 0, Math.round(h / 4));
        for (let i = 0; i < checks; i++) {
          const [num, den] = z.chance ?? [1, 8]; const roll = 1 + Math.floor(Math.random() * den);
          if (roll <= num) enc.push({ z, roll, den });
        }
      }
    }
    for (const e of enc) {
      e.text = "";
      if (e.z.table) try { const t = await fromUuid(e.z.table); const r = await t?.draw?.({ displayChat: false }); e.text = (r?.results ?? []).map(x => x.name ?? x.description ?? x.text).filter(Boolean).join(", "); } catch (err) { console.warn(err); }
    }
  }

  // sem mensagens no chat: o resumo vai para o Diário do Atlas; encontros, só um aviso ao mestre
  if (enc.length && game.user.isGM) globalThis.ui?.notifications?.info(`Atlas · encontros na viagem: ${enc.map(e => `${e.z.name}${e.text ? ` (${e.text})` : ""}`).join("; ")}`, { permanent: true });
  // diário de viagem
  try {
    const camps = (plan.days ?? []).filter(d => !d.last && d.end < hours - 1e-6).map(d => d.where.replace(/^Pernoite /, ""));
    const swaps = (plan.transfers ?? []).filter(t => t.h <= hours + 1e-6).map(t => `${t.kind === "embarque" ? "embarcaram em" : "desembarcaram de"} ${t.name}`);
    const via = (plan.legs ?? []).filter(l => l.type === "via").map(l => l.fromName);
    const dist = fmtUnits(plan.totalUnits * Math.min(1, hours / plan.totalHours), plan.units);
    await addLog({ kind: "viagem", sceneId: scene.id, group: plan.moverName, from: plan.legs[0]?.fromName ?? "partida", to: arrived ? plan.to.name : "o fim do dia", arrived, dist, march: fmtH(hours), nights, camps, swaps, via, enc: enc.length, mode: plan.tr?.label ?? "", encs: enc.map(e => `${e.z.name} (${e.roll} em d${e.den})${e.text ? `: ${e.text}` : ""}`), visited, found,
      text: `${plan.moverName}: ${plan.legs[0]?.fromName ?? "partida"} → ${arrived ? plan.to.name : "acampamento"} · ${dist} em ${fmtH(hours)} de marcha${nights ? ` e ${nights} noite(s)` : ""}` });
  } catch (e) { console.warn(`${MODULE_ID} | diário`, e); }
  for (const n of visited) await addLog({ kind: "visitado", text: `Visitado: ${n}`, sceneId: scene.id });
  for (const n of found) await addLog({ kind: "avistado", text: `Avistado: ${n}`, sceneId: scene.id });
  return { arrived, hours, visited, found, enc, dur, rec, done };
}
