import "./advent.css";

// Die Kerzenflamme der Saisonen (Adventkranz S6, Geburtstagstorte S13 #644): Schein, Glut am Docht und vier Schichten
// Flamme, die je Kerze eigen flackern; beim Anzünden fängt sie klein und zittrig, ein Streichholz leuchtet auf. Der Wind
// legt alle Flammen in dieselbe Richtung (`--season-wind`). Die Bewegung steht in advent.css.

/** Die Verläufe der Flamme - einmal je SVG, Kennungen aus `ids`. */
export function FlameDefs({ ids }) {
  return (
    <>
      <radialGradient id={`${ids}-flame`} cx="50%" cy="68%" r="60%">
        <stop offset="0" stopColor="#fff1c2" />
        <stop offset="0.55" stopColor="#ffb13b" />
        <stop offset="1" stopColor="#ff7a1a" stopOpacity="0.85" />
      </radialGradient>
      <radialGradient id={`${ids}-glow`} cx="50%" cy="50%" r="50%">
        <stop offset="0" stopColor="rgba(255, 184, 96, 0.55)" />
        <stop offset="0.6" stopColor="rgba(255, 170, 80, 0.16)" />
        <stop offset="1" stopColor="rgba(255, 160, 70, 0)" />
      </radialGradient>
      <radialGradient id={`${ids}-match`} cx="50%" cy="50%" r="50%">
        <stop offset="0" stopColor="rgba(255, 225, 160, 0.95)" />
        <stop offset="1" stopColor="rgba(255, 190, 110, 0)" />
      </radialGradient>
    </>
  );
}

/**
 * Eine Flamme über dem Docht: `x` und `top` (Oberkante des Wachses) in Einheiten des SVG. `look` trägt, wie diese Kerze
 * flackert (`flameDuration`, `flameDelay`, `flameAmp`, `glowDuration`, `wickGlow`). `lighting` = gerade angezündet,
 * `calm` = ruhige Phase danach.
 */
export function Flame({ x, top, ids, look, lighting = false, calm = false, testId = "advent-flame", matchTestId = "advent-match" }) {
  const fireClass = `tls-advent__fire${lighting ? " tls-advent__fire--lighting" : ""}${calm ? " tls-advent__fire--calm" : ""}`;
  return (
    <g className={fireClass} style={{ "--flame-dur": `${look.flameDuration}s`, "--flame-delay": `${look.flameDelay}s`, "--flame-amp": look.flameAmp, "--glow-dur": `${look.glowDuration}s`, "--wick-glow": look.wickGlow }} data-testid={testId}>
      <circle className="tls-advent__glow" cx={x} cy={top - 4.4} r="8.5" fill={`url(#${ids}-glow)`} />
      <circle className="tls-advent__ember" cx={x} cy={top - 1.6} r="0.55" fill="#ff9a3c" />
      <g className="tls-advent__flame" style={{ transformOrigin: `${x}px ${top - 1.4}px` }}>
        <ellipse cx={x} cy={top - 5} rx="1.9" ry="4.6" fill={`url(#${ids}-flame)`} />
        <ellipse cx={x} cy={top - 4.5} rx="1.15" ry="3.2" fill="#ffd27a" opacity="0.95" />
        <ellipse cx={x} cy={top - 3.8} rx="0.55" ry="1.8" fill="#fff8e6" />
        <ellipse cx={x} cy={top - 2.1} rx="0.95" ry="0.75" fill="#7fb2ff" opacity="0.55" />
      </g>
      {lighting && <circle className="tls-advent__match" cx={x} cy={top - 2} r="6" fill={`url(#${ids}-match)`} data-testid={matchTestId} />}
    </g>
  );
}
