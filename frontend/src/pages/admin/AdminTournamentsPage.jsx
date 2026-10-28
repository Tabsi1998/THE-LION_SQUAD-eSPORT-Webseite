import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminDenied } from "@/components/tls/AdminDenied";
import { deniedText } from "@/lib/loadProblem";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { Plus, Trash2, Play, Pause, Search, Users, Download } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { formatTournamentDisplay } from "@/lib/tournamentLabels";
import { effectiveRuleModes } from "@/lib/tournamentRulePresets";
import { gameLabel } from "@/lib/gameLabels";
import { downloadCsv, formatAdminDate, normalizeSearch } from "@/lib/adminListTools";
import { sortByNearestDate } from "@/lib/contentSort";
import { isStaffel, staffelBeforeStart } from "./tournament/StaffelParts";

const EVENT_MODE_LABELS = {
  hybrid: "Hybrid",
  local: "Vor Ort",
  online: "Online",
};
const RESULT_ENTRY_MODE_LABELS = {
  hybrid: "Ergebnis: Hybrid",
  player_confirmed: "Ergebnis: beide",
  staff_only: "Ergebnis: Staff",
};
const SCHEDULE_MODE_LABELS = {
  fixed_by_staff: "Termin: Staff",
  hybrid: "Termin: Hybrid",
  player_proposal: "Termin: Vorschlag",
};
const TOURNAMENT_STATUS_FILTERS = [
  ["", "Alle Status"],
  ["draft", "Entwurf"],
  ["scheduled", "Angekündigt"],
  ["registration_open", "Anmeldung offen"],
  ["registration_closed", "Anmeldung geschlossen"],
  ["live", "Live"],
  ["paused", "Pausiert"],
  ["completed", "Abgeschlossen"],
  ["results_published", "Ergebnisse online"],
  ["archived", "Archiviert"],
  ["cancelled", "Abgesagt"],
];
// Liga-Staffeln (#2109, S26): eigene Art in der Liste - leicht zu verwechseln, wenn sie zwischen den Turnieren stehen.
const KIND_FILTERS = [
  ["", "Turniere und Liga-Staffeln"],
  ["tournament", "Nur Turniere"],
  ["league", "Nur Liga-Staffeln"],
];
// Löschen einer Staffel nur vor dem Start (L-D3) - der Server prüft dazu, ob schon ein fester Spielplan steht.
const canDelete = (tournament) => !isStaffel(tournament) || staffelBeforeStart(tournament);

