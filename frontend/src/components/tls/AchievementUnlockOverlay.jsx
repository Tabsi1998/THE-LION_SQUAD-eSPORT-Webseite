import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as Icons from "lucide-react";
import { Trophy, X, Volume2, VolumeX } from "lucide-react";
import { playUnlockSound, isSoundMuted, setSoundMuted } from "@/lib/unlockSounds";

const LEVEL_META = {
  1: { name: "Bronze", color: "#CD7F32" },
  2: { name: "Silber", color: "#C0C0C0" },
  3: { name: "Gold", color: "#FFD700" },
  4: { name: "Platin", color: "#29B6E8" },
  5: { name: "Legendär", color: "#FF3B30" },
};

// Rarity-driven ceremony: escalating drama per highest unlocked tier.
const RARITY = {
  1: { name: "Bronze", color: "#CD7F32", particles: 10, rings: 1, confetti: false, beams: false, flash: false, shake: false },
  2: { name: "Silber", color: "#C0C0C0", particles: 14, rings: 1, confetti: false, beams: false, flash: false, shake: false },
  3: { name: "Gold", color: "#FFD700", particles: 22, rings: 2, confetti: true, beams: true, flash: true, shake: false },
  4: { name: "Platin", color: "#29B6E8", particles: 28, rings: 3, confetti: true, beams: true, flash: true, shake: false },
  5: { name: "Legendär", color: "#FF3B30", secondary: "#FFD700", particles: 38, rings: 3, confetti: true, beams: true, flash: true, shake: true },
};

function pascal(s) {
  return String(s || "circle").split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
}

const CONFETTI = Array.from({ length: 30 }, (_, i) => i);
const CONFETTI_COLORS = ["#29B6E8", "#FFD700", "#00FF88", "#FF3B30", "#A855F7"];

/**
 * Full-screen rarity ceremony shown when a user unlocks new achievement tiers.
 * `tiers` is an array of earned tier payloads from /api/achievements/me.
 * `heading`/`sub` allow catch-up framing ("Während du weg warst").
 */
