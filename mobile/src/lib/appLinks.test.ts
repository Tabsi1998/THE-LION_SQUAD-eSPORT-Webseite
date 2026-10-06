import { Linking } from "react-native";
import { flushPendingLink, handleIncomingUrl, listenForAppLinks } from "./appLinks";
import { targetFromUrl } from "../navigation/rootNavigation";

// Links von außen (#921): vor dem Start der Navigation gemerkt, danach sofort; fremde Adressen nie; und die
// App-Links in app.json nennen nur Pfade, für die die App einen Screen hat.

const mockRef = { ready: false, navigate: jest.fn() };
jest.mock("@react-navigation/native", () => ({
  createNavigationContainerRef: () => ({ isReady: () => mockRef.ready, navigate: (...args: unknown[]) => mockRef.navigate(...args), getCurrentRoute: () => null }),
}));

beforeEach(() => {
  mockRef.ready = false;
  mockRef.navigate.mockClear();
});

test("vor dem Start gemerkt, mit dem Start geöffnet; danach sofort; fremde Adressen nie", () => {
  expect(handleIncomingUrl("https://lionsquad.at/tournaments/t-1")).toBe("later");
  expect(mockRef.navigate).not.toHaveBeenCalled();
  mockRef.ready = true;
  expect(flushPendingLink()).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("Tournaments", { screen: "TournamentDetail", params: { id: "t-1" }, initial: false });
  expect(flushPendingLink()).toBe(false);

  expect(handleIncomingUrl("https://www.lionsquad.at/news/saisonstart")).toBe("screen");
  expect(mockRef.navigate).toHaveBeenLastCalledWith("More", { screen: "NewsDetail", params: { id: "saisonstart" }, initial: false });
  mockRef.navigate.mockClear();
  expect(handleIncomingUrl("https://start.gg/tournaments/t-1")).toBe("none");
  expect(handleIncomingUrl("https://lionsquad.at/admin/users")).toBe("none");
  expect(handleIncomingUrl(null)).toBe("none");
  expect(mockRef.navigate).not.toHaveBeenCalled();
});

test("beim Start die Startadresse, danach jede weitere - bis zum Abmelden", async () => {
  mockRef.ready = true;
  const remove = jest.fn();
  jest.spyOn(Linking, "getInitialURL").mockResolvedValue("https://lionsquad.at/events/lan-2026");
  const listen = jest.spyOn(Linking, "addEventListener").mockReturnValue({ remove } as never);
  const stop = listenForAppLinks();
  await Promise.resolve();
  await Promise.resolve();
  expect(mockRef.navigate).toHaveBeenLastCalledWith("Tournaments", { screen: "EventDetail", params: { id: "lan-2026" }, initial: false });
  const handler = listen.mock.calls[0][1] as (event: { url: string }) => void;
  handler({ url: "https://lionsquad.at/teams/t-9" });
  expect(mockRef.navigate).toHaveBeenLastCalledWith("Teams", { screen: "TeamDetail", params: { id: "t-9" }, initial: false });
  stop();
  expect(remove).toHaveBeenCalled();
});

test("app.json: jeder App-Link-Pfad hat einen Screen, beide Schreibweisen der Domain, nichts aus der Verwaltung", () => {
  const { expo } = require("../../app.json");
  const filters = expo.android.intentFilters as Array<{ action: string; autoVerify: boolean; category: string[]; data: Array<{ scheme: string; host: string; path?: string; pathPrefix?: string }> }>;
  expect(filters).toHaveLength(1);
  expect(filters[0]).toMatchObject({ action: "VIEW", autoVerify: true, category: expect.arrayContaining(["BROWSABLE", "DEFAULT"]) });
  const hosts = new Set(filters[0].data.map((entry) => entry.host));
  expect([...hosts].sort()).toEqual(["lionsquad.at", "www.lionsquad.at"]);
  for (const entry of filters[0].data) {
    expect(entry.scheme).toBe("https");
    const sample = entry.path ?? `${entry.pathPrefix}beispiel-1`;
    expect(entry.path || entry.pathPrefix?.endsWith("/")).toBeTruthy();
    expect(targetFromUrl(`https://${entry.host}${sample}`)).not.toBeNull();
    expect(sample.startsWith("/admin")).toBe(false);
  }
});
