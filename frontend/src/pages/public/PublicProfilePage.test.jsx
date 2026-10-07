import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Profilseite (Umbau 24.09.): Banner mit Avatar, Pillen und verknüpften Konten im Kopf, fünf Reiter,
// Podestplätze als Highlights, eine Konten-Karte; der Twitch-Player steht nur bei laufendem Stream.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (e, f) => f, resolveMediaUrl: (v) => v || "" }));
const authState = { user: null };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/pages/public/profile/OwnProfileParts", () => ({
  PrivateBox: () => <div data-testid="profile-private-box">Nur für dich</div>,
  OwnAchievements: () => <div data-testid="profile-own-achievements">Eigene Erfolge</div>,
}));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/CookieConsent", () => ({ useCookieConsent: () => ({ hasConsent: () => false, consent: {}, allow: () => {} }) }));
vi.mock("@/components/tls/LevelAvatarFrame", () => ({ LevelAvatarFrame: ({ children, testId }) => <div data-testid={testId}>{children}</div>, useCrownFor: () => null }));
vi.mock("@/components/tls/AccountLevel", () => ({ AccountLevelPill: ({ level }) => <span>Level {level}</span>, AccountLevelProgress: () => <div data-testid="account-level-progress" /> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: PublicProfilePage, podiumHighlights } = await import("./PublicProfilePage");

const PROFILE = {
  id: "u1", username: "paula", display_name: "Paula B.", bio: "Racing seit 2019.", role: "moderator", country: "AT",
  created_at: "2025-03-01T00:00:00Z", privacy_public_profile: true, banner_url: "/api/static/banner.jpg", avatar_url: "",
  stats: { points: 2590, wins: 1, top3: 2, tournaments: 3, fast_laps: 1, twitch_live_sessions: 7, twitch_stream_minutes: 907 },
  achievement_level: { level: 6, points: 2590, next_level_points: 3000, progress: 40 },
  twitch_handle: "paula_racing", show_twitch_embed: true, youtube_handle: "@paula", steam_id: "76561198000000001",
  verified_platforms: ["twitch"],
  linked_accounts: [{ platform: "twitch", label: "Twitch", handle: "paula_racing", display_name: "Paula Racing", linked_at: "2026-09-20T10:00:00Z", url: "https://www.twitch.tv/paula_racing" }],
  main_platforms: ["PC"], input_devices: ["wheel"], gaming_subscriptions: [], favorite_games: ["F1 25"],
  membership: { membership_type: "ordinary" }, is_club_member: true,
  teams: [{ id: "t1", tag: "TLS", name: "Lion Racing", description: "" }],
  tournaments: [
    { id: "tour1", slug: "winter-cup", title: "Winter Cup", status: "results_published", start_date: "2026-02-01", game: null, final_position: 1 },
    { id: "tour2", slug: "summer-cup", title: "Summer Cup", status: "registration_open", start_date: "2026-08-01", game: null, final_position: null },
  ],
  f1_bests: [{ track: { name: "Spielberg", country: "AT" }, challenge: { title: "F1 Hotlap" }, time_str: "1:05.123", is_leader: false }],
  awards: [],
  references: {
    stats: { total: 3, tournaments: 2, fastlaps: 1, wins: 1, podiums: 2 },
    items: [
      { id: "ref-fast", kind: "fastlap", title: "F1 Hotlap", subtitle: "Spielberg", rank: 5, time_str: "1:05.123", date: "2026-01-15", target_id: "f1-hotlap" },
      { id: "ref-win", kind: "tournament", title: "Winter Cup", subtitle: "Mario Kart", rank: 1, date: "2026-02-01", target_id: "winter-cup", status: "results_published", participant_count: 16 },
      { id: "ref-third", kind: "tournament", title: "Spring Cup", subtitle: "Mario Kart", rank: 3, date: "2026-04-01", target_id: "spring-cup" },
    ],
  },
};
const ACHIEVEMENTS = { groups: [], awards: [{ code: "first-win", name: "Erster Sieg", level_name: "Gold", level_color: "#FFD700", points: 100 }] };

function mockApi({ live = [] } = {}) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/users/public/paula") return { data: PROFILE };
    if (url === "/streams/live") return { data: live };
    if (url === "/achievements/user/u1") return { data: ACHIEVEMENTS };
    return { data: [] };
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/u/paula"]}>
      <Routes><Route path="/u/:username" element={<PublicProfilePage />} /></Routes>
    </MemoryRouter>
  );
}

