import { useEffect, useRef, useState } from "react";
import { motionAllowed } from "@/lib/motion";

// Baustein „Aufleuchten“ (#1969): ein Abzeichen oder neuer Wert leuchtet einmal kurz auf - Pole, Bestzeit, neuer Platz.
// - `active`: leuchtet beim ersten Zeichnen (etwa am Ende des Hochzählens, versetzt mit `delay`).
// - `trigger`: leuchtet bei jeder Änderung danach (Live-Nachladen), nie beim ersten Zeichnen.
// - `tone`: brand (Vorgabe), honor, ok, pole, fastest - die Farb-Rollen aus styles/system.css.
// Bewegt wird nur die Deckkraft eines Scheins hinter dem Inhalt (index.css `.tls-glow`); „Bewegung reduzieren“: nichts.

const TONES = new Set(["brand", "honor", "ok", "pole", "fastest"]);

export function Glow({ as: Tag = "span", active = false, trigger, tone = "brand", delay = 0, className = "", style, children, ...rest }) {
  const [round, setRound] = useState(() => (active && motionAllowed() ? 1 : 0));
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (motionAllowed()) setRound((count) => count + 1);
  }, [trigger]);
  const glowStyle = delay ? { ...style, "--tls-glow-delay": `${delay}ms` } : style;
  return (
    <Tag
      className={`tls-glow ${className}`.trim()}
      data-glow={round ? (round % 2 ? "on" : "again") : undefined}
      data-tone={TONES.has(tone) ? tone : "brand"}
      style={glowStyle}
      {...rest}
    >
      {children}
    </Tag>
  );
}
