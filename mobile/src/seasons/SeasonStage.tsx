import React, { useContext, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { NavigationRouteContext } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Body } from "../components/Text";
import { navigationRef } from "../navigation/rootNavigation";
import { colors } from "../theme";
import { AdventWidget } from "./advent/AdventWidget";
import { ChristmasBackdrop, ChristmasEdge, ChristmasGreeting } from "./christmas";
import { HalloweenBats, HalloweenCorners, HalloweenWidget, Pumpkin } from "./halloween";
import { FireworksSky, NewYearGreeting, NewYearWidget } from "./newYear";
import { NikolausGreeting, NikolausShelf, NikolausTabIcon } from "./nikolaus";
import { SnowSky, SnowflakeWidget } from "./snow";
import { WinterSkyBackdrop } from "./snow/WinterSky";
import { WeatherSky } from "./weather";
import { useSeason, type ActiveSeason } from "./SeasonProvider";

// Die Bühne in der App (#636, #655, #665): Ebenen über allen Tabs; nur Fledermäuse und Gräber nehmen Berührungen. Je Saison ein
// Eintrag in der Registry; jeder Screen bekommt aus seinem Namen eine eigene Anordnung. Grüße kommen als
// Overlay-Karte unter der Kopfzeile, nicht mehr als Text in einer Karte (#655: die Meldung hing als Rahmen
// über dem halben Screen).

type SeasonModule = {
  Corners?: React.ComponentType<{ season: ActiveSeason; screen: string }>;
  Sky?: React.ComponentType<{ season: ActiveSeason; screen: string; reducedMotion: boolean }>;
  Widget?: React.ComponentType<{ season: ActiveSeason; screen: string }>;
  TabIcon?: React.ComponentType<{ size: number }>;
  /** Nur Himmel (das Wetter): keine eigene Deko, deshalb nicht unter „Gerade läuft“ genannt. */
  skyOnly?: boolean;
  /** Steht das Widget bei mehreren oben (die Schneeflocke schwebt über dem Kranz)? */
  widgetOnTop?: boolean;
  /** An der Unterkante der Begrüßungskarte im Dashboard (Weihnachten: die Lichterkette). */
  Edge?: React.ComponentType<{ season: ActiveSeason; screen: string }>;
  /** Eine Gruß-Karte über der Tab-Leiste, auf jedem Screen (Weihnachten). */
  Greeting?: React.ComponentType<{ season: ActiveSeason; screen: string }>;
  /** Hinter dem Inhalt eines Screens (Weihnachten: warme Lichtinseln). */
  Backdrop?: React.ComponentType<{ season: ActiveSeason; screen: string }>;
  /** Rechts im Kopf von „Mehr“, auf der Kante der ersten Karte (Nikolaus: der Stiefel). */
  Shelf?: React.ComponentType<{ season: ActiveSeason; screen: string }>;
};

export const SEASON_MODULES: Record<string, SeasonModule> = {
  halloween: { Corners: HalloweenCorners, Sky: HalloweenBats, Widget: HalloweenWidget, TabIcon: ({ size }) => <Pumpkin size={size + 4} face="grin" /> },
  // Adventkranz (S6, W1, S11 #642): der Kranz im Dashboard-Kopf, derselbe wie neben dem Logo der Website.
  advent: { Widget: AdventWidget },
  // Schnee (S7, #642): Flocken in drei Tiefen mit Wind und Böen aus dem Wetter, die Schneeflocke zum Fangen im Kopf;
  // dahinter der Winterhimmel (W4 #730): Blauschein, Glühen und Sterne nach Sonnenzeiten und Wetter.
  snow: { Sky: SnowSky, Widget: SnowflakeWidget, widgetOnTop: true, Backdrop: WinterSkyBackdrop },
  // Wetter das ganze Jahr (#771): Regen, leichter Schnee, Wetterleuchten - wie im Web; in der Schnee-Saison schneit es.
  weather: { Sky: WeatherSky, skyOnly: true },
  // Weihnachten (S8, S11 #642): Lichterkette an der Begrüßungskarte, warme Lichtinseln, der Gruß einmal je Tag.
  christmas: { Edge: ChristmasEdge, Greeting: ChristmasGreeting, Backdrop: ChristmasBackdrop },
  // Nikolaus (X3 #736, S11 „Stiefel im Tab Mehr“): der Stiefel im Kopf von „Mehr“, das Tab-Symbol, der Hinweis.
  nikolaus: { Shelf: NikolausShelf, Greeting: NikolausGreeting, TabIcon: NikolausTabIcon },
  // Silvester (S11 #642, wie #800 im Web): Feuerwerk mit Skia über allen Tabs, Hinweis im Kopf, Countdown und Gruß.
  new_year: { Sky: FireworksSky, Widget: NewYearWidget, Greeting: NewYearGreeting },
};

