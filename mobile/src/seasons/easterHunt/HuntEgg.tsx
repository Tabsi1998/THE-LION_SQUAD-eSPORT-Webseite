import { useNavigation, type NavigationProp } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import React, { useEffect, useRef, useState } from "react";
import { Alert, Animated, Easing, Pressable, StyleSheet } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { isGuestUser } from "../../live";
import type { AppStackParamList } from "../../navigation/types";
import { REST_MS, claimCardTouch, createRest } from "../cardLift";
import { EggArt } from "../easter/art";
import { useSeason } from "../SeasonProvider";
import { useCardLift } from "../useCardLift";
import { emitHuntProgress, fetchEggs, findEgg, type FindResult } from "./api";
import type { Corner, EggSpot } from "./placement";
import { clearHunt, huntState, removeHuntEgg, updateHuntEgg } from "./store";

// Ein Osterei an seiner Karte (#647): antippen sammelt es ein - Erfolgs-Haptik, das Ei hebt sich und ist weg (das
// goldene Löwenei dreht sich dabei), der Stand im Kopf zählt mit, das letzte Ei füllt den Korb. Gäste werden zum
// Anmelden eingeladen; zu schnell, abgelaufene Schlüssel und das Ende der Suche werden freundlich behandelt.
// Ein Ei purzelt hervor (Jahreszeiten IV, #1092, wie im Web): wird seine Karte angetippt, wackelt es, kippt und rollt
// ein Stück nach außen - einmal je Ei, ein Ei je Antippen, Ruhezeit je Karte - und zählt dann als gefunden wie ein
// Antippen des Eis (auch für die Erfolge). Gäste sehen es purzeln, gesammelt wird mit Konto; nie zwei Funde auf einmal.

export const EGG_WIDTH = 18;
const EGG_HEIGHT = EGG_WIDTH * (38 / 30);
const POP_MS = 600;
/** Ein Ei purzelt hervor (#1092): so lange (ms), so weit nach außen (px) - wie im Web, kein Ei fällt von der Karte. */
export const TUMBLE_MS = 900;
export const TUMBLE_PX = 10;
/** Auf Karten mit Zuschnitt liegt das Ei innen in der Ecke (5 px vom Rand) - es rollt nur so weit, dass es ganz bleibt. */
export const TUMBLE_CLIP_PX = 4;

export type Tumble = { dx: number; at: number };

/** Welche Eier schon gepurzelt sind (Nummer -> Weg und Zeitpunkt) - jedes nur einmal, auch nach neuem Zeichnen. */
const tumbles = new Map<number, Tumble>();
const tumbleRest = createRest(REST_MS.small);
/** Läuft gerade ein Fund (Antippen oder Purzeln)? Dann sammelt ein gepurzeltes Ei nicht auch noch - der Server bremst sonst. */
let finding = 0;

/** Nur für Tests: gepurzelte Eier, Ruhezeiten und laufende Funde vergessen. */
export function resetEggTumbles() {
  tumbles.clear();
  tumbleRest.clear();
  finding = 0;
}

/** Nach außen: links liegende Eier rollen nach links, rechts liegende nach rechts. */
export function tumbleDirection(corner: Corner): 1 | -1 {
  return corner === "tr" || corner === "br" ? 1 : -1;
}

/**
 * Die Eier einer Karte purzeln, wenn die Karte angetippt wird (#1092): das erste noch nicht gepurzelte Ei, höchstens
 * eines je zehn Sekunden je Karte. Liefert je Ei-Nummer den Weg und den Zeitpunkt.
 */
