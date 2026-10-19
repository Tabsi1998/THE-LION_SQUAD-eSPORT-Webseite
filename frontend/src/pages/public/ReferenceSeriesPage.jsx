import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { SkeletonLines } from "@/components/tls/Skeleton";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { STATE_LABELS, STATE_TONES, dayLabel, roundLabel, roundWhen } from "@/lib/referenceCalendar";
import { NotFoundPage } from "@/pages/ErrorPages";

// Seite einer Serie unter /references/series/<spur>/<saison> (Entscheidung 5 zu #1741). Bis die volle Seite mit
// Tabelle kommt (#1745 Turnierserie, #1746 Rennliga, #1747 Team-Liga), zeigt sie nur den Kalender der Saison (#1742)
// und bleibt nicht indexiert. Eine unbekannte, archivierte oder nicht sichtbare Serie ist wie jede unbekannte Adresse
// 404. Eine alte Adresse führt zur aktuellen.

function seriesTitle(data) {
  const series = data?.series || {};
  return series.title || [data?.lineage?.title, [series.season, series.tier].filter(Boolean).join(" · ")].filter(Boolean).join(" ");
}

export default function ReferenceSeriesPage() {
  const { lineageSlug, seasonSlug } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/reference-series/public/${encodeURIComponent(lineageSlug)}/${encodeURIComponent(seasonSlug)}/calendar`);
      setData(body);
      setMissing(false);
    } catch (err) {
      if (err.response?.status === 404) setMissing(true);
    }
  }, [lineageSlug, seasonSlug]);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["reference-series"]);

  useEffect(() => {
    const lineage = data?.lineage?.slug;
    const season = data?.series?.season_slug;
    if (lineage && season && (lineage !== lineageSlug || season !== seasonSlug)) {
      navigate(`/references/series/${lineage}/${season}`, { replace: true });
    }
  }, [data, lineageSlug, seasonSlug, navigate]);

  const title = seriesTitle(data);
  useDocumentTitle(title || "Serie", undefined, { robots: "noindex, follow" });

  if (missing) return <NotFoundPage />;
  const rounds = data?.rounds || [];
  return (
    <PublicLayout>
      <article className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12" data-testid="series-page">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Referenzen", to: "/references" }, { label: title || "Serie" }]} className="mb-6" />
        {!data ? <SkeletonLines lines={5} /> : (
          <>
            <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">{[data.lineage?.label, data.lineage?.organizer].filter(Boolean).join(" · ") || "Serie"}</p>
            <h1 className="font-heading text-4xl md:text-5xl font-black uppercase mt-2">{title}</h1>
            <section className="mt-10" aria-labelledby="series-page-calendar" data-testid="series-page-calendar">
              <h2 id="series-page-calendar" className="font-heading text-2xl font-black uppercase">Kalender</h2>
              {rounds.length === 0 ? (
                <p className="mt-3 text-sm text-white/55">Noch keine Termine.</p>
              ) : (
                <ol className="mt-4 divide-y divide-white/5 border-y border-white/10">
                  {rounds.map((round) => (
                    <li key={round.id} className="py-3 flex items-start gap-3" data-testid="series-page-round" data-state={round.state}>
                      <span className="w-12 shrink-0 font-black tabular-nums text-white/80">{roundLabel(round)}</span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm tabular-nums ${round.state === "cancelled" ? "text-white/45" : "text-white"}`}>{roundWhen(round)}</span>
                        {(round.title || round.venue || round.opponent) && (
                          <span className="block text-sm text-white/60">{[round.title, round.venue, round.opponent && `gegen ${round.opponent}`].filter(Boolean).join(" · ")}</span>
                        )}
                        {round.original_club_day && <span className="block text-[11px] text-white/45">ursprünglich {dayLabel(round.original_club_day)}</span>}
                      </span>
                      <span className={`inline-flex items-center px-2 py-0.5 border rounded-sm text-[10px] font-bold uppercase tracking-widest whitespace-nowrap ${STATE_TONES[round.state] || STATE_TONES.planned}`}>
                        {STATE_LABELS[round.state] || round.state}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </article>
    </PublicLayout>
  );
}
