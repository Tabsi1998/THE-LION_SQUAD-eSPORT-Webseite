import * as SecureStore from "expo-secure-store";
import { api, responseFromCache } from "../../lib/api";
import { type CeremonyTier, type LevelState, type LevelUp, isLevelGain } from "./select";

// Zeremonie einmal je Konto (#2450) - wie im Web (frontend/src/components/achievements/ceremony/seen.js). „Gesehen“
// steht am Server, App und Website teilen denselben Stand. Bisher merkte sich jedes Gerät selbst, was es schon gefeiert
// hatte - dieselbe Zeremonie kam dadurch in der App, am PC und im Handy-Browser je einmal.
//
// - `ceremonyState(userId)`: der Stand am Server. Beim ersten Mal meldet die App einmalig, was sie lokal schon als
//   gesehen kannte (Altbestand) - danach zählt nur der Server. Kennt der Server das noch nicht (ältere Fassung), kommt
//   null: dann bleibt alles wie bisher im Gerät.
// - `markSeen(userId, …)`: nach jeder Art des Schließens (X, Tipp daneben, Zurück-Taste, Ablauf zu Ende).
// - `serverCheck(userId)`: die Prüfung direkt vor dem Anzeigen - was ein anderes Gerät geschlossen hat, fällt weg.

const safe = (id: string) => id.replace(/[^a-zA-Z0-9._-]/g, "");
// SecureStore-Schlüssel dürfen nur Buchstaben, Ziffern und „.-_“ enthalten.
export const achSeenKey = (id: string) => `tls_ach_seen_${safe(id)}`;
export const levelSeenKey = (id: string) => `tls_level_seen_${safe(id)}`;
export const importedKey = (id: string) => `tls_ceremony_imported_${safe(id)}`;

export type CeremonyState = { unseen: string[]; level: LevelState | null; recountSeen: string[] };
type ServerState = { since?: string | null; unseen?: unknown; level?: Partial<LevelState> | null; recount_seen?: string[] };
type LegacyReport = { seen_until?: string; level?: LevelState };
type CheckEntry = { tiers?: CeremonyTier[]; levelUp?: LevelUp | null };

