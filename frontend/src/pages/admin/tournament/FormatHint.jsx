// Ein Satz unter dem Turnierformat (#2111): wohin man für die Vereinsliga geht. Das Turnierformat „Jeder gegen jeden –
// Hin- und Rückrunde“ (früher „Liga“) ist ein einzelnes Turnier; Seasons, Ligen und Staffeln gibt es unter Admin → Liga.
import { Link } from "react-router-dom";

const LEAGUE_LIKE_FORMATS = new Set(["league", "round_robin"]);

export function FormatHint({ format, testId = "format-hint" }) {
  if (LEAGUE_LIKE_FORMATS.has(format)) {
    return (
      <span data-testid={testId}>
        Für die Vereinsliga mit Seasons, Ligen und Staffeln: <Link to="/admin/leagues" className="text-[#29B6E8] hover:underline">Admin → eSports → Liga</Link>.
      </span>
    );
  }
  return null;
}
