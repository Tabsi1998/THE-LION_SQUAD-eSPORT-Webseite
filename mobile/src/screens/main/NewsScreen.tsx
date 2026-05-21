import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Card } from "../../components/Card";
import { EmptyState, LoadingState, SkeletonList } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
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
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await api.get<NewsPost[]>("/news", { params: { sort: "latest" } });
      setItems(Array.isArray(data) ? data : []);
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

  // Alle vorhandenen Kategorien aus den Daten extrahieren
  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const item of items) {
      if (item.category) cats.add(item.category);
    }
    return Array.from(cats).sort();
  }, [items]);

  // Gefilterte + gesuchte Items
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
        data={filtered}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <Heading>News</Heading>
            {error ? (
              <Muted style={styles.error}>{error}</Muted>
            ) : (
              <Muted>Aktuelle Ankündigungen, Updates und Vereinsnews.</Muted>
            )}

            {/* Suchfeld */}
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

            {/* Kategorie-Filter Chips */}
            {categories.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chips}
              >
                <Pressable
                  onPress={() => setActiveCategory(null)}
                  style={[styles.chip, activeCategory === null && styles.chipActive]}
                >
                  <Muted style={[styles.chipText, activeCategory === null && styles.chipTextActive]}>
                    Alle
                  </Muted>
                </Pressable>
                {categories.map((cat) => (
                  <Pressable
                    key={cat}
                    onPress={() => setActiveCategory(activeCategory === cat ? null : cat)}
                    style={[styles.chip, activeCategory === cat && styles.chipActive]}
                  >
                    <Muted style={[styles.chipText, activeCategory === cat && styles.chipTextActive]}>
                      {cat}
                    </Muted>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}

            {/* Ergebnis-Zähler */}
            {(search || activeCategory) ? (
              <Muted style={styles.resultCount}>
                {filtered.length} {filtered.length === 1 ? "Beitrag" : "Beiträge"} gefunden
              </Muted>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title={search || activeCategory ? "Keine Treffer" : "Keine News"}
            detail={
              search || activeCategory
                ? "Versuche einen anderen Suchbegriff oder wähle eine andere Kategorie."
                : "Sobald Beiträge veröffentlicht sind, erscheinen sie hier."
            }
          />
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
          <Pressable
            onPress={() => navigation.navigate("NewsDetail", { id: item.slug || item.id })}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <Card style={styles.card}>
              <MediaImage
                uri={item.banner_url}
                style={styles.image}
                fallback={<Ionicons name="newspaper-outline" color={colors.gold} size={28} />}
              />
              <View style={styles.text}>
                <View style={styles.top}>
                  <Body style={styles.title}>{item.title}</Body>
                  {item.pinned ? <Muted style={styles.badgePinned}>TOP</Muted> : null}
                  {item.category ? <Muted style={styles.badgeCategory}>{item.category}</Muted> : null}
                </View>
                <Muted>
                  {formatDate(item.published_at || item.created_at)}
                </Muted>
                {item.excerpt || item.summary ? (
                  <Muted numberOfLines={3}>{item.excerpt || item.summary}</Muted>
                ) : null}
                <Muted style={styles.openHint}>Beitrag öffnen →</Muted>
              </View>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 12,
    paddingBottom: 24,
    paddingHorizontal: 18,
  },
  header: {
    gap: 10,
    marginBottom: 4,
    paddingTop: 4,
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
  card: {
    gap: 10,
    padding: 0,
    overflow: "hidden",
  },
  image: {
    borderWidth: 0,
    height: 138,
    width: "100%",
  },
  text: {
    gap: 5,
    padding: 14,
    paddingTop: 4,
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
    minWidth: "60%",
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
