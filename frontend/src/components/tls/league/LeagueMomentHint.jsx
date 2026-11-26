// Saisonende-Moment (#1639): Nach dem Moment bleibt der Ausgang als Hinweis an Profil und Teamseite - je Co-Team der jüngste bestätigte
// Ausgang der Season (Aufstieg, Abstieg, Meister). Der Server liefert nur, was die betrachtende Person sehen darf (nie eine Season „Aus“),
// die Texte kommen von dort. „Moment ansehen“ (nur für die Person selbst bzw. Mitglieder) spielt ihn noch einmal ab - ohne Zählung.
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Crown, Flag, Play } from "lucide-react";
import { LeagueBadge } from "@/components/tls/league/LeagueBadge";
import { ceremonyQueue } from "@/components/achievements/ceremony/queue";

const ICONS = { up: ArrowUp, down: ArrowDown, champion: Crown };
const TONES = { up: "text-ok", down: "text-white/70", champion: "text-honor" };

export function replayMoment(moment, queue = ceremonyQueue) {
  queue.enqueue({ id: `moment-replay-${moment.id}-${Date.now()}`, moments: [moment] });
}

export function LeagueMomentHint({ rows, canReplay = false, showTeam = true, testId = "league-moments", queue = ceremonyQueue }) {
  const list = (rows || []).filter((row) => row?.id && row.texts);
  if (!list.length) return null;
  return (
    <section data-testid={testId} aria-labelledby={`${testId}-title`}>
      <h2 id={`${testId}-title`} className="mb-4 flex items-center gap-2 font-heading text-2xl font-bold uppercase">
        <Flag className="h-5 w-5 text-[#29B6E8]" aria-hidden="true" /> Saisonende
      </h2>
      <ul className="grid gap-2">
        {list.map((row, index) => {
          const Icon = ICONS[row.outcome] || Flag;
          return (
            <li key={row.id} className="tls-moment-hint" data-outcome={row.outcome} data-testid={`${testId}-${row.id}`}>
              {row.badge_to ? <LeagueBadge badge={row.badge_to} size="card" label={false} decorative index={index} /> : null}
              <div className="min-w-0">
                <p className={`flex flex-wrap items-center gap-x-2 text-xs font-bold uppercase tracking-widest ${TONES[row.outcome] || "text-white/70"}`}>
                  <span className="inline-flex items-center gap-1"><Icon className="h-3.5 w-3.5" aria-hidden="true" /> {row.texts.kicker}</span>
                  {row.corrected ? <span className="font-semibold normal-case tracking-normal text-white/50">· Endstand korrigiert</span> : null}
                </p>
                <p className="mt-0.5 font-semibold text-white [overflow-wrap:anywhere]">{row.outcome === "champion" ? row.texts.meta : row.texts.line}</p>
                <p className="mt-0.5 text-xs text-white/60 [overflow-wrap:anywhere]">
                  {[showTeam && row.outcome === "champion" ? row.display_name : "", row.outcome === "champion" ? "" : row.title].filter(Boolean).join(" · ")}
                  {row.url ? <> · <Link to={row.url} className="underline-offset-2 hover:text-[#29B6E8] hover:underline">Endstand</Link></> : null}
                </p>
              </div>
              {canReplay ? (
                <button type="button" onClick={() => replayMoment(row, queue)} data-testid={`${testId}-${row.id}-replay`}
                  className="tls-moment-hint__replay inline-flex min-h-[44px] items-center gap-1.5 rounded-sm border border-white/15 px-3 text-[11px] font-bold uppercase tracking-wider text-white/75">
                  <Play className="h-3.5 w-3.5" aria-hidden="true" /> Moment ansehen
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
