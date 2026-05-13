import { Zap } from "lucide-react";

export function accountLevelTier(level) {
  const value = Number(level || 1);
  if (value >= 20) return { key: "legendary", title: "Legendär", color: "#FFD700", progressColor: "#FFD700" };
  if (value >= 16) return { key: "champion", title: "Champion", color: "#FF3B30", progressColor: "#FF3B30" };
  if (value >= 12) return { key: "elite", title: "Elite", color: "#FFD700", progressColor: "#FFD700" };
  if (value >= 8) return { key: "veteran", title: "Veteran", color: "#A855F7", progressColor: "#A855F7" };
  if (value >= 5) return { key: "pro", title: "Pro", color: "#29B6E8", progressColor: "#29B6E8" };
  if (value >= 3) return { key: "challenger", title: "Challenger", color: "#00FF88", progressColor: "#00FF88" };
  return { key: "rookie", title: "Rookie", color: "#29B6E8", progressColor: "#29B6E8" };
}

export function accountLevelFrameClass(level) {
  const tier = accountLevelTier(level);
  if (tier.key === "legendary") return "tls-account-frame tls-account-frame-legendary border-[#FFD700]/80";
  if (tier.key === "champion") return "tls-account-frame tls-account-frame-champion border-[#FF3B30]/70";
  if (tier.key === "elite") return "tls-account-frame tls-account-frame-elite border-[#FFD700]/70";
  if (tier.key === "veteran") return "tls-account-frame tls-account-frame-veteran border-[#A855F7]/70";
  if (tier.key === "pro") return "tls-account-frame tls-account-frame-pro border-[#29B6E8]/70";
  if (tier.key === "challenger") return "tls-account-frame tls-account-frame-challenger border-[#00FF88]/60";
  return "tls-account-frame border-[#29B6E8]/40";
}

export function accountAvatarFrameClass(level, isMember = false) {
  const tier = accountLevelTier(level);
  if (tier.key === "legendary") return "tls-account-avatar-frame tls-account-avatar-frame-legendary border-[#FFD700]/80";
  if (tier.key === "champion") return "tls-account-avatar-frame tls-account-avatar-frame-champion border-[#FF3B30]/75";
  if (tier.key === "elite") return "tls-account-avatar-frame tls-account-avatar-frame-elite border-[#FFD700]/70";
  if (tier.key === "veteran") return "tls-account-avatar-frame tls-account-avatar-frame-veteran border-[#A855F7]/70";
  if (tier.key === "pro") return "tls-account-avatar-frame tls-account-avatar-frame-pro border-[#29B6E8]/70";
  if (tier.key === "challenger") return "tls-account-avatar-frame tls-account-avatar-frame-challenger border-[#00FF88]/60";
  return isMember ? "border-[#FFD700]/50" : "border-white/15";
}

export function accountLevelAuraClass(level) {
  const tier = accountLevelTier(level);
  if (tier.key === "legendary") return "tls-profile-aura tls-profile-aura--legendary";
  if (tier.key === "champion") return "tls-profile-aura tls-profile-aura--champion";
  if (tier.key === "elite") return "tls-profile-aura tls-profile-aura--elite";
  if (tier.key === "veteran") return "tls-profile-aura tls-profile-aura--veteran";
  if (tier.key === "pro") return "tls-profile-aura tls-profile-aura--pro";
  if (tier.key === "challenger") return "tls-profile-aura tls-profile-aura--challenger";
  return "tls-profile-aura";
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

export function AccountLevelProgress({ level, points = 0, nextLevelPoints = 100, progress = 0, compact = false }) {
  const tier = accountLevelTier(level);
  return (
    <div data-testid="account-level-progress">
      {!compact && (
        <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-white/45 font-bold">
          <span>Achievement-Level</span>
          <span>{points} / {nextLevelPoints} Punkte · {tier.title}</span>
        </div>
      )}
      <div className={`${compact ? "h-1" : "mt-2 h-2"} rounded-sm bg-white/10 overflow-hidden`}>
        <div
          className={`h-full ${tier.key === "legendary" || tier.key === "champion" ? "tls-account-progress-prestige" : ""}`}
          style={{ width: `${Math.max(0, Math.min(100, Number(progress || 0)))}%`, backgroundColor: tier.progressColor, color: tier.progressColor }}
        />
      </div>
    </div>
  );
}
