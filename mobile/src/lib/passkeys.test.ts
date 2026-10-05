import { Passkey } from "react-native-passkey";
import {
  createPasskey,
  credentialPayload,
  listPasskeys,
  passkeyCreateError,
  passkeyError,
  passkeysAvailable,
  passkeysSupported,
  removePasskey,
  signInWithPasskey,
  silentPasskeyMiss,
} from "./passkeys";

// Passkey-Anmeldung in der App (#217): Aufgabe holen, Gerät unterschreiben lassen, mit Ticket
// prüfen lassen - und Gerätefehler in Sätzen, die man versteht.

const mockPost = jest.fn();
const mockGet = jest.fn();
jest.mock("./api", () => ({ api: { post: (...args: unknown[]) => mockPost(...args), get: (...args: unknown[]) => mockGet(...args) } }));

const OPTIONS = { challenge: "aufgabe", rpId: "lionsquad.at", userVerification: "required" as const, timeout: 60000 };
const RESULT = { id: "cred-1", rawId: "cred-1", type: "public-key", response: { clientDataJSON: "c", authenticatorData: "a", signature: "s", userHandle: "u" } };

beforeEach(() => {
  jest.clearAllMocks();
  (Passkey.get as jest.Mock).mockResolvedValue(RESULT);
});

test("Aufgabe vom Server, Unterschrift vom Gerät, Prüfung mit Ticket - zurück kommt die Sitzung", async () => {
  mockPost
    .mockResolvedValueOnce({ data: { ticket: "t-1", options: OPTIONS } })
    .mockResolvedValueOnce({ data: { user: { id: "u-1" }, access_token: "zugang", refresh_token: "erneuerung", token_type: "bearer" } });
  const session = await signInWithPasskey(false);
  expect(Passkey.get).toHaveBeenCalledWith(OPTIONS);
  expect(Passkey.getImmediate).not.toHaveBeenCalled();
  expect(mockPost).toHaveBeenNthCalledWith(1, "/auth/passkeys/mobile/login/options", {});
  expect(mockPost).toHaveBeenNthCalledWith(2, "/auth/passkeys/mobile/login/verify", {
    ticket: "t-1",
    credential: { id: "cred-1", rawId: "cred-1", type: "public-key", response: RESULT.response, clientExtensionResults: {} },
    remember: false,
  });
  expect(session.access_token).toBe("zugang");
});

test("ohne rawId und Typ füllt die App die Form der Web-API auf", () => {
  expect(credentialPayload({ id: "x", response: RESULT.response })).toEqual({ id: "x", rawId: "x", type: "public-key", response: RESULT.response, clientExtensionResults: {} });
});

test("Gerätefehler in Sätzen; Serverantworten wörtlich; sonst der Rückfall", () => {
  expect(passkeyError({ error: "UserCancelled" })).toBe("Passkey-Vorgang abgebrochen.");
  expect(passkeyError({ error: "NoCredentials" })).toContain("kein Passkey für lionsquad.at");
  expect(passkeyError({ error: "NoCredentials" })).toContain("melde dich mit Passwort an");
  expect(passkeyError({ error: "NotSupported" })).toContain("nicht unterstützt");
  expect(passkeyError({ message: "Timeout" })).toContain("Zeit abgelaufen");
  expect(passkeyError({ response: { data: { detail: "Passkey-Anfrage abgelaufen." } } })).toBe("Passkey-Anfrage abgelaufen.");
  expect(passkeyError(new Error("kaputt"))).toBe("Passkey-Anmeldung fehlgeschlagen. Bitte erneut versuchen.");
  expect(passkeysSupported()).toBe(true);
  (Passkey.isSupported as jest.Mock).mockImplementationOnce(() => { throw new Error("kein Modul"); });
  expect(passkeysSupported()).toBe(false);
});

// Passkeys anlegen und verwalten (#919): Ticket nach der Anmeldung oder Passwort; still bleiben, wo es nichts anzubieten gibt.
test("anlegen mit Ticket oder Passwort, entfernen mit Passwort, Liste und Verfügbarkeit vom Server", async () => {
  mockPost.mockResolvedValueOnce({ data: { ticket: "reg-1", options: { challenge: "c" } } }).mockResolvedValueOnce({ data: { ok: true } });
  await createPasskey({ enrollTicket: "enroll-1" });
  expect(mockPost).toHaveBeenNthCalledWith(1, "/auth/passkeys/mobile/register/options", { enroll_ticket: "enroll-1", current_password: "", name: "LionsAPP (Android)" });
  expect(Passkey.create).toHaveBeenCalledWith({ challenge: "c" });
  expect(mockPost).toHaveBeenNthCalledWith(2, "/auth/passkeys/mobile/register/verify", {
    ticket: "reg-1",
    credential: { id: "cred-1", rawId: "cred-1", type: "public-key", response: { clientDataJSON: "c", attestationObject: "o" }, clientExtensionResults: {} },
  });

  mockPost.mockResolvedValueOnce({ data: { ok: true } });
  await removePasskey("cred/1", "geheim");
  expect(mockPost).toHaveBeenLastCalledWith("/auth/passkeys/mobile/cred%2F1/remove", { current_password: "geheim" });

  mockGet.mockResolvedValueOnce({ data: [{ id: "a", name: "Laptop" }] }).mockResolvedValueOnce({ data: null });
  expect(await listPasskeys()).toEqual([{ id: "a", name: "Laptop" }]);
  expect(await listPasskeys()).toEqual([]);

  mockGet.mockResolvedValueOnce({ data: { enabled: true, app: true } }).mockResolvedValueOnce({ data: { enabled: true, app: false } }).mockRejectedValueOnce(new Error("offline"));
  expect(await passkeysAvailable()).toBe(true);
  expect(await passkeysAvailable()).toBe(false);
  expect(await passkeysAvailable()).toBe(false);
});

test("still bleiben: kein Passkey auf dem Gerät oder keine App-Passkeys am Server; Abbruch und Fehler unterscheiden", () => {
  expect(silentPasskeyMiss({ error: "NoCredentials" })).toBe("none");
  expect(silentPasskeyMiss({ response: { status: 503 } })).toBe("none");
  expect(silentPasskeyMiss({ error: "UserCancelled" })).toBe("cancelled");
  expect(silentPasskeyMiss(new Error("Network Error"))).toBe("failed");
  expect(passkeyCreateError({ error: "UserCancelled" })).toContain("im Profil unter „Einstellungen“");
  expect(passkeyCreateError({ response: { data: { detail: "Bitte bestätige dein aktuelles Passwort." } } })).toBe("Bitte bestätige dein aktuelles Passwort.");
  expect(passkeyCreateError(new Error("kaputt"))).toBe("Der Passkey konnte nicht angelegt werden. Bitte erneut versuchen.");
});

// Still beim Öffnen der Anmeldung (#919): nur sofort verfügbare Passkeys - ohne Passkey keine Leiste von Android.
test("still fragt die App nur nach sofort verfügbaren Passkeys", async () => {
  mockPost
    .mockResolvedValueOnce({ data: { ticket: "t-2", options: OPTIONS } })
    .mockResolvedValueOnce({ data: { user: { id: "u-1" }, access_token: "zugang", refresh_token: "erneuerung", token_type: "bearer" } });
  (Passkey.getImmediate as jest.Mock).mockResolvedValueOnce(RESULT);
  await signInWithPasskey(true, true);
  expect(Passkey.getImmediate).toHaveBeenCalledWith(OPTIONS);
  expect(Passkey.get).not.toHaveBeenCalled();
});
