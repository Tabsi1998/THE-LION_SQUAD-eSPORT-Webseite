import { illumination, litPath, moonPhase } from "./moon";

// Der Mond der Saisons (#658, #681, Winterhimmel W4 #730): eine Zeichnung für alle Jahreszeiten - echte Phase des
// Tages, warmweiß mit feinem Saum. Halloween stellt ihn an den Seitenhimmel, der Winter hinter den Inhalt; es gibt
// ihn nie doppelt. Wo er steht, rechnet MoonInSky.jsx (astronomy.js).

/**
 * Der Mond: echte Phase des Tages, warmweiß statt grau, feine Krater, dünner Schein - nichts Rechteckiges. `halo`
 * verstärkt den Schein (der Winter stellt ihn hinter den Inhalt, wo dunkle Verläufe ihn sonst grau machen).
 */
export function Moon({ className = "", style, phase = moonPhase(), halo = 1 }) {
  const lit = illumination(phase);
  const glow = (base) => Math.min(1, base * halo).toFixed(2);
  return (
    <svg className={`tls-moon ${className}`} style={style} width="120" height="120" viewBox="0 0 120 120" aria-hidden="true" data-phase={phase.toFixed(2)}>
      <defs>
        <radialGradient id="tls-moon-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={`rgba(200, 235, 245, ${glow(0.05 + lit * 0.11)})`} />
          <stop offset="0.55" stopColor={`rgba(200, 235, 245, ${glow(0.02 + lit * 0.04)})`} />
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
