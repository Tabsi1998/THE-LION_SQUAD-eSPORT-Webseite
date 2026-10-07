import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { resolveMediaUrl } from "@/lib/api";
import { formatBracketSection, formatMatchStatus, formatRoundName } from "@/lib/tournamentLabels";
import { asInstant, viennaDateTime } from "@/lib/vienna";
import { describeSlot, finderFor, initials } from "@/lib/slotSource";
import { buildPodiumMap, lastStageId, normalizeSection } from "@/lib/bracketPodium";
import { TV_LINE, treeBlockUnits, treeBox, treeScale } from "@/lib/tvType";

/**
 * Turnierbaum (#399): K.-o.-Runden als Spalten mit gemessenen Verbindungslinien, Mehrspieler-
 * Durchgänge als Karten, Sieger mit Akzent, leere Setzplätze (Entscheidung des Betreibers: vor dem
 * Start steht dort nichts), am Handy Runde für Runde. `data` ist die Antwort von
 * /api/tournaments/:id/bracket; `mineId` die eigene Anmeldung für „Dein nächstes Spiel“.
 *
 * TV-Fassung (#1115, `viewMode="tv"`): derselbe Baum mit Linien, Winner Bracket, Loser Bracket und Grand Final als
 * Blöcke wie auf der Turnierseite; kleine Blöcke (Spiel um Platz 3, Grand Final) stehen neben einem anderen, wenn
 * dort Platz ist (`tvLayout.columns` = so viele Spalten passen ins Bild). Die Karten zeichnet `nodeRenderer` (die TV-Karte),
 * Liga, Gruppen und Schweizer System zeigen ihre Spieltage als Raster. Die Linien werden auch dann richtig gemessen,
 * wenn die Kamera die Bühne vergrößert.
 */
const EMPTY_SET = new Set();
// Podium und letzte Phase wohnen seit #1119 in lib/bracketPodium (auch der Champion am TV braucht sie).
export { buildPodiumMap, lastStageId };

// Zuletzt geänderte Matches (#225) bekommen einen Rahmen. Über einen Kontext, damit die
// Kennung nicht durch Stufe → Abschnitt → Runde → Knoten gereicht werden muss.
const ChangedMatchesContext = createContext(EMPTY_SET);
const MineContext = createContext(null);
// Der Weg eines Spielers (#833): Fahren über einen Namen hebt jede Partie dieser Person hervor und dämpft den Rest;
// Fokus auf einer Partie (Tastatur) hebt die Wege ihrer Spieler hervor. `ids` ist eine Menge von Anmeldungen.
const PathContext = createContext({ ids: null, show: () => {} });
// Nach dem Ende (#833): was nicht gespielt wurde, heißt so - nicht mehr „Bereit“ oder „Geplant“.
const FinishedContext = createContext(false);
const FINISHED_TOURNAMENT = new Set(["completed", "results_published", "archived", "cancelled"]);

// Kürzel für Spieler ohne Bild (#833) - seit #1113 an einer Stelle mit dem TV (lib/slotSource), auch für
// zusammengeschriebene Namen: NeonFalke → NF.
export { initials };
// Wer in einen noch leeren Platz kommt (#1113): „Sieger aus A“ statt „—“. Setzplätze bleiben leer.
const FinderContext = createContext(() => () => undefined);
// TV (#1115): eine eigene Karte statt der Karte der Turnierseite, und wie viele Spalten ins Bild passen.
const NodeRendererContext = createContext(null);
const TvLayoutContext = createContext({ columns: 4, viewport: null, minZoom: 1, textSize: "normal" });

/** Liegt diese Partie auf dem hervorgehobenen Weg - oder wird sie gedämpft? */
export function pathState(ids, registrationIds) {
  if (!ids || !ids.size) return "";
  return registrationIds.some((id) => id && ids.has(id)) ? "on" : "off";
}

/** Nur Tastatur-Fokus zeigt den Weg - ein Tippen am Handy (öffnet die Partie) soll den Baum nicht dämpfen. */
function keyboardFocus(element) {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
}

function canHover() {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: hover)").matches;
  } catch {
    return false;
  }
}

function useMatchChanged(matchId) {
  return useContext(ChangedMatchesContext).has(matchId);
}

const LIVE_STATUSES = new Set(["running", "in_progress"]);
const DONE_STATUSES = new Set(["completed", "finished", "reported", "confirmed"]);
// Verbindungslinien: Spaltenbreite und Lücke, gemessen wird trotzdem - die Knoten sind
// unterschiedlich hoch (mit oder ohne Uhrzeit/Station).
const COLUMN_GAP = 48;

