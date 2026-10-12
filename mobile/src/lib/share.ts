import { Share } from "react-native";
import { formatWhen } from "./format";
import { WEB_BASE_URL } from "./siteUrls";
import { dayNoon, viennaDate, viennaDay } from "./vienna";

// Teilen (#1154): Event, Turnier, Fast Lap, News, Team und Album teilen die Adresse der Website - wer die App hat,
// landet im richtigen Screen (rootNavigation.targetFromUrl), alle anderen auf der Website. Dazu ein kurzer Satz wie
// „Herbst-LAN 2026 · 14.–16. November · THE LION SQUAD“ - dieselbe Rechnung wie im Web (frontend/src/lib/sharePage.js).
// Interne Events und Mitglieder-Alben lassen sich teilen, öffnen sich aber nur für Mitglieder (das prüft der Server).

export type ShareKind = "event" | "tournament" | "fastlap" | "news" | "team" | "album";
export const CLUB_NAME = "THE LION SQUAD";

/** Der Pfad je Seitenart auf der Website - dieselben Adressen, die die App wieder öffnet. */
export const SHARE_PATHS: Record<ShareKind, string> = { event: "events", tournament: "tournaments", fastlap: "fastlap", news: "news", team: "teams", album: "galerie" };

export function shareUrl(kind: ShareKind, idOrSlug: string): string {
  return `${WEB_BASE_URL}/${SHARE_PATHS[kind]}/${encodeURIComponent(idOrSlug)}`;
}

/**
 * Das Datum im Satz: ein Tag mit Uhrzeit wie überall („Sa 23. Mai · 18:00“), mehrere Tage als Spanne („14.–16. November“,
 * über den Monat „30. Oktober – 2. November“); das Jahr nur, wenn es nicht das laufende ist. Wiener Tage.
 */
export function shareDateLabel(start?: string | null, end?: string | null, now: Date = new Date()): string {
  if (!start) return "";
  const first = viennaDay(start);
  const last = end ? viennaDay(end) : first;
  if (!first) return "";
  if (!last || last <= first) return formatWhen(start, { now });
  const [startYear, startMonth, startDate] = first.split("-").map(Number);
  const [endYear, endMonth, endDate] = last.split("-").map(Number);
  const month = (day: string) => viennaDate(dayNoon(day), { month: "long" });
  const thisYear = viennaDay(now).slice(0, 4);
  const year = String(endYear) === thisYear ? "" : ` ${endYear}`;
  if (startYear === endYear && startMonth === endMonth) return `${startDate}.–${endDate}. ${month(last)}${year}`;
  const startYearPart = startYear === endYear ? "" : ` ${startYear}`;
  return `${startDate}. ${month(first)}${startYearPart} – ${endDate}. ${month(last)}${year}`;
}

/** „Titel · Zusatz · Datum · THE LION SQUAD“ - leere Teile fallen weg. */
export function shareText({ title, detail, start, end, now }: { title: string; detail?: string | null; start?: string | null; end?: string | null; now?: Date }): string {
  return [title, detail, shareDateLabel(start, end, now), CLUB_NAME].map((part) => String(part || "").trim()).filter(Boolean).join(" · ");
}

/** Öffnet das Teilen-Menü des Handys mit Satz und Adresse; Abbrechen ist kein Fehler. */
export async function sharePage({ kind, id, title, detail, start, end }: { kind: ShareKind; id: string; title: string; detail?: string | null; start?: string | null; end?: string | null }): Promise<boolean> {
  const url = shareUrl(kind, id);
  const text = shareText({ title, detail, start, end });
  try {
    await Share.share({ message: `${text}\n${url}`, url, title });
    return true;
  } catch {
    return false;
  }
}
