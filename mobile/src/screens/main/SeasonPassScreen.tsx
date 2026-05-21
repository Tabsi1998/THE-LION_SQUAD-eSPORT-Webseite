import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Card } from "../../components/Card";
import { EmptyState, ErrorState, SkeletonList } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { api, errorMessage } from "../../lib/api";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";

type Props = NativeStackScreenProps<MoreStackParamList, "SeasonPass">;

type SourceBreakdown = {
  entries?: number;
  label?: string;
  source_type?: string;
  total_points?: number;
  wins?: number;
};

type JahreswertungEntry = {
  achievement_count?: number;
  achievement_points?: number;
  avatar_url?: string | null;
  display_name?: string;
  events?: number;
  events_count?: number;
  id?: string;
  profile_points?: number;
  points?: number;
  rank: number;
  season_points?: number;
  source_breakdown?: SourceBreakdown[];
  total_points?: number;
  user_id?: string;
  username?: string;
  wins?: number;
};

type JahreswertungSeason = {
  banner_url?: string | null;
  description?: string;
  drop_worst?: number;
  end_date?: string;
  id?: string;
  kind?: string;
  name?: string;
  slug?: string;
  start_date?: string;
  status?: string;
};

type JahreswertungData = {
  season?: JahreswertungSeason | null;
  standings: JahreswertungEntry[];
};

export function SeasonPassScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [data, setData] = useState<JahreswertungData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const { data: featured } = await api.get<JahreswertungData>("/seasons/active/featured");
      const season = featured?.season || null;
      if (!season) {
        setData({ season: null, standings: [] });
        return;
      }
      const seasonRef = season.slug || season.id;
      const { data: standingsData } = seasonRef
        ? await api.get<JahreswertungData>(`/seasons/${seasonRef}/standings`)
        : { data: featured };
      setData({
        season: standingsData?.season || season,
        standings: standingsData?.standings || featured?.standings || [],
      });
    } catch (err) {
      setError(errorMessage(err, "Jahreswertung konnte nicht geladen werden."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <Screen>
        <SkeletonList count={4} hasImage={false} />
      </Screen>
    );
  }

  if (!data && error) {
    return (
      <Screen>
        <ErrorState title="Jahreswertung nicht verfügbar" detail={error} />
      </Screen>
    );
  }

  const leaderboard = data?.standings ?? [];
  const top3 = leaderboard.slice(0, 3);
  const rest = leaderboard.slice(3);
  const ownEntry = useMemo(() => {
    const userId = user?.id;
    const username = user?.username;
    return leaderboard.find((entry) => (userId && (entry.user_id === userId || entry.id === userId)) || (username && entry.username === username)) || null;
  }, [leaderboard, user?.id, user?.username]);
  const totalPoints = leaderboard.reduce((sum, row) => sum + entryPoints(row), 0);
  const totalProfilePoints = leaderboard.reduce((sum, row) => sum + Number(row.profile_points || row.achievement_points || 0), 0);
  const totalRatings = leaderboard.reduce((sum, row) => sum + entryEvents(row), 0);
  const season = data?.season;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.cyan}
          />
        }
      >
        {/* Header */}
        <View style={styles.heroSection}>
          <View style={styles.heroIcon}>
            <Ionicons name="trophy-outline" color={colors.gold} size={38} />
          </View>
          <Title style={styles.heroTitle}>
            {season?.name ?? `TLS Jahreswertung ${new Date().getFullYear()}`}
          </Title>
          <Muted style={styles.heroSub}>
            {season?.description ?? "Turniere, Fast-Lap-Challenges, bestätigte Events und manuelle Admin-Wertungen ergeben die Jahreswertung. Profilpunkte bleiben sichtbar getrennt."}
          </Muted>
          {season?.start_date || season?.end_date ? (
            <Muted style={styles.dateRange}>
              {season.start_date ? formatDate(season.start_date) : "Start offen"}
              {season.end_date ? ` - ${formatDate(season.end_date)}` : ""}
            </Muted>
          ) : null}
        </View>

        <View style={styles.statGrid}>
          <StatCard icon="people-outline" label="Teilnehmer" value={String(leaderboard.length)} />
          <StatCard icon="bar-chart-outline" label="Jahrespunkte" value={formatPoints(totalPoints)} tone="gold" />
          <StatCard icon="flag-outline" label="Wertungen" value={String(totalRatings)} />
          <StatCard icon="star-outline" label="Profilpunkte" value={formatPoints(totalProfilePoints)} />
        </View>

        {/* Eigener Rang */}
        {ownEntry ? (
          <Card style={styles.card}>
            <Heading>Dein Rang</Heading>
            <RankRow entry={ownEntry} highlight />
            <SourceBreakdownList entry={ownEntry} />
          </Card>
        ) : null}

        {/* Top 3 Podium */}
        {top3.length > 0 ? (
          <Card style={styles.card}>
            <Heading>Podium</Heading>
            {top3.map((entry) => (
              <RankRow
                key={entry.user_id}
                entry={entry}
                onPress={() => entry.username ? navigation.navigate("PublicProfile", { username: entry.username }) : undefined}
              />
            ))}
          </Card>
        ) : null}

        {/* Restliche Rangliste */}
        {rest.length > 0 ? (
          <Card style={styles.card}>
            <Heading>Rangliste</Heading>
            {rest.map((entry) => (
              <RankRow
                key={entry.user_id}
                entry={entry}
                onPress={() => entry.username ? navigation.navigate("PublicProfile", { username: entry.username }) : undefined}
              />
            ))}
          </Card>
        ) : null}

        {leaderboard.length === 0 ? (
          <Card style={styles.card}>
            <EmptyState icon="podium-outline" title="Noch keine Einträge" detail="Sobald Wertungen freigegeben sind, erscheint hier die Jahresrangliste." tone="gold" />
          </Card>
        ) : null}

        {/* Punkte-Erklärung */}
        <Card style={styles.card}>
          <Heading>Wie zählt die Jahreswertung?</Heading>
          <PointRow icon="trophy-outline" label="Turniere" detail="Teilnahme zählt, Platzierungen und größere Teilnehmerfelder zählen mehr." />
          <PointRow icon="timer-outline" label="Fast Lap" detail="Gültige Zeiten, starke Ränge und veröffentlichte Challenges fließen ein." />
          <PointRow icon="calendar-outline" label="Events" detail="Check-ins zählen nur, wenn sie ausdrücklich als Jahreswertung gepflegt sind." />
          <PointRow icon="shield-checkmark-outline" label="Fair und nachvollziehbar" detail={season?.drop_worst ? `${season.drop_worst} schwächste Wertung(en) werden gestrichen.` : "Aktuell zählen alle gepflegten Wertungen."} />
          <PointRow icon="star-outline" label="Profilpunkte" detail="Achievements erklären dein Profil-Level, werden aber nicht heimlich in die Jahreswertung gemischt." />
        </Card>
      </ScrollView>
    </Screen>
  );
}

