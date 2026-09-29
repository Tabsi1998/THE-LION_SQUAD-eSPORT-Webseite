// Halloween-Kunst (#655, #658, #660–#664): alles SVG, Silber-Türkis zum Blau der Seite, nichts Grelles. Das Netz
// selbst lebt in web.js (Canvas mit Physik) - hier: die Spinne als Silhouette, Kürbisse und Laterne, der Mond mit
// echter Phase, eine Katze, kleine Grabsteine für den Fußzeilen-Strich, ein Geist als Schwade, Fledermäuse zum
// Hängen und Fliegen. Ein Hauch heller Rand macht Silhouetten auf Dunkel lesbar - ohne Filter.
import { illumination, litPath, moonPhase } from "./moon";

export const THREAD = "rgba(170, 225, 240, 0.72)";
export const THREAD_SOFT = "rgba(170, 225, 240, 0.42)";

/** Die Fäden eines Eck-Netzes als Liste - Anker, Strahlen, Spiralstücke - in der Reihenfolge, in der eine
 * Spinne sie spinnen würde. Aus `seed` (0–1) kommt die Unregelmäßigkeit. */

/** Der Endpunkt eines Fadens - dort sitzt die Spinne, während sie spinnt. */

/** Das Eck-Netz. `progress` (0–1) zeichnet nur die ersten Fäden - für den Netzbau. */

/** Eine Spinne: Körper mit Glanz, Kopf, acht Beine mit Gelenken, zwei Augen mit einem Hauch Türkis. */
export function Spider({ className = "", style, size = 20, thread = true, ...rest }) {
  // Die Spinne der ersten Fassung (#649): klein, dünne gebogene Beine, dunkler Körper - nur die Augen im Türkis der Saison.
  return (
    <svg className={`tls-spider ${className}`} style={style} width={size} height={size * 4} viewBox="0 0 20 80" aria-hidden="true" {...rest}>
      {thread && <line x1="10" y1="0" x2="10" y2="62" stroke={THREAD_SOFT} strokeWidth="0.7" />}
      <g className="tls-spider__body">
        <ellipse cx="10" cy="66" rx="4.5" ry="5.5" fill="#1a1520" />
        <circle cx="10" cy="60.5" r="2.6" fill="#1a1520" />
        {[-1, 1].map((side) => [0, 1, 2, 3].map((leg) => (
          <path key={`${side}-${leg}`} className="tls-spider__leg" style={{ animationDelay: `${leg * 0.11}s` }} d={`M ${10 + side * 3} ${63 + leg * 2} q ${side * 6} ${-4 + leg} ${side * 8} ${2 + leg * 1.5}`} stroke="#1a1520" strokeWidth="1.1" fill="none" strokeLinecap="round" />
        )))}
        <circle cx="8.6" cy="60" r="0.6" fill="#9be7ff" />
        <circle cx="11.4" cy="60" r="0.6" fill="#9be7ff" />
      </g>
    </svg>
  );
}

const FACES = {
  grin: (
    <>
      <path d="M13 22 l5 6 l-10 0 z M27 22 l-5 6 l10 0 z" fill="#ffd166" />
      <path d="M9 31 q11 9 22 0 l-2.5 3.5 l-3 -2.2 l-3 2.2 l-3 -2.2 l-3 2.2 l-3 -2.2 l-3 2.2 z" fill="#ffd166" />
    </>
  ),
  calm: (
    <>
      <path d="M12 23 q3 -3 6 0 q-3 3 -6 0 z M22 23 q3 -3 6 0 q-3 3 -6 0 z" fill="#ffd166" />
      <path d="M12 31 q8 6 16 0 q-8 3 -16 0 z" fill="#ffd166" />
    </>
  ),
  wicked: (
    <>
      <path d="M10 25 l8 -4 l-1 5 z M30 25 l-8 -4 l1 5 z" fill="#ffd166" />
      <path d="M11 31 q9 -2 18 0 q-3 5 -9 5 q-6 0 -9 -5 z M15 31 l2 3 l2 -3 z M21 31 l2 3 l2 -3 z" fill="#ffd166" />
    </>
  ),
};

