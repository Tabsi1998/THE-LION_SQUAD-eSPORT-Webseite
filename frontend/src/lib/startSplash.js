import { LION_PATH } from "@/components/tls/LionArt";

// Erster Start der installierten Website (#1324): einmal je Sitzung, nur im Vollbild der installierten Website
// (display-mode: standalone), zeigt sich der Löwe mit „Das Rudel sammelt sich …“ - höchstens, bis die erste Seite da
// ist (StartSplashGate in App.jsx), spätestens nach sechs Sekunden ist er weg. Gebaut ohne React, damit er sofort steht.

const KEY = "tls_start_splash_v1";
const ID = "tls-start-splash";
const LONGEST_MS = 6000;

export function shouldShowStartSplash() {
  try {
    return Boolean(window.matchMedia?.("(display-mode: standalone)").matches) && !window.sessionStorage.getItem(KEY);
  } catch {
    return false;
  }
}

export function mountStartSplash() {
  if (document.getElementById(ID)) return;
  try {
    window.sessionStorage.setItem(KEY, "1");
  } catch {
    // ohne Speicher zeigt er sich eben bei jedem Start
  }
  const splash = document.createElement("div");
  splash.id = ID;
  splash.className = "tls-start-splash";
  splash.setAttribute("role", "status");
  splash.setAttribute("data-testid", "start-splash");
  splash.innerHTML = `<svg viewBox="0 0 173 220" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="${LION_PATH}"/></svg>`
    + "<span>Das Rudel sammelt sich …</span><div class=\"tls-start-splash__bar\"></div>";
  document.body.appendChild(splash);
  window.setTimeout(releaseStartSplash, LONGEST_MS);
}

export function releaseStartSplash() {
  const splash = document.getElementById(ID);
  if (!splash || splash.hasAttribute("data-leaving")) return;
  splash.setAttribute("data-leaving", "");
  window.setTimeout(() => splash.remove(), 260);
}
