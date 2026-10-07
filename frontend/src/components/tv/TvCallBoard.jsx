import { describeSlot, finderFor } from "@/lib/slotSource";
import { countdown, ringShare } from "@/lib/tvCalls";
import { matchName } from "@/lib/tvLive";
import { formatRoundName } from "@/lib/tournamentLabels";
import { viennaTime } from "@/lib/vienna";
import { TvFace } from "./TvParts";
import { useTv } from "./TvScreen";
import { useSecondTick } from "./TvTreeNode";

// Aufruf-Tafel (#1122), gestaltet wie in der TV-Vorschau: „Als Nächstes an PC 3“ groß, Turnier und Durchgang, die Namen
// mit Bild oder Kürzel, „Bitte jetzt zur Station“ und ein Countdown-Ring. Bis zu drei Aufrufe groß nebeneinander, mehr
// als Liste - nichts wird weggeblättert. Darunter klein, was danach kommt. Bei 0 steht „Jetzt geht es los“, nichts
// blinkt. „Bewegung reduzieren“: der Ring steht, die Zahl zählt. Ohne Aufrufe: „Gerade keine Aufrufe“ und die nächsten
// geplanten Spiele.

const MAX_BIG = 3;

function playersOf(match, matches, nameOf) {
  const findMatch = finderFor(matches)(match);
  return (match.slots || []).map((slot, index) => {
    const info = describeSlot(slot, nameOf, findMatch);
    return { key: slot.registration_id || `slot-${slot.slot ?? index}`, registrationId: slot.registration_id || null, name: info.label, kind: info.kind };
  }).filter((player) => player.name);
}

function whatOf(call, tournamentOf) {
  const match = call.match;
  const tournament = tournamentOf ? tournamentOf(match) : "";
  return [tournament, formatRoundName(match.round_name, match.round), matchName(match)].filter(Boolean).join(" · ");
}

/** Der Countdown: Ring und Zahl. Ohne geplante Zeit nur der Ring; bei 0 „Jetzt geht es los“. */
export function TvCallCountdown({ call, small = false }) {
  const { motionOn } = useTv();
  const second = useSecondTick();
  const now = second * 1000;
  const left = countdown(call.dueAt, now);
  const share = motionOn ? ringShare(call, now) : 1;
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className={`tv-call__count ${small ? "tv-call__count--small" : ""}`} data-done={left.done ? "1" : undefined} data-testid={`tv-call-count-${call.matchId}`}>
      <div className="tv-call__ring">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle className="tv-call__ring-bg" cx="50" cy="50" r={radius} />
          <circle className="tv-call__ring-fg" cx="50" cy="50" r={radius} style={{ strokeDasharray: circumference, strokeDashoffset: circumference * (1 - share) }} />
        </svg>
        <b className="font-heading" data-testid={`tv-call-clock-${call.matchId}`}>{left.done ? "Los" : left.text || "Jetzt"}</b>
      </div>
      {!small && !left.done ? <span className="tv-call__count-label tv-t-meta">{call.dueAt === null ? "Bitte gleich kommen" : "bis zum Start"}</span> : null}
    </div>
  );
}

function CallCard({ call, matches, nameOf, avatarOf, tournamentOf, layout }) {
  const second = useSecondTick();
  const done = countdown(call.dueAt, second * 1000).done;
  const players = playersOf(call.match, matches, nameOf);
  return (
    <article className={`tv-call tv-call--${layout}`} data-done={done ? "1" : undefined} data-testid={`tv-call-${call.matchId}`}>
      <div className="tv-call__left">
        <div className="tv-call__kicker tv-t-info">Als Nächstes an</div>
        <div className="tv-call__station font-heading" data-testid={`tv-call-station-${call.matchId}`}>{call.station}</div>
        <div className="tv-call__what tv-t-info">{whatOf(call, tournamentOf)}</div>
        <div className="tv-call__go tv-t-info">{done ? "Jetzt geht es los" : "Bitte jetzt zur Station"}</div>
      </div>
      <div className={`tv-call__names ${players.length <= 2 ? "tv-call__names--duel" : ""}`}>
        {players.map((player) => (
          <div key={player.key} className="tv-call__name">
            <TvFace name={player.registrationId ? player.name : ""} avatar={player.registrationId ? avatarOf(player.registrationId) : ""} className="tv-call__face" />
            <b data-tv-name="1">{player.name}</b>
          </div>
        ))}
      </div>
      <TvCallCountdown call={call} />
    </article>
  );
}

