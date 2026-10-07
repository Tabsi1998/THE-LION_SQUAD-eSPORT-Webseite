import React from "react";
import { AccessibilityInfo, Animated } from "react-native";
import { act, render, screen, waitFor } from "@testing-library/react-native";
import { DashboardScreen } from "./DashboardScreen";

// Gestaffelte Listen (#1085) auf „Start“: die Karten jedes Abschnitts blenden beim ersten Erscheinen nacheinander ein
// (70 ms je Stelle, höchstens acht Stufen) - nicht noch einmal, wenn der Screen neu lädt (Fokus, Live-Änderung,
// Ziehen), und mit „Bewegung reduzieren“ gar nicht.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  errorMessage: (_error: unknown, fallback: string) => fallback,
  responseFromCache: () => false,
}));
const mockAuth = { user: { id: "u1", username: "anna", display_name: "Anna" }, refreshMe: jest.fn(async () => undefined) };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
const mockLive: { refresh: () => unknown } = { refresh: () => undefined };
jest.mock("../../realtime/LiveChangesProvider", () => ({
  useLiveRefresh: (callback: () => unknown) => {
    mockLive.refresh = callback;
  },
}));
jest.mock("@react-navigation/native", () => {
  const { useEffect } = jest.requireActual("react");
  return {
    ...jest.requireActual("@react-navigation/native"),
    useFocusEffect: (effect: () => void) => useEffect(() => effect(), [effect]),
    useIsFocused: () => true,
  };
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/MediaImage", () => ({ MediaImage: () => null }));
jest.mock("../../seasons/anchors", () => ({ SeasonPerch: () => null }));
jest.mock("../../seasons/SeasonStage", () => ({ SeasonBackdropSlot: () => null, SeasonEdgeSlot: () => null, SeasonWidgetSlot: () => null }));
jest.mock("../../advent/entry", () => ({ AdventHint: () => null }));
jest.mock("../../navigation/rootNavigation", () => ({ openSignIn: jest.fn() }));
jest.mock("../../lib/openLink", () => ({ openLink: jest.fn() }));

const navigation = { navigate: jest.fn() } as never;
const route = { key: "dashboard", name: "Dashboard" } as never;

const actions = Array.from({ length: 10 }, (_, index) => ({ id: `a${index}`, type: "checkin", label: `Aktion ${index}`, target_type: "tournament", target_id: `t${index}` }));
const tournaments = [0, 1].map((index) => ({ id: `t${index}`, title: `Cup ${index}`, start_date: `2030-03-0${index + 1}T18:00:00Z`, status: "registration_open" }));
const post = (index: number) => ({ id: `n${index}`, title: `Beitrag ${index}`, published_at: "2030-01-01T10:00:00Z" });

let dashboard: Record<string, unknown> = {};
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

function answer(path: string) {
  if (path === "/mobile/dashboard") return { data: dashboard };
  return { data: { open: false } };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  timing = jest.spyOn(Animated, "timing");
  dashboard = { me: { tournaments, events: [], matches: [], staff_matches: [], actions }, public: { tournaments: [], events: [] }, news: [post(1), post(2)], streams: [] };
  mockGet.mockImplementation(async (path: string) => answer(path));
});
afterEach(() => timing.mockRestore());

test("jeder Abschnitt baut sich nacheinander auf - Neuladen startet nichts neu", async () => {
  await render(<DashboardScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Beitrag 2")).toBeTruthy());
  // Offene Aktionen (zehn, ab der neunten ohne weiteren Versatz), dann die nächsten Termine, dann die News.
  expect(fadeDelays()).toEqual([0, 70, 140, 210, 280, 350, 420, 490, 560, 560, 0, 70, 0, 70]);
  expect(fadeStyle("Aktion 0")).toEqual({ opacity: 0, transform: [{ translateY: 8 }] });

  // Live-Änderung oder Fokus: dieselben Karten, nichts beginnt von vorn.
  timing.mockClear();
  await act(async () => {
    await mockLive.refresh();
  });
  expect(fadeDelays()).toEqual([]);

  // Ein neuer Beitrag steht oben: nur er blendet ein.
  dashboard = { ...dashboard, news: [post(3), post(1), post(2)] };
  await act(async () => {
    await mockLive.refresh();
  });
  expect(screen.getByText("Beitrag 3")).toBeTruthy();
  expect(fadeDelays()).toEqual([0]);
});

test("mit „Bewegung reduzieren“ stehen die Karten sofort da", async () => {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
  let release = () => {};
  const loaded = new Promise<void>((resolve) => {
    release = resolve;
  });
  mockGet.mockImplementation(async (path: string) => {
    await loaded;
    return answer(path);
  });
  await render(<DashboardScreen navigation={navigation} route={route} />);
  // Die Antwort des Handys liegt vor, das Dashboard kommt danach.
  await act(async () => {
    release();
  });
  await waitFor(() => expect(screen.getByText("Beitrag 2")).toBeTruthy());
  expect(fadeDelays()).toEqual([]);
  expect(fadeStyle("Aktion 9")).toEqual({ opacity: 1, transform: [{ translateY: 0 }] });
  expect(fadeStyle("Cup 1")).toEqual({ opacity: 1, transform: [{ translateY: 0 }] });
  expect(fadeStyle("Beitrag 1")).toEqual({ opacity: 1, transform: [{ translateY: 0 }] });
});
