import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Card } from "../../components/Card";
import { EmptyState, SkeletonList } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
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
      const [mine, all, inviteResult] = await Promise.all([
        api.get<Team[]>("/teams/my").catch(() => ({ data: [] })),
        api.get<Team[]>("/teams").catch(() => ({ data: [] })),
        api.get<TeamInvite[]>("/teams/invites/my").catch(() => ({ data: [] })),
      ]);
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

  const list = myTeams.length ? myTeams : allTeams;
  const memberTotal = useMemo(() => list.reduce((sum, team) => sum + Number(team.member_count ?? team.members?.length ?? 0), 0), [list]);
  const squadTotal = useMemo(() => list.reduce((sum, team) => sum + Number(team.squad_count ?? team.squads?.length ?? 0), 0), [list]);

  if (loading) {
    return (
      <Screen>
        <SkeletonList count={5} hasImage={false} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.headerTop}>
              <View style={styles.headerIcon}>
                <Ionicons name="people-outline" color={colors.black} size={22} />
              </View>
              <View style={styles.headerText}>
                <Muted style={styles.eyebrow}>Community</Muted>
                <Title>{myTeams.length ? "Meine Teams" : "Teams"}</Title>
              </View>
            </View>
            {error ? <Muted style={styles.error}>{error}</Muted> : <Muted>Teams, Einladungen, Squads und Community-Chat aus der Live-Plattform.</Muted>}

            <View style={styles.stats}>
              <Stat icon="shield-outline" label="Teams" value={list.length} />
              <Stat icon="people-outline" label="Mitglieder" value={memberTotal} tone="gold" />
              <Stat icon="layers-outline" label="Squads" value={squadTotal} />
            </View>

            {invites.length ? (
              <View style={styles.invites}>
                <View style={styles.sectionHead}>
                  <Heading>Offene Einladungen</Heading>
                  <Pill label={String(invites.length)} tone="gold" />
                </View>
                {invites.map((invite) => (
                  <InviteCard key={invite.id} invite={invite} onAccept={() => actOnInvite(invite, "accept")} onDecline={() => actOnInvite(invite, "decline")} />
                ))}
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={<EmptyState title="Keine Teams" detail="Du bist noch in keinem Team oder es gibt keine öffentlichen Teams." />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.cyan} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TeamCard team={item} onPress={() => navigation.navigate("TeamDetail", { id: item.id })} />
        )}
      />
    </Screen>
  );
}

function InviteCard({ invite, onAccept, onDecline }: { invite: TeamInvite; onAccept: () => void; onDecline: () => void }) {
  return (
    <Card style={styles.inviteCard}>
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
        <Pressable onPress={onAccept} style={({ pressed }) => [styles.acceptButton, pressed && styles.pressed]}>
          <Body style={styles.acceptText}>Annehmen</Body>
        </Pressable>
        <Pressable onPress={onDecline} style={({ pressed }) => [styles.declineButton, pressed && styles.pressed]}>
          <Muted style={styles.declineText}>Ablehnen</Muted>
        </Pressable>
      </View>
    </Card>
  );
}

function TeamCard({ team, onPress }: { team: Team; onPress: () => void }) {
  const members = team.member_count ?? team.members?.length ?? 0;
  const squads = team.squad_count ?? team.squads?.length ?? 0;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>
      <Card style={styles.card}>
        <View style={styles.teamTop}>
          <MediaImage
            uri={team.logo_url}
            style={styles.logoImage}
            fallback={<Body style={styles.logoText}>{(team.tag || team.name).slice(0, 2).toUpperCase()}</Body>}
          />
          <View style={styles.teamText}>
            <View style={styles.titleRow}>
              <Body style={styles.title}>{team.name}</Body>
              {team.tag ? <Pill label={team.tag} /> : null}
            </View>
            <Muted>{members} Mitglieder · {squads} Squads</Muted>
          </View>
          <Ionicons name="chevron-forward" color={colors.cyan} size={18} />
        </View>
        {team.description ? <Muted numberOfLines={2}>{team.description}</Muted> : null}
        <View style={styles.metaRow}>
          <Pill label={`${squads} Squads`} tone="gold" />
          <Pill label={`${members} Spieler`} />
          {team.chat_preview?.length ? <Pill label={`${team.chat_preview.length} Chat`} /> : null}
        </View>
      </Card>
    </Pressable>
  );
}

function Stat({ icon, label, value, tone = "cyan" }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: number; tone?: "cyan" | "gold" }) {
  return (
    <Card style={styles.stat}>
      <Ionicons name={icon} color={tone === "gold" ? colors.gold : colors.cyan} size={18} />
      <Body style={[styles.statValue, tone === "gold" && styles.gold]}>{value}</Body>
      <Muted>{label}</Muted>
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
    backgroundColor: colors.cyan,
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
    color: colors.cyan,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  stats: {
    flexDirection: "row",
    gap: 10,
  },
  stat: {
    flex: 1,
    gap: 3,
    minHeight: 88,
  },
  statValue: {
    color: colors.cyan,
    fontSize: 20,
    fontWeight: "900",
  },
  gold: {
    color: colors.gold,
  },
  invites: {
    gap: 10,
  },
  sectionHead: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  inviteCard: {
    gap: 10,
    borderColor: "rgba(255,215,0,0.32)",
  },
  inviteLogo: {
    borderRadius: 8,
    height: 46,
    width: 46,
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
  logoImage: {
    borderColor: "rgba(41,182,232,0.35)",
    borderRadius: 8,
    borderWidth: 1,
    height: 48,
    width: 48,
  },
  logoText: {
    color: colors.cyan,
    fontWeight: "900",
  },
  teamText: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  title: {
    flex: 1,
    fontWeight: "900",
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pill: {
    backgroundColor: "rgba(41,182,232,0.12)",
    borderColor: "rgba(41,182,232,0.28)",
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pillGold: {
    backgroundColor: "rgba(255,215,0,0.12)",
    borderColor: "rgba(255,215,0,0.32)",
  },
  pillText: {
    color: colors.cyan,
    fontSize: 12,
    fontWeight: "900",
  },
  pillGoldText: {
    color: colors.gold,
  },
  pressed: {
    opacity: 0.72,
  },
  error: {
    color: colors.live,
  },
});
