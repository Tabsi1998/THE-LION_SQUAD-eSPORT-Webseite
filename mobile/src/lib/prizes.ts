import type { PrizePickup } from "../types";

// Woher ein Gewinn kommt: Turnier, Fast Lap oder Verlosung (#641). Eine Verlosung hat kein Turnier dahinter -
// ihre Karte führt nirgends hin und nennt „Verlosung“ statt einem Platz.

export type PrizeKind = "tournament" | "fastlap" | "season";

export function prizeTarget(item: PrizePickup): { kind: PrizeKind; id: string } {
  if (item.source_type === "fastlap") {
    return { kind: "fastlap", id: item.fastlap_challenge_slug || item.fastlap_challenge_id || "" };
  }
  if (item.source_type === "season") return { kind: "season", id: "" };
  return { kind: "tournament", id: item.tournament_slug || item.tournament_id || "" };
}

export function prizeKindLabel(kind: PrizeKind): string {
  if (kind === "fastlap") return "Fast Lap";
  return kind === "season" ? "Verlosung" : "Turnier";
}

/** Zwei Buchstaben für das Zeichen der Karte. */
export function prizeKindMark(kind: PrizeKind): string {
  if (kind === "fastlap") return "FL";
  return kind === "season" ? "V" : "T";
}

export function prizeSourceLabel(item: PrizePickup): string {
  if (item.fastlap_source_label) return item.fastlap_source_label;
  if (item.source_type === "season") return item.season_source_label ? `Verlosung, ${item.season_source_label}` : "Verlosung";
  return prizeKindLabel(prizeTarget(item).kind);
}

/** „#1“ für einen Platz, „Verlosung“ für einen Gewinn ohne Platz. */
export function prizePlaceText(item: PrizePickup): string {
  if (item.source_type === "season") return item.place_label || "Verlosung";
  const text = item.place_label || (item.place ? `Platz ${item.place}` : "Platz");
  return text.replace(/^Platz\s*/i, "#");
}
