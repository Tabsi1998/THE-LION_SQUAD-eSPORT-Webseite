import { act, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { hallEvent } from "../../../e2e/fixtures/tvHall.mjs";

// Hallen-Tafel (#1126) und Aufruf-Tafel eines Events (#1122): Tagesplan mit „jetzt“-Linie und „Tag 2 von 3“, alle
// Stationen - reserviert heißt „Aufgerufen“, nicht „Belegt“ -, was läuft und was als Nächstes kommt. Kein Schreibfehler.
// Seit #1822: mit Anzeige-Schlüssel des Events auch Turniere „Nur Mitglieder“ in einer Abfrage; ohne Schlüssel keine
// Abfragen, die absehbar 401/403 liefern.

const apiMock = { get: vi.fn() };
const auth = { current: null };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value }));
vi.mock("@/components/tls/BrandedQRCode", () => ({ BrandedQRCode: ({ value }) => <span data-testid="branded-qr-code" data-value={value} /> }));
vi.mock("@/components/tls/Logo", () => ({ MascotBadge: () => <span data-testid="mascot" /> }));
vi.mock("@/context/AuthContext", async (importOriginal) => ({ ...(await importOriginal()), useOptionalAuth: () => auth.current }));

const EventTVPage = (await import("./EventTVPage")).default;
const EventCallsTVPage = (await import("./EventCallsTVPage")).default;

function serve({ event, stations, brackets }) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/tv/settings") return { data: { settings: {} } };
    if (url === "/events/event-1") return { data: event };
    if (url.startsWith("/stations?event_id=")) return { data: stations };
    if (url.startsWith("/stations?tournament_id=")) return { data: [] };
    const bracket = /\/tournaments\/(t\d)\/bracket/.exec(url);
    if (bracket) {
      if (!brackets[bracket[1]]) throw Object.assign(new Error("fehlt"), { response: { status: 404 } });
      return { data: brackets[bracket[1]] };
    }
    return { data: [] };
  });
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/display/event/:id" element={<EventTVPage />} />
        <Route path="/display/event/:id/calls" element={<EventCallsTVPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

// Die Testdaten legen den Tag in Wiener Zeit an (Turniere 12 bis 17 Uhr, das Abend-Turnier ab 18 Uhr). Die Uhr steht
// deshalb fest auf 14:32 - sonst hinge das Ergebnis davon ab, um welche Uhrzeit der Test läuft.
const NOW = Date.parse("2026-10-07T14:32:00+02:00");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  apiMock.get.mockReset();
  auth.current = null;
});

const requested = () => apiMock.get.mock.calls.map(([url]) => url);
const refusal = (status) => Object.assign(new Error(String(status)), { response: { status } });

test("#1822: mit Schlüssel holt die Aufruf-Tafel alles in einer Abfrage - auch den Aufruf aus dem Cup „Nur Mitglieder“", async () => {
  const hall = hallEvent({ now: Date.now(), stations: 12 });
  // Der Kart-Sprint ist „Nur Mitglieder“: ohne Schlüssel steht er nirgends, mit Schlüssel liefert der Server ihn mit.
  const membersCup = { ...hall.brackets.t2, tournament: { ...hall.brackets.t2.tournament, title: "Probelauf-Cup" } };
  apiMock.get.mockImplementation(async (url, config) => {
    if (url === "/tv/settings") return { data: { settings: {} } };
    if (url === "/events/event-1/display" && config?.params?.key === "hallen-schluessel") {
      return { data: { event: hall.event, stations: hall.stations, brackets: [hall.brackets.t1, membersCup], display_key: true } };
    }
    throw refusal(404);
  });
  renderAt("/display/event/event-1/calls?key=hallen-schluessel");
  const board = await screen.findByTestId("tv-call-board");
  const called = hall.stations.filter((station) => station.status === "reserved");
  expect(Number(board.getAttribute("data-count"))).toBe(called.length);
  expect(screen.getByTestId("event-calls-tv")).toHaveTextContent("Probelauf-Cup");
  // Keine Abfrage am Schlüssel vorbei: weder die Event-Seite noch ein Baum oder die Stationen einzeln.
  expect(requested().filter((url) => url !== "/tv/settings")).toEqual(["/events/event-1/display"]);
});

