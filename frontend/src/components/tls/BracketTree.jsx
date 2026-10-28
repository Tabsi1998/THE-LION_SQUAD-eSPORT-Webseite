import { displayRoundLabels, roundName } from "@/lib/bracketNames";
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, createContext } from "react";
import { Link, useInRouterContext } from "react-router-dom";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Trophy } from "lucide-react";
import { formatBracketSection } from "@/lib/tournamentLabels";
import { isTableFormat } from "@/lib/bracketSections";
import { asInstant, viennaTime } from "@/lib/vienna";
import { finderFor, initials } from "@/lib/slotSource";
import { buildPodiumMap, finalMatchOf, isBronzeMatch, lastStageId, normalizeSection } from "@/lib/bracketPodium";
import { bracketEdges, drawRails, isCancelled, isDone, isLive, orderEdges, pathFor, sectionGroup } from "@/lib/bracketGraph";
import { motionTransition } from "@/lib/motion";
import { stageLines } from "@/lib/bracketLines";
import { TV_LINE, TV_STAGE_UNIT_PX, treeBlockUnits, treeBox, treeScale } from "@/lib/tvType";
import { effectiveMatchDuration } from "@/lib/matchDuration";
import { BracketMotionContext, useBracketMotion, useBracketMotionState } from "./bracket/bracketMotion";
import { LiveClock, MatchCard, getStationLabel, slotLabel, formatNodeDateTime } from "./bracket/BracketCards";
import {
  ChangedMatchesContext, DurationContext, EMPTY_SET, FinderContext, FinishedContext, GraphContext, MatchLinkContext, MineContext, PathContext,
} from "./bracket/context";

/**
 * Turnierbaum (#399, neu mit #1561): K.-o.-Runden als Spalten auf einer Leinwand, die Linien kommen aus den echten
 * Quellen der Plätze (lib/bracketGraph) - auch zwischen Winner und Loser Bracket, ins Grand Final und in den Reset.
 * Ruhige Karten (#1340), Runden mit Namen (#1259, `round_label` vom Server), Lauf-Karte mit „2 kommen weiter → C“
 * (#1178), Pokal am Ende. Dein Weg per Tipp (#1177), auch am Handy; ein Tipp ins Leere hebt ihn auf. Laufende Spiele
 * atmen in der Live-Farbe, mit Station und Spielzeit; am Handy stehen sie oben. Bewegungen kommen aus dem Vergleich
 * alter/neuer Stand (components/tls/bracket/bracketMotion) - genau einmal, mit „Bewegung reduzieren“ sofort am Ende.
 * Gruppen, Liga und Schweizer System sind keine Baum-Spalten, sondern ein Verweis auf Tabelle und Spielplan.
 *
 * `data` ist die Antwort von /api/tournaments/:id/bracket; `mineId` die eigene Anmeldung. `quietUpdate`: der neue Stand
 * kommt aus einem Nachladen nach einer Neuverbindung - dann springt alles ohne Bewegung ans Ende.
 *
 * TV-Fassung (#1115, `viewMode="tv"`): derselbe Baum mit Linien, Winner Bracket, Loser Bracket und Grand Final als
 * Blöcke; die Karten zeichnet `nodeRenderer` (die TV-Karte), Liga, Gruppen und Schweizer System als Raster.
 */
// Podium und letzte Phase wohnen seit #1119 in lib/bracketPodium (auch der Champion am TV braucht sie).
export { buildPodiumMap, lastStageId };
// Kürzel für Spieler ohne Bild (#833, #1113).
export { initials };

// TV (#1115): eine eigene Karte statt der Karte der Turnierseite, und wie viele Spalten ins Bild passen.
const NodeRendererContext = createContext(null);
const TvLayoutContext = createContext({ columns: 4, viewport: null, minZoom: 1, textSize: "normal" });

const FINISHED_TOURNAMENT = new Set(["completed", "results_published", "archived", "cancelled"]);
const DONE_STATUSES = new Set(["completed", "finished", "reported", "confirmed"]);
const LIVE_STATUSES = new Set(["running", "in_progress"]);
// Abstand der Spalten - die Linien brauchen Platz für ihren Knick.
const COLUMN_GAP = 48;
// Breite einer Spalte bzw. Karte auf der Leinwand.
const CARD_WIDTH = 232;
const CHAMPION_ID = "bracket-champion";

/** Liegt diese Partie auf dem hervorgehobenen Weg - oder wird sie gedämpft? */
export function pathState(ids, registrationIds) {
  if (!ids || !ids.size) return "";
  return registrationIds.some((id) => id && ids.has(id)) ? "on" : "off";
}

function useIsNarrow() {
  const [narrow, setNarrow] = useState(() => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? !window.matchMedia("(min-width: 768px)").matches : false));
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia("(min-width: 768px)");
    const update = () => setNarrow(!query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return narrow;
}

