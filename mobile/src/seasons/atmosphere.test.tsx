import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";

// Die Katze auf der Kante (#664): antippen lässt sie ein Stück gehen - mit Haptik, und jedes Mal zählt es als
// Saison-Fundstück (#678). Während sie läuft, in der Ruhezeit danach und bei „Bewegung reduzieren“ passiert nichts.

const mockSignals = { recordSignal: jest.fn(async () => true) };
jest.mock("./signals", () => mockSignals);
jest.mock("expo-haptics", () => ({ impactAsync: jest.fn(async () => {}), ImpactFeedbackStyle: { Light: "light" } }));

const { CAT_COOLDOWN_MS, CAT_SIGNAL, CatOnEdge } = require("./atmosphere");

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

test("Katze antippen: sie geht los, es zählt als Fundstück - nicht noch einmal, während sie läuft oder ruht", async () => {
  jest.useFakeTimers();
  await render(<CatOnEdge bottom={60} width={390} moving />);
  const cat = screen.getByTestId("halloween-cat");
  expect(cat.props["data-walking"]).toBe("0");
  await fireEvent.press(screen.getByTestId("halloween-cat-press"));
  expect(screen.getByTestId("halloween-cat").props["data-walking"]).toBe("1");
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
  expect(mockSignals.recordSignal).toHaveBeenCalledTimes(1);
  expect(mockSignals.recordSignal).toHaveBeenCalledWith(CAT_SIGNAL, { onceIf: false });
  expect(CAT_SIGNAL).toBe("halloween_cat_petted");
  await fireEvent.press(screen.getByTestId("halloween-cat-press"));
  expect(mockSignals.recordSignal).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(CAT_COOLDOWN_MS + 500);
  });
  await fireEvent.press(screen.getByTestId("halloween-cat-press"));
  expect(mockSignals.recordSignal).toHaveBeenCalledTimes(2);
});

test("Bewegung reduzieren: die Katze sitzt still, und Antippen zählt nicht", async () => {
  await render(<CatOnEdge bottom={60} width={390} moving={false} />);
  await fireEvent.press(screen.getByTestId("halloween-cat-press"));
  expect(screen.getByTestId("halloween-cat").props["data-walking"]).toBe("0");
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
  expect(mockSignals.recordSignal).not.toHaveBeenCalled();
});

test("Schwanz wedelt an der Wurzel, Augen blinzeln an Ort und Stelle - als eigene Ebenen mit nativem Treiber", async () => {
  const { Animated, StyleSheet } = require("react-native");
  const { CAT_VIEW, EYES_CENTER, EYES_HALF, TAIL_HALF, TAIL_ROOT, pivotBox } = require("./atmosphere");
  expect(CAT_VIEW).toEqual({ width: 90, height: 81 });
  // Der Kasten jeder bewegten Ebene liegt mittig auf ihrem Drehpunkt - Android dreht und skaliert um die Mitte.
  const scale = 56 / 90;
  const timing = jest.spyOn(Animated, "timing");
  await render(<CatOnEdge bottom={60} width={390} moving />);
  const tail = StyleSheet.flatten(screen.getByTestId("halloween-cat-tail").props.style);
  const eyes = StyleSheet.flatten(screen.getByTestId("halloween-cat-eyes").props.style);
  for (const [layer, pivot, half] of [[tail, TAIL_ROOT, TAIL_HALF], [eyes, EYES_CENTER, EYES_HALF]]) {
    expect(layer.left + layer.width / 2).toBeCloseTo(pivot.x * scale, 6);
    expect(layer.top + layer.height / 2).toBeCloseTo(pivot.y * scale, 6);
    expect(layer.transformOrigin).toBeUndefined();
    expect(pivotBox(pivot, half, scale).viewBox).toBe(`${pivot.x - half.x} ${pivot.y - half.y} ${half.x * 2} ${half.y * 2}`);
  }
  expect(Object.keys(tail.transform[0])).toEqual(["rotate"]);
  expect(Object.keys(eyes.transform[0])).toEqual(["scaleY"]);
  // Schwanz und Blinzeln laufen über den nativen Treiber - kein JavaScript je Bild.
  const configs = timing.mock.calls.map(([, config]) => config as { toValue: number; useNativeDriver: boolean });
  expect(configs.length).toBeGreaterThanOrEqual(4);
  expect(configs.every((config) => config.useNativeDriver)).toBe(true);
  timing.mockRestore();
});
