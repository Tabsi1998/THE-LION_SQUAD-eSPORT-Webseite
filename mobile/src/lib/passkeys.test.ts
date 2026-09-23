import { Passkey } from "react-native-passkey";
import { credentialPayload, passkeyError, passkeysSupported, signInWithPasskey } from "./passkeys";

// Passkey-Anmeldung in der App (#217): Aufgabe holen, Gerät unterschreiben lassen, mit Ticket
// prüfen lassen - und Gerätefehler in Sätzen, die man versteht.

const mockPost = jest.fn();
jest.mock("./api", () => ({ api: { post: (...args: unknown[]) => mockPost(...args) } }));

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
  expect(passkeyError({ error: "NotSupported" })).toContain("nicht unterstützt");
  expect(passkeyError({ message: "Timeout" })).toContain("Zeit abgelaufen");
  expect(passkeyError({ response: { data: { detail: "Passkey-Anfrage abgelaufen." } } })).toBe("Passkey-Anfrage abgelaufen.");
  expect(passkeyError(new Error("kaputt"))).toBe("Passkey-Anmeldung fehlgeschlagen. Bitte erneut versuchen.");
  expect(passkeysSupported()).toBe(true);
  (Passkey.isSupported as jest.Mock).mockImplementationOnce(() => { throw new Error("kein Modul"); });
  expect(passkeysSupported()).toBe(false);
});
