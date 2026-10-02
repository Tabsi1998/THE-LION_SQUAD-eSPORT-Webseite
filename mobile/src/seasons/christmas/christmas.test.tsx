import React from "react";
import { Animated, AppState, Linking, StyleSheet } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";

// Weihnachten in der App (S11, #642): die Lichterkette an der Unterkante der Begrüßungskarte (nur an den Feiertagen,
// nicht auf stillen Screens; „dezent“ ohne Glimmen und Wind), warme Lichtinseln hinter dem Inhalt, der Gruß einmal je
// Tag über der Tab-Leiste - nicht auf stillen Screens und nicht über einem Dialog, am 6. Jänner der Abschied mit Link.

const mockSeasonState: Record<string, unknown> = { ready: true, seasons: [], byKey: {}, preference: "on", setPreference: jest.fn(async () => {}), reducedMotion: false, reload: jest.fn(), toast: null, showToast: jest.fn(), weather: null };
jest.mock("../SeasonProvider", () => ({ useSeason: () => mockSeasonState }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }) }));
jest.mock("../../navigation/rootNavigation", () => ({ navigationRef: { isReady: () => true, getCurrentRoute: () => ({ name: "Dashboard" }), addListener: () => () => {} } }));

const { ChristmasBackdrop, ChristmasEdge, ChristmasGreeting, chainWind } = require("./index");
const { TOAST_DELAY_MS, TOAST_MS } = require("./greeting");
const { chainLayout } = require("./lights");
const { LAYER_HEIGHT, bulbStartDelay, flickerCurve, pulseCurve, restingOpacity } = require("./LightChain");
const { SEASON_MODULES, SeasonBackdropSlot, SeasonEdgeSlot, SeasonStage, appNamesSeason } = require("../SeasonStage");
const { resetQuiet, setOverlay } = require("../quiet");
const { WEB_BASE_URL } = require("../../advent/links");

function xmas(overrides: Record<string, unknown> = {}) {
  return {
    key: "christmas",
    label: "Weihnachten",
    phase: "gruss",
    intensity: "normal",
    effective: "normal",
    channels: ["web", "app"],
    texts: { greeting: "Frohe Weihnachten wünscht THE LION SQUAD", farewell: "Danke fürs Mitfeiern", farewell_link: "/news/rueckblick" },
    data: {},
    starts_at: "2026-12-24T00:00:00+01:00",
    ends_at: "2026-12-26T23:59:59+01:00",
    forced: false,
    ...overrides,
  };
}

async function layoutEdge(width = 354) {
  await fireEvent(screen.getByTestId("christmas-edge"), "layout", { nativeEvent: { layout: { x: 0, y: 0, width, height: LAYER_HEIGHT } } });
}

function opacityOf(node: { props: Record<string, unknown> }): number {
  return (StyleSheet.flatten(node.props.style as never) as { opacity?: number }).opacity as number;
}

async function flushStorage() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  mockSeasonState.seasons = [];
  mockSeasonState.reducedMotion = false;
  mockSeasonState.weather = null;
  resetQuiet();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test("Weihnachten ist ein Modul der App mit Kette, Gruß und Lichtinseln und steht unter „Gerade läuft“", () => {
  expect(Object.keys(SEASON_MODULES.christmas).sort()).toEqual(["Backdrop", "Edge", "Greeting"]);
  expect(appNamesSeason({ key: "christmas" })).toBe(true);
});

test("Kette an der Begrüßungskarte: Lämpchen wie die Rechnung, Band 16 Punkte über der Unterkante; Glimmen und Wind laufen", async () => {
  const loop = jest.spyOn(Animated, "loop");
  await render(<ChristmasEdge season={xmas()} screen="Dashboard" />);
  const edge = screen.getByTestId("christmas-edge");
  expect(StyleSheet.flatten(edge.props.style)).toMatchObject({ position: "absolute", bottom: 16 - LAYER_HEIGHT, height: LAYER_HEIGHT });
  expect(edge.props.pointerEvents).toBe("none");
  await layoutEdge(354);
  const expected = chainLayout({ width: 354, year: "2026", anchor: "header" });
  const bulbs = screen.getAllByTestId("christmas-bulb", { includeHiddenElements: true });
  expect(bulbs).toHaveLength(expected.bulbs.length);
  // Ein Takt je Lämpchen und einer für den Wind - jedes beginnt am unteren Ende seiner Runde.
  expect(loop).toHaveBeenCalledTimes(expected.bulbs.length + 1);
  expected.bulbs.forEach((bulb: { brightness: number; flicker: boolean }, index: number) => {
    expect(opacityOf(bulbs[index])).toBeCloseTo(bulb.flicker ? bulb.brightness : bulb.brightness * 0.85, 2);
  });
});

