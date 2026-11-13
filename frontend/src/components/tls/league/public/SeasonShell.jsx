// Rahmen der öffentlichen Season-Seite (#2268): lädt die Season einmal (GET /api/leagues/<liga>/<season>), zeigt Kopf und die
// Navigation Übersicht · Spieltage · Teams · Regelwerk und gibt die Daten an die Unterseite. Unsichtbar heißt wie „gibt es
// nicht“ - dieselbe Regel wie die Lese-API. Die Akzentfarbe der Liga gilt für die ganze Seite (#2107).
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { SkeletonDetailHeader } from "@/components/tls/Skeleton";
import { LeagueEmblem, LeagueHead } from "@/components/tls/league/public/LeagueLook";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { accentStyle } from "@/lib/leagueLook";
import { SEASON_SECTIONS, sectionPath } from "@/lib/leagueSeasonPage";
import "./league.css";
import "./season.css";

/** Die Season laden - `missing`, wenn die API sie der Person nicht zeigt (404); `failed` bei Netz- oder Serverfehlern (#2268) - dann
 *  ist die Season nicht „nicht gefunden“, sondern gerade nicht erreichbar. */
export function useLeagueSeason(leagueSlug, seasonSlug) {
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    try {
      const { data: body } = await api.get(`/leagues/${leagueSlug}/${seasonSlug}`);
      setData(body);
      setMissing(false);
    } catch (err) {
      if (err?.response?.status === 404) setMissing(true);
      else setFailed(true);
    }
  }, [leagueSlug, seasonSlug]);
  useEffect(() => { load(); }, [load]);
  return { data, missing, failed, reload: load };
}

/**
 * Navigation zwischen Übersicht und Unterseiten. `hasRules`: ohne Regelwerk fehlt der Punkt (der Regeltext steht dann auf der
 * Übersicht). Am Handy wischbar; der aktive Punkt zeichnet seine Linie nach.
 */
export function SeasonNav({ leagueSlug, seasonSlug, hasRules = true, className = "" }) {
  const sections = SEASON_SECTIONS.filter((row) => row.key !== "regeln" || hasRules);
  // Steht rechts noch etwas über (Handy), blendet der Rand aus - der Hinweis, dass man wischen kann (#2268). Am Ende verschwindet er.
  const list = useRef(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const node = list.current;
    if (!node) return undefined;
    const check = () => setMore(node.scrollLeft + node.clientWidth < node.scrollWidth - 2);
    check();
    node.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      node.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);
  return (
    <nav aria-label="Season" className={`tls-season-nav ${className}`} data-more={more ? "true" : undefined} data-testid="season-nav">
      <ul ref={list} className="tls-season-nav__list tls-swipe">
        {sections.map((row) => (
          <li key={row.key || "start"}>
            <NavLink end to={sectionPath(leagueSlug, seasonSlug, row.key)} className="tls-season-nav__link"
              data-testid={`season-nav-${row.key || "start"}`}>
              {row.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Kompakter Kopf der Unterseiten: Emblem, Liga und Season, darunter der Name der Unterseite. */
function CompactHead({ look, league, season, title }) {
  return (
    <header className="tls-season-compact" data-testid="season-compact-head">
      <LeagueEmblem src={look?.emblem_url} size={56} />
      <div className="min-w-0">
        <p className="tls-league-head__eyebrow">
          <Link to={sectionPath(league.slug, season.slug)} className="hover:text-white">{league.name} {season.name}</Link>
        </p>
        <h1 className="font-heading text-3xl font-black uppercase leading-none md:text-5xl">{title}</h1>
      </div>
    </header>
  );
}

/**
 * Eine Seite der Season. `section`: Schlüssel aus SEASON_SECTIONS; `head(data)`: Inhalt unter dem großen Kopf (nur Übersicht);
 * `children(data)`: der Inhalt.
 */
export function SeasonShell({ section = "", head, children }) {
  const { league: leagueSlug, season: seasonSlug } = useParams();
  const { data, missing, failed, reload } = useLeagueSeason(leagueSlug, seasonSlug);
  const league = data?.league;
  const season = data?.season;
  const current = SEASON_SECTIONS.find((row) => row.key === section) || SEASON_SECTIONS[0];
  const name = league && season ? `${league.name} ${season.name}` : "Liga";
  const title = section ? `${current.label} · ${name}` : name;
  const description = {
    "": `${name}: was gespielt wird, Map-Pool, Ablauf, Tabellen und der aktuelle Spieltag.`,
    spieltage: `${name}: Spielplan Woche für Woche mit Ergebnissen, Maps und Modi.`,
    teams: `${name}: alle Teams der Season nach Liga und Staffel.`,
  }[section] || name;
  useDocumentTitle(title, description, {
    canonical: league && season ? `${window.location.origin}${sectionPath(league.slug, season.slug, section)}` : undefined,
  });

  if (missing) {
    return (
      <PublicLayout>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-20 text-center" data-testid="league-missing">
          <h1 className="font-heading text-3xl font-black uppercase">Liga nicht gefunden</h1>
          <p className="mt-3 text-white/60">Diese Season gibt es nicht oder sie ist (noch) nicht sichtbar.</p>
          <Link to="/liga" className="tls-btn tls-btn--secondary mt-6 inline-flex rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider">Zur Liga-Übersicht</Link>
        </div>
      </PublicLayout>
    );
  }
  if (failed && !data) {
    return (
      <PublicLayout>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-20 text-center" role="alert" data-testid="league-load-failed">
          <h1 className="font-heading text-3xl font-black uppercase">Liga gerade nicht erreichbar</h1>
          <p className="mt-3 text-white/60">Die Seite konnte nicht geladen werden – meist hilft es, es gleich noch einmal zu versuchen.</p>
          <button type="button" onClick={reload} data-testid="league-load-retry"
            className="tls-btn tls-btn--secondary mt-6 inline-flex min-h-[44px] items-center rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider">
            Nochmal laden
          </button>
        </div>
      </PublicLayout>
    );
  }
  if (!data) {
    return (
      <PublicLayout>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12"><SkeletonDetailHeader label="Lade Liga" /></div>
      </PublicLayout>
    );
  }
  const crumbs = [{ label: "Start", to: "/" }, { label: "Liga", to: "/liga" },
    ...(section ? [{ label: name, to: sectionPath(league.slug, season.slug) }, { label: current.label }] : [{ label: name }])];
  return (
    <PublicLayout>
      <div className="tls-league-look tls-season max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-12" style={accentStyle(data.look?.accent_color)}>
        <Breadcrumbs items={crumbs} className="mb-3" />
        {section ? (
          <CompactHead look={data.look} league={league} season={season} title={current.label} />
        ) : (
          <LeagueHead look={data.look} eyebrow={league.game?.name} title={<>{league.name} <span className="text-white/55">{season.name}</span></>}>
            {head ? head(data) : null}
          </LeagueHead>
        )}
        <SeasonNav leagueSlug={league.slug} seasonSlug={season.slug} hasRules={Boolean(data.rules)} className="mt-8" />
        {children(data)}
      </div>
    </PublicLayout>
  );
}
