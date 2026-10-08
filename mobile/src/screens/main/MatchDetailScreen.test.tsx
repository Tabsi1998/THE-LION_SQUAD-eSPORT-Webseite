import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { MatchDetailScreen } from "./MatchDetailScreen";

// Matchseite der App. Ergebnis melden (#1132): wer selbst im Spiel steht und melden darf, bekommt das Meldeformular -
// online melden die Spieler, die Gegenseite bestätigt mit „Ja, stimmt“. Ohne das Recht kein Formular; die
// Turnierleitung trägt weiter über /result ein. Kein Weg schickt mehr zwei Punktstände an /report.

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args), patch: jest.fn() },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));
const mockAuth = { user: { id: "u1", username: "neon" } };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../../live", () => ({ isGuestUser: () => false }));
jest.mock("../../lib/chats", () => ({ markChatRead: jest.fn(async () => undefined) }));
jest.mock("../../lib/cache", () => ({ ...jest.requireActual("../../lib/cache"), invalidateCache: jest.fn(async () => undefined) }));
jest.mock("../../realtime/LiveChangesProvider", () => ({ useLiveRefresh: () => undefined }));
jest.mock("../../components/CommendButton", () => ({ CommendButton: () => null }));
jest.mock("../../components/ChatStickers", () => ({ MessageSticker: () => null, StickerButton: () => null, StickerPicker: () => null }));
jest.mock("react-native-safe-area-context", () => ({ ...jest.requireActual("react-native-safe-area-context"), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
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

const NEON = { slot: 1, status: "filled", registration_id: "r1", display_name: "NeonFalke" };
const LUNA = { slot: 2, status: "filled", registration_id: "r2", display_name: "LunaByte" };
const PAGE = {
  tournament: { id: "t1", slug: "mk-cup", title: "Mario Kart Cup" },
  match: { id: "m1", match_key: "A", status: "scheduled", round_name: "Halbfinale", slots: [{ slot: 1, registration_id: "r1" }, { slot: 2, registration_id: "r2" }] },
  participants: [NEON, LUNA], matchday_label: "Halbfinale", schedule_proposals: [], collection: "matches_v2",
  can_act: true, can_report_score: true, can_player_report_result: true, can_submit_result: false, can_staff_submit_result: false,
  can_propose_schedule: false, can_manage_schedule: false, can_dispute: false, can_forfeit: false, allows_draw: false,
  event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal",
  report_state: { status: "open", own_summary: null, proposal: null, proposal_summary: null },
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

test("Spieler melden: Sieger wählen, Spielstand freiwillig - die Platzierungsliste geht an /report", async () => {
  answer(PAGE);
  await render(<MatchDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("match-report-form")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("match-report-submit"));
  expect(screen.getByTestId("match-report-error")).toHaveTextContent("Bitte wähle, wer gewonnen hat.");
  expect(mockPost).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId("match-report-winner-r1"));
  await fireEvent.changeText(screen.getByTestId("match-report-value-r1"), "2");
  await fireEvent.changeText(screen.getByTestId("match-report-value-r2"), "0");
  await fireEvent.press(screen.getByTestId("match-report-submit"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/matches/m1/report", {
    results: [{ registration_id: "r1", rank: 1, score: 2 }, { registration_id: "r2", rank: 2, score: 0 }],
    screenshot_url: null, note: null,
  }));
  expect(mockPost.mock.calls.some(([, body]) => body && "score_a" in (body as object))).toBe(false);
});

test("die Gegenseite hat gemeldet: „Ja, stimmt“ schickt genau diese Meldung", async () => {
  const proposal = [{ registration_id: "r2", rank: 1, score: 3 }, { registration_id: "r1", rank: 2, score: 1 }];
  answer({ ...PAGE, report_state: { status: "confirm", own_summary: null, proposal, proposal_summary: "LunaByte gewinnt 3:1." } });
  await render(<MatchDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("match-report-state")).toBeTruthy());
  expect(screen.getByText("Die Gegenseite meldet: LunaByte gewinnt 3:1.")).toBeTruthy();
  expect(screen.queryByTestId("match-report-form")).toBeNull();
  await fireEvent.press(screen.getByTestId("match-report-confirm"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/matches/m1/report", { results: proposal, screenshot_url: null, note: null }));
});

test("nach der eigenen Meldung: wartet auf die Gegenseite", async () => {
  answer({ ...PAGE, report_state: { status: "waiting", own_summary: "NeonFalke gewinnt 2:0.", proposal: null, proposal_summary: null } });
  await render(<MatchDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Deine Meldung ist da – wartet auf die Gegenseite.")).toBeTruthy());
  expect(screen.getByText("Deine Meldung: NeonFalke gewinnt 2:0.")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("match-report-change"));
  expect(screen.getByTestId("match-report-form")).toBeTruthy();
});

test("ohne Recht kein Formular; die Turnierleitung speichert über /result", async () => {
  answer({ ...PAGE, can_player_report_result: false, can_report_score: false, report_state: null });
  const view = await render(<MatchDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Mario Kart Cup")).toBeTruthy());
  expect(screen.queryByTestId("match-report")).toBeNull();
  await view.unmount();

  mockPost.mockResolvedValue({ data: {} });
  answer({ ...PAGE, can_player_report_result: false, report_state: null, can_staff_submit_result: true, can_submit_result: true });
  await render(<MatchDetailScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("match-staff-result-submit")).toBeTruthy());
  expect(screen.queryByTestId("match-report")).toBeNull();
  await fireEvent.press(screen.getByTestId("match-staff-result-submit"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/matches/m1/result", expect.objectContaining({ results: expect.any(Array) })));
});
