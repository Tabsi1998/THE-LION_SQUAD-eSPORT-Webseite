import { render, screen } from "@testing-library/react";
import { PhaseBadge } from "./PhaseBadge";

// Die öffentliche Phase als Zustands-Schild (#1076, #1306): überall dasselbe Schild für denselben Zustand. Bei „Läuft“
// steht das Schild ruhig, nur der Punkt pulsiert. Der Countdown steht als kleiner Text neben dem Schild, nie darin.

const chip = () => screen.getByTestId("phase-chip");
const meta = () => screen.getByTestId("phase-meta");

test("live: Schild mit pulsierendem Punkt, ohne dass das ganze Schild pulsiert", () => {
  render(<PhaseBadge phase={{ state: "live", label: "Läuft" }} />);
  const dot = screen.getByTestId("phase-live-dot");
  expect(dot).toHaveClass("tls-live-dot");
  expect(dot.parentElement).toHaveTextContent("Läuft");
  expect(dot.parentElement).toHaveAttribute("data-kind", "live");
  expect(dot.parentElement).not.toHaveClass("animate-live");
});

test("andere Zustände haben keinen Punkt; ohne Phase gilt der Status", () => {
  const { unmount } = render(<PhaseBadge phase={{ state: "registration_open", label: "Anmeldung offen" }} />);
  expect(chip()).toHaveTextContent("Anmeldung offen");
  expect(chip()).toHaveAttribute("data-kind", "registration");
  expect(screen.queryByTestId("phase-live-dot")).toBeNull();
  unmount();
  render(<PhaseBadge status="completed" />);
  expect(chip()).toHaveTextContent("Beendet");
  expect(chip()).toHaveAttribute("data-kind", "done");
});

test("ohne Phase: geplant heißt angekündigt, checkin_open ist Check-in offen", () => {
  const { unmount } = render(<PhaseBadge status="scheduled" />);
  expect(chip()).toHaveTextContent("Angekündigt");
  unmount();
  render(<PhaseBadge status="checkin_open" />);
  expect(chip()).toHaveAttribute("data-kind", "checkin");
});

test("mehrtägig: die Tagesangabe des Servers steht neben dem Schild", () => {
  const { unmount } = render(<PhaseBadge phase={{ state: "live", label: "Tag 2/3 läuft" }} />);
  expect(chip()).toHaveTextContent(/^Läuft$/);
  expect(meta()).toHaveTextContent("Tag 2/3");
  unmount();
  render(<PhaseBadge phase={{ state: "day_break", label: "Tag 1/3" }} />);
  expect(chip()).toHaveTextContent(/^Pause$/);
  expect(meta()).toHaveTextContent("Tag 1/3");
});

test("ein unbekannter Zustand behält das Wort des Servers, nie den Rohwert", () => {
  render(<PhaseBadge phase={{ state: "something_new", label: "Etwas Neues" }} />);
  expect(chip()).toHaveTextContent("Etwas Neues");
  expect(chip()).not.toHaveTextContent("something");
});

describe("#1264: Countdown nur, wenn es bald so weit ist - und immer neben dem Schild", () => {
  const NOW = Date.parse("2026-10-07T10:00:00+02:00");
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());
  const announced = (targetAt) => ({ state: "announced", label: "Angekündigt", target_at: targetAt, countdown_kind: "starts" });
  const expectShown = (word, when) => {
    expect(chip()).toHaveTextContent(new RegExp(`^${word}$`));
    expect(meta()).toHaveTextContent(when);
    expect(chip()).not.toContainElement(meta());
  };

  test("in 154 Tagen: der Monat, kein „154T 16h“", () => {
    render(<PhaseBadge phase={announced("2027-03-10T14:00:00+01:00")} />);
    expectShown("Angekündigt", "startet im März");
  });

  test("15 bis 60 Tage: das Datum mit „am“", () => {
    render(<PhaseBadge phase={announced("2026-11-14T18:00:00+01:00")} />);
    expectShown("Angekündigt", "startet am Sa 14. November");
  });

  test("ab 14 Tagen in Tagen, am Vortag und am Tag selbst mit Uhrzeit, zuletzt in Minuten", () => {
    const { rerender } = render(<PhaseBadge phase={announced("2026-10-10T09:00:00+02:00")} />);
    expectShown("Angekündigt", "startet in 3 Tagen");
    rerender(<PhaseBadge phase={announced("2026-10-08T14:00:00+02:00")} />);
    expectShown("Angekündigt", "startet morgen 14:00");
    rerender(<PhaseBadge phase={announced("2026-10-07T14:00:00+02:00")} />);
    expectShown("Angekündigt", "startet heute 14:00");
    rerender(<PhaseBadge phase={announced("2026-10-07T10:45:00+02:00")} />);
    expectShown("Angekündigt", "startet in 45 Minuten");
  });

  test("Anmeldung und Check-in mit eigenem Verb", () => {
    const { rerender } = render(<PhaseBadge phase={{ state: "registration_open", label: "Anmeldung offen", target_at: "2026-10-09T18:00:00+02:00", countdown_kind: "registration_closes" }} />);
    expectShown("Anmeldung offen", "endet in 2 Tagen");
    rerender(<PhaseBadge phase={{ state: "registration_closed", label: "Anmeldung geschlossen", target_at: "2026-10-08T17:00:00+02:00", countdown_kind: "check_in_opens" }} />);
    expectShown("Anmeldung geschlossen", "Check-in morgen 17:00");
  });

  test("für Vorleseprogramme trennt ein Komma Schild und Countdown", () => {
    render(<PhaseBadge phase={announced("2026-10-10T09:00:00+02:00")} />);
    expect(chip().parentElement).toHaveTextContent("Angekündigt, startet in 3 Tagen");
  });

  test("die Schwelle aus den Einstellungen gilt: mit 30 Tagen zählt auch ein Termin in 20 Tagen", async () => {
    const { setCachedBranding } = await import("@/lib/brandingEvents");
    setCachedBranding({ countdown_days: 30 });
    try {
      render(<PhaseBadge phase={announced("2026-10-27T12:00:00+01:00")} />);
      expectShown("Angekündigt", "startet in 20 Tagen");
    } finally {
      setCachedBranding({});
    }
  });

  test("ein vergangener Zeitpunkt steht nicht als Countdown da", () => {
    render(<PhaseBadge phase={announced("2026-10-07T09:00:00+02:00")} />);
    expect(chip()).toHaveTextContent("Angekündigt");
    expect(screen.queryByTestId("phase-meta")).toBeNull();
  });
});

// Größen (#1306): klein 12,5 px, mittel und groß 14 px (Kopf der Turnier- und Event-Seite).
test("Größe: sm ist das kleine Schild, md und lg das große", () => {
  const { container } = render(<><PhaseBadge phase={{ state: "announced" }} /><PhaseBadge phase={{ state: "announced" }} size="md" /><PhaseBadge phase={{ state: "announced" }} size="lg" /></>);
  const [sm, md, lg] = container.querySelectorAll(".tls-status-chip");
  expect(sm).not.toHaveClass("tls-status-chip--lg");
  expect(md).toHaveClass("tls-status-chip--lg");
  expect(lg).toHaveClass("tls-status-chip--lg");
});
