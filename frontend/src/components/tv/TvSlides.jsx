import { SmartLogo } from "@/components/tls/SmartLogo";
import { resolveMediaUrl } from "@/lib/api";
import { describeSlot, finderFor } from "@/lib/slotSource";
import { formatBracketSection, formatRoundName } from "@/lib/tournamentLabels";
import { matchName } from "@/lib/tvLive";
import { TvFace } from "./TvParts";
import { TvLineup } from "./TvStartGrid";
import { TvSpotlight, useSecondTick } from "./TvTreeNode";
import { useTv } from "./TvScreen";

// Die Folien der Wiedergabeliste (#1121) neben dem Turnierbaum: Live-Spiele als Startaufstellung mit Station und
// Spielzeit (#1116, #1120), die Zahlen zwischendurch (#1124), der Sponsor-Moment (#1125) - und der dünne Balken, der
// zeigt, wann gewechselt wird. Gestaltet wie in der TV-Vorschau; alle Größen aus tv.css, nie „…“.

/**
 * Der dünne Balken oben: wie viel von der Folie schon gelaufen ist. `clock.current` sagt, seit wann sie läuft
 * (`startedAt`, pausiert `null`) und wie viel vor einer Pause schon lief (`elapsed`). Mit Bewegung gleitet er, sonst
 * springt er je Sekunde.
 */
export function TvSlideBar({ clock, totalMs, paused = false, testId = "tv-slide-bar" }) {
  useSecondTick();
  if (!totalMs) return null;
  const state = clock?.current || { startedAt: null, elapsed: 0 };
  const running = state.startedAt === null ? 0 : Math.max(0, Date.now() - state.startedAt);
  const share = Math.min(1, (state.elapsed + running) / totalMs);
  return (
    <div className="tv-slidebar" role="presentation" data-testid={testId} data-paused={paused ? "1" : undefined} data-total={totalMs}>
      <i style={{ width: `${(share * 100).toFixed(2)}%` }} />
    </div>
  );
}

function liveTitle(match) {
  return [formatBracketSection(match.section), formatRoundName(match.round_name, match.round)].filter(Boolean).join(" · ");
}

/** Ein laufendes Spiel: Kopf mit Station und Spielzeit, darunter die Startaufstellung oder „A gegen B“. */
function LiveMatch({ match, matches, nameOf, avatarOf, lastStage, isTable, compact }) {
  return (
    <article className={`tv-live-card ${compact ? "tv-live-card--compact" : ""}`} data-testid={`tv-live-${match.id}`}>
      <header className="tv-live-card__head">
        <div className="min-w-0">
          <div className="tv-kicker tv-t-meta">{liveTitle(match)}</div>
          <div className="tv-t-head font-heading font-black uppercase">{matchName(match)}</div>
        </div>
        <TvSpotlight match={match} className="tv-live-card__spot" />
      </header>
      <div className="tv-live-card__body">
        <TvLineup match={match} matches={matches} nameOf={nameOf} avatarOf={avatarOf} lastStage={lastStage(match)} table={isTable(match)} />
      </div>
    </article>
  );
}

/** Ab fünf laufenden Spielen: eine ruhige Liste - Spiel, Station und Spielzeit, die Namen. */
function LiveRow({ match, matches, nameOf }) {
  const findMatch = finderFor(matches)(match);
  const names = (match.slots || []).map((slot) => describeSlot(slot, nameOf, findMatch).label).filter(Boolean);
  return (
    <div className="tv-live-row" data-testid={`tv-live-${match.id}`}>
      <div className="min-w-0">
        <div className="tv-kicker tv-t-meta">{liveTitle(match)}</div>
        <div className="tv-t-head font-heading font-black uppercase">{matchName(match)}</div>
      </div>
      <div className="tv-t-name min-w-0" data-tv-name="1">{names.join(" · ")}</div>
      <TvSpotlight match={match} className="tv-live-row__spot" />
    </div>
  );
}

/**
 * Live-Spiele (#1121): bis vier laufende Durchgänge als Startaufstellung, mehr als ruhige Liste. Ohne laufendes Spiel
 * (Link mit nur dieser Folie) steht „Gerade läuft kein Spiel“.
 */
