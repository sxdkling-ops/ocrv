import { createWorker } from "tesseract.js";
import * as pdfjsLib from "pdfjs-dist";
import UTIFImport from "utif";

// ✅ Normalize UTIF export for Vite/ESM/CJS
const UTIF = UTIFImport?.default ?? UTIFImport;

// PDF.js worker setup (Vite-friendly)
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const OCR_LANG = "eng";

// ---------- Tesseract Worker (reuse = faster + better control) ----------
let workerPromise = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker(OCR_LANG);

      // Default params (good for most documents)
      await worker.setParameters({
        // 6 = block of text, 4 = columns, 11 = sparse/table-ish
        tessedit_pageseg_mode: "6",
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      });

      return worker;
    })();
  }
  return workerPromise;
}

// Optional: call this when your app closes/unmounts
export async function terminateOcrWorker() {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}

// ---------- Image preprocessing (biggest OCR boost) ----------
function preprocessCanvas(
  srcCanvas,
  {
    upscale = 1.7, // 1.0 = none, 1.5-2.0 helps small text
    contrast = 35, // 0-60 typical
    threshold = 165, // 0-255 tune per docs
    grayscale = true,
    sharpen = true,
    invert = false, // set true if white text on black background
  } = {},
) {
  const w = Math.max(1, Math.floor(srcCanvas.width * upscale));
  const h = Math.max(1, Math.floor(srcCanvas.height * upscale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D context not available.");

  // draw scaled
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(srcCanvas, 0, 0, w, h);

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  // contrast math
  const c = contrast / 100 + 1; // contrast factor
  const intercept = 128 * (1 - c);

  // grayscale + contrast + threshold
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i],
      g = d[i + 1],
      b = d[i + 2];

    if (grayscale) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = g = b = gray;
    }

    r = r * c + intercept;
    g = g * c + intercept;
    b = b * c + intercept;

    let v = (r + g + b) / 3 >= threshold ? 255 : 0;
    if (invert) v = 255 - v;

    d[i] = d[i + 1] = d[i + 2] = v;
    // alpha stays
  }

  ctx.putImageData(img, 0, 0);

  // simple sharpen kernel: [0 -1 0; -1 5 -1; 0 -1 0]
  if (sharpen) {
    const id = ctx.getImageData(0, 0, w, h);
    const out = ctx.createImageData(w, h);
    const src = id.data;
    const dst = out.data;

    const idx = (x, y) => (y * w + x) * 4;

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = idx(x, y);
        for (let ch = 0; ch < 3; ch++) {
          const v =
            5 * src[i + ch] -
            src[idx(x - 1, y) + ch] -
            src[idx(x + 1, y) + ch] -
            src[idx(x, y - 1) + ch] -
            src[idx(x, y + 1) + ch];

          dst[i + ch] = Math.max(0, Math.min(255, v));
        }
        dst[i + 3] = src[i + 3];
      }
    }
    ctx.putImageData(out, 0, 0);
  }

  return canvas;
}

// basic scoring to pick best OCR pass
function scoreOcrText(text = "") {
  const t = text.trim();
  if (!t) return 0;
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  const digits = (t.match(/[0-9]/g) || []).length;
  const bad = (t.match(/[�]/g) || []).length;
  return letters + digits - bad * 5 + Math.min(200, t.length / 5);
}

async function canvasToOcrText(
  canvas,
  {
    // tweak these per file type
    preprocess = { upscale: 1.7, contrast: 35, threshold: 165, sharpen: true },
    psmPrimary = "6",
    psmFallback = "11",
    whitelist = null, // ex: "0123456789.,:/-()ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz "
    onProgress = null,
  } = {},
) {
  const worker = await getWorker();

  const cleaned = preprocessCanvas(canvas, preprocess);

  // 1) primary pass
  await worker.setParameters({
    tessedit_pageseg_mode: String(psmPrimary),
    ...(whitelist ? { tessedit_char_whitelist: whitelist } : {}),
  });

  onProgress?.({ stage: "ocr", pass: 1, psm: String(psmPrimary) });
  const r1 = await worker.recognize(cleaned);
  const t1 = r1?.data?.text || "";

  // 2) fallback pass (often helps tables / sparse text)
  await worker.setParameters({
    tessedit_pageseg_mode: String(psmFallback),
    ...(whitelist ? { tessedit_char_whitelist: whitelist } : {}),
  });

  onProgress?.({ stage: "ocr", pass: 2, psm: String(psmFallback) });
  const r2 = await worker.recognize(cleaned);
  const t2 = r2?.data?.text || "";

  return scoreOcrText(t2) > scoreOcrText(t1) ? t2 : t1;
}

