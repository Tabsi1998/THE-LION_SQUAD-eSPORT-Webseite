import { resolveMediaUrl } from "./api";

// Markenbilder und Vereinsname aus den Einstellungen (#229). Die App ist dunkel, also zählt wie
// im Web (Logo.jsx) zuerst die Fassung für dunklen Hintergrund. Ohne Einstellungen - offline,
// vor dem ersten Laden - bleiben die eingebauten Bilder; das sagt `loaded`.

export const DEFAULT_CLUB_NAME = "THE LION SQUAD";

export type PublicBranding = {
  club_name?: string | null;
  logo_url?: string | null;
  logo_dark_url?: string | null;
  logo_light_url?: string | null;
  mascot_url?: string | null;
};

export type Branding = {
  clubName: string;
  logoUrl: string;
  mascotUrl: string;
  loaded: boolean;
};

export const DEFAULT_BRANDING: Branding = { clubName: DEFAULT_CLUB_NAME, logoUrl: "", mascotUrl: "", loaded: false };

export function brandingFromSettings(data: PublicBranding | null | undefined): Branding {
  const name = String(data?.club_name || "").trim();
  return {
    clubName: name || DEFAULT_CLUB_NAME,
    logoUrl: resolveMediaUrl(data?.logo_dark_url || data?.logo_url || ""),
    mascotUrl: resolveMediaUrl(data?.mascot_url || data?.logo_dark_url || data?.logo_url || ""),
    loaded: true,
  };
}