test("Kopf mit Banner, Pillen, verknüpftem Konto und Zahlen; fünf Reiter; Highlights nur vom Podest; Twitch offline als Kanal-Karte", async () => {
  mockApi();
  renderPage();
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Paula B.");
  expect(screen.getByTestId("profile-banner").querySelector("img")).toHaveAttribute("src", "/api/static/banner.jpg");
  expect(screen.getByTestId("profile-identity")).toHaveTextContent("@paula");
  expect(screen.getByTestId("profile-identity")).toHaveTextContent("Moderator");
  expect(screen.getByTestId("profile-accounts-count")).toHaveTextContent("1 Konto verknüpft");
  expect(screen.queryByTestId("profile-verified-chips")).toBeNull();
  expect(screen.getByTestId("profile-stat-points")).toHaveTextContent("2590");
  expect(screen.getByTestId("profile-stat-streams")).toHaveTextContent("7");
  // Fünf Reiter: Turniere und Fast Lap stecken in den Referenzen.
  expect(screen.getByTestId("profile-tab-references")).toHaveTextContent("Referenzen (3)");
  expect(screen.getByTestId("profile-tab-teams")).toHaveTextContent("Teams (1)");
  expect(screen.queryByTestId("profile-tab-tournaments")).toBeNull();
  expect(screen.queryByTestId("profile-tab-fastlap")).toBeNull();
  // Highlights: Gold und Bronze, der fünfte Platz nicht.
  const highlights = screen.getByTestId("profile-highlights");
  expect(highlights).toHaveTextContent("Winter Cup");
  expect(highlights).toHaveTextContent("Spring Cup");
  expect(screen.queryByTestId("profile-highlight-ref-fast")).toBeNull();
  expect(highlights.querySelectorAll("[data-testid^='profile-highlight-']")[0]).toHaveTextContent("#1");
  // Ein Kasten Konten (#527): Twitch genau einmal (bestätigt, bei den Socials), YouTube daneben, Steam bei den Spielkonten.
  const accounts = screen.getByTestId("public-profile-accounts");
  expect(screen.getByTestId("profile-account-twitch")).toHaveAttribute("href", "https://www.twitch.tv/paula_racing");
  expect(screen.getByTestId("public-profile-socials")).toContainElement(screen.getByTestId("profile-account-twitch"));
  expect(screen.getByTestId("profile-account-twitch-verified")).toBeInTheDocument();
  expect(accounts).toContainElement(screen.getByTestId("profile-account-youtube"));
  expect(screen.getByTestId("public-profile-gaming-ids")).toContainElement(screen.getByTestId("profile-account-steam"));
  expect(screen.getAllByText("Paula Racing").length).toBe(1);
  expect(screen.getByTestId("public-profile-info")).toHaveTextContent("Ordentliches Mitglied");
  expect(screen.getByTestId("public-profile-setup")).toHaveTextContent("Lenkrad");
  expect(screen.getByTestId("public-profile-teams")).toHaveTextContent("Lion Racing");
  // Kein Stream: kein Player, nur die Kanal-Karte.
  await waitFor(() => expect(screen.getByTestId("profile-twitch-offline")).toHaveTextContent("gerade offline · 15 Std. in 7 Streams"));
  expect(screen.queryByTestId("public-profile-twitch-embed")).toBeNull();
});

test("Referenzen-Reiter: Filter nach Art, darunter Turnier-Teilnahmen und Fast-Lap-Bestzeiten", async () => {
  mockApi();
  renderPage();
  await screen.findByRole("heading", { level: 1 });
  fireEvent.click(screen.getByTestId("profile-tab-references"));
  expect(screen.getByTestId("public-profile-references").querySelectorAll("[data-testid^='profile-reference-']")).toHaveLength(3);
  fireEvent.click(screen.getByTestId("profile-reference-filter-fastlap"));
  const list = screen.getByTestId("public-profile-references");
  expect(list.querySelectorAll("[data-testid^='profile-reference-']")).toHaveLength(1);
  expect(list).toHaveTextContent("1:05.123");
  // Teilnahmen: nur Turniere ohne Referenz (der Winter Cup steht schon oben mit Rang).
  expect(screen.getByTestId("public-profile-tournaments")).toHaveTextContent("Weitere Teilnahmen (1)");
  expect(screen.getByTestId("public-profile-tournaments")).toHaveTextContent("Summer Cup");
  expect(screen.getByTestId("public-profile-tournaments")).not.toHaveTextContent("Winter Cup");
  expect(screen.getByTestId("public-profile-fastlaps")).toHaveTextContent("Spielberg");
});

test("läuft der Stream, steht der Player oben in der Übersicht (ohne Zustimmung der Hinweis)", async () => {
  mockApi({ live: [{ twitch_login: "paula_racing", title: "Quali-Runden", viewer_count: 12 }] });
  renderPage();
  await screen.findByRole("heading", { level: 1 });
  const embed = await screen.findByTestId("public-profile-twitch-embed");
  expect(embed).toHaveTextContent("Live · 12 Zuschauer");
  expect(embed).toHaveTextContent("Quali-Runden");
  expect(screen.getByTestId("profile-twitch-consent-notice")).toBeInTheDocument();
  expect(screen.getByTestId("profile-live-pill")).toBeInTheDocument();
  expect(screen.queryByTestId("profile-twitch-offline")).toBeNull();
});

