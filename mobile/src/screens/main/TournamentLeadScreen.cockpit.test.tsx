import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { TournamentLeadScreen } from "./TournamentLeadScreen";

// Turnier-Cockpit in der App (#1653, #2393): vor Ort mit Warteschlange der Einstieg - Probleme nach Dringlichkeit, ein
// Tipp führt zum Fall; Stationen mit Aufrufen, Starten, Freigeben (Rückfrage) und Defekt über /live-queue/…; Nachladen
// alle 20 s nur im Cockpit. Reiter „Hinweis“ (#1166) für die, die schreiben dürfen. Namen erfunden.

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockDelete = jest.fn();
const mockLiveRefresh = jest.fn();
jest.mock("../../lib/api", () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: jest.fn(),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined) }));
jest.mock("../../realtime/LiveChangesProvider", () => ({ useLiveRefresh: (...args: unknown[]) => mockLiveRefresh(...args) }));
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

const RUNNING = { match_id: "m3", label: "Viertelfinale", names: ["Kometa", "Zackenbarsch"], state: "running", started_at: "2026-11-16T12:00:00Z", duration_minutes: 20, ready: true };
const LEAD = {
  tournament: { id: "t1", slug: "fc-cup", title: "FC 26 Herbst-Cup", event_id: "e1", can_notice: true },
  matches: [{ id: "m9", label: "Halbfinale", kind: "duel", status: "scheduled", participants: [], station_text: "PC 2", timing: { missing: true, overdue_minutes: 6 }, can_enter: true }],
  recent: [],
  counts: { open: 1, missing: 1 },
  attention: [{ id: "rm-m9", kind: "result_missing", title: "Ergebnis fehlt", action: "enter", match_id: "m9", station_text: "PC 2 · PC", label: "Halbfinale", names: "NeonFalke gegen Jo", detail: "6 Min. über der Zeit", overdue_minutes: 6 }],
  stations: [],
};
const QUEUE = {
  applies: true,
  now: "2026-11-16T12:16:00Z",
  operate: { all: true },
  stations: [
    { id: "pc1", name: "PC 1", station_text: "PC 1 · PC", status: "free", running: null, next: { match_id: "m11", label: "Halbfinale", names: ["NeonFalke", "Jo"], state: "queued", ready: true, delay_minutes: 12 } },
    { id: "pc2", name: "PC 2", station_text: "PC 2 · PC", status: "free", running: null, next: { match_id: "m12", label: "Finale", names: ["TurboTina", "Frostbiss"], state: "called", ready: true, called_at: "2026-11-16T12:10:00Z" } },
    { id: "pc3", name: "PC 3", station_text: "PC 3 · PC", status: "busy", running: RUNNING, next: null },
    { id: "pc4", name: "PC 4", station_text: "PC 4 · PC", status: "free", running: null, next: null, hold_issue: { kind: "other", tournament_title: "Mario Kart Cup" } },
  ],
  matches: {},
};

function answer(lead: object = LEAD, queue: object | null = QUEUE) {
  mockGet.mockImplementation(async (path: string) => {
    if (path.endsWith("/live-queue")) return { data: queue || { applies: false } };
    if (path.endsWith("/lead/notices")) return { data: { items: [], can_target_event: false, event_id: "e1" } };
    return { data: lead };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  answer();
  mockPost.mockImplementation(async (path: string) => (path.endsWith("/preview") ? { data: { recipients: 12 } } : { data: {} }));
});

test("vor Ort startet die Leitung im Cockpit: Probleme nach Dringlichkeit, Stationen mit Uhr nach der Serverzeit", async () => {
  jest.useFakeTimers({ now: new Date("2026-11-16T12:16:00Z"), doNotFake: ["nextTick", "setImmediate"] });
  try {
    await render(<TournamentLeadScreen navigation={navigation} route={route} />);
    await waitFor(() => expect(screen.getByTestId("lead-cockpit")).toBeTruthy());
    expect(mockGet).toHaveBeenCalledWith("/tournaments/fc-cup/live-queue");
    expect(screen.getByTestId("cockpit-problems-count")).toHaveTextContent("2 PROBLEME");
    const list = screen.getByTestId("cockpit-problems-list");
    const order = within(list).getAllByTestId(/^cockpit-problem-item-/).map((node) => node.props.testID);
    expect(order).toEqual(["cockpit-problem-item-rm-m9", "cockpit-problem-item-dl-pc1"]);
    expect(screen.getByTestId("cockpit-problem-dl-pc1")).toHaveTextContent(/\+12 Min\. hinter dem Plan/);
    // Die Uhr der laufenden Station: 16 von 20 Minuten - knapp.
    expect(screen.getByTestId("live-clock-m3-time")).toHaveTextContent("16:00");
    expect(screen.getByLabelText("Spielzeit 16:00 von 20 Min., knapp")).toBeTruthy();
    // Andere Station eines anderen Turniers: Hinweis statt Aufrufen.
    expect(screen.getByTestId("live-other-hint-pc4")).toHaveTextContent(/Mario Kart Cup/);
  } finally {
    jest.useRealTimers();
  }
});

test("Nachladen alle 20 s nur im Cockpit - in den anderen Reitern wie bisher", async () => {
  await render(<TournamentLeadScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("lead-cockpit")).toBeTruthy());
  const polls = () => mockLiveRefresh.mock.calls.slice(-2).map((call) => (call[2] as { pollMs?: number }).pollMs);
  expect(polls()).toEqual([20000, 20000]);
  await fireEvent.press(screen.getByText("Ergebnisse"));
  expect(polls()).toEqual([0, 60000]);
  // Nur sichtbar: das Nachladen hängt am Fokus des Screens.
  expect(mockLiveRefresh.mock.calls.at(-1)?.[2]).toMatchObject({ enabled: true });
});

