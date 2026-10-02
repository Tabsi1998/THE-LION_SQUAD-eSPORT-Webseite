import React from "react";
import { Text } from "react-native";
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";

// Die Bühne in der App (#636, #655): ohne Saison nichts, mit Halloween Ecken und Widget, Tab-Symbol nur dann,
// der Gruß als Overlay-Karte; der Deko-Schalter zeigt die eigene Wahl und stellt um.

const mockSeasonState: Record<string, unknown> = { ready: true, seasons: [], byKey: {}, preference: "on", setPreference: jest.fn(async () => {}), reducedMotion: false, reload: jest.fn(), toast: null, showToast: jest.fn() };
jest.mock("./SeasonProvider", () => ({ useSeason: () => mockSeasonState }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../navigation/rootNavigation", () => ({ navigationRef: { isReady: () => true, getCurrentRoute: () => ({ name: "Dashboard" }), addListener: () => () => {} } }));

const { SeasonStage, SeasonWidgetSlot, useSeasonTabIcon } = require("./SeasonStage");
const { DecoSetting } = require("./DecoSetting");

function TabIconProbe() {
  const Icon = useSeasonTabIcon();
  return Icon ? <Icon size={20} /> : <Text testID="no-icon">kein Symbol</Text>;
}

function halloween(effective: string) {
  return { key: "halloween", label: "Halloween", phase: "deko", intensity: "normal", effective, channels: ["app"], texts: {}, data: {} };
}

beforeEach(() => {
  mockSeasonState.seasons = [];
  mockSeasonState.toast = null;
  (mockSeasonState.setPreference as jest.Mock).mockClear();
});

test("ohne Saison bleibt alles leer", async () => {
  await render(<><SeasonStage /><SeasonWidgetSlot /><TabIconProbe /></>);
  expect(screen.queryByTestId("season-stage")).toBeNull();
  expect(screen.queryByTestId("season-widget-slot")).toBeNull();
  expect(screen.getByTestId("no-icon")).toBeTruthy();
});

test("mit Halloween: Bühne, Ecken, Widget und Tab-Symbol", async () => {
  mockSeasonState.seasons = [halloween("normal")];
  await render(<><SeasonStage /><SeasonWidgetSlot /><TabIconProbe /></>);
  expect(screen.getByTestId("season-stage")).toBeTruthy();
  expect(screen.getByTestId("halloween-corners")).toBeTruthy();
  expect(screen.getByTestId("halloween-lantern")).toBeTruthy();
  expect(screen.queryByTestId("no-icon")).toBeNull();
});

test("der Gruß erscheint als Overlay-Karte, auch ohne aktive Saison", async () => {
  mockSeasonState.toast = { id: 1, text: "Happy Halloween von THE LION SQUAD" };
  await render(<SeasonStage />);
  expect(screen.getByTestId("season-toast")).toHaveTextContent("Happy Halloween von THE LION SQUAD");
});

test("„aus“ zeigt nichts", async () => {
  mockSeasonState.seasons = [halloween("off")];
  await render(<><SeasonStage /><SeasonWidgetSlot /></>);
  expect(screen.queryByTestId("season-stage")).toBeNull();
  expect(screen.queryByTestId("season-widget-slot")).toBeNull();
});

test("Deko-Schalter nennt die laufende Saison und stellt um - nur Saisonen, die die App zeigen kann", async () => {
  mockSeasonState.seasons = [halloween("normal"), { ...halloween("normal"), key: "nikolaus", label: "Nikolaus" }, { ...halloween("normal"), key: "snow", label: "Schneefall" }, { ...halloween("normal"), key: "advent_calendar", label: "Adventkalender" }, { ...halloween("normal"), key: "weather", label: "Wetter" }];
  await render(<DecoSetting />);
  // Schnee kann die App seit #642; das Wetter ist nur Himmel und keine Saison zum Nennen (#771).
  expect(screen.getByText(/Gerade läuft: Halloween, Schneefall, Adventkalender\./)).toBeTruthy();
  expect(screen.queryByText(/Nikolaus/)).toBeNull();
  expect(screen.queryByText(/Wetter/)).toBeNull();
  await fireEvent.press(screen.getByText("Dezent"));
  expect(mockSeasonState.setPreference).toHaveBeenCalledWith("subtle");
});

test("Töne unter Darstellung: Vorgabe an wie im Web, „Aus“ merkt sich das Gerät", async () => {
  const { SOUND_KEY, readSoundsOn, resetSounds } = require("./sound/player");
  resetSounds();
  await SecureStore.deleteItemAsync(SOUND_KEY);
  await render(<DecoSetting />);
  expect(screen.getByText(/die Katze miaut/)).toBeTruthy();
  await fireEvent.press(within(screen.getByTestId("season-sound-setting")).getByText("Aus"));
  expect(await SecureStore.getItemAsync(SOUND_KEY)).toBe("off");
  expect(await readSoundsOn()).toBe(false);
  await fireEvent.press(within(screen.getByTestId("season-sound-setting")).getByText("An"));
  expect(await readSoundsOn()).toBe(true);
});
