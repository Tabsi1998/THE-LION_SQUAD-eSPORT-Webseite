import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { prefersReducedMotion } from "@/hooks/useLiveChanges";

// Sanfter Seitenwechsel (#226): kurzes Einblenden, kein Schieben. Die Seite wird dabei nicht
// neu aufgebaut - nur der Rahmen bekommt beim Wechsel des Pfads einmal die Animation.
// Mit „Bewegung reduzieren“ passiert nichts.

export function PageTransition({ children }) {
  const { pathname } = useLocation();
  const node = useRef(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const element = node.current;
    if (!element || prefersReducedMotion() || typeof element.animate !== "function") return;
    element.animate(
      [{ opacity: 0.001, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }],
      { duration: 220, easing: "ease-out" },
    );
  }, [pathname]);

  return <div ref={node} data-testid="page-transition">{children}</div>;
}
