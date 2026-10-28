// Liga-Übersicht (docs/LIGA.md, P5, #1625) unter /liga: die Ligen und Seasons, die die Person sehen darf. Ohne
// sichtbare Season steht ein freundlicher Hinweis da - der Menüpunkt „Liga“ erscheint dann ohnehin nicht.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { LazyImg } from "@/components/tls/LazyImg";
import { StaggerIn } from "@/components/tls/motion";
import { LeagueEmblem } from "@/components/tls/league/public/LeagueLook";
import { accentStyle, bannerFocus } from "@/lib/leagueLook";
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
            <section key={league.id} aria-labelledby={`league-${league.slug}`} data-testid={`league-index-${league.slug}`}
              className="tls-league-look" style={accentStyle(league.accent_color)}>
              {/* Emblem der Liga (#2107), ohne Bild das Liga-Zeichen in ihrer Farbe. */}
              <div className="flex items-center gap-3">
                <LeagueEmblem src={league.emblem_url} size={48} testId={`league-index-emblem-${league.slug}`} />
                <div className="min-w-0">
                  <h2 id={`league-${league.slug}`} className="font-heading text-2xl font-black uppercase break-words">{league.name}</h2>
                  {league.game?.name ? <p className="text-sm text-white/50">{league.game.name}</p> : null}
                </div>
              </div>
              <StaggerIn as="ul" className="mt-4 grid gap-3 sm:grid-cols-2">
                {league.seasons.map((season) => (
                  <li key={season.id}>
                    <Link to={seasonPath(league, season)} data-testid={`league-index-season-${season.slug}`}
                      className="tls-card tls-league-card group relative flex items-center gap-4 overflow-hidden border border-white/10 bg-[#121212] rounded-sm p-4">
                      {/* Das Banner der Season als leiser Grund der Karte - der Text bleibt lesbar. */}
                      {season.banner?.url ? (
                        <LazyImg src={season.banner.url} alt="" sizes="(min-width: 640px) 440px, 100vw" className="tls-league-card__banner"
                          style={{ objectPosition: bannerFocus(season.banner)["--league-focus-desktop"] }} />
                      ) : null}
                      {season.emblem_url && season.emblem_url !== league.emblem_url ? (
                        <LeagueEmblem src={season.emblem_url} size={40} className="relative" testId={`league-index-season-emblem-${season.slug}`} />
                      ) : null}
                      <span className="relative min-w-0 flex-1">
                        <span className="block font-heading text-xl font-bold uppercase">{season.name}</span>
                        <span className="block text-xs text-white/55">
                          {STATUS[season.status] || ""}{season.start_date ? ` · ab ${viennaDate(season.start_date, { day: "numeric", month: "numeric", year: "numeric" })}` : ""}
                        </span>
                      </span>
                      <ChevronRight className="tls-card__arrow relative h-4 w-4 shrink-0 text-white/35" aria-hidden="true" />
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
