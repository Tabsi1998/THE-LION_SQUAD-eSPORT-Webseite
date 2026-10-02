import React from "react";
import { Animated, StyleSheet } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";

// Schnee in der App (#642): Flocken je Screen nach seiner Klasse, dichter mit Schnee oder Regen draußen; „Bewegung
// reduzieren“, „dezent“ und stille Screens ohne Schneefall. Die Schneeflocke im Kopf zum Fangen zählt als
// Saison-Fundstück (#678), fünfzig ergeben den Schneekönig.

const mockSignals = { recordSignal: jest.fn(async () => true) };
jest.mock("../signals", () => mockSignals);
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }) }));
const mockSeasonState: Record<string, unknown> = { reducedMotion: false, showToast: jest.fn(), weather: null, seasons: [] };
jest.mock("../SeasonProvider", () => ({ useSeason: () => mockSeasonState }));

const { CLICKS_KEY, SNOW_KING_AT, SNOW_SIGNAL, SnowSky, SnowflakeWidget, skyBudget, snowShare } = require("./index");

function snowSeason(effective = "normal") {
  return { key: "snow", label: "Schneefall", phase: "schnee", intensity: "normal", effective, channels: ["app"], texts: {}, data: {}, starts_at: "2026-11-29T00:00:00+01:00", ends_at: "2027-01-06T23:59:59+01:00", forced: false };
}

function visible() {
  return screen.getAllByTestId(/^snow-flake-\d+$/).filter((node) => (StyleSheet.flatten(node.props.style).opacity || 0) > 0).length;
}

beforeEach(() => {
  mockSeasonState.reducedMotion = false;
  mockSeasonState.weather = null;
  (mockSeasonState.showToast as jest.Mock).mockClear();
  mockSignals.recordSignal.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("Teilchen wie im Web: „dezent“ nichts, „normal“ 30, „kräftig“ 60; Anteil nach Screen-Klasse", () => {
  expect([skyBudget("subtle"), skyBudget("normal"), skyBudget("full"), skyBudget("off")]).toEqual([0, 30, 60, 0]);
  expect(snowShare("Dashboard")).toBe(1);
  expect(snowShare("More")).toBe(0.6);
  expect(snowShare("Settings")).toBe(0);
});

test("im Dashboard schneit es leicht (55 %), mit Schnee draußen dichter (125 %) - die Plätze reichen für beides", async () => {
  await render(<SnowSky season={snowSeason()} screen="Dashboard" reducedMotion={false} />);
  expect(screen.getByTestId("snow-sky")).toBeTruthy();
  expect(screen.getAllByTestId(/^snow-flake-\d+$/)).toHaveLength(38);
  expect(visible()).toBe(17);
  await screen.unmount();
  mockSeasonState.weather = { snow_cm: 2, rain_mm: 0, wind_factor: 1.2, wind_dir: 250 };
  await render(<SnowSky season={snowSeason("full")} screen="Dashboard" reducedMotion={false} />);
  expect(screen.getAllByTestId(/^snow-flake-\d+$/)).toHaveLength(75);
  expect(visible()).toBe(75);
});

test("„Bewegung reduzieren“, „dezent“ und stille Screens: kein Schneefall", async () => {
  await render(<SnowSky season={snowSeason()} screen="Dashboard" reducedMotion />);
  expect(screen.queryByTestId("snow-sky")).toBeNull();
  await screen.unmount();
  await render(<SnowSky season={snowSeason("subtle")} screen="Dashboard" reducedMotion={false} />);
  expect(screen.queryByTestId("snow-sky")).toBeNull();
  await screen.unmount();
  await render(<SnowSky season={snowSeason()} screen="Settings" reducedMotion={false} />);
  expect(screen.queryByTestId("snow-sky")).toBeNull();
});

test("Schneeflocke fangen: zählt als Fundstück, merkt sich die Zahl am Gerät, Splitter fliegen", async () => {
  const timing = jest.spyOn(Animated, "timing");
  await render(<SnowflakeWidget season={snowSeason()} screen="Dashboard" />);
  await fireEvent.press(screen.getByTestId("snow-flake-widget"));
  expect(mockSignals.recordSignal).toHaveBeenCalledWith(SNOW_SIGNAL, { onceIf: false });
  expect(SNOW_SIGNAL).toBe("snowflakes_clicked");
  expect(await SecureStore.getItemAsync(CLICKS_KEY)).toBe("1");
  expect(screen.getByLabelText("Schneeflocke fangen – 1 von 50")).toBeTruthy();
  expect(timing.mock.calls.some(([, config]) => (config as { duration?: number }).duration === 650)).toBe(true);
});

test("fünfzig Flocken: der Schneekönig als Gruß-Karte; „Bewegung reduzieren“: kein Drehen, keine Splitter", async () => {
  await SecureStore.setItemAsync(CLICKS_KEY, String(SNOW_KING_AT - 1));
  mockSeasonState.reducedMotion = true;
  const loop = jest.spyOn(Animated, "loop");
  const timing = jest.spyOn(Animated, "timing");
  await render(<SnowflakeWidget season={snowSeason()} screen="Dashboard" />);
  await screen.findByLabelText(`Schneeflocke fangen – ${SNOW_KING_AT - 1} von 50`);
  await fireEvent.press(screen.getByTestId("snow-flake-widget"));
  expect(mockSeasonState.showToast).toHaveBeenCalledWith("Fünfzig Flocken gefangen – Schneekönig!", 5000);
  expect(screen.getByLabelText("Schneeflocke – Schneekönig mit 50 Flocken")).toBeTruthy();
  expect(loop).not.toHaveBeenCalled();
  expect(timing).not.toHaveBeenCalled();
});
