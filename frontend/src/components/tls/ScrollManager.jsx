import { useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

function scrollPageTop() {
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

function scrollToHash(hash) {
  if (!hash) return false;
  const id = decodeURIComponent(hash.slice(1));
  if (!id) return false;
  const target = document.getElementById(id) || document.querySelector(`[name="${CSS.escape(id)}"]`);
  if (!target) return false;
  target.scrollIntoView({ block: "start", inline: "nearest", behavior: "auto" });
  return true;
}

export function ScrollManager() {
  const location = useLocation();
  const previousRef = useRef(null);

  useLayoutEffect(() => {
    const previous = previousRef.current;
    previousRef.current = {
      pathname: location.pathname,
      hash: location.hash,
    };
    const pathChanged = !previous || previous.pathname !== location.pathname;
    const hashChanged = !previous || previous.hash !== location.hash;
    if (!pathChanged && !hashChanged) return;

    if (location.hash) {
      requestAnimationFrame(() => {
        if (!scrollToHash(location.hash)) scrollPageTop();
      });
      return;
    }
    scrollPageTop();
  }, [location.pathname, location.search, location.hash]);

  return null;
}
