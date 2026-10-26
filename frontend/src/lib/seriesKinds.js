// Art-Profil (#2024): Felder und Begriffe je Spur-Art kommen vom Server (backend/services/series_kinds.py) - mit der
// Übersicht der Verwaltung (`kind_profiles`), der Saison (`profile`), dem Eintragen (`series.profile`), der Serienseite
// und „Läuft gerade“. Hier wird nur nachgeschlagen. Fehlt das Profil (ältere Antwort), gibt jede Stelle ihren
// bisherigen Wert als Rückfall mit - so bleibt alles wie vorher.

/** Ein Begriff aus dem Profil (`vocab`), sonst der Rückfall. */
export function kindWord(profile, key, fallback = "") {
  const value = profile?.vocab?.[key];
  return typeof value === "string" && value ? value : fallback;
}

/** Führt die Art dieses Feld (`fields`)? Ohne Profil der Rückfall (Vorgabe: ja, wie bisher). */
export function kindShows(profile, key, fallback = true) {
  const value = profile?.fields?.[key];
  return value === undefined || value === null ? fallback : Boolean(value);
}

/** Eine Liste aus den Feldern (etwa `marks`), sonst der Rückfall. */
export function kindList(profile, key, fallback) {
  const value = profile?.fields?.[key];
  return Array.isArray(value) ? value : fallback;
}

/** Das Profil einer Art aus `kind_profiles` der Übersicht. */
export function profileOf(profiles, kind) {
  return (profiles && kind && profiles[kind]) || null;
}

// Für alle Arten gleich (#2024): ohne kommenden Termin „Noch kein Termin“, ein Termin ohne Datum öffentlich „Termin
// folgt“ - „Termin offen“ hieß beides und war darum missverständlich.
export const NO_ROUND = "Noch kein Termin";
export const OPEN_ROUND = "Termin folgt";
