import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { asInstant } from "@/lib/vienna";
import { queueSummaryLine } from "@/lib/liveQueue";
import { clockLabel, matchClock } from "@/lib/matchClock";
import { countdown } from "@/lib/tvCalls";
import { laneSignature, queueLanes, queueNextLine, queueWhat, queueWho } from "@/lib/tvQueue";
import { MOTION } from "@/lib/motion";
import { useTv } from "./TvScreen";
import { useServerTick } from "./TvTreeNode";

// Live-Warteschlange je Station am Turnierbaum-TV (#1634): die Folie „Aufrufe“ zeigt, sobald das Turnier vor Ort eine
// Warteschlange hat, jede Station als Bahn - „Jetzt“ mit Spiel, Namen und Spielzeit-Uhr (lib/matchClock, nach der
// Serverzeit, orange ab 80 %, ab 100 % orange gefüllt mit Warn-Symbol), daneben „Als Nächstes“: aufgerufen mit Frist und Countdown oder geplant mit Prognose und
// Verzug. Die Aufrufe stecken darin (das nächste Spiel einer Station, gold). Wechselt etwas an einer Station, gleitet der
// alte Inhalt nach oben weg und der neue von unten herein - Station für Station versetzt, nur Verschieben und Deckkraft.
// „Bewegung reduzieren“: sofort der neue Stand, kein Gleiten. Ab drei Stationen in zwei Spalten, mehr als sechs blättern
// ruhig („Seite 1/2“) - so passt jede Bahn ohne Abschneiden auf 1920×1080.

const PER_PAGE = 6;
const PAGE_MS = 10000;
// Versatz je Station beim Wechsel - nur die Stationen, die sich geändert haben, zählen mit.
const LANE_STAGGER_MS = 80;
// So lange bleibt der alte Inhalt zum Wegleiten stehen (die langsame Stufe aus lib/motion).
const SWAP_MS = MOTION.slow;

const STATE = Object.freeze({
  live: { label: "Läuft", tone: "live" },
  called: { label: "Aufgerufen", tone: "gold" },
  free: { label: "Frei", tone: "green" },
  broken: { label: "Defekt", tone: "red" },
});

function laneState(lane) {
  if (lane.status === "broken") return "broken";
  if (lane.now) return "live";
  if (lane.next?.state === "called") return "called";
  return "free";
}

/**
 * Hält den vorigen Inhalt kurz fest, wenn sich `key` ändert - so kann er weggleiten, während der neue hereinkommt.
 * Ohne Bewegung nie: dann steht sofort nur der neue da.
 */
function useSwap(key, value, motionOn) {
  const [leaving, setLeaving] = useState(null);
  const last = useRef({ key, value });
  // Nur ein neuer Schlüssel tauscht - neue Daten zum selben Spiel (Uhr, Prognose) nicht.
  useEffect(() => {
    const before = last.current;
    if (before.key === key || !motionOn || !before.value) return undefined;
    setLeaving(before);
    const timer = window.setTimeout(() => setLeaving(null), SWAP_MS);
    return () => window.clearTimeout(timer);
  }, [key, motionOn]);
  // Nach jeder Darstellung der zuletzt gezeigte Stand: beim nächsten Wechsel gleitet der aktuelle Inhalt hinaus, nicht
  // der vom Anfang des Spiels (#937).
  useEffect(() => {
    last.current = { key, value };
  });
  return leaving;
}

/**
 * Spielzeit: „12:34“ groß, „/ 12 Min.“ klein, darunter der Balken (nur Skalieren). Ohne Startzeit „läuft“. Gezählt nach
 * der Serverzeit (#1167) - der TV zeigt dieselbe Sekunde wie Handy und Leitung, auch wenn seine Uhr danebenliegt. Ab 80 %
 * orange, ab 100 % orange gefüllt mit Warn-Symbol (Rot bleibt „läuft“).
 */
export function TvQueueClock({ entry, testId }) {
  const { motionOn } = useTv();
  const now = useServerTick();
  const info = matchClock(entry?.started_at, entry?.duration_minutes, now, {
    stepped: !motionOn, pausedAt: entry?.paused_at, pausedSeconds: entry?.paused_seconds,
  });
  if (!info) return <span className="tv-lanes__clock tv-t-info" data-testid={testId} data-tone="none">läuft</span>;
  return (
    <span className="tv-lanes__clock" data-testid={testId} data-tone={info.tone} role="timer" aria-label={clockLabel(info)}>
      <span className="tv-lanes__time tv-clock-time font-display">
        {info.tone === "over" ? <AlertTriangle className="tv-clock-icon" aria-hidden="true" data-testid={testId ? `${testId}-warn` : undefined} /> : null}
        {info.text}
      </span>
      {info.limit ? <span className="tv-lanes__limit tv-t-meta">/ {info.limit}</span> : null}
      {info.tone === "over" && info.overMinutes ? <span className="tv-lanes__over tv-t-meta">+{info.overMinutes} Min.</span> : null}
      {info.ratio !== null ? (
        <span className="tv-lanes__track" aria-hidden="true"><i style={{ transform: `scaleX(${info.ratio.toFixed(4)})` }} /></span>
      ) : null}
    </span>
  );
}

