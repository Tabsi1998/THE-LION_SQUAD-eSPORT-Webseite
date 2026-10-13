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

// Löwen-Rang (#1456): Haptik zum Aufstiegs-Moment, im Takt der Bewegung - beim Rangwechsel ein Stoß, wenn der alte
// Rahmen wegblitzt, ein Erfolg, wenn der neue einrastet, und ein schwerer Nachschlag zum großen Moment; beim Level im
// Rang ein mittlerer Stoß, wenn die Raute aufspringt. Auch bei „Bewegung reduzieren“ (Haptik ist keine Bewegung).
export type AscentHapticStep = { at: number; kind: "success" | "heavy" | "medium" };

export function ascentHapticSteps(kind: "level" | "rank", { hold = 550, out = 240 }: { hold?: number; out?: number } = {}): AscentHapticStep[] {
  if (kind === "rank") return [{ at: hold, kind: "medium" }, { at: hold + out, kind: "success" }, { at: hold + out + 160, kind: "heavy" }];
  return [{ at: hold + 200, kind: "medium" }];
}

/** Spielt die Haptik eines Aufstiegs; die Rückgabe bricht noch ausstehende Stöße ab (Zeremonie geschlossen). */
export function playAscentHaptics(kind: "level" | "rank", timing?: { hold?: number; out?: number }): () => void {
  const timers = ascentHapticSteps(kind, timing).map((step) => setTimeout(() => {
    try {
      const run = step.kind === "success"
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        : Haptics.impactAsync(step.kind === "heavy" ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Medium);
      Promise.resolve(run).catch(() => {});
    } catch {
      /* Haptik fehlt auf diesem Gerät */
    }
  }, step.at));
  return () => timers.forEach((timer) => clearTimeout(timer));
}
