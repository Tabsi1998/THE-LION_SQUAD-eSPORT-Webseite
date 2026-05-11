import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useAuth } from "@/context/AuthContext";
import { formatBracketSection, formatDeviceType, formatMatchKind, formatMatchStatus, formatScheduleGroupLabel } from "@/lib/tournamentLabels";
import { formatDateTime } from "@/lib/datetime";
import { Plus, Trash2, Link as LinkIcon, X as XIcon, Wand2, Play } from "lucide-react";
import { toast } from "sonner";

const DEVICES = [
  ["switch", "Switch"], ["switch2", "Switch 2"], ["pc", "PC"],
  ["racing_rig", "Renn-Setup"], ["beamer", "Beamer"],
  ["stream_setup", "Übertragungsplatz"], ["admin_desk", "Orga-Tisch"],
];
const STATUSES = ["free", "busy", "broken", "reserved"];

export default function AdminStationsPage() {
  const { isAdmin } = useAuth();
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
  const stationsRequestRef = useRef(0);
  const matchesRequestRef = useRef(0);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    try {
      const { data: t } = await api.get("/tournaments?include_drafts=true");
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
      const duelMatches = safeArray(data?.matches).map((m) => ({ ...m, is_multi_slot: false, tournament }));
      const multiSlotMatches = safeArray(data?.matches_v2).map((m) => ({ ...m, is_multi_slot: true, tournament }));
      setMatches([...duelMatches, ...multiSlotMatches]);
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
      const { data } = await api.post(`/stations/auto-assign?tournament_id=${encodeURIComponent(activeTid)}`);
      toast.success(`${data.assigned} Spiele automatisch zugewiesen.`);
      loadStations(); loadMatches();
    } catch (e) {
      toast.error(formatRequestError(e, "Automatische Zuweisung konnte nicht ausgeführt werden."));
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

  const nameOfMatch = (m) => {
    if (!m) return "—";
    if (m.is_multi_slot || m.slots) {
      const names = safeArray(m.slots)
        .map((slot) => regById[slot?.registration_id]?.display_name || slot?.source?.raw || "Offen")
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
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 mb-6">Stationen &amp; Spiel-Zuweisung</h1>
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
        <button type="button" onClick={autoAssign} disabled={!list.length || !unassignedMatches.length} className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2 disabled:opacity-40">
          <Wand2 className="w-4 h-4" /> Nächste Spiele verteilen
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
            <input placeholder="Notiz (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="station-notes" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
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
            <input placeholder="Notiz für alle Stationen" value={bulk.notes} onChange={(e) => setBulk({ ...bulk, notes: e.target.value })} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
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
                    {currentMatch && !currentMatch.is_multi_slot && (
                      <StationDuelResult match={currentMatch} regById={regById} onSaved={() => { loadStations(); loadMatches(); }} />
                    )}
                    {currentMatch?.is_multi_slot && (
                      <StationHeatResult match={currentMatch} regById={regById} onSaved={() => { loadStations(); loadMatches(); }} />
                    )}
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

      {/* Assign modal */}
      {assignFor && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setAssignFor(null)}>
          <div className="bg-[#121212] border border-white/10 rounded-sm max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Zuweisen zu</div>
                <div className="font-heading text-lg font-bold">{assignFor.name}</div>
              </div>
              <button onClick={() => setAssignFor(null)} className="text-white/40 hover:text-white"><XIcon className="w-4 h-4" /></button>
            </div>
            <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
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
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function safeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function StationDuelResult({ match, regById, onSaved }) {
  const a = regById[match.participant_a_id] || {};
  const b = regById[match.participant_b_id] || {};
  const [scoreA, setScoreA] = useState(match.score_a ?? 0);
  const [scoreB, setScoreB] = useState(match.score_b ?? 0);
  const winnerId = Number(scoreA) > Number(scoreB)
    ? match.participant_a_id
    : Number(scoreB) > Number(scoreA)
      ? match.participant_b_id
      : "";
  const save = async () => {
    try {
      await api.patch(`/matches/${match.id}`, {
        score_a: Number(scoreA) || 0,
        score_b: Number(scoreB) || 0,
        winner_id: winnerId || null,
        status: winnerId ? "completed" : "waiting_result",
      });
      toast.success("Ergebnis gespeichert.");
      onSaved();
    } catch (e) {
      toast.error(formatRequestError(e, "Ergebnis konnte nicht gespeichert werden."));
    }
  };
  return (
    <div className="mt-3 border-t border-white/10 pt-3 space-y-2">
      <div className="text-[10px] font-bold uppercase tracking-widest text-white/50">Ergebnis</div>
      <div className="grid grid-cols-[1fr_4rem] gap-2 items-center text-xs">
        <div className="truncate">{a.display_name || "Teilnehmer A"}</div>
        <input type="number" min="0" value={scoreA} onChange={(e) => setScoreA(e.target.value)} className="bg-[#0A0A0A] border border-white/10 px-2 py-1 rounded-sm text-center" aria-label="Punkte A" />
        <div className="truncate">{b.display_name || "Teilnehmer B"}</div>
        <input type="number" min="0" value={scoreB} onChange={(e) => setScoreB(e.target.value)} className="bg-[#0A0A0A] border border-white/10 px-2 py-1 rounded-sm text-center" aria-label="Punkte B" />
      </div>
      <button type="button" onClick={save} className="w-full px-3 py-2 bg-[#29B6E8] text-black rounded-sm text-[10px] font-bold uppercase tracking-widest">Bestätigen</button>
    </div>
  );
}

function StationHeatResult({ match, regById, onSaved }) {
  const filledSlots = safeArray(match.slots).filter((slot) => slot?.status === "filled" && slot?.registration_id);
  const initialRows = () => {
    const existing = safeArray(match.results).length
      ? safeArray(match.results).sort((a, b) => (a.rank || 0) - (b.rank || 0))
      : filledSlots.map((slot, index) => ({ registration_id: slot.registration_id, rank: index + 1, score: "", dnf: false, forfeit: false }));
    const byReg = Object.fromEntries(existing.map((row) => [row.registration_id, row]));
    return filledSlots.map((slot, index) => ({
      registration_id: slot.registration_id,
      rank: byReg[slot.registration_id]?.rank || index + 1,
      score: byReg[slot.registration_id]?.score ?? byReg[slot.registration_id]?.points ?? "",
      dnf: !!byReg[slot.registration_id]?.dnf,
      forfeit: !!byReg[slot.registration_id]?.forfeit,
    }));
  };
  const [rows, setRows] = useState(initialRows);
  const [note, setNote] = useState(match.result_meta?.note || "");
  useEffect(() => {
    setRows(initialRows());
    setNote(match.result_meta?.note || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id, match.updated_at, filledSlots.length]);
  const labelFor = (registrationId) => regById[registrationId]?.display_name || regById[registrationId]?.ingame_name || registrationId;
  const update = (registrationId, patch) => setRows((current) => current.map((row) => row.registration_id === registrationId ? { ...row, ...patch } : row));
  const save = async () => {
    try {
      await api.post(`/matches/${match.id}/result`, {
        results: rows.map((row) => ({
          registration_id: row.registration_id,
          rank: Number(row.rank) || 1,
          score: row.score === "" ? null : Number(row.score),
          dnf: !!row.dnf,
          forfeit: !!row.forfeit,
        })),
        note: note || null,
      });
      toast.success("Ergebnis gespeichert.");
      onSaved();
    } catch (e) {
      toast.error(formatRequestError(e, "Ergebnis konnte nicht gespeichert werden."));
    }
  };
  if (!filledSlots.length) return null;
  return (
    <div className="mt-3 border-t border-white/10 pt-3 space-y-2">
      <div className="text-[10px] font-bold uppercase tracking-widest text-white/50">Platzierungen</div>
      {rows.map((row) => (
        <div key={row.registration_id} className="grid grid-cols-12 gap-2 items-center text-xs">
          <div className="col-span-5 truncate">{labelFor(row.registration_id)}</div>
          <input type="number" min="1" value={row.rank} onChange={(e) => update(row.registration_id, { rank: e.target.value })} className="col-span-2 bg-[#0A0A0A] border border-white/10 px-2 py-1 rounded-sm text-center" aria-label="Platz" />
          <input type="number" min="0" value={row.score} onChange={(e) => update(row.registration_id, { score: e.target.value })} className="col-span-3 bg-[#0A0A0A] border border-white/10 px-2 py-1 rounded-sm text-center" placeholder="Punkte" aria-label="Punkte" />
          <label className="col-span-2 text-[10px] text-white/60"><input type="checkbox" checked={row.dnf} onChange={(e) => update(row.registration_id, { dnf: e.target.checked })} className="accent-[#29B6E8]" /> DNF</label>
        </div>
      ))}
      <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-2 py-1 rounded-sm text-xs" placeholder="Notiz optional" />
      <button type="button" onClick={save} className="w-full px-3 py-2 bg-[#29B6E8] text-black rounded-sm text-[10px] font-bold uppercase tracking-widest">Bestätigen</button>
    </div>
  );
}
