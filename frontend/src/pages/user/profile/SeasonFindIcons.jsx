import { Cat, Ghost, Pumpkin, SittingBatShape } from "@/seasons/halloween/art";

// Die kleinen Figuren der Saison-Fundstücke (#678). Fledermaus, Geist, Katze und Kürbis sind dieselben wie auf der
// Seite - wer eine Fledermaus verscheucht hat, erkennt sie hier wieder. Schneeflocke, Türchen, Rakete und Ei sind im
// selben Strich gezeichnet: dunkle Fläche, heller Rand in Silber-Türkis, nichts Grelles. Die Bewegung beim Überfahren
// steht in season-finds.css und ruht bei „Bewegung reduzieren“.

const INK = "#0b0a0f";
const RIM = "rgba(170, 225, 240, 0.55)";
const SOFT = "rgba(170, 225, 240, 0.26)";

function Flake({ size = 30 }) {
  const arms = [0, 60, 120, 180, 240, 300];
  return (
    <svg className="tls-find__flake" width={size} height={size} viewBox="-16 -16 32 32" aria-hidden="true">
      {arms.map((angle) => (
        <g key={angle} transform={`rotate(${angle})`} stroke="#dff6ff" strokeWidth="1.6" strokeLinecap="round" fill="none">
          <line x1="0" y1="0" x2="0" y2="-13" />
          <line x1="0" y1="-8" x2="-3.4" y2="-10.8" />
          <line x1="0" y1="-8" x2="3.4" y2="-10.8" />
          <line x1="0" y1="-4.5" x2="-2.2" y2="-6.2" />
          <line x1="0" y1="-4.5" x2="2.2" y2="-6.2" />
        </g>
      ))}
      <circle cx="0" cy="0" r="1.8" fill="#dff6ff" />
    </svg>
  );
}

function Door({ size = 30 }) {
  return (
    <svg className="tls-find__door" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="6" y="3" width="20" height="26" rx="1.5" fill="rgba(255, 214, 140, 0.16)" stroke={SOFT} strokeWidth="1" />
      <path d="M13 11 l1.2 2.6 2.8 0.3 -2.1 1.9 0.6 2.8 -2.5 -1.4 -2.5 1.4 0.6 -2.8 -2.1 -1.9 2.8 -0.3 z" fill="rgba(255, 214, 140, 0.75)" transform="translate(3 3)" />
      <g className="tls-find__door-leaf">
        <rect x="6" y="3" width="20" height="26" rx="1.5" fill={INK} stroke={RIM} strokeWidth="1.1" />
        <rect x="9.5" y="6.5" width="13" height="8" rx="1" fill="none" stroke={SOFT} strokeWidth="0.9" />
        <rect x="9.5" y="17.5" width="13" height="8" rx="1" fill="none" stroke={SOFT} strokeWidth="0.9" />
        <circle cx="22.5" cy="16" r="1.2" fill="#ffd68c" />
      </g>
    </svg>
  );
}

function Rocket({ size = 30 }) {
  return (
    <svg className="tls-find__rocket" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <g className="tls-find__rocket-body">
        <path d="M16 3 C20 7 21 13 20 20 H12 C11 13 12 7 16 3 Z" fill={INK} stroke={RIM} strokeWidth="1.1" strokeLinejoin="round" />
        <path d="M12 16 L8 22 L12 21 Z M20 16 L24 22 L20 21 Z" fill={INK} stroke={RIM} strokeWidth="1" strokeLinejoin="round" />
        <circle cx="16" cy="11.5" r="2" fill="#9be7ff" />
        <path d="M13 20 H19" stroke={SOFT} strokeWidth="1" />
      </g>
      <path className="tls-find__rocket-flame" d="M14 21 C14 25 15 27 16 29 C17 27 18 25 18 21 Z" fill="#ffb347" opacity="0.85" />
    </svg>
  );
}

function Egg({ size = 30 }) {
  return (
    <svg className="tls-find__egg" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 3 C21.5 3 26 11 26 18.5 C26 24.5 21.5 29 16 29 C10.5 29 6 24.5 6 18.5 C6 11 10.5 3 16 3 Z" fill="#1b2a33" stroke={RIM} strokeWidth="1.1" />
      <path d="M7.4 15 C10 13 12.5 17 15.5 15 S21 13 24.6 15" stroke="#9be7ff" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      <path d="M6.6 21 C9.5 19 12.5 23 15.5 21 S21.5 19 25.4 21" stroke="#ffd68c" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      <ellipse cx="12" cy="9.5" rx="2.4" ry="1.4" fill="rgba(255, 255, 255, 0.14)" transform="rotate(-30 12 9.5)" />
    </svg>
  );
}

const FIGURES = {
  bat: () => <SittingBatShape size={26} />,
  ghost: () => <Ghost size={23} />,
  cat: () => <Cat size={33} />,
  pumpkin: () => <Pumpkin size={28} slow />,
  snowflake: () => <Flake />,
  door: () => <Door />,
  rocket: () => <Rocket />,
  egg: () => <Egg />,
};

export const FIND_ICONS = Object.keys(FIGURES);

/** Die Figur zu einem Fundstück - unbekannte Schlüssel bekommen die Schneeflocke, damit nie eine Lücke entsteht. */
export function FindIcon({ icon }) {
  const Figure = FIGURES[icon] || FIGURES.snowflake;
  return (
    <span className={`tls-find__figure tls-find__figure--${FIGURES[icon] ? icon : "snowflake"}`} aria-hidden="true">
      <Figure />
    </span>
  );
}
