import React from "react";
import { AppState, Linking } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { PUSH_OFF_ACTION, PUSH_OFF_TEXT, PushOffHint } from "./PushOffHint";
import type { PushPermission } from "../notifications/PushService";

// Der leise Hinweis (#1208): nur wer abgelehnt hat oder wem Android die Erlaubnis verweigert. „einschalten“ fragt Android
// noch einmal, solange es geht - sonst die Systemeinstellungen. Kein Dialog, nichts für Gäste.

type MockUser = { id: string; username: string };
const mockAuth: { user: MockUser | null } = { user: { id: "u-1", username: "lena" } };
const mockPermission: { value: PushPermission } = { value: { status: "denied", canAskAgain: false } };
const mockAsk = jest.fn(async (): Promise<PushPermission> => ({ status: "granted", canAskAgain: true }));
const mockListeners = new Set<(permission: PushPermission) => void>();

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../notifications/PushService", () => ({
  getPushPermission: async () => mockPermission.value,
  askPushPermission: () => mockAsk(),
  onPushPermissionChange: (listener: (permission: PushPermission) => void) => {
    mockListeners.add(listener);
    return () => mockListeners.delete(listener);
  },
}));

let openSettings: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockListeners.clear();
  mockAuth.user = { id: "u-1", username: "lena" };
  mockPermission.value = { status: "denied", canAskAgain: false };
  openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
});

afterEach(() => openSettings.mockRestore());

test("vom System verweigert: die leise Zeile, „einschalten“ öffnet die Systemeinstellungen", async () => {
  await render(<PushOffHint />);
  const hint = await screen.findByTestId("push-off-hint");
  expect(hint.props.accessibilityLabel).toBe(`${PUSH_OFF_TEXT} – ${PUSH_OFF_ACTION}`);
  expect([hint.props.style].flat(Infinity).reduce((all, part) => ({ ...all, ...(part || {}) }), {}).minHeight).toBeGreaterThanOrEqual(48);
  await fireEvent.press(hint);
  await waitFor(() => expect(openSettings).toHaveBeenCalledTimes(1));
  expect(mockAsk).not.toHaveBeenCalled();
});

test("einmal abgelehnt: „einschalten“ fragt Android noch einmal - erlaubt verschwindet die Zeile", async () => {
  mockPermission.value = { status: "denied", canAskAgain: true };
  await render(<PushOffHint />);
  await fireEvent.press(await screen.findByTestId("push-off-hint"));
  await waitFor(() => expect(mockAsk).toHaveBeenCalledTimes(1));
  expect(openSettings).not.toHaveBeenCalled();
  await act(async () => {
    for (const listener of mockListeners) listener({ status: "granted", canAskAgain: true });
  });
  expect(screen.queryByTestId("push-off-hint")).toBeNull();
});

test("zurück aus den Systemeinstellungen: erlaubt - die Zeile ist weg", async () => {
  let onChange: (state: string) => void = () => {};
  const appState = jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
    onChange = handler as (state: string) => void;
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  await render(<PushOffHint />);
  await screen.findByTestId("push-off-hint");
  mockPermission.value = { status: "granted", canAskAgain: true };
  await act(async () => {
    onChange("active");
  });
  await waitFor(() => expect(screen.queryByTestId("push-off-hint")).toBeNull());
  appState.mockRestore();
});

test.each([
  ["erlaubt", { status: "granted", canAskAgain: true }],
  ["noch nicht gefragt", { status: "undetermined", canAskAgain: true }],
  ["ohne Push (Emulator)", { status: "unavailable", canAskAgain: false }],
] as [string, PushPermission][])("%s: keine Zeile", async (_name, permission) => {
  mockPermission.value = permission;
  await render(<PushOffHint />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.queryByTestId("push-off-hint")).toBeNull();
});

test("Gast oder vorbei: keine Zeile", async () => {
  mockAuth.user = null;
  const view = await render(<PushOffHint />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.queryByTestId("push-off-hint")).toBeNull();
  mockAuth.user = { id: "u-1", username: "lena" };
  await view.rerender(<PushOffHint show={false} />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.queryByTestId("push-off-hint")).toBeNull();
});
