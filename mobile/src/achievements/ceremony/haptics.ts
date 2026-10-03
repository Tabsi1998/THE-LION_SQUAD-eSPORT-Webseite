import * as Haptics from "expo-haptics";
import { type Look } from "../badgeArt";

// Erfolge II (E13, #623): Haptik je Material - Holz bis Bronze leicht, Silber und Gold mittel, Platin und
// Diamant schwer, Legendär als Muster (Erfolg plus drei schwere Stöße), Geheim mittel.

export type HapticKind = "light" | "medium" | "heavy" | "pattern";

export function hapticKind(look: Pick<Look, "key" | "rank">): HapticKind {
  if (look.key === "legendary") return "pattern";
  if (look.rank >= 6 && look.rank <= 7) return "heavy";
  if (look.rank >= 4) return "medium";
  return "light";
}

export async function playHaptics(look: Pick<Look, "key" | "rank">): Promise<void> {
  try {
    const kind = hapticKind(look);
    if (kind === "pattern") {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      for (let i = 0; i < 3; i += 1) {
        // Promise.resolve: auch wenn ein Gerät (oder ein Test) kein Versprechen zurückgibt, bleibt es still.
        setTimeout(() => { Promise.resolve(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)).catch(() => {}); }, 180 + i * 150);
      }
    } else if (kind === "heavy") {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } else if (kind === "medium") {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  } catch {
    /* Haptik fehlt auf diesem Gerät */
  }
}
