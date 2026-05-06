import { useEffect } from "react";

const BASE = "THE LION SQUAD";

/** Sets document.title and key meta description. Restores original on unmount. */
export function useDocumentTitle(title, description) {
  useEffect(() => {
    const prev = document.title;
    document.title = title ? `${title} · ${BASE}` : `${BASE} · eSports Vereinsplattform`;
    let descTag = document.querySelector('meta[name="description"]');
    const prevDesc = descTag?.getAttribute("content");
    let ogTitle = document.querySelector('meta[property="og:title"]');
    let ogDesc = document.querySelector('meta[property="og:description"]');
    let canonical = document.querySelector('link[rel="canonical"]');
    const prevOgTitle = ogTitle?.getAttribute("content");
    const prevOgDesc = ogDesc?.getAttribute("content");
    const prevCanonical = canonical?.getAttribute("href");
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.setAttribute("rel", "canonical");
      document.head.appendChild(canonical);
    }
    if (description && descTag) descTag.setAttribute("content", description);
    if (ogTitle) ogTitle.setAttribute("content", document.title);
    if (description && ogDesc) ogDesc.setAttribute("content", description);
    canonical.setAttribute("href", window.location.href.split("#")[0]);
    return () => {
      document.title = prev;
      if (descTag && prevDesc !== undefined) descTag.setAttribute("content", prevDesc);
      if (ogTitle && prevOgTitle !== undefined) ogTitle.setAttribute("content", prevOgTitle);
      if (ogDesc && prevOgDesc !== undefined) ogDesc.setAttribute("content", prevOgDesc);
      if (canonical && prevCanonical !== undefined) canonical.setAttribute("href", prevCanonical);
    };
  }, [title, description]);
}
