import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

// Serienseite (#1742, #1745): Kopf, Fortschritt, Gesamtwertung mit gestrichenen Ergebnissen und Finalgrenze, Filter
// „Nur Vereinsspieler“, Finalrechner als Richtwert, Finale als eigene Runde, Termine; nicht indexiert; unbekannt oder
// nicht sichtbar heißt 404, eine alte Adresse führt zur aktuellen. Fremde Namen ohne Link. Nur erfundene Namen.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: vi.fn() }));
vi.mock("@/pages/ErrorPages", () => ({ NotFoundPage: () => <div data-testid="not-found">404</div> }));

const { default: ReferenceSeriesPage } = await import("./ReferenceSeriesPage");
const { useDocumentTitle } = await import("@/hooks/useDocumentTitle");

function row(key, rank, points, extra = {}) {
  return { key, rank, points, name: `Probe ${key}`, name_hidden: false, club_member: false, profile_slug: null, previous_rank: null, results: [], ...extra };
}

const BODY = {
  lineage: { title: "Probe Cup", slug: "probe-cup", kind: "series", label: "1vs1", organizer: "Probe Liga", game_name: "Probespiel" },
  series: { season: "2026", tier: "Division 1", title: null, season_slug: "2026-division-1", status: "active" },
  rules: { points_mode: "scheme", points_by_place: [10, 8, 6, 4], count_mode: "drop_n", count_n: 1, final_top_n: 2, tiebreakers: ["wins"], bonuses: {}, activity_points: { points: 0 } },
  today: "2026-11-05",
  progress: { total: 3, scored: 2, cancelled: 1, remaining: 1, next: { id: "r3", position: 3, code: "Q3", club_day: "2026-11-12", time: "20:30", state: "planned" } },
  rounds: [
    { id: "r1", position: 1, code: "Q1", club_day: "2026-10-22", time: null, state: "scored", kind: "regular", counts: true },
    { id: "r2", position: 2, code: "Q2", club_day: "2026-10-29", time: null, state: "scored", kind: "regular", counts: true },
    { id: "rx", position: 3, code: "QX", club_day: null, time: null, state: "cancelled", kind: "regular", counts: true },
    { id: "r3", position: 4, code: "Q3", club_day: "2026-11-12", time: "20:30", venue: "Probering", state: "planned", kind: "regular", counts: true },
    { id: "rf", position: 5, code: "FIN", club_day: "2026-11-26", time: null, state: "planned", kind: "final", counts: false, original_club_day: "2026-11-19" },
  ],
  standings: {
    round_id: "r2",
    rows: [
      row("a", 1, 18, { previous_rank: 2, results: [{ round_id: "r1", place: 2, points: 8, counted: true }, { round_id: "r2", place: 1, points: 10, counted: true }] }),
      row("b", 2, 16, { club_member: true, profile_slug: "probe-b", results: [{ round_id: "r1", place: 1, points: 10, counted: true }, { round_id: "r2", place: 3, points: 6, dropped: true }] }),
      row("c", 3, 10, { previous_rank: 1 }),
      row("d", 4, 4, { name: null, name_hidden: true }),
    ],
  },
  final: { round: { id: "rf", code: "FIN", club_day: "2026-11-26", kind: "final" }, rows: [] },
};

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/references/series/:lineageSlug/:seasonSlug" element={<><ReferenceSeriesPage /><Where /></>} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { apiMock.get.mockReset(); });

test("Kopf, Fortschritt, Regeln und Termine, nicht indexiert", async () => {
  apiMock.get.mockResolvedValue({ data: BODY });
  renderAt("/references/series/probe-cup/2026-division-1");
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Probe Cup 2026 · Division 1");
  expect(apiMock.get).toHaveBeenCalledWith("/reference-series/public/probe-cup/2026-division-1");
  expect(screen.getByText("1vs1 · Probe Liga · Probespiel")).toBeInTheDocument();
  expect(screen.getByTestId("series-progress")).toHaveTextContent("2 von 3 Runden gewertet · 1 abgesagt");
  expect(screen.getByTestId("series-next")).toHaveTextContent("Nächstes Turnier: Q3 · Do., 12.11.2026 · 20:30");
  const rules = screen.getByTestId("series-rules");
  expect(rules).toHaveTextContent("Platz 1 bis 4: 10 · 8 · 6 · 4");
  expect(rules).toHaveTextContent("Ein Streichergebnis");
  expect(rules).toHaveTextContent("mehr Siege");
  expect(rules).toHaveTextContent("Die besten 2 der Gesamtwertung");
  const calendar = screen.getAllByTestId("series-page-round");
  expect(calendar.map((item) => item.dataset.state)).toEqual(["scored", "scored", "cancelled", "planned", "planned"]);
  expect(calendar[4]).toHaveTextContent("ursprünglich Do., 19.11.2026");
  expect(useDocumentTitle).toHaveBeenLastCalledWith("Probe Cup 2026 · Division 1", undefined, { robots: "noindex, follow" });
});