test("„dezent“: Kette ruhig und gedämpft, kein Glimmen, kein Wind", async () => {
  const loop = jest.spyOn(Animated, "loop");
  await render(<ChristmasEdge season={xmas({ effective: "subtle" })} screen="Dashboard" />);
  await layoutEdge(354);
  expect(loop).not.toHaveBeenCalled();
  expect(opacityOf(screen.getByTestId("christmas-lights", { includeHiddenElements: true }))).toBe(0.9);
  screen.getAllByTestId("christmas-bulb", { includeHiddenElements: true }).forEach((bulb) => expect(opacityOf(bulb)).toBe(0.9));
});

test("keine Kette am 6. Jänner (nur der Abschied), keine auf stillen Screens", async () => {
  await render(<ChristmasEdge season={xmas({ phase: "abschied" })} screen="Dashboard" />);
  expect(screen.queryByTestId("christmas-edge")).toBeNull();
  await screen.unmount();
  await render(<ChristmasEdge season={xmas()} screen="Settings" />);
  expect(screen.queryByTestId("christmas-edge")).toBeNull();
});

test("Takt und Ruhe: Kosinus-Runde, Flackern gegen Ende, Start nach dem Versatz aus dem Seed, Wind aus dem Wetter", () => {
  expect(pulseCurve(0.2, 1, 4)).toEqual({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0.2, 0.6, 1, 0.6, 0.2] });
  expect(flickerCurve(0.8).outputRange).toEqual([0.8, 0.8, 0.25, 0.8, 0.4, 0.8, 0.8]);
  expect(restingOpacity({ brightness: 0.9 }, "still")).toEqual({ glow: 0.72, body: 0.9 });
  expect(restingOpacity({ brightness: 0.7 }, "subtle")).toEqual({ glow: 0.9, body: 0.9 });
  expect(bulbStartDelay({ flicker: false, flickerDelay: 5, glowDuration: 4, glowDelay: -1.5 })).toBe(2500);
  expect(bulbStartDelay({ flicker: false, flickerDelay: 5, glowDuration: 4, glowDelay: 0 })).toBe(0);
  expect(bulbStartDelay({ flicker: true, flickerDelay: 7.3, glowDuration: 4, glowDelay: -1.5 })).toBe(7300);
  expect([chainWind(null), chainWind(undefined), chainWind(1.3), chainWind(9), chainWind(-1)]).toEqual([0.6, 0.6, 1.3, 2, 0]);
});

test("Lichtinseln hinter dem Inhalt nur an den Feiertagen, nicht bei „dezent“ und nicht auf stillen Screens", async () => {
  await render(<ChristmasBackdrop season={xmas()} screen="Dashboard" />);
  expect(screen.getByTestId("christmas-glow").props.pointerEvents).toBe("none");
  await screen.unmount();
  for (const [season, name] of [[xmas({ phase: "abschied" }), "Dashboard"], [xmas({ effective: "subtle" }), "Dashboard"], [xmas(), "Settings"]] as const) {
    await render(<ChristmasBackdrop season={season} screen={name} />);
    expect(screen.queryByTestId("christmas-glow")).toBeNull();
    await screen.unmount();
  }
});

test("Gruß: 1,5 s nach dem Start, 14 s lang, Text des Tages - und am selben Tag kein zweites Mal", async () => {
  jest.useFakeTimers({ now: new Date(2026, 11, 25, 10, 0) });
  await render(<ChristmasGreeting season={xmas({ texts: { greeting: "Frohe Weihnachten", greeting_25: "Schöne Feiertage vom Rudel!" } })} screen="Dashboard" />);
  await flushStorage();
  expect(screen.queryByTestId("christmas-greeting")).toBeNull();
  await advance(TOAST_DELAY_MS);
  expect(screen.getByTestId("christmas-greeting-title")).toHaveTextContent("Erster Weihnachtstag");
  expect(screen.getByTestId("christmas-greeting-text")).toHaveTextContent("Schöne Feiertage vom Rudel!");
  expect(screen.getAllByTestId("christmas-card-light", { includeHiddenElements: true })).toHaveLength(8);
  expect(screen.queryByTestId("christmas-greeting-link")).toBeNull();
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith("season_greeting_christmas-gruss", "2026-12-25");
  await advance(TOAST_MS);
  expect(screen.queryByTestId("christmas-greeting")).toBeNull();
  await screen.unmount();
  await render(<ChristmasGreeting season={xmas()} screen="Dashboard" />);
  await flushStorage();
  await advance(TOAST_DELAY_MS + TOAST_MS);
  expect(screen.queryByTestId("christmas-greeting")).toBeNull();
});

