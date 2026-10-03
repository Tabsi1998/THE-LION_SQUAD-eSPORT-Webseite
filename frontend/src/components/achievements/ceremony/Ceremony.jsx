import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, ChevronLeft, ChevronRight, Star, Trophy, Volume2, VolumeX, X } from "lucide-react";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import { Badge } from "../Badge";
import { MATERIAL_LOOKS } from "../materials";
import { Motion, StageBadge } from "./motions";
import { runParticles } from "./particles";
import { groupTier, particleKind } from "./select";
import { playCeremonySound, readSoundPrefs, writeSoundPrefs } from "./sounds";
import "./ceremony.css";

// Erfolge II (E8, #618): die Zeremonie. Ein Plan (select.js) sagt, welches Material, welche Bewegung und
// welcher Sonderablauf; hier steht die Bühne dazu: Kulisse, Abzeichen, Texte, Stapel mit Pfeilen,
// Sockel für die Gruppe, Vitrine für die Kategorie, Prisma für Diamant, Banner für Legendär, Zahl
// für das Level. Escape und Klick daneben schließen, der Fokus geht zurück (useModalBehavior),
// aria-live sagt den Text, „dezent“ und reduzierte Bewegung lassen nur das Einblenden übrig.

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII"];

function Particles({ plan, reduced }) {
  const ref = useRef(null);
  useEffect(() => {
    if (reduced || !ref.current) return undefined;
    const canvas = ref.current;
    canvas.width = canvas.clientWidth || window.innerWidth;
    canvas.height = canvas.clientHeight || window.innerHeight;
    const kind = plan.sequence === "levelup" ? "glint" : particleKind(plan.material);
    const run = runParticles(canvas, { kind, budget: plan.particles, origin: { x: canvas.width / 2, y: canvas.height * 0.42 } });
    return () => run.stop();
  }, [plan, reduced]);
  if (reduced) return null;
  return <canvas ref={ref} className="tls-ceremony__canvas" data-testid="ceremony-particles" aria-hidden="true" />;
}

function TierRow({ tier, material, index, active, onPick }) {
  const look = MATERIAL_LOOKS[material] || MATERIAL_LOOKS.bronze;
  return (
    <motion.button
      type="button"
      onClick={onPick ? () => onPick(index) : undefined}
      data-testid={`ceremony-tier-${tier.code}`}
      aria-current={active ? "true" : undefined}
      className={`w-full flex items-center gap-3 p-2.5 rounded-sm border text-left transition ${active ? "border-white/30 bg-white/[0.05]" : "border-white/10 bg-white/[0.02]"}`}
      style={{ boxShadow: `inset 3px 0 0 ${look.rim}` }}
      initial={{ x: -24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ delay: 0.7 + index * 0.12, type: "spring", stiffness: 260, damping: 22 }}
    >
      <Badge material={tier.material} level={tier.level} rank={tier.rank} art={tier.art} icon={tier.icon} size="md" />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: look.rim }}>{tier.material_name || look.name}{tier.group_name ? ` · ${tier.group_name}` : ""}</div>
        <div className="font-semibold text-white truncate">{tier.name}</div>
        {tier.description && <div className="text-xs text-white/50 truncate">{tier.description}</div>}
      </div>
      <div className="shrink-0 text-[11px] font-display font-bold" style={{ color: look.rim }}>+{tier.points}</div>
    </motion.button>
  );
}

