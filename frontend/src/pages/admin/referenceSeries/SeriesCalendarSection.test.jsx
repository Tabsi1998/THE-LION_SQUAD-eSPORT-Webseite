import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Kalender der Saison (#1742): Liste mit Status vom Server, Hinweis auf Lücken, Termin anlegen mit Vorgaben der Saison,
// Liste einfügen mit Vorschau vom Server, Absagen, Verschieben und Reihenfolge. Nur erfundene Orte.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => (typeof detail === "string" ? detail : "Fehler") }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { SeriesCalendarSection } = await import("./SeriesCalendarSection");

const SERIES = {
  id: "serie-1", season: "2026", default_weekday: 3, default_time: "20:30",
  lineage: { id: "spur-1", title: "Probe Racing F1", kind: "racing" },
};
const ROUNDS = [
  { id: "r1", position: 1, code: "R1", club_day: "2026-10-22", time: "20:30", venue: "Probering", status: "planned", state: "missing", counts: true, kind: "regular" },
  { id: "r2", position: 2, code: "R2", club_day: "2026-10-29", time: "20:30", venue: "Teststadt", status: "scored", state: "scored", counts: true, kind: "regular" },
  { id: "r3", position: 3, code: "R3", club_day: "2026-11-07", time: "19:00", venue: "Beispielpark", status: "postponed", state: "postponed", original_club_day: "2026-11-05", counts: true, kind: "regular" },
  { id: "r4", position: 4, code: "R4", club_day: "2026-11-12", time: null, venue: null, status: "cancelled", state: "cancelled", counts: false, kind: "final" },
];
const CALENDAR = {
  today: "2026-11-05", version: 7, rounds: ROUNDS, archived: [{ id: "rx", code: "RX", club_day: "2026-12-01", time: null }],
  counts: { planned: 0, today: 0, missing: 1, cancelled: 1, postponed: 1, scored: 1 },
  hints: [{ round_id: "r1", text: "R1 hat kein Ergebnis, obwohl R2 schon gewertet ist – abgesagt?" }],
};

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
  apiMock.get.mockResolvedValue({ data: CALENDAR });
  apiMock.post.mockResolvedValue({ data: {} });
  apiMock.patch.mockResolvedValue({ data: {} });
});

async function renderSection(calendar = CALENDAR) {
  apiMock.get.mockResolvedValue({ data: calendar });
  render(<SeriesCalendarSection series={SERIES} onChanged={() => {}} />);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/calendar"));
}

test("Termine in Reihenfolge mit Status, Ursprungstag, Hinweis und Zählern", async () => {
  await renderSection();
  const items = await screen.findAllByTestId("calendar-round");
  expect(items.map((item) => item.dataset.state)).toEqual(["missing", "scored", "postponed", "cancelled"]);
  expect(within(items[0]).getByTestId("round-state")).toHaveTextContent("Ergebnis fehlt");
  expect(items[0]).toHaveTextContent("Do., 22.10.2026 · 20:30");
  expect(items[2]).toHaveTextContent("ursprünglich Do., 05.11.2026");
  expect(items[3]).toHaveTextContent("Finale");
  expect(items[3]).toHaveTextContent("zählt nicht zur Wertung");
  // Gewertet: weder verschieben noch absagen noch archivieren; abgesagt: wieder ansetzen.
  expect(within(items[1]).queryByTestId("round-cancel")).toBeNull();
  expect(within(items[1]).queryByTestId("round-archive")).toBeNull();
  expect(within(items[3]).getByTestId("round-reinstate")).toBeInTheDocument();
  expect(screen.getByTestId("calendar-hints")).toHaveTextContent("R1 hat kein Ergebnis");
  expect(screen.getByTestId("series-calendar-counts")).toHaveTextContent("4 Termine");
  expect(screen.getByTestId("series-calendar-counts")).toHaveTextContent("1 ergebnis fehlt");
  expect(screen.getByTestId("calendar-archived")).toHaveTextContent("Archiviert (1)");
});

test("ohne Termine ein klarer Hinweis", async () => {
  await renderSection({ today: "2026-11-05", rounds: [], archived: [], counts: {}, hints: [] });
  expect(await screen.findByTestId("calendar-empty")).toHaveTextContent("Noch keine Termine");
});

