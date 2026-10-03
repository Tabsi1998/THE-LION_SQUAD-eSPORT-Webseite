import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../auth/AuthContext";
import { HiddenSummaryCard } from "../../achievements/profile/AchievementPanels";
import { CATEGORY_META } from "../../achievements/profile/model";
import { achievementShareUrl } from "../../achievements/share";
import { type Board, type LeaderEntry, type Overview, boardParams, catalogStats, myStats, sortGroupsByRarity } from "../../achievements/showcase/model";
import { CategoryGrid, Leaderboard, ShowcaseStats, UnlockTicker, WeekCard } from "../../achievements/showcase/ShowcasePanels";
import { AchievementGroupCard } from "../../components/AchievementGroupCard";
import { FadeIn, staggerDelay } from "../../components/FadeIn";
import { Screen } from "../../components/Screen";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { type AchievementGroup } from "../../lib/achievements";
import { api } from "../../lib/api";
import { useProgressiveCount } from "../../lib/progressive";
import { isGuestUser } from "../../live";
import { navigationRef } from "../../navigation/rootNavigation";
import type { MoreStackParamList } from "../../navigation/types";
import { useLiveRefresh } from "../../realtime/LiveChangesProvider";
import { seasonScrollProps } from "../../seasons/sky/scroll";
import { colors } from "../../theme";

// Der Schaukasten in der App (E13, #623) - wie /achievements im Web (#619): Erfolg der Woche, Zahlen, zuletzt
// freigeschaltet, Kategorien mit dem Fortschritt der Community, Bestenliste nach Erfolgspunkten (je Kategorie und
// Zeitraum) oder Level, und der Katalog mit Seltenheit - nach Kategorie oder „die seltensten zuerst“. Angemeldet
// zeigt der Katalog den eigenen Fortschritt, als Gast den öffentlichen Katalog.

type Props = NativeStackScreenProps<MoreStackParamList, "AchievementShowcase">;
type SortBy = "category" | "rarity";

const SORT_OPTIONS: Array<{ key: SortBy; label: string }> = [
  { key: "category", label: "Nach Kategorie" },
  { key: "rarity", label: "Nach Seltenheit" },
];

function categoryOrder(group: AchievementGroup): number {
  return (CATEGORY_META[group.category || "special"] || CATEGORY_META.special).order;
}

