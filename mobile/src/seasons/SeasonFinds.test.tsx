import React from "react";
import { Animated, StyleSheet } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

// Saison-Fundstücke im Profil der App (#678, Web #776): dieselbe Übersicht wie im Web - Laufendes zuerst mit dem
// Stand von heute und dem Tagesdeckel, die anderen Jahreszeiten mit ihrem nächsten Termin, leere Fundstücke blass.
// Antippen lässt die Figur sich regen (nicht bei „Bewegung reduzieren“); zählt die App etwas, lädt die Karte nach.

const mockApi = { get: jest.fn() };
jest.mock("../lib/api", () => ({ api: mockApi }));
const mockSeasonState = { reducedMotion: false };
jest.mock("./SeasonProvider", () => ({ useSeason: () => mockSeasonState }));
const mockSignalListeners = new Set<() => void>();
jest.mock("./signals", () => ({
  ...jest.requireActual("./signals"),
  onSignal: (listener: () => void) => {
    mockSignalListeners.add(listener);
    return () => mockSignalListeners.delete(listener);
  },
}));

const { REFRESH_AFTER_SIGNAL_MS, SeasonFindsCard, dayText, orderSeasons, seasonHint } = require("./SeasonFinds");
const { FIND_ICONS, findMotion } = require("./findIcons");

function item(signal: string, icon: string, count: number, extra: Record<string, unknown> = {}) {
  return { signal, label: `Fund ${signal}`, icon, count, season_count: count, today: 0, per_day: 30, ...extra };
}

const OVERVIEW = {
  total: 17,
  seasons: [
    { key: "halloween", label: "Halloween", active: true, count: 17, next_start: null, ends_at: "2026-11-01T23:59:59+01:00", items: [item("halloween_bats_scared", "bat", 12, { today: 30 }), item("halloween_ghosts_freed", "ghost", 5, { today: 3, per_day: 20 }), item("halloween_cat_petted", "cat", 0, { per_day: 10 }), item("halloween_pumpkin", "pumpkin", 0, { per_day: 1 })] },
    { key: "snow", label: "Winter", active: false, count: 0, next_start: "2026-11-29T00:00:00+01:00", ends_at: null, items: [item("snowflakes_clicked", "snowflake", 0, { per_day: 200 })] },
    { key: "advent_calendar", label: "Adventkalender", active: false, count: 4, next_start: "2026-12-01T06:00:00+01:00", ends_at: null, items: [item("advent_door", "door", 4, { season_count: 2, per_day: 24 })] },
  ],
};

