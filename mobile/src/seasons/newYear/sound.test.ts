import * as SecureStore from "expo-secure-store";

// Silvester-Klang in der App (N4 #742): Vorgabe aus und eigener Schalter; aus bleibt still (kein Audio, keine Datei);
// Zischen und Knall einmal gerechnet und im Cache; jede Art anders; höchstens drei zugleich; fern leiser.

const mockPlayer = { play: jest.fn(), remove: jest.fn(), release: jest.fn(), volume: 1 };
const mockAudio = { createAudioPlayer: jest.fn((_source: unknown) => ({ ...mockPlayer })), setAudioModeAsync: jest.fn(async (_mode: unknown) => {}) };
jest.mock("expo-audio", () => mockAudio);
const mockFiles = new Map<string, string>();
const mockFs = {
  cacheDirectory: "file:///cache/",
  EncodingType: { Base64: "base64" },
  getInfoAsync: jest.fn(async (uri: string) => ({ exists: mockFiles.has(uri) })),
  makeDirectoryAsync: jest.fn(async () => {}),
  writeAsStringAsync: jest.fn(async (uri: string, content: string, _options?: unknown) => {
    mockFiles.set(uri, content);
  }),
};
jest.mock("expo-file-system/legacy", () => mockFs);

const { BURST_VOICES, CALIBER_VOICES, MAX_VOICES, NEW_YEAR_SOUND_KEY, burstShape, playFireSound, readNewYearSound, renderBoom, renderWhistle, resetNewYearSound, setNewYearSound, soundLevel, volumeFor } = require("./sound");
const { seasonAudioMode } = require("../sound/player");

beforeEach(async () => {
  resetNewYearSound();
  mockFiles.clear();
  jest.clearAllMocks();
  await SecureStore.deleteItemAsync(NEW_YEAR_SOUND_KEY);
});

test("Vorgabe aus; eingeschaltet merkt es das Gerät", async () => {
  expect(await readNewYearSound()).toBe(false);
  await setNewYearSound(true);
  resetNewYearSound();
  expect(await readNewYearSound()).toBe(true);
  expect(await SecureStore.getItemAsync(NEW_YEAR_SOUND_KEY)).toBe("on");
});

test("aus bleibt still: kein Audio, keine Datei", async () => {
  expect(await playFireSound("whistle", 0.2, 10_000)).toBe(false);
  expect(mockAudio.createAudioPlayer).not.toHaveBeenCalled();
  expect(mockFs.writeAsStringAsync).not.toHaveBeenCalled();
});

test("eingeschaltet: Zischen und Knall aus dem Cache, ohne fremde Musik zu unterbrechen, höchstens drei zugleich, fern leiser", async () => {
  jest.useFakeTimers();
  await setNewYearSound(true);
  const results: boolean[] = [];
  for (let i = 0; i < 5; i += 1) results.push(await playFireSound("boom-crackle", 0.9, 10_000 + i * 200));
  expect(results.filter(Boolean)).toHaveLength(MAX_VOICES);
  expect(mockAudio.setAudioModeAsync).toHaveBeenCalledWith(seasonAudioMode());
  expect(mockFs.writeAsStringAsync).toHaveBeenCalledTimes(1);
  const player = mockAudio.createAudioPlayer.mock.results[0].value;
  expect(player.volume).toBeCloseTo(soundLevel("boom-crackle", 0.9), 2);
  expect(player.volume).toBeLessThan(volumeFor(0.2));
  jest.advanceTimersByTime(5_000);
  jest.useRealTimers();
});

test("Laute: Zischen steigt, Knall je Art anders lang, nie übersteuert", () => {
  const whistle = renderWhistle(1.3, 8000);
  expect(whistle.length).toBe(Math.floor(1.3 * 8000));
  const peony = renderBoom("peony", 8000);
  const willow = renderBoom("willow", 8000);
  expect(willow.length).toBeGreaterThan(peony.length);
  for (const samples of [whistle, peony, willow]) expect(Math.max(...Array.from(samples, Math.abs))).toBeLessThanOrEqual(0.71);
  expect(Math.max(...Array.from(whistle, Math.abs))).toBeCloseTo(0.45, 2);
  expect(Math.max(...Array.from(peony, Math.abs))).toBeCloseTo(0.7, 2);
  expect(new Set(Object.values(BURST_VOICES).map((voice) => JSON.stringify(voice))).size).toBe(6);
  expect(volumeFor(0)).toBe(1);
});

test("Kaliber (#853): leise knisternd bis kräftiger Knall - nie lauter als der lauteste Knall bisher; je Kaliber eine eigene Datei", async () => {
  for (const caliber of Object.keys(CALIBER_VOICES)) {
    for (const distance of [0, 0.4, 1]) expect(soundLevel(`boom-peony-${caliber}`, distance)).toBeLessThanOrEqual(volumeFor(distance));
  }
  expect(soundLevel("boom-peony-giant", 0)).toBe(1);
  expect(soundLevel("boom-peony-small", 0)).toBeLessThan(soundLevel("boom-peony-large", 0) * 0.6);
  expect(soundLevel("boom-peony", 0)).toBe(soundLevel("boom-peony-large", 0));
  expect(soundLevel("whistle", 0.4)).toBe(volumeFor(0.4));
  const small = renderBoom("peony", 8000, "small");
  const giant = renderBoom("peony", 8000, "giant");
  expect(giant.length).toBeGreaterThan(renderBoom("peony", 8000).length);
  // Die kleine knistert (Klicks nach dem Knall), auch wenn ihre Art sonst nicht knistert.
  expect(burstShape("peony", "small").crackle).toBeGreaterThan(0);
  expect(small.length).toBeGreaterThan(Math.floor(burstShape("peony", "small").seconds * 8000));
  for (const samples of [small, giant]) expect(Math.max(...Array.from(samples as Float32Array, Math.abs))).toBeLessThanOrEqual(0.71);
  jest.useFakeTimers();
  await setNewYearSound(true);
  expect(await playFireSound("boom-willow-giant", 0, 20_000)).toBe(true);
  expect(mockFs.writeAsStringAsync.mock.calls[0][0]).toBe("file:///cache/newyear-sounds/boom-willow-giant-v2.wav");
  expect(mockAudio.createAudioPlayer.mock.results[0].value.volume).toBe(1);
  jest.advanceTimersByTime(5_000);
  jest.useRealTimers();
});
