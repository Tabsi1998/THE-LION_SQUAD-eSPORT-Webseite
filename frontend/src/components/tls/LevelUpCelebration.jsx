import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, resolveMediaUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { LevelAvatarFrame, levelFrameConfig } from "@/components/tls/LevelAvatarFrame";

const COLORS = ["#29B6E8", "#7FDBFF", "#FFD700", "#00FF88", "#A855F7", "#FFFFFF", "#FF7A00"];

function ConfettiRain() {
  const pieces = useMemo(() => Array.from({ length: 80 }).map((_, i) => ({
    left: `${Math.random() * 100}%`,
    background: COLORS[i % COLORS.length],
    animationDuration: `${2.6 + Math.random() * 2.6}s`,
    animationDelay: `${Math.random() * 1.6}s`,
    width: `${6 + Math.random() * 7}px`,
    height: `${10 + Math.random() * 9}px`,
    borderRadius: Math.random() > 0.5 ? "50%" : "1px",
  })), []);
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {pieces.map((style, i) => <span key={i} className="tls-confetti" style={style} />)}
    </div>
  );
}

const storeKey = (uid) => `tls-level-seen:${uid}`;

export function LevelUpCelebration() {
  const { user } = useAuth();
  const [event, setEvent] = useState(null);
  const busyRef = useRef(false);

  const check = useCallback(async () => {
    if (!user?.id || busyRef.current) return;
    busyRef.current = true;
    try {
      const { data } = await api.get("/users/me/level");
      const nextLevel = Number(data?.level || 1);
      const key = storeKey(user.id);
      let prev = null;
      try { prev = Number(localStorage.getItem(key)); } catch {}
      if (prev && !Number.isNaN(prev) && nextLevel > prev) {
        const cfg = levelFrameConfig(nextLevel);
        setEvent({ level: nextLevel, archetype: cfg.name });
      }
      try { localStorage.setItem(key, String(nextLevel)); } catch {}
    } catch {}
    finally { busyRef.current = false; }
  }, [user?.id]);

  useEffect(() => { check(); }, [check]);
  useApiInvalidation(check, ["achievements", "admin/notifications", "notifications"]);
  useEffect(() => {
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [check]);

  useEffect(() => {
    if (!event) return undefined;
    const timer = setTimeout(() => setEvent(null), 11000);
    return () => clearTimeout(timer);
  }, [event]);

  if (!event) return null;
  const initials = (user?.display_name || user?.username || "?").slice(0, 2).toUpperCase();
  return (
    <div
      className="tls-crown-celebration"
      style={{ "--crown-glow": "rgba(41,182,232,0.9)" }}
      data-testid="levelup-celebration-overlay"
      role="dialog"
      aria-label="Level-Aufstieg"
      onClick={() => setEvent(null)}
    >
      <ConfettiRain />
      <div className="tls-crown-celebration-card" onClick={(e) => e.stopPropagation()}>
        <span className="tls-crown-celebration-rays" aria-hidden="true" />
        <div className="tls-levelup-frame" data-testid="levelup-frame-preview">
          <LevelAvatarFrame level={event.level} showBadge={false} className="w-36 h-36 sm:w-44 sm:h-44">
            <div className="w-full h-full flex items-center justify-center overflow-hidden bg-[#0A0A0A]">
              {user?.avatar_url ? (
                <img src={resolveMediaUrl(user.avatar_url)} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="font-heading font-black text-3xl text-[#29B6E8]">{initials}</span>
              )}
            </div>
          </LevelAvatarFrame>
        </div>
        <div className="mt-8 text-[11px] font-bold uppercase tracking-[0.4em] text-[#29B6E8]" data-testid="levelup-level-label">
          Level {event.level} erreicht
        </div>
        <h2 className="mt-2 font-heading text-4xl sm:text-5xl font-black uppercase text-white" data-testid="levelup-archetype-name">
          {event.archetype}
        </h2>
        <p className="mt-3 text-white/70 max-w-md mx-auto" data-testid="levelup-body">
          Dein neuer Avatar-Rahmen „{event.archetype}“ ist freigeschaltet — trag ihn mit Stolz.
        </p>
        <button
          type="button"
          onClick={() => setEvent(null)}
          data-testid="levelup-close"
          className="mt-8 px-6 py-2.5 bg-[#29B6E8] text-black rounded-sm font-bold uppercase tracking-wider text-xs hover:bg-[#1E95C2]"
        >
          Weiter grinden
        </button>
      </div>
    </div>
  );
}
