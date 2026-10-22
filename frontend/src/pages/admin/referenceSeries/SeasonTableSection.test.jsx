import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Saisontabelle einlesen (#1928): Tabelle einfügen, Vorschau je Runde mit Termin, gelbe Zellen klären, Abgleich mit
// „Gesamt“ und gezielt übernehmen – danach „Unbekannte Namen“. Nur erfundene Namen.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => (typeof detail === "string" ? detail : "Fehler") }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { SeasonTableSection } = await import("./SeasonTableSection");

const URL = "/reference-series/admin/series/serie-1/season-table";
const TEXT = "Pos\tFahrer\tTeam\tR1\tR2\tGesamt\n1\tAda Ausgedacht\tProbe Rot\t25\t21\t46\n2\tBruno Beispiel\tProbe Blau\t18\tOUT\t18";
const ROUNDS = [{ id: "r1", code: "R1", club_day: "2026-03-01", position: 1 }, { id: "r2", code: "R2", club_day: "2026-03-08", position: 2 }];
const CANDIDATE = { place: 6, bonus_keys: ["bingo"], marks: [], label: "Platz 6 + Bingo" };

function preview({ decided = false } = {}) {
  return {
    columns: [
      { index: 0, label: "R1", how: "code", round: ROUNDS[0], state: "new", target: "sheet", expected_version: 0, sheet: null, unclear: 0,
        counts: { rows: 2, places: 2 }, changes: [], errors: [], warnings: [],
        cells: [{ row: 0, text: "25", state: "ok", code: "place", place: 1 }, { row: 1, text: "18", state: "ok", code: "place", place: 2 }] },
      { index: 1, label: "R2", how: "code", round: ROUNDS[1], state: decided ? "changed" : "unclear", target: "draft", expected_version: 2,
        sheet: { status: "draft", version: 2 }, unclear: decided ? 0 : 1, counts: { rows: 2, places: decided ? 1 : 0 }, errors: [], warnings: [],
        changes: [{ participant_id: "p-b", name: "Bruno Beispiel", kind: "changed", fields: { place: [3, null], marks: [[], ["dnf"]] } }],
        cells: [decided ? { row: 0, text: "21", state: "ok", code: "decided", place: 6 } : { row: 0, text: "21", state: "unclear", code: "bonus", candidates: [CANDIDATE] },
          { row: 1, text: "OUT", state: "ok", code: "mark" }] },
    ],
    rounds: ROUNDS,
    totals: [
      { row: 0, name: "Ada Ausgedacht", is_new: true, table_total: 46, cell_sum: 46, computed: 46, table_rank: 1, rank: 1, rank_differs: false, state: "ok", deviation: 0, reasons: [], explains: [] },
      { row: 1, name: "Bruno Beispiel", is_new: true, table_total: 20, cell_sum: 18, computed: 18, table_rank: 2, rank: 2, rank_differs: false, state: "differs", deviation: -2, reasons: [], explains: [] },
    ],
    totals_error: null,
    unknown_names: [{ participant_id: "neu:ada", name: "Ada Ausgedacht" }, { participant_id: "neu:bruno", name: "Bruno Beispiel" }],
    summary: { rows: 2, columns: 2, mapped: 2, unclear: decided ? 0 : 1, errors: 0 },
    selectable: decided ? [0, 1] : [0],
  };
}

beforeEach(() => {
  for (const fn of [apiMock.get, apiMock.put, apiMock.post, toastMock.success, toastMock.error]) fn.mockReset();
  apiMock.get.mockImplementation((url) => (url.endsWith("/unknown-names") ? Promise.resolve({ data: { items: [], profiles: [] } }) : Promise.reject(new Error(url))));
});

const series = { id: "serie-1", rules: { points_mode: "scheme" }, lineage: { title: "Probe Rennliga" } };

async function paste() {
  render(<SeasonTableSection series={series} onChanged={vi.fn()} />);
  fireEvent.click(screen.getByTestId("season-table-toggle"));
  fireEvent.change(screen.getByTestId("season-table-text"), { target: { value: TEXT } });
  fireEvent.click(screen.getByTestId("season-table-read"));
  return screen.findAllByTestId("season-table-column");
}

test("Einfügen schickt die Tabelle an die Vorschau: Runden mit Termin, gelbe Zellen, Abgleich und neue Namen", async () => {
  apiMock.post.mockResolvedValue({ data: preview() });
  const rows = await paste();
  expect(apiMock.post).toHaveBeenCalledWith(`${URL}/preview`, {
    columns: [{ label: "R1" }, { label: "R2" }], team_column: true, points: "scheme", decisions: [],
    rows: [{ name: "Ada Ausgedacht", team: "Probe Rot", cells: ["25", "21"], total: 46, rank: 1 },
      { name: "Bruno Beispiel", team: "Probe Blau", cells: ["18", "OUT"], total: 18, rank: 2 }],
  }, { skipInvalidation: true });
  expect(screen.getByTestId("season-table-kinds")).toHaveTextContent("Platz „Pos“ · Fahrer „Fahrer“ · Team „Team“ · Gesamt „Gesamt“ · 2 Runden");
  expect(within(rows[0]).getByTestId("season-table-pick")).toBeChecked();
  expect(rows[0]).toHaveTextContent("Ergebnis als Entwurf · über das Kürzel");
  expect(within(rows[0]).getByTestId("season-table-round")).toHaveValue("r1");
  expect(within(rows[1]).queryByTestId("season-table-pick")).toBeNull();
  expect(rows[1]).toHaveTextContent("Zum Klären");
  expect(rows[1]).toHaveTextContent("1 gelb");
  const unclear = screen.getByTestId("season-table-unclear");
  expect(unclear).toHaveTextContent("1 Zelle zum Klären");
  expect(within(unclear).getByTestId("season-table-cell")).toHaveTextContent("R2 · Ada Ausgedacht · 21 Punkte");
  expect(within(unclear).getByTestId("season-table-cell")).toHaveTextContent("Bonus im Wert");
  // Abgleich: nur Auffällige – Bruno weicht ab.
  expect(screen.getByTestId("season-table-totals-summary")).toHaveTextContent("1 stimmen · 1 weicht ab");
  expect(screen.getAllByTestId("season-table-total")).toHaveLength(1);
  expect(screen.getByTestId("season-table-total")).toHaveTextContent("weicht −2 ab");
  expect(screen.getByTestId("season-table-unknown")).toHaveTextContent("2 Namen sind neu");
  expect(screen.getByTestId("season-table-apply")).toHaveTextContent("Übernehmen (1)");
});

test("eine gelbe Zelle klären und einen Termin selbst wählen schickt eine neue Vorschau", async () => {
  apiMock.post.mockResolvedValueOnce({ data: preview() }).mockResolvedValue({ data: preview({ decided: true }) });
  const rows = await paste();
  fireEvent.change(within(screen.getByTestId("season-table-unclear")).getByTestId("season-table-decide"), { target: { value: "c0" } });
  await waitFor(() => expect(apiMock.post).toHaveBeenLastCalledWith(`${URL}/preview`, expect.objectContaining({
    decisions: [{ column: 1, row: 0, choice: "place", place: 6, bonus_keys: ["bingo"], marks: [] }] }), { skipInvalidation: true }));
  expect(await screen.findByText("Alle gelben Zellen sind geklärt")).toBeInTheDocument();
  expect(within(screen.getByTestId("season-table-cell")).getByTestId("season-table-decide")).toHaveValue("c0");
  fireEvent.change(within(rows[0]).getByTestId("season-table-round"), { target: { value: "__skip" } });
  await waitFor(() => expect(apiMock.post).toHaveBeenLastCalledWith(`${URL}/preview`, expect.objectContaining({
    columns: [{ label: "R1", round_id: "" }, { label: "R2" }] }), { skipInvalidation: true }));
});

test("Übernehmen schickt die gewählten Runden mit Version, meldet das Ergebnis und öffnet „Unbekannte Namen“", async () => {
  const onChanged = vi.fn();
  apiMock.post.mockImplementation((url) => (url.endsWith("/apply")
    ? Promise.resolve({ data: { items: [{ column: 0, status: "saved" }, { column: 1, status: "saved" }], created_participants: [{ id: "p1", name: "Ada Ausgedacht" }], open_unknown: true } })
    : Promise.resolve({ data: preview({ decided: true }) })));
  render(<SeasonTableSection series={series} onChanged={onChanged} />);
  fireEvent.click(screen.getByTestId("season-table-toggle"));
  fireEvent.change(screen.getByTestId("season-table-text"), { target: { value: TEXT } });
  fireEvent.click(screen.getByTestId("season-table-read"));
  const rows = await screen.findAllByTestId("season-table-column");
  // Ein vorhandener Entwurf (Abweichungen) ist nicht vorgewählt – der Vorstand hakt ihn selbst an.
  expect(within(rows[1]).getByTestId("season-table-pick")).not.toBeChecked();
  expect(within(rows[1]).getByTestId("season-table-changes")).toHaveTextContent("Bruno Beispiel");
  fireEvent.click(within(rows[1]).getByTestId("season-table-pick"));
  fireEvent.click(screen.getByTestId("season-table-apply"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(`${URL}/apply`, expect.objectContaining({
    items: [{ column: 0, round_id: "r1", expected_version: 0 }, { column: 1, round_id: "r2", expected_version: 2 }] })));
  expect(toastMock.success).toHaveBeenCalledWith("2 Runden als Entwurf übernommen.");
  expect(onChanged).toHaveBeenCalled();
  expect(await screen.findByTestId("unknown-names")).toBeInTheDocument();
});

test("„Punkte laut Veranstalter“ geht als Wahl mit; eine Saison laut Veranstalter sperrt die Wahl", async () => {
  apiMock.post.mockResolvedValue({ data: preview() });
  render(<SeasonTableSection series={series} />);
  fireEvent.click(screen.getByTestId("season-table-toggle"));
  fireEvent.click(screen.getByTestId("season-table-points-organizer"));
  fireEvent.change(screen.getByTestId("season-table-text"), { target: { value: TEXT } });
  fireEvent.click(screen.getByTestId("season-table-read"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(`${URL}/preview`, expect.objectContaining({ points: "organizer" }), { skipInvalidation: true }));
});

test("ein Fehler der Vorschau steht im Abschnitt", async () => {
  apiMock.post.mockRejectedValue({ response: { status: 409, data: { detail: "Eine Saisontabelle mit Punkten je Runde gibt es für Fahrer- und Spielerwertungen." } } });
  await paste().catch(() => {});
  expect(await screen.findByTestId("season-table-error")).toHaveTextContent("Fahrer- und Spielerwertungen");
});
