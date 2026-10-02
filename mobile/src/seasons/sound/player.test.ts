import * as SecureStore from "expo-secure-store";

// Töne der Saison-Deko (#772): Vorgabe an wie im Web, „aus“ merkt das Gerät; der Laut wird einmal gerechnet und im
// Cache abgelegt, leise und ohne fremde Musik zu unterbrechen gespielt, danach freigegeben. Schnelles Tippen
// knattert nicht, und ohne Speicher oder Audio bleibt es still statt zu stören.

const mockPlayer = { play: jest.fn(), remove: jest.fn() };
const mockAudio = { createAudioPlayer: jest.fn((_source: unknown) => mockPlayer), setAudioModeAsync: jest.fn(async (_mode: unknown) => {}) };
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

const { MIN_GAP_MS, SOUND_KEY, playSeasonSound, readSoundsOn, resetSounds, setSoundsOn } = require("./player");

beforeEach(async () => {
  resetSounds();
  mockFiles.clear();
  jest.clearAllMocks();
  await SecureStore.deleteItemAsync(SOUND_KEY);
});

afterEach(() => {
  jest.useRealTimers();
});

test("Töne sind wie im Web vorgegeben an; „aus“ bleibt aus, auch nach einem Neustart", async () => {
  expect(await readSoundsOn()).toBe(true);
  await setSoundsOn(false);
  resetSounds();
  expect(await readSoundsOn()).toBe(false);
  expect(await SecureStore.getItemAsync(SOUND_KEY)).toBe("off");
  await setSoundsOn(true);
  expect(await SecureStore.getItemAsync(SOUND_KEY)).toBe("on");
});

test("die Katze miaut: einmal gerechnet und in den Cache geschrieben, still bei Lautlos, ohne fremde Musik zu stoppen, danach freigegeben", async () => {
  jest.useFakeTimers();
  expect(await playSeasonSound("cat_meow", { rng: () => 0.5, now: 1000 })).toBe(true);
  expect(mockFs.writeAsStringAsync).toHaveBeenCalledTimes(1);
  const [uri, content, options] = mockFs.writeAsStringAsync.mock.calls[0];
  expect(uri).toBe("file:///cache/season-sounds/meow-1-v1.wav");
  expect(options).toEqual({ encoding: "base64" });
  expect(Buffer.from(content, "base64").subarray(0, 4).toString()).toBe("RIFF");
  expect(mockAudio.setAudioModeAsync).toHaveBeenCalledWith({ playsInSilentMode: false, interruptionMode: "mixWithOthers" });
  expect(mockAudio.createAudioPlayer).toHaveBeenCalledWith({ uri });
  expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(2000);
  expect(mockPlayer.remove).toHaveBeenCalledTimes(1);
  // Beim nächsten Mal liegt die Datei schon da.
  expect(await playSeasonSound("cat_meow", { rng: () => 0.5, now: 5000 })).toBe(true);
  expect(mockFs.writeAsStringAsync).toHaveBeenCalledTimes(1);
  expect(mockAudio.createAudioPlayer).toHaveBeenCalledTimes(2);
  expect(mockAudio.setAudioModeAsync).toHaveBeenCalledTimes(1);
});

test("Töne aus: kein Laut und keine Datei", async () => {
  await setSoundsOn(false);
  expect(await playSeasonSound("cat_meow", { now: 1000 })).toBe(false);
  expect(mockAudio.createAudioPlayer).not.toHaveBeenCalled();
  expect(mockFs.writeAsStringAsync).not.toHaveBeenCalled();
});

test("schnelles Tippen: nie zwei Laute dichter als MIN_GAP_MS", async () => {
  expect(await playSeasonSound("cat_meow", { rng: () => 0, now: 1000 })).toBe(true);
  expect(await playSeasonSound("cat_meow", { rng: () => 0, now: 1000 + MIN_GAP_MS - 1 })).toBe(false);
  expect(await playSeasonSound("cat_meow", { rng: () => 0, now: 1000 + MIN_GAP_MS })).toBe(true);
  expect(mockPlayer.play).toHaveBeenCalledTimes(2);
});

test("kein Speicher oder kein Audio: still und ohne Fehler, der nächste Versuch klappt wieder", async () => {
  mockFs.writeAsStringAsync.mockRejectedValueOnce(new Error("voll"));
  expect(await playSeasonSound("cat_meow", { rng: () => 0.9, now: 1000 })).toBe(false);
  expect(await playSeasonSound("cat_meow", { rng: () => 0.9, now: 2000 })).toBe(true);
  expect(mockFs.writeAsStringAsync).toHaveBeenCalledTimes(2);
  mockAudio.createAudioPlayer.mockImplementationOnce(() => {
    throw new Error("kein Audio");
  });
  expect(await playSeasonSound("cat_meow", { rng: () => 0.9, now: 3000 })).toBe(false);
});
