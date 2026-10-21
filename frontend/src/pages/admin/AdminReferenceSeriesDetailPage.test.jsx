import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Seite einer Saison (#1741): Kopf mit Spur, Saison und Regeln, Bearbeiten im Seitenblatt, Archivieren. Kalender,
// Teilnehmer, Ergebnisse und Captains hängen die nächsten Pakete als eigene Abschnitte an.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler", formatRequestError: () => "Fehler", resolveMediaUrl: (url) => url }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: AdminReferenceSeriesDetailPage } = await import("./AdminReferenceSeriesDetailPage");

const RULES = {
  points_mode: "scheme", points_by_place: [25, 18, 15], bonuses: { fastest_lap: { points: 0, max_place: null }, pole: { points: 0, max_place: null } },
  dnf_points: 0, dns_points: 0, dsq_points: 0, count_mode: "best_n", count_n: 8, activity_points: { points: 0, from_round: 1 },
  final_top_n: null, tiebreakers: ["countback"], team_scoring: { enabled: false, counting_drivers: null, guests_count: true },
  match_points: { win: 3, draw: 1, loss: 0 }, table_tiebreakers: ["score_diff"],
};
const SERIES = {
  id: "serie-1", lineage_id: "spur-1", season: "2026", tier: "Division 1", season_slug: "2026-division-1", status: "active",
  publish_mode: "review", rules: RULES, rules_version: 3, rules_note: "Beste acht zählen", visibility: "public",
  lineage: { id: "spur-1", slug: "probe-racing-f1", title: "Probe Racing F1", kind: "racing" },
};

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.get.mockResolvedValue({ data: SERIES });
  apiMock.post.mockResolvedValue({ data: { ...SERIES, status: "archived" } });
});

function renderAt(path = "/admin/reference-series/serie-1") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/admin/reference-series/:seriesId" element={<AdminReferenceSeriesDetailPage />} /></Routes>
    </MemoryRouter>,
  );
}

test("Kopf mit Spur, Saison, Status und Regeln samt Version und Hinweis", async () => {
  renderAt();
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("2026 · Division 1");
  expect(apiMock.get).toHaveBeenCalledWith("/reference-series/admin/series/serie-1");
  expect(screen.getByTestId("series-detail-lineage")).toHaveTextContent("Probe Racing F1");
  expect(screen.getByTestId("series-detail-rules")).toHaveTextContent("25, 18, 15");
  expect(screen.getByTestId("series-detail-rules")).toHaveTextContent("Beste 8");
  expect(screen.getByTestId("series-detail-rules")).toHaveTextContent("Version 3");
  expect(screen.getByTestId("series-detail-rules")).toHaveTextContent("Beste acht zählen");
  expect(screen.getByTestId("series-detail-back")).toHaveAttribute("href", "/admin/reference-series");
  // Rennliga ohne Spiel: kein Map-Pool (#1616).
  expect(apiMock.get).not.toHaveBeenCalledWith("/map-pools/reference-series/serie-1");
});

test("mit Spiel der Spur wählt der Vorstand den Map-Pool der Saison (#1616)", async () => {
  apiMock.get.mockImplementation((url) => Promise.resolve(String(url).startsWith("/map-pools/")
    ? { data: { game: { id: "g1", name: "Probe Shooter", modes: [] }, library: [], pool: null, previous: null } }
    : { data: { ...SERIES, lineage: { ...SERIES.lineage, kind: "team_league", game_id: "g1" } } }));
  renderAt();
  expect(await screen.findByTestId("series-map-pool")).toHaveTextContent("Map-Pool der Saison");
  expect(apiMock.get).toHaveBeenCalledWith("/map-pools/reference-series/serie-1");
});

