// Balcão: lojas e serviços dos edifícios do Atlas.
// - O personagem precisa estar no edifício: num grupo que está naquele local.
// - Equipe (servidores): cada servidor pode vender (do armazém ou do próprio inventário) e/ou prestar serviços.
// - Armazém com itens e um cofre em moedas do D&D (pl, po, pe, pp, pc).
// - Serviços em categorias, cada um com o seu diário; hospedagem com quartos, ocupantes e chaves que abrem a porta.
// - Compras, vendas e serviços são feitos pelo Mestre (socket): dinheiro, inventário, armazém e quartos mudam juntos.
import { MODULE_ID, SOCKET } from "./config.js";
import { dataOf, mutateData, uid, normMover, request, onAction, addLog, esc } from "./data.js";
import { ic } from "./icons.js";

/* ---------- dados ---------- */
const STAFF = () => ({ id: uid(), uuid: "", hidden: false, hours: null, sells: false, serves: false, source: "storage", items: [], buys: true, buyRate: 0.5, services: [] });
const HERO_H = 170;
const LOOK = () => ({ y: 50, ax: 92, ay: 100, size: 150 });
const ZERO = () => ({ pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 });
/** Lê (e migra) os dados do balcão de um local. */
export function bizOf(poi) {
  const raw = poi?.biz ?? {}; const b = { storage: [], storageVisible: false, services: [], shopCats: [], svcCats: [], hours: null, ...raw };
  b.staff = (raw.staff ?? []).map(s => ({ ...STAFF(), ...s, id: s.id ?? uid() }));
  for (const s of raw.sellers ?? []) { // versão anterior: vendedores separados
    let t = b.staff.find(x => x.uuid && x.uuid === s.uuid); if (!t) { t = { ...STAFF(), id: s.id, uuid: s.uuid ?? "" }; b.staff.push(t); }
    Object.assign(t, { sells: true, hidden: !!(s.hidden ?? t.hidden), hours: s.hours ?? t.hours, source: s.source ?? "storage", items: s.items ?? [], buys: s.buys !== false, buyRate: s.buyRate ?? 0.5 }); }
  for (const sv of b.services) if (sv.uuid) { let t = b.staff.find(x => x.uuid === sv.uuid); if (!t) { t = { ...STAFF(), id: `sv-${sv.id}`, uuid: sv.uuid }; b.staff.push(t); } t.serves = true; if (!t.services.includes(sv.id)) t.services = [...t.services, sv.id]; }
  b.services = b.services.map(sv => { const o = { ...sv }; delete o.uuid; return o; });
  b.cash = { ...ZERO(), ...(raw.cash ?? addMoney(ZERO(), Number(raw.money) || 0)) };
  b.look = { ...LOOK(), ...(raw.look ?? {}) };
  delete b.sellers; delete b.money; return b;
}
const sellersOf = (b) => b.staff.filter(s => s.sells);
const provOf = (b, sv) => b.staff.filter(s => s.serves && (s.services ?? []).includes(sv.id));
const poiOf = (sc, id) => dataOf(sc).pois.find(p => p.id === id);
const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(v) === String(cur ?? "") ? "selected" : ""}>${esc(label)}</option>`;
const docSync = (uuid) => { try { return uuid ? fromUuidSync(uuid) : null; } catch (e) { return null; } };
const nameOf = (uuid) => docSync(uuid)?.name ?? "—";
const artImg = (uuid) => { const a = docSync(uuid); return a?.img && !/mystery-man/.test(a.img) ? a.img : (a?.prototypeToken?.texture?.src || a?.img || ""); };
const BAG = "icons/svg/item-bag.svg", MAN = "icons/svg/mystery-man.svg";
const img = (src, fb = BAG, cls = "") => `<img class="${cls}" src="${esc(src || fb)}" alt="" onerror="this.onerror=null;this.src='${fb}'">`;
const PHYS = ["weapon", "equipment", "consumable", "tool", "loot", "container", "backpack"];
const stripHTML = (h) => String(h ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/* ---------- dinheiro (como no D&D: pl, po, pe, pp, pc) ---------- */
const RATE = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 };
const DEN = ["pp", "gp", "ep", "sp", "cp"];
const DLABEL = { pp: "pl", gp: "po", ep: "pe", sp: "pp", cp: "pc" };
const DNAME = { pp: "platina", gp: "ouro", ep: "electro", sp: "prata", cp: "cobre" };
const DFILE = { pp: "platinum", gp: "gold", ep: "electrum", sp: "silver", cp: "copper" };
const coinSrc = (k) => globalThis.CONFIG?.DND5E?.currencies?.[k]?.icon || `systems/dnd5e/icons/currency/${DFILE[k]}.webp`;
const coinImg = (k) => `<img class="cimg c-${k}" src="${coinSrc(k)}" alt="${DLABEL[k]}" title="${DNAME[k]}" onerror="this.replaceWith(Object.assign(document.createElement('i'),{className:'cimg c-${k}'}))">`;
export const cpOf = (cur = {}) => Object.entries(RATE).reduce((s, [k, r]) => s + (Number(cur[k]) || 0) * r, 0);
export function gpPrice(itemData) { const p = itemData?.system?.price; if (p == null) return 0; if (typeof p === "number") return p; const v = Number(p.value) || 0; return v * (RATE[p.denomination ?? "gp"] ?? 100) / 100; }
export function fmtGp(gp) { let c = Math.round((Number(gp) || 0) * 100); const g = Math.floor(c / 100); c -= g * 100; const s = Math.floor(c / 10); const cp = c - s * 10; const out = []; if (g) out.push(`${g} po`); if (s) out.push(`${s} pp`); if (cp) out.push(`${cp} pc`); return out.join(" ") || "grátis"; }
/** Preço em moedas (po, pp, pc), com as imagens das moedas do D&D. */
function coins(cp, zero = "grátis") { let c = Math.round(Number(cp) || 0); if (c <= 0) return `<span class="coins zero">${zero}</span>`; const out = [];
  for (const k of ["gp", "sp", "cp"]) { const n = Math.floor(c / RATE[k]); c -= n * RATE[k]; if (n) out.push(`<span class="cn">${n}${coinImg(k)}</span>`); } return `<span class="coins">${out.join("")}</span>`; }
const purse = (cur) => `<span class="purse">${DEN.map(k => `<span class="cn ${(Number(cur?.[k]) || 0) ? "" : "nil"}">${coinImg(k)}${Number(cur?.[k]) || 0}</span>`).join("")}</span>`;
function payPlan(cur, costCp) {
  let rem = cpOf(cur) - costCp; if (rem < 0) return null; const out = { ...cur };
  out.pp = Math.min(Number(cur.pp) || 0, Math.floor(rem / 1000)); rem -= out.pp * 1000; out.gp = Math.floor(rem / 100); rem -= out.gp * 100; out.ep = Math.min(Number(cur.ep) || 0, Math.floor(rem / 50)); rem -= out.ep * 50; out.sp = Math.floor(rem / 10); rem -= out.sp * 10; out.cp = rem; return out;
}
function addMoney(cur, cp) { const out = { ...cur }; out.gp = (Number(cur.gp) || 0) + Math.floor(cp / 100); out.sp = (Number(cur.sp) || 0) + Math.floor((cp % 100) / 10); out.cp = (Number(cur.cp) || 0) + (cp % 10); return out; }
const denFor = (gp) => { const c = Math.round(gp * 100); return c % 100 === 0 ? "gp" : c % 10 === 0 ? "sp" : "cp"; };
/** Campo de preço do jeito do D&D: valor + moeda. */
function priceIn(gp, den, attrs) { den ??= denFor(gp ?? 0); const v = Math.round((Number(gp) || 0) * 100) / RATE[den];
  return `<span class="pricein"><input type="number" class="num" min="0" step="any" value="${+v.toFixed(4)}" data-part="v" ${attrs}><select data-part="d" ${attrs}>${DEN.map(k => opt(k, DLABEL[k], den)).join("")}</select></span>`; }

/* ---------- horário ---------- */
function hourNow() { const t = game.time.worldTime ?? 0; try { const c = game.time.components ?? game.time.calendar?.timeToComponents?.(t); if (c?.hour != null) return c.hour + (c.minute ?? 0) / 60; } catch (e) { /* */ } return ((t % 86400) / 3600); }
const hm = (s) => { const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(String(s ?? "").trim()); return m ? Number(m[1]) + (Number(m[2]) || 0) / 60 : null; };
export function isOpen(hours) { if (!hours?.open || !hours?.close) return true; const o = hm(hours.open), c = hm(hours.close); if (o == null || c == null) return true; const h = hourNow(); return o <= c ? (h >= o && h < c) : (h >= o || h < c); }
const hoursText = (h) => h?.open && h?.close ? `${h.open}–${h.close}` : "sempre aberto";
function when(t) { try { const c = game.time.calendar?.timeToComponents?.(t); if (c?.hour != null) { const md = game.time.calendar?.months?.values?.[c.month]?.name; return `${(c.dayOfMonth ?? c.day) + 1}${md ? ` de ${game.i18n?.localize?.(md) ?? md}` : ""} ${String(c.hour).padStart(2, "0")}:${String(c.minute ?? 0).padStart(2, "0")}`; } } catch (e) { /* */ }
  const d = Math.floor(t / 86400) + 1, h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60); return `dia ${d} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`; }
const now = () => game.time.worldTime ?? 0;
const liveOcc = (room) => (room.occupants ?? []).filter(o => !o.until || o.until > now());
const svcOpen = (b, sv) => { const pv = provOf(b, sv); return isOpen(b.hours) && isOpen(sv.hours) && (!pv.length || pv.some(s => isOpen(s.hours))); };

/* ---------- chaves dos quartos ---------- */
const KEY_IMG = "icons/sundries/misc/key-steel.webp";
const keyOf = (it) => it?.flags?.[MODULE_ID]?.key ?? null;
const keyValid = (k) => !!k && (!k.until || k.until > now());
function keyData(sceneId, poi, sv, room, until, qty = 1) {
  return { name: `Chave · ${room.name} (${poi.name})`, type: "loot", img: KEY_IMG,
    system: { quantity: qty, price: { value: 0, denomination: "gp" }, description: { value: `<p>Chave de <b>${esc(room.name)}</b> · ${esc(sv.name)} · ${esc(poi.name)}.</p><p>${until ? `Válida até ${esc(when(until))}.` : "Sem prazo."}</p><p>Abre a porta do quarto para quem a carrega.</p>` } },
    flags: { [MODULE_ID]: { key: { sceneId, poiId: poi.id, svcId: sv.id, roomId: room.id, until: until ?? null } } } };
}
function keyHolders(roomId) { const out = []; for (const a of game.actors ?? []) for (const it of a.items ?? []) { const k = keyOf(it); if (k?.roomId === roomId) out.push({ actor: a, item: it, k }); } return out; }
const hasKey = (actor, roomId) => (actor?.items ?? []).some(it => { const k = keyOf(it); return k?.roomId === roomId && keyValid(k); });
const keyQty = (it) => Number(it?.system?.quantity ?? 1) || 1;
const keysTotal = (r) => Math.max(1, Number(r.keys ?? r.beds) || 1);
const keysOut = (roomId) => keyHolders(roomId).filter(h => keyValid(h.k)).reduce((n, h) => n + keyQty(h.item), 0);
const keysFree = (r) => Math.max(0, keysTotal(r) - keysOut(r.id));
const freeBeds = (r) => Math.max(0, (Number(r.beds) || 1) - liveOcc(r).length);
const doorLink = (wd) => wd?.flags?.[MODULE_ID]?.room ?? null;
const isActiveGM = () => { const g = game.users?.activeGM; return g ? (g.isSelf ?? g.id === game.user.id) : game.user.isGM; };

/* ---------- quem pode negociar ---------- */
/** Personagens nos grupos que estão neste local (para jogadores: só os seus). */
export function presentActors(sc, poiId, user = game.user) {
  const out = [];
  for (const m0 of dataOf(sc).movers) { const m = normMover(m0); if (m.parked || m.at !== poiId) continue;
    for (const ref of m.members ?? []) { const a = ref.includes(".") ? docSync(ref) : game.actors.get(ref); if (!a) continue; if (user.isGM || a.testUserPermission?.(user, "OWNER") || a.isOwner) out.push({ actor: a, group: m }); } }
  return out;
}
const allPresent = (sc, poiId) => presentActors(sc, poiId, { isGM: true });

/* ---------- ofertas de um vendedor ---------- */
function offersOf(biz, s) {
  if (s.source === "own") { const a = docSync(s.uuid); if (!a?.items) return [];
    return (s.items ?? []).map(o => { const it = a.items.get(o.iid); if (!it) return null; return { key: o.iid, data: it.toObject(), qty: Number(it.system?.quantity ?? 1) || 1, price: o.price ?? gpPrice(it.toObject()), cat: o.cat ?? "" }; }).filter(Boolean); }
  return (s.items ?? []).map(o => { const st = biz.storage.find(x => x.id === o.sid); if (!st || !(st.qty > 0)) return null; return { key: o.sid, data: st.data, qty: st.qty, price: o.price ?? gpPrice(st.data), cat: o.cat ?? "" }; }).filter(Boolean);
}

/* ---------- ações do Mestre (pedidos dos jogadores) ---------- */
async function check(p, userId) {
  const sc = game.scenes.get(p.sceneId); const u = game.users.get(userId); const poi = sc && poiOf(sc, p.poiId); if (!sc || !u || !poi) return null;
  const actor = await fromUuid(p.actorUuid); if (!actor) return null;
  const here = presentActors(sc, poi.id, u).some(x => x.actor.uuid === actor.uuid || x.actor.id === actor.id);
  if (!here && !u.isGM) { notify(userId, `${actor.name} precisa estar em ${poi.name} para isso.`); return null; }
  return { sc, u, poi, actor, biz: bizOf(poi) };
}
function notify(userId, text, kind = "warn") { if (userId === game.user.id) globalThis.ui?.notifications?.[kind]?.(`Atlas · ${text}`); else game.socket.emit(SOCKET, { type: "notify", userId, text, kind }); }
async function pay(actor, costCp) { const plan = payPlan(actor.system?.currency ?? {}, costCp); if (!plan) return false; await actor.update({ "system.currency": plan }); return true; }
async function giveItem(actor, data, qty) {
  const same = actor.items.find(i => i.name === data.name && i.type === data.type);
  if (same && same.system?.quantity != null) await same.update({ "system.quantity": (Number(same.system.quantity) || 0) + qty });
  else { const d = foundry.utils.deepClone(data); delete d._id; foundry.utils.setProperty(d, "system.quantity", qty); await actor.createEmbeddedDocuments("Item", [d]); }
}
async function takeItem(actor, itemId, qty) { const it = actor.items.get(itemId); if (!it) return false; const have = Number(it.system?.quantity ?? 1) || 1; if (qty >= have) await it.delete(); else await it.update({ "system.quantity": have - qty }); return true; }
const editPoi = (sc, poiId, fn) => mutateData(sc, (D) => { const P = D.pois.find(x => x.id === poiId); if (!P) return []; P.biz = bizOf(P); fn(P.biz, P); return ["pois"]; });
const svcLog = (B, svId, entry) => { const sv = B.services.find(x => x.id === svId); if (!sv) return; sv.log = [{ t: now(), ...entry }, ...(sv.log ?? [])].slice(0, 200); };
let lastDoor = 0;

export function registerBizActions() {
  onAction("bizBuy", async (p, userId) => {
    const c = await check(p, userId); if (!c) return; const { sc, poi, actor, biz } = c; const s = sellersOf(biz).find(x => x.id === p.sellerId); if (!s) return;
    if ((!isOpen(biz.hours) || !isOpen(s.hours)) && !c.u.isGM) return notify(userId, "Não estão atendendo agora.");
    const off = offersOf(biz, s).find(o => o.key === p.key); if (!off) return notify(userId, "Este item não está mais à venda.");
    const qty = Math.max(1, Math.min(Number(p.qty) || 1, off.qty)); const cost = Math.round(off.price * 100) * qty;
    if (!(await pay(actor, cost))) return notify(userId, `${actor.name} não tem dinheiro suficiente (${fmtGp(cost / 100)}).`);
    await giveItem(actor, off.data, qty);
    if (s.source === "own") { const sa = docSync(s.uuid); if (sa) { await takeItem(sa, p.key, qty); await sa.update({ "system.currency": addMoney(sa.system?.currency ?? {}, cost) }); } }
    else await editPoi(sc, poi.id, (B) => { const S = B.storage.find(x => x.id === p.key); if (S) { S.qty -= qty; if (S.qty <= 0) { B.storage = B.storage.filter(x => x.id !== p.key); for (const sl of B.staff) sl.items = (sl.items ?? []).filter(x => x.sid !== p.key); } } B.cash = addMoney(B.cash, cost); });
    await addLog({ kind: "comercio", sceneId: sc.id, text: `${actor.name} comprou ${qty}× ${off.data.name} em ${poi.name} por ${fmtGp(cost / 100)}.` });
    notify(userId, `${actor.name} comprou ${qty}× ${off.data.name} (${fmtGp(cost / 100)}).`, "info");
  });
  onAction("bizSell", async (p, userId) => {
    const c = await check(p, userId); if (!c) return; const { sc, poi, actor, biz } = c; const s = sellersOf(biz).find(x => x.id === p.sellerId); const it = actor.items.get(p.itemId);
    if (!s || s.buys === false) return notify(userId, "Aqui não compram itens."); if (!it) return;
    if ((!isOpen(biz.hours) || !isOpen(s.hours)) && !c.u.isGM) return notify(userId, "Não estão atendendo agora.");
    if (keyOf(it)) return notify(userId, "Chaves não podem ser vendidas.");
    const have = Number(it.system?.quantity ?? 1) || 1; const qty = Math.max(1, Math.min(Number(p.qty) || 1, have)); const data = it.toObject();
    const gain = Math.round(gpPrice(data) * (s.buyRate ?? 0.5) * 100) * qty; if (gain <= 0) return notify(userId, "Isto não tem valor aqui.");
    const sa = s.source === "own" ? docSync(s.uuid) : null;
    if (sa) { if (!(await pay(sa, gain))) return notify(userId, "Não há dinheiro para comprar isso agora."); }
    else if (cpOf(biz.cash) < gain) return notify(userId, "O cofre não tem dinheiro para comprar isso agora.");
    await actor.update({ "system.currency": addMoney(actor.system?.currency ?? {}, gain) }); await takeItem(actor, it.id, qty);
    if (sa) await giveItem(sa, data, qty);
    else await editPoi(sc, poi.id, (B) => { B.cash = payPlan(B.cash, gain) ?? ZERO(); const S = B.storage.find(x => x.data?.name === data.name && x.data?.type === data.type); if (S) S.qty += qty; else { delete data._id; B.storage.push({ id: uid(), data, qty }); } });
    await addLog({ kind: "comercio", sceneId: sc.id, text: `${actor.name} vendeu ${qty}× ${data.name} em ${poi.name} por ${fmtGp(gain / 100)}.` });
    notify(userId, `${actor.name} vendeu ${qty}× ${data.name} (${fmtGp(gain / 100)}).`, "info");
  });
  onAction("bizService", async (p, userId) => {
    const c = await check(p, userId); if (!c) return; const { sc, poi, actor, biz } = c; const sv = biz.services.find(x => x.id === p.serviceId); if (!sv) return;
    if (!svcOpen(biz, sv) && !c.u.isGM) return notify(userId, `${sv.name}: fora do horário.`);
    const nights = Math.max(1, Math.floor(Number(p.nights) || 1)); const qty = Math.max(1, Math.floor(Number(p.qty) || 1));
    let cost = Math.round((Number(sv.price) || 0) * 100); let room = null; let nKeys = 0;
    if (sv.lodging) {
      const rooms = sv.rooms ?? []; room = rooms.find(r => r.id === p.roomId) ?? rooms.find(r => sv.communal ? freeBeds(r) > 0 : !liveOcc(r).length);
      if (!room) return notify(userId, `Não há quarto livre em ${sv.name}.`);
      if (sv.communal) { if (freeBeds(room) < qty) return notify(userId, `${room.name}: só há ${freeBeds(room)} cama(s) livre(s).`); nKeys = qty; cost *= qty * nights; }
      else { if (liveOcc(room).length) return notify(userId, `${room.name} está ocupado.`); nKeys = qty; cost *= nights; }
      if (keysFree(room) < nKeys) return notify(userId, `${room.name}: só há ${keysFree(room)} chave(s) disponível(is).`);
    } else if ((sv.unit ?? "pessoa") === "pessoa") cost *= qty;
    if (!(await pay(actor, cost))) return notify(userId, `${actor.name} não tem dinheiro suficiente (${fmtGp(cost / 100)}).`);
    const until = sv.lodging ? now() + nights * 86400 : null;
    await editPoi(sc, poi.id, (B) => { B.cash = addMoney(B.cash, cost); const S = B.services.find(x => x.id === sv.id);
      if (S && room) { const R = (S.rooms ?? []).find(x => x.id === room.id); if (R) { R.occupants = liveOcc(R); for (let i = 0; i < (sv.communal ? qty : 1); i++) R.occupants.push({ uuid: actor.uuid, payer: actor.uuid, since: now(), until }); } }
      svcLog(B, sv.id, { payer: actor.uuid, guests: [actor.uuid], cost, room: room?.name ?? "", nights: sv.lodging ? nights : null, qty }); });
    if (room) { try { await actor.createEmbeddedDocuments("Item", [keyData(sc.id, poi, sv, room, until, nKeys)]); } catch (e) { console.warn(`${MODULE_ID} | chave`, e); } }
    if (sv.rest) { try { await actor.longRest?.({ dialog: false, chat: false, advanceTime: false }); } catch (e) { console.warn(`${MODULE_ID} | descanso`, e); } }
    await addLog({ kind: "comercio", sceneId: sc.id, text: `${actor.name} pagou ${fmtGp(cost / 100)} por ${sv.name}${room ? ` (${room.name}, ${nights} diária(s), ${nKeys} chave(s))` : qty > 1 ? ` (×${qty})` : ""} em ${poi.name}.` });
    notify(userId, `${sv.name}: pago ${fmtGp(cost / 100)}${room ? ` · ${room.name} · ${actor.name} recebeu ${nKeys > 1 ? `${nKeys} chaves` : "a chave"}` : ""}${sv.rest ? " · descanso longo feito" : ""}.`, "info");
  });
  // porta de quarto trancada: abre para quem tem a chave
  onAction("bizDoor", async (p, userId) => {
    const sc = game.scenes.get(p.sceneId); const w = sc?.walls?.get(p.wallId); const u = game.users.get(userId); const link = doorLink(w); if (!w || !u || !link) return;
    const ok = (game.actors ?? []).some(a => (u.isGM || a.testUserPermission?.(u, "OWNER")) && hasKey(a, link.roomId));
    if (!ok) return notify(userId, `Trancada. É preciso a chave de ${link.name ?? "este quarto"}.`);
    await w.update({ ds: CONST.WALL_DOOR_STATES.OPEN });
  });
  Hooks.on("updateWall", (w, ch) => { // ao fechar, a porta do quarto tranca sozinha
    if (!isActiveGM() || !doorLink(w)) return; const L = CONST.WALL_DOOR_STATES; if (ch?.ds === L.CLOSED) w.update({ ds: L.LOCKED });
  });
  Hooks.once("ready", wrapDoors); if (game.ready) wrapDoors();
}
function wrapDoors() {
  const DC = foundry.canvas?.containers?.DoorControl ?? globalThis.DoorControl; if (!DC?.prototype || DC.prototype._atlasKey) return;
  for (const m of ["_onMouseDown", "_onClickLeft"]) { const orig = DC.prototype[m]; if (typeof orig !== "function") continue;
    DC.prototype[m] = function (event, ...rest) {
      const wd = this.wall?.document; const L = CONST.WALL_DOOR_STATES;
      if (wd && !game.user.isGM && wd.ds === L.LOCKED && doorLink(wd) && (event?.button ?? 0) === 0) {
        event?.stopPropagation?.(); if (Date.now() - lastDoor > 500) { lastDoor = Date.now(); request("bizDoor", { sceneId: wd.parent?.id, wallId: wd.id }); } return false; }
      return orig.call(this, event, ...rest); }; }
  DC.prototype._atlasKey = true;
}

/* ---------- janela do balcão ---------- */
const OPEN = new Map();
export function openBiz(sceneId, poiId) {
  const AppV2 = foundry.applications?.api?.ApplicationV2; if (!AppV2) return;
  const key = `${sceneId}.${poiId}`; const ex = OPEN.get(key); if (ex) { ex.render(true); ex.bringToFront?.(); return ex; }
  class BizApp extends AppV2 {
    static DEFAULT_OPTIONS = { classes: ["atlas-sidebar", "atlas-biz"], window: { title: "Balcão", icon: "fa-solid fa-store", resizable: true }, position: { width: 760, height: 760 } };
    draft = null; editStaff = null; tab = null; actorUuid = null; sellerId = null; cfg = "local"; picks = {}; sel = null; mode = "buy"; svc = null; q = {}; openStaff = new Set();
    get title() { const sc = game.scenes.get(sceneId); return `${poiOf(sc, poiId)?.name ?? "Balcão"} · balcão`; }
    async _renderHTML() { return bizHTML(this, sceneId, poiId); }
    _replaceHTML(result, content) { const keep = [...content.querySelectorAll("[data-keep]")].map(e => [e.dataset.keep, e.scrollTop]); content.innerHTML = result; for (const [k, t] of keep) { const e = content.querySelector(`[data-keep="${k}"]`); if (e) e.scrollTop = t; } }
    async _onFirstRender(ctx, opts) { await super._onFirstRender?.(ctx, opts); bindBiz(this, sceneId, poiId); }
    async close(o) { OPEN.delete(key); return super.close?.(o); }
  }
  const app = new BizApp({ id: `atlas-biz-${poiId}` }); OPEN.set(key, app); app.render(true); return app;
}
export function refreshBiz() { for (const a of OPEN.values()) a.render(); }

function bizHTML(app, sceneId, poiId) {
  const sc = game.scenes.get(sceneId); const poi = sc && poiOf(sc, poiId); if (!poi) return `<div class="atl"><div class="pbody"><p class="muted">Este local não existe mais.</p></div></div>`;
  const gm = game.user.isGM; const biz = bizOf(poi); const here = presentActors(sc, poiId);
  if (!app.actorUuid || !here.some(x => x.actor.uuid === app.actorUuid)) app.actorUuid = here[0]?.actor.uuid ?? null;
  const tabs = [...(poi.shop ? [["loja", "shop", "Loja"]] : []), ...(poi.service ? [["servicos", "inn", "Serviços"]] : []), ...((gm || biz.storageVisible || biz.cashVisible) ? [["armazem", "layers", "Armazém"]] : []), ...(gm ? [["config", "gear", "Configurar"]] : [])];
  if (!tabs.some(t => t[0] === app.tab)) app.tab = tabs[0]?.[0] ?? null;
  const actor = app.actorUuid ? docSync(app.actorUuid) : null;
  const sellers = sellersOf(biz); if (!sellers.some(s => s.id === app.sellerId)) app.sellerId = sellers[0]?.id ?? null;
  const svKeys = biz.services.flatMap(s => s.lodging && (s.rooms ?? []).length ? s.rooms.map(r => `${s.id}:${r.id}`) : [s.id]); if (!svKeys.includes(app.svc)) app.svc = svKeys[0] ?? null;
  // quem está atendendo (no cabeçalho)
  const vis = (s) => s && s.uuid && (gm || !s.hidden);
  const seller = sellers.find(s => s.id === app.sellerId); const sv = biz.services.find(s => s.id === String(app.svc ?? "").split(":")[0]);
  const editing = gm && app.tab === "config"; const D = editing ? app.draft : null;
  if (editing && !biz.staff.some(s => s.id === app.editStaff)) app.editStaff = biz.staff[0]?.id ?? null;
  const att = editing ? biz.staff.find(s => s.id === app.editStaff) : (app.tab === "loja" && vis(seller) ? seller : app.tab === "servicos" && sv ? provOf(biz, sv).find(vis) : null) ?? biz.staff.find(vis);
  const open = isOpen(biz.hours);
  const lookOf = (st) => { const l = D?.staff?.[st.id] ?? st.look; if (l?.size) return l; const L = biz.look; // enquadramento antigo (um só para o local)
    if (L?.cx != null) return { size: L.size, cx: L.cx, top: L.top }; return { size: 150, cx: 74, top: 18 }; };
  const bg = { x: 50, y: Number(biz.look?.y ?? 50), z: 1, ...(biz.bg ?? {}), ...(D?.bg ?? {}) }; const heroImg = D?.img ?? poi.img;
  const al = att ? lookOf(att) : null;
  const head = `<header class="bizhero ${editing ? "editing" : ""}" style="height:${HERO_H}px">${heroImg ? `<img class="bh-bg" draggable="false" src="${esc(heroImg)}" alt="" style="object-position:${bg.x}% ${bg.y}%;transform:scale(${bg.z});transform-origin:${bg.x}% ${bg.y}%" onerror="this.remove()">` : ""}<div class="shade"></div>
    <div class="bh-txt"><h2>${esc(poi.name)}</h2><small class="${open ? "ok" : "bad"}">${open ? "Aberto" : "Fechado"} · ${esc(hoursText(biz.hours))}</small></div>
    ${att ? `<img class="bh-att ${editing ? "movable" : ""}" draggable="false" style="width:${Number(al.size) || 150}px;left:${Number(al.cx) || 0}%;top:${Number(al.top) || 0}px" src="${esc(artImg(att.uuid) || MAN)}" alt="" onerror="this.remove()">` : ""}
    ${editing ? `<div class="bh-edit">${biz.staff.length ? `<select data-bf="editStaff" aria-label="Quem ajustar">${biz.staff.map(st => opt(st.id, nameOf(st.uuid), app.editStaff)).join("")}</select>` : ""}<span class="hint">Arraste e use a roda do mouse: na pessoa ajusta a pessoa; no fundo ajusta a imagem do card</span>
      ${D ? `<span class="grow"></span><button type="button" class="btn sm" data-bact="heroDiscard">Descartar</button><button type="button" class="btn sm gold" data-bact="heroSave">Salvar</button>` : ""}</div>` : ""}</header>`;
  const who = here.length ? `<div class="bizwho"><select data-bf="actor" aria-label="Quem negocia">${here.map(x => opt(x.actor.uuid, x.actor.name, app.actorUuid)).join("")}</select>${actor ? purse(actor.system?.currency) : ""}</div>`
    : `<div class="info">${gm ? "Nenhum grupo está neste local. Para negociar, um grupo precisa estar aqui (você, Mestre, pode ver e configurar tudo)." : `Nenhum dos seus personagens está em ${esc(poi.name)}. O grupo precisa estar aqui para negociar.`}</div>`;
  const nav = `<nav class="subtabs">${tabs.map(([k, i, l]) => `<button type="button" class="${app.tab === k ? "on" : ""}" data-bact="tab" data-v="${k}">${ic(i, 13)} ${esc(l)}</button>`).join("")}</nav>`;
  let body = "";
  if (app.tab === "loja") body = shopTab(app, sc, poi, biz, actor, sellers);
  if (app.tab === "servicos") body = serviceTab(app, sc, poi, biz, actor, here);
  if (app.tab === "armazem") body = storageTab(app, poi, biz);
  if (app.tab === "config") body = configTab(app, sc, poi, biz);
  if (!tabs.length) body = `<p class="empty">Marque o local como Loja e/ou Serviços (Atlas › Pontos › local).</p>`;
  return `<div class="atl"><div class="pbody">${head}<div class="bizbar">${nav}${who}</div><div class="bizmain" data-keep="main">${body}</div></div></div>`;
}

/* ----- partes comuns ----- */
const catGroups = (list, cats, catOf) => { const out = []; for (const c of [...cats, { id: "", name: cats.length ? "Outros" : "" }]) { const l = list.filter(x => (catOf(x) || "") === c.id || (c.id === "" && !cats.some(k => k.id === catOf(x)))); if (l.length) out.push([c, l]); } return out; };
const qtyCtl = (max, unitCp) => `<div class="qtybox" data-unit="${unitCp}"><span class="lab">Quantidade</span>
  <div class="qty"><button type="button" class="qb" data-q="-1" aria-label="Menos">−</button><input type="number" min="1" max="${max}" value="1" data-qin><button type="button" class="qb" data-q="1" aria-label="Mais">+</button><button type="button" class="qb" data-q="max" aria-label="Máximo" data-tooltip="Máximo">⇈</button></div>
  ${max > 1 ? `<input type="range" min="1" max="${max}" value="1" data-qr>` : ""}<div class="dtotal"><span>Total</span><b data-total>${coins(unitCp)}</b></div></div>`;
const owned = (actor, name) => (actor?.items ?? []).filter(i => i.name === name).reduce((s, i) => s + (Number(i.system?.quantity ?? 1) || 1), 0);

/* ----- busca ----- */
const sbox = (app, key, ph = "Buscar item…") => `<label class="bsearch">${ic("search", 13)}<input type="search" data-search="${key}" placeholder="${ph}" value="${esc(app.q[key] ?? "")}" autocomplete="off"></label>`;
const sAttr = (app, key, name) => { const q = String(app.q[key] ?? "").trim().toLowerCase(); const nm = String(name ?? "").toLowerCase(); return `data-sk="${key}" data-nm="${esc(nm)}" ${q && !nm.includes(q) ? "hidden" : ""}`; };
function applySearch(root, key, val) { const q = String(val ?? "").trim().toLowerCase(); for (const e of root.querySelectorAll(`[data-sk="${key}"]`)) e.hidden = !!q && !e.dataset.nm.includes(q); }

/* ----- loja ----- */
function shopTab(app, sc, poi, biz, actor, sellers) {
  const gm = game.user.isGM;
  if (!sellers.length) return `<p class="empty">${gm ? "Ninguém vende aqui ainda. Em Configurar › Equipe, marque um servidor como “Vende itens”." : "Ninguém está vendendo aqui."}</p>`;
  const s = sellers.find(x => x.id === app.sellerId); const open = isOpen(biz.hours) && isOpen(s.hours); const rate = s.buys !== false ? (s.buyRate ?? 0.5) : 0;
  if (s.buys === false || !actor) app.mode = "buy";
  const who = sellers.length > 1 ? `<div class="sellertabs">${sellers.map((x, i) => `<button type="button" class="${x.id === s.id ? "on" : ""}" data-bact="seller" data-v="${x.id}" data-tooltip="Balcão ${i + 1}" aria-label="Balcão ${i + 1}">${x.hidden && !gm ? ic("person", 16) : img(artImg(x.uuid), MAN)}</button>`).join("")}</div>` : "";
  const modes = actor && s.buys !== false ? `<div class="seg mini"><button type="button" class="${app.mode === "buy" ? "on" : ""}" data-bact="mode" data-v="buy">Comprar</button><button type="button" class="${app.mode === "sell" ? "on" : ""}" data-bact="mode" data-v="sell">Vender</button></div>` : "";
  const sa = s.source === "own" ? docSync(s.uuid) : null; const safe = gm || biz.cashVisible ? `<span class="safe" data-tooltip="${sa ? "Dinheiro de quem vende (os próprios itens)" : "Cofre do local"}">${purse(sa ? sa.system?.currency : biz.cash)}</span>` : "";
  const top = `<div class="shopbar">${who}${modes}${safe}<small class="muted grow">${open ? "Atendendo" : "Fechado agora"} · ${esc(hoursText(s.hours))}${s.buys !== false ? ` · compram por ${Math.round(rate * 100)}% do valor` : ""}</small></div>`;
  let list, detail;
  if (app.mode === "sell") {
    const its = (actor.items ?? []).filter(i => PHYS.includes(i.type) && !keyOf(i)).map(i => { const d = i.toObject(); return { key: i.id, data: d, qty: Number(i.system?.quantity ?? 1) || 1, price: gpPrice(d) * rate }; });
    if (!its.some(o => o.key === app.sel)) app.sel = its[0]?.key ?? null;
    list = its.length ? `<div class="tiles list">${its.map(o => tile(o, app.sel, o.qty, "Você tem", sAttr(app, "shop", o.data.name))).join("")}</div>` : `<p class="empty">${esc(actor.name)} não tem itens para vender.</p>`;
    const o = its.find(x => x.key === app.sel);
    detail = o ? detailCard(o, actor, { max: o.qty, unit: Math.round(o.price * 100), stockLabel: "Você tem", stock: o.qty, act: "sell", btn: "Vender", disabled: !(open || gm) || o.price <= 0, zero: "sem valor" }) : "";
  } else {
    const offers = offersOf(biz, s); if (!offers.some(o => o.key === app.sel)) app.sel = offers[0]?.key ?? null;
    list = offers.length ? catGroups(offers, biz.shopCats, o => o.cat).map(([c, l]) => `${c.name ? `<h4>${esc(c.name)}</h4>` : ""}<div class="tiles list">${l.map(o => tile(o, app.sel, o.qty, "Estoque", sAttr(app, "shop", o.data.name))).join("")}</div>`).join("") : `<p class="empty">Nada à venda no momento.</p>`;
    const o = offers.find(x => x.key === app.sel);
    detail = o ? detailCard(o, actor, { max: o.qty, unit: Math.round(o.price * 100), stockLabel: "Estoque", stock: o.qty, act: actor ? "buy" : null, btn: "Comprar", disabled: !(open || gm) }) : "";
  }
  const many = (app.mode === "sell" ? (actor?.items?.size ?? actor?.items?.length ?? 0) : offersOf(biz, s).length) > 6;
  return `${top}<div class="shop"><div class="shelf" data-keep="shelf">${many ? sbox(app, "shop") : ""}${list}</div><aside class="detail">${detail || `<p class="empty">Escolha um item.</p>`}</aside></div>`;
}
const tile = (o, sel, qty, lbl = "Estoque", attrs = "") => `<button type="button" class="tile ${o.key === sel ? "on" : ""}" data-bact="pick" data-key="${esc(o.key)}" ${attrs}>
  <span class="ti">${img(o.data.img)}</span><span class="tn"><b>${esc(o.data.name)}</b><small>${lbl}: ${qty}</small></span><span class="tp">${coins(Math.round(o.price * 100), "—")}</span></button>`;
function detailCard(o, actor, x) {
  const desc = stripHTML(o.data.system?.description?.value).slice(0, 160);
  return `<div class="dscroll"><div class="dimg">${img(o.data.img)}</div><h3 class="dname">${esc(o.data.name)}</h3>${desc ? `<p class="ddesc" title="${esc(stripHTML(o.data.system?.description?.value).slice(0, 600))}">${esc(desc)}${desc.length >= 160 ? "…" : ""}</p>` : ""}
    <dl class="dl">${actor && x.act !== "sell" ? `<dt>Você tem</dt><dd>${owned(actor, o.data.name)}</dd>` : ""}<dt>${x.stockLabel}</dt><dd>${x.stock}</dd><dt>${x.act === "sell" ? "Pagam" : "Preço"}</dt><dd>${coins(x.unit, x.zero)}</dd></dl></div>
    <div class="dfoot">${x.act ? `${qtyCtl(x.max, x.unit)}<button type="button" class="btn gold big" data-bact="${x.act}" data-key="${esc(o.key)}" ${x.disabled ? "disabled" : ""}>${x.btn}</button>` : `<p class="muted">Um personagem precisa estar aqui para comprar.</p>`}</div>`;
}

/* ----- serviços ----- */
function serviceTab(app, sc, poi, biz, actor, here) {
  const gm = game.user.isGM; const list = biz.services;
  if (!list.length) return `<p class="empty">${gm ? "Nenhum serviço ainda. Crie em Configurar › Serviços." : "Nenhum serviço oferecido aqui."}</p>`;
  const mine = new Set(here.map(x => x.actor.uuid));
  const unitTxt = (s) => s.lodging ? `${s.communal ? "por cama" : "por quarto"} / diária` : (s.unit ?? "pessoa") === "pessoa" ? "por pessoa" : "por uso";
  const price = (s) => coins(Math.round((Number(s.price) || 0) * 100));
  // camas: quem tem a chave ocupa; o nome só aparece para quem está no quarto (e para o Mestre)
  const beds = (s, r, big) => { const occ = liveOcc(r); const holders = [...new Map(keyHolders(r.id).filter(h => keyValid(h.k)).map(h => [h.actor.uuid, h])).values()];
    const ours = gm || holders.some(h => mine.has(h.actor.uuid)) || occ.some(o => mine.has(o.payer)); const n = Math.max(Number(r.beds) || 1, holders.length);
    const used = s.communal ? occ.length : (occ.length ? n : 0); const out = [];
    for (let i = 0; i < n; i++) { const h = holders[i];
      if (h) out.push(`<span class="bed taken ${mine.has(h.actor.uuid) ? "mine" : ""}" title="${ours ? esc(h.actor.name) : "Ocupada"}">${ours ? img(artImg(h.actor.uuid), MAN) : `<i>${ic("person", 12)}</i>`}${big ? `<small>${ours ? esc(h.actor.name) : "Ocupada"}</small>${gm ? `<button type="button" class="bedx" data-bact="revokeKey" data-aid="${h.actor.id}" data-iid="${h.item.id}" data-tooltip="Tirar a chave de ${esc(h.actor.name)}">${ic("close", 10)}</button>` : ""}` : ""}</span>`);
      else if (i < used) out.push(`<span class="bed taken" title="${s.communal ? "Ocupada" : "Vazia"}">${big ? `<i>${ic(s.communal ? "person" : "bed", 14)}</i><small>${s.communal ? "Ocupada" : "Vazia"}</small>` : ""}</span>`);
      else out.push(`<span class="bed free" title="Livre">${big ? `<i>${ic("bed", 14)}</i><small>Livre</small>` : ""}</span>`); }
    return `<span class="beds ${big ? "big" : ""}">${out.join("")}</span>`; };
  const rows = (s) => s.lodging && (s.rooms ?? []).length ? s.rooms.map(r => { const k = `${s.id}:${r.id}`; const occ = liveOcc(r); const fr = s.communal ? freeBeds(r) : (occ.length ? 0 : 1);
      return `<button type="button" class="svrow ${k === app.svc ? "on" : ""}" data-bact="svc" data-v="${k}"><span class="si">${ic("bed", 16)}</span><span class="grow"><b>${esc(r.name)}</b><small>${esc(s.name || "Hospedagem")} · ${fr > 0 ? (s.communal ? `${fr} cama(s) livre(s)` : "livre") : "ocupado"}</small></span>${beds(s, r, false)}${fr > 0 ? price(s) : `<span class="rented">Alugado</span>`}</button>`; }).join("")
    : `<button type="button" class="svrow ${s.id === app.svc ? "on" : ""}" data-bact="svc" data-v="${s.id}"><span class="si">${ic(s.lodging ? "bed" : "star", 16)}</span><span class="grow"><b>${esc(s.name || "Serviço sem nome")}</b><small>${svcOpen(biz, s) ? unitTxt(s) : "fora do horário"}</small></span>${price(s)}</button>`;
  const lst = catGroups(list, biz.svcCats, s => s.cat).map(([c, l]) => `${c.name ? `<h4>${esc(c.name)}</h4>` : ""}${l.map(rows).join("")}`).join("");
  const [svId, roomId] = String(app.svc ?? "").split(":"); const sv = list.find(x => x.id === svId); if (!sv) return `<div class="shop"><div class="shelf">${lst}</div></div>`;
  const room = roomId ? (sv.rooms ?? []).find(r => r.id === roomId) : null; const open = svcOpen(biz, sv);
  let roomInfo = "", maxQ = 20, qLabel = (sv.unit ?? "pessoa") === "pessoa" ? "Pessoas" : null;
  if (room) { const occ = liveOcc(room); const kf = keysFree(room); const ours = gm || occ.some(o => mine.has(o.payer)) || keyHolders(room.id).some(h => keyValid(h.k) && mine.has(h.actor.uuid));
    maxQ = sv.communal ? Math.min(freeBeds(room), kf) : kf; qLabel = sv.communal ? "Camas" : "Chaves";
    roomInfo = `<div class="roombox"><div class="row2"><span class="lab grow">${sv.communal ? "Dormitório" : "Quarto privativo"}</span><small class="muted">${ic("lock", 10)} ${kf}/${keysTotal(room)} chaves livres</small></div>${beds(sv, room, true)}
      ${ours && occ.length ? `<small class="muted">Até ${esc(when(Math.max(...occ.map(o => o.until ?? 0))))} · pago por ${[...new Set(occ.map(o => o.payer))].map(u => esc(nameOf(u))).join(", ")}</small>` : ""}
      ${gm && (occ.length || keysOut(room.id)) ? `<button type="button" class="btn sm" data-bact="vacate" data-id="${sv.id}" data-rid="${room.id}">${ic("close", 11)} Desocupar o quarto</button>` : ""}</div>`; }
  const unit = Math.round((Number(sv.price) || 0) * 100);
  const log = (sv.log ?? []).filter(e => (!room || !e.room || e.room === room.name) && (gm || mine.has(e.payer) || (e.guests ?? []).some(g => mine.has(g)))).slice(0, 10);
  const full = room && (sv.communal ? freeBeds(room) <= 0 : liveOcc(room).length > 0); const noKeys = room && keysFree(room) <= 0;
  const qtyRow = (label, attr, max) => `<div class="row2"><span class="lab grow">${label}</span><div class="qty"><button type="button" class="qb" data-n="-1" aria-label="Menos">−</button><input type="number" min="1" ${max ? `max="${max}"` : ""} value="1" ${attr}><button type="button" class="qb" data-n="1" aria-label="Mais">+</button></div></div>`;
  const detail = `<div class="dscroll"><h3 class="dname">${esc(room ? room.name : (sv.name || "Serviço"))}</h3>${room ? `<p class="ddesc">${esc(sv.name)}</p>` : ""}${sv.desc ? `<p class="ddesc">${esc(sv.desc)}</p>` : ""}
    <dl class="dl">${full ? "" : `<dt>Preço</dt><dd>${coins(unit)} <small>${unitTxt(sv)}</small></dd>`}<dt>Situação</dt><dd class="${open && !full && !noKeys ? "ok" : "bad"}">${!open ? "Fora do horário" : full ? "Ocupado" : noKeys ? "Sem chaves" : "Disponível"}</dd>${sv.rest ? `<dt>Inclui</dt><dd>Descanso longo</dd>` : ""}</dl>
    ${roomInfo}
    ${log.length ? `<details class="svlog"><summary>Diário · ${log.length}</summary>${log.map(e => `<div><small>${esc(when(e.t))}</small> ${esc(nameOf(e.payer))} pagou ${esc(fmtGp((e.cost ?? 0) / 100))}${e.room && !room ? ` · ${esc(e.room)}` : ""}${e.nights ? ` · ${e.nights} diária${e.nights > 1 ? "s" : ""}` : ""}${e.qty > 1 ? ` · ×${e.qty}` : ""}</div>`).join("")}</details>` : ""}</div>
    ${actor ? `<div class="dfoot"><div class="svtotal" data-svtotal data-unit="${unit}" data-per="${sv.lodging ? (sv.communal ? "head" : "one") : (sv.unit ?? "pessoa") === "pessoa" ? "head" : "one"}" data-lodging="${sv.lodging ? 1 : 0}">
      ${full ? "" : `${sv.lodging ? qtyRow("Diárias", "data-nights") : ""}${qLabel && maxQ > 0 ? qtyRow(qLabel, "data-sq", maxQ) : ""}
      <div class="dtotal"><span>Total</span><b data-total>${coins(unit)}</b></div>`}</div>
      <button type="button" class="btn gold big" data-bact="service" data-id="${esc(app.svc)}" ${(open || gm) && !full && !noKeys ? "" : "disabled"}>${full ? "Alugado" : `${sv.lodging ? "Alugar" : "Contratar"} · ${esc(actor.name.split(" ")[0])} paga`}</button>${sv.lodging && !sv.communal && !full ? `<small class="muted center">Quem paga recebe as chaves e pode entregá-las.</small>` : ""}</div>` : ""}`;
  return `<div class="shop"><div class="shelf" data-keep="svlist">${lst}</div><aside class="detail">${detail}</aside></div>`;
}

/* ----- armazém ----- */
function storageTab(app, poi, biz) {
  const gm = game.user.isGM;
  const cofre = gm ? `<section><h3>Cofre</h3><div class="cofre">${DEN.map(k => `<label class="cin">${coinImg(k)}<input type="number" min="0" value="${Number(biz.cash[k]) || 0}" data-bf="cash" data-k="${k}" aria-label="${DNAME[k]}"></label>`).join("")}</div>
      <label class="check"><input type="checkbox" data-bf="cashVisible" ${biz.cashVisible ? "checked" : ""}> Jogadores veem o cofre</label><p class="muted">Recebe o dinheiro das vendas do armazém e dos serviços; paga quando o armazém compra itens dos jogadores. Quem vende os próprios itens usa o próprio dinheiro.</p></section>`
    : biz.cashVisible ? `<section><h3>Cofre</h3>${purse(biz.cash)}</section>` : "";
  if (!gm && !biz.storageVisible) return cofre;
  return `${cofre}
    <section><h3>Itens · ${biz.storage.length}</h3>${gm ? `<label class="check"><input type="checkbox" data-bf="storageVisible" ${biz.storageVisible ? "checked" : ""}> Jogadores veem o armazém</label>
    <div class="drop" data-bdrop="Item">${ic("plus", 14)}<span class="grow">Solte itens aqui (do diretório, de um compêndio ou de uma ficha)</span></div>` : ""}
    ${biz.storage.length > 5 ? sbox(app, "arm") : ""}<div class="sells">${biz.storage.map(st => `<div class="sellrow" ${sAttr(app, "arm", st.data.name)}><span class="thumb">${img(st.data.img)}</span><span class="grow">${esc(st.data.name)}</span>${coins(Math.round(gpPrice(st.data) * 100), "—")}${gm ? `<input type="number" class="num" min="0" value="${st.qty}" data-bf="qty" data-sid="${st.id}" title="Quantidade"><button type="button" class="icon danger" data-bact="delItem" data-sid="${st.id}" aria-label="Tirar">${ic("trash", 13)}</button>` : `<small>${st.qty}×</small>`}</div>`).join("") || `<p class="empty">Vazio.</p>`}</div></section>`;
}

/* ----- configurar (Mestre) ----- */
function hoursInputs(h, path) { return `<div class="grid2"><label>Abre<input type="text" placeholder="08:00" value="${esc(h?.open ?? "")}" data-bf="hours" data-path="${path}" data-k="open"></label><label>Fecha<input type="text" placeholder="20:00" value="${esc(h?.close ?? "")}" data-bf="hours" data-path="${path}" data-k="close"></label></div>`; }
function catEditor(kind, cats) { return `<div class="cats">${cats.map(c => `<span class="catchip"><input type="text" placeholder="Nome" value="${esc(c.name)}" data-bf="catName" data-kind="${kind}" data-id="${c.id}"><button type="button" class="icon danger" data-bact="delCat" data-kind="${kind}" data-id="${c.id}" aria-label="Tirar">${ic("close", 11)}</button></span>`).join("")}<button type="button" class="btn sm" data-bact="addCat" data-kind="${kind}">${ic("plus", 12)} Categoria</button></div>`; }
const catSel = (cats, cur, attrs) => `<select ${attrs}><option value="">Sem categoria</option>${cats.map(c => opt(c.id, c.name || "(sem nome)", cur)).join("")}</select>`;
function configTab(app, sc, poi, biz) {
  const sub = [["local", "Local"], ["equipe", "Equipe"], ...(poi.service ? [["serv", "Serviços"]] : [])]; if (!sub.some(x => x[0] === app.cfg)) app.cfg = "local";
  const nav = `<div class="seg mini">${sub.map(([k, l]) => `<button type="button" class="${app.cfg === k ? "on" : ""}" data-bact="cfg" data-v="${k}">${esc(l)}</button>`).join("")}</div>`;
  const L = biz.look;
  if (app.cfg === "local") return `${nav}<section><h3>Horário do local</h3>${hoursInputs(biz.hours, "building")}<p class="muted">Vazio = sempre aberto. Horas do relógio do mundo (ex.: 08:00 e 20:00; 22:00–04:00 passa da meia-noite).</p></section>
    <section><h3>Cabeçalho</h3><label>Imagem do card do local<div class="row2"><input type="text" class="grow" placeholder="caminho da imagem" value="${esc(app.draft?.img ?? poi.img ?? "")}" data-bf="pimg"><button type="button" class="btn sm" data-bact="pickImg">${ic("search", 12)} Escolher</button></div></label><p class="muted">É a mesma imagem do card do local no mapa.</p>
    <p class="muted">Enquanto você está em Configurar, o cabeçalho fica editável: escolha a pessoa no canto do cabeçalho, arraste e use a roda do mouse (na pessoa ajusta a pessoa; no fundo ajusta a imagem do card). Cada pessoa da equipe tem o seu enquadramento. Nada muda até clicar em <b>Salvar</b>.</p></section>
    ${poi.shop ? `<section><h3>Categorias da loja</h3>${catEditor("shop", biz.shopCats)}</section>` : ""}`;
  if (app.cfg === "equipe") return `${nav}<section><h3>Equipe · servidores do local</h3><div class="drop" data-bdrop="Actor" data-target="staff">${ic("person", 14)}<span class="grow">Solte um ator para entrar na equipe</span></div>
    ${biz.staff.map(s => staffCard(s, poi, biz, app)).join("") || `<p class="empty">Ninguém na equipe ainda.</p>`}</section>`;
  return `${nav}<section><h3>Categorias de serviço</h3>${catEditor("svc", biz.svcCats)}</section>
    <section><h3>Serviços</h3><div class="actions row"><button type="button" class="btn" data-bact="addService">${ic("plus", 13)} Novo serviço</button></div>
    ${biz.services.map(sv => svcCard(sv, sc, poi, biz)).join("")}</section>`;
}
function staffCard(s, poi, biz, app) {
  const sa = docSync(s.uuid); const own = s.source === "own";
  const pr = (o, key) => `${catSel(biz.shopCats, o.cat, `data-bf="ocat" data-id="${s.id}" data-key="${key}"`)}${priceIn(o.price ?? 0, o.den, `data-bf="price" data-scope="offer" data-id="${s.id}" data-key="${key}"`)}`;
  const items = !s.sells ? "" : own ? (sa?.items?.filter(i => PHYS.includes(i.type) && !keyOf(i)) ?? []).map(i => { const o = (s.items ?? []).find(x => x.iid === i.id); return `<div class="offer" ${sAttr(app, `off-${s.id}`, i.name)}><label class="check grow"><input type="checkbox" data-bf="offerOwn" data-id="${s.id}" data-iid="${i.id}" ${o ? "checked" : ""}><span class="thumb">${img(i.img)}</span>${esc(i.name)} <small>×${Number(i.system?.quantity ?? 1) || 1}</small></label>${o ? pr(o, i.id) : ""}</div>`; }).join("") || `<p class="muted">O inventário deste servidor não tem itens.</p>`
    : biz.storage.map(st => { const o = (s.items ?? []).find(x => x.sid === st.id); return `<div class="offer" ${sAttr(app, `off-${s.id}`, st.data.name)}><label class="check grow"><input type="checkbox" data-bf="offer" data-id="${s.id}" data-sid="${st.id}" ${o ? "checked" : ""}><span class="thumb">${img(st.data.img)}</span>${esc(st.data.name)} <small>×${st.qty}</small></label>${o ? pr(o, st.id) : ""}</div>`; }).join("") || `<p class="muted">O armazém está vazio: coloque itens lá primeiro.</p>`;
  const isOpen_ = app.openStaff.has(s.id); const sum = [s.sells ? "Vende" : "", s.serves ? "Presta serviços" : "", s.hidden ? "Oculto" : "", s.hours ? hoursText(s.hours) : ""].filter(Boolean).join(" · ") || "Sem função marcada";
  if (!isOpen_) return `<div class="bizcard staff closed"><div class="row2 shead" data-bact="toggleStaff" data-id="${s.id}"><span class="chev">▸</span><span class="ava">${img(artImg(s.uuid), MAN)}</span><span class="grow"><b>${esc(nameOf(s.uuid))}</b><small>${esc(sum)}</small></span><button type="button" class="icon danger" data-bact="delStaff" data-id="${s.id}" aria-label="Tirar da equipe">${ic("trash", 13)}</button></div></div>`;
  const many = (own ? (sa?.items?.size ?? sa?.items?.length ?? 0) : biz.storage.length) > 5;
  return `<div class="bizcard staff"><div class="row2 shead" data-bact="toggleStaff" data-id="${s.id}"><span class="chev">▾</span><span class="ava">${img(artImg(s.uuid), MAN)}</span><span class="grow"><b>${esc(nameOf(s.uuid))}</b><small>${esc(sum)}</small></span><button type="button" class="icon danger" data-bact="delStaff" data-id="${s.id}" aria-label="Tirar da equipe">${ic("trash", 13)}</button></div>
    <div class="flags">${poi.shop ? `<label class="check"><input type="checkbox" data-bf="sf" data-id="${s.id}" data-k="sells" ${s.sells ? "checked" : ""}> Vende itens</label>` : ""}${poi.service ? `<label class="check"><input type="checkbox" data-bf="sf" data-id="${s.id}" data-k="serves" ${s.serves ? "checked" : ""}> Presta serviços</label>` : ""}<label class="check"><input type="checkbox" data-bf="sf" data-id="${s.id}" data-k="hidden" ${s.hidden ? "checked" : ""}> Oculto dos jogadores</label></div>
    ${hoursInputs(s.hours, `staff:${s.id}`)}
    ${s.sells ? `<div class="sub"><span class="lab">Vendas</span><label>Vende<select data-bf="source" data-id="${s.id}">${opt("storage", "Itens do armazém (o dinheiro vai para o cofre)", s.source ?? "storage")}${opt("own", "Os próprios itens (o dinheiro fica com ele)", s.source)}</select></label>
      <div class="grid2"><label class="check"><input type="checkbox" data-bf="sf" data-id="${s.id}" data-k="buys" ${s.buys !== false ? "checked" : ""}> Compra itens dos jogadores</label><label>Paga (% do valor)<input type="number" min="0" max="200" step="5" value="${Math.round((s.buyRate ?? 0.5) * 100)}" data-bf="buyRate" data-id="${s.id}"></label></div>
      <span class="lab">À venda · categoria e preço</span>${s.sells && many ? sbox(app, `off-${s.id}`) : ""}${items}</div>` : ""}
    ${s.serves ? `<div class="sub"><span class="lab">Serviços que oferece</span>${biz.services.map(sv => `<label class="check"><input type="checkbox" data-bf="sserv" data-id="${s.id}" data-sv="${sv.id}" ${(s.services ?? []).includes(sv.id) ? "checked" : ""}> ${esc(sv.name || "Serviço sem nome")}</label>`).join("") || `<p class="muted">Crie os serviços em Configurar › Serviços.</p>`}</div>` : ""}</div>`;
}
function svcCard(sv, sc, poi, biz) {
  const pv = provOf(biz, sv);
  const rooms = !sv.lodging ? "" : (sv.rooms ?? []).map(r => { const occ = liveOcc(r); const keys = keyHolders(r.id);
    return `<div class="roomcfg"><div class="row2"><input type="text" class="grow" value="${esc(r.name)}" data-bf="room" data-id="${sv.id}" data-rid="${r.id}" data-k="name"><label class="inl">Camas <input type="number" class="num" min="1" value="${Number(r.beds) || 1}" data-bf="room" data-id="${sv.id}" data-rid="${r.id}" data-k="beds"></label><label class="inl" data-tooltip="Quantas chaves existem deste quarto (${keysOut(r.id)} em uso)">Chaves <input type="number" class="num" min="1" value="${keysTotal(r)}" data-bf="room" data-id="${sv.id}" data-rid="${r.id}" data-k="keys"></label><button type="button" class="icon danger" data-bact="delRoom" data-id="${sv.id}" data-rid="${r.id}" aria-label="Tirar quarto">${ic("trash", 12)}</button></div>
      <div class="row2"><small class="grow">${occ.length ? `Ocupado: ${occ.map(o => esc(nameOf(o.uuid))).join(", ")} · até ${esc(when(occ[0].until ?? 0))}` : "Vago"}</small>${occ.length ? `<button type="button" class="btn sm" data-bact="vacate" data-id="${sv.id}" data-rid="${r.id}">Desocupar</button>` : ""}</div>
      <div class="row2"><small class="grow">${r.door ? `${ic("lock", 11)} Porta vinculada${r.door.sceneName ? ` em ${esc(r.door.sceneName)}` : ""}: só abre com a chave` : "Sem porta vinculada"}</small>${r.door ? `<button type="button" class="btn sm" data-bact="unlinkDoor" data-id="${sv.id}" data-rid="${r.id}">Desvincular</button>` : `<button type="button" class="btn sm" data-bact="linkDoor" data-id="${sv.id}" data-rid="${r.id}" data-tooltip="Na cena do quarto, selecione a porta na camada de Paredes e clique aqui">${ic("lock", 11)} Vincular porta selecionada</button>`}</div>
      <div class="keys">${keys.map(h => `<span class="keychip ${keyValid(h.k) ? "" : "old"}">${ic("lock", 10)} ${esc(h.actor.name)}<button type="button" class="icon" data-bact="revokeKey" data-aid="${h.actor.id}" data-iid="${h.item.id}" aria-label="Tirar a chave">${ic("close", 10)}</button></span>`).join("")}<span class="drop sm" data-bdrop="Actor" data-target="key:${sv.id}:${r.id}">${ic("plus", 11)} Solte atores para dar a chave</span></div></div>`; }).join("");
  return `<div class="bizcard"><div class="row2"><input type="text" class="grow" placeholder="Nome (ex.: Quarto simples, Banho, Limpar equipamento)" value="${esc(sv.name ?? "")}" data-bf="svc" data-id="${sv.id}" data-k="name"><button type="button" class="icon danger" data-bact="delService" data-id="${sv.id}" aria-label="Tirar">${ic("trash", 13)}</button></div>
    <div class="grid2"><label>Categoria${catSel(biz.svcCats, sv.cat, `data-bf="svc" data-id="${sv.id}" data-k="cat"`)}</label><label>Preço${priceIn(sv.price ?? 0, sv.den, `data-bf="price" data-scope="svc" data-id="${sv.id}"`)}</label></div>
    <label>Descrição<input type="text" value="${esc(sv.desc ?? "")}" data-bf="svc" data-id="${sv.id}" data-k="desc"></label>
    <div class="flags"><label class="check"><input type="checkbox" data-bf="svcb" data-id="${sv.id}" data-k="lodging" ${sv.lodging ? "checked" : ""}> Hospedagem (quartos e diárias)</label><label class="check"><input type="checkbox" data-bf="svcb" data-id="${sv.id}" data-k="rest" ${sv.rest ? "checked" : ""}> Faz um descanso longo</label></div>
    ${sv.lodging ? `<div class="flags"><label class="check"><input type="checkbox" data-bf="svcb" data-id="${sv.id}" data-k="communal" ${sv.communal ? "checked" : ""}> Dormitório comunitário</label><small class="muted">${sv.communal ? "Preço por pessoa; cada pessoa ocupa uma cama e estranhos dividem o quarto." : "Preço por quarto; um grupo por quarto."}</small></div>
      <span class="lab">Quartos</span>${rooms}<div class="actions row"><button type="button" class="btn sm" data-bact="addRoom" data-id="${sv.id}">${ic("plus", 12)} Quarto</button></div>`
      : `<label>Cobrar<select data-bf="svc" data-id="${sv.id}" data-k="unit">${opt("pessoa", "Por pessoa", sv.unit ?? "pessoa")}${opt("uso", "Por uso (um preço só)", sv.unit)}</select></label>`}
    <small class="muted">Prestado por: ${pv.length ? pv.map(s => esc(nameOf(s.uuid))).join(", ") : "qualquer um (marque em Configurar › Equipe)"}</small></div>`;
}

/* ---------- eventos ---------- */
const editBiz = (sceneId, poiId, fn) => { const sc = game.scenes.get(sceneId); if (!sc || !game.user.isGM) return; return editPoi(sc, poiId, fn); };
const target = (B, path) => { if (path === "building") return B; const [k, id] = path.split(":"); return ({ staff: B.staff, service: B.services }[k] ?? []).find(x => x.id === id); };
function syncQty(box, v) {
  const inp = box.querySelector("[data-qin]"); const max = Number(inp.max) || 1; v = Math.max(1, Math.min(max, Math.round(Number(v) || 1)));
  inp.value = v; const r = box.querySelector("[data-qr]"); if (r) r.value = v; const t = box.querySelector("[data-total]"); if (t) t.innerHTML = coins(Number(box.dataset.unit) * v);
}
function syncSvc(el) {
  const box = el.querySelector("[data-svtotal]"); if (!box) return; const unit = Number(box.dataset.unit); const n = Math.max(1, Number(box.querySelector("[data-nights]")?.value) || 1);
  const q = Math.max(1, Number(box.querySelector("[data-sq]")?.value) || 1); const tot = unit * (box.dataset.per === "head" ? q : 1) * (box.dataset.lodging === "1" ? n : 1);
  box.querySelector("[data-total]").innerHTML = coins(tot);
}
async function roomDoor(sceneId, poiId, svId, rid, link) {
  const sc = game.scenes.get(sceneId); const poi = sc && poiOf(sc, poiId); const r = poi && bizOf(poi).services.find(x => x.id === svId)?.rooms?.find(x => x.id === rid); if (!r) return;
  const L = CONST.WALL_DOOR_STATES;
  if (!link) { const ws = game.scenes.get(r.door?.sceneId)?.walls?.get(r.door?.wallId); if (ws) await ws.update({ [`flags.${MODULE_ID}.-=room`]: null, ds: L.CLOSED });
    return editBiz(sceneId, poiId, (B) => { const R = B.services.find(x => x.id === svId)?.rooms?.find(x => x.id === rid); if (R) R.door = null; }); }
  const w = (canvas.walls?.controlled ?? []).find(x => x.document?.door);
  if (!w) return globalThis.ui?.notifications?.warn("Atlas: abra a cena do quarto, selecione a porta na camada de Paredes e clique de novo.");
  await w.document.update({ ds: L.LOCKED, [`flags.${MODULE_ID}.room`]: { sceneId, poiId, svcId: svId, roomId: rid, name: `${r.name} (${poi.name})` } });
  await editBiz(sceneId, poiId, (B) => { const R = B.services.find(x => x.id === svId)?.rooms?.find(x => x.id === rid); if (R) R.door = { sceneId: canvas.scene.id, sceneName: canvas.scene.name, wallId: w.document.id }; });
  globalThis.ui?.notifications?.info(`Atlas: porta vinculada a ${r.name}. Ela fica trancada e só abre para quem tem a chave.`);
}
function bindBiz(app, sceneId, poiId) {
  const el = app.element;
  // atendente no cabeçalho (Mestre): arrastar move, roda do mouse muda o tamanho
  const draft = () => (app.draft ??= { bg: null, staff: {}, img: undefined });
  const showSave = () => { if (!el.querySelector(".bh-edit [data-bact=heroSave]")) app.render(); };
  const hero = () => el.querySelector(".bizhero.editing");
  const bgOf = (h) => { const im = h.querySelector(".bh-bg"); const m = /([\d.]+)% ([\d.]+)%/.exec(im?.style.objectPosition ?? ""); const z = Number(/scale\(([\d.]+)\)/.exec(im?.style.transform ?? "")?.[1] ?? 1); return { im, x: m ? Number(m[1]) : 50, y: m ? Number(m[2]) : 50, z }; };
  const setBg = (im, b) => { im.style.objectPosition = `${b.x}% ${b.y}%`; im.style.transform = `scale(${b.z})`; im.style.transformOrigin = `${b.x}% ${b.y}%`; };
  const attLook = (im, W) => ({ size: Math.round(im.offsetWidth), cx: Math.round(im.offsetLeft / (W || 1) * 10000) / 100, top: Math.round(im.offsetTop) });
  el.addEventListener("wheel", (e) => { const h = e.target.closest?.(".bizhero.editing"); if (!h || e.target.closest(".bh-edit")) return; e.preventDefault(); e.stopPropagation(); const R = h.getBoundingClientRect();
    const im = e.target.closest(".bh-att");
    if (im) { const mx = e.clientX - R.left, my = e.clientY - R.top; const s0 = im.offsetWidth; const s1 = Math.max(30, Math.min(4000, s0 * (e.deltaY < 0 ? 1.12 : 1 / 1.12))); const k = s1 / s0;
      const l = mx - (mx - im.offsetLeft) * k, t = my - (my - im.offsetTop) * k; im.style.width = `${s1}px`; im.style.left = `${l}px`; im.style.top = `${t}px`; draft().staff[app.editStaff] = attLook(im, R.width); return showSave(); }
    const b = bgOf(h); if (!b.im) return; b.z = Math.max(1, Math.min(6, Math.round(b.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1) * 1000) / 1000)); setBg(b.im, b); draft().bg = { x: b.x, y: b.y, z: b.z }; showSave(); }, { passive: false });
  el.addEventListener("pointerdown", (e) => { const h = e.target.closest?.(".bizhero.editing"); if (!h || e.button !== 0 || e.target.closest(".bh-edit")) return; e.preventDefault(); e.stopPropagation();
    const R = h.getBoundingClientRect(); const im = e.target.closest(".bh-att"); const sx = e.clientX, sy = e.clientY; const cap = im ?? h; cap.setPointerCapture?.(e.pointerId); h.classList.add("drag");
    let mv;
    if (im) { const ox = im.offsetLeft, oy = im.offsetTop; mv = (ev) => { im.style.left = `${ox + ev.clientX - sx}px`; im.style.top = `${oy + ev.clientY - sy}px`; }; }
    else { const b0 = bgOf(h); if (!b0.im) return; mv = (ev) => { const b = { ...b0, x: Math.max(0, Math.min(100, b0.x - (ev.clientX - sx) / R.width * 100 / b0.z)), y: Math.max(0, Math.min(100, b0.y - (ev.clientY - sy) / R.height * 60 / b0.z)) }; b.x = Math.round(b.x * 10) / 10; b.y = Math.round(b.y * 10) / 10; setBg(b0.im, b); }; }
    const up = () => { cap.removeEventListener("pointermove", mv); cap.removeEventListener("pointerup", up); cap.removeEventListener("pointercancel", up); h.classList.remove("drag");
      if (im) draft().staff[app.editStaff] = attLook(im, R.width); else { const b = bgOf(h); draft().bg = { x: b.x, y: b.y, z: b.z }; } showSave(); };
    cap.addEventListener("pointermove", mv); cap.addEventListener("pointerup", up); cap.addEventListener("pointercancel", up); });
  el.addEventListener("click", async (e) => {
    const q = e.target.closest("[data-q]"); if (q) { const box = q.closest(".qtybox"); const inp = box.querySelector("[data-qin]"); syncQty(box, q.dataset.q === "max" ? inp.max : Number(inp.value) + Number(q.dataset.q)); return; }
    const n = e.target.closest("[data-n]"); if (n) { const inp = n.parentElement.querySelector("input"); const mx = Number(inp.max) || Infinity; inp.value = Math.min(mx, Math.max(1, (Number(inp.value) || 1) + Number(n.dataset.n))); syncSvc(el); return; }
    const b = e.target.closest("[data-bact]"); if (!b || b.disabled) return; e.preventDefault(); const a = b.dataset.bact; const ds = b.dataset;
    const base = { sceneId, poiId, actorUuid: app.actorUuid }; const qty = () => Number(el.querySelector(".detail [data-qin]")?.value) || 1;
    switch (a) {
      case "tab": app.tab = ds.v; return app.render();
      case "cfg": app.cfg = ds.v; return app.render();
      case "seller": app.sellerId = ds.v; app.sel = null; return app.render();
      case "mode": app.mode = ds.v; app.sel = null; return app.render();
      case "pick": app.sel = ds.key; return app.render();
      case "svc": app.svc = ds.v; return app.render();
      case "buy": await request("bizBuy", { ...base, sellerId: app.sellerId, key: ds.key, qty: qty() }); return;
      case "sell": await request("bizSell", { ...base, sellerId: app.sellerId, itemId: ds.key, qty: qty() }); setTimeout(() => app.render(), 300); return;
      case "service": { const nights = el.querySelector(".detail [data-nights]")?.value; const sq = el.querySelector(".detail [data-sq]")?.value;
        const [serviceId, roomId] = ds.id.split(":"); await request("bizService", { ...base, serviceId, roomId: roomId ?? null, nights: Number(nights) || 1, qty: Number(sq) || 1 }); setTimeout(() => app.render(), 300); return; }
      case "toggleStaff": if (e.target.closest(".danger")) return; if (app.openStaff.has(ds.id)) app.openStaff.delete(ds.id); else app.openStaff.add(ds.id); return app.render();
      case "pickImg": { const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker; if (!FP) return;
        const cur = app.draft?.img ?? poiOf(game.scenes.get(sceneId), poiId)?.img ?? ""; return new FP({ type: "image", current: cur, callback: (path) => { draft().img = path; app.render(); } }).render(true); }
      case "heroDiscard": app.draft = null; return app.render();
      case "heroSave": { const d = app.draft; if (!d) return; app.draft = null;
        await editBiz(sceneId, poiId, (B, P) => { if (d.bg) B.bg = { ...d.bg }; for (const [id, l] of Object.entries(d.staff ?? {})) { const st = B.staff.find(x => x.id === id); if (st) st.look = { ...l }; } if (d.img !== undefined) P.img = String(d.img).trim(); });
        globalThis.ui?.notifications?.info("Atlas: cabeçalho salvo."); return app.render(); }
      case "delItem": return editBiz(sceneId, poiId, (B) => { B.storage = B.storage.filter(x => x.id !== ds.sid); for (const s of B.staff) s.items = (s.items ?? []).filter(x => x.sid !== ds.sid); });
      case "delStaff": return editBiz(sceneId, poiId, (B) => { B.staff = B.staff.filter(x => x.id !== ds.id); });
      case "addService": return editBiz(sceneId, poiId, (B) => { B.services.push({ id: uid(), name: "", cat: "", price: 0, unit: "pessoa", desc: "", hours: null, lodging: false, rest: false, rooms: [], log: [] }); });
      case "delService": return editBiz(sceneId, poiId, (B) => { B.services = B.services.filter(x => x.id !== ds.id); for (const s of B.staff) s.services = (s.services ?? []).filter(x => x !== ds.id); });
      case "addCat": return editBiz(sceneId, poiId, (B) => { (ds.kind === "shop" ? B.shopCats : B.svcCats).push({ id: uid(), name: "" }); });
      case "delCat": return editBiz(sceneId, poiId, (B) => { if (ds.kind === "shop") B.shopCats = B.shopCats.filter(c => c.id !== ds.id); else B.svcCats = B.svcCats.filter(c => c.id !== ds.id); });
      case "addRoom": return editBiz(sceneId, poiId, (B) => { const sv = B.services.find(x => x.id === ds.id); if (sv) { sv.rooms ??= []; sv.rooms.push({ id: uid(), name: `Quarto ${sv.rooms.length + 1}`, beds: sv.communal ? 6 : 2, occupants: [] }); } });
      case "delRoom": return editBiz(sceneId, poiId, (B) => { const sv = B.services.find(x => x.id === ds.id); if (sv) sv.rooms = (sv.rooms ?? []).filter(r => r.id !== ds.rid); });
      case "vacate": { for (const h of keyHolders(ds.rid)) await h.item.delete();
        return editBiz(sceneId, poiId, (B) => { const r = B.services.find(x => x.id === ds.id)?.rooms?.find(x => x.id === ds.rid); if (r) r.occupants = []; }); }
      case "revokeKey": { const it = game.actors.get(ds.aid)?.items?.get(ds.iid); if (it) await it.delete(); return app.render(); }
      case "linkDoor": return roomDoor(sceneId, poiId, ds.id, ds.rid, true);
      case "unlinkDoor": return roomDoor(sceneId, poiId, ds.id, ds.rid, false);
    }
  });
  el.addEventListener("input", (e) => {
    const box = e.target.closest(".qtybox");
    if (box && e.target.matches("[data-qr]")) return syncQty(box, e.target.value);
    if (box && e.target.matches("[data-qin]")) { const r = box.querySelector("[data-qr]"); if (r) r.value = e.target.value; box.querySelector("[data-total]").innerHTML = coins(Number(box.dataset.unit) * Math.max(1, Number(e.target.value) || 1)); return; }
    if (e.target.matches("[data-nights], [data-sq]")) syncSvc(el);
    if (e.target.matches("[data-search]")) { app.q[e.target.dataset.search] = e.target.value; applySearch(el, e.target.dataset.search, e.target.value); }
  });
  el.addEventListener("change", async (e) => {
    if (e.target.matches("[data-qin]")) return syncQty(e.target.closest(".qtybox"), e.target.value);
    if (e.target.matches("[data-qr], [data-nights], [data-sq], [data-search]")) return;
    const pk = e.target.closest("[data-pick]"); if (pk) { app.picks[pk.dataset.pick] = [...el.querySelectorAll(`[data-pick="${pk.dataset.pick}"]:checked`)].map(i => i.value); return syncSvc(el); }
    const f = e.target.closest("[data-bf]"); if (!f) return; const k = f.dataset.bf; const val = f.type === "checkbox" ? f.checked : f.value; const ds = f.dataset;
    if (k === "actor") { app.actorUuid = val; app.picks = {}; return app.render(); }
    if (k === "editStaff") { app.editStaff = val; return app.render(); }
    if (k === "pimg") { draft().img = String(val).trim(); return app.render(); }
    let priceGp = null, priceDen = null;
    if (k === "price") { const box = f.closest(".pricein"); priceDen = box.querySelector("[data-part=d]").value; priceGp = Math.max(0, Number(box.querySelector("[data-part=v]").value) || 0) * RATE[priceDen] / 100; }
    const findOffer = (s) => (s.items ?? []).find(x => (x.sid ?? x.iid) === ds.key);
    await editBiz(sceneId, poiId, (B, P) => {
      if (k === "storageVisible") B.storageVisible = !!val;
      if (k === "cashVisible") B.cashVisible = !!val;
      if (k === "cash") B.cash[ds.k] = Math.max(0, Math.floor(Number(val) || 0));
      if (k === "look") B.look[ds.k] = Number(val);
      if (k === "qty") { const st = B.storage.find(x => x.id === ds.sid); if (st) st.qty = Math.max(0, Number(val) || 0); }
      if (k === "hours") { const t = target(B, ds.path); if (t) { t.hours = { ...(t.hours ?? {}), [ds.k]: String(val).trim() }; if (!t.hours.open && !t.hours.close) t.hours = null; } }
      const s = B.staff.find(x => x.id === ds.id);
      if (k === "sf" && s) s[ds.k] = !!val;
      if (k === "buyRate" && s) s.buyRate = Math.max(0, Number(val) || 0) / 100;
      if (k === "source" && s) { s.source = val; s.items = []; }
      if (k === "sserv" && s) { s.services = (s.services ?? []).filter(x => x !== ds.sv); if (val) s.services.push(ds.sv); }
      if (k === "offer" && s) { s.items ??= []; if (val) { const st = B.storage.find(x => x.id === ds.sid); const g = st ? gpPrice(st.data) : 0; s.items.push({ sid: ds.sid, price: g, den: denFor(g), cat: "" }); } else s.items = s.items.filter(x => x.sid !== ds.sid); }
      if (k === "offerOwn" && s) { s.items ??= []; if (val) { const it = docSync(s.uuid)?.items?.get(ds.iid); const g = it ? gpPrice(it.toObject()) : 0; s.items.push({ iid: ds.iid, price: g, den: denFor(g), cat: "" }); } else s.items = s.items.filter(x => x.iid !== ds.iid); }
      if (k === "price" && ds.scope === "offer" && s) { const o = findOffer(s); if (o) { o.price = priceGp; o.den = priceDen; } }
      if (k === "ocat" && s) { const o = findOffer(s); if (o) o.cat = val; }
      const sv = B.services.find(x => x.id === ds.id);
      if (k === "price" && ds.scope === "svc" && sv) { sv.price = priceGp; sv.den = priceDen; }
      if (k === "svc" && sv) sv[ds.k] = val;
      if (k === "svcb" && sv) { sv[ds.k] = !!val; if (ds.k === "lodging" && val && !(sv.rooms ?? []).length) sv.rooms = [{ id: uid(), name: "Quarto 1", beds: 2, occupants: [] }]; }
      if (k === "room" && sv) { const r = (sv.rooms ?? []).find(x => x.id === ds.rid); if (r) r[ds.k] = ds.k === "beds" || ds.k === "keys" ? Math.max(1, Number(val) || 1) : val; }
      if (k === "catName") { const c = (ds.kind === "shop" ? B.shopCats : B.svcCats).find(x => x.id === ds.id); if (c) c.name = val; }
    });
  });
  el.addEventListener("dragover", (e) => { if (e.target.closest("[data-bdrop]")) e.preventDefault(); });
  el.addEventListener("drop", async (e) => {
    const d = e.target.closest("[data-bdrop]"); if (!d || !game.user.isGM) return; e.preventDefault();
    let data; try { data = foundry.applications?.ux?.TextEditor?.implementation?.getDragEventData?.(e) ?? JSON.parse(e.dataTransfer.getData("text/plain")); } catch (err) { return; }
    const uuid = data?.uuid ?? (data?.type && data?.id ? `${data.type}.${data.id}` : null); if (!uuid) return; const doc = await fromUuid(uuid); if (!doc) return;
    if (d.dataset.bdrop === "Item") { if (doc.documentName !== "Item") return globalThis.ui?.notifications?.warn("Atlas: solte um item aqui."); const it = doc.toObject(); delete it._id; const q = Number(it.system?.quantity ?? 1) || 1;
      return editBiz(sceneId, poiId, (B) => { const S = B.storage.find(x => x.data?.name === it.name && x.data?.type === it.type); if (S) S.qty += q; else B.storage.push({ id: uid(), data: it, qty: q }); }); }
    const actor = doc.documentName === "Token" ? doc.actor : doc; if (actor?.documentName !== "Actor") return globalThis.ui?.notifications?.warn("Atlas: solte um ator aqui.");
    const t = d.dataset.target;
    if (t.startsWith("key:")) { // o Mestre dá a chave do quarto para mais alguém
      const [, svId, rid] = t.split(":"); const sc = game.scenes.get(sceneId); const poi = poiOf(sc, poiId); const sv = bizOf(poi).services.find(x => x.id === svId); const r = sv?.rooms?.find(x => x.id === rid); if (!r) return;
      if (hasKey(actor, rid)) return globalThis.ui?.notifications?.info(`Atlas: ${actor.name} já tem esta chave.`);
      if (keysFree(r) <= 0) return globalThis.ui?.notifications?.warn(`Atlas: todas as ${keysTotal(r)} chave(s) de ${r.name} estão em uso. Aumente o número de chaves do quarto.`);
      const occ = liveOcc(r); const until = occ.length ? (Math.max(...occ.map(o => o.until ?? 0)) || null) : null;
      await actor.createEmbeddedDocuments("Item", [keyData(sceneId, poi, sv, r, until)]); return app.render(); }
    const poi = poiOf(game.scenes.get(sceneId), poiId);
    const nid = uid(); app.openStaff.add(nid);
    return editBiz(sceneId, poiId, (B) => { if (t === "staff" && !B.staff.some(s => s.uuid === actor.uuid)) B.staff.push({ ...STAFF(), id: nid, uuid: actor.uuid, sells: !!poi?.shop && !poi?.service, serves: !!poi?.service && !poi?.shop }); });
  });
}
