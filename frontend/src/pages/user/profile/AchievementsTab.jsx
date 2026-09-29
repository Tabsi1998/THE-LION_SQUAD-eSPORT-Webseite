import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { AchievementGroupsView, applyTierFilters } from "@/components/tls/AchievementGroups";
import {
  AchievementFilters, AchievementLevelHeader, AchievementStatsRow, CategoryShowcase, MAX_PINS, NextUpPanel, PinnedPanel,
} from "./AchievementPanels";

// Reiter „Achievements“ (#619): Kopf (Level, Titel, Prestige, XP), Zahlen, „Als Nächstes“, Angeheftete,
// Vitrinen je Kategorie, Filter (Status, Material) und darunter der Katalog mit „Anheften“ an jeder
// erreichten Stufe. Alles, was die Seite braucht, kommt aus /achievements/me.
export function AchievementsTab({ achData, achInsights, completeness, evaluateAchievements, evaluatingAchievements, onAchDataChange }) {
  const [category, setCategory] = useState(null);
  const [filters, setFilters] = useState({ status: "all", material: "" });
  const [savingPins, setSavingPins] = useState(false);
  const pinnedCodes = useMemo(() => (Array.isArray(achData?.pinned_codes) ? achData.pinned_codes : (achData?.pinned || []).map((a) => a.code)), [achData]);
  const groups = useMemo(() => (Array.isArray(achData?.groups) ? achData.groups : []), [achData]);
  const visibleCount = useMemo(() => applyTierFilters(category ? groups.filter((g) => g.category === category) : groups, filters).filter((g) => !g.is_negative).length, [groups, category, filters]);

  const savePins = useCallback(async (codes) => {
    if (savingPins) return;
    setSavingPins(true);
    try {
      const { data } = await api.put("/achievements/me/pins", { tier_codes: codes });
      onAchDataChange?.((current) => (current ? { ...current, pinned_codes: data?.pinned_codes || codes, pinned: data?.pinned || [] } : current));
    } catch (err) {
      toast.error(formatRequestError(err, "Anheften hat nicht geklappt."));
    } finally {
      setSavingPins(false);
    }
  }, [onAchDataChange, savingPins]);

  const togglePin = useCallback((code) => {
    if (pinnedCodes.includes(code)) return savePins(pinnedCodes.filter((c) => c !== code));
    if (pinnedCodes.length >= MAX_PINS) {
      toast.error(`Höchstens ${MAX_PINS} Erfolge lassen sich anheften.`);
      return undefined;
    }
    return savePins([...pinnedCodes, code]);
  }, [pinnedCodes, savePins]);

  const publicSwitch = achData && achData.privacy_achievements_public === false;

  return (
    <div className="space-y-6" data-testid="profile-achievements-tab">
      <AchievementLevelHeader level={achData?.level} earnedPercent={achInsights?.earnedPercent ?? completeness?.score ?? 0}>
        <button type="button" onClick={evaluateAchievements} disabled={evaluatingAchievements} data-testid="profile-achievements-evaluate" className="inline-flex items-center gap-2 px-4 py-2 border border-[#A855F7]/50 text-[#c084fc] font-bold uppercase tracking-wider rounded-sm text-xs hover:bg-[#A855F7]/10 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${evaluatingAchievements ? "animate-spin" : ""}`} /> Aktualisieren
        </button>
      </AchievementLevelHeader>

      {achData && (
        <div className={`flex items-center gap-2 text-xs px-4 py-2.5 border rounded-sm ${publicSwitch ? "border-[#FFD700]/40 text-[#FFD700]/90 bg-[#FFD700]/5" : "border-white/10 text-white/50"}`} data-testid="achievement-visibility-note">
          {publicSwitch ? <EyeOff className="w-3.5 h-3.5 shrink-0" /> : <Eye className="w-3.5 h-3.5 shrink-0" />}
          <span className="flex-1">
            {publicSwitch
              ? "Deine Erfolge sind privat: andere sehen weder Angeheftete noch Stufen, und du stehst auf keiner Rangliste."
              : "Deine Erfolge sind öffentlich: Angeheftete und erreichte Stufen stehen in deinem Profil, die Verein-Kategorie sehen nur Mitglieder."}
          </span>
          <Link to="/profile?tab=privacy" className="shrink-0 font-bold uppercase tracking-widest text-[10px] hover:underline">Ändern</Link>
        </div>
      )}

      {achData ? (
        <>
          <AchievementStatsRow insights={achInsights} profileScore={completeness?.score || 0} hidden={achData.hidden} />
          <NextUpPanel items={achData.next_up || []} />
          <PinnedPanel pinned={achData.pinned || []} codes={pinnedCodes} onChange={savePins} />
          <CategoryShowcase groups={groups} active={category} onPick={setCategory} />
          <AchievementFilters filters={filters} onChange={setFilters} resultCount={visibleCount} />
          <AchievementGroupsView
            groups={groups}
            categoryFilter={category}
            filters={filters}
            hidden={achData.hidden}
            pins={{ codes: pinnedCodes, max: MAX_PINS, onToggle: togglePin }}
            emptyText={filters.material || filters.status !== "all" || category
              ? "Nichts passt zu diesem Filter."
              : "Spiel mit, melde dich für Turniere an oder schalte Fast-Lap-Runden frei – dann tauchen hier deine ersten Achievements auf."}
          />
        </>
      ) : (
        <div className="text-center py-20 text-white/40 font-display tracking-widest">LADE ACHIEVEMENTS …</div>
      )}
    </div>
  );
}