test("#1822: der Stationsname auf der Aufruf-Tafel bleibt ganz - Schrift nach dem längsten Wort, sehr lange Wörter mit „…“", async () => {
  const hall = hallEvent({ now: Date.now(), stations: 12 });
  const [first] = hall.stations.filter((station) => station.status === "reserved");
  Object.assign(first, { name: "Rennsimulatorplatz 3", label: "Rennsimulatorplatz 3" });
  serve(hall);
  renderAt("/display/event/event-1/calls");
  await screen.findByTestId("tv-call-board");
  const shown = screen.getAllByTestId(/^tv-call-station-/).find((element) => element.textContent.startsWith("Rennsim"));
  expect(shown).toHaveTextContent("Rennsimulat… 3");
  expect(shown.style.getPropertyValue("--tv-station-chars")).toBe("12");
});

test("#1822: ein widerrufener Schlüssel - die Tafel zeigt nichts mehr vom Event, nur wie es weitergeht", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/tv/settings") return { data: { settings: {} } };
    if (url === "/events/event-1/display") throw refusal(403);
    throw refusal(404);
  });
  renderAt("/display/event/event-1?key=widerrufen");
  expect(await screen.findByTestId("tv-key-refused")).toHaveTextContent("Dieser TV-Link gilt nicht mehr");
  expect(screen.queryByTestId("event-tv")).not.toBeInTheDocument();
});

test("#1822: ohne Schlüssel und ohne Anmeldung fragt die Tafel die Daten der Turnierleitung gar nicht erst an - keine 401-Flut", async () => {
  const hall = hallEvent({ now: Date.now(), stations: 12 });
  serve(hall);
  renderAt("/display/event/event-1/calls");
  await screen.findByTestId("tv-call-board");
  const { emitApiInvalidation } = await import("@/lib/apiInvalidation");
  const before = requested().length;
  await act(async () => {
    emitApiInvalidation({ resource: "matches" });
  });
  await waitFor(() => expect(requested().length).toBeGreaterThan(before));
  expect(requested().some((url) => url.includes("/bracket/display"))).toBe(false);
  expect(requested()).toContain("/tournaments/t1/bracket");
});

test("#1822: angemeldet, aber ohne Turnierleitung - nach der ersten Absage fragt die Tafel nur noch die öffentliche Ansicht", async () => {
  auth.current = { user: { id: "u1", display_name: "Mitglied" } };
  const hall = hallEvent({ now: Date.now(), stations: 12 });
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/tv/settings") return { data: { settings: {} } };
    if (url === "/events/event-1") return { data: hall.event };
    if (url.startsWith("/stations?event_id=")) return { data: hall.stations };
    if (url.startsWith("/stations?tournament_id=")) return { data: [] };
    if (url.endsWith("/bracket/display")) throw refusal(403);
    const bracket = /\/tournaments\/(t\d)\/bracket$/.exec(url);
    if (bracket) return { data: hall.brackets[bracket[1]] };
    return { data: [] };
  });
  renderAt("/display/event/event-1/calls");
  await screen.findByTestId("tv-call-board");
  const asked = requested().filter((url) => url.endsWith("/bracket/display")).length;
  expect(asked).toBeGreaterThan(0);
  const { emitApiInvalidation } = await import("@/lib/apiInvalidation");
  const before = requested().length;
  await act(async () => {
    emitApiInvalidation({ resource: "matches" });
  });
  await waitFor(() => expect(requested().length).toBeGreaterThan(before));
  expect(requested().filter((url) => url.endsWith("/bracket/display")).length).toBe(asked);
});

afterEach(() => {
  vi.useRealTimers();
});

