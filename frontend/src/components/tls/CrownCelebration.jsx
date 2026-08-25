import { useEffect, useMemo, useState } from "react";
import { CrownIcon, CROWN_LABELS, refreshCrowns } from "./LevelAvatarFrame";

const GLOWS = {
  gold: "rgba(255,215,0,0.9)",
  silver: "rgba(221,229,238,0.9)",
  bronze: "rgba(205,127,50,0.9)",
};
const NAMES = { gold: "GOLD-KRONE", silver: "SILBER-KRONE", bronze: "BRONZE-KRONE" };
const COLORS = ["#FFD700", "#29B6E8", "#FF3B30", "#00FF88", "#A855F7", "#FFFFFF", "#FF7A00"];

function ConfettiRain() {
  const pieces = useMemo(() => Array.from({ length: 90 }).map((_, i) => ({
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

export function CrownCelebration() {
  const [event, setEvent] = useState(null);

  useEffect(() => {
    const onEvent = (e) => {
      setEvent(e.detail || {});
      refreshCrowns();
    };
    window.addEventListener("tls-crown-celebration", onEvent);
    return () => window.removeEventListener("tls-crown-celebration", onEvent);
  }, []);

  useEffect(() => {
    if (!event) return undefined;
    const timer = setTimeout(() => setEvent(null), 10000);
    return () => clearTimeout(timer);
  }, [event]);

  if (!event) return null;
  const variant = event.variant || "gold";
  return (
    <div
      className="tls-crown-celebration"
      style={{ "--crown-glow": GLOWS[variant] || GLOWS.gold }}
      data-testid="crown-celebration-overlay"
      role="dialog"
      aria-label="Kronen-Feier"
      onClick={() => setEvent(null)}
    >
      <ConfettiRain />
      <div className="tls-crown-celebration-card" onClick={(e) => e.stopPropagation()}>
        <span className="tls-crown-celebration-rays" aria-hidden="true" />
        <div className="tls-crown-celebration-crown">
          <CrownIcon variant={variant} />
        </div>
        <div className="mt-6 text-[11px] font-bold uppercase tracking-[0.4em] text-[#29B6E8]">Kronen-Wechsel</div>
        <h2 className="mt-2 font-heading text-4xl sm:text-5xl font-black uppercase text-white" data-testid="crown-celebration-title">
          {NAMES[variant] || "KRONE"} EROBERT!
        </h2>
        <p className="mt-3 text-white/70 max-w-md mx-auto" data-testid="crown-celebration-body">
          {event.body || CROWN_LABELS[variant] || "Du gehörst jetzt zu den Top 3 der Punktewertung!"}
        </p>
        <button
          type="button"
          onClick={() => setEvent(null)}
          data-testid="crown-celebration-close"
          className="mt-8 px-6 py-2.5 bg-[#29B6E8] text-black rounded-sm font-bold uppercase tracking-wider text-xs hover:bg-[#1E95C2]"
        >
          Weiter dominieren
        </button>
      </div>
    </div>
  );
}
