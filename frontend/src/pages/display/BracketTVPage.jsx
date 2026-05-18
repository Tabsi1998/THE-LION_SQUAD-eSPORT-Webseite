import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api, resolveMediaUrl } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { MascotBadge } from "@/components/tls/Logo";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { SponsorGrid } from "@/components/tls/SponsorTicker";
import { DisplayStatusBanner } from "@/components/tls/DisplayStatusBanner";
import { QRCodeSVG } from "qrcode.react";
import { formatDateTime } from "@/lib/datetime";
import {
  formatBracketSection,
  formatMatchKind,
  formatMatchStatus,
  formatRoundName,
  formatScheduleGroupLabel,
} from "@/lib/tournamentLabels";

const MAX_COLUMNS_PER_VIEW = 4;
const MAX_DUEL_MATCHES_PER_COLUMN = 8;
const MAX_HEAT_MATCHES_PER_COLUMN = 5;
const MAX_LARGE_HEAT_MATCHES_PER_COLUMN = 3;
const DONE_STATUSES = new Set(["completed", "archived", "forfeit", "bye", "cancelled"]);

export default function BracketTVPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [viewIndex, setViewIndex] = useState(0);

  const load = useCallback(async () => {
    try {
      const { data: br } = await api.get(`/tournaments/${id}/bracket`);
      setData(br);
      setLoadError(null);
      setLastUpdated(Date.now());
    } catch (error) {
      setLoadError(error);
    }
  }, [id]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [load]);
  useApiInvalidation(load, ["tournaments", "matches", "stations"]);

  const views = useMemo(() => buildTvViews(data), [data]);
  useEffect(() => {
    setViewIndex(0);
  }, [data?.tournament?.id, views.length]);
  useEffect(() => {
    if (views.length <= 1) return undefined;
    const iv = setInterval(() => setViewIndex((current) => (current + 1) % views.length), 11000);
    return () => clearInterval(iv);
  }, [views.length]);

  if (!data) {
    return (
      <div className="h-screen bg-black text-white flex flex-col">
        <DisplayStatusBanner error={loadError} label="Turnierbaum" onRetry={load} />
        <div className="flex-1 flex items-center justify-center font-display tracking-widest text-white/40">
          {loadError ? "TURNIERBAUM KONNTE NICHT GELADEN WERDEN" : "LADE TURNIERBAUM …"}
        </div>
      </div>
    );
  }
  const t = data.tournament;
  const publicUrl = `${window.location.origin}/tournaments/${t.slug || t.id}/bracket`;
  const activeView = views[viewIndex % Math.max(views.length, 1)] || { title: "Turnierbaum", columns: [], registrations: [] };
  const hasMatches = (data.matches?.length || 0) + (data.matches_v2?.length || 0) > 0;

  return (
    <div className="h-screen tv-bg text-white flex flex-col overflow-hidden">
      <header className="shrink-0 flex items-center justify-between gap-6 px-8 py-4 border-b border-white/10">
        <div className="flex items-center gap-4 min-w-0">
          <MascotBadge className="w-12 h-12 shrink-0" />
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.3em] text-[#29B6E8] font-bold">THE LION SQUAD · LIVE</div>
            <h1 className="font-heading text-2xl md:text-4xl font-black uppercase truncate">{t.title}</h1>
            {hasMatches && <div className="mt-1 text-xs uppercase tracking-[0.25em] text-white/50 truncate">{activeView.title}</div>}
          </div>
        </div>
        <StatusBadge status={t.status} size="lg" />
      </header>
      <DisplayStatusBanner error={loadError} lastUpdated={lastUpdated} label="Turnierbaum" onRetry={load} compact />

      <main className="flex-1 min-h-0 p-4 overflow-hidden">
        {!hasMatches ? (
          <div className="h-full border border-white/10 bg-[#0A0A0A]/75 rounded-sm flex items-center justify-center text-white/45 font-display uppercase tracking-[0.25em]">
            Turnierbaum wurde noch nicht generiert
          </div>
        ) : (
          <TvMatchBoard view={activeView} />
        )}
      </main>

      <footer className="shrink-0 px-8 py-3 border-t border-white/10 flex items-center justify-between gap-4 bg-[#0A0A0A]/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-4 min-w-0">
          <div className="bg-white p-1.5 rounded-sm shrink-0">
            <QRCodeSVG value={publicUrl} size={50} bgColor="#ffffff" fgColor="#0A0A0A" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.3em] text-[#29B6E8] font-bold">Jetzt mitfiebern</div>
            <div className="text-sm text-white/80 truncate font-mono">{publicUrl.replace(/^https?:\/\//, "")}</div>
          </div>
        </div>
        {views.length > 1 && (
          <div className="hidden md:flex items-center gap-1.5 shrink-0">
            {views.map((view, index) => (
              <button
                key={view.key}
                type="button"
                aria-label={`Ansicht ${index + 1}`}
                onClick={() => setViewIndex(index)}
                className={`h-1.5 rounded-full transition-all ${index === viewIndex ? "w-8 bg-[#29B6E8]" : "w-3 bg-white/20"}`}
              />
            ))}
          </div>
        )}
        <SponsorGrid max={4} marquee className="flex-1 max-w-[52vw]" />
      </footer>
    </div>
  );
}

function TvMatchBoard({ view }) {
  const regMap = useMemo(() => new Map((view.registrations || []).map((reg) => [reg.id, reg])), [view.registrations]);

  return (
    <div className="h-full grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
      {(view.columns || []).map((column) => (
        <RoundColumn key={column.key} column={column} regMap={regMap} />
      ))}
    </div>
  );
}

function RoundColumn({ column, regMap }) {
  const shown = column.matches.slice(0, column.displayLimit || matchLimitForColumn(column));
  const hiddenCount = Math.max(0, column.matches.length - shown.length);
  const progress = `${column.doneCount}/${column.totalCount}`;

  return (
    <section className="min-h-0 border border-white/10 bg-[#0A0A0A]/82 rounded-sm overflow-hidden flex flex-col">
      <div className="shrink-0 px-3 py-2 border-b border-white/10 bg-white/[0.03] flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.22em] text-[#29B6E8] font-bold truncate">{column.sectionLabel}</div>
          <h2 className="font-heading text-xl font-black uppercase leading-none truncate">{column.roundLabel}</h2>
        </div>
        <div className={`shrink-0 border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${column.isFallback ? "border-[#FFD600]/50 text-[#FFD600]" : "border-white/15 text-white/55"}`}>
          {column.isFallback ? "Fertig" : progress}
        </div>
      </div>
      <div className="flex-1 min-h-0 p-2.5 grid content-start gap-2 overflow-hidden">
        {shown.map((match) => (
          <TvMatchCard key={match.id} match={match} regMap={regMap} />
        ))}
        {hiddenCount > 0 && (
          <div className="border border-dashed border-white/15 px-3 py-2 text-center text-[11px] uppercase tracking-[0.18em] text-white/45">
            + {hiddenCount} weitere Spiele
          </div>
        )}
      </div>
    </section>
  );
}

function TvMatchCard({ match, regMap }) {
  const isV2 = Array.isArray(match.slots);
  const statusTone = getStatusTone(match.status);
  const station = stationLabel(match);

  return (
    <article className={`border ${statusTone.border} ${statusTone.bg} rounded-sm overflow-hidden`}>
      <div className="px-2.5 py-1.5 border-b border-white/5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#29B6E8] font-bold truncate">{match.match_key || matchLabel(match)}</div>
          <div className="text-[10px] uppercase tracking-wider text-white/38 truncate">{formatMatchKind(match)} · {formatMatchStatus(match.status)}</div>
        </div>
        {match.scheduled_at && <div className="shrink-0 text-right text-[10px] text-white/55">{formatDateTime(match.scheduled_at).replace(", ", " ")}</div>}
      </div>

      <div>
        {isV2 ? (
          (match.slots || []).map((slot) => {
            const result = (match.results || []).find((row) => row.registration_id === slot.registration_id);
            return <ParticipantRow key={slot.slot} participant={participantInfo(slot, regMap)} result={result} position={slot.slot} />;
          })
        ) : (
          <>
            <ParticipantRow
              participant={legacyParticipantInfo(match.participant_a_id, regMap)}
              score={match.score_a}
              isWinner={match.winner_id && match.winner_id === match.participant_a_id}
              side="A"
            />
            <ParticipantRow
              participant={legacyParticipantInfo(match.participant_b_id, regMap)}
              score={match.score_b}
              isWinner={match.winner_id && match.winner_id === match.participant_b_id}
              side="B"
            />
          </>
        )}
      </div>

      {(station || match.duration_minutes) && (
        <div className="px-2.5 py-1.5 border-t border-white/5 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-white/42">
          <span className="truncate">{station || "Keine Station"}</span>
          {match.duration_minutes && <span className="shrink-0">{match.duration_minutes} Min.</span>}
        </div>
      )}
    </article>
  );
}

function ParticipantRow({ participant, result, score, isWinner, position, side }) {
  const rowScore = result?.score ?? result?.points ?? score;
  const rank = result?.rank ? `#${result.rank}` : null;
  const avatar = participant?.avatar ? resolveMediaUrl(participant.avatar) : null;
  const label = participant?.label || "Offen";
  const subtitle = participant?.subtitle;
  const initial = label.trim().charAt(0).toUpperCase() || side || position || "?";
  return (
    <div className={`flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-white/5 last:border-b-0 ${isWinner || result?.qualified ? "bg-[#29B6E8]/10" : ""}`}>
      <div className="flex items-center gap-2 min-w-0">
        <div className="relative shrink-0">
          {avatar ? (
            <img src={avatar} alt="" className="w-8 h-8 rounded-sm object-cover border border-white/10 bg-white/5" />
          ) : (
            <div className="w-8 h-8 rounded-sm border border-white/10 bg-white/5 flex items-center justify-center text-[11px] font-bold text-white/60">
              {initial}
            </div>
          )}
          <span className="absolute -bottom-1 -right-1 w-4 h-4 border border-black/70 bg-[#121212] flex items-center justify-center text-[9px] font-bold text-white/65">
            {side || position}
          </span>
        </div>
        <div className="min-w-0">
          <div className={`truncate text-sm leading-tight ${isWinner || result?.qualified ? "text-[#29B6E8] font-semibold" : "text-white/84"}`}>{label}</div>
          {subtitle && <div className="truncate text-[10px] uppercase tracking-wider text-white/35">{subtitle}</div>}
        </div>
      </div>
      <div className="shrink-0 text-right font-display font-bold text-white/75">
        {rank || (rowScore != null ? rowScore : "—")}
        {rank && rowScore != null && <div className="text-[10px] font-sans font-normal text-white/45">{rowScore} Pkt.</div>}
      </div>
    </div>
  );
}

function stationLabel(match) {
  const station = match?.station_label || match?.station_name || match?.station?.name || match?.station_id || "";
  if (!station) return "";
  return /^station\b/i.test(station) ? station : `Station ${station}`;
}

function buildTvViews(data) {
  if (!data) return [];
  const registrations = data.registrations || [];
  const columns = (data.matches_v2 || []).length > 0
    ? buildV2Columns(data)
    : buildLegacyColumns(data);

  const activeColumns = columns.filter((column) => !column.isComplete);
  const displayColumns = expandColumnsForDisplay(
    activeColumns.length > 0 ? activeColumns : columns.slice(-MAX_COLUMNS_PER_VIEW).map((column) => ({ ...column, isFallback: true }))
  );
  const titlePrefix = activeColumns.length > 0 ? "Aktive Runden" : "Abgeschlossene Runden";
  const pages = chunk(displayColumns, MAX_COLUMNS_PER_VIEW);

  return pages.map((page, index) => ({
    key: `tv-board-${index}`,
    title: pages.length > 1 ? `${titlePrefix} · Seite ${index + 1}/${pages.length}` : titlePrefix,
    columns: page,
    registrations,
  }));
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

function buildLegacyColumns(data) {
  const groups = new Map();
  for (const match of data.matches || []) {
    const round = Number(match.round || 1);
    const section = match.bracket || "winner";
    const key = `${section}::${round}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(match);
  }

  return [...groups.entries()]
    .map(([key, matches]) => {
      const [section, roundValue] = key.split("::");
      const round = Number(roundValue || 1);
      const sortedMatches = sortMatches(matches);
      return makeColumn({
        key,
        stageNumber: 1,
        section,
        round,
        sectionLabel: formatBracketSection(section),
        roundLabel: formatRoundName(sortedMatches[0]?.round_name, round),
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

function expandColumnsForDisplay(columns) {
  return columns.flatMap((column) => {
    const limit = matchLimitForColumn(column);
    if (column.matches.length <= limit) return [{ ...column, displayLimit: limit }];
    const parts = chunk(column.matches, limit);
    return parts.map((matches, index) => ({
      ...column,
      key: `${column.key}-tv-${index}`,
      roundLabel: `${column.roundLabel} · ${index + 1}/${parts.length}`,
      matches,
      displayLimit: limit,
    }));
  });
}

function matchLimitForColumn(column) {
  const maxSlots = Math.max(2, ...column.matches.map((match) => (match.slots || []).length || 2));
  if (maxSlots >= 6) return MAX_LARGE_HEAT_MATCHES_PER_COLUMN;
  if (maxSlots > 2) return MAX_HEAT_MATCHES_PER_COLUMN;
  return MAX_DUEL_MATCHES_PER_COLUMN;
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

function isMatchDone(match) {
  if (DONE_STATUSES.has(match.status)) return true;
  if (match.winner_id) return true;
  if ((match.results || []).length > 0 && ["completed", "archived"].includes(match.status)) return true;
  return false;
}

function participantInfo(slot, regMap) {
  const reg = regMap.get(slot.registration_id);
  const user = reg?.user || {};
  return {
    label: reg?.display_name || user.display_name || reg?.ingame_name || slot.source?.raw || "Offen",
    avatar: user.avatar_url || reg?.avatar_url,
    subtitle: user.username ? `@${user.username}` : (slot.registration_id ? null : "Freier Slot"),
  };
}

function legacyParticipantInfo(registrationId, regMap) {
  const reg = regMap.get(registrationId);
  const user = reg?.user || {};
  return {
    label: reg?.display_name || user.display_name || reg?.ingame_name || (registrationId ? "-" : "Offen"),
    avatar: user.avatar_url || reg?.avatar_url,
    subtitle: user.username ? `@${user.username}` : (registrationId ? null : "Freier Slot"),
  };
}

function participantLabel(slot, regMap) {
  const reg = regMap.get(slot.registration_id);
  return reg?.display_name || reg?.user?.display_name || reg?.ingame_name || slot.source?.raw || "Offen";
}

function legacyParticipantLabel(registrationId, regMap) {
  const reg = regMap.get(registrationId);
  return reg?.display_name || reg?.user?.display_name || reg?.ingame_name || (registrationId ? "—" : "Offen");
}

function matchLabel(match) {
  if (Number.isInteger(match.match_index)) return `Spiel ${match.match_index + 1}`;
  if (match.order != null) return `Spiel ${Number(match.order) + 1}`;
  return "Spiel";
}

function getStatusTone(status) {
  if (["running", "in_progress"].includes(status)) return { border: "border-[#00FF88]/35", bg: "bg-[#00FF88]/5" };
  if (["ready", "scheduled"].includes(status)) return { border: "border-[#29B6E8]/35", bg: "bg-[#29B6E8]/5" };
  if (["disputed", "waiting_result"].includes(status)) return { border: "border-[#FFD600]/35", bg: "bg-[#FFD600]/5" };
  if (DONE_STATUSES.has(status)) return { border: "border-white/10", bg: "bg-white/[0.025]" };
  return { border: "border-white/10", bg: "bg-[#111111]" };
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
