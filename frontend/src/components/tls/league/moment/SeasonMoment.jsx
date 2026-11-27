import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import { motionTransition } from "@/lib/motion";
import { badgeTier } from "@/lib/leagueBadge";
import { Crown, FIELD, LeagueBadge, SHIELD, Shield, paint } from "@/components/tls/league/LeagueBadge";
import { TrophyCup } from "@/components/tls/TrophyShelf";
import { RewardCardContent } from "@/components/tls/rewards/RewardMoment";
import "./seasonMoment.css";

const METALS = { champion: "gold", up: "lion", down: "calm" };
// Das Wappen: Gold für den Meister, Cyan hinauf, ruhiges Grau-Blau hinunter (F.8).
const CREST_METALS = { champion: "gold", up: "cyan", down: "calm" };

function CrestNumber({ value, className }) {
  const text = String(value ?? "");
  return (
    <g className={className}>
      <text x="32" y="47" textAnchor="middle" dominantBaseline="central" className="tls-lbadge__number"
        fontSize={text.length > 1 ? 17 : 23}>{text}</text>
    </g>
  );
}

/**
 * Das Wappen im Moment (#1639): dasselbe wie das Liga-Abzeichen (#1638), nur mit Zahlenwechsel. Beide Stufen liegen übereinander -
 * vorher und nachher. Ohne Bewegung (und am Ende jeder Bewegung) steht nur das Nachher da; die Bewegung blendet das Vorher aus.
 */
function MomentCrest({ moment }) {
  const rawId = useId();
  const id = `sm${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const before = moment.badge_from?.level ?? moment.from?.level;
  const after = moment.badge_to?.level ?? moment.to?.level;
  const tierBefore = badgeTier(before) || "base";
  const tierAfter = badgeTier(after) || "base";
  return (
    <span className="tls-lbadge tls-season-moment__crest" data-metal={CREST_METALS[moment.outcome] || "cyan"}
      data-tier={tierAfter} data-testid="season-moment-crest">
      <span className="tls-season-moment__glow" aria-hidden="true" />
      <svg viewBox="0 0 64 80" className="tls-season-moment__svg" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={`${id}-metal`} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" style={{ stopColor: paint("dark") }} />
            <stop offset="0.42" style={{ stopColor: paint("light") }} />
            <stop offset="0.62" style={{ stopColor: paint("base") }} />
            <stop offset="1" style={{ stopColor: paint("dark") }} />
          </linearGradient>
          <clipPath id={`${id}-field`}><path d={FIELD} /></clipPath>
          <clipPath id={`${id}-clip`}><path d={SHIELD} /></clipPath>
        </defs>
        {tierBefore !== tierAfter ? <g className="tls-season-moment__shield tls-season-moment__shield--from"><Shield tier={tierBefore} id={id} /></g> : null}
        <g className="tls-season-moment__shield tls-season-moment__shield--to"><Shield tier={tierAfter} id={id} /></g>
        <g clipPath={`url(#${id}-clip)`}>
          <rect className="tls-season-moment__shine" x="-14" y="10" width="10" height="76" fill="#FFFFFF" transform="skewX(-18)" />
        </g>
        {/* Die Zahl zählt im Feld des Wappens um - wie ein Zählwerk: Die alte geht, die neue kommt und federt leicht nach. */}
        <g clipPath={`url(#${id}-field)`} style={{ fill: paint(tierAfter === "base" ? "base" : "light") }}>
          {before !== after ? <CrestNumber value={before} className="tls-season-moment__num tls-season-moment__num--from" /> : null}
          <CrestNumber value={after} className="tls-season-moment__num tls-season-moment__num--to" />
        </g>
        {tierBefore === "top" && tierAfter !== "top" ? <Crown id={id} className="tls-season-moment__crown tls-season-moment__crown--from" /> : null}
        {tierAfter === "top" ? <Crown id={id} className="tls-season-moment__crown tls-season-moment__crown--to" testId="season-moment-crown" /> : null}
      </svg>
    </span>
  );
}

function ChampionStage({ moment }) {
  return (
    <div className="tls-season-moment__trophy" data-testid="season-moment-trophy">
      <span className="tls-season-moment__halo" aria-hidden="true" />
      <TrophyCup medal="gold" className="tls-season-moment__cup" />
      {moment.badge_to ? (
        <span className="tls-season-moment__badge">
          <LeagueBadge badge={moment.badge_to} size="card" label={false} decorative play={false} />
        </span>
      ) : null}
    </div>
  );
}

/**
 * Saisonende-Moment (#1639, docs/LIGA.md „F.8 Saisonende-Moment“): einmal je Season und Person, wenn der Endstand der ganzen Season
 * bestätigt ist - im Stil der Zeremonie (RewardMoment, PlacementMoment: ruhige Karte, Metall an der Kante). Die Texte kommen vom Server.
 *
 * Detail-Runde der Bewegung (seasonMoment.css, nur transform und opacity, Dauern und Kurve aus den Tokens):
 * - Aufstieg: Das Wappen hebt sich, die Zahl zählt um (die alte steigt hinaus, die neue kommt von unten und federt leicht nach), in
 *   Liga 1 setzt sich die Krone, dann läuft ein Glanz über das Wappen und die Kante leuchtet einmal auf.
 * - Meister: Der goldene Pokal hebt sich, ein Glanz zieht darüber, der Schein dahinter leuchtet einmal; das goldene Abzeichen folgt.
 * - Abstieg: ruhig - das Wappen setzt sich, die Zahl wechselt ohne Nachfedern, kein Glanz; der Text schaut auf die nächste Season.
 * - Die Zeilen folgen gestaffelt. „Bewegung reduzieren“ oder „Zeremonien dezent“: gleich der Endzustand.
 *
 * Meister mit Belohnungen (Fabian 26.11., A): ein Ablauf - „Weiter“ zeigt die Belohnungen als zweite Karte in derselben Karte, ohne
 * neues Aufpoppen. Nach einer Korrektur steht oben „Endstand korrigiert“ (B).
 *
 * Schließen mit X, Escape, Tipp daneben oder „Weiter“; der Fokus bleibt in der Karte (useModalBehavior). Läuft über den Zeremonie-Host -
 * nie zugleich mit einer anderen Zeremonie.
 */
