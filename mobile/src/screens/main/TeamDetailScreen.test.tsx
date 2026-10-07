import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { TeamDetailScreen } from "./TeamDetailScreen";

// Gast zuerst (#918): Team-Chat und Beitritt brauchen ein Konto - als Gast statt eines Fehlers gleich der Weg dorthin.

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
  errorMessage: (_error: unknown, fallback: string) => fallback,
}));
// Ein festes Objekt je Fall: der Screen lädt neu, wenn sich `user` ändert.
const GUEST = jest.requireActual("../../live").liveGuestUser;
const MEMBER = { id: "u-1", username: "paula" };
const mockAuth: { user: Record<string, unknown> } = { user: GUEST };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
const mockOpenSignIn = jest.fn();
jest.mock("../../navigation/rootNavigation", () => ({ openSignIn: (...args: unknown[]) => mockOpenSignIn(...args) }));
jest.mock("../../seasons/anchors", () => ({ useSeasonOverlay: () => null, SeasonPerch: () => null, SeasonAnchor: ({ children }: { children?: React.ReactNode }) => children ?? null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const navigate = jest.fn();
const setParams = jest.fn();
const navigation = { navigate, setOptions: jest.fn(), setParams } as never;
const route = { key: "team", name: "TeamDetail", params: { id: "t1" } } as never;
const TEAM = { id: "t1", name: "Lions", tag: "TLS", members: [], member_ids: [], is_member: false };

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockImplementation((path: string) => Promise.resolve({ data: path.endsWith("/squads") ? [] : TEAM }));
});

test("als Gast: „Anmelden oder registrieren“ statt Team-Chat und Beitritt", async () => {
  mockAuth.user = GUEST;
  await render(<TeamDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("team-sign-in")).toBeTruthy());
  expect(screen.getByText("Team-Chat und Beitritt gibt es mit einem Konto.")).toBeTruthy();
  expect(screen.queryByText("Team-Chat öffnen")).toBeNull();
  expect(screen.queryByText("Team beitreten")).toBeNull();
  await fireEvent.press(screen.getByTestId("team-sign-in"));
  expect(mockOpenSignIn).toHaveBeenCalledTimes(1);
});

test("mit Konto wie bisher: Team-Chat öffnen und beitreten mit Code", async () => {
  mockAuth.user = MEMBER;
  await render(<TeamDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Team-Chat öffnen")).toBeTruthy());
  expect(screen.getByText("Team beitreten")).toBeTruthy();
  expect(screen.queryByTestId("team-sign-in")).toBeNull();
});

// Team-Seite (#1191): Termine und letzte Spiele aus den Team-Anmeldungen, Einladungs-Link mit QR-Code.
const OVERVIEW = {
  upcoming: [{ registration_id: "r-1", status: "approved", status_label: "Angemeldet", tournament: { id: "tt-1", slug: "rl-herbst", title: "Rocket League Herbst-Cup", start_date: "2026-10-17T14:00:00Z", event_name: "Herbst-LAN" } }],
  recent: [
    { match_id: "m-1", kind: "duel", outcome: "win", score: "3:1", opponent: "Pixelpiraten", round_label: "Finale", tournament: { title: "Liga Herbst" } },
    { match_id: "m-2", kind: "duel", outcome: "loss", score: "1:2", opponent: "Team Kaktus", round_label: "Halbfinale", tournament: { title: "Liga Herbst" } },
  ],
};

function serve(team: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  mockGet.mockImplementation((path: string) => {
    if (path in extra) return Promise.resolve({ data: extra[path] });
    if (path.endsWith("/squads")) return Promise.resolve({ data: [] });
    if (path.endsWith("/overview")) return Promise.resolve({ data: OVERVIEW });
    return Promise.resolve({ data: team });
  });
}

test("Angemeldet für und Letzte Spiele mit Sieg und Niederlage; Tippen öffnet Turnier und Spiel", async () => {
  mockAuth.user = MEMBER;
  serve({ ...TEAM, is_member: true, member_ids: ["u-1"] });
  await render(<TeamDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("team-upcoming")).toBeTruthy());
  expect(screen.getByText("Rocket League Herbst-Cup")).toBeTruthy();
  expect(screen.getByText("3:1 gegen Pixelpiraten")).toBeTruthy();
  expect(screen.getByTestId("team-recent-outcome-m-1")).toHaveTextContent("SIEG");
  expect(screen.getByTestId("team-recent-outcome-m-2")).toHaveTextContent("NIEDERLAGE");
  await fireEvent.press(screen.getByTestId("team-upcoming-r-1"));
  expect(navigate).toHaveBeenCalledWith("TournamentDetail", { id: "rl-herbst" });
  await fireEvent.press(screen.getByTestId("team-recent-m-2"));
  expect(navigate).toHaveBeenCalledWith("MatchDetail", { id: "m-2" });
});

