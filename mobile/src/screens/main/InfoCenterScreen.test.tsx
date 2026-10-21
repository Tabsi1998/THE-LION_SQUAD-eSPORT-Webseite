import React from "react";
import { Linking } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
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

const setOptions = jest.fn();
const navigation = { navigate: jest.fn(), setOptions, getParent: () => ({ navigate: jest.fn() }) } as never;

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
    if (path === "/sponsors") {
      return Promise.resolve({ data: [
        { id: "s1", name: "Raiffeisen", tier: "main", logo_url: null, banner_url: "https://lionsquad.at/api/static/uploads/dolibarr-partner-7-banner-dark-abc.jpg" },
        { id: "s2", name: "Föger", tier: "bronze", logo_url: null },
        { id: "s3", name: "Omni FM", tier: "gold", logo_url: null },
      ] });
    }
    if (path === "/partners") {
      return Promise.resolve({ data: [{
        id: "pa-1", slug: "pineapps-esports", name: "PineApps eSports", kind: "Verein", link: "https://pineapps.at", description: "TFT-Community.",
        channels: [{ key: "website", label: "Website", url: "https://pineapps.at" }, { key: "twitch", label: "Twitch", url: "https://www.twitch.tv/pineapps", handle: "pineapps" }],
      }] });
    }
    if (path === "/users/public-list") {
      return Promise.resolve({ data: [{ id: "p-1", username: "Multimativ", user_type: "community_user", achievements_count: 0 }] });
    }
    return Promise.resolve({ data: [] });
  });
});

// Verein › Erfolge (#1945): die Referenzen im neuen Design (freigegebener Entwurf vom 21.10.2026) statt der alten Kacheln
// mit Nullen - Ehrentafel nur mit Werten über null, Vitrine, Chronik; eine Saison öffnet ihre Seite in der App.
test("Verein › Erfolge: Ehrentafel ohne Nullen, Vitrine und Chronik statt der alten Kacheln", async () => {
  await render(<InfoCenterScreen navigation={navigation} route={routeFor("references")} />);

  await waitFor(() => expect(screen.getByTestId("club-success")).toBeTruthy());
  // Kopfzeile „Erfolge“ (Entscheidung zu #1945), der Seitenkopf bleibt „Erfolge & Referenzen“.
  expect(setOptions).toHaveBeenCalledWith({ title: "Erfolge" });
  expect(screen.getByText("Erfolge & Referenzen")).toBeTruthy();
  expect(screen.getByText("Siege")).toBeTruthy();
  expect(screen.getByText("Zweite")).toBeTruthy();
  expect(screen.getByText("Dritte")).toBeTruthy();
  expect(screen.getByText("17 Teilnahmen · 5 Spiele · seit 2026")).toBeTruthy();
  expect(screen.getAllByText("Season #2 Newcomer Liga A").length).toBeGreaterThan(0);
  // Die alten Kacheln und der Satz über externe Turniere sind weg.
  expect(screen.queryByText("Lineup: HuEpfa, Munkehy")).toBeNull();
  expect(screen.queryByText("Podeste")).toBeNull();
  expect(screen.queryByText(/Externe Turniere und Ligen, bei denen/)).toBeNull();
  expect(screen.queryByText(/native App-Module/)).toBeNull();
});

