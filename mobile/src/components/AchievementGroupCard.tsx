import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AchievementGroup, AchievementTier, LEVEL_COLORS, LEVEL_NAMES, achievementIcon, groupProgress } from "../lib/achievements";
import { colors, radius } from "../theme";
import { Card } from "./Card";

// Eine Erfolgsgruppe im Profil (#218): echtes Symbol statt Punkt, die erreichte Stufe als
// Farbe, und der Fortschritt zur nächsten Stufe schon in der zugeklappten Zeile.

export function AchievementGroupCard({ group, open, onToggle }: { group: AchievementGroup; open: boolean; onToggle: () => void }) {
  const tiers = group.tiers || [];
  const progress = groupProgress(group);
  const accent = group.accent_color || colors.cyan;
  const levelColor = progress.highestLevel ? LEVEL_COLORS[progress.highestLevel] || accent : colors.muted;
  const locked = progress.highestLevel === 0;
  return (
    <Card style={[styles.card, progress.highestLevel >= 4 && { borderColor: `${accent}88` }]}>
      <Pressable
        onPress={onToggle}
        style={styles.head}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${group.name}, ${progress.label}${progress.highestLevel ? `, Stufe ${LEVEL_NAMES[progress.highestLevel] || progress.highestLevel}` : ""}`}
        testID={`achievement-group-${group.code}`}
      >
        <View style={[styles.icon, { borderColor: `${levelColor}99`, backgroundColor: `${levelColor}1A` }]}>
          <Ionicons name={achievementIcon(group)} size={22} color={locked ? colors.muted : levelColor} />
        </View>
        <View style={styles.title}>
          <View style={styles.titleRow}>
            <Text style={styles.name} numberOfLines={1}>{group.name}</Text>
            {progress.highestLevel ? (
              <Text style={[styles.level, { color: levelColor }]}>{LEVEL_NAMES[progress.highestLevel] || `Stufe ${progress.highestLevel}`}</Text>
            ) : null}
          </View>
          <View style={styles.track} testID={`achievement-progress-${group.code}`}>
            <View style={[styles.fill, { width: `${Math.round(progress.percent)}%`, backgroundColor: progress.done ? LEVEL_COLORS[3] : accent }]} />
          </View>
          <Text style={styles.muted} numberOfLines={1}>
            {progress.next ? `${progress.label} · nächste Stufe: ${progress.next.name}` : progress.label}
          </Text>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
      </Pressable>
      {open ? (
        <View style={styles.tiers}>
          {group.description ? <Text style={styles.muted}>{group.description}</Text> : null}
          {tiers.map((tier) => <TierRow key={tier.code} tier={tier} accent={accent} />)}
        </View>
      ) : null}
    </Card>
  );
}

function TierRow({ tier, accent }: { tier: AchievementTier; accent: string }) {
  const color = LEVEL_COLORS[tier.level || 1] || accent;
  const trackable = !tier.earned && Number(tier.target || 0) > 0 && tier.condition_status !== "planned";
  const status = tier.earned ? "Freigeschaltet" : tier.condition_status === "planned" ? "Geplant" : "Gesperrt";
  return (
    <View style={[styles.tierRow, tier.earned && { borderColor: `${color}66`, backgroundColor: `${color}10` }]}>
      <Ionicons name={tier.earned ? "checkmark-circle" : "lock-closed-outline"} size={18} color={tier.earned ? color : colors.muted} style={styles.tierIcon} />
      <View style={styles.tierText}>
        <Text style={[styles.tierLevel, { color }]}>{LEVEL_NAMES[tier.level || 1] || tier.level_name || ""} · {status}</Text>
        <Text style={styles.name}>{tier.name}</Text>
        {tier.description ? <Text style={styles.muted}>{tier.description}</Text> : null}
        {trackable ? (
          <>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.max(0, Math.min(100, Math.round(Number(tier.percent || 0))))}%`, backgroundColor: accent }]} />
            </View>
            <Text style={styles.muted}>{Number(tier.current || 0).toLocaleString("de-DE")} von {Number(tier.target || 0).toLocaleString("de-DE")}</Text>
          </>
        ) : null}
      </View>
      <Text style={styles.points}>+{tier.points || 0}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 46, height: 46, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, minWidth: 0, gap: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { color: colors.white, fontWeight: "800", fontSize: 15, flexShrink: 1 },
  level: { fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.8 },
  muted: { color: colors.muted, fontSize: 12 },
  track: { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.08)", overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  tiers: { marginTop: 12, gap: 8 },
  tierRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", borderRadius: radius.md, padding: 8 },
  tierIcon: { marginTop: 2 },
  tierText: { flex: 1, minWidth: 0, gap: 3 },
  tierLevel: { fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.8 },
  points: { color: colors.muted, fontSize: 12, fontWeight: "800" },
});