/** Geschnitzter Kürbis mit Gesicht, Stiel, Blatt, Schattierung und warmem Schein - das einzige Warme im Bild. */
export function Pumpkin({ size = 48, face = "grin", slow = false, className = "" }) {
  return (
    <svg className={`tls-pumpkin ${slow ? "tls-pumpkin--slow" : ""} ${className}`} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M20 9 q-3 -6 3 -8 q-1 4 1 7" stroke="#3f6a22" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M22 6 q6 -4 9 1 q-5 0 -8 2 z" fill="#4f8a2c" />
      <ellipse cx="20" cy="24" rx="18" ry="14" fill="#e8620b" />
      <ellipse cx="9" cy="24" rx="6" ry="13" fill="#c9500a" opacity="0.9" />
      <ellipse cx="31" cy="24" rx="6" ry="13" fill="#c9500a" opacity="0.9" />
      <ellipse cx="20" cy="24" rx="7.5" ry="13.5" fill="#ff7f26" opacity="0.75" />
      <ellipse cx="20" cy="33" rx="14" ry="4" fill="rgba(0,0,0,0.22)" />
      <g className="tls-pumpkin__face">{FACES[face] || FACES.grin}</g>
      <ellipse cx="14" cy="15" rx="4" ry="1.8" fill="rgba(255,255,255,0.12)" />
    </svg>
  );
}

/** Die Laterne neben dem Löwen: Kürbis mit Deckel, aus dem beim Klick eine Fledermaus fliegt. */
export function Lantern({ open, face = "grin" }) {
  return (
    <svg width="42" height="42" viewBox="0 0 40 40" aria-hidden="true" className={`tls-pumpkin ${open ? "" : "tls-pumpkin--slow"}`}>
      <ellipse cx="20" cy="25" rx="17" ry="13" fill="#e8620b" />
      <ellipse cx="10.5" cy="25" rx="6" ry="12" fill="#c9500a" opacity="0.9" />
      <ellipse cx="29.5" cy="25" rx="6" ry="12" fill="#c9500a" opacity="0.9" />
      <ellipse cx="20" cy="25" rx="7" ry="12.5" fill="#ff7f26" opacity="0.75" />
      <g className="tls-pumpkin__face">{FACES[face] || FACES.grin}</g>
      <g className="tls-lantern__eyes" aria-hidden="true">
        <circle cx="13.5" cy="24.5" r="1.3" fill="#fff4d6" />
        <circle cx="26.5" cy="24.5" r="1.3" fill="#fff4d6" />
      </g>
      <g className="tls-lantern__lid">
        <path d="M8 14 q12 -7 24 0 q-12 3 -24 0 z" fill="#c9500a" />
        <path d="M20 12 q-3 -6 3 -8 q-1 4 1 7" stroke="#3f6a22" strokeWidth="3" fill="none" strokeLinecap="round" />
      </g>
      <g className="tls-lantern__bat">
        <path d="M20 16 q-5 -7 -9 -2 q3 0 4 3 q2 -2 5 0 q3 -2 5 0 q1 -3 4 -3 q-4 -5 -9 2 z" fill="#15111b" />
      </g>
    </svg>
  );
}

/** Ein einzelner Grabstein, schief, mit Gras - selten, in einer unteren Ecke. */

/** Sichelmond, klein und ruhig, mit einem Hauch Türkis - hinter dem Inhalt am oberen Rand. */

/** Schwarze Katze auf der Footer-Kante: sitzt, blinzelt ab und zu, der Schwanz schwingt langsam. */

export const RIM = "rgba(170, 225, 240, 0.26)";
/** Feiner Mondlicht-Saum für Figuren auf dunklem Grund (Fledermäuse an dunklen Kanten). */
export const RIM_EDGE = "rgba(170, 225, 240, 0.55)";
export const INK = "#0b0a0f";

/** Der Mond: echte Phase des Tages, warmweiß statt grau, feine Krater, dünner Schein - nichts Rechteckiges. */
export function Moon({ className = "", style, phase = moonPhase() }) {
  const lit = illumination(phase);
  return (
    <svg className={`tls-moon ${className}`} style={style} width="120" height="120" viewBox="0 0 120 120" aria-hidden="true" data-phase={phase.toFixed(2)}>
      <defs>
        <radialGradient id="tls-moon-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={`rgba(200, 235, 245, ${(0.05 + lit * 0.11).toFixed(2)})`} />
          <stop offset="0.55" stopColor={`rgba(200, 235, 245, ${(0.02 + lit * 0.04).toFixed(2)})`} />
          <stop offset="1" stopColor="rgba(200, 235, 245, 0)" />
        </radialGradient>
        <clipPath id="tls-moon-disc"><circle cx="60" cy="60" r="30" /></clipPath>
      </defs>
      <circle cx="60" cy="60" r="58" fill="url(#tls-moon-glow)" />
      <circle cx="60" cy="60" r="30" fill="rgba(241, 238, 230, 0.08)" />
      <path d={litPath(phase, 60, 60, 30)} fill="#f1eee6" opacity="0.92" />
      <g clipPath="url(#tls-moon-disc)" opacity="0.07">
        <circle cx="50" cy="50" r="6" fill="#1a2028" />
        <circle cx="69" cy="64" r="8" fill="#1a2028" />
        <circle cx="56" cy="74" r="4" fill="#1a2028" />
        <circle cx="72" cy="46" r="3" fill="#1a2028" />
      </g>
      <circle cx="60" cy="60" r="30" fill="none" stroke="rgba(170, 225, 240, 0.2)" strokeWidth="0.8" />
    </svg>
  );
}

