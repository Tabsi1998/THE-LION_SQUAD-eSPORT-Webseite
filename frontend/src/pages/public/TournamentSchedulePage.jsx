import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LiveQueueStatus } from "@/components/tls/live/LiveQueueStatus";
import { StationNowNext } from "@/components/tls/live/StationNowNext";
import { queueSummaryLine } from "@/lib/liveQueue";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { TournamentTabs } from "@/components/tls/tournament/TournamentTabs";
import { PrintLink } from "@/components/tls/print/PrintLink";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { SkeletonCards, SkeletonDetailHeader } from "@/components/tls/Skeleton";
import { LiveClock } from "@/components/tls/bracket/BracketCards";
import { api } from "@/lib/api";
import { describeResult, freshResults, matchResultSignature } from "@/lib/liveChanges";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { useChangedKeys } from "@/hooks/useLiveChanges";
import { useCanonicalSlugRedirect } from "@/hooks/useCanonicalSlugRedirect";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { formatMatchStatus } from "@/lib/tournamentLabels";
import { formatWhen } from "@/lib/datetime";
import { seoTextPreview } from "@/lib/textPreview";
import { viennaDate } from "@/lib/vienna";
import { groupByRound, groupByStation, hasStations, onlyMine, scheduleEntries } from "@/lib/scheduleView";

// Öffentlicher Spielplan (#1562) im Bild des neuen Turnierbaums (#1561): ruhige Karten, Sieger mit Cyan-Strich, laufende
// Spiele atmen in der Live-Farbe. Zwei Sichten - nach Runden und, vor Ort, je Station als einfache Liste nach Zeit -
// und „Nur meine Spiele“ für Angemeldete. Zeit, Station und „voraussichtlich“ kommen vom Server; hier wird nichts
// geplant. Ein Spiel antippen öffnet seine Spielseite.

// Ein Spieltag ist eine Woche. Die Kopfzeile nennt deshalb den Zeitraum, nicht
// nur die Nummer - "Spieltag 3" allein sagt niemandem, wann gespielt wird.
function formatWeekRange(startsAt, endsAt) {
  if (!startsAt || !endsAt) return "";
  const day = { day: "2-digit", month: "2-digit" };
  const start = viennaDate(startsAt, day);
  const end = viennaDate(endsAt, { ...day, year: "numeric" });
  return `${start} – ${end}`;
}

// Warum dieser Termin gilt. Ohne das steht da eine Uhrzeit, bei der unklar
// bleibt, ob sie vereinbart oder nur die Vorgabe ist.
const SCHEDULE_SOURCE_LABELS = {
  accepted: "vereinbart",
  home: "Heimrecht",
  default: "Standardzeit",
  manual: "von der Turnierleitung",
};

const VIEWS = [
  { key: "rounds", label: "Nach Runden" },
  { key: "stations", label: "Nach Stationen" },
];

