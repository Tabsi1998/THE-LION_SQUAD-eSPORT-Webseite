import { useCallback, useEffect, useRef, useState } from "react";
import { API, api, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useAuth } from "@/context/AuthContext";
import { formatBracketSection, formatDeviceType, formatMatchKind, formatMatchStatus, formatScheduleGroupLabel } from "@/lib/tournamentLabels";
import { formatDateTime } from "@/lib/datetime";
import { finderFor, sourceLabel } from "@/lib/slotSource";
import { Plus, Trash2, Link as LinkIcon, X as XIcon, Wand2, Play } from "lucide-react";
import { toast } from "sonner";
import { ResultWindowLoader } from "@/components/tls/results/ResultWindow";
import { ResultUndoBar, useResultUndo } from "@/components/tls/results/ResultUndoBar";

const DEVICES = [
  ["switch", "Switch"], ["switch2", "Switch 2"], ["pc", "PC"],
  ["racing_rig", "Renn-Setup"], ["beamer", "Beamer"],
  ["stream_setup", "Übertragungsplatz"], ["admin_desk", "Orga-Tisch"],
];
const STATUSES = ["free", "busy", "broken", "reserved"];

function stationExportUrl(tournamentId, orientation) {
  if (!tournamentId || !/^[A-Za-z0-9_-]+$/.test(String(tournamentId))) return "#";
  const params = new URLSearchParams({ orientation });
  return `${API}/exports/tournaments/${encodeURIComponent(tournamentId)}/stations.pdf?${params.toString()}`;
}

