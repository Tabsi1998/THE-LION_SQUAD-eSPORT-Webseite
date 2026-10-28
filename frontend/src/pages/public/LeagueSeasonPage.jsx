// Ligaseite (docs/LIGA.md, P5, #1625) unter /liga/<liga>/<season>: Kopf mit Zeitraum, Spielwoche, Standardtermin,
// Sperrzeiten und Punkten, darunter je Liga N die Staffeln (Tabelle, Spielplan, Ergebnisse), dann Regeltext und Map-Pool.
// Sichtbar nach der Season (Lese-API) - unsichtbar heißt wie „gibt es nicht“.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { CalendarClock, Coffee, ListOrdered, Map as MapIcon, ScrollText, Timer } from "lucide-react";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { SkeletonDetailHeader } from "@/components/tls/Skeleton";
import { MapPoolView } from "@/components/tls/maps/MapPoolView";
import { StaffelPanel } from "@/components/tls/league/public/StaffelPanel";
import { LeagueHead, LeaguePrizes } from "@/components/tls/league/public/LeagueLook";
import { accentStyle } from "@/lib/leagueLook";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { renderMarkdownLite } from "@/lib/markdownLite";
import { blockedLines, defaultSlot, pointsLine, seasonPeriod, weekSpan } from "@/lib/leaguePage";
import { dayNoon, viennaDate } from "@/lib/vienna";

function Fact({ icon: Icon, label, children, testId }) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-white/45">
        <Icon className="h-3.5 w-3.5 tls-league-accent" aria-hidden="true" /> {label}
      </dt>
      <dd className="mt-1 text-sm text-white/85">{children}</dd>
    </div>
  );
}

function Division({ division, leagueSlug, seasonSlug, hash }) {
  const staffeln = division.staffeln || [];
  const fromHash = staffeln.find((row) => hash === `#staffel-${row.slug}` || hash === `#staffel-${row.tournament_id}`);
  const [active, setActive] = useState(() => (fromHash || staffeln[0])?.tournament_id || null);
  const current = staffeln.find((row) => row.tournament_id === active) || staffeln[0];
  const tabs = useRef([]);
  const tabbed = staffeln.length > 1;
  const tabId = (row) => `liga-${division.level}-tab-${row.staffel}`;
  const panelId = `liga-${division.level}-staffel`;
  // Reiter wie üblich (WAI-ARIA): Pfeile links/rechts wechseln und setzen den Fokus mit, Pos1/Ende springen.
  const onTabKey = (event, index) => {
    const moves = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: staffeln.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = (moves[event.key] + staffeln.length) % staffeln.length;
    setActive(staffeln[next].tournament_id);
    tabs.current[next]?.focus();
  };
  return (
    <section className="mt-14 scroll-mt-24" aria-labelledby={`liga-${division.level}`} data-testid={`league-division-${division.level}`}>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-3">
        <h2 id={`liga-${division.level}`} className="font-heading text-2xl md:text-3xl font-black uppercase">{division.label}</h2>
        {tabbed ? (
          <div className="flex flex-wrap gap-2" role="tablist" aria-label={`Staffeln in ${division.label}`}>
            {staffeln.map((row, index) => {
              const selected = row.tournament_id === current?.tournament_id;
              return (
                <button key={row.tournament_id} ref={(node) => { tabs.current[index] = node; }} type="button" role="tab"
                  id={tabId(row)} aria-selected={selected} aria-controls={panelId} tabIndex={selected ? 0 : -1}
                  onClick={() => setActive(row.tournament_id)} onKeyDown={(event) => onTabKey(event, index)}
                  data-testid={`league-staffel-tab-${row.staffel}`}
                  className={`tls-btn tls-league-tab ${selected ? "tls-btn--secondary" : "tls-btn--quiet"} rounded-sm px-3 py-1.5 text-xs font-bold uppercase tracking-wider`}>
                  Staffel {row.staffel}
                </button>
              );
            })}
          </div>
        ) : current ? <span className="text-xs font-bold uppercase tracking-wider text-white/45">Staffel {current.staffel}</span> : null}
      </div>
      {/* Eigene Gewinne dieser Liga N (#2107) - sonst gilt, was oben für die Season steht. */}
      <LeaguePrizes prizes={division.prizes} title={`Um was ${division.label} spielt`} compact testId={`league-prizes-${division.level}`} />
      <div className="mt-6 scroll-mt-24" id={tabbed ? panelId : current ? `staffel-${current.slug || current.tournament_id}` : undefined}
        {...(tabbed && current ? { role: "tabpanel", "aria-labelledby": tabId(current), tabIndex: 0 } : {})}>
        {/* Sprungziele aus der Teamseite (#staffel-…): je Staffel eines, die Reiter wählen beim Laden die richtige. */}
        {tabbed ? staffeln.map((row) => <span key={row.tournament_id} id={`staffel-${row.slug || row.tournament_id}`} className="block scroll-mt-24" />) : null}
        {current
          ? <StaffelPanel key={current.tournament_id} leagueSlug={leagueSlug} seasonSlug={seasonSlug} staffel={current} />
          : <p className="text-sm text-white/55">Die Staffeln werden gerade eingeteilt.</p>}
      </div>
    </section>
  );
}

