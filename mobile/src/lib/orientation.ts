import * as ScreenOrientation from "expo-screen-orientation";
import { useEffect } from "react";
import { Dimensions } from "react-native";

// Ausrichtung (#917): Im Manifest steht keine Sperre mehr – Android 16 übergeht sie auf großen Bildschirmen
// ohnehin, und Google Play warnt davor. Handys bleiben trotzdem hochkant: Die App sperrt zur Laufzeit, solange
// die kürzere Seite des Bildschirms unter 600 dp liegt. Tablets und aufgeklappte Faltgeräte drehen frei; klappt
// man ein Faltgerät zu, gilt wieder hochkant.

export const TABLET_MIN_DP = 600;

export function isPhoneScreen(width: number, height: number) {
  return Math.min(width, height) < TABLET_MIN_DP;
}

export async function applyOrientation(width: number, height: number) {
  try {
    if (isPhoneScreen(width, height)) await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    else await ScreenOrientation.unlockAsync();
  } catch {
    // Ohne das native Modul (Expo Go, alte Builds) bleibt es bei dem, was das System tut.
  }
}

export function usePhonePortrait() {
  useEffect(() => {
    const { width, height } = Dimensions.get("screen");
    void applyOrientation(width, height);
    const subscription = Dimensions.addEventListener("change", ({ screen }) => {
      void applyOrientation(screen.width, screen.height);
    });
    return () => subscription.remove();
  }, []);
}
