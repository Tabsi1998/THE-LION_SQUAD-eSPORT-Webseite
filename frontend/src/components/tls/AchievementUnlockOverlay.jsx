import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as Icons from "lucide-react";
import { Trophy, X } from "lucide-react";

const LEVEL_META = {
  1: { name: "Bronze", color: "#CD7F32" },
  2: { name: "Silber", color: "#C0C0C0" },
  3: { name: "Gold", color: "#FFD700" },
  4: { name: "Platin", color: "#29B6E8" },
  5: { name: "Legendär", color: "#FF3B30" },
};

function pascal(s) {
  return String(s || "circle").split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
}

const CONFETTI = Array.from({ length: 28 }, (_, i) => i);
const CONFETTI_COLORS = ["#29B6E8", "#FFD700", "#00FF88", "#FF3B30", "#A855F7"];

/**
 * Full-screen celebration shown when a user unlocks new achievement tiers.
 * `tiers` is an array of tier payloads from /api/achievements/me (earned).
 */
export function AchievementUnlockOverlay({ tiers = [], onClose }) {
  const open = tiers && tiers.length > 0;

  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => onClose?.(), 7000);
    return () => clearTimeout(timer);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          data-testid="achievement-unlock-overlay"
          className="fixed inset-0 z-[120] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

          {/* confetti */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {CONFETTI.map((i) => (
              <motion.span
                key={i}
                className="absolute top-0 w-2 h-2 rounded-[1px]"
                style={{
                  left: `${(i * 37) % 100}%`,
                  backgroundColor: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
                }}
                initial={{ y: -40, opacity: 0, rotate: 0 }}
                animate={{ y: "100vh", opacity: [0, 1, 1, 0], rotate: 360 * (i % 2 ? 1 : -1) }}
                transition={{ duration: 2.6 + (i % 5) * 0.3, delay: (i % 7) * 0.12, ease: "easeIn" }}
              />
            ))}
          </div>

          <motion.div
            className="relative w-full max-w-lg"
            initial={{ scale: 0.7, y: 30, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: "spring", stiffness: 220, damping: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative border border-[#FFD700]/40 rounded-lg bg-gradient-to-b from-[#141414] to-[#0A0A0A] overflow-hidden shadow-[0_0_60px_rgba(255,215,0,0.15)]">
              <button
                type="button"
                onClick={onClose}
                data-testid="achievement-unlock-close"
                className="absolute top-3 right-3 text-white/40 hover:text-white z-10"
                aria-label="Schließen"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="relative px-6 pt-8 pb-4 text-center">
                <motion.div
                  className="mx-auto w-20 h-20 rounded-full border-2 border-[#FFD700] flex items-center justify-center mb-4"
                  initial={{ scale: 0, rotate: -30 }}
                  animate={{ scale: 1, rotate: 0, boxShadow: ["0 0 0 0 rgba(255,215,0,0.5)", "0 0 0 22px rgba(255,215,0,0)"] }}
                  transition={{ scale: { type: "spring", stiffness: 260, damping: 12, delay: 0.15 }, boxShadow: { duration: 1.6, repeat: Infinity } }}
                >
                  <Trophy className="w-9 h-9 text-[#FFD700]" />
                </motion.div>
                <div className="text-[11px] font-bold uppercase tracking-[0.4em] text-[#FFD700]">Freigeschaltet</div>
                <h2 className="font-heading text-2xl md:text-3xl font-black uppercase mt-1">
                  {tiers.length === 1 ? "Neues Achievement!" : `${tiers.length} neue Achievements!`}
                </h2>
              </div>

              <div className="px-5 pb-6 space-y-2 max-h-[46vh] overflow-y-auto">
                {tiers.map((tier, index) => {
                  const lvl = LEVEL_META[tier.level] || LEVEL_META[1];
                  const Icon = Icons[pascal(tier.icon || "trophy")] || Trophy;
                  return (
                    <motion.div
                      key={tier.code || index}
                      data-testid={`unlock-tier-${tier.code}`}
                      className="flex items-center gap-3 p-3 rounded-sm border border-white/10 bg-white/[0.03]"
                      style={{ boxShadow: `inset 3px 0 0 ${lvl.color}` }}
                      initial={{ x: -24, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      transition={{ delay: 0.4 + index * 0.12 }}
                    >
                      <div
                        className="w-11 h-11 rounded-sm flex items-center justify-center border shrink-0"
                        style={{ borderColor: lvl.color + "66", backgroundColor: lvl.color + "14" }}
                      >
                        <Icon className="w-5 h-5" style={{ color: lvl.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: lvl.color }}>
                          {tier.level_name || lvl.name}
                        </div>
                        <div className="font-semibold text-white truncate">{tier.name}</div>
                        {tier.description && <div className="text-xs text-white/50 truncate">{tier.description}</div>}
                      </div>
                      <div className="shrink-0 text-right text-[11px] font-display font-bold text-[#FFD700]">+{tier.points}</div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
