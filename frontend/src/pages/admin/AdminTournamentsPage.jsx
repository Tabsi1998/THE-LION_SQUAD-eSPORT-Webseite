import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { api, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminDenied } from "@/components/tls/AdminDenied";
import { deniedText } from "@/lib/loadProblem";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { Plus, Trash2, Play, Pause, Search, Users, Download } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { hasArea, hasLeagueStaff } from "@/lib/permissions";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useNarrowScreen } from "@/hooks/useNarrowScreen";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { formatTournamentDisplay, formatTournamentFormat } from "@/lib/tournamentLabels";
import { TOURNAMENT_STATUS_OPTIONS } from "./tournament/shared";
import { effectiveRuleModes } from "@/lib/tournamentRulePresets";
import { gameLabel } from "@/lib/gameLabels";
import { downloadCsv, formatAdminDate, normalizeSearch } from "@/lib/adminListTools";
import { sortByNearestDate } from "@/lib/contentSort";
import { endText, liveAfterEnd } from "@/lib/endedLive";
import { ShortCaps } from "@/components/tls/ShortCaps";

const EVENT_MODE_LABELS = {
  hybrid: "Hybrid",
  local: "Vor Ort",
  online: "Online",
};
const RESULT_ENTRY_MODE_LABELS = {
  hybrid: "Ergebnis: Hybrid",
  player_confirmed: "Ergebnis: beide",
  staff_only: "Ergebnis: Turnierleitung",
};
const SCHEDULE_MODE_LABELS = {
  fixed_by_staff: "Termin: Turnierleitung",
  hybrid: "Termin: Hybrid",
  player_proposal: "Termin: Vorschlag",
};
// Dieselben Statuswörter wie im Kopf der Turnierseite (#2111, TA21) - mit „Check-in offen“. „Alle“ heißt ohne Archiv;
// archivierte Turniere zeigt der Filter „Archiviert“. Staffeln stehen seit Paket D (#2262, Nr. 192) nur in der Liga-Verwaltung.
const statusLabel = (status) => TOURNAMENT_STATUS_OPTIONS.find(([value]) => value === status)?.[1] || status || "—";
// Die Verwaltungsliste fragt bis zu so viele Turniere ab (der Server liefert höchstens 500) - steht die Liste voll, sagt
// die Seite es, statt still abzuschneiden.
const LIST_LIMIT = 500;
// Löschen nur als Entwurf (#2111, TA18); der Server prüft dazu, dass es keine Ergebnisse hat. Sonst: absagen oder archivieren - über
// den Status in der Turnierverwaltung.
const canDelete = (tournament) => tournament.status === "draft";

// Die reine Liga-Leitung (Paket D, #2262, Nr. 192): Bereich Ligen oder Zuständige einer Liga, ohne Bereich Turniere und ohne Helfer-Einsatz -
// dieselbe Tür wie `leagueStaffEntry` in ProtectedRoute. Die Turnierliste hat für sie nichts mehr, sie landet bei Liga.
const onlyLeagueLead = (user) => Boolean(user) && (hasLeagueStaff(user) || hasArea(user, "leagues")) && !hasArea(user, "tournaments") && !user.has_staff_assignment;

export default function AdminTournamentsPage() {
  const { user } = useAuth();
  if (onlyLeagueLead(user)) return <Navigate to="/admin/leagues" replace />;
  return <TournamentList />;
}

