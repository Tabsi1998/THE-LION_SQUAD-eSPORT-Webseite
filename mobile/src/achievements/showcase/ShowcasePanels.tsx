import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Card } from "../../components/Card";
import { MediaImage } from "../../components/MediaImage";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { achievementIcon } from "../../lib/achievements";
import { formatDate } from "../../lib/format";
import { colors, radius } from "../../theme";
import { Badge } from "../Badge";
import { materialColor } from "../badgeArt";
import { type Board, type BoardBy, type CategoryOverview, type LeaderEntry, PERIODS, type PublicUser, type ShowcaseAward, type Week, erfolge, formatPercent, prestigeStars, weekNumber } from "./model";

// Die Bausteine des Schaukastens in der App (E13, #623) - wie die Seite /achievements im Web (#619): Erfolg der
// Woche, Zahlen, zuletzt freigeschaltet, Kategorien mit dem Fortschritt der Community, Bestenliste.

const RANK_COLORS: Record<number, string> = { 1: "#FFD700", 2: "#C0C0C0", 3: "#CD7F32" };

function Kicker({ children, color }: { children: React.ReactNode; color: string }) {
  return <Text style={[styles.kicker, { color }]}>{children}</Text>;
}

export function Avatar({ user, size = 32 }: { user?: PublicUser | null; size?: number }) {
  const initial = String(user?.display_name || user?.username || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <MediaImage
      uri={user?.avatar_url || undefined}
      style={[styles.avatar, { width: size, height: size, borderRadius: radius.sm }]}
      fallback={<Text style={[styles.avatarText, { fontSize: Math.round(size * 0.42) }]}>{initial}</Text>}
    />
  );
}

