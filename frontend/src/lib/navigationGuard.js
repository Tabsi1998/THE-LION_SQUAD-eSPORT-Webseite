import { useContext, useEffect, useRef } from "react";
import { UNSAFE_NavigationContext, useLocation } from "react-router-dom";

// Seitenwechsel innerhalb der Webseite anhalten, solange etwas nicht gespeichert werden konnte (#1048, nach
// Codex-Prüfung von #1535). `beforeunload` greift nur beim echten Entladen; Links, `navigate()` und „Zurück“ bleiben in
// der Seite. Die Webseite läuft mit <BrowserRouter> (kein Daten-Router, daher kein `useBlocker`), deshalb wie in
// ViewTransitions: der Schritt, mit dem der Router die Adresse wechselt (`navigator.push`/`replace`), wird geprüft.
// „Zurück“/„Vor“ des Browsers (popstate) fängt ein Hörer ab, der vor dem Router steht (dafür importiert App.jsx dieses
// Modul), und stellt die Adresse wieder her, bis die Person entschieden hat.
//
// Höchstens eine Seite hält gerade an (die Einstellungen). Ein Wächter hat:
// - blocks(nextPathname): true, wenn der Wechsel angehalten werden soll (ein Wechsel auf derselben Seite, etwa ein
//   anderer Reiter per ?tab=, sollte false liefern)
// - onBlocked(proceed): fragt nach; proceed() setzt den Wechsel fort.

let activeGuard = null;
let currentIdx = null;
let swallowPops = 0;
let passNextPop = false;

function stateIdx(state) {
  return state && typeof state.idx === "number" ? state.idx : null;
}

function onPopState(event) {
  if (swallowPops > 0) {
    // Die Wiederherstellung der Adresse - der Router hat nie etwas anderes gesehen.
    swallowPops -= 1;
    event.stopImmediatePropagation();
    return;
  }
  if (passNextPop) {
    passNextPop = false;
    return;
  }
  const guard = activeGuard;
  const target = stateIdx(event.state);
  if (!guard || target == null || currentIdx == null || target === currentIdx) return;
  if (!guard.blocks(window.location.pathname)) return;
  event.stopImmediatePropagation();
  const delta = currentIdx - target;
  swallowPops += 1;
  window.history.go(delta);
  guard.onBlocked(() => {
    passNextPop = true;
    window.history.go(-delta);
  });
}

if (typeof window !== "undefined" && !window.__tlsNavigationGuard) {
  window.__tlsNavigationGuard = true;
  window.addEventListener("popstate", onPopState, true);
}

function pathnameOf(to, base) {
  if (!to) return null;
  if (typeof to === "string") return new URL(to, base).pathname;
  return to.pathname || new URL(base).pathname;
}

/** Hält Seitenwechsel an, solange `guard.blocks(...)` true liefert. `guard` darf sich bei jedem Rendern ändern. */
export function useNavigationGuard(guard) {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const location = useLocation();
  const guardRef = useRef(guard);
  useEffect(() => {
    guardRef.current = guard;
  });

  // Stand im Verlauf merken, damit „Zurück“ wiederhergestellt werden kann.
  useEffect(() => {
    if (typeof window !== "undefined") currentIdx = stateIdx(window.history.state);
  }, [location.key]);

  useEffect(() => {
    const own = {
      blocks: (nextPathname) => !!guardRef.current?.blocks(nextPathname),
      onBlocked: (proceed) => guardRef.current?.onBlocked(proceed),
    };
    activeGuard = own;
    if (!navigator || typeof navigator.push !== "function") {
      return () => {
        if (activeGuard === own) activeGuard = null;
      };
    }
    const push = navigator.push;
    const replace = navigator.replace;
    const base = () => (typeof window !== "undefined" ? window.location.href : "http://local/");
    const wrap = (original) => function guarded(to, ...rest) {
      const nextPathname = pathnameOf(to, base());
      if (nextPathname && own.blocks(nextPathname)) {
        own.onBlocked(() => original.call(navigator, to, ...rest));
        return undefined;
      }
      return original.call(navigator, to, ...rest);
    };
    const guardedPush = wrap(push);
    const guardedReplace = wrap(replace);
    navigator.push = guardedPush;
    navigator.replace = guardedReplace;
    return () => {
      if (activeGuard === own) activeGuard = null;
      if (navigator.push === guardedPush) navigator.push = push;
      if (navigator.replace === guardedReplace) navigator.replace = replace;
    };
  }, [navigator]);
}
