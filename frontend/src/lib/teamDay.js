// Team am Spieltag (#1192): die Sätze zu Aufstellung und „Wer ist da“ - ohne React, mit Tests; die App hat dieselben
// (mobile/src/lib/teamDay.ts).

const NUMBER_WORDS = { 1: "eine Person", 2: "zwei", 3: "drei", 4: "vier", 5: "fünf", 6: "sechs" };

/** Rechts neben einem Aufgestellten: der Kapitän heißt so, alle anderen „Spielt“. */
export function starterLabel(member) {
  return member?.role === "captain" ? "Kapitän" : "Spielt";
}

/** Der Satz unter der Aufstellung - wer sie sieht und wer die Meldungen bekommt. */
export function lineupLabel(data, chosenCount = null) {
  if (!data) return "";
  const size = Number(data.team_size || 0);
  const count = chosenCount ?? (data.lineup || []).length;
  if (data.can_edit && count !== size) return `Wähle genau ${size} – so viele spielen bei diesem Turnier je Team.`;
  if (!data.lineup_set) return "Noch keine Aufstellung – Aufruf und Spiel-Meldungen gehen an alle im Team.";
  const who = NUMBER_WORDS[size] ? `diese ${NUMBER_WORDS[size]}` : `diese ${size}`;
  return `Die Turnierleitung sieht die Aufstellung beim Check-in. Aufruf und Spiel-Meldungen gehen an ${who}.`;
}

/** „4 von 5 da“. */
export function presenceLine(presence) {
  return `${Number(presence?.count || 0)} von ${Number(presence?.total || 0)} da`;
}
