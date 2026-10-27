import { applyCspNonce } from "@/lib/csp";

// Cloudflare Turnstile (#2067) - nur geladen, wenn der Spamschutz es für dieses Formular verlangt. Die Adresse ist fest;
// die Content-Security-Policy (frontend/nginx.conf) erlaubt challenges.cloudflare.com nur für Skript und Frame.
export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_ID = "cf-turnstile-script";

let loading = null;

export function loadTurnstile() {
  if (typeof window === "undefined") return Promise.reject(new Error("Kein Browser."));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const fail = () => {
      loading = null;
      reject(new Error("Die Sicherheitsprüfung konnte nicht geladen werden."));
    };
    const existing = document.getElementById(SCRIPT_ID);
    const script = existing || applyCspNonce(document.createElement("script"));
    script.addEventListener("load", () => (window.turnstile ? resolve(window.turnstile) : fail()), { once: true });
    script.addEventListener("error", fail, { once: true });
    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });
  return loading;
}

export function resetTurnstileLoaderForTests() {
  loading = null;
}
