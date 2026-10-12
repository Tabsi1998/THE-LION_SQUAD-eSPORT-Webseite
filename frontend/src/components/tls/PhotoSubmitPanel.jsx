import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Loader2, Send, X } from "lucide-react";
import { api } from "@/lib/api";
import { pickSubmissionFiles, submissionDoneText, submissionHint, SUBMISSION_ACCEPT } from "@/lib/photoSubmission";

// Fotos vom Event einsenden (#1186): im Album eines Events für Mitglieder, bis eine Woche nach dem Event. Fotos aus der
// Galerie oder vom PC, am Handy auch direkt mit der Kamera. Ohne den Haken „einverstanden“ geht nichts hinaus. Die Fotos
// erscheinen erst, wenn der Vorstand sie in Admin → Galerie freigibt - der Server speichert sie neu (ohne Ort und
// Kamera-Daten) und schickt sie durch die Bildprüfung.

function errorText(error) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string" && detail) return detail;
  if (error?.response?.status === 413) return "Das Bild ist zu groß.";
  return "Hochladen hat nicht geklappt.";
}

export function PhotoSubmitPanel({ album, info, onSent }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [skipped, setSkipped] = useState([]);
  const [consent, setConsent] = useState(false);
  const [credit, setCredit] = useState(true);
  const [sending, setSending] = useState(null);
  const [done, setDone] = useState("");
  const [errors, setErrors] = useState([]);
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);
  // Vorschauen leben, solange die Datei gewählt ist - beim Entfernen, nach dem Senden und beim Verlassen frei.
  const previews = useRef(new Set());

  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const release = (entries) => entries.forEach((entry) => {
    URL.revokeObjectURL(entry.preview);
    previews.current.delete(entry.preview);
  });

  if (!info) return null;
  const hint = submissionHint(info);
  if (!info.can_submit && !done) {
    return hint ? <p className="mt-4 text-sm text-white/50" data-testid="photo-submit-closed">{hint}</p> : null;
  }

  const remaining = Math.max(0, (info.remaining || 0) - files.length);

  const add = (list) => {
    const result = pickSubmissionFiles(list, remaining);
    const added = result.accepted.map((file) => ({ file, preview: URL.createObjectURL(file) }));
    added.forEach((entry) => previews.current.add(entry.preview));
    setFiles((current) => [...current, ...added]);
    setSkipped(result.skipped);
    setDone("");
    setErrors([]);
  };

  const remove = (index) => {
    release([files[index]]);
    setFiles((current) => current.filter((_, at) => at !== index));
  };

  const send = async () => {
    if (!consent || !files.length) return;
    let sent = 0;
    const failed = [];
    for (let index = 0; index < files.length; index += 1) {
      setSending({ at: index + 1, of: files.length });
      const form = new FormData();
      form.append("file", files[index].file);
      form.append("consent", "true");
      form.append("credit", credit ? "true" : "false");
      try {
        await api.post(`/gallery/${album.slug || album.id}/submissions`, form);
        sent += 1;
      } catch (error) {
        failed.push(`${files[index].file.name}: ${errorText(error)}`);
      }
    }
    setSending(null);
    release(files);
    setFiles([]);
    setConsent(false);
    setErrors(failed);
    setDone(submissionDoneText(sent, failed.length));
    if (sent) onSent?.();
  };

  return (
    <div className="mt-6 rounded-sm border border-white/10 bg-[#121212] p-4" data-testid="photo-submit">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-heading font-black uppercase">Warst du dabei?</div>
          {hint ? <div className="text-xs text-white/55" data-testid="photo-submit-hint">{hint}</div> : null}
        </div>
        {!open && info.can_submit ? (
          <button type="button" onClick={() => setOpen(true)} className="tls-btn tls-btn--primary inline-flex min-h-[44px] items-center gap-2 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider" data-testid="photo-submit-open">
            <ImagePlus className="w-4 h-4" /> Fotos einsenden
          </button>
        ) : null}
      </div>
      {done ? <p className="mt-3 text-sm text-[#7EE2A8]" role="status" data-testid="photo-submit-done">{done}</p> : null}
      {errors.length ? (
        <ul className="mt-2 space-y-1 text-xs text-[#FF6B60]" data-testid="photo-submit-errors">
          {errors.map((line) => <li key={line}>{line}</li>)}
        </ul>
      ) : null}
      {open && info.can_submit ? (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => cameraRef.current?.click()} disabled={!remaining || !!sending} className="tls-btn tls-btn--secondary inline-flex min-h-[44px] items-center gap-2 rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider md:hidden" data-testid="photo-submit-camera">
              <Camera className="w-4 h-4" /> Foto aufnehmen
            </button>
            <button type="button" onClick={() => galleryRef.current?.click()} disabled={!remaining || !!sending} className="tls-btn tls-btn--secondary inline-flex min-h-[44px] items-center gap-2 rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider" data-testid="photo-submit-pick">
              <ImagePlus className="w-4 h-4" /> Fotos wählen
            </button>
            <input ref={cameraRef} type="file" accept={SUBMISSION_ACCEPT} capture="environment" className="hidden" onChange={(event) => { add(event.target.files); event.target.value = ""; }} data-testid="photo-submit-camera-input" />
            <input ref={galleryRef} type="file" accept={SUBMISSION_ACCEPT} multiple className="hidden" onChange={(event) => { add(event.target.files); event.target.value = ""; }} data-testid="photo-submit-input" />
          </div>
          {files.length ? (
            <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6" data-testid="photo-submit-files">
              {files.map((entry, index) => (
                <li key={entry.preview} className="relative aspect-square overflow-hidden rounded-sm bg-white/5">
                  <img src={entry.preview} alt={entry.file.name} className="h-full w-full object-cover" />
                  {!sending ? (
                    <button type="button" onClick={() => remove(index)} aria-label={`${entry.file.name} entfernen`} className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white/80 hover:text-white">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {skipped.length ? (
            <ul className="space-y-1 text-xs text-[#FFD700]" data-testid="photo-submit-skipped">
              {skipped.map((entry) => <li key={entry.name}>{entry.name}: {entry.reason}</li>)}
            </ul>
          ) : null}
          <label className="flex items-start gap-3 text-sm text-white/80">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1 h-4 w-4 accent-[#29B6E8]" data-testid="photo-submit-consent" />
            <span>Die Personen auf den Fotos sind einverstanden, dass die Bilder in der Galerie erscheinen.</span>
          </label>
          <label className="flex items-start gap-3 text-sm text-white/80">
            <input type="checkbox" checked={credit} onChange={(event) => setCredit(event.target.checked)} className="mt-1 h-4 w-4 accent-[#29B6E8]" data-testid="photo-submit-credit" />
            <span>Mit meinem Namen zeigen („Foto: …“)</span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={send} disabled={!consent || !files.length || !!sending} className="tls-btn tls-btn--primary inline-flex min-h-[44px] items-center gap-2 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider" data-testid="photo-submit-send">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {sending ? `Sende ${sending.at} von ${sending.of} …` : files.length ? `${files.length} ${files.length === 1 ? "Foto" : "Fotos"} senden` : "Senden"}
            </button>
            <span className="text-xs text-white/45">Die Fotos erscheinen erst nach der Freigabe durch den Vorstand.</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
