// Season-Übersicht (docs/LIGA.md, P5 #1625, #2268) unter /liga/<liga>/<season>: Kopf mit Banner, Emblem und Eckdaten, dann was
// gespielt wird (Format, Modi mit Symbol und Regel, Map-Reihenfolge), Anmeldung, Map-Pool mit Bildern (am Handy wischbar),
// Sperrliste (aufklappbar), Ablauf mit Terminregeln und Punkten, Regelwerk und je Liga N die Staffeln mit Tabelle und aktuellem
// Spieltag - vor der Einteilung ein freundlicher Platzhalter. Läuft die Season, stehen die Tabellen gleich nach „Was gespielt
// wird“. Spieltage und Teams sind Unterseiten (SeasonShell). Sichtbar nach der Season (Lese-API) - unsichtbar heißt „gibt es nicht“.
import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { Map as MapIcon, ScrollText } from "lucide-react";
import { MapPoolView } from "@/components/tls/maps/MapPoolView";
import { AllowedEquipmentView } from "@/components/tls/league/AllowedEquipmentView";
import { LeaguePrizes } from "@/components/tls/league/public/LeagueLook";
import { LeagueApplicationPanel } from "@/components/tls/league/application/LeagueApplicationPanel";
import { SeasonShell } from "@/components/tls/league/public/SeasonShell";
import {
  Division,
  SeasonBans,
  SeasonFlow,
  SeasonHeadFacts,
  SeasonPlaceholder,
  SeasonPlay,
  SeasonRulesCard,
} from "@/components/tls/league/public/SeasonParts";
import { renderMarkdownLite } from "@/lib/markdownLite";
import { dayNoon, viennaDate } from "@/lib/vienna";
import { mapOrder } from "@/lib/leagueSeasonPage";

function Head({ data }) {
  const { season } = data;
  return (
    <>
      {/* Mit Selbstanmeldung (#2205) steht das Fenster unten - jede Angabe nur an einer Stelle. */}
      {season.registration_deadline && !data.application ? (
        <p className="mt-3 text-sm text-white/60" data-testid="league-subline">
          Meldeschluss {viennaDate(dayNoon(season.registration_deadline), { day: "numeric", month: "numeric", year: "numeric" })}
        </p>
      ) : null}
      <SeasonHeadFacts season={season} />
    </>
  );
}

function Divisions({ data, hash, order }) {
  const { league, season } = data;
  const divisions = data.divisions || [];
  if (!divisions.length) return <SeasonPlaceholder season={season} application={data.application} />;
  const topLevel = Math.min(...divisions.map((division) => Number(division.level) || 1));
  return divisions.map((division) => (
    <Division key={division.id} division={division} leagueSlug={league.slug} seasonSlug={season.slug} hash={hash}
      topLevel={(Number(division.level) || 1) === topLevel} order={order} />
  ));
}

function Overview({ data }) {
  const { hash } = useLocation();
  const { league, season } = data;
  const rules = useMemo(() => (season?.rules_text ? renderMarkdownLite(season.rules_text) : ""), [season?.rules_text]);
  const order = useMemo(() => mapOrder(season, league?.game, data.map_pool), [season, league, data.map_pool]);
  const divisions = data.divisions || [];
  // Läuft eine Staffel, sind die Tabellen das Wichtigste - sie rücken nach oben.
  const running = divisions.some((division) => (division.staffeln || []).some((row) => row.status && row.status !== "draft"));
  return (
    <>
      {data.application ? <LeagueApplicationPanel leagueSlug={league.slug} seasonSlug={season.slug} block={data.application} /> : null}

      <SeasonPlay league={league} season={season} pool={data.map_pool} platform={data.platform} />

      <LeaguePrizes prizes={data.prizes}
        hint={divisions.some((division) => division.prizes?.length) ? "Ligen mit eigenen Gewinnen nennen sie bei ihrer Tabelle." : undefined} />

      {running ? <Divisions data={data} hash={hash} order={order} /> : null}

      <MapPoolView pool={data.map_pool} title="Map-Pool" hint="Diese Maps sind in der Season erlaubt – je Modus." icon={MapIcon}
        className="tls-season-section" testId="league-map-pool" headingClass="flex items-center gap-2 font-heading text-2xl font-black uppercase md:text-3xl" swipe />

      <SeasonBans list={data.loadout_bans} rulesUrl={data.rules?.url} />
      {/* Erlaubte Ausrüstung (#2287, Nr. 99): dieselbe Sicht wie das Regelwerk - aktive Bibliothek ohne die Sperrliste der Season,
          ohne Bibliothek kein Block. */}
      <AllowedEquipmentView data={data.allowed_equipment} testId="league-allowed-equipment" />

      <SeasonFlow season={season} />

      {/* Regelwerk (#1646): eigene Seite mit Version und Stand; ohne Regelwerk bleibt der Regeltext wie bisher. */}
      {data.rules ? <SeasonRulesCard rules={data.rules} /> : rules ? (
        <details className="tls-league-rules mt-14 border border-white/10 bg-[#121212] rounded-sm" data-testid="league-rules">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 font-heading text-lg font-bold uppercase">
            <ScrollText className="h-4 w-4 tls-league-accent" aria-hidden="true" /> Regeln
          </summary>
          {/* renderMarkdownLite maskiert HTML und baut nur sichere Elemente - wie Turnier- und Eventtexte. */}
          <div className="prose-cms px-4 pb-5 text-sm" dangerouslySetInnerHTML={{ __html: rules }} />
        </details>
      ) : null}

      {running ? null : <Divisions data={data} hash={hash} order={order} />}
    </>
  );
}

export default function LeagueSeasonPage() {
  return (
    <SeasonShell head={(data) => <Head data={data} />}>
      {(data) => <Overview data={data} />}
    </SeasonShell>
  );
}
