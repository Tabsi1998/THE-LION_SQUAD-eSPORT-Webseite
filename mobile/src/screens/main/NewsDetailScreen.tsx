import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Card } from "../../components/Card";
import { EmptyState, LoadingState } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { RichText } from "../../components/RichText";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import type { ContentTarget } from "../../lib/contentLinks";
import { formatDate, formatStatus } from "../../lib/format";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import type { NewsPost } from "../../types";

type Props = NativeStackScreenProps<MoreStackParamList, "NewsDetail">;

export function NewsDetailScreen({ navigation, route }: Props) {
  const [post, setPost] = useState<NewsPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await api.get<NewsPost>(`/news/${route.params.id}`);
      setPost(data || null);
    } catch (err) {
      setError(errorMessage(err, "News-Beitrag konnte nicht geladen werden."));
    } finally {
      setLoading(false);
    }
  }, [route.params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const openContentTarget = useCallback((target: ContentTarget) => {
    if (target.type === "news") {
      navigation.navigate("NewsDetail", { id: target.id });
      return;
    }
    if (target.type === "event") {
      navigation.getParent()?.navigate("Tournaments", { screen: "EventDetail", params: { id: target.id } });
      return;
    }
    if (target.type === "tournament") {
      navigation.getParent()?.navigate("Tournaments", { screen: "TournamentDetail", params: { id: target.id } });
      return;
    }
    if (target.type === "fastlap") {
      navigation.getParent()?.navigate("Tournaments", { screen: "FastLapDetail", params: { id: target.id } });
      return;
    }
    if (target.type === "team") {
      navigation.getParent()?.navigate("Teams", { screen: "TeamDetail", params: { id: target.id } });
      return;
    }
    navigation.navigate("PublicProfile", { username: target.id });
  }, [navigation]);

  if (loading) {
    return (
      <Screen>
        <LoadingState label="Beitrag wird geladen ..." />
      </Screen>
    );
  }

  if (!post) {
    return (
      <Screen>
        <EmptyState title="Beitrag nicht gefunden" detail={error || "Dieser Beitrag ist nicht sichtbar oder wurde entfernt."} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <MediaImage
          uri={post.banner_url}
          style={styles.hero}
          fallback={<Ionicons name="newspaper-outline" color={colors.gold} size={42} />}
        />
        <View style={styles.article}>
          <Muted>{formatDate(post.published_at || post.created_at)}{post.category ? ` · ${post.category}` : ""}</Muted>
          <Title>{post.title}</Title>
          {post.excerpt || post.summary ? <Body style={styles.lead}>{post.excerpt || post.summary}</Body> : null}
          {post.content || post.body ? (
            <RichText text={post.content || post.body} onOpenContent={openContentTarget} />
          ) : (
            <Muted>Kein weiterer Inhalt hinterlegt.</Muted>
          )}
        </View>

        {post.mentioned_users?.length ? (
          <Card style={styles.card}>
            <Heading>Markierte Personen</Heading>
            <View style={styles.mentionGrid}>
              {post.mentioned_users.map((user) => (
                <Pressable key={user.id || user.username} onPress={() => user.username ? navigation.navigate("PublicProfile", { username: user.username }) : undefined} style={({ pressed }) => [styles.mentionCard, pressed && styles.pressed]}>
                  <MediaImage
                    uri={user.avatar_url}
                    style={styles.mentionAvatar}
                    fallback={<Body style={styles.mentionInitial}>{(user.display_name || user.username || "?").slice(0, 1).toUpperCase()}</Body>}
                  />
                  <View style={styles.flex}>
                    <Body style={styles.strong}>{user.display_name || user.username}</Body>
                    {user.username ? <Muted>@{user.username}</Muted> : null}
                  </View>
                </Pressable>
              ))}
            </View>
          </Card>
        ) : null}

        {post.linked_tournaments?.length ? (
          <Card style={styles.card}>
            <Heading>Verknüpfte Turniere</Heading>
            {post.linked_tournaments.map((tournament) => (
              <Pressable key={tournament.id} onPress={() => navigation.getParent()?.navigate("Tournaments", { screen: "TournamentDetail", params: { id: tournament.slug || tournament.id } })} style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
                <View style={styles.flex}>
                  <Body style={styles.strong}>{tournament.title}</Body>
                  <Muted>{formatDate(tournament.start_date)} · {tournament.public_phase?.label || formatStatus(tournament.status)}</Muted>
                </View>
                <Ionicons name="chevron-forward" color={colors.muted} size={18} />
              </Pressable>
            ))}
          </Card>
        ) : null}

        {post.linked_events?.length ? (
          <Card style={styles.card}>
            <Heading>Verknüpfte Events</Heading>
            {post.linked_events.map((event) => (
              <Pressable key={event.id} onPress={() => navigation.getParent()?.navigate("Tournaments", { screen: "EventDetail", params: { id: event.slug || event.id } })} style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
                <View style={styles.flex}>
                  <Body style={styles.strong}>{event.title || event.name}</Body>
                  <Muted>{formatDate(event.start_date || event.date)} · {event.public_phase?.label || formatStatus(event.status)}</Muted>
                </View>
                <Ionicons name="chevron-forward" color={colors.muted} size={18} />
              </Pressable>
            ))}
          </Card>
        ) : null}

        {post.linked_f1_challenges?.length ? (
          <Card style={styles.card}>
            <Heading>Verknüpfte Fast Laps</Heading>
            {post.linked_f1_challenges.map((challenge) => (
              <Pressable key={challenge.id} onPress={() => navigation.getParent()?.navigate("Tournaments", { screen: "FastLapDetail", params: { id: challenge.slug || challenge.id } })} style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
                <View style={styles.flex}>
                  <Body style={styles.strong}>{challenge.title}</Body>
                  <Muted>{formatDate(challenge.start_date)} · {formatStatus(challenge.status)}</Muted>
                </View>
                <Ionicons name="chevron-forward" color={colors.muted} size={18} />
              </Pressable>
            ))}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    paddingBottom: 28,
  },
  hero: {
    borderWidth: 0,
    height: 230,
    width: "100%",
  },
  article: {
    gap: 12,
    paddingHorizontal: 18,
  },
  lead: {
    color: colors.cyan,
    fontWeight: "800",
  },
  card: {
    gap: 10,
    marginHorizontal: 18,
  },
  linkRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingTop: 10,
  },
  flex: {
    flex: 1,
    gap: 2,
  },
  mentionGrid: {
    gap: 10,
  },
  mentionCard: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 10,
  },
  mentionAvatar: {
    borderRadius: 8,
    height: 42,
    width: 42,
  },
  mentionInitial: {
    color: colors.cyan,
    fontWeight: "900",
  },
  strong: {
    fontWeight: "900",
  },
  pressed: {
    opacity: 0.72,
  },
});