test("neuer Termin: Vorgabe nächster Standard-Wochentag und Standard-Uhrzeit", async () => {
  await renderSection();
  await screen.findAllByTestId("calendar-round");
  fireEvent.click(screen.getByTestId("calendar-new"));
  // Letzter Termin 12.11. (Donnerstag) - nächster Donnerstag ist der 19.11.
  expect(screen.getByTestId("round-day")).toHaveValue("2026-11-19");
  expect(screen.getByTestId("round-time")).toHaveValue("20:30");
  fireEvent.change(screen.getByTestId("round-code"), { target: { value: "R5" } });
  fireEvent.change(screen.getByTestId("round-venue"), { target: { value: "Musterkurs" } });
  fireEvent.click(screen.getByTestId("round-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/rounds", {
    code: "R5", session: null, title: null, venue: "Musterkurs", day: "2026-11-19", time: "20:30", kind: "regular", counts: true, opponent: null, note: null,
    country_auto: true, expected_version: 7,
  }));
});

test("Flagge (#1925): Liste und Vorschau zeigen das Land, im Termin automatisch, ohne oder von Hand gewählt", async () => {
  const rounds = ROUNDS.map((round) => (round.id === "r1" ? { ...round, venue: "Monza", country_code: "IT", country_auto: true } : round));
  await renderSection({ ...CALENDAR, rounds });
  const items = await screen.findAllByTestId("calendar-round");
  expect(within(items[0]).getByRole("img", { name: "Italien" })).toHaveAttribute("src", "/assets/flags/it.svg");
  expect(within(items[1]).queryByRole("img")).toBeNull();

  fireEvent.click(within(items[0]).getByTestId("round-edit"));
  expect(screen.getByTestId("round-country")).toHaveValue("auto");
  expect(screen.getByTestId("round-country-detected")).toHaveTextContent("Erkannt: Italien");
  fireEvent.change(screen.getByTestId("round-country"), { target: { value: "FR" } });
  fireEvent.click(screen.getByTestId("round-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/rounds/r1",
    expect.objectContaining({ country_auto: false, country_code: "FR" })));

  fireEvent.click(screen.getByTestId("calendar-paste"));
  fireEvent.change(screen.getByTestId("paste-text"), { target: { value: "R5 · 18.06.2026 · Aserbaidschan" } });
  apiMock.post.mockResolvedValueOnce({ data: { errors: [], rows: [
    { line: 1, code: "R5", day: "2026-06-18", time: "20:30", venue: "Aserbaidschan", country_code: "AZ", derived_day: false, warning: null },
  ] } });
  fireEvent.click(screen.getByTestId("paste-submit"));
  const venue = await screen.findByTestId("paste-venue");
  expect(within(venue).getByRole("img", { name: "Aserbaidschan" })).toBeTruthy();
});

test("Liste einfügen: erst die Vorschau vom Server, dann übernehmen", async () => {
  await renderSection();
  await screen.findAllByTestId("calendar-round");
  fireEvent.click(screen.getByTestId("calendar-paste"));
  const text = "R5 · 19.11. · Musterkurs\nR6 Nordring";
  fireEvent.change(screen.getByTestId("paste-text"), { target: { value: text } });
  apiMock.post.mockResolvedValueOnce({ data: { errors: [], rows: [
    { line: 1, code: "R5", day: "2026-11-19", time: "20:30", venue: "Musterkurs", derived_day: false, warning: null },
    { line: 2, code: "R6", day: "2026-11-26", time: "20:30", venue: "Nordring", derived_day: true, warning: null },
  ] } });
  fireEvent.click(screen.getByTestId("paste-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/rounds/paste", { text }));
  const preview = await screen.findByTestId("paste-preview");
  expect(preview).toHaveTextContent("Do., 26.11.2026");
  expect(preview).toHaveTextContent("aus dem Wochentag");
  expect(screen.getByTestId("paste-submit")).toHaveTextContent("2 Termine übernehmen");
  apiMock.post.mockResolvedValueOnce({ data: { created: 2, ...CALENDAR } });
  fireEvent.click(screen.getByTestId("paste-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/rounds/paste", { text, apply: true, expected_version: 7 }));
});

