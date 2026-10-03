import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AchievementGroupCard } from "../../components/AchievementGroupCard";
import { Card } from "../../components/Card";
import { FadeIn, staggerDelay } from "../../components/FadeIn";
import { EmptyState } from "../../components/ListState";
import type { AchievementGroup } from "../../lib/achievements";
import { useProgressiveCount } from "../../lib/progressive";
import { colors, radius } from "../../theme";
import { Badge } from "../Badge";
import { materialColor, materialName } from "../badgeArt";
import { earnedOnlyGroups } from "../showcase/model";
import { type PinnedAward, categoryProgress } from "./model";

// Erfolge einer anderen Person in der App (E13, #623) - wie das öffentliche Profil im Web (#619): die angehefteten
// Lieblingserfolge in der Übersicht, im Reiter die Kategorien mit Erreichtem, die gefundenen Geheimen und nur die
// erreichten Stufen. Hat die Person ihre Erfolge privat gestellt, steht nur das da.

export type PublicAchievementData = {
  groups?: AchievementGroup[];
  awards?: Array<Record<string, unknown>>;
  pinned?: PinnedAward[];
  hidden?: { total?: number; earned?: number } | null;
  achievements_hidden?: boolean;
};

/** Die bis zu sechs Lieblingsstufen in der Reihenfolge der Person. */
export function PinnedAwardsCard({ pinned, onShowAll }: { pinned: PinnedAward[]; onShowAll?: () => void }) {
  if (!pinned.length) return null;
  return (
    <Card style={styles.card} testID="profile-pinned-awards">
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text style={[styles.kicker, { color: colors.gold }]}>Angeheftet</Text>
          <Text style={styles.title}>Lieblingserfolge</Text>
        </View>
        {onShowAll ? (
          <Pressable onPress={onShowAll} hitSlop={8} accessibilityRole="button" testID="profile-pinned-all">
            <Text style={styles.link}>Alle ansehen</Text>
          </Pressable>
        ) : null}
      </View>
      {pinned.map((award) => {
        const color = materialColor(award);
        return (
          <View key={award.code} style={[styles.pinnedRow, { borderColor: `${color}55` }]} testID={`profile-pinned-${award.code}`}>
            <Badge material={award.material} level={award.level} rank={award.rank} art={award.art} icon={award.icon || award.group_icon} size={44} />
            <View style={styles.flex}>
              <Text style={[styles.kicker, { color }]} numberOfLines={1}>{materialName(award)}</Text>
              <Text style={styles.name} numberOfLines={1}>{award.name}</Text>
              {award.group_name ? <Text style={styles.muted} numberOfLines={1}>{award.group_name}</Text> : null}
            </View>
          </View>
        );
      })}
    </Card>
  );
}

export function PublicAchievementsTab({ data, displayName }: { data: PublicAchievementData; displayName: string }) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = useCallback((code: string) => setOpenGroups((current) => ({ ...current, [code]: !current[code] })), []);
  // Wie im Web auch die Fun-Erfolge („Geheim / Fun“) - nur was die Person wirklich hat.
  const groups = useMemo(() => earnedOnlyGroups(data.groups || []), [data.groups]);
  const bars = useMemo(() => categoryProgress(data.groups || []).filter((row) => row.earned > 0), [data.groups]);
  const hiddenFound = Number(data.hidden?.earned || 0);
  const shownCount = useProgressiveCount(groups.length, "public", 10, 6);

  if (data.achievements_hidden) {
    return (
      <Card style={styles.card} testID="profile-achievements-private">
        <EmptyState icon="lock-closed-outline" title="Erfolge sind privat" detail={`${displayName} zeigt Erfolge nicht öffentlich.`} />
      </Card>
    );
  }
  return (
    <View style={styles.root}>
      {bars.length || hiddenFound > 0 ? (
        <View style={styles.bars} testID="profile-category-bars">
          {bars.map((row) => (
            <View key={row.key} style={styles.bar} testID={`profile-category-bar-${row.key}`}>
              <View style={styles.barHead}>
                <Ionicons name={row.icon} size={13} color={row.accent} />
                <Text style={styles.barLabel} numberOfLines={2}>{row.label}</Text>
                <Text style={styles.barCount}>{row.earned} von {row.total}</Text>
              </View>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${row.total ? Math.round((row.earned / row.total) * 100) : 0}%`, backgroundColor: row.accent }]} />
              </View>
            </View>
          ))}
          {hiddenFound > 0 ? (
            <View style={styles.hiddenFound} testID="profile-hidden-found">
              <Ionicons name="help-circle-outline" size={15} color="#c084fc" />
              <Text style={styles.hiddenText}>{hiddenFound === 1 ? "Ein geheimer Erfolg gefunden" : `${hiddenFound} geheime Erfolge gefunden`}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {groups.length ? (
        groups.slice(0, shownCount).map((group, index) => (
          <FadeIn key={group.code} delay={staggerDelay(index)}>
            <AchievementGroupCard group={group} open={Boolean(openGroups[group.code])} onToggle={toggleGroup} countOnly />
          </FadeIn>
        ))
      ) : (
        <Card style={styles.card}>
          <EmptyState icon="trophy-outline" title="Noch keine Erfolge" detail="Noch keine Achievements freigeschaltet." tone="gold" />
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  card: { padding: 14, gap: 10 },
  flex: { flex: 1, minWidth: 0 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  kicker: { fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.6 },
  title: { color: colors.white, fontSize: 16, fontWeight: "900", textTransform: "uppercase", marginTop: 2 },
  link: { color: colors.cyan, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  name: { color: colors.white, fontSize: 15, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 12 },
  pinnedRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: radius.sm, backgroundColor: colors.black, padding: 10 },
  bars: { gap: 8 },
  bar: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  barHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  barLabel: { color: colors.white, fontSize: 13, fontWeight: "800", textTransform: "uppercase", flex: 1 },
  barCount: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] },
  track: { height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.06)", overflow: "hidden" },
  fill: { height: 4, borderRadius: 2 },
  hiddenFound: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: "rgba(168,85,247,0.3)", backgroundColor: "#0F0A16", borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10 },
  hiddenText: { color: "#c084fc", fontSize: 13 },
});
