import { useEffect, useMemo, useState } from "react";
import { charsPerLine, wrapLines, TV_LINE } from "@/lib/tvType";
import { countdown } from "@/lib/tvCalls";
import { clockText, packLane } from "@/lib/tvDayPlan";
import { STATION_STATES, pageOf, stationCounts, stationGrid } from "@/lib/tvStationGrid";
import { spotlightParts } from "@/lib/tvLive";
import { useTv, useTvArea } from "./TvScreen";
import { useSecondTick } from "./TvTreeNode";

// Die Hallen-Tafel (#1126), gestaltet wie in der TV-Vorschau: links der Tagesplan als Zeitleiste mit „jetzt“-Linie,
// rechts alle Stationen als Raster (frei, belegt, aufgerufen, defekt - mit Spiel und Namen im Klartext), unten was jetzt
// läuft und was als Nächstes kommt. Alle Größen in TV-Einheiten mit den Untergrenzen aus #1111, nichts mit „…“.

const PAGE_MS = 10000;
const LANE_LABEL_UNITS = 13;

/** Die Zeitleiste: Stunden, Bahnen mit Blöcken, Einlass und die rote „jetzt“-Linie. */
export function TvDayPlan({ plan }) {
  const { scale } = useTv();
  const [trackRef, area] = useTvArea(null);
  const trackUnits = area ? Math.max(20, area.w - LANE_LABEL_UNITS) : 90;
  const padX = 1.1;
  const lanes = useMemo(() => {
    if (!plan) return [];
    return plan.lanes.map((lane) => {
      // Jeder Block bekommt so viel Breite, dass sein Name in höchstens zwei Zeilen passt - dann notfalls eine neue Reihe.
      const minShare = (block) => Math.min(1, (Math.ceil(Math.min(block.title.length, 28) / 2) * scale.name * 0.5 + 2 * padX + 1.5) / trackUnits);
      const packed = packLane(lane.blocks, plan, 0, minShare);
      const rowHeight = Math.max(...packed.blocks.map((block) => {
        const lines = Math.min(3, Math.max(1, wrapLines(block.title, charsPerLine(block.width * trackUnits - 2 * padX, scale.name))));
        return 2 * 0.7 + lines * scale.name * TV_LINE.name + scale.meta * TV_LINE.meta + 0.3;
      }), 7);
      return { ...lane, ...packed, rowHeight };
    });
  }, [plan, scale, trackUnits]);
  if (!plan) return <div className="tv-empty tv-t-info">Für dieses Event gibt es noch keinen Tagesplan.</div>;
  const at = (share) => `${(share * 100).toFixed(3)}%`;
  return (
    <div className="tv-plan" data-testid="tv-day-plan">
      <div className="tv-plan__ticks">
        <span />
        <div className="tv-plan__scale">
          {plan.ticks.map((tick) => <span key={tick.at} className="tv-plan__tick tv-t-meta" style={{ left: at(tick.share) }}>{tick.label}</span>)}
        </div>
      </div>
      <div className="tv-plan__lanes">
        <div className="tv-plan__grid" ref={trackRef} aria-hidden="true">
          {plan.ticks.map((tick) => <i key={tick.at} style={{ left: at(tick.share) }} />)}
        </div>
        {lanes.map((lane) => (
          <div key={lane.key} className="tv-plan__lane" data-testid={`tv-plan-lane-${lane.key}`}>
            <div className="tv-plan__lane-label tv-t-meta">{lane.label}</div>
            <div className="tv-plan__track" style={{ height: `calc(var(--tv-u) * ${(lane.rows * (lane.rowHeight + 0.8)).toFixed(2)})` }}>
              {lane.blocks.map((block) => (
                <div
                  key={block.id}
                  className={`tv-plan__block tv-plan__block--${block.state} ${block.open ? "tv-plan__block--open" : ""}`}
                  style={{ left: at(block.left), width: at(block.width), top: `calc(var(--tv-u) * ${(block.row * (lane.rowHeight + 0.8)).toFixed(2)})`, height: `calc(var(--tv-u) * ${lane.rowHeight.toFixed(2)})` }}
                  data-testid={`tv-plan-block-${block.id}`}
                  data-state={block.state}
                >
                  <b className="tv-t-name" data-tv-name="1">{block.title}</b>
                  <span className="tv-t-meta">{block.state === "live" ? `läuft · ${block.timeText}` : block.timeText}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {plan.door ? (
          <div className="tv-plan__door" style={{ "--share": plan.door.share.toFixed(5) }} aria-hidden="true"><i /></div>
        ) : null}
        {plan.now ? (
          <div className="tv-plan__now" style={{ "--share": plan.now.share.toFixed(5) }} data-testid="tv-plan-now" data-share={plan.now.share.toFixed(5)}>
            <i />
            <b className="tv-t-meta">Jetzt</b>
          </div>
        ) : null}
      </div>
      {plan.door ? <div className="tv-plan__foot tv-t-meta tv-muted">{plan.door.label}</div> : null}
    </div>
  );
}

function stationLine(entry) {
  if (!entry?.detail) return "";
  return [entry.detail.kind, entry.detail.key].filter(Boolean).join(" · ");
}

function StationCell({ entry, now }) {
  const state = STATION_STATES[entry.state];
  const live = entry.state === "busy" && entry.detail?.match ? spotlightParts(entry.detail.match, now).clock : "";
  const left = entry.state === "called" && entry.call ? countdown(entry.call.dueAt, now) : null;
  const names = entry.detail?.participants || "";
  return (
    <div className={`tv-hall-station tv-hall-station--${entry.state}`} data-testid="tv-station" data-state={entry.state} data-station={entry.station.id}>
      <div className="tv-hall-station__top">
        <b className="tv-hall-station__name font-heading">{entry.station.name || entry.station.label || entry.station.id}</b>
        <span className={`tv-pill tv-t-meta tv-pill--${state.tone}`}>{state.label}</span>
      </div>
      {entry.detail ? (
        <>
          <div className="tv-hall-station__what tv-t-meta">
            <span>{stationLine(entry)}</span>
            {live ? <span className="tv-hall-station__clock">{live}</span> : null}
            {left && left.text ? <span className="tv-hall-station__clock tv-gold">{left.done ? "jetzt" : `noch ${left.text}`}</span> : null}
          </div>
          <div className="tv-t-name tv-hall-station__who" data-tv-name="1">{names}</div>
        </>
      ) : (
        <div className="tv-t-info tv-faint">{entry.state === "broken" ? "Bitte nicht benutzen" : entry.state === "free" ? "Frei für das nächste Spiel" : "Gleich geht es hier los"}</div>
      )}
    </div>
  );
}

// Wie viel Platz eine Station mindestens braucht (Einheiten): Name, Spiel, Namen in einer Zeile - längere Namen brechen
// um; läuft das Raster dann doch über, misst die Seite nach und blättert früher.
const LEVELS = [
  { key: "large", minW: 34, h: 11.4 },
  { key: "normal", minW: 28, h: 10.2 },
  { key: "small", minW: 21, h: 8.8 },
];

/**
 * Alle Stationen: so groß wie möglich, bis zur Untergrenze kleiner, danach ruhig blättern („Seite 1/2“). `entries` sind
 * `{ station, state, detail, call }` - Stand, Spiel im Klartext, Aufruf mit Countdown.
 */
export function TvStationBoard({ entries = [] }) {
  const { motionOn } = useTv();
  const second = useSecondTick();
  const [gridRef, area, trim] = useTvArea(`${entries.length}`);
  const layout = useMemo(() => {
    const base = stationGrid(entries.length, area || { w: 70, h: 50 }, LEVELS, 1);
    if (!trim) return base;
    // Läuft das Raster trotz Rechnung über (andere Schrift am TV), je Schritt eine Station weniger je Seite.
    const perPage = Math.max(1, base.perPage - trim);
    return { ...base, level: "small", perPage, pages: Math.ceil(entries.length / perPage), rows: Math.ceil(Math.min(perPage, entries.length) / base.columns) };
  }, [entries.length, area, trim]);
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (layout.pages <= 1) {
      setPage(0);
      return undefined;
    }
    const timer = window.setInterval(() => setPage((current) => (current + 1) % layout.pages), PAGE_MS);
    return () => window.clearInterval(timer);
  }, [layout.pages]);
  const shown = pageOf(entries, layout, page);
  const counts = stationCounts(entries.map((entry) => entry.state));
  return (
    <section className="tv-panel tv-hall-stations" data-testid="tv-station-board" data-pages={layout.pages} data-level={layout.level}>
      <div className="tv-panel__head items-center">
        <div className="tv-kicker tv-t-meta">Stationen</div>
        <div className="tv-t-info tv-muted text-right" data-testid="tv-station-counts">
          {counts.text}{layout.pages > 1 ? <span className="tv-hall-stations__page" data-testid="tv-station-page"> · Seite {(page % layout.pages) + 1}/{layout.pages}</span> : null}
        </div>
      </div>
      <div
        ref={gridRef}
        className={`tv-hall-stations__grid tv-hall-stations__grid--${layout.level}`}
        style={{ "--cols": layout.columns }}
        data-testid="tv-station-list"
        key={motionOn ? `page-${page}` : undefined}
      >
        {shown.map((entry) => <StationCell key={entry.station.id} entry={entry} now={second * 1000} />)}
        {!entries.length ? <div className="tv-empty tv-t-info">Keine Stationen für dieses Event</div> : null}
      </div>
    </section>
  );
}

/** Unten: „Jetzt läuft“ und „Als Nächstes · 14:30“ mit Hinweis. */
export function TvNowNext({ plan, runningText }) {
  const running = plan?.running || [];
  const next = plan?.next || null;
  return (
    <div className="tv-nownext" data-testid="tv-now-next">
      <div className="tv-nownext__card" data-testid="tv-now">
        <div className="tv-kicker tv-t-meta tv-nownext__live">Jetzt läuft</div>
        {running.length ? (
          <>
            <b className="tv-nownext__title font-heading">{running.slice(0, 2).map((block) => block.title).join(" · ")}{running.length > 2 ? ` + ${running.length - 2}` : ""}</b>
            <span className="tv-t-info tv-muted">{runningText(running[0])}</span>
          </>
        ) : (
          <>
            <b className="tv-nownext__title font-heading">Gerade läuft nichts</b>
            <span className="tv-t-info tv-muted">{plan?.startsText || (next ? `Weiter um ${clockText(next.from)}` : "Schaut später wieder vorbei.")}</span>
          </>
        )}
      </div>
      <div className="tv-nownext__card" data-testid="tv-next">
        <div className="tv-kicker tv-t-meta tv-gold">{next ? `Als Nächstes · ${clockText(next.from)}` : "Als Nächstes"}</div>
        {next ? (
          <>
            <b className="tv-nownext__title font-heading">{next.title}</b>
            <span className="tv-t-info tv-muted">{next.hint}</span>
          </>
        ) : (
          <>
            <b className="tv-nownext__title font-heading">Für heute ist alles geplant</b>
            <span className="tv-t-info tv-muted">Danke, dass ihr da seid.</span>
          </>
        )}
      </div>
    </div>
  );
}
