import { isLocalPath } from "./siteUrls";

// Original-Bilder des Veranstalters je Termin (#1933) in der App - wie im Web (frontend/src/lib/referenceOriginals.js):
// Beschriftung, Vorschaubilder und welche Bilder zu einem Termin gehören. Der Server prüft, kodiert neu und gibt nur
// öffentliche Bilder heraus (Serienseite `originals` je Termin, Rundenseite `sessions[].originals` je Lauf). Die App
// lädt ein Bild nur von der eigenen öffentlichen Adresse dafür; ein Quellen-Link öffnet sich nur als https. Ein älterer
// Server schickt keine Bilder - dann gibt es keinen Knopf „Original ansehen“.

export type OriginalItem = {
  id?: string | null;
  kind?: string | null;
  map?: number | null;
  source_url?: string | null;
  width?: number | null;
  height?: number | null;
  url?: string | null;
  /** Beschriftung mit Lauf („Sprint · Scoreboard“) - setzt `originalsOf`. */
  label?: string;
};
export type OriginalsByRound = Record<string, OriginalItem[] | null | undefined> | null | undefined;

const LABELS: Record<string, string> = {
  qualifying: "Qualifying",
  sprint: "Sprint",
  race: "Rennen",
  scoreboard: "Scoreboard",
  table: "Tabelle",
  other: "Sonstiges",
};

/** Breiten der Vorschaubilder - dieselben wie im Server (`services/image_variants.py`). */
export const ORIGINAL_WIDTHS = [160, 320, 400, 800, 1600] as const;
export type OriginalWidth = (typeof ORIGINAL_WIDTHS)[number];

// Die öffentliche Adresse eines Bilds: /api/reference-series/public/<spur>/<saison>/originals/<id> - nichts anderes.
const PUBLIC_PATH = /^\/api\/reference-series\/public\/[^/?#\\\s]+\/[^/?#\\\s]+\/originals\/[^/?#\\\s]+$/;

/** „Rennen“, „Scoreboard · Map 2“ … */
export function originalLabel(item: OriginalItem | null | undefined): string {
  const label = LABELS[String(item?.kind)] || "Original";
  return item?.kind === "scoreboard" && item?.map ? `${label} · Map ${item.map}` : label;
}

/** Adresse des Bilds (oder eines Vorschaubilds mit `?w=`) - nur der öffentliche Pfad des eigenen Servers, sonst leer. */
export function originalSrc(url: string | null | undefined, width?: OriginalWidth): string {
  const text = String(url || "").trim();
  if (!PUBLIC_PATH.test(text) || /\/\.{1,2}(\/|$)/.test(text) || !isLocalPath(text)) return "";
  return width ? `${text}?w=${width}` : text;
}

/** Die Breite fürs Vollbild: das Bild selbst, wenn es klein ist, sonst das Vorschaubild mit 1600 Pixeln. */
export function viewerWidth(item: OriginalItem | null | undefined): OriginalWidth | undefined {
  return Number(item?.width) > 1600 ? 1600 : undefined;
}

/** Ein Link nur als vollständige https-Adresse ohne Anmeldedaten, Leerraum oder Steuerzeichen (wie der Server) - sonst leer. */
export function httpsLink(value: string | null | undefined): string {
  const text = String(value || "").trim();
  if (!text || text.length > 500 || /[\s\\]/.test(text) || [...text].some((char) => char.charCodeAt(0) < 32)) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || !url.hostname.includes(".") || url.username || url.password) return "";
    return text;
  } catch {
    return "";
  }
}

/** Quellen-Link eines Bilds - nur https. */
export function sourceLink(item: OriginalItem | null | undefined): string {
  return httpsLink(item?.source_url);
}

/** Nur Bilder mit Kennung und gültiger Adresse - ein unbekanntes Format vom Server fällt still weg. */
export function cleanOriginals(list: unknown): OriginalItem[] {
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is OriginalItem => Boolean(item && typeof item === "object" && (item as OriginalItem).id && originalSrc((item as OriginalItem).url)));
}

/**
 * Die öffentlichen Bilder mehrerer Termine (etwa aller Läufe einer Runde) in einer Liste. `withSession`: vor die Art
 * kommt der Lauf („Sprint · Rennen“ wäre doppelt, darum nur, wenn er etwas sagt).
 */
export function originalsOf(
  originals: OriginalsByRound,
  rounds: Array<{ id?: string | null; session?: string | null } | null | undefined> | null | undefined,
  { withSession = false }: { withSession?: boolean } = {},
): OriginalItem[] {
  const map = originals && typeof originals === "object" && !Array.isArray(originals) ? originals : {};
  const out: OriginalItem[] = [];
  for (const round of rounds || []) {
    if (!round?.id) continue;
    for (const item of cleanOriginals(map[round.id])) {
      const session = String(round.session || "").trim();
      const label = originalLabel(item);
      out.push({ ...item, label: withSession && session && session !== label ? `${session} · ${label}` : label });
    }
  }
  return out;
}

/** Wie der Knopf vorgelesen wird: „Original ansehen“ bzw. „Original ansehen, 3 Bilder“. */
export function originalsButtonLabel(count: number): string {
  return count > 1 ? `Original ansehen, ${count} Bilder` : "Original ansehen";
}
