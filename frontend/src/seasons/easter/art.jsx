// Die Bilder der Osterzeit (#645, #753, #756): ein Feldhasen-Ohrenpaar für die seltenen Momente hinter einer Kante,
// ein Zitronenfalter, Blumen und Gras (Hasenohren auf dem Löwen gibt es nicht mehr, #857). Alles SVG, keine Bilder; Farben gedeckt, nicht kindlich.

/** Die Ohren eines Feldhasen (graubraun) - für den kurzen Blick hinter einer Kante hervor. */
export function HareEarsArt({ width = 26 }) {
  return (
    <svg className="tls-hare__svg" width={width} height={width * 1.15} viewBox="0 0 26 30" aria-hidden="true">
      <g className="tls-hare__left">
        <path d="M6 30 C3.5 22 3 12 5.6 4 C6.6 1.4 9 1.6 9.6 4.4 C10.8 12 11 22 10.4 30 Z" fill="#b9a58f" stroke="rgba(0,0,0,0.35)" strokeWidth="0.7" />
        <path d="M6.9 28 C5.4 21 5.2 13 6.6 6.6 C7.1 5.2 8.2 5.4 8.5 6.9 C9.3 13 9.4 21 9 28 Z" fill="#e3c4ae" />
        <path d="M5 4.5 C5.8 2 8.6 1.8 9.4 4" stroke="#3d342b" strokeWidth="1.1" fill="none" strokeLinecap="round" />
      </g>
      <g className="tls-hare__right">
        <path d="M15.6 30 C15.6 22 16.8 12 19.6 5 C20.8 2.4 23.2 2.8 23.4 5.6 C23.2 13 21.4 22 20.2 30 Z" fill="#b9a58f" stroke="rgba(0,0,0,0.35)" strokeWidth="0.7" />
        <path d="M16.8 28 C17.2 21 18.2 14 20.2 7.6 C20.8 6.4 21.9 6.6 21.9 8 C21.4 14 20.2 21 19.2 28 Z" fill="#e3c4ae" />
        <path d="M19.3 5.2 C20.4 2.6 23 2.6 23.4 5.2" stroke="#3d342b" strokeWidth="1.1" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** Ein Zitronenfalter: zwei Flügelpaare, die mit `tls-butterfly__wing` schlagen. */
export function ButterflyArt({ size = 26 }) {
  return (
    <svg className="tls-butterfly__svg" width={size} height={size * 0.8} viewBox="0 0 30 24" aria-hidden="true">
      <g className="tls-butterfly__wing tls-butterfly__wing--left">
        <path d="M14.6 11 C10 2 2.5 1 1.5 5.5 C0.8 9 5 12 14.2 12.4 Z" fill="#f6dd6a" stroke="#c9a72c" strokeWidth="0.6" />
        <path d="M14.4 12.8 C8 13.4 3.8 16.2 5.6 19.6 C7.2 22.4 11.6 19.4 14.6 13.8 Z" fill="#efcf52" stroke="#c9a72c" strokeWidth="0.6" />
        <circle cx="7.4" cy="7.6" r="1" fill="#e08a2e" />
      </g>
      <g className="tls-butterfly__wing tls-butterfly__wing--right">
        <path d="M15.4 11 C20 2 27.5 1 28.5 5.5 C29.2 9 25 12 15.8 12.4 Z" fill="#f6dd6a" stroke="#c9a72c" strokeWidth="0.6" />
        <path d="M15.6 12.8 C22 13.4 26.2 16.2 24.4 19.6 C22.8 22.4 18.4 19.4 15.4 13.8 Z" fill="#efcf52" stroke="#c9a72c" strokeWidth="0.6" />
        <circle cx="22.6" cy="7.6" r="1" fill="#e08a2e" />
      </g>
      <path d="M15 7.5 L15 17" stroke="#4a3b22" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M14.6 7.6 C13.6 5 12.4 3.8 11.2 3.2 M15.4 7.6 C16.4 5 17.6 3.8 18.8 3.2" stroke="#4a3b22" strokeWidth="0.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

const FLOWER_COLORS = { daisy: ["#fffaf2", "#f2c14e"], tulip: ["#e98aa3", "#b3546f"], crocus: ["#b9a3e3", "#7b5cb8"], primrose: ["#f6e27a", "#e3a63a"] };
export const FLOWER_KINDS = Object.keys(FLOWER_COLORS);

/** Eine Blume auf einem Stiel - `height` ist die ganze Höhe (Stiel unten bei y = height). */
export function FlowerArt({ kind = "daisy", height = 18 }) {
  const [petal, heart] = FLOWER_COLORS[kind] || FLOWER_COLORS.daisy;
  const scale = height / 24;
  return (
    <svg className="tls-flower__svg" width={Math.round(14 * scale)} height={height} viewBox="0 0 14 24" aria-hidden="true">
      <path d="M7 24 C7 18 6.4 13 7 8.5" stroke="#5f8f4a" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      <path d="M7 18 C4.6 16.2 3.2 16.6 2.4 17.6 C4 18.6 5.6 18.8 7 18.6 Z" fill="#6f9e4f" />
      {kind === "tulip" ? (
        <path d="M3.6 4.2 L5.2 6.6 L7 3.2 L8.8 6.6 L10.4 4.2 C11 8.4 9.6 10.6 7 10.6 C4.4 10.6 3 8.4 3.6 4.2 Z" fill={petal} stroke={heart} strokeWidth="0.6" />
      ) : kind === "crocus" ? (
        <path d="M7 2.2 C9.6 3.6 10.4 7 9.2 9.6 C8.6 10.6 5.4 10.6 4.8 9.6 C3.6 7 4.4 3.6 7 2.2 Z" fill={petal} stroke={heart} strokeWidth="0.6" />
      ) : (
        <g>
          {[0, 60, 120, 180, 240, 300].map((angle) => <ellipse key={angle} cx="7" cy="3.6" rx="1.5" ry="2.6" fill={petal} transform={`rotate(${angle} 7 6.6)`} />)}
          <circle cx="7" cy="6.6" r="1.7" fill={heart} />
        </g>
      )}
    </svg>
  );
}

/** Ein Grasbüschel: drei bis fünf Halme, unten gerade. */
export function GrassTuft({ width = 14, height = 10, blades = 4 }) {
  const step = width / (blades + 1);
  return (
    <svg className="tls-grass__svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {Array.from({ length: blades }, (_, i) => {
        const x = step * (i + 1);
        const lean = (i % 2 ? 1 : -1) * (1.2 + (i % 3) * 0.6);
        const top = 1 + ((i * 7) % 4);
        return <path key={i} d={`M${x.toFixed(1)} ${height} Q${(x + lean * 0.4).toFixed(1)} ${(height + top) / 2} ${(x + lean).toFixed(1)} ${top}`} stroke={i % 2 ? "#6f9e4f" : "#5f8f4a"} strokeWidth="1.2" fill="none" strokeLinecap="round" />;
      })}
    </svg>
  );
}
