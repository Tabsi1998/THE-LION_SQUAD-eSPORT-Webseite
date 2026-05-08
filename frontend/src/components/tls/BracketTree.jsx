import { useMemo } from "react";
import { resolveMediaUrl } from "@/lib/api";
import { formatBracketSection, formatMatchStatus, formatRoundName } from "@/lib/tournamentLabels";

/**
 * Rendert klassische 1v1-Bäume und flexible Mehrspieler-Heats.
 * `data` is the response from /api/tournaments/:id/bracket.
 */
export function BracketTree({ data, compact = false, viewMode = "standard", onMatchClick }) {
  const { matches = [], matches_v2 = [], stages = [], registrations = [] } = data || {};
  const isTv = viewMode === "tv";
  const regMap = useMemo(() => {
    const m = new Map();
    for (const r of registrations) m.set(r.id, r);
    return m;
  }, [registrations]);

  // Group by bracket + round
  const grouped = useMemo(() => {
    const g = {};
    for (const m of matches) {
      const key = m.bracket || "winner";
      g[key] = g[key] || {};
      g[key][m.round] = g[key][m.round] || [];
      g[key][m.round].push(m);
    }
    for (const b of Object.keys(g)) {
      for (const r of Object.keys(g[b])) {
        g[b][r].sort((a, c) => a.match_index - c.match_index);
      }
    }
    return g;
  }, [matches]);

  if (matches_v2.length > 0 || stages.length > 0) {
    return <StageBracketTree stages={stages} matches={matches_v2} regMap={regMap} compact={compact} viewMode={viewMode} onMatchClick={onMatchClick} />;
  }

  const renderBracket = (bracketKey, label) => {
    const rounds = grouped[bracketKey];
    if (!rounds) return null;
    const roundNums = Object.keys(rounds).map(Number).sort((a, b) => a - b);
    return (
      <div className="space-y-3" key={bracketKey}>
        {label && (
          <div className="flex items-center gap-2 uppercase tracking-[0.2em] text-xs font-bold">
            <span className="w-2 h-2 bg-[#29B6E8]" />
            <span className="text-white/80">{label}</span>
          </div>
        )}
        <div className={isTv
          ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3 overflow-hidden"
          : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:flex gap-4 md:gap-6 xl:overflow-x-auto pb-4"
        }>
          {roundNums.map((rn) => (
            <div key={rn} className={isTv ? "flex flex-col min-w-0 gap-2" : "flex flex-col min-w-0 xl:min-w-[240px] gap-4"}>
              <div className="text-[11px] font-bold uppercase tracking-wider text-white/50 px-2">
                {formatRoundName(rounds[rn][0].round_name, rn)}
              </div>
              <div className={isTv ? "flex flex-col gap-2" : "flex flex-col justify-around flex-1 gap-3"}>
                {rounds[rn].map((m) => (
                  <BracketNode key={m.id} match={m} regMap={regMap} compact={compact || isTv} onClick={onMatchClick} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className={isTv ? "space-y-4 h-full overflow-hidden" : "space-y-8"}>
      {renderBracket("winner", grouped.loser ? formatBracketSection("winner") : null)}
      {renderBracket("loser", formatBracketSection("loser"))}
      {renderBracket("grand_final", formatBracketSection("grand_final"))}
      {renderBracket("bronze", formatBracketSection("bronze"))}
      {renderBracket("round_robin", formatBracketSection("round_robin"))}
    </div>
  );
}

function StageBracketTree({ stages, matches, regMap, compact = false, viewMode = "standard", onMatchClick }) {
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

function StageSection({ section, rounds, regMap, compact, viewMode, onMatchClick }) {
  const isTv = viewMode === "tv";
  const roundNums = Object.keys(rounds).map(Number).sort((a, b) => a - b);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 uppercase tracking-[0.2em] text-xs font-bold">
        <span className="w-2 h-2 bg-[#FFD700]" />
        <span className="text-white/80">{formatBracketSection(section)}</span>
      </div>
      <div className={isTv
        ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3 overflow-hidden"
        : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:flex gap-4 md:gap-6 xl:overflow-x-auto pb-4"
      }>
        {roundNums.map((rn) => (
          <div key={rn} className={isTv ? "flex flex-col min-w-0 gap-2" : `flex flex-col min-w-0 ${compact ? "xl:min-w-[220px]" : "xl:min-w-[280px]"} gap-4`}>
            <div className="text-[11px] font-bold uppercase tracking-wider text-white/50 px-2">
              {formatRoundName(rounds[rn][0].round_name, rn)}
            </div>
            <div className="flex flex-col gap-3">
              {rounds[rn].map((match) => (
                <HeatNode key={match.id} match={match} regMap={regMap} compact={compact || isTv} onClick={onMatchClick} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeatNode({ match, regMap, compact = false, onClick }) {
  const resultMap = new Map((match.results || []).map((r) => [r.registration_id, r]));
  return (
    <button
      type="button"
      onClick={() => onClick?.(match)}
      data-testid={`bracket-heat-${match.id}`}
      className="tls-bracket-node relative text-left rounded-sm overflow-hidden border border-white/10 hover:border-[#29B6E8]/60 transition-all group bg-[#0A0A0A]"
    >
      <div className={`${compact ? "px-2.5 py-1.5" : "px-3 py-2"} border-b border-white/5 flex items-center justify-between gap-2`}>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">{match.match_key || "Spiel"}</div>
          <div className="text-xs text-white/45">{match.match_type === "ffa" ? "Durchgang" : "Spiel"}</div>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-white/45">{formatMatchStatus(match.status)}</span>
      </div>
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
            compact={compact}
          />
        );
      })}
    </button>
  );
}

function HeatRow({ slot, registration, result, qualified, compact = false }) {
  const user = registration?.user || {};
  const label = registration?.display_name || user.display_name || registration?.ingame_name || (slot.registration_id ? "—" : slot.source?.raw || "Offen");
  const score = result?.score ?? result?.points;
  return (
    <div className={`flex items-center justify-between gap-2 ${compact ? "px-2.5 py-1.5" : "px-3 py-2"} border-b border-white/5 last:border-b-0 ${qualified ? "bg-[#29B6E8]/10" : ""}`}>
      <div className="flex items-center gap-2 min-w-0">
        {user.avatar_url ? (
          <img src={resolveMediaUrl(user.avatar_url)} alt="" className="w-6 h-6 rounded-sm object-cover" />
        ) : (
          <div className="w-6 h-6 rounded-sm bg-white/5 border border-white/10" />
        )}
        <div className="min-w-0">
          <div className={`${compact ? "text-xs" : "text-sm"} truncate ${qualified ? "text-[#29B6E8] font-semibold" : "text-white/80"}`}>{label}</div>
          <div className="text-[10px] uppercase tracking-wider text-white/35">Platz {slot.slot}</div>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className={`font-display font-bold ${qualified ? "text-[#29B6E8]" : "text-white/70"}`}>{result?.rank ? `#${result.rank}` : "—"}</div>
        {score != null && <div className="text-[10px] text-white/45">{score} Pkt.</div>}
      </div>
    </div>
  );
}

function BracketNode({ match, regMap, compact = false, onClick }) {
  const a = regMap.get(match.participant_a_id);
  const b = regMap.get(match.participant_b_id);
  const winnerA = match.winner_id && match.winner_id === match.participant_a_id;
  const winnerB = match.winner_id && match.winner_id === match.participant_b_id;

  return (
    <button
      type="button"
      onClick={() => onClick?.(match)}
      data-testid={`bracket-match-${match.id}`}
      className="tls-bracket-node relative text-left rounded-sm overflow-hidden border border-white/10 hover:border-[#29B6E8]/60 transition-all group"
    >
      <Row
        label={a?.display_name || a?.user?.display_name || a?.ingame_name || (match.participant_a_id ? "—" : "Offen")}
        score={match.score_a}
        isWinner={winnerA}
        avatar={a?.user?.avatar_url}
        compact={compact}
      />
      <div className="h-px bg-white/5" />
      <Row
        label={b?.display_name || b?.user?.display_name || b?.ingame_name || (match.participant_b_id ? "—" : "Offen")}
        score={match.score_b}
        isWinner={winnerB}
        avatar={b?.user?.avatar_url}
        compact={compact}
      />
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-white/40 border-t border-white/5 flex items-center justify-between font-display">
        <span>Spiel #{match.match_index + 1}</span>
        <span>{formatMatchStatus(match.status)}</span>
      </div>
    </button>
  );
}

function Row({ label, score, isWinner, avatar, compact = false }) {
  return (
    <div className={`flex items-center justify-between ${compact ? "px-2.5 py-1.5" : "px-3 py-2"} ${isWinner ? "bg-[#29B6E8]/10" : ""}`}>
      <div className="flex items-center gap-2 min-w-0">
        {avatar ? (
          <img src={resolveMediaUrl(avatar)} alt="" className="w-6 h-6 rounded-sm object-cover" />
        ) : (
          <div className="w-6 h-6 rounded-sm bg-white/5 border border-white/10" />
        )}
        <span className={`${compact ? "text-xs" : "text-sm"} truncate ${isWinner ? "text-[#29B6E8] font-semibold" : "text-white/80"}`}>
          {label}
        </span>
      </div>
      <span className={`font-display font-bold ${compact ? "text-base" : "text-lg"} ${isWinner ? "text-[#29B6E8]" : "text-white/60"}`}>
        {score ?? 0}
      </span>
    </div>
  );
}
