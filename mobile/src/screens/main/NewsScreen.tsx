import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Card } from "../../components/Card";
import { EmptyState, OfflineNotice, SkeletonList } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { api, errorMessage, responseFromCache } from "../../lib/api";
import { formatDate } from "../../lib/format";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import type { NewsPost } from "../../types";

type Props = NativeStackScreenProps<MoreStackParamList, "NewsList">;

export function NewsScreen({ navigation }: Props) {
  const [items, setItems] = useState<NewsPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await api.get<NewsPost[]>("/news", { params: { sort: "latest" } });
      setItems(Array.isArray(response.data) ? response.data : []);
      setOffline(responseFromCache(response));
    } catch (err) {
      setError(errorMessage(err, "News konnten nicht geladen werden."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const item of items) {
      if (item.category) cats.add(item.category);
    }
    return Array.from(cats).sort();
  }, [items]);

  const filtered = useMemo(() => {
    let result = items;
    if (activeCategory) {
      result = result.filter((item) => item.category === activeCategory);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (item) =>
          item.title?.toLowerCase().includes(q) ||
          item.excerpt?.toLowerCase().includes(q) ||
          item.summary?.toLowerCase().includes(q) ||
          item.category?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [items, activeCategory, search]);

  const featuredPost = useMemo(() => filtered.find((item) => item.pinned) || filtered[0] || null, [filtered]);
  const listItems = useMemo(
    () => (featuredPost ? filtered.filter((item) => item.id !== featuredPost.id) : filtered),
    [featuredPost, filtered]
  );

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
                <Ionicons name="newspaper-outline" color={colors.black} size={20} />
              </View>
              <View style={styles.headerText}>
                <Muted style={styles.eyebrow}>THE LION SQUAD</Muted>
                <Title>News</Title>
              </View>
            </View>

            {error ? (
              <Muted style={styles.error}>{error}</Muted>
            ) : (
              <Muted>Aktuelle Ankündigungen, Updates und Vereinsnews.</Muted>
            )}
            {offline && !error ? <OfflineNotice detail="News werden aus gespeicherten Daten angezeigt." /> : null}

            <View style={styles.searchRow}>
              <Ionicons name="search-outline" color={colors.muted} size={16} style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="News durchsuchen ..."
                placeholderTextColor={colors.muted}
                value={search}
                onChangeText={setSearch}
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
              {search.length > 0 ? (
                <Pressable onPress={() => setSearch("")} hitSlop={8}>
                  <Ionicons name="close-circle" color={colors.muted} size={16} />
                </Pressable>
              ) : null}
            </View>

            {categories.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                <Pressable onPress={() => setActiveCategory(null)} style={[styles.chip, activeCategory === null && styles.chipActive]}>
                  <Muted style={[styles.chipText, activeCategory === null && styles.chipTextActive]}>Alle</Muted>
                </Pressable>
                {categories.map((cat) => (
                  <Pressable
                    key={cat}
                    onPress={() => setActiveCategory(activeCategory === cat ? null : cat)}
                    style={[styles.chip, activeCategory === cat && styles.chipActive]}
                  >
                    <Muted style={[styles.chipText, activeCategory === cat && styles.chipTextActive]}>{cat}</Muted>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}

            {search || activeCategory ? (
              <Muted style={styles.resultCount}>
                {filtered.length} {filtered.length === 1 ? "Beitrag" : "Beiträge"} gefunden
              </Muted>
            ) : null}

            {featuredPost ? (
              <FeaturedNewsCard
                post={featuredPost}
                onPress={() => navigation.navigate("NewsDetail", { id: featuredPost.slug || featuredPost.id })}
              />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          featuredPost ? null : (
            <EmptyState
              title={search || activeCategory ? "Keine Treffer" : "Keine News"}
              detail={
                search || activeCategory
                  ? "Versuche einen anderen Suchbegriff oder wähle eine andere Kategorie."
                  : "Sobald Beiträge veröffentlicht sind, erscheinen sie hier."
              }
            />
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
          <NewsCard post={item} onPress={() => navigation.navigate("NewsDetail", { id: item.slug || item.id })} />
        )}
      />
    </Screen>
  );
}

function FeaturedNewsCard({ post, onPress }: { post: NewsPost; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>
      <Card style={styles.featuredCard}>
        <MediaImage
          uri={post.banner_url}
          style={styles.featuredImage}
          fallback={<Ionicons name="newspaper-outline" color={colors.gold} size={30} />}
        />
        <View style={styles.featuredBody}>
          <View style={styles.top}>
            {post.pinned ? <Muted style={styles.badgePinned}>TOP</Muted> : null}
            {post.category ? <Muted style={styles.badgeCategory}>{post.category}</Muted> : null}
          </View>
          <Heading>{post.title}</Heading>
          <Muted>{formatDate(post.published_at || post.created_at)}</Muted>
          {post.excerpt || post.summary ? <Muted numberOfLines={3}>{post.excerpt || post.summary}</Muted> : null}
          <View style={styles.openRow}>
            <Muted style={styles.openHint}>Beitrag öffnen</Muted>
            <Ionicons name="chevron-forward" color={colors.cyan} size={15} />
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

function NewsCard({ post, onPress }: { post: NewsPost; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>
      <Card style={styles.card}>
        <MediaImage
          uri={post.banner_url}
          style={styles.image}
          fallback={<Ionicons name="newspaper-outline" color={colors.gold} size={24} />}
        />
        <View style={styles.text}>
          <View style={styles.top}>
            <Body style={styles.title}>{post.title}</Body>
            {post.category ? <Muted style={styles.badgeCategory}>{post.category}</Muted> : null}
          </View>
          <Muted>{formatDate(post.published_at || post.created_at)}</Muted>
          {post.excerpt || post.summary ? <Muted numberOfLines={2}>{post.excerpt || post.summary}</Muted> : null}
          <View style={styles.openRow}>
            <Muted style={styles.openHint}>Beitrag öffnen</Muted>
            <Ionicons name="chevron-forward" color={colors.cyan} size={15} />
          </View>
        </View>
      </Card>
    </Pressable>
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
  searchRow: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchIcon: {
    flexShrink: 0,
  },
  searchInput: {
    color: colors.white,
    flex: 1,
    fontSize: 14,
    padding: 0,
  },
  chips: {
    gap: 8,
    paddingRight: 4,
  },
  chip: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipActive: {
    backgroundColor: "rgba(41,182,232,0.16)",
    borderColor: "rgba(41,182,232,0.42)",
  },
  chipText: {
    fontWeight: "900",
  },
  chipTextActive: {
    color: colors.cyan,
  },
  resultCount: {
    color: colors.muted,
    fontSize: 12,
  },
  featuredCard: {
    gap: 0,
    overflow: "hidden",
    padding: 0,
  },
  featuredImage: {
    borderWidth: 0,
    height: 166,
    width: "100%",
  },
  featuredBody: {
    gap: 6,
    padding: 14,
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
    gap: 4,
    minWidth: 0,
  },
  top: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  title: {
    flex: 1,
    fontWeight: "900",
    minWidth: "58%",
  },
  badgePinned: {
    backgroundColor: "rgba(240, 180, 41, 0.14)",
    borderColor: "rgba(240, 180, 41, 0.34)",
    borderRadius: 6,
    borderWidth: 1,
    color: colors.gold,
    fontSize: 11,
    fontWeight: "900",
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  badgeCategory: {
    backgroundColor: "rgba(41, 182, 232, 0.1)",
    borderColor: "rgba(41, 182, 232, 0.28)",
    borderRadius: 6,
    borderWidth: 1,
    color: colors.cyan,
    fontSize: 11,
    fontWeight: "900",
    paddingHorizontal: 7,
    paddingVertical: 3,
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
  pressed: {
    opacity: 0.72,
  },
  error: {
    color: colors.live,
  },
});
