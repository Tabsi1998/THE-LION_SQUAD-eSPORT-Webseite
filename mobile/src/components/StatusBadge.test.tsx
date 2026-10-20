import React from "react";
import { AccessibilityInfo } from "react-native";
import { render, screen, waitFor } from "@testing-library/react-native";
import { StatusBadge } from "./StatusBadge";
import { colors, roles } from "../theme";

// Zustands-Chip (#1085): wie im Web steht der Chip ruhig, bei LIVE pulsiert nur der Punkt mit einem Ring. Mit
// "Bewegung reduzieren" bleibt der Punkt ohne Ring; andere Zustaende haben keinen Punkt.

test("live zeigt den Punkt mit Ring, andere Zustaende nicht", async () => {
  const spy = jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  render(<StatusBadge phase={{ state: "live", label: "Laeuft" }} />);
  await waitFor(() => expect(spy).toHaveBeenCalled());
  expect(screen.getByTestId("status-live-dot")).toBeTruthy();
  // Großbuchstaben im Text selbst (#1296), der Vorleser liest das Wort normal.
  expect(screen.getByText("LAEUFT")).toBeTruthy();
  expect(screen.getByLabelText("Laeuft")).toBeTruthy();
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

// Fast-Lap-Abzeichen (#1797): „ANGEKÜNDIGT“ brach in der App vor dem letzten Buchstaben um. Der Chip bleibt einzeilig,
// zu Langes wird etwas kleiner statt umzubrechen.
test("der Chip bleibt einzeilig und wird bei Platzmangel kleiner statt umzubrechen", async () => {
  await render(<StatusBadge phase={{ state: "announced", label: "Angekündigt" }} status="upcoming" />);
  const text = screen.getByTestId("status-badge-text");
  expect(text).toHaveTextContent("ANGEKÜNDIGT");
  expect(text.props.numberOfLines).toBe(1);
  expect(text.props.adjustsFontSizeToFit).toBe(true);
  expect(text.props.minimumFontScale).toBeGreaterThanOrEqual(0.75);
});

// Text und Tönung aus derselben Regel (#1869): steht eine Phase da, bestimmt sie beides - wie PhaseBadge im Web. Eine
// Fast Lap mit Status „live“, die laut Phase noch angekündigt ist, stand sonst als „ANGEKÜNDIGT“ in Live-Rot da.
test("eine Phase bestimmt Text und Tönung, der Rohstatus färbt nicht mit", async () => {
  await render(<StatusBadge phase={{ state: "announced", label: "Angekündigt" }} status="live" />);
  const text = screen.getByTestId("status-badge-text");
  expect(text).toHaveTextContent("ANGEKÜNDIGT");
  expect(text).toHaveStyle({ color: colors.cyan });
  expect(screen.queryByTestId("status-live-dot")).toBeNull();
});

test("laufend und beendet: Text und Tönung passen zusammen", async () => {
  const live = await render(<StatusBadge phase={{ state: "live", label: "Läuft" }} status="registration_open" />);
  expect(screen.getByTestId("status-badge-text")).toHaveTextContent("LÄUFT");
  expect(screen.getByTestId("status-badge-text")).toHaveStyle({ color: colors.live });
  await live.unmount();
  await render(<StatusBadge phase={{ state: "completed", label: "Beendet" }} status="live" />);
  expect(screen.getByTestId("status-badge-text")).toHaveTextContent("BEENDET");
  expect(screen.getByTestId("status-badge-text")).toHaveStyle({ color: colors.muted });
});

// Phase → Ton wie PhaseBadge im Web (lib/phaseTone): abgesagt und Entwurf grau, „Anmeldung öffnet“ cyan, Pause
// zwischen zwei Tagen violett.
test.each([
  [{ state: "cancelled", label: "Abgesagt" }, colors.muted],
  [{ state: "draft", label: "Entwurf" }, colors.muted],
  [{ state: "registration_pending", label: "Anmeldung öffnet" }, colors.cyan],
  [{ state: "registration_closed", label: "Anmeldung geschlossen" }, colors.muted],
  [{ state: "day_break", label: "Pause bis zum nächsten Tag" }, roles.event],
])("Phase %p färbt wie im Web", async (phase, color) => {
  await render(<StatusBadge phase={phase} />);
  expect(screen.getByTestId("status-badge-text")).toHaveStyle({ color });
});

test("ohne Phase färbt weiter der Status", async () => {
  await render(<StatusBadge status="live" />);
  expect(screen.getByTestId("status-badge-text")).toHaveStyle({ color: colors.live });
});
