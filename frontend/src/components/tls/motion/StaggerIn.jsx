import { useEffect, useRef, useState } from "react";
import { MICRO, MOTION, motionAllowed } from "@/lib/motion";

// Baustein „gestaffelt erscheinen“ (#1969): die Einträge einer Liste oder die Zeilen einer Tabelle steigen beim ersten
// Sichtbarwerden nacheinander leise auf (je 50 ms, nur Verschieben und Deckkraft). Nur die ersten zwölf staffeln, der
// Rest steht sofort. Danach ist Ruhe: Einträge, die beim Live-Nachladen dazukommen, stehen ohne Bewegung da.
// `as` wählt das Element (ul, ol, tbody, div …). „Bewegung reduzieren“, Druck und Browser ohne Beobachter: sofort.

function startState() {
  if (!motionAllowed()) return "done";
  return typeof IntersectionObserver === "undefined" ? "run" : "wait";
}

export function StaggerIn({ as: Tag = "div", play = true, className = "", children, ...rest }) {
  const ref = useRef(null);
  const [state, setState] = useState(() => (play ? startState() : "done"));

  useEffect(() => {
    if (state !== "wait") return undefined;
    const node = ref.current;
    if (!node) {
      setState("run");
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setState("run");
        observer.disconnect();
      }
    }, { threshold: 0.05 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [state]);

  useEffect(() => {
    if (state !== "run") return undefined;
    const timer = window.setTimeout(() => setState("done"), MICRO.stagger * MICRO.staggerMax + MOTION.slow + 60);
    return () => window.clearTimeout(timer);
  }, [state]);

  return (
    <Tag ref={ref} className={`tls-stagger ${className}`.trim()} data-stagger={state} {...rest}>
      {children}
    </Tag>
  );
}
