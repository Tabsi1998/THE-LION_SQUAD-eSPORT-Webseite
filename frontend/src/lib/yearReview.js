// Jahresrückblick „Dein Jahr bei LION“ (#1195): aus den Zahlen des Servers die Seiten zum Durchtippen - nur Seiten
// mit Inhalt, höchstens acht. Dieselbe Reihenfolge steht in der App (mobile/src/lib/yearReview.ts).

export const YEAR_REVIEW_PATH = "/dein-jahr";

export function yearReviewPages(review) {
  if (!review) return [];
  const t = review.tournaments || {};
  const pages = ["intro"];
  if (t.count) pages.push("tournaments");
  if (review.favorite_game?.name) pages.push("favorite");
  if (review.events?.count) pages.push("events");
  if (review.fastlap?.best?.time) pages.push("fastlap");
  if (review.achievements?.count) pages.push("achievements");
  if (review.season?.rank) pages.push("season");
  pages.push("share");
  return pages;
}

export function countWord(count, one, many) {
  return `${count} ${Number(count) === 1 ? one : many}`;
}

/** „Mehr Turniere als 8 von 10 im Verein.“ - nur, wenn der Server einen Vergleich mitschickt. */
export function comparisonText(review) {
  const tenths = review?.tournaments?.more_than_of_ten;
  return tenths ? `Mehr Turniere als ${tenths} von 10 im Verein.` : "";
}

export function bestResultText(review) {
  const best = review?.tournaments?.best;
  if (!best?.rank || !best.title) return "";
  return `Dein bestes Ergebnis: Platz ${best.rank} im ${best.title}${best.participant_count ? ` (von ${best.participant_count})` : ""}.`;
}

export function fastlapText(review) {
  const best = review?.fastlap?.best;
  if (!best) return "";
  const where = [best.track, best.title && best.title !== best.track ? best.title : null].filter(Boolean).join(" · ");
  const rank = best.rank ? `Platz ${best.rank}${best.participant_count ? ` von ${best.participant_count}` : ""}` : "";
  return [where, rank].filter(Boolean).join(" – ");
}

export function seasonText(review) {
  const season = review?.season;
  if (!season?.rank) return "";
  const points = season.points != null ? `${String(season.points).replace(".", ",")} Punkte` : "";
  return [season.participants ? `von ${season.participants}` : "", points].filter(Boolean).join(" · ");
}
