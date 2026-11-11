// Aba "Atlas" na barra lateral do Foundry, logo abaixo de Cenas.
import { MODULE_ID } from "./config.js";
import { atlas } from "./ui.js";
import { renderChrome } from "./panels.js";
import { bindChrome, applyCollapse } from "./dock.js";

export function registerSidebarTab() {
  const S = foundry.applications?.sidebar?.Sidebar; const Base = foundry.applications?.sidebar?.AbstractSidebarTab;
  if (!S || !Base) { console.warn(`${MODULE_ID} | sem suporte a abas na barra lateral`); return false; }

  class AtlasSidebar extends Base {
    static DEFAULT_OPTIONS = { classes: ["atlas-tab"], window: { title: "Atlas" } };
    static tabName = "atlas";
    #pending = false;

    async _renderHTML() { return renderChrome(atlas); }
    _replaceHTML(result, content) {
      const old = content.querySelector(".pbody"); const top = old?.scrollTop ?? 0;
      content.innerHTML = result; applyCollapse(content);
      const body = content.querySelector(".pbody"); if (body && top) body.scrollTop = top;
    }
    async _onFirstRender(context, options) {
      await super._onFirstRender(context, options);
      const el = this.element;
      bindChrome(el);
      el.addEventListener("focusout", () => setTimeout(() => { if (this.#pending && !this.#typing()) { this.#pending = false; this.render(); } }, 50));
    }
    #typing() { const a = document.activeElement; return !!(a && this.element?.contains(a) && a.matches("input[type=text],input[type=number],textarea")); }
    /** Re-renderiza, mas espera o usuário terminar de digitar. */
    requestRender() {
      if (!this.rendered) return;
      if (this.#typing()) { this.#pending = true; return; }
      this.render();
    }
    _onActivate() { atlas.refreshMap(); }
  }

  const tabs = {};
  for (const [k, v] of Object.entries(S.TABS)) { tabs[k] = v; if (k === "scenes") tabs.atlas = { tooltip: "Atlas · mapas", icon: "fa-solid fa-map-location-dot" }; }
  if (!tabs.atlas) tabs.atlas = { tooltip: "Atlas · mapas", icon: "fa-solid fa-map-location-dot" };
  S.TABS = tabs;
  CONFIG.ui.atlas = AtlasSidebar;
  return true;
}
