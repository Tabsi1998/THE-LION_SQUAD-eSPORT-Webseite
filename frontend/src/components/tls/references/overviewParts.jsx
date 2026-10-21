// Bausteine der Referenzen-Übersicht (#1878): Abschnittskopf, Platz-Ring, Medaillen- und Pokalzeichen, Marke. Farben
// nur aus den Rollen: Gold (honor), Silber und Bronze als Ring- und Schriftfarbe, nie als Fläche.

export const MEDAL_TONES = {
  1: { key: "gold", label: "Gold", text: "text-honor", border: "border-honor" },
  2: { key: "silver", label: "Silber", text: "text-silver", border: "border-silver" },
  3: { key: "bronze", label: "Bronze", text: "text-bronze", border: "border-bronze" },
};

export function medalTone(placement) {
  return MEDAL_TONES[Number(placement)] || null;
}

/** Abschnittskopf: kleine Zeile (Gold oder Cyan, optional mit Puls), Überschrift, rechts ein Hinweis. */
export function SectionHead({ id, eyebrow, tone = "brand", title, hint, pulse = false }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5 md:mb-6">
      <div className="flex flex-col gap-2 min-w-0">
        <div className={`flex items-center gap-2.5 text-[11px] md:text-xs font-bold uppercase tracking-[0.26em] ${tone === "honor" ? "text-honor" : "text-brand"}`}>
          {pulse && <span className="tls-run-pulse" aria-hidden="true" />}
          {eyebrow}
        </div>
        <h2 id={id} className="m-0 font-heading font-extrabold uppercase leading-none text-[26px] md:text-[clamp(28px,3.4vw,40px)] break-words">{title}</h2>
      </div>
      {hint && <div className="text-[13px] md:text-sm text-quiet">{hint}</div>}
    </div>
  );
}

/** Die Platzierung im Ring: Ring und Zahl in der Medaillenfarbe, sonst neutral; ohne Platz „–“. */
export function PlaceRing({ placement, size = "md", className = "" }) {
  const tone = medalTone(placement);
  const dims = size === "lg" ? "w-14 h-14 text-[26px]" : size === "sm" ? "w-[38px] h-[38px] text-lg" : size === "xs" ? "w-[34px] h-[34px] text-[17px]" : "w-10 h-10 sm:w-11 sm:h-11 text-lg sm:text-xl";
  return (
    <span
      data-testid="placement-badge"
      data-medal={tone?.key || "none"}
      className={`${dims} shrink-0 rounded-full border-2 inline-flex items-center justify-center font-display font-bold tabular-nums ${tone ? `${tone.border} ${tone.text}` : "border-white/20 text-zinc-300"} ${className}`}
    >
      {placement ? `${placement}.` : "–"}
    </span>
  );
}

/** Ring mit Pokal für die Ehrentafel - in der Farbe der Medaille. */
export function MedalMark({ placement, className = "w-[30px] h-[30px] md:w-[34px] md:h-[34px]" }) {
  const tone = medalTone(placement);
  return (
    <svg viewBox="0 0 34 34" fill="none" aria-hidden="true" className={`${className} ${tone?.text || ""}`}>
      <circle cx="17" cy="17" r="15" stroke="currentColor" strokeWidth="2.5" />
      <path d="M12 13h10l-1.5 9h-7z" fill="currentColor" opacity=".9" />
    </svg>
  );
}

/** Der Pokal der Hauptkarte. */
export function TrophyMark({ className = "", label = "Pokal" }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" role="img" aria-label={label} className={className}>
      <path d="M20 10h24v14a12 12 0 0 1-24 0z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M20 15h-7v4a8 8 0 0 0 8 8M44 15h7v4a8 8 0 0 1-8 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M32 36v9M24 54h16M26 54l1.5-9h9L38 54" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M28 18l3 3 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity=".7" />
    </svg>
  );
}

/** Kleine Marke (Spiel, Format, Saison). */
export function Mark({ children }) {
  if (!children) return null;
  return <span className="inline-flex items-center px-2.5 py-1 rounded bg-surface-2 border border-white/10 text-[13px] leading-tight text-zinc-300 break-words max-w-full">{children}</span>;
}

/** Der Pfeil am Zeilenende - nach rechts (Link) oder nach unten (Aufklappen, #1944). */
export function Chevron({ className = "", down = false }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" className={`shrink-0 text-brand ${className}`}>
      <path d={down ? "M5 7l4 4 4-4" : "M7 4l5 5-5 5"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
