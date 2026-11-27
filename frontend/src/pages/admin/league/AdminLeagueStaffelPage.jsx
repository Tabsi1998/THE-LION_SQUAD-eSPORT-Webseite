// Staffel-Seite der Liga-Verwaltung (#2262) unter /admin/leagues/staffeln/<id>: eine Liga-Staffel bedienen, ohne in die
// Turnierverwaltung zu wechseln. Reiter nach dem Muster der Season-Seite (lib/staffelTabs.js), per Sprungmarke ansteuerbar
// (`#teilnehmer`, `#zuteilen`). Die Seite wächst in Paketen neben der alten Bedienung (Entscheidung Nr. 189): Paket A bringt
// Überblick und Teilnehmer, Paket B Spielplan, Spiele und Ergebnisse sowie die Tabelle samt Gleichstand-Entscheid (Nr. 190), Paket C
// Protokoll und Einstellungen - damit ist die Seite vollständig. Seit Paket D leitet die alte Turnierbearbeitung einer Staffel hierher.
//
// Daten wie in der Turnierverwaltung: `GET /tournaments/{id}?include_draft=true` (Rechte als `league_capabilities` und `can_*`,
// `league_links`, `league_season`), dazu Anmeldungen und Spiele. Knöpfe nur nach den Rechten des Servers - er prüft selbst noch einmal.
import { useCallback, useEffect, useId, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { API, api, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminTabBar } from "@/components/tls/AdminTabBar";
import { BracketTree } from "@/components/tls/BracketTree";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { SkeletonDetailHeader } from "@/components/tls/Skeleton";
import { useTeamLineups } from "@/components/tls/tournament/LineupMark";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { loadOk, toastLoadFailed } from "@/lib/loadProblem";
import { NO_LEAGUE_RIGHT } from "@/lib/leagueRights";
import { seasonAnchorUrl } from "@/lib/seasonTabs";
import { STAFFEL_TABS, STAFFEL_TABS_READY, leagueAdminUrl, staffelTarget } from "@/lib/staffelTabs";
import { isStaffel, staffelBeforeStart, staffelLabel } from "@/pages/admin/tournament/StaffelParts";
import { useTournamentStatus } from "@/pages/admin/tournament/useTournamentStatus";
import { SeasonLog } from "./SeasonDeskTab";
import { StaffelTablePanel } from "./SeasonTablePanel";
import { StaffelGamesTab } from "./staffel/StaffelGamesTab";
import { StaffelOverviewTab } from "./staffel/StaffelOverviewTab";
import { StaffelParticipantsTab } from "./staffel/StaffelParticipantsTab";
import { StaffelScheduleTab } from "./staffel/StaffelScheduleTab";
import { StaffelSettingsTab } from "./staffel/StaffelSettingsTab";
import { StaffelStand } from "./staffel/StaffelStand";
import { hasCapability, sanctionsByRegistration } from "./staffel/staffelPage";
import { entrantWords, isSoloStaffel } from "@/lib/leagueParticipants";

const TABS = STAFFEL_TABS.filter((tab) => STAFFEL_TABS_READY.has(tab.key));
// Playoffs und Relegation (#2404, F.6): ein K.-o.-Baum statt einer Tabelle - der Reiter heißt dort „Baum“.
const KNOCKOUT_TABS = TABS.map((tab) => (tab.key === "tabelle" ? { ...tab, label: "Baum" } : tab));

function StaffelBracketPanel({ tournamentId }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    api.get(`/tournaments/${encodeURIComponent(tournamentId)}/bracket`)
      .then(({ data: body }) => alive && setData(body))
      .catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [tournamentId]);
  if (failed) return <p className="tls-type-small text-warn" role="alert">Der Baum ließ sich nicht laden.</p>;
  if (!data) return <p className="tls-type-small text-white/45" aria-busy="true">Lade Baum …</p>;
  return (
    <div className="space-y-3" data-testid="staffel-bracket">
      <p className="tls-type-body text-white/65">Die Setzliste kommt aus dem Endstand der regulären Staffeln. Neu berechnen und abschließen: Reiter „Abschluss“ der Season.</p>
      <BracketTree data={data} quietSections />
    </div>
  );
}

/** Rollt zu einem Abschnitt (`#zuteilen`), sobald er gezeichnet ist. */
function useScrollToSection(section, ready) {
  useEffect(() => {
    if (!section || !ready) return undefined;
    const timer = window.setTimeout(() => document.getElementById(section)?.scrollIntoView?.({ block: "start" }), 60);
    return () => window.clearTimeout(timer);
  }, [section, ready]);
}

