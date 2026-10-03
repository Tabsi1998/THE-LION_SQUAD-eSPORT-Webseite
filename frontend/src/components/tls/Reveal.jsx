import { useLayoutEffect, useRef, useState } from "react";

// Leises Einblenden (#832): ein Abschnitt zeigt seine Inhalte erst, wenn er ins Bild kommt - und was schon im
// Bild ist, blendet nach dem Laden weich ein statt herzuspringen. Nur die Deckkraft der Inhalte ändert sich:
// Rahmen, Lage und Größe bleiben stehen, damit Saison-Deko, die an Karten hängt, nie verrutscht. Welche
// Teile einblenden, sagen Klassen im Abschnitt (`tls-reveal-item`: Inhalt der Karte, `tls-reveal-text`:
// das Element selbst), gestaffelt über `--tls-i`. Einmal je Abschnitt.
// Ohne IntersectionObserver (Tests, alte Browser) und mit „Bewegung reduzieren“: alles sofort da.

export function revealAllowed(win = typeof window === "undefined" ? null : window) {
  if (!win || typeof win.IntersectionObserver === "undefined" || typeof win.matchMedia !== "function") return false;
  try {
    return !win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function Reveal({ as: Tag = "div", className = "", children, ...rest }) {
  const ref = useRef(null);
  const [state, setState] = useState("shown");
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !revealAllowed()) return undefined;
    setState("hidden");
    let frame = 0;
    const observer = new window.IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      frame = window.requestAnimationFrame(() => setState("shown"));
    }, { rootMargin: "0px 0px -6% 0px" });
    observer.observe(node);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, []);
  return <Tag ref={ref} className={className} data-reveal={state} {...rest}>{children}</Tag>;
}
