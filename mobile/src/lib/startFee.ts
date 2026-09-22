import type { TournamentOffer, TournamentPrice } from "../types";

// Startgeld (#319): dieselbe Vorschau wie im Web - was gilt, sagt der Server beim Anmelden.
// Beträge sind ganze Cent; „je Person“ ist ein Spieler des Rosters, Solo eine Person.

export function formatCents(cents?: number | null, currency = "EUR"): string {
  const value = Number(cents || 0);
  const euros = Math.trunc(value / 100);
  const rest = Math.abs(value % 100);
  return `${euros},${String(rest).padStart(2, "0")} ${currency === "EUR" ? "€" : currency}`;
}

export function quoteTotal(offer: TournamentOffer | null | undefined, seats = 1, selected: string[] = []): number {
  if (!offer?.enabled || !offer.positions?.length) return 0;
  const chosen = new Set(selected);
  return offer.positions
    .filter((position) => !position.optional || chosen.has(position.key))
    .reduce((sum, position) => sum + Number(position.amount_cents || 0) * (position.basis === "per_person" ? Math.max(1, seats) : 1), 0);
}

export function basisLabel(basis?: string): string {
  if (basis === "per_person") return "je Spieler";
  if (basis === "per_team") return "je Team";
  return "je Anmeldung";
}

/** „10,00 € Startgeld“ (Solo) oder „10,00 € je Spieler · Team mit 5 Spielern 50,00 €“. */
export function startFeeSummary(offer: TournamentOffer | null | undefined, teamMode = "solo", teamSize = 1): string {
  if (!offer?.enabled) return "";
  const currency = offer.currency || "EUR";
  const single = formatCents(quoteTotal(offer, 1), currency);
  if (teamMode === "solo") return `${single} Startgeld`;
  const perPlayer = offer.positions.some((position) => !position.optional && position.basis === "per_person");
  const seats = Math.max(1, Number(teamSize) || 1);
  const parts = [`${single} ${perPlayer ? "je Spieler" : "je Team"}`];
  if (perPlayer && seats > 1) parts.push(`Team mit ${seats} Spielern ${formatCents(quoteTotal(offer, seats), currency)}`);
  return parts.join(" · ");
}

/** Der Satz zur eigenen Anmeldung: eingefrorener Betrag und wo die Rechnung liegt. */
export function ownPriceLine(price: TournamentPrice | null | undefined): string {
  if (!price) return "";
  const amount = formatCents(price.total_cents, price.currency || "EUR");
  if (price.billing_status === "cancelled") return `Dein Startgeld: ${amount} · storniert`;
  if (price.billing_status === "paid") return `Dein Startgeld: ${amount} · Rechnung ${price.invoice_ref || ""} bezahlt – danke!`.replace("  ", " ");
  if (price.invoice_ref && price.invoice_status !== "draft") return `Dein Startgeld: ${amount} · Rechnung ${price.invoice_ref} offen – unter „Meine Mitgliedschaft“`;
  return `Dein Startgeld: ${amount} · die Rechnung kommt in dein Konto`;
}
