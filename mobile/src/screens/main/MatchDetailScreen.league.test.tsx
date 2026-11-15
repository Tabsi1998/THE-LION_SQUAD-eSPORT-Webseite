import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { MatchDetailScreen } from "./MatchDetailScreen";

// Liga-Spieltag in der App (#2173, docs/LIGA.md D.2-D.4): Check-in der eigenen Seite, Start, Map-Veto live mit Zug als Captain,
// „Bereit zum Veto“, der Matchablauf als Schild im Kopf und der Satz statt des Meldeformulars. Dieselben Wege wie im Web
// (MatchPage.checkin.test.jsx, MatchPage.vetoLive.test.jsx); ohne `checkin` (ältere Server, andere Formate) bleibt alles wie vorher.

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

const RULES = { opens_minutes_before: 15, closes_minutes_after: 15, min_present: 2, remind_minutes_before_close: 5 };
const OWN = { registration_id: "r1", name: "Löwen", own: true, checked_in: false, present: [], present_count: 0 };
const OTHER = { registration_id: "r2", name: "Falken", own: false, checked_in: false, present: [], present_count: 0 };
const ROSTER = [{ id: "p1", name: "Anna", blocked: null }, { id: "p2", name: "Ben", blocked: null }, { id: "p3", name: "Cem", blocked: "Spiel-ID fehlt" }];
const soon = (minutes: number) => new Date(Date.now() + minutes * 60 * 1000).toISOString();

function checkin(extra: Record<string, unknown> = {}) {
  return {
    rules: RULES, state: "open", scheduled_at: soon(10), window: { opens_at: soon(-5), closes_at: soon(25) }, sides: [OWN, OTHER],
    own_registration_id: "r1", can_checkin: true, checkin_hint: null, roster: ROSTER, roster_hint: null, me: null, min_present: 2,
    can_start: false, start_hint: null, proposal: null, lead: null, veto: null, ...extra,
  };
}

const BASE = {
  tournament: { id: "t1", slug: "liga", title: "Liga 1 · Staffel A" },
  match: { id: "m1", match_key: "S1", status: "scheduled", scheduled_at: soon(10), slots: [{ slot: 1, registration_id: "r1" }, { slot: 2, registration_id: "r2" }] },
  participants: [{ slot: 1, registration_id: "r1", display_name: "Löwen" }, { slot: 2, registration_id: "r2", display_name: "Falken" }],
  matchday_label: "Spieltag 1", schedule_proposals: [], collection: "matches_v2", can_act: true,
  can_report_score: true, can_player_report_result: true, can_submit_result: false, can_staff_submit_result: false,
  can_dispute: false, allows_draw: false, event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal",
  report_state: { status: "open" },
};

