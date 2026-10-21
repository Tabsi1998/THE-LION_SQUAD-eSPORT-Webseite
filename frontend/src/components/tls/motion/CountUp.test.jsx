import { act, render, screen } from "@testing-library/react";
import { CountUp } from "./CountUp";
import { COUNT_UP_MS } from "@/lib/countUp";

// Baustein „Hochzählen“ (#1950): beim ersten Anzeigen und bei neuem `playKey` von null auf den Wert, versetzt um
// `delay`; Wörter und „Bewegung reduzieren“ sofort; ein neuer Wert beim Nachladen spielt nicht neu ab.

const TIMERS = { toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout"] };

afterEach(() => {
  vi.useRealTimers();
});

function shown(id) {
  const node = screen.getByTestId(id);
  return node.querySelector("[aria-hidden='true']")?.textContent ?? node.textContent;
}

test("zählt hoch, ease-out, und endet genau beim Text vom Server", () => {
  vi.useFakeTimers(TIMERS);
  render(<CountUp value="31:55,056" data-testid="zeit" />);
  const cell = screen.getByTestId("zeit");
  expect(shown("zeit")).toBe("00:00,000");
  expect(cell).toHaveAttribute("data-counting", "true");
  // Screenreader hören nur den Endwert.
  expect(cell.querySelector(".sr-only")).toHaveTextContent("31:55,056");
  act(() => { vi.advanceTimersByTime(COUNT_UP_MS / 2); });
  expect(shown("zeit")).not.toBe("00:00,000");
  expect(shown("zeit").length).toBe("31:55,056".length);
  act(() => { vi.advanceTimersByTime(COUNT_UP_MS); });
  expect(cell).toHaveTextContent("31:55,056");
  expect(cell).not.toHaveAttribute("data-counting");
  expect(cell).toHaveClass("tabular-nums");
});

test("wartet die Versetzung ab und meldet das Ende", () => {
  vi.useFakeTimers(TIMERS);
  const done = vi.fn();
  render(<CountUp value="+0,261" delay={250} onDone={done} data-testid="abstand" />);
  act(() => { vi.advanceTimersByTime(200); });
  expect(shown("abstand")).toBe("+0,000");
  act(() => { vi.advanceTimersByTime(COUNT_UP_MS + 100); });
  expect(screen.getByTestId("abstand")).toHaveTextContent("+0,261");
  expect(done).toHaveBeenCalledTimes(1);
});

test("Wörter wie „+2 Runden“ und „Ausfall“ stehen sofort", () => {
  vi.useFakeTimers(TIMERS);
  const done = vi.fn();
  render(<><CountUp value="+2 Runden" data-testid="runden" onDone={done} /><CountUp value="Ausfall" data-testid="aus" /></>);
  expect(screen.getByTestId("runden")).toHaveTextContent("+2 Runden");
  expect(screen.getByTestId("aus")).toHaveTextContent("Ausfall");
  expect(screen.getByTestId("runden")).not.toHaveAttribute("data-counting");
  expect(done).toHaveBeenCalled();
});

test("ein neuer playKey spielt neu ab, ein neuer Wert beim Nachladen nicht", () => {
  vi.useFakeTimers(TIMERS);
  const { rerender } = render(<CountUp value="1:40,474" playKey="quali" data-testid="zeit" />);
  act(() => { vi.advanceTimersByTime(COUNT_UP_MS * 2); });
  expect(screen.getByTestId("zeit")).toHaveTextContent("1:40,474");
  rerender(<CountUp value="1:40,475" playKey="quali" data-testid="zeit" />);
  expect(screen.getByTestId("zeit")).toHaveTextContent("1:40,475");
  expect(screen.getByTestId("zeit")).not.toHaveAttribute("data-counting");
  rerender(<CountUp value="31:55,056" playKey="rennen" data-testid="zeit" />);
  expect(shown("zeit")).toBe("00:00,000");
  act(() => { vi.advanceTimersByTime(COUNT_UP_MS * 2); });
  expect(screen.getByTestId("zeit")).toHaveTextContent("31:55,056");
});

test("mit „Bewegung reduzieren“ und ohne play steht der Wert sofort", () => {
  const original = window.matchMedia;
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });
  try {
    render(<><CountUp value="31:55,056" data-testid="zeit" /><CountUp value="+6,197" play={false} data-testid="aus" /></>);
    expect(screen.getByTestId("zeit")).toHaveTextContent("31:55,056");
    expect(screen.getByTestId("zeit")).not.toHaveAttribute("data-counting");
    expect(screen.getByTestId("aus")).toHaveTextContent("+6,197");
  } finally {
    if (original) window.matchMedia = original;
    else delete window.matchMedia;
  }
});

