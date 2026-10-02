import { fireEvent, render, screen } from "@testing-library/react";

// Adventkranz und Adventkalender (#641): läuft der Kalender, sagt der Kranz auch, welches Türchen offen ist.

const context = { byKey: {} };
vi.mock("../SeasonContext", () => ({ useSeason: () => context }));

const { Widget } = await import("./index.jsx");

const SUNDAYS = ["2026-11-29", "2026-12-06", "2026-12-13", "2026-12-20"];
const advent = { key: "advent", effective: "normal", starts_at: "2026-11-29T00:00:00+01:00", data: { candles: 2, days_to_christmas: 17, sundays: SUNDAYS } };
const storage = { getItem: () => null, setItem: () => {} };

beforeEach(() => {
  window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
});

function label(calendar) {
  context.byKey = calendar ? { advent_calendar: { key: "advent_calendar", data: calendar } } : {};
  const view = render(<Widget season={advent} now={new Date(2026, 11, 7, 18)} storage={storage} />);
  const text = screen.getByTestId("advent-wreath").getAttribute("aria-label");
  fireEvent.click(screen.getByTestId("advent-wreath"));
  expect(screen.getByTestId("advent-note")).toHaveTextContent(text);
  view.unmount();
  return text;
}

test("mit Kalender nennt der Kranz das Türchen", () => {
  expect(label({ ready: true, today_door: 7, catch_up: false })).toBe("2. Advent – noch 17 Tage bis Weihnachten · Türchen 7 ist offen");
});

test("ohne Kalender, ohne Türchen, vor 6 Uhr am ersten Tag und beim Nachholen bleibt es beim Advent", () => {
  const plain = "2. Advent – noch 17 Tage bis Weihnachten";
  expect(label(null)).toBe(plain);
  expect(label({ ready: false, today_door: 7, catch_up: false })).toBe(plain);
  expect(label({ ready: true, today_door: 0, catch_up: false })).toBe(plain);
  expect(label({ ready: true, today_door: 24, catch_up: true })).toBe(plain);
});
