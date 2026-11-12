import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Download, ExternalLink, FileArchive, ImagePlus, Link2, Loader2, Trash2 } from "lucide-react";
import { api, uploadApi } from "@/lib/api";
import { chatAttachmentSrc } from "@/lib/chatAttachments";

// Nachweise zu einem Bezug (#2360): mehrere Bilder und Video-Links zu einer Meldung, einem Vorfall, einem Protest, einer
// Stellungnahme oder zu MOSS. Wiederverwendbar - D.5 (Vorfälle) und E.2 (Proteste) setzen den Baustein in ihre Abläufe.
// Der Server entscheidet, wer was sieht und wer hinzufügen oder entfernen darf (services/match_proofs); hier wird nur
// gezeigt, was er liefert. Ein Video ist immer nur ein Link, der in einem neuen Tab aufgeht - nie eingebettet.
// `sideLabels`: Namen der Seiten je Anmeldung, etwa { "reg-1": "Rudel A" }; ohne sie steht „Eigene Seite“ / „Gegenseite“.

const ACCEPT = "image/png,image/jpeg,image/webp";
const BUTTON = "tls-btn tls-btn--secondary inline-flex min-h-[44px] items-center gap-2 px-3 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50";

function errorText(error, fallback) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string" && detail) return detail;
  if (error?.response?.status === 413) return "Die Datei ist zu groß.";
  return fallback;
}

// MOSS-Datei (#2297): die ZIP, wie MOSS sie schreibt - nur am Bezug „moss“, nur zum Herunterladen.
const ZIP_ACCEPT = ".zip,application/zip,application/x-zip-compressed";

