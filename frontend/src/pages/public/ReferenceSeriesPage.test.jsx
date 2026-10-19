import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

// Serienseite (#1742): bis zur vollen Seite (#1745 ff.) nur der Kalender der Saison, nicht indexiert; unbekannt oder
// nicht sichtbar heißt 404, eine alte Adresse führt zur aktuellen. Nur erfundene Namen.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: vi.fn() }));
vi.mock("@/pages/ErrorPages", () => ({ NotFoundPage: () => <div data-testid="not-found">404</div> }));

const { default: ReferenceSeriesPage } = await import("./ReferenceSeriesPage");
const { useDocumentTitle } = await import("@/hooks/useDocumentTitle");

const BODY = {
  lineage: { title: "Probe Racing F1", slug: "probe-racing-f1", kind: "racing", label: "F1", organizer: "Probe Liga" },
  series: { season: "2026", tier: "Division 1", title: null, season_slug: "2026-division-1", status: "active" },
  today: "2026-11-05",
  rounds: [
    { id: "r1", position: 1, code: "R1", club_day: "2026-11-05", time: "20:30", venue: "Probering", state: "today" },
    { id: "r2", position: 2, code: "R2", club_day: "2026-11-14", time: null, venue: "Teststadt", state: "postponed", original_club_day: "2026-11-12" },
    { id: "r3", position: 3, code: null, club_day: null, time: null, state: "cancelled" },
  ],
};

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/references/series/:lineageSlug/:seasonSlug" element={<><ReferenceSeriesPage /><Where /></>} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { apiMock.get.mockReset(); });

test("der Kalender der Saison mit Status, nicht indexiert", async () => {
  apiMock.get.mockResolvedValue({ data: BODY });
  renderAt("/references/series/probe-racing-f1/2026-division-1");
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Probe Racing F1 2026 · Division 1");
  expect(apiMock.get).toHaveBeenCalledWith("/reference-series/public/probe-racing-f1/2026-division-1/calendar");
  const rows = screen.getAllByTestId("series-page-round");
  expect(rows.map((row) => row.dataset.state)).toEqual(["today", "postponed", "cancelled"]);
  expect(rows[0]).toHaveTextContent("Do., 05.11.2026 · 20:30");
  expect(rows[0]).toHaveTextContent("Heute");
  expect(rows[1]).toHaveTextContent("ursprünglich Do., 12.11.2026");
  expect(rows[2]).toHaveTextContent("Termin 3");
  expect(rows[2]).toHaveTextContent("Termin offen");
  expect(useDocumentTitle).toHaveBeenLastCalledWith("Probe Racing F1 2026 · Division 1", undefined, { robots: "noindex, follow" });
});

test("eine alte Adresse führt zur aktuellen", async () => {
  apiMock.get.mockResolvedValue({ data: BODY });
  renderAt("/references/series/probe-racing-f1/2026");
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/references/series/probe-racing-f1/2026-division-1"));
});

test("unbekannt oder nicht sichtbar: 404", async () => {
  apiMock.get.mockRejectedValue({ response: { status: 404 } });
  renderAt("/references/series/gibt-es/nicht");
  expect(await screen.findByTestId("not-found")).toBeInTheDocument();
});
