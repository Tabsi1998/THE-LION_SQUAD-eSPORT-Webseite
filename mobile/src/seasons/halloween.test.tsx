import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";

// Halloween in der App (#636): Laterne mit Gruß und Haptik, Signal nur am 31.10. abends, Ecken je Stärke,
// Fledermäuse nicht bei „Bewegung reduzieren“ oder „dezent“.

const mockSignals = { recordSignal: jest.fn(async () => true) };
jest.mock("./signals", () => mockSignals);
jest.mock("expo-haptics", () => ({ impactAsync: jest.fn(async () => {}), ImpactFeedbackStyle: { Light: "light" } }));

const { HalloweenWidget, HalloweenCorners, HalloweenBats, pumpkinCounts } = require("./halloween");

function season(overrides: Record<string, unknown> = {}) {
  return { key: "halloween", label: "Halloween", phase: "deko", intensity: "normal", effective: "normal", channels: ["app"], texts: { greeting: "Happy Halloween von THE LION SQUAD" }, data: { night: true }, starts_at: "", ends_at: "", forced: false, ...overrides };
}

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

test("Signal nur am 31. Oktober ab 18 Uhr", () => {
  expect(pumpkinCounts(new Date(2026, 9, 31, 18))).toBe(true);
  expect(pumpkinCounts(new Date(2026, 9, 31, 17, 59))).toBe(false);
  expect(pumpkinCounts(new Date(2026, 9, 30, 20))).toBe(false);
});

test("Laterne: Gruß und Haptik beim Antippen, Signal abends am 31.10.", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 9, 31, 20));
  await render(<HalloweenWidget season={season()} />);
  const lantern = screen.getByTestId("halloween-lantern");
  expect(lantern.props.accessibilityLabel).toBe("Happy Halloween von THE LION SQUAD");
  await fireEvent.press(lantern);
  expect(screen.getByTestId("halloween-note")).toHaveTextContent("Happy Halloween von THE LION SQUAD");
  expect(Haptics.impactAsync).toHaveBeenCalled();
  expect(mockSignals.recordSignal).toHaveBeenCalledWith("halloween_pumpkin");
  await act(async () => {
    jest.advanceTimersByTime(4100);
  });
  expect(screen.queryByTestId("halloween-note")).toBeNull();
});

test("vor dem 31. zählt der Klick nicht", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 9, 27, 12));
  await render(<HalloweenWidget season={season()} />);
  await fireEvent.press(screen.getByTestId("halloween-lantern"));
  expect(mockSignals.recordSignal).not.toHaveBeenCalled();
});

test("Ecken immer da", async () => {
  await render(<HalloweenCorners season={season({ effective: "subtle" })} />);
  expect(screen.getByTestId("halloween-corners")).toBeTruthy();
});

test("Fledermäuse nicht bei Bewegung reduzieren", async () => {
  await render(<HalloweenBats season={season()} reducedMotion />);
  expect(screen.queryByTestId("halloween-bats")).toBeNull();
});

test("Fledermäuse nicht bei dezent", async () => {
  await render(<HalloweenBats season={season({ effective: "subtle" })} reducedMotion={false} />);
  expect(screen.queryByTestId("halloween-bats")).toBeNull();
});

test("Fledermäuse fliegen nach der Wartezeit los", async () => {
  jest.useFakeTimers();
  await render(<HalloweenBats season={season({ effective: "full", data: { night: false } })} reducedMotion={false} />);
  expect(screen.queryByTestId("halloween-bats")).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(8100);
  });
  expect(screen.getByTestId("halloween-bats")).toBeTruthy();
});
