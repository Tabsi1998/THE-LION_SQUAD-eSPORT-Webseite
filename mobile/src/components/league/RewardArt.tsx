import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { metalColor, type Reward, type RewardAward } from "../../lib/leagueRewards";
import { MediaImage } from "../MediaImage";

// Vorlage einer Liga-Belohnung in der App (#2173, Web: components/tls/rewards/RewardArt.jsx und RewardChip.jsx, docs/LIGA.md F.4): Art
// und Metall (Gold, Silber, Bronze, sonst Lionsquad-Blau); ein hochgeladenes Bild liegt darüber. Dazu der Titel neben dem Namen. Die
// Sammlung steht seit #2425 in der Vitrine „Trophäen“ (TrophyCabinet.tsx).

const KIND_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = { medal: "medal", banner: "flag", emblem: "shield", title: "ribbon" };

export function RewardArt({ reward, size = 52 }: { reward?: Reward | null; size?: number }) {
  const color = metalColor(reward?.art?.metal);
  return (
    <View style={[styles.art, { borderColor: color, height: size, width: size }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {reward?.image_url ? (
        <MediaImage uri={reward.image_url} style={StyleSheet.absoluteFill} fallback={null} />
      ) : (
        <Ionicons name={KIND_ICONS[String(reward?.kind)] || "medal"} size={Math.round(size * 0.5)} color={color} />
      )}
    </View>
  );
}

/** Der Titel neben dem Namen (`featured_title`) - eine Belohnung der Art „Titel“. */
export function RewardChip({ award, testID = "featured-title" }: { award?: RewardAward | null; testID?: string }) {
  if (!award?.reward) return null;
  const color = metalColor(award.reward.art?.metal);
  return (
    <View style={[styles.chip, { borderColor: color }]} testID={testID} accessibilityLabel={`Titel: ${award.reward.name}`}>
      <RewardArt reward={award.reward} size={20} />
      <Text style={[styles.chipText, { color }]} numberOfLines={1}>{award.reward.name}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  art: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.35)", borderRadius: 999, borderWidth: 2, justifyContent: "center", overflow: "hidden" },
  chip: { alignItems: "center", alignSelf: "flex-start", borderRadius: 999, borderWidth: 1, flexDirection: "row", gap: 6, maxWidth: "100%", paddingLeft: 3, paddingRight: 10, paddingVertical: 3 },
  chipText: { flexShrink: 1, fontSize: 12, fontWeight: "900" },
});
