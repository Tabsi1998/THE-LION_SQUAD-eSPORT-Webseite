import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Playoffs und Relegation an den vorhandenen Flächen (#2404): Kennzeichen „Playoff-Platz“ in der Tabelle samt Legende, die Wörter für
// die Staffel („Playoffs“ statt „Staffel PO“), „Beide nicht erschienen“ im K.-o. und der Baum auf der Ligaseite. Erfundene Namen.
const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => true }));
vi.mock("@/components/tls/BracketTree", () => ({ BracketTree: ({ data }) => <div data-testid="bracket-tree">{(data.matches_v2 || []).length} Spiele</div> }));

const { StandingsTable, ZoneLegend } = await import("@/components/tls/tournament/StandingsTable");
const { DoubleNoShowAction } = await import("./DoubleNoShowAction");
const { DivisionPostseason } = await import("./public/SeasonPostseasonSection");
const { staffelLabel: trailLabel, leagueCrumbs } = await import("@/lib/leagueTrail");
const { seasonSummary, staffelLabel: cockpitLabel } = await import("@/lib/leagueFinal");
const { staffelLabel: adminLabel } = await import("@/pages/admin/tournament/StaffelParts");

const row = (index, extra = {}) => ({ registration_id: `r${index}`, display_name: `Probe ${index}`, rank: index, played: 3, won: 4 - index, drawn: 0, lost: index - 1,
  score_for: 8 - index, score_against: index, score_diff: 8 - 2 * index, points: 12 - 3 * index, form: [], ...extra });

beforeEach(() => {
  for (const fn of [...Object.values(apiMock), ...Object.values(toastMock)]) fn.mockReset();
});

test("die Tabelle kennzeichnet Playoff-Plätze am Namen - mit Wort für Screenreader und Legende", () => {
  const rows = [row(1, { playoff: true, zone: "promotion" }), row(2, { playoff: true }), row(3)];
  render(<><StandingsTable rows={rows} kind="team_league" label="Tabelle" /><ZoneLegend rows={rows} testId="legend" /></>);
  expect(screen.getByTestId("standing-playoff-r1")).toBeInTheDocument();
  expect(screen.getByTestId("standing-playoff-r2")).toBeInTheDocument();
  expect(screen.queryByTestId("standing-playoff-r3")).not.toBeInTheDocument();
  expect(within(screen.getByTestId("standing-row-r1")).getByText("Playoff-Platz")).toHaveClass("sr-only");
  // Ein Team kann zugleich Aufsteiger und Playoff-Teilnehmer sein: Zone und Kennzeichen stehen nebeneinander.
  expect(screen.getByTestId("standing-zone-r1")).toBeInTheDocument();
  expect(screen.getByTestId("legend")).toHaveTextContent("Aufstieg");
  expect(screen.getByTestId("zone-legend-playoff")).toHaveTextContent("Playoff-Platz");
});

test("ohne Playoff-Platz bleibt die Tabelle, wie sie war - keine Legende ohne Zonen", () => {
  const rows = [row(1), row(2)];
  const { container } = render(<><StandingsTable rows={rows} kind="team_league" label="Tabelle" /><ZoneLegend rows={rows} testId="legend" /></>);
  expect(container.querySelector(".tls-playoff-mark")).toBeNull();
  expect(screen.queryByTestId("legend")).not.toBeInTheDocument();
});

test("eine Playoff- oder Relegations-Staffel heißt nie „Staffel PO“", () => {
  const playoff = { id: "t2", slug: "liga-po", league_context: { league_id: "lg1", season_id: "s1", staffel: "PO", kind: "playoff" }, league_links: { division_label: "Liga 1" } };
  const relegation = { ...playoff, league_context: { ...playoff.league_context, staffel: "REL", kind: "relegation" } };
  const regular = { ...playoff, league_context: { league_id: "lg1", season_id: "s1", staffel: "A" } };
  expect([trailLabel(playoff), trailLabel(relegation), trailLabel(regular)]).toEqual(["Playoffs", "Relegation", "Staffel A"]);
  expect([adminLabel(playoff), adminLabel(relegation), adminLabel(regular)]).toEqual(["Liga 1 · Playoffs", "Liga 1 · Relegation", "Liga 1 · Staffel A"]);
  expect(leagueCrumbs(playoff, null).at(-1)).toEqual({ label: "Playoffs" });
  expect(cockpitLabel({ division_label: "Liga 1", staffel: "PO", kind: "playoff", label: "Playoffs" })).toBe("Liga 1 · Playoffs");
  expect(cockpitLabel({ division_label: "Liga 1", staffel: "A" })).toBe("Liga 1 · Staffel A");
});

