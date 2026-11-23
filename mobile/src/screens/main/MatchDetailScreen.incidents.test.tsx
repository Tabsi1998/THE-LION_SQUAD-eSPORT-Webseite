import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { MatchDetailScreen } from "./MatchDetailScreen";

// Vorfälle im Spiel in der App (#2173, docs/LIGA.md D.5): Captain und Vertreter melden mit Vorschlag, die Gegenseite stimmt zu oder
// lehnt ab, Nachweise hängen am Vorfall. Wer nicht handeln darf, liest nur; Entscheiden bleibt für die Liga-Leitung im Web.
// Ohne `incident_info` (ältere Server, Zuschauer) kein Bereich - öffentlich nur „in Klärung“ je Map. Erfundene Namen.

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
const INFO = {
  can_report: true, as_lead: false, can_decide: false, answer_minutes: 10, break_minutes: 5, break_after: 2, clarification_mode: "continue",
  kinds: [{ key: "disconnect", label: "Verbindungsabbruch" }, { key: "rehost", label: "Rehost" }, { key: "other", label: "Sonstiges" }],
  proposals: [{ key: "continue_at_score", label: "Weiter beim Stand" }, { key: "replay", label: "Map wiederholen" }],
  quota: { limit: 1, used: [] }, hold: null, server_time: new Date().toISOString(), conflict: null,
};
const LEAGUE = {
  best_of: 3, needed: 2, team_size: 2, sides: SIDES, own_registration_id: "r1", roster: [{ id: "p1", name: "Anna" }, { id: "p2", name: "Ben" }],
  planned_games: [{ position: 1, map_id: "hafen", map_name: "Hafen" }], incidents: [], incident_info: INFO, map_state: [],
};
const BASE = {
  tournament: { id: "t1", slug: "liga", title: "Liga 1 · Staffel A" },
  match: { id: "m1", match_key: "S1", status: "in_progress", slots: [{ slot: 1, registration_id: "r1" }, { slot: 2, registration_id: "r2" }] },
  participants: [{ slot: 1, registration_id: "r1", display_name: "Löwen · Rudel A" }, { slot: 2, registration_id: "r2", display_name: "Falken · Horst" }],
  matchday_label: "Spieltag 1", schedule_proposals: [], collection: "matches_v2", can_act: true,
  can_report_score: false, can_player_report_result: false, can_submit_result: false, can_staff_submit_result: false,
  can_dispute: false, allows_draw: false, event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal",
  report_state: null, league: LEAGUE,
};
const soon = (minutes: number) => new Date(Date.now() + minutes * 60 * 1000).toISOString();
const PROPOSED = {
  id: "i1", position: 1, kind: "disconnect", kind_label: "Verbindungsabbruch", state: "proposed", open: true, at: soon(-2), answer_deadline: soon(8),
  reported_by: { registration_id: "r2", name: "Falken · Horst", own: false }, proposal: "replay", proposal_label: "Map wiederholen",
  score: { r1: 3, r2: 4 }, round: 7, note: "Server weg", can_answer: true, can_withdraw: false,
};

function answer(page: Record<string, unknown>, proofs: Record<string, unknown> = { items: [], open: true, can_add: true, limit: 10 }) {
  mockGet.mockImplementation(async (path: string) => {
    if (path === "/matches/m1/page") return { data: page };
    if (path === "/matches/m1/proofs") return { data: proofs };
    return { data: [] };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPost.mockResolvedValue({ data: {} });
});

async function open(page: Record<string, unknown>, proofs?: Record<string, unknown>) {
  answer(page, proofs);
  await render(<MatchDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("match-headline")).toBeTruthy());
}

