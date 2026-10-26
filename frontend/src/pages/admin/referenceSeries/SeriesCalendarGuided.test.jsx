import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Geführter Termin-Ablauf (#2024): Schritte im leeren Kalender, Zähler „N von M“ auch bei 0, Zustand „ohne Datum“ mit
// Filter, „Datum nachtragen“ für alle offenen Termine auf einmal (Vorschlag aus dem Standard-Wochentag), die Terminliste
// und das Termin-Blatt einer Turnierserie ohne Ort und Flagge. Nur erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => (typeof detail === "string" ? detail : "Fehler") }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { SeriesCalendarSection } = await import("./SeriesCalendarSection");
const { RACING_PROFILE, SERIES_PROFILE } = await import("@/lib/seriesKinds.fixture");

const SERIES = {
  id: "serie-1", season: "2026/27", default_weekday: 3, default_time: "19:00", planned_rounds: 9,
  lineage: { id: "spur-1", title: "Probe TFT Masters", kind: "series" }, profile: SERIES_PROFILE,
};
const dated = (number, day) => ({ id: `t${number}`, position: number, code: `T${number}`, club_day: day, time: "19:00", status: "scored", state: "scored", counts: true, kind: "regular" });
const open = (number) => ({ id: `t${number}`, position: number, code: `T${number}`, club_day: null, time: "19:00", status: "planned", state: "planned", counts: true, kind: "regular" });
const EMPTY = { today: "2026-11-05", version: 1, archived: [], hints: [], rounds: [], counts: {}, planned: { planned: 9, count: 0, missing: 9 } };
const MIXED = {
  ...EMPTY, version: 4, rounds: [dated(1, "2026-10-01"), dated(2, "2026-10-22"), open(3), open(4)],
  counts: { scored: 2, planned: 2 }, planned: { planned: 4, count: 4, missing: 0 },
};

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
  apiMock.post.mockResolvedValue({ data: {} });
});

async function renderSection(calendar, series = SERIES) {
  apiMock.get.mockResolvedValue({ data: calendar });
  render(<SeriesCalendarSection series={series} />);
  await screen.findByTestId("series-calendar-counts");
}

test("leerer Kalender mit geplanter Zahl: „0 von 9“ und die nächsten Schritte", async () => {
  await renderSection(EMPTY);
  expect(screen.getByTestId("series-calendar-planned")).toHaveTextContent("0 von 9 Turniertagen angelegt");
  const steps = screen.getByTestId("calendar-steps");
  expect(within(steps).getAllByRole("listitem").map((item) => item.dataset.done)).toEqual(["true", "false", "false"]);
  expect(steps).toHaveTextContent("Fehlende Termine anlegen");
  expect(steps).toHaveTextContent("Datum nachtragen");
  expect(screen.getByTestId("calendar-fill-planned")).toHaveTextContent("(9)");
});

test("leerer Kalender ohne geplante Zahl: erster Schritt ist die Anzahl in der Saison", async () => {
  apiMock.get.mockResolvedValue({ data: { ...EMPTY, planned: null } });
  render(<SeriesCalendarSection series={{ ...SERIES, planned_rounds: null }} />);
  const steps = await screen.findByTestId("calendar-steps");
  expect(screen.queryByTestId("series-calendar-counts")).toBeNull();
  expect(within(steps).getAllByRole("listitem")[0]).toHaveTextContent("Anzahl der Turniertage");
  expect(within(steps).getAllByRole("listitem")[0].dataset.done).toBe("false");
});

test("Termine ohne Datum: Abzeichen, Zähler und Filter", async () => {
  await renderSection(MIXED);
  const items = screen.getAllByTestId("calendar-round");
  expect(items.map((item) => Boolean(within(item).queryByTestId("round-undated")))).toEqual([false, false, true, true]);
  expect(screen.getByTestId("series-calendar-counts")).toHaveTextContent("2 ohne Datum");
  fireEvent.click(screen.getByTestId("calendar-filter-undated"));
  expect(screen.getAllByTestId("calendar-round").map((item) => item.textContent.slice(0, 2))).toEqual(["T3", "T4"]);
  expect(screen.getByTestId("calendar-filter-undated")).toHaveAttribute("aria-pressed", "true");
});

