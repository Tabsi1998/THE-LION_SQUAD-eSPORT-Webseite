import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { API, api, formatApiError, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { BracketTree } from "@/components/tls/BracketTree";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { MarkdownEditor } from "@/components/tls/MarkdownEditor";
import { formatDateTime, fromDateTimeLocal, normalizeDateTimeFields, toDateTimeLocalInput } from "@/lib/datetime";
import { buildDirtyPayload, hasPayloadChanges } from "@/lib/dirtyPayload";
import { toast } from "sonner";
import { Zap, RefreshCw, Eye } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useConfirm, usePrompt } from "@/components/tls/ConfirmDialog";
import { gameOptionLabel } from "@/lib/gameLabels";
import {
  REGISTRATION_STATUS_OPTIONS,
  STAFF_ROLE_OPTIONS,
  STAFF_SCOPE_OPTIONS,
  STAGE_STATUS_OPTIONS,
  formatBracketSection,
  formatMatchStatus,
  formatMatchType,
  formatRegistrationStatus,
  formatStageType,
  formatTournamentFormat,
} from "@/lib/tournamentLabels";

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
  ["single_elim", "Einzelausscheidung"],
  ["double_elim", "Doppelausscheidung"],
  ["round_robin", "Jeder gegen jeden"],
  ["swiss", "Schweizer System"],
  ["groups", "Gruppen"],
  ["ffa", "Mehrspieler frei"],
  ["battle_royale", "Überlebensmodus"],
  ["league", "Liga"],
  ["time_trial", "Zeitfahren"],
  ["grand_prix", "Rennserie"],
  ["custom_bracket", "Freier Turnierbaum"],
  ["ffa_custom_bracket", "Mehrspieler freier Turnierbaum"],
];

const TEAM_MODE_OPTIONS = [["solo", "Einzelspieler"], ["team", "Team"]];
const SEEDING_OPTIONS = [["random", "Zufall"], ["manual", "Manuell"], ["ranking", "Ranking"]];
const VISIBILITY_OPTIONS = [["public", "Öffentlich"], ["community", "Community"], ["members", "Vereinsmitglieder"], ["internal", "Intern"]];
const STREAM_PLATFORM_OPTIONS = [["", "—"], ["twitch", "Twitch"], ["youtube", "YouTube"], ["kick", "Kick"], ["custom", "Eigene Plattform"]];
const STAGE_TYPES = [
  ["single_elimination", "Einzelausscheidung"],
  ["double_elimination", "Doppelausscheidung"],
  ["custom_bracket", "Freier Turnierbaum"],
  ["round_robin_groups", "Jeder-gegen-jeden-Gruppen"],
  ["swiss", "Schweizer System"],
  ["league", "Liga"],
  ["simple", "Einzelrunde"],
  ["ffa_single_elimination", "Mehrspieler-Einzelausscheidung"],
  ["ffa_custom_bracket", "Mehrspieler freier Turnierbaum"],
  ["ffa_league", "Mehrspieler-Liga"],
];
const DEFAULT_FFA_SCHEMA = `[WB]
# Runde 1
A=[1,2,3,4]
B=[5,6,7,8]

# Runde 2
C=[W:A:1,W:A:2,W:B:1,W:B:2]

[LB]
# Runde 1
LA=[L:A:3,L:A:4,L:B:3,L:B:4]`;
const CUSTOM_STAGE_TYPES = new Set(["custom_bracket", "ffa_custom_bracket"]);
const AUTO_STAGE_TYPES = new Set(["single_elimination", "double_elimination", "custom_bracket", "ffa_custom_bracket"]);
const FFA_STAGE_TYPES = new Set(["simple", "ffa_single_elimination", "ffa_custom_bracket", "ffa_league"]);

function matchTypeForStage(stageType) {
  return FFA_STAGE_TYPES.has(stageType) ? "ffa" : "duel";
}

function stageConfigFor(form) {
  const stageType = form.stage_type || "ffa_custom_bracket";
  const matchType = form.match_type || matchTypeForStage(stageType);
  const custom = CUSTOM_STAGE_TYPES.has(stageType);
  const ffa = matchType === "ffa" || FFA_STAGE_TYPES.has(stageType);
  return {
    custom,
    ffa,
    showMatchSize: ffa,
    showMinPlayers: ffa,
    showQualifiers: ffa,
    showSchema: custom,
    canGenerate: AUTO_STAGE_TYPES.has(stageType),
  };
}

