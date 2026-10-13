import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { Alert } from "react-native";
import { AuthProvider, useAuth } from "./AuthContext";
import { isGuestUser } from "../live";

// Der Anmeldepfad der App. Getestet werden die Zusagen, die man einem Nutzer
// nicht stillschweigend brechen darf: Tokens nur speichern, wenn "angemeldet
// bleiben" gewaehlt wurde, beim Abmelden wirklich alles loeschen, vor
// abgeschlossener MFA nichts ablegen, und die Sitzung nach abgelaufenem
// Access-Token ueber den Refresh-Token wiederherstellen statt auszusperren.
// Gast zuerst (#918): ohne Sitzung ist man Gast - die App bleibt offen.

const mockApi = { get: jest.fn(), post: jest.fn(), delete: jest.fn(), put: jest.fn() };
const mockClearAllCache = jest.fn(async (..._args: unknown[]) => {});
const mockUnregisterPushToken = jest.fn(async (..._args: unknown[]) => {});
const mockDismissAllNotifications = jest.fn(async (..._args: unknown[]) => {});
const mockSetPushAccount = jest.fn();

// Die Fabriken werden vor den Konstanten oben ausgefuehrt, deshalb wird die
// Referenz erst beim Aufruf aufgeloest statt beim Erzeugen des Mocks.
jest.mock("../lib/api", () => ({
  api: {
    get: (...args: unknown[]) => mockApi.get(...args),
    post: (...args: unknown[]) => mockApi.post(...args),
    put: (...args: unknown[]) => mockApi.put(...args),
    delete: (...args: unknown[]) => mockApi.delete(...args),
  },
  configureAuthBridge: jest.fn(),
  // Der gemeinsame Erneuerungsweg (#942) läuft hier über denselben post-Mock wie früher der direkte Aufruf.
  refreshSession: (token: string) => mockApi.post("/auth/mobile/refresh", { refresh_token: token }).then((response: { data: unknown }) => response.data),
}));
jest.mock("../lib/cache", () => ({ clearAllCache: (...args: unknown[]) => mockClearAllCache(...args) }));
jest.mock("../notifications/PushService", () => ({
  unregisterPushToken: (...args: unknown[]) => mockUnregisterPushToken(...args),
  dismissAllNotifications: (...args: unknown[]) => mockDismissAllNotifications(...args),
  setPushAccount: (...args: unknown[]) => mockSetPushAccount(...args),
}));

const ACCESS_KEY = "tls.mobile.accessToken";
const REFRESH_KEY = "tls.mobile.refreshToken";
const REMEMBER_KEY = "tls.mobile.rememberSession";

const USER = { id: "u-1", username: "lionfan", display_name: "Lion Fan" };
const SESSION = { user: USER, access_token: "access-neu", refresh_token: "refresh-neu" };
const USER_KEY = "tls.mobile.user";

