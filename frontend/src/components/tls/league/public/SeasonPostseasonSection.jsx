// Playoffs und Relegation auf der Ligaseite (#2404, docs/LIGA.md „F.6 Playoffs und Relegation“): unter den Staffeln einer Liga der
// K.-o.-Baum der Playoffs und die Paarungen der Relegation. Jede ist eine eigene Staffel - derselbe Baum wie auf der Turnierseite
// (`BracketTree`, GET /api/tournaments/<id>/bracket), hier ohne Umweg. Zu sehen ist nur, was die Season-Antwort nennt: was angelegt
// ist und was die Person auch als Turnier sähe. Eine Season ohne Playoffs zeigt hier nichts.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Swords } from "lucide-react";
import { BracketTree } from "@/components/tls/BracketTree";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { api } from "@/lib/api";
import { kindLabel } from "@/lib/leaguePostseason";

const NOTE = {
  playoff: "Die besten Teams der Staffeln spielen im K.-o.-System. Gesetzt wird nach dem Endstand, über Kreuz.",
  relegation: "Die Relegationsplätze dieser Liga spielen gegen die der Liga darunter. Das Team der oberen Liga hat Heimrecht.",
};

function PostseasonTree({ row, divisionLabel }) {
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
  const label = kindLabel(row);
  const titleId = `postseason-${row.tournament_id}`;
  return (
    <section className="mt-8 scroll-mt-24" id={`staffel-${row.slug || row.tournament_id}`} aria-labelledby={titleId} data-testid={`league-postseason-${row.kind}-${row.tournament_id}`}>
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
      <div className="mt-4 min-w-0">
        {failed && !data ? <p className="text-sm text-white/55" role="status">Der Baum ließ sich gerade nicht laden.</p> : null}
        {!data && !failed ? <p className="text-sm text-white/45" aria-busy="true">Lade {label} …</p> : null}
        {data ? <BracketTree data={data} compact /> : null}
      </div>
    </section>
  );
}

/** Die Playoff- und die Relegations-Staffel einer Liga - nichts, wenn es keine gibt. */
export function DivisionPostseason({ division }) {
  const rows = division?.postseason || [];
  if (!rows.length) return null;
  return rows.map((row) => <PostseasonTree key={row.tournament_id} row={row} divisionLabel={division.label} />);
}
