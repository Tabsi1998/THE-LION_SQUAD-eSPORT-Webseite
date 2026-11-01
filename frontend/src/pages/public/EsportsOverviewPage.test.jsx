import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// eSports-Übersicht (#2122 NW10): die Liga hat eine eigene Kachel und einen Knopf oben - sobald eine Season sichtbar ist.

const state = { leagues: [] };
const apiMock = {
  get: vi.fn(async (url) => {
    if (url === "/leagues") return { data: { leagues: state.leagues } };
    if (url === "/home/about") return { data: { games: [] } };
    return { data: [] };
  }),
};
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/LazyImg", () => ({ LazyImg: () => null }));

const { default: EsportsOverviewPage, leagueTile } = await import("./EsportsOverviewPage");

const SEASON = { id: "s1", slug: "season-1", name: "Season 1", status: "draft", start_date: "2026-11-10" };

test("mit sichtbarer Season: Kachel „Liga“ mit Starttermin und Knopf oben", async () => {
  state.leagues = [{ id: "l1", slug: "cod-liga", name: "CoD-Liga", seasons: [SEASON] }];
  render(<MemoryRouter><EsportsOverviewPage /></MemoryRouter>);
  const tile = await screen.findByTestId("esports-hub-league");
  expect(tile).toHaveAttribute("href", "/liga");
  expect(screen.getByTestId("esports-hub-league-badge")).toHaveTextContent("Start am 10.11.2026");
  expect(screen.getByTestId("esports-hero-league")).toHaveAttribute("href", "/liga");
});

test("ohne sichtbare Season keine Kachel", async () => {
  state.leagues = [];
  render(<MemoryRouter><EsportsOverviewPage /></MemoryRouter>);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/leagues"));
  expect(screen.getByTestId("esports-hub")).toHaveTextContent("Turniere");
  expect(screen.queryByTestId("esports-hub-league")).toBeNull();
  expect(screen.queryByTestId("esports-hero-league")).toBeNull();
});

test("leagueTile: läuft vor Starttermin, sonst „Startet bald“", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  expect(leagueTile([], now)).toBeNull();
  expect(leagueTile([{ name: "L", seasons: [{ ...SEASON, status: "active" }] }], now).badge).toBe("Läuft: Season 1");
  expect(leagueTile([{ name: "L", seasons: [SEASON] }], now).badge).toBe("Start am 10.11.2026");
  expect(leagueTile([{ name: "L", seasons: [{ ...SEASON, start_date: null }] }], now).badge).toBe("Startet bald");
  expect(leagueTile([{ name: "L", seasons: [{ ...SEASON, status: "completed" }] }], now).badge).toBe("");
});
