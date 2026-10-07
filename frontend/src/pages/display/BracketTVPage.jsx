import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy } from "lucide-react";
import { api, resolveMediaUrl } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { DisplayStatusBanner } from "@/components/tls/DisplayStatusBanner";
import { TvScreen, useTv, useTvArea } from "@/components/tv/TvScreen";
import { TvFooter, TvHeader, TvPill, toneFor } from "@/components/tv/TvParts";
import { statusBadgeLabel } from "@/components/tls/StatusBadge";
import { describeSlot, finderFor, initials, isMatchDone, plannedText, stationLabel } from "@/lib/slotSource";
import { bracketCardUnits, bracketColumnHeadUnits, bracketColumnWidths, chunkByUnits, columnsFor, nameFit, tvBox } from "@/lib/tvType";
import {
  formatBracketSection,
  formatMatchKind,
  formatMatchStatus,
  formatScheduleGroupLabel,
} from "@/lib/tournamentLabels";

// Turnierbaum-TV: Runden als Spalten, so viele wie auf den Bildschirm passen, je Spalte so viele Spiele, wie bei der
// gewählten Schrift ohne Abschneiden Platz haben (#1111). Mit Anzeige-Schlüssel im Link läuft die Seite ohne
// Anmeldung (#1110); leere Plätze sagen im Klartext, wer kommt (#1113).

const LIVE_STATUSES = new Set(["running", "in_progress", "live"]);
const PAGE_MS = 11000;
// Bis die Fläche gemessen ist: eine Full-HD-Fläche in Einheiten.
const DEFAULT_AREA = { w: 172, h: 68 };

export default function BracketTVPage() {
  return (
    <TvScreen>
      <BracketTv />
    </TvScreen>
  );
}