// Eine Art zu zählen für die ganze Seite (#1969): Zahlen als Wert mit Schreibweise, vom alten Wert aus, erst beim
// Sichtbarwerden, und beim Live-Nachladen nur ein kurzes Aufleuchten.

test("eine Zahl als Wert zählt mit eigener Schreibweise", () => {
  vi.useFakeTimers(TIMERS);
  render(<CountUp value={1234} format={(value) => value.toLocaleString("de-DE")} data-testid="zahl" />);
  expect(shown("zahl")).toBe("0");
  expect(screen.getByTestId("zahl").querySelector(".sr-only")).toHaveTextContent("1.234");
  act(() => { vi.advanceTimersByTime(COUNT_UP_MS * 2); });
  expect(screen.getByTestId("zahl")).toHaveTextContent("1.234");
});

test("vom alten Wert aus: eine neue Bestzeit läuft von der alten zur neuen", () => {
  vi.useFakeTimers(TIMERS);
  render(<CountUp value="1:23,412" from="1:23.824" data-testid="zeit" />);
  expect(shown("zeit")).toBe("1:23,824");
  act(() => { vi.advanceTimersByTime(COUNT_UP_MS * 2); });
  expect(screen.getByTestId("zeit")).toHaveTextContent("1:23,412");
});

test("zählt erst, wenn der Wert ins Bild kommt", () => {
  vi.useFakeTimers(TIMERS);
  const observers = [];
  const original = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() {}
  };
  try {
    render(<CountUp value="35" data-testid="zahl" />);
    act(() => { vi.advanceTimersByTime(COUNT_UP_MS * 2); });
    expect(shown("zahl")).toBe("00");
    act(() => { observers[0].callback([{ isIntersecting: true }]); });
    act(() => { vi.advanceTimersByTime(COUNT_UP_MS * 2); });
    expect(screen.getByTestId("zahl")).toHaveTextContent("35");
  } finally {
    globalThis.IntersectionObserver = original;
  }
});

test("Live-Nachladen: ein neuer Wert zählt nicht neu, er leuchtet einmal auf", () => {
  vi.useFakeTimers(TIMERS);
  const { rerender } = render(<CountUp value={12} data-testid="punkte" />);
  act(() => { vi.advanceTimersByTime(COUNT_UP_MS * 2); });
  expect(screen.getByTestId("punkte")).not.toHaveAttribute("data-glow");
  rerender(<CountUp value={15} data-testid="punkte" />);
  expect(screen.getByTestId("punkte")).toHaveTextContent("15");
  expect(screen.getByTestId("punkte")).not.toHaveAttribute("data-counting");
  expect(screen.getByTestId("punkte")).toHaveAttribute("data-glow", "on");
  expect(screen.getByTestId("punkte")).toHaveClass("tls-glow");
});

test("ein Wert, der erst nach dem Laden kommt, zählt dann noch", () => {
  vi.useFakeTimers(TIMERS);
  const { rerender } = render(<CountUp value="" data-testid="zahl" />);
  act(() => { vi.advanceTimersByTime(COUNT_UP_MS); });
  rerender(<CountUp value="42" data-testid="zahl" />);
  expect(shown("zahl")).toBe("00");
  act(() => { vi.advanceTimersByTime(COUNT_UP_MS * 2); });
  expect(screen.getByTestId("zahl")).toHaveTextContent("42");
  expect(screen.getByTestId("zahl")).not.toHaveAttribute("data-glow");
});