test("Vorfall melden: Schritt für Schritt, was fehlt sagt ein Satz, die Meldung geht an /incidents", async () => {
  await open(BASE);
  expect(screen.getByTestId("incident-empty")).toHaveTextContent("Bisher kein Vorfall gemeldet.");
  await fireEvent.press(screen.getByTestId("incident-open-form"));
  await fireEvent.press(screen.getByTestId("incident-form-submit"));
  expect(screen.getByTestId("incident-form-problem")).toHaveTextContent("Bitte wählen, um welche Map es geht.");
  expect(mockPost).not.toHaveBeenCalled();
  // Die Map trägt den Namen aus dem Veto.
  expect(screen.getByTestId("incident-form-position-1")).toHaveTextContent("Map 1 · Hafen");
  await fireEvent.press(screen.getByTestId("incident-form-position-1"));
  await fireEvent.press(screen.getByTestId("incident-form-kind-rehost"));
  // Rehost zählt gegen das Kontingent - der Hinweis steht dabei, verweigert wird nichts.
  expect(screen.getByTestId("incident-form-quota")).toHaveTextContent("Zählt gegen euer Kontingent auf dieser Map: bisher 0 von 1 genutzt.");
  await fireEvent.changeText(screen.getByTestId("incident-form-score-r1"), "3");
  await fireEvent.press(screen.getByTestId("incident-form-submit"));
  expect(screen.getByTestId("incident-form-problem")).toHaveTextContent("Bitte den Stand beider Seiten als ganze Zahl angeben – oder beide Felder leer lassen.");
  await fireEvent.changeText(screen.getByTestId("incident-form-score-r2"), "4");
  await fireEvent.press(screen.getByTestId("incident-form-proposal-continue_at_score"));
  await fireEvent.press(screen.getByTestId("incident-form-player-p2"));
  expect(screen.getByTestId("incident-form-next")).toHaveTextContent(/^Nach dem Absenden hat Falken · Horst 10 Minuten zum Antworten\./);
  await fireEvent.press(screen.getByTestId("incident-form-submit"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/matches/m1/incidents", {
    position: 1, kind: "rehost", proposal: "continue_at_score", score: { r1: 3, r2: 4 }, round: null, players: ["p2"], note: null,
  }));
  await waitFor(() => expect(screen.getByText("Gemeldet – Falken · Horst hat 10 Minuten zum Antworten.")).toBeTruthy());
});