function answer(page: Record<string, unknown>, live?: () => Record<string, unknown>) {
  mockGet.mockImplementation(async (path: string) => {
    if (path === "/matches/m1/page") return { data: page };
    if (path === "/matches/m1/veto" && live) return { data: live() };
    return { data: [] };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPost.mockResolvedValue({ data: {} });
});


test("Check-in: Stand im Kopf, Anwesende anhaken (gesperrte grau mit Grund), erst ab der Mindestzahl einchecken", async () => {
  answer({ ...BASE, checkin: checkin(), report_hint: "Melden geht erst, wenn beide Seiten für diesen Termin eingecheckt sind – eure Seite / Falken hat noch nicht eingecheckt." });
  await render(<MatchDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("checkin-panel")).toBeTruthy());
  expect(screen.getByTestId("match-flow-state")).toHaveTextContent("Check-in offen");
  expect(screen.getByTestId("checkin-headline")).toHaveTextContent("Check-in offen");
  expect(screen.getByTestId("checkin-text")).toHaveTextContent("Hakt an, wer da ist (mindestens 2)", { exact: false });
  // Erst einchecken, dann melden: der Satz des Servers statt des Formulars.
  expect(screen.getByTestId("match-report-hint")).toHaveTextContent("Melden geht erst, wenn beide Seiten", { exact: false });
  expect(screen.queryByTestId("match-report-form")).toBeNull();
  // Gesperrt: nicht wählbar, Grund im Klartext.
  expect(screen.getByText("Spiel-ID fehlt")).toBeTruthy();
  expect(screen.getByTestId("checkin-submit")).toBeDisabled();
  await fireEvent.press(screen.getByTestId("checkin-roster-p3"));
  expect(screen.getByTestId("checkin-roster-count")).toHaveTextContent("0 angehakt – noch 2 Personen bis zur Mindestzahl 2.");
  await fireEvent.press(screen.getByTestId("checkin-roster-p1"));
  await fireEvent.press(screen.getByTestId("checkin-roster-p2"));
  expect(screen.getByTestId("checkin-roster-count")).toHaveTextContent("2 angehakt – das reicht (mindestens 2).");
  mockPost.mockResolvedValueOnce({ data: { ready: false } });
  await fireEvent.press(screen.getByTestId("checkin-submit"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/matches/m1/checkin", { present: ["p1", "p2"] }));
  await waitFor(() => expect(screen.getByText("Eingecheckt – jetzt fehlt noch die Gegenseite.")).toBeTruthy());
});

test("geht der Check-in nicht, steht der Grund vor der Liste - ohne Knopf", async () => {
  answer({ ...BASE, checkin: checkin({ state: "waiting", can_checkin: false, checkin_hint: "Der Check-in öffnet erst um 19:45." }) });
  await render(<MatchDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("checkin-hint")).toHaveTextContent("Der Check-in öffnet erst um 19:45."));
  expect(screen.queryByTestId("checkin-submit")).toBeNull();
  expect(screen.getByTestId("checkin-countdown")).toBeTruthy();
});

test("spielbereit: eine Seite startet Map 1", async () => {
  const sides = [{ ...OWN, checked_in: true, present_count: 2 }, { ...OTHER, checked_in: true, present_count: 3 }];
  answer({ ...BASE, checkin: checkin({ state: "ready", sides, can_start: true }) });
  await render(<MatchDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("checkin-start-button")).toBeTruthy());
  expect(screen.getByTestId("match-flow-state")).toHaveTextContent("Spielbereit");
  expect(screen.queryByTestId("checkin-own")).toBeNull();
  await fireEvent.press(screen.getByTestId("checkin-start-button"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/matches/m1/checkin/start", {}));
  await waitFor(() => expect(screen.getByText("Gestartet – Map 1 läuft. Viel Erfolg!")).toBeTruthy());
});

const REMAINING = [
  { mode: "hp", label: "Stellung", maps: [
    { map_id: "glut", name: "Glut", image_url: null, status: "open", by_name: null, position: null, side: null },
    { map_id: "hafen", name: "Hafen", image_url: null, status: "banned", by_name: "Falken", position: null, side: "B" },
  ] },
];

function vetoBlock(extra: Record<string, unknown> = {}) {
  return {
    status: "running", version: 3, step_seconds: 60, server_now: new Date().toISOString(),
    team_a: { registration_id: "r1", name: "Löwen", via: "home" }, team_b: { registration_id: "r2", name: "Falken" },
    current: { index: 2, number: 3, total: 5, kind: "ban", mode: "hp", mode_label: "Stellung", registration_id: "r1", name: "Löwen", position: null, deadline_at: soon(0.5) },
    own_turn: true, can_pick: true, pick_hint: null, own_side: "A",
    options: [{ map_id: "glut", name: "Glut", allowed: true, hint: null }, { map_id: "hafen", name: "Hafen", allowed: false, hint: "Hafen ist schon gesperrt." }],
    remaining: REMAINING, history: [{ index: 0, kind: "ban", name: "Falken", map_name: "Hafen", mode_label: "Stellung", via: "side" }],
    plan: [], planned_games: [], paused: null, lead: null, presets: [], blocked: null, start: null, ...extra,
  };
}

test("Veto live: am Zug antippen sperrt, der kurze Abruf ersetzt nur den Veto-Block", async () => {
  const sides = [{ ...OWN, checked_in: true, present_count: 2 }, { ...OTHER, checked_in: true, present_count: 3 }];
  let version = 3;
  answer({ ...BASE, checkin: checkin({ state: "veto", sides, veto: vetoBlock() }) }, () => ({
    veto: vetoBlock({ version, server_now: new Date(Date.now() + version).toISOString(), own_turn: false, can_pick: false, pick_hint: "Falken ist am Zug." }),
    state: "veto",
  }));
  await render(<MatchDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("veto-panel")).toBeTruthy());
  expect(screen.getByTestId("match-flow-state")).toHaveTextContent("Veto läuft");
  expect(screen.getByTestId("checkin-slim")).toHaveTextContent("Beide Seiten eingecheckt", { exact: false });
  expect(screen.getByTestId("veto-text")).toHaveTextContent("Ihr seid am Zug: sperrt eine Map (Stellung). Nach 60 Sekunden wählt das System.");
  expect(screen.getByTestId("veto-own")).toHaveTextContent("Welche Map sperrt ihr (Stellung)?", { exact: false });
  expect(screen.getByTestId("veto-countdown")).toBeTruthy();
  // Nicht wählbar: kein Knopf, nur die Karte mit Grund.
  expect(screen.queryByTestId("veto-option-hafen")).toBeNull();
  mockPost.mockResolvedValueOnce({ data: { status: "running" } });
  await fireEvent.press(screen.getByTestId("veto-option-glut"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/matches/m1/veto/pick", { map_id: "glut", version: 3 }));
  await waitFor(() => expect(screen.getByText("Glut gesperrt.")).toBeTruthy());

  // Der Takt (2 s) holt den neuen Stand: Die Gegenseite ist am Zug, die Seite lädt nicht ganz neu.
  version = 4;
  const pagesBefore = mockGet.mock.calls.filter(([path]) => path === "/matches/m1/page").length;
  await waitFor(() => expect(screen.getByTestId("veto-wait")).toHaveTextContent("Falken ist am Zug.", { exact: false }), { timeout: 4000 });
  expect(mockGet).toHaveBeenCalledWith("/matches/m1/veto");
  expect(mockGet.mock.calls.filter(([path]) => path === "/matches/m1/page").length).toBe(pagesBefore);
});

test("Vorgabe nachgetragen: „Bereit zum Veto“ - der Satz sagt, wer schon bereit ist", async () => {
  const sides = [{ ...OWN, checked_in: true }, { ...OTHER, checked_in: true }];
  const start = { sides: [{ registration_id: "r1", name: "Löwen", ready: false, own: true }, { registration_id: "r2", name: "Falken", ready: true, own: false }], own_ready: false, other_ready: true, can_ready: true, can_withdraw: false, lead: null };
  const veto = vetoBlock({ status: "waiting", current: null, own_turn: false, can_pick: false, presets: [{ mode: "ctl", mode_label: "Kontrolle", position: 3, map_id: "kai", map_name: "Kai" }], week: 2, start });
  answer({ ...BASE, checkin: checkin({ state: "veto", sides, veto }) });
  mockPost.mockResolvedValueOnce({ data: { started: true } });
  await render(<MatchDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("veto-headline")).toHaveTextContent("Vorgabe steht – bereit zum Veto?"));
  expect(screen.getByTestId("veto-text")).toHaveTextContent("Falken ist bereit – tippt auf „Bereit zum Veto“, dann beginnt es sofort.");
  expect(screen.getByTestId("veto-presets")).toHaveTextContent("Vorgabe der Woche · Spielwoche 2", { exact: false });
  await fireEvent.press(screen.getByTestId("veto-ready-button"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/matches/m1/veto/ready", { ready: true }));
  await waitFor(() => expect(screen.getByText("Beide Seiten sind bereit – das Veto läuft.")).toBeTruthy());
});

test("Zuschauer sehen das Veto lesend - ohne Auswahl", async () => {
  answer({ ...BASE, can_act: false, can_report_score: false, can_player_report_result: false, checkin: null, veto_view: vetoBlock({ own_turn: false, can_pick: false, options: [], own_side: null }) });
  await render(<MatchDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("veto-panel")).toBeTruthy());
  expect(screen.queryByTestId("veto-own")).toBeNull();
  expect(screen.queryByTestId("veto-option-glut")).toBeNull();
  expect(screen.queryByTestId("checkin-panel")).toBeNull();
});

test("ohne Liga-Felder (ältere Server, andere Formate) bleibt die Matchseite wie vorher", async () => {
  answer(BASE);
  await render(<MatchDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("match-report-form")).toBeTruthy());
  expect(screen.queryByTestId("checkin-panel")).toBeNull();
  expect(screen.queryByTestId("veto-panel")).toBeNull();
  expect(screen.queryByTestId("match-flow-state")).toBeNull();
});

test("Veto live: endet das Veto (anderer Stand), lädt die Seite einmal ganz statt nur den Block zu tauschen", async () => {
  const sides = [{ ...OWN, checked_in: true, present_count: 2 }, { ...OTHER, checked_in: true, present_count: 3 }];
  answer({ ...BASE, checkin: checkin({ state: "veto", sides, veto: vetoBlock() }) }, () => ({
    veto: vetoBlock({ status: "done", version: 9, server_now: new Date(Date.now() + 1000).toISOString(), current: null, own_turn: false, can_pick: false }),
    state: "ready",
  }));
  await render(<MatchDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("veto-panel")).toBeTruthy());
  const pages = () => mockGet.mock.calls.filter(([path]) => path === "/matches/m1/page").length;
  const before = pages();
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/matches/m1/veto"), { timeout: 4000 });
  await waitFor(() => expect(pages()).toBeGreaterThan(before), { timeout: 4000 });
});

test("Veto: ein überholter Zug (409) nennt den Satz des Servers und lädt frisch", async () => {
  const sides = [{ ...OWN, checked_in: true, present_count: 2 }, { ...OTHER, checked_in: true, present_count: 3 }];
  answer({ ...BASE, checkin: checkin({ state: "veto", sides, veto: vetoBlock() }) });
  await render(<MatchDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("veto-option-glut")).toBeTruthy());
  const pages = () => mockGet.mock.calls.filter(([path]) => path === "/matches/m1/page").length;
  const before = pages();
  mockPost.mockRejectedValueOnce(new Error("Gerade hat sich am Veto etwas geändert – bitte die Seite neu laden."));
  await fireEvent.press(screen.getByTestId("veto-option-glut"));
  await waitFor(() => expect(screen.getByText("Gerade hat sich am Veto etwas geändert – bitte die Seite neu laden.")).toBeTruthy());
  await waitFor(() => expect(pages()).toBeGreaterThan(before));
  expect(screen.queryByText("Glut gesperrt.")).toBeNull();
});

test("Tippflächen mindestens 44 Punkte: Regeln aufklappen und Verlauf", async () => {
  const { StyleSheet } = jest.requireActual("react-native");
  const sides = [{ ...OWN, checked_in: true, present_count: 2 }, { ...OTHER, checked_in: true, present_count: 3 }];
  answer({ ...BASE, checkin: checkin({ state: "veto", sides, veto: vetoBlock() }) });
  await render(<MatchDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("veto-history-toggle")).toBeTruthy());
  expect(StyleSheet.flatten(screen.getByTestId("veto-history-toggle").props.style).minHeight).toBeGreaterThanOrEqual(44);
  expect(StyleSheet.flatten(screen.getByTestId("checkin-rules").props.style).minHeight).toBeGreaterThanOrEqual(44);
});
