import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { FormInput } from "../../components/FormInput";
import { EmptyState, LoadingState } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { api, errorMessage } from "../../lib/api";
import { formatDate, formatDateTime, formatStatus } from "../../lib/format";
import { getRegistrationState } from "../../lib/registration";
import { isGuestUser } from "../../live";
import type { TournamentStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import type { Team, Tournament, User } from "../../types";

type Props = NativeStackScreenProps<TournamentStackParamList, "TournamentDetail">;
type TabKey = "overview" | "bracket" | "matches" | "standings" | "participants" | "rules";
type BracketPayload = {
  tournament?: Tournament;
  matches?: any[];
  matches_v2?: any[];
  stages?: any[];
  registrations?: any[];
  engine?: string;
};
type RegistrationPayload = {
  player_ids?: Record<string, string>;
  team_id?: string | null;
};

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Info" },
  { key: "bracket", label: "Baum" },
  { key: "matches", label: "Matches" },
  { key: "standings", label: "Tabelle" },
  { key: "participants", label: "Spieler" },
  { key: "rules", label: "Regeln" },
];

export function TournamentDetailScreen({ navigation, route }: Props) {
  const { user } = useAuth();
  const [tournament, setTournament] = useState<Tournament | undefined>();
  const [bracket, setBracket] = useState<BracketPayload>({});
  const [standings, setStandings] = useState<any[]>([]);
  const [myTeams, setMyTeams] = useState<Team[]>([]);
  const [registerModal, setRegisterModal] = useState(false);
  const [tab, setTab] = useState<TabKey>("overview");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const guest = isGuestUser(user);

  const load = useCallback(async () => {
    setError("");
    try {
      const [detailResult, bracketResult, standingsResult, registrationsResult, teamsResult] = await Promise.all([
        api.get<Tournament>(`/tournaments/${route.params.id}`),
        api.get<BracketPayload>(`/tournaments/${route.params.id}/bracket`).catch(() => ({ data: {} as BracketPayload })),
        api.get<any[]>(`/tournaments/${route.params.id}/standings`).catch(() => ({ data: [] })),
        api.get<any[]>(`/tournaments/${route.params.id}/registrations`).catch(() => ({ data: [] })),
        user && !isGuestUser(user) ? api.get<Team[]>("/teams/my").catch(() => ({ data: [] })) : Promise.resolve({ data: [] as Team[] }),
      ]);
      setTournament(detailResult.data);
      setBracket({ ...(bracketResult.data || {}), registrations: Array.isArray(registrationsResult.data) ? registrationsResult.data : bracketResult.data?.registrations || [] });
      setStandings(Array.isArray(standingsResult.data) ? standingsResult.data : []);
      setMyTeams(Array.isArray(teamsResult.data) ? teamsResult.data : []);
    } catch (err) {
      setError(errorMessage(err, "Turnierdetail konnte nicht geladen werden."));
    } finally {
      setLoading(false);
    }
  }, [route.params.id, user]);

  useEffect(() => {
    load();
  }, [load]);

  const registrations = bracket.registrations || [];
  const myTeamIds = useMemo(() => new Set(myTeams.map((team) => team.id).filter(Boolean)), [myTeams]);
  const ownRegistration = useMemo(() => {
    if (tournament?.my_registration?.id) return tournament.my_registration;
    return registrations.find((registration) => registration.is_mine || registration.user_id === user?.id || (registration.team_id && myTeamIds.has(registration.team_id)));
  }, [myTeamIds, registrations, tournament?.my_registration, user?.id]);
  const registered = Boolean(ownRegistration?.id && !["cancelled", "rejected", "no_show"].includes(String(ownRegistration.status || "")));
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
  const canSelfRegister = Boolean(!guest && !registered && registration.canRegister && !clubMemberBlocked);
  const canCheckIn = Boolean(canManageOwnRegistration && ownRegistration?.status === "approved" && tournament?.status === "check_in");
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
  const legacyMatches = bracket.matches || tournament?.matches || [];
  const v2Matches = bracket.matches_v2 || [];
  const allMatches = v2Matches.length ? v2Matches : legacyMatches;

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
      });
      setRegisterModal(false);
      await load();
    } catch (err) {
      setError(errorMessage(err, "Turnier-Anmeldung konnte nicht gespeichert werden."));
    } finally {
      setBusy(false);
    }
  }, [busy, load, tournament, user?.discord_name, user?.display_name, user?.username]);

  const startRegistration = useCallback(() => {
    if (!tournament || busy) return;
    if (isTeamTournament || gameFields.length) {
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

  if (loading) {
    return (
      <Screen>
        <LoadingState label="Turnier wird geladen ..." />
      </Screen>
    );
  }

  if (!tournament) {
    return (
      <Screen>
        <EmptyState title="Turnierdetail nicht verfügbar" detail={error || "Das Turnier konnte nicht geladen werden."} />
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
    ...(tournament.prize_places || []).map((place) => `${place.label || `${place.place}. Platz`}: ${place.value || ""}`.trim()),
    tournament.prize_pool ? `Preispool: ${tournament.prize_pool}` : "",
  ].filter(Boolean);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Muted>{tournament.game?.display_name || tournament.game?.name || tournament.game_name || tournament.platform || "Turnier"}</Muted>
          <Title>{tournament.title}</Title>
          {tournament.description ? <Muted>{tournament.description.replace(/[#*_`]/g, "").slice(0, 300)}</Muted> : null}
          <View style={styles.pillRow}>
            <Pill label={tournament.public_phase?.label || formatStatus(tournament.status)} accent="cyan" />
            <Pill label={formatDate(tournament.start_date)} />
            <Pill label={tournament.format_label || tournament.format || "Format offen"} />
            <Pill label={`${tournament.participant_count ?? tournament.participants?.length ?? registrations.length ?? 0}${tournament.max_participants ? `/${tournament.max_participants}` : ""} Teilnehmer`} />
          </View>
        </View>

        {error ? <Muted style={styles.error}>{error}</Muted> : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {tabs.map((item) => (
            <Pressable key={item.key} onPress={() => setTab(item.key)} style={[styles.tab, tab === item.key && styles.tabActive]}>
              <Muted style={[styles.tabText, tab === item.key && styles.tabTextActive]}>{item.label}</Muted>
            </Pressable>
          ))}
        </ScrollView>

        {tab === "overview" ? (
          <>
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
                {isTeamTournament && canSelfRegister && !manageableTeams.length ? (
                  <Muted style={styles.errorText}>Für dieses Team-Turnier brauchst du ein Team, das du als Leader oder Co-Leader verwalten darfst.</Muted>
                ) : null}
                {guest ? (
                  <Muted>Zum Anmelden bitte mit deinem Account einloggen.</Muted>
                ) : registered ? (
                  <>
                    <Muted style={styles.success}>Du bist angemeldet: {formatStatus(ownRegistration?.status)}</Muted>
                    {canCheckIn ? <Button label={busy ? "Check-in läuft ..." : "Jetzt einchecken"} onPress={checkIn} disabled={busy} /> : null}
                    {canSelfUnregister ? (
                      <Button label={busy ? "Wird abgemeldet ..." : "Vom Turnier abmelden"} variant="secondary" onPress={unregister} disabled={busy} />
                    ) : (
                      <Muted>Abmeldung ist für diese Anmeldung aktuell nicht möglich.</Muted>
                    )}
                  </>
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
                <Stat label="Engine" value={bracket.engine || "legacy"} />
              </View>
              <Info label="Event" value={tournament.event?.name || "-"} />
              <Info label="Ort" value={tournament.event?.location || "-"} />
              <Info label="Anmeldung" value={registration.label} />
              <Info label="Modus" value={formatTeamMode(tournament.team_mode)} />
              {tournament.show_chat ? (
                <Button
                  label="Turnier-Chat öffnen"
                  onPress={() => navigation.navigate("TournamentChat", { id: tournament.id, title: `${tournament.title} Chat` })}
                  variant="secondary"
                />
              ) : null}
            </Card>
            <Card style={styles.card}>
              <Heading>Nächste Matches</Heading>
              {allMatches.length ? allMatches.slice(0, 5).map((match) => (
                <MatchCard key={match.id} match={match} regMap={regMap} compact onPress={() => navigation.navigate("MatchDetail", { id: match.id })} />
              )) : <Muted>Noch keine Matches generiert.</Muted>}
            </Card>
          </>
        ) : null}

        {tab === "bracket" ? (
          <Card style={styles.card}>
            <Heading>Turnierbaum</Heading>
            {allMatches.length ? <BracketView payload={bracket} regMap={regMap} onOpenMatch={(id) => navigation.navigate("MatchDetail", { id })} /> : <Muted>Noch kein Turnierbaum veröffentlicht.</Muted>}
          </Card>
        ) : null}

        {tab === "matches" ? (
          <Card style={styles.card}>
            <Heading>Matchplan</Heading>
            {allMatches.length ? allMatches.map((match) => <MatchCard key={match.id} match={match} regMap={regMap} onPress={() => navigation.navigate("MatchDetail", { id: match.id })} />) : <Muted>Noch keine Matches veröffentlicht.</Muted>}
          </Card>
        ) : null}

        {tab === "standings" ? (
          <Card style={styles.card}>
            <Heading>Rangliste</Heading>
            {standings.length ? standings.map((standing, index) => (
              <View key={`${standing.registration_id || standing.name || standing.display_name || index}`} style={styles.row}>
                <Body style={styles.rank}>#{standing.rank || index + 1}</Body>
                <View style={styles.rowMain}>
                  <Body style={styles.rowTitle}>{standing.display_name || standing.name || "Teilnehmer"}</Body>
                  <Muted>{standing.result || `${standing.points || 0} Punkte · ${standing.won || standing.wins || 0} Siege`}</Muted>
                </View>
              </View>
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
                  <Muted>{registration.status || registration.registration_type || "registriert"}</Muted>
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
            {prizes.length ? prizes.map((prize) => <Bullet key={prize} text={prize} accent />) : null}
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
  );
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
  const isTeamTournament = (tournament.team_mode || "solo") !== "solo";
  const sourceSlug = tournament.game?.identity_game_slug || tournament.game?.slug || "";
  const gameSlug = tournament.game?.slug || "";
  const initialIds = useMemo(() => ({
    ...((sourceSlug && user?.game_ids?.[sourceSlug]) || {}),
    ...((gameSlug && user?.game_ids?.[gameSlug]) || {}),
  }), [gameSlug, sourceSlug, user?.game_ids]);
  const [playerIds, setPlayerIds] = useState<Record<string, string>>(initialIds);
  const [teamId, setTeamId] = useState(teams[0]?.id || "");

  useEffect(() => {
    if (!visible) return;
    setPlayerIds(initialIds);
    setTeamId(teams[0]?.id || "");
  }, [initialIds, teams, visible]);

  const missingRequired = fields.some((field) => field.required !== false && !String(playerIds[field.key] || "").trim());
  const canSubmit = !busy && (!isTeamTournament || Boolean(teamId)) && !missingRequired;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <View style={styles.modalHead}>
              <View style={styles.flex}>
                <Heading>Turnier-Anmeldung</Heading>
                <Muted>{isTeamTournament ? "Wähle dein verwaltbares Team aus." : `${tournament.game?.display_name || tournament.game?.name || "Dieses Spiel"} benötigt diese Angaben.`}</Muted>
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

            <Muted>Mit der Anmeldung akzeptierst du die Turnierregeln und die Datenschutzhinweise.</Muted>
            {missingRequired ? <Muted style={styles.errorText}>Bitte alle Pflicht-IDs ausfüllen.</Muted> : null}

            <View style={styles.formActions}>
              <Button label="Abbrechen" variant="secondary" onPress={onClose} disabled={busy} />
              <Button label={busy ? "Sendet ..." : "Anmelden"} onPress={() => onSubmit({ team_id: isTeamTournament ? teamId : null, player_ids: playerIds })} disabled={!canSubmit} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function BracketView({ payload, regMap, onOpenMatch }: { payload: BracketPayload; regMap: Map<string, any>; onOpenMatch?: (id: string) => void }) {
  const matchesV2 = payload.matches_v2 || [];
  const legacy = payload.matches || [];
  const sections = useMemo(() => {
    const source = matchesV2.length ? matchesV2 : legacy;
    const grouped = new Map<string, Map<number, any[]>>();
    source.forEach((match) => {
      const section = match.section || match.bracket || "MAIN";
      const round = Number(match.round || 1);
      if (!grouped.has(section)) grouped.set(section, new Map());
      const sectionMap = grouped.get(section)!;
      sectionMap.set(round, [...(sectionMap.get(round) || []), match]);
    });
    return Array.from(grouped.entries()).map(([section, roundMap]) => ({
      section,
      rounds: Array.from(roundMap.entries()).sort((a, b) => a[0] - b[0]),
    }));
  }, [legacy, matchesV2]);

  return (
    <View style={styles.bracketWrap}>
      {sections.map((section) => (
        <View key={section.section} style={styles.bracketSection}>
          <Muted style={styles.sectionLabel}>{formatSection(section.section)}</Muted>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rounds}>
            {section.rounds.map(([round, matches]) => (
              <View key={`${section.section}-${round}`} style={styles.roundCol}>
                <Muted style={styles.roundTitle}>{matches[0]?.round_name || `Runde ${round}`}</Muted>
                {matches.map((match) => <MatchCard key={match.id} match={match} regMap={regMap} compact onPress={match.id ? () => onOpenMatch?.(match.id) : undefined} />)}
              </View>
            ))}
          </ScrollView>
        </View>
      ))}
    </View>
  );
}

function MatchCard({ match, regMap, compact = false, onPress }: { match: any; regMap: Map<string, any>; compact?: boolean; onPress?: () => void }) {
  const rows = match.slots?.length
    ? match.slots.map((slot: any) => {
        const reg = regMap.get(slot.registration_id);
        const result = (match.results || []).find((item: any) => item.registration_id === slot.registration_id);
        return { id: slot.slot || slot.registration_id, label: participantLabel(reg) || slot.source?.raw || "Offen", score: result?.score ?? result?.points, rank: result?.rank, winner: result?.rank === 1 || result?.qualified };
      })
    : [
        { id: "a", label: participantLabel(regMap.get(match.participant_a_id)) || "Offen", score: match.score_a, winner: match.winner_id && match.winner_id === match.participant_a_id },
        { id: "b", label: participantLabel(regMap.get(match.participant_b_id)) || "Offen", score: match.score_b, winner: match.winner_id && match.winner_id === match.participant_b_id },
      ];
  const content = (
    <View style={[styles.matchCard, compact && styles.matchCardCompact]}>
      <View style={styles.matchHead}>
        <Muted style={styles.matchKey}>{match.match_key || match.round_name || "Match"}</Muted>
        <Muted style={styles.status}>{formatStatus(match.status)}</Muted>
      </View>
      {rows.map((row: any) => (
        <View key={String(row.id)} style={[styles.matchRow, row.winner && styles.matchWinner]}>
          <Body style={[styles.matchName, row.winner && styles.matchWinnerText]} numberOfLines={1}>{row.label}</Body>
          <Body style={styles.matchScore}>{row.rank ? `#${row.rank}` : row.score ?? "-"}</Body>
        </View>
      ))}
      <View style={styles.matchMeta}>
        {match.scheduled_at ? <Muted>{formatDateTime(match.scheduled_at)}</Muted> : <Muted>Zeit noch offen</Muted>}
        {match.station_label || match.station_name ? <Muted style={styles.textCyan}>{match.station_label || match.station_name}</Muted> : null}
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

function participantLabel(registration: any) {
  if (!registration) return "";
  return registration.display_name || registration.ingame_name || registration.user?.display_name || registration.user?.username || registration.name || "";
}

function formatSection(value: string) {
  const normalized = String(value || "MAIN").toLowerCase();
  if (["winner", "wb"].includes(normalized)) return "Winner Bracket";
  if (["loser", "lb"].includes(normalized)) return "Loser Bracket";
  if (["grand_final", "gf"].includes(normalized)) return "Grand Final";
  if (normalized === "bronze") return "Bronze Match";
  return value || "Main";
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
  content: {
    gap: 14,
    padding: 18,
    paddingBottom: 30,
  },
  hero: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  tabs: {
    gap: 8,
    paddingRight: 18,
  },
  tab: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tabActive: {
    backgroundColor: "rgba(41,182,232,0.16)",
    borderColor: "rgba(41,182,232,0.42)",
  },
  tabText: {
    fontWeight: "900",
  },
  tabTextActive: {
    color: colors.cyan,
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
    borderRadius: 6,
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
  statGrid: {
    flexDirection: "row",
    gap: 10,
  },
  registrationBox: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.border,
    borderRadius: 7,
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
  errorText: {
    color: colors.live,
    fontWeight: "800",
  },
  stat: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.border,
    borderRadius: 6,
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
  },
  rowTitle: {
    fontWeight: "900",
  },
  rank: {
    color: colors.gold,
    fontWeight: "900",
    minWidth: 34,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: colors.border,
    borderRadius: 8,
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
    borderRadius: 6,
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
  modalBackdrop: {
    backgroundColor: "rgba(0,0,0,0.78)",
    flex: 1,
    justifyContent: "center",
    padding: 18,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
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
    borderRadius: 7,
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
