import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Medal, Star, Target } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/achievements/Badge";
import { AccountLevelProgress, accountLevelTier } from "@/components/tls/AccountLevel";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

// Dashboard-Kachel „Deine Erfolge“ (#619): Level-Leiste, „Als Nächstes“ in einer Zeile, die letzte
// Freischaltung - aus /achievements/me/summary, damit das Dashboard nicht den ganzen Katalog lädt.
export function AchievementsTile({ className = "" }) {
  const [summary, setSummary] = useState(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/achievements/me/summary");
      setSummary(data && typeof data === "object" ? data : null);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["achievements", "users"]);

  const level = summary?.level || null;
  const next = summary?.next_up || null;
  const last = summary?.last_award || null;
  const tier = accountLevelTier(level?.level || 1);
  const prestige = Number(level?.prestige || 0);
  return (
    <Link
      to="/u/me?tab=achievements"
      data-testid="dashboard-achievements"
      className={`border border-[#A855F7]/30 hover:border-[#A855F7]/70 rounded-sm p-5 bg-gradient-to-br from-[#A855F7]/10 to-transparent transition block ${className}`}
    >
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-widest text-[#A855F7] font-bold">Deine Erfolge</div>
        <Medal className="w-4 h-4 text-[#A855F7]" />
      </div>
      {failed && !summary ? (
        <div className="mt-2 font-heading text-lg font-bold">Erfolge</div>
      ) : !summary ? (
        <div className="mt-2 text-sm text-white/40" data-testid="dashboard-achievements-loading">Wird geladen …</div>
      ) : (
        <>
          <div className="mt-2 flex items-baseline gap-2 flex-wrap">
            <span className="font-heading text-lg font-bold" data-testid="dashboard-achievements-level">Level {level?.level || 1}</span>
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: tier.color }}>{level?.title || tier.title}</span>
            {prestige > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[#FFD700]" title={`Prestige ${prestige}`} data-testid="dashboard-achievements-prestige">
                {Array.from({ length: Math.min(5, prestige) }).map((_, i) => <Star key={i} className="w-3 h-3 fill-current" />)}
              </span>
            )}
            <span className="ml-auto text-[10px] uppercase tracking-widest text-white/45 tabular-nums" data-testid="dashboard-achievements-count">
              {summary.count} Erfolge · {Number(summary.points || 0).toLocaleString("de-DE")} Pkt.
            </span>
          </div>
          {level && (
            <div className="mt-2">
              <AccountLevelProgress level={level.level} points={level.xp ?? level.points ?? 0} nextLevelPoints={level.next_level_xp ?? level.next_level_points ?? 100} progress={level.progress ?? 0} compact />
              <div className="mt-1 text-[10px] uppercase tracking-widest text-white/40 tabular-nums">{Number(level.xp ?? 0).toLocaleString("de-DE")} / {Number(level.next_level_xp ?? 0).toLocaleString("de-DE")} XP</div>
            </div>
          )}
          {next ? (
            <div className="mt-3 flex items-center gap-2 text-sm" data-testid="dashboard-achievements-next">
              <Target className="w-3.5 h-3.5 shrink-0" style={{ color: next.group_accent || "#00FF88" }} />
              <span className="text-white/45 text-[10px] uppercase tracking-widest font-bold shrink-0">Als Nächstes</span>
              <span className="truncate font-semibold">{next.name}</span>
              <span className="ml-auto text-xs text-white/50 tabular-nums shrink-0">{next.current}/{next.target}</span>
            </div>
          ) : null}
          {last ? (
            <div className="mt-2 flex items-center gap-2 text-sm" data-testid="dashboard-achievements-last">
              <Badge material={last.material} rank={last.rank} art={last.art} icon={last.icon} size="xs" title={last.name} />
              <span className="text-white/45 text-[10px] uppercase tracking-widest font-bold shrink-0">Zuletzt</span>
              <span className="truncate font-semibold">{last.name}</span>
              <span className="ml-auto text-[10px] uppercase tracking-widest shrink-0" style={{ color: last.material_color || "#FFD700" }}>{last.material_name}</span>
            </div>
          ) : (
            <div className="mt-2 text-xs text-white/45" data-testid="dashboard-achievements-empty">Noch keine Freischaltung – spiel mit, dann geht es los.</div>
          )}
        </>
      )}
    </Link>
  );
}
