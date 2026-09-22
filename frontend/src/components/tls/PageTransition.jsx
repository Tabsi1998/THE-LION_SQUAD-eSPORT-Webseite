import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { prefersReducedMotion } from "@/hooks/useLiveChanges";

// Sanfter Seitenwechsel (#226): kurzes Einblenden, kein Schieben. Ohne eigenes Element im
// DOM - ein Rahmen um die Seiten verschob Höhenberechnungen um einen Pixel (Nachrichten-Seite).
// Beim Wechsel des Pfads wird der Inhaltsbereich der neuen Seite einmal eingeblendet; die Seite
// selbst wird nicht neu aufgebaut. Mit „Bewegung reduzieren“ passiert nichts.

export function pageContentElement() {
  return document.getElementById("main-content") || document.querySelector("main") || document.body;
}

export function PageTransition({ children }) {
  const { pathname } = useLocation();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (prefersReducedMotion()) return;
    const element = pageContentElement();
    if (!element || typeof element.animate !== "function") return;
    element.animate([{ opacity: 0.001 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
  }, [pathname]);

  return children;
}
