import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Card } from "../../components/Card";
import { EmptyState, SkeletonList } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { api, errorMessage } from "../../lib/api";
import { formatDate, formatDateTime, formatStatus } from "../../lib/format";
import { getRegistrationState, hasOnlineRegistration } from "../../lib/registration";
import { colors } from "../../theme";
import type { F1Challenge, F1LeaderboardEntry, F1LeaderboardPayload, F1Track } from "../../types";

type Props = { route: { params: { id: string } } };

export function FastLapDetailScreen({ route }: Props) {
  const { user } = useAuth();
  const [challenge, setChallenge] = useState<F1Challenge | null>(null);
  const [leaderboard, setLeaderboard] = useState<F1LeaderboardPayload | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const tracks = challenge?.tracks || [];
  const activeTrackId = selectedTrackId || tracks[0]?.id || null;

  const load = useCallback(async (trackId?: string | null) => {
    setError("");
    try {
      const challengeResult = await api.get<F1Challenge>(`/f1/challenges/${route.params.id}`);
      const nextChallenge = challengeResult.data;
      const nextTrackId = trackId || nextChallenge.tracks?.[0]?.id || null;
      setChallenge(nextChallenge);
      setSelectedTrackId(nextTrackId);
      const leaderboardResult = await api.get<F1LeaderboardPayload>(`/f1/challenges/${nextChallenge.slug || nextChallenge.id}/leaderboard`, {
        params: nextTrackId ? { track_id: nextTrackId } : undefined,
      });
      setLeaderboard(leaderboardResult.data);
    } catch (err) {
      setError(errorMessage(err, "Fast-Lap Zeiten konnten nicht geladen werden."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [route.params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const best = useMemo(() => leaderboard?.entries?.[0], [leaderboard]);
  const registration = useMemo(() => getRegistrationState(challenge, "Einreichung"), [challenge]);
  const showRegistrationInfo = hasOnlineRegistration(challenge) || challenge?.block_club_member_results || challenge?.allow_club_reference_times !== false;

  if (loading) {
    return (
      <Screen>
        <SkeletonList count={4} />
      </Screen>
    );
  }

  if (!challenge) {
    return (
      <Screen>
        <EmptyState title="Challenge nicht gefunden" detail={error || "Diese Challenge ist nicht sichtbar oder wurde entfernt."} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(activeTrackId); }} tintColor={colors.cyan} />}
      >
        <MediaImage
          uri={challenge.banner_url}
          style={styles.hero}
          fallback={<Ionicons name="speedometer-outline" color={colors.gold} size={42} />}
        />
        <View style={styles.header}>
          <Muted>{challenge.public_phase?.label || formatStatus(challenge.status)} · {formatDate(challenge.start_date)}</Muted>
          <Title>{challenge.title}</Title>
          {challenge.description ? <Body>{stripText(challenge.description)}</Body> : null}
          <View style={styles.metaRow}>
            {challenge.vehicle ? <Pill label={challenge.vehicle} /> : null}
            {challenge.platform ? <Pill label={challenge.platform} /> : null}
            {challenge.weather ? <Pill label={challenge.weather} /> : null}
            <Pill label={`${challenge.participant_count || leaderboard?.entries.length || 0} Fahrer`} tone="gold" />
          </View>
        </View>

        {showRegistrationInfo ? (
          <Card style={styles.infoCard}>
            <Heading>Einreichung</Heading>
            {hasOnlineRegistration(challenge) ? (
              <>
                <Muted>{registration.label}</Muted>
                {challenge.registration_open_from || challenge.registration_open_until ? (
                  <Muted>
                    {challenge.registration_open_from ? `Öffnet: ${formatDateTime(challenge.registration_open_from)}` : ""}
                    {challenge.registration_open_from && challenge.registration_open_until ? " · " : ""}
                    {challenge.registration_open_until ? `Endet: ${formatDateTime(challenge.registration_open_until)}` : ""}
                  </Muted>
                ) : null}
              </>
            ) : (
              <Muted>Zeiten werden aktuell durch Admins oder Moderatoren eingetragen.</Muted>
            )}
            {challenge.block_club_member_results ? (
              <Muted style={styles.warning}>
                {user?.is_club_member
                  ? "Als Vereinsmitglied wirst du in dieser Challenge als Referenzzeit außer Wertung geführt."
                  : "Diese Challenge ist für externe Fahrer gewertet. Vereinsmitglieder erscheinen als Referenzzeiten außer Wertung."}
              </Muted>
            ) : challenge.allow_club_reference_times !== false ? (
              <Muted>Vereins-Referenzzeiten sind separat möglich und zählen nicht zur offiziellen Rangliste.</Muted>
            ) : null}
            {challenge.show_club_reference_times === false ? <Muted>Referenzzeiten sind aktuell nur intern sichtbar.</Muted> : null}
          </Card>
        ) : null}

        <View style={styles.section}>
          <Heading>Strecken</Heading>
          {tracks.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
              {tracks.map((track) => (
                <Pressable key={track.id} onPress={() => load(track.id)} style={[styles.tab, activeTrackId === track.id && styles.tabActive]}>
                  <Muted style={[styles.tabText, activeTrackId === track.id && styles.tabTextActive]}>{track.name || "Strecke"}</Muted>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <Muted>Keine Strecken hinterlegt.</Muted>
          )}
        </View>

        {best ? (
          <Card style={styles.bestCard}>
            <Muted>Bestzeit</Muted>
            <Body style={styles.bestTime}>{best.time_str || "-"}</Body>
            <Body style={styles.strong}>{best.display_name || best.username || "Fahrer"}</Body>
            <Muted>{best.attempts || 0} Versuche · {best.gap_str || "Führung"}</Muted>
          </Card>
        ) : null}

        <View style={styles.section}>
          <Heading>Leaderboard</Heading>
          {error ? <Muted style={styles.error}>{error}</Muted> : null}
          {leaderboard?.entries?.length ? (
            leaderboard.entries.map((entry) => <EntryRow key={`${entry.user_id}-${entry.rank}`} entry={entry} />)
          ) : (
            <EmptyState title="Noch keine Zeiten" detail="Sobald Zeiten eingetragen sind, stehen sie hier pro Strecke." />
          )}
        </View>

        {leaderboard?.club_reference_entries?.length ? (
          <View style={styles.section}>
            <Heading>Vereins-Referenzzeiten</Heading>
            {leaderboard.club_reference_entries.map((entry) => <EntryRow key={`ref-${entry.user_id}-${entry.rank}`} entry={entry} reference />)}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function EntryRow({ entry, reference = false }: { entry: F1LeaderboardEntry; reference?: boolean }) {
  return (
    <Card style={[styles.entry, reference && styles.referenceEntry]}>
      <View style={styles.rankBox}>
        <Body style={[styles.rank, Number(entry.rank || 0) <= 3 && entry.rank ? styles.gold : null]}>{entry.rank ? `#${entry.rank}` : "-"}</Body>
      </View>
      <View style={styles.entryText}>
        <Body style={styles.strong}>{entry.display_name || entry.username || "Fahrer"}</Body>
        <Muted>{entry.attempts || 0} Versuche{entry.penalty_seconds ? ` · +${entry.penalty_seconds}s Penalty` : ""}</Muted>
      </View>
      <View style={styles.timeBox}>
        <Body style={styles.time}>{entry.time_str || "-"}</Body>
        <Muted>{entry.gap_str || ""}</Muted>
      </View>
    </Card>
  );
}

function Pill({ label, tone = "cyan" }: { label: string; tone?: "cyan" | "gold" }) {
  return (
    <View style={[styles.pill, tone === "gold" && styles.pillGold]}>
      <Muted style={[styles.pillText, tone === "gold" && styles.pillGoldText]}>{label}</Muted>
    </View>
  );
}

function stripText(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    paddingBottom: 28,
  },
  hero: {
    borderWidth: 0,
    height: 220,
    width: "100%",
  },
  header: {
    gap: 10,
    paddingHorizontal: 18,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  section: {
    gap: 10,
    paddingHorizontal: 18,
  },
  tabs: {
    gap: 8,
    paddingRight: 18,
  },
  tab: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tabActive: {
    backgroundColor: "rgba(240, 180, 41, 0.15)",
    borderColor: "rgba(240, 180, 41, 0.38)",
  },
  tabText: {
    fontWeight: "900",
  },
  tabTextActive: {
    color: colors.gold,
  },
  bestCard: {
    gap: 4,
    marginHorizontal: 18,
  },
  infoCard: {
    gap: 8,
    marginHorizontal: 18,
  },
  warning: {
    color: colors.gold,
    fontWeight: "800",
  },
  bestTime: {
    color: colors.gold,
    fontSize: 30,
    fontWeight: "900",
  },
  entry: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  referenceEntry: {
    borderColor: "rgba(240, 180, 41, 0.34)",
  },
  rankBox: {
    width: 42,
  },
  rank: {
    color: colors.cyan,
    fontSize: 19,
    fontWeight: "900",
  },
  entryText: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  timeBox: {
    alignItems: "flex-end",
    minWidth: 82,
  },
  time: {
    fontWeight: "900",
  },
  strong: {
    fontWeight: "900",
  },
  gold: {
    color: colors.gold,
  },
  pill: {
    backgroundColor: "rgba(41, 182, 232, 0.12)",
    borderColor: "rgba(41, 182, 232, 0.28)",
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pillGold: {
    backgroundColor: "rgba(240, 180, 41, 0.12)",
    borderColor: "rgba(240, 180, 41, 0.32)",
  },
  pillText: {
    color: colors.cyan,
    fontSize: 12,
    fontWeight: "900",
  },
  pillGoldText: {
    color: colors.gold,
  },
  error: {
    color: colors.live,
  },
});
