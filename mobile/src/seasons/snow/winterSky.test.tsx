import React from "react";
import { render, screen } from "@testing-library/react-native";

// Der Winterhimmel in der App (W4 #730): hinter dem Inhalt jedes Screens - tags nichts, um den Untergang ein warmes
// Glühen, nachts Blauschein und Sterne (lebendige Screens mehr, „dezent“ halb so viele), stille Screens nichts.

const mockSeasonState: Record<string, unknown> = { reducedMotion: false, weather: null, seasons: [] };
jest.mock("../SeasonProvider", () => ({ useSeason: () => mockSeasonState }));
jest.mock("../../navigation/rootNavigation", () => ({ navigationRef: { isReady: () => true, getCurrentRoute: () => ({ name: "Dashboard" }), addListener: () => () => {} } }));

const { WinterSkyBackdrop } = require("./WinterSky");
const { SEASON_MODULES } = require("../SeasonStage");

function snow(overrides: Record<string, unknown> = {}) {
  return { key: "snow", label: "Schnee", phase: "schnee", intensity: "normal", effective: "normal", channels: ["web", "app"], texts: {}, data: { night: false }, starts_at: "2026-11-29T00:00:00+01:00", ends_at: "2027-01-06T23:59:59+01:00", forced: false, ...overrides };
}

beforeEach(() => {
  jest.useFakeTimers();
  mockSeasonState.weather = { sunrise: "2026-12-12T07:45:00+01:00", sunset: "2026-12-12T16:25:00+01:00", code: 0 };
});

afterEach(() => {
  jest.useRealTimers();
});

test("Schnee hat jetzt einen Hintergrund: den Winterhimmel", () => {
  expect(SEASON_MODULES.snow.Backdrop).toBe(WinterSkyBackdrop);
});

test("tags nichts; um den Untergang ein Glühen auf der Seite der Sonne", async () => {
  jest.setSystemTime(Date.parse("2026-12-12T12:00:00+01:00"));
  const day = await render(<WinterSkyBackdrop season={snow()} screen="Dashboard" />);
  expect(screen.queryByTestId("winter-sky")).toBeNull();
  await day.unmount();
  jest.setSystemTime(Date.parse("2026-12-12T16:30:00+01:00"));
  await render(<WinterSkyBackdrop season={snow()} screen="Dashboard" />);
  expect(screen.getByTestId("winter-glow")).toBeTruthy();
});

test("nachts Blauschein und Sterne - lebendig zehn, „dezent“ fünf, bei Schneefall keine; stille Screens nichts", async () => {
  jest.setSystemTime(Date.parse("2026-12-12T21:00:00+01:00"));
  const lively = await render(<WinterSkyBackdrop season={snow()} screen="Dashboard" />);
  expect(screen.getByTestId("winter-tint")).toBeTruthy();
  expect(screen.queryByTestId("winter-glow")).toBeNull();
  expect(screen.getAllByTestId("winter-star")).toHaveLength(10);
  await lively.unmount();
  const subtle = await render(<WinterSkyBackdrop season={snow({ effective: "subtle" })} screen="Dashboard" />);
  expect(screen.getAllByTestId("winter-star").length).toBeLessThanOrEqual(5);
  await subtle.unmount();
  mockSeasonState.weather = { ...(mockSeasonState.weather as object), code: 73 };
  const snowing = await render(<WinterSkyBackdrop season={snow()} screen="Dashboard" />);
  expect(screen.getByTestId("winter-tint")).toBeTruthy();
  expect(screen.queryAllByTestId("winter-star")).toHaveLength(0);
  await snowing.unmount();
  await render(<WinterSkyBackdrop season={snow()} screen="Settings" />);
  expect(screen.queryByTestId("winter-sky")).toBeNull();
});

test("ohne Sonnenzeiten zählt die Nacht der Saison", async () => {
  jest.setSystemTime(Date.parse("2026-12-12T21:00:00+01:00"));
  mockSeasonState.weather = null;
  await render(<WinterSkyBackdrop season={snow({ data: { night: true } })} screen="Dashboard" />);
  expect(screen.getByTestId("winter-tint")).toBeTruthy();
});