test("Pause zwischen den Maps: nur Minuten, wird festgehalten", async () => {
  await open(BASE);
  await fireEvent.press(screen.getByTestId("incident-open-form"));
  await fireEvent.press(screen.getByTestId("incident-form-position-2"));
  await fireEvent.press(screen.getByTestId("incident-form-kind-pause-between"));
  await fireEvent.changeText(screen.getByTestId("incident-form-minutes"), "12");
  await fireEvent.press(screen.getByTestId("incident-form-submit"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/matches/m1/incidents", { position: 2, kind: "pause", between_maps: true, minutes: 12, note: null }));
});

test("Antworten: Satz, Countdown, Zustimmen bzw. Ablehnen mit Grund", async () => {
  await open({ ...BASE, league: { ...LEAGUE, incidents: [PROPOSED] } });
  expect(screen.getByTestId("incident-sentence-i1")).toHaveTextContent("Ihr seid dran: stimmt zu oder lehnt ab.");
  expect(screen.getByTestId("incident-state-i1")).toHaveTextContent(/Wartet auf Antwort/i);
  expect(screen.getByTestId("incident-proposal-i1")).toHaveTextContent("Vorschlag: Map wiederholen");
  expect(screen.getByTestId("incident-countdown-text-i1")).toHaveTextContent(/^[78]:\d\d$/);
  await fireEvent.press(screen.getByTestId("incident-answer-i1-decline"));
  await fireEvent.changeText(screen.getByTestId("incident-answer-i1-note"), "Abbruch kam von euch");
  await fireEvent.press(screen.getByTestId("incident-answer-i1-decline-confirm"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/matches/m1/incidents/i1/answer", { accept: false, note: "Abbruch kam von euch" }));
});

test("Zustimmen und Zurückziehen gehen an ihre Wege", async () => {
  await open({ ...BASE, league: { ...LEAGUE, incidents: [PROPOSED, { ...PROPOSED, id: "i2", can_answer: false, can_withdraw: true, reported_by: { registration_id: "r1", name: "Löwen · Rudel A", own: true } }] } });
  await fireEvent.press(screen.getByTestId("incident-answer-i1-accept"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/matches/m1/incidents/i1/answer", { accept: true, note: null }));
  expect(screen.getByTestId("incident-sentence-i2")).toHaveTextContent("Die Gegenseite antwortet noch.");
  await fireEvent.press(screen.getByTestId("incident-withdraw-i2"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/matches/m1/incidents/i2/withdraw"));
});

test("Nachweise: aufklappen lädt den Bezug, ein Video-Link geht als Formular an /proofs", async () => {
  await open({ ...BASE, league: { ...LEAGUE, incidents: [{ ...PROPOSED, open: false }] } }, { items: [{ id: "pf1", type: "link", link: "https://video.example/clip", side: "r2", own_side: false }], open: true, can_add: true, limit: 10 });
  expect(screen.queryByTestId("incident-proof-i1")).toBeNull();
  await fireEvent.press(screen.getByTestId("incident-proofs-i1"));
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/matches/m1/proofs", { params: { kind: "incident", ref_id: "i1" } }));
  await waitFor(() => expect(screen.getByTestId("incident-proof-i1-link-pf1")).toHaveTextContent("video.example/clip"));
  await fireEvent.changeText(screen.getByTestId("incident-proof-i1-link-input"), "http://unsicher.example");
  await fireEvent.press(screen.getByTestId("incident-proof-i1-link-add"));
  expect(screen.getByTestId("incident-proof-i1-error")).toHaveTextContent("Nur Links mit https:// sind erlaubt.");
  await fireEvent.changeText(screen.getByTestId("incident-proof-i1-link-input"), "https://video.example/neu");
  await fireEvent.press(screen.getByTestId("incident-proof-i1-link-add"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/matches/m1/proofs", expect.any(FormData), expect.anything()));
});

// Rechte (negativ): Mitglieder ohne Captain-Recht und die Leitung sehen den Stand, aber keine Knöpfe der Captains.
test("Mitglied ohne Recht: kein „Vorfall melden“, keine Antwort-Knöpfe, der Satz nennt Captain und Vertreter", async () => {
  await open({ ...BASE, league: { ...LEAGUE, incident_info: { ...INFO, can_report: false }, incidents: [{ ...PROPOSED, can_answer: false }] } });
  expect(screen.queryByTestId("incident-open-form")).toBeNull();
  expect(screen.queryByTestId("incident-answer-i1")).toBeNull();
  expect(screen.getByTestId("incident-sentence-i1")).toHaveTextContent("Euer Captain oder Vertreter ist dran: zustimmen oder ablehnen.");
});

test("Liga-Leitung: kein Aufnehmen und kein Entscheiden in der App, nur der Weg ins Web", async () => {
  await open({ ...BASE, league: { ...LEAGUE, own_registration_id: null, incident_info: { ...INFO, as_lead: true, can_decide: true },
    incidents: [{ ...PROPOSED, state: "in_review", review_cause: "rejected", can_answer: false, can_decide: true }] } });
  expect(screen.queryByTestId("incident-open-form")).toBeNull();
  expect(screen.queryByTestId("incident-decision-i1")).toBeNull();
  expect(screen.getByTestId("incident-lead-web-i1")).toBeTruthy();
  expect(screen.getByTestId("incident-sentence-i1")).toHaveTextContent(/^Die Gegenseite hat abgelehnt\. Die Serie läuft unter Vorbehalt weiter/);
});

test("Zuschauer und ältere Server: kein Vorfall-Bereich, öffentlich nur „in Klärung“ je Map", async () => {
  await open({ ...BASE, can_act: false, league: { ...LEAGUE, incident_info: null, incidents: [], map_state: [{ position: 2, state: "in_clarification" }] } });
  expect(screen.queryByTestId("incident-panel")).toBeNull();
  expect(screen.getByTestId("map-state-2")).toHaveTextContent("Map 2 ist in Klärung");
});

// Gegen Doppeltippen (#2173, Prüfung): zwei Tipps im selben Takt ergeben genau eine Anfrage.
test("Doppeltippen auf „Zustimmen“: genau eine Antwort an den Server", async () => {
  mockPost.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ data: {} }), 20)));
  await open({ ...BASE, league: { ...LEAGUE, incidents: [PROPOSED] } });
  const button = screen.getByTestId("incident-answer-i1-accept");
  await act(async () => {
    void fireEvent.press(button);
    void fireEvent.press(button);
  });
  await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  expect(mockPost).toHaveBeenCalledTimes(1);
});
