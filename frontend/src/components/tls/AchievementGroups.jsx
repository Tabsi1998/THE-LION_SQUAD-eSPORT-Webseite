/**
 * Achievement Groups View — Phase B v4.
 *
 * Renders all groups returned from /api/achievements/{me|user/:id}.
 * Each group is a collapsible card. The CURRENT highest-earned tier is the
 * showcase; clicking the card expands to show all tiers (earned + locked).
 *
 * Negative groups never appear here (filtered server-side for non-admins).
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as Icons from "lucide-react";
import { ChevronDown, Lock } from "lucide-react";

const LEVEL_META = {
  1: { name: "Bronze", color: "#CD7F32", icon: "🥉" },
  2: { name: "Silber", color: "#C0C0C0", icon: "🥈" },
  3: { name: "Gold",   color: "#FFD700", icon: "🥇" },
  4: { name: "Platin", color: "#29B6E8", icon: "💎" },
  5: { name: "Special",color: "#FF3B30", icon: "❤" },
};

const CATEGORY_META = {
  match:      { label: "Match",      icon: "Swords",    accent: "#29B6E8" },
  tournament: { label: "Turnier",    icon: "Trophy",    accent: "#FFD700" },
  fastlap:    { label: "Fast Lap",   icon: "Flag",      accent: "#A855F7" },
  club:       { label: "Verein",     icon: "Crown",     accent: "#FFD700" },
  special:    { label: "Special",    icon: "Sparkles",  accent: "#FF3B30" },
};

function pascal(s) { return s.split("-").map(w => w.charAt(0).toUpperCase()+w.slice(1)).join(""); }

export function AchievementGroupsView({ groups = [], emptyText = "Noch keine Achievements freigeschaltet." }) {
  // Group by category
  const byCat = {};
  for (const g of groups) (byCat[g.category] ||= []).push(g);
  const order = ["club", "tournament", "match", "fastlap", "special"];

  if (!groups.length) {
    return (
      <div className="border border-dashed border-white/10 rounded-sm p-12 text-center text-white/50" data-testid="achievements-empty">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="space-y-10" data-testid="achievement-groups">
      {order.filter(c => byCat[c]?.length).map((cat) => {
        const meta = CATEGORY_META[cat];
        const CatIcon = Icons[meta.icon] || Icons.Trophy;
        return (
          <section key={cat}>
            <div className="flex items-baseline justify-between mb-4">
              <div className="flex items-center gap-2">
                <CatIcon className="w-4 h-4" style={{ color: meta.accent }} />
                <h2 className="font-heading text-xl md:text-2xl font-bold uppercase">{meta.label}</h2>
              </div>
              <span className="text-[10px] uppercase tracking-widest text-white/40">{byCat[cat].length} Gruppen</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {byCat[cat].map(g => <GroupCard key={g.code} group={g} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function GroupCard({ group }) {
  const [open, setOpen] = useState(false);
  const Icon = Icons[pascal(group.icon || "trophy")] || Icons.Trophy;
  const earnedTiers = group.tiers.filter(t => t.earned).sort((a, b) => b.level - a.level);
  const lockedTiers = group.tiers.filter(t => !t.earned).sort((a, b) => a.level - b.level);
  const highest = earnedTiers[0]; // top tier achieved
  const nextLocked = lockedTiers[0];
  const hasAny = earnedTiers.length > 0;
  const accent = group.accent_color || "#29B6E8";

  return (
    <motion.div
      layout
      data-testid={`achievement-group-${group.code}`}
      className={`border rounded-sm bg-[#0F0F10] transition-all ${hasAny ? "border-white/15" : "border-white/5 opacity-80"}`}
      style={hasAny ? { boxShadow: `inset 0 0 0 1px ${accent}22` } : undefined}
    >
      {/* Header — tap to expand */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-4 p-4 text-left hover:bg-white/[0.02] transition"
      >
        <div
          className="w-12 h-12 rounded-sm flex items-center justify-center border shrink-0"
          style={{
            borderColor: hasAny ? accent + "60" : "rgba(255,255,255,0.08)",
            backgroundColor: hasAny ? accent + "12" : "transparent",
          }}
        >
          {hasAny ? <Icon className="w-5 h-5" style={{ color: accent }} /> : <Lock className="w-4 h-4 text-white/30" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-heading text-base md:text-lg font-bold uppercase truncate">{group.name}</div>
            {hasAny && (
              <span
                className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm border"
                style={{ color: LEVEL_META[highest.level].color, borderColor: LEVEL_META[highest.level].color + "55" }}
              >
                {LEVEL_META[highest.level].icon} {LEVEL_META[highest.level].name}
              </span>
            )}
            {!hasAny && nextLocked && (
              <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm border border-white/10 text-white/50">
                Locked
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-white/55 line-clamp-1">{group.description}</div>
          {/* Compact progress hint when nothing earned yet */}
          {!hasAny && nextLocked && nextLocked.target > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-1 bg-white/5 rounded-sm overflow-hidden max-w-[200px]">
                <div className="h-full" style={{ width: `${nextLocked.percent}%`, backgroundColor: accent }} />
              </div>
              <span className="text-[10px] text-white/40 tabular-nums">{nextLocked.current}/{nextLocked.target}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] uppercase tracking-widest text-white/40 hidden sm:inline">{group.earned_count}/{group.tier_count}</span>
          <ChevronDown className={`w-4 h-4 text-white/40 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>

      {/* Expandable Tier List */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/5 px-4 py-3 space-y-2" data-testid={`achievement-group-${group.code}-tiers`}>
              {group.tiers.map(t => <TierRow key={t.code} tier={t} accent={accent} />)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function TierRow({ tier, accent }) {
  const lvl = LEVEL_META[tier.level] || LEVEL_META[1];
  const TierIcon = Icons[pascal(tier.icon || "circle")] || Icons.Circle;
  return (
    <div
      data-testid={`achievement-tier-${tier.code}`}
      className={`flex items-center gap-3 p-2 rounded-sm border transition ${tier.earned ? "border-white/10 bg-white/[0.02]" : "border-white/5 opacity-60"}`}
      style={tier.earned ? { boxShadow: `inset 2px 0 0 ${lvl.color}` } : undefined}
    >
      <div
        className="w-8 h-8 rounded-sm flex items-center justify-center border shrink-0"
        style={{
          borderColor: tier.earned ? lvl.color + "55" : "rgba(255,255,255,0.06)",
          backgroundColor: tier.earned ? lvl.color + "10" : "transparent",
        }}
      >
        {tier.earned
          ? <TierIcon className="w-4 h-4" style={{ color: lvl.color }} />
          : <Lock className="w-3.5 h-3.5 text-white/25" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: lvl.color }}>
            {lvl.icon} {lvl.name}
          </span>
          <span className={`text-sm font-semibold truncate ${tier.earned ? "text-white" : "text-white/55"}`}>{tier.name}</span>
        </div>
        <div className="text-xs text-white/45 mt-0.5">{tier.description}</div>
        {!tier.earned && tier.target > 0 && !tier.manual_only && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex-1 h-1 bg-white/5 rounded-sm overflow-hidden">
              <div className="h-full" style={{ width: `${tier.percent}%`, backgroundColor: accent }} />
            </div>
            <span className="text-[10px] text-white/40 tabular-nums">{tier.current}/{tier.target}</span>
          </div>
        )}
        {!tier.earned && tier.manual_only && (
          <div className="mt-1 text-[10px] uppercase tracking-widest text-white/30">Wird manuell vergeben</div>
        )}
      </div>
      <div className="shrink-0 text-right">
        {tier.earned ? (
          <div className="text-[10px] uppercase tracking-widest text-white/45">
            +{tier.points} Pkt.
            {tier.earned_at && <div className="text-white/30">{new Date(tier.earned_at).toLocaleDateString("de-DE")}</div>}
          </div>
        ) : (
          <div className="text-[10px] uppercase tracking-widest text-white/30">+{tier.points}</div>
        )}
      </div>
    </div>
  );
}
