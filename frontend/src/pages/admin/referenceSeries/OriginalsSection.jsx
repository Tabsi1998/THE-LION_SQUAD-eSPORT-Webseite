import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { checkImageFile, imageFromClipboard } from "@/lib/resultImage";
import { MAX_MAP, ORIGINAL_KINDS, hiddenReason, originalLabel, originalSrc, sourceUrlProblem } from "@/lib/referenceOriginals";
import { OriginalViewer } from "@/components/tls/series/OriginalViewer";
import { toast } from "sonner";
import { Check, ImagePlus, Trash2, X } from "lucide-react";

// Original-Bilder des Veranstalters je Termin (#1933) im Ergebnisblatt: Bild hinzufügen (am Handy Kamera oder Galerie),
// hierher ziehen oder mit Strg+V einfügen, je Bild Art, Map-Nummer (Scoreboard), Quellen-Link und „öffentlich / nur
// Verwaltung“. Ein mit der Bild-Erkennung gelesenes Bild steht oben und wird beim Übernehmen des Blatts angehängt.
// Captains ordnen nur eigene Entwürfe ein; freigeben und löschen darf der Vorstand.

const ACCEPT = "image/png,image/jpeg,image/webp";
const SMALL = "w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-2.5 py-1.5 rounded-sm text-sm text-white focus:outline-none disabled:opacity-50";
const LABEL = "text-[10px] font-bold uppercase tracking-widest text-white/45";

/** Ein Bild als Original anhängen - Body ist das Bild selbst (wie beim Lesen). */
export async function attachOriginal(base, file, { kind, origin = "upload", map } = {}) {
  const params = { kind, origin, ...(kind === "scoreboard" && map ? { map } : {}) };
  const { data } = await api.post(base, file, { params, headers: { "Content-Type": file.type || "application/octet-stream" } });
  return data;
}