export function BracketTree({ data, compact = false, viewMode = "standard", onMatchClick, changedMatchIds = EMPTY_SET, mineId = null, layout = "auto", nodeRenderer = null, tvLayout = null }) {
  const { matches_v2 = [], stages = [], registrations = [] } = data || {};
  const [pathIds, setPathIds] = useState(null);
  const path = useMemo(() => ({ ids: pathIds, show: setPathIds }), [pathIds]);
  const finished = FINISHED_TOURNAMENT.has(String(data?.tournament?.status || ""));
  const podiumMap = useMemo(() => buildPodiumMap(matches_v2, stages), [matches_v2, stages]);
  const regMap = useMemo(() => {
    const m = new Map();
    for (const r of registrations) m.set(r.id, r);
    return m;
  }, [registrations]);
  const mine = mineId || registrations.find((r) => r?.is_mine)?.id || null;
  const finder = useMemo(() => finderFor(matches_v2), [matches_v2]);
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

  return (
    <NodeRendererContext.Provider value={nodeRenderer}>
    <TvLayoutContext.Provider value={tvValue}>
    <FinderContext.Provider value={finder}>
    <ChangedMatchesContext.Provider value={changedMatchIds || EMPTY_SET}>
      <MineContext.Provider value={mine}>
        <FinishedContext.Provider value={finished}>
          <PathContext.Provider value={path}>
            {mine && viewMode !== "tv" && !finished ? <NextMatchBanner matches={matches_v2} regMap={regMap} mineId={mine} onMatchClick={onMatchClick} /> : null}
            <StageBracketTree
              stages={stages}
              matches={matches_v2}
              regMap={regMap}
              podiumMap={podiumMap}
              compact={compact}
              viewMode={viewMode}
              layout={layout}
              onMatchClick={onMatchClick}
            />
          </PathContext.Provider>
        </FinishedContext.Provider>
      </MineContext.Provider>
    </ChangedMatchesContext.Provider>
    </FinderContext.Provider>
    </TvLayoutContext.Provider>
    </NodeRendererContext.Provider>
  );
}

// Formate, die in einer Tabelle ausgespielt werden statt in einem Baum. Sie
// laufen über Spieltage, an denen alle gleichzeitig spielen - nebeneinander
// scrollende Runden wären dafür die falsche Form, besonders am Telefon.
const TABLE_STAGE_TYPES = new Set(["round_robin_groups", "league", "swiss"]);
const TABLE_SECTION_RE = /^(round_robin|liga|league|swiss|group_.+)$/i;

export function isTableFormat(matches = []) {
  const first = matches.find(Boolean);
  if (!first) return false;
  if (first.stage_type) return TABLE_STAGE_TYPES.has(String(first.stage_type));
  return TABLE_SECTION_RE.test(String(first.section || ""));
}

