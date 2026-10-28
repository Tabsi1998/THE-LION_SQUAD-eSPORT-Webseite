// Liga-Übersicht (docs/LIGA.md, P5, #1625) unter /liga: die Ligen und Seasons, die die Person sehen darf. Ohne
// sichtbare Season steht ein freundlicher Hinweis da - der Menüpunkt „Liga“ erscheint dann ohnehin nicht.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, ListOrdered } from "lucide-react";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { StaggerIn } from "@/components/tls/motion";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { seasonPath } from "@/lib/leaguePage";
import { viennaDate } from "@/lib/vienna";
import "@/components/tls/league/public/league.css";

const STATUS = { draft: "Startet bald", active: "Läuft", completed: "Beendet" };

export default function LeagueIndexPage() {
  const [leagues, setLeagues] = useState(null);
  useDocumentTitle("Liga", "Die Ligen von THE LION SQUAD: Seasons, Staffeln, Tabellen und Spielpläne.");
  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/leagues");
      setLeagues(data?.leagues || []);
    } catch {
      setLeagues([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <PublicLayout>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Liga" }]} className="mb-3" />
        <h1 className="font-heading text-4xl md:text-6xl font-black uppercase">Liga</h1>
        <p className="mt-3 max-w-2xl text-white/65">Wochen statt Turniertag: Jede Woche ein Spieltag, Termin unter den Teams ausgemacht, Tabelle nach jeder Runde.</p>
        {leagues === null ? <div className="tls-league-skeleton mt-10" aria-busy="true" aria-label="Lade Ligen" /> : null}
        {leagues && !leagues.length ? (
          <p className="mt-10 border border-dashed border-white/15 rounded-sm px-4 py-6 text-white/60" data-testid="league-index-empty">
            Gerade läuft keine Liga, die du sehen kannst.
          </p>
        ) : null}
        <div className="mt-10 space-y-10">
          {(leagues || []).map((league) => (
            <section key={league.id} aria-labelledby={`league-${league.slug}`} data-testid={`league-index-${league.slug}`}>
              <h2 id={`league-${league.slug}`} className="flex items-center gap-2 font-heading text-2xl font-black uppercase">
                <ListOrdered className="h-5 w-5 text-[#29B6E8]" aria-hidden="true" /> {league.name}
              </h2>
              {league.game?.name ? <p className="text-sm text-white/50">{league.game.name}</p> : null}
              <StaggerIn as="ul" className="mt-4 grid gap-3 sm:grid-cols-2">
                {league.seasons.map((season) => (
                  <li key={season.id}>
                    <Link to={seasonPath(league, season)} data-testid={`league-index-season-${season.slug}`}
                      className="tls-card group flex items-center gap-4 border border-white/10 bg-[#121212] rounded-sm p-4">
                      <span className="min-w-0 flex-1">
                        <span className="block font-heading text-xl font-bold uppercase">{season.name}</span>
                        <span className="block text-xs text-white/55">
                          {STATUS[season.status] || ""}{season.start_date ? ` · ab ${viennaDate(season.start_date, { day: "numeric", month: "numeric", year: "numeric" })}` : ""}
                        </span>
                      </span>
                      <ChevronRight className="tls-card__arrow h-4 w-4 shrink-0 text-white/35" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </StaggerIn>
            </section>
          ))}
        </div>
      </div>
    </PublicLayout>
  );
}