/** „noch 1:23“ bis zur Frist eines Aufrufs - bei 0 „jetzt“. Nach der Serverzeit (#1167), wie die Frist selbst. */
function CallLeft({ entry, ghost }) {
  const now = useServerTick();
  if (!entry?.report_by) return null;
  const left = countdown(asInstant(entry.report_by).getTime(), now);
  return <span className="tv-lanes__left font-display" data-testid={ghost ? undefined : `tv-queue-left-${entry.match_id}`}>{left.done ? "jetzt" : `noch ${left.text}`}</span>;
}

// `ghost`: der weggleitende alte Inhalt - ohne Test-Kennungen, damit jede nur einmal dasteht.
function NowCell({ lane, match, ghost = false, compact = false }) {
  const entry = lane.now;
  if (!entry) {
    return (
      <div className="tv-lanes__body tv-lanes__body--quiet">
        <span className="tv-t-info tv-faint">{lane.status === "broken" ? "Bitte nicht benutzen" : "Gerade frei"}</span>
      </div>
    );
  }
  return (
    <div className="tv-lanes__body">
      <span className="tv-lanes__what tv-t-info">{queueWhat(entry, match)}</span>
      <b className="tv-lanes__who tv-t-name" data-tv-name="1">{queueWho(entry, { compact })}</b>
      <TvQueueClock entry={entry} testId={ghost ? undefined : `tv-queue-clock-${lane.id}`} />
    </div>
  );
}

function NextCell({ lane, match, ghost = false, compact = false }) {
  const entry = lane.next;
  if (!entry) {
    return (
      <div className="tv-lanes__body tv-lanes__body--quiet">
        <span className="tv-t-info tv-faint">{lane.status === "broken" ? "" : "Noch nichts geplant"}</span>
      </div>
    );
  }
  const line = queueNextLine(entry);
  return (
    <div className="tv-lanes__body" data-tone={line.tone}>
      <span className="tv-lanes__what tv-t-info">{queueWhat(entry, match)}</span>
      <b className="tv-lanes__who tv-t-name" data-tv-name="1">{queueWho(entry, { compact })}</b>
      <span className="tv-lanes__when tv-t-info" data-testid={ghost ? undefined : `tv-queue-when-${lane.id}`}>
        {line.text}
        {line.delay ? <span className="tv-lanes__delay"> · {line.delay}</span> : null}
        {line.tone === "call" ? <CallLeft entry={entry} ghost={ghost} /> : null}
      </span>
    </div>
  );
}

/** Eine Hälfte der Bahn (Jetzt oder Als Nächstes): wechselt das Spiel, gleitet der alte Inhalt weg, der neue herein. */
function QueueCell({ kind, lane, swapKey, order, matchOf, motionOn, compact = false }) {
  const leaving = useSwap(swapKey, lane, motionOn);
  const Body = kind === "now" ? NowCell : NextCell;
  const entryOf = (row) => (kind === "now" ? row.now : row.next);
  // Versatz: Station für Station, „Als Nächstes“ einen Takt nach „Jetzt“.
  // Festgehalten, solange dasselbe Spiel steht: ein neuer Stand während des Gleitens verschiebt den Einsatz nicht.
  const frozen = useRef(null);
  if (frozen.current?.key !== swapKey) frozen.current = { key: swapKey, delay: `${order * LANE_STAGGER_MS + (kind === "next" ? LANE_STAGGER_MS / 2 : 0)}ms` };
  const { delay } = frozen.current;
  // Der erste Inhalt kommt mit der Folie - nur Aufblenden; erst ein Wechsel gleitet.
  const firstKey = useRef(swapKey);
  const first = firstKey.current === swapKey;
  return (
    <div className={`tv-lanes__cell tv-lanes__cell--${kind}`} data-testid={`tv-queue-${kind}-${lane.id}`} data-match={entryOf(lane)?.match_id || undefined} data-state={entryOf(lane)?.state || undefined}>
      <span className="tv-kicker tv-t-meta tv-lanes__kicker">
        {kind === "now" && lane.now ? <span className="tv-live-dot-tv tv-live-dot" aria-hidden="true" /> : null}
        {kind === "now" ? "Jetzt" : "Als Nächstes"}
      </span>
      <div className="tv-lanes__stack">
        {leaving ? (
          <div key={`out-${leaving.key}`} className="tv-lanes__swap tv-lanes__swap--out" aria-hidden="true" data-testid={`tv-queue-${kind}-out-${lane.id}`}>
            <Body lane={leaving.value} match={matchOf(entryOf(leaving.value)?.match_id)} ghost compact={compact} />
          </div>
        ) : null}
        <div key={swapKey} className={`tv-lanes__swap tv-lanes__swap--in ${first ? "tv-lanes__swap--first" : ""}`} style={{ "--tv-delay": delay }}>
          <Body lane={lane} match={matchOf(entryOf(lane)?.match_id)} compact={compact} />
        </div>
      </div>
    </div>
  );
}

