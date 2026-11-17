import { Platform } from "react-native";
import {
  addPushNotificationReceivedListener,
  askPushPermission,
  getPushPermission,
  onPushPermissionChange,
  addPushNotificationResponseListener,
  configurePushNotifications,
  consumeInitialPushNotification,
  pushAccountTag,
  registerPushToken,
  setForegroundPushHidden,
  setPushAccount,
} from "./PushService";
import type { UserNotification } from "../types";
import { isPushAsked } from "./pushPrompt";
import { resetPromptStateForTests } from "./pushPromptStore";

// Pushes am Gerät (#1052, #1053): gesperrt oder Sperrzustand unbekannt zeigt der Vordergrund nichts an - auch einen
// vollen Push eines alten Servers -, und Pushes für ein anderes Konto verwirft die App überall.

type Handler = (notification: unknown) => Promise<Record<string, boolean>>;
type Listener = (event: unknown) => void;

type Permission = { status: string; canAskAgain?: boolean };
const mockNotifications: {
  handler: Handler | null; received: Listener | null; response: Listener | null; last: unknown;
  permission: Permission; answer: Permission; order: string[];
} = {
  handler: null,
  received: null,
  response: null,
  last: null,
  permission: { status: "granted", canAskAgain: true },
  answer: { status: "granted", canAskAgain: true },
  order: [],
};
const mockRequest = jest.fn(async () => {
  mockNotifications.order.push("frage");
  mockNotifications.permission = mockNotifications.answer;
  return mockNotifications.answer;
});
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
  getPermissionsAsync: async () => mockNotifications.permission,
  requestPermissionsAsync: () => mockRequest(),
  getExpoPushTokenAsync: async () => ({ data: "ExponentPushToken[geraet]" }),
  AndroidImportance: {},
  setNotificationChannelAsync: jest.fn(async (id: string) => {
    mockNotifications.order.push(`kanal:${id}`);
  }),
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
  mockNotifications.permission = { status: "granted", canAskAgain: true };
  mockNotifications.answer = { status: "granted", canAskAgain: true };
  mockNotifications.order = [];
  resetPromptStateForTests(null);
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

describe("Installations-Kennung (#2470)", () => {
  test("jede Token-Meldung schickt dieselbe Kennung mit", async () => {
    mockPost.mockResolvedValue({ data: { ok: true } });
    await registerPushToken();
    await registerPushToken({ private: true });

    const first = mockPost.mock.calls[0][1] as Record<string, unknown>;
    const second = mockPost.mock.calls[1][1] as Record<string, unknown>;
    expect(first).toEqual(expect.objectContaining({ token: "ExponentPushToken[geraet]", channels: expect.anything(), private: false }));
    expect(typeof first.installation_id).toBe("string");
    expect(String(first.installation_id)).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(second.installation_id).toBe(first.installation_id);
  });

  test("die Kennung steht in keiner Konsolen-Ausgabe, auch nicht beim Fehler", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => jest.spyOn(console, level).mockImplementation(() => {}));
    try {
      mockPost.mockResolvedValueOnce({ data: { ok: true } });
      await registerPushToken();
      const id = String((mockPost.mock.calls[0][1] as Record<string, unknown>).installation_id);
      // Ein Fehler wie von axios: das Fehlerobjekt trägt die gesendeten Daten.
      mockPost.mockRejectedValueOnce(Object.assign(new Error("Request failed"), {
        config: { data: JSON.stringify(mockPost.mock.calls[0][1]) },
        response: { status: 500 },
      }));
      expect(await registerPushToken()).toBeNull();

      const printed = spies.flatMap((spy) => spy.mock.calls.flat()).map((arg) => {
        if (arg instanceof Error) return `${arg.message} ${JSON.stringify((arg as Error & { config?: unknown }).config ?? "")}`;
        return typeof arg === "string" ? arg : JSON.stringify(arg);
      }).join("\n");
      expect(id.length).toBeGreaterThanOrEqual(16);
      expect(printed).not.toContain(id);
      expect(printed).toContain("HTTP 500");
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });
});

describe("Erlaubnis im richtigen Moment (#1208)", () => {
  test("ohne Erlaubnis meldet sich das Gerät nicht an - und fragt dabei nicht (kein Dialog nach dem Login)", async () => {
    mockNotifications.permission = { status: "undetermined", canAskAgain: true };
    expect(await registerPushToken()).toBeNull();
    expect(mockRequest).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();

    mockNotifications.permission = { status: "denied", canAskAgain: false };
    expect(await registerPushToken()).toBeNull();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  test("die Erlaubnis lesen fragt nicht", async () => {
    mockNotifications.permission = { status: "undetermined", canAskAgain: true };
    expect(await getPushPermission()).toEqual({ status: "undetermined", canAskAgain: true });
    mockNotifications.permission = { status: "denied", canAskAgain: false };
    expect(await getPushPermission()).toEqual({ status: "denied", canAskAgain: false });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  test("„Ja, rufen“: erst die Android-Kanäle (#1014), dann die Frage des Systems - und alle erfahren die Antwort", async () => {
    const os = Platform.OS;
    Object.defineProperty(Platform, "OS", { configurable: true, get: () => "android" });
    try {
      mockNotifications.permission = { status: "undetermined", canAskAgain: true };
      mockNotifications.answer = { status: "denied", canAskAgain: true };
      const heard: unknown[] = [];
      const stop = onPushPermissionChange((permission) => heard.push(permission));
      expect(await askPushPermission()).toEqual({ status: "denied", canAskAgain: true });
      stop();
      expect(mockNotifications.order.indexOf("frage")).toBeGreaterThan(0);
      expect(mockNotifications.order.slice(0, -1).every((step) => step.startsWith("kanal:"))).toBe(true);
      expect(heard).toEqual([{ status: "denied", canAskAgain: true }]);
      // Gefragt (#1208): Android 13 meldet vorher wie nachher „denied“ - der Merker unterscheidet.
      expect(await isPushAsked()).toBe(true);
    } finally {
      Object.defineProperty(Platform, "OS", { configurable: true, get: () => os });
    }
  });

  test("schon erlaubt: keine zweite Frage", async () => {
    expect(await askPushPermission()).toEqual({ status: "granted", canAskAgain: true });
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
