// Ein Satz unter dem Turnierformat (#2111): wohin man für die Vereinsliga geht. Das Turnierformat „Jeder gegen jeden –
// Hin- und Rückrunde“ (früher „Liga“) ist ein einzelnes Turnier; Seasons, Ligen und Staffeln gibt es unter Admin → Liga.
// Zeitfahren und Rennserie (TA6) bekommen im Turnier keine Spiele - der Satz zeigt den Weg zu Fast Lap und Serien.
import { Link } from "react-router-dom";
import { NO_MATCH_FORMATS } from "@/lib/tournamentFormFields";

const LEAGUE_LIKE_FORMATS = new Set(["league", "round_robin"]);
const LINK_CLASS = "text-[#29B6E8] hover:underline";

export function FormatHint({ format, testId = "format-hint" }) {
  if (LEAGUE_LIKE_FORMATS.has(format)) {
    return (
      <span data-testid={testId}>
        Für die Vereinsliga mit Seasons, Ligen und Staffeln: <Link to="/admin/leagues" className={LINK_CLASS}>Admin → eSports → Liga</Link>.
      </span>
    );
  }
  if (NO_MATCH_FORMATS.has(format)) {
    return (
      <span data-testid={testId} className="text-[#FFD700]">
        Dieses Format bekommt im Turnier keine Spiele und keine Zeiteingabe. Zeitfahren laufen über <Link to="/admin/f1" className={LINK_CLASS}>Fast Lap</Link>, Rennserien über <Link to="/admin/reference-series" className={LINK_CLASS}>Serien</Link>.
      </span>
    );
  }
  return null;
}
