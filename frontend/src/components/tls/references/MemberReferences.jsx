import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { CountUp } from "@/components/tls/motion/CountUp";
import { displayTitle, entryTitle, formatDate, gameTitle, shortTitle } from "@/components/tls/references/referenceParts";
import { Chevron, Mark, MedalMark, PlaceRing, SectionHead, medalTone } from "@/components/tls/references/overviewParts";
import { linkedSeasons, timelineGroups } from "@/lib/referencesOverview";
import { bestResult, detailsOf, fieldSize, memberPaths, monthOf, ownEntry, profileFacts, profileMedals } from "@/lib/memberReferences";
import { SEASON_NOTE_TONES } from "@/lib/seriesTiers";
import { SeriesLogo } from "@/components/tls/references/SeriesLogo";
import { seriesLogo } from "@/lib/seriesLogo";
import "@/components/tls/references/references.css";

// Vereinsplatzierungen im Mitgliederprofil (#859, neu im Referenzen-Design #1944) - ein Ausschnitt der Übersicht
// (#1878) für eine Person: oben nur Werte über null (die vorhandenen Medaillen, sonst „Bestes Ergebnis“; dazu
// Teilnahmen, Spiele, „seit“), darunter der Liga-Weg der Person je Spur (nur mit verknüpfter Saison) und die Chronik je
// Jahr als kompakte Liste. Jede Zeile zeigt den eigenen Platz, den kurzen Titel (der lange im Tooltip und in den
// Details), Spiel, Team mit „von N Teams“ und Datum; aufgeklappt Format, Aufstellung mit der Person hervorgehoben und
// die Links „Saison ansehen“, „Details“ (Bericht, Partner, Ort) und „Beim Veranstalter“. Es steht immer nur eine Zeile
// offen, zu Beginn die neueste. Die Logik steht in lib/memberReferences.js.

const CARD = "min-w-0 bg-surface-1 border border-white/[0.09] rounded-[10px] px-5 py-[18px] md:px-6 md:py-[22px]";

/** Die Spuren mit ihren Saisons (wie „Serien & Ligen“): nur nötig, wenn es Teilnahmen gibt. Ein Fehler blendet nur den Liga-Weg aus. */
function useLineages(enabled) {
  const [lineages, setLineages] = useState([]);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    api.get("/reference-series/public/lineages").then(({ data }) => {
      const list = Array.isArray(data?.items) ? data.items.filter((item) => item?.lineage?.slug && item?.seasons?.length) : [];
      if (alive) setLineages(list);
    }).catch(() => { if (alive) setLineages([]); });
    return () => { alive = false; };
  }, [enabled]);
  return lineages;
}

