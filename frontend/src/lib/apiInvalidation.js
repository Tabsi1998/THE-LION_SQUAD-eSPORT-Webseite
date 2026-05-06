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
  const path = normalizeApiPath(event?.path);
  const resource = event?.resource || resourceFromPath(path);
  return resources.some((candidate) => {
    const normalized = normalizeApiPath(candidate);
    if (!normalized) return true;
    return (
      resource === normalized ||
      resource.startsWith(`${normalized}/`) ||
      path === normalized ||
      path.startsWith(`${normalized}/`)
    );
  });
}