test("Turnierserie (#1961): Runden je Turniertag, Sonderboni und „Top N“ in den Regeln, im Blatt bearbeitbar", async () => {
  apiMock.get.mockResolvedValue({ data: { ...SERIES, lineage: { ...SERIES.lineage, kind: "series" }, rules: {
    ...RULES, tiebreakers: ["wins", "top_n"], tiebreak_top_n: 4,
    day_rounds: { count: 5, points_by_place: [8, 7, 6, 5, 4, 3, 2, 1] }, custom_bonuses: [{ key: "bingo", label: "Bingo", points: 3 }],
  } } });
  renderAt();
  await screen.findByRole("heading", { level: 1 });
  expect(screen.getByTestId("series-detail-days")).toHaveTextContent("5 Runden je Turniertag, Platz 1 bis 8: 8 · 7 · 6 · 5 · 4 · 3 · 2 · 1");
  expect(screen.getByTestId("series-detail-bonuses")).toHaveTextContent("Sonderboni: Bingo +3");
  expect(screen.getByTestId("series-detail-rules")).toHaveTextContent("Vorrang: Mehr Siege, Mehr Plätze unter den besten 4");
  fireEvent.click(screen.getByTestId("series-detail-edit"));
  expect(screen.getByTestId("series-rules-day-rounds")).toHaveValue(5);
  expect(screen.getByTestId("series-rules-day-points")).toHaveValue("8, 7, 6, 5, 4, 3, 2, 1");
  expect(screen.getAllByTestId("series-rules-bonus-label").map((input) => input.value)).toEqual(["Bingo"]);
  expect(screen.getByTestId("series-rules-top-n")).toHaveValue(4);
  fireEvent.click(screen.getByTestId("series-rules-bonus-add"));
  fireEvent.change(screen.getAllByTestId("series-rules-bonus-label")[1], { target: { value: "Joker" } });
  fireEvent.change(screen.getAllByTestId("series-rules-bonus-points")[1], { target: { value: "2" } });
  fireEvent.click(screen.getByTestId("series-hide-tags"));
  apiMock.patch.mockResolvedValue({ data: {} });
  fireEvent.click(screen.getByTestId("series-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
  const body = apiMock.patch.mock.calls.at(-1)[1];
  expect(body.hide_name_tags).toBe(true);
  expect(body.rules.custom_bonuses).toEqual([{ key: "bingo", label: "Bingo", points: 3 }, { label: "Joker", points: 2 }]);
  expect(body.rules.day_rounds).toEqual({ count: 5, points_by_place: [8, 7, 6, 5, 4, 3, 2, 1] });
  expect(body.rules.tiebreakers).toEqual(["wins", "top_n"]);
});

test("Bearbeiten öffnet das Seitenblatt der Saison, Archivieren archiviert", async () => {
  renderAt();
  await screen.findByRole("heading", { level: 1 });
  fireEvent.click(screen.getByTestId("series-detail-edit"));
  expect(screen.getByRole("dialog", { name: "Saison bearbeiten" })).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("series-sheet-cancel"));
  fireEvent.click(screen.getByTestId("series-detail-archive"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/archive"));
});

// Captains (#1749) öffnen dieselbe Seite: ohne Bearbeiten, Archivieren und Captain-Verwaltung, zurück zu „Mein Dienst“.
test("Captain: Hinweis mit Ablauf und Entwurf, keine Knöpfe des Vorstands", async () => {
  apiMock.get.mockResolvedValue({ data: { ...SERIES, access: { role: "captain", can_publish: false, valid_until: "2026-12-31" } } });
  renderAt();
  expect(await screen.findByTestId("series-detail-captain")).toHaveTextContent("Du bist Captain dieser Saison bis 31.12.2026 · Einträge sind Entwürfe, der Vorstand gibt frei.");
  expect(screen.queryByTestId("series-detail-edit")).toBeNull();
  expect(screen.queryByTestId("series-detail-archive")).toBeNull();
  expect(screen.queryByTestId("series-staff")).toBeNull();
  expect(screen.getByTestId("series-detail-back")).toHaveAttribute("href", "/admin/dienst");
  // Die Saison und ihr Kalender (#1742, nur lesen) - die Captain-Liste lädt die Seite für Captains nicht.
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/calendar"));
  expect(apiMock.get.mock.calls.map(([url]) => url).filter((url) => url.includes("/staff"))).toEqual([]);
  expect(screen.queryByTestId("calendar-new")).toBeNull();
});

test("Vorstand: die Captain-Verwaltung steht auf der Seite", async () => {
  apiMock.get.mockImplementation(async (url) => ({ data: url.endsWith("/staff") ? { staff: [], publish_mode: "review" } : { ...SERIES, access: { role: "board", can_publish: true } } }));
  renderAt();
  expect(await screen.findByTestId("series-staff-empty")).toBeInTheDocument();
  expect(screen.queryByTestId("series-detail-captain")).toBeNull();
});

test("eine unbekannte Saison sagt es klar", async () => {
  apiMock.get.mockRejectedValue({ response: { status: 404, data: { detail: "Serie nicht gefunden." } } });
  renderAt("/admin/reference-series/gibt-es-nicht");
  expect(await screen.findByTestId("series-detail-missing")).toHaveTextContent("Serie nicht gefunden.");
});

// Saison abschließen (#1750): Vorschlag mit Endständen im Seitenblatt, Bestätigung legt die Referenz an oder
// aktualisiert sie; danach steht im Kopf „Referenz: Platz 6 von 8 · ansehen“.
const PREVIEW = {
  cancelled: false, open_rounds: 1, current: null, target_id: null, candidates: [],
  reference: { title: "Probe Racing F1", season: "2026" },
  entries: [
    { key: "team:probe", kind: "team", team_name: "Probe Löwen", placement: 2, team_count: 5, placement_label: "Teamwertung",
      members: [{ profile_id: "p-a", name: "Alpha" }], member_profile_ids: ["p-a"] },
    { key: "solo:p-a", kind: "solo", placement: 3, participant_count: 12, placement_label: "Fahrerwertung",
      members: [{ profile_id: "p-a", name: "Alpha" }], member_profile_ids: ["p-a"] },
  ],
};

function mockClose(preview = PREVIEW, series = SERIES) {
  apiMock.get.mockImplementation(async (url) => ({ data: url.endsWith("/close") ? preview : series }));
}

test("Saison abschließen zeigt den Vorschlag und legt die Referenz an", async () => {
  mockClose();
  apiMock.post.mockResolvedValue({ data: { reference_id: "ref-neu", created: true, status: "completed" } });
  renderAt();
  fireEvent.click(await screen.findByTestId("series-detail-close"));
  // Der Vorschlag wird beim Öffnen frisch geladen.
  expect(await screen.findByTestId("season-close-entry-team:probe")).toHaveTextContent("Platz 2 von 5 Teams · Teamwertung");
  expect(screen.getByRole("dialog", { name: "Saison abschließen" })).toHaveTextContent("Probe Löwen");
  expect(screen.getByTestId("season-close-entry-solo:p-a")).toHaveTextContent("Platz 3 von 12 · Fahrerwertung");
  expect(screen.getByTestId("season-close-open")).toHaveTextContent("1 Termin ohne Ergebnis");
  expect(screen.getByTestId("season-close-target")).toHaveValue("");
  fireEvent.click(screen.getByTestId("season-close-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/close", { reference_id: null }));
});

test("eine schon verknüpfte Referenz wird vorgeschlagen und aktualisiert", async () => {
  mockClose({ ...PREVIEW, open_rounds: 0, target_id: "ref-alt", candidates: [{ id: "ref-alt", title: "Alte Referenz", season: "2026" }] });
  apiMock.post.mockResolvedValue({ data: { reference_id: "ref-alt", created: false } });
  renderAt();
  fireEvent.click(await screen.findByTestId("series-detail-close"));
  expect(await screen.findByTestId("season-close-target")).toHaveValue("ref-alt");
  expect(screen.queryByTestId("season-close-open")).toBeNull();
  expect(screen.getByTestId("season-close-save")).toHaveTextContent("Referenz aktualisieren");
  fireEvent.click(screen.getByTestId("season-close-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/close", { reference_id: "ref-alt" }));
});

test("abgebrochene Saison: Hinweis, die Einträge bleiben ohne Platz", async () => {
  mockClose({ ...PREVIEW, cancelled: true, entries: PREVIEW.entries.map((entry) => ({ ...entry, placement: null, placement_label: "Saison abgebrochen" })) });
  renderAt();
  fireEvent.click(await screen.findByTestId("series-detail-close"));
  expect(await screen.findByTestId("season-close-cancelled")).toBeInTheDocument();
  expect(screen.getByTestId("season-close-entry-team:probe")).toHaveTextContent("Ohne Platz · Saison abgebrochen");
});

test("ohne Endstand (Team-Liga ohne Tabelle) ist der Abschluss gesperrt, mit Hinweis", async () => {
  mockClose({ ...PREVIEW, entries: [] });
  renderAt();
  fireEvent.click(await screen.findByTestId("series-detail-close"));
  expect(await screen.findByTestId("season-close-empty")).toHaveTextContent("Noch kein Endstand");
  expect(screen.getByTestId("season-close-save")).toBeDisabled();
  fireEvent.click(screen.getByTestId("season-close-save"));
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("Kopf: „Referenz: Platz 6 von 8 · ansehen“ führt zur Referenz", async () => {
  mockClose({ ...PREVIEW, current: { id: "ref-ende", title: "Probe Racing F1", placement: 6, of: 8, label: "Tabelle", team: true } });
  renderAt();
  const line = await screen.findByTestId("series-detail-reference");
  expect(line).toHaveTextContent("Referenz: Platz 6 von 8 · ansehen");
  expect(screen.getByRole("link", { name: "ansehen" })).toHaveAttribute("href", "/references/ref-ende");
});

test("Captain: kein Abschluss und kein Vorschlag", async () => {
  mockClose(PREVIEW, { ...SERIES, access: { role: "captain", can_publish: false, valid_until: "2026-12-31" } });
  renderAt();
  await screen.findByTestId("series-detail-captain");
  expect(screen.queryByTestId("series-detail-close")).toBeNull();
  expect(apiMock.get.mock.calls.map(([url]) => url).filter((url) => url.endsWith("/close"))).toEqual([]);
});
