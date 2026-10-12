import React from "react";
import { AppState, Text } from "react-native";
import { act, render, screen, waitFor } from "@testing-library/react-native";
import { NotificationProvider, PUSH_RETRY_MS, useNotifications } from "./NotificationContext";
import type { UserNotification } from "../types";

// Die Glocke der App beim Kontowechsel (#1053) und mit App-Sperre (#1052): kein Rest vom vorigen Konto, das Gerät gehört
// dem neuen Konto, und solange gesperrt ist, zeigt die App keinen Inhalt aus Benachrichtigungen.

type MockUser = { id: string; username: string };
type ReceiveListener = (item: UserNotification) => void;

const mockAuth: { user: MockUser | null } = { user: null };
const mockLock = { ready: true, enabled: false, locked: false };
const mockApi = { get: jest.fn(), post: jest.fn() };
type Registration = { token: string; privateConfirmed: boolean } | null;
const REGISTERED: Registration = { token: "ExponentPushToken[test]", privateConfirmed: true };
const mockRegisterPushToken = jest.fn(async (..._args: unknown[]): Promise<Registration> => REGISTERED);
const mockSetBadgeCount = jest.fn(async (..._args: unknown[]) => {});
const mockSetForegroundPushHidden = jest.fn();
const mockRenders: { user: string | undefined; titles: string[] }[] = [];
const mockNavigateToNotification = jest.fn();
const mockListeners: { receive: ReceiveListener | null; open: ReceiveListener | null } = { receive: null, open: null };

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../lock/AppLockProvider", () => ({ useAppLock: () => mockLock }));
jest.mock("../lib/api", () => ({
  api: {
    get: (...args: unknown[]) => mockApi.get(...args),
    post: (...args: unknown[]) => mockApi.post(...args),
  },
}));
jest.mock("../lib/achievements", () => ({ announceAchievementUnlocked: jest.fn() }));
jest.mock("../realtime/LiveChangesProvider", () => ({ useLiveRefresh: jest.fn() }));
jest.mock("../navigation/rootNavigation", () => ({
  navigationRef: { isReady: () => true, getCurrentRoute: () => null },
  navigateToNotification: (...args: unknown[]) => mockNavigateToNotification(...args),
  openDetail: jest.fn(),
}));
jest.mock("./PushService", () => ({
  configurePushNotifications: jest.fn(),
  consumeInitialPushNotification: async () => null,
  registerPushToken: (...args: unknown[]) => mockRegisterPushToken(...args),
  setBadgeCount: (...args: unknown[]) => mockSetBadgeCount(...args),
  setForegroundPushHidden: (...args: unknown[]) => mockSetForegroundPushHidden(...args),
  isContentHiddenPush: (item: UserNotification) => item.meta?.content_hidden === true,
  addPushNotificationReceivedListener: (listener: ReceiveListener) => {
    mockListeners.receive = listener;
    return () => {
      if (mockListeners.receive === listener) mockListeners.receive = null;
    };
  },
  addPushNotificationResponseListener: (listener: ReceiveListener) => {
    mockListeners.open = listener;
    return () => {
      if (mockListeners.open === listener) mockListeners.open = null;
    };
  },
}));

const USER_A = { id: "u-a", username: "a" };
const USER_B = { id: "u-b", username: "b" };
const ITEM_A: UserNotification = { id: "n-a", kind: "direct_message", title: "Nachricht für A", body: "Geheim", read: false };
const ITEM_B: UserNotification = { id: "n-b", kind: "club", title: "Für B", read: false };

function Probe() {
  const { items, unread } = useNotifications();
  mockRenders.push({ user: mockAuth.user?.id, titles: items.map((item) => item.title) });
  return (
    <>
      <Text testID="unread">{unread}</Text>
      {items.map((item) => <Text key={item.id}>{item.title}</Text>)}
    </>
  );
}

function tree() {
  return <NotificationProvider><Probe /></NotificationProvider>;
}

function listFor(rows: UserNotification[]) {
  return { data: rows };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRenders.length = 0;
  mockRegisterPushToken.mockImplementation(async () => REGISTERED);
  mockAuth.user = USER_A;
  Object.assign(mockLock, { ready: true, enabled: false, locked: false });
  mockListeners.receive = null;
  mockListeners.open = null;
  mockApi.get.mockResolvedValue(listFor([ITEM_A]));
  mockApi.post.mockResolvedValue({ data: {} });
});

