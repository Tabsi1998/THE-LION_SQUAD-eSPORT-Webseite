import { MEOWS, MEOW_LEVEL, SAMPLE_RATE, encodeWav, pickMeow, ramp, renderMeow, toBase64 } from "./synth";

// Der Laut der Katze in der App (#772, Web #768): dieselbe Rechnung wie die Web Audio API im Browser, einmal
// vorgerechnet - drei Arten, Verläufe wie AudioParam, leise begonnen und beendet, als WAV mit 16 Bit.

test("drei Arten wie im Web, gewürfelt zu 30, 45 und 25 Prozent", () => {
  expect(MEOWS.map((meow) => [meow.pitch, meow.seconds])).toEqual([[1.18, 0.42], [1, 0.58], [0.86, 0.78]]);
  expect([0, 0.29, 0.3, 0.74, 0.75, 0.99].map(pickMeow)).toEqual([0, 0, 1, 1, 2, 2]);
});

test("Verläufe wie AudioParam: linear, exponentiell, nach dem letzten Punkt stehen", () => {
  const points = [{ at: 0, value: 100 }, { at: 1, value: 200 }, { at: 2, value: 50, curve: "exp" as const }];
  expect(ramp(points, -1)).toBe(100);
  expect(ramp(points, 0.5)).toBeCloseTo(150);
  expect(ramp(points, 1.5)).toBeCloseTo(100);
  expect(ramp(points, 5)).toBe(50);
});

test("jeder Laut: richtige Länge, nichts kaputt, leise begonnen und beendet, lautester Punkt auf der vorgesehenen Höhe", () => {
  MEOWS.forEach((meow) => {
    const samples = renderMeow(meow);
    expect(samples.length).toBe(Math.round((meow.seconds + 0.05) * SAMPLE_RATE));
    let loudest = 0;
    let broken = 0;
    samples.forEach((value) => {
      if (!Number.isFinite(value)) broken += 1;
      loudest = Math.max(loudest, Math.abs(value));
    });
    expect(broken).toBe(0);
    expect(loudest).toBeCloseTo(MEOW_LEVEL * (meow.peak / 0.3), 5);
    const at = (seconds: number) => Math.round(seconds * SAMPLE_RATE);
    const rms = (from: number, to: number) => {
      let sum = 0;
      for (let n = from; n < to; n += 1) sum += samples[n] ** 2;
      return Math.sqrt(sum / (to - from));
    };
    // Er schwillt in 70 ms an, trägt und klingt aus - kein Knacken am Anfang oder Ende.
    const body = rms(at(meow.seconds * 0.3), at(meow.seconds * 0.5));
    expect(Math.abs(samples[0])).toBeLessThan(0.001);
    expect(rms(0, at(0.004))).toBeLessThan(body / 5);
    expect(body).toBeGreaterThan(rms(at(meow.seconds - 0.06), at(meow.seconds)) * 3);
    expect(Math.abs(samples[samples.length - 1])).toBeLessThan(0.002);
  });
});

test("WAV: Kopf, 16 Bit mono, Länge und Werte", () => {
  const bytes = encodeWav(new Float32Array([0, 1, -1, 0.5]), 22050);
  const text = (from: number, to: number) => String.fromCharCode(...Array.from(bytes.slice(from, to)));
  expect([text(0, 4), text(8, 12), text(12, 16), text(36, 40)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
  const view = new DataView(bytes.buffer);
  expect(view.getUint32(4, true)).toBe(36 + 8);
  expect(view.getUint16(20, true)).toBe(1);
  expect(view.getUint16(22, true)).toBe(1);
  expect(view.getUint32(24, true)).toBe(22050);
  expect(view.getUint16(34, true)).toBe(16);
  expect(view.getUint32(40, true)).toBe(8);
  expect([0, 1, 2, 3].map((n) => view.getInt16(44 + n * 2, true))).toEqual([0, 32767, -32768, 16384]);
});

test("Base64 wie Node es schreibt - für jede Restlänge", () => {
  for (let length = 0; length < 8; length += 1) {
    const bytes = Uint8Array.from({ length }, (_, n) => (n * 97 + 13) % 256);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  }
  const wav = encodeWav(renderMeow(MEOWS[0]));
  expect(toBase64(wav)).toBe(Buffer.from(wav).toString("base64"));
});