function applyStageType(current, stageType) {
  const matchType = matchTypeForStage(stageType);
  const custom = CUSTOM_STAGE_TYPES.has(stageType);
  return {
    ...current,
    stage_type: stageType,
    match_type: matchType,
    match_size: matchType === "ffa" ? (current.match_size || 4) : 2,
    min_players: matchType === "ffa" ? (current.min_players || 2) : 2,
    qualifiers_per_match: matchType === "ffa" ? (current.qualifiers_per_match || 2) : 1,
    schema: custom ? current.schema : "",
  };
}

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
  const [teams, setTeams] = useState([]);
  const [participantForm, setParticipantForm] = useState({
    user_id: "",
    team_id: "",
    display_name: "",
    ingame_name: "",
    discord: "",
    status: "approved",
    seed: "",
    replace_registration_id: "",
  });
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
      const [{ data: s }, { data: u }, { data: teamRows }] = await Promise.all([
        api.get(`/tournaments/${id}/staff`),
        api.get("/users"),
        api.get("/teams"),
      ]);
      setStaff(s || []);
      setUsers(u || []);
      setTeams(teamRows || []);
    } else if (isModerator) {
      try {
        const [{ data: u }, { data: teamRows }] = await Promise.all([
          api.get(`/tournaments/${id}/assignable-users`),
          api.get("/teams"),
        ]);
        setUsers(u || []);
        setTeams(teamRows || []);
      } catch {
        setUsers([]);
        setTeams([]);
      }
    }
  }, [id, isAdmin, isModerator]);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["tournaments", "matches", "stations"]);

  const generateLegacyBracket = async ({ preview = false, force = false } = {}) => {
    try {
      const params = new URLSearchParams();
      if (preview) params.set("preview", "true");
      if (force) params.set("force", "true");
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const { data } = await api.post(`/tournaments/${id}/generate-bracket${suffix}`);
      toast.success(data.preview ? `Vorschau mit ${data.match_count} Spielen generiert.` : `Turnierbaum mit ${data.match_count} Spielen generiert.`);
      load();
    } catch (e) {
      if (e.response?.status === 409 && !force) {
        const ok = await confirm({
          title: "Turnierbaum neu generieren?",
          description: "Vorhandene echte Spiele werden ersetzt. Eine reine Vorschau kann direkt überschrieben werden.",
          confirmLabel: "Neu generieren",
          tone: "danger",
        });
        if (ok) return generateLegacyBracket({ preview, force: true });
      }
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };
  const reset = async () => {
    if (!await confirm({
      title: "Turnierbaum zurücksetzen?",
      description: "Alle generierten Turnierbaum-Daten werden zurückgesetzt. Diese Aktion ist für laufende Turniere kritisch.",
      confirmLabel: "Zurücksetzen",
    })) return;
    try {
      await api.post(`/tournaments/${id}/reset-bracket`);
      toast.success("Turnierbaum zurückgesetzt.");
      load();
    } catch (e) {
      if (e.response?.status === 409) {
        const force = await confirm({
          title: "Laufenden Turnierbaum wirklich zurücksetzen?",
          description: "Das Turnier ist live oder bereits beendet. Beim Fortfahren werden alle Spiele endgültig gelöscht.",
          confirmLabel: "Trotzdem zurücksetzen",
          tone: "danger",
        });
        if (!force) return;
        try {
          await api.post(`/tournaments/${id}/reset-bracket?force=true`);
          toast.success("Turnierbaum zurückgesetzt.");
          load();
          return;
        } catch (inner) {
          toast.error(formatRequestError(inner, "Turnierbaum konnte nicht zurückgesetzt werden."));
          return;
        }
      }
      toast.error(formatRequestError(e, "Turnierbaum konnte nicht zurückgesetzt werden."));
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
      toast.success(status === "checked_in" ? "Check-in gesetzt." : status === "no_show" ? "Nicht erschienen gesetzt." : "Check-in zurückgenommen.");
      load();
    } catch (e) {
      toast.error(formatRequestError(e, "Check-in konnte nicht gespeichert werden."));
    }
  };
  const rebuildFromFormat = async ({ preview = true, force = false, structure = null } = {}) => {
    try {
      const params = new URLSearchParams();
      if (preview) params.set("preview", "true");
      if (force) params.set("force", "true");
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const { data } = await api.post(`/tournaments/${id}/bracket/from-format${suffix}`, structure || {});
      toast.success(data.preview ? `Turnierbaum-Vorschau mit ${data.match_count} Spielen neu aufgebaut.` : `Turnierbaum mit ${data.match_count} Spielen neu aufgebaut.`);
      load();
    } catch (e) {
      if (e.response?.status === 409 && !force) {
        const ok = await confirm({
          title: "Turnierbaum aus Format neu bauen?",
          description: "Vorhandene Struktur-/Vorschau-Daten werden durch das gewählte Turnierformat ersetzt.",
          confirmLabel: "Neu bauen",
          tone: "danger",
        });
        if (ok) return rebuildFromFormat({ preview, force: true, structure });
      }
      toast.error(formatRequestError(e, "Turnierbaum konnte nicht aus dem Format neu aufgebaut werden."));
    }
  };
  const deleteParticipant = async (registration) => {
    if (!await confirm({
      title: "Teilnehmer entfernen?",
      description: `${registration.display_name || registration.user?.display_name || registration.ingame_name || "Dieser Teilnehmer"} wird aus dem Turnier entfernt. Eine vorhandene Vorschau wird danach neu gemischt.`,
      confirmLabel: "Entfernen",
      tone: "danger",
    })) return;
    try {
      await api.delete(`/tournaments/${id}/registrations/${registration.id}`);
      toast.success("Teilnehmer entfernt.");
      load();
    } catch (e) {
      toast.error(formatRequestError(e, "Teilnehmer konnte nicht entfernt werden."));
    }
  };
  const setParticipantField = (key, value) => setParticipantForm((current) => ({ ...current, [key]: value }));
  const addParticipant = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        user_id: participantForm.user_id || null,
        team_id: participantForm.team_id || null,
        display_name: participantForm.display_name || null,
        ingame_name: participantForm.ingame_name || null,
        discord: participantForm.discord || null,
        status: participantForm.status || "approved",
        seed: participantForm.seed === "" ? null : Number(participantForm.seed),
        replace_registration_id: participantForm.replace_registration_id || null,
      };
      const { data } = await api.post(`/tournaments/${id}/registrations`, payload);
      const replacement = data.replacement;
      const autoBracketUpdate = data.auto_bracket_update;
      toast.success(replacement
        ? `Teilnehmer hinzugefügt und ${replacement.legacy_matches + replacement.v2_matches} Spielplätze ersetzt.`
        : autoBracketUpdate?.match_count
          ? `Teilnehmer hinzugefügt. Vorschau mit ${autoBracketUpdate.participant_count} Teilnehmern neu gemischt.`
          : "Teilnehmer hinzugefügt.");
      setParticipantForm({ user_id: "", team_id: "", display_name: "", ingame_name: "", discord: "", status: "approved", seed: "", replace_registration_id: "" });
      load();
    } catch (err) {
      toast.error(formatRequestError(err, "Teilnehmer konnte nicht hinzugefügt werden."));
    }
  };
  const setTournStatus = async (status) => {
    try {
      await api.post(`/tournaments/${id}/status`, { status });
      toast.success(`Status: ${TOURNAMENT_STATUS_OPTIONS.find(([value]) => value === status)?.[1] || status}`);
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
  const updateMatchSchedule = async (match, payload) => {
    try {
      const scheduledAt = payload.scheduled_at ? fromDateTimeLocal(payload.scheduled_at) : null;
      const body = {
        scheduled_at: scheduledAt,
        duration_minutes: payload.duration_minutes === "" ? null : Number(payload.duration_minutes),
      };
      if (scheduledAt && ["pending", "ready", "preview"].includes(match.status)) body.status = "scheduled";
      await api.patch(`/matches/${match.id}`, body);
      toast.success("Spielzeit gespeichert.");
      load();
    } catch (err) {
      toast.error(formatRequestError(err, "Spielzeit konnte nicht gespeichert werden."));
    }
  };
  const updateMatchV2Schedule = async (match, payload) => {
    try {
      await api.patch(`/matches-v2/${match.id}`, {
        scheduled_at: payload.scheduled_at ? fromDateTimeLocal(payload.scheduled_at) : null,
        duration_minutes: payload.duration_minutes === "" ? null : Number(payload.duration_minutes),
      });
      toast.success("Spielzeit gespeichert.");
      load();
    } catch (err) {
      toast.error(formatRequestError(err, "Spielzeit konnte nicht gespeichert werden."));
    }
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
      toast.success(`${data.group_count} Gruppen mit ${data.match_count} Spielen`);
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
            <span className="text-white/60 text-sm">{formatTournamentFormat(t.format)}</span>
            <Link to={`/tournaments/${t.slug || t.id}`} target="_blank" className="text-[#29B6E8] text-xs uppercase tracking-wider font-bold hover:text-white inline-flex items-center gap-1"><Eye className="w-3 h-3" /> Öffentliche Seite</Link>
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
          {isModerator && <button onClick={() => rebuildFromFormat({ preview: true })} data-testid="admin-tr-preview" className="px-4 py-2 border border-[#29B6E8]/50 text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm text-sm hover:bg-[#29B6E8]/10 inline-flex items-center gap-2">
            <Eye className="w-3.5 h-3.5" /> Vorschau
          </button>}
          {isModerator && <button onClick={() => rebuildFromFormat({ preview: false })} data-testid="admin-tr-generate" className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-sm hover:bg-[#1E95C2] inline-flex items-center gap-2">
            <Zap className="w-3.5 h-3.5" /> Turnierbaum generieren
          </button>}
          {isModerator && <button onClick={reset} data-testid="admin-tr-reset" className="px-4 py-2 border border-white/20 text-white font-bold uppercase tracking-wider rounded-sm text-sm hover:border-[#FF3B30]/60 hover:text-[#FF3B30] inline-flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5" /> Zurücksetzen
          </button>}
          {isAdmin && t.format === "swiss" && (
            <button onClick={async()=>{ try{ const {data} = await api.post(`/tournaments/${id}/swiss/next-round`); toast.success(`Runde ${data.round} mit ${data.match_count} Spielen generiert`); load(); }catch(e){ toast.error(formatRequestError(e, "Schweizer Runde konnte nicht generiert werden.")); } }} data-testid="admin-tr-swiss-next" className="px-4 py-2 border border-[#29B6E8] text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm text-sm">Schweizer Runde</button>
          )}
          {isAdmin && t.format === "groups" && (
            <button onClick={generateGroups} data-testid="admin-tr-groups" className="px-4 py-2 border border-[#29B6E8] text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm text-sm">Gruppen generieren</button>
          )}
          <div className="flex gap-1">
            <a href={`${API}/exports/tournaments/${t.id}/participants.pdf`} className="px-3 py-2 border border-white/20 text-white/80 text-xs uppercase font-bold rounded-sm hover:border-[#29B6E8]/40" target="_blank" rel="noreferrer">PDF Teilnehmer</a>
            <a href={`${API}/exports/tournaments/${t.id}/checkin.pdf`} className="px-3 py-2 border border-white/20 text-white/80 text-xs uppercase font-bold rounded-sm hover:border-[#29B6E8]/40" target="_blank" rel="noreferrer">PDF Check-in</a>
            <a href={`${API}/exports/tournaments/${t.id}/matches.pdf`} className="px-3 py-2 border border-white/20 text-white/80 text-xs uppercase font-bold rounded-sm hover:border-[#29B6E8]/40" target="_blank" rel="noreferrer">PDF Spiele</a>
          </div>
        </div>
      </div>

      <div className="flex gap-2 mb-5 border-b border-white/10 overflow-x-auto">
        {["participants", "bracket", "stages", ...(t.format === "groups" ? ["groups"] : []), ...(isAdmin ? ["staff"] : []), "edit"].map((s) => (
          <button
            key={s}
            data-testid={`admin-tr-tab-${s}`}
            onClick={() => setTab(s)}
            className={`px-4 py-3 text-xs font-bold uppercase tracking-wider whitespace-nowrap ${tab === s ? "text-[#29B6E8] border-b-2 border-[#29B6E8]" : "text-white/60 hover:text-white"}`}
          >
            {s === "participants" ? "Teilnehmer" : s === "bracket" ? "Turnierbaum" : s === "stages" ? "Matchplan" : s === "groups" ? "Gruppen" : s === "staff" ? "Team" : "Bearbeiten"}
          </button>
        ))}
      </div>

      {tab === "participants" && (
        <div className="space-y-4">
        {isModerator && (
          <ParticipantAddForm
            form={participantForm}
            tournament={t}
            users={users}
            teams={teams}
            noShowRegistrations={regs.filter((r) => r.status === "no_show")}
            onChange={setParticipantField}
            onSubmit={addParticipant}
          />
        )}
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
                          {["pending", "approved", "rejected", "waitlist", "checked_in", "no_show"].map((s) => <option key={s} value={s}>{formatRegistrationStatus(s)}</option>)}
                        </select>
                      )}
                      {isModerator && r.status !== "checked_in" && !["rejected", "waitlist"].includes(r.status) && (
                        <button type="button" onClick={() => setRegCheckinStatus(r.id, "checked_in")} className="px-2 py-1 border border-[#00FF88]/40 text-[#00FF88] rounded-sm text-[10px] font-bold uppercase">Check-in</button>
                      )}
                      {isModerator && r.status === "checked_in" && (
                        <button type="button" onClick={() => setRegCheckinStatus(r.id, "approved")} className="px-2 py-1 border border-white/20 text-white/70 rounded-sm text-[10px] font-bold uppercase">Auschecken</button>
                      )}
                      {isModerator && !["checked_in", "rejected", "waitlist", "no_show"].includes(r.status) && (
                        <button type="button" onClick={() => setRegCheckinStatus(r.id, "no_show")} className="px-2 py-1 border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm text-[10px] font-bold uppercase">Nicht erschienen</button>
                      )}
                      {isModerator && (
                        <button type="button" onClick={() => deleteParticipant(r)} className="px-2 py-1 border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm text-[10px] font-bold uppercase hover:bg-[#FF3B30]/10">Entfernen</button>
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
        </div>
      )}

      {tab === "bracket" && bracket && (
        <div className="bg-[#0A0A0A] rounded-sm p-4 border border-white/10">
          {(bracket.matches?.length || 0) + (bracket.matches_v2?.length || 0) === 0 ? (
            <div className="text-center py-16 text-white/40 font-display tracking-widest">TURNIERBAUM NICHT GENERIERT</div>
          ) : (
            <BracketTree data={bracket} />
          )}
        </div>
      )}

      {tab === "stages" && !hasFlexibleStructure && bracket?.matches && (
        <div className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr>
                <th className="text-left px-4 py-3">Runde</th>
                <th className="text-left px-4 py-3">Teilnehmer A</th>
                <th className="text-left px-4 py-3">Teilnehmer B</th>
                <th className="text-center px-4 py-3">Ergebnis</th>
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
                    <td className="px-4 py-3">{a?.display_name || "Offen"}</td>
                    <td className="px-4 py-3">{b?.display_name || "Offen"}</td>
                    <td className="px-4 py-3 text-center font-display font-bold">{m.score_a} : {m.score_b}</td>
                    <td className="px-4 py-3"><StatusBadge status={m.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-col items-end gap-2">
                        {isModerator && a && b && (
                          <MatchResultControls match={m} a={a} b={b} onSave={updateMatchResult} />
                        )}
                        {isModerator && <MatchScheduleControls match={m} onSave={updateMatchSchedule} />}
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
      {tab === "stages" && hasFlexibleStructure && (
        <TournamentStagesPanel
          tournamentId={t.id}
          stages={stages}
          matches={matchesV2}
          registrations={regs}
          isAdmin={false}
          isModerator={isModerator}
          onChanged={load}
          onSaveResult={updateMatchV2Result}
          onSaveMatchMeta={updateMatchV2Schedule}
        />
      )}
      {tab === "edit" && (
        <TournamentEditForm
          key={t.updated_at || t.id}
          tournament={t}
          stages={stages}
          onSaved={load}
          onRebuildFromFormat={rebuildFromFormat}
        />
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

function ParticipantAddForm({ form, tournament, users, teams, noShowRegistrations, onChange, onSubmit }) {
  const isTeamTournament = (tournament?.team_mode || "solo") !== "solo";
  const userOptions = [
    ["", "Manueller Gast / kein Konto"],
    ...(users || []).map((u) => [u.id, `${u.display_name || u.username || u.email}${u.email ? ` · ${u.email}` : ""}`]),
  ];
  const teamOptions = [
    ["", "— Team auswählen —"],
    ...(teams || []).map((team) => [team.id, `[${team.tag}] ${team.name}`]),
  ];
  const replaceOptions = [
    ["", "Kein Ersatz"],
    ...(noShowRegistrations || []).map((r) => [r.id, r.display_name || r.ingame_name || r.user?.display_name || r.id]),
  ];
  return (
    <form onSubmit={onSubmit} className="border border-white/10 rounded-sm bg-[#121212] p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">{isTeamTournament ? "Team hinzufügen" : "Teilnehmer hinzufügen"}</div>
          <div className="text-xs text-white/45 mt-1">{isTeamTournament ? "Bei Team-Turnieren zählt jedes Team als Startplatz." : "Wähle ein Plattform-Konto aus. Nur wenn es keinen Account gibt, bleibt es ein manueller Gast."}</div>
        </div>
        <button type="submit" className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-xs">Hinzufügen</button>
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        {isTeamTournament ? (
          <SelectField label="Team" value={form.team_id} onChange={(v)=>onChange("team_id", v)} options={teamOptions} />
        ) : (
          <SelectField label="Konto oder manueller Gast" value={form.user_id} onChange={(v)=>onChange("user_id", v)} options={userOptions} />
        )}
        <Fld label="Anzeigename" value={form.display_name} onChange={(v)=>onChange("display_name", v)} testId="participant-add-display" />
        <Fld label="Spielname" value={form.ingame_name} onChange={(v)=>onChange("ingame_name", v)} testId="participant-add-ingame" />
        <Fld label="Discord" value={form.discord} onChange={(v)=>onChange("discord", v)} testId="participant-add-discord" />
        <SelectField label="Status" value={form.status} onChange={(v)=>onChange("status", v)} options={REGISTRATION_STATUS_OPTIONS} />
        <Fld label="Setzplatz" type="number" value={form.seed} onChange={(v)=>onChange("seed", v)} testId="participant-add-seed" />
        <SelectField label="Ersetzt Nicht-Erschienen" value={form.replace_registration_id} onChange={(v)=>onChange("replace_registration_id", v)} options={replaceOptions} />
      </div>
    </form>
  );
}

function TournamentStagesPanel({ tournamentId, stages, matches, registrations, isAdmin, isModerator, onChanged, onSaveResult, onSaveMatchMeta, mode = "operations" }) {
  const showSettings = isAdmin && mode === "settings";
  const showMatchList = mode !== "settings";
  const [createOpen, setCreateOpen] = useState(stages.length === 0);
  const [form, setForm] = useState({
    name: "Phase 1",
    match_type: "ffa",
    stage_type: "ffa_custom_bracket",
    match_size: 4,
    min_players: 2,
    qualifiers_per_match: 2,
    duration_minutes: 30,
    schema: DEFAULT_FFA_SCHEMA,
  });
  const confirm = useConfirm();
  const regById = Object.fromEntries((registrations || []).map((r) => [r.id, r]));
  const config = stageConfigFor(form);
  const set = (k, v) => setForm((x) => ({ ...x, [k]: v }));
  const setStageType = (stageType) => setForm((current) => applyStageType(current, stageType));
  const createStage = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/tournaments/${tournamentId}/stages`, {
        name: form.name || "Phase",
        match_type: form.match_type,
        stage_type: form.stage_type,
        settings: {
          match_size: Number(form.match_size) || 4,
          min_players: Number(form.min_players) || 2,
          qualifiers_per_match: Number(form.qualifiers_per_match) || 1,
          duration_minutes: Number(form.duration_minutes) || 30,
          schema: form.schema || "",
          score_type: "points",
          calculation: "points",
        },
      });
      toast.success("Phase angelegt.");
      setCreateOpen(false);
      onChanged();
    } catch (err) {
      toast.error(formatRequestError(err, "Phase konnte nicht angelegt werden."));
    }
  };
  const removeStage = async (stage) => {
    if (!await confirm({
      title: "Phase löschen?",
      description: "Alle Spiele und Berichte dieser Phase werden gelöscht.",
      confirmLabel: "Löschen",
      tone: "danger",
    })) return;
    try {
      await api.delete(`/tournaments/${tournamentId}/stages/${stage.id}`);
      toast.success("Phase gelöscht.");
      onChanged();
    } catch (err) {
      toast.error(formatRequestError(err, "Phase konnte nicht gelöscht werden."));
    }
  };

  return (
    <div className="space-y-5">
      {mode === "settings" && (
        <div className="text-xs text-white/50 border border-white/10 bg-[#0A0A0A] rounded-sm p-3">
          Erweiterte Bracket-Phasen sind nur fÃ¼r eigene Schemas oder Spezial-Brackets nÃ¶tig. Der Matchplan-Tab bleibt fÃ¼r Zeiten, Ergebnisse und operative Matcharbeit.
        </div>
      )}
      {showSettings && (
        <div className="border border-white/10 bg-[#121212] rounded-sm">
          <button type="button" onClick={() => setCreateOpen((v) => !v)} className="w-full flex items-center justify-between px-5 py-4 text-left">
            <span className="font-heading font-bold uppercase">Phase anlegen</span>
            <span className="text-[#29B6E8] text-xl leading-none">{createOpen ? "−" : "+"}</span>
          </button>
          {createOpen && (
            <form onSubmit={createStage} className="border-t border-white/10 p-5 grid md:grid-cols-3 gap-3">
              <Fld label="Name" value={form.name} onChange={(v)=>set("name", v)} testId="stage-new-name" />
              <SelectField label="Struktur-Typ" value={form.stage_type} onChange={setStageType} options={STAGE_TYPES} />
              <div className="block">
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Spieltyp</div>
                <div className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-white/70">{formatMatchType(form.match_type)}</div>
              </div>
              {config.showMatchSize && <Fld label="Spielgröße" type="number" value={form.match_size} onChange={(v)=>set("match_size", v)} testId="stage-new-size" />}
              {config.showMinPlayers && <Fld label="Min Spieler" type="number" value={form.min_players} onChange={(v)=>set("min_players", v)} testId="stage-new-min" />}
              {config.showQualifiers && <Fld label="Qualifizierte" type="number" value={form.qualifiers_per_match} onChange={(v)=>set("qualifiers_per_match", v)} testId="stage-new-qualifiers" />}
              <Fld label="Spieldauer Min." type="number" value={form.duration_minutes} onChange={(v)=>set("duration_minutes", v)} testId="stage-new-duration" />
              {config.showSchema ? (
                <label className="md:col-span-3 block">
                  <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Schema</div>
                  <textarea value={form.schema} onChange={(e)=>set("schema", e.target.value)} rows={8} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" data-testid="stage-new-schema" />
                </label>
              ) : (
                <div className="md:col-span-3 text-xs text-white/45 border border-white/10 bg-[#0A0A0A] rounded-sm p-3">
                  Dieser Struktur-Typ braucht hier keine freie Schema-Eingabe. Für komplett freie Turnierbäume nutze einen freien Turnierbaum.
                </div>
              )}
              <div className="md:col-span-3">
                <button className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-sm">Phase speichern</button>
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
            isModerator={isModerator}
            showSettings={showSettings}
            showMatchList={showMatchList}
            onChanged={onChanged}
            onDelete={() => removeStage(stage)}
            onSaveResult={onSaveResult}
            onSaveMatchMeta={onSaveMatchMeta}
          />
        ))}
        {stages.length === 0 && (
          <div className="border border-white/10 bg-[#121212] rounded-sm p-10 text-center text-white/40">
            {mode === "settings" ? "Noch keine eigene Bracket-Phase." : "Noch keine Phasen. Lege eigene Bracket-Phasen im Bearbeiten-Tab an oder baue eine Format-Vorschau."}
          </div>
        )}
      </div>
    </div>
  );
}

function StageCard({ tournamentId, stage, matches, regById, isModerator, showSettings = false, showMatchList = true, onChanged, onDelete, onSaveResult, onSaveMatchMeta }) {
  const settings = stage.settings || {};
  const [form, setForm] = useState({
    name: stage.name || "",
    match_type: stage.match_type || "ffa",
    stage_type: stage.stage_type || "ffa_custom_bracket",
    status: stage.status || "pending",
    match_size: settings.match_size || 4,
    min_players: settings.min_players || 2,
    qualifiers_per_match: settings.qualifiers_per_match || 2,
    duration_minutes: settings.duration_minutes || stage.duration_minutes || 30,
    schema: settings.schema || "",
  });
  const confirm = useConfirm();
  const config = stageConfigFor(form);
  const set = (k, v) => setForm((x) => ({ ...x, [k]: v }));
  const setStageType = (stageType) => setForm((current) => applyStageType(current, stageType));
  const stagePayload = () => ({
    name: form.name || "Phase",
    match_type: form.match_type,
    stage_type: form.stage_type,
    status: form.status,
    settings: {
      ...settings,
      match_size: Number(form.match_size) || 4,
      min_players: Number(form.min_players) || 2,
      qualifiers_per_match: Number(form.qualifiers_per_match) || 1,
      duration_minutes: Number(form.duration_minutes) || 30,
      schema: form.schema || "",
      score_type: settings.score_type || "points",
      calculation: settings.calculation || "points",
    },
  });
  const save = async () => {
    try {
      await api.patch(`/tournaments/${tournamentId}/stages/${stage.id}`, stagePayload());
      toast.success("Phase gespeichert.");
      onChanged();
    } catch (err) {
      toast.error(formatRequestError(err, "Phase konnte nicht gespeichert werden."));
    }
  };
  const saveAndGeneratePreview = async () => {
    if (!config.canGenerate) {
      toast.error("Für diesen Struktur-Typ ist aktuell noch kein automatischer Generator aktiv.");
      return;
    }
    try {
      await api.patch(`/tournaments/${tournamentId}/stages/${stage.id}`, stagePayload());
      const { data } = await api.post(`/tournaments/${tournamentId}/stages/${stage.id}/generate?preview=true&force=true`);
      toast.success(`Phase gespeichert und ${data.match_count} Vorschau-Spiele neu gebaut.`);
      onChanged();
    } catch (err) {
      toast.error(formatRequestError(err, "Phase konnte nicht gespeichert und neu gebaut werden."));
    }
  };
  const generate = async ({ preview = false, force = false } = {}) => {
    if (!config.canGenerate) {
      toast.error("Für diesen Struktur-Typ ist aktuell noch kein automatischer Generator aktiv.");
      return;
    }
    try {
      const params = new URLSearchParams();
      if (force) params.set("force", "true");
      if (preview) params.set("preview", "true");
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const { data } = await api.post(`/tournaments/${tournamentId}/stages/${stage.id}/generate${suffix}`);
      toast.success(data.preview ? `${data.match_count} Vorschau-Spiele generiert.` : `${data.match_count} Spiele mit Teilnehmern generiert.`);
      onChanged();
    } catch (err) {
      if (err.response?.status === 409 && !force) {
        const ok = await confirm({
          title: "Phase neu generieren?",
          description: "Vorhandene Spiele und Berichte dieser Phase werden ersetzt.",
          confirmLabel: "Neu generieren",
          tone: "danger",
        });
        if (ok) return generate({ preview, force: true });
      }
      toast.error(formatRequestError(err, "Phase konnte nicht generiert werden."));
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
          <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">Phase #{stage.number || "—"}</div>
          <h2 className="font-heading text-xl font-bold uppercase mt-1">{stage.name}</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-white/50">
            <span>{formatMatchType(stage.match_type)}</span>
            <span>·</span>
            <span>{formatStageType(stage.stage_type)}</span>
            <span>·</span>
            <span>{matches.length} Spiele</span>
            {matches.some((m) => m.is_preview) && <span>· Vorschau / Draft</span>}
            {Object.entries(statusCounts).map(([status, count]) => <span key={status}>· {count} {formatMatchStatus(status)}</span>)}
          </div>
        </div>
        {(isModerator || showSettings) && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => generate({ preview: true })} disabled={!config.canGenerate} className="px-3 py-2 border border-[#29B6E8]/50 text-[#29B6E8] rounded-sm uppercase tracking-wider text-xs font-bold disabled:opacity-40">Vorschau</button>
            <button type="button" onClick={() => generate({ preview: false })} disabled={!config.canGenerate} className="px-3 py-2 bg-[#29B6E8] text-black rounded-sm uppercase tracking-wider text-xs font-bold disabled:opacity-40">Mit Teilnehmern generieren</button>
            {showSettings && <button type="button" onClick={save} className="px-3 py-2 border border-white/20 text-white rounded-sm uppercase tracking-wider text-xs font-bold">Speichern</button>}
            {showSettings && <button type="button" onClick={saveAndGeneratePreview} disabled={!config.canGenerate} className="px-3 py-2 border border-[#FFD700]/50 text-[#FFD700] rounded-sm uppercase tracking-wider text-xs font-bold disabled:opacity-40">Speichern & neu bauen</button>}
            {showSettings && <button type="button" onClick={onDelete} className="px-3 py-2 border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm uppercase tracking-wider text-xs font-bold">Löschen</button>}
          </div>
        )}
      </div>
      <div className={`${showSettings && showMatchList ? "grid lg:grid-cols-2 gap-5" : "space-y-3"} p-5`}>
        {showSettings && (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <Fld label="Name" value={form.name} onChange={(v)=>set("name", v)} testId={`stage-name-${stage.id}`} />
              <SelectField label="Status" value={form.status} onChange={(v)=>set("status", v)} options={STAGE_STATUS_OPTIONS} />
              <SelectField label="Struktur-Typ" value={form.stage_type} onChange={setStageType} options={STAGE_TYPES} />
              <div className="block">
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Spieltyp</div>
                <div className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-white/70">{formatMatchType(form.match_type)}</div>
              </div>
              {config.showMatchSize && <Fld label="Spielgröße" type="number" value={form.match_size} onChange={(v)=>set("match_size", v)} testId={`stage-size-${stage.id}`} />}
              {config.showMinPlayers && <Fld label="Min Spieler" type="number" value={form.min_players} onChange={(v)=>set("min_players", v)} testId={`stage-min-${stage.id}`} />}
              {config.showQualifiers && <Fld label="Qualifizierte" type="number" value={form.qualifiers_per_match} onChange={(v)=>set("qualifiers_per_match", v)} testId={`stage-qualifiers-${stage.id}`} />}
              <Fld label="Spieldauer Min." type="number" value={form.duration_minutes} onChange={(v)=>set("duration_minutes", v)} testId={`stage-duration-${stage.id}`} />
            </div>
            {config.showSchema ? (
              <label className="block">
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Schema</div>
                <textarea value={form.schema} onChange={(e)=>set("schema", e.target.value)} rows={12} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" data-testid={`stage-schema-${stage.id}`} />
              </label>
            ) : (
              <div className="text-xs text-white/45 border border-white/10 bg-[#0A0A0A] rounded-sm p-3">
                Für diesen Struktur-Typ sind keine freien Schema-Felder nötig. Nutze eine freie Turnierbaum-Struktur, wenn du den Baum komplett selbst definieren willst.
              </div>
            )}
          </div>
        )}
        {showMatchList && <div className="space-y-3">
          {matches.map((match) => (
            <MatchV2Card
              key={match.id}
              match={match}
              regById={regById}
              canEdit={isModerator}
              onSaveResult={onSaveResult}
              onSaveMatchMeta={onSaveMatchMeta}
            />
          ))}
          {matches.length === 0 && (
            <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-8 text-center text-white/40">
              Keine Spiele generiert.
            </div>
          )}
        </div>}
      </div>
    </div>
  );
}

function MatchV2Card({ match, regById, canEdit, onSaveResult, onSaveMatchMeta }) {
  const filledSlots = (match.slots || []).filter((slot) => slot.status === "filled" && slot.registration_id);
  const labelFor = (registrationId) => {
    const reg = regById[registrationId];
    return reg?.display_name || reg?.ingame_name || reg?.user?.display_name || registrationId || "Offen";
  };
  return (
    <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-white/40">{formatBracketSection(match.section)} · {match.round_name}</div>
          <div className="font-heading font-bold uppercase">{match.match_key}</div>
          <a href={`/matches/${match.id}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex text-[10px] uppercase tracking-wider font-bold text-[#29B6E8] hover:underline">Öffentliche Matchseite</a>
        </div>
        <StatusBadge status={match.status || "pending"} />
      </div>
      <div className="mt-3 grid sm:grid-cols-2 gap-2">
        {(match.slots || []).map((slot) => (
          <div key={slot.slot} className={`px-3 py-2 rounded-sm border text-sm ${slot.status === "filled" ? "border-[#29B6E8]/30 bg-[#29B6E8]/5" : "border-white/10 bg-[#121212]"}`}>
            <span className="text-white/40 mr-2">#{slot.slot}</span>{slot.registration_id ? labelFor(slot.registration_id) : slot.source?.raw || "Offen"}
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
      {canEdit && <MatchScheduleControls match={match} onSave={onSaveMatchMeta} />}
      {canEdit && filledSlots.length > 0 && (
        <MatchV2ResultControls match={match} filledSlots={filledSlots} labelFor={labelFor} onSaveResult={onSaveResult} />
      )}
    </div>
  );
}

function MatchV2ResultControls({ match, filledSlots, labelFor, onSaveResult }) {
  const autoRankRows = (nextRows) => {
    const ranked = [...nextRows]
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        if (!!a.row.forfeit !== !!b.row.forfeit) return a.row.forfeit ? 1 : -1;
        if (!!a.row.dnf !== !!b.row.dnf) return a.row.dnf ? 1 : -1;
        const scoreA = a.row.score === "" ? 0 : Number(a.row.score) || 0;
        const scoreB = b.row.score === "" ? 0 : Number(b.row.score) || 0;
        if (scoreA !== scoreB) return scoreB - scoreA;
        return a.index - b.index;
      });
    const rankByRegistration = Object.fromEntries(ranked.map(({ row }, index) => [row.registration_id, index + 1]));
    return nextRows.map((row) => ({ ...row, rank: rankByRegistration[row.registration_id] || row.rank }));
  };
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
  const [autoRank, setAutoRank] = useState(true);
  const [note, setNote] = useState(match.result_meta?.note || "");
  useEffect(() => {
    setRows(initialRows());
    setAutoRank(true);
    setNote(match.result_meta?.note || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id, match.updated_at, filledSlots.length]);
  const update = (registrationId, patch) => setRows((current) => {
    const next = current.map((row) => row.registration_id === registrationId ? { ...row, ...patch } : row);
    return autoRank ? autoRankRows(next) : next;
  });
  const recalcRanks = () => setRows((current) => autoRankRows(current));
  const save = () => {
    const finalRows = autoRank ? autoRankRows(rows) : rows;
    const results = finalRows.map((row) => ({
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
    <div className="mt-4 border-t border-white/10 pt-3 space-y-3">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-[#29B6E8]">Ergebnis eintragen</div>
        <p className="mt-1 text-[11px] text-white/45">Bei aktiver Automatik wird Platz 1 aus den höchsten Punkten berechnet. DNF und Forfeit landen automatisch hinten.</p>
        <div className="mt-2 flex items-center gap-3 flex-wrap">
          <label className="inline-flex items-center gap-2 text-[11px] text-white/60">
            <input type="checkbox" checked={autoRank} onChange={(e)=>setAutoRank(e.target.checked)} className="accent-[#29B6E8]" />
            Platzierung aus Punkten berechnen
          </label>
          <button type="button" onClick={recalcRanks} className="text-[10px] uppercase tracking-wider font-bold text-[#29B6E8] hover:underline">Jetzt berechnen</button>
        </div>
      </div>
      <div className="hidden sm:grid grid-cols-12 gap-2 text-[10px] font-bold uppercase tracking-widest text-white/35">
        <div className="col-span-3">Teilnehmer</div>
        <div className="col-span-2">Platz</div>
        <div className="col-span-3">Punkte</div>
        <div className="col-span-2">Status</div>
        <div className="col-span-2">Wertung</div>
      </div>
      {rows.map((row) => (
        <div key={row.registration_id} className="grid grid-cols-12 gap-2 items-center">
          <div className="col-span-3 text-xs truncate">{labelFor(row.registration_id)}</div>
          <input type="number" min="1" value={row.rank} onChange={(e)=>update(row.registration_id, { rank: e.target.value })} disabled={autoRank} className="col-span-2 bg-[#121212] border border-white/10 px-2 py-1 rounded-sm text-xs disabled:opacity-60" aria-label="Platzierung" placeholder="Platz" />
          <input type="number" min="0" value={row.score} onChange={(e)=>update(row.registration_id, { score: e.target.value })} className="col-span-3 bg-[#121212] border border-white/10 px-2 py-1 rounded-sm text-xs" aria-label="Punkte oder Score" placeholder="Punkte/Score" />
          <label className="col-span-2 text-[10px] text-white/60 truncate"><input type="checkbox" checked={row.dnf} onChange={(e)=>update(row.registration_id, { dnf: e.target.checked })} className="accent-[#29B6E8]" /> Nicht beendet</label>
          <label className="col-span-2 text-[10px] text-white/60 truncate"><input type="checkbox" checked={row.forfeit} onChange={(e)=>update(row.registration_id, { forfeit: e.target.checked })} className="accent-[#FF3B30]" /> Forfeit</label>
        </div>
      ))}
      <input value={note} onChange={(e)=>setNote(e.target.value)} className="w-full bg-[#121212] border border-white/10 px-2 py-1 rounded-sm text-xs" placeholder="Notiz für Turnierleitung oder Schiedsrichter" />
      <button type="button" onClick={save} className="px-3 py-2 border border-[#29B6E8]/50 text-[#29B6E8] rounded-sm text-[10px] font-bold uppercase">Ergebnis speichern</button>
    </div>
  );
}

function MatchScheduleControls({ match, onSave }) {
  const [scheduledAt, setScheduledAt] = useState(toDateTimeLocalInput(match.scheduled_at));
  const [duration, setDuration] = useState(match.duration_minutes ?? match.settings?.duration_minutes ?? "");
  useEffect(() => {
    setScheduledAt(toDateTimeLocalInput(match.scheduled_at));
    setDuration(match.duration_minutes ?? match.settings?.duration_minutes ?? "");
  }, [match.id, match.scheduled_at, match.duration_minutes, match.updated_at, match.settings?.duration_minutes]);
  return (
    <div className="mt-3 w-full max-w-md border border-white/10 bg-[#0A0A0A] rounded-sm p-3 space-y-2">
      <div className="text-[10px] font-bold uppercase tracking-widest text-white/50">Zeitplanung</div>
      <div className="grid sm:grid-cols-[1fr_7rem] gap-2">
        <label className="block">
          <span className="block text-[10px] text-white/45 mb-1">Startdatum & Uhrzeit</span>
          <input type="datetime-local" value={scheduledAt} onChange={(e)=>setScheduledAt(e.target.value)} className="w-full bg-[#121212] border border-white/10 px-2 py-1 rounded-sm text-xs" aria-label="Startdatum und Uhrzeit" />
        </label>
        <label className="block">
          <span className="block text-[10px] text-white/45 mb-1">Dauer Min.</span>
          <input type="number" min="1" value={duration} onChange={(e)=>setDuration(e.target.value)} className="w-full bg-[#121212] border border-white/10 px-2 py-1 rounded-sm text-xs" placeholder="z.B. 30" aria-label="Dauer in Minuten" />
        </label>
      </div>
      {(match.scheduled_at || match.duration_minutes || match.settings?.duration_minutes) && (
        <div className="text-[11px] text-white/45">
          Gespeichert: {match.scheduled_at ? formatDateTime(match.scheduled_at) : "keine Startzeit"} · Dauer {match.duration_minutes ?? match.settings?.duration_minutes ?? "offen"} Min.
        </div>
      )}
      <button type="button" onClick={() => onSave(match, { scheduled_at: scheduledAt, duration_minutes: duration })} className="px-3 py-2 border border-white/20 text-white/70 rounded-sm text-[10px] font-bold uppercase">Zeit speichern</button>
    </div>
  );
}

function TournamentEditForm({ tournament, stages = [], onSaved, onRebuildFromFormat }) {
  const dt = toDateTimeLocalInput;
  const [games, setGames] = useState([]);
  const [events, setEvents] = useState([]);
  const formFromTournament = (source = tournament) => ({
    title: source.title || "",
    slug: source.slug || "",
    description: source.description || "",
    game_id: source.game_id || "",
    platform: source.platform || "",
    event_id: source.event_id || "",
    format: source.format || "single_elim",
    status: source.status || "draft",
    team_mode: source.team_mode === "solo" ? "solo" : "team",
    team_size: source.team_mode === "solo" ? 1 : (source.team_size || 2),
    substitutes_allowed: !!source.substitutes_allowed,
    rules: source.rules || "",
    prize_pool: source.prize_pool || "",
    prize_places: source.prize_places || [],
    banner_url: source.banner_url || "",
    stream_link: source.stream_link || "",
    discord_link: source.discord_link || "",
    location: source.location || "",
    registration_enabled: source.registration_enabled !== false,
    is_invite_only: !!source.is_invite_only,
    block_club_member_registration: !!source.block_club_member_registration,
    registration_open_from: dt(source.registration_open_from),
    registration_open_until: dt(source.registration_open_until),
    check_in_from: dt(source.check_in_from),
    check_in_until: dt(source.check_in_until),
    start_date: dt(source.start_date),
    end_date: dt(source.end_date),
    max_participants: source.max_participants || 16,
    min_participants: source.min_participants || 2,
    best_of: source.best_of || 1,
    match_duration_minutes: source.match_duration_minutes || 30,
    bronze_match: !!source.bronze_match,
    seeding_mode: source.seeding_mode || "random",
    is_public: source.is_public !== false,
    visibility: source.visibility || "public",
    site_banner_enabled: !!source.site_banner_enabled,
    twitch_channel: source.twitch_channel || "",
    twitch_enabled: !!source.twitch_enabled,
    has_live_stream: !!source.has_live_stream,
    stream_platform: source.stream_platform || "",
    stream_url: source.stream_url || "",
    stream_title: source.stream_title || "",
    show_chat: !!source.show_chat,
    season_weight: source.season_weight ?? 2,
  });
  const [f, setF] = useState({
    title: tournament.title || "",
    slug: tournament.slug || "",
    description: tournament.description || "",
    game_id: tournament.game_id || "",
    platform: tournament.platform || "",
    event_id: tournament.event_id || "",
    format: tournament.format || "single_elim",
    status: tournament.status || "draft",
    team_mode: tournament.team_mode === "solo" ? "solo" : "team",
    team_size: tournament.team_mode === "solo" ? 1 : (tournament.team_size || 2),
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
    block_club_member_registration: !!tournament.block_club_member_registration,
    registration_open_from: dt(tournament.registration_open_from),
    registration_open_until: dt(tournament.registration_open_until),
    check_in_from: dt(tournament.check_in_from),
    check_in_until: dt(tournament.check_in_until),
    start_date: dt(tournament.start_date),
    end_date: dt(tournament.end_date),
    max_participants: tournament.max_participants || 16,
    min_participants: tournament.min_participants || 2,
    best_of: tournament.best_of || 1,
    match_duration_minutes: tournament.match_duration_minutes || 30,
    bronze_match: !!tournament.bronze_match,
    seeding_mode: tournament.seeding_mode || "random",
    is_public: tournament.is_public !== false,
    visibility: tournament.visibility || "public",
    site_banner_enabled: !!tournament.site_banner_enabled,
    twitch_channel: tournament.twitch_channel || "",
    twitch_enabled: !!tournament.twitch_enabled,
    has_live_stream: !!tournament.has_live_stream,
    stream_platform: tournament.stream_platform || "",
    stream_url: tournament.stream_url || "",
    stream_title: tournament.stream_title || "",
    show_chat: !!tournament.show_chat,
    season_weight: tournament.season_weight ?? 2,
  });
  const firstStage = stages[0] || null;
  const stageSettings = firstStage?.settings || {};
  const [structure, setStructure] = useState({
    stage_type: firstStage?.stage_type || (tournament.format === "double_elim" ? "double_elimination" : tournament.format === "ffa_custom_bracket" ? "ffa_custom_bracket" : tournament.format === "custom_bracket" ? "custom_bracket" : "single_elimination"),
    match_type: firstStage?.match_type || (tournament.format === "ffa_custom_bracket" ? "ffa" : "duel"),
    match_size: stageSettings.match_size || (tournament.format === "ffa_custom_bracket" ? 4 : 2),
    min_players: stageSettings.min_players || 2,
    qualifiers_per_match: stageSettings.qualifiers_per_match || (tournament.format === "ffa_custom_bracket" ? 2 : 1),
    duration_minutes: stageSettings.duration_minutes || tournament.match_duration_minutes || 30,
    schema: stageSettings.schema || (tournament.format === "ffa_custom_bracket" ? DEFAULT_FFA_SCHEMA : ""),
  });
  useEffect(() => {
    api.get("/games").then(({ data }) => setGames(data || [])).catch(() => setGames([]));
    api.get("/events?include_drafts=true").then(({ data }) => setEvents(data || [])).catch(() => setEvents([]));
  }, []);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setStructureField = (k, v) => setStructure((x) => ({ ...x, [k]: v }));
  const setFormat = (value) => {
    set("format", value);
    setStructure((current) => {
      if (value === "double_elim") return { ...current, stage_type: "double_elimination", match_type: "duel", match_size: 2, min_players: 2, qualifiers_per_match: 1 };
      if (value === "custom_bracket") return { ...current, stage_type: "custom_bracket", match_type: "duel", match_size: 2, min_players: 2, qualifiers_per_match: 1 };
      if (value === "ffa_custom_bracket") return { ...current, stage_type: "ffa_custom_bracket", match_type: "ffa", match_size: current.match_size || 4, min_players: 2, qualifiers_per_match: current.qualifiers_per_match || 2, schema: current.schema || DEFAULT_FFA_SCHEMA };
      return { ...current, stage_type: "single_elimination", match_type: "duel", match_size: 2, min_players: 2, qualifiers_per_match: 1 };
    });
  };
  const structurePayload = () => ({
    name: "Turnierbaum",
    stage_type: structure.stage_type,
    match_type: structure.match_type,
    settings: {
      match_size: Number(structure.match_size) || (structure.match_type === "ffa" ? 4 : 2),
      min_players: Number(structure.min_players) || 2,
      qualifiers_per_match: Number(structure.qualifiers_per_match) || (structure.match_type === "ffa" ? 2 : 1),
      duration_minutes: Number(structure.duration_minutes) || Number(f.match_duration_minutes) || 30,
      schema: structure.schema || "",
      score_type: "points",
      calculation: "points",
    },
  });
  const setTeamMode = (value) => setF((current) => ({
    ...current,
    team_mode: value,
    team_size: value === "solo" ? 1 : Math.max(2, Number(current.team_size) || 2),
  }));
  const save = async ({ rebuildPreview = false } = {}) => {
    try {
      const normalizeTournamentPayload = (source) => {
        const payload = { ...source };
        if (!payload.event_id) payload.event_id = null;
        if (!payload.stream_platform) payload.stream_platform = null;
        normalizeDateTimeFields(payload, ["registration_open_from", "registration_open_until", "check_in_from", "check_in_until", "start_date", "end_date"]);
        ["team_size", "max_participants", "min_participants", "best_of", "match_duration_minutes"].forEach((key) => {
          if (payload[key] !== "" && payload[key] != null) payload[key] = Number(payload[key]);
        });
        payload.season_weight = Number(payload.season_weight || 0);
        payload.prize_places = (payload.prize_places || [])
          .filter((p) => p.value && String(p.value).trim())
          .map((p) => ({
            group: p.group || "overall",
            place: p.place === "last" ? "last" : Number(p.place) || 0,
            label: p.label || (p.place === "last" ? "Letzter Platz" : `Platz ${p.place}`),
            value: p.value,
          }));
        if (payload.prize_places.length === 0) payload.prize_places = null;
        return payload;
      };
      const payload = normalizeTournamentPayload(f);
      const patch = buildDirtyPayload(payload, normalizeTournamentPayload(formFromTournament()));
      if (!hasPayloadChanges(patch)) {
        if (rebuildPreview) {
          await onRebuildFromFormat?.({ preview: true, force: true, structure: structurePayload() });
          return;
        }
        toast.info("Keine Änderungen zum Speichern.");
        return;
      }
      await api.patch(`/tournaments/${tournament.id}`, patch);
      toast.success("Gespeichert.");
      if (rebuildPreview) {
        await onRebuildFromFormat?.({ preview: true, force: true, structure: structurePayload() });
      } else {
        onSaved();
      }
    } catch (e) { toast.error(formatRequestError(e, "Turnier konnte nicht gespeichert werden.", { title: f.title })); }
  };
  return (
    <div className="max-w-4xl space-y-5">
      <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
        <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Basis</div>
        <div className="grid md:grid-cols-2 gap-3">
          <Fld label="Titel" value={f.title} onChange={(v)=>set("title",v)} testId="tr-edit-title"/>
          <Fld label="Slug / URL" value={f.slug} onChange={(v)=>set("slug", slugify(v))} testId="tr-edit-slug"/>
          <SelectField label="Spiel" value={f.game_id} onChange={(v)=>set("game_id",v)} options={[["", "— auswählen —"], ...games.map((g) => [g.id, gameOptionLabel(g)])]} />
          <Fld label="Plattform" value={f.platform} onChange={(v)=>set("platform",v)} testId="tr-edit-platform"/>
          <SelectField label="Event" value={f.event_id || ""} onChange={(v)=>set("event_id",v)} options={[["", "— keins —"], ...events.map((e) => [e.id, e.name])]} />
          <SelectField label="Status" value={f.status} onChange={(v)=>set("status",v)} options={TOURNAMENT_STATUS_OPTIONS} />
          <SelectField label="Sichtbarkeit" value={f.visibility} onChange={(v)=>set("visibility",v)} options={VISIBILITY_OPTIONS} />
          <label className="flex items-center gap-2 text-sm self-end pb-2"><input type="checkbox" checked={f.is_public} onChange={(e)=>set("is_public",e.target.checked)} className="accent-[#29B6E8]"/><span>Auf Public-Seiten sichtbar, sobald nicht Entwurf</span></label>
        </div>
      </div>
      <Details title="Darstellung">
        <ImageUpload value={f.banner_url} onChange={(v)=>set("banner_url",v)} label="Turnier-Banner" testId="tr-edit-banner-upload" variant="wide" allowLibrary />
        <Txt label="Beschreibung" value={f.description} onChange={(v)=>set("description",v)} testId="tr-edit-desc"/>
        <Txt label="Regeln" value={f.rules} onChange={(v)=>set("rules",v)} testId="tr-edit-rules"/>
      </Details>
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
          <label className="flex items-start gap-2 text-sm text-white/75"><input type="checkbox" checked={f.site_banner_enabled} onChange={(e)=>set("site_banner_enabled",e.target.checked)} className="accent-[#FFD700] mt-1"/><span>Automatisches Turnier-Hinweisbanner anzeigen</span></label>
          <label className="flex items-start gap-2 text-sm text-white/75 sm:col-span-2"><input type="checkbox" checked={f.block_club_member_registration} onChange={(e)=>set("block_club_member_registration",e.target.checked)} className="accent-[#FFD700] mt-1"/><span>Vereinsmitglieder von der Selbstanmeldung ausschließen, z.B. wenn wir das Turnier für externe Teilnehmer veranstalten</span></label>
        </div>
      </div>
      <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
        <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Struktur</div>
        <p className="text-xs text-white/50">
          Teilnahme legt fest, wer sich anmelden darf: Einzelspieler melden sich selbst an, bei Team meldet ein Team-Leader oder Co-Leader das Team an.
        </p>
        <div className="grid md:grid-cols-3 gap-3">
          <SelectField label="Turnierstruktur" value={f.format} onChange={setFormat} options={TOURNAMENT_FORMAT_OPTIONS} />
          <SelectField label="Teilnahme" value={f.team_mode} onChange={setTeamMode} options={TEAM_MODE_OPTIONS} />
          {f.team_mode !== "solo" && <Fld label="Spieler pro Team" type="number" min="2" max="6" value={f.team_size} onChange={(v)=>set("team_size",v)} testId="tr-edit-team-size"/>}
          <Fld label={f.team_mode === "solo" ? "Min Spieler" : "Min Teams"} type="number" value={f.min_participants} onChange={(v)=>set("min_participants",v)} testId="tr-edit-min"/>
          <Fld label={f.team_mode === "solo" ? "Max Spieler" : "Max Teams"} type="number" value={f.max_participants} onChange={(v)=>set("max_participants",v)} testId="tr-edit-max"/>
        </div>
        <Details title="Erweiterte Spieloptionen">
          <div className="grid md:grid-cols-3 gap-3">
            <SelectField label="Seeding" value={f.seeding_mode} onChange={(v)=>set("seeding_mode",v)} options={SEEDING_OPTIONS} />
            <Fld label="Best of" type="number" value={f.best_of} onChange={(v)=>set("best_of",v)} testId="tr-edit-bo"/>
            <Fld label="Spieldauer Min." type="number" value={f.match_duration_minutes} onChange={(v)=>set("match_duration_minutes",v)} testId="tr-edit-duration"/>
            <Fld label="Season Gewicht" type="number" value={f.season_weight} onChange={(v)=>set("season_weight",v)} testId="tr-edit-season-weight"/>
          </div>
          <div className="mt-4 flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.bronze_match} onChange={(e)=>set("bronze_match",e.target.checked)} className="accent-[#29B6E8]"/><span>Spiel um Platz 3</span></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.substitutes_allowed} onChange={(e)=>set("substitutes_allowed",e.target.checked)} className="accent-[#29B6E8]"/><span>Ersatzspieler erlauben</span></label>
          </div>
        </Details>
        {["custom_bracket", "ffa_custom_bracket"].includes(f.format) && (
          <div className="border border-[#29B6E8]/20 bg-[#29B6E8]/5 rounded-sm p-4 space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Freier Turnierbaum</div>
            <div className="grid md:grid-cols-3 gap-3">
              {f.format === "ffa_custom_bracket" && <Fld label="Spielgröße" type="number" value={structure.match_size} onChange={(v)=>setStructureField("match_size", v)} testId="tr-edit-stage-size" />}
              <Fld label="Min Spieler" type="number" value={structure.min_players} onChange={(v)=>setStructureField("min_players", v)} testId="tr-edit-stage-min" />
              {f.format === "ffa_custom_bracket" && <Fld label="Qualifizierte" type="number" value={structure.qualifiers_per_match} onChange={(v)=>setStructureField("qualifiers_per_match", v)} testId="tr-edit-stage-qualifiers" />}
              <Fld label="Spieldauer Min." type="number" value={structure.duration_minutes} onChange={(v)=>setStructureField("duration_minutes", v)} testId="tr-edit-stage-duration" />
            </div>
            <label className="block">
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Schema</div>
              <textarea value={structure.schema} onChange={(e)=>setStructureField("schema", e.target.value)} rows={12} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" data-testid="tr-edit-structure-schema" />
            </label>
          </div>
        )}
      </div>
      <Details title="Preise">
        <PrizeEditor value={f.prize_places} onChange={(v)=>set("prize_places", v)} />
        <Txt label="Preise" value={f.prize_pool} onChange={(v)=>set("prize_pool",v)} testId="tr-edit-prizes"/>
      </Details>
      <Details title="Streaming und externe Links">
        <div className="text-[11px] font-bold uppercase tracking-widest text-[#9146FF]">Streaming & Verweise</div>
        <div className="grid md:grid-cols-2 gap-3">
          <Fld label="Ort" value={f.location} onChange={(v)=>set("location",v)} testId="tr-edit-location"/>
          <Fld label="Discord-Verweis" value={f.discord_link} onChange={(v)=>set("discord_link",v)} testId="tr-edit-discord"/>
          <Fld label="Alter Stream-Verweis" value={f.stream_link} onChange={(v)=>set("stream_link",v)} testId="tr-edit-stream"/>
          <Fld label="Twitch-Kanal" value={f.twitch_channel} onChange={(v)=>set("twitch_channel",v)} testId="tr-edit-twitch"/>
          <SelectField label="Stream-Plattform" value={f.stream_platform} onChange={(v)=>set("stream_platform",v)} options={STREAM_PLATFORM_OPTIONS} />
          <Fld label="Stream-URL" value={f.stream_url} onChange={(v)=>set("stream_url",v)} testId="tr-edit-stream-url"/>
          <Fld label="Stream-Titel" value={f.stream_title} onChange={(v)=>set("stream_title",v)} testId="tr-edit-stream-title"/>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.twitch_enabled} onChange={(e)=>set("twitch_enabled",e.target.checked)} className="accent-[#9146FF]"/><span>Twitch einbetten</span></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.has_live_stream} onChange={(e)=>set("has_live_stream",e.target.checked)} className="accent-[#9146FF]"/><span>Live-Stream aktiv</span></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.show_chat} onChange={(e)=>set("show_chat",e.target.checked)} className="accent-[#9146FF]"/><span>Chat anzeigen</span></label>
        </div>
      </Details>
      <div className="flex flex-wrap gap-3">
        <button onClick={() => save()} data-testid="tr-edit-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm">Speichern</button>
        <button onClick={() => save({ rebuildPreview: true })} type="button" data-testid="tr-edit-save-rebuild" className="px-5 py-2 border border-[#FFD700]/50 text-[#FFD700] font-bold uppercase tracking-wider rounded-sm hover:bg-[#FFD700]/10">
          Speichern & Format-Vorschau neu bauen
        </button>
      </div>
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

function Details({ title, children }) {
  return (
    <details className="border border-white/10 bg-[#121212] rounded-sm p-4 group">
      <summary className="cursor-pointer select-none text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">{title}</summary>
      <div className="mt-4 space-y-4">{children}</div>
    </details>
  );
}

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
  const roleLabel = (role) => STAFF_ROLE_OPTIONS.find(([v]) => v === role)?.[1] || role;
  const scopeLabel = (scope) => STAFF_SCOPE_OPTIONS.find(([v]) => v === scope)?.[1] || scope;
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
            {STAFF_ROLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Bereich</div>
            <select value={form.scope} onChange={(e) => set("scope", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
              {STAFF_SCOPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Bereich-ID</div>
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
                <th className="text-left px-4 py-3">Bereich</th>
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
    <div className="flex flex-wrap items-end justify-end gap-2">
      <label className="block">
        <span className="block text-[10px] text-white/45 mb-1 truncate max-w-20">{a.display_name || "Spieler A"}</span>
        <input type="number" min="0" value={scoreA} onChange={(e)=>setScoreA(e.target.value)} className="w-16 bg-[#0A0A0A] border border-white/10 px-2 py-1 rounded-sm text-xs text-center" aria-label="Punkte A" placeholder="Punkte" />
      </label>
      <label className="block">
        <span className="block text-[10px] text-white/45 mb-1 truncate max-w-20">{b.display_name || "Spieler B"}</span>
        <input type="number" min="0" value={scoreB} onChange={(e)=>setScoreB(e.target.value)} className="w-16 bg-[#0A0A0A] border border-white/10 px-2 py-1 rounded-sm text-xs text-center" aria-label="Punkte B" placeholder="Punkte" />
      </label>
      <select value={winnerId} onChange={(e)=>onSave(match, scoreA, scoreB, e.target.value)} className="bg-[#0A0A0A] border border-white/10 px-2 py-1 rounded-sm text-xs max-w-[170px]" aria-label="Gewinner">
        <option value="">Gewinner wählen</option>
        <option value={a.id}>{a.display_name || "A"}</option>
        <option value={b.id}>{b.display_name || "B"}</option>
      </select>
      <button type="button" onClick={()=>onSave(match, scoreA, scoreB, winnerId)} className="px-2 py-1 border border-[#29B6E8]/50 text-[#29B6E8] rounded-sm text-[10px] font-bold uppercase">Speichern</button>
    </div>
  );
}

function Fld({ label, value, onChange, type="text", testId, min, max }) {
  return (<label className="block"><div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div><input type={type} min={min} max={max} value={value ?? ""} onChange={(e)=>onChange(e.target.value)} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"/></label>);
}
function Txt({ label, value, onChange, testId }) {
  return (<div className="block"><div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div><MarkdownEditor value={value ?? ""} onChange={onChange} rows={5} testId={testId} /></div>);
}

function PrizeEditor({ value = [], onChange }) {
  const add = (place, group = "overall") => onChange([...(value || []), { group, place, label: place === "last" ? "Letzter Platz" : `Platz ${place}`, value: "" }]);
  const addTop3 = (group) => onChange([
    ...(value || []),
    ...[1, 2, 3].map((place) => ({ group, place, label: `${place}. Platz`, value: "" })),
  ]);
  const update = (i, patch) => {
    const next = [...(value || [])];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  return (
    <div className="border border-[#FFD700]/20 bg-[#FFD700]/5 rounded-sm p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-bold uppercase tracking-widest text-[#FFD700]">Platzierungs-Preise</div>
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" onClick={() => addTop3("winner")} className="text-xs font-bold uppercase tracking-wider text-[#29B6E8]">+ Gewinner Top 3</button>
          <button type="button" onClick={() => addTop3("loser")} className="text-xs font-bold uppercase tracking-wider text-[#CD7F32]">+ Loser Top 3</button>
          <button type="button" onClick={() => add((value?.length || 0) + 1)} className="text-xs font-bold uppercase tracking-wider text-[#29B6E8]">+ Platz</button>
          <button type="button" onClick={() => add("last")} className="text-xs font-bold uppercase tracking-wider text-[#FFD700]">+ Letzter</button>
        </div>
      </div>
      {(value || []).map((p, i) => (
        <div key={i} className="grid grid-cols-12 gap-2">
          <select value={p.group || "overall"} onChange={(e)=>update(i, { group: e.target.value })} className="col-span-12 sm:col-span-3 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm">
            {PRIZE_GROUP_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select value={p.place} onChange={(e)=>update(i, { place: e.target.value === "last" ? "last" : Number(e.target.value) || 1 })} className="col-span-2 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm">
            {[1,2,3,4,5,6,7,8].map((n) => <option key={n} value={n}>{n}.</option>)}
            <option value="last">Letzter</option>
          </select>
          <input value={p.label || ""} onChange={(e)=>update(i, { label: e.target.value })} className="col-span-4 sm:col-span-3 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm" placeholder="Label" />
          <input value={p.value || ""} onChange={(e)=>update(i, { value: e.target.value })} className="col-span-5 sm:col-span-3 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm" placeholder="Preis" />
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="col-span-1 text-white/40 hover:text-[#FF3B30]">×</button>
        </div>
      ))}
    </div>
  );
}

const PRIZE_GROUP_OPTIONS = [
  ["overall", "Gesamtwertung"],
  ["winner", "Gewinner-Bracket"],
  ["loser", "Loser-Bracket"],
  ["special", "Sonderpreis"],
];
