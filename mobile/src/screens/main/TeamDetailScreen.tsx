import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Card } from "../../components/Card";
import { EmptyState, LoadingState } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import type { TeamStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import type { Team } from "../../types";

type Props = NativeStackScreenProps<TeamStackParamList, "TeamDetail">;

export function TeamDetailScreen({ route }: Props) {
  const [team, setTeam] = useState<Team | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await api.get<Team>(`/teams/${route.params.id}`);
      const squads = await api.get<Team["squads"]>(`/teams/${route.params.id}/squads`).catch(() => ({ data: [] }));
      setTeam({ ...data, squads: Array.isArray(squads.data) ? squads.data : [] });
    } catch (err) {
      setError(errorMessage(err, "Teamdetail konnte nicht geladen werden."));
    } finally {
      setLoading(false);
    }
  }, [route.params.id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <Screen>
        <LoadingState label="Team wird geladen ..." />
      </Screen>
    );
  }

  if (!team) {
    return (
      <Screen>
        <EmptyState title="Teamdetail nicht verfügbar" detail={error || "Das Team konnte nicht geladen werden."} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.logo}>
            <Body style={styles.logoText}>{(team.tag || team.name).slice(0, 2).toUpperCase()}</Body>
          </View>
          <View style={styles.heroText}>
            <Muted>{team.tag ? `#${team.tag}` : "Team"}</Muted>
            <Title>{team.name}</Title>
            <Muted>{team.description || `${team.member_count || 0} Mitglieder${team.discord_link ? " · Discord hinterlegt" : ""}`}</Muted>
          </View>
        </View>

        <Card style={styles.card}>
          <Heading>Spieler</Heading>
          {team.members?.length ? team.members?.map((member) => {
            const memberName = member.display_name || member.name || member.username || "Spieler";
            const role = member.id === team.leader?.id ? "Leader" : member.role || "Mitglied";
            return (
            <View key={member.id} style={styles.row}>
              <View style={styles.avatar}>
                <Body style={styles.avatarText}>{memberName.slice(0, 1).toUpperCase()}</Body>
              </View>
              <View style={styles.rowMain}>
                <Body style={styles.rowTitle}>{memberName}</Body>
                <Muted>{role}</Muted>
                <View style={styles.wrap}>
                  {member.achievements?.map((achievement) => <Pill key={achievement} label={achievement} />)}
                </View>
              </View>
            </View>
          );}) : <Muted>Mitglieder werden angezeigt, sobald das Team sie öffentlich freigibt.</Muted>}
        </Card>

        <Card style={styles.card}>
          <Heading>Squads</Heading>
          {team.squads?.length ? team.squads?.map((squad) => (
            <View key={squad.name} style={styles.row}>
              <View style={styles.rowMain}>
                <Body style={styles.rowTitle}>{squad.name}</Body>
                <Muted>{squad.game}</Muted>
              </View>
              <Body style={styles.record}>{squad.record}</Body>
            </View>
          )) : <Muted>Keine öffentlichen Squads hinterlegt.</Muted>}
        </Card>

        <Card style={styles.card}>
          <Heading>Team-Chat</Heading>
          <Muted>Vorschau für den späteren nativen Chat mit Team-Abstimmung.</Muted>
          {team.chat_preview?.map((message) => (
            <View key={`${message.author}-${message.time}`} style={styles.chatRow}>
              <View style={styles.rowMain}>
                <Body style={styles.rowTitle}>{message.author}</Body>
                <Muted>{message.message}</Muted>
              </View>
              <Muted>{message.time}</Muted>
            </View>
          ))}
        </Card>
      </ScrollView>
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
  content: {
    gap: 14,
    padding: 18,
    paddingBottom: 30,
  },
  hero: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 14,
    padding: 16,
  },
  logo: {
    alignItems: "center",
    backgroundColor: "rgba(41, 182, 232, 0.14)",
    borderColor: "rgba(41, 182, 232, 0.35)",
    borderRadius: 10,
    borderWidth: 1,
    height: 62,
    justifyContent: "center",
    width: 62,
  },
  logoText: {
    color: colors.cyan,
    fontSize: 20,
    fontWeight: "900",
  },
  heroText: {
    flex: 1,
    gap: 4,
  },
  card: {
    gap: 12,
  },
  row: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingTop: 10,
  },
  rowMain: {
    flex: 1,
    gap: 4,
  },
  rowTitle: {
    fontWeight: "900",
  },
  avatar: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  avatarText: {
    fontWeight: "900",
  },
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  pill: {
    backgroundColor: "rgba(41, 182, 232, 0.12)",
    borderColor: "rgba(41, 182, 232, 0.28)",
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  pillText: {
    color: colors.cyan,
    fontSize: 11,
    fontWeight: "800",
  },
  record: {
    color: colors.gold,
    fontWeight: "900",
  },
  chatRow: {
    alignItems: "flex-start",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingTop: 10,
  },
});
