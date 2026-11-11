// Painel do Atlas à esquerda da tela, ao lado dos controles e da lista de cenas (padrão).
// A barra lateral direita fica livre para Atores, Diário, Chat etc.
import { MODULE_ID } from "./config.js";
import { atlas } from "./ui.js";
import { renderChrome, chromeAct, chromeField, chromeDrop, tabOf } from "./panels.js";
import { renderGroupPanel } from "./groups.js";
import { uiPref, setUiPref } from "./data.js";
import { ic } from "./icons.js";
import { openMenu } from "./vector.js";
import { togglePop, isDetached } from "./popout.js";

/** Liga os eventos dos painéis (cliques, campos, arrastar fichas) a um elemento. */
/** Seções das abas podem ser recolhidas clicando no título (lembra por aba e título). */
const secKey = (h) => `${tabOf(atlas.panel)}|${h.textContent.split("·")[0].trim()}`;
export function applyCollapse(root) {
  const c = uiPref("collapsed", {});
  for (const h of root?.querySelectorAll?.("section > h3:first-child") ?? []) { h.classList.add("coll"); h.setAttribute("role", "button"); h.setAttribute("tabindex", "0"); if (c[secKey(h)]) h.parentElement.classList.add("collapsed"); }
}
async function toggleSection(h) {
  const sec = h.parentElement; const k = secKey(h); const on = !sec.classList.contains("collapsed"); sec.classList.toggle("collapsed", on);
  const c = { ...uiPref("collapsed", {}) }; if (on) c[k] = true; else delete c[k]; await setUiPref("collapsed", c);
}
export function bindChrome(el, onBlurIdle) {
  el.addEventListener("pointerover", (e) => { const r = e.target.closest?.("[data-hi]"); const id = r?.dataset.hi ?? null; if (id !== atlas.regHi && (id || atlas.regHiHover)) { atlas.regHi = id; atlas.regHiHover = !!id; atlas.refreshMap(); } });
  el.addEventListener("pointerleave", () => { if (atlas.regHiHover) { atlas.regHi = null; atlas.regHiHover = false; atlas.refreshMap(); } });
  el.addEventListener("click", (e) => { const h = e.target.closest("section > h3.coll"); if (h && !e.target.closest("[data-act],input,select,button")) { e.preventDefault(); toggleSection(h); } });
  el.addEventListener("keydown", (e) => { if (e.key !== "Enter" && e.key !== " ") return; const h = e.target.closest?.("section > h3.coll"); if (h) { e.preventDefault(); toggleSection(h); } });
  el.addEventListener("click", (e) => { const a = e.target.closest("[data-act]"); if (!a || a.disabled) return; e.preventDefault(); chromeAct(atlas, a.dataset.act, a.dataset, a, e); });
  el.addEventListener("change", (e) => { const f = e.target.closest("[data-field]"); if (f) chromeField(atlas, f, e); });
  // botão direito numa rota da lista: seleciona e abre o menu (Combinar, Agrupar, Copiar...)
  el.addEventListener("contextmenu", (e) => { const row = e.target.closest(".lrow[data-act=routeSel]"); if (!row || !game.user.isGM) return; e.preventDefault(); e.stopPropagation();
    const id = row.dataset.id; const cur = (atlas.multi ?? []).filter(x => x.kind === "routes");
    if (!cur.some(x => x.id === id)) atlas.multi = (e.ctrlKey || e.shiftKey) ? [...cur, { kind: "routes", id }] : [{ kind: "routes", id }];
    atlas.selRoute = null; atlas.refresh(); openMenu(atlas, e.clientX, e.clientY, "routes"); });
  el.addEventListener("input", (e) => { const f = e.target.closest("[data-live]") ?? (e.target.matches?.("input[type=range][data-field]") ? e.target : null); if (f) chromeField(atlas, f, e, true); });
  el.addEventListener("toggle", (e) => { if (e.target.matches?.("details[data-readd]")) atlas._readOpen = e.target.open; }, true);
  el.addEventListener("dragover", (e) => { const d = e.target.closest("[data-drop]"); if (d) { e.preventDefault(); d.classList.add("over"); } });
  el.addEventListener("dragleave", (e) => e.target.closest("[data-drop]")?.classList.remove("over"));
  el.addEventListener("drop", (e) => { const d = e.target.closest("[data-drop]"); if (d) { e.preventDefault(); e.stopPropagation(); chromeDrop(atlas, d, e); } });
  if (onBlurIdle) el.addEventListener("focusout", () => setTimeout(onBlurIdle, 50));
}
const typingIn = (el) => { const a = (el?.ownerDocument ?? document).activeElement; return !!(a && el?.contains(a) && a.matches("input[type=text],input[type=number],input:not([type]),textarea")); };

export const panelSide = () => { try { return game.settings.get(MODULE_ID, "panelSide") ?? "esquerda"; } catch (e) { return "esquerda"; } };