/** Eine sitzende Katze von der Seite: Ohren, Rücken, aufgerollter Schwanz (wedelt), Augen blinzeln, der Kopf folgt dem Zeiger ein wenig. */
export function Cat({ className = "", style, size = 68 }) {
  const body = "M18 78 C 9 66, 12 48, 28 42 C 36 38, 50 38, 58 44 C 71 52, 71 68, 63 78 Z";
  const tail = "M60 76 C 79 74, 87 58, 75 46 C 70 42, 63 44, 65 50";
  return (
    <svg className={`tls-cat ${className}`} style={style} width={size} height={size * 0.9} viewBox="0 0 90 81" aria-hidden="true">
      <path className="tls-cat__tail" d={tail} stroke={RIM} strokeWidth="7.6" fill="none" strokeLinecap="round" />
      <path className="tls-cat__tail" d={tail} stroke={INK} strokeWidth="6" fill="none" strokeLinecap="round" />
      <path d={body} fill={RIM} transform="translate(0.6 -0.9)" />
      <path d={body} fill={INK} />
      <g className="tls-cat__head">
        <path d="M24 21 L20 4 L33 16 Z M44 21 L48 4 L35 16 Z" fill={RIM} transform="translate(0 -1)" />
        <circle cx="34" cy="30" r="13.8" fill={RIM} />
        <path d="M24 21 L20 4 L33 16 Z M44 21 L48 4 L35 16 Z" fill={INK} />
        <circle cx="34" cy="30" r="13" fill={INK} />
        <path d="M23 18 L21 9 L28 15 Z M45 18 L47 9 L40 15 Z" fill="rgba(170, 225, 240, 0.12)" />
        <g className="tls-cat__eyes">
          <ellipse cx="28" cy="30" rx="3.2" ry="2.6" fill="#9be7ff" />
          <ellipse cx="40" cy="30" rx="3.2" ry="2.6" fill="#9be7ff" />
          <g className="tls-cat__pupils">
            <ellipse cx="28" cy="30" rx="1" ry="2.3" fill={INK} />
            <ellipse cx="40" cy="30" rx="1" ry="2.3" fill={INK} />
          </g>
        </g>
        <path d="M12 33 l13 1 M12 37 l13 -1 M56 33 l-13 1 M56 37 l-13 -1" stroke="rgba(170, 225, 240, 0.3)" strokeWidth="0.7" />
      </g>
    </svg>
  );
}

/** Ein winziger Grabstein für den Strich über dem Impressum. */
export function MiniTombstone({ size = 20 }) {
  return (
    <svg width={size} height={size * 1.1} viewBox="0 0 20 22" aria-hidden="true">
      <path d="M3 22 v-13 q0 -7 7 -7 q7 0 7 7 v13 z" fill="rgba(170, 225, 240, 0.5)" transform="translate(0 -1)" />
      <path d="M3 22 v-13 q0 -7 7 -7 q7 0 7 7 v13 z" fill="#2a2734" />
      <path d="M6 11 h8 M7 14 h6" stroke="rgba(170, 225, 240, 0.5)" strokeWidth="0.9" />
      <path d="M0 22 h20" stroke="rgba(170, 225, 240, 0.4)" strokeWidth="0.8" />
    </svg>
  );
}

/** Ein Geist als Schwade: weich, durchscheinend, im Türkis der Seite, nur zwei blasse Augen. */
export function Ghost({ size = 40, className = "" }) {
  return (
    <svg className={`tls-ghost__shape ${className}`} width={size} height={size * 1.3} viewBox="0 0 40 52" aria-hidden="true">
      <defs>
        <linearGradient id="tls-ghost-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(190, 235, 245, 0.32)" />
          <stop offset="1" stopColor="rgba(190, 235, 245, 0.04)" />
        </linearGradient>
      </defs>
      <path d="M6 30 q0 -24 14 -24 q14 0 14 24 v16 q-3 -4 -7 0 q-3 -4 -7 0 q-3 -4 -7 0 q-4 -4 -7 0 z" fill="url(#tls-ghost-fill)" />
      <circle cx="15" cy="24" r="1.7" fill="rgba(0, 0, 0, 0.32)" />
      <circle cx="25" cy="24" r="1.7" fill="rgba(0, 0, 0, 0.32)" />
    </svg>
  );
}