function BracketTv() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const displayKey = params.get("key") || "";
  const { motionOn, textSize } = useTv();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [keyRefused, setKeyRefused] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [viewIndex, setViewIndex] = useState(0);
  const [boardMode, setBoardMode] = useState("active");
  const [areaRef, measured] = useTvArea();
  const area = measured || DEFAULT_AREA;

  const load = useCallback(async () => {
    try {
      const { data: br } = await api.get(`/tournaments/${id}/bracket/display`, displayKey ? { params: { key: displayKey } } : undefined);
      setData(br);
      setLoadError(null);
      setKeyRefused(false);
      setLastUpdated(Date.now());
    } catch (error) {
      const status = error?.response?.status;
      // Widerrufen oder falsch: der Bildschirm zeigt nichts mehr vom Turnier, nur wie es weitergeht.
      if (displayKey && (status === 401 || status === 403)) {
        setKeyRefused(true);
        setData(null);
      }
      setLoadError(error);
    }
  }, [id, displayKey]);

  useEffect(() => {
    load();
  }, [load]);
  // Die TV-Anzeige läuft stundenlang: ohne Strom alle 15 s nachfragen. „tv“: ein widerrufener Schlüssel wirkt sofort.
  useLiveRefresh(load, ["tournaments", "matches", "stations", "tv"], { fallbackMs: 15000 });
  const flashMap = useMatchFlash(data);

  // Zuschlag, falls die Rechnung eine Spalte doch zu voll macht (andere Schrift am TV): nie abschneiden (#1111).
  const [safety, setSafety] = useState(1);
  const onOverflow = useCallback(() => setSafety((current) => (current < 1.6 ? Math.round((current + 0.08) * 100) / 100 : current)), []);
  const views = useMemo(() => buildTvViews(data, boardMode, area, textSize, safety), [data, boardMode, area, textSize, safety]);
  useEffect(() => {
    setViewIndex(0);
  }, [data?.tournament?.id, views.length, boardMode]);
  useEffect(() => {
    if (views.length <= 1) return undefined;
    const iv = setInterval(() => setViewIndex((current) => (current + 1) % views.length), PAGE_MS);
    return () => clearInterval(iv);
  }, [views.length]);

  if (keyRefused) {
    return (
      <div className="tv-page" data-testid="tv-key-refused">
        <div className="flex-1 flex flex-col items-center justify-center gap-[calc(var(--tv-u)*1.5)] px-[var(--tv-edge)] text-center">
          <div className="tv-t-head font-heading font-black uppercase">Dieser TV-Link gilt nicht mehr</div>
          <div className="tv-t-info tv-muted">Im Admin unter eSports → TV &amp; Beamer einen neuen Link erstellen und hier öffnen.</div>
        </div>
      </div>
    );
  }

  const t = data?.tournament;
  const activeView = views[viewIndex % Math.max(views.length, 1)] || { title: "Turnierbaum", columns: [], key: "leer" };
  const hasMatches = (data?.matches_v2?.length || 0) > 0;
  const publicUrl = t ? `${window.location.origin}/tournaments/${t.slug || t.id}/bracket` : window.location.origin;

  return (
    <div className="tv-page" data-testid="bracket-tv">
      {t ? (
        <TvHeader
          className="tls-header-sweep"
          kicker="THE LION SQUAD · LIVE"
          live
          title={t.title}
          subtitle={hasMatches ? activeView.title : null}
          aside={(
            <>
              <div className="tv-toggle" role="group" aria-label="Ansicht">
                {[["active", "Aktuell"], ["upcoming", "Nächste"], ["tree", "Baum"]].map(([mode, label]) => (
                  <button key={mode} type="button" className="tv-t-meta" aria-pressed={boardMode === mode} onClick={() => setBoardMode(mode)}>
                    {label}
                  </button>
                ))}
              </div>
              <TvPill tone={toneFor(t.status)} testId={`status-${t.status}`}>{statusBadgeLabel(t.status)}</TvPill>
            </>
          )}
        />
      ) : null}
      <DisplayStatusBanner error={loadError} lastUpdated={lastUpdated} label="Turnierbaum" onRetry={load} />

      <main className="tv-main" data-testid="tv-main">
        <div ref={areaRef} className="h-full min-h-0" data-testid="tv-board-area">
          {!data ? (
            <div className="tv-empty tv-t-head font-display">{loadError ? "Turnierbaum konnte nicht geladen werden" : "Lade Turnierbaum …"}</div>
          ) : !hasMatches ? (
            <div className="tv-empty tv-t-head font-display">Turnierbaum wurde noch nicht generiert</div>
          ) : motionOn ? (
            <AnimatePresence mode="wait">
              <motion.div
                key={activeView.key || viewIndex}
                className="h-full"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              >
                <TvMatchBoard view={activeView} data={data} flashMap={flashMap} onOverflow={onOverflow} />
              </motion.div>
            </AnimatePresence>
          ) : (
            <div key={activeView.key || viewIndex} className="h-full">
              <TvMatchBoard view={activeView} data={data} flashMap={flashMap} onOverflow={onOverflow} />
            </div>
          )}
        </div>
      </main>

      <TvFooter qrValue={publicUrl} kicker="Jetzt mitfiebern" text="QR scannen und Turnierbaum öffnen">
        {views.length > 1 ? (
          <div className="tv-dots" aria-hidden="true">
            {views.map((view, index) => <span key={view.key} data-active={index === viewIndex ? "1" : undefined} />)}
          </div>
        ) : null}
      </TvFooter>
    </div>
  );
}

function TvMatchBoard({ view, data, flashMap, onOverflow }) {
  const regMap = useMemo(() => new Map((data?.registrations || []).map((reg) => [reg.id, reg])), [data?.registrations]);
  const finder = useMemo(() => finderFor(data?.matches_v2 || []), [data?.matches_v2]);
  if (!(view.columns || []).length) {
    return <div className="tv-empty tv-t-head font-display">Keine geplanten offenen Spiele</div>;
  }
  return (
    <div className="tv-board" style={{ gridTemplateColumns: `repeat(${view.columnsPerView || 4}, minmax(0, 1fr))` }} data-testid="tv-board">
      {(view.columns || []).map((column, index) => (
        <RoundColumn key={column.key} column={column} regMap={regMap} finder={finder} flashMap={flashMap} index={index} widths={view.widths} onOverflow={onOverflow} />
      ))}
    </div>
  );
}

