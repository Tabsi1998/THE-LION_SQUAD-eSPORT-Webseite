// Halloween-Kunst (#635): Spinnweben, Spinne, Kürbis und Laterne als SVG - keine Bilder, keine Bytes.

export function Cobweb({ className = "" }) {
  const rays = [0, 15, 30, 45, 60, 75, 90];
  const rings = [22, 44, 66, 88, 110];
  return (
    <svg className={`tls-cobweb ${className}`} viewBox="0 0 120 120" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.9" aria-hidden="true">
      {rays.map((angle) => {
        const rad = (angle * Math.PI) / 180;
        return <line key={angle} x1="0" y1="0" x2={Math.cos(rad) * 118} y2={Math.sin(rad) * 118} />;
      })}
      {rings.map((radius) => (
        <path key={radius} d={rays.slice(0, -1).map((angle, index) => {
          const a1 = (angle * Math.PI) / 180;
          const a2 = ((rays[index + 1]) * Math.PI) / 180;
          const mid = (a1 + a2) / 2;
          const sag = radius * 0.92;
          return `${index === 0 ? "M" : "L"} ${Math.cos(a1) * radius} ${Math.sin(a1) * radius} Q ${Math.cos(mid) * sag} ${Math.sin(mid) * sag} ${Math.cos(a2) * radius} ${Math.sin(a2) * radius}`;
        }).join(" ")} />
      ))}
    </svg>
  );
}

export function Spider({ style }) {
  return (
    <svg className="tls-spider" style={style} viewBox="0 0 20 80" aria-hidden="true">
      <line x1="10" y1="0" x2="10" y2="62" stroke="rgba(255,255,255,0.5)" strokeWidth="0.7" />
      <ellipse cx="10" cy="66" rx="4.5" ry="5.5" fill="#1a1520" />
      <circle cx="10" cy="60.5" r="2.6" fill="#1a1520" />
      {[-1, 1].map((side) => [0, 1, 2, 3].map((leg) => (
        <path key={`${side}-${leg}`} d={`M ${10 + side * 3} ${63 + leg * 2} q ${side * 6} ${-4 + leg} ${side * 8} ${2 + leg * 1.5}`} stroke="#1a1520" strokeWidth="1.1" fill="none" />
      )))}
      <circle cx="8.6" cy="60" r="0.6" fill="#ff9a3c" />
      <circle cx="11.4" cy="60" r="0.6" fill="#ff9a3c" />
    </svg>
  );
}

export function Pumpkin({ size = 26, slow = false }) {
  return (
    <svg className={`tls-pumpkin ${slow ? "tls-pumpkin--slow" : ""}`} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M19 8 q-2 -5 3 -7" stroke="#4d7c2a" strokeWidth="3" fill="none" strokeLinecap="round" />
      <ellipse cx="20" cy="24" rx="17" ry="13" fill="#ff7a1a" />
      <ellipse cx="12" cy="24" rx="7" ry="12.5" fill="#f26b0c" opacity="0.8" />
      <ellipse cx="28" cy="24" rx="7" ry="12.5" fill="#f26b0c" opacity="0.8" />
      <path d="M11 20 l4 5 l-8 0 z M29 20 l-4 5 l8 0 z" fill="#ffd166" />
      <path d="M11 29 q9 6 18 0 l-2 3 l-3 -2 l-3 2 l-3 -2 l-3 2 l-3 -2 z" fill="#ffd166" />
    </svg>
  );
}

/** Die Laterne neben dem Löwen: Kürbis mit Deckel, aus dem beim Klick eine Fledermaus fliegt. */
export function Lantern({ open }) {
  return (
    <svg width="34" height="34" viewBox="0 0 40 40" aria-hidden="true" className={`tls-pumpkin ${open ? "" : "tls-pumpkin--slow"}`}>
      <ellipse cx="20" cy="25" rx="16" ry="12" fill="#ff7a1a" />
      <ellipse cx="12.5" cy="25" rx="6.5" ry="11.5" fill="#f26b0c" opacity="0.8" />
      <ellipse cx="27.5" cy="25" rx="6.5" ry="11.5" fill="#f26b0c" opacity="0.8" />
      <path d="M11.5 21 l4 5 l-8 0 z M28.5 21 l-4 5 l8 0 z" fill="#ffe08a" />
      <path d="M11 30 q9 6 18 0 l-2 3 l-3 -2 l-3 2 l-3 -2 l-3 2 l-3 -2 z" fill="#ffe08a" />
      <g className="tls-lantern__lid">
        <path d="M9 14 q11 -6 22 0 q-11 3 -22 0 z" fill="#e8640a" />
        <path d="M19 12 q-2 -5 3 -7" stroke="#4d7c2a" strokeWidth="3" fill="none" strokeLinecap="round" />
      </g>
      <g className="tls-lantern__bat">
        <path d="M20 16 q-4 -6 -8 -2 q3 0 4 3 q2 -2 4 0 q2 -2 4 0 q1 -3 4 -3 q-4 -4 -8 2 z" fill="#1a1520" />
      </g>
    </svg>
  );
}
