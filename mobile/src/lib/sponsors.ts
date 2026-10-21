// Sponsorenstufen wie auf lionsquad.at/sponsors: Hauptsponsor volle Breite,
// Platin und Gold zu zweit, Silber zu dritt, Bronze zu viert (#244). Farben
// und Namen sind dieselben wie im Web (frontend/src/pages/public/SponsorsPage.jsx).

export type SponsorTierKey = "main" | "platinum" | "gold" | "silver" | "bronze";

// bannerHeight (#880): Banner aus dem Vereinsmodul oben in der Kachel - mit Banner rückt das Logo kleiner darunter.
export type SponsorTier = { key: SponsorTierKey; label: string; color: string; perRow: number; logoHeight: number; bannerHeight: number };

export const SPONSOR_TIERS: SponsorTier[] = [
  { key: "main", label: "Hauptsponsor", color: "#29B6E8", perRow: 1, logoHeight: 96, bannerHeight: 120 },
  { key: "platinum", label: "Platin", color: "#E5E4E2", perRow: 2, logoHeight: 72, bannerHeight: 72 },
  { key: "gold", label: "Gold", color: "#FFD700", perRow: 2, logoHeight: 72, bannerHeight: 72 },
  { key: "silver", label: "Silber", color: "#C0C0C0", perRow: 3, logoHeight: 56, bannerHeight: 52 },
  { key: "bronze", label: "Bronze", color: "#CD7F32", perRow: 4, logoHeight: 44, bannerHeight: 40 },
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

/** Logo-Daten für die einfarbige Anzeige (#1916, App-Teil von #1321) - vom Server an Sponsoren und Partnern. */
export type ToneLogo = { logo_url?: string | null; logo_mono_url?: string | null; logo_transparent?: boolean | null };

/**
 * Wie ein Sponsoren- oder Partner-Logo weiß wird - dieselbe Regel wie im Web (SponsorLogo.jsx): "file" (hochgeladene
 * weiße Fassung), "tint" (durchsichtiges Logo, weiß eingefärbt) oder "surface" (Logo mit Kasten oder unbekannt: das
 * Original auf einer ruhigen Fläche, nie ein weißes Rechteck). Am Handy gibt es kein Drüberfahren - es bleibt weiß.
 */
export function logoToneMode(logo: ToneLogo | null | undefined): "file" | "tint" | "surface" {
  if (logo?.logo_mono_url) return "file";
  if (logo?.logo_transparent === true) return "tint";
  return "surface";
}
