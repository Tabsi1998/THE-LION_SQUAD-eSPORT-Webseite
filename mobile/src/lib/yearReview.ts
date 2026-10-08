import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { resolveMediaUrl } from "./api";

// Jahresrückblick „Dein Jahr bei LION“ (#1195) - dieselbe Seitenfolge und dieselben Sätze wie im Web
// (frontend/src/lib/yearReview.js): nur Seiten mit Inhalt, höchstens acht, am Ende das Bild zum Teilen.

export type YearReview = {
  year: number;
  preview?: boolean;
  user?: { username?: string; display_name?: string };
  club_name?: string;
  image_path?: string;
  tournaments: { count: number; wins?: number; podiums?: number; games?: number; games_won?: number; more_than_of_ten?: number | null;
    best?: { title?: string; rank?: number; participant_count?: number | null; slug?: string } | null };
  favorite_game?: { name: string; tournaments: number; games: number } | null;
  events: { count: number; items?: { name: string; date?: string }[] };
  fastlap: { count: number; best?: { time?: string | null; track?: string | null; title?: string | null; rank?: number | null; participant_count?: number | null } | null };
  achievements: { count: number; points?: number; top?: { name: string; material_name?: string | null; material_color?: string | null }[] };
  season?: { name?: string; rank: number; points?: number | null; participants?: number } | null;
  rows?: { label: string; value: string }[];
};

export type YearReviewPage = "intro" | "tournaments" | "favorite" | "events" | "fastlap" | "achievements" | "season" | "share";

export function yearReviewPages(review?: YearReview | null): YearReviewPage[] {
  if (!review) return [];
  const pages: YearReviewPage[] = ["intro"];
  if (review.tournaments?.count) pages.push("tournaments");
  if (review.favorite_game?.name) pages.push("favorite");
  if (review.events?.count) pages.push("events");
  if (review.fastlap?.best?.time) pages.push("fastlap");
  if (review.achievements?.count) pages.push("achievements");
  if (review.season?.rank) pages.push("season");
  pages.push("share");
  return pages;
}

export function countWord(count: number, one: string, many: string): string {
  return `${count} ${Number(count) === 1 ? one : many}`;
}

export function comparisonText(review?: YearReview | null): string {
  const tenths = review?.tournaments?.more_than_of_ten;
  return tenths ? `Mehr Turniere als ${tenths} von 10 im Verein.` : "";
}

export function bestResultText(review?: YearReview | null): string {
  const best = review?.tournaments?.best;
  if (!best?.rank || !best.title) return "";
  return `Dein bestes Ergebnis: Platz ${best.rank} im ${best.title}${best.participant_count ? ` (von ${best.participant_count})` : ""}.`;
}

export function fastlapText(review?: YearReview | null): string {
  const best = review?.fastlap?.best;
  if (!best) return "";
  const where = [best.track, best.title && best.title !== best.track ? best.title : null].filter(Boolean).join(" · ");
  const rank = best.rank ? `Platz ${best.rank}${best.participant_count ? ` von ${best.participant_count}` : ""}` : "";
  return [where, rank].filter(Boolean).join(" – ");
}

export function seasonText(review?: YearReview | null): string {
  const season = review?.season;
  if (!season?.rank) return "";
  const points = season.points != null ? `${String(season.points).replace(".", ",")} Punkte` : "";
  return [season.participants ? `von ${season.participants}` : "", points].filter(Boolean).join(" · ");
}

/** Adresse des Bildes - mit Vorschau für die Verwaltung. Laden nur mit Anmeldung. */
export function yearCardUrl(review: YearReview): string {
  return resolveMediaUrl(`${review.image_path || "/api/year-review/me/card.png"}${review.preview ? "?vorschau=true" : ""}`);
}

/** Bild laden (mit Anmeldung) und ins Teilen-Menü geben. */
export async function shareYearCard(review: YearReview, token: string | null | undefined): Promise<"shared" | "failed"> {
  if (!token) return "failed";
  try {
    if (!(await Sharing.isAvailableAsync())) return "failed";
    const target = `${FileSystem.cacheDirectory}mein-jahr-${review.year}.png`;
    const download = await FileSystem.downloadAsync(yearCardUrl(review), target, { headers: { Authorization: `Bearer ${token}` } });
    if (download.status && download.status !== 200) return "failed";
    await Sharing.shareAsync(download.uri, { mimeType: "image/png", UTI: "public.png", dialogTitle: `Mein ${review.year}` });
    return "shared";
  } catch {
    return "failed";
  }
}
