// Halloween-Kunst (#655, #658): ein Eck-Netz wie ein echtes - Ankerfäden bis zum Rand, unregelmäßige
// Strahlen, eine durchgehende Spirale mit Durchhang, Tautropfen; eine Spinne mit Gelenken; geschnitzte
// Kürbisse; ein einzelner Grabstein; ein Sichelmond. Fäden in Silber-Türkis, passend zum Blau der Seite.
// Alles SVG, nichts Kindliches, nichts Grelles.
import { illumination, litPath, moonPhase } from "./moon";

export const THREAD = "rgba(170, 225, 240, 0.72)";
export const THREAD_SOFT = "rgba(170, 225, 240, 0.42)";

/** Die Fäden eines Eck-Netzes als Liste - Anker, Strahlen, Spiralstücke - in der Reihenfolge, in der eine
 * Spinne sie spinnen würde. Aus `seed` (0–1) kommt die Unregelmäßigkeit. */
export function webSegments(seed = 0.37) {
  const wobble = (i) => Math.sin(seed * 97 + i * 7.3) * 0.5 + Math.cos(seed * 31 + i * 3.1) * 0.5;
  const rays = [0, 12, 24, 36, 48, 60, 72, 84, 90].map((angle, i) => angle + (i === 0 || i === 8 ? 0 : wobble(i) * 4));
  const segments = [];
  // Ankerfäden: an den Rändern entlang und ein langer Diagonalfaden, an dem alles hängt.
  segments.push({ kind: "anchor", d: "M 0 0 L 240 0" });
  segments.push({ kind: "anchor", d: "M 0 0 L 0 240" });
  segments.push({ kind: "anchor", d: `M 0 0 L ${(Math.cos(0.8) * 200).toFixed(1)} ${(Math.sin(0.8) * 200).toFixed(1)}` });
  rays.forEach((angle, i) => {
    const rad = (angle * Math.PI) / 180;
    const length = 118 + wobble(i + 20) * 10;
    segments.push({ kind: "ray", d: `M 0 0 L ${(Math.cos(rad) * length).toFixed(1)} ${(Math.sin(rad) * length).toFixed(1)}`, angle: rad, length });
  });
  // Spirale: von innen nach außen, jedes Stück von Strahl zu Strahl mit leichtem Durchhang.
  const turns = [14, 24, 34, 44, 54, 64, 74, 84, 94, 104];
  turns.forEach((base, t) => {
    for (let i = 0; i < rays.length - 1; i += 1) {
      const a1 = (rays[i] * Math.PI) / 180;
      const a2 = (rays[i + 1] * Math.PI) / 180;
      const r1 = base + (i / (rays.length - 1)) * 10 + wobble(t * 9 + i) * 1.5;
      const r2 = base + ((i + 1) / (rays.length - 1)) * 10 + wobble(t * 9 + i + 1) * 1.5;
      const mid = (a1 + a2) / 2;
      const sag = ((r1 + r2) / 2) * 0.93;
      const gap = t >= 4 && wobble(t * 13 + i) > 0.82;
      segments.push({ kind: "spiral", turn: t, gap, d: `M ${(Math.cos(a1) * r1).toFixed(1)} ${(Math.sin(a1) * r1).toFixed(1)} Q ${(Math.cos(mid) * sag).toFixed(1)} ${(Math.sin(mid) * sag).toFixed(1)} ${(Math.cos(a2) * r2).toFixed(1)} ${(Math.sin(a2) * r2).toFixed(1)}`,
        end: { x: Math.cos(a2) * r2, y: Math.sin(a2) * r2 } });
    }
  });
  return segments;
}

/** Der Endpunkt eines Fadens - dort sitzt die Spinne, während sie spinnt. */
export function segmentEnd(segment) {
  if (segment.end) return segment.end;
  const match = /L ([-\d.]+) ([-\d.]+)$/.exec(segment.d);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : { x: 0, y: 0 };
}

