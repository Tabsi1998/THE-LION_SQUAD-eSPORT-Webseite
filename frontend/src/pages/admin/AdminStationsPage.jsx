import { useCallback, useEffect, useState } from "react";
import { api, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { Plus, Trash2, Link as LinkIcon, X as XIcon } from "lucide-react";
import { toast } from "sonner";

const DEVICES = [
  ["switch", "Switch"], ["switch2", "Switch 2"], ["pc", "PC"],
  ["racing_rig", "Racing Rig"], ["beamer", "Beamer"],
  ["stream_setup", "Stream"], ["admin_desk", "Admin Desk"],
];
const STATUSES = ["free", "busy", "broken", "reserved"];

export default function AdminStationsPage() {
  const [list, setList] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [activeTid, setActiveTid] = useState("");
  const [matches, setMatches] = useState([]);
  const [regs, setRegs] = useState([]);
  const [form, setForm] = useState({ name: "", device_type: "switch", notes: "" });
  const [assignFor, setAssignFor] = useState(null); // station object for assignment dialog
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const { data } = await api.get("/stations");
    setList(data);
    const { data: t } = await api.get("/tournaments");
    setTournaments(t);
    setActiveTid((current) => current || t?.[0]?.id || "");
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["stations", "tournaments"]);

  const loadMatches = useCallback(async () => {
    if (!activeTid) return;
    const { data } = await api.get(`/tournaments/${activeTid}/bracket`);
    setMatches(data.matches || []);
    setRegs(data.registrations || []);
  }, [activeTid]);
  useEffect(() => { loadMatches(); }, [loadMatches]);
  useApiInvalidation(loadMatches, ["stations", "matches", "tournaments"]);

  const create = async (e) => {
    e.preventDefault();
    try {
      await api.post("/stations", form);
      toast.success("Station angelegt.");
      setForm({ name: "", device_type: "switch", notes: "" });
      load();
    } catch (e) {
      toast.error(formatRequestError(e, "Station konnte nicht angelegt werden.", { name: form.name }));
    }
  };
  const updateStatus = async (id, status) => {
    try {
      await api.patch(`/stations/${id}`, { status });
      load();
    } catch (e) {
      toast.error(formatRequestError(e, "Stationsstatus konnte nicht gespeichert werden."));
    }
  };
  const del = async (id) => {
    if (!await confirm({
      title: "Station löschen?",
      description: "Die Station wird entfernt und kann danach nicht mehr für Matches zugewiesen werden.",
      confirmLabel: "Löschen",
    })) return;
    try {
      await api.delete(`/stations/${id}`);
      toast.success("Station geloescht.");
      load();
    } catch (e) {
      toast.error(formatRequestError(e, "Station konnte nicht geloescht werden."));
    }
  };
  const assign = async (sid, mid) => {
    try {
      await api.post(`/stations/${sid}/assign/${mid}`);
      toast.success("Match zugewiesen.");
      setAssignFor(null);
      load(); loadMatches();
    } catch (e) {
      toast.error(formatRequestError(e, "Match konnte nicht zugewiesen werden."));
    }
  };
  const clearStation = async (sid) => {
    try {
      await api.post(`/stations/${sid}/clear`);
      toast.success("Station freigegeben.");
      load(); loadMatches();
    } catch (e) {
      toast.error(formatRequestError(e, "Station konnte nicht freigegeben werden."));
    }
  };

  const regById = Object.fromEntries(regs.map((r) => [r.id, r]));
  const matchById = Object.fromEntries(matches.map((m) => [m.id, m]));
  const unassignedMatches = matches.filter(
    (m) => !m.station_id && ["ready", "scheduled"].includes(m.status)
  );

  const nameOfMatch = (m) => {
    if (!m) return "—";
    const a = regById[m.participant_a_id]?.display_name || "TBD";
    const b = regById[m.participant_b_id]?.display_name || "TBD";
    return `${a} vs ${b}`;
  };

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Event Setup</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 mb-6">Stationen &amp; Match-Zuweisung</h1>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* LEFT: Create form + unassigned matches queue */}
        <div className="space-y-6">
          <form onSubmit={create} className="border border-white/10 rounded-sm bg-[#121212] p-5 space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Neue Station</div>
            <input placeholder="Name (z.B. Switch 1)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="station-name" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
            <select value={form.device_type} onChange={(e) => setForm({ ...form, device_type: e.target.value })} data-testid="station-device" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
              {DEVICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input placeholder="Notiz (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="station-notes" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
            <button data-testid="station-submit" className="w-full px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2"><Plus className="w-4 h-4" /> Anlegen</button>
          </form>

          <div className="border border-white/10 rounded-sm bg-[#121212] p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Offene Matches</div>
            </div>
            <select value={activeTid} onChange={(e) => setActiveTid(e.target.value)} data-testid="station-tournament-select" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm mb-3">
              {tournaments.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
            <div className="space-y-1.5 max-h-[360px] overflow-y-auto">
              {unassignedMatches.map((m) => (
                <div key={m.id} data-testid={`match-unassigned-${m.id}`} className="p-2 border border-white/10 rounded-sm text-xs bg-[#0A0A0A] hover:border-[#29B6E8]/40">
                  <div className="text-white/40 text-[10px] uppercase tracking-widest">{m.round_name || `Runde ${m.round}`}</div>
                  <div className="text-white font-semibold mt-0.5 truncate">{nameOfMatch(m)}</div>
                </div>
              ))}
              {unassignedMatches.length === 0 && <div className="text-white/40 text-xs text-center py-6">Keine offenen Matches</div>}
            </div>
          </div>
        </div>

        {/* RIGHT: Stations grid */}
        <div className="lg:col-span-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {list.map((s) => (
              <div key={s.id} className={`border rounded-sm bg-[#121212] p-4 ${s.status === "busy" ? "border-[#FF3B30]/30" : "border-white/10"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">{s.device_type}</div>
                    <div className="font-heading text-lg font-bold">{s.name}</div>
                  </div>
                  <button onClick={() => del(s.id)} className="p-1 text-white/40 hover:text-[#FF3B30]"><Trash2 className="w-4 h-4" /></button>
                </div>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <StatusBadge status={s.status} />
                  <select value={s.status} onChange={(e) => updateStatus(s.id, e.target.value)} data-testid={`station-status-${s.id}`} className="bg-[#0A0A0A] border border-white/10 px-2 py-1 rounded-sm text-xs">
                    {STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                  </select>
                </div>
                {/* Current match */}
                {s.current_match_id ? (
                  <div className="mt-3 p-2 border border-[#29B6E8]/30 bg-[#29B6E8]/5 rounded-sm">
                    <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">Aktuell</div>
                    <div className="text-sm text-white truncate">{nameOfMatch(matchById[s.current_match_id])}</div>
                    <button onClick={() => clearStation(s.id)} data-testid={`station-clear-${s.id}`} className="mt-1.5 text-[10px] text-[#FF3B30] font-bold uppercase tracking-widest hover:underline inline-flex items-center gap-1"><XIcon className="w-3 h-3" /> Freigeben</button>
                  </div>
                ) : (
                  <button onClick={() => setAssignFor(s)} data-testid={`station-assign-${s.id}`} className="mt-3 w-full py-2 border border-dashed border-white/20 rounded-sm text-xs text-white/60 hover:text-[#29B6E8] hover:border-[#29B6E8] inline-flex items-center justify-center gap-2">
                    <LinkIcon className="w-3.5 h-3.5" /> Match zuweisen
                  </button>
                )}
                {s.notes && <div className="mt-2 text-white/50 text-xs">{s.notes}</div>}
              </div>
            ))}
            {list.length === 0 && <div className="col-span-2 text-center py-16 text-white/40 font-display tracking-widest">KEINE STATIONEN</div>}
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
                <button key={m.id} onClick={() => assign(assignFor.id, m.id)} data-testid={`assign-match-${m.id}`} className="w-full text-left p-2 border border-white/10 rounded-sm hover:border-[#29B6E8] hover:bg-[#29B6E8]/5 text-xs">
                  <div className="text-white/40 text-[10px] uppercase tracking-widest">{m.round_name || `Runde ${m.round}`}</div>
                  <div className="text-white font-semibold mt-0.5">{nameOfMatch(m)}</div>
                </button>
              ))}
              {unassignedMatches.length === 0 && <div className="text-white/40 text-xs text-center py-6">Keine offenen Matches</div>}
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