describe("Kontowechsel (#1053)", () => {
  test("A→B leert die Liste von A und meldet das Gerät für B an", async () => {
    const view = await render(tree());
    expect(await screen.findByText("Nachricht für A")).toBeTruthy();
    await waitFor(() => expect(mockRegisterPushToken).toHaveBeenCalledTimes(1));

    mockApi.get.mockResolvedValue(listFor([ITEM_B]));
    mockAuth.user = USER_B;
    await view.rerender(tree());

    expect(await screen.findByText("Für B")).toBeTruthy();
    expect(screen.queryByText("Nachricht für A")).toBeNull();
    await waitFor(() => expect(mockRegisterPushToken).toHaveBeenCalledTimes(2));
  });

  test("schon das erste Bild von B zeigt nichts von A", async () => {
    const view = await render(tree());
    expect(await screen.findByText("Nachricht für A")).toBeTruthy();

    mockApi.get.mockResolvedValue(listFor([ITEM_B]));
    mockAuth.user = USER_B;
    await view.rerender(tree());
    expect(await screen.findByText("Für B")).toBeTruthy();

    const shownToB = mockRenders.filter((entry) => entry.user === USER_B.id);
    expect(shownToB.length).toBeGreaterThan(0);
    expect(shownToB.some((entry) => entry.titles.includes("Nachricht für A"))).toBe(false);
  });

  test("kam die Anmeldung des Geräts nicht durch, versucht die App es später noch einmal", async () => {
    jest.useFakeTimers();
    try {
      mockRegisterPushToken.mockImplementationOnce(async () => null);
      await render(tree());
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockRegisterPushToken).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(PUSH_RETRY_MS);
      });
      expect(mockRegisterPushToken).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test("eine späte Antwort für A landet nicht in der Liste von B", async () => {
    const view = await render(tree());
    expect(await screen.findByText("Nachricht für A")).toBeTruthy();

    let answerForA: (value: unknown) => void = () => {};
    mockApi.get.mockImplementationOnce(() => new Promise((resolve) => { answerForA = resolve; }));
    await act(async () => {
      mockListeners.receive?.({ ...ITEM_A, id: "n-a2", title: "Noch eine für A" });
    });
    mockApi.get.mockResolvedValue(listFor([]));
    mockAuth.user = USER_B;
    await view.rerender(tree());
    await waitFor(() => expect(screen.queryByText("Nachricht für A")).toBeNull());

    await act(async () => {
      answerForA(listFor([ITEM_A]));
    });

    expect(screen.queryByText("Nachricht für A")).toBeNull();
    expect(screen.getByTestId("unread").props.children).toBe(0);
    expect(mockSetBadgeCount).toHaveBeenLastCalledWith(0);
  });

  test("dasselbe Konto mit erneuerter Sitzung behält Liste und Anmeldung", async () => {
    const view = await render(tree());
    expect(await screen.findByText("Nachricht für A")).toBeTruthy();
    await waitFor(() => expect(mockRegisterPushToken).toHaveBeenCalledTimes(1));

    mockAuth.user = { ...USER_A };
    await view.rerender(tree());

    expect(screen.getByText("Nachricht für A")).toBeTruthy();
    expect(mockRegisterPushToken).toHaveBeenCalledTimes(1);
  });
});

