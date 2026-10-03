import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MenuEntry, Widget, calendarEntry, season } from "./index.jsx";
import { SEASON_MODULES, hasModule } from "../registry";

// Adventkalender (#641): das kleine Türchen neben dem Logo - nur wenn für das Jahr Türchen angelegt sind.

function calendar(data = {}, overrides = {}) {
  return { key: "advent_calendar", effective: "normal", starts_at: "2026-12-01T00:00:00+01:00", ends_at: "2027-01-06T23:59:59+01:00", data: { today_door: 12, catch_up: false, door_hour: 6, ready: true, ...data }, ...overrides };
}

test("was das Türchen zeigt und sagt", () => {
  expect(calendarEntry(calendar())).toEqual({ door: 12, label: "Adventkalender – Türchen 12 ist offen", waiting: false, catchUp: false });
  expect(calendarEntry(calendar({ today_door: 0 }))).toEqual({ door: 1, label: "Adventkalender – das erste Türchen öffnet sich um 6 Uhr", waiting: true, catchUp: false, hour: 6 });
  expect(calendarEntry(calendar({ today_door: 24, catch_up: true }))).toEqual({ door: 24, label: "Adventkalender – alle Türchen sind offen, nachholen bis 6. Jänner", waiting: false, catchUp: true });
  expect(calendarEntry(calendar({ today_door: 99 })).door).toBe(24);
  expect(calendarEntry(calendar({ today_door: "7" })).door).toBe(7);
});

test("ohne angelegte Türchen kein Einstieg", () => {
  expect(calendarEntry(calendar({ ready: false }))).toBeNull();
  expect(calendarEntry({ key: "advent_calendar", data: { today_door: 5 } })).toBeNull();
  expect(calendarEntry(null)).toBeNull();
  const { container } = render(<MemoryRouter><Widget season={calendar({ ready: false })} /></MemoryRouter>);
  expect(container).toBeEmptyDOMElement();
});

test("der Einstieg führt zum Kalender und nennt das Türchen", () => {
  render(<MemoryRouter><Widget season={calendar()} /></MemoryRouter>);
  const link = screen.getByTestId("advent-calendar-widget");
  expect(link).toHaveAttribute("href", "/advent");
  expect(link).toHaveAccessibleName("Adventkalender – Türchen 12 ist offen");
  expect(link).toHaveAttribute("title", "Adventkalender – Türchen 12 ist offen");
  expect(link).toHaveAttribute("data-door", "12");
  expect(link.querySelector("text")).toHaveTextContent("12");
  expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  expect(link.className).toBe("tls-advcal");
});

test("dezent ohne Atmen, vor 6 Uhr ohne Licht", () => {
  const first = render(<MemoryRouter><Widget season={calendar({}, { effective: "subtle" })} /></MemoryRouter>);
  expect(screen.getByTestId("advent-calendar-widget").className).toBe("tls-advcal tls-advcal--subtle");
  first.unmount();
  render(<MemoryRouter><Widget season={calendar({ today_door: 0 })} /></MemoryRouter>);
  expect(screen.getByTestId("advent-calendar-widget").className).toBe("tls-advcal tls-advcal--waiting");
  expect(screen.getByTestId("advent-calendar-widget").querySelector("text")).toHaveTextContent("1");
});

test("im Register der Saisonen", async () => {
  expect(season.key).toBe("advent_calendar");
  expect(season.Widget).toBe(Widget);
  expect(season.MenuEntry).toBe(MenuEntry);
  expect(hasModule("advent_calendar")).toBe(true);
  expect((await SEASON_MODULES.advent_calendar()).season).toBe(season);
});

test("#852: oben im Handy-Menü - Türchen, Name und Stand; ein Tipp führt zum Kalender und schließt das Menü", () => {
  const onClose = vi.fn();
  const { rerender } = render(<MemoryRouter><MenuEntry season={calendar()} onClose={onClose} /></MemoryRouter>);
  const entry = screen.getByTestId("season-menu-advent-calendar");
  expect(entry).toHaveAttribute("href", "/advent");
  expect(entry).toHaveTextContent("Adventkalender");
  expect(entry).toHaveTextContent("Türchen 12 ist offen");
  entry.click();
  expect(onClose).toHaveBeenCalled();
  rerender(<MemoryRouter><MenuEntry season={calendar({ ready: false })} onClose={onClose} /></MemoryRouter>);
  expect(screen.queryByTestId("season-menu-advent-calendar")).toBeNull();
});