beforeEach(() => {
  mockApi.get.mockReset();
  mockSignalListeners.clear();
  mockSeasonState.reducedMotion = false;
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test("Termine nach der Uhr in Wien, Hinweis je Saison, Reihenfolge: läuft, hat Funde, der Rest", () => {
  expect(dayText("2026-11-29T00:00:00+01:00")).toBe("29.11.");
  expect(dayText("2026-10-31T23:30:00Z")).toBe("01.11.");
  expect(dayText("kaputt")).toBe("");
  expect(seasonHint({ active: true, ends_at: "2026-11-01T23:59:59+01:00", next_start: null })).toBe("läuft bis 01.11.");
  expect(seasonHint({ active: true, ends_at: null, next_start: null })).toBe("läuft gerade");
  expect(seasonHint({ active: false, ends_at: null, next_start: "2026-11-29T00:00:00+01:00" })).toBe("ab 29.11.");
  expect(seasonHint({ active: false, ends_at: null, next_start: null })).toBe("");
  const order = orderSeasons([OVERVIEW.seasons[1], OVERVIEW.seasons[2], OVERVIEW.seasons[0]]).map((season: { key: string }) => season.key);
  expect(order).toEqual(["halloween", "advent_calendar", "snow"]);
});

test("die Karte: Gesamtzahl, Halloween läuft oben mit dem Stand von heute, der volle Tag grün, Winter mit Termin", async () => {
  mockApi.get.mockResolvedValue({ data: OVERVIEW });
  await render(<SeasonFindsCard />);
  expect(mockApi.get).toHaveBeenCalledWith("/achievements/collectibles");
  expect(screen.getByTestId("season-finds-total").props.children).toBe("17");
  expect(screen.getByText("läuft")).toBeTruthy();
  expect(screen.getByTestId("season-finds-halloween-hint").props.children).toBe("läuft bis 01.11.");
  expect(screen.getByTestId("season-find-halloween_ghosts_freed-today").props.children.join("")).toBe("heute 3 von 20");
  const full = StyleSheet.flatten(screen.getByTestId("season-find-halloween_bats_scared-bar").props.style);
  const partial = StyleSheet.flatten(screen.getByTestId("season-find-halloween_ghosts_freed-bar").props.style);
  expect(full.width).toBe("100%");
  expect(full.backgroundColor).not.toBe(partial.backgroundColor);
  expect(partial.width).toBe("15%");
  // Der Kürbis zählt einmal am Tag - dafür kein Balken.
  expect(screen.queryByTestId("season-find-halloween_pumpkin-today")).toBeNull();
  expect(screen.getByTestId("season-finds-snow-hint").props.children).toBe("ab 29.11.");
  // Vergangene Saison: was zuletzt dazukam, wenn es weniger ist als insgesamt.
  expect(screen.getByText("zuletzt 2")).toBeTruthy();
  expect(screen.queryByTestId("season-finds-empty")).toBeNull();
  // Die laufende Saison steht vor den anderen.
  const keys = screen.getAllByTestId(/^season-finds-(halloween|snow|advent_calendar)$/).map((node) => node.props.testID);
  expect(keys).toEqual(["season-finds-halloween", "season-finds-advent_calendar", "season-finds-snow"]);
});

test("noch nichts gesammelt: ein Satz, wo es etwas zu finden gibt; Fehler: ein ruhiger Hinweis", async () => {
  mockApi.get.mockResolvedValueOnce({ data: { total: 0, seasons: [] } });
  await render(<SeasonFindsCard />);
  expect(screen.getByTestId("season-finds-empty")).toBeTruthy();
  await screen.unmount();
  mockApi.get.mockRejectedValueOnce(new Error("offline"));
  await render(<SeasonFindsCard />);
  expect(screen.getByTestId("season-finds-error")).toBeTruthy();
});

test("zählt die App ein Fundstück, lädt die Karte nach ein paar Sekunden nach", async () => {
  jest.useFakeTimers();
  mockApi.get.mockResolvedValue({ data: OVERVIEW });
  await render(<SeasonFindsCard />);
  expect(mockApi.get).toHaveBeenCalledTimes(1);
  await act(async () => {
    mockSignalListeners.forEach((listener) => listener());
  });
  await act(async () => {
    jest.advanceTimersByTime(REFRESH_AFTER_SIGNAL_MS - 10);
  });
  expect(mockApi.get).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(20);
  });
  expect(mockApi.get).toHaveBeenCalledTimes(2);
  await screen.unmount();
  expect(mockSignalListeners.size).toBe(0);
});

test("Antippen: die Figur regt sich mit dem nativen Treiber - nicht bei leeren Fundstücken und nicht bei „Bewegung reduzieren“", async () => {
  mockApi.get.mockResolvedValue({ data: OVERVIEW });
  const timing = jest.spyOn(Animated, "timing");
  await render(<SeasonFindsCard />);
  await fireEvent.press(screen.getByTestId("season-find-halloween_bats_scared"));
  expect(timing).toHaveBeenCalledTimes(1);
  expect(timing.mock.calls[0][1]).toMatchObject({ toValue: 1, useNativeDriver: true });
  await fireEvent.press(screen.getByTestId("season-find-halloween_cat_petted"));
  expect(timing).toHaveBeenCalledTimes(1);
  await screen.unmount();
  mockSeasonState.reducedMotion = true;
  await render(<SeasonFindsCard />);
  await fireEvent.press(screen.getByTestId("season-find-halloween_bats_scared"));
  expect(timing).toHaveBeenCalledTimes(1);
});

test("jede Figur bewegt sich nur mit Drehung, Maß, Versatz und Deckkraft um ihre Mitte - und unbekannte bekommen die Schneeflocke", async () => {
  const poke = new Animated.Value(0);
  const allowed = new Set(["rotate", "scale", "scaleX", "translateY"]);
  FIND_ICONS.forEach((icon: string) => {
    const motion = findMotion(icon, poke);
    (motion.transform as Array<Record<string, unknown>>).forEach((step) => Object.keys(step).forEach((key) => expect(allowed.has(key)).toBe(true)));
    expect(motion.transformOrigin).toBeUndefined();
  });
  mockApi.get.mockResolvedValue({ data: { total: 1, seasons: [{ key: "x", label: "Neu", active: false, count: 1, next_start: null, ends_at: null, items: [item("neu", "unbekannt", 1)] }] } });
  await render(<SeasonFindsCard />);
  expect(screen.getByTestId("find-figure-snowflake")).toBeTruthy();
});
