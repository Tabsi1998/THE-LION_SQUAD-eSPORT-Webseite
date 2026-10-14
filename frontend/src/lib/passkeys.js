import { api, formatApiError } from "./api";

export function passkeysSupported() {
  return Boolean(window.isSecureContext && window.PublicKeyCredential && navigator.credentials?.create && navigator.credentials?.get);
}

export function decodeCredentialBytes(value) {
  const encoded = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")), (char) => char.charCodeAt(0));
}

export function encodeCredentialBytes(value) {
  return btoa(Array.from(new Uint8Array(value), (byte) => String.fromCharCode(byte)).join(""))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function credentialOptions(options, registration = false) {
  const publicKey = { ...options, challenge: decodeCredentialBytes(options.challenge) };
  for (const field of ["allowCredentials", "excludeCredentials"]) {
    if (options[field]) publicKey[field] = options[field].map((item) => ({ ...item, id: decodeCredentialBytes(item.id) }));
  }
  // Ohne E-Mail (discoverable): keine Liste statt einer leeren - der Browser zeigt dann alle Passkeys dieser Website.
  if (Array.isArray(publicKey.allowCredentials) && publicKey.allowCredentials.length === 0) delete publicKey.allowCredentials;
  if (registration) publicKey.user = { ...options.user, id: decodeCredentialBytes(options.user.id) };
  return publicKey;
}

export function serializeCredential(credential) {
  if (!credential) throw new Error("Passkey-Vorgang wurde abgebrochen.");
  const response = { clientDataJSON: encodeCredentialBytes(credential.response.clientDataJSON) };
  for (const field of ["attestationObject", "authenticatorData", "signature", "userHandle"]) {
    const value = credential.response[field];
    if (value) response[field] = encodeCredentialBytes(value);
  }
  if (credential.response.getTransports) response.transports = credential.response.getTransports();
  return { id: credential.id, rawId: encodeCredentialBytes(credential.rawId), type: credential.type,
    response, clientExtensionResults: credential.getClientExtensionResults() };
}

export function passkeyError(error) {
  if (error?.name === "NotAllowedError" || error?.name === "AbortError") return "Passkey-Vorgang abgebrochen oder kein passender Passkey verfügbar.";
  if (error?.name === "InvalidStateError") return "Dieser Passkey ist bereits auf dem Gerät eingerichtet.";
  if (error?.name === "SecurityError") return "Bitte Passkeys direkt über die sichere Website-Adresse verwenden.";
  return error?.response?.data?.detail ? formatApiError(error.response.data.detail) : "Passkey-Vorgang fehlgeschlagen. Bitte erneut versuchen.";
}

/** Der Server kennt den vorgezeigten Passkey nicht (mehr) - er sagt das in einer Kopfzeile (#949). */
export function unknownPasskey(error) {
  return String(error?.response?.headers?.["x-passkey-error"] || "") === "unknown-credential";
}

/**
 * Signal API (#949): dem Passwortmanager sagen, dass ein Passkey hier nichts mehr gilt - nach einer Anmeldung
 * mit einem Passkey, den der Server nicht kennt. Der Browser versteckt ihn dann; wo es die Schnittstelle nicht
 * gibt, passiert nichts. Immer nur ein Versuch, nie ein Fehler nach außen.
 */
export async function signalUnknownPasskey(rpId, credentialId) {
  try {
    if (rpId && credentialId && typeof window.PublicKeyCredential?.signalUnknownCredential === "function") {
      await window.PublicKeyCredential.signalUnknownCredential({ rpId, credentialId });
    }
  } catch {
    // nur ein Hinweis an den Passwortmanager
  }
}

/**
 * Signal API, zweiter Teil (#949): nach dem Laden der Liste im Profil und nach jedem Entfernen die vollständige
 * Menge melden - alles, was am Gerät für dieses Konto darüber hinaus liegt, verschwindet dort.
 */
export async function reconcilePasskeys() {
  try {
    if (typeof window.PublicKeyCredential?.signalAllAcceptedCredentials !== "function") return false;
    const { data } = await api.get("/auth/passkeys/signal", { skipInvalidation: true });
    if (!data?.rp_id || !data.user_handle || !Array.isArray(data.credential_ids)) return false;
    await window.PublicKeyCredential.signalAllAcceptedCredentials({ rpId: data.rp_id, userId: data.user_handle, allAcceptedCredentialIds: data.credential_ids });
    return true;
  } catch {
    return false;
  }
}

async function verifyLogin(options, credential, remember) {
  try {
    const { data } = await api.post("/auth/passkeys/login/verify", { credential: serializeCredential(credential), remember }, { skipInvalidation: true });
    return data;
  } catch (error) {
    if (unknownPasskey(error)) await signalUnknownPasskey(options?.rpId, credential?.id);
    throw error;
  }
}

// Der Server merkt sich je Browser nur die jüngste Anmelde-Anfrage. Darum laufen die Anfragen nach Optionen
// nacheinander: die Antwort einer abgebrochenen Anfrage darf nie die einer neueren überholen.
let optionsQueue = Promise.resolve();

function loginOptions() {
  const request = optionsQueue.then(() => api.post("/auth/passkeys/login/options", {}, { skipInvalidation: true }));
  optionsQueue = request.catch(() => {});
  return request.then(({ data }) => data);
}

/**
 * Der sichtbare Weg (#1520, FIDO-Empfehlung): „Mit Passkey anmelden“ öffnet den Dialog des Browsers - ohne E-Mail,
 * mit allen Passkeys dieser Website, auch solchen auf dem Handy (QR-Code) oder einem Sicherheitsschlüssel.
 */
export async function signInWithPasskey({ remember = true } = {}) {
  const options = await loginOptions();
  const credential = await navigator.credentials.get({ publicKey: credentialOptions(options) });
  return verifyLogin(options, credential, remember);
}

export async function passkeyAutofillAvailable() {
  try {
    return passkeysSupported() && typeof window.PublicKeyCredential.isConditionalMediationAvailable === "function"
      && await window.PublicKeyCredential.isConditionalMediationAvailable();
  } catch {
    return false;
  }
}

// Die Anfrage des Servers gilt fünf Minuten; so lange sitzt mancher vor dem Login.
const AUTOFILL_REARM_MS = 4 * 60 * 1000;
// So lange wartet das Beenden höchstens darauf, dass der Browser die abgebrochene Anfrage auch abgeschlossen hat.
const AUTOFILL_SETTLE_MS = 1000;

async function runAlone(task) {
  try {
    return { started: true, value: await task() };
  } catch (error) {
    return { started: true, error };
  }
}

/**
 * Der Browser schlägt gespeicherte Passkeys im E-Mail-Feld vor (#348, #1520) - zusätzlich zum Knopf
 * „Mit Passkey anmelden“: nicht jeder Browser zeigt jeden Passkey im Feld an (etwa einen vom Handy).
 * Die Anfrage bleibt im Hintergrund offen und wird nur nach dem eigenen Ablauf-Timer erneuert. `exclusive` lässt
 * die Prüfung am Server nur laufen, wenn nicht schon eine andere Anmeldung läuft (kein doppeltes Anmelden).
 * Jedes andere Ende - Abbruch durch die Person, Ablehnung durch den Browser, Ablehnung durch den Server - beendet
 * den Vorschlag endgültig (keine Schleife aus Optionen und Anfragen); still bleibt es bis auf `onError`, das nur
 * hört, was der Server ablehnt. `onEnd` meldet das Ende; neu starten darf nur die Seite nach einer Handlung.
 * Liefert eine Funktion zum Beenden: beim Verlassen der Seite, beim Absenden des Passworts und bevor eine
 * eigene Passkey-Anfrage startet. Sie gibt ein Promise zurück, das erst erfüllt ist, wenn der Browser die
 * Anfrage abgeschlossen hat (höchstens AUTOFILL_SETTLE_MS) - zwei WebAuthn-Anfragen zugleich lehnt er ab.
 */
export function startPasskeyAutofill({ remember = () => true, exclusive = runAlone, onSignedIn, onError, onEnd }) {
  let stopped = false;
  let controller = null;
  let timer = null;
  let pending = null;
  const end = () => {
    if (stopped) return;
    stopped = true;
    onEnd?.();
  };
  const arm = async () => {
    if (stopped) return;
    controller = new AbortController();
    let options;
    try {
      options = await loginOptions();
    } catch {
      end();
      return;
    }
    if (stopped) return;
    let expired = false;
    let credential;
    try {
      timer = setTimeout(() => { expired = true; controller.abort(); }, AUTOFILL_REARM_MS);
      // Die Zeit regelt hier die Seite selbst (Erneuern vor Ablauf); ein Zeitlimit des Servers beendete den Vorschlag früher.
      const { timeout: _timeout, ...publicKey } = credentialOptions(options);
      const request = navigator.credentials.get({ publicKey, mediation: "conditional", signal: controller.signal });
      pending = request.then(() => {}, () => {});
      credential = await request;
    } catch {
      if (stopped) return;
      // Nur der eigene Ablauf erneuert; alles andere (auch ein Abbruch durch die Person) beendet.
      if (expired) { arm(); return; }
      end();
      return;
    } finally {
      clearTimeout(timer);
      pending = null;
    }
    if (stopped) return;
    const attempt = await exclusive(() => verifyLogin(options, credential, remember()));
    if (!attempt.started) return;
    if (attempt.error) {
      if (stopped) return;
      onError?.(attempt.error);
      end();
      return;
    }
    stopped = true;
    onSignedIn(attempt.value);
  };
  arm();
  return () => {
    stopped = true;
    clearTimeout(timer);
    controller?.abort();
    if (!pending) return Promise.resolve();
    let limit;
    return Promise.race([pending, new Promise((resolve) => { limit = setTimeout(resolve, AUTOFILL_SETTLE_MS); })])
      .finally(() => clearTimeout(limit));
  };
}

export async function enrollPasskey(name, password) {
  const { data: options } = await api.post("/auth/passkeys/register/options", { name, current_password: password }, { skipInvalidation: true });
  const credential = await navigator.credentials.create({ publicKey: credentialOptions(options, true) });
  await api.post("/auth/passkeys/register/verify", { credential: serializeCredential(credential) }, { skipInvalidation: true });
}
