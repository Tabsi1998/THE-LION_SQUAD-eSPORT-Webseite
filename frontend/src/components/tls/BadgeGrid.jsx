import * as Icons from "lucide-react";
import { motion } from "framer-motion";

/**
 * Badge card — displays a single unlocked badge with tier styling.
 */
export function BadgeCard({ badge, locked = false, compact = false }) {
  const iconName = kebabToPascal(badge.icon || "award");
  const Icon = Icons[iconName] || Icons.Award;
  const style = tierStyle(badge.tier);
  const earned = badge.earned_at ? new Date(badge.earned_at) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      data-testid={`badge-card-${badge.code}`}
      className={`group relative overflow-hidden rounded-sm border p-4 transition-all ${locked ? "opacity-40 border-white/5 bg-[#0A0A0A]" : style.card} hover:-translate-y-0.5`}
    >
      <div className={`absolute -top-6 -right-6 opacity-10 ${style.bg}`}>
        <Icon className="w-24 h-24" />
      </div>
      <div className="relative">
        <div className={`w-11 h-11 rounded-sm flex items-center justify-center border ${style.iconWrap} ${locked ? "grayscale" : ""}`}>
          {locked ? <Icons.Lock className="w-5 h-5" /> : <Icon className={`w-5 h-5 ${style.iconColor}`} />}
        </div>
        <div className="mt-3">
          <div className={`text-[10px] font-bold uppercase tracking-[0.25em] ${style.tierLabel}`}>{badge.tier}</div>
          <div className="mt-0.5 font-heading text-base md:text-lg font-bold uppercase leading-tight">{badge.name}</div>
        </div>
        {!compact && (
          <p className="mt-2 text-xs text-white/60 leading-relaxed line-clamp-2">{badge.description}</p>
        )}
        <div className="mt-3 flex items-center justify-between text-[10px] uppercase tracking-widest">
          <span className={`font-bold ${style.tierLabel}`}>+{badge.points || 0} Pkt.</span>
          {earned && <span className="text-white/40">{earned.toLocaleDateString("de-DE")}</span>}
        </div>
      </div>
    </motion.div>
  );
}

export function BadgeGrid({ badges = [], all = null }) {
  // If "all" catalog provided, render locked + unlocked in order; else only unlocked.
  if (all && all.length) {
    const earnedCodes = new Set(badges.map((b) => b.code));
    const merged = all.map((b) => {
      const earned = badges.find((x) => x.code === b.code);
      return earned ? { ...b, ...earned, _earned: true } : { ...b, _earned: false };
    });
    // Group by category
    const groups = {};
    for (const b of merged) {
      const k = b.category || "other";
      (groups[k] ||= []).push(b);
    }
    return (
      <div className="space-y-8">
        {Object.entries(groups).map(([cat, items]) => (
          <div key={cat}>
            <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8] mb-3">{categoryLabel(cat)}</div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {items.map((b) => <BadgeCard key={b.code} badge={b} locked={!b._earned} />)}
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {badges.map((b) => <BadgeCard key={b.code} badge={b} />)}
    </div>
  );
}

function tierStyle(tier) {
  const t = (tier || "bronze").toLowerCase();
  if (t === "platinum") return {
    card: "border-[#29B6E8]/50 bg-gradient-to-br from-[#29B6E8]/10 via-transparent to-[#29B6E8]/5",
    iconWrap: "border-[#29B6E8]/50 bg-[#29B6E8]/10",
    iconColor: "text-[#29B6E8]", bg: "text-[#29B6E8]", tierLabel: "text-[#29B6E8]",
  };
  if (t === "gold") return {
    card: "border-[#FFD700]/40 bg-gradient-to-br from-[#FFD700]/10 via-transparent to-[#FFD700]/5",
    iconWrap: "border-[#FFD700]/50 bg-[#FFD700]/10",
    iconColor: "text-[#FFD700]", bg: "text-[#FFD700]", tierLabel: "text-[#FFD700]",
  };
  if (t === "silver") return {
    card: "border-white/25 bg-gradient-to-br from-white/10 via-transparent to-white/5",
    iconWrap: "border-white/30 bg-white/10",
    iconColor: "text-white/90", bg: "text-white", tierLabel: "text-white/70",
  };
  return {
    card: "border-[#CD7F32]/40 bg-gradient-to-br from-[#CD7F32]/10 via-transparent to-[#CD7F32]/5",
    iconWrap: "border-[#CD7F32]/40 bg-[#CD7F32]/10",
    iconColor: "text-[#CD7F32]", bg: "text-[#CD7F32]", tierLabel: "text-[#CD7F32]",
  };
}

function categoryLabel(c) {
  return { tournament: "Turniere", match: "Matches", fastlap: "Fast Lap", community: "Community", season: "Saison", other: "Weitere" }[c] || c;
}

function kebabToPascal(s) {
  return s.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
}