/** Eine Fledermaus, die kopfüber hängt: Füße oben, Flügel angelegt, Kopf unten mit Ohren und Augen. */
export function HangingBatShape({ size = 26 }) {
  return (
    <svg className="tls-hbat__shape" width={size} height={size * 1.55} viewBox="0 0 40 62" aria-hidden="true">
      <path d="M18 0 l2 6 l2 -6" stroke={INK} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M13 12 q-9 12 -3 28 q3 -7 7 -3 z" fill={RIM} transform="translate(-0.6 0)" />
      <path d="M27 12 q9 12 3 28 q-3 -7 -7 -3 z" fill={RIM} transform="translate(0.6 0)" />
      <path className="tls-hbat__wing tls-hbat__wing--l" d="M13 12 q-9 12 -3 28 q3 -7 7 -3 z" fill={INK} stroke={RIM_EDGE} strokeWidth="0.8" strokeLinejoin="round" />
      <path className="tls-hbat__wing tls-hbat__wing--r" d="M27 12 q9 12 3 28 q-3 -7 -7 -3 z" fill={INK} stroke={RIM_EDGE} strokeWidth="0.8" strokeLinejoin="round" />
      <ellipse cx="20" cy="24" rx="6.5" ry="12" fill={INK} stroke={RIM_EDGE} strokeWidth="0.8" />
      <path d="M15 43 l-2.5 8 l6.5 -3.5 z M25 43 l2.5 8 l-6.5 -3.5 z" fill={INK} stroke={RIM_EDGE} strokeWidth="0.7" strokeLinejoin="round" />
      <circle cx="20" cy="40" r="5.6" fill={INK} stroke={RIM_EDGE} strokeWidth="0.8" />
      <circle cx="17.8" cy="40.5" r="1" fill="#bff3ff" />
      <circle cx="22.2" cy="40.5" r="1" fill="#bff3ff" />
    </svg>
  );
}

