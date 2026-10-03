import { BURST_LEVEL, BURST_VOICES, CALIBER_VOICES, MAX_VOICES, NEW_YEAR_SOUND_EVENT, NEW_YEAR_SOUND_KEY, burstLevel, burstShape, createNewYearSound, readNewYearSound, volumeFor, writeNewYearSound } from "./sound";

// Silvester-Klang (N4, #742): Vorgabe aus, eigener Schalter je Gerät; aus bleibt wirklich still (keine Audio-Fläche);
// ferne Raketen leiser und später; höchstens sechs Stimmen; jede Art klingt anders.

function fakeAudio() {
  const made = [];
  const node = () => ({ connect: (next) => next || node(), start() {}, stop() {}, frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, Q: { value: 0 }, threshold: { value: 0 }, ratio: { value: 0 }, buffer: null, type: "" });
  class Ctx {
    constructor() {
      made.push(this);
      this.currentTime = 0;
      this.sampleRate = 8000;
      this.state = "running";
      this.destination = node();
    }
    createDynamicsCompressor() { return node(); }
    createGain() { return node(); }
    createBiquadFilter() { return node(); }
    createBufferSource() { return node(); }
    createBuffer(_channels, length) { return { getChannelData: () => new Float32Array(length) }; }
    close() {}
  }
  return { Ctx, made };
}

beforeEach(() => localStorage.clear());

test("Vorgabe aus; der Schalter merkt sich die Wahl je Gerät und sagt es der Seite", () => {
  expect(readNewYearSound()).toBe(false);
  const heard = [];
  const onPref = (event) => heard.push(event.detail.on);
  window.addEventListener(NEW_YEAR_SOUND_EVENT, onPref);
  writeNewYearSound(true);
  expect(localStorage.getItem(NEW_YEAR_SOUND_KEY)).toBe("on");
  expect(readNewYearSound()).toBe(true);
  writeNewYearSound(false);
  expect(readNewYearSound()).toBe(false);
  window.removeEventListener(NEW_YEAR_SOUND_EVENT, onPref);
  expect(heard).toEqual([true, false]);
});

test("aus bleibt still: ohne Einschalten entsteht keine Audio-Fläche", () => {
  const { Ctx, made } = fakeAudio();
  const sound = createNewYearSound({ win: window, AudioContextImpl: Ctx, enabled: false });
  expect(sound.whistle(0.2, 1.3)).toBe(false);
  expect(sound.burst("peony", 0.2)).toBe(false);
  expect(made).toHaveLength(0);
});

test("eingeschaltet: Zischen und Knall spielen, höchstens sechs Stimmen gleichzeitig", () => {
  const { Ctx, made } = fakeAudio();
  const sound = createNewYearSound({ win: window, AudioContextImpl: Ctx, enabled: true });
  const played = Array.from({ length: 10 }, () => sound.burst("crackle", 0.5));
  expect(made).toHaveLength(1);
  expect(played.filter(Boolean)).toHaveLength(MAX_VOICES);
  sound.dispose();
});

test("Entfernung: fern leiser; jede Art klingt anders", () => {
  expect(volumeFor(0)).toBe(1);
  expect(volumeFor(1)).toBeCloseTo(0.35, 2);
  expect(new Set(Object.values(BURST_VOICES).map((voice) => JSON.stringify(voice))).size).toBe(Object.keys(BURST_VOICES).length);
});

test("Kaliber (#853): leise knisternd bis kräftiger Knall - nie lauter als der lauteste Knall bisher", () => {
  expect(BURST_LEVEL).toBe(0.9);
  for (const caliber of Object.keys(CALIBER_VOICES)) {
    for (const distance of [0, 0.3, 1]) expect(burstLevel(caliber, distance)).toBeLessThanOrEqual(BURST_LEVEL);
  }
  expect(burstLevel("giant", 0)).toBe(BURST_LEVEL);
  expect(burstLevel("small", 0)).toBeLessThan(burstLevel("large", 0) * 0.6);
  expect(burstLevel(undefined, 0)).toBe(burstLevel("large", 0));
  // Die kleine knistert hell und kurz, die sehr große klingt tief und lang.
  expect(burstShape("peony", "small").crackle).toBeGreaterThan(0);
  expect(burstShape("peony", "small").cutoff).toBeGreaterThan(burstShape("peony", "large").cutoff);
  expect(burstShape("peony", "giant").cutoff).toBeLessThan(burstShape("peony", "large").cutoff);
  expect(burstShape("peony", "giant").seconds).toBeGreaterThan(burstShape("peony", "large").seconds);
  expect(burstShape("willow", "large")).toEqual(BURST_VOICES.willow);
  const { Ctx } = fakeAudio();
  const sound = createNewYearSound({ win: window, AudioContextImpl: Ctx, enabled: true });
  expect(sound.burst("peony", 0.2, "giant")).toBe(true);
  expect(sound.whistle(0.2, 1.3, "small")).toBe(true);
  sound.dispose();
});
