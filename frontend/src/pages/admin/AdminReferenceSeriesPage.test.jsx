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
    rules: expect.objectContaining({ count_mode: "drop_n", count_n: 2, team_scoring: { enabled: true, counting_drivers: null, guests_count: true } }),
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