function RankRow({
  entry,
  highlight = false,
  onPress,
}: {
  entry: JahreswertungEntry;
  highlight?: boolean;
  onPress?: () => void;
}) {
  const rankColor = entry.rank === 1 ? colors.gold : entry.rank === 2 ? "#C0C0C0" : entry.rank === 3 ? "#CD7F32" : colors.muted;
  const rankIcon = entry.rank === 1 ? "trophy-outline" : entry.rank === 2 || entry.rank === 3 ? "medal-outline" : null;

  const content = (
    <View style={[styles.rankRow, highlight && styles.rankRowHighlight]}>
      <View style={styles.rankBadge}>
        {rankIcon ? (
          <Ionicons name={rankIcon} color={rankColor} size={22} />
        ) : (
          <Muted style={[styles.rankNum, { color: rankColor }]}>#{entry.rank}</Muted>
        )}
      </View>
      <View style={styles.rankInfo}>
        <Body style={[styles.rankName, highlight && styles.rankNameHighlight]}>
          {entry.display_name || entry.username || "Unbekannt"}
        </Body>
        {entry.username ? <Muted>@{entry.username}</Muted> : null}
        <Muted>{entryEvents(entry)} Wertungen · {entry.wins || 0} Siege · {entry.achievement_count || 0} Profil-Erfolge</Muted>
      </View>
      <View style={styles.rankPoints}>
        <Body style={[styles.pointsValue, { color: highlight ? colors.cyan : colors.white }]}>
          {formatPoints(entryPoints(entry))}
        </Body>
        <Muted style={styles.pointsLabel}>Pkt.</Muted>
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

function SourceBreakdownList({ entry }: { entry: JahreswertungEntry }) {
  const items = (entry.source_breakdown || []).slice(0, 4);
  if (!items.length) return null;
  return (
    <View style={styles.breakdown}>
      {items.map((item) => (
        <View key={`${item.source_type || item.label}-${item.total_points}`} style={styles.breakdownItem}>
          <Muted style={styles.breakdownLabel}>{item.label || item.source_type || "Wertung"}</Muted>
          <Body style={styles.breakdownPoints}>{formatPoints(item.total_points || 0)} Pkt.</Body>
        </View>
      ))}
    </View>
  );
}

function StatCard({ icon, label, value, tone = "cyan" }: { icon: string; label: string; value: string; tone?: "cyan" | "gold" }) {
  const color = tone === "gold" ? colors.gold : colors.cyan;
  return (
    <Card style={styles.statCard}>
      <Ionicons name={icon as any} color={color} size={18} />
      <Body style={[styles.statValue, { color }]}>{value}</Body>
      <Muted style={styles.statLabel}>{label}</Muted>
    </Card>
  );
}

function PointRow({ icon, label, detail }: { icon: string; label: string; detail: string }) {
  return (
    <View style={styles.pointRow}>
      <Ionicons name={icon as any} color={colors.cyan} size={16} />
      <View style={styles.pointText}>
        <Body style={styles.pointTitle}>{label}</Body>
        <Muted>{detail}</Muted>
      </View>
    </View>
  );
}

function entryPoints(entry: JahreswertungEntry) {
  return Number(entry.points ?? entry.total_points ?? entry.season_points ?? 0);
}

function entryEvents(entry: JahreswertungEntry) {
  return Number(entry.events_count ?? entry.events ?? 0);
}

function formatPoints(value: number) {
  if (!Number.isFinite(value)) return "0";
  return (Number.isInteger(value) ? value : Number(value.toFixed(1))).toLocaleString("de-AT");
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return iso;
  }
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    paddingBottom: 32,
  },
  heroSection: {
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 8,
  },
  heroIcon: {
    alignItems: "center",
    backgroundColor: "rgba(240,180,41,0.12)",
    borderColor: "rgba(240,180,41,0.3)",
    borderRadius: 32,
    borderWidth: 1,
    height: 64,
    justifyContent: "center",
    width: 64,
  },
  heroTitle: {
    color: colors.gold,
    textAlign: "center",
  },
  heroSub: {
    textAlign: "center",
    lineHeight: 20,
  },
  dateRange: {
    color: colors.muted,
  },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingHorizontal: 18,
  },
  statCard: {
    flexBasis: "47%",
    flexGrow: 1,
    gap: 4,
    minHeight: 92,
  },
  statValue: {
    fontSize: 22,
    fontWeight: "900",
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  card: {
    gap: 10,
    marginHorizontal: 18,
  },
  rankRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingTop: 10,
  },
  rankRowHighlight: {
    backgroundColor: "rgba(41,182,232,0.06)",
    borderRadius: 8,
    borderTopWidth: 0,
    marginTop: 4,
    padding: 10,
  },
  rankBadge: {
    alignItems: "center",
    width: 32,
  },
  rankNum: {
    fontWeight: "900",
    fontSize: 15,
  },
  rankInfo: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  rankName: {
    fontWeight: "900",
  },
  rankNameHighlight: {
    color: colors.cyan,
  },
  rankPoints: {
    alignItems: "flex-end",
    gap: 1,
  },
  pointsValue: {
    fontWeight: "900",
    fontSize: 16,
  },
  pointsLabel: {
    fontSize: 11,
  },
  breakdown: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: 7,
    paddingTop: 10,
  },
  breakdownItem: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  breakdownLabel: {
    flex: 1,
  },
  breakdownPoints: {
    color: colors.cyan,
    fontSize: 13,
    fontWeight: "900",
  },
  pointRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingTop: 8,
  },
  pointText: {
    flex: 1,
    gap: 2,
  },
  pointTitle: {
    fontWeight: "900",
  },
  pressed: {
    opacity: 0.72,
  },
});