export default function TournamentSchedulePage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const accessToken = searchParams.get("access") || "";
  const [data, setData] = useState(null);
  const [plan, setPlan] = useState(null);
  const [activeMatchday, setActiveMatchday] = useState(null);
  const [view, setView] = useState("rounds");
  const [mineOnly, setMineOnly] = useState(false);
  const [queue, setQueue] = useState(null);

  const load = useCallback(async () => {
    const accessConfig = { params: accessToken ? { access: accessToken } : undefined };
    const { data: tournament } = await api.get(`/tournaments/${slug}`, accessConfig);
    const { data: bracket } = await api.get(`/tournaments/${tournament.id}/bracket`, accessConfig);
    setData(bracket);
    // Spielwochen gibt es nur bei Liga, Round Robin und Gruppen. Schlägt der
    // Aufruf fehl, bleibt die bisherige Gruppierung stehen statt einer leeren Seite.
    try {
      const { data: matchdayPlan } = await api.get(`/tournaments/${tournament.id}/matchdays`, accessConfig);
      setPlan(matchdayPlan);
    } catch {
      setPlan({ applies: false, matchdays: [] });
    }
    // Live-Warteschlange je Station (#1556): nur vor Ort; online gibt es sie nicht. Fehlt sie, bleibt der Plan.
    if (tournament.event_mode === "online") return setQueue(null);
    try {
      const { data: live } = await api.get(`/tournaments/${tournament.id}/live-queue`, accessConfig);
      setQueue(live?.applies ? live : null);
    } catch {
      setQueue(null);
    }
  }, [slug, accessToken]);

  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load, ["tournaments", "matches", "matches-v2", "stations"], { fallbackMs: 7000 });

  // Frisch eingetragene Ergebnisse tragen kurz „gerade eingetragen“, und unten steht ein
  // Hinweis mit dem Ergebnis - auch für Zuschauer (#225). Beim ersten Laden nichts davon.
  const allMatches = useMemo(() => [...(data?.matches_v2 || []), ...(data?.matches || [])], [data]);
  const changedMatches = useChangedKeys(allMatches, (match) => match.id, matchResultSignature);
  const previousMatches = useRef(null);
  useEffect(() => {
    const before = previousMatches.current;
    previousMatches.current = allMatches;
    if (!before || !data) return;
    const registrations = Object.fromEntries((data.registrations || []).map((r) => [r.id, r]));
    for (const match of freshResults(before, allMatches).slice(0, 3)) {
      toast(describeResult(match, registrations), { id: `result-${match.id}`, duration: 6000 });
    }
  }, [allMatches, data]);

  const entries = useMemo(() => scheduleEntries(data), [data]);
  const hasMine = entries.some((entry) => entry.mine);
  const filtered = useMemo(() => (mineOnly && hasMine ? onlyMine(entries) : entries), [entries, mineOnly, hasMine]);
  const stationsAvailable = hasStations(entries);
  const activeView = view === "stations" && stationsAvailable ? "stations" : "rounds";

  const weeks = useMemo(() => (plan?.applies ? (plan.matchdays || []) : []), [plan]);
  const suggestedMatchday = plan?.current ?? null;
  // Beim Öffnen die Woche zeigen, die gerade gespielt wird - nicht Spieltag 1
  // einer Liga, die im März angefangen hat. Beim Neuladen alle sieben Sekunden
  // bleibt die gewählte Woche stehen, damit einem nichts wegspringt.
  useEffect(() => {
    if (!weeks.length) return;
    setActiveMatchday((current) => (
      current != null && weeks.some((week) => week.number === current)
        ? current
        : (suggestedMatchday ?? weeks[0].number)
    ));
  }, [suggestedMatchday, weeks]);

  const resolvedByMatch = useMemo(() => {
    const map = {};
    for (const week of weeks) {
      for (const entry of week.matches || []) map[entry.match_id] = entry;
    }
    return map;
  }, [weeks]);

  const weekIndex = weeks.findIndex((week) => week.number === activeMatchday);
  const currentWeek = weekIndex >= 0 ? weeks[weekIndex] : null;
  const weekEntries = useMemo(() => {
    if (!currentWeek) return [];
    const wanted = new Set((currentWeek.matches || []).map((entry) => entry.match_id));
    return filtered.filter((entry) => wanted.has(entry.id));
  }, [currentWeek, filtered]);

  const tournament = data?.tournament || {};
  const tournamentUrl = `/tournaments/${tournament.slug || tournament.id}${accessToken ? `?access=${encodeURIComponent(accessToken)}` : ""}`;
  const seoDescription = seoTextPreview(tournament.description, "Spielplan des eSports Turniers mit Runden, Heats, Zeiten und Matchseiten.");
  useDocumentTitle(`${tournament.title || "Turnier"} Spielplan`, seoDescription, {
    image: tournament.banner_url,
    canonical: tournament.slug ? `${window.location.origin}/tournaments/${tournament.slug}/matches` : undefined,
  });
  useCanonicalSlugRedirect(slug, tournament.slug, "/tournaments", "/matches");

  if (!data) {
    return (
      <PublicLayout>
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">
          <SkeletonDetailHeader label="Lade Spielplan" />
          <SkeletonCards count={6} columns={3} image={false} label="Lade Spielplan" />
        </section>
      </PublicLayout>
    );
  }

  const showViews = stationsAvailable && !currentWeek;

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Breadcrumbs
          items={[
            { label: "Home", to: "/" },
            { label: "Turniere", to: "/tournaments" },
            { label: tournament.title, to: tournamentUrl },
            { label: "Spielplan" },
          ]}
          className="mb-3"
        />
        <Link to={tournamentUrl} className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8] hover:text-white">← Zurück zum Turnier</Link>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-heading text-4xl md:text-6xl font-black uppercase">Spielplan</h1>
            <p className="mt-3 text-white/60 max-w-2xl">Alle Runden, Zeiten und Stationen. Ein Spiel antippen öffnet seine Spielseite mit Chat und Ergebnis.</p>
          </div>
          {/* Druckansicht (#1283): mit leeren Feldern für das Ergebnis zum Handschreiben. */}
          <PrintLink slug={tournament.slug || tournament.id} parts="spielplan" from="spielplan" accessToken={accessToken} testId="schedule-print-link" />
        </div>
        <TournamentTabs tournament={tournament} accessToken={accessToken} className="mt-5" />

        {/* Mein nächstes Spiel vor Ort (#1556): „Du bist als Nächstes an Station 2 · ca. 18:40“. */}
        {hasMine && queue ? <LiveQueueStatus tournamentId={tournament.id} className="mt-6" /> : null}

        {(hasMine || showViews) && (
          <div className="mt-8 flex flex-wrap items-center gap-2" data-testid="schedule-toolbar">
            {showViews && (
              <div role="group" aria-label="Ansicht" className="flex flex-wrap gap-1" data-testid="schedule-view">
                {VIEWS.map((option) => (
                  <button key={option.key} type="button" onClick={() => setView(option.key)} aria-pressed={activeView === option.key} data-testid={`schedule-view-${option.key}`} className={`tls-btn ${activeView === option.key ? "tls-btn--secondary" : "tls-btn--quiet"} px-3 py-1.5 rounded-sm text-xs font-bold uppercase tracking-wider`}>
                    {option.label}
                  </button>
                ))}
              </div>
            )}
            {hasMine && (
              <button type="button" onClick={() => setMineOnly((value) => !value)} aria-pressed={mineOnly} data-testid="schedule-only-mine" className={`tls-btn ${mineOnly ? "tls-btn--secondary" : "tls-btn--quiet"} px-3 py-1.5 rounded-sm text-xs font-bold uppercase tracking-wider sm:ml-auto`}>
                Nur meine Spiele
              </button>
            )}
          </div>
        )}

        {currentWeek ? (
          <div className="mt-8" data-testid="matchday-pager">
            <div className="flex items-center justify-between gap-3 border border-white/10 bg-[var(--tls-surface-1)] rounded-md px-3 py-3">
              <button
                type="button"
                onClick={() => setActiveMatchday(weeks[weekIndex - 1].number)}
                disabled={weekIndex <= 0}
                data-testid="matchday-prev"
                aria-label="Vorheriger Spieltag"
                className="p-2 rounded-sm border border-white/10 text-white/70 enabled:hover:border-[#29B6E8]/50 enabled:hover:text-white disabled:opacity-30"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div className="text-center min-w-0">
                <div className="font-heading text-xl md:text-2xl font-black uppercase truncate" data-testid="matchday-title">
                  Spieltag {currentWeek.number}
                </div>
                <div className="mt-0.5 text-xs text-white/55 tabular-nums" data-testid="matchday-range">
                  {formatWeekRange(currentWeek.starts_at, currentWeek.ends_at)}
                </div>
                <div className="mt-0.5 text-[10px] uppercase tracking-widest text-white/30">
                  {weekIndex + 1} von {weeks.length}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveMatchday(weeks[weekIndex + 1].number)}
                disabled={weekIndex >= weeks.length - 1}
                data-testid="matchday-next"
                aria-label="Nächster Spieltag"
                className="p-2 rounded-sm border border-white/10 text-white/70 enabled:hover:border-[#29B6E8]/50 enabled:hover:text-white disabled:opacity-30"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 grid md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="matchday-matches">
              {weekEntries.map((entry) => (
                <ScheduleCard key={entry.id} entry={entry} resolved={resolvedByMatch[entry.id]} changed={changedMatches.has(entry.id)} />
              ))}
              {weekEntries.length === 0 && (
                <div className="md:col-span-2 xl:col-span-3 border border-dashed border-white/15 rounded-md p-8 text-center text-white/45">
                  {mineOnly && hasMine ? "An diesem Spieltag spielst du nicht." : "Für diesen Spieltag liegen keine Partien vor."}
                </div>
              )}
            </div>
          </div>
        ) : activeView === "stations" ? (
          <StationView entries={filtered} changedMatches={changedMatches} queue={queue} />
        ) : (
          <div className="mt-8 space-y-10">
            {groupByRound(filtered).map((group) => (
              <section key={group.key} aria-labelledby={`runde-${group.key}`}>
                <h2 id={`runde-${group.key}`} className="font-heading text-xl md:text-2xl font-black uppercase">{group.label}</h2>
                <div className="mt-4 grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {group.entries.map((entry) => (
                    <ScheduleCard key={entry.id} entry={entry} resolved={resolvedByMatch[entry.id]} changed={changedMatches.has(entry.id)} />
                  ))}
                </div>
              </section>
            ))}
            {entries.length === 0 && <div className="border border-dashed border-white/15 rounded-md p-12 text-center text-white/45">Noch kein Spielplan generiert.</div>}
          </div>
        )}
      </section>
    </PublicLayout>
  );
}

