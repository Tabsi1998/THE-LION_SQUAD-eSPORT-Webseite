import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Playoffs und Relegation an den vorhandenen Flächen (#2404): Kennzeichen „Playoff-Platz“ in der Tabelle samt Legende, die Wörter für
// die Staffel („Playoffs“ statt „Staffel PO“), „Beide nicht erschienen“ im K.-o. und der Baum auf der Ligaseite. Erfundene Namen.
const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => true }));
const bracketProps = [];
vi.mock("@/components/tls/BracketTree", () => ({ BracketTree: (props) => {
  bracketProps.push(props);
  return <div data-testid="bracket-tree">{(props.data.matches_v2 || []).length} Spiele</div>;
} }));

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
  // Nr. 245: Schon das erste Mal zählt - das Fenster sagt es vorher.
  expect(screen.getByTestId("match-double-no-show-sheet")).toHaveTextContent("zählt es schon als „nicht erschienen“");
  expect(screen.queryByTestId("match-double-no-show-back")).not.toBeInTheDocument();
  expect(screen.getByTestId("match-double-no-show-save")).toHaveTextContent("Neu ansetzen");
  fireEvent.change(screen.getByTestId("match-double-no-show-text"), { target: { value: "Beide nicht erschienen" } });
  fireEvent.click(screen.getByTestId("match-double-no-show-save"));
  expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/staffeln/t1/matches/m1/double-no-show", { note: "Beide nicht erschienen" });
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith(
    "Einmal neu angesetzt – bitte den Termin setzen. Es zählt für beide als „nicht erschienen“. Kommt wieder niemand, scheiden beide aus."));
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
  const pairs = [
    { pair: 1, decided: true, void: false, match_id: "m1", upper: { display_name: "Probe Oben", division_label: "Liga 1", score: 0, won: false },
      lower: { display_name: "Probe Unten", division_label: "Liga 2", score: 2, won: true } },
    { pair: 2, decided: false, void: false, match_id: "m2", upper: { display_name: "Probe Zwei", division_label: "Liga 1", score: null, won: false },
      lower: { display_name: "Probe Drei", division_label: "Liga 2", score: null, won: false } }];
  const division = { id: "d1", level: 1, label: "Liga 1", postseason: [
    { tournament_id: "po1", slug: "probe-po", kind: "playoff", label: "Playoffs", closed: false },
    { tournament_id: "rel1", slug: "probe-rel", kind: "relegation", label: "Relegation", closed: true, pairs }] };
  const { unmount } = render(<MemoryRouter><DivisionPostseason division={division} /></MemoryRouter>);
  const playoffs = screen.getByTestId("league-postseason-playoff-po1");
  expect(within(playoffs).getByRole("heading", { name: "Playoffs" })).toBeInTheDocument();
  await waitFor(() => expect(within(playoffs).getByTestId("bracket-tree")).toHaveTextContent("3 Spiele"));
  expect(apiMock.get).toHaveBeenCalledWith("/tournaments/po1/bracket");
  expect(within(playoffs).getByRole("link", { name: "Playoffs Liga 1: alle Spiele" })).toHaveAttribute("href", "/tournaments/probe-po/bracket");
  // Nr. 248: Der Baum heißt „Playoffs“ - der Abschnittstitel des Turnierbaums („Winner Bracket“) entfällt.
  expect(bracketProps.at(-1)).toMatchObject({ quietSections: true, compact: true });
  // Relegation lesbar: je Paarung, wer aus welcher Liga kommt, ohne Setzplätze - und was aus dem Ergebnis folgt.
  const relegation = screen.getByTestId("league-postseason-relegation-rel1");
  expect(relegation).toHaveTextContent("Endstand");
  expect(within(relegation).queryByTestId("bracket-tree")).not.toBeInTheDocument();
  expect(apiMock.get).not.toHaveBeenCalledWith("/tournaments/rel1/bracket");
  const first = within(relegation).getByTestId("league-relegation-pair-rel1-1");
  expect(first).toHaveTextContent("Liga 1 · Heim");
  expect(first).toHaveTextContent("Probe Oben");
  expect(first).toHaveTextContent("Liga 2");
  expect(first).toHaveTextContent("Probe Unten steigt auf, Probe Oben steigt ab.");
  expect(within(first).getByRole("link")).toHaveAttribute("href", "/matches/m1");
  expect(within(relegation).getByTestId("league-relegation-pair-rel1-2")).toHaveTextContent("Noch nicht gespielt");
  unmount();
  const { container } = render(<MemoryRouter><DivisionPostseason division={{ id: "d2", label: "Liga 2", staffeln: [] }} /></MemoryRouter>);
  expect(container).toBeEmptyDOMElement();
});

test("im K.-o. lässt sich die Neuansetzung mit Grund zurücknehmen", async () => {
  apiMock.delete.mockResolvedValue({ data: { no_show_step: "undo" } });
  const match = { id: "m1", tournament_id: "t1", status: "scheduled", results: [], postseason: { kind: "relegation" }, no_show_retry: { at: "2031-04-01T10:00:00+00:00" } };
  render(<DoubleNoShowAction match={match} />);
  fireEvent.click(screen.getByTestId("match-double-no-show-back"));
  expect(screen.getByTestId("match-double-no-show-sheet")).toHaveTextContent("Der Eintrag „nicht erschienen“ fällt für beide Seiten weg");
  expect(screen.getByTestId("match-double-no-show-save")).toHaveTextContent("Zurücknehmen");
  fireEvent.change(screen.getByTestId("match-double-no-show-text"), { target: { value: "Server war ausgefallen" } });
  fireEvent.click(screen.getByTestId("match-double-no-show-save"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/admin/leagues/staffeln/t1/matches/m1/double-no-show", { data: { reason: "Server war ausgefallen" } }));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Zurückgenommen. Der Eintrag „nicht erschienen“ fällt für beide weg."));
  expect(apiMock.post).not.toHaveBeenCalled();
});
