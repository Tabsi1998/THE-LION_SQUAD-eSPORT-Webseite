import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { AddToCalendarButton } from "../../components/AddToCalendarButton";
import { tournamentIsOver } from "../../lib/afterEnd";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { FormInput } from "../../components/FormInput";
import { ErrorState, PartialLoadNotice, SkeletonList, loadProblem, type LoadProblem } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { StatusBadge } from "../../components/StatusBadge";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { api, errorMessage } from "../../lib/api";
import { formatDate, formatDateTime, formatStatus, formatTournamentFormat, formatWhen } from "../../lib/format";
import { stationText } from "../../lib/matchText";
import { describeSlot, finderFor, isMatchDone, plannedText } from "../../lib/slotSource";
import type { BracketMatch } from "../../lib/bracketGraph";
import { motionPlan, wonJustNow, type MotionPlan } from "../../lib/bracketMotion";
import { playMoment } from "../../lib/tournamentHaptics";
import { checkInState, matchStatusText, standingsTables, treeKind } from "../../lib/tournamentView";
import { BracketCanvas } from "../../components/tournament/bracket/BracketCanvas";
import { ScheduleList } from "../../components/tournament/ScheduleList";
import { StandingsTables } from "../../components/tournament/StandingsTables";
import { getRegistrationState } from "../../lib/registration";
import { TeamDayCard } from "../../components/tournament/TeamDayCard";
import { ResultShareCard } from "../../components/ResultShareCard";
import { basisLabel, formatCents, ownPriceLine, quoteTotal, startFeeSummary } from "../../lib/startFee";
import { isGuestUser } from "../../live";
import { FriendsAtEventCard } from "../../components/FriendsAtEventCard";
import { offerFriendsHint } from "../../lib/friendsHint";
import { openSignIn } from "../../navigation/rootNavigation";
import { useLiveRefresh } from "../../realtime/LiveChangesProvider";
import type { TournamentStackParamList } from "../../navigation/types";
import { colors, radius } from "../../theme";
import type { Team, Tournament, User } from "../../types";
import { useSeasonOverlay } from "../../seasons/anchors";
import { useShareHeader } from "../../components/HeaderActions";
import { sharePage } from "../../lib/share";
import { idSegment } from "../../lib/apiIds";
import { useKeyedLoad } from "../../lib/useKeyedLoad";

const TOURNAMENT_LIVE_RESOURCES = ["tournaments", "matches", "matches-v2", "teams"];

type Props = NativeStackScreenProps<TournamentStackParamList, "TournamentDetail">;
type TabKey = "overview" | "bracket" | "matches" | "standings" | "participants" | "rules";
type BracketPayload = {
  tournament?: Tournament;
  matches_v2?: any[];
  stages?: any[];
  registrations?: any[];
  engine?: string;
};
type RegistrationPayload = {
  player_ids?: Record<string, string>;
  team_id?: string | null;
  // Startgeld (#319): wer anmeldet, übernimmt es - der Server verlangt die Bestätigung.
  accept_costs?: boolean;
  selected_positions?: string[];
};

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Info" },
  { key: "bracket", label: "Baum" },
  { key: "matches", label: "Matches" },
  { key: "standings", label: "Tabelle" },
  { key: "participants", label: "Spieler" },
  { key: "rules", label: "Regeln" },
];
const OPEN_MATCH_STATUSES = new Set(["ready", "scheduled", "in_progress", "waiting_result"]);
const FINISHED_TOURNAMENT_STATUSES = new Set(["completed", "results_published", "archived"]);
const CLOSED_MATCH_STATUSES = new Set(["completed", "forfeit", "closed"]);

/** Was die Turnierseite lädt; `partProblem`, wenn Bracket, Tabelle oder Anmeldungen nicht kamen (#1000). */
type TournamentPage = { tournament: Tournament; bracket: BracketPayload; standings: any[]; myTeams: Team[]; partProblem: LoadProblem | null };
const NO_BRACKET: BracketPayload = {};
const NO_ROWS: any[] = [];
const NO_TEAMS: Team[] = [];

