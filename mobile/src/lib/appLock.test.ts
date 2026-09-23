import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { APP_LOCK_KEY, authenticate, availabilityText, lockAvailability, methodLabel, readAppLock, shouldRelock, writeAppLock } from "./appLock";

// App-Sperre (#217): wann wieder gesperrt wird, was das Gerät kann, und dass der Schalter nur am Gerät liegt.

beforeEach(async () => {
  jest.clearAllMocks();
  await SecureStore.deleteItemAsync(APP_LOCK_KEY);
});

test("nach einer Minute im Hintergrund wird wieder gesperrt, davor nicht", () => {
  expect(shouldRelock(null, 1_000_000)).toBe(false);
  expect(shouldRelock(1_000_000, 1_030_000)).toBe(false);
  expect(shouldRelock(1_000_000, 1_060_000)).toBe(true);
});

test("die Methode in Worten", () => {
  const T = LocalAuthentication.AuthenticationType;
  expect(methodLabel([T.FINGERPRINT])).toBe("Fingerabdruck");
  expect(methodLabel([T.FACIAL_RECOGNITION])).toBe("Gesicht");
  expect(methodLabel([T.FINGERPRINT, T.FACIAL_RECOGNITION])).toBe("Fingerabdruck oder Gesicht");
  expect(methodLabel([])).toBe("Gerätesperre");
  expect(methodLabel([T.FINGERPRINT], LocalAuthentication.SecurityLevel.SECRET)).toBe("Gerätesperre");
});

test("Verfügbarkeit: eingerichtet, nur PIN, gar nichts", async () => {
  expect(await lockAvailability()).toEqual({ available: true, reason: "", method: "Fingerabdruck" });

  (LocalAuthentication.getEnrolledLevelAsync as jest.Mock).mockResolvedValueOnce(LocalAuthentication.SecurityLevel.SECRET);
  const pin = await lockAvailability();
  expect(pin.available).toBe(true);
  expect(availabilityText(pin)).toContain("nach Gerätesperre");

  (LocalAuthentication.getEnrolledLevelAsync as jest.Mock).mockResolvedValueOnce(LocalAuthentication.SecurityLevel.NONE);
  const none = await lockAvailability();
  expect(none).toEqual({ available: false, reason: "not_enrolled", method: "" });
  expect(availabilityText(none)).toContain("keine Bildschirmsperre");
});

test("der Schalter liegt im SecureStore; Entsperren zählt nur bei Erfolg", async () => {
  expect(await readAppLock()).toBe(false);
  await writeAppLock(true);
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(APP_LOCK_KEY, "true");
  expect(await readAppLock()).toBe(true);

  expect(await authenticate()).toBe(true);
  expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledWith(expect.objectContaining({ promptMessage: "LionsAPP entsperren" }));
  (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: false, error: "user_cancel" });
  expect(await authenticate()).toBe(false);
  (LocalAuthentication.authenticateAsync as jest.Mock).mockRejectedValueOnce(new Error("kein Gerät"));
  expect(await authenticate()).toBe(false);
});