class AtlasDock {
  el = null; body = null; gbody = null; pending = false; rendered = false; #busy = false;
  #open = false; // a cada carregamento o painel começa fechado
  get collapsed() { return !this.#open; }

  mount() {
    if (this.el?.isConnected) return true;
    const left = document.getElementById("ui-left"); if (!left) return false;
    this.el = document.createElement("aside"); this.el.id = "atlas-dock"; this.el.className = "atlas-dock";
    this.el.innerHTML = `<div class="atlas-dock-col"><div class="atlas-sidebar atlas-dock-panel"></div><div class="atlas-sidebar atlas-group-panel"></div></div><div class="atlas-dock-grip" title="Arraste para mudar a largura"></div>`;
    left.prepend(this.el); // antes dos botões: encostada na borda esquerda
    this.body = this.el.querySelector(".atlas-dock-panel"); this.gbody = this.el.querySelector(".atlas-group-panel");
    for (const b of [this.body, this.gbody]) {
      bindChrome(b, () => { if (this.pending && !typingIn(b)) { this.pending = false; this.render(); } });
      for (const t of ["keydown", "keyup", "keypress"]) b.addEventListener(t, (e) => { if (typingIn(b)) e.stopPropagation(); });
    }
    this.#grip();
    this.#apply(); this.render();
    return true;
  }
  #apply() {
    this.el.classList.toggle("closed", this.collapsed);
    this.el.style.setProperty("--dock-w", `${Math.max(260, Math.min(560, uiPref("dockW", 330)))}px`);

  }
  #grip() {
    const g = this.el.querySelector(".atlas-dock-grip");
    g.addEventListener("pointerdown", (e) => {
      e.preventDefault(); const x0 = e.clientX; const w0 = this.body.getBoundingClientRect().width; let w = w0;
      const mv = (ev) => { w = Math.max(260, Math.min(560, w0 + ev.clientX - x0)); this.el.style.setProperty("--dock-w", `${w}px`); };
      const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); setUiPref("dockW", Math.round(w)); atlas.refreshMap(); };
      window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
    });
  }
  async setOpen(v) { this.#open = !!v; if (!v && isDetached(this.body)) togglePop(this.body); this.#apply(); this.render(); atlas.refreshMap(); }
  /** Painel do Atlas ("body") ou do grupo ("group") numa janela à parte (segundo monitor). */
  isPopped(which) { return isDetached(which === "group" ? this.gbody : this.body); }
  pop(which = "body") {
    const el = which === "group" ? this.gbody : this.body; if (!el) return;
    if (which !== "group" && this.collapsed) { this.#open = true; this.#apply(); }
    togglePop(el, { title: which === "group" ? "Atlas · Unidade" : "Atlas", width: Math.max(360, el.getBoundingClientRect().width), height: Math.max(560, el.getBoundingClientRect().height),
      onOpen: () => { this.el.classList.toggle("popped-body", isDetached(this.body)); this.el.classList.toggle("popped-group", isDetached(this.gbody)); this.render(); },
      onReturn: () => { this.el.classList.toggle("popped-body", isDetached(this.body)); this.el.classList.toggle("popped-group", isDetached(this.gbody)); this.render(); atlas.refreshMap(); } });
  }

  render() {
    if (!this.mount()) return;
    // painel do grupo: abaixo do Atlas, ou sozinho quando o Atlas está fechado
    let gh = ""; try { gh = renderGroupPanel(atlas); } catch (err) { console.error(`${MODULE_ID} | painel do grupo`, err); }
    this.el.classList.toggle("haspanel", !!gh);
    const gtop = this.gbody.querySelector(".pbody")?.scrollTop ?? 0;
    if (!typingIn(this.gbody)) { this.gbody.innerHTML = gh; applyCollapse(this.gbody); const gb = this.gbody.querySelector(".pbody"); if (gb && gtop) gb.scrollTop = gtop; }
    if (this.collapsed) { this.rendered = true; return; }
    const top = this.body.querySelector(".pbody")?.scrollTop ?? 0;
    if (!typingIn(this.body)) { try { this.body.innerHTML = renderChrome(atlas); applyCollapse(this.body); } catch (err) { console.error(`${MODULE_ID} | painel`, err); } }
    const b = this.body.querySelector(".pbody"); if (b && top) b.scrollTop = top;
    this.rendered = true;
  }
  /** Mostra o painel do grupo (não abre o Atlas se ele estiver fechado). */
  showGroup() { this.render(); }
  /** Re-renderiza, mas espera o usuário terminar de digitar. */
  requestRender() { if (!this.el) return; if (typingIn(this.body) || typingIn(this.gbody)) { this.pending = true; return; } this.render(); }
  /** Abre o painel (equivale a ativar a aba). */
  activate() { if (this.collapsed) this.setOpen(true); }
  get active() { return !this.collapsed; }
}
export const dock = new AtlasDock();

/** Botão "Atlas" nos controles de cena, logo abaixo de Journal Notes: abre e fecha a gaveta. */
export function syncControlButton(root = document) {
  const menu = root.querySelector?.("#scene-controls-layers menu") ?? document.querySelector("#scene-controls-layers menu"); if (!menu) return;
  let btn = menu.querySelector(".atlas-ctl");
  if (!btn) {
    const li = document.createElement("li"); li.className = "atlas-ctl-li";
    li.innerHTML = `<button type="button" class="control ui-control layer icon fa-solid fa-map-location-dot atlas-ctl" data-tooltip="Atlas" aria-label="Atlas"></button>`;
    // logo abaixo de Journal Notes (camada "notes"); se não achar, no fim
    const notes = menu.querySelector('[data-control="notes"]')?.closest("li");
    if (notes) notes.after(li); else menu.appendChild(li);
    btn = li.querySelector("button");
    btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); if (panelSide() === "barra") { atlas.showTab(); return; } dock.setOpen(dock.collapsed); });
  }
  btn.setAttribute("aria-pressed", String(panelSide() !== "barra" && !!dock.el && !dock.collapsed));
}
