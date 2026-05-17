import { useEffect, useState } from "react";
import { resolveMediaUrl } from "@/lib/api";
import { getCachedBranding, onBrandingUpdated } from "@/lib/brandingEvents";

const DEFAULT_SITE_TITLE = "THE LION SQUAD - eSPORTS";
const DEFAULT_SHARE_IMAGE = "/assets/brand/tls-wordmark.png";

function titleBase(branding) {
  return branding?.site_title || DEFAULT_SITE_TITLE;
}

function upsertMeta(selector, attrs) {
  let el = document.querySelector(selector);
  if (!el) {
    el = document.createElement("meta");
    document.head.appendChild(el);
  }
  Object.entries(attrs).forEach(([key, value]) => {
    if (value != null) el.setAttribute(key, value);
  });
  return el;
}

function markRouteManaged(el) {
  if (el) el.setAttribute("data-tls-route-meta", "true");
  return el;
}

function upsertCanonical() {
  let el = document.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  return el;
}

function snapshot(elements, attrs = ["content", "href"]) {
  return elements.map((el) => ({
    el,
    values: Object.fromEntries(attrs.map((attr) => [attr, el?.getAttribute(attr)])),
  }));
}

function restore(snapshotItems) {
  snapshotItems.forEach(({ el, values }) => {
    if (!el) return;
    el.removeAttribute("data-tls-route-meta");
    Object.entries(values).forEach(([attr, value]) => {
      if (value == null) el.removeAttribute(attr);
      else el.setAttribute(attr, value);
    });
  });
}

/** Sets document title, canonical URL and share meta. Restores original on unmount. */
export function useDocumentTitle(title, description, options = {}) {
  const [branding, setBranding] = useState(() => getCachedBranding());

  useEffect(() => onBrandingUpdated((next) => setBranding(next || {})), []);

  useEffect(() => {
    const base = titleBase(branding);
    const fullTitle = title ? `${title} · ${base}` : base;
    const canonicalHref = options.canonical || window.location.href.split("#")[0];
    const image = resolveMediaUrl(options.image || branding?.logo_url || branding?.mascot_url || DEFAULT_SHARE_IMAGE);
    const type = options.type || "website";
    const previousTitle = document.title;

    const descTag = upsertMeta('meta[name="description"]', { name: "description" });
    const ogType = upsertMeta('meta[property="og:type"]', { property: "og:type" });
    const ogTitle = upsertMeta('meta[property="og:title"]', { property: "og:title" });
    const ogDesc = upsertMeta('meta[property="og:description"]', { property: "og:description" });
    const ogUrl = upsertMeta('meta[property="og:url"]', { property: "og:url" });
    const ogImage = upsertMeta('meta[property="og:image"]', { property: "og:image" });
    const ogSecureImage = upsertMeta('meta[property="og:image:secure_url"]', { property: "og:image:secure_url" });
    const ogImageType = upsertMeta('meta[property="og:image:type"]', { property: "og:image:type" });
    const ogImageWidth = upsertMeta('meta[property="og:image:width"]', { property: "og:image:width" });
    const ogImageHeight = upsertMeta('meta[property="og:image:height"]', { property: "og:image:height" });
    const ogImageAlt = upsertMeta('meta[property="og:image:alt"]', { property: "og:image:alt" });
    const twitterCard = upsertMeta('meta[name="twitter:card"]', { name: "twitter:card" });
    const twitterTitle = upsertMeta('meta[name="twitter:title"]', { name: "twitter:title" });
    const twitterDesc = upsertMeta('meta[name="twitter:description"]', { name: "twitter:description" });
    const twitterImage = upsertMeta('meta[name="twitter:image"]', { name: "twitter:image" });
    const twitterImageAlt = upsertMeta('meta[name="twitter:image:alt"]', { name: "twitter:image:alt" });
    const canonical = upsertCanonical();
    const routeManaged = [descTag, ogType, ogTitle, ogDesc, ogUrl, ogImage, ogSecureImage, ogImageType, ogImageWidth, ogImageHeight, ogImageAlt, twitterCard, twitterTitle, twitterDesc, twitterImage, twitterImageAlt, canonical];
    const previous = snapshot(routeManaged);
    routeManaged.forEach(markRouteManaged);

    document.title = fullTitle;
    if (description) descTag.setAttribute("content", description);
    ogType.setAttribute("content", type);
    ogTitle.setAttribute("content", fullTitle);
    if (description) ogDesc.setAttribute("content", description);
    ogUrl.setAttribute("content", canonicalHref);
    ogImage.setAttribute("content", image);
    ogSecureImage.setAttribute("content", image);
    ogImageType.setAttribute("content", "image/png");
    ogImageWidth.setAttribute("content", "1200");
    ogImageHeight.setAttribute("content", "630");
    ogImageAlt.setAttribute("content", fullTitle);
    twitterImage.setAttribute("content", image);
    twitterImageAlt.setAttribute("content", fullTitle);
    twitterCard.setAttribute("content", "summary_large_image");
    twitterTitle.setAttribute("content", fullTitle);
    if (description) twitterDesc.setAttribute("content", description);
    canonical.setAttribute("href", canonicalHref);
    return () => {
      document.title = previousTitle;
      restore(previous);
    };
  }, [title, description, branding, options.canonical, options.image, options.type]);
}