describe("App-Sperre (#1052)", () => {
  test("mit Sperre meldet sich das Gerät für Pushes ohne Inhalt an, ohne Sperre normal", async () => {
    mockLock.enabled = true;
    const view = await render(tree());
    await waitFor(() => expect(mockRegisterPushToken).toHaveBeenCalledWith({ private: true }));

    mockLock.enabled = false;
    await view.rerender(tree());
    await waitFor(() => expect(mockRegisterPushToken).toHaveBeenLastCalledWith({ private: false }));
  });

  test("solange nicht klar ist, ob gesperrt wird, meldet sich das Gerät nicht an", async () => {
    mockLock.ready = false;
    await render(tree());
    expect(await screen.findByText("Nachricht für A")).toBeTruthy();
    expect(mockRegisterPushToken).not.toHaveBeenCalled();
  });

  test("bestätigt der Server „ohne Inhalt“ nicht, fragt die App beim nächsten Öffnen noch einmal", async () => {
    mockLock.enabled = true;
    mockRegisterPushToken.mockImplementation(async () => ({ token: "ExponentPushToken[test]", privateConfirmed: false }));
    await render(tree());
    await waitFor(() => expect(mockRegisterPushToken).toHaveBeenCalledTimes(1));

    // Die App kommt wieder nach vorn: der zuletzt angemeldete Zuhörer für AppState.
    const calls = (AppState.addEventListener as unknown as jest.Mock).mock.calls.filter(([type]) => type === "change");
    const onAppState = calls[calls.length - 1][1] as (state: string) => void;
    await act(async () => {
      onAppState("active");
    });
    await waitFor(() => expect(mockRegisterPushToken).toHaveBeenCalledTimes(2));
    expect(mockRegisterPushToken).toHaveBeenLastCalledWith({ private: true });
  });

  test("die Anzeige im Vordergrund folgt der Sperre - unbekannt zählt als gesperrt", async () => {
    mockLock.ready = false;
    const view = await render(tree());
    expect(mockSetForegroundPushHidden).toHaveBeenLastCalledWith(true);

    Object.assign(mockLock, { ready: true, enabled: true, locked: false });
    await view.rerender(tree());
    expect(mockSetForegroundPushHidden).toHaveBeenLastCalledWith(false);
  });

  test("gesperrt kommt ein Push nicht in die Liste; nach dem Entsperren lädt die Glocke neu", async () => {
    Object.assign(mockLock, { enabled: true, locked: true });
    const view = await render(tree());
    expect(await screen.findByText("Nachricht für A")).toBeTruthy();
    const loadsBefore = mockApi.get.mock.calls.length;

    await act(async () => {
      mockListeners.receive?.({ id: "n-neu", kind: "direct_message", title: "Hallo von Max", read: false });
    });
    expect(screen.queryByText("Hallo von Max")).toBeNull();
    expect(mockApi.get.mock.calls.length).toBe(loadsBefore);

    mockLock.locked = false;
    await view.rerender(tree());
    await waitFor(() => expect(mockApi.get.mock.calls.length).toBeGreaterThan(loadsBefore));
  });

  test("gesperrt: kein Banner mit Inhalt", async () => {
    Object.assign(mockLock, { enabled: true, locked: true });
    await render(tree());
    expect(await screen.findByText("Nachricht für A")).toBeTruthy();

    await act(async () => {
      mockListeners.receive?.({ id: "n-neu", kind: "direct_message", title: "Hallo von Max", body: "Geheim", read: false });
    });

    expect(screen.queryByTestId("notification-popup")).toBeNull();
    expect(screen.queryByText("Geheim")).toBeNull();
  });

  test("ohne Sperre erscheint der Banner wie bisher", async () => {
    await render(tree());
    expect(await screen.findByText("Nachricht für A")).toBeTruthy();

    await act(async () => {
      mockListeners.receive?.({ id: "n-neu", kind: "direct_message", title: "Hallo von Max", body: "Wie geht's?", read: false });
    });

    expect(screen.getByTestId("notification-popup")).toBeTruthy();
    expect(screen.getByText("Wie geht's?")).toBeTruthy();
  });

  test("ein angetippter Push öffnet sich erst nach dem Entsperren - mit dem Eintrag vom Server", async () => {
    Object.assign(mockLock, { enabled: true, locked: true });
    const full: UserNotification = { id: "n-privat", kind: "direct_message", title: "Hallo von Max", url: "/messages/max", read: false };
    mockApi.get.mockResolvedValue(listFor([full]));
    const view = await render(tree());
    await waitFor(() => expect(mockListeners.open).not.toBeNull());

    await act(async () => {
      mockListeners.open?.({ id: "n-privat", title: "LionsAPP", body: "Neue Benachrichtigung", read: false, meta: { content_hidden: true } });
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(mockNavigateToNotification).not.toHaveBeenCalled();

    mockLock.locked = false;
    await view.rerender(tree());

    await waitFor(() => expect(mockNavigateToNotification).toHaveBeenCalledWith(expect.objectContaining({ id: "n-privat", url: "/messages/max" })));
  });
});
