// Camada "Atlas" nos controles de cena (como Tokens, Notas...). Com ela ativa:
// - as ferramentas do Atlas ficam na barra da esquerda;
// - a tecla Delete e a seleção agem só nos elementos do Atlas (e não nos tokens);
// - segurar o clique aponta um lugar no Atlas (em vez do ping comum).
import { MODULE_ID } from "./config.js";
import { atlas } from "./ui.js";
import { gesture, mapOf } from "./data.js";

/** Ferramenta da barra ↔ ferramenta interna do Atlas. */
export const TOOL_MAP = { atlasSel: "sel", atlasPoi: "local", atlasRota: "rota", atlasRotulo: "rotulo", atlasNuvem: "nuvem", atlasRevelar: "revelar", atlasCobrir: "cobrir", atlasBandeira: "bandeira", atlasRegiao: "regiao", atlasVec: "vec", atlasPortal: "portal" };
export const TOOL_OF = { ...Object.fromEntries(Object.entries(TOOL_MAP).map(([k, v]) => [v, k])), vrota: "atlasVec", vreg: "atlasVec", vwall: "atlasVec" };

export function atlasLayer() { return canvas?.layers?.find?.(l => l.options?.name === "atlas") ?? null; }
export const layerActive = () => canvas?.activeLayer?.options?.name === "atlas";

export function registerLayer() {
  const IL = foundry.canvas?.layers?.InteractionLayer; if (!IL) { console.warn(`${MODULE_ID} | sem InteractionLayer`); return; }
  class AtlasLayer extends IL {
    static get layerOptions() { return foundry.utils.mergeObject(super.layerOptions, { name: "atlas", zIndex: 1000 }); }

    static prepareSceneControls() {
      const gm = game.user.isGM;
      const t = (name, order, title, icon, extra = {}) => ({ name, order, title, icon, ...extra });
      const tools = {
        atlasSel: t("atlasSel", 1, gm ? "Selecionar e mover (arraste no vazio para selecionar vários; Shift soma; Delete apaga)" : "Navegar pelo Atlas", "fa-solid fa-expand"),
        atlasBandeira: t("atlasBandeira", 20, "Bandeira: marcar onde quer ir (segurar o clique aponta um lugar)", "fa-solid fa-flag"),
        atlasCeu: t("atlasCeu", 25, "Céu: ver o céu daqui (no mapa celeste, volta para o mapa)", "fa-solid fa-moon", { button: true, onChange: () => atlas.openSky() })
      };
      if (gm) Object.assign(tools, {
        atlasEdit: t("atlasEdit", 0, atlas.editLock ? "Mapa travado: clique para liberar a edição (arrastar locais, rótulos, rotas e as linhas do mundo)" : "Modo edição ligado: clique para travar o mapa", atlas.editLock ? "fa-solid fa-lock" : "fa-solid fa-lock-open", { toggle: true, active: !atlas.editLock, onChange: (_e, active) => atlas.setEditMode(active) }),
        atlasPoi: t("atlasPoi", 2, "Novo ponto de interesse", "fa-solid fa-location-dot"),
        atlasRota: t("atlasRota", 3, "Nova rota", "fa-solid fa-route"),
        atlasRotulo: t("atlasRotulo", 4, "Novo rótulo", "fa-solid fa-font"),
        ...((() => { try { return game.settings.get("brumas-atlas", "teleport"); } catch (e) { return false; } })() ? { atlasPortal: t("atlasPortal", 4.5, "Ligar portais: clique num portal e depois nos outros (linha reta). Shift encadeia. Clique no vazio cria um portal.", "fa-solid fa-circle-nodes") } : {}),
        atlasRevelar: t("atlasRevelar", 5, "Pincel: revelar a névoa", "fa-solid fa-eye"),
        atlasCobrir: t("atlasCobrir", 6, "Pincel: cobrir com névoa", "fa-solid fa-eye-slash"),
        atlasNuvem: t("atlasNuvem", 7, "Arrastar nuvens", "fa-solid fa-cloud"),
        atlasRegiao: t("atlasRegiao", 8, "Desenhar uma Região do Foundry (polígono)", "fa-solid fa-draw-polygon"),
        atlasVec: t("atlasVec", 9, "Edição avançada: rotas, Regiões e paredes (nós, curvas, formas)", "fa-solid fa-bezier-curve")
      });
      tools.atlasPainel = t("atlasPainel", 30, "Abrir ou fechar o painel do Atlas", "fa-solid fa-book-atlas", { button: true, onChange: () => atlas.togglePanel() });
      return {
        name: "atlas", order: 99, title: "Atlas", layer: "atlas", icon: "fa-solid fa-map-location-dot", visible: true, activeTool: "atlasSel",
        onChange: (_event, active) => { if (active) atlasLayer()?.activate(); },
        onToolChange: (_event, tool, active) => { if (active) atlas.onTool(TOOL_MAP[tool.name] ?? "sel"); },
        tools
      };
    }

    _activate() { atlas.onLayer(true); }
    _deactivate() { atlas.onLayer(false); }
    _onClickLeft(event) { atlas.layerClick(event); }
    _onDragLeftStart(event) { atlas.marqueeStart(event); }
    _onDragLeftMove(event) { atlas.marqueeMove(event); }
    _onDragLeftDrop(event) { atlas.marqueeEnd(event); }
    _onDragLeftCancel() { atlas.marqueeCancel(); }
    _onDeleteKey(event) { return atlas.deleteKey(event); }
  }
  CONFIG.Canvas.layers.atlas = { layerClass: AtlasLayer, group: "interface" };
}

/** Segurar o clique com o Atlas ativo: aponta o lugar (aviso com o nome do local mais próximo) além do ping do Foundry. */
export function patchLongPress() {
  const CL = foundry.canvas?.layers?.ControlsLayer; if (!CL || CL.prototype._atlasPatched) return;
  const orig = CL.prototype._onLongPress; CL.prototype._atlasPatched = true;
  CL.prototype._onLongPress = function (event, origin) {
    // só o Ctrl + segurar é do Atlas (mais um destino de viagem); o resto é o ping normal do Foundry
    const ctrl = !!(event?.ctrlKey ?? event?.nativeEvent?.ctrlKey ?? event?.data?.originalEvent?.ctrlKey);
    if (ctrl && atlas.open && mapOf(canvas.scene) && atlas.previewTravel({ x: Math.round(origin.x), y: Math.round(origin.y), name: "ponto escolhido" }, true)) {
      if (event?.interactionData) event.interactionData.cancelled = true; try { canvas.currentMouseManager?.cancel?.(event); } catch (e) { /* */ } return; }
    return orig.call(this, event, origin);
  };
}