function TournamentList() {
  // Globale Aktionen nur für die Turnierleitung mit Zwei-Faktor (#1028), Helfer sehen die ihres Einsatzes.
  const { isTournamentLead } = useAuth();
  // Handy (#2463): unter 768 px Karten statt der Tabelle zum Wischen - nur eine Form steht im DOM.
  const narrow = useNarrowScreen();
  const [searchParams, setSearchParams] = useSearchParams();
  const [list, setList] = useState([]);
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "");
  const confirm = useConfirm();
  const [denied, setDenied] = useState("");
  const load = useCallback(async () => {
    // Verwaltungsliste (#1028): die Turnierleitung bekommt alle Turniere, Helfer nur die ihres Einsatzes. Ohne Staffeln
    // (`league=exclude`, Paket D #2262, Nr. 192) - die stehen in der Liga-Verwaltung; Zähler, Suche und CSV kennen sie nicht.
    try {
      const { data } = await api.get(`/tournaments?include_drafts=true&managed=true&league=exclude&limit=${LIST_LIMIT}`);
      setList(data);
      setDenied("");
    } catch (error) {
      // Verweigert der Server die Liste, steht der Grund da - nicht „Keine Turniere“ (#1353).
      setList([]);
      setDenied(deniedText(error, ["tournaments"]) || formatRequestError(error, "Turniere konnten nicht geladen werden."));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["tournaments"]);

  useEffect(() => {
    const nextQuery = searchParams.get("q") || "";
    const nextStatus = searchParams.get("status") || "";
    if (nextQuery !== query) setQuery(nextQuery);
    if (nextStatus !== statusFilter) setStatusFilter(nextStatus);
  }, [searchParams, query, statusFilter]);

  const updateFilterParams = (patch) => {
    const nextQuery = Object.prototype.hasOwnProperty.call(patch, "q") ? patch.q : query;
    const nextStatus = Object.prototype.hasOwnProperty.call(patch, "status") ? patch.status : statusFilter;
    setQuery(nextQuery);
    setStatusFilter(nextStatus);
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (nextQuery) params.set("q", nextQuery);
      else params.delete("q");
      if (nextStatus) params.set("status", nextStatus);
      else params.delete("status");
      return params;
    }, { replace: true });
  };

  const setStatus = async (id, status) => {
    try {
      const response = await api.post(`/tournaments/${id}/status`, { status });
      toast.success(`Status: ${statusLabel(status)}`);
      // Punkte in einer abgeschlossenen Jahreswertung bleiben unverändert (#2123).
      if (response?.data?.season_points_note) toast.info(response.data.season_points_note, { duration: 10000 });
      load();
    } catch (e) {
      toast.error(formatRequestError(e, "Status konnte nicht geändert werden."));
    }
  };

  const del = async (tournament) => {
    if (!await confirm({
      title: "Entwurf löschen?",
      description: "Das Turnier wird dauerhaft gelöscht – mit Anmeldungen, Vorschau, Gruppen, Map-Pool und Chat. Das lässt sich nicht zurücknehmen. Ein Turnier mit Ergebnissen sagst du stattdessen ab oder archivierst es.",
      confirmLabel: "Löschen",
      tone: "danger",
    })) return;
    try {
      await api.delete(`/tournaments/${tournament.id}`);
      toast.success("Turnier gelöscht.");
      load();
    } catch (e) {
      toast.error(formatRequestError(e, "Turnier konnte nicht gelöscht werden."));
    }
  };
  const statusCounts = useMemo(() => list.reduce((acc, tournament) => {
    const key = tournament.status || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {}), [list]);
  const sortedList = useMemo(() => sortByNearestDate(list), [list]);
  const filteredList = useMemo(() => {
    const q = normalizeSearch(query);
    return sortedList.filter((tournament) => {
      if (statusFilter && tournament.status !== statusFilter) return false;
      if (!statusFilter && tournament.status === "archived") return false;
      if (!q) return true;
      const haystack = normalizeSearch([
        tournament.title,
        tournament.slug,
        tournament.platform,
        tournament.format,
        tournament.format_label,
        // Deutsche Formatnamen (#2111, TA21): „K.-o.“ findet ein K.-o.-Turnier, nicht nur „single_elim“.
        formatTournamentDisplay(tournament),
        formatTournamentFormat(tournament.format),
        tournament.game?.name,
        gameLabel(tournament.game),
      ].filter(Boolean).join(" "));
      return haystack.includes(q);
    });
  }, [query, sortedList, statusFilter]);

  const exportCsv = () => {
    downloadCsv(
      `tls-turniere-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Titel", "Adresse", "Spiel", "Format", "Status", "Start", "Teilnehmer", "Max. Teilnehmer"],
      filteredList.map((tournament) => [
        tournament.title,
        tournament.slug,
        gameLabel(tournament.game),
        formatTournamentDisplay(tournament),
        statusLabel(tournament.status),
        formatAdminDate(tournament.start_date),
        tournament.participant_count,
        tournament.max_participants,
      ]),
    );
  };

  return (
    <AdminLayout>
      {/* Kopf (#2463): Er bricht als Ganzes um - der Knopf rutscht unter die Überschrift, statt „Turniere“ mitten im Wort zu teilen. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 mb-8" data-testid="admin-tournaments-head">
        <div className="min-w-0">
          <span className="tls-type-label text-[#29B6E8]">Turniere</span>
          <h1 className="tls-type-title [overflow-wrap:normal]"><ShortCaps>Turniere</ShortCaps></h1>
        </div>
        {isTournamentLead && (
          <Link to="/admin/tournaments/new" data-testid="admin-new-tournament" className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] transition">
            <Plus className="w-4 h-4" /> Neues Turnier
          </Link>
        )}
      </div>
      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_14rem_auto_auto]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <input
              value={query}
            onChange={(event) => updateFilterParams({ q: event.target.value })}
            data-testid="admin-tournament-search"
            className="w-full rounded-sm border border-white/10 bg-[#0A0A0A] py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-white/35 focus:border-[#29B6E8]/60 focus:outline-none"
            placeholder="Turnier, Spiel, Format, Adresse oder Plattform suchen"
          />
        </label>
        <select
          value={statusFilter}
          onChange={(event) => updateFilterParams({ status: event.target.value })}
          data-testid="admin-tournament-status-filter"
          className="w-full rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2.5 text-sm text-white focus:border-[#29B6E8]/60 focus:outline-none"
        >
          <option value="">Alle außer Archiv ({list.length - (statusCounts.archived || 0)})</option>
          {TOURNAMENT_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label} ({statusCounts[value] || 0})</option>)}
        </select>
        <div className="flex items-center justify-end rounded-sm border border-white/10 bg-[#121212] px-3 py-2 tls-type-label text-white/55">
          {filteredList.length} / {list.length} sichtbar
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={filteredList.length === 0}
          className="inline-flex items-center justify-center gap-2 rounded-sm border border-white/15 px-3 py-2 tls-type-label text-white/65 hover:border-[#29B6E8]/45 hover:text-white disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" /> CSV
        </button>
      </div>
      {list.length >= LIST_LIMIT && (
        <p className="mb-3 tls-type-small text-quiet" data-testid="admin-tournament-list-limit">
          Die Liste zeigt die {LIST_LIMIT} zuletzt angelegten Turniere – ältere stehen hier nicht.
        </p>
      )}
      {narrow ? (
        <ul className="space-y-3" data-testid="admin-tournament-cards">
          {filteredList.map((t) => (
            <li key={t.id} data-testid={`admin-tr-${t.slug}`} className="rounded-sm border border-white/10 bg-[#121212] p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <Link to={`/admin/tournaments/${t.id}`} className="font-semibold [overflow-wrap:anywhere] hover:text-[#29B6E8]">{t.title}</Link>
                  <div className="mt-1 tls-type-small text-white/55">{[gameLabel(t.game), formatTournamentDisplay(t)].filter(Boolean).join(" · ") || "—"}</div>
                </div>
                <div className="shrink-0 text-right" data-testid={`admin-tr-participants-${t.slug}`}>
                  <div className="tls-type-small font-bold tabular-nums">{t.participant_count}/{t.max_participants}</div>
                  <div className="tls-type-label text-white/55">Teilnehmer</div>
                </div>
              </div>
              <div className="mt-3">
                <StatusCell tournament={t} leads={isTournamentLead} endedClassName="mt-1 block" />
              </div>
              <div className="mt-2" data-testid={`admin-tr-rules-${t.slug}`}>
                <RulePills tournament={t} compact />
              </div>
              <div className="mt-2 -mb-2 -mr-2 flex items-center justify-end gap-1 border-t border-white/5 pt-1">
                <RowActions tournament={t} isTournamentLead={isTournamentLead} onStatus={setStatus} onDelete={del} />
              </div>
            </li>
          ))}
          {filteredList.length === 0 && (
            <li className={denied ? "" : "rounded-sm border border-white/10 bg-[#121212] py-10 text-center text-white/40"}>
              {denied ? <AdminDenied text={denied} /> : list.length === 0 ? "Keine Turniere" : "Keine Turniere für diesen Filter"}
            </li>
          )}
        </ul>
      ) : (
      <div className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
        <div className="tls-swipe pb-0">
        {/* Tablet und schmales Fenster (#2463): ohne Mindestbreite, die Regeln unter dem Titel - die Aktionen bleiben ohne Wischen im Bild. */}
        <table className="w-full tls-type-small xl:min-w-[860px]">
          <thead className="bg-[#0A0A0A] tls-type-label text-white/50">
            <tr>
              <th className="text-left px-3 py-3">Titel</th>
              <th className="text-left px-3 py-3">Spiel</th>
              <th className="text-left px-3 py-3">Format</th>
              <th className="hidden text-left px-3 py-3 xl:table-cell">Regeln</th>
              <th className="text-left px-3 py-3">Status</th>
              <th className="text-right px-3 py-3">Teilnehmer</th>
              <th className="text-right px-3 py-3">Aktion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filteredList.map((t) => (
              <tr key={t.id} data-testid={`admin-tr-${t.slug}`}>
                <td className="px-3 py-3">
                  <Link to={`/admin/tournaments/${t.id}`} className="font-semibold [overflow-wrap:anywhere] hover:text-[#29B6E8]">{t.title}</Link>
                  <div className="mt-1 xl:hidden"><RulePills tournament={t} compact /></div>
                </td>
                <td className="px-3 py-3 text-white/70">{gameLabel(t.game) || "—"}</td>
                <td className="px-3 py-3 text-white/70">{formatTournamentDisplay(t)}</td>
                <td className="hidden px-3 py-3 xl:table-cell">
                  <RulePills tournament={t} />
                </td>
                <td className="px-3 py-3">
                  <StatusCell tournament={t} leads={isTournamentLead} endedClassName="mt-1 block max-w-[14rem]" />
                </td>
                <td className="px-3 py-3 text-right">{t.participant_count}/{t.max_participants}</td>
                <td className="px-3 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <RowActions tournament={t} isTournamentLead={isTournamentLead} onStatus={setStatus} onDelete={del} />
                  </div>
                </td>
              </tr>
            ))}
            {filteredList.length === 0 && (
              <tr>
                <td colSpan="7" className={denied ? "p-4" : "text-center py-10 text-white/40"}>
                  {denied ? <AdminDenied text={denied} /> : list.length === 0 ? "Keine Turniere" : "Keine Turniere für diesen Filter"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
      )}
    </AdminLayout>
  );
}

function StatusCell({ tournament: t, leads, endedClassName }) {
  return (
    <>
      <StatusBadge status={t.status} />
      {/* Nach dem Ende noch „Live“ (#2194): Hinweis mit Weg, umgestellt wird nie von selbst. */}
      {leads && liveAfterEnd(t) ? (
        <Link to={`/admin/tournaments/${t.id}`} data-testid={`admin-tr-ended-live-${t.slug}`} title={`Ende war am ${endText(t.end_date)}`}
          className={`${endedClassName} tls-type-small leading-snug text-warn hover:text-white`}>
          Läuft laut Stand noch, Ende war am {endText(t.end_date)} – beenden?
        </Link>
      ) : null}
    </>
  );
}

// Aktions-Symbole (#2463): feste Größe (`shrink-0`), Tippfläche 44 px, Name zum Vorlesen - in Tabelle und Karte gleich.
const ACTION_CLASS = "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm transition-colors";
const ACTION_ICON = "h-4 w-4 shrink-0";

function RowActions({ tournament: t, isTournamentLead, onStatus, onDelete }) {
  return (
    <>
      <Link to={`/admin/tournaments/${t.id}?tab=participants`} title="Teilnehmer" aria-label={`Teilnehmer: ${t.title}`} className={`${ACTION_CLASS} hover:text-[#29B6E8]`}>
        <Users className={ACTION_ICON} aria-hidden="true" />
      </Link>
      {isTournamentLead && t.status === "draft" ? (
        <button type="button" onClick={() => onStatus(t.id, "registration_open")} title="Anmeldung öffnen" aria-label={`Anmeldung öffnen: ${t.title}`} className={`${ACTION_CLASS} hover:text-ok`}>
          <Play className={ACTION_ICON} aria-hidden="true" />
        </button>
      ) : null}
      {isTournamentLead && t.status === "live" ? (
        <button type="button" onClick={() => onStatus(t.id, "paused")} title="Pause" aria-label={`Pause: ${t.title}`} className={`${ACTION_CLASS} hover:text-brand`}>
          <Pause className={ACTION_ICON} aria-hidden="true" />
        </button>
      ) : null}
      {isTournamentLead && canDelete(t) ? (
        <button type="button" onClick={() => onDelete(t)} title="Löschen" aria-label={`Löschen: ${t.title}`} className={`${ACTION_CLASS} hover:text-live`}>
          <Trash2 className={ACTION_ICON} aria-hidden="true" />
        </button>
      ) : null}
    </>
  );
}

function RulePills({ tournament, compact = false }) {
  // Dieselbe Regel wie Server und Planungs-Warnung (#1132) - an einer Stelle: effectiveRuleModes.
  const { event_mode: eventMode, result_entry_mode: resultMode, schedule_mode: scheduleMode } = effectiveRuleModes(tournament);
  if (compact) {
    // Am Handy (#2463) eine Zeile statt drei Schilder.
    return (
      <p className="tls-type-small leading-snug text-white/50">
        {[EVENT_MODE_LABELS[eventMode] || eventMode, RESULT_ENTRY_MODE_LABELS[resultMode] || resultMode, SCHEDULE_MODE_LABELS[scheduleMode] || scheduleMode].filter(Boolean).join(" · ")}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      <RulePill label={EVENT_MODE_LABELS[eventMode] || eventMode} tone={eventMode === "local" ? "gold" : eventMode === "hybrid" ? "purple" : "cyan"} />
      <RulePill label={RESULT_ENTRY_MODE_LABELS[resultMode] || resultMode} />
      <RulePill label={SCHEDULE_MODE_LABELS[scheduleMode] || scheduleMode} />
    </div>
  );
}

function RulePill({ label, tone = "default" }) {
  const cls = tone === "cyan"
    ? "border-[#29B6E8]/35 bg-[#29B6E8]/10 text-[#29B6E8]"
    : tone === "gold"
      ? "border-white/35 bg-white/10 text-white"
      : tone === "purple"
        ? "border-[#9F7AEA]/35 bg-[#9F7AEA]/10 text-[#C4B5FD]"
        : "border-white/15 bg-white/5 text-white/60";
  return <span className={`rounded-sm border px-2 py-1 tls-type-label ${cls}`}>{label}</span>;
}
