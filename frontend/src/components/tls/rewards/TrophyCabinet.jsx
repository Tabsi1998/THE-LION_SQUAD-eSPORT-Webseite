import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Filter, RotateCcw } from "lucide-react";
import { motionAllowed } from "@/lib/motion";
import { resolveMediaUrl } from "@/lib/api";
import {
  ALL, EMBLEM_LIMIT, NO_FILTER, activeFilters, competitionLine, filterTrophies, fitsEmblem, kindLabel, sortTrophies,
  toggleEmblem, trophyDate, trophyFacets, trophyHref, trophyKind, trophyName,
} from "@/lib/trophies";
import { TrophyCup } from "@/components/tls/TrophyShelf";
import { RewardArt } from "./RewardArt";
import "./rewards.css";

// Reiter „Trophäen“ (#2425, Nr. 59) an Profil und Team: Turnier-Pokale und Liga-Belohnungen in einer Vitrine - Karten mit Bild, Name,
// Wettbewerb, Platz, Datum und Link, darüber Filter nach Art, Spiel, Season bzw. Jahr und Platz. Wer die Vitrine besitzt (eigenes
// Profil, Teamleitung), wählt hier das Banner oben, den Titel und bis zu drei Embleme neben dem Namen (Nr. 34c).
//
// Bewegung (Detail-Runde): Beim Öffnen des Reiters steigen die Karten gestaffelt auf, der Glanz der Belohnung zieht einmal nach und
// die Kante leuchtet kurz - beim Filtern nicht mehr (das passiert oft). „Bewegung reduzieren“: alles steht (rewards.css).

const METAL_BY_RANK = { 1: "gold", 2: "silver", 3: "bronze" };
const STAGGER_CAP = 10;

function metalOf(award) {
  return award?.reward?.art?.metal || METAL_BY_RANK[Number(award?.rank)] || "lion";
}

/** Das Bild der Karte: die Belohnung, sonst der Pokal (oder das hochgeladene Bild des Turniers), sonst ein Banner mit dem Platz. */
function TrophyArt({ award, play, index }) {
  if (award.reward) return <RewardArt reward={award.reward} size="md" play={play} index={index} testId={`trophy-art-${award.id}`} />;
  const medal = METAL_BY_RANK[Number(award.rank)];
  if (award.image_url) {
    return <img src={resolveMediaUrl(award.image_url)} alt="" loading="lazy" className="tls-trophy-card__image" data-testid={`trophy-art-${award.id}`} />;
  }
  if (medal) return <TrophyCup medal={medal} className="tls-trophy-card__cup" testId={`trophy-art-${award.id}`} />;
  return <RewardArt reward={{ kind: "banner", name: trophyName(award), art: { place: award.rank_label, metal: "lion" } }} size="md" play={play}
    index={index} testId={`trophy-art-${award.id}`} />;
}

function Choice({ pressed, onClick, disabled = false, title, testId, children }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={pressed} title={title} data-testid={testId}
      className="tls-trophy-card__choice" data-pressed={pressed ? "true" : undefined}>
      {children}
    </button>
  );
}

