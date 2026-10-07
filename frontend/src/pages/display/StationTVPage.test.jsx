import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { decide, heatDoubleElimination, play, singleElimination, start } from "../../../e2e/fixtures/tvBrackets.mjs";

// Stations-Ansicht (#1120): ein Bildschirm an einer Station zeigt nur, was dort läuft oder als Nächstes kommt -
// Durchgänge als Startaufstellung, Duelle als „A gegen B“; mit dem Anzeige-Schlüssel des Turniers.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value }));
vi.mock("@/components/tls/BrandedQRCode", () => ({ BrandedQRCode: ({ value }) => <span data-testid="branded-qr-code" data-value={value} /> }));
vi.mock("@/components/tls/Logo", () => ({ MascotBadge: () => <span data-testid="mascot" /> }));

const StationTVPage = (await import("./StationTVPage")).default;

function serve(bracket, stations) {
  apiMock.get.mockImplementation(async (url, options) => {
    if (url === "/tv/settings") return { data: { settings: {} } };
    if (url.startsWith("/tournaments/t1/bracket/display")) return { data: bracket, options };
    if (url === "/stations?tournament_id=t1") return { data: stations };
    return { data: [] };
  });
}

function renderStation(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/display/bracket/:id/station/:stationId" element={<StationTVPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.get.mockReset();
});

test("ein laufender Durchgang an der Station: Startaufstellung, Station und Spielzeit, mit dem Schlüssel gefragt", async () => {
  const bracket = heatDoubleElimination();
  play(bracket, ["A"]);
  start(bracket, "B", { station: "PC 3", startedAt: new Date(Date.now() - 65_000).toISOString() });
  serve(bracket, [{ id: "st-pc-3", name: "PC 3", current_match_id: "m-B" }]);
  renderStation("/display/bracket/t1/station/st-pc-3?key=nur-anschauen");
  expect(await screen.findByTestId("tv-start-grid")).toHaveAttribute("data-decided", "0");
  expect(apiMock.get).toHaveBeenCalledWith("/tournaments/t1/bracket/display", { params: { key: "nur-anschauen" } });
  expect(screen.getByTestId("station-tv")).toHaveTextContent("PC 3");
  expect(screen.getByTestId("station-tv-match")).toHaveAttribute("data-mode", "live");
  expect(screen.getByTestId("station-tv-match")).toHaveTextContent("Durchgang B");
  expect(screen.getByTestId("tv-spot-m-B")).toHaveTextContent(/PC 3.*1:0\d/);
  const slots = screen.getAllByTestId(/^tv-grid-slot-/);
  expect(slots).toHaveLength(4);
  expect(slots.map((slot) => [slot.getAttribute("data-col"), slot.getAttribute("data-row")])).toEqual([["0", "0"], ["1", "0"], ["0", "1"], ["1", "1"]]);
  expect(slots[0]).toHaveTextContent("Startplatz 1");
  // Der QR-Code zeigt die öffentliche Seite - nie den Schlüssel.
  expect(screen.getByTestId("branded-qr-code").getAttribute("data-value")).not.toContain("nur-anschauen");
});

test("ein Duell, das als Nächstes kommt: „A gegen B“ mit der geplanten Zeit", async () => {
  const bracket = singleElimination(8);
  const next = bracket.matches_v2.find((match) => match.match_key === "C");
  next.station_id = "st-pc-4";
  next.scheduled_at = "2026-10-10T15:20:00+02:00";
  serve(bracket, [{ id: "st-pc-4", name: "PC 4" }]);
  renderStation("/display/bracket/t1/station/st-pc-4?key=k");
  expect(await screen.findByTestId("tv-duel")).toBeInTheDocument();
  expect(screen.getByTestId("station-tv-match")).toHaveAttribute("data-mode", "next");
  expect(screen.getByTestId("tv-duel")).toHaveTextContent("KartKönigin");
  expect(screen.getByTestId("tv-duel")).toHaveTextContent("gegen");
  expect(screen.getByTestId("station-tv-when")).toHaveTextContent(/geplant ca\. .*15:20/);
});

test("ist das Spiel an der Station schon entschieden, zeigt sie nach dem Neuladen gleich das nächste", async () => {
  const bracket = heatDoubleElimination();
  play(bracket, ["A"]);
  start(bracket, "B", { station: "PC 3" });
  decide(bracket, "B", ["r7", "r3", "r2", "r6"]);
  bracket.matches_v2.find((match) => match.match_key === "D").station_id = "st-pc-3";
  serve(bracket, [{ id: "st-pc-3", name: "PC 3", current_match_id: "m-B" }]);
  renderStation("/display/bracket/t1/station/st-pc-3?key=k");
  expect(await screen.findByTestId("station-tv-match")).toHaveAttribute("data-match", "m-D");
  expect(screen.getByTestId("station-tv-match")).toHaveAttribute("data-mode", "next");
  // In D stehen die beiden, die in A und B ins Loser Bracket mussten - als Startaufstellung.
  expect(screen.getByTestId("tv-start-grid")).toHaveTextContent("KartKönigin");
  expect(screen.getByTestId("tv-start-grid")).toHaveTextContent("Startplatz 3");
});

test("freie und unbekannte Stationen sagen es im Klartext", async () => {
  serve(singleElimination(4), [{ id: "st-1", name: "PC 1" }]);
  const { unmount } = renderStation("/display/bracket/t1/station/st-1?key=k");
  expect(await screen.findByTestId("station-tv-free")).toHaveTextContent("Hier ist gerade nichts geplant");
  unmount();
  renderStation("/display/bracket/t1/station/gibt-es-nicht?key=k");
  expect(await screen.findByTestId("station-tv-missing")).toHaveTextContent("Diese Station gibt es in diesem Turnier nicht");
});

test("ein widerrufener Schlüssel zeigt nichts mehr vom Turnier", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/tv/settings") return { data: { settings: {} } };
    const error = new Error("forbidden");
    error.response = { status: 403 };
    throw error;
  });
  renderStation("/display/bracket/t1/station/st-1?key=widerrufen");
  expect(await screen.findByTestId("tv-key-refused")).toHaveTextContent("Dieser TV-Link gilt nicht mehr");
});

test("#1122: ist das nächste Spiel hier aufgerufen, steht es mit Countdown da", async () => {
  const bracket = singleElimination(8);
  const next = bracket.matches_v2.find((match) => match.match_key === "C");
  Object.assign(next, { station_id: "st-pc-4", station_name: "PC 4", called_at: new Date(Date.now() - 30_000).toISOString() });
  serve(bracket, [{ id: "st-pc-4", name: "PC 4", status: "reserved", current_match_id: "m-C", called_at: next.called_at }]);
  renderStation("/display/bracket/t1/station/st-pc-4?key=k");
  expect(await screen.findByTestId("station-tv-call")).toHaveTextContent("Aufgerufen");
  expect(screen.getByTestId("station-tv-state")).toHaveTextContent("Aufgerufen");
  expect(screen.getByTestId("tv-call-clock-m-C")).toHaveTextContent(/^1:[23]\d$/);
});
