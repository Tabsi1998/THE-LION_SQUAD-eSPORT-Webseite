import { act, render, screen } from "@testing-library/react";
import { useChangedKeys, useCountdown, useFlipRows } from "./useLiveChanges";

// Dynamik-Block: Änderungen sind ein paar Sekunden sichtbar, der erste Stand zählt nicht,
// Zeilen gleiten - außer mit „Bewegung reduzieren“.

function Rows({ rows, holdMs }) {
  const changed = useChangedKeys(rows, (r) => r.id, (r) => String(r.points), { holdMs });
  const register = useFlipRows(rows, (r) => r.id);
  return (
    <ul>
      {rows.map((row) => (
        <li key={row.id} ref={register(row.id)} data-testid={`row-${row.id}`} data-changed={changed.has(row.id) ? "true" : undefined}>{row.id}: {row.points}</li>
      ))}
    </ul>
  );
}

afterEach(() => {
  vi.useRealTimers();
  delete window.matchMedia;
});

test("beim ersten Stand ist nichts neu; eine Änderung leuchtet und erlischt wieder", () => {
  vi.useFakeTimers();
  const { rerender } = render(<Rows rows={[{ id: "a", points: 1 }, { id: "b", points: 1 }]} holdMs={1000} />);
  expect(screen.getByTestId("row-a")).not.toHaveAttribute("data-changed");

  rerender(<Rows rows={[{ id: "a", points: 4 }, { id: "b", points: 1 }]} holdMs={1000} />);
  expect(screen.getByTestId("row-a")).toHaveAttribute("data-changed", "true");
  expect(screen.getByTestId("row-b")).not.toHaveAttribute("data-changed");

  act(() => { vi.advanceTimersByTime(1100); });
  expect(screen.getByTestId("row-a")).not.toHaveAttribute("data-changed");
});

test("Zeilen gleiten auf den neuen Platz - nicht mit „Bewegung reduzieren“", () => {
  const animate = vi.fn();
  window.Element.prototype.animate = animate;
  let top = 0;
  vi.spyOn(window.Element.prototype, "getBoundingClientRect").mockImplementation(function rect() {
    // jede Zeile hat eine andere Höhe je Reihenfolge im DOM
    const index = [...this.parentNode.children].indexOf(this);
    return { top: index * 40 + top, left: 0, width: 100, height: 40 };
  });
  const { rerender } = render(<Rows rows={[{ id: "a", points: 1 }, { id: "b", points: 2 }]} />);
  rerender(<Rows rows={[{ id: "b", points: 2 }, { id: "a", points: 1 }]} />);
  expect(animate).toHaveBeenCalledTimes(2);
  expect(animate.mock.calls[0][0][0].transform).toMatch(/translateY\((-?40)px\)/);

  animate.mockClear();
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  const reduced = render(<Rows rows={[{ id: "x", points: 1 }, { id: "y", points: 2 }]} />);
  reduced.rerender(<Rows rows={[{ id: "y", points: 2 }, { id: "x", points: 1 }]} />);
  expect(animate).not.toHaveBeenCalled();
  top = 0;
});

function Countdown({ target }) {
  return <span data-testid="countdown">{useCountdown(target)}</span>;
}

test("der Countdown tickt und wird leer ohne Ziel", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-22T10:00:00Z"));
  const target = Date.parse("2026-09-22T10:20:00Z");
  const { rerender } = render(<Countdown target={target} />);
  expect(screen.getByTestId("countdown")).toHaveTextContent("in 20 Minuten");
  act(() => { vi.advanceTimersByTime(5 * 60 * 1000); });
  expect(screen.getByTestId("countdown")).toHaveTextContent("in 15 Minuten");
  rerender(<Countdown target={null} />);
  expect(screen.getByTestId("countdown")).toHaveTextContent("");
});
