import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { MatchDetailScreen } from "./MatchDetailScreen";

// Liga-Ergebnis mit Maps in der App (#2173, docs/LIGA.md C.3): Captain und Vertreter melden je Map Modus, Map (aus dem Veto fest),
// Sieger, Punkte und Aufstellung; die Gegenseite bestätigt mit ihrer Aufstellung. Wer nicht handeln darf, sieht nur die Meldung.
// Ohne Block `league` (ältere Server) bleibt das Meldeformular ohne Maps. Wie im Web: LeagueReportForm.test.jsx. Erfundene Namen.

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args), patch: jest.fn() },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
  resolveMediaUrl: (url: string) => url,
}));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", username: "neon" } }) }));
jest.mock("../../live", () => ({ isGuestUser: () => false }));
jest.mock("../../lib/chats", () => ({ markChatRead: jest.fn(async () => undefined) }));
jest.mock("../../lib/cache", () => ({ ...jest.requireActual("../../lib/cache"), invalidateCache: jest.fn(async () => undefined) }));
jest.mock("../../realtime/LiveChangesProvider", () => ({ useLiveRefresh: () => undefined }));
jest.mock("../../components/CommendButton", () => ({ CommendButton: () => null }));
jest.mock("../../components/ChatStickers", () => ({ MessageSticker: () => null, StickerButton: () => null, StickerPicker: () => null }));
jest.mock("../../components/MediaImage", () => ({ MediaImage: () => null }));
jest.mock("react-native-safe-area-context", () => ({ ...jest.requireActual("react-native-safe-area-context"), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
}));
jest.mock("react-native-keyboard-controller", () => {
  const { View } = jest.requireActual("react-native");
  return { KeyboardAvoidingView: View };
});
jest.mock("@react-navigation/native", () => {
  const { useEffect } = jest.requireActual("react");
  return {
    ...jest.requireActual("@react-navigation/native"),
    useFocusEffect: (effect: () => void) => useEffect(() => effect(), [effect]),
    useIsFocused: () => true,
  };
});

const navigation = { navigate: jest.fn() } as never;
const route = { key: "m", name: "MatchDetail", params: { id: "m1" } } as never;

const SIDES = [{ registration_id: "r1", name: "Löwen · Rudel A" }, { registration_id: "r2", name: "Falken · Horst" }];
const POOL = {
  id: "pool",
  modes: [
    { mode: "stellung", label: "Stellung", maps: [{ map_id: "hafen", name: "Hafen" }, { map_id: "nebel", name: "Nebel" }] },
    { mode: "suchen", label: "Suchen", maps: [{ map_id: "turm", name: "Turm" }] },
  ],
};
const LEAGUE = {
  lineup_mode: "per_map", best_of: 3, needed: 2, team_size: 2, mode_order: ["stellung", "suchen"], pool: POOL, sides: SIDES,
  own_registration_id: "r1", roster: [{ id: "p1", name: "Anna" }, { id: "p2", name: "Ben" }, { id: "p3", name: "Cem", lineup_blocked: "Spiel-ID fehlt" }],
  planned_games: [], own_games: [], proposal_games: [], games: [], map_repeat: "other_mode", result_rules: {}, scores_required: false, own_lineup: [],
};
const BASE = {
  tournament: { id: "t1", slug: "liga", title: "Liga 1 · Staffel A" },
  match: { id: "m1", match_key: "S1", status: "scheduled", slots: [{ slot: 1, registration_id: "r1" }, { slot: 2, registration_id: "r2" }] },
  participants: [{ slot: 1, registration_id: "r1", display_name: "Löwen · Rudel A" }, { slot: 2, registration_id: "r2", display_name: "Falken · Horst" }],
  matchday_label: "Spieltag 1", schedule_proposals: [], collection: "matches_v2", can_act: true,
  can_report_score: true, can_player_report_result: true, can_submit_result: false, can_staff_submit_result: false,
  can_dispute: true, allows_draw: false, event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal",
  report_state: { status: "open" }, league: LEAGUE,
};

function answer(page: Record<string, unknown>) {
  mockGet.mockImplementation(async (path: string) => {
    if (path === "/matches/m1/page") return { data: page };
    return { data: [] };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPost.mockResolvedValue({ data: { awaiting_confirmation: true } });
});

async function open(page: Record<string, unknown>) {
  answer(page);
  await render(<MatchDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("match-report")).toBeTruthy());
}

