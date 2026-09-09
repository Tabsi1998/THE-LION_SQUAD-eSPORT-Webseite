import { useMemo } from "react";
import { resolveMediaUrl } from "@/lib/api";
import { formatBracketSection, formatMatchStatus, formatRoundName } from "@/lib/tournamentLabels";

/**
 * Renders a tournament structure: knockout brackets, group and league
 * matchdays, and multiplayer heats.
 * `data` is the response from /api/tournaments/:id/bracket.
 */
export function BracketTree({ data, compact = false, viewMode = "standard", onMatchClick }) {
  const { matches_v2 = [], stages = [], registrations = [] } = data || {};
  const podiumMap = useMemo(() => buildPodiumMap(matches_v2), [matches_v2]);
  const regMap = useMemo(() => {
    const m = new Map();
    for (const r of registrations) m.set(r.id, r);
    return m;
  }, [registrations]);

  return (
    <StageBracketTree
      stages={stages}
      matches={matches_v2}
      regMap={regMap}
      podiumMap={podiumMap}
      compact={compact}
      viewMode={viewMode}
      onMatchClick={onMatchClick}
    />
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

function StageBracketTree({ stages, matches, regMap, podiumMap, compact = false, viewMode = "standard", onMatchClick }) {
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

  return (
    <div className={isTv ? "space-y-4 h-full overflow-hidden" : "space-y-8"}>
      {stagesForView.map((stage) => {
        const stageSections = byStage[stage.id] || {};
        const sectionNames = Object.keys(stageSections);
        return (
          <div key={stage.id} className="space-y-5">
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
                onMatchClick={onMatchClick}
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

function MatchNode({ match, regMap, podiumMap, compact, onMatchClick }) {
  const isDuel = (match.match_type || "duel") === "duel" && (match.slots || []).length <= 2;
  const Node = isDuel ? V2DuelNode : HeatNode;
  return <Node match={match} regMap={regMap} podiumMap={podiumMap} compact={compact} onClick={onMatchClick} />;
}

function StageSection({ section, rounds, regMap, podiumMap, compact, viewMode, onMatchClick }) {
  const isTv = viewMode === "tv";
  const roundNums = Object.keys(rounds).map(Number).sort((a, b) => a - b);
  const asTable = isTableFormat(roundNums.flatMap((rn) => rounds[rn]));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 uppercase tracking-[0.2em] text-xs font-bold">
        <span className="w-2 h-2 bg-[#FFD700]" />
        <span className="text-white/80">{formatBracketSection(section)}</span>
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
              <div className={isTv
                ? "grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3"
                : "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4"
              }>
                {rounds[rn].map((match) => (
                  <MatchNode key={match.id} match={match} regMap={regMap} podiumMap={podiumMap}
                             compact={compact || isTv} onMatchClick={onMatchClick} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={isTv
          ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3 overflow-hidden"
          : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:flex gap-4 md:gap-6 xl:overflow-x-auto pb-4"
        }>
          {roundNums.map((rn) => (
            <div key={rn} className={isTv ? "flex flex-col min-w-0 gap-2" : `flex flex-col min-w-0 self-stretch ${compact ? "xl:min-w-[220px]" : "xl:min-w-[280px]"} gap-4`}>
              <div className="text-[11px] font-bold uppercase tracking-wider text-white/50 px-2">
                {formatRoundName(rounds[rn][0].round_name, rn)}
              </div>
              <div className={isTv ? "flex flex-col gap-2" : "flex flex-col justify-around flex-1 gap-3"}>
                {rounds[rn].map((match) => (
                  <MatchNode key={match.id} match={match} regMap={regMap} podiumMap={podiumMap}
                             compact={compact || isTv} onMatchClick={onMatchClick} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatNodeDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

function getStationLabel(match) {
  const station = match?.station_label || match?.station_name || match?.station?.name || match?.station_id || "";
  if (!station) return "";
  return /^station\b/i.test(station) ? station : `Station ${station}`;
}

function LiveStatus({ status }) {
  const isLive = ["running", "in_progress"].includes(String(status || "").toLowerCase());
  return (
    <span className="inline-flex items-center gap-1.5">
      {isLive && <span className="w-1.5 h-1.5 rounded-full bg-[#00FF88] tv-live-dot" />}
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
    <div className={`border-t border-white/5 bg-[#050505]/40 ${compact ? "px-2.5 py-1" : "px-3 py-1.5"} text-[10px] uppercase tracking-wider text-white/45 flex flex-wrap gap-x-3 gap-y-1`}>
      {time && <span>{time}</span>}
      {duration && <span>{duration} Min.</span>}
      {station && <span className="text-[#29B6E8]">{station}</span>}
    </div>
  );
}

function V2DuelNode({ match, regMap, podiumMap, compact = false, onClick }) {
  const resultMap = new Map((match.results || []).map((r) => [r.registration_id, r]));
  const slots = [...(match.slots || [])].slice(0, 2);
  while (slots.length < 2) {
    slots.push({ slot: slots.length + 1, registration_id: null, status: "empty" });
  }
  const nodePodium = topPodiumRank(slots.map((slot) => slot.registration_id), podiumMap);

  return (
    <button
      type="button"
      onClick={() => onClick?.(match)}
      data-testid={`bracket-match-v2-${match.id}`}
      className={`tls-bracket-node relative text-left rounded-sm overflow-hidden border ${podiumBorderClass(nodePodium)} hover:border-[#29B6E8]/60 transition-all group`}
    >
      {slots.map((slot, index) => {
        const reg = regMap.get(slot.registration_id);
        const user = reg?.user || {};
        const result = resultMap.get(slot.registration_id);
        const isWinner = result?.rank === 1 || result?.qualified;
        return (
          <Row
            key={slot.slot || index}
            label={reg?.display_name || user.display_name || reg?.ingame_name || (slot.registration_id ? "-" : slot.source?.raw || "Offen")}
            score={result?.score ?? result?.points ?? 0}
            isWinner={isWinner}
            podiumRank={podiumMap?.get(slot.registration_id)}
            avatar={user.avatar_url || reg?.avatar_url}
            compact={compact}
          />
        );
      })}
      <MatchMeta match={match} compact={compact} />
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-white/40 border-t border-white/5 flex items-center justify-between font-display">
        <span>{match.match_key || "Spiel"}</span>
        <span><LiveStatus status={match.status} /></span>
      </div>
    </button>
  );
}

function HeatNode({ match, regMap, podiumMap, compact = false, onClick }) {
  const resultMap = new Map((match.results || []).map((r) => [r.registration_id, r]));
  const nodePodium = topPodiumRank((match.slots || []).map((slot) => slot.registration_id), podiumMap);
  return (
    <button
      type="button"
      onClick={() => onClick?.(match)}
      data-testid={`bracket-heat-${match.id}`}
      className={`tls-bracket-node relative text-left rounded-sm overflow-hidden border ${podiumBorderClass(nodePodium)} hover:border-[#29B6E8]/60 transition-all group bg-[#0A0A0A]`}
    >
      <div className={`${compact ? "px-2.5 py-1.5" : "px-3 py-2"} border-b border-white/5 flex items-center justify-between gap-2`}>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">{match.match_key || "Spiel"}</div>
          <div className="text-xs text-white/45">{match.match_type === "ffa" ? "Durchgang" : "Spiel"}</div>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-white/45"><LiveStatus status={match.status} /></span>
      </div>
      <MatchMeta match={match} compact={compact} />
      {(match.slots || []).map((slot) => {
        const reg = regMap.get(slot.registration_id);
        const result = resultMap.get(slot.registration_id);
        const qualified = result && (result.rank || 99) <= ((match.settings || {}).qualifiers_per_match || 1);
        return (
          <HeatRow
            key={slot.slot}
            slot={slot}
            registration={reg}
            result={result}
            qualified={qualified}
            podiumRank={podiumMap?.get(slot.registration_id)}
            compact={compact}
          />
        );
      })}
    </button>
  );
}

function HeatRow({ slot, registration, result, qualified, podiumRank, compact = false }) {
  const user = registration?.user || {};
  const label = registration?.display_name || user.display_name || registration?.ingame_name || (slot.registration_id ? "-" : slot.source?.raw || "Offen");
  const score = result?.score ?? result?.points;
  const podium = podiumMeta(podiumRank);
  return (
    <div className={`flex items-center justify-between gap-2 ${compact ? "px-2.5 py-1.5" : "px-3 py-2"} border-b border-white/5 last:border-b-0 ${podium?.row || (qualified ? "bg-[#29B6E8]/10" : "")}`}>
      <div className="flex items-center gap-2 min-w-0">
        {user.avatar_url ? (
          <img src={resolveMediaUrl(user.avatar_url)} alt="" className="w-6 h-6 rounded-sm object-cover" />
        ) : (
          <div className="w-6 h-6 rounded-sm bg-white/5 border border-white/10" />
        )}
        <div className="min-w-0">
          <div className={`${compact ? "text-xs" : "text-sm"} truncate ${podium?.text || (qualified ? "text-[#29B6E8] font-semibold" : "text-white/80")}`}>{label}</div>
          <div className="text-[10px] uppercase tracking-wider text-white/35">Platz {slot.slot}</div>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className={`font-display font-bold ${podium?.text || (qualified ? "text-[#29B6E8]" : "text-white/70")}`}>{podium ? podium.label : result?.rank ? `#${result.rank}` : "-"}</div>
        {score != null && <div className="text-[10px] text-white/45">{score} Pkt.</div>}
      </div>
    </div>
  );
}

function Row({ label, score, isWinner, podiumRank, avatar, compact = false }) {
  const podium = podiumMeta(podiumRank);
  return (
    <div className={`flex items-center justify-between ${compact ? "px-2.5 py-1.5" : "px-3 py-2"} ${podium?.row || (isWinner ? "bg-[#29B6E8]/10" : "")}`}>
      <div className="flex items-center gap-2 min-w-0">
        {avatar ? (
          <img src={resolveMediaUrl(avatar)} alt="" className="w-6 h-6 rounded-sm object-cover" />
        ) : (
          <div className="w-6 h-6 rounded-sm bg-white/5 border border-white/10" />
        )}
        <span className={`${compact ? "text-xs" : "text-sm"} truncate ${podium?.text || (isWinner ? "text-[#29B6E8] font-semibold" : "text-white/80")}`}>
          {label}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {podium && <span className={`px-1.5 py-0.5 rounded-sm border text-[10px] font-display font-bold ${podium.badge}`}>{podium.label}</span>}
        <span className={`font-display font-bold ${compact ? "text-base" : "text-lg"} ${podium?.text || (isWinner ? "text-[#29B6E8]" : "text-white/60")}`}>
          {score ?? 0}
        </span>
      </div>
    </div>
  );
}

function normalizeSection(section) {
  return String(section || "MAIN").toLowerCase();
}

function isCompleted(match) {
  return ["completed", "finished", "reported", "confirmed"].includes(String(match?.status || "").toLowerCase());
}

function isBronzeMatch(match) {
  const haystack = [
    match?.section,
    match?.bracket,
    match?.round_name,
    match?.match_key,
    match?.name,
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes("bronze") || haystack.includes("platz 3") || haystack.includes("third");
}

function buildPodiumMap(matchesV2 = []) {
  const podium = new Map();
  const place = (id, rank) => {
    if (!id || ![1, 2, 3].includes(rank)) return;
    const current = podium.get(id);
    if (!current || rank < current) podium.set(id, rank);
  };

  const maxRoundBySection = new Map();
  for (const match of matchesV2) {
    const section = normalizeSection(match.section);
    const round = Number(match.round || 1);
    maxRoundBySection.set(section, Math.max(maxRoundBySection.get(section) || 0, round));
  }
  const hasGrandFinal = matchesV2.some((match) => ["gf", "grand_final"].includes(normalizeSection(match.section)));

  for (const match of matchesV2) {
    if (!isCompleted(match) || !(match.results || []).length) continue;
    const section = normalizeSection(match.section);
    const round = Number(match.round || 1);
    const finalSection = ["gf", "grand_final"].includes(section) || (!hasGrandFinal && ["main", "wb", "winner"].includes(section) && round === maxRoundBySection.get(section));
    const lowerFinal = ["lb", "loser"].includes(section) && round === maxRoundBySection.get(section);

    if (isBronzeMatch(match)) {
      const winner = (match.results || []).find((result) => Number(result.rank) === 1 || result.qualified);
      place(winner?.registration_id, 3);
      continue;
    }

    if (finalSection) {
      for (const result of match.results || []) {
        const rank = Number(result.rank);
        if ([1, 2, 3].includes(rank)) place(result.registration_id, rank);
      }
      continue;
    }

    if (lowerFinal) {
      const loser = (match.results || []).find((result) => Number(result.rank) === 2);
      place(loser?.registration_id, 3);
    }
  }

  return podium;
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
