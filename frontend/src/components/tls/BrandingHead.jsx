import { useCallback, useEffect } from "react";
import { api, resolveMediaUrl } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { onBrandingUpdated, setCachedBranding } from "@/lib/brandingEvents";

const DEFAULT_TITLE = "THE LION SQUAD - eSPORTS";
const DEFAULT_FAVICON = "/assets/brand/tls-favicon.png";
const DEFAULT_SHARE_IMAGE = "/assets/brand/tls-wordmark.png";

function upsertMeta(selector, attrs) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement("meta");
    document.head.appendChild(el);
  }
  if (el.getAttribute("data-tls-route-meta") === "true") return;
  Object.entries(attrs).forEach(([key, value]) => {
    if (value != null) el.setAttribute(key, value);
  });
}

function upsertLink(rel, href) {
  if (!href) return;
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  if (el.getAttribute("data-tls-route-meta") === "true") return;
  el.setAttribute("href", href);
}

function applyBranding(data) {
  if (!data) return;

  const name = data.club_name || "THE LION SQUAD";
  const siteTitle = data.site_title || DEFAULT_TITLE;
  const description = data.site_description || "THE LION SQUAD - eSPORTS";
  const themeColor = data.primary_color || "#29B6E8";
  const image = resolveMediaUrl(data.logo_url || data.mascot_url || DEFAULT_SHARE_IMAGE);
  const origin = data.domain || (typeof window !== "undefined" ? window.location.origin : "");

  if (!document.title || document.title === DEFAULT_TITLE || /React App|Vereinsplattform/i.test(document.title)) {
    document.title = siteTitle;
  }

  upsertLink("icon", "/favicon.ico");
  upsertLink("apple-touch-icon", resolveMediaUrl(DEFAULT_FAVICON));
  upsertLink("manifest", "/api/manifest.webmanifest");

  upsertMeta('meta[name="application-name"]', { name: "application-name", content: name });
  upsertMeta('meta[name="theme-color"]', { name: "theme-color", content: themeColor });
  upsertMeta('meta[name="description"]', { name: "description", content: description });
  upsertMeta('meta[property="og:site_name"]', { property: "og:site_name", content: name });
  upsertMeta('meta[property="og:title"]', { property: "og:title", content: siteTitle });
  upsertMeta('meta[property="og:description"]', { property: "og:description", content: description });
  upsertMeta('meta[property="og:url"]', { property: "og:url", content: origin });
  upsertMeta('meta[property="og:image"]', { property: "og:image", content: image });
  upsertMeta('meta[property="og:image:secure_url"]', { property: "og:image:secure_url", content: image });
  upsertMeta('meta[property="og:image:type"]', { property: "og:image:type", content: "image/png" });
  upsertMeta('meta[property="og:image:width"]', { property: "og:image:width", content: "1200" });
  upsertMeta('meta[property="og:image:height"]', { property: "og:image:height", content: "630" });
  upsertMeta('meta[property="og:image:alt"]', { property: "og:image:alt", content: siteTitle });
  upsertMeta('meta[name="twitter:card"]', { name: "twitter:card", content: "summary_large_image" });
  upsertMeta('meta[name="twitter:title"]', { name: "twitter:title", content: siteTitle });
  upsertMeta('meta[name="twitter:description"]', { name: "twitter:description", content: description });
  upsertMeta('meta[name="twitter:image"]', { name: "twitter:image", content: image });
  upsertMeta('meta[name="twitter:image:alt"]', { name: "twitter:image:alt", content: siteTitle });
  if (data.google_site_verification) {
    upsertMeta('meta[name="google-site-verification"]', { name: "google-site-verification", content: data.google_site_verification });
  }
  if (data.msvalidate_01) {
    upsertMeta('meta[name="msvalidate.01"]', { name: "msvalidate.01", content: data.msvalidate_01 });
  }
}

export function BrandingHead() {
  const loadBranding = useCallback(async () => {
    try {
      const { data } = await api.get("/settings/public");
      setCachedBranding(data || {});
      applyBranding(data);
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;
    const handleBranding = (data) => {
      if (!cancelled) applyBranding(data);
    };
    const unsubscribe = onBrandingUpdated(handleBranding);
    loadBranding();

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [loadBranding]);
  useApiInvalidation(loadBranding, ["settings", "branding"]);

  return null;
}
