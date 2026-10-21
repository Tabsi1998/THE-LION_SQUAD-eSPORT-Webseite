import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Serien (#1741): Spuren mit ihren Saisons, „Neue Spur“ und „Saison“ öffnen ein Seitenblatt, die Vorlage füllt die
// Regeln vor, Archivieren statt Löschen - Archiviertes nur auf Wunsch. Nur erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
const confirmMock = vi.fn(async () => true);
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: AdminReferenceSeriesPage } = await import("./AdminReferenceSeriesPage");

const DEFAULT_RULES = {
  points_mode: "scheme", points_by_place: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
  bonuses: { fastest_lap: { points: 0, max_place: null }, pole: { points: 0, max_place: null } },
  dnf_points: 0, dns_points: 0, dsq_points: 0, count_mode: "all", count_n: 0,
  activity_points: { points: 0, from_round: 1 }, final_top_n: null, tiebreakers: ["countback", "latest_result"],
  team_scoring: { enabled: false, counting_drivers: null, guests_count: true },
  match_points: { win: 3, draw: 1, loss: 0 }, table_tiebreakers: ["score_diff", "score_for"],
};
const OVERVIEW = {
  lineages: [
    {
      id: "spur-1", slug: "probe-racing-f1", title: "Probe Racing F1", kind: "racing", label: "F1", organizer: "Probe Liga", is_archived: false,
      series: [
        { id: "serie-1", lineage_id: "spur-1", season: "2026", tier: "Division 1", season_slug: "2026-division-1", status: "active", publish_mode: "review", rules: DEFAULT_RULES, rules_version: 2, visibility: "public" },
        { id: "serie-alt", lineage_id: "spur-1", season: "2025", season_slug: "2025", status: "archived", publish_mode: "review", rules: DEFAULT_RULES, rules_version: 1, visibility: "public" },
      ],
    },
    { id: "spur-alt", slug: "probe-cup", title: "Probe Cup", kind: "series", is_archived: true, series: [] },
  ],
  points_schemes: [
    { id: "organizer", name: "Punkte laut Veranstalter", kinds: ["series", "racing", "team_league"], rules: { ...DEFAULT_RULES, points_mode: "organizer", points_by_place: [] } },
    { id: "formula_1", name: "Formel 1 (25-18-15-12-10-8-6-4-2-1)", kinds: ["racing"], rules: { ...DEFAULT_RULES, team_scoring: { enabled: true, counting_drivers: null, guests_count: true } } },
  ],
  default_rules: DEFAULT_RULES,
};

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.patch.mockReset();
  confirmMock.mockClear();
  apiMock.get.mockImplementation(async (url) => (url === "/reference-series/admin" ? { data: OVERVIEW } : { data: [{ id: "g-f1", name: "F1 26" }] }));
  apiMock.post.mockResolvedValue({ data: { id: "neu" } });
  apiMock.patch.mockResolvedValue({ data: { id: "serie-1" } });
});

function renderPage() {
  return render(<MemoryRouter><AdminReferenceSeriesPage /></MemoryRouter>);
}

test("Spuren mit ihren Saisons; Archiviertes erscheint erst auf Wunsch", async () => {
  renderPage();
  expect(await screen.findByText("Probe Racing F1")).toBeInTheDocument();
  expect(screen.getByTestId("series-row-serie-1")).toHaveTextContent("2026 · Division 1");
  expect(screen.getByTestId("series-row-serie-1")).toHaveTextContent("Läuft");
  expect(screen.queryByTestId("series-row-serie-alt")).toBeNull();
  expect(screen.queryByText("Probe Cup")).toBeNull();

  fireEvent.click(screen.getByTestId("series-show-archived"));
  expect(screen.getByTestId("series-row-serie-alt")).toHaveTextContent("Archiviert");
  expect(screen.getByText("Probe Cup")).toBeInTheDocument();
});

test("Neue Spur: Seitenblatt, Speichern legt an und lädt neu", async () => {
  renderPage();
  await screen.findByText("Probe Racing F1");
  fireEvent.click(screen.getByTestId("lineage-new"));
  expect(screen.getByRole("dialog", { name: "Neue Spur" })).toBeInTheDocument();
  fireEvent.change(screen.getByTestId("lineage-title"), { target: { value: "Probe Team-Liga" } });
  fireEvent.change(screen.getByTestId("lineage-kind"), { target: { value: "team_league" } });
  fireEvent.change(screen.getByTestId("lineage-label"), { target: { value: "5vs5" } });
  fireEvent.submit(screen.getByTestId("lineage-sheet"));

  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/lineages", expect.objectContaining({
    title: "Probe Team-Liga", kind: "team_league", label: "5vs5", organizer: null,
  })));
  await waitFor(() => expect(screen.queryByTestId("lineage-sheet")).toBeNull());
  expect(apiMock.get.mock.calls.filter(([url]) => url === "/reference-series/admin")).toHaveLength(2);
});

