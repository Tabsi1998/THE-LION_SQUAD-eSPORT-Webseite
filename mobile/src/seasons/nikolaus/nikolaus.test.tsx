import React from "react";
import { Animated, StyleSheet } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";

// Nikolaus in der App (X3 #736, S11 #642): der Stiefel im Kopf von „Mehr“ - angemeldet aus dem Server, Antippen
// wackelt, der Gutschein steigt, dann die Karte mit dem Sticker und ein Erfolgs-Tippen; danach benutzt. Ohne Konto der
// Weg zur Anmeldung, am falschen Tag „kommt am 6. Dezember“, „dezent“ ohne Bewegung. Der Hinweis einmal am Tag mit
// „Zum Stiefel“, nicht im Tab „Mehr“ und nicht, wenn schon geöffnet. Das Tab-Symbol ist der Stiefel.

const mockApi = { get: jest.fn(), post: jest.fn() };
const mockAuthState: { user: { id: string } | null } = { user: null };
const mockSeasonState: Record<string, unknown> = { ready: true, seasons: [], byKey: {}, preference: "on", setPreference: jest.fn(async () => {}), reducedMotion: false, reload: jest.fn(), toast: null, showToast: jest.fn(), weather: null };
const mockNavigate = jest.fn();
jest.mock("../../lib/api", () => ({ api: mockApi }));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => mockAuthState }));
jest.mock("../SeasonProvider", () => ({ useSeason: () => mockSeasonState }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }) }));
jest.mock("../../navigation/rootNavigation", () => ({ navigationRef: { isReady: () => true, getCurrentRoute: () => ({ name: "Dashboard" }), addListener: () => () => {}, navigate: (...args: unknown[]) => mockNavigate(...args) } }));

const { HINT_DELAY_MS, HINT_MS, NikolausGreeting, NikolausShelf, NikolausTabIcon, NikolausWidget, OPEN_AFTER_MS, requestBootOpen, resetBootOpenRequest, resetBootState } = require("./index");
const { CARD_MS, OPEN_MS } = require("./boot");
const { SEASON_MODULES, SeasonShelfSlot, appNamesSeason } = require("../SeasonStage");

const STICKER = { id: "fluent-ogre", pack_id: "fluent-nikolaus", pack_name: "Vom Nikolaus", name: "Krampus", url: "/api/stickers/files/fluent/ogre.png", width: 256, height: 256 };

function niko(overrides: Record<string, unknown> = {}) {
  return { key: "nikolaus", label: "Nikolaus", phase: "stiefel", intensity: "normal", effective: "normal", channels: ["web", "app"], texts: { greeting: "Der Nikolaus war da" }, data: {}, starts_at: "2026-12-06T00:00:00+01:00", ends_at: "2026-12-06T23:59:59+01:00", forced: false, ...overrides };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  resetBootState();
  resetBootOpenRequest();
  mockApi.get.mockReset();
  mockApi.post.mockReset();
  mockNavigate.mockReset();
  mockAuthState.user = null;
  mockSeasonState.seasons = [];
  mockSeasonState.reducedMotion = false;
  (Haptics.notificationAsync as jest.Mock).mockClear();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test("Nikolaus ist ein Modul der App: Stiefel im Kopf von „Mehr“, Hinweis, Tab-Symbol - und steht unter „Gerade läuft“", async () => {
  expect(Object.keys(SEASON_MODULES.nikolaus).sort()).toEqual(["Greeting", "Shelf", "TabIcon", "Widget", "compactWidget"]);
  expect(appNamesSeason({ key: "nikolaus" })).toBe(true);
  await render(<NikolausTabIcon size={22} />);
  expect(screen.getByTestId("nikolaus-boot-svg")).toBeTruthy();
});

test("angemeldet: Antippen wackelt, der Gutschein steigt, dann die Karte mit dem neuen Sticker - danach benutzt", async () => {
  jest.useFakeTimers();
  mockAuthState.user = { id: "u1" };
  mockApi.get.mockResolvedValue({ data: { active: true, year: 2026, opened: false, sticker: null } });
  mockApi.post.mockResolvedValue({ data: { year: 2026, new: true, sticker: STICKER } });
  const parallel = jest.spyOn(Animated, "parallel");
  await render(<NikolausShelf season={niko()} screen="MoreHub" />);
  await flush();
  expect(mockApi.get).toHaveBeenCalledWith("/seasonal/nikolaus");
  const boot = screen.getByTestId("nikolaus-boot");
  expect(boot.props.accessibilityLabel).toBe("Nikolausstiefel öffnen");
  expect(screen.getByTestId("nikolaus-voucher")).toBeTruthy();
  await fireEvent.press(boot);
  await flush();
  expect(mockApi.post).toHaveBeenCalledWith("/seasonal/nikolaus/open");
  expect(parallel).toHaveBeenCalledTimes(1);
  expect(Haptics.impactAsync).toHaveBeenCalled();
  expect(screen.queryByTestId("nikolaus-card")).toBeNull();
  await advance(OPEN_MS);
  expect(screen.getByTestId("nikolaus-card")).toBeTruthy();
  expect(screen.getByText("Krampus")).toBeTruthy();
  expect(screen.getByTestId("nikolaus-card-text")).toHaveTextContent("Neu in deinen Stickern – im Chat unter „Vom Nikolaus“.");
  expect(screen.getByTestId("nikolaus-card-sticker").props.source.uri).toContain("/api/stickers/files/fluent/ogre.png");
  expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
  expect(screen.queryByTestId("nikolaus-voucher")).toBeNull();
  expect(screen.getByTestId("nikolaus-boot").props.accessibilityLabel).toContain("schon geöffnet");
  await advance(CARD_MS);
  expect(screen.queryByTestId("nikolaus-card")).toBeNull();
});

test("heuer schon geöffnet: benutzt, Antippen zeigt denselben Sticker - ohne Erfolgs-Tippen; Antippen der Karte schließt", async () => {
  jest.useFakeTimers();
  mockAuthState.user = { id: "u1" };
  mockApi.get.mockResolvedValue({ data: { active: true, year: 2026, opened: true, sticker: STICKER } });
  mockApi.post.mockResolvedValue({ data: { year: 2026, new: false, sticker: STICKER } });
  await render(<NikolausShelf season={niko()} screen="MoreHub" />);
  await flush();
  expect(screen.queryByTestId("nikolaus-voucher")).toBeNull();
  await fireEvent.press(screen.getByTestId("nikolaus-boot"));
  await flush();
  await advance(OPEN_MS);
  expect(screen.getByTestId("nikolaus-card-text")).toHaveTextContent(/Den hat dir der Nikolaus heuer gebracht/);
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId("nikolaus-card"));
  expect(screen.queryByTestId("nikolaus-card")).toBeNull();
});

