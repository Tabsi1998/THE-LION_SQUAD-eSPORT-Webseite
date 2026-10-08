import { Download, Eye, FileText, Pin } from "lucide-react";
import { API } from "@/lib/api";

// Eine Zeile je Dokument - gemeinsam für die Vereinsdokumente im Mitgliederbereich und „Deine Unterlagen“ im Profil
// (#1255). PDFs öffnen im gemeinsamen Betrachter (#325), alles andere in einem neuen Tab.

export const CATEGORY_LABELS = {
  statutes: "Statuten", minutes: "Protokolle", form: "Formular",
  regulations: "Regelwerk", guideline: "Leitlinie", download: "Download",
  media_kit: "Media Kit", presentation: "Präsentation", template: "Vorlage",
  other: "Sonstiges",
  // Dokumentarten der Vereinsakte (#324 Teil 1)
  resolution: "Beschluss", audit_report: "Prüfbericht", account: "Rechnungsabschluss", payout: "Auszahlung",
  letter: "Schreiben", ballot: "Abstimmung",
};

const CATEGORY_COLORS = {
  statutes: "#FFD700", minutes: "#9F7AEA", form: "#29B6E8",
  regulations: "#FF3B30", guideline: "#10B981", download: "#29B6E8",
  media_kit: "#FFD700", presentation: "#9F7AEA", template: "#10B981", other: "#6B7280",
  resolution: "#9F7AEA", audit_report: "#FF3B30", account: "#10B981", payout: "#10B981", letter: "#29B6E8", ballot: "#FFD700",
};

function fmtSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function DocumentGroup({ label, docs, onView }) {
  return (
    <div>
      {label && <div className="text-[11px] uppercase tracking-widest text-white/40 font-bold mb-3">{label}</div>}
      <div className="space-y-2">
        {docs.map((d) => <DocumentRow key={d.id} d={d} onView={onView} />)}
      </div>
    </div>
  );
}

export function DocumentRow({ d, onView }) {
  const c = CATEGORY_COLORS[d.category] || "#29B6E8";
  const isPdf = /pdf$/i.test(d.mime || "") || /\.pdf$/i.test(d.original_filename || "");
  return (
    <div data-testid={`doc-row-${d.id}`} className="border border-white/10 hover:border-white/25 rounded-sm bg-[#121212] p-4 flex flex-col sm:flex-row sm:items-center gap-4 transition">
      <div className="w-12 h-12 shrink-0 rounded-sm flex items-center justify-center" style={{ background: `${c}15`, border: `1px solid ${c}40` }}>
        <FileText className="w-5 h-5" style={{ color: c }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: c }}>{CATEGORY_LABELS[d.category] || d.category}</span>
          {d.source === "dolibarr" && <span className="text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded-sm border border-white/15 text-white/55" data-testid={`doc-source-${d.id}`}>{d.personal ? "Vereinsakte · nur für dich" : "Vereinsakte"}</span>}
          {d.pinned && <Pin className="w-3 h-3 text-[#FFD700]" />}
        </div>
        <div className="font-heading font-bold text-white mt-0.5">{d.title}</div>
        {d.description && <div className="text-xs text-white/55 mt-1 line-clamp-2">{d.description}</div>}
        <div className="mt-2 flex items-center gap-3 text-[10px] text-white/40 uppercase tracking-wider">
          {d.original_filename && <span>{d.original_filename}</span>}
          {d.file_size && <span>{fmtSize(d.file_size)}</span>}
          {d.view_count > 0 && <span>{d.view_count} Ansichten</span>}
          {d.allow_download && d.download_count > 0 && <span>{d.download_count} Downloads</span>}
        </div>
      </div>
      {isPdf ? (
        <button
          type="button"
          onClick={() => onView(d)}
          data-testid={`doc-view-${d.id}`}
          className="w-full sm:w-auto justify-center shrink-0 inline-flex items-center gap-2 px-4 py-2 bg-[#FFD700]/15 hover:bg-[#FFD700]/25 text-[#FFD700] border border-[#FFD700]/40 font-bold uppercase tracking-wider text-xs rounded-sm transition"
        >
          <Eye className="w-3.5 h-3.5" /> Ansehen
        </button>
      ) : (
        <a
          href={`${API}/documents/${d.id}/view`}
          target="_blank"
          rel="noreferrer"
          data-testid={`doc-view-${d.id}`}
          className="w-full sm:w-auto justify-center shrink-0 inline-flex items-center gap-2 px-4 py-2 bg-[#FFD700]/15 hover:bg-[#FFD700]/25 text-[#FFD700] border border-[#FFD700]/40 font-bold uppercase tracking-wider text-xs rounded-sm transition"
        >
          <Eye className="w-3.5 h-3.5" /> Ansehen
        </a>
      )}
      {d.allow_download && (
        <a
          href={`${API}/documents/${d.id}/download`}
          target="_blank"
          rel="noreferrer"
          data-testid={`doc-download-${d.id}`}
          className="w-full sm:w-auto justify-center shrink-0 inline-flex items-center gap-2 px-3 py-2 border border-white/15 text-white/60 hover:text-white font-bold uppercase tracking-wider text-xs rounded-sm transition"
        >
          <Download className="w-3.5 h-3.5" /> Download
        </a>
      )}
    </div>
  );
}
