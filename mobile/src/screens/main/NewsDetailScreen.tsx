import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Card } from "../../components/Card";
import { EmptyState, LoadingState } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
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

  const paragraphs = useMemo(() => splitContent(post), [post]);
  const contentImages = useMemo(() => extractImages(post), [post]);

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
          {paragraphs.length ? (
            paragraphs.map((paragraph, index) => <Body key={`${index}-${paragraph.slice(0, 12)}`}>{paragraph}</Body>)
          ) : (
            <Muted>Kein weiterer Inhalt hinterlegt.</Muted>
          )}
          {contentImages.length ? (
            <View style={styles.imageStack}>
              {contentImages.map((url) => (
                <MediaImage
                  key={url}
                  uri={url}
                  style={styles.contentImage}
                  fallback={<Ionicons name="image-outline" color={colors.cyan} size={28} />}
                />
              ))}
            </View>
          ) : null}
        </View>

        {post.linked_tournaments?.length ? (
          <Card style={styles.card}>
            <Heading>Verknuepfte Turniere</Heading>
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
            <Heading>Verknuepfte Events</Heading>
            {post.linked_events.map((event) => (
              <View key={event.id} style={styles.linkRow}>
                <View style={styles.flex}>
                  <Body style={styles.strong}>{event.title || event.name}</Body>
                  <Muted>{formatDate(event.start_date || event.date)} · {event.public_phase?.label || formatStatus(event.status)}</Muted>
                </View>
              </View>
            ))}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function splitContent(post: NewsPost | null) {
  const raw = post?.content || post?.body || "";
  return String(raw)
    .replace(/!\[[^\]]*]\([^)]+\)/g, "\n")
    .replace(/<img[^>]+>/gi, "\n")
    .replace(/https?:\/\/\S+\.(?:png|jpe?g|webp|gif)(?:\?\S*)?/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .split(/\n{2,}|\r\n{2,}/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 24);
}

function extractImages(post: NewsPost | null) {
  const urls = new Set<string>();
  const raw = String(post?.content || post?.body || "");
  const banner = post?.banner_url;
  const add = (url?: string | null) => {
    const value = String(url || "").trim().replace(/^["']|["']$/g, "");
    if (value && value !== banner) urls.add(value);
  };
  [...raw.matchAll(/!\[[^\]]*]\(([^)]+)\)/g)].forEach((match) => add(match[1]));
  [...raw.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)].forEach((match) => add(match[1]));
  [...raw.matchAll(/https?:\/\/\S+\.(?:png|jpe?g|webp|gif)(?:\?\S*)?/gi)].forEach((match) => add(match[0]));
  return Array.from(urls).slice(0, 8);
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
  imageStack: {
    gap: 10,
  },
  contentImage: {
    borderRadius: 8,
    height: 190,
    width: "100%",
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
  strong: {
    fontWeight: "900",
  },
  pressed: {
    opacity: 0.72,
  },
});
