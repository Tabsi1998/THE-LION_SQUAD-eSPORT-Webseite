import * as Haptics from "expo-haptics";
import { ascentHapticSteps, playAscentHaptics } from "../achievements/ceremony/haptics";
import { levelUpFrom } from "../achievements/ceremony/select";
import { BURST_PARTICLES, BURST_SECONDS, burstCount, burstVisible, drawBurst, type SignatureScene } from "../components/loewenRangSignature";
import { ASCENT_TIMING, artAroundPhoto, ascentMoment, burstDelayMs, popDelayMs } from "./loewenAufstieg";
import { SIGNATURE_FX, frameBox } from "./loewenRang";

// Löwen-Rang Teil 3 in der App (#1456): Auswahl Level- oder Rangwechsel-Moment (wie im Web), einmal je Aufstieg,
// reduzierte Bewegung, Haptik im Takt und der vereinfachte Moment mit fester Obergrenze.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const skia = require("@shopify/react-native-skia");

describe("ascentMoment", () => {
  it("Level im Rang: kleiner Moment, die neuen Rauten springen auf", () => {
    const moment = ascentMoment({ level: 12, previous: 11 })!;
    expect(moment).toMatchObject({ kind: "level", level: 12, previous: 11, fx: "ember", strong: false, particles: true, reduced: false, pops: [1] });
    expect(ascentMoment({ level: 14, previous: 11 })!.pops).toEqual([1, 2, 3]);
  });

  it("Rangwechsel: großer Moment des neuen Rangs, auch über einen Rang hinweg", () => {
    expect(ascentMoment({ level: 25, previous: 24 })).toMatchObject({ kind: "rank", fx: "gold", strong: true, pops: [] });
    expect(ascentMoment({ level: 17, previous: 8 })).toMatchObject({ kind: "rank", fx: "hunt", pops: [0, 1] });
    for (let rank = 2; rank <= 12; rank += 1) {
      const level = (rank - 1) * 5;
      expect(ascentMoment({ level, previous: level - 1 })).toMatchObject({ kind: "rank", fx: SIGNATURE_FX[rank - 1] });
    }
    expect(ascentMoment({ level: 60, previous: 59 })).toMatchObject({ kind: "level", strong: true });
  });

  it("kein Moment bei Prestige, ohne Aufstieg und ohne Daten", () => {
    expect(ascentMoment({ level: 1, previous: 60, prestigeGained: true })).toBeNull();
    expect(ascentMoment({ level: 12, previous: 12 })).toBeNull();
    expect(ascentMoment(null)).toBeNull();
  });

  it("Bewegung reduzieren: keine Teilchen, keine springenden Rauten", () => {
    expect(ascentMoment({ level: 13, previous: 11 }, { reduced: true })).toMatchObject({ particles: false, reduced: true, pops: [] });
    expect(ascentMoment({ level: 30, previous: 29 }, { reduced: true })).toMatchObject({ kind: "rank", particles: false });
  });

  it("Zeitplan: der große Moment wartet auf den neuen Rahmen, die Rauten danach nacheinander", () => {
    expect(burstDelayMs("rank")).toBe(ASCENT_TIMING.hold + ASCENT_TIMING.out);
    expect(burstDelayMs("level")).toBeLessThan(burstDelayMs("rank"));
    expect(popDelayMs("rank", 0)).toBeGreaterThan(burstDelayMs("rank"));
    expect(popDelayMs("level", 1) - popDelayMs("level", 0)).toBe(120);
  });

  it("der alte Rahmen sitzt mit seinem Ring genau auf demselben Foto", () => {
    const box = frameBox(25, 150);
    const old = artAroundPhoto(24, { size: box.photo, left: box.photoLeft, top: box.photoTop });
    const same = artAroundPhoto(25, { size: box.photo, left: box.photoLeft, top: box.photoTop });
    expect(same.size).toBeCloseTo(box.art.size, 6);
    expect(same.left).toBeCloseTo(box.art.left, 6);
    expect(same.top).toBeCloseTo(box.art.top, 6);
    expect(old.size).toBeGreaterThan(0);
  });
});

describe("einmal je Aufstieg", () => {
  it("nach dem Merken des neuen Stands kommt derselbe Aufstieg nicht noch einmal", () => {
    const prev = { level: 24, title: "Silbermähne", prestige: 0 };
    const next = { level: 25, title: "Goldmähne", prestige: 0 };
    expect(levelUpFrom(prev, next)).toEqual({ level: 25, previous: 24, title: "Goldmähne", titleChanged: true, prestige: 0, prestigeGained: false });
    expect(levelUpFrom(next, next)).toBeNull();
    expect(levelUpFrom(null, next)).toBeNull();
  });
});

describe("Haptik", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("Rangwechsel: Stoß, Erfolg, schwerer Nachschlag; Level im Rang: ein mittlerer Stoß", () => {
    expect(ascentHapticSteps("rank").map((step) => step.kind)).toEqual(["medium", "success", "heavy"]);
    expect(ascentHapticSteps("level").map((step) => step.kind)).toEqual(["medium"]);
  });

  it("spielt im Takt und hört auf, wenn die Zeremonie schließt", () => {
    (Haptics.impactAsync as jest.Mock).mockClear();
    (Haptics.notificationAsync as jest.Mock).mockClear();
    const cancel = playAscentHaptics("rank");
    jest.advanceTimersByTime(ASCENT_TIMING.hold + 10);
    expect(Haptics.impactAsync).toHaveBeenCalledWith("medium");
    cancel();
    jest.advanceTimersByTime(2000);
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });
});

describe("vereinfachter Moment", () => {
  const scene: SignatureScene = {
    size: 200, ringX: 100, ringY: 100, ringR: 40, kind: "blitz", color: "#8FE3FF", count: 0, strength: 1, shine: 0,
    edge: Array.from({ length: 24 }, (_, i) => [100 + Math.cos((i / 24) * Math.PI * 2) * 55, 100 + Math.sin((i / 24) * Math.PI * 2) * 55] as [number, number]),
  };
  const canvas = skia.Skia.PictureRecorder().beginRecording();

  it("zeichnet Druckwelle und höchstens BURST_PARTICLES Teilchen, danach nichts mehr", () => {
    expect(burstCount(true)).toBe(BURST_PARTICLES.strong);
    expect(burstCount(false)).toBe(BURST_PARTICLES.small);
    const before = skia.__skiaDraws.circles;
    drawBurst(canvas, scene, 0.2, true);
    const drawn = skia.__skiaDraws.circles - before;
    // Ring, Blitzschein und je Teilchen Hof und Kern
    expect(drawn).toBeGreaterThan(10);
    expect(drawn).toBeLessThanOrEqual(2 + 2 * BURST_PARTICLES.strong);
    const after = skia.__skiaDraws.circles;
    drawBurst(canvas, scene, BURST_SECONDS + 0.1, true);
    expect(skia.__skiaDraws.circles).toBe(after);
    expect(burstVisible(-0.1)).toBe(false);
    expect(burstVisible(0.5)).toBe(true);
  });
});
