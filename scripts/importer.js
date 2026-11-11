// Importação de cenas montadas à moda antiga: tokens como pontos de interesse, Regiões como terreno,
// células reveladas do World Explorer como área explorada.
import { MODULE_ID } from "./config.js";
import { dataOf, mutateData, normPoi, normMover, zoneOf, nrm, uid } from "./data.js";

const KIND_WORDS = [
  ["masmorra", ["mina", "caverna", "forte", "covil", "sumidouro", "cripta", "lair", "masmorra", "tumba", "toca"]],
  ["ruina", ["capela", "ruina", "templo abandon"]],
  ["acamp", ["acampamento"]],
  ["porto", ["estaleiro", "cais", "porto", "doca"]],
  ["vila", ["vila", "aldeia", "povoado", "vilarejo"]],
  ["edificio", ["taverna", "hospedaria", "forja", "fabrica", "centro comercial", "quartel", "torre", "observatorio", "prefeitura", "mercado"]]
];
const isPartyName = (s) => /ve[ií]culo|carruag|carriage|caravana|\bgrupo\b/i.test(s ?? "");
const hasWord = (n, w) => new RegExp(`(^|[^a-z])${w}`).test(n);

export function scanScene(scene) {
  const toks = scene.tokens?.contents ?? [...(scene.tokens ?? [])]; const gs = scene.grid?.size ?? 100;
  const existing = new Set(dataOf(scene).pois.map(p => nrm(p.name)));
  const seen = new Set(); const rows = [];
  for (const t of toks) {
    const actor = t.actorId ? game.actors.get(t.actorId) : null; const name = t.name || actor?.name || "Token";
    const row = { tokenId: t.id, name, x: Math.round(t.x + (t.width ?? 1) * gs / 2), y: Math.round(t.y + (t.height ?? 1) * gs / 2), img: t.texture?.src ?? "", take: true, as: "poi", kind: "local", state: t.hidden ? "oculto" : "visitado", note: "", useImg: !!t.texture?.src && !/mystery-man|icons\/svg/.test(t.texture?.src ?? "") };
    const n = nrm(name);
    const sc = game.scenes.find?.(s => s.id !== scene.id && nrm(s.name) === n) ?? null;
    if (sc) { row.scene = sc.id; row.sceneName = sc.name; }
    let je = game.journal?.find?.(j => nrm(j.name) === n) ?? null;
    if (je) { row.journal = je.uuid; row.journalName = je.name; }
    else for (const j of game.journal ?? []) { const pg = (j.pages?.contents ?? [...(j.pages ?? [])]).find(p => nrm(p.name) === n); if (pg) { row.journal = pg.uuid; row.journalName = `${j.name} › ${pg.name}`; break; } }
    if (actor) { row.actor = actor.uuid; row.actorName = actor.name; }
    const groupish = actor?.type === "group"; const w = t.flags?.world ?? {}; const partyFlag = !!(w.grupoDeAtores || w.totalHorasViajadas != null || w.ultimaViagem);
    if (actor && ["character", "vehicle"].includes(actor.type)) { row.as = "skip"; row.take = false; row.note = actor.type === "character" ? "personagem" : "veículo de combate"; }
    else if ((groupish || !actor) && (isPartyName(name) || isPartyName(actor?.name) || (groupish && /group-icons|navio|carruagem/i.test(row.img)))) { row.as = "party"; row.take = !t.hidden || partyFlag; row.hidden = !!t.hidden; row.mkind = /navio|ship|barco|galle/i.test(`${name} ${row.img}`) ? "navio" : /ve[ií]culo|carruag|carriage|carro|wagon/i.test(`${name} ${row.img}`) ? "veiculo" : "grupo"; row.members = (Array.isArray(w.grupoDeAtores) ? w.grupoDeAtores : (actor?.system?.members ?? []).map(m => m.actor?.id ?? m.actorId ?? m.id)).filter(id => id && game.actors.get(id)); row.note = `${row.members.length} personagens` + (actor ? "" : " · token de viagem"); }
    else if (seen.has(n) || existing.has(n)) { row.as = "dup"; row.take = false; row.note = existing.has(n) ? "já existe no mapa" : "mesmo nome de outro token"; }
    else {
      row.kind = sc && je ? "cidade" : "local";
      if (row.kind !== "cidade") for (const [k, ws] of KIND_WORDS) if (ws.some(w => hasWord(n, w))) { row.kind = k; break; }
      if (scene.flags?.[MODULE_ID]?.map?.level === "cidade" && row.kind === "local") row.kind = "edificio";
      if (!groupish && actor) { row.actor = ""; row.actorName = ""; }
    }
    seen.add(n); rows.push(row);
  }
  const regions = (scene.regions?.contents ?? [...(scene.regions ?? [])]).map(r => {
    const z = zoneOf(r);
    return { id: r.id, name: r.name || "Região", color: z?.color ?? "#666", note: !z ? "Sem tipo reconhecido: ignorada (ajuste em Editar › Zonas)" : z.guide ? "Faixa de estrada: fica como guia para desenhar as rotas" : `Zona: ${z.label} · velocidade ×${z.mult}` };
  });
  const gd = scene.flags?.["world-explorer"]?.gridData ?? {};
  const fogCells = Object.values(gd).filter(c => c?.reveal && c.offset).length;
  return { tokens: rows, regions, hideTokens: true, fog: fogCells > 0, fogCells };
}