test("Veto-Reihenfolge: Modus und Map je Position stehen fest - Sieger, Punkte und Aufstellung gehen mit den Maps an /report", async () => {
  await open({ ...BASE, league: { ...LEAGUE, planned_games: [
    { position: 1, mode: "stellung", mode_label: "Stellung", map_id: "nebel", map_name: "Nebel", role: "picked", by_registration_id: "r1" },
    { position: 2, mode: "suchen", mode_label: "Suchen", map_id: "turm", map_name: "Turm", role: "picked", by_registration_id: "r2" },
    { position: 3, mode: "stellung", mode_label: "Stellung", map_id: "hafen", map_name: "Hafen", role: "decider", by_registration_id: null },
  ] } });
  expect(screen.getByTestId("league-game-1-planned")).toHaveTextContent(/Nebel/);
  // Keine Map-Auswahl, wenn das Veto sie festgelegt hat.
  expect(screen.queryByTestId("league-game-1-map-hafen")).toBeNull();
  // Ohne Sieger und Aufstellung geht nichts raus - der Satz sagt, was fehlt.
  await fireEvent.press(screen.getByTestId("match-report-submit"));
  expect(screen.getByTestId("match-report-error")).toHaveTextContent("Map 1: bitte antippen, wer die Map gewonnen hat.");
  expect(mockPost).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId("league-game-1-winner-r1"));
  // Gesperrte Spieler lassen sich nicht aufstellen.
  expect(screen.getByTestId("league-game-1-lineup-blocked")).toHaveTextContent("Nicht aufstellbar: Cem – Spiel-ID fehlt");
  await fireEvent.press(screen.getByTestId("league-game-1-lineup-p3"));
  await fireEvent.press(screen.getByTestId("league-game-1-lineup-p1"));
  await fireEvent.press(screen.getByTestId("league-game-1-lineup-p2"));
  // Map 2 kommt mit dem Sieger von Map 1 und übernimmt die Aufstellung.
  await waitFor(() => expect(screen.getByTestId("league-game-2-planned")).toHaveTextContent(/Turm/));
  expect(screen.getByTestId("league-game-2-lineup-count")).toHaveTextContent("2/2");
  await fireEvent.press(screen.getByTestId("league-game-2-winner-r1"));
  expect(screen.getByTestId("match-report-sentence")).toHaveTextContent("Löwen · Rudel A gewinnt 2:0");
  // Die Serie ist entschieden: keine dritte Map.
  expect(screen.queryByTestId("league-game-3")).toBeNull();
  await fireEvent.press(screen.getByTestId("match-report-submit"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/matches/m1/report", {
    results: [{ registration_id: "r1", rank: 1, score: 2 }, { registration_id: "r2", rank: 2, score: 0 }],
    games: [
      { position: 1, mode: "stellung", map_id: "nebel", winner_registration_id: "r1", lineup: ["p1", "p2"] },
      { position: 2, mode: "suchen", map_id: "turm", winner_registration_id: "r1", lineup: ["p1", "p2"] },
    ],
    screenshot_url: null,
    note: null,
  }));
});

test("ohne Veto: Map aus dem Pool antippen, die Punkte ergeben den Sieger, die Regel des Modus steht dabei", async () => {
  await open({ ...BASE, league: { ...LEAGUE, best_of: 1, needed: 1, team_size: 1, mode_order: [], pool: { id: "p", modes: [POOL.modes[0]] },
    scores_required: true, result_rules: { stellung: { kind: "score", target: 250 } } } });
  expect(screen.getByTestId("league-game-1-rule")).toHaveTextContent("Gewertet: bis 250 Punkte");
  await fireEvent.press(screen.getByTestId("league-game-1-map-hafen"));
  expect(screen.getByTestId("league-game-1-winner-pending")).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId("league-game-1-score-r1"), "180");
  await fireEvent.changeText(screen.getByTestId("league-game-1-score-r2"), "260");
  // Über dem Ziel: dieselbe Vorabprüfung wie der Server.
  expect(screen.getByTestId("match-report-sentence")).toHaveTextContent("Map 1: höchstens 250 Punkte – die Map endet beim Ziel (Endstand 260:180).");
  await fireEvent.changeText(screen.getByTestId("league-game-1-score-r2"), "250");
  expect(screen.getByTestId("league-game-1-winner-auto")).toHaveTextContent(/Falken · Horst/);
  await fireEvent.press(screen.getByTestId("league-game-1-lineup-p1"));
  await fireEvent.press(screen.getByTestId("match-report-submit"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/matches/m1/report", expect.objectContaining({
    games: [{ position: 1, mode: "stellung", map_id: "hafen", winner_registration_id: "r2", scores: { r1: 180, r2: 250 }, lineup: ["p1"] }],
  })));
});

