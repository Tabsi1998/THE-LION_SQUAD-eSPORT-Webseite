import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Termine ohne Datum und geplante Termine (#2015): offene Termine im Kalender, „fehlende Termine anlegen“ bis zur
// geplanten Zahl, die Vorschau der Terminliste mit „offen“ und die Hilfe dazu. Nur erfundene Orte.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => (typeof detail === "string" ? detail : "Fehler") }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { SeriesCalendarSection } = await import("./SeriesCalendarSection");

const SERIES = {
  id: "serie-1", season: "2026/27", default_weekday: 3, default_time: "19:00", planned_rounds: 9,
  lineage: { id: "spur-1", title: "Probe TFT Masters", kind: "series" },
};
const dated = (number, day) => ({ id: `t${number}`, position: number, code: `T${number}`, club_day: day, time: "19:00", status: "scored", state: "scored", counts: true, kind: "regular" });
const open = (number) => ({ id: `t${number}`, position: number, code: `T${number}`, club_day: null, time: "19:00", status: "planned", state: "planned", counts: true, kind: "regular" });
const CALENDAR = {
  today: "2026-11-05", version: 4, archived: [], hints: [],
  rounds: [dated(1, "2026-10-01"), dated(2, "2026-10-08"), dated(3, "2026-10-15"), dated(4, "2026-10-22")],
  counts: { scored: 4 }, planned: { planned: 9, count: 4, missing: 5 },
};

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
  apiMock.get.mockResolvedValue({ data: CALENDAR });
  apiMock.post.mockResolvedValue({ data: {} });
});

async function renderSection(calendar = CALENDAR) {
  apiMock.get.mockResolvedValue({ data: calendar });
  render(<SeriesCalendarSection series={SERIES} />);
  await screen.findAllByTestId("calendar-round");
}

test("fehlende Termine anlegen: legt bis zur geplanten Zahl offene Termine an", async () => {
  const filled = { ...CALENDAR, version: 5, rounds: [...CALENDAR.rounds, ...[5, 6, 7, 8, 9].map(open)], planned: { planned: 9, count: 9, missing: 0 } };
  apiMock.post.mockResolvedValue({ data: { created: 5, codes: ["T5", "T6", "T7", "T8", "T9"], ...filled } });
  await renderSection();
  expect(screen.getByTestId("series-calendar-planned")).toHaveTextContent("4 von 9 vorgesehenen angelegt");
  fireEvent.click(screen.getByTestId("calendar-fill-planned"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/rounds/fill-planned", { apply: true, expected_version: 4 }));
  const items = await screen.findAllByTestId("calendar-round");
  expect(items).toHaveLength(9);
  expect(items[4]).toHaveTextContent("Termin offen · 19:00");
  // Alles angelegt: der Knopf verschwindet.
  expect(screen.queryByTestId("calendar-fill-planned")).toBeNull();
});

test("ohne geplante Zahl oder ohne Lücke kein Knopf", async () => {
  await renderSection({ ...CALENDAR, planned: null });
  expect(screen.queryByTestId("calendar-fill-planned")).toBeNull();
  expect(screen.queryByTestId("series-calendar-planned")).toBeNull();
});

test("Terminliste: die Hilfe nennt „offen“, die Vorschau zeigt „Termin offen“", async () => {
  await renderSection();
  fireEvent.click(screen.getByTestId("calendar-paste"));
  const sheet = screen.getByTestId("paste-sheet");
  expect(sheet).toHaveTextContent("„offen“, „?“ oder „tbd“ statt des Datums");
  apiMock.post.mockResolvedValue({ data: { errors: [], count: 2, rows: [
    { line: 1, code: "T5", day: null, open: true, time: "19:00", venue: null, sessions: [] },
    { line: 2, code: "T6", day: "2026-11-12", open: false, time: "19:00", venue: "Halle Nord", sessions: [] },
  ] } });
  fireEvent.change(screen.getByTestId("paste-text"), { target: { value: "T5 · offen\nT6 · 12.11. · Halle Nord" } });
  fireEvent.click(screen.getByTestId("paste-submit"));
  const preview = await screen.findByTestId("paste-preview");
  expect(within(preview).getByTestId("paste-open")).toHaveTextContent("Termin offen");
  expect(preview).toHaveTextContent("Do., 12.11.2026");
});
