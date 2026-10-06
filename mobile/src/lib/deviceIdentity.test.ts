import * as SecureStore from "expo-secure-store";
import { DEVICE_ID_HEADER, DEVICE_ID_KEY, DEVICE_NAME_HEADER, asciiHeaderValue, deviceHeaders, deviceName, getDeviceIdentity, randomDeviceId, resetDeviceIdentity } from "./deviceIdentity";

// Gerät je Installation (#942): Kennung einmal anlegen und behalten, Name als ASCII-Kopfzeile.

beforeEach(async () => {
  resetDeviceIdentity();
  await SecureStore.deleteItemAsync(DEVICE_ID_KEY);
});

test("Name: Modell und System, nur ASCII, höchstens 120 Zeichen", () => {
  expect(deviceName("Pixel 9", "16", "android")).toBe("Pixel 9 / Android 16");
  expect(deviceName(null, null, "android")).toBe("Android / Android");
  expect(deviceName("iPhone 15", "18.1", "ios")).toBe("iPhone 15 / iOS 18.1");
  expect(deviceName("Gerät · Ümlaut", "16", "android")).toBe("Ger?t ? ?mlaut / Android 16");
  expect(asciiHeaderValue(`${"x".repeat(200)}`).length).toBe(120);
  expect(asciiHeaderValue("  viel   Platz \n hier ")).toBe("viel Platz hier");
});

test("Kennung: 32 Hex-Zeichen, einmal angelegt und danach aus dem sicheren Speicher - gleichzeitig nur einmal", async () => {
  const id = randomDeviceId(() => 0.5);
  expect(id).toMatch(/^[a-f0-9]{32}$/);
  const [first, second] = await Promise.all([getDeviceIdentity(), getDeviceIdentity()]);
  expect(first.id).toMatch(/^[a-f0-9]{32}$/);
  expect(second.id).toBe(first.id);
  expect(await SecureStore.getItemAsync(DEVICE_ID_KEY)).toBe(first.id);
  resetDeviceIdentity();
  expect((await getDeviceIdentity()).id).toBe(first.id);
});

test("eine kaputte gespeicherte Kennung wird ersetzt; die Kopfzeilen tragen Kennung und Name", async () => {
  await SecureStore.setItemAsync(DEVICE_ID_KEY, "nicht-hex!");
  const identity = await getDeviceIdentity();
  expect(identity.id).toMatch(/^[a-f0-9]{32}$/);
  const headers = await deviceHeaders();
  expect(headers[DEVICE_ID_HEADER]).toBe(identity.id);
  expect(headers[DEVICE_NAME_HEADER]).toBe(identity.name);
  expect(headers[DEVICE_NAME_HEADER]).toMatch(/^[\x20-\x7e]+$/);
});