function RoundColumn({ column, regMap, finder, flashMap, index = 0, widths, onOverflow }) {
  const { motionOn } = useTv();
  const progress = `${column.doneCount}/${column.totalCount}`;
  const bodyRef = useRef(null);
  // Läuft die Spalte trotz Rechnung über, rechnet der TV mit Zuschlag neu - lieber eine Seite mehr als abgeschnitten.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body && column.matches.length > 1 && body.scrollHeight > body.clientHeight + 1) onOverflow?.();
  });
  return (
    <motion.section
      layout={motionOn}
      initial={motionOn ? { opacity: 0, y: 18 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={motionOn ? { duration: 0.45, delay: Math.min(index * 0.08, 0.4), ease: "easeOut" } : { duration: 0 }}
      className="tv-panel h-full"
      data-testid="tv-column"
    >
      <div className="tv-panel__head">
        <div className="min-w-0">
          <div className="tv-kicker tv-t-meta">{column.sectionLabel}</div>
          <h2 className="tv-t-head font-heading font-black uppercase">{column.roundLabel}</h2>
        </div>
        <TvPill tone={column.isFallback ? "gold" : "muted"}>{column.isFallback ? "Fertig" : progress}</TvPill>
      </div>
      <div ref={bodyRef} className="tv-panel__body" data-testid="tv-column-body">
        {column.matches.map((match, mIndex) => (
          <TvMatchCard key={match.id} match={match} regMap={regMap} findMatch={finder(match)} flash={flashMap?.[match.id]} index={mIndex} widths={widths} />
        ))}
      </div>
    </motion.section>
  );
}

function nameOfRegistration(regMap) {
  return (registrationId) => {
    const reg = regMap.get(registrationId);
    const user = reg?.user || {};
    return reg?.display_name || user.display_name || reg?.ingame_name || "";
  };
}

function TvMatchCard({ match, regMap, findMatch, flash, index = 0, widths }) {
  const { motionOn, scale } = useTv();
  const isV2 = Array.isArray(match.slots);
  const status = String(match.status || "").toLowerCase();
  const isLive = LIVE_STATUSES.has(status);
  const tone = isLive ? "live" : ["ready", "scheduled"].includes(status) ? "ready" : ["disputed", "waiting_result"].includes(status) ? "waiting" : "";
  const station = stationLabel(match);
  const planned = plannedText(match);
  const nameOf = nameOfRegistration(regMap);
  const slots = isV2 ? match.slots : [
    { slot: "A", registration_id: match.participant_a_id },
    { slot: "B", registration_id: match.participant_b_id },
  ];

  return (
    <motion.article
      layout={motionOn}
      initial={motionOn ? { opacity: 0, scale: 0.94 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={motionOn ? { duration: 0.35, delay: Math.min(index * 0.05, 0.25), ease: "easeOut" } : { duration: 0 }}
      className={`tv-card ${tone ? `tv-card--${tone}` : ""} ${flash === "finished" ? "tls-flash-finished" : ""}`}
      data-testid={`tv-match-${match.id}`}
    >
      <div className="tv-card__head">
        <span className="tv-kicker tv-t-meta">{formatMatchKind(match)} {match.match_key || matchLabel(match)}</span>
        <span className={`tv-t-meta inline-flex items-center gap-[0.5em] ${isLive ? "tv-green" : "tv-muted"}`}>
          {isLive ? <span className="tv-live-dot-tv tv-live-dot" aria-hidden="true" /> : null}
          {formatMatchStatus(match.status)}
        </span>
      </div>
      {slots.map((slot, slotIndex) => {
        const info = describeSlot(slot, nameOf, findMatch);
        const result = isV2
          ? (match.results || []).find((row) => row.registration_id && row.registration_id === slot.registration_id)
          : null;
        const legacyScore = isV2 ? null : slotIndex === 0 ? match.score_a : match.score_b;
        const won = Boolean(slot.registration_id) && (
          result?.qualified || (match.winner_id && match.winner_id === slot.registration_id)
        );
        const reg = regMap.get(slot.registration_id);
        const avatar = reg?.user?.avatar_url || reg?.avatar_url || "";
        return (
          <SlotRow
            key={slot.slot ?? slotIndex}
            info={info}
            avatar={avatar}
            won={won}
            result={result}
            score={legacyScore}
            scoreFlash={flash === "score"}
            fit={nameFit(info.label, widths?.name || 30, scale)}
          />
        );
      })}
      {(station || planned) ? (
        <div className="tv-card__foot tv-t-info" data-testid="tv-match-foot">
          {station ? <span className="tv-accent">{station}</span> : null}
          {planned ? <span>{planned}</span> : null}
        </div>
      ) : null}
    </motion.article>
  );
}

function SlotRow({ info, avatar, won, result, score, scoreFlash, fit }) {
  const rowScore = result?.score ?? result?.points ?? score;
  const rank = result?.rank ? `#${result.rank}` : null;
  const shown = info.kind === "player" ? (rank || (rowScore != null ? String(rowScore) : "")) : "";
  const short = info.kind === "player" ? initials(info.label) : "";
  const classes = [
    "tv-row",
    won ? "tv-row--won tls-winner-row" : "",
    info.kind === "pending" || info.kind === "bye" ? "tv-row--pending" : "",
    info.kind === "empty" ? "tv-row--empty" : "",
  ].filter(Boolean).join(" ");
  return (
    <div className={classes} data-slot-kind={info.kind}>
      <div className="tv-row__who">
        <div className={`tv-avatar tv-t-meta ${short || avatar ? "" : "tv-avatar--empty"}`} aria-hidden="true">
          {avatar && info.kind === "player" ? <img src={resolveMediaUrl(avatar)} alt="" /> : short}
        </div>
        {info.label ? (
          <span className="tv-t-name tv-row__name inline-flex items-center gap-[0.35em] min-w-0" data-fit={fit.small ? "small" : undefined} data-tv-name="1">
            {won ? <Trophy className="tv-icon tv-gold" aria-hidden="true" /> : null}
            <span className="min-w-0">{info.label}</span>
          </span>
        ) : null}
      </div>
      {shown ? (
        <div className="tv-row__score tv-t-num font-display">
          <span key={shown} className={scoreFlash ? "tls-flash-score" : ""}>{shown}</span>
          {rank && rowScore != null ? <div className="tv-t-meta font-sans font-normal tv-faint">{rowScore} Pkt.</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function buildTvViews(data, mode, area, textSize, safety = 1) {
  if (!data) return [];
  const box = tvBox(textSize);
  const columnsPerView = columnsFor(area.w, textSize);
  const columnWidth = (area.w - (columnsPerView - 1) * box.gap) / columnsPerView;
  const widths = bracketColumnWidths(columnWidth, textSize);
  const bodyUnits = area.h - bracketColumnHeadUnits(textSize) - 2 * box.colPad;
  const regMap = new Map((data.registrations || []).map((reg) => [reg.id, reg]));
  const nameOf = nameOfRegistration(regMap);
  const finder = finderFor(data.matches_v2 || []);
  const cardUnits = (match) => {
    const findMatch = finder(match);
    const labels = (Array.isArray(match.slots) ? match.slots : [{}, {}]).map((slot) => describeSlot(slot, nameOf, findMatch).label);
    return bracketCardUnits({ labels, footer: [stationLabel(match), plannedText(match)] }, widths, textSize) * safety;
  };
  const expand = (columns) => columns.flatMap((column) => {
    const parts = chunkByUnits(column.matches, bodyUnits, cardUnits, box.gap);
    if (parts.length <= 1) return [column];
    return parts.map((matches, index) => ({
      ...column,
      key: `${column.key}-tv-${index}`,
      roundLabel: `${column.roundLabel} · ${index + 1}/${parts.length}`,
      matches,
    }));
  });
  const pagesOf = (columns, keyPrefix, titleOf) => {
    const pages = chunk(columns, columnsPerView);
    return pages.map((page, index) => ({
      key: `${keyPrefix}-${index}`,
      title: titleOf(index, pages.length),
      columns: page,
      columnsPerView,
      widths,
    }));
  };

  const columns = buildV2Columns(data);
  if (mode === "tree") {
    return pagesOf(expand(columns), "tv-tree", (index, total) => (total > 1 ? `Ganzer Turnierbaum · Seite ${index + 1}/${total}` : "Ganzer Turnierbaum"));
  }
  if (mode === "upcoming") {
    const upcoming = buildUpcomingColumns(data, bodyUnits, cardUnits, box.gap);
    if (!upcoming.length) return [{ key: "tv-upcoming-empty", title: "Nächste Spiele", columns: [], columnsPerView, widths }];
    return pagesOf(upcoming, "tv-upcoming", (index, total) => (total > 1 ? `Nächste Spiele · Seite ${index + 1}/${total}` : "Nächste Spiele"));
  }
  const activeColumns = columns.filter((column) => !column.isComplete);
  const displayColumns = expand(
    activeColumns.length > 0 ? activeColumns : columns.slice(-columnsPerView).map((column) => ({ ...column, isFallback: true }))
  );
  const titlePrefix = activeColumns.length > 0 ? "Aktive Runden" : "Abgeschlossene Runden";
  return pagesOf(displayColumns, "tv-board", (index, total) => (total > 1 ? `${titlePrefix} · Seite ${index + 1}/${total}` : titlePrefix));
}

function buildV2Columns(data) {
  const stages = data.stages || [];
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const groups = new Map();

  for (const match of data.matches_v2 || []) {
    const round = Number(match.round || match.matchday_number || 1);
    const key = `${match.stage_id || "__default"}::${match.section || "MAIN"}::${round}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(match);
  }

  return [...groups.entries()]
    .map(([key, matches]) => {
      const [stageId, section, roundValue] = key.split("::");
      const round = Number(roundValue || 1);
      const stage = stageById.get(stageId) || { id: stageId, name: "Phase", number: 1 };
      const sortedMatches = sortMatches(matches);
      return makeColumn({
        key,
        stageNumber: Number(stage.number || 1),
        section,
        round,
        sectionLabel: [stage.name || "Phase", formatBracketSection(section)].filter(Boolean).join(" · "),
        roundLabel: formatScheduleGroupLabel(sortedMatches[0], data.tournament),
        matches: sortedMatches,
      });
    })
    .sort(sortColumns);
}

function makeColumn(column) {
  const doneCount = column.matches.filter(isMatchDone).length;
  const totalCount = column.matches.length;
  return {
    ...column,
    doneCount,
    totalCount,
    isComplete: totalCount > 0 && doneCount >= totalCount,
  };
}

function sortColumns(a, b) {
  return (a.stageNumber - b.stageNumber)
    || (sectionOrder(a.section) - sectionOrder(b.section))
    || (a.round - b.round);
}

function sortMatches(matches) {
  return [...matches].sort((a, b) => (a.order ?? a.match_index ?? 0) - (b.order ?? b.match_index ?? 0));
}

function sectionOrder(section) {
  const normalized = String(section || "").toUpperCase();
  if (["WB", "WINNER", "MAIN"].includes(normalized)) return 1;
  if (["LB", "LOSER"].includes(normalized)) return 2;
  if (["BRONZE"].includes(normalized)) return 3;
  if (["GF", "FINAL", "GRAND_FINAL"].includes(normalized)) return 4;
  return 9;
}

function buildUpcomingColumns(data, bodyUnits, cardUnits, gap) {
  const matches = [...(data.matches_v2 || [])]
    .filter((match) => !isMatchDone(match))
    .sort((a, b) => {
      const ad = Date.parse(a.scheduled_at || "") || Number.MAX_SAFE_INTEGER;
      const bd = Date.parse(b.scheduled_at || "") || Number.MAX_SAFE_INTEGER;
      return (ad - bd)
        || ((a.stage_number || 0) - (b.stage_number || 0))
        || ((a.round || 0) - (b.round || 0))
        || ((a.order ?? a.match_index ?? 0) - (b.order ?? b.match_index ?? 0));
    });
  return chunkByUnits(matches, bodyUnits, cardUnits, gap).map((items, index) => makeColumn({
    key: `upcoming-${index}`,
    stageNumber: 1,
    section: "upcoming",
    round: index + 1,
    sectionLabel: "Matchplan",
    roundLabel: `Nächste Spiele ${index + 1}`,
    matches: items,
  }));
}

function matchLabel(match) {
  if (Number.isInteger(match.match_index)) return `${match.match_index + 1}`;
  if (match.order != null) return `${Number(match.order) + 1}`;
  return "";
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function scoreSignature(match) {
  if (Array.isArray(match.slots)) {
    return (match.results || [])
      .map((row) => `${row.registration_id}:${row.rank ?? ""}:${row.score ?? row.points ?? ""}`)
      .sort()
      .join("|");
  }
  return `${match.score_a ?? ""}:${match.score_b ?? ""}:${match.winner_id ?? ""}`;
}

// Detects matches that just finished or had a score change between SSE-driven reloads,
// so the TV board can flash them. Returns a map of matchId -> "finished" | "score".
function useMatchFlash(data) {
  const prevRef = useRef(null);
  const [flashes, setFlashes] = useState({});

  useEffect(() => {
    if (!data) return undefined;
    const all = data.matches_v2 || [];
    const snapshot = {};
    const fresh = {};
    for (const match of all) {
      const done = isMatchDone(match);
      const sig = scoreSignature(match);
      snapshot[match.id] = { done, sig };
      const prev = prevRef.current?.[match.id];
      if (prev) {
        if (!prev.done && done) fresh[match.id] = "finished";
        else if (prev.sig !== sig) fresh[match.id] = "score";
      }
    }
    const isFirstRun = prevRef.current === null;
    prevRef.current = snapshot;
    if (isFirstRun || !Object.keys(fresh).length) return undefined;

    setFlashes((current) => ({ ...current, ...fresh }));
    const ids = Object.keys(fresh);
    const timer = setTimeout(() => {
      setFlashes((current) => {
        const next = { ...current };
        ids.forEach((id) => delete next[id]);
        return next;
      });
    }, 2300);
    return () => clearTimeout(timer);
  }, [data]);

  return flashes;
}