test("Neue Saison: die Vorlage füllt die Regeln, gespeichert wird alles vollständig", async () => {
  renderPage();
  await screen.findByText("Probe Racing F1");
  fireEvent.click(screen.getByTestId("series-new-spur-1"));
  const sheet = screen.getByRole("dialog", { name: "Neue Saison" });
  expect(within(sheet).getByTestId("series-rules-points")).toHaveValue("25, 18, 15, 12, 10, 8, 6, 4, 2, 1");
  fireEvent.change(screen.getByTestId("series-scheme"), { target: { value: "organizer" } });
  expect(screen.getByTestId("series-rules-points-mode")).toHaveValue("organizer");
  fireEvent.change(screen.getByTestId("series-scheme"), { target: { value: "formula_1" } });
  expect(screen.getByTestId("series-rules-team-enabled")).toBeChecked();
  fireEvent.change(screen.getByTestId("series-season"), { target: { value: "2027" } });
  fireEvent.change(screen.getByTestId("series-rules-count-mode"), { target: { value: "drop_n" } });
  fireEvent.change(screen.getByTestId("series-rules-count-n"), { target: { value: "2" } });
  fireEvent.submit(screen.getByTestId("series-sheet"));

  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/series", expect.objectContaining({
    lineage_id: "spur-1", points_scheme_id: "formula_1", season: "2027", status: "planned", publish_mode: "review",
    rules: expect.objectContaining({ count_mode: "drop_n", count_n: 2, team_scoring: { enabled: true, counting_drivers: null, guests_count: true, mode: "per_race" } }),
  })));
});

test("Bearbeiten mit geänderter Regel schickt den Hinweis mit", async () => {
  renderPage();
  await screen.findByText("Probe Racing F1");
  fireEvent.click(screen.getByTestId("series-edit-serie-1"));
  expect(screen.getByRole("dialog", { name: "Saison bearbeiten" })).toBeInTheDocument();
  expect(screen.getByTestId("series-season")).toHaveValue("2026");
  expect(screen.queryByTestId("series-scheme")).toBeNull();
  fireEvent.change(screen.getByTestId("series-rules-points"), { target: { value: "30, 20, 10" } });
  fireEvent.change(screen.getByTestId("series-rules-note"), { target: { value: "Neuer Schlüssel ab Runde 3" } });
  fireEvent.submit(screen.getByTestId("series-sheet"));

  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/reference-series/admin/series/serie-1", expect.objectContaining({
    rules_note: "Neuer Schlüssel ab Runde 3", rules: expect.objectContaining({ points_by_place: [30, 20, 10] }),
  })));
  expect(apiMock.patch.mock.calls[0][1]).not.toHaveProperty("lineage_id");
});

