// Halloween-Kunst (#635, #655): Spinnweben mit Spiralfäden und Tautropfen, Spinnen mit Beinen und Augen,
// geschnitzte Kürbisse in drei Gesichtern, Laternen, Geist, Mond, Zaun mit Grabsteinen - alles SVG,
// keine Bilder, alles skaliert sauber bis zum Breitbild.

const WEB_RAYS = [0, 11, 22, 34, 46, 58, 70, 80, 90];
const WEB_RINGS = [14, 26, 38, 50, 62, 74, 86, 98, 110];

function webRingPath(radius) {
  return WEB_RAYS.slice(0, -1).map((angle, index) => {
    const a1 = (angle * Math.PI) / 180;
    const a2 = (WEB_RAYS[index + 1] * Math.PI) / 180;
    const mid = (a1 + a2) / 2;
    const sag = radius * 0.9;
    return `${index === 0 ? "M" : "L"} ${(Math.cos(a1) * radius).toFixed(1)} ${(Math.sin(a1) * radius).toFixed(1)} Q ${(Math.cos(mid) * sag).toFixed(1)} ${(Math.sin(mid) * sag).toFixed(1)} ${(Math.cos(a2) * radius).toFixed(1)} ${(Math.sin(a2) * radius).toFixed(1)}`;
  }).join(" ");
}

/** Spinnweb in einer Ecke: Strahlen, Ringe mit Durchhang, ein paar gerissene Fäden und Tautropfen. */
export function Cobweb({ className = "", style, dew = true, torn = [] }) {
  return (
    <svg className={`tls-cobweb ${className}`} style={style} viewBox="0 0 120 120" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="tls-web-thread" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgba(255,255,255,0.95)" />
          <stop offset="1" stopColor="rgba(255,255,255,0.55)" />
        </linearGradient>
      </defs>
      <g stroke="url(#tls-web-thread)" strokeWidth="0.75" strokeLinecap="round">
        {WEB_RAYS.map((angle) => {
          const rad = (angle * Math.PI) / 180;
          return <line key={angle} x1="0" y1="0" x2={(Math.cos(rad) * 118).toFixed(1)} y2={(Math.sin(rad) * 118).toFixed(1)} />;
        })}
        {WEB_RINGS.map((radius, index) => (
          <path key={radius} d={webRingPath(radius)} strokeWidth={index % 3 === 2 ? "0.9" : "0.6"} strokeDasharray={torn.includes(index) ? "22 6" : undefined} />
        ))}
        <path d="M 40 8 q 6 10 2 22" strokeWidth="0.5" opacity="0.7" />
        <path d="M 8 52 q 12 -4 24 4" strokeWidth="0.5" opacity="0.7" />
      </g>
      {dew && [[38, 21], [61, 44], [23, 66], [80, 38], [52, 79]].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" fill="rgba(255,255,255,0.9)" className="tls-dew" />
      ))}
    </svg>
  );
}

