import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { EmptyState, LoadingState } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import { formatDate, formatStatus } from "../../lib/format";
import type { TournamentStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import type { Tournament } from "../../types";

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

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Info" },
  { key: "bracket", label: "Baum" },
  { key: "matches", label: "Matches" },
  { key: "standings", label: "Tabelle" },
  { key: "participants", label: "Spieler" },
  { key: "rules", label: "Regeln" },
];

export function TournamentDetailScreen({ navigation, route }: Props) {
  const [tournament, setTournament] = useState<Tournament | undefined>();
  const [bracket, setBracket] = useState<BracketPayload>({});
  const [standings, setStandings] = useState<any[]>([]);
  const [tab, setTab] = useState<TabKey>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [detailResult, bracketResult, standingsResult] = await Promise.all([
        api.get<Tournament>(`/tournaments/${route.params.id}`),
        api.get<BracketPayload>(`/tournaments/${route.params.id}/bracket`).catch(() => ({ data: {} })),
        api.get<any[]>(`/tournaments/${route.params.id}/standings`).catch(() => ({ data: [] })),
      ]);
      setTournament(detailResult.data);
      setBracket(bracketResult.data || {});
      setStandings(Array.isArray(standingsResult.data) ? standingsResult.data : []);
    } catch (err) {
      setError(errorMessage(err, "Turnierdetail konnte nicht geladen werden."));
    } finally {
      setLoading(false);
    }
  }, [route.params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const registrations = bracket.registrations || [];
  const regMap = useMemo(() => {
    const map = new Map<string, any>();
    registrations.forEach((registration) => map.set(registration.id, registration));
    return map;
  }, [registrations]);
  const legacyMatches = bracket.matches || tournament?.matches || [];
  const v2Matches = bracket.matches_v2 || [];
  const allMatches = v2Matches.length ? v2Matches : legacyMatches;

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
              <View style={styles.statGrid}>
                <Stat label="Matches" value={String(allMatches.length)} />
                <Stat label="Spieler" value={String(registrations.length || tournament.participant_count || 0)} tone="gold" />
                <Stat label="Engine" value={bracket.engine || "legacy"} />
              </View>
              <Info label="Event" value={tournament.event?.name || "-"} />
              <Info label="Ort" value={tournament.event?.location || "-"} />
              <Info label="Anmeldung" value={tournament.registration_enabled ? "Offen" : "Geschlossen"} />
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
                <MatchCard key={match.id} match={match} regMap={regMap} compact />
              )) : <Muted>Noch keine Matches generiert.</Muted>}
            </Card>
          </>
        ) : null}

        {tab === "bracket" ? (
          <Card style={styles.card}>
            <Heading>Turnierbaum</Heading>
            {allMatches.length ? <BracketView payload={bracket} regMap={regMap} /> : <Muted>Noch kein Turnierbaum veröffentlicht.</Muted>}
          </Card>
        ) : null}

        {tab === "matches" ? (
          <Card style={styles.card}>
            <Heading>Matchplan</Heading>
            {allMatches.length ? allMatches.map((match) => <MatchCard key={match.id} match={match} regMap={regMap} />) : <Muted>Noch keine Matches veröffentlicht.</Muted>}
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
    </Screen>
  );
}

function BracketView({ payload, regMap }: { payload: BracketPayload; regMap: Map<string, any> }) {
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
                {matches.map((match) => <MatchCard key={match.id} match={match} regMap={regMap} compact />)}
              </View>
            ))}
          </ScrollView>
        </View>
      ))}
    </View>
  );
}

function MatchCard({ match, regMap, compact = false }: { match: any; regMap: Map<string, any>; compact?: boolean }) {
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
  return (
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
        {match.scheduled_at ? <Muted>{formatDate(match.scheduled_at)}</Muted> : null}
        {match.station_label || match.station_name ? <Muted style={styles.textCyan}>{match.station_label || match.station_name}</Muted> : null}
      </View>
    </View>
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
});
