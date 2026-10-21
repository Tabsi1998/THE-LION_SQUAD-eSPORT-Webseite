import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Team-Liga im Ergebnisblatt (#1931): Spieltag einfügen (eigenes Spiel erkannt, übrige Spiele dazu), Kader als
// Ankreuzliste, Aufstellung von der Match-Seite, Maps im Veto (Wahl, Bann, Decider) - bis in den Vertrag des Servers. Nur
// erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => (typeof detail === "string" ? detail : "Fehler") }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ResultEntrySheet } = await import("./ResultEntrySheet");

const PEOPLE = [
  { id: "p-anna", name: "Anna Probe", default_team: "Probe Löwen", kind: "person" },
  { id: "p-bert", name: "Bert Probe", default_team: "Probe Löwen", kind: "person" },
  { id: "p-cleo", name: "Cleo Probe", default_team: "Probe Löwen", kind: "person" },
  { id: "p-dora", name: "Dora Probe", default_team: "Probe Löwen", kind: "person" },
  { id: "p-emil", name: "Emil Probe", default_team: "Probe Löwen", kind: "person" },
];
const SERIES = { id: "serie-1", lineage: { title: "Probe Liga", kind: "team_league" }, access: { role: "board", can_publish: true } };

function data(overrides = {}) {
  return {
    round: { id: "st2", code: "ST2", club_day: "2026-06-17", club_day_end: "2026-06-21", opponent: "Probe Falken", at_home: false },
    series: { id: "serie-1", kind: "team_league", team_name: "Probe Löwen", own_teams: ["Probe Löwen"],
      own_team_list: [{ name: "Probe Löwen", aliases: ["TLS Probe"] }], rules: { points_mode: "organizer" } },
    access: { role: "board", can_publish: true }, version: 0, sheet: null, target: "sheet", participants: PEOPLE,
    ...overrides,
  };
}

async function openSheet(body = data()) {
  apiMock.get.mockResolvedValue({ data: body });
  apiMock.post.mockResolvedValue({ data: { version: 0, target: "sheet", can_save: true, errors: [], warnings: [], rows: [], matches: [], unknown_names: [] } });
  render(<ResultEntrySheet series={SERIES} round={body.round} onClose={() => {}} onSaved={() => {}} />);
  return screen.findByTestId("result-team-league");
}

async function payload() {
  fireEvent.click(screen.getByTestId("result-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  return apiMock.post.mock.calls.at(-1)[1];
}

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
});

const ALL = [
  "Begegnungen des 1. Spieltags",
  "Termin\tHeim\t\tAuswärts\t\tErgebnis\tLink",
  "10.06.2026 20:30 Uhr\tProbe Löwen\t\tProbe Adler\t\t2:0\tZum Matchup",
  "Begegnungen des 2. Spieltags",
  "Zeitraum: 17.06.2026 - 21.06.2026",
  "Termin\tHeim\t\tAuswärts\t\tErgebnis\tLink",
  "17.06.2026 20:30 Uhr\tProbe Wölfe\t\tProbe Bären\t\t1:1\tZum Matchup",
  "18.06.2026 21:15 Uhr\tProbe Falken\t\tTLS Probe\t\t1:2\tZum Matchup",
  "19.06.2026 20:00 Uhr\tProbe Eulen\t\tProbe Füchse\t\t-:-\t",
].join("\n");

test("Spieltag einfügen: aus „Alle“ der passende Spieltag, das eigene Spiel ausgefüllt, die übrigen mit Ergebnis dazu", async () => {
  await openSheet();
  fireEvent.change(screen.getByTestId("result-matchday-paste-text"), { target: { value: ALL } });
  fireEvent.click(screen.getByTestId("result-matchday-paste-apply"));
  const summary = screen.getByTestId("result-matchday-summary");
  expect(summary).toHaveTextContent("Eigenes Spiel erkannt: Probe Falken 1:2 TLS Probe");
  expect(summary).toHaveTextContent("2. Spieltag");
  expect(summary).toHaveTextContent("1 weiteres Spiel übernommen");
  expect(summary).toHaveTextContent("1 Spiel noch ohne Ergebnis");
  expect(screen.getByTestId("result-match-home")).toHaveValue("Probe Falken");
  expect(screen.getByTestId("result-match-time")).toHaveValue("21:15");
  expect(screen.getAllByTestId("result-other")).toHaveLength(1);

  const body = await payload();
  expect(body.matches).toEqual([
    { home: "Probe Falken", away: "TLS Probe", home_score: 1, away_score: 2, day: "2026-06-18", time: "21:15", maps: [], lineup: [] },
    { home: "Probe Wölfe", away: "Probe Bären", home_score: 1, away_score: 1, maps: [], lineup: [] },
  ]);
});

test("zwei eigene Teams am selben Spieltag (Prüfung #1931): beide erkannt, beide bearbeitbar, beide im Vertrag", async () => {
  const body = data();
  await openSheet({ ...body, series: { ...body.series, own_teams: ["Probe Löwen", "Probe Löwen B"],
    own_team_list: [{ name: "Probe Löwen", aliases: [] }, { name: "Probe Löwen B", aliases: [] }] } });
  fireEvent.change(screen.getByTestId("result-matchday-paste-text"), { target: { value: [
    "Termin\tHeim\tAuswärts\tErgebnis",
    "17.06.2026 20:30 Uhr\tProbe Löwen B\tProbe Adler\t2:1",
    "18.06.2026 21:00 Uhr\tProbe Falken\tProbe Löwen\t0:2",
  ].join("\n") } });
  fireEvent.click(screen.getByTestId("result-matchday-paste-apply"));
  expect(screen.getByTestId("result-matchday-summary")).toHaveTextContent("Eigene Spiele erkannt: Probe Löwen B 2:1 Probe Adler · Probe Falken 0:2 Probe Löwen");
  expect(screen.getAllByTestId("result-match")).toHaveLength(2);
  expect(screen.queryAllByTestId("result-other")).toHaveLength(0);
  const sent = await payload();
  expect(sent.matches.map((match) => [match.home, match.away, match.home_score, match.away_score])).toEqual([
    ["Probe Löwen B", "Probe Adler", 2, 1], ["Probe Falken", "Probe Löwen", 0, 2]]);
});

test("ohne „übrige Spiele mitspeichern“ bleibt nur das eigene Spiel", async () => {
  await openSheet();
  fireEvent.click(screen.getByTestId("result-matchday-keep-others"));
  fireEvent.change(screen.getByTestId("result-matchday-paste-text"), { target: { value: ALL } });
  fireEvent.click(screen.getByTestId("result-matchday-paste-apply"));
  expect(screen.queryAllByTestId("result-other")).toHaveLength(0);
});

test("Kader als Ankreuzliste, Maps im Veto mit Rolle und Aufstellung je Map, Namen mit Vorschlägen aus der Saison", async () => {
  await openSheet(data({ series: { ...data().series, map_names: ["Karte Süd", "Karte Nord"] } }));
  expect([...document.querySelectorAll("#result-map-names option")].map((option) => option.value)).toEqual(["Karte Süd", "Karte Nord"]);
  const picker = screen.getByTestId("result-lineup-picker");
  const people = within(picker).getAllByTestId("result-lineup-person");
  expect(people.map((item) => item.textContent)).toEqual(["Anna Probe", "Bert Probe", "Cleo Probe", "Dora Probe", "Emil Probe"]);
  fireEvent.click(people[0]);
  fireEvent.click(people[2]);
  expect(people[0]).toHaveAttribute("aria-pressed", "true");
  expect(within(picker).getByText(/Aufstellung · 2 von 5 im Kader/)).toBeInTheDocument();

  fireEvent.change(screen.getByTestId("result-match-home-score"), { target: { value: "2" } });
  fireEvent.change(screen.getByTestId("result-match-away-score"), { target: { value: "0" } });
  // Erst der Bann, dann die gespielte Map - die Reihenfolge ist die des Vetos.
  fireEvent.click(screen.getByTestId("result-map-add"));
  fireEvent.change(screen.getAllByTestId("result-map-name")[0], { target: { value: "Karte Ost" } });
  fireEvent.change(screen.getAllByTestId("result-map-role")[0], { target: { value: "banned:opponent" } });
  expect(screen.getByTestId("result-map-banned")).toHaveTextContent("gesperrt");
  fireEvent.click(screen.getByTestId("result-map-add"));
  fireEvent.change(screen.getAllByTestId("result-map-name")[1], { target: { value: "Karte Nord" } });
  fireEvent.change(screen.getAllByTestId("result-map-role")[1], { target: { value: "picked:own" } });
  fireEvent.change(screen.getByTestId("result-map-home"), { target: { value: "6" } });
  fireEvent.change(screen.getByTestId("result-map-away"), { target: { value: "2" } });
  fireEvent.click(screen.getByTestId("result-lineup-per-map"));
  // Je Map nur die gespielten Maps.
  expect(screen.getAllByTestId("result-map-lineup")).toHaveLength(1);
  const mapPeople = within(screen.getByTestId("result-map-lineup")).getAllByTestId("result-map-lineup-person");
  fireEvent.click(mapPeople[1]);

  const body = await payload();
  expect(body.matches[0]).toEqual({
    home: "Probe Löwen", away: "Probe Falken", home_score: 2, away_score: 0,
    maps: [
      { name: "Karte Ost", role: "banned", by: "opponent" },
      { name: "Karte Nord", role: "picked", by: "own", home_score: 6, away_score: 2, lineup: [{ participant_id: "p-bert" }] },
    ],
    lineup: [{ participant_id: "p-anna" }, { participant_id: "p-cleo" }, { participant_id: "p-bert" }],
  });
});

test("Aufstellung von der Match-Seite: Häkchen setzen an, ohne Häkchen ein Hinweis zum Ankreuzen", async () => {
  await openSheet();
  fireEvent.click(screen.getByTestId("result-lineup-paste-toggle"));
  fireEvent.change(screen.getByTestId("result-lineup-paste-text"), { target: { value: "Seasonteam-Mitglieder\tWarorga\nAnna Probe\t✓\nBert Probe\t\nGast Gustav\tx" } });
  fireEvent.click(screen.getByTestId("result-lineup-paste-apply"));
  expect(screen.getByTestId("result-lineup-notice")).toHaveTextContent("3 Namen gelesen, Häkchen übernommen.");
  const picker = screen.getByTestId("result-lineup-picker");
  const pressed = within(picker).getAllByTestId("result-lineup-person").filter((item) => item.getAttribute("aria-pressed") === "true");
  expect(pressed.map((item) => item.textContent)).toEqual(["Anna Probe", "Gast Gustav"]);

  fireEvent.click(screen.getByTestId("result-lineup-paste-toggle"));
  fireEvent.change(screen.getByTestId("result-lineup-paste-text"), { target: { value: "Seasonteam-Mitglieder\tWarorga\nDora Probe\t\nNeu Nina\t" } });
  fireEvent.click(screen.getByTestId("result-lineup-paste-apply"));
  expect(screen.getByTestId("result-lineup-notice")).toHaveTextContent("kein Häkchen erkannt – bitte unten ankreuzen");
  const names = within(picker).getAllByTestId("result-lineup-person").map((item) => item.textContent);
  expect(names).toContain("Neu Nina");
});
