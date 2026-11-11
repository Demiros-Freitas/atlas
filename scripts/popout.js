// Janelas destacadas: leva um painel (ou uma janela do Foundry) para outra janela do sistema operacional,
// como se fosse um segundo monitor. O elemento é o mesmo (não é uma cópia): continua vivo, com os mesmos eventos,
// e volta para o lugar quando a janela de fora é fechada.
const wins = new Map(); // elemento -> { win, ph, back }
const escT = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export const isDetached = (el) => !!wins.get(el)?.win;
export const detachedWindow = (el) => wins.get(el)?.win ?? null;

/**
 * Destaca `el` numa janela própria. opts: { title, width, height, onOpen(win), onReturn(el, placed) } (placed = voltou para a tela principal).
 * Devolve a janela (ou null se o navegador bloquear).
 */
export function popout(el, opts = {}) {
  if (!el) return null;
  const cur = wins.get(el); if (cur) { try { cur.win?.focus(); } catch (e) { /* */ } return cur.win; }
  if (!el.isConnected) return null;
  const r = el.getBoundingClientRect();
  const W = Math.round(opts.width ?? Math.max(340, r.width)), H = Math.round(opts.height ?? Math.max(260, r.height));
  const sx = Math.round((window.screenX ?? 0) + Math.max(0, r.left) + 30), sy = Math.round((window.screenY ?? 0) + Math.max(0, r.top) + 60);
  // Foundry 14: janelas destacadas oficiais (o app do Foundry só deixa abrir "detached/index.html"); já trazem estilos, dicas e atalhos
  const mgr = globalThis.foundry?.applications?.detached;
  if (mgr?.openWindow) {
    const id = `brumas-${Math.random().toString(36).slice(2, 10)}`; wins.set(el, { win: null, pending: true });
    mgr.openWindow({ id, position: { left: sx, top: sy, width: W, height: H } })
      .then((win) => { wins.delete(el); adopt(el, win, opts, false); })
      .catch(() => { wins.delete(el); }); // o próprio Foundry avisa se a janela foi bloqueada
    return null;
  }
  // navegador sem a API do Foundry: uma janela em branco montada aqui
  let win = null;
  try { win = window.open("", `brumas-pop-${Math.random().toString(36).slice(2)}`, `popup=yes,width=${W},height=${H},left=${sx},top=${sy}`); } catch (e) { win = null; }
  if (!win) { globalThis.ui?.notifications?.warn("Não foi possível abrir a janela destacada: o navegador (ou o app) bloqueou pop-ups para o Foundry."); return null; }
  const d = win.document;
  d.open(); d.write(`<!doctype html><html><head><meta charset="utf-8"><title></title><base href="${escT(document.baseURI)}"></head><body></body></html>`); d.close();
  for (const n of document.head.querySelectorAll('link[rel="stylesheet"], style')) { const c = d.importNode(n, true); if (n.href) c.href = n.href; d.head.appendChild(c); }
  d.documentElement.className = document.documentElement.className; const rs = document.documentElement.getAttribute("style"); if (rs) d.documentElement.setAttribute("style", rs);
  d.body.className = document.body.className;
  return adopt(el, win, opts, true);
}
function adopt(el, win, opts, own) {
  const d = win.document; d.title = opts.title ?? "Foundry"; d.body.classList.add("brumas-popout");
  const st = d.createElement("style");
  st.textContent = `html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#14171c}
    body.brumas-popout{display:flex}
    body.brumas-popout>.brumas-pop-el{position:relative!important;inset:auto!important;left:auto!important;top:auto!important;right:auto!important;bottom:auto!important;transform:none!important;
      flex:1 1 auto!important;width:auto!important;height:auto!important;min-width:0!important;max-width:none!important;max-height:none!important;margin:0!important;box-sizing:border-box;border-radius:0!important;z-index:auto!important}`;
  d.head.appendChild(st);
  if (!el.isConnected) { try { win.close(); } catch (e) { /* */ } return null; }
  const ph = document.createComment("janela destacada"); const prevStyle = el.getAttribute("style");
  el.before(ph); el.classList.add("brumas-pop-el"); d.body.appendChild(d.adoptNode(el));
  let done = false;
  const back = () => {
    if (done) return; done = true; wins.delete(el); try { mo.disconnect(); } catch (e) { /* */ }
    const home = ph.isConnected; el.classList.remove("brumas-pop-el");
    if (el.ownerDocument === d && el.isConnected) { try { document.adoptNode(el); } catch (e) { /* */ } if (home) ph.replaceWith(el); }
    else if (home) ph.remove();
    if (prevStyle == null) el.removeAttribute("style"); else el.setAttribute("style", prevStyle);
    try { opts.onReturn?.(el, el.isConnected && el.ownerDocument === document); } catch (e) { console.warn("brumas | janela destacada", e); }
  };
  // a janela de fora fechou: o painel volta; o painel sumiu de lá (fechado pelo próprio módulo): a janela fecha
  win.addEventListener("pagehide", back); win.addEventListener("beforeunload", back);
  const mo = new win.MutationObserver(() => { if (el.ownerDocument !== d || !d.body.contains(el)) { back(); try { win.close(); } catch (e) { /* */ } } });
  mo.observe(d.body, { childList: true });
  if (own) window.addEventListener("beforeunload", () => { try { win.close(); } catch (e) { /* */ } }, { once: true });
  wins.set(el, { win, ph, back });
  try { opts.onOpen?.(win); } catch (e) { /* */ }
  return win;
}
/** Traz de volta um painel destacado. */
export function popin(el) { const w = wins.get(el); if (!w || w.pending) return; w.back(); try { w.win.close(); } catch (e) { /* */ } }
export function togglePop(el, opts) { const w = wins.get(el); if (w?.pending) return null; if (w) { popin(el); return null; } return popout(el, opts); }

/* ---------- botão "destacar" nas janelas do Foundry ---------- */
let hooked = false;
export function hookAppPopout(enabled = () => true) {
  if (hooked) return; hooked = true;
  const add = (app, el) => {
    if (!enabled()) return; el = el instanceof HTMLElement ? el : el?.[0]; const root = app?.element instanceof HTMLElement ? app.element : app?.element?.[0] ?? el; if (!root) return;
    const head = root.querySelector?.(":scope > .window-header, :scope > header.window-header"); if (!head || head.querySelector(".brumas-popbtn")) return;
    const b = document.createElement("button"); b.type = "button"; b.className = "header-control icon fa-solid fa-arrow-up-right-from-square brumas-popbtn"; b.dataset.tooltip = "Destacar em outra janela"; b.setAttribute("aria-label", "Destacar em outra janela");
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); const r = root.getBoundingClientRect();
      togglePop(root, { title: app.title ?? "Foundry", width: r.width, height: r.height, onReturn: (n, placed) => { if (placed) { try { app.setPosition?.(); } catch (er) { /* */ } } } }); });
    const close = head.querySelector('[data-action="close"], .close, .header-control[data-action="close"]'); if (close) close.before(b); else head.appendChild(b);
  };
  // Foundry 14 já tem "Destacar" no menu (⋮) das janelas novas (ApplicationV2); o botão fica só onde não existe
  Hooks.on("renderApplicationV2", (app, el) => { if (app.hasFrame === false || typeof app.detachWindow === "function") return; add(app, el); });
  Hooks.on("renderApplication", (app, html) => add(app, html)); // janelas antigas (Application v1)
}
