import { useCallback, useEffect, useState } from "react";
import { MessageSquareText, Star } from "lucide-react";
import { api, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { SkeletonTable } from "@/components/tls/Skeleton";
import { averageLabel } from "@/lib/feedback";
import { viennaDate } from "@/lib/vienna";
import { FeedbackReport } from "./feedback/FeedbackReport";

// Alle Rückmeldungen auf einen Blick (#2131): bisher nur je Turnier oder Event. Die Grenze von drei gilt auch hier -
// darunter steht nur die Zahl. Ein Klick zeigt die Auswertung der Veranstaltung, wie auf ihrer Seite. Ohne Namen.

const KIND_FILTERS = [["", "Alle"], ["tournament", "Turniere"], ["event", "Events"]];
const KIND_LABEL = { tournament: "Turnier", event: "Event" };

export default function AdminFeedbackPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState("");
  const [open, setOpen] = useState("");

  const load = useCallback(() => {
    setError("");
    api.get("/admin/feedback/overview", { params: kind ? { kind } : {} }).then(({ data: next }) => setData(next))
      .catch((err) => setError(formatRequestError(err, "Die Rückmeldungen konnten nicht geladen werden.")));
  }, [kind]);
  useEffect(() => { load(); }, [load]);

  const items = data?.items || [];
  const summary = data?.summary;
  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">eSports</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Rückmeldungen</h1>
      <p className="mt-2 mb-5 text-sm text-white/60 max-w-2xl">Was Teilnehmende nach Turnieren und Events sagen, ohne Namen. Unter {data?.min_for_details ?? 3} Antworten steht nur die Zahl: Bei zwei Leuten wüsste man sonst, wer was geschrieben hat.</p>

      {error && <div className="mb-4 border border-live/40 bg-live/10 rounded-sm p-3 text-sm" data-testid="feedback-overview-error">{error}</div>}
      {!data && !error && <SkeletonTable rows={4} columns={4} label="Lade Rückmeldungen" />}

      {data && (
        <>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-3 mb-5" data-testid="feedback-overview-summary">
            <Tile label="Schnitt" testId="feedback-overview-average">
              {summary?.average != null ? <span className="inline-flex items-center gap-1 text-honor">{averageLabel(summary.average)} <Star className="w-5 h-5 fill-honor" aria-hidden="true" /></span> : "–"}
            </Tile>
            <Tile label="Antworten im Schnitt" testId="feedback-overview-answers">{summary?.answers ?? 0}</Tile>
            <Tile label="Veranstaltungen" testId="feedback-overview-targets">{summary?.targets ?? 0}</Tile>
          </div>

          <div className="flex gap-1 mb-4" role="group" aria-label="Art">
            {KIND_FILTERS.map(([value, label]) => (
              <button key={value} type="button" aria-pressed={kind === value} onClick={() => { setKind(value); setOpen(""); }} data-testid={`feedback-filter-${value || "all"}`}
                className={`px-3 py-2 border rounded-sm text-[11px] font-bold uppercase tracking-wider ${kind === value ? "border-[#29B6E8] text-[#29B6E8] bg-[#29B6E8]/10" : "border-white/15 text-white/55 hover:text-white"}`}>
                {label}
              </button>
            ))}
          </div>

          {items.length === 0 ? (
            <div className="border border-white/10 bg-[#121212] rounded-sm p-8 text-center" data-testid="feedback-overview-empty">
              <MessageSquareText className="w-8 h-8 text-white/20 mx-auto mb-2" aria-hidden="true" />
              <p className="text-sm text-white/50">Noch keine Rückmeldungen. Gefragt wird am Tag nach einem Turnier oder Event.</p>
            </div>
          ) : (
            <ul className="space-y-2" data-testid="feedback-overview-list">
              {items.map((item) => {
                const key = `${item.kind}:${item.target_id}`;
                const expanded = open === key;
                return (
                  <li key={key} className="border border-white/10 bg-[#121212] rounded-sm" data-testid={`feedback-row-${item.target_id}`}>
                    <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="font-bold break-words">{item.title}</div>
                        <div className="text-xs text-white/50">{KIND_LABEL[item.kind] || item.kind}{item.day ? ` · ${viennaDate(item.day)}` : ""}{item.declined ? ` · ${item.declined} wollten nichts sagen` : ""}</div>
                      </div>
                      <div className="flex items-center gap-4 shrink-0">
                        <div className="text-sm text-white/70">{item.count === 1 ? "1 Antwort" : `${item.count} Antworten`}</div>
                        {item.details
                          ? <div className="inline-flex items-center gap-1 font-heading font-black text-honor" data-testid={`feedback-average-${item.target_id}`}>{averageLabel(item.average)} <Star className="w-4 h-4 fill-honor" aria-hidden="true" /></div>
                          : <div className="text-xs text-white/40" data-testid={`feedback-few-${item.target_id}`}>zu wenige</div>}
                        {item.details && (
                          <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? "" : key)} data-testid={`feedback-open-${item.target_id}`} className="text-[11px] uppercase tracking-wider font-bold text-[#29B6E8] hover:underline">
                            {expanded ? "Zuklappen" : "Auswertung"}
                          </button>
                        )}
                      </div>
                    </div>
                    {expanded && <div className="border-t border-white/10 p-4"><FeedbackReport kind={item.kind} targetId={item.target_id} /></div>}
                  </li>
                );
              })}
            </ul>
          )}
          {data.total > items.length && <p className="mt-3 text-xs text-white/45" data-testid="feedback-overview-more">Angezeigt: die neuesten {items.length} von {data.total}.</p>}
        </>
      )}
    </AdminLayout>
  );
}

function Tile({ label, testId, children }) {
  return (
    <div className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid={testId}>
      <div className="font-heading text-2xl font-black text-white">{children}</div>
      <div className="text-[11px] uppercase tracking-widest text-white/45 mt-1">{label}</div>
    </div>
  );
}
