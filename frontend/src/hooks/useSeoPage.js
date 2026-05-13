/**
 * Phase G — SEO hook.
 * Fetches /api/seo/page/{slug} and applies title, meta description, and JSON-LD.
 * Cleans up on unmount.
 */
import { useCallback, useEffect } from "react";
import { api } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

const JSON_LD_ID = "tls-jsonld-cms";

function upsertMeta(selector, attrs) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement("meta");
    document.head.appendChild(el);
  }
  el.setAttribute("data-tls-route-meta", "true");
  Object.entries(attrs).forEach(([key, value]) => {
    if (value != null) el.setAttribute(key, value);
  });
  return el;
}

function upsertCanonical(href) {
  if (!href) return null;
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("data-tls-route-meta", "true");
  el.setAttribute("href", href);
  return el;
}

function snapshot(elements) {
  return elements.filter(Boolean).map((el) => ({
    el,
    values: {
      content: el.getAttribute("content"),
      href: el.getAttribute("href"),
      routeMeta: el.getAttribute("data-tls-route-meta"),
    },
  }));
}

function restore(snapshotItems) {
  snapshotItems.forEach(({ el, values }) => {
    if (!el) return;
    if (values.content == null) el.removeAttribute("content");
    else el.setAttribute("content", values.content);
    if (values.href == null) el.removeAttribute("href");
    else el.setAttribute("href", values.href);
    if (values.routeMeta == null) el.removeAttribute("data-tls-route-meta");
    else el.setAttribute("data-tls-route-meta", values.routeMeta);
  });
}

export function useSeoPage(slug) {
  const load = useCallback((shouldApply = () => true) => {
    if (!slug) return Promise.resolve();
    return api.get(`/seo/page/${slug}`).then(({ data }) => {
      if (!shouldApply()) return;
      if (data.title) document.title = data.title;
      const title = data.title || document.title;
      const description = data.description || "";
      const canonical = data.canonical || window.location.href.split("#")[0];
      const image = data.image || "";
      upsertCanonical(canonical);
      upsertMeta('meta[name="description"]', { name: "description", content: description });
      upsertMeta('meta[property="og:type"]', { property: "og:type", content: data.type || "website" });
      upsertMeta('meta[property="og:title"]', { property: "og:title", content: title });
      upsertMeta('meta[property="og:description"]', { property: "og:description", content: description });
      upsertMeta('meta[property="og:url"]', { property: "og:url", content: canonical });
      if (data.site_name) upsertMeta('meta[property="og:site_name"]', { property: "og:site_name", content: data.site_name });
      if (image) {
        upsertMeta('meta[property="og:image"]', { property: "og:image", content: image });
        upsertMeta('meta[property="og:image:secure_url"]', { property: "og:image:secure_url", content: image });
        upsertMeta('meta[property="og:image:alt"]', { property: "og:image:alt", content: title });
        upsertMeta('meta[name="twitter:image"]', { name: "twitter:image", content: image });
        upsertMeta('meta[name="twitter:image:alt"]', { name: "twitter:image:alt", content: title });
      }
      upsertMeta('meta[name="twitter:card"]', { name: "twitter:card", content: "summary_large_image" });
      upsertMeta('meta[name="twitter:title"]', { name: "twitter:title", content: title });
      upsertMeta('meta[name="twitter:description"]', { name: "twitter:description", content: description });
      if (data.json_ld) {
        let s = document.getElementById(JSON_LD_ID);
        if (!s) {
          s = document.createElement("script");
          s.type = "application/ld+json";
          s.id = JSON_LD_ID;
          document.head.appendChild(s);
        }
        s.textContent = JSON.stringify(data.json_ld);
      }
    }).catch(() => { /* fail-silent — page not in CMS or 404 */ });
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    let prevTitle = document.title;
    const previous = snapshot([
      document.querySelector('link[rel="canonical"]'),
      document.querySelector('meta[name="description"]'),
      document.querySelector('meta[property="og:type"]'),
      document.querySelector('meta[property="og:title"]'),
      document.querySelector('meta[property="og:description"]'),
      document.querySelector('meta[property="og:url"]'),
      document.querySelector('meta[property="og:site_name"]'),
      document.querySelector('meta[property="og:image"]'),
      document.querySelector('meta[property="og:image:secure_url"]'),
      document.querySelector('meta[property="og:image:alt"]'),
      document.querySelector('meta[name="twitter:card"]'),
      document.querySelector('meta[name="twitter:title"]'),
      document.querySelector('meta[name="twitter:description"]'),
      document.querySelector('meta[name="twitter:image"]'),
      document.querySelector('meta[name="twitter:image:alt"]'),
    ]);
    const previousElements = new Set(previous.map((item) => item.el));

    load(() => !cancelled);

    return () => {
      cancelled = true;
      document.title = prevTitle;
      restore(previous);
      document.querySelectorAll('[data-tls-route-meta="true"]').forEach((el) => {
        if (!previousElements.has(el)) el.removeAttribute("data-tls-route-meta");
      });
      const s = document.getElementById(JSON_LD_ID);
      if (s) s.remove();
    };
  }, [load, slug]);
  useApiInvalidation(() => load(), ["pages", "cms", "seo"]);
}

/**
 * Generic JSON-LD injector for arbitrary objects (events, tournaments, profiles).
 */
export function useJsonLd(obj, key = "tls-jsonld-runtime") {
  useEffect(() => {
    if (!obj) return undefined;
    let s = document.getElementById(key);
    if (!s) {
      s = document.createElement("script");
      s.type = "application/ld+json";
      s.id = key;
      document.head.appendChild(s);
    }
    s.textContent = JSON.stringify(obj);
    return () => { const n = document.getElementById(key); if (n) n.remove(); };
  }, [obj, key]);
}
