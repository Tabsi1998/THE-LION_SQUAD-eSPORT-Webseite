import { useEffect } from "react";

const BASE = "THE LION SQUAD";

/** Sets document.title and key meta description. Restores original on unmount. */
export function useDocumentTitle(title, description) {
  useEffect(() => {
    const prev = document.title;
    document.title = title ? `${title} · ${BASE}` : `${BASE} · eSports Vereinsplattform`;
    let descTag = document.querySelector('meta[name="description"]');
    const prevDesc = descTag?.getAttribute("content");
    if (description && descTag) descTag.setAttribute("content", description);
    return () => {
      document.title = prev;
      if (descTag && prevDesc !== undefined) descTag.setAttribute("content", prevDesc);
    };
  }, [title, description]);
}
