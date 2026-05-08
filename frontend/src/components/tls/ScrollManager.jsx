import { useEffect, useLayoutEffect } from "react";
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

function isTabTrigger(target) {
  const button = target?.closest?.("button, [role='tab']");
  if (!button) return false;
  if (button.getAttribute("role") === "tab") return true;
  const testId = button.getAttribute("data-testid") || "";
  return /(^|[-_])tab([-_]|$)/i.test(testId);
}

export function ScrollManager() {
  const location = useLocation();

  useLayoutEffect(() => {
    if (location.hash) {
      requestAnimationFrame(() => {
        if (!scrollToHash(location.hash)) scrollPageTop();
      });
      return;
    }
    scrollPageTop();
  }, [location.pathname, location.search, location.hash]);

  useEffect(() => {
    const onClick = (event) => {
      if (!isTabTrigger(event.target)) return;
      window.setTimeout(scrollPageTop, 0);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
