import { formatDate } from "@/lib/dolibarr";

// Digitale Mitgliedskarte (#346), Web-Seite. Der Prüfcode gilt fünf Minuten; die Karte holt
// eine Minute vorher einen neuen - ein Foto oder Screenshot des Codes ist damit wertlos.

export const REFRESH_MARGIN_MS = 60 * 1000;
export const MIN_REFRESH_MS = 15 * 1000;

export function refreshDelayMs(card, now = Date.now()) {
  if (!card || card.status !== "valid") return null;
  const expires = new Date(card.token_expires_at).getTime();
  if (Number.isNaN(expires)) return MIN_REFRESH_MS;
  return Math.max(MIN_REFRESH_MS, expires - REFRESH_MARGIN_MS - now);
}

export function validUntilLine(card) {
  if (!card || card.status !== "valid") return "";
  return card.valid_until ? `Gültig bis ${formatDate(card.valid_until)}` : "Gültig, solange die Mitgliedschaft besteht";
}

/** Was die Prüfseite sagt - gültig oder nicht, ohne zu verraten, warum nicht. */
export function verdictText(result) {
  if (!result) return { title: "Wird geprüft …", tone: "muted" };
  if (result.valid) return { title: "Gültige Mitgliedskarte", tone: "ok" };
  return { title: "Nicht gültig", tone: "warn" };
}
