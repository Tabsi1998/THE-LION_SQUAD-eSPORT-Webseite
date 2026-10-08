import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { BrandLogo } from "../BrandLogo";
import { MediaImage } from "../MediaImage";
import { Body, Muted } from "../Text";
import { faceTone, teamColorHex } from "../../lib/teamColors";
import { initials, orderedFaces } from "../../lib/teamPage";
import { colors } from "../../theme";
import type { Team } from "../../types";

// Wappen-Kopf der Team-Seite (#1347) - derselbe Kopf wie im Web: Band in der Team-Farbe als dunkler Verlauf mit
// Löwen-Anschnitt, mittig das Logo (72 px), darunter Name, Kürzel, Spiel und Level in einer Zeile, die Mitglieder
// als Gesichter (56 px) mit Rolle zum Wischen; du mit Ecken-Klammern. Keine Krone über dem Logo - die Platz-1-Krone
// steht klein und golden neben dem Level. Der Verlauf ist ein festes SVG (keine Bewegung, auf Android sicher).

export type TeamHeaderData = { color?: string; color_hex?: string; color_source?: string; game?: { id?: string; name?: string; short_name?: string } | null };

export function TeamHeader({ team, header, level, crown, userId, onOpenProfile, actions }: {
  team: Team;
  header?: TeamHeaderData | null;
  level?: number | null;
  crown?: string | null;
  userId?: string | null;
  onOpenProfile: (username?: string | null) => void;
  actions?: React.ReactNode;
}) {
  const hex = header?.color_hex || teamColorHex(team.color);
  const faces = orderedFaces(team);
  const game = header?.game;
  return (
    <View style={styles.wrap} testID="team-header">
      <View style={styles.band} testID="team-band">
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="teamBand" x1="0" y1="0" x2="0.35" y2="1">
              <Stop offset="0" stopColor={hex} stopOpacity="0.9" />
              <Stop offset="0.45" stopColor={hex} stopOpacity="0.55" />
              <Stop offset="1" stopColor={colors.black} stopOpacity="1" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#teamBand)" />
        </Svg>
        <BrandLogo variant="mascot" style={styles.lion} testID="team-band-lion" />
      </View>
      <View style={styles.crestRow}>
        <MediaImage
          uri={team.logo_url}
          style={[styles.crest, { borderColor: hex }]}
          fallback={<Body style={[styles.crestText, { color: hex }]}>{team.tag || initials(team.name)}</Body>}
        />
      </View>
      <Body style={styles.name} testID="team-name">{team.name}</Body>
      <View style={styles.line} testID="team-header-line">
        {team.tag ? <Muted style={styles.tag}>{team.tag}</Muted> : null}
        {game?.name || game?.short_name ? (
          <>
            <Muted>·</Muted>
            <View style={styles.plaque}><Muted style={styles.plaqueText}>{game.name || game.short_name}</Muted></View>
          </>
        ) : null}
        {level ? (
          <>
            <Muted>·</Muted>
            <Muted testID="team-header-level">Level {level}</Muted>
            {crown === "gold" ? <Ionicons name="trophy" size={13} color={colors.gold} accessibilityLabel="Punktebestes Team" /> : null}
          </>
        ) : null}
      </View>
      {team.description ? <Muted style={styles.description}>{team.description}</Muted> : null}
      {actions ? <View style={styles.actions}>{actions}</View> : null}
      {faces.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.faces} testID="team-faces">
          {faces.map((face) => {
            const name = face.display_name || face.username || "Spieler";
            const mine = Boolean(userId && face.id === userId);
            return (
              <Pressable
                key={face.id}
                onPress={() => onOpenProfile(face.username)}
                style={({ pressed }) => [styles.face, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`${name}, ${face.roleLabel}${mine ? " (du)" : ""}`}
                testID={`team-face-${face.id}`}
              >
                <View style={styles.avatarWrap}>
                  <MediaImage
                    uri={face.avatar_url}
                    style={[styles.avatar, !face.avatar_url && { backgroundColor: faceTone(name) }]}
                    fallback={<Body style={styles.avatarText}>{initials(name)}</Body>}
                  />
                  {mine ? <YouCorners /> : null}
                </View>
                <Muted style={styles.faceName} numberOfLines={1}>{name}</Muted>
                <Muted style={[styles.faceRole, face.role !== "player" && styles.faceRoleLead]} testID={`team-face-role-${face.id}`}>{face.roleLabel.toUpperCase()}</Muted>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}

function YouCorners() {
  return (
    <View pointerEvents="none" style={styles.corners} testID="team-face-you">
      <View style={[styles.corner, styles.cornerTL]} />
      <View style={[styles.corner, styles.cornerTR]} />
      <View style={[styles.corner, styles.cornerBL]} />
      <View style={[styles.corner, styles.cornerBR]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 6 },
  band: { borderColor: colors.border, borderRadius: 8, borderWidth: 1, height: 120, overflow: "hidden", width: "100%" },
  lion: { height: 200, opacity: 0.14, position: "absolute", right: -40, top: -40, width: 200 },
  crestRow: { marginTop: -40 },
  crest: { backgroundColor: colors.black, borderRadius: 12, borderWidth: 2, height: 72, width: 72 },
  crestText: { fontSize: 20, fontWeight: "900" },
  name: { fontSize: 26, fontWeight: "900", marginTop: 6, textAlign: "center" },
  line: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center" },
  tag: { color: colors.white, fontWeight: "900" },
  plaque: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.15)", borderRadius: 4, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 1 },
  plaqueText: { color: colors.white, fontSize: 12, fontWeight: "800" },
  description: { marginTop: 4, textAlign: "center" },
  actions: { alignSelf: "stretch", flexDirection: "row", gap: 10, marginTop: 8 },
  faces: { gap: 12, paddingHorizontal: 4, paddingVertical: 10 },
  face: { alignItems: "center", gap: 3, width: 68 },
  pressed: { opacity: 0.72 },
  avatarWrap: { height: 56, width: 56 },
  avatar: { borderColor: "rgba(255,255,255,0.15)", borderRadius: 28, borderWidth: 1, height: 56, overflow: "hidden", width: 56 },
  avatarText: { color: colors.white, fontWeight: "900" },
  faceName: { color: colors.white, fontSize: 11, fontWeight: "800" },
  faceRole: { fontSize: 10, fontWeight: "800" },
  faceRoleLead: { color: "rgba(255,255,255,0.8)" },
  corners: { bottom: -6, left: -6, position: "absolute", right: -6, top: -6 },
  corner: { borderColor: colors.cyan, height: 10, position: "absolute", width: 10 },
  cornerTL: { borderLeftWidth: 2, borderTopWidth: 2, left: 0, top: 0 },
  cornerTR: { borderRightWidth: 2, borderTopWidth: 2, right: 0, top: 0 },
  cornerBL: { borderBottomWidth: 2, borderLeftWidth: 2, bottom: 0, left: 0 },
  cornerBR: { borderBottomWidth: 2, borderRightWidth: 2, bottom: 0, right: 0 },
});
