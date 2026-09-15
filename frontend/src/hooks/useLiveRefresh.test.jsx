import { act, render } from "@testing-library/react";
import { emitApiInvalidation, setStreamConnected } from "@/lib/apiInvalidation";
import { useLiveRefresh } from "./useLiveRefresh";

// Der Ersatz für 25 setInterval-Aufrufe im Web (#221): Solange der
// Änderungsstrom steht, lädt eine Ansicht nur bei passender Änderung; fällt
// er weg, fragt sie im Takt nach.

function View({ load, resources, options }) {
  useLiveRefresh(load, resources, options);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  setStreamConnected(false);
});

afterEach(() => {
  setStreamConnected(false);
  vi.useRealTimers();
});

test("mit Strom keine Abfrage im Takt, ohne Strom schon", () => {
  const load = vi.fn();
  act(() => setStreamConnected(true));
  render(<View load={load} resources={["tournaments"]} options={{ fallbackMs: 1000 }} />);

  act(() => {
    vi.advanceTimersByTime(3500);
  });
  expect(load).not.toHaveBeenCalled();

  act(() => setStreamConnected(false));
  act(() => {
    vi.advanceTimersByTime(2100);
  });
  expect(load).toHaveBeenCalledTimes(2);
});

test("eine passende Änderung lädt einmal, eine fremde gar nicht", () => {
  const load = vi.fn();
  act(() => setStreamConnected(true));
  render(<View load={load} resources={["tournaments"]} options={{ fallbackMs: 1000 }} />);

  act(() => {
    emitApiInvalidation({ resource: "news", path: "/api/news" });
    vi.advanceTimersByTime(300);
  });
  expect(load).not.toHaveBeenCalled();

  act(() => {
    emitApiInvalidation({ resource: "tournaments", path: "/api/tournaments/t-1" });
    emitApiInvalidation({ resource: "matches", path: "/api/matches/m-1" });
    vi.advanceTimersByTime(300);
  });
  expect(load).toHaveBeenCalledTimes(1);
});

test("nach einer Unterbrechung lädt die Ansicht einmal nach", () => {
  const load = vi.fn();
  act(() => setStreamConnected(true));
  render(<View load={load} resources={["tournaments"]} options={{ fallbackMs: 1000 }} />);

  act(() => setStreamConnected(false));
  act(() => setStreamConnected(true));
  act(() => {
    vi.advanceTimersByTime(300);
  });
  expect(load).toHaveBeenCalledTimes(1);

  // Danach wieder still: kein Takt, solange der Strom steht.
  act(() => {
    vi.advanceTimersByTime(3000);
  });
  expect(load).toHaveBeenCalledTimes(1);
});

test("abgeschaltet lädt nichts, auch nicht ohne Strom", () => {
  const load = vi.fn();
  render(<View load={load} resources={["messages"]} options={{ fallbackMs: 500, enabled: false }} />);

  act(() => {
    emitApiInvalidation({ resource: "messages", path: "/api/messages" });
    vi.advanceTimersByTime(2000);
  });
  expect(load).not.toHaveBeenCalled();
});

test("pollMs fragt auch mit Strom im Takt - für Daten, die der Strom nie meldet", () => {
  const load = vi.fn();
  act(() => setStreamConnected(true));
  render(<View load={load} resources={["streams"]} options={{ pollMs: 1000 }} />);

  act(() => {
    vi.advanceTimersByTime(2100);
  });
  expect(load).toHaveBeenCalledTimes(2);
});

test("ein versteckter Tab fragt im Takt nicht nach", () => {
  const load = vi.fn();
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  render(<View load={load} resources={["tournaments"]} options={{ fallbackMs: 500 }} />);

  act(() => {
    vi.advanceTimersByTime(1600);
  });
  expect(load).not.toHaveBeenCalled();

  hidden.mockReturnValue(false);
  act(() => {
    vi.advanceTimersByTime(500);
  });
  expect(load).toHaveBeenCalledTimes(1);
  hidden.mockRestore();
});
