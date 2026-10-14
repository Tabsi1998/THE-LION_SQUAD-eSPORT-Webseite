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
