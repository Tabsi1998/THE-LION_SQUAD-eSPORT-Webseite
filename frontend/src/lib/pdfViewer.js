import { api, formatRequestError } from "@/lib/api";

// PDF-Betrachter (#325): ein Dokument wird über den API-Client geladen (mit Anmeldung) und
// mit pdf.js gezeichnet – lokal ausgeliefert, samt Worker. Nichts geht an einen fremden
// Betrachter, und die Bytes bleiben, wie der Server sie liefert.

export const ZOOM_STEPS = [0.6, 0.8, 1, 1.25, 1.5, 2, 3];

let pdfjsPromise = null;

/** pdf.js erst laden, wenn jemand wirklich ein Dokument öffnet – die Bibliothek ist groß. */
export function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

/** Bytes vom Server holen: Anmeldung, Token-Erneuerung und 403/404 wie bei jedem Aufruf. */
export async function fetchPdfBytes(path) {
  const { data, headers } = await api.get(path, { responseType: "arraybuffer", skipInvalidation: true });
  return { bytes: new Uint8Array(data), sha256: headers?.["x-content-sha256"] || null };
}

export async function openPdf(path, { loader = loadPdfJs, fetcher = fetchPdfBytes } = {}) {
  const [pdfjs, { bytes, sha256 }] = await Promise.all([loader(), fetcher(path)]);
  const document = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
  return { document, pages: document.numPages, sha256 };
}

export function nextZoom(current, direction) {
  const index = ZOOM_STEPS.findIndex((step) => Math.abs(step - current) < 0.001);
  const at = index === -1 ? ZOOM_STEPS.indexOf(1) : index;
  return ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, at + direction))];
}

export function clampPage(page, total) {
  if (!total) return 1;
  return Math.max(1, Math.min(total, Number(page) || 1));
}

/** Was in Worten dasteht, wenn ein Dokument nicht aufgeht. */
export function viewerErrorText(error) {
  const status = error?.response?.status;
  if (status === 401) return "Deine Anmeldung ist abgelaufen. Melde dich neu an, dann geht es weiter.";
  if (status === 403) return "Dieses Dokument ist für dich nicht (mehr) freigegeben.";
  if (status === 404) return "Dieses Dokument gibt es nicht mehr.";
  if (status === 503) return formatRequestError(error, "Die Mitgliederverwaltung antwortet gerade nicht. Bitte später noch einmal.");
  if (error?.name === "InvalidPDFException" || /pdf/i.test(String(error?.message || "")) && /invalid|corrupt/i.test(String(error?.message || ""))) {
    return "Diese Datei lässt sich nicht als PDF lesen. Lade sie herunter und öffne sie mit einem PDF-Programm.";
  }
  return formatRequestError(error, "Das Dokument konnte nicht geladen werden.");
}
