import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Hinweis auf den Adventkalender (#641) im Dashboard - nur solange er läuft und Türchen angelegt sind.

const context = { byKey: {} };
vi.mock("@/seasons/SeasonContext", () => ({ useSeason: () => context }));

const { AdventHint, hintText } = await import("./AdventHint");
const { isAdventCalendarOpen, closeAdventCalendar } = await import("./calendarDialog");

afterEach(() => closeAdventCalendar());

function calendar(data = {}, effective = "normal") {
  return { key: "advent_calendar", effective, data: { today_door: 12, catch_up: false, door_hour: 6, ready: true, ...data } };
}

function show() {
  return render(<MemoryRouter><AdventHint /></MemoryRouter>);
}

test("läuft der Kalender, steht der Weg dorthin da", () => {
  context.byKey = { advent_calendar: calendar() };
  show();
  const hint = screen.getByTestId("advent-hint");
  expect(hint).toHaveTextContent("AdventkalenderTürchen 12 ist offen – schau hinein.");
  expect(screen.getByTestId("advent-hint-link")).toHaveTextContent("Zum Kalender");
  // Seit #963 öffnet „Zum Kalender“ das Fenster über der Seite - kein Seitenwechsel.
  expect(isAdventCalendarOpen()).toBe(false);
  screen.getByTestId("advent-hint-link").click();
  expect(isAdventCalendarOpen()).toBe(true);
  // Die Zeichnung ist Schmuck: kein Link, nichts zum Vorlesen.
  expect(hint.querySelectorAll("a")).toHaveLength(0);
  expect(hint.querySelector(".tls-advcal")).toHaveAttribute("aria-hidden", "true");
});

test("vor 6 Uhr am ersten Tag und beim Nachholen", () => {
  context.byKey = { advent_calendar: calendar({ today_door: 0 }) };
  const first = show();
  expect(screen.getByTestId("advent-hint")).toHaveTextContent("Das erste Türchen geht heute um 6 Uhr auf.");
  first.unmount();
  context.byKey = { advent_calendar: calendar({ today_door: 24, catch_up: true }) };
  show();
  expect(screen.getByTestId("advent-hint")).toHaveTextContent("Alle 24 Türchen sind offen – nachholen kannst du bis 6. Jänner.");
  expect(hintText(null)).toBe("");
});

test("kein Hinweis ohne Kalender, ohne Türchen oder wenn die Person die Deko abgeschaltet hat", () => {
  for (const byKey of [{}, { advent_calendar: calendar({ ready: false }) }, { advent_calendar: calendar({}, "off") }, { advent: { key: "advent", data: {} } }]) {
    context.byKey = byKey;
    const view = show();
    expect(view.container).toBeEmptyDOMElement();
    view.unmount();
  }
});