test("Kapitän: Einladen mit QR-Code und Link teilen, Join-Code als Rückfall", async () => {
  mockAuth.user = MEMBER;
  serve({ ...TEAM, is_member: true, can_manage: true, leader_id: "u-1", member_ids: ["u-1"], join_code: "Kx7pQ2" }, {
    "/teams/t1/invite-link": { url: "https://lionsquad.at/teams/t1?einladung=AbC123", token: "AbC123" },
  });
  await render(<TeamDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("team-invite-qr")).toBeTruthy());
  expect(screen.getByText("Kx7pQ2")).toBeTruthy();
  expect(screen.getByTestId("team-invite-share")).toBeTruthy();
});

test("Einladungs-Link: oben „Beitreten“, ein Tipp und man ist drin", async () => {
  mockAuth.user = MEMBER;
  serve(TEAM, { "/teams/t1/invite-link/check": { valid: true, already_member: false, team: { name: "Lions", member_count: 3 } } });
  mockPost.mockResolvedValue({ data: { ok: true } });
  const inviteRoute = { key: "team", name: "TeamDetail", params: { id: "t1", invite: "AbC123" } } as never;
  await render(<TeamDetailScreen navigation={navigation} route={inviteRoute} />);
  await waitFor(() => expect(screen.getByText("Du bist eingeladen: Lions")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("team-join-invite-submit"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/teams/t1/join-link", { token: "AbC123" }));
  expect(setParams).toHaveBeenCalledWith({ invite: undefined });
});

// Wappen-Kopf (#1347): Band in der Team-Farbe, Logo-Platzhalter mit Kürzel, eine Zeile mit Spiel und Level,
// Gesichter mit Rolle - du mit Ecken-Klammern; die Farbe wählt der Kapitän beim Bearbeiten.
const CREW = {
  ...TEAM,
  tag: "LRK",
  leader_id: "u-cap",
  co_leader_ids: ["u-co"],
  member_ids: ["u-1", "u-co", "u-cap"],
  members: [
    { id: "u-1", username: "paula", display_name: "Paula" },
    { id: "u-co", username: "pixelpanther", display_name: "PixelPanther" },
    { id: "u-cap", username: "neonfalke", display_name: "NeonFalke" },
  ],
  is_member: true,
};

test("Kopf: Name, Kürzel, Spiel und Level; Gesichter Kapitän zuerst, du mit Ecken-Klammern", async () => {
  mockAuth.user = MEMBER;
  serve(CREW, {
    "/teams/t1/overview": { ...OVERVIEW, header: { color: "violet", color_hex: "#6A47B8", color_source: "team", game: { id: "g", name: "Rocket League" } } },
    "/teams/t1/level": { level: 9, crown: "gold" },
  });
  await render(<TeamDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("team-header")).toBeTruthy());
  expect(screen.getByTestId("team-name")).toHaveTextContent("Lions");
  expect(screen.getByTestId("team-header-line")).toHaveTextContent("LRK·Rocket League·Level 9");
  const faces = screen.getAllByTestId(/^team-face-u-/).map((node) => node.props.testID);
  expect(faces).toEqual(["team-face-u-cap", "team-face-u-co", "team-face-u-1"]);
  expect(screen.getByTestId("team-face-role-u-cap")).toHaveTextContent("KAPITÄN");
  expect(screen.getByTestId("team-face-role-u-co")).toHaveTextContent("CO-KAPITÄN");
  expect(screen.getByTestId("team-face-role-u-1")).toHaveTextContent("SPIELER");
  expect(screen.getAllByTestId("team-face-you")).toHaveLength(1);
  await fireEvent.press(screen.getByTestId("team-face-u-co"));
  expect(navigate).toHaveBeenCalledWith("PublicProfile", { username: "pixelpanther" });
  expect(screen.queryByTestId("team-manage-members")).toBeNull();
});

test("Kapitän wählt die Team-Farbe beim Bearbeiten", async () => {
  mockAuth.user = { id: "u-cap", username: "neonfalke" };
  const mockPatch = jest.fn().mockResolvedValue({ data: {} });
  const api = jest.requireMock("../../lib/api").api as Record<string, unknown>;
  api.patch = mockPatch;
  serve({ ...CREW, can_manage: true, color: "auto" }, { "/teams/t1/invite-link": { url: "https://lionsquad.at/teams/t1?einladung=x1", token: "x1" } });
  await render(<TeamDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("team-manage-members")).toBeTruthy());
  await fireEvent.press(screen.getByText("Team bearbeiten"));
  await fireEvent.press(screen.getByTestId("team-color-green"));
  await fireEvent.press(screen.getByText("Team speichern"));
  await waitFor(() => expect(mockPatch).toHaveBeenCalledWith("/teams/t1", expect.objectContaining({ color: "green" })));
});