export function TvLiveSlide({ live = [], matches = [], nameOf, avatarOf = () => "", lastStage = () => true, isTable = () => false }) {
  if (!live.length) {
    return (
      <section className="tv-slide-live tv-slide-live--empty" data-testid="tv-live-slide" data-count="0">
        <div className="tv-t-title font-heading font-black uppercase">Gerade läuft kein Spiel</div>
        <div className="tv-t-info tv-muted">Sobald die Turnierleitung ein Spiel startet, steht es hier – mit Station und Spielzeit.</div>
      </section>
    );
  }
  if (live.length > 4) {
    return (
      <section className="tv-slide-live tv-slide-live--list" data-testid="tv-live-slide" data-count={live.length}>
        {live.map((match) => <LiveRow key={match.id} match={match} matches={matches} nameOf={nameOf} />)}
      </section>
    );
  }
  return (
    <section className={`tv-slide-live tv-slide-live--${live.length}`} data-testid="tv-live-slide" data-count={live.length}>
      {live.map((match) => (
        <LiveMatch key={match.id} match={match} matches={matches} nameOf={nameOf} avatarOf={avatarOf} lastStage={lastStage} isTable={isTable} compact={live.length > 2} />
      ))}
    </section>
  );
}

/** Der Ring „14 von 27“ - mit Bewegung füllt er sich einmal, ohne steht er sofort. */
function PlayedRing({ played, total }) {
  const { motionOn } = useTv();
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const share = total ? Math.min(1, played / total) : 0;
  return (
    <div className="tv-stat__ring" data-motion={motionOn ? "1" : "0"}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="tv-stat__ring-bg" cx="50" cy="50" r={radius} />
        <circle className="tv-stat__ring-fg" cx="50" cy="50" r={radius} style={{ strokeDasharray: circumference, strokeDashoffset: circumference * (1 - share), "--tv-ring-from": circumference }} />
      </svg>
      <b className="font-heading">{played}<small className="tv-t-info">von {total}</small></b>
    </div>
  );
}

/** Zahlen zwischendurch (#1124): bis zu drei Kacheln, nur mit echten Zahlen. */
export function TvStatsSlide({ tiles = [], avatarOf = () => "" }) {
  return (
    <section className="tv-stats" data-testid="tv-stats-slide" style={{ "--tiles": Math.max(1, tiles.length) }}>
      {tiles.map((tile) => (
        <article key={tile.kind} className={`tv-stat tv-stat--${tile.kind}`} data-testid={`tv-stat-${tile.kind}`}>
          <div className="tv-kicker tv-t-info">{tile.kind === "played" ? "Spiele gespielt" : tile.kind === "wins" ? "Meiste Siege" : "Knappster Zieleinlauf"}</div>
          {tile.kind === "played" ? <PlayedRing played={tile.played} total={tile.total} /> : null}
          {tile.kind === "wins" ? (
            <div className="tv-stat__who">
              <div className="tv-stat__faces">
                {tile.ids.map((id, index) => <TvFace key={id} name={tile.names[index]} avatar={avatarOf(id)} className="tv-stat__face" />)}
              </div>
              <b className="tv-stat__name" data-tv-name="1">{tile.names.join(", ")}</b>
              <span className="tv-stat__text tv-t-info">{tile.text}</span>
            </div>
          ) : null}
          {tile.kind === "closest" ? (
            <div className="tv-stat__who">
              <b className="tv-stat__big font-heading">{tile.big}</b>
              <span className="tv-stat__text tv-t-info">{tile.text}</span>
            </div>
          ) : null}
        </article>
      ))}
    </section>
  );
}

/**
 * Sponsor-Moment (#1125): ein Sponsor über die ganze Breite - „Unser Partner“, großes Logo, der Name, der Dank. Im
 * Turnierbaum-TV als Folie, im Event- und Fast-Lap-TV als Einblendung im selben Takt.
 */
export function TvSponsorMoment({ sponsor, title = "", overlay = false }) {
  if (!sponsor) return null;
  return (
    <section className={`tv-sponsor-moment ${overlay ? "tv-sponsor-moment--overlay" : ""}`} data-testid="tv-sponsor-moment" data-sponsor={sponsor.id}>
      <div className="tv-kicker tv-t-info tv-sponsor-moment__kicker">Unser Partner</div>
      <div className="tv-sponsor-moment__logo">
        <SmartLogo src={resolveMediaUrl(sponsor.logo_url)} alt={sponsor.name} className="max-h-full max-w-full w-auto h-auto" />
      </div>
      <div className="tv-sponsor-moment__name font-heading" data-tv-name="1">{sponsor.name}</div>
      {title ? <p className="tv-sponsor-moment__thanks tv-t-info">Danke, dass ihr „{title}“ möglich macht.</p> : null}
    </section>
  );
}
