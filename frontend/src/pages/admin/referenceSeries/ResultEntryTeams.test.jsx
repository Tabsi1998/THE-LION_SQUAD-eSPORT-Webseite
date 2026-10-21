import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Teamwertung im Ergebnisblatt (#1960, Entscheidung „was im Feld steht, zählt“): eine neue Zeile bekommt das Stammteam
// sichtbar vorbelegt - beim Eintragen eines bekannten Namens und beim Einfügen einer Liste ohne Team-Spalte. Ein leeres
// Feld heißt kein Team; der Hinweis sagt es und bietet das Stammteam mit einem Klick an. Nur erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => (typeof detail === "string" ? detail : "Fehler") }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ResultEntrySheet } = await import("./ResultEntrySheet");

const SERIES = { id: "serie-1", lineage: { title: "Probe Rennliga", kind: "racing" }, access: { role: "board", can_publish: true } };
const ROUND = { id: "r1", code: "R1", session: "Rennen", counts: true, club_day: "2026-03-07", venue: "Probering" };
const RULES = { points_mode: "scheme", points_by_place: [10, 6, 4], team_scoring: { enabled: true, mode: "per_race", no_team_names: ["Ersatzfahrer"] } };
const PEOPLE = [
  { id: "p1", name: "Chris Probe", default_team: "Turbo Probe" },
  { id: "p2", name: "Lina Probe", default_team: "Löwen Probe" },
];

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
  apiMock.get.mockResolvedValue({ data: {
    round: ROUND, series: { id: "serie-1", kind: "racing", rules: RULES },
    access: { role: "board", can_publish: true }, version: 0, sheet: null, target: "sheet", participants: PEOPLE,
  } });
  apiMock.post.mockResolvedValue({ data: { version: 0, target: "sheet", can_save: true, errors: [], warnings: [], rows: [], unknown_names: [], standings: null, final: null, latest: null } });
});

async function openSheet() {
  render(<ResultEntrySheet series={SERIES} round={ROUND} onClose={() => {}} onSaved={() => {}} />);
  return screen.findByTestId("result-sheet");
}

test("ein bekannter Name bekommt sein Stammteam ins Feld; gelöscht zählt die Zeile für kein Team", async () => {
  const sheet = await openSheet();
  fireEvent.change(within(sheet).getByTestId("result-row-name"), { target: { value: "Chris Probe" } });
  const team = within(sheet).getByTestId("result-row-team");
  expect(team).toHaveValue("Turbo Probe");
  expect(within(sheet).queryByTestId("result-row-team-hint")).toBeNull();

  fireEvent.change(team, { target: { value: "" } });
  expect(within(sheet).getByTestId("result-row-team-hint")).toHaveTextContent("zählt für kein Team");
  fireEvent.click(within(sheet).getByTestId("result-row-team-default"));
  expect(within(sheet).getByTestId("result-row-team")).toHaveValue("Turbo Probe");
  expect(within(sheet).queryByTestId("result-row-team-hint")).toBeNull();

  fireEvent.change(within(sheet).getByTestId("result-row-team"), { target: { value: "Ersatzfahrer" } });
  expect(within(sheet).getByTestId("result-row-team-hint")).toHaveTextContent("zählt für kein Team (Ersatz)");
  expect(within(sheet).queryByTestId("result-row-team-default")).toBeNull();
});

test("Liste ohne Team-Spalte: vorbelegt; mit Team-Spalte gilt, was dasteht", async () => {
  const sheet = await openSheet();
  fireEvent.click(within(sheet).getByTestId("result-paste-toggle"));
  fireEvent.change(screen.getByTestId("result-paste-text"), { target: { value: "1. Chris Probe\n2. Lina Probe\n3. Neu Probe" } });
  fireEvent.click(screen.getByTestId("result-paste-apply"));
  await waitFor(() => expect(within(sheet).getAllByTestId("result-row-team").map((input) => input.value)).toEqual(["Turbo Probe", "Löwen Probe", ""]));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  expect(apiMock.post.mock.calls.at(-1)[1].rows.map((row) => row.team ?? null)).toEqual(["Turbo Probe", "Löwen Probe", null]);

  fireEvent.click(within(sheet).getByTestId("result-paste-toggle"));
  fireEvent.change(screen.getByTestId("result-paste-text"), { target: { value: "Pos\tName\tTeam\n1\tChris Probe\tErsatzfahrer\n2\tLina Probe\t" } });
  fireEvent.click(screen.getByTestId("result-paste-apply"));
  await waitFor(() => expect(within(sheet).getAllByTestId("result-row-team").map((input) => input.value)).toEqual(["Ersatzfahrer", ""]));
  expect(within(sheet).getAllByTestId("result-row-team-hint").map((hint) => hint.textContent)).toEqual(["zählt für kein Team (Ersatz)", "zählt für kein Team"]);
  expect(within(sheet).getByTestId("result-row-team-default")).toHaveTextContent("Stammteam Löwen Probe eintragen");
});

// Einzel-Serien ohne Teams (#1969): das Feld „Team“ nahm am Handy eine eigene Zeile ein, obwohl die Saison keine Teams
// führt. Ohne Teamwertung und ohne Teams bleibt es weg; sobald es Teams gibt (Saison, Stammteams, eingefügte Liste), steht es.
test("ohne Teamwertung und ohne Teams kein Team-Feld - mit Teams bleibt es", async () => {
  apiMock.get.mockResolvedValue({ data: {
    round: ROUND, series: { id: "serie-1", kind: "racing", rules: { points_mode: "scheme", points_by_place: [10, 6, 4] } },
    access: { role: "board", can_publish: true }, version: 0, sheet: null, target: "sheet", participants: [{ id: "p1", name: "Chris Probe" }],
  } });
  const sheet = await openSheet();
  expect(within(sheet).getAllByTestId("result-row-name").length).toBeGreaterThan(0);
  expect(within(sheet).queryByTestId("result-row-team")).toBeNull();
  // Eine eingefügte Liste mit Team-Spalte bringt das Feld zurück - nichts Eingetragenes verschwindet.
  fireEvent.click(within(sheet).getByTestId("result-paste-toggle"));
  fireEvent.change(screen.getByTestId("result-paste-text"), { target: { value: "Pos\tName\tTeam\n1\tChris Probe\tTurbo Probe" } });
  fireEvent.click(screen.getByTestId("result-paste-apply"));
  await waitFor(() => expect(within(sheet).getAllByTestId("result-row-team").map((input) => input.value)).toEqual(["Turbo Probe"]));
});

test("ohne Teamwertung, aber mit Stammteams der Teilnehmer steht das Team-Feld", async () => {
  apiMock.get.mockResolvedValue({ data: {
    round: ROUND, series: { id: "serie-1", kind: "racing", rules: { points_mode: "scheme", points_by_place: [10, 6, 4] } },
    access: { role: "board", can_publish: true }, version: 0, sheet: null, target: "sheet", participants: PEOPLE,
  } });
  const sheet = await openSheet();
  expect(within(sheet).getAllByTestId("result-row-team").length).toBeGreaterThan(0);
});