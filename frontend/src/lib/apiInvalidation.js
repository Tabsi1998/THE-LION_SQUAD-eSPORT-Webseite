const listeners = new Set();
let version = 0;
const seenServerEvents = new Set();
const seenServerEventOrder = [];
const SEEN_SERVER_EVENT_LIMIT = 512;

export function normalizeApiPath(path) {
  if (!path) return "";
  let value = String(path);
  try {
    value = new URL(value, window.location.origin).pathname;
  } catch {
    value = value.split("?")[0];
  }
  value = value.replace(/^\/+/, "");
  if (value.startsWith("api/")) value = value.slice(4);
  return value.replace(/\/+$/, "");
}

export function resourceFromPath(path) {
  const parts = normalizeApiPath(path).split("/").filter(Boolean);
  if (!parts.length) return "";
  if (parts[0] === "admin" && parts[1]) return `${parts[0]}/${parts[1]}`;
  return parts[0];
}

const RESOURCE_ALIASES = {
  "admin/achievements": ["achievements", "badges", "users"],
  "admin/email-templates": ["email-templates", "settings"],
  "admin/media": ["media", "uploads"],
  "admin/nav": ["nav"],
  "admin/pages": ["pages", "cms"],
  "membership/applications": ["membership", "users"],
  "membership/benefits": ["membership"],
  "membership/user": ["membership", "users"],
  "settings/branding": ["settings", "branding", "nav", "home"],
  "settings/discord": ["settings", "discord"],
  "settings/email": ["settings", "mail"],
  "settings/mail-queue": ["settings", "mail"],
  "settings/smtp": ["settings", "mail"],
  uploads: ["media"],
  matches: ["tournaments"],
  "matches-v2": ["tournaments", "matches"],
  prizes: ["users"],
  f1: ["fastlap", "prizes"],
};

function eventKeys(event) {
  const path = normalizeApiPath(event?.path);
  const resource = event?.resource || resourceFromPath(path);
  const keys = new Set([path, resource].filter(Boolean));
  if (path.startsWith("admin/")) {
    keys.add(path.slice("admin/".length));
  }
  const parts = path.split("/").filter(Boolean);
  for (let i = 1; i <= Math.min(parts.length, 3); i += 1) {
    keys.add(parts.slice(0, i).join("/"));
    if (parts[0] === "admin" && i > 1) {
      keys.add(parts.slice(1, i).join("/"));
    }
  }
  for (const key of [...keys]) {
    (RESOURCE_ALIASES[key] || []).forEach((alias) => keys.add(alias));
  }
  return [...keys].filter(Boolean);
}

export function emitApiInvalidation(event = {}) {
  const eventKey = event.event_id || event.id || event.dedupe_key;
  if (event.source === "server" && eventKey) {
    if (seenServerEvents.has(eventKey)) return false;
    seenServerEvents.add(eventKey);
    seenServerEventOrder.push(eventKey);
    if (seenServerEventOrder.length > SEEN_SERVER_EVENT_LIMIT) {
      seenServerEvents.delete(seenServerEventOrder.shift());
    }
  }
  const clientVersion = ++version;
  const enriched = {
    ...event,
    path: event.path || "",
    resource: event.resource || resourceFromPath(event.path),
    version: event.version ?? clientVersion,
    clientVersion,
    receivedAt: Date.now(),
  };
  listeners.forEach((listener) => {
    try {
      listener(enriched);
    } catch {
      // Keep one broken subscriber from blocking the rest.
    }
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("tls:api-change", { detail: enriched }));
  }
  return true;
}

export function subscribeApiInvalidation(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Steht die Verbindung zum Änderungsstrom? Solange ja, braucht keine Ansicht
// im Takt nachzufragen; fällt sie weg, darf sie es (#221). Die Brücke setzt
// den Zustand, useLiveRefresh liest ihn.
let streamConnected = false;
const streamListeners = new Set();

export function setStreamConnected(next) {
  const value = Boolean(next);
  if (value === streamConnected) return;
  streamConnected = value;
  streamListeners.forEach((listener) => {
    try {
      listener(value);
    } catch {
      // Ein kaputter Abonnent blockiert die anderen nicht.
    }
  });
}

export function isStreamConnected() {
  return streamConnected;
}

export function subscribeStreamState(listener) {
  streamListeners.add(listener);
  return () => streamListeners.delete(listener);
}

// Live-Nachladen je Turnier (#1801): Der Server nennt in der Meldung das Turnier (`tournament_id`) und dessen Event
// (`parent_event_id`), wenn beides öffentlich ist. Eine Seite eines Turniers lädt dann nur bei Änderungen dieses
// Turniers nach. Ohne Kennung in der Meldung - oder solange die Seite ihr Turnier noch nicht kennt - gilt wie bisher alles.
// Die Turniere eines Events teilen sich Stationen: Hört die Seite auf „stations“, zählt auch jedes andere Turnier
// desselben Events. Kennt sie ihr Event nicht (TV mit Schlüssel), jedes Turnier mit Event - eines ohne Event teilt keine.
function concernsScope(event, { tournamentId, eventId } = {}, sharedStations = false) {
  const changed = event?.tournament_id;
  if (!changed || !tournamentId || changed === tournamentId) return true;
  if (!sharedStations) return false;
  const changedEvent = event.parent_event_id;
  return Boolean(changedEvent) && (!eventId || changedEvent === eventId);
}

/**
 * @param {object} event       die Meldung aus dem Änderungsstrom
 * @param {string[]} resources Ressourcen der Ansicht; leer = alles
 * @param {{ tournamentId?: string|null, eventId?: string|null }} scope  Turnier (und Event) der Ansicht (#1801)
 */
export function invalidationMatches(event, resources = [], scope = {}) {
  if (event?.reset || event?.event_type === "stream.reset") return true;
  if (resources.length) {
    const keys = eventKeys(event);
    const matched = resources.some((candidate) => {
      const normalized = normalizeApiPath(candidate);
      if (!normalized) return true;
      return keys.some((key) => key === normalized || key.startsWith(`${normalized}/`));
    });
    if (!matched) return false;
  }
  const sharedStations = resources.some((candidate) => normalizeApiPath(candidate) === "stations");
  return concernsScope(event, scope || {}, sharedStations);
}
