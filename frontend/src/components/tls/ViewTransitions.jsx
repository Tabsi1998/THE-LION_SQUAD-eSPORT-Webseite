import { useContext, useEffect, useLayoutEffect } from "react";
import { UNSAFE_NavigationContext, useLocation } from "react-router-dom";
import { clickTarget, navigateWithTransition, routeCommitted, routeKey, transitionsAvailable } from "@/lib/viewTransition";

// Seitenwechsel mit der eingebauten Übergangs-Funktion (#1073), siehe lib/viewTransition.js.
//
// Der Router bleibt, wie er ist: Links mit `state` oder `replace` navigieren selbst. Hier wird nur der Schritt, mit
// dem der Router die Adresse wechselt (`navigator.push`), in den Übergang gelegt - und nur, wenn unmittelbar davor ein
// Klick genau dieses Ziel geöffnet hat. Alles andere (Weiterleitungen, Zurück, Formulare) läuft wie bisher.

const ARM_MS = 1000;

export function ViewTransitions() {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const location = useLocation();

  // Layout-Effekt: läuft nach dem Scrollen nach oben (ScrollManager), bevor der Browser das neue Bild aufnimmt.
  useLayoutEffect(() => {
    routeCommitted(`${location.pathname}${location.search}`);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (typeof window === "undefined" || !navigator || typeof navigator.push !== "function") return undefined;
    let armed = null;
    const onClick = (event) => {
      const key = transitionsAvailable(window) ? clickTarget(event, window) : null;
      armed = key ? { key, at: Date.now() } : null;
    };
    const push = navigator.push;
    function pushWithTransition(to, ...rest) {
      const key = routeKey(to, window.location.href);
      const wanted = armed && key && armed.key === key && Date.now() - armed.at < ARM_MS && transitionsAvailable(window);
      armed = null;
      if (!wanted) return push.call(navigator, to, ...rest);
      navigateWithTransition(window, key, () => push.call(navigator, to, ...rest));
      return undefined;
    }
    navigator.push = pushWithTransition;
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      if (navigator.push === pushWithTransition) navigator.push = push;
    };
  }, [navigator]);

  return null;
}
