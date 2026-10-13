import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { EmptyState, ErrorState, SkeletonList, loadProblem, type LoadProblem } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { seasonScrollProps } from "../../seasons/sky/scroll";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { api, errorMessage, resolveMediaUrl } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { albumCountLabel, groupBySection, mediaType, posterUrl, sizedUpload, type GalleryAlbum, type GalleryItem } from "../../lib/gallery";
import type { MoreStackParamList } from "../../navigation/types";
import { colors, radius } from "../../theme";
import { useShareHeader } from "../../components/HeaderActions";
import { sharePage } from "../../lib/share";
import { PhotoSubmitCard } from "../../components/PhotoSubmitCard";

// Album (#236): Raster aus 400-px-Kacheln, drei je Zeile; Abschnitte wie im Web. Antippen
// öffnet die Großansicht an dieser Stelle.

type Props = NativeStackScreenProps<MoreStackParamList, "GalleryAlbum">;
const GAP = 4;

export function GalleryAlbumScreen({ navigation, route }: Props) {
  const { id } = route.params;
  const { width } = useWindowDimensions();
  const [album, setAlbum] = useState<GalleryAlbum | null>(null);
  // Teilen oben rechts (#1154): die Adresse der Website - in der App öffnet sie diesen Screen, sonst die Website.
  const share = useMemo(() => (album ? () => { void sharePage({ kind: "album", id: String(album.slug || album.id), title: album.title, detail: "Galerie" }); } : null), [album]);
  useShareHeader(navigation, share);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  // Was beim Laden schiefging (#1152): ohne Netz, nicht gefunden oder ein Fehler - nie „nichts da“.
  const [problem, setProblem] = useState<LoadProblem | null>(null);

  const load = useCallback(async () => {
    setProblem(null);
    setError("");
    try {
      const response = await api.get<GalleryAlbum>(`/gallery/${encodeURIComponent(id)}`);
      setAlbum(response.data);
      navigation.setOptions({ title: response.data?.title || "Album" });
    } catch (err) {
      setError(errorMessage(err, "Das Album konnte nicht geladen werden."));
      setProblem(loadProblem(err));
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
  if (!album) return <Screen><ErrorState title="Album nicht gefunden" detail={error || "Dieses Album ist nicht sichtbar oder wurde entfernt."} problem={problem} onRetry={() => { void load(); }} /></Screen>;

  return (
    <Screen padded={false}>
      <ScrollView {...seasonScrollProps("GalleryAlbum")} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.cyan} />}>
        <View style={styles.header}>
          <Title>{album.title}</Title>
          <Muted>{[formatDate(album.taken_at), albumCountLabel(album)].filter(Boolean).join(" · ")}</Muted>
          {/* Fotos gehören zum Event (#1185): das Album nennt sein Event und führt zurück. */}
          {album.event ? (
            <Pressable onPress={() => navigation.navigate("EventDetail", { id: album.event?.slug || album.event?.id || "" })} accessibilityRole="link" accessibilityLabel={`Zum Event ${album.event.name || ""}`.trim()} style={({ pressed }) => [styles.eventLink, pressed && styles.pressed]} testID="album-event-link">
              <Ionicons name="calendar-outline" color={colors.cyan} size={16} />
              <Body style={styles.eventText}>Vom Event: {album.event.name || "Event"}</Body>
              <Ionicons name="chevron-forward" color={colors.cyan} size={16} />
            </Pressable>
          ) : null}
          {album.description ? <Body>{album.description}</Body> : null}
        </View>
        {/* Fotos einsenden (#1186): nur für Mitglieder, nur bei Event-Alben, bis eine Woche danach. */}
        <PhotoSubmitCard albumId={String(album.slug || album.id)} info={album.photo_submission} onSent={() => { void load(); }} />
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
  tile: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: "hidden" },
  tileImage: { height: "100%", width: "100%" },
  pressed: { opacity: 0.8 },
  eventLink: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 6, minHeight: 44 },
  eventText: { color: colors.cyan, fontWeight: "800" },
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