/** Wie es steht - nur ein laufendes Spiel trägt die Live-Farbe, mit Spielzeit seit dem Start. */
function StatusLabel({ entry, compact = false }) {
  const { match, tone } = entry;
  const label = tone === "live" ? "Läuft" : formatMatchStatus(match.schedule_status || match.status);
  return (
    <span className="tls-sched-status" data-tone={tone} data-testid={`schedule-status-${match.id}`}>
      {tone === "live" && <span className="tls-sched-status__dot" aria-hidden="true" />}
      <span>{label}</span>
      {tone === "live" && entry.startedAt && !compact && <span className="tabular-nums opacity-80"><LiveClock startedAt={entry.startedAt} /></span>}
    </span>
  );
}

function When({ entry, resolved }) {
  const { match } = entry;
  // Der berechnete Termin geht vor: bei Spielwochen steht er auch dann fest,
  // wenn noch niemand etwas vereinbart hat, weil dann die Standardzeit gilt.
  // Seit #235 steht der geltende Termin samt Quelle auch in der Partie selbst.
  const scheduledAt = resolved?.scheduled_at || entry.scheduledAt;
  const source = SCHEDULE_SOURCE_LABELS[match.schedule_source === "manual" ? "manual" : resolved?.schedule_source || match.schedule_source];
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
      <span className="text-[13px] text-white/70 tabular-nums" data-testid={`schedule-when-${match.id}`}>{formatWhen(scheduledAt, { fallback: "Termin offen" })}</span>
      {entry.forecast && scheduledAt && <span className="text-[11px] text-white/45" data-testid={`schedule-forecast-${match.id}`}>voraussichtlich</span>}
      {source && !entry.forecast && (
        <span className="text-[10px] uppercase tracking-widest text-white/35" data-testid={`schedule-source-${match.id}`}>{source}</span>
      )}
    </span>
  );
}