function Breadcrumbs({ tournament }) {
  const links = tournament.league_links || {};
  const seasonPath = links.season_admin_path || seasonAnchorUrl(tournament.league_context?.season_id);
  // Die Liga als eigene Stufe (Paket D, #2262): der Server schickt ihre Kennung mit, der Weg führt an ihre Stelle der Liga-Übersicht.
  const leagueId = links.league_id || tournament.league_context?.league_id;
  const crumb = "inline-flex min-h-[44px] items-center hover:text-[#29B6E8] [overflow-wrap:anywhere]";
  return (
    <nav aria-label="Brotkrumen" data-testid="staffel-breadcrumbs">
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1.5 tls-type-small font-bold text-white/60">
        <li><Link to="/admin/leagues" className={crumb} data-testid="staffel-crumb-leagues">Liga</Link></li>
        {links.league_name ? (
          <>
            <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
            <li className="min-w-0"><Link to={leagueAdminUrl(leagueId)} className={crumb} data-testid="staffel-crumb-league">{links.league_name}</Link></li>
          </>
        ) : null}
        <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
        <li className="min-w-0"><Link to={seasonPath} className={crumb} data-testid="staffel-crumb-season">{links.season_name || "Season"}</Link></li>
        {/* Am Handy steht die Staffel gleich darunter als Überschrift - die letzte Stufe nur ab 640 px. */}
        <li aria-hidden="true" className="hidden sm:block"><ChevronRight className="h-3.5 w-3.5" /></li>
        <li className="hidden min-w-0 text-white/75 sm:block [overflow-wrap:anywhere]" aria-current="page">{staffelLabel(tournament)}</li>
      </ol>
    </nav>
  );
}

/** Beim Wechsel auf eine andere Staffel (neue Kennung) beginnt die Seite frisch - nie Co-Teams, Spiele oder Tabelle der vorigen. */
export default function AdminLeagueStaffelPage() {
  const { tournamentId } = useParams();
  return <StaffelPage key={tournamentId} tournamentId={tournamentId} />;
}

