import { useEffect, useMemo } from "react";
import { CrownIcon, CROWN_LABELS, refreshCrowns } from "./LevelAvatarFrame";
import { useModalBehavior } from "@/hooks/useModalBehavior";

// Die Kronen-Feier selbst (seit #936 eigene Datei): Kronen-Grafik, Konfetti und Kronen-Abgleich laden erst, wenn
// CrownCelebration.jsx ein Ereignis bekommt - beim Start der öffentlichen Seiten braucht sie niemand.

const GLOWS = {
  gold: "rgba(255,215,0,0.9)",
  silver: "rgba(221,229,238,0.9)",
  bronze: "rgba(205,127,50,0.9)",
  onyx: "rgba(41,182,232,0.9)",
};
const NAMES = { gold: "GOLD-KRONE", silver: "SILBER-KRONE", bronze: "BRONZE-KRONE", onyx: "ONYX-KRONE" };
// Onyx erobert man niemandem ab, man erreicht sie mit den eigenen Punkten (#2501).
const VERBS = { onyx: "ERREICHT!" };
/** Die Zeile über der Überschrift (#2501): ein Wechsel nur, wenn vorher schon eine andere Krone getragen wurde. */
function overline(event, variant) {
  if (variant === "onyx") return "Höchste Krone";
  return event?.prev ? "Kronen-Wechsel" : "Neue Krone";
}
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

export default function CrownCelebrationCard({ event, onClose }) {
  // Jede Feier holt die Kronen neu, damit Rahmen und Ranglisten gleich die neue Krone zeigen.
  useEffect(() => {
    refreshCrowns();
  }, [event]);

  const cardRef = useModalBehavior(true, onClose);
  const variant = event?.variant || "gold";
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- Escape und die Schaltfläche schließen das Overlay; der Klick daneben ist nur eine Maus-Abkürzung.
    <div
      className="tls-crown-celebration"
      style={{ "--crown-glow": GLOWS[variant] || GLOWS.gold }}
      data-testid="crown-celebration-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Kronen-Feier"
      onClick={onClose}
    >
      <ConfettiRain />
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- fängt nur den Klick ab, damit er das Overlay nicht schließt */}
      <div ref={cardRef} tabIndex={-1} className="tls-crown-celebration-card focus:outline-none" onClick={(e) => e.stopPropagation()}>
        <span className="tls-crown-celebration-rays" aria-hidden="true" />
        <div className="tls-crown-celebration-crown">
          <CrownIcon variant={variant} />
        </div>
        <div className="mt-6 tls-type-label text-[#29B6E8]" data-testid="crown-celebration-overline">
          {overline(event, variant)}
        </div>
        <h2 className="mt-2 tls-type-title text-white" data-testid="crown-celebration-title">
          {NAMES[variant] || "KRONE"} {VERBS[variant] || "EROBERT!"}
        </h2>
        <p className="mt-3 text-white/70 max-w-md mx-auto" data-testid="crown-celebration-body">
          {event.body || CROWN_LABELS[variant] || "Du gehörst jetzt zu den Top 3 der Punktewertung!"}
        </p>
        <button
          type="button"
          onClick={onClose}
          data-testid="crown-celebration-close"
          className="tls-btn tls-btn--primary mt-8 px-6 py-2.5 rounded-sm tls-type-label"
        >
          Weiter dominieren
        </button>
      </div>
    </div>
  );
}