export async function runImport(scene, R) {
  if (!R) return { pois: 0 };
  const gs = scene.grid?.size ?? 100; let pois = 0; let movers = 0;
  const take = R.tokens.filter(t => t.take);
  await mutateData(scene, (D) => {
    const newMovers = [];
    for (const t of take) {
      if (t.as === "party") { newMovers.push(normMover({ id: uid(), name: t.name, kind: t.mkind ?? "grupo", x: t.x, y: t.y, img: t.img, actor: t.actor ?? "", hidden: !!t.hidden, members: t.members ?? [] })); movers++; continue; }
      if (t.as === "skip") continue;
      D.pois.push(normPoi({ id: uid(), name: t.name, kind: t.kind, state: t.state, x: t.x, y: t.y, img: "", markerImg: t.useImg ? t.img : "", shape: t.useImg ? "livre" : "circulo", journal: t.journal ?? "", scene: t.scene ?? "", actor: t.actor ?? "" })); pois++;
    }
    for (const m of newMovers) { const near = D.pois.find(p => Math.hypot(p.x - m.x, p.y - m.y) < gs * 0.75); if (near) { m.at = near.id; m.x = near.x; m.y = near.y; } }
    if (newMovers.length && !D.movers.some(m => m.main)) (newMovers.find(m => !m.hidden) ?? newMovers[0]).main = true;
    D.movers.push(...newMovers);
    if (R.fog && R.fogCells) {
      const gd = scene.flags?.["world-explorer"]?.gridData ?? {};
      for (const c of Object.values(gd)) {
        if (!c?.reveal || !c.offset) continue;
        let pt = null; try { pt = canvas.grid.getCenterPoint?.(c.offset) ?? null; } catch (e) { /* */ }
        if (!pt) pt = { x: (c.offset.j + 0.5) * gs, y: (c.offset.i + 0.5) * gs };
        D.explored.push([Math.round(pt.x), Math.round(pt.y), Math.round(gs * 0.8)]);
      }
    }
    return ["pois", "movers", "explored", "weather"];
  });
  if (R.hideTokens) {
    const ids = take.map(t => t.tokenId).filter(Boolean);
    if (ids.length) await scene.updateEmbeddedDocuments("Token", ids.map(_id => ({ _id, hidden: true, [`flags.${MODULE_ID}.imported`]: true })));
  }
  return { pois, movers };
}