async function fileToArrayBuffer(file) {
  return await file.arrayBuffer();
}

/** 1) PDF -> render each page -> OCR */
export async function ocrPdf(file, onProgress) {
  const ab = await fileToArrayBuffer(file);
  const pdf = await pdfjsLib.getDocument({ data: ab }).promise;

  const allText = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    onProgress?.({ stage: "pdf", page: pageNum, totalPages: pdf.numPages });

    const page = await pdf.getPage(pageNum);

    // 📌 bump scale for sharper text (watch memory on huge pages)
    const viewport = page.getViewport({ scale: 3.0 });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas 2D context not available.");

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    const text = await canvasToOcrText(canvas, {
      preprocess: { upscale: 1.6, contrast: 35, threshold: 165, sharpen: true },
      psmPrimary: "6",
      psmFallback: "11",
      // If your PDFs are mostly numeric statements, whitelist helps a LOT:
      // whitelist: "0123456789.,:/-()ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ",
      onProgress,
    });

    allText.push(text.trim());
  }

  return allText.filter(Boolean).join("\n\n--- PAGE BREAK ---\n\n");
}

/** 2) TIFF -> decode pages -> OCR (works with UTIF v2 and v3+) */
export async function ocrTiff(file, onProgress) {
  const ab = await fileToArrayBuffer(file);

  if (typeof UTIF?.decode !== "function") {
    throw new Error("UTIF.decode is not available. UTIF import failed.");
  }
  if (typeof UTIF?.toRGBA8 !== "function") {
    throw new Error("UTIF.toRGBA8 is not available. UTIF import failed.");
  }

  const ifds = UTIF.decode(ab);
  if (!ifds || ifds.length === 0) {
    throw new Error("TIFF decode failed: no pages (IFDs) found.");
  }

  const hasDecodeImages = typeof UTIF.decodeImages === "function";
  const hasDecodeImage = typeof UTIF.decodeImage === "function";

  if (!hasDecodeImages && !hasDecodeImage) {
    throw new Error(
      "UTIF decode function not found (need decodeImages or decodeImage).",
    );
  }

  if (hasDecodeImages) {
    UTIF.decodeImages(ab, ifds);
  }

  const allText = [];

  for (let i = 0; i < ifds.length; i++) {
    onProgress?.({ stage: "tiff", page: i + 1, totalPages: ifds.length });

    const page = ifds[i];

    if (!hasDecodeImages && hasDecodeImage) {
      UTIF.decodeImage(ab, page);
    }

    const w = page.width;
    const h = page.height;
    if (!w || !h)
      throw new Error(`TIFF page ${i + 1} has invalid dimensions (${w}x${h}).`);

    let rgba;
    try {
      rgba = UTIF.toRGBA8(page);
    } catch (e) {
      throw new Error(`TIFF page ${i + 1} toRGBA8 failed: ${e?.message || e}`);
    }
    if (!rgba || rgba.length === 0)
      throw new Error(`TIFF page ${i + 1} produced empty pixel data.`);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas 2D context not available.");

    const imgData = new ImageData(new Uint8ClampedArray(rgba), w, h);
    ctx.putImageData(imgData, 0, 0);

    const text = await canvasToOcrText(canvas, {
      preprocess: { upscale: 1.8, contrast: 40, threshold: 165, sharpen: true },
      psmPrimary: "6",
      psmFallback: "11",
      onProgress,
    });

    allText.push(text.trim());
  }

  return allText.filter(Boolean).join("\n\n--- PAGE BREAK ---\n\n");
}

/** 3) Regular images -> OCR */
export async function ocrImage(file, onProgress) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas 2D context not available.");
    ctx.drawImage(img, 0, 0);

    const text = await canvasToOcrText(canvas, {
      preprocess: { upscale: 1.7, contrast: 35, threshold: 165, sharpen: true },
      psmPrimary: "6",
      psmFallback: "11",
      onProgress,
    });

    return text;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Router function */
export async function ocrAny(file, onProgress) {
  const t = file.type;

  if (t === "application/pdf") return await ocrPdf(file, onProgress);

  if (
    t === "image/tiff" ||
    t === "image/tif" ||
    file.name.toLowerCase().endsWith(".tif") ||
    file.name.toLowerCase().endsWith(".tiff")
  ) {
    return await ocrTiff(file, onProgress);
  }

  return await ocrImage(file, onProgress);
}
