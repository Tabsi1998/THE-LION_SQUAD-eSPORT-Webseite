// Stützstellen als Animation (Jahreszeiten IV, #1091-#1094): Im Web laufen die Reaktionen als Keyframes mit
// `ease-in-out` je Abschnitt. In der App läuft ein Wert linear von 0 bis 1 (nativer Treiber); damit die Bewegung genauso
// weich ist, bekommt jeder Abschnitt ein paar Zwischenpunkte auf derselben Kurve. Reine Rechnung.

/** Weich hinein und hinaus - nahe an `ease-in-out` im Web. */
export function easeInOut(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

const round = (value: number) => Math.round(value * 10000) / 10000;

/**
 * Aus Stützstellen (`input` steigend, `output` gleich lang) eine Animation mit weichen Abschnitten: zwischen zwei Stellen
 * `samples` Zwischenpunkte. Für `Animated.Value.interpolate` (Eingaben 0 bis 1).
 */
export function easeFrames(input: number[], output: number[], samples = 3): { inputRange: number[]; outputRange: number[] } {
  const inputRange: number[] = [input[0]];
  const outputRange: number[] = [output[0]];
  for (let i = 1; i < input.length; i += 1) {
    const [t0, t1] = [input[i - 1], input[i]];
    const [v0, v1] = [output[i - 1], output[i]];
    for (let k = 1; k <= samples; k += 1) {
      const share = k / (samples + 1);
      inputRange.push(round(t0 + (t1 - t0) * share));
      outputRange.push(round(v0 + (v1 - v0) * easeInOut(share)));
    }
    inputRange.push(t1);
    outputRange.push(v1);
  }
  return { inputRange, outputRange };
}

/** Dasselbe für Drehungen: die Werte als Grad. */
export function easeDegrees(input: number[], output: number[], samples = 3): { inputRange: number[]; outputRange: string[] } {
  const frames = easeFrames(input, output, samples);
  return { inputRange: frames.inputRange, outputRange: frames.outputRange.map((value) => `${value || 0}deg`) };
}