function TrophyCard({ award, index, play, owner }) {
  const href = trophyHref(award);
  const date = trophyDate(award);
  const kind = trophyKind(award);
  const featured = owner?.featuredId === award.id;
  const titled = owner?.titleId === award.id;
  const emblemAt = (owner?.emblemIds || []).indexOf(award.id);
  const emblemFull = (owner?.emblemIds || []).length >= EMBLEM_LIMIT;
  const body = (
    <>
      <span className="tls-trophy-card__art"><TrophyArt award={award} play={play} index={Math.min(index, STAGGER_CAP)} /></span>
      <span className="tls-reward-card__kind">{kindLabel(award)}</span>
      <span className="tls-reward-card__name" data-testid={`trophy-name-${award.id}`}>{trophyName(award)}</span>
      {competitionLine(award) ? <span className="tls-reward-card__meta" data-testid={`trophy-competition-${award.id}`}>{competitionLine(award)}</span> : null}
      <span className="tls-trophy-card__place" data-testid={`trophy-place-${award.id}`}>{award.rank_label}</span>
      {award.team?.name ? <span className="tls-reward-card__meta">{award.team.name}</span> : null}
      {date ? (
        <span className="tls-trophy-card__date"><CalendarDays className="h-3 w-3" aria-hidden="true" /><time dateTime={String(award.date)}>{date}</time></span>
      ) : null}
    </>
  );
  return (
    <li className="tls-reward-card tls-trophy-card" data-metal={metalOf(award)} data-kind={kind} data-play={play || undefined}
      data-featured={featured || titled || emblemAt >= 0 ? "true" : undefined} style={{ "--tls-i": Math.min(index, STAGGER_CAP) }}
      data-testid={`trophy-card-${award.id}`}>
      {href ? <Link to={href} className="tls-trophy-card__link" aria-label={`${trophyName(award)} – ${award.rank_label} – zum Wettbewerb`}>{body}</Link> : body}
      {owner ? (
        <div className="tls-reward-card__actions">
          {owner.onFeature ? (
            <Choice pressed={featured} onClick={() => owner.onFeature(featured ? null : award.id)} testId={`trophy-banner-${award.id}`}>
              {featured ? "Banner ✓" : "Als Banner"}
            </Choice>
          ) : null}
          {owner.onTitle && kind === "title" && award.reward ? (
            <Choice pressed={titled} onClick={() => owner.onTitle(titled ? null : award.id)} testId={`trophy-title-${award.id}`}>
              {titled ? "Titel ✓" : "Als Titel"}
            </Choice>
          ) : null}
          {owner.onEmblems && fitsEmblem(award) ? (
            <Choice pressed={emblemAt >= 0} disabled={emblemAt < 0 && emblemFull}
              title={emblemAt < 0 && emblemFull ? `Höchstens ${EMBLEM_LIMIT} Embleme – nimm zuerst eines weg.` : undefined}
              onClick={() => { const next = toggleEmblem(owner.emblemIds, award.id); if (next) owner.onEmblems(next); }}
              testId={`trophy-emblem-${award.id}`}>
              {emblemAt >= 0 ? `Emblem ${emblemAt + 1} ✓` : "Neben den Namen"}
            </Choice>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Select({ label, value, options, onChange, testId }) {
  return (
    <label className="tls-trophy-filters__select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} data-testid={testId}>
        <option value={ALL}>Alle</option>
        {options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
      </select>
    </label>
  );
}

/**
 * Die Vitrine. `awards`: alle Auszeichnungen (Turnier und Liga). `owner` (eigenes Profil, Teamleitung): `{featuredId, titleId,
 * emblemIds, onFeature, onTitle, onEmblems, emblemHint}`. `empty`: der Satz ohne jede Trophäe.
 */
export function TrophyCabinet({ awards, owner = null, empty, testId = "trophy-cabinet", animate = true }) {
  const [filters, setFilters] = useState(NO_FILTER);
  const [play, setPlay] = useState(() => (animate && motionAllowed() ? "run" : undefined));
  const all = useMemo(() => sortTrophies(awards), [awards]);
  const facets = useMemo(() => trophyFacets(all), [all]);
  const shown = useMemo(() => filterTrophies(all, filters), [all, filters]);
  const set = (key, value) => {
    setPlay(undefined);
    setFilters((current) => ({ ...current, [key]: value }));
  };
  const reset = () => {
    setPlay(undefined);
    setFilters(NO_FILTER);
  };
  if (!all.length) {
    return <p className="tls-trophy-empty" data-testid={`${testId}-empty`}>{empty}</p>;
  }
  const chips = [[ALL, "Alle"], ...facets.kinds];
  const emblemCount = (owner?.emblemIds || []).length;
  const hasEmblems = all.some(fitsEmblem);
  return (
    <div className="tls-trophy-cabinet" data-testid={testId}>
      <div className="tls-trophy-filters" role="group" aria-label="Trophäen filtern" data-testid={`${testId}-filters`}>
        {facets.kinds.length > 1 ? (
          <div className="tls-trophy-filters__kinds tls-swipe" data-testid={`${testId}-kinds`}>
            {chips.map(([key, label]) => (
              <button key={key || "all"} type="button" aria-pressed={filters.kind === key} onClick={() => set("kind", key)}
                className="tls-trophy-filters__chip" data-testid={`${testId}-kind-${key || "all"}`}>{label}</button>
            ))}
          </div>
        ) : null}
        <div className="tls-trophy-filters__row">
          {facets.games.length > 1 ? (
            <Select label="Spiel" value={filters.game} options={facets.games.map((game) => [game, game])} onChange={(value) => set("game", value)}
              testId={`${testId}-game`} />
          ) : null}
          {facets.periods.length > 1 ? (
            <Select label="Season / Jahr" value={filters.period} options={facets.periods.map((period) => [period, period])}
              onChange={(value) => set("period", value)} testId={`${testId}-period`} />
          ) : null}
          {facets.places.length > 1 ? (
            <Select label="Platz" value={filters.place} options={facets.places} onChange={(value) => set("place", value)} testId={`${testId}-place`} />
          ) : null}
          <span className="tls-trophy-filters__count" aria-live="polite" data-testid={`${testId}-count`}>
            {shown.length === all.length ? `${all.length} ${all.length === 1 ? "Trophäe" : "Trophäen"}` : `${shown.length} von ${all.length}`}
          </span>
          {activeFilters(filters) ? (
            <button type="button" onClick={reset} className="tls-trophy-filters__reset" data-testid={`${testId}-reset`}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Zurücksetzen
            </button>
          ) : null}
        </div>
      </div>
      {owner?.onEmblems && hasEmblems ? (
        <p className="tls-trophy-hint" data-testid={`${testId}-emblem-hint`}>
          {owner.emblemHint || "Bis zu drei Embleme oder Medaillen stehen neben dem Namen."} {emblemCount} von {EMBLEM_LIMIT} gewählt.
        </p>
      ) : null}
      {shown.length ? (
        <ul className="tls-trophy-cabinet__grid">
          {shown.map((award, index) => <TrophyCard key={award.id} award={award} index={index} play={play} owner={owner} />)}
        </ul>
      ) : (
        <div className="tls-trophy-empty" data-testid={`${testId}-no-match`}>
          <Filter className="mx-auto mb-2 h-5 w-5 opacity-60" aria-hidden="true" />
          Keine Trophäe passt zu diesem Filter.
          <button type="button" onClick={reset} className="tls-trophy-filters__reset mx-auto mt-3">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Filter zurücksetzen
          </button>
        </div>
      )}
    </div>
  );
}

/** Bis zu drei Embleme neben dem Namen - klein, mit Namen als Hinweis; ohne Wahl nichts. */
export function EmblemRow({ emblems, testId = "featured-emblems" }) {
  const list = (Array.isArray(emblems) ? emblems : []).filter((award) => award?.reward).slice(0, EMBLEM_LIMIT);
  if (!list.length) return null;
  const names = list.map((award) => award.reward.name).join(", ");
  return (
    <span className="tls-emblem-row" role="img" aria-label={`Embleme: ${names}`} data-testid={testId}>
      {list.map((award, index) => (
        <span key={award.id} className="tls-emblem-row__item" title={award.rank_label ? `${award.reward.name} · ${award.rank_label}` : award.reward.name}
          style={{ "--tls-i": index }} data-testid={`${testId}-${award.id}`}>
          <RewardArt reward={award.reward} size="xs" labelled={false} />
        </span>
      ))}
    </span>
  );
}

