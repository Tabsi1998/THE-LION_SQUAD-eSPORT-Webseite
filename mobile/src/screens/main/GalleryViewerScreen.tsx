import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Image, Linking, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useVideoPlayer, VideoView } from "expo-video";
import { ErrorState, SkeletonList } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { Body, Muted } from "../../components/Text";
import { api, errorMessage, resolveMediaUrl } from "../../lib/api";
import { groupBySection, mediaType, mediaUrl, posterUrl, sizedUpload, type GalleryAlbum, type GalleryItem } from "../../lib/gallery";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";

// Großansicht (#236): Wischen zwischen Bildern (1600 px), Zoomen mit zwei Fingern, Videos mit
// dem Player aus dem Chat, Einbettungen öffnen sich draußen. Teilen und Speichern gehen über das
// System-Teilen mit der heruntergeladenen Datei.

type Props = NativeStackScreenProps<MoreStackParamList, "GalleryViewer">;

export function GalleryViewerScreen({ navigation, route }: Props) {
  const { albumId, index: startIndex } = route.params;
  const { width, height } = useWindowDimensions();
  const [album, setAlbum] = useState<GalleryAlbum | null>(null);
  const [error, setError] = useState("");
  const [index, setIndex] = useState(startIndex);
  const [chrome, setChrome] = useState(true);
  const [sharing, setSharing] = useState(false);
  const list = useRef<FlatList<GalleryItem>>(null);

  useEffect(() => {
    api.get<GalleryAlbum>(`/gallery/${encodeURIComponent(albumId)}`)
      .then((response) => setAlbum(response.data))
      .catch((err) => setError(errorMessage(err, "Das Album konnte nicht geladen werden.")));
  }, [albumId]);

  const items = useMemo(() => (album ? groupBySection(album).flatMap((group) => group.items) : []), [album]);
  const current = items[index];

  useEffect(() => {
    navigation.setOptions({ title: items.length ? `${index + 1} / ${items.length}` : "Galerie" });
  }, [index, items.length, navigation]);

  const share = useCallback(async () => {
    if (!current || sharing) return;
    const url = resolveMediaUrl(mediaUrl(current));
    if (!url) return;
    setSharing(true);
    try {
      if (mediaType(current) === "embed" || !(await Sharing.isAvailableAsync())) {
        await Linking.openURL(url);
        return;
      }
      const name = url.split("?")[0].split("/").pop() || "bild";
      const target = `${FileSystem.cacheDirectory}galerie-${name}`;
      const download = await FileSystem.downloadAsync(url, target);
      await Sharing.shareAsync(download.uri, { dialogTitle: current.caption || album?.title || "Bild teilen" });
    } catch (err) {
      Alert.alert("Teilen nicht möglich", errorMessage(err, "Die Datei konnte nicht geladen werden."));
    } finally {
      setSharing(false);
    }
  }, [album?.title, current, sharing]);

  if (error) return <Screen><ErrorState title="Album nicht erreichbar" detail={error} /></Screen>;
  if (!album) return <Screen><SkeletonList count={1} hasImage /></Screen>;

  return (
    <View style={styles.root} testID="gallery-viewer">
      <FlatList
        ref={list}
        data={items}
        horizontal
        pagingEnabled
        initialScrollIndex={Math.min(startIndex, Math.max(0, items.length - 1))}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        keyExtractor={(item) => item.id}
        onMomentumScrollEnd={(event) => setIndex(Math.round(event.nativeEvent.contentOffset.x / width))}
        showsHorizontalScrollIndicator={false}
        renderItem={({ item, index: itemIndex }) => (
          <Slide item={item} width={width} height={height} active={itemIndex === index} onTap={() => setChrome((value) => !value)} />
        )}
      />
      {chrome ? (
        <View style={styles.chrome} pointerEvents="box-none">
          {current?.caption ? <Body style={styles.caption}>{current.caption}</Body> : null}
          <View style={styles.actions}>
            <Pressable onPress={share} disabled={sharing} accessibilityRole="button" accessibilityLabel="Teilen oder speichern" style={({ pressed }) => [styles.action, pressed && styles.pressed]} testID="gallery-share">
              <Ionicons name="share-outline" color={colors.white} size={20} />
              <Muted style={styles.actionText}>{sharing ? "Lade ..." : "Teilen / Speichern"}</Muted>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Slide({ item, width, height, active, onTap }: { item: GalleryItem; width: number; height: number; active: boolean; onTap: () => void }) {
  const type = mediaType(item);
  if (type === "video") return <VideoSlide item={item} width={width} height={height} active={active} />;
  if (type === "embed") {
    return (
      <Pressable onPress={() => Linking.openURL(resolveMediaUrl(mediaUrl(item)))} style={[styles.slide, { width, height }]} accessibilityRole="link">
        <Image source={{ uri: resolveMediaUrl(sizedUpload(posterUrl(item), 800)) }} style={styles.embedPoster} resizeMode="cover" />
        <View style={styles.embedHint}>
          <Ionicons name="open-outline" color={colors.white} size={22} />
          <Body style={styles.embedText}>Video draußen öffnen</Body>
        </View>
      </Pressable>
    );
  }
  return (
    <ScrollView
      style={{ width, height }}
      contentContainerStyle={styles.zoomContent}
      maximumZoomScale={4}
      minimumZoomScale={1}
      bouncesZoom
      centerContent
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
    >
      <Pressable onPress={onTap} style={[styles.slide, { width, height }]}>
        <Image source={{ uri: resolveMediaUrl(sizedUpload(mediaUrl(item), 1600)) }} style={{ width, height }} resizeMode="contain" accessibilityLabel={item.caption || "Bild"} />
      </Pressable>
    </ScrollView>
  );
}

function VideoSlide({ item, width, height, active }: { item: GalleryItem; width: number; height: number; active: boolean }) {
  const player = useVideoPlayer({ uri: resolveMediaUrl(mediaUrl(item)) }, (instance) => { instance.loop = false; });
  useEffect(() => {
    if (!active) player.pause?.();
  }, [active, player]);
  return (
    <View style={[styles.slide, { width, height }]}>
      <VideoView player={player} style={{ width, height: Math.min(height, (width * 9) / 16) }} nativeControls contentFit="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.black, flex: 1 },
  slide: { alignItems: "center", backgroundColor: colors.black, justifyContent: "center" },
  zoomContent: { flexGrow: 1 },
  chrome: {
    bottom: 0,
    gap: 8,
    left: 0,
    padding: 16,
    paddingBottom: 28,
    position: "absolute",
    right: 0,
  },
  caption: { backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 6, padding: 8 },
  actions: { flexDirection: "row", gap: 10 },
  action: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionText: { color: colors.white, fontWeight: "800" },
  pressed: { opacity: 0.7 },
  embedPoster: { height: "60%", opacity: 0.5, width: "100%" },
  embedHint: { alignItems: "center", gap: 6, position: "absolute" },
  embedText: { fontWeight: "900" },
});
