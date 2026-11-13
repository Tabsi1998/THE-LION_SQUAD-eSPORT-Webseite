// Browser-Benachrichtigungen (#1163): wann gefragt wird, und wem eine Anmeldung im Browser gehört.
const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));

const webPush = await import("./webPush");
const { askDecision, markVisit, offerWebPush, enableWebPush, syncWebPush, forgetWebPush, browserPushStatus, keyBytes, needsHomeScreen, WEB_PUSH_EVENT } = webPush;

const CONFIG = { enabled: true, public_key: `B${"Q".repeat(86)}`, subscriptions: 0 };

function storage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}

function subscription(endpoint = "https://fcm.googleapis.com/fcm/send/abc", key = CONFIG.public_key) {
  return {
    endpoint,
    options: { applicationServerKey: keyBytes(key).buffer },
    toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
    unsubscribe: vi.fn(async () => true),
  };
}

function fakeWindow({ permission = "default", supported = true, ua = "Mozilla/5.0 (Windows NT 10.0) Chrome/130", standalone = false, existing = null, answer = "granted" } = {}) {
  const pushManager = {
    getSubscription: vi.fn(async () => existing),
    subscribe: vi.fn(async () => subscription("https://fcm.googleapis.com/fcm/send/neu")),
  };
  const win = new window.EventTarget();
  Object.assign(win, {
    localStorage: storage(),
    sessionStorage: storage(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    matchMedia: () => ({ matches: standalone }),
    navigator: { userAgent: ua, platform: "Win32", maxTouchPoints: 0 },
  });
  if (supported) {
    win.navigator.serviceWorker = { ready: Promise.resolve({ pushManager }) };
    win.PushManager = function PushManager() {};
    win.Notification = { permission, requestPermission: vi.fn(async () => answer) };
  }
  return { win, pushManager };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: CONFIG });
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  apiMock.delete.mockResolvedValue({ data: { ok: true } });
});

describe("Zeitpunkt der Frage", () => {
  const env = { supported: true, ios: false, standalone: false, permission: "default" };

  test("nie beim ersten Besuch - dann beim nächsten", () => {
    expect(askDecision({ config: CONFIG, env, state: "", firstVisit: true })).toBe("pending");
    expect(askDecision({ config: CONFIG, env, state: "pending", firstVisit: false })).toBe("ask");
  });

  test("nur einmal, und ein Nein bleibt ein Nein", () => {
    expect(askDecision({ config: CONFIG, env, state: "asked", firstVisit: false })).toBeNull();
    expect(askDecision({ config: CONFIG, env, state: "declined", firstVisit: false })).toBeNull();
    expect(askDecision({ config: CONFIG, env: { ...env, permission: "denied" }, state: "", firstVisit: false })).toBeNull();
    expect(askDecision({ config: CONFIG, env: { ...env, permission: "granted" }, state: "", firstVisit: false })).toBeNull();
  });

  test("ohne Schlüssel am Server keine Frage", () => {
    expect(askDecision({ config: { enabled: false }, env, state: "", firstVisit: false })).toBeNull();
  });

  test("am iPhone ohne Home-Bildschirm ein Hinweis statt der Frage", () => {
    const iphone = { supported: false, ios: true, standalone: false, permission: "unsupported" };
    expect(needsHomeScreen(iphone)).toBe(true);
    expect(askDecision({ config: CONFIG, env: iphone, state: "", firstVisit: false })).toBe("ios-hint");
    // Vom Home-Bildschirm aus kann das iPhone Web-Push - dann die echte Frage.
    expect(askDecision({ config: CONFIG, env: { supported: true, ios: true, standalone: true, permission: "default" }, state: "", firstVisit: false })).toBe("ask");
    // Ein Browser ohne Web-Push und kein iPhone: nichts.
    expect(askDecision({ config: CONFIG, env: { supported: false, ios: false, standalone: false }, state: "", firstVisit: false })).toBeNull();
  });

  test("der erste Besuch ist die erste Browser-Sitzung", () => {
    const { win } = fakeWindow();
    expect(markVisit(win)).toBe(true);
    expect(markVisit(win)).toBe(true);
    win.sessionStorage = storage();
    expect(markVisit(win)).toBe(false);
  });
});

