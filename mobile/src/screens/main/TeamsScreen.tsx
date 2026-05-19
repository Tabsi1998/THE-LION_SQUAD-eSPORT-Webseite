import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Card } from "../../components/Card";
import { EmptyState, LoadingState } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import type { TeamStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import type { Team } from "../../types";

type Props = NativeStackScreenProps<TeamStackParamList, "TeamList">;

export function TeamsScreen({ navigation }: Props) {
  const [myTeams, setMyTeams] = useState<Team[]>([]);
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [mine, all] = await Promise.all([
        api.get<Team[]>("/teams/my").catch(() => ({ data: [] })),
        api.get<Team[]>("/teams").catch(() => ({ data: [] })),
      ]);
      setMyTeams(Array.isArray(mine.data) ? mine.data : []);
      setAllTeams(Array.isArray(all.data) ? all.data : []);
    } catch (err) {
      setError(errorMessage(err, "Teams konnten nicht geladen werden."));
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
        <LoadingState label="Teams werden geladen ..." />
      </Screen>
    );
  }

  const list = myTeams.length ? myTeams : allTeams;

  return (
    <Screen>
      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <Heading>{myTeams.length ? "Meine Teams" : "Teams"}</Heading>
            {error ? <Muted style={styles.error}>{error}</Muted> : <Muted>Team-Übersicht als native Grundlage. Chat, Invites und Squads folgen hier im selben Modul.</Muted>}
          </View>
        }
        ListEmptyComponent={<EmptyState title="Keine Teams" detail="Du bist noch in keinem Team oder es gibt keine öffentlichen Teams." />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.cyan} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate("TeamDetail", { id: item.id })} style={({ pressed }) => [pressed && styles.pressed]}>
            <Card style={styles.card}>
              <View style={styles.teamTop}>
                <View style={styles.logo}>
                  <Body style={styles.logoText}>{(item.tag || item.name).slice(0, 2).toUpperCase()}</Body>
                </View>
                <View style={styles.teamText}>
                  <Body style={styles.title}>{item.name}</Body>
                  <Muted>{item.tag ? `#${item.tag}` : "Team"}{item.member_count != null ? ` · ${item.member_count} Mitglieder` : ""}</Muted>
                </View>
                <Muted style={styles.openHint}>öffnen</Muted>
              </View>
              {item.description ? <Muted>{item.description}</Muted> : null}
              <View style={styles.metaRow}>
                <Pill label={`${item.squads?.length || 0} Squads`} />
                <Pill label={`${item.members?.length || 0} Spieler`} />
                <Pill label={`${item.chat_preview?.length || 0} Chat`} />
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
  },
  teamTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  logo: {
    alignItems: "center",
    backgroundColor: "rgba(41, 182, 232, 0.14)",
    borderColor: "rgba(41, 182, 232, 0.35)",
    borderRadius: 8,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  logoText: {
    color: colors.cyan,
    fontWeight: "900",
  },
  teamText: {
    flex: 1,
    gap: 2,
  },
  title: {
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
  },
  pill: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pillText: {
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
