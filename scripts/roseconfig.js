// Configurações do módulo › "Rosa dos ventos e ponteiro": é parte da interface (HUD), vale para todos os mapas.
// Cada imagem é editada como um tile: imagem, tinta, opacidade, saturação, escala, rotação e espelhar.
import { MODULE_ID, ROSE_CARD } from "./config.js";
import { hudRose, setHud, setHudMap, roseOwn, saveData, esc } from "./data.js";
import { ic } from "./icons.js";

const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(v) === String(cur ?? "") ? "selected" : ""}>${esc(label)}</option>`;

function look(key, o, title, label) {
  const f = (k) => `data-h="${key}.${k}"`;
  const range = (k, min, max, step, val, fmt) => `<div class="row2"><input type="range" min="${min}" max="${max}" step="${step}" ${f(k)} value="${val}"><span class="rv">${fmt(val)}</span><button type="button" class="rreset" data-def="${{ rot: 0 }[k] ?? 1}" title="Voltar ao padrão" aria-label="Voltar ao padrão">↺</button></div>`;
  return `<section><h3>${esc(title)}</h3>
    <label>${esc(label)}<div class="row2"><input type="text" ${f("img")} value="${esc(o.img)}" placeholder="desenho padrão do Atlas"><button type="button" class="btn" data-pick="${key}.img" aria-label="Escolher">${ic("search", 13)}</button>${o.img ? `<button type="button" class="btn" data-clear="${key}.img" aria-label="Voltar ao padrão">${ic("close", 12)}</button>` : ""}</div></label>
    <label>Tinta<div class="row2"><input type="color" class="colorpick" ${f("tint")} value="${o.tint || "#ffffff"}"><button type="button" class="btn" data-clear="${key}.tint" ${o.tint ? "" : "disabled"}>Sem tinta</button></div></label>
    <label>Opacidade${range("alpha", 0, 1, 0.05, o.alpha, v => `${Math.round(v * 100)}%`)}</label>
    <label>Saturação (0 = preto e branco)${range("sat", 0, 2, 0.05, o.sat, v => `${Math.round(v * 100)}%`)}</label>
    <label>Escala${range("scale", 0.1, 3, 0.05, o.scale, v => `${v}×`)}</label>
    <label>Rotação (°)${range("rot", -180, 180, 1, o.rot, v => `${v}°`)}</label>
    <div class="grid2"><label class="check"><input type="checkbox" ${f("flipX")} ${o.flipX ? "checked" : ""}> Espelhar na horizontal</label><label class="check"><input type="checkbox" ${f("flipY")} ${o.flipY ? "checked" : ""}> Espelhar na vertical</label></div>
  </section>`;
}
function html(scope) {
  const sc = globalThis.canvas?.scene; const r = hudRose(sc, scope === "map" ? null : "all"); const own = !!roseOwn(sc);
  return `<div class="atl"><div class="pbody">
    <section><h3>Aplicar a</h3>
      <div class="seg"><button type="button" class="${scope === "all" ? "on" : ""}" data-scope="all">Todos os mapas</button><button type="button" class="${scope === "map" ? "on" : ""}" data-scope="map" ${sc ? "" : "disabled"}>Só este mapa${sc ? ` (${esc(sc.name)})` : ""}</button></div>
      <p class="muted">${scope === "map" ? (own ? "Este mapa tem a sua própria rosa: o que mudar aqui vale só para ele." : "Ao mudar algo aqui, este mapa passa a ter a sua própria rosa (o resto vem da configuração geral).") : own ? "Atenção: este mapa usa a sua própria rosa; a configuração geral vale para os outros mapas." : "Vale para todos os mapas que não têm a sua própria rosa."}</p>
      ${scope === "map" && own ? `<div class="actions row"><button type="button" class="btn" data-unown="1">Voltar a usar a configuração geral neste mapa</button></div>` : ""}</section>
    <section><h3>Posição e tamanho</h3>
      <label>Presa a<select data-h="anchor">${opt("tela", "Tela (fica parada como parte da interface)", r.anchor)}${opt("cena", "Canto da cena (acompanha o mapa e o zoom)", r.anchor)}</select></label>
      <div class="grid2"><label>Canto<select data-h="corner">${[["se", "Inferior direito"], ["so", "Inferior esquerdo"], ["ne", "Superior direito"], ["no", "Superior esquerdo"], ["nenhum", "Oculta"]].map(([k, l]) => opt(k, l, r.corner)).join("")}</select></label>
        <label>Tamanho da rosa (px)<input type="number" min="40" max="500" step="10" data-h="hud" value="${r.hud}"></label></div>
      <div class="grid2"><label>Margem da cena (px da cena)<input type="number" min="0" step="10" data-h="margin" value="${r.margin ?? ""}" placeholder="automática"></label>
        <label class="check"><input type="checkbox" data-h="locked" ${r.locked ? "checked" : ""}> Travar (não arrastar)</label></div>
      <label>Cartão de clima e vento<select data-h="card">${Object.entries(ROSE_CARD).map(([k, v]) => opt(k, v, r.card)).join("")}</select></label>
      <p class="muted">Presa à tela: arraste a rosa até outro canto. Presa à cena: a margem afasta a rosa da borda da cena, e você pode arrastá-la para qualquer lugar da cena; ela fica fixa ali naquela cena (para voltar ao canto, use Atlas › Mapa › “Rosa: voltar ao canto”). O norte de cada mapa fica em Atlas › Mapa.</p></section>
    ${look("face", r.face, "Rosa (fundo)", "Imagem da rosa")}
    ${look("hand", r.hand, "Ponteiro do vento", "Imagem do ponteiro (apontando para cima)")}
    <div class="actions row"><button type="button" class="btn danger" data-reset="1">Voltar tudo ao padrão</button></div>
  </div></div>`;
}

export function registerRoseMenu() {
  const AppV2 = foundry.applications?.api?.ApplicationV2; if (!AppV2) return;
  class RoseConfig extends AppV2 {
    static DEFAULT_OPTIONS = { id: "atlas-rose-config", classes: ["atlas-sidebar", "atlas-rose-config"], window: { title: "Atlas · Rosa dos ventos e ponteiro", icon: "fa-solid fa-compass", resizable: true }, position: { width: 430, height: 660 } };
    #t = null;
    scope = roseOwn() ? "map" : "all";
    async _renderHTML() { return html(this.scope); }
    _replaceHTML(result, content) { const top = content.querySelector(".pbody")?.scrollTop ?? 0; content.innerHTML = result; const b = content.querySelector(".pbody"); if (b) b.scrollTop = top; }
    async _onFirstRender(ctx, opts) {
      await super._onFirstRender?.(ctx, opts);
      const el = this.element; const app = this;
      const num = (i) => ["number", "range"].includes(i.type);
      const put = (patch) => app.scope === "map" ? setHudMap(patch) : setHud(patch);
      const save = async (i) => { const k = i.dataset.h; const v = i.type === "checkbox" ? i.checked : num(i) ? (i.value === "" ? "" : Number(i.value)) : i.value; await put({ [k]: v }); };
      el.addEventListener("change", async (e) => { const i = e.target.closest("[data-h]"); if (!i) return; await save(i); app.render(); });
      el.addEventListener("input", (e) => { const i = e.target.closest("input[type=range][data-h]"); if (!i) return; const rv = i.parentElement.querySelector(".rv"); const v = Number(i.value); const k = i.dataset.h;
        if (rv) rv.textContent = /alpha|sat/.test(k) ? `${Math.round(v * 100)}%` : /scale/.test(k) ? `${v}×` : `${v}°`;
        clearTimeout(this.#t); this.#t = setTimeout(() => save(i), 200); });
      el.addEventListener("click", async (e) => {
        const pick = e.target.closest("[data-pick]"), clear = e.target.closest("[data-clear]"), reset = e.target.closest("[data-reset]");
        if (pick) { const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker; new FP({ type: "image", callback: async (path) => { await put({ [pick.dataset.pick]: path }); app.render(); } }).render(true); }
        if (clear) { await put({ [clear.dataset.clear]: "" }); app.render(); }
        const scb = e.target.closest("[data-scope]"); if (scb) { app.scope = scb.dataset.scope; app.render(); return; }
        if (e.target.closest("[data-unown]")) { const sc = globalThis.canvas?.scene; if (sc) await saveData(sc, { "map.roseCfg": { own: false } }); app.render(); return; }
        if (reset && await foundry.applications.api.DialogV2.confirm({ window: { title: "Rosa dos ventos" }, content: "<p>Voltar a rosa e o ponteiro ao padrão do Atlas?</p>", rejectClose: false }).catch(() => false)) { await game.settings.set(MODULE_ID, "hud", {}); app.render(); }
      });
    }
  }
  globalThis.AtlasRoseConfig = RoseConfig;
  game.settings.registerMenu(MODULE_ID, "hudMenu", { name: "Rosa dos ventos e ponteiro", label: "Configurar a rosa", hint: "Imagem, tinta, opacidade, saturação, escala, rotação e espelhamento da rosa dos ventos e do ponteiro do vento; canto da tela, tamanho e o cartão de clima.", icon: "fa-solid fa-compass", type: RoseConfig, restricted: true });
}
export const openRoseConfig = (scope = null) => { const C = globalThis.AtlasRoseConfig; if (!C) return; const a = new C(); if (scope) a.scope = scope; a.render(true); };