export default function AdminTournamentsPage() {
  // Globale Aktionen nur für die Turnierleitung mit Zwei-Faktor (#1028), Helfer sehen die ihres Einsatzes.
  const { isTournamentLead } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [list, setList] = useState([]);
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "");
  const [kindFilter, setKindFilter] = useState("");
  const confirm = useConfirm();
  const [denied, setDenied] = useState("");
  const load = useCallback(async () => {
    // Verwaltungsliste (#1028): die Turnierleitung bekommt alle Turniere, Helfer nur die ihres Einsatzes.
    try {
      const { data } = await api.get("/tournaments?include_drafts=true&managed=true");
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
      toast.success(`Status: ${status}`);
      // Punkte in einer abgeschlossenen Jahreswertung bleiben unverändert (#2123).
      if (response?.data?.season_points_note) toast.info(response.data.season_points_note, { duration: 10000 });
      load();
    } catch (e) {
      toast.error(formatRequestError(e, "Status konnte nicht geändert werden."));
    }
  };

  const del = async (tournament) => {
    if (!await confirm(isStaffel(tournament) ? {
      title: "Staffel löschen?",
      description: "Die Staffel wird dauerhaft gelöscht und verschwindet aus ihrer Season – mit den zugeteilten Co-Teams und der Spielplan-Vorschau. Das geht nur vor dem Start.",
      confirmLabel: "Löschen",
    } : {
      title: "Turnier löschen?",
      description: "Das Turnier wird dauerhaft gelöscht. Teilnehmer, Turnierbaum und öffentliche Detailseite sind danach nicht mehr verfügbar.",
      confirmLabel: "Löschen",
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
      if (kindFilter === "league" && !isStaffel(tournament)) return false;
      if (kindFilter === "tournament" && isStaffel(tournament)) return false;
      if (!q) return true;
      const haystack = normalizeSearch([
        tournament.title,
        tournament.slug,
        tournament.platform,
        tournament.format,
        tournament.format_label,
        tournament.league_label,
        tournament.game?.name,
        gameLabel(tournament.game),
      ].filter(Boolean).join(" "));
      return haystack.includes(q);
    });
  }, [kindFilter, query, sortedList, statusFilter]);

  const exportCsv = () => {
    downloadCsv(
      `tls-turniere-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Titel", "Slug", "Spiel", "Format", "Status", "Start", "Teilnehmer", "Max. Teilnehmer"],
      filteredList.map((tournament) => [
        tournament.title,
        tournament.slug,
        gameLabel(tournament.game),
        formatTournamentDisplay(tournament),
        tournament.status,
        formatAdminDate(tournament.start_date),
        tournament.participant_count,
        tournament.max_participants,
      ]),
    );
  };

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Turniere</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase">Turniere</h1>
        </div>
        {isTournamentLead && (
          <Link to="/admin/tournaments/new" data-testid="admin-new-tournament" className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] transition">
            <Plus className="w-4 h-4" /> Neues Turnier
          </Link>
        )}
      </div>
      <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_16rem_16rem_auto_auto]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <input
              value={query}
            onChange={(event) => updateFilterParams({ q: event.target.value })}
            data-testid="admin-tournament-search"
            className="w-full rounded-sm border border-white/10 bg-[#0A0A0A] py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-white/35 focus:border-[#29B6E8]/60 focus:outline-none"
            placeholder="Turnier, Spiel, Slug oder Plattform suchen"
          />
        </label>
        <select
          value={statusFilter}
          onChange={(event) => updateFilterParams({ status: event.target.value })}
          data-testid="admin-tournament-status-filter"
          className="w-full rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2.5 text-sm text-white focus:border-[#29B6E8]/60 focus:outline-none"
        >
          {TOURNAMENT_STATUS_FILTERS.map(([value, label]) => (
            <option key={value || "all"} value={value}>
              {label} ({value ? statusCounts[value] || 0 : list.length})
            </option>
          ))}
        </select>
        <select
          value={kindFilter}
          onChange={(event) => setKindFilter(event.target.value)}
          data-testid="admin-tournament-kind-filter"
          aria-label="Art"
          className="w-full rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2.5 text-sm text-white focus:border-[#29B6E8]/60 focus:outline-none"
        >
          {KIND_FILTERS.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}
        </select>
        <div className="flex items-center justify-end rounded-sm border border-white/10 bg-[#121212] px-3 py-2 text-xs font-bold uppercase tracking-wider text-white/55">
          {filteredList.length} / {list.length} sichtbar
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={filteredList.length === 0}
          className="inline-flex items-center justify-center gap-2 rounded-sm border border-white/15 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white/65 hover:border-[#29B6E8]/45 hover:text-white disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" /> CSV
        </button>
      </div>
      <div className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
        <div className="tls-swipe pb-0">
        <table className="w-full text-sm min-w-[860px]">
          <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
            <tr>
              <th className="text-left px-4 py-3">Titel</th>
              <th className="text-left px-4 py-3">Spiel</th>
              <th className="text-left px-4 py-3">Format</th>
              <th className="text-left px-4 py-3">Regeln</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Teilnehmer</th>
              <th className="text-right px-4 py-3">Aktion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filteredList.map((t) => (
              <tr key={t.id} data-testid={`admin-tr-${t.slug}`}>
                <td className="px-4 py-3">
                  <Link to={`/admin/tournaments/${t.id}`} className="font-semibold hover:text-[#29B6E8]">{t.title}</Link>
                  {/* Kennzeichen „Liga · Staffel A“ (#2109, S26) - der Server liefert es mit. */}
                  {isStaffel(t) && (
                    <span data-testid={`admin-tr-league-label-${t.slug}`} className="ml-2 inline-flex rounded-sm border border-[#29B6E8]/35 bg-[#29B6E8]/10 px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wider text-[#29B6E8]">
                      {t.league_label || `Liga · Staffel ${t.league_context.staffel || ""}`.trim()}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-white/70">{gameLabel(t.game) || "—"}</td>
                <td className="px-4 py-3 text-white/70">{formatTournamentDisplay(t)}</td>
                <td className="px-4 py-3">
                  <RulePills tournament={t} />
                </td>
                <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                <td className="px-4 py-3 text-right">{t.participant_count}/{t.max_participants}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Link to={`/admin/tournaments/${t.id}?tab=participants`} title="Teilnehmer" className="p-2 hover:text-[#29B6E8]"><Users className="w-3.5 h-3.5" /></Link>
                    {/* Eine Staffel hat keine Anmeldung (#2109) - sie startet in ihrer Verwaltung mit „Liga starten“. */}
                    {isTournamentLead && t.status === "draft" && !isStaffel(t) && <button onClick={() => setStatus(t.id, "registration_open")} title="Anmeldung öffnen" className="p-2 hover:text-ok"><Play className="w-3.5 h-3.5" /></button>}
                    {isTournamentLead && t.status === "live" && <button onClick={() => setStatus(t.id, "paused")} title="Pause" className="p-2 hover:text-[#FFD700]"><Pause className="w-3.5 h-3.5" /></button>}
                    {isTournamentLead && canDelete(t) && <button onClick={() => del(t)} className="p-2 hover:text-[#FF3B30]" title="Löschen"><Trash2 className="w-3.5 h-3.5" /></button>}
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
    </AdminLayout>
  );
}

function RulePills({ tournament }) {
  // Dieselbe Regel wie Server und Planungs-Warnung (#1132) - an einer Stelle: effectiveRuleModes.
  const { event_mode: eventMode, result_entry_mode: resultMode, schedule_mode: scheduleMode } = effectiveRuleModes(tournament);
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
      ? "border-[#FFD700]/35 bg-[#FFD700]/10 text-[#FFD700]"
      : tone === "purple"
        ? "border-[#9F7AEA]/35 bg-[#9F7AEA]/10 text-[#C4B5FD]"
        : "border-white/15 bg-white/5 text-white/60";
  return <span className={`rounded-sm border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${cls}`}>{label}</span>;
}
