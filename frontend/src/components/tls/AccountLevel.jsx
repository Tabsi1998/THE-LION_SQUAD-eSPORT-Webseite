import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { motion } from "framer-motion";
import { rankInfo } from "@/lib/loewenRang";

function useCountUp(target, duration = 950) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const to = Number(target || 0);
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(to * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

// Löwen-Rang (#1452): der Titel ist der Rang-Name, wie im Backend und am Rahmen. Farben nur Cyan (Rang 1–5) und Gold
// (ab Rang 6); `key` wählt die bestehenden Karten- und Leuchtklassen, Rang 12 bekommt den Puls.
const BORDER = { rookie: "border-[#29B6E8]/40", pro: "border-[#29B6E8]/70", elite: "border-[#FFD700]/70", legendary: "border-[#FFD700]/80" };

export function accountLevelTier(level) {
  const info = rankInfo(level);
  const key = info.rank >= 12 ? "legendary" : info.rank >= 6 ? "elite" : info.rank >= 2 ? "pro" : "rookie";
  return { key, rank: info.rank, title: info.name, color: info.color, progressColor: info.color };
}

export function accountLevelFrameClass(level) {
  const { key } = accountLevelTier(level);
  return key === "rookie" ? `tls-account-frame ${BORDER.rookie}` : `tls-account-frame tls-account-frame-${key} ${BORDER[key]}`;
}

export function accountAvatarFrameClass(level, isMember = false) {
  const { key } = accountLevelTier(level);
  if (key === "rookie") return isMember ? "border-[#FFD700]/50" : "border-white/15";
  return `tls-account-avatar-frame tls-account-avatar-frame-${key} ${BORDER[key]}`;
}

export function accountLevelAuraClass(level) {
  const { key } = accountLevelTier(level);
  return key === "rookie" ? "tls-profile-aura" : `tls-profile-aura tls-profile-aura--${key}`;
}

export function AccountLevelPill({ level, className = "" }) {
  const tier = accountLevelTier(level);
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 border text-[10px] uppercase tracking-widest rounded-sm font-bold ${className}`}
      style={{ color: tier.color, borderColor: `${tier.color}66`, backgroundColor: `${tier.color}12` }}
    >
      <Zap className="w-3 h-3" /> Level {Number(level || 1)} · {tier.title}
    </span>
  );
}

export function AccountLevelProgress({ level, points = 0, nextLevelPoints = 100, progress = 0, compact = false, title = null, unit = "Punkte" }) {
  const tier = accountLevelTier(level);
  const pct = Math.max(0, Math.min(100, Number(progress || 0)));
  const lvlNum = Number(level || 1);
  const shownPoints = useCountUp(points);
  return (
    <div data-testid="account-level-progress">
      {!compact && (
        <div className="flex items-center gap-3">
          <motion.div
            className="tls-lvlring relative w-11 h-11 rounded-full flex items-center justify-center shrink-0 font-display font-black"
            style={{ "--ring": tier.color, color: tier.color }}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 240, damping: 16 }}
          >
            {lvlNum}
            {["elite", "legendary"].includes(tier.key) && (
              <span className="tls-orbit rounded-full" style={{ "--orbit-color": tier.color, "--orbit-speed": "3.2s" }} aria-hidden="true"><i /></span>
            )}
          </motion.div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-white/45 font-bold">
              <span style={{ color: tier.color }} data-testid="account-level-title">{title || tier.title}</span>
              <span className="tabular-nums">{shownPoints} / {nextLevelPoints} {unit}</span>
            </div>
            <div className="mt-2 h-2.5 rounded-sm bg-white/10 overflow-hidden relative">
              <motion.div
                className="h-full tls-level-fill"
                style={{ backgroundColor: tier.progressColor }}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 1, ease: "easeOut" }}
              />
              {pct > 4 && (
                <motion.span
                  className="tls-bar-spark absolute top-1/2 w-1.5 h-1.5 rounded-full pointer-events-none"
                  style={{ backgroundColor: tier.progressColor, boxShadow: `0 0 8px ${tier.progressColor}, 0 0 14px ${tier.progressColor}` }}
                  initial={{ left: 0, opacity: 0 }}
                  animate={{ left: `calc(${pct}% - 3px)`, opacity: 1 }}
                  transition={{ duration: 1, ease: "easeOut" }}
                />
              )}
            </div>
          </div>
        </div>
      )}
      {compact && (
        <div className="h-1 rounded-sm bg-white/10 overflow-hidden">
          <motion.div
            className="h-full tls-level-fill"
            style={{ backgroundColor: tier.progressColor }}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          />
        </div>
      )}
    </div>
  );
}
