import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { groupBySeason, metalColor, rewardMeta, type Reward, type RewardAward } from "../../lib/leagueRewards";
import { colors, radius, roles, surfaces } from "../../theme";
import { MediaImage } from "../MediaImage";
import { Glow, Press, StaggerIn } from "../motion";
import { Body, Muted } from "../Text";

// Belohnungen der Liga in der App (#2173, Web: components/tls/rewards/RewardArt.jsx und RewardCollection.jsx, docs/LIGA.md F.4): je
// Season eine Gruppe, die neueste oben, darin Platz 1 zuerst. Die Vorlage zeigt Art und Metall (Gold, Silber, Bronze, sonst
// Lionsquad-Blau); ein hochgeladenes Bild liegt darüber. Wer die Sammlung besitzt (eigenes Profil, Teamleitung), wählt einen Titel
// für neben dem Namen. Die Karten bauen sich gestaffelt auf, ein gewählter Titel leuchtet einmal auf.

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

export function RewardCollection({ awards, titleId = null, onTitle = null, busy = false, testID = "reward-collection" }: {
  awards?: RewardAward[] | null;
  titleId?: string | null;
  onTitle?: ((id: string | null) => void) | null;
  busy?: boolean;
  testID?: string;
}) {
  const groups = groupBySeason(awards);
  if (!groups.length) return null;
  return (
    <View style={styles.wrap} testID={testID}>
      {groups.map((group) => (
        <View key={group.key} style={styles.group} accessibilityLabel={`Belohnungen ${group.season}`} testID={`${testID}-season`}>
          <View style={styles.head}>
            <Text style={styles.season} accessibilityRole="header">{group.season}</Text>
            {group.league ? <Text style={styles.league}>{group.league}</Text> : null}
          </View>
          <StaggerIn style={styles.list}>
            {group.items.map((award) => {
              const color = metalColor(award.reward?.art?.metal);
              const titled = titleId === award.id;
              return (
                <View key={award.id} style={[styles.card, { borderColor: titled ? roles.brand : "rgba(255,255,255,0.1)" }]} testID={`reward-card-${award.id}`}>
                  <RewardArt reward={award.reward} />
                  <View style={styles.text}>
                    <Text style={[styles.kind, { color }]}>{award.reward?.kind_label}</Text>
                    <Body style={styles.name} numberOfLines={2}>{award.reward?.name}</Body>
                    <Muted style={styles.meta} numberOfLines={2}>{rewardMeta(award)}</Muted>
                    {award.team?.name ? <Muted style={styles.meta} numberOfLines={1}>{award.team.name}</Muted> : null}
                  </View>
                  {onTitle && award.reward?.kind === "title" ? (
                    <Press
                      haptic
                      disabled={busy}
                      onPress={() => onTitle(titled ? null : award.id)}
                      style={[styles.action, titled && styles.actionOn]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: titled }}
                      testID={`reward-title-${award.id}`}
                    >
                      <Text style={[styles.actionText, titled && { color: roles.brand }]}>{titled ? "Titel ✓" : "Als Titel"}</Text>
                    </Press>
                  ) : null}
                  {titled ? <Glow trigger={titleId} tone="brand" /> : null}
                </View>
              );
            })}
          </StaggerIn>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  group: { gap: 8 },
  head: { alignItems: "baseline", flexDirection: "row", flexWrap: "wrap", gap: 8 },
  season: { color: colors.white, fontSize: 17, fontWeight: "900", textTransform: "uppercase" },
  league: { color: roles.quiet, fontSize: 11, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase" },
  list: { gap: 8 },
  card: { alignItems: "center", backgroundColor: surfaces.s1, borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", gap: 12, overflow: "hidden", padding: 10 },
  art: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.35)", borderRadius: 999, borderWidth: 2, justifyContent: "center", overflow: "hidden" },
  text: { flex: 1, minWidth: 0 },
  kind: { fontSize: 10, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase" },
  name: { fontWeight: "900" },
  meta: { fontSize: 12 },
  action: { borderColor: "rgba(255,255,255,0.2)", borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 6 },
  actionOn: { borderColor: "rgba(41,182,232,0.7)" },
  actionText: { color: roles.muted, fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  chip: { alignItems: "center", alignSelf: "flex-start", borderRadius: 999, borderWidth: 1, flexDirection: "row", gap: 6, maxWidth: "100%", paddingLeft: 3, paddingRight: 10, paddingVertical: 3 },
  chipText: { flexShrink: 1, fontSize: 12, fontWeight: "900" },
});
