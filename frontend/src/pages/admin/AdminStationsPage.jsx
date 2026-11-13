import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { API, api, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { SelectField, TextField } from "@/components/tls/FormFields";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useAuth } from "@/context/AuthContext";
import { formatBracketSection, formatDeviceType, formatMatchKind, formatScheduleGroupLabel } from "@/lib/tournamentLabels";
import { formatDateTime } from "@/lib/datetime";
import { isArchivedGame, selectableGames } from "@/lib/gameLabels";
import { finderFor, sourceLabel } from "@/lib/slotSource";
import { ExternalLink, Pencil, Plus, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { ResultWindowLoader } from "@/components/tls/results/ResultWindow";
import { ResultUndoBar, useResultUndo } from "@/components/tls/results/ResultUndoBar";
import { planAndApplySchedule } from "@/lib/schedulePlan";
import { effectiveMatchDuration } from "@/lib/matchDuration";
import { buildTimeline } from "@/lib/matchTimeline";
import { moveMatch } from "@/lib/schedulePlan";
import { StationTimeline } from "./tournament/matchplan/StationTimeline";
import { StationAgenda } from "./tournament/matchplan/MatchPlanParts";

const DEVICES = [
  ["switch", "Switch"], ["switch2", "Switch 2"], ["pc", "PC"], ["ps5", "PS5"], ["xbox", "Xbox"],
  ["racing_rig", "Renn-Setup"], ["beamer", "Beamer"],
  ["stream_setup", "Übertragungsplatz"], ["admin_desk", "Orga-Tisch"],
];

// Welches Turnier die Stationen-Seite zeigt (#2111, TA26): Stationen gibt es vor Ort und hybrid. Diese Turniere stehen
// oben (solange sie nicht vorbei sind), vorgewählt ist ein laufendes; alle übrigen folgen unter „Weitere Turniere“.
const STATION_OVER = new Set(["completed", "results_published", "archived", "cancelled"]);
const STATION_RUNNING = new Set(["check_in", "live", "paused"]);
const stationTournament = (tournament) => ["local", "hybrid"].includes(tournament?.event_mode) && !STATION_OVER.has(tournament?.status);

export function stationTournamentGroups(rows = []) {
  const onsite = rows.filter(stationTournament);
  const others = rows.filter((tournament) => !stationTournament(tournament));
  return { onsite, others };
}

export function preferredStationTournament(rows = [], current = "") {
  if (rows.some((row) => row.id === current)) return current;
  const { onsite } = stationTournamentGroups(rows);
  return (onsite.find((row) => STATION_RUNNING.has(row.status)) || onsite[0] || rows[0])?.id || "";
}

function stationExportUrl(tournamentId, orientation) {
  if (!tournamentId || !/^[A-Za-z0-9_-]+$/.test(String(tournamentId))) return "#";
  const params = new URLSearchParams({ orientation });
  return `${API}/exports/tournaments/${encodeURIComponent(tournamentId)}/stations.pdf?${params.toString()}`;
}

// Die Live-Knöpfe (Aufrufen, Starten, Freigeben, Defekt, Umlegen) stehen seit #1162 nur noch in der Turnierleitung
// (/tournaments/<slug>/leitung, Reiter „Stationen“) - hier bleiben Anlegen, Bearbeiten, Planen, Aushang und die Belegung.
export function leadStationsUrl(tournament) {
  const ref = tournament?.slug || tournament?.id;
  return ref ? `/tournaments/${encodeURIComponent(ref)}/leitung?reiter=stationen` : "";
}

export default function AdminStationsPage() {
  // Globale Aktionen nur für die Turnierleitung mit Zwei-Faktor (#1028), Helfer sehen die ihres Einsatzes.
  const { isTournamentLead } = useAuth();
  const [list, setList] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [activeTid, setActiveTid] = useState("");
  const [matches, setMatches] = useState([]);
  const [regs, setRegs] = useState([]);
  // Für die Belegung (#1557): Turnier, Phasen und Spiel-Daten aus derselben Antwort - die Zeitleiste rechnet nichts selbst.
  const [context, setContext] = useState({ tournament: null, stages: [], game: null });
  const [loadingStations, setLoadingStations] = useState(false);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [pageError, setPageError] = useState("");
  const [form, setForm] = useState({ name: "", device_type: "switch", notes: "" });
  const [bulk, setBulk] = useState({ prefix: "Station", count: 4, device_type: "switch", notes: "" });
  const [editing, setEditing] = useState(null);
  // Das eine Ergebnis-Fenster (#1370) statt eigener Formulare je Station.
  const [resultFor, setResultFor] = useState("");
  const stationsRequestRef = useRef(0);
  const matchesRequestRef = useRef(0);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    try {
      const { data: t } = await api.get("/tournaments?include_drafts=true&managed=true");
      const rows = Array.isArray(t) ? t.filter(Boolean) : [];
      setTournaments(rows);
      setActiveTid((current) => preferredStationTournament(rows, current));
      setPageError("");
    } catch (e) {
      setTournaments([]);
      setActiveTid("");
      setPageError(formatRequestError(e, "Turniere konnten nicht geladen werden."));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["tournaments"]);

  const loadStations = useCallback(async () => {
    const requestId = stationsRequestRef.current + 1;
    stationsRequestRef.current = requestId;
    if (!activeTid) {
      setList([]);
      setLoadingStations(false);
      return;
    }
    setLoadingStations(true);
    try {
      const { data } = await api.get(`/stations?tournament_id=${encodeURIComponent(activeTid)}`);
      if (stationsRequestRef.current !== requestId) return;
      setList(Array.isArray(data) ? data.filter(Boolean) : []);
      setPageError("");
    } catch (e) {
      if (stationsRequestRef.current !== requestId) return;
      setList([]);
      setPageError(formatRequestError(e, "Stationen konnten nicht geladen werden."));
    } finally {
      if (stationsRequestRef.current === requestId) setLoadingStations(false);
    }
  }, [activeTid]);
  useEffect(() => { loadStations(); }, [loadStations]);

  const loadMatches = useCallback(async () => {
    const requestId = matchesRequestRef.current + 1;
    matchesRequestRef.current = requestId;
    if (!activeTid) {
      setMatches([]);
      setRegs([]);
      setLoadingMatches(false);
      return;
    }
    setLoadingMatches(true);
    try {
      const { data } = await api.get(`/tournaments/${activeTid}/bracket`);
      if (matchesRequestRef.current !== requestId) return;
      const tournament = data?.tournament || {};
      // Die Dauer aus der einen Kette (#1554): Spiel, Phase, Turnier, Spiel-Modus - nichts ist mehr eingefroren.
      const stageById = new Map(safeArray(data?.stages).map((stage) => [stage?.id, stage]));
      const durationOf = (m) => effectiveMatchDuration(m, { stage: stageById.get(m.stage_id), tournament, game: data?.duration_game });
      setMatches(safeArray(data?.matches_v2).map((m) => ({ ...m, is_multi_slot: true, tournament, planned_minutes: durationOf(m) })));
      setRegs(safeArray(data?.registrations));
      setContext({ tournament, stages: safeArray(data?.stages), game: data?.duration_game || null });
      setPageError("");
    } catch (e) {
      if (matchesRequestRef.current !== requestId) return;
      setMatches([]);
      setRegs([]);
      setPageError(formatRequestError(e, "Spiele konnten nicht geladen werden."));
    } finally {
      if (matchesRequestRef.current === requestId) setLoadingMatches(false);
    }
  }, [activeTid]);
  useEffect(() => { loadMatches(); }, [loadMatches]);
  // Live (#1557): Änderungsstrom, und ohne Strom alle 15 Sekunden - am Turniertag hängt die Halle an dieser Seite.
  const refreshLive = useCallback(() => Promise.all([loadStations(), loadMatches()]), [loadStations, loadMatches]);
  useLiveRefresh(refreshLive, ["stations", "matches", "tournaments"], { fallbackMs: 15000 });
  const resultUndo = useResultUndo({ onDone: () => { loadStations(); loadMatches(); } });
  useEffect(() => {
    setList([]);
    setMatches([]);
    setRegs([]);
    setPageError("");
  }, [activeTid]);

  const create = async (e) => {
    e.preventDefault();
    try {
      await api.post("/stations", { ...form, tournament_id: activeTid || null });
      toast.success("Station angelegt.");
      setForm({ name: "", device_type: "switch", notes: "" });
      loadStations();
    } catch (e) {
      toast.error(formatRequestError(e, "Station konnte nicht angelegt werden.", { name: form.name }));
    }
  };
  const createBulk = async () => {
    try {
      const { data } = await api.post("/stations/bulk", {
        ...bulk,
        count: Number(bulk.count),
        tournament_id: activeTid,
      });
      toast.success(`${data.created} Stationen angelegt.`);
      loadStations();
    } catch (e) {
      toast.error(formatRequestError(e, "Stationen konnten nicht angelegt werden."));
    }
  };
  const del = async (id) => {
    if (!await confirm({
      title: "Station löschen?",
      description: "Die Station wird entfernt und kann danach nicht mehr für Spiele zugewiesen werden.",
      confirmLabel: "Löschen",
    })) return;
    try {
      await api.delete(`/stations/${id}`);
      toast.success("Station gelöscht.");
      loadStations();
    } catch (e) {
      toast.error(formatRequestError(e, "Station konnte nicht gelöscht werden."));
    }
  };
  // Spielplaner (#1552): Vorschau im Dialog, geschrieben wird erst nach „Übernehmen“ - wie auf der Turnierseite.
  const autoAssign = async () => {
    if (!activeTid) return;
    if (await planAndApplySchedule({ tournamentId: activeTid, confirm })) { loadStations(); loadMatches(); }
  };

  // Belegung je Station (#1557): dieselbe Zeitleiste wie im Matchplan, aus denselben Daten.
  const timeline = useMemo(() => buildTimeline({
    matches, stations: list, stages: context.stages, tournament: context.tournament, game: context.game, registrations: regs,
  }), [matches, list, context, regs]);
  const regById = Object.fromEntries(safeArray(regs).filter((r) => r?.id).map((r) => [r.id, r]));
  const matchById = Object.fromEntries(safeArray(matches).filter((m) => m?.id).map((m) => [m.id, m]));
  const unassignedMatches = safeArray(matches).filter(
    (m) => !m.station_id && ["ready", "scheduled"].includes(m.status)
  );
  const occupiedMatchIds = new Set(safeArray(list).map((station) => station.current_match_id).filter(Boolean));
  const groups = stationTournamentGroups(tournaments);
  const queuedMatches = safeArray(matches)
    .filter((m) => m.station_id && ["ready", "scheduled"].includes(m.status))
    .sort((a, b) => (Date.parse(a.scheduled_at || "") || Number.MAX_SAFE_INTEGER) - (Date.parse(b.scheduled_at || "") || Number.MAX_SAFE_INTEGER));
  const plannedQueue = queuedMatches.filter((m) => !occupiedMatchIds.has(m.id));
  const leadUrl = leadStationsUrl(tournaments.find((row) => row.id === activeTid));

  // Leere Plätze im Klartext (#1113): „Sieger aus A“ statt „W:A:1“.
  const findIn = finderFor(safeArray(matches));
  const nameOfMatch = (m) => {
    if (!m) return "—";
    if (m.is_multi_slot || m.slots) {
      const names = safeArray(m.slots)
        .map((slot) => regById[slot?.registration_id]?.display_name || sourceLabel(slot?.source, findIn(m)) || "Offen");
      return `${m.match_key || "Durchgang"} · ${names.join(" / ")}`;
    }
    const a = regById[m.participant_a_id]?.display_name || "Offen";
    const b = regById[m.participant_b_id]?.display_name || "Offen";
    return `${a} gegen ${b}`;
  };
  const detailOfMatch = (m) => {
    if (!m) return "Spiel";
    const section = m.section ? `${formatBracketSection(m.section)} · ` : "";
    return `${section}${formatScheduleGroupLabel(m, m.tournament)} · ${formatMatchKind(m)}`;
  };

  const moveOnTimeline = async (item, next) => {
    const result = await moveMatch(item.id, { start: next.start, stationId: next.laneId });
    if (result.ok) { loadStations(); loadMatches(); }
    return result;
  };

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Event-Einrichtung</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 mb-6">Stationen</h1>
      {pageError && (
        <div className="mb-4 border border-[#FF3B30]/30 bg-[#FF3B30]/10 text-[#FFB3B3] px-4 py-3 rounded-sm text-sm">
          {pageError}
        </div>
      )}
      <div className="mb-6 border border-white/10 rounded-sm bg-[#121212] p-4 flex flex-col lg:flex-row gap-3 lg:items-end lg:justify-between">
        <label className="block flex-1">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Aktives Turnier</div>
          <select value={activeTid} onChange={(e) => setActiveTid(e.target.value)} data-testid="station-tournament-select" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
            {!tournaments.length && <option value="">Keine Turniere verfügbar</option>}
            {groups.onsite.length > 0 && groups.others.length > 0 ? (
              <>
                <optgroup label="Vor Ort und hybrid">
                  {groups.onsite.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </optgroup>
                <optgroup label="Weitere Turniere">
                  {groups.others.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </optgroup>
              </>
            ) : tournaments.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </label>
        {(() => {
          const portraitUrl = stationExportUrl(activeTid, "portrait");
          const landscapeUrl = stationExportUrl(activeTid, "landscape");
          const disabled = !activeTid || !list.length || portraitUrl === "#";
          return (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <a
            href={portraitUrl}
            target="_blank"
            rel="noreferrer"
            aria-disabled={disabled}
            className={`px-4 py-2 border border-white/20 text-white/80 font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2 text-xs ${disabled ? "pointer-events-none opacity-40" : "hover:border-[#29B6E8]/50 hover:text-[#29B6E8]"}`}
          >
            PDF Hochformat
          </a>
          <a
            href={landscapeUrl}
            target="_blank"
            rel="noreferrer"
            aria-disabled={disabled}
            className={`px-4 py-2 border border-[#29B6E8]/40 text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2 text-xs ${disabled ? "pointer-events-none opacity-40" : "hover:bg-[#29B6E8]/10"}`}
          >
            PDF Querformat
          </a>
        </div>
          );
        })()}
        <button type="button" onClick={autoAssign} disabled={!list.length || !unassignedMatches.length} data-testid="stations-plan-schedule" className="px-4 py-2 border border-[#29B6E8]/50 text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2 disabled:opacity-40">
          <Wand2 className="w-4 h-4" /> Zeitplan füllen
        </button>
      </div>

      {leadUrl ? (
        <div className="mb-6 flex flex-col gap-3 rounded-sm border border-[#29B6E8]/30 bg-[#29B6E8]/5 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="stations-lead-link">
          <p className="text-sm text-white/70">Aufrufen, Starten, Freigeben, Defekt und Umlegen stehen am Turniertag in der <span className="font-bold text-white">Turnierleitung</span> – am Handy und am PC.</p>
          <Link to={leadUrl} className="tls-btn tls-btn--primary inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider">
            <ExternalLink className="h-4 w-4" aria-hidden="true" /> Stationen live bedienen
          </Link>
        </div>
      ) : null}

      {activeTid && timeline.items.length > 0 && (
        <section className="mp-card mb-6" aria-label="Belegung je Station" data-testid="stations-timeline">
          <div className="mp-card__head">
            <h2 className="mp-card__title">Belegung je Station</h2>
            <Link to={`/admin/tournaments/${encodeURIComponent(activeTid)}?tab=matchplan`} className="mp-link">Im Matchplan öffnen</Link>
          </div>
          <div className="mp-desktop-only">
            <StationTimeline timeline={timeline} editable onMove={moveOnTimeline} showNow />
          </div>
          <div className="mp-mobile-only">
            <StationAgenda timeline={timeline} />
          </div>
        </section>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* LEFT: Create form + unassigned matches queue */}
        <div className="space-y-6">
          {isTournamentLead && <form onSubmit={create} className="border border-white/10 rounded-sm bg-[#121212] p-5 space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Einzelne Station</div>
            <input placeholder="Name (z.B. Switch 1)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="station-name" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
            <select value={form.device_type} onChange={(e) => setForm({ ...form, device_type: e.target.value })} data-testid="station-device" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
              {DEVICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input placeholder="Hinweis (öffentlich sichtbar, optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="station-notes" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
            <button data-testid="station-submit" className="w-full px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2"><Plus className="w-4 h-4" /> Anlegen</button>
          </form>}

          {isTournamentLead && <div className="border border-white/10 rounded-sm bg-[#121212] p-5 space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Schnell-Setup</div>
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Namensanfang" aria-label="Namensanfang" value={bulk.prefix} onChange={(e) => setBulk({ ...bulk, prefix: e.target.value })} className="bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
              <input type="number" min="1" max="64" value={bulk.count} onChange={(e) => setBulk({ ...bulk, count: e.target.value })} className="bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
            </div>
            <select value={bulk.device_type} onChange={(e) => setBulk({ ...bulk, device_type: e.target.value })} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
              {DEVICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input placeholder="Hinweis für alle Stationen (öffentlich sichtbar)" value={bulk.notes} onChange={(e) => setBulk({ ...bulk, notes: e.target.value })} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
            <button type="button" onClick={createBulk} disabled={!activeTid} className="w-full px-4 py-2 border border-[#29B6E8]/50 text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2 disabled:opacity-40">
              <Plus className="w-4 h-4" /> Mehrere anlegen
            </button>
          </div>}

          <div className="border border-white/10 rounded-sm bg-[#121212] p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Offene Spiele</div>
            </div>
            <div className="space-y-1.5 max-h-[360px] overflow-y-auto">
              {unassignedMatches.map((m) => (
                <div key={m.id} data-testid={`match-unassigned-${m.id}`} className="p-2 border border-white/10 rounded-sm text-xs bg-[#0A0A0A] hover:border-[#29B6E8]/40">
                  <div className="text-white/40 text-[10px] uppercase tracking-widest">{detailOfMatch(m)}</div>
                  <div className="text-white font-semibold mt-0.5 truncate">{nameOfMatch(m)}</div>
                  <div className="mt-1 text-white/40">{m.scheduled_at ? formatDateTime(m.scheduled_at) : "Keine feste Zeit"}{m.planned_minutes ? ` · ${m.planned_minutes} Min.` : ""}</div>
                </div>
              ))}
              {loadingMatches && <div className="text-white/40 text-xs text-center py-6">Spiele werden geladen …</div>}
              {!loadingMatches && unassignedMatches.length === 0 && <div className="text-white/40 text-xs text-center py-6">Keine offenen Spiele</div>}
            </div>
          </div>
          <div className="border border-white/10 rounded-sm bg-[#121212] p-5">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-3">Geplante Warteschlange</div>
            <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
              {plannedQueue.map((m) => (
                <div key={m.id} className="p-2 border border-white/10 rounded-sm text-xs bg-[#0A0A0A]">
                  <div className="text-white/40 text-[10px] uppercase tracking-widest">{detailOfMatch(m)}</div>
                  <div className="text-white font-semibold mt-0.5 truncate">{nameOfMatch(m)}</div>
                  <div className="mt-1 text-white/40">Station {stationName(m.station_id, list)}{m.scheduled_at ? ` · ${formatDateTime(m.scheduled_at)}` : ""}</div>
                </div>
              ))}
              {plannedQueue.length === 0 && <div className="text-white/40 text-xs text-center py-6">Keine geplanten Spiele</div>}
            </div>
          </div>
        </div>

        {/* RIGHT: Stations grid */}
        <div className="lg:col-span-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {safeArray(list).map((s) => {
              const currentMatch = s.current_match_id ? matchById[s.current_match_id] : null;
              return (
              <div key={s.id} className={`border rounded-sm bg-[#121212] p-4 ${s.status === "busy" ? "border-[#FF3B30]/30" : "border-white/10"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">{formatDeviceType(s.device_type)}</div>
                    <div className="font-heading text-lg font-bold">{s.name}</div>
                  </div>
                  {isTournamentLead && (
                    <div className="flex shrink-0 gap-1">
                      <button type="button" onClick={() => setEditing(s)} aria-label={`${s.name} bearbeiten`} data-testid={`station-edit-${s.id}`} className="p-2 text-white/50 hover:text-[#29B6E8]"><Pencil className="w-4 h-4" /></button>
                      <button type="button" onClick={() => del(s.id)} aria-label={`${s.name} löschen`} className="p-2 text-white/40 hover:text-live"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <StatusBadge status={s.status} />
                </div>
                {/* Current match */}
                {s.current_match_id ? (
                  <div className="mt-3 p-2 border border-[#29B6E8]/30 bg-[#29B6E8]/5 rounded-sm">
                    <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">{s.status === "reserved" ? "Reserviert" : "Aktuell"}</div>
                    <div className="text-sm text-white truncate">{currentMatch ? nameOfMatch(currentMatch) : "Spiel wird geladen oder ist nicht mehr vorhanden"}</div>
                    {currentMatch?.scheduled_at && <div className="mt-1 text-[11px] text-white/45">{formatDateTime(currentMatch.scheduled_at)}</div>}
                    {currentMatch ? (
                      <button type="button" onClick={() => setResultFor(currentMatch.id)} className="mt-3 w-full px-3 py-2 bg-[#29B6E8] text-black rounded-sm text-[10px] font-bold uppercase tracking-widest" data-testid={`station-result-${s.id}`}>Ergebnis eintragen</button>
                    ) : null}
                  </div>
                ) : null}
                {s.notes && <div className="mt-2 text-white/50 text-xs">{s.notes}</div>}
              </div>
              );
            })}
            {loadingStations && <div className="col-span-2 text-center py-16 text-white/40 font-display tracking-widest">STATIONEN WERDEN GELADEN …</div>}
            {!loadingStations && safeArray(list).length === 0 && <div className="col-span-2 text-center py-16 text-white/40 font-display tracking-widest">KEINE STATIONEN</div>}
          </div>
        </div>
      </div>

      {editing && <StationEditSheet station={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); loadStations(); }} />}
      {resultFor ? <ResultWindowLoader matchId={resultFor} onClose={() => setResultFor("")} onSaved={resultUndo.start} /> : null}
      <ResultUndoBar undo={resultUndo} />
    </AdminLayout>
  );
}

// Station bearbeiten (#2112): Name, Gerät, Spiel und Hinweis nach dem Anlegen ändern. Ein Gerät, das die Liste nicht kennt,
// bleibt wählbar - sonst würde das Speichern es still überschreiben.
function StationEditSheet({ station, onClose, onSaved }) {
  const [form, setForm] = useState({ name: station.name || "", device_type: station.device_type || "switch", game_id: station.game_id || "", notes: station.notes || "" });
  const [games, setGames] = useState([]);
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    let live = true;
    api.get("/games").then(({ data }) => { if (live) setGames(safeArray(data)); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const devices = DEVICES.some(([key]) => key === form.device_type) ? DEVICES : [...DEVICES, [form.device_type, formatDeviceType(form.device_type)]];
  const gameOptions = [["", "Kein bestimmtes Spiel"], ...selectableGames(games, form.game_id).map((game) => [game.id, `${game.name || game.title || game.id}${isArchivedGame(game) ? " – archiviert" : ""}`])];
  if (form.game_id && !games.some((game) => game.id === form.game_id)) gameOptions.push([form.game_id, "Bisher gewähltes Spiel"]);
  const submit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) { toast.error("Bitte einen Namen angeben."); return; }
    setSaving(true);
    try {
      await api.patch(`/stations/${station.id}`, { name: form.name.trim(), device_type: form.device_type, game_id: form.game_id || null, notes: form.notes.trim() || null });
      toast.success("Station gespeichert.");
      onSaved();
    } catch (e) {
      toast.error(formatRequestError(e, "Station konnte nicht gespeichert werden.", { name: form.name }));
      setSaving(false);
    }
  };
  return (
    <AdminSheet title="Station bearbeiten" eyebrow={station.name} onClose={onClose} onSubmit={submit} saving={saving} submitTestId="station-edit-save" testId="station-edit-sheet">
      <TextField label="Name" value={form.name} onChange={(value) => set("name", value)} maxLength={120} required testId="station-edit-name" />
      <SelectField label="Gerät" value={form.device_type} onChange={(value) => set("device_type", value)} options={devices} testId="station-edit-device" />
      <SelectField label="Spiel" value={form.game_id} onChange={(value) => set("game_id", value)} options={gameOptions} testId="station-edit-game" />
      <TextField label="Hinweis" value={form.notes} onChange={(value) => set("notes", value)} maxLength={500} hint="Öffentlich sichtbar, zum Beispiel „Tisch hinten links“." testId="station-edit-notes" />
    </AdminSheet>
  );
}

function safeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function stationName(stationId, stations) {
  const station = safeArray(stations).find((item) => item.id === stationId);
  return station?.name || station?.label || stationId || "offen";
}