export function useEggTumbles(perchId: string, spots: EggSpot[], clip: boolean): Record<number, Tumble> {
  const [, setVersion] = useState(0);
  const spotsRef = useRef(spots);
  spotsRef.current = spots;
  useCardLift((detail) => {
    if (detail.key !== perchId) return;
    const spot = spotsRef.current.find((entry) => !tumbles.has(entry.egg.egg_no));
    if (!spot || !tumbleRest.take(perchId)) return;
    tumbles.set(spot.egg.egg_no, { dx: tumbleDirection(spot.corner) * (clip ? TUMBLE_CLIP_PX : TUMBLE_PX), at: Date.now() });
    setVersion((count) => count + 1);
  }, spots.length > 0);
  const out: Record<number, Tumble> = {};
  spots.forEach((spot) => {
    const tumble = tumbles.get(spot.egg.egg_no);
    if (tumble) out[spot.egg.egg_no] = tumble;
  });
  return out;
}

function statusOf(error: unknown): number {
  return Number((error as { response?: { status?: number } } | null)?.response?.status) || 0;
}

/** Fund mit einem Nachfassen: ist der Schlüssel abgelaufen (oder vom alten Konto), holt die App die Eier neu. */
async function findWithRetry(eggNo: number, token: string): Promise<FindResult> {
  try {
    return await findEgg(token);
  } catch (error) {
    const status = statusOf(error);
    const route = huntState().route;
    if ((status === 410 || status === 403) && route) {
      const fresh = await fetchEggs(route);
      const again = (fresh.eggs || []).find((egg) => egg.egg_no === eggNo);
      if (again) {
        updateHuntEgg(eggNo, again.token);
        return findEgg(again.token);
      }
    }
    throw error;
  }
}

/** Wo das Ei an seiner Karte liegt: auf der Kante (Karten ohne Zuschnitt) oder innen in der Ecke (mit Zuschnitt). */
export function eggPosition(corner: Corner, clip: boolean): Record<string, number> {
  const top = corner === "tl" || corner === "tr";
  const left = corner === "tl" || corner === "bl";
  if (clip) return { [left ? "left" : "right"]: 5, [top ? "top" : "bottom"]: 5 };
  return { [left ? "left" : "right"]: 16, [top ? "top" : "bottom"]: -EGG_HEIGHT / 2 };
}

