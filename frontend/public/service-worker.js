const CACHE_PREFIX = "tls-static-";
const CACHE_NAME = `${CACHE_PREFIX}__TLS_BUILD_ID__`;
const MAX_STATIC_ENTRIES = 80;
const APP_SHELL = [
  "/assets/brand/tls-favicon.png",
  "/assets/brand/tls-favicon-light.png",
  "/assets/brand/tls-favicon-dark.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("message", (event) => {
  let origin = event.origin;
  if (!origin && event.source?.url) {
    try { origin = new URL(event.source.url).origin; } catch { return; }
  }
  if (origin !== self.location.origin) return;
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) || ["tls-public-config", "tls-seo-preview", "tls-images"].includes(name))
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  );
});

// Die Mitgliedskarte ohne Netz (#1256): die Seite legt das Bild der Karte (ohne Prüfcode) und den Stand in einen eigenen
// Cache; ohne Netz zeigt „Keine Verbindung“ auf den Seiten eines Mitglieds dieses Bild. Abmelden löscht den Cache.
const CARD_CACHE = "tls-member-card";
const CARD_IMAGE = "/__tls/member-card.png";
const CARD_META = "/__tls/member-card.json";
const CARD_PAGES = /^\/(?:$|members(?:\/|$)|verein(?:\/|$)|account(?:\/|$)|u\/)/;

async function offlineCard(pathname) {
  if (!CARD_PAGES.test(pathname)) return null;
  try {
    const cache = await caches.open(CARD_CACHE);
    const meta = await cache.match(CARD_META);
    if (!meta || !(await cache.match(CARD_IMAGE))) return null;
    return await meta.json();
  } catch {
    return null;
  }
}

function standText(card) {
  const date = new Date(card && card.saved_at);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("de-AT", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Vienna" });
}

function offlinePage(card) {
  const cardBlock = card
    ? `<figure style="margin:24px 0;max-width:420px"><img src="${CARD_IMAGE}" alt="Deine Mitgliedskarte" style="width:100%;height:auto;border-radius:14px"><figcaption style="margin-top:8px;color:#a1a1aa">Deine Mitgliedskarte · Stand: ${standText(card)}. Der Prüfcode braucht Netz.</figcaption></figure>`
    : "";
  return '<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Verbindung fehlt</title><body style="font-family:system-ui,sans-serif;background:#0a0a0a;color:#fff;padding:16px"><h1>Keine Verbindung</h1><p>Bitte prüfe deine Internetverbindung und lade diese Seite erneut. Für die Anmeldung und E-Mail-Bestätigung ist eine Verbindung erforderlich.</p>' + cardBlock + "</body></html>";
}

async function networkFirst(request) {
  try {
    return await fetch(request, { cache: "no-store" });
  } catch {
    const card = await offlineCard(new URL(request.url).pathname);
    return new Response(offlinePage(card), {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}

async function cardImage() {
  try {
    const cache = await caches.open(CARD_CACHE);
    const hit = await cache.match(CARD_IMAGE);
    if (hit) return hit;
  } catch {
    // kein Cache-Speicher
  }
  return new Response("", { status: 404, headers: { "Cache-Control": "no-store" } });
}

async function staticCache(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    await cache.put(request, response.clone());
    const keys = await cache.keys();
    while (keys.length > MAX_STATIC_ENTRIES) {
      await cache.delete(keys.shift());
    }
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname === CARD_IMAGE) {
    event.respondWith(cardImage());
    return;
  }

  if (url.pathname.startsWith("/assets/") && ["script", "style", "font", "image"].includes(request.destination)) {
    event.respondWith(staticCache(request));
  }
});