test("eine Teilnahme mit Saison öffnet die Saison in der App", async () => {
  const base = mockGet.getMockImplementation() as (path: string) => Promise<unknown>;
  mockGet.mockImplementation((path: string) => (path === "/reference-series/public/lineages"
    ? Promise.resolve({ data: { items: [{ lineage: { slug: "desbl", title: "DeSBL", kind: "team_league" }, seasons: [{ season: "S2", season_slug: "s2", status: "completed", reference_ids: ["r-1"] }] }] } })
    : base(path)));
  await render(<InfoCenterScreen navigation={navigation} route={routeFor("references")} />);
  await waitFor(() => expect(screen.getByTestId("club-success-lineage-desbl")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("club-success-row-r-1"));
  expect((navigation as unknown as { navigate: jest.Mock }).navigate).toHaveBeenCalledWith("ReferenceSeason", { lineage: "desbl", season: "s2" });
});

test("ohne Referenzen bleibt der Hinweis, auch bei einem Array vom alten Server", async () => {
  mockGet.mockImplementation((path: string) => Promise.resolve({ data: path === "/references" ? [] : [] }));
  await render(<InfoCenterScreen navigation={navigation} route={routeFor("references")} />);

  await waitFor(() => expect(screen.getByText("Noch keine Referenzen")).toBeTruthy());
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

test("aus Mehr geöffnet ist der Bereich eine eigene Seite: Titel gesetzt, keine Verschiebeleiste", async () => {
  await render(<InfoCenterScreen navigation={navigation} route={routeFor("sponsors")} />);
  // MediaImage ist im Test leer; der Name steht im Zugänglichkeits-Label der Kachel.
  await waitFor(() => expect(screen.getByLabelText("Raiffeisen")).toBeTruthy());

  expect(setOptions).toHaveBeenCalledWith({ title: "Sponsoren" });
  expect(screen.queryByText("Partner")).toBeNull();
  expect(screen.queryByText("Vorteile")).toBeNull();
  // Stufen in Reihenfolge, Hauptsponsor zuerst (#244).
  expect(screen.getByText("Hauptsponsor")).toBeTruthy();
  expect(screen.getByText("Gold")).toBeTruthy();
  expect(screen.getByText("Bronze")).toBeTruthy();
  expect(screen.queryByText("Silber")).toBeNull();
  // Banner aus dem Vereinsmodul (#880) nur, wo es einen gibt.
  expect(screen.getByTestId("sponsor-banner-s1")).toBeTruthy();
  expect(screen.queryByTestId("sponsor-banner-s2")).toBeNull();
});

test("Erfolge nur, wenn es welche gibt", () => {
  expect(achievementLine({ achievements_count: 0 })).toBe("");
  expect(achievementLine({ achievements_count: 1 })).toBe("1 Erfolg");
  expect(achievementLine({ achievements_count: 3, achievement_points: 120 })).toBe("3 Erfolge · 120 Punkte");
});

test("Partner (#469): Kanäle als Chips und der Weg zur Partnerseite im Web", async () => {
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  await render(<InfoCenterScreen navigation={navigation} route={routeFor("partners")} />);
  await waitFor(() => expect(screen.getByText("PineApps eSports")).toBeTruthy());
  expect(screen.getByText("Twitch")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("partner-channel-pa-1-twitch"));
  expect(open).toHaveBeenLastCalledWith("https://www.twitch.tv/pineapps");
  await fireEvent.press(screen.getByTestId("partner-page-pa-1"));
  expect(open).toHaveBeenLastCalledWith(expect.stringMatching(/\/partners\/pineapps-esports$/));
  open.mockRestore();
});

test("Partner (#1934): „Ligen und Serien mit uns“ aus den Veranstaltern der Spuren - tippen öffnet die Saison", async () => {
  const base = mockGet.getMockImplementation() as (path: string) => Promise<unknown>;
  mockGet.mockImplementation((path: string) => (path === "/reference-series/public/lineages"
    ? Promise.resolve({ data: { items: [
      { lineage: { slug: "pine-tft", title: "PineApps TFT Masters", kind: "series", game_name: "Teamfight Tactics", organizers: [{ id: "pa-1", slug: "pineapps-esports", name: "PineApps eSports" }] },
        seasons: [{ season: "2025", season_slug: "2025", status: "completed" }, { season: "2026", season_slug: "2026", status: "active", club: { rank: 3, of: 12 } }] },
      { lineage: { slug: "andere", title: "Andere Liga", kind: "team_league" }, seasons: [{ season: "S1", season_slug: "s1", status: "active" }] },
    ] } })
    : base(path)));
  await render(<InfoCenterScreen navigation={navigation} route={routeFor("partners")} />);
  await waitFor(() => expect(screen.getByTestId("partner-series-pa-1")).toBeTruthy());
  expect(screen.getByText("Ligen und Serien mit uns")).toBeTruthy();
  expect(screen.getByText("Veranstalter: PineApps eSports · Turnierserie · Teamfight Tactics")).toBeTruthy();
  expect(screen.getByText("2026 · Stand: 3. von 12")).toBeTruthy();
  expect(screen.getByText("Läuft gerade")).toBeTruthy();
  expect(screen.queryByText("Andere Liga")).toBeNull();
  await fireEvent.press(screen.getByTestId("partner-series-pa-1-pine-tft"));
  expect((navigation as unknown as { navigate: jest.Mock }).navigate).toHaveBeenCalledWith("ReferenceSeason", { lineage: "pine-tft", season: "2026" });
});

// Ladefehler oder wirklich leer (#1001): leer heißt nur leer, wenn der Abruf geklappt hat.
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data: {} } });
const networkError = () => Object.assign(new Error("Network Error"), { isAxiosError: true });