/** „Dein nächstes Spiel“: das erste noch offene Match mit der eigenen Anmeldung. */
export function nextMatchFor(matches = [], mineId) {
  if (!mineId) return null;
  const own = matches.filter((match) => (match.slots || []).some((slot) => slot.registration_id === mineId) && !DONE_STATUSES.has(String(match.status || "").toLowerCase()));
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

function NextMatchBanner({ matches, regMap, mineId, onMatchClick }) {
  const match = nextMatchFor(matches, mineId);
  if (!match) return null;
  const opponents = (match.slots || []).filter((slot) => slot.registration_id && slot.registration_id !== mineId).map((slot) => slotLabel(slot, regMap)).filter(Boolean);
  const live = LIVE_STATUSES.has(String(match.status || "").toLowerCase());
  const when = formatNodeDateTime(match.scheduled_at);
  const station = getStationLabel(match);
  return (
    <button
      type="button"
      onClick={() => onMatchClick?.(match)}
      data-testid="bracket-next-match"
      className={`mb-6 w-full text-left rounded-sm border px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-1 transition ${live ? "border-live/50 bg-live/8" : "border-[#FFD700]/45 bg-[#FFD700]/8"} hover:border-white/40`}
    >
      <span className={`text-[11px] uppercase tracking-[0.25em] font-bold ${live ? "text-live" : "text-[#FFD700]"}`}>{live ? "Dein Spiel läuft" : "Dein nächstes Spiel"}</span>
      <span className="font-heading text-lg font-black uppercase">{formatRoundName(match.round_name, match.round)} · {match.match_key || "Spiel"}</span>
      {opponents.length ? <span className="text-sm text-white/75">gegen {opponents.join(", ")}</span> : <span className="text-sm text-white/45">Gegner steht noch nicht fest</span>}
      {(when || station) && <span className="text-xs uppercase tracking-wider text-white/55">{[when, station].filter(Boolean).join(" · ")}</span>}
    </button>
  );
}

function StageBracketTree({ stages, matches, regMap, podiumMap, compact = false, viewMode = "standard", layout = "auto", onMatchClick }) {
  const isTv = viewMode === "tv";
  const stagesForView = stages.length
    ? stages
    : [{ id: "__default", name: "Turnierbaum", number: 1 }];
  const byStage = useMemo(() => {
    const grouped = {};
    for (const match of matches) {
      const stageId = match.stage_id || "__default";
      grouped[stageId] = grouped[stageId] || {};
      const section = match.section || "MAIN";
      grouped[stageId][section] = grouped[stageId][section] || {};
      const round = match.round || 1;
      grouped[stageId][section][round] = grouped[stageId][section][round] || [];
      grouped[stageId][section][round].push(match);
    }
    for (const sectionMap of Object.values(grouped)) {
      for (const roundMap of Object.values(sectionMap)) {
        for (const list of Object.values(roundMap)) {
          list.sort((a, b) => (a.order || 0) - (b.order || 0));
        }
      }
    }
    return grouped;
  }, [matches]);

  const tvLayoutValue = useContext(TvLayoutContext);
  if (isTv) {
    return (
      <div className="tv-tree" data-testid="tv-tree" data-season-quiet="bracket">
        {stagesForView.map((stage) => {
          const stageSections = byStage[stage.id] || {};
          const blocks = Object.keys(stageSections).map((name) => ({ name, rounds: stageSections[name] }));
          if (!blocks.length) return null;
          const hasLoser = blocks.some((block) => ["lb", "loser"].includes(normalizeSection(block.name)));
          return (
            <section key={stage.id} className="tv-tree__stage" data-tv-stage={stage.id}>
              {stagesForView.length > 1 ? <h3 className="tv-tree__phase tv-t-head font-heading">{stage.name || `Phase ${stage.number || ""}`}</h3> : null}
              {arrangeTvBlocks(blocks, tvLayoutValue).map((row) => (
                <div key={row.map((block) => block.name).join("+")} className="tv-tree__row">
                  {row.map((block) => (
                    <StageSection
                      key={`${stage.id}-${block.name}`}
                      section={block.name}
                      rounds={block.rounds}
                      regMap={regMap}
                      podiumMap={podiumMap}
                      compact={compact}
                      viewMode={viewMode}
                      layout={layout}
                      onMatchClick={onMatchClick}
                      flowHint={sectionFlowHint(block.name, hasLoser)}
                    />
                  ))}
                </div>
              ))}
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-10" data-season-quiet="bracket">
      {stagesForView.map((stage) => {
        const stageSections = byStage[stage.id] || {};
        const sectionNames = Object.keys(stageSections);
        const hasLoser = sectionNames.some((name) => ["lb", "loser"].includes(normalizeSection(name)));
        return (
          <div key={stage.id} className="space-y-6">
            {stagesForView.length > 1 && (
              <div className="flex items-center gap-2 uppercase tracking-[0.2em] text-xs font-bold">
                <span className="w-2 h-2 bg-[#29B6E8]" />
                <span className="text-white/80">{stage.name || `Phase ${stage.number || ""}`}</span>
              </div>
            )}
            {sectionNames.map((section) => (
              <StageSection
                key={`${stage.id}-${section}`}
                section={section}
                rounds={stageSections[section]}
                regMap={regMap}
                podiumMap={podiumMap}
                compact={compact}
                viewMode={viewMode}
                layout={layout}
                onMatchClick={onMatchClick}
                flowHint={sectionFlowHint(section, hasLoser)}
              />
            ))}
            {sectionNames.length === 0 && (
              <div className="border border-white/10 rounded-sm bg-[#121212] p-8 text-center text-white/40">
                Noch keine Spiele generiert
              </div>
            )}
          </div>
        );
      })}
    </div>
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

/** Der Fluss zwischen den Blöcken (#399): wer verliert, wechselt in die Verliererrunde. */
function sectionFlowHint(section, hasLoser) {
  const key = normalizeSection(section);
  if (!hasLoser) return "";
  if (["wb", "winner", "main"].includes(key)) return "Wer hier verliert, spielt in der Verliererrunde weiter.";
  if (["lb", "loser"].includes(key)) return "Wer hier verliert, scheidet aus; der Sieger trifft im Großen Finale auf den Sieger der Siegerrunde.";
  if (["gf", "grand_final"].includes(key)) return "Sieger der Siegerrunde gegen Sieger der Verliererrunde.";
  return "";
}

function MatchNode({ match, regMap, podiumMap, compact, onMatchClick }) {
  const Custom = useContext(NodeRendererContext);
  const findMatch = useContext(FinderContext)(match);
  if (Custom) return <Custom match={match} regMap={regMap} podiumMap={podiumMap} findMatch={findMatch} />;
  const isDuel = (match.match_type || "duel") === "duel" && (match.slots || []).length <= 2;
  const Node = isDuel ? V2DuelNode : HeatNode;
  return <Node match={match} regMap={regMap} podiumMap={podiumMap} compact={compact} onClick={onMatchClick} />;
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

function StageSection({ section, rounds, regMap, podiumMap, compact, viewMode, layout, onMatchClick, flowHint }) {
  const isTv = viewMode === "tv";
  const roundNums = Object.keys(rounds).map(Number).sort((a, b) => a - b);
  const asTable = isTableFormat(roundNums.flatMap((rn) => rounds[rn]));
  const narrow = useIsNarrow();
  const steps = !isTv && !asTable && (layout === "steps" || (layout === "auto" && narrow));
  const { columns: tvColumns } = useContext(TvLayoutContext);

  if (isTv) {
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
                <div className="tv-ko__round tv-t-meta">{formatRoundName(rounds[rn][0].round_name, rn)}</div>
                <div className="tv-table__grid">
                  {rounds[rn].map((match) => (
                    <div key={match.id} className="tv-ko__card" data-tv-card={match.id}>
                      <MatchNode match={match} regMap={regMap} podiumMap={podiumMap} compact onMatchClick={onMatchClick} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <KnockoutTree roundNums={roundNums} rounds={rounds} regMap={regMap} podiumMap={podiumMap} compact onMatchClick={onMatchClick} sectionTitle={formatBracketSection(section)} isTv />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid={`bracket-section-${normalizeSection(section)}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div className="flex items-center gap-2 uppercase tracking-[0.2em] text-xs font-bold">
          <span className="w-2 h-2 bg-[#FFD700]" />
          <span className="text-white/80" data-testid={`bracket-section-title-${normalizeSection(section)}`}>{formatBracketSection(section)}</span>
        </div>
        {flowHint ? <span className="text-xs text-white/40">{flowHint}</span> : null}
      </div>

      {asTable ? (
        // Spieltage untereinander: an einem Spieltag spielen alle gleichzeitig,
        // es gibt keinen Fluss von links nach rechts.
        <div className="space-y-5">
          {roundNums.map((rn) => (
            <div key={rn} className="space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-white/50 px-2">
                {formatRoundName(rounds[rn][0].round_name, rn)}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 md:gap-4">
                {rounds[rn].map((match) => (
                  <MatchNode key={match.id} match={match} regMap={regMap} podiumMap={podiumMap}
                             compact={compact} onMatchClick={onMatchClick} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : steps ? (
        <RoundSteps roundNums={roundNums} rounds={rounds} regMap={regMap} podiumMap={podiumMap} compact={compact} onMatchClick={onMatchClick} />
      ) : (
        <KnockoutTree roundNums={roundNums} rounds={rounds} regMap={regMap} podiumMap={podiumMap} compact={compact} onMatchClick={onMatchClick} sectionTitle={formatBracketSection(section)} />
      )}
    </div>
  );
}

/** Am Handy (#399): eine Runde auf einmal, „Runde x von y“, vor und zurück. */
function RoundSteps({ roundNums, rounds, regMap, podiumMap, compact, onMatchClick }) {
  const mine = useContext(MineContext);
  const initial = useMemo(() => {
    if (!mine) return 0;
    const next = nextMatchFor(roundNums.flatMap((rn) => rounds[rn]), mine);
    const index = next ? roundNums.indexOf(Number(next.round || 1)) : -1;
    return index >= 0 ? index : 0;
  }, [mine, roundNums, rounds]);
  const [step, setStep] = useState(initial);
  const current = Math.min(step, roundNums.length - 1);
  const rn = roundNums[current];
  return (
    <div className="space-y-3" data-testid="bracket-steps">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => setStep(Math.max(0, current - 1))} disabled={current === 0} data-testid="bracket-step-prev" className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-35">← Vorige</button>
        <div className="text-center min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wider text-white/50" data-testid="bracket-step-label">Runde {current + 1} von {roundNums.length}</div>
          <div className="font-heading text-base font-black uppercase truncate">{formatRoundName(rounds[rn][0].round_name, rn)}</div>
        </div>
        <button type="button" onClick={() => setStep(Math.min(roundNums.length - 1, current + 1))} disabled={current >= roundNums.length - 1} data-testid="bracket-step-next" className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-35">Nächste →</button>
      </div>
      <div className="flex flex-col gap-3">
        {rounds[rn].map((match) => (
          <MatchNode key={match.id} match={match} regMap={regMap} podiumMap={podiumMap} compact={compact} onMatchClick={onMatchClick} />
        ))}
      </div>
    </div>
  );
}

/**
 * Am Desktop (#399): Spalten je Runde, Knoten gleichmäßig verteilt, dazwischen gemessene
 * Verbindungslinien (Klammern). Wer weiterkommt, speist das Spiel, dessen Position der
 * Reihenfolge entspricht - bei halbierenden Runden je zwei, bei gleich großen je eines.
 */
export function connectorTargets(countFrom, countTo) {
  if (!countFrom || !countTo || countTo > countFrom) return [];
  return Array.from({ length: countFrom }, (_, index) => Math.min(countTo - 1, Math.floor((index * countTo) / countFrom)));
}

/** Runden-Kopf - leer, wenn er nur den Abschnitt wiederholt (#833). */
export function roundTitle(match, number, sectionTitle = "") {
  const title = formatRoundName(match?.round_name, number);
  return sectionTitle && title.toLowerCase() === String(sectionTitle).toLowerCase() ? "" : title;
}

function KnockoutTree({ roundNums, rounds, regMap, podiumMap, compact, onMatchClick, sectionTitle = "", isTv = false }) {
  const containerRef = useRef(null);
  const nodeRefs = useRef(new Map());
  const [lines, setLines] = useState([]);
  const { ids: pathIds } = useContext(PathContext);
  const playersByMatch = useMemo(() => {
    const map = new Map();
    for (const rn of roundNums) for (const match of rounds[rn]) map.set(match.id, (match.slots || []).map((slot) => slot.registration_id).filter(Boolean));
    return map;
  }, [roundNums, rounds]);

  const register = (id) => (node) => {
    if (node) nodeRefs.current.set(id, node);
    else nodeRefs.current.delete(id);
  };

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const measure = () => {
      const base = container.getBoundingClientRect();
      // Vergrößert die TV-Kamera die Bühne (#1115), sind die gemessenen Maße mit vergrößert - zurückrechnen.
      const scale = container.offsetWidth ? base.width / container.offsetWidth : 1;
      const local = (value) => value / (scale || 1);
      const next = [];
      for (let index = 0; index < roundNums.length - 1; index += 1) {
        const from = rounds[roundNums[index]];
        const to = rounds[roundNums[index + 1]];
        const targets = connectorTargets(from.length, to.length);
        from.forEach((match, position) => {
          const target = to[targets[position]];
          const a = nodeRefs.current.get(match.id)?.getBoundingClientRect();
          const b = target ? nodeRefs.current.get(target.id)?.getBoundingClientRect() : null;
          if (!a || !b || !a.width || !b.width) return;
          const x1 = local(a.right - base.left) + container.scrollLeft;
          const y1 = local(a.top + a.height / 2 - base.top) + container.scrollTop;
          const x2 = local(b.left - base.left) + container.scrollLeft;
          const y2 = local(b.top + b.height / 2 - base.top) + container.scrollTop;
          const mid = x1 + (x2 - x1) / 2;
          next.push({ id: `${match.id}-${target.id}`, from: match.id, to: target.id, round: index, d: `M${x1} ${y1} H${mid} V${y2} H${x2}` });
        });
      }
      setLines(next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    for (const node of nodeRefs.current.values()) observer.observe(node);
    return () => observer.disconnect();
  }, [roundNums, rounds]);

  return (
    <div ref={containerRef} className={isTv ? "tv-ko" : "relative overflow-x-auto pb-4"} data-testid="bracket-tree">
      <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%" aria-hidden="true" data-testid="bracket-connectors">
        {lines.map((line) => {
          // Eine Linie liegt auf dem Weg, wenn die Person in beiden Partien steht (#833).
          const state = pathIds && pathIds.size
            ? ((playersByMatch.get(line.from) || []).some((id) => pathIds.has(id) && (playersByMatch.get(line.to) || []).includes(id)) ? "on" : "off")
            : "";
          return (
            // Die Linien zeichnen sich beim ersten Erscheinen einmal, Runde für Runde (#1076).
            <path key={line.id} d={line.d} fill="none" pathLength="1" className="tls-bracket-line tls-bracket-line--draw" style={{ "--tls-i": line.round }} data-path={state || undefined} data-from={line.from} data-to={line.to}
              stroke={state === "on" ? "rgba(41,182,232,0.85)" : "rgba(255,255,255,0.22)"} strokeWidth={state === "on" ? 2.5 : 2} />
          );
        })}
      </svg>
      <div className={isTv ? "tv-ko__cols" : "flex items-stretch"} style={isTv ? undefined : { gap: COLUMN_GAP, minWidth: "max-content" }}>
        {roundNums.map((rn) => (
          <div key={rn} className={isTv ? "tv-ko__col" : `flex flex-col ${compact ? "w-[228px]" : "w-[272px]"} shrink-0`} data-tv-round={isTv ? rn : undefined}>
            <div className={isTv ? "tv-ko__round tv-t-meta" : "text-[11px] font-bold uppercase tracking-wider text-white/50 px-2 mb-3 sticky top-0 min-h-[1rem]"}>
              {roundTitle(rounds[rn][0], rn, sectionTitle)}
            </div>
            <div className={isTv ? "tv-ko__cards" : "flex flex-col justify-around flex-1 gap-4"}>
              {rounds[rn].map((match) => (
                <div key={match.id} ref={register(match.id)} className={isTv ? "tv-ko__card" : "relative"} data-tv-card={isTv ? match.id : undefined}>
                  <MatchNode match={match} regMap={regMap} podiumMap={podiumMap} compact={compact} onMatchClick={onMatchClick} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatNodeDateTime(value) {
  if (!value) return "";
  const date = asInstant(value);
  if (Number.isNaN(date.getTime())) return "";
  return viennaDateTime(date, { dateStyle: "short", timeStyle: "short" });
}

function getStationLabel(match) {
  const station = match?.station_label || match?.station_name || match?.station?.name || match?.station_id || "";
  if (!station) return "";
  return /^station\b/i.test(station) ? station : `Station ${station}`;
}

/** Name im Knoten: die Anmeldung, sonst leer - ein Setzplatz vor dem Start zeigt nichts (Betreiber, 23.09.). */
function slotLabel(slot, regMap) {
  const reg = regMap.get(slot?.registration_id);
  const user = reg?.user || {};
  if (reg) return reg.display_name || user.display_name || reg.ingame_name || "-";
  return "";
}

function isBye(slot) {
  return ["bye", "walkover"].includes(String(slot?.status || "").toLowerCase());
}

/** Klartext für einen leeren Platz einer späteren Runde (#1113) - Setzplätze und Unbekanntes bleiben leer. */
function pendingLabel(slot, findMatch) {
  const info = describeSlot(slot, () => "", findMatch);
  return info.kind === "pending" ? info.label : "";
}

function LiveStatus({ status }) {
  const finished = useContext(FinishedContext);
  const isLive = LIVE_STATUSES.has(String(status || "").toLowerCase());
  if (finished && !DONE_STATUSES.has(String(status || "").toLowerCase())) {
    return <span className="text-white/35" data-testid="bracket-not-played">nicht gespielt</span>;
  }
  return (
    <span className={`inline-flex items-center gap-1.5 ${isLive ? "text-live" : ""}`} data-live={isLive ? "1" : undefined}>
      {isLive && <span className="w-1.5 h-1.5 rounded-full bg-live tv-live-dot" />}
      {formatMatchStatus(status)}
    </span>
  );
}

function MatchMeta({ match, compact = false }) {
  const time = formatNodeDateTime(match?.scheduled_at);
  const station = getStationLabel(match);
  const duration = match?.duration_minutes || match?.settings?.duration_minutes;
  if (!time && !station && !duration) return null;
  return (
    <div className={`border-t border-white/5 bg-[#050505]/40 ${compact ? "px-2.5 py-1" : "px-3 py-1.5"} text-[11px] text-white/50 flex flex-wrap gap-x-3 gap-y-1`}>
      {time && <span>{time}</span>}
      {duration && <span>{duration} Min.</span>}
      {station && <span className="text-[#29B6E8]">{station}</span>}
    </div>
  );
}

function V2DuelNode({ match, regMap, podiumMap, compact = false, onClick }) {
  const mine = useContext(MineContext);
  const resultMap = new Map((match.results || []).map((r) => [r.registration_id, r]));
  const slots = [...(match.slots || [])].slice(0, 2);
  while (slots.length < 2) {
    slots.push({ slot: slots.length + 1, registration_id: null, status: "empty" });
  }
  const nodePodium = topPodiumRank(slots.map((slot) => slot.registration_id), podiumMap);
  const changed = useMatchChanged(match.id);
  const isMine = Boolean(mine) && slots.some((slot) => slot.registration_id === mine);
  const done = DONE_STATUSES.has(String(match.status || "").toLowerCase());
  const { ids: pathIds, show } = useContext(PathContext);
  const finished = useContext(FinishedContext);
  const players = slots.map((slot) => slot.registration_id).filter(Boolean);
  const onPath = pathState(pathIds, players);
  const live = !finished && LIVE_STATUSES.has(String(match.status || "").toLowerCase());
  const findMatch = useContext(FinderContext)(match);

  return (
    <button
      type="button"
      onClick={() => onClick?.(match)}
      onFocus={(event) => players.length && keyboardFocus(event.currentTarget) && show(new Set(players))}
      onBlur={() => show(null)}
      data-testid={`bracket-match-v2-${match.id}`}
      data-changed={changed ? "true" : undefined}
      data-mine={isMine ? "true" : undefined}
      data-path={onPath || undefined}
      className={`tls-bracket-node relative w-full text-left rounded-md overflow-hidden border ${podiumBorderClass(nodePodium)} ${isMine ? "ring-1 ring-[#FFD700]/60" : ""} hover:border-[#29B6E8]/60 transition-all group ${changed ? "tls-changed-frame" : ""} ${live ? "tls-bracket-live" : ""}`}
    >
      <div className={`${compact ? "px-2.5 py-1" : "px-3 py-1.5"} flex items-center justify-between gap-2 border-b border-white/5`}>
        <span className="text-[11px] font-bold tracking-wider text-white/55">{match.match_key || "Spiel"}{isMine ? <span className="ml-2 text-[#FFD700]">Du</span> : null}</span>
        <span className="text-[11px] text-white/45"><LiveStatus status={match.status} /></span>
      </div>
      {slots.map((slot, index) => {
        const reg = regMap.get(slot.registration_id);
        const user = reg?.user || {};
        const result = resultMap.get(slot.registration_id);
        const isWinner = done && Boolean(result?.rank === 1 || result?.qualified);
        return (
          <Row
            key={slot.slot || index}
            registrationId={slot.registration_id}
            label={slotLabel(slot, regMap)}
            pending={reg ? "" : pendingLabel(slot, findMatch)}
            empty={!reg}
            bye={isBye(slot)}
            score={done || result ? (result?.score ?? result?.points ?? 0) : null}
            isWinner={isWinner}
            // Trifft das Ergebnis gerade ein, läuft einmal ein goldener Schimmer über die Siegerzeile (#1076).
            sweep={changed && isWinner}
            isLoser={done && reg && !isWinner}
            isMine={Boolean(mine) && slot.registration_id === mine}
            podiumRank={podiumMap?.get(slot.registration_id)}
            avatar={user.avatar_url || reg?.avatar_url}
            compact={compact}
          />
        );
      })}
      <MatchMeta match={match} compact={compact} />
    </button>
  );
}

/** Durchgang (FFA, #399): Titel mit Spielerzahl und Weiterkommern, vor dem Spiel keine „Platz“-Zeile. */
function HeatNode({ match, regMap, podiumMap, compact = false, onClick }) {
  const mine = useContext(MineContext);
  const resultMap = new Map((match.results || []).map((r) => [r.registration_id, r]));
  const nodePodium = topPodiumRank((match.slots || []).map((slot) => slot.registration_id), podiumMap);
  const changed = useMatchChanged(match.id);
  const slots = match.slots || [];
  const qualifiers = Number((match.settings || {}).qualifiers_per_match || 0);
  const played = slots.some((slot) => resultMap.has(slot.registration_id));
  const rows = played
    ? [...slots].sort((a, b) => (resultMap.get(a.registration_id)?.rank || 99) - (resultMap.get(b.registration_id)?.rank || 99))
    : slots;
  const filled = slots.filter((slot) => slot.registration_id).length;
  const isMine = Boolean(mine) && slots.some((slot) => slot.registration_id === mine);
  // Zweizeilig statt abgeschnitten (#833): oben der Name, darunter Spielerzahl und Weiterkommer.
  const name = match.match_type === "ffa" ? `Durchgang ${match.match_key || ""}`.trim() : (match.match_key || "Spiel");
  const meta = [`${filled || slots.length} Spieler`, qualifiers ? `${qualifiers} ${qualifiers === 1 ? "kommt" : "kommen"} weiter` : null].filter(Boolean).join(" · ");
  const { ids: pathIds, show } = useContext(PathContext);
  const finished = useContext(FinishedContext);
  const players = slots.map((slot) => slot.registration_id).filter(Boolean);
  const onPath = pathState(pathIds, players);
  const live = !finished && LIVE_STATUSES.has(String(match.status || "").toLowerCase());
  const findMatch = useContext(FinderContext)(match);
  return (
    <button
      type="button"
      onClick={() => onClick?.(match)}
      onFocus={(event) => players.length && keyboardFocus(event.currentTarget) && show(new Set(players))}
      onBlur={() => show(null)}
      data-testid={`bracket-heat-${match.id}`}
      data-changed={changed ? "true" : undefined}
      data-mine={isMine ? "true" : undefined}
      data-path={onPath || undefined}
      className={`tls-bracket-node relative w-full text-left rounded-md overflow-hidden border ${podiumBorderClass(nodePodium)} ${isMine ? "ring-1 ring-[#FFD700]/60" : ""} hover:border-[#29B6E8]/60 transition-all group bg-[#0A0A0A] ${changed ? "tls-changed-frame" : ""} ${live ? "tls-bracket-live" : ""}`}
    >
      <div className={`${compact ? "px-2.5 py-1.5" : "px-3 py-2"} border-b border-white/5 flex items-start justify-between gap-2`}>
        <div className="min-w-0">
          <div className="text-xs font-bold text-white/85 truncate" data-testid={`bracket-heat-title-${match.id}`}>{name}</div>
          <div className="text-[10px] text-white/45 leading-snug" data-testid={`bracket-heat-meta-${match.id}`}>{meta}</div>
          {isMine ? <div className="text-[10px] uppercase tracking-widest text-[#FFD700]">Du bist dabei</div> : null}
        </div>
        <span className="text-[11px] text-white/45 shrink-0"><LiveStatus status={match.status} /></span>
      </div>
      <MatchMeta match={match} compact={compact} />
      {rows.map((slot) => {
        const reg = regMap.get(slot.registration_id);
        const result = resultMap.get(slot.registration_id);
        const qualified = Boolean(result) && (result.rank || 99) <= (qualifiers || 1);
        return (
          <HeatRow
            key={slot.slot}
            registrationId={slot.registration_id}
            registration={reg}
            pending={reg ? "" : pendingLabel(slot, findMatch)}
            result={result}
            played={played}
            qualified={qualified}
            isMine={Boolean(mine) && slot.registration_id === mine}
            podiumRank={podiumMap?.get(slot.registration_id)}
            compact={compact}
          />
        );
      })}
    </button>
  );
}

function HeatRow({ registrationId, registration, pending = "", result, played, qualified, isMine, podiumRank, compact = false, sweep = false }) {
  const user = registration?.user || {};
  const label = registration ? (registration.display_name || user.display_name || registration.ingame_name || "-") : "";
  const score = result?.score ?? result?.points;
  const podium = podiumMeta(podiumRank);
  const pathHandlers = usePathHover(registrationId);
  return (
    <div {...pathHandlers} className={`flex items-center justify-between gap-2 ${compact ? "px-2.5 py-1.5" : "px-3 py-2"} border-b border-white/5 last:border-b-0 ${podium?.row || (qualified ? "bg-[#29B6E8]/10" : "")} ${sweep ? "tls-winner-sweep" : ""}`} data-sweep={sweep ? "1" : undefined}>
      <div className="flex items-center gap-2 min-w-0">
        <SlotAvatar avatar={user.avatar_url} label={label} empty={!registration} />
        <div className="min-w-0">
          <div className={`${compact ? "text-sm" : "text-base"} truncate ${label ? (podium?.text || (qualified ? "text-[#29B6E8] font-semibold" : "text-white/85")) : pending ? "text-white/50" : "text-white/25"}`} data-pending={pending && !label ? "1" : undefined}>{label || pending || "—"}</div>
          {isMine ? <div className="text-[10px] uppercase tracking-widest text-[#FFD700]">Du</div> : null}
        </div>
      </div>
      <div className="text-right shrink-0">
        {played ? (
          <>
            <div className={`font-display font-bold ${podium?.text || (qualified ? "text-[#29B6E8]" : "text-white/70")}`}>{podium ? podium.label : result?.rank ? `#${result.rank}` : "-"}</div>
            {score != null && <div key={score} className="tls-score-tick text-[10px] text-white/45">{score} Pkt.</div>}
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Bild oder Kürzel (#833) - leere graue Quadrate gibt es nur noch für freie Plätze. */
function SlotAvatar({ avatar, label, empty }) {
  if (avatar) return <img src={resolveMediaUrl(avatar)} alt="" className="w-7 h-7 rounded-sm object-cover shrink-0" />;
  const short = empty ? "" : initials(label);
  if (!short) return <div className="w-7 h-7 rounded-sm border border-dashed border-white/15 shrink-0" />;
  return (
    <div className="w-7 h-7 rounded-sm border border-white/10 bg-gradient-to-br from-white/[0.09] to-white/[0.02] text-[10px] font-bold tracking-wide text-white/65 flex items-center justify-center shrink-0" aria-hidden="true" data-testid="bracket-initials">
      {short}
    </div>
  );
}

/** Fahren über einen Namen zeigt den Weg dieser Person - nur mit Maus, am Handy bleibt alles ruhig. */
function usePathHover(registrationId) {
  const { show } = useContext(PathContext);
  if (!registrationId) return {};
  return {
    onMouseEnter: () => canHover() && show(new Set([registrationId])),
    onMouseLeave: () => canHover() && show(null),
  };
}

function Row({ registrationId, label, pending = "", empty, bye, score, isWinner, isLoser, isMine, podiumRank, avatar, compact = false, sweep = false }) {
  const podium = podiumMeta(podiumRank);
  const pathHandlers = usePathHover(registrationId);
  return (
    <div {...pathHandlers} data-sweep={sweep ? "1" : undefined} className={`flex items-center justify-between gap-2 ${compact ? "px-2.5 py-1.5" : "px-3 py-2"} ${podium?.row || (isWinner ? "bg-[#29B6E8]/10" : "")} ${sweep ? "tls-winner-sweep" : ""}`}>
      <div className="flex items-center gap-2 min-w-0">
        <SlotAvatar avatar={avatar} label={bye ? "" : label} empty={empty || bye} />
        <span className={`${compact ? "text-sm" : "text-base"} truncate ${podium?.text || (isWinner ? "text-[#29B6E8] font-bold" : isLoser ? "text-white/45" : empty && pending && !bye ? "text-white/50" : empty ? "text-white/25" : "text-white/85")}`} data-pending={empty && pending && !bye ? "1" : undefined}>
          {bye ? "Freilos" : label || pending || "—"}
        </span>
        {isMine ? <span className="text-[10px] uppercase tracking-widest text-[#FFD700] shrink-0">Du</span> : null}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {podium && <span className={`px-1.5 py-0.5 rounded-sm border text-[10px] font-display font-bold ${podium.badge}`}>{podium.label}</span>}
        {score != null && (
          <span key={score} className={`tls-score-tick font-display font-bold ${compact ? "text-base" : "text-lg"} ${podium?.text || (isWinner ? "text-[#29B6E8]" : "text-white/55")}`}>
            {score}
          </span>
        )}
      </div>
    </div>
  );
}

function topPodiumRank(ids, podiumMap) {
  const ranks = (ids || []).map((id) => podiumMap?.get(id)).filter(Boolean);
  return ranks.length ? Math.min(...ranks) : null;
}

function podiumMeta(rank) {
  if (rank === 1) {
    return {
      label: "#1",
      row: "bg-[#FFD700]/15",
      text: "text-[#FFD700] font-semibold",
      badge: "border-[#FFD700]/50 bg-[#FFD700]/15 text-[#FFD700]",
    };
  }
  if (rank === 2) {
    return {
      label: "#2",
      row: "bg-white/10",
      text: "text-white font-semibold",
      badge: "border-white/35 bg-white/10 text-white",
    };
  }
  if (rank === 3) {
    return {
      label: "#3",
      row: "bg-[#CD7F32]/15",
      text: "text-[#CD7F32] font-semibold",
      badge: "border-[#CD7F32]/50 bg-[#CD7F32]/15 text-[#CD7F32]",
    };
  }
  return null;
}

function podiumBorderClass(rank) {
  if (rank === 1) return "border-[#FFD700]/45 shadow-[0_0_0_1px_rgba(255,215,0,0.08)]";
  if (rank === 2) return "border-white/25";
  if (rank === 3) return "border-[#CD7F32]/45";
  return "border-white/10";
}
