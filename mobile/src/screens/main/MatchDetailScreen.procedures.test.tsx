import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { MatchDetailScreen } from "./MatchDetailScreen";

// Liga-Verfahren in der App (#2173, docs/LIGA.md E.2): Beanstandung bzw. Protest geführt einreichen, danach Nachweise; das eigene
// Verfahren ergänzen oder zurückziehen, als Gegenseite Stellung nehmen, Einspruch einlegen. Ohne Recht nur der Stand.
// Ohne `procedure_form` (ältere Server, Turniere) bleibt „Problem melden“ wie bisher. Erfundene Namen.

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args), patch: (...args: unknown[]) => mockPatch(...args) },
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
const GUIDE = {
  open: true, kind: "protest", kind_label: "Protest", until: new Date(Date.now() + 26 * 3600 * 1000).toISOString(), result_reason: "wrong_result", reason_min: 10, reason_max: 1000,
  reasons: [{ key: "wrong_result", label: "Falsches Ergebnis" }, { key: "equipment", label: "Ausrüstung", ask_notified: true }], incidents: [], appealable: null,
};
const LEAGUE = { best_of: 3, needed: 2, team_size: 2, sides: SIDES, own_registration_id: "r1", roster: [], procedure_form: GUIDE, procedures: [], contested: false };
const BASE = {
  tournament: { id: "t1", slug: "liga", title: "Liga 1 · Staffel A" },
  match: { id: "m1", match_key: "S1", status: "completed", slots: [{ slot: 1, registration_id: "r1" }, { slot: 2, registration_id: "r2" }] },
  participants: [{ slot: 1, registration_id: "r1", display_name: "Löwen · Rudel A" }, { slot: 2, registration_id: "r2", display_name: "Falken · Horst" }],
  matchday_label: "Spieltag 1", schedule_proposals: [], collection: "matches_v2", can_act: true,
  can_report_score: false, can_player_report_result: false, can_submit_result: false, can_staff_submit_result: false,
  can_dispute: true, dispute_until: null, allows_draw: false, event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal",
  report_state: null, league: LEAGUE,
};
const OWN = {
  id: "pr1", kind: "protest", kind_label: "Protest", state: "open", side: "r1", own: true, at: new Date().toISOString(), reason: "Map 2 ging an uns, Clip liegt bei.",
  reason_label: "Falsches Ergebnis", claimed: { results: [{ registration_id: "r1", score: 2 }, { registration_id: "r2", score: 1 }] },
  evidence_until: new Date(Date.now() + 3600 * 1000).toISOString(), statement: { side: "r2", text: null, due_at: new Date(Date.now() + 7200 * 1000).toISOString() },
  can_amend: true, can_withdraw: true, can_state: false, can_appeal: false,
};

function answer(page: Record<string, unknown>) {
  mockGet.mockImplementation(async (path: string) => {
    if (path === "/matches/m1/page") return { data: page };
    if (path === "/matches/m1/proofs") return { data: { items: [], open: true, can_add: true, limit: 10 } };
    return { data: [] };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPost.mockResolvedValue({ data: {} });
  mockPatch.mockResolvedValue({ data: {} });
});

async function open(page: Record<string, unknown>) {
  answer(page);
  await render(<MatchDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("match-headline")).toBeTruthy());
}

test("Protest geführt einreichen: Grund, Ergebnis aus eurer Sicht, Begründung - danach die Nachweise", async () => {
  await open(BASE);
  expect(screen.getByTestId("procedure-kind-label")).toHaveTextContent("Protest");
  await fireEvent.press(screen.getByTestId("match-dispute-btn"));
  expect(screen.getByTestId("match-dispute-error")).toHaveTextContent("Bitte antippen, worum es geht.");
  await fireEvent.press(screen.getByTestId("match-dispute-reason-wrong_result"));
  await fireEvent.changeText(screen.getByTestId("match-dispute-input"), "Map 2 ging an uns, der Clip zeigt es.");
  await fireEvent.press(screen.getByTestId("match-dispute-btn"));
  expect(screen.getByTestId("match-dispute-error")).toHaveTextContent("Bitte das Ergebnis angeben, das aus eurer Sicht stimmt – je Seite eine Zahl.");
  expect(mockPost).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByTestId("procedure-claimed-0"), "2");
  await fireEvent.changeText(screen.getByTestId("procedure-claimed-1"), "1");
  mockPost.mockResolvedValueOnce({ data: { procedure_id: "pr9" } });
  await fireEvent.press(screen.getByTestId("match-dispute-btn"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/matches/m1/dispute", {
    reason: "Map 2 ging an uns, der Clip zeigt es.", reason_key: "wrong_result",
    claimed: { results: [{ registration_id: "r1", score: 2 }, { registration_id: "r2", score: 1 }] },
  }));
  await waitFor(() => expect(screen.getByTestId("procedure-created")).toBeTruthy());
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/matches/m1/proofs", { params: { kind: "protest", ref_id: "pr9" } }));
  await fireEvent.press(screen.getByTestId("procedure-done"));
  expect(screen.queryByTestId("procedure-created")).toBeNull();
});

