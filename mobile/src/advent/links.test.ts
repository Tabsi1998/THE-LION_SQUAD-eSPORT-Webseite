import { Linking } from "react-native";
import { WEB_BASE_URL, openDoorLink, ownPath } from "./links";

// Adressen aus einem Türchen (#641, #642): eigene Seiten im Screen der App, alles andere im Browser - und eine
// fremde Adresse wird nie als eigener Screen gedeutet.

const mockNavigateToUrl = jest.fn((_url?: string | null) => false);
jest.mock("../navigation/rootNavigation", () => ({ navigateToUrl: (url?: string | null) => mockNavigateToUrl(url) }));

let openUrl: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockNavigateToUrl.mockReturnValue(false);
  openUrl = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
});

test("der Pfad auf der eigenen Website - sonst nichts", () => {
  expect(ownPath("/news/advent-gruss")).toBe("/news/advent-gruss");
  expect(ownPath(`${WEB_BASE_URL}/events/lan-2026`)).toBe("/events/lan-2026");
  expect(ownPath(WEB_BASE_URL)).toBe("/");
  expect(ownPath("//boese.example/news/x")).toBeNull();
  expect(ownPath("https://boese.example/news/x")).toBeNull();
  expect(ownPath(`${WEB_BASE_URL}.boese.example/news/x`)).toBeNull();
  expect(ownPath("")).toBeNull();
  expect(ownPath(null)).toBeNull();
});

test("eigene Seite mit Screen: die App öffnet ihn, der Browser bleibt zu", () => {
  mockNavigateToUrl.mockReturnValue(true);
  expect(openDoorLink("/news/advent-gruss")).toBe("screen");
  expect(mockNavigateToUrl).toHaveBeenCalledWith("/news/advent-gruss");
  expect(openDoorLink(`${WEB_BASE_URL}/me/prizes`)).toBe("screen");
  expect(mockNavigateToUrl).toHaveBeenLastCalledWith("/me/prizes");
  expect(openUrl).not.toHaveBeenCalled();
});

test("eigene Seite ohne Screen: sie öffnet sich auf der Website", () => {
  expect(openDoorLink("/servers")).toBe("browser");
  expect(openUrl).toHaveBeenCalledWith(`${WEB_BASE_URL}/servers`);
});

test("fremde Seite: immer im Browser, nie als Screen gedeutet", () => {
  mockNavigateToUrl.mockReturnValue(true);
  expect(openDoorLink("https://www.youtube.com/watch?v=abc")).toBe("browser");
  expect(openDoorLink("https://boese.example/news/x")).toBe("browser");
  expect(mockNavigateToUrl).not.toHaveBeenCalled();
  expect(openUrl).toHaveBeenCalledTimes(2);
});

test("was keine Webadresse ist, wird nicht geöffnet", () => {
  for (const url of ["javascript:alert(1)", "intent://x#Intent;end", "tel:+43123", "", null, undefined, "//boese.example/x"]) {
    expect(openDoorLink(url)).toBe("none");
  }
  expect(openUrl).not.toHaveBeenCalled();
});

test("lässt sich der Browser nicht öffnen, bleibt die App ruhig", async () => {
  openUrl.mockRejectedValueOnce(new Error("kein Browser"));
  expect(openDoorLink("https://example.org")).toBe("browser");
  await Promise.resolve();
});
