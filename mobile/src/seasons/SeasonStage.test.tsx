import React from "react";
import { StyleSheet, Text } from "react-native";
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";

// Die Bühne in der App (#636, #655): ohne Saison nichts, mit Halloween Ecken und Widget, Tab-Symbol nur dann,
// der Gruß als Overlay-Karte; der Deko-Schalter zeigt die eigene Wahl und stellt um.

const mockSeasonState: Record<string, unknown> = { ready: true, seasons: [], byKey: {}, preference: "on", setPreference: jest.fn(async () => {}), reducedMotion: false, reload: jest.fn(), toast: null, showToast: jest.fn() };
jest.mock("./SeasonProvider", () => ({ useSeason: () => mockSeasonState }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }) }));
const mockNavigate = jest.fn();
jest.mock("../navigation/rootNavigation", () => ({ navigationRef: { isReady: () => true, getCurrentRoute: () => ({ name: "Dashboard" }), addListener: () => () => {}, navigate: (...args: unknown[]) => mockNavigate(...args) } }));

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
  mockSeasonState.seasons = [halloween("normal"), { ...halloween("normal"), key: "carnival", label: "Fasching" }, { ...halloween("normal"), key: "easter", label: "Ostern" }, { ...halloween("normal"), key: "nikolaus", label: "Nikolaus" }, { ...halloween("normal"), key: "snow", label: "Schneefall" }, { ...halloween("normal"), key: "advent_calendar", label: "Adventkalender" }, { ...halloween("normal"), key: "weather", label: "Wetter" }];
  await render(<DecoSetting />);
  // Schnee kann die App seit #642, Nikolaus seit #736, Fasching seit #643, Ostern seit #645. Das Wetter ist nur Himmel
  // und keine Saison zum Nennen (#771).
  expect(screen.getByText(/Gerade läuft: Halloween, Fasching, Ostern, Nikolaus, Schneefall, Adventkalender\./)).toBeTruthy();
  expect(screen.queryByText(/Wetter/)).toBeNull();
  await fireEvent.press(screen.getByText("Dezent"));
  expect(mockSeasonState.setPreference).toHaveBeenCalledWith("subtle");
});

test("mehrere Widgets im Kopf stehen übereinander, die Schneeflocke oben - der Name behält seinen Platz", async () => {
  mockSeasonState.seasons = [{ ...halloween("normal"), key: "advent", label: "Adventkranz", data: { candles: 2 } }, { ...halloween("normal"), key: "snow", label: "Schneefall" }];
  await render(<SeasonWidgetSlot />);
  const slot = screen.getByTestId("season-widget-slot");
  expect(StyleSheet.flatten(slot.props.style).flexDirection).toBe("column");
  expect(slot.props.children[0][0].key).toBe("snow");
  await screen.unmount();
  mockSeasonState.seasons = [halloween("normal")];
  await render(<SeasonWidgetSlot />);
  expect(StyleSheet.flatten(screen.getByTestId("season-widget-slot").props.style).flexDirection).toBe("row");
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

test("#852: Türchen und Stiefel klein in einer Reihe unter dem Kranz - ein Tipp öffnet Kalender bzw. führt zum Stiefel", async () => {
  const advent = { ...halloween("normal"), key: "advent", label: "Adventkranz", data: { candles: 2 } };
  const calendar = { ...halloween("normal"), key: "advent_calendar", label: "Adventkalender", data: { today_door: 6, door_hour: 6, ready: true, catch_up: false } };
  const nikolaus = { ...halloween("normal"), key: "nikolaus", label: "Nikolaus", texts: { greeting: "Der Nikolaus war da" } };
  mockSeasonState.seasons = [advent, calendar, nikolaus];
  await render(<SeasonWidgetSlot />);
  const slot = screen.getByTestId("season-widget-slot");
  expect(StyleSheet.flatten(slot.props.style).flexDirection).toBe("column");
  const row = screen.getByTestId("season-widget-row");
  expect(StyleSheet.flatten(row.props.style).flexDirection).toBe("row");
  expect(within(row).getByTestId("advent-calendar-widget").props.accessibilityLabel).toBe("Adventkalender – Türchen 6 ist offen");
  await fireEvent.press(within(row).getByTestId("advent-calendar-widget"));
  expect(mockNavigate).toHaveBeenLastCalledWith("More", { screen: "AdventCalendar", initial: false });
  await fireEvent.press(within(row).getByTestId("nikolaus-widget"));
  expect(mockNavigate).toHaveBeenLastCalledWith("More", { screen: "MoreHub" });
  await screen.unmount();
  // Ohne angelegte Türchen kein Türchen; der Kranz allein steht wie bisher.
  mockSeasonState.seasons = [advent, { ...calendar, data: { ready: false } }];
  await render(<SeasonWidgetSlot />);
  expect(screen.queryByTestId("advent-calendar-widget")).toBeNull();
});
