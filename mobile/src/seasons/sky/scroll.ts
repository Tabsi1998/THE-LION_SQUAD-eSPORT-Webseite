import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { makeMutable, type SharedValue } from "react-native-reanimated";

// Wo der Screen gerade steht (#642, #771): Flocken und Tropfen gehören zum Screen, nicht zum Glas davor - wer
// scrollt, fährt an ihnen vorbei (wie im Web seit #768). Die Screens melden ihre Scroll-Position hier; die Felder
// lesen sie je Bild auf dem UI-Thread und schieben nur innerhalb desselben Screens (ein Wechsel springt nicht).

export type ScrollState = { screen: string; y: number };

let shared: SharedValue<ScrollState> | null = null;

/** Die eine Scroll-Quelle der App - erst beim ersten Gebrauch angelegt. */
export function seasonScroll(): SharedValue<ScrollState> | null {
  if (!shared) {
    try {
      shared = makeMutable<ScrollState>({ screen: "", y: 0 });
    } catch {
      shared = null;
    }
  }
  return shared;
}

/** Ein Screen meldet seine Position (Pixel von oben). */
export function reportScroll(screen: string, y: number): void {
  const target = seasonScroll();
  if (!target) return;
  target.value = { screen, y: Number.isFinite(y) ? y : 0 };
}

export type ScrollProps = { onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void; scrollEventThrottle: number };
const props = new Map<string, ScrollProps>();

/**
 * Für die `ScrollView` oder `FlatList` eines Screens: `onScroll` und die Taktung, je Screen-Name immer dieselben
 * (kein neues Rendern). Kostet kaum etwas - die Felder lesen die Position nur, solange es schneit oder regnet.
 */
export function seasonScrollProps(screen: string): ScrollProps {
  let found = props.get(screen);
  if (!found) {
    found = { onScroll: (event) => reportScroll(screen, event?.nativeEvent?.contentOffset?.y || 0), scrollEventThrottle: 32 };
    props.set(screen, found);
  }
  return found;
}
