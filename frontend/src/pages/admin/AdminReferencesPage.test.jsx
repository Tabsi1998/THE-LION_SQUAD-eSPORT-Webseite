import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Referenzen im Admin (#409): Felder statt Titel-Muster, Einträge als Team oder Einzelstarter mit
// eigener Platzierung; alte Referenzen kommen mit den vom Server abgeleiteten Feldern ins Formular.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/components/tls/GermanDateField", () => ({
  GermanDateField: ({ label, value, onChange, testId }) => <label>{label}<input data-testid={testId} value={value || ""} onChange={(e) => onChange(e.target.value)} /></label>,
}));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const AdminReferencesPage = (await import("./AdminReferencesPage")).default;

const HELPERS = {
  platforms: [{ key: "PS", label: "PlayStation" }, { key: "PC", label: "PC" }],
  formats: ["HC", "CORE"], leagues: [], seasons: [], organizers: [], game_names: [], team_names: ["THE LION SQUAD"], placement_labels: [], locations: [], auto: {},
};
const PROFILES = [
  { id: "p1", display_name: "Anna Beispiel", gamertag: "Anni" },
  { id: "p2", display_name: "Ben Beispiel", gamertag: "Benny" },
];
const LEGACY_ITEM = {
  id: "r1", title: "[PS] HC | Liga A | Herbst Cup", display_title: "Herbst Cup", platforms: ["PS"], format: "HC", league: "Liga A", season: null,
  status: "completed", visibility: "public", is_active: true, order_index: 0, mode: "online",
  entries: [{ id: "e1", kind: "team", team_name: "THE LION SQUAD", member_profile_ids: ["p1"], lineup: ["Gast"], lineup_members: [{ profile_id: "p1", display_name: "Anni" }], placement: 2, medal: "silver" }],
};

// Das Formular prüft nebenbei (#1755) - gespeichert ist, was an „/references“ geht.
const saveCalls = () => apiMock.post.mock.calls.filter(([url]) => url === "/references");

function mockApi(items) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/references/admin") return { data: { items, summary: { total: items.length } } };
    if (url === "/games") return { data: [{ id: "g1", name: "Call of Duty" }] };
    if (url === "/membership/profiles/admin/all") return { data: PROFILES };
    if (url === "/references/admin/helpers") return { data: HELPERS };
    return { data: [] };
  });
}

beforeEach(() => {
  apiMock.post.mockReset();
  apiMock.patch.mockReset();
  apiMock.post.mockResolvedValue({ data: { id: "new" } });
  apiMock.patch.mockResolvedValue({ data: LEGACY_ITEM });
  toastMock.error.mockReset();
  toastMock.warning.mockReset();
  toastMock.success.mockReset();
});

test("Neue Referenz: Felder statt Titel, zwei Einzelstarter mit je eigener Platzierung", async () => {
  mockApi([]);
  render(<MemoryRouter><AdminReferencesPage /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("reference-new"));
  expect(screen.getByRole("dialog", { name: "Neue Referenz" })).toBeInTheDocument();

  fireEvent.change(screen.getByTestId("reference-title"), { target: { value: "Winter Cup" } });
  fireEvent.change(screen.getByTestId("reference-league"), { target: { value: "Liga X" } });
  fireEvent.change(screen.getByTestId("reference-season"), { target: { value: "Season 3" } });
  fireEvent.click(await screen.findByTestId("reference-platform-PS"));

  fireEvent.click(screen.getByTestId("reference-add-solo"));
  fireEvent.click(screen.getByTestId("reference-entry-0-member-p1"));
  fireEvent.change(screen.getByTestId("reference-entry-0-placement"), { target: { value: "1" } });
  fireEvent.click(screen.getByTestId("reference-add-solo"));
  fireEvent.click(screen.getByTestId("reference-entry-1-member-p2"));
  fireEvent.change(screen.getByTestId("reference-entry-1-placement"), { target: { value: "4" } });
  fireEvent.change(screen.getByTestId("reference-entry-1-participants"), { target: { value: "32" } });

  fireEvent.submit(screen.getByTestId("reference-sheet"));
  await waitFor(() => expect(saveCalls()).toHaveLength(1));
  const [url, payload] = saveCalls()[0];
  expect(url).toBe("/references");
  expect(payload).toEqual(expect.objectContaining({ title: "Winter Cup", league: "Liga X", season: "Season 3", platforms: ["PS"] }));
  expect(payload.entries).toEqual([
    expect.objectContaining({ kind: "solo", member_profile_ids: ["p1"], placement: 1, team_name: null }),
    expect.objectContaining({ kind: "solo", member_profile_ids: ["p2"], placement: 4, participant_count: 32 }),
  ]);
});