test("ohne Konto (Gast) kein Aufruf am Server - die Karte sagt, dass Angemeldete einen Sticker finden", async () => {
  jest.useFakeTimers();
  mockAuthState.user = { id: "live-guest" };
  const { LIVE_GUEST_USER_ID } = require("../../live");
  mockAuthState.user = { id: LIVE_GUEST_USER_ID };
  await render(<NikolausShelf season={niko()} screen="MoreHub" />);
  await flush();
  await fireEvent.press(screen.getByTestId("nikolaus-boot"));
  await flush();
  await advance(OPEN_MS);
  expect(mockApi.get).not.toHaveBeenCalled();
  expect(mockApi.post).not.toHaveBeenCalled();
  expect(screen.getByTestId("nikolaus-card-text")).toHaveTextContent("Wer angemeldet ist, findet im Stiefel einen Sticker.");
});

test("am falschen Tag „kommt am 6. Dezember“, bei Netzfehlern „klemmt“ - der Gutschein bleibt drin", async () => {
  jest.useFakeTimers();
  mockAuthState.user = { id: "u1" };
  mockApi.get.mockResolvedValue({ data: { active: false, opened: false, sticker: null } });
  mockApi.post.mockRejectedValueOnce({ response: { status: 409 } }).mockRejectedValueOnce(new Error("offline"));
  await render(<NikolausShelf season={niko()} screen="MoreHub" />);
  await flush();
  await fireEvent.press(screen.getByTestId("nikolaus-boot"));
  await flush();
  await advance(OPEN_MS);
  expect(screen.getByText("Der Nikolaus kommt am 6. Dezember")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("nikolaus-boot"));
  await flush();
  await advance(OPEN_MS);
  expect(screen.getByTestId("nikolaus-card-text")).toHaveTextContent(/klemmt/);
  expect(screen.getByTestId("nikolaus-voucher")).toBeTruthy();
});

test("„dezent“: kein Wackeln, kein Wippen - die Karte steht gleich da", async () => {
  jest.useFakeTimers();
  mockAuthState.user = { id: "u1" };
  mockApi.get.mockResolvedValue({ data: { active: true, year: 2026, opened: false, sticker: null } });
  mockApi.post.mockResolvedValue({ data: { year: 2026, new: true, sticker: STICKER } });
  const loop = jest.spyOn(Animated, "loop");
  const parallel = jest.spyOn(Animated, "parallel");
  await render(<NikolausShelf season={niko({ effective: "subtle" })} screen="MoreHub" />);
  await flush();
  await fireEvent.press(screen.getByTestId("nikolaus-boot"));
  await flush();
  await advance(0);
  expect(screen.getByText("Krampus")).toBeTruthy();
  expect(loop).not.toHaveBeenCalled();
  expect(parallel).not.toHaveBeenCalled();
});

