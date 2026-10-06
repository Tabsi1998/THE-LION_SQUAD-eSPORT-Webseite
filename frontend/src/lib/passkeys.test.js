import { credentialOptions, decodeCredentialBytes, encodeCredentialBytes, serializeCredential, passkeyError } from "./passkeys";

test("WebAuthn binary fields round-trip without base64 padding", () => {
  const bytes = Uint8Array.from([0, 127, 128, 254, 255]);
  const encoded = encodeCredentialBytes(bytes);
  expect(encoded).not.toMatch(/[+/=]/);
  expect(decodeCredentialBytes(encoded)).toEqual(bytes);
});

test("registration converts user, challenge and excluded keys without mutating server options", () => {
  const source = { challenge: "AAE", user: { id: "AgM", name: "User" }, excludeCredentials: [{ id: "BAU", type: "public-key" }] };
  const result = credentialOptions(source, true);
  expect(Array.from(result.challenge)).toEqual([0, 1]);
  expect(Array.from(result.user.id)).toEqual([2, 3]);
  expect(Array.from(result.excludeCredentials[0].id)).toEqual([4, 5]);
  expect(source.user.id).toBe("AgM");
});

test("authentication sends signature, client data and opaque user handle", () => {
  const result = serializeCredential({ id: "AAE", rawId: new Uint8Array([0, 1]), type: "public-key",
    response: { clientDataJSON: new Uint8Array([2]), authenticatorData: new Uint8Array([3]), signature: new Uint8Array([4]), userHandle: new Uint8Array([5]) },
    getClientExtensionResults: () => ({}),
  });
  expect(result.response).toEqual({ clientDataJSON: "Ag", authenticatorData: "Aw", signature: "BA", userHandle: "BQ" });
  expect(passkeyError({ name: "NotAllowedError" })).toContain("abgebrochen");
});

// #949: ein Passkey, den der Server nicht (mehr) kennt - der Browser soll ihn vergessen (Signal API).
vi.mock("./api", () => ({ api: { post: vi.fn(), get: vi.fn() }, formatApiError: (detail) => String(detail) }));
const { api } = await import("./api");
const { signInWithPasskey, unknownPasskey, reconcilePasskeys } = await import("./passkeys");

function unknownError() {
  return { response: { status: 401, headers: { "x-passkey-error": "unknown-credential" }, data: { detail: "Diesen Passkey kennt club.example nicht (mehr)." } } };
}

test("unbekannter Passkey: der Browser bekommt das Signal mit Relying Party und Kennung, der Fehler bleibt", async () => {
  const signal = vi.fn().mockResolvedValue(undefined);
  window.PublicKeyCredential = { signalUnknownCredential: signal };
  window.isSecureContext = true;
  navigator.credentials = { get: vi.fn().mockResolvedValue({ id: "AAE", rawId: new Uint8Array([0, 1]), type: "public-key",
    response: { clientDataJSON: new Uint8Array([2]), authenticatorData: new Uint8Array([3]), signature: new Uint8Array([4]), userHandle: null },
    getClientExtensionResults: () => ({}) }) };
  api.post.mockImplementation(async (url) => {
    if (url === "/auth/passkeys/login/options") return { data: { challenge: "AQID", rpId: "club.example" } };
    throw unknownError();
  });
  await expect(signInWithPasskey({ remember: true })).rejects.toMatchObject({ response: { status: 401 } });
  expect(signal).toHaveBeenCalledWith({ rpId: "club.example", credentialId: "AAE" });
  expect(unknownPasskey(unknownError())).toBe(true);
  expect(unknownPasskey({ response: { status: 401, headers: {} } })).toBe(false);

  // Ohne die Schnittstelle im Browser: kein Signal, derselbe Fehler.
  delete window.PublicKeyCredential.signalUnknownCredential;
  await expect(signInWithPasskey({ remember: true })).rejects.toMatchObject({ response: { status: 401 } });
});

test("Abgleich im Profil: die vollständige Liste vom Server geht an den Passwortmanager", async () => {
  const signalAll = vi.fn().mockResolvedValue(undefined);
  window.PublicKeyCredential = { signalAllAcceptedCredentials: signalAll };
  api.get.mockResolvedValue({ data: { rp_id: "club.example", user_handle: "dXNlci0x", credential_ids: ["AAE", "AAI"] } });
  expect(await reconcilePasskeys()).toBe(true);
  expect(signalAll).toHaveBeenCalledWith({ rpId: "club.example", userId: "dXNlci0x", allAcceptedCredentialIds: ["AAE", "AAI"] });
  api.get.mockRejectedValue(new Error("offline"));
  expect(await reconcilePasskeys()).toBe(false);
  delete window.PublicKeyCredential.signalAllAcceptedCredentials;
  expect(await reconcilePasskeys()).toBe(false);
});