/** Ein Zugangs-Token mit Ablauf (#942): der Start liest ihn und entscheidet ohne Probeaufruf. */
function accessToken(expiresInSeconds: number): string {
  const payload = Buffer.from(JSON.stringify({ sub: "u-1", exp: Math.floor(Date.now() / 1000) + expiresInSeconds })).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`;
}
function networkError() {
  return Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" });
}
function rejected(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status, data: {} } });
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

async function renderAuth() {
  // renderHook liefert ab RNTL 14 ein Promise.
  const view = await renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.get.mockRejectedValue(new Error("kein Token"));
  mockApi.post.mockResolvedValue({ data: SESSION });
});

describe("Anmelden", () => {
  test("mit 'angemeldet bleiben' werden beide Tokens sicher abgelegt", async () => {
    const { result } = await renderAuth();

    await act(async () => {
      await result.current.login("fan@lionsquad.at", "geheim", true);
    });

    expect(await SecureStore.getItemAsync(ACCESS_KEY)).toBe("access-neu");
    expect(await SecureStore.getItemAsync(REFRESH_KEY)).toBe("refresh-neu");
    expect(await SecureStore.getItemAsync(REMEMBER_KEY)).toBe("true");
    expect(result.current.user).toEqual(USER);
  });

  test("ohne 'angemeldet bleiben' wird kein Token auf das Geraet geschrieben", async () => {
    const { result } = await renderAuth();

    await act(async () => {
      await result.current.login("fan@lionsquad.at", "geheim", false);
    });

    expect(await SecureStore.getItemAsync(ACCESS_KEY)).toBeNull();
    expect(await SecureStore.getItemAsync(REFRESH_KEY)).toBeNull();
    expect(await SecureStore.getItemAsync(REMEMBER_KEY)).toBe("false");
    // Angemeldet ist man trotzdem - nur eben nur fuer diese Sitzung.
    expect(result.current.user).toEqual(USER);
  });

  test("bei geforderter MFA wird noch keine Sitzung abgelegt", async () => {
    mockApi.post.mockResolvedValue({ data: { mfa_required: true, mfa_ticket: "ticket-1" } });
    const { result } = await renderAuth();

    let outcome: { mfaRequired: boolean; ticket?: string } | undefined;
    await act(async () => {
      outcome = await result.current.login("admin@lionsquad.at", "geheim", true);
    });

    expect(outcome?.mfaRequired).toBe(true);
    expect(outcome?.ticket).toBe("ticket-1");
    expect(isGuestUser(result.current.user)).toBe(true);
    expect(await SecureStore.getItemAsync(ACCESS_KEY)).toBeNull();
  });

  test("erst der abgeschlossene MFA-Schritt legt die Sitzung an", async () => {
    const { result } = await renderAuth();

    await act(async () => {
      await result.current.completeMfa("ticket-1", "123456", true);
    });

    expect(mockApi.post).toHaveBeenCalledWith("/auth/mfa/complete", expect.objectContaining({ ticket: "ticket-1", client: "mobile" }));
    expect(await SecureStore.getItemAsync(ACCESS_KEY)).toBe("access-neu");
  });
});

describe("Sitzung beim App-Start", () => {
  test("ein gueltiges Access-Token stellt den Nutzer wieder her", async () => {
    await SecureStore.setItemAsync(ACCESS_KEY, accessToken(3600));
    await SecureStore.setItemAsync(REFRESH_KEY, "refresh-alt");
    await SecureStore.setItemAsync(REMEMBER_KEY, "true");
    mockApi.get.mockResolvedValue({ data: USER });

    const { result } = await renderAuth();

    expect(result.current.user).toEqual(USER);
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  test("ein abgelaufenes Access-Token wird ueber den Refresh-Token ersetzt - ohne Probeaufruf, genau einmal (#942)", async () => {
    await SecureStore.setItemAsync(ACCESS_KEY, accessToken(-60));
    await SecureStore.setItemAsync(REFRESH_KEY, "refresh-alt");
    await SecureStore.setItemAsync(REMEMBER_KEY, "true");

    const { result } = await renderAuth();

    expect(mockApi.get).not.toHaveBeenCalled();
    expect(mockApi.post).toHaveBeenCalledTimes(1);
    expect(mockApi.post).toHaveBeenCalledWith("/auth/mobile/refresh", { refresh_token: "refresh-alt" });
    expect(result.current.user).toEqual(USER);
    expect(await SecureStore.getItemAsync(ACCESS_KEY)).toBe("access-neu");
    expect(JSON.parse((await SecureStore.getItemAsync(USER_KEY)) || "null")).toEqual(USER);
  });

  test("offline beim Start: die Sitzung bleibt, das gemerkte Konto ist da, nichts wird geloescht (#942)", async () => {
    await SecureStore.setItemAsync(ACCESS_KEY, accessToken(-60));
    await SecureStore.setItemAsync(REFRESH_KEY, "refresh-alt");
    await SecureStore.setItemAsync(REMEMBER_KEY, "true");
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(USER));
    mockApi.post.mockRejectedValue(networkError());

    const { result } = await renderAuth();

    expect(result.current.user).toEqual(USER);
    expect(result.current.refreshToken).toBe("refresh-alt");
    expect(await SecureStore.getItemAsync(REFRESH_KEY)).toBe("refresh-alt");
    expect(mockClearAllCache).not.toHaveBeenCalled();
  });

  test("offline mit gueltigem Access-Token: /auth/me scheitert am Netz, das gemerkte Konto traegt (#942)", async () => {
    await SecureStore.setItemAsync(ACCESS_KEY, accessToken(3600));
    await SecureStore.setItemAsync(REFRESH_KEY, "refresh-alt");
    await SecureStore.setItemAsync(REMEMBER_KEY, "true");
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(USER));
    mockApi.get.mockRejectedValue(networkError());

    const { result } = await renderAuth();

    expect(result.current.user).toEqual(USER);
    expect(mockApi.post).not.toHaveBeenCalled();
    expect(await SecureStore.getItemAsync(ACCESS_KEY)).not.toBeNull();
  });

  test("ein 401 auf /auth/me bei gueltigem Token: einmal erneuern statt sofort abmelden (#942)", async () => {
    await SecureStore.setItemAsync(ACCESS_KEY, accessToken(3600));
    await SecureStore.setItemAsync(REFRESH_KEY, "refresh-alt");
    await SecureStore.setItemAsync(REMEMBER_KEY, "true");
    mockApi.get.mockRejectedValue(rejected(401));

    const { result } = await renderAuth();

    expect(mockApi.post).toHaveBeenCalledTimes(1);
    expect(result.current.user).toEqual(USER);
  });

  test("ein abgelehnter Refresh meldet sauber ab - als Gast, statt haengen zu bleiben", async () => {
    await SecureStore.setItemAsync(REFRESH_KEY, "refresh-ungueltig");
    await SecureStore.setItemAsync(REMEMBER_KEY, "true");
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(USER));
    mockApi.post.mockRejectedValue(rejected(401));

    const { result } = await renderAuth();

    expect(isGuestUser(result.current.user)).toBe(true);
    expect(await SecureStore.getItemAsync(REFRESH_KEY)).toBeNull();
    expect(await SecureStore.getItemAsync(USER_KEY)).toBeNull();
  });

  test("wer 'angemeldet bleiben' abgewaehlt hat, wird beim Start nicht wiederhergestellt", async () => {
    await SecureStore.setItemAsync(ACCESS_KEY, accessToken(3600));
    await SecureStore.setItemAsync(REFRESH_KEY, "refresh-alt");
    await SecureStore.setItemAsync(REMEMBER_KEY, "false");

    const { result } = await renderAuth();

    expect(isGuestUser(result.current.user)).toBe(true);
    expect(await SecureStore.getItemAsync(ACCESS_KEY)).toBeNull();
    expect(mockApi.get).not.toHaveBeenCalled();
  });
});

describe("Abmelden", () => {
  test("loescht Tokens, informiert das Backend und raeumt den Cache", async () => {
    const { result } = await renderAuth();
    await act(async () => {
      await result.current.login("fan@lionsquad.at", "geheim", true);
    });
    mockApi.post.mockClear();
    // Die letzten Suchen (#1145) gehen mit dem Konto.
    await SecureStore.setItemAsync("tls.recent-searches", JSON.stringify(["rocket"]));
    // Die gespeicherte Mitgliedskarte (#1256) auch.
    await SecureStore.setItemAsync("tls.member-card", JSON.stringify({ user_id: "u-1", saved_at: "2026-10-07T16:05:00Z", card: { name: "Fan" } }));

    await act(async () => {
      await result.current.logout();
    });

    expect(mockApi.post).toHaveBeenCalledWith("/auth/mobile/logout", { refresh_token: "refresh-neu" });
    expect(mockUnregisterPushToken).toHaveBeenCalled();
    expect(await SecureStore.getItemAsync(ACCESS_KEY)).toBeNull();
    expect(await SecureStore.getItemAsync(REFRESH_KEY)).toBeNull();
    expect(mockClearAllCache).toHaveBeenCalled();
    expect(await SecureStore.getItemAsync("tls.recent-searches")).toBeNull();
    expect(await SecureStore.getItemAsync("tls.member-card")).toBeNull();
    expect(isGuestUser(result.current.user)).toBe(true);
  });

  test("auch wenn das Backend nicht antwortet, ist man lokal abgemeldet", async () => {
    const { result } = await renderAuth();
    await act(async () => {
      await result.current.login("fan@lionsquad.at", "geheim", true);
    });
    mockApi.post.mockRejectedValue(new Error("offline"));

    await act(async () => {
      await result.current.logout().catch(() => {});
    });

    expect(await SecureStore.getItemAsync(ACCESS_KEY)).toBeNull();
    expect(isGuestUser(result.current.user)).toBe(true);
  });
});

describe("Gast zuerst (#918)", () => {
  test("ohne gespeicherte Sitzung startet die App als Gast - ohne Tokens und ohne Anfrage an den Server", async () => {
    const { result } = await renderAuth();

    expect(isGuestUser(result.current.user)).toBe(true);
    expect(result.current.accessToken).toBeNull();
    expect(await SecureStore.getItemAsync(ACCESS_KEY)).toBeNull();
    expect(mockApi.get).not.toHaveBeenCalled();
    expect(mockApi.post).not.toHaveBeenCalled();
  });
});

describe("Passkey-Angebot (#919)", () => {
  test("nach der Passwort-Anmeldung mit Ticket bietet die App einen Passkey an; Abmelden nimmt das Angebot zurück", async () => {
    mockApi.post.mockResolvedValue({ data: { ...SESSION, passkey_ticket: "enroll-1" } });
    const { result } = await renderAuth();
    expect(result.current.passkeyOffer).toBeNull();

    await act(async () => {
      await result.current.login("fan@lionsquad.at", "geheim", true);
    });
    expect(result.current.passkeyOffer).toEqual({ ticket: "enroll-1", userId: "u-1", deviceWithout: false });

    await act(async () => {
      await result.current.logout();
    });
    expect(result.current.passkeyOffer).toBeNull();
  });

  test("ohne Ticket (Server ohne App-Passkeys) kein Angebot; nach dem MFA-Schritt mit Ticket schon", async () => {
    const { result } = await renderAuth();
    await act(async () => {
      await result.current.login("fan@lionsquad.at", "geheim", true);
    });
    expect(result.current.passkeyOffer).toBeNull();

    mockApi.post.mockResolvedValue({ data: { ...SESSION, passkey_ticket: "enroll-2" } });
    // Kein Passkey auf diesem Gerät (#939): das Angebot sagt es weiter - die Einladung gilt dann auch bei Passkeys anderswo.
    await act(async () => {
      await result.current.completeMfa("ticket-1", "123456", true, true);
    });
    expect(result.current.passkeyOffer).toEqual({ ticket: "enroll-2", userId: "u-1", deviceWithout: true });
    await act(async () => {
      result.current.clearPasskeyOffer();
    });
    expect(result.current.passkeyOffer).toBeNull();
  });
});

describe("Kontowechsel", () => {
  test("beim Wechsel auf ein anderes Konto wird der Cache geleert", async () => {
    const { result } = await renderAuth();
    await act(async () => {
      await result.current.login("fan@lionsquad.at", "geheim", true);
    });
    mockClearAllCache.mockClear();

    mockApi.post.mockResolvedValue({
      data: { user: { ...USER, id: "u-2" }, access_token: "a2", refresh_token: "r2" },
    });
    await act(async () => {
      await result.current.login("zweiter@lionsquad.at", "geheim", true);
    });

    expect(mockClearAllCache).toHaveBeenCalled();
    expect(result.current.user?.id).toBe("u-2");
  });

  // #1053: ein Wechsel A→B räumt so gründlich auf wie das Abmelden - das Gerät wird für A abgemeldet, solange A noch
  // die Sitzung ist, und Suchen, Mitgliedskarte und Systemhinweise von A bleiben nicht für B liegen.
  test("A→B meldet das Gerät für A ab und räumt die Daten von A weg", async () => {
    const { configureAuthBridge } = jest.requireMock("../lib/api") as { configureAuthBridge: jest.Mock };
    const { result } = await renderAuth();
    await act(async () => {
      await result.current.login("fan@lionsquad.at", "geheim", true);
    });
    await SecureStore.setItemAsync("tls.recent-searches", JSON.stringify(["rocket"]));
    await SecureStore.setItemAsync("tls.member-card", JSON.stringify({ user_id: "u-1", saved_at: "2026-10-07T16:05:00Z", card: { name: "Fan" } }));
    mockUnregisterPushToken.mockClear();
    mockDismissAllNotifications.mockClear();
    let tokenAtUnregister: string | null = null;
    mockUnregisterPushToken.mockImplementationOnce(async () => {
      const bridge = configureAuthBridge.mock.calls.at(-1)?.[0] as { readTokens: () => { accessToken: string | null } };
      tokenAtUnregister = bridge.readTokens().accessToken;
    });

    mockApi.post.mockResolvedValue({ data: { user: { ...USER, id: "u-2" }, access_token: "a2", refresh_token: "r2" } });
    await act(async () => {
      await result.current.login("zweiter@lionsquad.at", "geheim", true);
    });

    expect(mockUnregisterPushToken).toHaveBeenCalledTimes(1);
    expect(tokenAtUnregister).toBe("access-neu");
    // Ab jetzt gelten nur noch Pushes von B.
    expect(mockSetPushAccount).toHaveBeenLastCalledWith("u-2");
    expect(mockDismissAllNotifications).toHaveBeenCalled();
    expect(await SecureStore.getItemAsync("tls.recent-searches")).toBeNull();
    expect(await SecureStore.getItemAsync("tls.member-card")).toBeNull();
    expect(result.current.user?.id).toBe("u-2");
    expect(await SecureStore.getItemAsync(ACCESS_KEY)).toBe("a2");
  });

  test("eine erneuerte Sitzung desselben Kontos behält alles", async () => {
    const { configureAuthBridge } = jest.requireMock("../lib/api") as { configureAuthBridge: jest.Mock };
    const { result } = await renderAuth();
    await act(async () => {
      await result.current.login("fan@lionsquad.at", "geheim", true);
    });
    await SecureStore.setItemAsync("tls.recent-searches", JSON.stringify(["rocket"]));
    mockUnregisterPushToken.mockClear();
    mockClearAllCache.mockClear();

    const bridge = configureAuthBridge.mock.calls.at(-1)?.[0] as { persistSession: (session: unknown) => Promise<void> };
    await act(async () => {
      await bridge.persistSession({ ...SESSION, access_token: "access-2", refresh_token: "refresh-2" });
    });

    expect(mockUnregisterPushToken).not.toHaveBeenCalled();
    expect(mockClearAllCache).not.toHaveBeenCalled();
    expect(await SecureStore.getItemAsync("tls.recent-searches")).toBe(JSON.stringify(["rocket"]));
    expect(result.current.user?.id).toBe("u-1");
  });

  test("schlägt das Abmelden des Geräts für A fehl, geht der Wechsel trotzdem durch", async () => {
    const { result } = await renderAuth();
    await act(async () => {
      await result.current.login("fan@lionsquad.at", "geheim", true);
    });
    mockUnregisterPushToken.mockRejectedValueOnce(new Error("offline"));

    mockApi.post.mockResolvedValue({ data: { user: { ...USER, id: "u-2" }, access_token: "a2", refresh_token: "r2" } });
    await act(async () => {
      await result.current.login("zweiter@lionsquad.at", "geheim", true);
    });

    // Den Rest erledigt der Server, sobald sich das Gerät für B anmeldet.
    expect(result.current.user?.id).toBe("u-2");
    expect(mockSetPushAccount).toHaveBeenLastCalledWith("u-2");
  });

  test("abgemeldet gilt kein Push mehr als eigener", async () => {
    const { result } = await renderAuth();
    await act(async () => {
      await result.current.login("fan@lionsquad.at", "geheim", true);
    });
    await act(async () => {
      await result.current.logout();
    });
    expect(mockSetPushAccount).toHaveBeenLastCalledWith(null);
  });

  test("Gast→Anmeldung meldet kein Gerät ab", async () => {
    const { result } = await renderAuth();
    await act(async () => {
      await result.current.login("fan@lionsquad.at", "geheim", true);
    });

    expect(mockUnregisterPushToken).not.toHaveBeenCalled();
    expect(result.current.user?.id).toBe("u-1");
  });
});

// „Angemeldet bleiben“ hält (#1519): die Sitzung geht nur, wenn der Server sie wirklich beendet - und dann mit Hinweis.
describe("Angemeldet bleiben hält (#1519)", () => {
  type Bridge = {
    readTokens: () => {
      accessToken: string | null;
      refreshToken: string | null;
      userId: string | null;
      accessReceivedAt?: number | null;
      generation?: number;
    };
    persistSession: (session: unknown) => Promise<void>;
    clearSession: () => Promise<void>;
  };
  function bridge(): Bridge {
    const calls = (jest.requireMock("../lib/api") as { configureAuthBridge: jest.Mock }).configureAuthBridge.mock.calls;
    return calls[calls.length - 1][0] as Bridge;
  }
  async function signedIn() {
    await SecureStore.setItemAsync(ACCESS_KEY, accessToken(3600));
    await SecureStore.setItemAsync(REFRESH_KEY, "refresh-alt");
    await SecureStore.setItemAsync(REMEMBER_KEY, "true");
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(USER));
    mockApi.get.mockResolvedValue({ data: USER });
    return renderAuth();
  }

  test("nach dem Erneuern kennt der API-Client sofort die neuen Tokens - nicht erst nach dem nächsten Rendern", async () => {
    await signedIn();
    const current = bridge();
    const before = current.readTokens().generation;
    await current.persistSession({ user: USER, access_token: "access-2", refresh_token: "refresh-2" });
    // Der wiederholte Aufruf liest die Tokens gleich danach: mit den alten fiele er erneut mit 401 durch.
    expect(current.readTokens()).toMatchObject({ accessToken: "access-2", refreshToken: "refresh-2", userId: "u-1" });
    // Erneuern ist keine neue Sitzung: die Generation bleibt, der Erhalt ist vermerkt.
    expect(current.readTokens().generation).toBe(before);
    expect(typeof current.readTokens().accessReceivedAt).toBe("number");
  });

  test("Anmelden und Abmelden beginnen eine neue Sitzungs-Generation", async () => {
    const { result } = await signedIn();
    const start = bridge().readTokens().generation as number;
    await act(async () => {
      await result.current.login("fan@lionsquad.at", "geheim", true);
    });
    expect(bridge().readTokens().generation).toBe(start + 1);
    mockApi.post.mockResolvedValue({ data: { ok: true } });
    await act(async () => {
      await result.current.logout();
    });
    expect(bridge().readTokens().generation).toBe(start + 2);
  });

  test("Abmelden während refreshMe erneuert: die alte Sitzung kommt nicht zurück und meldet nicht ab", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const { result } = await signedIn();
    let release: (value: unknown) => void = () => {};
    mockApi.get.mockResolvedValue({ data: null });
    mockApi.post.mockImplementation((url: string) => {
      if (url === "/auth/mobile/refresh") return new Promise((resolve) => { release = resolve; });
      return Promise.resolve({ data: { ok: true } });
    });

    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = result.current.refreshMe();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await result.current.logout();
    });
    await act(async () => {
      release({ data: SESSION });
      await pending;
    });

    expect(isGuestUser(result.current.user)).toBe(true);
    expect(await SecureStore.getItemAsync(REFRESH_KEY)).toBeNull();
    expect(bridge().readTokens().refreshToken).toBeNull();
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  test("Kaltstart: die Laufzeit zählt ab Erhalt - eine nachgehende Uhr hält ein abgelaufenes Token nicht für gültig", async () => {
    // Laut Geräteuhr gilt das Token noch eine Stunde (exp), seit Erhalt sind aber schon 13 von 12 Stunden vergangen.
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({ sub: "u-1", iat: now - 11 * 3600, exp: now + 3600 })).toString("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await SecureStore.setItemAsync(ACCESS_KEY, `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`);
    await SecureStore.setItemAsync(REFRESH_KEY, "refresh-alt");
    await SecureStore.setItemAsync(REMEMBER_KEY, "true");
    await SecureStore.setItemAsync("tls.mobile.accessReceivedAt", String(Date.now() - 13 * 3600 * 1000));

    const { result } = await renderAuth();

    expect(mockApi.get).not.toHaveBeenCalled();
    expect(mockApi.post).toHaveBeenCalledWith("/auth/mobile/refresh", { refresh_token: "refresh-alt" });
    expect(result.current.user).toEqual(USER);
  });

  test("/auth/me ohne Konto (Token abgelaufen oder vom Server nicht erkannt) macht nicht still zum Gast", async () => {
    const { result } = await signedIn();
    mockApi.get.mockResolvedValue({ data: null });
    mockApi.post.mockResolvedValue({ data: { ...SESSION, user: { ...USER, display_name: "Neu" } } });

    await act(async () => {
      await result.current.refreshMe();
    });

    expect(mockApi.post).toHaveBeenCalledWith("/auth/mobile/refresh", { refresh_token: "refresh-alt" });
    expect(result.current.user?.id).toBe("u-1");
    expect(await SecureStore.getItemAsync(REFRESH_KEY)).toBe("refresh-neu");
  });

  test("lässt sich der sichere Speicher beim Kaltstart nicht lesen, bleibt die gespeicherte Sitzung erhalten", async () => {
    await SecureStore.setItemAsync(ACCESS_KEY, accessToken(3600));
    await SecureStore.setItemAsync(REFRESH_KEY, "refresh-alt");
    await SecureStore.setItemAsync(REMEMBER_KEY, "true");
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error("Keystore nicht bereit"));

    const { result } = await renderAuth();

    expect(isGuestUser(result.current.user)).toBe(true);
    expect(await SecureStore.getItemAsync(REFRESH_KEY)).toBe("refresh-alt");
    expect(await SecureStore.getItemAsync(ACCESS_KEY)).not.toBeNull();
  });

  test("ein Serverfehler beim Start ohne gemerktes Konto löscht die Sitzung nicht", async () => {
    await SecureStore.setItemAsync(ACCESS_KEY, accessToken(-60));
    await SecureStore.setItemAsync(REFRESH_KEY, "refresh-alt");
    await SecureStore.setItemAsync(REMEMBER_KEY, "true");
    mockApi.post.mockRejectedValue(rejected(502));

    await renderAuth();

    expect(await SecureStore.getItemAsync(REFRESH_KEY)).toBe("refresh-alt");
  });

  test("beendet der Server die Sitzung, sagt die App das klar - einmal, auch bei mehreren Aufrufen", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const { result } = await signedIn();

    await act(async () => {
      await Promise.all([bridge().clearSession(), bridge().clearSession()]);
    });

    expect(isGuestUser(result.current.user)).toBe(true);
    expect(await SecureStore.getItemAsync(REFRESH_KEY)).toBeNull();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toBe("Abgemeldet");
    alert.mockRestore();
  });

  test("ein abgelehnter Refresh beim Start zeigt den Hinweis, selbst abmelden nicht", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await SecureStore.setItemAsync(REFRESH_KEY, "refresh-ungueltig");
    await SecureStore.setItemAsync(REMEMBER_KEY, "true");
    mockApi.post.mockRejectedValueOnce(rejected(401));
    const first = await renderAuth();
    expect(alert).toHaveBeenCalledTimes(1);
    first.unmount();

    alert.mockClear();
    const { result } = await signedIn();
    mockApi.post.mockResolvedValue({ data: { ok: true } });
    await act(async () => {
      await result.current.logout();
    });
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});

// „Angemeldet bleiben“ (#942) geht an den Server: ohne Haken endet die Sitzung dort nach 24 Stunden.
describe("Angemeldet bleiben", () => {
  test("die Anmeldung schickt den Haken mit", async () => {
    const { result } = await renderAuth();
    await act(async () => {
      await result.current.login("fan@lionsquad.at", "geheim", false);
    });
    expect(mockApi.post).toHaveBeenCalledWith("/auth/mobile/login", { email: "fan@lionsquad.at", password: "geheim", remember: false });
    expect(await SecureStore.getItemAsync(REFRESH_KEY)).toBeNull();
    expect(await SecureStore.getItemAsync(USER_KEY)).toBeNull();
    await act(async () => {
      await result.current.login("fan@lionsquad.at", "geheim", true);
    });
    expect(mockApi.post).toHaveBeenLastCalledWith("/auth/mobile/login", { email: "fan@lionsquad.at", password: "geheim", remember: true });
    expect(JSON.parse((await SecureStore.getItemAsync(USER_KEY)) || "null")).toEqual(USER);
  });
});
