// Jahreszeiten in der TV-Kopfleiste (#1114): je laufender Jahreszeit eine leise Deko - wenige Teilchen, langsam,
// nur hinter Logo und Titel, nie über Namen, Zahlen oder dem Baum. Dieselbe Quelle wie die Website
// (/api/seasonal/active über den SeasonProvider). Keine Klick-Figuren und kein Ton am TV; nur Website (die App hat
// keine TV-Seiten). Wetter, Adventkalender und Eiersuche bringen keine Kopfleisten-Deko: das Wetter läuft das ganze
// Jahr, die anderen beiden sind zum Mitmachen da.
import { hashString, mulberry32 } from "@/seasons/rng";

export const TV_DECO_BY_SEASON = Object.freeze({
  new_year: "sparks",
  christmas: "stars",
  club_birthday: "confetti",
  carnival: "confetti",
  easter: "petals",
  halloween: "bats",
  nikolaus: "snow",
  snow: "snow",
  advent: "candles",
});

// Laufen mehrere, gewinnt der besondere Tag vor der langen Zeit - immer nur eine Deko gleichzeitig.
export const TV_DECO_ORDER = Object.freeze(["new_year", "christmas", "club_birthday", "carnival", "easter", "halloween", "nikolaus", "snow", "advent"]);

export const TV_DECO_LABELS = Object.freeze({
  sparks: "Funken",
  stars: "Sterne",
  confetti: "Konfetti",
  petals: "Blüten",
  bats: "Fledermäuse",
  snow: "Schnee",
  candles: "Kerzenlicht",
});

/** Welche Deko gerade in die Kopfleiste gehört - oder null. „dezent“ (auch durch „Bewegung reduzieren“) halbiert. */
export function tvDecoFor(seasons) {
  const running = (seasons || []).filter((season) => season?.key && season.effective !== "off");
  for (const key of TV_DECO_ORDER) {
    const season = running.find((entry) => entry.key === key);
    if (season) return { kind: TV_DECO_BY_SEASON[key], season: key, subtle: season.effective === "subtle" };
  }
  return null;
}

const COUNTS = { sparks: 12, stars: 10, confetti: 14, petals: 10, bats: 6, snow: 16, candles: 8 };

/**
 * Die Teilchen einer Deko: Lage in Prozent der Kopfleiste, Größe in Einheiten, Dauer und Versatz in Sekunden.
 * Feste Saat je Deko - jeder TV zeigt dasselbe ruhige Bild, auch nach dem Neuladen.
 */
export function decoParticles(kind, { subtle = false } = {}) {
  const total = COUNTS[kind] || 0;
  const count = subtle ? Math.ceil(total / 2) : total;
  const random = mulberry32(hashString(`tv-deco-${kind}`));
  return Array.from({ length: count }, (_, index) => ({
    id: `${kind}-${index}`,
    // Über die ganze Breite verteilt, mit etwas Zufall je Fach - keine Klumpen.
    left: Math.round(((index + 0.15 + random() * 0.7) / count) * 1000) / 10,
    top: Math.round(random() * 1000) / 10,
    size: Math.round((0.7 + random() * 0.9) * 100) / 100,
    duration: Math.round(14 + random() * 12),
    delay: -Math.round(random() * 20),
    drift: Math.round((random() * 2 - 1) * 100) / 100,
    turn: Math.round(random() * 360),
  }));
}
