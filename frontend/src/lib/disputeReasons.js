// „Problem melden“ (#1158): die Gründe zum Antippen - dieselben Wörter wie im Server (services/match_disputes.CATEGORIES)
// und in der App (mobile/src/lib/disputeReasons.ts).
export const DISPUTE_REASONS = [
  ["wrong_result", "Falsches Ergebnis"],
  ["rule_violation", "Regelverstoß"],
  ["technical", "Technik"],
  ["other", "Sonstiges"],
];

export function disputeReasonLabel(code) {
  return (DISPUTE_REASONS.find(([key]) => key === code) || DISPUTE_REASONS[3])[1];
}
