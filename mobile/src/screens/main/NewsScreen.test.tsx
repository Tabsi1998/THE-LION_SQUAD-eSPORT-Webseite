import React from "react";
import { AccessibilityInfo, Animated } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { NewsScreen } from "./NewsScreen";

// Gestaffelte Listen (#1085): der große Beitrag oben und die Liste darunter blenden beim ersten Erscheinen
// nacheinander ein (70 ms je Stelle, höchstens acht Stufen) - nicht noch einmal beim Ziehen zum Aktualisieren oder
// wenn eine Suche Beiträge kurz ausblendet, und mit „Bewegung reduzieren“ gar nicht.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  errorMessage: (_error: unknown, fallback: string) => fallback,
  responseFromCache: () => false,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/MediaImage", () => ({ MediaImage: () => null }));
jest.mock("../../seasons/anchors", () => ({ SeasonPerch: () => null }));

const navigation = { navigate: jest.fn() } as never;
const route = { key: "news", name: "NewsList" } as never;

const posts = Array.from({ length: 10 }, (_, index) => ({ id: `n${index}`, slug: `beitrag-${index}`, title: `Beitrag ${index}`, published_at: "2030-01-01T10:00:00Z" }));

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
  mockGet.mockImplementation(async () => ({ data: posts }));
});
afterEach(() => timing.mockRestore());

test("die Beiträge blenden nacheinander ein - Ziehen und Suchen starten nichts neu", async () => {
  await render(<NewsScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Beitrag 9")).toBeTruthy());
  // Der große Beitrag zuerst, dann die Liste - ab der neunten Stelle ohne weiteren Versatz.
  expect(fadeDelays()).toEqual([0, 70, 140, 210, 280, 350, 420, 490, 560, 560]);
  expect(fadeStyle("Beitrag 0")).toEqual({ opacity: 0, transform: [{ translateY: 8 }] });

  // Nach unten ziehen lädt dieselben Beiträge: nichts beginnt von vorn.
  timing.mockClear();
  const [list] = screen.container.queryAll((node) => Boolean(node.props.refreshControl));
  await act(async () => {
    await list.props.refreshControl.props.onRefresh();
  });
  expect(mockGet).toHaveBeenCalledTimes(2);
  expect(fadeDelays()).toEqual([]);

  // Eine Suche blendet fast alles aus, danach ist alles wieder da - schon gezeigt, also sofort.
  const search = screen.getByPlaceholderText("News durchsuchen ...");
  await fireEvent.changeText(search, "Beitrag 3");
  expect(screen.queryByText("Beitrag 5")).toBeNull();
  await fireEvent.changeText(search, "");
  expect(screen.getByText("Beitrag 5")).toBeTruthy();
  expect(fadeDelays()).toEqual([]);
  expect(fadeStyle("Beitrag 5")).toEqual({ opacity: 1, transform: [{ translateY: 0 }] });
});

test("mit „Bewegung reduzieren“ stehen die Beiträge sofort da", async () => {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
  let release = () => {};
  const loaded = new Promise<void>((resolve) => {
    release = resolve;
  });
  mockGet.mockImplementation(async () => {
    await loaded;
    return { data: posts };
  });
  await render(<NewsScreen navigation={navigation} route={route} />);
  // Die Antwort des Handys liegt vor, die Beiträge kommen danach.
  await act(async () => {
    release();
  });
  await waitFor(() => expect(screen.getByText("Beitrag 9")).toBeTruthy());
  expect(fadeDelays()).toEqual([]);
  expect(fadeStyle("Beitrag 0")).toEqual({ opacity: 1, transform: [{ translateY: 0 }] });
  expect(fadeStyle("Beitrag 9")).toEqual({ opacity: 1, transform: [{ translateY: 0 }] });
});
