import { fireEvent, render, screen } from "@testing-library/react";
import { AddToCalendar } from "./AddToCalendar";

// Ein Knopf „In den Kalender“ (#1272): ein Menü mit Kalender-Datei, Google und Outlook; mehrtägig „Alle Tage“ oder ein
// Tag; ohne Kennung baut der Browser die Datei; ohne Beginn kein Knopf.

const item = { id: "e1", kind: "event", slug: "sommerfest", title: "Sommerfest", start: "2026-12-12T18:00:00+01:00", location: "Vereinsheim", detail: "Vereinsevent", url: "https://lionsquad.at/events/sommerfest" };
const days = [
  { index: 1, label: "Fr 13.11.", start_at: "2026-11-13T16:00:00Z", end_at: "2026-11-13T22:00:00Z" },
  { index: 2, label: "Sa 14.11.", title: "Finals", start_at: "2026-11-14T09:00:00Z", end_at: "2026-11-14T22:00:00Z" },
  { index: 3, label: "So 15.11.", start_at: "2026-11-15T09:00:00Z", end_at: "2026-11-15T20:00:00Z" },
];

test("ein Knopf; das Menü zeigt Kalender-Datei vom Server, Google und Outlook", () => {
  render(<AddToCalendar item={item} />);
  expect(screen.getByTestId("add-to-calendar-button")).toHaveTextContent("In den Kalender");
  expect(screen.queryByTestId("add-to-calendar-menu")).toBeNull();
  fireEvent.click(screen.getByTestId("add-to-calendar-button"));
  expect(screen.getByTestId("add-to-calendar-button")).toHaveAttribute("aria-expanded", "true");
  const ics = screen.getByTestId("add-to-calendar-ics");
  expect(ics.tagName).toBe("A");
  expect(ics).toHaveAttribute("href", "/api/calendar/events/sommerfest.ics");
  expect(ics).toHaveAttribute("download");
  expect(ics).toHaveTextContent("Kalender-Datei");
  expect(screen.getByTestId("add-to-calendar-google")).toHaveAttribute("href", expect.stringContaining("calendar.google.com"));
  expect(screen.getByTestId("add-to-calendar-outlook")).toHaveAttribute("href", expect.stringContaining("outlook.live.com"));
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByTestId("add-to-calendar-menu")).toBeNull();
});

test("mehrtägig: alle Tage als eine Datei, ein Tag mit Google und Outlook", () => {
  render(<AddToCalendar item={item} days={days} />);
  fireEvent.click(screen.getByTestId("add-to-calendar-button"));
  expect(screen.getByTestId("add-to-calendar-scope-all")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("add-to-calendar-ics")).toHaveTextContent("allen 3 Tagen");
  expect(screen.getByTestId("add-to-calendar-ics")).toHaveAttribute("href", "/api/calendar/events/sommerfest.ics");
  expect(screen.queryByTestId("add-to-calendar-google")).toBeNull();
  expect(screen.getByTestId("add-to-calendar-pick-day")).toBeInTheDocument();

  fireEvent.click(screen.getByTestId("add-to-calendar-scope-2"));
  expect(screen.getByTestId("add-to-calendar-ics")).toHaveAttribute("href", "/api/calendar/events/sommerfest.ics?day=2");
  const google = decodeURIComponent(screen.getByTestId("add-to-calendar-google").getAttribute("href").replace(/\+/g, " "));
  expect(google).toContain("Sommerfest – Tag 2/3 · Finals");
  expect(google).toContain("20261114T090000Z/20261114T220000Z");
});

test("ohne Kennung baut der Browser die Datei; eigener Weg für Versammlungen; ohne Beginn kein Knopf", () => {
  const { unmount } = render(<AddToCalendar item={{ ...item, id: null, slug: null }} />);
  fireEvent.click(screen.getByTestId("add-to-calendar-button"));
  expect(screen.getByTestId("add-to-calendar-ics").tagName).toBe("BUTTON");
  unmount();
  const meeting = { id: "meeting-7", kind: "club", title: "Generalversammlung", start: "2026-10-24T16:00:00Z", icsPath: "/api/calendar/meetings/7.ics" };
  render(<AddToCalendar item={meeting} testId="meeting-calendar" />);
  fireEvent.click(screen.getByTestId("meeting-calendar-button"));
  expect(screen.getByTestId("meeting-calendar-ics")).toHaveAttribute("href", "/api/calendar/meetings/7.ics");
  const { container } = render(<AddToCalendar item={{ ...item, start: null }} />);
  expect(container.querySelector("[data-testid='add-to-calendar']")).toBeNull();
});
