import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { chatAttachmentSrc } from "@/lib/chatAttachments";
import { viennaDateTime } from "@/lib/vienna";

// Streitfall für die Turnierleitung (#1158): Meldung mit Grund, Foto und das eingetragene Ergebnis - entschieden wird
// mit einem Tipp. „Ergebnis bleibt“ (ohne Ergebnis: „Weiter wie bisher“) schließt den Dispute; „Ergebnis ändern“
// öffnet das Ergebnis-Fenster (Korrektur mit Grund im Protokoll). Beide Seiten bekommen die Entscheidung.

function clock(value) {
  if (!value) return "";
  try {
    return viennaDateTime(value, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function Photo({ photo, label }) {
  if (!photo?.url) return null;
  const src = chatAttachmentSrc(photo.url);
  return (
    <a href={src} target="_blank" rel="noreferrer" className="block w-32 overflow-hidden rounded-sm border border-white/10" data-testid="dispute-photo-link">
      <img src={chatAttachmentSrc(photo.url, 400)} alt={label} className="h-20 w-full object-cover" loading="lazy" />
    </a>
  );
}

export function DisputeCard({ item, busy = false, highlighted = false, onKeep, onChange }) {
  const [note, setNote] = useState("");
  const dispute = item?.dispute;
  if (!dispute) return null;
  const hasResult = Boolean(item.has_result);
  return (
    <div className={`rounded-sm border bg-[#121212] p-4 space-y-3 ${highlighted ? "border-[#FFD700]/70 ring-2 ring-[#FFD700]/40" : "border-[#FF3B30]/40"}`} data-testid={`lead-dispute-${item.id}`} id={`fall-ds-${item.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#FFD700]">Gemeldet von {dispute.by}{dispute.at ? ` · ${clock(dispute.at)}` : ""}</div>
          <div className="mt-1 flex items-center gap-2 font-heading text-lg font-black uppercase"><AlertTriangle className="w-4 h-4 text-[#FF6B60]" /> {dispute.category_label}</div>
          <div className="text-xs text-white/50 truncate">{item.stage_name ? `${item.stage_name} · ` : ""}{item.label}</div>
        </div>
      </div>
      {dispute.text ? <p className="text-sm text-white/80">„{dispute.text}“</p> : null}
      <Photo photo={dispute.photo} label="Foto zur Meldung" />
      {hasResult ? (
        <div className="text-xs text-white/60" data-testid={`lead-dispute-result-${item.id}`}>
          Eingetragen: <strong className="text-white">{item.result_summary}</strong>
          {dispute.result_by ? ` · von ${dispute.result_by}` : ""}{dispute.result_at ? ` um ${clock(dispute.result_at)}` : ""}
        </div>
      ) : <div className="text-xs text-white/50">Noch kein Ergebnis eingetragen.</div>}
      {(dispute.reports || []).length ? (
        <div className="space-y-1">
          {dispute.reports.map((report) => (
            <div key={`${report.by}-${report.at}`} className="text-xs text-white/55">Meldung von {report.by}: <strong className="text-white/80">{report.summary}</strong></div>
          ))}
        </div>
      ) : null}
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="input" placeholder="Begründung (freiwillig, geht an beide Seiten)" data-testid={`lead-dispute-note-${item.id}`} />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={busy} onClick={() => onKeep(note.trim() || null)} className="tls-btn tls-btn--secondary min-h-[44px] px-3 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50" data-testid={`lead-dispute-keep-${item.id}`}>
          {hasResult ? "Ergebnis bleibt" : "Weiter wie bisher"}
        </button>
        <button type="button" disabled={busy || !item.can_enter} onClick={onChange} className="tls-btn tls-btn--primary min-h-[44px] px-3 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50" data-testid={`lead-dispute-change-${item.id}`}>
          {hasResult ? "Ergebnis ändern" : "Ergebnis eintragen"}
        </button>
      </div>
      <p className="text-center text-[11px] text-white/45">Beide Seiten bekommen die Entscheidung als Benachrichtigung.</p>
    </div>
  );
}
