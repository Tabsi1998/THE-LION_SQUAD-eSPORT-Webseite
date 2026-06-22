import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { API, api, formatRequestError, parseTimeStr, resolveMediaUrl } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { MarkdownEditor } from "@/components/tls/MarkdownEditor";
import { AccessLinksPanel } from "@/components/tls/AccessLinksPanel";
import { normalizeDateTimeFields, toDateTimeLocalInput } from "@/lib/datetime";
import { buildDirtyPayload, hasPayloadChanges } from "@/lib/dirtyPayload";
import { toast } from "sonner";
import { Plus, Trash2, Tv, Pencil, X as XIcon } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useConfirm } from "@/components/tls/ConfirmDialog";

const F1_STATUS_OPTIONS = [
  ["draft", "Entwurf"],
  ["scheduled", "Angekündigt"],
  ["registration_open", "Einreichung offen"],
  ["registration_closed", "Einreichung geschlossen"],
  ["live", "Live"],
  ["paused", "Pausiert"],
  ["completed", "Beendet"],
  ["results_published", "Ergebnisse veröffentlicht"],
  ["archived", "Archiviert"],
  ["cancelled", "Abgesagt"],
];
const F1_SEASON_WEIGHT_OPTIONS = [
  ["1", "Fast Lap Standard (x1.00)"],
  ["0.75", "Fun-Challenge (x0.75)"],
  ["0.5", "Event/Check-in Wertung (x0.50)"],
  ["1.25", "Mini-Wertung (x1.25)"],
  ["2", "Normal-Turnier nah (x2.00)"],
  ["0", "Keine Jahreswertung (x0.00)"],
];

