// Browser-Benachrichtigungen (Web-Push, #1163): Meldungen auch bei geschlossener Website - am PC und im Handy-Browser, am
// iPhone nur mit der Website auf dem Home-Bildschirm. Der Server schaltet es frei (GET /web-push/config: ohne Schlüssel
// aus - dann kein Knopf und keine Frage).
//
// Gefragt wird nie beim ersten Besuch und erst im richtigen Moment: nach einer Turnier- oder Event-Anmeldung, und nur
// einmal je Browser. „Nicht jetzt“ merkt sich die Seite. Fällt die erste Anmeldung in den ersten Besuch, kommt die Frage
// beim nächsten Besuch. Am iPhone ohne Home-Bildschirm erscheint statt der Frage ein Hinweis, wie es geht.
//
// Die Anmeldung gehört dem Konto, das sie im Browser angelegt hat (OWNER_KEY). Meldet sich jemand anderes im selben Browser
// an, endet sie; Abmelden vom Konto beendet sie auch (forgetWebPush, der Server löscht seine Seite mit der Sitzung).
import { api } from "@/lib/api";

export const WEB_PUSH_EVENT = "tls:web-push-ask";
const ASK_KEY = "tls-web-push-ask";
const FIRST_VISIT_KEY = "tls-web-push-first-visit";
const VISIT_KEY = "tls-web-push-visit";
const OWNER_KEY = "tls-web-push-owner";
const PRIVATE_KEY = "tls-web-push-private";
const READY_TIMEOUT_MS = 5000;

function local(win) {
  try {
    return win?.localStorage || null;
  } catch {
    return null;
  }
}

function session(win) {
  try {
    return win?.sessionStorage || null;
  } catch {
    return null;
  }
}

function read(storage, key) {
  try {
    return storage?.getItem(key) || "";
  } catch {
    return "";
  }
}

function write(storage, key, value) {
  try {
    if (value) storage?.setItem(key, value);
    else storage?.removeItem(key);
  } catch {
    // privates Fenster - dann eben ohne Merken
  }
}

const currentWindow = () => (typeof window === "undefined" ? null : window);

/** Was dieser Browser kann. */
export function pushEnvironment(win = currentWindow()) {
  const nav = win?.navigator || {};
  const ua = String(nav.userAgent || "");
  const ios = /iPhone|iPad|iPod/.test(ua) || (nav.platform === "MacIntel" && Number(nav.maxTouchPoints) > 1);
  let standalone = nav.standalone === true;
  try {
    standalone = standalone || Boolean(win?.matchMedia?.("(display-mode: standalone)")?.matches);
  } catch {
    // ohne matchMedia
  }
  const supported = Boolean(win && "serviceWorker" in nav && "PushManager" in win && "Notification" in win);
  const permission = supported ? String(win.Notification.permission || "default") : "unsupported";
  return { supported, ios, standalone, permission };
}

/** Am iPhone geht Web-Push nur von der Website auf dem Home-Bildschirm aus. */
export const needsHomeScreen = (env) => Boolean(env?.ios && !env?.standalone && !env?.supported);

/** Den Besuch zählen: Der erste Besuch ist die Browser-Sitzung, in der die Seite den Browser zum ersten Mal sah. */
export function markVisit(win = currentWindow()) {
  const store = local(win);
  const tab = session(win);
  let visit = read(tab, VISIT_KEY);
  if (!visit) {
    visit = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    write(tab, VISIT_KEY, visit);
  }
  if (!read(store, FIRST_VISIT_KEY)) write(store, FIRST_VISIT_KEY, visit);
  return read(store, FIRST_VISIT_KEY) === visit;
}

export const askState = (win = currentWindow()) => read(local(win), ASK_KEY);
export const rememberAsk = (state, win = currentWindow()) => write(local(win), ASK_KEY, state);

/** Was nach einer Anmeldung passiert: "ask" (fragen), "ios-hint" (Hinweis), "pending" (beim nächsten Besuch) oder null. */
export function askDecision({ config, env, state, firstVisit }) {
  if (!config?.enabled || !config?.public_key) return null;
  if (state === "asked" || state === "declined") return null;
  if (env?.permission === "granted" || env?.permission === "denied") return null;
  const hint = needsHomeScreen(env);
  if (!env?.supported && !hint) return null;
  if (firstVisit) return "pending";
  return hint ? "ios-hint" : "ask";
}

export async function loadWebPushConfig() {
  try {
    const { data } = await api.get("/web-push/config");
    return data?.enabled && data?.public_key ? data : { enabled: false };
  } catch {
    return { enabled: false };
  }
}

/** Nach einer Turnier- oder Event-Anmeldung (oder beim nächsten Besuch): fragen, wenn es so weit ist. */
export async function offerWebPush(win = currentWindow(), { firstVisit } = {}) {
  if (!win) return null;
  const state = askState(win);
  if (state === "asked" || state === "declined") return null;
  const env = pushEnvironment(win);
  if (!env.supported && !needsHomeScreen(env)) return null;
  const config = await loadWebPushConfig();
  const decision = askDecision({ config, env, state, firstVisit: firstVisit ?? markVisit(win) });
  if (decision === "pending") rememberAsk("pending", win);
  if (decision === "ask" || decision === "ios-hint") win.dispatchEvent(new CustomEvent(WEB_PUSH_EVENT, { detail: { mode: decision, config } }));
  return decision;
}

