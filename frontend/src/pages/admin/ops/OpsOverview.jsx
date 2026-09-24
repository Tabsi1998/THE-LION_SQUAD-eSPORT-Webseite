import { useCallback, useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { EventRow, formatEventTime, sourceIcon } from "./OpsEventsTab";

// Überblick (#517 Teil 2): je Quelle eine Karte mit Zähler und Auffälligkeiten (ein Klick öffnet die
// Ereignisliste mit dieser Quelle), darunter die neuesten Probleme der letzten sieben Tage.

export function OpsOverview({ onOpenSource }) {
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data: payload } = await api.get("/admin/ops/events", { params: { severity: "problem", hours: 168, limit: 8 } });
      setData(payload && Array.isArray(payload.items) ? payload : { items: [], sources: [] });
    } catch {
      setData((current) => current || { items: [], sources: [] });
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["admin/ops", "admin/logs", "mobile-logs"]);

  const sources = data?.sources || [];
  const problems = data?.items || [];

  return (
    <div className="space-y-6" data-testid="ops-overview">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {sources.map((item) => {
          const Icon = sourceIcon(item.key);
          const problemCount = Number(item.problem_count || 0);
          return (
            <button key={item.key} type="button" onClick={() => onOpenSource(item.key)} data-testid={`ops-overview-source-${item.key}`}
              className={`rounded-sm border p-4 text-left transition hover:border-[#29B6E8]/55 ${problemCount > 0 ? "border-[#FFD700]/35 bg-[#FFD700]/5" : "border-white/10 bg-[#121212]"}`}>
              <div className="flex items-start justify-between gap-3">
                <Icon className="h-5 w-5 text-[#29B6E8]" />
                {problemCount > 0 ? (
                  <span className="rounded-sm border border-[#FFD700]/35 bg-[#FFD700]/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-[#FFD700]">{problemCount} auffällig</span>
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-[#00FF88]" />
                )}
              </div>
              <div className="mt-4 text-[10px] font-bold uppercase tracking-widest text-white/45">{item.label}</div>
              <div className="mt-1 font-heading text-2xl font-black tabular-nums text-white">{item.total || 0}</div>
              <div className="mt-1 text-[11px] text-white/40">{item.latest_at ? formatEventTime(item.latest_at) : "Noch keine Einträge"}</div>
            </button>
          );
        })}
      </div>

      <section>
        <h2 className="font-heading text-lg font-black uppercase mb-3">Neueste Probleme (7 Tage)</h2>
        <div className="space-y-3" data-testid="ops-overview-problems">
          {problems.map((row) => <EventRow key={`${row.source}-${row.id}-${row.time}`} row={row} />)}
          {data && !problems.length && (
            <div className="rounded-sm border border-white/10 bg-[#121212] p-6 text-center text-white/50 inline-flex w-full items-center justify-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-[#00FF88]" /> Keine Fehler oder Warnungen in den letzten sieben Tagen.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
