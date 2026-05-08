import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { API, api, formatApiError, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { BracketTree } from "@/components/tls/BracketTree";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { MarkdownEditor } from "@/components/tls/MarkdownEditor";
import { normalizeDateTimeFields, toDateTimeLocalInput } from "@/lib/datetime";
import { toast } from "sonner";
import { Zap, RefreshCw, Eye } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useConfirm, usePrompt } from "@/components/tls/ConfirmDialog";

const TOURNAMENT_STATUS_OPTIONS = [
  ["draft", "Entwurf"],
  ["scheduled", "Angekündigt"],
  ["registration_open", "Anmeldung offen"],
  ["registration_closed", "Anmeldung geschlossen"],
  ["check_in", "Check-in offen"],
  ["live", "Live"],
  ["paused", "Pausiert"],
  ["completed", "Beendet"],
  ["results_published", "Ergebnisse veröffentlicht"],
  ["archived", "Archiviert"],
  ["cancelled", "Abgesagt"],
];

const TOURNAMENT_FORMAT_OPTIONS = [
  ["single_elim", "Single Elimination"],
  ["double_elim", "Double Elimination"],
  ["round_robin", "Round Robin"],
  ["swiss", "Swiss"],
  ["groups", "Gruppen"],
  ["ffa", "Free For All"],
  ["battle_royale", "Battle Royale"],
  ["league", "Liga"],
  ["time_trial", "Time Trial"],
  ["grand_prix", "Grand Prix"],
];

const TEAM_MODE_OPTIONS = [["solo", "Solo"], ["duo", "Duo"], ["team", "Team"], ["squad", "Squad"]];
const SEEDING_OPTIONS = [["random", "Zufall"], ["manual", "Manuell"], ["ranking", "Ranking"]];
const VISIBILITY_OPTIONS = [["public", "Öffentlich"], ["community", "Community"], ["members", "Vereinsmitglieder"], ["internal", "Intern"]];
const STREAM_PLATFORM_OPTIONS = [["", "—"], ["twitch", "Twitch"], ["youtube", "YouTube"], ["kick", "Kick"], ["custom", "Custom"]];
const STAGE_MATCH_TYPES = [["duel", "Duel"], ["ffa", "FFA"]];
const STAGE_TYPES = [
  ["single_elimination", "Single Elimination"],
  ["double_elimination", "Double Elimination"],
  ["custom_bracket", "Custom Bracket"],
  ["round_robin_groups", "Round-robin Gruppen"],
  ["swiss", "Swiss"],
  ["league", "Liga"],
  ["simple", "Simple"],
  ["ffa_single_elimination", "FFA Single Elim"],
  ["ffa_custom_bracket", "FFA Custom Bracket"],
  ["ffa_league", "FFA Liga"],
];
const DEFAULT_FFA_SCHEMA = `[WB]
# Round 1
A=[1,2,3,4]
B=[5,6,7,8]

# Round 2
C=[W:A:1,W:A:2,W:B:1,W:B:2]

[LB]
# Round 1
LA=[L:A:3,L:A:4,L:B:3,L:B:4]`;
const MARIO_KART_32_SCHEMA = `[WB]
# Round 1 (32 -> 16)
A=[1,2,3,4]
B=[5,6,7,8]
C=[9,10,11,12]
D=[13,14,15,16]
E=[17,18,19,20]
F=[21,22,23,24]
G=[25,26,27,28]
H=[29,30,31,32]

# Round 2 (16 -> 8)
I=[W:A:1,W:A:2,W:B:1,W:B:2]
J=[W:C:1,W:C:2,W:D:1,W:D:2]
K=[W:E:1,W:E:2,W:F:1,W:F:2]
L=[W:G:1,W:G:2,W:H:1,W:H:2]

# Round 3 (8 -> 4)
M=[W:I:1,W:I:2,W:J:1,W:J:2]
N=[W:K:1,W:K:2,W:L:1,W:L:2]

# Winner Final
O=[W:M:1,W:M:2,W:N:1,W:N:2]

[LB]
# Round 1 (16 -> 8)
LA=[L:A:3,L:A:4,L:B:3,L:B:4]
LB=[L:C:3,L:C:4,L:D:3,L:D:4]
LC=[L:E:3,L:E:4,L:F:3,L:F:4]
LD=[L:G:3,L:G:4,L:H:3,L:H:4]

# Round 2 (8 -> 4)
LE=[W:LA:1,W:LA:2,W:LB:1,W:LB:2]
LF=[W:LC:1,W:LC:2,W:LD:1,W:LD:2]

# Loser Final
LG=[W:LE:1,W:LE:2,W:LF:1,W:LF:2]`;
const STAGE_PRESETS = [
  ["custom", "Eigenes Schema", null],
  ["mk8_8", "Mario Kart 8 Spieler", DEFAULT_FFA_SCHEMA],
  ["mk8_32", "Mario Kart 32 Spieler", MARIO_KART_32_SCHEMA],
];

