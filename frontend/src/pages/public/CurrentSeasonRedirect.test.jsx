import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { StatusBadge } from "@/components/tls/StatusBadge";

// Jahreswertung (#1222): mit laufender Saison die Weiterleitung; ohne laufende der letzte Endstand (auch archiviert)
// mit den ersten zehn und dem Start der nächsten; gar keine Saison: ein Satz für alle - die Anleitung für die
// Verwaltung nur mit dem Bereich Turniere. Die Uhr steht fest.

const apiMock = { get: vi.fn() };
const authState = { user: null };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));

const { default: CurrentSeasonRedirect, seasonOverview } = await import("./CurrentSeasonRedirect");

const S2025 = { id: "s25", slug: "wertung-2025", name: "Jahreswertung 2025", status: "archived", start_date: "2025-01-01T00:00:00Z", end_date: "2025-12-31T12:00:00Z" };
const S2024 = { id: "s24", slug: "wertung-2024", name: "Jahreswertung 2024", status: "completed", start_date: "2024-01-01T00:00:00Z", end_date: "2024-12-31T12:00:00Z" };
const S2027 = { id: "s27", slug: "wertung-2027", name: "Jahreswertung 2027", status: "draft", start_date: "2027-01-10T12:00:00Z" };
const ROWS = Array.from({ length: 12 }, (_, index) => ({ rank: index + 1, user_id: `u${index}`, display_name: `Spieler${index + 1}`, username: `spieler${index + 1}`, points: 300 - index * 10 }));

function answer({ featured = null, seasons = [], standings = {} } = {}) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/seasons/active/featured") return { data: { season: featured, standings: [] } };
    if (url === "/seasons") return { data: seasons };
    const match = /^\/seasons\/(.+)\/standings$/.exec(url);
    if (match) return { data: { standings: standings[match[1]] || [] } };
    throw new Error(url);
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/seasons/current"]}>
      <Routes>
        <Route path="/seasons/current" element={<CurrentSeasonRedirect />} />
        <Route path="/seasons/:slug" element={<div data-testid="season-page">Saison</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T10:00:00Z"));
  authState.user = null;
});
afterEach(() => vi.useRealTimers());

test("laufende Saison: weiter zur Saison - ein Rückfall auf eine alte Saison zählt nicht", async () => {
  answer({ featured: { ...S2025, status: "active", slug: "wertung-2026" }, seasons: [] });
  renderPage();
  expect(await screen.findByTestId("season-page")).toBeInTheDocument();
});

test("keine laufende Saison: Endstand der letzten (auch archiviert), die ersten zehn, der Start der nächsten", async () => {
  answer({ featured: S2027, seasons: [S2027, S2024, S2025], standings: { "wertung-2025": ROWS } });
  renderPage();
  expect(await screen.findByTestId("season-current-title")).toHaveTextContent("Endstand 2025");
  expect(screen.getByTestId("season-next")).toHaveTextContent("Die nächste Wertung beginnt am 10. Jänner 2027.");
  const rows = screen.getByTestId("season-final-rows").querySelectorAll("li");
  expect(rows).toHaveLength(10);
  expect(rows[0]).toHaveTextContent("#1Spieler1300 Punkte");
  expect(screen.queryByText("Spieler11")).toBeNull();
  expect(screen.getByText("Frühere Wertungen")).toBeInTheDocument();
  expect(screen.queryByTestId("season-admin-guide")).toBeNull();
  expect(screen.queryByText(/Lege .* Saison an/)).toBeNull();
});

test("gar keine Saison: ein Satz für Gäste, die Anleitung nur mit dem Bereich Turniere", async () => {
  answer({ featured: null, seasons: [] });
  const { unmount } = renderPage();
  expect(await screen.findByTestId("season-none")).toHaveTextContent("Die Jahreswertung startet mit dem nächsten Turnier.");
  expect(screen.queryByTestId("season-admin-guide")).toBeNull();
  expect(screen.queryByText(/Admin-Bereich/)).toBeNull();
  unmount();

  authState.user = { id: "u9", role: "tournament_admin", areas: ["tournaments", "moderation"] };
  renderPage();
  const guide = await screen.findByTestId("season-admin-guide");
  expect(guide).toHaveTextContent("Lege in der Verwaltung eine Saison an und setze sie auf aktiv");
  expect(guide.querySelector("a")).toHaveAttribute("href", "/admin/seasons");
});

test("Auswahl: die zuletzt beendete Wertung, die nächste angelegte, nichts aus der Vergangenheit als „nächste“", () => {
  const past = { ...S2027, id: "alt", start_date: "2026-01-01T00:00:00Z" };
  const overview = seasonOverview([S2024, S2025, S2027, past], new Date("2026-10-07T10:00:00Z"));
  expect(overview.latest.id).toBe("s25");
  expect(overview.earlier.map((season) => season.id)).toEqual(["s24"]);
  expect(overview.next.id).toBe("s27");
});

test("eine laufende Saison trägt das Schild „Läuft“", () => {
  render(<StatusBadge status="active" />);
  expect(screen.getByTestId("status-active")).toHaveTextContent("LÄUFT");
});
