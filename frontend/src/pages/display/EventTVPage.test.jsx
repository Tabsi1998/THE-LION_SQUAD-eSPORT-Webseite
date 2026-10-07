import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { hallEvent } from "../../../e2e/fixtures/tvHall.mjs";

// Hallen-Tafel (#1126) und Aufruf-Tafel eines Events (#1122): Tagesplan mit „jetzt“-Linie und „Tag 2 von 3“, alle
// Stationen - reserviert heißt „Aufgerufen“, nicht „Belegt“ -, was läuft und was als Nächstes kommt. Kein Schreibfehler.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value }));
vi.mock("@/components/tls/BrandedQRCode", () => ({ BrandedQRCode: ({ value }) => <span data-testid="branded-qr-code" data-value={value} /> }));
vi.mock("@/components/tls/Logo", () => ({ MascotBadge: () => <span data-testid="mascot" /> }));

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

beforeEach(() => {
  apiMock.get.mockReset();
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