test("Bestätigen: die Maps der Gegenseite, je Map die eigene Aufstellung - ohne Aufstellung kein Absenden", async () => {
  await open({ ...BASE, report_state: { status: "confirm", proposal_by: "Horst-Captain", can_confirm: true }, league: { ...LEAGUE, proposal_games: [
    { position: 1, mode: "stellung", mode_label: "Stellung", map_id: "hafen", map_name: "Hafen", winner_registration_id: "r2", scores: { r1: 3, r2: 6 } },
    { position: 2, mode: "suchen", mode_label: "Suchen", map_id: "turm", map_name: "Turm", winner_registration_id: "r2" },
  ] } });
  expect(screen.getByTestId("league-games-summary-1")).toHaveTextContent(/Hafen \(Stellung\).*Falken · Horst.*3:6/);
  await fireEvent.press(screen.getByTestId("match-report-confirm"));
  expect(screen.getByTestId("league-confirm-error")).toHaveTextContent("Map 1: bitte genau 2 Spieler aufstellen.");
  expect(mockPost).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId("league-confirm-lineup-1-p1"));
  await fireEvent.press(screen.getByTestId("league-confirm-lineup-1-p2"));
  // Map 2 zieht mit, solange sie gleich war.
  expect(screen.getByTestId("league-confirm-lineup-2-count")).toHaveTextContent("2/2");
  await fireEvent.press(screen.getByTestId("match-report-confirm"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/matches/m1/report", {
    results: [{ registration_id: "r2", rank: 1, score: 2 }, { registration_id: "r1", rank: 2, score: 0 }],
    games: [
      { position: 1, mode: "stellung", map_id: "hafen", winner_registration_id: "r2", lineup: ["p1", "p2"] },
      { position: 2, mode: "suchen", map_id: "turm", winner_registration_id: "r2", lineup: ["p1", "p2"] },
    ],
    screenshot_url: null,
    note: null,
  }));
  // „Stimmt nicht“ führt wie bisher zu „Problem melden“.
  expect(screen.getByTestId("match-report-wrong")).toBeTruthy();
});

test("Teilnehmerliste je Spiel (series): melden mit Liste, Mindestzahl wird geprüft", async () => {
  await open({ ...BASE, league: { ...LEAGUE, lineup_mode: "series", lineup_min_players: 2, best_of: 1, needed: 1, mode_order: ["stellung"] } });
  await fireEvent.press(screen.getByTestId("league-game-1-map-hafen"));
  await fireEvent.press(screen.getByTestId("league-game-1-winner-r1"));
  expect(screen.queryByTestId("league-game-1-lineup")).toBeNull();
  await fireEvent.press(screen.getByTestId("league-participants-p1"));
  await fireEvent.press(screen.getByTestId("match-report-submit"));
  expect(screen.getByTestId("match-report-error")).toHaveTextContent("Bitte mindestens 2 Personen ankreuzen, die gespielt haben.");
  await fireEvent.press(screen.getByTestId("league-participants-p2"));
  await fireEvent.press(screen.getByTestId("match-report-submit"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/matches/m1/report", expect.objectContaining({
    lineup: ["p1", "p2"], games: [{ position: 1, mode: "stellung", map_id: "hafen", winner_registration_id: "r1" }],
  })));
});

// Rechte (negativ): Wer nicht Captain oder Vertreter ist, bekommt kein Formular und keinen „Stimmt“-Knopf.
test("Mitglied ohne Captain-Recht: sieht die Meldung der Gegenseite, kann aber weder melden noch bestätigen", async () => {
  answer({ ...BASE, can_report_score: false, can_player_report_result: false, can_dispute: false,
    report_state: { status: "confirm", can_confirm: false },
    league: { ...LEAGUE, proposal_games: [{ position: 1, mode: "stellung", map_id: "hafen", map_name: "Hafen", winner_registration_id: "r2" }] } });
  await render(<MatchDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("match-report-lead-confirms")).toHaveTextContent("Bestätigen können Captain und Vertreter."));
  expect(screen.queryByTestId("match-report-confirm")).toBeNull();
  expect(screen.queryByTestId("match-report-form")).toBeNull();
  expect(screen.queryByTestId("league-confirm-lineup-1")).toBeNull();
});

test("Zuschauer ohne Recht und ohne Meldung: kein Meldeformular mit Maps", async () => {
  answer({ ...BASE, can_act: false, can_report_score: false, can_player_report_result: false, can_dispute: false, report_state: null });
  await render(<MatchDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("match-headline")).toBeTruthy());
  expect(screen.queryByTestId("match-report")).toBeNull();
  expect(screen.queryByTestId("league-game-1")).toBeNull();
});

test("älterer Server ohne Block `league`: das Meldeformular ohne Maps wie bisher", async () => {
  await open({ ...BASE, league: undefined });
  expect(screen.queryByTestId("league-game-1")).toBeNull();
  expect(screen.getByTestId("match-report-form")).toBeTruthy();
});
