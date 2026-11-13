import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import { motionTransition } from "@/lib/motion";
import { artLines } from "@/lib/leagueRewards";
import { RewardArt } from "./RewardArt";
import { RewardShareButton } from "./RewardShareButton";

/**
 * Zeremonie einer Liga-Belohnung (F.4, #2214, Nr. 165): beim nächsten Besuch nach dem Abschluss einmal je Belohnung - im Stil des
 * Sieger-Moments (PlacementMoment, .tls-placement): ruhig, Metall an Kante und Grafik. Die Grafik hebt sich an, der Glanz zieht einmal
 * darüber, die Kante leuchtet kurz auf; die Zeilen folgen gestaffelt. Mehrere Belohnungen derselben Staffel stehen nebeneinander.
 * „Bewegung reduzieren“ oder „Zeremonien dezent“: nur Einblenden.
 *
 * Läuft über den Zeremonie-Host (components/achievements/ceremony) - nie zugleich mit einem Erfolg.
 */
export function RewardMoment({ plan, onClose, reduced = false, profileHref = "/u/me?tab=awards" }) {
  const awards = plan.rewards || [];
  const first = awards[0];
  const cardRef = useModalBehavior(true, onClose);
  if (!first) return null;
  const metal = ["gold", "silver", "bronze"].includes(first.reward?.art?.metal) ? first.reward.art.metal : "lion";
  const many = awards.length > 1;
  const heading = many ? `${awards.length} neue Belohnungen` : "Neue Belohnung";
  const title = many ? awards.map((award) => award.reward.name).join(" · ") : first.reward.name;
  const lines = [
    <p key="label" className="tls-placement__label">{heading}</p>,
    <h2 key="title" className="tls-placement__title font-heading">{title}</h2>,
    <p key="where" className="tls-placement__name">{artLines(first.reward.art).join(" · ")}</p>,
    first.team?.name ? <p key="team" className="tls-placement__tournament">{first.team.name}</p> : null,
  ].filter(Boolean);
  return (
    <motion.div
      className="tls-placement tls-reward-moment"
      role="dialog"
      aria-modal="true"
      aria-label={`${heading}: ${title}`}
      data-testid="reward-moment"
      data-metal={metal}
      data-reduced={reduced ? "true" : undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: motionTransition("mid") }}
      exit={{ opacity: 0, transition: motionTransition("fast") }}
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
        animate={{ opacity: 1, transform: "translateY(0px) scale(1)", transition: motionTransition("slow") }}
        exit={{ opacity: 0, transition: motionTransition("fast") }}
      >
        <button type="button" onClick={onClose} className="tls-placement__close" aria-label="Schließen" data-testid="reward-moment-close">
          <X className="h-5 w-5" />
        </button>
        <div className="mb-3 flex flex-wrap items-end justify-center gap-3" data-testid="reward-moment-arts">
          {awards.slice(0, 4).map((award, index) => (
            <RewardArt key={award.id} reward={award.reward} size={many ? "md" : "lg"} play={reduced ? undefined : "run"} index={index}
              testId={`reward-moment-art-${award.id}`} />
          ))}
        </div>
        <div className="tls-placement__text">
          {lines.map((line, index) => (
            <div key={line.key} className="tls-placement__line" style={{ "--tls-i": index }}>{line}</div>
          ))}
        </div>
        <div className="tls-placement__actions tls-placement__line" style={{ "--tls-i": lines.length }}>
          <RewardShareButton award={first} testId="reward-moment-share" />
          <Link to={profileHref} onClick={onClose} data-testid="reward-moment-collection"
            className="tls-btn tls-btn--secondary inline-flex min-h-[44px] items-center gap-2 px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">
            Zur Sammlung
          </Link>
        </div>
      </motion.div>
    </motion.div>
  );
}
