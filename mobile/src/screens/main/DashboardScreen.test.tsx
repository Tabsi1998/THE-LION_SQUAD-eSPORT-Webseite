import React from "react";
import { AccessibilityInfo, Animated } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { breaksInsideWord, DashboardScreen, HeroTitle } from "./DashboardScreen";

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

// Geräteprobe vor 1.4.0: im Advent nimmt der Kranz neben „Gast“ so viel Platz, dass Android „Willkommen“ als
// „Willkomm|en“ umbrach. Der Titel wird kleiner, solange ein Wort zerrissen ist - Umbrüche an Leerzeichen bleiben.
test("breaksInsideWord erkennt zerrissene Wörter, nicht Umbrüche an Leerzeichen", () => {
  expect(breaksInsideWord([{ text: "Willkomm" }, { text: "en" }])).toBe(true);
  expect(breaksInsideWord([{ text: "Leon " }, { text: "King" }])).toBe(false);
  expect(breaksInsideWord([{ text: "Jürgen Österreic" }, { text: "her" }])).toBe(true);
  expect(breaksInsideWord([{ text: "Willkommen" }])).toBe(false);
  expect(breaksInsideWord([])).toBe(false);
});

test("der Titel der Begrüßungskarte wird kleiner, bis kein Wort mehr zerrissen ist - neuer Text beginnt groß", async () => {
  const view = await render(<HeroTitle text="Willkommen" />);
  const title = () => screen.getByTestId("dashboard-hero-title");
  expect(title()).toHaveStyle({ fontSize: 30 });
  const layout = (lines: string[]) => fireEvent(title(), "textLayout", { nativeEvent: { lines: lines.map((text) => ({ text })) } });

  await layout(["Willkomm", "en"]);
  expect(title()).toHaveStyle({ fontSize: 29 });
  await layout(["Willkomm", "en"]);
  await layout(["Willkomm", "en"]);
  expect(title()).toHaveStyle({ fontSize: 26 });
  // Passt es in eine Zeile, bleibt die Größe.
  await layout(["Willkommen"]);
  expect(title()).toHaveStyle({ fontSize: 26 });
  // Nie kleiner als 55 %.
  for (let step = 0; step < 20; step += 1) await layout(["Willkomm", "en"]);
  expect(title()).toHaveStyle({ fontSize: 17 });

  // Ein Name mit Leerzeichen darf zweizeilig bleiben; neuer Text beginnt wieder bei voller Größe.
  await view.rerender(<HeroTitle text="Leon King" />);
  expect(title()).toHaveStyle({ fontSize: 30 });
  await layout(["Leon ", "King"]);
  expect(title()).toHaveStyle({ fontSize: 30 });
});

// Auf dem Gerät kommt der Adventkranz erst nach dem Laden der Saisons dazu: die Spalte wird schmaler, Android meldet
// die zerrissenen Zeilen und die neue Breite im selben Durchgang - das Verkleinern darf dabei nicht verloren gehen.
test("wird die Spalte schmaler, bleibt das Verkleinern - wird sie breiter, beginnt der Titel wieder groß", async () => {
  await render(<HeroTitle text="Willkommen" />);
  const title = () => screen.getByTestId("dashboard-hero-title");
  const width = (value: number) => fireEvent(title(), "layout", { nativeEvent: { layout: { x: 0, y: 0, width: value, height: 40 } } });
  const layout = (lines: string[]) => fireEvent(title(), "textLayout", { nativeEvent: { lines: lines.map((text) => ({ text })) } });

  await width(205);
  await layout(["Willkommen"]);
  expect(title()).toHaveStyle({ fontSize: 30 });
  // Der Kranz erscheint: erst die Zeilen, dann die Breite (Reihenfolge wie auf dem Gerät möglich).
  await layout(["Willkomm", "en"]);
  await width(116);
  expect(title()).toHaveStyle({ fontSize: 29 });
  // Der Kranz verschwindet wieder: mehr Platz, volle Größe.
  await width(205);
  expect(title()).toHaveStyle({ fontSize: 30 });
});
