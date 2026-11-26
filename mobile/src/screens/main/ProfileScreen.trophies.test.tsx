import React from "react";
import { NavigationContext, NavigationRouteContext } from "@react-navigation/native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ProfileScreen } from "./ProfileScreen";
import { PublicProfileScreen } from "./PublicProfileScreen";
import * as leagueMoments from "../../lib/leagueMoments";

// Profil (#2173, Web: PublicProfilePage.jsx #2425, #2215): Reiter „Trophäen“ mit Vitrine, Embleme neben dem Namen (eigenes Profil wählt
// über PUT /api/me/awards/emblems), Platz in der Gesamtwertung. Ohne die neuen Felder (ältere Server) bleibt das Profil wie bisher.

const me = { id: "u-neon", username: "neonfalke", display_name: "NeonFalke", role: "player", is_club_member: false, created_at: "2023-03-01T10:00:00Z" };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: me, refreshMe: jest.fn(async () => undefined) }) }));
jest.mock("../../live", () => ({ isGuestUser: (user: unknown) => !user }));
const mockGet = jest.fn();
const mockPut = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: jest.fn(async () => ({ data: {} })), put: (...args: unknown[]) => mockPut(...args), delete: jest.fn(async () => ({ data: {} })) },
  errorMessage: (_error: unknown, fallback: string) => fallback,
  resolveMediaUrl: (value: string) => value,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/MediaImage", () => ({ MediaImage: () => null }));
jest.mock("../../components/FriendButton", () => ({ FriendButton: () => null }));
jest.mock("../../components/ReportSheet", () => ({ ReportSheet: () => null }));
jest.mock("../../components/Honours", () => ({ HonoursCard: () => null, HonourList: () => null }));
jest.mock("../../seasons/SeasonFinds", () => ({ PublicSeasonFindsCard: () => null }));
jest.mock("../../seasons/SeasonStage", () => ({ SeasonBackdropSlot: () => null, appNamesSeason: () => true }));
jest.mock("../../seasons/anchors", () => ({ SeasonPerch: () => null }));
jest.mock("../../achievements/profile/AchievementsTab", () => ({ AchievementsTab: () => null }));
jest.mock("../../achievements/profile/PublicAchievements", () => ({ PinnedAwardsCard: () => null, PublicAchievementsTab: () => null }));
jest.mock("./profile/TournamentPath", () => ({ RecordCard: () => null }));
jest.mock("../../navigation/rootNavigation", () => ({ openTab: jest.fn(), openDetail: jest.fn(), navigateToUrl: () => false, targetFromUrl: () => null }));

const emblem = (id: string, name: string) => ({
  id, kind: "trophy", rank: 1, rank_label: "1. Platz", date: "2026-11-12T20:00:00Z", tournament: { id: "staffel", title: "CoD-Liga · Season 1" },
  reward: { kind: "emblem", name, art: { season: "Season 1", metal: "gold" } },
});
const AWARDS = [emblem("e1", "Wappen"), emblem("e2", "Schild")];
const OVERALL = [{ league_name: "CoD-Liga", period_name: "2027", division_label: "Liga 1", level: 1, place: 1, of: 8, points: 24, closed: true, complete: true, url: null }];
const BASE_PROFILE = { ...me, privacy_public_profile: true, stats: {}, achievement_level: { level: 3 }, teams: [], references: { items: [] }, honours: [], relationship: { status: "self" } };

let ownAwards: Record<string, unknown>;
let publicProfile: Record<string, unknown>;

function answer(path: string) {
  const responses: Record<string, unknown> = {
    "/achievements/me": { groups: [], awards: [] },
    "/users/me/profile-completeness": { score: 100, missing: [] },
    "/mobile/profile/references": { items: [], stats: {} },
    "/me/awards": ownAwards,
    "/prizes/me": [],
    "/moderation/me/standing": null,
    "/account/invoices": { summary: null },
    "/account/documents": { available: false },
    "/teams/my": [],
    "/streams/live": [],
    "/achievements/user/u-neon": { awards: [], groups: [], pinned: [] },
    "/achievements/user/u-kiwi": { awards: [], groups: [], pinned: [] },
    "/users/public/neonfalke": publicProfile,
    "/users/public/kiwikomet": publicProfile,
  };
  return path in responses ? Promise.resolve({ data: responses[path] }) : Promise.reject(new Error(`unerwartet ${path}`));
}

const navigation = { navigate: jest.fn(), isFocused: () => true, addListener: () => () => {}, getParent: () => undefined, getState: () => undefined } as never;
const kiwiRoute = { key: "p", name: "PublicProfile", params: { username: "kiwikomet" } } as never;

beforeEach(() => {
  jest.clearAllMocks();
  ownAwards = { awards: AWARDS, featured_award_id: null, featured_title_award_id: null, featured_emblem_award_ids: ["e1"] };
  publicProfile = { ...BASE_PROFILE, awards: AWARDS, featured_emblems: [AWARDS[0]], league_overall: OVERALL };
  mockGet.mockImplementation(answer);
  mockPut.mockImplementation(async () => {
    ownAwards = { ...ownAwards, featured_emblem_award_ids: ["e1", "e2"] };
    return { data: { ok: true } };
  });
});

