import { useCallback, useEffect } from "react";
import { api, resolveMediaUrl } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { onBrandingUpdated, setCachedBranding } from "@/lib/brandingEvents";
import { TLS_MASCOT } from "@/components/tls/Logo";

const DEFAULT_TITLE = "THE LION SQUAD - eSPORTS";

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
  const icon = data.favicon_url || data.mascot_url || data.logo_url || TLS_MASCOT;
  const image = resolveMediaUrl(data.og_image_url || data.mascot_url || data.logo_url || TLS_MASCOT);
  const origin = data.domain || (typeof window !== "undefined" ? window.location.origin : "");

  if (!document.title || document.title === DEFAULT_TITLE || /React App|Vereinsplattform/i.test(document.title)) {
    document.title = siteTitle;
  }

  upsertLink("icon", resolveMediaUrl(icon));
  upsertLink("apple-touch-icon", resolveMediaUrl(icon));
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
  upsertMeta('meta[property="og:image:alt"]', { property: "og:image:alt", content: siteTitle });
  upsertMeta('meta[name="twitter:card"]', { name: "twitter:card", content: "summary_large_image" });
  upsertMeta('meta[name="twitter:title"]', { name: "twitter:title", content: siteTitle });
  upsertMeta('meta[name="twitter:description"]', { name: "twitter:description", content: description });
  upsertMeta('meta[name="twitter:image"]', { name: "twitter:image", content: image });
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
