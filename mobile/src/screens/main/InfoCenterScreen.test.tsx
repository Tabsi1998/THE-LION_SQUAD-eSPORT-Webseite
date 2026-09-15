import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
import { InfoCenterScreen, achievementLine } from "./InfoCenterScreen";

// Infocenter: Referenzen kommen als { items, summary } (#252), Rollen und
// Mitgliedschaft stehen als Begriff, nicht als Rohwert (#246).

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));
jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u-1", is_club_member: true, membership: { member_status: "active", membership_type: "ordinary" } } }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/MediaImage", () => ({ MediaImage: () => null }));

const navigation = { navigate: jest.fn(), getParent: () => ({ navigate: jest.fn() }) } as never;

function routeFor(section: string) {
  return { key: "info", name: "InfoCenter", params: { section } } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockImplementation((path: string) => {
    if (path === "/references") {
      return Promise.resolve({
        data: {
          items: [{
            id: "r-1",
            title: "Season #2 Newcomer Liga A",
            status: "completed",
            placement: 3,
            teams_count: 7,
            start_date: "2026-02-18",
            organizer: "DESBL",
            game: { display_name: "Call of Duty: Black Ops 7" },
            reference_meta: { platforms: [{ key: "ALL", label: "Alle Plattformen" }], title_segments: ["HC"] },
            lineup_members: [{ display_name: "HuEpfa" }, { display_name: "Munkehy" }],
            tournament_url: "https://desbl.de/liga",
          }],
          summary: { total: 17, active: 1, planned: 0, podiums: 6, gold: 1, silver: 1, bronze: 4, top10: 9, games: 5 },
        },
      });
    }
    if (path === "/users/public-list") {
      return Promise.resolve({ data: [{ id: "p-1", username: "Multimativ", user_type: "community_user", achievements_count: 0 }] });
    }
    return Promise.resolve({ data: [] });
  });
});

test("Referenzen aus { items, summary } erscheinen mit Platzierung, Spiel und Lineup", async () => {
  await render(<InfoCenterScreen navigation={navigation} route={routeFor("references")} />);

  await waitFor(() => expect(screen.getByText("Season #2 Newcomer Liga A")).toBeTruthy());
  expect(screen.getByText("3.")).toBeTruthy();
  expect(screen.getByText("7 Teams")).toBeTruthy();
  expect(screen.getByText("Call of Duty: Black Ops 7")).toBeTruthy();
  expect(screen.getByText("Lineup: HuEpfa, Munkehy")).toBeTruthy();
  expect(screen.getByText("17")).toBeTruthy();
  expect(screen.getByText("Teilnahmen")).toBeTruthy();
  expect(screen.queryByText("Keine Referenzen")).toBeNull();
  expect(screen.queryByText(/native App-Module/)).toBeNull();
});

test("ohne Referenzen bleibt der Hinweis, auch bei einem Array vom alten Server", async () => {
  mockGet.mockImplementation((path: string) => Promise.resolve({ data: path === "/references" ? [] : [] }));
  await render(<InfoCenterScreen navigation={navigation} route={routeFor("references")} />);

  await waitFor(() => expect(screen.getByText("Keine Referenzen")).toBeTruthy());
});

test("Mitgliedschaft und Rolle stehen als Begriff", async () => {
  await render(<InfoCenterScreen navigation={navigation} route={routeFor("benefits")} />);
  await waitFor(() => expect(screen.getByText("Mitgliedschaft aktiv")).toBeTruthy());
  expect(screen.getByText("Aktiv")).toBeTruthy();
  expect(screen.getByText(/Ordentliches Mitglied/)).toBeTruthy();
  expect(screen.queryByText(/\(ordinary\)/)).toBeNull();
  expect(screen.queryByText(/Adminbereich/)).toBeNull();

  await render(<InfoCenterScreen navigation={navigation} route={routeFor("profiles")} />);
  await waitFor(() => expect(screen.getByText("@Multimativ · Community")).toBeTruthy());
  expect(screen.queryByText(/community_user/)).toBeNull();
  expect(screen.queryByText(/Achievements/)).toBeNull();
});

test("Erfolge nur, wenn es welche gibt", () => {
  expect(achievementLine({ achievements_count: 0 })).toBe("");
  expect(achievementLine({ achievements_count: 1 })).toBe("1 Erfolg");
  expect(achievementLine({ achievements_count: 3, achievement_points: 120 })).toBe("3 Erfolge · 120 Punkte");
});
