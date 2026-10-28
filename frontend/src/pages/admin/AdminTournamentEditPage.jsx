import { useCallback, useEffect, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { API, api, formatRequestError } from "@/lib/api";
import { checkinStatusText, placementMessage } from "@/lib/tournamentFillIn";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { BracketTree } from "@/components/tls/BracketTree";
import { AccessLinksPanel } from "@/components/tls/AccessLinksPanel";
import { OnsiteAccessPanel, OnsiteMark } from "./tournament/OnsiteAccessPanel";
import { TournamentFlowStepper } from "@/components/tls/TournamentFlowStepper";
import { toast } from "sonner";
import { Zap, RefreshCw, Eye, Search, Tv } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useConfirm, usePrompt } from "@/components/tls/ConfirmDialog";
import { SkeletonDetailHeader } from "@/components/tls/Skeleton";
import { REGISTRATION_STATUS_OPTIONS, formatRegistrationStatus, formatTournamentDisplay } from "@/lib/tournamentLabels";
import { LineupMark, useTeamLineups } from "@/components/tls/tournament/LineupMark";
import { FeedbackReport } from "@/pages/admin/feedback/FeedbackReport";
import { ParticipantAddForm } from "./tournament/ParticipantAddForm";
import { TournamentStaffPanel } from "./tournament/StaffPanel";
import { TournamentStagesPanel } from "./tournament/StagesPanel";
import { matchRights } from "@/lib/tournamentRights";
import { PauseUntilControl, RoundSponsorsPanel } from "./tournament/TvTournamentPanel";
import { HeatRebuildBar } from "./tournament/HeatRebuildBar";
import { ParticipantRemovalActions } from "./tournament/ParticipantRemovalActions";
import { ActionGroup, EmptyBracketNotice, TournamentEditForm } from "./tournament/TournamentEditForm";
import { FINISHED_STATUSES, OPERATIONAL_STATUS_VALUES, TOURNAMENT_STATUS_OPTIONS, bracketFixed, fixedRegistrationIds, guardDetail, matchImpact, normalizeSearch, primaryTournamentAction, statusChangeNotice, swissUndoInfo } from "./tournament/shared";
import { MatchPlanPanel } from "./tournament/matchplan/MatchPlanPanel";
import { MapPoolPanel } from "./tournament/MapPoolPanel";
import { SquadAssignDialog, canAssignSquads } from "@/components/tls/league/SquadAssignDialog";
import { STAFFEL_STATUS_VALUES, SeasonSourceNote, StaffelHeaderLine, isStaffel, staffelBeforeStart } from "./tournament/StaffelParts";

