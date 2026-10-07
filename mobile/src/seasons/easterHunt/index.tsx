import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { Body } from "../../components/Text";
import { isGuestUser } from "../../live";
import { openDetail } from "../../navigation/rootNavigation";
import { EggArt } from "../easter/art";
import { perchSnapshot, subscribePerches } from "../perches";
import type { ActiveSeason } from "../SeasonProvider";
import { fetchBasket, fetchEggs, onHuntProgress, reportHuntActive, type EggsResponse, type Progress } from "./api";
import { assignEggs, type PerchInfo } from "./placement";
import { clearHunt, huntState, setHuntSpots } from "./store";

// Ostereiersuche in der App (#647, S15 - wie frontend/src/seasons/easterHunt): der Server gibt die Eier des Screens,
// der gerade zu sehen ist (mit einem Schlüssel je Ei für diese Person); die Bühne verteilt sie auf die Karten des
// Screens (dieselben Plätze wie für die Fledermäuse - sie scrollen mit ihrer Karte). Jedes Ei ist ein Knopf
// „Osterei einsammeln“: angemeldet zählt der Fund (Erfolgs-Haptik, das Ei hebt sich und ist weg, der Stand im
// Kopf zählt mit, das letzte Ei füllt den Korb), Gäste werden zum Anmelden eingeladen. Im Dashboard-Kopf zeigt ein
// goldenes Löwenei den Korb und führt zum Korb-Screen. Fortschritt, Korb und Verlosung teilt die App mit der Website.

/** Die App-Screens mit Verstecken - so heißen sie beim Server (wie im Admin wählbar). */
export const HUNT_SCREENS: Record<string, string> = {
  // Die fünf Tabs (#1143): Home, Events, Community, Verein, Profil - dazu News, Galerie und Jahreswertung.
  Dashboard: "app:Dashboard", TournamentList: "app:Tournaments", CommunityHub: "app:Community", VereinHub: "app:Verein", Profile: "app:Profile",
  NewsList: "app:News", Gallery: "app:Gallery", SeasonPass: "app:SeasonPass",
};
const RELAYOUT_MS = 250;
/** Golden mit dunkler Pfote - das dunkle Löwenei ginge im Kopf unter (wie im Web). */
const WIDGET_PALETTE: [string, string] = ["#e9c46a", "#2a2118"];

export function huntRoute(screen: string): string | null {
  return HUNT_SCREENS[screen] || null;
}

/** Die Karten eines Screens mit ihren Rechtecken (Fensterkoordinaten). */
async function screenPerches(screen: string): Promise<PerchInfo[]> {
  const perches = perchSnapshot().perches.filter((perch) => perch.screen === screen);
  const measured = await Promise.all(perches.map(async (perch) => {
    const rect = await perch.measure().catch(() => null);
    return rect ? { id: perch.id, kind: perch.kind, rect } : null;
  }));
  return measured.filter((entry): entry is PerchInfo => Boolean(entry));
}

/**
 * Die Bühne der Suche (ohne eigenes Bild): lädt bei jedem Screen-Wechsel (und nach dem Anmelden) die Eier des Screens
 * und verteilt sie auf seine Karten - neu, sobald Karten kommen oder gehen.
 */
export function HuntStage({ screen }: { season: ActiveSeason; screen: string }) {
  const { user } = useAuth();
  const route = huntRoute(screen);
  const [eggs, setEggs] = useState<EggsResponse | null>(null);
  useEffect(() => {
    setEggs(null);
    if (!route) {
      clearHunt();
      return undefined;
    }
    let cancelled = false;
    fetchEggs(route).then((data) => {
      if (cancelled) return;
      reportHuntActive(data?.active);
      setEggs(data);
    }).catch(() => {
      if (!cancelled) setEggs(null);
    });
    return () => {
      cancelled = true;
    };
  }, [route, user?.id]);
  useEffect(() => {
    if (!route || !eggs?.active) {
      clearHunt();
      return undefined;
    }
    const open = (eggs.eggs || []).filter((egg) => !egg.found);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = async () => {
      const perches = await screenPerches(screen);
      if (cancelled) return;
      const before = huntState().route === route ? huntState().spots : [];
      setHuntSpots({ screen, route, spots: assignEggs(open, perches, before), guest: Boolean(eggs.guest), total: Number(eggs.total) || 0 });
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void run(), RELAYOUT_MS);
    };
    schedule();
    const stop = subscribePerches(schedule);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stop();
    };
  }, [eggs, screen, route]);
  return null;
}

/** Zum Korb-Screen (aus dem Dashboard und nach dem letzten Ei). */
export function openBasket(): void {
  // Über dem Tab, in dem man gerade ist (#1144).
  openDetail("EasterHunt");
}

/** Der Stand im Dashboard-Kopf: ein goldenes Löwenei mit „3/12“ (angemeldet) - antippen öffnet den Korb. */
export function HuntWidget({ season }: { season: ActiveSeason; screen: string }) {
  const { user } = useAuth();
  const signedIn = Boolean(user) && !isGuestUser(user);
  const [progress, setProgress] = useState<Partial<Progress> | null>(null);
  useEffect(() => {
    if (!signedIn) {
      setProgress(null);
      return undefined;
    }
    let alive = true;
    fetchBasket().then((data) => {
      if (alive) setProgress(data);
    }).catch(() => {});
    const stop = onHuntProgress((update) => setProgress((current) => ({ ...(current || {}), ...update })));
    return () => {
      alive = false;
      stop();
    };
  }, [signedIn, season.key]);
  const active = Boolean(progress?.active);
  const label = !active ? "Ostereiersuche – zu Korb und Regeln" : progress?.completed_at ? `Ostereiersuche – dein Korb ist voll (${progress.total} von ${progress.total})` : `Ostereiersuche – ${progress?.found} von ${progress?.total} Eiern gefunden`;
  return (
    <Pressable onPress={openBasket} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} style={styles.widget} testID="hunt-widget">
      <EggArt pattern="lion" size={15} palette={WIDGET_PALETTE} />
      {active ? <Body style={styles.widgetCount} testID="hunt-widget-count">{progress?.found}/{progress?.total}</Body> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  widget: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: "rgba(233, 196, 106, 0.4)", backgroundColor: "rgba(233, 196, 106, 0.08)" },
  widgetCount: { color: "#e9c46a", fontSize: 11, fontWeight: "800" },
});

