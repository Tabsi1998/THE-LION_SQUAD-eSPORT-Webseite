import { describeSlot, finderFor } from "@/lib/slotSource";
import { forecastText, nextUp } from "@/lib/tvForecast";
import { isLiveMatch, matchName, stationName } from "@/lib/tvLive";
import { hasQueue, queueNextLine, queueNextUp, queueWhat, queueWho } from "@/lib/tvQueue";
import { matchRoundLabel } from "@/lib/tournamentLabels";
import { useMinuteTick } from "./tvHooks";
import { TvSpotlight } from "./TvTreeNode";

// „Läuft“ und „Als Nächstes“ im Fuß des Turnierbaum-TV (#1564): was gerade läuft, mit Station und Spielzeit, und was als
// Nächstes kommt - mit Prognose aus dem Planer („ca. 16:40 · Switch 2“) und dem Verzug, wenn die Halle hinterherhinkt.
// Steht immer, auch während der Kamerafahrt, damit es aus der Halle jederzeit lesbar ist. Ohne Spiel mit Zeit oder
// Station steht nichts da (kein leerer Kasten).
// Mit Live-Warteschlange (`queue`, #1828) kommt „Als Nächstes“ aus ihr - Station und Spieler wie in der Stations-
// Ansicht, auch nach einem Austritt. Die Prognose aus dem Baum gilt nur ohne Warteschlange.

function playersOf(match, matches, nameOf) {
  const find = finderFor(matches)(match);
  const names = (match.slots || []).map((slot) => describeSlot(slot, nameOf, find).label).filter(Boolean);
  if (names.length > 2) return `${names.length} Spieler`;
  return names.join(" vs. ");
}

/** „Als Nächstes“ aus der Live-Warteschlange: dieselben Felder wie aus der Prognose. */
function fromQueue(queue, matches) {
  const pick = queueNextUp(queue);
  if (!pick) return null;
  const { lane, entry } = pick;
  const match = (matches || []).find((row) => row?.id === entry.match_id) || null;
  const line = queueNextLine(entry);
  return {
    id: entry.match_id,
    what: match ? [matchName(match), matchRoundLabel(match)].filter(Boolean).join(" · ") : queueWhat(entry),
    who: queueWho(entry, { compact: true }),
    when: [line.tone === "call" ? "Aufgerufen" : line.text, stationName({ station_name: lane.name })].filter(Boolean).join(" · "),
    delay: line.delay,
  };
}

function fromForecast(next, matches, nameOf) {
  if (!next) return null;
  return {
    id: next.match.id,
    what: [matchName(next.match), matchRoundLabel(next.match)].join(" · "),
    who: playersOf(next.match, matches, nameOf),
    when: forecastText(next),
    delay: next.delayText,
  };
}

export function TvNextUp({ matches = [], stations = [], nameOf = () => "", forecast = null, queue = null }) {
  // Die Prognose rechnet in Minuten - jede Minute einmal neu genügt.
  const minute = useMinuteTick();
  const now = Math.max(Date.now(), minute * 60000);
  const live = matches.filter(isLiveMatch);
  const next = hasQueue(queue)
    ? fromQueue(queue, matches)
    : fromForecast(nextUp(matches, { stations, now, limit: 1, board: forecast })[0], matches, nameOf);
  if (!live.length && !next) return null;
  return (
    <div className="tv-nextup" data-testid="tv-next-wrap">
      {live.length ? (
        <div key={live[0].id} className="tv-nextup__item tv-nextup__item--live tv-nextup__item--in" data-testid="tv-now-playing">
          <span className="tv-kicker tv-t-meta tv-nextup__kicker">Läuft{live.length > 1 ? ` · ${live.length} Spiele` : ""}</span>
          <b className="tv-t-info tv-nextup__what">{matchName(live[0])}</b>
          <TvSpotlight match={live[0]} className="tv-nextup__spot" testPrefix="tv-now-spot" />
        </div>
      ) : null}
      {next ? (
        // Wechselt das nächste Spiel, kommt die neue Zeile weich herein (statt zu springen) - einmal je Spiel.
        <div key={next.id} className="tv-nextup__item tv-nextup__item--in" data-testid="tv-next-up">
          <span className="tv-kicker tv-t-meta tv-nextup__kicker">Als Nächstes</span>
          <b className="tv-t-info tv-nextup__what">{next.what}</b>
          <span className="tv-muted tv-nextup__who" data-tv-name="1">{next.who}</span>
          <span className="tv-t-info tv-nextup__when">{next.when}</span>
          {next.delay ? <span className="tv-t-meta tv-nextup__delay" data-testid="tv-next-delay">{next.delay}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