/** Dieselbe Fledermaus aufrecht auf einer Kante: Füße unten, Flügel angelegt, Kopf oben mit Ohren und Augen. */
export function SittingBatShape({ size = 22 }) {
  return (
    <svg className="tls-hbat__shape" width={size} height={size * 1.15} viewBox="0 0 40 46" aria-hidden="true">
      <path d="M12 20 q-9 10 -4 24 q3 -6 7 -3 z" fill={RIM} transform="translate(-0.6 0)" />
      <path d="M28 20 q9 10 4 24 q-3 -6 -7 -3 z" fill={RIM} transform="translate(0.6 0)" />
      <path className="tls-hbat__wing tls-hbat__wing--l" d="M12 20 q-9 10 -4 24 q3 -6 7 -3 z" fill={INK} stroke={RIM_EDGE} strokeWidth="0.8" strokeLinejoin="round" />
      <path className="tls-hbat__wing tls-hbat__wing--r" d="M28 20 q9 10 4 24 q-3 -6 -7 -3 z" fill={INK} stroke={RIM_EDGE} strokeWidth="0.8" strokeLinejoin="round" />
      <ellipse cx="20" cy="29" rx="6.5" ry="11" fill={INK} stroke={RIM_EDGE} strokeWidth="0.8" />
      <path d="M14 12 l-3 -9 l7 5 z M26 12 l3 -9 l-7 5 z" fill={INK} stroke={RIM_EDGE} strokeWidth="0.7" strokeLinejoin="round" />
      <circle cx="20" cy="14" r="5.8" fill={INK} stroke={RIM_EDGE} strokeWidth="0.8" />
      <circle cx="17.8" cy="13.5" r="1" fill="#bff3ff" />
      <circle cx="22.2" cy="13.5" r="1" fill="#bff3ff" />
      <path d="M16 41 l-2 4.5 M24 41 l2 4.5" stroke={INK} strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** Dieselbe Fledermaus im Flug: Flügel gespreizt, beide schlagen (CSS). */
export function FlyingBatShape({ size = 44 }) {
  return (
    <svg className="tls-hbat__shape" width={size} height={size * 0.55} viewBox="0 0 80 44" aria-hidden="true">
      <path className="tls-bat__wing tls-bat__wing--l" d="M40 24 q-9 -20 -36 -16 q10 3 12 14 q6 -5 12 1 q4 -3 12 1 z" fill={INK} stroke={RIM_EDGE} strokeWidth="0.8" strokeLinejoin="round" />
      <path className="tls-bat__wing tls-bat__wing--r" d="M40 24 q9 -20 36 -16 q-10 3 -12 14 q-6 -5 -12 1 q-4 -3 -12 1 z" fill={INK} stroke={RIM_EDGE} strokeWidth="0.8" strokeLinejoin="round" />
      <ellipse cx="40" cy="25" rx="4.5" ry="8.5" fill={INK} stroke={RIM_EDGE} strokeWidth="0.8" />
      <path d="M36 17 l-3 -6 l5 3 z M44 17 l3 -6 l-5 3 z" fill={INK} />
      <circle cx="38" cy="21" r="1.1" fill="#9be7ff" />
      <circle cx="42" cy="21" r="1.1" fill="#9be7ff" />
    </svg>
  );
}

/**
 * Dieselbe Katze im Gang: Seitenansicht, vier Beine mit Knie und Pfote, die im Trab diagonal gegeneinander schwingen
 * (vorne links mit hinten rechts), Schwanz hoch. Jedes Bein trägt denselben hellen Saum wie der Körper - sonst ist
 * es auf dem dunklen Grund unsichtbar (Rückmeldung 28.09.). Blickt nach links.
 */
export function CatWalking({ className = "", style, size = 68 }) {
  // x der Hüfte, Gruppe (a/b schwingen gegenläufig), Seite (hinten liegende Beine etwas dunkler und kürzer)
  const legs = [[31, "a", "far"], [38, "b", "near"], [53, "b", "far"], [60, "a", "near"]];
  return (
    <svg className={`tls-cat tls-cat-walking ${className}`} style={style} width={size} height={size * 0.9} viewBox="0 0 90 81" aria-hidden="true">
      <path className="tls-cat-walking__tail" d="M68 46 C 84 40, 88 24, 76 16 C 72 13, 66 16, 68 22" stroke={RIM} strokeWidth="7.4" fill="none" strokeLinecap="round" />
      <path className="tls-cat-walking__tail" d="M68 46 C 84 40, 88 24, 76 16 C 72 13, 66 16, 68 22" stroke={INK} strokeWidth="5.6" fill="none" strokeLinecap="round" />
      {legs.map(([x, group, depth]) => {
        const shank = depth === "far" ? 24 : 27;
        const leg = `M${x} 50 L${x - 1.5} ${50 + shank * 0.5} L${x + 1} ${50 + shank}`;
        return (
          <g key={x} className={`tls-cat-walking__leg tls-cat-walking__leg--${group} tls-cat-walking__leg--${depth}`} style={{ transformOrigin: `${x}px 50px` }}>
            <path d={leg} stroke={RIM} strokeWidth="8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <path d={leg} stroke={INK} strokeWidth="5.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <ellipse className="tls-cat-walking__paw" cx={x - 0.5} cy={50 + shank + 1} rx="4.4" ry="2.4" fill={RIM} />
            <ellipse cx={x - 0.5} cy={50 + shank + 0.6} rx="3.6" ry="1.9" fill={INK} />
          </g>
        );
      })}
      <ellipse cx="46" cy="46" rx="25.5" ry="12.8" fill={RIM} />
      <ellipse cx="46" cy="46" rx="24.5" ry="12" fill={INK} />
      <g className="tls-cat__head">
        <path d="M11 24 L8 8 L20 18 Z M28 24 L32 8 L22 18 Z" fill={RIM} transform="translate(0 -1)" />
        <circle cx="20" cy="32" r="12.6" fill={RIM} />
        <path d="M11 24 L8 8 L20 18 Z M28 24 L32 8 L22 18 Z" fill={INK} />
        <circle cx="20" cy="32" r="11.8" fill={INK} />
        <g className="tls-cat__eyes">
          <ellipse cx="15" cy="31" rx="2.8" ry="2.3" fill="#9be7ff" />
          <ellipse cx="25" cy="31" rx="2.8" ry="2.3" fill="#9be7ff" />
          <ellipse cx="15" cy="31" rx="0.9" ry="2" fill={INK} />
          <ellipse cx="25" cy="31" rx="0.9" ry="2" fill={INK} />
        </g>
        <path d="M2 33 l10 1 M2 37 l10 -1" stroke="rgba(170, 225, 240, 0.3)" strokeWidth="0.7" />
      </g>
    </svg>
  );
}
