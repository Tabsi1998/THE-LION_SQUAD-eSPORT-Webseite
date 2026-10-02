import React from "react";
import { Animated, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import * as SecureStore from "expo-secure-store";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AdventWidget, adventData, wreathLabel } from "./AdventWidget";
import { STORAGE_KEY } from "./ignition";
import { CATCH, FLAME_BOX, MATCH, abovePoint, flickerFrames, viewFit } from "./WreathSvg";
import { wreathLayout } from "./wreath";

// Adventkranz in der App (S6, W1, S11): Kerzen nach dem Server (oder der Uhr), jede anders; Text zum Kranz als
// Gruß-Karte; Anzünden am Sonntag der Kerze einmal je Tag mit Haptik; ohne Bewegung kein Streichholz; „dezent“ ohne
// Wind; Jahres-Seed.

const mockSeasonState: Record<string, unknown> = { reducedMotion: false, showToast: jest.fn(), byKey: {} };
jest.mock("../SeasonProvider", () => ({ useSeason: () => mockSeasonState }));
const mockFocus = { value: true };
jest.mock("../anchors", () => ({ useScreenFocused: () => mockFocus.value }));
jest.mock("expo-haptics", () => ({ impactAsync: jest.fn(async () => {}), ImpactFeedbackStyle: { Light: "light" } }));

const SUNDAYS = ["2026-11-29", "2026-12-06", "2026-12-13", "2026-12-20"];

function advent(overrides: Record<string, unknown> = {}, data: Record<string, unknown> = {}) {
  return { key: "advent", label: "Adventkranz", phase: "kranz", intensity: "normal", effective: "normal", channels: ["app"], texts: {}, forced: false, starts_at: "2026-11-29T00:00:00+01:00", ends_at: "2026-12-26T23:59:59+01:00", data: { candles: 2, days_to_christmas: 17, sundays: SUNDAYS, ...data }, ...overrides } as never;
}

async function show(season = advent()) {
  const view = await render(<AdventWidget season={season} screen="Dashboard" />);
  await act(async () => {});
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocus.value = true;
  mockSeasonState.reducedMotion = false;
  mockSeasonState.byKey = {};
});

afterEach(() => {
  jest.useRealTimers();
});

test("Daten: vom Server, sonst aus der Uhr; Kerzen gedeckelt; der Text nennt das offene Türchen", () => {
  const now = new Date(2026, 11, 7, 18);
  expect(adventData(advent(), now)).toEqual({ year: 2026, today: "2026-12-07", sundays: SUNDAYS, candles: 2, daysToChristmas: 17 });
  expect(adventData(advent({}, { candles: 9, days_to_christmas: -3 }), now)).toMatchObject({ candles: 4, daysToChristmas: 0 });
  expect(adventData({ data: {}, starts_at: "" }, new Date(2026, 11, 13, 9))).toEqual({ year: 2026, today: "2026-12-13", sundays: SUNDAYS, candles: 3, daysToChristmas: 11 });
  expect(adventData(null, new Date(2027, 11, 5, 9))).toMatchObject({ year: 2027, candles: 2, daysToChristmas: 19 });
  const info = adventData(advent(), now);
  expect(wreathLabel(info)).toBe("2. Advent – noch 17 Tage bis Weihnachten");
  expect(wreathLabel(info, { ready: true, today_door: 7, catch_up: false })).toBe("2. Advent – noch 17 Tage bis Weihnachten · Türchen 7 ist offen");
  expect(wreathLabel(info, { ready: true, today_door: 24, catch_up: true })).toBe("2. Advent – noch 17 Tage bis Weihnachten");
  expect(wreathLabel(info, { ready: false, today_door: 7 })).toBe("2. Advent – noch 17 Tage bis Weihnachten");
});