test("podiumHighlights: nur Rang 1 bis 3, nach Rang und dann nach Datum", () => {
  const items = [{ id: "a", rank: 3, date: "2026-01-01" }, { id: "b", rank: 1, date: "2026-01-01" }, { id: "c", rank: 9 }, { id: "d", rank: 1, date: "2026-05-01" }];
  expect(podiumHighlights(items).map((i) => i.id)).toEqual(["d", "b", "a"]);
});

// Erfolge II (#619): Angeheftete zuerst in der Uebersicht, Kategorie-Balken und geheime Funde im Reiter,
// private Erfolge als Hinweis statt Liste.
function mockApiWithAchievements(achievements) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/users/public/paula") return { data: PROFILE };
    if (url === "/streams/live") return { data: [] };
    if (url === "/achievements/user/u1") return { data: achievements };
    return { data: [] };
  });
}

test("Angeheftete stehen zuerst in der Uebersicht, der Reiter zeigt Kategorie-Balken und geheime Funde", async () => {
  const groups = [
    { code: "matches_played", name: "Spielmacher", category: "match", icon: "swords", accent_color: "#29B6E8", description: "", tier_count: 2, earned_count: 1,
      tiers: [
        { code: "matches_played_1", rank: 1, level: 1, name: "Spielmacher I", description: "", points: 5, material: "wood", material_name: "Holz", material_color: "#A0703C", earned: true, earned_at: "2026-09-20T10:00:00Z" },
        { code: "matches_played_2", rank: 2, level: 1, name: "Spielmacher II", description: "", points: 10, material: "iron", material_name: "Eisen", material_color: "#9AA0A6", earned: false, current: 3, target: 25, percent: 12 },
      ] },
  ];
  const award = { code: "matches_played_1", award_id: "aw1", name: "Spielmacher I", group_name: "Spielmacher", group_category: "match", material_name: "Holz", material_color: "#A0703C", level_name: "Holz", level_color: "#A0703C", points: 5, icon: "swords" };
  mockApiWithAchievements({ groups, awards: [award], pinned: [award], hidden: { total: 13, earned: 2 }, achievements_hidden: false });
  renderPage();
  const pinned = await screen.findByTestId("profile-pinned-awards");
  expect(within(pinned).getByTestId("profile-pinned-matches_played_1")).toHaveTextContent("Spielmacher I");
  expect(within(pinned).getByTestId("profile-pinned-matches_played_1")).toHaveTextContent("Holz");
  fireEvent.click(screen.getByTestId("profile-tab-badges"));
  expect(await screen.findByTestId("profile-category-bar-match")).toHaveTextContent("1 von 2");
  expect(screen.getByTestId("profile-hidden-found")).toHaveTextContent("2 geheime Erfolge gefunden");
  expect(screen.getByTestId("achievement-groups")).toBeInTheDocument();
  expect(screen.queryByTestId("profile-achievements-private")).toBeNull();
});

test("private Erfolge: Hinweis statt Liste, keine Angehefteten", async () => {
  mockApiWithAchievements({ groups: [], awards: [], pinned: [], hidden: { total: 0, earned: 0 }, achievements_hidden: true });
  renderPage();
  expect(await screen.findByTestId("profile-achievements-private")).toHaveTextContent("Paula B. zeigt Erfolge nicht öffentlich.");
  expect(screen.queryByTestId("profile-pinned-awards")).toBeNull();
  fireEvent.click(screen.getByTestId("profile-tab-badges"));
  expect(await screen.findByText("Erfolge sind privat")).toBeInTheDocument();
  expect(screen.queryByTestId("achievement-groups")).toBeNull();
});

