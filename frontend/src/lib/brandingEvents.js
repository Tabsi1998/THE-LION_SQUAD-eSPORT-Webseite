export const BRANDING_UPDATED_EVENT = "tls:branding-updated";

let cachedBranding = null;

export function getCachedBranding() {
  return cachedBranding;
}

export function setCachedBranding(data) {
  cachedBranding = data || {};
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(BRANDING_UPDATED_EVENT, { detail: cachedBranding }));
  }
}

export function onBrandingUpdated(callback) {
  if (typeof window === "undefined") return () => {};
  const handler = (event) => callback(event.detail || cachedBranding || {});
  window.addEventListener(BRANDING_UPDATED_EVENT, handler);
  return () => window.removeEventListener(BRANDING_UPDATED_EVENT, handler);
}