/** Saisonen mit eigenem Screen statt Deko-Modul: der Adventkalender (#641). */
export const SCREEN_SEASONS = new Set(["advent_calendar"]);

/** Kann die App diese Saison zeigen? Sonst steht sie nirgends als „läuft gerade“, ohne dass etwas zu sehen wäre (#772). */
/** Eine Saison, die der Person als Deko auffällt - das Wetter ist nur Himmel und steht nicht unter „Gerade läuft“. */
export function appNamesSeason(season: Pick<ActiveSeason, "key">): boolean {
  return appCanShow(season) && !SEASON_MODULES[season.key]?.skyOnly;
}

export function appCanShow(season: Pick<ActiveSeason, "key">): boolean {
  return Boolean(SEASON_MODULES[season.key]) || SCREEN_SEASONS.has(season.key);
}

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
    // box-none: die Buehne selbst nimmt keine Beruehrung, aber Fledermaeuse und Graeber der Saison duerfen (#665).
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill} testID="season-stage">
      {mounted.map(({ season, module }) => (module.Sky ? <module.Sky key={`${season.key}-sky`} season={season} screen={screen} reducedMotion={reducedMotion} /> : null))}
      <View pointerEvents="box-none" style={[styles.corners, { top: insets.top }]}>
        {mounted.map(({ season, module }) => (module.Corners ? <module.Corners key={`${season.key}-corners`} season={season} screen={screen} /> : null))}
      </View>
      {/* Je Phase eine eigene Karte: der Abschied am 6. Jänner beginnt nicht dort, wo der Gruß aufgehört hat. */}
      {mounted.map(({ season, module }) => (module.Greeting ? <module.Greeting key={`${season.key}-greeting-${season.phase}`} season={season} screen={screen} /> : null))}
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
  // Mehrere Widgets stehen übereinander: nebeneinander nahmen Kranz und Schneeflocke dem Namen den Platz (er
  // brach mitten im Wort um). So ist die Spalte nur so breit wie das breiteste Widget.
  const ordered = [...mounted].sort((a, b) => Number(Boolean(b.module.widgetOnTop)) - Number(Boolean(a.module.widgetOnTop)));
  return (
    <View style={[styles.widgetSlot, ordered.length > 1 && styles.widgetStack]} testID="season-widget-slot">
      {ordered.map(({ season, module }) => {
        const Widget = module.Widget as React.ComponentType<{ season: ActiveSeason; screen: string }>;
        return <Widget key={season.key} season={season} screen={screen} />;
      })}
    </View>
  );
}

/** Der Screen, in dem ein Slot liegt (Kante, Hintergrund) - ohne Navigation „Dashboard“. */
function useSlotScreen(): string {
  const route = useContext(NavigationRouteContext);
  return (route && route.name) || "Dashboard";
}

/** Die Unterkante der Begrüßungskarte im Dashboard - eine Ebene über der Karte, nie klickbar. */
export function SeasonEdgeSlot() {
  const mounted = useMountedSeasons().filter(({ module }) => module.Edge);
  const screen = useSlotScreen();
  if (!mounted.length) return null;
  return (
    <>
      {mounted.map(({ season, module }) => {
        const Edge = module.Edge as React.ComponentType<{ season: ActiveSeason; screen: string }>;
        return <Edge key={season.key} season={season} screen={screen} />;
      })}
    </>
  );
}

/** Rechts im Kopf von „Mehr“: eine Figur, die auf der Kante der ersten Karte steht (Nikolausstiefel). */
export function SeasonShelfSlot() {
  const mounted = useMountedSeasons().filter(({ module }) => module.Shelf);
  const screen = useSlotScreen();
  if (!mounted.length) return null;
  const { season, module } = mounted[0];
  const Shelf = module.Shelf as React.ComponentType<{ season: ActiveSeason; screen: string }>;
  return <Shelf key={season.key} season={season} screen={screen} />;
}

/** Hinter dem Inhalt eines Screens (`Screen` legt sie unter alles) - nur, wenn eine Saison dort etwas zeigt. */
export function SeasonBackdropSlot() {
  const mounted = useMountedSeasons().filter(({ module }) => module.Backdrop);
  const screen = useSlotScreen();
  if (!mounted.length) return null;
  return (
    <>
      {mounted.map(({ season, module }) => {
        const Backdrop = module.Backdrop as React.ComponentType<{ season: ActiveSeason; screen: string }>;
        return <Backdrop key={season.key} season={season} screen={screen} />;
      })}
    </>
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
  widgetStack: { flexDirection: "column", gap: 2 },
  toast: { position: "absolute", alignSelf: "center", left: 24, right: 24, backgroundColor: "rgba(12, 10, 16, 0.94)", borderColor: "rgba(255, 179, 102, 0.55)", borderWidth: 1, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12, shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 12, elevation: 6 },
  toastText: { color: "#FFB366", textAlign: "center", fontWeight: "700", fontSize: 15 },
});

export const stageColors = colors;
