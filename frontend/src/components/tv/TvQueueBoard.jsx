import { useEffect, useMemo, useRef, useState } from "react";
import { asInstant } from "@/lib/vienna";
import { matchClock, queueSummaryLine } from "@/lib/liveQueue";
import { countdown } from "@/lib/tvCalls";
import { laneSignature, queueLanes, queueNextLine, queueWhat, queueWho } from "@/lib/tvQueue";
import { MOTION } from "@/lib/motion";
import { useTv } from "./TvScreen";
import { useSecondTick } from "./TvTreeNode";

// Live-Warteschlange je Station am Turnierbaum-TV (#1634): die Folie „Aufrufe“ zeigt, sobald das Turnier vor Ort eine
// Warteschlange hat, jede Station als Bahn - „Jetzt“ mit Spiel, Namen und Spielzeit-Uhr (wie lib/liveQueue.matchClock,
// gelb ab 80 %, rot ab 100 %), daneben „Als Nächstes“: aufgerufen mit Frist und Countdown oder geplant mit Prognose und
// Verzug. Die Aufrufe stecken darin (das nächste Spiel einer Station, gold). Wechselt etwas an einer Station, gleitet der
// alte Inhalt nach oben weg und der neue von unten herein - Station für Station versetzt, nur Verschieben und Deckkraft.
// „Bewegung reduzieren“: sofort der neue Stand, kein Gleiten. Mehr als acht Stationen blättern ruhig („Seite 1/2“).

