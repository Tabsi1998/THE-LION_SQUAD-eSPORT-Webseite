// Sponsorenstufen wie auf lionsquad.at/sponsors: Hauptsponsor volle Breite,
// Platin und Gold zu zweit, Silber zu dritt, Bronze zu viert (#244). Farben
// und Namen sind dieselben wie im Web (frontend/src/pages/public/SponsorsPage.jsx).

export type SponsorTierKey = "main" | "platinum" | "gold" | "silver" | "bronze";

export type SponsorTier = { key: SponsorTierKey; label: string; color: string; perRow: number; logoHeight: number };

export const SPONSOR_TIERS: SponsorTier[] = [
  { key: "main", label: "Hauptsponsor", color: "#29B6E8", perRow: 1, logoHeight: 96 },
  { key: "platinum", label: "Platin", color: "#E5E4E2", perRow: 2, logoHeight: 72 },
  { key: "gold", label: "Gold", color: "#FFD700", perRow: 2, logoHeight: 72 },
  { key: "silver", label: "Silber", color: "#C0C0C0", perRow: 3, logoHeight: 56 },
  { key: "bronze", label: "Bronze", color: "#CD7F32", perRow: 4, logoHeight: 44 },
];

export function normalizeSponsorTier(value?: string | null): SponsorTierKey {
  const key = String(value || "").toLowerCase();
  return SPONSOR_TIERS.some((tier) => tier.key === key) ? (key as SponsorTierKey) : "bronze";
}

export function groupSponsorsByTier<T extends { tier?: string | null }>(items: T[]) {
  return SPONSOR_TIERS
    .map((tier) => ({ tier, items: items.filter((item) => normalizeSponsorTier(item.tier) === tier.key) }))
    .filter((group) => group.items.length > 0);
}
