import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { dayRounds, dayTable, lobbies, placeTone, playerDays, roundPlace } from "@/lib/seriesDays";
import { tiebreakLabel } from "@/lib/referenceSeriesTable";

// Turniertage auf der Serienseite (#1961): Regeln mit Runden und Bonus, Gesamtwertung mit Bonus-Spalte und Hinweis
// „Top 4“, Tagesansicht R1–R5 mit Summe und Platzfarben, Double Up mit Partner, Ausgestiegen, Lobby-Ansicht je Runde und
// das Spieler-Detail mit Tages- und Saisonpunkten. Nur erfundene Namen.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler", resolveMediaUrl: (value) => value || "" }));
vi.mock("@/components/tls/SmartLogo", () => ({ SmartLogo: () => null }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: vi.fn() }));
vi.mock("@/pages/ErrorPages", () => ({ NotFoundPage: () => <div data-testid="not-found">404</div> }));

const { default: ReferenceSeriesPage } = await import("./ReferenceSeriesPage");

const SCHEME = [8, 7, 6, 5, 4, 3, 2, 1];
const RULES = {
  points_mode: "scheme", points_by_place: [35, 30, 26, 23, 20, 18, 16, 14], count_mode: "best_n", count_n: 6, final_top_n: null,
  tiebreakers: ["wins", "top_n", "countback"], tiebreak_top_n: 4, bonuses: {}, activity_points: { points: 2, from_round: 7 },
  day_rounds: { count: 5, points_by_place: SCHEME }, custom_bonuses: [{ key: "bingo", label: "Bingo", points: 3 }],
};
const same = (points, lobby) => Array.from({ length: 5 }, () => ({ points, ...(lobby ? { lobby } : {}) }));
const person = (key, name, extra = {}) => ({ key, name, name_hidden: false, club_member: false, profile_slug: null, previous_rank: null, ...extra });
const ada = person("a", "Ada Ausgedacht");
const bea = person("b", "Bea Beispiel", { club_member: true, profile_slug: "bea" });
const ROWS = [
  { ...ada, rank: 1, points: 65, bonus_points: 0, tiebreak: null, results: [
    { round_id: "t1", place: 1, points: 35, day_points: 40, day_rounds: same(8, "A"), counted: true },
    { round_id: "t2", place: 2, points: 30, day_points: 16, day_rounds: same(3).slice(0, 4).concat([{ points: 4 }]), partner: { ...person("c", "Cem Muster") }, counted: true },
  ] },
  { ...bea, rank: 2, points: 65, bonus_points: 3, tiebreak: "top_n", results: [
    { round_id: "t1", place: 2, points: 30, day_points: 30, day_rounds: [{ points: 7, place: 2, lobby: "A" }, { points: 5, lobby: "B" }, { points: 6 }, { points: 6 }, { points: 6 }], bonus: 3, bonus_keys: ["bingo"], counted: true },
    { round_id: "t2", place: 1, points: 35, day_points: 20, day_rounds: [{ points: 8 }, { points: 4 }, { points: 4 }, { points: 2 }, { points: 2 }], partner: { name: null, name_hidden: true, club_member: false, profile_slug: null }, counted: true },
  ] },
  { ...person("c", "Cem Muster"), rank: 3, points: 49, bonus_points: 0, tiebreak: null, results: [
    { round_id: "t1", place: 3, points: 26, day_points: 9, day_rounds: [{ points: 8, lobby: "B" }, { points: 1, lobby: "A" }], marks: ["left"], counted: true },
    { round_id: "t2", place: 2, points: 30, day_points: 16, day_rounds: same(3).slice(0, 4).concat([{ points: 4 }]), partner: ada, counted: true },
  ] },
  { ...person("d", null, { name_hidden: true }), rank: 4, points: 35, bonus_points: 0, tiebreak: null, results: [
    { round_id: "t2", place: 1, points: 35, day_points: 20, day_rounds: same(4), partner: bea, counted: true },
  ] },
];
const BODY = {
  lineage: { title: "Probe Masters", slug: "probe-masters", kind: "series", label: "TFT", organizer: "Probe Partner", game_name: "Probespiel" },
  series: { season: "2026/27", tier: null, title: null, season_slug: "2026-27", status: "active" },
  rules: RULES, today: "2026-10-21",
  progress: { total: 3, scored: 2, cancelled: 0, remaining: 1, next: null },
  rounds: [
    { id: "t1", position: 1, code: "T1", club_day: "2026-10-04", state: "scored", kind: "regular", counts: true },
    { id: "t2", position: 2, code: "T2", club_day: "2026-10-11", state: "scored", kind: "regular", counts: true },
    { id: "t3", position: 3, code: "T3", club_day: "2026-10-25", state: "planned", kind: "regular", counts: true },
  ],
  standings: { round_id: "t2", rows: ROWS }, final: null,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/references/series/probe-masters/2026-27"]}>
      <Routes><Route path="/references/series/:lineageSlug/:seasonSlug" element={<ReferenceSeriesPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { apiMock.get.mockReset(); });

test("Regeln, Bonus-Spalte und Hinweis „Top 4“ in der Gesamtwertung", async () => {
  apiMock.get.mockResolvedValue({ data: BODY });
  renderPage();
  const rules = await screen.findByTestId("series-rules");
  expect(rules).toHaveTextContent("5 Runden je Turniertag, Platz 1 bis 8: 8 · 7 · 6 · 5 · 4 · 3 · 2 · 1 – die Summe ergibt den Tagesplatz");
  expect(rules).toHaveTextContent("Bingo +3 – zählen zusätzlich, nie gestrichen");
  expect(rules).toHaveTextContent("mehr Siege, dann mehr Plätze unter den besten 4, dann bessere Platzierungen");
  const table = screen.getByTestId("series-table");
  expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toContain("Boni");
  const bea = within(table).getAllByTestId("series-row")[1];
  expect(bea).toHaveTextContent("+3");
  expect(within(bea).getByTitle("Gleich viele Punkte – dahinter wegen: mehr Plätze unter den besten 4")).toBeInTheDocument();
});

test("Tagesansicht: der letzte Turniertag zuerst, R1–R5 mit Summe, Double Up mit Partner; T1 mit Platzfarben, Bonus und Ausgestiegen", async () => {
  apiMock.get.mockResolvedValue({ data: BODY });
  renderPage();
  const days = await screen.findByTestId("series-days");
  expect(within(days).getAllByTestId("series-day-pick").map((button) => [button.textContent, button.getAttribute("aria-pressed")])).toEqual([["T1", "false"], ["T2", "true"]]);
  expect(within(days).getByTestId("series-day-double-up")).toHaveTextContent("Double Up");
  const table = within(days).getByTestId("series-day-table");
  const rows = within(table).getAllByTestId("series-day-row");
  expect(rows.map((row) => within(row).getByTestId("series-day-total").textContent)).toEqual(["20", "20", "16", "16"]);
  // Im Double Up keine Platzfarbe aus Team-Punkten.
  expect(within(rows[0]).getAllByTestId("series-day-round").every((cell) => !cell.hasAttribute("data-tone"))).toBe(true);
  // Ein ausgeblendeter Name bleibt es auch als Partner.
  expect(within(rows[0]).getByTestId("series-day-partner")).toHaveTextContent("mit Name ausgeblendet");
  expect(within(rows[1]).getByText("Name ausgeblendet")).toBeInTheDocument();
  expect(within(rows[2]).getByTestId("series-day-partner")).toHaveTextContent("mit Cem Muster");

  fireEvent.click(within(days).getAllByTestId("series-day-pick")[0]);
  const t1 = within(within(days).getByTestId("series-day-table")).getAllByTestId("series-day-row");
  expect(t1.map((row) => row.querySelector("td").textContent)).toEqual(["1", "2", "3"]);
  const cells = within(t1[0]).getAllByTestId("series-day-round");
  expect(cells).toHaveLength(5);
  expect(cells[0]).toHaveAttribute("data-tone", "gold");
  expect(within(t1[1]).getAllByTestId("series-day-round")[0]).toHaveAttribute("data-tone", "silver");
  expect(within(t1[1]).getByTestId("series-day-bonus")).toHaveTextContent("Bingo +3");
  expect(within(t1[2]).getByTestId("series-day-left")).toHaveTextContent("Ausgestiegen");
  expect(within(t1[2]).getAllByLabelText(/R3: nicht gespielt/)).toHaveLength(1);
});

test("Lobby-Ansicht je Runde und Spieler-Detail mit Tages- und Saisonpunkten", async () => {
  apiMock.get.mockResolvedValue({ data: BODY });
  renderPage();
  const days = await screen.findByTestId("series-days");
  fireEvent.click(within(days).getAllByTestId("series-day-pick")[0]);
  fireEvent.click(within(days).getByTestId("series-day-view-lobbies"));
  const lobbyCards = within(days).getAllByTestId("series-lobby");
  expect(lobbyCards.map((card) => card.getAttribute("aria-label"))).toEqual(["Lobby A", "Lobby B"]);
  expect(within(lobbyCards[0]).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["1Ada Ausgedacht8", "2Bea Beispiel7"]);
  expect(within(lobbyCards[1]).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["1Cem Muster8"]);
  // R2: die Lobbys sind neu gemischt; ohne Platz kommt er aus den Punkten (1 Punkt = Platz 8).
  fireEvent.click(within(days).getAllByTestId("series-lobby-round")[1]);
  const second = within(days).getAllByTestId("series-lobby");
  expect(within(second[0]).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["1Ada Ausgedacht8", "8Cem Muster1"]);
  expect(within(second[1]).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["4Bea Beispiel5"]);

  // Detail: ohne Wahl das erste Vereinsmitglied; ein Name in der Tabelle öffnet seins.
  const detail = within(days).getByTestId("series-player-detail");
  expect(within(detail).getByTestId("series-player-summary")).toHaveTextContent("Platz 2 · 65 Saisonpunkte (davon 3 Sonderbonus) · 2 Turniertage · 1 Sieg · 2× Top 4");
  fireEvent.click(within(days).getByTestId("series-day-view-table"));
  fireEvent.click(within(days).getAllByTestId("series-day-name")[2]);
  const cem = within(days).getByTestId("series-player-detail");
  expect(within(cem).getByTestId("series-player-select")).toHaveValue("c");
  const lines = within(cem).getAllByTestId("series-player-day");
  expect(lines[0]).toHaveTextContent("Ausgestiegen");
  expect(lines[1]).toHaveTextContent("Double Up mit Ada Ausgedacht");
  expect(lines[1].querySelectorAll("td")[0]).toHaveTextContent("2");
});

test("Hilfen: Platz aus den Punkten nur eindeutig, Farben, Reihenfolge eines Tags, Lobbys, Detail", () => {
  expect(roundPlace({ points: 7 }, SCHEME)).toBe(2);
  expect(roundPlace({ points: 0 }, SCHEME)).toBeNull();
  expect(roundPlace({ points: 2, place: 7 }, SCHEME)).toBe(7);
  expect(["gold", "silver", "bronze", "top", null].map((tone, index) => placeTone(index + 1) === tone)).toEqual([true, true, true, true, true]);
  expect(dayRounds(BODY.rounds, ROWS).map((round) => round.id)).toEqual(["t1", "t2"]);
  expect(dayTable(ROWS, "t2").map((item) => item.key)).toEqual(["b", "d", "a", "c"]);
  expect(lobbies(dayTable(ROWS, "t2"), 0, SCHEME)).toBeNull();
  // Double Up: Team-Punkte sagen nichts über den Platz - nur ein eingetragener zählt.
  const duo = [{ key: "x", partner: ada, day_rounds: [{ points: 8, lobby: "A" }] }, { key: "y", partner: ada, day_rounds: [{ points: 3, place: 2, lobby: "A" }] }];
  expect(lobbies(duo, 0, SCHEME)[0].members.map((member) => [member.item.key, member.place])).toEqual([["y", 2], ["x", null]]);
  expect(playerDays(ROWS[0], dayRounds(BODY.rounds, ROWS))).toMatchObject({ played: 2, wins: 1, dayPoints: 56 });
  expect(tiebreakLabel({ tiebreakers: ["top_n"], tiebreak_top_n: 3 })).toBe("mehr Plätze unter den besten 3");
});
