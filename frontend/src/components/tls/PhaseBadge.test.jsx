import { render, screen } from "@testing-library/react";
import { PhaseBadge } from "./PhaseBadge";

// Zustands-Chip (#1076): überall derselbe Chip für denselben Zustand. Bei LIVE steht der Chip ruhig, nur der Punkt
// pulsiert; andere Zustände haben keinen Punkt. Der Text kommt vom Server, mit Countdown bis zum nächsten Wechsel.

test("live: Chip mit pulsierendem Punkt, ohne dass der ganze Chip pulsiert", () => {
  render(<PhaseBadge phase={{ state: "live", label: "Läuft" }} />);
  const dot = screen.getByTestId("phase-live-dot");
  expect(dot).toHaveClass("tls-live-dot");
  expect(dot.parentElement).toHaveTextContent("Läuft");
  expect(dot.parentElement).not.toHaveClass("animate-live");
});

test("andere Zustände haben keinen Punkt; ohne Phase gilt der Status", () => {
  const { unmount } = render(<PhaseBadge phase={{ state: "registration_open", label: "Anmeldung offen" }} />);
  expect(screen.getByText("Anmeldung offen")).toBeInTheDocument();
  expect(screen.queryByTestId("phase-live-dot")).toBeNull();
  unmount();
  render(<PhaseBadge status="completed" />);
  expect(screen.getByText("Beendet")).toBeInTheDocument();
});