function StaffelPage({ tournamentId }) {
  const location = useLocation();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const idBase = useId().replace(/:/g, "");
  const target = staffelTarget(location.hash);
  const [t, setT] = useState(null);
  const [registrations, setRegistrations] = useState([]);
  const [matches, setMatches] = useState([]);
  const [sanctions, setSanctions] = useState([]);
  const [squads, setSquads] = useState({});
  const [error, setError] = useState("");
  // Anmeldungen und Spiele geladen? Vorher (und nach einem Ladefehler) zeigt die Seite keine Zahlen - nie ein falsches „0 von 8“.
  const [lists, setLists] = useState(false);
  // Aufstellung je Co-Team verlangt in der Staffel „Spiele betreuen“ (`team_day_routes.py`) - ohne das Recht fragt die Seite gar nicht erst.
  const lineups = useTeamLineups(hasCapability(t, "matches") ? t : null);

  const load = useCallback(async () => {
    const { data } = await api.get(`/tournaments/${tournamentId}?include_draft=true`);
    setT(data);
    if (!isStaffel(data) || !(data.league_capabilities || []).length) return;
    // Scheitert eine der beiden Listen, gilt die Seite als nicht geladen (Hinweis mit „Nochmal versuchen“) - ein alter Stand bleibt stehen.
    const [regs, plan] = await Promise.all([
      api.get(`/tournaments/${tournamentId}/registrations`),
      api.get(`/tournaments/${tournamentId}/matches-v2`),
    ]);
    setRegistrations(Array.isArray(regs.data) ? regs.data : []);
    setMatches(Array.isArray(plan.data) ? plan.data : []);
    setLists(true);
    // Aktive Strafen (nur mit „Strafen“) und der Kader je Co-Team (nur mit „Kader prüfen“) - Zusätze: ein Fehler meldet sich, hält die Seite aber nicht auf.
    const seasonId = data.league_context.season_id;
    if (hasCapability(data, "sanctions")) {
      api.get(`/admin/leagues/seasons/${seasonId}/sanctions`).then(({ data: body }) => {
        setSanctions(body?.items || []);
        loadOk("staffel-sanctions");
      }).catch(toastLoadFailed("Die Strafen der Season ließen sich nicht laden.", "staffel-sanctions"));
    }
    if (hasCapability(data, "roster")) {
      api.get(`/admin/leagues/seasons/${seasonId}/roster`).then(({ data: body }) => {
        setSquads(Object.fromEntries((body?.squads || []).filter((row) => row.squad_id).map((row) => [row.registration_id, row])));
        loadOk("staffel-roster");
      }).catch(toastLoadFailed("Die Kader ließen sich nicht laden.", "staffel-roster"));
    }
  }, [tournamentId]);
  const loadSafely = useCallback(() => load()
    .then(() => setError(""))
    .catch((failure) => setError(formatRequestError(failure, "Die Staffel konnte nicht geladen werden."))), [load]);
  useEffect(() => { loadSafely(); }, [loadSafely]);
  useApiInvalidation(loadSafely, ["tournaments", "matches", "leagues"]);

  // Status und „Liga starten“ mit denselben Rückfragen wie in der Turnierverwaltung.
  const { setTournStatus } = useTournamentStatus({ id: tournamentId, tournament: t, registrations, onChanged: loadSafely });

  const tab = TABS.some((row) => row.key === target.tab) ? target.tab : TABS[0].key;
  useScrollToSection(target.section, Boolean(t) && lists);
  const go = (key) => navigate({ pathname: location.pathname, search: location.search, hash: key === TABS[0].key ? "" : `#${key}` }, { replace: true });

  // Zuteilung zurücknehmen (#1649): nur ohne festes Spiel - danach Austritt oder Disqualifizieren. Vor dem Start mischt sich die
  // Vorschau neu, danach (Nachmeldung ohne festes Spiel) bleibt der Spielplan, wie er ist.
  const removeSquad = async (registration) => {
    // Solo-Staffel (#1629): dieselbe Zuteilung, nur mit einer Person.
    const solo = isSoloStaffel(t);
    const word = entrantWords(t).one;
    const name = registration.display_name || registration.squad_name || (solo ? "Diese Person" : "Dieses Co-Team");
    const ok = await confirm({
      title: `${word} entfernen?`,
      description: staffelBeforeStart(t)
        ? `${name} wird aus der Staffel genommen. Die Vorschau des Spielplans wird danach neu gemischt.`
        : `${name} wird aus der Staffel genommen. Es hat noch kein festes Spiel – Spielplan und Tabelle bleiben, wie sie sind.`,
      confirmLabel: "Entfernen",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const { data } = await api.delete(`/tournaments/${tournamentId}/squad-registrations/${registration.id}`);
      toast.success(data?.auto_bracket_update?.match_count ? `${name} entfernt. Vorschau neu gemischt.` : `${name} entfernt.`);
      loadSafely();
    } catch (failure) {
      toast.error(formatRequestError(failure, solo ? "Die Person konnte nicht entfernt werden." : "Das Co-Team konnte nicht entfernt werden."));
    }
  };

  if (!t) {
    return (
      <AdminLayout>
        {error ? <p className="p-6 tls-type-small text-warn" role="alert" data-testid="staffel-error">{error}</p> : <div className="p-6"><SkeletonDetailHeader label="Lade Staffel" /></div>}
      </AdminLayout>
    );
  }
  if (!isStaffel(t)) {
    return (
      <AdminLayout>
        <div className="max-w-xl space-y-3 p-2" data-testid="staffel-not-league">
          <p className="tls-type-small text-white/70">„{t.title}“ ist ein Turnier, keine Liga-Staffel.</p>
          <Link to={`/admin/tournaments/${encodeURIComponent(t.id)}`} className="tls-btn tls-btn--secondary inline-flex min-h-[44px] items-center rounded-sm px-4 tls-type-label">Zur Turnierverwaltung</Link>
        </div>
      </AdminLayout>
    );
  }
  if (!(t.league_capabilities || []).length) {
    return (
      <AdminLayout>
        <p className="max-w-xl p-2 tls-type-small text-warn" role="alert" data-testid="staffel-no-right">{NO_LEAGUE_RIGHT}</p>
      </AdminLayout>
    );
  }

  const knockout = Boolean(t.league_context?.kind);
  const tabs = knockout ? KNOCKOUT_TABS : TABS;
  const bySanction = sanctionsByRegistration(sanctions, registrations, t.id);
  // Ladefehler bei schon geladener Staffel: ein sichtbarer Hinweis mit „Nochmal versuchen“ statt stiller Leere.
  const loadNotice = error ? (
    <div role="alert" className="mb-5 flex flex-col gap-3 rounded-sm border border-warn/40 bg-warn/10 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="staffel-load-error">
      <p className="min-w-0 tls-type-small text-white/85 [overflow-wrap:anywhere]">
        {lists ? "Neu laden hat nicht geklappt – was hier steht, kann veraltet sein." : "Co-Teams und Spiele ließen sich nicht laden – darum stehen hier noch keine Teams und Zahlen."}
        <span className="block text-white/60">{error}</span>
      </p>
      <button type="button" onClick={loadSafely} data-testid="staffel-retry"
        className="tls-btn tls-btn--secondary inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-sm px-4 tls-type-label">
        Nochmal versuchen
      </button>
    </div>
  ) : null;
  const panels = {
    ueberblick: () => <StaffelOverviewTab tournament={t} registrations={registrations} matches={matches} onStatus={setTournStatus} onReload={loadSafely} />,
    teilnehmer: () => (
      <StaffelParticipantsTab tournament={t} registrations={registrations} matches={matches} lineups={lineups} sanctions={bySanction} squads={squads}
        onReload={loadSafely} onRemove={removeSquad} />
    ),
    spielplan: () => <StaffelScheduleTab tournament={t} registrations={registrations} matches={matches} onReload={loadSafely} />,
    spiele: () => <StaffelGamesTab tournament={t} registrations={registrations} matches={matches} onReload={loadSafely} />,
    // Tabelle samt Gleichstand-Entscheid (Nr. 190): lesen jede Zuständigkeit, entscheiden „Ergebnisse korrigieren“.
    tabelle: () => (knockout ? <StaffelBracketPanel tournamentId={t.id} /> : (
      <StaffelTablePanel tournamentId={t.id} label={`Tabelle ${staffelLabel(t)}`} canDecide={hasCapability(t, "results")}
        pdfHref={`${API}/exports/tournaments/${encodeURIComponent(t.id)}/standings.pdf`} />
    )),
    // Protokoll der Season auf diese Staffel gefiltert (Paket C): lesen jede Zuständigkeit, Strafen und Notausnahmen nur mit der passenden.
    protokoll: () => <SeasonLog seasonId={t.league_context.season_id} staffelId={t.id} title="Protokoll der Staffel" sectionId="staffel-log" />,
    // Unterreiter per Sprungmarke (`#vorgaben`, `#helfer` …) - wie die Reiter oben, ohne neuen Eintrag im Verlauf.
    einstellungen: () => <StaffelSettingsTab tournament={t} matches={matches} onReload={loadSafely} section={target.section} onSection={go} />,
  };

  return (
    <AdminLayout>
      <Breadcrumbs tournament={t} />
      <header className="mt-3 mb-5 min-w-0">
        <h1 className="tls-type-title break-words [overflow-wrap:anywhere]" data-testid="staffel-title">{staffelLabel(t)}</h1>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <span className="inline-flex" data-testid="staffel-stand"><StaffelStand tournament={t} /></span>
          {t.locked_at ? <span className="rounded-sm border border-[#FFD700]/40 px-2 py-[3px] tls-type-label text-[#FFD700]">Gesperrt</span> : null}
          {/* Solo-Liga (#1629): Die Art der Staffel steht sichtbar da - Teilnehmer sind Personen. */}
          {isSoloStaffel(t) ? (
            <span className="rounded-sm border border-white/15 px-2 py-[3px] tls-type-label text-white/75" data-testid="staffel-kind">Spieler · 1 gegen 1</span>
          ) : null}
        </div>
      </header>

      {loadNotice}
      <AdminTabBar tabs={tabs} active={tab} onSelect={go} idBase={idBase} label="Bereiche der Staffel" testPrefix="staffel" />
      {!lists && !error ? <p className="tls-type-small text-white/60" data-testid="staffel-lists-loading">Lade {entrantWords(t).many} und Spiele …</p> : null}
      {lists && TABS.map((row) => (row.key === tab ? (
        <div key={row.key} role="tabpanel" id={`${idBase}-panel-${row.key}`} aria-labelledby={`${idBase}-tab-${row.key}`} data-testid={`staffel-panel-${row.key}`} className="min-w-0">
          {panels[row.key]()}
        </div>
      ) : null))}
    </AdminLayout>
  );
}
