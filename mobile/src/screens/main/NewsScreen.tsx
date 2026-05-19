import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { Card } from "../../components/Card";
import { EmptyState, LoadingState } from "../../components/ListState";
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

  if (loading) {
    return (
      <Screen>
        <LoadingState label="News werden geladen ..." />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <Heading>News</Heading>
            {error ? <Muted style={styles.error}>{error}</Muted> : <Muted>Aktuelle Website-News als nativer App-Bereich.</Muted>}
          </View>
        }
        ListEmptyComponent={<EmptyState title="Keine News" detail="Sobald Beitraege veroeffentlicht sind, erscheinen sie hier." />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.cyan} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate("NewsDetail", { id: item.slug || item.id })} style={({ pressed }) => [pressed && styles.pressed]}>
            <Card style={styles.card}>
              <MediaImage
                uri={item.banner_url}
                style={styles.image}
                fallback={<Ionicons name="newspaper-outline" color={colors.gold} size={28} />}
              />
              <View style={styles.text}>
                <View style={styles.top}>
                  <Body style={styles.title}>{item.title}</Body>
                  {item.pinned ? <Muted style={styles.badge}>TOP</Muted> : null}
                </View>
                <Muted>{formatDate(item.published_at || item.created_at)}{item.category ? ` · ${item.category}` : ""}</Muted>
                {item.excerpt || item.summary ? <Muted numberOfLines={3}>{item.excerpt || item.summary}</Muted> : null}
                <Muted style={styles.openHint}>Beitrag oeffnen</Muted>
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
  },
  header: {
    gap: 6,
    marginBottom: 4,
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
    gap: 8,
  },
  title: {
    flex: 1,
    fontWeight: "900",
  },
  badge: {
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