export default function AdminF1EditPage() {
  const { isAdmin } = useAuth();
  const { id } = useParams();
  const [challenge, setChallenge] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [users, setUsers] = useState([]);
  const [staff, setStaff] = useState([]);
  const [times, setTimes] = useState([]);
  const [activeTrack, setActiveTrack] = useState(null);
  const [newTrack, setNewTrack] = useState({ name: "", image_url: "", country: "" });
  const [editTrack, setEditTrack] = useState(null);
  const [newTime, setNewTime] = useState({ user_id: "", time_str: "", penalty_seconds: 0, proof_url: "", admin_note: "", score_scope: "official" });
  const [editTime, setEditTime] = useState(null);
  const confirm = useConfirm();
  const setNewTrackField = (k, v) => setNewTrack((track) => ({ ...track, [k]: v }));
  const setEditTrackField = (k, v) => setEditTrack((track) => ({ ...(track || {}), [k]: v }));

  const load = useCallback(async () => {
    const { data: c } = await api.get(`/f1/challenges/${id}?include_draft=true`);
    setChallenge(c);
    setTracks(c.tracks || []);
    setActiveTrack((current) => (c.tracks || []).some((track) => track.id === current) ? current : c.tracks?.[0]?.id || null);
    const [{ data: u }, staffResponse] = await Promise.all([
      api.get("/users"),
      isAdmin ? api.get(`/f1/challenges/${c.id}/staff`).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
    ]);
    setUsers(u);
    setStaff(staffResponse.data || []);
  }, [id, isAdmin]);

  const loadTimes = useCallback(async () => {
    if (!activeTrack) return;
    const { data } = await api.get(`/f1/challenges/${id}/times?track_id=${activeTrack}`);
    setTimes(data);
  }, [activeTrack, id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadTimes(); }, [loadTimes]);
  useApiInvalidation(load, ["f1", "users"]);
  useApiInvalidation(loadTimes, ["f1"]);

  const selectedNewTimeUser = users.find((u) => u.id === newTime.user_id);
  const forceReferenceScope = !!challenge?.block_club_member_results && !!selectedNewTimeUser?.is_club_member;

  useEffect(() => {
    if (forceReferenceScope && newTime.score_scope !== "club_reference") {
      setNewTime((current) => ({ ...current, score_scope: "club_reference" }));
    }
  }, [forceReferenceScope, newTime.score_scope]);

  const addTrack = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/f1/challenges/${id}/tracks`, { ...newTrack, order_index: tracks.length });
      setNewTrack({ name: "", image_url: "", country: "" });
      toast.success("Strecke hinzugefügt.");
      load();
    } catch (err) { toast.error(formatRequestError(err, "Strecke konnte nicht hinzugefügt werden.", { name: newTrack.name })); }
  };

  const delTrack = async (tid) => {
    if (!await confirm({
      title: "Strecke löschen?",
      description: "Die Strecke und alle zugehörigen Zeiten werden dauerhaft gelöscht.",
      confirmLabel: "Löschen",
    })) return;
    try {
      await api.delete(`/f1/tracks/${tid}`);
      toast.success("Strecke gelöscht.");
      load();
    } catch (err) {
      toast.error(formatRequestError(err, "Strecke konnte nicht gelöscht werden."));
    }
  };

  const saveTrack = async (e) => {
    e.preventDefault();
    if (!editTrack) return;
    try {
      await api.patch(`/f1/tracks/${editTrack.id}`, {
        name: editTrack.name,
        image_url: editTrack.image_url || "",
        country: editTrack.country || "",
        order_index: Number(editTrack.order_index) || 0,
      });
      toast.success("Strecke gespeichert.");
      setEditTrack(null);
      load();
    } catch (err) { toast.error(formatRequestError(err, "Strecke konnte nicht gespeichert werden.", { name: editTrack.name })); }
  };

  const addTime = async (e) => {
    e.preventDefault();
    const ms = parseTimeStr(newTime.time_str);
    if (!ms) { toast.error("Ungültiges Zeitformat (m:ss.SSS)"); return; }
    const pen = Number(newTime.penalty_seconds) || 0;
    if (pen > 0 && (newTime.admin_note || "").trim().length < 5) {
      toast.error("Bei Strafzeit ist eine Begründung (mind. 5 Zeichen) Pflicht.");
      return;
    }
    try {
      await api.post(`/f1/challenges/${id}/times`, {
        user_id: newTime.user_id, track_id: activeTrack,
        time_ms: ms, penalty_seconds: pen,
        proof_url: newTime.proof_url || null,
        admin_note: newTime.admin_note?.trim() || null,
        score_scope: newTime.score_scope || "official",
      });
      setNewTime({ ...newTime, time_str: "", proof_url: "", admin_note: "", penalty_seconds: 0 });
      toast.success("Zeit eingetragen.");
      loadTimes();
    } catch (err) { toast.error(formatRequestError(err, "Zeit konnte nicht eingetragen werden.")); }
  };

  const delTime = async (tid) => {
    try {
      await api.delete(`/f1/times/${tid}`);
      toast.success("Zeit gelöscht.");
      loadTimes();
    } catch (err) {
      toast.error(formatRequestError(err, "Zeit konnte nicht gelöscht werden."));
    }
  };

  const saveEdit = async () => {
    if (!editTime) return;
    try {
      const ms = editTime.time_str ? parseTimeStr(editTime.time_str) : editTime.time_ms;
      if (editTime.time_str && !ms) { toast.error("Ungültiges Zeitformat"); return; }
      const pen = Number(editTime.penalty_seconds) || 0;
      const inv = !!editTime.is_invalid;
      const note = (editTime.admin_note || "").trim();
      if ((pen > 0 || inv) && note.length < 5) {
        toast.error("Bei Strafzeit oder Invalid-Markierung ist eine Begründung (mind. 5 Zeichen) Pflicht.");
        return;
      }
      await api.patch(`/f1/times/${editTime.id}`, {
        time_ms: ms,
        penalty_seconds: pen,
        is_invalid: inv,
        proof_url: editTime.proof_url || null,
        admin_note: note || null,
        score_scope: editTime.score_scope || "official",
      });
      toast.success("Zeit aktualisiert.");
      setEditTime(null);
      loadTimes();
    } catch (e) { toast.error(formatRequestError(e, "Zeit konnte nicht gespeichert werden.")); }
  };

  const setStatus = async (status) => {
    try {
      await api.patch(`/f1/challenges/${id}`, { status });
      toast.success(`Status: ${status}`);
      load();
    } catch (e) {
      toast.error(formatRequestError(e, "Challenge-Status konnte nicht gespeichert werden."));
    }
  };

  if (!challenge) return <AdminLayout><div className="p-10 text-white/40">Lade…</div></AdminLayout>;

  return (
    <AdminLayout>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <Link to="/admin/f1" className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8] hover:text-white">← Fast-Lap Challenges</Link>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">{challenge.title}</h1>
          <div className="mt-2 flex items-center gap-3"><StatusBadge status={challenge.status} /></div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isAdmin && (
            <div>
              <select value={challenge.status} onChange={(e) => setStatus(e.target.value)} data-testid="f1-status-select" className="bg-[#0A0A0A] border border-white/10 px-3 py-2 text-sm rounded-sm">
                {F1_STATUS_OPTIONS.map(([s, label]) => <option key={s} value={s}>{label}</option>)}
              </select>
              <div className="mt-1 text-[10px] text-white/40">Manuell nur für Ausnahmen; Zeitplan automatisiert.</div>
            </div>
          )}
          <Link target="_blank" to={`/display/f1/${challenge.id}`} data-testid="f1-tv-admin-link" className="inline-flex items-center gap-2 px-4 py-2 border border-[#29B6E8] text-[#29B6E8] rounded-sm uppercase tracking-wider text-sm font-bold hover:bg-[#29B6E8]/10">
            <Tv className="w-4 h-4" /> TV Modus
          </Link>
          <Link target="_blank" to={`/fastlap/${challenge.slug || challenge.id}`} className="px-4 py-2 border border-white/20 text-white rounded-sm uppercase tracking-wider text-sm font-bold hover:border-[#29B6E8]/60">Public</Link>
          <a href={`${API}/f1/challenges/${challenge.id}/export.csv`} className="px-4 py-2 border border-white/20 text-white/80 text-xs uppercase font-bold rounded-sm hover:border-[#29B6E8]/40" target="_blank" rel="noreferrer">CSV</a>
          <a href={`${API}/exports/f1/${challenge.id}/leaderboard.pdf${activeTrack ? `?track_id=${activeTrack}` : ""}`} className="px-4 py-2 border border-white/20 text-white/80 text-xs uppercase font-bold rounded-sm hover:border-[#29B6E8]/40" target="_blank" rel="noreferrer">PDF</a>
        </div>
      </div>

      {isAdmin && <div className="mb-5"><AccessLinksPanel targetType="fastlap" targetId={challenge.id} /></div>}
      {isAdmin && <ChallengeSettingsForm key={challenge.updated_at || challenge.id} challenge={challenge} onSaved={load} />}
      {isAdmin && <F1StaffPanel challengeId={challenge.id} staff={staff} users={users} onChanged={load} />}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Tracks */}
        <div className="border border-white/10 rounded-sm bg-[#121212] p-5">
          <h2 className="font-heading font-bold uppercase mb-3 text-lg">Strecken</h2>
          <div className="space-y-2">
            {tracks.map((tr) => (
              <div key={tr.id} className={`flex items-center justify-between gap-2 border rounded-sm p-2 ${activeTrack === tr.id ? "border-[#29B6E8] bg-[#29B6E8]/5" : "border-white/10"}`}>
                <button onClick={() => setActiveTrack(tr.id)} data-testid={`f1-track-${tr.id}`} className="flex items-center gap-2 flex-1 text-left">
                  {tr.image_url && <img src={resolveMediaUrl(tr.image_url)} className="w-10 h-7 object-cover rounded-sm" alt="" />}
                  <div className="min-w-0"><div className="text-sm font-bold truncate">{tr.name}</div><div className="text-[10px] text-white/50">{tr.country}</div></div>
                </button>
                {isAdmin && <button onClick={() => setEditTrack({ ...tr })} className="p-1 text-white/40 hover:text-[#29B6E8]" title="Strecke bearbeiten"><Pencil className="w-3.5 h-3.5" /></button>}
                {isAdmin && <button onClick={() => delTrack(tr.id)} className="p-1 text-white/40 hover:text-[#FF3B30]" title="Strecke löschen"><Trash2 className="w-3.5 h-3.5" /></button>}
              </div>
            ))}
          </div>
          {isAdmin && editTrack && (
            <form onSubmit={saveTrack} className="mt-4 space-y-2 border border-[#29B6E8]/25 bg-[#29B6E8]/5 rounded-sm p-3">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Strecke bearbeiten</div>
                <button type="button" onClick={() => setEditTrack(null)} className="text-white/40 hover:text-white"><XIcon className="w-3.5 h-3.5" /></button>
              </div>
              <input placeholder="Name" value={editTrack.name || ""} onChange={(e) => setEditTrackField("name", e.target.value)} required data-testid="f1-edit-track-name" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
              <ImageUpload value={editTrack.image_url || ""} onChange={(v) => setEditTrackField("image_url", v)} label="Streckenbild" testId="f1-edit-track-image-upload" variant="wide" allowLibrary />
              <input placeholder="Land" value={editTrack.country || ""} onChange={(e) => setEditTrackField("country", e.target.value)} data-testid="f1-edit-track-country" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
              <input type="number" placeholder="Reihenfolge" value={editTrack.order_index ?? 0} onChange={(e) => setEditTrackField("order_index", e.target.value)} data-testid="f1-edit-track-order" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
              <button data-testid="f1-edit-track-save" className="w-full px-3 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-xs hover:bg-[#1E95C2]">
                Strecke speichern
              </button>
            </form>
          )}
          {isAdmin && <form onSubmit={addTrack} className="mt-4 space-y-2 border-t border-white/5 pt-4">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Neue Strecke</div>
            <input placeholder="Name" value={newTrack.name} onChange={(e) => setNewTrackField("name", e.target.value)} required data-testid="f1-new-track-name" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
            <ImageUpload value={newTrack.image_url} onChange={(v) => setNewTrackField("image_url", v)} label="Streckenbild" testId="f1-new-track-image-upload" variant="wide" allowLibrary />
            <input placeholder="Land" value={newTrack.country} onChange={(e) => setNewTrackField("country", e.target.value)} data-testid="f1-new-track-country" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
            <button data-testid="f1-add-track-btn" className="w-full px-3 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-xs hover:bg-[#1E95C2] inline-flex items-center justify-center gap-2">
              <Plus className="w-3.5 h-3.5" /> Hinzufügen
            </button>
          </form>}
        </div>

        {/* Time input + list */}
        <div className="lg:col-span-2 border border-white/10 rounded-sm bg-[#121212] p-5">
          <h2 className="font-heading font-bold uppercase mb-3 text-lg">Zeiten eintragen</h2>
          {activeTrack ? (
            <>
              <form onSubmit={addTime} className="flex flex-wrap gap-2 items-end border-b border-white/5 pb-4 mb-4">
                <div className="flex-1 min-w-[200px]">
                  <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1">Spieler</div>
                  <select value={newTime.user_id} onChange={(e) => setNewTime({ ...newTime, user_id: e.target.value })} required data-testid="f1-add-time-user" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
                    <option value="">— auswählen —</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.display_name || u.username}</option>)}
                  </select>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1">Zeit (m:ss.SSS)</div>
                  <input value={newTime.time_str} onChange={(e) => setNewTime({ ...newTime, time_str: e.target.value })} placeholder="1:24.587" required data-testid="f1-add-time-value" className="w-36 bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm font-display text-lg tabular-nums" />
                </div>
                <div className="min-w-[170px]">
                  <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1">Wertung</div>
                  <select value={newTime.score_scope || "official"} onChange={(e) => setNewTime({ ...newTime, score_scope: e.target.value })} data-testid="f1-add-time-scope" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
                    <option value="official" disabled={forceReferenceScope}>Offizielle Wertung</option>
                    <option value="club_reference">Vereins-Referenz</option>
                  </select>
                  {forceReferenceScope && <div className="mt-1 text-[10px] text-[#FFD700]">Vereinsmitglied: nur Referenzzeit.</div>}
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1">Strafe (s)</div>
                  <input type="number" step="0.1" value={newTime.penalty_seconds} onChange={(e) => setNewTime({ ...newTime, penalty_seconds: e.target.value })} data-testid="f1-add-time-penalty" className="w-24 bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" />
                </div>
                <div className="flex-1 min-w-[160px]">
                  <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1">Proof URL</div>
                  <input value={newTime.proof_url} onChange={(e) => setNewTime({ ...newTime, proof_url: e.target.value })} placeholder="Screenshot/Video Link" data-testid="f1-add-time-proof" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
                </div>
                {Number(newTime.penalty_seconds) > 0 && (
                  <div className="w-full">
                    <div className="text-[11px] font-bold uppercase tracking-widest text-[#FF3B30] mb-1">Begründung für Strafe (Pflicht, ≥5 Zeichen)</div>
                    <textarea
                      rows={2}
                      required
                      value={newTime.admin_note}
                      onChange={(e) => setNewTime({ ...newTime, admin_note: e.target.value })}
                      placeholder="z. B. Cut Curb in Kurve 7, Lap 3 — Replay 0:42"
                      data-testid="f1-add-time-note"
                      className="w-full bg-[#0A0A0A] border border-[#FF3B30]/40 px-3 py-2 rounded-sm text-sm"
                    />
                  </div>
                )}
                <button data-testid="f1-add-time-submit" className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-sm hover:bg-[#1E95C2]">Eintragen</button>
              </form>
              <div className="space-y-1">
                {times.map((t) => (
                  <div key={t.id} className={`flex items-center justify-between px-3 py-2 border rounded-sm hover:border-[#29B6E8]/40 ${t.is_invalid ? "border-[#FF3B30]/30 bg-[#FF3B30]/5" : "border-white/5"}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-white/50 text-xs w-6">#{t.attempt_number}</span>
                      <span className="text-white text-sm truncate">{t.user?.display_name || t.user?.username}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`font-display font-bold text-lg tabular-nums ${t.is_invalid ? "line-through text-white/40" : "text-white"}`}>{t.time_str}</span>
                      {(t.score_scope || "official") === "club_reference" && <span className="text-[#FFD700] border border-[#FFD700]/30 bg-[#FFD700]/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest rounded-sm">Referenz</span>}
                      {t.penalty_seconds > 0 && <span className="text-[#FF3B30] text-xs">+{t.penalty_seconds}s</span>}
                      {t.is_invalid && <span className="text-[#FF3B30] text-[10px] font-bold uppercase tracking-widest">INVALID</span>}
                      {t.proof_url && <a href={t.proof_url} target="_blank" rel="noreferrer" className="text-[10px] text-[#29B6E8] uppercase tracking-widest hover:underline">Proof</a>}
                      <button
                        onClick={() => setEditTime({
                          ...t,
                          time_str: t.time_str,
                          score_scope: challenge.block_club_member_results && t.user?.is_club_member ? "club_reference" : (t.score_scope || "official"),
                        })}
                        data-testid={`f1-edit-time-${t.id}`}
                        className="p-1 text-white/40 hover:text-[#29B6E8]"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => delTime(t.id)} className="p-1 text-white/40 hover:text-[#FF3B30]"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ))}
                {times.length === 0 && <div className="text-center py-6 text-white/40 text-sm">Noch keine Zeiten</div>}
              </div>
            </>
          ) : <div className="text-white/40 text-sm">Bitte erst eine Strecke anlegen.</div>}
        </div>
      </div>

      {/* Edit Time Modal */}
      {editTime && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setEditTime(null)}>
          <div className="bg-[#121212] border border-white/10 rounded-sm max-w-md w-full p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold uppercase">Zeit bearbeiten</h3>
              <button onClick={() => setEditTime(null)} className="text-white/40 hover:text-white"><XIcon className="w-4 h-4" /></button>
            </div>
            <div className="text-xs text-white/60">Spieler: <span className="text-white">{editTime.user?.display_name || editTime.user?.username}</span></div>
            <label className="block">
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1">Zeit (m:ss.SSS)</div>
              <input value={editTime.time_str} onChange={(e) => setEditTime({ ...editTime, time_str: e.target.value })} data-testid="f1-edit-time-value" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm font-display text-lg tabular-nums" />
            </label>
            <label className="block">
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1">Strafsekunden</div>
              <input type="number" step="0.1" value={editTime.penalty_seconds ?? 0} onChange={(e) => setEditTime({ ...editTime, penalty_seconds: e.target.value })} data-testid="f1-edit-time-penalty" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" />
            </label>
            <label className="block">
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1">Wertung</div>
              <select
                value={editTime.score_scope || "official"}
                onChange={(e) => setEditTime({ ...editTime, score_scope: e.target.value })}
                data-testid="f1-edit-time-scope"
                className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"
              >
                <option value="official" disabled={!!challenge?.block_club_member_results && !!editTime.user?.is_club_member}>Offizielle Wertung</option>
                <option value="club_reference">Vereins-Referenz</option>
              </select>
              {!!challenge?.block_club_member_results && !!editTime.user?.is_club_member && (
                <div className="mt-1 text-[10px] text-[#FFD700]">Vereinsmitglieder sind bei dieser Challenge nur als Referenz erlaubt.</div>
              )}
            </label>
            <label className="block">
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1">Proof URL</div>
              <input value={editTime.proof_url || ""} onChange={(e) => setEditTime({ ...editTime, proof_url: e.target.value })} placeholder="Screenshot / Video" data-testid="f1-edit-time-proof" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
            </label>
            <label className="block">
              <div className={`text-[11px] font-bold uppercase tracking-widest mb-1 ${(Number(editTime.penalty_seconds) > 0 || editTime.is_invalid) ? "text-[#FF3B30]" : "text-white/60"}`}>
                {(Number(editTime.penalty_seconds) > 0 || editTime.is_invalid)
                  ? "Begründung (Pflicht, ≥5 Zeichen — wird Spieler angezeigt)"
                  : "Admin-Notiz (intern)"}
              </div>
              <textarea
                rows={2}
                value={editTime.admin_note || ""}
                onChange={(e) => setEditTime({ ...editTime, admin_note: e.target.value })}
                data-testid="f1-edit-time-note"
                placeholder={(Number(editTime.penalty_seconds) > 0 || editTime.is_invalid)
                  ? "z. B. Cut Curb T7 Lap 3 — replay 0:42"
                  : "optionale Notiz"}
                className={`w-full bg-[#0A0A0A] border px-3 py-2 rounded-sm text-sm ${
                  (Number(editTime.penalty_seconds) > 0 || editTime.is_invalid) ? "border-[#FF3B30]/40" : "border-white/10"
                }`}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!editTime.is_invalid} onChange={(e) => setEditTime({ ...editTime, is_invalid: e.target.checked })} data-testid="f1-edit-time-invalid" className="accent-[#29B6E8]" />
              <span>Als ungültig markieren (zählt nicht für Rangliste)</span>
            </label>
            <div className="flex gap-2 pt-2">
              <button onClick={saveEdit} data-testid="f1-edit-time-save" className="flex-1 px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm">Speichern</button>
              <button onClick={() => setEditTime(null)} className="px-4 py-2 border border-white/20 text-white font-bold uppercase tracking-wider rounded-sm">Abbrechen</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

