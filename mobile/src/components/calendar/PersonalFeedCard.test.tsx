import React from "react";
import { AccessibilityInfo, Alert, Animated, Linking } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { PersonalFeedCard } from "./PersonalFeedCard";

// Mein Kalender-Abo (#1788): Abo einrichten nur nach Rückfrage, Adresse nur direkt danach sichtbar, Kopieren mit leichter
// Vibration und Haken-Moment (ohne Bewegung bei „Bewegung reduzieren“), „Neu erzeugen“ und „Abschalten“ mit Rückfrage.

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockDelete = jest.fn();
jest.mock("../../lib/api", () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));
jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: ({ name }: { name: string }) => <Text>{`icon:${name}`}</Text> };
});
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock("../../lib/siteUrls", () => ({ WEB_BASE_URL: "https://lionsquad.at" }));

const PATH = "/api/calendar/personal/geheim123.ics";
let alertSpy: jest.SpyInstance;
let setString: jest.SpyInstance;
let timing: jest.SpyInstance;
let reduce = false;

/** Tippt in der zuletzt gezeigten Rückfrage den Knopf mit diesem Text. */
function answer(label: string) {
  const buttons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2] as Array<{ text: string; onPress?: () => void }>;
  buttons.find((button) => button.text === label)?.onPress?.();
}

beforeEach(() => {
  jest.clearAllMocks();
  reduce = false;
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockImplementation(async () => reduce);
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  setString = jest.spyOn(Clipboard, "setStringAsync").mockResolvedValue(true);
  jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  timing = jest.spyOn(Animated, "timing");
  mockGet.mockResolvedValue({ data: { active: false, created_at: null, last_used_at: null } });
  mockPost.mockResolvedValue({ data: { active: true, path: PATH, created_at: "2026-10-19T08:00:00Z", last_used_at: null } });
  mockDelete.mockResolvedValue({ data: { active: false } });
});

test("einrichten erst nach Rückfrage - dann steht die Adresse einmal da, mit Kalender- und Google-Weg", async () => {
  const onStatus = jest.fn();
  await render(<PersonalFeedCard onStatus={onStatus} />);
  await screen.findByTestId("calendar-personal-create");
  expect(screen.queryByTestId("calendar-personal-url")).toBeNull();

  await fireEvent.press(screen.getByTestId("calendar-personal-create"));
  expect(alertSpy).toHaveBeenCalledWith("Persönliches Abo einrichten?", expect.any(String), expect.any(Array));
  expect(mockPost).not.toHaveBeenCalled();
  await act(async () => answer("Einrichten"));

  expect(mockPost).toHaveBeenCalledWith("/calendar/personal");
  expect(await screen.findByText(`https://lionsquad.at${PATH}`)).toBeTruthy();
  expect(screen.getByTestId("calendar-personal-once")).toBeTruthy();
  expect(onStatus).toHaveBeenLastCalledWith({ active: true, created_at: "2026-10-19T08:00:00Z", last_used_at: null });

  await fireEvent.press(screen.getByTestId("calendar-personal-webcal"));
  expect(Linking.openURL).toHaveBeenLastCalledWith(`webcal://lionsquad.at${PATH}`);
  await fireEvent.press(screen.getByTestId("calendar-personal-google"));
  expect(Linking.openURL).toHaveBeenLastCalledWith(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(`webcal://lionsquad.at${PATH}`)}`);
});

test("Kopieren: Zwischenablage, leichte Vibration, Haken und kurzes Nachfedern", async () => {
  await render(<PersonalFeedCard />);
  await fireEvent.press(await screen.findByTestId("calendar-personal-create"));
  await act(async () => answer("Einrichten"));
  await screen.findByTestId("calendar-personal-copy");

  await fireEvent.press(screen.getByTestId("calendar-personal-copy"));
  expect(setString).toHaveBeenCalledWith(`https://lionsquad.at${PATH}`);
  expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith("Abo-Adresse kopiert");
  expect(screen.getByText("Kopiert")).toBeTruthy();
  expect(screen.getByText("icon:checkmark")).toBeTruthy();
  expect(timing.mock.calls.some(([, config]) => config.toValue === 1 && config.duration === 150)).toBe(true);
});

test("„Bewegung reduzieren“: der Haken kommt ohne Nachfedern", async () => {
  reduce = true;
  await render(<PersonalFeedCard />);
  await fireEvent.press(await screen.findByTestId("calendar-personal-create"));
  await act(async () => answer("Einrichten"));
  await fireEvent.press(await screen.findByTestId("calendar-personal-copy"));
  expect(screen.getByText("Kopiert")).toBeTruthy();
  expect(timing.mock.calls.some(([, config]) => config.duration === 150)).toBe(false);
});

test("aktives Abo: Stand in einem Satz, ohne Adresse; Neu erzeugen und Abschalten nur mit Rückfrage", async () => {
  mockGet.mockResolvedValue({ data: { active: true, created_at: "2026-10-03T08:00:00Z", last_used_at: null } });
  await render(<PersonalFeedCard />);
  const line = await screen.findByTestId("calendar-personal-active");
  expect(String(line.props.children.join ? line.props.children.join("") : line.props.children)).toMatch(/^Aktiv seit 03\.10\.2026, noch von keinem Kalender abgerufen\./);
  expect(screen.queryByTestId("calendar-personal-url")).toBeNull();

  await fireEvent.press(screen.getByTestId("calendar-personal-revoke"));
  expect(alertSpy).toHaveBeenLastCalledWith("Abo abschalten?", expect.any(String), expect.any(Array));
  await act(async () => answer("Abbrechen"));
  expect(mockDelete).not.toHaveBeenCalled();
  await act(async () => answer("Ja, abschalten"));
  expect(mockDelete).toHaveBeenCalledWith("/calendar/personal");
  expect(await screen.findByTestId("calendar-personal-create")).toBeTruthy();
});

test("Neu erzeugen zeigt die neue Adresse; schlägt es fehl, steht ein Hinweis da", async () => {
  mockGet.mockResolvedValue({ data: { active: true, created_at: "2026-10-03T08:00:00Z", last_used_at: "2026-10-18T08:00:00Z" } });
  mockPost.mockRejectedValueOnce(new Error("429"));
  await render(<PersonalFeedCard />);
  await fireEvent.press(await screen.findByTestId("calendar-personal-renew"));
  expect(alertSpy).toHaveBeenLastCalledWith("Neue Adresse erzeugen?", expect.any(String), expect.any(Array));
  await act(async () => answer("Ja, neu erzeugen"));
  expect(await screen.findByTestId("calendar-personal-problem")).toBeTruthy();

  await fireEvent.press(screen.getByTestId("calendar-personal-renew"));
  await act(async () => answer("Ja, neu erzeugen"));
  await waitFor(() => expect(screen.getByText(`https://lionsquad.at${PATH}`)).toBeTruthy());
  expect(screen.queryByTestId("calendar-personal-problem")).toBeNull();
});
