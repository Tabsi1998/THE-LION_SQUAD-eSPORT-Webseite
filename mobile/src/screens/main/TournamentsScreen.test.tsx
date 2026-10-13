import React from "react";
import { AccessibilityInfo, Animated, StyleSheet } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { TournamentsScreen } from "./TournamentsScreen";
import { currentMonth, monthLabel } from "../../lib/calendar";
import { viennaDay } from "../../lib/vienna";

// Gestaffelte Listen (#1085): die Karten der Events-Seite blenden beim ersten Erscheinen nacheinander ein (70 ms je
// Stelle, höchstens acht Stufen) - beim Live-Aktualisieren und beim Wechsel des Filters nicht noch einmal, mit
// „Bewegung reduzieren“ gar nicht.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  errorMessage: (_error: unknown, fallback: string) => fallback,
  responseFromCache: () => false,
}));
const mockLive: { refresh: () => unknown } = { refresh: () => undefined };
jest.mock("../../realtime/LiveChangesProvider", () => ({
  useLiveRefresh: (callback: () => unknown) => {
    mockLive.refresh = callback;
  },
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/MediaImage", () => ({ MediaImage: () => null }));
jest.mock("../../seasons/anchors", () => ({ SeasonPerch: () => null }));
const mockAuth: { user: Record<string, unknown> | null } = { user: null };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
const mockNavigateToUrl = jest.fn();
jest.mock("../../navigation/rootNavigation", () => ({ navigateToUrl: (...args: unknown[]) => mockNavigateToUrl(...args) }));

const navigation = { navigate: jest.fn() } as never;
const route = { key: "tournaments", name: "TournamentList" } as never;

function cup(index: number, status = "registration_open") {
  return { id: `t${index}`, title: `Cup ${index}`, start_date: `2030-03-${String(index + 1).padStart(2, "0")}T18:00:00Z`, status };
}

let tournaments: unknown[] = [];
let timing: jest.SpyInstance;

/** Versätze der Listen-Einblendungen (240 ms auf volle Deckkraft) in der Reihenfolge, in der die Karten starten. */
function fadeDelays() {
  return timing.mock.calls.map(([, config]) => config).filter((config) => config.duration === 240 && config.toValue === 1).map((config) => config.delay);
}

/** Die Hülle, die eine Karte einblendet: der nächste Vorfahr mit eigener Deckkraft. */
function fadeStyle(text: string) {
  let node = screen.getByText(text).parent;
  while (node && !(node.props.style && !Array.isArray(node.props.style) && "opacity" in node.props.style)) node = node.parent;
  return node?.props.style;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  timing = jest.spyOn(Animated, "timing");
  tournaments = [];
  mockAuth.user = null;
  mockGet.mockImplementation(async (path: string) => ({ data: path === "/tournaments" ? tournaments : [] }));
});
afterEach(() => timing.mockRestore());

test("die Karten blenden nacheinander ein - Live-Aktualisieren und Filter starten nichts neu", async () => {
  tournaments = [...Array.from({ length: 10 }, (_, index) => cup(index)), cup(20, "completed"), cup(21, "completed")];
  await render(<TournamentsScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Cup 9")).toBeTruthy());
  expect(fadeDelays()).toEqual([0, 70, 140, 210, 280, 350, 420, 490, 560, 560]);
  expect(fadeStyle("Cup 0")).toEqual({ opacity: 0, transform: [{ translateY: 8 }] });

  // Live-Aktualisierung mit denselben Turnieren: nichts beginnt von vorn.
  timing.mockClear();
  await act(async () => {
    await mockLive.refresh();
  });
  expect(fadeDelays()).toEqual([]);

  // Ein neues Turnier steht jetzt ganz oben: nur seine Karte blendet ein, die anderen rücken bloß weiter.
  tournaments = [{ id: "neu", title: "Neuer Cup", start_date: "2030-02-01T18:00:00Z", status: "registration_open" }, ...tournaments];
  await act(async () => {
    await mockLive.refresh();
  });
  expect(screen.getByText("Neuer Cup")).toBeTruthy();
  expect(fadeDelays()).toEqual([0]);

  // Filter „Turniere“ (der erste Treffer ist der Reiter): dieselben Karten ohne Kennzahlen - seit #1182 eine Liste ohne
  // Abschnitte, die Karten bleiben stehen und blenden nicht noch einmal ein.
  timing.mockClear();
  await fireEvent.press(screen.getAllByText("Turniere")[0]);
  expect(screen.getAllByText("Turniere")).toHaveLength(1);
  expect(screen.getByText("Cup 9")).toBeTruthy();
  expect(fadeDelays()).toEqual([]);

  // „Vergangene anzeigen“ ist eine neue Liste: sie baut sich wieder nacheinander auf.
  await fireEvent.press(screen.getByTestId("events-past-toggle"));
  expect(screen.getByText("Cup 21")).toBeTruthy();
  expect(fadeDelays()).toEqual([0, 70]);
});

test("mit „Bewegung reduzieren“ stehen die Karten sofort da", async () => {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
  let release = () => {};
  const loaded = new Promise<void>((resolve) => {
    release = resolve;
  });
  tournaments = [cup(0), cup(1), cup(2)];
  mockGet.mockImplementation(async (path: string) => {
    await loaded;
    return { data: path === "/tournaments" ? tournaments : [] };
  });
  await render(<TournamentsScreen navigation={navigation} route={route} />);
  // Die Antwort des Handys liegt vor, die Termine kommen danach.
  await act(async () => {
    release();
  });
  await waitFor(() => expect(screen.getByText("Cup 2")).toBeTruthy());
  expect(fadeDelays()).toEqual([]);
  expect(fadeStyle("Cup 0")).toEqual({ opacity: 1, transform: [{ translateY: 0 }] });
  expect(fadeStyle("Cup 2")).toEqual({ opacity: 1, transform: [{ translateY: 0 }] });
});

// Geräteprobe vor 1.4.0: ein negativer Rand am Inhalt der waagrechten Filterzeile schnitt die Oberkante der Knöpfe ab
// (die waagrechte Liste schneidet ihren Inhalt). Kein Vorfahr eines Filterknopfs hat oben einen negativen Rand.
test("die Filterknöpfe werden oben nicht abgeschnitten - kein negativer Rand in den Filterzeilen", async () => {
  tournaments = [cup(1)];
  await render(<TournamentsScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Cup 1")).toBeTruthy());
  for (const label of ["Alle", "Fast Laps", "Turniere"]) {
    for (const match of screen.getAllByText(label)) {
      let node = match.parent;
      for (let depth = 0; node && depth < 6; depth += 1, node = node.parent) {
        // Auch der Inhalt der waagrechten Liste (contentContainerStyle) - genau dort saß der negative Rand.
        for (const style of [node.props.style, node.props.contentContainerStyle]) {
          const margin = StyleSheet.flatten(style)?.marginTop;
          expect([label, typeof margin === "number" && margin < 0]).toEqual([label, false]);
        }
      }
    }
  }
});

// Kalender (#1271, #1190): öffnet im aktuellen Monat; für Mitglieder stehen Versammlungen und eigene Schichten aus
// /calendar grün dabei, ein Tipp öffnet sie im Mitgliederbereich. Gäste fragen /calendar gar nicht erst.
test("der Kalender öffnet im aktuellen Monat und zeigt Mitgliedern ihre Versammlung", async () => {
  const today = viennaDay(new Date());
  const meeting = { id: "meeting-7", kind: "club", club_kind: "meeting", title: "Generalversammlung", start: `${today}T10:00:00Z`, end: `${today}T11:00:00Z`, path: "/members/meetings?meeting=7", mine: false };
  mockAuth.user = { id: "u-1", username: "paula" };
  mockGet.mockImplementation(async (path: string) => ({ data: path === "/calendar" ? { items: [meeting, { id: "e1", kind: "event", title: "Öffentlich", start: `${today}T10:00:00Z` }] } : [] }));
  await render(<TournamentsScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/calendar"));
  await fireEvent.press(screen.getByTestId("events-view-toggle"));
  const { year, month } = currentMonth();
  expect(screen.getByTestId("calendar-title").props.children).toBe(monthLabel(year, month));
  expect(screen.getByTestId(`calendar-dot-${today}-club`)).toBeTruthy();
  expect(screen.queryByTestId(`calendar-dot-${today}-event`)).toBeNull();

  await fireEvent.press(screen.getByTestId(`calendar-day-${today}`));
  await fireEvent.press(screen.getByTestId("calendar-club-meeting-7"));
  expect(mockNavigateToUrl).toHaveBeenCalledWith("/members/meetings?meeting=7");

  await fireEvent.press(screen.getByTestId("calendar-next"));
  await fireEvent.press(screen.getByTestId("calendar-today"));
  expect(screen.getByTestId("calendar-title").props.children).toBe(monthLabel(year, month));
});

test("Gäste laden keine Vereinstermine", async () => {
  tournaments = [cup(1)];
  await render(<TournamentsScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Cup 1")).toBeTruthy());
  expect(mockGet).not.toHaveBeenCalledWith("/calendar");
});

// Mehrtägige Events (Codex-Prüfung #1460): der Kalender nimmt die einzelnen Tage aus dem Tagesplan - mit Lücke zwei Balken.
test("ein Event mit Lücke zwischen den Tagen sind im Monat zwei Balken", async () => {
  const today = viennaDay(new Date());
  const [year, month, day] = today.split("-").map(Number);
  const first = day <= 15 ? day : day - 2;
  const key = (value: number) => `${year}-${String(month).padStart(2, "0")}-${String(value).padStart(2, "0")}`;
  const event = {
    id: "e-lan", slug: "lan", name: "Herbst-LAN", start_date: `${key(first)}T08:00:00Z`, end_date: `${key(first + 2)}T20:00:00Z`, status: "scheduled",
    schedule: { multi_day: true, count: 2, label: "", range_label: "", now: { state: "before", text: "" }, days: [
      { index: 1, date: key(first), start_at: `${key(first)}T08:00:00Z`, end_at: `${key(first)}T20:00:00Z`, state: "upcoming" },
      { index: 2, date: key(first + 2), start_at: `${key(first + 2)}T08:00:00Z`, end_at: `${key(first + 2)}T20:00:00Z`, state: "upcoming" },
    ] },
  };
  mockGet.mockImplementation(async (path: string) => ({ data: path === "/events" ? [event] : [] }));
  await render(<TournamentsScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getAllByText("Herbst-LAN").length).toBeGreaterThan(0));
  await fireEvent.press(screen.getByTestId("events-view-toggle"));
  expect(screen.getAllByTestId("calendar-bar-event-lan")).toHaveLength(2);
  expect(screen.queryByTestId(`calendar-dot-${key(first + 1)}-event`)).toBeNull();

  // Der Tag in der Lücke ist frei, der zweite Tag zeigt das Event.
  await fireEvent.press(screen.getByTestId(`calendar-day-${key(first + 1)}`));
  expect(screen.getByTestId("calendar-day-empty")).toBeTruthy();
  await fireEvent.press(screen.getByTestId(`calendar-day-${key(first + 2)}`));
  expect(screen.getByTestId("calendar-day-items")).toBeTruthy();
});

// Das Event als Klammer (#1182) und „Nur meine“ (#1189).
const LAN = { id: "e-lan", slug: "herbst-lan", name: "Herbst-LAN", start_date: "2099-10-17T08:00:00Z", status: "registration_open" };
const ROCKET = { id: "t-rocket", slug: "rocket-cup", title: "Rocket Cup", event_id: "e-lan", start_date: "2099-10-18T12:00:00Z", status: "registration_open", team_mode: "team", game: { name: "Rocket League" } };
const ONLINE = { id: "t-online", slug: "online-cup", title: "Online-Cup", start_date: "2099-10-10T17:00:00Z", status: "registration_open" };
const LAP = { id: "f-lan", slug: "lan-lap", title: "LAN Fast Lap", event_id: "e-lan", start_date: "2099-10-17T08:00:00Z", status: "scheduled" };

function respondBracket(mine: unknown = null) {
  mockGet.mockImplementation(async (path: string) => {
    if (path === "/events") return { data: [LAN] };
    if (path === "/tournaments") return { data: [ROCKET, ONLINE] };
    if (path === "/f1/challenges") return { data: [LAP] };
    if (path === "/calendar/mine") return { data: mine };
    if (path === "/calendar") return { data: { items: [] } };
    return { data: [] };
  });
}

test("ein Turnier der LAN steht aufklappbar in ihrer Karte und nicht noch einmal einzeln", async () => {
  respondBracket();
  await render(<TournamentsScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Herbst-LAN")).toBeTruthy());
  expect(screen.getByText("Online-Cup")).toBeTruthy();
  expect(screen.queryByText("Rocket Cup")).toBeNull();
  const toggle = screen.getByTestId("event-toggle-e-lan");
  expect(screen.getByText("1 Turnier · 1 Fast Lap")).toBeTruthy();
  await fireEvent.press(toggle);
  expect(screen.getByTestId("event-child-tournament-t-rocket")).toBeTruthy();
  expect(screen.getByText("Rocket Cup")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("event-child-tournament-t-rocket"));
  expect((navigation as unknown as { navigate: jest.Mock }).navigate).toHaveBeenCalledWith("TournamentDetail", { id: "rocket-cup" });
  // Gäste: kein „Nur meine“, kein eigener Stand.
  expect(screen.queryByTestId("events-only-mine")).toBeNull();
  expect(mockGet).not.toHaveBeenCalledWith("/calendar/mine");
});

test("„Turniere auch einzeln“ zeigt das Turnier zusätzlich als Karte und bleibt am Gerät", async () => {
  respondBracket();
  await render(<TournamentsScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Herbst-LAN")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("events-mode-separate"));
  expect(screen.getByText("Rocket Cup")).toBeTruthy();
  const SecureStore = jest.requireMock("expo-secure-store") as { setItemAsync: jest.Mock };
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith("tls_events_list_mode", "separate");
});

test("„Nur meine“ zeigt nur, wobei man selbst oder das Team dabei ist - mit dem eigenen Stand", async () => {
  mockAuth.user = { id: "u-1", username: "paula" };
  respondBracket({ events: {}, tournaments: { "t-rocket": { state: "approved", label: "Du bist dabei", team_name: "Lions Rocket" } }, fastlaps: {} });
  await render(<TournamentsScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/calendar/mine"));
  await fireEvent.press(screen.getByTestId("events-only-mine"));
  expect(screen.queryByText("Online-Cup")).toBeNull();
  expect(screen.getByText("Herbst-LAN")).toBeTruthy();
  expect(screen.getByText("1 Turnier")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("event-toggle-e-lan"));
  expect(screen.getByTestId("event-child-own-t-rocket").props.children).toBe("Du bist dabei · Lions Rocket");
  expect(screen.queryByTestId("event-child-fastlap-f-lan")).toBeNull();
});

test("Abonnieren im Kalender öffnet den webcal-Link oder Google Kalender", async () => {
  const { Linking } = jest.requireActual("react-native") as typeof import("react-native");
  const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  respondBracket();
  await render(<TournamentsScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Herbst-LAN")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("events-view-toggle"));
  await fireEvent.press(screen.getByTestId("calendar-subscribe-webcal"));
  expect(openURL).toHaveBeenLastCalledWith(expect.stringMatching(/^webcal:\/\/.+\/api\/calendar\/feed\.ics$/));
  await fireEvent.press(screen.getByTestId("calendar-subscribe-google"));
  expect(openURL).toHaveBeenLastCalledWith(expect.stringMatching(/^https:\/\/calendar\.google\.com\/calendar\/render\?cid=webcal%3A%2F%2F/));
  openURL.mockRestore();
});
