// Janela do céu: carta estelar, céu de hoje ou sistema, numa janela do Foundry (move, redimensiona, pode ser destacada).
// Aberta com o botão direito no mostrador do Cronos (ou pela API: openSkyWindow(view)).
import { normSky, renderSky, SKY_VIEWS, viewsFor } from "./sky.js";
import { skyOf, VSKY, nowTime } from "./world.js";
import { mapOf, esc, uiPref, setUiPref } from "./data.js";
import { CSS_URL } from "./ui.js";

const AppV2 = foundry.applications.api.ApplicationV2;
let inst = null;

class SkyWindow extends AppV2 {
  static DEFAULT_OPTIONS = { id: "atlas-sky-window", classes: ["atlas-skywin"], tag: "div",
    window: { title: "Céu", icon: "fa-solid fa-star", resizable: true, minimizable: true }, position: { width: 760, height: 460 } };
  view = "carta"; #host = null; #ro = null; #tick = null; #last = "";
  get title() { const h = here(); return h?.world ? `Céu de ${mapOf(h.world)?.title || h.world.name}` : "Céu"; }
  async _renderHTML() { return null; }
  _replaceHTML(_r, content) {
    if (!this.#host || !content.contains(this.#host)) {
      content.innerHTML = ""; content.style.padding = "0"; content.style.overflow = "hidden"; content.style.position = "relative"; content.style.background = "#05070d";
      this.#host = document.createElement("div"); this.#host.style.cssText = "position:absolute;inset:0"; content.appendChild(this.#host);
      const sh = this.#host.attachShadow({ mode: "open" });
      sh.innerHTML = `<link rel="stylesheet" href="${CSS_URL}"><style>
        .sw{position:absolute;inset:0;overflow:hidden;background:radial-gradient(ellipse at center,#080c1a,#020308);font:13px "IBM Plex Sans",system-ui,sans-serif;color:#ece6d6}
        .sw .bd{position:absolute;inset:0}.sw .svg{position:absolute;left:0;top:0;overflow:visible}
        .sw .bar{position:absolute;left:8px;top:8px;right:8px;display:flex;align-items:center;gap:8px;pointer-events:none}
        .sw .tabs{display:flex;gap:2px;background:rgba(28,32,40,.92);border-radius:8px;padding:2px;pointer-events:auto;border:1px solid rgba(232,217,168,.2)}
        .sw .tabs button{border:0;background:transparent;color:#aaa395;font:600 12px "IBM Plex Sans",sans-serif;padding:4px 10px;border-radius:6px;cursor:pointer}
        .sw .tabs button.on{background:#e2b964;color:#1b1610}
        .sw .sksun.click{pointer-events:all;cursor:help}
        .sw .from{margin-left:auto;background:rgba(20,23,28,.85);padding:3px 8px;border-radius:6px;color:#aaa395;font-size:11.5px}</style>
        <div class="sw"><div class="bd"></div><div class="bar"><div class="tabs"></div><span class="from"></span></div></div>`;
      sh.querySelector(".bd").addEventListener("click", (e) => { if (e.target.closest("[data-skysun]") && this.view === "noite") { try { game.modules.get("brumas-cronos")?.api?.sunCheck?.(); } catch (err) { console.warn(err); } } });
      sh.querySelector(".tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-v]"); if (!b) return; this.view = b.dataset.v; setUiPref("skyLastView", this.view); this.#last = ""; this.draw(true); });
      this.#ro?.disconnect(); this.#ro = new ResizeObserver(() => this.draw(true)); this.#ro.observe(this.#host);
    }
    this.draw(true);
  }
  _onRender() { clearInterval(this.#tick); this.#tick = setInterval(() => this.draw(), 1000); }
  _onClose() { clearInterval(this.#tick); this.#ro?.disconnect(); this.#ro = null; this.#host = null; inst = null; }
  draw(force = false) {
    const sh = this.#host?.shadowRoot; if (!sh) return; const W = this.#host.clientWidth, H = this.#host.clientHeight; if (W < 20 || H < 20) return;
    const h = here(); const cfg = h?.world ? skyOf(h.world) : null; const bd = sh.querySelector(".bd");
    const views = cfg ? viewsFor(normSky(cfg)) : []; if (views.length && !views.includes(this.view)) this.view = views[0];
    sh.querySelector(".tabs").innerHTML = views.length > 1 ? views.map(k => `<button type="button" data-v="${k}" class="${this.view === k ? "on" : ""}">${esc(SKY_VIEWS[k])}</button>`).join("") : "";
    if (cfg && !views.length) { bd.innerHTML = `<p style="padding:60px 20px;text-align:center;color:#aaa395">O mestre ainda não liberou o céu.</p>`; return; }
    sh.querySelector(".from").textContent = this.view === "noite" && h?.obs ? `visto de ${h.obs.name ?? h.label}` : "";
    if (!cfg) { bd.innerHTML = `<p style="padding:60px 20px;text-align:center;color:#aaa395">Este mundo ainda não tem céu. No mapa-múndi: Mapa › Céu › Criar o céu deste mundo.</p>`; return; }
    const key = `${this.view}|${W}|${H}|${Math.floor(nowTime() / 60)}|${h?.obs?.lat ?? ""}`; if (!force && key === this.#last) return; this.#last = key;
    const sk = normSky(cfg); sk.view = this.view; const top = 40, pad = 12;
    const k = this.view === "noite" ? Math.min((W - pad * 2) / 1500, (H - top - pad) / 1500) * 1.06 : Math.min((W - pad * 2) / 3000, (H - top - pad) / 1500);
    const ox = (W - 3000 * k) / 2, oy = top + (H - top - 1500 * k) / 2; const P = (x, y) => ({ x: x * k + ox, y: y * k + oy });
    try { const r = renderSky(VSKY, sk, P, k, W, H, this.view === "noite" ? h.obs : null, { sunClick: true }); bd.innerHTML = `<svg class="svg" width="${W}" height="${H}"><defs>${r.defs}</defs>${r.svg}</svg>${r.html}`; }
    catch (e) { console.warn("brumas-atlas | janela do céu", e); }
  }
}
function here() { try { return game.modules.get("brumas-atlas")?.api?._here?.() ?? null; } catch (e) { return null; } }

/** Abre (ou traz para a frente) a janela do céu; view = "carta" | "noite" | "sistema". */
export function openSkyWindow(view = null) {
  const h = here(); const cfg = h?.world ? skyOf(h.world) : null;
  if (cfg && !viewsFor(normSky(cfg)).length) { globalThis.ui?.notifications?.info("Atlas · o mestre ainda não liberou o céu para os jogadores."); return null; }
  if (!inst) { inst = new SkyWindow(); inst.view = uiPref("skyLastView", null) || "carta"; } if (view) inst.view = view;
  inst.render({ force: true }); try { inst.bringToFront?.(); } catch (e) { /* */ } return inst;
}
