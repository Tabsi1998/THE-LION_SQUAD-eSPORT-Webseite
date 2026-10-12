import {
  addPushNotificationReceivedListener,
  addPushNotificationResponseListener,
  configurePushNotifications,
  consumeInitialPushNotification,
  pushAccountTag,
  registerPushToken,
  setForegroundPushHidden,
  setPushAccount,
} from "./PushService";
import type { UserNotification } from "../types";

// Pushes am Gerät (#1052, #1053): gesperrt oder Sperrzustand unbekannt zeigt der Vordergrund nichts an - auch einen
// vollen Push eines alten Servers -, und Pushes für ein anderes Konto verwirft die App überall.

type Handler = (notification: unknown) => Promise<Record<string, boolean>>;
type Listener = (event: unknown) => void;

const mockNotifications: { handler: Handler | null; received: Listener | null; response: Listener | null; last: unknown } = {
  handler: null,
  received: null,
  response: null,
  last: null,
};
const mockPost = jest.fn();

jest.mock("expo-notifications", () => ({
  setNotificationHandler: (options: { handleNotification: Handler }) => {
    mockNotifications.handler = options.handleNotification;
  },
  addNotificationReceivedListener: (listener: Listener) => {
    mockNotifications.received = listener;
    return { remove: jest.fn() };
  },
  addNotificationResponseReceivedListener: (listener: Listener) => {
    mockNotifications.response = listener;
    return { remove: jest.fn() };
  },
  getLastNotificationResponseAsync: async () => mockNotifications.last,
  clearLastNotificationResponseAsync: async () => {},
  getPermissionsAsync: async () => ({ status: "granted" }),
  getExpoPushTokenAsync: async () => ({ data: "ExponentPushToken[geraet]" }),
  AndroidImportance: {},
  setNotificationChannelAsync: jest.fn(),
  deleteNotificationChannelAsync: jest.fn(),
}));
jest.mock("expo-device", () => ({ isDevice: true }));
jest.mock("../lib/api", () => ({ api: { post: (...args: unknown[]) => mockPost(...args), delete: jest.fn() } }));

const ACCOUNT = "u-test-1";

function push(data: Record<string, unknown>) {
  return { request: { content: { title: "Nachricht von Max", body: "Treffen um acht?", data } } };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNotifications.last = null;
  setPushAccount(ACCOUNT);
  setForegroundPushHidden(false);
});

test("die Konto-Kennung ist kurz und gleich wie am Server", () => {
  // Derselbe Wert steht in backend/tests/test_push_private_flow.py.
  expect(pushAccountTag(ACCOUNT)).toBe("c6c8cd198acdde30");
});

describe("Vordergrund (#1052)", () => {
  test("gesperrt: kein Banner, kein Ton, kein Zähler, kein Eintrag - auch beim vollen Push eines alten Servers", async () => {
    configurePushNotifications();
    setForegroundPushHidden(true);
    const shown = await mockNotifications.handler?.(push({ notification_id: "n1", kind: "direct_message", url: "/messages/max" }));
    expect(shown).toEqual({ shouldShowAlert: false, shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false });
  });

  test("entsperrt erscheint der Push wie bisher", async () => {
    configurePushNotifications();
    const shown = await mockNotifications.handler?.(push({ notification_id: "n1", account: pushAccountTag(ACCOUNT) }));
    expect(shown).toEqual({ shouldShowAlert: true, shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true });
  });

  test("ein Push für ein anderes Konto erscheint auch entsperrt nicht", async () => {
    configurePushNotifications();
    const shown = await mockNotifications.handler?.(push({ notification_id: "n1", account: pushAccountTag("u-anderes") }));
    expect(shown?.shouldShowBanner).toBe(false);
  });
});

describe("Kontobindung (#1053)", () => {
  test("Empfangen und Antippen verwerfen Pushes eines anderen Kontos", async () => {
    const received: UserNotification[] = [];
    const opened: UserNotification[] = [];
    addPushNotificationReceivedListener((item) => received.push(item));
    addPushNotificationResponseListener((item) => opened.push(item));

    mockNotifications.received?.(push({ notification_id: "fremd", account: pushAccountTag("u-anderes") }));
    mockNotifications.response?.({ notification: push({ notification_id: "fremd", account: pushAccountTag("u-anderes") }) });
    mockNotifications.received?.(push({ notification_id: "eigen", account: pushAccountTag(ACCOUNT) }));
    mockNotifications.response?.({ notification: push({ notification_id: "eigen", account: pushAccountTag(ACCOUNT) }) });
    // Ein alter Server schickt keine Kennung - der Push bleibt.
    mockNotifications.received?.(push({ notification_id: "alt" }));

    expect(received.map((item) => item.id)).toEqual(["eigen", "alt"]);
    expect(opened.map((item) => item.id)).toEqual(["eigen"]);
  });

  test("ein Push, der die App startet, gilt nur fürs eigene Konto", async () => {
    mockNotifications.last = { notification: push({ notification_id: "fremd", account: pushAccountTag("u-anderes") }) };
    expect(await consumeInitialPushNotification()).toBeNull();
  });

  test("ohne angemeldetes Konto gilt kein Push mit Kennung", () => {
    setPushAccount(null);
    const received: UserNotification[] = [];
    addPushNotificationReceivedListener((item) => received.push(item));
    mockNotifications.received?.(push({ notification_id: "n1", account: pushAccountTag(ACCOUNT) }));
    expect(received).toEqual([]);
  });
});

describe("Anmelden des Geräts (#1052)", () => {
  test("nur eine ausdrückliche Bestätigung des Servers zählt als „ohne Inhalt“", async () => {
    mockPost.mockResolvedValueOnce({ data: { ok: true, private_content: true } });
    expect(await registerPushToken({ private: true })).toEqual({ token: "ExponentPushToken[geraet]", privateConfirmed: true });
    expect(mockPost).toHaveBeenCalledWith("/mobile/push-token", expect.objectContaining({ private: true }));

    // Ein alter Server antwortet nur mit ok.
    mockPost.mockResolvedValueOnce({ data: { ok: true } });
    expect(await registerPushToken({ private: true })).toEqual({ token: "ExponentPushToken[geraet]", privateConfirmed: false });
  });
});