/** Das Eck-Netz. `progress` (0–1) zeichnet nur die ersten Fäden - für den Netzbau. */
export function Cobweb({ className = "", style, seed = 0.37, progress = 1, dew = true }) {
  const segments = webSegments(seed);
  const shown = Math.round(segments.length * Math.max(0, Math.min(1, progress)));
  return (
    <svg className={`tls-cobweb ${className}`} style={style} viewBox="0 0 240 240" fill="none" aria-hidden="true">
      <g strokeLinecap="round">
        {segments.slice(0, shown).map((segment, index) => (
          <path key={index} d={segment.d} stroke={segment.kind === "spiral" ? THREAD : THREAD_SOFT} strokeWidth={segment.kind === "anchor" ? 0.9 : segment.kind === "ray" ? 0.7 : 0.55} strokeDasharray={segment.gap ? "6 4" : undefined} opacity={segment.gap ? 0.55 : 1} />
        ))}
      </g>
      {dew && progress >= 1 && [[36, 22], [63, 47], [22, 70], [88, 40], [54, 86], [110, 18]].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" fill="rgba(200, 240, 255, 0.95)" className="tls-dew" />
      ))}
    </svg>
  );
}

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
export function Tombstone({ className = "", style, size = 74 }) {
  return (
    <svg className={`tls-tombstone ${className}`} style={style} width={size} height={size * 1.1} viewBox="0 0 70 78" aria-hidden="true">
      <path d="M12 74 v-44 q0 -20 23 -20 q23 0 23 20 v44 z" fill="#14121a" />
      <path d="M17 70 v-40 q0 -15 18 -15 q18 0 18 15 v40 z" fill="#1b1823" />
      <text x="35" y="44" fontSize="11" textAnchor="middle" fill="rgba(170,225,240,0.35)" fontFamily="serif" letterSpacing="1">RIP</text>
      <path d="M22 54 h26 M25 60 h20" stroke="rgba(170,225,240,0.18)" strokeWidth="1" />
      <path d="M4 76 q6 -9 9 0 M18 76 q4 -12 8 0 M46 76 q5 -8 8 0 M58 76 q6 -10 9 0" stroke="#1f2a24" strokeWidth="2" fill="none" strokeLinecap="round" />
      <ellipse cx="35" cy="76" rx="33" ry="3" fill="rgba(0,0,0,0.5)" />
    </svg>
  );
}

/** Sichelmond, klein und ruhig, mit einem Hauch Türkis - hinter dem Inhalt am oberen Rand. */
export function Moon({ className = "", style, phase = moonPhase() }) {
  // Echte Mondphase des Tages, ein Hauch Erdschein auf der dunklen Seite, zwei Mare - kein Strahlenkranz.
  const lit = illumination(phase);
  return (
    <svg className={`tls-moon ${className}`} style={style} width="150" height="150" viewBox="0 0 150 150" aria-hidden="true" data-phase={phase.toFixed(2)}>
      <defs>
        <radialGradient id="tls-moon-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={`rgba(170, 225, 240, ${(0.06 + lit * 0.16).toFixed(2)})`} />
          <stop offset="1" stopColor="rgba(170, 225, 240, 0)" />
        </radialGradient>
        <clipPath id="tls-moon-disc"><circle cx="75" cy="75" r="36" /></clipPath>
      </defs>
      <circle cx="75" cy="75" r="74" fill="url(#tls-moon-glow)" />
      <circle cx="75" cy="75" r="36" fill="rgba(233, 238, 242, 0.09)" />
      <path d={litPath(phase, 75, 75, 36)} fill="#e6ecf0" opacity="0.88" />
      <g clipPath="url(#tls-moon-disc)" opacity="0.1">
        <circle cx="64" cy="62" r="7" fill="#1a2028" />
        <circle cx="86" cy="80" r="10" fill="#1a2028" />
        <circle cx="70" cy="92" r="5" fill="#1a2028" />
      </g>
    </svg>
  );
}


/** Schwarze Katze auf der Footer-Kante: sitzt, blinzelt ab und zu, der Schwanz schwingt langsam. */
export function Cat({ className = "", style, size = 64 }) {
  return (
    <svg className={`tls-cat ${className}`} style={style} width={size} height={size * 1.15} viewBox="0 0 64 74" aria-hidden="true">
      <path className="tls-cat__tail" d="M46 66 q16 -4 14 -22 q-1 -9 -8 -8" stroke="#0e0c12" strokeWidth="6" fill="none" strokeLinecap="round" />
      <path d="M14 72 q-4 -30 14 -40 q10 -6 20 0 q16 10 12 40 z" fill="#0e0c12" />
      <path d="M20 34 l-4 -16 l12 8 z M44 34 l4 -16 l-12 8 z" fill="#0e0c12" />
      <ellipse cx="32" cy="34" rx="13" ry="12" fill="#0e0c12" />
      <g className="tls-cat__eyes">
        <ellipse cx="26" cy="33" rx="3" ry="2.4" fill="#9be7ff" />
        <ellipse cx="38" cy="33" rx="3" ry="2.4" fill="#9be7ff" />
        <ellipse cx="26" cy="33" rx="0.9" ry="2.2" fill="#0e0c12" />
        <ellipse cx="38" cy="33" rx="0.9" ry="2.2" fill="#0e0c12" />
      </g>
      <path d="M8 36 l14 1 M8 40 l14 -1 M56 36 l-14 1 M56 40 l-14 -1" stroke="rgba(170,225,240,0.35)" strokeWidth="0.7" />
    </svg>
  );
}