// Ehrungen (#848): eigener Reiter neben den Auszeichnungen - nur, wenn es freigegebene gibt.
test("Ehrungen: eigener Reiter für Mitglieder (#1149) - ohne freigegebene Ehrungen ein Satz, ohne Mitgliedschaft kein Reiter", async () => {
  mockApi();
  const { unmount } = renderPage();
  await screen.findByRole("heading", { level: 1 });
  fireEvent.click(screen.getByTestId("profile-tab-honours"));
  expect(screen.getByTestId("public-profile-honours-empty")).toHaveTextContent("Keine Ehrungen freigegeben.");
  unmount();

  apiMock.get.mockImplementation(async (url) => {
    if (url === "/users/public/paula") return { data: { ...PROFILE, is_club_member: false } };
    if (url === "/achievements/user/u1") return { data: ACHIEVEMENTS };
    return { data: [] };
  });
  const second = renderPage();
  await screen.findByRole("heading", { level: 1 });
  expect(screen.queryByTestId("profile-tab-honours")).toBeNull();
  second.unmount();

  const honour = { kind: "honorary", kind_label: "Ehrenmitgliedschaft", title: "Ehrenmitglied", years: 0, label: "Aufbau der Jugendarbeit", given_on: "2026-05-01" };
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/users/public/paula") return { data: { ...PROFILE, honours: [honour] } };
    if (url === "/achievements/user/u1") return { data: ACHIEVEMENTS };
    return { data: [] };
  });
  renderPage();
  const tab = await screen.findByTestId("profile-tab-honours");
  expect(tab).toHaveTextContent("Ehrungen (1)");
  fireEvent.click(tab);
  expect(screen.getByTestId("public-profile-honours")).toHaveTextContent("EhrenmitgliedschaftEhrenmitgliedAufbau der JugendarbeitVerliehen am 01.05.2026");
  expect(screen.getByTestId("public-profile-honours")).not.toHaveTextContent("Darf aufs Profil");
});



// Ein Profil, ein Aufbau (#1149): dieselben Reiter wie in der App, im eigenen Profil der Kasten „Nur für dich“, das
// Zahnrad zu den Einstellungen und der Schalter „So sehen dich andere“.
test("dieselben Reiter in derselben Reihenfolge wie in der App; „Erfolge“ statt „Achievements“", async () => {
  authState.user = null;
  mockApi();
  renderPage();
  await screen.findByRole("heading", { level: 1 });
  const tabs = ["overview", "badges", "awards", "references", "teams", "honours"].map((key) => screen.getByTestId(`profile-tab-${key}`).textContent.replace(/ \(\d+\)$/, ""));
  expect(tabs).toEqual(["Übersicht", "Erfolge", "Auszeichnungen", "Referenzen", "Teams", "Ehrungen"]);
  expect(screen.getByTestId("profile-stat-badges")).toHaveTextContent("Erfolge");
  expect(screen.queryByTestId("profile-private-box")).toBeNull();
  expect(screen.queryByTestId("profile-as-others")).toBeNull();
  expect(screen.queryByTestId("profile-settings")).toBeNull();
});

test("eigenes Profil: „Nur für dich“, Zahnrad, eigene Erfolge - und „So sehen dich andere“ zeigt nur das Öffentliche", async () => {
  authState.user = { id: "u1", username: "paula" };
  try {
    mockApi();
    renderPage();
    expect(await screen.findByTestId("profile-private-box")).toBeInTheDocument();
    expect(screen.getByTestId("profile-settings")).toHaveAttribute("href", "/profile");
    fireEvent.click(screen.getByTestId("profile-tab-badges"));
    expect(screen.getByTestId("profile-own-achievements")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("profile-as-others-switch"));
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/users/public/paula", { params: { view_as: "public" } }));
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByTestId("profile-private-box")).toBeNull();
    fireEvent.click(screen.getByTestId("profile-tab-badges"));
    expect(screen.queryByTestId("profile-own-achievements")).toBeNull();
  } finally {
    authState.user = null;
  }
});

test("?tab=achievements öffnet die Erfolge - auch die alten Links von /profile", async () => {
  authState.user = { id: "u1", username: "paula" };
  try {
    mockApi();
    render(
      <MemoryRouter initialEntries={["/u/paula?tab=achievements"]}>
        <Routes><Route path="/u/:username" element={<PublicProfilePage />} /></Routes>
      </MemoryRouter>
    );
    expect(await screen.findByTestId("profile-own-achievements")).toBeInTheDocument();
    expect(screen.getByTestId("profile-tab-badges").className).toMatch(/text-\[#29B6E8\]/);
  } finally {
    authState.user = null;
  }
});

// Lange Namen (#1218): auch im Spielerprofil höchstens zwei Zeilen, lange Namen eine Stufe kleiner.
test("Spielerprofil: ein Name mit 24 Zeichen kommt eine Stufe kleiner", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/users/public/paula") return { data: { ...PROFILE, display_name: "NachtfalkeDerSuperliga24" } };
    if (url === "/streams/live") return { data: [] };
    if (url === "/achievements/user/u1") return { data: ACHIEVEMENTS };
    return { data: [] };
  });
  renderPage();
  const name = await screen.findByTestId("profile-head-name");
  expect(name).toHaveTextContent("NachtfalkeDerSuperliga24");
  expect(name.className).toContain("tls-head-name tls-head-name--long");
  expect(name.className).toContain("text-2xl sm:text-3xl lg:text-4xl");
});
