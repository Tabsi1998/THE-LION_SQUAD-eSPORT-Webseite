import type { TournamentOffer, TournamentPrice } from "../types";
import { formatCents, quoteTotal } from "./startFee";

// Kosten am Event (#396): dieselbe Vorschau wie im Web (frontend/src/lib/pricing.js) - was gilt,
// sagt der Server beim Anmelden. „je Person“ zählt die anmeldende Person plus Begleitpersonen.

export { formatCents, quoteTotal };

export function eventBasisLabel(basis?: string): string {
  return basis === "per_person" ? "je Person" : "je Anmeldung";
}

/** „20,00 € je Person · mit 1 Begleitperson 40,00 €“ - der Satz an der Anmeldung. */
export function eventOfferSummary(offer: TournamentOffer | null | undefined, seats = 1): string {
  if (!offer?.enabled) return "";
  const currency = offer.currency || "EUR";
  const perPerson = offer.positions.some((position) => !position.optional && position.basis === "per_person");
  const parts = [`${formatCents(quoteTotal(offer, 1), currency)} ${perPerson ? "je Person" : "je Anmeldung"}`];
  const companions = Math.max(0, Number(seats) - 1);
  if (companions > 0) parts.push(`mit ${companions} Begleitperson${companions === 1 ? "" : "en"} ${formatCents(quoteTotal(offer, seats), currency)}`);
  return parts.join(" · ");
}

/** Der Satz zur eigenen Anmeldung: eingefrorener Betrag und wo die Rechnung liegt. */
export function ownEventPriceLine(price: TournamentPrice | null | undefined): string {
  if (!price) return "";
  const amount = formatCents(price.total_cents, price.currency || "EUR");
  if (price.billing_status === "cancelled") return `Dein Kostenbeitrag: ${amount} · storniert`;
  if (price.billing_status === "paid") return `Dein Kostenbeitrag: ${amount} · Rechnung ${price.invoice_ref || ""} bezahlt – danke!`.replace("  ", " ");
  if (price.invoice_ref && price.invoice_status !== "draft") return `Dein Kostenbeitrag: ${amount} · Rechnung ${price.invoice_ref} offen – unter „Meine Rechnungen“`;
  return `Dein Kostenbeitrag: ${amount} · die Rechnung kommt in dein Konto unter „Meine Rechnungen“`;
}

/** Was eine Änderung der Begleitpersonen jetzt bedeutet - vor dem Beleg rechnet der Server neu. */
export function companionChangeHint(price: TournamentPrice | null | undefined): string {
  if (!price || price.billing_status === "cancelled") return "";
  if (price.billing_status === "invoiced" || price.billing_status === "paid") {
    return "Der Beleg besteht schon – Begleitpersonen ändert für dich die Verwaltung, sie meldet die Differenz an Finanzen.";
  }
  return "Begleitpersonen ändern: abmelden und neu anmelden – der Betrag wird dann neu gerechnet.";
}
