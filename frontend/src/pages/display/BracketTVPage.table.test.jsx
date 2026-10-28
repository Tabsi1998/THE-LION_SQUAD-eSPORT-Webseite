import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Turnierbaum-TV bei Liga & Co. (#2121): nach dem Spielplan kommt die Folie „Tabelle“, Kopf und QR-Code nennen die
// Tabelle statt des Turnierbaums, und nach dem Ende kommt der Sieger aus Platz 1. Erfundene Namen.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value }));
vi.mock("@/components/tls/BrandedQRCode", () => ({ BrandedQRCode: ({ value }) => <span data-testid="branded-qr-code" data-value={value} /> }));
vi.mock("@/components/tls/Logo", () => ({ MascotBadge: () => <span data-testid="mascot" /> }));

const BracketTVPage = (await import("./BracketTVPage")).default;

const REGS = [
  { id: "r1", display_name: "Nordlicht" }, { id: "r2", display_name: "Steinbock" },
  { id: "r3", display_name: "Wolkenfuchs" }, { id: "r4", display_name: "Kieselkatze" },
];
const STANDINGS = [
  { registration_id: "r1", display_name: "Nordlicht", rank: 1, played: 1, won: 1, drawn: 0, lost: 0, score_diff: 2, points: 3 },
  { registration_id: "r3", display_name: "Wolkenfuchs", rank: 2, played: 1, won: 0, drawn: 1, lost: 0, score_diff: 0, points: 1 },
  { registration_id: "r4", display_name: "Kieselkatze", rank: 2, played: 1, won: 0, drawn: 1, lost: 0, score_diff: 0, points: 1 },
  { registration_id: "r2", display_name: "Steinbock", rank: 4, played: 1, won: 0, drawn: 0, lost: 1, score_diff: -2, points: 0 },
];
const match = (id, a, b, status = "completed") => ({
  id, stage_id: "s1", stage_type: "league", section: "league", round: 1, order: 0, match_key: id.toUpperCase(), status,
  settings: { match_size: 2 }, slots: [{ slot: 1, registration_id: a }, { slot: 2, registration_id: b }], results: [],
});

function serve(data) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/tv/settings") return { data: { settings: {} } };
    if (String(url || "").startsWith("/tournaments/t1/bracket/display")) return { data };
    return { data: [] };
  });
}

function renderTv(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/display/bracket/:id" element={<BracketTVPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => apiMock.get.mockReset());
afterEach(() => vi.useRealTimers());

test("Liga: erst die Spieltage, dann die Tabelle - und überall „Tabelle“ statt „Turnierbaum“", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  serve({
    tournament: { id: "t1", slug: "liga", title: "Herbstliga", status: "live", format: "league", team_mode: "team" },
    registrations: REGS, stages: [{ id: "s1", name: "Liga", number: 1, stage_type: "league" }],
    matches_v2: [match("a", "r1", "r2"), match("b", "r3", "r4", "pending")],
    standings: STANDINGS,
  });
  renderTv("/display/bracket/t1?key=tv&playlist=tree-3");
  const tv = await screen.findByTestId("bracket-tv");
  await waitFor(() => expect(tv).toHaveAttribute("data-slide", "tree"));
  expect(tv).toHaveTextContent("Spieltage");
  expect(screen.getByTestId("branded-qr-code").getAttribute("data-value")).toMatch(/\/tournaments\/liga\/standings$/);
  expect(tv).toHaveTextContent("QR scannen und Tabelle öffnen");
  expect(tv).not.toHaveTextContent("Turnierbaum");

  await act(async () => { vi.advanceTimersByTime(3200); });
  await waitFor(() => expect(tv).toHaveAttribute("data-slide", "table"));
  const slide = screen.getByTestId("tv-standings-slide");
  expect(slide).toHaveTextContent("Team");
  expect([...slide.querySelectorAll("[data-testid^='tv-standing-']")].map((row) => row.dataset.testid)).toEqual(
    ["tv-standing-r1", "tv-standing-r3", "tv-standing-r4", "tv-standing-r2"]);
  expect(screen.getByTestId("tv-standing-r2")).toHaveTextContent("−2");
  // Vor dem Ende ist es ein Zwischenstand: kein Gold.
  expect(slide.querySelector("[data-place]")).toBeNull();
});

test("Liga beendet: der Sieger kommt aus Platz 1 der Tabelle und steht in der Kopfleiste", async () => {
  serve({
    tournament: { id: "t1", slug: "liga", title: "Herbstliga", status: "completed", format: "league", team_mode: "solo" },
    registrations: REGS, stages: [], matches_v2: [], standings: STANDINGS,
  });
  renderTv("/display/bracket/t1?key=tv&playlist=tree-3");
  const tv = await screen.findByTestId("bracket-tv");
  await waitFor(() => expect(tv).toHaveAttribute("data-slide", "table"));
  expect(tv).toHaveTextContent("THE LION SQUAD · TABELLE");
  expect(tv).toHaveTextContent("Turnier entschieden");
  expect(screen.getByTestId("tv-champion-parked")).toHaveTextContent("Nordlicht");
  expect(screen.getByTestId("tv-standing-r1")).toHaveAttribute("data-place", "1");
  expect(screen.getByTestId("tv-standings-slide")).toHaveTextContent("Name");
});

test("Gruppen: je Gruppe eine Tabelle mit Namen, ohne Gold", async () => {
  serve({
    tournament: { id: "t1", slug: "gruppen", title: "Gruppencup", status: "completed", format: "groups" },
    registrations: REGS, stages: [], matches_v2: [],
    standings: [
      { group: { id: "g1", group_key: "a" }, standings: STANDINGS.slice(0, 2) },
      { group: { id: "g2", group_key: "b", name: "Gruppe Süd" }, standings: STANDINGS.slice(2) },
    ],
  });
  renderTv("/display/bracket/t1?key=tv&playlist=tree-3");
  const slide = await screen.findByTestId("tv-standings-slide");
  expect(screen.getByTestId("tv-standings-group-g1")).toHaveTextContent("Gruppe A");
  expect(screen.getByTestId("tv-standings-group-g2")).toHaveTextContent("Gruppe Süd");
  expect(slide.querySelector("[data-place]")).toBeNull();
  expect(screen.queryByTestId("tv-champion-parked")).toBeNull();
  expect(screen.getByTestId("bracket-tv")).toHaveTextContent("Tabellen");
});
