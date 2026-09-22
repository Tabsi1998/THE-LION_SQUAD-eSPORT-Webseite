import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { EmptyState, ErrorState, SkeletonList } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { api, errorMessage, resolveMediaUrl } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { albumCountLabel, groupBySection, mediaType, posterUrl, sizedUpload, type GalleryAlbum, type GalleryItem } from "../../lib/gallery";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";

// Album (#236): Raster aus 400-px-Kacheln, drei je Zeile; Abschnitte wie im Web. Antippen
// öffnet die Großansicht an dieser Stelle.

type Props = NativeStackScreenProps<MoreStackParamList, "GalleryAlbum">;
const GAP = 4;

export function GalleryAlbumScreen({ navigation, route }: Props) {
  const { id } = route.params;
  const { width } = useWindowDimensions();
  const [album, setAlbum] = useState<GalleryAlbum | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await api.get<GalleryAlbum>(`/gallery/${encodeURIComponent(id)}`);
      setAlbum(response.data);
      navigation.setOptions({ title: response.data?.title || "Album" });
    } catch (err) {
      setError(errorMessage(err, "Das Album konnte nicht geladen werden."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, navigation]);

  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => (album ? groupBySection(album) : []), [album]);
  const ordered = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const tile = Math.floor((width - 18 * 2 - GAP * 2) / 3);

  const open = (item: GalleryItem) => {
    const index = Math.max(0, ordered.findIndex((entry) => entry.id === item.id));
    navigation.navigate("GalleryViewer", { albumId: id, index });
  };

  if (loading) return <Screen><SkeletonList count={3} hasImage /></Screen>;
  if (!album) return <Screen><ErrorState title="Album nicht gefunden" detail={error || "Dieses Album ist nicht sichtbar oder wurde entfernt."} /></Screen>;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.cyan} />}>
        <View style={styles.header}>
          <Title>{album.title}</Title>
          <Muted>{[formatDate(album.taken_at), albumCountLabel(album), album.event?.name].filter(Boolean).join(" · ")}</Muted>
          {album.description ? <Body>{album.description}</Body> : null}
        </View>
        {error ? <Muted style={styles.error}>{error}</Muted> : null}
        {groups.length ? groups.map((group) => (
          <View key={group.id || "ohne"} style={styles.section}>
            {group.title ? <Heading>{group.title}</Heading> : null}
            <View style={styles.grid}>
              {group.items.map((item) => {
                const type = mediaType(item);
                return (
                  <Pressable key={item.id} onPress={() => open(item)} accessibilityRole="imagebutton" accessibilityLabel={item.caption || (type === "image" ? "Bild" : "Video")} style={({ pressed }) => [styles.tile, { width: tile, height: tile }, pressed && styles.pressed]} testID={`gallery-item-${item.id}`}>
                    <MediaImage uri={resolveMediaUrl(sizedUpload(posterUrl(item), 400))} style={styles.tileImage} fallback={<Ionicons name={type === "image" ? "image-outline" : "videocam-outline"} color={colors.muted} size={24} />} />
                    {type !== "image" ? <View style={styles.playBadge}><Ionicons name="play" color={colors.white} size={14} /></View> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        )) : (
          <EmptyState icon="images-outline" title="Noch leer" detail="In diesem Album sind noch keine Bilder." />
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, padding: 18, paddingBottom: 28 },
  header: { gap: 6 },
  section: { gap: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  tile: { backgroundColor: colors.surface, borderRadius: 6, overflow: "hidden" },
  tileImage: { height: "100%", width: "100%" },
  pressed: { opacity: 0.8 },
  playBadge: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 12,
    bottom: 6,
    height: 24,
    justifyContent: "center",
    position: "absolute",
    right: 6,
    width: 24,
  },
  error: { color: colors.live },
});