test("ohne Eintrag wird nicht gespeichert", async () => {
  mockApi([]);
  render(<MemoryRouter><AdminReferencesPage /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("reference-new"));
  fireEvent.change(screen.getByTestId("reference-title"), { target: { value: "Winter Cup" } });
  expect(screen.getByTestId("reference-entries-empty")).toBeInTheDocument();
  fireEvent.submit(screen.getByTestId("reference-sheet"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  expect(saveCalls()).toHaveLength(0);
});

// Prüfung beim Speichern (#1755): Warnungen am Feld, Speichern bleibt möglich, Auffälligkeiten der Altdaten.
test("Prüfung: Hinweise erscheinen am Feld, gespeichert wird trotzdem mit Hinweis-Meldung", async () => {
  mockApi([LEGACY_ITEM]);
  apiMock.post.mockImplementation(async (url, body) => {
    if (url !== "/references/admin/checks/preview") return { data: {} };
    const warnings = [];
    if (body.end_date === "2028-03-01") warnings.push({ field: "end_date", code: "too_long", message: "Das Ende liegt 731 Tage nach dem Start." });
    if (body.entries?.[0]?.placement === 12) warnings.push({ field: "entries.0.placement", code: "placement_above_count", message: "Platz 12 ist größer als die Zahl der Teilnehmer (8)." });
    return { data: { warnings } };
  });
  apiMock.patch.mockResolvedValue({ data: { ...LEGACY_ITEM, check_warnings: [{ field: "end_date" }, { field: "entries.0.placement" }] } });
  render(<MemoryRouter><AdminReferencesPage /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("reference-edit-r1"));
  fireEvent.change(screen.getByTestId("reference-start-date"), { target: { value: "2026-03-01" } });
  fireEvent.change(screen.getByTestId("reference-end-date"), { target: { value: "2028-03-01" } });
  fireEvent.change(screen.getByTestId("reference-entry-0-placement"), { target: { value: "12" } });
  fireEvent.change(screen.getByTestId("reference-entry-0-teams"), { target: { value: "8" } });

  expect(await screen.findByTestId("reference-end-date-warnings")).toHaveTextContent("731 Tage");
  expect(await screen.findByTestId("reference-entry-0-warnings")).toHaveTextContent("Platz 12");

  fireEvent.submit(screen.getByTestId("reference-sheet"));
  await waitFor(() => expect(toastMock.warning).toHaveBeenCalledWith("Gespeichert – 2 Hinweise zur Prüfung."));
  expect(apiMock.patch).toHaveBeenCalledWith("/references/r1", expect.objectContaining({ end_date: "2028-03-01" }));
  expect(toastMock.success).not.toHaveBeenCalled();
});

test("Prüfung: Auffälligkeiten der Altdaten mit Bearbeiten und einstellbarer Grenze", async () => {
  mockApi([LEGACY_ITEM]);
  const base = apiMock.get.getMockImplementation();
  apiMock.get.mockImplementation(async (url) => (url === "/references/admin/checks" ? { data: {
    settings: { max_duration_days: 365, warn_future_end: true }, checked: 1,
    items: [{ id: "r1", title: "Herbst Cup", warnings: [{ field: "placement", code: "placement_above_count", message: "Platz 20 ist größer als die Zahl der Teilnehmer (16)." }] }],
  } } : base(url)));
  apiMock.patch.mockResolvedValue({ data: { max_duration_days: 30, warn_future_end: false } });
  render(<MemoryRouter><AdminReferencesPage /></MemoryRouter>);
  expect(await screen.findByTestId("reference-checks-count")).toHaveTextContent("(1)");
  expect(screen.getByTestId("reference-check-r1")).toHaveTextContent("Platz 20");

  fireEvent.change(screen.getByTestId("reference-checks-days"), { target: { value: "30" } });
  fireEvent.click(screen.getByTestId("reference-checks-future"));
  fireEvent.click(screen.getByTestId("reference-checks-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/references/admin/checks", { max_duration_days: 30, warn_future_end: false }));

  fireEvent.click(screen.getByTestId("reference-check-edit-r1"));
  expect(screen.getByRole("dialog", { name: "Referenz bearbeiten" })).toBeInTheDocument();
});

test("Bearbeiten übernimmt die abgeleiteten Felder und den Eintrag der alten Referenz", async () => {
  mockApi([LEGACY_ITEM]);
  render(<MemoryRouter><AdminReferencesPage /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("reference-edit-r1"));
  expect(screen.getByTestId("reference-title")).toHaveValue("Herbst Cup");
  expect(screen.getByTestId("reference-league")).toHaveValue("Liga A");
  expect(screen.getByTestId("reference-format")).toHaveValue("HC");
  expect(screen.getByTestId("reference-entry-0-kind")).toHaveValue("team");
  expect(screen.getByTestId("reference-entry-0-team")).toHaveValue("THE LION SQUAD");
  expect(screen.getByTestId("reference-entry-0-placement")).toHaveValue(2);
  expect(screen.getByTestId("reference-entry-0-lineup")).toHaveValue("Gast");
  expect(screen.getByTestId("reference-entry-0-member-p1")).toBeChecked();

  fireEvent.click(screen.getByTestId("reference-entry-0-member-p2"));
  fireEvent.submit(screen.getByTestId("reference-sheet"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1));
  const [url, payload] = apiMock.patch.mock.calls[0];
  expect(url).toBe("/references/r1");
  expect(payload.title).toBe("Herbst Cup");
  expect(payload.platforms).toEqual(["PS"]);
  expect(payload.entries).toEqual([expect.objectContaining({ id: "e1", kind: "team", member_profile_ids: ["p1", "p2"], lineup: ["Gast"], placement: 2 })]);
});

test("Partner II (#469): der Partner-Haken an der Referenz geht als partner_ids mit", async () => {
  mockApi([LEGACY_ITEM]);
  const base = apiMock.get.getMockImplementation();
  apiMock.get.mockImplementation(async (url) => (url === "/partners" ? { data: [{ id: "p1", slug: "pineapps-esports", name: "PineApps eSports" }] } : base(url)));
  render(<MemoryRouter><AdminReferencesPage /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("reference-edit-r1"));
  fireEvent.click(await screen.findByTestId("reference-partner-p1"));
  fireEvent.submit(screen.getByTestId("reference-sheet"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1));
  expect(apiMock.patch.mock.calls[0][1].partner_ids).toEqual(["p1"]);
});

test("Vitrine (#1878): die Hauptkarte ist automatisch oder eine fest gewählte Podest-Referenz", async () => {
  const gold = { ...LEGACY_ITEM, id: "r2", display_title: "Winter Cup", best_placement: 1, medal: "gold", start_date: "2026-02-01" };
  const open = { ...LEGACY_ITEM, id: "r3", display_title: "Ohne Platz", best_placement: null, medal: null, entries: [] };
  mockApi([gold, open]);
  const base = apiMock.get.getMockImplementation();
  apiMock.get.mockImplementation(async (url) => (url === "/references/admin/showcase" ? { data: { mode: "auto", reference_id: null } } : base(url)));
  apiMock.patch.mockImplementation(async (url, body) => ({ data: body }));
  render(<MemoryRouter><AdminReferencesPage /></MemoryRouter>);
  const select = await screen.findByTestId("reference-showcase-select");
  await waitFor(() => expect(select).toHaveValue("auto"));
  const options = [...select.querySelectorAll("option")].map((option) => [option.value, option.textContent]);
  expect(options).toEqual([["auto", "Automatisch: höchster Platz in der höchsten Stufe, bei Gleichstand der neueste"], ["r2", "1. Platz · Winter Cup · 2026"]]);

  fireEvent.change(select, { target: { value: "r2" } });
  fireEvent.click(screen.getByTestId("reference-showcase-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/references/admin/showcase", { mode: "pinned", reference_id: "r2" }));
  fireEvent.change(select, { target: { value: "auto" } });
  fireEvent.click(screen.getByTestId("reference-showcase-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenLastCalledWith("/references/admin/showcase", { mode: "auto", reference_id: null }));
  expect(toastMock.success).toHaveBeenCalled();
});

// Saison abschließen (#1750): Hinweis oben, Abzeichen „aus Saison …“ mit Link, Auswahl „Gehört zur Saison“.
const LINEAGES = [{
  id: "spur-1", title: "Probe Liga", slug: "probe-liga", is_archived: false,
  series: [
    { id: "s-2026", season: "2026", tier: "Division 2", status: "completed", reference_id: "r-ende" },
    { id: "s-2027", season: "2027", tier: "", status: "active" },
  ],
}];

function mockSeasons(items) {
  mockApi(items);
  const base = apiMock.get.getMockImplementation();
  apiMock.get.mockImplementation(async (url) => (url === "/reference-series/admin" ? { data: { lineages: LINEAGES } } : base(url)));
}

test("Hinweis oben: einzelne Turniere hier, Ligen und Saisons unter Serien", async () => {
  mockSeasons([]);
  render(<MemoryRouter><AdminReferencesPage /></MemoryRouter>);
  const hint = await screen.findByTestId("reference-hint");
  expect(hint).toHaveTextContent("Einzelne Turniere und Cups hier – Ligen und Saisons unter Serien, deren Referenz entsteht beim Abschluss automatisch");
  expect(screen.getByRole("link", { name: "Serien" })).toHaveAttribute("href", "/admin/reference-series");
});

test("Referenz aus einer Saison: Abzeichen „aus Saison …“ mit Link, Endplatz-Hinweis im Formular", async () => {
  const ending = { ...LEGACY_ITEM, id: "r-ende", display_title: "Probe Liga 2026", series_id: "s-2026" };
  const linked = { ...LEGACY_ITEM, id: "r-cup", display_title: "Probe Cup", series_id: "s-2027" };
  mockSeasons([ending, linked, LEGACY_ITEM]);
  render(<MemoryRouter><AdminReferencesPage /></MemoryRouter>);
  const badge = await screen.findByTestId("reference-season-r-ende");
  expect(badge).toHaveTextContent("aus Saison Probe Liga · 2026 · Division 2");
  expect(badge).toHaveAttribute("href", "/admin/reference-series/s-2026");
  expect(screen.getByTestId("reference-season-r-cup")).toHaveTextContent("aus Saison Probe Liga · 2027");
  expect(screen.queryByTestId("reference-season-r1")).toBeNull();

  fireEvent.click(screen.getByTestId("reference-edit-r-ende"));
  expect(screen.getByTestId("reference-series")).toHaveValue("s-2026");
  expect(screen.getByTestId("reference-season-end")).toHaveTextContent("Ihr Endplatz wird in der Saison gepflegt");
});

test("Gehört zur Saison: eine alte Referenz mit einer Saison verknüpfen", async () => {
  mockSeasons([LEGACY_ITEM]);
  render(<MemoryRouter><AdminReferencesPage /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("reference-edit-r1"));
  const select = screen.getByTestId("reference-series");
  expect(select).toHaveValue("");
  await waitFor(() => expect([...select.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
    "Keine – einzelnes Turnier oder Cup", "Probe Liga · 2026 · Division 2", "Probe Liga · 2027",
  ]));
  fireEvent.change(select, { target: { value: "s-2027" } });
  expect(screen.queryByTestId("reference-season-end")).toBeNull();
  fireEvent.submit(screen.getByTestId("reference-sheet"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1));
  expect(apiMock.patch.mock.calls[0][1].series_id).toBe("s-2027");
});

// Prüfung 21.10. (#1750): ein vor dem Saisonabschluss geöffnetes Formular überschreibt den Endplatz nicht still.
test("Speichern nennt den Stand beim Öffnen; ist die Referenz inzwischen geändert, sagt es das", async () => {
  mockSeasons([{ ...LEGACY_ITEM, updated_at: "2026-10-21T10:00:00+00:00" }]);
  apiMock.patch.mockRejectedValue({ response: { status: 409, data: { detail: "Die Referenz wurde inzwischen geändert" } } });
  render(<MemoryRouter><AdminReferencesPage /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("reference-edit-r1"));
  fireEvent.submit(screen.getByTestId("reference-sheet"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1));
  expect(apiMock.patch.mock.calls[0][2]).toEqual({ params: { expected_updated_at: "2026-10-21T10:00:00+00:00" } });
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Die Referenz wurde inzwischen geändert"));
});
