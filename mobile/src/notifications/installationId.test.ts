import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { INSTALLATION_ID_KEY, getInstallationId, isValidInstallationId, resetInstallationIdCache } from "./installationId";

// Installations-Kennung für Push (#2470): einmal erzeugt, danach wiederverwendet, nur auf diesem Gerät gespeichert.

const randomUUID = Crypto.randomUUID as jest.Mock;
const setItem = SecureStore.setItemAsync as jest.Mock;
const getItem = SecureStore.getItemAsync as jest.Mock;

beforeEach(async () => {
  jest.clearAllMocks();
  resetInstallationIdCache();
  await SecureStore.deleteItemAsync(INSTALLATION_ID_KEY);
});

test("beim ersten Mal eine zufällige UUID, im Schlüsselbund nur für dieses Gerät", async () => {
  const id = await getInstallationId();

  expect(randomUUID).toHaveBeenCalledTimes(1);
  // UUID v4: 122 Bit Zufall, in der Form, die der Server annimmt.
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(isValidInstallationId(id)).toBe(true);
  expect(setItem).toHaveBeenCalledWith(INSTALLATION_ID_KEY, id, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  expect(SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY).toBeDefined();
});

test("danach dieselbe Kennung - auch nach einem Neustart der App, ohne neue zu erzeugen", async () => {
  const first = await getInstallationId();
  resetInstallationIdCache();
  randomUUID.mockClear();

  expect(await getInstallationId()).toBe(first);
  expect(randomUUID).not.toHaveBeenCalled();
});

test("gleichzeitige Aufrufe erzeugen nur eine Kennung", async () => {
  const [a, b] = await Promise.all([getInstallationId(), getInstallationId()]);
  expect(a).toBe(b);
  expect(randomUUID).toHaveBeenCalledTimes(1);
});

test("ein kaputter gespeicherter Wert wird ersetzt", async () => {
  await SecureStore.setItemAsync(INSTALLATION_ID_KEY, "kurz");
  const id = await getInstallationId();
  expect(id).not.toBe("kurz");
  expect(isValidInstallationId(id)).toBe(true);
});

test("ohne sicheren Speicher keine Kennung - und der nächste Aufruf versucht es neu", async () => {
  getItem.mockRejectedValueOnce(new Error("Keystore gesperrt"));
  expect(await getInstallationId()).toBeNull();

  const id = await getInstallationId();
  expect(isValidInstallationId(id)).toBe(true);
});

test("die Form der Kennung wie am Server: 16 bis 64 Zeichen aus Buchstaben, Ziffern, _ und -", () => {
  expect(isValidInstallationId("a".repeat(16))).toBe(true);
  expect(isValidInstallationId("a".repeat(64))).toBe(true);
  expect(isValidInstallationId("a".repeat(15))).toBe(false);
  expect(isValidInstallationId("a".repeat(65))).toBe(false);
  expect(isValidInstallationId("abc def ghi jkl mno")).toBe(false);
  expect(isValidInstallationId(null)).toBe(false);
});

test("Android: der sichere Speicher bleibt vom Auto-Backup ausgenommen (Plugin von expo-secure-store)", () => {
  // Das Plugin setzt mit configureAndroidBackup (Standard: an) Regeln, die den Ordner „SecureStore“ aus Cloud-Sicherung
  // und Geräteumzug nehmen - aber nur, solange keine anderen Backup-Regeln gesetzt sind.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const app = require("../../app.json") as { expo: { plugins: unknown[]; android: Record<string, unknown> } };
  const entry = app.expo.plugins.find((plugin) => plugin === "expo-secure-store" || (Array.isArray(plugin) && plugin[0] === "expo-secure-store"));
  expect(entry).toBeDefined();
  const options = Array.isArray(entry) ? (entry[1] as Record<string, unknown> | undefined) : undefined;
  expect(options?.configureAndroidBackup).not.toBe(false);
  expect(JSON.stringify(app.expo)).not.toMatch(/fullBackupContent|dataExtractionRules/);
});
