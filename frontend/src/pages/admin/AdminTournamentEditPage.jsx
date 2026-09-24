import { useCallback, useEffect, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { API, api, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { BracketTree } from "@/components/tls/BracketTree";
import { AccessLinksPanel } from "@/components/tls/AccessLinksPanel";
import { TournamentFlowStepper } from "@/components/tls/TournamentFlowStepper";
import { fromDateTimeLocal } from "@/lib/datetime";
import { toast } from "sonner";
import { Zap, RefreshCw, Eye, Search } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useConfirm, usePrompt } from "@/components/tls/ConfirmDialog";
import { SkeletonDetailHeader } from "@/components/tls/Skeleton";
import { REGISTRATION_STATUS_OPTIONS, formatRegistrationStatus, formatTournamentDisplay } from "@/lib/tournamentLabels";
import { ParticipantAddForm } from "./tournament/ParticipantAddForm";
import { TournamentStaffPanel } from "./tournament/StaffPanel";
import { TournamentStagesPanel } from "./tournament/StagesPanel";
import { ActionGroup, EmptyBracketNotice, TournamentEditForm } from "./tournament/TournamentEditForm";
import { OPERATIONAL_STATUS_VALUES, TOURNAMENT_STATUS_OPTIONS, normalizeSearch, primaryTournamentAction } from "./tournament/shared";

export default function AdminTournamentEditPage() {
  const { isAdmin, isModerator } = useAuth();
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [t, setT] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [regs, setRegs] = useState([]);
  const [bracket, setBracket] = useState(null);
  const [tab, setTab] = useState(searchParams.get("tab") || "participants");
  const [groups, setGroups] = useState([]);
  const [staff, setStaff] = useState([]);
  const [users, setUsers] = useState([]);
  const [stages, setStages] = useState([]);
  const [matchesV2, setMatchesV2] = useState([]);
  const [stations, setStations] = useState([]);
  const [teams, setTeams] = useState([]);
  const [participantQuery, setParticipantQuery] = useState("");
  const [participantStatusFilter, setParticipantStatusFilter] = useState("");
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

  useEffect(() => {
    const nextTab = searchParams.get("tab") || "participants";
    if (nextTab !== tab) setTab(nextTab);
  }, [searchParams, tab]);

  const selectTab = (nextTab) => {
    setTab(nextTab);
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (nextTab === "participants") params.delete("tab");
      else params.set("tab", nextTab);
      return params;
    }, { replace: true });
  };

  const load = useCallback(async () => {
    const { data } = await api.get(`/tournaments/${id}?include_draft=true`);
    setT(data);
    const { data: r } = await api.get(`/tournaments/${id}/registrations`);
    setRegs(r);
    const { data: b } = await api.get(`/tournaments/${id}/bracket`);
    setBracket(b);
    try {
      const [{ data: st }, { data: mv2 }, stationResponse] = await Promise.all([
        api.get(`/tournaments/${id}/stages`),
        api.get(`/tournaments/${id}/matches-v2`),
        (isAdmin || isModerator) ? api.get(`/stations?tournament_id=${id}`).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
      ]);
      setStages(st || []);
      setMatchesV2(mv2 || []);
      setStations(stationResponse.data || []);
    } catch {
      setStages([]);
      setMatchesV2([]);
      setStations([]);
    }
    if (data.format === "groups") {
      try { const { data: g } = await api.get(`/tournaments/${id}/groups`); setGroups(g || []); }
      catch { setGroups([]); }
    }
    if (isAdmin) {
      try {
        const [{ data: s }, { data: u }, { data: teamRows }] = await Promise.all([
          api.get(`/tournaments/${id}/staff`),
          api.get("/users"),
          api.get("/teams"),
        ]);
        setStaff(s || []);
        setUsers(u || []);
        setTeams(teamRows || []);
      } catch {
        setStaff([]);
        setUsers([]);
        setTeams([]);
      }
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

  // Ohne diesen Fang bleibt die Seite bei unerreichbarem Backend stumm auf
  // "Lade…" stehen und die Rejection landet unbehandelt in der Konsole.
  const loadSafely = useCallback(() => load()
    .then(() => setLoadError(""))
    .catch((error) => setLoadError(formatRequestError(error, "Turnier konnte nicht geladen werden."))), [load]);

  useEffect(() => { loadSafely(); }, [loadSafely]);
  useApiInvalidation(loadSafely, ["tournaments", "matches", "stations"]);

  const autoAssignStations = async ({ silent = false, reload = true } = {}) => {
    if (!stations.length) return null;
    try {
      const { data } = await api.post(`/stations/auto-assign?tournament_id=${encodeURIComponent(id)}&plan=true`);
      if (!silent) {
        toast.success(data.planned
          ? `${data.assigned || 0} Match${Number(data.assigned) === 1 ? "" : "es"} mit Station und Startzeit geplant.`
          : `${data.assigned || 0} Match${Number(data.assigned) === 1 ? "" : "es"} automatisch Stationen zugewiesen.`);
      }
      if (reload) load();
      return data;
    } catch (e) {
      if (!silent) toast.error(formatRequestError(e, "Stationen konnten nicht automatisch zugewiesen werden."));
      return null;
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
      const { data } = await api.patch(`/tournaments/${id}/registrations/${rid}`, { status });
      if (data?.auto_bracket_update?.preview === false && data.auto_bracket_update?.ok !== false) {
        await autoAssignStations({ silent: true, reload: false });
      }
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
      if (!data.preview) await autoAssignStations({ silent: true, reload: false });
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
      const { data } = await api.delete(`/tournaments/${id}/registrations/${registration.id}`);
      if (data?.auto_bracket_update?.preview === false && data.auto_bracket_update?.ok !== false) {
        await autoAssignStations({ silent: true, reload: false });
      }
      toast.success(data?.auto_bracket_update?.match_count
        ? `Teilnehmer entfernt. ${data.auto_bracket_update.preview === false ? "Turnierbaum" : "Vorschau"} neu gemischt.`
        : "Teilnehmer entfernt.");
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
      if (autoBracketUpdate?.preview === false && autoBracketUpdate?.ok !== false) {
        await autoAssignStations({ silent: true, reload: false });
      }
      if (!replacement && autoBracketUpdate?.ok === false) {
        toast.success(autoBracketUpdate.reason === "matches_started"
          ? "Teilnehmer hinzugefügt. Turnierbaum bleibt fix, weil bereits Spiele aktiv oder gewertet sind."
          : `Teilnehmer hinzugefügt. Turnierbaum konnte nicht automatisch neu gebaut werden${autoBracketUpdate.detail ? `: ${autoBracketUpdate.detail}` : "."}`);
      } else if (!replacement && autoBracketUpdate?.match_count) {
        toast.success(`Teilnehmer hinzugefügt. ${autoBracketUpdate.preview === false ? "Turnierbaum" : "Vorschau"} mit ${autoBracketUpdate.participant_count} Teilnehmern neu gemischt.`);
      } else {
        toast.success(replacement
        ? `Teilnehmer hinzugefügt und ${replacement.v2_matches} Spielplätze ersetzt.`
        : autoBracketUpdate?.match_count
          ? `Teilnehmer hinzugefügt. Vorschau mit ${autoBracketUpdate.participant_count} Teilnehmern neu gemischt.`
          : "Teilnehmer hinzugefügt.");
      }
      setParticipantForm({ user_id: "", team_id: "", display_name: "", ingame_name: "", discord: "", status: "approved", seed: "", replace_registration_id: "" });
      load();
    } catch (err) {
      toast.error(formatRequestError(err, "Teilnehmer konnte nicht hinzugefügt werden."));
    }
  };
  const runPlanningCheck = async ({ silent = false } = {}) => {
    const { data } = await api.get(`/tournaments/${id}/planning-check`);
    const lines = [...(data.errors || []), ...(data.warnings || [])]
      .slice(0, 8)
      .map((item) => item.message)
      .join("\n");
    if (!silent) {
      if (data.ok && !data.warning_count) toast.success(`Planung OK: ${data.checked_matches} Matches geprüft.`);
      else toast[data.ok ? "warning" : "error"](`${data.error_count} Konflikte, ${data.warning_count} Hinweise${lines ? `\n${lines}` : ""}`);
    }
    return data;
  };
  const setTournStatus = async (status) => {
    let forceStart = false;
    try {
      if (status === "live") {
        const report = await runPlanningCheck({ silent: true });
        if (!report.ok || report.warning_count > 0) {
          const lines = [...(report.errors || []), ...(report.warnings || [])]
            .slice(0, 10)
            .map((item) => item.message)
            .join("\n");
          const ok = await confirm({
            title: report.ok ? "Mit Hinweisen live schalten?" : "Mit Planungskonflikten live schalten?",
            description: `${report.error_count} Konflikte, ${report.warning_count} Hinweise.${lines ? `\n\n${lines}` : ""}`,
            confirmLabel: "Trotzdem live",
            tone: report.ok ? "info" : "danger",
          });
          if (!ok) return;
          forceStart = !report.ok;
        }
      }
      const { data } = await api.post(`/tournaments/${id}/status`, { status, force: forceStart });
      if (["check_in", "live"].includes(status) && data?.auto_generated_bracket && data.auto_generated_bracket.ok !== false) {
        await autoAssignStations({ silent: true, reload: false });
      }
      toast.success(`Status: ${TOURNAMENT_STATUS_OPTIONS.find(([value]) => value === status)?.[1] || status}`);
      load();
    } catch (e) {
      const statusDetail = e.response?.data?.detail;
      if (statusDetail?.code === "tournament_not_ready") {
        toast.error(statusDetail.message || "Turnier ist noch nicht startbereit.");
        return;
      }
      toast.error(formatRequestError(e, "Turnierstatus konnte nicht gespeichert werden."));
    }
  };
  const setTournamentLock = async (locked) => {
    const ok = await confirm({
      title: locked ? "Turnier sperren?" : "Turnier entsperren?",
      description: locked
        ? "Danach sind Ergebnisse, Teilnehmer, Spielzeiten und Stationen nur noch lesbar. Löschen bleibt möglich."
        : "Danach kann die Turnierleitung wieder Änderungen vornehmen.",
      confirmLabel: locked ? "Sperren" : "Entsperren",
      tone: locked ? "danger" : "info",
    });
    if (!ok) return;
    try {
      await api.post(`/tournaments/${id}/${locked ? "lock" : "unlock"}`);
      toast.success(locked ? "Turnier gesperrt." : "Turnier entsperrt.");
      load();
    } catch (e) {
      toast.error(formatRequestError(e, locked ? "Turnier konnte nicht gesperrt werden." : "Turnier konnte nicht entsperrt werden."));
    }
  };
  const updateMatchV2Schedule = async (match, payload) => {
    try {
      await api.patch(`/matches/${match.id}`, {
        scheduled_at: payload.scheduled_at ? fromDateTimeLocal(payload.scheduled_at) : null,
        duration_minutes: payload.duration_minutes === "" ? null : Number(payload.duration_minutes),
        station_id: payload.station_id || null,
      });
      toast.success("Matchplanung gespeichert.");
      load();
    } catch (err) {
      toast.error(formatRequestError(err, "Matchplanung konnte nicht gespeichert werden."));
    }
  };
  const updateMatchV2Result = async (match, results, meta = {}) => {
    try {
      const suffix = meta.force ? "?force=true" : "";
      await api.post(`/matches/${match.id}/result${suffix}`, {
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
  const generateSwissRound = async () => {
    try {
      const { data } = await api.post(`/tournaments/${id}/swiss/next-round`);
      toast.success(`Runde ${data.round} mit ${data.match_count} Spielen generiert`);
      load();
    } catch (e) {
      toast.error(formatRequestError(e, "Schweizer Runde konnte nicht generiert werden."));
    }
  };

  if (!t) return (
    <AdminLayout>
      {loadError
        ? <div className="p-10 text-[#FF3B30]" data-testid="admin-tr-load-error">{loadError}</div>
        : <div className="p-10"><SkeletonDetailHeader label="Lade Turnier" /></div>}
    </AdminLayout>
  );
  const canRecordResults = ["live", "paused"].includes(t.status);
  const availableTabs = [
    ["participants", "Teilnehmer"],
    ["bracket", "Turnierbaum"],
    ["stages", "Matchplan"],
    ...(t.format === "groups" ? [["groups", "Gruppen"]] : []),
    ...(isAdmin ? [["staff", "Team"]] : []),
    ["edit", "Bearbeiten"],
  ];
  const activeTab = availableTabs.some(([key]) => key === tab) ? tab : "participants";
  const registrationCounts = regs.reduce((acc, registration) => {
    const key = registration.status || "pending";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const participantSearch = normalizeSearch(participantQuery);
  const filteredRegistrations = regs.filter((registration) => {
    if (participantStatusFilter && registration.status !== participantStatusFilter) return false;
    if (!participantSearch) return true;
    const haystack = normalizeSearch([
      registration.display_name,
      registration.ingame_name,
      registration.discord,
      registration.user?.display_name,
      registration.user?.email,
      registration.team?.name,
    ].filter(Boolean).join(" "));
    return haystack.includes(participantSearch);
  });
  const primaryAction = primaryTournamentAction(t.status);
  const canOperateTournament = isAdmin || !!t.can_manage_structure;
  const visibleStatusOptions = isAdmin
    ? TOURNAMENT_STATUS_OPTIONS
    : TOURNAMENT_STATUS_OPTIONS.filter(([value]) => OPERATIONAL_STATUS_VALUES.has(value));
  // Werkzeuge: braucht man gelegentlich, nicht bei jedem Blick auf die Seite.
  // "Zurücksetzen" steht bewusst zuletzt und rot, weil es den Baum verwirft.
  const canLockTournament = isAdmin && ["completed", "results_published", "archived", "cancelled"].includes(t.status);
  const toolActions = [
    isModerator && stations.length > 0 && (
      <button key="stations" type="button" onClick={() => autoAssignStations()} data-testid="admin-tr-auto-stations" className="px-3 py-2 border border-[#29B6E8]/50 text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm text-xs hover:bg-[#29B6E8]/10 inline-flex items-center gap-2">
        <Zap className="w-3.5 h-3.5" /> Stationen automatisch
      </button>
    ),
    isModerator && (
      <button key="planning" type="button" onClick={() => runPlanningCheck()} data-testid="admin-tr-planning-check" className="px-3 py-2 border border-[#FFD700]/50 text-[#FFD700] font-bold uppercase tracking-wider rounded-sm text-xs hover:bg-[#FFD700]/10 inline-flex items-center gap-2">
        <Eye className="w-3.5 h-3.5" /> Planung prüfen
      </button>
    ),
    canLockTournament && (
      <button key="lock" type="button" onClick={() => setTournamentLock(!t.locked_at)} data-testid="admin-tr-lock" className={`px-3 py-2 border font-bold uppercase tracking-wider rounded-sm text-xs ${t.locked_at ? "border-[#00FF88]/40 text-[#00FF88] hover:bg-[#00FF88]/10" : "border-[#FFD700]/50 text-[#FFD700] hover:bg-[#FFD700]/10"}`}>
        {t.locked_at ? "Entsperren" : "Sperren"}
      </button>
    ),
    isModerator && (
      <button key="reset" type="button" onClick={reset} data-testid="admin-tr-reset" className="px-3 py-2 border border-[#FF3B30]/40 text-[#FF3B30] font-bold uppercase tracking-wider rounded-sm text-xs hover:bg-[#FF3B30]/10 inline-flex items-center gap-2">
        <RefreshCw className="w-3.5 h-3.5" /> Zurücksetzen
      </button>
    ),
  ].filter(Boolean);
  const downloadActions = [
    { key: "participants", href: `${API}/exports/tournaments/${t.id}/participants.pdf`, label: "PDF Teilnehmer" },
    { key: "checkin", href: `${API}/exports/tournaments/${t.id}/checkin.pdf`, label: "PDF Check-in" },
    { key: "registration-qr", href: `${API}/exports/tournaments/${t.id}/registration-qr.pdf`, label: "PDF Anmeldung QR", highlight: true },
    { key: "matches", href: `${API}/exports/tournaments/${t.id}/matches.pdf`, label: "PDF Spiele" },
    isModerator && { key: "match-plan", href: `${API}/tournaments/${t.id}/match-plan.csv`, label: "CSV Matchplan" },
  ].filter(Boolean);

  return (
    <AdminLayout>
      <div className="mb-6 space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <Link to="/admin/tournaments" className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8] hover:text-white">← Turniere</Link>
            <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">{t.title}</h1>
            <div className="mt-2 flex items-center gap-3 flex-wrap">
              <StatusBadge status={t.status} />
              {t.locked_at && <span className="px-2 py-1 border border-[#FFD700]/40 text-[#FFD700] text-[10px] font-bold uppercase tracking-widest rounded-sm">Gesperrt</span>}
              <span className="text-white/60 text-sm">{formatTournamentDisplay(t)}</span>
              <Link to={`/tournaments/${t.slug || t.id}`} target="_blank" className="text-[#29B6E8] text-xs uppercase tracking-wider font-bold hover:text-white inline-flex items-center gap-1"><Eye className="w-3 h-3" /> Öffentliche Seite</Link>
            </div>
          </div>
          {/* Hier steht nur, was das Turnier weiterschiebt: der nächste Schritt,
              die Runde für Formate die eine brauchen, und der Status. Alles
              andere liegt unten in den Gruppen. */}
          <div className="flex items-start gap-2 flex-wrap">
            {canOperateTournament && primaryAction && (
              <button
                type="button"
                onClick={() => setTournStatus(primaryAction.status)}
                data-testid="admin-tr-primary-action"
                className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-sm hover:bg-[#1E95C2] inline-flex items-center gap-2"
              >
                <Zap className="w-3.5 h-3.5" /> {primaryAction.label}
              </button>
            )}
            {isAdmin && t.format === "swiss" && (
              <button type="button" onClick={generateSwissRound} data-testid="admin-tr-swiss-next" className="px-4 py-2 border border-[#29B6E8] text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm text-sm hover:bg-[#29B6E8]/10">Schweizer Runde</button>
            )}
            {isAdmin && t.format === "groups" && (
              <button type="button" onClick={generateGroups} data-testid="admin-tr-groups" className="px-4 py-2 border border-[#29B6E8] text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm text-sm hover:bg-[#29B6E8]/10">Gruppen generieren</button>
            )}
            {canOperateTournament && (
              <div>
                <select value={t.status} onChange={(e) => setTournStatus(e.target.value)} data-testid="admin-tr-status-select" className="bg-[#0A0A0A] border border-white/10 px-3 py-2 text-sm rounded-sm">
                  {!visibleStatusOptions.some(([value]) => value === t.status) && <option key={t.status} value={t.status}>{TOURNAMENT_STATUS_OPTIONS.find(([value]) => value === t.status)?.[1] || t.status}</option>}
                  {visibleStatusOptions.map(([s, label]) => <option key={s} value={s}>{label}</option>)}
                </select>
                <div className="mt-1 max-w-[16rem] text-[10px] text-white/40">Operativ durch Turnierleitung; Zeitautomatik nur wenn ausdrücklich aktiviert.</div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2" data-testid="admin-tr-toolbar">
          {toolActions.length > 0 && (
            <ActionGroup title="Werkzeuge" count={toolActions.length} testId="admin-tr-tools">
              {toolActions}
            </ActionGroup>
          )}
          <ActionGroup title="Downloads" count={downloadActions.length} testId="admin-tr-downloads">
            {downloadActions.map((item) => (
              <a
                key={item.key}
                href={item.href}
                target="_blank"
                rel="noreferrer"
                data-testid={`admin-tr-download-${item.key}`}
                className={`px-3 py-2 border text-xs uppercase font-bold rounded-sm text-center ${item.highlight ? "border-[#FFD700]/40 text-[#FFD700] hover:bg-[#FFD700]/10" : "border-white/20 text-white/80 hover:border-[#29B6E8]/40"}`}
              >
                {item.label}
              </a>
            ))}
          </ActionGroup>
        </div>
      </div>

      {isAdmin && <div className="mb-5"><AccessLinksPanel targetType="tournament" targetId={t.id} allowRegister collapsible /></div>}

      <TournamentFlowStepper
        tournament={t}
        registrations={regs}
        matchesV2={matchesV2}
        onNavigate={(key) => selectTab(key)}
      />

      <div className="flex gap-2 mb-5 border-b border-white/10 overflow-x-auto">
        {availableTabs.map(([s, label]) => (
          <button
            key={s}
            data-testid={`admin-tr-tab-${s}`}
            onClick={() => selectTab(s)}
            className={`px-4 py-3 text-xs font-bold uppercase tracking-wider whitespace-nowrap ${activeTab === s ? "text-[#29B6E8] border-b-2 border-[#29B6E8]" : "text-white/60 hover:text-white"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "participants" && (
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
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_16rem_auto]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <input
              value={participantQuery}
              onChange={(event) => setParticipantQuery(event.target.value)}
              data-testid="admin-reg-search"
              className="w-full rounded-sm border border-white/10 bg-[#0A0A0A] py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-white/35 focus:border-[#29B6E8]/60 focus:outline-none"
              placeholder="Name, Discord, E-Mail oder Team suchen"
            />
          </label>
          <select
            value={participantStatusFilter}
            onChange={(event) => setParticipantStatusFilter(event.target.value)}
            data-testid="admin-reg-status-filter"
            className="w-full rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2.5 text-sm text-white focus:border-[#29B6E8]/60 focus:outline-none"
          >
            <option value="">Alle Status ({regs.length})</option>
            {REGISTRATION_STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label} ({registrationCounts[value] || 0})</option>
            ))}
          </select>
          <div className="flex items-center justify-end rounded-sm border border-white/10 bg-[#121212] px-3 py-2 text-xs font-bold uppercase tracking-wider text-white/55">
            {filteredRegistrations.length} / {regs.length} sichtbar
          </div>
        </div>
        <div className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
          <div className="md:hidden divide-y divide-white/5">
            {filteredRegistrations.map((r, i) => (
              <div key={r.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-widest text-white/35">#{i + 1}</div>
                    <div className="mt-1 font-heading font-bold uppercase break-words">{r.display_name || r.user?.display_name || r.ingame_name}</div>
                    <div className="mt-1 text-xs text-white/45 break-all">{r.discord || "Kein Discord"}</div>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {isAdmin && (
                    <select value={r.status} onChange={(e) => setRegStatus(r.id, e.target.value)} data-testid={`admin-reg-status-mobile-${r.id}`} className="col-span-2 bg-[#0A0A0A] border border-white/10 px-2 py-2 text-xs rounded-sm">
                      {["pending", "approved", "rejected", "waitlist", "checked_in", "no_show"].map((s) => <option key={s} value={s}>{formatRegistrationStatus(s)}</option>)}
                    </select>
                  )}
                  {isModerator && r.status !== "checked_in" && !["rejected", "waitlist"].includes(r.status) && (
                    <button type="button" onClick={() => setRegCheckinStatus(r.id, "checked_in")} className="px-2 py-2 border border-[#00FF88]/40 text-[#00FF88] rounded-sm text-[10px] font-bold uppercase">Check-in</button>
                  )}
                  {isModerator && r.status === "checked_in" && (
                    <button type="button" onClick={() => setRegCheckinStatus(r.id, "approved")} className="px-2 py-2 border border-white/20 text-white/70 rounded-sm text-[10px] font-bold uppercase">Auschecken</button>
                  )}
                  {isModerator && !["checked_in", "rejected", "waitlist", "no_show"].includes(r.status) && (
                    <button type="button" onClick={() => setRegCheckinStatus(r.id, "no_show")} className="px-2 py-2 border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm text-[10px] font-bold uppercase">Nicht erschienen</button>
                  )}
                  {isModerator && (
                    <button type="button" onClick={() => deleteParticipant(r)} className="px-2 py-2 border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm text-[10px] font-bold uppercase hover:bg-[#FF3B30]/10">Entfernen</button>
                  )}
                </div>
              </div>
            ))}
            {filteredRegistrations.length === 0 && <div className="text-center py-10 text-white/40">{regs.length === 0 ? "Keine Anmeldungen" : "Keine Anmeldungen für diesen Filter"}</div>}
          </div>
          <div className="hidden md:block overflow-x-auto">
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
              {filteredRegistrations.map((r, i) => (
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
              {filteredRegistrations.length === 0 && <tr><td colSpan="5" className="text-center py-10 text-white/40">{regs.length === 0 ? "Keine Anmeldungen" : "Keine Anmeldungen für diesen Filter"}</td></tr>}
            </tbody>
          </table>
          </div>
        </div>
        </div>
      )}

      {activeTab === "bracket" && bracket && (
        <div className="bg-[#0A0A0A] rounded-sm p-4 border border-white/10">
          {(bracket.matches_v2?.length || 0) === 0 ? (
            <EmptyBracketNotice tournament={t} />
          ) : (
            <BracketTree data={bracket} />
          )}
        </div>
      )}

      {activeTab === "stages" && (
        <TournamentStagesPanel
          tournamentId={t.id}
          stages={stages}
          matches={matchesV2}
          registrations={regs}
          stations={stations}
          tournamentStartDate={t.start_date}
          isAdmin={false}
          isModerator={isModerator}
          onChanged={load}
          onSaveResult={updateMatchV2Result}
          onSaveMatchMeta={updateMatchV2Schedule}
          canRecordResults={canRecordResults}
        />
      )}
      {activeTab === "edit" && (
        <TournamentEditForm
          key={t.updated_at || t.id}
          tournament={t}
          stages={stages}
          onSaved={load}
          onRebuildFromFormat={rebuildFromFormat}
        />
      )}
      {activeTab === "staff" && isAdmin && (
        <TournamentStaffPanel tournamentId={t.id} staff={staff} users={users} onChanged={load} />
      )}
      {activeTab === "groups" && (
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
