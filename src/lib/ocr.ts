import { errorMessage } from "./utils";

export interface ExtractResult {
  text: string;
  kind: "txt" | "pdf" | "image";
  notes: string[];
  fileName: string;
}

type ProgressCallback = (percent: number, message: string) => void;

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((module) => {
      module.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      return module;
    });
  }
  return pdfjsPromise;
}

interface TesseractWorkerLike {
  recognize: (image: string | Blob | HTMLCanvasElement) => Promise<{
    data: { text: string; confidence: number };
  }>;
  terminate: () => Promise<unknown>;
}

let workerPromise: Promise<TesseractWorkerLike> | null = null;
let activeProgress: ProgressCallback | null = null;

function assetUrl(path: string): string {
  const base = new URL(import.meta.env.BASE_URL || "/", window.location.href);
  return new URL(path, base).href;
}

async function createOcrWorker(): Promise<TesseractWorkerLike> {
  const { createWorker } = await import("tesseract.js");
  const logger = (message: { status?: string; progress?: number }) => {
    if (!activeProgress) return;
    activeProgress(Math.round((message.progress ?? 0) * 100), message.status ?? "인식 중");
  };

  try {
    return (await createWorker("kor+eng", 1, {
      workerPath: assetUrl("tesseract/worker.min.js"),
      corePath: assetUrl("tesseract"),
      langPath: assetUrl("tessdata"),
      logger,
    })) as unknown as TesseractWorkerLike;
  } catch (localError) {
    // Fallback: use the CDN worker when bundled assets are unavailable.
    try {
      return (await createWorker("kor+eng", 1, { logger })) as unknown as TesseractWorkerLike;
    } catch {
      throw new Error(
        `OCR 엔진을 불러오지 못했습니다. 이미지를 확인하거나 텍스트를 직접 입력해 주세요. (${errorMessage(
          localError,
        )})`,
      );
    }
  }
}

async function getOcrWorker(): Promise<TesseractWorkerLike> {
  if (!workerPromise) {
    workerPromise = createOcrWorker().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

export async function terminateOcr(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise.catch(() => null);
  workerPromise = null;
  await worker?.terminate().catch(() => undefined);
}

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

async function renderPdfPageToCanvas(
  page: { getViewport: (options: { scale: number }) => { width: number; height: number }; render: (params: unknown) => { promise: Promise<void> } },
  scale = 2,
): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("캔버스를 생성할 수 없습니다.");
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  return canvas;
}

async function extractPdf(
  file: File,
  onProgress?: ProgressCallback,
): Promise<ExtractResult> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({ data }).promise;
  const notes: string[] = [];
  const pageTexts: string[] = [];
  const maxPages = Math.min(document.numPages, 20);

  for (let index = 1; index <= maxPages; index += 1) {
    onProgress?.(Math.round((index / maxPages) * 40), `PDF ${index}/${maxPages} 페이지 텍스트 추출`);
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      if ("str" in item) {
        text += item.str;
        if (item.hasEOL) text += "\n";
      }
    }
    pageTexts.push(text.trim());
  }

  const extracted = pageTexts.join("\n\n").trim();
  const averagePerPage = extracted.length / maxPages;

  if (averagePerPage > 40) {
    return { text: extracted, kind: "pdf", notes, fileName: file.name };
  }

  // Likely a scanned PDF: OCR the rendered pages.
  notes.push("PDF에서 텍스트를 찾지 못해 이미지 OCR로 인식했습니다. 인식 결과를 확인해 주세요.");
  onProgress?.(45, "스캔 PDF 이미지 변환 중");
  const worker = await getOcrWorker();
  const ocrPages: string[] = [];
  const ocrLimit = Math.min(document.numPages, 8);
  for (let index = 1; index <= ocrLimit; index += 1) {
    const page = await document.getPage(index);
    const canvas = await renderPdfPageToCanvas(page as never, 2);
    onProgress?.(
      45 + Math.round((index / ocrLimit) * 50),
      `스캔 PDF OCR ${index}/${ocrLimit} 페이지`,
    );
    const result = await worker.recognize(canvas);
    ocrPages.push(result.data.text.trim());
    if (result.data.confidence < 70) {
      notes.push(
        `${index}페이지 OCR 신뢰도가 낮습니다 (${Math.round(
          result.data.confidence,
        )}%). 인식이 애매한 부분을 직접 수정해 주세요.`,
      );
    }
  }
  return { text: ocrPages.join("\n\n"), kind: "pdf", notes, fileName: file.name };
}

/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */

async function extractImage(
  file: File,
  onProgress?: ProgressCallback,
): Promise<ExtractResult> {
  onProgress?.(10, "OCR 준비 중");
  const worker = await getOcrWorker();
  activeProgress = onProgress ?? null;
  onProgress?.(35, "이미지에서 글자 인식 중");
  const result = await worker.recognize(file);
  const notes: string[] = [];
  if (result.data.confidence < 75) {
    notes.push(
      `OCR 인식 신뢰도가 낮습니다 (${Math.round(
        result.data.confidence,
      )}%). 밑줄·손글씨·흐린 부분은 직접 수정해 주세요.`,
    );
  }
  const text = result.data.text.trim();
  if (!text) {
    notes.push("인식된 텍스트가 없습니다. 이미지 품질을 확인하거나 직접 입력해 주세요.");
  }
  return { text, kind: "image", notes, fileName: file.name };
}

export async function extractTextFromFile(
  file: File,
  onProgress?: ProgressCallback,
): Promise<ExtractResult> {
  activeProgress = onProgress ?? null;
  const lower = file.name.toLowerCase();
  try {
    if (lower.endsWith(".pdf") || file.type === "application/pdf") {
      return await extractPdf(file, onProgress);
    }
    if (
      lower.endsWith(".png") ||
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg") ||
      lower.endsWith(".webp") ||
      file.type.startsWith("image/")
    ) {
      return await extractImage(file, onProgress);
    }
    const text = await file.text();
    return { text, kind: "txt", notes: [], fileName: file.name };
  } finally {
    activeProgress = null;
  }
}

export const ACCEPTED_PASSAGE_FILES =
  ".txt,.pdf,.png,.jpg,.jpeg,.webp,text/plain,application/pdf,image/png,image/jpeg,image/webp";
