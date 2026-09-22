import React, { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { EmptyState, ErrorState, OfflineNotice, SkeletonList } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted } from "../../components/Text";
import { api, errorMessage, resolveMediaUrl, responseFromCache } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { albumCountLabel, sizedUpload, type GalleryAlbum } from "../../lib/gallery";
import { useLiveRefresh } from "../../realtime/LiveChangesProvider";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";

// Galerie (#236): Alben wie im Web - öffentliche für alle, Mitglieder-Alben nur angemeldet
// (das entscheidet der Server, die App zeigt, was er liefert).

type Props = NativeStackScreenProps<MoreStackParamList, "Gallery">;

export function GalleryScreen({ navigation }: Props) {
  const [albums, setAlbums] = useState<GalleryAlbum[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await api.get<GalleryAlbum[]>("/gallery", { params: { compact: true, limit: 80 } });
      setAlbums(Array.isArray(response.data) ? response.data : []);
      setOffline(responseFromCache(response));
    } catch (err) {
      setError(errorMessage(err, "Die Galerie konnte nicht geladen werden."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, ["gallery"], { fallbackMs: 60000 });

  if (loading) {
    return <Screen><SkeletonList count={4} hasImage /></Screen>;
  }
  if (error && !albums.length) {
    return <Screen><ErrorState title="Galerie nicht erreichbar" detail={error} /></Screen>;
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.cyan} />}>
        <View style={styles.header}>
          <Heading>Galerie</Heading>
          <Muted>Bilder und Videos von Events, Turnieren und dem Vereinsleben.</Muted>
        </View>
        {offline ? <OfflineNotice detail="Die Alben kommen aus gespeicherten Daten." /> : null}
        {albums.length ? albums.map((album) => (
          <Pressable
            key={album.id}
            onPress={() => navigation.navigate("GalleryAlbum", { id: album.slug || album.id })}
            accessibilityRole="button"
            style={({ pressed }) => [styles.album, pressed && styles.pressed]}
            testID={`gallery-album-${album.slug || album.id}`}
          >
            <MediaImage uri={resolveMediaUrl(sizedUpload(album.cover_url, 800))} style={styles.cover} fallback={<Ionicons name="images-outline" color={colors.cyan} size={32} />} />
            <View style={styles.albumText}>
              <Body style={styles.albumTitle}>{album.title}</Body>
              <Muted>{[formatDate(album.taken_at), albumCountLabel(album)].filter(Boolean).join(" · ")}</Muted>
              {album.visibility && album.visibility !== "public" ? <Muted style={styles.internal}>Nur für Mitglieder</Muted> : null}
            </View>
          </Pressable>
        )) : (
          <EmptyState icon="images-outline" title="Noch keine Alben" detail="Sobald Bilder hochgeladen sind, stehen sie hier." />
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, padding: 18, paddingBottom: 28 },
  header: { gap: 6 },
  album: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
  },
  pressed: { opacity: 0.8 },
  cover: { aspectRatio: 16 / 9, backgroundColor: colors.black, width: "100%" },
  albumText: { gap: 3, padding: 12 },
  albumTitle: { fontSize: 16, fontWeight: "900" },
  internal: { color: colors.gold },
});
