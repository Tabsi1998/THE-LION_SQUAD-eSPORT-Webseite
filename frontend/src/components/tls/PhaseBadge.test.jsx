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

describe("#1264: Countdown nur, wenn es bald so weit ist", () => {
  const NOW = Date.parse("2026-10-07T10:00:00+02:00");
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());
  const announced = (targetAt) => ({ state: "announced", label: "Angekündigt", target_at: targetAt, countdown_kind: "starts" });

  test("in 154 Tagen: der Monat, kein „154T 16h“", () => {
    render(<PhaseBadge phase={announced("2027-03-10T14:00:00+01:00")} />);
    expect(screen.getByText("Angekündigt · startet im März")).toBeInTheDocument();
  });

  test("15 bis 60 Tage: das Datum mit „am“", () => {
    render(<PhaseBadge phase={announced("2026-11-14T18:00:00+01:00")} />);
    expect(screen.getByText("Angekündigt · startet am Sa 14. November")).toBeInTheDocument();
  });

  test("ab 14 Tagen in Tagen, am Vortag und am Tag selbst mit Uhrzeit, zuletzt in Minuten", () => {
    const { rerender } = render(<PhaseBadge phase={announced("2026-10-10T09:00:00+02:00")} />);
    expect(screen.getByText("Angekündigt · startet in 3 Tagen")).toBeInTheDocument();
    rerender(<PhaseBadge phase={announced("2026-10-08T14:00:00+02:00")} />);
    expect(screen.getByText("Angekündigt · startet morgen 14:00")).toBeInTheDocument();
    rerender(<PhaseBadge phase={announced("2026-10-07T14:00:00+02:00")} />);
    expect(screen.getByText("Angekündigt · startet heute 14:00")).toBeInTheDocument();
    rerender(<PhaseBadge phase={announced("2026-10-07T10:45:00+02:00")} />);
    expect(screen.getByText("Angekündigt · startet in 45 Minuten")).toBeInTheDocument();
  });

  test("Anmeldung und Check-in mit eigenem Verb", () => {
    const { rerender } = render(<PhaseBadge phase={{ state: "registration_open", label: "Anmeldung offen", target_at: "2026-10-09T18:00:00+02:00", countdown_kind: "registration_closes" }} />);
    expect(screen.getByText("Anmeldung offen · endet in 2 Tagen")).toBeInTheDocument();
    rerender(<PhaseBadge phase={{ state: "registration_closed", label: "Anmeldung geschlossen", target_at: "2026-10-08T17:00:00+02:00", countdown_kind: "check_in_opens" }} />);
    expect(screen.getByText("Anmeldung geschlossen · Check-in morgen 17:00")).toBeInTheDocument();
  });

  test("die Schwelle aus den Einstellungen gilt: mit 30 Tagen zählt auch ein Termin in 20 Tagen", async () => {
    const { setCachedBranding } = await import("@/lib/brandingEvents");
    setCachedBranding({ countdown_days: 30 });
    try {
      render(<PhaseBadge phase={announced("2026-10-27T12:00:00+01:00")} />);
      expect(screen.getByText("Angekündigt · startet in 20 Tagen")).toBeInTheDocument();
    } finally {
      setCachedBranding({});
    }
  });

  test("ein vergangener Zeitpunkt steht nicht als Countdown da", () => {
    render(<PhaseBadge phase={announced("2026-10-07T09:00:00+02:00")} />);
    expect(screen.getByText("Angekündigt")).toBeInTheDocument();
  });
});
