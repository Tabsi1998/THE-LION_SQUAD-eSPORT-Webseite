import React from "react";
import { AccessibilityInfo, Animated } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { TournamentsScreen } from "./TournamentsScreen";

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

  // Filter „Turniere“ (der erste Treffer ist der Reiter): dieselben Karten ohne Kennzahlen und Abschnitte - schon
  // gezeigt, also sofort da.
  timing.mockClear();
  await fireEvent.press(screen.getAllByText("Turniere")[0]);
  expect(screen.getAllByText("Turniere")).toHaveLength(1);
  expect(screen.getByText("Cup 9")).toBeTruthy();
  expect(fadeDelays()).toEqual([]);
  expect(fadeStyle("Cup 9")).toEqual({ opacity: 1, transform: [{ translateY: 0 }] });

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