export function MemberReferences({ profile }) {
  const references = useMemo(() => profile.references || [], [profile.references]);
  const lineages = useLineages(references.length > 0);
  const linked = useMemo(() => linkedSeasons(lineages), [lineages]);
  const paths = useMemo(() => memberPaths(lineages, references), [lineages, references]);
  const groups = useMemo(() => timelineGroups(references), [references]);
  // `undefined`: noch nichts gewählt - offen steht die neueste Zeile; `null`: alle zu.
  const [chosen, setChosen] = useState(undefined);
  if (!references.length) return null;

  const openId = chosen === undefined ? groups[0]?.items[0]?.id || null : chosen;
  const medals = profileMedals(profile.reference_stats);
  const best = medals.length ? null : bestResult(references);
  const facts = profileFacts(references);
  const allLink = `/references?${new URLSearchParams({ member: profile.id, name: profile.gamertag || profile.display_name || "" })}`;

  return (
    <section className="mt-10 border-t border-white/10 pt-8 md:pt-12" aria-labelledby="member-references-title" data-testid="member-references">
      <SectionHead
        id="member-references-title"
        tone="honor"
        eyebrow="Referenzen"
        title="Vereinsplatzierungen"
        hint={(
          <Link to={allLink} data-testid="member-references-all" className="tls-btn tls-btn--quiet inline-flex items-center min-h-[44px] px-4 rounded text-[13px] font-bold uppercase tracking-[0.08em] no-underline">
            Alle Referenzen
          </Link>
        )}
      />

      {(medals.length > 0 || best || facts.length > 0) && (
        <div className="tls-ref-rise grid gap-3 md:gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))]" style={{ "--tls-ref-i": 0 }}>
          {medals.length > 0 && (
            <div className={`${CARD} flex flex-wrap items-center gap-y-3`} data-testid="member-reference-medals">
              {medals.map((medal, index) => <MedalCount key={medal.key} medal={medal} last={index === medals.length - 1} />)}
            </div>
          )}
          {best && <BestResult best={best} link={linked.get(best.item.id)} />}
          {facts.length > 0 && (
            <div className={`${CARD} flex flex-wrap items-center gap-x-8 gap-y-3`} data-testid="member-reference-facts">
              {facts.map((fact) => (
                <div key={fact.key} className="flex flex-col">
                  <span className="font-display font-bold text-[32px] md:text-4xl leading-none tabular-nums text-white">{fact.value}</span>
                  <span className="text-[13px] text-zinc-400">{fact.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {paths.length > 0 && (
        <div className="mt-3 md:mt-4 grid gap-3 md:gap-4" data-testid="member-paths">
          {paths.map((path) => <MemberPath key={path.lineage.slug} path={path} />)}
        </div>
      )}

      <div className="mt-6 md:mt-8" data-testid="member-references-chronicle">
        {groups.map((group) => (
          <div key={group.key || "none"} className="pt-5 md:pt-7" data-testid={`member-references-year-${group.key || "none"}`}>
            <div className="flex items-baseline gap-3.5 pb-2 md:pb-2.5">
              <h3 className="m-0 font-display font-bold leading-none tabular-nums text-[34px] md:text-[40px] text-white">{group.label}</h3>
              <span className="text-sm text-quiet">{group.items.length} {group.items.length === 1 ? "Teilnahme" : "Teilnahmen"}</span>
            </div>
            <ul className="list-none m-0 p-0 border-t border-white/10">
              {group.items.map((item) => (
                <ChronicleItem
                  key={item.id}
                  item={item}
                  link={linked.get(item.id)}
                  profileId={profile.id}
                  open={openId === item.id}
                  onToggle={() => setChosen(openId === item.id ? null : item.id)}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function MedalCount({ medal, last }) {
  const tone = medalTone(medal.placement);
  return (
    <div data-testid={`member-reference-medal-${medal.key}`} className={`flex items-center gap-3 ${last ? "" : "pr-4 mr-4 sm:pr-[22px] sm:mr-[22px] border-r border-white/[0.08]"}`}>
      <MedalMark placement={medal.placement} className="hidden sm:block w-[30px] h-[30px]" />
      <div className="flex flex-col">
        <span className={`font-display font-bold text-[40px] sm:text-[44px] leading-[0.9] tabular-nums ${tone.text}`}><CountUp value={Number(medal.count) || 0} /></span>
        <span className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-300">{medal.label}</span>
      </div>
    </div>
  );
}

function BestResult({ best, link }) {
  const title = shortTitle(best.item, link, { withSeason: false });
  const full = displayTitle(best.item);
  return (
    <div className={`${CARD} flex items-center gap-4`} data-testid="member-reference-best">
      <PlaceRing placement={best.placement} size="lg" />
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-400">Bestes Ergebnis</span>
        <span className="font-bold text-lg leading-snug text-white break-words [overflow-wrap:anywhere]" title={full !== title ? full : undefined}>{title}</span>
        <span className="text-sm text-quiet">{[monthOf(best.item), fieldSize(best.entry)].filter(Boolean).join(" · ")}</span>
      </div>
    </div>
  );
}

function stepResult(step) {
  if (step.place) return step.note ? `${step.place}. · ${step.note}` : `${step.place}. Platz`;
  return step.note || "–";
}

function MemberPath({ path }) {
  const { lineage, steps } = path;
  return (
    <div className={`tls-ref-rise ${CARD} flex flex-col gap-3.5`} style={{ "--tls-ref-i": 1 }} data-testid={`member-path-${lineage.slug}`}>
      <div className="flex flex-wrap justify-between items-center gap-2">
        {/* #2014: Logo der Spur (sonst der Saison, zu der der Weg führt) vor dem Namen - ohne Logo wie bisher. */}
        <span className="inline-flex items-center gap-2.5 min-w-0">
          <SeriesLogo src={seriesLogo(lineage, null) || path.target?.logo_url} size="xs" testId="member-path-logo" />
          <span className="text-xs font-bold uppercase tracking-[0.22em] text-zinc-400 break-words [overflow-wrap:anywhere]">Liga-Weg · {lineage.title}</span>
        </span>
        {path.address && <Link to={path.address} className="text-sm font-semibold text-brand hover:text-white no-underline transition-colors duration-fast">Zur Serie</Link>}
      </div>
      {/* Am Handy eine Reihe zum Wischen (wie in der App), breit umbrechend mit Pfeilen. */}
      <ol className="tls-ref-scroll tls-ref-snap list-none m-0 p-0 flex items-stretch gap-2 tls-swipe tls-swipe--room sm:flex-wrap sm:overflow-visible sm:[mask-image:none] sm:[-webkit-mask-image:none]" aria-label={`Liga-Weg ${lineage.title}`}>
        {steps.map((step, index) => (
          <li key={step.season_slug || `${step.season}-${step.tier}`} className="shrink-0 sm:shrink flex items-center gap-2 min-w-0">
            <span
              data-testid="member-path-step"
              data-note={step.note || undefined}
              aria-current={step.current ? "step" : undefined}
              className={`min-w-[112px] sm:min-w-[128px] max-w-full flex flex-col gap-0.5 px-3 sm:px-3.5 py-2.5 rounded-md bg-surface-2 border ${step.note === "Aufstieg" ? "border-ok/35" : "border-white/10"}`}
            >
              <span className="text-xs text-quiet break-words [overflow-wrap:anywhere]">{step.season}</span>
              <span className="font-bold text-[15px] text-white break-words [overflow-wrap:anywhere]">{step.tier || (lineage.kind === "team_league" ? "Liga" : "Gesamt")}</span>
              <span className={`text-[13px] font-semibold ${SEASON_NOTE_TONES[step.note] || "text-zinc-400"}`}>{stepResult(step)}</span>
            </span>
            {index < steps.length - 1 && (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" className="hidden sm:block shrink-0 text-zinc-600">
                <path d="M5 9h8M10 5l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function ChronicleItem({ item, link, profileId, open, onToggle }) {
  const entry = ownEntry(item);
  const placement = Number(entry?.placement) || null;
  const title = shortTitle(item, link);
  const full = displayTitle(item);
  const team = entry ? (entry.kind === "solo" ? "Einzelstarter" : entryTitle(entry)) : "";
  const size = fieldSize(entry);
  const game = gameTitle(item);
  const date = formatDate(item.start_date) || formatDate(item.end_date);
  const panelId = `member-reference-details-${item.id}`;
  return (
    <li className="border-b border-white/[0.07]" data-testid={`member-reference-${item.id}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={panelId} data-testid={`member-reference-row-${item.id}`} className="tls-ref-row w-full flex items-start sm:items-center sm:flex-wrap gap-3 sm:gap-x-5 sm:gap-y-2.5 py-3.5 sm:py-4 sm:px-2 text-left text-white bg-transparent border-0 cursor-pointer">
        <PlaceRing placement={placement} />
        <span className="flex-1 sm:flex-[1_1_300px] min-w-0 flex flex-col gap-0.5">
          <span data-testid="member-reference-title" title={full !== title ? full : undefined} className="font-bold text-base sm:text-[17px] leading-[1.3] break-words [overflow-wrap:anywhere]">{title}</span>
          {/* #2014: Logo der Saison bzw. Spur wie in der Chronik der Übersicht. */}
          <SeriesLogo src={seriesLogo(link?.lineage, link?.season)} size="xs" className="mt-0.5" testId="member-reference-logo" />
          <span className="sm:hidden text-[13px] text-zinc-400 break-words">{[game, date].filter(Boolean).join(" · ")}</span>
          <span className="hidden sm:block text-sm text-zinc-400 break-words">{game}</span>
          <span className="sm:hidden text-[13px] text-zinc-300 break-words [overflow-wrap:anywhere]">{[team, size].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="hidden sm:flex sm:flex-[1_1_220px] min-w-0 flex-col gap-0.5">
          <span className="text-sm text-zinc-200 break-words [overflow-wrap:anywhere]">{team}</span>
          {size && <span className="text-[13px] text-quiet">{size}</span>}
        </span>
        <span className="hidden sm:block sm:flex-[0_0_96px] text-sm text-quiet tabular-nums">{date}</span>
        <Chevron down className="tls-ref-chev mt-[11px] sm:mt-0" />
      </button>
      {open && <Details id={panelId} itemId={item.id} details={detailsOf(item, profileId, link)} />}
    </li>
  );
}

function Details({ id, itemId, details }) {
  const blocks = [];
  if (details.fullTitle) {
    blocks.push(<p key="title" className="m-0 text-sm text-zinc-300 break-words [overflow-wrap:anywhere]">{details.fullTitle}</p>);
  }
  if (details.tags.length) {
    blocks.push(<div key="tags" className="flex flex-wrap gap-1.5">{details.tags.map((tag) => <Mark key={tag}>{tag}</Mark>)}</div>);
  }
  // Einsätze der Person aus der Saison (#1931): „Aufstellung · 5 von 7 Spielen“, ohne Aufstellung als eigene Zeile.
  if (details.lineup.length) {
    blocks.push(
      <div key="lineup" className="flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-400" data-testid={`member-reference-lineup-${itemId}`}>
          Aufstellung{details.played && <span className="text-zinc-300"> · {details.played}</span>}
        </span>
        <ul className="list-none m-0 p-0 flex flex-wrap gap-1.5" aria-label="Aufstellung">
          {details.lineup.map((person) => <li key={person.key} className="max-w-full"><Person person={person} /></li>)}
        </ul>
      </div>,
    );
  } else if (details.played) {
    blocks.push(
      <p key="played" className="m-0 text-xs font-bold uppercase tracking-[0.18em] text-zinc-400" data-testid={`member-reference-played-${itemId}`}>
        Einsätze<span className="text-zinc-300"> · {details.played}</span>
      </p>,
    );
  }
  // Links: Saison ansehen (nur mit Saison), Details zur Referenz (Bericht, Partner, Ort), Beim Veranstalter.
  const button = "tls-btn inline-flex items-center min-h-[40px] px-3.5 rounded text-sm font-bold no-underline";
  blocks.push(
    <div key="links" className="flex flex-wrap gap-2.5" data-testid={`member-reference-links-${itemId}`}>
      {details.seasonUrl && <Link to={details.seasonUrl} className={`${button} tls-btn--primary`}>Saison ansehen</Link>}
      <Link to={details.detailUrl} className={`${button} tls-btn--quiet`}>Details</Link>
      {details.organizerUrl && <a href={details.organizerUrl} target="_blank" rel="noreferrer" className={`${button} tls-btn--quiet`}>Beim Veranstalter</a>}
    </div>,
  );
  return (
    <div id={id} data-testid={id} className="tls-ref-open pl-[52px] sm:pl-[72px] pr-2 pt-1 pb-5 flex flex-col gap-3.5">
      {blocks.map((block, index) => <div key={block.key} style={{ "--tls-ref-i": index }} className="min-w-0">{block}</div>)}
    </div>
  );
}

function Person({ person }) {
  const base = "inline-flex items-center max-w-full px-2.5 py-1 rounded-full border text-sm break-words [overflow-wrap:anywhere]";
  const tone = person.self ? "border-brand bg-brand/[0.12] text-white font-bold" : "border-white/[0.12] bg-surface-2 text-zinc-300 font-medium";
  if (person.url && !person.self) {
    return (
      <Link to={person.url} data-testid="member-reference-person" data-self="false" className={`${base} ${tone} no-underline hover:border-brand/60 hover:text-white transition-colors duration-fast`}>
        {person.name}
      </Link>
    );
  }
  return <span data-testid="member-reference-person" data-self={String(person.self)} className={`${base} ${tone}`}>{person.name}</span>;
}
