import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { withKeyLock } from "./levelSeen";
import { rewardPackages, type RewardAward } from "./leagueRewards";

// Saisonende-Moment in der App (#2584, docs/LIGA.md „F.8 Saisonende-Moment“, Web: components/tls/league/moment/momentPackage.js und
// lib/momentMarks.js): Aufstieg, Abstieg oder Meister einmal als ruhiger Moment. Texte und Abzeichen kommen fertig vom Server.
//
// Einmaligkeit je Gerät: Direkt vor dem Zeigen holt die App den Moment für dieses Gerät (`POST /me/league-moments/seen {ids, token}`)
// und zeigt ihn nur, wenn der Server ihn zuspricht (`claimed`). `token` ist der Geräte-Schlüssel - einer je Gerät und Konto, zufällig,
// im sicheren Speicher ohne Mitnahme in Sicherungen. Geht die Antwort verloren, bekommt dasselbe Gerät den Moment beim nächsten Start
// wieder, ein anderes nicht (der Server merkt sich den Schlüssel 12 Stunden). Erst nach dem Schließen gilt er als fertig
// (`POST …/done`); geht diese Meldung verloren, merkt sich die App das und meldet beim nächsten Abruf still nach, statt ihn noch einmal
// zu zeigen. Die Marken hängen am Konto (eine andere Person am selben Handy sieht ihren Moment trotzdem) und gehen beim Abmelden und
// beim Kontowechsel (AuthContext, forgetAccountData).

export const MOMENT_MARKS_KEY = "tls.mobile.leagueMoments";
/** So viele „fertig, aber noch nicht gemeldet“ merkt sich die App je Konto - der Server nimmt höchstens 20 je Aufruf. */
export const MAX_DONE_MARKS = 20;
const STORE_OPTIONS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export type LeagueMomentOutcome = "champion" | "up" | "down";
export type MomentStep = { level?: number | null; nickname?: string | null; label?: string | null };
export type MomentBadge = { level?: number | null; nickname?: string | null; champion?: boolean };
export type MomentTexts = {
  label?: string | null;
  kicker?: string | null;
  title?: string | null;
  name?: string | null;
  meta?: string | null;
  line?: string | null;
  next?: string | null;
  summary?: string | null;
  aria?: string | null;
  notice?: string | null;
};
export type LeagueMoment = {
  id: string;
  outcome: LeagueMomentOutcome;
  season_id?: string | null;
  season_name?: string | null;
  league_name?: string | null;
  title?: string | null;
  url?: string | null;
  squad_id?: string | null;
  team_id?: string | null;
  display_name?: string | null;
  from?: MomentStep | null;
  to?: MomentStep | null;
  badge_from?: MomentBadge | null;
  badge_to?: MomentBadge | null;
  via?: string | null;
  playoffs?: boolean;
  corrected?: boolean;
  confirmed_at?: string | null;
  texts?: MomentTexts | null;
  /** Für Captain und Vertreter mit offenem Startrecht: „Startrecht zusagen“. */
  next_step?: { label?: string | null; url?: string | null } | null;
  /** Nur am Meister: die Belohnungen derselben Season für die zweite Karte. */
  rewards?: RewardAward[] | null;
};

const OUTCOMES = new Set<string>(["champion", "up", "down"]);

/** Ein Moment, den die App zeigen kann: mit Kennung, bekanntem Ausgang und den Texten vom Server. */
export function isLeagueMoment(value: unknown): value is LeagueMoment {
  const row = value as LeagueMoment | null;
  return Boolean(row && typeof row.id === "string" && row.id && OUTCOMES.has(String(row.outcome)) && row.texts);
}

/** "top" (Liga 1, mit Krone), "mid" (Liga 2, doppelter Rand), "base" (ab Liga 3, schlicht) - wie `badgeTier` im Web. */
export function crestTier(level?: number | null): "top" | "mid" | "base" | null {
  const value = Number(level);
  if (!Number.isInteger(value) || value < 1) return null;
  if (value === 1) return "top";
  return value === 2 ? "mid" : "base";
}

// ---------------------------------------------------------------- Marken je Gerät und Konto

type AccountMarks = { token?: string; done?: string[] };
type Marks = { accounts: Record<string, AccountMarks> };

async function readMarks(): Promise<Marks> {
  try {
    const parsed = JSON.parse((await SecureStore.getItemAsync(MOMENT_MARKS_KEY, STORE_OPTIONS)) || "null") as Marks | null;
    return parsed && typeof parsed.accounts === "object" && parsed.accounts ? parsed : { accounts: {} };
  } catch {
    return { accounts: {} };
  }
}

/** Lesen, ändern, schreiben - unter einer Sperre, damit zwei Abrufe zugleich nichts verlieren. */
function changeMarks<T>(userId: string, change: (account: AccountMarks) => T): Promise<T> {
  return withKeyLock(MOMENT_MARKS_KEY, async () => {
    const marks = await readMarks();
    const account = { ...(marks.accounts[userId] || {}) };
    const result = change(account);
    marks.accounts[userId] = account;
    await SecureStore.setItemAsync(MOMENT_MARKS_KEY, JSON.stringify(marks), STORE_OPTIONS).catch(() => {});
    return result;
  });
}

