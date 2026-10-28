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
import { NoScoreNote, RuleChanges, SeasonNotice } from "@/components/tls/series/SeriesSpecialRules";
import { NotFoundPage } from "@/pages/ErrorPages";
import { SeriesPartners } from "@/components/tls/series/SeriesPartners";
import { SeriesDataSource } from "@/components/tls/series/SeriesDataSource";
import { TournamentDays } from "@/components/tls/series/TournamentDays";
import { formatNumber } from "@/lib/standingsTable";
import { OriginalsButton } from "@/components/tls/series/OriginalViewer";
import { originalsOf } from "@/lib/referenceOriginals";
import { SeriesLogo } from "@/components/tls/references/SeriesLogo";
import { seriesLogo } from "@/lib/seriesLogo";
import { OPEN_ROUND, kindShows } from "@/lib/seriesKinds";

// Seite einer Serie unter /references/series/<spur>/<saison> (Entscheidung 5 zu #1741), Turnierserie (#1745): Kopf,
// Rundenfortschritt, Regeln, Gesamtwertung mit Streichergebnissen und Finalgrenze, Finalrechner (Richtwert), das
// Finale als eigene Runde und die Termine (#1742). Alles kommt gespeichert vom Server - hier wird nichts gerechnet.
// Fremde Namen stehen nur in den Tabellen; die Seite ist nicht indexiert. Eine unbekannte, archivierte oder nicht
// sichtbare Serie ist wie jede unbekannte Adresse 404. Eine alte Adresse führt zur aktuellen.
// Team-Liga (#1747): statt Gesamtwertung, Finale und Terminen Tabelle, Spielplan, Aufstellung und Liga-Weg.
// Eine Rennliga (#1746, Block `racing` vom Server) zeigt unter demselben Kopf ihre eigene Ansicht (RacingLeague).
// Turniertage (#1961): unter der Gesamtwertung die Tagesansicht R1…Rn mit Summe, Lobbys und das Spieler-Detail; die
// Gesamtwertung zeigt Sonderboni in einer eigenen Spalte. Holt die Saison ihre Turniertage von einer Partner-Plattform
// (#1964), nennt der Kopf die Quelle („Daten von …“).

// Sonderboni (#1961) stehen getrennt neben den Punkten - nur, wenn die Saison welche führt.
function bonusColumn(rules) {
  if (!(rules?.custom_bonuses || []).length) return null;
  const names = rules.custom_bonuses.map((bonus) => bonus.label).join(", ");
  return {
    header: "Boni", title: `Sonderboni (${names}) – in den Punkten enthalten, nie gestrichen`,
    cell: (row) => (row.bonus_points ? `+${formatNumber(row.bonus_points)}` : "–"),
  };
}

function seriesTitle(data) {
  const series = data?.series || {};
  return series.title || [data?.lineage?.title, [series.season, series.tier].filter(Boolean).join(" · ")].filter(Boolean).join(" ");
}

