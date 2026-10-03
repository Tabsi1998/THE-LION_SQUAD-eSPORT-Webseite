import { motion } from "framer-motion";
import { Badge } from "../Badge";

// Erfolge II (E8, #618): elf Bewegungen - wie das Abzeichen auf die Bühne kommt, je Kategorie eine.
// Jede Bewegung bekommt das Abzeichen (fertig gerendert) und den Akzent; sie zeichnet nur die Kulisse
// und die Bewegung drumherum. Bei reduzierter Bewegung rendert die Bühne nur das Abzeichen (fade).

const spring = { type: "spring", stiffness: 260, damping: 18 };

export function StageBadge({ tier, material, size = 160, animate = true }) {
  return <Badge material={material} rank={tier?.rank} level={tier?.level} art={tier?.art} icon={tier?.icon} size={size} animate={animate} title={tier?.name} testId="ceremony-badge" />;
}

// Spielen: Einschlag von oben mit Bodenwelle und Staub.
function Impact({ badge }) {
  return (
    <>
      <motion.div className="relative z-[2]" initial={{ y: -260, scale: 1.25, rotate: -8 }} animate={{ y: 0, scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 420, damping: 16, delay: 0.1 }}>
        {badge}
      </motion.div>
      <span className="tls-ceremony__wave" style={{ animationDelay: "0.38s" }} aria-hidden="true" />
      <span className="tls-ceremony__wave" style={{ animationDelay: "0.55s" }} aria-hidden="true" />
      {[-70, -40, 40, 70].map((x, i) => (
        <motion.span key={x} className="absolute bottom-[18%] left-1/2 w-3 h-3 rounded-full bg-white/25 blur-[2px]" initial={{ x: 0, y: 0, opacity: 0 }} animate={{ x, y: -12 - i * 4, opacity: [0, 0.8, 0] }} transition={{ duration: 0.8, delay: 0.4 + i * 0.03 }} aria-hidden="true" />
      ))}
    </>
  );
}

// Turnier: Pokalhebung - von unten hoch, kurz über die Mitte, dann setzen; Konfetti macht die Partikel-Ebene.
function Lift({ badge }) {
  return (
    <>
      <div className="tls-ceremony__beams" aria-hidden="true" />
      <motion.div className="relative z-[2]" initial={{ y: 200, scale: 0.6, opacity: 0 }} animate={{ y: [200, -26, 0], scale: [0.6, 1.08, 1], opacity: 1 }} transition={{ duration: 1.1, times: [0, 0.65, 1], ease: "easeOut", delay: 0.1 }}>
        {badge}
      </motion.div>
    </>
  );
}

// Fast Lap: Vorbeifahrt - von links mit Bremsspur und Geschwindigkeitslinien, dann Halt in der Mitte.
function Driveby({ badge }) {
  return (
    <>
      {[30, 46, 62].map((top, i) => (
        <motion.span key={top} className="tls-ceremony__speedline" style={{ top: `${top}%`, width: "40%" }} initial={{ x: "-120%", opacity: 0 }} animate={{ x: "160%", opacity: [0, 0.8, 0] }} transition={{ duration: 0.6, delay: 0.05 + i * 0.07 }} aria-hidden="true" />
      ))}
      <motion.span className="tls-ceremony__skid" initial={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: 1, opacity: 0.8 }} transition={{ duration: 0.4, delay: 0.35 }} style={{ transformOrigin: "left" }} aria-hidden="true" />
      <motion.div className="relative z-[2]" initial={{ x: -420, rotate: -6 }} animate={{ x: [-420, 30, 0], rotate: [-6, 3, 0] }} transition={{ duration: 0.75, times: [0, 0.75, 1], ease: "easeOut", delay: 0.1 }}>
        {badge}
      </motion.div>
    </>
  );
}

// Saison: Kalenderblätter, die sich umblättern, dann das Abzeichen.
function Flip({ badge }) {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <motion.span key={i} className="tls-ceremony__page" style={{ zIndex: 3 - i, marginLeft: i * 4, marginTop: i * 4 }} initial={{ rotateX: 0, opacity: 1 }} animate={{ rotateX: -180, opacity: 0 }} transition={{ duration: 0.55, delay: 0.15 + i * 0.28, ease: "easeIn" }} aria-hidden="true" />
      ))}
      <motion.div className="relative z-[2]" initial={{ scale: 0.4, opacity: 0, rotateX: 60 }} animate={{ scale: 1, opacity: 1, rotateX: 0 }} transition={{ ...spring, delay: 1.05 }}>
        {badge}
      </motion.div>
    </>
  );
}

// Team: zwei Hälften schieben sich zusammen, das Abzeichen wächst aus der Naht.
function Merge({ badge }) {
  return (
    <>
      <motion.span className="tls-ceremony__half tls-ceremony__half--left" style={{ left: "calc(50% - 5rem)" }} initial={{ x: -220, opacity: 0 }} animate={{ x: 0, opacity: [0, 1, 1, 0] }} transition={{ duration: 1.1, times: [0, 0.4, 0.8, 1] }} aria-hidden="true" />
      <motion.span className="tls-ceremony__half tls-ceremony__half--right" style={{ left: "50%" }} initial={{ x: 220, opacity: 0 }} animate={{ x: 0, opacity: [0, 1, 1, 0] }} transition={{ duration: 1.1, times: [0, 0.4, 0.8, 1] }} aria-hidden="true" />
      <motion.div className="relative z-[2]" initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...spring, delay: 0.75 }}>
        {badge}
      </motion.div>
    </>
  );
}

