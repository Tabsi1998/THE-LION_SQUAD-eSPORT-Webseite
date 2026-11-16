const isLocalhost = Boolean(
  window.location.hostname === "localhost" ||
    window.location.hostname === "[::1]" ||
    window.location.hostname.match(/^127(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)){3}$/),
);

// Hinweise des Service Workers nur hinter einem Schalter (#1908): im Browser localStorage „tls_sw_debug“ auf „true“
// setzen. Ohne Schalter bleibt die Konsole still - auch auf localhost, wo der fertige Build sonst bei jedem Laden schrieb.
export function swNote(message) {
  let on = false;
  try {
    on = window.localStorage.getItem("tls_sw_debug") === "true";
  } catch {
    on = false;
  }
  // eslint-disable-next-line no-console -- nur mit bewusst gesetztem Schalter, sonst still (siehe oben)
  if (on) console.info(`[TLS PWA] ${message}`);
}

export function register(config) {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    const swUrl = `${import.meta.env.BASE_URL}service-worker.js`;

    if (isLocalhost) {
      checkValidServiceWorker(swUrl, config);
      navigator.serviceWorker.ready.then(() => {
        swNote("Cache auf localhost aktiv.");
      });
      return;
    }

    registerValidSW(swUrl, config);
  });
}

function registerValidSW(swUrl, config) {
  fetch(`${import.meta.env.BASE_URL}version.json`, { cache: "no-store" })
    .then((response) => response.ok ? response.json() : null)
    .catch(() => null)
    .then((manifest) => {
      const version = manifest?.version;
      const url = typeof version === "string" && /^[a-f0-9]{20}$/.test(version) ? `${swUrl}?v=${version}` : swUrl;
      return navigator.serviceWorker.register(url, { updateViaCache: "none" });
    })
    .then((registration) => {
      if (registration.waiting) config?.onUpdate?.(registration);
      const checkUpdate = () => {
        if (!document.hidden && navigator.onLine) registration.update().catch(() => {});
      };
      window.addEventListener("online", checkUpdate);
      document.addEventListener("visibilitychange", checkUpdate);
      window.setInterval(checkUpdate, 5 * 60 * 1000);
      registration.onupdatefound = () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;

        installingWorker.onstatechange = () => {
          if (installingWorker.state !== "installed") return;
          if (navigator.serviceWorker.controller) {
            config?.onUpdate?.(registration);
          } else {
            config?.onSuccess?.(registration);
          }
        };
      };
    })
    .catch((error) => {
      console.error("TLS service worker registration failed:", error);
    });
}

function checkValidServiceWorker(swUrl, config) {
  fetch(swUrl, { headers: { "Content-Type": "text/javascript" } })
    .then((response) => {
      const contentType = response.headers.get("content-type");
      if (response.status === 404 || (contentType && !contentType.includes("javascript"))) {
        navigator.serviceWorker.ready
          .then((registration) => registration.unregister())
          .then(() => window.location.reload());
        return;
      }
      registerValidSW(swUrl, config);
    })
    .catch(() => {
      swNote("Offline - die App läuft mit dem vorhandenen Cache.");
    });
}

export function applyWaitingServiceWorker(registration) {
  if (!registration?.waiting) return false;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  registration.waiting.postMessage({ type: "SKIP_WAITING" });
  return true;
}
