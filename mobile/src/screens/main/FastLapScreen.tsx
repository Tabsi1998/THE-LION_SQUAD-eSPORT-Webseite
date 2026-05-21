import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { Card } from "../../components/Card";
import { EmptyState, SkeletonList } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import { formatDate, formatStatus } from "../../lib/format";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import type { F1Challenge } from "../../types";

type Props = NativeStackScreenProps<MoreStackParamList, "FastLapList">;

export function FastLapScreen({ navigation }: Props) {
  const [items, setItems] = useState<F1Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await api.get<F1Challenge[]>("/f1/challenges", { params: { limit: 100 } });
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(errorMessage(err, "Fast-Lap Challenges konnten nicht geladen werden."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const featured = useMemo(() => items.find(isActiveChallenge) || items[0] || null, [items]);
  const listItems = useMemo(() => (featured ? items.filter((item) => item.id !== featured.id) : items), [featured, items]);
  const activeCount = useMemo(() => items.filter(isActiveChallenge).length, [items]);

  if (loading) {
    return (
      <Screen>
        <SkeletonList count={5} hasImage />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <FlatList
        data={listItems}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.headerTop}>
              <View style={styles.headerIcon}>
                <Ionicons name="speedometer-outline" color={colors.black} size={22} />
              </View>
              <View style={styles.headerText}>
                <Muted style={styles.eyebrow}>Racing</Muted>
                <Title>Fast Laps</Title>
              </View>
            </View>
            {error ? (
              <Muted style={styles.error}>{error}</Muted>
            ) : (
              <Muted>Challenges, Strecken, Bestzeiten und Referenzzeiten aus der Live-Webseite.</Muted>
            )}
            <View style={styles.stats}>
              <Stat label="Challenges" value={items.length} />
              <Stat label="Aktiv" value={activeCount} tone="gold" />
            </View>
            {featured ? (
              <FeaturedChallengeCard
                item={featured}
                onPress={() => navigation.navigate("FastLapDetail", { id: featured.slug || featured.id })}
              />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          featured ? null : (
            <EmptyState title="Keine Fast-Lap Challenges" detail="Sobald Challenges veröffentlicht sind, erscheinen sie hier." />
          )
        }
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
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <ChallengeCard item={item} onPress={() => navigation.navigate("FastLapDetail", { id: item.slug || item.id })} />
        )}
      />
    </Screen>
  );
}

function FeaturedChallengeCard({ item, onPress }: { item: F1Challenge; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>
      <Card style={styles.featuredCard}>
        <MediaImage
          uri={item.banner_url}
          style={styles.featuredImage}
          fallback={<Ionicons name="speedometer-outline" color={colors.gold} size={30} />}
        />
        <View style={styles.featuredBody}>
          <View style={styles.top}>
            <Heading style={styles.featuredTitle}>{item.title}</Heading>
            <StatusBadge item={item} />
          </View>
          <Muted>{formatDate(item.start_date)} · {item.track_count || 0} Strecken · {item.participant_count || 0} Fahrer</Muted>
          <MetaPills item={item} />
          <View style={styles.openRow}>
            <Muted style={styles.openHint}>Zeiten ansehen</Muted>
            <Ionicons name="chevron-forward" color={colors.cyan} size={15} />
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

function ChallengeCard({ item, onPress }: { item: F1Challenge; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>
      <Card style={styles.card}>
        <MediaImage
          uri={item.banner_url}
          style={styles.image}
          fallback={<Ionicons name="speedometer-outline" color={colors.gold} size={24} />}
        />
        <View style={styles.text}>
          <View style={styles.top}>
            <Body style={styles.title}>{item.title}</Body>
            <StatusBadge item={item} />
          </View>
          <Muted>{formatDate(item.start_date)} · {item.track_count || 0} Strecken · {item.participant_count || 0} Fahrer</Muted>
          <MetaPills item={item} />
        </View>
      </Card>
    </Pressable>
  );
}

function MetaPills({ item }: { item: F1Challenge }) {
  const values = [item.vehicle, item.platform, item.weather].filter(Boolean).slice(0, 3) as string[];
  if (!values.length) return null;
  return (
    <View style={styles.metaRow}>
      {values.map((value) => <Pill key={value} label={value} />)}
    </View>
  );
}

function StatusBadge({ item }: { item: F1Challenge }) {
  const active = isActiveChallenge(item);
  return (
    <View style={[styles.badge, active && styles.badgeActive]}>
      <Muted style={[styles.badgeText, active && styles.badgeTextActive]}>
        {item.public_phase?.label || formatStatus(item.status)}
      </Muted>
    </View>
  );
}

function Stat({ label, value, tone = "cyan" }: { label: string; value: number; tone?: "cyan" | "gold" }) {
  return (
    <View style={styles.stat}>
      <Body style={[styles.statValue, tone === "gold" && styles.gold]}>{value}</Body>
      <Muted>{label}</Muted>
    </View>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <View style={styles.pill}>
      <Muted style={styles.pillText}>{label}</Muted>
    </View>
  );
}

function isActiveChallenge(item: F1Challenge) {
  const status = `${item.status || ""} ${item.public_phase?.label || ""}`.toLowerCase();
  return status.includes("live") || status.includes("open") || status.includes("aktiv") || status.includes("anmeldung");
}

const styles = StyleSheet.create({
  list: {
    gap: 12,
    paddingBottom: 24,
    paddingHorizontal: 18,
  },
  header: {
    gap: 12,
    marginBottom: 2,
    paddingTop: 4,
  },
  headerTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  headerIcon: {
    alignItems: "center",
    backgroundColor: colors.gold,
    borderRadius: 10,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  eyebrow: {
    color: colors.gold,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  stats: {
    flexDirection: "row",
    gap: 10,
  },
  stat: {
    backgroundColor: "rgba(255,255,255,0.045)",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    padding: 10,
  },
  statValue: {
    color: colors.cyan,
    fontSize: 20,
    fontWeight: "900",
  },
  featuredCard: {
    gap: 0,
    overflow: "hidden",
    padding: 0,
  },
  featuredImage: {
    borderWidth: 0,
    height: 164,
    width: "100%",
  },
  featuredBody: {
    gap: 7,
    padding: 14,
  },
  featuredTitle: {
    flex: 1,
  },
  card: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  image: {
    borderRadius: 8,
    height: 88,
    width: 92,
  },
  text: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  top: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
  },
  title: {
    flex: 1,
    fontWeight: "900",
  },
  badge: {
    backgroundColor: "rgba(41, 182, 232, 0.1)",
    borderColor: "rgba(41, 182, 232, 0.28)",
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  badgeActive: {
    backgroundColor: "rgba(255, 215, 0, 0.12)",
    borderColor: "rgba(255, 215, 0, 0.32)",
  },
  badgeText: {
    color: colors.cyan,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  badgeTextActive: {
    color: colors.gold,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  pill: {
    backgroundColor: "rgba(41, 182, 232, 0.12)",
    borderColor: "rgba(41, 182, 232, 0.28)",
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pillText: {
    color: colors.cyan,
    fontSize: 12,
    fontWeight: "900",
  },
  openRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  openHint: {
    color: colors.cyan,
    fontWeight: "900",
  },
  gold: {
    color: colors.gold,
  },
  pressed: {
    opacity: 0.72,
  },
  error: {
    color: colors.live,
  },
});
