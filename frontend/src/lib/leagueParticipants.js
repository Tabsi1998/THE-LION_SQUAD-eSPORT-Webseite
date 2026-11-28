// Teilnehmerart einer Liga (#1629, P1 Solo-Grundlage; docs/LIGA.md „Solo-Liga“): Co-Teams oder Spieler (1 gegen 1). Die Art steht
// ab dem Anlegen fest, der Server prüft sie (services/league_participants.py). Ohne Feld ist eine Liga eine Team-Liga - wie vorher.
// Hier stehen nur die Wörter und Sätze der Verwaltung; die volle Umstellung der Begriffe je Art folgt später (S12).

export const TEAM = "team";
export const SOLO = "solo";
export const PARTICIPANT_OPTIONS = [[TEAM, "Co-Teams"], [SOLO, "Spieler (1 gegen 1)"]];
const LABELS = Object.fromEntries(PARTICIPANT_OPTIONS);

// Dieselben Sätze wie im Server - die Verwaltung sagt vorab, was der Server sonst ablehnt.
export const KIND_FIXED_HINT = "Steht seit dem Anlegen fest. Für die andere Art eine neue Liga anlegen.";
export const SOLO_ONLY_ONE = "Solo-Liga: Jede Person spielt für sich – immer 1 gegen 1.";
export const SOLO_APPLICATIONS_FOLLOW = "Die Selbstanmeldung als Spieler folgt in einem späteren Ausbau – bis dahin teilt die Leitung die Spieler auf der Staffel-Seite zu.";
export const SOLO_SUCCESSOR_FOLLOWS = "Die Folge-Season mit Auf- und Abstieg und Startrechten folgt für Solo-Ligen in einem späteren Ausbau – bis dahin eine neue Season anlegen und die Spieler zuteilen.";
export const SOLO_OPERATIONS_FOLLOW ="Der Spielbetrieb einer Solo-Liga (Check-in, Veto, Ergebnis melden) folgt in einem späteren Ausbau – die Staffel bleibt bis dahin im Entwurf.";

export function participantKind(league) {
  return league?.participant_kind === SOLO ? SOLO : TEAM;
}

export function isSoloLeague(league) {
  return participantKind(league) === SOLO;
}

/** Eine Staffel einer Solo-Liga: Liga-Rahmen und Teilnahme „solo“ (die Staffel übernimmt die Art beim Anlegen). */
export function isSoloStaffel(tournament) {
  return Boolean(tournament?.league_context) && tournament?.team_mode === SOLO;
}

export function participantLabel(league) {
  return LABELS[participantKind(league)];
}

/** Darf dieses Spiel eine Solo-Liga tragen? Ohne Angabe wie im Spiel-Modell: ja. */
export function gameAllowsSolo(game) {
  return game?.supports_solo !== false;
}

/** Das Wort für die Teilnehmer einer Staffel: „Spieler“ in der Solo-Liga, sonst „Co-Team“. */
export function entrantWords(tournament) {
  return isSoloStaffel(tournament)
    ? { one: "Spieler", many: "Spieler", none: "Noch kein Spieler in dieser Staffel.", search: "Spieler suchen" }
    : { one: "Co-Team", many: "Co-Teams", none: "Noch kein Co-Team in dieser Staffel.", search: "Co-Team oder Team suchen" };
}
