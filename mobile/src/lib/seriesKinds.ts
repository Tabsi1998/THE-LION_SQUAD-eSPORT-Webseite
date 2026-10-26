// Art-Profil in der App (#2024), wie im Web (frontend/src/lib/seriesKinds.js): Felder und Begriffe je Spur-Art kommen
// vom Server (backend/services/series_kinds.py) - mit der Serienseite (`profile`) und „Läuft gerade“ (`profile` je
// Saison). Hier wird nur nachgeschlagen. Fehlt das Profil (älterer Server), gibt jede Stelle ihren bisherigen Wert als
// Rückfall mit - so bleibt alles wie vorher.

export type KindProfile = {
  kind?: string | null;
  label?: string | null;
  fields?: Record<string, unknown> | null;
  vocab?: Record<string, string | null | undefined> | null;
} | null | undefined;

/** Ein Begriff aus dem Profil (`vocab`), sonst der Rückfall. */
export function kindWord(profile: KindProfile, key: string, fallback = ""): string {
  const value = profile?.vocab?.[key];
  return typeof value === "string" && value ? value : fallback;
}

/** Führt die Art dieses Feld (`fields`)? Ohne Profil der Rückfall (Vorgabe: ja, wie bisher). */
export function kindShows(profile: KindProfile, key: string, fallback = true): boolean {
  const value = profile?.fields?.[key];
  return value === undefined || value === null ? fallback : Boolean(value);
}

// Für alle Arten gleich (#2024): ohne kommenden Termin „Noch kein Termin“, ein Termin ohne Datum „Termin folgt“ -
// „Termin offen“ hieß beides und war darum missverständlich.
export const NO_ROUND = "Noch kein Termin";
export const OPEN_ROUND = "Termin folgt";
