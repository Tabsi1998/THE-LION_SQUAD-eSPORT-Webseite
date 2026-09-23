import { Platform } from "react-native";
import { detectInstallSource, startPlayUpdate } from "./installSource";

// Installationsquelle (#421): antwortet der Play-Dienst, kommt die App von Google Play; ein
// Fehler heißt Sideload (Server-APK); ohne Android ist es unbekannt.

const mockCheck = jest.fn();
const mockStart = jest.fn();
jest.mock("expo-in-app-updates", () => ({ checkForUpdate: (...args: unknown[]) => mockCheck(...args), startUpdate: (...args: unknown[]) => mockStart(...args) }));

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = "android";
});

test("Play kennt die App: Quelle play mit Update-Stand", async () => {
  mockCheck.mockResolvedValue({ updateAvailable: true, immediateAllowed: true, flexibleAllowed: true });
  expect(await detectInstallSource()).toEqual({ source: "play", updateAvailable: true, immediateAllowed: true, flexibleAllowed: true });
});

test("Play kennt die App nicht: Sideload; ohne Android unbekannt", async () => {
  mockCheck.mockRejectedValue(new Error("ERROR_APP_NOT_OWNED"));
  expect((await detectInstallSource()).source).toBe("sideload");
  Platform.OS = "ios";
  expect((await detectInstallSource()).source).toBe("unknown");
  expect(mockCheck).toHaveBeenCalledTimes(1);
});

test("Googles Dialog: sofort bei Pflicht, ein Fehler heißt nicht gestartet", async () => {
  mockStart.mockResolvedValue(true);
  expect(await startPlayUpdate(true)).toBe(true);
  expect(mockStart).toHaveBeenCalledWith(true);
  mockStart.mockRejectedValue(new Error("nope"));
  expect(await startPlayUpdate(false)).toBe(false);
});
