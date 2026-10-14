import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { asInstant, viennaDateTime } from "@/lib/vienna";

// Datei-Nacharbeit (#1046): Dateien, deren Löschung scheiterte (Kontolöschung, Mediathek). Der Aufräum-Job
// versucht es stündlich mit wachsendem Abstand und gibt nach der Grenze auf. Hier stehen die Einträge ohne
// Konto; „Erneut versuchen“ gibt aufgegebenen eine neue Runde und versucht alles Offene sofort.

const SOURCE_LABELS = { account_erasure: "Kontolöschung", media_library: "Mediathek" };

function formatTime(value) {
  if (!value) return "–";
  const date = asInstant(value);
  return Number.isNaN(date.getTime()) ? String(value) : viennaDateTime(date);
}

export function FileCleanupsPanel({ onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: next } = await api.get("/admin/ops/file-cleanups");
      setData(next && next.counts ? next : null);
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Datei-Nacharbeit konnte nicht geladen werden.");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const items = data?.items || [];
  if (!data || !items.length) return null;

  const retry = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data: next } = await api.post("/admin/ops/file-cleanups/retry");
      setData(next);
      toast.success(`${next.removed ?? 0} Dateien gelöscht, ${next.counts?.pending ?? 0} offen, ${next.counts?.failed ?? 0} aufgegeben.`);
      onChanged?.();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Erneut versuchen hat nicht geklappt.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm" data-testid="ops-file-cleanups">
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 border-b border-white/5">
        <div>
          <div className="font-bold">Datei-Nacharbeit</div>
          <div className="text-[11px] text-white/45">
            {data.counts.pending} offen · {data.counts.failed} aufgegeben (nach {data.retry_limit} Versuchen) · erst die Rechte am Upload-Volume prüfen
          </div>
        </div>
        <button
          type="button"
          onClick={retry}
          disabled={busy}
          data-testid="ops-file-cleanups-retry"
          className="inline-flex items-center gap-2 border border-[#29B6E8]/40 bg-[#29B6E8]/10 text-[#29B6E8] px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50"
        >
          <RotateCcw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} /> Erneut versuchen
        </button>
      </div>
      <div className="divide-y divide-white/5">
        {items.map((item) => (
          <div key={item.filename} className="p-3 text-sm" data-testid={`ops-file-cleanup-${item.filename}`}>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-mono text-xs break-all">{item.filename}</span>
              <span className={item.status === "failed" ? "text-[#FF6B61] font-bold" : "text-[#FFD95A]"}>
                {item.status === "failed" ? "aufgegeben" : "offen"}
              </span>
              <span className="text-white/45 text-xs">{SOURCE_LABELS[item.source] || item.source}</span>
            </div>
            <div className="text-[11px] text-white/45">
              {item.attempts} Versuche · {item.last_error || "–"} · {item.status === "failed" ? `aufgegeben ${formatTime(item.failed_at)}` : `nächster Versuch ${formatTime(item.next_attempt_at)}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
