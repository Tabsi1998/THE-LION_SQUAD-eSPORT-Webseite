import { act, render } from "@testing-library/react";
import { emitApiInvalidation, setStreamConnected } from "@/lib/apiInvalidation";
import { LIVE_REFRESH_STUCK_MS, useLiveRefresh } from "./useLiveRefresh";

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

// Live-Nachladen je Turnier (#1801): Seiten eines Turniers laden nur bei Änderungen dieses Turniers nach.
const tournamentChange = (tournamentId) => emitApiInvalidation({
  resource: "tournaments", path: "/api/tournaments", ...(tournamentId ? { tournament_id: tournamentId } : {}),
});

test("mit tournamentId lädt nur das eigene Turnier - und eine Meldung ohne Turnier", () => {
  const load = vi.fn();
  act(() => setStreamConnected(true));
  render(<View load={load} resources={["tournaments"]} options={{ tournamentId: "t1" }} />);

  act(() => {
    tournamentChange("t2");
    vi.advanceTimersByTime(300);
  });
  expect(load).not.toHaveBeenCalled();

  act(() => {
    tournamentChange("t1");
    vi.advanceTimersByTime(300);
  });
  expect(load).toHaveBeenCalledTimes(1);

  act(() => {
    tournamentChange(null);
    vi.advanceTimersByTime(300);
  });
  expect(load).toHaveBeenCalledTimes(2);
});

test("bevor die Seite ihr Turnier kennt, lädt jede Änderung - danach nur die eigene, ohne die wartende zu verlieren", () => {
  const load = vi.fn();
  act(() => setStreamConnected(true));
  const view = render(<View load={load} resources={["tournaments"]} options={{ tournamentId: null }} />);

  act(() => {
    tournamentChange("t2");
    vi.advanceTimersByTime(100);
  });
  // Die Seite hat ihr Turnier geladen, während die Änderung noch entprellt wird.
  view.rerender(<View load={load} resources={["tournaments"]} options={{ tournamentId: "t1" }} />);
  act(() => {
    vi.advanceTimersByTime(200);
  });
  expect(load).toHaveBeenCalledTimes(1);

  act(() => {
    tournamentChange("t2");
    vi.advanceTimersByTime(300);
  });
  expect(load).toHaveBeenCalledTimes(1);
});