test("Archivieren fragt nach und löscht nichts; Zurückholen holt zurück", async () => {
  renderPage();
  await screen.findByText("Probe Racing F1");
  fireEvent.click(screen.getByTestId("series-archive-serie-1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/series/serie-1/archive"));
  expect(confirmMock).toHaveBeenCalledTimes(1);
  expect(apiMock.delete).not.toHaveBeenCalled();

  fireEvent.click(screen.getByTestId("series-show-archived"));
  fireEvent.click(screen.getByTestId("series-restore-serie-alt"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/series/serie-alt/restore"));
  fireEvent.click(screen.getByTestId("lineage-restore-spur-alt"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/lineages/spur-alt/restore"));
});

// Auf- und Abstieg je Saison (#1898): Vermerk an der Saison, eigene Reihenfolge der Stufen an der Spur.
test("Saison: Ergebnis der Saison wird gespeichert", async () => {
  renderPage();
  await screen.findByText("Probe Racing F1");
  fireEvent.click(screen.getByTestId("series-edit-serie-1"));
  expect(screen.getByTestId("series-season-result")).toHaveValue("");
  fireEvent.change(screen.getByTestId("series-season-result"), { target: { value: "promoted" } });
  fireEvent.submit(screen.getByTestId("series-sheet"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/reference-series/admin/series/serie-1", expect.objectContaining({ season_result: "promoted" })));
});

test("Spur: Reihenfolge der Stufen - Vorgabe aus der Zahl, Verschieben legt sie fest, Vorgabe nimmt sie zurück", async () => {
  const lineage = {
    id: "spur-2", slug: "probe-liga", title: "Probe Liga 4vs4", kind: "team_league", is_archived: false,
    series: [
      { id: "s-a", lineage_id: "spur-2", season: "2025", tier: "Liga 2", season_slug: "2025-liga-2", status: "completed", rules: DEFAULT_RULES },
      { id: "s-b", lineage_id: "spur-2", season: "2026", tier: "Liga 1", season_slug: "2026-liga-1", status: "active", rules: DEFAULT_RULES },
      { id: "s-c", lineage_id: "spur-2", season: "2027", tier: "Gold", season_slug: "2027-gold", status: "planned", rules: DEFAULT_RULES },
    ],
  };
  apiMock.get.mockImplementation(async (url) => (url === "/reference-series/admin" ? { data: { ...OVERVIEW, lineages: [lineage] } } : { data: [] }));
  apiMock.patch.mockResolvedValue({ data: { id: "spur-2" } });
  renderPage();
  await screen.findByText("Probe Liga 4vs4");
  fireEvent.click(screen.getByTestId("lineage-edit-spur-2"));
  const order = () => within(screen.getByTestId("lineage-tier-order")).getAllByRole("listitem").map((item) => item.textContent);
  expect(order()).toEqual(["1.Liga 1", "2.Liga 2", "3.Gold"]);
  expect(screen.queryByTestId("lineage-tier-reset")).toBeNull();

  fireEvent.click(screen.getByTestId("lineage-tier-2-up"));
  fireEvent.click(screen.getByTestId("lineage-tier-1-up"));
  expect(order()).toEqual(["1.Gold", "2.Liga 1", "3.Liga 2"]);
  fireEvent.submit(screen.getByTestId("lineage-sheet"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/reference-series/admin/lineages/spur-2", expect.objectContaining({ tier_order: ["Gold", "Liga 1", "Liga 2"] })));

  apiMock.patch.mockClear();
  await waitFor(() => expect(screen.queryByTestId("lineage-sheet")).toBeNull());
  fireEvent.click(screen.getByTestId("lineage-edit-spur-2"));
  fireEvent.click(screen.getByTestId("lineage-tier-2-up"));
  fireEvent.click(screen.getByTestId("lineage-tier-reset"));
  expect(order()).toEqual(["1.Liga 1", "2.Liga 2", "3.Gold"]);
  fireEvent.submit(screen.getByTestId("lineage-sheet"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/reference-series/admin/lineages/spur-2", expect.objectContaining({ tier_order: null })));
});


// ---------------------------------------------------------------- Partner (#1934)
const PARTNERS = [{ id: "p-ananas", slug: "probe-ananas", name: "Probe Ananas" }, { id: "p-kokos", slug: "probe-kokos", name: "Probe Kokos" }];

function withPartners(lineageExtra = {}) {
  const overview = { ...OVERVIEW, lineages: [{ ...OVERVIEW.lineages[0], ...lineageExtra }, OVERVIEW.lineages[1]] };
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/reference-series/admin") return { data: overview };
    if (url === "/partners") return { data: PARTNERS };
    return { data: [{ id: "g-f1", name: "F1 26" }] };
  });
}

test("Spur: Partner mit Rolle - der Veranstalter füllt das leere Feld „Veranstalter“ als Vorschlag", async () => {
  withPartners();
  renderPage();
  await screen.findByText("Probe Racing F1");
  fireEvent.click(screen.getByTestId("lineage-new"));
  fireEvent.change(screen.getByTestId("lineage-title"), { target: { value: "Probe Ananas Liga" } });
  expect(screen.queryByTestId("lineage-partner-p-ananas-role")).toBeNull();
  fireEvent.click(screen.getByTestId("lineage-partner-p-ananas"));
  fireEvent.click(screen.getByTestId("lineage-partner-p-kokos"));
  expect(screen.getByTestId("lineage-partner-p-kokos-role")).toHaveValue("contributor");
  fireEvent.change(screen.getByTestId("lineage-partner-p-ananas-role"), { target: { value: "organizer" } });
  expect(screen.getByTestId("lineage-organizer")).toHaveValue("Probe Ananas");
  fireEvent.submit(screen.getByTestId("lineage-sheet"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/reference-series/admin/lineages", expect.objectContaining({
    organizer: "Probe Ananas", partner_ids: ["p-ananas", "p-kokos"],
    partner_roles: { "p-ananas": "organizer", "p-kokos": "contributor" },
  })));
});

test("Spur: ein eingetragener Veranstalter-Text bleibt, wenn ein Partner Veranstalter wird", async () => {
  withPartners();
  renderPage();
  await screen.findByText("Probe Racing F1");
  fireEvent.click(screen.getByTestId("lineage-edit-spur-1"));
  expect(screen.getByTestId("lineage-organizer")).toHaveValue("Probe Liga");
  fireEvent.click(screen.getByTestId("lineage-partner-p-kokos"));
  fireEvent.change(screen.getByTestId("lineage-partner-p-kokos-role"), { target: { value: "organizer" } });
  expect(screen.getByTestId("lineage-organizer")).toHaveValue("Probe Liga");
});

test("Saison: erbt die Partner der Spur und ergänzt eigene", async () => {
  withPartners({ partner_ids: ["p-ananas"], partner_roles: { "p-ananas": "organizer" } });
  renderPage();
  await screen.findByText("Probe Racing F1");
  fireEvent.click(screen.getByTestId("series-edit-serie-1"));
  expect(screen.getByTestId("series-partner-inherited")).toHaveTextContent("Von der Spur: Probe Ananas (Veranstalter)");
  // Ein geerbter Partner steht nicht noch einmal zur Wahl.
  expect(screen.queryByTestId("series-partner-p-ananas")).toBeNull();
  fireEvent.click(screen.getByTestId("series-partner-p-kokos"));
  fireEvent.submit(screen.getByTestId("series-sheet"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/reference-series/admin/series/serie-1", expect.objectContaining({
    partner_ids: ["p-kokos"], partner_roles: { "p-kokos": "contributor" },
  })));
});