test("eigenes Profil: Embleme in der Vitrine wählen, der Kopf zeigt gleich den neuen Stand", async () => {
  await render(
    <NavigationContext.Provider value={navigation}>
      <ProfileScreen />
    </NavigationContext.Provider>,
  );
  await waitFor(() => expect(screen.getByTestId("profile-featured-emblems").props.accessibilityLabel).toBe("Embleme: Wappen"));
  // Der Platz in der Gesamtwertung steht in der Übersicht.
  expect(screen.getByTestId("profile-league-overall")).toBeTruthy();
  await fireEvent.press(screen.getByText("Trophäen"));
  expect(screen.getByTestId("profile-trophies-emblem-hint")).toHaveTextContent("Bis zu drei Embleme oder Medaillen stehen neben deinem Namen. 1 von 3 gewählt.");
  await fireEvent.press(screen.getByTestId("trophy-emblem-e2"));
  await waitFor(() => expect(mockPut).toHaveBeenCalledWith("/me/awards/emblems", { award_ids: ["e1", "e2"] }));
  await waitFor(() => expect(screen.getByTestId("profile-awards-message")).toHaveTextContent("Embleme gespeichert."));
  expect(screen.getByTestId("profile-featured-emblems").props.accessibilityLabel).toBe("Embleme: Wappen, Schild");
  expect(screen.getByTestId("trophy-emblem-e2")).toHaveTextContent("Emblem 2 ✓");
});

test("fremdes Profil: Embleme neben dem Namen, Gesamtwertung mit Gesamtsieger, Vitrine ohne Knöpfe", async () => {
  await render(<PublicProfileScreen navigation={navigation} route={kiwiRoute} />);
  await waitFor(() => expect(screen.getByTestId("profile-featured-emblems")).toBeTruthy());
  expect(screen.getByTestId("profile-league-overall-winner-0")).toHaveTextContent("Gesamtsieger");
  await fireEvent.press(screen.getByText("Trophäen"));
  expect(screen.getByTestId("profile-trophies")).toBeTruthy();
  expect(screen.queryByTestId("trophy-emblem-e1")).toBeNull();
  expect(screen.queryByTestId("profile-trophies-emblem-hint")).toBeNull();
});

test("ohne die neuen Felder (älterer Server) wie bisher: keine Embleme, keine Gesamtwertung", async () => {
  publicProfile = { ...BASE_PROFILE, awards: [] };
  await render(<PublicProfileScreen navigation={navigation} route={kiwiRoute} />);
  await waitFor(() => expect(screen.getByText("Spielerprofil")).toBeTruthy());
  expect(screen.queryByTestId("profile-featured-emblems")).toBeNull();
  expect(screen.queryByTestId("profile-league-overall")).toBeNull();
  expect(screen.queryByText("Trophäen")).toBeNull();
  // Eigenes Profil mit einem älteren Server: `/me/awards` ohne `featured_emblem_award_ids` - nichts neben dem Namen, Vitrine trotzdem.
  ownAwards = { awards: AWARDS };
  publicProfile = { ...BASE_PROFILE, awards: AWARDS };
  await render(
    <NavigationContext.Provider value={navigation}>
      <ProfileScreen />
    </NavigationContext.Provider>,
  );
  await waitFor(() => expect(screen.getByText("Trophäen")).toBeTruthy());
  expect(screen.queryByTestId("profile-featured-emblems")).toBeNull();
  await fireEvent.press(screen.getByText("Trophäen"));
  await waitFor(() => expect(screen.getByTestId("profile-trophies-emblem-hint")).toHaveTextContent(/0 von 3 gewählt/));
});

// Saisonende-Moment (#2584, docs/LIGA.md F.8): Hinweis „Saisonende“ im Profil (Feld `league_moments`), „Moment ansehen“ nur im eigenen.
const MOMENT_ROW = { id: "lm1", outcome: "up", title: "CoD-Liga · Season 2", url: "/liga/cod/season-2", badge_to: { level: 1 }, corrected: false,
  texts: { label: "Aufstieg", summary: "Löwen steigt von Liga 2 in Liga 1 auf." } };

test("Saisonende im eigenen Profil mit „Moment ansehen“ - der Weg aus der Nachricht holt den Moment gleich", async () => {
  const request = jest.spyOn(leagueMoments, "requestMoment");
  publicProfile = { ...BASE_PROFILE, league_moments: [MOMENT_ROW] };
  await render(
    <NavigationContext.Provider value={navigation}>
      <NavigationRouteContext.Provider value={{ key: "own", name: "OwnProfile", params: { moment: "lm1" } } as never}>
        <ProfileScreen />
      </NavigationRouteContext.Provider>
    </NavigationContext.Provider>,
  );
  await waitFor(() => expect(screen.getByTestId("profile-league-moments")).toBeTruthy());
  expect(screen.getByText("Löwen steigt von Liga 2 in Liga 1 auf.")).toBeTruthy();
  expect(screen.getByTestId("profile-league-moments-lm1-replay")).toBeTruthy();
  expect(request).toHaveBeenCalledWith("lm1");
  request.mockRestore();
});

test("Saisonende im fremden Profil: der Hinweis ohne „Moment ansehen“; ohne das Feld (älterer Server) nichts", async () => {
  publicProfile = { ...BASE_PROFILE, league_moments: [MOMENT_ROW] };
  await render(<PublicProfileScreen navigation={navigation} route={kiwiRoute} />);
  await waitFor(() => expect(screen.getByTestId("profile-league-moments")).toBeTruthy());
  expect(screen.queryByTestId("profile-league-moments-lm1-replay")).toBeNull();
  publicProfile = { ...BASE_PROFILE };
  await render(<PublicProfileScreen navigation={navigation} route={kiwiRoute} />);
  await waitFor(() => expect(screen.getByText("Spielerprofil")).toBeTruthy());
  expect(screen.queryByTestId("profile-league-moments")).toBeNull();
});
