import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Card } from "../../components/Card";
import { EmptyState, SkeletonList } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";

type Props = NativeStackScreenProps<MoreStackParamList, "SeasonPass">;

type SeasonPassEntry = {
  rank: number;
  user_id: string;
  display_name: string;
  username?: string;
  avatar_url?: string | null;
  points: number;
  tournaments_played?: number;
  events_attended?: number;
  achievements_earned?: number;
  is_own?: boolean;
};

type SeasonPassData = {
  season_name?: string;
  season_year?: number;
  season_start?: string;
  season_end?: string;
  description?: string;
  prize_description?: string;
  leaderboard: SeasonPassEntry[];
  own_entry?: SeasonPassEntry | null;
  total_participants?: number;
};

export function SeasonPassScreen({ navigation }: Props) {
  const [data, setData] = useState<SeasonPassData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const { data: res } = await api.get<SeasonPassData>("/season-pass");
      setData(res || null);
    } catch (err) {
      setError(errorMessage(err, "Season-Pass konnte nicht geladen werden."));
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
        <EmptyState title="Season-Pass nicht verfügbar" detail={error} />
      </Screen>
    );
  }

  const leaderboard = data?.leaderboard ?? [];
  const top3 = leaderboard.slice(0, 3);
  const rest = leaderboard.slice(3);

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
            {data?.season_name ?? `Season ${data?.season_year ?? new Date().getFullYear()}`}
          </Title>
          <Muted style={styles.heroSub}>
            {data?.description ?? "Sammle das ganze Jahr über Punkte durch Turniere, Events und Achievements. Der Beste gewinnt!"}
          </Muted>
          {data?.prize_description ? (
            <View style={styles.prizeBanner}>
              <Ionicons name="gift-outline" color={colors.gold} size={16} />
              <Body style={styles.prizeText}>{data.prize_description}</Body>
            </View>
          ) : null}
          {data?.season_start && data?.season_end ? (
            <Muted style={styles.dateRange}>
              {formatDate(data.season_start)} - {formatDate(data.season_end)}
            </Muted>
          ) : null}
        </View>

        {/* Eigener Rang */}
        {data?.own_entry ? (
          <Card style={styles.card}>
            <Heading>Dein Rang</Heading>
            <RankRow entry={data.own_entry} highlight />
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
            <View style={styles.emptyBox}>
              <Ionicons name="podium-outline" color={colors.muted} size={36} />
              <Muted style={styles.emptyText}>Noch keine Einträge in dieser Season.</Muted>
            </View>
          </Card>
        ) : null}

        {/* Punkte-Erklärung */}
        <Card style={styles.card}>
          <Heading>Wie bekomme ich Punkte?</Heading>
          <PointRow icon="trophy-outline" label="Turnier gewinnen" points="+50 Pkt." />
          <PointRow icon="medal-outline" label="Turnier Top 3" points="+25 Pkt." />
          <PointRow icon="people-outline" label="Turnier teilnehmen" points="+10 Pkt." />
          <PointRow icon="calendar-outline" label="Event besuchen" points="+15 Pkt." />
          <PointRow icon="star-outline" label="Achievement freischalten" points="+5 Pkt." />
          <PointRow icon="flash-outline" label="Fast Lap Bestzeit" points="+20 Pkt." />
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
  entry: SeasonPassEntry;
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
      </View>
      <View style={styles.rankPoints}>
        <Body style={[styles.pointsValue, { color: highlight ? colors.cyan : colors.white }]}>
          {entry.points.toLocaleString("de-AT")}
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

function PointRow({ icon, label, points }: { icon: string; label: string; points: string }) {
  return (
    <View style={styles.pointRow}>
      <Ionicons name={icon as any} color={colors.cyan} size={16} />
      <Muted style={styles.pointLabel}>{label}</Muted>
      <Body style={styles.pointValue}>{points}</Body>
    </View>
  );
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
  prizeBanner: {
    alignItems: "center",
    backgroundColor: "rgba(240,180,41,0.1)",
    borderColor: "rgba(240,180,41,0.3)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  prizeText: {
    color: colors.gold,
    fontWeight: "900",
    flex: 1,
  },
  dateRange: {
    color: colors.muted,
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
  emptyBox: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 20,
  },
  emptyText: {
    textAlign: "center",
  },
  pointRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingTop: 8,
  },
  pointLabel: {
    flex: 1,
  },
  pointValue: {
    color: colors.cyan,
    fontWeight: "900",
    fontSize: 13,
  },
  pressed: {
    opacity: 0.72,
  },
});
