import { API_BASE_URL } from "../config";
import type { ChatSticker } from "../types";

// Sticker im Chat, auf Seite der App. Der Katalog kommt vom Server: zuerst die
// eigenen Pakete des Vereins, danach das Startpaket (Microsoft Fluent Emoji,
// MIT). Die Bilder sind öffentlich wie jedes Emoji - anders als Chat-Anhänge
// brauchen sie keine Anmeldung.

export type CatalogSticker = ChatSticker & { keywords?: string[] };

export type StickerPack = {
  id: string;
  name: string;
  builtin?: boolean;
  stickers: CatalogSticker[];
};

function normalize(value?: string | null) {
  return String(value || "")
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss")
    .trim();
}

/** Sticker, deren Name oder Suchwort die Eingabe enthält - über alle Pakete, ohne Doppelte. */
export function searchStickers(packs: StickerPack[] | null | undefined, query: string): CatalogSticker[] {
  const needle = normalize(query);
  if (!needle) return [];
  const seen = new Set<string>();
  const hits: CatalogSticker[] = [];
  for (const pack of packs ?? []) {
    for (const sticker of pack.stickers ?? []) {
      if (!sticker?.id || seen.has(sticker.id)) continue;
      const words = [sticker.name, ...(sticker.keywords ?? [])].map(normalize);
      if (words.some((word) => word.includes(needle))) {
        seen.add(sticker.id);
        hits.push(sticker);
      }
    }
  }
  return hits;
}

export function stickerSource(url?: string | null) {
  if (!url) return null;
  return { uri: url.startsWith("/") ? `${API_BASE_URL}${url}` : url };
}
