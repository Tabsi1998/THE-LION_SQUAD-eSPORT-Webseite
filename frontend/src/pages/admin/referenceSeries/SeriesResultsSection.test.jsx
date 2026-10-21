import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Ergebnisse eintragen (#1744): je Termin das Blatt mit dynamischer Liste, Einfügen, Vorschau des Servers, 409,
// Captain ohne Alias-Daten und Entwurf daneben. Nur erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => (typeof detail === "string" ? detail : "Fehler") }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { SeriesResultsSection } = await import("./SeriesResultsSection");

const BOARD = { id: "serie-1", lineage: { title: "Probe Racing F1", kind: "racing" }, access: { role: "board", can_publish: true } };
const CAPTAIN = { ...BOARD, access: { role: "captain", can_publish: false } };
const CALENDAR = {
  version: 3,
  rounds: [
    { id: "r1", code: "R1", club_day: "2026-10-15", time: "20:30", venue: "Probering", status: "planned", state: "missing" },
    { id: "r2", code: "R2", club_day: "2026-10-22", time: "20:30", venue: "Teststadt", status: "scored", state: "scored" },
    { id: "r3", code: "R3", club_day: "2026-10-29", time: null, venue: null, status: "cancelled", state: "cancelled" },
  ],
};
const PARTICIPANTS = [
  { id: "p1", name: "Alpha", start_number: "7", default_team: "Probe Racing" },
  { id: "p2", name: "Beta", start_number: null, default_team: "Test GP" },
];
const RULES = { points_mode: "scheme", points_by_place: [25, 18, 15], final_top_n: 2 };

function resultData(overrides = {}) {
  return {
    round: { id: "r1", code: "R1", club_day: "2026-10-15", venue: "Probering" },
    series: { id: "serie-1", kind: "racing", team_name: "Probe Lions", rules: RULES },
    access: { role: "board", can_publish: true }, version: 0, sheet: null, target: "sheet", participants: PARTICIPANTS,
    ...overrides,
  };
}

const PREVIEW = {
  version: 0, target: "sheet", can_save: true, errors: [],
  warnings: [{ code: "place_gap", message: "Platz 2 fehlt.", rows: [1] }, { code: "future", message: "Der Termin liegt in der Zukunft.", rows: [] }],
  rows: [
    { index: 0, participant_id: "p1", scored: { points: 26, base: 25, bonus: 1, penalty: 0 } },
    { index: 1, participant_id: "neu:gamma", scored: { points: 15, base: 15, bonus: 0, penalty: 0 } },
  ],
  unknown_names: [{ participant_id: "neu:gamma", name: "Gamma", alias: null, suggestions: [{ target: "member", profile_id: "m1", label: "Gamma Mitglied", reason: "Spiel-ID passt" }] }],
  club_members: [{ participant_id: "p1", name: "Alpha", profile_name: "Alpha Mitglied" }],
  standings: { round_seq: 1, scopes: { drivers: [
    { participant_id: "p1", name: "Alpha", rank: 1, rank_change: 1, points: 26, is_club_member: true },
    { participant_id: "neu:gamma", name: "Gamma", rank: 2, rank_change: null, points: 15, is_new: true },
    { participant_id: "p2", name: "Beta", rank: 3, rank_change: -2, points: 10, deviation: 2, official_points: 12, computed_points: 10 },
  ] } },
  final: { top_n: 2, participant_ids: ["p1", "neu:gamma"], entered: ["neu:gamma"], left: ["p2"] },
  latest: null,
};

function setup({ series = BOARD, data = resultData() } = {}) {
  apiMock.get.mockImplementation(async (url) => (url.endsWith("/calendar") ? { data: CALENDAR } : { data }));
  const onChanged = vi.fn();
  render(<SeriesResultsSection series={series} onChanged={onChanged} />);
  return { onChanged };
}

async function openRound(code = "R1") {
  const items = await screen.findAllByTestId("results-round");
  const item = items.find((entry) => entry.textContent.includes(code));
  fireEvent.click(within(item).getByTestId("results-open"));
  return screen.findByTestId("result-sheet");
}

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  apiMock.post.mockResolvedValue({ data: PREVIEW });
  apiMock.put.mockResolvedValue({ data: { target: "sheet", version: 1, created_participants: [] } });
});

test("je Termin „Ergebnis eintragen“, abgesagte Termine fehlen", async () => {
  setup();
  const items = await screen.findAllByTestId("results-round");
  expect(items).toHaveLength(2);
  expect(within(items[0]).getByTestId("results-open")).toHaveTextContent("Ergebnis eintragen");
  expect(within(items[1]).getByTestId("results-open")).toHaveTextContent("Ergebnis ändern");
});