test("Aufrufen und Starten über /live-queue, die Rückmeldung im Klartext", async () => {
  await render(<TournamentLeadScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("live-call-pc1")).toBeTruthy());
  await act(async () => { await fireEvent.press(screen.getByTestId("live-call-pc1")); });
  expect(mockPost).toHaveBeenCalledWith("/tournaments/fc-cup/live-queue/call", { station_id: "pc1", match_id: "m11" });
  await waitFor(() => expect(screen.getByTestId("lead-notice")).toHaveTextContent("Aufgerufen an PC 1 · PC – die Spieler bekommen Bescheid."));
  await act(async () => { await fireEvent.press(screen.getByTestId("live-start-pc2")); });
  expect(mockPost).toHaveBeenCalledWith("/tournaments/fc-cup/live-queue/start", { station_id: "pc2", match_id: "m12" });
  await waitFor(() => expect(screen.getByTestId("lead-notice")).toHaveTextContent("Gestartet an PC 2 · PC – die Uhr läuft."));
  // Danach lädt das Cockpit Ansicht und Warteschlange neu.
  expect(mockGet.mock.calls.filter(([path]) => path === "/tournaments/fc-cup/live-queue").length).toBeGreaterThanOrEqual(3);
});

test("Freigeben fragt nach; Defekt an einer fremden Station fragt nach und schickt confirm_other", async () => {
  await render(<TournamentLeadScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("live-release-pc3")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("live-release-pc3"));
  expect(screen.getByTestId("live-release-confirm-pc3")).toHaveTextContent(/Das Spiel läuft noch/);
  expect(mockPost).not.toHaveBeenCalledWith(expect.stringContaining("/release"), expect.anything());
  await act(async () => { await fireEvent.press(screen.getByTestId("live-release-yes-pc3")); });
  expect(mockPost).toHaveBeenCalledWith("/tournaments/fc-cup/live-queue/release", { station_id: "pc3", match_id: "m3" });

  await fireEvent.press(screen.getByTestId("live-broken-pc4"));
  expect(screen.getByTestId("live-broken-confirm-pc4")).toHaveTextContent(/„Mario Kart Cup“/);
  await act(async () => { await fireEvent.press(screen.getByTestId("live-broken-yes-pc4")); });
  expect(mockPost).toHaveBeenCalledWith("/tournaments/fc-cup/live-queue/broken", { station_id: "pc4", broken: true, confirm_other: true });

  // An einer eigenen Station ohne Rückfrage.
  await act(async () => { await fireEvent.press(screen.getByTestId("live-broken-pc1")); });
  expect(mockPost).toHaveBeenCalledWith("/tournaments/fc-cup/live-queue/broken", { station_id: "pc1", broken: true });
});

test("zwei Helfer zugleich: die 409 des Servers steht im Klartext", async () => {
  mockPost.mockRejectedValueOnce(new Error("Die Station hält inzwischen ein anderes Spiel. Bitte neu laden."));
  await render(<TournamentLeadScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("live-call-pc1")).toBeTruthy());
  await act(async () => { await fireEvent.press(screen.getByTestId("live-call-pc1")); });
  await waitFor(() => expect(screen.getByTestId("lead-notice")).toHaveTextContent("Die Station hält inzwischen ein anderes Spiel. Bitte neu laden."));
});

test("ohne Stations-Recht keine Knöpfe; online (ohne Warteschlange) kein Cockpit", async () => {
  answer(LEAD, { ...QUEUE, operate: null });
  const view = await render(<TournamentLeadScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("lead-cockpit")).toBeTruthy());
  expect(screen.queryByTestId("live-call-pc1")).toBeNull();
  expect(screen.queryByTestId("live-tools-pc1")).toBeNull();
  await view.unmount();

  answer(LEAD, null);
  await render(<TournamentLeadScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("lead-attention")).toBeTruthy());
  expect(screen.queryByTestId("lead-cockpit")).toBeNull();
  expect(screen.queryByText("Cockpit")).toBeNull();
});