export default function AdminStationsPage() {
  // Globale Aktionen nur für die Turnierleitung mit Zwei-Faktor (#1028), Helfer sehen die ihres Einsatzes.
  const { isTournamentLead: isAdmin } = useAuth();
  const [list, setList] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [activeTid, setActiveTid] = useState("");
  const [matches, setMatches] = useState([]);
  const [regs, setRegs] = useState([]);
  const [loadingStations, setLoadingStations] = useState(false);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [pageError, setPageError] = useState("");
  const [form, setForm] = useState({ name: "", device_type: "switch", notes: "" });
  const [bulk, setBulk] = useState({ prefix: "Station", count: 4, device_type: "switch", notes: "" });
  const [assignFor, setAssignFor] = useState(null); // station object for assignment dialog
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
      setActiveTid((current) => rows.some((row) => row.id === current) ? current : rows?.[0]?.id || "");
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
  useApiInvalidation(loadStations, ["stations", "tournaments"]);

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
      setMatches(safeArray(data?.matches_v2).map((m) => ({ ...m, is_multi_slot: true, tournament })));
      setRegs(safeArray(data?.registrations));
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
  useApiInvalidation(loadMatches, ["stations", "matches", "tournaments"]);
  const resultUndo = useResultUndo({ onDone: () => { loadStations(); loadMatches(); } });
  useEffect(() => {
    setAssignFor(null);
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
  const updateStatus = async (id, status) => {
    try {
      await api.patch(`/stations/${id}`, { status });
      loadStations();
    } catch (e) {
      toast.error(formatRequestError(e, "Stationsstatus konnte nicht gespeichert werden."));
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
  const assign = async (sid, mid, startNow = false) => {
    try {
      await api.post(`/stations/${sid}/assign/${mid}${startNow ? "?start_now=true" : ""}`);
      toast.success(startNow ? "Spiel gestartet." : "Spiel zugewiesen.");
      setAssignFor(null);
      loadStations(); loadMatches();
    } catch (e) {
      toast.error(formatRequestError(e, "Spiel konnte nicht zugewiesen werden."));
    }
  };
  const autoAssign = async () => {
    if (!activeTid) return;
    try {
      const { data } = await api.post(`/stations/auto-assign?tournament_id=${encodeURIComponent(activeTid)}&plan=true`);
      toast.success(`${data.assigned} Spiele geplant.`);
      loadStations(); loadMatches();
    } catch (e) {
      toast.error(formatRequestError(e, "Automatische Planung konnte nicht ausgeführt werden."));
    }
  };
  const startFreeStations = async () => {
    if (!activeTid) return;
    try {
      const { data } = await api.post(`/stations/auto-assign?tournament_id=${encodeURIComponent(activeTid)}&start_now=true&plan=false`);
      toast.success(`${data.assigned} Spiel${Number(data.assigned) === 1 ? "" : "e"} gestartet.`);
      loadStations(); loadMatches();
    } catch (e) {
      toast.error(formatRequestError(e, "Freie Stationen konnten nicht gestartet werden."));
    }
  };
  const clearStation = async (sid) => {
    try {
      await api.post(`/stations/${sid}/clear`);
      toast.success("Station freigegeben.");
      loadStations(); loadMatches();
    } catch (e) {
      toast.error(formatRequestError(e, "Station konnte nicht freigegeben werden."));
    }
  };

  const regById = Object.fromEntries(safeArray(regs).filter((r) => r?.id).map((r) => [r.id, r]));
  const matchById = Object.fromEntries(safeArray(matches).filter((m) => m?.id).map((m) => [m.id, m]));
  const unassignedMatches = safeArray(matches).filter(
    (m) => !m.station_id && ["ready", "scheduled"].includes(m.status)
  );
  const occupiedMatchIds = new Set(safeArray(list).map((station) => station.current_match_id).filter(Boolean));
  const queuedMatches = safeArray(matches)
    .filter((m) => m.station_id && ["ready", "scheduled"].includes(m.status))
    .sort((a, b) => (Date.parse(a.scheduled_at || "") || Number.MAX_SAFE_INTEGER) - (Date.parse(b.scheduled_at || "") || Number.MAX_SAFE_INTEGER));
  const plannedQueue = queuedMatches.filter((m) => !occupiedMatchIds.has(m.id));
  const freeStations = safeArray(list).filter((station) => ["free", "reserved"].includes(station.status) && !station.current_match_id);
  const startableCount = safeArray(matches).filter((m) => ["ready", "scheduled"].includes(m.status)).length;

  // Leere Plätze im Klartext (#1113): „Sieger aus A“ statt „W:A:1“.
  const findIn = finderFor(safeArray(matches));
  const nameOfMatch = (m) => {
    if (!m) return "—";
    if (m.is_multi_slot || m.slots) {
      const names = safeArray(m.slots)
        .map((slot) => regById[slot?.registration_id]?.display_name || sourceLabel(slot?.source, findIn(m)) || "Offen")
        .slice(0, 4);
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
            {tournaments.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
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
        <button type="button" onClick={autoAssign} disabled={!list.length || !unassignedMatches.length} className="px-4 py-2 border border-[#29B6E8]/50 text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2 disabled:opacity-40">
          <Wand2 className="w-4 h-4" /> Zeitplan füllen
        </button>
        <button type="button" onClick={startFreeStations} disabled={!freeStations.length || !startableCount} className="px-4 py-2 bg-[#00FF88] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2 disabled:opacity-40">
          <Play className="w-4 h-4" /> Freie Stationen starten
        </button>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* LEFT: Create form + unassigned matches queue */}
        <div className="space-y-6">
          {isAdmin && <form onSubmit={create} className="border border-white/10 rounded-sm bg-[#121212] p-5 space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Einzelne Station</div>
            <input placeholder="Name (z.B. Switch 1)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="station-name" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
            <select value={form.device_type} onChange={(e) => setForm({ ...form, device_type: e.target.value })} data-testid="station-device" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
              {DEVICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input placeholder="Hinweis (öffentlich sichtbar, optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="station-notes" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
            <button data-testid="station-submit" className="w-full px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2"><Plus className="w-4 h-4" /> Anlegen</button>
          </form>}

          {isAdmin && <div className="border border-white/10 rounded-sm bg-[#121212] p-5 space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Schnell-Setup</div>
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Prefix" value={bulk.prefix} onChange={(e) => setBulk({ ...bulk, prefix: e.target.value })} className="bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
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
                  <div className="mt-1 text-white/40">{m.scheduled_at ? formatDateTime(m.scheduled_at) : "Keine feste Zeit"}{m.duration_minutes ? ` · ${m.duration_minutes} Min.` : ""}</div>
                </div>
              ))}
              {loadingMatches && <div className="text-white/40 text-xs text-center py-6">Spiele werden geladen …</div>}
              {!loadingMatches && unassignedMatches.length === 0 && <div className="text-white/40 text-xs text-center py-6">Keine offenen Spiele</div>}
            </div>
          </div>
          <div className="border border-white/10 rounded-sm bg-[#121212] p-5">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-3">Geplante Queue</div>
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
                  {isAdmin && <button onClick={() => del(s.id)} className="p-1 text-white/40 hover:text-[#FF3B30]"><Trash2 className="w-4 h-4" /></button>}
                </div>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <StatusBadge status={s.status} />
                  {isAdmin && <select value={s.status} onChange={(e) => updateStatus(s.id, e.target.value)} data-testid={`station-status-${s.id}`} className="bg-[#0A0A0A] border border-white/10 px-2 py-1 rounded-sm text-xs">
                    {STATUSES.map((st) => <option key={st} value={st}>{formatMatchStatus(st)}</option>)}
                  </select>}
                </div>
                {/* Current match */}
                {s.current_match_id ? (
                  <div className="mt-3 p-2 border border-[#29B6E8]/30 bg-[#29B6E8]/5 rounded-sm">
                    <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">{s.status === "reserved" ? "Reserviert" : "Aktuell"}</div>
                    <div className="text-sm text-white truncate">{currentMatch ? nameOfMatch(currentMatch) : "Spiel wird geladen oder ist nicht mehr vorhanden"}</div>
                    {currentMatch?.scheduled_at && <div className="mt-1 text-[11px] text-white/45">{formatDateTime(currentMatch.scheduled_at)}</div>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {s.status === "reserved" && currentMatch && <button onClick={() => assign(s.id, s.current_match_id, true)} className="text-[10px] text-[#00FF88] font-bold uppercase tracking-widest hover:underline inline-flex items-center gap-1"><Play className="w-3 h-3" /> Starten</button>}
                      <button onClick={() => clearStation(s.id)} data-testid={`station-clear-${s.id}`} className="text-[10px] text-[#FF3B30] font-bold uppercase tracking-widest hover:underline inline-flex items-center gap-1"><XIcon className="w-3 h-3" /> Freigeben</button>
                    </div>
                    {currentMatch ? (
                      <button type="button" onClick={() => setResultFor(currentMatch.id)} className="mt-3 w-full px-3 py-2 bg-[#29B6E8] text-black rounded-sm text-[10px] font-bold uppercase tracking-widest" data-testid={`station-result-${s.id}`}>Ergebnis eintragen</button>
                    ) : null}
                  </div>
                ) : (
                  <button onClick={() => setAssignFor(s)} data-testid={`station-assign-${s.id}`} className="mt-3 w-full py-2 border border-dashed border-white/20 rounded-sm text-xs text-white/60 hover:text-[#29B6E8] hover:border-[#29B6E8] inline-flex items-center justify-center gap-2">
                    <LinkIcon className="w-3.5 h-3.5" /> Spiel zuweisen
                  </button>
                )}
                {s.notes && <div className="mt-2 text-white/50 text-xs">{s.notes}</div>}
              </div>
              );
            })}
            {loadingStations && <div className="col-span-2 text-center py-16 text-white/40 font-display tracking-widest">STATIONEN WERDEN GELADEN …</div>}
            {!loadingStations && safeArray(list).length === 0 && <div className="col-span-2 text-center py-16 text-white/40 font-display tracking-widest">KEINE STATIONEN</div>}
          </div>
        </div>
      </div>

      {resultFor ? <ResultWindowLoader matchId={resultFor} onClose={() => setResultFor("")} onSaved={resultUndo.start} /> : null}
      <ResultUndoBar undo={resultUndo} />
      {/* Zuweisen als Seitenblatt (#435): die Stationen bleiben daneben sichtbar. */}
      {assignFor && (
        <AdminSheet title={assignFor.name} eyebrow="Zuweisen zu" onClose={() => setAssignFor(null)} testId="station-assign-sheet">
          <div className="space-y-1.5">
            {unassignedMatches.map((m) => (
              <div key={m.id} className="p-2 border border-white/10 rounded-sm hover:border-[#29B6E8] hover:bg-[#29B6E8]/5 text-xs">
                <div className="text-white/40 text-[10px] uppercase tracking-widest">{detailOfMatch(m)}</div>
                <div className="text-white font-semibold mt-0.5">{nameOfMatch(m)}</div>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => assign(assignFor.id, m.id)} data-testid={`assign-match-${m.id}`} className="px-2 py-1 border border-[#29B6E8]/50 text-[#29B6E8] rounded-sm text-[10px] font-bold uppercase">Zuweisen</button>
                  <button type="button" onClick={() => assign(assignFor.id, m.id, true)} className="px-2 py-1 border border-[#00FF88]/50 text-[#00FF88] rounded-sm text-[10px] font-bold uppercase">Direkt starten</button>
                </div>
              </div>
            ))}
            {unassignedMatches.length === 0 && <div className="text-white/40 text-xs text-center py-6">Keine offenen Spiele</div>}
          </div>
        </AdminSheet>
      )}
    </AdminLayout>
  );
}

function safeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function stationName(stationId, stations) {
  const station = safeArray(stations).find((item) => item.id === stationId);
  return station?.name || station?.label || stationId || "offen";
}