test("Datum nachtragen: alle offenen auf einmal, Vorschlag aus dem Standard-Wochentag", async () => {
  apiMock.post.mockResolvedValue({ data: { ...MIXED, version: 5, rounds: [dated(1, "2026-10-01"), dated(2, "2026-10-22"), { ...open(3), club_day: "2026-10-29" }, open(4)] } });
  await renderSection(MIXED);
  fireEvent.click(screen.getByTestId("calendar-dates"));
  const sheet = await screen.findByTestId("dates-sheet");
  const rows = within(sheet).getAllByTestId("dates-row");
  expect(rows).toHaveLength(2);
  fireEvent.click(within(sheet).getByTestId("dates-suggest-all"));
  // Donnerstag nach dem letzten Termin (22.10.), dann eine Woche später.
  expect(within(rows[0]).getByTestId("dates-day")).toHaveValue("2026-10-29");
  expect(within(rows[1]).getByTestId("dates-day")).toHaveValue("2026-11-05");
  fireEvent.change(within(rows[1]).getByTestId("dates-day"), { target: { value: "" } });
  fireEvent.change(within(rows[0]).getByTestId("dates-time"), { target: { value: "20:30" } });
  fireEvent.click(within(sheet).getByTestId("dates-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/rounds/dates", {
    expected_version: 4, items: [{ id: "t3", day: "2026-10-29", time: "20:30" }],
  }));
});

test("Grenzfall: 30 Turniertage ohne Datum und ohne einen mit Datum - Vorschläge ab heute, je eine Woche", async () => {
  const { suggestDays } = await import("./CalendarGuide");
  const rounds = Array.from({ length: 30 }, (_, index) => open(index + 1));
  const days = suggestDays(rounds, rounds, 3, "2026-11-05");
  expect(Object.keys(days)).toHaveLength(30);
  expect([days.t1, days.t2, days.t30]).toEqual(["2026-11-05", "2026-11-12", "2027-05-27"]);
  // Ohne Wochentag eine Woche nach dem letzten, der erste heute.
  expect(Object.values(suggestDays(rounds.slice(0, 2), rounds.slice(0, 2), null, "2026-11-05"))).toEqual(["2026-11-05", "2026-11-12"]);
});

test("Terminliste einer Turnierserie: Beispiel ohne Ort, Zeile ohne Datum heißt offen", async () => {
  await renderSection(MIXED);
  fireEvent.click(screen.getByTestId("calendar-paste"));
  const text = screen.getByTestId("paste-text");
  expect(text).toHaveAttribute("placeholder", expect.stringContaining("T1 · offen"));
  const sheet = screen.getByTestId("paste-sheet");
  expect(sheet).toHaveTextContent("ohne Datum");
  expect(sheet).not.toHaveTextContent("Flagge");
});

test("Termin einer Turnierserie: kein Ort, keine Flagge; die Rennliga behält beides", async () => {
  await renderSection(MIXED);
  fireEvent.click(screen.getByTestId("calendar-new"));
  expect(screen.queryByTestId("round-venue")).toBeNull();
  expect(screen.queryByTestId("round-country")).toBeNull();
  expect(screen.getByTestId("round-code")).toHaveAttribute("placeholder", "T1");
});

test("Rennliga: Ort und Flagge im Termin-Blatt wie bisher", async () => {
  const racing = { ...SERIES, lineage: { ...SERIES.lineage, kind: "racing" }, profile: RACING_PROFILE };
  await renderSection(MIXED, racing);
  fireEvent.click(screen.getByTestId("calendar-new"));
  expect(screen.getByTestId("round-venue")).toBeInTheDocument();
  expect(screen.getByTestId("round-country")).toBeInTheDocument();
});
