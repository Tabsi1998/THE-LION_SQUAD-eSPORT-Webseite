import { act, render } from "@testing-library/react";
import { emitApiInvalidation } from "@/lib/apiInvalidation";
import { useApiInvalidation } from "./useApiInvalidation";

// Live-Nachladen je Turnier (#1801): wie useLiveRefresh lädt eine Ansicht eines Turniers nur bei Änderungen dieses
// Turniers nach; Meldungen ohne Turnier und Ansichten, die ihr Turnier noch nicht kennen, laden wie bisher.

function View({ load, resources, options }) {
  useApiInvalidation(load, resources, options);
  return null;
}

const change = (tournamentId) => emitApiInvalidation({
  resource: "tournaments", path: "/api/tournaments", ...(tournamentId ? { tournament_id: tournamentId } : {}),
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("eigenes Turnier lädt, fremdes nicht, ohne Turnier wie bisher", () => {
  const load = vi.fn();
  render(<View load={load} resources={["tournaments"]} options={{ tournamentId: "t1" }} />);

  act(() => {
    change("t2");
    vi.advanceTimersByTime(300);
  });
  expect(load).not.toHaveBeenCalled();

  act(() => {
    change("t1");
    vi.advanceTimersByTime(300);
  });
  expect(load).toHaveBeenCalledTimes(1);

  act(() => {
    change(null);
    vi.advanceTimersByTime(300);
  });
  expect(load).toHaveBeenCalledTimes(2);
});

test("ohne bekanntes Turnier lädt jede passende Änderung - danach nur die eigene", () => {
  const load = vi.fn();
  const view = render(<View load={load} resources={["tournaments"]} />);

  act(() => {
    change("t2");
    vi.advanceTimersByTime(300);
  });
  expect(load).toHaveBeenCalledTimes(1);

  view.rerender(<View load={load} resources={["tournaments"]} options={{ tournamentId: "t1" }} />);
  act(() => {
    change("t2");
    vi.advanceTimersByTime(300);
  });
  expect(load).toHaveBeenCalledTimes(1);
});
