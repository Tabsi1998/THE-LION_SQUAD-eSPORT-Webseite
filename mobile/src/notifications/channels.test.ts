import fs from "fs";
import path from "path";
import { Platform } from "react-native";
import { CALL_GONG_SOUND, PUSH_CHANNELS, PUSH_CHANNEL_SET, RETIRED_CHANNEL_IDS } from "./channels";

// Android-Kanäle (#1138): fünf Kanäle nach der Aufteilung des Betreibers, die alten zwei werden gelöscht, „Aufrufe & Spielstart“
// bekommt den Gong gleich beim Anlegen. Der Server schickt nur Kennungen, die die App anlegt.

const mockNotifications = {
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3 },
  setNotificationChannelAsync: jest.fn(async () => null),
  deleteNotificationChannelAsync: jest.fn(async () => undefined),
};
jest.mock("expo-notifications", () => mockNotifications);

const ROOT = path.join(__dirname, "../../..");

test("die App legt fünf Kanäle an, der Aufruf-Kanal ist wichtig und gongt, die alten verschwinden", async () => {
  const original = Platform.OS;
  Object.defineProperty(Platform, "OS", { configurable: true, get: () => "android" });
  try {
    const { setupAndroidChannels } = jest.requireActual("./PushService") as typeof import("./PushService");
    await setupAndroidChannels();
  } finally {
    Object.defineProperty(Platform, "OS", { configurable: true, get: () => original });
  }
  const created = mockNotifications.setNotificationChannelAsync.mock.calls.map((call) => (call as unknown[])[0]);
  expect(created).toEqual(["lion_calls", "lion_tournaments", "lion_chats", "lion_club", "lion_achievements"]);
  const calls = (mockNotifications.setNotificationChannelAsync.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
  expect(calls).toMatchObject({ name: "Aufrufe & Spielstart", importance: 5, sound: CALL_GONG_SOUND });
  expect(PUSH_CHANNELS.map((channel) => channel.name)).toEqual(["Aufrufe & Spielstart", "Turniere & Events", "Chats", "Verein", "Erfolge"]);
  expect(mockNotifications.deleteNotificationChannelAsync.mock.calls.map((call) => (call as unknown[])[0])).toEqual(RETIRED_CHANNEL_IDS);
  expect(PUSH_CHANNEL_SET).toBe(2);
});

test("der Server kennt genau diese Kanäle", () => {
  const server = fs.readFileSync(path.join(ROOT, "backend/services/push_notifications.py"), "utf8");
  const block = server.slice(server.indexOf("PUSH_CHANNELS = {"), server.indexOf("}", server.indexOf("PUSH_CHANNELS = {")));
  const used = new Set([...block.matchAll(/:\s*"(lion_[a-z_]+)"/g)].map((match) => match[1]));
  expect([...used].sort()).toEqual(PUSH_CHANNELS.map((channel) => channel.id).sort());
});

test("der Gong liegt als WAV in der App und kommt über das Plugin hinein", () => {
  const app = JSON.parse(fs.readFileSync(path.join(__dirname, "../../app.json"), "utf8"));
  const plugin = app.expo.plugins.find((entry: unknown) => Array.isArray(entry) && entry[0] === "expo-notifications");
  expect(plugin[1].sounds).toEqual([`./assets/sounds/${CALL_GONG_SOUND}`]);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { OUT, SAMPLE_RATE, render } = require("../../scripts/render-call-gong.cjs");
  const wav: Buffer = fs.readFileSync(OUT);
  expect(path.basename(OUT)).toBe(CALL_GONG_SOUND);
  expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
  expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
  expect(wav.readUInt16LE(22)).toBe(1);
  expect(wav.readUInt32LE(24)).toBe(SAMPLE_RATE);
  expect(wav.readUInt16LE(34)).toBe(16);
  const seconds = wav.readUInt32LE(40) / 2 / SAMPLE_RATE;
  expect(seconds).toBeGreaterThan(2.5);
  expect(seconds).toBeLessThan(3);
  // Die Datei ist der gerechnete Gong (höchstens eine Stufe Rundung Unterschied).
  const expected: Float64Array = render();
  let worst = 0;
  for (let index = 0; index < expected.length; index += 1) {
    const stored = wav.readInt16LE(44 + index * 2);
    worst = Math.max(worst, Math.abs(stored - Math.round(Math.max(-1, Math.min(1, expected[index])) * 32767)));
  }
  expect(worst).toBeLessThanOrEqual(1);
});
