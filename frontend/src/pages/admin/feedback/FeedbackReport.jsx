import { useEffect, useState } from "react";
import { MessageSquareText, Star } from "lucide-react";
import { api } from "@/lib/api";
import { averageLabel } from "@/lib/feedback";

// Rückmeldungen (#1196) für die Turnierleitung - beim Turnier als Reiter, beim Event als Abschnitt. Schnitt,
// Verteilung, gelobte und kritisierte Stichworte und die Sätze - ohne Namen. Unter drei Rückmeldungen steht nur die
// Zahl: bei zwei Leuten wüsste man sonst, wer was geschrieben hat.

export function FeedbackReport({ kind, targetId }) {
  const [report, setReport] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get(`/admin/feedback/${kind}/${targetId}`)
      .then(({ data }) => { if (alive) setReport(data); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [kind, targetId]);

  if (failed) return <p className="text-sm text-white/50" data-testid="feedback-report-error">Die Rückmeldungen konnten nicht geladen werden.</p>;
  if (!report) return <p className="text-sm text-white/45">Lade Rückmeldungen …</p>;

  const max = Math.max(1, ...Object.values(report.distribution || {}));
  return (
    <section className="space-y-5" data-testid="feedback-report">
      <p className="text-xs text-white/50">Gefragt wurden alle, die dabei waren – am Tag danach, zwei Wochen lang. Namen siehst du hier nie.</p>
      <div className="flex flex-wrap items-end gap-6">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/50">Rückmeldungen</div>
          <div className="font-display text-3xl font-bold tabular-nums" data-testid="feedback-report-count">{report.count}</div>
          {report.declined ? <div className="text-[11px] text-white/40">{report.declined} wollten lieber nicht</div> : null}
        </div>
        {report.details ? (
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/50">Schnitt</div>
            <div className="font-display text-3xl font-bold tabular-nums text-[#FFD700] inline-flex items-center gap-1.5" data-testid="feedback-report-average">
              {averageLabel(report.average)} <Star className="w-5 h-5 fill-[#FFD700]" />
            </div>
          </div>
        ) : null}
      </div>

      {!report.details ? (
        <p className="text-sm text-white/65 border border-white/10 rounded-sm p-4 bg-[#0A0A0A]" data-testid="feedback-report-few">
          {report.count === 0 ? "Noch keine Rückmeldungen." : `Erst ${report.count} ${report.count === 1 ? "Rückmeldung" : "Rückmeldungen"}.`} Schnitt, Stichworte und Sätze erscheinen ab {report.min_for_details} – damit niemand erkennbar ist.
        </p>
      ) : (
        <>
          <div className="space-y-1.5" data-testid="feedback-report-distribution">
            {[5, 4, 3, 2, 1].map((n) => (
              <div key={n} className="flex items-center gap-2 text-xs">
                <span className="w-10 text-white/60 inline-flex items-center gap-1">{n} <Star className="w-3 h-3" /></span>
                <span className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden"><span className="block h-full bg-[#FFD700]/80" style={{ width: `${((report.distribution?.[String(n)] || 0) / max) * 100}%` }} /></span>
                <span className="w-6 text-right tabular-nums text-white/60">{report.distribution?.[String(n)] || 0}</span>
              </div>
            ))}
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <TagList title="Gelobt (4–5 Sterne)" tags={report.praised} tone="good" />
            <TagList title="Hat gestört (1–3 Sterne)" tags={report.criticised} tone="bad" />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/50 mb-2 inline-flex items-center gap-1.5"><MessageSquareText className="w-3.5 h-3.5" /> Sätze</div>
            {report.texts?.length ? (
              <ul className="space-y-2" data-testid="feedback-report-texts">
                {report.texts.map((row, index) => (
                  <li key={`${index}-${row.text}`} className="border border-white/10 rounded-sm bg-[#0A0A0A] px-3 py-2 text-sm">
                    <span className="text-[#FFD700] text-xs mr-2">{"★".repeat(row.stars)}</span>{row.text}
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-white/45">Niemand hat einen Satz geschrieben.</p>}
          </div>
        </>
      )}
    </section>
  );
}

function TagList({ title, tags, tone }) {
  const entries = Object.entries(tags || {});
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/50 mb-2">{title}</div>
      {entries.length ? (
        <div className="flex flex-wrap gap-2">
          {entries.map(([tag, count]) => (
            <span key={tag} className={`inline-flex items-center gap-1.5 rounded-full border px-3 h-7 text-xs font-bold ${tone === "good" ? "border-[#29B6E8]/40 text-[#7FDBFF]" : "border-white/15 text-white/60"}`}>
              {tag} <span className="tabular-nums opacity-70">{count}</span>
            </span>
          ))}
        </div>
      ) : <p className="text-xs text-white/40">–</p>}
    </div>
  );
}

export default FeedbackReport;
