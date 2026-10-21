import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { checkImageFile, imageFromClipboard, imageHeader, isUncertain, openImageRows, uncertainText } from "@/lib/resultImage";
import { toast } from "sonner";
import { Check, Maximize2, Minimize2, ScanText, X } from "lucide-react";

// Ergebnis-Bild auslesen (#1756) im Ergebnis-Blatt: Knopf „Bild auslesen“ (am Handy Datei oder Kamera), Strg+V mit einem
// Bild in der Zwischenablage, der Lesestand mit dem Bild und danach die Übersicht „Aus dem Bild gelesen“. Die Zeilen
// landen in der Liste des Blatts; gelbe Felder sind unsicher, bis jemand sie ändert oder „Passt so“ drückt.

const ACCEPT = "image/png,image/jpeg,image/webp";

function pictureUrl(file) {
  try {
    return typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null;
  } catch {
    return null;
  }
}

/** Zustand und Abläufe: was der Server kann, Lesen, Strg+V. `onRead(result)` bekommt die Antwort des Servers. */
export function useResultImage({ base, onRead }) {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [picture, setPicture] = useState(null);
  const busyRef = useRef(false);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  useEffect(() => {
    let alive = true;
    api.get(`${base}/image`).then(({ data }) => { if (alive) setInfo(data || null); }).catch(() => { if (alive) setInfo(null); });
    return () => { alive = false; };
  }, [base]);

  // Das Bild lebt nur im Browser (für den Vergleich beim Prüfen) und geht mit dem Blatt.
  useEffect(() => () => { if (picture && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(picture); }, [picture]);

  const read = useCallback(async (file) => {
    if (busyRef.current) return;
    const problem = checkImageFile(file, info?.max_mb);
    if (problem) {
      toast.error(problem);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setResult(null);
    setPicture(pictureUrl(file));
    try {
      const { data } = await api.post(`${base}/image`, file, { headers: { "Content-Type": file.type || "application/octet-stream" } });
      setResult(data);
      onReadRef.current?.(data);
    } catch (err) {
      setPicture(null);
      toast.error(formatApiError(err.response?.data?.detail) || "Das Bild ließ sich nicht lesen.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [base, info]);

  const available = Boolean(info?.available);
  useEffect(() => {
    if (!available) return undefined;
    const onPaste = (event) => {
      // Text in ein Feld einfügen bleibt Text – auch wenn die Zwischenablage (etwa aus Excel) zusätzlich ein Bild hat.
      const target = event.target;
      const typing = target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable);
      if (typing && event.clipboardData?.getData?.("text/plain")) return;
      const file = imageFromClipboard(event);
      if (!file) return;
      event.preventDefault();
      read(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [available, read]);

  const dismiss = useCallback(() => {
    setResult(null);
    setPicture(null);
  }, []);
  return { available, info, busy, result, picture, read, dismiss };
}

/** Knopf „Bild auslesen“ mit verstecktem Dateifeld – am Handy bietet das Feld Kamera und Galerie an. */
export function ResultImageButton({ image }) {
  const input = useRef(null);
  if (!image.available) return null;
  return (
    <>
      <button type="button" onClick={() => input.current?.click()} disabled={image.busy} data-testid="result-image-pick"
        title="Screenshot des Veranstalters auslesen – oder das Bild mit Strg+V einfügen"
        className="tls-btn tls-btn--quiet px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5 disabled:opacity-50">
        <ScanText className="w-3.5 h-3.5" /> {image.busy ? "Liest …" : "Bild auslesen"}
      </button>
      <span className="hidden sm:inline text-[11px] text-white/40" data-testid="result-image-paste-hint">
        oder <kbd className="px-1 py-px rounded-[3px] border border-white/15 bg-white/5 font-sans text-[10px] text-white/60">Strg</kbd>+<kbd className="px-1 py-px rounded-[3px] border border-white/15 bg-white/5 font-sans text-[10px] text-white/60">V</kbd>
      </span>
      <input ref={input} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="result-image-file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) image.read(file);
        }} />
    </>
  );
}

function Picture({ src, large, reading }) {
  if (!src) return null;
  return (
    <div className={`relative overflow-hidden rounded-sm border border-white/10 bg-black ${large ? "w-full" : "w-24 sm:w-32 shrink-0"} ${reading ? "tls-ocr-scan" : ""}`} data-testid="result-image-picture">
      <img src={src} alt="Das eingefügte Ergebnis-Bild" width={large ? 960 : 128} className={`block w-full ${large ? "max-h-[70vh] object-contain" : "h-20 sm:h-24 object-cover object-top"}`} />
    </div>
  );
}

/** Lesestand und danach die Übersicht: Vorlage, Kopf des Bilds, wie viele Zeilen gelb sind, Hinweise. */
export function ResultImageSummary({ image, rows }) {
  const [large, setLarge] = useState(false);
  if (image.busy) {
    return (
      <div className="flex items-center gap-3 border border-[#29B6E8]/30 bg-[#29B6E8]/5 rounded-sm p-3" data-testid="result-image-reading" role="status" aria-live="polite">
        <Picture src={image.picture} reading />
        <p className="text-sm text-white/75">Bild wird gelesen – das dauert ein paar Sekunden.</p>
      </div>
    );
  }
  const result = image.result;
  if (!result) return null;
  const open = openImageRows(rows);
  const header = imageHeader(result);
  return (
    <section className={`border rounded-sm p-3 space-y-3 ${open ? "border-amber-400/40 bg-amber-400/[0.06]" : "border-[#29B6E8]/30 bg-[#29B6E8]/5"}`} data-testid="result-image-summary" aria-live="polite">
      <div className="flex items-start gap-3">
        {!large && (
          <button type="button" onClick={() => setLarge(true)} disabled={!image.picture} aria-label="Bild groß zeigen" className="group relative shrink-0 rounded-sm transition active:scale-[0.97] disabled:cursor-default" data-testid="result-image-enlarge">
            <Picture src={image.picture} />
            {image.picture && <Maximize2 className="absolute right-1 top-1 w-3.5 h-3.5 text-white/70 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />}
          </button>
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Aus dem Bild gelesen</h3>
            <button type="button" onClick={image.dismiss} aria-label="Übersicht schließen" data-testid="result-image-dismiss" className="-m-1 p-1 rounded-sm text-white/45 hover:text-white transition active:scale-[0.97]"><X className="w-4 h-4" /></button>
          </div>
          <p className="text-sm text-white/80 tabular-nums" data-testid="result-image-counts">
            {result.rows.length} {result.rows.length === 1 ? "Zeile" : "Zeilen"} in die Liste übernommen
            {result.template?.name ? <span className="text-white/45"> · Vorlage {result.template.name}</span> : null}
          </p>
          {header.length > 0 && (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs" data-testid="result-image-header">
              {header.map((item) => (
                <div key={item.key} className="contents">
                  <dt className="text-white/45">{item.label}</dt>
                  <dd className={`break-words ${item.uncertain ? "text-amber-200" : "text-white/80"}`} data-uncertain={item.uncertain || undefined}>
                    {item.value}{item.uncertain ? <span className="text-amber-300/80"> · unsicher</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
      {large && (
        <div className="space-y-1.5">
          <Picture src={image.picture} large />
          <button type="button" onClick={() => setLarge(false)} className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-white/55 hover:text-white transition" data-testid="result-image-shrink">
            <Minimize2 className="w-3.5 h-3.5" /> Bild klein
          </button>
        </div>
      )}
      <p className={`text-xs ${open ? "text-amber-100" : "text-white/60"}`} data-testid="result-image-status">
        {open
          ? `${open === 1 ? "1 Zeile ist" : `${open} Zeilen sind`} gelb: mit dem Bild vergleichen, korrigieren oder mit „Passt so“ bestätigen. Übernehmen geht erst danach.`
          : "Alles sicher gelesen – bitte trotzdem kurz mit dem Bild vergleichen, bevor ihr übernehmt."}
      </p>
      {(result.warnings || []).length > 0 && (
        <ul className="space-y-0.5 text-xs text-amber-200" data-testid="result-image-warnings">
          {result.warnings.map((item) => <li key={item.code}>{item.message}</li>)}
        </ul>
      )}
    </section>
  );
}

/** Unter einer gelben Zeile: was unsicher ist, was im Bild stand, und „Passt so“. */
export function ResultImageRowNote({ row, onConfirm }) {
  if (!row.ocr?.uncertain?.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-amber-200" data-testid="result-row-ocr">
      <span className="min-w-0">Aus dem Bild unsicher: {uncertainText(row)}</span>
      <button type="button" onClick={onConfirm} data-testid="result-row-ocr-confirm"
        className="tls-btn tls-btn--quiet px-2 py-1 rounded-sm text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1">
        <Check className="w-3 h-3" /> Passt so
      </button>
    </div>
  );
}

/** Gelbe Markierung eines Felds: Klasse und Attribute für das Eingabefeld. */
export function ocrMark(row, field, index = 0) {
  if (!isUncertain(row, field)) return { className: "", props: {} };
  return {
    className: "!border-amber-400/80 !bg-amber-400/10",
    props: { "data-ocr-uncertain": field, title: "Aus dem Bild – bitte prüfen", style: { "--tls-ocr-delay": `${Math.min(index, 20) * 40}ms` } },
  };
}
