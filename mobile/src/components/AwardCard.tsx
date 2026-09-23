import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { resolveMediaUrl } from "../lib/api";
import { awardLines, awardTone, type Award } from "../lib/awards";
import { colors } from "../theme";
import { Body, Muted } from "./Text";

/**
 * Eine Auszeichnung (#230): Platz mit Gold/Silber/Bronze, Turnier, Spiel, Tag, Teilnehmer,
 * Saison, Bilanz - ein hochgeladenes Bild liegt dahinter. Tippen öffnet das Turnier; die
 * Zusatzaktion („Als Profilbanner“) kommt vom Bildschirm.
 */
export function AwardCard({
  award,
  onPress,
  action,
  featured = false,
}: {
  award: Award;
  onPress?: () => void;
  action?: React.ReactNode;
  featured?: boolean;
}) {
  const tone = awardTone(award);
  const image = award.image_url ? resolveMediaUrl(award.image_url) : "";
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? "button" : undefined} testID={`award-${award.id}`} style={({ pressed }) => [styles.card, { borderColor: tone.color }, featured && styles.featured, pressed && styles.pressed]}>
      {image ? <Image source={{ uri: image }} style={styles.image} resizeMode="cover" /> : null}
      <View style={styles.row}>
        <View style={[styles.mark, { borderColor: tone.color }]}>
          <Ionicons name={award.kind === "trophy" ? "trophy-outline" : "medal-outline"} color={tone.color} size={22} />
        </View>
        <View style={styles.text}>
          <View style={styles.chips}>
            <Muted style={[styles.rank, { color: tone.color }]} testID={`award-rank-${award.id}`}>{award.rank_label}</Muted>
            {tone.label ? <Muted style={[styles.chip, { color: tone.color, borderColor: tone.color }]}>{tone.label}</Muted> : null}
            {award.team?.name ? <Muted style={styles.team}>{award.team.name}</Muted> : null}
          </View>
          <Body style={styles.title} numberOfLines={2}>{award.tournament?.title || "Turnier"}</Body>
          <Muted numberOfLines={2}>{awardLines(award).join(" · ")}</Muted>
          {award.record ? <Body style={[styles.record, { color: tone.color }]} testID={`award-record-${award.id}`}>{award.record}</Body> : null}
        </View>
        {action ? <View style={styles.action}>{action}</View> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
    padding: 12,
  },
  featured: {
    borderWidth: 2,
  },
  image: {
    bottom: 0,
    left: 0,
    opacity: 0.28,
    position: "absolute",
    right: 0,
    top: 0,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  mark: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
    borderRadius: 8,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  text: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  chips: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  rank: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  chip: {
    borderRadius: 6,
    borderWidth: 1,
    fontSize: 10,
    fontWeight: "900",
    paddingHorizontal: 6,
    paddingVertical: 1,
    textTransform: "uppercase",
  },
  team: {
    fontSize: 11,
    fontWeight: "700",
  },
  title: {
    fontWeight: "900",
  },
  record: {
    fontWeight: "900",
  },
  action: {
    alignSelf: "flex-start",
  },
  pressed: {
    opacity: 0.8,
  },
});