const PER_PAGE = 8;
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
  useEffect(() => {
    const before = last.current;
    last.current = { key, value };
    if (before.key === key || !motionOn || !before.value) return undefined;
    setLeaving(before);
    const timer = window.setTimeout(() => setLeaving(null), SWAP_MS);
    return () => window.clearTimeout(timer);
    // Nur ein neuer Schlüssel tauscht - neue Daten zum selben Spiel (Uhr, Prognose) nicht.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, motionOn]);
  return leaving;
}

/** Spielzeit: „12:34“ groß, „/ 12 Min.“ klein, darunter der Balken (nur Skalieren). Ohne Startzeit „läuft“. */
export function TvQueueClock({ entry, testId }) {
  const { motionOn } = useTv();
  const second = useSecondTick();
  const info = matchClock(entry?.started_at, entry?.duration_minutes, second * 1000, { stepped: !motionOn });
  if (!info) return <span className="tv-queue__clock tv-t-info" data-testid={testId} data-tone="none">läuft</span>;
  return (
    <span className="tv-queue__clock" data-testid={testId} data-tone={info.tone} role="timer" aria-label={info.limit ? `Spielzeit ${info.text} von ${info.limit}` : `Spielzeit ${info.text}`}>
      <span className="tv-queue__time font-display">{info.text}</span>
      {info.limit ? <span className="tv-queue__limit tv-t-meta">/ {info.limit}</span> : null}
      {info.tone === "over" && info.overMinutes ? <span className="tv-queue__over tv-t-meta">+{info.overMinutes} Min.</span> : null}
      {info.ratio !== null ? (
        <span className="tv-queue__track" aria-hidden="true"><i style={{ transform: `scaleX(${info.ratio.toFixed(4)})` }} /></span>
      ) : null}
    </span>
  );
}

/** „noch 1:23“ bis zur Frist eines Aufrufs - bei 0 „jetzt“. */
function CallLeft({ entry, ghost }) {
  const second = useSecondTick();
  if (!entry?.report_by) return null;
  const left = countdown(asInstant(entry.report_by).getTime(), second * 1000);
  return <span className="tv-queue__left font-display" data-testid={ghost ? undefined : `tv-queue-left-${entry.match_id}`}>{left.done ? "jetzt" : `noch ${left.text}`}</span>;
}

// `ghost`: der weggleitende alte Inhalt - ohne Test-Kennungen, damit jede nur einmal dasteht.
function NowCell({ lane, match, ghost = false }) {
  const entry = lane.now;
  if (!entry) {
    return (
      <div className="tv-queue__body tv-queue__body--quiet">
        <span className="tv-t-info tv-faint">{lane.status === "broken" ? "Bitte nicht benutzen" : "Gerade frei"}</span>
      </div>
    );
  }
  return (
    <div className="tv-queue__body">
      <span className="tv-queue__what tv-t-info">{queueWhat(entry, match)}</span>
      <b className="tv-queue__who tv-t-name" data-tv-name="1">{queueWho(entry)}</b>
      <TvQueueClock entry={entry} testId={ghost ? undefined : `tv-queue-clock-${lane.id}`} />
    </div>
  );
}

function NextCell({ lane, match, ghost = false }) {
  const entry = lane.next;
  if (!entry) {
    return (
      <div className="tv-queue__body tv-queue__body--quiet">
        <span className="tv-t-info tv-faint">{lane.status === "broken" ? "" : "Noch nichts geplant"}</span>
      </div>
    );
  }
  const line = queueNextLine(entry);
  return (
    <div className="tv-queue__body" data-tone={line.tone}>
      <span className="tv-queue__what tv-t-info">{queueWhat(entry, match)}</span>
      <b className="tv-queue__who tv-t-name" data-tv-name="1">{queueWho(entry)}</b>
      <span className="tv-queue__when tv-t-info" data-testid={ghost ? undefined : `tv-queue-when-${lane.id}`}>
        {line.text}
        {line.delay ? <span className="tv-queue__delay"> · {line.delay}</span> : null}
        {line.tone === "call" ? <CallLeft entry={entry} ghost={ghost} /> : null}
      </span>
    </div>
  );
}

/** Eine Hälfte der Bahn (Jetzt oder Als Nächstes): wechselt das Spiel, gleitet der alte Inhalt weg, der neue herein. */
function QueueCell({ kind, lane, swapKey, order, matchOf, motionOn }) {
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
    <div className={`tv-queue__cell tv-queue__cell--${kind}`} data-testid={`tv-queue-${kind}-${lane.id}`} data-match={entryOf(lane)?.match_id || undefined} data-state={entryOf(lane)?.state || undefined}>
      <span className="tv-kicker tv-t-meta tv-queue__kicker">
        {kind === "now" && lane.now ? <span className="tv-live-dot-tv tv-live-dot" aria-hidden="true" /> : null}
        {kind === "now" ? "Jetzt" : "Als Nächstes"}
      </span>
      <div className="tv-queue__stack">
        {leaving ? (
          <div key={`out-${leaving.key}`} className="tv-queue__swap tv-queue__swap--out" aria-hidden="true" data-testid={`tv-queue-${kind}-out-${lane.id}`}>
            <Body lane={leaving.value} match={matchOf(entryOf(leaving.value)?.match_id)} ghost />
          </div>
        ) : null}
        <div key={swapKey} className={`tv-queue__swap tv-queue__swap--in ${first ? "tv-queue__swap--first" : ""}`} style={{ "--tv-delay": delay }}>
          <Body lane={lane} match={matchOf(entryOf(lane)?.match_id)} />
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
  const columns = shown.length > 4 ? 2 : 1;
  return (
    <section className="tv-queue" data-testid="tv-queue-board" data-count={lanes.length} data-pages={pages}>
      <div className="tv-queue__head">
        <div className="tv-kicker tv-t-meta">Stationen · Live-Warteschlange</div>
        <div className="tv-t-info tv-muted text-right" data-testid="tv-queue-summary">
          {summary}
          {pages > 1 ? <span data-testid="tv-queue-page">{summary ? " · " : ""}Seite {(page % pages) + 1}/{pages}</span> : null}
        </div>
      </div>
      <div className="tv-queue__lanes" style={{ "--cols": columns }} key={motionOn && pages > 1 ? `page-${page}` : undefined}>
        {shown.map((lane) => {
          const state = laneState(lane);
          const look = STATE[state];
          const index = order.get(lane.id) ?? 0;
          return (
            <article key={lane.id} className="tv-queue__lane" data-testid={`tv-queue-lane-${lane.id}`} data-state={state}>
              <header className="tv-queue__station">
                <b className="tv-queue__name font-heading" data-tv-name="1">{lane.name}</b>
                <span className={`tv-pill tv-t-meta tv-pill--${look.tone}`}>{look.label}</span>
              </header>
              <QueueCell kind="now" lane={lane} swapKey={lane.now?.match_id || `none-${lane.status}`} order={index} matchOf={matchOf} motionOn={motionOn} />
              <QueueCell kind="next" lane={lane} swapKey={`${lane.next?.match_id || "none"}:${lane.next?.state || ""}`} order={index} matchOf={matchOf} motionOn={motionOn} />
            </article>
          );
        })}
      </div>
    </section>
  );
}
