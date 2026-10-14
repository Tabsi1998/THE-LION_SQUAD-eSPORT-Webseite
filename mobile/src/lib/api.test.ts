import type { AxiosRequestConfig } from "axios";

// Der API-Client ist der gemeinsame Datenweg aller Screens. Zwei Dinge muessen
// stimmen: eine abgelaufene Sitzung wird still erneuert statt den Nutzer
// auszusperren, und wenn offline auf alte Daten zurueckgefallen wird, muss das
// erkennbar bleiben - sonst zeigt ein Screen veraltete Staende als aktuell an.

const mockGetStaleEntry = jest.fn();
const mockSetCached = jest.fn(async (..._args: unknown[]) => {});
const mockBuildCacheKey = jest.fn((..._args: unknown[]) => "cache-key");

const mockDeviceHeaders = jest.fn(async () => ({ "X-Device-Id": "geraet-1", "X-Device-Name": "Pixel 9 / Android 16" }));
jest.mock("./deviceIdentity", () => ({ deviceHeaders: () => mockDeviceHeaders() }));
jest.mock("./cache", () => ({
  buildCacheKey: (...args: unknown[]) => mockBuildCacheKey(...args),
  getStaleEntry: (...args: unknown[]) => mockGetStaleEntry(...args),
  setCached: (...args: unknown[]) => mockSetCached(...args),
  invalidateCache: jest.fn(async () => {}),
  clearAllCache: jest.fn(async () => {}),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api, configureAuthBridge, responseFromCache, refreshSession } = require("./api");
const network = require("./network");

type Handler = (config: AxiosRequestConfig) => Promise<unknown> | unknown;

let handler: Handler;
const persistSession = jest.fn(async () => {});
const clearSession = jest.fn(async () => {});
let tokens: { accessToken: string | null; refreshToken: string | null; userId: string | null } = { accessToken: "access-alt", refreshToken: "refresh-alt", userId: "u-1" };

function networkError(config: AxiosRequestConfig) {
  // Axios haengt bei echten Netzfehlern die Config an; ohne sie findet der
  // Interceptor den Cache-Schluessel nicht.
  const error: Error & { code?: string; config?: unknown; isAxiosError?: boolean } = new Error("Network Error");
  error.code = "ERR_NETWORK";
  error.config = config;
  error.isAxiosError = true;
  return error;
}

function httpError(status: number, config: AxiosRequestConfig) {
  const error: Error & { response?: unknown; config?: unknown; isAxiosError?: boolean } = new Error(`HTTP ${status}`);
  error.response = { status, data: {}, headers: {}, config };
  error.config = config;
  error.isAxiosError = true;
  return error;
}

beforeEach(() => {
  jest.clearAllMocks();
  tokens = { accessToken: "access-alt", refreshToken: "refresh-alt", userId: "u-1" };
  configureAuthBridge({
    readTokens: () => tokens,
    persistSession,
    clearSession,
  });
  // Der Adapter ersetzt das Netzwerk: jeder Testfall beschreibt, was der Server
  // auf welchen Aufruf antwortet.
  api.defaults.adapter = async (config: AxiosRequestConfig) => handler(config);
});

test("eine abgelaufene Sitzung wird erneuert und der Aufruf wiederholt", async () => {
  const seen: string[] = [];
  handler = async (config) => {
    const url = String(config.url);
    seen.push(url);
    if (url.includes("/auth/mobile/refresh")) {
      return { data: { user: { id: "u-1" }, access_token: "access-neu", refresh_token: "refresh-neu" }, status: 200, headers: {}, config };
    }
    if (seen.filter((entry) => entry === url).length === 1) throw httpError(401, config);
    return { data: { ok: true }, status: 200, headers: {}, config };
  };

  const { data } = await api.get("/dashboard");

  expect(data).toEqual({ ok: true });
  expect(seen).toContain("/auth/mobile/refresh");
  expect(persistSession).toHaveBeenCalledWith(expect.objectContaining({ access_token: "access-neu" }));
});

test("scheitert die Erneuerung, wird die Sitzung beendet statt endlos zu versuchen", async () => {
  handler = async (config) => {
    if (String(config.url).includes("/auth/mobile/refresh")) throw httpError(401, config);
    throw httpError(401, config);
  };

  await expect(api.get("/dashboard")).rejects.toBeTruthy();
  expect(clearSession).toHaveBeenCalled();
  expect(persistSession).not.toHaveBeenCalled();
});

test("ein 401 beim Anmelden loest keinen Erneuerungsversuch aus", async () => {
  const seen: string[] = [];
  handler = async (config) => {
    seen.push(String(config.url));
    throw httpError(401, config);
  };

  await expect(api.post("/auth/mobile/login", {})).rejects.toBeTruthy();

  expect(seen.filter((url) => url.includes("/auth/mobile/refresh"))).toHaveLength(0);
});

test("mehrere gleichzeitige 401er teilen sich eine einzige Erneuerung", async () => {
  let refreshCalls = 0;
  const retried = new Set<string>();
  handler = async (config) => {
    const url = String(config.url);
    if (url.includes("/auth/mobile/refresh")) {
      refreshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { data: { user: { id: "u-1" }, access_token: "access-neu", refresh_token: "refresh-neu" }, status: 200, headers: {}, config };
    }
    if (!retried.has(url)) {
      retried.add(url);
      throw httpError(401, config);
    }
    return { data: { url }, status: 200, headers: {}, config };
  };

  await Promise.all([api.get("/dashboard"), api.get("/notifications"), api.get("/teams")]);

  expect(refreshCalls).toBe(1);
});

test("offline wird auf zwischengespeicherte Daten zurueckgegriffen - erkennbar markiert, die Leiste kennt ihren Stand", async () => {
  network.resetNetwork();
  mockGetStaleEntry.mockResolvedValue({ data: { stand: "von gestern" }, timestamp: 1_700_000_000_000, ttl: 600000 });
  handler = async (config) => {
    throw networkError(config);
  };

  const response = await api.get("/dashboard");

  expect(response.data).toEqual({ stand: "von gestern" });
  expect(responseFromCache(response)).toBe(true);
  // #1152: offline mit dem Stand der gezeigten Daten - eine echte Antwort danach heißt wieder online.
  expect(network.networkSnapshot()).toEqual({ offline: true, stand: 1_700_000_000_000 });
  handler = async (config) => ({ data: { ok: true }, status: 200, headers: {}, config });
  await api.get("/dashboard");
  expect(network.networkSnapshot().offline).toBe(false);
  network.resetNetwork();
});

test("frische Antworten sind nicht als Cache markiert", async () => {
  handler = async (config) => ({ data: { ok: true }, status: 200, headers: {}, config });

  const response = await api.get("/dashboard");

  expect(responseFromCache(response)).toBe(false);
});

test("offline ohne Zwischenspeicher meldet den Fehler weiter", async () => {
  mockGetStaleEntry.mockResolvedValue(null);
  handler = async (config) => {
    throw networkError(config);
  };

  await expect(api.get("/dashboard")).rejects.toBeTruthy();
});

test("erfolgreiche GET-Antworten werden zwischengespeichert", async () => {
  handler = async (config) => ({ data: { ok: true }, status: 200, headers: {}, config });

  await api.get("/dashboard");

  expect(mockSetCached).toHaveBeenCalled();
});

// Gerät und Erneuerung (#942): jeder Aufruf trägt die Gerätekopfzeilen; App-Start und 401-Nachschlag teilen sich eine
// laufende Erneuerung, statt denselben Token zweimal zu drehen.
test("jeder Aufruf traegt Kennung und Name des Geraets", async () => {
  handler = async (config) => ({ data: {}, status: 200, statusText: "OK", headers: {}, config });
  const response = await api.get("/news");
  expect(response.config.headers["X-Device-Id"]).toBe("geraet-1");
  expect(response.config.headers["X-Device-Name"]).toBe("Pixel 9 / Android 16");
  expect(response.config.headers.Authorization).toBe("Bearer access-alt");
});

test("refreshSession: eine laufende Erneuerung wird geteilt - auch mit dem 401-Nachschlag", async () => {
  // Wie in der App: persistSession legt die neuen Token ab, der wiederholte Aufruf traegt das neue Zugangs-Token.
  (persistSession as jest.Mock).mockImplementation(async (session: { access_token: string; refresh_token: string }) => {
    tokens = { ...tokens, accessToken: session.access_token, refreshToken: session.refresh_token };
  });
  let refreshCalls = 0;
  let release: (value: unknown) => void = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  handler = async (config) => {
    if (config.url === "/auth/mobile/refresh") {
      refreshCalls += 1;
      await gate;
      return { data: { user: { id: "u-1" }, access_token: "access-neu", refresh_token: "refresh-neu" }, status: 200, statusText: "OK", headers: {}, config };
    }
    if (config.headers?.Authorization === "Bearer access-neu") return { data: { ok: true }, status: 200, statusText: "OK", headers: {}, config };
    throw httpError(401, config);
  };
  const fromBoot = refreshSession("refresh-alt");
  const fromCall = api.get("/profile");
  await new Promise((resolve) => setTimeout(resolve, 0));
  release(undefined);
  const [session, call] = await Promise.all([fromBoot, fromCall]);
  expect(refreshCalls).toBe(1);
  expect(session.access_token).toBe("access-neu");
  expect(call.data).toEqual({ ok: true });
  expect(persistSession).toHaveBeenCalledTimes(1);
  // Ohne Token (abgemeldet) gibt es nichts zu erneuern - abgelehnt, ohne Aufruf.
  tokens = { ...tokens, refreshToken: null };
  await expect(refreshSession(null)).rejects.toThrow("Kein Erneuerungs-Token");
  expect(refreshCalls).toBe(1);
});

// „Angemeldet bleiben“ hält (#1519): ein abgelaufenes Zugangs-Token darf nie still zum Gast machen, und nur eine vom
// Server abgelehnte Erneuerung beendet die Sitzung - kein Netzfehler, keine Störung, kein zweiter 401 nach dem Erneuern.
describe("Sitzung erneuern (#1519)", () => {
  function jwt(expiresInSeconds: number, tag = "alt"): string {
    const payload = Buffer.from(JSON.stringify({ sub: "u-1", tag, exp: Math.floor(Date.now() / 1000) + expiresInSeconds })).toString("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`;
  }
  const FRESH = jwt(12 * 3600, "neu");
  const refreshed = { user: { id: "u-1" }, access_token: FRESH, refresh_token: "refresh-neu" };

  beforeEach(() => {
    (persistSession as jest.Mock).mockImplementation(async (session: { access_token: string; refresh_token: string }) => {
      tokens = { ...tokens, accessToken: session.access_token, refreshToken: session.refresh_token };
    });
  });

  test("ein abgelaufenes Zugangs-Token wird vor dem Aufruf erneuert - öffentliche Aufrufe sähen sonst einen Gast", async () => {
    tokens = { accessToken: jwt(-60), refreshToken: "refresh-alt", userId: "u-1" };
    const seen: string[] = [];
    handler = async (config) => {
      seen.push(String(config.url));
      if (config.url === "/auth/mobile/refresh") return { data: refreshed, status: 200, headers: {}, config };
      // Wie der Server bei öffentlichen Aufrufen: ein abgelaufenes Token zählt dort still als Gast (200, kein 401).
      const signedIn = config.headers?.Authorization === `Bearer ${FRESH}`;
      return { data: { signedIn }, status: 200, headers: {}, config };
    };

    const { data } = await api.get("/mobile/dashboard");

    expect(data).toEqual({ signedIn: true });
    expect(seen).toEqual(["/auth/mobile/refresh", "/mobile/dashboard"]);
    expect(persistSession).toHaveBeenCalledTimes(1);
    expect(clearSession).not.toHaveBeenCalled();
  });

  test("zwei gleichzeitige Aufrufe mit abgelaufenem Token: genau eine Erneuerung, beide mit dem neuen Token", async () => {
    tokens = { accessToken: jwt(-60), refreshToken: "refresh-alt", userId: "u-1" };
    const refreshTokensSent: unknown[] = [];
    handler = async (config) => {
      if (config.url === "/auth/mobile/refresh") {
        refreshTokensSent.push(JSON.parse(String(config.data)).refresh_token);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { data: refreshed, status: 200, headers: {}, config };
      }
      if (config.headers?.Authorization !== `Bearer ${FRESH}`) throw httpError(401, config);
      return { data: { url: config.url }, status: 200, headers: {}, config };
    };

    const [first, second] = await Promise.all([api.get("/dashboard"), api.get("/notifications")]);

    expect(refreshTokensSent).toEqual(["refresh-alt"]);
    expect(first.data).toEqual({ url: "/dashboard" });
    expect(second.data).toEqual({ url: "/notifications" });
    expect(clearSession).not.toHaveBeenCalled();
  });

  test("kein Netz beim Erneuern meldet nicht ab", async () => {
    handler = async (config) => {
      if (config.url === "/auth/mobile/refresh") throw networkError(config);
      throw httpError(401, config);
    };

    await expect(api.get("/dashboard")).rejects.toBeTruthy();

    expect(clearSession).not.toHaveBeenCalled();
    expect(tokens.refreshToken).toBe("refresh-alt");
  });

  test("Zeitüberschreitung oder Serverstörung beim Erneuern meldet nicht ab", async () => {
    for (const failure of ["timeout", "502"]) {
      handler = async (config) => {
        if (config.url === "/auth/mobile/refresh") {
          if (failure === "502") throw httpError(502, config);
          throw Object.assign(new Error("timeout of 15000ms exceeded"), { code: "ECONNABORTED", config, isAxiosError: true });
        }
        throw httpError(401, config);
      };
      await expect(api.get("/dashboard")).rejects.toBeTruthy();
    }

    expect(clearSession).not.toHaveBeenCalled();
  });

  test("ein abgelaufenes Token ohne Netz: der Aufruf scheitert am Netz, die Sitzung bleibt", async () => {
    tokens = { accessToken: jwt(-60), refreshToken: "refresh-alt", userId: "u-1" };
    handler = async (config) => {
      throw networkError(config);
    };

    await expect(api.get("/dashboard")).rejects.toBeTruthy();

    expect(clearSession).not.toHaveBeenCalled();
  });

  test("ein 401 nach erfolgreicher Erneuerung beendet die Sitzung nicht", async () => {
    handler = async (config) => {
      if (config.url === "/auth/mobile/refresh") return { data: refreshed, status: 200, headers: {}, config };
      throw httpError(401, config);
    };

    await expect(api.get("/tournaments/t-1/bracket")).rejects.toBeTruthy();

    expect(persistSession).toHaveBeenCalledTimes(1);
    expect(clearSession).not.toHaveBeenCalled();
  });

  test("ein 401 auf einen Anmeldeversuch beendet die bestehende Sitzung nicht", async () => {
    handler = async (config) => {
      throw httpError(401, config);
    };

    await expect(api.post("/auth/mobile/login", {})).rejects.toBeTruthy();

    expect(clearSession).not.toHaveBeenCalled();
  });

  test("lehnt der Server die Erneuerung ab, endet die Sitzung - auch beim Erneuern vor dem Aufruf", async () => {
    tokens = { accessToken: jwt(-60), refreshToken: "refresh-alt", userId: "u-1" };
    const seen: Array<{ url: string; auth: unknown }> = [];
    handler = async (config) => {
      seen.push({ url: String(config.url), auth: config.headers?.Authorization });
      if (config.url === "/auth/mobile/refresh") throw httpError(401, config);
      return { data: { ok: true }, status: 200, headers: {}, config };
    };

    await api.get("/news");

    expect(clearSession).toHaveBeenCalledTimes(1);
    // Der Aufruf geht ohne das abgelaufene Token weiter - als Gast, wie nach dem Abmelden.
    expect(seen[seen.length - 1]).toEqual({ url: "/news", auth: undefined });
  });

  test("vorgehende Geräteuhr: ein frisch erhaltenes Token wird nicht bei jedem Aufruf erneuert", async () => {
    // exp liegt laut Geräteuhr schon zurück (Uhr geht einen Tag vor), erhalten wurde das Token aber gerade eben.
    const nowSeconds = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({ sub: "u-1", iat: nowSeconds - 24 * 3600, exp: nowSeconds - 12 * 3600 })).toString("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    tokens = { accessToken: `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`, refreshToken: "refresh-alt", userId: "u-1", accessReceivedAt: Date.now() - 1000 } as typeof tokens;
    const seen: string[] = [];
    handler = async (config) => {
      seen.push(String(config.url));
      return { data: { ok: true }, status: 200, headers: {}, config };
    };

    await api.get("/news");

    expect(seen).toEqual(["/news"]);
  });
});

// Rennen um die Sitzung (#1519): eine Erneuerung, die noch für die vorige Sitzung lief, darf nach Abmelden oder
// Kontowechsel weder deren Tokens zurückbringen noch die neue Sitzung abmelden.
describe("Erneuerung über einen Sitzungswechsel hinweg (#1519)", () => {
  type Snapshot = { accessToken: string | null; refreshToken: string | null; userId: string | null; generation?: number };
  function jwt(expiresInSeconds: number, tag: string): string {
    const payload = Buffer.from(JSON.stringify({ sub: tag, exp: Math.floor(Date.now() / 1000) + expiresInSeconds })).toString("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `eyJhbGciOiJIUzI1NiJ9.${payload}.${tag}`;
  }
  const ACCESS_B = jwt(12 * 3600, "b");
  let state: Snapshot;
  let release: (outcome: "ok" | "401") => void;

  beforeEach(() => {
    state = { accessToken: jwt(-60, "a"), refreshToken: "refresh-a", userId: "u-a", generation: 1 };
    configureAuthBridge({
      readTokens: () => state,
      persistSession: persistSession as unknown as (session: unknown) => Promise<void>,
      clearSession,
    });
    (persistSession as jest.Mock).mockImplementation(async () => {});
  });

  function gatedRefresh(seen: Array<{ url: string; auth: unknown }>) {
    const gate = new Promise<"ok" | "401">((resolve) => { release = resolve; });
    handler = async (config) => {
      seen.push({ url: String(config.url), auth: config.headers?.Authorization });
      if (config.url === "/auth/mobile/refresh") {
        if ((await gate) === "401") throw httpError(401, config);
        return { data: { user: { id: "u-a" }, access_token: jwt(12 * 3600, "a2"), refresh_token: "refresh-a2" }, status: 200, headers: {}, config };
      }
      return { data: { ok: true }, status: 200, headers: {}, config };
    };
  }

  test("Abmelden während der Erneuerung: A kommt nicht zurück, der Aufruf geht als Gast", async () => {
    const seen: Array<{ url: string; auth: unknown }> = [];
    gatedRefresh(seen);
    const call = api.get("/news");
    await new Promise((resolve) => setTimeout(resolve, 0));
    state = { accessToken: null, refreshToken: null, userId: "guest", generation: 2 };
    release("ok");
    await call;

    expect(persistSession).not.toHaveBeenCalled();
    expect(seen[seen.length - 1]).toEqual({ url: "/news", auth: undefined });
  });

  test("Abmelden während einer abgelehnten Erneuerung: kein zweites Abmelden, kein Hinweis", async () => {
    const seen: Array<{ url: string; auth: unknown }> = [];
    gatedRefresh(seen);
    const call = api.get("/news");
    await new Promise((resolve) => setTimeout(resolve, 0));
    state = { accessToken: null, refreshToken: null, userId: "guest", generation: 2 };
    release("401");
    await call;

    expect(clearSession).not.toHaveBeenCalled();
  });

  test("Kontowechsel A→B während der Erneuerung: B bleibt, A überschreibt nichts und meldet B nicht ab", async () => {
    for (const outcome of ["ok", "401"] as const) {
      jest.clearAllMocks();
      state = { accessToken: jwt(-60, "a"), refreshToken: "refresh-a", userId: "u-a", generation: 1 };
      const seen: Array<{ url: string; auth: unknown }> = [];
      gatedRefresh(seen);
      const call = api.get("/news");
      await new Promise((resolve) => setTimeout(resolve, 0));
      state = { accessToken: ACCESS_B, refreshToken: "refresh-b", userId: "u-b", generation: 2 };
      release(outcome);
      await call;

      expect(persistSession).not.toHaveBeenCalled();
      expect(clearSession).not.toHaveBeenCalled();
      expect(seen[seen.length - 1]).toEqual({ url: "/news", auth: `Bearer ${ACCESS_B}` });
    }
  });

  test("ein 401 auf einen Aufruf von A nach dem Wechsel zu B erneuert nicht mit B", async () => {
    state = { accessToken: "access-a", refreshToken: "refresh-a", userId: "u-a", generation: 1 };
    const seen: string[] = [];
    let respond: () => void = () => {};
    handler = async (config) => {
      seen.push(String(config.url));
      await new Promise<void>((resolve) => { respond = resolve; });
      throw httpError(401, config);
    };
    const call = api.get("/profile");
    await new Promise((resolve) => setTimeout(resolve, 0));
    state = { accessToken: "access-b", refreshToken: "refresh-b", userId: "u-b", generation: 2 };
    respond();

    await expect(call).rejects.toBeTruthy();
    expect(seen).toEqual(["/profile"]);
    expect(clearSession).not.toHaveBeenCalled();
  });

  test("eine laufende Erneuerung wird nur für denselben Erneuerungs-Token geteilt", async () => {
    const sent: unknown[] = [];
    handler = async (config) => {
      sent.push(JSON.parse(String(config.data)).refresh_token);
      return { data: { user: { id: "u" }, access_token: "x", refresh_token: "y" }, status: 200, headers: {}, config };
    };
    await Promise.all([refreshSession("refresh-a"), refreshSession("refresh-a"), refreshSession("refresh-b")]);
    expect(sent).toEqual(["refresh-a", "refresh-b"]);
  });
});

// Herkunft (#1060): Token und Gerätekennung gehen nur an den eigenen Server. Eine Adresse anderer Herkunft (etwa aus
// einer Antwort des Servers) läuft ohne beides - und ein 401 von dort erneuert nichts.
describe("Anmeldung nur für den eigenen Server (#1060)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { API_BASE_URL } = require("../config");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { FOREIGN_ARTICLE_LINKS } = require("./linkOrigins.fixture");
  let seen: Array<{ url: string; auth: unknown; device: unknown }>;

  beforeEach(() => {
    seen = [];
    handler = async (config) => {
      const headers = config.headers as Record<string, unknown> | undefined;
      seen.push({ url: String(config.url), auth: headers?.Authorization, device: headers?.["X-Device-Id"] });
      return { data: {}, status: 200, headers: {}, config };
    };
  });

  test("relative Pfade und Adressen des eigenen Servers tragen Token und Gerät", async () => {
    await api.get("/news");
    await api.get(`${API_BASE_URL}/api/chat-attachments/a1?w=800`);
    expect(seen.map(({ auth, device }) => [auth, device])).toEqual([["Bearer access-alt", "geraet-1"], ["Bearer access-alt", "geraet-1"]]);
  });

  test("andere Herkunft: weder Token noch Gerät", async () => {
    const absolute = FOREIGN_ARTICLE_LINKS.filter((link: string) => /^(https?:)?\/\//i.test(link));
    expect(absolute.length).toBeGreaterThan(5);
    for (const link of absolute) await api.get(link).catch(() => undefined);
    expect(seen.length).toBe(absolute.length);
    for (const call of seen) expect(call).toEqual({ url: call.url, auth: undefined, device: undefined });
  });

  test("ein 401 einer anderen Herkunft erneuert die Sitzung nicht und wiederholt nichts", async () => {
    handler = async (config) => {
      seen.push({ url: String(config.url), auth: (config.headers as Record<string, unknown>)?.Authorization, device: undefined });
      throw httpError(401, config);
    };
    await expect(api.get("https://cdn.example/bild.png")).rejects.toBeTruthy();
    expect(seen).toEqual([{ url: "https://cdn.example/bild.png", auth: undefined, device: undefined }]);
    expect(persistSession).not.toHaveBeenCalled();
    expect(clearSession).not.toHaveBeenCalled();
  });
});

// Sitzungsende (#1057): eine Antwort, die erst nach Abmelden oder Kontowechsel ankommt, landet nicht mehr im
// Zwischenspeicher.
test("eine Antwort der vorigen Sitzung wird nicht mehr zwischengespeichert", async () => {
  let snapshot: { accessToken: string | null; refreshToken: string | null; userId: string | null; generation: number } =
    { accessToken: "access-a", refreshToken: "refresh-a", userId: "u-a", generation: 1 };
  configureAuthBridge({ readTokens: () => snapshot, persistSession, clearSession });
  handler = async (config) => {
    snapshot = { accessToken: null, refreshToken: null, userId: "guest", generation: 2 };
    return { data: { privat: true }, status: 200, headers: {}, config };
  };
  await api.get("/profile");
  expect(mockSetCached).not.toHaveBeenCalled();

  handler = async (config) => ({ data: { ok: true }, status: 200, headers: {}, config });
  await api.get("/news");
  expect(mockSetCached).toHaveBeenCalledTimes(1);
});
