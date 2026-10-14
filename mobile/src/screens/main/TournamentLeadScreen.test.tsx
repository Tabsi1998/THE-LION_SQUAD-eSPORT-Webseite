import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { TournamentLeadScreen } from "./TournamentLeadScreen";
import { expectLateAnswerDiscarded } from "./lateAnswer.testkit";

// Turnierleitung am Handy (#1156): offene Spiele, zuerst was fehlt; „Eintragen“ öffnet das Ergebnis-Fenster mit großen
// Knöpfen, vor dem Speichern steht der Satz, danach 10 Sekunden „Rückgängig“. Namen sind erfunden.

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args), patch: (...args: unknown[]) => mockPatch(...args) },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined) }));
jest.mock("../../realtime/LiveChangesProvider", () => ({ useLiveRefresh: () => undefined }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ accessToken: "zugang" }) }));
jest.mock("../../components/AuthorizedImage", () => ({ AuthorizedImage: () => null }));
jest.mock("@react-navigation/native", () => {
  const { useEffect } = jest.requireActual("react");
  return {
    ...jest.requireActual("@react-navigation/native"),
    useFocusEffect: (effect: () => void) => useEffect(() => effect(), [effect]),
    useIsFocused: () => true,
  };
});

const navigation = { navigate: jest.fn() } as never;
const route = { key: "l", name: "TournamentLead", params: { id: "fc-cup" } } as never;

const DUEL = {
  id: "m1", label: "Halbfinale A", stage_name: "K.-o.", status: "in_progress", kind: "duel", best_of: 1, ranking_mode: "higher_score", allows_draw: false,
  participants: [{ registration_id: "r1", name: "NeonFalke" }, { registration_id: "r2", name: "PixelPanther" }],
  advance: { 1: { text: "ins Finale", flow: "W" } }, has_result: false, result: [], station_text: "PC 3",
  timing: { running_minutes: 21, overdue_minutes: null, missing: false }, can_enter: true,
};
const LATE = { ...DUEL, id: "m2", label: "Halbfinale B", status: "scheduled", station_text: "PC 4", timing: { missing: true, overdue_minutes: 12 },
  participants: [{ registration_id: "r3", name: "TurboTina" }, { registration_id: "r4", name: "Frostbiss" }] };

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue({ data: { tournament: { id: "t1", slug: "fc-cup", title: "FC 26 Herbst-Cup" }, matches: [LATE, DUEL], recent: [], counts: { open: 2, running: 1, missing: 1 } } });
  mockPost.mockImplementation(async (path: string) => (path.endsWith("/undo") ? { data: { ok: true } } : { data: { held: true, hold: { id: "h1" } } }));
});

test("eintragen mit Plus und Minus, Satz, dann Rückgängig", async () => {
  await render(<TournamentLeadScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("lead-row-m2")).toBeTruthy());
  expect(mockGet).toHaveBeenCalledWith("/tournaments/fc-cup/lead");
  expect(screen.getByTestId("lead-line-m2")).toHaveTextContent("Ergebnis fehlt · 12 Min. über der Zeit");

  await fireEvent.press(screen.getByTestId("lead-enter-m1"));
  await fireEvent.press(screen.getByTestId("result-score-r1-plus"));
  await fireEvent.press(screen.getByTestId("result-score-r1-plus"));
  await fireEvent.press(screen.getByTestId("result-score-r2-plus"));
  expect(screen.getByTestId("result-sentence")).toHaveTextContent("NeonFalke gewinnt 2:1 – weiter ins Finale");
  await act(async () => { await fireEvent.press(screen.getByTestId("result-save")); });
  expect(mockPost).toHaveBeenCalledWith("/matches/m1/result", {
    results: [{ registration_id: "r1", rank: 1, score: 2 }, { registration_id: "r2", rank: 2, score: 1 }], hold: true, reason: null,
  });
  expect(screen.getByTestId("result-undo-sentence")).toHaveTextContent("NeonFalke gewinnt 2:1 – weiter ins Finale");
  expect(screen.getByTestId("result-undo")).toHaveTextContent("Rückgängig (10)");
  // Ergebnis eingetragen (#1168): zweimal kurz - der erste Stoß sofort, mit dem Satz.
  expect(jest.requireMock("expo-haptics").impactAsync).toHaveBeenCalledWith("light");

  await act(async () => { await fireEvent.press(screen.getByTestId("result-undo")); });
  expect(mockPost).toHaveBeenCalledWith("/matches/m1/result/undo", { hold_id: "h1" });
  await waitFor(() => expect(screen.queryByTestId("result-undo-bar")).toBeNull());
  expect(screen.getByTestId("lead-notice")).toHaveTextContent("Rückgängig gemacht – es ist nichts passiert.");
});