/**
 * Die Warteschlange je Station. `queue` ist die Antwort von GET /live-queue; `matches` der Baum (für „Viertelfinale ·
 * Spiel B“ wie überall am TV). Ohne Bahnen zeichnet sie nichts - die Seite zeigt dann die Aufruf-Tafel wie bisher.
 */
export function TvQueueBoard({ queue, matches = [] }) {
  const { motionOn } = useTv();
  const lanes = useMemo(() => queueLanes(queue), [queue]);
  const byId = useMemo(() => new Map((matches || []).map((match) => [match.id, match])), [matches]);
  const matchOf = (id) => (id ? byId.get(id) || null : null);
  const pages = Math.max(1, Math.ceil(lanes.length / PER_PAGE));
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (pages <= 1) {
      setPage(0);
      return undefined;
    }
    const timer = window.setInterval(() => setPage((current) => (current + 1) % pages), PAGE_MS);
    return () => window.clearInterval(timer);
  }, [pages]);
  const shown = lanes.slice((page % pages) * PER_PAGE, (page % pages) * PER_PAGE + PER_PAGE);

  // Welche Stationen sich seit dem letzten Stand geändert haben - nur sie gleiten, in ihrer Reihenfolge versetzt.
  const seen = useRef(new Map());
  const order = useMemo(() => {
    const changed = new Map();
    for (const lane of shown) if (seen.current.get(lane.id) !== laneSignature(lane)) changed.set(lane.id, changed.size);
    return changed;
  }, [shown]);
  useEffect(() => {
    seen.current = new Map(lanes.map((lane) => [lane.id, laneSignature(lane)]));
  }, [lanes]);

  if (!lanes.length) return null;
  const summary = queueSummaryLine(queue?.summary);
  const columns = shown.length > 2 ? 2 : 1;
  // Drei Reihen auf 1080p (fünf oder sechs Stationen): im Lauf „4 Spieler“ statt der Namen.
  const compact = shown.length > 4;
  return (
    <section className="tv-lanes" data-testid="tv-queue-board" data-count={lanes.length} data-pages={pages}>
      <div className="tv-lanes__head">
        <div className="tv-kicker tv-t-meta">Stationen · Live-Warteschlange</div>
        <div className="tv-t-info tv-muted text-right" data-testid="tv-queue-summary">
          {summary}
          {pages > 1 ? <span data-testid="tv-queue-page">{summary ? " · " : ""}Seite {(page % pages) + 1}/{pages}</span> : null}
        </div>
      </div>
      <div className="tv-lanes__lanes" style={{ "--cols": columns }} key={motionOn && pages > 1 ? `page-${page}` : undefined}>
        {shown.map((lane) => {
          const state = laneState(lane);
          const look = STATE[state];
          const index = order.get(lane.id) ?? 0;
          return (
            <article key={lane.id} className="tv-lanes__lane" data-testid={`tv-queue-lane-${lane.id}`} data-state={state}>
              <header className="tv-lanes__station">
                <b className="tv-lanes__name font-heading" data-tv-name="1">{lane.name}</b>
                <span className={`tv-pill tv-t-meta tv-pill--${look.tone}`}>{look.label}</span>
              </header>
              <QueueCell kind="now" lane={lane} swapKey={lane.now?.match_id || (lane.status === "broken" ? "none-broken" : "none")} order={index} matchOf={matchOf} motionOn={motionOn} compact={compact} />
              <QueueCell kind="next" lane={lane} swapKey={`${lane.next?.match_id || "none"}:${lane.next?.state || ""}`} order={index} matchOf={matchOf} motionOn={motionOn} compact={compact} />
            </article>
          );
        })}
      </div>
    </section>
  );
}
