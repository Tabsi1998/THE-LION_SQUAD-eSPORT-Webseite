import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { FadeIn, staggerDelay } from "../FadeIn";
import { MediaImage } from "../MediaImage";
import { Body, Muted } from "../Text";
import { ink } from "./parts";
import type { PoolGroup } from "../../lib/teamLeague";
import { surfaces } from "../../theme";

// Maps mit Bild (#1616, #1974), wie im Web (components/tls/maps/MapPoolView.jsx, maps.css): ein Bild im Seitenverhältnis
// 16:9 mit dem Namen unten auf einer dunklen Kante; ohne Bild ein ruhiges Feld mit Karten-Symbol. Der Map-Pool je Modus
// (Saison, Turnier, Phase) als Raster mit zwei Spalten.

/** Das Bild einer Map (16:9) - ohne Bild ein Platzhalter mit Symbol. */
export function MapImage({ uri, children, style, dim = false }: { uri?: string | null; children?: React.ReactNode; style?: StyleProp<ViewStyle>; dim?: boolean }) {
  const fallback = (
    <View style={styles.fallback}>
      <Ionicons name="map-outline" size={20} color="rgba(41,182,232,0.35)" />
    </View>
  );
  return (
    <View style={[styles.frame, style]}>
      {uri ? <MediaImage uri={uri} resizeMode="cover" style={[styles.image, dim && styles.dim]} fallback={fallback} /> : fallback}
      {children}
    </View>
  );
}

/** Eine Map-Karte: Bild mit Namen in Großbuchstaben unten. */
export function MapCard({ name, image, testID }: { name: string; image?: string | null; testID?: string }) {
  return (
    <MapImage uri={image}>
      <View style={styles.shade} accessible accessibilityLabel={name} testID={testID}>
        <Body style={styles.name} numberOfLines={1}>{name}</Body>
      </View>
    </MapImage>
  );
}

/** Ein Map-Pool je Modus (Saison #1616, Turnier und Phase): Überschrift mit Anzahl nur bei mehreren Gruppen oder einem
 * Modus, die Maps in zwei Spalten, gestaffelt eingeblendet. Ohne Maps nichts. */
export function MapPoolView({ title, hint, groups, testID, style }: { title: string; hint?: string; groups: PoolGroup[]; testID?: string; style?: StyleProp<ViewStyle> }) {
  if (!groups.length) return null;
  let index = 0;
  return (
    <View style={[styles.pool, style]} testID={testID}>
      <Muted style={styles.title} accessibilityRole="header">{title}</Muted>
      {hint ? <Muted style={styles.hint}>{hint}</Muted> : null}
      {groups.map((group) => (
        <View key={group.key} style={styles.group}>
          {group.heading ? (
            <View style={styles.groupHead}>
              <Body style={styles.groupName}>{group.heading}</Body>
              <Muted style={styles.groupCount}>{group.count}</Muted>
            </View>
          ) : null}
          <View style={styles.grid}>
            {group.maps.map((map) => (
              <FadeIn key={map.key} delay={staggerDelay(index++)} style={styles.cell}>
                <MapCard name={map.name} image={map.image} testID={`map-pool-${map.key}`} />
              </FadeIn>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { aspectRatio: 16 / 9, backgroundColor: surfaces.s2, borderRadius: 6, overflow: "hidden", width: "100%" },
  image: { backgroundColor: "transparent", borderWidth: 0, height: "100%", width: "100%" },
  dim: { opacity: 0.35 },
  fallback: { alignItems: "center", backgroundColor: "#101016", flex: 1, justifyContent: "center" },
  shade: { backgroundColor: "rgba(0,0,0,0.55)", bottom: 0, left: 0, paddingHorizontal: 8, paddingVertical: 4, position: "absolute", right: 0 },
  name: { color: "#FFFFFF", fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  pool: { gap: 10 },
  title: { color: ink.quiet, fontSize: 11, fontWeight: "800", letterSpacing: 2, textTransform: "uppercase" },
  hint: { color: ink.muted, fontSize: 13 },
  group: { gap: 8 },
  groupHead: { alignItems: "baseline", flexDirection: "row", gap: 8 },
  groupName: { color: ink.text, fontSize: 14, fontWeight: "700" },
  groupCount: { color: ink.quiet, fontSize: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cell: { width: "48.5%" },
});
