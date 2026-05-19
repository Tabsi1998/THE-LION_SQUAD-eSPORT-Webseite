import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
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

export function TournamentDetailScreen({ route }: Props) {
  const [tournament, setTournament] = useState<Tournament | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await api.get<Tournament>(`/tournaments/${route.params.id}`);
      setTournament(data);
    } catch (err) {
      setError(errorMessage(err, "Turnierdetail konnte nicht geladen werden."));
    } finally {
      setLoading(false);
    }
  }, [route.params.id]);

  useEffect(() => {
    load();
  }, [load]);

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
      ? tournament.rules.split("\n").map((line) => line.replace(/^[-#*\s]+/, "").trim()).filter(Boolean).slice(0, 10)
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
          {tournament.description ? <Muted>{tournament.description.replace(/[#*_`]/g, "").slice(0, 260)}</Muted> : null}
          <View style={styles.pillRow}>
            <Pill label={tournament.public_phase?.label || formatStatus(tournament.status)} accent="cyan" />
            <Pill label={formatDate(tournament.start_date)} />
            <Pill label={tournament.format_label || tournament.format || "Format offen"} />
            <Pill label={`${tournament.participant_count ?? tournament.participants?.length ?? 0}${tournament.max_participants ? `/${tournament.max_participants}` : ""} Teilnehmer`} />
          </View>
        </View>

        <Card style={styles.card}>
          <Heading>Match-Hub</Heading>
          <Muted>Ergebnisse, Check-ins und Disputes liegen in der App an einem Ort.</Muted>
          {(tournament.matches || []).length ? (
            tournament.matches?.map((match) => (
              <View key={match.id} style={styles.row}>
                <View style={styles.rowMain}>
                  <Body style={styles.rowTitle}>{match.opponent_name || "Gegner offen"}</Body>
                  <Muted>{formatDate(match.scheduled_at)} · {formatStatus(match.status)}</Muted>
                </View>
                <Muted style={styles.actionHint}>Details</Muted>
              </View>
            ))
          ) : (
            <Muted>Noch keine Matches für diese Challenge.</Muted>
          )}
        </Card>

        <Card style={styles.card}>
          <Heading>Rangliste</Heading>
          {tournament.standings?.length ? tournament.standings?.map((standing) => (
            <View key={`${standing.rank}-${standing.name}`} style={styles.row}>
              <Body style={styles.rank}>#{standing.rank}</Body>
              <View style={styles.rowMain}>
                <Body style={styles.rowTitle}>{standing.name}</Body>
                <Muted>{standing.result || `${standing.points || 0} Punkte`}</Muted>
              </View>
            </View>
          )) : <Muted>Rangliste wird angezeigt, sobald Ergebnisse vorhanden sind.</Muted>}
        </Card>

        <Card style={styles.card}>
          <Heading>Teilnehmer</Heading>
          <View style={styles.wrap}>
            {tournament.participants?.length ? tournament.participants?.map((name) => <Pill key={name} label={name} />) : <Muted>Aktuell sind {tournament.participant_count || 0} Teilnehmer registriert.</Muted>}
          </View>
        </Card>

        <Card style={styles.card}>
          <Heading>Regeln & Preise</Heading>
          {rules.length ? rules.map((rule) => <Bullet key={rule} text={rule} />) : <Muted>Keine Regeln veröffentlicht.</Muted>}
          {prizes.length ? prizes.map((prize) => <Bullet key={prize} text={prize} accent />) : null}
        </Card>
      </ScrollView>
    </Screen>
  );
}

function Pill({ label, accent }: { label: string; accent?: "cyan" }) {
  return (
    <View style={[styles.pill, accent === "cyan" && styles.pillAccent]}>
      <Muted style={[styles.pillText, accent === "cyan" && styles.pillTextAccent]}>{label}</Muted>
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
  actionHint: {
    color: colors.cyan,
    fontWeight: "800",
  },
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
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
});
