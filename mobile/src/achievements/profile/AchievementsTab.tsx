import React, { useCallback, useMemo, useRef, useState } from "react";
import { Alert, type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from "react-native";
import { AchievementGroupCard, type TierPins, type TierShare } from "../../components/AchievementGroupCard";
import { Card } from "../../components/Card";
import { FadeIn, staggerDelay } from "../../components/FadeIn";
import { EmptyState } from "../../components/ListState";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { STATUS_FILTERS, type AchievementTier, type StatusFilter } from "../../lib/achievements";
import { api, errorMessage } from "../../lib/api";
import { useProgressiveCount } from "../../lib/progressive";
import { SeasonFindsCard } from "../../seasons/SeasonFinds";
import { colors } from "../../theme";
import { materialName } from "../badgeArt";
import { shareAchievement } from "../share";
import { CategoryShowcase, HiddenSummaryCard, LevelHeader, MaterialFilter, NextUpPanel, PinnedPanel, StatsRow, VisibilityNote } from "./AchievementPanels";
import { type AchievementLevel, type AchievementsMe, MAX_PINS, NO_FILTERS, type TierFilters, achievementStats, applyTierFilters, categoryProgress, hasFilters, shareIdsByCode, togglePin } from "./model";

// Der Reiter „Erfolge“ im App-Profil (E13, #623) - wie im Web (#619): Kopf (Level, Titel, Prestige, XP), sichtbar oder
// privat, Zahlen, „Als Nächstes“, Angeheftete, Saison-Fundstücke (#678), Vitrinen je Kategorie, Filter (Status,
// Material) und darunter die Gruppen mit „Anheften“ und „Teilen“ an jeder erreichten Stufe. Alles außer den
// Fundstücken kommt aus /achievements/me.

type Props = {
  data: AchievementsMe;
  onDataChange: (update: (current: AchievementsMe) => AchievementsMe) => void;
  guest?: boolean;
  profileScore: number;
  evaluating?: boolean;
  onEvaluate?: () => void;
  onOpenPrivacy?: () => void;
  /** Ein Link aus „Als Nächstes“ (Adresse der Website): ob die App dafür einen Screen hat, und ihn öffnen. */
  canOpenLink: (link: string) => boolean;
  onOpenLink: (link: string) => void;
  /** „Angeheftet“ ist nach einem Anheften aus der Liste um `delta` gewachsen - die Ansicht soll mitrücken. */
  onShiftAbove?: (delta: number) => void;
};

export function AchievementsTab({ data, onDataChange, guest = false, profileScore, evaluating, onEvaluate, onOpenPrivacy, canOpenLink, onOpenLink, onShiftAbove }: Props) {
  const [filters, setFilters] = useState<TierFilters>(NO_FILTERS);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [savingPins, setSavingPins] = useState(false);
  const savingRef = useRef(false);
  // Höhe von „Angeheftet“ und ob die nächste Änderung aus der Liste kam (dann rückt die Ansicht mit).
  const pinnedHeight = useRef(0);
  const shiftArmed = useRef(false);
  const onPinnedLayout = useCallback((event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    const delta = pinnedHeight.current ? height - pinnedHeight.current : 0;
    pinnedHeight.current = height;
    if (delta && shiftArmed.current) {
      shiftArmed.current = false;
      onShiftAbove?.(delta);
    }
  }, [onShiftAbove]);
  // Stabil, damit die Erfolgskarten (memo) beim Aufklappen einer Karte nicht alle neu zeichnen.
  const toggleGroup = useCallback((code: string) => setOpenGroups((current) => ({ ...current, [code]: !current[code] })), []);

  const groups = useMemo(() => data.groups || [], [data.groups]);
  const stats = useMemo(() => achievementStats(data), [data]);
  const categories = useMemo(() => categoryProgress(groups), [groups]);
  const shown = useMemo(() => applyTierFilters(groups, filters).filter((group) => !group.is_negative || filters.category === "negative"), [groups, filters]);
  const filterKey = `${filters.status}:${filters.material}:${filters.category || ""}`;
  // Erst zehn, dann je sechs: jeder Schritt bleibt kurz genug, dass Wischen und Tippen dazwischen durchkommen.
  const shownCount = useProgressiveCount(shown.length, filterKey, 10, 6);
  const pinnedCodes = useMemo(() => (Array.isArray(data.pinned_codes) ? data.pinned_codes : (data.pinned || []).map((award) => award.code)), [data.pinned_codes, data.pinned]);
  const isPublic = data.privacy_achievements_public !== false;
  const hidden = data.hidden && Number(data.hidden.total || 0) > 0 ? data.hidden : null;
  const showHidden = Boolean(hidden && (filters.status === "all" || filters.status === "secret") && !filters.material && (!filters.category || filters.category === "hidden"));

  const savePins = useCallback(async (codes: string[]) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSavingPins(true);
    try {
      const { data: saved } = await api.put<{ pinned_codes?: string[]; pinned?: AchievementsMe["pinned"] }>("/achievements/me/pins", { tier_codes: codes });
      onDataChange((current) => ({ ...current, pinned_codes: saved?.pinned_codes || codes, pinned: saved?.pinned || [] }));
    } catch (err) {
      shiftArmed.current = false;
      Alert.alert("Anheften hat nicht geklappt", errorMessage(err, "Bitte später noch einmal versuchen."));
    } finally {
      savingRef.current = false;
      setSavingPins(false);
    }
  }, [onDataChange]);

  const onTogglePin = useCallback((code: string) => {
    const result = togglePin(pinnedCodes, code, MAX_PINS);
    if (result.full) {
      Alert.alert("Alle Plätze belegt", `Höchstens ${MAX_PINS} Erfolge lassen sich anheften – erst einen lösen.`);
      return;
    }
    shiftArmed.current = true;
    void savePins(result.codes);
  }, [pinnedCodes, savePins]);
  const pins = useMemo<TierPins | null>(() => (guest ? null : { codes: pinnedCodes, max: MAX_PINS, onToggle: onTogglePin }), [guest, pinnedCodes, onTogglePin]);

  // Teilen (#619): je erreichter Stufe die Vergabe-Kennung; private Erfolge lassen sich nicht teilen.
  const shareIds = useMemo(() => shareIdsByCode(data), [data]);
  const onShare = useCallback((awardId: string, tier: AchievementTier) => {
    if (!isPublic) {
      Alert.alert("Deine Erfolge sind privat", "Zum Teilen erst in den Einstellungen „Erfolge öffentlich“ einschalten.");
      return;
    }
    void shareAchievement({ awardId, name: tier.name, materialName: materialName(tier) });
  }, [isPublic]);
  const share = useMemo<TierShare | null>(() => (guest ? null : { ids: shareIds, onShare }), [guest, shareIds, onShare]);

  const onLevelChange = useCallback((level: AchievementLevel) => {
    onDataChange((current) => ({ ...current, level }));
  }, [onDataChange]);

  const filtering = hasFilters(filters);
  return (
    <View style={styles.root} testID="profile-achievements-tab">
      <LevelHeader level={data.level} earnedPercent={stats.earnedPercent} evaluating={evaluating} onEvaluate={onEvaluate} onLevelChange={onLevelChange} guest={guest} />
      {!guest ? <VisibilityNote isPublic={isPublic} onChange={onOpenPrivacy} /> : null}
      <StatsRow earned={stats.earned} total={stats.total} points={stats.points} hidden={data.hidden} profileScore={profileScore} />
      <NextUpPanel items={data.next_up || []} canOpen={canOpenLink} onOpen={onOpenLink} />
      {!guest ? (
        <View onLayout={onPinnedLayout} testID="achievement-pinned-wrap">
          <PinnedPanel pinned={data.pinned || []} codes={pinnedCodes} busy={savingPins} onChange={(codes) => { shiftArmed.current = false; void savePins(codes); }} />
        </View>
      ) : null}
      {/* Saison-Fundstücke (#678) wie im Web unter den Erfolgen - nur für die angemeldete Person selbst. */}
      {!guest ? <SeasonFindsCard /> : null}
      <CategoryShowcase rows={categories} active={filters.category} onPick={(category) => setFilters((current) => ({ ...current, category }))} />

      {groups.length ? (
        <>
          <View style={styles.filters} testID="achievement-filters">
            <SegmentedTabs items={STATUS_FILTERS} value={filters.status} onChange={(status: StatusFilter) => setFilters((current) => ({ ...current, status }))} />
            <MaterialFilter value={filters.material} onChange={(material) => setFilters((current) => ({ ...current, material }))} />
            <View style={styles.filterFoot}>
              <Text style={styles.filterCount} testID="achievement-filter-count">{shown.length} {shown.length === 1 ? "Gruppe" : "Gruppen"}</Text>
              {filtering ? (
                <Pressable onPress={() => setFilters(NO_FILTERS)} hitSlop={8} accessibilityRole="button" testID="achievement-filter-reset">
                  <Text style={styles.reset}>Zurücksetzen</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
          {showHidden && hidden ? <HiddenSummaryCard hidden={hidden} /> : null}
          {shown.slice(0, shownCount).map((group, index) => (
            <FadeIn key={group.code} delay={staggerDelay(index)}>
              <AchievementGroupCard group={group} open={Boolean(openGroups[group.code])} onToggle={toggleGroup} pins={pins} share={share} />
            </FadeIn>
          ))}
          {!shown.length ? <Text style={styles.filterEmpty}>Nichts passt zu diesem Filter.</Text> : null}
        </>
      ) : (
        <Card style={styles.card}>
          <EmptyState icon="trophy-outline" title="Noch keine Erfolge" detail="Spiel mit, melde dich für Turniere an oder fahr Fast-Lap-Runden – dann tauchen hier deine ersten Erfolge auf." tone="gold" />
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Derselbe Abstand wie zwischen den Karten des Profils.
  root: { gap: 16 },
  card: { padding: 14 },
  filters: { gap: 10 },
  filterFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  filterCount: { color: "rgba(255,255,255,0.45)", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
  reset: { color: colors.cyan, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  filterEmpty: { color: colors.muted, textAlign: "center", paddingVertical: 16 },
});