test("Tabelle: gestrichene Ergebnisse, Bewegung, Finalgrenze; fremde Namen ohne Link", async () => {
  apiMock.get.mockResolvedValue({ data: BODY });
  renderAt("/references/series/probe-cup/2026-division-1");
  const table = await screen.findByTestId("series-table");
  const rows = within(table).getAllByTestId("series-row");
  expect(rows).toHaveLength(4);
  // Spalten: Wertungsrunden ohne Finale, die abgesagte durchgestrichen.
  expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["#", "Name", "Q1", "Q2", "QX", "Q3", "Pkt"]);
  // Gestrichen: blass und für Screenreader benannt.
  expect(within(rows[1]).getByText("Q2: 6 Punkte, Platz 3, gestrichen")).toBeInTheDocument();
  expect(rows[1].querySelector("[data-dropped='true']")).not.toBeNull();
  expect(rows[0].querySelector("[data-dropped='true']")).toBeNull();
  // Bewegung seit der Runde davor.
  expect(within(rows[0]).getByRole("img", { name: "1 Platz hinauf seit der Runde davor" })).toBeInTheDocument();
  expect(within(rows[2]).getByRole("img", { name: "2 Plätze hinunter seit der Runde davor" })).toBeInTheDocument();
  // Finalgrenze nach Platz 2.
  const cut = within(table).getByTestId("series-cutline");
  expect(cut).toHaveTextContent("Finalgrenze · Top 2");
  expect(rows[1].nextElementSibling).toBe(cut);
  // Nur das Vereinsmitglied verlinkt, Fremde sind Text, ein ausgeblendeter Name bleibt ausgeblendet.
  expect(within(table).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/members/probe-b"]);
  expect(within(rows[0]).queryByRole("link")).toBeNull();
  expect(rows[3]).toHaveTextContent("Name ausgeblendet");
  expect(rows[1]).toHaveAttribute("data-club", "true");
});

test("Filter „Nur Vereinsspieler“ zeigt nur Vereinsspieler mit ihrem echten Rang", async () => {
  apiMock.get.mockResolvedValue({ data: BODY });
  renderAt("/references/series/probe-cup/2026-division-1");
  const toggle = await screen.findByTestId("series-filter-club");
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  const rows = within(screen.getByTestId("series-table")).getAllByTestId("series-row");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toHaveTextContent("2");
  expect(rows[0]).toHaveTextContent("Probe b");
});

test("Handy: Karten mit den ersten zehn und Vereinsspielern, volle Tabelle aufklappbar", async () => {
  const many = Array.from({ length: 13 }, (_, index) => row(`p${index + 1}`, index + 1, 100 - index, { club_member: index === 11 }));
  apiMock.get.mockResolvedValue({ data: { ...BODY, standings: { round_id: "r2", rows: many } } });
  renderAt("/references/series/probe-cup/2026-division-1");
  const cards = await screen.findByTestId("series-cards");
  expect(within(cards).getAllByTestId("series-card")).toHaveLength(11);
  fireEvent.click(within(cards).getByTestId("series-expand"));
  expect(within(cards).getAllByTestId("series-card")).toHaveLength(13);
  expect(within(cards).queryByTestId("series-expand")).toBeNull();
});

test("Finalrechner: als Richtwert gekennzeichnet, für den gewählten Spieler", async () => {
  apiMock.get.mockResolvedValue({ data: BODY });
  renderAt("/references/series/probe-cup/2026-division-1");
  const calc = await screen.findByTestId("series-final-calc");
  expect(calc).toHaveTextContent("Richtwert");
  // Vorgewählt: das Vereinsmitglied (Platz 2, innerhalb).
  expect(within(calc).getByTestId("series-final-calc-result")).toHaveTextContent("Innerhalb der Finalgrenze – 6 Punkte vor Platz 3.");
  // Ein ausgeblendeter Name steht nicht in der Auswahl.
  expect(within(calc).getAllByRole("option").map((option) => option.textContent)).toEqual(["1. Probe a", "2. Probe b", "3. Probe c"]);
  fireEvent.change(within(calc).getByTestId("series-final-calc-select"), { target: { value: "c" } });
  expect(within(calc).getByTestId("series-final-calc-result")).toHaveTextContent("Bis zur Finalgrenze fehlen 6 Punkte: etwa 6 in der letzten offenen Runde.");
});

test("Finale als eigene Runde: erst der Termin, dann die Endplatzierung mit Podest", async () => {
  apiMock.get.mockResolvedValue({ data: BODY });
  const { unmount } = renderAt("/references/series/probe-cup/2026-division-1");
  expect(await screen.findByTestId("series-final")).toHaveTextContent("Die Endplatzierung steht hier nach dem Finale.");
  unmount();
  const final = { ...BODY.final, rows: [
    { key: "b", place: 1, name: "Probe b", club_member: true }, { key: "a", place: 2, name: "Probe a" },
    { key: "d", place: 3, name: null, name_hidden: true },
  ] };
  apiMock.get.mockResolvedValue({ data: { ...BODY, final } });
  renderAt("/references/series/probe-cup/2026-division-1");
  const rows = await screen.findAllByTestId("series-final-row");
  expect(rows.map((item) => item.textContent)).toEqual(["1. (Gold)Probe bVerein", "2. (Silber)Probe a", "3. (Bronze)Name ausgeblendet"]);
});

test("ohne Ergebnisse: Hinweis statt Tabelle, kein Rechner", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, standings: null, final: null } });
  renderAt("/references/series/probe-cup/2026-division-1");
  expect(await screen.findByTestId("series-no-table")).toBeInTheDocument();
  expect(screen.queryByTestId("series-final-calc")).toBeNull();
  expect(screen.queryByTestId("series-final")).toBeNull();
});

test("eine alte Adresse führt zur aktuellen", async () => {
  apiMock.get.mockResolvedValue({ data: BODY });
  renderAt("/references/series/probe-cup/2026");
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/references/series/probe-cup/2026-division-1"));
});

test("unbekannt oder nicht sichtbar: 404", async () => {
  apiMock.get.mockRejectedValue({ response: { status: 404 } });
  renderAt("/references/series/gibt-es/nicht");
  expect(await screen.findByTestId("not-found")).toBeInTheDocument();
});
