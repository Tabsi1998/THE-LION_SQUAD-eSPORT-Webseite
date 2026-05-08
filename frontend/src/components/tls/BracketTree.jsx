import { useMemo } from "react";
import { resolveMediaUrl } from "@/lib/api";

/**
 * Renders a Single/Double Elimination bracket as columns of match nodes.
 * `data` is the response from /api/tournaments/:id/bracket.
 */
export function BracketTree({ data, compact = false, onMatchClick }) {
  const { matches = [], matches_v2 = [], stages = [], registrations = [] } = data || {};
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
    return <StageBracketTree stages={stages} matches={matches_v2} regMap={regMap} compact={compact} onMatchClick={onMatchClick} />;
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
        <div className="flex gap-4 md:gap-6 overflow-x-auto pb-4">
          {roundNums.map((rn) => (
            <div key={rn} className="flex flex-col min-w-[240px] gap-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-white/50 px-2">
                {rounds[rn][0].round_name}
              </div>
              <div className="flex flex-col justify-around flex-1 gap-3">
                {rounds[rn].map((m) => (
                  <BracketNode key={m.id} match={m} regMap={regMap} onClick={onMatchClick} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {renderBracket("winner", grouped.loser ? "Winner Bracket" : null)}
      {renderBracket("loser", "Loser Bracket")}
      {renderBracket("grand_final", "Grand Final")}
      {renderBracket("bronze", "Bronze Match")}
      {renderBracket("round_robin", "Spieltage")}
    </div>
  );
}

function StageBracketTree({ stages, matches, regMap, compact = false, onMatchClick }) {
  const stagesForView = stages.length
    ? stages
    : [{ id: "__default", name: "Bracket", number: 1 }];
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
    <div className="space-y-8">
      {stagesForView.map((stage) => {
        const stageSections = byStage[stage.id] || {};
        const sectionNames = Object.keys(stageSections);
        return (
          <div key={stage.id} className="space-y-5">
            {stagesForView.length > 1 && (
              <div className="flex items-center gap-2 uppercase tracking-[0.2em] text-xs font-bold">
                <span className="w-2 h-2 bg-[#29B6E8]" />
                <span className="text-white/80">{stage.name || `Stage ${stage.number || ""}`}</span>
              </div>
            )}
            {sectionNames.map((section) => (
              <StageSection
                key={`${stage.id}-${section}`}
                section={section}
                rounds={stageSections[section]}
                regMap={regMap}
                compact={compact}
                onMatchClick={onMatchClick}
              />
            ))}
            {sectionNames.length === 0 && (
              <div className="border border-white/10 rounded-sm bg-[#121212] p-8 text-center text-white/40">
                Noch keine Matches generiert
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StageSection({ section, rounds, regMap, compact, onMatchClick }) {
  const roundNums = Object.keys(rounds).map(Number).sort((a, b) => a - b);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 uppercase tracking-[0.2em] text-xs font-bold">
        <span className="w-2 h-2 bg-[#FFD700]" />
        <span className="text-white/80">{section}</span>
      </div>
      <div className="flex gap-4 md:gap-6 overflow-x-auto pb-4">
        {roundNums.map((rn) => (
          <div key={rn} className={`flex flex-col ${compact ? "min-w-[220px]" : "min-w-[280px]"} gap-4`}>
            <div className="text-[11px] font-bold uppercase tracking-wider text-white/50 px-2">
              {rounds[rn][0].round_name || `Runde ${rn}`}
            </div>
            <div className="flex flex-col gap-3">
              {rounds[rn].map((match) => (
                <HeatNode key={match.id} match={match} regMap={regMap} onClick={onMatchClick} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeatNode({ match, regMap, onClick }) {
  const resultMap = new Map((match.results || []).map((r) => [r.registration_id, r]));
  return (
    <button
      type="button"
      onClick={() => onClick?.(match)}
      data-testid={`bracket-heat-${match.id}`}
      className="tls-bracket-node text-left rounded-sm overflow-hidden border border-white/10 hover:border-[#29B6E8]/60 transition-all group bg-[#0A0A0A]"
    >
      <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">{match.match_key || "Match"}</div>
          <div className="text-xs text-white/45">{match.match_type === "ffa" ? "Heat" : "Match"}</div>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-white/45">{match.status?.replace("_", " ")}</span>
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
          />
        );
      })}
    </button>
  );
}

function HeatRow({ slot, registration, result, qualified }) {
  const user = registration?.user || {};
  const label = registration?.display_name || user.display_name || registration?.ingame_name || (slot.registration_id ? "—" : slot.source?.raw || "TBD");
  const score = result?.score ?? result?.points;
  return (
    <div className={`flex items-center justify-between gap-2 px-3 py-2 border-b border-white/5 last:border-b-0 ${qualified ? "bg-[#29B6E8]/10" : ""}`}>
      <div className="flex items-center gap-2 min-w-0">
        {user.avatar_url ? (
          <img src={resolveMediaUrl(user.avatar_url)} alt="" className="w-6 h-6 rounded-sm object-cover" />
        ) : (
          <div className="w-6 h-6 rounded-sm bg-white/5 border border-white/10" />
        )}
        <div className="min-w-0">
          <div className={`text-sm truncate ${qualified ? "text-[#29B6E8] font-semibold" : "text-white/80"}`}>{label}</div>
          <div className="text-[10px] uppercase tracking-wider text-white/35">Slot {slot.slot}</div>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className={`font-display font-bold ${qualified ? "text-[#29B6E8]" : "text-white/70"}`}>{result?.rank ? `#${result.rank}` : "—"}</div>
        {score != null && <div className="text-[10px] text-white/45">{score} Pkt</div>}
      </div>
    </div>
  );
}

function BracketNode({ match, regMap, onClick }) {
  const a = regMap.get(match.participant_a_id);
  const b = regMap.get(match.participant_b_id);
  const winnerA = match.winner_id && match.winner_id === match.participant_a_id;
  const winnerB = match.winner_id && match.winner_id === match.participant_b_id;

  return (
    <button
      type="button"
      onClick={() => onClick?.(match)}
      data-testid={`bracket-match-${match.id}`}
      className="tls-bracket-node text-left rounded-sm overflow-hidden border border-white/10 hover:border-[#29B6E8]/60 transition-all group"
    >
      <Row
        label={a?.display_name || a?.user?.display_name || a?.ingame_name || (match.participant_a_id ? "—" : "TBD")}
        score={match.score_a}
        isWinner={winnerA}
        avatar={a?.user?.avatar_url}
      />
      <div className="h-px bg-white/5" />
      <Row
        label={b?.display_name || b?.user?.display_name || b?.ingame_name || (match.participant_b_id ? "—" : "TBD")}
        score={match.score_b}
        isWinner={winnerB}
        avatar={b?.user?.avatar_url}
      />
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-white/40 border-t border-white/5 flex items-center justify-between font-display">
        <span>Match #{match.match_index + 1}</span>
        <span>{match.status?.replace("_", " ")}</span>
      </div>
    </button>
  );
}

function Row({ label, score, isWinner, avatar }) {
  return (
    <div className={`flex items-center justify-between px-3 py-2 ${isWinner ? "bg-[#29B6E8]/10" : ""}`}>
      <div className="flex items-center gap-2 min-w-0">
        {avatar ? (
          <img src={resolveMediaUrl(avatar)} alt="" className="w-6 h-6 rounded-sm object-cover" />
        ) : (
          <div className="w-6 h-6 rounded-sm bg-white/5 border border-white/10" />
        )}
        <span className={`text-sm truncate ${isWinner ? "text-[#29B6E8] font-semibold" : "text-white/80"}`}>
          {label}
        </span>
      </div>
      <span className={`font-display font-bold text-lg ${isWinner ? "text-[#29B6E8]" : "text-white/60"}`}>
        {score ?? 0}
      </span>
    </div>
  );
}
