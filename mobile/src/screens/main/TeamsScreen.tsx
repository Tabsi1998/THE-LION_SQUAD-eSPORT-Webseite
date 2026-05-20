import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Card } from "../../components/Card";
import { EmptyState, LoadingState } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import type { TeamStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import type { Team, TeamInvite } from "../../types";

type Props = NativeStackScreenProps<TeamStackParamList, "TeamList">;

export function TeamsScreen({ navigation }: Props) {
  const [myTeams, setMyTeams] = useState<Team[]>([]);
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
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
      const inviteResult = await api.get<TeamInvite[]>("/teams/invites/my").catch(() => ({ data: [] }));
      setMyTeams(Array.isArray(mine.data) ? mine.data : []);
      setAllTeams(Array.isArray(all.data) ? all.data : []);
      setInvites(Array.isArray(inviteResult.data) ? inviteResult.data : []);
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
  const actOnInvite = useCallback(async (invite: TeamInvite, action: "accept" | "decline") => {
    setError("");
    try {
      await api.post(`/teams/invites/${invite.id}/${action}`);
      setInvites((items) => items.filter((item) => item.id !== invite.id));
      await load();
    } catch (err) {
      setError(errorMessage(err, "Einladung konnte nicht verarbeitet werden."));
    }
  }, [load]);

  return (
    <Screen>
      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <Heading>{myTeams.length ? "Meine Teams" : "Teams"}</Heading>
            {error ? <Muted style={styles.error}>{error}</Muted> : <Muted>Teams, Einladungen, Squads und Community-Chat aus der Live-Plattform.</Muted>}
            {invites.length ? (
              <View style={styles.invites}>
                <View style={styles.inviteHead}>
                  <Ionicons name="mail-unread-outline" color={colors.cyan} size={18} />
                  <Heading>Offene Einladungen</Heading>
                </View>
                {invites.map((invite) => (
                  <Card key={invite.id} style={styles.inviteCard}>
                    <View style={styles.teamTop}>
                      <MediaImage
                        uri={invite.team?.logo_url}
                        style={styles.inviteLogo}
                        fallback={<Body style={styles.logoText}>{(invite.team?.tag || invite.team?.name || "?").slice(0, 2).toUpperCase()}</Body>}
                      />
                      <View style={styles.teamText}>
                        <Body style={styles.title}>{invite.team?.name || "Team"}</Body>
                        <Muted>{invite.team?.tag ? `[${invite.team.tag}]` : "Team"} · von {invite.inviter?.display_name || invite.inviter?.username || "Teamleitung"}</Muted>
                      </View>
                    </View>
                    <View style={styles.inviteActions}>
                      <Pressable onPress={() => actOnInvite(invite, "accept")} style={({ pressed }) => [styles.acceptButton, pressed && styles.pressed]}>
                        <Body style={styles.acceptText}>Annehmen</Body>
                      </Pressable>
                      <Pressable onPress={() => actOnInvite(invite, "decline")} style={({ pressed }) => [styles.declineButton, pressed && styles.pressed]}>
                        <Muted style={styles.declineText}>Ablehnen</Muted>
                      </Pressable>
                    </View>
                  </Card>
                ))}
              </View>
            ) : null}
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
                  <MediaImage
                    uri={item.logo_url}
                    style={styles.logoImage}
                    fallback={<Body style={styles.logoText}>{(item.tag || item.name).slice(0, 2).toUpperCase()}</Body>}
                  />
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
  invites: {
    gap: 10,
    marginTop: 10,
  },
  inviteHead: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  inviteCard: {
    gap: 10,
  },
  inviteLogo: {
    borderRadius: 8,
    height: 44,
    width: 44,
  },
  inviteActions: {
    flexDirection: "row",
    gap: 8,
  },
  acceptButton: {
    alignItems: "center",
    backgroundColor: colors.cyan,
    borderRadius: 7,
    flex: 1,
    justifyContent: "center",
    minHeight: 42,
  },
  acceptText: {
    color: colors.black,
    fontWeight: "900",
  },
  declineButton: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 42,
  },
  declineText: {
    fontWeight: "900",
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
  logoImage: {
    borderRadius: 8,
    height: "100%",
    width: "100%",
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
