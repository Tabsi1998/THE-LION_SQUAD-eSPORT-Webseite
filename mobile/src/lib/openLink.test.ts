import { Linking } from "react-native";
import { openLink } from "./openLink";
import { WEB_BASE_URL } from "./siteUrls";

// Ein Weg für alle Links (#921): eigene Seite mit Screen → Screen; eigene Seite ohne Screen und fremde Adressen →
// Browser; was keine Webadresse ist, wird nicht geöffnet.

const mockNavigateToUrl = jest.fn((_url?: string | null) => false);
jest.mock("../navigation/rootNavigation", () => ({ navigateToUrl: (url?: string | null) => mockNavigateToUrl(url) }));

let openUrl: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockNavigateToUrl.mockReturnValue(false);
  openUrl = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
});

test("eigene Seite mit Screen: der Screen geht auf, der Browser bleibt zu - auch mit www und Abfrage", () => {
  mockNavigateToUrl.mockReturnValue(true);
  expect(openLink("https://www.lionsquad.at/tournaments/t-1")).toBe("screen");
  expect(mockNavigateToUrl).toHaveBeenCalledWith("/tournaments/t-1");
  expect(openLink("/profile?tab=invoices&invoice=d-7")).toBe("screen");
  expect(mockNavigateToUrl).toHaveBeenLastCalledWith("/profile?tab=invoices&invoice=d-7");
  expect(openUrl).not.toHaveBeenCalled();
});

test("eigene Seite ohne Screen: die Website im Browser, mit der Adresse des Servers", () => {
  expect(openLink("/servers")).toBe("browser");
  expect(openUrl).toHaveBeenCalledWith(`${WEB_BASE_URL}/servers`);
});

test("fremde Seite: immer im Browser, nie als Screen gedeutet", () => {
  expect(openLink("https://start.gg/tournaments/t-1")).toBe("browser");
  expect(mockNavigateToUrl).not.toHaveBeenCalled();
  expect(openUrl).toHaveBeenCalledWith("https://start.gg/tournaments/t-1");
});

test("was keine Webadresse ist, wird nicht geöffnet; ein Fehler des Browsers bleibt leise", async () => {
  expect(openLink("javascript:alert(1)")).toBe("none");
  expect(openLink("")).toBe("none");
  expect(openLink(null)).toBe("none");
  expect(openUrl).not.toHaveBeenCalled();
  openUrl.mockRejectedValueOnce(new Error("kein Browser"));
  expect(openLink("https://example.test/")).toBe("browser");
  await Promise.resolve();
});