function sizeText(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toLocaleString("de-AT", { maximumFractionDigits: 1 })} MB`;
  return `${Math.max(1, Math.round(value / 1024)).toLocaleString("de-AT")} KB`;
}

function linkLabel(link) {
  try {
    const url = new URL(link);
    const rest = `${url.pathname === "/" ? "" : url.pathname}${url.search}`;
    return `${url.hostname}${rest.length > 40 ? `${rest.slice(0, 40)}…` : rest}`;
  } catch {
    return String(link || "");
  }
}

function sideName(item, sideLabels) {
  if (!item.side) return "Leitung";
  return sideLabels?.[item.side] || (item.own_side ? "Eigene Seite" : "Gegenseite");
}

function ProofItem({ item, sideLabels, testId, confirming, busy, onRemove }) {
  const waiting = item.type === "image" && item.own && ["pending", "review"].includes(item.scan_state);
  return (
    <li className="flex items-center gap-3 rounded-sm border border-white/10 bg-[#0A0A0A] p-2" data-testid={`${testId}-item-${item.id}`}>
      {item.type === "link" || item.type === "file" ? (
        <span className="flex h-14 w-20 shrink-0 items-center justify-center rounded-sm bg-white/5 text-white/50">
          {item.type === "file" ? <FileArchive className="w-5 h-5" /> : <Link2 className="w-5 h-5" />}
        </span>
      ) : (
        <a href={chatAttachmentSrc(item.url)} target="_blank" rel="noreferrer" className="block h-14 w-20 shrink-0 overflow-hidden rounded-sm bg-white/5">
          <img src={chatAttachmentSrc(item.url, 400)} alt="Nachweis als Bild" className="h-full w-full object-cover" loading="lazy" />
        </a>
      )}
      <div className="min-w-0 flex-1 text-xs">
        {item.type === "link" ? (
          <a href={item.link} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-full items-center gap-1 text-[#29B6E8] hover:underline" data-testid={`${testId}-link-${item.id}`}>
            <span className="truncate">{linkLabel(item.link)}</span>
            <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="sr-only">(öffnet in neuem Tab)</span>
          </a>
        ) : item.type === "file" ? (
          <a href={chatAttachmentSrc(item.url)} download className="inline-flex max-w-full items-center gap-1 text-[#29B6E8] hover:underline" data-testid={`${testId}-file-${item.id}`}>
            <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">MOSS-Datei (ZIP, {sizeText(item.size)}) herunterladen</span>
          </a>
        ) : <span className="text-white/70">Bild</span>}
        {item.type === "file" && item.sha256 ? <div className="truncate font-mono text-[10px] text-white/40" title={item.sha256}>SHA-256 {item.sha256}</div> : null}
        <div className="text-white/50">{sideName(item, sideLabels)}{item.removed ? " · von der Seite entfernt, nur noch für die Leitung sichtbar" : ""}{waiting ? " · wird noch geprüft, bis dahin nur für dich sichtbar" : ""}</div>
      </div>
      {item.can_remove ? (
        <button type="button" disabled={busy} onClick={() => onRemove(item)} aria-label={confirming ? "Wirklich entfernen" : "Nachweis entfernen"}
          className={`shrink-0 min-h-[44px] px-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50 ${confirming ? "text-[#FF6B60]" : "text-white/50 hover:text-white"}`}
          data-testid={`${testId}-remove-${item.id}`}>
          {confirming ? (item.kind === "moss" ? "Wirklich entfernen? Die Leitung sieht ihn weiter." : "Wirklich entfernen?") : <Trash2 className="w-4 h-4" />}
        </button>
      ) : null}
    </li>
  );
}

/** Was als Nachweis zählt (Regelwerk § 10.6) - ein Bereich mit mehreren Listen zeigt den Satz einmal selbst (`hint={false}`). */
export function proofHintText(limit = 10) {
  return `Auf Bildern und Videos muss die Ingame-Uhr oder ein anderer Zeitstempel zu sehen sein. Videos gibst du als Link an (nur https, etwa ungelistet hochgeladen), mindestens 720p und 15 Sekunden; bei mehr als zwei Minuten schreib die Zeitstellen dazu (Regelwerk § 10.6). Höchstens ${limit} Nachweise je Seite.`;
}

/** Wer die Nachweise eines Bezugs sieht - ein Bereich mit mehreren Listen sagt es einmal selbst (`hint={false}`). */
export function proofAudienceText(kind) {
  return kind === "moss"
    ? "MOSS-Nachweise sehen nur du, Captain und Vertreter deiner Seite und die Leitung – nie die Gegenseite. Entfernst du einen, bleibt er für die Leitung sichtbar, bis das Verfahren endet."
    : "Nachweise sehen nur die beiden Seiten dieses Spiels und die Leitung.";
}

export function ProofList({ matchId, kind, refId = "", title = "Nachweise", sideLabels = null, testId = "proof-list", onChanged = null, hint = true }) {
  const [state, setState] = useState({ status: "loading", data: null });
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState(null);
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);
  const zipRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/matches/${matchId}/proofs`, { params: { kind, ref_id: refId } });
      setState({ status: "ready", data });
    } catch {
      setState({ status: "error", data: null });
    }
  }, [matchId, kind, refId]);

  useEffect(() => {
    setState({ status: "loading", data: null });
    load();
  }, [load]);

  const send = async (fill, fallback, client = api) => {
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("kind", kind);
      form.append("ref_id", refId);
      fill(form);
      await client.post(`/matches/${matchId}/proofs`, form);
      await load();
      onChanged?.();
      return true;
    } catch (failure) {
      setError(errorText(failure, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addFile = (fileList) => {
    const file = fileList?.[0];
    if (file) send((form) => form.append("file", file), "Hochladen hat nicht geklappt.");
  };

  // Die MOSS-ZIP (#2297) kann bis 200 MB groß sein: über den Upload-Host, an der 100-MB-Grenze von Cloudflare vorbei.
  const addZip = (fileList) => {
    const file = fileList?.[0];
    if (file) send((form) => form.append("file", file), "Die MOSS-Datei ließ sich nicht hochladen.", uploadApi);
  };

  const addLink = async (event) => {
    event.preventDefault();
    const value = link.trim();
    if (!value) return setError("Bitte einen Link angeben.");
    if (!/^https:\/\//i.test(value)) return setError("Nur Links mit https:// sind erlaubt.");
    if (await send((form) => form.append("link", value), "Der Link ließ sich nicht hinzufügen.")) setLink("");
    return undefined;
  };

  const remove = async (item) => {
    if (confirmId !== item.id) return setConfirmId(item.id);
    setBusy(true);
    setError("");
    try {
      await api.delete(`/matches/${matchId}/proofs/${item.id}`);
      await load();
      onChanged?.();
    } catch (failure) {
      setError(errorText(failure, "Entfernen hat nicht geklappt."));
    } finally {
      setConfirmId(null);
      setBusy(false);
    }
    return undefined;
  };

  const data = state.data;
  const items = data?.items || [];

  return (
    <section className="space-y-2" data-testid={testId} aria-busy={state.status === "loading" || busy}>
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">{title}</div>
      {state.status === "loading" ? <p className="flex items-center gap-2 text-xs text-white/50"><Loader2 className="w-4 h-4 animate-spin" /> Nachweise werden geladen …</p> : null}
      {state.status === "error" ? (
        <p className="text-xs text-white/60" role="alert" data-testid={`${testId}-load-error`}>
          Die Nachweise ließen sich nicht laden. <button type="button" onClick={load} className="underline hover:text-white">Noch einmal versuchen</button>
        </p>
      ) : null}
      {state.status === "ready" ? (
        <>
          {items.length ? (
            <ul className="space-y-2" data-testid={`${testId}-items`}>
              {items.map((item) => (
                <ProofItem key={item.id} item={item} sideLabels={sideLabels} testId={testId} confirming={confirmId === item.id} busy={busy} onRemove={remove} />
              ))}
            </ul>
          ) : <p className="text-xs text-white/50" data-testid={`${testId}-empty`}>Noch keine Nachweise.</p>}
          {data.can_add ? (
            <div className="space-y-2" data-testid={`${testId}-add`}>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => cameraRef.current?.click()} className={`${BUTTON} md:hidden`} data-testid={`${testId}-camera`}>
                  <Camera className="w-4 h-4" /> Foto aufnehmen
                </button>
                <button type="button" disabled={busy} onClick={() => galleryRef.current?.click()} className={BUTTON} data-testid={`${testId}-gallery`}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />} Bild hinzufügen
                </button>
                {kind === "moss" ? (
                  <button type="button" disabled={busy} onClick={() => zipRef.current?.click()} className={BUTTON} data-testid={`${testId}-zip`}>
                    <FileArchive className="w-4 h-4" /> MOSS-Datei (ZIP) hochladen
                  </button>
                ) : null}
              </div>
              {kind === "moss" ? (
                <input ref={zipRef} type="file" accept={ZIP_ACCEPT} className="hidden" onChange={(event) => { addZip(event.target.files); event.target.value = ""; }} data-testid={`${testId}-zip-input`} />
              ) : null}
              <form onSubmit={addLink} className="flex flex-wrap gap-2" noValidate>
                <label className="sr-only" htmlFor={`${testId}-link`}>Link zum Video</label>
                <input id={`${testId}-link`} type="url" inputMode="url" value={link} onChange={(event) => setLink(event.target.value)} maxLength={data.link_max_length || 500}
                  placeholder="Link zum Video (https://…)" className="input min-h-[44px] min-w-[12rem] flex-1" data-testid={`${testId}-link-input`} />
                <button disabled={busy} className={BUTTON} data-testid={`${testId}-link-add`}><Link2 className="w-4 h-4" /> Link hinzufügen</button>
              </form>
              <input ref={cameraRef} type="file" accept={ACCEPT} capture="environment" className="hidden" onChange={(event) => { addFile(event.target.files); event.target.value = ""; }} data-testid={`${testId}-camera-input`} />
              <input ref={galleryRef} type="file" accept={ACCEPT} className="hidden" onChange={(event) => { addFile(event.target.files); event.target.value = ""; }} data-testid={`${testId}-input`} />
              {hint ? <p className="text-xs text-white/50" data-testid={`${testId}-hint`}>{proofHintText(data.limit)}</p> : null}
            </div>
          ) : (
            <p className="text-xs text-white/50" data-testid={`${testId}-closed`}>
              {data.open ? "Hier kannst du keine Nachweise hinzufügen." : "Abgeschlossen – die Nachweise lassen sich nicht mehr ändern."}
            </p>
          )}
          {hint ? <p className="text-xs text-white/50" data-testid={`${testId}-audience`}>{proofAudienceText(kind)}</p> : null}
        </>
      ) : null}
      {error ? <p className="text-sm text-[#FF6B60]" role="alert" data-testid={`${testId}-error`}>{error}</p> : null}
    </section>
  );
}
