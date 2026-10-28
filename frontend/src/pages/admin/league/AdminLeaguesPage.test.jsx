import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Liga verwalten (docs/LIGA.md, #1622): Einstieg mit den Schritten, Liga je Spiel anlegen, Season mit Beginn anlegen und
// gleich auf ihre Seite springen. Nur erfundene Namen.
const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler"), formatRequestError: () => "Fehler", resolveMediaUrl: (url) => url || "" }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: AdminLeaguesPage } = await import("./AdminLeaguesPage");

const DEFAULTS = { weeks_total: 10, matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1,
  best_of: 3, team_size: 4, max_staffel_size: 8 };
const BODY = {
  games: [{ id: "g1", name: "Probe Shooter", slug: "probe-shooter" }],
  season_defaults: DEFAULTS,
  leagues: [{ id: "l1", name: "Probe-Liga", slug: "probe-shooter", game_name: "Probe Shooter", status: "active",
    seasons: [{ id: "s1", number: 1, name: "Season 1", slug: "season-1", status: "draft", visibility: "off", start_date: "2026-11-09T23:00:00+00:00", weeks_total: 10 }] }],
};

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
  apiMock.get.mockResolvedValue({ data: BODY });
  apiMock.post.mockResolvedValue({ data: { id: "s2", name: "Season 2" } });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/leagues"]}>
      <Routes>
        <Route path="/admin/leagues" element={<AdminLeaguesPage />} />
        <Route path="/admin/leagues/seasons/:seasonId" element={<p data-testid="season-page">Season-Seite</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

test("zeigt die Schritte, die Ligen und ihre Seasons mit Sichtbarkeit", async () => {
  renderPage();
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Liga");
  expect(apiMock.get).toHaveBeenCalledWith("/admin/leagues");
  expect(screen.getByTestId("league-steps").querySelectorAll("li")).toHaveLength(4);
  const link = screen.getByTestId("season-link-season-1");
  expect(link).toHaveAttribute("href", "/admin/leagues/seasons/s1");
  expect(link).toHaveTextContent("10.11.2026");
  expect(link).toHaveTextContent("Aus");
});

test("legt eine Liga für ein Spiel an", async () => {
  renderPage();
  fireEvent.click(await screen.findByTestId("league-add"));
  fireEvent.change(screen.getByTestId("league-name"), { target: { value: "Zweite Liga" } });
  fireEvent.click(screen.getByTestId("league-create-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues", { name: "Zweite Liga", game_id: "g1", description: null }));
});

test("legt eine Season mit Beginn an und öffnet ihre Seite", async () => {
  renderPage();
  fireEvent.click(await screen.findByTestId("season-add-probe-shooter"));
  expect(screen.getByTestId("season-defaults")).toHaveTextContent("Sonntag 20:00");
  expect(screen.getByTestId("season-defaults")).toHaveTextContent("nur Hinrunde");
  fireEvent.change(screen.getByTestId("season-start"), { target: { value: "2027-02-02" } });
  fireEvent.click(screen.getByTestId("season-create-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/l1/seasons", { start_date: "2027-02-01T23:00:00.000Z" }));
  expect(await screen.findByTestId("season-page")).toBeInTheDocument();
});

test("ohne Liga: ein Hinweis statt einer leeren Seite", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, leagues: [] } });
  renderPage();
  expect(await screen.findByTestId("league-empty")).toHaveTextContent("Noch keine Liga");
});
