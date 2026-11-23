// Aktuelle Ligen (#1630): je Co-Team in einer laufenden Staffel eine Karte mit Liga-Abzeichen (#1638), Staffel, Platz von N, Zone
// und nächstem Spiel - im Personenprofil („Aktuelle Ligen“) und auf der Teamseite („Liga“). Der Server sortiert (beste Liga N oben)
// und entscheidet, was der Betrachter sieht; `internal` (nur im Profil) trägt das Etikett „Vereinsintern“ (#2516).
import { Link } from "react-router-dom";
import { CalendarClock, ChevronRight, ListOrdered } from "lucide-react";
import { InternalTag } from "@/components/tls/InternalTag";
import { ZoneMark } from "@/components/tls/league/ZoneMark";
import { LeagueBadge } from "@/components/tls/league/LeagueBadge";
import { LeagueEmblem } from "@/components/tls/league/public/LeagueLook";
import { badgeLabel, currentPlace, nextMatchText } from "@/lib/leagueBadge";
import "./leagueBadge.css";

function Row({ row, index, nameOf, testId }) {
  const label = badgeLabel(row.badge) || row.division_label;
  const next = nextMatchText(row.next_match);
  const id = `${testId}-${row.registration_id}`;
  return (
    <Link to={row.link} className="tls-league-now__row" data-testid={id}>
      <LeagueBadge badge={row.badge} size="card" label={false} index={index} testId={`${id}-badge`} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#29B6E8] [overflow-wrap:anywhere]" data-testid={`${id}-label`}>
            {row.staffel_label || [label, row.staffel ? `Staffel ${row.staffel}` : ""].filter(Boolean).join(" · ")}
          </span>
          {row.internal ? <InternalTag testId={`${id}-internal`} /> : null}
        </div>
        <div className="tls-league-now__name font-heading text-lg">{nameOf(row)}</div>
        <div className="tls-league-now__meta flex items-center gap-1.5">
          {/* Emblem der Season bzw. Liga (#2107) klein vor dem Namen - ohne Bild das Liga-Zeichen. */}
          <LeagueEmblem src={row.emblem_url} size={18} testId={`${testId}-emblem-${row.registration_id}`} />
          <span className="min-w-0">{[row.league?.name, row.season?.name].filter(Boolean).join(" · ")}</span>
        </div>
        <div className="tls-league-now__facts">
          <span className="tls-league-now__place" data-testid={`${id}-place`}>{currentPlace(row)}</span>
          {row.zone && row.zone_label ? (
            <span className="tls-league-now__zone" data-testid={`${id}-zone`}>
              <ZoneMark zone={row.zone} className="h-3.5 w-3.5" /> {row.zone_label}
            </span>
          ) : null}
          {next ? (
            <span className="tls-league-now__next" data-testid={`${id}-next`}>
              <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> <span><span className="sr-only">Nächstes Spiel: </span>{next}</span>
            </span>
          ) : null}
        </div>
      </div>
      <ChevronRight className="tls-league-now__arrow h-4 w-4" aria-hidden="true" />
    </Link>
  );
}

/** `rows` vom Server (`league_current` im Profil, `league` der Teamseite). `nameOf`: welcher Name groß steht. */
export function LeagueCurrent({ rows, title = "Aktuelle Ligen", nameOf = (row) => row.squad_name || row.display_name, testId = "league-current" }) {
  if (!rows?.length) return null;
  return (
    <section data-testid={testId} aria-labelledby={`${testId}-title`}>
      <h2 id={`${testId}-title`} className="mb-4 flex items-center gap-2 font-heading text-2xl font-bold uppercase">
        <ListOrdered className="h-5 w-5 text-[#29B6E8]" aria-hidden="true" /> {title}
      </h2>
      <div className="tls-league-now">
        {rows.map((row, index) => <Row key={row.registration_id} row={row} index={index} nameOf={nameOf} testId={testId} />)}
      </div>
    </section>
  );
}
