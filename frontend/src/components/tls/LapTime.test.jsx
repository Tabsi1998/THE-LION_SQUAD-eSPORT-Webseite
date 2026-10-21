import { act, render, screen } from "@testing-library/react";
import { LAP_COUNT_MS, LapTime, firstShow, formatLapLike, introOnce, parseLap } from "./LapTime";

// Timing-Board (#1077): Rundenzeiten zählen beim ersten Erscheinen einmal hoch. Am Ende steht exakt der Text vom
// Server - angezeigt mit Komma (#1969, wie lib/raceTime); ohne `play` und mit „Bewegung reduzieren“ steht er sofort da.
// Gezählt wird mit dem einen Baustein CountUp: während des Zählens steht die Zahl im Teil für die Augen.

function shown(cell) {
  return cell.querySelector("[aria-hidden='true']")?.textContent ?? cell.textContent;
}

// Gezählt wird nur, wenn der Browser zu „Bewegung reduzieren“ Auskunft gibt (#1969) - hier: keine Einschränkung.
beforeEach(() => {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete window.matchMedia;
});

test("parseLap liest Minuten, Sekunden und Bruchteile; Unsinn ergibt null", () => {
  expect(parseLap("1:24.587")).toBe(84587);
  expect(parseLap("59.123")).toBe(59123);
  expect(parseLap("1:02:03.456")).toBe(3723456);
  expect(parseLap("1:24,5")).toBe(84500);
  expect(parseLap("DNF")).toBeNull();
  expect(parseLap("")).toBeNull();
  expect(parseLap(null)).toBeNull();
});

test("formatLapLike hält die Form der Vorlage: gleiche Stellen, gleiches Trennzeichen", () => {
  expect(formatLapLike(84587, "1:24.587")).toBe("1:24.587");
  expect(formatLapLike(0, "1:24.587")).toBe("0:00.000");
  expect(formatLapLike(9050, "59.123")).toBe("09.050");
  expect(formatLapLike(3723456, "1:02:03.456")).toBe("1:02:03.456");
  expect(formatLapLike(84500, "1:24,5")).toBe("1:24,5");
  expect(formatLapLike(1000, "DNF")).toBe("DNF");
});

test("ohne play steht die Zeit sofort da, mit Komma - auch ein Text, der keine Zeit ist", () => {
  render(<><LapTime value="1:24.587" data-testid="zeit" /><LapTime value="DNF" play data-testid="dnf" /></>);
  expect(screen.getByTestId("zeit")).toHaveTextContent("1:24,587");
  expect(screen.getByTestId("zeit")).not.toHaveAttribute("data-counting");
  expect(screen.getByTestId("dnf")).toHaveTextContent("DNF");
  expect(screen.getByTestId("dnf")).not.toHaveAttribute("data-counting");
});

test("mit play zählt die Zeit hoch und endet exakt beim Text vom Server", () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout"] });
  render(<LapTime value="1:24.587" play data-testid="zeit" />);
  const cell = screen.getByTestId("zeit");
  expect(shown(cell)).toBe("0:00,000");
  expect(cell).toHaveAttribute("data-counting", "true");
  act(() => { vi.advanceTimersByTime(LAP_COUNT_MS / 2); });
  const half = parseLap(shown(cell));
  expect(half).toBeGreaterThan(40000);
  expect(half).toBeLessThan(84587);
  act(() => { vi.advanceTimersByTime(LAP_COUNT_MS); });
  expect(cell).toHaveTextContent("1:24,587");
  expect(cell).not.toHaveAttribute("data-counting");
});

test("mit „Bewegung reduzieren“ zählt nichts", () => {
  // jsdom kennt kein matchMedia - hier sagt es: Bewegung reduzieren.
  const original = window.matchMedia;
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });
  try {
    render(<LapTime value="1:24.587" play data-testid="zeit" />);
    expect(screen.getByTestId("zeit")).toHaveTextContent("1:24,587");
    expect(screen.getByTestId("zeit")).not.toHaveAttribute("data-counting");
  } finally {
    if (original) window.matchMedia = original;
    else delete window.matchMedia;
  }
});

test("firstShow: einmal je Schlüssel, ohne Speicher immer", () => {
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  expect(firstShow("fastlap:a", storage)).toBe(true);
  expect(firstShow("fastlap:a", storage)).toBe(false);
  expect(firstShow("fastlap:b", storage)).toBe(true);
  expect(firstShow("fastlap:c", { getItem() { throw new Error("gesperrt"); } })).toBe(true);
  expect(firstShow("fastlap:d", null)).toBe(true);
});

test("introOnce: der erste Auftritt gilt nur, solange das Hochzählen dauert, und nur einmal je Besuch", () => {
  vi.useFakeTimers();
  expect(introOnce("")).toBe(false);
  expect(introOnce("probe:liste-1")).toBe(true);
  // Dieselbe Liste, derselbe Augenblick (weitere Zeilen): weiter der erste Auftritt.
  expect(introOnce("probe:liste-1")).toBe(true);
  act(() => { vi.advanceTimersByTime(LAP_COUNT_MS + 400); });
  expect(introOnce("probe:liste-1")).toBe(false);
  window.sessionStorage.setItem("tls.shown.probe:liste-2", "1");
  expect(introOnce("probe:liste-2")).toBe(false);
});

test("neue Bestzeit (#1585): mit from läuft die Zeit kurz von der alten zur neuen - kürzer als beim ersten Auftritt", () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout"] });
  render(<LapTime value="1:23.412" play from={83824} duration={LAP_COUNT_MS / 2} data-testid="zeit" />);
  const cell = screen.getByTestId("zeit");
  expect(shown(cell)).toBe("1:23,824");
  act(() => { vi.advanceTimersByTime(LAP_COUNT_MS / 4); });
  const half = parseLap(shown(cell));
  expect(half).toBeLessThan(83824);
  expect(half).toBeGreaterThanOrEqual(83412);
  act(() => { vi.advanceTimersByTime(LAP_COUNT_MS); });
  expect(cell).toHaveTextContent("1:23,412");
});
