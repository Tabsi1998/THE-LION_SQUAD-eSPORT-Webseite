import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Der Schaukasten (#619): Erfolg der Woche, Kategorien mit Fortschritt, Laufband, Rangliste mit Schaltern,
// Katalog mit Seltenheit, Sortierung nach Seltenheit, „?“-Karte und Vereins-Vitrine für Nicht-Mitglieder.

const apiMock = { get: vi.fn(), post: vi.fn() };
const authState = { user: null, isClubMember: false };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (v) => v || "" }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/LevelAvatarFrame", () => ({ LevelAvatarFrame: ({ children }) => <div>{children}</div>, useCrownFor: () => null }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

// framer-motion beobachtet whileInView per IntersectionObserver - jsdom kennt ihn nicht.
class FakeIntersectionObserver {
  constructor(callback) { this.callback = callback; }
  observe(target) { this.callback([{ isIntersecting: true, target }], this); }
  unobserve() {}
  disconnect() {}
}
globalThis.IntersectionObserver = FakeIntersectionObserver;

const { default: AchievementsShowcasePage } = await import("./AchievementsShowcasePage");

function tier(code, rank, name, extra = {}) {
  return { code, rank, level: Math.min(4, Math.ceil(rank / 2)), name, description: `${name}.`, points: 5 * rank, material: "wood", material_name: "Holz", material_color: "#A0703C",
           earned: false, current: 0, target: 10, percent: 0, manual_only: false, member_only: false, ...extra };
}

const GROUPS = [
  { code: "matches_played", name: "Spielmacher", category: "match", icon: "swords", accent_color: "#29B6E8", description: "Sammle Matches.", public: true, tier_count: 2, earned_count: 0,
    tiers: [tier("matches_played_1", 1, "Spielmacher I"), tier("matches_played_2", 2, "Spielmacher II", { material: "iron", material_name: "Eisen" })] },
  { code: "lap_hunter", name: "Rundenjäger", category: "fastlap", icon: "flag", accent_color: "#A855F7", description: "Fahr Runden.", public: true, tier_count: 1, earned_count: 0,
    tiers: [tier("lap_hunter_1", 1, "Rundenjäger I")] },
  { code: "membership_tenure", name: "Im Rudel", category: "club", icon: "crown", accent_color: "#FFD700", description: "Jahre im Verein.", public: true, member_only: true, tier_count: 1, earned_count: 0,
    tiers: [tier("membership_tenure_1", 1, "Im Rudel I", { member_only: true })] },
];

const OVERVIEW = {
  categories: [
    { key: "match", label: "Spielen", order: 1, icon: "swords", accent: "#29B6E8", member_only: false, hidden: false, groups: 1, tiers: 2, awards: 3, holders: 2, community_percent: 37.5, link: "/tournaments" },
    { key: "fastlap", label: "Fast Lap", order: 3, icon: "flag", accent: "#A855F7", member_only: false, hidden: false, groups: 1, tiers: 1, awards: 0, holders: 0, community_percent: 0, link: "/fastlap" },
    { key: "club", label: "Verein", order: 9, icon: "crown", accent: "#FFD700", member_only: true, hidden: false, groups: 1, tiers: 1, awards: 1, holders: 1, community_percent: 50, link: "/events" },
    { key: "hidden", label: "Geheim", order: 11, icon: "eye-off", accent: "#A855F7", member_only: false, hidden: true, groups: 13, tiers: 13, awards: 0, holders: 0, community_percent: 0, link: "/achievements" },
  ],
  rarity: {
    base: 4, members_base: 2,
    groups: {
      matches_played: { holders: 2, percent: 50, top: { code: "matches_played_2", material: "iron", material_name: "Eisen", holders: 1, percent: 25 } },
      lap_hunter: { holders: 0, percent: 0, top: { code: "lap_hunter_1", material: "wood", material_name: "Holz", holders: 0, percent: 0 } },
      membership_tenure: { holders: 1, percent: 50, top: { code: "membership_tenure_1", material: "wood", material_name: "Holz", holders: 1, percent: 50 } },
    },
    tiers: { matches_played_1: 50, matches_played_2: 25, lap_hunter_1: 0, membership_tenure_1: 50 },
  },
  hidden: { total: 13, earned: 0 },
  week: { week_key: "2026-W40", from: "2026-09-21T06:00:00+00:00", to: "2026-09-28T06:00:00+00:00",
          award: { tier_code: "matches_played_2", name: "Spielmacher II", group_name: "Spielmacher", material: "iron", material_name: "Eisen", material_color: "#9AA0A6", icon: "swords",
                   holders: 1, percent: 25, earned_at: "2026-09-26T18:00:00+00:00", user: { id: "u2", username: "ben", display_name: "Ben" } } },
  recent: [
    { award_id: "a1", tier_code: "matches_played_2", name: "Spielmacher II", material_name: "Eisen", material_color: "#9AA0A6", group_name: "Spielmacher", earned_at: "2026-09-26T18:00:00+00:00", user: { id: "u2", username: "ben", display_name: "Ben" } },
    { award_id: "a2", tier_code: "matches_played_1", name: "Spielmacher I", material_name: "Holz", material_color: "#A0703C", group_name: "Spielmacher", earned_at: "2026-09-25T18:00:00+00:00", user: { id: "u1", username: "anna", display_name: "Anna" } },
  ],
};

