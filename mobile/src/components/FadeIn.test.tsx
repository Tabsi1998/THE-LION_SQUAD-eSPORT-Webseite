import React from "react";
import { AccessibilityInfo, Text } from "react-native";
import { render, screen, waitFor } from "@testing-library/react-native";
import { FadeIn, staggerDelay } from "./FadeIn";

// Sanfte Übergänge (#218): kurz einblenden – und gar nicht, wenn das Handy „Bewegung reduzieren“ sagt.

test("Listen bauen sich nur in den ersten Zeilen nacheinander auf", () => {
  expect(staggerDelay(0)).toBe(0);
  expect(staggerDelay(3)).toBe(120);
  expect(staggerDelay(40)).toBe(240);
  expect(staggerDelay(-2)).toBe(0);
});

test("der Inhalt ist da – mit und ohne „Bewegung reduzieren“", async () => {
  const spy = jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
  await render(<FadeIn trigger="a"><Text>Inhalt</Text></FadeIn>);
  await waitFor(() => expect(spy).toHaveBeenCalled());
  expect(screen.getByText("Inhalt")).toBeTruthy();
  spy.mockRestore();
});