export function TournamentDetailScreen({ navigation, route }: Props) {
  const { user } = useAuth();
  const signedInId = user && !isGuestUser(user) ? user.id : null;
  const signedInRef = useRef(signedInId);
  signedInRef.current = signedInId;
  // Laden je Kennung (#1000): ein anderes Turnier zeigt nie das vorige, verspätete Antworten werden verworfen. Bracket,
  // Tabelle und Anmeldungen sind Teile: kommt einer nicht, behält er seinen letzten Stand, und die Seite sagt es.
  const fetchTournament = useCallback(async (id: string, previous: TournamentPage | null): Promise<TournamentPage> => {
    const segment = idSegment(id);
    const [detailResult, bracketResult, standingsResult, registrationsResult, teamsResult] = await Promise.allSettled([
      api.get<Tournament>(`/tournaments/${segment}`),
      api.get<BracketPayload>(`/tournaments/${segment}/bracket`),
      api.get<any[]>(`/tournaments/${segment}/standings`),
      api.get<any[]>(`/tournaments/${segment}/registrations`),
      signedInRef.current ? api.get<Team[]>("/teams/my") : Promise.resolve({ data: [] as Team[] }),
    ]);
    if (detailResult.status === "rejected") throw detailResult.reason;
    // Auch die eigenen Teams sind ein Teil: kommen sie nicht, bleibt ihr letzter Stand, und die Seite sagt es.
    const failed = [bracketResult, standingsResult, registrationsResult, teamsResult].find((result): result is PromiseRejectedResult => result.status === "rejected");
    const bracketData = bracketResult.status === "fulfilled" ? bracketResult.value.data || {} : previous?.bracket || {};
    const registrations = registrationsResult.status === "fulfilled"
      ? (Array.isArray(registrationsResult.value.data) ? registrationsResult.value.data : bracketData.registrations || [])
      : previous?.bracket.registrations || bracketData.registrations || [];
    const standings = standingsResult.status === "fulfilled" ? (Array.isArray(standingsResult.value.data) ? standingsResult.value.data : []) : previous?.standings || [];
    const myTeams = teamsResult.status === "fulfilled" ? (Array.isArray(teamsResult.value.data) ? teamsResult.value.data : []) : previous?.myTeams || [];
    return { tournament: detailResult.value.data, bracket: { ...bracketData, registrations }, standings, myTeams, partProblem: failed ? loadProblem(failed.reason) : null };
  }, []);
  const { data: page, loading, error: loadError, problem, stale, reload: load } = useKeyedLoad(route.params.id, fetchTournament);
  const tournament = page?.tournament;
  const bracket = page?.bracket ?? NO_BRACKET;
  const standings = page?.standings ?? NO_ROWS;
  const myTeams = page?.myTeams ?? NO_TEAMS;
  // Nachladen gescheitert oder ein Teil fehlt (#1000): der Stand ist ausdrücklich der letzte.
  const notice = (stale ? problem : null) || page?.partProblem || null;
  // An- oder abgemeldet: das Turnier neu laden (eigene Anmeldung, eigene Teams) - nicht beim ersten Öffnen.
  const firstSignedIn = useRef(signedInId);
  useEffect(() => {
    if (firstSignedIn.current === signedInId) return;
    firstSignedIn.current = signedInId;
    void load();
  }, [load, signedInId]);
  // Teilen oben rechts (#1154): die Adresse der Website - in der App öffnet sie diesen Screen, sonst die Website.
  const share = useMemo(() => (tournament ? () => { void sharePage({ kind: "tournament", id: String(tournament.slug || tournament.id), title: tournament.title, start: tournament.start_date, end: tournament.end_date }); } : null), [tournament]);
  useShareHeader(navigation, share);
  const [registerModal, setRegisterModal] = useState(false);
  const [tab, setTab] = useState<TabKey>("overview");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const guest = isGuestUser(user);


  // Zurück vom Event (#1184): nach Event-Anmeldung und „Spielst du auch mit?“ hat sich der Stand geändert - beim
  // Wiederkommen frisch laden (nur nach einem Weggehen; das erste Öffnen lädt der Effekt oben).
  // Sichtbar? Nur dann bewegt sich der Baum und vibriert ein Sieg (#1563) - verdeckt gibt es kein Nachholen.
  // Der Screen bleibt im Stack gemountet (Codex-Befund #1586): verdeckt kein Live-Abo und kein 10-s-Nachladen; beim
  // Zurückkommen lädt er einmal sofort frisch. Fokus über die Listener statt useIsFocused - gleiche Wirkung, auch ohne
  // Navigations-Container (Tests).
  const focusedRef = useRef(true);
  const [focused, setFocused] = useState(true);
  useEffect(() => {
    let away = false;
    const offBlur = navigation.addListener?.("blur", () => { away = true; focusedRef.current = false; setFocused(false); });
    const offFocus = navigation.addListener?.("focus", () => {
      focusedRef.current = true;
      setFocused(true);
      if (!away) return;
      away = false;
      void load();
    });
    return () => {
      offBlur?.();
      offFocus?.();
    };
  }, [load, navigation]);
  useLiveRefresh(load, TOURNAMENT_LIVE_RESOURCES, { enabled: focused, fallbackMs: 10000 });

  const registrations = bracket.registrations || [];
  const myTeamIds = useMemo(() => new Set(myTeams.map((team) => team.id).filter(Boolean)), [myTeams]);
  const ownRegistration = useMemo(() => {
    if (tournament?.my_registration?.id) return tournament.my_registration;
    return registrations.find((registration) => registration.is_mine || registration.user_id === user?.id || (registration.team_id && myTeamIds.has(registration.team_id)));
  }, [myTeamIds, registrations, tournament?.my_registration, user?.id]);
  const registered = Boolean(ownRegistration?.id && !["cancelled", "rejected", "no_show"].includes(String(ownRegistration.status || "")));
  // Ausgeschieden (#1553): Austritt oder Disqualifikation über die Turnierleitung - ein klarer Satz statt „angemeldet“.
  const ownOut = ["withdrawn", "disqualified"].includes(String(ownRegistration?.status || ""));
  const registration = useMemo(() => getRegistrationState(tournament, "Anmeldung"), [tournament]);
  const isTeamTournament = Boolean(tournament && (tournament.team_mode || "solo") !== "solo");
  const gameFields = useMemo(() => tournament?.game?.effective_player_id_fields || tournament?.game?.player_id_fields || [], [tournament?.game]);
  const manageableTeams = useMemo(() => myTeams.filter((team) => team.can_manage || ["leader", "co_leader"].includes(String(team.my_role || ""))), [myTeams]);
  const myRegTeam = ownRegistration?.team_id ? myTeams.find((team) => team.id === ownRegistration.team_id) : null;
  const canManageOwnRegistration = Boolean(
    ownRegistration &&
      (!ownRegistration.team_id ||
        ownRegistration.user_id === user?.id ||
        myRegTeam?.can_manage ||
        ["leader", "co_leader"].includes(String(myRegTeam?.my_role || ""))),
  );
  const clubMemberBlocked = Boolean(user?.is_club_member && tournament?.block_club_member_registration);
  // Turnier nur mit Event-Anmeldung (#875): einzeln geht es zuerst zum Event; bei Teams prüft der Server die Mitglieder.
  const eventGate = tournament?.event_gate || null;
  const eventBlocked = Boolean(eventGate && !isTeamTournament && !eventGate.registered);
  const canSelfRegister = Boolean(!guest && !registered && registration.canRegister && !clubMemberBlocked && !eventBlocked);
  // Vor Ort checkt die Turnierleitung ein (#1135) - wie im Web: kein Knopf, sondern der Hinweis mit dem Zeitfenster.
  const staffOnlyCheckIn = String(tournament?.event_mode || "online") === "local";
  // Check-in-Ende (#1551, #1574): ist er vorbei, nimmt der Server nichts mehr an (409) - dann kein Knopf, sondern der Satz.
  const checkInNow = checkInState(tournament);
  const canCheckIn = Boolean(!staffOnlyCheckIn && canManageOwnRegistration && ownRegistration?.status === "approved" && checkInNow.open);
  const checkInOver = Boolean(!staffOnlyCheckIn && ownRegistration?.status === "approved" && checkInNow.over && ["check_in", "live", "paused"].includes(String(tournament?.status || "")));
  const checkInWindow = [
    tournament?.check_in_from ? `ab ${formatDateTime(tournament.check_in_from)}` : "",
    tournament?.check_in_until ? `bis ${formatDateTime(tournament.check_in_until)}` : "",
  ].filter(Boolean).join(" ");
  const canSelfUnregister = Boolean(
    registered &&
      canManageOwnRegistration &&
      !["checked_in", "no_show", "rejected"].includes(String(ownRegistration?.status || "")) &&
      !["live", "paused", "completed", "results_published", "archived"].includes(String(tournament?.status || "")),
  );
  const regMap = useMemo(() => {
    const map = new Map<string, any>();
    registrations.forEach((registration) => map.set(registration.id, registration));
    return map;
  }, [registrations]);
  const allMatches = (bracket.matches_v2 || NO_ROWS) as BracketMatch[];
  const stages = bracket.stages || NO_ROWS;
  const kind = treeKind(stages, tournament?.format, allMatches);
  const nameOf = useCallback((id: string) => participantLabel(regMap.get(id)), [regMap]);
  const statusOf = useCallback((id: string) => String(regMap.get(id)?.status || ""), [regMap]);
  const statusById = useMemo(() => new Map(registrations.map((row) => [row.id, String(row.status || "")])), [registrations]);
  const tables = useMemo(() => standingsTables(standings, tournament?.format, ownRegistration?.id || null, statusById), [ownRegistration?.id, standings, statusById, tournament?.format]);
  const openMatch = useCallback((id: string) => navigation.navigate("MatchDetail", { id }), [navigation]);
  // Bewegung und Sieger-Moment (#1563, #1168): aus dem Vergleich alter/neuer Stand beim Live-Nachladen - genau einmal,
  // nur sichtbar (Seite im Vordergrund, App aktiv, Baum offen), kein Nachholen beim ersten Stand. Auslosung als Moment
  // (#1633): `seenMoments` merkt sich jede Bewegung und jeden Topf über alle Stände - kommt derselbe Wechsel noch einmal
  // (Nachladen, Neuverbindung), läuft er nicht ein zweites Mal.
  const previousMatches = useRef<BracketMatch[] | null>(null);
  const seenMoments = useRef(new Set<string>());
  const [plan, setPlan] = useState<MotionPlan | null>(null);
  const [crowned, setCrowned] = useState(false);
  const tabRef = useRef<TabKey>("overview");
  useEffect(() => {
    const before = previousMatches.current;
    if (!bracket.matches_v2 || before === allMatches) return undefined;
    previousMatches.current = allMatches;
    if (!before) return undefined;
    const visible = focusedRef.current && AppState.currentState !== "background";
    const next = motionPlan(before, allMatches, { active: visible, seen: seenMoments.current });
    if (next && tabRef.current === "bracket") setPlan(next);
    if (visible && wonJustNow(before, allMatches, ownRegistration?.id, stages)) {
      setCrowned(true);
      return playMoment("win");
    }
    // Dein Weiterkommen (Fabian, 14.10.): einmal kurz - im selben Moment, in dem dein Name in die nächste Runde gleitet.
    const mine = ownRegistration?.id;
    if (mine && next && [...next.rows.values()].some((rows) => rows.get(mine)?.type === "advance" || rows.get(mine)?.type === "draw")) return playMoment("advance");
    // Auslosung im offenen Baum (#1633): Topf bereit, Runde ausgelost, Platz sofort gezogen - einmal leicht, im selben
    // Moment, in dem sich die Karten heben. Nur mit sichtbarem Gegenstück (Baum offen), sonst still.
    if (next?.draw && tabRef.current === "bracket") return playMoment("draw");
    return undefined;
  }, [allMatches, bracket.matches_v2, ownRegistration?.id, stages]);
  // Weg vom Baum: der Moment ist vorbei - beim Zurückkommen steht der Baum ruhig da (kein zweites Mal, #1633).
  useEffect(() => {
    if (tab !== "bracket") setPlan(null);
  }, [tab]);
  const matchFinder = useMemo(() => finderFor(allMatches), [allMatches]);
  const upcomingMatches = useMemo(() => {
    const open = allMatches.filter((match) => OPEN_MATCH_STATUSES.has(String(match.status || "")));
    if (!ownRegistration?.id) return open.slice(0, 5);
    const ownOpen = open.filter((match) => matchIncludesRegistration(match, ownRegistration.id));
    return (ownOpen.length ? ownOpen : open).slice(0, 5);
  }, [allMatches, ownRegistration?.id]);
  const finalStandings = useMemo(() => {
    // Gruppen kommen als `[{group, standings}]` - die stehen als Tabellen unter „Tabelle“, nicht als „Teilnehmer“.
    const rows = (standings.length ? standings : tournament?.standings || []).filter((row: any) => !Array.isArray(row?.standings));
    return [...rows].sort((a, b) => standingRank(a, 999) - standingRank(b, 999));
  }, [standings, tournament?.standings]);
  const completedMatches = useMemo(
    () => allMatches.filter((match) => CLOSED_MATCH_STATUSES.has(String(match.status || ""))),
    [allMatches],
  );
  const recentCompletedMatches = useMemo(() => completedMatches.slice(-4).reverse(), [completedMatches]);
  const isFinished = FINISHED_TOURNAMENT_STATUSES.has(String(tournament?.status || ""));
  const completedAt = tournament?.results_published_at || tournament?.completed_at || tournament?.end_date || tournament?.updated_at;

  const register = useCallback(async (payload: RegistrationPayload = {}) => {
    if (!tournament || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.post(`/tournaments/${tournament.id}/register`, {
        team_id: payload.team_id || null,
        ingame_name: user?.display_name || user?.username,
        discord: user?.discord_name,
        player_ids: payload.player_ids || {},
        accept_rules: true,
        accept_privacy: true,
        accept_costs: Boolean(payload.accept_costs),
        selected_positions: payload.selected_positions || [],
      });
      setRegisterModal(false);
      await load();
      // Der einmalige Hinweis direkt nach der ersten Anmeldung (#1188 Teil 2), nicht erst auf der Event-Seite.
      void offerFriendsHint();
    } catch (err) {
      setError(errorMessage(err, "Turnier-Anmeldung konnte nicht gespeichert werden."));
    } finally {
      setBusy(false);
    }
  }, [busy, load, tournament, user?.discord_name, user?.display_name, user?.username]);

  const startRegistration = useCallback(() => {
    if (!tournament || busy) return;
    if (isTeamTournament || gameFields.length || tournament.offer) {
      setRegisterModal(true);
      return;
    }
    register();
  }, [busy, gameFields.length, isTeamTournament, register, tournament]);

  const checkIn = useCallback(async () => {
    if (!tournament || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.post(`/tournaments/${tournament.id}/checkin`);
      // Check-in geschafft (#1168): einmal kurz - der neue Stand „Eingecheckt“ steht gleich darunter.
      playMoment("checkIn");
      await load();
    } catch (err) {
      setError(errorMessage(err, "Check-in konnte nicht gespeichert werden."));
    } finally {
      setBusy(false);
    }
  }, [busy, load, tournament]);

  const unregister = useCallback(async () => {
    if (!tournament || !ownRegistration?.id || busy) return;
    Alert.alert("Vom Turnier abmelden?", "Deine Turnier-Anmeldung wird entfernt.", [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Abmelden",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          setError("");
          try {
            await api.delete(`/tournaments/${tournament.id}/registrations/${ownRegistration.id}`);
            await load();
          } catch (err) {
            setError(errorMessage(err, "Turnier-Abmeldung konnte nicht gespeichert werden."));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }, [busy, load, ownRegistration?.id, tournament]);

  if (!tournament && loading) {
    return (
      <Screen>
        <SkeletonList count={4} hasImage={false} />
      </Screen>
    );
  }

  if (!tournament) {
    return (
      <Screen>
        <ErrorState title="Turnierdetail nicht verfügbar" detail={loadError ? errorMessage(loadError, "Turnierdetail konnte nicht geladen werden.") : "Das Turnier konnte nicht geladen werden."} problem={problem} onRetry={() => { void load(); }} />
      </Screen>
    );
  }

  const rules = Array.isArray(tournament.rules)
    ? tournament.rules
    : typeof tournament.rules === "string"
      ? tournament.rules.split("\n").map((line) => line.replace(/^[-#*\s]+/, "").trim()).filter(Boolean).slice(0, 14)
      : [];
  const prizes = [
    ...(tournament.prizes || []),
    ...(tournament.prize_places || []).map(formatPrizePlace),
    tournament.prize_pool ? `Preispool: ${tournament.prize_pool}` : "",
  ].filter(Boolean);

  return (
    <MatchFinderContext.Provider value={matchFinder}>
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        {notice ? <PartialLoadNotice problem={notice} onRetry={() => { void load(); }} testID="tournament-partial-load" /> : null}
        <View style={styles.hero}>
          <Muted>{tournament.game?.display_name || tournament.game?.name || tournament.game_name || tournament.platform || "Turnier"}</Muted>
          <Title>{tournament.title}</Title>
          {tournament.description ? <Muted>{tournament.description.replace(/[#*_`]/g, "").slice(0, 300)}</Muted> : null}
          <View style={styles.pillRow}>
            <StatusBadge phase={tournament.public_phase} status={tournament.status} />
            <Pill label={formatDate(tournament.start_date)} />
            <Pill label={tournament.format_label || formatTournamentFormat(tournament.format) || "Format offen"} />
            <Pill label={`${tournament.participant_count ?? tournament.participants?.length ?? registrations.length ?? 0}${tournament.max_participants ? `/${tournament.max_participants}` : ""} Teilnehmer`} />
          </View>
        </View>

        {error ? <Muted style={styles.error}>{error}</Muted> : null}

        <SegmentedTabs items={tabs} value={tab} onChange={(next) => { tabRef.current = next; setTab(next); }} />

        {tab === "overview" ? (
          <>
            {isFinished ? (
              <CompletedTournamentSummary
                completedAt={completedAt}
                participantCount={registrations.length || tournament.participant_count || 0}
                playedMatches={completedMatches.length}
                standings={finalStandings}
                totalMatches={allMatches.length}
                onOpenStandings={() => setTab("standings")}
              />
            ) : null}
            <Card style={styles.card}>
              <Heading>Turnierstatus</Heading>
              <View style={styles.registrationBox}>
                <Muted>{registration.label}</Muted>
                {tournament.registration_open_from || tournament.registration_open_until ? (
                  <Muted>
                    {tournament.registration_open_from ? `Öffnet: ${formatDateTime(tournament.registration_open_from)}` : ""}
                    {tournament.registration_open_from && tournament.registration_open_until ? " · " : ""}
                    {tournament.registration_open_until ? `Endet: ${formatDateTime(tournament.registration_open_until)}` : ""}
                  </Muted>
                ) : null}
                {clubMemberBlocked && !registered ? (
                  <Muted style={styles.warning}>Dieses Turnier ist für externe Teilnehmer vorgesehen. Vereinsmitglieder können sich hier nicht selbst anmelden.</Muted>
                ) : null}
                {eventGate && !registered ? (
                  <Muted style={styles.gate} testID="tournament-event-gate">
                    {isTeamTournament
                      ? `Anmeldung nur mit Event-Anmeldung: Mindestens ${eventGate.team_need} Spieler deines Teams müssen beim Event „${eventGate.event.name || "Event"}“ angemeldet sein.`
                      : eventGate.registered
                        ? `Du bist beim Event „${eventGate.event.name || "Event"}“ angemeldet – die Turnieranmeldung ist frei.`
                        : `Anmeldung nur mit Event-Anmeldung: Melde dich zuerst beim Event „${eventGate.event.name || "Event"}“ an.`}
                  </Muted>
                ) : null}
                {isTeamTournament && canSelfRegister && !manageableTeams.length ? (
                  <Muted style={styles.errorText}>Für dieses Team-Turnier brauchst du ein Team, das du als Leader oder Co-Leader verwalten darfst.</Muted>
                ) : null}
                {tournament.offer ? (
                  <View style={styles.feeBox} testID="tournament-offer">
                    <Muted style={styles.feeLabel}>Startgeld</Muted>
                    <Body style={styles.strong}>{startFeeSummary(tournament.offer, tournament.team_mode || "solo", tournament.team_size || 1)}</Body>
                    <Muted>{isTeamTournament ? "Die Teamleitung übernimmt das Startgeld für das Team und bekommt die Rechnung." : "Die Rechnung geht an dich."} Bezahlt wird erst mit der verbindlichen Teilnahme.</Muted>
                  </View>
                ) : null}
                {guest ? (
                  // Gast zuerst (#918): der Weg zum Konto gleich hier - nach der Anmeldung geht es zurück zu diesem Turnier.
                  <>
                    <Muted>Teilnehmen kannst du mit einem Konto.</Muted>
                    <Button label="Anmelden oder registrieren" variant="secondary" onPress={() => openSignIn()} testID="tournament-sign-in" />
                  </>
                ) : registered && ownOut ? (
                  <Muted style={styles.warning} testID="tournament-own-out">Du bist ausgeschieden: {formatStatus(ownRegistration?.status)}</Muted>
                ) : registered ? (
                  <>
                    <Muted style={styles.success}>Du bist angemeldet: {formatStatus(ownRegistration?.status)}</Muted>
                    {ownRegistration?.price ? <Muted testID="tournament-own-price">{ownPriceLine(ownRegistration.price)}</Muted> : null}
                    {!ownRegistration?.price && tournament.offer && ownRegistration?.user_id === user?.id && ["pending", "waitlist"].includes(String(ownRegistration?.status || "")) ? (
                      <Muted>Bezahlt wird erst, wenn deine Teilnahme bestätigt ist.</Muted>
                    ) : null}
                    {canCheckIn ? <Button label={busy ? "Check-in läuft ..." : "Jetzt einchecken"} onPress={checkIn} disabled={busy} testID="tournament-checkin" /> : null}
                    {checkInOver ? (
                      <Muted style={styles.checkInHint} testID="tournament-checkin-over">Check-in vorbei – einchecken geht nicht mehr. Bist du da, melde dich bei der Turnierleitung.</Muted>
                    ) : null}
                    {staffOnlyCheckIn && (tournament.check_in_from || tournament.check_in_until) && ["approved", "checked_in"].includes(String(ownRegistration?.status || "")) ? (
                      <Muted style={styles.checkInHint} testID="tournament-checkin-local">
                        {ownRegistration?.status === "checked_in"
                          ? "Eingecheckt – die Turnierleitung hat dich vor Ort eingetragen."
                          : `Check-in vor Ort bei der Turnierleitung${checkInWindow ? ` · ${checkInWindow}` : ""}`}
                      </Muted>
                    ) : null}
                    {/* „Vom Turnier abmelden“ als leiser Link (#1139) - wie im Web, nicht als zweiter großer Knopf. Ist es
                        nicht mehr möglich, steht dazu kein eigener Satz mehr. */}
                    {canSelfUnregister ? (
                      <Pressable onPress={unregister} disabled={busy} hitSlop={10} accessibilityRole="button" testID="tournament-unregister" style={styles.quietLink}>
                        <Muted style={styles.quietLinkText}>{busy ? "Wird abgemeldet ..." : "Vom Turnier abmelden"}</Muted>
                      </Pressable>
                    ) : null}
                  </>
                ) : eventBlocked && eventGate && registration.canRegister && !clubMemberBlocked ? (
                  <Button label="Zuerst beim Event anmelden" onPress={() => navigation.navigate("EventDetail", { id: eventGate.event.slug || eventGate.event.id, returnTournament: tournament.slug || tournament.id })} testID="tournament-event-first" />
                ) : canSelfRegister ? (
                  <>
                    <Muted>Mit der Anmeldung akzeptierst du Regeln und Datenschutz für dieses Turnier.</Muted>
                    <Button
                      label={busy ? "Wird angemeldet ..." : isTeamTournament ? "Team anmelden" : "Zum Turnier anmelden"}
                      onPress={startRegistration}
                      disabled={busy || (isTeamTournament && !manageableTeams.length)}
                    />
                  </>
                ) : (
                  <Muted>Anmeldung ist aktuell nicht möglich.</Muted>
                )}
              </View>
              <View style={styles.statGrid}>
                <Stat label="Matches" value={String(allMatches.length)} />
                <Stat label="Spieler" value={String(registrations.length || tournament.participant_count || 0)} tone="gold" />
              </View>
              <Info label="Event" value={tournament.event?.name || "-"} />
              <Info label="Ort" value={tournament.event?.location || "-"} />
              <Info label="Anmeldung" value={registration.label} />
              <Info label="Modus" value={formatTeamMode(tournament.team_mode)} />
              {/* Nach dem Ende (#1221) kein Kalender-Knopf mehr. */}
              <AddToCalendarButton item={tournament.start_date && !tournamentIsOver(tournament) ? {
                id: tournament.id, kind: "tournament", title: tournament.title, start: tournament.start_date, end: tournament.end_date,
                location: tournament.event?.location || null, detail: [tournament.game?.display_name || tournament.game?.name, formatTournamentFormat(tournament.format)].filter(Boolean).join(" · ") || null,
                url: tournament.slug ? `https://lionsquad.at/tournaments/${tournament.slug}` : null,
              } : null} />
              {/* Turnierleitung am Handy (#1156): nur wer in diesem Turnier Ergebnisse eintragen darf (der Server sagt es). */}
              {tournament.can_manage_results && !guest ? (
                <Button
                  label="Turnierleitung öffnen"
                  onPress={() => navigation.navigate("TournamentLead", { id: tournament.slug || tournament.id })}
                  testID="tournament-lead-open"
                />
              ) : null}
              {/* Den Turnier-Chat gibt es mit Konto (#918) - Gäste finden „Anmelden oder registrieren“ oben bei der Teilnahme. */}
              {tournament.show_chat && !guest ? (
                <Button
                  label="Turnier-Chat öffnen"
                  onPress={() => navigation.navigate("TournamentChat", { id: tournament.id, title: `${tournament.title} Chat` })}
                  variant="secondary"
                />
              ) : null}
            </Card>
            {/* Team am Spieltag (#1192): Aufstellung und „Wer ist da“ - nur angemeldete Teams bei Team-Turnieren. */}
            {registered && isTeamTournament && !guest ? <TeamDayCard tournamentId={tournament.id} /> : null}
            {/* Freunde beim Turnier (#1188 Teil 2): nur mit Konto, nur bestätigte Freunde, die es erlauben. */}
            <FriendsAtEventCard
              path={`/tournaments/${tournament.slug || tournament.id}/friends`}
              scope="tournament"
              signedIn={Boolean(user) && !guest}
              over={tournamentIsOver(tournament)}
              onOpenProfile={(username) => navigation.navigate("PublicProfile", { username })}
            />
            {isFinished ? (
              <>
                {/* Ergebnis teilen (#1194): Bild für Status und Story - der Server sagt, ob es geht. */}
                {registered && !guest ? <ResultShareCard tournamentId={tournament.id} /> : null}
                <Card style={styles.card}>
                  <Heading>Finale Rangliste</Heading>
                  {finalStandings.length ? finalStandings.slice(0, 6).map((standing, index) => (
                    <StandingRow key={`${standing.registration_id || standing.name || standing.display_name || index}`} standing={standing} index={index} />
                  )) : <Muted>Finale Platzierungen wurden noch nicht veröffentlicht.</Muted>}
                  {finalStandings.length > 6 ? <Button label="Komplette Rangliste anzeigen" variant="secondary" onPress={() => setTab("standings")} /> : null}
                </Card>
                <Card style={styles.card}>
                  <Heading>Match-Historie</Heading>
                  {recentCompletedMatches.length ? recentCompletedMatches.map((match) => (
                    <MatchCard key={match.id} match={match} regMap={regMap} compact onPress={() => navigation.navigate("MatchDetail", { id: match.id })} />
                  )) : <Muted>Keine abgeschlossenen Matches vorhanden.</Muted>}
                  {allMatches.length > recentCompletedMatches.length ? <Button label="Alle Matches anzeigen" variant="secondary" onPress={() => setTab("matches")} /> : null}
                </Card>
              </>
            ) : (
              <Card style={styles.card}>
                <Heading>Nächste Matches</Heading>
                {upcomingMatches.length ? upcomingMatches.map((match) => (
                  <MatchCard key={match.id} match={match} regMap={regMap} compact onPress={() => navigation.navigate("MatchDetail", { id: match.id })} />
                )) : <Muted>Keine offenen Matches.</Muted>}
              </Card>
            )}
          </>
        ) : null}

        {tab === "bracket" ? (
          kind === "table" ? (
            // Gruppen, Liga, Swiss (#1563): eine Tabelle statt Baum-Spalten, der Spielplan einen Tipp weiter.
            <Card style={styles.card}>
              <Heading>Tabelle</Heading>
              <StandingsTables tables={tables} empty="Die Tabelle steht, sobald Ergebnisse da sind." />
              {allMatches.length ? <Button label="Zum Spielplan" variant="secondary" onPress={() => { tabRef.current = "matches"; setTab("matches"); }} /> : null}
            </Card>
          ) : (
            <Card style={styles.card}>
              <Heading>Turnierbaum</Heading>
              {allMatches.length ? (
                <BracketCanvas
                  matches={allMatches}
                  stages={stages}
                  format={tournament.format}
                  advancement={tournament}
                  nameOf={nameOf}
                  statusOf={statusOf}
                  mineId={ownRegistration?.id || null}
                  plan={plan}
                  crowned={crowned}
                  onOpenMatch={openMatch}
                />
              ) : <Muted>Noch kein Turnierbaum veröffentlicht.</Muted>}
            </Card>
          )
        ) : null}

        {tab === "matches" ? (
          <Card style={styles.card}>
            <Heading>{isFinished ? "Match-Historie" : "Spielplan"}</Heading>
            {allMatches.length ? (
              <ScheduleList matches={allMatches} stages={stages} format={tournament.format} nameOf={nameOf} mineId={ownRegistration?.id || null} onOpen={openMatch} />
            ) : <Muted>Noch keine Matches veröffentlicht.</Muted>}
          </Card>
        ) : null}

        {tab === "standings" ? (
          <Card style={styles.card}>
            <Heading>{isFinished ? "Finale Rangliste" : "Rangliste"}</Heading>
            {kind === "table" ? <StandingsTables tables={tables} empty="Rangliste wird angezeigt, sobald Ergebnisse vorhanden sind." /> : finalStandings.length ? finalStandings.map((standing, index) => (
              <StandingRow key={`${standing.registration_id || standing.name || standing.display_name || index}`} standing={standing} index={index} />
            )) : <Muted>Rangliste wird angezeigt, sobald Ergebnisse vorhanden sind.</Muted>}
          </Card>
        ) : null}

        {tab === "participants" ? (
          <Card style={styles.card}>
            <Heading>Teilnehmer</Heading>
            {registrations.length ? registrations.map((registration) => (
              <View key={registration.id} style={styles.row}>
                <View style={styles.avatar}>
                  <Body style={styles.avatarText}>{participantLabel(registration).slice(0, 1).toUpperCase()}</Body>
                </View>
                <View style={styles.rowMain}>
                  <Body style={styles.rowTitle}>{participantLabel(registration)}</Body>
                  <Muted>{formatStatus(registration.status || registration.registration_type || "registered")}</Muted>
                </View>
                {registration.seed ? <Pill label={`Seed ${registration.seed}`} /> : null}
              </View>
            )) : (
              <View style={styles.wrap}>
                {tournament.participants?.length ? tournament.participants?.map((name) => <Pill key={name} label={name} />) : <Muted>Aktuell sind {tournament.participant_count || 0} Teilnehmer registriert.</Muted>}
              </View>
            )}
          </Card>
        ) : null}

        {tab === "rules" ? (
          <Card style={styles.card}>
            <Heading>Regeln & Preise</Heading>
            {rules.length ? rules.map((rule) => <Bullet key={rule} text={rule} />) : <Muted>Keine Regeln veröffentlicht.</Muted>}
            {prizes.length ? prizes.map((prize, index) => <Bullet key={`${prize}-${index}`} text={prize} accent />) : null}
          </Card>
        ) : null}
      </ScrollView>
      <RegistrationModal
        busy={busy}
        fields={gameFields}
        teams={manageableTeams}
        tournament={tournament}
        user={user}
        visible={registerModal}
        onClose={() => setRegisterModal(false)}
        onSubmit={register}
      />
    </Screen>
    </MatchFinderContext.Provider>
  );
}

function formatPrizePlace(place: { group?: string | null; place?: number | string; label?: string; value?: string }) {
  const value = String(place.value || "").trim();
  if (!value) return "";
  const group = prizeGroupLabel(place.group);
  const placeLabel = place.label || (place.place ? `${place.place}. Platz` : "Preis");
  return [group, `${placeLabel}: ${value}`].filter(Boolean).join(" - ");
}

function prizeGroupLabel(group?: string | null) {
  if (!group || group === "overall") return "";
  if (group === "winner") return "Gewinner-Bracket";
  if (group === "loser") return "Loser-Bracket";
  if (group === "special") return "Sonderpreis";
  return group;
}

function RegistrationModal({
  busy,
  fields,
  teams,
  tournament,
  user,
  visible,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  fields: NonNullable<NonNullable<Tournament["game"]>["effective_player_id_fields"]>;
  teams: Team[];
  tournament: Tournament;
  user?: User | null;
  visible: boolean;
  onClose: () => void;
  onSubmit: (payload: RegistrationPayload) => void;
}) {
  useSeasonOverlay("registration-modal", visible);
  const isTeamTournament = (tournament.team_mode || "solo") !== "solo";
  const sourceSlug = tournament.game?.identity_game_slug || tournament.game?.slug || "";
  const gameSlug = tournament.game?.slug || "";
  const initialIds = useMemo(() => ({
    ...((sourceSlug && user?.game_ids?.[sourceSlug]) || {}),
    ...((gameSlug && user?.game_ids?.[gameSlug]) || {}),
  }), [gameSlug, sourceSlug, user?.game_ids]);
  const [playerIds, setPlayerIds] = useState<Record<string, string>>(initialIds);
  const [teamId, setTeamId] = useState(teams[0]?.id || "");
  // Startgeld (#319): Summe vor dem Absenden, wählbare Positionen, Kostenübernahme als Pflicht.
  const offer = tournament.offer || null;
  const [acceptCosts, setAcceptCosts] = useState(false);
  const [selectedPositions, setSelectedPositions] = useState<string[]>([]);
  const seats = isTeamTournament ? Math.max(1, Number(tournament.team_size) || 1) : 1;
  const total = offer ? quoteTotal(offer, seats, selectedPositions) : 0;
  const currency = offer?.currency || "EUR";

  useEffect(() => {
    if (!visible) return;
    setPlayerIds(initialIds);
    setTeamId(teams[0]?.id || "");
    setAcceptCosts(false);
    setSelectedPositions([]);
  }, [initialIds, teams, visible]);

  const missingRequired = fields.some((field) => field.required !== false && !String(playerIds[field.key] || "").trim());
  const canSubmit = !busy && (!isTeamTournament || Boolean(teamId)) && !missingRequired && (!offer || acceptCosts);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <View style={styles.modalHead}>
              <View style={styles.flex}>
                <Heading>Turnier-Anmeldung</Heading>
                <Muted>{isTeamTournament ? "Wähle dein verwaltbares Team aus." : fields.length ? `${tournament.game?.display_name || tournament.game?.name || "Dieses Spiel"} benötigt diese Angaben.` : "Bitte bestätige das Startgeld, dann bist du dabei."}</Muted>
              </View>
              <Pressable onPress={onClose} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
                <Body style={styles.closeText}>x</Body>
              </Pressable>
            </View>

            {isTeamTournament ? (
              <View style={styles.formGroup}>
                <Muted style={styles.formLabel}>Team</Muted>
                {teams.length ? teams.map((team) => (
                  <Pressable key={team.id} onPress={() => setTeamId(team.id)} style={[styles.teamChoice, teamId === team.id && styles.teamChoiceActive]}>
                    <View style={styles.flex}>
                      <Body style={styles.strong}>{team.tag ? `[${team.tag}] ${team.name}` : team.name}</Body>
                      <Muted>{team.my_role === "co_leader" ? "Co-Leader" : team.my_role === "leader" ? "Leader" : team.can_manage ? "Verwaltbar" : "Team"}</Muted>
                    </View>
                    <View style={[styles.radio, teamId === team.id && styles.radioActive]} />
                  </Pressable>
                )) : (
                  <Muted style={styles.errorText}>Du hast aktuell kein Team, das du für dieses Turnier anmelden darfst.</Muted>
                )}
              </View>
            ) : null}

            {fields.length ? (
              <View style={styles.formGroup}>
                <Muted style={styles.formLabel}>Spieler-IDs</Muted>
                {fields.map((field) => (
                  <FormInput
                    key={field.key}
                    label={`${field.label || field.key}${field.required === false ? "" : " *"}`}
                    value={playerIds[field.key] || ""}
                    placeholder={field.help_text || field.label || field.key}
                    onChangeText={(value) => setPlayerIds((current) => ({ ...current, [field.key]: value }))}
                  />
                ))}
              </View>
            ) : null}

            {offer ? (
              <View style={[styles.formGroup, styles.feeBox]} testID="tournament-register-costs">
                <Muted style={styles.feeLabel}>Startgeld</Muted>
                {offer.positions.filter((position) => position.optional).map((position) => {
                  const chosen = selectedPositions.includes(position.key);
                  return (
                    <Pressable
                      key={position.key}
                      onPress={() => setSelectedPositions((current) => (chosen ? current.filter((key) => key !== position.key) : [...current, position.key]))}
                      style={styles.checkRow}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: chosen }}
                      testID={`tournament-offer-option-${position.key}`}
                    >
                      <View style={[styles.checkbox, chosen && styles.checkboxActive]} />
                      <Body style={styles.flex}>{position.label} <Muted>{formatCents(position.amount_cents, currency)} {basisLabel(position.basis)}</Muted></Body>
                    </Pressable>
                  );
                })}
                <View style={styles.feeTotalRow}>
                  <Muted>{isTeamTournament ? `Summe für ein Team mit ${seats} Spielern` : "Summe"}</Muted>
                  <Body style={styles.strong} testID="tournament-quote">{formatCents(total, currency)}</Body>
                </View>
                {isTeamTournament && offer.positions.some((position) => position.basis === "per_person") ? (
                  <Muted>Gezählt wird der Roster bei der Freigabe – fehlen noch Spieler, gilt die Teamgröße.</Muted>
                ) : null}
                <Pressable
                  onPress={() => setAcceptCosts((current) => !current)}
                  style={styles.checkRow}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: acceptCosts }}
                  testID="tournament-accept-costs"
                >
                  <View style={[styles.checkbox, acceptCosts && styles.checkboxActive]} />
                  <View style={styles.flex}>
                    <Body>{isTeamTournament ? "Ich übernehme das Startgeld für das Team (Rechnung an mich)." : "Ich übernehme das Startgeld (Rechnung an mich)."}</Body>
                    <Muted>Bezahlt wird erst mit der verbindlichen Teilnahme; die Rechnung kommt in dein Konto.</Muted>
                  </View>
                </Pressable>
              </View>
            ) : null}

            <Muted>Mit der Anmeldung akzeptierst du die Turnierregeln und die Datenschutzhinweise.</Muted>
            {missingRequired ? <Muted style={styles.errorText}>Bitte alle Pflicht-IDs ausfüllen.</Muted> : null}

            <View style={styles.formActions}>
              <Button label="Abbrechen" variant="secondary" onPress={onClose} disabled={busy} />
              <Button
                label={busy ? "Sendet ..." : offer && total > 0 ? `Verbindlich anmelden · ${formatCents(total, currency)}` : "Anmelden"}
                onPress={() => onSubmit({ team_id: isTeamTournament ? teamId : null, player_ids: playerIds, accept_costs: acceptCosts, selected_positions: selectedPositions })}
                disabled={!canSubmit}
                testID="tournament-register-submit"
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function CompletedTournamentSummary({
  completedAt,
  participantCount,
  playedMatches,
  standings,
  totalMatches,
  onOpenStandings,
}: {
  completedAt?: string | null;
  participantCount: number;
  playedMatches: number;
  standings: any[];
  totalMatches: number;
  onOpenStandings: () => void;
}) {
  const winner = standings[0];
  const podium = standings.slice(0, 3);

  return (
    <Card style={[styles.card, styles.completedCard]}>
      <View style={styles.completedHeader}>
        <Pill label="Turnier beendet" accent="cyan" />
        <Heading>Finale Ergebnisse</Heading>
        {completedAt ? <Muted>Abgeschlossen am {formatDateTime(completedAt)}</Muted> : <Muted>Die Ergebnisse sind veröffentlicht.</Muted>}
      </View>

      {winner ? (
        <View style={styles.winnerBox}>
          <Muted style={styles.winnerLabel}>Champion</Muted>
          <Body style={styles.winnerName}>{standingName(winner)}</Body>
          <Muted>{standingSummary(winner)}</Muted>
        </View>
      ) : (
        <View style={styles.winnerBox}>
          <Muted style={styles.winnerLabel}>Champion</Muted>
          <Body style={styles.winnerName}>Noch nicht veröffentlicht</Body>
          <Muted>Finale Platzierungen werden angezeigt, sobald sie im Backend vorhanden sind.</Muted>
        </View>
      )}

      {podium.length ? (
        <View style={styles.podiumGrid}>
          {podium.map((standing, index) => (
            <View key={`${standing.registration_id || standing.name || standing.display_name || index}`} style={[styles.podiumCard, index === 0 && styles.podiumFirst]}>
              <Body style={styles.podiumRank}>{placementLabel(standingRank(standing, index + 1))}</Body>
              <Body style={styles.podiumName} numberOfLines={2}>{standingName(standing)}</Body>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.statGrid}>
        <Stat label="Teilnehmer" value={String(participantCount)} tone="gold" />
        <Stat label="Gespielt" value={String(playedMatches)} />
        <Stat label="Matches" value={String(totalMatches)} />
      </View>

      <Button label="Finale Rangliste öffnen" variant="secondary" onPress={onOpenStandings} />
    </Card>
  );
}

function StandingRow({ standing, index }: { standing: any; index: number }) {
  const rank = standingRank(standing, index + 1);
  return (
    <View style={[styles.row, rank <= 3 && styles.placementRow]}>
      <Body style={[styles.rank, rank === 1 && styles.rankFirst, rank === 2 && styles.rankSecond, rank === 3 && styles.rankThird]}>
        #{rank}
      </Body>
      <View style={styles.rowMain}>
        <Body style={styles.rowTitle}>{standingName(standing)}</Body>
        <Muted>{standingSummary(standing)}</Muted>
      </View>
      {rank <= 3 ? <Pill label={placementLabel(rank)} accent={rank === 1 ? "cyan" : undefined} /> : null}
    </View>
  );
}

// Spiel-Kürzel gelten je Phase (#1140): die Karte sucht das Herkunftsspiel eines leeren Platzes über diese Suche.
const MatchFinderContext = React.createContext(finderFor([]));

function MatchCard({ match, regMap, compact = false, onPress }: { match: any; regMap: Map<string, any>; compact?: boolean; onPress?: () => void }) {
  const finder = React.useContext(MatchFinderContext);
  const findMatch = finder(match);
  const nameOf = (registrationId: string) => participantLabel(regMap.get(registrationId));
  // Klartext statt Kürzel (#1140): Name, „Freilos“, „Sieger aus A“ - ein Setzplatz vor dem Start „noch offen“.
  const label = (slot: any) => {
    const view = describeSlot(slot, nameOf, findMatch);
    return view.label || (view.kind === "player" ? "Teilnehmer" : "noch offen");
  };
  const rows = match.slots?.length
    ? match.slots.map((slot: any) => {
        const result = (match.results || []).find((item: any) => item.registration_id === slot.registration_id);
        return { id: slot.slot || slot.registration_id, label: label(slot), score: result?.score ?? result?.points, rank: result?.rank, winner: result?.rank === 1 || result?.qualified };
      })
    : [
        { id: "a", label: label({ registration_id: match.participant_a_id }), score: match.score_a, winner: match.winner_id && match.winner_id === match.participant_a_id },
        { id: "b", label: label({ registration_id: match.participant_b_id }), score: match.score_b, winner: match.winner_id && match.winner_id === match.participant_b_id },
      ];
  // „geplant ca. 15:20 · 30 Minuten“ statt „Zeit noch offen“ (#1140); ein fertiges Spiel nennt, wann es war.
  const when = plannedText(match) || (isMatchDone(match) && match.scheduled_at ? formatWhen(match.scheduled_at) : "");
  const station = stationText(match);
  const content = (
    <View style={[styles.matchCard, compact && styles.matchCardCompact]} testID={`match-card-${match.id}`}>
      <View style={styles.matchHead}>
        <Muted style={styles.matchKey}>{match.match_key || match.round_name || "Match"}</Muted>
        <Muted style={styles.status}>{matchStatusText(match)}</Muted>
      </View>
      {rows.map((row: any) => (
        <View key={String(row.id)} style={[styles.matchRow, row.winner && styles.matchWinner]}>
          <Body style={[styles.matchName, row.winner && styles.matchWinnerText]} numberOfLines={1}>{row.label}</Body>
          <Body style={styles.matchScore}>{row.rank ? `#${row.rank}` : row.score ?? "-"}</Body>
        </View>
      ))}
      <View style={styles.matchMeta}>
        <Muted>{when || "Zeit noch offen"}</Muted>
        {station ? <Muted style={styles.textCyan}>{station}</Muted> : null}
      </View>
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

function standingName(standing: any) {
  return standing?.display_name || standing?.name || standing?.team_name || standing?.registration_name || "Teilnehmer";
}

function standingRank(standing: any, fallback: number) {
  const rank = Number(standing?.rank ?? standing?.final_position ?? standing?.place);
  return Number.isFinite(rank) && rank > 0 ? rank : fallback;
}

function standingSummary(standing: any) {
  if (standing?.result) return String(standing.result);
  const parts = [];
  const points = standing?.points ?? standing?.score;
  const wins = standing?.wins ?? standing?.won;
  if (points !== undefined && points !== null) parts.push(`${points} Punkte`);
  if (wins !== undefined && wins !== null) parts.push(`${wins} Siege`);
  if (standing?.best_rank !== undefined && standing?.best_rank !== null) parts.push(`Bestes Match #${standing.best_rank}`);
  if (standing?.played !== undefined && standing?.played !== null) parts.push(`${standing.played} gespielt`);
  return parts.length ? parts.join(" · ") : "Finale Platzierung";
}

function placementLabel(rank: number) {
  if (rank === 1) return "1. Platz";
  if (rank === 2) return "2. Platz";
  if (rank === 3) return "3. Platz";
  return `${rank}. Platz`;
}

function participantLabel(registration: any) {
  if (!registration) return "";
  return registration.display_name || registration.ingame_name || registration.user?.display_name || registration.user?.username || registration.name || "";
}

function matchIncludesRegistration(match: any, registrationId: string) {
  if (!registrationId) return false;
  if (match.participant_a_id === registrationId || match.participant_b_id === registrationId) return true;
  return Boolean((match.slots || []).some((slot: any) => slot.registration_id === registrationId));
}

function formatTeamMode(value?: string | null) {
  if (!value || value === "solo") return "Solo";
  if (value === "team") return "Team";
  if (value === "duo") return "Duo";
  if (value === "squad") return "Squad";
  return value.replace(/_/g, " ");
}

function Stat({ label, value, tone = "cyan" }: { label: string; value: string; tone?: "cyan" | "gold" }) {
  return (
    <View style={styles.stat}>
      <Body style={[styles.statValue, tone === "gold" && styles.gold]}>{value}</Body>
      <Muted>{label}</Muted>
    </View>
  );
}

function Pill({ label, accent }: { label: string; accent?: "cyan" }) {
  return (
    <View style={[styles.pill, accent === "cyan" && styles.pillAccent]}>
      <Muted style={[styles.pillText, accent === "cyan" && styles.pillTextAccent]}>{label}</Muted>
    </View>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={styles.info}>
      <Muted>{label}</Muted>
      <Body style={styles.infoValue}>{value || "-"}</Body>
    </View>
  );
}

function Bullet({ text, accent }: { text: string; accent?: boolean }) {
  return (
    <View style={styles.bullet}>
      <View style={[styles.dot, accent && styles.dotAccent]} />
      <Muted style={styles.bulletText}>{text}</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  quietLink: {
    alignSelf: "flex-start",
    paddingVertical: 4,
  },
  quietLinkText: {
    textDecorationLine: "underline",
  },
  checkInHint: {
    backgroundColor: "rgba(41,182,232,0.08)",
    borderColor: "rgba(41,182,232,0.35)",
    borderRadius: radius.lg,
    borderWidth: 1,
    color: colors.white,
    fontWeight: "800",
    padding: 10,
  },
  content: {
    gap: 14,
    padding: 18,
    paddingBottom: 30,
  },
  hero: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  pressed: {
    opacity: 0.72,
  },
  strong: {
    fontWeight: "900",
  },
  pill: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  pillAccent: {
    backgroundColor: "rgba(41, 182, 232, 0.14)",
    borderColor: "rgba(41, 182, 232, 0.32)",
  },
  pillText: {
    fontSize: 12,
    fontWeight: "800",
  },
  pillTextAccent: {
    color: colors.cyan,
  },
  card: {
    gap: 12,
  },
  completedCard: {
    backgroundColor: "rgba(41,182,232,0.08)",
    borderColor: "rgba(41,182,232,0.34)",
  },
  completedHeader: {
    alignItems: "flex-start",
    gap: 7,
  },
  winnerBox: {
    backgroundColor: colors.black,
    borderColor: "rgba(247,199,68,0.45)",
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 5,
    padding: 12,
  },
  winnerLabel: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  winnerName: {
    color: colors.gold,
    fontSize: 22,
    fontWeight: "900",
  },
  podiumGrid: {
    flexDirection: "row",
    gap: 8,
  },
  podiumCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flex: 1,
    gap: 5,
    minHeight: 78,
    padding: 10,
  },
  podiumFirst: {
    backgroundColor: "rgba(247,199,68,0.12)",
    borderColor: "rgba(247,199,68,0.45)",
  },
  podiumRank: {
    color: colors.gold,
    fontSize: 13,
    fontWeight: "900",
  },
  podiumName: {
    fontWeight: "900",
  },
  statGrid: {
    flexDirection: "row",
    gap: 10,
  },
  registrationBox: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 8,
    padding: 10,
  },
  success: {
    color: colors.success,
    fontWeight: "900",
  },
  warning: {
    color: colors.gold,
    fontWeight: "800",
  },
  gate: {
    color: colors.cyan,
    fontWeight: "700",
  },
  errorText: {
    color: colors.live,
    fontWeight: "800",
  },
  stat: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flex: 1,
    padding: 10,
  },
  statValue: {
    color: colors.cyan,
    fontSize: 18,
    fontWeight: "900",
  },
  gold: {
    color: colors.gold,
  },
  info: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: 10,
    gap: 2,
  },
  infoValue: {
    fontWeight: "800",
  },
  row: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingTop: 10,
  },
  rowMain: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  rowTitle: {
    fontWeight: "900",
  },
  rank: {
    color: colors.gold,
    fontWeight: "900",
    minWidth: 34,
  },
  placementRow: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 10,
  },
  rankFirst: {
    color: colors.gold,
  },
  rankSecond: {
    color: colors.cyan,
  },
  rankThird: {
    color: colors.success,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  avatarText: {
    fontWeight: "900",
  },
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  bracketWrap: {
    gap: 16,
  },
  bracketSection: {
    gap: 8,
  },
  sectionLabel: {
    color: colors.gold,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  rounds: {
    gap: 12,
    paddingRight: 14,
  },
  roundCol: {
    gap: 10,
    width: 240,
  },
  roundTitle: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  matchCard: {
    backgroundColor: colors.black,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: "hidden",
  },
  matchCardCompact: {
    minWidth: 0,
  },
  matchHead: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  matchKey: {
    color: colors.cyan,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  status: {
    fontSize: 11,
    fontWeight: "900",
  },
  matchRow: {
    alignItems: "center",
    borderBottomColor: "rgba(255,255,255,0.06)",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  matchWinner: {
    backgroundColor: "rgba(41,182,232,0.12)",
  },
  matchWinnerText: {
    color: colors.cyan,
  },
  matchName: {
    flex: 1,
    fontWeight: "800",
  },
  matchScore: {
    color: colors.gold,
    fontWeight: "900",
  },
  matchMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  textCyan: {
    color: colors.cyan,
  },
  bullet: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 9,
  },
  dot: {
    backgroundColor: colors.cyan,
    borderRadius: 4,
    height: 8,
    marginTop: 6,
    width: 8,
  },
  dotAccent: {
    backgroundColor: colors.gold,
  },
  bulletText: {
    flex: 1,
  },
  error: {
    color: colors.live,
  },
  closeButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  closeText: {
    fontSize: 22,
    fontWeight: "900",
    lineHeight: 24,
  },
  formActions: {
    gap: 10,
  },
  formGroup: {
    gap: 10,
  },
  formLabel: {
    color: colors.cyan,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  feeBox: {
    backgroundColor: "rgba(255,215,0,0.06)",
    borderColor: "rgba(255,215,0,0.35)",
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 6,
    padding: 11,
  },
  feeLabel: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  feeTotalRow: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  checkRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
  },
  checkbox: {
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 2,
    height: 18,
    marginTop: 2,
    width: 18,
  },
  checkboxActive: {
    backgroundColor: colors.gold,
    borderColor: colors.gold,
  },
  modalBackdrop: {
    backgroundColor: "rgba(0,0,0,0.78)",
    flex: 1,
    justifyContent: "center",
    padding: 18,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    maxHeight: "88%",
    overflow: "hidden",
  },
  modalContent: {
    gap: 14,
    padding: 16,
  },
  modalHead: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
  },
  radio: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 2,
    height: 16,
    width: 16,
  },
  radioActive: {
    backgroundColor: colors.cyan,
    borderColor: colors.cyan,
  },
  teamChoice: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 11,
  },
  teamChoiceActive: {
    backgroundColor: "rgba(41,182,232,0.13)",
    borderColor: "rgba(41,182,232,0.5)",
  },
});