/** Der öffentliche Schlüssel (base64url) als Bytes für pushManager.subscribe. */
export function keyBytes(base64url) {
  const text = String(base64url || "").replaceAll("-", "+").replaceAll("_", "/");
  const padded = text + "=".repeat((4 - (text.length % 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function sameKey(subscription, publicKey) {
  const current = subscription?.options?.applicationServerKey;
  if (!current) return true;
  const wanted = keyBytes(publicKey);
  const bytes = new Uint8Array(current);
  return bytes.length === wanted.length && bytes.every((value, index) => value === wanted[index]);
}

async function workerRegistration(win) {
  const container = win?.navigator?.serviceWorker;
  if (!container) return null;
  const ready = container.ready.catch(() => null);
  const timeout = new Promise((resolve) => { win.setTimeout(() => resolve(null), READY_TIMEOUT_MS); });
  return Promise.race([ready, timeout]);
}

async function currentSubscription(win) {
  const registration = await workerRegistration(win);
  if (!registration?.pushManager) return { registration: null, subscription: null };
  return { registration, subscription: await registration.pushManager.getSubscription() };
}

async function register(registration, subscription, config, userId, win) {
  let current = subscription;
  if (current && !sameKey(current, config.public_key)) {
    // Neue Schlüssel am Server: alte Anmeldung weg, neue her.
    await current.unsubscribe().catch(() => false);
    current = null;
  }
  if (!current) {
    current = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(config.public_key) });
  }
  const { data } = await api.post("/web-push/subscriptions", current.toJSON());
  write(local(win), OWNER_KEY, String(userId || ""));
  write(local(win), PRIVATE_KEY, data?.private ? "1" : "");
  return current;
}

/** „Inhalt verbergen“ für diesen Browser: so, wie der Server es zuletzt bestätigt hat. */
export const webPushPrivate = (win = currentWindow()) => read(local(win), PRIVATE_KEY) === "1";

/** „Inhalt verbergen“ umschalten - der Server schickt diesem Browser dann nur „Neue Benachrichtigung“. */
export async function setWebPushPrivate(value, win = currentWindow()) {
  const { subscription } = await currentSubscription(win);
  if (!subscription) return false;
  const { data } = await api.post("/web-push/subscriptions", { ...subscription.toJSON(), private: Boolean(value) });
  const stored = Boolean(data?.private);
  write(local(win), PRIVATE_KEY, stored ? "1" : "");
  return stored;
}

/**
 * Zustimmung holen und den Browser anmelden - nur aus einem Klick heraus (der Browser verlangt es).
 * Gibt { ok, reason } zurück: reason "denied" (abgelehnt), "unsupported", "no-worker" oder "error".
 */
export async function enableWebPush(user, config, win = currentWindow()) {
  const env = pushEnvironment(win);
  if (!env.supported || !config?.enabled) return { ok: false, reason: "unsupported" };
  let permission = env.permission;
  if (permission !== "granted") {
    try {
      permission = await win.Notification.requestPermission();
    } catch {
      permission = "default";
    }
  }
  if (permission !== "granted") {
    rememberAsk("declined", win);
    return { ok: false, reason: permission === "denied" ? "denied" : "dismissed" };
  }
  rememberAsk("asked", win);
  try {
    const { registration, subscription } = await currentSubscription(win);
    if (!registration) return { ok: false, reason: "no-worker" };
    await register(registration, subscription, config, user?.id, win);
    return { ok: true };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** Diesen Browser abmelden (Schalter in den Einstellungen). */
export async function disableWebPush(win = currentWindow()) {
  try {
    const { subscription } = await currentSubscription(win);
    if (subscription) {
      await api.delete("/web-push/subscriptions", { data: { endpoint: subscription.endpoint } }).catch(() => null);
      await subscription.unsubscribe().catch(() => false);
    }
  } finally {
    write(local(win), OWNER_KEY, "");
    write(local(win), PRIVATE_KEY, "");
  }
  return true;
}

/**
 * Beim Laden mit Konto: eine bestehende Anmeldung dieses Kontos beim Server auffrischen (neue Sitzung, neue Schlüssel).
 * Gehört die Anmeldung einem anderen Konto, endet sie - nie bekommt jemand die Meldungen eines anderen.
 */
export async function syncWebPush(user, win = currentWindow()) {
  const env = pushEnvironment(win);
  if (!user?.id || !env.supported || env.permission !== "granted") return "skipped";
  const { registration, subscription } = await currentSubscription(win);
  if (!registration || !subscription) return "none";
  const owner = read(local(win), OWNER_KEY);
  if (owner !== String(user.id)) {
    await subscription.unsubscribe().catch(() => false);
    write(local(win), OWNER_KEY, "");
    return "foreign";
  }
  const config = await loadWebPushConfig();
  if (!config.enabled) return "off";
  try {
    await register(registration, subscription, config, user.id, win);
    return "synced";
  } catch {
    return "error";
  }
}

/** Abmelden vom Konto: die Anmeldung dieses Browsers endet. Bleibt still, wenn es nichts zu tun gibt. */
export async function forgetWebPush(win = currentWindow()) {
  try {
    if (!pushEnvironment(win).supported) return;
    const { subscription } = await currentSubscription(win);
    await subscription?.unsubscribe?.().catch(() => false);
  } catch {
    // still - der Server löscht seine Seite beim Abmelden ohnehin
  } finally {
    write(local(win), OWNER_KEY, "");
    write(local(win), PRIVATE_KEY, "");
  }
}

/** Zustand für die Einstellungen: "subscribed", "available", "denied", "ios-hint" oder "unsupported". */
export async function browserPushStatus(user, win = currentWindow()) {
  const env = pushEnvironment(win);
  if (needsHomeScreen(env)) return "ios-hint";
  if (!env.supported) return "unsupported";
  if (env.permission === "denied") return "denied";
  if (env.permission !== "granted") return "available";
  const { subscription } = await currentSubscription(win);
  return subscription && read(local(win), OWNER_KEY) === String(user?.id || "") ? "subscribed" : "available";
}
