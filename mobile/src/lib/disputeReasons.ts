// „Problem melden“ (#1158): die Gründe zum Antippen - dieselben Wörter wie im Server (services/match_disputes.CATEGORIES)
// und auf der Website (frontend/src/lib/disputeReasons.js).
export type DisputeReason = "wrong_result" | "rule_violation" | "technical" | "other";

export const DISPUTE_REASONS: Array<[DisputeReason, string]> = [
  ["wrong_result", "Falsches Ergebnis"],
  ["rule_violation", "Regelverstoß"],
  ["technical", "Technik"],
  ["other", "Sonstiges"],
];