/** Ein Ei an seiner Karte: antippen sammelt es ein (oder lädt Gäste zum Anmelden ein); `tumble`: es ist gepurzelt. */
export function HuntEggView({ spot, clip = false, tumble }: { spot: EggSpot; clip?: boolean; tumble?: Tumble }) {
  const { user } = useAuth();
  const { showToast, reducedMotion } = useSeason();
  const navigation = useNavigation<NavigationProp<AppStackParamList>>();
  const guest = !user || isGuestUser(user);
  const pop = useRef(new Animated.Value(0)).current;
  const roll = useRef(new Animated.Value(tumble && Date.now() - tumble.at >= TUMBLE_MS ? 1 : 0)).current;
  const busy = useRef(false);
  const { egg } = spot;
  const collect = async (source: "tap" | "tumble") => {
    if (guest || huntState().guest) {
      // Gepurzelt sehen Gäste es nur - eingeladen wird, wer das Ei selbst antippt.
      if (source === "tumble") return;
      Alert.alert("Ostereiersuche", "Melde dich an, um Eier zu sammeln – gezählt wird nur mit Konto.", [
        { text: "Später", style: "cancel" },
        // Gast zuerst (#918): „Anmelden“ liegt im Stapel über den Tabs - der Aufruf geht von hier nach oben dorthin.
        { text: "Anmelden", onPress: () => navigation.navigate("Login" as never) },
      ]);
      return;
    }
    if (busy.current) return;
    if (source === "tumble" && (finding > 0 || !huntState().spots.some((entry) => entry.egg.egg_no === egg.egg_no))) return;
    busy.current = true;
    finding += 1;
    try {
      const result = await findWithRetry(egg.egg_no, egg.token);
      void Promise.resolve(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)).catch(() => {});
      emitHuntProgress({ found: result.found, total: result.total, completed_at: result.completed_at, rank: result.rank, active: true });
      const done = () => removeHuntEgg(egg.egg_no);
      if (reducedMotion) done();
      else Animated.timing(pop, { toValue: 1, duration: POP_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(done);
      if (result.completed_now) {
        Alert.alert("Korb voll!", `Du hast alle Eier gefunden – Platz ${result.rank}. Du bist in der Verlosung.`, [
          { text: "Schließen", style: "cancel" },
          // Aus jedem Screen zum Korb - über dem Tab, in dem man gerade ist (#1144): jeder Tab-Stapel kennt den Korb.
          { text: "Zum Korb", onPress: () => navigation.navigate("EasterHunt") },
        ]);
      } else {
        showToast(result.already ? "Das Ei hast du schon." : `Osterei gefunden: ${result.found} von ${result.total}`, 3000);
      }
    } catch (error) {
      const status = statusOf(error);
      if (status === 409) clearHunt();
      else showToast(status === 429 ? "Langsam – ein Ei nach dem anderen." : "Hat nicht geklappt – gleich noch mal.", 3000);
    } finally {
      busy.current = false;
      finding = Math.max(0, finding - 1);
    }
  };
  const collectRef = useRef(collect);
  collectRef.current = collect;
  // Purzeln (#1092): wackeln, kippen, ein Stück nach außen rollen und liegen bleiben - danach zählt es als gefunden.
  useEffect(() => {
    if (!tumble) return undefined;
    const elapsed = Date.now() - tumble.at;
    if (elapsed >= TUMBLE_MS) {
      roll.setValue(1);
      return undefined;
    }
    Animated.timing(roll, { toValue: 1, duration: TUMBLE_MS - elapsed, easing: Easing.bezier(0.3, 0.6, 0.4, 1), useNativeDriver: true }).start();
    const timer = setTimeout(() => void collectRef.current("tumble"), TUMBLE_MS - elapsed);
    return () => clearTimeout(timer);
  }, [tumble, roll]);
  const lift = pop.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, -14, -26] });
  const scale = pop.interpolate({ inputRange: [0, 0.35, 1], outputRange: [1, 1.25, 0.6] });
  const opacity = pop.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 1, 0] });
  const rotate = pop.interpolate({ inputRange: [0, 1], outputRange: ["0deg", egg.pattern === "lion" ? "360deg" : "0deg"] });
  // Wie im Web: um den Fuß des Eis gekippt (90 % seiner Höhe) - gedreht wird um die Mitte, darum hin- und zurückgeschoben.
  const dx = tumble ? tumble.dx : 0;
  const keys = [0, 0.2, 0.55, 0.8, 1];
  const foot = EGG_HEIGHT * 0.4;
  const tumbleStyle = {
    transform: [
      { translateX: roll.interpolate({ inputRange: keys, outputRange: [0, dx * 0.3, dx, dx, dx] }) },
      { translateY: roll.interpolate({ inputRange: keys, outputRange: [0, -6, 3, 0, 0] }) },
      { translateY: foot },
      { rotate: roll.interpolate({ inputRange: keys, outputRange: ["0deg", "-22deg", "16deg", "-5deg", "0deg"] }) },
      { translateY: -foot },
    ],
  };
  return (
    <Pressable onPress={() => void collect("tap")} onTouchStart={() => claimCardTouch(spot.perchId)} accessibilityRole="button" accessibilityLabel="Osterei einsammeln" hitSlop={12} style={[styles.egg, eggPosition(spot.corner, clip)]} testID={`hunt-egg-${egg.egg_no}`} data-tumble={tumble ? "1" : undefined}>
      <Animated.View style={tumbleStyle}>
        <Animated.View style={{ opacity, transform: [{ translateY: lift }, { scale }, { rotate }] }}>
          <EggArt pattern={egg.pattern} size={EGG_WIDTH} />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  egg: { position: "absolute", width: EGG_WIDTH, height: EGG_HEIGHT, zIndex: 3 },
});