const F1_STAFF_ROLE_OPTIONS = [
  ["scorekeeper", "Ergebnisdienst"],
  ["referee", "Schiedsrichter"],
  ["organizer", "Organisation"],
];

function F1StaffPanel({ challengeId, staff, users, onChanged }) {
  const [form, setForm] = useState({ user_id: "", role: "scorekeeper", notes: "" });
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();
  const set = (k, v) => setForm((current) => ({ ...current, [k]: v }));
  const userLabel = (u) => `${u.display_name || u.username || u.email || u.id}${u.email ? ` - ${u.email}` : ""}`;
  const roleLabel = (role) => F1_STAFF_ROLE_OPTIONS.find(([value]) => value === role)?.[1] || role;

  const add = async (event) => {
    event.preventDefault();
    if (!form.user_id) {
      toast.error("Bitte Nutzer auswahlen.");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/f1/challenges/${challengeId}/staff`, form);
      toast.success("Fast-Lap-Zuweisung gespeichert.");
      setForm({ user_id: "", role: "scorekeeper", notes: "" });
      onChanged();
    } catch (err) {
      toast.error(formatRequestError(err, "Fast-Lap-Zuweisung konnte nicht gespeichert werden."));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (assignment) => {
    try {
      await api.patch(`/f1/challenges/${challengeId}/staff/${assignment.id}`, { is_active: assignment.is_active === false });
      onChanged();
    } catch (err) {
      toast.error(formatRequestError(err, "Zuweisung konnte nicht aktualisiert werden."));
    }
  };

  const remove = async (assignment) => {
    if (!await confirm({
      title: "Zuweisung entfernen?",
      description: "Der Account verliert die Berechtigung, Fast-Lap-Zeiten direkt einzutragen.",
      confirmLabel: "Entfernen",
    })) return;
    try {
      await api.delete(`/f1/challenges/${challengeId}/staff/${assignment.id}`);
      toast.success("Zuweisung entfernt.");
      onChanged();
    } catch (err) {
      toast.error(formatRequestError(err, "Zuweisung konnte nicht entfernt werden."));
    }
  };

  return (
    <div className="mb-6 border border-white/10 bg-[#121212] rounded-sm p-5">
      <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Fast-Lap-Team</div>
      <div className="mt-4 grid lg:grid-cols-3 gap-5">
        <form onSubmit={add} className="space-y-3">
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Nutzer</div>
            <select value={form.user_id} onChange={(e) => set("user_id", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
              <option value="">- auswählen -</option>
              {users.map((u) => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Rolle</div>
            <select value={form.role} onChange={(e) => set("role", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
              {F1_STAFF_ROLE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Notiz</div>
            <input value={form.notes} onChange={(e) => set("notes", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="z.B. Beamer-Station Samstag" />
          </label>
          <button disabled={saving} className="w-full px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-sm disabled:opacity-50">Hinzufügen</button>
        </form>
        <div className="lg:col-span-2 border border-white/10 rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr>
                <th className="text-left px-4 py-3">Nutzer</th>
                <th className="text-left px-4 py-3">Rolle</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {staff.map((assignment) => (
                <tr key={assignment.id}>
                  <td className="px-4 py-3">
                    <div className="font-semibold">{assignment.user?.display_name || assignment.user?.username || "-"}</div>
                    <div className="text-xs text-white/40">{assignment.user?.email || assignment.user_id}</div>
                  </td>
                  <td className="px-4 py-3">{roleLabel(assignment.role)}</td>
                  <td className="px-4 py-3"><StatusBadge status={assignment.is_active === false ? "paused" : "approved"} /></td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => toggle(assignment)} className="px-2 py-1 border border-white/15 text-white/70 rounded-sm text-[10px] font-bold uppercase">
                        {assignment.is_active === false ? "Aktivieren" : "Pausieren"}
                      </button>
                      <button type="button" onClick={() => remove(assignment)} className="px-2 py-1 border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm text-[10px] font-bold uppercase">
                        Entfernen
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {staff.length === 0 && <tr><td colSpan="4" className="text-center py-8 text-white/40">Noch keine Fast-Lap-Zeitnehmer</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ChallengeSettingsForm({ challenge, onSaved }) {
  const dt = toDateTimeLocalInput;
  const formFromChallenge = (source = challenge) => ({
    title: source.title || "",
    description: source.description || "",
    banner_url: source.banner_url || "",
    event_id: source.event_id || "",
    visibility: source.visibility || "public",
    vehicle: source.vehicle || "",
    weather: source.weather || "",
    assists_allowed: source.assists_allowed || "",
    controller_type: source.controller_type || "",
    platform: source.platform || "",
    registration_enabled: source.online_registration_enabled === true && source.registration_enabled === true,
    registration_open_from: dt(source.registration_open_from),
    registration_open_until: dt(source.registration_open_until),
    start_date: dt(source.start_date),
    end_date: dt(source.end_date),
    block_club_member_results: !!source.block_club_member_results,
    allow_club_reference_times: source.allow_club_reference_times !== false,
    show_club_reference_times: source.show_club_reference_times !== false,
    unlimited_attempts: source.unlimited_attempts !== false,
    max_attempts: source.max_attempts || 0,
    site_banner_enabled: !!source.site_banner_enabled,
    season_weight: source.season_weight ?? 1,
    prize_places: source.prize_places || [],
  });
  const [form, setForm] = useState(formFromChallenge());
  const [events, setEvents] = useState([]);
  const [creatingPrizes, setCreatingPrizes] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    api.get("/events?include_drafts=true").then(({ data }) => setEvents(data || [])).catch(() => {});
  }, []);

  const save = async () => {
    try {
      const normalizePayload = (source) => {
        const payload = { ...source };
        if (payload.block_club_member_results) payload.allow_club_reference_times = true;
        if (!payload.event_id) payload.event_id = null;
        if (payload.unlimited_attempts) payload.max_attempts = null;
        if (!payload.registration_enabled) {
          payload.registration_open_from = null;
          payload.registration_open_until = null;
        }
        payload.season_weight = Number(payload.season_weight || 0);
        payload.prize_places = (payload.prize_places || [])
          .filter((p) => p.value && p.value.trim())
          .map((p) => ({ place: Number(p.place) || 0, label: p.label || `Platz ${p.place}`, value: p.value }));
        if (payload.prize_places.length === 0) payload.prize_places = null;
        normalizeDateTimeFields(payload, ["registration_open_from", "registration_open_until", "start_date", "end_date"]);
        return payload;
      };
      const payload = normalizePayload(form);
      const patch = buildDirtyPayload(payload, normalizePayload(formFromChallenge()));
      if (!hasPayloadChanges(patch)) {
        toast.info("Keine Änderungen zum Speichern.");
        return;
      }
      await api.patch(`/f1/challenges/${challenge.id}`, patch);
      toast.success("Challenge gespeichert.");
      onSaved();
    } catch (e) { toast.error(formatRequestError(e, "Challenge konnte nicht gespeichert werden.", { title: form.title })); }
  };

  const createPrizePickups = async () => {
    setCreatingPrizes(true);
    try {
      const { data } = await api.post(`/prizes/auto-create/fastlap/${challenge.id}`);
      toast.success(`${data.created || 0} Fast-Lap-Gewinne angelegt.`);
    } catch (e) {
      toast.error(formatRequestError(e, "Fast-Lap-Gewinne konnten nicht angelegt werden."));
    } finally {
      setCreatingPrizes(false);
    }
  };
  return (
    <div className="mb-6 border border-white/10 bg-[#121212] rounded-sm p-5 space-y-4">
      <div className="font-heading font-bold uppercase">Challenge Einstellungen</div>
      <div className="grid md:grid-cols-2 gap-4">
        <SmallField label="Titel" value={form.title} onChange={(v)=>set("title", v)} />
        <SmallField label="Plattform" value={form.platform} onChange={(v)=>set("platform", v)} />
      </div>
      {events.length > 0 && (
        <SmallSelect
          label="Zugehöriges Event"
          value={form.event_id || ""}
          onChange={(v) => set("event_id", v)}
          options={[["", "— kein Event —"], ...events.map((e) => [e.id, e.name])]}
        />
      )}
      <SmallSelect
        label="Sichtbarkeit"
        value={form.visibility}
        onChange={(v) => set("visibility", v)}
        options={[
          ["public", "Öffentlich"],
          ["community", "Nur registrierte Community"],
          ["members", "Nur Vereinsmitglieder"],
          ["internal", "Nur intern"],
        ]}
      />
      <ImageUpload value={form.banner_url} onChange={(v)=>set("banner_url", v)} label="Challenge-Banner" testId="f1-edit-banner-upload" variant="wide" allowLibrary />
      <div className="grid md:grid-cols-2 gap-4">
        <SmallField label="Start Challenge/Event" type="datetime-local" value={form.start_date} onChange={(v)=>set("start_date", v)} />
        <SmallField label="Ende Challenge/Event" type="datetime-local" value={form.end_date} onChange={(v)=>set("end_date", v)} />
        {form.registration_enabled && <SmallField label="Online-Einreichung öffnet" type="datetime-local" value={form.registration_open_from} onChange={(v)=>set("registration_open_from", v)} />}
        {form.registration_enabled && <SmallField label="Online-Einreichung endet" type="datetime-local" value={form.registration_open_until} onChange={(v)=>set("registration_open_until", v)} />}
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <SmallField label="Fahrzeug" value={form.vehicle} onChange={(v)=>set("vehicle", v)} />
        <SmallField label="Wetter" value={form.weather} onChange={(v)=>set("weather", v)} />
        <SmallField label="Fahrhilfen" value={form.assists_allowed} onChange={(v)=>set("assists_allowed", v)} />
        <SmallField label="Controller-Typ" value={form.controller_type} onChange={(v)=>set("controller_type", v)} />
      </div>
      <FastLapSeasonWeightField value={form.season_weight} onChange={(v)=>set("season_weight", v)} />
      <FastLapPrizeEditor value={form.prize_places} onChange={(v)=>set("prize_places", v)} />
      {challenge.status === "results_published" && (
        <div className="border border-[#FFD700]/25 bg-[#FFD700]/5 rounded-sm p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-[#FFD700]">Gewinnabholung</div>
            <div className="text-xs text-white/55 mt-0.5">Erzeugt fehlende Gewinn-Einträge aus der aktuellen Fast-Lap-Wertung.</div>
          </div>
          <button type="button" disabled={creatingPrizes} onClick={createPrizePickups} className="px-4 py-2 bg-[#FFD700] text-black font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-50">
            {creatingPrizes ? "Erzeuge..." : "Gewinne erzeugen"}
          </button>
        </div>
      )}
      <MarkdownEditor value={form.description} onChange={(v)=>set("description", v)} rows={5} testId="f1-edit-description" placeholder="Beschreibung" />
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="flex items-start gap-2 text-sm text-white/75"><input type="checkbox" checked={form.registration_enabled} onChange={(e)=>set("registration_enabled", e.target.checked)} className="accent-[#29B6E8] mt-1"/><span>Online-Einreichung öffentlich anzeigen</span></label>
        <label className="flex items-start gap-2 text-sm text-white/75"><input type="checkbox" checked={form.unlimited_attempts} onChange={(e)=>set("unlimited_attempts", e.target.checked)} className="accent-[#29B6E8] mt-1"/><span>Unbegrenzte Versuche</span></label>
        <label className="flex items-start gap-2 text-sm text-white/75"><input type="checkbox" checked={form.site_banner_enabled} onChange={(e)=>set("site_banner_enabled", e.target.checked)} className="accent-[#FFD700] mt-1"/><span>Automatisches Fast-Lap-Hinweisbanner anzeigen</span></label>
      </div>
      <div className="border border-[#FFD700]/20 bg-[#FFD700]/5 rounded-sm p-3 space-y-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#FFD700]">Teilnahme & Vereins-Referenzzeiten</div>
          <div className="text-xs text-white/50 mt-1">Für externe Fast-Lap-Challenges kann die Vereinswertung sauber von Referenzzeiten getrennt werden.</div>
        </div>
        <label className="flex items-start gap-2 text-sm text-white/75">
          <input
            type="checkbox"
            checked={form.block_club_member_results}
            onChange={(e)=>{
              const checked = e.target.checked;
              setForm((f) => ({ ...f, block_club_member_results: checked, allow_club_reference_times: checked ? true : f.allow_club_reference_times }));
            }}
            className="accent-[#29B6E8] mt-1"
          />
          <span><strong className="text-white">Vereinsmitglieder aus offizieller Wertung ausschließen</strong><br /><span className="text-xs text-white/50">Sie erscheinen nicht in Rangliste, Jahrespunkten oder Achievements dieser Challenge.</span></span>
        </label>
        <label className="flex items-start gap-2 text-sm text-white/75">
          <input
            type="checkbox"
            checked={form.allow_club_reference_times}
            disabled={form.block_club_member_results}
            onChange={(e)=>set("allow_club_reference_times", e.target.checked)}
            className="accent-[#29B6E8] mt-1 disabled:opacity-50"
          />
          <span><strong className="text-white">Vereins-Referenzzeiten erlauben</strong><br /><span className="text-xs text-white/50">Separater Bereich außer Wertung als Motivation/Zielzeit.</span></span>
        </label>
        <label className="flex items-start gap-2 text-sm text-white/75">
          <input
            type="checkbox"
            checked={form.show_club_reference_times}
            disabled={!form.allow_club_reference_times}
            onChange={(e)=>set("show_club_reference_times", e.target.checked)}
            className="accent-[#29B6E8] mt-1 disabled:opacity-50"
          />
          <span><strong className="text-white">Referenzzeiten öffentlich anzeigen</strong><br /><span className="text-xs text-white/50">Wenn aus, bleiben Referenzzeiten nur im Admin sichtbar.</span></span>
        </label>
      </div>
      {!form.unlimited_attempts && <SmallField label="Max Versuche" type="number" value={form.max_attempts} onChange={(v)=>set("max_attempts", Number(v))} />}
      <button type="button" onClick={save} className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm">Speichern</button>
    </div>
  );
}

function SmallField({ label, value, onChange, type = "text" }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <input type={type} value={value ?? ""} onChange={(e)=>onChange(e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
    </label>
  );
}

function FastLapPrizeEditor({ value, onChange }) {
  const prizes = value || [];
  const update = (index, patch) => {
    const next = [...prizes];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };
  return (
    <div className="border border-[#FFD700]/20 bg-[#FFD700]/5 rounded-sm p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#FFD700]">Preise</div>
          <div className="text-xs text-white/50 mt-0.5">Wird bei Ergebnisveröffentlichung als Gewinnabholung angelegt.</div>
        </div>
        <button
          type="button"
          onClick={() => onChange([...prizes, { place: prizes.length + 1, label: "", value: "" }])}
          data-testid="f1-edit-prize-add"
          className="text-xs font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white"
        >
          + Platz hinzufügen
        </button>
      </div>
      {prizes.map((p, i) => (
        <div key={i} className="grid grid-cols-12 gap-2">
          <input
            type="number"
            min="1"
            value={p.place}
            onChange={(e) => update(i, { place: Number(e.target.value) || 1 })}
            data-testid={`f1-edit-prize-place-${i}`}
            className="col-span-2 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm tabular-nums"
            placeholder="#"
          />
          <input
            value={p.label || ""}
            onChange={(e) => update(i, { label: e.target.value })}
            data-testid={`f1-edit-prize-label-${i}`}
            className="col-span-4 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm"
            placeholder="Label"
          />
          <input
            value={p.value || ""}
            onChange={(e) => update(i, { value: e.target.value })}
            data-testid={`f1-edit-prize-value-${i}`}
            className="col-span-5 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm"
            placeholder="Preis"
          />
          <button
            type="button"
            onClick={() => onChange(prizes.filter((_, j) => j !== i))}
            data-testid={`f1-edit-prize-remove-${i}`}
            className="col-span-1 text-white/40 hover:text-[#FF3B30] text-center py-2"
          >
            x
          </button>
        </div>
      ))}
      {prizes.length === 0 && <div className="text-xs text-white/40">Noch keine Preise hinterlegt.</div>}
    </div>
  );
}

function SmallSelect({ label, value, onChange, options }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <select value={value ?? ""} onChange={(e)=>onChange(e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function FastLapSeasonWeightField({ value, onChange }) {
  const normalized = String(value ?? "1");
  const isPreset = F1_SEASON_WEIGHT_OPTIONS.some(([optionValue]) => optionValue === normalized);
  return (
    <label className="block border border-[#29B6E8]/20 bg-[#29B6E8]/5 rounded-sm p-3">
      <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8] mb-1.5">Jahreswertung</div>
      <div className="grid sm:grid-cols-[1fr_120px] gap-2">
        <select value={isPreset ? normalized : "__custom"} onChange={(e)=>onChange(e.target.value === "__custom" ? value : e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
          {F1_SEASON_WEIGHT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          <option value="__custom">Eigener Faktor</option>
        </select>
        <input type="number" step="0.05" min="0" value={value ?? ""} onChange={(e)=>onChange(e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" aria-label="Jahreswertungs-Faktor" />
      </div>
      <div className="text-[11px] text-white/45 mt-1.5">
        Bestimmt, wie stark diese Fast-Lap Challenge in die Jahreswertung eingeht. 0 bedeutet: keine Jahrespunkte.
      </div>
    </label>
  );
}