const BOARD = [
  { user_id: "u2", username: "ben", display_name: "Ben", avatar_url: "", count: 2, points: 15, level: 4, prestige: 1, rank: 1 },
  { user_id: "u1", username: "anna", display_name: "Anna", avatar_url: "", count: 1, points: 5, level: 1, prestige: 0, rank: 2 },
];

function mockApi({ overview = OVERVIEW, board = BOARD, me = null } = {}) {
  apiMock.get.mockReset();
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/achievements/groups") return { data: GROUPS };
    if (url === "/achievements/overview") return { data: overview };
    if (url === "/achievements/leaderboard") return { data: board };
    if (url === "/achievements/me") return { data: me };
    return { data: [] };
  });
}

function renderPage() {
  return render(<MemoryRouter initialEntries={["/achievements"]}><AchievementsShowcasePage /></MemoryRouter>);
}

function boardCalls() {
  return apiMock.get.mock.calls.filter(([url]) => url === "/achievements/leaderboard").map(([, options]) => options?.params || {});
}

beforeEach(() => {
  authState.user = null;
  authState.isClubMember = false;
});

describe("AchievementsShowcasePage (#619)", () => {
  it("zeigt Erfolg der Woche, Kategorien mit Fortschritt, das Laufband und die Seltenheit je Gruppe", async () => {
    mockApi();
    renderPage();
    const week = await screen.findByTestId("achievement-of-week");
    expect(within(week).getByTestId("week-award-name")).toHaveTextContent("Spielmacher II");
    expect(within(week).getByTestId("week-award-rarity")).toHaveTextContent("25 %");
    expect(within(week).getByTestId("week-award-user")).toHaveTextContent("Ben");
    expect(within(week).getByTestId("week-award-user")).toHaveAttribute("href", "/u/ben");
    expect(week).toHaveTextContent("Kalenderwoche 40");

    const tiles = screen.getByTestId("achievements-categories");
    expect(within(tiles).getByTestId("category-tile-match")).toHaveTextContent("37,5 %");
    expect(within(tiles).getByTestId("category-tile-match")).toHaveTextContent("1 Gruppen · 2 Stufen");
    expect(within(tiles).getByTestId("category-tile-match")).toHaveTextContent("2 Personen dabei");
    expect(within(tiles).getByTestId("category-tile-club")).toHaveTextContent("Mitglieder");
    expect(within(tiles).getByTestId("category-hidden-count")).toHaveTextContent("0 von 13");
    expect(tiles).toHaveTextContent("4 Konten");

    const ticker = screen.getByTestId("unlock-ticker");
    expect(ticker).toHaveAttribute("data-marquee", "false");
    expect(ticker).toHaveTextContent(/Ben\s*hat\s*Spielmacher II\s*\(Eisen\)/);
    expect(within(ticker).getAllByRole("link")[0]).toHaveAttribute("href", "/u/ben");

    expect(screen.getByTestId("achievement-rarity-matches_played")).toHaveTextContent("25 % haben Eisen");
    expect(screen.getByTestId("achievement-rarity-matches_played")).toHaveTextContent("2 mit mindestens einer Stufe");
    fireEvent.click(within(screen.getByTestId("achievement-group-matches_played")).getByRole("button"));
    expect(await screen.findByTestId("achievement-tier-rarity-matches_played_1")).toHaveTextContent("50 % haben das");
  });

  it("zeigt die ?-Karte mit dem Zähler und die Vereins-Vitrine für Nicht-Mitglieder", async () => {
    mockApi();
    renderPage();
    const hidden = await screen.findByTestId("achievement-hidden-summary");
    expect(within(hidden).getByTestId("achievement-hidden-count")).toHaveTextContent("0 von 13 gefunden");
    expect(hidden).toHaveTextContent("Sie zeigen sich erst, wenn du sie gefunden hast");
    expect(screen.getByTestId("club-showcase-badge")).toHaveTextContent("Für Vereinsmitglieder");
    expect(within(screen.getByTestId("club-showcase-note")).getByRole("link", { name: /Mitglied werden/ })).toHaveAttribute("href", "/membership/join");
  });

  it("verbirgt die Vereins-Vitrine für Mitglieder und zählt die eigenen geheimen Funde", async () => {
    authState.user = { id: "u1", username: "anna" };
    authState.isClubMember = true;
    mockApi({ me: { groups: GROUPS, awards: [], hidden: { total: 13, earned: 2 }, next_up: [], pinned: [] } });
    renderPage();
    expect((await screen.findByTestId("achievement-hidden-count"))).toHaveTextContent("2 von 13 gefunden");
    expect(screen.getByTestId("category-hidden-count")).toHaveTextContent("2 von 13");
    expect(screen.queryByTestId("club-showcase-badge")).toBeNull();
    expect(screen.queryByTestId("club-showcase-note")).toBeNull();
  });

  it("sortiert den Katalog nach Seltenheit und filtert über die Kategorie-Kachel", async () => {
    mockApi();
    renderPage();
    await screen.findByTestId("achievement-groups");
    fireEvent.click(screen.getByTestId("catalog-sort-rarity"));
    const list = screen.getByTestId("achievement-groups");
    expect(list).toHaveAttribute("data-sort", "rarity");
    const order = within(list).getAllByTestId(/^achievement-group-(?!.*-tiers)/).map((el) => el.dataset.testid);
    expect(order).toEqual(["achievement-group-lap_hunter", "achievement-group-matches_played", "achievement-group-membership_tenure"]);
    expect(within(list).getByTestId("achievement-hidden-summary")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("catalog-sort-category"));
    fireEvent.click(screen.getByTestId("category-tile-fastlap"));
    await waitFor(() => expect(screen.getByTestId("catalog-filter-clear")).toHaveTextContent("Nur Fast Lap"));
    expect(screen.queryByTestId("achievement-group-matches_played")).toBeNull();
    expect(screen.getByTestId("achievement-group-lap_hunter")).toBeInTheDocument();
    expect(screen.queryByTestId("achievement-hidden-summary")).toBeNull();
    fireEvent.click(screen.getByTestId("catalog-filter-clear"));
    expect(screen.getByTestId("achievement-group-matches_played")).toBeInTheDocument();
  });

  it("holt die Rangliste je Schalter neu: Level, Kategorie und Zeitraum", async () => {
    mockApi();
    renderPage();
    expect(await screen.findByTestId("podium-1")).toHaveTextContent("Ben");
    expect(screen.getByTestId("podium-1")).toHaveTextContent("★");
    expect(screen.getByTestId("podium-1")).toHaveTextContent("15");
    expect(boardCalls()).toEqual([{ limit: 24, by: "points" }]);

    fireEvent.change(screen.getByTestId("leaderboard-category"), { target: { value: "match" } });
    await waitFor(() => expect(boardCalls().at(-1)).toEqual({ limit: 24, by: "points", category: "match" }));
    fireEvent.click(screen.getByTestId("leaderboard-period-season"));
    await waitFor(() => expect(boardCalls().at(-1)).toEqual({ limit: 24, by: "points", category: "match", period: "season" }));
    expect(screen.getByTestId("leaderboard-period-season")).toHaveAttribute("aria-pressed", "true");

    apiMock.get.mockImplementation(async (url) => {
      if (url === "/achievements/leaderboard") return { data: [{ user_id: "u2", username: "ben", display_name: "Ben", level: 12, xp: 4000, prestige: 0, title: "Kämpfer", rank: 1 }] };
      if (url === "/achievements/groups") return { data: GROUPS };
      if (url === "/achievements/overview") return { data: OVERVIEW };
      return { data: [] };
    });
    fireEvent.click(screen.getByTestId("leaderboard-by-level"));
    await waitFor(() => expect(boardCalls().at(-1)).toEqual({ limit: 24, by: "level" }));
    expect(await screen.findByText("Level 12")).toBeInTheDocument();
    expect(screen.getByTestId("podium-1")).toHaveTextContent("Kämpfer");
    expect(screen.queryByTestId("leaderboard-category")).toBeNull();
  });

  it("zeigt ohne Freischaltung der Woche und ohne Laufband die leere Kachel", async () => {
    mockApi({ overview: { ...OVERVIEW, week: { week_key: "2026-W40", award: null }, recent: [] } });
    renderPage();
    expect(await screen.findByTestId("week-award-empty")).toHaveTextContent("die nächste Kachel gehört dir");
    expect(screen.queryByTestId("unlock-ticker")).toBeNull();
  });
});
