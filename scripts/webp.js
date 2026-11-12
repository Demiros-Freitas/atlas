// Imagens enviadas ao Foundry (PNG, JPEG, BMP, TIFF) viram WebP antes de subir: ficam bem mais leves e carregam mais rápido.
const MODULE_ID = "brumas-atlas";
const KINDS = /^image\/(png|jpeg|bmp|tiff)$/i;
const MAX_SIDE = 16383; // limite do formato WebP

const on = () => { try { return game.settings.get(MODULE_ID, "webpUpload") !== false; } catch (e) { return true; } };
const quality = () => { try { return Math.min(1, Math.max(0.5, Number(game.settings.get(MODULE_ID, "webpQuality")) || 0.86)); } catch (e) { return 0.86; } };
const mb = (n) => `${(n / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;

/** Converte um arquivo de imagem em WebP; devolve null quando não compensa (ou não dá). */
export async function toWebp(file, q = quality()) {
  if (!(file instanceof Blob) || !KINDS.test(file.type || "")) return null;
  const bmp = await createImageBitmap(file); const { width: w, height: h } = bmp;
  try {
    if (!w || !h || w > MAX_SIDE || h > MAX_SIDE) return null;
    let blob;
    if (typeof OffscreenCanvas !== "undefined") { const c = new OffscreenCanvas(w, h); c.getContext("2d").drawImage(bmp, 0, 0); blob = await c.convertToBlob({ type: "image/webp", quality: q }); }
    else { const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(bmp, 0, 0); blob = await new Promise(r => c.toBlob(r, "image/webp", q)); }
    if (!blob || blob.type !== "image/webp" || blob.size >= file.size) return null;
    const name = String(file.name || "imagem").replace(/\.[^./\\]+$/, "") + ".webp";
    return new File([blob], name, { type: "image/webp", lastModified: Date.now() });
  } finally { bmp.close?.(); }
}

/** Embrulha o envio de arquivos do Foundry: toda imagem pesada sobe já em WebP. */
export function hookWebpUpload() {
  const base = foundry.applications?.apps?.FilePicker ?? globalThis.FilePicker;
  const impl = base?.implementation ?? CONFIG?.ux?.FilePicker;
  for (const C of new Set([base, impl].filter(Boolean))) {
    if (!Object.prototype.hasOwnProperty.call(C, "upload") || C.upload.__atlasWebp) continue;
    const orig = C.upload;
    const wrapped = async function (source, path, file, body = {}, options = {}) {
      if (on() && file instanceof File && KINDS.test(file.type || "")) {
        try { const w = await toWebp(file); if (w) { if (options?.notify !== false) globalThis.ui?.notifications?.info(`Atlas · ${file.name} enviada como WebP (${mb(file.size)} → ${mb(w.size)}).`); file = w; } }
        catch (e) { console.warn(`${MODULE_ID} | WebP: enviando o original`, e); }
      }
      return orig.call(this, source, path, file, body, options);
    };
    wrapped.__atlasWebp = true; C.upload = wrapped;
  }
}