test("die Season ist nicht beendet, solange eingestellte Playoffs fehlen", () => {
  const rows = [{ closed: true }, { closed: true }];
  expect(seasonSummary({ staffeln: rows })).toMatch(/die Season ist beendet/);
  const waiting = seasonSummary({ staffeln: rows, postseason_missing: [{ text: "Die Playoffs von Liga 1 sind noch nicht angelegt." }] });
  expect(waiting).toBe("Alle 2 Staffeln sind abgeschlossen. Die Playoffs von Liga 1 sind noch nicht angelegt. Solange läuft die Season weiter.");
});

test("beide nicht erschienen im K.-o.: erst neu ansetzen, beim zweiten Mal scheiden beide aus", async () => {
  const base = { id: "m1", tournament_id: "t1", status: "scheduled", results: [], postseason: { kind: "playoff" } };
  apiMock.post.mockResolvedValue({ data: { no_show_step: "retry" } });
  const { unmount } = render(<DoubleNoShowAction match={base} />);
  fireEvent.click(screen.getByTestId("match-double-no-show"));
  expect(screen.getByTestId("match-double-no-show-sheet")).toHaveTextContent("beim ersten Mal einmal neu angesetzt");
  expect(screen.getByTestId("match-double-no-show-save")).toHaveTextContent("Neu ansetzen");
  fireEvent.change(screen.getByTestId("match-double-no-show-text"), { target: { value: "Beide nicht erschienen" } });
  fireEvent.click(screen.getByTestId("match-double-no-show-save"));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Einmal neu angesetzt – bitte den Termin setzen. Kommt wieder niemand, scheiden beide aus."));
  unmount();
  apiMock.post.mockResolvedValue({ data: {} });
  render(<DoubleNoShowAction match={{ ...base, no_show_retry: { at: "2031-04-01T10:00:00+00:00" } }} />);
  fireEvent.click(screen.getByTestId("match-double-no-show"));
  expect(screen.getByTestId("match-double-no-show-sheet")).toHaveTextContent("Jetzt scheiden beide aus");
  expect(screen.getByTestId("match-double-no-show-save")).toHaveTextContent("Beide ausscheiden lassen");
  fireEvent.change(screen.getByTestId("match-double-no-show-text"), { target: { value: "Wieder nicht erschienen" } });
  fireEvent.click(screen.getByTestId("match-double-no-show-save"));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Beide sind ausgeschieden. Der nächste Gegner kommt kampflos weiter."));
});

test("in einer regulären Staffel bleibt „beide nicht erschienen“ die Wertung von vorher", async () => {
  apiMock.post.mockResolvedValue({ data: {} });
  render(<DoubleNoShowAction match={{ id: "m1", tournament_id: "t1", status: "scheduled", results: [] }} />);
  fireEvent.click(screen.getByTestId("match-double-no-show"));
  expect(screen.getByTestId("match-double-no-show-sheet")).toHaveTextContent("Beide Seiten verlieren");
  expect(screen.getByTestId("match-double-no-show-save")).toHaveTextContent("Werten");
});

test("die Ligaseite zeigt Playoffs und Relegation einer Liga als Baum - ohne sie nichts", async () => {
  apiMock.get.mockResolvedValue({ data: { matches_v2: [{ id: "a" }, { id: "b" }, { id: "c" }] } });
  const division = { id: "d1", level: 1, label: "Liga 1", postseason: [
    { tournament_id: "po1", slug: "probe-po", kind: "playoff", label: "Playoffs", closed: false },
    { tournament_id: "rel1", slug: "probe-rel", kind: "relegation", label: "Relegation", closed: true }] };
  const { unmount } = render(<MemoryRouter><DivisionPostseason division={division} /></MemoryRouter>);
  const playoffs = screen.getByTestId("league-postseason-playoff-po1");
  expect(within(playoffs).getByRole("heading", { name: "Playoffs" })).toBeInTheDocument();
  await waitFor(() => expect(within(playoffs).getByTestId("bracket-tree")).toHaveTextContent("3 Spiele"));
  expect(apiMock.get).toHaveBeenCalledWith("/tournaments/po1/bracket");
  expect(within(playoffs).getByRole("link", { name: "Playoffs Liga 1: alle Spiele" })).toHaveAttribute("href", "/tournaments/probe-po/bracket");
  expect(screen.getByTestId("league-postseason-relegation-rel1")).toHaveTextContent("Endstand");
  unmount();
  const { container } = render(<MemoryRouter><DivisionPostseason division={{ id: "d2", label: "Liga 2", staffeln: [] }} /></MemoryRouter>);
  expect(container).toBeEmptyDOMElement();
});
