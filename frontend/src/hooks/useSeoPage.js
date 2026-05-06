/**
 * Phase G — SEO hook.
 * Fetches /api/seo/page/{slug} and applies title, meta description, and JSON-LD.
 * Cleans up on unmount.
 */
import { useCallback, useEffect } from "react";
import { api } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

const JSON_LD_ID = "tls-jsonld-cms";

export function useSeoPage(slug) {
  const load = useCallback((shouldApply = () => true) => {
    if (!slug) return Promise.resolve();
    return api.get(`/seo/page/${slug}`).then(({ data }) => {
      if (!shouldApply()) return;
      if (data.title) document.title = data.title;
      const descTag = document.querySelector('meta[name="description"]');
      if (data.description && descTag) descTag.setAttribute("content", data.description);
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
    let prevDesc = null;
    const descTag = document.querySelector('meta[name="description"]');
    if (descTag) prevDesc = descTag.getAttribute("content");

    load(() => !cancelled);

    return () => {
      cancelled = true;
      document.title = prevTitle;
      if (descTag && prevDesc !== null) descTag.setAttribute("content", prevDesc);
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