test("die Hallen-Tafel: Tagesplan, alle Stationen mit Stand, reserviert zählt als „aufgerufen“", async () => {
  const hall = hallEvent({ now: Date.now(), stations: 12 });
  serve(hall);
  renderAt("/display/event/event-1");
  expect(await screen.findByTestId("tv-day-plan")).toBeInTheDocument();
  await screen.findAllByTestId("tv-station");
  const counts = screen.getByTestId("tv-station-counts").textContent;
  expect(counts).toMatch(/\d+ belegt/);
  expect(counts).toMatch(/\d+ aufgerufen/);
  expect(counts).toMatch(/1 defekt/);
  // Eine reservierte Station steht als „Aufgerufen“ mit Spiel und Namen da, nicht als „Belegt“.
  const reserved = hall.stations.find((station) => station.status === "reserved");
  const cell = document.querySelector(`[data-station='${reserved.id}']`);
  if (cell) {
    expect(cell).toHaveAttribute("data-state", "called");
    expect(within(cell).getByText("Aufgerufen")).toBeInTheDocument();
  }
  expect(screen.getByTestId("tv-now")).toHaveTextContent("Jetzt läuft");
  expect(screen.getByTestId("tv-next")).toHaveTextContent("Abend-Turnier");
  expect(screen.getByTestId("event-tv")).not.toHaveTextContent("verknuepft");
});

test("mehrtägiges Event: „Tag 2 von 3“ oben", async () => {
  serve(hallEvent({ now: Date.now(), stations: 6, multiDay: true }));
  renderAt("/display/event/event-1");
  expect(await screen.findByTestId("tv-event-day")).toHaveTextContent(/Tag 2 von 3 · \w+/);
});

test("ein Event ohne Turniere: richtig geschrieben, ohne „verknuepften“", async () => {
  serve({ event: { id: "event-1", name: "Leeres Event", status: "scheduled", start_date: new Date().toISOString(), tournaments: [], f1_challenges: [] }, stations: [], brackets: {} });
  renderAt("/display/event/event-1");
  expect(await screen.findByText("Keine verknüpften Turniere oder Fast Laps")).toBeInTheDocument();
  expect(screen.getByText("Keine Stationen für dieses Event")).toBeInTheDocument();
});

test("die Aufruf-Tafel eines Events: Aufrufe aus allen Turnieren, mit Turnier", async () => {
  const hall = hallEvent({ now: Date.now(), stations: 12 });
  serve(hall);
  renderAt("/display/event/event-1/calls");
  const board = await screen.findByTestId("tv-call-board");
  const called = hall.stations.filter((station) => station.status === "reserved");
  expect(Number(board.getAttribute("data-count"))).toBe(called.length);
  expect(board).toHaveTextContent("Lions Herbst-Cup");
  expect(screen.getByTestId("event-calls-tv")).toHaveTextContent("Aufrufe");
});

test("#1564: dieselbe Station aus Event und Turnier steht nur einmal da - der lebhafteste Stand zählt", async () => {
  const hall = hallEvent({ now: Date.now(), stations: 6 });
  // Heute legt jedes Turnier seine Stationen selbst an: dieselben Namen und Geräte noch einmal, mit eigener Kennung.
  const copies = hall.stations.map((station) => ({ ...station, id: `${station.id}-kopie`, status: "free", current_match_id: null }));
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/tv/settings") return { data: { settings: {} } };
    if (url === "/events/event-1") return { data: hall.event };
    if (url.startsWith("/stations?event_id=")) return { data: hall.stations };
    if (url.startsWith("/stations?tournament_id=")) return { data: copies };
    const bracket = /\/tournaments\/(t\d)\/bracket/.exec(url);
    if (bracket) return { data: hall.brackets[bracket[1]] };
    return { data: [] };
  });
  renderAt("/display/event/event-1");
  await screen.findAllByTestId("tv-station");
  expect(screen.getAllByTestId("tv-station")).toHaveLength(6);
  const busy = hall.stations.find((station) => station.status === "busy" || station.status === "in_use");
  if (busy) expect(document.querySelector(`[data-station='${busy.id}']`)).toHaveAttribute("data-state", "busy");
});

test("#1564: „Als Nächstes“ in der Halle nennt das nächste Spiel mit Prognose und Station", async () => {
  serve(hallEvent({ now: Date.now(), stations: 6 }));
  renderAt("/display/event/event-1");
  const next = await screen.findByTestId("tv-next-match");
  // Mit Uhrzeit „ca. 16:40 · PC 4“, ohne geplante Zeit nur die Station.
  expect(next).toHaveTextContent(/Spiel [A-Z]+ · (ca\. \d{2}:\d{2} · )?PC \d/);
});
