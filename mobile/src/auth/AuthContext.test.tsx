import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
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
}));
jest.mock("../lib/cache", () => ({ clearAllCache: (...args: unknown[]) => mockClearAllCache(...args) }));
jest.mock("../notifications/PushService", () => ({
  unregisterPushToken: (...args: unknown[]) => mockUnregisterPushToken(...args),
}));

const ACCESS_KEY = "tls.mobile.accessToken";
const REFRESH_KEY = "tls.mobile.refreshToken";
const REMEMBER_KEY = "tls.mobile.rememberSession";

const USER = { id: "u-1", username: "lionfan", display_name: "Lion Fan" };
const SESSION = { user: USER, access_token: "access-neu", refresh_token: "refresh-neu" };

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
    await SecureStore.setItemAsync(ACCESS_KEY, "access-alt");
    await SecureStore.setItemAsync(REFRESH_KEY, "refresh-alt");
    await SecureStore.setItemAsync(REMEMBER_KEY, "true");
    mockApi.get.mockResolvedValue({ data: USER });

    const { result } = await renderAuth();

    expect(result.current.user).toEqual(USER);
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  test("ein abgelaufenes Access-Token wird ueber den Refresh-Token ersetzt", async () => {
    await SecureStore.setItemAsync(ACCESS_KEY, "access-abgelaufen");
    await SecureStore.setItemAsync(REFRESH_KEY, "refresh-alt");
    await SecureStore.setItemAsync(REMEMBER_KEY, "true");
    mockApi.get.mockRejectedValue(new Error("401"));

    const { result } = await renderAuth();

    expect(mockApi.post).toHaveBeenCalledWith("/auth/mobile/refresh", { refresh_token: "refresh-alt" });
    expect(result.current.user).toEqual(USER);
    expect(await SecureStore.getItemAsync(ACCESS_KEY)).toBe("access-neu");
  });

  test("ein abgelehnter Refresh meldet sauber ab - als Gast, statt haengen zu bleiben", async () => {
    await SecureStore.setItemAsync(REFRESH_KEY, "refresh-ungueltig");
    await SecureStore.setItemAsync(REMEMBER_KEY, "true");
    mockApi.post.mockRejectedValue(new Error("401"));

    const { result } = await renderAuth();

    expect(isGuestUser(result.current.user)).toBe(true);
    expect(await SecureStore.getItemAsync(REFRESH_KEY)).toBeNull();
  });

  test("wer 'angemeldet bleiben' abgewaehlt hat, wird beim Start nicht wiederhergestellt", async () => {
    await SecureStore.setItemAsync(ACCESS_KEY, "access-alt");
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

    await act(async () => {
      await result.current.logout();
    });

    expect(mockApi.post).toHaveBeenCalledWith("/auth/mobile/logout", { refresh_token: "refresh-neu" });
    expect(mockUnregisterPushToken).toHaveBeenCalled();
    expect(await SecureStore.getItemAsync(ACCESS_KEY)).toBeNull();
    expect(await SecureStore.getItemAsync(REFRESH_KEY)).toBeNull();
    expect(mockClearAllCache).toHaveBeenCalled();
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
});
