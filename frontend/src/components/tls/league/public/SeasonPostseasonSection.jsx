// Playoffs und Relegation auf der Ligaseite (#2404, docs/LIGA.md „F.6 Playoffs und Relegation“): unter den Staffeln einer Liga der
// K.-o.-Baum der Playoffs und die Paarungen der Relegation. Jede ist eine eigene Staffel. Zu sehen ist nur, was die Season-Antwort
// nennt: was angelegt ist und was die Person auch als Turnier sähe. Eine Season ohne Playoffs zeigt hier nichts.
//
// - Playoffs: derselbe Baum wie auf der Turnierseite (`BracketTree`, GET /api/tournaments/<id>/bracket) - unter der Überschrift
//   „Playoffs“, ohne den Abschnittstitel des Turnierbaums (Nr. 248: nie „Winner Bracket“).
// - Relegation: Paarungen als Karten aus der Season-Antwort (`pairs`). Je Paarung steht, welches Team aus der oberen und welches aus
//   der unteren Liga kommt; Setzplätze gibt es hier nicht. Wer auf- oder absteigt, steht erst nach dem Abschluss da (Nr. 213).
import { Suspense, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Swords } from "lucide-react";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { api } from "@/lib/api";
import { lazyPage } from "@/lib/chunkReload";
import { kindLabel, relegationPairState } from "@/lib/leaguePostseason";

// Der Baum wird erst geladen, wenn eine Liga wirklich Playoffs hat - die Ligaseite ohne sie bleibt so leicht wie vorher.
const BracketTree = lazyPage(() => import("@/components/tls/BracketTree").then((module) => ({ default: module.BracketTree })));

const NOTE = {
  playoff: "Die besten Teams der Staffeln spielen im K.-o.-System. Gesetzt wird nach dem Endstand, über Kreuz.",
  relegation: "Die Relegationsplätze dieser Liga spielen gegen die der Liga darunter – ein Spiel je Paarung. Das Team der oberen Liga hat Heimrecht.",
};

function Head({ row, divisionLabel, titleId }) {
  const label = kindLabel(row);
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h3 id={titleId} className="flex items-center gap-2 font-heading text-xl font-black uppercase md:text-2xl">
          <Swords className="h-4 w-4 shrink-0 tls-league-accent" aria-hidden="true" /> <span className="[overflow-wrap:anywhere]">{label}</span>
          {row.closed ? <span className="rounded-sm border border-white/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white/60">Endstand</span> : null}
        </h3>
        <p className="mt-1 max-w-2xl text-sm text-white/60">{NOTE[row.kind]}</p>
      </div>
      {row.slug ? (
        <Link to={`/tournaments/${row.slug}/bracket`} className="tls-btn tls-btn--quiet inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-sm px-3 text-xs font-bold uppercase tracking-wider"
          data-testid={`league-postseason-link-${row.tournament_id}`} aria-label={`${label} ${divisionLabel}: alle Spiele`}>
          Alle Spiele <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}

function PlayoffTree({ row }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/tournaments/${row.tournament_id}/bracket`);
      setData(body);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [row.tournament_id]);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, ["tournaments", "matches"], { fallbackMs: 15000, tournamentId: row.tournament_id });
  const waiting = <p className="text-sm text-white/45" aria-busy="true">Lade {kindLabel(row)} …</p>;
  return (
    <div className="mt-4 min-w-0">
      {failed && !data ? <p className="text-sm text-white/55" role="status">Der Baum ließ sich gerade nicht laden.</p> : null}
      {!data && !failed ? waiting : null}
      {data ? <Suspense fallback={waiting}><BracketTree data={data} compact quietSections /></Suspense> : null}
    </div>
  );
}

function PairTeam({ side, home = false }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5" data-won={side.won ? "true" : undefined}>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-bold uppercase tracking-wider text-white/50">{side.division_label}{home ? " · Heim" : ""}</span>
        <span className={`block [overflow-wrap:anywhere] ${side.won ? "font-bold text-white" : "font-medium text-white/85"}`}>{side.display_name}</span>
      </span>
      {side.score !== null && side.score !== undefined ? <span className={`shrink-0 font-display text-lg font-bold tabular-nums ${side.won ? "tls-league-accent" : "text-white/60"}`}>{side.score}</span> : null}
    </div>
  );
}

/** Die Paarungen der Relegation: oben das Team der oberen Liga (Heim), darunter das der unteren - mit Ergebnis, sobald es eines gibt. */
function RelegationPairs({ row }) {
  const pairs = row.pairs || [];
  if (!pairs.length) return <p className="mt-4 text-sm text-white/55">Die Paarungen stehen noch nicht fest.</p>;
  return (
    <ul className="mt-4 grid gap-3 sm:grid-cols-2" aria-label="Paarungen der Relegation" data-testid={`league-relegation-pairs-${row.tournament_id}`}>
      {pairs.map((pair) => {
        const state = relegationPairState(pair, { closed: Boolean(row.closed) });
        const body = (
          <>
            <PairTeam side={pair.upper} home />
            <PairTeam side={pair.lower} />
            <p className="px-3 py-2 text-xs text-white/60">{state}</p>
          </>
        );
        return (
          <li key={pair.pair} className="rounded-md border border-white/10 bg-[var(--tls-surface-1)]" data-testid={`league-relegation-pair-${row.tournament_id}-${pair.pair}`}>
            {pair.match_id
              ? <Link to={`/matches/${pair.match_id}`} className="block divide-y divide-white/5 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#29B6E8]" aria-label={`${pair.upper.display_name} gegen ${pair.lower.display_name}: ${state}`}>{body}</Link>
              : <div className="divide-y divide-white/5">{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

function PostseasonBlock({ row, divisionLabel }) {
  const titleId = `postseason-${row.tournament_id}`;
  return (
    <section className="mt-8 scroll-mt-24" id={`staffel-${row.slug || row.tournament_id}`} aria-labelledby={titleId} data-testid={`league-postseason-${row.kind}-${row.tournament_id}`}>
      <Head row={row} divisionLabel={divisionLabel} titleId={titleId} />
      {row.kind === "relegation" ? <RelegationPairs row={row} /> : <PlayoffTree row={row} />}
    </section>
  );
}

/** Die Playoff- und die Relegations-Staffel einer Liga - nichts, wenn es keine gibt. */
export function DivisionPostseason({ division }) {
  const rows = division?.postseason || [];
  if (!rows.length) return null;
  return rows.map((row) => <PostseasonBlock key={row.tournament_id} row={row} divisionLabel={division.label} />);
}
