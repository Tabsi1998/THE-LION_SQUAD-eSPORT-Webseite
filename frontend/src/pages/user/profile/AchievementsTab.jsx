import { RefreshCw } from "lucide-react";
import { AchievementGroupsView } from "@/components/tls/AchievementGroups";
import { AchievementOverview } from "./AchievementPanels";

export function AchievementsTab({ achData, achInsights, completeness, evaluateAchievements, evaluatingAchievements }) {
  return (
    <>
                <div className="space-y-6" data-testid="profile-achievements-tab">
                  <div className="border border-white/10 bg-[#121212] rounded-sm p-5 flex items-center gap-4 flex-wrap">
                    <div className="relative w-14 h-14 shrink-0">
                      <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
                        <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
                        <circle cx="18" cy="18" r="16" fill="none" stroke="#A855F7" strokeWidth="3" strokeDasharray={`${achInsights?.earnedPercent ?? completeness?.score ?? 0} 100`} pathLength="100" strokeLinecap="round" />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="font-heading font-black text-sm">{achInsights?.earnedPercent ?? 0}%</span>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#A855F7]">Account-Level & Achievements</div>
                      <h2 className="font-heading text-2xl md:text-3xl font-black uppercase mt-1">Deine Achievements</h2>
                      <p className="text-sm text-white/55 mt-1">{achInsights ? `${achInsights.earned.length} freigeschaltet · ${achInsights.total} im Katalog · ${achInsights.points} Punkte` : "Lade …"}</p>
                    </div>
                    <button type="button" onClick={evaluateAchievements} disabled={evaluatingAchievements} data-testid="profile-achievements-evaluate" className="inline-flex items-center gap-2 px-4 py-2 border border-[#A855F7]/50 text-[#c084fc] font-bold uppercase tracking-wider rounded-sm text-xs hover:bg-[#A855F7]/10 disabled:opacity-50">
                      <RefreshCw className={`w-3.5 h-3.5 ${evaluatingAchievements ? "animate-spin" : ""}`} /> Aktualisieren
                    </button>
                  </div>

                  {achData ? (
                    <>
                      <AchievementOverview insights={achInsights} profileScore={completeness?.score || 0} />
                      <AchievementGroupsView groups={achData.groups} emptyText="Spiel mit, melde dich für Turniere an oder schalte Fast-Lap-Runden frei – dann tauchen hier deine ersten Achievements auf." />
                    </>
                  ) : (
                    <div className="text-center py-20 text-white/40 font-display tracking-widest">LADE ACHIEVEMENTS …</div>
                  )}
                </div>
    </>
  );
}
