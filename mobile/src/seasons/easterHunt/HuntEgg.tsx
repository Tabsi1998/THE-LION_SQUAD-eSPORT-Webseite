import { useNavigation, type NavigationProp } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import React, { useRef, useState } from "react";
import { Alert, Animated, Easing, Pressable, StyleSheet } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { isGuestUser } from "../../live";
import type { MainTabParamList } from "../../navigation/types";
import { EggArt } from "../easter/art";
import { useSeason } from "../SeasonProvider";
import { emitHuntProgress, fetchEggs, findEgg, type FindResult } from "./api";
import type { Corner, EggSpot } from "./placement";
import { clearHunt, huntState, removeHuntEgg, updateHuntEgg } from "./store";

// Ein Osterei an seiner Karte (#647): antippen sammelt es ein - Erfolgs-Haptik, das Ei hebt sich und ist weg (das
// goldene Löwenei dreht sich dabei), der Stand im Kopf zählt mit, das letzte Ei füllt den Korb. Gäste werden zum
// Anmelden eingeladen; zu schnell, abgelaufene Schlüssel und das Ende der Suche werden freundlich behandelt.

export const EGG_WIDTH = 18;
const EGG_HEIGHT = EGG_WIDTH * (38 / 30);
const POP_MS = 600;

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

/** Ein Ei an seiner Karte: antippen sammelt es ein (oder lädt Gäste zum Anmelden ein). */
export function HuntEggView({ spot, clip = false }: { spot: EggSpot; clip?: boolean }) {
  const { user } = useAuth();
  const { showToast, reducedMotion } = useSeason();
  const navigation = useNavigation<NavigationProp<MainTabParamList>>();
  const guest = !user || isGuestUser(user);
  const pop = useRef(new Animated.Value(0)).current;
  const [busy, setBusy] = useState(false);
  const { egg } = spot;
  const onPress = async () => {
    if (guest || huntState().guest) {
      Alert.alert("Ostereiersuche", "Melde dich an, um Eier zu sammeln – gezählt wird nur mit Konto.", [
        { text: "Später", style: "cancel" },
        // Gast zuerst (#918): „Anmelden“ liegt im Stapel über den Tabs - der Aufruf geht von hier nach oben dorthin.
        { text: "Anmelden", onPress: () => navigation.navigate("Login" as never) },
      ]);
      return;
    }
    if (busy) return;
    setBusy(true);
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
          // Aus jedem Screen zum Korb unter Mehr (der Tab-Navigator nimmt den Weg nach oben).
          { text: "Zum Korb", onPress: () => navigation.navigate("More", { screen: "EasterHunt", initial: false }) },
        ]);
      } else {
        showToast(result.already ? "Das Ei hast du schon." : `Osterei gefunden: ${result.found} von ${result.total}`, 3000);
      }
    } catch (error) {
      const status = statusOf(error);
      if (status === 409) clearHunt();
      else showToast(status === 429 ? "Langsam – ein Ei nach dem anderen." : "Hat nicht geklappt – gleich noch mal.", 3000);
    } finally {
      setBusy(false);
    }
  };
  const lift = pop.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, -14, -26] });
  const scale = pop.interpolate({ inputRange: [0, 0.35, 1], outputRange: [1, 1.25, 0.6] });
  const opacity = pop.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 1, 0] });
  const rotate = pop.interpolate({ inputRange: [0, 1], outputRange: ["0deg", egg.pattern === "lion" ? "360deg" : "0deg"] });
  return (
    <Pressable onPress={() => void onPress()} accessibilityRole="button" accessibilityLabel="Osterei einsammeln" hitSlop={12} style={[styles.egg, eggPosition(spot.corner, clip)]} testID={`hunt-egg-${egg.egg_no}`}>
      <Animated.View style={{ opacity, transform: [{ translateY: lift }, { scale }, { rotate }] }}>
        <EggArt pattern={egg.pattern} size={EGG_WIDTH} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  egg: { position: "absolute", width: EGG_WIDTH, height: EGG_HEIGHT, zIndex: 3 },
});