/** Erfolg der Woche: die seltenste Freischaltung der vergangenen Woche auf einem öffentlichen Profil. */
export function WeekCard({ week, loading, onOpenUser, onOpenCard }: { week?: Week | null; loading?: boolean; onOpenUser: (username: string) => void; onOpenCard?: (awardId: string) => void }) {
  const award = week?.award || null;
  const color = award ? materialColor(award) : colors.gold;
  const kw = weekNumber(week?.week_key);
  return (
    <Card style={[styles.card, { borderColor: `${color}55` }]} testID="achievement-of-week">
      <View style={styles.row}>
        <Ionicons name="diamond-outline" size={13} color={color} />
        <Kicker color={color}>Erfolg der Woche</Kicker>
      </View>
      {award ? (
        <View style={styles.weekBody}>
          <Badge material={award.material} level={award.level} rank={award.rank} art={award.art} icon={award.icon} size={72} testID="week-award-badge" />
          <View style={styles.flex}>
            <Text style={styles.weekName} numberOfLines={2} testID="week-award-name">{award.name}</Text>
            <Text style={styles.muted} numberOfLines={1}>{award.group_name} · <Text style={{ color }}>{award.material_name}</Text></Text>
            <Text style={styles.weekRarity} testID="week-award-rarity">
              Nur <Text style={styles.strong}>{formatPercent(award.percent)}</Text> haben das · {award.holders === 1 ? "eine Person" : `${Number(award.holders || 0)} Personen`}
            </Text>
            {award.user?.username ? (
              <Pressable onPress={() => onOpenUser(String(award.user?.username))} style={styles.userRow} accessibilityRole="button" testID="week-award-user">
                <Avatar user={award.user} size={26} />
                <Text style={styles.userName} numberOfLines={1}>{award.user.display_name || "Spieler"}</Text>
                {award.earned_at ? <Text style={styles.muted}>{formatDate(award.earned_at)}</Text> : null}
              </Pressable>
            ) : null}
            {award.award_id && onOpenCard ? (
              <Pressable onPress={() => onOpenCard(String(award.award_id))} hitSlop={8} accessibilityRole="link" testID="week-award-card">
                <Text style={[styles.link, { color }]}>Karte ansehen</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : (
        <Text style={styles.muted} testID="week-award-empty">
          {loading ? "Wird geladen …" : "Vergangene Woche gab es keine Freischaltung auf einem öffentlichen Profil – die nächste Kachel gehört dir."}
        </Text>
      )}
      {kw ? <Text style={styles.foot}>Kalenderwoche {kw} · montags 08:00 neu</Text> : null}
    </Card>
  );
}

function StatTile({ icon, label, value, color, testID }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; value: string; color: string; testID?: string }) {
  return (
    <View style={[styles.statTile, { borderColor: `${color}26` }]} testID={testID}>
      <Ionicons name={icon} size={18} color={color} />
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

export function ShowcaseStats({ tierCount, pointsTotal, categoryCount, mine }: { tierCount: number; pointsTotal: number; categoryCount: number; mine: { count: number; points: number } | null }) {
  return (
    <View style={styles.statGrid} testID="achievements-stats">
      <StatTile icon="trophy-outline" label="Achievements" value={tierCount.toLocaleString("de-DE")} color={colors.gold} />
      <StatTile icon="locate-outline" label="Punkte zu holen" value={pointsTotal.toLocaleString("de-DE")} color={colors.cyan} />
      <StatTile icon="flame-outline" label="Kategorien" value={String(categoryCount)} color={colors.success} />
      {mine ? (
        <StatTile icon="ribbon-outline" label="Deine Punkte" value={mine.points.toLocaleString("de-DE")} color="#A855F7" testID="my-points" />
      ) : (
        <StatTile icon="ribbon-outline" label="Anmelden und mitmachen" value="→" color="#A855F7" />
      )}
    </View>
  );
}

/** Zuletzt freigeschaltet: die neuesten Freischaltungen öffentlicher Profile, zum Wischen. */
export function UnlockTicker({ items, onOpenUser }: { items: ShowcaseAward[]; onOpenUser: (username: string) => void }) {
  if (!items.length) return null;
  return (
    <View testID="unlock-ticker">
      <Text style={styles.tickerLabel}>Zuletzt freigeschaltet</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tickerRow}>
        {items.map((item, index) => {
          const color = materialColor(item);
          return (
            <Pressable
              key={`${item.award_id || item.tier_code}-${index}`}
              onPress={() => item.user?.username && onOpenUser(String(item.user.username))}
              style={styles.tickerChip}
              accessibilityRole="button"
              testID={`unlock-${index}`}
            >
              <View style={[styles.dot, { backgroundColor: color }]} />
              <Text style={styles.tickerText} numberOfLines={1}>
                <Text style={styles.strong}>{item.user?.display_name || "Spieler"}</Text> hat <Text style={{ color, fontWeight: "800" }}>{item.name}</Text>
                {item.material_name ? <Text style={styles.muted}> ({item.material_name})</Text> : null}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Kategorien mit dem Fortschritt der Community; Tippen filtert den Katalog darunter. */
export function CategoryGrid({ categories, hidden, base, active, onPick }: { categories: CategoryOverview[]; hidden?: { total?: number; earned?: number } | null; base?: number; active: string | null; onPick: (key: string) => void }) {
  if (!categories.length) return null;
  return (
    <View style={styles.section} testID="achievements-categories">
      <View style={styles.sectionHead}>
        <Ionicons name="layers-outline" size={18} color={colors.success} />
        <Text style={styles.sectionTitle}>Kategorien</Text>
      </View>
      <Text style={styles.sectionNote}>Fortschritt der Community · {Number(base || 0)} Konten</Text>
      <View style={styles.grid}>
        {categories.map((category) => {
          const isHidden = category.key === "hidden";
          const percent = Math.max(0, Math.min(100, Number(category.community_percent || 0)));
          const selected = active === category.key;
          return (
            <Pressable
              key={category.key}
              onPress={() => onPick(category.key)}
              style={[styles.categoryTile, { borderColor: selected ? "rgba(255,255,255,0.45)" : `${category.accent}33` }]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              testID={`category-tile-${category.key}`}
            >
              <View style={styles.row}>
                <Ionicons name={isHidden ? "help-circle-outline" : achievementIcon({ icon: category.icon, category: category.key })} size={15} color={category.accent} />
                <Text style={styles.categoryLabel} numberOfLines={2}>{category.label}</Text>
              </View>
              {category.member_only ? <Text style={styles.memberOnly}>Mitglieder</Text> : null}
              {isHidden ? (
                <Text style={[styles.categoryValue, { color: category.accent }]} testID="category-hidden-count">
                  {hidden ? `${Number(hidden.earned || 0)} von ${Number(hidden.total || 0)}` : String(category.groups)}
                  <Text style={styles.categoryUnit}> gefunden</Text>
                </Text>
              ) : (
                <>
                  <Text style={[styles.categoryValue, { color: category.accent }]}>{formatPercent(percent)}</Text>
                  <View style={styles.track}><View style={[styles.fill, { width: `${percent}%`, backgroundColor: category.accent }]} /></View>
                  <Text style={styles.categoryMeta}>{category.groups} Gruppen · {category.tiers} Stufen</Text>
                  <Text style={styles.categoryMeta}>{category.holders === 1 ? "eine Person dabei" : `${category.holders} Personen dabei`}</Text>
                </>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const BY_OPTIONS: Array<{ key: BoardBy; label: string }> = [{ key: "points", label: "Erfolgspunkte" }, { key: "level", label: "Level" }];

/** Bestenliste nach Erfolgspunkten (je Kategorie und Zeitraum) oder nach Level - oben das Podest. */
export function Leaderboard({ board, onBoard, entries, loading, categories, onOpenUser }: {
  board: Board;
  onBoard: (board: Board) => void;
  entries: LeaderEntry[];
  loading: boolean;
  categories: CategoryOverview[];
  onOpenUser: (username: string) => void;
}) {
  const byLevel = board.by === "level";
  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);
  const categoryItems = [{ key: "", label: "Alle Kategorien" }, ...categories.filter((c) => c.key !== "hidden").map((c) => ({ key: c.key, label: c.label }))];
  return (
    <View style={styles.section} testID="achievements-leaderboard">
      <View style={styles.sectionHead}>
        <Ionicons name="medal-outline" size={18} color={colors.gold} />
        <Text style={styles.sectionTitle}>Bestenliste</Text>
      </View>
      <View style={styles.controls} testID="leaderboard-controls">
        <SegmentedTabs items={BY_OPTIONS} value={board.by} onChange={(by) => onBoard({ ...board, by })} />
        {!byLevel ? (
          <>
            <SegmentedTabs items={categoryItems} value={board.category} onChange={(category) => onBoard({ ...board, category })} />
            <SegmentedTabs items={PERIODS} value={board.period} onChange={(period) => onBoard({ ...board, period })} />
          </>
        ) : null}
      </View>
      {!entries.length ? (
        <Text style={styles.empty} testID="leaderboard-empty">
          {loading
            ? "Lade Bestenliste …"
            : board.period !== "all" || board.category
              ? "In diesem Ausschnitt gibt es noch keine Platzierungen."
              : "Noch keine Platzierungen – sei der Erste und schalte Achievements frei!"}
        </Text>
      ) : (
        <>
          <View style={styles.podium}>
            {podium.map((entry) => {
              const color = RANK_COLORS[entry.rank] || RANK_COLORS[3];
              return (
                <Pressable
                  key={entry.user_id}
                  onPress={() => entry.username && onOpenUser(String(entry.username))}
                  style={[styles.podiumCard, { borderColor: `${color}66` }, entry.rank === 1 && styles.podiumFirst]}
                  accessibilityRole="button"
                  testID={`podium-${entry.rank}`}
                >
                  <View style={[styles.rankCircle, { borderColor: color }]}><Text style={[styles.rankText, { color }]}>{entry.rank}</Text></View>
                  <Avatar user={entry} size={44} />
                  <Text style={styles.podiumName} numberOfLines={1}>{entry.display_name}</Text>
                  {Number(entry.prestige || 0) > 0 ? <Text style={styles.stars}>{prestigeStars(entry.prestige)}</Text> : null}
                  <Text style={[styles.podiumValue, { color }]} numberOfLines={1}>{byLevel ? `Level ${entry.level}` : Number(entry.points || 0).toLocaleString("de-DE")}</Text>
                  <Text style={styles.podiumMeta} numberOfLines={1}>{byLevel ? entry.title || `${Number(entry.xp || 0).toLocaleString("de-DE")} XP` : erfolge(entry.count)}</Text>
                </Pressable>
              );
            })}
          </View>
          {rest.length ? (
            <View style={styles.restList}>
              {rest.map((entry) => (
                <Pressable
                  key={entry.user_id}
                  onPress={() => entry.username && onOpenUser(String(entry.username))}
                  style={styles.restRow}
                  accessibilityRole="button"
                  testID={`leaderboard-row-${entry.rank}`}
                >
                  <Text style={styles.restRank}>{entry.rank}</Text>
                  <Avatar user={entry} size={30} />
                  <Text style={styles.restName} numberOfLines={1}>
                    {entry.display_name}
                    {Number(entry.prestige || 0) > 0 ? <Text style={styles.stars}> {prestigeStars(entry.prestige)}</Text> : null}
                  </Text>
                  <Text style={styles.restMeta} numberOfLines={1}>{byLevel ? entry.title || `Level ${entry.level}` : erfolge(entry.count)}</Text>
                  <Text style={styles.restValue}>{byLevel ? `Lv ${entry.level}` : Number(entry.points || 0).toLocaleString("de-DE")}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, gap: 10 },
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  kicker: { fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.8 },
  muted: { color: colors.muted, fontSize: 12 },
  strong: { color: colors.white, fontWeight: "800" },
  link: { fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1, marginTop: 6 },
  foot: { color: "rgba(255,255,255,0.35)", fontSize: 10, textTransform: "uppercase", letterSpacing: 1 },
  weekBody: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  weekName: { color: colors.white, fontSize: 18, fontWeight: "900", textTransform: "uppercase" },
  weekRarity: { color: "rgba(255,255,255,0.65)", fontSize: 12, marginTop: 6 },
  userRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  userName: { color: colors.white, fontWeight: "700", fontSize: 13, flexShrink: 1 },
  avatar: { backgroundColor: colors.surface, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", overflow: "hidden", alignItems: "center", justifyContent: "center" },
  avatarText: { color: "rgba(255,255,255,0.6)", fontWeight: "900", textAlign: "center" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statTile: { flexGrow: 1, flexBasis: "45%", borderWidth: 1, backgroundColor: colors.surface, borderRadius: radius.sm, padding: 12, gap: 4 },
  statValue: { color: colors.white, fontSize: 24, fontWeight: "900", fontVariant: ["tabular-nums"] },
  statLabel: { color: "rgba(255,255,255,0.45)", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
  tickerLabel: { color: "rgba(255,255,255,0.35)", fontSize: 9, fontWeight: "900", textTransform: "uppercase", letterSpacing: 2.2, marginBottom: 6 },
  tickerRow: { gap: 8, paddingRight: 8 },
  tickerChip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: "#070707", borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8, maxWidth: 300 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  tickerText: { color: "rgba(255,255,255,0.6)", fontSize: 12, flexShrink: 1 },
  section: { gap: 10 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { color: colors.white, fontSize: 20, fontWeight: "900", textTransform: "uppercase" },
  sectionNote: { color: "rgba(255,255,255,0.4)", fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginTop: -4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryTile: { flexGrow: 1, flexBasis: "45%", borderWidth: 1, backgroundColor: "#0F0F10", borderRadius: radius.sm, padding: 12, gap: 5 },
  categoryLabel: { color: colors.white, fontSize: 13, fontWeight: "800", textTransform: "uppercase", flexShrink: 1 },
  memberOnly: { color: "rgba(255,215,0,0.8)", fontSize: 9, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  categoryValue: { fontSize: 20, fontWeight: "900", fontVariant: ["tabular-nums"] },
  categoryUnit: { color: "rgba(255,255,255,0.45)", fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  categoryMeta: { color: "rgba(255,255,255,0.45)", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6 },
  track: { height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.06)", overflow: "hidden" },
  fill: { height: 5, borderRadius: 3 },
  controls: { gap: 8 },
  empty: { color: colors.muted, fontSize: 13, textAlign: "center", borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.sm, padding: 20 },
  podium: { flexDirection: "row", gap: 8, alignItems: "flex-end" },
  podiumCard: { flex: 1, minWidth: 0, alignItems: "center", gap: 4, borderWidth: 1, backgroundColor: "#0F0F10", borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 12 },
  podiumFirst: { paddingVertical: 18 },
  rankCircle: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  rankText: { fontWeight: "900", fontSize: 13 },
  podiumName: { color: colors.white, fontWeight: "900", fontSize: 13, textTransform: "uppercase", marginTop: 4 },
  podiumValue: { fontSize: 18, fontWeight: "900", fontVariant: ["tabular-nums"] },
  podiumMeta: { color: "rgba(255,255,255,0.5)", fontSize: 9, textTransform: "uppercase", letterSpacing: 1 },
  stars: { color: colors.gold, fontSize: 11 },
  restList: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, overflow: "hidden" },
  restRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.05)" },
  restRank: { width: 22, textAlign: "center", color: "rgba(255,255,255,0.4)", fontWeight: "900", fontVariant: ["tabular-nums"] },
  restName: { flex: 1, minWidth: 0, color: "rgba(255,255,255,0.85)", fontWeight: "700", fontSize: 13 },
  restMeta: { color: "rgba(255,255,255,0.4)", fontSize: 11, maxWidth: 90 },
  restValue: { color: colors.gold, fontWeight: "900", fontVariant: ["tabular-nums"] },
});