test("Termin ohne Kürzel (#1969): „Termin 2“ bricht nicht in der schmalen Spalte um", async () => {
  apiMock.get.mockImplementation(async (url) => (url.endsWith("/calendar")
    ? { data: { ...CALENDAR, rounds: [{ ...CALENDAR.rounds[0], code: "", position: 2 }] } }
    : { data: resultData() }));
  render(<SeriesResultsSection series={BOARD} onChanged={vi.fn()} />);
  const [item] = await screen.findAllByTestId("results-round");
  const label = within(item).getByText("Termin 2");
  expect(label).toHaveClass("whitespace-nowrap", "min-w-12");
  expect(label).not.toHaveClass("w-12");
});

test("dynamische Liste: Zeilen hinzufügen und entfernen, Platz aus der Reihenfolge, Team aus dem Teilnehmer", async () => {
  setup();
  await openRound();
  expect(apiMock.get).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/rounds/r1/results");
  expect(screen.getAllByTestId("result-row")).toHaveLength(1);
  fireEvent.change(screen.getAllByTestId("result-row-name")[0], { target: { value: "Alpha" } });
  expect(screen.getAllByTestId("result-row-team")[0]).toHaveValue("Probe Racing");
  fireEvent.click(screen.getByTestId("result-row-add"));
  fireEvent.click(screen.getByTestId("result-row-add"));
  const names = screen.getAllByTestId("result-row-name");
  fireEvent.change(names[1], { target: { value: "Neu Eins" } });
  fireEvent.change(names[2], { target: { value: "Neu Zwei" } });
  expect(screen.getAllByTestId("result-row-place").map((input) => input.placeholder)).toEqual(["1", "2", "3"]);
  fireEvent.click(screen.getAllByTestId("result-row-remove")[1]);
  expect(screen.getAllByTestId("result-row")).toHaveLength(2);
  expect(screen.getAllByTestId("result-row-place").map((input) => input.placeholder)).toEqual(["1", "2"]);
  fireEvent.click(screen.getAllByTestId("result-row-more")[0]);
  fireEvent.click(screen.getAllByTestId("result-row-mark-fastest_lap")[0]);

  fireEvent.click(screen.getByTestId("result-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  const [url, body] = apiMock.post.mock.calls[0];
  expect(url).toBe("/reference-series/admin/series/serie-1/rounds/r1/results/preview");
  expect(body.rows).toEqual([
    expect.objectContaining({ participant_id: "p1", place: 1, team: "Probe Racing", marks: ["fastest_lap"], points_source: "scheme" }),
    expect.objectContaining({ name: "Neu Zwei", place: 2 }),
  ]);
});

test("Vorschau: Meldungen an der Zeile, Punkte, Tabelle mit Bewegung und Finalgrenze, unbekannte Namen mit Vorschlag", async () => {
  setup();
  await openRound();
  fireEvent.change(screen.getAllByTestId("result-row-name")[0], { target: { value: "Alpha" } });
  fireEvent.click(screen.getByTestId("result-row-add"));
  fireEvent.change(screen.getAllByTestId("result-row-name")[1], { target: { value: "Gamma" } });
  fireEvent.click(screen.getByTestId("result-submit"));
  await screen.findByTestId("result-preview");

  const rows = screen.getAllByTestId("result-row");
  expect(within(rows[0]).getByTestId("result-row-scored")).toHaveTextContent("26 Pkt (25 + 1 Bonus)");
  expect(within(rows[1]).getByTestId("result-row-problems")).toHaveTextContent("Platz 2 fehlt.");
  expect(rows[1].dataset.level).toBe("warning");
  expect(screen.getByTestId("preview-warnings")).toHaveTextContent("Der Termin liegt in der Zukunft.");
  expect(screen.getByTestId("preview-warnings")).not.toHaveTextContent("Platz 2 fehlt.");
  expect(screen.getByTestId("preview-club")).toHaveTextContent("Alpha (Alpha Mitglied)");
  expect(screen.getByTestId("preview-unknown-suggestions")).toHaveTextContent("Gamma Mitglied (Spiel-ID passt)");
  const standings = screen.getAllByTestId("preview-standing-row");
  expect(standings).toHaveLength(3);
  expect(within(standings[0]).getByLabelText("1 Plätze nach oben")).toBeInTheDocument();
  expect(within(standings[2]).getByLabelText("2 Plätze nach unten")).toBeInTheDocument();
  expect(standings[2]).toHaveTextContent("laut Veranstalter 12, gerechnet 10");
  expect(screen.getByTestId("preview-final")).toHaveTextContent("Neu im Finale: Gamma");
  expect(screen.getByTestId("preview-final")).toHaveTextContent("Aus dem Finale gefallen: Beta");

  // Vorstand darf veröffentlichen; „Nur als Entwurf“ daneben. Neue offene Namen öffnen danach „Unbekannte Namen“.
  apiMock.put.mockResolvedValue({ data: { target: "sheet", version: 1, created_participants: [{ id: "x1", name: "Gamma", link_status: "open" }] } });
  expect(screen.getByTestId("result-submit")).toHaveTextContent("Veröffentlichen");
  expect(screen.getByTestId("result-save-draft")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("result-submit"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalled());
  expect(apiMock.put.mock.calls[0][1]).toMatchObject({ status: "published", expected_version: 0 });
  await screen.findByTestId("unknown-names");

});

test("geänderte Eingabe nach der Vorschau: erst wieder prüfen", async () => {
  setup();
  await openRound();
  fireEvent.change(screen.getAllByTestId("result-row-name")[0], { target: { value: "Alpha" } });
  fireEvent.click(screen.getByTestId("result-submit"));
  await screen.findByTestId("result-preview");
  fireEvent.change(screen.getAllByTestId("result-row-points")[0], { target: { value: "20" } });
  expect(screen.queryByTestId("result-preview")).toBeNull();
  expect(screen.getByTestId("result-preview-outdated")).toBeInTheDocument();
  expect(screen.getByTestId("result-submit")).toHaveTextContent("Vorschau");
});

test("Liste einfügen ersetzt die Zeilen und prüft gleich – Fehler mit Zeilennummer", async () => {
  setup();
  await openRound();
  fireEvent.click(screen.getByTestId("result-paste-toggle"));
  fireEvent.change(screen.getByTestId("result-paste-text"), { target: { value: "1. Alpha  25\n2.\n3. Gamma DNF" } });
  fireEvent.click(screen.getByTestId("result-paste-apply"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  expect(screen.getAllByTestId("result-row-name").map((input) => input.value)).toEqual(["Alpha", "Gamma"]);
  expect(apiMock.post.mock.calls[0][1].rows).toEqual([
    expect.objectContaining({ participant_id: "p1", place: 1, points: 25, points_source: "organizer" }),
    expect.objectContaining({ name: "Gamma", place: 3, marks: ["dnf"] }),
  ]);
  expect(screen.getByTestId("result-paste-errors")).toHaveTextContent("Zeile 2: Kein Name erkannt.");
  await screen.findByTestId("result-preview");
});

test("Rennliga (#1927): Tabelle mit Nr, Start, Zeit, Abstand, Ausfall, schnellster Runde und Fahrer des Tages einfügen", async () => {
  setup({ data: resultData({ round: { id: "r1", code: "R1", club_day: "2026-10-15", venue: "Baku", country_code: "AZ" } }) });
  const sheet = await openRound();
  expect(within(screen.getByTestId("result-round")).getByRole("img", { name: "Aserbaidschan" })).toBeTruthy();
  fireEvent.click(screen.getByTestId("result-paste-toggle"));
  const text = "Pos\tNr\tFahrer\tStart\tZeit\tAbstand\tBeste Runde\n1\t7\tAlpha\t3\t1:32:45.123\t\t1:31.902\n2\t12\tBeta\t1\t\t+5.204\t1:31.456\n\t21\tGamma\t2\tDNF\t\t\nFahrer des Tages: Gamma";
  fireEvent.change(screen.getByTestId("result-paste-text"), { target: { value: text } });
  fireEvent.click(screen.getByTestId("result-paste-apply"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  const body = apiMock.post.mock.calls[0][1];
  expect(body.rows).toEqual([
    expect.objectContaining({ participant_id: "p1", place: 1, start_number: "7", grid: 3, time: "1:32:45.123" }),
    expect.objectContaining({ participant_id: "p2", place: 2, start_number: "12", grid: 1, gap: "+5.204" }),
    expect.objectContaining({ name: "Gamma", start_number: "21", grid: 2, marks: ["dnf"] }),
  ]);
  expect(body.fastest_lap).toEqual({ participant_id: "p2", time: "1:31.456" });
  expect(body.driver_of_the_day).toEqual({ name: "Gamma" });
  // Je Rennen sichtbar und änderbar; je Zeile unter „Mehr“.
  expect(screen.getByTestId("result-fastest-name")).toHaveValue("Beta");
  // Angezeigt mit Komma wie beim Veranstalter (#1981), gespeichert mit Punkt (oben).
  expect(screen.getByTestId("result-fastest-time")).toHaveValue("1:31,456");
  expect(screen.getByTestId("result-dotd")).toHaveValue("Gamma");
  // Zugeklappt kurz unter jeder Zeile, aufgeklappt als Felder.
  expect(within(sheet).getAllByTestId("result-row-race").map((line) => line.textContent)).toEqual([
    "Nr. 7 · Startplatz 3 · 1:32:45,123", "Nr. 12 · Startplatz 1 · +5,204", "Nr. 21 · Startplatz 2"]);
  fireEvent.click(within(sheet).getAllByTestId("result-row-more")[0]);
  expect(within(sheet).getByTestId("result-row-grid")).toHaveValue("3");
  fireEvent.change(within(sheet).getByTestId("result-row-grid"), { target: { value: "0" } });
  expect(screen.getByTestId("result-invalid")).toBeInTheDocument();
  // Ungültig bleibt das Feld sichtbar, auch beim Zuklappen.
  fireEvent.click(within(sheet).getAllByTestId("result-row-more")[0]);
  expect(within(sheet).getByTestId("result-row-grid")).toHaveAttribute("aria-invalid", "true");
});

test("Rennliga (#1927): Rundenzeit ohne Fahrer hält das Prüfen auf, Meldungen des Servers stehen am Feld", async () => {
  setup();
  await openRound();
  fireEvent.change(screen.getAllByTestId("result-row-name")[0], { target: { value: "Alpha" } });
  fireEvent.change(screen.getByTestId("result-fastest-time"), { target: { value: "1:31.456" } });
  const race = screen.getByTestId("result-race");
  expect(within(race).getByTestId("result-race-problems")).toHaveTextContent("Zur Rundenzeit fehlt der Fahrer");
  expect(screen.getByTestId("result-fastest-name")).toHaveAttribute("aria-invalid", "true");
  fireEvent.click(screen.getByTestId("result-submit"));
  expect(apiMock.post).not.toHaveBeenCalled();
  expect(screen.getByTestId("result-invalid")).toBeInTheDocument();

  // Mit Fahrer geht es zum Server; eine Meldung zu diesem Feld steht dann am Feld, nicht oben in der Vorschau.
  apiMock.post.mockResolvedValueOnce({ data: { ...PREVIEW, can_save: false, warnings: [],
    errors: [{ code: "fastest_lap_not_in_list", field: "fastest_lap", rows: [], message: "Schnellste Runde: „Gamma“ steht nicht in der Ergebnisliste." }] } });
  fireEvent.change(screen.getByTestId("result-fastest-name"), { target: { value: "Gamma" } });
  fireEvent.click(screen.getByTestId("result-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  expect(await within(race).findByTestId("result-race-problems")).toHaveTextContent("„Gamma“ steht nicht in der Ergebnisliste");
  expect(screen.getByTestId("result-preview")).not.toHaveTextContent("„Gamma“ steht nicht");
});

test("Team-Liga: kein Feld für schnellste Runde und Fahrer des Tages", async () => {
  setup({ data: resultData({ series: { id: "serie-1", kind: "team_league", team_name: "Probe Lions", rules: { points_mode: "scheme" } } }) });
  await openRound();
  expect(screen.queryByTestId("result-race")).toBeNull();
});

test("Zahl am Namensende: bleibt beim Namen, bis jemand „letzte Zahl = Punkte“ wählt", async () => {
  setup();
  await openRound();
  fireEvent.click(screen.getByTestId("result-paste-toggle"));
  fireEvent.change(screen.getByTestId("result-paste-text"), { target: { value: "1. Alpha 25\n2. Beta 18\n3. Probe 77" } });
  fireEvent.click(screen.getByTestId("result-paste-apply"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  expect(apiMock.post.mock.calls[0][1].rows[0]).toMatchObject({ name: "Alpha 25", points: null });
  expect(screen.getAllByTestId("result-row-hint")).toHaveLength(3);
  expect(screen.getByTestId("result-hints")).toHaveTextContent("3 Zeilen enden auf eine Zahl");
  // Einzeln: Punkte; einzeln: gehört zum Namen; die übrigen auf einmal.
  fireEvent.click(screen.getAllByTestId("result-row-hint-points")[0]);
  fireEvent.click(screen.getAllByTestId("result-row-hint-name")[0]);
  expect(screen.getAllByTestId("result-row-name").map((input) => input.value)).toEqual(["Alpha", "Beta 18", "Probe 77"]);
  expect(screen.getAllByTestId("result-row-points")[0]).toHaveValue("25");
  expect(screen.getAllByTestId("result-row-team")[0]).toHaveValue("Probe Racing");
  expect(screen.queryByTestId("result-hints")).toBeNull();
  fireEvent.click(screen.getByTestId("result-row-hint-points"));
  expect(screen.getAllByTestId("result-row-name").map((input) => input.value)).toEqual(["Alpha", "Beta 18", "Probe"]);
  fireEvent.click(screen.getByTestId("result-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledTimes(2));
  expect(apiMock.post.mock.calls[1][1].rows).toEqual([
    expect.objectContaining({ participant_id: "p1", points: 25, points_source: "organizer" }),
    expect.objectContaining({ name: "Beta 18", points: null }),
    expect.objectContaining({ name: "Probe", points: 77 }),
  ]);
});

test("mehrere Zahlen am Namensende: auf einmal als Punkte lesen", async () => {
  setup();
  await openRound();
  fireEvent.click(screen.getByTestId("result-paste-toggle"));
  fireEvent.change(screen.getByTestId("result-paste-text"), { target: { value: "1. Alpha 25\n2. Beta 18" } });
  fireEvent.click(screen.getByTestId("result-paste-apply"));
  fireEvent.click(await screen.findByTestId("result-hints-points"));
  expect(screen.getAllByTestId("result-row-name").map((input) => input.value)).toEqual(["Alpha", "Beta"]);
  expect(screen.getAllByTestId("result-row-points").map((input) => input.value)).toEqual(["25", "18"]);
  expect(screen.queryByTestId("result-row-hint")).toBeNull();
});

test("409 beim Übernehmen: Neu laden zeigt den aktuellen Stand, eigene Eingaben nur bewusst wieder anwenden", async () => {
  setup();
  await openRound();
  fireEvent.change(screen.getAllByTestId("result-row-name")[0], { target: { value: "Alpha" } });
  fireEvent.click(screen.getByTestId("result-submit"));
  await screen.findByTestId("result-preview");
  apiMock.put.mockRejectedValue({ response: { status: 409, data: { detail: "Das Ergebnis wurde inzwischen geändert – bitte neu laden." } } });
  fireEvent.click(screen.getByTestId("result-submit"));
  await screen.findByTestId("result-stale");
  expect(toastMock.error).toHaveBeenCalled();
  // Inzwischen hat jemand anderes Beta auf Platz 1 gespeichert.
  const current = { status: "draft", version: 4, pending_draft: null, rows: [{ participant_id: "p2", place: 1, points_source: "scheme", marks: [] }], matches: [], official_table: [], official_totals: {} };
  apiMock.get.mockImplementation(async (url) => (url.endsWith("/calendar") ? { data: CALENDAR } : { data: resultData({ version: 4, sheet: current }) }));
  fireEvent.click(screen.getByTestId("result-reload"));
  await waitFor(() => expect(screen.queryByTestId("result-stale")).toBeNull());
  // Der aktuelle Stand steht im Blatt, die eigenen Eingaben daneben - nichts wird still überschrieben.
  await waitFor(() => expect(screen.getAllByTestId("result-row-name").map((input) => input.value)).toEqual(["Beta"]));
  expect(screen.getByTestId("result-mine-summary")).toHaveTextContent("1 Zeile: Alpha");
  apiMock.put.mockResolvedValue({ data: { target: "sheet", version: 5, created_participants: [] } });
  fireEvent.click(screen.getByTestId("result-mine-apply"));
  expect(screen.queryByTestId("result-mine")).toBeNull();
  expect(screen.getAllByTestId("result-row-name").map((input) => input.value)).toEqual(["Alpha"]);
  // Danach erst wieder prüfen, dann mit der neuen Version speichern.
  expect(screen.getByTestId("result-submit")).toHaveTextContent("Vorschau");
  fireEvent.click(screen.getByTestId("result-submit"));
  await screen.findByTestId("result-preview");
  fireEvent.click(screen.getByTestId("result-submit"));
  await waitFor(() => expect(apiMock.put).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ expected_version: 4 })));
});

test("409: eigene Eingaben verwerfen lässt den aktuellen Stand stehen", async () => {
  setup();
  await openRound();
  fireEvent.change(screen.getAllByTestId("result-row-name")[0], { target: { value: "Alpha" } });
  apiMock.post.mockRejectedValue({ response: { status: 409, data: { detail: "Das Ergebnis wurde inzwischen geändert – bitte neu laden." } } });
  fireEvent.click(screen.getByTestId("result-submit"));
  await screen.findByTestId("result-stale");
  fireEvent.click(screen.getByTestId("result-reload"));
  await screen.findByTestId("result-mine");
  fireEvent.click(screen.getByTestId("result-mine-discard"));
  expect(screen.queryByTestId("result-mine")).toBeNull();
  expect(screen.getAllByTestId("result-row-name").map((input) => input.value)).toEqual([""]);
});

test("Captain ohne Recht: veröffentlichtes Blatt wird Entwurf daneben, unbekannte Namen nur „neu“", async () => {
  const published = { status: "published", version: 2, pending_draft: null, rows: [{ participant_id: "p2", place: 1, points_source: "scheme", marks: [] }], matches: [], official_table: [], official_totals: {} };
  setup({ series: CAPTAIN, data: resultData({ access: { role: "captain", can_publish: false }, version: 2, sheet: published, target: "pending_draft" }) });
  await openRound();
  expect(screen.getAllByTestId("result-row-name")[0]).toHaveValue("Beta");
  expect(screen.getByTestId("result-pending-note")).toBeInTheDocument();
  // Der Server schickt Captains keine Vorschläge und keine Alias-Ziele.
  apiMock.post.mockResolvedValue({ data: { ...PREVIEW, target: "pending_draft", club_members: [{ participant_id: "p1", name: "Alpha" }], unknown_names: [{ participant_id: "neu:gamma", name: "Gamma", auto_assigned: false }] } });
  fireEvent.click(screen.getByTestId("result-submit"));
  await screen.findByTestId("result-preview");
  expect(screen.getByTestId("preview-unknown-name")).toHaveTextContent("Gammaneu");
  expect(screen.queryByTestId("preview-unknown-suggestions")).toBeNull();
  expect(screen.queryByTestId("preview-unknown-alias")).toBeNull();
  expect(screen.getByTestId("preview-unknown")).toHaveTextContent("vom Vorstand");
  expect(screen.queryByTestId("result-save-draft")).toBeNull();
  expect(screen.getByTestId("result-submit")).toHaveTextContent("Entwurf zur Freigabe");
  apiMock.put.mockResolvedValue({ data: { target: "pending_draft", version: 3, created_participants: [{ id: "x", name: "Gamma", link_status: "open" }] } });
  fireEvent.click(screen.getByTestId("result-submit"));
  await waitFor(() => expect(apiMock.put.mock.calls[0][1]).toMatchObject({ status: "draft", expected_version: 2 }));
  await waitFor(() => expect(screen.queryByTestId("result-sheet")).toBeNull());
  expect(screen.queryByTestId("unknown-names")).toBeNull();
  expect(toastMock.success).toHaveBeenCalledWith("Als Entwurf zur Freigabe gespeichert.");
});

test("Vorstand sieht den Entwurf daneben und gibt ihn frei oder verwirft ihn", async () => {
  const sheet = {
    status: "published", version: 5, rows: [{ participant_id: "p1", place: 1, points_source: "scheme", marks: [] }], matches: [], official_table: [], official_totals: {},
    pending_draft: { rows: [{ participant_id: "p2", place: 1, points: 25, points_source: "organizer", marks: ["dnf"] }], matches: [] },
  };
  setup({ data: resultData({ version: 5, sheet }) });
  await openRound("R2");
  const pending = screen.getByTestId("result-pending");
  expect(within(pending).getByTestId("result-pending-rows")).toHaveTextContent("1. Beta · 25 Pkt · DNF");
  // Das Formular zeigt das veröffentlichte Blatt, nicht den Entwurf.
  expect(screen.getAllByTestId("result-row-name")[0]).toHaveValue("Alpha");
  apiMock.post.mockResolvedValue({ data: { version: 6 } });
  fireEvent.click(within(pending).getByTestId("result-pending-approve"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/rounds/r2/results/approve", { expected_version: 5 }));
  expect(toastMock.success).toHaveBeenCalledWith("Entwurf freigegeben.");
});

test("Verwerfen mit veraltetem Stand: 409 zeigt den Hinweis zum Neuladen", async () => {
  const sheet = { status: "published", version: 5, rows: [], matches: [], official_table: [], official_totals: {}, pending_draft: { rows: [], matches: [] } };
  setup({ data: resultData({ version: 5, sheet }) });
  await openRound();
  apiMock.post.mockRejectedValue({ response: { status: 409, data: { detail: "Das Ergebnis wurde inzwischen geändert – bitte neu laden." } } });
  fireEvent.click(screen.getByTestId("result-pending-discard"));
  await screen.findByTestId("result-stale");
  expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/rounds/r1/results/discard", { expected_version: 5 });
});

test("Team-Liga: Spiel mit Gegner, Maps und Aufstellung, Tabelle laut Veranstalter einfügen", async () => {
  setup({ data: resultData({ series: { id: "serie-1", kind: "team_league", team_name: "Probe Lions", rules: { points_mode: "scheme" } }, round: { id: "r1", code: "R1", opponent: "Test Eagles" } }) });
  await openRound();
  expect(screen.queryByTestId("result-rows-section")).toBeNull();
  expect(screen.getByTestId("result-match-home")).toHaveValue("Probe Lions");
  expect(screen.getByTestId("result-match-away")).toHaveValue("Test Eagles");
  fireEvent.change(screen.getByTestId("result-match-home-score"), { target: { value: "2" } });
  fireEvent.change(screen.getByTestId("result-match-away-score"), { target: { value: "1" } });
  fireEvent.click(screen.getByTestId("result-map-add"));
  fireEvent.change(screen.getByTestId("result-map-name"), { target: { value: "Probe Map" } });
  fireEvent.change(screen.getByTestId("result-map-home"), { target: { value: "13" } });
  fireEvent.change(screen.getByTestId("result-map-away"), { target: { value: "7" } });
  fireEvent.change(screen.getByTestId("result-lineup-input"), { target: { value: "Alpha" } });
  fireEvent.click(screen.getByTestId("result-lineup-add"));
  fireEvent.change(screen.getByTestId("result-lineup-input"), { target: { value: "Ersatz Neu" } });
  fireEvent.keyDown(screen.getByTestId("result-lineup-input"), { key: "Enter" });
  expect(screen.getByTestId("result-lineup")).toHaveTextContent("Alpha");
  fireEvent.change(screen.getByTestId("result-table-paste-text"), { target: { value: "Pl\tTeam\tSp\tPkt\n1\tProbe Lions\t3\t9\n2\tTest Eagles\t3\t6" } });
  fireEvent.click(screen.getByTestId("result-table-paste-apply"));
  expect(screen.getAllByTestId("result-table-row")).toHaveLength(2);

  fireEvent.click(screen.getByTestId("result-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  const body = apiMock.post.mock.calls[0][1];
  expect(body.rows).toEqual([]);
  expect(body.matches).toEqual([{ home: "Probe Lions", away: "Test Eagles", home_score: 2, away_score: 1, maps: [{ name: "Probe Map", home_score: 13, away_score: 7 }], lineup: [{ participant_id: "p1" }, { name: "Ersatz Neu" }] }]);
  expect(body.official_table).toEqual([{ team: "Probe Lions", rank: 1, played: 3, points: 9 }, { team: "Test Eagles", rank: 2, played: 3, points: 6 }]);
});

test("422 beim Übernehmen: Fehler des Servers an den Zeilen statt Speichern", async () => {
  setup();
  await openRound();
  fireEvent.change(screen.getAllByTestId("result-row-name")[0], { target: { value: "Alpha" } });
  fireEvent.click(screen.getByTestId("result-submit"));
  await screen.findByTestId("result-preview");
  apiMock.put.mockRejectedValue({ response: { status: 422, data: { detail: { message: "Das Blatt hat Fehler.", errors: [{ code: "duplicate", message: "Teilnehmer doppelt.", rows: [0] }], warnings: [] } } } });
  fireEvent.click(screen.getByTestId("result-submit"));
  await waitFor(() => expect(screen.getAllByTestId("result-row")[0].dataset.level).toBe("error"));
  expect(screen.getByTestId("result-submit")).toHaveTextContent("Erneut prüfen");
});

test("Captain bekommt keine Mitglieds- und Zuordnungsfelder: nur bekannt/neu je Zeile, nichts bricht", async () => {
  const people = PARTICIPANTS.map(({ id, name, start_number, default_team }) => ({ id, name, start_number, default_team }));
  setup({ series: CAPTAIN, data: resultData({ access: { role: "captain", can_publish: false }, participants: people }) });
  await openRound();
  fireEvent.change(screen.getAllByTestId("result-row-name")[0], { target: { value: "Alpha" } });
  fireEvent.click(screen.getByTestId("result-row-add"));
  fireEvent.change(screen.getAllByTestId("result-row-name")[1], { target: { value: "Gamma" } });
  const { club_members: _club, ...rest } = PREVIEW;
  apiMock.post.mockResolvedValue({ data: {
    ...rest,
    rows: [
      { index: 0, participant_id: "p1", match: "name", is_new: false, scored: { points: 25, base: 25, bonus: 0, penalty: 0 } },
      { index: 1, participant_id: "neu:gamma", match: "new", is_new: true, scored: { points: 18, base: 18, bonus: 0, penalty: 0 } },
    ],
    unknown_names: [{ participant_id: "neu:gamma", name: "Gamma", start_number: null, team: null, rows: [1], matches: [] }],
    standings: { round_seq: 1, scopes: { drivers: [{ participant_id: "p1", name: "Alpha", rank: 1, rank_change: null, points: 25 }, { participant_id: "neu:gamma", name: "Gamma", rank: 2, rank_change: null, points: 18, is_new: true }] } },
  } });
  fireEvent.click(screen.getByTestId("result-submit"));
  await screen.findByTestId("result-preview");
  expect(screen.getAllByTestId("result-row-known").map((item) => item.textContent)).toEqual(["bekannt", "neu"]);
  expect(screen.queryByTestId("preview-club")).toBeNull();
  expect(screen.getAllByTestId("preview-standing-row")).toHaveLength(2);
  expect(screen.getByTestId("preview-unknown-name")).toHaveTextContent("Gamma");
  apiMock.put.mockResolvedValue({ data: { target: "sheet", version: 1, created_participants: [{ id: "x1", name: "Gamma" }] } });
  expect(screen.getByTestId("result-submit")).toHaveTextContent("Als Entwurf speichern");
  fireEvent.click(screen.getByTestId("result-submit"));
  await waitFor(() => expect(screen.queryByTestId("result-sheet")).toBeNull());
  expect(apiMock.put.mock.calls[0][1]).toMatchObject({ status: "draft" });
  expect(screen.queryByTestId("unknown-names")).toBeNull();
});

test("Verwerfen nennt die offenen Namen, die der Server wieder mitnimmt", async () => {
  const sheet = { status: "published", version: 5, rows: [], matches: [], official_table: [], official_totals: {}, pending_draft: { rows: [], matches: [] } };
  setup({ data: resultData({ version: 5, sheet }) });
  await openRound();
  apiMock.post.mockResolvedValue({ data: { version: 6, removed_participants: ["x1", "x2"] } });
  fireEvent.click(screen.getByTestId("result-pending-discard"));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Entwurf verworfen. 2 offene Namen entfernt."));
});

test("ungültiger Platz oder ungültige Punkte: rot markiert, weder Vorschau noch Speichern, bis korrigiert", async () => {
  setup();
  await openRound();
  fireEvent.change(screen.getAllByTestId("result-row-name")[0], { target: { value: "Alpha" } });
  fireEvent.change(screen.getAllByTestId("result-row-place")[0], { target: { value: "1,5" } });
  fireEvent.change(screen.getAllByTestId("result-row-points")[0], { target: { value: "25x" } });
  expect(screen.getAllByTestId("result-row-place")[0]).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByTestId("result-row-invalid")).toHaveTextContent("Platz als ganze Zahl von 1 bis 1000.");
  expect(screen.getByTestId("result-invalid")).toHaveTextContent("2 Eingaben sind ungültig");
  fireEvent.click(screen.getByTestId("result-submit"));
  expect(apiMock.post).not.toHaveBeenCalled();
  expect(toastMock.error).toHaveBeenCalledWith("Bitte zuerst die rot markierten Eingaben korrigieren.");
  fireEvent.change(screen.getAllByTestId("result-row-place")[0], { target: { value: "1" } });
  fireEvent.change(screen.getAllByTestId("result-row-points")[0], { target: { value: "25,5" } });
  expect(screen.queryByTestId("result-invalid")).toBeNull();
  fireEvent.click(screen.getByTestId("result-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  expect(apiMock.post.mock.calls[0][1].rows[0]).toMatchObject({ place: 1, points: 25.5 });
});

test("Team-Liga: fehlender Spielstand hält das Prüfen auf", async () => {
  setup({ data: resultData({ series: { id: "serie-1", kind: "team_league", team_name: "Probe Lions", rules: { points_mode: "scheme" } }, round: { id: "r1", code: "R1", opponent: "Test Eagles" } }) });
  await openRound();
  fireEvent.change(screen.getByTestId("result-match-home-score"), { target: { value: "2" } });
  expect(screen.getByTestId("result-match-invalid")).toHaveTextContent("Ergebnis fehlt.");
  fireEvent.click(screen.getByTestId("result-submit"));
  expect(apiMock.post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByTestId("result-match-away-score"), { target: { value: "-1" } });
  expect(screen.getByTestId("result-match-invalid")).toHaveTextContent("Ergebnis als Zahl ab 0.");
});