export default function LeagueSeasonPage() {
  const { league: leagueSlug, season: seasonSlug } = useParams();
  const { hash } = useLocation();
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState(false);
  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/leagues/${leagueSlug}/${seasonSlug}`);
      setData(body);
      setMissing(false);
    } catch {
      setMissing(true);
    }
  }, [leagueSlug, seasonSlug]);
  useEffect(() => { load(); }, [load]);

  const league = data?.league;
  const season = data?.season;
  const title = league && season ? `${league.name} ${season.name}` : "Liga";
  useDocumentTitle(title, `${title}: Tabellen, Spielplan je Spieltag und Ergebnisse.`, {
    canonical: league && season ? `${window.location.origin}/liga/${league.slug}/${season.slug}` : undefined,
  });
  const rules = useMemo(() => (season?.rules_text ? renderMarkdownLite(season.rules_text) : ""), [season?.rules_text]);
  const blocked = blockedLines(season);

  if (missing) {
    return (
      <PublicLayout>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-20 text-center" data-testid="league-missing">
          <h1 className="font-heading text-3xl font-black uppercase">Liga nicht gefunden</h1>
          <p className="mt-3 text-white/60">Diese Season gibt es nicht oder sie ist (noch) nicht sichtbar.</p>
          <Link to="/liga" className="tls-btn tls-btn--secondary mt-6 inline-flex rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider">Zur Liga-Übersicht</Link>
        </div>
      </PublicLayout>
    );
  }
  if (!data) {
    return (
      <PublicLayout>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12"><SkeletonDetailHeader label="Lade Liga" /></div>
      </PublicLayout>
    );
  }
  return (
    <PublicLayout>
      {/* Die Akzentfarbe der Liga gilt für die ganze Seite (#2107): Kopf, Zeichen, Reiter, Tabelle (eigene Zeile, „Du“),
          Spielwochen, Ergebnisse und Links - sie setzt dafür auch die Markenfarbe; ohne sie gilt die Vereinsfarbe. */}
      <div className="tls-league-look max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12" style={accentStyle(data.look?.accent_color)}>
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Liga", to: "/liga" }, { label: title }]} className="mb-3" />
        {/* Kopf (#2107): Banner und Emblem der Season bzw. Liga, Akzentfarbe der Liga - ohne alles ein ruhiger Kopf. */}
        <LeagueHead look={data.look} eyebrow={league.game?.name} title={<>{league.name} <span className="text-white/55">{season.name}</span></>}>
          {season.registration_deadline ? (
            <p className="mt-3 text-sm text-white/60" data-testid="league-subline">
              Meldeschluss {viennaDate(dayNoon(season.registration_deadline), { day: "numeric", month: "numeric", year: "numeric" })}
            </p>
          ) : null}
          <dl className="mt-8 grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4" data-testid="league-facts">
            <Fact icon={CalendarClock} label="Zeitraum" testId="league-fact-period">{seasonPeriod(season)}</Fact>
            <Fact icon={Timer} label={weekSpan(season)} testId="league-fact-week">Ohne Einigung: {defaultSlot(season)}</Fact>
            <Fact icon={ListOrdered} label="Punkte" testId="league-fact-points">
              Sieg / Remis / Niederlage: {pointsLine(season)} · Best of {season.best_of} · {season.team_size} gegen {season.team_size}
            </Fact>
            <Fact icon={Coffee} label="Pausen" testId="league-fact-breaks">
              {blocked.length ? blocked.map((row) => <span key={row.key} className="block">{row.label} {row.range}</span>) : "keine"}
            </Fact>
          </dl>
        </LeagueHead>

        <LeaguePrizes prizes={data.prizes}
          hint={(data.divisions || []).some((division) => division.prizes?.length) ? "Ligen mit eigenen Gewinnen nennen sie bei ihrer Tabelle." : undefined} />

        {data.divisions.length
          ? data.divisions.map((division) => (
            <Division key={division.id} division={division} leagueSlug={league.slug} seasonSlug={season.slug} hash={hash} />
          ))
          : <p className="mt-12 text-white/60" data-testid="league-no-divisions">Die Ligen werden gerade eingeteilt.</p>}

        {rules ? (
          <details className="tls-league-rules mt-14 border border-white/10 bg-[#121212] rounded-sm" data-testid="league-rules">
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 font-heading text-lg font-bold uppercase">
              <ScrollText className="h-4 w-4 tls-league-accent" aria-hidden="true" /> Regeln
            </summary>
            {/* renderMarkdownLite maskiert HTML und baut nur sichere Elemente - wie Turnier- und Eventtexte. */}
            <div className="prose-cms px-4 pb-5 text-sm" dangerouslySetInnerHTML={{ __html: rules }} />
          </details>
        ) : null}

        <MapPoolView pool={data.map_pool} title="Map-Pool" hint="Diese Maps sind in der Season erlaubt." icon={MapIcon}
          className="mt-14" testId="league-map-pool" />
      </div>
    </PublicLayout>
  );
}
