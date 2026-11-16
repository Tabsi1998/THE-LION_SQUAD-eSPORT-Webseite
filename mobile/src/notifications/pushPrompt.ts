import * as SecureStore from "expo-secure-store";
import { withKeyLock } from "../lib/levelSeen";
import type { PushPermission } from "./PushService";

// Erlaubnis im richtigen Moment (#1208): Die App fragt nicht beim Login, sondern nach einer Turnier- oder
// Event-Anmeldung - erst mit der eigenen Erklärung („Sollen wir dich rufen, wenn du dran bist?“), bei „Ja, rufen“ dann
// Android. Teammitglieder, deren Team angemeldet wurde, sehen die Frage beim nächsten Öffnen der Startseite.
//
// Merker nur auf diesem Gerät, je Konto (nicht am Server): welche Anmeldungen die App schon kennt. Neu ist eine
// Anmeldung, die sie noch nicht kannte - das ist der Anlass zu fragen. „Später“ braucht darum keinen eigenen Merker:
// gefragt wird erst bei der nächsten neuen Anmeldung wieder. Die erste Startseite nach Installation oder Login zählt als
// Ausgangsstand (keine Frage direkt nach dem Login). Wer erlaubt hat, merkt nichts; wer abgelehnt hat, sieht nur den
// leisen Hinweis auf Turnier- und Event-Seiten.

/** Höchstens so viele Anmeldungen merkt sich die App (die neuesten). */
export const PUSH_PROMPT_MAX_KEYS = 300;

type Stored = { seen: string[]; fresh?: boolean };

export function pushPromptKey(userId: string) {
  return `tls.mobile.pushPrompt.${userId.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

/** Die Kennung einer Anmeldung: Turnier oder Event. */
export function registrationKey(kind: "tournament" | "event", id: string | null | undefined): string | null {
  return id ? `${kind === "tournament" ? "t" : "e"}:${id}` : null;
}

/** Die Anmeldungen der Startseite (eigene und die des Teams, so wie der Server sie unter „Meine“ führt). */
export function dashboardRegistrationKeys(me: { tournaments?: { id?: string | null }[]; events?: { id?: string | null }[] } | null | undefined): string[] {
  const keys = [
    ...(me?.tournaments || []).map((row) => registrationKey("tournament", row?.id)),
    ...(me?.events || []).map((row) => registrationKey("event", row?.id)),
  ];
  return [...new Set(keys.filter((key): key is string => Boolean(key)))];
}

/** Fragt die App überhaupt? Nur, solange das System noch nicht entschieden ist. */
export function shouldAskForPush(permission: PushPermission | null | undefined): boolean {
  return permission?.status === "undetermined";
}

/** Der leise Hinweis „Aufrufe sind aus“: nur, wer abgelehnt hat oder wem das System die Erlaubnis verweigert. */
export function pushOffHintVisible(permission: PushPermission | null | undefined): boolean {
  return permission?.status === "denied";
}

async function readStored(key: string): Promise<Stored | null> {
  try {
    const parsed = JSON.parse((await SecureStore.getItemAsync(key)) || "null");
    if (parsed && Array.isArray(parsed.seen)) return { seen: parsed.seen.filter((value: unknown) => typeof value === "string"), fresh: parsed.fresh === true };
  } catch {
    // kaputter Merker: wie neu
  }
  return null;
}

async function writeStored(key: string, value: Stored): Promise<void> {
  const seen = value.seen.slice(-PUSH_PROMPT_MAX_KEYS);
  await SecureStore.setItemAsync(key, JSON.stringify(value.fresh ? { seen, fresh: true } : { seen })).catch(() => {});
}

function merged(seen: string[], keys: string[]): string[] {
  const out = seen.filter((key) => !keys.includes(key));
  return [...out, ...keys];
}

/**
 * Eigene Anmeldung in der App: merken, damit die Startseite sie nicht noch einmal als neu zählt. Gab es noch keinen
 * Ausgangsstand, wird die nächste Startseite zum Ausgangsstand (`fresh`) - ältere Anmeldungen sind kein neuer Anlass.
 */
export function rememberOwnRegistration(userId: string, key: string): Promise<void> {
  const storeKey = pushPromptKey(userId);
  return withKeyLock(storeKey, async () => {
    const stored = await readStored(storeKey);
    await writeStored(storeKey, stored ? { ...stored, seen: merged(stored.seen, [key]) } : { seen: [key], fresh: true });
  });
}

/**
 * Die Startseite meldet die aktuellen Anmeldungen. Zurück kommt, ob eine neue dabei ist (Team angemeldet, oder auf der
 * Website angemeldet) - der Anlass zu fragen. Beim ersten Mal (Ausgangsstand) nie.
 */
export function noteRegistrations(userId: string, keys: string[]): Promise<boolean> {
  const storeKey = pushPromptKey(userId);
  return withKeyLock(storeKey, async () => {
    const stored = await readStored(storeKey);
    if (!stored) {
      await writeStored(storeKey, { seen: keys });
      return false;
    }
    const fresh = keys.filter((key) => !stored.seen.includes(key));
    if (!fresh.length && !stored.fresh) return false;
    await writeStored(storeKey, { seen: merged(stored.seen, fresh) });
    return fresh.length > 0 && !stored.fresh;
  });
}

// Der Host (PushPromptHost, einmal im Navigator) meldet sich an; Anmeldungen und Startseite rufen offerPushPrompt.
export type PushPromptRequest = { after?: Promise<unknown> };
type Listener = (request: PushPromptRequest) => void;
const listeners = new Set<Listener>();

export function onPushPrompt(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Anlass zu fragen: Der Host prüft die Erlaubnis und zeigt die Erklärung, wenn es passt. `after`: erst danach. */
export function offerPushPrompt(request: PushPromptRequest = {}): boolean {
  if (!listeners.size) return false;
  for (const listener of [...listeners]) listener(request);
  return true;
}

/** Nach einer eigenen Anmeldung (Turnier, Event, „Spielst du auch mit?“): merken und fragen. */
export function afterOwnRegistration(userId: string | null | undefined, key: string | null, after?: Promise<unknown>): void {
  if (!userId) return;
  const remembered = key ? rememberOwnRegistration(userId, key) : Promise.resolve();
  offerPushPrompt({ after: Promise.all([remembered, after]).catch(() => undefined) });
}

/** Nach dem Laden der Startseite: eine neue Anmeldung (etwa durchs Team) ist der Anlass zu fragen. */
export async function afterDashboard(userId: string | null | undefined, keys: string[]): Promise<boolean> {
  if (!userId) return false;
  const isNew = await noteRegistrations(userId, keys).catch(() => false);
  if (isNew) offerPushPrompt();
  return isNew;
}
