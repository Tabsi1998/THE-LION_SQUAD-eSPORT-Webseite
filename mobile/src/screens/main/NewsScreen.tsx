import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useBranding } from "../../branding/BrandingProvider";
import { Card } from "../../components/Card";
import { ListItemFadeIn, useListEntrance } from "../../components/FadeIn";
import { EmptyState, SkeletonList } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { NewsFilterRow } from "../../components/NewsFilterRow";
import { NewsTextCard } from "../../components/NewsTextCard";
import { Screen } from "../../components/Screen";
import { seasonScrollProps } from "../../seasons/sky/scroll";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import { formatDate, formatNewsCategory } from "../../lib/format";
import { applyScope, internalLabel, type ScopeFilter } from "../../lib/memberArea";
import { withoutRepeatedBanners } from "../../lib/newsCards";
import { newsCategoryCounts, newsCategoryKey } from "../../lib/newsFilter";
import type { MoreStackParamList } from "../../navigation/types";
import { colors, radius } from "../../theme";
import type { NewsPost } from "../../types";

type Props = NativeStackScreenProps<MoreStackParamList, "NewsList">;

export function NewsScreen({ navigation }: Props) {
  const { clubName } = useBranding();
  const [items, setItems] = useState<NewsPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [scope, setScope] = useState<ScopeFilter>("all");
  // Die Beiträge blenden gestaffelt ein (#1085): der große oben zuerst, dann die Liste - jeder nur beim ersten
  // Erscheinen, nicht wieder beim Ziehen, Suchen oder Filtern.
  const entrance = useListEntrance();

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await api.get<NewsPost[]>("/news", { params: { sort: "latest" } });
      setItems(Array.isArray(response.data) ? response.data : []);
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

  const hasInternal = useMemo(() => applyScope(items, "club").length > 0, [items]);
  const scoped = useMemo(() => applyScope(items, scope), [items, scope]);
  // Kategorien mit Anzahl (#1946, wie im Web): nur genutzte; gezählt wird, was „Alle“ bzw. „Verein“ gerade zeigt.
  const categories = useMemo(() => newsCategoryCounts(scoped, activeCategory), [scoped, activeCategory]);
  const filtered = useMemo(() => {
    let result = scoped;
    if (activeCategory) {
      result = result.filter((item) => newsCategoryKey(item.category) === activeCategory);
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
  }, [scoped, activeCategory, search]);

  // Dasselbe Bild nie zweimal hintereinander (#1946, wie im Web): in der Reihenfolge, in der die Karten stehen, bekommt
  // die Wiederholung die Text-Karte.
  const [featuredPost, listItems] = useMemo((): [NewsPost | null, NewsPost[]] => {
    const lead = filtered.find((item) => item.pinned) || filtered[0] || null;
    const shown = withoutRepeatedBanners(lead ? [lead, ...filtered.filter((item) => item.id !== lead.id)] : filtered);
    return lead ? [shown[0], shown.slice(1)] : [null, shown];
  }, [filtered]);

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
        {...seasonScrollProps("NewsList")}
        data={listItems}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.headerTop}>
              <View style={styles.headerIcon}>
                <Ionicons name="newspaper-outline" color={colors.black} size={20} />
              </View>
              <View style={styles.headerText}>
                <Muted style={styles.eyebrow}>{clubName}</Muted>
                <Title>News</Title>
              </View>
            </View>

            {error ? (
              <Muted style={styles.error}>{error}</Muted>
            ) : (
              <Muted>Aktuelle Ankündigungen, Updates und Vereinsnews.</Muted>
            )}

            {hasInternal ? (
              <View style={styles.scopeRow} testID="news-scope">
                {(["all", "club"] as ScopeFilter[]).map((key) => (
                  <Pressable key={key} onPress={() => setScope(key)} accessibilityRole="button" accessibilityState={{ selected: scope === key }} style={[styles.chip, scope === key && styles.chipGold]}>
                    <Muted style={[styles.chipText, scope === key && styles.chipTextGold]}>{key === "all" ? "Alle" : "Verein"}</Muted>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {/* Kategorien mit Anzahl und die Suche als Symbol in derselben Wischzeile (#1946, wie im Web). */}
            <NewsFilterRow categories={categories} total={scoped.length} active={activeCategory} onSelect={setActiveCategory} query={search} onQuery={setSearch} />

            {search || activeCategory ? (
              <Muted style={styles.resultCount}>
                {filtered.length} {filtered.length === 1 ? "Beitrag" : "Beiträge"} gefunden
              </Muted>
            ) : null}

            {featuredPost ? (
              <ListItemFadeIn key={featuredPost.id} entrance={entrance} id={`news-${featuredPost.id}`} index={0}>
                <FeaturedNewsCard
                  post={featuredPost}
                  onPress={() => navigation.navigate("NewsDetail", { id: featuredPost.slug || featuredPost.id })}
                />
              </ListItemFadeIn>
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
        renderItem={({ item, index }) => (
          <ListItemFadeIn entrance={entrance} id={`news-${item.id}`} index={index + 1}>
            <NewsCard post={item} onPress={() => navigation.navigate("NewsDetail", { id: item.slug || item.id })} />
          </ListItemFadeIn>
        )}
      />
    </Screen>
  );
}

function FeaturedNewsCard({ post, onPress }: { post: NewsPost; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>
      <Card style={styles.featuredCard} perch={`news-featured-${post.id}`}>
        {/* Ohne Bild die Text-Karte (#1912) statt einer leeren Fläche mit Symbol. */}
        {post.banner_url ? (
          <MediaImage
            uri={post.banner_url}
            style={styles.featuredImage}
            fallback={<Ionicons name="newspaper-outline" color={colors.gold} size={30} />}
          />
        ) : (
          <NewsTextCard news={post} style={styles.featuredImage} testID={`news-text-card-${post.id}`} />
        )}
        <View style={styles.featuredBody}>
          <View style={styles.top}>
            {post.pinned ? <Muted style={styles.badgePinned}>TOP</Muted> : null}
            {internalLabel(post) ? <Muted style={styles.badgePinned} testID="news-internal">{internalLabel(post)}</Muted> : null}
            {post.category ? <Muted style={styles.badgeCategory}>{formatNewsCategory(post.category)}</Muted> : null}
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
      <Card style={styles.card} perch={`news-${post.id}`}>
        {post.banner_url ? (
          <MediaImage
            uri={post.banner_url}
            style={styles.image}
            fallback={<Ionicons name="newspaper-outline" color={colors.gold} size={24} />}
          />
        ) : (
          <NewsTextCard news={post} size="thumb" style={styles.image} testID={`news-text-card-${post.id}`} />
        )}
        <View style={styles.text}>
          <View style={styles.top}>
            <Body style={styles.title}>{post.title}</Body>
            {internalLabel(post) ? <Muted style={styles.badgePinned} testID="news-internal">{internalLabel(post)}</Muted> : null}
            {post.category ? <Muted style={styles.badgeCategory}>{formatNewsCategory(post.category)}</Muted> : null}
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
    borderRadius: radius.lg,
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
  chip: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: {
    fontWeight: "900",
  },
  scopeRow: {
    flexDirection: "row",
    gap: 8,
  },
  chipGold: {
    backgroundColor: "rgba(255, 215, 0, 0.14)",
    borderColor: "rgba(255, 215, 0, 0.4)",
  },
  chipTextGold: {
    color: colors.gold,
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
    borderRadius: radius.lg,
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
    borderRadius: radius.lg,
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
    borderRadius: radius.lg,
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