test("Liste einfügen: Fehler je Zeile, übernommen wird nichts", async () => {
  await renderSection();
  await screen.findAllByTestId("calendar-round");
  fireEvent.click(screen.getByTestId("calendar-paste"));
  fireEvent.change(screen.getByTestId("paste-text"), { target: { value: "R5 31.11. Nord" } });
  apiMock.post.mockResolvedValueOnce({ data: { rows: [], errors: [{ line: 1, text: "R5 31.11. Nord", message: "Datum 31.11. gibt es nicht." }] } });
  fireEvent.click(screen.getByTestId("paste-submit"));
  expect(await screen.findByTestId("paste-errors")).toHaveTextContent("Zeile 1: Datum 31.11. gibt es nicht.");
  expect(screen.getByTestId("paste-submit")).toHaveTextContent("Vorschau");
});

test("Absagen, Verschieben und Reihenfolge rufen den Server", async () => {
  await renderSection();
  const items = await screen.findAllByTestId("calendar-round");
  fireEvent.click(within(items[0]).getByTestId("round-cancel"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/rounds/r1/cancel", { expected_version: 7 }));

  fireEvent.click(within(items[2]).getByTestId("round-postpone"));
  expect(screen.getByTestId("postpone-original")).toHaveTextContent("Do., 05.11.2026");
  fireEvent.change(screen.getByTestId("postpone-day"), { target: { value: "2026-11-14" } });
  fireEvent.click(screen.getByTestId("postpone-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/rounds/r3/postpone", { day: "2026-11-14", time: "19:00", note: null, expected_version: 7 }));

  fireEvent.click(screen.getByRole("button", { name: "R2 nach oben" }));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/rounds/order", { ids: ["r2", "r1", "r3", "r4"], expected_version: 7 }));
  expect(screen.getByRole("button", { name: "R1 nach oben" })).toBeDisabled();
});

test("hat jemand anderes inzwischen geändert (409), lädt der Kalender neu", async () => {
  await renderSection();
  await screen.findAllByTestId("calendar-round");
  expect(apiMock.get).toHaveBeenCalledTimes(1);
  apiMock.post.mockRejectedValueOnce({ response: { status: 409, data: { detail: "Der Kalender wurde inzwischen geändert – bitte neu laden." } } });
  fireEvent.click(screen.getByTestId("calendar-sort"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/rounds/sort-by-date", { expected_version: 7 }));
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(2));
});

test("Bearbeiten, Archivieren und Wiederansetzen senden den Stand; 409 beim Verschieben lädt neu", async () => {
  await renderSection();
  const items = await screen.findAllByTestId("calendar-round");
  fireEvent.click(within(items[0]).getByTestId("round-edit"));
  fireEvent.click(screen.getByTestId("round-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/rounds/r1", expect.objectContaining({ code: "R1", expected_version: 7 })));
  fireEvent.click(within(items[0]).getByTestId("round-archive"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/rounds/r1/archive", { expected_version: 7 }));
  fireEvent.click(within(items[3]).getByTestId("round-reinstate"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/rounds/r4/reinstate", { expected_version: 7 }));

  const loads = apiMock.get.mock.calls.length;
  apiMock.post.mockRejectedValueOnce({ response: { status: 409, data: { detail: "Der Kalender wurde inzwischen geändert – bitte neu laden." } } });
  fireEvent.click(within(items[2]).getByTestId("round-postpone"));
  fireEvent.click(screen.getByTestId("postpone-save"));
  await waitFor(() => expect(apiMock.get.mock.calls.length).toBeGreaterThan(loads));
  expect(screen.getByTestId("postpone-sheet")).toBeInTheDocument();
});

test("ein Captain sieht den Kalender seiner Saison nur zum Lesen", async () => {
  apiMock.get.mockResolvedValue({ data: CALENDAR });
  render(<SeriesCalendarSection series={{ ...SERIES, access: { role: "captain", can_publish: false } }} onChanged={() => {}} />);
  const items = await screen.findAllByTestId("calendar-round");
  expect(items).toHaveLength(4);
  expect(within(items[0]).getByTestId("round-state")).toHaveTextContent("Ergebnis fehlt");
  expect(screen.getByTestId("calendar-hints")).toBeInTheDocument();
  for (const id of ["calendar-new", "calendar-paste", "calendar-sort", "round-edit", "round-cancel", "round-postpone", "round-archive", "calendar-archived"]) {
    expect(screen.queryByTestId(id)).toBeNull();
  }
  expect(screen.queryByRole("button", { name: /nach oben/ })).toBeNull();
});
