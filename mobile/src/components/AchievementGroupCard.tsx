import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AchievementGroup, AchievementTier, groupProgress } from "../lib/achievements";
import { Badge } from "../achievements/Badge";
import { materialColor, materialName } from "../achievements/badgeArt";
import { colors, radius } from "../theme";
import { Card } from "./Card";

// Eine Erfolgsgruppe im Profil (#218, Erfolge II E13 #623): das Abzeichen der höchsten erreichten Stufe
// (Material, Rang-Kerben, Motiv der Gruppe) - ohne Vergabe die Silhouette der nächsten Stufe mit
// Fortschrittsring -, der Fortschritt schon in der zugeklappten Zeile und aufgeklappt jede Stufe mit
// ihrem Abzeichen.

// memo: Auf- und Zuklappen einer Karte zeichnet nur diese neu, nicht alle ~150 Abzeichen der Liste.
export const AchievementGroupCard = React.memo(function AchievementGroupCard({ group, open, onToggle }: { group: AchievementGroup; open: boolean; onToggle: (code: string) => void }) {
  const tiers = group.tiers || [];
  const progress = groupProgress(group);
  const accent = group.accent_color || colors.cyan;
  const shown = progress.top || progress.next || tiers[0] || null;
  const topColor = progress.top ? materialColor(progress.top) : colors.muted;
  const strong = Number(progress.top?.rank || 0) >= 6 || Number(progress.top?.level || 0) >= 4;
  return (
    <Card style={[styles.card, strong && { borderColor: `${topColor}88` }]}>
      <Pressable
        onPress={() => onToggle(group.code)}
        style={styles.head}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${group.name}, ${progress.label}${progress.top ? `, Stufe ${materialName(progress.top)}` : ""}`}
        testID={`achievement-group-${group.code}`}
      >
        <Badge
          material={shown?.material}
          level={shown?.level}
          rank={shown?.rank}
          art={shown?.art || group.art}
          icon={group.icon}
          earned={Boolean(progress.top)}
          percent={progress.top ? 0 : progress.percent}
          negative={group.is_negative}
          size={46}
          testID={`achievement-badge-${group.code}`}
        />
        <View style={styles.title}>
          <View style={styles.titleRow}>
            <Text style={styles.name} numberOfLines={1}>{group.name}</Text>
            {progress.top ? <Text style={[styles.level, { color: topColor }]}>{materialName(progress.top)}</Text> : null}
          </View>
          <View style={styles.track} testID={`achievement-progress-${group.code}`}>
            <View style={[styles.fill, { width: `${Math.round(progress.percent)}%`, backgroundColor: progress.done ? topColor : accent }]} />
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
          {tiers.map((tier) => <TierRow key={tier.code} tier={tier} group={group} accent={accent} />)}
        </View>
      ) : null}
    </Card>
  );
});

function TierRow({ tier, group, accent }: { tier: AchievementTier; group: AchievementGroup; accent: string }) {
  const color = materialColor(tier);
  const trackable = !tier.earned && Number(tier.target || 0) > 0 && tier.condition_status !== "planned";
  const status = tier.earned ? "Freigeschaltet" : tier.condition_status === "planned" ? "Geplant" : "Gesperrt";
  const percent = Math.max(0, Math.min(100, Math.round(Number(tier.percent || 0))));
  return (
    <View style={[styles.tierRow, tier.earned && { borderColor: `${color}66`, backgroundColor: `${color}10` }]} testID={`achievement-tier-${tier.code}`}>
      <Badge
        material={tier.material}
        level={tier.level}
        rank={tier.rank}
        art={tier.art || group.art}
        icon={group.icon}
        earned={Boolean(tier.earned)}
        percent={trackable ? percent : 0}
        negative={group.is_negative}
        size={36}
      />
      <View style={styles.tierText}>
        <Text style={[styles.tierLevel, { color: tier.earned ? color : colors.muted }]}>{materialName(tier)} · {status}</Text>
        <Text style={styles.name}>{tier.name}</Text>
        {tier.description ? <Text style={styles.muted}>{tier.description}</Text> : null}
        {!tier.earned && tier.how_to ? <Text style={styles.muted}>So schaffst du es: {tier.how_to}</Text> : null}
        {trackable ? (
          <>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${percent}%`, backgroundColor: accent }]} />
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
  title: { flex: 1, minWidth: 0, gap: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { color: colors.white, fontWeight: "800", fontSize: 15, flexShrink: 1 },
  level: { fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.8 },
  muted: { color: colors.muted, fontSize: 12 },
  track: { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.08)", overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  tiers: { marginTop: 12, gap: 8 },
  tierRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", borderRadius: radius.md, padding: 8 },
  tierText: { flex: 1, minWidth: 0, gap: 3 },
  tierLevel: { fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.8 },
  points: { color: colors.muted, fontSize: 12, fontWeight: "800" },
});
