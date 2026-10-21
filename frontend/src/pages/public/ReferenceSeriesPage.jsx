import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { SkeletonLines } from "@/components/tls/Skeleton";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { PUBLIC_STATE_LABELS, STATE_TONES, dayLabel, roundLabel, roundWhen } from "@/lib/referenceCalendar";
import { SeriesStandings } from "@/components/tls/series/SeriesStandings";
import { FinalCalculator, SeriesFinal, SeriesProgress, SeriesRules } from "@/components/tls/series/SeriesParts";
import { TeamLeagueSections } from "@/components/tls/series/TeamLeague";
import { RacingLeague } from "@/components/tls/series/RacingLeague";
import { VenueWithFlag } from "@/components/tls/CountryFlag";
import { MapPoolView } from "@/components/tls/maps/MapPoolView";
import { NotFoundPage } from "@/pages/ErrorPages";
import { SeriesPartners } from "@/components/tls/series/SeriesPartners";

// Seite einer Serie unter /references/series/<spur>/<saison> (Entscheidung 5 zu #1741), Turnierserie (#1745): Kopf,
// Rundenfortschritt, Regeln, Gesamtwertung mit Streichergebnissen und Finalgrenze, Finalrechner (Richtwert), das
// Finale als eigene Runde und die Termine (#1742). Alles kommt gespeichert vom Server - hier wird nichts gerechnet.
// Fremde Namen stehen nur in den Tabellen; die Seite ist nicht indexiert. Eine unbekannte, archivierte oder nicht
// sichtbare Serie ist wie jede unbekannte Adresse 404. Eine alte Adresse führt zur aktuellen.
// Team-Liga (#1747): statt Gesamtwertung, Finale und Terminen Tabelle, Spielplan, Aufstellung und Liga-Weg.
// Eine Rennliga (#1746, Block `racing` vom Server) zeigt unter demselben Kopf ihre eigene Ansicht (RacingLeague).

function seriesTitle(data) {
  const series = data?.series || {};
  return series.title || [data?.lineage?.title, [series.season, series.tier].filter(Boolean).join(" · ")].filter(Boolean).join(" ");
}

function Calendar({ rounds }) {
  return (
    <section className="mt-12" aria-labelledby="series-page-calendar" data-testid="series-page-calendar">
      <h2 id="series-page-calendar" className="font-heading text-2xl font-black uppercase">Termine</h2>
      {rounds.length === 0 ? (
        <p className="mt-3 text-sm text-white/55">Noch keine Termine.</p>
      ) : (
        <ol className="mt-4 divide-y divide-white/5 border-y border-white/10">
          {rounds.map((round) => (
            <li key={round.id} className="py-3 flex items-start gap-3" data-testid="series-page-round" data-state={round.state}>
              <span className={`w-12 shrink-0 font-black tabular-nums ${round.kind === "final" ? "text-[var(--tls-honor)]" : "text-white/80"}`}>{roundLabel(round)}</span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm tabular-nums ${round.state === "cancelled" ? "text-white/45" : "text-white"}`}>{roundWhen(round)}</span>
                {(round.title || round.venue || round.country_code || round.opponent) && (
                  <span className="block text-sm text-white/60">
                    <VenueWithFlag round={round} />
                    {round.opponent && `${round.title || round.venue || round.country_code ? " · " : ""}gegen ${round.opponent}`}
                  </span>
                )}
                {round.original_club_day && <span className="block text-[11px] text-white/45">ursprünglich {dayLabel(round.original_club_day)}</span>}
              </span>
              <span className={`inline-flex items-center px-2 py-0.5 border rounded-sm text-[10px] font-bold uppercase tracking-widest whitespace-nowrap ${STATE_TONES[round.state] || STATE_TONES.planned}`}>
                {PUBLIC_STATE_LABELS[round.state] || round.state}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default function ReferenceSeriesPage() {
  const { lineageSlug, seasonSlug } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  // Für welche Adresse die Antwort kam: beim Wechsel der Saison (Umschalter, #1746) steht kurz noch die alte da - sie
  // darf nicht als „alte Adresse“ zurückführen.
  const [loadedFor, setLoadedFor] = useState(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/reference-series/public/${encodeURIComponent(lineageSlug)}/${encodeURIComponent(seasonSlug)}`);
      setData(body);
      setLoadedFor(`${lineageSlug}/${seasonSlug}`);
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
    if (loadedFor !== `${lineageSlug}/${seasonSlug}`) return;
    if (lineage && season && (lineage !== lineageSlug || season !== seasonSlug)) {
      navigate(`/references/series/${lineage}/${season}`, { replace: true });
    }
  }, [data, loadedFor, lineageSlug, seasonSlug, navigate]);

  const title = seriesTitle(data);
  useDocumentTitle(title || "Serie", undefined, { robots: "noindex, follow" });

  if (missing) return <NotFoundPage />;
  const rounds = data?.rounds || [];
  const eyebrow = [data?.lineage?.label, data?.lineage?.organizer, data?.lineage?.game_name].filter(Boolean).join(" · ");
  return (
    <PublicLayout>
      <article className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12" data-testid="series-page">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Referenzen", to: "/references" }, { label: title || "Serie" }]} className="mb-6" />
        {!data ? <SkeletonLines lines={5} /> : (
          <>
            <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">{eyebrow || "Serie"}</p>
            <h1 className="font-heading text-4xl md:text-5xl font-black uppercase mt-2">{title}</h1>
            <SeriesPartners partners={data.partners} />
            {data.lineage?.kind === "team_league" && <TeamLeagueSections data={data} />}
            {data.racing && <RacingLeague data={data} />}
            {data.lineage?.kind !== "team_league" && !data.racing && (<>
            <SeriesProgress progress={data.progress} rounds={rounds} />
            <section className="mt-10" aria-labelledby="series-page-table">
              <h2 id="series-page-table" className="font-heading text-2xl font-black uppercase">Gesamtwertung</h2>
              <SeriesRules rules={data.rules} />
              <SeriesStandings standings={data.standings} rounds={rounds} rules={data.rules} />
              <FinalCalculator standings={data.standings} rules={data.rules} progress={data.progress} />
            </section>
            <SeriesFinal final={data.final} />
            <Calendar rounds={rounds} />
            </>)}
            {/* Map-Pool der Saison (#1616) als Snapshot - bei jeder Art, ohne Pool erscheint nichts. */}
            <MapPoolView pool={data.map_pool} hint="Die Maps dieser Saison, je Modus." headingId="series-page-maps" />
          </>
        )}
      </article>
    </PublicLayout>
  );
}
