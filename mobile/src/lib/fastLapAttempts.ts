// Versuche in der App (#1585): dieselbe eingestellte Zahl wie Website und TV (`max_attempts` der Tabelle, null =
// unbegrenzt). Gäste ohne Konto haben in der Tabelle `participant_id` = „guest-…“ und keine `user_id`.

export function attemptsText(count: number | null | undefined, max: number | null | undefined): string {
  const done = Math.max(0, Number(count) || 0);
  const limit = Number(max);
  if (Number.isFinite(limit) && limit > 0) return `${done} von ${limit} Versuchen`;
  return done === 1 ? "1 Versuch" : `${done} Versuche`;
}

export function entryKey(entry: { participant_id?: string | null; user_id?: string | null }): string {
  return entry.participant_id || entry.user_id || "";
}

type KeyedEntry = { participant_id?: string | null; user_id?: string | null; display_name?: string | null; username?: string | null };

/**
 * Schlüssel je Zeile der Bestenliste (#1969): stabil über die Person, nicht über den Rang - rutscht beim Nachladen eine
 * neue Zeit nach oben, bleiben die Zeilen darunter dieselben und zählen nicht neu hoch. Eindeutig auch, wenn eine
 * Person doppelt vorkommt (zweite Zeile „~2“) oder keine Kennung hat (Name).
 */
export function entryRowKeys(entries: KeyedEntry[]): string[] {
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    const base = entryKey(entry) || `name:${entry.display_name || entry.username || "fahrer"}`;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}~${count}`;
  });
}
