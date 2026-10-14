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

// #1520: der Vorschlag im E-Mail-Feld ersetzt den Knopf. Er startet still, bricht sauber ab, meldet nur echte Fehler
// und meldet doppelt nichts an.
describe("startPasskeyAutofill", () => {
  let autofill;
  const credential = { id: "AAE", rawId: new Uint8Array([0, 1]), type: "public-key",
    response: { clientDataJSON: new Uint8Array([2]), authenticatorData: new Uint8Array([3]), signature: new Uint8Array([4]), userHandle: null },
    getClientExtensionResults: () => ({}) };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const named = (name) => Object.assign(new Error(name), { name });

  // navigator.credentials.get gibt eine Anfrage zurück, die der Test selbst auflöst oder abbricht.
  function pendingGets() {
    const calls = [];
    navigator.credentials = { get: vi.fn((request) => new Promise((resolve, reject) => {
      const call = { request, resolve, reject };
      request.signal?.addEventListener("abort", () => reject(named("AbortError")));
      calls.push(call);
    })) };
    return calls;
  }

  beforeEach(async () => {
    autofill = (await import("./passkeys")).startPasskeyAutofill;
    api.post.mockReset();
    api.post.mockImplementation(async (url) => {
      if (url === "/auth/passkeys/login/options") return { data: { challenge: "AQID", rpId: "club.example" } };
      return { data: { id: "u1" } };
    });
  });
  afterEach(() => vi.useRealTimers());

  test("holt Optionen ohne E-Mail und fragt den Browser bedingt, mit Abbruchsignal", async () => {
    const calls = pendingGets();
    const stop = autofill({ onSignedIn: vi.fn() });
    await flush();
    expect(api.post).toHaveBeenCalledWith("/auth/passkeys/login/options", {}, { skipInvalidation: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].request.mediation).toBe("conditional");
    expect(calls[0].request.publicKey.allowCredentials).toBeUndefined();
    expect(calls[0].request.signal.aborted).toBe(false);
    stop();
    expect(calls[0].request.signal.aborted).toBe(true);
  });

  test("Erfolg meldet einmal an, mit „Angemeldet bleiben“ zum Zeitpunkt der Auswahl", async () => {
    const calls = pendingGets();
    const onSignedIn = vi.fn();
    let remember = true;
    autofill({ remember: () => remember, onSignedIn });
    await flush();
    remember = false;
    calls[0].resolve(credential);
    await flush();
    expect(api.post).toHaveBeenCalledWith("/auth/passkeys/login/verify", expect.objectContaining({ remember: false }), { skipInvalidation: true });
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    expect(onSignedIn).toHaveBeenCalledWith({ id: "u1" });
    expect(calls).toHaveLength(1);
  });

  test("läuft schon eine andere Anmeldung, prüft der Vorschlag nicht zusätzlich", async () => {
    const calls = pendingGets();
    const onSignedIn = vi.fn();
    autofill({ onSignedIn, exclusive: async () => ({ started: false }) });
    await flush();
    calls[0].resolve(credential);
    await flush();
    expect(api.post).not.toHaveBeenCalledWith("/auth/passkeys/login/verify", expect.anything(), expect.anything());
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  test("Abbruch und abgelehnte Auswahl bleiben still; eine sofortige Ablehnung beendet den Vorschlag", async () => {
    const calls = pendingGets();
    const onError = vi.fn();
    const onEnd = vi.fn();
    const stop = autofill({ onSignedIn: vi.fn(), onError, onEnd });
    await flush();
    calls[0].reject(named("NotAllowedError"));
    await flush();
    expect(onError).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    stop();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  const optionRequests = () => api.post.mock.calls.filter(([url]) => url === "/auth/passkeys/login/options").length;

  test("ein Abbruch durch die Person - auch nach Minuten - beendet den Vorschlag ohne neue Optionen", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const calls = pendingGets();
    const onError = vi.fn();
    const onEnd = vi.fn();
    autofill({ onSignedIn: vi.fn(), onError, onEnd });
    await flush();
    vi.setSystemTime(Date.now() + 90_000);
    calls[0].reject(named("NotAllowedError"));
    await flush();
    expect(onError).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(optionRequests()).toBe(1);
  });

  test("ein fremder Abbruch beendet ebenfalls; nur der eigene Ablauf-Timer erneuert", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const calls = pendingGets();
    const onEnd = vi.fn();
    const stop = autofill({ onSignedIn: vi.fn(), onEnd });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    // Der eigene Timer läuft ab: still erneuern, einmal je Ablauf.
    vi.advanceTimersByTime(4 * 60 * 1000);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(optionRequests()).toBe(2);
    expect(onEnd).not.toHaveBeenCalled();
    // Ein Abbruch, den nicht der Timer auslöst, beendet endgültig.
    calls[1].reject(named("AbortError"));
    await vi.waitFor(() => expect(onEnd).toHaveBeenCalledTimes(1));
    expect(calls).toHaveLength(2);
    expect(optionRequests()).toBe(2);
    stop();
  });

  test("Beenden wartet, bis der Browser die abgebrochene Anfrage abgeschlossen hat - höchstens eine Sekunde", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // Wie ein echter Browser: die Ablehnung nach dem Abbruch kommt verzögert.
    const lateReject = (delay) => vi.fn((request) => new Promise((_resolve, reject) => {
      request.signal.addEventListener("abort", () => setTimeout(() => reject(named("AbortError")), delay));
    }));
    navigator.credentials = { get: lateReject(300) };
    let stop = autofill({ onSignedIn: vi.fn() });
    await vi.waitFor(() => expect(navigator.credentials.get).toHaveBeenCalledTimes(1));
    let done = false;
    stop().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(299);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    expect(navigator.credentials.get).toHaveBeenCalledTimes(1);

    // Hängt der Browser, gibt das Beenden nach einer Sekunde trotzdem frei.
    navigator.credentials = { get: lateReject(60_000) };
    stop = autofill({ onSignedIn: vi.fn() });
    await vi.waitFor(() => expect(navigator.credentials.get).toHaveBeenCalledTimes(1));
    done = false;
    stop().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  test("lehnt der Server ab, steht der Grund da und der Vorschlag endet - keine Schleife aus Optionen und Prüfung", async () => {
    const calls = pendingGets();
    const onError = vi.fn();
    const onEnd = vi.fn();
    api.post.mockImplementation(async (url) => {
      if (url === "/auth/passkeys/login/options") return { data: { challenge: "AQID", rpId: "club.example" } };
      throw { response: { status: 401, headers: {}, data: { detail: "nein" } } };
    });
    autofill({ onSignedIn: vi.fn(), onError, onEnd });
    await flush();
    calls[0].resolve(credential);
    await flush();
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    const optionCalls = api.post.mock.calls.filter(([url]) => url === "/auth/passkeys/login/options");
    expect(optionCalls).toHaveLength(1);
  });

  test("scheitern die Optionen, endet der Vorschlag still", async () => {
    pendingGets();
    api.post.mockRejectedValue(new Error("offline"));
    const onError = vi.fn();
    const onEnd = vi.fn();
    autofill({ onSignedIn: vi.fn(), onError, onEnd });
    await flush();
    expect(onError).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(navigator.credentials.get).not.toHaveBeenCalled();
  });
});

// #1520: Knopf und Vorschlag teilen sich die Anfrage am Server - die Optionen kommen nacheinander, und der Vorschlag
// bekommt weder eine leere Liste noch ein Zeitlimit mit.
describe("Optionen für Knopf und Vorschlag", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  test("leere Liste und Zeitlimit fallen beim Vorschlag weg, der Knopf fragt ohne mediation", async () => {
    const autofill = (await import("./passkeys")).startPasskeyAutofill;
    const calls = [];
    navigator.credentials = { get: vi.fn((request) => { calls.push(request); return new Promise(() => {}); }) };
    api.post.mockReset();
    api.post.mockResolvedValue({ data: { challenge: "AQID", rpId: "club.example", allowCredentials: [], timeout: 60000 } });
    const stop = autofill({ onSignedIn: vi.fn() });
    await flush();
    expect(calls[0].mediation).toBe("conditional");
    expect(calls[0].publicKey).not.toHaveProperty("allowCredentials");
    expect(calls[0].publicKey).not.toHaveProperty("timeout");
    expect(calls[0].publicKey.rpId).toBe("club.example");
    stop();
    signInWithPasskey({ remember: true });
    await flush();
    expect(calls[1].mediation).toBeUndefined();
    expect(calls[1].publicKey).not.toHaveProperty("allowCredentials");
  });

  test("eine noch laufende Anfrage des Vorschlags überholt die des Knopfs nicht", async () => {
    const autofill = (await import("./passkeys")).startPasskeyAutofill;
    navigator.credentials = { get: vi.fn(() => new Promise(() => {})) };
    const answers = [];
    api.post.mockReset();
    api.post.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    const stop = autofill({ onSignedIn: vi.fn() });
    await flush();
    expect(answers).toHaveLength(1);
    stop();
    signInWithPasskey({ remember: true });
    await flush();
    // Die zweite Anfrage geht erst los, wenn die erste beantwortet ist.
    expect(answers).toHaveLength(1);
    answers[0]({ data: { challenge: "AQID", rpId: "club.example" } });
    await flush();
    expect(answers).toHaveLength(2);
    answers[1]({ data: { challenge: "BAUG", rpId: "club.example" } });
    await flush();
    // Der beendete Vorschlag fragt den Browser nicht mehr; nur der Knopf tut es.
    expect(navigator.credentials.get).toHaveBeenCalledTimes(1);
    expect(navigator.credentials.get.mock.calls[0][0].mediation).toBeUndefined();
  });
});
