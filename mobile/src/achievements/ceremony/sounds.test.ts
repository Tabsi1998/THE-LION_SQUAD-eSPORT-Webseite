// Klänge der Zeremonie (E13, #623): jedes Rezept des Webs ist als Probenfolge hörbar, bleibt unter Vollaussteuerung und
// ist bei gleichem Material immer gleich (eine Datei je Klang); „Ton aus“ am Gerät oder im Profil schweigt, die
// Lautstärke kommt aus dem Profil.

const mockStore: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore[key] ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => { mockStore[key] = value; }),
}));
const mockPlayGenerated = jest.fn(async (..._args: unknown[]) => true);
jest.mock("../../seasons/sound/player", () => ({ playGeneratedSound: (...args: unknown[]) => mockPlayGenerated(...args) }));

import { MATERIAL_SOUNDS, SPECIAL_SOUNDS, ceremonySoundSeconds, playCeremonySound, readCeremonySoundPrefs, renderCeremonySound, resetCeremonySoundPrefs, writeCeremonyMuted } from "./sounds";

function peak(samples: Float32Array): number {
  let max = 0;
  for (const value of samples) max = Math.max(max, Math.abs(value));
  return max;
}

beforeEach(() => {
  Object.keys(mockStore).forEach((key) => delete mockStore[key]);
  resetCeremonySoundPrefs();
  mockPlayGenerated.mockClear();
});

test("jedes Material und jeder Sonderablauf klingt hörbar, ohne Übersteuerung, und immer gleich", () => {
  expect(Object.keys(MATERIAL_SOUNDS)).toEqual(["wood", "iron", "bronze", "silver", "gold", "platinum", "diamond", "legendary", "hidden"]);
  expect(Object.keys(SPECIAL_SOUNDS)).toEqual(["first", "stack", "group", "category", "diamond", "legendary", "levelup"]);
  for (const material of Object.keys(MATERIAL_SOUNDS)) {
    const samples = renderCeremonySound({ material }, 8000);
    expect(samples.length).toBe(Math.ceil(ceremonySoundSeconds(null) * 8000));
    expect(peak(samples)).toBeGreaterThan(0.03);
    expect(peak(samples)).toBeLessThanOrEqual(1);
    expect(samples.every(Number.isFinite)).toBe(true);
  }
  for (const special of Object.keys(SPECIAL_SOUNDS)) {
    const samples = renderCeremonySound({ material: "gold", special }, 8000);
    expect(peak(samples)).toBeGreaterThan(0.03);
    expect(peak(samples)).toBeLessThanOrEqual(1);
  }
  const once = renderCeremonySound({ material: "legendary", special: "legendary" }, 8000);
  const again = renderCeremonySound({ material: "legendary", special: "legendary" }, 8000);
  expect(Array.from(again)).toEqual(Array.from(once));
});

test("„Ton aus“ am Gerät oder im Profil schweigt, die Lautstärke kommt aus dem Profil (Vorgabe 80)", async () => {
  expect(await readCeremonySoundPrefs(null)).toEqual({ muted: false, volume: 80 });
  expect(await readCeremonySoundPrefs({ ceremony_sound: false, ceremony_volume: 35 })).toEqual({ muted: true, volume: 35 });
  await writeCeremonyMuted(true);
  expect(mockStore.ceremony_sound_muted).toBe("1");
  expect((await readCeremonySoundPrefs(null)).muted).toBe(true);
  resetCeremonySoundPrefs();
  expect((await readCeremonySoundPrefs(null)).muted).toBe(true);
});

test("gespielt wird je Material und Ablauf aus einer eigenen Datei - stumm nur mit „force“", async () => {
  expect(await playCeremonySound({ material: "gold", special: "first" }, { user: { ceremony_volume: 50 } })).toBe(true);
  const [name, seconds, , options] = mockPlayGenerated.mock.calls[0];
  expect(name).toBe("ceremony-gold-first-v1");
  expect(seconds).toBe(ceremonySoundSeconds("first"));
  expect(options).toEqual({ volume: 0.5 });

  await writeCeremonyMuted(true);
  expect(await playCeremonySound({ material: "gold" })).toBe(false);
  expect(mockPlayGenerated).toHaveBeenCalledTimes(1);
  expect(await playCeremonySound({ material: "gold" }, { force: true })).toBe(true);
  expect(mockPlayGenerated).toHaveBeenCalledTimes(2);
  expect(await playCeremonySound({ material: "gold" }, { user: { ceremony_volume: 0 }, force: true })).toBe(false);
});
