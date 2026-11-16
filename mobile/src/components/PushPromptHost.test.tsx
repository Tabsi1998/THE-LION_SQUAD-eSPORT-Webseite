import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { PUSH_PROMPT_LINES, PUSH_PROMPT_TITLE, PushPromptHost } from "./PushPromptHost";
import { afterDashboard, afterOwnRegistration } from "../notifications/pushPrompt";
import type { PushPermission } from "../notifications/PushService";

// Die Erklärung vor der Frage von Android (#1208): erst nach einer Anmeldung, mit drei Zeilen wofür; „Ja, rufen“ ruft
// die Frage des Systems auf, „Später“ schließt still. Wer erlaubt oder abgelehnt hat, sieht kein Blatt.

type MockUser = { id: string; username: string };
const mockAuth: { user: MockUser | null } = { user: { id: "u-1", username: "lena" } };
const mockPermission: { value: PushPermission } = { value: { status: "undetermined", canAskAgain: true } };
const mockAsk = jest.fn(async (): Promise<PushPermission> => ({ status: "granted", canAskAgain: true }));
const mockFriends: { closed: Promise<void> } = { closed: Promise.resolve() };

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../seasons/anchors", () => ({ useSeasonOverlay: () => null }));
jest.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../lib/friendsHint", () => ({ whenFriendsHintClosed: () => mockFriends.closed }));
jest.mock("../notifications/PushService", () => ({
  getPushPermission: async () => mockPermission.value,
  askPushPermission: () => mockAsk(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.user = { id: "u-1", username: "lena" };
  mockPermission.value = { status: "undetermined", canAskAgain: true };
  mockFriends.closed = Promise.resolve();
});

async function registerOwn(key = "t:cup") {
  await act(async () => {
    afterOwnRegistration(mockAuth.user?.id, key);
  });
}

test("ohne Anmeldung keine Frage - auch nicht direkt nach dem Login", async () => {
  await render(<PushPromptHost />);
  await act(async () => {
    await afterDashboard("u-1", ["t:alt", "e:alt"]);
  });
  expect(screen.queryByTestId("push-prompt-sheet")).toBeNull();
  expect(mockAsk).not.toHaveBeenCalled();
});

test("erste Anmeldung: erst die eigene Erklärung mit drei Zeilen, bei „Ja, rufen“ dann die Frage von Android", async () => {
  await render(<PushPromptHost />);
  await registerOwn();
  expect(await screen.findByTestId("push-prompt-sheet")).toBeTruthy();
  expect(screen.getByText(PUSH_PROMPT_TITLE)).toBeTruthy();
  for (const line of PUSH_PROMPT_LINES) expect(screen.getByTestId(`push-prompt-line-${line.title}`)).toBeTruthy();
  expect(PUSH_PROMPT_LINES.map((line) => line.title)).toEqual(["Aufruf", "Check-in", "Ergebnis"]);
  // Die Erklärung allein fragt Android noch nicht.
  expect(mockAsk).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId("push-prompt-yes"));
  await waitFor(() => expect(mockAsk).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByTestId("push-prompt-sheet")).toBeNull());
});

test("„Später“ schließt ohne Frage von Android - erst die nächste Anmeldung fragt wieder", async () => {
  await render(<PushPromptHost />);
  await act(async () => {
    await afterDashboard("u-1", ["t:alt"]);
  });
  await registerOwn("t:erstes");
  await fireEvent.press(await screen.findByTestId("push-prompt-later"));
  expect(screen.queryByTestId("push-prompt-sheet")).toBeNull();

  // Nächstes Öffnen ohne neue Anmeldung: nichts.
  await act(async () => {
    await afterDashboard("u-1", ["t:alt", "t:erstes"]);
  });
  expect(screen.queryByTestId("push-prompt-sheet")).toBeNull();

  await registerOwn("t:zweites");
  expect(await screen.findByTestId("push-prompt-sheet")).toBeTruthy();
  expect(mockAsk).not.toHaveBeenCalled();
});

test("Teammitglied: das Team wurde angemeldet - die Frage beim nächsten Öffnen", async () => {
  await render(<PushPromptHost />);
  await act(async () => {
    await afterDashboard("u-1", ["t:alt"]);
  });
  expect(screen.queryByTestId("push-prompt-sheet")).toBeNull();
  await act(async () => {
    await afterDashboard("u-1", ["t:alt", "t:team-cup"]);
  });
  expect(await screen.findByTestId("push-prompt-sheet")).toBeTruthy();
});

test.each([
  ["erlaubt", { status: "granted", canAskAgain: true }],
  ["abgelehnt", { status: "denied", canAskAgain: true }],
  ["vom System verweigert", { status: "denied", canAskAgain: false }],
  ["ohne Push (Emulator)", { status: "unavailable", canAskAgain: false }],
] as [string, PushPermission][])("%s: kein Blatt nach der Anmeldung", async (_name, permission) => {
  mockPermission.value = permission;
  await render(<PushPromptHost />);
  await registerOwn();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.queryByTestId("push-prompt-sheet")).toBeNull();
  expect(mockAsk).not.toHaveBeenCalled();
});

test("ein offener Freunde-Hinweis geht vor - das Blatt kommt erst danach", async () => {
  let close: () => void = () => {};
  mockFriends.closed = new Promise<void>((resolve) => { close = resolve; });
  await render(<PushPromptHost />);
  await registerOwn();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.queryByTestId("push-prompt-sheet")).toBeNull();
  await act(async () => {
    close();
  });
  expect(await screen.findByTestId("push-prompt-sheet")).toBeTruthy();
});

test("Tippflächen mindestens 48 Punkte", async () => {
  await render(<PushPromptHost />);
  await registerOwn();
  await screen.findByTestId("push-prompt-sheet");
  for (const id of ["push-prompt-yes", "push-prompt-later"]) {
    const style = [screen.getByTestId(id).props.style].flat(Infinity).reduce((all, part) => ({ ...all, ...(part || {}) }), {});
    expect(style.minHeight).toBeGreaterThanOrEqual(48);
  }
});
