import { useCallback, useEffect } from "react";
import { api, resolveMediaUrl } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { onBrandingUpdated, setCachedBranding } from "@/lib/brandingEvents";

const DEFAULT_TITLE = "THE LION SQUAD - eSPORTS";
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

function pickFavicon(data) {
  const custom = data?.favicon_url || data?.favicon_light_url || data?.favicon_dark_url || "";
  if (custom) return resolveMediaUrl(custom);
  return "";
}

function pickThemedFavicons(data) {
  const fallback = pickFavicon(data);
  return {
    light: data?.favicon_light_url ? resolveMediaUrl(data.favicon_light_url) : fallback,
    dark: data?.favicon_dark_url ? resolveMediaUrl(data.favicon_dark_url) : fallback,
    fallback,
  };
}

function removeLinks(rel) {
  [...document.head.querySelectorAll(`link[rel="${rel}"]`)]
    .filter((node) => node.getAttribute("data-tls-route-meta") !== "true")
    .forEach((node) => node.remove());
}

function upsertLink(rel, href, attrs = {}) {
  if (!href) {
    removeLinks(rel);
    return;
  }
  const existing = [...document.head.querySelectorAll(`link[rel="${rel}"]`)]
    .filter((node) => node.getAttribute("data-tls-route-meta") !== "true");
  const nodes = existing.length ? existing : [document.createElement("link")];
  nodes.forEach((el) => {
    if (!el.parentNode) {
      el.setAttribute("rel", rel);
      document.head.appendChild(el);
    }
    Object.entries(attrs).forEach(([key, value]) => {
      if (value != null && value !== "") el.setAttribute(key, value);
      else el.removeAttribute(key);
    });
    el.setAttribute("href", href);
  });
}

function appendLink(rel, href, attrs = {}) {
  if (!href) return;
  const el = document.createElement("link");
  el.setAttribute("rel", rel);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value != null && value !== "") el.setAttribute(key, value);
  });
  el.setAttribute("href", href);
  document.head.appendChild(el);
}

function applyIconLinks(data) {
  const favicons = pickThemedFavicons(data);
  removeLinks("icon");
  if (favicons.light && favicons.light !== favicons.fallback) {
    appendLink("icon", favicons.light, {
      type: imageMimeType(favicons.light) || "image/png",
      sizes: "512x512",
      media: "(prefers-color-scheme: light)",
    });
  }
  if (favicons.dark && favicons.dark !== favicons.light) {
    appendLink("icon", favicons.dark, {
      type: imageMimeType(favicons.dark) || "image/png",
      sizes: "512x512",
      media: "(prefers-color-scheme: dark)",
    });
  }
  if (favicons.fallback) {
    appendLink("icon", favicons.fallback, {
      type: imageMimeType(favicons.fallback) || "image/png",
      sizes: "512x512",
    });
  }
  upsertLink("apple-touch-icon", favicons.fallback, favicons.fallback ? { sizes: "512x512" } : {});
}

function removeMeta(selector) {
  const el = document.head.querySelector(selector);
  if (el?.getAttribute("data-tls-route-meta") !== "true") el?.remove();
}

function imageMimeType(value) {
  const path = String(value || "").split("?")[0].toLowerCase();
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  return "";
}

function applyBranding(data) {
  if (!data) return;

  const name = data.club_name || "THE LION SQUAD";
  const siteTitle = data.site_title || DEFAULT_TITLE;
  const description = data.site_description || "Gaming und eSports Verein aus Tirol mit Community, Turnieren, Fast-Lap-Challenges, Events, Mitgliedschaft und Vereinsleben.";
  const themeColor = data.primary_color || "#29B6E8";
  const image = resolveMediaUrl(data.share_banner_url || data.logo_url || data.logo_light_url || data.logo_dark_url || data.mascot_url || DEFAULT_SHARE_IMAGE);
  const origin = data.domain || (typeof window !== "undefined" ? window.location.origin : "");

  if (!document.title || document.title === DEFAULT_TITLE || /React App|Vereinsplattform/i.test(document.title)) {
    document.title = siteTitle;
  }

  applyIconLinks(data);
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
  const imageType = imageMimeType(image);
  if (imageType) upsertMeta('meta[property="og:image:type"]', { property: "og:image:type", content: imageType });
  else removeMeta('meta[property="og:image:type"]');
  removeMeta('meta[property="og:image:width"]');
  removeMeta('meta[property="og:image:height"]');
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
