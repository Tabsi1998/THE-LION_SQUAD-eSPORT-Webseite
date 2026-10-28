// Gestaltung der Liga (#2107): Akzentfarbe, Fokuspunkt des Banners und Gewinne. Der Server prüft dieselben Regeln
// noch einmal (backend/services/league_look.py); hier steht, was die Oberfläche vorab zeigen muss.

// Der dunkle Seitengrund - die Akzentfarbe muss darauf als Text lesbar sein (WCAG AA, 4,5 : 1).
export const PAGE_BACKGROUND = "#0A0A0A";
export const MIN_CONTRAST = 4.5;
const HEX = /^#?([0-9a-f]{6})$/i;

function channels(color) {
  const match = HEX.exec(String(color || "").trim());
  if (!match) return null;
  const text = match[1];
  return [0, 2, 4].map((index) => parseInt(text.slice(index, index + 2), 16));
}

function luminance(color) {
  const rgb = channels(color);
  if (!rgb) return 0;
  const [red, green, blue] = rgb.map((value) => {
    const part = value / 255;
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** Kontrast zweier Farben nach WCAG (1 bis 21). */
export function contrastRatio(first, second) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Leer, wenn die Farbe passt (oder keine gesetzt ist - dann gilt die Vereinsfarbe); sonst der Satz dazu. */
export function accentProblem(color) {
  const text = String(color || "").trim();
  if (!text) return "";
  if (!channels(text)) return "Bitte einen Farbwert wie #29B6E8 angeben.";
  const ratio = contrastRatio(text, PAGE_BACKGROUND);
  if (ratio >= MIN_CONTRAST) return "";
  return `Auf dem dunklen Grund zu schwach (Kontrast ${ratio.toFixed(1).replace(".", ",")} : 1, nötig 4,5 : 1) – bitte heller wählen.`;
}

/** Die Akzentfarbe als CSS-Variablen für den Kopf der Liga; ohne Farbe ``{}`` - dann greift die Vereinsfarbe. */
export function accentStyle(color) {
  const rgb = channels(color);
  if (!rgb) return {};
  // Schrift auf einer Fläche in der Akzentfarbe (Abzeichen): die besser lesbare von Weiß und Seitengrund.
  const onAccent = contrastRatio(color, "#FFFFFF") >= contrastRatio(color, PAGE_BACKGROUND) ? "#FFFFFF" : PAGE_BACKGROUND;
  return { "--league-accent-rgb": rgb.join(" "), "--league-on-accent": onAccent };
}

const percent = (value) => (Number.isFinite(Number(value)) ? Math.min(100, Math.max(0, Math.round(Number(value)))) : 50);

/** Fokuspunkte des Banners: breiter Zuschnitt (Desktop) und höherer (Handy). */
export function bannerFocus(banner) {
  return {
    "--league-focus-desktop": `${percent(banner?.x)}% ${percent(banner?.y)}%`,
    "--league-focus-mobile": `${percent(banner?.mobile_x)}% ${percent(banner?.mobile_y)}%`,
  };
}

export const DEFAULT_FOCUS = { x: 50, y: 50, mobile_x: 50, mobile_y: 50 };

/** Gewinne als Formular - Platz als Text, Bild leer statt null. */
export function prizesToForm(prizes) {
  return (prizes || []).map((row) => ({ place: String(row.place ?? ""), text: row.text || "", image_url: row.image_url || "" }));
}

/** Gewinne als Anfrage: nur Zeilen mit Platz und Text; keine heißt ``null`` (bei Liga N: wie die Season). */
export function prizesPayload(rows) {
  const out = (rows || [])
    .filter((row) => String(row.text || "").trim() && Number(row.place) >= 1)
    .map((row) => ({ place: Math.round(Number(row.place)), text: String(row.text).trim(), image_url: row.image_url || null }));
  return out.length ? out : null;
}

export function placeLabel(place) {
  return `${place}. Platz`;
}

/** Gold, Silber, Bronze für die ersten drei Plätze - danach ruhig. */
export function placeTone(place) {
  return { 1: "gold", 2: "silver", 3: "bronze" }[Number(place)] || "plain";
}