test("ein Tipp auf einen Fall öffnet ihn in „Braucht Aufmerksamkeit“, Verzug bleibt im Cockpit", async () => {
  await render(<TournamentLeadScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("cockpit-problem-dl-pc1")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("cockpit-problem-dl-pc1"));
  expect(screen.getByTestId("lead-cockpit")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("cockpit-problem-rm-m9"));
  expect(screen.queryByTestId("lead-cockpit")).toBeNull();
  expect(screen.getByTestId("lead-case-rm-m9")).toHaveStyle({ borderWidth: 2 });
});

test("alles erledigt: „Alles im Plan“ statt der Liste", async () => {
  answer({ ...LEAD, attention: [] }, { ...QUEUE, stations: QUEUE.stations.map((station) => ({ ...station, next: station.next ? { ...station.next, delay_minutes: 0 } : null })) });
  await render(<TournamentLeadScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("cockpit-problems-empty")).toBeTruthy());
  expect(screen.getByTestId("cockpit-problems-count")).toHaveTextContent("KEINE PROBLEME");
});

test("Hinweis (#1166): Vorlage, Empfänger, senden mit derselben Kennung beim zweiten Versuch", async () => {
  mockPost.mockImplementation(async (path: string) => {
    if (path.endsWith("/preview")) return { data: { recipients: 12 } };
    if (path.endsWith("/lead/notices")) throw new Error("Netz weg");
    return { data: {} };
  });
  await render(<TournamentLeadScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Hinweis")).toBeTruthy());
  await act(async () => { await fireEvent.press(screen.getByText("Hinweis")); });
  await waitFor(() => expect(screen.getByTestId("notice-recipients")).toHaveTextContent(/^Geht an 12 Personen: alle Angemeldeten/));
  expect(mockPost).toHaveBeenCalledWith("/tournaments/fc-cup/lead/notices/preview", { target: "tournament" });
  // Ohne Recht fürs ganze Event bleibt „Ganzes Event“ zu.
  expect(screen.getByTestId("notice-target-event")).toBeDisabled();
  await fireEvent.press(screen.getByTestId("notice-template-checkin"));
  expect(screen.getByTestId("notice-count")).toHaveTextContent("18/140");
  await act(async () => { await fireEvent.press(screen.getByTestId("notice-send")); });
  await waitFor(() => expect(screen.getByTestId("lead-notice")).toHaveTextContent("Netz weg"));
  mockPost.mockImplementation(async (path: string) => (path.endsWith("/preview") ? { data: { recipients: 12 } } : { data: { recipients: 12 } }));
  await act(async () => { await fireEvent.press(screen.getByTestId("notice-send")); });
  const sends = mockPost.mock.calls.filter(([path]) => path === "/tournaments/fc-cup/lead/notices");
  expect(sends).toHaveLength(2);
  expect(sends[0][1]).toMatchObject({ text: "Bitte zum Check-in", target: "tournament", show_on_tv: false, duration_minutes: 120 });
  expect(String((sends[0][1] as { request_id: string }).request_id).startsWith("notice-")).toBe(true);
  expect((sends[1][1] as { request_id: string }).request_id).toBe((sends[0][1] as { request_id: string }).request_id);
  await waitFor(() => expect(screen.getByTestId("lead-notice")).toHaveTextContent("Hinweis gesendet – geht an 12 Personen."));
});

test("Hinweis: ohne Recht kein Reiter; im Protokoll Entfernen mit Rückfrage", async () => {
  const { Alert } = jest.requireActual("react-native");
  const alert = jest.spyOn(Alert, "alert").mockImplementation((...args: unknown[]) => {
    (args[2] as Array<{ text: string; onPress?: () => void }>).find((button) => button.text === "Entfernen")?.onPress?.();
  });
  mockGet.mockImplementation(async (path: string) => {
    if (path.endsWith("/live-queue")) return { data: { applies: false } };
    if (path.endsWith("/lead/notices")) {
      return { data: { items: [{ id: "n1", text: "Pause bis 14:30", created_at: "2026-11-16T13:00:00Z", expires_at: "2999-01-01T00:00:00Z", active: true, can_remove: true, author: "Lea", target_label: "Alle im Turnier", state: "sent", recipients: 12, delivered: 11, tv: true }] } };
    }
    return { data: LEAD };
  });
  mockDelete.mockResolvedValue({ data: { ok: true } });
  const view = await render(<TournamentLeadScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Hinweis")).toBeTruthy());
  await act(async () => { await fireEvent.press(screen.getByText("Hinweis")); });
  await waitFor(() => expect(screen.getByTestId("notice-log-n1")).toHaveTextContent(/Lea · Alle im Turnier · am TV/));
  expect(screen.getByTestId("notice-delivery-n1")).toHaveTextContent("an 12 Personen · 11 benachrichtigt");
  await act(async () => { await fireEvent.press(screen.getByTestId("notice-remove-n1")); });
  expect(alert).toHaveBeenCalledWith("Hinweis entfernen?", expect.stringContaining("vom Banner und vom TV"), expect.any(Array));
  await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("/tournaments/fc-cup/lead/notices/n1"));
  alert.mockRestore();

  await view.unmount();
  answer({ ...LEAD, tournament: { ...LEAD.tournament, can_notice: false } }, null);
  await render(<TournamentLeadScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("lead-attention")).toBeTruthy());
  expect(screen.queryByText("Hinweis")).toBeNull();
});