test("ohne Turnier-Recht: der Satz vom Server statt der Liste", async () => {
  // Wie axios es liefert: 403 mit dem Satz des Servers (#1000: der Fehlerzustand kennt jetzt die Art des Problems).
  mockGet.mockRejectedValue(Object.assign(new Error("Diese Ansicht ist nur für die Turnierleitung dieses Turniers."), { isAxiosError: true, response: { status: 403, data: { detail: "Diese Ansicht ist nur für die Turnierleitung dieses Turniers." } } }));
  await render(<TournamentLeadScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Diese Ansicht ist nur für die Turnierleitung dieses Turniers.")).toBeTruthy());
  expect(screen.queryByTestId("lead-row-m1")).toBeNull();
});

test("Streitfall (#1158): Karte mit Grund und Ergebnis, „Ergebnis bleibt“ mit einem Tipp", async () => {
  const disputed = { ...LATE, status: "disputed", has_result: true, result_summary: "Frostbiss gewinnt 2:1.",
    dispute: { by: "TurboTina", category_label: "Falsches Ergebnis", text: "Es stand 2:1 für mich.", photo: null, result_by: "Ergebnisdienst", reports: [] } };
  mockGet.mockResolvedValue({ data: { tournament: { id: "t1", title: "FC 26 Herbst-Cup" }, matches: [disputed], recent: [], counts: { open: 1 },
    attention: [{ id: "ds-m2", kind: "dispute", match_id: "m2", title: "Streitfall gemeldet", action: "view" }] } });
  mockPost.mockResolvedValue({ data: { ok: true } });
  await render(<TournamentLeadScreen navigation={navigation} route={{ key: "l", name: "TournamentLead", params: { id: "fc-cup", fall: "ds-m2" } } as never} />);
  await waitFor(() => expect(screen.getByTestId("lead-dispute-m2")).toBeTruthy());
  expect(screen.getByText("Falsches Ergebnis")).toBeTruthy();
  expect(screen.getByTestId("lead-dispute-result-m2")).toHaveTextContent("Eingetragen: Frostbiss gewinnt 2:1. · von Ergebnisdienst");
  await fireEvent.changeText(screen.getByTestId("lead-dispute-note-m2"), "Foto eindeutig");
  await act(async () => { await fireEvent.press(screen.getByTestId("lead-dispute-keep-m2")); });
  expect(mockPost).toHaveBeenCalledWith("/matches/m2/dispute/decision", { decision: "keep", note: "Foto eindeutig" });
  await waitFor(() => expect(screen.getByTestId("lead-notice")).toHaveTextContent("Entschieden – beide Seiten bekommen Bescheid."));
});

test("Braucht Aufmerksamkeit (#1160): Station defekt → Umlegen → freie Station wählen", async () => {
  const station = { id: "st-sw2", kind: "station_broken", title: "Station defekt", action: "move", station_text: "Switch 2", label: "Durchgang 3",
    names: "4 Teilnehmer", detail: "1 Spiel wartet darauf", match_ids: ["m7"] };
  mockGet.mockResolvedValue({ data: { tournament: { id: "t1", title: "Herbst-LAN Cup" }, matches: [], recent: [], counts: { open: 0 }, attention: [station],
    stations: [{ id: "sw2", name: "Switch 2", status: "broken" }, { id: "sw3", name: "Switch 3", status: "free", busy: false }] } });
  mockPatch.mockResolvedValue({ data: { id: "m7" } });
  await render(<TournamentLeadScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("lead-case-st-sw2")).toBeTruthy());
  expect(screen.getByText("1 Spiel wartet darauf")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("lead-case-move-st-sw2"));
  expect(screen.queryByTestId("lead-move-to-sw2")).toBeNull();
  await act(async () => { await fireEvent.press(screen.getByTestId("lead-move-to-sw3")); });
  expect(mockPatch).toHaveBeenCalledWith("/matches/m7", { station_id: "sw3" });
  await waitFor(() => expect(screen.getByTestId("lead-notice")).toHaveTextContent("Umgelegt."));
});