test.each([
  ["Server-Fehler", () => httpError(500), "Laden hat nicht geklappt"],
  ["ohne Netz", networkError, "Ohne Netz"],
  ["nicht freigegeben", () => httpError(403), "Sponsoren nicht gefunden"],
])("Sponsoren beim ersten Laden: %s ist ein Ladefehler, nicht „Keine Sponsoren“ (#1001)", async (_label, error, title) => {
  const fallback = mockGet.getMockImplementation()!;
  mockGet.mockImplementation((path: string) => (path === "/sponsors" ? Promise.reject(error()) : fallback(path)));
  await render(<InfoCenterScreen navigation={navigation} route={routeFor("sponsors")} />);
  await waitFor(() => expect(screen.getByTestId("info-center-error")).toBeTruthy());
  expect(screen.getByText(title)).toBeTruthy();
  expect(screen.queryByText("Keine Sponsoren")).toBeNull();
});

test("Sponsoren wirklich leer: „Keine Sponsoren“ ohne Fehler (#1001)", async () => {
  const fallback = mockGet.getMockImplementation()!;
  mockGet.mockImplementation((path: string) => (path === "/sponsors" ? Promise.resolve({ data: [] }) : fallback(path)));
  await render(<InfoCenterScreen navigation={navigation} route={routeFor("sponsors")} />);
  await waitFor(() => expect(screen.getByText("Keine Sponsoren")).toBeTruthy());
  expect(screen.queryByTestId("info-center-error")).toBeNull();
});

test("andere Bereiche bleiben nutzbar, wenn einer scheitert (#1001)", async () => {
  const fallback = mockGet.getMockImplementation()!;
  mockGet.mockImplementation((path: string) => (path === "/sponsors" ? Promise.reject(httpError(500)) : fallback(path)));
  await render(<InfoCenterScreen navigation={navigation} route={routeFor("partners")} />);
  await waitFor(() => expect(screen.getByText("PineApps eSports")).toBeTruthy());
  expect(screen.queryByTestId("info-center-error")).toBeNull();
  expect(screen.queryByTestId("info-center-partial-load")).toBeNull();
});

test("Folgefehler: die Sponsoren bleiben stehen, ausdrücklich als letzter Stand (#1001)", async () => {
  const fallback = mockGet.getMockImplementation()!;
  await render(<InfoCenterScreen navigation={navigation} route={routeFor("sponsors")} />);
  await waitFor(() => expect(screen.getByTestId("sponsor-banner-s1")).toBeTruthy());
  mockGet.mockImplementation((path: string) => (path === "/sponsors" ? Promise.reject(networkError()) : fallback(path)));
  const [scroll] = screen.container.queryAll((node) => Boolean(node.props.refreshControl));
  await act(async () => {
    await scroll.props.refreshControl.props.onRefresh();
  });
  await waitFor(() => expect(screen.getByTestId("info-center-partial-load")).toBeTruthy());
  expect(screen.getByTestId("sponsor-banner-s1")).toBeTruthy();
  expect(screen.queryByTestId("info-center-error")).toBeNull();
});