test("mit Stationen lädt auch ein anderes Turnier desselben Events", () => {
  const load = vi.fn();
  act(() => setStreamConnected(true));
  render(<View load={load} resources={["tournaments", "stations"]} options={{ tournamentId: "t1", eventId: "e1" }} />);

  act(() => {
    emitApiInvalidation({ resource: "tournaments", path: "/api/tournaments", tournament_id: "t9", parent_event_id: "e9" });
    vi.advanceTimersByTime(300);
  });
  expect(load).not.toHaveBeenCalled();

  act(() => {
    emitApiInvalidation({ resource: "tournaments", path: "/api/tournaments", tournament_id: "t2", parent_event_id: "e1" });
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

// Lasttest (#1683): Bei vielen Zuschauern und langsamem Server startete jede Meldung eine neue Abfrage, während die
// alten noch liefen - die Abfragen stapelten sich. Jetzt läuft je Ansicht höchstens eine, danach genau eine nach.
function slowLoad() {
  const finishers = [];
  const load = vi.fn(() => new Promise((resolve) => finishers.push(resolve)));
  return { load, finish: () => finishers.shift()?.() };
}

const change = () => emitApiInvalidation({ resource: "tournaments", path: "/api/tournaments/t-1" });

test("während eine Abfrage läuft, startet keine zweite - danach genau eine", async () => {
  const { load, finish } = slowLoad();
  act(() => setStreamConnected(true));
  render(<View load={load} resources={["tournaments"]} />);

  act(() => {
    change();
    vi.advanceTimersByTime(200);
  });
  expect(load).toHaveBeenCalledTimes(1);

  act(() => {
    change();
    vi.advanceTimersByTime(200);
    change();
    vi.advanceTimersByTime(200);
  });
  expect(load).toHaveBeenCalledTimes(1);

  await act(async () => finish());
  expect(load).toHaveBeenCalledTimes(2);

  // Ohne neue Meldung bleibt es dabei.
  await act(async () => finish());
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(load).toHaveBeenCalledTimes(2);
});

test("auch die Abfrage im Takt wartet auf die laufende", async () => {
  const { load, finish } = slowLoad();
  render(<View load={load} resources={["tournaments"]} options={{ fallbackMs: 1000 }} />);

  act(() => {
    vi.advanceTimersByTime(3100);
  });
  expect(load).toHaveBeenCalledTimes(1);

  await act(async () => finish());
  expect(load).toHaveBeenCalledTimes(2);
});

test("eine hängende Abfrage blockiert nicht: nach 30 s darf eine neue starten", () => {
  const { load } = slowLoad();
  act(() => setStreamConnected(true));
  render(<View load={load} resources={["tournaments"]} />);

  act(() => {
    change();
    vi.advanceTimersByTime(200);
  });
  expect(load).toHaveBeenCalledTimes(1);

  act(() => {
    vi.advanceTimersByTime(LIVE_REFRESH_STUCK_MS);
    change();
    vi.advanceTimersByTime(200);
  });
  expect(load).toHaveBeenCalledTimes(2);
});

test("overlap: Abfragen dürfen sich überlappen (TV-Baum ordnet Antworten selbst)", () => {
  const { load } = slowLoad();
  act(() => setStreamConnected(true));
  render(<View load={load} resources={["tournaments"]} options={{ overlap: true }} />);

  act(() => {
    change();
    vi.advanceTimersByTime(200);
    change();
    vi.advanceTimersByTime(200);
  });
  expect(load).toHaveBeenCalledTimes(2);
});

test("nach dem Verlassen der Ansicht lädt die laufende Abfrage nichts mehr nach", async () => {
  const { load, finish } = slowLoad();
  act(() => setStreamConnected(true));
  const view = render(<View load={load} resources={["tournaments"]} />);

  act(() => {
    change();
    vi.advanceTimersByTime(200);
    change();
    vi.advanceTimersByTime(200);
  });
  view.unmount();
  await act(async () => finish());
  expect(load).toHaveBeenCalledTimes(1);
});

test("overlap gilt ab dem ersten Render: ein späterer Wechsel mischt nicht beide Arten", () => {
  const first = slowLoad();
  act(() => setStreamConnected(true));
  const view = render(<View load={first.load} resources={["tournaments"]} options={{ overlap: true }} />);
  act(() => {
    change();
    vi.advanceTimersByTime(200);
  });
  view.rerender(<View load={first.load} resources={["tournaments"]} options={{ overlap: false }} />);
  act(() => {
    change();
    vi.advanceTimersByTime(200);
    change();
    vi.advanceTimersByTime(200);
  });
  expect(first.load).toHaveBeenCalledTimes(3); // weiter überlappend, keine zweite Art daneben
  view.unmount();

  const second = slowLoad();
  const other = render(<View load={second.load} resources={["tournaments"]} />);
  other.rerender(<View load={second.load} resources={["tournaments"]} options={{ overlap: true }} />);
  act(() => {
    change();
    vi.advanceTimersByTime(200);
    change();
    vi.advanceTimersByTime(200);
  });
  expect(second.load).toHaveBeenCalledTimes(1); // weiter eine zur Zeit
});

test("hängt eine Abfrage und wartet eine Meldung, startet nach 30 s von selbst eine neue - ohne weitere Meldung", () => {
  const { load } = slowLoad();
  act(() => setStreamConnected(true));
  render(<View load={load} resources={["tournaments"]} />);

  act(() => {
    change();
    vi.advanceTimersByTime(200);
    change();
    vi.advanceTimersByTime(200);
  });
  expect(load).toHaveBeenCalledTimes(1);

  act(() => {
    vi.advanceTimersByTime(LIVE_REFRESH_STUCK_MS);
  });
  expect(load).toHaveBeenCalledTimes(2);

  // Die neue hängt ebenfalls, aber ohne wartende Meldung: kein weiterer Start.
  act(() => {
    vi.advanceTimersByTime(LIVE_REFRESH_STUCK_MS * 2);
  });
  expect(load).toHaveBeenCalledTimes(2);
});

test("ohne wartende Meldung startet eine hängende Abfrage nichts von selbst; nach dem Verlassen auch nicht", () => {
  const { load } = slowLoad();
  act(() => setStreamConnected(true));
  const view = render(<View load={load} resources={["tournaments"]} />);

  act(() => {
    change();
    vi.advanceTimersByTime(200);
    vi.advanceTimersByTime(LIVE_REFRESH_STUCK_MS * 2);
  });
  expect(load).toHaveBeenCalledTimes(1);

  act(() => {
    change();
    vi.advanceTimersByTime(200);
  });
  expect(load).toHaveBeenCalledTimes(2);
  act(() => {
    change();
    vi.advanceTimersByTime(200);
  });
  view.unmount();
  act(() => {
    vi.advanceTimersByTime(LIVE_REFRESH_STUCK_MS);
  });
  expect(load).toHaveBeenCalledTimes(2);
});

test("abgeschaltet während eine Abfrage hängt: weder der 30-s-Zeitgeber noch ihr Ende startet eine neue", async () => {
  const { load, finish } = slowLoad();
  act(() => setStreamConnected(true));
  const view = render(<View load={load} resources={["tournaments"]} options={{ enabled: true }} />);

  act(() => {
    change();
    vi.advanceTimersByTime(200);
    change();
    vi.advanceTimersByTime(200);
  });
  expect(load).toHaveBeenCalledTimes(1);

  view.rerender(<View load={load} resources={["tournaments"]} options={{ enabled: false }} />);
  act(() => {
    vi.advanceTimersByTime(LIVE_REFRESH_STUCK_MS * 2);
  });
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(load).toHaveBeenCalledTimes(1);
});