export default function AdminTournamentEditPage() {
  const { isAdmin, isModerator } = useAuth();
  const { id } = useParams();
  const [t, setT] = useState(null);
  const [regs, setRegs] = useState([]);
  const [bracket, setBracket] = useState(null);
  const [tab, setTab] = useState("participants");
  const [groups, setGroups] = useState([]);
  const [staff, setStaff] = useState([]);
  const [users, setUsers] = useState([]);
  const [stages, setStages] = useState([]);
  const [matchesV2, setMatchesV2] = useState([]);
  const confirm = useConfirm();
  const prompt = usePrompt();

  const load = useCallback(async () => {
    const { data } = await api.get(`/tournaments/${id}?include_draft=true`);
    setT(data);
    const { data: r } = await api.get(`/tournaments/${id}/registrations`);
    setRegs(r);
    const { data: b } = await api.get(`/tournaments/${id}/bracket`);
    setBracket(b);
    try {
      const [{ data: st }, { data: mv2 }] = await Promise.all([
        api.get(`/tournaments/${id}/stages`),
        api.get(`/tournaments/${id}/matches-v2`),
      ]);
      setStages(st || []);
      setMatchesV2(mv2 || []);
    } catch {
      setStages([]);
      setMatchesV2([]);
    }
    if (data.format === "groups") {
      try { const { data: g } = await api.get(`/tournaments/${id}/groups`); setGroups(g || []); }
      catch { setGroups([]); }
    }
    if (isAdmin) {
      const [{ data: s }, { data: u }] = await Promise.all([
        api.get(`/tournaments/${id}/staff`),
        api.get("/users"),
      ]);
      setStaff(s || []);
      setUsers(u || []);
    }
  }, [id, isAdmin]);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["tournaments", "matches", "stations"]);

  const generate = async () => {
    try {
      const { data } = await api.post(`/tournaments/${id}/generate-bracket`);
      toast.success(`Bracket mit ${data.match_count} Matches generiert.`);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const reset = async () => {
    if (!await confirm({
      title: "Bracket zurücksetzen?",
      description: "Alle generierten Bracket-Daten werden zurückgesetzt. Diese Aktion ist für laufende Turniere kritisch.",
      confirmLabel: "Zurücksetzen",
    })) return;
    try {
      await api.post(`/tournaments/${id}/reset-bracket`);
      toast.success("Bracket zurückgesetzt.");
      load();
    } catch (e) {
      if (e.response?.status === 409) {
        const force = await confirm({
          title: "Laufendes Bracket wirklich zurücksetzen?",
          description: "Das Turnier ist live oder bereits beendet. Beim Fortfahren werden alle Matches endgültig gelöscht.",
          confirmLabel: "Trotzdem zurücksetzen",
          tone: "danger",
        });
        if (!force) return;
        try {
          await api.post(`/tournaments/${id}/reset-bracket?force=true`);
          toast.success("Bracket zurückgesetzt.");
          load();
          return;
        } catch (inner) {
          toast.error(formatRequestError(inner, "Bracket konnte nicht zurueckgesetzt werden."));
          return;
        }
      }
      toast.error(formatRequestError(e, "Bracket konnte nicht zurueckgesetzt werden."));
    }
  };
  const setRegStatus = async (rid, status) => {
    try {
      await api.patch(`/tournaments/${id}/registrations/${rid}`, { status });
      load();
    } catch (e) {
      toast.error(formatRequestError(e, "Teilnehmerstatus konnte nicht gespeichert werden."));
    }
  };
  const setRegCheckinStatus = async (rid, status) => {
    try {
      await api.post(`/tournaments/${id}/registrations/${rid}/checkin`, { status });
      toast.success(status === "checked_in" ? "Check-in gesetzt." : status === "no_show" ? "No-Show gesetzt." : "Check-in zurückgenommen.");
      load();
    } catch (e) {
      toast.error(formatRequestError(e, "Check-in konnte nicht gespeichert werden."));
    }
  };
  const setTournStatus = async (status) => {
    try {
      await api.post(`/tournaments/${id}/status`, { status });
      toast.success(`Status: ${status}`);
      load();
    } catch (e) {
      toast.error(formatRequestError(e, "Turnierstatus konnte nicht gespeichert werden."));
    }
  };
  const updateMatchResult = async (m, scoreA, scoreB, winnerId) => {
    try {
      await api.patch(`/matches/${m.id}`, {
        score_a: Number(scoreA) || 0,
        score_b: Number(scoreB) || 0,
        winner_id: winnerId || null,
        status: winnerId ? "completed" : "waiting_result",
      });
      toast.success("Ergebnis gespeichert.");
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const updateMatchV2Result = async (match, results, meta = {}) => {
    try {
      const suffix = meta.force ? "?force=true" : "";
      await api.post(`/matches-v2/${match.id}/result${suffix}`, {
        results,
        proof_url: meta.proof_url || null,
        note: meta.note || null,
      });
      toast.success("Ergebnis gespeichert.");
      load();
    } catch (e) {
      if (e.response?.status === 409 && !meta.force) {
        const force = await confirm({
          title: "Folgeslots überschreiben?",
          description: "Dieses Ergebnis würde bereits gefüllte Folgematches ändern.",
          confirmLabel: "Mit force speichern",
          tone: "danger",
        });
        if (force) return updateMatchV2Result(match, results, { ...meta, force: true });
      }
      toast.error(formatRequestError(e, "Ergebnis konnte nicht gespeichert werden."));
    }
  };
  const generateGroups = async () => {
    const gc = await prompt({
      title: "Gruppen generieren",
      description: "Wie viele Gruppen sollen erstellt werden?",
      defaultValue: "4",
      placeholder: "4",
      confirmLabel: "Generieren",
      tone: "info",
      multiline: false,
      required: true,
    });
    if (!gc) return;
    const groupCount = parseInt(gc, 10);
    if (!Number.isFinite(groupCount) || groupCount < 1) {
      toast.error("Bitte eine gültige Gruppenanzahl eingeben.");
      return;
    }
    try {
      const { data } = await api.post(`/tournaments/${id}/groups/generate`, { group_count: groupCount });
      toast.success(`${data.group_count} Gruppen mit ${data.match_count} Matches`);
      load();
    } catch (e) {
      toast.error(formatRequestError(e, "Gruppen konnten nicht generiert werden."));
    }
  };

  if (!t) return <AdminLayout><div className="p-10 text-white/40">Lade…</div></AdminLayout>;
  const hasFlexibleStructure = stages.length > 0 || matchesV2.length > 0;

  return (
    <AdminLayout>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <Link to="/admin/tournaments" className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8] hover:text-white">← Turniere</Link>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">{t.title}</h1>
          <div className="mt-2 flex items-center gap-3 flex-wrap">
            <StatusBadge status={t.status} />
            <span className="text-white/60 text-sm">{t.format?.replace("_", " ")}</span>
            <Link to={`/tournaments/${t.slug || t.id}`} target="_blank" className="text-[#29B6E8] text-xs uppercase tracking-wider font-bold hover:text-white inline-flex items-center gap-1"><Eye className="w-3 h-3" /> Public Seite</Link>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isAdmin && (
            <div>
              <select value={t.status} onChange={(e) => setTournStatus(e.target.value)} data-testid="admin-tr-status-select" className="bg-[#0A0A0A] border border-white/10 px-3 py-2 text-sm rounded-sm">
                {TOURNAMENT_STATUS_OPTIONS.map(([s, label]) => <option key={s} value={s}>{label}</option>)}
              </select>
              <div className="mt-1 text-[10px] text-white/40">Manuell nur für Ausnahmen; Zeitplan automatisiert.</div>
            </div>
          )}
          {isAdmin && !hasFlexibleStructure && <button onClick={generate} data-testid="admin-tr-generate" className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-sm hover:bg-[#1E95C2] inline-flex items-center gap-2">
            <Zap className="w-3.5 h-3.5" /> Bracket generieren
          </button>}
          {isAdmin && <button onClick={reset} data-testid="admin-tr-reset" className="px-4 py-2 border border-white/20 text-white font-bold uppercase tracking-wider rounded-sm text-sm hover:border-[#FF3B30]/60 hover:text-[#FF3B30] inline-flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5" /> Reset
          </button>}
          {isAdmin && t.format === "swiss" && (
            <button onClick={async()=>{ try{ const {data} = await api.post(`/tournaments/${id}/swiss/next-round`); toast.success(`Runde ${data.round} mit ${data.match_count} Matches generiert`); load(); }catch(e){ toast.error(formatRequestError(e, "Swiss-Runde konnte nicht generiert werden.")); } }} data-testid="admin-tr-swiss-next" className="px-4 py-2 border border-[#29B6E8] text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm text-sm">Swiss Runde</button>
          )}
          {isAdmin && t.format === "groups" && (
            <button onClick={generateGroups} data-testid="admin-tr-groups" className="px-4 py-2 border border-[#29B6E8] text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm text-sm">Gruppen generieren</button>
          )}
          <div className="flex gap-1">
            <a href={`${API}/exports/tournaments/${t.id}/participants.pdf`} className="px-3 py-2 border border-white/20 text-white/80 text-xs uppercase font-bold rounded-sm hover:border-[#29B6E8]/40" target="_blank" rel="noreferrer">PDF Teilnehmer</a>
            <a href={`${API}/exports/tournaments/${t.id}/checkin.pdf`} className="px-3 py-2 border border-white/20 text-white/80 text-xs uppercase font-bold rounded-sm hover:border-[#29B6E8]/40" target="_blank" rel="noreferrer">PDF Check-in</a>
            <a href={`${API}/exports/tournaments/${t.id}/matches.pdf`} className="px-3 py-2 border border-white/20 text-white/80 text-xs uppercase font-bold rounded-sm hover:border-[#29B6E8]/40" target="_blank" rel="noreferrer">PDF Matches</a>
          </div>
        </div>
      </div>

      <div className="flex gap-2 mb-5 border-b border-white/10 overflow-x-auto">
        {["participants", "bracket", ...(hasFlexibleStructure ? [] : ["matches"]), "stages", ...(t.format === "groups" ? ["groups"] : []), ...(isAdmin ? ["staff"] : []), "edit"].map((s) => (
          <button
            key={s}
            data-testid={`admin-tr-tab-${s}`}
            onClick={() => setTab(s)}
            className={`px-4 py-3 text-xs font-bold uppercase tracking-wider whitespace-nowrap ${tab === s ? "text-[#29B6E8] border-b-2 border-[#29B6E8]" : "text-white/60 hover:text-white"}`}
          >
            {s === "participants" ? "Teilnehmer" : s === "bracket" ? "Bracket" : s === "matches" ? "Matches" : s === "stages" ? "Struktur" : s === "groups" ? "Gruppen" : s === "staff" ? "Team" : "Bearbeiten"}
          </button>
        ))}
      </div>

      {tab === "participants" && (
        <div className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr>
                <th className="text-left px-4 py-3">#</th>
                <th className="text-left px-4 py-3">Spieler</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Discord</th>
                <th className="text-right px-4 py-3">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {regs.map((r, i) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 text-white/50">{i + 1}</td>
                  <td className="px-4 py-3">{r.display_name || r.user?.display_name || r.ingame_name}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3 text-white/60">{r.discord || "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      {isAdmin && (
                        <select value={r.status} onChange={(e) => setRegStatus(r.id, e.target.value)} data-testid={`admin-reg-status-${r.id}`} className="bg-[#0A0A0A] border border-white/10 px-2 py-1 text-xs rounded-sm">
                          {["pending", "approved", "rejected", "waitlist", "checked_in", "no_show"].map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      )}
                      {isModerator && r.status !== "checked_in" && !["rejected", "waitlist"].includes(r.status) && (
                        <button type="button" onClick={() => setRegCheckinStatus(r.id, "checked_in")} className="px-2 py-1 border border-[#00FF88]/40 text-[#00FF88] rounded-sm text-[10px] font-bold uppercase">Check-in</button>
                      )}
                      {isModerator && r.status === "checked_in" && (
                        <button type="button" onClick={() => setRegCheckinStatus(r.id, "approved")} className="px-2 py-1 border border-white/20 text-white/70 rounded-sm text-[10px] font-bold uppercase">Auschecken</button>
                      )}
                      {isModerator && !["checked_in", "rejected", "waitlist", "no_show"].includes(r.status) && (
                        <button type="button" onClick={() => setRegCheckinStatus(r.id, "no_show")} className="px-2 py-1 border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm text-[10px] font-bold uppercase">No-Show</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {regs.length === 0 && <tr><td colSpan="5" className="text-center py-10 text-white/40">Keine Anmeldungen</td></tr>}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {tab === "bracket" && bracket && (
        <div className="bg-[#0A0A0A] rounded-sm p-4 border border-white/10">
          {(bracket.matches?.length || 0) + (bracket.matches_v2?.length || 0) === 0 ? (
            <div className="text-center py-16 text-white/40 font-display tracking-widest">BRACKET NICHT GENERIERT</div>
          ) : (
            <BracketTree data={bracket} />
          )}
        </div>
      )}

      {tab === "matches" && bracket?.matches && (
        <div className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr>
                <th className="text-left px-4 py-3">Runde</th>
                <th className="text-left px-4 py-3">Teilnehmer A</th>
                <th className="text-left px-4 py-3">Teilnehmer B</th>
                <th className="text-center px-4 py-3">Score</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {bracket.matches.map((m) => {
                const a = bracket.registrations.find((r) => r.id === m.participant_a_id);
                const b = bracket.registrations.find((r) => r.id === m.participant_b_id);
                return (
                  <tr key={m.id}>
                    <td className="px-4 py-3 text-white/70">{m.round_name || m.round}</td>
                    <td className="px-4 py-3">{a?.display_name || "TBD"}</td>
                    <td className="px-4 py-3">{b?.display_name || "TBD"}</td>
                    <td className="px-4 py-3 text-center font-display font-bold">{m.score_a} : {m.score_b}</td>
                    <td className="px-4 py-3"><StatusBadge status={m.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-col items-end gap-2">
                        {isModerator && a && b && (
                          <MatchResultControls match={m} a={a} b={b} onSave={updateMatchResult} />
                        )}
                        <Link to={`/matches/${m.id}`} className="text-[#29B6E8] text-xs font-bold uppercase hover:text-white">Öffnen →</Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
      {tab === "stages" && (
        <TournamentStagesPanel
          tournamentId={t.id}
          stages={stages}
          matches={matchesV2}
          registrations={regs}
          isAdmin={isAdmin}
          isModerator={isModerator}
          onChanged={load}
          onSaveResult={updateMatchV2Result}
        />
      )}
      {tab === "edit" && (
        <TournamentEditForm key={t.updated_at || t.id} tournament={t} onSaved={load} />
      )}
      {tab === "staff" && isAdmin && (
        <TournamentStaffPanel tournamentId={t.id} staff={staff} users={users} onChanged={load} />
      )}
      {tab === "groups" && (
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {groups.map((g) => (
            <div key={g.id} className="border border-white/10 rounded-sm bg-[#121212] p-4">
              <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">Gruppe</div>
              <h3 className="font-heading text-lg font-bold">{g.name}</h3>
              <div className="mt-3 space-y-1.5">
                {(g.participant_ids || []).map((pid) => {
                  const r = bracket?.registrations.find((x) => x.id === pid);
                  return <div key={pid} className="text-sm text-white/80 truncate">{r?.display_name || "—"}</div>;
                })}
              </div>
            </div>
          ))}
          {groups.length === 0 && <div className="col-span-full text-center py-10 text-white/40">Noch keine Gruppen. Oben "Gruppen generieren" klicken.</div>}
        </div>
      )}
    </AdminLayout>
  );
}

function TournamentStagesPanel({ tournamentId, stages, matches, registrations, isAdmin, isModerator, onChanged, onSaveResult }) {
  const [createOpen, setCreateOpen] = useState(stages.length === 0);
  const [form, setForm] = useState({
    name: "Stage 1",
    match_type: "ffa",
    stage_type: "ffa_custom_bracket",
    match_size: 4,
    min_players: 2,
    qualifiers_per_match: 2,
    schema: DEFAULT_FFA_SCHEMA,
  });
  const confirm = useConfirm();
  const regById = Object.fromEntries((registrations || []).map((r) => [r.id, r]));
  const set = (k, v) => setForm((x) => ({ ...x, [k]: v }));
  const applyPreset = (key) => {
    const preset = STAGE_PRESETS.find(([value]) => value === key);
    if (!preset?.[2]) return;
    setForm((current) => ({
      ...current,
      match_type: "ffa",
      stage_type: "ffa_custom_bracket",
      match_size: 4,
      min_players: 2,
      qualifiers_per_match: 2,
      schema: preset[2],
    }));
  };
  const createStage = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/tournaments/${tournamentId}/stages`, {
        name: form.name || "Stage",
        match_type: form.match_type,
        stage_type: form.stage_type,
        settings: {
          match_size: Number(form.match_size) || 4,
          min_players: Number(form.min_players) || 2,
          qualifiers_per_match: Number(form.qualifiers_per_match) || 1,
          schema: form.schema || "",
          score_type: "points",
          calculation: "points",
        },
      });
      toast.success("Stage angelegt.");
      setCreateOpen(false);
      onChanged();
    } catch (err) {
      toast.error(formatRequestError(err, "Stage konnte nicht angelegt werden."));
    }
  };
  const removeStage = async (stage) => {
    if (!await confirm({
      title: "Stage löschen?",
      description: "Alle Matches und Reports dieser Stage werden gelöscht.",
      confirmLabel: "Löschen",
      tone: "danger",
    })) return;
    try {
      await api.delete(`/tournaments/${tournamentId}/stages/${stage.id}`);
      toast.success("Stage gelöscht.");
      onChanged();
    } catch (err) {
      toast.error(formatRequestError(err, "Stage konnte nicht gelöscht werden."));
    }
  };

  return (
    <div className="space-y-5">
      {isAdmin && (
        <div className="border border-white/10 bg-[#121212] rounded-sm">
          <button type="button" onClick={() => setCreateOpen((v) => !v)} className="w-full flex items-center justify-between px-5 py-4 text-left">
            <span className="font-heading font-bold uppercase">Stage anlegen</span>
            <span className="text-[#29B6E8] text-xl leading-none">{createOpen ? "−" : "+"}</span>
          </button>
          {createOpen && (
            <form onSubmit={createStage} className="border-t border-white/10 p-5 grid md:grid-cols-3 gap-3">
              <Fld label="Name" value={form.name} onChange={(v)=>set("name", v)} testId="stage-new-name" />
              <SelectField label="Vorlage" value="custom" onChange={applyPreset} options={STAGE_PRESETS.map(([v, l]) => [v, l])} />
              <SelectField label="Match-Typ" value={form.match_type} onChange={(v)=>set("match_type", v)} options={STAGE_MATCH_TYPES} />
              <SelectField label="Stage-Typ" value={form.stage_type} onChange={(v)=>set("stage_type", v)} options={STAGE_TYPES} />
              <Fld label="Matchgröße" type="number" value={form.match_size} onChange={(v)=>set("match_size", v)} testId="stage-new-size" />
              <Fld label="Min Spieler" type="number" value={form.min_players} onChange={(v)=>set("min_players", v)} testId="stage-new-min" />
              <Fld label="Qualifizierte" type="number" value={form.qualifiers_per_match} onChange={(v)=>set("qualifiers_per_match", v)} testId="stage-new-qualifiers" />
              <label className="md:col-span-3 block">
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Schema</div>
                <textarea value={form.schema} onChange={(e)=>set("schema", e.target.value)} rows={8} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" data-testid="stage-new-schema" />
              </label>
              <div className="md:col-span-3">
                <button className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-sm">Stage speichern</button>
              </div>
            </form>
          )}
        </div>
      )}

      <div className="space-y-4">
        {stages.map((stage) => (
          <StageCard
            key={stage.id}
            tournamentId={tournamentId}
            stage={stage}
            matches={matches.filter((m) => m.stage_id === stage.id)}
            regById={regById}
            isAdmin={isAdmin}
            isModerator={isModerator}
            onChanged={onChanged}
            onDelete={() => removeStage(stage)}
            onSaveResult={onSaveResult}
          />
        ))}
        {stages.length === 0 && (
          <div className="border border-white/10 bg-[#121212] rounded-sm p-10 text-center text-white/40">
            Noch keine Struktur.
          </div>
        )}
      </div>
    </div>
  );
}

function StageCard({ tournamentId, stage, matches, regById, isAdmin, isModerator, onChanged, onDelete, onSaveResult }) {
  const settings = stage.settings || {};
  const [form, setForm] = useState({
    name: stage.name || "",
    match_type: stage.match_type || "ffa",
    stage_type: stage.stage_type || "ffa_custom_bracket",
    status: stage.status || "pending",
    match_size: settings.match_size || 4,
    min_players: settings.min_players || 2,
    qualifiers_per_match: settings.qualifiers_per_match || 2,
    schema: settings.schema || "",
  });
  const confirm = useConfirm();
  const set = (k, v) => setForm((x) => ({ ...x, [k]: v }));
  const applyPreset = (key) => {
    const preset = STAGE_PRESETS.find(([value]) => value === key);
    if (!preset?.[2]) return;
    setForm((current) => ({
      ...current,
      match_type: "ffa",
      stage_type: "ffa_custom_bracket",
      match_size: 4,
      min_players: 2,
      qualifiers_per_match: 2,
      schema: preset[2],
    }));
  };
  const save = async () => {
    try {
      await api.patch(`/tournaments/${tournamentId}/stages/${stage.id}`, {
        name: form.name || "Stage",
        match_type: form.match_type,
        stage_type: form.stage_type,
        status: form.status,
        settings: {
          ...settings,
          match_size: Number(form.match_size) || 4,
          min_players: Number(form.min_players) || 2,
          qualifiers_per_match: Number(form.qualifiers_per_match) || 1,
          schema: form.schema || "",
          score_type: settings.score_type || "points",
          calculation: settings.calculation || "points",
        },
      });
      toast.success("Stage gespeichert.");
      onChanged();
    } catch (err) {
      toast.error(formatRequestError(err, "Stage konnte nicht gespeichert werden."));
    }
  };
  const generate = async (force = false) => {
    try {
      const suffix = force ? "?force=true" : "";
      const { data } = await api.post(`/tournaments/${tournamentId}/stages/${stage.id}/generate${suffix}`);
      toast.success(`${data.match_count} Matches generiert.`);
      onChanged();
    } catch (err) {
      if (err.response?.status === 409 && !force) {
        const ok = await confirm({
          title: "Stage neu generieren?",
          description: "Vorhandene Matches und Reports dieser Stage werden ersetzt.",
          confirmLabel: "Neu generieren",
          tone: "danger",
        });
        if (ok) return generate(true);
      }
      toast.error(formatRequestError(err, "Stage konnte nicht generiert werden."));
    }
  };
  const statusCounts = matches.reduce((acc, m) => {
    acc[m.status || "pending"] = (acc[m.status || "pending"] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
      <div className="p-5 border-b border-white/10 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">Stage #{stage.number || "—"}</div>
          <h2 className="font-heading text-xl font-bold uppercase mt-1">{stage.name}</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-white/50">
            <span>{stage.match_type}</span>
            <span>·</span>
            <span>{stage.stage_type}</span>
            <span>·</span>
            <span>{matches.length} Matches</span>
            {Object.entries(statusCounts).map(([status, count]) => <span key={status}>· {count} {status}</span>)}
          </div>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => generate(false)} className="px-3 py-2 bg-[#29B6E8] text-black rounded-sm uppercase tracking-wider text-xs font-bold">Generate</button>
            <button type="button" onClick={save} className="px-3 py-2 border border-white/20 text-white rounded-sm uppercase tracking-wider text-xs font-bold">Speichern</button>
            <button type="button" onClick={onDelete} className="px-3 py-2 border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm uppercase tracking-wider text-xs font-bold">Löschen</button>
          </div>
        )}
      </div>
      <div className="grid lg:grid-cols-2 gap-5 p-5">
        {isAdmin && (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <Fld label="Name" value={form.name} onChange={(v)=>set("name", v)} testId={`stage-name-${stage.id}`} />
              <SelectField label="Vorlage anwenden" value="custom" onChange={applyPreset} options={STAGE_PRESETS.map(([v, l]) => [v, l])} />
              <SelectField label="Status" value={form.status} onChange={(v)=>set("status", v)} options={[["pending", "Pending"], ["ready", "Ready"], ["running", "Running"], ["completed", "Completed"], ["archived", "Archived"]]} />
              <SelectField label="Match-Typ" value={form.match_type} onChange={(v)=>set("match_type", v)} options={STAGE_MATCH_TYPES} />
              <SelectField label="Stage-Typ" value={form.stage_type} onChange={(v)=>set("stage_type", v)} options={STAGE_TYPES} />
              <Fld label="Matchgröße" type="number" value={form.match_size} onChange={(v)=>set("match_size", v)} testId={`stage-size-${stage.id}`} />
              <Fld label="Qualifizierte" type="number" value={form.qualifiers_per_match} onChange={(v)=>set("qualifiers_per_match", v)} testId={`stage-qualifiers-${stage.id}`} />
            </div>
            <label className="block">
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Schema</div>
              <textarea value={form.schema} onChange={(e)=>set("schema", e.target.value)} rows={12} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" data-testid={`stage-schema-${stage.id}`} />
            </label>
          </div>
        )}
        <div className="space-y-3">
          {matches.map((match) => (
            <MatchV2Card
              key={match.id}
              match={match}
              regById={regById}
              canEdit={isModerator}
              onSaveResult={onSaveResult}
            />
          ))}
          {matches.length === 0 && (
            <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-8 text-center text-white/40">
              Keine Matches generiert.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MatchV2Card({ match, regById, canEdit, onSaveResult }) {
  const filledSlots = (match.slots || []).filter((slot) => slot.status === "filled" && slot.registration_id);
  const labelFor = (registrationId) => {
    const reg = regById[registrationId];
    return reg?.display_name || reg?.ingame_name || reg?.user?.display_name || registrationId || "TBD";
  };
  return (
    <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-white/40">{match.section} · {match.round_name}</div>
          <div className="font-heading font-bold uppercase">{match.match_key}</div>
        </div>
        <StatusBadge status={match.status || "pending"} />
      </div>
      <div className="mt-3 grid sm:grid-cols-2 gap-2">
        {(match.slots || []).map((slot) => (
          <div key={slot.slot} className={`px-3 py-2 rounded-sm border text-sm ${slot.status === "filled" ? "border-[#29B6E8]/30 bg-[#29B6E8]/5" : "border-white/10 bg-[#121212]"}`}>
            <span className="text-white/40 mr-2">#{slot.slot}</span>{slot.registration_id ? labelFor(slot.registration_id) : slot.source?.raw || "TBD"}
          </div>
        ))}
      </div>
      {match.results?.length > 0 && (
        <div className="mt-3 grid sm:grid-cols-2 gap-2 text-xs">
          {match.results.map((result) => (
            <div key={result.registration_id} className="flex items-center justify-between bg-[#121212] border border-white/10 px-3 py-2 rounded-sm">
              <span>{result.rank}. {labelFor(result.registration_id)}</span>
              <span className="font-display text-white/70">{result.score ?? result.points ?? "—"}</span>
            </div>
          ))}
        </div>
      )}
      {canEdit && filledSlots.length > 0 && (
        <MatchV2ResultControls match={match} filledSlots={filledSlots} labelFor={labelFor} onSaveResult={onSaveResult} />
      )}
    </div>
  );
}

function MatchV2ResultControls({ match, filledSlots, labelFor, onSaveResult }) {
  const initialRows = () => {
    const existing = (match.results || []).length
      ? [...match.results].sort((a, b) => (a.rank || 0) - (b.rank || 0))
      : filledSlots.map((slot, index) => ({ registration_id: slot.registration_id, rank: index + 1, score: "", dnf: false, forfeit: false, note: "" }));
    const byReg = Object.fromEntries(existing.map((row) => [row.registration_id, row]));
    return filledSlots.map((slot, index) => ({
      registration_id: slot.registration_id,
      rank: byReg[slot.registration_id]?.rank || index + 1,
      score: byReg[slot.registration_id]?.score ?? byReg[slot.registration_id]?.points ?? "",
      dnf: !!byReg[slot.registration_id]?.dnf,
      forfeit: !!byReg[slot.registration_id]?.forfeit,
      note: byReg[slot.registration_id]?.note || "",
    }));
  };
  const [rows, setRows] = useState(initialRows);
  const [note, setNote] = useState(match.result_meta?.note || "");
  useEffect(() => {
    setRows(initialRows());
    setNote(match.result_meta?.note || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id, match.updated_at, filledSlots.length]);
  const update = (registrationId, patch) => setRows((current) => current.map((row) => row.registration_id === registrationId ? { ...row, ...patch } : row));
  const save = () => {
    const results = rows.map((row) => ({
      registration_id: row.registration_id,
      rank: Number(row.rank) || 1,
      score: row.score === "" ? null : Number(row.score),
      dnf: !!row.dnf,
      forfeit: !!row.forfeit,
      note: row.note || null,
    }));
    onSaveResult(match, results, { note });
  };
  return (
    <div className="mt-4 border-t border-white/10 pt-3 space-y-2">
      {rows.map((row) => (
        <div key={row.registration_id} className="grid grid-cols-12 gap-2 items-center">
          <div className="col-span-5 text-xs truncate">{labelFor(row.registration_id)}</div>
          <input type="number" min="1" value={row.rank} onChange={(e)=>update(row.registration_id, { rank: e.target.value })} className="col-span-2 bg-[#121212] border border-white/10 px-2 py-1 rounded-sm text-xs" aria-label="Rank" />
          <input type="number" min="0" value={row.score} onChange={(e)=>update(row.registration_id, { score: e.target.value })} className="col-span-3 bg-[#121212] border border-white/10 px-2 py-1 rounded-sm text-xs" aria-label="Score" />
          <label className="col-span-1 text-[10px] text-white/60"><input type="checkbox" checked={row.dnf} onChange={(e)=>update(row.registration_id, { dnf: e.target.checked })} className="accent-[#29B6E8]" /> DNF</label>
          <label className="col-span-1 text-[10px] text-white/60"><input type="checkbox" checked={row.forfeit} onChange={(e)=>update(row.registration_id, { forfeit: e.target.checked })} className="accent-[#FF3B30]" /> FF</label>
        </div>
      ))}
      <input value={note} onChange={(e)=>setNote(e.target.value)} className="w-full bg-[#121212] border border-white/10 px-2 py-1 rounded-sm text-xs" placeholder="Notiz" />
      <button type="button" onClick={save} className="px-3 py-2 border border-[#29B6E8]/50 text-[#29B6E8] rounded-sm text-[10px] font-bold uppercase">Ergebnis speichern</button>
    </div>
  );
}

function TournamentEditForm({ tournament, onSaved }) {
  const dt = toDateTimeLocalInput;
  const [games, setGames] = useState([]);
  const [events, setEvents] = useState([]);
  const [f, setF] = useState({
    title: tournament.title || "",
    slug: tournament.slug || "",
    description: tournament.description || "",
    game_id: tournament.game_id || "",
    platform: tournament.platform || "",
    event_id: tournament.event_id || "",
    format: tournament.format || "single_elim",
    status: tournament.status || "draft",
    team_mode: tournament.team_mode || "solo",
    team_size: tournament.team_size || 1,
    substitutes_allowed: !!tournament.substitutes_allowed,
    rules: tournament.rules || "",
    prize_pool: tournament.prize_pool || "",
    prize_places: tournament.prize_places || [],
    banner_url: tournament.banner_url || "",
    stream_link: tournament.stream_link || "",
    discord_link: tournament.discord_link || "",
    location: tournament.location || "",
    registration_enabled: tournament.registration_enabled !== false,
    is_invite_only: !!tournament.is_invite_only,
    registration_open_from: dt(tournament.registration_open_from),
    registration_open_until: dt(tournament.registration_open_until),
    check_in_from: dt(tournament.check_in_from),
    check_in_until: dt(tournament.check_in_until),
    start_date: dt(tournament.start_date),
    end_date: dt(tournament.end_date),
    max_participants: tournament.max_participants || 16,
    min_participants: tournament.min_participants || 2,
    best_of: tournament.best_of || 1,
    bronze_match: !!tournament.bronze_match,
    seeding_mode: tournament.seeding_mode || "random",
    is_public: tournament.is_public !== false,
    visibility: tournament.visibility || "public",
    twitch_channel: tournament.twitch_channel || "",
    twitch_enabled: !!tournament.twitch_enabled,
    has_live_stream: !!tournament.has_live_stream,
    stream_platform: tournament.stream_platform || "",
    stream_url: tournament.stream_url || "",
    stream_title: tournament.stream_title || "",
    show_chat: !!tournament.show_chat,
    season_weight: tournament.season_weight ?? 2,
  });
  useEffect(() => {
    api.get("/games").then(({ data }) => setGames(data || [])).catch(() => setGames([]));
    api.get("/events?include_drafts=true").then(({ data }) => setEvents(data || [])).catch(() => setEvents([]));
  }, []);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    try {
      const payload = { ...f };
      if (!payload.event_id) payload.event_id = null;
      normalizeDateTimeFields(payload, ["registration_open_from", "registration_open_until", "check_in_from", "check_in_until", "start_date", "end_date"]);
      ["team_size", "max_participants", "min_participants", "best_of"].forEach((key) => {
        if (payload[key] !== "" && payload[key] != null) payload[key] = Number(payload[key]);
      });
      payload.season_weight = Number(payload.season_weight || 0);
      payload.prize_places = (payload.prize_places || [])
        .filter((p) => p.value && String(p.value).trim())
        .map((p) => ({ place: p.place === "last" ? "last" : Number(p.place) || 0, label: p.label || (p.place === "last" ? "Letzter Platz" : `Platz ${p.place}`), value: p.value }));
      if (payload.prize_places.length === 0) payload.prize_places = null;
      await api.patch(`/tournaments/${tournament.id}`, payload);
      toast.success("Gespeichert.");
      onSaved();
    } catch (e) { toast.error(formatRequestError(e, "Turnier konnte nicht gespeichert werden.", { title: f.title })); }
  };
  return (
    <div className="max-w-4xl space-y-5">
      <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
        <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Basis</div>
        <div className="grid md:grid-cols-2 gap-3">
          <Fld label="Titel" value={f.title} onChange={(v)=>set("title",v)} testId="tr-edit-title"/>
          <Fld label="Slug / URL" value={f.slug} onChange={(v)=>set("slug", slugify(v))} testId="tr-edit-slug"/>
          <SelectField label="Spiel" value={f.game_id} onChange={(v)=>set("game_id",v)} options={[["", "— auswählen —"], ...games.map((g) => [g.id, g.name])]} />
          <Fld label="Plattform" value={f.platform} onChange={(v)=>set("platform",v)} testId="tr-edit-platform"/>
          <SelectField label="Event" value={f.event_id || ""} onChange={(v)=>set("event_id",v)} options={[["", "— keins —"], ...events.map((e) => [e.id, e.name])]} />
          <SelectField label="Status" value={f.status} onChange={(v)=>set("status",v)} options={TOURNAMENT_STATUS_OPTIONS} />
          <SelectField label="Sichtbarkeit" value={f.visibility} onChange={(v)=>set("visibility",v)} options={VISIBILITY_OPTIONS} />
          <label className="flex items-center gap-2 text-sm self-end pb-2"><input type="checkbox" checked={f.is_public} onChange={(e)=>set("is_public",e.target.checked)} className="accent-[#29B6E8]"/><span>Auf Public-Seiten sichtbar, sobald nicht Entwurf</span></label>
        </div>
      </div>
      <ImageUpload value={f.banner_url} onChange={(v)=>set("banner_url",v)} label="Turnier-Banner" testId="tr-edit-banner-upload" variant="wide" allowLibrary />
      <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-4 space-y-3">
        <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Zeitplan & Anmeldung</div>
        <div className="grid md:grid-cols-2 gap-3">
          <Fld label="Start Event/Turnier" type="datetime-local" value={f.start_date} onChange={(v)=>set("start_date",v)} testId="tr-edit-start"/>
          <Fld label="Ende Event/Turnier" type="datetime-local" value={f.end_date} onChange={(v)=>set("end_date",v)} testId="tr-edit-end"/>
          <Fld label="Anmeldung öffnet" type="datetime-local" value={f.registration_open_from} onChange={(v)=>set("registration_open_from",v)} testId="tr-edit-reg-from"/>
          <Fld label="Anmeldung endet" type="datetime-local" value={f.registration_open_until} onChange={(v)=>set("registration_open_until",v)} testId="tr-edit-reg-until"/>
          <Fld label="Check-in öffnet" type="datetime-local" value={f.check_in_from} onChange={(v)=>set("check_in_from",v)} testId="tr-edit-checkin-from"/>
          <Fld label="Check-in endet" type="datetime-local" value={f.check_in_until} onChange={(v)=>set("check_in_until",v)} testId="tr-edit-checkin-until"/>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="flex items-start gap-2 text-sm text-white/75"><input type="checkbox" checked={f.registration_enabled} onChange={(e)=>set("registration_enabled",e.target.checked)} className="accent-[#29B6E8] mt-1"/><span>Öffentliche Anmeldung erlauben</span></label>
          <label className="flex items-start gap-2 text-sm text-white/75"><input type="checkbox" checked={f.is_invite_only} onChange={(e)=>set("is_invite_only",e.target.checked)} className="accent-[#29B6E8] mt-1"/><span>Nur Einladung/manuelle Teilnehmer</span></label>
        </div>
      </div>
      <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
        <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Struktur</div>
        <div className="grid md:grid-cols-3 gap-3">
          <SelectField label="Format" value={f.format} onChange={(v)=>set("format",v)} options={TOURNAMENT_FORMAT_OPTIONS} />
          <SelectField label="Modus" value={f.team_mode} onChange={(v)=>set("team_mode",v)} options={TEAM_MODE_OPTIONS} />
          <SelectField label="Seeding" value={f.seeding_mode} onChange={(v)=>set("seeding_mode",v)} options={SEEDING_OPTIONS} />
          <Fld label="Teamgröße" type="number" value={f.team_size} onChange={(v)=>set("team_size",v)} testId="tr-edit-team-size"/>
          <Fld label="Min Teilnehmer" type="number" value={f.min_participants} onChange={(v)=>set("min_participants",v)} testId="tr-edit-min"/>
          <Fld label="Max Teilnehmer" type="number" value={f.max_participants} onChange={(v)=>set("max_participants",v)} testId="tr-edit-max"/>
          <Fld label="Best of" type="number" value={f.best_of} onChange={(v)=>set("best_of",v)} testId="tr-edit-bo"/>
          <Fld label="Season Gewicht" type="number" value={f.season_weight} onChange={(v)=>set("season_weight",v)} testId="tr-edit-season-weight"/>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.bronze_match} onChange={(e)=>set("bronze_match",e.target.checked)} className="accent-[#29B6E8]"/><span>Bronze Match</span></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.substitutes_allowed} onChange={(e)=>set("substitutes_allowed",e.target.checked)} className="accent-[#29B6E8]"/><span>Ersatzspieler erlauben</span></label>
        </div>
      </div>
      <Txt label="Beschreibung" value={f.description} onChange={(v)=>set("description",v)} testId="tr-edit-desc"/>
      <Txt label="Regeln" value={f.rules} onChange={(v)=>set("rules",v)} testId="tr-edit-rules"/>
      <PrizeEditor value={f.prize_places} onChange={(v)=>set("prize_places", v)} />
      <Txt label="Preise" value={f.prize_pool} onChange={(v)=>set("prize_pool",v)} testId="tr-edit-prizes"/>
      <div className="border border-[#9146FF]/20 bg-[#9146FF]/5 rounded-sm p-5 space-y-3">
        <div className="text-[11px] font-bold uppercase tracking-widest text-[#9146FF]">Streaming & Links</div>
        <div className="grid md:grid-cols-2 gap-3">
          <Fld label="Location" value={f.location} onChange={(v)=>set("location",v)} testId="tr-edit-location"/>
          <Fld label="Discord Link" value={f.discord_link} onChange={(v)=>set("discord_link",v)} testId="tr-edit-discord"/>
          <Fld label="Legacy Stream Link" value={f.stream_link} onChange={(v)=>set("stream_link",v)} testId="tr-edit-stream"/>
          <Fld label="Twitch Channel" value={f.twitch_channel} onChange={(v)=>set("twitch_channel",v)} testId="tr-edit-twitch"/>
          <SelectField label="Stream Plattform" value={f.stream_platform} onChange={(v)=>set("stream_platform",v)} options={STREAM_PLATFORM_OPTIONS} />
          <Fld label="Stream URL" value={f.stream_url} onChange={(v)=>set("stream_url",v)} testId="tr-edit-stream-url"/>
          <Fld label="Stream Titel" value={f.stream_title} onChange={(v)=>set("stream_title",v)} testId="tr-edit-stream-title"/>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.twitch_enabled} onChange={(e)=>set("twitch_enabled",e.target.checked)} className="accent-[#9146FF]"/><span>Twitch einbetten</span></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.has_live_stream} onChange={(e)=>set("has_live_stream",e.target.checked)} className="accent-[#9146FF]"/><span>Live-Stream aktiv</span></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.show_chat} onChange={(e)=>set("show_chat",e.target.checked)} className="accent-[#9146FF]"/><span>Chat anzeigen</span></label>
        </div>
      </div>
      <button onClick={save} data-testid="tr-edit-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm">Speichern</button>
    </div>
  );
}

function slugify(value) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <select value={value || ""} onChange={(e) => onChange(e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-white">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

const STAFF_ROLES = [
  ["organizer", "Organisator"],
  ["referee", "Referee"],
  ["scorekeeper", "Scorekeeper"],
  ["station_manager", "Station Manager"],
  ["stream_operator", "Stream Operator"],
];

const STAFF_SCOPES = [
  ["tournament", "Ganzes Turnier"],
  ["stage", "Stage"],
  ["group", "Gruppe"],
  ["station", "Station"],
  ["match", "Match"],
];

function TournamentStaffPanel({ tournamentId, staff, users, onChanged }) {
  const [form, setForm] = useState({ user_id: "", role: "scorekeeper", scope: "tournament", scope_id: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();

  const set = (k, v) => setForm((x) => ({ ...x, [k]: v }));
  const add = async (e) => {
    e.preventDefault();
    if (!form.user_id) {
      toast.error("Bitte Nutzer auswählen.");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/tournaments/${tournamentId}/staff`, {
        user_id: form.user_id,
        role: form.role,
        scope: form.scope,
        scope_id: form.scope === "tournament" ? null : form.scope_id || null,
        notes: form.notes || null,
      });
      toast.success("Zuweisung gespeichert.");
      setForm({ user_id: "", role: "scorekeeper", scope: "tournament", scope_id: "", notes: "" });
      onChanged();
    } catch (e2) {
      toast.error(formatRequestError(e2, "Zuweisung konnte nicht gespeichert werden."));
    } finally {
      setSaving(false);
    }
  };
  const remove = async (assignment) => {
    if (!await confirm({
      title: "Zuweisung entfernen?",
      description: "Der Account verliert die operativen Rechte für dieses Turnier.",
      confirmLabel: "Entfernen",
    })) return;
    try {
      await api.delete(`/tournaments/${tournamentId}/staff/${assignment.id}`);
      toast.success("Zuweisung entfernt.");
      onChanged();
    } catch (e) {
      toast.error(formatRequestError(e, "Zuweisung konnte nicht entfernt werden."));
    }
  };
  const toggleActive = async (assignment) => {
    try {
      await api.patch(`/tournaments/${tournamentId}/staff/${assignment.id}`, { is_active: !assignment.is_active });
      onChanged();
    } catch (e) {
      toast.error(formatRequestError(e, "Zuweisung konnte nicht aktualisiert werden."));
    }
  };
  const roleLabel = (role) => STAFF_ROLES.find(([v]) => v === role)?.[1] || role;
  const scopeLabel = (scope) => STAFF_SCOPES.find(([v]) => v === scope)?.[1] || scope;
  const userLabel = (u) => `${u.display_name || u.username || u.email || u.id}${u.email ? ` · ${u.email}` : ""}`;

  return (
    <div className="grid lg:grid-cols-3 gap-5">
      <form onSubmit={add} className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Turnier-Team</div>
          <h2 className="font-heading text-lg font-bold mt-1">Zuweisung hinzufügen</h2>
        </div>
        <label className="block">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Nutzer</div>
          <select value={form.user_id} onChange={(e) => set("user_id", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
            <option value="">— auswählen —</option>
            {users.map((u) => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
          </select>
        </label>
        <label className="block">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Rolle</div>
          <select value={form.role} onChange={(e) => set("role", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
            {STAFF_ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Scope</div>
            <select value={form.scope} onChange={(e) => set("scope", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
              {STAFF_SCOPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Scope-ID</div>
            <input value={form.scope_id} disabled={form.scope === "tournament"} onChange={(e) => set("scope_id", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm disabled:opacity-40" placeholder="optional" />
          </label>
        </div>
        <label className="block">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Notiz</div>
          <input value={form.notes} onChange={(e) => set("notes", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="z.B. Samstag Vormittag" />
        </label>
        <button disabled={saving} className="w-full px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-sm disabled:opacity-50">
          Hinzufügen
        </button>
      </form>
      <div className="lg:col-span-2 border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr>
                <th className="text-left px-4 py-3">Nutzer</th>
                <th className="text-left px-4 py-3">Rolle</th>
                <th className="text-left px-4 py-3">Scope</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {staff.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-3">
                    <div className="font-semibold">{a.user?.display_name || a.user?.username || "—"}</div>
                    <div className="text-xs text-white/40">{a.user?.email || a.user_id}</div>
                  </td>
                  <td className="px-4 py-3">{roleLabel(a.role)}</td>
                  <td className="px-4 py-3">
                    <div>{scopeLabel(a.scope || "tournament")}</div>
                    {a.scope_id && <div className="text-xs text-white/40 font-mono">{a.scope_id}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={a.is_active === false ? "paused" : "approved"} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => toggleActive(a)} className="px-2 py-1 border border-white/15 text-white/70 rounded-sm text-[10px] font-bold uppercase">
                        {a.is_active === false ? "Aktivieren" : "Pausieren"}
                      </button>
                      <button type="button" onClick={() => remove(a)} className="px-2 py-1 border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm text-[10px] font-bold uppercase">
                        Entfernen
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {staff.length === 0 && <tr><td colSpan="5" className="text-center py-10 text-white/40">Noch keine Zuweisungen</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MatchResultControls({ match, a, b, onSave }) {
  const [scoreA, setScoreA] = useState(match.score_a ?? 0);
  const [scoreB, setScoreB] = useState(match.score_b ?? 0);
  const winnerId = Number(scoreA) > Number(scoreB)
    ? a.id
    : Number(scoreB) > Number(scoreA)
      ? b.id
      : "";
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <input type="number" min="0" value={scoreA} onChange={(e)=>setScoreA(e.target.value)} className="w-14 bg-[#0A0A0A] border border-white/10 px-2 py-1 rounded-sm text-xs text-center" aria-label="Score A" />
      <span className="text-white/40">:</span>
      <input type="number" min="0" value={scoreB} onChange={(e)=>setScoreB(e.target.value)} className="w-14 bg-[#0A0A0A] border border-white/10 px-2 py-1 rounded-sm text-xs text-center" aria-label="Score B" />
      <select value={winnerId} onChange={(e)=>onSave(match, scoreA, scoreB, e.target.value)} className="bg-[#0A0A0A] border border-white/10 px-2 py-1 rounded-sm text-xs max-w-[150px]" aria-label="Gewinner">
        <option value="">Gewinner wählen</option>
        <option value={a.id}>{a.display_name || "A"}</option>
        <option value={b.id}>{b.display_name || "B"}</option>
      </select>
      <button type="button" onClick={()=>onSave(match, scoreA, scoreB, winnerId)} className="px-2 py-1 border border-[#29B6E8]/50 text-[#29B6E8] rounded-sm text-[10px] font-bold uppercase">Speichern</button>
    </div>
  );
}

function Fld({ label, value, onChange, type="text", testId }) {
  return (<label className="block"><div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div><input type={type} value={value ?? ""} onChange={(e)=>onChange(e.target.value)} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"/></label>);
}
function Txt({ label, value, onChange, testId }) {
  return (<label className="block"><div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div><MarkdownEditor value={value ?? ""} onChange={onChange} rows={5} testId={testId} /></label>);
}

function PrizeEditor({ value = [], onChange }) {
  const add = (place) => onChange([...(value || []), { place, label: place === "last" ? "Letzter Platz" : `Platz ${place}`, value: "" }]);
  const update = (i, patch) => {
    const next = [...(value || [])];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  return (
    <div className="border border-[#FFD700]/20 bg-[#FFD700]/5 rounded-sm p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-bold uppercase tracking-widest text-[#FFD700]">Platzierungs-Preise</div>
        <div className="flex gap-3">
          <button type="button" onClick={() => add((value?.length || 0) + 1)} className="text-xs font-bold uppercase tracking-wider text-[#29B6E8]">+ Platz</button>
          <button type="button" onClick={() => add("last")} className="text-xs font-bold uppercase tracking-wider text-[#FFD700]">+ Letzter</button>
        </div>
      </div>
      {(value || []).map((p, i) => (
        <div key={i} className="grid grid-cols-12 gap-2">
          <select value={p.place} onChange={(e)=>update(i, { place: e.target.value === "last" ? "last" : Number(e.target.value) || 1 })} className="col-span-2 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm">
            {[1,2,3,4,5,6,7,8].map((n) => <option key={n} value={n}>{n}.</option>)}
            <option value="last">Letzter</option>
          </select>
          <input value={p.label || ""} onChange={(e)=>update(i, { label: e.target.value })} className="col-span-4 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm" placeholder="Label" />
          <input value={p.value || ""} onChange={(e)=>update(i, { value: e.target.value })} className="col-span-5 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm" placeholder="Preis" />
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="col-span-1 text-white/40 hover:text-[#FF3B30]">×</button>
        </div>
      ))}
    </div>
  );
}