async function read(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

/** Was die App bisher selbst als gesehen kannte - für die einmalige Meldung an den Server. */
export async function legacyReport(userId: string): Promise<LegacyReport> {
  const report: LegacyReport = {};
  const until = await read(achSeenKey(userId));
  if (until) report.seen_until = until;
  try {
    const level = JSON.parse((await read(levelSeenKey(userId))) || "null") as Partial<LevelState> | null;
    if (level && Number(level.level) >= 1) report.level = { level: Number(level.level), title: String(level.title || ""), prestige: Number(level.prestige || 0) };
  } catch {
    /* kaputter Merker - nichts zu melden */
  }
  return report;
}

const inflight = new Map<string, Promise<CeremonyState | null>>();
const unsupported = new Set<string>();
// Was die App in dieser Sitzung schon geschlossen hat - zählt, bis der Server es bestätigt.
const localSeen = new Map<string, { codes: Set<string>; level: LevelState | null }>();

function local(userId: string) {
  let mine = localSeen.get(userId);
  if (!mine) {
    mine = { codes: new Set(), level: null };
    localSeen.set(userId, mine);
  }
  return mine;
}

function toLevel(value: Partial<LevelState> | null | undefined): LevelState | null {
  if (!value || !Number(value.level)) return null;
  return { level: Number(value.level), title: String(value.title || ""), prestige: Number(value.prestige || 0) };
}

function normalise(userId: string, data: ServerState | null | undefined): CeremonyState | null {
  if (!data || !Array.isArray(data.unseen)) return null;
  const mine = local(userId);
  const serverLevel = toLevel(data.level);
  const level = mine.level && (!serverLevel || isLevelGain(serverLevel, mine.level)) ? mine.level : serverLevel;
  return {
    unseen: (data.unseen as unknown[]).map(String).filter((code) => !mine.codes.has(code)),
    level,
    recountSeen: Array.isArray(data.recount_seen) ? data.recount_seen.map(String) : [],
  };
}

function notSupported(error: unknown): boolean {
  const status = Number((error as { response?: { status?: number } } | null)?.response?.status);
  return status === 404 || status === 405;
}

/** Länger wartet die Bühne nicht auf den Server - danach gilt das bisherige Verhalten (die Zeremonie kommt). */
export const STATE_TIMEOUT_MS = 4500;

/**
 * Der Stand am Server - oder null (älterer Server, keine Verbindung, keine Antwort binnen STATE_TIMEOUT_MS): dann gilt
 * das bisherige Verhalten im Gerät.
 */
export function ceremonyState(userId: string | null | undefined): Promise<CeremonyState | null> {
  if (!userId || unsupported.has(userId)) return Promise.resolve(null);
  const running = inflight.get(userId);
  if (running) return running;
  const work = (async () => {
    try {
      // Erst lesen: Ein älterer Server kennt den Weg nicht - dann wird auch nichts gemeldet.
      const response = await api.get<ServerState>("/achievements/me/ceremony");
      // Offline liefert der Zwischenspeicher einen alten Stand - der wäre hier falsch (schon Gesehenes käme wieder).
      if (responseFromCache(response)) return null;
      const { data } = response;
      const state = normalise(userId, data);
      // Einmal je Gerät und Konto den Altbestand melden - erst damit legt der Server den Stand an. Kennt der Server keinen
      // Beginn (Zeile fehlt, etwa nach einer Rücksicherung), meldet die App neu, auch mit Merker.
      if (!state || ((await read(importedKey(userId))) && data?.since)) return state;
      const { data: imported } = await api.post<ServerState>("/achievements/me/ceremony/import", await legacyReport(userId));
      await SecureStore.setItemAsync(importedKey(userId), new Date().toISOString()).catch(() => {});
      return normalise(userId, imported);
    } catch (error) {
      if (notSupported(error)) unsupported.add(userId);
      return null;
    }
  })();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), STATE_TIMEOUT_MS); });
  const request: Promise<CeremonyState | null> = Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
    if (inflight.get(userId) === request) inflight.delete(userId);
  });
  inflight.set(userId, request);
  return request;
}

/** Gesehen - gleich an den Server; scheitert das, zeigt der nächste Abruf die Zeremonie höchstens noch einmal. */
export function markSeen(userId: string | null | undefined, { codes = [], level = null }: { codes?: string[]; level?: LevelState | null } = {}): void {
  if (!userId) return;
  const mine = local(userId);
  codes.forEach((code) => mine.codes.add(code));
  if (level && (!mine.level || isLevelGain(mine.level, level))) mine.level = level;
  if (unsupported.has(userId)) return;
  const body: { codes?: string[]; level?: LevelState } = {};
  if (codes.length) body.codes = codes.slice(0, 200);
  if (level) body.level = { level: Number(level.level), title: String(level.title || ""), prestige: Number(level.prestige || 0) };
  if (!Object.keys(body).length) return;
  api.post("/achievements/me/ceremony/seen", body).catch(() => {});
}

/** Die Prüfung vor dem Anzeigen: was andere Geräte schon gesehen haben, fällt weg; ohne Server-Stand bleibt alles. */
export function serverCheck(userId: string) {
  return async (entry: CheckEntry): Promise<{ tiers: CeremonyTier[]; levelUp: LevelUp | null } | null> => {
    const state = await ceremonyState(userId);
    if (!state) return null;
    const unseen = new Set(state.unseen);
    const tiers = (entry.tiers || []).filter((tier) => unseen.has(String(tier.code)));
    const levelUp = entry.levelUp && (!state.level || isLevelGain(state.level, entry.levelUp)) ? entry.levelUp : null;
    return { tiers, levelUp };
  };
}

/** Nur für Tests: alles Gemerkte vergessen. */
export function resetCeremonySeen(): void {
  inflight.clear();
  unsupported.clear();
  localSeen.clear();
}