test("Hinweis: einmal am Tag nach kurzer Zeit, „Zum Stiefel“ führt in den Tab „Mehr“", async () => {
  jest.useFakeTimers({ now: new Date(2026, 11, 6, 9, 0) });
  await render(<NikolausGreeting season={niko()} screen="Dashboard" />);
  await flush();
  expect(screen.queryByTestId("nikolaus-hint")).toBeNull();
  await advance(HINT_DELAY_MS);
  expect(screen.getByText("Der Nikolaus war da")).toBeTruthy();
  expect(screen.getByText("Im Tab „Mehr“ steht ein Stiefel. Wer angemeldet ist, findet darin einen Sticker.")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("nikolaus-hint-go"));
  expect(mockNavigate).toHaveBeenCalledWith("More", { screen: "MoreHub" });
  expect(screen.queryByTestId("nikolaus-hint")).toBeNull();
  await screen.unmount();
  await render(<NikolausGreeting season={niko()} screen="Dashboard" />);
  await flush();
  await advance(HINT_DELAY_MS + HINT_MS);
  expect(screen.queryByTestId("nikolaus-hint")).toBeNull();
});

test("Hinweis nicht im Tab „Mehr“ (dort steht der Stiefel) und nicht für wen, der schon geöffnet hat", async () => {
  jest.useFakeTimers({ now: new Date(2026, 11, 6, 9, 0) });
  await render(<NikolausGreeting season={niko()} screen="MoreHub" />);
  await flush();
  await advance(HINT_DELAY_MS * 2);
  expect(screen.queryByTestId("nikolaus-hint")).toBeNull();
  await screen.unmount();
  mockAuthState.user = { id: "u1" };
  mockApi.get.mockResolvedValue({ data: { active: true, year: 2026, opened: true, sticker: STICKER } });
  await render(<NikolausGreeting season={niko()} screen="Dashboard" />);
  await flush();
  await advance(HINT_DELAY_MS * 2);
  expect(screen.queryByTestId("nikolaus-hint")).toBeNull();
});

test("Platz im Kopf von „Mehr“: der Stiefel steht mit der Sohle auf der Kante der ersten Karte; ohne Saison nichts", async () => {
  mockSeasonState.seasons = [niko()];
  await render(<SeasonShelfSlot />);
  const shelf = screen.getByTestId("nikolaus-shelf");
  expect(StyleSheet.flatten(shelf.props.style)).toMatchObject({ position: "absolute", bottom: -18 });
  await screen.unmount();
  mockSeasonState.seasons = [niko({ effective: "off" })];
  await render(<SeasonShelfSlot />);
  expect(screen.queryByTestId("nikolaus-shelf")).toBeNull();
});

test("#852: der Stiefel im Dashboard-Kopf führt zu „Mehr“ - dort öffnet er sich kurz danach von selbst, einmal", async () => {
  jest.useFakeTimers();
  mockAuthState.user = { id: "u3" };
  mockApi.get.mockResolvedValue({ data: { active: true, year: 2026, opened: false, sticker: null } });
  mockApi.post.mockResolvedValue({ data: { year: 2026, new: true, sticker: STICKER } });
  await render(<NikolausWidget season={niko()} screen="Dashboard" />);
  expect(screen.getByTestId("nikolaus-widget").props.accessibilityLabel).toBe("Der Nikolaus war da – zum Stiefel");
  await fireEvent.press(screen.getByTestId("nikolaus-widget"));
  expect(mockNavigate).toHaveBeenCalledWith("More", { screen: "MoreHub" });
  await screen.unmount();
  await render(<NikolausShelf season={niko()} screen="MoreHub" />);
  await flush();
  expect(mockApi.post).not.toHaveBeenCalled();
  await advance(OPEN_AFTER_MS);
  await flush();
  expect(mockApi.post).toHaveBeenCalledTimes(1);
  await screen.unmount();
  // Die Bitte gilt einmal - beim nächsten Besuch steht der Stiefel einfach da.
  mockApi.post.mockClear();
  await render(<NikolausShelf season={niko()} screen="MoreHub" />);
  await flush();
  await advance(OPEN_AFTER_MS * 4);
  expect(mockApi.post).not.toHaveBeenCalled();
  expect(screen.queryByTestId("nikolaus-card")).toBeNull();
  // Neue Bitte, während „Mehr“ offen ist: der Stiefel öffnet sich wieder und zeigt seine Karte.
  await act(async () => {
    requestBootOpen();
  });
  await advance(OPEN_AFTER_MS);
  await flush();
  await advance(OPEN_MS);
  await flush();
  expect(screen.getByTestId("nikolaus-card")).toBeTruthy();
  expect(mockApi.post).toHaveBeenCalledTimes(1);
});