export function AchievementShowcaseScreen({ navigation }: Props) {
  const { user } = useAuth();
  const guest = !user || isGuestUser(user);
  const [groups, setGroups] = useState<AchievementGroup[]>([]);
  const [mine, setMine] = useState<{ groups?: AchievementGroup[]; hidden?: { total?: number; earned?: number } | null } | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [board, setBoard] = useState<Board>({ by: "points", category: "", period: "all" });
  const [entries, setEntries] = useState<LeaderEntry[]>([]);
  const [boardLoading, setBoardLoading] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("category");
  const [category, setCategory] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  // Stabil, damit die Erfolgskarten (memo) beim Aufklappen einer Karte nicht alle neu zeichnen.
  const toggleGroup = useCallback((code: string) => setOpenGroups((current) => ({ ...current, [code]: !current[code] })), []);

  const load = useCallback(async () => {
    const [publicGroups, overviewResult, own] = await Promise.allSettled([
      api.get<AchievementGroup[]>("/achievements/groups"),
      api.get<Overview>("/achievements/overview"),
      guest ? Promise.resolve(null) : api.get<{ groups?: AchievementGroup[]; hidden?: { total?: number; earned?: number } | null }>("/achievements/me"),
    ]);
    if (publicGroups.status === "fulfilled") setGroups(Array.isArray(publicGroups.value.data) ? publicGroups.value.data : []);
    if (overviewResult.status === "fulfilled") setOverview(overviewResult.value.data || null);
    if (own.status === "fulfilled" && own.value) setMine(own.value.data || null);
    else if (guest) setMine(null);
    setLoading(false);
    setRefreshing(false);
  }, [guest]);

  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(load, ["achievements", "badges"], { fallbackMs: 120000 });

  // Die Bestenliste lädt getrennt, weil ihre Schalter (Punkte oder Level, Kategorie, Zeitraum) sie neu holen.
  useEffect(() => {
    let alive = true;
    setBoardLoading(true);
    api.get<LeaderEntry[]>("/achievements/leaderboard", { params: boardParams(board) })
      .then(({ data }) => { if (alive) setEntries(Array.isArray(data) ? data : []); })
      .catch(() => { if (alive) setEntries([]); })
      .finally(() => { if (alive) setBoardLoading(false); });
    return () => { alive = false; };
  }, [board]);

  const stats = useMemo(() => catalogStats(groups), [groups]);
  const own = useMemo(() => myStats(mine?.groups), [mine]);
  const categories = useMemo(() => (overview?.categories || []).filter((c) => c.key !== "negative"), [overview]);
  const hidden = mine?.hidden || overview?.hidden || null;
  const catalog = useMemo(() => {
    const base = (mine?.groups || groups).filter((group) => !group.is_negative);
    const picked = category ? base.filter((group) => group.category === category) : base;
    if (sortBy === "rarity") return sortGroupsByRarity(picked, overview?.rarity);
    return [...picked].sort((a, b) => categoryOrder(a) - categoryOrder(b));
  }, [mine, groups, category, sortBy, overview]);
  // Erst zehn, dann je sechs: jeder Schritt bleibt kurz genug, dass Wischen und Tippen dazwischen durchkommen.
  const shownCount = useProgressiveCount(catalog.length, `${sortBy}:${category || ""}`, 10, 6);
  const showHidden = Boolean(hidden && Number(hidden.total || 0) > 0 && (!category || category === "hidden"));

  const openUser = useCallback((username: string) => navigation.navigate("PublicProfile", { username }), [navigation]);
  const openCard = useCallback((awardId: string) => { Linking.openURL(achievementShareUrl(awardId)).catch(() => {}); }, []);
  const openOwn = useCallback(() => {
    if (navigationRef.isReady()) navigationRef.navigate("Profile", { tab: "achievements" });
  }, []);
  const pickCategory = useCallback((key: string) => setCategory((current) => (current === key ? null : key)), []);
  const refresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  return (
    <Screen padded={false}>
      <ScrollView {...seasonScrollProps("AchievementShowcase")} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.cyan} />}>
        <View style={styles.hero}>
          <View style={styles.kickerRow}>
            <Ionicons name="sparkles" size={14} color={colors.cyan} />
            <Text style={styles.kicker}>Ruhmeshalle</Text>
          </View>
          <Text style={styles.title}>Achieve<Text style={{ color: colors.gold }}>ments</Text></Text>
          <Text style={styles.lead}>
            Spiele Matches, gewinne Turniere, fahre Bestzeiten und engagiere dich im Verein – jede Aktion bringt dich weiter. Schalte Abzeichen frei und klettere in der Bestenliste.
          </Text>
        </View>

        <WeekCard week={overview?.week} loading={loading} onOpenUser={openUser} onOpenCard={openCard} />
        <ShowcaseStats tierCount={stats.tierCount} pointsTotal={stats.pointsTotal} categoryCount={stats.categoryCount} mine={own} />
        {own ? (
          <Pressable onPress={openOwn} style={styles.summary} accessibilityRole="button" testID="my-achievement-summary">
            <Text style={styles.summaryText}>
              Du hast bereits <Text style={styles.gold}>{own.count}</Text> Achievements freigeschaltet
            </Text>
            <Text style={styles.link}>Meine Achievements ansehen</Text>
          </Pressable>
        ) : null}
        <UnlockTicker items={overview?.recent || []} onOpenUser={openUser} />
        <CategoryGrid categories={categories} hidden={hidden} base={overview?.rarity?.base} active={category} onPick={pickCategory} />
        <Leaderboard board={board} onBoard={setBoard} entries={entries} loading={boardLoading || loading} categories={categories} onOpenUser={openUser} />

        <View style={styles.catalogHead} testID="achievements-catalog">
          <View style={styles.kickerRow}>
            <Ionicons name="trophy-outline" size={18} color={colors.cyan} />
            <Text style={styles.sectionTitle}>Alle Achievements</Text>
          </View>
          <SegmentedTabs items={SORT_OPTIONS} value={sortBy} onChange={setSortBy} />
          {category ? (
            <Pressable onPress={() => setCategory(null)} hitSlop={8} accessibilityRole="button" testID="catalog-filter-clear">
              <Text style={styles.link}>Nur {categories.find((c) => c.key === category)?.label || category} · alle zeigen</Text>
            </Pressable>
          ) : null}
          <Text style={styles.count}>{sortBy === "rarity" ? "Die seltensten zuerst · " : ""}{catalog.length} Gruppen</Text>
        </View>
        {showHidden && hidden ? <HiddenSummaryCard hidden={hidden} /> : null}
        {loading && !catalog.length ? <Text style={styles.empty}>Lade Achievements …</Text> : null}
        {catalog.slice(0, shownCount).map((group, index) => {
          const previous = index > 0 ? catalog[index - 1] : null;
          const header = sortBy === "category" && (!previous || (previous.category || "special") !== (group.category || "special"));
          const meta = CATEGORY_META[group.category || "special"] || CATEGORY_META.special;
          return (
            <FadeIn key={group.code} delay={staggerDelay(index)}>
              {header ? (
                <View style={styles.categoryHeader} testID={`catalog-category-${group.category || "special"}`}>
                  <Ionicons name={meta.icon} size={15} color={meta.accent} />
                  <Text style={[styles.categoryHeaderText, { color: meta.accent }]}>{meta.label}</Text>
                </View>
              ) : null}
              <AchievementGroupCard group={group} open={Boolean(openGroups[group.code])} onToggle={toggleGroup} rarity={overview?.rarity || null} />
            </FadeIn>
          );
        })}
        {!loading && !catalog.length ? <Text style={styles.empty}>Nichts passt zu diesem Filter.</Text> : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 16, paddingBottom: 32 },
  hero: { gap: 6 },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  kicker: { color: colors.cyan, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 3 },
  title: { color: colors.white, fontSize: 38, fontWeight: "900", textTransform: "uppercase" },
  lead: { color: "rgba(255,255,255,0.6)", fontSize: 14, lineHeight: 20 },
  summary: { gap: 4 },
  summaryText: { color: "rgba(255,255,255,0.6)", fontSize: 13 },
  gold: { color: colors.gold, fontWeight: "900" },
  link: { color: colors.cyan, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  catalogHead: { gap: 10 },
  sectionTitle: { color: colors.white, fontSize: 20, fontWeight: "900", textTransform: "uppercase" },
  count: { color: "rgba(255,255,255,0.4)", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
  categoryHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8, marginTop: 4 },
  categoryHeaderText: { fontSize: 13, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.4 },
  empty: { color: colors.muted, textAlign: "center", paddingVertical: 16 },
});
