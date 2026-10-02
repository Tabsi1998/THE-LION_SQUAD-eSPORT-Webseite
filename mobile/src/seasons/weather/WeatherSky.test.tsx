import React from "react";
import { act, render, screen } from "@testing-library/react-native";

// Das Wetter in der App (#771): Regen, leichter Schnee und Wetterleuchten nach dem echten Wetter - in der Schnee-Saison
// übernimmt der Schnee; ohne Niederschlag, bei „Bewegung reduzieren“, „dezent“ und auf stillen Screens nichts.

jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../signals", () => ({ recordSignal: jest.fn(async () => true) }));
const mockSeasonState: Record<string, unknown> = { reducedMotion: false, showToast: jest.fn(), weather: null, seasons: [] };
jest.mock("../SeasonProvider", () => ({ useSeason: () => mockSeasonState }));

const { WeatherSky } = require("./index");
const { createMotionScheduler, resetMotionScheduler } = require("../motion");
const { FLASH_GAP, FLASH_SECONDS } = require("./storm");

function season(key: string, effective = "normal") {
  return { key, label: key, phase: key, intensity: "normal", effective, channels: ["app"], texts: {}, data: {}, starts_at: "", ends_at: "", forced: false };
}

const RAIN = { rain_mm: 1.2, snow_cm: 0, wind_factor: 0.9, wind_dir: 270, night: false, stale: false };

beforeEach(() => {
  resetMotionScheduler(createMotionScheduler({ unlimited: true, appState: null }));
  mockSeasonState.reducedMotion = false;
  mockSeasonState.weather = null;
  mockSeasonState.seasons = [season("weather")];
});

afterEach(() => {
  jest.useRealTimers();
});

afterAll(() => resetMotionScheduler(null));

test("es regnet draußen: Regen im Screen, kein Blitz ohne Gewitter", async () => {
  mockSeasonState.weather = RAIN;
  await render(<WeatherSky season={season("weather")} screen="Dashboard" reducedMotion={false} />);
  expect(screen.getByTestId("weather-rain")).toBeTruthy();
  expect(screen.getAllByTestId(/^rain-drop-\d+$/).length).toBeGreaterThan(0);
  expect(screen.queryByTestId("weather-snow")).toBeNull();
});

test("es schneit draußen außerhalb der Saison: leichter Schnee; in der Schnee-Saison schneit das Schnee-Modul, nicht das Wetter", async () => {
  mockSeasonState.weather = { ...RAIN, rain_mm: 0, snow_cm: 1 };
  await render(<WeatherSky season={season("weather")} screen="Dashboard" reducedMotion={false} />);
  expect(screen.getByTestId("weather-snow")).toBeTruthy();
  await screen.unmount();
  mockSeasonState.seasons = [season("weather"), season("snow")];
  mockSeasonState.weather = RAIN;
  await render(<WeatherSky season={season("weather")} screen="Dashboard" reducedMotion={false} />);
  expect(screen.queryByTestId("weather-rain")).toBeNull();
  expect(screen.queryByTestId("weather-snow")).toBeNull();
});

test("trocken, „Bewegung reduzieren“, „dezent“ und stille Screens: nichts", async () => {
  mockSeasonState.weather = { ...RAIN, rain_mm: 0 };
  await render(<WeatherSky season={season("weather")} screen="Dashboard" reducedMotion={false} />);
  expect(screen.toJSON()).toBeNull();
  await screen.unmount();
  mockSeasonState.weather = RAIN;
  await render(<WeatherSky season={season("weather")} screen="Dashboard" reducedMotion />);
  expect(screen.toJSON()).toBeNull();
  await screen.unmount();
  await render(<WeatherSky season={season("weather", "subtle")} screen="Dashboard" reducedMotion={false} />);
  expect(screen.toJSON()).toBeNull();
  await screen.unmount();
  await render(<WeatherSky season={season("weather")} screen="Settings" reducedMotion={false} />);
  expect(screen.toJSON()).toBeNull();
});

test("Gewitter: frühestens nach acht Sekunden ein Wetterleuchten, nach einem Augenblick wieder weg", async () => {
  jest.useFakeTimers();
  mockSeasonState.weather = { ...RAIN, rain_mm: 2.5, code: 95 };
  await render(<WeatherSky season={season("weather")} screen="Dashboard" reducedMotion={false} />);
  expect(screen.getByTestId("weather-rain")).toBeTruthy();
  let firstAt = -1;
  for (let ms = 100; ms <= FLASH_GAP[1] * 1000 + 200 && firstAt < 0; ms += 100) {
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    if (screen.queryByTestId("weather-lightning")) firstAt = ms;
  }
  expect(firstAt).toBeGreaterThanOrEqual(FLASH_GAP[0] * 1000);
  expect(firstAt).toBeLessThanOrEqual(FLASH_GAP[1] * 1000 + 100);
  await act(async () => {
    jest.advanceTimersByTime(FLASH_SECONDS * 1000 + 200);
  });
  expect(screen.queryByTestId("weather-lightning")).toBeNull();
});
