import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Der Schaukasten (#619): Erfolg der Woche, Laufband, Rangliste mit Schaltern, Seltenheit, „?“-Karte und
// Vereins-Vitrine. Kürzer und leichter (#1229): Kategorien zugeklappt mit Fortschritt, erst das Aufklappen lädt die
// Gruppen der Kategorie; die Bestenliste zeigt zehn Plätze und lädt mit „Alle anzeigen“ weiter.

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

const { default: AchievementsShowcasePage, BOARD_ALL, BOARD_TOP } = await import("./AchievementsShowcasePage");

function tier(code, rank, name, extra = {}) {
  return { code, rank, level: Math.min(4, Math.ceil(rank / 2)), name, description: `${name}.`, points: 5 * rank, material: "wood", material_name: "Holz", material_color: "#A0703C",
           earned: false, current: 0, target: 10, percent: 0, manual_only: false, member_only: false, ...extra };
}

const GROUPS = [
  { code: "matches_played", name: "Spielmacher", category: "match", icon: "swords", accent_color: "#29B6E8", description: "Sammle Matches.", public: true, tier_count: 2, earned_count: 0,
    tiers: [tier("matches_played_1", 1, "Spielmacher I"), tier("matches_played_2", 2, "Spielmacher II", { material: "iron", material_name: "Eisen" })] },
  { code: "match_rookie", name: "Neuling", category: "match", icon: "swords", accent_color: "#29B6E8", description: "Erstes Match.", public: true, tier_count: 1, earned_count: 0,
    tiers: [tier("match_rookie_1", 1, "Neuling I")] },
  { code: "lap_hunter", name: "Rundenjäger", category: "fastlap", icon: "flag", accent_color: "#A855F7", description: "Fahr Runden.", public: true, tier_count: 1, earned_count: 0,
    tiers: [tier("lap_hunter_1", 1, "Rundenjäger I")] },
  { code: "membership_tenure", name: "Im Rudel", category: "club", icon: "crown", accent_color: "#FFD700", description: "Jahre im Verein.", public: true, member_only: true, tier_count: 1, earned_count: 0,
    tiers: [tier("membership_tenure_1", 1, "Im Rudel I", { member_only: true })] },
];

const OVERVIEW = {
  categories: [
    { key: "match", label: "Spielen", order: 1, icon: "swords", accent: "#29B6E8", member_only: false, hidden: false, groups: 2, tiers: 3, points: 20, awards: 3, holders: 2, community_percent: 37.5, link: "/tournaments" },
    { key: "fastlap", label: "Fast Lap", order: 3, icon: "flag", accent: "#A855F7", member_only: false, hidden: false, groups: 1, tiers: 1, points: 5, awards: 0, holders: 0, community_percent: 0, link: "/fastlap" },
    { key: "club", label: "Verein", order: 9, icon: "crown", accent: "#FFD700", member_only: true, hidden: false, groups: 1, tiers: 1, points: 5, awards: 1, holders: 1, community_percent: 50, link: "/events" },
    { key: "hidden", label: "Geheim", order: 11, icon: "eye-off", accent: "#A855F7", member_only: false, hidden: true, groups: 13, tiers: 13, points: 130, awards: 0, holders: 0, community_percent: 0, link: "/achievements" },
  ],
  rarity: {
    base: 4, members_base: 2,
    groups: {
      matches_played: { holders: 2, percent: 50, top: { code: "matches_played_2", material: "iron", material_name: "Eisen", holders: 1, percent: 25 } },
      match_rookie: { holders: 1, percent: 25, top: { code: "match_rookie_1", material: "wood", material_name: "Holz", holders: 1, percent: 10 } },
      lap_hunter: { holders: 0, percent: 0, top: { code: "lap_hunter_1", material: "wood", material_name: "Holz", holders: 0, percent: 0 } },
      membership_tenure: { holders: 1, percent: 50, top: { code: "membership_tenure_1", material: "wood", material_name: "Holz", holders: 1, percent: 50 } },
    },
    tiers: { matches_played_1: 50, matches_played_2: 25, match_rookie_1: 10, lap_hunter_1: 0, membership_tenure_1: 50 },
  },
  hidden: { total: 13, earned: 0 },
  week: { week_key: "2026-W40", from: "2026-09-21T06:00:00+00:00", to: "2026-09-28T06:00:00+00:00",
          award: { award_id: "aw-week", tier_code: "matches_played_2", name: "Spielmacher II", group_name: "Spielmacher", material: "iron", material_name: "Eisen", material_color: "#9AA0A6", icon: "swords",
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

function boardOf(count) {
  return Array.from({ length: count }, (_, index) => ({ user_id: `u${index + 1}`, username: `spieler${index + 1}`, display_name: `Spieler ${index + 1}`, count: 2, points: 500 - index, level: 3, prestige: 0, rank: index + 1 }));
}

function mockApi({ overview = OVERVIEW, board = BOARD, groups = GROUPS, failCategory = null } = {}) {
  apiMock.get.mockReset();
  apiMock.get.mockImplementation(async (url, options = {}) => {
    if (url === "/achievements/groups") {
      const category = options.params?.category;
      if (category && category === failCategory) throw new Error("weg");
      return { data: groups.filter((group) => !category || group.category === category) };
    }
    if (url === "/achievements/overview") return { data: overview };
    if (url === "/achievements/leaderboard") return { data: typeof board === "function" ? board(options.params) : board };
    return { data: [] };
  });
}

function renderPage() {
  return render(<MemoryRouter initialEntries={["/achievements"]}><AchievementsShowcasePage /></MemoryRouter>);
}

function callsTo(url) {
  return apiMock.get.mock.calls.filter(([called]) => called === url).map(([, options]) => options?.params || {});
}

beforeEach(() => {
  authState.user = null;
  authState.isClubMember = false;
});

describe("AchievementsShowcasePage (#619, #1229)", () => {
  it("schreibt „1 Erfolg“ in der Bestenliste, nicht „1 Erfolge“", async () => {
    mockApi({ board: [...BOARD, { user_id: "u3", username: "cem", display_name: "Cem", count: 1, points: 5, level: 1, prestige: 0, rank: 3 }, { user_id: "u4", username: "dora", display_name: "Dora", count: 1, points: 2, level: 1, prestige: 0, rank: 4 }] });
    renderPage();
    expect(await screen.findByTestId("leaderboard-row-4")).toHaveTextContent("1 Erfolg");
    expect(screen.getByTestId("leaderboard-row-4")).not.toHaveTextContent("1 Erfolge");
    expect(screen.getByTestId("podium-1")).toHaveTextContent("2 Erfolge");
  });

  it("lädt beim Öffnen nur Übersicht und Bestenliste - kein ganzer Katalog, keine Abzeichen", async () => {
    mockApi();
    renderPage();
    const week = await screen.findByTestId("achievement-of-week");
    expect(within(week).getByTestId("week-award-name")).toHaveTextContent("Spielmacher II");
    expect(within(week).getByTestId("week-award-rarity")).toHaveTextContent("25 %");
    expect(within(week).getByTestId("week-award-user")).toHaveAttribute("href", "/u/ben");
    expect(week).toHaveTextContent("Kalenderwoche 40");
    expect(within(week).getByTestId("week-award-card")).toHaveAttribute("href", "/achievements/a/aw-week");

    await screen.findByTestId("category-row-match");
    expect(callsTo("/achievements/groups")).toEqual([]);
    expect(apiMock.get.mock.calls.map(([url]) => url)).not.toContain("/achievements/me");
    expect(screen.queryByTestId("achievement-group-matches_played")).toBeNull();
    expect(screen.queryByTestId(/^badge-/)).toBeNull();

    // Die Zahlen oben kommen aus der Übersicht: Stufen und Punkte ohne Geheim, Kategorien mit Gruppen.
    const stats = screen.getByTestId("achievements-stats");
    expect(stats).toHaveTextContent("5Erfolge");
    expect(stats).toHaveTextContent("30Punkte zu holen");
    expect(stats).toHaveTextContent("3Kategorien");

    const ticker = screen.getByTestId("unlock-ticker");
    expect(ticker).toHaveAttribute("data-marquee", "false");
    expect(ticker).toHaveTextContent(/Ben\s*hat\s*Spielmacher II\s*\(Eisen\)/);
  });

  it("zeigt die Kategorien zugeklappt mit dem Fortschritt der Community, Geheim mit Zähler", async () => {
    mockApi();
    renderPage();
    const match = await screen.findByTestId("category-toggle-match");
    expect(match).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("category-progress-match")).toHaveTextContent("37,5 % · 2 Gruppen");
    expect(screen.getByTestId("category-detail-match")).toHaveTextContent("2 Gruppen · 3 Stufen · 2 Personen dabei");
    expect(screen.getByTestId("category-progress-fastlap")).toHaveTextContent("0 % · 1 Gruppe");
    expect(screen.getByTestId("category-row-club")).toHaveTextContent("Mitglieder");
    expect(screen.getByTestId("category-progress-hidden")).toHaveTextContent("0 von 13 gefunden");
    expect(screen.getByTestId("categories-caption")).toHaveTextContent("4 Konten");
    expect(screen.queryByTestId("category-row-negative")).toBeNull();
  });

  it("Aufklappen lädt die Gruppen der Kategorie, zeigt Abzeichen und Seltenheit; mehrere dürfen offen sein", async () => {
    mockApi();
    renderPage();
    fireEvent.click(await screen.findByTestId("category-toggle-match"));
    expect(screen.getByTestId("category-toggle-match")).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByTestId("achievement-group-matches_played")).toBeInTheDocument();
    expect(callsTo("/achievements/groups")).toEqual([{ category: "match" }]);
    expect(screen.queryByTestId("achievement-group-lap_hunter")).toBeNull();
    expect(screen.getByTestId("achievement-rarity-matches_played")).toHaveTextContent("25 % haben Eisen");
    fireEvent.click(within(screen.getByTestId("achievement-group-matches_played")).getByRole("button"));
    expect(await screen.findByTestId("achievement-tier-rarity-matches_played_1")).toHaveTextContent("50 % haben das");

    fireEvent.click(screen.getByTestId("category-toggle-fastlap"));
    expect(await screen.findByTestId("achievement-group-lap_hunter")).toBeInTheDocument();
    expect(screen.getByTestId("achievement-group-matches_played")).toBeInTheDocument();

    // Zu und wieder auf: kein zweiter Abruf.
    fireEvent.click(screen.getByTestId("category-toggle-match"));
    expect(screen.queryByTestId("achievement-group-matches_played")).toBeNull();
    fireEvent.click(screen.getByTestId("category-toggle-match"));
    expect(screen.getByTestId("achievement-group-matches_played")).toBeInTheDocument();
    expect(callsTo("/achievements/groups")).toEqual([{ category: "match" }, { category: "fastlap" }]);
  });

  it("sortiert eine offene Kategorie nach Seltenheit", async () => {
    mockApi();
    renderPage();
    fireEvent.click(await screen.findByTestId("category-toggle-match"));
    await screen.findByTestId("achievement-group-matches_played");
    const order = () => within(screen.getByTestId("achievement-category-match-groups")).getAllByTestId(/^achievement-group-(?!.*-tiers)/).map((el) => el.dataset.testid);
    expect(order()).toEqual(["achievement-group-matches_played", "achievement-group-match_rookie"]);
    fireEvent.click(screen.getByTestId("catalog-sort-match-rarity"));
    expect(screen.getByTestId("achievement-category-match-groups")).toHaveAttribute("data-sort", "rarity");
    // Neuling: 10 % haben die höchste Stufe, Spielmacher 25 % - die seltenere zuerst.
    expect(order()).toEqual(["achievement-group-match_rookie", "achievement-group-matches_played"]);
  });

  it("zeigt die ?-Karte unter Geheim und die Vereins-Vitrine für Nicht-Mitglieder", async () => {
    mockApi();
    renderPage();
    fireEvent.click(await screen.findByTestId("category-toggle-hidden"));
    const hidden = await screen.findByTestId("achievement-hidden-summary");
    expect(within(hidden).getByTestId("achievement-hidden-count")).toHaveTextContent("0 von 13 gefunden");
    expect(hidden).toHaveTextContent("Sie zeigen sich erst, wenn du sie gefunden hast");
    fireEvent.click(screen.getByTestId("category-toggle-club"));
    const note = await screen.findByTestId("club-showcase-note");
    expect(within(note).getByRole("link", { name: /Mitglied werden/ })).toHaveAttribute("href", "/membership/join");
  });

  it("angemeldet: eigener Fortschritt je Kategorie, Punkte aus der Übersicht, Aufklappen mit eigenem Stand", async () => {
    authState.user = { id: "u1", username: "anna" };
    authState.isClubMember = true;
    const own = GROUPS.map((group) => (group.code === "matches_played"
      ? { ...group, earned_count: 1, tiers: group.tiers.map((t, i) => (i === 0 ? { ...t, earned: true, earned_at: "2026-09-20T10:00:00Z", current: 10, percent: 100 } : t)) }
      : group));
    mockApi({ overview: { ...OVERVIEW, hidden: { total: 13, earned: 2 }, mine: { count: 3, points: 25, categories: { match: 1, hidden: 2 }, negative: 0 } }, groups: own });
    renderPage();
    expect(await screen.findByTestId("my-points")).toHaveTextContent("25");
    expect(screen.getByTestId("my-achievement-summary")).toHaveTextContent("Du hast bereits 3 Erfolge");
    expect(screen.getByTestId("category-progress-match")).toHaveTextContent("1 von 3 · 33 %");
    expect(screen.getByTestId("category-progress-fastlap")).toHaveTextContent("0 von 1 · 0 %");
    expect(screen.getByTestId("category-progress-hidden")).toHaveTextContent("2 von 13 gefunden");
    expect(screen.getByTestId("categories-caption")).toHaveTextContent("Dein Fortschritt");

    fireEvent.click(screen.getByTestId("category-toggle-match"));
    await screen.findByTestId("achievement-group-matches_played");
    expect(callsTo("/achievements/groups")).toEqual([{ category: "match", mine: true }]);
    fireEvent.click(within(screen.getByTestId("achievement-group-matches_played")).getByRole("button"));
    const badges = await screen.findAllByTestId("badge-matches_played_1");
    for (const badge of badges) expect(within(badge).getByRole("img")).not.toHaveAttribute("data-locked", "true");

    // Mitglieder sehen keine Vereins-Vitrine.
    fireEvent.click(screen.getByTestId("category-toggle-club"));
    await screen.findByTestId("achievement-group-membership_tenure");
    expect(screen.queryByTestId("club-showcase-note")).toBeNull();
  });

  it("zeigt „Geheim / Fun“ nur, wer selbst etwas davon hat", async () => {
    authState.user = { id: "u1", username: "anna" };
    mockApi({ overview: { ...OVERVIEW, mine: { count: 0, points: 0, categories: {}, negative: 2 } } });
    renderPage();
    expect(await screen.findByTestId("category-progress-negative")).toHaveTextContent("2 gefunden");
  });

  it("sagt, wenn eine Kategorie nicht lädt, und versucht es auf Knopfdruck noch einmal", async () => {
    mockApi({ failCategory: "fastlap" });
    renderPage();
    fireEvent.click(await screen.findByTestId("category-toggle-fastlap"));
    const error = await screen.findByTestId("category-error-fastlap");
    mockApi();
    fireEvent.click(within(error).getByRole("button", { name: "Nochmal" }));
    expect(await screen.findByTestId("achievement-group-lap_hunter")).toBeInTheDocument();
  });

  it("holt die Rangliste je Schalter neu: Level, Kategorie und Zeitraum - zehn Plätze", async () => {
    mockApi();
    renderPage();
    expect(await screen.findByTestId("podium-1")).toHaveTextContent("Ben");
    expect(screen.getByTestId("podium-1")).toHaveTextContent("★");
    expect(screen.getByTestId("podium-1")).toHaveTextContent("15");
    expect(callsTo("/achievements/leaderboard")).toEqual([{ limit: BOARD_TOP, by: "points" }]);
    expect(BOARD_TOP).toBe(10);
    expect(screen.queryByTestId("leaderboard-show-all")).toBeNull();
    expect(within(screen.getByTestId("leaderboard-category")).queryByRole("option", { name: "Geheim" })).toBeNull();

    fireEvent.change(screen.getByTestId("leaderboard-category"), { target: { value: "match" } });
    await waitFor(() => expect(callsTo("/achievements/leaderboard").at(-1)).toEqual({ limit: 10, by: "points", category: "match" }));
    fireEvent.click(screen.getByTestId("leaderboard-period-season"));
    await waitFor(() => expect(callsTo("/achievements/leaderboard").at(-1)).toEqual({ limit: 10, by: "points", category: "match", period: "season" }));
    expect(screen.getByTestId("leaderboard-period-season")).toHaveAttribute("aria-pressed", "true");

    mockApi({ board: [{ user_id: "u2", username: "ben", display_name: "Ben", level: 12, xp: 4000, prestige: 0, title: "Kämpfer", rank: 1 }] });
    fireEvent.click(screen.getByTestId("leaderboard-by-level"));
    await waitFor(() => expect(callsTo("/achievements/leaderboard").at(-1)).toEqual({ limit: 10, by: "level" }));
    expect(await screen.findByText("Level 12")).toBeInTheDocument();
    expect(screen.getByTestId("podium-1")).toHaveTextContent("Kämpfer");
    expect(screen.queryByTestId("leaderboard-category")).toBeNull();
  });

  it("zeigt Podest und Plätze 4 bis 10, „Alle anzeigen“ lädt weiter", async () => {
    mockApi({ board: (params) => boardOf(params.limit === BOARD_ALL ? 23 : 10) });
    renderPage();
    expect(await screen.findByTestId("leaderboard-row-10")).toBeInTheDocument();
    expect(screen.getByTestId("podium-3")).toBeInTheDocument();
    expect(screen.queryByTestId("leaderboard-row-11")).toBeNull();
    fireEvent.click(screen.getByTestId("leaderboard-show-all"));
    expect(await screen.findByTestId("leaderboard-row-23")).toBeInTheDocument();
    expect(callsTo("/achievements/leaderboard").at(-1)).toEqual({ limit: 100, by: "points" });
    expect(screen.queryByTestId("leaderboard-show-all")).toBeNull();
  });

  it("zeigt ohne Freischaltung der Woche und ohne Laufband die leere Kachel", async () => {
    mockApi({ overview: { ...OVERVIEW, week: { week_key: "2026-W40", award: null }, recent: [] } });
    renderPage();
    expect(await screen.findByTestId("week-award-empty")).toHaveTextContent("die nächste Kachel gehört dir");
    expect(screen.queryByTestId("unlock-ticker")).toBeNull();
  });
});
