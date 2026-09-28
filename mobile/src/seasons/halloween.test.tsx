import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";

// Halloween in der App (#636, #655): je Screen eine andere, stabile Anordnung; Spinnen, hängende Fledermäuse,
// Krabbler und Nebel nur mit Bewegung; Netzbau Faden für Faden; Laterne mit Gruß als Overlay, Haptik und
// Signal nur am 31.10. abends; Fledermäuse nicht bei „Bewegung reduzieren“ oder dezent.

const mockSignals = { recordSignal: jest.fn(async () => true) };
jest.mock("./signals", () => mockSignals);
jest.mock("expo-haptics", () => ({ impactAsync: jest.fn(async () => {}), ImpactFeedbackStyle: { Light: "light" } }));
const mockSeasonState: Record<string, unknown> = { reducedMotion: false, showToast: jest.fn(), toast: null };
jest.mock("./SeasonProvider", () => ({ useSeason: () => mockSeasonState }));

const { HalloweenWidget, HalloweenCorners, HalloweenBats, BuildingWeb, pumpkinCounts, screenLayout, webBuilderPoint, WEB_STEPS } = require("./halloween");

function season(overrides: Record<string, unknown> = {}) {
  return { key: "halloween", label: "Halloween", phase: "deko", intensity: "normal", effective: "normal", channels: ["app"], texts: { greeting: "Happy Halloween von THE LION SQUAD" }, data: { night: true }, starts_at: "", ends_at: "", forced: false, ...overrides };
}

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  mockSeasonState.reducedMotion = false;
});

test("Anordnung je Screen: gleich für denselben, anders für einen anderen, passend zur Stärke", () => {
  const home = screenLayout("Dashboard", "normal");
  expect(screenLayout("Dashboard", "normal")).toEqual(home);
  expect(JSON.stringify(screenLayout("Tournaments", "normal"))).not.toBe(JSON.stringify(home));
  expect(home.webs.length).toBeGreaterThanOrEqual(2);
  expect(home.webs[0].size).toBeGreaterThanOrEqual(130);
  expect(home.spiders.length).toBeGreaterThanOrEqual(1);
  expect(home.fog).toBe("light");
  const subtle = screenLayout("Dashboard", "subtle");
  expect(subtle.spiders).toEqual([]);
  expect(subtle.hangingBats).toEqual([]);
  expect(subtle.crawler).toBeNull();
  expect(subtle.fog).toBe("none");
  expect(subtle.webs.some((web: { build?: boolean }) => web.build)).toBe(false);
  const full = screenLayout("Dashboard", "full");
  expect(full.fog).toBe("dense");
  expect(full.spiders.length).toBe(2);
});

test("Signal nur am 31. Oktober ab 18 Uhr", () => {
  expect(pumpkinCounts(new Date(2026, 9, 31, 18))).toBe(true);
  expect(pumpkinCounts(new Date(2026, 9, 31, 17, 59))).toBe(false);
  expect(pumpkinCounts(new Date(2026, 9, 30, 20))).toBe(false);
});

test("Laterne: Gruß als Overlay, Haptik, Signal abends am 31.10.", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 9, 31, 20));
  await render(<HalloweenWidget season={season()} screen="Dashboard" />);
  const lantern = screen.getByTestId("halloween-lantern");
  expect(lantern.props.accessibilityLabel).toBe("Happy Halloween von THE LION SQUAD");
  await fireEvent.press(lantern);
  expect(mockSeasonState.showToast).toHaveBeenCalledWith("Happy Halloween von THE LION SQUAD");
  expect(Haptics.impactAsync).toHaveBeenCalled();
  expect(mockSignals.recordSignal).toHaveBeenCalledWith("halloween_pumpkin");
});

test("vor dem 31. zählt der Klick nicht", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 9, 27, 12));
  await render(<HalloweenWidget season={season()} screen="Dashboard" />);
  await fireEvent.press(screen.getByTestId("halloween-lantern"));
  expect(mockSignals.recordSignal).not.toHaveBeenCalled();
});

test("Ecken: Netze immer, Spinnen, hängende Fledermäuse und Nebel nur mit Bewegung", async () => {
  jest.useFakeTimers();
  await render(<HalloweenCorners season={season({ effective: "subtle" })} screen="Dashboard" />);
  expect(screen.getByTestId("halloween-corners")).toBeTruthy();
  expect(screen.queryByTestId("halloween-spider-left")).toBeNull();
  expect(screen.queryByTestId("halloween-hanging-bat")).toBeNull();
  expect(screen.queryByTestId("halloween-fog")).toBeNull();
  screen.unmount();
  await render(<HalloweenCorners season={season({ effective: "normal" })} screen="Dashboard" />);
  expect(screen.getByTestId("halloween-spider-left")).toBeTruthy();
  expect(screen.getAllByTestId("halloween-hanging-bat").length).toBeGreaterThanOrEqual(1);
  expect(screen.getByTestId("halloween-fog")).toBeTruthy();
  expect(screen.queryByTestId("halloween-crawler")).toBeNull();
  const layout = screenLayout("Dashboard", "normal");
  await act(async () => {
    jest.advanceTimersByTime(layout.crawler.firstMs + 50);
  });
  expect(screen.getByTestId("halloween-crawler")).toBeTruthy();
});

test("Bewegung reduzieren: keine Spinnen, kein Nebel-Treiben, Netz gleich fertig", async () => {
  mockSeasonState.reducedMotion = true;
  await render(<HalloweenCorners season={season({ effective: "full" })} screen="Events" />);
  expect(screen.queryByTestId("halloween-spider-left")).toBeNull();
  expect(screen.queryByTestId("halloween-web-building")).toBeNull();
});

test("Netzbau: Faden für Faden, die Spinne sitzt am Ende des letzten Fadens, am Ende fertig", async () => {
  jest.useFakeTimers();
  expect(webBuilderPoint(0)).toEqual({ x: 0, y: 0 });
  expect(webBuilderPoint(1)).toEqual({ x: 118, y: 0 });
  expect(webBuilderPoint(WEB_STEPS).y).toBe(110);
  await render(<BuildingWeb size={150} torn={[]} stepMs={100} />);
  expect(screen.getByTestId("halloween-web-building")).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(100 * WEB_STEPS + 50);
  });
  expect(screen.getByTestId("halloween-web-built")).toBeTruthy();
});

test("Fledermäuse: nicht bei Bewegung reduzieren oder dezent, sonst nach drei Sekunden", async () => {
  jest.useFakeTimers();
  await render(<HalloweenBats season={season()} screen="Dashboard" reducedMotion />);
  expect(screen.queryByTestId("halloween-bats")).toBeNull();
  screen.unmount();
  await render(<HalloweenBats season={season({ effective: "subtle" })} screen="Dashboard" reducedMotion={false} />);
  expect(screen.queryByTestId("halloween-bats")).toBeNull();
  screen.unmount();
  await render(<HalloweenBats season={season({ effective: "full", data: { night: false } })} screen="Dashboard" reducedMotion={false} />);
  expect(screen.queryByTestId("halloween-bats")).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(3100);
  });
  expect(screen.getByTestId("halloween-bats")).toBeTruthy();
});