test("Kranz: vier Kerzen, zwei brennen; Wachs bei der ersten, nicht bei der zweiten; Antippen grüßt mit Haptik", async () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 11, 7, 18));
  mockSeasonState.byKey = { advent_calendar: { data: { ready: true, today_door: 7, catch_up: false } } };
  await show();
  for (const index of [1, 2, 3, 4]) expect(screen.getByTestId(`advent-candle-${index}`)).toBeTruthy();
  expect(screen.getAllByTestId("advent-flame")).toHaveLength(2);
  expect(screen.queryByTestId("advent-match")).toBeNull();
  // Wachsspuren nur an brennenden Kerzen: die erste brennt seit acht Tagen, die zweite seit einem - ihre Spur ist kürzer.
  const drips = screen.getAllByTestId("advent-drip").map((drip) => Number(String(drip.props.d).split(" ")[5].replace(",", "")));
  expect(drips).toHaveLength(2);
  expect(drips[0]).toBeGreaterThan(drips[1] * 3);
  const label = "2. Advent – noch 17 Tage bis Weihnachten · Türchen 7 ist offen";
  expect(screen.getByLabelText(label)).toBeTruthy();
  expect(screen.getByTestId("advent-widget").props.accessibilityValue).toEqual({ text: "2" });
  await fireEvent.press(screen.getByTestId("advent-wreath"));
  expect(mockSeasonState.showToast).toHaveBeenCalledWith(label);
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
});

test("Anzünden am Sonntag der Kerze: Streichholz, dann ruhige Phase, einmal je Tag - mit einem Tippen in der Hand", async () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 11, 6, 9));
  const first = await show();
  expect(screen.getByTestId("advent-match")).toBeTruthy();
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(await SecureStore.getItemAsync(STORAGE_KEY)))).toEqual({ 2026: { 1: "2026-12-06" } });
  await act(async () => {
    jest.advanceTimersByTime(1500);
  });
  expect(screen.queryByTestId("advent-match")).toBeNull();
  expect(screen.getAllByTestId("advent-flame")).toHaveLength(2);
  await act(async () => {
    jest.advanceTimersByTime(4000);
  });
  await first.unmount();

  // Beim zweiten Aufruf am selben Tag brennt die Kerze einfach.
  await show();
  expect(screen.queryByTestId("advent-match")).toBeNull();
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
});

test("kein Anzünden am Montag, nicht für eine Kerze, die der Server noch kalt lässt", async () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 11, 7, 9));
  const first = await show();
  expect(screen.queryByTestId("advent-match")).toBeNull();
  expect(await SecureStore.getItemAsync(STORAGE_KEY)).toBeNull();
  await first.unmount();
  jest.setSystemTime(new Date(2026, 11, 13, 9));
  await show(advent({}, { candles: 2 }));
  expect(screen.queryByTestId("advent-match")).toBeNull();
});

test("„Bewegung reduzieren“: kein Streichholz, aber gemerkt; nichts flackert", async () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 11, 13, 9));
  mockSeasonState.reducedMotion = true;
  const loop = jest.spyOn(Animated, "loop");
  await show(advent({}, { candles: 3 }));
  expect(screen.queryByTestId("advent-match")).toBeNull();
  expect(JSON.parse(String(await SecureStore.getItemAsync(STORAGE_KEY)))).toEqual({ 2026: { 2: "2026-12-13" } });
  expect(screen.getAllByTestId("advent-flame")).toHaveLength(3);
  expect(loop).not.toHaveBeenCalled();
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
  loop.mockRestore();
});

/** Die Drehung der ersten Flamme, wie sie gerade gezeichnet ist. */
function firstFlameRotation(): string {
  const style = StyleSheet.flatten(screen.getByTestId("advent-flame-body-1").props.style) as { transform: Array<Record<string, string>> };
  return String(style.transform[0].rotate);
}

test("„dezent“: kein Wind - die Flammen flackern weiter, stehen aber mit der Neigung ihrer Kerze", async () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 11, 7, 18));
  const lean = wreathLayout(2026).candles[0].lean;
  const loop = jest.spyOn(Animated, "loop");
  const normal = await show();
  await act(async () => {
    jest.advanceTimersByTime(3000);
  });
  // Eine Runde je brennender Flamme - die Zweige wiegen in der App nicht (unter einem Pixel).
  expect(loop).toHaveBeenCalledTimes(2);
  expect(firstFlameRotation()).toBe(`${Math.round((lean - 1.2) * 1000) / 1000}deg`);
  await normal.unmount();
  loop.mockClear();
  await show(advent({ effective: "subtle" }));
  await act(async () => {
    jest.advanceTimersByTime(3000);
  });
  expect(loop).toHaveBeenCalledTimes(2);
  expect(firstFlameRotation()).toBe(`${Math.round(lean * 1000) / 1000}deg`);
  loop.mockRestore();
});