/** Eine Spinne am Faden: Körper, Kopf, acht Beine, orange Augen - seilt sich per CSS ab. */
export function Spider({ className = "", style, size = 44, ...rest }) {
  return (
    <svg className={`tls-spider ${className}`} style={style} width={size} height={size * 2.4} viewBox="0 0 40 96" aria-hidden="true" {...rest}>
      <line x1="20" y1="0" x2="20" y2="62" stroke="rgba(255,255,255,0.55)" strokeWidth="0.9" />
      <g className="tls-spider__body">
        <ellipse cx="20" cy="76" rx="9" ry="12" fill="#17121d" />
        <ellipse cx="20" cy="76" rx="6" ry="8" fill="#241a2c" />
        <circle cx="20" cy="62" r="5.5" fill="#17121d" />
        <path d="M18 60 l4 0" stroke="#3a2b45" strokeWidth="1" />
        {[-1, 1].map((side) => [0, 1, 2, 3].map((leg) => (
          <path key={`${side}-${leg}`} className="tls-spider__leg" style={{ animationDelay: `${leg * 0.13}s` }} d={`M ${20 + side * 6} ${64 + leg * 4} q ${side * 12} ${-8 + leg * 2} ${side * 17} ${3 + leg * 3.5} q ${side * 2} ${5} ${side * 6} ${11}`} stroke="#17121d" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        )))}
        <circle cx="17.5" cy="61" r="1.2" fill="#ff9a3c" />
        <circle cx="22.5" cy="61" r="1.2" fill="#ff9a3c" />
        <circle cx="17.5" cy="61" r="0.4" fill="#fff5d0" />
        <circle cx="22.5" cy="61" r="0.4" fill="#fff5d0" />
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
  scared: (
    <>
      <circle cx="14" cy="24" r="3.4" fill="#ffd166" />
      <circle cx="26" cy="24" r="3.4" fill="#ffd166" />
      <ellipse cx="20" cy="33" rx="3" ry="4.2" fill="#ffd166" />
    </>
  ),
  wicked: (
    <>
      <path d="M10 25 l8 -4 l-1 5 z M30 25 l-8 -4 l1 5 z" fill="#ffd166" />
      <path d="M11 31 q9 -2 18 0 q-3 5 -9 5 q-6 0 -9 -5 z M15 31 l2 3 l2 -3 z M21 31 l2 3 l2 -3 z" fill="#ffd166" />
    </>
  ),
};

/** Geschnitzter Kürbis mit Gesicht, Stiel, Blatt und Schein. */
export function Pumpkin({ size = 48, face = "grin", slow = false, className = "" }) {
  return (
    <svg className={`tls-pumpkin ${slow ? "tls-pumpkin--slow" : ""} ${className}`} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M20 9 q-3 -6 3 -8 q-1 4 1 7" stroke="#4d7c2a" strokeWidth="3.2" fill="none" strokeLinecap="round" />
      <path d="M22 6 q6 -4 9 1 q-5 0 -8 2 z" fill="#5e9a34" />
      <ellipse cx="20" cy="24" rx="18" ry="14" fill="#ff7a1a" />
      <ellipse cx="9" cy="24" rx="6" ry="13" fill="#e8620b" opacity="0.85" />
      <ellipse cx="31" cy="24" rx="6" ry="13" fill="#e8620b" opacity="0.85" />
      <ellipse cx="20" cy="24" rx="7.5" ry="13.5" fill="#ff8b31" opacity="0.7" />
      <g className="tls-pumpkin__face">{FACES[face] || FACES.grin}</g>
      <ellipse cx="14" cy="16" rx="4" ry="2" fill="rgba(255,255,255,0.12)" />
    </svg>
  );
}

/** Die Laterne neben dem Löwen: großer Kürbis mit Deckel, aus dem beim Klick eine Fledermaus fliegt. */
export function Lantern({ open, face = "grin" }) {
  return (
    <svg width="44" height="44" viewBox="0 0 40 40" aria-hidden="true" className={`tls-pumpkin ${open ? "" : "tls-pumpkin--slow"}`}>
      <ellipse cx="20" cy="25" rx="17" ry="13" fill="#ff7a1a" />
      <ellipse cx="10.5" cy="25" rx="6" ry="12" fill="#e8620b" opacity="0.85" />
      <ellipse cx="29.5" cy="25" rx="6" ry="12" fill="#e8620b" opacity="0.85" />
      <ellipse cx="20" cy="25" rx="7" ry="12.5" fill="#ff8b31" opacity="0.7" />
      <g className="tls-pumpkin__face">{FACES[face] || FACES.grin}</g>
      <g className="tls-lantern__lid">
        <path d="M8 14 q12 -7 24 0 q-12 3 -24 0 z" fill="#e8640a" />
        <path d="M20 12 q-3 -6 3 -8 q-1 4 1 7" stroke="#4d7c2a" strokeWidth="3.2" fill="none" strokeLinecap="round" />
      </g>
      <g className="tls-lantern__bat">
        <path d="M20 16 q-5 -7 -9 -2 q3 0 4 3 q2 -2 5 0 q3 -2 5 0 q1 -3 4 -3 q-4 -5 -9 2 z" fill="#17121d" />
        <circle cx="18.5" cy="16" r="0.6" fill="#ff9a3c" />
        <circle cx="21.5" cy="16" r="0.6" fill="#ff9a3c" />
      </g>
    </svg>
  );
}

/** Eine Fledermaus als SVG (hängend oder flatternd) mit hellem Rand, damit sie auf Dunkel zu sehen ist. */
export function BatShape({ size = 40, className = "", style }) {
  return (
    <svg className={className} style={style} width={size} height={size * 0.55} viewBox="0 0 80 44" aria-hidden="true">
      <path className="tls-bat__wings" d="M40 24 q-9 -20 -36 -16 q10 3 12 14 q6 -5 12 1 q4 -3 12 1 q8 -4 12 -1 q6 -6 12 -1 q2 -11 12 -14 q-27 -4 -36 16 z" fill="#17121d" stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" strokeLinejoin="round" />
      <ellipse cx="40" cy="25" rx="5" ry="9" fill="#241a2c" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
      <path d="M36 17 l-3 -6 l5 3 z M44 17 l3 -6 l-5 3 z" fill="#241a2c" />
      <circle cx="38" cy="21" r="1.3" fill="#ff9a3c" />
      <circle cx="42" cy="21" r="1.3" fill="#ff9a3c" />
    </svg>
  );
}

/** Geisterlaterne oder Kürbislaterne an der Lichterkette. */
export function StringLantern({ kind = "pumpkin", className = "", style }) {
  return (
    <svg className={`tls-string-lantern ${className}`} style={style} width="34" height="52" viewBox="0 0 34 52" aria-hidden="true">
      <line x1="17" y1="0" x2="17" y2="12" stroke="rgba(255,255,255,0.45)" strokeWidth="1" />
      {kind === "ghost" ? (
        <g>
          <path d="M6 30 q0 -18 11 -18 q11 0 11 18 v16 l-4 -4 l-3.5 4 l-3.5 -4 l-3.5 4 l-3.5 -4 l-4 4 z" fill="rgba(240,240,255,0.92)" />
          <circle cx="13" cy="26" r="2" fill="#17121d" />
          <circle cx="21" cy="26" r="2" fill="#17121d" />
          <ellipse cx="17" cy="33" rx="2" ry="3" fill="#17121d" />
        </g>
      ) : (
        <g className="tls-pumpkin tls-pumpkin--slow">
          <ellipse cx="17" cy="30" rx="13" ry="11" fill="#ff7a1a" />
          <ellipse cx="9" cy="30" rx="4.5" ry="10" fill="#e8620b" opacity="0.85" />
          <ellipse cx="25" cy="30" rx="4.5" ry="10" fill="#e8620b" opacity="0.85" />
          <path d="M12 27 l3 4 l-6 0 z M22 27 l-3 4 l6 0 z M10 34 q7 5 14 0 l-1.5 2.5 l-2.5 -1.5 l-2.5 1.5 l-2.5 -1.5 l-2.5 1.5 z" fill="#ffd166" />
          <path d="M17 19 q-2 -4 2 -6" stroke="#4d7c2a" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        </g>
      )}
    </svg>
  );
}

/** Ein treibender Geist - selten, nur bei „voll“. */
export function Ghost({ size = 80, className = "", style }) {
  return (
    <svg className={`tls-ghost ${className}`} style={style} width={size} height={size * 1.3} viewBox="0 0 60 78" aria-hidden="true">
      <path d="M8 42 q0 -34 22 -34 q22 0 22 34 v30 l-7 -6 l-7.5 6 l-7.5 -6 l-7.5 6 l-7.5 -6 l-7 6 z" fill="rgba(235,235,255,0.85)" />
      <circle cx="22" cy="34" r="3.5" fill="#17121d" />
      <circle cx="38" cy="34" r="3.5" fill="#17121d" />
      <ellipse cx="30" cy="46" rx="4" ry="6" fill="#17121d" />
    </svg>
  );
}

/** Sichelmond mit Schein und zwei Wolken - hinter dem Inhalt. */
export function Moon({ className = "", style }) {
  return (
    <svg className={`tls-moon ${className}`} style={style} width="220" height="160" viewBox="0 0 220 160" aria-hidden="true">
      <defs>
        <radialGradient id="tls-moon-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="rgba(255,222,150,0.35)" />
          <stop offset="1" stopColor="rgba(255,222,150,0)" />
        </radialGradient>
      </defs>
      <circle cx="90" cy="70" r="70" fill="url(#tls-moon-glow)" />
      <path d="M90 22 a48 48 0 1 0 0 96 a38 38 0 1 1 0 -96 z" fill="#f4dfa3" />
      <circle cx="78" cy="52" r="4" fill="rgba(0,0,0,0.08)" />
      <circle cx="70" cy="80" r="6" fill="rgba(0,0,0,0.07)" />
      <g className="tls-cloud" fill="rgba(60,60,80,0.75)">
        <ellipse cx="150" cy="96" rx="34" ry="12" />
        <ellipse cx="132" cy="90" rx="18" ry="11" />
        <ellipse cx="168" cy="90" rx="16" ry="10" />
      </g>
      <g className="tls-cloud tls-cloud--slow" fill="rgba(60,60,80,0.6)">
        <ellipse cx="60" cy="122" rx="30" ry="10" />
        <ellipse cx="46" cy="116" rx="16" ry="9" />
      </g>
    </svg>
  );
}

/** Zaun mit Grabsteinen und kahlem Baum als Silhouette für die unteren Ecken am Breitbild. */
export function Graveyard({ mirrored = false, className = "", style }) {
  return (
    <svg className={`tls-graveyard ${className}`} style={{ ...style, transform: mirrored ? "scaleX(-1)" : undefined }} viewBox="0 0 320 160" aria-hidden="true">
      <path d="M0 160 v-22 q40 -10 80 -4 q40 6 80 -2 q40 -8 80 2 q40 10 80 4 v22 z" fill="#0b0810" />
      <g fill="#100c15">
        <path d="M22 138 v-34 q0 -12 12 -12 q12 0 12 12 v34 z" />
        <path d="M70 140 v-26 q0 -9 9 -9 q9 0 9 9 v26 z" />
        <path d="M118 139 v-30 h30 v30 z" />
      </g>
      <g stroke="#1a1422" strokeWidth="3" strokeLinecap="round">
        {[170, 190, 210, 230, 250, 270].map((x, i) => <line key={x} x1={x} y1="140" x2={x} y2={i % 2 ? 108 : 114} />)}
        <line x1="160" y1="118" x2="280" y2="118" />
        <line x1="160" y1="132" x2="280" y2="132" />
      </g>
      <g stroke="#1a1422" strokeWidth="6" strokeLinecap="round" fill="none">
        <path d="M290 140 v-50 q-4 -20 -22 -30" />
        <path d="M290 100 q10 -14 24 -18" strokeWidth="4" />
        <path d="M288 118 q-14 -6 -20 -20" strokeWidth="4" />
      </g>
      <text x="34" y="120" fontSize="10" fill="#2a2333" fontFamily="serif">RIP</text>
    </svg>
  );
}
