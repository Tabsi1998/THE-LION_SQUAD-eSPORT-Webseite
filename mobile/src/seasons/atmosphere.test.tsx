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
