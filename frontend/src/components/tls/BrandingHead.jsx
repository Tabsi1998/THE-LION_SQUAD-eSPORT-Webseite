import { useEffect } from "react";
import { api, resolveMediaUrl } from "@/lib/api";
import { TLS_MASCOT } from "@/components/tls/Logo";

const DEFAULT_TITLE = "THE LION SQUAD - eSports Vereinsplattform";

function upsertMeta(selector, attrs) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement("meta");
    document.head.appendChild(el);
  }
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
  el.setAttribute("href", href);
}

export function BrandingHead() {
  useEffect(() => {
    let cancelled = false;

    api.get("/settings/public").then(({ data }) => {
      if (cancelled || !data) return;

      const name = data.club_name || "THE LION SQUAD";
      const description = data.site_description || "THE LION SQUAD eSports Vereinsplattform";
      const themeColor = data.primary_color || "#29B6E8";
      const icon = data.favicon_url || data.mascot_url || data.logo_url || TLS_MASCOT;

      if (!document.title || document.title === DEFAULT_TITLE || document.title.includes("React App")) {
        document.title = `${name} - eSports Vereinsplattform`;
      }

      upsertLink("icon", resolveMediaUrl(icon));
      upsertLink("apple-touch-icon", resolveMediaUrl(icon));
      upsertLink("manifest", "/api/manifest.webmanifest");

      upsertMeta('meta[name="application-name"]', { name: "application-name", content: name });
      upsertMeta('meta[name="theme-color"]', { name: "theme-color", content: themeColor });
      upsertMeta('meta[name="description"]', { name: "description", content: description });
      upsertMeta('meta[property="og:site_name"]', { property: "og:site_name", content: name });
      upsertMeta('meta[property="og:title"]', { property: "og:title", content: `${name} - eSports Vereinsplattform` });
      upsertMeta('meta[property="og:description"]', { property: "og:description", content: description });
    }).catch(() => {});

    return () => { cancelled = true; };
  }, []);

  return null;
}
