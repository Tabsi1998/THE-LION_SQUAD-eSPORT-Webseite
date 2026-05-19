import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { Card } from "../../components/Card";
import { EmptyState, LoadingState } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted } from "../../components/Text";
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

  if (loading) {
    return (
      <Screen>
        <LoadingState label="Fast Laps werden geladen ..." />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <Heading>Fast Laps</Heading>
            {error ? <Muted style={styles.error}>{error}</Muted> : <Muted>Challenges, Strecken, Bestzeiten und Referenzzeiten aus der Live-Webseite.</Muted>}
          </View>
        }
        ListEmptyComponent={<EmptyState title="Keine Fast-Lap Challenges" detail="Sobald Challenges veroeffentlicht sind, erscheinen sie hier." />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.cyan} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate("FastLapDetail", { id: item.slug || item.id })} style={({ pressed }) => [pressed && styles.pressed]}>
            <Card style={styles.card}>
              <MediaImage
                uri={item.banner_url}
                style={styles.image}
                fallback={<Ionicons name="speedometer-outline" color={colors.gold} size={28} />}
              />
              <View style={styles.text}>
                <View style={styles.top}>
                  <Body style={styles.title}>{item.title}</Body>
                  <Muted style={styles.badge}>{item.public_phase?.label || formatStatus(item.status)}</Muted>
                </View>
                <Muted>{formatDate(item.start_date)} · {item.track_count || 0} Strecken · {item.participant_count || 0} Fahrer</Muted>
                <View style={styles.metaRow}>
                  {item.vehicle ? <Pill label={item.vehicle} /> : null}
                  {item.platform ? <Pill label={item.platform} /> : null}
                  {item.weather ? <Pill label={item.weather} /> : null}
                </View>
                <Muted style={styles.openHint}>Zeiten ansehen</Muted>
              </View>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <View style={styles.pill}>
      <Muted style={styles.pillText}>{label}</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 12,
    paddingBottom: 24,
  },
  header: {
    gap: 6,
    marginBottom: 4,
  },
  card: {
    gap: 10,
    padding: 0,
    overflow: "hidden",
  },
  image: {
    borderWidth: 0,
    height: 132,
    width: "100%",
  },
  text: {
    gap: 7,
    padding: 14,
    paddingTop: 4,
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
    color: colors.cyan,
    fontWeight: "900",
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
  openHint: {
    color: colors.cyan,
    fontWeight: "900",
  },
  pressed: {
    opacity: 0.72,
  },
  error: {
    color: colors.live,
  },
});
