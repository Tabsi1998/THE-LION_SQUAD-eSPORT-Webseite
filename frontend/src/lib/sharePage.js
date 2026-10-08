import { formatWhen } from "@/lib/datetime";
import { dayNoon, viennaDate, viennaDay } from "@/lib/vienna";

// Teilen (#1154, wie mobile/src/lib/share.ts): Event, Turnier, Fast Lap, News, Team und Album teilen die Adresse der
// Seite mit einem kurzen Satz „Herbst-LAN 2026 · 14.–16. November · THE LION SQUAD“. Am Handy öffnet das
// Teilen-Menü des Browsers, am PC kommt der Link in die Zwischenablage. Wer die App hat, landet dort im richtigen
// Screen. Interne Events und Mitglieder-Alben lassen sich teilen, öffnen sich aber nur für Mitglieder.

export const CLUB_NAME = "THE LION SQUAD";
export const SHARE_PATHS = { event: "events", tournament: "tournaments", fastlap: "fastlap", news: "news", team: "teams", album: "galerie" };

export function shareUrl(kind, idOrSlug, origin = typeof window === "undefined" ? "" : window.location.origin) {
  return `${origin}/${SHARE_PATHS[kind]}/${encodeURIComponent(idOrSlug)}`;
}

/** Ein Tag mit Uhrzeit („Sa 23. Mai · 18:00“), mehrere Tage als Spanne („14.–16. November“); Jahr nur, wenn nicht das laufende. */
export function shareDateLabel(start, end, now = new Date()) {
  if (!start) return "";
  const first = viennaDay(start);
  const last = end ? viennaDay(end) : first;
  if (!first) return "";
  if (!last || last <= first) return formatWhen(start, { now });
  const [startYear, startMonth, startDate] = first.split("-").map(Number);
  const [endYear, endMonth, endDate] = last.split("-").map(Number);
  const month = (day) => viennaDate(dayNoon(day), { month: "long" });
  const thisYear = viennaDay(now).slice(0, 4);
  const year = String(endYear) === thisYear ? "" : ` ${endYear}`;
  if (startYear === endYear && startMonth === endMonth) return `${startDate}.–${endDate}. ${month(last)}${year}`;
  const startYearPart = startYear === endYear ? "" : ` ${startYear}`;
  return `${startDate}. ${month(first)}${startYearPart} – ${endDate}. ${month(last)}${year}`;
}

export function shareText({ title, detail, start, end, now }) {
  return [title, detail, shareDateLabel(start, end, now), CLUB_NAME].map((part) => String(part || "").trim()).filter(Boolean).join(" · ");
}

/**
 * Teilt eine Seite: mit dem Teilen-Menü des Browsers ("shared"), sonst der Link in die Zwischenablage ("copied");
 * Abbrechen ist "cancelled", ohne beides "failed".
 */
export async function sharePage({ kind, id, title, detail, start, end, nav = typeof navigator === "undefined" ? null : navigator, origin }) {
  const url = shareUrl(kind, id, origin);
  const text = shareText({ title, detail, start, end });
  if (nav && typeof nav.share === "function") {
    try {
      await nav.share({ title, text, url });
      return { status: "shared", url };
    } catch (error) {
      if (error?.name === "AbortError") return { status: "cancelled", url };
    }
  }
  if (nav?.clipboard && typeof nav.clipboard.writeText === "function") {
    try {
      await nav.clipboard.writeText(url);
      return { status: "copied", url };
    } catch {
      return { status: "failed", url };
    }
  }
  return { status: "failed", url };
}