function CallRow({ call, matches, nameOf, tournamentOf }) {
  const players = playersOf(call.match, matches, nameOf).map((player) => player.name);
  return (
    <div className="tv-call-row" data-testid={`tv-call-${call.matchId}`}>
      <div className="tv-call-row__station font-heading">{call.station}</div>
      <div className="tv-call-row__body">
        <div className="tv-t-meta tv-muted">{whatOf(call, tournamentOf)}</div>
        <div className="tv-t-name" data-tv-name="1">{players.join(" · ")}</div>
      </div>
      <TvCallCountdown call={call} small />
    </div>
  );
}

function plannedTime(entry) {
  return entry.at ? `ca. ${viennaTime(entry.at, { hour: "2-digit", minute: "2-digit" })}` : "";
}

/** „Danach an PC 5“ - klein unter den Aufrufen (oder als Liste, wenn gerade niemand aufgerufen ist). */
function NextRow({ entry, matches, nameOf, tournamentOf }) {
  const players = playersOf(entry.match, matches, nameOf).map((player) => player.name);
  const what = [tournamentOf ? tournamentOf(entry.match) : "", formatRoundName(entry.match.round_name, entry.match.round), matchName(entry.match)].filter(Boolean).join(" · ");
  return (
    <div className="tv-call-next" data-testid={`tv-call-next-${entry.match.id}`}>
      <div className="min-w-0">
        <div className="tv-kicker tv-t-meta tv-faint">{entry.station ? `Danach an ${entry.station}` : "Danach"}</div>
        <div className="tv-t-info tv-muted">{what}</div>
      </div>
      <div className="tv-t-name tv-call-next__who" data-tv-name="1">{players.join(" vs. ") || "Teilnehmer offen"}</div>
      <div className="tv-t-num font-display tv-call-next__time">{plannedTime(entry)}</div>
    </div>
  );
}

/**
 * Die Tafel: `calls` aus lib/tvCalls (callsOf), `upcoming` die nächsten geplanten Spiele (nextPlanned). `tournamentOf`
 * nennt bei Events mit mehreren Turnieren das Turnier eines Spiels.
 */
export function TvCallBoard({ calls = [], upcoming = [], matches = [], nameOf, avatarOf = () => "", tournamentOf = null }) {
  if (!calls.length) {
    return (
      <section className="tv-calls tv-calls--empty" data-testid="tv-call-board" data-count="0">
        <div className="tv-calls__quiet">
          <div className="tv-t-title font-heading font-black uppercase" data-testid="tv-calls-none">Gerade keine Aufrufe</div>
          <div className="tv-t-info tv-muted">Wer dran ist, steht hier groß – mit Station und Countdown.</div>
        </div>
        {upcoming.length ? (
          <div className="tv-calls__upcoming" data-testid="tv-calls-upcoming">
            <div className="tv-kicker tv-t-meta">Als Nächstes geplant</div>
            {upcoming.map((entry) => <NextRow key={entry.match.id} entry={entry} matches={matches} nameOf={nameOf} tournamentOf={tournamentOf} />)}
          </div>
        ) : null}
      </section>
    );
  }
  const big = calls.length <= MAX_BIG;
  const layout = calls.length === 1 ? "one" : "few";
  return (
    <section className={`tv-calls tv-calls--${big ? layout : "list"}`} data-testid="tv-call-board" data-count={calls.length}>
      {big ? (
        <div className="tv-calls__cards" style={{ "--calls": calls.length }}>
          {calls.map((call) => <CallCard key={call.matchId} call={call} matches={matches} nameOf={nameOf} avatarOf={avatarOf} tournamentOf={tournamentOf} layout={layout} />)}
        </div>
      ) : (
        <div className={`tv-calls__list ${calls.length > 6 ? "tv-calls__list--two" : ""}`}>
          {calls.map((call) => <CallRow key={call.matchId} call={call} matches={matches} nameOf={nameOf} tournamentOf={tournamentOf} />)}
        </div>
      )}
      {big && upcoming.length ? <NextRow entry={upcoming[0]} matches={matches} nameOf={nameOf} tournamentOf={tournamentOf} /> : null}
    </section>
  );
}