export function SeasonMoment({ plan, onClose, reduced = false }) {
  const moment = plan.moment;
  const cardRef = useModalBehavior(true, onClose);
  const titleId = useId();
  const textId = useId();
  const rewardTitleId = useId();
  const rewards = plan.rewards || [];
  const [step, setStep] = useState("moment");
  const onRewardsShown = plan.onRewardsShown;
  useEffect(() => {
    if (step !== "rewards") return;
    onRewardsShown?.();
    // Der Inhalt wechselt in derselben Karte - der Fokus geht an ihren Anfang, Screenreader lesen den neuen Titel.
    cardRef.current?.focus?.();
  }, [step, onRewardsShown, cardRef]);
  if (!moment) return null;
  const outcome = moment.outcome;
  const texts = moment.texts || {};
  const onRewards = step === "rewards";
  const advance = () => (rewards.length && !onRewards ? setStep("rewards") : onClose());
  const lines = [
    texts.notice ? <p key="notice" className="tls-season-moment__notice" data-testid="season-moment-notice">{texts.notice}</p> : null,
    <p key="kicker" className="tls-placement__label" data-testid="season-moment-kicker">{texts.kicker}</p>,
    <h2 key="title" id={titleId} className="tls-placement__title font-heading" data-testid="season-moment-title">{texts.title}</h2>,
    <p key="name" className="tls-placement__name" data-testid="season-moment-name">{texts.name}</p>,
    <p key="meta" className="tls-placement__tournament">{texts.meta}</p>,
    <p key="line" id={textId} className="tls-season-moment__line" data-testid="season-moment-line">{texts.line}</p>,
    texts.next ? <p key="next" className="tls-season-moment__next" data-testid="season-moment-next">{texts.next}</p> : null,
  ].filter(Boolean);
  const next = moment.next_step;
  return (
    <motion.div
      className="tls-placement tls-season-moment"
      role="dialog"
      aria-modal="true"
      aria-labelledby={onRewards ? rewardTitleId : titleId}
      aria-describedby={onRewards ? undefined : textId}
      data-testid="season-moment"
      data-outcome={outcome}
      data-metal={METALS[outcome] || "lion"}
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
        className="tls-placement__card tls-season-moment__card"
        data-play={reduced ? undefined : "run"}
        onClick={(event) => event.stopPropagation()}
        initial={reduced ? { opacity: 0 } : { opacity: 0, transform: "translateY(12px) scale(0.97)" }}
        animate={{ opacity: 1, transform: "translateY(0px) scale(1)", transition: motionTransition("slow") }}
        exit={{ opacity: 0, transition: motionTransition("fast") }}
      >
        <button type="button" onClick={onClose} className="tls-placement__close" aria-label="Schließen" data-testid="season-moment-close">
          <X className="h-5 w-5" />
        </button>
        {onRewards ? (
          <div className="tls-season-moment__rewards" data-testid="season-moment-rewards">
            <RewardCardContent awards={rewards} onClose={onClose} reduced={reduced} titleId={rewardTitleId} />
            <div className="tls-placement__actions tls-placement__line" style={{ "--tls-i": 5 }}>
              <button type="button" onClick={advance} data-testid="season-moment-done"
                className="tls-btn tls-btn--secondary inline-flex min-h-[44px] items-center gap-2 px-3 py-2 rounded-sm tls-type-label">
                Fertig
              </button>
            </div>
          </div>
        ) : (
        <>
        <div className="tls-season-moment__stage" aria-hidden="true">
          {outcome === "champion" ? <ChampionStage moment={moment} /> : <MomentCrest moment={moment} />}
        </div>
        {/* Für Screenreader der ganze Satz - das Wappen mit dem Zahlenwechsel ist Zier. */}
        <p className="sr-only">{texts.aria}</p>
        <div className="tls-placement__text">
          {lines.map((line, index) => (
            <div key={line.key} className="tls-placement__line" style={{ "--tls-i": index }}>{line}</div>
          ))}
        </div>
        <div className="tls-placement__actions tls-placement__line" style={{ "--tls-i": lines.length }}>
          {next ? (
            <Link to={next.url} onClick={onClose} data-testid="season-moment-next-step"
              className="tls-btn tls-btn--primary inline-flex min-h-[44px] items-center gap-2 px-3 py-2 rounded-sm tls-type-label">
              {next.label}
            </Link>
          ) : null}
          {moment.url ? (
            <Link to={moment.url} onClick={onClose} data-testid="season-moment-final"
              className="tls-btn tls-btn--secondary inline-flex min-h-[44px] items-center gap-2 px-3 py-2 rounded-sm tls-type-label">
              Endstand ansehen
            </Link>
          ) : null}
          <button type="button" onClick={advance} data-testid="season-moment-done"
            className="tls-btn tls-btn--secondary inline-flex min-h-[44px] items-center gap-2 px-3 py-2 rounded-sm tls-type-label">
            Weiter
          </button>
        </div>
        </>
        )}
      </motion.div>
    </motion.div>
  );
}
