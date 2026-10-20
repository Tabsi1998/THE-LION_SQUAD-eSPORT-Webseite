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
