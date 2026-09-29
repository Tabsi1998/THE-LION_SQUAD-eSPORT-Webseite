import { act, fireEvent, render, screen } from "@testing-library/react";

// Adventkranz (S6, W1): Kerzen nach dem Server (oder der Uhr), jede anders; Text zum Kranz; Anzünden am Sonntag der
// Kerze einmal je Tag; ohne Bewegung kein Streichholz; „dezent“ ohne Wind; Jahres-Seed.

const { Widget, Wreath, adventData, dripPath, season } = await import("./index.jsx");
const { wreathLayout } = await import("./wreath");
const { STORAGE_KEY } = await import("./ignition");

const SUNDAYS = ["2026-11-29", "2026-12-06", "2026-12-13", "2026-12-20"];

function advent(overrides = {}, data = {}) {
  return { key: "advent", effective: "normal", starts_at: "2026-11-29T00:00:00+01:00", ends_at: "2026-12-26T23:59:59+01:00", texts: {}, data: { candles: 2, days_to_christmas: 17, sundays: SUNDAYS, ...data }, ...overrides };
}

function memory(initial = {}) {
  const store = { ...initial };
  return { getItem: (key) => (key in store ? store[key] : null), setItem: (key, value) => { store[key] = String(value); }, store };
}

let matchMediaMatches = false;

beforeEach(() => {
  window.matchMedia = vi.fn(() => ({ matches: matchMediaMatches, addEventListener: () => {}, removeEventListener: () => {} }));
});

afterEach(() => {
  vi.useRealTimers();
  matchMediaMatches = false;
});

test("Daten: vom Server, sonst aus der Uhr; Kerzen gedeckelt", () => {
  const now = new Date(2026, 11, 7, 18);
  expect(adventData(advent(), now)).toEqual({ year: 2026, today: "2026-12-07", sundays: SUNDAYS, candles: 2, daysToChristmas: 17 });
  expect(adventData(advent({}, { candles: 9, days_to_christmas: -3 }), now)).toMatchObject({ candles: 4, daysToChristmas: 0 });
  expect(adventData({ key: "advent", data: {} }, new Date(2026, 11, 13, 9))).toEqual({ year: 2026, today: "2026-12-13", sundays: SUNDAYS, candles: 3, daysToChristmas: 11 });
  expect(adventData(null, new Date(2027, 11, 5, 9))).toMatchObject({ year: 2027, candles: 2, daysToChristmas: 19 });
  expect(dripPath(10, 20, 4, 1)).toMatch(/^M 10 20 c 1 1\.40/);
  expect(dripPath(10, 20, 4, -1)).toContain("c -1 1.40");
});

test("Kranz: vier Kerzen, zwei brennen, jede Flamme mit eigener Dauer; Wachs bei der ersten länger als bei der zweiten", () => {
  render(<Widget season={advent()} now={new Date(2026, 11, 7, 18)} storage={memory()} />);
  const candles = screen.getAllByTestId("advent-candle");
  expect(candles).toHaveLength(4);
  expect(candles.map((candle) => candle.getAttribute("data-lit"))).toEqual(["1", "1", "0", "0"]);
  const flames = screen.getAllByTestId("advent-flame");
  expect(flames).toHaveLength(2);
  const durations = flames.map((flame) => flame.style.getPropertyValue("--flame-dur"));
  expect(new Set(durations).size).toBe(2);
  expect(durations.every((value) => /^\d+(\.\d+)?s$/.test(value))).toBe(true);
  expect(screen.queryByTestId("advent-match")).toBeNull();
  expect(screen.getByTestId("advent-widget").getAttribute("data-candles")).toBe("2");
  expect(screen.getByTestId("advent-wreath").getAttribute("aria-label")).toBe("2. Advent – noch 17 Tage bis Weihnachten");
  // Wachs: die erste Kerze brennt seit acht Tagen, die zweite seit einem - nur die erste hat schon eine Spur.
  const paths = candles.map((candle) => candle.querySelectorAll("path").length);
  expect(paths[0]).toBe(1);
  expect(paths[1]).toBe(1);
  expect(paths[2]).toBe(0);
});

