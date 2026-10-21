import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Ergebnisblatt eines Qualifyings (#1930): Zeit statt Punkte in der Zeile, keine schnellste Runde und kein Fahrer des
// Tages, das Quali-Layout mit Time und Gap lässt sich einfügen („--:--.---“ heißt ohne Zeit). Nur erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => (typeof detail === "string" ? detail : "Fehler") }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ResultEntrySheet } = await import("./ResultEntrySheet");

const SERIES = { id: "serie-1", lineage: { title: "Probe Rennliga", kind: "racing" }, access: { role: "board", can_publish: true } };
const ROUND = { id: "q1", code: "R1", session: "Qualifying", session_kind: "qualifying", counts: false, club_day: "2026-03-07", venue: "Probering" };

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
  apiMock.get.mockResolvedValue({ data: {
    round: ROUND, series: { id: "serie-1", kind: "racing", rules: { points_mode: "scheme", points_by_place: [] } },
    access: { role: "board", can_publish: true }, version: 0, sheet: null, target: "sheet", participants: [],
  } });
  apiMock.post.mockResolvedValue({ data: { version: 0, target: "sheet", can_save: true, errors: [], warnings: [], rows: [], unknown_names: [], standings: null, final: null, latest: null } });
});

test("Qualifying: Zeit statt Punkte, keine Rennzusätze, Quali-Liste mit Time und Gap einfügen", async () => {
  render(<ResultEntrySheet series={SERIES} round={ROUND} onClose={() => {}} onSaved={() => {}} />);
  const sheet = await screen.findByTestId("result-sheet");
  expect(within(sheet).getByTestId("result-mode")).toHaveTextContent("Qualifying · ohne Punkte · Pole von selbst");
  expect(within(sheet).queryByTestId("result-race")).toBeNull();
  expect(within(sheet).queryByTestId("result-row-points")).toBeNull();

  fireEvent.click(within(sheet).getByTestId("result-paste-toggle"));
  fireEvent.change(screen.getByTestId("result-paste-text"), { target: { value: [
    "Pos\tNr\tName\tTeam\tTime\tGap",
    "1\t7\tProbe Anna\tProbe Löwen\t1:21.004\t",
    "2\t12\tProbe Bert\tFremd Rot\t1:21.363\t+0.359",
    "3\t21\tProbe Carl\tFremd Blau\t--:--.---\t",
  ].join("\n") } });
  fireEvent.click(screen.getByTestId("result-paste-apply"));
  const times = await within(sheet).findAllByTestId("result-row-quali-time");
  expect(times.map((input) => input.value)).toEqual(["1:21.004", "1:21.363", ""]);
  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  const rows = apiMock.post.mock.calls.at(-1)[1].rows;
  expect(rows.map((row) => [row.place, row.name, row.start_number, row.time ?? null, row.gap ?? null])).toEqual([
    [1, "Probe Anna", "7", "1:21.004", null], [2, "Probe Bert", "12", "1:21.363", "+0.359"], [3, "Probe Carl", "21", null, null],
  ]);
});
