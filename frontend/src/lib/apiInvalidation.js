const listeners = new Set();
let version = 0;

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
  const enriched = {
    ...event,
    path: event.path || "",
    resource: event.resource || resourceFromPath(event.path),
    version: ++version,
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
}

export function subscribeApiInvalidation(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function invalidationMatches(event, resources = []) {
  if (!resources.length) return true;
  const keys = eventKeys(event);
  return resources.some((candidate) => {
    const normalized = normalizeApiPath(candidate);
    if (!normalized) return true;
    return keys.some((key) => key === normalized || key.startsWith(`${normalized}/`));
  });
}
