// Sticker im Chat.
//
// Der Katalog kommt vom Server (/api/stickers): zuerst die eigenen Pakete des
// Vereins, danach das Startpaket aus Microsoft Fluent Emoji (MIT). Gesendet
// wird nur die Kennung; der Server hängt den Sticker an die Nachricht.

import { resolveMediaUrl } from "@/lib/api";

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss")
    .trim();
}

/** Sticker, deren Name oder Suchwort die Eingabe enthält - über alle Pakete, ohne Doppelte. */
export function searchStickers(packs, query) {
  const needle = normalize(query);
  if (!needle) return [];
  const seen = new Set();
  const hits = [];
  for (const pack of packs || []) {
    for (const sticker of pack?.stickers || []) {
      if (!sticker?.id || seen.has(sticker.id)) continue;
      const words = [sticker.name, ...(sticker.keywords || [])].map(normalize);
      if (words.some((word) => word.includes(needle))) {
        seen.add(sticker.id);
        hits.push(sticker);
      }
    }
  }
  return hits;
}

export function stickerSrc(url) {
  return url ? resolveMediaUrl(url) : "";
}
