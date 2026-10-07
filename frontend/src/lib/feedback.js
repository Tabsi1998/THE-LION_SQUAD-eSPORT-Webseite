// Rückmeldung (#1196): reine Helfer für den Dialog und die Auswertung - ohne React, mit Tests.

export const STAR_LABELS = { 1: "Gar nicht gut", 2: "Eher nicht", 3: "Ging so", 4: "Gut", 5: "Richtig gut" };

/** „tournament:abc“ aus Aktion oder Adresse (?bewerten=…) - oder null. */
export function parseFeedbackTarget(value) {
  const match = /^(tournament|event):(.+)$/.exec(String(value || "").trim());
  return match ? { kind: match[1], id: match[2] } : null;
}

/** Über den Stichworten: bei vier oder fünf Sternen (und bevor jemand wählt) „Was war gut?“, sonst „Was hat gestört?“. */
export function feedbackTagPrompt(stars) {
  return !stars || stars >= 4 ? "Was war gut?" : "Was hat gestört?";
}

/** Der Schnitt mit Komma: 3.7 → „3,7“. */
export function averageLabel(value) {
  return value == null ? "–" : String(value).replace(".", ",");
}
