import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";

// Die Schneehaube im Kopf des Dashboards (W3 #729, Entscheidung A): auf der Oberkante der Begrüßungskarte, Stufe
// vom Server, Tauen aus dem Wetter, nie auf stillen Screens, nie klickbar - und sie ist der `Edge` der Saison Schnee.

const mockSeasonState: Record<string, unknown> = { reducedMotion: false, weather: null, seasons: [] };
jest.mock("../SeasonProvider", () => ({ useSeason: () => mockSeasonState }));
jest.mock("../../navigation/rootNavigation", () => ({ navigationRef: { isReady: () => true, getCurrentRoute: () => ({ name: "Dashboard" }), addListener: () => () => {} } }));

const { SnowCap, CAP_INSET } = require("./SnowCap");
const { SEASON_MODULES } = require("../SeasonStage");
const { THICKNESS } = require("./caps");

function snow(overrides: Record<string, unknown> = {}) {
  return { key: "snow", label: "Schnee", phase: "schnee", intensity: "normal", effective: "normal", channels: ["web", "app"], texts: {}, data: { night: false, snowcap_stage: 2 }, starts_at: "2026-11-29T00:00:00+01:00", ends_at: "2027-01-06T23:59:59+01:00", forced: false, ...overrides };
}

async function layout(width = 360) {
  await fireEvent(screen.getByTestId("snow-cap"), "layout", { nativeEvent: { layout: { width, height: 1, x: 0, y: 0 } } });
}

beforeEach(() => {
  mockSeasonState.weather = null;
});

test("Schnee hat eine Kante: die Haube auf der Begrüßungskarte", () => {
  expect(SEASON_MODULES.snow.Edge).toBe(SnowCap);
});

test("auf der Oberkante, so breit wie die Karte minus Einzug, Stufe vom Server; bei Plusgraden taut sie", async () => {
  const cold = await render(<SnowCap season={snow()} screen="Dashboard" />);
  expect(screen.queryByTestId("snow-cap-shape")).toBeNull();
  await layout(360);
  const shape = screen.getByTestId("snow-cap-shape");
  expect(shape.props["data-level"]).toBe("2");
  expect(shape.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ left: CAP_INSET, width: 360 - 2 * CAP_INSET })]));
  expect(Number(shape.props.style[1].top)).toBeLessThan(0);
  await cold.unmount();

  mockSeasonState.weather = { temp_c: 5 };
  await render(<SnowCap season={snow()} screen="Dashboard" />);
  await layout(360);
  expect(screen.getByTestId("snow-cap-shape").props["data-level"]).toBe("1");
});

test("„dezent“ höchstens Stufe 1, stille Screens keine Haube, zu schmal nichts", async () => {
  const subtle = await render(<SnowCap season={snow({ effective: "subtle", data: { snowcap_stage: 3 } })} screen="Dashboard" />);
  await layout(360);
  const shape = screen.getByTestId("snow-cap-shape");
  expect(shape.props["data-level"]).toBe("3");
  expect(Number(shape.props.style[1].height)).toBeLessThanOrEqual(THICKNESS[1] * 1.3 + 1.6 + 8.5 + 2);
  await subtle.unmount();

  const quiet = await render(<SnowCap season={snow()} screen="Settings" />);
  expect(quiet.toJSON()).toBeNull();
  await quiet.unmount();

  await render(<SnowCap season={snow()} screen="Dashboard" />);
  await layout(12);
  expect(screen.queryByTestId("snow-cap-shape")).toBeNull();
});