test("Ergebnisse: ein laufendes Spiel trägt die kleine Spielzeit-Uhr statt „läuft 12 Min.“ (#1167)", async () => {
  jest.useFakeTimers({ now: new Date("2026-11-16T12:21:00Z"), doNotFake: ["nextTick", "setImmediate"] });
  try {
    const running = { id: "m5", label: "Viertelfinale", kind: "duel", status: "in_progress", participants: [], station_text: "PC 3", started_at: "2026-11-16T12:00:00Z",
      paused_seconds: 60, timing: { running_minutes: 21, duration_minutes: 20 }, can_enter: true };
    answer({ ...LEAD, attention: [], matches: [running] }, null);
    await render(<TournamentLeadScreen navigation={navigation} route={route} />);
    await waitFor(() => expect(screen.getByTestId("lead-row-m5")).toBeTruthy());
    // 21 Minuten seit dem Start, eine Minute frühere Pause: 20:00 von 20 - überschritten.
    expect(screen.getByTestId("lead-clock-m5-time")).toHaveTextContent("20:00");
    expect(screen.getByLabelText("Spielzeit 20:00 von 20 Min., Zeit überschritten")).toBeTruthy();
    expect(screen.queryByTestId("lead-line-m5")).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

// Review #2393: scheitert ein Nachladen, bleibt der letzte Stand - samt offener Rückfrage in der Kachel.
test("Nachladen scheitert: Cockpit und Rückfrage bleiben, „letzter Stand vor X s“", async () => {
  await render(<TournamentLeadScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("live-release-pc3")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("live-release-pc3"));
  expect(screen.getByTestId("live-release-confirm-pc3")).toBeTruthy();
  mockGet.mockImplementation(async (path: string) => {
    if (path.endsWith("/live-queue")) throw new Error("Netz weg");
    return { data: LEAD };
  });
  // Das Nachladen der Warteschlange (zweiter useLiveRefresh je Zeichnen).
  const reloadQueue = mockLiveRefresh.mock.calls.at(-1)?.[0] as () => Promise<void>;
  await act(async () => { await reloadQueue(); });
  expect(screen.getByTestId("lead-cockpit")).toBeTruthy();
  expect(screen.getByTestId("live-release-confirm-pc3")).toBeTruthy();
  expect(screen.getByTestId("cockpit-stale")).toHaveTextContent(/letzter Stand vor \d+ s/);
  // Kommt die Antwort wieder, verschwindet der Hinweis.
  answer();
  await act(async () => { await reloadQueue(); });
  expect(screen.queryByTestId("cockpit-stale")).toBeNull();
  // Erst `applies: false` nimmt das Cockpit weg.
  answer(LEAD, null);
  await act(async () => { await reloadQueue(); });
  await waitFor(() => expect(screen.queryByTestId("lead-cockpit")).toBeNull());
});

test("Doppeltipp auf Aufrufen schickt nur einen Aufruf", async () => {
  let finish: (value: unknown) => void = () => {};
  mockPost.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await render(<TournamentLeadScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("live-call-pc1")).toBeTruthy());
  const button = screen.getByTestId("live-call-pc1");
  await act(async () => {
    void fireEvent.press(button);
    void fireEvent.press(button);
  });
  expect(mockPost.mock.calls.filter(([path]) => String(path).endsWith("/live-queue/call"))).toHaveLength(1);
  await act(async () => { finish({ data: {} }); });
});

test("online ohne Warteschlange: kein Nachfragen im Takt", async () => {
  answer(LEAD, null);
  await render(<TournamentLeadScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("lead-attention")).toBeTruthy());
  const polls = mockLiveRefresh.mock.calls.slice(-2).map((call) => (call[2] as { pollMs?: number }).pollMs);
  expect(polls).toEqual([0, 0]);
});
