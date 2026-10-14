import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { GitBranch, Medal, Trophy, X } from "lucide-react";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import { ShareButton } from "@/components/tls/ShareButton";
import { motionTransition } from "@/lib/motion";

/**
 * Sieger-Moment (#1180): nach dem Ende einmal je Browser die Karte für Platz 1 bis 3 - feierlich, aber ruhig. Gold mit
 * Pokal, Silber und Bronze mit Medaille; Metall nur an Kante, Symbol und Ziffer. Die Karte hebt sich weich herein, die
 * Ziffer schwingt kaum merklich über, die Zeilen folgen im Abstand von 60 ms, über den Pokal läuft einmal ein Glanz.
 * Kein Konfetti. „Bewegung reduzieren“ oder „Zeremonien dezent“: nur Einblenden.
 *
 * Läuft über den Zeremonie-Host (components/achievements/ceremony) - nie zugleich mit einem Erfolg.
 */
export function PlacementMoment({ plan, onClose, reduced = false }) {
  const placement = plan.placement;
  const cardRef = useModalBehavior(true, onClose);
  const Icon = placement.rank === 1 ? Trophy : Medal;
  const bracketPath = placement.tournamentPath ? `${placement.tournamentPath}/bracket` : "/tournaments";
  const lines = [
    <p key="label" className="tls-placement__label">{placement.label}</p>,
    <h2 key="title" className="tls-placement__title font-heading">{placement.title}</h2>,
    <p key="name" className="tls-placement__name">{placement.name}{placement.team ? " · mit deinem Team" : ""}</p>,
    placement.tournamentTitle ? <p key="tournament" className="tls-placement__tournament">{placement.tournamentTitle}</p> : null,
  ].filter(Boolean);
  return (
    <motion.div
      className="tls-placement"
      role="dialog"
      aria-modal="true"
      aria-label={`${placement.title}: ${placement.tournamentTitle || "Turnier"}`}
      data-testid="placement-moment"
      data-metal={placement.metal}
      data-reduced={reduced ? "true" : undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={motionTransition("mid")}
      onClick={onClose}
    >
      <div className="tls-placement__backdrop" aria-hidden="true" />
      <motion.div
        ref={cardRef}
        tabIndex={-1}
        className="tls-placement__card"
        data-play={reduced ? undefined : "run"}
        onClick={(event) => event.stopPropagation()}
        initial={reduced ? { opacity: 0 } : { opacity: 0, transform: "translateY(12px) scale(0.97)" }}
        animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
        exit={{ opacity: 0 }}
        transition={motionTransition("slow")}
      >
        <button type="button" onClick={onClose} className="tls-placement__close" aria-label="Schließen" data-testid="placement-moment-close">
          <X className="h-5 w-5" />
        </button>
        <div className="tls-placement__stage" aria-hidden="true">
          <span className="tls-placement__icon"><Icon className="h-9 w-9" strokeWidth={1.75} /></span>
          <span className="tls-placement__digit">{placement.rank}</span>
        </div>
        <div className="tls-placement__text">
          {lines.map((line, index) => (
            <div key={line.key} className="tls-placement__line" style={{ "--tls-i": index }}>{line}</div>
          ))}
        </div>
        <div className="tls-placement__actions tls-placement__line" style={{ "--tls-i": lines.length }}>
          <ShareButton kind="tournament" id={placement.tournamentSlug || placement.tournamentId} title={placement.tournamentTitle} testId="placement-moment-share" />
          <Link to={bracketPath} onClick={onClose} className="tls-btn tls-btn--secondary inline-flex min-h-[44px] items-center gap-2 px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider" data-testid="placement-moment-bracket">
            <GitBranch className="h-3.5 w-3.5" aria-hidden="true" /> Turnierbaum
          </Link>
        </div>
      </motion.div>
    </motion.div>
  );
}