test("eine verspätete Antwort für das vorige Turnier wird verworfen (#1000)", async () => {
  await expectLateAnswerDiscarded({
    mockGet,
    renderFor: (id) => <TournamentLeadScreen navigation={navigation} route={{ key: "l", name: "TournamentLead", params: { id } } as never} />,
    newId: "fc-cup",
    oldPrefix: "/tournaments/alt",
    latePath: "/tournaments/alt/lead",
    oldAnswer: () => ({ tournament: { id: "t0", title: "Altes Turnier" }, matches: [], recent: [], counts: {} }),
    newText: "FC 26 Herbst-Cup",
    oldText: "Altes Turnier",
  });
});

// „Nicht erschienen?“ (#1551, #1574): Frist um - die fehlende Seite kampflos werten (mit Rückfrage) oder +5 Min.
// verlängern; derselbe Weg wie im Web (POST /tournaments/{tid}/lead/no-show/{match_id}).
test("Nicht erschienen?: Seite wählen mit Rückfrage oder um 5 Minuten verlängern", async () => {
  const { Alert } = jest.requireActual("react-native");
  const alert = jest.spyOn(Alert, "alert").mockImplementation((...args: unknown[]) => {
    const buttons = args[2] as Array<{ text: string; onPress?: () => void }>;
    buttons.find((button) => button.text === "Kampflos werten")?.onPress?.();
  });
  mockGet.mockResolvedValue({ data: {
    tournament: { id: "t1", slug: "fc-cup", title: "FC 26 Herbst-Cup" }, matches: [LATE], recent: [], counts: { open: 1 },
    attention: [{ id: "ns-m2", kind: "no_show", title: "Nicht erschienen?", action: "no_show", match_id: "m2", station_text: "PC 4", label: "Halbfinale B",
      names: "TurboTina gegen Frostbiss", detail: "10 Min. nach dem Aufruf um – kampflos werten oder verlängern.",
      participants: [{ registration_id: "r3", name: "TurboTina" }, { registration_id: "r4", name: "Frostbiss" }] }],
  } });
  mockPost.mockResolvedValue({ data: { ok: true } });
  await render(<TournamentLeadScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("lead-no-show-ns-m2")).toBeTruthy());
  expect(screen.queryByTestId("lead-case-enter-ns-m2")).toBeNull();

  await act(async () => { await fireEvent.press(screen.getByTestId("lead-no-show-extend-ns-m2")); });
  expect(mockPost).toHaveBeenCalledWith("/tournaments/fc-cup/lead/no-show/m2", { action: "extend", minutes: 5 });
  expect(screen.getByTestId("lead-notice")).toHaveTextContent("Frist um 5 Minuten verlängert.");

  await act(async () => { await fireEvent.press(screen.getByTestId("lead-no-show-r4")); });
  expect(alert).toHaveBeenCalledWith("Frostbiss nicht erschienen?", expect.any(String), expect.any(Array));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/tournaments/fc-cup/lead/no-show/m2", { action: "confirm", registration_id: "r4" }));
  await waitFor(() => expect(screen.getByTestId("lead-notice")).toHaveTextContent("Kampflos gewertet – beide Seiten bekommen Bescheid."));
  alert.mockRestore();
});