test("Klick zeigt den Text zum Kranz und blendet ihn wieder aus", () => {
  vi.useFakeTimers();
  render(<Widget season={advent({}, { candles: 4, days_to_christmas: 0 })} now={new Date(2026, 11, 24, 18)} storage={memory()} />);
  expect(screen.queryByTestId("advent-note")).toBeNull();
  fireEvent.click(screen.getByTestId("advent-wreath"));
  expect(screen.getByTestId("advent-note")).toHaveTextContent("Heiligabend – alle vier Kerzen brennen");
  act(() => {
    vi.advanceTimersByTime(4100);
  });
  expect(screen.queryByTestId("advent-note")).toBeNull();
});

test("Anzünden: am Sonntag der zweiten Kerze brennt sie beim ersten Aufruf an, dann ruhig; beim zweiten Aufruf des Tages nicht mehr; am Montag nie", () => {
  vi.useFakeTimers();
  const storage = memory();
  const sunday = new Date(2026, 11, 6, 10);
  const { unmount } = render(<Widget season={advent({}, { candles: 2, days_to_christmas: 18 })} now={sunday} storage={storage} />);
  expect(screen.getAllByTestId("advent-match")).toHaveLength(1);
  const fire = screen.getAllByTestId("advent-flame")[1];
  expect(fire.className.baseVal).toContain("tls-advent__fire--lighting");
  expect(JSON.parse(storage.store[STORAGE_KEY])).toEqual({ 2026: { 1: "2026-12-06" } });
  act(() => {
    vi.advanceTimersByTime(1600);
  });
  expect(screen.queryByTestId("advent-match")).toBeNull();
  expect(screen.getAllByTestId("advent-flame")[1].className.baseVal).toContain("tls-advent__fire--calm");
  act(() => {
    vi.advanceTimersByTime(4100);
  });
  expect(screen.getAllByTestId("advent-flame")[1].className.baseVal).not.toContain("tls-advent__fire--calm");
  unmount();
  render(<Widget season={advent({}, { candles: 2, days_to_christmas: 18 })} now={sunday} storage={storage} />);
  expect(screen.queryByTestId("advent-match")).toBeNull();
  screen.getAllByTestId("advent-flame").forEach((flame) => expect(flame.className.baseVal).not.toContain("lighting"));
  unmount;
  render(<Widget season={advent({}, { candles: 2, days_to_christmas: 17 })} now={new Date(2026, 11, 7, 10)} storage={memory()} />);
  expect(screen.queryByTestId("advent-match")).toBeNull();
});

test("Bewegung reduzieren: kein Streichholz, aber der Tag gilt als angezündet; dezent: Klasse ohne Wind", () => {
  matchMediaMatches = true;
  const storage = memory();
  render(<Widget season={advent({}, { candles: 1, days_to_christmas: 25 })} now={new Date(2026, 10, 29, 10)} storage={storage} />);
  expect(screen.queryByTestId("advent-match")).toBeNull();
  expect(screen.getAllByTestId("advent-flame")).toHaveLength(1);
  expect(JSON.parse(storage.store[STORAGE_KEY])).toEqual({ 2026: { 0: "2026-11-29" } });
  matchMediaMatches = false;
  render(<Widget season={advent({ effective: "subtle" })} now={new Date(2026, 11, 7, 10)} storage={memory()} />);
  expect(screen.getAllByTestId("advent-widget")[1].className).toContain("tls-advent--subtle");
});

test("Jahres-Seed: der Kranz eines Jahres ist immer derselbe, im nächsten Jahr ein anderer; ohne Speicher kein Fehler", () => {
  const { container } = render(<Wreath layout={wreathLayout(2026)} candles={4} daysLit={[25, 18, 11, 4]} />);
  expect(container.querySelector("svg").getAttribute("data-year")).toBe("2026");
  expect(container.querySelectorAll("[data-testid='advent-flame']")).toHaveLength(4);
  const first = container.innerHTML.replace(/:r[a-z0-9]+:/g, "");
  const again = render(<Wreath layout={wreathLayout(2026)} candles={4} daysLit={[25, 18, 11, 4]} />).container.innerHTML.replace(/:r[a-z0-9]+:/g, "");
  expect(again.replace(/r[0-9a-z]+-/g, "")).toBe(first.replace(/r[0-9a-z]+-/g, ""));
  render(<Widget season={advent({ starts_at: "2027-11-28T00:00:00+01:00" })} now={new Date(2027, 11, 5, 10)} storage={null} />);
  expect(screen.getAllByTestId("advent-widget")).toHaveLength(1);
  expect(season.Widget).toBe(Widget);
  expect(season.accent).toContain("rgba");
});
