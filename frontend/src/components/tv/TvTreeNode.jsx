import { treeSlotLabel } from "@/lib/bracketNames";
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { isOut, isWalkover, matchFate, soloAdvance } from "@/lib/bracketGraph";
import { Trophy } from "lucide-react";
import { resolveMediaUrl } from "@/lib/api";
import { describeSlot, initials, isMatchDone, plannedText } from "@/lib/slotSource";
import { isLiveMatch, matchName, spotlightParts } from "@/lib/tvLive";
import { advancementsOf } from "@/lib/tvTravel";
import { isDuelMatch } from "@/lib/tvGrid";
import { formatMatchStatus } from "@/lib/tournamentLabels";
import { DELAY_SHOWN_FROM, forecastText } from "@/lib/tvForecast";
import { nameFit, treeScale } from "@/lib/tvType";
import { useTv } from "./TvScreen";

// Eine Karte im Turnierbaum am TV (#1115-#1119): Duell oder Durchgang, Namen in TV-Größe (nie „…“), laufende Spiele atmen
// ruhig in der Live-Farbe und zeigen groß Station und Spielzeit. Nach dem Ergebnis sagt die Farbe der Zeile, wie es
// weitergeht: blau weiter, gedämpft rot ins Loser Bracket, blasser raus (die Worte dazu stehen auf der Ergebnis-Karte und
// in der Startaufstellung). Was die Seite drumherum weiß (Plätze, auf die gerade jemand zufährt, der goldene Weg), kommt
// über TvTreeContext - so baut ein neues Ergebnis den Baum nicht neu auf.
// Seit #1564 mit denselben Regeln wie der Web-Baum: ein Freilos-Duell ist eine Zeile, kampflos steht im Kopf, wer
// ausgefallen ist, steht durchgestrichen mit Wort, Entfallenes tritt zurück. Jede Zeile trägt ihren Platz
// (`data-slot-anchor`), dort enden die Linien. Bewegungen setzt die Bühne über `marks` und `drawRows` - genau einmal.

const EMPTY = new Set();
const NO_MARKS = new Map();
export const TvTreeContext = createContext({
  matches: [],
  hiddenSlots: EMPTY,
  landing: EMPTY,
  goldCards: EMPTY,
  goldRows: EMPTY,
  finished: false,
  lastStageId: null,
  isTable: () => false,
  marks: NO_MARKS,
  drawRows: NO_MARKS,
  drawStep: 60,
  forecast: NO_MARKS,
});

