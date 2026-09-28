import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Body } from "../components/Text";
import { navigationRef } from "../navigation/rootNavigation";
import { colors } from "../theme";
import { HalloweenBats, HalloweenCorners, HalloweenWidget, Pumpkin } from "./halloween";
import { useSeason, type ActiveSeason } from "./SeasonProvider";

// Die Bühne in der App (#636, #655): Ebenen über allen Tabs, die keine Berührung abfangen. Je Saison ein
// Eintrag in der Registry; jeder Screen bekommt aus seinem Namen eine eigene Anordnung. Grüße kommen als
// Overlay-Karte unter der Kopfzeile, nicht mehr als Text in einer Karte (#655: die Meldung hing als Rahmen
// über dem halben Screen).

type SeasonModule = {
  Corners?: React.ComponentType<{ season: ActiveSeason; screen: string }>;
  Sky?: React.ComponentType<{ season: ActiveSeason; screen: string; reducedMotion: boolean }>;
  Widget?: React.ComponentType<{ season: ActiveSeason; screen: string }>;
  TabIcon?: React.ComponentType<{ size: number }>;
};

export const SEASON_MODULES: Record<string, SeasonModule> = {
  halloween: { Corners: HalloweenCorners, Sky: HalloweenBats, Widget: HalloweenWidget, TabIcon: ({ size }) => <Pumpkin size={size + 4} face="grin" /> },
};

/** Der Name des Screens, der gerade zu sehen ist - Saat für die Anordnung je Screen. */
export function useCurrentScreen(): string {
  const [screen, setScreen] = useState<string>(() => (navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name || "Dashboard" : "Dashboard"));
  useEffect(() => {
    const update = () => setScreen(navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name || "Dashboard" : "Dashboard");
    update();
    const unsubscribe = navigationRef.addListener("state", update);
    return unsubscribe;
  }, []);
  return screen;
}

export function useMountedSeasons(): Array<{ season: ActiveSeason; module: SeasonModule }> {
  const { seasons, ready } = useSeason();
  if (!ready) return [];
  return seasons.filter((season) => season.effective !== "off" && SEASON_MODULES[season.key]).map((season) => ({ season, module: SEASON_MODULES[season.key] }));
}

export function SeasonStage() {
  const mounted = useMountedSeasons();
  const { reducedMotion, toast } = useSeason();
  const insets = useSafeAreaInsets();
  const screen = useCurrentScreen();
  if (!mounted.length && !toast) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="season-stage">
      {mounted.map(({ season, module }) => (module.Sky ? <module.Sky key={`${season.key}-sky`} season={season} screen={screen} reducedMotion={reducedMotion} /> : null))}
      <View pointerEvents="none" style={[styles.corners, { top: insets.top }]}>
        {mounted.map(({ season, module }) => (module.Corners ? <module.Corners key={`${season.key}-corners`} season={season} screen={screen} /> : null))}
      </View>
      {toast ? (
        <View style={[styles.toast, { top: insets.top + 84 }]} testID="season-toast">
          <Body style={styles.toastText}>{toast.text}</Body>
        </View>
      ) : null}
    </View>
  );
}

/** Das Widget im Dashboard-Kopf - nur, wenn eine Saison eines hat. */
export function SeasonWidgetSlot() {
  const mounted = useMountedSeasons().filter(({ module }) => module.Widget);
  const screen = useCurrentScreen();
  if (!mounted.length) return null;
  return (
    <View style={styles.widgetSlot} testID="season-widget-slot">
      {mounted.map(({ season, module }) => {
        const Widget = module.Widget as React.ComponentType<{ season: ActiveSeason; screen: string }>;
        return <Widget key={season.key} season={season} screen={screen} />;
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
  corners: { position: "absolute", left: 0, right: 0, bottom: 0 },
  widgetSlot: { flexDirection: "row", alignItems: "center" },
  toast: { position: "absolute", alignSelf: "center", left: 24, right: 24, backgroundColor: "rgba(12, 10, 16, 0.94)", borderColor: "rgba(255, 179, 102, 0.55)", borderWidth: 1, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12, shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 12, elevation: 6 },
  toastText: { color: "#FFB366", textAlign: "center", fontWeight: "700", fontSize: 15 },
});

export const stageColors = colors;
