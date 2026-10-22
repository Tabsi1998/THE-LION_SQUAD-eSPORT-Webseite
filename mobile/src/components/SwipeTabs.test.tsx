import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { SwipeTabs, swipeEdges, swipeTabWidth } from "./SwipeTabs";

// Wischbare Reiter (#1969): bis vier teilen sich die Breite, mehr werden wischbar - Snap je Reiter, keine sichtbare
// Leiste, Verlauf am Rand, an dem es weitergeht.

const FOUR = ["Kalender", "Tabelle", "Fahrer", "Statistik"].map((label) => ({ key: label.toLowerCase(), label }));
const SIX = [...FOUR, { key: "kader", label: "Kader" }, { key: "maps", label: "Maps" }];

async function layout(width: number) {
  await fireEvent(screen.getByTestId("tabs"), "layout", { nativeEvent: { layout: { width, height: 48, x: 0, y: 0 } } });
}

test("Breite je Reiter: bis vier passen, ab fünf schaut der nächste halb herein", () => {
  expect(swipeTabWidth(4, 374)).toBeNull();
  expect(swipeTabWidth(6, 374)).toBe(83);
  expect(swipeTabWidth(6, 0)).toBeNull();
});

test("Verlauf links erst nach dem Wischen, rechts solange noch etwas folgt", () => {
  expect(swipeEdges(0, 374, 498)).toEqual({ start: false, end: true });
  expect(swipeEdges(60, 374, 498)).toEqual({ start: true, end: true });
  expect(swipeEdges(124, 374, 498)).toEqual({ start: true, end: false });
});

test("vier Reiter stehen wie bisher nebeneinander, ohne Wischen", async () => {
  await render(<SwipeTabs items={FOUR} active="tabelle" onChange={() => undefined} testID="tabs" />);
  await layout(374);
  expect(screen.queryByTestId("tabs-scroll")).toBeNull();
  expect(screen.getByRole("tab", { name: "Tabelle" }).props.accessibilityState).toEqual({ selected: true });
});

test("sechs Reiter: wischbar mit Snap, ohne sichtbare Leiste, Verlauf rechts - Tippen wählt", async () => {
  const onChange = jest.fn();
  await render(<SwipeTabs items={SIX} active="kalender" onChange={onChange} testID="tabs" />);
  await layout(374);
  const scroll = screen.getByTestId("tabs-scroll");
  expect(scroll.props.horizontal).toBe(true);
  expect(scroll.props.showsHorizontalScrollIndicator).toBe(false);
  expect(scroll.props.snapToInterval).toBe(83);
  expect(scroll.props.decelerationRate).toBe("fast");
  expect(screen.getByTestId("swipe-fade-end")).toBeTruthy();
  expect(screen.queryByTestId("swipe-fade-start")).toBeNull();
  await fireEvent(scroll, "scroll", { nativeEvent: { contentOffset: { x: 124, y: 0 }, layoutMeasurement: { width: 374, height: 48 }, contentSize: { width: 498, height: 48 } } });
  expect(screen.getByTestId("swipe-fade-start")).toBeTruthy();
  expect(screen.queryByTestId("swipe-fade-end")).toBeNull();
  await fireEvent.press(screen.getByRole("tab", { name: "Maps" }));
  expect(onChange).toHaveBeenCalledWith("maps");
});