// Community: Sprechblasen sammeln sich von unten zum Abzeichen.
const BUBBLES = ["GG", "nice", "wp", "gl hf", "❤", "lol"];
function Bubbles({ badge }) {
  return (
    <>
      {BUBBLES.map((text, i) => (
        <motion.span key={text} className="tls-ceremony__bubble" style={{ left: `${12 + i * 14}%`, bottom: "8%" }} initial={{ y: 40, opacity: 0, scale: 0.7 }} animate={{ y: [-10 - i * 8, -90 - (i % 3) * 20], x: [0, (i - 2.5) * -18], opacity: [0, 1, 0], scale: [0.7, 1, 0.5] }} transition={{ duration: 1.1, delay: 0.05 + i * 0.1 }} aria-hidden="true">{text}</motion.span>
      ))}
      <motion.div className="relative z-[2]" initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...spring, delay: 0.85 }}>
        {badge}
      </motion.div>
    </>
  );
}

// Streaming: „LIVE“-Schild und Scanlines, das Abzeichen schaltet sich wie ein Bild auf.
function Live({ badge }) {
  return (
    <>
      <span className="tls-ceremony__scanlines" aria-hidden="true" />
      <span className="tls-ceremony__live" aria-hidden="true">LIVE</span>
      <motion.div className="relative z-[2]" initial={{ opacity: 0, scaleY: 0.02, scaleX: 1.4 }} animate={{ opacity: 1, scaleY: 1, scaleX: 1 }} transition={{ duration: 0.5, delay: 0.3, ease: "easeOut" }}>
        {badge}
      </motion.div>
    </>
  );
}

// Profil: eine Karte zeichnet sich, die Zeilen füllen sich, das Abzeichen rutscht in den Avatar-Platz.
function Card({ badge }) {
  return (
    <>
      <motion.span className="tls-ceremony__cardframe" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4 }} aria-hidden="true" />
      {[38, 50, 62].map((top, i) => (
        <motion.span key={top} className="tls-ceremony__cardline" style={{ top: `${top}%`, width: `${7 - i * 1.5}rem`, left: "calc(50% + 0.5rem)" }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.35, delay: 0.45 + i * 0.15 }} aria-hidden="true" />
      ))}
      <motion.div className="relative z-[2]" style={{ marginRight: "7rem" }} initial={{ x: -120, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ ...spring, delay: 0.3 }}>
        {badge}
      </motion.div>
    </>
  );
}

// Verein: Fahne mit Löwenwappen schwingt von oben herein, das Abzeichen sitzt darauf.
function Banner({ badge }) {
  return (
    <motion.div className="absolute top-0 left-0 right-0 flex justify-center" initial={{ rotateX: -95, opacity: 0 }} animate={{ rotateX: [-95, 12, -6, 0], opacity: 1 }} transition={{ duration: 1.1, times: [0, 0.5, 0.8, 1], ease: "easeOut" }} style={{ transformOrigin: "top center", perspective: 800 }}>
      <div className="relative">
        <span className="tls-ceremony__flag" data-testid="ceremony-flag" aria-hidden="true" />
        <div className="relative z-[2] pt-6 flex justify-center">{badge}</div>
      </div>
    </motion.div>
  );
}

// Besonders: Vorhang und Scheinwerfer.
function Curtain({ badge }) {
  return (
    <>
      <span className="tls-ceremony__spot" aria-hidden="true" />
      <motion.div className="relative z-[1]" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...spring, delay: 0.6 }}>
        {badge}
      </motion.div>
      <motion.span className="tls-ceremony__curtain tls-ceremony__curtain--left z-[3]" initial={{ scaleX: 1 }} animate={{ scaleX: 0.04 }} transition={{ duration: 0.9, delay: 0.25, ease: "easeInOut" }} aria-hidden="true" />
      <motion.span className="tls-ceremony__curtain tls-ceremony__curtain--right z-[3]" initial={{ scaleX: 1 }} animate={{ scaleX: 0.04 }} transition={{ duration: 0.9, delay: 0.25, ease: "easeInOut" }} aria-hidden="true" />
    </>
  );
}

// Geheim: Enthüllung aus Rauch, das Fragezeichen dreht sich weg.
function Smoke({ badge }) {
  return (
    <>
      {[[-70, 10, 120], [40, -20, 150], [-10, 30, 170], [70, 20, 110]].map(([x, y, size], i) => (
        <motion.span key={i} className="tls-ceremony__smoke" style={{ width: size, height: size, left: `calc(50% + ${x}px - ${size / 2}px)`, top: `calc(50% + ${y}px - ${size / 2}px)` }} initial={{ opacity: 0.9, scale: 0.6 }} animate={{ opacity: 0, scale: 1.9, x: (i - 1.5) * 40, y: -60 }} transition={{ duration: 1.6, delay: 0.2 + i * 0.1, ease: "easeOut" }} aria-hidden="true" />
      ))}
      <motion.span className="absolute z-[2] font-heading font-black text-6xl text-[#c084fc]" initial={{ opacity: 1, rotateY: 0 }} animate={{ opacity: 0, rotateY: 90 }} transition={{ duration: 0.6, delay: 0.5 }} aria-hidden="true">?</motion.span>
      <motion.div className="relative z-[1]" initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.9, delay: 0.8 }}>
        {badge}
      </motion.div>
    </>
  );
}

export const MOTION_COMPONENTS = { impact: Impact, lift: Lift, driveby: Driveby, flip: Flip, merge: Merge, bubbles: Bubbles, live: Live, card: Card, banner: Banner, curtain: Curtain, smoke: Smoke };

export function Motion({ motion: key, badge, reduced = false }) {
  if (reduced) {
    return <motion.div className="relative z-[2]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>{badge}</motion.div>;
  }
  const Component = MOTION_COMPONENTS[key] || Impact;
  return <Component badge={badge} />;
}
