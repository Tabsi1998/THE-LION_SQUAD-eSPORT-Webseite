// Farben an einer Stelle (#1151, #1305): jede Farbe hat genau eine Aufgabe. Die Rollen stehen auch als CSS-Variablen in
// styles/system.css (und als Tailwind-Farben: text-ok, bg-live/15 …), die App hat dieselben Werte in mobile/src/theme.ts
// (`roles`, `kindColors`, `kindColorsDark`). lib/categoryColors.test.js hält alle Stellen gleich.

/** Die Farb-Rollen: Cyan Marke und „du“, Rot nur „läuft gerade“, Orange Achtung, Grün offen und frei, Gold Ehre. */
export const ROLE_COLORS = {
  brand: "#29B6E8",
  live: "#FF3B30",
  warn: "#FF9F43",
  ok: "#1FD08E",
  honor: "#FFD700",
  event: "#9F7AEA",
  // Nebentext (#1232) und „vorbei oder ruhig“.
  muted: "#B4B4BD",
  quiet: "#8E8E99",
  // Nur für Platz 2 und 3.
  silver: "#C9CED6",
  bronze: "#D08A4E",
};

/** Flächen: Schwarz als Grund, darauf drei Stufen. */
export const SURFACE_COLORS = { base: "#0A0A0A", 1: "#121214", 2: "#18181C", 3: "#1F1F24" };

/**
 * Farben je Art: Event Violett, Turnier Cyan, Fast Lap Türkis, Verein Gold - Kalender, Karten und Etiketten. „club“
 * (#1190) sind Versammlungen und eigene Helferschichten im Kalender, nur für Mitglieder.
 */
export const KIND_COLORS = { event: ROLE_COLORS.event, tournament: ROLE_COLORS.brand, fastlap: "#2DD4BF", club: ROLE_COLORS.honor };

/**
 * Dunkle Fassungen je Art für Flächen mit weißer Schrift (Kopf der Datums-Kachel, #1318): etwas dunkler als im Muster,
 * damit Weiß darauf mindestens 4,5 : 1 erreicht.
 */
export const KIND_COLORS_DARK = { event: "#7655CC", tournament: "#1A7AA3", fastlap: "#0E7F73", club: "#85690A" };

/** News-Kategorien: Turniere Cyan, Events Violett, Verein und Mitglieder Gold - alle anderen Grau, Rot fällt weg. */
export const NEWS_CATEGORY_COLORS = { tournaments: KIND_COLORS.tournament, events: KIND_COLORS.event, club: KIND_COLORS.club, members: ROLE_COLORS.honor };

export function newsCategoryColor(category) {
  return NEWS_CATEGORY_COLORS[category] || ROLE_COLORS.quiet;
}

/** Dunkle Fassung je News-Kategorie (#1343) - die Fläche der Text-Karte mit weißer Schrift, Grau ohne eigene Farbe. */
export const NEWS_CATEGORY_COLORS_DARK = { tournaments: KIND_COLORS_DARK.tournament, events: KIND_COLORS_DARK.event, club: KIND_COLORS_DARK.club, members: KIND_COLORS_DARK.club };
export const NEWS_CATEGORY_DARK_FALLBACK = "#3A3A44";

export function newsCategoryColorDark(category) {
  return NEWS_CATEGORY_COLORS_DARK[category] || NEWS_CATEGORY_DARK_FALLBACK;
}

// ---------------------------------------------------------------- Kontrast (WCAG 2.1)
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Kontrastverhältnis zweier Farben („#RRGGBB“), 1 bis 21. Text braucht mindestens 4,5. */
export function contrastRatio(foreground, background) {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}
