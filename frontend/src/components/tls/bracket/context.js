import { createContext, useContext } from "react";
import { effectiveMatchDuration } from "@/lib/matchDuration";

// Kontexte des Turnierbaums: damit Kennungen nicht durch Stufe → Abschnitt → Runde → Karte gereicht werden müssen.
export const EMPTY_SET = new Set();
// Zuletzt geänderte Spiele (#225) bekommen einen Rahmen.
export const ChangedMatchesContext = createContext(EMPTY_SET);
// Die eigene Anmeldung („Du“).
export const MineContext = createContext(null);
// Nach dem Ende (#833): was nicht gespielt wurde, heißt so.
export const FinishedContext = createContext(false);
// Wer in einen noch leeren Platz kommt (#1113): „Sieger aus A“.
export const FinderContext = createContext(() => () => undefined);
// Der Graph (#1561): Linien, Spiele nach Kennung, Podium nur in den Endspielen.
export const GraphContext = createContext({ edges: [], byId: new Map(), decisive: EMPTY_SET, matches: [] });
// Dein Weg (#833, #1561): `active` = { matches, edges } oder null; `selected` = angetippte Anmeldung; `preview` zeigt
// einen Weg nur vorübergehend (Maus, Tastatur-Fokus).
export const PathContext = createContext({ active: null, selected: null, toggle() {}, preview() {}, clear() {} });
// Wohin „Zum Spiel“ führt - und ob es einen eigenen Klick gibt (Verwaltung).
export const MatchLinkContext = createContext({ onMatchClick: null });
// Die Spieldauer je Spiel (#1554) - eine Funktion aus lib/matchDuration.js mit Phase, Turnier und Spiel der Antwort.
export const DurationContext = createContext((match) => effectiveMatchDuration(match));

export function useMatchChanged(matchId) {
  return useContext(ChangedMatchesContext).has(matchId);
}

/** „on“ (liegt auf dem Weg), „off“ (gedämpft) oder "" (kein Weg aktiv). */
export function nodePathState(active, matchId) {
  if (!active) return "";
  return active.matches.has(matchId) ? "on" : "off";
}