test("Pflichtfrage „sofort hingewiesen?“ bei Gründen, die sie verlangen", async () => {
  await open(BASE);
  await fireEvent.press(screen.getByTestId("match-dispute-reason-equipment"));
  await fireEvent.changeText(screen.getByTestId("match-dispute-input"), "Verbotene Waffe in Map 1 genutzt.");
  await fireEvent.press(screen.getByTestId("match-dispute-btn"));
  expect(screen.getByTestId("match-dispute-error")).toHaveTextContent("Bitte angeben, ob ihr die Gegenseite sofort darauf hingewiesen habt.");
  await fireEvent.press(screen.getByTestId("procedure-notified-yes"));
  await fireEvent.press(screen.getByTestId("match-dispute-btn"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/matches/m1/dispute", { reason: "Verbotene Waffe in Map 1 genutzt.", reason_key: "equipment", notified_immediately: true }));
});

test("eigenes Verfahren: Stand, Fristen, Ergänzen und Zurückziehen mit Rückfrage", async () => {
  await open({ ...BASE, league: { ...LEAGUE, procedure_form: { ...GUIDE, open: false }, procedures: [OWN] } });
  expect(screen.queryByTestId("match-dispute-form")).toBeNull();
  expect(screen.getByTestId("procedure-state-pr1")).toHaveTextContent("Läuft");
  expect(screen.getByTestId("procedure-claimed-pr1")).toHaveTextContent("Ergebnis aus Sicht der Seite: Löwen · Rudel A 2 : 1 Falken · Horst");
  expect(screen.getByTestId("procedure-evidence-until-pr1")).toHaveTextContent(/Ergänzen und Nachweise bis .*\(noch/);
  expect(screen.getByTestId("procedure-statement-until-pr1")).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId("procedure-amend-input-pr1"), "Zweiter Clip aus Sicht von Anna.");
  await fireEvent.press(screen.getByTestId("procedure-amend-send-pr1"));
  await waitFor(() => expect(mockPatch).toHaveBeenCalledWith("/matches/m1/procedures/pr1", { addition: "Zweiter Clip aus Sicht von Anna." }));
  await fireEvent.press(screen.getByTestId("procedure-withdraw-pr1"));
  expect(mockPost).not.toHaveBeenCalledWith("/matches/m1/procedures/pr1/withdraw");
  await fireEvent.press(screen.getByTestId("procedure-withdraw-pr1"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/matches/m1/procedures/pr1/withdraw"));
});

test("Gegenseite: Stellung nehmen; nach der Entscheidung Einspruch", async () => {
  const theirs = { ...OWN, id: "pr2", side: "r2", own: false, can_amend: false, can_withdraw: false, can_state: true };
  const decided = { ...OWN, id: "pr3", state: "decided", decision: "keep", decision_note: "Clip zeigt 1:2.", can_amend: false, can_withdraw: false, can_appeal: true, appeal_until: new Date(Date.now() + 3600 * 1000).toISOString(), statement: null };
  await open({ ...BASE, league: { ...LEAGUE, procedure_form: { ...GUIDE, open: false }, procedures: [theirs, decided] } });
  await fireEvent.changeText(screen.getByTestId("procedure-statement-input-pr2"), "Bei uns stand es 2:1 für Horst.");
  await fireEvent.press(screen.getByTestId("procedure-statement-send-pr2"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/matches/m1/procedures/pr2/statement", { text: "Bei uns stand es 2:1 für Horst." }));
  expect(screen.getByTestId("procedure-decision-pr3")).toHaveTextContent(/Das Ergebnis bleibt\./);
  await fireEvent.press(screen.getByTestId("procedure-appeal-pr3-open"));
  await fireEvent.changeText(screen.getByTestId("procedure-appeal-pr3-input"), "Der Clip zeigt die falsche Map.");
  await fireEvent.press(screen.getByTestId("procedure-appeal-pr3-send"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/matches/m1/appeals", { against_type: "protest_decision", ref_id: "pr3", reason: "Der Clip zeigt die falsche Map." }));
});

test("Einspruch gegen eine Wertung kampflos über procedure_form.appealable", async () => {
  await open({ ...BASE, league: { ...LEAGUE, procedure_form: { ...GUIDE, open: false, appealable: { type: "forfeit", ref_id: "m1", until: null } } } });
  expect(screen.getByTestId("match-appealable")).toHaveTextContent(/kampflos gewertet/);
  await fireEvent.press(screen.getByTestId("match-appeal-open"));
  await fireEvent.changeText(screen.getByTestId("match-appeal-input"), "Wir waren pünktlich in der Lobby.");
  await fireEvent.press(screen.getByTestId("match-appeal-send"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/matches/m1/appeals", { against_type: "forfeit", ref_id: "m1", reason: "Wir waren pünktlich in der Lobby." }));
});

// Rechte (negativ): ohne `can_dispute` kein Formular, ohne die Flags der Karte keine Knöpfe - nur Stand und „in Klärung“.
test("ohne Recht: kein Einreichen, keine Schritte an der Karte, nur der Stand", async () => {
  const foreign = { ...OWN, id: "pr4", side: "r2", own: false, can_amend: false, can_withdraw: false, can_state: false, statement: null };
  await open({ ...BASE, can_act: false, can_dispute: false, league: { ...LEAGUE, procedure_form: null, procedures: [foreign], contested: true } });
  expect(screen.queryByTestId("match-dispute-form")).toBeNull();
  expect(screen.getByTestId("match-contested")).toHaveTextContent(/das Ergebnis zählt vorläufig/);
  expect(screen.getByTestId("procedure-state-pr4")).toHaveTextContent("Läuft");
  expect(screen.queryByTestId("procedure-amend-pr4")).toBeNull();
  expect(screen.queryByTestId("procedure-withdraw-pr4")).toBeNull();
  expect(screen.queryByTestId("procedure-statement-input-pr4")).toBeNull();
  expect(screen.queryByTestId("procedure-appeal-pr4-open")).toBeNull();
});

test("Formular zu (Frist vorbei): kein geführtes Formular, auch nicht das alte", async () => {
  await open({ ...BASE, league: { ...LEAGUE, procedure_form: { ...GUIDE, open: false } } });
  expect(screen.queryByTestId("match-dispute-form")).toBeNull();
  expect(screen.queryByTestId("match-dispute-btn")).toBeNull();
});
