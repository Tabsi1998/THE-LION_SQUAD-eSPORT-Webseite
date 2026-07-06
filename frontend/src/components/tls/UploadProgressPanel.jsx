import { AlertTriangle, CheckCircle2, Clock, UploadCloud } from "lucide-react";

function fmtBytes(value) {
  const n = Number(value || 0);
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}

export function UploadProgressPanel({ progress, className = "" }) {
  if (!progress?.active) return null;
  const filePercent = progress.totalBytes ? clampPercent((progress.loaded / progress.totalBytes) * 100) : 0;
  const inFlight = progress.status === "uploading" && progress.currentName ? filePercent / 100 : 0;
  const overallPercent = progress.total ? clampPercent(((progress.completed + inFlight) / progress.total) * 100) : 0;
  const remaining = Math.max((progress.total || 0) - (progress.completed || 0) - (progress.failed || 0), 0);
  const done = progress.status === "done";
  const hasFailures = (progress.failed || 0) > 0;
  const Icon = done ? (hasFailures ? AlertTriangle : CheckCircle2) : UploadCloud;

  return (
    <div className={`border border-white/10 bg-[#0A0A0A] rounded-sm p-4 shadow-sm shadow-black/30 ${className}`} data-testid="upload-progress">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.24em] text-[#29B6E8]">
            <Icon className={`h-4 w-4 ${done && !hasFailures ? "text-[#00FF88]" : hasFailures ? "text-[#FFD700]" : "text-[#29B6E8]"}`} />
            Upload
          </div>
          <div className="mt-2 truncate font-heading text-lg font-black uppercase text-white">
            {done ? "Upload abgeschlossen" : progress.currentName || "Medien werden hochgeladen"}
          </div>
          <div className="mt-1 text-xs text-white/45">
            {progress.phase || "Upload läuft"}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-heading text-2xl font-black tabular-nums text-white">{Math.round(overallPercent)}%</div>
          <div className="text-[10px] uppercase tracking-widest text-white/40">{progress.completed || 0}/{progress.total || 0}</div>
        </div>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-sm bg-white/10">
        <div className={`h-full transition-all duration-300 ${hasFailures ? "bg-[#FFD700]" : "bg-[#29B6E8]"}`} style={{ width: `${overallPercent}%` }} />
      </div>

      <div className="mt-3 grid gap-2 text-xs text-white/55 sm:grid-cols-4">
        <div className="rounded-sm border border-white/10 bg-white/[0.03] px-3 py-2">
          <div className="text-[9px] font-bold uppercase tracking-widest text-white/35">Erledigt</div>
          <div className="mt-1 font-bold text-white">{progress.completed || 0}</div>
        </div>
        <div className="rounded-sm border border-white/10 bg-white/[0.03] px-3 py-2">
          <div className="text-[9px] font-bold uppercase tracking-widest text-white/35">Offen</div>
          <div className="mt-1 font-bold text-white">{remaining}</div>
        </div>
        <div className="rounded-sm border border-white/10 bg-white/[0.03] px-3 py-2">
          <div className="text-[9px] font-bold uppercase tracking-widest text-white/35">Speed</div>
          <div className="mt-1 font-bold text-white">{progress.speedBps ? `${fmtBytes(progress.speedBps)}/s` : done ? "-" : "..."}</div>
        </div>
        <div className="rounded-sm border border-white/10 bg-white/[0.03] px-3 py-2">
          <div className="text-[9px] font-bold uppercase tracking-widest text-white/35">Aktuell</div>
          <div className="mt-1 font-bold text-white">
            {progress.totalBytes ? `${fmtBytes(progress.loaded)} / ${fmtBytes(progress.totalBytes)}` : progress.originals ? `${progress.originals} Originale` : "-"}
          </div>
        </div>
      </div>

      {(progress.failed > 0 || progress.status === "uploading") && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-wider text-white/45">
          {progress.status === "uploading" && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> Datei {Math.min((progress.currentIndex || 0) + 1, progress.total || 1)} von {progress.total || 1}</span>}
          {progress.failed > 0 && <span className="text-[#FFD700]">{progress.failed} fehlgeschlagen</span>}
          {progress.originals > 0 && <span>{progress.originals} Originaldatei(en)</span>}
        </div>
      )}
    </div>
  );
}
