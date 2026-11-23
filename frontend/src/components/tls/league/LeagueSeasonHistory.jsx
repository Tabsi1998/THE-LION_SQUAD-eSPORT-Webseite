// Season-Historie an Team- und Spielerprofil (F.2, #1627, docs/LIGA.md „F.2 Neue Season aus dem Vorgänger“): je abgeschlossener
// Liga-Staffel Season, Liga N, Platz von wie vielen, Meister und Auf- oder Abstieg. Der Server liefert nur, was der Endstand festhielt
// und was die Person sehen darf - ohne Einträge zeigt der Baustein nichts.
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Crown, Layers } from "lucide-react";
import { ZONE_LABELS, exitText } from "@/lib/leagueTable";
import { InternalTag } from "@/components/tls/InternalTag";
import { LeagueBadge } from "@/components/tls/league/LeagueBadge";


function Movement({ zone }) {
  if (zone === "promotion") return <span className="inline-flex items-center gap-1 text-ok"><ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /> {ZONE_LABELS.promotion}</span>;
  if (zone === "relegation") return <span className="inline-flex items-center gap-1 text-warn"><ArrowDown className="h-3.5 w-3.5" aria-hidden="true" /> {ZONE_LABELS.relegation}</span>;
  return ZONE_LABELS[zone] ? <span className="text-white/60">{ZONE_LABELS[zone]}</span> : null;
}

function placeText(row) {
  if (row.exit) return exitText(row.exit);
  return row.of ? `Platz ${row.rank} von ${row.of}` : `Platz ${row.rank}`;
}

export function LeagueSeasonHistory({ rows, showTeam = false, testId = "league-season-history" }) {
  if (!rows?.length) return null;
  return (
    <section data-testid={testId} aria-labelledby={`${testId}-title`}>
      <h2 id={`${testId}-title`} className="mb-4 flex items-center gap-2 font-heading text-2xl font-bold uppercase">
        <Layers className="h-5 w-5 text-[#29B6E8]" aria-hidden="true" /> Seasons
      </h2>
      <ul className="divide-y divide-white/5 rounded-sm border border-white/10 bg-[#121212]">
        {rows.map((row, index) => (
          <li key={`${row.season_id}-${row.staffel}-${row.display_name}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
            data-testid={`${testId}-${row.season_id}`}>
            <div className="min-w-0 flex-1 basis-56">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="min-w-0 font-semibold text-white [overflow-wrap:anywhere]">
                  {row.url ? <Link to={row.url} className="hover:text-[#29B6E8]">{row.league_name} · {row.season_name}</Link> : `${row.league_name} · ${row.season_name}`}
                </p>
                {/* Vereinsintern (#2521): eine Season, die Gäste nicht sehen - nur im Spielerprofil, der Server setzt `internal`. */}
                {row.internal ? <InternalTag testId={`${testId}-${row.season_id}-internal`} /> : null}
              </div>
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/60">
                {/* Liga-Abzeichen (#1638): Liga N mit Beiname, Gold nur für den Meister - ohne Daten (alter Endstand) der Text. */}
                {row.badge ? <LeagueBadge badge={row.badge} size="list" index={index} testId={`${testId}-${row.season_id}-badge`} /> : null}
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {[row.badge ? "" : row.division_label, row.staffel ? `Staffel ${row.staffel}` : "", showTeam ? row.display_name : ""].filter(Boolean).join(" · ")}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm tabular-nums">
              {row.champion ? (
                <span className="inline-flex items-center gap-1 font-bold text-honor"><Crown className="h-4 w-4" aria-hidden="true" /> Meister</span>
              ) : null}
              <span className="text-white/80">{placeText(row)}</span>
              <Movement zone={row.zone} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