function freshToken(): string {
  try {
    const value = Crypto.randomUUID();
    if (/^[A-Za-z0-9-]{8,80}$/.test(value)) return value;
  } catch {
    // ohne Krypto-Modul unten weiter
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Der Geräte-Schlüssel dieses Kontos - beim ersten Mal angelegt, danach aus dem sicheren Speicher. */
export function momentToken(userId: string): Promise<string> {
  return changeMarks(userId, (account) => {
    if (!account.token || !/^[A-Za-z0-9-]{8,80}$/.test(account.token)) account.token = freshToken();
    return account.token;
  });
}

/** Geschlossen, „fertig“ ist aber noch nicht beim Server - bis es ankommt, zeigt dieses Gerät den Moment nicht mehr. */
export function markMomentDone(userId: string, id: string): Promise<void> {
  return changeMarks(userId, (account) => {
    const done = (account.done || []).filter((known) => known !== id);
    done.push(id);
    account.done = done.slice(-MAX_DONE_MARKS);
  });
}

/** „Fertig“ ist beim Server angekommen - die Marke kann weg. */
export function forgetMomentDone(userId: string, id: string): Promise<void> {
  return changeMarks(userId, (account) => {
    account.done = (account.done || []).filter((known) => known !== id);
  });
}

export async function momentsDoneHere(userId: string): Promise<string[]> {
  const marks = await withKeyLock(MOMENT_MARKS_KEY, readMarks);
  return [...(marks.accounts[userId]?.done || [])];
}

/** Beim Abmelden und beim Kontowechsel: alle Marken des Moments weg. */
export function clearMomentMarks(): Promise<void> {
  return withKeyLock(MOMENT_MARKS_KEY, () => SecureStore.deleteItemAsync(MOMENT_MARKS_KEY, STORE_OPTIONS).catch(() => {}));
}

// ---------------------------------------------------------------- Reihenfolge der Zeremonien

export type CeremonyItem =
  | { kind: "moment"; key: string; moment: LeagueMoment; rewards: RewardAward[]; replay?: boolean }
  | { kind: "rewards"; key: string; rewards: RewardAward[] };

/**
 * Was als Nächstes gefeiert wird: erst die Momente (der Server liefert Meister, Aufstieg, Abstieg in dieser Reihenfolge), dann je
 * Staffel die Belohnungen. Was der Meister mitbringt, steht nicht noch einmal als eigene Zeremonie da. `queued` hält fest, was schon
 * eingereiht ist (über alle Abrufe); was dieses Gerät schon geschlossen hat (`doneHere`), wird nicht gezeigt, sondern still nachgemeldet.
 */
export function planCeremonies(
  moments: Array<LeagueMoment | null | undefined> | null | undefined,
  rewards: Array<RewardAward | null | undefined> | null | undefined,
  { queued, doneHere }: { queued: Set<string>; doneHere: Set<string> },
): { items: CeremonyItem[]; reportDone: string[] } {
  const items: CeremonyItem[] = [];
  const reportDone: string[] = [];
  for (const row of moments || []) {
    if (!isLeagueMoment(row)) continue;
    const key = `moment:${row.id}`;
    if (queued.has(key)) continue;
    queued.add(key);
    if (doneHere.has(row.id)) {
      reportDone.push(row.id);
      continue;
    }
    const own = (row.rewards || []).filter((award): award is RewardAward => Boolean(award?.id && award.reward));
    own.forEach((award) => queued.add(award.id));
    items.push({ kind: "moment", key, moment: row, rewards: own });
  }
  const fresh = (rewards || []).filter((award): award is RewardAward => Boolean(award?.id && award.reward && !queued.has(award.id)));
  for (const group of rewardPackages(fresh)) {
    group.forEach((award) => queued.add(award.id));
    items.push({ kind: "rewards", key: `rewards:${group.map((award) => award.id).join("-")}`, rewards: group });
  }
  return { items, reportDone };
}

// ---------------------------------------------------------------- Noch einmal ansehen, Push

type Listener = (request: { kind: "replay"; moment: LeagueMoment } | { kind: "fetch"; id: string }) => void;
const listeners = new Set<Listener>();

/** Der Zeremonie-Host hört hier zu: „Moment ansehen“ am Hinweis und das Antippen der Nachricht. */
export function subscribeMomentRequests(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** „Moment ansehen“: noch einmal abspielen - ohne Zählung beim Server (der Host legt ihn nur einmal in die Schlange). */
export function replayMoment(moment: LeagueMoment) {
  if (!isLeagueMoment(moment)) return;
  listeners.forEach((listener) => listener({ kind: "replay", moment }));
}

/** Push „Aufstieg in Liga 1“ angetippt (`meta.reason: league_moment`): gleich nachsehen, ob der Moment noch offen ist. */
export function requestMoment(id?: string | null) {
  if (!id) return;
  listeners.forEach((listener) => listener({ kind: "fetch", id }));
}