// Art-Profil (#2024): Ort und Flagge nur, wo die Art sie führt (eine Turnierserie hat keine); ein Termin ohne Datum
// heißt öffentlich „Termin folgt“.
function Calendar({ rounds, originals, profile }) {
  const places = kindShows(profile, "venue");
  return (
    <section className="mt-12" aria-labelledby="series-page-calendar" data-testid="series-page-calendar">
      <h2 id="series-page-calendar" className="font-heading text-2xl font-black uppercase">Termine</h2>
      {rounds.length === 0 ? (
        <p className="mt-3 text-sm text-white/55">Noch keine Termine.</p>
      ) : (
        <ol className="mt-4 divide-y divide-white/5 border-y border-white/10">
          {rounds.map((round) => (
            <li key={round.id} className="py-3 flex items-start gap-3" data-testid="series-page-round" data-state={round.state}>
              <span className={`min-w-12 shrink-0 whitespace-nowrap font-black tabular-nums ${round.kind === "final" ? "text-[var(--tls-honor)]" : "text-white/80"}`}>{roundLabel(round)}</span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm tabular-nums ${round.state === "cancelled" ? "text-white/45" : "text-white"}`}>{roundWhen(round, { open: OPEN_ROUND })}</span>
                {places ? (round.title || round.venue || round.country_code || round.opponent) && (
                  <span className="block text-sm text-white/60">
                    <VenueWithFlag round={round} />
                    {round.opponent && `${round.title || round.venue || round.country_code ? " · " : ""}gegen ${round.opponent}`}
                  </span>
                ) : round.title && <span className="block text-sm text-white/60">{round.title}</span>}
                {round.original_club_day && <span className="block text-[11px] text-white/45">ursprünglich {dayLabel(round.original_club_day)}</span>}
                <NoScoreNote round={round} profile={profile} />
                {/* Original-Bilder des Veranstalters (#1933). */}
                <OriginalsButton items={originalsOf(originals, [round])} title={[roundLabel(round), (places && round.venue) || round.title].filter(Boolean).join(" · ")} className="mt-2" testId="series-page-round-originals" />
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
  useDocumentTitle(title || "Serie", undefined, { robots: "noindex, follow", image: data?.series?.logo_url || undefined });

  if (missing) return <NotFoundPage />;
  const rounds = data?.rounds || [];
  const eyebrow = [data?.lineage?.label, data?.lineage?.organizer, data?.lineage?.game_name].filter(Boolean).join(" · ");
  const logo = seriesLogo(data?.lineage, data?.series);
  return (
    <PublicLayout>
      <article className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12" data-testid="series-page">
        <Breadcrumbs items={[{ label: "Start", to: "/" }, { label: "Referenzen", to: "/references" }, { label: title || "Serie" }]} className="mb-6" />
        {!data ? <SkeletonLines lines={5} /> : (
          <>
            {/* #2014: Logo der Saison bzw. Spur im Kopf - wie hochgeladen; ohne Logo wie bisher nur der Text. */}
            <div className={logo ? "flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6" : ""}>
              <SeriesLogo src={logo} size="lg" testId="series-page-logo" />
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">{eyebrow || "Serie"}</p>
                <h1 className="font-heading text-4xl md:text-5xl font-black uppercase mt-2">{title}</h1>
              </div>
            </div>
            <SeriesPartners partners={data.partners} />
            {/* Saison abgebrochen (#1960): Hinweis mit Grund und Nachfolger - die gefahrenen Ergebnisse bleiben. */}
            <SeasonNotice series={data.series} successor={data.successor} />
            <SeriesDataSource source={data.data_source} />
            {data.lineage?.kind === "team_league" && <TeamLeagueSections data={data} />}
            {data.racing && <RacingLeague data={data} />}
            {data.lineage?.kind !== "team_league" && !data.racing && (<>
            <SeriesProgress progress={data.progress} rounds={rounds} profile={data.profile} />
            <section className="mt-10" aria-labelledby="series-page-table">
              <h2 id="series-page-table" className="font-heading text-2xl font-black uppercase">Gesamtwertung</h2>
              <SeriesRules rules={data.rules} />
              <RuleChanges changes={data.rule_changes} />
              <SeriesStandings standings={data.standings} rounds={rounds} rules={data.rules} extraColumn={bonusColumn(data.rules)} profile={data.profile} />

              <FinalCalculator standings={data.standings} rules={data.rules} progress={data.progress} />
            </section>
            <TournamentDays standings={data.standings} rounds={rounds} rules={data.rules} />
            <SeriesFinal final={data.final} />
            <Calendar rounds={rounds} originals={data.originals} profile={data.profile} />
            </>)}
            {/* Map-Pool der Saison (#1616) als Snapshot - bei jeder Art, ohne Pool erscheint nichts. */}
            <MapPoolView pool={data.map_pool} hint="Die Maps dieser Saison, je Modus." headingId="series-page-maps" />
          </>
        )}
      </article>
    </PublicLayout>
  );
}
