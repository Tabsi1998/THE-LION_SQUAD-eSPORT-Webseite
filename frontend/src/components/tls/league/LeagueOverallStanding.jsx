// Platz in der Gesamtwertung über Seasons an Team- und Spielerprofil (F.5, #2215, docs/LIGA.md „F.5“): je Zeitraum und Liga N Platz von
// wie vielen und die Punkte, mit Link zur Gesamtwertung. Der Server liefert nur, was die Person sehen darf - ohne Einträge nichts.
import { Link } from "react-router-dom";
import { Lock, Trophy } from "lucide-react";
import { pointsWord } from "@/lib/leagueOverall";

export function LeagueOverallStanding({ rows, showTeam = false, testId = "league-overall" }) {
  if (!rows?.length) return null;
  return (
    <section data-testid={testId} aria-labelledby={`${testId}-title`}>
      <h2 id={`${testId}-title`} className="mb-4 flex items-center gap-2 font-heading text-2xl font-bold uppercase">
        <Trophy className="h-5 w-5 text-[#29B6E8]" aria-hidden="true" /> Gesamtwertung
      </h2>
      <ul className="divide-y divide-white/5 rounded-sm border border-white/10 bg-[#121212]">
        {rows.map((row) => {
          const title = `${row.league_name} · ${row.period_name}`;
          return (
            <li key={`${title}-${row.level}-${row.name || ""}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3" data-testid={`${testId}-${row.level}`}>
              <div className="min-w-0 flex-1 basis-56">
                <p className="font-semibold text-white [overflow-wrap:anywhere]">
                  {row.url ? <Link to={row.url} className="hover:text-[#29B6E8]">{title}</Link> : title}
                </p>
                <p className="text-xs text-white/60 [overflow-wrap:anywhere]">
                  {[row.division_label, showTeam ? row.name : "", row.closed ? "Endstand" : "laufend"].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm tabular-nums">
                {row.closed && row.place === 1 ? <span className="inline-flex items-center gap-1 font-bold text-honor"><Trophy className="h-4 w-4" aria-hidden="true" /> Gesamtsieger</span> : null}
                {row.closed ? <Lock className="h-3.5 w-3.5 text-white/40" aria-label="Abgeschlossen" /> : null}
                <span className="text-white/80">Platz {row.place} von {row.of}</span>
                <span className="text-white/60">{pointsWord(row.points)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