function ScheduleCard({ entry, resolved, changed = false }) {
  const { match, sides, tone } = entry;
  const decided = sides.some((side) => side.winner);
  const head = [entry.groupLabel, entry.roundLabel, match.match_key].filter(Boolean).join(" · ");
  return (
    <Link
      to={`/matches/${match.id}`}
      data-testid={`schedule-match-${match.id}`}
      data-changed={changed ? "true" : undefined}
      data-tone={tone}
      data-mine={entry.mine ? "true" : undefined}
      className={`tls-bracket-node tls-sched-card block rounded-md border border-white/10 ${tone === "live" ? "tls-bracket-live" : ""} ${entry.mine ? "is-mine" : ""} ${changed ? "tls-changed" : ""}`}
    >
      <div className="tls-bracket-head">
        <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-white/50">{head}</span>
        <span className="flex shrink-0 items-center gap-2">
          {changed && <span className="tls-new-chip" data-testid={`schedule-fresh-${match.id}`}>gerade eingetragen</span>}
          <StatusLabel entry={entry} />
        </span>
      </div>
      <div className="py-1">
        {sides.map((side, index) => (
          <div
            // Plätze ohne Anmeldung haben keine eigene Kennung - ihre Stelle im Spiel ist der Schlüssel.
            key={side.id || `slot-${index}`}
            className={`tls-bracket-row ${side.winner ? "is-winner" : ""}`}
            data-out={decided && !side.winner ? "1" : undefined}
          >
            <span className={`tls-sched-name min-w-0 flex-1 ${side.known ? "text-white" : "text-white/45 italic"} ${side.winner ? "font-semibold" : ""}`}>{side.label}</span>
            {side.mine && <span className="tls-standing-me">Du</span>}
            {side.score != null && <span className={`font-display text-base font-bold tabular-nums ${side.winner ? "text-white" : "text-white/55"}`}>{side.score}</span>}
            {index < sides.length - 1 && <span className="sr-only">{entry.heat ? ", " : " gegen "}</span>}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-white/5 px-2.5 py-2">
        <When entry={entry} resolved={resolved} />
        {entry.stationLabel && (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[var(--tls-brand)]" data-testid={`schedule-station-${match.id}`}>
            <MapPin className="h-3 w-3" aria-hidden="true" />{entry.stationLabel}
          </span>
        )}
      </div>
    </Link>
  );
}

/** Je Station eine einfache Liste nach Zeit - keine Zeitleiste der Verwaltung. */
function StationView({ entries, changedMatches, queue = null }) {
  const stations = groupByStation(entries);
  const live = Object.fromEntries((queue?.stations || []).map((row) => [row.id, row]));
  const summary = queueSummaryLine(queue?.summary);
  return (
    <>
    {summary ? <p className="mt-8 text-sm font-bold text-white" data-testid="schedule-live-summary">{summary}</p> : null}
    <div className="mt-8 grid gap-8 lg:grid-cols-2" data-testid="schedule-stations">
      {stations.map((station) => (
        <section key={station.key} className="min-w-0" aria-labelledby={`station-${station.key}`} data-testid={`schedule-station-group-${station.key}`}>
          <h2 id={`station-${station.key}`} className="flex items-baseline justify-between gap-3 font-heading text-lg md:text-xl font-black uppercase">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 truncate">{station.name}</span>
              {station.device && <span className="shrink-0 font-body text-[11px] font-semibold normal-case tracking-normal text-white/50" data-testid={`schedule-station-device-${station.name}`}>{station.device}</span>}
            </span>
            <span className="shrink-0 font-body text-xs font-semibold normal-case tracking-normal text-white/45">{station.entries.length} {station.entries.length === 1 ? "Spiel" : "Spiele"}</span>
          </h2>
          {/* Live-Warteschlange je Station (#1556): „Jetzt“ und „Als Nächstes“ aus dem Server. Die Liste darunter bleibt der Plan. */}
          <StationNowNext station={live[station.key]} stationKey={station.key} />
          <ol className="mt-3 rounded-md border border-white/10 bg-[var(--tls-surface-1)] divide-y divide-white/5">
            {station.entries.map((entry) => (
              <li key={entry.id}>
                <Link
                  to={`/matches/${entry.match.id}`}
                  data-testid={`schedule-line-${entry.match.id}`}
                  data-tone={entry.tone}
                  data-mine={entry.mine ? "true" : undefined}
                  className={`tls-sched-line ${changedMatches.has(entry.id) ? "tls-changed-row" : ""}`}
                >
                  <span className="tls-sched-line__time tabular-nums">
                    {entry.scheduledAt ? formatWhen(entry.scheduledAt) : "offen"}
                    {entry.forecast && <span className="block text-[10px] font-normal text-white/40">voraussichtlich</span>}
                  </span>
                  <span className="min-w-0">
                    {entry.heat ? (
                      <>
                        <span className="block text-sm font-semibold text-white">{entry.heat.name} · {entry.heat.count}</span>
                        <span className="tls-sched-name block text-[12px] text-white/70">{entry.sides.map((side) => side.label).join(", ")}</span>
                      </>
                    ) : (
                      <span className="tls-sched-name block text-sm text-white">
                        {entry.sides.map((side) => side.label).join(" gegen ")}
                      </span>
                    )}
                    <span className="block truncate text-[11px] text-white/45">{[entry.groupLabel, entry.roundLabel].filter(Boolean).join(" · ")}</span>
                  </span>
                  <StatusLabel entry={entry} compact />
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
    </>
  );
}
