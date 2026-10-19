import * as Haptics from "expo-haptics";

// Vibration bei wichtigen Momenten am Turniertag (#1168): kurze, klare Muster - Aufruf dreimal kurz, Check-in geschafft
// einmal, Ergebnis eingetragen zweimal, Turniersieg einmal lang (Erfolg plus zwei schwere Stöße); dazu (Fabian,
// 14.10.2026, #1563) dein Weiterkommen im Baum einmal kurz und (#1633) eine Auslosung im offenen Baum einmal leicht -
// Topf bereit, Runde ausgelost oder ein Platz sofort gezogen. Sonst vibriert nichts extra. Ist am Handy die Vibration
// aus, bleibt es still (expo-haptics folgt der System-Einstellung);
// jede Vibration hat ihr sichtbares Gegenstück (Aufruf-Karte, Hinweis, Pokal) - sie ist nie das einzige Zeichen.
// Pulsar (react-native-pulsar) ist im Projekt nicht installiert; die Muster laufen über das vorhandene expo-haptics.

export type HapticMoment = "call" | "checkIn" | "result" | "advance" | "draw" | "win";
type Step = { at: number; kind: "light" | "medium" | "heavy" | "success" };

export const HAPTIC_MOMENTS: Record<HapticMoment, Step[]> = {
  call: [{ at: 0, kind: "medium" }, { at: 160, kind: "medium" }, { at: 320, kind: "medium" }],
  checkIn: [{ at: 0, kind: "success" }],
  result: [{ at: 0, kind: "light" }, { at: 140, kind: "light" }],
  advance: [{ at: 0, kind: "medium" }],
  draw: [{ at: 0, kind: "light" }],
  win: [{ at: 0, kind: "success" }, { at: 180, kind: "heavy" }, { at: 360, kind: "heavy" }],
};

function pulse(kind: Step["kind"]) {
  try {
    const run = kind === "success"
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      : Haptics.impactAsync(kind === "heavy" ? Haptics.ImpactFeedbackStyle.Heavy : kind === "medium" ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
    // Promise.resolve: auch wenn ein Gerät (oder ein Test) kein Versprechen zurückgibt, bleibt es still.
    Promise.resolve(run).catch(() => {});
  } catch {
    /* Haptik fehlt auf diesem Gerät */
  }
}

/** Spielt ein Muster; der erste Stoß im selben Moment wie das Sichtbare. Die Rückgabe bricht ausstehende Stöße ab. */
export function playMoment(moment: HapticMoment): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  for (const step of HAPTIC_MOMENTS[moment]) {
    if (step.at === 0) pulse(step.kind);
    else timers.push(setTimeout(() => pulse(step.kind), step.at));
  }
  return () => timers.forEach((timer) => clearTimeout(timer));
}