test("Schließen-Knopf und Antippen der Karte schließen; ein neuer Tag in der App bringt den neuen Gruß", async () => {
  jest.useFakeTimers({ now: new Date(2026, 11, 24, 18, 0) });
  const listeners: Array<(state: string) => void> = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, listener: (state: string) => void) => {
    listeners.push(listener);
    return { remove: () => {} };
  }) as never);
  await render(<ChristmasGreeting season={xmas()} screen="Dashboard" />);
  await flushStorage();
  await advance(TOAST_DELAY_MS);
  expect(screen.getByTestId("christmas-greeting-title")).toHaveTextContent("Heiligabend");
  await fireEvent.press(screen.getByTestId("christmas-greeting-close"));
  expect(screen.queryByTestId("christmas-greeting")).toBeNull();
  // Am nächsten Morgen kommt die App aus dem Hintergrund zurück: der Gruß des neuen Tages.
  jest.setSystemTime(new Date(2026, 11, 25, 9, 0));
  await act(async () => {
    listeners.forEach((listener) => listener("active"));
  });
  await flushStorage();
  await advance(TOAST_DELAY_MS);
  expect(screen.getByTestId("christmas-greeting-title")).toHaveTextContent("Erster Weihnachtstag");
  await fireEvent.press(screen.getByTestId("christmas-greeting-card"));
  expect(screen.queryByTestId("christmas-greeting")).toBeNull();
});

test("nicht auf stillen Screens und nicht über einem Dialog - danach kommt er", async () => {
  jest.useFakeTimers({ now: new Date(2026, 11, 26, 12, 0) });
  await render(<ChristmasGreeting season={xmas()} screen="Settings" />);
  await flushStorage();
  await advance(TOAST_DELAY_MS * 2);
  expect(screen.queryByTestId("christmas-greeting")).toBeNull();
  await act(async () => {
    setOverlay("sheet", true);
  });
  await screen.rerender(<ChristmasGreeting season={xmas()} screen="Dashboard" />);
  await flushStorage();
  await advance(TOAST_DELAY_MS * 2);
  expect(screen.queryByTestId("christmas-greeting")).toBeNull();
  await act(async () => {
    setOverlay("sheet", false);
  });
  await flushStorage();
  await advance(TOAST_DELAY_MS);
  expect(screen.getByTestId("christmas-greeting-title")).toHaveTextContent("Zweiter Weihnachtstag");
});

test("Abschied am 6. Jänner mit Link zum Jahresrückblick auf der Website", async () => {
  jest.useFakeTimers({ now: new Date(2027, 0, 6, 9, 0) });
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  await render(<ChristmasGreeting season={xmas({ phase: "abschied", starts_at: "2027-01-06T00:00:00+01:00" })} screen="Dashboard" />);
  await flushStorage();
  await advance(TOAST_DELAY_MS);
  expect(screen.getByTestId("christmas-greeting-title")).toHaveTextContent("Heilige Drei Könige");
  expect(screen.getByTestId("christmas-greeting-text")).toHaveTextContent("Danke fürs Mitfeiern");
  await fireEvent.press(screen.getByTestId("christmas-greeting-link"));
  expect(open).toHaveBeenCalledWith(`${WEB_BASE_URL}/news/rueckblick`);
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith("season_greeting_christmas-abschied", "2027-01-06");
});

test("„dezent“: die Karte steht ohne Hereingleiten, Lichter und Sterne ohne Glimmen", async () => {
  jest.useFakeTimers({ now: new Date(2026, 11, 24, 18, 0) });
  const loop = jest.spyOn(Animated, "loop");
  await render(<ChristmasGreeting season={xmas({ effective: "subtle" })} screen="Dashboard" />);
  await flushStorage();
  await advance(TOAST_DELAY_MS);
  expect(opacityOf(screen.getByTestId("christmas-greeting"))).toBe(1);
  screen.getAllByTestId("christmas-card-light", { includeHiddenElements: true }).forEach((light) => expect(opacityOf(light)).toBe(1));
  expect(loop).not.toHaveBeenCalled();
});

test("Bühne und Slots: Kette in der Begrüßungskarte, Lichtinseln im Screen, Gruß über allem", async () => {
  jest.useFakeTimers({ now: new Date(2026, 11, 24, 18, 0) });
  mockSeasonState.seasons = [xmas()];
  await render(<><SeasonStage /><SeasonEdgeSlot /><SeasonBackdropSlot /></>);
  expect(screen.getByTestId("christmas-edge")).toBeTruthy();
  expect(screen.getByTestId("christmas-glow")).toBeTruthy();
  await flushStorage();
  await advance(TOAST_DELAY_MS);
  expect(screen.getByTestId("christmas-greeting")).toBeTruthy();
  await screen.unmount();
  mockSeasonState.seasons = [xmas({ effective: "off" })];
  await render(<><SeasonStage /><SeasonEdgeSlot /><SeasonBackdropSlot /></>);
  expect(screen.queryByTestId("christmas-edge")).toBeNull();
  expect(screen.queryByTestId("christmas-glow")).toBeNull();
});
