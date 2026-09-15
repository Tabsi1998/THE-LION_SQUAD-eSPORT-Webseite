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
import { chatTitle, splitTeams, teamMembers, teamMeta, teamSquads } from "../../lib/teams";
import type { TeamStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import type { Team, TeamInvite } from "../../types";

// Teams: eigene zuerst, mit Chat direkt auf der Karte; darunter die weiteren
// öffentlichen Teams. Vorher zeigte die Liste entweder nur eigene oder nur
// alle, und jede Karte trug "0 Squads" zweimal (#215).

type Props = NativeStackScreenProps<TeamStackParamList, "TeamList">;

type Row = { kind: "heading"; key: string; title: string; count: number } | { kind: "team"; key: string; team: Team; mine: boolean };

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

  const { mine, others } = useMemo(() => splitTeams(myTeams, allTeams), [myTeams, allTeams]);
  const rows = useMemo<Row[]>(() => {
    const result: Row[] = [];
    if (mine.length) {
      result.push({ kind: "heading", key: "h-mine", title: "Meine Teams", count: mine.length });
      mine.forEach((team) => result.push({ kind: "team", key: `m-${team.id}`, team, mine: true }));
    }
    if (others.length) {
      result.push({ kind: "heading", key: "h-others", title: mine.length ? "Weitere Teams" : "Öffentliche Teams", count: others.length });
      others.forEach((team) => result.push({ kind: "team", key: `o-${team.id}`, team, mine: false }));
    }
    return result;
  }, [mine, others]);

  const statTeams = mine.length ? mine : others;
  const memberTotal = useMemo(() => statTeams.reduce((sum, team) => sum + teamMembers(team), 0), [statTeams]);
  const squadTotal = useMemo(() => statTeams.reduce((sum, team) => sum + teamSquads(team), 0), [statTeams]);

  const openChat = useCallback((team: Team) => {
    navigation.navigate("TeamChat", { id: team.id, title: chatTitle(team) });
  }, [navigation]);

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
        data={rows}
        keyExtractor={(item) => item.key}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.headerTop}>
              <View style={styles.headerIcon}>
                <Ionicons name="people-outline" color={colors.black} size={22} />
              </View>
              <View style={styles.headerText}>
                <Muted style={styles.eyebrow}>Community</Muted>
                <Title>Teams</Title>
              </View>
            </View>
            {error ? <Muted style={styles.error}>{error}</Muted> : null}

            {statTeams.length ? (
              <View style={styles.stats}>
                <Stat icon="shield-outline" label="Teams" value={statTeams.length} />
                <Stat icon="people-outline" label="Mitglieder" value={memberTotal} tone="gold" />
                {squadTotal > 0 ? <Stat icon="layers-outline" label="Squads" value={squadTotal} /> : null}
              </View>
            ) : null}

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
        ListEmptyComponent={
          <EmptyState
            icon="people-outline"
            title="Noch kein Team"
            detail="Einem Team trittst du über eine Einladung oder einen Join-Code bei. Öffentliche Teams erscheinen hier, sobald es welche gibt."
          />
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.cyan} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) =>
          item.kind === "heading" ? (
            <View style={styles.sectionHead}>
              <Heading>{item.title}</Heading>
              <Pill label={String(item.count)} />
            </View>
          ) : (
            <TeamCard
              team={item.team}
              onPress={() => navigation.navigate("TeamDetail", { id: item.team.id })}
              onChat={item.mine ? () => openChat(item.team) : undefined}
            />
          )
        }
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
        <Pressable onPress={onAccept} accessibilityRole="button" style={({ pressed }) => [styles.acceptButton, pressed && styles.pressed]}>
          <Body style={styles.acceptText}>Annehmen</Body>
        </Pressable>
        <Pressable onPress={onDecline} accessibilityRole="button" style={({ pressed }) => [styles.declineButton, pressed && styles.pressed]}>
          <Muted style={styles.declineText}>Ablehnen</Muted>
        </Pressable>
      </View>
    </Card>
  );
}

function TeamCard({ team, onPress, onChat }: { team: Team; onPress: () => void; onChat?: () => void }) {
  const lastMessage = team.chat_preview?.length ? team.chat_preview[team.chat_preview.length - 1] : null;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [pressed && styles.pressed]}>
      <Card style={styles.card}>
        <View style={styles.teamTop}>
          <MediaImage
            uri={team.logo_url}
            style={styles.logoImage}
            fallback={<Body style={styles.logoText}>{(team.tag || team.name).slice(0, 2).toUpperCase()}</Body>}
          />
          <View style={styles.teamText}>
            <View style={styles.titleRow}>
              <Body style={styles.title} numberOfLines={1}>{team.name}</Body>
              {team.tag ? <Pill label={team.tag} /> : null}
            </View>
            <Muted>{teamMeta(team)}</Muted>
          </View>
          {onChat ? (
            <Pressable
              onPress={onChat}
              accessibilityRole="button"
              accessibilityLabel={`${team.name}: Chat öffnen`}
              hitSlop={8}
              style={({ pressed }) => [styles.chatButton, pressed && styles.pressed]}
            >
              <Ionicons name="chatbubbles-outline" color={colors.black} size={18} />
            </Pressable>
          ) : (
            <Ionicons name="chevron-forward" color={colors.cyan} size={18} />
          )}
        </View>
        {onChat && lastMessage ? (
          <Muted numberOfLines={1}>{lastMessage.author}: {lastMessage.message}</Muted>
        ) : team.description ? (
          <Muted numberOfLines={2}>{team.description}</Muted>
        ) : null}
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
    gap: 8,
    justifyContent: "space-between",
    paddingTop: 4,
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
    gap: 8,
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
    flexShrink: 1,
    fontWeight: "900",
  },
  chatButton: {
    alignItems: "center",
    backgroundColor: colors.cyan,
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
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