// Gruppe abgeschlossen: der Sockel wächst, die sieben Stufen leuchten nacheinander auf.
function GroupPedestal({ plan, reduced }) {
  const top = groupTier(plan);
  const ranks = [1, 2, 3, 4, 5, 6, 7];
  const ladder = ["wood", "iron", "bronze", "silver", "gold", "platinum", "diamond"];
  return (
    <div className="relative mt-3 h-16" data-testid="ceremony-pedestal">
      {/* Der Sockel liegt in einem zentrierten Halter; framer setzt nur das scaleY, nicht die Mitte. */}
      <div className="absolute left-1/2 -translate-x-1/2 bottom-1 w-72" aria-hidden="true">
        <motion.span className="tls-ceremony__pedestal" initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: reduced ? 0.2 : 0.6, delay: 0.3 }} />
      </div>
      <div className="absolute inset-x-0 bottom-8 flex justify-center gap-1.5">
        {ranks.map((rank, i) => (
          <motion.div key={rank} initial={{ opacity: 0.25, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduced ? 0 : 0.9 + i * 0.28, duration: 0.35 }}>
            <Badge material={ladder[i]} rank={rank} art={top?.art} icon={top?.icon} size="sm" animate={!reduced && i === 6} />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// Level-up: die alte Zahl bricht auf, die neue fällt ein; Titel alle fünf Level, Sterne bei Prestige.
function LevelUpStage({ levelUp, reduced }) {
  const level = Number(levelUp?.level || 1);
  const previous = Number(levelUp?.previous || level - 1);
  const [shown, setShown] = useState(reduced ? level : previous);
  useEffect(() => {
    if (reduced) { setShown(level); return undefined; }
    const timer = setTimeout(() => setShown(level), 900);
    return () => clearTimeout(timer);
  }, [level, reduced]);
  return (
    <div className="relative flex flex-col items-center justify-center h-full" data-testid="ceremony-levelup">
      <div className="relative h-24 flex items-center justify-center">
        <AnimatePresence mode="popLayout" initial={false}>
          {shown === previous && !reduced ? (
            <motion.div key="old" className="tls-ceremony__levelnum flex" exit={{ opacity: 0 }}>
              <motion.span initial={{ x: 0 }} exit={{ x: -40, rotate: -18, opacity: 0 }} transition={{ duration: 0.4 }}>{String(previous).slice(0, Math.ceil(String(previous).length / 2))}</motion.span>
              <motion.span initial={{ x: 0 }} exit={{ x: 40, rotate: 18, opacity: 0 }} transition={{ duration: 0.4 }}>{String(previous).slice(Math.ceil(String(previous).length / 2))}</motion.span>
            </motion.div>
          ) : (
            <motion.div key="new" className="tls-ceremony__levelnum" data-testid="ceremony-level-number" initial={reduced ? { opacity: 0 } : { y: -120, opacity: 0, scale: 1.3 }} animate={{ y: 0, opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 380, damping: 14 }}>
              {level}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {levelUp?.titleChanged && levelUp?.title && (
        <motion.div className="mt-2 px-4 py-1 border rounded-sm text-[11px] font-black uppercase tracking-[0.35em]" style={{ borderColor: "var(--cer-accent)", color: "var(--cer-accent)" }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduced ? 0 : 1.3 }} data-testid="ceremony-title-banner">
          Neuer Titel: {levelUp.title}
        </motion.div>
      )}
      {Number(levelUp?.prestige || 0) > 0 && levelUp?.prestigeGained && (
        <div className="mt-2 flex gap-1 text-[#FFD700]" data-testid="ceremony-prestige-stars" aria-label={`Prestige ${levelUp.prestige}`}>
          {Array.from({ length: Math.min(5, Number(levelUp.prestige)) }).map((_, i) => (
            <motion.span key={i} initial={{ y: -30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: reduced ? 0 : 1.4 + i * 0.12 }}><Star className="w-4 h-4 fill-current" /></motion.span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Ceremony({ plan, onClose, user = null, reduced = false, autoClose = true, sound = "auto" }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(() => (sound === "auto" ? readSoundPrefs(user).muted : sound === "off"));
  const tiers = plan.tiers;
  const current = tiers[index] || plan.top;
  const look = MATERIAL_LOOKS[plan.material] || MATERIAL_LOOKS.gold;
  const isStack = plan.sequence === "stack";
  const isLevelOnly = plan.sequence === "levelup";
  const [phase, setPhase] = useState(isLevelOnly ? "level" : "badge");
  const duration = reduced ? Math.min(plan.duration, 4500) : plan.duration;

  // Klang beim Öffnen, wie bisher einmal je Zeremonie - in der Admin-Vorschau fest an oder aus.
  useEffect(() => {
    if (sound === "off") return;
    playCeremonySound(plan.sound, { user, force: sound === "on" });
  }, [plan, user, sound]);

  // Automatisch schließen, außer die Maus liegt drauf; ein Level-up am Ende bekommt seine eigene Phase.
  useEffect(() => {
    if (!autoClose || paused) return undefined;
    const timer = setTimeout(() => {
      if (plan.levelUp && phase === "badge") setPhase("level");
      else onClose?.();
    }, phase === "level" && !isLevelOnly ? 6000 : duration);
    return () => clearTimeout(timer);
  }, [autoClose, paused, duration, onClose, plan.levelUp, phase, isLevelOnly]);

  // Stapel: alle 2,5 s weiter, bis alle durch sind.
  useEffect(() => {
    if (!isStack || paused || reduced) return undefined;
    if (index >= tiers.length - 1) return undefined;
    const timer = setTimeout(() => setIndex((i) => Math.min(tiers.length - 1, i + 1)), plan.autoAdvanceMs);
    return () => clearTimeout(timer);
  }, [isStack, paused, reduced, index, tiers.length, plan.autoAdvanceMs]);

  const cardRef = useModalBehavior(true, () => onClose?.());
  const toggleMute = useCallback((event) => {
    event.stopPropagation();
    const next = !muted;
    setMuted(next);
    writeSoundPrefs({ muted: next });
    if (!next) playCeremonySound(plan.sound, { user, force: true });
  }, [muted, plan.sound, user]);

  const heading = useMemo(() => {
    if (plan.heading) return plan.heading;
    if (isLevelOnly) return `Level ${plan.levelUp?.level} erreicht`;
    if (plan.sequence === "first") return "Dein erster Erfolg";
    if (plan.sequence === "group") return `${groupTier(plan)?.group_name || "Gruppe"} vollständig`;
    if (plan.sequence === "category") return "Kategorie abgeschlossen";
    if (plan.sequence === "legendary") return String(plan.top?.name || "Legendär").toUpperCase();
    if (plan.sequence === "diamond") return "Diamant";
    return tiers.length === 1 ? "Neues Achievement!" : `${tiers.length} neue Achievements!`;
  }, [plan, tiers.length, isLevelOnly]);
  const sub = plan.sub || (isLevelOnly ? "Level-Aufstieg" : plan.catchUp ? "Nachgeholte Erfolge" : `${look.name}${plan.top?.rank && plan.top.rank <= 7 ? ` ${ROMAN[plan.top.rank]}` : ""} freigeschaltet`);
  const liveText = `${heading}. ${tiers.map((t) => `${t.name}, ${t.material_name || look.name}, plus ${t.points} Punkte`).join(". ")}${plan.levelUp ? `. Level ${plan.levelUp.level}` : ""}`;
  const showBadge = phase === "badge" && !isLevelOnly;
  const shareTo = plan.shareId ? `/achievements/a/${encodeURIComponent(plan.shareId)}` : "/profile?tab=achievements";

  return (
    <motion.div
      className="tls-ceremony"
      style={{ "--cer-accent": plan.accent }}
      role="dialog"
      aria-modal="true"
      aria-label={heading}
      data-testid="achievement-unlock-overlay"
      data-sequence={plan.sequence}
      data-material={plan.material}
      data-motion={plan.motion}
      data-reduced={reduced ? "true" : undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <div className="tls-ceremony__backdrop" />
      {plan.sequence === "diamond" && !reduced && <span className="tls-ceremony__prism" data-testid="ceremony-prism" aria-hidden="true" />}
      {plan.sequence === "category" && !reduced && <span className="tls-ceremony__flood" data-testid="ceremony-flood" aria-hidden="true" />}
      {(plan.sequence === "diamond" || plan.sequence === "legendary" || plan.sequence === "category") && !reduced && <span className="tls-ceremony__flash" aria-hidden="true" />}
      {showBadge && <Particles plan={plan} reduced={reduced} />}
      <span className="tls-ceremony__live-text" aria-live="polite" data-testid="ceremony-live">{liveText}</span>

      <motion.div
        ref={cardRef}
        tabIndex={-1}
        className="tls-ceremony__card"
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        initial={reduced ? { opacity: 0 } : { scale: 0.8, y: 30, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 20 }}
      >
        {plan.sequence === "legendary" && (
          <motion.div className="tls-ceremony__banner" data-testid="ceremony-legendary-banner" initial={reduced ? { opacity: 0 } : { y: "-100%", rotateX: -60 }} animate={{ y: 0, rotateX: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 200, damping: 18, delay: 0.4 }}>
            Legendär
          </motion.div>
        )}
        <button type="button" onClick={toggleMute} data-testid="achievement-unlock-mute" className="absolute top-3 right-12 z-10 text-white/40 hover:text-white" aria-label={muted ? "Ton einschalten" : "Ton ausschalten"}>
          {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
        </button>
        <button type="button" onClick={onClose} data-testid="achievement-unlock-close" className="absolute top-3 right-3 z-10 text-white/40 hover:text-white" aria-label="Schließen">
          <X className="w-5 h-5" />
        </button>

        <div className={`tls-ceremony__stage ${plan.sequence === "legendary" ? "pt-10" : ""}`} data-testid="ceremony-stage" data-phase={phase}>
          {plan.sequence === "category" && <motion.span className="tls-ceremony__vitrine" data-testid="ceremony-vitrine" initial={{ scaleX: 1.15, opacity: 0 }} animate={{ scaleX: 1, opacity: 1 }} transition={{ duration: reduced ? 0.2 : 1.2, delay: 0.3 }} aria-hidden="true" />}
          {showBadge ? (
            <>
              {isStack && !reduced && tiers.slice(index + 1, index + 4).map((tier, i) => (
                <motion.div key={tier.code} className="absolute opacity-60" style={{ zIndex: 0 }} initial={{ x: 0, rotate: 0 }} animate={{ x: 70 + i * 34, y: 10 + i * 6, rotate: 8 + i * 6, scale: 0.72 - i * 0.08 }} transition={{ type: "spring", stiffness: 200, damping: 20 }} aria-hidden="true">
                  <Badge material={tier.material} level={tier.level} rank={tier.rank} art={tier.art} icon={tier.icon} size={130} />
                </motion.div>
              ))}
              <Motion key={`${plan.id}-${current?.code || index}`} motion={plan.motion} reduced={reduced} badge={<StageBadge tier={current} material={current?.material || plan.material} animate={!reduced} />} />
            </>
          ) : (
            <LevelUpStage levelUp={plan.levelUp || {}} reduced={reduced} />
          )}
        </div>

        <div className="relative px-6 pb-3 text-center">
          <motion.div className="text-[11px] font-bold uppercase tracking-[0.4em]" style={{ color: plan.accent, textShadow: `0 0 12px ${plan.accent}66` }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduced ? 0 : 0.5 }} data-testid="ceremony-sub">
            {phase === "level" && !isLevelOnly ? `Level ${plan.levelUp?.level} erreicht` : sub}
          </motion.div>
          <motion.h2 className="font-heading text-2xl md:text-3xl font-black uppercase mt-1" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduced ? 0 : 0.58 }} data-testid="ceremony-heading">
            {phase === "level" && !isLevelOnly ? (plan.levelUp?.title || "Aufstieg") : heading}
          </motion.h2>
          {plan.sequence === "first" && showBadge && (
            <motion.p className="mt-2 text-sm text-white/65 max-w-md mx-auto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: reduced ? 0 : 0.9 }} data-testid="ceremony-first-text">
              Das war dein erster Erfolg. Jeder Erfolg bringt Punkte und Erfahrung, hebt dein Level und schmückt dein Profil – alle Ziele und wie du sie schaffst stehen im Schaukasten.
            </motion.p>
          )}
          {plan.sequence === "group" && showBadge && <GroupPedestal plan={plan} reduced={reduced} />}
        </div>

        {showBadge && tiers.length > 0 && (
          <div className="relative px-5 pb-4 space-y-2 max-h-[34vh] overflow-y-auto" data-testid="ceremony-list">
            {tiers.map((tier, i) => <TierRow key={tier.code || i} tier={tier} material={tier.material || plan.material} index={i} active={isStack && i === index} onPick={isStack ? setIndex : null} />)}
          </div>
        )}

        <div className="relative px-5 pb-5 flex items-center justify-center gap-2 flex-wrap">
          {isStack && showBadge && (
            <div className="inline-flex items-center gap-1 mr-2" data-testid="ceremony-stack-nav">
              <button type="button" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0} aria-label="Vorheriger Erfolg" data-testid="ceremony-prev" className="w-8 h-8 inline-flex items-center justify-center border border-white/15 rounded-sm text-white/70 hover:text-white disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
              <span className="text-[10px] uppercase tracking-widest text-white/50 tabular-nums" data-testid="ceremony-stack-index">{index + 1} / {tiers.length}</span>
              <button type="button" onClick={() => setIndex((i) => Math.min(tiers.length - 1, i + 1))} disabled={index >= tiers.length - 1} aria-label="Nächster Erfolg" data-testid="ceremony-next" className="w-8 h-8 inline-flex items-center justify-center border border-white/15 rounded-sm text-white/70 hover:text-white disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
            </div>
          )}
          {plan.points > 0 && showBadge && (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-sm border text-xs font-black uppercase tracking-widest" style={{ color: plan.accent, borderColor: `${plan.accent}44`, backgroundColor: `${plan.accent}0d` }} data-testid="ceremony-points">
              <Trophy className="w-3.5 h-3.5" /> +{plan.points} Punkte
            </span>
          )}
          {plan.sequence === "first" && (
            <Link to="/achievements" onClick={onClose} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-sm border border-[#29B6E8]/50 text-[#29B6E8] text-xs font-bold uppercase tracking-widest hover:bg-[#29B6E8]/10" data-testid="ceremony-showcase-link">Zum Schaukasten</Link>
          )}
          {plan.sequence === "legendary" && (
            <Link to={shareTo} onClick={onClose} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-sm border border-[#FFD700]/60 text-[#FFD700] text-xs font-bold uppercase tracking-widest hover:bg-[#FFD700]/10" data-testid="ceremony-photo-mode"><Camera className="w-3.5 h-3.5" /> Fotomodus</Link>
          )}
          {phase === "level" && !isLevelOnly && null}
        </div>
      </motion.div>
    </motion.div>
  );
}
