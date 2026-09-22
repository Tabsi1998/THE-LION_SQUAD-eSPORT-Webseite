// Digitale Mitgliedskarte (#346), App-Seite. Der Server gibt Karte und Prüfcode; der Code gilt
// fünf Minuten, die App holt rechtzeitig vorher einen neuen - ein Foto des Codes ist damit wertlos.

export type MemberCard =
  | { status: "none" | "ended"; club_name: string }
  | {
      status: "valid";
      club_name: string;
      name: string;
      member_number?: string | null;
      type_label: string;
      member_since?: string | null;
      valid_until?: string | null;
      verify_url: string;
      token_expires_at: string;
      accent_color?: string | null;
    };

/** Eine Minute vor Ablauf erneuern - nie erst danach, sonst zeigt die Karte kurz einen toten Code. */
export const REFRESH_MARGIN_MS = 60 * 1000;
export const MIN_REFRESH_MS = 15 * 1000;

export function refreshDelayMs(card: MemberCard | null, now: number = Date.now()): number | null {
  if (!card || card.status !== "valid") return null;
  const expires = new Date(card.token_expires_at).getTime();
  if (Number.isNaN(expires)) return MIN_REFRESH_MS;
  return Math.max(MIN_REFRESH_MS, expires - REFRESH_MARGIN_MS - now);
}

export function cardExpired(card: MemberCard | null, now: number = Date.now()): boolean {
  if (!card || card.status !== "valid") return false;
  const expires = new Date(card.token_expires_at).getTime();
  return !Number.isNaN(expires) && expires <= now;
}

export function validUntilLine(card: MemberCard): string {
  if (card.status !== "valid") return "";
  if (!card.valid_until) return "Gültig, solange die Mitgliedschaft besteht";
  const date = new Date(card.valid_until.length === 10 ? `${card.valid_until}T00:00:00` : card.valid_until);
  return Number.isNaN(date.getTime()) ? `Gültig bis ${card.valid_until}` : `Gültig bis ${date.toLocaleDateString("de-DE")}`;
}
