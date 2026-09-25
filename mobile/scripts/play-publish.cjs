#!/usr/bin/env node
/*
 * App Bundle in einen Test-Track der Play Console laden (#412).
 *
 * Läuft über die Google Play Developer API (Android Publisher v3) mit einem
 * Dienstkonto. Ohne zusätzliche Abhängigkeit: das JWT für den Zugangstoken
 * signiert Node selbst (RS256), die Aufrufe gehen über fetch. Der Ablauf ist
 * der, den die Play Console beim Hochladen von Hand auch macht:
 *
 *   Edit anlegen -> Bundle hochladen -> Track mit Build und Versionshinweisen setzen -> Edit bestätigen
 *
 * Produktion bleibt bewusst außen vor: die Freigabe an alle klickt der
 * Betreiber selbst in der Play Console, damit kein Skriptfehler eine Version an
 * alle ausrollt. Das Dienstkonto braucht deshalb nur das Recht für Test-Tracks.
 */
const crypto = require("crypto");
const fs = require("fs");

const API = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const UPLOAD_API = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
// Die Play Console nennt den ersten geschlossenen Test „Alpha“ (Track „alpha“); weitere
// geschlossene Tracks tragen den Namen, den man ihnen dort gibt - der geht als --play=<name>.
const TRACK_ALIASES = { internal: "internal", intern: "internal", closed: "alpha", geschlossen: "alpha", alpha: "alpha", beta: "beta" };
const RELEASE_NOTES_LIMIT = 500;

/** Der JSON-Schlüssel des Dienstkontos; null, wenn die Datei fehlt. Der Inhalt wird nie ausgegeben. */
function loadServiceAccount(file) {
  if (!file || !fs.existsSync(file)) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`${file} ist kein gültiges JSON. Die Datei kommt unverändert aus der Google Cloud Console (Dienstkonto → Schlüssel → JSON).`);
  }
  for (const key of ["client_email", "private_key"]) {
    if (!parsed[key]) throw new Error(`${file}: Feld ${key} fehlt - ist das der JSON-Schlüssel eines Dienstkontos?`);
  }
  return { clientEmail: parsed.client_email, privateKey: parsed.private_key, tokenUri: parsed.token_uri || DEFAULT_TOKEN_URI };
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

/** Das signierte JWT, mit dem Google den Zugangstoken herausgibt (RS256, eine Stunde gültig). */
function assertion(account, now = Math.floor(Date.now() / 1000)) {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({ iss: account.clientEmail, scope: SCOPE, aud: account.tokenUri, iat: now, exp: now + 3600 }));
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), account.privateKey).toString("base64url");
  return `${header}.${claims}.${signature}`;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function accessToken(account, { fetch = globalThis.fetch, now } = {}) {
  const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: assertion(account, now) });
  const response = await fetch(account.tokenUri, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
  const data = await readJson(response);
  if (!response.ok || !data.access_token) {
    const reason = data.error_description || data.error || `HTTP ${response.status}`;
    throw new Error(`Google gab keinen Zugangstoken für das Dienstkonto (${reason}).`);
  }
  return data.access_token;
}

function client({ token, packageName, fetch = globalThis.fetch }) {
  const app = encodeURIComponent(packageName);
  const base = `${API}/applications/${app}`;

  async function call(method, url, { body, contentType = "application/json" } = {}) {
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers["Content-Type"] = contentType;
    const response = await fetch(url, { method, headers, body: body !== undefined && contentType === "application/json" ? JSON.stringify(body) : body });
    const data = await readJson(response);
    if (!response.ok) {
      const reason = data?.error?.message || `HTTP ${response.status}`;
      throw new Error(`Play API ${method} ${url.replace(UPLOAD_API, "").replace(API, "")}: ${reason}`);
    }
    return data;
  }

  return {
    insertEdit: () => call("POST", `${base}/edits`),
    deleteEdit: (editId) => call("DELETE", `${base}/edits/${editId}`),
    listTracks: (editId) => call("GET", `${base}/edits/${editId}/tracks`),
    uploadBundle: (editId, bytes) => call("POST", `${UPLOAD_API}/applications/${app}/edits/${editId}/bundles?uploadType=media`, { body: bytes, contentType: "application/octet-stream" }),
    updateTrack: (editId, track, release) => call("PUT", `${base}/edits/${editId}/tracks/${encodeURIComponent(track)}`, { body: { track, releases: [release] } }),
    commitEdit: (editId) => call("POST", `${base}/edits/${editId}:commit`),
  };
}

/** Der Track-Name für die API; Produktion wird abgelehnt. */
function resolveTrack(requested) {
  const key = String(requested || "internal").trim().toLowerCase();
  if (!key) return "internal";
  if (key === "production" || key === "produktion") {
    throw new Error("Produktion lädt dieses Skript nicht: die Freigabe an alle klickt der Betreiber selbst in der Play Console.");
  }
  return TRACK_ALIASES[key] || key;
}

/** Nur lesen: Edit anlegen, Tracks abfragen, Edit wieder verwerfen. Zeigt, ob das Dienstkonto die App sehen darf. */
async function checkAccess({ account, packageName, fetch }) {
  const token = await accessToken(account, { fetch });
  const api = client({ token, packageName, fetch });
  const edit = await api.insertEdit();
  try {
    const tracks = await api.listTracks(edit.id);
    return (tracks.tracks || []).map((entry) => entry.track).filter(Boolean);
  } finally {
    await api.deleteEdit(edit.id).catch(() => {});
  }
}

/** Versionshinweise für den Track: Play nimmt höchstens 500 Zeichen je Sprache. */
function trackNotes(notes) {
  const text = String(notes || "").trim();
  if (!text) return [];
  return [{ language: "de-DE", text: text.length > RELEASE_NOTES_LIMIT ? `${text.slice(0, RELEASE_NOTES_LIMIT - 1)}…` : text }];
}

/**
 * Lädt das Bundle und stellt es im Track fertig („completed“: alle Tester des
 * Tracks bekommen es). Ein Fehler verwirft den Edit; in der Play Console bleibt
 * dann nichts Halbfertiges liegen.
 */
async function publishBundle({ account, packageName, aabPath, versionCode, track, notes, fetch }) {
  const trackName = resolveTrack(track);
  const token = await accessToken(account, { fetch });
  const api = client({ token, packageName, fetch });
  const edit = await api.insertEdit();
  try {
    const bundle = await api.uploadBundle(edit.id, fs.readFileSync(aabPath));
    if (Number(bundle.versionCode) !== Number(versionCode)) {
      throw new Error(`Das hochgeladene Bundle trägt Build ${bundle.versionCode}, erwartet war ${versionCode}.`);
    }
    await api.updateTrack(edit.id, trackName, { versionCodes: [String(versionCode)], status: "completed", releaseNotes: trackNotes(notes) });
    const committed = await api.commitEdit(edit.id);
    return { editId: committed.id || edit.id, track: trackName, versionCode: Number(versionCode) };
  } catch (error) {
    await api.deleteEdit(edit.id).catch(() => {});
    throw error;
  }
}

module.exports = {
  API,
  DEFAULT_TOKEN_URI,
  RELEASE_NOTES_LIMIT,
  SCOPE,
  TRACK_ALIASES,
  UPLOAD_API,
  accessToken,
  assertion,
  checkAccess,
  client,
  loadServiceAccount,
  publishBundle,
  resolveTrack,
  trackNotes,
};
