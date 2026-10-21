import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Rennwochenende in der Verwaltung (#1930): „Läufe je Runde“ in der Saison (auch ab Runde X anders), der Kalender mit
// einem Kopf je Runde und ihren Läufen, Ergebnisse je Lauf über Chips, ein neuer Termin mit Lauf (Qualifying zählt nicht)
// und die Terminliste mit den Läufen je Zeile. Nur erfundene Orte.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => (typeof detail === "string" ? detail : "Fehler") }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("./ResultEntrySheet", () => ({ ResultEntrySheet: ({ round }) => <div data-testid="entry-sheet">{`${round.code} ${round.session}`}</div> }));

const { SeriesForm } = await import("./SeriesForm");
const { SeriesCalendarSection } = await import("./SeriesCalendarSection");
const { SeriesResultsSection } = await import("./SeriesResultsSection");

const LINEAGE = { id: "spur-1", title: "Probe Rennliga F2", kind: "racing" };
const SERIES = { id: "serie-1", season: "2026", default_weekday: 5, default_time: "20:00", lineage: LINEAGE };

const lauf = (id, code, session, weekend, extra = {}) => ({
  id, code, session, session_kind: session === "Qualifying" ? "qualifying" : session === "Sprint" ? "sprint" : "race", weekend,
  kind: "regular", counts: session !== "Qualifying", status: "planned", state: "planned", venue: "Probering", country_code: "AT", ...extra,
});

const ROUNDS = [
  lauf("q1", "R1", "Qualifying", 1, { club_day: "2026-03-07", time: "20:00", status: "scored", state: "scored" }),
  lauf("s1", "R1", "Sprint", 1, { club_day: "2026-03-07", time: "20:30", state: "missing" }),
  lauf("f1", "R1", "Rennen", 1, { club_day: "2026-03-08", time: "20:00" }),
  lauf("s2", "R2", "Sprint", 2, { club_day: "2026-03-14", time: "20:00", status: "cancelled", state: "cancelled" }),
  lauf("f2", "R2", "Rennen", 2, { club_day: "2026-03-14", time: "20:45" }),
];
const CALENDAR = { today: "2026-03-09", version: 3, rounds: ROUNDS, archived: [], counts: {}, hints: [] };

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
  apiMock.get.mockResolvedValue({ data: CALENDAR });
  apiMock.post.mockResolvedValue({ data: {} });
  apiMock.patch.mockResolvedValue({ data: {} });
});

