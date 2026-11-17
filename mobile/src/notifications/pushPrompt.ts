import type { PushPermission } from "./PushService";
import { readPromptState, updatePromptState, type PushPromptState } from "./pushPromptStore";

// Erlaubnis im richtigen Moment (#1208): Die App fragt nicht beim Login, sondern nach einer Turnier- oder
// Event-Anmeldung - erst mit der eigenen Erklärung („Sollen wir dich rufen, wenn du dran bist?“), bei „Ja, rufen“ dann
// Android. Teammitglieder, deren Team angemeldet wurde, sehen die Frage beim nächsten Öffnen der Startseite.
//
// Merker nur auf diesem Gerät (pushPromptStore), nicht am Server:
// - je Konto, welche Anmeldungen die App schon kennt. Neu ist eine Anmeldung, die sie noch nicht kannte - das ist der
//   Anlass zu fragen. „Später“ braucht darum keinen eigenen Merker: gefragt wird erst bei der nächsten neuen Anmeldung.
//   Die erste Startseite nach Installation oder Login zählt als Ausgangsstand (keine Frage direkt nach dem Login); beim
//   Abmelden gehen die Merker der Konten (forgetPushPromptAccounts).
// - ob die App Android schon gefragt hat (`asked`). Android 13 und neuer meldet vor der ersten Frage „denied“ mit
//   „canAskAgain“ (expo-notifications, NotificationPermissionsModule.kt: `!areEnabled -> DENIED` vor UNDETERMINED) -
//   „abgelehnt“ heißt darum erst: gefragt und Nein, oder Android lässt nicht mehr fragen.
// Wer erlaubt hat, merkt nichts; wer abgelehnt hat, sieht nur den leisen Hinweis auf Turnier- und Event-Seiten.

/** Höchstens so viele Anmeldungen merkt sich die App je Konto (die neuesten). */
export const PUSH_PROMPT_MAX_KEYS = 80;

/** Anlass der Frage: die eigene Anmeldung oder ein angemeldetes Team. */
export type PushPromptReason = "own" | "team";

type DashboardRow = { id?: string | null; my_registration?: { team_id?: string | null } | null };
type DashboardMe = { tournaments?: DashboardRow[] | null; events?: DashboardRow[] | null } | null | undefined;

/** Die Kennung einer Anmeldung: Turnier oder Event. */
export function registrationKey(kind: "tournament" | "event", id: string | null | undefined): string | null {
  return id ? `${kind === "tournament" ? "t" : "e"}:${id}` : null;
}

/** Die Anmeldungen der Startseite (eigene und die des Teams, so wie der Server sie unter „Meine“ führt). */
export function dashboardRegistrationKeys(me: DashboardMe): string[] {
  const keys = [
    ...(me?.tournaments || []).map((row) => registrationKey("tournament", row?.id)),
    ...(me?.events || []).map((row) => registrationKey("event", row?.id)),
  ];
  return [...new Set(keys.filter((key): key is string => Boolean(key)))];
}

/** Die Turniere, in denen das Team angemeldet ist (die Anmeldung trägt eine Team-Kennung). */
export function dashboardTeamKeys(me: DashboardMe): string[] {
  return (me?.tournaments || [])
    .filter((row) => Boolean(row?.my_registration?.team_id))
    .map((row) => registrationKey("tournament", row?.id))
    .filter((key): key is string => Boolean(key));
}

/**
 * Fragt die App? Noch nie entschieden („undetermined“), oder Android 13 vor der ersten Frage: „denied“, aber Android
 * fragt noch, und die App hat noch nie gefragt.
 */
export function shouldAskForPush(permission: PushPermission | null | undefined, asked: boolean): boolean {
  if (permission?.status === "undetermined") return true;
  return permission?.status === "denied" && permission.canAskAgain && !asked;
}

/** Der leise Hinweis „Aufrufe sind aus“: gefragt und abgelehnt, oder Android lässt nicht mehr fragen. */
export function pushOffHintVisible(permission: PushPermission | null | undefined, asked: boolean): boolean {
  return permission?.status === "denied" && (asked || !permission.canAskAgain);
}

/** Hat die App Android auf diesem Gerät schon gefragt? */
export async function isPushAsked(): Promise<boolean> {
  return (await readPromptState().catch(() => null))?.asked === true;
}

