import { BURST_VOICES, MAX_VOICES, NEW_YEAR_SOUND_EVENT, NEW_YEAR_SOUND_KEY, createNewYearSound, readNewYearSound, volumeFor, writeNewYearSound } from "./sound";

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
