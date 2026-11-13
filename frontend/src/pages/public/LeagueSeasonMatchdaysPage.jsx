// Spieltage der Season (#2268) unter /liga/<liga>/<season>/spieltage: je Staffel Woche für Woche - Leiste aller Wochen mit Stand,
// darunter die gewählte mit Ergebnissen, Map-Chips und Modus-Symbolen; kampflos, „Map wiederholt“ und „in Klärung“ markiert. Staffel
// und Woche stehen in der Adresse (?staffel=…&woche=…), so lässt sich ein Spieltag verlinken.
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { SeasonShell } from "@/components/tls/league/public/SeasonShell";
import { SeasonPlaceholder } from "@/components/tls/league/public/SeasonParts";
import { StaffelPlan } from "@/components/tls/league/public/StaffelPanel";
import { mapOrder, staffelList } from "@/lib/leagueSeasonPage";

function Matchdays({ data }) {
  const [params, setParams] = useSearchParams();
  const { league, season } = data;
  const list = useMemo(() => staffelList(data.divisions), [data.divisions]);
  const order = useMemo(() => mapOrder(season, league?.game, data.map_pool), [season, league, data.map_pool]);
  const wanted = params.get("staffel");
  const current = list.find((row) => row.key === wanted || row.tournament_id === wanted) || list[0];
  const week = Number(params.get("woche")) || null;
  if (!current) return <SeasonPlaceholder season={season} application={data.application} />;
  const choose = (key) => setParams({ staffel: key }, { replace: true });
  const onWeek = (number) => setParams({ staffel: current.key, woche: String(number) }, { replace: true });
  return (
    <section className="mt-8" aria-labelledby="season-matchdays-title">
      <h2 id="season-matchdays-title" className="sr-only">Spieltage {current.label}</h2>
      {list.length > 1 ? (
        <div className="tls-season-picker tls-swipe" role="group" aria-label="Staffel wählen" data-testid="season-staffel-picker">
          {list.map((row) => {
            const selected = row.tournament_id === current.tournament_id;
            return (
              <button key={row.tournament_id} type="button" aria-pressed={selected} onClick={() => choose(row.key)}
                data-testid={`season-staffel-pick-${row.key}`}
                className={`tls-btn tls-league-tab ${selected ? "tls-btn--secondary" : "tls-btn--quiet"} min-h-[44px] shrink-0 rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider`}>
                {row.label}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/50" data-testid="season-staffel-name">{current.label}</p>
      )}
      <div className="mt-4">
        <StaffelPlan key={current.tournament_id} leagueSlug={league.slug} seasonSlug={season.slug} staffel={current} order={order}
          week={week} onWeek={onWeek} />
      </div>
    </section>
  );
}

export default function LeagueSeasonMatchdaysPage() {
  return <SeasonShell section="spieltage">{(data) => <Matchdays data={data} />}</SeasonShell>;
}