test("Saison: Läufe je Runde festlegen, Sprint mit eigenem Schema, ab Runde 5 anders", async () => {
  render(<SeriesForm series={{ id: "serie-1", season: "2026", status: "active", rules: {} }} lineage={LINEAGE} onClose={() => {}} onSaved={() => {}} />);
  fireEvent.click(screen.getByTestId("weekend-add"));
  const format = screen.getByTestId("weekend-format");
  expect(within(format).getAllByTestId("weekend-session-label").map((input) => input.value)).toEqual(["Qualifying", "Rennen"]);
  fireEvent.click(within(format).getByTestId("weekend-session-add"));
  const sessions = within(format).getAllByTestId("weekend-session");
  fireEvent.change(within(sessions[2]).getByTestId("weekend-session-points-mode"), { target: { value: "own" } });
  fireEvent.change(within(sessions[2]).getByTestId("weekend-session-points"), { target: { value: "12-9-7-6-5-4-3-2-1" } });
  fireEvent.change(within(sessions[2]).getByTestId("weekend-session-offset"), { target: { value: "60" } });

  fireEvent.click(screen.getByTestId("weekend-phase-add"));
  const second = screen.getAllByTestId("weekend-format")[1];
  fireEvent.change(within(second).getByTestId("weekend-format-from"), { target: { value: "5" } });
  // Ab Runde 5 ohne Qualifying - der Startplatz kommt aus der umgekehrten WM-Reihenfolge.
  fireEvent.click(within(second).getAllByTestId("weekend-session-remove")[0]);
  for (const select of within(second).getAllByTestId("weekend-session-grid")) fireEvent.change(select, { target: { value: "reverse_standings" } });

  fireEvent.click(screen.getByTestId("series-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
  expect(apiMock.patch.mock.calls[0][1].weekend).toEqual({ formats: [
    { from_round: 1, sessions: [
      { label: "Qualifying", offset: 0, counts: false, points: "none", grid: "manual" },
      { label: "Rennen", offset: 30, counts: true, points: "series", grid: "qualifying" },
      { label: "Sprint", offset: 60, counts: true, points: [12, 9, 7, 6, 5, 4, 3, 2, 1], grid: "manual" },
    ] },
    { from_round: 5, sessions: [
      { label: "Rennen", offset: 30, counts: true, points: "series", grid: "reverse_standings" },
      { label: "Sprint", offset: 60, counts: true, points: [12, 9, 7, 6, 5, 4, 3, 2, 1], grid: "reverse_standings" },
    ] },
  ] });
});

test("Saison ohne Läufe schickt keine Vorgabe", async () => {
  render(<SeriesForm series={{ id: "serie-1", season: "2026", rules: {} }} lineage={LINEAGE} onClose={() => {}} onSaved={() => {}} />);
  fireEvent.click(screen.getByTestId("series-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
  expect(apiMock.patch.mock.calls[0][1].weekend).toBeNull();
});

test("Kalender: je Runde ein Kopf, darunter die Läufe mit eigenem Status und eigenen Knöpfen", async () => {
  render(<SeriesCalendarSection series={SERIES} />);
  const weekends = await screen.findAllByTestId("calendar-weekend");
  expect(weekends.map((item) => item.dataset.state)).toEqual(["missing", "planned"]);
  expect(weekends[0]).toHaveTextContent("Sa., 07.03.2026");
  expect(within(weekends[0]).getAllByTestId("calendar-session").map((item) => item.textContent)).toEqual(["Qualifying", "Sprint", "Rennen"]);
  const sessions = within(weekends[0]).getAllByTestId("calendar-round");
  // Ein anderer Tag steht beim Lauf, sonst nur die Uhrzeit.
  expect(sessions[2]).toHaveTextContent("So., 08.03.2026 · 20:00");
  expect(sessions[0]).toHaveTextContent("zählt nicht zur Wertung");
  fireEvent.click(within(sessions[1]).getByTestId("round-cancel"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/rounds/s1/cancel", { expected_version: 3 }));
  expect(within(within(weekends[1]).getAllByTestId("calendar-round")[0]).getByTestId("round-reinstate")).toBeInTheDocument();
});

test("Ergebnisse: je Runde eine Zeile, jeder Lauf ein Chip, der sein Blatt öffnet", async () => {
  render(<SeriesResultsSection series={SERIES} />);
  const weekends = await screen.findAllByTestId("results-weekend");
  expect(weekends).toHaveLength(2);
  const chips = within(weekends[0]).getAllByTestId("session-chip");
  expect(chips.map((chip) => chip.dataset.state)).toEqual(["scored", "missing", "planned"]);
  expect(chips[1]).toHaveAttribute("title", "Sprint, Sa., 07.03.2026 · 20:30, Ergebnis fehlt");
  // Ein abgesagter Lauf bekommt kein Ergebnis.
  expect(within(weekends[1]).getAllByTestId("session-chip")).toHaveLength(1);
  fireEvent.click(chips[1]);
  expect(screen.getByTestId("entry-sheet")).toHaveTextContent("R1 Sprint");
});

test("neuer Termin mit Lauf: ein Qualifying zählt von selbst nicht", async () => {
  render(<SeriesCalendarSection series={SERIES} />);
  await screen.findAllByTestId("calendar-weekend");
  fireEvent.click(screen.getByTestId("calendar-new"));
  fireEvent.change(screen.getByTestId("round-code"), { target: { value: "R3" } });
  fireEvent.change(screen.getByTestId("round-session"), { target: { value: "Qualifying" } });
  expect(screen.getByTestId("round-counts")).not.toBeChecked();
  fireEvent.click(screen.getByTestId("round-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/rounds", expect.objectContaining({
    code: "R3", session: "Qualifying", counts: false,
  })));
});

test("Terminliste: die Vorschau zeigt je Zeile die Läufe, übernommen werden alle Termine", async () => {
  render(<SeriesCalendarSection series={SERIES} />);
  await screen.findAllByTestId("calendar-weekend");
  apiMock.post.mockResolvedValueOnce({ data: { errors: [], count: 3, rows: [{
    line: 1, code: "R3", venue: "Testkurs", day: "2026-03-21", time: "20:00", country_code: null,
    sessions: [
      { session: "Qualifying", day: "2026-03-21", time: "20:00", counts: false },
      { session: "Sprint", day: "2026-03-21", time: "20:30", counts: true },
      { session: "Rennen", day: "2026-03-22", time: "20:00", counts: true },
    ],
  }] } });
  fireEvent.click(screen.getByTestId("calendar-paste"));
  fireEvent.change(screen.getByTestId("paste-text"), { target: { value: "R3 · 21.03.2026 · Testkurs" } });
  fireEvent.click(screen.getByTestId("paste-submit"));
  const cell = await screen.findByTestId("paste-sessions");
  expect(cell).toHaveTextContent("Qualifying 20:00 · zählt nicht");
  expect(cell).toHaveTextContent("Rennen So., 22.03.2026 20:00");
  expect(screen.getByTestId("paste-submit")).toHaveTextContent("3 Termine übernehmen");
});
