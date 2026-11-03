// Reiter „Modi“ der Spielseite (#2249): die Modi des Spiels (C.1, #2206) mit Dauerplanung und darunter die Vorgaben für
// Turniere. Gespeichert wird beides mit „Modi speichern“ - es ist ein Satz Spiel-Daten.
import { GameModesEditor, GameTournamentPresets } from "../GameMatchDataFields";

export function GameModesTab({ form, onChange, usage }) {
  return (
    <div className="space-y-5">
      <GameModesEditor modes={form.match_modes} onChange={(modes) => onChange({ ...form, match_modes: modes })} usage={usage} />
      <GameTournamentPresets value={form} onChange={onChange} />
    </div>
  );
}