/** Dein Weg: angetippt (bleibt) oder nur vorab (Maus, Tastatur) - daraus die Spiele und Linien auf dem Weg. */
function usePath(matches, edges) {
  const [selected, setSelected] = useState(null);
  const [previewIds, setPreviewIds] = useState(null);
  const ids = previewIds && previewIds.size ? previewIds : selected ? new Set([selected]) : null;
  const key = ids ? [...ids].sort().join("|") : "";
  const active = useMemo(() => {
    if (!key) return null;
    const result = { ids: new Set(key.split("|")), matches: new Set(), edges: new Set(), rails: new Set() };
    for (const id of key.split("|")) {
      const path = pathFor(id, matches, edges);
      path.matches.forEach((value) => result.matches.add(value));
      path.edges.forEach((value) => result.edges.add(value));
      path.rails?.forEach((value) => result.rails.add(value));
    }
    return result;
  }, [key, matches, edges]);
  const toggle = useCallback((id) => setSelected((current) => (current === id ? null : id)), []);
  const clear = useCallback(() => { setSelected(null); setPreviewIds(null); }, []);
  // Ein Tipp ins Leere (oder Escape) hebt den Weg auf. Namen, Knöpfe und Links zählen nicht als leer.
  useEffect(() => {
    if (!selected) return undefined;
    const onKey = (event) => { if (event.key === "Escape") setSelected(null); };
    const onClick = (event) => {
      if (event.target?.closest?.("[data-path-trigger], button, a, input, select, textarea")) return;
      setSelected(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, [selected]);
  return useMemo(() => ({ active, selected, toggle, clear, preview: setPreviewIds }), [active, selected, toggle, clear]);
}

export function BracketTree({ data, compact = false, viewMode = "standard", onMatchClick, changedMatchIds = EMPTY_SET, mineId = null, layout = "auto", nodeRenderer = null, tvLayout = null, quietUpdate = false }) {
  const { matches_v2: matchesRaw, stages: stagesRaw, registrations: registrationsRaw } = data || {};
  // Rundennamen je Abschnitt fortlaufend (#1591): das Loser Bracket beginnt mit „Loser Runde 1“.
  const matches_v2 = useMemo(() => displayRoundLabels(matchesRaw || []), [matchesRaw]);
  const stages = useMemo(() => stagesRaw || [], [stagesRaw]);
  const registrations = useMemo(() => registrationsRaw || [], [registrationsRaw]);
  const isTv = viewMode === "tv";
  const finished = FINISHED_TOURNAMENT.has(String(data?.tournament?.status || ""));
  const podiumMap = useMemo(() => buildPodiumMap(matches_v2, stages), [matches_v2, stages]);
  const regMap = useMemo(() => new Map(registrations.map((reg) => [reg.id, reg])), [registrations]);
  const mine = mineId || registrations.find((reg) => reg?.is_mine)?.id || null;
  const finder = useMemo(() => finderFor(matches_v2), [matches_v2]);
  const edges = useMemo(() => {
    const real = bracketEdges(matches_v2);
    if (real.length) return real;
    // Alte Bäume ohne Herkunft der Plätze: Linien nach der Reihenfolge wie früher, je Abschnitt.
    return Object.values(groupMatches(matches_v2)).flatMap((sections) => Object.values(sections)
      .filter((rounds) => !isTableFormat(Object.values(rounds).flat()))
      .flatMap((rounds) => orderEdges(roundNumbers(rounds).map((rn) => rounds[rn]))));
  }, [matches_v2]);
  const finalMatch = useMemo(() => finalMatchOf(matches_v2, stages), [matches_v2, stages]);
  const graph = useMemo(() => {
    const decisive = new Set(matches_v2.filter((match) => isBronzeMatch(match) || sectionGroup(match.section) === "final").map((match) => match.id));
    if (finalMatch) decisive.add(finalMatch.id);
    return { edges, byId: new Map(matches_v2.map((match) => [match.id, match])), decisive, matches: matches_v2, finalId: finalMatch?.id || null };
  }, [edges, matches_v2, finalMatch]);
  const path = usePath(matches_v2, edges);
  const motionValue = useBracketMotion(isTv ? null : matches_v2, { quiet: quietUpdate });
  const narrow = useIsNarrow();
  const steps = !isTv && (layout === "steps" || (layout === "auto" && narrow));
  const tournamentPath = data?.tournament ? `/tournaments/${data.tournament.slug || data.tournament.id}` : "";
  const tvColumns = tvLayout?.columns || 4;
  const tvViewportW = tvLayout?.viewport?.w || 0;
  const tvViewportH = tvLayout?.viewport?.h || 0;
  const tvMinZoom = tvLayout?.minZoom || 1;
  const tvTextSize = tvLayout?.textSize || "normal";
  const tvValue = useMemo(() => ({
    columns: tvColumns,
    viewport: tvViewportW && tvViewportH ? { w: tvViewportW, h: tvViewportH } : null,
    minZoom: tvMinZoom,
    textSize: tvTextSize,
  }), [tvColumns, tvViewportW, tvViewportH, tvMinZoom, tvTextSize]);
  const linkValue = useMemo(() => ({ onMatchClick: onMatchClick || null }), [onMatchClick]);
  // Die Dauer-Kette (#1554): ohne eigenen Wert am Spiel gelten Phase, Turnier und Spiel (Modus) aus der Antwort.
  const durationTournament = data?.tournament;
  const durationGame = data?.duration_game;
  const duration = useMemo(() => {
    const stageById = new Map(stages.map((stage) => [stage?.id, stage]));
    return (match) => effectiveMatchDuration(match, { stage: stageById.get(match?.stage_id), tournament: durationTournament, game: durationGame });
  }, [stages, durationTournament, durationGame]);

  const tree = isTv ? (
    <TvStageTree stages={stages} matches={matches_v2} regMap={regMap} podiumMap={podiumMap} compact={compact} onMatchClick={onMatchClick} />
  ) : (
    <div data-bracket-root="" data-season-quiet="bracket" className="space-y-8">
      {mine && !finished ? <NextMatchBanner matches={matches_v2} regMap={regMap} mineId={mine} /> : null}
      {steps && !finished ? <LiveStrip matches={matches_v2} regMap={regMap} /> : null}
      <WebStages stages={stages} matches={matches_v2} regMap={regMap} podiumMap={podiumMap} steps={steps} finalMatch={finalMatch} tournamentPath={tournamentPath} />
    </div>
  );

  return (
    <MotionConfig reducedMotion="user">
      <NodeRendererContext.Provider value={nodeRenderer}>
        <TvLayoutContext.Provider value={tvValue}>
          <FinderContext.Provider value={finder}>
            <ChangedMatchesContext.Provider value={changedMatchIds || EMPTY_SET}>
              <MineContext.Provider value={mine}>
                <FinishedContext.Provider value={finished}>
                  <GraphContext.Provider value={graph}>
                    <PathContext.Provider value={path}>
                      <MatchLinkContext.Provider value={linkValue}>
                        <DurationContext.Provider value={duration}>
                          <BracketMotionContext.Provider value={motionValue}>
                            {tree}
                          </BracketMotionContext.Provider>
                        </DurationContext.Provider>
                      </MatchLinkContext.Provider>
                    </PathContext.Provider>
                  </GraphContext.Provider>
                </FinishedContext.Provider>
              </MineContext.Provider>
            </ChangedMatchesContext.Provider>
          </FinderContext.Provider>
        </TvLayoutContext.Provider>
      </NodeRendererContext.Provider>
    </MotionConfig>
  );
}

// Formate, die in einer Tabelle ausgespielt werden statt in einem Baum - seit #2121 in lib/bracketSections (auch die
// Druckansicht braucht die Regel).
export { isTableFormat };

/** „Dein nächstes Spiel“: das erste noch offene Match mit der eigenen Anmeldung. */
export function nextMatchFor(matches = [], mineId) {
  if (!mineId) return null;
  const own = matches.filter((match) => (match.slots || []).some((slot) => slot.registration_id === mineId) && !DONE_STATUSES.has(String(match.status || "").toLowerCase()) && String(match.status || "").toLowerCase() !== "cancelled");
  own.sort((a, b) => {
    const live = Number(LIVE_STATUSES.has(String(b.status || "").toLowerCase())) - Number(LIVE_STATUSES.has(String(a.status || "").toLowerCase()));
    if (live) return live;
    const at = a.scheduled_at ? new Date(a.scheduled_at).getTime() : Infinity;
    const bt = b.scheduled_at ? new Date(b.scheduled_at).getTime() : Infinity;
    if (at !== bt) return at - bt;
    return (a.round || 0) - (b.round || 0) || (a.order || 0) - (b.order || 0);
  });
  return own[0] || null;
}

// Eine Regel mit der Druckansicht (#1283): lib/bracketNames.roundName.
const roundNameOf = roundName;

function NextMatchBanner({ matches, regMap, mineId }) {
  const { onMatchClick } = useContext(MatchLinkContext);
  const match = nextMatchFor(matches, mineId);
  if (!match) return null;
  const opponents = (match.slots || []).filter((slot) => slot.registration_id && slot.registration_id !== mineId).map((slot) => slotLabel(slot, regMap)).filter(Boolean);
  const live = LIVE_STATUSES.has(String(match.status || "").toLowerCase());
  const when = formatNodeDateTime(match.scheduled_at);
  // Vorgeplant im Vorschau-Baum (oder vom Planer vorhergesagt): Orientierung, keine Zusage.
  const forecast = !live && when && (match.is_preview || match.schedule_forecast);
  const station = getStationLabel(match);
  return (
    <button
      type="button"
      onClick={() => onMatchClick?.(match)}
      data-testid="bracket-next-match"
      className={`w-full text-left rounded-md border px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-1 transition-colors duration-mid ease-tls ${live ? "border-live/50 bg-live/[0.08]" : "border-brand/45 bg-brand/[0.08]"} hover:border-white/40`}
    >
      <span className={`text-[11px] uppercase tracking-[0.25em] font-bold ${live ? "text-live" : "text-brand"}`}>{live ? "Dein Spiel läuft" : "Dein nächstes Spiel"}</span>
      <span className="font-heading text-lg font-black uppercase">{roundNameOf(match, match.round)} · {match.match_key || "Spiel"}</span>
      {opponents.length ? <span className="text-sm text-white/75">gegen {opponents.length > 3 ? `${opponents.length} Gegner` : opponents.join(", ")}</span> : <span className="text-sm text-muted-text">Gegner steht noch nicht fest</span>}
      {(when || station) && <span className="text-xs uppercase tracking-wider text-muted-text">{[forecast ? `voraussichtlich ${when}` : when, station].filter(Boolean).join(" · ")}</span>}
    </button>
  );
}

/** Am Handy (#1561): laufende Spiele oben angepinnt - mit Station und Spielzeit. */
function LiveStrip({ matches, regMap }) {
  const live = matches.filter((match) => isLive(match));
  if (!live.length) return null;
  return (
    <section data-testid="bracket-live-strip" aria-label="Läuft gerade" className="rounded-md border border-live/40 bg-live/[0.06] p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-live">
        <span className="w-1.5 h-1.5 rounded-full bg-live tv-live-dot" aria-hidden="true" /> Läuft gerade
      </div>
      <ul className="space-y-2">
        <AnimatePresence initial={false}>
          {live.map((match) => (
            <motion.li key={match.id} layout="position" initial={{ opacity: 0, transform: "translateY(-6px)" }} animate={{ opacity: 1, transform: "translateY(0px)" }} exit={{ opacity: 0 }} transition={motionTransition("mid")}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
              <span className="font-bold text-white/85">{roundNameOf(match, match.round)} · {match.match_key}</span>
              <span className="min-w-0 break-words text-white/75">{(match.slots || []).map((slot) => slotLabel(slot, regMap)).filter(Boolean).join(" – ")}</span>
              <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-live">
                {getStationLabel(match) || "läuft"}{match.started_at ? <>{" · "}<LiveClock startedAt={match.started_at} /></> : null}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}

/** Spiele nach Phase → Abschnitt → Runde, je Runde nach Reihenfolge. */
function groupMatches(matches) {
  const grouped = {};
  for (const match of matches) {
    const stageId = match.stage_id || "__default";
    const section = match.section || "MAIN";
    const round = match.round || 1;
    grouped[stageId] = grouped[stageId] || {};
    grouped[stageId][section] = grouped[stageId][section] || {};
    grouped[stageId][section][round] = grouped[stageId][section][round] || [];
    grouped[stageId][section][round].push(match);
  }
  for (const sectionMap of Object.values(grouped)) {
    for (const roundMap of Object.values(sectionMap)) {
      for (const list of Object.values(roundMap)) list.sort((a, b) => (a.order || 0) - (b.order || 0));
    }
  }
  return grouped;
}

const roundNumbers = (rounds) => Object.keys(rounds).map(Number).sort((a, b) => a - b);

/** Eine Runde, die der Umbau ganz gestrichen hat (#1575, abgekürzt), fällt aus der Ansicht weg - wie in Vorschau 2. */
function withoutDroppedRounds(sections) {
  const dropped = (list) => list.length > 0 && list.every((match) => String(match.status || "").toLowerCase() === "cancelled" && match.result_meta?.source === "heat_rebuild");
  const out = {};
  for (const [name, rounds] of Object.entries(sections)) {
    const kept = Object.fromEntries(Object.entries(rounds).filter(([, list]) => !dropped(list)));
    if (Object.keys(kept).length) out[name] = kept;
  }
  return out;
}

/** Der Fluss zwischen den Blöcken (#399): wer verliert, wechselt in die Verliererrunde. */
function sectionFlowHint(section, hasLoser, hasReset = false) {
  const key = normalizeSection(section);
  if (!hasLoser) return "";
  if (["wb", "winner", "main"].includes(key)) return "Wer hier verliert, spielt im Loser Bracket weiter.";
  if (sectionGroup(section) === "loser") return "Wer hier verliert, scheidet aus; der Sieger trifft im Grand Final auf den Sieger des Winner Bracket.";
  if (["gf", "grand_final"].includes(key)) {
    return hasReset
      ? "Sieger der Siegerrunde gegen Sieger der Verliererrunde. Gewinnt die Verliererrunde, folgt ein Reset-Spiel - sonst entfällt es."
      : "Sieger der Siegerrunde gegen Sieger der Verliererrunde.";
  }
  return "";
}

/** Gibt es in dieser Phase ein Reset-Spiel (#1549)? */
function hasResetMatch(stageSections) {
  return Object.values(stageSections).some((roundMap) => Object.values(roundMap).some((list) => list.some((match) => match?.settings?.bracket_reset)));
}

/** Runden-Kopf - leer, wenn er nur den Abschnitt wiederholt (#833). */
export function roundTitle(match, number, sectionTitle = "") {
  const title = roundNameOf(match, number);
  return sectionTitle && title.toLowerCase() === String(sectionTitle).toLowerCase() ? "" : title;
}

/** Runden-Kopf mit Uhrzeit (#1340): „Viertelfinale · 18:30“ - die früheste geplante Zeit der Runde. */
function roundHeading(list, number, sectionTitle) {
  const title = roundTitle(list[0], number, sectionTitle);
  const times = list.map((match) => match.scheduled_at).filter(Boolean)
    .map((value) => ({ value, at: asInstant(value).getTime() })).filter((entry) => !Number.isNaN(entry.at));
  if (!times.length || list.every((match) => isDone(match))) return title;
  const earliest = times.reduce((best, entry) => (entry.at < best.at ? entry : best));
  const time = viennaTime(earliest.value, { hour: "2-digit", minute: "2-digit" });
  const forecast = list.some((match) => match.is_preview || match.schedule_forecast);
  return [title, forecast && time ? `voraussichtlich ${time}` : time].filter(Boolean).join(" · ");
}

function tableTitle(names, sections) {
  const first = Object.values(sections[names[0]] || {}).flat()[0] || {};
  if (names.some((name) => /^group_/i.test(name)) || first.stage_type === "round_robin_groups") return "Gruppenphase";
  if (first.stage_type === "swiss" || /swiss/i.test(names[0])) return "Schweizer System";
  return "Liga";
}

// Der Satz je Format (#2124, TP14): im Schweizer System spielt nicht jeder gegen jeden.
const TABLE_HINT_TEXT = {
  Liga: "Hier spielt jeder gegen jeden: Wer vorne liegt, steht in der Tabelle, wann wer spielt, im Spielplan.",
  Gruppenphase: "In jeder Gruppe spielt jeder gegen jeden: Wer vorne liegt, steht in der Tabelle, wann wer spielt, im Spielplan.",
  "Schweizer System": "Jede Runde treffen Teilnehmer mit gleich vielen Punkten aufeinander – die nächste Runde wird erst nach der vorigen ausgelost. Den Stand zeigt die Tabelle, die Paarungen der Spielplan.",
};

/** Gruppen, Liga, Swiss (#1561): kein Baum, sondern der Weg zu Tabelle und Spielplan (die Tabelle selbst: #1562). */
function TableHint({ title, tournamentPath }) {
  const inRouter = useInRouterContext();
  const Anchor = ({ to, children }) => (inRouter
    ? <Link to={to} className="tls-btn tls-btn--secondary inline-flex px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">{children}</Link>
    : <a href={to} className="tls-btn tls-btn--secondary inline-flex px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">{children}</a>);
  return (
    <div data-testid="bracket-table-hint" className="rounded-md border border-white/10 bg-surface-1 p-5 space-y-3">
      <h3 className="font-heading text-lg font-black uppercase">{title}</h3>
      <p className="text-sm text-muted-text max-w-prose" data-testid="bracket-table-hint-text">{TABLE_HINT_TEXT[title] || TABLE_HINT_TEXT.Liga}</p>
      {tournamentPath ? (
        <div className="flex flex-wrap gap-2">
          <Anchor to={`${tournamentPath}/standings`}>Zur Tabelle</Anchor>
          <Anchor to={`${tournamentPath}/matches`}>Zum Spielplan</Anchor>
        </div>
      ) : null}
    </div>
  );
}

function WebStages({ stages, matches, regMap, podiumMap, steps, finalMatch, tournamentPath }) {
  const byStage = useMemo(() => groupMatches(matches), [matches]);
  const stagesForView = stages.length ? stages : [{ id: "__default", name: "Turnierbaum", number: 1 }];
  return stagesForView.map((stage) => {
    const sections = withoutDroppedRounds(byStage[stage.id] || {});
    const names = Object.keys(sections);
    const multi = stagesForView.length > 1;
    const heading = multi ? (
      <div className="flex items-center gap-2 uppercase tracking-[0.2em] text-xs font-bold">
        <span className="w-2 h-2 bg-brand" aria-hidden="true" />
        <span className="text-white/80">{stage.name || `Phase ${stage.number || ""}`}</span>
      </div>
    ) : null;
    if (!names.length) {
      return (
        <div key={stage.id} className="space-y-4">
          {heading}
          <div className="rounded-md border border-white/10 bg-surface-1 p-8 text-center text-muted-text">Noch keine Spiele</div>
        </div>
      );
    }
    const tableNames = names.filter((name) => isTableFormat(Object.values(sections[name]).flat()));
    const treeNames = names.filter((name) => !tableNames.includes(name));
    const champion = finalMatch && (finalMatch.stage_id || "__default") === stage.id ? finalMatch : null;
    const hasLoser = treeNames.some((name) => sectionGroup(name) === "loser");
    const hasReset = hasResetMatch(sections);
    return (
      <div key={stage.id} className="space-y-4">
        {heading}
        {tableNames.length ? <TableHint title={tableTitle(tableNames, sections)} tournamentPath={tournamentPath} /> : null}
        {treeNames.length ? (steps ? (
          <div className="space-y-8">
            {treeNames.map((name) => (
              <SectionSteps key={name} section={name} rounds={sections[name]} regMap={regMap} podiumMap={podiumMap} flowHint={sectionFlowHint(name, hasLoser, hasReset)} />
            ))}
            {champion ? <ChampionCard match={champion} regMap={regMap} /> : null}
          </div>
        ) : (
          <StageCanvas stageId={stage.id} sections={sections} names={treeNames} regMap={regMap} podiumMap={podiumMap} champion={champion} hasLoser={hasLoser} hasReset={hasReset} />
        )) : null}
      </div>
    );
  });
}

function SectionTitle({ section, flowHint, sticky = false, fit = false }) {
  const key = normalizeSection(section);
  const group = sectionGroup(section);
  // Auf der Leinwand (`fit`) höchstens so breit wie eine Karte (#1561): Titel und Erklärzeile stehen über der ersten
  // Spalte, die Gassen daneben bleiben für die Linien frei. Am Handy (Runde für Runde) volle Breite.
  return (
    <div className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 ${sticky ? "sticky left-0" : ""}`} style={fit ? { maxWidth: CARD_WIDTH } : undefined} data-section-head={fit ? "" : undefined}>
      <div className="flex items-center gap-2 uppercase tracking-[0.2em] text-xs font-bold">
        <span className={`w-2 h-2 ${group === "loser" ? "bg-quiet" : group === "final" ? "bg-honor" : "bg-brand"}`} aria-hidden="true" />
        <span className="text-white/80" data-testid={`bracket-section-title-${key}`}>{formatBracketSection(section)}</span>
      </div>
      {flowHint ? <span className="text-xs text-muted-text">{flowHint}</span> : null}
    </div>
  );
}

/** Am Handy (#399): eine Runde auf einmal, „Runde x von y“, vor und zurück; startet bei deinem nächsten Spiel. */
function SectionSteps({ section, rounds, regMap, podiumMap, flowHint }) {
  const mine = useContext(MineContext);
  const roundNums = useMemo(() => roundNumbers(rounds), [rounds]);
  const initial = useMemo(() => {
    if (!mine) return 0;
    const next = nextMatchFor(roundNums.flatMap((rn) => rounds[rn]), mine);
    const index = next ? roundNums.indexOf(Number(next.round || 1)) : -1;
    return index >= 0 ? index : 0;
  }, [mine, roundNums, rounds]);
  const [step, setStep] = useState(initial);
  // Richtung des Blätterns: die neue Runde kommt von der Seite, in die geblättert wurde (#1561).
  const [direction, setDirection] = useState(0);
  const go = (to) => { setDirection(to > step ? 1 : -1); setStep(to); };
  const current = Math.min(step, roundNums.length - 1);
  const rn = roundNums[current];
  return (
    <section className="space-y-3" data-testid={`bracket-section-${normalizeSection(section)}`}>
      <SectionTitle section={section} flowHint={flowHint} />
      <div className="space-y-3" data-testid="bracket-steps">
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={() => go(Math.max(0, current - 1))} disabled={current === 0} data-testid="bracket-step-prev" aria-label="Vorige Runde" className="tls-btn tls-btn--quiet shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-sm disabled:opacity-35"><ChevronLeft className="h-5 w-5" aria-hidden="true" /></button>
          <div className="text-center min-w-0 flex-1">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-text" data-testid="bracket-step-label">Runde {current + 1} von {roundNums.length}</div>
            {/* Ganze Wörter (#1561): keine Silbentrennung wie sonst bei Überschriften am Handy, lieber zwei ausgeglichene Zeilen. */}
            <div className="font-heading text-sm font-black uppercase leading-tight ![hyphens:none] [text-wrap:balance]" data-testid="bracket-round-title">{roundNameOf(rounds[rn][0], rn)}</div>
          </div>
          <button type="button" onClick={() => go(Math.min(roundNums.length - 1, current + 1))} disabled={current >= roundNums.length - 1} data-testid="bracket-step-next" aria-label="Nächste Runde" className="tls-btn tls-btn--quiet shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-sm disabled:opacity-35"><ChevronRight className="h-5 w-5" aria-hidden="true" /></button>
        </div>
        <div key={rn} className="flex flex-col gap-3" data-step-dir={direction > 0 ? "next" : direction < 0 ? "prev" : undefined}>
          {rounds[rn].map((match) => <MatchCard key={match.id} match={match} regMap={regMap} podiumMap={podiumMap} />)}
        </div>
      </div>
    </section>
  );
}

/** Der Pokal am Ende (#1340): Sieger in Gold, vorher „noch offen“. */
function ChampionCard({ match, regMap }) {
  const winnerId = isDone(match)
    ? (match.winner_id || (match.results || []).find((row) => Number(row.rank) === 1)?.registration_id || null)
    : null;
  const name = winnerId ? slotLabel({ registration_id: winnerId }, regMap) : "";
  const { active } = useContext(PathContext);
  const { state: motionState } = useBracketMotionState();
  const state = active ? (winnerId && active.ids.has(winnerId) ? "on" : "off") : "";
  // Der Sieger-Moment: steht das Finale gerade fest, läuft einmal der goldene Schimmer über den Pokal.
  const crowned = Boolean(winnerId) && motionState.pop.has(match.id);
  return (
    <div data-node={CHAMPION_ID} data-testid="bracket-champion" data-path={state || undefined} data-done={winnerId ? "1" : undefined} data-sweep={crowned ? "1" : undefined} className={`tls-bracket-champion ${crowned ? "tls-winner-sweep is-crowned" : ""}`}>
      <Trophy className={`tls-bracket-trophy w-6 h-6 shrink-0 ${winnerId ? "text-honor" : "text-quiet"}`} aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-text">Sieger</div>
        {winnerId
          ? <div className="font-heading text-base font-black uppercase break-words text-honor">{name}</div>
          : <div className="text-sm italic text-quiet">noch offen</div>}
      </div>
    </div>
  );
}

/** Geht es seitlich weiter (#1591)? `data-more` „left“, „right“ oder „both“ blendet den Rand aus (index.css). */
function markMore(canvas) {
  if (!canvas) return;
  const left = canvas.scrollLeft > 1;
  const right = canvas.scrollLeft + canvas.clientWidth < canvas.scrollWidth - 1;
  const value = left && right ? "both" : left ? "left" : right ? "right" : "";
  if (value) canvas.setAttribute("data-more", value);
  else canvas.removeAttribute("data-more");
}

/**
 * Die Leinwand einer Phase am Desktop: links Hauptfeld und Loser Bracket untereinander, rechts Grand Final, Pokal und
 * Spiel um Platz 3. Die Linien liegen als ein SVG darüber und werden nur gemessen, wenn sich Daten oder Größen ändern
 * (ResizeObserver, gebündelt in einem Frame) - nie beim Antippen eines Weges.
 */
function StageCanvas({ stageId, sections, names, regMap, podiumMap, champion, hasLoser, hasReset }) {
  const canvasRef = useRef(null);
  const contentRef = useRef(null);
  const [geom, setGeom] = useState({ lines: [], w: 0, h: 0, key: "" });
  const { edges, byId } = useContext(GraphContext);
  const byIdMatch = useCallback((id) => byId.get(id), [byId]);
  const championId = champion && isDone(champion)
    ? (champion.winner_id || (champion.results || []).find((row) => Number(row.rank) === 1)?.registration_id || null)
    : null;
  const { active } = useContext(PathContext);
  const { state: motionState } = useBracketMotionState();
  const left = names.filter((name) => ["main", "loser"].includes(sectionGroup(name)));
  const right = names.filter((name) => !left.includes(name));
  const order = (list) => [...list].sort((a, b) => ["main", "loser", "final", "bronze"].indexOf(sectionGroup(a)) - ["main", "loser", "final", "bronze"].indexOf(sectionGroup(b)));
  const stageMatchIds = useMemo(() => new Set(names.flatMap((name) => Object.values(sections[name]).flat().map((match) => match.id))), [names, sections]);
  // Gemischte Runden dieser Phase (#1548): ihre Sammelschienen (drawRails, wie App und TV).
  const stageRails = useMemo(() => drawRails(names.flatMap((name) => Object.values(sections[name]).flat())), [names, sections]);
  const stageEdges = useMemo(() => {
    const list = edges.filter((edge) => stageMatchIds.has(edge.from) && stageMatchIds.has(edge.to));
    if (champion && stageMatchIds.has(champion.id)) list.push({ id: `${champion.id}>${CHAMPION_ID}`, from: champion.id, to: CHAMPION_ID, toSlot: 0, flow: "W", rank: 1, cross: false, void: false });
    return list;
  }, [edges, stageMatchIds, champion]);
  const columnOf = useMemo(() => {
    const map = new Map();
    for (const name of names) roundNumbers(sections[name]).forEach((rn, index) => sections[name][rn].forEach((match) => map.set(match.id, index)));
    return map;
  }, [names, sections]);
  // Liegt ein Ziel einer Gruppe in der ersten Spalte (Loser-Runde 1), braucht die Schiene links eine Gasse.
  // Ebenso der Eingang eines Abstiegs (#1591), der in die erste Spalte des Loser Brackets führt.
  const busLead = stageRails.some((rail) => rail.targets.some((id) => columnOf.get(id) === 0))
    || stageEdges.some((edge) => edge.flow === "L" && edge.cross && columnOf.get(edge.to) === 0);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const base = canvas.getBoundingClientRect();
      const ox = canvas.scrollLeft - base.left;
      const oy = canvas.scrollTop - base.top;
      // Alles in Leinwand-Koordinaten (mit Scroll): Karten sind die Hindernisse, die Lücken über und unter den
      // Abschnitten die freien Querbahnen (#1561: keine Linie schneidet eine Karte).
      const local = (rect) => ({ left: rect.left + ox, right: rect.right + ox, top: rect.top + oy, bottom: rect.bottom + oy, width: rect.width, height: rect.height });
      const nodes = new Map();
      canvas.querySelectorAll("[data-node]").forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.width) nodes.set(node.getAttribute("data-node"), local(rect));
      });
      const anchors = new Map();
      canvas.querySelectorAll("[data-slot-anchor]").forEach((node) => anchors.set(node.getAttribute("data-slot-anchor"), node.getBoundingClientRect()));
      // Weiterkommer verlassen einen Lauf an der Zeile „kommen weiter“, die anderen an „Die anderen …“ (#1591).
      const exits = new Map();
      canvas.querySelectorAll("[data-exit-anchor]").forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.height) exits.set(node.getAttribute("data-exit-anchor"), rect.top + rect.height / 2 + oy);
      });
      const corridors = [];
      canvas.querySelectorAll("section[data-testid^='bracket-section-']").forEach((node) => {
        const rect = local(node.getBoundingClientRect());
        if (rect.height) corridors.push(rect.top - 20, rect.bottom + 20);
      });
      // Auch die Köpfe der Abschnitte (Titel, Erklärzeile, Rundentitel) sind Hindernisse.
      const heads = [];
      canvas.querySelectorAll("[data-section-head], [data-testid='bracket-round-title']").forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.width) heads.push(local(rect));
      });
      const obstacles = [...nodes.values(), ...heads];
      // Eine Rechnung für Web und TV (lib/bracketLines.stageLines): Sammelschienen (#1548) und echte Linien.
      const lines = stageLines({
        edges: stageEdges,
        rails: stageRails,
        nodes,
        slotY: (id, slot) => {
          const anchor = anchors.get(`${id}:${slot}`);
          return anchor && anchor.height ? anchor.top + anchor.height / 2 + oy : undefined;
        },
        exitY: (id, flow) => exits.get(`${id}:${flow}`),
        corridors: corridors.filter((y) => y > 2),
        obstacles,
        gap: COLUMN_GAP,
        columnOf,
        matchOf: byIdMatch,
        isVoid: (id) => isCancelled(byIdMatch(id)),
      });
      const w = canvas.scrollWidth;
      const h = canvas.scrollHeight;
      const overflow = w > canvas.clientWidth + 1;
      markMore(canvas);
      const key = `${w}x${h}|${overflow}|${lines.map((line) => `${line.id}:${line.d}`).join(";")}`;
      setGeom((current) => (current.key === key ? current : { lines, w, h, key, overflow }));
    };
    const schedule = () => {
      if (frame || typeof requestAnimationFrame !== "function") { if (!frame) measure(); return; }
      frame = requestAnimationFrame(measure);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(schedule);
    if (contentRef.current) observer.observe(contentRef.current);
    // Auch die Leinwand selbst: wird das Fenster schmaler, kommt der Hinweis zum Scrollen (#1591).
    observer.observe(canvas);
    canvas.querySelectorAll("[data-node]").forEach((node) => observer.observe(node));
    return () => {
      observer.disconnect();
      if (frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    };
  }, [stageEdges, stageRails, columnOf, sections, byIdMatch]);

  const onScroll = useCallback((event) => markMore(event.currentTarget), []);

  // Zeigen oder Tippen auf eine Karte (#1591): ihre Abstiege, die Äste in eine Schiene und die Einzelwege erscheinen.
  // Nur Attribute an den Linien - die Karten rendern dafür nicht neu.
  const focusRef = useRef(null);
  const focusOn = useCallback((id) => {
    const svg = canvasRef.current?.querySelector("[data-testid='bracket-connectors']");
    if (!svg || focusRef.current === id) return;
    focusRef.current = id;
    svg.querySelectorAll("[data-focus]").forEach((node) => node.removeAttribute("data-focus"));
    if (id) svg.querySelectorAll(`[data-rel~="${id}"]`).forEach((node) => node.setAttribute("data-focus", "1"));
  }, []);
  const onPointerOver = useCallback((event) => {
    const node = event.target?.closest?.("[data-node]");
    focusOn(node ? node.getAttribute("data-node") : null);
  }, [focusOn]);
  const onPointerLeave = useCallback(() => focusOn(null), [focusOn]);
  useEffect(() => { focusRef.current = null; }, [geom.key]);

  // Kompakt (#1591): hat das Loser Bracket mehr Runden als das Winner Bracket, stehen Grand Final, Reset und Pokal in
  // der freien Spalte rechts neben dem Winner Bracket (über der letzten Loser-Runde) - untereinander statt nebeneinander.
  // So passt ein Doppel-K.-o. mit 8 oder 16 Läufen bei 1440 px ohne Abschneiden.
  const columnsOf = (group) => Math.max(0, ...left.filter((name) => sectionGroup(name) === group).map((name) => roundNumbers(sections[name]).length));
  const mains = left.filter((name) => sectionGroup(name) === "main");
  const compact = Boolean(right.length || champion) && mains.length === 1 && columnsOf("loser") > columnsOf("main");
  const finals = order(right).filter((name) => sectionGroup(name) === "final");
  // Nur K.-o. ohne Loser Bracket und ohne weitere Abschnitte: der Pokal steht unter dem Finale in der letzten Spalte,
  // statt eine ganze Spalte breiter zu machen (#1591).
  const championBelow = Boolean(champion) && !right.length && !left.some((name) => sectionGroup(name) === "loser") && mains.length === 1;
  const others = order(right).filter((name) => sectionGroup(name) !== "final");

  const block = (name, { stacked = false, trophy = false } = {}) => (
    <section key={name} className="space-y-3" data-testid={`bracket-section-${normalizeSection(name)}`}>
      <SectionTitle section={name} flowHint={sectionFlowHint(name, hasLoser, hasReset)} sticky={left.includes(name)} fit />
      <div className={stacked ? "flex flex-col gap-6" : "flex items-stretch"} style={stacked ? undefined : { gap: COLUMN_GAP }}>
        {roundNumbers(sections[name]).map((rn, index, all) => (
          <div key={rn} className="flex shrink-0 flex-col" style={{ width: CARD_WIDTH }}>
            <div className="mb-3 min-h-[1rem] px-1 text-[11px] font-bold uppercase tracking-wider text-muted-text" data-testid="bracket-round-title">
              {roundHeading(sections[name][rn], rn, formatBracketSection(name))}
            </div>
            <div className={`flex flex-1 flex-col gap-4 ${trophy && index === all.length - 1 ? "justify-center gap-8" : "justify-around"}`}>
              {sections[name][rn].map((match) => <MatchCard key={match.id} match={match} regMap={regMap} podiumMap={podiumMap} />)}
              {trophy && index === all.length - 1 ? <ChampionCard match={champion} regMap={regMap} /> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );

  return (
    <>
    {geom.overflow ? (
      <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-text" data-testid="bracket-scroll-hint">
        <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Der Baum ist breiter als das Fenster – seitlich scrollen.
      </p>
    ) : null}
    <div ref={canvasRef} className="tls-bracket-canvas relative tls-swipe pb-4" data-testid="bracket-tree" data-stage={stageId} onPointerOver={onPointerOver} onPointerLeave={onPointerLeave} onScroll={onScroll}>
      <svg className="pointer-events-none absolute left-0 top-0" width={geom.w || "100%"} height={geom.h || "100%"} aria-hidden="true" data-testid="bracket-connectors">
        {geom.lines.map((line) => {
          // Gerüst der Schiene: an, solange dein Weg (noch vor der Auslosung) hierher führt - danach leuchtet der echte Weg.
          const onRail = !active ? false
            : line.spine ? [...(active.rails || [])].some((key) => key.startsWith(`${line.spine}:`))
              : line.scaffold === "in" ? (line.railKeys ? line.railKeys.some((key) => active.rails?.has(key)) : active.rails?.has(line.railKey)) : false;
          const state = active ? (onRail || active.edges.has(line.id) || (line.to === CHAMPION_ID && championId && active.ids.has(championId)) ? "on" : "off") : "";
          const fresh = line.spine || line.scaffold || line.fork || line.stub ? undefined : motionState.fresh.get(`${line.from}>${line.to}`);
          const quiet = line.flow === "L" && line.cross && !line.stub;
          const real = Boolean(line.rail && !line.scaffold && !line.spine && !line.stub);
          return (
            <path
              key={line.id}
              d={line.d}
              pathLength={line.void || line.stub || (quiet && fresh == null && !real) ? undefined : "1"}
              className={`tls-bracket-line ${line.void ? "tls-bracket-line--void" : line.stub ? "tls-bracket-line--stub" : fresh != null ? "tls-bracket-line--fresh" : real ? "tls-bracket-line--real" : quiet ? "tls-bracket-line--drop" : "tls-bracket-line--draw"}`}
              style={{ "--tls-i": line.column, ...(fresh != null ? { "--tls-fresh-delay": `${fresh.delay}ms`, "--tls-fresh-duration": `${fresh.duration}ms` } : null) }}
              data-id={line.id}
              data-demand={line.demand ? "1" : undefined}
              data-fork={line.fork ? "1" : undefined}
              data-stub={line.stub ? "1" : undefined}
              data-rel={line.rel ? line.rel.join(" ") : undefined}
              data-rail-spine={line.spine || undefined}
              data-rail-group={line.railGroup || undefined}
              data-real={real ? "1" : undefined}
              data-to-slot={line.toSlot || undefined}
              data-from={line.from}
              data-to={line.to}
              data-flow={line.flow}
              data-cross={quiet ? "1" : undefined}
              data-void={line.void ? "1" : undefined}
              data-path={state || undefined}
              data-fresh={fresh != null ? "1" : undefined}
            />
          );
        })}
        {/* Eingang (#1591): ein Marker am freien Ende - hier kommen Plätze aus einem anderen Abschnitt an. */}
        {geom.lines.filter((line) => line.marker).map((line) => (
          <circle key={`${line.id}:marker`} className="tls-bracket-marker" cx={line.marker.x} cy={line.marker.y} r={3.5} data-line-marker="1" data-rel={line.rel ? line.rel.join(" ") : undefined} data-path={active ? "off" : undefined} />
        ))}
      </svg>
      {compact ? (
        <div ref={contentRef} className="relative w-max space-y-10" data-rail-lead={busLead ? "1" : undefined} data-layout="compact" style={{ paddingLeft: busLead ? COLUMN_GAP : undefined, paddingRight: COLUMN_GAP }}>
          <div className="flex items-end" style={{ gap: COLUMN_GAP }}>
            {block(mains[0])}
            <div className="flex flex-col gap-8" style={{ width: CARD_WIDTH }}>
              {finals.map((name) => block(name, { stacked: true }))}
              {champion ? <ChampionCard match={champion} regMap={regMap} /> : null}
              {others.map((name) => block(name, { stacked: true }))}
            </div>
          </div>
          {order(left).filter((name) => name !== mains[0]).map((name) => block(name))}
        </div>
      ) : (
        <div ref={contentRef} className="relative grid w-max items-center" data-rail-lead={busLead ? "1" : undefined} style={{ gridTemplateColumns: right.length || (champion && !championBelow) ? "max-content max-content" : "max-content", columnGap: COLUMN_GAP, paddingLeft: busLead ? COLUMN_GAP : undefined }}>
          <div className="space-y-10">{order(left).map((name) => block(name, { trophy: championBelow && name === mains[0] }))}</div>
          {right.length || (champion && !championBelow) ? (
            <div className="flex flex-col justify-center gap-10">
              {finals.map((name) => block(name))}
              {champion && !championBelow ? <div style={{ width: CARD_WIDTH }}><ChampionCard match={champion} regMap={regMap} /></div> : null}
              {others.map((name) => block(name))}
            </div>
          ) : null}
        </div>
      )}
    </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------- TV

function TvStageTree({ stages, matches, regMap, podiumMap, compact, onMatchClick }) {
  const stagesForView = stages.length ? stages : [{ id: "__default", name: "Turnierbaum", number: 1 }];
  const byStage = useMemo(() => groupMatches(matches), [matches]);
  return (
    <div className="tv-tree" data-testid="tv-tree" data-season-quiet="bracket">
      {stagesForView.map((stage) => {
        // Wie im Web-Baum (#1561): eine Runde, die der Umbau ganz gestrichen hat, fällt aus der Ansicht.
        const stageSections = withoutDroppedRounds(byStage[stage.id] || {});
        const blocks = Object.keys(stageSections).map((name) => ({ name, rounds: stageSections[name] }));
        if (!blocks.length) return null;
        return (
          <TvStageCanvas key={stage.id} stage={stage} multi={stagesForView.length > 1} blocks={blocks} sections={stageSections}
            regMap={regMap} podiumMap={podiumMap} compact={compact} onMatchClick={onMatchClick} />
        );
      })}
    </div>
  );
}

/**
 * Eine Phase am TV (#1564): dieselben Linien wie im Web-Baum - aus den Quellen der Plätze (lib/bracketGraph), geführt nur
 * durch Gassen und Lücken (lib/bracketLines). Ein SVG über der ganzen Phase, deshalb auch über die Blöcke hinweg: der
 * Abstieg ins Loser Bracket (leise), die Linien aus Winner und Loser Bracket ins Grand Final und in den Reset. Jede Linie
 * endet in der Zeile ihres Platzes. Gemessen wird nur, wenn sich Daten oder Größen ändern; die Kamera vergrößert die
 * Bühne, deshalb wird zurückgerechnet. `data-points` trägt den Weg für die Fahrten (TvBracketStage).
 */
function TvStageCanvas({ stage, multi, blocks, sections, regMap, podiumMap, compact, onMatchClick }) {
  const ref = useRef(null);
  const [geom, setGeom] = useState({ lines: [], w: 0, h: 0, key: "" });
  const { edges, byId } = useContext(GraphContext);
  const byIdMatch = useCallback((id) => byId.get(id), [byId]);
  const tvLayoutValue = useContext(TvLayoutContext);
  const gap = treeBox(tvLayoutValue.textSize || "normal").colGap * TV_STAGE_UNIT_PX;
  const hasLoser = blocks.some((block) => sectionGroup(block.name) === "loser");
  const hasReset = hasResetMatch(sections);
  const treeBlocks = useMemo(() => blocks.filter((block) => !isTableFormat(Object.values(block.rounds).flat())), [blocks]);
  const columnOf = useMemo(() => {
    const map = new Map();
    for (const block of treeBlocks) roundNumbers(block.rounds).forEach((rn, index) => block.rounds[rn].forEach((match) => map.set(match.id, index)));
    return map;
  }, [treeBlocks]);
  const stageEdges = useMemo(() => edges.filter((edge) => columnOf.has(edge.from) && columnOf.has(edge.to)), [edges, columnOf]);
  // Gemischte Runden (#1548): dieselben Sammelschienen wie im Web-Baum (bracketGraph.drawRails).
  const stageRails = useMemo(() => drawRails(treeBlocks.flatMap((block) => Object.values(block.rounds).flat())), [treeBlocks]);
  // Führt eine Schiene oder ein Eingang (#1591) in die erste Spalte, braucht die Phase links eine Gasse.
  const lead = stageRails.some((rail) => rail.targets.some((id) => columnOf.get(id) === 0))
    || stageEdges.some((edge) => edge.flow === "L" && edge.cross && columnOf.get(edge.to) === 0);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const base = root.getBoundingClientRect();
      const scale = root.offsetWidth && base.width ? base.width / root.offsetWidth : 1;
      const local = (rect) => {
        const left = (rect.left - base.left) / scale;
        const top = (rect.top - base.top) / scale;
        const width = rect.width / scale;
        const height = rect.height / scale;
        return { left, top, right: left + width, bottom: top + height, width, height };
      };
      const cards = new Map();
      root.querySelectorAll("[data-tv-card]").forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.width) cards.set(node.getAttribute("data-tv-card"), local(rect));
      });
      const anchors = new Map();
      root.querySelectorAll("[data-slot-anchor]").forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.height) anchors.set(node.getAttribute("data-slot-anchor"), local(rect));
      });
      // Die Lücken über und unter den Blöcken sind die freien Querbahnen; Köpfe und Rundentitel sind Hindernisse - vom
      // Blocktitel nur Marke und Text, nicht die ganze Zeile (sonst sperrt er die Gassen darunter).
      const corridors = [];
      root.querySelectorAll("[data-tv-block]").forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (!rect.height) return;
        const box = local(rect);
        corridors.push(box.top - gap / 4, box.bottom + gap / 4);
      });
      const heads = [];
      root.querySelectorAll(".tv-block__title > *, .tv-ko__round, .tv-tree__phase").forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.width && rect.height) heads.push(local(rect));
      });
      const obstacles = [...cards.values(), ...heads];
      // Dieselbe Rechnung wie die Leinwand im Web (lib/bracketLines.stageLines) - Schienen, Abstieg, Grand Final.
      const lines = stageLines({
        edges: stageEdges,
        rails: stageRails,
        nodes: cards,
        slotY: (id, slot) => {
          const anchor = anchors.get(`${id}:${slot}`);
          return anchor ? anchor.top + anchor.height / 2 : undefined;
        },
        corridors: corridors.filter((y) => y > 2),
        obstacles,
        gap,
        columnOf,
        matchOf: byIdMatch,
        isVoid: (id) => isCancelled(byIdMatch(id)),
      }).map((line) => ({ ...line, points: line.points.map((point) => `${Math.round(point.x * 10) / 10},${Math.round(point.y * 10) / 10}`).join(" ") }));
      // Die Leinwand reicht so weit wie der Inhalt (#1591) - auch wenn eine Zeile breiter ist als die Phase.
      const w = Math.max(root.offsetWidth, root.scrollWidth) || base.width / scale;
      const h = Math.max(root.offsetHeight, root.scrollHeight) || base.height / scale;
      const key = `${Math.round(w)}x${Math.round(h)}|${lines.map((line) => `${line.id}:${line.d}`).join(";")}`;
      setGeom((current) => (current.key === key ? current : { lines, w, h, key }));
    };
    const schedule = () => {
      if (frame || typeof requestAnimationFrame !== "function") { if (!frame) measure(); return; }
      frame = requestAnimationFrame(measure);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    root.querySelectorAll("[data-tv-card]").forEach((node) => observer.observe(node));
    return () => {
      observer.disconnect();
      if (frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    };
  }, [stageEdges, stageRails, columnOf, sections, gap, byIdMatch]);

  return (
    <section ref={ref} className="tv-tree__stage" data-tv-stage={stage.id} data-lead={lead ? "1" : undefined}>
      <svg className="tv-tree__lines" width={geom.w || "100%"} height={geom.h || "100%"} aria-hidden="true" data-testid="bracket-connectors">
        {geom.lines.map((line) => {
          const quiet = line.flow === "L" && line.cross && !line.stub;
          // Nach der Auslosung (#1548) bleibt die Schiene stehen; der echte Weg über sie ist unsichtbar da - auf ihm fährt
          // der Name in der Auslosung an seinen gezogenen Platz. Abstiege und Einzelwege einer Gabel stehen nur als Eingang
          // bzw. Gabel da (#1591).
          const real = Boolean(line.rail && !line.scaffold && !line.spine && !line.stub);
          return (
            // Die Linien zeichnen sich beim ersten Erscheinen einmal, Runde für Runde (#1076); der Abstieg und
            // Entfallenes stehen leise und gestrichelt.
            <path
              key={line.id}
              d={line.d}
              pathLength={line.void || quiet || real || line.stub ? undefined : "1"}
              className={`tls-bracket-line ${line.void ? "tls-bracket-line--void" : line.stub ? "tls-bracket-line--stub" : real ? "tls-bracket-line--real" : quiet ? "tls-bracket-line--drop" : "tls-bracket-line--draw"}`}
              style={{ "--tls-i": line.column }}
              data-id={line.id}
              data-demand={line.demand ? "1" : undefined}
              data-fork={line.fork ? "1" : undefined}
              data-stub={line.stub ? "1" : undefined}
              data-rail-spine={line.spine || undefined}
              data-rail-group={line.railGroup || undefined}
              data-real={real ? "1" : undefined}
              data-from={line.from}
              data-to={line.to}
              data-to-slot={line.toSlot || undefined}
              data-flow={line.flow}
              data-cross={quiet ? "1" : undefined}
              data-void={line.void ? "1" : undefined}
              data-points={line.points}
            />
          );
        })}
        {geom.lines.filter((line) => line.marker).map((line) => (
          <circle key={`${line.id}:marker`} className="tls-bracket-marker" cx={line.marker.x} cy={line.marker.y} r={5} data-line-marker="1" />
        ))}
      </svg>
      {multi ? <h3 className="tv-tree__phase tv-t-head font-heading">{stage.name || `Phase ${stage.number || ""}`}</h3> : null}
      {arrangeTvBlocks(blocks, tvLayoutValue).map((row) => (
        <div key={row.map((block) => block.name).join("+")} className="tv-tree__row">
          {row.map((block) => (
            <TvSection key={`${stage.id}-${block.name}`} section={block.name} rounds={block.rounds} regMap={regMap} podiumMap={podiumMap} compact={compact} onMatchClick={onMatchClick} flowHint={sectionFlowHint(block.name, hasLoser, hasReset)} />
          ))}
        </div>
      ))}
    </section>
  );
}

/**
 * TV (#1115): welche Blöcke nebeneinander stehen. Jeder Block mit mehreren Runden beginnt eine neue Zeile; ein kleiner
 * Block (eine Runde, höchstens zwei Spiele - Spiel um Platz 3, Grand Final) stellt sich in die erste Zeile, in der
 * neben den anderen noch eine Spalte Platz hat. `columns` = so viele Spalten passen ins Bild (oder so breit ist der
 * breiteste Block). Liga, Gruppen und Schweizer System stehen immer allein in ihrer Zeile.
 * Kennt der TV sein Bild (`viewport` in Einheiten, `minZoom`), stehen alle Blöcke nebeneinander, wenn nur so der ganze
 * Baum ohne Kamera ins Bild passt (z. B. Durchgänge mit Loser Bracket).
 */
export function arrangeTvBlocks(blocks = [], layout = {}) {
  const rows = arrangeTvRows(blocks, layout.columns || 4);
  const isTable = (block) => isTableFormat(Object.values(block.rounds || {}).flat());
  if (!layout.viewport || rows.length < 2 || blocks.some(isTable)) return rows;
  const textSize = layout.textSize || "normal";
  const box = treeBox(textSize);
  const scale = treeScale(textSize);
  const sizes = new Map(blocks.map((block) => {
    const rounds = Object.keys(block.rounds || {}).map(Number).sort((a, b) => a - b).map((round) => block.rounds[round]);
    return [block, treeBlockUnits(rounds, textSize)];
  }));
  const fit = (arrangement) => {
    const rowSizes = arrangement.map((row) => ({
      w: row.reduce((sum, block) => sum + sizes.get(block).w, 0) + (row.length - 1) * box.colGap,
      h: Math.max(...row.map((block) => sizes.get(block).h)),
    }));
    const width = Math.max(...rowSizes.map((entry) => entry.w)) + 1.2;
    const height = rowSizes.reduce((sum, entry) => sum + entry.h, 0) + (rowSizes.length - 1) * box.blockGap + 1.2 + scale.head * TV_LINE.head;
    return Math.min(layout.viewport.w / width, layout.viewport.h / height);
  };
  const minZoom = layout.minZoom || 1;
  return fit(rows) < minZoom && fit([blocks]) >= minZoom ? [blocks] : rows;
}

function arrangeTvRows(blocks, columns) {
  const isTable = (block) => isTableFormat(Object.values(block.rounds || {}).flat());
  const columnsOf = (block) => Object.keys(block.rounds || {}).length;
  const isSmall = (block) => !isTable(block) && columnsOf(block) === 1 && (Object.values(block.rounds || {})[0] || []).length <= 2;
  const widest = Math.max(columns, ...blocks.filter((block) => !isTable(block)).map(columnsOf));
  const rows = [];
  for (const block of blocks) {
    if (isSmall(block)) {
      const row = rows.find((entry) => !entry.table && entry.columns + 1 <= widest);
      if (row) {
        row.blocks.push(block);
        row.columns += 1;
        continue;
      }
    }
    rows.push({ blocks: [block], columns: columnsOf(block), table: isTable(block) });
  }
  return rows.map((row) => row.blocks);
}

function TvMatchNode({ match, regMap, podiumMap }) {
  const Custom = useContext(NodeRendererContext);
  const findMatch = useContext(FinderContext)(match);
  if (Custom) return <Custom match={match} regMap={regMap} podiumMap={podiumMap} findMatch={findMatch} />;
  return <MatchCard match={match} regMap={regMap} podiumMap={podiumMap} />;
}

function TvSection({ section, rounds, regMap, podiumMap, onMatchClick }) {
  const roundNums = roundNumbers(rounds);
  const asTable = isTableFormat(roundNums.flatMap((rn) => rounds[rn]));
  const { columns: tvColumns } = useContext(TvLayoutContext);
  const key = normalizeSection(section);
  return (
    <div className="tv-block" data-testid={`bracket-section-${key}`} data-tv-block={key}>
      <div className="tv-block__title">
        <span className="tv-block__mark" aria-hidden="true" />
        <span className="tv-t-head font-heading" data-testid={`bracket-section-title-${key}`}>{formatBracketSection(section)}</span>
      </div>
      {asTable ? (
        // Spieltage untereinander, die Spiele eines Spieltags als Raster - so breit wie das Bild.
        <div className="tv-table" style={{ "--tv-table-cols": Math.max(1, Math.min(tvColumns, ...roundNums.map((rn) => rounds[rn].length))) }}>
          {roundNums.map((rn) => (
            <div key={rn} className="tv-table__day" data-tv-round={rn}>
              <div className="tv-ko__round tv-t-meta">{roundNameOf(rounds[rn][0], rn)}</div>
              <div className="tv-table__grid">
                {rounds[rn].map((match) => (
                  <div key={match.id} className="tv-ko__card" data-tv-card={match.id}>
                    <TvMatchNode match={match} regMap={regMap} podiumMap={podiumMap} onMatchClick={onMatchClick} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <TvKnockoutTree roundNums={roundNums} rounds={rounds} regMap={regMap} podiumMap={podiumMap} sectionTitle={formatBracketSection(section)} />
      )}
    </div>
  );
}

/** TV: Spalten je Runde. Die Linien zeichnet die ganze Phase (TvStageCanvas) - auch über die Blöcke hinweg (#1564). */
function TvKnockoutTree({ roundNums, rounds, regMap, podiumMap, sectionTitle = "" }) {
  return (
    <div className="tv-ko" data-testid="bracket-tree">
      <div className="tv-ko__cols">
        {roundNums.map((rn) => (
          <div key={rn} className="tv-ko__col" data-tv-round={rn}>
            <div className="tv-ko__round tv-t-meta">{roundTitle(rounds[rn][0], rn, sectionTitle)}</div>
            <div className="tv-ko__cards">
              {rounds[rn].map((match) => (
                <div key={match.id} className="tv-ko__card" data-tv-card={match.id}>
                  <TvMatchNode match={match} regMap={regMap} podiumMap={podiumMap} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
