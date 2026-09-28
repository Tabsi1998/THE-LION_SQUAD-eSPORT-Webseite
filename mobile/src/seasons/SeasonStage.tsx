import React from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HalloweenBats, HalloweenCorners, HalloweenWidget, Pumpkin } from "./halloween";
import { useSeason, type ActiveSeason } from "./SeasonProvider";

// Die Bühne in der App (#636): Ebenen über allen Tabs, die keine Berührung abfangen. Je Saison ein
// Eintrag in der Registry; was der Server nicht liefert, wird nicht gezeichnet. Advent, Weihnachten und
// Silvester kommen mit Build 1.0.2 (#642) als weitere Einträge dazu.

type SeasonModule = {
  Corners?: React.ComponentType<{ season: ActiveSeason }>;
  Sky?: React.ComponentType<{ season: ActiveSeason; reducedMotion: boolean }>;
  Widget?: React.ComponentType<{ season: ActiveSeason }>;
  TabIcon?: React.ComponentType<{ size: number }>;
};

export const SEASON_MODULES: Record<string, SeasonModule> = {
  halloween: { Corners: HalloweenCorners, Sky: HalloweenBats, Widget: HalloweenWidget, TabIcon: ({ size }) => <Pumpkin size={size + 2} /> },
};

export function useMountedSeasons(): Array<{ season: ActiveSeason; module: SeasonModule }> {
  const { seasons, ready } = useSeason();
  if (!ready) return [];
  return seasons.filter((season) => season.effective !== "off" && SEASON_MODULES[season.key]).map((season) => ({ season, module: SEASON_MODULES[season.key] }));
}

export function SeasonStage() {
  const mounted = useMountedSeasons();
  const { reducedMotion } = useSeason();
  const insets = useSafeAreaInsets();
  if (!mounted.length) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="season-stage">
      {mounted.map(({ season, module }) => (module.Sky ? <module.Sky key={`${season.key}-sky`} season={season} reducedMotion={reducedMotion} /> : null))}
      <View pointerEvents="none" style={[styles.corners, { top: insets.top }]}>
        {mounted.map(({ season, module }) => (module.Corners ? <module.Corners key={`${season.key}-corners`} season={season} /> : null))}
      </View>
    </View>
  );
}

/** Das Widget im Dashboard-Kopf - nur, wenn eine Saison eines hat. */
export function SeasonWidgetSlot() {
  const mounted = useMountedSeasons().filter(({ module }) => module.Widget);
  if (!mounted.length) return null;
  return (
    <View style={styles.widgetSlot} testID="season-widget-slot">
      {mounted.map(({ season, module }) => {
        const Widget = module.Widget as React.ComponentType<{ season: ActiveSeason }>;
        return <Widget key={season.key} season={season} />;
      })}
    </View>
  );
}

/** Ein Saison-Symbol für die Tab-Leiste, oder null, wenn keine Saison eines hat. */
export function useSeasonTabIcon(): React.ComponentType<{ size: number }> | null {
  const mounted = useMountedSeasons().filter(({ module }) => module.TabIcon);
  return mounted.length ? (mounted[0].module.TabIcon as React.ComponentType<{ size: number }>) : null;
}

const styles = StyleSheet.create({
  corners: { position: "absolute", left: 0, right: 0, height: 120 },
  widgetSlot: { flexDirection: "row", alignItems: "center" },
});
