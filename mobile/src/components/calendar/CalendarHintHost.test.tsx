import React from "react";
import { AccessibilityInfo, Animated } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { CalendarHintHost } from "./CalendarHintHost";
import { offerCalendarHint } from "../../lib/calendarHint";

// Der Abo-Hinweis nach einer Anmeldung (#1788): nur wenn der Server „fällig“ sagt, beim Erscheinen gemerkt (POST),
// schließbar, „Einmal abonnieren“ führt zu „Mein Kalender-Abo“. Hebt sich leicht an - mit „Bewegung reduzieren“ nicht.

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
const mockOpenDetail = jest.fn();
jest.mock("../../navigation/rootNavigation", () => ({ openDetail: (...args: unknown[]) => mockOpenDetail(...args) }));

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
let reduce = false;
let timing: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  reduce = false;
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockImplementation(async () => reduce);
  timing = jest.spyOn(Animated, "timing");
  mockGet.mockResolvedValue({ data: { due: true } });
  mockPost.mockResolvedValue({ data: { due: false } });
});

async function host() {
  await render(<SafeAreaProvider initialMetrics={METRICS}><CalendarHintHost /></SafeAreaProvider>);
  await act(async () => {
    await Promise.resolve();
  });
}

test("ohne Host fragt niemand den Server - der Hinweis braucht jemanden, der ihn zeigt", async () => {
  expect(await offerCalendarHint()).toBe(false);
  expect(mockGet).not.toHaveBeenCalled();
});

test("fällig: erscheint mit leichtem Anheben, wird gemerkt und führt zum Abo", async () => {
  await host();
  expect(screen.queryByTestId("calendar-hint")).toBeNull();
  let shown = false;
  await act(async () => {
    shown = await offerCalendarHint();
  });
  expect(shown).toBe(true);
  expect(mockGet).toHaveBeenCalledWith("/calendar/hint");
  expect(screen.getByTestId("calendar-hint")).toBeTruthy();
  expect(mockPost).toHaveBeenCalledWith("/calendar/hint");
  expect(timing.mock.calls.some(([, config]) => config.toValue === 1 && config.duration === 240)).toBe(true);

  await fireEvent.press(screen.getByTestId("calendar-hint-go"));
  expect(mockOpenDetail).toHaveBeenCalledWith("CalendarSubscription");
  expect(screen.queryByTestId("calendar-hint")).toBeNull();
});

test("nicht fällig (Abo aktiv oder schon gesehen): nichts erscheint, nichts wird gemerkt", async () => {
  mockGet.mockResolvedValue({ data: { due: false } });
  await host();
  await act(async () => {
    await offerCalendarHint();
  });
  expect(screen.queryByTestId("calendar-hint")).toBeNull();
  expect(mockPost).not.toHaveBeenCalled();
});

test("„Nicht jetzt“ und das Kreuz schließen ihn; mit „Bewegung reduzieren“ ohne Bewegung", async () => {
  reduce = true;
  await host();
  await act(async () => {
    await offerCalendarHint();
  });
  expect(timing.mock.calls.some(([, config]) => config.duration === 240)).toBe(false);
  await fireEvent.press(screen.getByTestId("calendar-hint-later"));
  expect(screen.queryByTestId("calendar-hint")).toBeNull();

  await act(async () => {
    await offerCalendarHint();
  });
  await fireEvent.press(screen.getByTestId("calendar-hint-close"));
  expect(screen.queryByTestId("calendar-hint")).toBeNull();
  expect(mockOpenDetail).not.toHaveBeenCalled();
});
