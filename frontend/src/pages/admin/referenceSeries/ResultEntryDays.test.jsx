import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Ergebnisblatt eines Turniertags (#1961): Spalten R1…R5 und GES P je Zeile, Rundenmatrix einfügen (Platz aus GES P,
// Gleichstand teilt ihn), Sonderbonus als Chip, „Ausgestiegen“ als Marke und Double Up mit Partner. Nur erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => (typeof detail === "string" ? detail : "Fehler") }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ResultEntrySheet } = await import("./ResultEntrySheet");

const SERIES = { id: "serie-1", lineage: { title: "Probe Masters", kind: "series" }, access: { role: "board", can_publish: true } };
const ROUND = { id: "t1", code: "T1", club_day: "2026-10-04" };
const RULES = {
  points_mode: "scheme", points_by_place: [35, 30, 26, 23, 20, 18, 16, 14],
  day_rounds: { count: 5, points_by_place: [8, 7, 6, 5, 4, 3, 2, 1] }, custom_bonuses: [{ key: "bingo", label: "Bingo", points: 3 }],
};

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
  apiMock.get.mockResolvedValue({ data: {
    round: ROUND, series: { id: "serie-1", kind: "series", rules: RULES },
    access: { role: "board", can_publish: true }, version: 0, sheet: null, target: "sheet", participants: [],
  } });
  apiMock.post.mockResolvedValue({ data: { version: 0, target: "sheet", can_save: true, errors: [], warnings: [], rows: [], unknown_names: [], standings: null, final: null, latest: null } });
});

test("Rundenmatrix einfügen: R1–R5 je Zeile, GES P bestimmt den Platz, Gleichstand teilt ihn, Bingo als Chip", async () => {
  render(<ResultEntrySheet series={SERIES} round={ROUND} onClose={() => {}} onSaved={() => {}} />);
  const sheet = await screen.findByTestId("result-sheet");
  // Ohne Eintrag schon fünf Spalten je Zeile - die Saison führt Runden.
  expect(within(sheet).getAllByTestId("result-row-round")).toHaveLength(5);

  fireEvent.click(within(sheet).getByTestId("result-paste-toggle"));
  fireEvent.change(screen.getByTestId("result-paste-text"), { target: { value: [
    "Name\tR 1\tR 2\tR 3\tR 4\tR 5\tGES P\tBingo",
    "Ada Ausgedacht\t8\t8\t8\t8\t8\t40\t",
    "Bea Beispiel\t5\t4\t5\t4\t4\t22\tx",
    "Cem Muster\t4\t5\t4\t5\t4\t22\t",
    "Dan Demo\t1\t1\t1\t1\t1\t5\t",
  ].join("\n") } });
  fireEvent.click(screen.getByTestId("result-paste-apply"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  const rows = within(sheet).getAllByTestId("result-row");
  expect(rows).toHaveLength(4);
  expect(within(rows[1]).getAllByTestId("result-row-round").map((input) => input.value)).toEqual(["5", "4", "5", "4", "4"]);
  expect(within(sheet).getAllByTestId("result-row-place").map((input) => input.placeholder)).toEqual(["1", "2", "2", "4"]);
  expect(within(rows[1]).getByTestId("result-row-bonus-bingo")).toHaveAttribute("aria-pressed", "true");
  const body = apiMock.post.mock.calls.at(-1)[1];
  expect(body.rows.map((row) => [row.name, row.place, row.day_points, row.day_rounds.length, row.bonus_keys ?? []])).toEqual([
    ["Ada Ausgedacht", 1, 40, 5, []], ["Bea Beispiel", 2, 22, 5, ["bingo"]], ["Cem Muster", 2, 22, 5, []], ["Dan Demo", 4, 5, 5, []],
  ]);

  // Unter „Mehr“: Platz in der Lobby und „Ausgestiegen“; die Marke geht mit.
  fireEvent.click(within(rows[3]).getByTestId("result-row-more"));
  expect(within(rows[3]).getByTestId("result-row-day-details")).toBeInTheDocument();
  expect(within(rows[3]).queryByTestId("result-row-mark-fastest_lap")).toBeNull();
  fireEvent.click(within(rows[3]).getByTestId("result-row-mark-left"));
  fireEvent.click(within(sheet).getByTestId("result-submit"));
  await waitFor(() => expect(apiMock.post.mock.calls.at(-1)[1].rows[3].marks).toEqual(["left"]));
});

test("Double Up: Partner je Zeile, ein Paar teilt den Platz, das Blatt sagt es dem Server", async () => {
  render(<ResultEntrySheet series={SERIES} round={ROUND} onClose={() => {}} onSaved={() => {}} />);
  const sheet = await screen.findByTestId("result-sheet");
  fireEvent.click(within(sheet).getByTestId("result-paste-toggle"));
  fireEvent.change(screen.getByTestId("result-paste-text"), { target: { value: [
    "Name\tR 1\tR 2\tGES P", "Ada\t4\t4\t8", "Bea\t4\t4\t8", "Cem\t3\t3\t6", "Dan\t3\t3\t6",
  ].join("\n") } });
  fireEvent.click(screen.getByTestId("result-paste-apply"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  expect(within(sheet).queryByTestId("result-row-partner")).toBeNull();
  fireEvent.click(within(sheet).getByTestId("result-double-up-toggle"));
  const partners = within(sheet).getAllByTestId("result-row-partner");
  fireEvent.change(partners[0], { target: { value: "Bea" } });
  fireEvent.change(partners[2], { target: { value: "Dan" } });
  expect(within(sheet).getAllByTestId("result-row-place").map((input) => input.placeholder)).toEqual(["1", "1", "2", "2"]);
  fireEvent.click(within(sheet).getByTestId("result-submit"));
  await waitFor(() => expect(apiMock.post.mock.calls.at(-1)[1].double_up).toBe(true));
  const body = apiMock.post.mock.calls.at(-1)[1];
  expect(body.rows.map((row) => [row.name, row.place, row.partner?.name ?? null])).toEqual([
    ["Ada", 1, "Bea"], ["Bea", 1, null], ["Cem", 2, "Dan"], ["Dan", 2, null],
  ]);
});