/** Die App hat Android gefragt (askPushPermission). */
export async function markPushAsked(): Promise<void> {
  await updatePromptState((state) => ({ ...state, asked: true })).catch(() => undefined);
}

/**
 * Erster Start mit dieser Fassung (#1208): Bisher fragte die App direkt beim Login. War beim Update eine Sitzung
 * gespeichert und ist Push nicht erlaubt, hat Android schon gefragt - dann gilt das als gefragt, und es kommt der leise
 * Hinweis statt einer neuen Erklärung. Ohne Sitzung (frisch installiert oder abgemeldet) bleibt alles offen. Nur einmal.
 */
export async function notePushUpgrade(hadSession: boolean, readPermission: () => Promise<PushPermission>): Promise<void> {
  const state = await readPromptState().catch(() => null);
  if (!state || state.migrated) return;
  let asked = state.asked;
  if (hadSession && !asked) {
    const permission = await readPermission().catch(() => null);
    asked = Boolean(permission && permission.status !== "granted" && permission.status !== "unavailable");
  }
  await updatePromptState((current) => ({ ...current, migrated: true, asked: current.asked || asked })).catch(() => undefined);
}

/** Abmelden oder Kontowechsel: die Merker der Konten gehen - beim nächsten Login ist die Startseite wieder Ausgangsstand. */
export async function forgetPushPromptAccounts(): Promise<void> {
  await updatePromptState((state) => ({ ...state, users: {} })).catch(() => undefined);
}

function merged(seen: string[], keys: string[]): string[] {
  return [...seen.filter((key) => !keys.includes(key)), ...keys].slice(-PUSH_PROMPT_MAX_KEYS);
}

function withUser(state: PushPromptState, userId: string, seen: string[], fresh = false): PushPromptState {
  return { ...state, users: { ...state.users, [userId]: fresh ? { seen, fresh: true } : { seen } } };
}

/**
 * Eigene Anmeldung in der App: merken, damit die Startseite sie nicht noch einmal als neu zählt. Gab es noch keinen
 * Ausgangsstand, wird die nächste Startseite zum Ausgangsstand (`fresh`) - ältere Anmeldungen sind kein neuer Anlass.
 */
export async function rememberOwnRegistration(userId: string, key: string): Promise<void> {
  await updatePromptState((state) => {
    const stored = state.users[userId];
    return stored ? withUser(state, userId, merged(stored.seen, [key]), stored.fresh) : withUser(state, userId, [key], true);
  });
}

/**
 * Die Startseite meldet die aktuellen Anmeldungen. Zurück kommt der Anlass zu fragen - "team", wenn eine neue Anmeldung
 * die des Teams ist, sonst "own" (etwa auf der Website angemeldet) - oder null. Beim ersten Mal (Ausgangsstand) nie.
 */
export async function noteRegistrations(userId: string, keys: string[], teamKeys: string[] = []): Promise<PushPromptReason | null> {
  let reason: PushPromptReason | null = null;
  await updatePromptState((state) => {
    const stored = state.users[userId];
    if (!stored) return withUser(state, userId, keys.slice(-PUSH_PROMPT_MAX_KEYS));
    const fresh = keys.filter((key) => !stored.seen.includes(key));
    if (!fresh.length && !stored.fresh) return state;
    if (fresh.length && !stored.fresh) reason = fresh.some((key) => teamKeys.includes(key)) ? "team" : "own";
    return withUser(state, userId, merged(stored.seen, fresh));
  });
  return reason;
}

// Der Host (PushPromptHost, einmal im Navigator) meldet sich an; Anmeldungen und Startseite rufen offerPushPrompt.
export type PushPromptRequest = { after?: Promise<unknown>; reason?: PushPromptReason };
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
  const remembered = key ? rememberOwnRegistration(userId, key).catch(() => undefined) : Promise.resolve();
  offerPushPrompt({ reason: "own", after: Promise.all([remembered, after]).catch(() => undefined) });
}

/** Nach dem Laden der Startseite: eine neue Anmeldung (etwa durchs Team) ist der Anlass zu fragen. */
export async function afterDashboard(userId: string | null | undefined, me: DashboardMe): Promise<PushPromptReason | null> {
  if (!userId) return null;
  const reason = await noteRegistrations(userId, dashboardRegistrationKeys(me), dashboardTeamKeys(me)).catch(() => null);
  if (reason) offerPushPrompt({ reason });
  return reason;
}
