import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Maximize2, Minimize2, X, ZoomIn, ZoomOut } from "lucide-react";
import { API } from "@/lib/api";
import { clampPage, nextZoom, openPdf, viewerErrorText } from "@/lib/pdfViewer";

// Gemeinsamer PDF-Betrachter (#325) für Rechnungen, Statuten, Protokolle: Seiten, Zoom,
// Vollbild, Tastatur, Download nur wenn erlaubt. Das PDF kommt über den API-Client mit
// Anmeldung; nichts wird an einen fremden Betrachter geschickt.

export function DocumentViewer({ path, title, subtitle, downloadPath, onClose, open = openPdf }) {
  const [state, setState] = useState({ loading: true, error: "", pages: 0, sha256: null });
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const canvasRef = useRef(null);
  const documentRef = useRef(null);
  const renderTaskRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: "", pages: 0, sha256: null });
    setPage(1);
    open(path)
      .then((result) => {
        if (cancelled) { result.document?.destroy?.(); return; }
        documentRef.current = result.document;
        setState({ loading: false, error: "", pages: result.pages, sha256: result.sha256 });
      })
      .catch((error) => {
        if (!cancelled) setState({ loading: false, error: viewerErrorText(error), pages: 0, sha256: null });
      });
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel?.();
      documentRef.current?.destroy?.();
      documentRef.current = null;
    };
  }, [open, path]);

  useEffect(() => {
    const document = documentRef.current;
    const canvas = canvasRef.current;
    if (!document || !canvas || state.loading || state.error) return undefined;
    let cancelled = false;
    renderTaskRef.current?.cancel?.();
    document.getPage(page).then((pdfPage) => {
      if (cancelled) return;
      const scale = zoom * (window.devicePixelRatio || 1);
      const viewport = pdfPage.getViewport({ scale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / (window.devicePixelRatio || 1)}px`;
      canvas.style.height = `${viewport.height / (window.devicePixelRatio || 1)}px`;
      const task = pdfPage.render({ canvasContext: canvas.getContext("2d"), viewport });
      renderTaskRef.current = task;
      task.promise?.catch?.(() => {});
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [page, zoom, state.loading, state.error]);

  const go = useCallback((delta) => setPage((current) => clampPage(current + delta, state.pages)), [state.pages]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.target?.tagName === "INPUT" || event.target?.tagName === "TEXTAREA") return;
      if (event.key === "Escape") onClose?.();
      if (event.key === "ArrowRight" || event.key === "PageDown") go(1);
      if (event.key === "ArrowLeft" || event.key === "PageUp") go(-1);
      if (event.key === "+") setZoom((z) => nextZoom(z, 1));
      if (event.key === "-") setZoom((z) => nextZoom(z, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  return (
    <div className={`fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col ${fullscreen ? "" : "p-2 sm:p-6"}`} role="dialog" aria-modal="true" aria-label={title} data-testid="document-viewer">
      <div className="bg-[#121212] border border-white/10 rounded-sm flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="font-heading font-bold truncate" data-testid="document-viewer-title">{title}</div>
            {subtitle && <div className="text-xs text-white/45 truncate">{subtitle}</div>}
          </div>
          <div className="flex items-center gap-1" data-testid="document-viewer-pages">
            <button type="button" onClick={() => go(-1)} disabled={page <= 1} aria-label="Vorherige Seite" className="p-2 text-white/70 hover:text-white disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-xs text-white/70 tabular-nums min-w-[4.5rem] text-center">{state.pages ? `${page} / ${state.pages}` : "–"}</span>
            <button type="button" onClick={() => go(1)} disabled={page >= state.pages} aria-label="Nächste Seite" className="p-2 text-white/70 hover:text-white disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setZoom((z) => nextZoom(z, -1))} aria-label="Verkleinern" className="p-2 text-white/70 hover:text-white"><ZoomOut className="w-4 h-4" /></button>
            <span className="text-xs text-white/70 tabular-nums w-10 text-center" data-testid="document-viewer-zoom">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => setZoom((z) => nextZoom(z, 1))} aria-label="Vergrößern" className="p-2 text-white/70 hover:text-white"><ZoomIn className="w-4 h-4" /></button>
            <button type="button" onClick={() => setFullscreen((value) => !value)} aria-label={fullscreen ? "Vollbild beenden" : "Vollbild"} className="p-2 text-white/70 hover:text-white">{fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}</button>
            {downloadPath && (
              <a href={`${API}${downloadPath}`} download data-testid="document-viewer-download" className="p-2 text-[#FFD700] hover:text-white" aria-label="Herunterladen"><Download className="w-4 h-4" /></a>
            )}
            <button type="button" onClick={onClose} aria-label="Schließen" data-testid="document-viewer-close" className="p-2 text-white/70 hover:text-white"><X className="w-5 h-5" /></button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto bg-[#0A0A0A] flex items-start justify-center p-2 sm:p-4">
          {state.loading && <div className="text-sm text-white/50 py-20" data-testid="document-viewer-loading">Dokument wird geladen …</div>}
          {state.error && (
            <div className="max-w-md text-center py-16 space-y-3" data-testid="document-viewer-error">
              <div className="text-sm text-white/80">{state.error}</div>
              {downloadPath && <a href={`${API}${downloadPath}`} download className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#FFD700]"><Download className="w-3.5 h-3.5" /> Herunterladen</a>}
            </div>
          )}
          {!state.loading && !state.error && <canvas ref={canvasRef} className="bg-white shadow-lg max-w-full" data-testid="document-viewer-canvas" />}
        </div>
        {state.sha256 && <div className="px-3 py-1 text-[10px] text-white/30 font-mono truncate border-t border-white/5" data-testid="document-viewer-hash">Original unverändert · SHA-256 {state.sha256.slice(0, 16)}…</div>}
      </div>
    </div>
  );
}
