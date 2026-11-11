// Pacote de mapa (semente): troca o fundo de um mapa e o povoa de uma vez — locais, rótulos e Regiões com terreno —
// a partir de um arquivo JSON com posições em frações da imagem (0–1). Guarda o estado anterior em map.seedPrev.
import { MODULE_ID } from "./config.js";
import { mutateData, normPoi, uid, mapOf, dataOf } from "./data.js";
import { wrapOf, unwrapPts, seamPieces, crossesStored, globeOf, isGc } from "./wrap.js";

/**
 * seed = { id, scene: { name, background, width, height, grid: { distance, units } }, map: { title, fog, radius },
 *          move: [{ submap, at: [fx, fy] }], pois: [{ name, kind, at, state, desc }], labels: [{ text, at, size, rot, color }],
 *          regions: [{ name, preset, color, polys: [[[fx, fy], …], …] }] }
 */
export async function applySeed(scene, seed) {
  if (!scene || !seed || !game.user.isGM) return false;
  const m = mapOf(scene) ?? {};
  const prev = { name: scene.name, background: scene.background?.src ?? "", width: scene.width, height: scene.height, grid: { distance: scene.grid?.distance, units: scene.grid?.units }, title: m.title ?? "", fog: m.fog };
  const S = seed.scene ?? {}; const upd = { [`flags.${MODULE_ID}.map.seedPrev`]: prev, [`flags.${MODULE_ID}.map.seed`]: seed.id ?? "semente" };
  if (S.name) { upd.name = S.name; upd.navName = S.name; }
  if (S.background) upd["background.src"] = S.background;
  if (S.width) upd.width = S.width; if (S.height) upd.height = S.height;
  if (S.grid?.distance) upd["grid.distance"] = S.grid.distance; if (S.grid?.units) upd["grid.units"] = S.grid.units;
  const M = seed.map ?? {};
  if (M.title != null) upd[`flags.${MODULE_ID}.map.title`] = M.title;
  if (M.fog != null) upd[`flags.${MODULE_ID}.map.fog`] = !!M.fog;
  if (M.radius) upd[`flags.${MODULE_ID}.map.world.globo.radius`] = M.radius;
  await scene.update(upd);
  await new Promise(r => setTimeout(r, 300)); // dimensões novas calculadas
  const d = scene.dimensions ?? {}; const X = d.sceneX ?? 0, Y = d.sceneY ?? 0, W = d.sceneWidth ?? scene.width, H = d.sceneHeight ?? scene.height;
  const P = (a) => ({ x: Math.round(X + a[0] * W), y: Math.round(Y + a[1] * H) });
  await mutateData(scene, (D) => {
    for (const mv of seed.move ?? []) { const p = D.pois.find(x => (mv.submap && (x.submap === mv.submap || x.scene === mv.submap)) || (!mv.submap && x.name === mv.name)); if (p) Object.assign(p, P(mv.at)); }
    const names = new Set(D.pois.map(p => p.name));
    for (const p of seed.pois ?? []) { if (names.has(p.name)) continue; D.pois.push(normPoi({ id: uid(), name: p.name, kind: p.kind ?? "local", state: p.state ?? "avistado", desc: p.desc ?? "", ...P(p.at) })); }
    const texts = new Set(D.labels.map(l => l.text));
    for (const l of seed.labels ?? []) { if (texts.has(l.text)) continue; D.labels.push(seedLabel(l, P)); }
    D.explored = []; // a névoa antiga era de outra imagem
    return ["pois", "labels", "explored"];
  });
  const have = new Set(scene.regions?.map(r => r.name) ?? []);
  const regs = (seed.regions ?? []).filter(r => !have.has(r.name)).map(r => ({
    name: r.name, color: r.color ?? "#888888",
    shapes: r.polys.filter(p => p.length >= 3).map(p => ({ type: "polygon", points: p.flatMap(a => { const q = P(a); return [q.x, q.y]; }), hole: false })),
    flags: { [MODULE_ID]: { zone: { preset: r.preset } } }
  })).filter(r => r.shapes.length);
  if (regs.length) await scene.createEmbeddedDocuments("Region", regs);
  globalThis.ui?.notifications?.info(`Atlas · ${S.name ?? scene.name}: mapa trocado e povoado (${(seed.pois ?? []).length} locais, ${(seed.labels ?? []).length} rótulos, ${regs.length} regiões).`);
  return true;
}
const seedLabel = (l, P) => ({ id: uid(), text: l.text, ...P(l.at), size: l.size ?? 20, rot: l.rot ?? 0, ...(l.style ? { style: l.style } : {}), ...(l.color ? { color: l.color } : {}) });
/** Troca os rótulos que vieram de uma semente anterior (textos em seed.oldLabels) pelos rótulos atuais da semente. */
export async function refreshSeedLabels(scene, seed) {
  if (!scene || !game.user.isGM) return false; const d = scene.dimensions ?? {}; const X = d.sceneX ?? 0, Y = d.sceneY ?? 0, W = d.sceneWidth ?? scene.width, H = d.sceneHeight ?? scene.height;
  const P = (a) => ({ x: Math.round(X + a[0] * W), y: Math.round(Y + a[1] * H) }); const old = new Set([...(seed.oldLabels ?? []), ...(seed.labels ?? []).map(l => l.text)]);
  await mutateData(scene, (D) => { D.labels = D.labels.filter(l => !old.has(l.text)); for (const l of seed.labels ?? []) D.labels.push(seedLabel(l, P)); return ["labels"]; });
  return true;
}
/** Desfaz a troca de fundo, nome e escala (os locais, rótulos e Regiões criados ficam; apague à mão o que não quiser). */
export async function revertSeed(scene) {
  const p = mapOf(scene)?.seedPrev; if (!p || !game.user.isGM) return false;
  await scene.update({ name: p.name, navName: p.name, "background.src": p.background, width: p.width, height: p.height, "grid.distance": p.grid?.distance, "grid.units": p.grid?.units, [`flags.${MODULE_ID}.map.title`]: p.title, [`flags.${MODULE_ID}.map.fog`]: p.fog });
  return true;
}
/** Portos e rotas da semente (seed.ports, seed.routes com a/b pelo nome do local). Só cria o que ainda não existe (pelo nome). */
export async function seedRoutes(scene, seed) {
  if (!scene || !game.user.isGM) return false; const d = scene.dimensions ?? {}; const X = d.sceneX ?? 0, Y = d.sceneY ?? 0, W = d.sceneWidth ?? scene.width, H = d.sceneHeight ?? scene.height;
  const P = (a) => ({ x: Math.round(X + a[0] * W), y: Math.round(Y + a[1] * H) }); let nP = 0, nR = 0; const S = wrapOf(scene);
  await mutateData(scene, (D) => {
    const names = new Set(D.pois.map(p => p.name));
    for (const p of seed.ports ?? []) { if (names.has(p.name)) continue; D.pois.push(normPoi({ id: uid(), name: p.name, kind: p.kind ?? "porto", state: "avistado", desc: p.desc ?? "", ...P(p.at) })); nP++; }
    const byName = new Map(D.pois.map(p => [p.name, p])); const have = new Set(D.routes.map(r => r.name));
    for (const r of seed.routes ?? []) {
      if (have.has(r.name)) continue; const a = byName.get(r.a), b = byName.get(r.b); if (!a || !b) continue;
      const mid = (r.via ?? []).map(v => { const q = P(v); return [q.x, q.y]; }); // no globo, as aéreas seguem o círculo máximo sozinhas
      const pcs = seamPieces(S, unwrapPts([[a.x, a.y], ...mid, [b.x, b.y]], S)); // passa da borda: vira pedaços que se encontram nas laterais
      pcs.forEach((pts, k) => D.routes.push({ id: uid(), name: r.name, type: r.type, cond: "aberta", a: k === 0 ? a.id : null, b: k === pcs.length - 1 ? b.id : null, points: pts })); nR++;
    }
    return ["pois", "routes"];
  });
  globalThis.ui?.notifications?.info(`Atlas · ${scene.name}: ${nP} portos e ${nR} rotas (marítimas e aéreas).`);
  return true;
}

/** Rotas guardadas com pontos além da borda (versões 1.45.x) viram pedaços que se encontram nas laterais do mapa. */
export async function splitSeamRoutes(scene) {
  const S = wrapOf(scene); if (!S || !game.user.isGM) return 0; const G = globeOf(scene); let n = 0;
  const bad = (dataOf(scene).routes ?? []).filter(r => (r.points?.length ?? 0) >= 2 && !isGc(r, G) && crossesStored(S, r.points)); if (!bad.length) return 0;
  await mutateData(scene, (D) => {
    const out = [];
    for (const r of D.routes) {
      if (!bad.some(b => b.id === r.id)) { out.push(r); continue; }
      const pcs = seamPieces(S, r.points); n++;
      pcs.forEach((pts, k) => out.push({ ...r, id: k === 0 ? r.id : uid(), points: pts, handles: [], a: k === 0 ? r.a : null, b: k === pcs.length - 1 ? r.b : null }));
    }
    D.routes = out; return ["routes"];
  });
  return n;
}