// Eine Uhr für alle laufenden Spiele: einmal je Sekunde, nur die Uhren zeichnen neu.
const clockListeners = new Set();
let clockTimer = null;
function subscribeClock(listener) {
  clockListeners.add(listener);
  if (!clockTimer) clockTimer = window.setInterval(() => clockListeners.forEach((entry) => entry()), 1000);
  return () => {
    clockListeners.delete(listener);
    if (!clockListeners.size && clockTimer) {
      window.clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}
function currentSecond() {
  return Math.floor(Date.now() / 1000);
}

export function useSecondTick() {
  return useSyncExternalStore(subscribeClock, currentSecond, currentSecond);
}

/** Station und Spielzeit eines laufenden Spiels, sekundengenau („PC 3 · 12:34“, ohne Startzeit „Live“). */
export function TvSpotlight({ match, className = "", testPrefix = "tv-spot" }) {
  const second = useSecondTick();
  const parts = spotlightParts(match, second * 1000);
  return (
    <div className={`tv-spot ${className}`} data-testid={`${testPrefix}-${match.id}`}>
      <span className="tv-live-dot-tv tv-live-dot" aria-hidden="true" />
      {parts.station ? <span className="tv-spot__station">{parts.station}</span> : null}
      {parts.station ? <span className="tv-spot__sep" aria-hidden="true">·</span> : null}
      <span className="tv-spot__clock" data-testid={`${testPrefix}-clock-${match.id}`}>{parts.clock || "Live"}</span>
    </div>
  );
}

function registrationName(regMap) {
  return (registrationId) => {
    const reg = regMap.get(registrationId);
    const user = reg?.user || {};
    return reg?.display_name || user.display_name || reg?.ingame_name || "";
  };
}

function avatarOf(regMap, registrationId) {
  const reg = regMap.get(registrationId);
  return reg?.user?.avatar_url || reg?.avatar_url || "";
}

/** Wer ausgefallen ist, in Worten: nicht angetreten (kampflos) oder ausgefallen (Aufgabe, nicht ins Ziel). */
function goneText(result) {
  if (!isOut(result)) return "";
  return result.forfeit || result.no_show ? "nicht angetreten" : "ausgefallen";
}

function podiumClass(rank) {
  return rank === 1 ? "tv-row--p1" : rank === 2 ? "tv-row--p2" : rank === 3 ? "tv-row--p3" : "";
}

/** „geplant ca. 14:20“ - nur mit Uhrzeit; ohne Termin steht der Zustand da („Bereit“, „Ausstehend“). */
function shortPlanned(match) {
  if (!match?.scheduled_at) return "";
  const text = plannedText(match);
  return text.startsWith("geplant") ? text.split(" · ")[0] : "";
}

/** Die Karte - `data-tv-slot` und `data-tv-reg` an jeder Zeile sagen den Fahrten, wo ein Platz liegt. */
export function TvTreeNode({ match, regMap, podiumMap, findMatch }) {
  const tree = useContext(TvTreeContext);
  const { textSize } = useTv();
  const scale = treeScale(textSize);
  const nameOf = registrationName(regMap);
  const done = isMatchDone(match);
  const live = !tree.finished && isLiveMatch(match);
  const heat = !isDuelMatch(match);
  const lastStage = !tree.lastStageId || (match.stage_id || "__default") === tree.lastStageId;
  const table = tree.isTable(match);
  const outcomes = useMemo(
    () => (done ? advancementsOf(match, tree.matches, { lastStage, table }) : []),
    [done, match, tree.matches, lastStage, table],
  );
  const byRegistration = new Map(outcomes.map((entry) => [entry.registrationId, entry]));
  const resultOf = (registrationId) => (match.results || []).find((row) => row.registration_id && row.registration_id === registrationId);

  let slots = (match.slots || []).map((slot, index) => ({ slot, index }));
  if (!heat) while (slots.length < 2) slots.push({ slot: { slot: slots.length + 1, registration_id: null, status: "empty" }, index: slots.length });
  if (heat && outcomes.length) {
    slots = [...slots].sort((a, b) => (byRegistration.get(a.slot.registration_id)?.rank ?? 99) - (byRegistration.get(b.slot.registration_id)?.rank ?? 99) || a.index - b.index);
  }
  const qualifiers = Number(match.settings?.qualifiers_per_match || 0);
  // Entfällt (#1561): ein nicht nötiges Reset-Spiel, ein zusammengelegter Lauf - sagen, warum.
  const fate = matchFate(match);
  const walkover = done && isWalkover(match);
  const solo = fate ? null : soloAdvance(match);
  // Hinkt die Halle hinterher, steht die neue Prognose da - dieselbe wie im Fuß (lib/tvForecast.forecastBoard), klein
  // dazu, um wie viel es später wird. Sonst wie bisher „geplant ca. 14:20“.
  const ahead = !fate && !live && !done ? tree.forecast?.get(match.id) : null;
  const late = ahead && ahead.eta !== null && ahead.delayMinutes >= DELAY_SHOWN_FROM ? ahead : null;
  const status = fate ? fate.label : live ? "" : walkover ? "kampflos" : solo ? "Freilos" : done ? formatMatchStatus(match.status)
    : late ? forecastText({ ...late, station: "" }) : shortPlanned(match) || formatMatchStatus(match.status);
  const goldCard = tree.goldCards.has(match.id);
  const meta = heat && !matchFate(match) ? [`${(match.slots || []).length} Spieler`, qualifiers ? `${qualifiers} ${qualifiers === 1 ? "kommt" : "kommen"} weiter` : ""].filter(Boolean).join(" · ") : "";
  const mark = tree.marks?.get(match.id) || "";
  // Entfällt (Reset nicht nötig, zusammengelegt, gestrichen): wie im Web-Baum nur eine ruhige Zeile - der Kopf mit Grund.
  if (fate) slots = [];
  if (solo) {
    // Freilos-Duell (#1259, wie im Web-Baum): eine Zeile, wer weiterkommt - keine leere Gegner-Zeile.
    const index = (match.slots || []).indexOf(solo.slot);
    if (!heat) slots = slots.filter((entry) => entry.index === index);
  }

  return (
    <article
      className={["tv-node", live ? "tv-node--live" : "", done ? "tv-node--done" : "", goldCard ? "tv-node--gold" : "", heat ? "tv-node--heat" : "", fate ? "tv-node--void" : "", solo ? "tv-node--bye" : ""].filter(Boolean).join(" ")}
      data-testid={`tv-match-${match.id}`}
      data-tv-node={match.id}
      data-live={live ? "1" : undefined}
      data-walkover={walkover ? "1" : undefined}
      data-bye={solo ? "1" : undefined}
      data-mark={mark || undefined}
    >
      <header className="tv-node__head">
        <span className="tv-node__title tv-t-meta">
          <span className="tv-node__name">{matchName(match)}</span>
          {meta ? <span className="tv-node__meta">{meta}</span> : null}
        </span>
        {live ? (
          <span className="tv-node__live tv-t-meta"><span className="tv-live-dot-tv" aria-hidden="true" />Live</span>
        ) : status ? (
          <span className="tv-node__status tv-t-meta">
            {status}
            {late ? <span className="tv-node__late">+{late.delayMinutes} Min.</span> : null}
          </span>
        ) : null}
      </header>
      {slots.map(({ slot, index }) => {
        const slotKey = `${match.id}:${index}`;
        const hidden = tree.hiddenSlots.has(slotKey);
        const shown = hidden ? { ...slot, registration_id: null, status: "pending" } : slot;
        const described = describeSlot(shown, nameOf, findMatch);
        // Gelost (#1591): „Weiter aus Runde 1“ statt „Platz aus Runde 1“ - wie im Web-Baum.
        const info = described.kind === "pending" ? { ...described, label: treeSlotLabel(shown, findMatch) || described.label } : described;
        const registrationId = hidden ? null : slot.registration_id || null;
        const result = registrationId ? resultOf(registrationId) : null;
        const outcome = registrationId ? byRegistration.get(registrationId) : null;
        const kind = outcome?.kind;
        const won = done && !heat && Boolean(registrationId) && (result?.rank === 1 || (match.winner_id && match.winner_id === registrationId));
        const gold = Boolean(registrationId) && tree.goldRows.has(`${match.id}:${registrationId}`);
        const podium = lastStage && done && registrationId ? podiumMap?.get(registrationId) : null;
        const classes = [
          "tv-row",
          won ? "tv-row--won" : "",
          heat && kind === "win" ? "tv-row--q" : "",
          kind === "drop" ? "tv-row--drop" : "",
          kind === "out" && !podium ? "tv-row--out" : "",
          podiumClass(podium),
          gold ? "tv-row--gold" : "",
          tree.landing.has(slotKey) ? "tv-row--land" : "",
          info.kind === "pending" || info.kind === "bye" ? "tv-row--pending" : "",
          info.kind === "empty" ? "tv-row--empty" : "",
        ].filter(Boolean).join(" ");
        const score = result?.score ?? result?.points;
        const avatar = registrationId ? avatarOf(regMap, registrationId) : "";
        const short = info.kind === "player" ? initials(info.label) : "";
        const label = solo ? `Freilos: ${info.label} kommt weiter` : info.label;
        const fit = nameFit(label, 23, scale);
        const gone = goneText(result);
        const draw = tree.drawRows?.get(slotKey);
        const rowClasses = [classes, gone ? "tv-row--gone" : "", draw ? "tv-row--draw" : ""].filter(Boolean).join(" ");
        return (
          <div key={slot.slot ?? index} className={rowClasses} data-tv-slot={slotKey} data-slot-anchor={`${match.id}:${slot.slot ?? index + 1}`} data-tv-reg={registrationId || undefined} data-slot-kind={info.kind} data-outcome={kind || undefined}
            style={draw ? { "--tv-i": draw.index, "--tv-draw-step": `${tree.drawStep || 60}ms` } : undefined}>
            <div className="tv-row__who">
              <div className={`tv-avatar tv-t-meta ${short || avatar ? "" : "tv-avatar--empty"}`} aria-hidden="true" data-tv-avatar="1">
                {avatar && info.kind === "player" ? <img src={resolveMediaUrl(avatar)} alt="" /> : short}
              </div>
              {label ? (
                <span className="tv-t-name tv-row__name" data-fit={fit.small ? "small" : undefined} data-tv-name="1">
                  {(won || gold) && !heat ? <Trophy className="tv-icon tv-gold" aria-hidden="true" /> : null}
                  <span className="min-w-0">{label}</span>
                  {gone ? <span className="tv-row__gone tv-t-meta">{gone}</span> : null}
                </span>
              ) : null}
            </div>
            {heat && result ? (
              <div className="tv-row__score">
                <span className="tv-t-num font-display">#{result.rank}</span>
                {score !== null && score !== undefined ? <span className="tv-t-meta tv-row__points">{score} Pkt.</span> : null}
              </div>
            ) : !heat && score !== null && score !== undefined ? (
              <div className="tv-row__score"><span key={score} className="tv-t-num font-display">{score}</span></div>
            ) : null}
          </div>
        );
      })}
      {live ? <TvSpotlight match={match} className="tv-node__spot" /> : null}
    </article>
  );
}