export default function AdminTournamentEditPage() {
  // Globale Aktionen nur für die Turnierleitung mit Zwei-Faktor (#1028), Helfer sehen die ihres Einsatzes.
  // Turnierleitung über alle Turniere (mit Zwei-Faktor) für Einstellungen, Team, Sperren und Zugangslinks; alles
  // andere nach den Rechten, die der Server je Turnier schickt (#1353) - nicht nach „irgendein Adminbereich“.
  const { isTournamentLead } = useAuth();
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [t, setT] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [regs, setRegs] = useState([]);
  // Team am Spieltag (#1192): Aufstellung und „da“ je Team beim Check-in.
  const lineups = useTeamLineups(t);
  const [bracket, setBracket] = useState(null);
  const [tab, setTab] = useState(searchParams.get("tab") || "participants");
  const [groups, setGroups] = useState([]);
  const [staff, setStaff] = useState([]);
  const [staffError, setStaffError] = useState("");
  const [stages, setStages] = useState([]);
  const [matchesV2, setMatchesV2] = useState([]);
  const [stations, setStations] = useState([]);
  const [teams, setTeams] = useState([]);
  const [teamsError, setTeamsError] = useState("");
  // Konto des neuen Teilnehmers (#1354): aus der Personensuche, nicht aus der ganzen Kontoliste.
  const [participantPerson, setParticipantPerson] = useState(null);
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
        data.can_use_staff_tools ? api.get(`/stations?tournament_id=${id}`).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
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
    // Jede Liste lädt für sich (#1354) - kein gemeinsames Promise.all über Listen mit verschiedenen Rechten. Fehlt ein
    // Recht, steht an der Stelle ein Satz, und der Rest der Seite geht weiter. Personen sucht die Personensuche selbst.
    const missing = (failure, what) => (failure?.response?.status === 403
      ? formatRequestError(failure, `Dafür fehlt dir das Recht: ${what}.`)
      : `${what} lassen sich gerade nicht laden.`);
    if (isTournamentLead) {
      try {
        const { data: s } = await api.get(`/tournaments/${id}/staff`);
        setStaff(s || []);
        setStaffError("");
      } catch (failure) {
        setStaff([]);
        setStaffError(missing(failure, "Helfer dieses Turniers"));
      }
    }
    if (data.can_manage_participants) {
      try {
        const { data: teamRows } = await api.get("/admin/choices/teams", { params: { tournament_id: id } });
        setTeams(Array.isArray(teamRows) ? teamRows : []);
        setTeamsError("");
      } catch (failure) {
        setTeams([]);
        setTeamsError(missing(failure, "Teams dieses Turniers"));
      }
    }
  }, [id, isTournamentLead]);

  // Ohne diesen Fang bleibt die Seite bei unerreichbarem Backend stumm auf
  // "Lade…" stehen und die Rejection landet unbehandelt in der Konsole.
  const loadSafely = useCallback(() => load()
    .then(() => setLoadError(""))
    .catch((error) => setLoadError(formatRequestError(error, "Turnier konnte nicht geladen werden."))), [load]);

  useEffect(() => { loadSafely(); }, [loadSafely]);
  useApiInvalidation(loadSafely, ["tournaments", "matches", "stations"]);

  // Folgenschwere Aktionen (#2120): echte Spiele löscht der Server nur mit force - vorher nennt die Rückfrage, wie
  // viele Spiele (und wie viele davon schon begonnen oder gewertet) verloren gehen. Weiß der Server mehr als die Seite
  // (inzwischen gespielt), kommt seine Rückfrage mit seinen Zahlen.
  const runConfirmed = async (send, { title, confirmLabel, failure }) => {
    try {
      return await send(false);
    } catch (e) {
      const detail = guardDetail(e, "confirm_destruction");
      if (!detail) {
        toast.error(formatRequestError(e, failure));
        return null;
      }
      const label = typeof confirmLabel === "function" ? confirmLabel(detail) : confirmLabel;
      const ok = await confirm({ title, description: detail.message, confirmLabel: label, tone: "danger" });
      if (!ok) return null;
      try {
        return await send(true);
      } catch (inner) {
        toast.error(formatRequestError(inner, failure));
        return null;
      }
    }
  };
  const reset = async () => {
    // Der Status bleibt (#2120, TA16) - nur die Spiele gehen. Erst ohne force: mit echten Spielen fragt der Server mit
    // seinen Zahlen nach (Review #2120), die Seite rät nicht. Nur eine reine Vorschau fragt die Seite selbst.
    if (!matchImpact(matchesV2).match_count && !await confirm({
      title: "Turnierbaum zurücksetzen?",
      description: "Die Vorschau wird gelöscht und baut sich mit der nächsten An- oder Abmeldung bzw. „Speichern & Struktur anwenden“ neu. Der Status bleibt.",
      confirmLabel: "Zurücksetzen",
      tone: "info",
    })) return;
    const data = await runConfirmed(
      async (force) => (await api.post(`/tournaments/${id}/reset-bracket${force ? "?force=true" : ""}`)).data,
      {
        title: "Turnierbaum zurücksetzen?",
        confirmLabel: (detail) => (detail.match_count === 1 ? "1 Spiel löschen" : `${detail.match_count} Spiele löschen`),
        failure: "Turnierbaum konnte nicht zurückgesetzt werden.",
      },
    );
    if (!data) return;
    toast.success("Turnierbaum zurückgesetzt.");
    load();
  };
  const setRegStatus = async (rid, status) => {
    // Absage mit Grund (#1133): die Person bekommt eine Nachricht - der Grund steht nur darin, nicht an der Anmeldung.
    let reason = null;
    if (status === "rejected") {
      const answer = await prompt({
        title: "Anmeldung ablehnen",
        description: "Die Person bekommt eine Nachricht. Ein Grund ist freiwillig und steht nur in dieser Nachricht.",
        placeholder: "z. B. Team nicht vollständig",
        confirmLabel: "Ablehnen",
        tone: "danger",
      });
      if (answer === false || answer === null || answer === undefined) return;
      reason = String(answer).trim() || null;
    }
    try {
      const { data } = await api.patch(`/tournaments/${id}/registrations/${rid}`, reason ? { status, status_reason: reason } : { status });
      showPlacement(data?.placement);
      load();
    } catch (e) {
      toast.error(formatRequestError(e, "Teilnehmerstatus konnte nicht gespeichert werden."));
    }
  };
  // Nachrücker nach dem Check-in-Ende (#1551): wo die Person im Baum gelandet ist - oder dass kein Platz frei ist.
  const showPlacement = (placement) => {
    const message = placementMessage(placement);
    if (message) toast[message.tone](message.text);
  };
  const setRegCheckinStatus = async (rid, status) => {
    try {
      const { data } = await api.post(`/tournaments/${id}/registrations/${rid}/checkin`, { status });
      // Mit Nachrücker von der Warteliste (#1941): die Meldung nennt ihn.
      toast.success(checkinStatusText(status, data, regs));
      showPlacement(data?.placement);
      load();
    } catch (e) {
      toast.error(formatRequestError(e, "Check-in konnte nicht gespeichert werden."));
    }
  };
  // `keepStage` (Liga-Staffel, #2109): ohne Struktur im Aufruf baut der Server mit der vorhandenen Phase neu - die
  // Vorschau wird neu gemischt, Format und Einstellungen der Liga bleiben.
  // Eine Vorschau ersetzt nie echte Spiele (#2120, TA12/TA17): steht der Baum, lehnt der Server ab und sagt warum;
  // sonst fragt er mit der Zahl der Spiele nach, bevor er etwas ersetzt.
  const rebuildFromFormat = async ({ preview = true, force = false, structure = null, keepStage = false } = {}) => {
    const data = await runConfirmed(async (confirmed) => {
      const params = new URLSearchParams();
      if (preview) params.set("preview", "true");
      if (force || confirmed) params.set("force", "true");
      const suffix = params.toString() ? `?${params.toString()}` : "";
      return (await api.post(`/tournaments/${id}/bracket/from-format${suffix}`, keepStage ? undefined : (structure || {}))).data;
    }, { title: "Turnierbaum aus dem Format neu bauen?", confirmLabel: "Neu bauen", failure: "Turnierbaum konnte nicht aus dem Format neu aufgebaut werden." });
    if (!data) return;
    toast.success(keepStage
      ? `Spielplan-Vorschau mit ${data.match_count} Spielen neu gemischt.`
      : data.preview ? `Turnierbaum-Vorschau mit ${data.match_count} Spielen neu aufgebaut.` : `Turnierbaum mit ${data.match_count} Spielen neu aufgebaut.`);
    load();
  };
  const deleteParticipant = async (registration) => {
    if (!await confirm({
      title: "Teilnehmer entfernen?",
      description: `${registration.display_name || registration.user?.display_name || registration.ingame_name || "Dieser Teilnehmer"} wird aus dem Turnier entfernt. Eine vorhandene Vorschau wird danach neu gemischt.`,
      confirmLabel: "Entfernen",
      tone: "danger",
    })) return;
    try {
      // Ein zugeteiltes Co-Team (#1649) nimmt der eigene Weg heraus - mit Protokoll „league.squad.remove“.
      const { data } = await api.delete(registration.squad_id
        ? `/tournaments/${id}/squad-registrations/${registration.id}`
        : `/tournaments/${id}/registrations/${registration.id}`);
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
        user_id: participantPerson?.id || null,
        team_id: participantForm.team_id || null,
        display_name: participantForm.display_name || null,
        ingame_name: participantForm.ingame_name || null,
        discord: participantForm.discord || null,
        status: participantForm.status || "approved",
        seed: participantForm.seed === "" ? null : Number(participantForm.seed),
        replace_registration_id: participantForm.replace_registration_id || null,
      };
      const { data } = await api.post(`/tournaments/${id}/registrations`, payload);
      // Turnier nur mit Event-Anmeldung (#875): eingetragen trotz fehlender Event-Anmeldung - sagen, nicht verhindern.
      if (data?.event_gate_warning) toast.warning(data.event_gate_warning);
      showPlacement(data?.placement);
      const replacement = data.replacement;
      const autoBracketUpdate = data.auto_bracket_update;
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
      setParticipantPerson(null);
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
    let reason = null;
    // Status mit Folgen (#2120, TA24): Entwurf nimmt die Seite weg, Beendet und Veröffentlicht verschicken und
    // vergeben, Abgesagt benachrichtigt alle Angemeldeten - mit freiwilligem Grund.
    const notice = statusChangeNotice(status, t, {
      activeRegistrations: regs.filter((r) => ["pending", "approved", "checked_in", "waitlist"].includes(r.status)).length,
    });
    if (notice?.askReason) {
      const answer = await prompt({ ...notice, multiline: false });
      if (answer === false || answer === null || answer === undefined) return;
      reason = String(answer).trim() || null;
    } else if (notice && !await confirm(notice)) {
      return;
    }
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
      const { data } = await api.post(`/tournaments/${id}/status`, reason ? { status, force: forceStart, reason } : { status, force: forceStart });
      const label = TOURNAMENT_STATUS_OPTIONS.find(([value]) => value === status)?.[1] || status;
      toast.success(status === "cancelled" && Number.isFinite(data?.notified)
        ? `Status: ${label} – ${data.notified === 1 ? "1 Person benachrichtigt" : `${data.notified} Personen benachrichtigt`}.`
        : `Status: ${label}`);
      // Punkte in einer abgeschlossenen Jahreswertung bleiben unverändert (#2123) - das sagt der Server dazu.
      if (data?.season_points_note) toast.info(data.season_points_note, { duration: 10000 });
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
    // Neue Gruppen löschen die Spiele der Gruppenphase (#2120, TA10) - mit Ergebnissen nur nach der Rückfrage mit Zahl.
    const data = await runConfirmed(
      async (force) => (await api.post(`/tournaments/${id}/groups/generate${force ? "?force=true" : ""}`, { group_count: groupCount })).data,
      { title: "Gruppen neu generieren?", confirmLabel: "Neu generieren", failure: "Gruppen konnten nicht generiert werden." },
    );
    if (!data) return;
    toast.success(`${data.group_count} Gruppen mit ${data.match_count} Spielen`);
    load();
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
  // Letzte Schweizer Runde zurücknehmen (#2120, TA11): solange keines ihrer Spiele begonnen hat.
  const undoSwissRound = async (info) => {
    const ok = await confirm({
      title: `Runde ${info.round} zurücknehmen?`,
      description: `Die ${info.count === 1 ? "1 Paarung" : `${info.count} Paarungen`} von Runde ${info.round} werden gelöscht. Danach erzeugt „Schweizer Runde“ die Runde neu.`,
      confirmLabel: "Runde zurücknehmen",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const { data } = await api.post(`/tournaments/${id}/swiss/undo-round`);
      toast.success(`Runde ${data.round} zurückgenommen.`);
      load();
    } catch (e) {
      toast.error(formatRequestError(e, "Die Runde konnte nicht zurückgenommen werden."));
    }
  };

  if (!t) return (
    <AdminLayout>
      {loadError
        ? <div className="p-10 text-[#FF3B30]" data-testid="admin-tr-load-error">{loadError}</div>
        : <div className="p-10"><SkeletonDetailHeader label="Lade Turnier" /></div>}
    </AdminLayout>
  );
  // Ergebnisse und Termine je Spiel (#1353): turnierweit oder nur für die Spiele, die der Einsatz abdeckt.
  const resultsOpen = ["live", "paused"].includes(t.status);
  const rightsForMatch = (match) => {
    const rights = matchRights(t, match);
    return { plan: rights.plan, results: resultsOpen && rights.results };
  };
  // Liga-Staffel (#2109): nur, was die Liga braucht - Season-Werte lesend, keine Anmeldung, kein Check-in.
  const staffel = isStaffel(t);
  const availableTabs = [
    ["participants", "Teilnehmer"],
    // Eine Liga hat keinen Baum (#2109, S16): der Reiter zeigt den Weg zu Tabelle und Spielplan.
    ["bracket", t.format === "league" ? "Tabelle" : "Turnierbaum"],
    // Matchplan (#1557): Zeitleiste je Station, Vorschau, Ziehen, live. Die Spiele mit Ergebnissen und Phasen bleiben
    // im Reiter „Spiele“ (Adresse ?tab=stages bleibt gleich).
    ["matchplan", "Matchplan"],
    ["stages", "Spiele"],
    ...(t.format === "groups" ? [["groups", "Gruppen"]] : []),
    // Map-Pool (#1616): nur mit Spiel und für Strukturrollen - ein maploser Cup bekommt keinen Reiter.
    ...(t.game_id && t.can_manage_structure ? [["maps", "Maps"]] : []),
    ...(isTournamentLead ? [["staff", "Team"]] : []),
    // Rückmeldungen (#1196): erst, wenn das Turnier vorbei ist - ohne Namen.
    ...(["completed", "results_published", "archived"].includes(t.status) ? [["feedback", "Rückmeldungen"]] : []),
    // Bearbeiten speichert per PATCH - das darf nur die Turnierleitung über alle Turniere (#1353, `require_admin`).
    ...(isTournamentLead ? [["edit", "Bearbeiten"]] : []),
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
  const primaryAction = primaryTournamentAction(t.status, t);
  // Steht der Baum (#2120)? Dann bleiben Format und Teilnahme, Vorschau-Knöpfe und das Entfernen von Teilnehmern im
  // festen Baum weg - der Server lehnt es ohnehin ab.
  const structureFixed = bracketFixed(t, matchesV2);
  const inFixedBracket = fixedRegistrationIds(matchesV2);
  const tournamentOver = FINISHED_STATUSES.has(t.status) || t.status === "cancelled";
  const swissUndo = t.format === "swiss" && !tournamentOver && !t.locked_at ? swissUndoInfo(matchesV2) : null;
  // Staffel (S18): kein Check-in, kein Auschecken, kein „Nicht erschienen“ - das löste sogar den Season-Schlüssel des
  // Co-Teams. Austritt und Disqualifikation gehen über ParticipantRemovalActions.
  const checkInTools = Boolean(t.can_check_in) && !staffel;
  const canOperateTournament = isTournamentLead || !!t.can_manage_structure;
  const visibleStatusOptions = (isTournamentLead
    ? TOURNAMENT_STATUS_OPTIONS
    : TOURNAMENT_STATUS_OPTIONS.filter(([value]) => OPERATIONAL_STATUS_VALUES.has(value)))
    // Staffel (S1): keine Anmeldung, kein Check-in - ein Check-in ließe sie ohne Teams und Spiele zurück.
    .filter(([value]) => !staffel || STAFFEL_STATUS_VALUES.has(value));
  // Werkzeuge: braucht man gelegentlich, nicht bei jedem Blick auf die Seite.
  // "Zurücksetzen" steht bewusst zuletzt und rot, weil es den Baum verwirft.
  const canLockTournament = isTournamentLead && ["completed", "results_published", "archived", "cancelled"].includes(t.status);
  const toolActions = [
    t.can_assign_stations && stations.length > 0 && (
      <button key="stations" type="button" onClick={() => selectTab("matchplan")} data-testid="admin-tr-plan-schedule" className="px-3 py-2 border border-[#29B6E8]/50 text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm text-xs hover:bg-[#29B6E8]/10 inline-flex items-center gap-2">
        <Zap className="w-3.5 h-3.5" /> Planen
      </button>
    ),
    t.can_use_staff_tools && (
      <button key="planning" type="button" onClick={() => runPlanningCheck()} data-testid="admin-tr-planning-check" className="px-3 py-2 border border-[#FFD700]/50 text-[#FFD700] font-bold uppercase tracking-wider rounded-sm text-xs hover:bg-[#FFD700]/10 inline-flex items-center gap-2">
        <Eye className="w-3.5 h-3.5" /> Planung prüfen
      </button>
    ),
    canLockTournament && (
      <button key="lock" type="button" onClick={() => setTournamentLock(!t.locked_at)} data-testid="admin-tr-lock" className={`px-3 py-2 border font-bold uppercase tracking-wider rounded-sm text-xs ${t.locked_at ? "border-[#00FF88]/40 text-[#00FF88] hover:bg-[#00FF88]/10" : "border-[#FFD700]/50 text-[#FFD700] hover:bg-[#FFD700]/10"}`}>
        {t.locked_at ? "Entsperren" : "Sperren"}
      </button>
    ),
    // Nach dem Ende bleibt der Baum (#2120): daran hängen Platzierungen, Punkte und Gewinne.
    t.can_manage_structure && !staffel && !FINISHED_STATUSES.has(t.status) && (
      <button key="reset" type="button" onClick={reset} data-testid="admin-tr-reset" className="px-3 py-2 border border-[#FF3B30]/40 text-[#FF3B30] font-bold uppercase tracking-wider rounded-sm text-xs hover:bg-[#FF3B30]/10 inline-flex items-center gap-2">
        <RefreshCw className="w-3.5 h-3.5" /> Zurücksetzen
      </button>
    ),
    // Staffel (S15): vor dem Start mischt sich die Vorschau neu; nach dem Start löschte „Zurücksetzen“ alle Spiele samt
    // Ergebnissen - das gibt es für eine Staffel nicht.
    t.can_manage_structure && staffel && staffelBeforeStart(t) && (
      <button key="remix" type="button" onClick={() => rebuildFromFormat({ preview: true, force: true, keepStage: true })} data-testid="admin-tr-remix" className="tls-btn tls-btn--secondary px-3 py-2 font-bold uppercase tracking-wider rounded-sm text-xs inline-flex items-center gap-2">
        <RefreshCw className="w-3.5 h-3.5" /> Vorschau neu mischen
      </button>
    ),
  ].filter(Boolean);
  const downloadActions = [
    { key: "participants", href: `${API}/exports/tournaments/${t.id}/participants.pdf`, label: "PDF Teilnehmer" },
    // Staffel (S20): keine Anmeldung, kein Check-in.
    !staffel && { key: "checkin", href: `${API}/exports/tournaments/${t.id}/checkin.pdf`, label: "PDF Check-in" },
    !staffel && { key: "registration-qr", href: `${API}/exports/tournaments/${t.id}/registration-qr.pdf`, label: "PDF Anmeldung QR", highlight: true },
    { key: "matches", href: `${API}/exports/tournaments/${t.id}/matches.pdf`, label: "PDF Spiele" },
    t.can_use_staff_tools && { key: "match-plan", href: `${API}/tournaments/${t.id}/match-plan.csv`, label: "CSV Matchplan" },
  ].filter(Boolean);

  return (
    <AdminLayout>
      <div className="mb-6 space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <Link to="/admin/tournaments" className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8] hover:text-white">← Turniere</Link>
            <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 break-words">{t.title}</h1>
            {/* Staffel (S24, L-C1): woher sie kommt - Liga N, Staffel, Season öffnen, Ligaseite. */}
            <StaffelHeaderLine tournament={t} />
            <div className="mt-2 flex items-center gap-3 flex-wrap">
              <StatusBadge status={t.status} />
              {t.locked_at && <span className="px-2 py-1 border border-[#FFD700]/40 text-[#FFD700] text-[10px] font-bold uppercase tracking-widest rounded-sm">Gesperrt</span>}
              <span className="text-white/60 text-sm">{formatTournamentDisplay(t)}</span>
              <Link to={`/tournaments/${t.slug || t.id}`} target="_blank" className="text-[#29B6E8] text-xs uppercase tracking-wider font-bold hover:text-white inline-flex items-center gap-1"><Eye className="w-3 h-3" /> Öffentliche Seite</Link>
              {/* TV & Beamer (#1110): der Link für den Hallen-Bildschirm, Turnier schon gewählt. */}
              <Link to={`/admin/tv?view=bracket&target=${encodeURIComponent(t.id)}`} data-testid="tournament-tv-link" className="text-[#29B6E8] text-xs uppercase tracking-wider font-bold hover:text-white inline-flex items-center gap-1"><Tv className="w-3 h-3" /> TV-Link</Link>
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
            {isTournamentLead && t.format === "swiss" && !tournamentOver && (
              <button type="button" onClick={generateSwissRound} data-testid="admin-tr-swiss-next" className="px-4 py-2 border border-[#29B6E8] text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm text-sm hover:bg-[#29B6E8]/10">Schweizer Runde</button>
            )}
            {isTournamentLead && swissUndo && (
              <button type="button" onClick={() => undoSwissRound(swissUndo)} data-testid="admin-tr-swiss-undo" className="tls-btn tls-btn--secondary px-4 py-2 font-bold uppercase tracking-wider rounded-sm text-sm">Runde {swissUndo.round} zurücknehmen</button>
            )}
            {isTournamentLead && t.format === "groups" && !tournamentOver && (
              <button type="button" onClick={generateGroups} data-testid="admin-tr-groups" className="px-4 py-2 border border-[#29B6E8] text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm text-sm hover:bg-[#29B6E8]/10">Gruppen generieren</button>
            )}
            {canOperateTournament && (
              <div>
                <select value={t.status} onChange={(e) => setTournStatus(e.target.value)} data-testid="admin-tr-status-select" className="bg-[#0A0A0A] border border-white/10 px-3 py-2 text-sm rounded-sm">
                  {!visibleStatusOptions.some(([value]) => value === t.status) && <option key={t.status} value={t.status}>{TOURNAMENT_STATUS_OPTIONS.find(([value]) => value === t.status)?.[1] || t.status}</option>}
                  {visibleStatusOptions.map(([s, label]) => <option key={s} value={s}>{label}</option>)}
                </select>
                <div className="mt-1 max-w-[16rem] text-[10px] text-white/40">Operativ durch Turnierleitung; Zeitautomatik nur wenn ausdrücklich aktiviert.</div>
                {/* „Pause bis“ (#1123): nur beim Status „Pausiert“ - der TV zählt bis dahin herunter. */}
                <PauseUntilControl tournament={t} onSaved={load} />
              </div>
            )}
          </div>
        </div>

        {/* Läufe umbauen (#1550): der Vorschlag des Servers, solange er offen ist - über allen Reitern sichtbar. */}
        <HeatRebuildBar tournament={t} onDecided={load} />

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

      {/* Liga-Staffeln (#2096) haben keine Vor-Ort-Anmeldung - die Co-Teams teilt die Turnierleitung zu. */}
      {isTournamentLead && !t.league_context && <div className="mb-5"><OnsiteAccessPanel tournamentId={t.id} /></div>}
      {/* Staffel (S21): Zugangslinks nur zum Ansehen - angemeldet wird nicht, Co-Teams werden zugeteilt. */}
      {isTournamentLead && <div className="mb-5"><AccessLinksPanel targetType="tournament" targetId={t.id} allowRegister={!staffel} collapsible /></div>}

      <TournamentFlowStepper
        tournament={t}
        registrations={regs}
        matchesV2={matchesV2}
        onNavigate={(key) => selectTab(key)}
      />

      <div className="flex gap-2 mb-5 border-b border-white/10 tls-swipe pb-0">
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
        {/* Liga (#1649): Co-Teams teilt die Turnierleitung von Hand zu - Hauptteam, dann Co-Team, mit allen Prüfungen. */}
        {isTournamentLead && canAssignSquads(t) && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-white/10 bg-[#121212] p-4">
            {/* T9 (#2109): nur in einer Staffel sind Co-Teams die Teilnehmer; ein Turnier im Format Liga nimmt auch ganze Teams. */}
            <p className="min-w-0 flex-1 text-sm text-white/60" data-testid="admin-tr-squad-hint">
              {staffel
                ? "Teilnehmer dieser Liga sind Co-Teams. Captain und Vertreter vergibt die Teamleitung im Profil."
                : "Optional: Co-Team zuteilen – Teams melden sich hier auch als ganzes Team an. Captain und Vertreter eines Co-Teams vergibt die Teamleitung im Profil."}
            </p>
            <SquadAssignDialog tournament={t} onAssigned={load} />
          </div>
        )}
        {/* Staffel (S19, L-D4): kein ganzes Hauptteam an den Co-Team-Prüfungen vorbei - nur „Co-Team zuteilen“. */}
        {t.can_manage_participants && !staffel && (
          <ParticipantAddForm
            form={participantForm}
            tournament={t}
            person={participantPerson}
            onPerson={setParticipantPerson}
            teams={teams}
            teamsError={teamsError}
            noShowRegistrations={regs.filter((r) => r.status === "no_show")}
            onChange={setParticipantField}
            onSubmit={addParticipant}
          />
        )}
        <div className={`grid gap-3 ${staffel ? "lg:grid-cols-[minmax(0,1fr)_auto]" : "lg:grid-cols-[minmax(0,1fr)_16rem_auto]"}`}>
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
          {/* Staffel (S18): keine Warteliste, kein Check-in - ein Filter nach Anmeldestatus hat nichts zu filtern. */}
          {!staffel && (
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
          )}
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
                    <EventGateMark mark={r.event_gate} />
                    <LineupMark info={lineups[r.id]} /><OnsiteMark via={r.registered_via} />
                  </div>
                  <RegistrationBadge status={r.status} staffel={staffel} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {isTournamentLead && !staffel && (
                    <select value={r.status} onChange={(e) => setRegStatus(r.id, e.target.value)} data-testid={`admin-reg-status-mobile-${r.id}`} className="col-span-2 bg-[#0A0A0A] border border-white/10 px-2 py-2 text-xs rounded-sm">
                      <RegistrationStatusOptions fixed={inFixedBracket.has(r.id)} current={r.status} />
                    </select>
                  )}
                  {checkInTools && r.status !== "checked_in" && !["rejected", "waitlist"].includes(r.status) && (
                    <button type="button" onClick={() => setRegCheckinStatus(r.id, "checked_in")} className="px-2 py-2 border border-[#00FF88]/40 text-[#00FF88] rounded-sm text-[10px] font-bold uppercase">Check-in</button>
                  )}
                  {checkInTools && r.status === "checked_in" && (
                    <button type="button" onClick={() => setRegCheckinStatus(r.id, "approved")} className="px-2 py-2 border border-white/20 text-white/70 rounded-sm text-[10px] font-bold uppercase">Auschecken</button>
                  )}
                  {checkInTools && !["checked_in", "rejected", "waitlist", "no_show"].includes(r.status) && (
                    <button type="button" onClick={() => setRegCheckinStatus(r.id, "no_show")} className="px-2 py-2 border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm text-[10px] font-bold uppercase">Nicht erschienen</button>
                  )}
                  <ParticipantRemovalActions tournament={t} registration={r} onDone={load} compact />
                  {t.can_manage_participants && !inFixedBracket.has(r.id) && (
                    <button type="button" onClick={() => deleteParticipant(r)} className="px-2 py-2 border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm text-[10px] font-bold uppercase hover:bg-[#FF3B30]/10">Entfernen</button>
                  )}
                </div>
              </div>
            ))}
            {filteredRegistrations.length === 0 && <div className="text-center py-10 text-white/40">{regs.length === 0 ? "Keine Anmeldungen" : "Keine Anmeldungen für diesen Filter"}</div>}
          </div>
          <div className="hidden md:block tls-swipe pb-0">
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
                  <td className="px-4 py-3">{r.display_name || r.user?.display_name || r.ingame_name}<EventGateMark mark={r.event_gate} /><LineupMark info={lineups[r.id]} /><OnsiteMark via={r.registered_via} /></td>
                  <td className="px-4 py-3"><RegistrationBadge status={r.status} staffel={staffel} /></td>
                  <td className="px-4 py-3 text-white/60">{r.discord || "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      {isTournamentLead && !staffel && (
                        <select value={r.status} onChange={(e) => setRegStatus(r.id, e.target.value)} data-testid={`admin-reg-status-${r.id}`} className="bg-[#0A0A0A] border border-white/10 px-2 py-1 text-xs rounded-sm">
                          <RegistrationStatusOptions fixed={inFixedBracket.has(r.id)} current={r.status} />
                        </select>
                      )}
                      {checkInTools && r.status !== "checked_in" && !["rejected", "waitlist"].includes(r.status) && (
                        <button type="button" onClick={() => setRegCheckinStatus(r.id, "checked_in")} className="px-2 py-1 border border-[#00FF88]/40 text-[#00FF88] rounded-sm text-[10px] font-bold uppercase">Check-in</button>
                      )}
                      {checkInTools && r.status === "checked_in" && (
                        <button type="button" onClick={() => setRegCheckinStatus(r.id, "approved")} className="px-2 py-1 border border-white/20 text-white/70 rounded-sm text-[10px] font-bold uppercase">Auschecken</button>
                      )}
                      {checkInTools && !["checked_in", "rejected", "waitlist", "no_show"].includes(r.status) && (
                        <button type="button" onClick={() => setRegCheckinStatus(r.id, "no_show")} className="px-2 py-1 border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm text-[10px] font-bold uppercase">Nicht erschienen</button>
                      )}
                      <ParticipantRemovalActions tournament={t} registration={r} onDone={load} />
                      {t.can_manage_participants && !inFixedBracket.has(r.id) && (
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
          {/* Sponsor je Runde (#1125): „Runde 2 präsentiert von“ am Turnierbaum-TV. */}
          {canOperateTournament && (bracket.matches_v2?.length || 0) > 0 ? (
            <RoundSponsorsPanel tournament={t} matches={bracket.matches_v2} stages={bracket.stages || stages} onSaved={load} />
          ) : null}
        </div>
      )}

      {activeTab === "stages" && (
        <TournamentStagesPanel
          tournamentId={t.id}
          stages={stages}
          matches={matchesV2}
          registrations={regs}
          stations={stations}
          canEditSettings={Boolean(t.can_manage_structure)}
          canManageStructure={Boolean(t.can_manage_structure)}
          onChanged={load}
          onOpenMatchplan={() => selectTab("matchplan")}
          rightsForMatch={rightsForMatch}
          tournament={t}
          durationGame={bracket?.duration_game || null}
          bracketFixed={structureFixed}
        />
      )}
      {activeTab === "matchplan" && (
        <MatchPlanPanel
          tournament={t}
          matches={matchesV2}
          stages={stages}
          stations={stations}
          registrations={regs}
          durationGame={bracket?.duration_game || null}
          canEditSettings={isTournamentLead}
          onChanged={loadSafely}
        />
      )}
      {/* Staffel (S22): den Pool pflegt die Season - jedes Übertragen ersetzt ihn, eine Änderung hier ginge verloren. */}
      {activeTab === "maps" && staffel && (
        <div className="mb-4 rounded-sm border border-[#29B6E8]/20 bg-[#29B6E8]/5 p-3" data-testid="staffel-maps-note">
          <SeasonSourceNote tournament={t}>Den Map-Pool pflegt die Season – dort ändern und übertragen.</SeasonSourceNote>
        </div>
      )}
      {activeTab === "maps" && <MapPoolPanel tournamentId={t.id} canEdit={Boolean(t.can_manage_structure) && !staffel} />}
      {activeTab === "edit" && isTournamentLead && (
        <TournamentEditForm
          key={t.updated_at || t.id}
          tournament={t}
          stages={stages}
          onSaved={load}
          onRebuildFromFormat={rebuildFromFormat}
          structureFixed={structureFixed}
        />
      )}
      {activeTab === "feedback" && (
        <div className="border border-white/10 rounded-sm bg-[#121212] p-5" data-testid="admin-tournament-feedback">
          <FeedbackReport kind="tournament" targetId={t.id} />
        </div>
      )}

      {activeTab === "staff" && isTournamentLead && (
        <TournamentStaffPanel tournamentId={t.id} staff={staff} staffError={staffError} onChanged={load} />
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

// Status je Anmeldung. Im festen Baum (#2120, TA13) nehmen Ausstehend, Abgelehnt und Warteliste die Person aus Spielen,
// die sie behalten - das geht über „Nicht erschienen“, „Austritt eintragen“ oder „Disqualifizieren“.
const REGISTRATION_ROW_STATUSES = ["pending", "approved", "rejected", "waitlist", "checked_in", "no_show"];
const LEAVES_BRACKET = new Set(["pending", "rejected", "waitlist"]);
function RegistrationStatusOptions({ fixed, current }) {
  return REGISTRATION_ROW_STATUSES.map((s) => (
    <option key={s} value={s} disabled={fixed && s !== current && LEAVES_BRACKET.has(s)}>{formatRegistrationStatus(s)}</option>
  ));
}

// Staffel (#2109, S18): ein Co-Team ist zugeteilt, nicht „angenommen“ oder „eingecheckt“ - Austritt und
// Disqualifikation zeigt das gewohnte Schild.
function RegistrationBadge({ status, staffel }) {
  if (staffel && ["approved", "checked_in"].includes(status)) {
    return <span data-testid="status-assigned" className="inline-flex items-center gap-1 font-bold uppercase tracking-wider border rounded-sm text-[10px] px-2 py-[3px] bg-ok/15 text-ok border-ok/50">Zugeteilt</span>;
  }
  return <StatusBadge status={status} />;
}

// Turnier nur mit Event-Anmeldung (#875): ob die Event-Anmeldung (noch) reicht - nur für die Turnierleitung.
function EventGateMark({ mark }) {
  if (!mark) return null;
  return <div className={`mt-1 text-[11px] ${mark.ok ? "text-white/40" : "text-[#FFD700]"}`} data-testid="admin-reg-event-gate">{mark.label}</div>;
}
