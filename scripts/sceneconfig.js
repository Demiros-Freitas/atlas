// Seção "Atlas" na Configuração da Cena: marcar a cena como mapa, nível, mapa pai e névoa.
// Os campos usam nomes "flags.brumas-atlas.map.*", então são salvos junto com o botão Salvar do Foundry.
import { MODULE_ID, LEVELS } from "./config.js";
import { mapScenes, esc } from "./data.js";
import { atlas } from "./ui.js";

export function injectSceneConfig(app, html) {
  try {
    const scene = app.document ?? app.object; if (scene?.documentName !== "Scene") return;
    const root = html instanceof HTMLElement ? html : html?.[0]; if (!root || root.querySelector(".atlas-cfgbox")) return;
    const m = scene.flags?.[MODULE_ID]?.map ?? {}; const N = (k) => `flags.${MODULE_ID}.map.${k}`;
    const opt = (v, l, cur) => `<option value="${esc(v)}" ${String(v) === String(cur ?? "") ? "selected" : ""}>${esc(l)}</option>`;
    const box = document.createElement("fieldset"); box.className = "atlas-cfgbox";
    box.innerHTML = `<legend><i class="fa-solid fa-map-location-dot"></i> Atlas</legend>
      <div class="form-group"><label>É um mapa do Atlas</label><div class="form-fields"><input type="checkbox" name="${N("enabled")}" ${m.enabled ? "checked" : ""}></div>
        <p class="hint">Mostra locais, rotas, viagem, névoa e clima nesta cena, e a lista em Atlas na barra lateral.</p></div>
      <div class="atlas-cfg-more" ${m.enabled ? "" : "hidden"}>
        <div class="form-group"><label>Título no Atlas</label><div class="form-fields"><input type="text" name="${N("title")}" value="${esc(m.title ?? "")}" placeholder="${esc(scene.name)}"></div></div>
        <div class="form-group"><label>Nível</label><div class="form-fields"><select name="${N("level")}">${Object.entries(LEVELS).map(([k, v]) => opt(k, v.label, m.level ?? "regiao")).join("")}</select></div></div>
        <div class="form-group"><label>Mapa pai</label><div class="form-fields"><select name="${N("parent")}"><option value="">—</option>${mapScenes().filter(s => s.id !== scene.id).map(s => opt(s.id, s.name, m.parent)).join("")}</select></div></div>
        <div class="form-group"><label>Névoa de exploração</label><div class="form-fields"><input type="checkbox" name="${N("fog")}" ${m.fog ?? true ? "checked" : ""}></div></div>
        <div class="form-group"><label>Raio revelado na viagem</label><div class="form-fields"><input type="number" min="0.5" step="0.5" name="${N("reveal")}" value="${m.reveal ?? 2}"><span class="units">células</span></div></div>
        <button type="button" class="atlas-open"><i class="fa-solid fa-pen-ruler"></i> Abrir o editor do Atlas</button>
      </div>`;
    const cb = box.querySelector(`input[name="${N("enabled")}"]`);
    cb.addEventListener("change", () => { box.querySelector(".atlas-cfg-more").hidden = !cb.checked; app.setPosition?.({ height: "auto" }); });
    box.querySelector(".atlas-open").addEventListener("click", (e) => { e.preventDefault(); if (canvas.scene?.id !== scene.id) scene.view(); atlas.showTab("editor"); });
    const tab = root.querySelector('.tab[data-tab="basics"]') ?? root.querySelector(".tab.active") ?? root.querySelector("form");
    const before = tab?.querySelector(".pda-cfgbox"); if (before) before.before(box); else tab?.appendChild(box);
  } catch (err) { console.warn(`${MODULE_ID} | configuração da cena`, err); }
}
