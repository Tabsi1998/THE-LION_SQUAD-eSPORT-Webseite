import { useMemo } from "react";
import { resolveMediaUrl } from "@/lib/api";

/**
 * Renders a Single/Double Elimination bracket as columns of match nodes.
 * `data` is the response from /api/tournaments/:id/bracket.
 */
export function BracketTree({ data, compact = false, onMatchClick }) {
  const { matches = [], registrations = [] } = data || {};
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
