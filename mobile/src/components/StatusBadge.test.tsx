import React from "react";
import { AccessibilityInfo } from "react-native";
import { render, screen, waitFor } from "@testing-library/react-native";
import { StatusBadge } from "./StatusBadge";

// Zustands-Chip (#1085): wie im Web steht der Chip ruhig, bei LIVE pulsiert nur der Punkt mit einem Ring. Mit
// "Bewegung reduzieren" bleibt der Punkt ohne Ring; andere Zustaende haben keinen Punkt.

test("live zeigt den Punkt mit Ring, andere Zustaende nicht", async () => {
  const spy = jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  render(<StatusBadge phase={{ state: "live", label: "Laeuft" }} />);
  await waitFor(() => expect(spy).toHaveBeenCalled());
  expect(screen.getByTestId("status-live-dot")).toBeTruthy();
  expect(screen.getByText("Laeuft")).toBeTruthy();
  spy.mockRestore();
  render(<StatusBadge phase={{ state: "registration_open", label: "Anmeldung offen" }} />);
  expect(screen.queryAllByTestId("status-live-dot")).toHaveLength(1);
});

test("mit Bewegung reduzieren bleibt der Punkt, der Ring entfaellt", async () => {
  const spy = jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
  render(<StatusBadge phase={{ state: "live", label: "Laeuft" }} />);
  await waitFor(() => expect(spy).toHaveBeenCalled());
  const dot = screen.getByTestId("status-live-dot");
  await waitFor(() => expect(dot.children.length).toBe(1));
  spy.mockRestore();
});