test("in einem anderen Tab ruht die Bewegung - die Flammen brennen weiter", async () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 11, 7, 18));
  mockFocus.value = false;
  const loop = jest.spyOn(Animated, "loop");
  await show();
  await act(async () => {
    jest.advanceTimersByTime(3000);
  });
  expect(loop).not.toHaveBeenCalled();
  expect(screen.getAllByTestId("advent-flame")).toHaveLength(2);
  loop.mockRestore();
});

test("die Flamme sitzt am Docht: Maßstab der Zeichenfläche, Neigung der Kerze, Kasten mittig auf dem Docht", async () => {
  expect(viewFit(72, 42)).toEqual({ k: 72 / 76, ox: 0, oy: (42 - 44 * (72 / 76)) / 2 });
  expect(viewFit(76, 60)).toEqual({ k: 1, ox: 0, oy: 8 });
  // Eine gerade Kerze: der Punkt liegt senkrecht über dem Fuß; geneigt wandert er zur Seite.
  expect(abovePoint({ x: 10, y: 40, lean: 0 }, 12, 1.4)).toEqual({ x: 10, y: 40 - 13.4 });
  const tilted = abovePoint({ x: 10, y: 40, lean: 2 }, 12, 1.4);
  expect(tilted.x).toBeCloseTo(10 + Math.sin((2 * Math.PI) / 180) * 13.4, 6);
  expect(tilted.y).toBeCloseTo(40 - Math.cos((2 * Math.PI) / 180) * 13.4, 6);

  jest.useFakeTimers().setSystemTime(new Date(2026, 11, 7, 18));
  await show();
  const candle = wreathLayout(2026).candles[0];
  const { k, ox, oy } = viewFit(72, 42);
  const style = StyleSheet.flatten(screen.getByTestId("advent-flame-body-1").props.style) as Record<string, number | string>;
  // Der Kasten liegt mittig auf dem Docht - Android dreht und skaliert um die Mitte, ein transformOrigin entfällt.
  expect(FLAME_BOX.top).toBe(FLAME_BOX.bottom);
  expect(FLAME_BOX.left).toBe(FLAME_BOX.right);
  const days = 8;
  const height = candle.height - Math.round((days / 28) * 2.6 * 100) / 100;
  const wick = abovePoint(candle, height, 1.4);
  expect(style.left).toBeCloseTo(ox + (wick.x - FLAME_BOX.left) * k, 6);
  expect(style.top).toBeCloseTo(oy + (wick.y - FLAME_BOX.top) * k, 6);
  expect(Number(style.left) + Number(style.width) / 2).toBeCloseTo(ox + wick.x * k, 6);
  expect(Number(style.top) + Number(style.height) / 2).toBeCloseTo(oy + wick.y * k, 6);
  expect(style.transformOrigin).toBeUndefined();
});

test("die Bilder der Bewegung: Flackern je Stärke und Wind, Fangen und Streichholz", () => {
  const frames = flickerFrames(1, 0.6);
  expect(frames.scaleX).toEqual([1, 1.06, 0.95, 1.04, 1]);
  expect(frames.scaleY).toEqual([1, 1.12, 0.92, 1.15, 1]);
  expect(frames.rotation).toEqual([-1.2, 1.8, -0.6, 2.4, -1.2]);
  expect(flickerFrames(0.4, 0).rotation).toEqual([0, 0, 0, 0, 0]);
  expect(CATCH.scaleX[0]).toBeLessThan(0.2);
  expect(CATCH.opacity[CATCH.opacity.length - 1]).toBe(1);
  expect(MATCH.opacity[MATCH.opacity.length - 1]).toBe(0);
});