function KindFields({ kind, map, disabled, onChange, idPrefix }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="block min-w-[9rem]" htmlFor={`${idPrefix}-kind`}>
        <span className={LABEL}>Art</span>
        <select id={`${idPrefix}-kind`} value={kind} disabled={disabled} onChange={(event) => onChange({ kind: event.target.value })} className={SMALL} data-testid="original-kind">
          {ORIGINAL_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {kind === "scoreboard" && (
        <label className="block w-20" htmlFor={`${idPrefix}-map`}>
          <span className={LABEL}>Map</span>
          <select id={`${idPrefix}-map`} value={map || ""} disabled={disabled} onChange={(event) => onChange({ map: event.target.value ? Number(event.target.value) : null })} className={SMALL} data-testid="original-map">
            <option value="">–</option>
            {Array.from({ length: MAX_MAP }, (_, index) => index + 1).map((number) => <option key={number} value={number}>{number}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

function Thumb({ src, label, onOpen }) {
  return (
    <button type="button" onClick={onOpen} disabled={!onOpen} aria-label={`${label} groß zeigen`}
      className="group relative block h-16 w-28 shrink-0 overflow-hidden rounded-sm border border-white/10 bg-black transition active:scale-[0.97] disabled:cursor-default" data-testid="original-thumb">
      {src ? <img src={src} alt="" width={112} height={64} loading="lazy" decoding="async" className="h-full w-full object-cover object-top" /> : null}
    </button>
  );
}

function SourceField({ value, disabled, onSave, idPrefix }) {
  const [text, setText] = useState(value || "");
  useEffect(() => { setText(value || ""); }, [value]);
  const problem = sourceUrlProblem(text);
  const commit = () => {
    if (problem || (text.trim() || null) === (value || null)) return;
    onSave(text.trim());
  };
  return (
    <label className="block min-w-0 flex-1" htmlFor={`${idPrefix}-source`}>
      <span className={LABEL}>Quelle beim Veranstalter (optional)</span>
      <input id={`${idPrefix}-source`} type="url" inputMode="url" value={text} disabled={disabled} placeholder="https://…" maxLength={500}
        onChange={(event) => setText(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); } }}
        aria-invalid={problem ? true : undefined} className={`${SMALL} ${problem ? "!border-red-400/80" : ""}`} data-testid="original-source" />
      {problem && <span className="mt-1 block text-xs text-red-300" role="alert">{problem}</span>}
    </label>
  );
}

function VisibilitySwitch({ value, disabled, onChange }) {
  return (
    <div role="radiogroup" aria-label="Sichtbarkeit" className="inline-flex rounded-sm border border-white/10 p-0.5" data-testid="original-visibility">
      {[[true, "Öffentlich"], [false, "Nur Verwaltung"]].map(([option, label]) => (
        <button key={label} type="button" role="radio" aria-checked={value === option} disabled={disabled} onClick={() => value !== option && onChange(option)}
          className={`rounded-[2px] px-2.5 py-1 text-[11px] font-bold transition-colors disabled:opacity-50 ${value === option ? "bg-[#29B6E8]/15 text-[#29B6E8]" : "text-white/55 hover:text-white"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function OriginalRow({ item, board, onChange, onRelease, onDelete, onOpen, busy }) {
  const [confirming, setConfirming] = useState(false);
  const editable = board || (item.mine && item.state === "draft");
  const reason = hiddenReason(item);
  const id = `original-${item.id}`;
  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start" data-testid="original-row" data-state={item.state} data-shown={item.shown ? "true" : "false"}>
      <Thumb src={originalSrc(item.url, 320)} label={originalLabel(item)} onOpen={onOpen} />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <KindFields kind={item.kind} map={item.map} disabled={!editable || busy} idPrefix={id} onChange={(values) => onChange(values)} />
          <VisibilitySwitch value={item.public !== false} disabled={!editable || busy} onChange={(value) => onChange({ public: value })} />
        </div>
        <SourceField value={item.source_url} disabled={!editable || busy} idPrefix={id} onSave={(value) => onChange({ source_url: value })} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <span className={item.shown ? "text-emerald-300" : "text-white/55"} data-testid="original-status">
            {item.shown ? "Öffentlich zu sehen" : reason}
          </span>
          {item.origin === "reading" && <span className="text-white/40">aus der Bild-Erkennung</span>}
          {board && item.state === "draft" && (
            <button type="button" disabled={busy} onClick={onRelease} className="tls-btn tls-btn--secondary inline-flex items-center gap-1 rounded-sm px-2 py-1 text-[10px] font-bold uppercase tracking-wider disabled:opacity-50" data-testid="original-release">
              <Check className="h-3 w-3" aria-hidden="true" /> Freigeben
            </button>
          )}
          {board && !confirming && (
            <button type="button" disabled={busy} onClick={() => setConfirming(true)} className="tls-btn tls-btn--quiet ml-auto inline-flex items-center gap-1 rounded-sm px-2 py-1 text-[10px] font-bold uppercase tracking-wider disabled:opacity-50" data-testid="original-delete">
              <Trash2 className="h-3 w-3" aria-hidden="true" /> Löschen
            </button>
          )}
          {board && confirming && (
            <span className="ml-auto inline-flex items-center gap-2" role="group" aria-label="Bild löschen?">
              <span className="text-white/70">Endgültig löschen?</span>
              <button type="button" disabled={busy} onClick={() => { setConfirming(false); onDelete(); }} className="tls-btn tls-btn--danger rounded-sm px-2 py-1 text-[10px] font-bold uppercase tracking-wider disabled:opacity-50" data-testid="original-delete-confirm">Löschen</button>
              <button type="button" onClick={() => setConfirming(false)} className="tls-btn tls-btn--quiet rounded-sm px-2 py-1 text-[10px] font-bold uppercase tracking-wider" data-testid="original-delete-cancel">Abbrechen</button>
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

function PendingRow({ pending, onChange, onDrop }) {
  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start" data-testid="original-pending">
      <Thumb src={pending.picture} label="Gelesenes Bild" />
      <div className="min-w-0 flex-1 space-y-2">
        <KindFields kind={pending.kind} map={pending.map} idPrefix="original-pending" onChange={onChange} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <span className="text-[#29B6E8]">Aus dem Bild gelesen – wird beim Übernehmen des Ergebnisses als Original angehängt.</span>
          <button type="button" onClick={onDrop} className="tls-btn tls-btn--quiet ml-auto inline-flex items-center gap-1 rounded-sm px-2 py-1 text-[10px] font-bold uppercase tracking-wider" data-testid="original-pending-drop">
            <X className="h-3 w-3" aria-hidden="true" /> Nicht anhängen
          </button>
        </div>
      </div>
    </li>
  );
}

/**
 * `base`: Adresse der Originale des Termins. `pending`: das gelesene Bild ({file, picture, kind, map}) oder `null`;
 * `onPending` ändert es (`null` heißt: nicht anhängen). `pasteHere`: Strg+V irgendwo im Blatt fügt hier ein (nur, wenn
 * die Bild-Erkennung das Einfügen nicht selbst nimmt).
 */
export function OriginalsSection({ base, defaultKind, board, canPublish, pending = null, onPending, pasteHere = false }) {
  const [data, setData] = useState(null);
  const [uploading, setUploading] = useState([]);
  const [busy, setBusy] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [viewing, setViewing] = useState(null);
  const input = useRef(null);
  const items = Array.isArray(data?.items) ? data.items : [];
  const maxMb = data?.max_mb || 50;
  const kind = data?.default_kind || defaultKind || "other";

  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(base);
      setData(body || {});
    } catch {
      setData({});
    }
  }, [base]);
  useEffect(() => { load(); }, [load]);

  const upload = useCallback(async (files) => {
    for (const file of files) {
      const problem = checkImageFile(file, maxMb);
      if (problem) {
        toast.error(problem);
        continue;
      }
      const key = `${file.name}-${file.size}-${Math.random()}`;
      setUploading((current) => [...current, key]);
      try {
        const item = await attachOriginal(base, file, { kind });
        if (item?.id) setData((current) => ({ ...(current || {}), items: [...(Array.isArray(current?.items) ? current.items : []), item] }));
      } catch (err) {
        toast.error(formatApiError(err.response?.data?.detail) || "Das Bild ließ sich nicht hochladen.");
      } finally {
        setUploading((current) => current.filter((entry) => entry !== key));
      }
    }
  }, [base, kind, maxMb]);

  // Strg+V im ganzen Blatt, wenn die Bild-Erkennung es nicht nimmt (Team-Liga, Turnierserie, Vorlage aus).
  useEffect(() => {
    if (!pasteHere) return undefined;
    const onPaste = (event) => {
      if (event.defaultPrevented) return;
      const target = event.target;
      const typing = target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable);
      if (typing && event.clipboardData?.getData?.("text/plain")) return;
      const file = imageFromClipboard(event);
      if (!file) return;
      event.preventDefault();
      upload([file]);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [pasteHere, upload]);

  const change = async (item, values) => {
    setBusy(item.id);
    try {
      const { data: updated } = await api.patch(`${base}/${item.id}`, values);
      setData((current) => ({ ...current, items: (current?.items || []).map((entry) => (entry.id === item.id ? { ...entry, ...updated } : entry)) }));
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Nicht gespeichert.");
    } finally {
      setBusy(null);
    }
  };
  const remove = async (item) => {
    setBusy(item.id);
    try {
      await api.delete(`${base}/${item.id}`);
      setData((current) => ({ ...current, items: (current?.items || []).filter((entry) => entry.id !== item.id) }));
      toast.success("Bild gelöscht.");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Nicht gelöscht.");
    } finally {
      setBusy(null);
    }
  };

  const onDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer?.files || []).filter((file) => String(file.type || "").startsWith("image/"));
    if (files.length) upload(files);
  };
  const onPaste = (event) => {
    const file = imageFromClipboard(event);
    if (!file) return;
    // Hier eingefügt heißt: als Original - nicht zum Auslesen.
    event.preventDefault();
    upload([file]);
  };

  const count = items.length + (pending ? 1 : 0);
  return (
    <section className={`space-y-2 rounded-sm border p-3 transition-colors ${dragging ? "border-[#29B6E8] bg-[#29B6E8]/[0.06]" : "border-white/10 bg-[#0A0A0A]"}`}
      onDragOver={(event) => { if (Array.from(event.dataTransfer?.types || []).includes("Files")) { event.preventDefault(); setDragging(true); } }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
      onDrop={onDrop} onPaste={onPaste} aria-labelledby="result-originals-title" data-testid="result-originals" data-dragging={dragging ? "true" : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="result-originals-title" className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">
          Original-Bilder{count ? ` · ${count}` : ""}
        </h3>
        <button type="button" onClick={() => input.current?.click()} className="tls-btn tls-btn--quiet inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider" data-testid="original-add">
          <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" /> Bild hinzufügen
        </button>
        <input ref={input} type="file" accept={ACCEPT} multiple className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="original-file"
          onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ""; if (files.length) upload(files); }} />
      </div>
      <p className="text-xs text-white/55">
        Screenshots oder Fotos des Veranstalters als Beleg – hierher ziehen, mit Strg+V einfügen oder hinzufügen (am Handy auch mit der Kamera). PNG, JPG oder WebP bis {maxMb} MB; gespeichert wird ohne Ortsangaben.
        {!board && !canPublish ? " Deine Bilder sind Entwürfe – sie gehen mit dem Ergebnis hinaus, sobald der Vorstand freigibt." : ""}
      </p>
      {count === 0 && uploading.length === 0 ? (
        <div className="rounded-sm border border-dashed border-white/15 px-3 py-5 text-center text-sm text-white/45" data-testid="original-empty">
          Noch keine Original-Bilder zu diesem Termin.
        </div>
      ) : (
        <ul className="divide-y divide-white/5" data-testid="original-list">
          {pending && <PendingRow pending={pending} onChange={(values) => onPending?.({ ...pending, ...values })} onDrop={() => onPending?.(null)} />}
          {items.map((item, index) => (
            <OriginalRow key={item.id} item={item} board={board} busy={busy === item.id}
              onChange={(values) => change(item, values)} onRelease={() => change(item, { release: true })}
              onDelete={() => remove(item)} onOpen={() => setViewing(index)} />
          ))}
          {uploading.map((key) => (
            <li key={key} className="py-3 text-sm text-white/55" role="status" data-testid="original-uploading">Bild wird hochgeladen …</li>
          ))}
        </ul>
      )}
      {viewing !== null && items[viewing] && <OriginalViewer items={items} start={viewing} title="Original-Bilder" onClose={() => setViewing(null)} />}
    </section>
  );
}