export function AchievementUnlockOverlay({ tiers = [], onClose, heading, sub }) {
  const open = tiers && tiers.length > 0;
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(() => isSoundMuted());
  const maxLevel = useMemo(() => tiers.reduce((m, t) => Math.max(m, Number(t.level) || 1), 1), [tiers]);
  const R = RARITY[Math.min(5, Math.max(1, maxLevel))];
  const totalPoints = useMemo(() => tiers.reduce((sum, t) => sum + (Number(t.points) || 0), 0), [tiers]);

  // Play the rarity-based unlock cue once when the ceremony opens.
  useEffect(() => {
    if (!open) return;
    playUnlockSound(maxLevel);
  }, [open, maxLevel]);

  const toggleMute = (e) => {
    e.stopPropagation();
    const next = !muted;
    setMuted(next);
    setSoundMuted(next);
    if (!next) playUnlockSound(maxLevel);
  };

  const burst = useMemo(() => Array.from({ length: R.particles }, (_, i) => {
    const angle = (i / R.particles) * Math.PI * 2 + (i % 2) * 0.2;
    const dist = 95 + ((i * 53) % 75);
    return {
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
      delay: 0.42 + (i % 5) * 0.02,
      color: i % 3 === 0 ? (R.secondary || "#ffffff") : R.color,
      size: 3 + (i % 3) * 2,
    };
  }), [R]);

  useEffect(() => {
    if (!open || paused) return undefined;
    const timer = setTimeout(() => onClose?.(), 9000);
    return () => clearTimeout(timer);
  }, [open, paused, onClose]);

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
          <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" />

          {/* Screen flash for gold+ */}
          {R.flash && (
            <motion.div
              className="absolute inset-0 pointer-events-none"
              style={{ backgroundColor: R.color }}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.22, 0] }}
              transition={{ duration: 0.8, delay: 0.38, times: [0, 0.25, 1] }}
            />
          )}

          {/* Falling confetti for gold+ */}
          {R.confetti && (
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              {CONFETTI.map((i) => (
                <motion.span
                  key={i}
                  className="absolute top-0 w-2 h-2 rounded-[1px]"
                  style={{
                    left: `${(i * 37) % 100}%`,
                    backgroundColor: maxLevel >= 5 ? [R.color, R.secondary, "#ffffff"][i % 3] : CONFETTI_COLORS[i % CONFETTI_COLORS.length],
                  }}
                  initial={{ y: -40, opacity: 0, rotate: 0 }}
                  animate={{ y: "100vh", opacity: [0, 1, 1, 0], rotate: 360 * (i % 2 ? 1 : -1) }}
                  transition={{ duration: 2.7 + (i % 5) * 0.3, delay: 0.5 + (i % 7) * 0.12, ease: "easeIn" }}
                />
              ))}
            </div>
          )}

          <motion.div
            className="relative w-full max-w-lg"
            initial={{ scale: 0.72, y: 34, opacity: 0 }}
            animate={{
              scale: 1,
              y: 0,
              opacity: 1,
              x: R.shake ? [0, 0, -7, 6, -4, 3, 0] : 0,
            }}
            exit={{ scale: 0.82, opacity: 0 }}
            transition={{
              scale: { type: "spring", stiffness: 220, damping: 20 },
              y: { type: "spring", stiffness: 220, damping: 20 },
              x: { delay: 0.5, duration: 0.55, ease: "easeOut" },
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <div
              className="relative border rounded-lg bg-gradient-to-b from-[#141414] to-[#0A0A0A] overflow-hidden"
              style={{ borderColor: `${R.color}55`, boxShadow: `0 0 60px ${R.color}26` }}
            >
              {/* Rotating light beams behind content (gold+) */}
              {R.beams && (
                <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
                  <div className="tls-unlock-beams absolute inset-[-45%]" style={{ "--beam": `${R.color}10` }} />
                </div>
              )}

              <button
                type="button"
                onClick={toggleMute}
                data-testid="achievement-unlock-mute"
                className="absolute top-3 right-12 text-white/40 hover:text-white z-10"
                aria-label={muted ? "Ton einschalten" : "Ton ausschalten"}
                title={muted ? "Ton einschalten" : "Ton ausschalten"}
              >
                {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>
              <button
                type="button"
                onClick={onClose}
                data-testid="achievement-unlock-close"
                className="absolute top-3 right-3 text-white/40 hover:text-white z-10"
                aria-label="Schließen"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="relative px-6 pt-9 pb-4 text-center">
                {/* Medal stage: shockwaves + radial burst + slam */}
                <div className="relative mx-auto w-24 h-24 mb-5">
                  {Array.from({ length: R.rings }).map((_, i) => (
                    <motion.span
                      key={i}
                      className="absolute left-1/2 top-1/2 rounded-full border-2 pointer-events-none"
                      style={{ width: 96, height: 96, borderColor: i % 2 && R.secondary ? R.secondary : R.color, x: "-50%", y: "-50%" }}
                      initial={{ scale: 0.25, opacity: 0.85 }}
                      animate={{ scale: 3 + i * 0.9, opacity: 0 }}
                      transition={{ duration: 1.15, delay: 0.34 + i * 0.16, ease: "easeOut" }}
                    />
                  ))}
                  {burst.map((p, i) => (
                    <motion.span
                      key={`p${i}`}
                      className="absolute left-1/2 top-1/2 rounded-full pointer-events-none"
                      style={{ width: p.size, height: p.size, backgroundColor: p.color, boxShadow: `0 0 6px ${p.color}` }}
                      initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
                      animate={{ x: p.x, y: p.y, opacity: [0, 1, 0], scale: [0.4, 1.15, 0.5] }}
                      transition={{ duration: 1.05, delay: p.delay, ease: "easeOut" }}
                    />
                  ))}
                  <motion.div
                    className={`relative w-24 h-24 rounded-full flex items-center justify-center ${maxLevel >= 3 ? `tls-frame tls-frame--${maxLevel}` : ""}`}
                    style={maxLevel < 3 ? { border: `2px solid ${R.color}`, backgroundColor: `${R.color}12` } : { borderRadius: "9999px" }}
                    initial={{ scale: 2.3, opacity: 0, rotate: -22 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 15, delay: 0.28 }}
                  >
                    <Trophy className={`w-10 h-10 relative z-[1] ${maxLevel >= 5 ? "tls-flame" : ""}`} style={{ color: maxLevel >= 5 ? R.secondary : R.color }} />
                  </motion.div>
                  {maxLevel >= 3 && (
                    <span className="tls-orbit" style={{ "--orbit-color": R.secondary || R.color, "--orbit-speed": maxLevel >= 5 ? "2.4s" : "3.4s" }}><i /></span>
                  )}
                  {maxLevel >= 5 && (
                    <span className="tls-orbit tls-orbit--rev" style={{ "--orbit-color": R.color, "--orbit-speed": "3.6s" }}><i /></span>
                  )}
                </div>

                <motion.div
                  className="text-[11px] font-bold uppercase tracking-[0.4em]"
                  style={{ color: R.color, textShadow: `0 0 12px ${R.color}66` }}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                >
                  {sub || `${R.name} freigeschaltet`}
                </motion.div>
                <motion.h2
                  className="font-heading text-2xl md:text-3xl font-black uppercase mt-1"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.58 }}
                >
                  {heading || (tiers.length === 1 ? "Neues Achievement!" : `${tiers.length} neue Achievements!`)}
                </motion.h2>
              </div>

              <div className="relative px-5 pb-4 space-y-2 max-h-[42vh] overflow-y-auto">
                {tiers.map((tier, index) => {
                  const lvl = LEVEL_META[tier.level] || LEVEL_META[1];
                  const Icon = Icons[pascal(tier.icon || "trophy")] || Trophy;
                  const framed = Number(tier.level) >= 3;
                  return (
                    <motion.div
                      key={tier.code || index}
                      data-testid={`unlock-tier-${tier.code}`}
                      className="flex items-center gap-3 p-3 rounded-sm border border-white/10 bg-white/[0.03]"
                      style={{ boxShadow: `inset 3px 0 0 ${lvl.color}` }}
                      initial={{ x: -28, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      transition={{ delay: 0.7 + index * 0.13, type: "spring", stiffness: 260, damping: 22 }}
                    >
                      <div
                        className={`w-11 h-11 rounded-sm flex items-center justify-center shrink-0 relative overflow-hidden ${framed ? `tls-frame tls-frame--${tier.level}` : ""}`}
                        style={framed ? {} : { border: `1px solid ${lvl.color}66`, backgroundColor: `${lvl.color}14` }}
                      >
                        <Icon className="w-5 h-5 relative z-[1]" style={{ color: lvl.color, filter: framed ? `drop-shadow(0 0 4px ${lvl.color})` : undefined }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: lvl.color }}>
                          {tier.level_name || lvl.name}
                        </div>
                        <div className="font-semibold text-white truncate">{tier.name}</div>
                        {tier.description && <div className="text-xs text-white/50 truncate">{tier.description}</div>}
                      </div>
                      <div className="shrink-0 text-right text-[11px] font-display font-bold" style={{ color: lvl.color }}>+{tier.points}</div>
                    </motion.div>
                  );
                })}
              </div>

              {totalPoints > 0 && (
                <motion.div
                  className="relative px-5 pb-5 text-center"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.9 }}
                >
                  <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-sm border text-xs font-black uppercase tracking-widest"
                    style={{ color: R.secondary || R.color, borderColor: `${R.color}44`, backgroundColor: `${R.color}0d` }}>
                    +{totalPoints} Punkte insgesamt
                  </span>
                </motion.div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
