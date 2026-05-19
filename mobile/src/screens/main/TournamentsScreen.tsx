import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Card } from "../../components/Card";
import { EmptyState, LoadingState } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import { formatDate, formatStatus } from "../../lib/format";
import type { TournamentStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import type { Tournament } from "../../types";

type Props = NativeStackScreenProps<TournamentStackParamList, "TournamentList">;

export function TournamentsScreen({ navigation }: Props) {
  const [items, setItems] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await api.get<Tournament[]>("/tournaments");
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(errorMessage(err, "Turniere konnten nicht geladen werden."));
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
        <LoadingState label="Turniere werden geladen ..." />
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
            <Heading>Turniere</Heading>
            {error ? <Muted style={styles.error}>{error}</Muted> : <Muted>Anmelden, Status verfolgen und später Match-Hub öffnen.</Muted>}
          </View>
        }
        ListEmptyComponent={<EmptyState title="Keine Turniere" detail="Aktuell sind keine Turniere veröffentlicht." />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.cyan} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate("TournamentDetail", { id: item.slug || item.id })} style={({ pressed }) => [pressed && styles.pressed]}>
            <Card style={styles.card}>
              <View style={styles.cardTop}>
                <Body style={styles.title}>{item.title}</Body>
                <Muted style={styles.openHint}>öffnen</Muted>
              </View>
              <Muted>{item.public_phase?.label || formatStatus(item.status)} · {formatDate(item.start_date)}</Muted>
              <Muted>{item.game?.display_name || item.game?.name || item.game_name || item.platform || "Turnier"}</Muted>
              <View style={styles.metaRow}>
                <Pill label={item.format_label || item.format || "Turnier"} />
                <Pill label={`${item.participant_count ?? item.participants?.length ?? 0}${item.max_participants ? `/${item.max_participants}` : ""} Teilnehmer`} />
                <Pill label={item.event?.name || `${item.standings?.length || 0} Ergebnisse`} />
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
    gap: 8,
  },
  cardTop: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  title: {
    flex: 1,
    fontWeight: "900",
  },
  openHint: {
    color: colors.cyan,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 2,
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
    fontWeight: "800",
  },
  pressed: {
    opacity: 0.72,
  },
  error: {
    color: colors.live,
  },
});