describe("nach einer Anmeldung", () => {
  test("beim ersten Besuch wird die Frage aufgeschoben", async () => {
    const { win } = fakeWindow();
    const asked = vi.fn();
    win.addEventListener(WEB_PUSH_EVENT, asked);
    expect(await offerWebPush(win)).toBe("pending");
    expect(asked).not.toHaveBeenCalled();
    expect(win.localStorage.getItem("tls-web-push-ask")).toBe("pending");
  });

  test("bei einem späteren Besuch erscheint sie - mit dem Schlüssel des Servers", async () => {
    const { win } = fakeWindow();
    markVisit(win);
    win.sessionStorage = storage();
    const asked = vi.fn();
    win.addEventListener(WEB_PUSH_EVENT, asked);
    expect(await offerWebPush(win)).toBe("ask");
    expect(asked.mock.calls[0][0].detail).toEqual({ mode: "ask", config: CONFIG });
  });

  test("ohne Web-Push am Server bleibt alles still", async () => {
    apiMock.get.mockResolvedValue({ data: { enabled: false, public_key: null } });
    const { win } = fakeWindow();
    expect(await offerWebPush(win, { firstVisit: false })).toBeNull();
  });
});

describe("anmelden, auffrischen, abmelden", () => {
  test("Zustimmung meldet den Browser beim Server an und merkt das Konto", async () => {
    const { win, pushManager } = fakeWindow();
    const result = await enableWebPush({ id: "u1" }, CONFIG, win);
    expect(result).toEqual({ ok: true });
    expect(win.Notification.requestPermission).toHaveBeenCalled();
    expect(pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(apiMock.post).toHaveBeenCalledWith("/web-push/subscriptions", { endpoint: "https://fcm.googleapis.com/fcm/send/neu", keys: { p256dh: "p", auth: "a" } });
    expect(win.localStorage.getItem("tls-web-push-owner")).toBe("u1");
  });

  test("Ablehnen im Browser merkt sich die Seite", async () => {
    const { win, pushManager } = fakeWindow({ answer: "denied" });
    const result = await enableWebPush({ id: "u1" }, CONFIG, win);
    expect(result).toEqual({ ok: false, reason: "denied" });
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(win.localStorage.getItem("tls-web-push-ask")).toBe("declined");
  });

  test("beim Laden frischt dasselbe Konto seine Anmeldung auf", async () => {
    const existing = subscription();
    const { win } = fakeWindow({ permission: "granted", existing });
    win.localStorage.setItem("tls-web-push-owner", "u1");
    expect(await syncWebPush({ id: "u1" }, win)).toBe("synced");
    expect(apiMock.post).toHaveBeenCalledWith("/web-push/subscriptions", existing.toJSON());
    expect(existing.unsubscribe).not.toHaveBeenCalled();
  });

  test("ein anderes Konto im selben Browser bekommt nie die Meldungen des vorigen", async () => {
    const existing = subscription();
    const { win } = fakeWindow({ permission: "granted", existing });
    win.localStorage.setItem("tls-web-push-owner", "u1");
    expect(await syncWebPush({ id: "u2" }, win)).toBe("foreign");
    expect(existing.unsubscribe).toHaveBeenCalled();
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  test("neue Schlüssel am Server: alte Anmeldung weg, neue her", async () => {
    const existing = subscription("https://fcm.googleapis.com/fcm/send/alt", "BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    const { win, pushManager } = fakeWindow({ permission: "granted", existing });
    win.localStorage.setItem("tls-web-push-owner", "u1");
    expect(await syncWebPush({ id: "u1" }, win)).toBe("synced");
    expect(existing.unsubscribe).toHaveBeenCalled();
    expect(pushManager.subscribe).toHaveBeenCalled();
  });

  test("Abmelden vom Konto beendet die Anmeldung im Browser", async () => {
    const existing = subscription();
    const { win } = fakeWindow({ permission: "granted", existing });
    win.localStorage.setItem("tls-web-push-owner", "u1");
    await forgetWebPush(win);
    expect(existing.unsubscribe).toHaveBeenCalled();
    expect(win.localStorage.getItem("tls-web-push-owner")).toBeNull();
  });

  test("Zustand für die Einstellungen", async () => {
    expect(await browserPushStatus({ id: "u1" }, fakeWindow({ permission: "denied" }).win)).toBe("denied");
    expect(await browserPushStatus({ id: "u1" }, fakeWindow().win)).toBe("available");
    expect(await browserPushStatus({ id: "u1" }, fakeWindow({ supported: false }).win)).toBe("unsupported");
    expect(await browserPushStatus({ id: "u1" }, fakeWindow({ supported: false, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }).win)).toBe("ios-hint");
    const { win } = fakeWindow({ permission: "granted", existing: subscription() });
    win.localStorage.setItem("tls-web-push-owner", "u1");
    expect(await browserPushStatus({ id: "u1" }, win)).toBe("subscribed");
  });
});
