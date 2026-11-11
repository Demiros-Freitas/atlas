// Portais: cada portal é um local (tipo "Portal"); as ligações são linhas retas entre dois portais (ou ligações com portais de outros mapas).
// Aqui fica a conversão do formato antigo: rotas de portal com traçado livre e círculos ligados por nome de rede.
import { dataOf, mutateData, uid, mapOf } from "./data.js";

const COND = ["tpKey", "tpPw", "tpMoon", "tpTime"];
const isP = (D, id) => !!id && D.pois.some(p => p.id === id && p.kind === "circulo");

/** Converte os dados antigos de todos os mapas. Devolve quantas coisas mudaram. */
export async function migratePortals() {
  const scenes = game.scenes.filter(s => mapOf(s)); let n = 0;
  // 1. rotas de portal: viram uma linha reta entre dois portais (cria o portal na ponta que não tem)
  for (const sc of scenes) {
    const d = dataOf(sc);
    if (!d.routes.some(r => r.type === "portal" && r.points?.length >= 2 && (r.points.length !== 2 || r.handles?.length || !isP(d, r.a) || !isP(d, r.b)))) continue;
    await mutateData(sc, (D) => {
      for (const r of D.routes) { if (r.type !== "portal" || !(r.points?.length >= 2)) continue;
        const ends = [["a", r.points[0], r.oneway ? "entrada" : ""], ["b", r.points[r.points.length - 1], r.oneway ? "saída" : ""]];
        for (const [k, pt, tag] of ends) {
          const src = k === "a" || !r.oneway; // as condições e o ritual ficam em quem se parte
          if (isP(D, r[k])) { const P = D.pois.find(p => p.id === r[k]); if (src) { for (const c of COND) if (!P[c] && r[c]) P[c] = r[c]; if ((P.ritual == null || P.ritual === "") && r.ritual != null) P.ritual = r.ritual; } if (!P.tpColor && r.color) P.tpColor = r.color; continue; }
          const host = D.pois.find(p => p.id === r[k]); const id = uid();
          D.pois.push({ id, name: `${r.name || "Portal"}${host ? ` · ${host.name}` : tag ? ` (${tag})` : ""}`, kind: "circulo", state: r.tpShow && !r.hidden ? "visitado" : "oculto",
            x: Math.round(pt[0]), y: Math.round(pt[1]), tpColor: r.color || "", ...(src ? Object.fromEntries([...COND.map(c => [c, r[c] ?? ""]), ["ritual", r.ritual ?? 1]]) : { ritual: 0 }) });
          r[k] = id; n++;
        }
        const A = D.pois.find(p => p.id === r.a), B = D.pois.find(p => p.id === r.b);
        r.points = [[A.x, A.y], [B.x, B.y]]; r.handles = []; n++;
      }
      return ["pois", "routes"];
    });
  }
  // 2. círculos com o mesmo nome de rede: todos ligados entre si (linhas no mesmo mapa; ligações entre mapas nos outros)
  const all = []; for (const sc of scenes) for (const p of dataOf(sc).pois) if (p.kind === "circulo" && String(p.net ?? "").trim()) all.push({ sc, p, net: String(p.net).trim() });
  if (!all.length) return n;
  const add = new Map(); const job = (sc) => add.get(sc.id) ?? add.set(sc.id, { sc, routes: [], remote: [] }).get(sc.id);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) { const X = all[i], Y = all[j]; if (X.net !== Y.net) continue;
    const gx = !X.p.exitOnly, gy = !Y.p.exitOnly; if (!gx && !gy) continue; const dir = gx && gy ? "both" : gx ? "out" : "in"; // visto de X
    if (X.sc.id === Y.sc.id) { const [a, b] = dir === "in" ? [Y.p, X.p] : [X.p, Y.p];
      job(X.sc).routes.push({ id: uid(), name: "", type: "portal", cond: "aberta", points: [[a.x, a.y], [b.x, b.y]], handles: [], a: a.id, b: b.id, oneway: dir !== "both" }); }
    else { job(X.sc).remote.push([X.p.id, { scene: Y.sc.id, poi: Y.p.id, dir }]); job(Y.sc).remote.push([Y.p.id, { scene: X.sc.id, poi: X.p.id, dir: { both: "both", out: "in", in: "out" }[dir] }]); } }
  for (const sc of new Set(all.map(x => x.sc))) { const J = job(sc);
    await mutateData(sc, (D) => {
      for (const r of J.routes) if (!D.routes.some(q => q.type === "portal" && ((q.a === r.a && q.b === r.b) || (q.a === r.b && q.b === r.a)))) { D.routes.push(r); n++; }
      for (const [id, l] of J.remote) { const P = D.pois.find(p => p.id === id); if (!P) continue; P.remote = (P.remote ?? []).filter(x => !(x.scene === l.scene && x.poi === l.poi)); P.remote.push(l); n++; }
      for (const P of D.pois) if (P.kind === "circulo" && (P.net || P.exitOnly)) { P.net = ""; P.exitOnly = false; }
      return ["pois", "routes"];
    });
  }
  return n;
}
