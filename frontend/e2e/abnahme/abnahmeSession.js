const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { expect } = require("@playwright/test");

// Gemeinsame Hilfen der Abnahme gegen den echten Server (docs/entwicklung/abnahme-lokal.md): Stand-Datei lesen,
// anmelden - und die Sitzung je Konto wiederverwenden. Jede Zwei-Faktor-Anmeldung verbraucht ein 30-Sekunden-Fenster
// (ein Code zählt einmal, #1032), und viele Anmeldungen hintereinander laufen in die Sperre gegen Rateversuche. Darum:
// erst die gespeicherte Sitzung probieren, nur wenn sie nicht mehr gilt neu anmelden, und dann nie mit einem Code aus
// einem Fenster, das schon verbraucht ist.

const ENABLED = process.env.ABNAHME === "1";
const STATE_FILE = process.env.ABNAHME_STATE || path.join(__dirname, "..", "..", "..", ".local-testing", "abnahme", "state.json");
const SESSION_DIR = path.join(path.dirname(STATE_FILE), `sessions-${path.basename(STATE_FILE, ".json")}`);
const state = ENABLED && fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : null;
const COOKIE_CONSENT = {
  essential: true, external_media: false, analytics: false, meta: false, tiktok: false,
};

function base32(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

/** TOTP nach RFC 6238 (SHA-1, 30 Sekunden, 6 Stellen) für ein Zeitfenster. */
function totp(secret, counter) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", base32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0xf;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

const MAX_LIMIT_WAIT_SECONDS = 200;
const windowNow = () => Math.floor(Date.now() / 1000 / 30);

function sessionFile(role) {
  return path.join(SESSION_DIR, `${role}.json`);
}

function readSession(role) {
  try {
    return JSON.parse(fs.readFileSync(sessionFile(role), "utf8"));
  } catch {
    return {};
  }
}

function writeSession(role, data) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  fs.writeFileSync(sessionFile(role), JSON.stringify(data));
}

async function acceptNecessaryCookiesOnly(page) {
  await page.addInitScript((consent) => {
    window.localStorage.setItem("tls_cookie_consent_v1", JSON.stringify({
      ...consent, saved_at: Date.now(), expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }));
  }, COOKIE_CONSENT);
}

/**
 * Als `role` (Schlüssel in state.accounts) angemeldet sein: gespeicherte Sitzung, sonst neu anmelden. „anon“ bleibt
 * abgemeldet. Liest Cookies nur aus `.local-testing` (nicht im Repo).
 */
async function signIn(page, role) {
  await acceptNecessaryCookiesOnly(page);
  if (role === "anon") return;
  const account = state.accounts[role];
  const saved = readSession(role);
  if (saved.cookies?.length) {
    await page.context().addCookies(saved.cookies);
    const me = await page.request.get("/api/auth/me");
    if (me.status() === 200) return;
    await page.context().clearCookies();
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const started = await page.request.post("/api/auth/login", { data: { email: account.email, password: account.password, remember: true } });
    if (await waitedForLimit(page, started)) continue;
    expect(started.status(), await started.text()).toBe(200);
    const body = await started.json();
    if (body.mfa_required) {
      // Nie ein Fenster zweimal: war das jetzige schon dran (gespeichert), auf das nächste warten.
      const used = readSession(role).lastWindow || 0;
      while (windowNow() <= used) await page.waitForTimeout(1_000);
      const counter = windowNow();
      const done = await page.request.post("/api/auth/mfa/complete", { data: { ticket: body.mfa_ticket, code: totp(account.totp, counter), client: "web" } });
      writeSession(role, { ...readSession(role), lastWindow: counter });
      if (await waitedForLimit(page, done)) continue;
      if (done.status() !== 200) continue;
    }
    writeSession(role, { ...readSession(role), cookies: await page.context().cookies() });
    return;
  }
  throw new Error(`Anmeldung ${account.email} nicht möglich (dreimal abgelehnt)`);
}

/**
 * Sperre gegen Rateversuche (429): kurz warten und true melden (neuer Versuch), bei langer Sperre klar abbrechen statt
 * mit weiteren Versuchen die Sperre zu verlängern. Zwei-Faktor zählt je Adresse 20 Versuche in 15 Minuten.
 */
async function waitedForLimit(page, response) {
  if (response.status() !== 429) return false;
  const seconds = Number(response.headers()["retry-after"] || 60);
  if (seconds > MAX_LIMIT_WAIT_SECONDS) {
    throw new Error(`Anmeldung gesperrt (zu viele Versuche), noch ${seconds} s - später erneut starten oder Stand neu befüllen`);
  }
  await page.waitForTimeout((seconds + 1) * 1_000);
  return true;
}

/** Probleme sammeln: Seitenfehler, Konsolenfehler, Antworten 4xx/5xx der API. `allow(response)` nimmt Erwartetes aus. */
function watch(page, { allow = () => false, allowConsole = () => false } = {}) {
  const problems = [];
  page.on("pageerror", (error) => problems.push(`Seitenfehler: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !allowConsole(message.text())) problems.push(`Konsole: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url().includes("/api/") && !allow(response)) {
      problems.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  return problems;
}

module.exports = { ENABLED, STATE_FILE, state, signIn, watch };
