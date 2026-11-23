import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCheck, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { EventRow, LoadError, formatEventTime, sourceIcon, useOpsAck } from "./OpsEventsTab";

// Überblick (#517 Teil 2): je Quelle eine Karte mit Zähler und Auffälligkeiten (ein Klick öffnet die
// Ereignisliste mit dieser Quelle), darunter die offenen Probleme.
//
// Quittieren (#2447): „auffällig“ zählt nur Offenes - weder quittiert noch von selbst behoben (Auto-Check wieder grün,
// Alarm mit Gegenstück). Ein Tipp auf eine auffällige Karte öffnet genau diese Einträge (`state=open`). Jeder offene
// Eintrag lässt sich quittieren, alle auf einmal mit Rückfrage; ist nichts mehr offen, steht da „Alles erledigt“.

const PROBLEM_LIMIT = 20;

export function OpsOverview({ onOpenSource }) {
  const [data, setData] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const listRef = useRef(null);
  const headingRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data: payload } = await api.get("/admin/ops/events", { params: { severity: "problem", hours: 0, limit: PROBLEM_LIMIT, state: "open" } });
      setData(payload && Array.isArray(payload.items) ? payload : { items: [], sources: [] });
      setLoadFailed(false);
    } catch {
      // Ladefehler (Review #2447, N1): eigener Zustand, nie „Alles erledigt“.
      setLoadFailed(true);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["admin/ops", "admin/logs", "mobile-logs"]);
  const { ack, ackAll, acking } = useOpsAck(load, { listRef, headingRef });

  const sources = data?.sources || [];
  const problems = data?.items || [];
  const openTotal = sources.reduce((sum, item) => sum + Number(item.problem_count || 0), 0);

  return (
    <div className="space-y-6" data-testid="ops-overview">
      <div className="grid gap-3 grid-cols-2 xl:grid-cols-5">
        {sources.map((item) => {
          const Icon = sourceIcon(item.key);
          const problemCount = Number(item.problem_count || 0);
          return (
            <button key={item.key} type="button" onClick={() => onOpenSource(item.key, problemCount > 0 ? { state: "open" } : {})} data-testid={`ops-overview-source-${item.key}`}
              aria-label={`${item.label}: ${problemCount > 0 ? `${problemCount} auffällig – offene Einträge zeigen` : "nichts offen – Ereignisse zeigen"}`}
              className={`min-h-[44px] min-w-0 rounded-sm border p-4 text-left transition hover:border-[#29B6E8]/55 ${problemCount > 0 ? "border-[#FFD700]/35 bg-[#FFD700]/5" : "border-white/10 bg-[#121212]"}`}>
              <div className="flex min-h-[26px] items-start justify-between gap-2">
                <Icon className="h-5 w-5 shrink-0 text-[#29B6E8]" />
                {problemCount > 0 ? (
                  <span className="rounded-sm border border-[#FFD700]/35 bg-[#FFD700]/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-[#FFD700] tabular-nums">{problemCount} auffällig</span>
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-ok" />
                )}
              </div>
              <div className="mt-4 tls-wrap text-[10px] font-bold uppercase tracking-widest text-white/45">{item.label}</div>
              <div className="mt-1 font-heading text-2xl font-black tabular-nums text-white">{item.total || 0}</div>
              <div className="mt-1 tls-wrap text-[11px] text-white/40">{item.latest_at ? formatEventTime(item.latest_at) : "Noch keine Einträge"}</div>
            </button>
          );
        })}
      </div>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 ref={headingRef} tabIndex={-1} className="font-heading text-lg font-black uppercase focus:outline-none" data-testid="ops-overview-heading">Offene Probleme</h2>
          {openTotal > 0 && (
            <button type="button" onClick={() => ackAll({ count: openTotal, until: data?.as_of, label: "Alle Quellen" })} disabled={!!acking} data-testid="ops-overview-ack-all"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-sm border border-ok/40 bg-ok/10 px-3 text-xs font-bold uppercase tracking-wider text-ok hover:bg-ok/15 disabled:opacity-40">
              <CheckCheck className="h-4 w-4" /> {acking === "all" ? "Quittiere …" : `Alle quittieren (${openTotal})`}
            </button>
          )}
        </div>
        <div className="space-y-3" data-testid="ops-overview-problems" ref={listRef}>
          {problems.map((row) => <EventRow key={`${row.source}-${row.id}-${row.time}`} row={row} onAck={ack} acking={acking === row.id} />)}
          {openTotal > problems.length && problems.length > 0 && (
            <button type="button" onClick={() => onOpenSource("all", { state: "open" })} data-testid="ops-overview-more"
              className="inline-flex min-h-[44px] w-full items-center justify-center rounded-sm border border-white/10 bg-[#121212] px-3 text-xs font-bold uppercase tracking-wider text-white/60 hover:border-[#29B6E8]/50 hover:text-[#29B6E8]">
              Alle {openTotal} offenen ansehen
            </button>
          )}
          {loadFailed && !problems.length && <LoadError onRetry={load} testId="ops-overview-error" />}
          {data && !loadFailed && !problems.length && (
            <div className="rounded-sm border border-ok/20 bg-ok/5 p-8 text-center" data-testid="ops-overview-done">
              <CheckCircle2 className="mx-auto h-8 w-8 text-ok" />
              <div className="mt-3 font-heading text-lg font-black uppercase text-white">Alles erledigt</div>
              <p className="mt-1 text-sm text-white/50">Keine offenen Fehler oder Warnungen. Quittiertes und Behobenes steht unter Ereignisse – mit „Quittierte zeigen“.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
